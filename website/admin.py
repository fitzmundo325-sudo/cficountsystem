from flask import Blueprint, redirect, render_template, request, url_for, flash, jsonify
from .models import User, Store, Cluster, DailyReport, StoreTarget, ProductMaster, ProductAlias, AuditLog, GlobalInvenSyncConfig, MaintenanceMode, PosSold, RsoDelivery, RsoDeliveryDraft, MenuInventoryItem, DailyEndingInventory, DailyEndingInventoryItem, TafTransfer, TafTransferItem, StoreProductBuffer
from . import db
from .audit import log_audit_event, verify_audit_chain
from werkzeug.security import check_password_hash, generate_password_hash
from flask_login import login_required, current_user
from sqlalchemy import or_, cast, String, func, case
from sqlalchemy.orm import selectinload
import pandas as pd
from datetime import datetime, timedelta, date
from werkzeug.utils import secure_filename
import os
import re
import json
from difflib import SequenceMatcher


admin = Blueprint('admin', __name__)

def _can_manage_users():
    return current_user.role in ('Superadmin', 'Admin', 'General Manager')


_CLEAR_DATA_OPTIONS = {
    'rso': {
        'label': 'RSO delivery data',
        'confirmation': 'DELETE RSO',
    },
    'pos_sold': {
        'label': 'POS Sold data',
        'confirmation': 'DELETE POS SOLD',
    },
    'daily_sales': {
        'label': 'Daily Sales reports and POS Sold data',
        'confirmation': 'DELETE DAILY SALES',
    },
    'invensync': {
        'label': 'InvenSync inventory data',
        'confirmation': 'DELETE INVENSYNC',
    },
    'transfers': {
        'label': 'TransAct transfer data',
        'confirmation': 'DELETE TRANSFERS',
    },
    'targets': {
        'label': 'Store target data',
        'confirmation': 'DELETE TARGETS',
    },
    'all_operational': {
        'label': 'All operational data',
        'confirmation': 'DELETE ALL OPERATIONAL DATA',
    },
}


def _is_grand_total_product_name(product_name):
    normalized = re.sub(r'[^a-z0-9]+', '', str(product_name or '').strip().lower())
    return normalized.startswith('grandtotal')


def _normalize_product_text(value):
    return re.sub(r'[^a-z0-9]+', '', str(value or '').strip().lower())


def _build_name_variants(normalized_name):
    variants = {normalized_name}
    if normalized_name.endswith('ies') and len(normalized_name) > 5:
        variants.add(normalized_name[:-3] + 'y')
    if normalized_name.endswith('es') and len(normalized_name) > 4:
        variants.add(normalized_name[:-2])
    if normalized_name.endswith('s') and len(normalized_name) > 3:
        variants.add(normalized_name[:-1])
    return {item for item in variants if item}


def _get_product_alias_lookup():
    rows = (
        db.session.query(ProductAlias.normalized_alias, ProductMaster.description)
        .join(ProductMaster, ProductMaster.id == ProductAlias.product_master_id)
        .all()
    )
    return {
        str(normalized_alias or '').strip(): (description or '').strip()
        for normalized_alias, description in rows
        if str(normalized_alias or '').strip() and (description or '').strip()
    }


def _build_top_products_from_reports(reports):
    product_map = [
        ('GC', 'pos_qty_gc', 'bg-indigo-500', 'bg-indigo-100 text-indigo-700'),
        ('Rolls', 'pos_qty_rolls', 'bg-slate-600', 'bg-slate-200 text-slate-700'),
        ('Premium', 'pos_qty_premium', 'bg-emerald-500', 'bg-emerald-100 text-emerald-700'),
        ('Cheesy Ensay', 'pos_qty_cheesy_ensay', 'bg-rose-500', 'bg-rose-100 text-rose-700'),
        ('Slices', 'pos_qty_slices', 'bg-slate-400', 'bg-slate-200 text-slate-700'),
        ('Mamon Sold', 'pos_qty_mamon', 'bg-amber-500', 'bg-amber-100 text-amber-700'),
    ]

    products = []
    for name, field, bar_class, badge_class in product_map:
        units = sum(int(getattr(report, field, 0) or 0) for report in reports)
        products.append({
            'name': name,
            'units': units,
            'bar_class': bar_class,
            'badge_class': badge_class,
        })

    products = sorted(products, key=lambda item: item['units'], reverse=True)
    max_units = max((item['units'] for item in products), default=0)
    total_units = sum(item['units'] for item in products)

    for rank, item in enumerate(products, start=1):
        item['rank'] = rank
        item['bar_percent'] = (float(item['units']) / float(max_units) * 100.0) if max_units > 0 else 0.0
        item['share_percent'] = (float(item['units']) / float(total_units) * 100.0) if total_units > 0 else 0.0

    return products


def _build_store_product_mix_from_reports(reports, stores):
    store_lookup = {store.id: store.name for store in stores}
    product_defs = [
        ('GC', 'pos_qty_gc', '#6366f1'),
        ('Rolls', 'pos_qty_rolls', '#475569'),
        ('Premium', 'pos_qty_premium', '#10b981'),
        ('Cheesy Ensay', 'pos_qty_cheesy_ensay', '#e11d48'),
        ('Slices', 'pos_qty_slices', '#94a3b8'),
        ('Mamon Sold', 'pos_qty_mamon', '#f59e0b'),
    ]

    per_store = {
        store.id: {
            'store_id': store.id,
            'store_name': store.name,
            'segments': [{'label': label, 'value': 0, 'color': color} for label, _, color in product_defs],
            'total_units': 0,
        }
        for store in stores
    }

    for report in reports:
        store_id = int(report.store_id)
        if store_id not in per_store:
            per_store[store_id] = {
                'store_id': store_id,
                'store_name': store_lookup.get(store_id, f'Store {store_id}'),
                'segments': [{'label': label, 'value': 0, 'color': color} for label, _, color in product_defs],
                'total_units': 0,
            }

        for index, (_, field_name, _) in enumerate(product_defs):
            per_store[store_id]['segments'][index]['value'] += int(getattr(report, field_name, 0) or 0)

    store_mix = sorted(per_store.values(), key=lambda item: (item['store_name'] or '').lower())
    for item in store_mix:
        item['total_units'] = sum(int(seg['value'] or 0) for seg in item['segments'])
    return store_mix


def _resolve_dashboard_month_year(month_arg, year_arg):
    if month_arg and year_arg:
        return int(year_arg), int(month_arg)

    latest_report = DailyReport.query.filter(
        DailyReport.status == 'Approved'
    ).order_by(DailyReport.report_date.desc()).first()

    base_date = latest_report.report_date if latest_report else datetime.today().date()
    return int(base_date.year), int(base_date.month)


@admin.route('/admin/pos-sold')
@login_required
def pos_sold():
    if current_user.role not in ('Superadmin', 'Admin', 'General Manager'):
        flash('Access denied. Only Admins, Superadmins, and General Managers can access this page.', category='error')
        return redirect(url_for('views.home'))

    from .views import _apply_store_scope_filter

    active_tab = (request.args.get('tab') or 'consolidated').strip()
    if active_tab not in ('consolidated', 'review'):
        active_tab = 'consolidated'
    apply_filter = (request.args.get('apply') or '').strip() == '1'
    selected_cluster_id = request.args.get('cluster_id', type=int)
    selected_store_id = request.args.get('store_id', type=int)
    review_store_id = request.args.get('review_store_id', type=int)
    today = datetime.today().date()
    default_start_date_str = today.replace(day=1).strftime('%Y-%m-%d')
    start_date_raw = (request.args.get('start_date') or default_start_date_str).strip()
    end_date_raw = (request.args.get('end_date') or '').strip()
    review_date_raw = (request.args.get('review_date') or today.strftime('%Y-%m-%d')).strip()

    clusters = Cluster.query.order_by(Cluster.name.asc()).all()
    cluster_lookup = {int(cluster.id): cluster for cluster in clusters}

    stores = _apply_store_scope_filter(Store.query.order_by(Store.name.asc()).all(), request)
    stores_for_selected_cluster = [
        store for store in stores if selected_cluster_id and int(store.cluster_id or 0) == int(selected_cluster_id)
    ] if selected_cluster_id else []

    table_rows = []
    total_qty = 0
    total_gross_sales = 0.0
    total_discount = 0.0
    total_net_sales = 0.0
    distinct_store_ids = set()
    review_rows = []
    review_report = None
    review_summary = {
        'rows_count': 0,
        'total_qty': 0,
        'total_gross_sales': 0.0,
        'total_discount': 0.0,
        'total_net_sales': 0.0,
    }

    can_show_results = False
    start_date_value = start_date_raw
    end_date_value = end_date_raw

    def _parse_iso_date(value):
        if not value:
            return None
        try:
            return datetime.strptime(value, '%Y-%m-%d').date()
        except (TypeError, ValueError):
            return None

    review_date = _parse_iso_date(review_date_raw) or today
    review_date_value = review_date.strftime('%Y-%m-%d')
    if active_tab == 'review' and review_store_id:
        review_store = Store.query.get(review_store_id)
        if not review_store:
            flash('Selected review store does not exist.', category='error')
            review_store_id = None
        else:
            review_report = DailyReport.query.filter_by(
                store_id=review_store_id,
                report_date=review_date,
            ).first()
            if review_report:
                review_rows = (
                    PosSold.query
                    .filter_by(daily_report_id=review_report.id)
                    .order_by(PosSold.product_name.asc(), PosSold.id.asc())
                    .all()
                )
                review_summary = {
                    'rows_count': len(review_rows),
                    'total_qty': sum(int(row.quantity or 0) for row in review_rows),
                    'total_gross_sales': sum(float(row.gross_sales or 0.0) for row in review_rows),
                    'total_discount': sum(float(row.discount or 0.0) for row in review_rows),
                    'total_net_sales': sum(float(row.net_sales or 0.0) for row in review_rows),
                }

    if apply_filter:
        if not selected_cluster_id:
            flash('Please select a cluster first.', category='error')
        elif selected_cluster_id not in cluster_lookup:
            flash('Selected cluster does not exist.', category='error')
            selected_cluster_id = None
        else:
            start_date = _parse_iso_date(start_date_raw)
            end_date = _parse_iso_date(end_date_raw)
            if not start_date or not end_date:
                flash('Please select valid start and end dates.', category='error')
            else:
                if start_date > end_date:
                    start_date, end_date = end_date, start_date
                start_date_value = start_date.strftime('%Y-%m-%d')
                end_date_value = end_date.strftime('%Y-%m-%d')

                allowed_store_ids = {int(store.id) for store in stores_for_selected_cluster}
                if selected_store_id and selected_store_id not in allowed_store_ids:
                    flash('Selected store does not belong to the chosen cluster.', category='error')
                    selected_store_id = None

                alias_lookup = _get_product_alias_lookup()
                master_rows = ProductMaster.query.with_entities(ProductMaster.description, ProductMaster.category).all()
                master_category_by_normalized_name = {
                    _normalize_product_text(description): (category or '').strip() or 'Uncategorized'
                    for description, category in master_rows
                    if _normalize_product_text(description)
                }

                pos_query = (
                    db.session.query(
                        Store.id.label('store_id'),
                        Store.name.label('store_name'),
                        Cluster.name.label('cluster_name'),
                        PosSold.product_name.label('product_name'),
                        DailyReport.report_date.label('report_date'),
                        func.sum(PosSold.quantity).label('daily_qty'),
                        func.sum(PosSold.gross_sales).label('daily_gross_sales'),
                        func.sum(PosSold.discount).label('daily_discount'),
                        func.sum(PosSold.net_sales).label('daily_net_sales'),
                    )
                    .join(DailyReport, DailyReport.id == PosSold.daily_report_id)
                    .join(Store, Store.id == DailyReport.store_id)
                    .outerjoin(Cluster, Cluster.id == Store.cluster_id)
                    .filter(
                        Store.cluster_id == selected_cluster_id,
                        DailyReport.report_date >= start_date,
                        DailyReport.report_date <= end_date,
                    )
                )

                if selected_store_id:
                    pos_query = pos_query.filter(Store.id == selected_store_id)

                pos_rows = (
                    pos_query
                    .group_by(Store.id, Store.name, Cluster.name, PosSold.product_name, DailyReport.report_date)
                    .order_by(Store.name.asc(), DailyReport.report_date.asc(), PosSold.product_name.asc())
                    .all()
                )

                consolidated_map = {}
                for row in pos_rows:
                    raw_product_name = (row.product_name or '').strip() or 'Unnamed Product'
                    canonical_name = alias_lookup.get(_normalize_product_text(raw_product_name), raw_product_name)
                    canonical_name = (canonical_name or '').strip() or 'Unnamed Product'
                    store_id = int(row.store_id)

                    bucket_key = (store_id, canonical_name.lower())
                    if bucket_key not in consolidated_map:
                        consolidated_map[bucket_key] = {
                            'cluster_name': row.cluster_name or 'Unassigned',
                            'store_id': store_id,
                            'store_name': row.store_name or f'Store {row.store_id}',
                            'product_name': canonical_name,
                            'days_set': set(),
                            'quantity': 0,
                            'gross_sales': 0.0,
                            'discount': 0.0,
                            'net_sales': 0.0,
                        }

                    consolidated_map[bucket_key]['days_set'].add(
                        row.report_date.strftime('%Y-%m-%d') if row.report_date else ''
                    )
                    consolidated_map[bucket_key]['quantity'] += int(row.daily_qty or 0)
                    consolidated_map[bucket_key]['gross_sales'] += float(row.daily_gross_sales or 0.0)
                    consolidated_map[bucket_key]['discount'] += float(row.daily_discount or 0.0)
                    consolidated_map[bucket_key]['net_sales'] += float(row.daily_net_sales or 0.0)

                table_rows = sorted(
                    [
                        {
                            'cluster_name': payload['cluster_name'],
                            'store_id': payload['store_id'],
                            'store_name': payload['store_name'],
                            'product_name': payload['product_name'],
                            'in_masterlist': _normalize_product_text(payload['product_name']) in master_category_by_normalized_name,
                            'category': master_category_by_normalized_name.get(
                                _normalize_product_text(payload['product_name']),
                                'Uncategorized'
                            ),
                            'days_count': len([day for day in payload['days_set'] if day]),
                            'quantity': int(payload['quantity'] or 0),
                            'gross_sales': float(payload['gross_sales'] or 0.0),
                            'discount': float(payload['discount'] or 0.0),
                            'net_sales': float(payload['net_sales'] or 0.0),
                        }
                        for payload in consolidated_map.values()
                    ],
                    key=lambda item: (
                        (item.get('store_name') or '').lower(),
                        -int(item.get('quantity') or 0),
                        (item.get('product_name') or '').lower(),
                    ),
                )

                for row in table_rows:
                    qty = int(row['quantity'] or 0)
                    gross_sales = float(row['gross_sales'] or 0.0)
                    discount = float(row['discount'] or 0.0)
                    net_sales = float(row['net_sales'] or 0.0)

                    distinct_store_ids.add(int(row['store_id']))
                    total_qty += qty
                    total_gross_sales += gross_sales
                    total_discount += discount
                    total_net_sales += net_sales

                category_totals = {}
                for row in table_rows:
                    category_name = ((row.get('category') or '').strip() or 'Uncategorized')
                    bucket = category_totals.get(category_name)
                    if not bucket:
                        parts = [part for part in category_name.replace('-', ' ').split() if part]
                        if len(parts) >= 2:
                            short_name = ''.join(part[0] for part in parts[:3]).upper()
                        else:
                            short_name = category_name[:4].upper()
                        bucket = {
                            'category': category_name,
                            'short': short_name or 'UNC',
                            'rows': 0,
                            'quantity': 0,
                            'net_sales': 0.0,
                        }
                        category_totals[category_name] = bucket
                    bucket['rows'] += 1
                    bucket['quantity'] += int(row.get('quantity') or 0)
                    bucket['net_sales'] += float(row.get('net_sales') or 0.0)

                category_metrics = sorted(
                    category_totals.values(),
                    key=lambda item: (-int(item.get('quantity') or 0), (item.get('category') or '').lower())
                )

                can_show_results = True

    return render_template(
        'admin/pos_sold.html',
        user=current_user,
        active_tab=active_tab,
        clusters=clusters,
        stores=stores,
        stores_for_selected_cluster=stores_for_selected_cluster,
        apply_filter=apply_filter,
        can_show_results=can_show_results,
        selected_cluster_id=selected_cluster_id,
        selected_store_id=selected_store_id,
        review_store_id=review_store_id,
        review_date=review_date_value,
        review_report=review_report,
        review_rows=review_rows,
        review_summary=review_summary,
        start_date=start_date_value,
        end_date=end_date_value,
        rows=table_rows,
        category_metrics=category_metrics if can_show_results else [],
        summary={
            'rows_count': len(table_rows),
            'stores_count': len(distinct_store_ids),
            'total_qty': total_qty,
            'total_gross_sales': total_gross_sales,
            'total_discount': total_discount,
            'total_net_sales': total_net_sales,
        },
    )


@admin.route('/admin/pos-sold/<int:pos_sold_id>/delete', methods=['POST'])
@login_required
def delete_pos_sold_entry(pos_sold_id):
    if current_user.role not in ('Superadmin', 'Admin', 'General Manager'):
        flash('Access denied.', category='error')
        return redirect(url_for('views.home'))

    pos_item = PosSold.query.get_or_404(pos_sold_id)
    report = DailyReport.query.get(pos_item.daily_report_id)
    review_store_id = request.form.get('review_store_id', type=int)
    review_date = (request.form.get('review_date') or '').strip()
    admin_password = request.form.get('admin_password') or ''
    redirect_params = {'tab': 'review'}
    if review_store_id:
        redirect_params['review_store_id'] = review_store_id
    if review_date:
        redirect_params['review_date'] = review_date

    if not admin_password or not check_password_hash(current_user.password or '', admin_password):
        flash('Admin password is incorrect. Delete was cancelled.', category='error')
        return redirect(url_for('admin.pos_sold', **redirect_params))

    try:
        details = {
            'pos_sold_id': pos_item.id,
            'daily_report_id': pos_item.daily_report_id,
            'store_id': report.store_id if report else None,
            'report_date': report.report_date.strftime('%Y-%m-%d') if report and report.report_date else None,
            'product_name': pos_item.product_name,
            'quantity': pos_item.quantity,
            'gross_sales': pos_item.gross_sales,
            'discount': pos_item.discount,
            'net_sales': pos_item.net_sales,
        }
        db.session.delete(pos_item)
        log_audit_event(
            action='admin.pos_sold.delete',
            entity_type='PosSold',
            entity_id=pos_sold_id,
            reason='Admin deleted POS Sold entry from store/date review.',
            details=details,
        )
        db.session.commit()
        flash('POS Sold entry deleted successfully.', category='success')
    except Exception as exc:
        db.session.rollback()
        flash(f'Error deleting POS Sold entry: {exc}', category='error')

    return redirect(url_for('admin.pos_sold', **redirect_params))


@admin.route('/admin/pos-sold/<int:pos_sold_id>/edit', methods=['POST'])
@login_required
def edit_pos_sold_entry(pos_sold_id):
    if current_user.role not in ('Superadmin', 'Admin', 'General Manager'):
        flash('Access denied.', category='error')
        return redirect(url_for('views.home'))

    pos_item = PosSold.query.get_or_404(pos_sold_id)
    report = DailyReport.query.get(pos_item.daily_report_id)
    review_store_id = request.form.get('review_store_id', type=int)
    review_date = (request.form.get('review_date') or '').strip()
    redirect_params = {'tab': 'review'}
    if review_store_id:
        redirect_params['review_store_id'] = review_store_id
    if review_date:
        redirect_params['review_date'] = review_date

    try:
        new_quantity = max(0, int(request.form.get('quantity', 0)))
    except (TypeError, ValueError):
        flash('Please enter a valid POS Sold quantity.', category='error')
        return redirect(url_for('admin.pos_sold', **redirect_params))

    try:
        old_quantity = int(pos_item.quantity or 0)
        old_values = {
            'quantity': old_quantity,
            'gross_sales': float(pos_item.gross_sales or 0.0),
            'discount': float(pos_item.discount or 0.0),
            'net_sales': float(pos_item.net_sales or 0.0),
        }
        pos_item.quantity = new_quantity
        if old_quantity > 0:
            factor = new_quantity / old_quantity
            pos_item.gross_sales = round(old_values['gross_sales'] * factor, 2)
            pos_item.discount = round(old_values['discount'] * factor, 2)
            pos_item.net_sales = round(old_values['net_sales'] * factor, 2)
        elif new_quantity == 0:
            pos_item.gross_sales = 0.0
            pos_item.discount = 0.0
            pos_item.net_sales = 0.0

        log_audit_event(
            action='admin.pos_sold.edit',
            entity_type='PosSold',
            entity_id=pos_sold_id,
            reason='Admin edited POS Sold quantity from store/date review.',
            details={
                'pos_sold_id': pos_item.id,
                'daily_report_id': pos_item.daily_report_id,
                'store_id': report.store_id if report else None,
                'report_date': report.report_date.strftime('%Y-%m-%d') if report and report.report_date else None,
                'product_name': pos_item.product_name,
                'old': old_values,
                'new': {
                    'quantity': pos_item.quantity,
                    'gross_sales': pos_item.gross_sales,
                    'discount': pos_item.discount,
                    'net_sales': pos_item.net_sales,
                },
            },
        )
        db.session.commit()
        flash('POS Sold quantity updated successfully.', category='success')
    except Exception as exc:
        db.session.rollback()
        flash(f'Error updating POS Sold entry: {exc}', category='error')

    return redirect(url_for('admin.pos_sold', **redirect_params))


@admin.route('/admin/pos-sold/delete-all', methods=['POST'])
@login_required
def delete_all_pos_sold_entries():
    if current_user.role not in ('Superadmin', 'Admin', 'General Manager'):
        flash('Access denied.', category='error')
        return redirect(url_for('views.home'))

    review_store_id = request.form.get('review_store_id', type=int)
    review_date_raw = (request.form.get('review_date') or '').strip()
    admin_password = request.form.get('admin_password') or ''
    redirect_params = {'tab': 'review'}
    if review_store_id:
        redirect_params['review_store_id'] = review_store_id
    if review_date_raw:
        redirect_params['review_date'] = review_date_raw

    if not admin_password or not check_password_hash(current_user.password or '', admin_password):
        flash('Admin password is incorrect. Delete All was cancelled.', category='error')
        return redirect(url_for('admin.pos_sold', **redirect_params))

    try:
        review_date = datetime.strptime(review_date_raw, '%Y-%m-%d').date()
    except (TypeError, ValueError):
        flash('Please select a valid review date before deleting all POS Sold entries.', category='error')
        return redirect(url_for('admin.pos_sold', **redirect_params))

    report = DailyReport.query.filter_by(
        store_id=review_store_id,
        report_date=review_date,
    ).first()
    if not report:
        flash('No daily report found for the selected store/date.', category='error')
        return redirect(url_for('admin.pos_sold', **redirect_params))

    pos_items = PosSold.query.filter_by(daily_report_id=report.id).all()
    if not pos_items:
        flash('No POS Sold entries found to delete.', category='info')
        return redirect(url_for('admin.pos_sold', **redirect_params))

    try:
        deleted_count = len(pos_items)
        details = {
            'daily_report_id': report.id,
            'store_id': report.store_id,
            'report_date': review_date.strftime('%Y-%m-%d'),
            'deleted_count': deleted_count,
            'total_qty': sum(int(item.quantity or 0) for item in pos_items),
            'total_gross_sales': sum(float(item.gross_sales or 0.0) for item in pos_items),
            'total_discount': sum(float(item.discount or 0.0) for item in pos_items),
            'total_net_sales': sum(float(item.net_sales or 0.0) for item in pos_items),
        }
        for item in pos_items:
            db.session.delete(item)
        log_audit_event(
            action='admin.pos_sold.delete_all',
            entity_type='DailyReport',
            entity_id=report.id,
            reason='Admin deleted all POS Sold entries from store/date review.',
            details=details,
        )
        db.session.commit()
        flash(f'Deleted {deleted_count} POS Sold entries for the selected store/date.', category='success')
    except Exception as exc:
        db.session.rollback()
        flash(f'Error deleting POS Sold entries: {exc}', category='error')

    return redirect(url_for('admin.pos_sold', **redirect_params))


def _clear_delivery_from_inventory_for_rso_records(store_id, report_date, rso_records):
    inventory = DailyEndingInventory.query.filter_by(
        store_id=store_id,
        inventory_date=report_date,
    ).first()
    if not inventory or not rso_records:
        return 0

    from .views import _match_rso_to_inventory

    alias_lookup = {
        str(normalized_alias or '').strip(): int(product_master_id)
        for normalized_alias, product_master_id in (
            db.session.query(ProductAlias.normalized_alias, ProductAlias.product_master_id)
            .all()
        )
        if str(normalized_alias or '').strip()
    }
    items = DailyEndingInventoryItem.query.filter_by(inventory_id=inventory.id).all()
    cleared_count = 0
    for item in items:
        if not item.product_master_id:
            continue
        product = ProductMaster.query.get(item.product_master_id)
        if not product:
            continue
        if any(_match_rso_to_inventory(rso_record, product, alias_lookup) for rso_record in rso_records):
            item.delivery_qty = 0
            item.delivery_reviewed_date = None
            cleared_count += 1
    return cleared_count


@admin.route('/admin/delivery')
@login_required
def delivery():
    if current_user.role not in ('Superadmin', 'Admin', 'General Manager'):
        flash('Access denied. Only Admins, Superadmins, and General Managers can access this page.', category='error')
        return redirect(url_for('views.home'))

    from .views import _apply_store_scope_filter

    active_tab = (request.args.get('tab') or 'consolidated').strip()
    if active_tab not in ('consolidated', 'review'):
        active_tab = 'consolidated'
    apply_filter = (request.args.get('apply') or '').strip() == '1'
    selected_cluster_id = request.args.get('cluster_id', type=int)
    selected_store_id = request.args.get('store_id', type=int)
    review_store_id = request.args.get('review_store_id', type=int)
    today = datetime.today().date()
    default_start_date_str = today.replace(day=1).strftime('%Y-%m-%d')
    start_date_raw = (request.args.get('start_date') or default_start_date_str).strip()
    end_date_raw = (request.args.get('end_date') or '').strip()
    review_date_raw = (request.args.get('review_date') or today.strftime('%Y-%m-%d')).strip()

    clusters = Cluster.query.order_by(Cluster.name.asc()).all()
    cluster_lookup = {int(cluster.id): cluster for cluster in clusters}
    stores = _apply_store_scope_filter(Store.query.order_by(Store.name.asc()).all(), request)
    stores_for_selected_cluster = [
        store for store in stores if selected_cluster_id and int(store.cluster_id or 0) == int(selected_cluster_id)
    ] if selected_cluster_id else []

    table_rows = []
    distinct_store_ids = set()
    total_qty = 0
    total_received_qty = 0
    review_rows = []
    review_summary = {
        'rows_count': 0,
        'total_qty': 0,
        'total_received_qty': 0,
    }
    start_date_value = start_date_raw
    end_date_value = end_date_raw
    can_show_results = False

    def _parse_iso_date(value):
        if not value:
            return None
        try:
            return datetime.strptime(value, '%Y-%m-%d').date()
        except (TypeError, ValueError):
            return None

    review_date = _parse_iso_date(review_date_raw) or today
    review_date_value = review_date.strftime('%Y-%m-%d')
    if active_tab == 'review' and review_store_id:
        review_store = Store.query.get(review_store_id)
        if not review_store:
            flash('Selected review store does not exist.', category='error')
            review_store_id = None
        else:
            review_rows = (
                RsoDelivery.query
                .filter_by(store_id=review_store_id, report_date=review_date)
                .order_by(RsoDelivery.rso_no.asc(), RsoDelivery.product_name.asc(), RsoDelivery.id.asc())
                .all()
            )
            review_summary = {
                'rows_count': len(review_rows),
                'total_qty': sum(int(row.quantity or 0) for row in review_rows),
                'total_received_qty': sum(int(row.received_quantity if row.received_quantity is not None else row.quantity or 0) for row in review_rows),
            }

    if apply_filter:
        if not selected_cluster_id:
            flash('Please select a cluster first.', category='error')
        elif selected_cluster_id not in cluster_lookup:
            flash('Selected cluster does not exist.', category='error')
            selected_cluster_id = None
        else:
            start_date = _parse_iso_date(start_date_raw)
            end_date = _parse_iso_date(end_date_raw)
            if not start_date or not end_date:
                flash('Please select valid start and end dates.', category='error')
            else:
                if start_date > end_date:
                    start_date, end_date = end_date, start_date
                start_date_value = start_date.strftime('%Y-%m-%d')
                end_date_value = end_date.strftime('%Y-%m-%d')

                allowed_store_ids = {int(store.id) for store in stores_for_selected_cluster}
                if selected_store_id and selected_store_id not in allowed_store_ids:
                    flash('Selected store does not belong to the chosen cluster.', category='error')
                    selected_store_id = None

                delivery_query = (
                    db.session.query(
                        Store.id.label('store_id'),
                        Store.name.label('store_name'),
                        Cluster.name.label('cluster_name'),
                        RsoDelivery.product_name.label('product_name'),
                        RsoDelivery.report_date.label('report_date'),
                        RsoDelivery.upload_source.label('upload_source'),
                        func.count(RsoDelivery.id).label('entry_count'),
                        func.sum(RsoDelivery.quantity).label('total_qty'),
                        func.sum(func.coalesce(RsoDelivery.received_quantity, RsoDelivery.quantity)).label('total_received_qty'),
                        func.max(case((RsoDelivery.rso_no == 'Manual Entry', 1), else_=0)).label('manual_entry_count'),
                        func.max(RsoDelivery.manual_note).label('manual_note'),
                    )
                    .join(Store, Store.id == RsoDelivery.store_id)
                    .outerjoin(Cluster, Cluster.id == Store.cluster_id)
                    .filter(
                        Store.cluster_id == selected_cluster_id,
                        RsoDelivery.report_date >= start_date,
                        RsoDelivery.report_date <= end_date,
                    )
                )
                if selected_store_id:
                    delivery_query = delivery_query.filter(Store.id == selected_store_id)

                delivery_rows = (
                    delivery_query
                    .group_by(Store.id, Store.name, Cluster.name, RsoDelivery.product_name, RsoDelivery.report_date, RsoDelivery.upload_source)
                    .order_by(Store.name.asc(), RsoDelivery.report_date.asc(), RsoDelivery.product_name.asc())
                    .all()
                )
                table_rows = [
                    {
                        'cluster_name': row.cluster_name or 'Unassigned',
                        'store_id': int(row.store_id),
                        'store_name': row.store_name or f'Store {row.store_id}',
                        'report_date': row.report_date,
                        'product_name': (row.product_name or '').strip() or 'Unnamed Product',
                        'upload_source': row.upload_source or 'delivery',
                        'has_manual': bool(row.manual_entry_count),
                        'manual_note': row.manual_note,
                        'entry_count': int(row.entry_count or 0),
                        'quantity': int(row.total_qty or 0),
                        'received_quantity': int(row.total_received_qty or 0),
                    }
                    for row in delivery_rows
                ]
                for row in table_rows:
                    distinct_store_ids.add(int(row['store_id']))
                    total_qty += int(row['quantity'] or 0)
                    total_received_qty += int(row['received_quantity'] or 0)
                can_show_results = True

    return render_template(
        'admin/delivery.html',
        user=current_user,
        active_tab=active_tab,
        clusters=clusters,
        stores=stores,
        stores_for_selected_cluster=stores_for_selected_cluster,
        apply_filter=apply_filter,
        can_show_results=can_show_results,
        selected_cluster_id=selected_cluster_id,
        selected_store_id=selected_store_id,
        review_store_id=review_store_id,
        review_date=review_date_value,
        review_rows=review_rows,
        review_summary=review_summary,
        start_date=start_date_value,
        end_date=end_date_value,
        rows=table_rows,
        summary={
            'rows_count': len(table_rows),
            'stores_count': len(distinct_store_ids),
            'total_qty': total_qty,
            'total_received_qty': total_received_qty,
        },
    )


@admin.route('/admin/delivery/<int:delivery_id>/delete', methods=['POST'])
@login_required
def delete_delivery_entry(delivery_id):
    if current_user.role not in ('Superadmin', 'Admin', 'General Manager'):
        flash('Access denied.', category='error')
        return redirect(url_for('views.home'))

    delivery_item = RsoDelivery.query.get_or_404(delivery_id)
    review_store_id = request.form.get('review_store_id', type=int)
    review_date = (request.form.get('review_date') or '').strip()
    admin_password = request.form.get('admin_password') or ''
    redirect_params = {'tab': 'review'}
    if review_store_id:
        redirect_params['review_store_id'] = review_store_id
    if review_date:
        redirect_params['review_date'] = review_date

    if not admin_password or not check_password_hash(current_user.password or '', admin_password):
        flash('Admin password is incorrect. Delete was cancelled.', category='error')
        return redirect(url_for('admin.delivery', **redirect_params))

    try:
        details = {
            'delivery_id': delivery_item.id,
            'store_id': delivery_item.store_id,
            'report_date': delivery_item.report_date.strftime('%Y-%m-%d') if delivery_item.report_date else None,
            'rso_no': delivery_item.rso_no,
            'product_name': delivery_item.product_name,
            'quantity': delivery_item.quantity,
            'received_quantity': delivery_item.received_quantity,
            'upload_source': delivery_item.upload_source,
        }
        cleared_count = _clear_delivery_from_inventory_for_rso_records(
            delivery_item.store_id,
            delivery_item.report_date,
            [delivery_item],
        )
        details['inventory_items_cleared'] = cleared_count
        db.session.delete(delivery_item)
        log_audit_event(
            action='admin.delivery.delete',
            entity_type='RsoDelivery',
            entity_id=delivery_id,
            reason='Admin deleted Delivery entry from store/date review.',
            details=details,
        )
        db.session.commit()
        flash('Delivery entry deleted successfully.', category='success')
    except Exception as exc:
        db.session.rollback()
        flash(f'Error deleting Delivery entry: {exc}', category='error')

    return redirect(url_for('admin.delivery', **redirect_params))


@admin.route('/admin/delivery/<int:delivery_id>/edit', methods=['POST'])
@login_required
def edit_delivery_entry(delivery_id):
    if current_user.role not in ('Superadmin', 'Admin', 'General Manager'):
        flash('Access denied.', category='error')
        return redirect(url_for('views.home'))

    delivery_item = RsoDelivery.query.get_or_404(delivery_id)
    review_store_id = request.form.get('review_store_id', type=int)
    review_date = (request.form.get('review_date') or '').strip()
    redirect_params = {'tab': 'review'}
    if review_store_id:
        redirect_params['review_store_id'] = review_store_id
    if review_date:
        redirect_params['review_date'] = review_date

    try:
        new_quantity = max(0, int(request.form.get('quantity', 0)))
        received_raw = (request.form.get('received_quantity') or '').strip()
        new_received_quantity = max(0, int(received_raw)) if received_raw else None
    except (TypeError, ValueError):
        flash('Please enter valid Delivery quantities.', category='error')
        return redirect(url_for('admin.delivery', **redirect_params))

    try:
        old_values = {
            'quantity': int(delivery_item.quantity or 0),
            'received_quantity': delivery_item.received_quantity,
        }
        delivery_item.quantity = new_quantity
        delivery_item.received_quantity = new_received_quantity
        log_audit_event(
            action='admin.delivery.edit',
            entity_type='RsoDelivery',
            entity_id=delivery_id,
            reason='Admin edited Delivery quantity from store/date review.',
            details={
                'delivery_id': delivery_item.id,
                'store_id': delivery_item.store_id,
                'report_date': delivery_item.report_date.strftime('%Y-%m-%d') if delivery_item.report_date else None,
                'rso_no': delivery_item.rso_no,
                'product_name': delivery_item.product_name,
                'old': old_values,
                'new': {
                    'quantity': delivery_item.quantity,
                    'received_quantity': delivery_item.received_quantity,
                },
            },
        )
        db.session.commit()
        flash('Delivery quantity updated successfully.', category='success')
    except Exception as exc:
        db.session.rollback()
        flash(f'Error updating Delivery entry: {exc}', category='error')

    return redirect(url_for('admin.delivery', **redirect_params))


@admin.route('/admin/delivery/delete-all', methods=['POST'])
@login_required
def delete_all_delivery_entries():
    if current_user.role not in ('Superadmin', 'Admin', 'General Manager'):
        flash('Access denied.', category='error')
        return redirect(url_for('views.home'))

    review_store_id = request.form.get('review_store_id', type=int)
    review_date_raw = (request.form.get('review_date') or '').strip()
    admin_password = request.form.get('admin_password') or ''
    redirect_params = {'tab': 'review'}
    if review_store_id:
        redirect_params['review_store_id'] = review_store_id
    if review_date_raw:
        redirect_params['review_date'] = review_date_raw

    if not admin_password or not check_password_hash(current_user.password or '', admin_password):
        flash('Admin password is incorrect. Delete All was cancelled.', category='error')
        return redirect(url_for('admin.delivery', **redirect_params))

    try:
        review_date = datetime.strptime(review_date_raw, '%Y-%m-%d').date()
    except (TypeError, ValueError):
        flash('Please select a valid review date before deleting all Delivery entries.', category='error')
        return redirect(url_for('admin.delivery', **redirect_params))

    delivery_items = RsoDelivery.query.filter_by(
        store_id=review_store_id,
        report_date=review_date,
    ).all()
    if not delivery_items:
        flash('No Delivery entries found to delete.', category='info')
        return redirect(url_for('admin.delivery', **redirect_params))

    try:
        deleted_count = len(delivery_items)
        details = {
            'store_id': review_store_id,
            'report_date': review_date.strftime('%Y-%m-%d'),
            'deleted_count': deleted_count,
            'total_qty': sum(int(item.quantity or 0) for item in delivery_items),
            'total_received_qty': sum(int(item.received_quantity if item.received_quantity is not None else item.quantity or 0) for item in delivery_items),
        }
        cleared_count = _clear_delivery_from_inventory_for_rso_records(
            review_store_id,
            review_date,
            delivery_items,
        )
        details['inventory_items_cleared'] = cleared_count
        for item in delivery_items:
            db.session.delete(item)
        log_audit_event(
            action='admin.delivery.delete_all',
            entity_type='Store',
            entity_id=review_store_id,
            reason='Admin deleted all Delivery entries from store/date review.',
            details=details,
        )
        db.session.commit()
        flash(f'Deleted {deleted_count} Delivery entries for the selected store/date.', category='success')
    except Exception as exc:
        db.session.rollback()
        flash(f'Error deleting Delivery entries: {exc}', category='error')

    return redirect(url_for('admin.delivery', **redirect_params))


@admin.route('/admin/maintenance-mode', methods=['POST'])
@login_required
def toggle_maintenance_mode():
    if current_user.role not in ('Superadmin', 'Admin'):
        flash('Access denied.', category='error')
        return redirect(url_for('views.home'))

    try:
        mode = MaintenanceMode.query.first()
        if not mode:
            mode = MaintenanceMode(is_enabled=False)
            db.session.add(mode)
        mode.is_enabled = not bool(mode.is_enabled)
        mode.message = (request.form.get('message') or '').strip() or 'We are currently improving the system. Please check back shortly.'
        mode.updated_by = current_user.id
        log_audit_event(
            action='system.maintenance.toggle',
            entity_type='MaintenanceMode',
            entity_id=mode.id or 'global',
            reason='Admin changed system maintenance mode.',
            details={'is_enabled': mode.is_enabled, 'message': mode.message},
        )
        db.session.commit()
        flash(f'Maintenance Mode {"enabled" if mode.is_enabled else "disabled"}.', category='success')
    except Exception as exc:
        db.session.rollback()
        flash(f'Unable to change Maintenance Mode: {str(exc)}', category='error')
    return redirect(request.referrer or url_for('admin.dashboard'))


@admin.route('/admin/dashboard')
@login_required
def dashboard():
    if current_user.role not in ('Superadmin', 'Admin', 'General Manager'):
        flash('Access denied. Only Admins, Superadmins, and General Managers can access this page.', category='error')
        return redirect(url_for('views.home'))

    month_arg = request.args.get('month')
    year_arg = request.args.get('year')
    start_date_arg = request.args.get('start_date')
    end_date_arg = request.args.get('end_date')

    def _parse_iso_date(value):
        if not value:
            return None
        try:
            return datetime.strptime(value, '%Y-%m-%d').date()
        except (TypeError, ValueError):
            return None

    parsed_start_date = _parse_iso_date(start_date_arg)
    parsed_end_date = _parse_iso_date(end_date_arg)

    today = datetime.today().date()

    if parsed_start_date or parsed_end_date:
        start_date = parsed_start_date or parsed_end_date
        end_date = parsed_end_date or parsed_start_date
        if start_date > end_date:
            start_date, end_date = end_date, start_date
        year_int = int(start_date.year)
        month_int = int(start_date.month)
    else:
        # Default dashboard filter: first day of current month up to today.
        today = datetime.today().date()
        start_date = today.replace(day=1)
        end_date = today
        year_int = int(start_date.year)
        month_int = int(start_date.month)

    current_month = f'{month_int:02d}'
    current_year = str(year_int)

    from .views import (
        _aggregate_targets_by_day,
        _apply_pos_qty_from_pos_categories,
        _apply_store_scope_filter,
        _build_cluster_manager_summary,
        _build_discount_performance,
        _build_wastage_performance,
        _build_ytd_overview,
        _classify_store_status,
        _format_header_date,
        _get_store_scope_from_request,
    )
    from types import SimpleNamespace

    clusters = Cluster.query.order_by(Cluster.name.asc()).all()
    all_stores = Store.query.all()
    store_scope = _get_store_scope_from_request(request)
    stores = _apply_store_scope_filter(all_stores, request)
    dashboard_store_ids = [int(store.id) for store in stores]
    stores_by_cluster = {}
    store_to_cluster = {}
    for store in stores:
        if store.cluster_id:
            stores_by_cluster.setdefault(store.cluster_id, []).append(store)
            store_to_cluster[store.id] = store.cluster_id

    reports = DailyReport.query.filter(
        DailyReport.store_id.in_(dashboard_store_ids),
        DailyReport.report_date >= start_date,
        DailyReport.report_date <= end_date,
        DailyReport.status == 'Approved',
    ).all()
    _apply_pos_qty_from_pos_categories(reports)

    def _format_tracker_date_range(range_start, range_end):
        if range_start == range_end:
            return f"{range_start.strftime('%b')} {range_start.day}, {range_start.year}"
        if range_start.year == range_end.year and range_start.month == range_end.month:
            return f"{range_start.strftime('%b')} {range_start.day}-{range_end.day}, {range_start.year}"
        if range_start.year == range_end.year:
            return f"{range_start.strftime('%b')} {range_start.day} - {range_end.strftime('%b')} {range_end.day}, {range_start.year}"
        return f"{range_start.strftime('%b')} {range_start.day}, {range_start.year} - {range_end.strftime('%b')} {range_end.day}, {range_end.year}"

    def _summarize_missing_dates(missing_dates):
        if not missing_dates:
            return []
        missing_dates = sorted(missing_dates)
        ranges = []
        range_start = missing_dates[0]
        previous = missing_dates[0]
        for missing_date in missing_dates[1:]:
            if missing_date == previous + timedelta(days=1):
                previous = missing_date
                continue
            ranges.append(_format_tracker_date_range(range_start, previous))
            range_start = missing_date
            previous = missing_date
        ranges.append(_format_tracker_date_range(range_start, previous))
        return ranges

    expected_dates = []
    tracker_end_date = min(end_date, today - timedelta(days=1))
    tracker_cursor = start_date
    while tracker_cursor <= tracker_end_date:
        expected_dates.append(tracker_cursor)
        tracker_cursor += timedelta(days=1)

    dashboard_store_count = len(dashboard_store_ids)
    daily_report_dates_by_store = {}
    if dashboard_store_ids:
        daily_report_date_rows = (
            db.session.query(DailyReport.store_id, DailyReport.report_date)
            .filter(
                DailyReport.store_id.in_(dashboard_store_ids),
                DailyReport.report_date >= start_date,
                DailyReport.report_date <= end_date,
            )
            .distinct()
            .all()
        )
        for store_id, report_date in daily_report_date_rows:
            if store_id and report_date:
                daily_report_dates_by_store.setdefault(int(store_id), set()).add(report_date)

    invensync_dates_by_store = {}
    if dashboard_store_ids:
        invensync_date_rows = (
            db.session.query(DailyEndingInventory.store_id, DailyEndingInventory.inventory_date)
            .filter(
                DailyEndingInventory.store_id.in_(dashboard_store_ids),
                DailyEndingInventory.inventory_date >= start_date,
                DailyEndingInventory.inventory_date <= end_date,
                DailyEndingInventory.is_finalized.is_(True),
            )
            .distinct()
            .all()
        )
        for store_id, inventory_date in invensync_date_rows:
            if store_id and inventory_date:
                invensync_dates_by_store.setdefault(int(store_id), set()).add(inventory_date)

    def _build_missing_tool_rows(date_map):
        rows = []
        for store in sorted(stores, key=lambda item: (item.name or '').lower()):
            available_dates = date_map.get(int(store.id), set())
            missing_dates = [expected_date for expected_date in expected_dates if expected_date not in available_dates]
            if not missing_dates:
                continue
            rows.append({
                'store_name': store.name,
                'missing_count': len(missing_dates),
                'date_ranges': _summarize_missing_dates(missing_dates),
            })
        return rows

    daily_report_missing_rows = _build_missing_tool_rows(daily_report_dates_by_store)
    invensync_missing_rows = _build_missing_tool_rows(invensync_dates_by_store)
    daily_report_store_count = dashboard_store_count - len(daily_report_missing_rows)
    invensync_store_count = dashboard_store_count - len(invensync_missing_rows)
    oracle_store_count = (
        db.session.query(StoreProductBuffer.store_id)
        .filter(StoreProductBuffer.store_id.in_(dashboard_store_ids))
        .distinct()
        .count()
        if dashboard_store_ids else 0
    )
    icount_tool_tracker = {
        'total_stores': dashboard_store_count,
        'daily_reports': {
            'label': 'Daily Reports',
            'count': daily_report_store_count,
            'subtitle': 'stores with complete uploads',
            'missing_rows': daily_report_missing_rows,
            'show_missing_details': True,
        },
        'invensync': {
            'label': 'Invensync',
            'count': invensync_store_count,
            'subtitle': 'stores with complete updates',
            'missing_rows': invensync_missing_rows,
            'show_missing_details': True,
        },
        'oracle': {
            'label': 'Oracle',
            'count': oracle_store_count,
            'subtitle': 'stores with Oracle buffer setup',
            'missing_rows': [],
            'show_missing_details': False,
        },
    }

    targets = StoreTarget.query.filter(
        StoreTarget.store_id.in_(dashboard_store_ids),
        StoreTarget.target_date >= start_date,
        StoreTarget.target_date <= end_date
    ).all()

    # Daily trend data for the selected range (consolidated across clusters).
    daily_targets = _aggregate_targets_by_day(targets)
    daily_sales_map = {}
    sbase_store_ids = {int(s.id) for s in stores if bool(getattr(s, 'is_one_year_already', False))}
    daily_sbase_sales_map = {}
    for report in reports:
        date_key = report.report_date.strftime('%Y-%m-%d')
        report_net_sales = float(report.pos_net_sales or 0) + float(report.ci_regular_net_sales or 0)
        daily_sales_map[date_key] = float(daily_sales_map.get(date_key, 0.0) or 0.0) + report_net_sales
        if int(report.store_id) in sbase_store_ids:
            daily_sbase_sales_map[date_key] = float(daily_sbase_sales_map.get(date_key, 0.0) or 0.0) + report_net_sales

    acc_daily_targets = {}
    acc_daily_sales = {}
    mtd_metrics_by_day = {}
    sales_data = []
    sbase_sales_data = []
    target_data = []
    last_year_data = []
    labels = []
    running_sales = 0.0
    running_target = 0.0
    running_ly = 0.0
    running_gbi = 0.0
    cursor = start_date
    while cursor <= end_date:
        date_key = cursor.strftime('%Y-%m-%d')
        day_sales = float(daily_sales_map.get(date_key, 0.0) or 0.0)
        day_sbase_sales = float(daily_sbase_sales_map.get(date_key, 0.0) or 0.0)
        day_target = float(daily_targets.get(date_key, {}).get('target_net', 0.0) or 0.0)
        day_ly = float(daily_targets.get(date_key, {}).get('last_year_net', 0.0) or 0.0)
        day_gbi = float(daily_targets.get(date_key, {}).get('gbi_target', 0.0) or 0.0)

        running_sales += day_sales
        running_target += day_target
        running_ly += day_ly
        running_gbi += day_gbi

        sales_data.append(day_sales)
        sbase_sales_data.append(day_sbase_sales)
        target_data.append(day_target)
        last_year_data.append(day_ly)
        labels.append(cursor.strftime('%b %d'))

        acc_daily_sales[date_key] = {'net_sales': running_sales}
        acc_daily_targets[date_key] = {
            'target_net': running_target,
            'last_year_net': running_ly,
            'gbi_target': running_gbi,
        }
        mtd_metrics_by_day[date_key] = {
            'mtd_vs_tgt': (((running_sales / running_target) - 1.0) * 100) if running_target > 0 else None,
            'mtd_vs_ly': (((running_sales / running_ly) - 1.0) * 100) if running_ly > 0 else None,
        }

        cursor += timedelta(days=1)

    summary = _build_cluster_manager_summary(reports, targets)
    wastage_performance = _build_wastage_performance(
        reports,
        start_date,
        end_date,
        store_lookup={int(store.id): store.name for store in stores},
    )
    discount_performance = _build_discount_performance(reports, start_date, end_date)
    ytd_overview = _build_ytd_overview(
        end_date,
        store_ids=[int(store.id) for store in stores],
    )
    summary.setdefault('overview', {}).update(ytd_overview)
    top_products = _build_top_products_from_reports(reports)
    top_products_total_units = sum(item['units'] for item in top_products)

    # Product mix toggles, but grouped per cluster.
    cluster_product_mix_map = {
        cluster.id: {
            'store_id': cluster.id,
            'store_name': cluster.name,
            'segments': [],
            'products_map': {},
            'products': [],
            'total_units': 0,
        }
        for cluster in clusters
    }
    cluster_pos_sold_map = {
        cluster.id: {
            'store_id': cluster.id,
            'store_name': cluster.name,
            'products_map': {},
            'products': [],
            'total_units': 0,
        }
        for cluster in clusters
    }
    category_totals_by_cluster = {}
    palette = [
        '#6366f1', '#10b981', '#f59e0b', '#e11d48', '#0ea5e9',
        '#14b8a6', '#84cc16', '#f97316', '#8b5cf6', '#64748b',
    ]

    product_masters = (
        ProductMaster.query
        .with_entities(ProductMaster.description, ProductMaster.category)
        .all()
    )
    master_rows = [
        (
            _normalize_product_text(description),
            (category or '').strip() or 'Uncategorized',
        )
        for description, category in product_masters
    ]
    category_cache = {}
    alias_lookup = _get_product_alias_lookup()

    def _resolve_product_category(product_name, similarity_threshold=0.90):
        normalized_name = _normalize_product_text(product_name)
        if not normalized_name:
            return 'Uncategorized'
        if normalized_name in category_cache:
            return category_cache[normalized_name]

        best_score = 0.0
        best_category = 'Uncategorized'
        for normalized_master, master_category in master_rows:
            if not normalized_master:
                continue
            if normalized_name == normalized_master:
                category_cache[normalized_name] = master_category
                return master_category
            similarity = SequenceMatcher(None, normalized_name, normalized_master).ratio()
            if similarity > best_score:
                best_score = similarity
                best_category = master_category

        resolved = best_category if best_score >= similarity_threshold else 'Uncategorized'
        category_cache[normalized_name] = resolved
        return resolved

    report_ids = [int(report.id) for report in reports if getattr(report, 'id', None)]
    if report_ids:
        pos_rows = (
            db.session.query(
                DailyReport.store_id,
                PosSold.product_name,
                func.sum(PosSold.quantity).label('total_qty'),
                func.sum(PosSold.net_sales).label('total_net_sales'),
            )
            .join(DailyReport, DailyReport.id == PosSold.daily_report_id)
            .filter(PosSold.daily_report_id.in_(report_ids))
            .group_by(DailyReport.store_id, PosSold.product_name)
            .all()
        )

        for store_id, product_name, total_qty, total_net_sales in pos_rows:
            cluster_id = store_to_cluster.get(int(store_id))
            if not cluster_id or cluster_id not in cluster_pos_sold_map:
                continue
            qty = int(total_qty or 0)
            if qty <= 0:
                continue
            clean_name = (product_name or '').strip() or 'Unnamed Product'
            if _is_grand_total_product_name(clean_name):
                continue
            canonical_name = alias_lookup.get(_normalize_product_text(clean_name), clean_name)
            resolved_category = _resolve_product_category(canonical_name, similarity_threshold=0.90)
            product_key = f"{_normalize_product_text(canonical_name)}|{_normalize_product_text(resolved_category)}"
            net_sales_value = float(total_net_sales or 0.0)

            category_totals = category_totals_by_cluster.setdefault(cluster_id, {})
            category_totals[resolved_category] = int(category_totals.get(resolved_category, 0) or 0) + qty

            mix_product_bucket = cluster_product_mix_map[cluster_id]['products_map']
            mix_existing = mix_product_bucket.get(product_key) or {
                'name': canonical_name,
                'qty': 0,
                'net_sales': 0.0,
                'category': resolved_category,
            }
            mix_existing['qty'] = int(mix_existing.get('qty', 0) or 0) + qty
            mix_existing['net_sales'] = float(mix_existing.get('net_sales', 0.0) or 0.0) + net_sales_value
            if not mix_existing.get('category'):
                mix_existing['category'] = resolved_category
            mix_product_bucket[product_key] = mix_existing

            product_bucket = cluster_pos_sold_map[cluster_id]['products_map']
            existing = product_bucket.get(product_key) or {
                'name': canonical_name,
                'qty': 0,
                'net_sales': 0.0,
                'category': resolved_category,
            }
            existing['qty'] = int(existing.get('qty', 0) or 0) + qty
            existing['net_sales'] = float(existing.get('net_sales', 0.0) or 0.0) + net_sales_value
            if not existing.get('category'):
                existing['category'] = resolved_category
            product_bucket[product_key] = existing

    cluster_product_mix = []
    for cluster_id, item in cluster_product_mix_map.items():
        category_totals = category_totals_by_cluster.get(cluster_id, {})
        sorted_categories = sorted(
            category_totals.items(),
            key=lambda row: (-int(row[1] or 0), (row[0] or '').lower())
        )
        item['segments'] = [
            {
                'label': category_name,
                'value': int(category_value or 0),
                'color': palette[idx % len(palette)],
            }
            for idx, (category_name, category_value) in enumerate(sorted_categories)
        ]
        item['products'] = sorted(
            [
                {
                    'name': (payload or {}).get('name') or 'Unnamed Product',
                    'qty': int((payload or {}).get('qty', 0) or 0),
                    'net_sales': float((payload or {}).get('net_sales', 0.0) or 0.0),
                    'category': ((payload or {}).get('category') or 'Uncategorized'),
                }
                for payload in item['products_map'].values()
                if int((payload or {}).get('qty', 0) or 0) > 0
            ],
            key=lambda product: (-int(product.get('qty', 0) or 0), (product.get('name') or '').lower())
        )
        item['total_units'] = sum(int(product.get('qty', 0) or 0) for product in item['products'])
        cluster_product_mix.append({
            'store_id': item['store_id'],
            'store_name': item['store_name'],
            'segments': item['segments'],
            'products': item['products'],
            'total_units': item['total_units'],
        })
    cluster_product_mix = sorted(cluster_product_mix, key=lambda item: (item.get('store_name') or '').lower())

    cluster_pos_sold_products = []
    for item in cluster_pos_sold_map.values():
        product_rows = [
            {
                'name': (payload or {}).get('name') or 'Unnamed Product',
                'qty': int((payload or {}).get('qty', 0) or 0),
                'net_sales': float((payload or {}).get('net_sales', 0.0) or 0.0),
                'category': ((payload or {}).get('category') or 'Uncategorized'),
            }
            for _, payload in item['products_map'].items()
            if int((payload or {}).get('qty', 0) or 0) > 0
        ]
        product_rows = sorted(
            product_rows,
            key=lambda product: (-int(product.get('qty', 0) or 0), (product.get('name') or '').lower())
        )
        cluster_pos_sold_products.append({
            'store_id': item['store_id'],
            'store_name': item['store_name'],
            'products': product_rows,
            'total_units': sum(int(product.get('qty', 0) or 0) for product in product_rows),
        })
    cluster_pos_sold_products = sorted(cluster_pos_sold_products, key=lambda item: (item.get('store_name') or '').lower())

    # Per-cluster performance (reusing existing template keys).
    cluster_performance_data = []
    range_days = max((end_date - start_date).days + 1, 1)
    targets_by_store = {}
    for target in targets:
        targets_by_store.setdefault(target.store_id, []).append(target)
    reports_by_store = {}
    for report in reports:
        reports_by_store.setdefault(report.store_id, []).append(report)

    for cluster in clusters:
        cluster_store_ids = [store.id for store in stores_by_cluster.get(cluster.id, [])]
        if not cluster_store_ids:
            continue
        cluster_reports = []
        cluster_targets = []
        for store_id in cluster_store_ids:
            cluster_reports.extend(reports_by_store.get(store_id, []))
            cluster_targets.extend(targets_by_store.get(store_id, []))

        mtd_sales = sum(float(r.pos_net_sales or 0) + float(r.ci_regular_net_sales or 0) for r in cluster_reports)
        ads = mtd_sales / range_days if range_days > 0 else 0
        cluster_ly_mtd = sum(float(t.last_year_net or 0) for t in cluster_targets)
        cluster_target_mtd = sum(float(t.target_net or 0) for t in cluster_targets)
        ar_tgt_percent = (((mtd_sales / cluster_target_mtd) - 1.0) * 100) if cluster_target_mtd > 0 else 0.0
        growth_percent = ((mtd_sales / cluster_ly_mtd) - 1.0) if cluster_ly_mtd > 0 else None
        status = _classify_store_status(ar_tgt_percent, growth_percent)

        cluster_performance_data.append({
            'store_name': cluster.name,
            'act': mtd_sales,
            'target_mtd': cluster_target_mtd,
            'ads': ads,
            'ly': cluster_ly_mtd,
            'ar_tgt_percent': ar_tgt_percent,
            'growth_percent': growth_percent,
            'status': status
        })

    cluster_performance_data = sorted(cluster_performance_data, key=lambda item: (item.get('store_name') or '').lower())

    top_stores_ads = []
    sorted_by_ads = sorted(cluster_performance_data, key=lambda item: float(item.get('ads', 0) or 0), reverse=True)[:3]
    max_ads = float(sorted_by_ads[0].get('ads', 0) or 0) if sorted_by_ads else 0.0
    for rank, item in enumerate(sorted_by_ads, start=1):
        ads_value = float(item.get('ads', 0) or 0)
        top_stores_ads.append({
            'rank': rank,
            'store_name': item.get('store_name', ''),
            'ads': ads_value,
            'ads_percent': ((ads_value / max_ads) * 100) if max_ads > 0 else 0.0,
        })

    top_attainment_ar = []
    sorted_by_ar = sorted(cluster_performance_data, key=lambda item: float(item.get('ar_tgt_percent', 0) or 0), reverse=True)[:3]
    for rank, item in enumerate(sorted_by_ar, start=1):
        ar_value = float(item.get('ar_tgt_percent', 0) or 0)
        top_attainment_ar.append({
            'rank': rank,
            'store_name': item.get('store_name', ''),
            'ar_tgt_percent': ar_value,
            'target_mtd': float(item.get('target_mtd', 0) or 0),
            'act': float(item.get('act', 0) or 0),
            'delta_percent': ar_value,
            'progress_percent': min(max(ar_value + 100.0, 0.0), 100.0),
        })

    severity_order = {'ICU Critical': 0, 'Critical': 1, 'Recovery': 2, 'Good': 3, 'Excellent': 4}
    status_meta = {
        'ICU Critical': {
            'tone_card': 'bg-red-50 border-l-4 border-red-500',
            'tone_badge': 'text-red-700 bg-red-100',
            'tone_value': 'text-red-600',
            'tone_bar_bg': 'bg-red-200',
            'tone_bar_fill': 'bg-red-500',
            'note': 'Significantly below target',
        },
        'Critical': {
            'tone_card': 'bg-orange-50 border-l-4 border-orange-500',
            'tone_badge': 'text-orange-700 bg-orange-100',
            'tone_value': 'text-orange-600',
            'tone_bar_bg': 'bg-orange-200',
            'tone_bar_fill': 'bg-orange-500',
            'note': 'Below target',
        },
        'Recovery': {
            'tone_card': 'bg-amber-50 border-l-4 border-amber-500',
            'tone_badge': 'text-amber-700 bg-amber-100',
            'tone_value': 'text-amber-600',
            'tone_bar_bg': 'bg-amber-200',
            'tone_bar_fill': 'bg-amber-500',
            'note': 'Near target, monitor closely',
        },
    }

    icu_candidates = [item for item in cluster_performance_data if item.get('status') == 'ICU Critical']
    icu_candidates = sorted(
        icu_candidates,
        key=lambda item: (
            severity_order.get(item.get('status', 'Excellent'), 99),
            float(item.get('ar_tgt_percent', 0) or 0),
        )
    )[:3]

    icu_stores = []
    for item in icu_candidates:
        status = item.get('status', 'Recovery')
        meta = status_meta.get(status, status_meta['Recovery'])
        ar_percent = float(item.get('ar_tgt_percent', 0) or 0)
        attainment_percent = max(0.0, ar_percent + 100.0)
        icu_stores.append({
            'store_name': item.get('store_name', ''),
            'status': status,
            'note': meta['note'],
            'act': float(item.get('act', 0) or 0),
            'target_mtd': float(item.get('target_mtd', 0) or 0),
            'attainment_percent': attainment_percent,
            'progress_percent': min(max(attainment_percent, 0.0), 100.0),
            'tone_card': meta['tone_card'],
            'tone_badge': meta['tone_badge'],
            'tone_value': meta['tone_value'],
            'tone_bar_bg': meta['tone_bar_bg'],
            'tone_bar_fill': meta['tone_bar_fill'],
        })

    return render_template(
        'cluster_manager/cluster_dashboard.html',
        user=current_user,
        layout_template='admin_base.html',
        cluster=SimpleNamespace(name='All Clusters'),
        team_name=f'CFI {store_scope.capitalize()} Dashboard',
        dashboard_action_endpoint='admin.dashboard',
        entity_label='Cluster',
        entity_label_plural='Clusters',
        sales_data=sales_data,
        sbase_sales_data=sbase_sales_data,
        target_data=target_data,
        last_year_data=last_year_data,
        labels=labels,
        current_month=current_month,
        current_year=current_year,
        current_date=datetime.today().date(),
        selected_start_date=start_date.strftime('%Y-%m-%d'),
        selected_end_date=end_date.strftime('%Y-%m-%d'),
        selected_start_date_display=_format_header_date(start_date),
        selected_end_date_display=_format_header_date(end_date),
        store_performance_data=cluster_performance_data,
        top_stores_ads=top_stores_ads,
        top_attainment_ar=top_attainment_ar,
        mtd_metrics_by_day=mtd_metrics_by_day,
        summary=summary,
        top_products=top_products,
        top_products_total_units=top_products_total_units,
        store_product_mix=cluster_product_mix,
        pos_sold_products_by_store=cluster_pos_sold_products,
        icu_stores=icu_stores,
        wastage_performance=wastage_performance,
        discount_performance=discount_performance,
        store_scope=store_scope,
        icount_tool_tracker=icount_tool_tracker,
    )

@admin.route('admin/users')
@login_required
def users():
    if not _can_manage_users():
        flash('Access denied. Only Admin or Superadmin can access this page.', category='error')
        return redirect(url_for('views.home'))

    from .views import _apply_store_scope_filter

    q = (request.args.get('q') or '').strip()
    user_query = User.query
    if q:
        pattern = f'%{q}%'
        user_query = user_query.filter(
            or_(
                User.full_name.ilike(pattern),
                User.username.ilike(pattern),
                User.email.ilike(pattern),
                User.role.ilike(pattern),
            )
        )

    users = user_query.order_by(User.date_added.desc(), User.id.desc()).all()
    stores = _apply_store_scope_filter(Store.query.order_by(Store.name.asc()).all(), request)
    return render_template('admin/users.html', user=current_user, users=users, stores=stores, search_query=q)


@admin.route('/admin/audit-logs')
@login_required
def audit_logs():
    if current_user.role not in ('Superadmin', 'Admin'):
        flash('Access denied. Only Admin or Superadmin can access audit logs.', category='error')
        return redirect(url_for('views.home'))

    logs = AuditLog.query.order_by(AuditLog.id.desc()).limit(500).all()
    tampered_ids = verify_audit_chain()
    stats = {
        'total': len(logs),
        'tampered': sum(1 for item in logs if item.id in tampered_ids),
        'verified': sum(1 for item in logs if item.id not in tampered_ids),
        'auth_events': sum(1 for item in logs if (item.action or '').startswith('auth.')),
        'data_events': sum(1 for item in logs if (item.action or '').startswith('report.')),
        'admin_events': sum(1 for item in logs if (item.action or '').startswith('admin.')),
    }
    return render_template('admin/audit_logs.html', user=current_user, logs=logs, tampered_ids=tampered_ids, stats=stats)


@admin.route('/admin/settings')
@login_required
def settings():
    if not _can_manage_users():
        flash('Access denied.', category='error')
        return redirect(url_for('admin.dashboard'))

    pos_sold_count = PosSold.query.count()
    counts = {
        'rso': RsoDelivery.query.count() + RsoDeliveryDraft.query.count(),
        'pos_sold': pos_sold_count,
        'daily_sales': DailyReport.query.count() + pos_sold_count,
        'invensync': DailyEndingInventory.query.count() + DailyEndingInventoryItem.query.count(),
        'transfers': TafTransfer.query.count() + TafTransferItem.query.count(),
        'targets': StoreTarget.query.count(),
    }
    counts['all_operational'] = (
        counts['rso']
        + counts['daily_sales']
        + counts['invensync']
        + counts['transfers']
        + counts['targets']
    )
    return render_template(
        'admin/settings.html',
        user=current_user,
        clear_options=_CLEAR_DATA_OPTIONS,
        counts=counts,
    )


@admin.route('/admin/settings/clear-data', methods=['POST'])
@login_required
def clear_data():
    if not _can_manage_users():
        flash('Access denied.', category='error')
        return redirect(url_for('admin.dashboard'))

    dataset = (request.form.get('dataset') or '').strip()
    option = _CLEAR_DATA_OPTIONS.get(dataset)
    confirmation = (request.form.get('confirmation') or '').strip()
    if not option:
        flash('Select a valid data set.', category='error')
        return redirect(url_for('admin.settings'))
    if confirmation != option['confirmation']:
        flash(f'Type "{option["confirmation"]}" exactly to confirm.', category='error')
        return redirect(url_for('admin.settings'))

    deleted = {}

    def delete_rows(model, key):
        count = model.query.delete(synchronize_session=False)
        deleted[key] = int(count or 0)

    try:
        if dataset in ('pos_sold', 'daily_sales', 'all_operational'):
            delete_rows(PosSold, 'pos_sold')
        if dataset in ('daily_sales', 'all_operational'):
            delete_rows(DailyReport, 'daily_reports')
        if dataset in ('rso', 'all_operational'):
            delete_rows(RsoDeliveryDraft, 'rso_drafts')
            delete_rows(RsoDelivery, 'rso_deliveries')
        if dataset in ('invensync', 'all_operational'):
            delete_rows(DailyEndingInventoryItem, 'invensync_items')
            delete_rows(DailyEndingInventory, 'invensync_days')
        if dataset in ('transfers', 'all_operational'):
            delete_rows(TafTransferItem, 'transfer_items')
            delete_rows(TafTransfer, 'transfers')
        if dataset in ('targets', 'all_operational'):
            delete_rows(StoreTarget, 'store_targets')

        log_audit_event(
            action='admin.data.clear',
            entity_type='OperationalData',
            entity_id=dataset,
            reason=f'Cleared {option["label"]} from Admin Settings',
            details={'dataset': dataset, 'deleted_rows': deleted},
        )
        db.session.commit()
        total_deleted = sum(deleted.values())
        flash(f'{option["label"]} cleared successfully ({total_deleted} database rows deleted).', category='success')
    except Exception as exc:
        db.session.rollback()
        flash(f'Unable to clear data: {str(exc)}', category='error')

    return redirect(url_for('admin.settings'))


@admin.route('admin/users/create', methods=['POST'])
@login_required
def create_user():
    if not _can_manage_users():
        flash('Access denied. Only Admin or Superadmin can manage users.', category='error')
        return redirect(url_for('views.home'))

    try:
        full_name = (request.form.get('full_name') or '').strip()
        username = (request.form.get('username') or '').strip()
        email = (request.form.get('email') or '').strip()
        role = (request.form.get('role') or '').strip()
        assigned_store_ids_raw = request.form.getlist('assigned_store_ids')
        password = request.form.get('password') or ''
        confirm_password = request.form.get('confirm_password') or ''

        if not full_name or not username or not email or not role or not password:
            flash('All required fields must be filled.', category='error')
            return redirect(url_for('admin.users'))

        if password != confirm_password:
            flash('Passwords do not match!', category='error')
            return redirect(url_for('admin.users'))

        if len(password) < 6:
            flash('Password must be at least 6 characters.', category='error')
            return redirect(url_for('admin.users'))

        assigned_store_id = None
        assigned_stores = []
        if role == 'Inventory Staff':
            assigned_store_ids = [int(value) for value in assigned_store_ids_raw if str(value).isdigit()]
            assigned_stores = Store.query.filter(Store.id.in_(assigned_store_ids)).order_by(Store.name.asc()).all() if assigned_store_ids else []
            if not assigned_stores:
                flash('At least one Assigned Store is required for Inventory Staff.', category='error')
                return redirect(url_for('admin.users'))
            assigned_store_id = assigned_stores[0].id
        
        # Check if user already exists
        if User.query.filter_by(email=email).first():
            flash('Email already exists!', category='error')
            return redirect(url_for('admin.users'))
        
        if User.query.filter_by(username=username).first():
            flash('Username already exists!', category='error')
            return redirect(url_for('admin.users'))
        
        # Create new user
        new_user = User(
            full_name=full_name,
            username=username,
            email=email,
            role=role,
            assigned_store_id=assigned_store_id,
            password=generate_password_hash(password, method='pbkdf2:sha256')
        )
        
        db.session.add(new_user)
        db.session.flush()
        new_user.assigned_stores = assigned_stores
        log_audit_event(
            action='admin.user.create',
            entity_type='User',
            entity_id=new_user.id,
            reason='New user account created by administrator.',
            details={
                'username': new_user.username,
                'email': new_user.email,
                'role': new_user.role,
                'assigned_store_id': new_user.assigned_store_id,
                'assigned_store_ids': [store.id for store in new_user.assigned_stores],
            },
        )
        db.session.commit()
        
        flash(f'User {username} created successfully!', category='success')
        
    except Exception as e:
        db.session.rollback()
        flash(f'Error creating user: {str(e)}', category='error')
    
    return redirect(url_for('admin.users'))

@admin.route('admin/users/<int:user_id>/update', methods=['POST'])
@login_required
def update_user(user_id):
    if not _can_manage_users():
        flash('Access denied. Only Admin or Superadmin can manage users.', category='error')
        return redirect(url_for('views.home'))

    try:
        user = User.query.get_or_404(user_id)
        previous_state = {
            'full_name': user.full_name,
            'username': user.username,
            'email': user.email,
            'role': user.role,
            'assigned_store_id': user.assigned_store_id,
            'assigned_store_ids': [store.id for store in user.assigned_stores],
        }
        full_name = (request.form.get('full_name') or '').strip()
        username = (request.form.get('username') or '').strip()
        email = (request.form.get('email') or '').strip()
        role = (request.form.get('role') or '').strip()
        assigned_store_ids_raw = request.form.getlist('assigned_store_ids')
        new_password = request.form.get('new_password') or ''
        confirm_new_password = request.form.get('confirm_new_password') or ''

        if not full_name or not username or not email or not role:
            flash('Full name, username, email, and role are required.', category='error')
            return redirect(url_for('admin.users'))

        existing_email = User.query.filter(User.email == email, User.id != user_id).first()
        if existing_email:
            flash('Email already exists!', category='error')
            return redirect(url_for('admin.users'))

        existing_username = User.query.filter(User.username == username, User.id != user_id).first()
        if existing_username:
            flash('Username already exists!', category='error')
            return redirect(url_for('admin.users'))

        user.full_name = full_name
        user.username = username
        user.email = email
        user.role = role

        if role == 'Inventory Staff':
            assigned_store_ids = [int(value) for value in assigned_store_ids_raw if str(value).isdigit()]
            assigned_stores = Store.query.filter(Store.id.in_(assigned_store_ids)).order_by(Store.name.asc()).all() if assigned_store_ids else []
            if not assigned_stores:
                flash('At least one Assigned Store is required for Inventory Staff.', category='error')
                return redirect(url_for('admin.users'))
            user.assigned_stores = assigned_stores
            user.assigned_store_id = assigned_stores[0].id
        else:
            user.assigned_stores = []
            user.assigned_store_id = None

        if new_password or confirm_new_password:
            if new_password != confirm_new_password:
                flash('New password and confirm password do not match.', category='error')
                return redirect(url_for('admin.users'))
            if len(new_password) < 6:
                flash('New password must be at least 6 characters.', category='error')
                return redirect(url_for('admin.users'))
            user.password = generate_password_hash(new_password, method='pbkdf2:sha256')

        log_audit_event(
            action='admin.user.update',
            entity_type='User',
            entity_id=user.id,
            reason='User account updated by administrator.',
            details={
                'before': previous_state,
                'after': {
                    'full_name': user.full_name,
                    'username': user.username,
                    'email': user.email,
                    'role': user.role,
                    'assigned_store_id': user.assigned_store_id,
                    'assigned_store_ids': [store.id for store in user.assigned_stores],
                    'password_changed': bool(new_password),
                },
            },
        )
        db.session.commit()
        flash(f'User {user.username} updated successfully!', category='success')

    except Exception as e:
        db.session.rollback()
        flash(f'Error updating user: {str(e)}', category='error')

    return redirect(url_for('admin.users'))


@admin.route('admin/users/<int:user_id>/delete', methods=['POST'])
@login_required
def delete_user(user_id):
    if not _can_manage_users():
        flash('Access denied. Only Admin or Superadmin can manage users.', category='error')
        return redirect(url_for('views.home'))

    try:
        user = User.query.get_or_404(user_id)
        if current_user.id == user.id:
            flash('You cannot delete your own account.', category='error')
            return redirect(url_for('admin.users'))

        deleted_snapshot = {
            'username': user.username,
            'email': user.email,
            'role': user.role,
        }
        log_audit_event(
            action='admin.user.delete',
            entity_type='User',
            entity_id=user.id,
            reason='User account deleted by administrator.',
            details=deleted_snapshot,
        )
        db.session.delete(user)
        db.session.commit()
        flash(f'User {user.username} deleted successfully!', category='success')
    except Exception as e:
        db.session.rollback()
        flash(f'Error deleting user: {str(e)}', category='error')

    return redirect(url_for('admin.users'))


@admin.route('admin/stores')
def stores():
    from .views import _apply_store_scope_filter

    stores = _apply_store_scope_filter(Store.query.all(), request)
    # Get users with Store Manager role who are not already managing a store
    assigned_manager_ids = [s.manager_id for s in stores if s.manager_id]
    available_managers = User.query.filter(
        User.role == 'Store Manager',
        ~User.id.in_(assigned_manager_ids)
    ).all()
    # Get all store managers for the edit modal dropdown
    all_managers = User.query.filter(User.role == 'Store Manager').all()
    return render_template('admin/stores.html', user=current_user, stores=stores, managers=available_managers, all_managers=all_managers)


@admin.route('admin/stores/create', methods=['POST'])
def create_store():
    try:
        name = request.form.get('name')
        address = request.form.get('address')
        manager_id = request.form.get('manager_id')
        is_one_year_already = request.form.get('is_one_year_already', '0') == '1'
        
        # Validate required fields
        if not name or not address:
            flash('Store name and address are required!', category='error')
            return redirect(url_for('admin.stores'))
        
        # Check if store already exists
        if Store.query.filter_by(name=name).first():
            flash('Store with this name already exists!', category='error')
            return redirect(url_for('admin.stores'))
        
        # Create new store
        new_store = Store(
            name=name,
            address=address,
            is_one_year_already=is_one_year_already,
            manager_id=int(manager_id) if manager_id and manager_id != "" else None
        )
        
        db.session.add(new_store)
        db.session.flush()
        log_audit_event(
            action='admin.store.create',
            entity_type='Store',
            entity_id=new_store.id,
            reason='Store created by administrator.',
            details={
                'name': new_store.name,
                'address': new_store.address,
                'store_group': new_store.store_group,
                'is_one_year_already': new_store.is_one_year_already,
                'manager_id': new_store.manager_id,
            },
        )
        db.session.commit()
        
        flash(f'Store "{name}" created successfully!', category='success')
        
    except Exception as e:
        db.session.rollback()
        flash(f'Error creating store: {str(e)}', category='error')
    
    return redirect(url_for('admin.stores'))


@admin.route('admin/stores/<int:store_id>/assign-manager', methods=['POST'])
def assign_store_manager(store_id):
    try:
        store = Store.query.get_or_404(store_id)
        manager_id = request.form.get('manager_id')
        previous_manager_id = store.manager_id

        if not manager_id:
            flash('Please select a manager!', category='error')
            return redirect(url_for('admin.stores'))

        # Verify the manager exists and has the correct role
        manager = User.query.get(int(manager_id))
        if not manager or manager.role != 'Store Manager':
            flash('Invalid manager selection!', category='error')
            return redirect(url_for('admin.stores'))

        # Check if manager is already assigned to another store
        existing_store = Store.query.filter_by(manager_id=int(manager_id)).first()
        if existing_store and existing_store.id != store_id:
            flash(f'Manager {manager.full_name} is already assigned to {existing_store.name}!', category='error')
            return redirect(url_for('admin.stores'))

        store.manager_id = int(manager_id)
        log_audit_event(
            action='admin.store.assign_manager',
            entity_type='Store',
            entity_id=store.id,
            reason='Store manager reassigned.',
            details={
                'store_name': store.name,
                'previous_manager_id': previous_manager_id,
                'new_manager_id': store.manager_id,
            },
        )
        db.session.commit()

        flash(f'Manager "{manager.full_name}" assigned to store "{store.name}" successfully!', category='success')

    except Exception as e:
        db.session.rollback()
        flash(f'Error assigning manager: {str(e)}', category='error')

    return redirect(url_for('admin.stores'))


@admin.route('admin/stores/<int:store_id>/update', methods=['POST'])
@login_required
def update_store(store_id):
    if current_user.role not in ('Superadmin', 'Admin'):
        flash('Access denied. Only Admins and Superadmins can update stores.', category='error')
        return redirect(url_for('views.home'))

    try:
        store = Store.query.get_or_404(store_id)
        previous_state = {
            'name': store.name,
            'address': store.address,
            'is_one_year_already': store.is_one_year_already,
            'manager_id': store.manager_id,
        }

        name = (request.form.get('name') or '').strip()
        address = (request.form.get('address') or '').strip()
        is_one_year_already = request.form.get('is_one_year_already', '0') == '1'
        manager_id_raw = (request.form.get('manager_id') or '').strip()

        if not name or not address:
            flash('Store name and address are required!', category='error')
            return redirect(url_for('admin.stores'))

        # Check if name changed and if new name already exists
        if name != store.name:
            existing = Store.query.filter(Store.name == name, Store.id != store_id).first()
            if existing:
                flash('Store with this name already exists!', category='error')
                return redirect(url_for('admin.stores'))

        # Handle manager assignment
        new_manager_id = None
        if manager_id_raw:
            new_manager_id = int(manager_id_raw)
            # Verify the manager exists and has the correct role
            manager = User.query.get(new_manager_id)
            if not manager or manager.role != 'Store Manager':
                flash('Invalid manager selection!', category='error')
                return redirect(url_for('admin.stores'))

            # Check if manager is already assigned to another store
            existing_store = Store.query.filter_by(manager_id=new_manager_id).first()
            if existing_store and existing_store.id != store_id:
                flash(f'Manager {manager.full_name} is already assigned to {existing_store.name}!', category='error')
                return redirect(url_for('admin.stores'))

        store.name = name
        store.address = address
        store.is_one_year_already = is_one_year_already
        store.manager_id = new_manager_id

        log_audit_event(
            action='admin.store.update',
            entity_type='Store',
            entity_id=store.id,
            reason='Store updated by administrator.',
            details={
                'before': previous_state,
                'after': {
                    'name': store.name,
                    'address': store.address,
                    'is_one_year_already': store.is_one_year_already,
                    'manager_id': store.manager_id,
                },
            },
        )
        db.session.commit()

        flash(f'Store "{name}" updated successfully!', category='success')

    except Exception as e:
        db.session.rollback()
        flash(f'Error updating store: {str(e)}', category='error')

    return redirect(url_for('admin.stores'))


# Cluster Routes
@admin.route('admin/clusters')
@login_required
def clusters():
    if current_user.role not in ('Superadmin', 'Admin', 'General Manager'):
        flash('Access denied.', category='error')
        return redirect(url_for('views.home'))

    from .views import _apply_store_scope_filter

    clusters = Cluster.query.all()
    for cluster in clusters:
        cluster.stores = _apply_store_scope_filter(cluster.stores, request)
    # Get users with Cluster Manager role who are not already managing a cluster
    assigned_manager_ids = [c.manager_id for c in clusters if c.manager_id]
    managers = User.query.filter(
        User.role == 'Cluster Manager',
        ~User.id.in_(assigned_manager_ids)
    ).all()
    return render_template(
        'admin/clusters.html',
        user=current_user,
        clusters=clusters,
        managers=managers,
        can_manage_clusters=current_user.role in ('Superadmin', 'Admin'),
    )


@admin.route('admin/clusters/create', methods=['POST'])
@login_required
def create_cluster():
    if current_user.role not in ('Superadmin', 'Admin'):
        flash('Access denied.', category='error')
        return redirect(url_for('admin.clusters'))

    try:
        name = request.form.get('name')
        description = request.form.get('description')
        manager_id = request.form.get('manager_id')
        
        # Validate required fields
        if not name:
            flash('Cluster name is required!', category='error')
            return redirect(url_for('admin.clusters'))
        
        # Check if cluster already exists
        if Cluster.query.filter_by(name=name).first():
            flash('Cluster with this name already exists!', category='error')
            return redirect(url_for('admin.clusters'))
        
        # Create new cluster
        new_cluster = Cluster(
            name=name,
            description=description,
            manager_id=int(manager_id) if manager_id else None
        )
        
        db.session.add(new_cluster)
        db.session.flush()
        log_audit_event(
            action='admin.cluster.create',
            entity_type='Cluster',
            entity_id=new_cluster.id,
            reason='Cluster created by administrator.',
            details={
                'name': new_cluster.name,
                'description': new_cluster.description,
                'manager_id': new_cluster.manager_id,
            },
        )
        db.session.commit()
        
        flash(f'Cluster "{name}" created successfully!', category='success')
        
    except Exception as e:
        db.session.rollback()
        flash(f'Error creating cluster: {str(e)}', category='error')
    
    return redirect(url_for('admin.clusters'))


@admin.route('admin/clusters/<int:cluster_id>/manage')
@login_required
def manage_cluster(cluster_id):
    if current_user.role not in ('Superadmin', 'Admin', 'General Manager'):
        flash('Access denied.', category='error')
        return redirect(url_for('views.home'))

    from .views import _apply_store_scope_filter

    cluster = Cluster.query.get_or_404(cluster_id)
    cluster.stores = _apply_store_scope_filter(cluster.stores, request)
    # Get stores that are not assigned to any cluster
    available_stores = _apply_store_scope_filter(Store.query.filter_by(cluster_id=None).all(), request)
    # Get users with Cluster Manager role who are not already managing a cluster
    assigned_manager_ids = [c.manager_id for c in Cluster.query.all() if c.manager_id and c.id != cluster_id]
    available_managers = User.query.filter(
        User.role == 'Cluster Manager',
        ~User.id.in_(assigned_manager_ids)
    ).all()
    return render_template(
        'admin/cluster_manage.html',
        user=current_user,
        cluster=cluster,
        available_stores=available_stores,
        available_managers=available_managers,
        can_manage_clusters=current_user.role in ('Superadmin', 'Admin'),
    )


@admin.route('admin/clusters/<int:cluster_id>/add-stores', methods=['POST'])
@login_required
def add_stores_to_cluster(cluster_id):
    if current_user.role not in ('Superadmin', 'Admin'):
        flash('Access denied.', category='error')
        return redirect(url_for('admin.manage_cluster', cluster_id=cluster_id))

    try:
        cluster = Cluster.query.get_or_404(cluster_id)
        store_ids = request.form.getlist('store_ids')
        
        if not store_ids:
            flash('Please select at least one store!', category='error')
            return redirect(url_for('admin.manage_cluster', cluster_id=cluster_id))
        
        # Add stores to cluster
        added_count = 0
        added_store_ids = []
        for store_id in store_ids:
            store = Store.query.get(int(store_id))
            if store and store.cluster_id is None:
                store.cluster_id = cluster_id
                added_count += 1
                added_store_ids.append(store.id)
        
        log_audit_event(
            action='admin.cluster.add_stores',
            entity_type='Cluster',
            entity_id=cluster.id,
            reason='Stores added to cluster.',
            details={
                'cluster_name': cluster.name,
                'added_store_ids': added_store_ids,
                'count': added_count,
            },
        )
        db.session.commit()
        flash(f'{added_count} store(s) added to cluster successfully!', category='success')
        
    except Exception as e:
        db.session.rollback()
        flash(f'Error adding stores: {str(e)}', category='error')
    
    return redirect(url_for('admin.manage_cluster', cluster_id=cluster_id))


@admin.route('admin/clusters/<int:cluster_id>/remove-store/<int:store_id>', methods=['POST'])
@login_required
def remove_store_from_cluster(cluster_id, store_id):
    if current_user.role not in ('Superadmin', 'Admin'):
        flash('Access denied.', category='error')
        return redirect(url_for('admin.manage_cluster', cluster_id=cluster_id))

    try:
        store = Store.query.get_or_404(store_id)
        
        if store.cluster_id != cluster_id:
            flash('Store does not belong to this cluster!', category='error')
            return redirect(url_for('admin.manage_cluster', cluster_id=cluster_id))
        
        previous_cluster_id = store.cluster_id
        store.cluster_id = None
        log_audit_event(
            action='admin.cluster.remove_store',
            entity_type='Cluster',
            entity_id=cluster_id,
            reason='Store removed from cluster.',
            details={
                'store_id': store.id,
                'store_name': store.name,
                'previous_cluster_id': previous_cluster_id,
            },
        )
        db.session.commit()
        
        flash(f'Store "{store.name}" removed from cluster!', category='success')
        
    except Exception as e:
        db.session.rollback()
        flash(f'Error removing store: {str(e)}', category='error')
    
    return redirect(url_for('admin.manage_cluster', cluster_id=cluster_id))


@admin.route('admin/clusters/<int:cluster_id>/delete', methods=['POST'])
@login_required
def delete_cluster(cluster_id):
    if current_user.role not in ('Superadmin', 'Admin'):
        flash('Access denied.', category='error')
        return redirect(url_for('admin.clusters'))

    try:
        cluster = Cluster.query.get_or_404(cluster_id)
        affected_store_ids = [store.id for store in cluster.stores]
        
        # Unassign all stores from this cluster
        for store in cluster.stores:
            store.cluster_id = None
        log_audit_event(
            action='admin.cluster.delete',
            entity_type='Cluster',
            entity_id=cluster.id,
            reason='Cluster deleted by administrator.',
            details={
                'cluster_name': cluster.name,
                'unassigned_store_ids': affected_store_ids,
            },
        )
        
        db.session.delete(cluster)
        db.session.commit()
        
        flash(f'Cluster "{cluster.name}" deleted successfully!', category='success')
        
    except Exception as e:
        db.session.rollback()
        flash(f'Error deleting cluster: {str(e)}', category='error')
    
    return redirect(url_for('admin.clusters'))


@admin.route('admin/clusters/<int:cluster_id>/assign-manager', methods=['POST'])
@login_required
def assign_manager(cluster_id):
    if current_user.role not in ('Superadmin', 'Admin'):
        flash('Access denied.', category='error')
        return redirect(url_for('admin.manage_cluster', cluster_id=cluster_id))

    try:
        cluster = Cluster.query.get_or_404(cluster_id)
        manager_id = request.form.get('manager_id')
        previous_manager_id = cluster.manager_id
        
        if not manager_id:
            flash('Please select a manager!', category='error')
            return redirect(url_for('admin.manage_cluster', cluster_id=cluster_id))
        
        # Verify the manager exists and has the correct role
        manager = User.query.get(int(manager_id))
        if not manager or manager.role != 'Cluster Manager':
            flash('Invalid manager selection!', category='error')
            return redirect(url_for('admin.manage_cluster', cluster_id=cluster_id))
        
        cluster.manager_id = int(manager_id)
        log_audit_event(
            action='admin.cluster.assign_manager',
            entity_type='Cluster',
            entity_id=cluster.id,
            reason='Cluster manager reassigned.',
            details={
                'cluster_name': cluster.name,
                'previous_manager_id': previous_manager_id,
                'new_manager_id': cluster.manager_id,
            },
        )
        db.session.commit()
        
        flash(f'Manager "{manager.full_name}" assigned to cluster successfully!', category='success')
        
    except Exception as e:
        db.session.rollback()
        flash(f'Error assigning manager: {str(e)}', category='error')
    
    return redirect(url_for('admin.manage_cluster', cluster_id=cluster_id))


# Store Targets Routes
@admin.route('/admin/targets')
@login_required
def targets():
    if current_user.role not in ('Superadmin', 'General Manager'):
        flash('Access denied. Only Superadmins and General Managers can access this page.', category='error')
        return redirect(url_for('views.home'))
    
    clusters = Cluster.query.order_by(Cluster.name.asc()).all()
    selected_cluster_id = request.args.get('cluster_id', type=int)
    selected_store_id = request.args.get('store_id', type=int)
    selected_month = (request.args.get('target_month') or date.today().strftime('%Y-%m')).strip()
    clear_target_draft = request.args.get('saved') == '1'

    # Filter stores by selected cluster (or show all when cluster is not selected)
    if selected_cluster_id:
        stores = Store.query.filter_by(cluster_id=selected_cluster_id).order_by(Store.name.asc()).all()
    else:
        stores = Store.query.order_by(Store.name.asc()).all()

    # If selected store is not in filtered list, reset it
    store_ids = {store.id for store in stores}
    if selected_store_id and selected_store_id not in store_ids:
        selected_store_id = None

    targets_data = []
    target_rows = []
    target_cluster_data_url = None
    
    if selected_store_id:
        selected_store = Store.query.get(selected_store_id)
        if selected_store and not selected_cluster_id:
            selected_cluster_id = selected_store.cluster_id

        # Fetch targets for selected store, optionally filtered by month.
        targets_query = StoreTarget.query.filter_by(store_id=selected_store_id)
        month_start = None
        next_month = None
        if selected_month:
            try:
                month_start = datetime.strptime(selected_month, '%Y-%m').date().replace(day=1)
                next_month = datetime(month_start.year + 1, 1, 1).date() if month_start.month == 12 else datetime(month_start.year, month_start.month + 1, 1).date()
                targets_query = targets_query.filter(
                    StoreTarget.target_date >= month_start,
                    StoreTarget.target_date < next_month,
                )
            except ValueError:
                selected_month = date.today().strftime('%Y-%m')
                month_start = datetime.strptime(selected_month, '%Y-%m').date().replace(day=1)
                next_month = datetime(month_start.year + 1, 1, 1).date() if month_start.month == 12 else datetime(month_start.year, month_start.month + 1, 1).date()
                targets_query = targets_query.filter(
                    StoreTarget.target_date >= month_start,
                    StoreTarget.target_date < next_month,
                )
        targets = targets_query.order_by(StoreTarget.target_date.asc()).all()
        targets_data = targets

        if month_start and next_month:
            target_by_date = {target.target_date: target for target in targets}
            current_date = month_start
            while current_date < next_month:
                target = target_by_date.get(current_date)
                target_rows.append({
                    'date': current_date,
                    'target_net': float(target.target_net or 0) if target else 0.0,
                    'last_year_net': float(target.last_year_net or 0) if target else 0.0,
                    'gbi_target': float(target.gbi_target or 0) if target else 0.0,
                })
                current_date += timedelta(days=1)

            if selected_store and selected_store.cluster_id:
                target_cluster_data_url = url_for(
                    'views.cluster_manager_cluster_data',
                    cluster_id=selected_store.cluster_id,
                    store_id=selected_store_id,
                    month=f'{month_start.month:02d}',
                    year=str(month_start.year),
                )
    
    return render_template(
        'admin/targets.html',
        user=current_user,
        clusters=clusters,
        stores=stores,
        selected_cluster_id=selected_cluster_id,
        selected_store_id=selected_store_id,
        selected_month=selected_month,
        targets_data=targets_data,
        target_rows=target_rows,
        target_cluster_data_url=target_cluster_data_url,
        clear_target_draft=clear_target_draft,
    )


@admin.route('/admin/targets/save', methods=['POST'])
@login_required
def save_targets():
    if current_user.role != 'Superadmin':
        flash('Access denied.', category='error')
        return redirect(url_for('views.home'))

    cluster_id = request.form.get('cluster_id', type=int)
    store_id = request.form.get('store_id', type=int)
    selected_month = (request.form.get('target_month') or '').strip()

    if not store_id:
        flash('Please select a store.', category='error')
        return redirect(url_for('admin.targets', cluster_id=cluster_id, target_month=selected_month))

    selected_store = Store.query.get(store_id)
    if not selected_store:
        flash('Selected store was not found.', category='error')
        return redirect(url_for('admin.targets', cluster_id=cluster_id, target_month=selected_month))

    if not cluster_id:
        cluster_id = selected_store.cluster_id

    try:
        month_start = datetime.strptime(selected_month, '%Y-%m').date().replace(day=1)
    except ValueError:
        flash('Please select a valid month.', category='error')
        return redirect(url_for('admin.targets', cluster_id=cluster_id, store_id=store_id))

    next_month = datetime(month_start.year + 1, 1, 1).date() if month_start.month == 12 else datetime(month_start.year, month_start.month + 1, 1).date()
    existing_targets = {
        target.target_date: target
        for target in StoreTarget.query.filter(
            StoreTarget.store_id == store_id,
            StoreTarget.target_date >= month_start,
            StoreTarget.target_date < next_month,
        ).all()
    }

    date_values = request.form.getlist('target_date[]')
    target_net_values = request.form.getlist('target_net[]')
    last_year_net_values = request.form.getlist('last_year_net[]')
    gbi_target_values = request.form.getlist('gbi_target[]')

    saved_count = 0
    save_success = False
    try:
        for idx, raw_date in enumerate(date_values):
            target_date = datetime.strptime(str(raw_date or '').strip(), '%Y-%m-%d').date()
            if target_date < month_start or target_date >= next_month:
                continue

            target = existing_targets.get(target_date)
            if not target:
                target = StoreTarget(
                    store_id=store_id,
                    target_date=target_date,
                    uploaded_by=current_user.id,
                )
                db.session.add(target)

            target.target_net = float(target_net_values[idx] or 0) if idx < len(target_net_values) else 0.0
            target.last_year_net = float(last_year_net_values[idx] or 0) if idx < len(last_year_net_values) else 0.0
            target.gbi_target = float(gbi_target_values[idx] or 0) if idx < len(gbi_target_values) else 0.0
            saved_count += 1

        log_audit_event(
            action='admin.targets.month_save',
            entity_type='StoreTarget',
            entity_id=store_id,
            reason='Monthly store targets saved from grid.',
            details={
                'store_id': store_id,
                'target_month': selected_month,
                'records_saved': saved_count,
            },
        )
        db.session.commit()
        save_success = True
        flash(f'Saved {saved_count} target rows for {selected_month}. Cluster Data will show them under TARGET (NET), LAST YEAR (NET), and GBI TARGET for {selected_store.name}.', category='success')
    except Exception as e:
        db.session.rollback()
        flash(f'Error saving targets: {str(e)}', category='error')

    redirect_params = {
        'cluster_id': cluster_id,
        'store_id': store_id,
        'target_month': selected_month,
    }
    if save_success:
        redirect_params['saved'] = '1'
    return redirect(url_for('admin.targets', **redirect_params))


@admin.route('/admin/targets/upload', methods=['POST'])
@login_required
def upload_targets():
    if current_user.role != 'Superadmin':
        flash('Access denied.', category='error')
        return redirect(url_for('views.home'))
    
    try:
        store_id = request.form.get('store_id')
        cluster_id = request.form.get('cluster_id', type=int)
        if not cluster_id and store_id:
            selected_store = Store.query.get(int(store_id))
            if selected_store:
                cluster_id = selected_store.cluster_id
        
        if not store_id:
            flash('Please select a store!', category='error')
            return redirect(url_for('admin.targets', cluster_id=cluster_id))
        
        # Check if file is uploaded
        if 'file' not in request.files:
            flash('No file uploaded!', category='error')
            return redirect(url_for('admin.targets', cluster_id=cluster_id, store_id=store_id))
        
        file = request.files['file']
        
        if file.filename == '':
            flash('No file selected!', category='error')
            return redirect(url_for('admin.targets', cluster_id=cluster_id, store_id=store_id))
        
        if not file.filename.endswith(('.xlsx', '.xls')):
            flash('Please upload an Excel file (.xlsx or .xls)!', category='error')
            return redirect(url_for('admin.targets', cluster_id=cluster_id, store_id=store_id))
        
        # Read Excel file
        df = pd.read_excel(file)
        
        # Validate columns
        required_columns = ['Date', 'Target (Net)', 'Last Year (Net)']
        optional_columns = ['GBI Target']
        all_columns = required_columns + optional_columns
        
        # Check if required columns exist
        missing_required = [col for col in required_columns if col not in df.columns]
        if missing_required:
            flash(f'Excel file must contain required columns: {", ".join(missing_required)}', category='error')
            return redirect(url_for('admin.targets', cluster_id=cluster_id, store_id=store_id))
        
        # Check if GBI Target column exists
        has_gbi_target = 'GBI Target' in df.columns

        # Prepare rows first so we only delete existing data when upload contains valid target dates.
        prepared_targets = []
        uploaded_months = set()
        for index, row in df.iterrows():
            try:
                if pd.isna(row['Date']):
                    continue

                target_date = pd.to_datetime(row['Date']).date()
                target_net = float(row['Target (Net)']) if pd.notna(row['Target (Net)']) else 0.0
                last_year_net = float(row['Last Year (Net)']) if pd.notna(row['Last Year (Net)']) else 0.0
                gbi_target = 0.0
                if has_gbi_target:
                    gbi_target = float(row['GBI Target']) if pd.notna(row['GBI Target']) else 0.0

                prepared_targets.append({
                    'target_date': target_date,
                    'target_net': target_net,
                    'last_year_net': last_year_net,
                    'gbi_target': gbi_target,
                })
                uploaded_months.add((int(target_date.year), int(target_date.month)))
            except Exception:
                continue

        if not prepared_targets:
            flash('No valid target rows found in the uploaded file.', category='error')
            return redirect(url_for('admin.targets', cluster_id=cluster_id, store_id=store_id))

        # Delete only the matching store + uploaded month(s), keeping other months untouched.
        for year, month in uploaded_months:
            month_start = datetime(year, month, 1).date()
            next_month_start = datetime(year + 1, 1, 1).date() if month == 12 else datetime(year, month + 1, 1).date()
            StoreTarget.query.filter(
                StoreTarget.store_id == int(store_id),
                StoreTarget.target_date >= month_start,
                StoreTarget.target_date < next_month_start,
            ).delete(synchronize_session=False)

        # Insert new targets
        added_count = 0
        for item in prepared_targets:
            new_target = StoreTarget(
                store_id=int(store_id),
                target_date=item['target_date'],
                target_net=item['target_net'],
                gbi_target=item['gbi_target'],
                last_year_net=item['last_year_net'],
                uploaded_by=current_user.id
            )
            db.session.add(new_target)
            added_count += 1
        
        log_audit_event(
            action='admin.targets.upload',
            entity_type='StoreTarget',
            entity_id=store_id,
            reason='Store targets uploaded from Excel.',
            details={
                'store_id': int(store_id),
                'records_uploaded': added_count,
                'filename': file.filename,
            },
        )
        db.session.commit()
        flash(f'Successfully uploaded {added_count} target records!', category='success')
        
    except Exception as e:
        db.session.rollback()
        flash(f'Error uploading file: {str(e)}', category='error')
    
    return redirect(url_for('admin.targets', cluster_id=cluster_id, store_id=store_id))


@admin.route('/admin/targets/update', methods=['POST'])
@login_required
def update_target():
    if current_user.role != 'Superadmin':
        return {'success': False, 'message': 'Access denied'}, 403
    
    try:
        data = request.get_json()
        target_id = data.get('target_id')
        field = data.get('field')
        value = data.get('value')
        
        # Validate input
        if not target_id or not field or value is None:
            return {'success': False, 'message': 'Missing required fields'}, 400
        
        # Get the target
        target = StoreTarget.query.get(target_id)
        if not target:
            return {'success': False, 'message': 'Target not found'}, 404
        
        # Update the field
        if field == 'target_net':
            previous_value = target.target_net
            target.target_net = float(value)
        elif field == 'last_year_net':
            previous_value = target.last_year_net
            target.last_year_net = float(value)
        elif field == 'gbi_target':
            previous_value = target.gbi_target
            target.gbi_target = float(value)
        else:
            return {'success': False, 'message': 'Invalid field'}, 400
        
        log_audit_event(
            action='admin.targets.update',
            entity_type='StoreTarget',
            entity_id=target.id,
            reason='Single target value updated.',
            details={
                'field': field,
                'previous_value': previous_value,
                'new_value': value,
            },
        )
        db.session.commit()
        return {'success': True, 'message': 'Target updated successfully'}, 200
        
    except Exception as e:
        db.session.rollback()
        return {'success': False, 'message': str(e)}, 500


@admin.route('/admin/product-masterlist')
@login_required
def product_masterlist():
    if current_user.role not in ('Superadmin', 'Admin'):
        flash('Access denied.', category='error')
        return redirect(url_for('views.home'))

    q = (request.args.get('q') or '').strip()
    product_query = ProductMaster.query
    if q:
        pattern = f'%{q}%'
        product_query = product_query.filter(
            or_(
                cast(ProductMaster.code, String).ilike(pattern),
                ProductMaster.description.ilike(pattern),
                ProductMaster.category.ilike(pattern),
                ProductMaster.sub_category.ilike(pattern),
                cast(ProductMaster.tp, String).ilike(pattern),
                cast(ProductMaster.sp_p, String).ilike(pattern),
                cast(ProductMaster.sp_np, String).ilike(pattern),
                ProductMaster.shelf_life.ilike(pattern),
            )
        )

    products = (
        product_query
        .options(selectinload(ProductMaster.aliases))
        .order_by(ProductMaster.id.asc())
        .limit(500)
        .all()
    )
    total_products = ProductMaster.query.count()

    return render_template(
        'admin/product_masterlist.html',
        user=current_user,
        products=products,
        total_products=total_products,
        search_query=q,
    )


@admin.route('/admin/add-product', methods=['POST'])
@login_required
def add_product():
    if current_user.role not in ('Superadmin', 'Admin'):
        return jsonify({'success': False, 'message': 'Access denied.'}), 403

    try:
        data = request.get_json()
        
        # Validate required fields
        required_fields = ['code', 'description', 'category', 'tp', 'sp_p', 'sp_np']
        for field in required_fields:
            if not data.get(field):
                return jsonify({'success': False, 'message': f'Missing required field: {field}'}), 400

        # Check if code already exists
        existing_product = ProductMaster.query.filter_by(code=int(data['code'])).first()
        if existing_product:
            return jsonify({'success': False, 'message': 'Product with this code already exists.'}), 400

        # Create new product
        product = ProductMaster(
            code=int(data['code']),
            description=data['description'].strip(),
            category=data['category'].strip(),
            sub_category=data.get('sub_category', '').strip() or None,
            tp=float(data['tp']),
            sp_p=float(data['sp_p']),
            sp_np=float(data['sp_np']),
            shelf_life=data.get('shelf_life', '').strip() or None
        )

        db.session.add(product)
        db.session.commit()

        # Log audit event
        log_audit_event(
            current_user.id,
            'CREATE',
            'ProductMaster',
            product.id,
            {'action': 'Added new product', 'code': product.code, 'description': product.description}
        )

        return jsonify({'success': True, 'message': 'Product added successfully.'}), 200

    except ValueError as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': f'Invalid data format: {str(e)}'}), 400
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': f'Error adding product: {str(e)}'}), 500


@admin.route('/admin/edit-product/<int:product_id>', methods=['POST'])
@login_required
def edit_product(product_id):
    if current_user.role not in ('Superadmin', 'Admin'):
        return jsonify({'success': False, 'message': 'Access denied.'}), 403

    try:
        data = request.get_json()
        
        # Find product
        product = ProductMaster.query.get(product_id)
        if not product:
            return jsonify({'success': False, 'message': 'Product not found.'}), 404

        # Validate required fields
        required_fields = ['code', 'description', 'category', 'tp', 'sp_p', 'sp_np']
        for field in required_fields:
            if not data.get(field):
                return jsonify({'success': False, 'message': f'Missing required field: {field}'}), 400

        # Check if code already exists for another product
        code = int(data['code'])
        existing_product = ProductMaster.query.filter(
            ProductMaster.code == code,
            ProductMaster.id != product_id
        ).first()
        if existing_product:
            return jsonify({'success': False, 'message': 'Another product with this code already exists.'}), 400

        # Update product
        product.code = code
        product.description = data['description'].strip()
        product.category = data['category'].strip()
        product.sub_category = data.get('sub_category', '').strip() or None
        product.tp = float(data['tp'])
        product.sp_p = float(data['sp_p'])
        product.sp_np = float(data['sp_np'])
        product.shelf_life = data.get('shelf_life', '').strip() or None

        db.session.commit()

        # Log audit event
        log_audit_event(
            current_user.id,
            'UPDATE',
            'ProductMaster',
            product.id,
            {'action': 'Updated product', 'code': product.code, 'description': product.description}
        )

        return jsonify({'success': True, 'message': 'Product updated successfully.'}), 200

    except ValueError as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': f'Invalid data format: {str(e)}'}), 400
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': f'Error updating product: {str(e)}'}), 500


@admin.route('/admin/delete-product/<int:product_id>', methods=['POST'])
@login_required
def delete_product(product_id):
    if current_user.role not in ('Superadmin', 'Admin'):
        return jsonify({'success': False, 'message': 'Access denied.'}), 403

    try:
        # Find product
        product = ProductMaster.query.get(product_id)
        if not product:
            return jsonify({'success': False, 'message': 'Product not found.'}), 404

        # Store product info for audit log
        product_code = product.code
        product_description = product.description

        # Delete product
        db.session.delete(product)
        db.session.commit()

        # Log audit event
        log_audit_event(
            current_user.id,
            'DELETE',
            'ProductMaster',
            product_id,
            {'action': 'Deleted product', 'code': product_code, 'description': product_description}
        )

        return jsonify({'success': True, 'message': 'Product deleted successfully.'}), 200

    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': f'Error deleting product: {str(e)}'}), 500




@admin.route('/admin/system-analyzer/link-product', methods=['POST'])
@login_required
def link_system_analyzer_product():
    if current_user.role not in ('Superadmin', 'Admin'):
        flash('Access denied.', category='error')
        return redirect(url_for('views.home'))

    alias_name = (request.form.get('alias_name') or '').strip()
    master_product_name = (request.form.get('master_product_name') or '').strip()
    start_date = (request.form.get('start_date') or '').strip()
    end_date = (request.form.get('end_date') or '').strip()

    redirect_url = url_for(
        'admin.system_analyzer',
        start_date=start_date,
        end_date=end_date,
    )

    if not alias_name or not master_product_name:
        flash('Please provide the detected product name and master product name.', category='error')
        return redirect(redirect_url)

    normalized_alias = _normalize_product_text(alias_name)
    normalized_target = _normalize_product_text(master_product_name)
    if not normalized_alias or not normalized_target:
        flash('Invalid product names for linking.', category='error')
        return redirect(redirect_url)

    product_masters = ProductMaster.query.with_entities(ProductMaster.id, ProductMaster.description).all()
    best_match = None
    best_score = 0.0
    for master_id, master_description in product_masters:
        normalized_master = _normalize_product_text(master_description)
        if not normalized_master:
            continue
        if normalized_master == normalized_target:
            best_match = (master_id, master_description)
            best_score = 1.0
            break
        score = SequenceMatcher(None, normalized_target, normalized_master).ratio()
        if score > best_score:
            best_score = score
            best_match = (master_id, master_description)

    if not best_match or best_score < 0.80:
        flash('Master product not found. Please type a valid masterlist product name.', category='error')
        return redirect(redirect_url)

    linked_master_id, linked_master_name = best_match

    try:
        existing_alias = ProductAlias.query.filter_by(normalized_alias=normalized_alias).first()
        if existing_alias:
            previous_master_id = existing_alias.product_master_id
            existing_alias.alias_name = alias_name
            existing_alias.product_master_id = int(linked_master_id)
            existing_alias.created_by = current_user.id
            action = 'updated'
        else:
            previous_master_id = None
            db.session.add(
                ProductAlias(
                    alias_name=alias_name,
                    normalized_alias=normalized_alias,
                    product_master_id=int(linked_master_id),
                    created_by=current_user.id,
                )
            )
            action = 'created'

        log_audit_event(
            action='admin.product_alias.link',
            entity_type='ProductAlias',
            entity_id=normalized_alias,
            reason='Linked detected product name to product masterlist.',
            details={
                'alias_name': alias_name,
                'normalized_alias': normalized_alias,
                'master_product_id': int(linked_master_id),
                'master_product_name': linked_master_name,
                'previous_master_id': previous_master_id,
                'action': action,
            },
        )
        db.session.commit()
        flash(f'Linked "{alias_name}" to "{linked_master_name}". POS and RSO matching will now use the master product.', category='success')
    except Exception as exc:
        db.session.rollback()
        flash(f'Error linking product alias: {str(exc)}', category='error')

    return redirect(redirect_url)


@admin.route('/admin/system-analyzer')
@login_required
def system_analyzer():
    if current_user.role not in ('Superadmin', 'Admin'):
        flash('Access denied.', category='error')
        return redirect(url_for('views.home'))

    today = datetime.today().date()
    default_start = today.replace(day=1)
    start_date_raw = (request.args.get('start_date') or '').strip()
    end_date_raw = (request.args.get('end_date') or '').strip()
    link_alias = (request.args.get('link_alias') or '').strip()

    def _parse_iso_date(raw_value, fallback):
        if not raw_value:
            return fallback
        try:
            return datetime.strptime(raw_value, '%Y-%m-%d').date()
        except (TypeError, ValueError):
            return fallback

    start_date = _parse_iso_date(start_date_raw, default_start)
    end_date = _parse_iso_date(end_date_raw, today)
    if start_date > end_date:
        start_date, end_date = end_date, start_date

    master_products = ProductMaster.query.with_entities(ProductMaster.code, ProductMaster.description).all()
    master_descriptions = [(description,) for _, description in master_products]
    normalized_master_codes = {
        re.sub(r'[^a-z0-9]', '', str(code).strip().lower())
        for code, _ in master_products
        if str(code or '').strip()
    }
    normalized_master_names = {
        _normalize_product_text(description)
        for (description,) in master_descriptions
        if _normalize_product_text(description)
    }
    master_name_options = sorted({
        (description or '').strip()
        for (description,) in master_descriptions
        if (description or '').strip()
    })

    master_match_names = set()
    for master_name in normalized_master_names:
        master_match_names.update(_build_name_variants(master_name))
    master_match_names_list = list(master_match_names)
    match_result_cache = {}
    alias_lookup = _get_product_alias_lookup()

    def _extract_product_code(product_text):
        text_value = str(product_text or '').strip()
        if not text_value:
            return ''
        compact_value = re.sub(r'[^a-z0-9]', '', text_value.lower())
        if compact_value in normalized_master_codes:
            return compact_value
        leading_code = re.match(r'^\s*([a-z0-9][a-z0-9._-]{2,})\b', text_value, re.IGNORECASE)
        if leading_code and re.search(r'\d', leading_code.group(1)):
            candidate = re.sub(r'[^a-z0-9]', '', leading_code.group(1).lower())
            return candidate
        return ''

    def _matches_master_code(product_text):
        detected_code = _extract_product_code(product_text)
        return bool(detected_code and detected_code in normalized_master_codes)

    def _matches_master_name_exact(product_text):
        normalized_name = _normalize_product_text(product_text)
        if not normalized_name:
            return False
        return any(variant in master_match_names for variant in _build_name_variants(normalized_name))

    def _is_in_masterlist_fuzzy(normalized_name, threshold=0.80):
        if not normalized_name:
            return False
        if normalized_name in match_result_cache:
            return match_result_cache[normalized_name]

        pos_variants = _build_name_variants(normalized_name)
        if any(variant in master_match_names for variant in pos_variants):
            match_result_cache[normalized_name] = True
            return True

        for pos_variant in pos_variants:
            for master_variant in master_match_names_list:
                similarity = SequenceMatcher(None, pos_variant, master_variant).ratio()
                if similarity >= threshold:
                    match_result_cache[normalized_name] = True
                    return True

        match_result_cache[normalized_name] = False
        return False

    pos_rows = (
        db.session.query(
            PosSold.product_name,
            func.sum(PosSold.quantity).label('total_qty'),
            func.sum(PosSold.gross_sales).label('total_gross_sales'),
            func.sum(PosSold.net_sales).label('total_net_sales'),
            func.count(PosSold.id).label('entry_count'),
            func.count(func.distinct(DailyReport.store_id)).label('store_count'),
            func.max(DailyReport.report_date).label('latest_report_date'),
        )
        .join(DailyReport, DailyReport.id == PosSold.daily_report_id)
        .filter(
            DailyReport.report_date >= start_date,
            DailyReport.report_date <= end_date,
        )
        .group_by(PosSold.product_name)
        .all()
    )

    price_timeline_rows = (
        db.session.query(
            PosSold.product_name,
            DailyReport.report_date.label('report_date'),
            func.sum(PosSold.quantity).label('daily_qty'),
            func.sum(PosSold.gross_sales).label('daily_gross_sales'),
        )
        .join(DailyReport, DailyReport.id == PosSold.daily_report_id)
        .filter(
            DailyReport.report_date >= start_date,
            DailyReport.report_date <= end_date,
        )
        .group_by(PosSold.product_name, DailyReport.report_date)
        .order_by(DailyReport.report_date.asc())
        .all()
    )

    price_timeline_by_product = {}
    for row in price_timeline_rows:
        product_name = (row.product_name or '').strip()
        if not product_name:
            continue
        daily_qty = float(row.daily_qty or 0.0)
        if daily_qty <= 0:
            continue
        daily_gross_sales = float(row.daily_gross_sales or 0.0)
        unit_price = daily_gross_sales / daily_qty

        bucket = price_timeline_by_product.setdefault(product_name, [])
        bucket.append({
            'date': row.report_date,
            'unit_price': unit_price,
        })

    unmatched_items = []
    total_unique_pos_products = 0
    matched_unique_products = 0
    unmatched_total_qty = 0
    unmatched_total_net_sales = 0.0

    for row in pos_rows:
        product_name = (row.product_name or '').strip()
        if not product_name or _is_grand_total_product_name(product_name):
            continue

        normalized_name = _normalize_product_text(product_name)
        if not normalized_name:
            continue

        total_unique_pos_products += 1
        aliased_master_name = alias_lookup.get(normalized_name)
        canonical_name = aliased_master_name or product_name
        canonical_normalized_name = _normalize_product_text(canonical_name)
        is_in_master = (
            bool(aliased_master_name)
            or _matches_master_code(product_name)
            or _matches_master_name_exact(canonical_name)
        )
        if is_in_master:
            matched_unique_products += 1
            continue

        total_qty = int(row.total_qty or 0)
        total_gross_sales = float(row.total_gross_sales or 0.0)
        total_net_sales = float(row.total_net_sales or 0.0)
        unmatched_total_qty += total_qty
        unmatched_total_net_sales += total_net_sales

        avg_unit_price = None
        if total_qty > 0:
            avg_unit_price = total_gross_sales / float(total_qty)

        price_change_amount = None
        price_change_percent = None
        price_points = price_timeline_by_product.get(product_name, [])
        if len(price_points) >= 2:
            start_unit_price = float(price_points[0]['unit_price'])
            end_unit_price = float(price_points[-1]['unit_price'])
            price_change_amount = end_unit_price - start_unit_price
            if start_unit_price != 0:
                price_change_percent = (price_change_amount / start_unit_price) * 100.0

        unmatched_items.append({
            'product_name': product_name,
            'product_code': _extract_product_code(product_name),
            'total_qty': total_qty,
            'total_gross_sales': total_gross_sales,
            'total_net_sales': total_net_sales,
            'avg_unit_price': avg_unit_price,
            'unit_price_change': price_change_amount,
            'unit_price_change_pct': price_change_percent,
            'entry_count': int(row.entry_count or 0),
            'store_count': int(row.store_count or 0),
            'latest_report_date': row.latest_report_date,
        })

    unmatched_items = sorted(
        unmatched_items,
        key=lambda item: (
            item.get('latest_report_date') or datetime.min.date(),
            int(item.get('total_qty', 0) or 0),
        ),
        reverse=True,
    )

    rso_rows = (
        db.session.query(
            RsoDelivery.product_name,
            func.sum(RsoDelivery.quantity).label('total_qty'),
            func.sum(func.coalesce(RsoDelivery.received_quantity, RsoDelivery.quantity)).label('total_received_qty'),
            func.count(RsoDelivery.id).label('entry_count'),
            func.count(func.distinct(RsoDelivery.store_id)).label('store_count'),
            func.max(RsoDelivery.report_date).label('latest_report_date'),
        )
        .filter(
            RsoDelivery.report_date >= start_date,
            RsoDelivery.report_date <= end_date,
        )
        .group_by(RsoDelivery.product_name)
        .all()
    )

    unmatched_rso_items = []
    total_unique_rso_products = 0
    matched_unique_rso_products = 0
    unmatched_rso_total_qty = 0
    for row in rso_rows:
        product_name = (row.product_name or '').strip()
        normalized_name = _normalize_product_text(product_name)
        if not normalized_name:
            continue
        total_unique_rso_products += 1
        aliased_master_name = alias_lookup.get(normalized_name)
        canonical_name = aliased_master_name or product_name
        is_in_master = (
            bool(aliased_master_name)
            or _matches_master_code(product_name)
            or _matches_master_name_exact(canonical_name)
        )
        if is_in_master:
            matched_unique_rso_products += 1
            continue

        total_qty = int(row.total_qty or 0)
        unmatched_rso_total_qty += total_qty
        unmatched_rso_items.append({
            'product_name': product_name,
            'product_code': _extract_product_code(product_name),
            'total_qty': total_qty,
            'total_received_qty': int(row.total_received_qty or 0),
            'entry_count': int(row.entry_count or 0),
            'store_count': int(row.store_count or 0),
            'latest_report_date': row.latest_report_date,
        })

    unmatched_rso_items.sort(
        key=lambda item: (
            item.get('latest_report_date') or datetime.min.date(),
            int(item.get('total_qty', 0) or 0),
        ),
        reverse=True,
    )

    pos_upload_details = {}
    unmatched_pos_names = [item['product_name'] for item in unmatched_items if item.get('product_name')]
    if unmatched_pos_names:
        pos_upload_rows = (
            db.session.query(
                PosSold.product_name,
                Store.name.label('store_name'),
                DailyReport.report_date.label('report_date'),
                func.count(PosSold.id).label('entry_count'),
                func.sum(PosSold.quantity).label('total_qty'),
                func.sum(PosSold.net_sales).label('total_net_sales'),
                func.max(PosSold.uploaded_at).label('latest_uploaded_at'),
                func.max(User.username).label('uploaded_by'),
            )
            .select_from(PosSold)
            .join(DailyReport, DailyReport.id == PosSold.daily_report_id)
            .join(Store, Store.id == DailyReport.store_id)
            .outerjoin(User, User.id == DailyReport.submitted_by)
            .filter(
                DailyReport.report_date >= start_date,
                DailyReport.report_date <= end_date,
                PosSold.product_name.in_(unmatched_pos_names),
            )
            .group_by(PosSold.product_name, Store.id, Store.name, DailyReport.report_date)
            .order_by(func.max(PosSold.uploaded_at).desc(), DailyReport.report_date.desc(), Store.name.asc())
            .all()
        )
        for row in pos_upload_rows:
            pos_upload_details.setdefault(row.product_name, []).append({
                'store_name': row.store_name or '-',
                'report_date': row.report_date.strftime('%Y-%m-%d') if row.report_date else '-',
                'entry_count': int(row.entry_count or 0),
                'total_qty': int(row.total_qty or 0),
                'total_net_sales': float(row.total_net_sales or 0.0),
                'uploaded_by': row.uploaded_by or '-',
                'latest_uploaded_at': row.latest_uploaded_at.strftime('%Y-%m-%d %H:%M') if row.latest_uploaded_at else '-',
            })

    rso_upload_details = {}
    unmatched_rso_names = [item['product_name'] for item in unmatched_rso_items if item.get('product_name')]
    if unmatched_rso_names:
        rso_upload_rows = (
            db.session.query(
                RsoDelivery.product_name,
                Store.name.label('store_name'),
                RsoDelivery.report_date.label('report_date'),
                RsoDelivery.upload_source.label('upload_source'),
                func.count(RsoDelivery.id).label('entry_count'),
                func.sum(RsoDelivery.quantity).label('total_qty'),
                func.sum(func.coalesce(RsoDelivery.received_quantity, RsoDelivery.quantity)).label('total_received_qty'),
                func.max(RsoDelivery.uploaded_at).label('latest_uploaded_at'),
                func.max(User.username).label('uploaded_by'),
            )
            .select_from(RsoDelivery)
            .join(Store, Store.id == RsoDelivery.store_id)
            .outerjoin(User, User.id == RsoDelivery.uploaded_by)
            .filter(
                RsoDelivery.report_date >= start_date,
                RsoDelivery.report_date <= end_date,
                RsoDelivery.product_name.in_(unmatched_rso_names),
            )
            .group_by(RsoDelivery.product_name, Store.id, Store.name, RsoDelivery.report_date, RsoDelivery.upload_source)
            .order_by(func.max(RsoDelivery.uploaded_at).desc(), RsoDelivery.report_date.desc(), Store.name.asc())
            .all()
        )
        for row in rso_upload_rows:
            rso_upload_details.setdefault(row.product_name, []).append({
                'store_name': row.store_name or '-',
                'report_date': row.report_date.strftime('%Y-%m-%d') if row.report_date else '-',
                'upload_source': 'Bulk Order' if row.upload_source == 'bulk' else 'Delivery RSO',
                'entry_count': int(row.entry_count or 0),
                'total_qty': int(row.total_qty or 0),
                'total_received_qty': int(row.total_received_qty or 0),
                'uploaded_by': row.uploaded_by or '-',
                'latest_uploaded_at': row.latest_uploaded_at.strftime('%Y-%m-%d %H:%M') if row.latest_uploaded_at else '-',
            })

    return render_template(
        'admin/system_analyzer.html',
        user=current_user,
        start_date=start_date.strftime('%Y-%m-%d'),
        end_date=end_date.strftime('%Y-%m-%d'),
        link_alias=link_alias,
        master_name_options=master_name_options,
        unmatched_items=unmatched_items,
        unmatched_rso_items=unmatched_rso_items,
        pos_upload_details=pos_upload_details,
        rso_upload_details=rso_upload_details,
        summary={
            'total_unique_pos_products': total_unique_pos_products,
            'matched_unique_products': matched_unique_products,
            'unmatched_unique_products': len(unmatched_items),
            'unmatched_total_qty': unmatched_total_qty,
            'unmatched_total_net_sales': unmatched_total_net_sales,
            'total_unique_rso_products': total_unique_rso_products,
            'matched_unique_rso_products': matched_unique_rso_products,
            'unmatched_unique_rso_products': len(unmatched_rso_items),
            'unmatched_rso_total_qty': unmatched_rso_total_qty,
        },
    )


@admin.route('/admin/product-masterlist/upload', methods=['POST'])
@login_required
def upload_product_masterlist():
    if current_user.role not in ('Superadmin', 'Admin'):
        flash('Access denied.', category='error')
        return redirect(url_for('views.home'))

    try:
        if 'file' not in request.files:
            flash('No file uploaded for product masterlist.', category='error')
            return redirect(url_for('admin.product_masterlist'))

        file = request.files['file']
        if not file or file.filename == '':
            flash('No file selected for product masterlist.', category='error')
            return redirect(url_for('admin.product_masterlist'))

        filename_lower = (file.filename or '').lower()
        if filename_lower.endswith('.csv'):
            df = pd.read_csv(file)
        elif filename_lower.endswith(('.xlsx', '.xls')):
            df = pd.read_excel(file)
        else:
            flash('Please upload a .csv, .xlsx, or .xls file.', category='error')
            return redirect(url_for('admin.product_masterlist'))

        required_columns = ['CODE', 'DESCRIPTION', 'CATEGORY', 'SUB_CATEGORY', 'TP', 'SP_P', 'SHELF_LIFE']

        def _norm_col_name(col_name):
            text_value = str(col_name or '').strip().upper().replace('\xa0', ' ')
            return ' '.join(text_value.split())

        normalized_column_map = {}
        for original_col in df.columns:
            normalized_column_map[_norm_col_name(original_col)] = original_col

        missing_columns = [col for col in required_columns if col not in normalized_column_map]
        if 'SP_NP' not in normalized_column_map and 'SP_T' not in normalized_column_map:
            missing_columns.append('SP_NP')
        if missing_columns:
            # Flexible TP mapping for real-world files:
            # accept common TP aliases or fallback to the 5th column when present.
            if 'TP' in missing_columns:
                tp_aliases = (
                    'TRANSFER PRICE',
                    'TRANSFER_PRICE',
                    'T.P',
                    'T P',
                    'TP ',
                )
                resolved_tp_col = None
                for alias in tp_aliases:
                    alias_key = _norm_col_name(alias)
                    if alias_key in normalized_column_map:
                        resolved_tp_col = normalized_column_map[alias_key]
                        break
                if resolved_tp_col is None and len(df.columns) >= 5:
                    resolved_tp_col = df.columns[4]

                if resolved_tp_col is not None:
                    normalized_column_map['TP'] = resolved_tp_col
                    missing_columns = [col for col in missing_columns if col != 'TP']

            if missing_columns:
                flash(
                    'Missing required columns: '
                    f'{", ".join(missing_columns)}. '
                    'Expected CODE, DESCRIPTION, CATEGORY, SUB_CATEGORY, TP, SP_P, SP_NP/SP_T, SHELF_LIFE.',
                    category='error'
                )
                return redirect(url_for('admin.product_masterlist'))

        code_col = normalized_column_map['CODE']
        description_col = normalized_column_map['DESCRIPTION']
        category_col = normalized_column_map['CATEGORY']
        sub_category_col = normalized_column_map['SUB_CATEGORY']
        tp_col = normalized_column_map['TP']
        sp_p_col = normalized_column_map['SP_P']
        sp_np_col = normalized_column_map.get('SP_NP') or normalized_column_map.get('SP_T')
        shelf_life_col = normalized_column_map['SHELF_LIFE']

        created_count = 0
        updated_count = 0
        skipped_count = 0

        for _, row in df.iterrows():
            code_raw = None if pd.isna(row[code_col]) else row[code_col]
            description_value = '' if pd.isna(row[description_col]) else str(row[description_col]).strip()
            category_value = '' if pd.isna(row[category_col]) else str(row[category_col]).strip()
            sub_category_value = '' if pd.isna(row[sub_category_col]) else str(row[sub_category_col]).strip()
            tp_raw = None if pd.isna(row[tp_col]) else row[tp_col]
            sp_p_raw = None if pd.isna(row[sp_p_col]) else row[sp_p_col]
            sp_np_raw = None if pd.isna(row[sp_np_col]) else row[sp_np_col]
            shelf_life_value = '' if pd.isna(row[shelf_life_col]) else str(row[shelf_life_col]).strip()

            if not description_value or not category_value:
                skipped_count += 1
                continue

            code_value = None
            if code_raw is not None and str(code_raw).strip() != '':
                try:
                    code_value = int(float(str(code_raw).strip()))
                except (TypeError, ValueError):
                    code_value = None

            sp_p_value = None
            if sp_p_raw is not None and str(sp_p_raw).strip() != '':
                try:
                    sp_p_value = float(str(sp_p_raw).strip().replace(',', ''))
                except (TypeError, ValueError):
                    sp_p_value = None

            tp_value = None
            if tp_raw is not None and str(tp_raw).strip() != '':
                try:
                    tp_value = float(str(tp_raw).strip().replace(',', ''))
                except (TypeError, ValueError):
                    tp_value = None

            sp_np_value = None
            if sp_np_raw is not None and str(sp_np_raw).strip() != '':
                try:
                    sp_np_value = float(str(sp_np_raw).strip().replace(',', ''))
                except (TypeError, ValueError):
                    sp_np_value = None

            # Insert-as-masterlist behavior: keep rows even when code repeats.
            db.session.add(
                ProductMaster(
                    code=code_value,
                    description=description_value,
                    category=category_value,
                    sub_category=sub_category_value or None,
                    tp=tp_value,
                    sp_p=sp_p_value,
                    sp_np=sp_np_value,
                    shelf_life=shelf_life_value or None,
                )
            )
            created_count += 1

        log_audit_event(
            action='admin.product_masterlist.upload',
            entity_type='ProductMaster',
            entity_id='bulk',
            reason='Uploaded product masterlist file.',
            details={
                'filename': file.filename,
                'created_count': created_count,
                'updated_count': updated_count,
                'skipped_count': skipped_count,
            },
        )
        db.session.commit()

        flash(
            f'Product masterlist uploaded. Inserted: {created_count}, Skipped: {skipped_count}.',
            category='success'
        )
    except Exception as exc:
        db.session.rollback()
        flash(f'Error uploading product masterlist: {str(exc)}', category='error')

    return redirect(url_for('admin.product_masterlist'))


def _get_global_invensync_config():
    config = GlobalInvenSyncConfig.query.first()
    if not config:
        default_data = {
            'hidden_rows': [],
            'hidden_columns': [],
            'hidden_cells': [],
            'locked_rows': [],
            'locked_columns': [],
            'locked_cells': [],
            'editable_columns': [],
            'force_beginning_store_ids': [],
            'store_configs': {},
            'admin_unlocks': {},
        }
        config = GlobalInvenSyncConfig(config_data=json.dumps(default_data))
        db.session.add(config)
        db.session.commit()

    try:
        config_data = json.loads(config.config_data or '{}')
    except ValueError:
        config_data = {
            'hidden_rows': [],
            'hidden_columns': [],
            'hidden_cells': [],
            'locked_rows': [],
            'locked_columns': [],
            'locked_cells': [],
            'editable_columns': [],
            'force_beginning_store_ids': [],
            'store_configs': {},
            'admin_unlocks': {},
        }

    if not isinstance(config_data.get('store_configs'), dict):
        config_data['store_configs'] = {}
    if not isinstance(config_data.get('admin_unlocks'), dict):
        config_data['admin_unlocks'] = {}

    return config, config_data


def _build_single_update_status(dates_set, today, month_start, cutoff_date, label):
    missing_date_values = []
    missing_dates = []
    cursor = month_start
    while cursor <= cutoff_date:
        if cursor == today:
            cursor += timedelta(days=1)
            continue
        if cursor not in dates_set:
            missing_date_values.append(cursor)
            missing_dates.append({
                'iso': cursor.strftime('%Y-%m-%d'),
                'label': cursor.strftime('%b %d, %Y'),
            })
        cursor += timedelta(days=1)

    def format_missing_range(start, end):
        if start == end:
            return f"{start.strftime('%b')} {start.day}, {start.year}"
        if start.year == end.year and start.month == end.month:
            return f"{start.strftime('%b')} {start.day}-{end.day}, {start.year}"
        if start.year == end.year:
            return f"{start.strftime('%b')} {start.day} - {end.strftime('%b')} {end.day}, {start.year}"
        return f"{start.strftime('%b')} {start.day}, {start.year} - {end.strftime('%b')} {end.day}, {end.year}"

    missing_ranges = []
    if missing_date_values:
        range_start = missing_date_values[0]
        previous = missing_date_values[0]
        for missing_date in missing_date_values[1:]:
            if missing_date == previous + timedelta(days=1):
                previous = missing_date
                continue
            missing_ranges.append({
                'start': range_start.strftime('%Y-%m-%d'),
                'end': previous.strftime('%Y-%m-%d'),
                'label': format_missing_range(range_start, previous),
            })
            range_start = missing_date
            previous = missing_date
        missing_ranges.append({
            'start': range_start.strftime('%Y-%m-%d'),
            'end': previous.strftime('%Y-%m-%d'),
            'label': format_missing_range(range_start, previous),
        })

    latest_date = max(dates_set) if dates_set else None
    return {
        'is_up_to_date': len(missing_dates) == 0,
        'missing_dates': missing_dates,
        'missing_ranges': missing_ranges,
        'missing_count': len(missing_dates),
        'latest_date': latest_date,
    }


def _build_admin_invensync_update_status(store_id, month_start, cutoff_date):
    if not store_id or not month_start or not cutoff_date or cutoff_date < month_start:
        return {
            key: {
                'is_up_to_date': False,
                'missing_dates': [],
                'missing_ranges': [],
                'missing_count': 0,
                'latest_date': None,
            }
            for key in ('inventory', 'wastage', 'pos_sold', 'delivery')
        }

    today = date.today()
    previous_day_cutoff = min(cutoff_date, today - timedelta(days=1))
    finalized_dates = {
        row.inventory_date for row in DailyEndingInventory.query.filter(
            DailyEndingInventory.store_id == store_id,
            DailyEndingInventory.inventory_date >= month_start,
            DailyEndingInventory.inventory_date <= cutoff_date,
            DailyEndingInventory.is_finalized.is_(True),
        ).with_entities(DailyEndingInventory.inventory_date).all()
        if row.inventory_date
    }

    taf_wastage_dates = {
        row.transaction_date for row in TafTransfer.query.filter(
            TafTransfer.store_id == store_id,
            TafTransfer.transaction_date >= month_start,
            TafTransfer.transaction_date <= cutoff_date,
            func.lower(func.trim(TafTransfer.transaction_type)) == 'wastage transfer',
        ).with_entities(TafTransfer.transaction_date).all()
        if row.transaction_date
    }

    pos_sold_dates = set()
    delivery_dates = set()
    if previous_day_cutoff >= month_start:
        pos_sold_dates = {
            row.report_date for row in (
                db.session.query(DailyReport.report_date)
                .join(PosSold, PosSold.daily_report_id == DailyReport.id)
                .filter(
                    DailyReport.store_id == store_id,
                    DailyReport.report_date >= month_start,
                    DailyReport.report_date <= previous_day_cutoff,
                )
                .distinct()
                .all()
            )
            if row.report_date
        }
        delivery_dates = {
            row.report_date for row in (
                db.session.query(RsoDelivery.report_date)
                .filter(
                    RsoDelivery.store_id == store_id,
                    RsoDelivery.report_date >= month_start,
                    RsoDelivery.report_date <= previous_day_cutoff,
                )
                .distinct()
                .all()
            )
            if row.report_date
        }

    inventory_status = _build_single_update_status(finalized_dates, today, month_start, cutoff_date, 'inventory')
    wastage_status = _build_single_update_status(taf_wastage_dates, today, month_start, cutoff_date, 'wastage')
    pos_sold_status = _build_single_update_status(pos_sold_dates, today, month_start, previous_day_cutoff, 'pos_sold')
    delivery_status = _build_single_update_status(delivery_dates, today, month_start, previous_day_cutoff, 'delivery')
    return {
        'inventory': inventory_status,
        'wastage': wastage_status,
        'pos_sold': pos_sold_status,
        'delivery': delivery_status,
    }


@admin.route('/admin/invensync')
@login_required
def invensync():
    """Admin view for Invensync ending inventory from all stores"""
    if current_user.role not in ('Superadmin', 'Admin', 'General Manager'):
        flash('Access denied.', category='error')
        return redirect(url_for('views.home'))

    selected_tab = request.args.get('tab', 'summary')
    if current_user.role == 'General Manager' and selected_tab in ('config', 'store_config'):
        selected_tab = 'summary'

    selected_date = date.today()
    update_cutoff_date = selected_date - timedelta(days=1)
    month_start = selected_date.replace(day=1)

    from .views import (
        _apply_store_scope_filter,
        _get_invensync_data_state,
        _get_latest_meaningful_invensync_by_store,
        _get_user_presence_states,
    )

    # Get all stores
    stores = Store.query.order_by(Store.name.asc()).all()
    stores = _apply_store_scope_filter(stores, request)

    # Ignore empty records created by simply opening an InvenSync date. Use
    # each store's latest finalized or meaningfully populated inventory day.
    inventory_by_store = _get_latest_meaningful_invensync_by_store(
        [store.id for store in stores]
    )
    manager_presence = _get_user_presence_states(store.manager_id for store in stores)

    # Build store summary data
    store_summaries = []
    for store in stores:
        inventory = inventory_by_store.get(store.id)
        data_state = _get_invensync_data_state(inventory)
        update_status = _build_admin_invensync_update_status(store.id, month_start, update_cutoff_date)
        
        store_summaries.append({
            'store': store,
            'inventory': inventory,
            'has_data': data_state != 'empty',
            'data_state': data_state,
            'presence_state': manager_presence.get(store.manager_id, 'offline'),
            'update_status': update_status,
        })

    products = ProductMaster.query.order_by(ProductMaster.category.asc(), ProductMaster.description.asc()).all()
    config, config_data = _get_global_invensync_config()
    preview_store = stores[0] if stores else None

    config_fields = [
        {'value': 'beginning_qty', 'label': 'Beg'},
        {'value': 'delivery_qty', 'label': 'Delivery'},
        {'value': 'trans_in_qty', 'label': 'Trans-In'},
        {'value': 'bo_qty', 'label': 'BO'},
        {'value': 'adv_del_qty', 'label': 'Adv'},
        {'value': 'trans_out_qty', 'label': 'Trans-Out'},
        {'value': 'wastage_qty', 'label': 'Waste Qty'},
        {'value': 'wastage_amount', 'label': 'Waste Amt'},
        {'value': 'csi_qty', 'label': 'CSI'},
        {'value': 'quantity_sold', 'label': 'Sold'},
        {'value': 'ending_d5_qty', 'label': 'D+5'},
        {'value': 'ending_d4_qty', 'label': 'D+4'},
        {'value': 'ending_d3_qty', 'label': 'D+3'},
        {'value': 'total_ending_qty', 'label': 'Total EI'},
        {'value': 'total_peso_srp', 'label': 'Total Peso'},
        {'value': 'theo_ending_qty', 'label': 'THEO'},
        {'value': 'variance_qty', 'label': 'Var'},
        {'value': 'variance_peso', 'label': 'Var Peso'},
        {'value': 'remarks', 'label': 'Remarks'},
    ]

    return render_template(
        'admin/invensync.html',
        user=current_user,
        stores=stores,
        store_summaries=store_summaries,
        products=products,
        preview_store=preview_store,
        selected_tab=selected_tab,
        selected_date=selected_date.strftime('%Y-%m-%d'),
        update_cutoff_date=update_cutoff_date.strftime('%Y-%m-%d'),
        today=date.today().strftime('%Y-%m-%d'),
        global_invensync_config=config_data,
        store_invensync_configs=config_data.get('store_configs', {}),
        config_fields=config_fields,
    )


@admin.route('/admin/oracle')
@login_required
def admin_oracle():
    if current_user.role not in ('Superadmin', 'Admin', 'General Manager'):
        flash('Access denied.', category='error')
        return redirect(url_for('views.home'))

    from .views import _apply_store_scope_filter

    clusters = (
        Cluster.query
        .options(
            selectinload(Cluster.manager),
            selectinload(Cluster.stores).selectinload(Store.manager),
        )
        .order_by(Cluster.name.asc())
        .all()
    )

    for cluster in clusters:
        cluster.stores = _apply_store_scope_filter(cluster.stores, request)

    clusters = [c for c in clusters if c.stores]

    unassigned_stores = _apply_store_scope_filter(
        Store.query
        .options(selectinload(Store.manager))
        .filter(Store.cluster_id.is_(None))
        .order_by(Store.name.asc())
        .all(),
        request,
    )

    clustered_store_ids = [
        int(store.id)
        for cluster in clusters
        for store in cluster.stores
    ]
    assigned_store_count = len(clustered_store_ids)
    configured_store_ids = {
        int(store_id)
        for store_id, in (
            db.session.query(StoreProductBuffer.store_id)
            .filter(StoreProductBuffer.store_id.in_(clustered_store_ids))
            .distinct()
            .all()
        )
    } if clustered_store_ids else set()
    product_count = ProductMaster.query.count()

    cluster_cards = []
    for cluster in clusters:
        stores = sorted(cluster.stores, key=lambda store: (store.name or '').lower())
        configured_count = sum(1 for store in stores if int(store.id) in configured_store_ids)
        cluster_cards.append({
            'cluster': cluster,
            'stores': stores,
            'store_count': len(stores),
            'configured_count': configured_count,
            'manager_name': (cluster.manager.full_name or cluster.manager.username) if cluster.manager else 'Unassigned',
        })

    return render_template(
        'admin/oracle.html',
        user=current_user,
        cluster_cards=cluster_cards,
        unassigned_stores=unassigned_stores,
        summary={
            'cluster_count': len(clusters),
            'assigned_store_count': assigned_store_count,
            'configured_store_count': len(configured_store_ids),
            'product_count': product_count,
        },
    )


@admin.route('/admin/invensync/config', methods=['POST'])
@login_required
def update_invensync_config():
    if current_user.role not in ('Superadmin', 'Admin'):
        return jsonify({'success': False, 'message': 'Access denied.'}), 403

    try:
        data = request.get_json(force=True) or {}
        config, existing_data = _get_global_invensync_config()

        normalized_data = {
            'hidden_rows': [str(item).strip() for item in data.get('hidden_rows', []) if str(item).strip()],
            'hidden_columns': [str(item).strip() for item in data.get('hidden_columns', []) if str(item).strip()],
            'hidden_cells': [str(item).strip() for item in data.get('hidden_cells', []) if str(item).strip()],
            'locked_rows': [str(item).strip() for item in data.get('locked_rows', []) if str(item).strip()],
            'locked_columns': [str(item).strip() for item in data.get('locked_columns', []) if str(item).strip()],
            'locked_cells': [str(item).strip() for item in data.get('locked_cells', []) if str(item).strip()],
            'editable_columns': [str(item).strip() for item in data.get('editable_columns', []) if str(item).strip()],
            'force_beginning_store_ids': [
                int(item)
                for item in data.get('force_beginning_store_ids', existing_data.get('force_beginning_store_ids', []))
                if str(item).isdigit()
            ],
            'store_configs': existing_data.get('store_configs', {}) if isinstance(existing_data.get('store_configs'), dict) else {},
            'admin_unlocks': existing_data.get('admin_unlocks', {}) if isinstance(existing_data.get('admin_unlocks'), dict) else {},
        }

        config.config_data = json.dumps(normalized_data)
        db.session.commit()

        return jsonify({'success': True, 'message': 'Global Invensync settings updated.'})
    except Exception as exc:
        db.session.rollback()
        return jsonify({'success': False, 'message': str(exc)}), 500


@admin.route('/admin/invensync/store-config', methods=['POST'])
@login_required
def update_store_invensync_config():
    if current_user.role not in ('Superadmin', 'Admin'):
        return jsonify({'success': False, 'message': 'Access denied.'}), 403

    try:
        data = request.get_json(force=True) or {}
        store_id = int(data.get('store_id', 0) or 0)
        store = Store.query.get(store_id)
        if not store:
            return jsonify({'success': False, 'message': 'Store not found.'}), 404

        config, config_data = _get_global_invensync_config()
        store_configs = config_data.get('store_configs', {})
        if not isinstance(store_configs, dict):
            store_configs = {}

        store_configs[str(store_id)] = {
            'hidden_columns': [str(item).strip() for item in data.get('hidden_columns', []) if str(item).strip()],
            'locked_columns': [str(item).strip() for item in data.get('locked_columns', []) if str(item).strip()],
            'editable_columns': [str(item).strip() for item in data.get('editable_columns', []) if str(item).strip()],
        }

        config_data['store_configs'] = store_configs
        config.config_data = json.dumps(config_data)
        db.session.commit()

        return jsonify({'success': True, 'message': f'Invensync settings saved for {store.name}.'})
    except (TypeError, ValueError):
        return jsonify({'success': False, 'message': 'Select a valid store.'}), 400
    except Exception as exc:
        db.session.rollback()
        return jsonify({'success': False, 'message': str(exc)}), 500


@admin.route('/admin/invensync/inventory-correction', methods=['POST'])
@login_required
def save_invensync_inventory_correction():
    """Apply explicit, cell-level corrections without changing the day's lock state."""
    if current_user.role not in ('Superadmin', 'Admin'):
        return jsonify({'success': False, 'message': 'Access denied.'}), 403

    editable_fields = {
        'beginning_qty', 'delivery_qty', 'trans_in_qty', 'bo_qty',
        'adv_del_qty', 'trans_out_qty', 'wastage_qty', 'csi_qty',
        'quantity_sold', 'ending_d5_qty', 'ending_d4_qty',
        'ending_d3_qty', 'remarks',
    }
    numeric_fields = editable_fields - {'remarks'}

    try:
        data = request.get_json(force=True) or {}
        inventory_id = int(data.get('inventory_id', 0) or 0)
        inventory = DailyEndingInventory.query.get(inventory_id)
        if not inventory:
            return jsonify({'success': False, 'message': 'Inventory not found.'}), 404

        changes = data.get('changes', [])
        if not isinstance(changes, list) or not changes:
            return jsonify({'success': False, 'message': 'No changes were submitted.'}), 400

        changed_items = {}
        audit_changes = []
        for change in changes:
            field = str(change.get('field', '')).strip()
            if field not in editable_fields:
                return jsonify({'success': False, 'message': f'{field or "Unknown field"} cannot be edited.'}), 400

            item_id = int(change.get('item_id', 0) or 0)
            item = DailyEndingInventoryItem.query.filter_by(
                id=item_id,
                inventory_id=inventory.id,
            ).first()
            if not item:
                return jsonify({'success': False, 'message': 'An inventory item was not found.'}), 404

            old_value = getattr(item, field)
            if field in numeric_fields:
                raw_value = change.get('value', 0)
                new_value = int(float(raw_value)) if str(raw_value).strip() else 0
            else:
                new_value = str(change.get('value', '') or '').strip()

            setattr(item, field, new_value)
            changed_items[item.id] = item
            audit_changes.append({
                'item_id': item.id,
                'product': item.product_description,
                'field': field,
                'old': old_value,
                'new': new_value,
            })

        # Keep totals, theoretical inventory, and variances consistent.
        from .views import _recalculate_inventory_item
        for item in changed_items.values():
            _recalculate_inventory_item(item)

        log_audit_event(
            action='UPDATE',
            entity_type='InvenSync Admin Correction',
            entity_id=inventory.id,
            details={
                'store_id': inventory.store_id,
                'inventory_date': str(inventory.inventory_date),
                'changes': audit_changes,
            },
        )
        db.session.commit()
        return jsonify({
            'success': True,
            'message': f'{len(audit_changes)} inventory cell change(s) saved.',
        })
    except (TypeError, ValueError):
        db.session.rollback()
        return jsonify({'success': False, 'message': 'Enter a valid whole number.'}), 400
    except Exception as exc:
        db.session.rollback()
        return jsonify({'success': False, 'message': str(exc)}), 500


@admin.route('/admin/invensync/unlock-scope', methods=['POST'])
@login_required
def update_invensync_unlock_scope():
    """Persist admin unlock/lock scope for a selected store/date inventory page."""
    if current_user.role not in ('Superadmin', 'Admin'):
        return jsonify({'success': False, 'message': 'Access denied.'}), 403

    try:
        data = request.get_json(force=True) or {}
        inventory_id = int(data.get('inventory_id', 0) or 0)
        action = str(data.get('action') or '').strip().lower()
        scope = str(data.get('scope') or '').strip().lower()
        raw_cells = data.get('cells', [])

        if action not in ('unlock', 'lock') or scope not in ('all', 'cells'):
            return jsonify({'success': False, 'message': 'Invalid lock action.'}), 400

        inventory = DailyEndingInventory.query.get(inventory_id)
        if not inventory:
            return jsonify({'success': False, 'message': 'Inventory not found.'}), 404

        allowed_fields = {
            'beginning_qty', 'delivery_qty', 'trans_in_qty', 'bo_qty',
            'adv_del_qty', 'trans_out_qty', 'wastage_qty', 'csi_qty',
            'quantity_sold', 'ending_d5_qty', 'ending_d4_qty',
            'ending_d3_qty', 'remarks',
        }
        valid_item_ids = {
            int(item_id)
            for item_id, in (
                db.session.query(DailyEndingInventoryItem.id)
                .filter(DailyEndingInventoryItem.inventory_id == inventory.id)
                .all()
            )
        }

        normalized_cells = []
        if isinstance(raw_cells, list):
            for cell in raw_cells:
                if not isinstance(cell, dict):
                    continue
                item_id = int(cell.get('item_id', 0) or 0)
                field = str(cell.get('field') or '').strip()
                if item_id in valid_item_ids and field in allowed_fields:
                    normalized_cells.append(f'{item_id}|{field}')

        config, config_data = _get_global_invensync_config()
        admin_unlocks = config_data.get('admin_unlocks', {})
        if not isinstance(admin_unlocks, dict):
            admin_unlocks = {}
        store_key = str(inventory.store_id)
        date_key = inventory.inventory_date.isoformat()
        store_unlocks = admin_unlocks.get(store_key, {})
        if not isinstance(store_unlocks, dict):
            store_unlocks = {}
        unlock_data = store_unlocks.get(date_key, {})
        if not isinstance(unlock_data, dict):
            unlock_data = {}

        current_cells = {
            str(item).strip()
            for item in unlock_data.get('cells', [])
            if str(item).strip()
        }

        if action == 'unlock' and scope == 'all':
            unlock_data['all'] = True
            unlock_data['cells'] = []
        elif action == 'lock' and scope == 'all':
            unlock_data = {}
        elif action == 'unlock' and scope == 'cells':
            if not normalized_cells:
                return jsonify({'success': False, 'message': 'No valid cells selected.'}), 400
            current_cells.update(normalized_cells)
            unlock_data['all'] = bool(unlock_data.get('all'))
            unlock_data['cells'] = sorted(current_cells)
        elif action == 'lock' and scope == 'cells':
            current_cells.difference_update(normalized_cells)
            unlock_data['all'] = bool(unlock_data.get('all'))
            unlock_data['cells'] = sorted(current_cells)

        if unlock_data.get('all') or unlock_data.get('cells'):
            unlock_data['updated_by'] = current_user.id
            unlock_data['updated_at'] = datetime.now().isoformat()
            store_unlocks[date_key] = unlock_data
            admin_unlocks[store_key] = store_unlocks
        else:
            store_unlocks.pop(date_key, None)
            if store_unlocks:
                admin_unlocks[store_key] = store_unlocks
            else:
                admin_unlocks.pop(store_key, None)

        config_data['admin_unlocks'] = admin_unlocks
        config.config_data = json.dumps(config_data)
        db.session.commit()

        log_audit_event(
            action=f'admin.invensync.{action}_{scope}',
            entity_type='DailyEndingInventory',
            entity_id=inventory.id,
            details={
                'store_id': inventory.store_id,
                'inventory_date': date_key,
                'scope': scope,
                'cell_count': len(normalized_cells),
            },
            commit=True,
        )

        message = (
            'All InvenSync cells are now unlocked for this store/date.'
            if action == 'unlock' and scope == 'all'
            else 'All InvenSync cells are now locked again for this store/date.'
            if action == 'lock' and scope == 'all'
            else f'{len(normalized_cells)} selected cell(s) {"unlocked" if action == "unlock" else "locked"} for this store/date.'
        )
        return jsonify({'success': True, 'message': message})
    except (TypeError, ValueError):
        return jsonify({'success': False, 'message': 'Invalid unlock request.'}), 400
    except Exception as exc:
        db.session.rollback()
        return jsonify({'success': False, 'message': str(exc)}), 500


@admin.route('/admin/invensync/force-beginning', methods=['POST'])
@login_required
def force_invensync_beginning():
    if current_user.role not in ('Superadmin', 'Admin'):
        return jsonify({'success': False, 'message': 'Access denied.'}), 403

    try:
        data = request.get_json(force=True) or {}
        store_id = int(data.get('store_id', 0) or 0)
        store = Store.query.get(store_id)
        if not store:
            return jsonify({'success': False, 'message': 'Store not found.'}), 404

        config, config_data = _get_global_invensync_config()
        forced_ids = {
            int(item) for item in config_data.get('force_beginning_store_ids', [])
            if str(item).isdigit()
        }
        forced_ids.add(store_id)
        config_data['force_beginning_store_ids'] = sorted(forced_ids)
        config.config_data = json.dumps(config_data)
        db.session.commit()
        return jsonify({
            'success': True,
            'message': f'Beginning entry enabled for {store.name}. It will turn off after Beginning is saved.'
        })
    except (TypeError, ValueError):
        return jsonify({'success': False, 'message': 'Select a valid store.'}), 400
    except Exception as exc:
        db.session.rollback()
        return jsonify({'success': False, 'message': str(exc)}), 500


@admin.route('/admin/update-store-pricing', methods=['POST'], endpoint='update_store_pricing')
@login_required
def update_store_pricing():
    """Update store pricing tier (premium/non_premium)"""
    if current_user.role not in ('Superadmin', 'Admin'):
        return jsonify({'success': False, 'message': 'Access denied'}), 403
    
    try:
        data = request.get_json()
        store_id = data.get('store_id')
        tier = data.get('tier')
        
        if not store_id or tier not in ['premium', 'non_premium']:
            return jsonify({'success': False, 'message': 'Invalid data'}), 400
        
        store = Store.query.get(store_id)
        if not store:
            return jsonify({'success': False, 'message': 'Store not found'}), 404
        
        # Update store group
        old_tier = store.store_group
        store.store_group = tier
        db.session.commit()
        
        # Log this action (don't let audit logging fail the update)
        try:
            log_audit_event(
                action='UPDATE_STORE_PRICING',
                entity_type='Store',
                entity_id=store.id,
                details=f'Changed store "{store.name}" pricing tier from {old_tier} to {tier}',
                actor_user=current_user.id
            )
        except Exception as audit_error:
            # Log audit error but don't fail the transaction
            print(f'Audit logging error: {audit_error}')
        
        return jsonify({'success': True, 'message': f'Updated to {tier}'})
    
    except Exception as e:
        db.session.rollback()
        import traceback
        error_trace = traceback.format_exc()
        print(f'Error updating store pricing: {error_trace}')
        return jsonify({'success': False, 'message': f'Server error: {str(e)}'}), 500


@admin.route('/admin/taf')
@login_required
def admin_taf():
    """Admin view for Transaction Activity Forms from all stores"""
    if current_user.role not in ('Superadmin', 'Admin'):
        flash('Access denied.', category='error')
        return redirect(url_for('admin.dashboard'))

    # Get selected date (default to today)
    selected_date_str = request.args.get('date', '')
    if selected_date_str:
        try:
            selected_date = datetime.strptime(selected_date_str, '%Y-%m-%d').date()
        except ValueError:
            selected_date = date.today()
    else:
        selected_date = date.today()

    page = request.args.get('page', 1, type=int)
    search_query = (request.args.get('q') or '').strip()
    type_filter = (request.args.get('type') or '').strip().lower()
    status_filter = (request.args.get('status') or '').strip().lower()
    store_filter = (request.args.get('store') or '').strip().lower()

    transfer_query = TafTransfer.query.options(
        selectinload(TafTransfer.store),
        selectinload(TafTransfer.submitter)
    ).outerjoin(Store, TafTransfer.store_id == Store.id)

    if search_query:
        like_query = f'%{search_query.lower()}%'
        transfer_query = transfer_query.filter(or_(
            func.lower(TafTransfer.control_no).like(like_query),
            func.lower(TafTransfer.transaction_type).like(like_query),
            func.lower(TafTransfer.transfer_from).like(like_query),
            func.lower(TafTransfer.transfer_to).like(like_query),
            func.lower(Store.name).like(like_query),
        ))

    if type_filter:
        type_values = [type_filter]
        if type_filter == 'egi plant transfer':
            type_values.append('supplies transfer')
        transfer_query = transfer_query.filter(func.lower(func.trim(TafTransfer.transaction_type)).in_(type_values))

    if status_filter:
        status_expression = func.lower(func.trim(TafTransfer.status))
        if status_filter == 'pending':
            transfer_query = transfer_query.filter(or_(
                status_expression == status_filter,
                TafTransfer.status.is_(None),
                func.trim(TafTransfer.status) == '',
            ))
        else:
            transfer_query = transfer_query.filter(status_expression == status_filter)

    if store_filter:
        transfer_query = transfer_query.filter(func.lower(func.trim(Store.name)) == store_filter)

    transfer_query = transfer_query.order_by(
        TafTransfer.transaction_date.desc(),
        TafTransfer.id.desc()
    )
    pagination = transfer_query.paginate(page=page, per_page=15, error_out=False)
    transfers = pagination.items
    total_transfers = TafTransfer.query.count()
    pending_transfers = TafTransfer.query.filter_by(status='Pending').count()

    # Get item counts for each transfer
    transfer_ids = [transfer.id for transfer in transfers]
    item_count_by_transfer = {}
    if transfer_ids:
        item_count_by_transfer = {
            int(transfer_id): int(item_count or 0)
            for transfer_id, item_count in (
                db.session.query(
                    TafTransferItem.transfer_id,
                    func.count(TafTransferItem.id),
                )
                .filter(TafTransferItem.transfer_id.in_(transfer_ids))
                .group_by(TafTransferItem.transfer_id)
                .all()
            )
        }

    return render_template(
        'admin/taf.html',
        user=current_user,
        transfers=transfers,
        item_count_by_transfer=item_count_by_transfer,
        selected_date=selected_date.strftime('%Y-%m-%d'),
        pagination=pagination,
        total_transfers=total_transfers,
        pending_transfers=pending_transfers,
        received_transfers=max(0, total_transfers - pending_transfers),
        filter_stores=Store.query.order_by(Store.name.asc()).all(),
        filters={
            'q': search_query,
            'type': type_filter,
            'status': status_filter,
            'store': store_filter,
        },
    )


def _recalculate_daily_inventory_item(item):
    from .views import _recalculate_inventory_item
    _recalculate_inventory_item(item)


def _find_or_create_inventory_item_for_product(inventory, product):
    inventory_item = DailyEndingInventoryItem.query.filter_by(
        inventory_id=inventory.id,
        product_master_id=product.id,
    ).first()
    if not inventory_item:
        inventory_item = DailyEndingInventoryItem(
            inventory_id=inventory.id,
            product_master_id=product.id,
            product_code=product.code,
            product_description=product.description,
            srp_price=product.sp_p or 0.0,
        )
        db.session.add(inventory_item)
        db.session.flush()
    return inventory_item


def _non_wastage_taf_trans_out_quantity(store, transaction_date, item_name):
    if not store or not transaction_date or not item_name:
        return 0
    quantity = (
        db.session.query(func.coalesce(func.sum(TafTransferItem.quantity), 0))
        .join(TafTransfer, TafTransfer.id == TafTransferItem.transfer_id)
        .filter(TafTransfer.store_id == store.id)
        .filter(TafTransfer.transaction_date == transaction_date)
        .filter(TafTransferItem.item_name == item_name)
        .filter(func.lower(func.trim(TafTransfer.transaction_type)).in_([
            'product transfer',
            'egi plant transfer',
            'supplies transfer',
        ]))
        .scalar()
    )
    return int(quantity or 0)


def _clamp_taf_trans_out_without_wastage(store, transaction_date, item_name, current_qty, wastage_qty):
    expected_non_wastage_qty = _non_wastage_taf_trans_out_quantity(store, transaction_date, item_name)
    adjusted_qty = max(0, int(current_qty or 0) - int(wastage_qty or 0))
    return max(expected_non_wastage_qty, adjusted_qty)


def _sync_taf_wastage_inventory_for_store_date(store, transaction_date):
    from .views import _build_taf_wastage_quantity_by_master_id

    if not store or not transaction_date:
        return

    inventory = DailyEndingInventory.query.filter_by(
        store_id=store.id,
        inventory_date=transaction_date,
    ).first()
    if not inventory:
        inventory = DailyEndingInventory(
            store_id=store.id,
            inventory_date=transaction_date,
            created_by=current_user.id,
        )
        db.session.add(inventory)
        db.session.flush()

    wastage_by_master_id = _build_taf_wastage_quantity_by_master_id(store, transaction_date)
    for product_master_id, quantity in wastage_by_master_id.items():
        product = ProductMaster.query.get(product_master_id)
        if not product:
            continue
        inventory_item = _find_or_create_inventory_item_for_product(inventory, product)
        inventory_item.wastage_qty = max(0, int(quantity or 0))
        _recalculate_daily_inventory_item(inventory_item)


def _reverse_inventory_trans_quantities(transfer_record):
    """
    Reverse Trans-In/Trans-Out quantities in DailyEndingInventoryItem when a TAF is deleted.
    This undoes the inventory changes made when the transfer was originally submitted.
    """
    from .models import DailyEndingInventory, DailyEndingInventoryItem
    
    transaction_type = str(transfer_record.transaction_type or '').strip()
    transaction_date = transfer_record.transaction_date
    transfer_from = transfer_record.transfer_from
    transfer_to = transfer_record.transfer_to
    
    # Get the transfer items
    transfer_items = TafTransferItem.query.filter_by(transfer_id=transfer_record.id).all()
    
    # Find the source store
    source_store = Store.query.filter_by(name=transfer_from).first()
    if source_store:
        # Find inventory record for source store
        source_inventory = DailyEndingInventory.query.filter_by(
            store_id=source_store.id,
            inventory_date=transaction_date
        ).first()
        
        if source_inventory:
            # Reverse source-side quantities for the transfer type.
            for item in transfer_items:
                item_name = item.item_name
                quantity = item.quantity
                
                # Find inventory item for source store
                source_inventory_item = DailyEndingInventoryItem.query.filter_by(
                    inventory_id=source_inventory.id,
                    product_description=item_name
                ).first()
                
                if source_inventory_item:
                    if transaction_type == 'Wastage Transfer':
                        source_inventory_item.wastage_qty = max(0, (source_inventory_item.wastage_qty or 0) - quantity)
                        source_inventory_item.trans_out_qty = _clamp_taf_trans_out_without_wastage(
                            source_store,
                            transaction_date,
                            item_name,
                            source_inventory_item.trans_out_qty,
                            quantity,
                        )
                    else:
                        source_inventory_item.trans_out_qty = max(0, (source_inventory_item.trans_out_qty or 0) - quantity)
                    
                    # Recalculate theoretical ending quantity
                    source_inventory_item.theo_ending_qty = (
                        (source_inventory_item.beginning_qty or 0) +
                        (source_inventory_item.delivery_qty or 0) +
                        (source_inventory_item.trans_in_qty or 0) +
                        (source_inventory_item.bo_qty or 0) +
                        (source_inventory_item.adv_del_qty or 0) -
                        (source_inventory_item.trans_out_qty or 0) -
                        (source_inventory_item.wastage_qty or 0) -
                        (source_inventory_item.csi_qty or 0) -
                        (source_inventory_item.quantity_sold or 0)
                    )
    
    # For Product Transfer, also reverse Trans-In for destination store
    if transaction_type == 'Product Transfer':
        dest_store = Store.query.filter_by(name=transfer_to).first()
        if dest_store:
            # Find inventory record for destination store
            dest_inventory = DailyEndingInventory.query.filter_by(
                store_id=dest_store.id,
                inventory_date=transaction_date
            ).first()
            
            if dest_inventory:
                # Reverse Trans-In quantities for destination store
                for item in transfer_items:
                    item_name = item.item_name
                    quantity = item.received_quantity if item.received_quantity is not None else item.quantity
                    
                    # Find inventory item for destination store
                    dest_inventory_item = DailyEndingInventoryItem.query.filter_by(
                        inventory_id=dest_inventory.id,
                        product_description=item_name
                    ).first()
                    
                    if dest_inventory_item:
                        # Subtract from trans_in_qty
                        dest_inventory_item.trans_in_qty = max(0, (dest_inventory_item.trans_in_qty or 0) - quantity)
                        
                        # Recalculate theoretical ending quantity
                        dest_inventory_item.theo_ending_qty = (
                            (dest_inventory_item.beginning_qty or 0) +
                            (dest_inventory_item.delivery_qty or 0) +
                            (dest_inventory_item.trans_in_qty or 0) +
                            (dest_inventory_item.bo_qty or 0) +
                            (dest_inventory_item.adv_del_qty or 0) -
                            (dest_inventory_item.trans_out_qty or 0) -
                            (dest_inventory_item.wastage_qty or 0) -
                            (dest_inventory_item.csi_qty or 0) -
                            (dest_inventory_item.quantity_sold or 0)
                        )


def _apply_inventory_trans_quantities(transfer_record):
    """Apply the inventory effect represented by a TAF after an admin edit."""
    transaction_type = str(transfer_record.transaction_type or '').strip()
    source_store = Store.query.filter_by(name=transfer_record.transfer_from).first()
    source_inventory = DailyEndingInventory.query.filter_by(
        store_id=source_store.id,
        inventory_date=transfer_record.transaction_date,
    ).first() if source_store else None

    destination_store = Store.query.filter_by(name=transfer_record.transfer_to).first()
    destination_inventory = DailyEndingInventory.query.filter_by(
        store_id=destination_store.id,
        inventory_date=transfer_record.transaction_date,
    ).first() if destination_store and transaction_type == 'Product Transfer' else None

    if transaction_type == 'Wastage Transfer':
        _sync_taf_wastage_inventory_for_store_date(source_store, transfer_record.transaction_date)
        return

    for transfer_item in transfer_record.items:
        if source_inventory:
            source_item = DailyEndingInventoryItem.query.filter_by(
                inventory_id=source_inventory.id,
                product_description=transfer_item.item_name,
            ).first()
            if source_item:
                source_item.trans_out_qty = (source_item.trans_out_qty or 0) + int(transfer_item.quantity or 0)
                source_item.theo_ending_qty = (
                    (source_item.beginning_qty or 0) + (source_item.delivery_qty or 0)
                    + (source_item.trans_in_qty or 0) + (source_item.bo_qty or 0)
                    + (source_item.adv_del_qty or 0) - (source_item.trans_out_qty or 0)
                    - (source_item.wastage_qty or 0) - (source_item.csi_qty or 0)
                    - (source_item.quantity_sold or 0)
                )

        if destination_inventory:
            destination_item = DailyEndingInventoryItem.query.filter_by(
                inventory_id=destination_inventory.id,
                product_description=transfer_item.item_name,
            ).first()
            if destination_item:
                received_qty = transfer_item.received_quantity
                quantity = int(received_qty if received_qty is not None else transfer_item.quantity or 0)
                destination_item.trans_in_qty = (destination_item.trans_in_qty or 0) + quantity
                destination_item.theo_ending_qty = (
                    (destination_item.beginning_qty or 0) + (destination_item.delivery_qty or 0)
                    + (destination_item.trans_in_qty or 0) + (destination_item.bo_qty or 0)
                    + (destination_item.adv_del_qty or 0) - (destination_item.trans_out_qty or 0)
                    - (destination_item.wastage_qty or 0) - (destination_item.csi_qty or 0)
                    - (destination_item.quantity_sold or 0)
                )


@admin.route('/admin/taf/edit/<int:transfer_id>', methods=['GET', 'POST'])
@login_required
def admin_edit_taf(transfer_id):
    if current_user.role not in ('Superadmin', 'Admin'):
        flash('Access denied.', category='error')
        return redirect(url_for('admin.dashboard'))

    transfer = TafTransfer.query.options(selectinload(TafTransfer.items)).get_or_404(transfer_id)
    if request.method == 'POST':
        try:
            _reverse_inventory_trans_quantities(transfer)
            transfer.transaction_date = datetime.strptime(request.form['transaction_date'], '%Y-%m-%d').date()
            transfer.control_no = (request.form.get('control_no') or '').strip()
            transfer.transaction_type = (request.form.get('transaction_type') or '').strip()
            transfer_to = (request.form.get('transfer_to') or '').strip()
            if transfer.transaction_type == 'Wastage Transfer':
                transfer_to = 'Main Office'
            elif transfer.transaction_type in ('EGI Plant Transfer', 'Supplies Transfer'):
                transfer_to = 'EGI Plant'
            transfer.transfer_to = transfer_to
            transfer.prepared_by_name = (request.form.get('prepared_by_name') or '').strip()
            transfer.received_by_name = (request.form.get('received_by_name') or '').strip() or None
            transfer.status = (request.form.get('status') or 'Pending').strip()

            item_ids = request.form.getlist('item_id[]')
            item_names = request.form.getlist('item_name[]')
            unit_costs = request.form.getlist('unit_cost[]')
            quantities = request.form.getlist('quantity[]')
            received_quantities = request.form.getlist('received_quantity[]')
            remarks = request.form.getlist('remarks[]')
            existing_items = {str(item.id): item for item in transfer.items}
            kept_ids = set()
            grand_total = 0.0
            for index, item_name in enumerate(item_names):
                item_name = item_name.strip()
                if not item_name:
                    continue
                item_id = item_ids[index] if index < len(item_ids) else ''
                item = existing_items.get(item_id) or TafTransferItem(transfer=transfer)
                if item.id:
                    kept_ids.add(item.id)
                unit_cost = max(0.0, float(unit_costs[index] or 0))
                quantity = max(0, int(quantities[index] or 0))
                received_raw = received_quantities[index].strip() if index < len(received_quantities) else ''
                item.item_name = item_name
                item.unit_cost = unit_cost
                item.quantity = quantity
                item.received_quantity = max(0, int(received_raw)) if received_raw else None
                item.short_over_qty = (item.received_quantity - quantity) if item.received_quantity is not None else 0
                item.line_total = unit_cost * quantity
                item.remarks = remarks[index].strip() if index < len(remarks) else None
                grand_total += item.line_total
            for old_item in list(transfer.items):
                if old_item.id and old_item.id not in kept_ids:
                    db.session.delete(old_item)
            transfer.grand_total = grand_total
            db.session.flush()
            _apply_inventory_trans_quantities(transfer)
            log_audit_event(
                action='taf.edit', entity_type='TafTransfer', entity_id=transfer.id,
                reason=f'Admin edited TAF transfer {transfer.control_no}',
                details={'control_no': transfer.control_no, 'item_count': len(item_names)},
            )
            db.session.commit()
            flash('TAF updated successfully.', category='success')
            return redirect(url_for('admin.admin_taf'))
        except Exception as exc:
            db.session.rollback()
            flash(f'Unable to update TAF: {str(exc)}', category='error')

    return render_template(
        'admin/taf_edit.html',
        user=current_user,
        transfer=transfer,
        stores=Store.query.order_by(Store.name.asc()).all(),
    )


@admin.route('/admin/taf/delete/<int:transfer_id>', methods=['POST'])
@login_required
def admin_delete_taf(transfer_id):
    """Delete a TAF transfer and reverse inventory changes"""
    if current_user.role not in ('Superadmin', 'Admin'):
        return jsonify({'success': False, 'error': 'Access denied.'}), 403

    try:
        # Get the transfer record
        transfer = TafTransfer.query.get_or_404(transfer_id)
        
        # Reverse inventory changes before deleting
        _reverse_inventory_trans_quantities(transfer)
        
        # Log the deletion
        log_audit_event(
            action='taf.delete',
            entity_type='TafTransfer',
            entity_id=transfer.id,
            reason=f'Admin deleted TAF transfer {transfer.control_no}',
            details={
                'control_no': transfer.control_no,
                'transaction_type': transfer.transaction_type,
                'store_id': transfer.store_id,
                'transaction_date': transfer.transaction_date.strftime('%Y-%m-%d') if transfer.transaction_date else None,
            },
        )
        
        # Delete the transfer (cascade will delete items)
        db.session.delete(transfer)
        db.session.commit()
        
        return jsonify({
            'success': True,
            'message': f'Transfer {transfer.control_no} deleted successfully'
        })
    except Exception as e:
        db.session.rollback()
        import traceback
        error_trace = traceback.format_exc()
        print(f'Error deleting TAF: {error_trace}')
        return jsonify({'success': False, 'error': f'Failed to delete transfer: {str(e)}'}), 500
