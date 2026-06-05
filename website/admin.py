from flask import Blueprint, redirect, render_template, request, url_for, flash, jsonify
from .models import User, Store, Cluster, DailyReport, StoreTarget, ProductMaster, ProductAlias, AuditLog, GlobalInvenSyncConfig, PosSold, MenuInventoryItem, DailyEndingInventory, DailyEndingInventoryItem, TafTransfer, TafTransferItem
from . import db
from .audit import log_audit_event, verify_audit_chain
from werkzeug.security import generate_password_hash
from flask_login import login_required, current_user
from sqlalchemy import or_, cast, String, func
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
    return current_user.role in ('Superadmin', 'Admin')


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
    if current_user.role not in ('Superadmin', 'Admin'):
        flash('Access denied. Only Admins and Superadmins can access this page.', category='error')
        return redirect(url_for('views.home'))

    apply_filter = (request.args.get('apply') or '').strip() == '1'
    selected_cluster_id = request.args.get('cluster_id', type=int)
    selected_store_id = request.args.get('store_id', type=int)
    today = datetime.today().date()
    default_start_date_str = today.replace(day=1).strftime('%Y-%m-%d')
    start_date_raw = (request.args.get('start_date') or default_start_date_str).strip()
    end_date_raw = (request.args.get('end_date') or '').strip()

    clusters = Cluster.query.order_by(Cluster.name.asc()).all()
    cluster_lookup = {int(cluster.id): cluster for cluster in clusters}

    stores = Store.query.order_by(Store.name.asc()).all()
    stores_for_selected_cluster = [
        store for store in stores if selected_cluster_id and int(store.cluster_id or 0) == int(selected_cluster_id)
    ] if selected_cluster_id else []

    table_rows = []
    total_qty = 0
    total_gross_sales = 0.0
    total_discount = 0.0
    total_net_sales = 0.0
    distinct_store_ids = set()

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
        clusters=clusters,
        stores=stores,
        stores_for_selected_cluster=stores_for_selected_cluster,
        apply_filter=apply_filter,
        can_show_results=can_show_results,
        selected_cluster_id=selected_cluster_id,
        selected_store_id=selected_store_id,
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


@admin.route('/admin/dashboard')
@login_required
def dashboard():
    if current_user.role not in ('Superadmin', 'Admin'):
        flash('Access denied. Only Admins and Superadmins can access this page.', category='error')
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
        _build_cluster_manager_summary,
        _build_discount_performance,
        _build_wastage_performance,
        _build_ytd_overview,
        _classify_store_status,
        _format_header_date,
    )
    from types import SimpleNamespace

    clusters = Cluster.query.order_by(Cluster.name.asc()).all()
    stores = Store.query.all()
    stores_by_cluster = {}
    store_to_cluster = {}
    for store in stores:
        if store.cluster_id:
            stores_by_cluster.setdefault(store.cluster_id, []).append(store)
            store_to_cluster[store.id] = store.cluster_id

    reports = DailyReport.query.filter(
        DailyReport.report_date >= start_date,
        DailyReport.report_date <= end_date,
        DailyReport.status == 'Approved',
    ).all()
    _apply_pos_qty_from_pos_categories(reports)

    targets = StoreTarget.query.filter(
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
        team_name='CFI Performance Dashboard',
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
    )

@admin.route('admin/users')
@login_required
def users():
    if not _can_manage_users():
        flash('Access denied. Only Admin or Superadmin can access this page.', category='error')
        return redirect(url_for('views.home'))

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
    stores = Store.query.order_by(Store.name.asc()).all()
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
        assigned_store_id_raw = (request.form.get('assigned_store_id') or '').strip()
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
        if role == 'Inventory Staff':
            if not assigned_store_id_raw:
                flash('Assigned Store is required for Inventory Staff.', category='error')
                return redirect(url_for('admin.users'))
            try:
                assigned_store_id = int(assigned_store_id_raw)
            except (TypeError, ValueError):
                flash('Assigned Store is invalid.', category='error')
                return redirect(url_for('admin.users'))
            if not Store.query.get(assigned_store_id):
                flash('Assigned Store does not exist.', category='error')
                return redirect(url_for('admin.users'))
        
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
        }
        full_name = (request.form.get('full_name') or '').strip()
        username = (request.form.get('username') or '').strip()
        email = (request.form.get('email') or '').strip()
        role = (request.form.get('role') or '').strip()
        assigned_store_id_raw = (request.form.get('assigned_store_id') or '').strip()
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
            if not assigned_store_id_raw:
                flash('Assigned Store is required for Inventory Staff.', category='error')
                return redirect(url_for('admin.users'))
            try:
                assigned_store_id = int(assigned_store_id_raw)
            except (TypeError, ValueError):
                flash('Assigned Store is invalid.', category='error')
                return redirect(url_for('admin.users'))
            if not Store.query.get(assigned_store_id):
                flash('Assigned Store does not exist.', category='error')
                return redirect(url_for('admin.users'))
            user.assigned_store_id = assigned_store_id
        else:
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
    stores = Store.query.all()
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
def clusters():
    clusters = Cluster.query.all()
    # Get users with Cluster Manager role who are not already managing a cluster
    assigned_manager_ids = [c.manager_id for c in clusters if c.manager_id]
    managers = User.query.filter(
        User.role == 'Cluster Manager',
        ~User.id.in_(assigned_manager_ids)
    ).all()
    return render_template('admin/clusters.html', user=current_user, clusters=clusters, managers=managers)


@admin.route('admin/clusters/create', methods=['POST'])
def create_cluster():
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
def manage_cluster(cluster_id):
    cluster = Cluster.query.get_or_404(cluster_id)
    # Get stores that are not assigned to any cluster
    available_stores = Store.query.filter_by(cluster_id=None).all()
    # Get users with Cluster Manager role who are not already managing a cluster
    assigned_manager_ids = [c.manager_id for c in Cluster.query.all() if c.manager_id and c.id != cluster_id]
    available_managers = User.query.filter(
        User.role == 'Cluster Manager',
        ~User.id.in_(assigned_manager_ids)
    ).all()
    return render_template('admin/cluster_manage.html', user=current_user, cluster=cluster, available_stores=available_stores, available_managers=available_managers)


@admin.route('admin/clusters/<int:cluster_id>/add-stores', methods=['POST'])
def add_stores_to_cluster(cluster_id):
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
def remove_store_from_cluster(cluster_id, store_id):
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
def delete_cluster(cluster_id):
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
def assign_manager(cluster_id):
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
    if current_user.role != 'Superadmin':
        flash('Access denied. Only Superadmins can access this page.', category='error')
        return redirect(url_for('views.home'))
    
    clusters = Cluster.query.order_by(Cluster.name.asc()).all()
    selected_cluster_id = request.args.get('cluster_id', type=int)
    selected_store_id = request.args.get('store_id', type=int)

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
    
    if selected_store_id:
        # Fetch targets for selected store
        targets = StoreTarget.query.filter_by(store_id=selected_store_id).order_by(StoreTarget.target_date.asc()).all()
        targets_data = targets
    
    return render_template(
        'admin/targets.html',
        user=current_user,
        clusters=clusters,
        stores=stores,
        selected_cluster_id=selected_cluster_id,
        selected_store_id=selected_store_id,
        targets_data=targets_data,
    )


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
        flash('Please provide POS product name and master product name.', category='error')
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
            reason='Linked POS product name to product masterlist.',
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
        flash(f'Linked "{alias_name}" to "{linked_master_name}". POS rollups will now use the master product.', category='success')
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

    master_descriptions = ProductMaster.query.with_entities(ProductMaster.description).all()
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
        is_in_master = bool(aliased_master_name) or _is_in_masterlist_fuzzy(canonical_normalized_name, threshold=0.80)
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

    return render_template(
        'admin/system_analyzer.html',
        user=current_user,
        start_date=start_date.strftime('%Y-%m-%d'),
        end_date=end_date.strftime('%Y-%m-%d'),
        link_alias=link_alias,
        master_name_options=master_name_options,
        unmatched_items=unmatched_items,
        summary={
            'total_unique_pos_products': total_unique_pos_products,
            'matched_unique_products': matched_unique_products,
            'unmatched_unique_products': len(unmatched_items),
            'unmatched_total_qty': unmatched_total_qty,
            'unmatched_total_net_sales': unmatched_total_net_sales,
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
            'editable_columns': []
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
            'editable_columns': []
        }

    return config, config_data


@admin.route('/admin/invensync')
@login_required
def invensync():
    """Admin view for Invensync ending inventory from all stores"""
    if current_user.role not in ('Superadmin', 'Admin'):
        flash('Access denied.', category='error')
        return redirect(url_for('views.home'))

    selected_tab = request.args.get('tab', 'summary')

    # Get selected date (default to today)
    selected_date_str = request.args.get('date', '')
    if selected_date_str:
        try:
            selected_date = datetime.strptime(selected_date_str, '%Y-%m-%d').date()
        except ValueError:
            selected_date = date.today()
    else:
        selected_date = date.today()

    # Get all stores
    stores = Store.query.order_by(Store.name.asc()).all()
    
    # Get inventory data for selected date from all stores
    inventory_records = DailyEndingInventory.query.filter_by(
        inventory_date=selected_date
    ).all()

    # Organize by store
    inventory_by_store = {i.store_id: i for i in inventory_records}

    # Build store summary data
    store_summaries = []
    for store in stores:
        inventory = inventory_by_store.get(store.id)
        
        store_summaries.append({
            'store': store,
            'inventory': inventory,
            'has_data': bool(inventory)
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
        today=date.today().strftime('%Y-%m-%d'),
        global_invensync_config=config_data,
        config_fields=config_fields,
    )


@admin.route('/admin/oracle')
@login_required
def admin_oracle():
    if current_user.role not in ('Superadmin', 'Admin'):
        flash('Access denied.', category='error')
        return redirect(url_for('views.home'))

    return render_template(
        'admin/oracle.html',
        user=current_user,
    )


@admin.route('/admin/invensync/config', methods=['POST'])
@login_required
def update_invensync_config():
    if current_user.role not in ('Superadmin', 'Admin'):
        return jsonify({'success': False, 'message': 'Access denied.'}), 403

    try:
        data = request.get_json(force=True) or {}
        config, _ = _get_global_invensync_config()

        normalized_data = {
            'hidden_rows': [str(item).strip() for item in data.get('hidden_rows', []) if str(item).strip()],
            'hidden_columns': [str(item).strip() for item in data.get('hidden_columns', []) if str(item).strip()],
            'hidden_cells': [str(item).strip() for item in data.get('hidden_cells', []) if str(item).strip()],
            'locked_rows': [str(item).strip() for item in data.get('locked_rows', []) if str(item).strip()],
            'locked_columns': [str(item).strip() for item in data.get('locked_columns', []) if str(item).strip()],
            'locked_cells': [str(item).strip() for item in data.get('locked_cells', []) if str(item).strip()],
            'editable_columns': [str(item).strip() for item in data.get('editable_columns', []) if str(item).strip()]
        }

        config.config_data = json.dumps(normalized_data)
        db.session.commit()

        return jsonify({'success': True, 'message': 'Global Invensync settings updated.'})
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

    # Get all TAF transfers
    transfers = TafTransfer.query.options(
        selectinload(TafTransfer.store),
        selectinload(TafTransfer.submitter)
    ).order_by(
        TafTransfer.transaction_date.desc(),
        TafTransfer.id.desc()
    ).all()

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
    )


def _reverse_inventory_trans_quantities(transfer_record):
    """
    Reverse Trans-In/Trans-Out quantities in DailyEndingInventoryItem when a TAF is deleted.
    This undoes the inventory changes made when the transfer was originally submitted.
    """
    from .models import DailyEndingInventory, DailyEndingInventoryItem
    
    transaction_type = transfer_record.transaction_type
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
            # Reverse Trans-Out quantities for source store
            for item in transfer_items:
                item_name = item.item_name
                quantity = item.quantity
                
                # Find inventory item for source store
                source_inventory_item = DailyEndingInventoryItem.query.filter_by(
                    inventory_id=source_inventory.id,
                    product_description=item_name
                ).first()
                
                if source_inventory_item:
                    # Subtract from trans_out_qty
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
                    quantity = item.quantity
                    
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
