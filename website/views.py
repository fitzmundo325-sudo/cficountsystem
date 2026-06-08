from flask import Blueprint, render_template, request, redirect, url_for, flash, jsonify, session
from flask_login import login_required, current_user
from .models import (
    Store,
    DailyReport,
    PosSold,
    ProductMaster,
    ProductAlias,
    RsoDelivery,
    TafTransfer,
    TafTransferItem,
    DailyEndingInventory,
    DailyEndingInventoryItem,
    StoreTarget,
    GlobalInvenSyncConfig,
)
from . import db
from .audit import log_audit_event
from datetime import datetime, date, timedelta
import math
import re
import base64
import binascii
import json
import io
import os
import urllib.error
import urllib.request
from difflib import SequenceMatcher
from collections import OrderedDict
from types import SimpleNamespace
import pandas as pd
from sqlalchemy import func
from sqlalchemy.sql.sqltypes import Integer as SAInteger, Float as SAFloat, Numeric as SANumeric

views = Blueprint('views', __name__)


def _safe_ratio(numerator, denominator):
    return (numerator / denominator) if denominator else 0.0


def _get_wastage_amount_from_components(report):
    return (
        float(getattr(report, 'spoilage_gc', 0) or 0)
        + float(getattr(report, 'spoilage_rolls', 0) or 0)
        + float(getattr(report, 'spoilage_premium', 0) or 0)
        + float(getattr(report, 'spoilage_others', 0) or 0)
    )


def _classify_store_status(ar_tgt_percent, growth_ratio=None):
    """
    Classify per-store status using AR-only criteria:
    - Excellent: AR >= +0.1
    - Critical: AR < -3
    - ICU Critical: AR < -10
    Remaining bands:
    - Recovery: -3 <= AR < 0
    - Good: 0 <= AR < 0.1

    Override requested:
    - If AR is below -3 (but not ICU) and %Gr is >= -3%, classify as Recovery.
    """
    gr_percent = (growth_ratio * 100.0) if growth_ratio is not None else None

    if ar_tgt_percent < -10:
        return 'ICU Critical'
    if ar_tgt_percent < -3:
        if gr_percent is not None and gr_percent >= -3.0:
            return 'Recovery'
        return 'Critical'
    if ar_tgt_percent < 0:
        return 'Recovery'
    if ar_tgt_percent < 0.1:
        return 'Good'
    return 'Excellent'


def _get_team_name(cluster):
    manager = getattr(cluster, 'manager', None)
    full_name = (manager.full_name or '').strip() if manager else ''
    if full_name:
        first_name = full_name.split()[0]
        return f'Team {first_name}'
    cluster_name = (cluster.name or '').strip() if cluster else ''
    return f'Team {cluster_name}' if cluster_name else 'Team'


def _build_cluster_sidebar_stores(stores, start_date=None, end_date=None):
    store_ids = [store.id for store in stores]
    if not store_ids:
        return []

    pending_query = (
        db.session.query(DailyReport.store_id, func.count(DailyReport.id))
        .filter(
            DailyReport.store_id.in_(store_ids),
            DailyReport.status == 'Pending',
        )
    )
    if start_date:
        pending_query = pending_query.filter(DailyReport.report_date >= start_date)
    if end_date:
        pending_query = pending_query.filter(DailyReport.report_date <= end_date)

    pending_counts = {
        int(store_id): int(count or 0)
        for store_id, count in pending_query.group_by(DailyReport.store_id).all()
    }

    return [
        {
            'id': store.id,
            'name': store.name,
            'pending_count': pending_counts.get(store.id, 0),
        }
        for store in stores
    ]




def _aggregate_targets_by_day(targets):
    targets_by_day = {}
    for target in targets:
        date_key = target.target_date.strftime('%Y-%m-%d')
        day_target = targets_by_day.setdefault(date_key, {'target_net': 0.0, 'last_year_net': 0.0, 'gbi_target': 0.0})
        day_target['target_net'] += float(target.target_net or 0)
        day_target['last_year_net'] += float(target.last_year_net or 0)
        day_target['gbi_target'] += float(target.gbi_target or 0)
    return targets_by_day


def _build_wastage_performance(reports, start_date, end_date, store_lookup=None):
    from calendar import monthrange

    if not start_date or not end_date:
        return {
            'month_label': '',
            'title_label': 'Wastage Performance',
            'rows': [],
            'mtd': {'label': 'MTD', 'gross_sales': 0.0, 'wastage': 0.0, 'percent': 0.0},
            'per_store': {
                'title_label': 'MTD Wastage Performance Per Store',
                'rows': [],
                'total': {'gross_sales': 0.0, 'wastage': 0.0, 'percent': 0.0},
            },
        }

    month_start = date(start_date.year, start_date.month, 1)
    _, month_days = monthrange(start_date.year, start_date.month)
    month_end = date(start_date.year, start_date.month, month_days)

    buckets = [
        (1, 6),
        (7, 13),
        (14, 20),
        (21, 27),
        (28, month_days),
    ]

    month_abbr = month_start.strftime('%b')
    rows = []
    mtd_gross = 0.0
    mtd_wastage = 0.0

    for day_start, day_end in buckets:
        bucket_start = date(start_date.year, start_date.month, day_start)
        bucket_end = date(start_date.year, start_date.month, day_end)
        effective_start = max(bucket_start, start_date, month_start)
        effective_end = min(bucket_end, end_date, month_end)

        gross_total = 0.0
        wastage_total = 0.0
        if effective_start <= effective_end:
            for report in reports:
                report_date = getattr(report, 'report_date', None)
                if not report_date or report_date < effective_start or report_date > effective_end:
                    continue
                gross_total += float(getattr(report, 'pos_gross_sales', 0) or 0) + float(getattr(report, 'ci_regular_gross_sales', 0) or 0)
                wastage_total += _get_wastage_amount_from_components(report)

        percent = (wastage_total / gross_total * 100.0) if gross_total > 0 else 0.0
        rows.append({
            'label': f'{month_abbr} {day_start} - {day_end}',
            'gross_sales': gross_total,
            'wastage': wastage_total,
            'percent': percent,
        })
        mtd_gross += gross_total
        mtd_wastage += wastage_total

    store_totals = {}
    for report in reports:
        report_date = getattr(report, 'report_date', None)
        if not report_date or report_date < start_date or report_date > end_date:
            continue
        store_id = int(getattr(report, 'store_id', 0) or 0)
        if not store_id:
            continue
        if store_id not in store_totals:
            store_name = (store_lookup or {}).get(store_id)
            store_totals[store_id] = {
                'store_id': store_id,
                'store_name': (store_name or f'Store {store_id}'),
                'gross_sales': 0.0,
                'wastage': 0.0,
            }
        store_totals[store_id]['gross_sales'] += float(getattr(report, 'pos_gross_sales', 0) or 0) + float(getattr(report, 'ci_regular_gross_sales', 0) or 0)
        store_totals[store_id]['wastage'] += _get_wastage_amount_from_components(report)

    per_store_rows = []
    for item in store_totals.values():
        gross_sales = float(item.get('gross_sales', 0) or 0)
        wastage = float(item.get('wastage', 0) or 0)
        per_store_rows.append({
            'store_id': item.get('store_id'),
            'store_name': item.get('store_name') or 'Unknown Store',
            'gross_sales': gross_sales,
            'wastage': wastage,
            'percent': ((wastage / gross_sales) * 100.0) if gross_sales > 0 else 0.0,
        })
    per_store_rows = sorted(
        per_store_rows,
        key=lambda row: (row.get('store_name') or '').lower()
    )

    per_store_total_gross = sum(float(row.get('gross_sales', 0) or 0) for row in per_store_rows)
    per_store_total_wastage = sum(float(row.get('wastage', 0) or 0) for row in per_store_rows)
    per_store_total_percent = ((per_store_total_wastage / per_store_total_gross) * 100.0) if per_store_total_gross > 0 else 0.0
    mtd_percent = (mtd_wastage / mtd_gross * 100.0) if mtd_gross > 0 else 0.0
    return {
        'month_label': month_abbr,
        'title_label': f'{month_abbr} Wastage Performance',
        'rows': rows,
        'mtd': {
            'label': f'{month_abbr} MTD',
            'gross_sales': mtd_gross,
            'wastage': mtd_wastage,
            'percent': mtd_percent,
        },
        'per_store': {
            'title_label': f'{month_abbr} MTD Wastage Performance Per Store',
            'rows': per_store_rows,
            'total': {
                'gross_sales': per_store_total_gross,
                'wastage': per_store_total_wastage,
                'percent': per_store_total_percent,
            },
        },
    }


def _build_discount_performance(reports, start_date, end_date):
    if not start_date or not end_date:
        return {
            'month_label': '',
            'title_label': 'Discount Performance Breakdown',
            'rows': [],
            'mtd': {'label': 'MTD', 'amount': 0.0, 'percent': 0.0},
        }

    month_abbr = start_date.strftime('%b')
    gross_sales_total = 0.0
    senior_pwd_total = 0.0
    promo_ldts_total = 0.0
    bulk_order_total = 0.0

    for report in reports:
        report_date = getattr(report, 'report_date', None)
        if not report_date or report_date < start_date or report_date > end_date:
            continue

        gross_sales_total += float(getattr(report, 'pos_gross_sales', 0) or 0) + float(getattr(report, 'ci_regular_gross_sales', 0) or 0)
        senior_pwd_total += float(getattr(report, 'senior_pwd_discount', 0) or 0)
        promo_ldts_total += float(getattr(report, 'promo_ldts_discount', 0) or 0)
        bulk_order_total += float(getattr(report, 'bulk_orders_discount', 0) or 0)

    def _percent_of_gross(amount):
        return (float(amount or 0.0) / gross_sales_total * 100.0) if gross_sales_total > 0 else 0.0

    rows = [
        {
            'label': 'Senior / PWD',
            'amount': senior_pwd_total,
            'percent': _percent_of_gross(senior_pwd_total),
        },
        {
            'label': 'Promo (LDTS)',
            'amount': promo_ldts_total,
            'percent': _percent_of_gross(promo_ldts_total),
        },
        {
            'label': 'Bulk Order',
            'amount': bulk_order_total,
            'percent': _percent_of_gross(bulk_order_total),
        },
    ]

    mtd_amount = senior_pwd_total + promo_ldts_total + bulk_order_total
    return {
        'month_label': month_abbr,
        'title_label': f'{month_abbr} Discount Performance Breakdown',
        'rows': rows,
        'mtd': {
            'label': f'{month_abbr} MTD',
            'amount': mtd_amount,
            'percent': _percent_of_gross(mtd_amount),
        },
    }


def _build_acc_targets_by_day(year, month, targets_by_day):
    from calendar import monthrange

    _, total_days = monthrange(year, month)
    acc_target_net = 0.0
    acc_ly_net = 0.0
    acc_gbi = 0.0
    acc_targets_by_day = {}

    for day in range(1, total_days + 1):
        date_key = f'{year:04d}-{month:02d}-{day:02d}'
        target_data = targets_by_day.get(date_key, {'target_net': 0.0, 'last_year_net': 0.0, 'gbi_target': 0.0})

        acc_target_net += float(target_data.get('target_net', 0) or 0)
        acc_ly_net += float(target_data.get('last_year_net', 0) or 0)
        acc_gbi += float(target_data.get('gbi_target', 0) or 0)

        acc_targets_by_day[date_key] = {
            'target_net': acc_target_net,
            'last_year_net': acc_ly_net,
            'gbi_target': acc_gbi,
        }

    return acc_targets_by_day


def _build_acc_sales_by_day(year, month, reports):
    from calendar import monthrange

    _, total_days = monthrange(year, month)
    daily_sales = {}
    for report in reports:
        date_key = report.report_date.strftime('%Y-%m-%d')
        net_sales = float(report.pos_net_sales or 0) + float(report.ci_regular_net_sales or 0)
        daily_sales[date_key] = float(daily_sales.get(date_key, 0) or 0) + net_sales

    acc_sales = 0.0
    acc_sales_by_day = {}
    for day in range(1, total_days + 1):
        date_key = f'{year:04d}-{month:02d}-{day:02d}'
        acc_sales += float(daily_sales.get(date_key, 0) or 0)
        acc_sales_by_day[date_key] = {'net_sales': acc_sales}

    return acc_sales_by_day


def _build_mtd_metrics_by_day(year, month, acc_sales_by_day, acc_targets_by_day):
    from calendar import monthrange

    _, total_days = monthrange(year, month)
    metrics_by_day = {}

    for day in range(1, total_days + 1):
        date_key = f'{year:04d}-{month:02d}-{day:02d}'
        acc_net_sales = float(acc_sales_by_day.get(date_key, {}).get('net_sales', 0) or 0)
        acc_target_net = float(acc_targets_by_day.get(date_key, {}).get('target_net', 0) or 0)
        acc_ly_net = float(acc_targets_by_day.get(date_key, {}).get('last_year_net', 0) or 0)

        metrics_by_day[date_key] = {
            'mtd_vs_tgt': (((acc_net_sales / acc_target_net) - 1.0) * 100) if acc_target_net > 0 else None,
            'mtd_vs_ly': (((acc_net_sales / acc_ly_net) - 1.0) * 100) if acc_ly_net > 0 else None,
        }

    return metrics_by_day


def _build_ytd_overview(end_date, store_ids=None):
    if not end_date:
        return {
            'ytd_sales': 0.0,
            'ytd_target': 0.0,
            'ytd_variance_amount': 0.0,
            'ytd_variance_percent': 0.0,
        }

    ytd_start = date(end_date.year, 1, 1)

    report_query = DailyReport.query.filter(
        DailyReport.report_date >= ytd_start,
        DailyReport.report_date <= end_date,
        DailyReport.status == 'Approved',
    )

    from .models import StoreTarget
    target_query = StoreTarget.query.filter(
        StoreTarget.target_date >= ytd_start,
        StoreTarget.target_date <= end_date,
    )

    if store_ids is not None:
        if not store_ids:
            return {
                'ytd_sales': 0.0,
                'ytd_target': 0.0,
                'ytd_variance_amount': 0.0,
                'ytd_variance_percent': 0.0,
            }
        report_query = report_query.filter(DailyReport.store_id.in_(store_ids))
        target_query = target_query.filter(StoreTarget.store_id.in_(store_ids))

    ytd_reports = report_query.all()
    ytd_targets = target_query.all()

    ytd_sales = sum(
        float(report.pos_net_sales or 0) + float(report.ci_regular_net_sales or 0)
        for report in ytd_reports
    )
    ytd_target = sum(float(target.target_net or 0) for target in ytd_targets)

    return {
        'ytd_sales': ytd_sales,
        'ytd_target': ytd_target,
        'ytd_variance_amount': ytd_sales - ytd_target,
        'ytd_variance_percent': ((_safe_ratio(ytd_sales, ytd_target) - 1.0) * 100) if ytd_target > 0 else 0.0,
    }


def _group_reports_by_date(reports):
    reports_by_date = {}
    for report in sorted(reports, key=lambda r: (r.report_date, r.id)):
        date_key = report.report_date.strftime('%Y-%m-%d')
        reports_by_date.setdefault(date_key, []).append(report)
    return reports_by_date


def _consolidate_cluster_reports_by_date(reports):
    if not reports:
        return []

    numeric_field_names = []
    integer_field_names = set()
    for column in DailyReport.__table__.columns:
        if isinstance(column.type, (SAInteger, SAFloat, SANumeric)):
            if column.name in ('id', 'store_id', 'submitted_by'):
                continue
            numeric_field_names.append(column.name)
            if isinstance(column.type, SAInteger):
                integer_field_names.add(column.name)

    # POS-derived computed sold fields (not DB columns).
    computed_pos_fields = [
        'pos_qty_gc',
        'pos_qty_rolls',
        'pos_qty_premium',
        'pos_qty_cheesy_ensay',
        'pos_qty_slices',
        'pos_qty_mamon',
    ]

    day_map = {}
    for report in reports:
        date_key = report.report_date.strftime('%Y-%m-%d')
        day_row = day_map.get(date_key)
        if not day_row:
            day_row = SimpleNamespace()
            day_row.id = int(-report.report_date.toordinal())
            day_row.report_date = report.report_date
            day_row.status = 'Approved'
            day_row.store_name = 'All Stores'
            for field_name in numeric_field_names:
                setattr(day_row, field_name, 0)
            for field_name in computed_pos_fields:
                setattr(day_row, field_name, 0)
            day_map[date_key] = day_row

        for field_name in numeric_field_names:
            running_value = float(getattr(day_row, field_name, 0) or 0)
            source_value = float(getattr(report, field_name, 0) or 0)
            merged_value = running_value + source_value
            if field_name in integer_field_names:
                setattr(day_row, field_name, int(round(merged_value)))
            else:
                setattr(day_row, field_name, merged_value)
        for field_name in computed_pos_fields:
            setattr(
                day_row,
                field_name,
                (int(getattr(day_row, field_name, 0) or 0) + int(getattr(report, field_name, 0) or 0))
            )

    return sorted(day_map.values(), key=lambda r: (r.report_date, r.id))


def _attach_report_calc_fields(reports, targets_by_day, prioritize_pending=False, acc_targets_by_day=None, acc_sales_by_day=None):
    reports_sorted = sorted(reports, key=lambda r: (r.report_date, r.id))

    if prioritize_pending:
        pending = [r for r in reports_sorted if (r.status or '') == 'Pending']
        approved_or_rejected = [r for r in reports_sorted if (r.status or '') in ('Approved', 'Rejected')]
        others = [r for r in reports_sorted if r not in pending and r not in approved_or_rejected]
        traversal = pending + approved_or_rejected + others
    else:
        traversal = reports_sorted

    acc_net_sales = 0.0
    acc_target_net = 0.0
    acc_ly_net = 0.0
    acc_gbi = 0.0

    for report in traversal:
        date_key = report.report_date.strftime('%Y-%m-%d')
        target_data = targets_by_day.get(date_key, {'target_net': 0.0, 'last_year_net': 0.0, 'gbi_target': 0.0})

        pos_gross = float(report.pos_gross_sales or 0)
        ci_gross = float(report.ci_regular_gross_sales or 0)
        total_gross = pos_gross + ci_gross
        net_sales = float(report.pos_net_sales or 0) + float(report.ci_regular_net_sales or 0)

        target_net = float(target_data.get('target_net', 0) or 0)
        last_year_net = float(target_data.get('last_year_net', 0) or 0)
        gbi_target = float(target_data.get('gbi_target', 0) or 0)

        if acc_sales_by_day:
            acc_sales_for_date = acc_sales_by_day.get(date_key, {})
            acc_net_sales = float(acc_sales_for_date.get('net_sales', 0) or 0)
        else:
            acc_net_sales += net_sales
        if acc_targets_by_day:
            acc_target_for_date = acc_targets_by_day.get(date_key, {})
            acc_target_net = float(acc_target_for_date.get('target_net', 0) or 0)
            acc_ly_net = float(acc_target_for_date.get('last_year_net', 0) or 0)
            acc_gbi = float(acc_target_for_date.get('gbi_target', 0) or 0)
        else:
            acc_target_net += target_net
            acc_ly_net += last_year_net
            acc_gbi += gbi_target

        tc_total = int((report.pos_tc or 0) + (report.ci_tc or 0))

        wastage_amount = _get_wastage_amount_from_components(report)
        total_discount = float(report.senior_pwd_discount or 0) + float(report.promo_ldts_discount or 0) + float(report.bulk_orders_discount or 0)

        calc = {
            'target_net': target_net,
            'last_year_net': last_year_net,
            'gbi_target': gbi_target,
            'total_gross_sales': total_gross,
            'net_sales': net_sales,
            'acc_net_sales': acc_net_sales,
            'acc_target_net': acc_target_net,
            'acc_ly_net': acc_ly_net,
            'acc_gbi': acc_gbi,
            'vs_tgt': (((net_sales / target_net) - 1.0) * 100) if target_net > 0 else 0.0,
            'mtd_vs_tgt': (((acc_net_sales / acc_target_net) - 1.0) * 100) if acc_target_net > 0 else 0.0,
            'mtd_vs_ly': (((acc_net_sales / acc_ly_net) - 1.0) * 100) if acc_ly_net > 0 else 0.0,
            'ar': ((acc_net_sales / acc_gbi) * 100) if acc_gbi > 0 else 0.0,
            'vs_ly': (((net_sales / last_year_net) - 1.0) * 100) if last_year_net > 0 else 0.0,
            'tc_total': tc_total,
            'ac': ((net_sales / tc_total) if tc_total > 0 else 0.0),
            'total_agg_sales': float(report.gds_sales or 0) + float(report.grab_sales or 0) + float(report.foodpanda_sales or 0),
            'total_agg_tc': int(report.gds_tc or 0) + int(report.grab_tc or 0) + int(report.foodpanda_tc or 0),
            'total_sbi_sales': float(report.boothselling_sales or 0) + float(report.bulk_order_sales or 0) + float(report.reseller_sales or 0) + float(report.tieup_sales or 0) + float(report.gow_sales or 0) + float(report.ambulant_sales or 0),
            'total_sbi_tc': int(report.boothselling_tc or 0) + int(report.bulk_order_tc or 0) + int(report.reseller_tc or 0) + int(report.tieup_tc or 0) + int(report.gow_tc or 0) + int(report.ambulant_tc or 0),
            'wastage_amount': wastage_amount,
            'wastage_percent': ((wastage_amount / total_gross) * 100) if total_gross > 0 else 0.0,
            'total_discount': total_discount,
            'discount_percent': ((total_discount / total_gross) * 100) if total_gross > 0 else 0.0,
        }

        setattr(report, 'calc', calc)

def _build_cluster_manager_summary(reports, targets):
    # Aggregate targets per day so sales calculations can use the matching date target.
    targets_by_day = {}
    for target in targets:
        date_key = target.target_date.strftime('%Y-%m-%d')
        day_target = targets_by_day.setdefault(date_key, {'target_net': 0.0, 'last_year_net': 0.0, 'gbi_target': 0.0})
        day_target['target_net'] += float(target.target_net or 0)
        day_target['last_year_net'] += float(target.last_year_net or 0)
        day_target['gbi_target'] += float(target.gbi_target or 0)

    reports_sorted = sorted(reports, key=lambda r: (r.report_date, r.id))

    sales = {
        'gross_sales': 0.0,
        'ci_sales': 0.0,
        'total_gross_sales': 0.0,
        'target_net': 0.0,
        'last_year_net': 0.0,
        'net_sales': 0.0,
        'acc_net_sales': 0.0,
        'acc_target_net': 0.0,
        'acc_ly_net': 0.0,
        'gbi_target': 0.0,
        'acc_gbi': 0.0,
        'tc': 0,
        'ac': 0,
        'vs_tgt_percent': 0.0,
        'mtd_vs_tgt_percent': 0.0,
        'mtd_vs_ly_percent': 0.0,
        'ar_percent': 0.0,
        'vs_ly_percent': 0.0,
    }

    aggregators = {
        'gds_sales': 0.0, 'gds_tc': 0,
        'grab_sales': 0.0, 'grab_tc': 0,
        'foodpanda_sales': 0.0, 'foodpanda_tc': 0,
        'maxim_sales': 0.0, 'maxim_tc': 0,
        'total_agg_sales': 0.0, 'total_agg_tc': 0,
    }

    sbi = {
        'boothselling_sales': 0.0, 'boothselling_tc': 0,
        'bulk_order_sales': 0.0, 'bulk_order_tc': 0,
        'reseller_sales': 0.0, 'reseller_tc': 0,
        'tieup_sales': 0.0, 'tieup_tc': 0,
        'ambulant_sales': 0.0, 'ambulant_tc': 0,
        'gow_sales': 0.0, 'gow_tc': 0,
        'other_sbi_sales': 0.0, 'other_sbi_tc': 0,
        'total_sbi_sales': 0.0, 'total_sbi_tc': 0,
    }

    inventory = {
        'pos_qty_gc': 0, 'pos_qty_rolls': 0, 'pos_qty_premium': 0, 'pos_qty_cheesy_ensay': 0,
        'pos_qty_slices': 0, 'pos_qty_mamon': 0,
        'ending_inv_gc': 0, 'ending_inv_rolls': 0, 'ending_inv_premium': 0,
    }

    cost = {
        'wastage_amount': 0.0,
        'wastage_daily_percent': 0.0,
        'senior_pwd_discount': 0.0,
        'promo_ldts_discount': 0.0,
        'bulk_orders_discount': 0.0,
        'total_discount': 0.0,
        'discount_daily_percent': 0.0,
    }

    acc_net_sales = 0.0
    acc_target_net = 0.0
    acc_ly_net = 0.0
    acc_gbi = 0.0
    ar_running_values = []
    vs_ly_last = 0.0

    for report in reports_sorted:
        date_key = report.report_date.strftime('%Y-%m-%d')
        target_data = targets_by_day.get(date_key, {'target_net': 0.0, 'last_year_net': 0.0, 'gbi_target': 0.0})

        pos_gross = float(report.pos_gross_sales or 0)
        ci_gross = float(report.ci_regular_gross_sales or 0)
        total_gross = pos_gross + ci_gross
        net_sales = float(report.pos_net_sales or 0) + float(report.ci_regular_net_sales or 0)
        target_net = float(target_data['target_net'] or 0)
        last_year_net = float(target_data['last_year_net'] or 0)
        gbi_target = float(target_data['gbi_target'] or 0)

        sales['gross_sales'] += pos_gross
        sales['ci_sales'] += ci_gross
        sales['total_gross_sales'] += total_gross
        sales['net_sales'] += net_sales

        acc_net_sales += net_sales

        sales['acc_net_sales'] = acc_net_sales

        if last_year_net > 0:
            vs_ly_last = ((net_sales / last_year_net) - 1.0) * 100

        # Preserve existing running AR behavior during report traversal using report-date targets.
        acc_target_net += target_net
        acc_ly_net += last_year_net
        acc_gbi += gbi_target
        ar_running_values.append(_safe_ratio(acc_net_sales, acc_gbi) * 100 if acc_gbi > 0 else 0.0)

        tc_total = int((report.pos_tc or 0) + (report.ci_tc or 0))
        sales['tc'] += tc_total

        # Aggregators totals
        aggregators['gds_sales'] += float(report.gds_sales or 0)
        aggregators['gds_tc'] += int(report.gds_tc or 0)
        aggregators['grab_sales'] += float(report.grab_sales or 0)
        aggregators['grab_tc'] += int(report.grab_tc or 0)
        aggregators['foodpanda_sales'] += float(report.foodpanda_sales or 0)
        aggregators['foodpanda_tc'] += int(report.foodpanda_tc or 0)
        aggregators['total_agg_sales'] += float(report.gds_sales or 0) + float(report.grab_sales or 0) + float(report.foodpanda_sales or 0)
        aggregators['total_agg_tc'] += int(report.gds_tc or 0) + int(report.grab_tc or 0) + int(report.foodpanda_tc or 0)

        # SBI totals
        sbi_fields = [
            ('boothselling_sales', 'boothselling_tc'),
            ('bulk_order_sales', 'bulk_order_tc'),
            ('reseller_sales', 'reseller_tc'),
            ('tieup_sales', 'tieup_tc'),
            ('gow_sales', 'gow_tc'),
            ('ambulant_sales', 'ambulant_tc'),
        ]
        sbi_sales_total = 0.0
        sbi_tc_total = 0
        for sales_field, tc_field in sbi_fields:
            s_value = float(getattr(report, sales_field, 0) or 0)
            t_value = int(getattr(report, tc_field, 0) or 0)
            sbi[sales_field] += s_value
            sbi[tc_field] += t_value
            sbi_sales_total += s_value
            sbi_tc_total += t_value

        sbi['total_sbi_sales'] += sbi_sales_total
        sbi['total_sbi_tc'] += sbi_tc_total

        # Inventory totals
        for field in inventory.keys():
            inventory[field] += int(getattr(report, field, 0) or 0)

        # Cost totals
        wastage_amount = _get_wastage_amount_from_components(report)
        total_discount = float(report.senior_pwd_discount or 0) + float(report.promo_ldts_discount or 0) + float(report.bulk_orders_discount or 0)

        cost['wastage_amount'] += wastage_amount
        cost['senior_pwd_discount'] += float(report.senior_pwd_discount or 0)
        cost['promo_ldts_discount'] += float(report.promo_ldts_discount or 0)
        cost['bulk_orders_discount'] += float(report.bulk_orders_discount or 0)
        cost['total_discount'] += total_discount

    # Target-based cumulative fields should be based on per-day targets, not per-report rows.
    sales['target_net'] = sum(float(v.get('target_net', 0) or 0) for v in targets_by_day.values())
    sales['last_year_net'] = sum(float(v.get('last_year_net', 0) or 0) for v in targets_by_day.values())
    sales['gbi_target'] = sum(float(v.get('gbi_target', 0) or 0) for v in targets_by_day.values())
    sales['acc_target_net'] = sales['target_net']
    sales['acc_ly_net'] = sales['last_year_net']
    sales['acc_gbi'] = sales['gbi_target']

    acc_target_net = sales['acc_target_net']
    acc_ly_net = sales['acc_ly_net']
    acc_gbi = sales['acc_gbi']

    sales['vs_tgt_percent'] = ((_safe_ratio(sales['total_gross_sales'], sales['target_net']) - 1.0) * 100) if sales['target_net'] > 0 else 0.0
    sales['mtd_vs_tgt_percent'] = ((_safe_ratio(acc_net_sales, acc_target_net) - 1.0) * 100) if acc_target_net > 0 else 0.0
    sales['mtd_vs_ly_percent'] = ((_safe_ratio(acc_net_sales, acc_ly_net) - 1.0) * 100) if acc_ly_net > 0 else 0.0
    sales['ar_percent'] = (sum(ar_running_values) / len(ar_running_values)) if ar_running_values else 0.0
    sales['vs_ly_percent'] = vs_ly_last
    sales['ac'] = ((_safe_ratio(sales['net_sales'], sales['tc'])) if sales['tc'] > 0 else 0.0)

    total_gross_sales = sales['total_gross_sales']
    cost['wastage_daily_percent'] = _safe_ratio(cost['wastage_amount'], total_gross_sales) * 100
    cost['discount_daily_percent'] = _safe_ratio(cost['total_discount'], total_gross_sales) * 100

    overview = {
        'mtd_sales': sales['net_sales'],
        'total_target': sales['target_net'],
        'variance_amount': sales['net_sales'] - sales['target_net'],
        'variance_percent': ((_safe_ratio(sales['net_sales'], sales['target_net']) - 1.0) * 100) if sales['target_net'] > 0 else 0.0,
        'total_gross_sales': total_gross_sales,
        'sbi_sales': sbi['total_sbi_sales'],
        'sbi_percent': _safe_ratio(sbi['total_sbi_sales'], total_gross_sales) * 100,
        'wastage_amount': cost['wastage_amount'],
        'wastage_percent': _safe_ratio(cost['wastage_amount'], total_gross_sales) * 100,
        'discount_amount': cost['total_discount'],
        'discount_percent': _safe_ratio(cost['total_discount'], total_gross_sales) * 100,
    }

    return {
        'overview': overview,
        'sales': sales,
        'aggregators': aggregators,
        'sbi': sbi,
        'inventory': inventory,
        'cost': cost,
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


def _build_store_product_mix_from_reports(reports, stores=None):
    def _normalize_product_text(value):
        return re.sub(r'[^a-z0-9]+', '', str(value or '').strip().lower())

    def _resolve_product_category(product_name, master_rows, cache, similarity_threshold=0.90):
        normalized_name = _normalize_product_text(product_name)
        if not normalized_name:
            return 'Uncategorized'
        if normalized_name in cache:
            return cache[normalized_name]

        best_score = 0.0
        best_category = 'Uncategorized'
        for normalized_master, _, master_category in master_rows:
            if not normalized_master:
                continue
            if normalized_name == normalized_master:
                cache[normalized_name] = master_category
                return master_category
            similarity = SequenceMatcher(None, normalized_name, normalized_master).ratio()
            if similarity > best_score:
                best_score = similarity
                best_category = master_category

        resolved_category = best_category if best_score >= similarity_threshold else 'Uncategorized'
        cache[normalized_name] = resolved_category
        return resolved_category

    palette = [
        '#6366f1', '#10b981', '#f59e0b', '#e11d48', '#0ea5e9',
        '#14b8a6', '#84cc16', '#f97316', '#8b5cf6', '#64748b',
    ]

    store_lookup = {}
    if stores:
        for store in stores:
            store_lookup[int(store.id)] = store.name

    per_store = {
        store_id: {
            'store_id': store_id,
            'store_name': store_name,
            'segments': [],
            'products': [],
            'total_units': 0,
        }
        for store_id, store_name in store_lookup.items()
    }

    product_masters = (
        ProductMaster.query
        .with_entities(ProductMaster.description, ProductMaster.category)
        .all()
    )
    master_rows = [
        (
            _normalize_product_text(description),
            (description or '').strip(),
            (category or '').strip() or 'Uncategorized',
        )
        for description, category in product_masters
    ]
    category_cache = {}
    alias_lookup = {
        str(normalized_alias or '').strip(): (description or '').strip()
        for normalized_alias, description in (
            db.session.query(ProductAlias.normalized_alias, ProductMaster.description)
            .join(ProductMaster, ProductMaster.id == ProductAlias.product_master_id)
            .all()
        )
        if str(normalized_alias or '').strip() and (description or '').strip()
    }

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

        category_totals_by_store = {}
        for store_id, product_name, total_qty, total_net_sales in pos_rows:
            sid = int(store_id)
            qty = int(total_qty or 0)
            if qty <= 0:
                continue

            clean_name = (product_name or '').strip() or 'Unnamed Product'
            if _is_grand_total_product_name(clean_name):
                continue

            canonical_name = alias_lookup.get(_normalize_product_text(clean_name), clean_name)
            resolved_category = _resolve_product_category(canonical_name, master_rows, category_cache, similarity_threshold=0.90)
            if sid not in category_totals_by_store:
                category_totals_by_store[sid] = {}
            category_totals_by_store[sid][resolved_category] = int(category_totals_by_store[sid].get(resolved_category, 0) or 0) + qty

            if sid not in per_store:
                per_store[sid] = {
                    'store_id': sid,
                    'store_name': store_lookup.get(sid, f'Store {sid}'),
                    'segments': [],
                    'products': [],
                    'total_units': 0,
                }
            existing_product = next(
                (product for product in per_store[sid]['products'] if (product.get('name') or '') == canonical_name),
                None
            )
            if existing_product:
                existing_product['qty'] = int(existing_product.get('qty', 0) or 0) + qty
                existing_product['net_sales'] = float(existing_product.get('net_sales', 0.0) or 0.0) + float(total_net_sales or 0.0)
            else:
                per_store[sid]['products'].append({
                    'name': canonical_name,
                    'qty': qty,
                    'net_sales': float(total_net_sales or 0.0),
                    'category': resolved_category,
                })

        for sid, category_totals in category_totals_by_store.items():
            if sid not in per_store:
                per_store[sid] = {
                    'store_id': sid,
                    'store_name': store_lookup.get(sid, f'Store {sid}'),
                    'segments': [],
                    'products': [],
                    'total_units': 0,
                }

            sorted_categories = sorted(
                category_totals.items(),
                key=lambda item: (-int(item[1] or 0), (item[0] or '').lower())
            )
            per_store[sid]['segments'] = [
                {
                    'label': category_name,
                    'value': int(category_value or 0),
                    'color': palette[idx % len(palette)],
                }
                for idx, (category_name, category_value) in enumerate(sorted_categories)
            ]
            per_store[sid]['products'] = sorted(
                per_store[sid].get('products', []),
                key=lambda item: (-int(item.get('qty', 0) or 0), (item.get('name') or '').lower())
            )
            per_store[sid]['total_units'] = sum(int(product.get('qty', 0) or 0) for product in per_store[sid]['products'])

    store_mix = sorted(per_store.values(), key=lambda item: (item['store_name'] or '').lower())
    return store_mix


def _build_pos_sold_products_by_store(reports, stores=None):
    def _normalize_product_text(value):
        return re.sub(r'[^a-z0-9]+', '', str(value or '').strip().lower())

    def _resolve_product_category(product_name, master_rows, cache, similarity_threshold=0.90):
        normalized_name = _normalize_product_text(product_name)
        if not normalized_name:
            return 'Uncategorized'
        if normalized_name in cache:
            return cache[normalized_name]

        best_score = 0.0
        best_category = 'Uncategorized'
        for normalized_master, _, master_category in master_rows:
            if not normalized_master:
                continue
            if normalized_name == normalized_master:
                cache[normalized_name] = master_category
                return master_category
            similarity = SequenceMatcher(None, normalized_name, normalized_master).ratio()
            if similarity > best_score:
                best_score = similarity
                best_category = master_category

        resolved_category = best_category if best_score >= similarity_threshold else 'Uncategorized'
        cache[normalized_name] = resolved_category
        return resolved_category

    product_masters = (
        ProductMaster.query
        .with_entities(ProductMaster.description, ProductMaster.category)
        .all()
    )
    master_rows = [
        (
            _normalize_product_text(description),
            (description or '').strip(),
            (category or '').strip() or 'Uncategorized',
        )
        for description, category in product_masters
    ]
    category_cache = {}
    alias_lookup = {
        str(normalized_alias or '').strip(): (description or '').strip()
        for normalized_alias, description in (
            db.session.query(ProductAlias.normalized_alias, ProductMaster.description)
            .join(ProductMaster, ProductMaster.id == ProductAlias.product_master_id)
            .all()
        )
        if str(normalized_alias or '').strip() and (description or '').strip()
    }

    store_lookup = {}
    if stores:
        for store in stores:
            store_lookup[int(store.id)] = store.name

    per_store = {
        store_id: {
            'store_id': store_id,
            'store_name': store_name,
            'products': [],
            'total_units': 0,
        }
        for store_id, store_name in store_lookup.items()
    }

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
            sid = int(store_id)
            if sid not in per_store:
                per_store[sid] = {
                    'store_id': sid,
                    'store_name': store_lookup.get(sid, f'Store {sid}'),
                    'products': [],
                    'total_units': 0,
                }

            qty = int(total_qty or 0)
            if qty <= 0:
                continue

            clean_name = (product_name or '').strip() or 'Unnamed Product'
            if _is_grand_total_product_name(clean_name):
                continue
            canonical_name = alias_lookup.get(_normalize_product_text(clean_name), clean_name)
            resolved_category = _resolve_product_category(canonical_name, master_rows, category_cache, similarity_threshold=0.90)
            existing_product = next(
                (product for product in per_store[sid]['products'] if (product.get('name') or '') == canonical_name),
                None
            )
            if existing_product:
                existing_product['qty'] = int(existing_product.get('qty', 0) or 0) + qty
                existing_product['net_sales'] = float(existing_product.get('net_sales', 0.0) or 0.0) + float(total_net_sales or 0.0)
            else:
                per_store[sid]['products'].append({
                    'name': canonical_name,
                    'qty': qty,
                    'net_sales': float(total_net_sales or 0.0),
                    'category': resolved_category,
                })

    store_products = sorted(per_store.values(), key=lambda item: (item.get('store_name') or '').lower())
    for item in store_products:
        item['products'] = sorted(
            item.get('products', []),
            key=lambda product: (-int(product.get('qty', 0) or 0), (product.get('name') or '').lower())
        )
        item['total_units'] = sum(int(product.get('qty', 0) or 0) for product in item['products'])

    return store_products


def _apply_pos_qty_from_pos_categories(reports):
    if not reports:
        return

    report_map = {int(report.id): report for report in reports if getattr(report, 'id', None)}
    if not report_map:
        return

    for report in report_map.values():
        report.pos_qty_gc = 0
        report.pos_qty_rolls = 0
        report.pos_qty_premium = 0
        report.pos_qty_cheesy_ensay = 0
        report.pos_qty_slices = 0
        report.pos_qty_mamon = 0

    def _normalize(value):
        return re.sub(r'[^a-z0-9]+', '', str(value or '').strip().lower())

    alias_lookup = {
        str(normalized_alias or '').strip(): (description or '').strip()
        for normalized_alias, description in (
            db.session.query(ProductAlias.normalized_alias, ProductMaster.description)
            .join(ProductMaster, ProductMaster.id == ProductAlias.product_master_id)
            .all()
        )
        if str(normalized_alias or '').strip() and (description or '').strip()
    }
    master_rows = (
        ProductMaster.query
        .with_entities(ProductMaster.description, ProductMaster.category, ProductMaster.sub_category)
        .all()
    )
    master_meta_by_normalized_name = {
        _normalize(description): {
            'category': (category or '').strip() or 'Uncategorized',
            'sub_category': (sub_category or '').strip() or '',
        }
        for description, category, sub_category in master_rows
        if _normalize(description)
    }

    def _resolve_bucket(category_value):
        normalized_category = _normalize(category_value)
        if not normalized_category:
            return None
        if 'greetingcake' in normalized_category or normalized_category == 'gc':
            return 'gc'
        if 'roll' in normalized_category:
            return 'rolls'
        if 'premium' in normalized_category:
            return 'premium'
        return None

    def _is_cake_slices_sub_category(sub_category_value):
        normalized_sub = _normalize(sub_category_value)
        if not normalized_sub:
            return False
        return normalized_sub == 'cakeslices' or ('cake' in normalized_sub and 'slice' in normalized_sub)

    def _is_mamon_sub_category(sub_category_value):
        normalized_sub = _normalize(sub_category_value)
        if not normalized_sub:
            return False
        return normalized_sub == 'mamon' or 'mamon' in normalized_sub

    pos_rows = (
        db.session.query(
            PosSold.daily_report_id,
            PosSold.product_name,
            func.sum(PosSold.quantity).label('total_qty'),
        )
        .filter(PosSold.daily_report_id.in_(list(report_map.keys())))
        .group_by(PosSold.daily_report_id, PosSold.product_name)
        .all()
    )

    for daily_report_id, product_name, total_qty in pos_rows:
        report = report_map.get(int(daily_report_id))
        if not report:
            continue
        clean_name = (product_name or '').strip() or 'Unnamed Product'
        if _is_grand_total_product_name(clean_name):
            continue
        normalized_clean = _normalize(clean_name)
        canonical_name = alias_lookup.get(normalized_clean, clean_name)
        master_meta = master_meta_by_normalized_name.get(_normalize(canonical_name), {})
        category_value = master_meta.get('category', 'Uncategorized')
        sub_category_value = master_meta.get('sub_category', '')
        bucket = _resolve_bucket(category_value)
        qty = int(total_qty or 0)
        if qty <= 0:
            continue
        if _is_cake_slices_sub_category(sub_category_value):
            report.pos_qty_slices = int(report.pos_qty_slices or 0) + qty
            continue
        if _is_mamon_sub_category(sub_category_value):
            report.pos_qty_mamon = int(report.pos_qty_mamon or 0) + qty
            continue
        if not bucket:
            continue
        if bucket == 'gc':
            report.pos_qty_gc = int(report.pos_qty_gc or 0) + qty
        elif bucket == 'rolls':
            report.pos_qty_rolls = int(report.pos_qty_rolls or 0) + qty
        elif bucket == 'premium':
            report.pos_qty_premium = int(report.pos_qty_premium or 0) + qty


def _resolve_scope_month_year(month_arg, year_arg, store_ids=None):
    if month_arg and year_arg:
        return int(year_arg), int(month_arg)

    query = DailyReport.query.filter(DailyReport.status == 'Approved')
    if store_ids is not None:
        if not store_ids:
            today = date.today()
            return today.year, today.month
        query = query.filter(DailyReport.store_id.in_(store_ids))

    latest_report = query.order_by(DailyReport.report_date.desc()).first()
    base_date = latest_report.report_date if latest_report else date.today()
    return int(base_date.year), int(base_date.month)


def _parse_iso_date(value):
    if not value:
        return None
    try:
        return datetime.strptime(value, '%Y-%m-%d').date()
    except (ValueError, TypeError):
        return None


def _get_or_create_global_invensync_config():
    default_data = {
        'hidden_rows': [],
        'hidden_columns': [],
        'hidden_cells': [],
        'locked_rows': [],
        'locked_columns': [],
        'locked_cells': [],
        'editable_columns': [],
    }
    config = GlobalInvenSyncConfig.query.first()
    if not config:
        config = GlobalInvenSyncConfig(config_data=json.dumps(default_data))
        db.session.add(config)
        return config, default_data

    try:
        config_data = json.loads(config.config_data or '{}')
    except ValueError:
        config_data = {}

    for key, value in default_data.items():
        if key not in config_data or not isinstance(config_data.get(key), list):
            config_data[key] = list(value)

    return config, config_data


def _lock_global_invensync_column(column_name):
    config, config_data = _get_or_create_global_invensync_config()
    locked_columns = [str(item).strip() for item in config_data.get('locked_columns', []) if str(item).strip()]
    if column_name not in locked_columns:
        locked_columns.append(column_name)
        config_data['locked_columns'] = locked_columns
        config.config_data = json.dumps(config_data)
    return config_data


def _build_missing_report_dates(store_id, month_start, cutoff_date):
    if not store_id or not month_start or not cutoff_date or cutoff_date < month_start:
        return []

    first_report_date = (
        DailyReport.query
        .filter(DailyReport.store_id == store_id)
        .with_entities(func.min(DailyReport.report_date))
        .scalar()
    )
    if not first_report_date or first_report_date > cutoff_date:
        return []

    start_date = max(month_start, first_report_date)
    existing_dates = {
        row.report_date for row in DailyReport.query.filter(
            DailyReport.store_id == store_id,
            DailyReport.report_date >= start_date,
            DailyReport.report_date <= cutoff_date,
        ).all()
        if row.report_date
    }

    missing_dates = []
    cursor = start_date
    while cursor <= cutoff_date:
        if cursor not in existing_dates:
            missing_dates.append({
                'iso': cursor.strftime('%Y-%m-%d'),
                'label': cursor.strftime('%b %d, %Y'),
            })
        cursor += timedelta(days=1)
    return missing_dates


def _format_header_date(date_value):
    if not date_value:
        return ''
    return f"{date_value.strftime('%b')}. {date_value.day}, {date_value.year}"


def _coalesce_numeric_fields_for_reports(reports):
    if not reports:
        return

    numeric_field_names = []
    for column in DailyReport.__table__.columns:
        if isinstance(column.type, (SAInteger, SAFloat, SANumeric)):
            # Keep identifiers untouched; only coalesce report metrics.
            if column.name in ('id', 'store_id', 'submitted_by'):
                continue
            numeric_field_names.append(column.name)

    for report in reports:
        for field_name in numeric_field_names:
            if getattr(report, field_name, None) is None:
                setattr(report, field_name, 0)


_ALLOWED_IMAGE_EXTENSIONS = {'png', 'jpg', 'jpeg', 'webp'}


def _is_allowed_image_filename(filename):
    if not filename or '.' not in filename:
        return False
    return filename.rsplit('.', 1)[1].lower() in _ALLOWED_IMAGE_EXTENSIONS


def _extract_drive_file_id(file_url):
    raw_url = str(file_url or '').strip()
    if not raw_url:
        return ''

    file_match = re.search(r'/file/d/([A-Za-z0-9_-]+)', raw_url)
    if file_match:
        return file_match.group(1)

    query_match = re.search(r'[?&]id=([A-Za-z0-9_-]+)', raw_url)
    if query_match:
        return query_match.group(1)

    return ''


def _build_drive_image_preview_url(file_url):
    raw_url = str(file_url or '').strip()
    if not raw_url:
        return ''

    file_id = _extract_drive_file_id(raw_url)
    if not file_id:
        return raw_url

    return f'https://drive.google.com/thumbnail?id={file_id}&sz=w1600'


def _upload_z_reading_bytes_to_google_drive(file_bytes, original_name, mime_type, store, report_date):
    script_url = os.getenv('GOOGLE_APPS_SCRIPT_UPLOAD_URL', '').strip()
    script_token = os.getenv('GOOGLE_APPS_SCRIPT_TOKEN', '').strip()
    if not script_url:
        raise ValueError('Google Apps Script is not configured. Set GOOGLE_APPS_SCRIPT_UPLOAD_URL.')
    if 'script.googleusercontent.com/macros/echo' in script_url or 'lib=' in script_url:
        raise ValueError(
            'Invalid Apps Script URL. Use the Web App deployment URL ending in /exec '
            '(format: https://script.google.com/macros/s/.../exec), not a macros/echo or lib URL.'
        )

    original_name = str(original_name or 'z_reading_image').strip()
    extension = original_name.rsplit('.', 1)[1].lower() if '.' in original_name else 'jpg'
    safe_store = re.sub(r'[^A-Za-z0-9_-]+', '_', (store.name or f'store_{store.id}')).strip('_') or f'store_{store.id}'
    upload_name = f'zreading_{safe_store}_{report_date.strftime("%Y%m%d")}.{extension}'

    content_base64 = base64.b64encode(file_bytes).decode('ascii')
    payload = {
        'token': script_token,
        'filename': upload_name,
        'fileName': upload_name,
        'mime_type': (mime_type or 'application/octet-stream'),
        'mimeType': (mime_type or 'application/octet-stream'),
        'content_base64': content_base64,
        'base64Data': content_base64,
        'meta': {
            'store_id': int(store.id),
            'store_name': store.name or '',
            'report_date': report_date.strftime('%Y-%m-%d'),
            'source': 'cm-app-pos-sold',
        },
    }

    request_obj = urllib.request.Request(
        script_url,
        data=json.dumps(payload).encode('utf-8'),
        headers={'Content-Type': 'application/json'},
        method='POST',
    )
    try:
        with urllib.request.urlopen(request_obj, timeout=90) as response:
            response_body = response.read().decode('utf-8', errors='replace')
            status_code = int(getattr(response, 'status', 200) or 200)
    except urllib.error.HTTPError as exc:
        error_body = exc.read().decode('utf-8', errors='replace')
        raise ValueError(f'Apps Script upload failed ({exc.code}): {error_body}') from exc
    except Exception as exc:
        raise ValueError(f'Apps Script upload failed: {str(exc)}') from exc

    if status_code >= 400:
        raise ValueError(f'Apps Script upload failed ({status_code}): {response_body}')

    try:
        result = json.loads(response_body) if response_body else {}
    except Exception:
        result = {'raw': response_body}

    if isinstance(result, dict) and result.get('success') is False:
        raise ValueError(str(result.get('error') or 'Apps Script returned success=false'))

    file_id = ''
    file_url = ''
    if isinstance(result, dict):
        file_id = str(result.get('file_id') or result.get('id') or '').strip()
        file_url = str(
            result.get('file_url')
            or result.get('url')
            or result.get('webViewLink')
            or result.get('webContentLink')
            or ''
        ).strip()

    return {
        'file_id': file_id,
        'name': upload_name,
        'web_view_link': file_url,
        'web_content_link': file_url,
    }


def _upload_z_reading_to_google_drive(upload_file, store, report_date):
    file_bytes = upload_file.read()
    upload_file.stream.seek(0)
    return _upload_z_reading_bytes_to_google_drive(
        file_bytes=file_bytes,
        original_name=(upload_file.filename or 'z_reading_image'),
        mime_type=(upload_file.mimetype or 'application/octet-stream'),
        store=store,
        report_date=report_date,
    )


def _normalize_pos_quantity(raw_value):
    if pd.isna(raw_value):
        return None

    if isinstance(raw_value, str):
        cleaned = raw_value.replace(',', '').strip()
        if not cleaned:
            return None
    else:
        cleaned = raw_value

    try:
        numeric_value = float(cleaned)
    except (TypeError, ValueError):
        return None

    if math.isnan(numeric_value) or numeric_value < 0:
        return None
    if not numeric_value.is_integer():
        return None

    return int(numeric_value)


def _normalize_pos_amount(raw_value):
    if raw_value is None:
        return None

    if isinstance(raw_value, str):
        cleaned = raw_value.strip()
        if not cleaned:
            return None
        cleaned = cleaned.replace(',', '').replace('PHP', '').replace('php', '').replace('P', '').strip()
        if cleaned.startswith('(') and cleaned.endswith(')'):
            cleaned = f'-{cleaned[1:-1]}'
    else:
        cleaned = raw_value

    try:
        numeric_value = float(cleaned)
    except (TypeError, ValueError):
        return None

    if math.isnan(numeric_value) or numeric_value < 0:
        return None

    return float(numeric_value)


def _normalize_pos_net_sales(raw_value):
    return _normalize_pos_amount(raw_value)


def _is_grand_total_product_name(product_name):
    normalized = re.sub(r'[^a-z0-9]+', '', str(product_name or '').strip().lower())
    return normalized.startswith('grandtotal')


def _sanitize_pos_sold_items(items):
    if not isinstance(items, list):
        return []

    aggregated_items = OrderedDict()
    for item in items:
        if not isinstance(item, dict):
            continue

        product_name = str(item.get('product_name', '')).strip()
        if not product_name or _is_grand_total_product_name(product_name):
            continue

        quantity = _normalize_pos_quantity(item.get('quantity'))
        if quantity is None or quantity <= 0:
            continue

        gross_sales = _normalize_pos_amount(item.get('gross_sales'))
        if gross_sales is None:
            gross_sales = 0.0

        discount = _normalize_pos_amount(item.get('discount'))
        if discount is None:
            discount = 0.0

        net_sales = _normalize_pos_net_sales(item.get('net_sales'))
        if net_sales is None:
            net_sales = 0.0

        if product_name not in aggregated_items:
            aggregated_items[product_name] = {
                'quantity': 0,
                'gross_sales': 0.0,
                'discount': 0.0,
                'net_sales': 0.0
            }
        aggregated_items[product_name]['quantity'] = int(aggregated_items[product_name]['quantity'] or 0) + quantity
        aggregated_items[product_name]['gross_sales'] = float(aggregated_items[product_name]['gross_sales'] or 0.0) + float(gross_sales)
        aggregated_items[product_name]['discount'] = float(aggregated_items[product_name]['discount'] or 0.0) + float(discount)
        aggregated_items[product_name]['net_sales'] = float(aggregated_items[product_name]['net_sales'] or 0.0) + float(net_sales)

    return [
        {
            'product_name': product_name,
            'quantity': int(item_values.get('quantity', 0) or 0),
            'gross_sales': float(item_values.get('gross_sales', 0.0) or 0.0),
            'discount': float(item_values.get('discount', 0.0) or 0.0),
            'net_sales': float(item_values.get('net_sales', 0.0) or 0.0),
        }
        for product_name, item_values in aggregated_items.items()
    ]


def _build_pos_sales_autofill_totals(pos_items):
    total_gross_after_discount = 0.0
    total_net_sales = 0.0
    row_count = 0

    for item in pos_items or []:
        if isinstance(item, dict):
            gross_sales = float(item.get('gross_sales', 0.0) or 0.0)
            discount = float(item.get('discount', 0.0) or 0.0)
            net_sales = float(item.get('net_sales', 0.0) or 0.0)
        else:
            gross_sales = float(getattr(item, 'gross_sales', 0.0) or 0.0)
            discount = float(getattr(item, 'discount', 0.0) or 0.0)
            net_sales = float(getattr(item, 'net_sales', 0.0) or 0.0)

        gross_after_discount = gross_sales - discount
        if gross_after_discount < 0:
            gross_after_discount = 0.0

        total_gross_after_discount += gross_after_discount
        total_net_sales += net_sales
        row_count += 1

    return {
        'pos_gross_sales': round(float(total_gross_after_discount), 2),
        'pos_net_sales': round(float(total_net_sales), 2),
        'rows_count': int(row_count),
    }


def _read_uploaded_excel(uploaded_file, upload_label):
    filename = (getattr(uploaded_file, 'filename', '') or '').lower()
    extension = ''
    for ext in ('.xls', '.xlsx', '.xlsm', '.xltx', '.xltm'):
        if filename.endswith(ext):
            extension = ext
            break

    read_kwargs = {'header': None}
    if extension == '.xls':
        read_kwargs['engine'] = 'xlrd'
    elif extension in ('.xlsx', '.xlsm', '.xltx', '.xltm'):
        read_kwargs['engine'] = 'openpyxl'

    try:
        if hasattr(uploaded_file, 'stream') and hasattr(uploaded_file.stream, 'seek'):
            uploaded_file.stream.seek(0)
    except Exception:
        pass

    try:
        return pd.read_excel(uploaded_file, **read_kwargs)
    except ImportError as exc:
        error_text = str(exc).lower()
        if extension == '.xls' or 'xlrd' in error_text:
            raise ValueError(
                f'{upload_label} upload needs xlrd installed to read .xls files. '
                'Please install xlrd or upload a .xlsx file.'
            ) from exc
        if extension in ('.xlsx', '.xlsm', '.xltx', '.xltm') or 'openpyxl' in error_text:
            raise ValueError(
                f'{upload_label} upload needs openpyxl installed to read .xlsx files. '
                'Please install openpyxl and try again.'
            ) from exc
        raise ValueError(
            'Unable to read this Excel file due to a missing dependency. '
            'Please re-save it as .xlsx from Excel and upload again.'
        ) from exc
    except Exception as exc:
        raise ValueError(
            'Unable to read this Excel file. Please re-save it as .xlsx from Excel and upload again.'
        ) from exc


def _extract_pos_sold_items_from_excel(uploaded_file, expected_report_date=None):
    df = _read_uploaded_excel(uploaded_file, 'POS')

    if df.shape[0] < 8:
        raise ValueError('Excel file must have at least 8 rows; data should start on row 8.')
    if df.shape[1] < 6:
        raise ValueError('Excel file must include product (A), quantity (B), gross (C), discount (D), and net sales (F).')

    if expected_report_date is not None:
        if df.shape[0] < 4:
            raise ValueError('Excel file must include "For the Period of ..." in row 4, column A.')
        period_cell = '' if pd.isna(df.iat[3, 0]) else str(df.iat[3, 0]).strip()
        period_dates = re.findall(r'(\d{1,2}/\d{1,2}/\d{4})', period_cell)
        if len(period_dates) < 2:
            raise ValueError(
                'Invalid POS file header. Row 4 column A must contain: "For the Period of mm/dd/yyyy to mm/dd/yyyy".'
            )
        try:
            period_start = datetime.strptime(period_dates[0], '%m/%d/%Y').date()
            period_end = datetime.strptime(period_dates[1], '%m/%d/%Y').date()
        except ValueError:
            raise ValueError('Invalid period date format in row 4 column A. Expected mm/dd/yyyy.')
        if period_start > period_end:
            period_start, period_end = period_end, period_start
        if not (period_start <= expected_report_date <= period_end):
            raise ValueError(
                'POS file period does not match the selected report date. '
                f'File period: {period_start.strftime("%B %d, %Y")} to {period_end.strftime("%B %d, %Y")}; '
                f'Report date: {expected_report_date.strftime("%B %d, %Y")}. Please double-check and upload again.'
            )

    # Row 7 contains headers; actual data starts at row 8.
    product_qty_rows = df.iloc[7:, [0, 1, 2, 3, 5]]
    aggregated_items = OrderedDict()
    row_errors = []

    for row_index, row in product_qty_rows.iterrows():
        row_number = int(row_index) + 1
        product_cell = row.iloc[0]
        quantity_cell = row.iloc[1]
        gross_sales_cell = row.iloc[2]
        discount_cell = row.iloc[3]
        net_sales_cell = row.iloc[4]

        product_name = '' if pd.isna(product_cell) else str(product_cell).strip()
        has_quantity_content = not pd.isna(quantity_cell) and str(quantity_cell).strip() != ''
        has_gross_sales_content = not pd.isna(gross_sales_cell) and str(gross_sales_cell).strip() != ''
        has_discount_content = not pd.isna(discount_cell) and str(discount_cell).strip() != ''
        has_net_sales_content = not pd.isna(net_sales_cell) and str(net_sales_cell).strip() != ''
        quantity = _normalize_pos_quantity(quantity_cell)
        gross_sales = _normalize_pos_amount(gross_sales_cell)
        discount = _normalize_pos_amount(discount_cell)
        net_sales = _normalize_pos_net_sales(net_sales_cell)

        if not product_name and not has_quantity_content and not has_gross_sales_content and not has_discount_content and not has_net_sales_content:
            continue
        if _is_grand_total_product_name(product_name):
            continue
        if not product_name:
            row_errors.append(f'Row {row_number}: missing product name in column A.')
            continue
        if quantity is None:
            row_errors.append(f'Row {row_number}: invalid quantity for "{product_name}".')
            continue
        if gross_sales is None:
            row_errors.append(f'Row {row_number}: invalid gross sales for "{product_name}" in column C.')
            continue
        if discount is None:
            row_errors.append(f'Row {row_number}: invalid discount for "{product_name}" in column D.')
            continue
        if net_sales is None:
            row_errors.append(f'Row {row_number}: invalid net sales for "{product_name}" in column F.')
            continue

        if product_name not in aggregated_items:
            aggregated_items[product_name] = {'quantity': 0, 'gross_sales': 0.0, 'discount': 0.0, 'net_sales': 0.0}
        aggregated_items[product_name]['quantity'] = int(aggregated_items[product_name]['quantity'] or 0) + quantity
        aggregated_items[product_name]['gross_sales'] = float(aggregated_items[product_name]['gross_sales'] or 0.0) + float(gross_sales)
        aggregated_items[product_name]['discount'] = float(aggregated_items[product_name]['discount'] or 0.0) + float(discount)
        aggregated_items[product_name]['net_sales'] = float(aggregated_items[product_name]['net_sales'] or 0.0) + float(net_sales)

    if row_errors:
        preview_errors = '; '.join(row_errors[:5])
        if len(row_errors) > 5:
            preview_errors += f'; and {len(row_errors) - 5} more row issue(s)'
        raise ValueError(f'POS upload failed validation: {preview_errors}.')

    items = _sanitize_pos_sold_items([
        {
            'product_name': product_name,
            'quantity': item_values.get('quantity', 0),
            'gross_sales': item_values.get('gross_sales', 0.0),
            'discount': item_values.get('discount', 0.0),
            'net_sales': item_values.get('net_sales', 0.0),
        }
        for product_name, item_values in aggregated_items.items()
    ])
    if not items:
        raise ValueError('No POS sold rows found in columns A, B, C, D, and F starting row 8.')

    return items


def _pos_sold_draft_storage_key(store_id, report_date):
    return f'{int(store_id)}:{report_date.strftime("%Y-%m-%d")}'


def _get_pos_sold_draft(store_id, report_date):
    drafts = session.get('pos_sold_drafts') or {}
    if not isinstance(drafts, dict):
        return []
    items = drafts.get(_pos_sold_draft_storage_key(store_id, report_date)) or []
    return _sanitize_pos_sold_items(items if isinstance(items, list) else [])


def _set_pos_sold_draft(store_id, report_date, items):
    drafts = session.get('pos_sold_drafts') or {}
    if not isinstance(drafts, dict):
        drafts = {}
    drafts[_pos_sold_draft_storage_key(store_id, report_date)] = _sanitize_pos_sold_items(items)
    session['pos_sold_drafts'] = drafts
    session.modified = True


def _pop_pos_sold_draft(store_id, report_date):
    drafts = session.get('pos_sold_drafts') or {}
    if not isinstance(drafts, dict):
        drafts = {}
    storage_key = _pos_sold_draft_storage_key(store_id, report_date)
    items = drafts.pop(storage_key, [])
    session['pos_sold_drafts'] = drafts
    session.modified = True
    return _sanitize_pos_sold_items(items if isinstance(items, list) else [])


def _normalize_product_text(value):
    return re.sub(r'[^a-z0-9]+', '', str(value or '').strip().lower())


def _build_pos_sold_master_lookups():
    alias_lookup = {}
    master_lookup = {}

    for normalized_alias, product_master_id in (
        db.session.query(ProductAlias.normalized_alias, ProductAlias.product_master_id)
        .all()
    ):
        alias_text = str(normalized_alias or '').strip()
        if alias_text:
            alias_lookup[alias_text] = int(product_master_id)

    for product_id, description in (
        db.session.query(ProductMaster.id, ProductMaster.description).all()
    ):
        normalized_description = _normalize_product_text(description)
        if normalized_description:
            master_lookup[normalized_description] = int(product_id)

    return alias_lookup, master_lookup


def _resolve_pos_sold_master_id(product_name, alias_lookup, master_lookup, similarity_threshold=0.85):
    normalized_name = _normalize_product_text(product_name)
    if not normalized_name:
        return None
    if normalized_name in alias_lookup:
        return alias_lookup[normalized_name]
    if normalized_name in master_lookup:
        return master_lookup[normalized_name]

    best_score = 0.0
    best_master_id = None
    for normalized_master, product_master_id in master_lookup.items():
        if not normalized_master:
            continue
        score = SequenceMatcher(None, normalized_name, normalized_master).ratio()
        if score > best_score:
            best_score = score
            best_master_id = product_master_id

    return best_master_id if best_score >= similarity_threshold else None


def _build_pos_sold_quantities_by_master_id(items):
    if not items:
        return {}

    alias_lookup, master_lookup = _build_pos_sold_master_lookups()
    master_quantities = {}

    for item in items:
        master_id = _resolve_pos_sold_master_id(item.get('product_name', ''), alias_lookup, master_lookup)
        if not master_id:
            continue
        quantity = int(item.get('quantity', 0) or 0)
        if quantity <= 0:
            continue
        master_quantities[master_id] = int(master_quantities.get(master_id, 0) or 0) + quantity

    return master_quantities


def _build_pos_sold_draft_quantity_by_master_id(store_id, report_date):
    return _build_pos_sold_quantities_by_master_id(_get_pos_sold_draft(store_id, report_date))


def _build_taf_trans_out_quantity_by_master_id(store, transaction_date):
    if not store or not transaction_date:
        return {}

    transfer_rows = (
        db.session.query(TafTransferItem.item_name, TafTransferItem.quantity)
        .join(TafTransfer, TafTransfer.id == TafTransferItem.transfer_id)
        .filter(TafTransfer.store_id == store.id)
        .filter(TafTransfer.transaction_date == transaction_date)
        .filter(func.lower(func.trim(TafTransfer.transaction_type)) == 'product transfer')
        .all()
    )
    if not transfer_rows:
        return {}

    alias_lookup, master_lookup = _build_pos_sold_master_lookups()
    master_quantities = {}
    for item_name, quantity in transfer_rows:
        master_id = _resolve_pos_sold_master_id(item_name, alias_lookup, master_lookup)
        if not master_id:
            continue

        quantity = int(quantity or 0)
        if quantity <= 0:
            continue

        master_quantities[master_id] = int(master_quantities.get(master_id, 0) or 0) + quantity

    return master_quantities


def _build_taf_trans_in_quantity_by_master_id(store, transaction_date):
    if not store or not transaction_date:
        return {}

    normalized_store_name = str(store.name or '').strip().lower()
    if not normalized_store_name:
        return {}

    transfer_rows = (
        db.session.query(
            TafTransferItem.item_name,
            TafTransferItem.quantity,
            TafTransferItem.received_quantity,
        )
        .join(TafTransfer, TafTransfer.id == TafTransferItem.transfer_id)
        .filter(TafTransfer.transaction_date == transaction_date)
        .filter(func.lower(func.trim(TafTransfer.transaction_type)) == 'product transfer')
        .filter(func.lower(func.trim(TafTransfer.transfer_to)) == normalized_store_name)
        .filter(func.lower(func.trim(TafTransfer.status)) != 'pending')
        .all()
    )
    if not transfer_rows:
        return {}

    alias_lookup, master_lookup = _build_pos_sold_master_lookups()
    master_quantities = {}
    for item_name, sent_quantity, received_quantity in transfer_rows:
        master_id = _resolve_pos_sold_master_id(item_name, alias_lookup, master_lookup)
        if not master_id:
            continue

        quantity = int(received_quantity if received_quantity is not None else (sent_quantity or 0))
        if quantity <= 0:
            continue

        master_quantities[master_id] = int(master_quantities.get(master_id, 0) or 0) + quantity

    return master_quantities


def _build_pos_sold_quantity_by_master_id_for_report(report_id):
    if not report_id:
        return {}

    pos_items = PosSold.query.filter_by(daily_report_id=report_id).all()
    if not pos_items:
        return {}

    return _build_pos_sold_quantities_by_master_id([
        {
            'product_name': item.product_name,
            'quantity': item.quantity,
        }
        for item in pos_items
    ])


def _apply_pos_sold_quantities_to_inventory(store_id, report_date, master_quantities):
    if not master_quantities:
        return

    inventory = DailyEndingInventory.query.filter_by(
        store_id=store_id,
        inventory_date=report_date
    ).first()
    if not inventory:
        return

    for item in inventory.items:
        if not item.product_master_id:
            continue
        if item.product_master_id not in master_quantities:
            continue
        if item.quantity_sold:
            continue

        item.quantity_sold = int(master_quantities[item.product_master_id] or 0)
        _recalculate_inventory_item(item)

    db.session.flush()


def _sanitize_rso_items(items):
    if not isinstance(items, list):
        return []

    aggregated_items = OrderedDict()
    for item in items:
        if not isinstance(item, dict):
            continue

        product_name = str(item.get('product_name', '')).strip()
        if not product_name:
            continue

        quantity = _normalize_pos_quantity(item.get('quantity'))
        if quantity is None or quantity <= 0:
            continue

        if product_name not in aggregated_items:
            aggregated_items[product_name] = {'quantity': 0}
        aggregated_items[product_name]['quantity'] = int(aggregated_items[product_name]['quantity'] or 0) + quantity

    return [
        {
            'product_name': product_name,
            'quantity': int(item_values.get('quantity', 0) or 0),
        }
        for product_name, item_values in aggregated_items.items()
    ]


def _extract_rso_items_from_excel(uploaded_file):
    df = _read_uploaded_excel(uploaded_file, 'RSO')

    if df.empty or df.shape[0] < 1 or df.shape[1] < 1:
        raise ValueError('Excel file is empty. RSO No must be in cell A1.')

    rso_no_cell = df.iat[0, 0]
    rso_no = '' if pd.isna(rso_no_cell) else str(rso_no_cell).strip()
    if not rso_no:
        raise ValueError('RSO No is required in cell A1.')

    aggregated_items = OrderedDict()
    row_errors = []

    # Keep backward compatibility for templates that still include product rows
    # in columns C and D starting at row 2.
    if df.shape[0] >= 2 and df.shape[1] >= 4:
        product_qty_rows = df.iloc[1:, [2, 3]]

        for row_index, row in product_qty_rows.iterrows():
            row_number = int(row_index) + 1
            product_cell = row.iloc[0]
            quantity_cell = row.iloc[1]

            product_name = '' if pd.isna(product_cell) else str(product_cell).strip()
            has_qty_content = not pd.isna(quantity_cell) and str(quantity_cell).strip() != ''
            quantity = _normalize_pos_quantity(quantity_cell)

            if not product_name and not has_qty_content:
                continue
            if not product_name:
                row_errors.append(f'Row {row_number}: missing product name in column C.')
                continue
            if quantity is None:
                row_errors.append(f'Row {row_number}: invalid quantity for "{product_name}" in column D.')
                continue

            if product_name not in aggregated_items:
                aggregated_items[product_name] = {'quantity': 0}
            aggregated_items[product_name]['quantity'] = int(aggregated_items[product_name]['quantity'] or 0) + quantity

    if row_errors:
        preview_errors = '; '.join(row_errors[:5])
        if len(row_errors) > 5:
            preview_errors += f'; and {len(row_errors) - 5} more row issue(s)'
        raise ValueError(f'RSO upload failed validation: {preview_errors}.')

    items = _sanitize_rso_items([
        {
            'product_name': product_name,
            'quantity': item_values.get('quantity', 0),
        }
        for product_name, item_values in aggregated_items.items()
    ])

    # Keep RSO No as metadata row in draft payload so it can still be shown
    # even when there are no product rows in C/D.
    rso_no_item = {'product_name': f'RSO No: {rso_no}', 'quantity': 1}
    if not items:
        items = [rso_no_item]
    else:
        items = [rso_no_item] + items

    return items


def _split_rso_meta_and_items(items):
    rso_no = ''
    clean_items = []
    pattern = re.compile(r'^\s*rso\s*no\s*:\s*(.+?)\s*$', re.IGNORECASE)

    for item in items or []:
        item_rso_no = ''
        if isinstance(item, dict):
            product_name = str(item.get('product_name', '')).strip()
            item_rso_no = str(item.get('rso_no', '') or '').strip()
        else:
            product_name = str(getattr(item, 'product_name', '') or '').strip()
            item_rso_no = str(getattr(item, 'rso_no', '') or '').strip()

        if item_rso_no and not rso_no:
            rso_no = item_rso_no

        match = pattern.match(product_name)
        if match:
            candidate = (match.group(1) or '').strip()
            if candidate and not rso_no:
                rso_no = candidate
            continue

        clean_items.append(item)

    return rso_no, clean_items


def _enrich_rso_items_with_product_code(rso_items):
    """Add product_code to RSO items by matching product_name with ProductMaster."""
    if not rso_items:
        return rso_items
    
    # Build a lookup dictionary for product codes
    product_lookup = {}
    products = ProductMaster.query.all()
    for product in products:
        # Index by description (case-insensitive)
        if product.description:
            product_lookup[product.description.lower().strip()] = product.code
        # Also index by code itself
        if product.code:
            product_lookup[str(product.code).lower().strip()] = product.code
    
    enriched_items = []
    for item in rso_items:
        if isinstance(item, dict):
            # It's a dict (from draft)
            product_name = str(item.get('product_name', '')).strip()
            product_code = item.get('product_code')
            
            # Try to find product code if not already set
            if not product_code and product_name:
                product_code = product_lookup.get(product_name.lower())
            
            enriched_item = dict(item)
            enriched_item['product_code'] = product_code
            enriched_item.setdefault('received_quantity', None)
            enriched_items.append(enriched_item)
        else:
            # It's a model instance (from database)
            product_name = str(getattr(item, 'product_name', '') or '').strip()
            product_code = getattr(item, 'product_code', None)
            
            # Try to find product code if not already set
            if not product_code and product_name:
                product_code = product_lookup.get(product_name.lower())
            
            # Create a dict with all attributes plus product_code
            enriched_item = {
                'product_name': item.product_name,
                'quantity': item.quantity,
                'received_quantity': getattr(item, 'received_quantity', None),
                'product_code': product_code,
                'rso_no': getattr(item, 'rso_no', None),
            }
            enriched_items.append(enriched_item)
    
    return enriched_items


def _rso_draft_storage_key(store_id, report_date):
    return f'{int(store_id)}:{report_date.strftime("%Y-%m-%d")}'


def _get_rso_draft(store_id, report_date):
    drafts = session.get('rso_drafts') or {}
    if not isinstance(drafts, dict):
        return []
    items = drafts.get(_rso_draft_storage_key(store_id, report_date)) or []
    return _sanitize_rso_items(items if isinstance(items, list) else [])


def _set_rso_draft(store_id, report_date, items):
    drafts = session.get('rso_drafts') or {}
    if not isinstance(drafts, dict):
        drafts = {}
    drafts[_rso_draft_storage_key(store_id, report_date)] = _sanitize_rso_items(items)
    session['rso_drafts'] = drafts
    session.modified = True


def _pop_rso_draft(store_id, report_date):
    drafts = session.get('rso_drafts') or {}
    if not isinstance(drafts, dict):
        drafts = {}
    storage_key = _rso_draft_storage_key(store_id, report_date)
    items = drafts.pop(storage_key, [])
    session['rso_drafts'] = drafts
    session.modified = True
    return _sanitize_rso_items(items if isinstance(items, list) else [])

@views.route('/')
@login_required
def home():
    role = (current_user.role or '').strip()

    if role == 'Superadmin':
        return redirect(url_for('admin.dashboard'))
    if role == 'Admin':
        return redirect(url_for('admin.users'))
    if role == 'Cluster Manager':
        return redirect(url_for('views.cluster_dashboard'))
    if role == 'Store Manager':
        return redirect(url_for('views.store_manager_report'))
    if role == 'Inventory Staff':
        return redirect(url_for('views.store_manager_wastage'))

    flash('No dashboard is configured for your account role.', category='error')
    return redirect(url_for('auth.logout'))


@views.route('/cluster-dashboard')
@login_required
def cluster_dashboard():
    role = (current_user.role or '').strip()
    if role not in ('Cluster Manager', 'Admin', 'Superadmin'):
        flash('Access denied. Only Cluster Managers and Admins can access this page.', category='error')
        return redirect(url_for('views.home'))

    from .models import Cluster
    cluster = None
    if role == 'Cluster Manager':
        cluster = Cluster.query.filter_by(manager_id=current_user.id).first()
        if not cluster:
            flash('You are not assigned to any cluster yet.', category='error')
            return redirect(url_for('views.home'))
    else:
        cluster_id = request.args.get('cluster_id', type=int)
        if not cluster_id:
            flash('Please choose a cluster to view dashboard.', category='error')
            return redirect(url_for('admin.clusters'))
        cluster = Cluster.query.get_or_404(cluster_id)
    
    # Get current month/year/date filters
    from datetime import date, timedelta
    from calendar import monthrange
    from .models import Store, DailyReport, StoreTarget
    
    today = date.today()
    month_arg = request.args.get('month')
    year_arg = request.args.get('year')
    start_date_arg = request.args.get('start_date')
    end_date_arg = request.args.get('end_date')
    
    # Get stores in this cluster.
    # Fallback to all stores when cluster-store assignment is missing so dashboard widgets remain usable.
    stores = Store.query.filter_by(cluster_id=cluster.id).all()
    if not stores:
        stores = Store.query.all()
    
    # Get store IDs
    store_ids = [s.id for s in stores]
    
    # Resolve selected range.
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
        start_date = today.replace(day=1)
        end_date = today
        year_int = int(start_date.year)
        month_int = int(start_date.month)

    current_month = f'{month_int:02d}'
    current_year = str(year_int)
    
    # Fetch all reports for this month (only approved ones)
    reports = DailyReport.query.filter(
        DailyReport.store_id.in_(store_ids),
        DailyReport.report_date >= start_date,
        DailyReport.report_date <= end_date,
        DailyReport.status == 'Approved'
    ).all()
    _coalesce_numeric_fields_for_reports(reports)
    _apply_pos_qty_from_pos_categories(reports)
    
    # Fetch store targets for the selected month
    targets = StoreTarget.query.filter(
        StoreTarget.store_id.in_(store_ids),
        StoreTarget.target_date >= start_date,
        StoreTarget.target_date <= end_date
    ).all()
    
    # Build day-level and cumulative data for the selected range.
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
    
    # Build summary so dashboard can reuse the same Performance Overview metrics.
    summary = _build_cluster_manager_summary(reports, targets)
    ytd_overview = _build_ytd_overview(end_date, store_ids=store_ids)
    summary.setdefault('overview', {}).update(ytd_overview)
    top_products = _build_top_products_from_reports(reports)
    top_products_total_units = sum(item['units'] for item in top_products)
    store_product_mix = _build_store_product_mix_from_reports(reports, stores)
    pos_sold_products_by_store = _build_pos_sold_products_by_store(reports, stores)
    wastage_performance = _build_wastage_performance(
        reports,
        start_date,
        end_date,
        store_lookup={int(store.id): store.name for store in stores},
    )
    discount_performance = _build_discount_performance(reports, start_date, end_date)

    # Prepare per-store performance data
    store_performance_data = []
    range_days = max((end_date - start_date).days + 1, 1)
    
    for store in stores:
        # Get reports for this specific store
        store_reports = [r for r in reports if r.store_id == store.id]
        store_targets = [t for t in targets if t.store_id == store.id]
        
        # Calculate selected-range sales and targets.
        mtd_sales = sum(
            float(r.pos_net_sales or 0) + float(r.ci_regular_net_sales or 0)
            for r in store_reports
        )
        
        # Average Daily Sales over the selected range.
        ads = mtd_sales / range_days if range_days > 0 else 0
        
        # Last Year and Target in selected range.
        store_ly_mtd = sum(
            float(t.last_year_net or 0)
            for t in store_targets
        )
        
        store_target_mtd = sum(
            float(t.target_net or 0)
            for t in store_targets
        )
        ar_tgt_percent = (((mtd_sales / store_target_mtd) - 1.0) * 100) if store_target_mtd > 0 else 0.0
            
        # Calculate % Gr (Growth vs Last Year) = Act/LY - 1
        if store_ly_mtd > 0:
            growth_percent = (mtd_sales / store_ly_mtd) - 1.0
        else:
            growth_percent = None

        status = _classify_store_status(ar_tgt_percent, growth_percent)
            
        store_performance_data.append({
            'store_name': store.name,
            'act': mtd_sales,
            'target_mtd': store_target_mtd,
            'ads': ads,
            'ly': store_ly_mtd,
            'ar_tgt_percent': ar_tgt_percent,
            'growth_percent': growth_percent,
            'status': status
        })

    # Top stores by ADS (Average Daily Sales)
    top_stores_ads = []
    sorted_by_ads = sorted(store_performance_data, key=lambda item: float(item.get('ads', 0) or 0), reverse=True)[:3]
    max_ads = float(sorted_by_ads[0].get('ads', 0) or 0) if sorted_by_ads else 0.0
    for rank, store_data in enumerate(sorted_by_ads, start=1):
        ads_value = float(store_data.get('ads', 0) or 0)
        top_stores_ads.append({
            'rank': rank,
            'store_name': store_data.get('store_name', ''),
            'ads': ads_value,
            'ads_percent': ((ads_value / max_ads) * 100) if max_ads > 0 else 0.0,
        })

    # Top stores by Attainment Rate (AR % Tgt)
    top_attainment_ar = []
    sorted_by_ar = sorted(store_performance_data, key=lambda item: float(item.get('ar_tgt_percent', 0) or 0), reverse=True)[:3]
    for rank, store_data in enumerate(sorted_by_ar, start=1):
        ar_value = float(store_data.get('ar_tgt_percent', 0) or 0)
        top_attainment_ar.append({
            'rank': rank,
            'store_name': store_data.get('store_name', ''),
            'ar_tgt_percent': ar_value,
            'target_mtd': float(store_data.get('target_mtd', 0) or 0),
            'act': float(store_data.get('act', 0) or 0),
            'delta_percent': ar_value,
            'progress_percent': min(max(ar_value + 100.0, 0.0), 100.0),
        })

    # ICU Stores: show lowest-performing stores that need attention in the selected range.
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

    icu_candidates = [
        item for item in store_performance_data
        if item.get('status') == 'ICU Critical'
    ]
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
    
    cluster_sidebar_stores = _build_cluster_sidebar_stores(stores, start_date, end_date)

    return render_template('cluster_manager/cluster_dashboard.html', 
                           user=current_user,
                           cluster=cluster,
                           team_name=_get_team_name(cluster),
                           force_cluster_sidebar=(role in ('Admin', 'Superadmin')),
                           cluster_sidebar_cluster_id=cluster.id if role in ('Admin', 'Superadmin') else '',
                           cluster_sidebar_stores=cluster_sidebar_stores,
                           sales_data=sales_data,
                           sbase_sales_data=sbase_sales_data,
                           target_data=target_data,
                           last_year_data=last_year_data,
                          labels=labels,
                          current_month=current_month,
                          current_year=current_year,
                          current_date=today,
                          selected_start_date=start_date.strftime('%Y-%m-%d'),
                          selected_end_date=end_date.strftime('%Y-%m-%d'),
                          selected_start_date_display=_format_header_date(start_date),
                          selected_end_date_display=_format_header_date(end_date),
                          store_performance_data=store_performance_data,
                          top_stores_ads=top_stores_ads,
                          top_attainment_ar=top_attainment_ar,
                          mtd_metrics_by_day=mtd_metrics_by_day,
                          summary=summary,
                            top_products=top_products,
                            top_products_total_units=top_products_total_units,
                            store_product_mix=store_product_mix,
                            pos_sold_products_by_store=pos_sold_products_by_store,
                            icu_stores=icu_stores,
                            wastage_performance=wastage_performance,
                            discount_performance=discount_performance)


# Store Manager Daily Report Routes
@views.route('/store-manager/daily-report')
@login_required
def store_manager_report():
    if current_user.role != 'Store Manager':
        flash('Access denied. Only Store Managers can access this page.', category='error')
        return redirect(url_for('views.home'))
    
    # Get the store managed by this user
    store = Store.query.filter_by(manager_id=current_user.id).first()
    
    if not store:
        flash('You are not assigned to any store yet.', category='error')
        return redirect(url_for('views.home'))
    
    # Get recent reports for this store
    recent_reports = DailyReport.query.filter_by(store_id=store.id).order_by(DailyReport.report_date.desc()).limit(10).all()

    explicit_date_in_query = bool((request.args.get('date') or '').strip())
    lock_report_date = str(request.args.get('lock_date') or '').strip() == '1'

    # Resolve selected report date (defaults to today when missing/invalid)
    today_date = date.today()
    selected_date = (
        _parse_iso_date(request.args.get('date'))
        or _parse_iso_date(session.get('login_selected_date'))
        or today_date
    )
    if selected_date > today_date:
        selected_date = today_date

    # When user is already on an explicit date URL, skip missing-date modal prompts.
    missing_dates = []
    if not explicit_date_in_query:
        month_start = selected_date.replace(day=1)
        cutoff_date = min(selected_date, today_date - timedelta(days=1))
        missing_dates = _build_missing_report_dates(store.id, month_start, cutoff_date)

    selected_report = DailyReport.query.filter_by(store_id=store.id, report_date=selected_date).first()

    daily_report_form_fields = [
        'pos_gross_sales', 'pos_net_sales', 'pos_tc',
        'ci_regular_gross_sales', 'ci_regular_net_sales', 'ci_tc',
        'ci_number', 'ci_sales_discount',
        'boothselling_sales', 'boothselling_tc',
        'bulk_order_sales', 'bulk_order_tc',
        'reseller_sales', 'reseller_tc',
        'tieup_sales', 'tieup_tc',
        'gow_sales', 'gow_tc',
        'ambulant_sales', 'ambulant_tc',
        'extended_hours_sales', 'extended_hours_tc',
        'gds_sales', 'gds_tc',
        'grab_sales', 'grab_tc',
        'foodpanda_sales', 'foodpanda_tc',
        'paymaya_sales', 'paymaya_tc',
        'gcash_sales', 'gcash_tc',
        'ldts_gc', 'ldts_rolls', 'ldts_premium',
        'ending_inv_gc', 'ending_inv_rolls', 'ending_inv_premium',
        'spoilage_gc', 'spoilage_rolls', 'spoilage_premium', 'spoilage_others',
        'senior_pwd_discount', 'promo_ldts_discount', 'bulk_orders_discount',
        'total_net_spoilage', 'spoilage_percentage', 'mtd_percentage',
    ]
    initial_form_values = {}
    if selected_report:
        for field_name in daily_report_form_fields:
            initial_form_values[field_name] = getattr(selected_report, field_name, '')

    pos_sales_autofill = {
        'source': '',
        'label': '',
        'rows_count': 0,
        'pos_gross_sales': 0.0,
        'pos_net_sales': 0.0,
    }
    pos_sold_items_for_autofill = _get_pos_sold_draft(store.id, selected_date)
    if pos_sold_items_for_autofill:
        pos_sales_autofill.update(_build_pos_sales_autofill_totals(pos_sold_items_for_autofill))
        pos_sales_autofill['source'] = 'draft'
        pos_sales_autofill['label'] = 'Extracted POS review data'
    elif selected_report:
        saved_pos_items = (
            PosSold.query.filter_by(daily_report_id=selected_report.id)
            .order_by(PosSold.id.asc())
            .all()
        )
        if saved_pos_items:
            pos_sales_autofill.update(_build_pos_sales_autofill_totals(saved_pos_items))
            pos_sales_autofill['source'] = 'saved'
            pos_sales_autofill['label'] = 'Submitted POS sold data'

    if (not selected_report) and pos_sales_autofill['source']:
        initial_form_values['pos_gross_sales'] = pos_sales_autofill['pos_gross_sales']
        initial_form_values['pos_net_sales'] = pos_sales_autofill['pos_net_sales']

    selected_report_date = selected_date.strftime('%Y-%m-%d')
    next_missing_date = missing_dates[0]['iso'] if missing_dates else None
    return render_template(
        'store_manager/daily_report.html',
        user=current_user,
        store=store,
        recent_reports=recent_reports,
        selected_report=selected_report,
        today=today_date.strftime('%Y-%m-%d'),
        selected_report_date=selected_report_date,
        missing_dates=missing_dates,
        next_missing_date=next_missing_date,
        initial_form_values=initial_form_values,
        pos_sales_autofill=pos_sales_autofill,
        lock_report_date=lock_report_date,
    )


@views.route('/store-manager/daily-report/pos-sold')
@login_required
def store_manager_pos_sold():
    role = (current_user.role or '').strip()
    if role not in ('Store Manager', 'Inventory Staff'):
        flash('Access denied. Only Store Manager or Inventory Staff can access this page.', category='error')
        return redirect(url_for('views.home'))

    store = _resolve_store_for_store_scope_user()
    if not store:
        flash('You are not assigned to any store yet.', category='error')
        return redirect(url_for('views.home'))

    today_date = date.today()
    explicit_date_in_query = bool((request.args.get('date') or '').strip())
    selected_date = _parse_iso_date(request.args.get('date')) or today_date
    if selected_date > today_date:
        selected_date = today_date

    missing_dates = []
    if not explicit_date_in_query:
        month_start = selected_date.replace(day=1)
        cutoff_date = min(selected_date, today_date - timedelta(days=1))
        missing_dates = _build_missing_report_dates(store.id, month_start, cutoff_date)

    selected_report_date = selected_date.strftime('%Y-%m-%d')
    next_missing_date = missing_dates[0]['iso'] if missing_dates else None
    show_pos_flow_guide = str(request.args.get('guide') or '').strip() == '1'
    pos_scan_success = str(request.args.get('pos_scan_success') or '').strip() == '1'
    try:
        pos_scan_rows = int(request.args.get('pos_scan_rows') or 0)
    except (TypeError, ValueError):
        pos_scan_rows = 0
    selected_report = DailyReport.query.filter_by(store_id=store.id, report_date=selected_date).first()
    draft_pos_sold_items = _get_pos_sold_draft(store.id, selected_date)
    pos_sold_items = draft_pos_sold_items if draft_pos_sold_items else []
    pos_sold_source = 'draft' if draft_pos_sold_items else 'none'
    current_z_reading_image_link = ''
    current_z_reading_image_preview_url = ''
    pos_sold_locked = False
    saved_pos_sold_items = []
    if selected_report:
        saved_pos_sold_items = (
            PosSold.query.filter_by(daily_report_id=selected_report.id)
            .order_by(PosSold.id.asc())
            .all()
        )
        pos_sold_locked = bool(saved_pos_sold_items)
        for saved_item in saved_pos_sold_items:
            candidate_link = str(getattr(saved_item, 'z_reading_image_path', '') or '').strip()
            if candidate_link:
                current_z_reading_image_link = candidate_link
                current_z_reading_image_preview_url = _build_drive_image_preview_url(candidate_link)
                break

        if not draft_pos_sold_items:
            pos_sold_items = saved_pos_sold_items
            if pos_sold_items:
                pos_sold_source = 'saved'

    return render_template(
        'store_manager/pos_sold.html',
        user=current_user,
        store=store,
        today=today_date.strftime('%Y-%m-%d'),
        selected_report_date=selected_report_date,
        selected_report=selected_report,
        pos_sold_items=pos_sold_items,
        pos_sold_source=pos_sold_source,
        pos_sold_locked=pos_sold_locked,
        missing_dates=missing_dates,
        next_missing_date=next_missing_date,
        show_pos_flow_guide=show_pos_flow_guide,
        pos_scan_success=pos_scan_success,
        pos_scan_rows=pos_scan_rows,
        current_z_reading_image_link=current_z_reading_image_link,
        current_z_reading_image_preview_url=current_z_reading_image_preview_url,
    )


@views.route('/store-manager/delivery')
@login_required
def store_manager_delivery():
    role = (current_user.role or '').strip()
    if role not in ('Store Manager', 'Inventory Staff'):
        flash('Access denied. Only Store Manager or Inventory Staff can access this page.', category='error')
        return redirect(url_for('views.home'))

    store = _resolve_store_for_store_scope_user()
    if not store:
        flash('You are not assigned to any store yet.', category='error')
        return redirect(url_for('views.home'))

    today_date = date.today()
    selected_date = _parse_iso_date(request.args.get('date')) or today_date
    if selected_date > today_date:
        selected_date = today_date

    selected_report_date = selected_date.strftime('%Y-%m-%d')
    draft_rso_items = _get_rso_draft(store.id, selected_date)
    rso_items = draft_rso_items if draft_rso_items else []
    rso_source = 'draft' if draft_rso_items else 'none'

    saved_rso_items = (
        RsoDelivery.query
        .filter_by(store_id=store.id, report_date=selected_date)
        .order_by(RsoDelivery.id.asc())
        .all()
    )
    if not draft_rso_items and saved_rso_items:
        rso_items = saved_rso_items
        rso_source = 'saved'

    rso_no, rso_items = _split_rso_meta_and_items(rso_items)
    
    # Enrich items with product codes
    rso_items = _enrich_rso_items_with_product_code(rso_items)

    return render_template(
        'store_manager/delivery.html',
        user=current_user,
        store=store,
        today=today_date.strftime('%Y-%m-%d'),
        selected_report_date=selected_report_date,
        rso_items=rso_items,
        rso_source=rso_source,
        rso_no=rso_no,
    )


@views.route('/store-manager/delivery/review', methods=['POST'])
@login_required
def review_rso_excel():
    if current_user.role != 'Store Manager':
        flash('Access denied.', category='error')
        return redirect(url_for('views.home'))

    report_date = date.today()
    try:
        store = Store.query.filter_by(manager_id=current_user.id).first()
        if not store:
            flash('You are not assigned to any store.', category='error')
            return redirect(url_for('views.home'))

        report_date_str = (request.form.get('report_date') or '').strip()
        report_date = datetime.strptime(report_date_str, '%Y-%m-%d').date() if report_date_str else date.today()
        if report_date > date.today():
            flash('Report date cannot be in the future.', category='error')
            return redirect(url_for('views.store_manager_delivery', date=report_date.strftime('%Y-%m-%d')))

        upload_file = request.files.get('rso_file')
        if not upload_file or upload_file.filename == '':
            flash('Please select an RSO Excel file to upload.', category='error')
            return redirect(url_for('views.store_manager_delivery', date=report_date.strftime('%Y-%m-%d')))

        filename = (upload_file.filename or '').lower()
        if not filename.endswith(('.xls', '.xlsx')):
            flash('Please upload an Excel file (.xls or .xlsx).', category='error')
            return redirect(url_for('views.store_manager_delivery', date=report_date.strftime('%Y-%m-%d')))

        parsed_items = _extract_rso_items_from_excel(upload_file)
        parsed_rso_no, parsed_product_items = _split_rso_meta_and_items(parsed_items)
        _set_rso_draft(store.id, report_date, parsed_items)

        log_audit_event(
            action='report.rso.review',
            entity_type='Store',
            entity_id=store.id,
            reason='Store manager extracted RSO delivery rows from Excel for review.',
            details={
                'store_id': store.id,
                'report_date': report_date.strftime('%Y-%m-%d'),
                'filename': upload_file.filename,
                'rows_extracted': len(parsed_product_items),
                'rso_no': parsed_rso_no,
            },
        )
        db.session.commit()

        flash(
            f'Reviewed {len(parsed_product_items)} RSO delivery item(s) for {report_date.strftime("%B %d, %Y")}.',
            category='success'
        )

    except ValueError as exc:
        db.session.rollback()
        flash(str(exc), category='error')
    except Exception as exc:
        db.session.rollback()
        flash(f'Error uploading RSO file: {str(exc)}', category='error')

    return redirect(url_for('views.store_manager_delivery', date=report_date.strftime('%Y-%m-%d')))


@views.route('/store-manager/delivery/clear', methods=['POST'])
@login_required
def clear_rso_review_data():
    if current_user.role != 'Store Manager':
        flash('Access denied.', category='error')
        return redirect(url_for('views.home'))

    report_date = date.today()
    try:
        store = Store.query.filter_by(manager_id=current_user.id).first()
        if not store:
            flash('You are not assigned to any store.', category='error')
            return redirect(url_for('views.home'))

        report_date_str = (request.form.get('report_date') or '').strip()
        report_date = datetime.strptime(report_date_str, '%Y-%m-%d').date() if report_date_str else date.today()

        cleared_items = _pop_rso_draft(store.id, report_date)
        if cleared_items:
            flash('Extracted RSO review data cleared.', category='success')
        else:
            flash('No extracted RSO review data found to clear.', category='info')
    except Exception as exc:
        flash(f'Error clearing extracted RSO data: {str(exc)}', category='error')

    return redirect(url_for('views.store_manager_delivery', date=report_date.strftime('%Y-%m-%d')))


@views.route('/store-manager/delivery/save', methods=['POST'])
@login_required
def save_rso_review_data():
    if current_user.role != 'Store Manager':
        flash('Access denied.', category='error')
        return redirect(url_for('views.home'))

    report_date = date.today()
    try:
        store = Store.query.filter_by(manager_id=current_user.id).first()
        if not store:
            flash('You are not assigned to any store.', category='error')
            return redirect(url_for('views.home'))

        report_date_str = (request.form.get('report_date') or '').strip()
        report_date = datetime.strptime(report_date_str, '%Y-%m-%d').date() if report_date_str else date.today()
        if report_date > date.today():
            flash('Report date cannot be in the future.', category='error')
            return redirect(url_for('views.store_manager_delivery', date=report_date.strftime('%Y-%m-%d')))

        raw_draft_items = _sanitize_rso_items(_get_rso_draft(store.id, report_date))
        rso_no, draft_items = _split_rso_meta_and_items(raw_draft_items)
        received_qty_values = request.form.getlist('received_qty[]')
        if not draft_items:
            if rso_no:
                _pop_rso_draft(store.id, report_date)
                db.session.commit()
                flash(
                    f'RSO No {rso_no} reviewed and saved for {report_date.strftime("%B %d, %Y")} with no product rows.',
                    category='success'
                )
                return redirect(url_for('views.store_manager_delivery', date=report_date.strftime('%Y-%m-%d')))
            flash('No reviewed RSO data found to save. Please upload and review first.', category='error')
            return redirect(url_for('views.store_manager_delivery', date=report_date.strftime('%Y-%m-%d')))

        (
            RsoDelivery.query
            .filter_by(store_id=store.id, report_date=report_date)
            .delete(synchronize_session=False)
        )

        for index, item in enumerate(draft_items):
            raw_received_qty = received_qty_values[index] if index < len(received_qty_values) else ''
            received_quantity = None
            if str(raw_received_qty).strip():
                try:
                    received_quantity = max(0, int(raw_received_qty))
                except (TypeError, ValueError):
                    received_quantity = None

            db.session.add(
                RsoDelivery(
                    store_id=store.id,
                    report_date=report_date,
                    rso_no=(rso_no or None),
                    product_name=str(item.get('product_name', '')).strip(),
                    quantity=int(item.get('quantity', 0) or 0),
                    received_quantity=received_quantity,
                    uploaded_by=current_user.id,
                    delivery_reviewed_date=date.today(),
                )
            )

        _pop_rso_draft(store.id, report_date)

        log_audit_event(
            action='report.rso.save',
            entity_type='Store',
            entity_id=store.id,
            reason='Store manager saved reviewed RSO delivery rows.',
            details={
                'store_id': store.id,
                'report_date': report_date.strftime('%Y-%m-%d'),
                'rows_saved': len(draft_items),
                'received_rows_saved': sum(1 for value in received_qty_values if str(value).strip()),
                'rso_no': rso_no,
            },
        )
        db.session.commit()
        flash(
            f'Saved {len(draft_items)} RSO delivery item(s) to database for {report_date.strftime("%B %d, %Y")}.',
            category='success'
        )
    except Exception as exc:
        db.session.rollback()
        flash(f'Error saving RSO data: {str(exc)}', category='error')

    return redirect(url_for('views.store_manager_delivery', date=report_date.strftime('%Y-%m-%d')))


@views.route('/store-manager/delivery/delete-all-rso', methods=['POST'])
@login_required
def delete_all_rso_data():
    """Delete all saved RSO data and clear reflected inventory delivery data"""
    if current_user.role != 'Store Manager':
        flash('Access denied.', category='error')
        return redirect(url_for('views.home'))

    report_date = date.today()
    try:
        store = Store.query.filter_by(manager_id=current_user.id).first()
        if not store:
            flash('You are not assigned to any store.', category='error')
            return redirect(url_for('views.home'))

        report_date_str = (request.form.get('report_date') or '').strip()
        report_date = datetime.strptime(report_date_str, '%Y-%m-%d').date() if report_date_str else date.today()

        # Get all RSO records for this date and store before deleting
        rso_records = RsoDelivery.query.filter_by(
            store_id=store.id,
            report_date=report_date
        ).all()

        if not rso_records:
            flash('No RSO data found to delete for this date.', category='info')
            return redirect(url_for('views.store_manager_delivery', date=report_date.strftime('%Y-%m-%d')))

        deleted_count = len(rso_records)

        # ============================================================
        # 1. Clear from DailyEndingInventoryItem (Inventory view)
        # ============================================================
        inventory = DailyEndingInventory.query.filter_by(
            store_id=store.id,
            inventory_date=report_date
        ).first()

        inventory_cleared_count = 0
        if inventory:
            items = DailyEndingInventoryItem.query.filter_by(inventory_id=inventory.id).all()
            for item in items:
                if item.product_master_id:
                    product = ProductMaster.query.get(item.product_master_id)
                    if product:
                        # Check if this inventory item matches any RSO record
                        for rso_record in rso_records:
                            if _match_rso_to_inventory(rso_record, product):
                                item.delivery_qty = 0
                                item.delivery_reviewed_date = None
                                inventory_cleared_count += 1
                                break

        forecast_cleared_count = 0

        # ============================================================
        # 3. Delete RSO records
        # ============================================================
        RsoDelivery.query.filter_by(
            store_id=store.id,
            report_date=report_date
        ).delete(synchronize_session=False)

        # Audit log
        log_audit_event(
            action='report.rso.delete',
            entity_type='Store',
            entity_id=store.id,
            reason='Store manager deleted all RSO delivery records and cleared reflected inventory data.',
            details={
                'store_id': store.id,
                'report_date': report_date.strftime('%Y-%m-%d'),
                'rso_records_deleted': deleted_count,
                'inventory_items_cleared': inventory_cleared_count,
                'forecast_items_cleared': forecast_cleared_count,
            },
        )

        db.session.commit()
        flash(
            f'✓ Deleted {deleted_count} RSO record(s). Cleared delivery data from inventory ({inventory_cleared_count} items).',
            category='success'
        )
    except Exception as exc:
        db.session.rollback()
        flash(f'Error deleting RSO data: {str(exc)}', category='error')

    return redirect(url_for('views.store_manager_delivery', date=report_date.strftime('%Y-%m-%d')))


@views.route('/store-manager/store-data')
@login_required
def store_manager_store_data():
    if current_user.role != 'Store Manager':
        flash('Access denied. Only Store Managers can access this page.', category='error')
        return redirect(url_for('views.home'))

    store = Store.query.filter_by(manager_id=current_user.id).first()
    if not store:
        flash('You are not assigned to any store yet.', category='error')
        return redirect(url_for('views.home'))

    today = date.today()
    current_month = request.args.get('month', today.strftime('%m'))
    current_year = request.args.get('year', str(today.year))

    from calendar import monthrange
    from datetime import datetime
    from .models import StoreTarget

    year_int = int(current_year)
    month_int = int(current_month)
    _, num_days = monthrange(year_int, month_int)

    start_date = datetime(year_int, month_int, 1).date()
    end_date = datetime(year_int, month_int, num_days).date()

    reports = DailyReport.query.filter(
        DailyReport.store_id == store.id,
        DailyReport.report_date >= start_date,
        DailyReport.report_date <= end_date
    ).all()
    _coalesce_numeric_fields_for_reports(reports)
    _apply_pos_qty_from_pos_categories(reports)
    approved_reports = [report for report in reports if (report.status or '') == 'Approved']

    targets = StoreTarget.query.filter(
        StoreTarget.store_id == store.id,
        StoreTarget.target_date >= start_date,
        StoreTarget.target_date <= end_date
    ).all()

    targets_by_date = {}
    for target in targets:
        date_key = target.target_date.strftime('%Y-%m-%d')
        targets_by_date[date_key] = {
            'target_net': target.target_net,
            'last_year_net': target.last_year_net,
            'gbi_target': target.gbi_target
        }

    daily_targets = _aggregate_targets_by_day(targets)
    acc_daily_targets = _build_acc_targets_by_day(year_int, month_int, daily_targets)
    acc_daily_sales = _build_acc_sales_by_day(year_int, month_int, approved_reports)
    mtd_metrics_by_day = _build_mtd_metrics_by_day(year_int, month_int, acc_daily_sales, acc_daily_targets)
    _attach_report_calc_fields(
        reports,
        daily_targets,
        acc_targets_by_day=acc_daily_targets,
        acc_sales_by_day=acc_daily_sales
    )
    summary = _build_cluster_manager_summary(approved_reports, targets)

    total_reports = DailyReport.query.filter(
        DailyReport.store_id == store.id,
        DailyReport.report_date >= start_date,
        DailyReport.report_date <= end_date
    ).count()
    approved_reports_count = len(approved_reports)
    reports_by_date = _group_reports_by_date(reports)

    # Missing dates for selected month (used for reminder modal in Store Data page)
    month_start = start_date
    cutoff_date = end_date
    if year_int == today.year and month_int == today.month:
        cutoff_date = today - timedelta(days=1)

    missing_dates = _build_missing_report_dates(store.id, month_start, cutoff_date)
    next_missing_date = missing_dates[0]['iso'] if missing_dates else None

    pos_reports = (
        DailyReport.query
        .join(PosSold, PosSold.daily_report_id == DailyReport.id)
        .filter(DailyReport.store_id == store.id)
        .group_by(DailyReport.id)
        .order_by(DailyReport.report_date.desc(), DailyReport.id.desc())
        .all()
    )
    pos_report_ids = [report.id for report in pos_reports]
    pos_items_by_report = {}
    if pos_report_ids:
        pos_items = (
            PosSold.query
            .filter(PosSold.daily_report_id.in_(pos_report_ids))
            .order_by(PosSold.daily_report_id.asc(), PosSold.id.asc())
            .all()
        )
        for item in pos_items:
            if _is_grand_total_product_name(item.product_name):
                continue
            pos_items_by_report.setdefault(int(item.daily_report_id), []).append({
                'product_name': item.product_name,
                'quantity': int(item.quantity or 0),
                'net_sales': float(item.net_sales or 0.0),
            })

    pos_modal_payload = []
    for report in pos_reports:
        pos_modal_payload.append({
            'report_id': int(report.id),
            'date': report.report_date.strftime('%Y-%m-%d') if report.report_date else '',
            'label': report.report_date.strftime('%B %d, %Y') if report.report_date else '',
            'items': pos_items_by_report.get(int(report.id), []),
        })

    pos_modal_report = pos_reports[0] if pos_reports else None
    pos_modal_items = pos_items_by_report.get(int(pos_modal_report.id), []) if pos_modal_report else []

    return render_template(
        'store_manager/store_data.html',
        user=current_user,
        store=store,
        stores=[store],
        current_month=current_month,
        current_year=current_year,
        store_filter=str(store.id),
        reports_by_date=reports_by_date,
        targets_by_date=targets_by_date,
        daily_targets=daily_targets,
        acc_daily_targets=acc_daily_targets,
        acc_daily_sales=acc_daily_sales,
        mtd_metrics_by_day=mtd_metrics_by_day,
        total_reports=total_reports,
        approved_reports_count=approved_reports_count,
        summary=summary,
        team_name=store.name,
        missing_dates=missing_dates,
        next_missing_date=next_missing_date,
        pos_modal_report=pos_modal_report,
        pos_modal_items=pos_modal_items,
        pos_modal_payload=pos_modal_payload,
        today_day=today.day,
        today_month=today.month,
        today_year=today.year
    )


def _generate_taf_control_no(transaction_date, transaction_type='Product Transfer'):
    if not transaction_date:
        transaction_date = date.today()
    normalized_type = str(transaction_type or '').strip()
    prefix_key_map = {
        'Product Transfer': 'PTR',
        'Wastage Transfer': 'WTR',
        'Supplies Transfer': 'STR',
        'Supplies Request': 'SRQ',
    }
    prefix_key = prefix_key_map.get(normalized_type, 'TAF')
    date_part = transaction_date.strftime('%Y%m%d')
    prefix = f'{prefix_key}-{date_part}-'
    existing_control_nos = (
        TafTransfer.query
        .with_entities(TafTransfer.control_no)
        .filter(TafTransfer.control_no.like(f'{prefix}%'))
        .all()
    )
    max_sequence = 0
    for row in existing_control_nos:
        control_no = str(getattr(row, 'control_no', '') or '').strip()
        match = re.match(rf'^{re.escape(prefix)}(\d{4})$', control_no)
        if not match:
            continue
        max_sequence = max(max_sequence, int(match.group(1)))
    next_sequence = max_sequence + 1
    return f'{prefix}{str(next_sequence).zfill(4)}'


def _update_inventory_trans_quantities(transfer_record, parsed_items):
    """
    Update Trans-In or Trans-Out quantities in DailyEndingInventoryItem when a TAF is submitted.
    - Product Transfer: Updates Trans-Out for source store, Trans-In for destination store
    - Wastage Transfer: Updates Trans-Out for source store only
    """
    from .models import DailyEndingInventory, DailyEndingInventoryItem
    
    transaction_type = transfer_record.transaction_type
    transaction_date = transfer_record.transaction_date
    transfer_from = transfer_record.transfer_from
    transfer_to = transfer_record.transfer_to
    
    # Find the source store
    source_store = Store.query.filter_by(name=transfer_from).first()
    if not source_store:
        return  # Can't find source store, skip inventory update
    
    # Find or create inventory record for source store
    source_inventory = DailyEndingInventory.query.filter_by(
        store_id=source_store.id,
        inventory_date=transaction_date
    ).first()
    
    if not source_inventory:
        # Create new inventory record if it doesn't exist
        source_inventory = DailyEndingInventory(
            store_id=source_store.id,
            inventory_date=transaction_date,
            created_by=current_user.id
        )
        db.session.add(source_inventory)
        db.session.flush()
    
    # Update Trans-Out quantities for source store
    for item in parsed_items:
        item_name = item['item_name']
        quantity = item['quantity']
        
        # Find or create inventory item for source store
        source_inventory_item = DailyEndingInventoryItem.query.filter_by(
            inventory_id=source_inventory.id,
            product_description=item_name
        ).first()
        
        if not source_inventory_item:
            # Try to find product in ProductMaster to get more details
            product = ProductMaster.query.filter_by(description=item_name).first()
            
            source_inventory_item = DailyEndingInventoryItem(
                inventory_id=source_inventory.id,
                product_master_id=product.id if product else None,
                product_code=product.code if product else None,
                product_description=item_name,
                srp_price=product.sp_p if product else 0.0,
                trans_out_qty=quantity
            )
            db.session.add(source_inventory_item)
        else:
            # Update existing item's trans_out_qty
            source_inventory_item.trans_out_qty = (source_inventory_item.trans_out_qty or 0) + quantity
        
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
    
    # For Product Transfer, also update Trans-In for destination store
    if transaction_type == 'Product Transfer':
        dest_store = Store.query.filter_by(name=transfer_to).first()
        if dest_store:
            # Find or create inventory record for destination store
            dest_inventory = DailyEndingInventory.query.filter_by(
                store_id=dest_store.id,
                inventory_date=transaction_date
            ).first()
            
            if not dest_inventory:
                # Create new inventory record if it doesn't exist
                dest_inventory = DailyEndingInventory(
                    store_id=dest_store.id,
                    inventory_date=transaction_date,
                    created_by=current_user.id
                )
                db.session.add(dest_inventory)
                db.session.flush()
            
            # Update Trans-In quantities for destination store
            for item in parsed_items:
                item_name = item['item_name']
                quantity = item['quantity']
                
                # Find or create inventory item for destination store
                dest_inventory_item = DailyEndingInventoryItem.query.filter_by(
                    inventory_id=dest_inventory.id,
                    product_description=item_name
                ).first()
                
                if not dest_inventory_item:
                    # Try to find product in ProductMaster to get more details
                    product = ProductMaster.query.filter_by(description=item_name).first()
                    
                    dest_inventory_item = DailyEndingInventoryItem(
                        inventory_id=dest_inventory.id,
                        product_master_id=product.id if product else None,
                        product_code=product.code if product else None,
                        product_description=item_name,
                        srp_price=product.sp_p if product else 0.0,
                        trans_in_qty=quantity
                    )
                    db.session.add(dest_inventory_item)
                else:
                    # Update existing item's trans_in_qty
                    dest_inventory_item.trans_in_qty = (dest_inventory_item.trans_in_qty or 0) + quantity
                
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


def _update_inventory_wastage_on_receive(transfer, transfer_items):
    """Update source store Wastage Qty when a Wastage Transfer is received."""
    from datetime import date as date_type

    transfer_from = str(getattr(transfer, 'transfer_from', '') or '').strip()
    if not transfer_from:
        return

    source_store = Store.query.filter_by(name=transfer_from).first()
    if not source_store:
        return

    transaction_date = getattr(transfer, 'transaction_date', None)
    if not transaction_date:
        return

    source_inventory = DailyEndingInventory.query.filter_by(
        store_id=source_store.id,
        inventory_date=transaction_date
    ).first()

    if not source_inventory:
        source_inventory = DailyEndingInventory(
            store_id=source_store.id,
            inventory_date=transaction_date,
            created_by=getattr(transfer, 'submitted_by', None) or current_user.id
        )
        db.session.add(source_inventory)
        db.session.flush()

    for item in transfer_items:
        item_name = str(getattr(item, 'item_name', '') or '').strip()
        received_qty = int(getattr(item, 'received_quantity', None) or getattr(item, 'quantity', 0) or 0)

        if not item_name or received_qty <= 0:
            continue

        source_inventory_item = DailyEndingInventoryItem.query.filter_by(
            inventory_id=source_inventory.id,
            product_description=item_name
        ).first()

        if not source_inventory_item:
            product = ProductMaster.query.filter_by(description=item_name).first()
            source_inventory_item = DailyEndingInventoryItem(
                inventory_id=source_inventory.id,
                product_master_id=product.id if product else None,
                product_code=product.code if product else None,
                product_description=item_name,
                srp_price=product.sp_p if product else 0.0,
                wastage_qty=received_qty
            )
            db.session.add(source_inventory_item)
        else:
            source_inventory_item.wastage_qty = (source_inventory_item.wastage_qty or 0) + received_qty

        _recalculate_inventory_item(source_inventory_item)


def _update_inventory_trans_in_on_receive(transfer, transfer_items):
    """Update invensync Trans-In quantity when transfer receiving is confirmed.
    This function is called when the store clicks 'Confirm Receiving' button."""
    from datetime import date as date_type

    # Only update for Product Transfer and Wastage Transfer
    transaction_type = str(getattr(transfer, 'transaction_type', '') or '').strip().lower()
    if transaction_type not in ('product transfer', 'wastage transfer'):
        return

    if transaction_type == 'wastage transfer':
        _update_inventory_wastage_on_receive(transfer, transfer_items)
        return

    # Get the destination store (transfer_to)
    transfer_to = str(getattr(transfer, 'transfer_to', '') or '').strip()
    if not transfer_to:
        return

    dest_store = Store.query.filter_by(name=transfer_to).first()
    if not dest_store:
        return

    # Use the transfer transaction date
    transaction_date = getattr(transfer, 'transaction_date', None)
    if not transaction_date:
        return

    # Find or create inventory record for destination store
    dest_inventory = DailyEndingInventory.query.filter_by(
        store_id=dest_store.id,
        inventory_date=transaction_date
    ).first()

    if not dest_inventory:
        # Create new inventory record if it doesn't exist
        dest_inventory = DailyEndingInventory(
            store_id=dest_store.id,
            inventory_date=transaction_date,
            created_by=getattr(transfer, 'submitted_by', None) or getattr(current_user, 'id', None)
        )
        db.session.add(dest_inventory)
        db.session.flush()

    # Update Trans-In quantities for destination store using received_quantity
    for item in transfer_items:
        item_name = str(getattr(item, 'item_name', '') or '').strip()
        # Use received_quantity (confirmed amount) instead of sent quantity
        received_qty = int(getattr(item, 'received_quantity', None) or getattr(item, 'quantity', 0) or 0)

        if not item_name or received_qty <= 0:
            continue

        # Find or create inventory item for destination store
        dest_inventory_item = DailyEndingInventoryItem.query.filter_by(
            inventory_id=dest_inventory.id,
            product_description=item_name
        ).first()

        if not dest_inventory_item:
            # Try to find product in ProductMaster to get more details
            product = ProductMaster.query.filter_by(description=item_name).first()

            dest_inventory_item = DailyEndingInventoryItem(
                inventory_id=dest_inventory.id,
                product_master_id=product.id if product else None,
                product_code=product.code if product else None,
                product_description=item_name,
                srp_price=product.sp_p if product else 0.0,
                trans_in_qty=received_qty
            )
            db.session.add(dest_inventory_item)
        else:
            # Update existing item's trans_in_qty - only if not already set
            # This prevents double-counting if receiving is confirmed multiple times
            if dest_inventory_item.trans_in_qty == 0:
                dest_inventory_item.trans_in_qty = received_qty

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


def _parse_float(value, default=0.0):
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _parse_int(value, default=0):
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return default


def _resolve_store_for_store_scope_user():
    role = str(getattr(current_user, 'role', '') or '').strip()
    if role == 'Store Manager':
        return Store.query.filter_by(manager_id=current_user.id).first()
    if role == 'Inventory Staff':
        assigned_store_id = int(getattr(current_user, 'assigned_store_id', 0) or 0)
        if assigned_store_id <= 0:
            return None
        return Store.query.get(assigned_store_id)
    return None


@views.route('/store-manager/transaction-activity-form/control-no')
@login_required
def store_manager_transaction_activity_form_control_no():
    if current_user.role != 'Store Manager':
        return jsonify({'error': 'Access denied'}), 403

    store = Store.query.filter_by(manager_id=current_user.id).first()
    if not store:
        return jsonify({'error': 'Store assignment not found'}), 404

    request_date = _parse_iso_date(request.args.get('date')) or date.today()
    if request_date > date.today():
        request_date = date.today()

    transaction_type = str(request.args.get('transaction_type', '') or '').strip() or 'Product Transfer'
    control_no = _generate_taf_control_no(request_date, transaction_type)
    return jsonify({
        'control_no': control_no,
        'date': request_date.strftime('%Y-%m-%d'),
    })


@views.route('/store-manager/transaction-activity-form', methods=['GET', 'POST'])
@login_required
def store_manager_transaction_activity_form():
    if current_user.role != 'Store Manager':
        flash('Access denied. Only Store Managers can access this page.', category='error')
        return redirect(url_for('views.home'))

    store = Store.query.filter_by(manager_id=current_user.id).first()
    if not store:
        flash('You are not assigned to any store yet.', category='error')
        return redirect(url_for('views.home'))

    today_date = date.today()
    selected_date = _parse_iso_date(request.args.get('date')) or today_date
    if selected_date > today_date:
        selected_date = today_date

    if request.method == 'POST':
        transaction_type = str(request.form.get('transaction_type', '') or '').strip()
        allowed_transaction_types = {'Product Transfer', 'Wastage Transfer'}
        if transaction_type not in allowed_transaction_types:
            flash('Only Product Transfer and Wastage Transfer submission are enabled for now.', category='error')
            return redirect(url_for('views.store_manager_transaction_activity_form', date=selected_date.strftime('%Y-%m-%d')))

        taf_date = _parse_iso_date(request.form.get('taf_date')) or today_date
        if taf_date > today_date:
            flash('Transaction date cannot be in the future.', category='error')
            return redirect(url_for('views.store_manager_transaction_activity_form', date=today_date.strftime('%Y-%m-%d')))

        transfer_from = str(request.form.get('transfer_from', '') or '').strip() or str(store.name or '').strip()
        transfer_to = str(request.form.get('transfer_to', '') or '').strip()
        prepared_by_name = str(request.form.get('prepared_by_name', '') or '').strip()
        received_by_name = str(request.form.get('received_by_name', '') or '').strip()

        if not transfer_to:
            flash(f'Transfer To is required for {transaction_type}.', category='error')
            return redirect(url_for('views.store_manager_transaction_activity_form', date=taf_date.strftime('%Y-%m-%d')))
        if not prepared_by_name:
            flash('Prepared By (Name) is required.', category='error')
            return redirect(url_for('views.store_manager_transaction_activity_form', date=taf_date.strftime('%Y-%m-%d')))

        item_names = request.form.getlist('item_name[]')
        unit_costs = request.form.getlist('unit_cost[]')
        quantities = request.form.getlist('qty[]')
        remarks_list = request.form.getlist('remarks[]')
        row_count = max(len(item_names), len(unit_costs), len(quantities), len(remarks_list))

        parsed_items = []
        for idx in range(row_count):
            raw_item_name = item_names[idx] if idx < len(item_names) else ''
            raw_unit_cost = unit_costs[idx] if idx < len(unit_costs) else ''
            raw_quantity = quantities[idx] if idx < len(quantities) else ''
            raw_remarks = remarks_list[idx] if idx < len(remarks_list) else ''

            item_name = str(raw_item_name or '').strip()
            remarks = str(raw_remarks or '').strip()
            unit_cost = _parse_float(raw_unit_cost, default=0.0)
            quantity = _parse_int(raw_quantity, default=0)

            row_is_empty = (
                not item_name
                and not str(raw_unit_cost or '').strip()
                and not str(raw_quantity or '').strip()
                and not remarks
            )
            if row_is_empty:
                continue
            if not item_name:
                flash(f'Item Name is required on row {idx + 1}.', category='error')
                return redirect(url_for('views.store_manager_transaction_activity_form', date=taf_date.strftime('%Y-%m-%d')))
            if quantity <= 0:
                flash(f'Qty must be greater than 0 on row {idx + 1}.', category='error')
                return redirect(url_for('views.store_manager_transaction_activity_form', date=taf_date.strftime('%Y-%m-%d')))
            if unit_cost < 0:
                flash(f'Unit Cost cannot be negative on row {idx + 1}.', category='error')
                return redirect(url_for('views.store_manager_transaction_activity_form', date=taf_date.strftime('%Y-%m-%d')))

            line_total = float(unit_cost * quantity)
            parsed_items.append({
                'item_name': item_name,
                'unit_cost': float(unit_cost),
                'quantity': int(quantity),
                'line_total': line_total,
                'remarks': remarks or None,
            })

        if not parsed_items:
            flash(f'Please add at least one {transaction_type} item before submitting.', category='error')
            return redirect(url_for('views.store_manager_transaction_activity_form', date=taf_date.strftime('%Y-%m-%d')))

        # Use the control number entered by the user
        control_no = str(request.form.get('control_no', '') or '').strip()
        if not control_no:
            flash('Control Number is required.', category='error')
            return redirect(url_for('views.store_manager_transaction_activity_form', date=taf_date.strftime('%Y-%m-%d')))
        
        # Check if control number already exists
        existing_transfer = TafTransfer.query.filter_by(control_no=control_no).first()
        if existing_transfer:
            flash(f'Control Number "{control_no}" already exists. Please use a unique control number.', category='error')
            return redirect(url_for('views.store_manager_transaction_activity_form', date=taf_date.strftime('%Y-%m-%d')))
        
        grand_total = float(sum(item['line_total'] for item in parsed_items))

        transfer_record = TafTransfer(
            store_id=store.id,
            transaction_date=taf_date,
            control_no=control_no,
            transaction_type=transaction_type,
            transfer_from=transfer_from,
            transfer_to=transfer_to,
            prepared_by_name=prepared_by_name,
            # Receiver is intentionally optional/disabled for sender-side submission.
            received_by_name=received_by_name or None,
            grand_total=grand_total,
            submitted_by=current_user.id,
        )
        db.session.add(transfer_record)
        db.session.flush()

        for item in parsed_items:
            db.session.add(
                TafTransferItem(
                    transfer_id=transfer_record.id,
                    item_name=item['item_name'],
                    unit_cost=item['unit_cost'],
                    quantity=item['quantity'],
                    line_total=item['line_total'],
                    remarks=item['remarks'],
                )
            )

        # Update inventory Trans-In/Trans-Out quantities only after receiving is confirmed
        # This is now handled in store_manager_incoming_transfer_view when Confirm Receiving is clicked
        # _update_inventory_trans_quantities(transfer_record, parsed_items)

        log_audit_event(
            action='taf.product_transfer.submit' if transaction_type == 'Product Transfer' else 'taf.wastage_transfer.submit',
            entity_type='TafTransfer',
            entity_id=transfer_record.id,
            reason=f'Store manager submitted {transaction_type} TAF.',
            details={
                'store_id': store.id,
                'transaction_date': taf_date.strftime('%Y-%m-%d'),
                'control_no': control_no,
                'transaction_type': transaction_type,
                'item_count': len(parsed_items),
                'grand_total': round(grand_total, 2),
            },
        )
        db.session.commit()

        flash(f'{transaction_type} submitted successfully. Control No: {control_no}', category='success')
        return redirect(url_for('views.store_manager_transaction_activity_form', date=taf_date.strftime('%Y-%m-%d')))

    product_rows = (
        ProductMaster.query
        .with_entities(ProductMaster.description, ProductMaster.tp)
        .order_by(ProductMaster.description.asc())
        .all()
    )
    product_names = []
    product_price_map = {}
    for row in product_rows:
        product_name = str(getattr(row, 'description', '') or '').strip()
        if not product_name:
            continue
        product_names.append(product_name)
        tp_value = getattr(row, 'tp', None)
        if tp_value is not None:
            product_price_map[product_name] = float(tp_value)
    all_stores = Store.query.order_by(Store.name.asc()).all()

    return render_template(
        'store_manager/transaction_activity_form.html',
        user=current_user,
        store=store,
        all_stores=all_stores,
        today=today_date.strftime('%Y-%m-%d'),
        selected_report_date=selected_date.strftime('%Y-%m-%d'),
        product_names=product_names,
        product_price_map=product_price_map,
    )


@views.route('/store-manager/trans')
@login_required
def store_manager_incoming_transfers():
    role = (current_user.role or '').strip()
    if role not in ('Store Manager', 'Inventory Staff'):
        flash('Access denied. Only Store Manager or Inventory Staff can access this page.', category='error')
        return redirect(url_for('views.home'))

    store = _resolve_store_for_store_scope_user()
    if not store:
        flash('You are not assigned to any store yet.', category='error')
        return redirect(url_for('views.home'))

    normalized_store_name = str(store.name or '').strip().lower()
    incoming_transfers = (
        TafTransfer.query
        .filter(func.lower(func.trim(TafTransfer.transfer_to)) == normalized_store_name)
        .filter(TafTransfer.store_id != store.id)
        .order_by(TafTransfer.transaction_date.desc(), TafTransfer.id.desc())
        .all()
    )

    transfer_ids = [transfer.id for transfer in incoming_transfers]
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
        'store_manager/trans.html',
        user=current_user,
        store=store,
        incoming_transfers=incoming_transfers,
        item_count_by_transfer=item_count_by_transfer,
    )


@views.route('/store-manager/trans/<int:transfer_id>', methods=['GET', 'POST'])
@login_required
def store_manager_incoming_transfer_view(transfer_id):
    role = (current_user.role or '').strip()
    if role not in ('Store Manager', 'Inventory Staff'):
        flash('Access denied. Only Store Manager or Inventory Staff can access this page.', category='error')
        return redirect(url_for('views.home'))

    store = _resolve_store_for_store_scope_user()
    if not store:
        flash('You are not assigned to any store yet.', category='error')
        return redirect(url_for('views.home'))

    transfer = TafTransfer.query.filter_by(id=transfer_id).first()
    if not transfer:
        flash('Transfer record not found.', category='error')
        return redirect(url_for('views.store_manager_incoming_transfers'))

    normalized_store_name = str(store.name or '').strip().lower()
    transfer_to_name = str(getattr(transfer, 'transfer_to', '') or '').strip().lower()
    transfer_type_normalized = str(getattr(transfer, 'transaction_type', '') or '').strip().lower()
    is_incoming_for_current_store = (
        transfer_to_name == normalized_store_name
        and int(getattr(transfer, 'store_id', 0) or 0) != int(store.id)
    )
    is_self_main_office_wastage = (
        transfer_type_normalized == 'wastage transfer'
        and int(getattr(transfer, 'store_id', 0) or 0) == int(store.id)
        and transfer_to_name == 'main office'
    )
    if not (is_incoming_for_current_store or is_self_main_office_wastage):
        flash('You can only view allowed incoming transfers for your store.', category='error')
        return redirect(url_for('views.store_manager_incoming_transfers'))

    transfer_items = (
        TafTransferItem.query
        .filter(TafTransferItem.transfer_id == transfer.id)
        .order_by(TafTransferItem.id.asc())
        .all()
    )
    can_receive_action = (
        role == 'Store Manager'
        or (role == 'Inventory Staff' and transfer_type_normalized == 'wastage transfer')
    )

    if request.method == 'POST':
        if not can_receive_action:
            flash('Access denied. Only Store Managers or assigned Inventory Staff can finalize this transfer.', category='error')
            return redirect(url_for('views.store_manager_incoming_transfer_view', transfer_id=transfer.id))

        current_status = str(getattr(transfer, 'status', '') or 'Pending').strip()
        if current_status != 'Pending':
            flash('This transfer is already finalized and can no longer be edited.', category='error')
            return redirect(url_for('views.store_manager_incoming_transfer_view', transfer_id=transfer.id))

        received_by_name = str(request.form.get('received_by_name', '') or '').strip()
        if not received_by_name:
            flash('Received By is required.', category='error')
            return redirect(url_for('views.store_manager_incoming_transfer_view', transfer_id=transfer.id))

        item_ids = request.form.getlist('item_id[]')
        received_qty_list = request.form.getlist('received_qty[]')
        qty_by_item_id = {}
        for idx in range(max(len(item_ids), len(received_qty_list))):
            raw_item_id = item_ids[idx] if idx < len(item_ids) else ''
            raw_received_qty = received_qty_list[idx] if idx < len(received_qty_list) else ''
            item_id_str = str(raw_item_id or '').strip()
            if not item_id_str:
                continue
            qty_by_item_id[item_id_str] = str(raw_received_qty or '').strip()

        has_short = False
        has_over = False
        for item in transfer_items:
            raw_received_qty = qty_by_item_id.get(str(item.id), '')
            if not raw_received_qty:
                flash(f'Received Qty is required for item "{item.item_name}".', category='error')
                return redirect(url_for('views.store_manager_incoming_transfer_view', transfer_id=transfer.id))
            if not re.fullmatch(r'\d+', raw_received_qty):
                flash(f'Received Qty must be a whole number for item "{item.item_name}".', category='error')
                return redirect(url_for('views.store_manager_incoming_transfer_view', transfer_id=transfer.id))

            received_qty = int(raw_received_qty)
            sent_qty = int(getattr(item, 'quantity', 0) or 0)
            variance_qty = int(received_qty - sent_qty)
            item.received_quantity = received_qty
            item.short_over_qty = variance_qty
            if variance_qty < 0:
                has_short = True
            elif variance_qty > 0:
                has_over = True

        transfer.received_by_name = received_by_name
        if has_short and has_over:
            transfer.status = 'Received - Short/Over'
        elif has_short:
            transfer.status = 'Received - Short'
        elif has_over:
            transfer.status = 'Received - Over'
        else:
            transfer.status = 'Received'

        # Update invensync Trans-In quantity when receiving is confirmed
        _update_inventory_trans_in_on_receive(transfer, transfer_items)

        log_audit_event(
            action='taf.product_transfer.receive',
            entity_type='TafTransfer',
            entity_id=transfer.id,
            reason='Incoming transfer marked as received.',
            details={
                'store_id': store.id,
                'control_no': transfer.control_no,
                'transaction_type': transfer.transaction_type,
                'receiver_role': role,
                'received_by_name': received_by_name,
                'status': transfer.status,
                'has_short': has_short,
                'has_over': has_over,
            },
        )
        db.session.commit()
        flash('Incoming transfer updated successfully.', category='success')
        return redirect(url_for('views.store_manager_incoming_transfer_view', transfer_id=transfer.id))

    return render_template(
        'store_manager/trans_view.html',
        user=current_user,
        store=store,
        transfer=transfer,
        transfer_items=transfer_items,
        can_edit_receive=can_receive_action,
    )


@views.route('/store-manager/trans-out')
@login_required
def store_manager_outgoing_transfers():
    role = (current_user.role or '').strip()
    if role not in ('Store Manager', 'Inventory Staff'):
        flash('Access denied. Only Store Manager or Inventory Staff can access this page.', category='error')
        return redirect(url_for('views.home'))

    store = _resolve_store_for_store_scope_user()
    if not store:
        flash('You are not assigned to any store yet.', category='error')
        return redirect(url_for('views.home'))

    outgoing_transfers = (
        TafTransfer.query
        .filter(TafTransfer.store_id == store.id)
        .filter(func.lower(func.trim(TafTransfer.transaction_type)) == 'product transfer')
        .order_by(TafTransfer.transaction_date.desc(), TafTransfer.id.desc())
        .all()
    )

    transfer_ids = [transfer.id for transfer in outgoing_transfers]
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
        'store_manager/trans_out.html',
        user=current_user,
        store=store,
        outgoing_transfers=outgoing_transfers,
        item_count_by_transfer=item_count_by_transfer,
    )


@views.route('/store-manager/trans-out/<int:transfer_id>')
@login_required
def store_manager_outgoing_transfer_view(transfer_id):
    role = (current_user.role or '').strip()
    if role not in ('Store Manager', 'Inventory Staff'):
        flash('Access denied. Only Store Manager or Inventory Staff can access this page.', category='error')
        return redirect(url_for('views.home'))

    store = _resolve_store_for_store_scope_user()
    if not store:
        flash('You are not assigned to any store yet.', category='error')
        return redirect(url_for('views.home'))

    transfer = TafTransfer.query.filter_by(id=transfer_id).first()
    if not transfer:
        flash('Transfer record not found.', category='error')
        return redirect(url_for('views.store_manager_outgoing_transfers'))

    if int(getattr(transfer, 'store_id', 0) or 0) != int(store.id):
        flash('You can only view outgoing transfers from your store.', category='error')
        return redirect(url_for('views.store_manager_outgoing_transfers'))

    transfer_items = (
        TafTransferItem.query
        .filter(TafTransferItem.transfer_id == transfer.id)
        .order_by(TafTransferItem.id.asc())
        .all()
    )

    return render_template(
        'store_manager/trans_view.html',
        user=current_user,
        store=store,
        transfer=transfer,
        transfer_items=transfer_items,
        can_edit_receive=False,
        trans_view_mode='outgoing',
    )


@views.route('/store-manager/wastage/<int:transfer_id>')
@login_required
def store_manager_wastage_transfer_view(transfer_id):
    role = (current_user.role or '').strip()
    if role not in ('Store Manager', 'Inventory Staff'):
        flash('Access denied. Only Store Manager or Inventory Staff can access this page.', category='error')
        return redirect(url_for('views.home'))

    store = _resolve_store_for_store_scope_user()
    if not store:
        flash('You are not assigned to any store yet.', category='error')
        return redirect(url_for('views.home'))

    transfer = TafTransfer.query.filter_by(id=transfer_id).first()
    if not transfer:
        flash('Transfer record not found.', category='error')
        return redirect(url_for('views.store_manager_wastage'))

    normalized_store_name = str(store.name or '').strip().lower()
    transfer_to_name = str(getattr(transfer, 'transfer_to', '') or '').strip().lower()
    is_incoming_for_current_store = (
        transfer_to_name == normalized_store_name
        and int(getattr(transfer, 'store_id', 0) or 0) != int(store.id)
    )
    if not is_incoming_for_current_store:
        flash('You can only view incoming wastage transfers sent to your store.', category='error')
        return redirect(url_for('views.store_manager_wastage'))

    transfer_type = str(getattr(transfer, 'transaction_type', '') or '').strip().lower()
    if transfer_type != 'wastage transfer':
        flash('Selected transfer is not a wastage transfer.', category='error')
        return redirect(url_for('views.store_manager_wastage'))
    return redirect(url_for('views.store_manager_incoming_transfer_view', transfer_id=transfer.id))


@views.route('/store-manager/wastage')
@login_required
def store_manager_wastage():
    role = (current_user.role or '').strip()
    if role not in ('Store Manager', 'Inventory Staff'):
        flash('Access denied. Only Store Manager or Inventory Staff can access this page.', category='error')
        return redirect(url_for('views.home'))

    store = _resolve_store_for_store_scope_user()
    if not store:
        flash('You are not assigned to any store yet.', category='error')
        return redirect(url_for('views.home'))

    normalized_store_name = str(store.name or '').strip().lower()
    wastage_transfers = (
        TafTransfer.query
        .filter(func.lower(func.trim(TafTransfer.transaction_type)) == 'wastage transfer')
        .filter(
            (
                (func.lower(func.trim(TafTransfer.transfer_to)) == normalized_store_name)
                & (TafTransfer.store_id != store.id)
            )
            | (
                (TafTransfer.store_id == store.id)
                & (func.lower(func.trim(TafTransfer.transfer_to)) == 'main office')
            )
        )
        .order_by(TafTransfer.transaction_date.desc(), TafTransfer.id.desc())
        .all()
    )

    transfer_ids = [transfer.id for transfer in wastage_transfers]
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
        'store_manager/wastage.html',
        user=current_user,
        store=store,
        wastage_transfers=wastage_transfers,
        item_count_by_transfer=item_count_by_transfer,
    )


@views.route('/store-manager/daily-report/pos-sold/review', methods=['POST'])
@login_required
def review_pos_sold_excel():
    if current_user.role != 'Store Manager':
        flash('Access denied.', category='error')
        return redirect(url_for('views.home'))

    report_date = date.today()
    try:
        store = Store.query.filter_by(manager_id=current_user.id).first()
        if not store:
            flash('You are not assigned to any store.', category='error')
            return redirect(url_for('views.home'))

        report_date_str = (request.form.get('report_date') or '').strip()
        report_date = datetime.strptime(report_date_str, '%Y-%m-%d').date() if report_date_str else date.today()
        if report_date > date.today():
            flash('Report date cannot be in the future.', category='error')
            return redirect(url_for('views.store_manager_pos_sold', date=report_date.strftime('%Y-%m-%d')))

        upload_file = request.files.get('pos_file')
        if not upload_file or upload_file.filename == '':
            flash('Please select a POS Excel file to upload.', category='error')
            return redirect(url_for('views.store_manager_pos_sold', date=report_date.strftime('%Y-%m-%d')))

        filename = (upload_file.filename or '').lower()
        if not filename.endswith(('.xls', '.xlsx')):
            flash('Please upload an Excel file (.xls or .xlsx).', category='error')
            return redirect(url_for('views.store_manager_pos_sold', date=report_date.strftime('%Y-%m-%d')))

        parsed_items = _extract_pos_sold_items_from_excel(upload_file, expected_report_date=report_date)

        report = DailyReport.query.filter_by(store_id=store.id, report_date=report_date).first()
        if report and PosSold.query.filter_by(daily_report_id=report.id).first():
            flash('POS sold for this report date has already been uploaded. Upload is allowed once only.', category='error')
            return redirect(url_for('views.store_manager_pos_sold', date=report_date.strftime('%Y-%m-%d')))

        _set_pos_sold_draft(store.id, report_date, parsed_items)

        log_audit_event(
            action='report.pos_sold.review',
            entity_type='Store',
            entity_id=store.id,
            reason='Store manager extracted POS sold items from Excel for review.',
            details={
                'store_id': store.id,
                'report_date': report_date.strftime('%Y-%m-%d'),
                'filename': upload_file.filename,
                'rows_extracted': len(parsed_items),
            },
        )
        db.session.commit()

        return redirect(
            url_for(
                'views.store_manager_pos_sold',
                date=report_date.strftime('%Y-%m-%d'),
                pos_scan_success=1,
                pos_scan_rows=len(parsed_items),
            )
        )

    except ValueError as exc:
        db.session.rollback()
        flash(str(exc), category='error')
    except Exception as exc:
        db.session.rollback()
        flash(f'Error uploading POS sold file: {str(exc)}', category='error')

    return redirect(url_for('views.store_manager_pos_sold', date=report_date.strftime('%Y-%m-%d')))


@views.route('/store-manager/daily-report/pos-sold/clear', methods=['POST'])
@login_required
def clear_pos_sold_review_data():
    if current_user.role != 'Store Manager':
        flash('Access denied.', category='error')
        return redirect(url_for('views.home'))

    report_date = date.today()
    try:
        store = Store.query.filter_by(manager_id=current_user.id).first()
        if not store:
            flash('You are not assigned to any store.', category='error')
            return redirect(url_for('views.home'))

        report_date_str = (request.form.get('report_date') or '').strip()
        report_date = datetime.strptime(report_date_str, '%Y-%m-%d').date() if report_date_str else date.today()

        cleared_items = _pop_pos_sold_draft(store.id, report_date)
        if cleared_items:
            flash('Extracted POS sold review data cleared.', category='success')
        else:
            flash('No extracted POS sold review data found to clear.', category='info')

    except Exception as exc:
        flash(f'Error clearing extracted data: {str(exc)}', category='error')

    return redirect(url_for('views.store_manager_pos_sold', date=report_date.strftime('%Y-%m-%d')))


@views.route('/store-manager/daily-report/pos-sold/submit', methods=['POST'])
@login_required
def submit_pos_sold_report():
    if current_user.role != 'Store Manager':
        flash('Access denied.', category='error')
        return redirect(url_for('views.home'))

    report_date = date.today()
    try:
        store = Store.query.filter_by(manager_id=current_user.id).first()
        if not store:
            flash('You are not assigned to any store.', category='error')
            return redirect(url_for('views.home'))

        report_date_str = (request.form.get('report_date') or '').strip()
        report_date = datetime.strptime(report_date_str, '%Y-%m-%d').date() if report_date_str else date.today()
        if report_date > date.today():
            flash('Report date cannot be in the future.', category='error')
            return redirect(url_for('views.store_manager_pos_sold', date=report_date.strftime('%Y-%m-%d')))

        existing_report = DailyReport.query.filter_by(store_id=store.id, report_date=report_date).first()
        if existing_report and PosSold.query.filter_by(daily_report_id=existing_report.id).first():
            flash('POS sold for this report date has already been uploaded. Submission is allowed once only.', category='error')
            return redirect(url_for('views.store_manager_pos_sold', date=report_date.strftime('%Y-%m-%d')))
        if not existing_report:
            flash(
                'Daily report for this date is not submitted yet. Submit Daily Report first, then submit POS Sold.',
                category='error',
            )
            return redirect(url_for('views.store_manager_pos_sold', date=report_date.strftime('%Y-%m-%d')))

        z_reading_image_file = request.files.get('z_reading_image')
        z_reading_base64 = (request.form.get('z_reading_image_base64') or '').strip()
        z_reading_name = (request.form.get('z_reading_image_name') or '').strip()
        z_reading_mime = (request.form.get('z_reading_image_mime') or '').strip()

        has_uploaded_file = bool(z_reading_image_file and (z_reading_image_file.filename or '').strip())
        has_base64_image = bool(z_reading_base64)

        drive_file = None
        if has_uploaded_file:
            if not _is_allowed_image_filename(z_reading_image_file.filename):
                flash('Please upload an image file (.png, .jpg, .jpeg, .webp).', category='error')
                return redirect(url_for('views.store_manager_pos_sold', date=report_date.strftime('%Y-%m-%d')))
            drive_file = _upload_z_reading_to_google_drive(z_reading_image_file, store, report_date)
        elif has_base64_image:
            if ',' in z_reading_base64 and z_reading_base64.lower().startswith('data:'):
                z_reading_base64 = z_reading_base64.split(',', 1)[1].strip()

            fallback_name = z_reading_name or 'z_reading_image.jpg'
            if not _is_allowed_image_filename(fallback_name):
                flash('Stored image is invalid. Please attach a valid image again.', category='error')
                return redirect(url_for('views.store_manager_pos_sold', date=report_date.strftime('%Y-%m-%d')))

            try:
                decoded_bytes = base64.b64decode(z_reading_base64, validate=True)
            except (ValueError, binascii.Error):
                flash('Stored image is invalid or corrupted. Please attach the image again.', category='error')
                return redirect(url_for('views.store_manager_pos_sold', date=report_date.strftime('%Y-%m-%d')))

            drive_file = _upload_z_reading_bytes_to_google_drive(
                file_bytes=decoded_bytes,
                original_name=fallback_name,
                mime_type=(z_reading_mime or 'application/octet-stream'),
                store=store,
                report_date=report_date,
            )

        drive_link = (drive_file.get('web_view_link') or drive_file.get('web_content_link') or '').strip() if drive_file else ''

        draft_pos_sold_items = _sanitize_pos_sold_items(_get_pos_sold_draft(store.id, report_date))

        if not draft_pos_sold_items:
            flash(
                f'POS Sold is not yet uploaded for {report_date.strftime("%B %d, %Y")}. '
                f'Please attach POS Sold file and click Review Data first, then continue via Next.',
                category='error'
            )
            return redirect(url_for('views.store_manager_pos_sold', date=report_date.strftime('%Y-%m-%d'), guide=1))

        report = existing_report

        db.session.flush()

        PosSold.query.filter_by(daily_report_id=report.id).delete(synchronize_session=False)
        for item in draft_pos_sold_items:
            db.session.add(
                PosSold(
                    daily_report_id=report.id,
                    product_name=str(item.get('product_name', '')).strip(),
                    quantity=int(item.get('quantity', 0) or 0),
                    gross_sales=float(item.get('gross_sales', 0.0) or 0.0),
                    discount=float(item.get('discount', 0.0) or 0.0),
                    net_sales=float(item.get('net_sales', 0.0) or 0.0),
                    z_reading_image_path=drive_link or None,
                )
            )

        saved_quantities = _build_pos_sold_quantities_by_master_id(draft_pos_sold_items)
        _apply_pos_sold_quantities_to_inventory(store.id, report_date, saved_quantities)
        _pop_pos_sold_draft(store.id, report_date)

        log_audit_event(
            action='report.pos_sold.submit',
            entity_type='DailyReport',
            entity_id=report.id,
            reason='Store manager submitted POS sold rows.',
            details={
                'store_id': store.id,
                'report_date': report_date.strftime('%Y-%m-%d'),
                'status': report.status,
                'rows_saved': len(draft_pos_sold_items),
                'z_reading_drive_file_id': drive_file.get('file_id', '') if drive_file else '',
                'z_reading_drive_link': drive_link,
            },
        )
        db.session.commit()

        flash(
            f'POS sold report for {report_date.strftime("%B %d, %Y")} submitted successfully!',
            category='success'
        )

    except Exception as exc:
        db.session.rollback()
        flash(f'Error submitting POS sold report: {str(exc)}', category='error')

    return redirect(url_for('views.store_manager_pos_sold', date=report_date.strftime('%Y-%m-%d')))


@views.route('/store-manager/daily-report/pos-sold/upload-z-reading', methods=['POST'])
@login_required
def upload_pos_sold_z_reading():
    if current_user.role != 'Store Manager':
        flash('Access denied.', category='error')
        return redirect(url_for('views.home'))

    report_date = date.today()
    try:
        store = Store.query.filter_by(manager_id=current_user.id).first()
        if not store:
            flash('You are not assigned to any store.', category='error')
            return redirect(url_for('views.home'))

        report_date_str = (request.form.get('report_date') or '').strip()
        report_date = datetime.strptime(report_date_str, '%Y-%m-%d').date() if report_date_str else date.today()

        report = DailyReport.query.filter_by(store_id=store.id, report_date=report_date).first()
        if not report:
            flash('Daily report for this date was not found.', category='error')
            return redirect(url_for('views.store_manager_pos_sold', date=report_date.strftime('%Y-%m-%d')))

        pos_items = (
            PosSold.query
            .filter_by(daily_report_id=report.id)
            .order_by(PosSold.id.asc())
            .all()
        )
        if not pos_items:
            flash('No POS sold rows found for this date. Submit POS sold first.', category='error')
            return redirect(url_for('views.store_manager_pos_sold', date=report_date.strftime('%Y-%m-%d')))

        z_reading_image_file = request.files.get('z_reading_image')
        if not z_reading_image_file or not (z_reading_image_file.filename or '').strip():
            flash('Please choose an image file to upload.', category='error')
            return redirect(url_for('views.store_manager_pos_sold', date=report_date.strftime('%Y-%m-%d')))
        if not _is_allowed_image_filename(z_reading_image_file.filename):
            flash('Please upload an image file (.png, .jpg, .jpeg, .webp).', category='error')
            return redirect(url_for('views.store_manager_pos_sold', date=report_date.strftime('%Y-%m-%d')))

        drive_file = _upload_z_reading_to_google_drive(z_reading_image_file, store, report_date)
        drive_link = (drive_file.get('web_view_link') or drive_file.get('web_content_link') or '').strip()
        if not drive_link:
            flash('Uploaded image link is missing. Please try again.', category='error')
            return redirect(url_for('views.store_manager_pos_sold', date=report_date.strftime('%Y-%m-%d')))

        for item in pos_items:
            item.z_reading_image_path = drive_link

        log_audit_event(
            action='report.pos_sold.upload_z_reading',
            entity_type='DailyReport',
            entity_id=report.id,
            reason='Store manager uploaded Z reading image after POS sold submission.',
            details={
                'store_id': store.id,
                'report_date': report_date.strftime('%Y-%m-%d'),
                'rows_updated': len(pos_items),
                'z_reading_drive_file_id': drive_file.get('file_id', ''),
                'z_reading_drive_link': drive_link,
            },
        )
        db.session.commit()
        flash('Z Reading image uploaded successfully.', category='success')
    except Exception as exc:
        db.session.rollback()
        flash(f'Error uploading Z Reading image: {str(exc)}', category='error')

    return redirect(url_for('views.store_manager_pos_sold', date=report_date.strftime('%Y-%m-%d')))


@views.route('/store-manager/daily-report/submit', methods=['POST'])
@login_required
def submit_daily_report():
    if current_user.role != 'Store Manager':
        flash('Access denied.', category='error')
        return redirect(url_for('views.home'))
    
    try:
        # Get the store managed by this user
        store = Store.query.filter_by(manager_id=current_user.id).first()
        
        if not store:
            flash('You are not assigned to any store.', category='error')
            return redirect(url_for('views.home'))
        
        # Get report date from form
        report_date_str = request.form.get('report_date')
        report_date = datetime.strptime(report_date_str, '%Y-%m-%d').date() if report_date_str else date.today()

        # Block empty submissions (date-only is not considered report data)
        ignored_keys = {'report_date', 'csrf_token'}
        has_report_values = any(
            (value or '').strip()
            for key, value in request.form.items()
            if key not in ignored_keys
        )
        if not has_report_values:
            flash('Please enter at least one report value before submitting.', category='error')
            return redirect(url_for('views.store_manager_report', date=report_date.strftime('%Y-%m-%d')))
        
        # Check if report already exists for this date
        existing_report = DailyReport.query.filter_by(store_id=store.id, report_date=report_date).first()
        
        if existing_report and existing_report.status == 'Approved':
            flash(
                f'A report for {report_date.strftime("%B %d, %Y")} is already approved and cannot be changed.',
                category='error'
            )
            return redirect(url_for('views.store_manager_report', date=report_date.strftime('%Y-%m-%d')))

        has_existing_saved_pos_for_date = bool(
            existing_report and PosSold.query.filter_by(daily_report_id=existing_report.id).first()
        )
        draft_pos_sold_items = _sanitize_pos_sold_items(_get_pos_sold_draft(store.id, report_date))
        if not has_existing_saved_pos_for_date and not draft_pos_sold_items:
            flash(
                f'POS Sold is not yet uploaded for {report_date.strftime("%B %d, %Y")}. '
                f'Please attach POS Sold file, click Review Data, then click Next to continue Daily Report.',
                category='error'
            )
            return redirect(url_for('views.store_manager_pos_sold', date=report_date.strftime('%Y-%m-%d'), guide=1))
        
        # Helper function to get float value
        def get_float(key, default=0.0):
            val = request.form.get(key, '')
            return float(val) if val and val.strip() else default
        
        # Helper function to get int value
        def get_int(key, default=0):
            val = request.form.get(key, '')
            return int(val) if val and val.strip() else default
        
        report_values = {
            # POS Sales
            'pos_gross_sales': get_float('pos_gross_sales'),
            'pos_net_sales': get_float('pos_net_sales'),
            'pos_tc': get_int('pos_tc'),
            # CI Regular Sales
            'ci_regular_gross_sales': get_float('ci_regular_gross_sales'),
            'ci_regular_net_sales': get_float('ci_regular_net_sales'),
            'ci_tc': get_int('ci_tc'),
            # CI Details
            'ci_number': request.form.get('ci_number', ''),
            'ci_sales_discount': get_float('ci_sales_discount'),
            # SGA
            'boothselling_sales': get_float('boothselling_sales'),
            'boothselling_tc': get_int('boothselling_tc'),
            'bulk_order_sales': get_float('bulk_order_sales'),
            'bulk_order_tc': get_int('bulk_order_tc'),
            'reseller_sales': get_float('reseller_sales'),
            'reseller_tc': get_int('reseller_tc'),
            'tieup_sales': get_float('tieup_sales'),
            'tieup_tc': get_int('tieup_tc'),
            'gow_sales': get_float('gow_sales'),
            'gow_tc': get_int('gow_tc'),
            'ambulant_sales': get_float('ambulant_sales'),
            'ambulant_tc': get_int('ambulant_tc'),
            'extended_hours_sales': get_float('extended_hours_sales'),
            'extended_hours_tc': get_int('extended_hours_tc'),
            # Aggregators
            'gds_sales': get_float('gds_sales'),
            'gds_tc': get_int('gds_tc'),
            'grab_sales': get_float('grab_sales'),
            'grab_tc': get_int('grab_tc'),
            'foodpanda_sales': get_float('foodpanda_sales'),
            'foodpanda_tc': get_int('foodpanda_tc'),
            'paymaya_sales': get_float('paymaya_sales'),
            'paymaya_tc': get_int('paymaya_tc'),
            'gcash_sales': get_float('gcash_sales'),
            'gcash_tc': get_int('gcash_tc'),
            # LDTS
            'ldts_gc': get_int('ldts_gc'),
            'ldts_rolls': get_int('ldts_rolls'),
            'ldts_premium': get_int('ldts_premium'),
            # Ending Inventory
            'ending_inv_gc': get_int('ending_inv_gc'),
            'ending_inv_rolls': get_int('ending_inv_rolls'),
            'ending_inv_premium': get_int('ending_inv_premium'),
            # Spoilage
            'spoilage_gc': get_float('spoilage_gc'),
            'spoilage_rolls': get_float('spoilage_rolls'),
            'spoilage_premium': get_float('spoilage_premium'),
            'spoilage_others': get_float('spoilage_others'),
            # Discount Monitoring
            'senior_pwd_discount': get_float('senior_pwd_discount'),
            'promo_ldts_discount': get_float('promo_ldts_discount'),
            'bulk_orders_discount': get_float('bulk_orders_discount'),
            # Calculated Spoilage
            'total_net_spoilage': get_float('total_net_spoilage'),
            'spoilage_percentage': get_float('spoilage_percentage'),
            'mtd_percentage': get_float('mtd_percentage'),
        }

        if existing_report:
            new_report = existing_report
            new_report.submitted_by = current_user.id
            if new_report.status not in ('Approved', 'Rejected'):
                new_report.status = 'Pending'
            for field_name, field_value in report_values.items():
                setattr(new_report, field_name, field_value)
        else:
            new_report = DailyReport(
                store_id=store.id,
                report_date=report_date,
                submitted_by=current_user.id,
                **report_values,
            )
            db.session.add(new_report)

        db.session.flush()

        auto_saved_pos_rows = 0
        has_existing_saved_pos = bool(PosSold.query.filter_by(daily_report_id=new_report.id).first())
        if draft_pos_sold_items and not has_existing_saved_pos:
            for item in draft_pos_sold_items:
                db.session.add(
                    PosSold(
                        daily_report_id=new_report.id,
                        product_name=str(item.get('product_name', '')).strip(),
                        quantity=int(item.get('quantity', 0) or 0),
                        gross_sales=float(item.get('gross_sales', 0.0) or 0.0),
                        discount=float(item.get('discount', 0.0) or 0.0),
                        net_sales=float(item.get('net_sales', 0.0) or 0.0),
                        z_reading_image_path=None,
                    )
                )
            _pop_pos_sold_draft(store.id, report_date)
            auto_saved_pos_rows = len(draft_pos_sold_items)

        log_audit_event(
            action='report.submit',
            entity_type='DailyReport',
            entity_id=new_report.id,
            reason='Store manager submitted a daily report.',
            details={
                'store_id': store.id,
                'report_date': report_date.strftime('%Y-%m-%d'),
                'status': new_report.status,
                'mode': 'update' if existing_report else 'create',
                'auto_saved_pos_rows': auto_saved_pos_rows,
            },
        )
        if auto_saved_pos_rows:
            log_audit_event(
                action='report.pos_sold.auto_submit',
                entity_type='DailyReport',
                entity_id=new_report.id,
                reason='POS sold draft rows were auto-saved during daily report submission.',
                details={
                    'store_id': store.id,
                    'report_date': report_date.strftime('%Y-%m-%d'),
                    'rows_saved': auto_saved_pos_rows,
                },
            )
        db.session.commit()

        if auto_saved_pos_rows:
            flash(
                f'Daily report for {report_date.strftime("%B %d, %Y")} submitted successfully! '
                f'POS sold was also submitted ({auto_saved_pos_rows} row{"s" if auto_saved_pos_rows != 1 else ""}).',
                category='success'
            )
        else:
            flash(f'Daily report for {report_date.strftime("%B %d, %Y")} submitted successfully!', category='success')
        
    except Exception as e:
        db.session.rollback()
        flash(f'Error submitting report: {str(e)}', category='error')
    
    return redirect(url_for('views.store_manager_report'))


# Cluster Manager Routes
@views.route('/cluster-manager/raw-data')
@login_required
def cluster_manager_raw_data():
    if current_user.role != 'Cluster Manager':
        flash('Access denied. Only Cluster Managers can access this page.', category='error')
        return redirect(url_for('views.home'))
    
    # Get the cluster managed by this user
    from .models import Cluster
    cluster = Cluster.query.filter_by(manager_id=current_user.id).first()
    
    if not cluster:
        flash('You are not assigned to any cluster yet.', category='error')
        return redirect(url_for('views.home'))
    
    # Get stores in this cluster
    stores = Store.query.filter_by(cluster_id=cluster.id).all()
    
    # Get current month and year (or from query params)
    from datetime import datetime as dt
    today = date.today()
    current_month = request.args.get('month', today.strftime('%m'))
    current_year = request.args.get('year', str(today.year))
    store_filter = request.args.get('store_id', '')
    
    # Fetch daily reports for the selected month/year
    from calendar import monthrange
    import calendar
    
    # Get all store IDs in this cluster
    store_ids = [s.id for s in stores]
    
    # Filter by specific store if selected
    if store_filter:
        store_ids = [int(store_filter)]
    
    # Build date range for the month
    year_int = int(current_year)
    month_int = int(current_month)
    _, num_days = monthrange(year_int, month_int)
    
    # Fetch all reports for this month
    from datetime import datetime
    start_date = datetime(year_int, month_int, 1).date()
    end_date = datetime(year_int, month_int, num_days).date()
    
    reports = DailyReport.query.filter(
        DailyReport.store_id.in_(store_ids),
        DailyReport.report_date >= start_date,
        DailyReport.report_date <= end_date
    ).all()
    _coalesce_numeric_fields_for_reports(reports)
    _apply_pos_qty_from_pos_categories(reports)
    
    # Fetch store targets for the selected month
    from .models import StoreTarget
    targets = StoreTarget.query.filter(
        StoreTarget.store_id.in_(store_ids),
        StoreTarget.target_date >= start_date,
        StoreTarget.target_date <= end_date
    ).all()
    
    # Organize targets by date
    targets_by_date = {}
    for target in targets:
        date_key = target.target_date.strftime('%Y-%m-%d')
        if date_key not in targets_by_date:
            targets_by_date[date_key] = []
        targets_by_date[date_key].append(target)

    daily_targets = _aggregate_targets_by_day(targets)
    acc_daily_targets = _build_acc_targets_by_day(year_int, month_int, daily_targets)
    acc_daily_sales = _build_acc_sales_by_day(year_int, month_int, reports)
    mtd_metrics_by_day = _build_mtd_metrics_by_day(year_int, month_int, acc_daily_sales, acc_daily_targets)
    _attach_report_calc_fields(
        reports,
        daily_targets,
        acc_targets_by_day=acc_daily_targets,
        acc_sales_by_day=acc_daily_sales
    )
    summary = _build_cluster_manager_summary(reports, targets)

    store_name_by_id = {int(store.id): (store.name or '') for store in stores}
    pos_scope_reports = (
        DailyReport.query
        .join(PosSold, PosSold.daily_report_id == DailyReport.id)
        .filter(DailyReport.store_id.in_(store_ids))
        .group_by(DailyReport.id)
        .order_by(DailyReport.report_date.desc(), DailyReport.id.desc())
        .all()
    )
    pos_scope_report_ids = [int(report.id) for report in pos_scope_reports]
    pos_items_by_report = {}
    if pos_scope_report_ids:
        pos_items = (
            PosSold.query
            .filter(PosSold.daily_report_id.in_(pos_scope_report_ids))
            .order_by(PosSold.daily_report_id.asc(), PosSold.id.asc())
            .all()
        )
        for item in pos_items:
            if _is_grand_total_product_name(item.product_name):
                continue
            pos_items_by_report.setdefault(int(item.daily_report_id), []).append({
                'product_name': item.product_name,
                'quantity': int(item.quantity or 0),
                'net_sales': float(item.net_sales or 0.0),
            })

    pos_modal_payload = []
    for report in pos_scope_reports:
        pos_modal_payload.append({
            'report_id': int(report.id),
            'store_id': int(report.store_id),
            'store_name': store_name_by_id.get(int(report.store_id), f'Store {report.store_id}'),
            'date': report.report_date.strftime('%Y-%m-%d') if report.report_date else '',
            'label': report.report_date.strftime('%B %d, %Y') if report.report_date else '',
            'items': pos_items_by_report.get(int(report.id), []),
        })

    # Organize reports by date
    reports_by_date = _group_reports_by_date(reports)
    
    cluster_sidebar_stores = _build_cluster_sidebar_stores(stores, start_date, end_date)

    return render_template('cluster_manager/raw_data.html', 
                         user=current_user, 
                         cluster=cluster, 
                         team_name=_get_team_name(cluster),
                          stores=stores,
                          cluster_sidebar_stores=cluster_sidebar_stores,
                          current_month=current_month,
                          current_year=current_year,
                         store_filter=store_filter,
                         reports_by_date=reports_by_date,
                         targets_by_date=targets_by_date,
                         daily_targets=daily_targets,
                         acc_daily_targets=acc_daily_targets,
                         acc_daily_sales=acc_daily_sales,
                         mtd_metrics_by_day=mtd_metrics_by_day,
                         pos_modal_payload=pos_modal_payload,
                         summary=summary,
                         today_day=today.day,
                         today_month=today.month,
                         today_year=today.year)


@views.route('/cluster-manager/cluster-data')
@login_required
def cluster_manager_cluster_data():
    role = (current_user.role or '').strip()
    if role not in ('Cluster Manager', 'Admin', 'Superadmin'):
        flash('Access denied. Only Cluster Managers and Admins can access this page.', category='error')
        return redirect(url_for('views.home'))

    from .models import Cluster
    cluster = None

    if role == 'Cluster Manager':
        # Cluster managers can only open their assigned cluster.
        cluster = Cluster.query.filter_by(manager_id=current_user.id).first()
        if not cluster:
            flash('You are not assigned to any cluster yet.', category='error')
            return redirect(url_for('views.home'))
    else:
        # Admin/Superadmin can open any cluster via query param.
        cluster_id = request.args.get('cluster_id', type=int)
        if not cluster_id:
            flash('Please choose a cluster to view data.', category='error')
            return redirect(url_for('admin.clusters'))
        cluster = Cluster.query.get_or_404(cluster_id)
    
    # Get stores in this cluster
    stores = Store.query.filter_by(cluster_id=cluster.id).all()
    
    # Get current month and year (or from query params)
    from datetime import datetime as dt
    today = date.today()
    current_month = request.args.get('month', today.strftime('%m'))
    current_year = request.args.get('year', str(today.year))
    store_filter = request.args.get('store_id', '')
    
    # Fetch daily reports for the selected month/year
    from calendar import monthrange
    import calendar
    
    # Get all store IDs in this cluster
    cluster_store_ids = [s.id for s in stores]
    store_ids = list(cluster_store_ids)
    
    # Filter by specific store if selected
    if store_filter:
        try:
            selected_store_id = int(store_filter)
        except (TypeError, ValueError):
            flash('Invalid store selection.', category='error')
            return redirect(url_for('views.cluster_manager_cluster_data', cluster_id=cluster.id, month=current_month, year=current_year))
        if selected_store_id in cluster_store_ids:
            store_ids = [selected_store_id]
        else:
            flash('Selected store does not belong to this cluster.', category='error')
            return redirect(url_for('views.cluster_manager_cluster_data', cluster_id=cluster.id, month=current_month, year=current_year))
    
    # Build date range for the month
    year_int = int(current_year)
    month_int = int(current_month)
    _, num_days = monthrange(year_int, month_int)
    
    # Fetch all reports for this month
    from datetime import datetime
    start_date = datetime(year_int, month_int, 1).date()
    end_date = datetime(year_int, month_int, num_days).date()
    
    # Match Raw Data logic: include all report statuses for the selected scope.
    reports = DailyReport.query.filter(
        DailyReport.store_id.in_(store_ids),
        DailyReport.report_date >= start_date,
        DailyReport.report_date <= end_date
    ).all()
    _coalesce_numeric_fields_for_reports(reports)
    _apply_pos_qty_from_pos_categories(reports)
    consolidated_reports = _consolidate_cluster_reports_by_date(reports)
    
    # Fetch store targets for the selected month
    from .models import StoreTarget
    targets = StoreTarget.query.filter(
        StoreTarget.store_id.in_(store_ids),
        StoreTarget.target_date >= start_date,
        StoreTarget.target_date <= end_date
    ).all()
    
    # Organize targets by date (same shape as raw-data flow).
    targets_by_date = {}
    for target in targets:
        date_key = target.target_date.strftime('%Y-%m-%d')
        if date_key not in targets_by_date:
            targets_by_date[date_key] = []
        targets_by_date[date_key].append(target)
    
    daily_targets = _aggregate_targets_by_day(targets)
    acc_daily_targets = _build_acc_targets_by_day(year_int, month_int, daily_targets)
    acc_daily_sales = _build_acc_sales_by_day(year_int, month_int, consolidated_reports)
    mtd_metrics_by_day = _build_mtd_metrics_by_day(year_int, month_int, acc_daily_sales, acc_daily_targets)
    _attach_report_calc_fields(
        consolidated_reports,
        daily_targets,
        prioritize_pending=True,
        acc_targets_by_day=acc_daily_targets,
        acc_sales_by_day=acc_daily_sales
    )
    summary = _build_cluster_manager_summary(consolidated_reports, targets)

    store_name_by_id = {int(store.id): (store.name or '') for store in stores}
    pos_scope_reports = (
        DailyReport.query
        .join(PosSold, PosSold.daily_report_id == DailyReport.id)
        .filter(DailyReport.store_id.in_(store_ids))
        .group_by(DailyReport.id)
        .order_by(DailyReport.report_date.desc(), DailyReport.id.desc())
        .all()
    )
    pos_scope_report_ids = [int(report.id) for report in pos_scope_reports]
    pos_items_by_report = {}
    if pos_scope_report_ids:
        pos_items = (
            PosSold.query
            .filter(PosSold.daily_report_id.in_(pos_scope_report_ids))
            .order_by(PosSold.daily_report_id.asc(), PosSold.id.asc())
            .all()
        )
        for item in pos_items:
            if _is_grand_total_product_name(item.product_name):
                continue
            pos_items_by_report.setdefault(int(item.daily_report_id), []).append({
                'product_name': item.product_name,
                'quantity': int(item.quantity or 0),
                'net_sales': float(item.net_sales or 0.0),
            })

    pos_modal_payload = []
    for report in pos_scope_reports:
        pos_modal_payload.append({
            'report_id': int(report.id),
            'store_id': int(report.store_id),
            'store_name': store_name_by_id.get(int(report.store_id), f'Store {report.store_id}'),
            'date': report.report_date.strftime('%Y-%m-%d') if report.report_date else '',
            'label': report.report_date.strftime('%B %d, %Y') if report.report_date else '',
            'items': pos_items_by_report.get(int(report.id), []),
        })
    
    # Calculate statistics
    total_reports = DailyReport.query.filter(
        DailyReport.store_id.in_(store_ids),
        DailyReport.report_date >= start_date,
        DailyReport.report_date <= end_date
    ).count()
    
    approved_reports_count = len(consolidated_reports)
    
    # Organize reports by date
    reports_by_date = _group_reports_by_date(consolidated_reports)
    
    cluster_sidebar_stores = _build_cluster_sidebar_stores(stores, start_date, end_date)

    return render_template('cluster_manager/cluster_data.html', 
                         user=current_user, 
                         cluster=cluster, 
                         team_name=_get_team_name(cluster),
                         stores=stores,
                         force_cluster_sidebar=(role in ('Admin', 'Superadmin')),
                         cluster_sidebar_cluster_id=cluster.id if role in ('Admin', 'Superadmin') else '',
                         cluster_sidebar_stores=cluster_sidebar_stores,
                         current_month=current_month,
                         current_year=current_year,
                         store_filter=store_filter,
                         reports_by_date=reports_by_date,
                         targets_by_date=targets_by_date,
                         daily_targets=daily_targets,
                         acc_daily_targets=acc_daily_targets,
                         acc_daily_sales=acc_daily_sales,
                         mtd_metrics_by_day=mtd_metrics_by_day,
                         total_reports=total_reports,
                         approved_reports_count=approved_reports_count,
                         pos_modal_payload=pos_modal_payload,
                         summary=summary,
                         today_day=today.day,
                         today_month=today.month,
                         today_year=today.year)


@views.route('/cluster-manager/oracle')
@login_required
def cluster_manager_oracle():
    role = (current_user.role or '').strip()
    if role not in ('Cluster Manager', 'Admin', 'Superadmin'):
        flash('Access denied. Only Cluster Managers and Admins can access this page.', category='error')
        return redirect(url_for('views.home'))

    from .models import Cluster, Store
    cluster = None
    if role == 'Cluster Manager':
        cluster = Cluster.query.filter_by(manager_id=current_user.id).first()
        if not cluster:
            flash('You are not assigned to any cluster yet.', category='error')
            return redirect(url_for('views.home'))
    else:
        cluster_id = request.args.get('cluster_id', type=int)
        if not cluster_id:
            flash('Please choose a cluster to view Oracle.', category='error')
            return redirect(url_for('admin.clusters'))
        cluster = Cluster.query.get_or_404(cluster_id)

    stores = Store.query.filter_by(cluster_id=cluster.id).all()
    cluster_sidebar_stores = _build_cluster_sidebar_stores(stores)

    from .models import ProductMaster, StoreProductBuffer
    products = ProductMaster.query.order_by(ProductMaster.category, ProductMaster.description).all()

    store_ids = [s.id for s in stores]
    saved_buffers = StoreProductBuffer.query.filter(StoreProductBuffer.store_id.in_(store_ids)).all()
    buffers_map = {}
    for b in saved_buffers:
        buffers_map.setdefault(b.store_id, {})[b.product_id] = b.buffer_pct

    return render_template('cluster_manager/oracle.html',
                           user=current_user,
                           cluster=cluster,
                           team_name=_get_team_name(cluster),
                           stores=stores,
                           products=products,
                           buffers_map=buffers_map,
                           cluster_sidebar_stores=cluster_sidebar_stores,
                           force_cluster_sidebar=(role in ('Admin', 'Superadmin')),
                           cluster_sidebar_cluster_id=cluster.id if role in ('Admin', 'Superadmin') else '')


@views.route('/cluster-manager/invensync')
@login_required
def cluster_manager_invensync():
    """Cluster Manager view for Invensync ending inventory from assigned stores only"""
    from datetime import date as _date
    role = (current_user.role or '').strip()
    if role not in ('Cluster Manager', 'Admin', 'Superadmin'):
        flash('Access denied.', category='error')
        return redirect(url_for('views.home'))

    from .models import Cluster, Store
    cluster = None
    if role == 'Cluster Manager':
        cluster = Cluster.query.filter_by(manager_id=current_user.id).first()
        if not cluster:
            flash('You are not assigned to any cluster yet.', category='error')
            return redirect(url_for('views.home'))
    else:
        cluster_id = request.args.get('cluster_id', type=int)
        if not cluster_id:
            flash('Please choose a cluster to view Invensync.', category='error')
            return redirect(url_for('admin.clusters'))
        cluster = Cluster.query.get_or_404(cluster_id)

    # Get selected date (default to today)
    selected_date_str = request.args.get('date', '')
    if selected_date_str:
        try:
            selected_date = datetime.strptime(selected_date_str, '%Y-%m-%d').date()
        except ValueError:
            selected_date = _date.today()
    else:
        selected_date = _date.today()

    # Get stores in this cluster only
    stores = Store.query.filter_by(cluster_id=cluster.id).order_by(Store.name.asc()).all()
    store_ids = [s.id for s in stores]

    # Get inventory data for selected date from cluster stores
    inventory_records = DailyEndingInventory.query.filter(
        DailyEndingInventory.inventory_date == selected_date,
        DailyEndingInventory.store_id.in_(store_ids)
    ).all() if store_ids else []

    inventory_by_store = {i.store_id: i for i in inventory_records}

    store_summaries = []
    for store in stores:
        inventory = inventory_by_store.get(store.id)
        store_summaries.append({
            'store': store,
            'inventory': inventory,
            'has_data': bool(inventory)
        })

    cluster_sidebar_stores = _build_cluster_sidebar_stores(stores)

    return render_template(
        'cluster_manager/invensync.html',
        user=current_user,
        cluster=cluster,
        team_name=_get_team_name(cluster),
        stores=stores,
        store_summaries=store_summaries,
        selected_date=selected_date.strftime('%Y-%m-%d'),
        today=_date.today().strftime('%Y-%m-%d'),
        cluster_sidebar_stores=cluster_sidebar_stores,
        force_cluster_sidebar=(role in ('Admin', 'Superadmin')),
        cluster_sidebar_cluster_id=cluster.id if role in ('Admin', 'Superadmin') else '',
    )


@views.route('/cluster-manager/oracle/save-buffers', methods=['POST'])
@login_required
def cluster_manager_save_store_buffers():
    from .models import Cluster, Store, ProductMaster, StoreProductBuffer
    role = (current_user.role or '').strip()
    if role not in ('Cluster Manager', 'Admin', 'Superadmin'):
        return {'ok': False, 'error': 'Access denied'}, 403

    data = request.get_json(force=True)
    store_id = data.get('store_id')
    buffers = data.get('buffers', {})  # {product_id: buffer_pct}

    if not store_id:
        return {'ok': False, 'error': 'Missing store_id'}, 400

    # Verify store belongs to manager's cluster
    store = Store.query.get(store_id)
    if not store:
        return {'ok': False, 'error': 'Store not found'}, 404
    if role == 'Cluster Manager':
        cluster = Cluster.query.filter_by(manager_id=current_user.id).first()
        if not cluster or store.cluster_id != cluster.id:
            return {'ok': False, 'error': 'Access denied'}, 403

    for product_id_str, pct in buffers.items():
        product_id = int(product_id_str)
        pct = max(0.0, min(200.0, float(pct)))
        rec = StoreProductBuffer.query.filter_by(store_id=store_id, product_id=product_id).first()
        if rec:
            rec.buffer_pct = pct
            rec.updated_by = current_user.id
        else:
            db.session.add(StoreProductBuffer(store_id=store_id, product_id=product_id,
                                              buffer_pct=pct, updated_by=current_user.id))
    db.session.commit()
    return {'ok': True}


@views.route('/cluster-manager/cluster-sbase')
@login_required
def cluster_manager_cluster_sbase():
    role = (current_user.role or '').strip()
    if role not in ('Cluster Manager', 'Admin', 'Superadmin'):
        flash('Access denied. Only Cluster Managers and Admins can access this page.', category='error')
        return redirect(url_for('views.home'))

    from .models import Cluster
    cluster = None

    if role == 'Cluster Manager':
        # Cluster managers can only open their assigned cluster.
        cluster = Cluster.query.filter_by(manager_id=current_user.id).first()
        if not cluster:
            flash('You are not assigned to any cluster yet.', category='error')
            return redirect(url_for('views.home'))
    else:
        # Admin/Superadmin can open any cluster via query param.
        cluster_id = request.args.get('cluster_id', type=int)
        if not cluster_id:
            flash('Please choose a cluster to view data.', category='error')
            return redirect(url_for('admin.clusters'))
        cluster = Cluster.query.get_or_404(cluster_id)

    # Get only stores in this cluster that are already one year.
    stores = Store.query.filter_by(cluster_id=cluster.id, is_one_year_already=True).all()

    # Get current month and year (or from query params)
    today = date.today()
    current_month = request.args.get('month', today.strftime('%m'))
    current_year = request.args.get('year', str(today.year))
    store_filter = request.args.get('store_id', '')

    # Fetch daily reports for the selected month/year
    from calendar import monthrange

    # Get all one-year store IDs in this cluster
    cluster_store_ids = [s.id for s in stores]
    store_ids = list(cluster_store_ids)

    # Filter by specific store if selected
    if store_filter:
        try:
            selected_store_id = int(store_filter)
        except (TypeError, ValueError):
            flash('Invalid store selection.', category='error')
            return redirect(url_for('views.cluster_manager_cluster_sbase', cluster_id=cluster.id, month=current_month, year=current_year))
        if selected_store_id in cluster_store_ids:
            store_ids = [selected_store_id]
        else:
            flash('Selected store does not belong to CL Sbase scope.', category='error')
            return redirect(url_for('views.cluster_manager_cluster_sbase', cluster_id=cluster.id, month=current_month, year=current_year))

    # Build date range for the month
    year_int = int(current_year)
    month_int = int(current_month)
    _, num_days = monthrange(year_int, month_int)

    # Fetch all reports for this month
    from datetime import datetime
    start_date = datetime(year_int, month_int, 1).date()
    end_date = datetime(year_int, month_int, num_days).date()

    # Only fetch approved reports
    reports = DailyReport.query.filter(
        DailyReport.store_id.in_(store_ids),
        DailyReport.report_date >= start_date,
        DailyReport.report_date <= end_date,
        DailyReport.status == 'Approved'
    ).all()
    _coalesce_numeric_fields_for_reports(reports)
    _apply_pos_qty_from_pos_categories(reports)

    # Fetch store targets for the selected month
    from .models import StoreTarget
    targets = StoreTarget.query.filter(
        StoreTarget.store_id.in_(store_ids),
        StoreTarget.target_date >= start_date,
        StoreTarget.target_date <= end_date
    ).all()

    # Organize and aggregate targets by date for cluster-level view
    targets_by_date = {}
    for target in targets:
        date_key = target.target_date.strftime('%Y-%m-%d')
        if date_key not in targets_by_date:
            targets_by_date[date_key] = {
                'target_net': target.target_net,
                'last_year_net': target.last_year_net,
                'gbi_target': target.gbi_target
            }
        else:
            targets_by_date[date_key]['target_net'] += target.target_net
            targets_by_date[date_key]['last_year_net'] += target.last_year_net
            targets_by_date[date_key]['gbi_target'] += target.gbi_target

    daily_targets = _aggregate_targets_by_day(targets)
    acc_daily_targets = _build_acc_targets_by_day(year_int, month_int, daily_targets)
    acc_daily_sales = _build_acc_sales_by_day(year_int, month_int, reports)
    mtd_metrics_by_day = _build_mtd_metrics_by_day(year_int, month_int, acc_daily_sales, acc_daily_targets)
    _attach_report_calc_fields(
        reports,
        daily_targets,
        acc_targets_by_day=acc_daily_targets,
        acc_sales_by_day=acc_daily_sales
    )
    summary = _build_cluster_manager_summary(reports, targets)

    # Calculate statistics
    total_reports = DailyReport.query.filter(
        DailyReport.store_id.in_(store_ids),
        DailyReport.report_date >= start_date,
        DailyReport.report_date <= end_date
    ).count()
    approved_reports_count = len(reports)

    # Organize reports by date
    reports_by_date = _group_reports_by_date(reports)

    cluster_sidebar_stores = _build_cluster_sidebar_stores(stores, start_date, end_date)

    return render_template(
        'cluster_manager/cluster_sbase.html',
        user=current_user,
        cluster=cluster,
        team_name=_get_team_name(cluster),
        stores=stores,
        force_cluster_sidebar=(role in ('Admin', 'Superadmin')),
        cluster_sidebar_cluster_id=cluster.id if role in ('Admin', 'Superadmin') else '',
        cluster_sidebar_stores=cluster_sidebar_stores,
        current_month=current_month,
        current_year=current_year,
        store_filter=store_filter,
        reports_by_date=reports_by_date,
        targets_by_date=targets_by_date,
        daily_targets=daily_targets,
        acc_daily_targets=acc_daily_targets,
        acc_daily_sales=acc_daily_sales,
        mtd_metrics_by_day=mtd_metrics_by_day,
        total_reports=total_reports,
        approved_reports_count=approved_reports_count,
        summary=summary,
        today_day=today.day,
        today_month=today.month,
        today_year=today.year
    )


@views.route('/cluster-manager/raw-data/update', methods=['POST'])
@login_required
def update_report_value():
    """API endpoint to update a report value"""
    if current_user.role != 'Cluster Manager':
        return jsonify({'success': False, 'error': 'Access denied'}), 403
    
    try:
        data = request.get_json()
        report_id = data.get('report_id')
        field_name = data.get('field_name')
        new_value = data.get('value')
        
        if not report_id or not field_name or new_value is None:
            return jsonify({'success': False, 'error': 'Missing required fields'}), 400
        
        # Get the report
        report = DailyReport.query.get(report_id)
        if not report:
            return jsonify({'success': False, 'error': 'Report not found'}), 404
        
        # Allow edits for pending and approved reports in cluster manager edit mode flows.
        if report.status not in ('Pending', 'Approved'):
            return jsonify({'success': False, 'error': 'Only pending or approved reports can be edited'}), 400
        
        # Update the field based on field name
        # Check if field is numeric (sales fields)
        numeric_fields = [
            'pos_gross_sales', 'pos_net_sales', 'ci_regular_gross_sales', 
            'ci_regular_net_sales',
            'boothselling_sales', 'bulk_order_sales', 'reseller_sales', 
            'tieup_sales', 'gow_sales', 'ambulant_sales', 'extended_hours_sales',
            'gds_sales', 'grab_sales', 'foodpanda_sales', 'paymaya_sales', 
            'gcash_sales', 'ci_sales_discount', 'total_net_spoilage',
            'spoilage_percentage', 'mtd_percentage', 'spoilage_gc',
            'spoilage_rolls', 'spoilage_premium', 'spoilage_others',
            'senior_pwd_discount', 'promo_ldts_discount', 'bulk_orders_discount',
            'total_discount', 'discount_percentage'
        ]
        
        tc_fields = [
            'pos_tc', 'ci_tc', 'boothselling_tc', 'bulk_order_tc',
            'reseller_tc', 'tieup_tc', 'gow_tc', 'ambulant_tc', 'extended_hours_tc',
            'gds_tc', 'grab_tc', 'foodpanda_tc', 'paymaya_tc', 'gcash_tc',
            'ldts_gc', 'ldts_rolls', 'ldts_premium'
        ]
        
        int_fields = [
            'ending_inv_gc', 'ending_inv_rolls', 'ending_inv_premium',
        ]
        
        # Determine field type and convert value
        if field_name in numeric_fields:
            try:
                new_value = float(new_value) if new_value else 0.0
            except ValueError:
                return jsonify({'success': False, 'error': f'{field_name} must be a number'}), 400
        elif field_name in tc_fields or field_name in int_fields:
            try:
                new_value = int(new_value) if new_value else 0
            except ValueError:
                return jsonify({'success': False, 'error': f'{field_name} must be an integer'}), 400
        
        # Set the attribute
        if hasattr(report, field_name):
            previous_value = getattr(report, field_name)
            setattr(report, field_name, new_value)
            log_audit_event(
                action='report.update_field',
                entity_type='DailyReport',
                entity_id=report.id,
                reason='Cluster manager updated a pending report field.',
                details={
                    'field_name': field_name,
                    'previous_value': previous_value,
                    'new_value': new_value,
                    'report_status': report.status,
                },
            )
            
            db.session.commit()
            return jsonify({'success': True, 'message': 'Value updated successfully'})
        else:
            return jsonify({'success': False, 'error': f'Field {field_name} not found'}), 400
            
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500


@views.route('/cluster-manager/raw-data/approve', methods=['POST'])
@login_required
def approve_report():
    """API endpoint to approve a report"""
    if current_user.role != 'Cluster Manager':
        return jsonify({'success': False, 'error': 'Access denied'}), 403
    
    try:
        data = request.get_json()
        report_id = data.get('report_id')
        
        if not report_id:
            return jsonify({'success': False, 'error': 'Missing report_id'}), 400
        
        # Get the report
        report = DailyReport.query.get(report_id)
        if not report:
            return jsonify({'success': False, 'error': 'Report not found'}), 404
        
        # Update status to Approved
        previous_status = report.status
        report.status = 'Approved'
        log_audit_event(
            action='report.approve',
            entity_type='DailyReport',
            entity_id=report.id,
            reason='Cluster manager approved report.',
            details={
                'previous_status': previous_status,
                'new_status': report.status,
            },
        )
        db.session.commit()
        
        return jsonify({'success': True, 'message': 'Report approved successfully'})
        
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500


# ============================================================================
# RETIRED DAILY FORECASTING ROUTES
# ============================================================================

@views.route('/store-manager/daily-forecasting')
@login_required
def daily_forecasting():
    """Redirect to combined view"""
    date_param = request.args.get('date', '')
    if date_param:
        return redirect(url_for('views.invensync', date=date_param))
    return redirect(url_for('views.invensync'))


@views.route('/store-manager/daily-forecasting/save', methods=['POST'])
@login_required
def save_daily_forecasting():
    """Forecasting has been retired from InvenSync."""
    return jsonify({'success': False, 'error': 'Forecasting has been disabled'}), 410


@views.route('/store-manager/daily-forecasting/calculate', methods=['POST'])
@login_required
def calculate_forecasting():
    """Forecasting has been retired from InvenSync."""
    return jsonify({'success': False, 'error': 'Forecasting has been disabled'}), 410


# ============================================================================
# DAILY ENDING INVENTORY ROUTES
# ============================================================================

@views.route('/store-manager/daily-ending-inventory')
@login_required
def daily_ending_inventory():
    """Redirect to combined view"""
    date_param = request.args.get('date', '')
    if date_param:
        return redirect(url_for('views.invensync', date=date_param))
    return redirect(url_for('views.invensync'))


@views.route('/store-manager/daily-ending-inventory/save', methods=['POST'])
@login_required
def save_daily_ending_inventory():
    """Save daily ending inventory data"""
    try:
        data = request.get_json()
        inventory_id = data.get('inventory_id')
        items_data = data.get('items', [])
        finalize_day = bool(data.get('finalize_day'))
        finalize_beginning = bool(data.get('finalize_beginning'))
        
        inventory = DailyEndingInventory.query.get(inventory_id)
        if not inventory:
            return jsonify({'success': False, 'error': 'Inventory not found'}), 404
        if inventory.is_finalized:
            return jsonify({
                'success': False,
                'error': 'This inventory day is already finalized and can no longer be edited.'
            }), 423
        store_beginning_baseline = DailyEndingInventory.query.filter(
            DailyEndingInventory.store_id == inventory.store_id,
            DailyEndingInventory.is_beginning_finalized.is_(True),
        ).first()
        if finalize_beginning and store_beginning_baseline and store_beginning_baseline.id != inventory.id:
            return jsonify({
                'success': False,
                'error': 'Beginning inventory has already been saved for this store.'
            }), 409
        if finalize_beginning and inventory.is_beginning_finalized:
            return jsonify({
                'success': False,
                'error': 'Beginning inventory has already been saved for this store.'
            }), 409

        is_first_inventory_baseline = DailyEndingInventory.query.filter(
            DailyEndingInventory.store_id == inventory.store_id,
            DailyEndingInventory.inventory_date < inventory.inventory_date,
        ).first() is None
        has_beginning_payload = any('beginning_qty' in item_data for item_data in items_data)
        _, global_config_data = _get_or_create_global_invensync_config()
        beginning_qty_is_locked = 'beginning_qty' in global_config_data.get('locked_columns', [])
        allow_beginning_qty_update = (
            (not inventory.is_beginning_finalized)
            and (not store_beginning_baseline)
            and ((not beginning_qty_is_locked) or is_first_inventory_baseline or finalize_beginning)
        )
        
        # Update items
        for item_data in items_data:
            item_id = item_data.get('item_id')
            item = DailyEndingInventoryItem.query.get(item_id)
            if item:
                if allow_beginning_qty_update and 'beginning_qty' in item_data:
                    item.beginning_qty = int(item_data.get('beginning_qty', 0))
                item.delivery_qty = int(item_data.get('delivery_qty', 0))
                item.trans_in_qty = int(item_data.get('trans_in_qty', 0))
                item.bo_qty = int(item_data.get('bo_qty', 0))
                item.adv_del_qty = int(item_data.get('adv_del_qty', 0))
                item.trans_out_qty = int(item_data.get('trans_out_qty', 0))
                item.wastage_qty = int(item_data.get('wastage_qty', 0))
                item.csi_qty = int(item_data.get('csi_qty', 0))
                item.quantity_sold = int(item_data.get('quantity_sold', 0))
                item.ending_d5_qty = int(item_data.get('ending_d5_qty', 0))
                item.ending_d4_qty = int(item_data.get('ending_d4_qty', 0))
                item.ending_d3_qty = int(item_data.get('ending_d3_qty', 0))
                item.remarks = item_data.get('remarks', '')
                
                # Recalculate derived fields
                _recalculate_inventory_item(item)

        if is_first_inventory_baseline and has_beginning_payload:
            _lock_global_invensync_column('beginning_qty')

        if finalize_beginning:
            inventory.is_beginning_finalized = True
            inventory.beginning_finalized_at = datetime.now()
            inventory.beginning_finalized_by = current_user.id

        if finalize_day:
            inventory.is_finalized = True
            inventory.finalized_at = datetime.now()
            inventory.finalized_by = current_user.id
        
        db.session.commit()
        
        log_audit_event(
            action='inventory.save',
            entity_type='DailyEndingInventory',
            entity_id=inventory.id,
            details={
                'inventory_date': inventory.inventory_date.isoformat(),
                'finalize_day': finalize_day,
                'finalize_beginning': finalize_beginning,
            }
        )
        
        return jsonify({
            'success': True,
            'message': 'Inventory saved successfully'
        })
        
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500


def _normalize_product_name(name):
    """Normalize product name for comparison: lowercase, strip, collapse spaces."""
    if not name:
        return ''
    # Convert to lowercase, strip whitespace, collapse multiple spaces
    normalized = ' '.join(str(name).lower().strip().split())
    return normalized


def _match_rso_to_inventory(rso_item, product):
    """
    Match RSO delivery item to inventory product.
    Priority: Product Code > Full Product Name (exact normalized match)
    
    Rules:
    - Do NOT use partial/substring matching
    - Only accept exact full name matches after normalization
    - Case-insensitive, trim spaces, normalize formatting
    """
    # Normalize both names
    rso_name_normalized = _normalize_product_name(rso_item.product_name)
    product_desc_normalized = _normalize_product_name(product.description)
    product_code_str = str(product.code or '').strip()
    
    # Try matching by product code if RSO item has a code embedded in product_name
    # Some Excel files might have format: "CODE - Product Name" or "CODE Product Name"
    rso_name_upper = str(rso_item.product_name).strip()
    
    # Check if RSO product_name starts with a number (potential product code)
    code_match = re.match(r'^(\d+)\s*[-–—]?\s*(.+)$', rso_name_upper)
    if code_match:
        rso_code_from_name = code_match.group(1).strip()
        if rso_code_from_name == product_code_str:
            return True
    
    # Primary matching: Exact normalized product name comparison
    if rso_name_normalized and product_desc_normalized:
        if rso_name_normalized == product_desc_normalized:
            return True
    
    # Secondary matching: If product code in RSO matches product.code exactly
    # (for cases where RSO product_name IS the product code)
    if rso_name_normalized == product_code_str.lower():
        return True
    
    return False


@views.route('/store-manager/invensync')
@login_required
def invensync():
    """Daily ending inventory view"""
    if current_user.role not in ['Store Manager', 'Inventory Staff', 'Cluster Manager', 'Admin', 'Superadmin']:
        flash('Access denied.', category='error')
        return redirect(url_for('views.home'))

    # Inventory Staff behavior:
    # - Without store_id: redirect to dashboard (all stores view)
    # - With store_id: allow viewing specific store details (read-only)
    if current_user.role == 'Inventory Staff':
        store_id = request.args.get('store_id', type=int)
        if not store_id:
            # No store_id provided, redirect to dashboard
            return redirect(url_for('views.invensync_inventory_staff'))
        # store_id provided, allow viewing details (will be handled below)

    # Get store for current user
    role = (current_user.role or '').strip()
    if role == 'Store Manager':
        store = Store.query.filter_by(manager_id=current_user.id).first()
    elif role == 'Inventory Staff':
        # Inventory Staff viewing specific store details
        store_id = request.args.get('store_id', type=int)
        store = Store.query.get(store_id) if store_id else None
    elif role == 'Cluster Manager':
        # Cluster Manager viewing store details — must belong to their cluster
        store_id = request.args.get('store_id', type=int)
        if not store_id:
            return redirect(url_for('views.cluster_manager_invensync'))
        from .models import Cluster
        cluster = Cluster.query.filter_by(manager_id=current_user.id).first()
        store = Store.query.get(store_id) if store_id else None
        if store and cluster and store.cluster_id != cluster.id:
            flash('Access denied. Store does not belong to your cluster.', category='error')
            return redirect(url_for('views.cluster_manager_invensync'))
    else:
        # Admin/Superadmin accessing store details via store_id parameter
        store_id = request.args.get('store_id', type=int)
        if not store_id:
            # Redirect admins to admin dashboard if no store_id provided
            return redirect(url_for('admin.dashboard'))
        store = Store.query.get(store_id) if store_id else None

    if not store:
        flash('Store not found or not assigned.', category='error')
        return redirect(url_for('views.home'))

    # Get selected date (default to today)
    selected_date_str = request.args.get('date', '')
    if selected_date_str:
        try:
            selected_date = datetime.strptime(selected_date_str, '%Y-%m-%d').date()
        except ValueError:
            selected_date = date.today()
    else:
        selected_date = date.today()

    # Get or create inventory record
    inventory = DailyEndingInventory.query.filter_by(
        store_id=store.id,
        inventory_date=selected_date
    ).first()

    if not inventory:
        inventory = DailyEndingInventory(
            store_id=store.id,
            inventory_date=selected_date,
            created_by=current_user.id
        )
        db.session.add(inventory)
        db.session.commit()

    # Get all products
    products = ProductMaster.query.all()

    # Define category order
    category_order = {
        'BREADS': 1,
        'TRAY PRODUCTS': 2,
        'ROLLS': 3,
        'GREETING CAKES': 4,
        'PREMIUM': 5,
        'CREMA DE FRUTA': 6,
        'GM PRODUCTS': 7,
        'CANDLES': 8,
        'ADD-ONS': 9
    }

    products.sort(key=lambda p: (category_order.get(p.category, 99), p.id))

    # Get or create inventory items
    inventory_items = {}
    for product in products:
        item = DailyEndingInventoryItem.query.filter_by(
            inventory_id=inventory.id,
            product_master_id=product.id
        ).first()

        if not item:
            prev_date = selected_date - timedelta(days=1)
            prev_inventory = DailyEndingInventory.query.filter_by(
                store_id=store.id,
                inventory_date=prev_date
            ).first()

            beginning_qty = 0
            if prev_inventory:
                prev_item = DailyEndingInventoryItem.query.filter_by(
                    inventory_id=prev_inventory.id,
                    product_master_id=product.id
                ).first()
                if prev_item:
                    beginning_qty = prev_item.total_ending_qty

            srp = product.sp_p if store.store_group == 'premium' else product.sp_np

            item = DailyEndingInventoryItem(
                inventory_id=inventory.id,
                product_master_id=product.id,
                product_code=str(product.code) if product.code else '',
                product_description=product.description,
                srp_price=srp or 0,
                beginning_qty=beginning_qty
            )
            db.session.add(item)

        inventory_items[product.id] = item

    db.session.commit()

    # Sync RSO delivery data to inventory items with improved matching
    rso_deliveries = []
    if not inventory.is_finalized:
        rso_deliveries = RsoDelivery.query.filter_by(
            store_id=store.id,
            report_date=selected_date
        ).filter(RsoDelivery.delivery_reviewed_date.isnot(None)).all()
    
    if rso_deliveries:
        # Track which RSO items have been matched to avoid duplicates
        matched_rso_ids = set()
        
        for inv_item in inventory_items.values():
            if inv_item.product_master_id:
                product = ProductMaster.query.get(inv_item.product_master_id)
                if product:
                    # Try to match with unmatched RSO items
                    for rso_item in rso_deliveries:
                        if rso_item.id in matched_rso_ids:
                            continue
                        
                        if _match_rso_to_inventory(rso_item, product):
                            delivery_qty = (
                                rso_item.received_quantity
                                if rso_item.received_quantity is not None
                                else rso_item.quantity
                            )
                            if inv_item.delivery_qty == 0 or inv_item.delivery_qty == rso_item.quantity:
                                inv_item.delivery_qty = delivery_qty
                                inv_item.delivery_reviewed_date = rso_item.delivery_reviewed_date
                                matched_rso_ids.add(rso_item.id)
                            break

    taf_trans_out_map = {} if inventory.is_finalized else _build_taf_trans_out_quantity_by_master_id(store, selected_date)
    if taf_trans_out_map:
        for inv_item in inventory_items.values():
            if not inv_item.product_master_id:
                continue

            taf_trans_out_qty = int(taf_trans_out_map.get(inv_item.product_master_id, 0) or 0)
            if taf_trans_out_qty <= 0:
                continue

            current_trans_out_qty = int(inv_item.trans_out_qty or 0)
            if current_trans_out_qty == 0 or current_trans_out_qty < taf_trans_out_qty:
                inv_item.trans_out_qty = taf_trans_out_qty

    taf_trans_in_map = {} if inventory.is_finalized else _build_taf_trans_in_quantity_by_master_id(store, selected_date)
    if taf_trans_in_map:
        for inv_item in inventory_items.values():
            if not inv_item.product_master_id:
                continue

            taf_trans_in_qty = int(taf_trans_in_map.get(inv_item.product_master_id, 0) or 0)
            if taf_trans_in_qty <= 0:
                continue

            inv_item.trans_in_qty = taf_trans_in_qty

    saved_sales_map = {}
    if not inventory.is_finalized:
        # Recalculate inventory totals
        for item in inventory_items.values():
            _recalculate_inventory_item(item)
        saved_sales_map = _build_pos_sold_quantity_by_master_id_for_report(
            DailyReport.query.filter_by(store_id=store.id, report_date=selected_date).with_entities(DailyReport.id).scalar()
        )
    if saved_sales_map:
        for inv_item in inventory_items.values():
            if inv_item.product_master_id and not inv_item.quantity_sold and inv_item.product_master_id in saved_sales_map:
                inv_item.quantity_sold = saved_sales_map[inv_item.product_master_id]
                inv_item.pos_reviewed_source = 'saved'
                inv_item.pos_reviewed_date = selected_date
                _recalculate_inventory_item(inv_item)

    db.session.commit()

    draft_sales_map = {}
    if current_user.role == 'Store Manager' and not inventory.is_finalized:
        draft_sales_map = _build_pos_sold_draft_quantity_by_master_id(store.id, selected_date)

    if draft_sales_map:
        for inv_item in inventory_items.values():
            if inv_item.product_master_id and inv_item.product_master_id in draft_sales_map:
                inv_item.draft_quantity_sold = draft_sales_map[inv_item.product_master_id]
                inv_item.pos_reviewed_source = 'draft'
                inv_item.pos_reviewed_date = selected_date
                _recalculate_inventory_item(inv_item, sold_override=inv_item.draft_quantity_sold)

    _, global_config_data = _get_or_create_global_invensync_config()
    store_beginning_baseline_finalized = DailyEndingInventory.query.filter(
        DailyEndingInventory.store_id == store.id,
        DailyEndingInventory.is_beginning_finalized.is_(True),
    ).first() is not None
    # Detect first-time setup: no previous inventory baseline and no current beginning stock.
    has_any_beginning = any(
        item.beginning_qty and item.beginning_qty > 0
        for item in inventory_items.values()
    )
    prev_inventory_exists = DailyEndingInventory.query.filter(
        DailyEndingInventory.store_id == store.id,
        DailyEndingInventory.inventory_date < selected_date
    ).first() is not None
    is_first_time = (not store_beginning_baseline_finalized) and not has_any_beginning and not prev_inventory_exists
    allow_beginning_stock_entry = is_first_time and current_user.role != 'Inventory Staff'

    # Build cluster sidebar context for Cluster Manager
    cluster_sidebar_ctx = {}
    if role == 'Cluster Manager':
        from .models import Cluster
        cm_cluster = Cluster.query.filter_by(manager_id=current_user.id).first()
        if cm_cluster:
            cm_stores = Store.query.filter_by(cluster_id=cm_cluster.id).all()
            cluster_sidebar_ctx = {
                'cluster': cm_cluster,
                'team_name': _get_team_name(cm_cluster),
                'cluster_sidebar_stores': _build_cluster_sidebar_stores(cm_stores),
            }

    return render_template(
        'store_manager/invensync.html',
        user=current_user,
        store=store,
        inventory=inventory,
        products=products,
        inventory_items=inventory_items,
        selected_date=selected_date.strftime('%Y-%m-%d'),
        today=date.today().strftime('%Y-%m-%d'),
        global_config_data=global_config_data,
        is_first_time=is_first_time,
        allow_beginning_stock_entry=allow_beginning_stock_entry,
        store_beginning_baseline_finalized=store_beginning_baseline_finalized,
        **cluster_sidebar_ctx,
    )


def _fetch_oracle_invensync_data(store, products, oracle_date=None):
    """Fetch invensync data for the Oracle order form.
    Returns (invensync_data dict keyed by str(product_id), prev_inventory_date_str or None).
    - Ending Inventory: previous day's total_ending_qty from InvenSync (no theo fallback)
    - Delivery / Trans-In / Trans-Out: oracle_date's record
    Handles nullable product_master_id with product_description fallback.
    """
    from datetime import date as _date, timedelta
    ref_date = oracle_date or _date.today()
    prev_day = ref_date - timedelta(days=1)

    # Previous day's inventory record (exact previous day)
    prev_inventory = (
        DailyEndingInventory.query
        .filter_by(store_id=store.id, inventory_date=prev_day)
        .first()
    )

    # Oracle date's inventory record (delivery, trans-in, trans-out)
    today_inventory = (
        DailyEndingInventory.query
        .filter_by(store_id=store.id, inventory_date=ref_date)
        .first()
    )

    # Build product lookup by description (lowercase) for fallback
    prod_by_desc = {}
    for p in products:
        prod_by_desc[(p.description or '').strip().lower()] = p.id

    # Previous day ending: product_id -> total_ending_qty
    # Uses total_ending_qty directly from InvenSync (no theo_ending_qty fallback)
    # If no previous day record exists, falls back to oracle date's beginning_qty
    # (beginning_qty = last known ending inventory carried forward)
    prev_ending = {}
    if prev_inventory:
        for item in prev_inventory.items:
            pid = item.product_master_id
            if pid is None:
                pid = prod_by_desc.get((item.product_description or '').strip().lower())
            if pid is not None:
                ending = (item.total_ending_qty or 0)
                prev_ending[pid] = prev_ending.get(pid, 0) + ending
    elif today_inventory:
        # No previous day record — use oracle date's beginning_qty as ending stock
        for item in today_inventory.items:
            pid = item.product_master_id
            if pid is None:
                pid = prod_by_desc.get((item.product_description or '').strip().lower())
            if pid is not None:
                prev_ending[pid] = prev_ending.get(pid, 0) + (item.beginning_qty or 0)

    # Oracle date: product_id -> delivery, trans_in, trans_out
    today_delivery = {}
    today_trans_in = {}
    today_trans_out = {}
    if today_inventory:
        for item in today_inventory.items:
            pid = item.product_master_id
            if pid is None:
                pid = prod_by_desc.get((item.product_description or '').strip().lower())
            if pid is not None:
                today_delivery[pid] = today_delivery.get(pid, 0) + (item.delivery_qty or 0)
                today_trans_in[pid] = today_trans_in.get(pid, 0) + (item.trans_in_qty or 0)
                today_trans_out[pid] = today_trans_out.get(pid, 0) + (item.trans_out_qty or 0)

    # Build invensync_data keyed by string product id (for JSON serialization)
    invensync_data = {}
    for p in products:
        invensync_data[str(p.id)] = {
            'ending_stock': prev_ending.get(p.id, 0),
            'delivery': today_delivery.get(p.id, 0),
            'trans_in': today_trans_in.get(p.id, 0),
            'trans_out': today_trans_out.get(p.id, 0),
        }

    if prev_inventory:
        prev_date_str = prev_inventory.inventory_date.isoformat()
    elif today_inventory and prev_ending:
        prev_date_str = prev_day.isoformat()  # beginning_qty carried forward from prev day
    else:
        prev_date_str = prev_day.isoformat() if today_inventory else None
    return invensync_data, prev_date_str


def _inventory_has_oracle_values(inventory):
    if not inventory:
        return False

    return any(
        (item.total_ending_qty or 0)
        or (item.delivery_qty or 0)
        or (item.trans_in_qty or 0)
        or (item.trans_out_qty or 0)
        for item in inventory.items
    )


def _resolve_oracle_invensync_inventory(store, selected_date=None):
    if selected_date:
        return DailyEndingInventory.query.filter_by(
            store_id=store.id,
            inventory_date=selected_date,
        ).first()

    inventories = (
        DailyEndingInventory.query
        .filter(DailyEndingInventory.store_id == store.id)
        .order_by(DailyEndingInventory.inventory_date.desc())
        .all()
    )
    for inventory in inventories:
        if _inventory_has_oracle_values(inventory):
            return inventory
    return inventories[0] if inventories else None


def _fetch_oracle_invensync_data_for_order_form(store, products, selected_date=None):
    source_inventory = _resolve_oracle_invensync_inventory(store, selected_date)

    prod_by_desc = {
        (product.description or '').strip().lower(): product.id
        for product in products
    }

    total_ending = {}
    delivery = {}
    trans_in = {}
    trans_out = {}
    if source_inventory:
        for item in source_inventory.items:
            product_id = item.product_master_id
            if product_id is None:
                product_id = prod_by_desc.get((item.product_description or '').strip().lower())
            if product_id is None:
                continue

            total_ending[product_id] = total_ending.get(product_id, 0) + (item.total_ending_qty or 0)
            delivery[product_id] = delivery.get(product_id, 0) + (item.delivery_qty or 0)
            trans_in[product_id] = trans_in.get(product_id, 0) + (item.trans_in_qty or 0)
            trans_out[product_id] = trans_out.get(product_id, 0) + (item.trans_out_qty or 0)

    invensync_data = {}
    for product in products:
        invensync_data[str(product.id)] = {
            'ending_stock': total_ending.get(product.id, 0),
            'delivery': delivery.get(product.id, 0),
            'trans_in': trans_in.get(product.id, 0),
            'trans_out': trans_out.get(product.id, 0),
        }

    source_date = source_inventory.inventory_date.isoformat() if source_inventory else None
    return invensync_data, source_date


def _build_oracle_pos_sales_data(store, products, anchor_date=None):
    if not store or not products:
        return {}

    anchor_date = anchor_date or date.today()
    start_date = anchor_date - timedelta(days=27)
    week_ranges = []
    for week_index in range(4):
        week_start = start_date + timedelta(days=(week_index * 7))
        week_ranges.append((week_start, week_start + timedelta(days=6)))

    end_date = week_ranges[-1][1]
    product_ids = {int(product.id) for product in products}
    sales_data = {
        str(product.id): [[0 for _ in range(7)] for _ in range(4)]
        for product in products
    }

    pos_rows = (
        db.session.query(
            DailyReport.report_date,
            PosSold.product_name,
            func.sum(PosSold.quantity).label('total_qty'),
        )
        .join(DailyReport, DailyReport.id == PosSold.daily_report_id)
        .filter(DailyReport.store_id == store.id)
        .filter(DailyReport.report_date >= start_date)
        .filter(DailyReport.report_date <= end_date)
        .group_by(DailyReport.report_date, PosSold.product_name)
        .all()
    )
    if not pos_rows:
        return sales_data

    alias_lookup, master_lookup = _build_pos_sold_master_lookups()
    for report_date, product_name, total_qty in pos_rows:
        master_id = _resolve_pos_sold_master_id(product_name, alias_lookup, master_lookup)
        if master_id not in product_ids:
            continue

        quantity = int(total_qty or 0)
        if quantity <= 0:
            continue

        week_index = None
        for index, (week_start, week_end) in enumerate(week_ranges):
            if week_start <= report_date <= week_end:
                week_index = index
                break
        if week_index is None:
            continue

        js_day_index = (report_date.weekday() + 1) % 7
        sales_data[str(master_id)][week_index][js_day_index] += quantity

    return sales_data


@views.route('/store-manager/oracle')
@login_required
def oracle():
    """Store Manager Oracle page placeholder."""
    if current_user.role != 'Store Manager':
        flash('Access denied.', category='error')
        return redirect(url_for('views.home'))

    store = Store.query.filter_by(manager_id=current_user.id).first()
    if not store:
        flash('Store not found or not assigned.', category='error')
        return redirect(url_for('views.home'))

    from .models import ProductMaster, StoreProductBuffer
    from datetime import date as _date
    products = ProductMaster.query.all()

    # Parse optional oracle date from query string
    oracle_date = None
    date_str = request.args.get('date', '')
    if date_str:
        try:
            oracle_date = datetime.strptime(date_str, '%Y-%m-%d').date()
        except ValueError:
            oracle_date = None
    if oracle_date is None:
        oracle_date = _date.today()

    # Load saved per-product buffers for this store (if any)
    saved = StoreProductBuffer.query.filter_by(store_id=store.id).all()
    store_buffers = {b.product_id: b.buffer_pct for b in saved}

<<<<<<< HEAD
    # Fetch invensync data (ending inventory from prev day, delivery/trans from oracle date)
    invensync_data, prev_inventory_date = _fetch_oracle_invensync_data(store, products, oracle_date=oracle_date)
=======
    selected_date = _parse_iso_date(request.args.get('date'))

    # Fetch invensync data (total ending inventory, delivery, trans-in/out)
    invensync_data, prev_inventory_date = _fetch_oracle_invensync_data_for_order_form(
        store,
        products,
        selected_date,
    )
    pos_sales_data = _build_oracle_pos_sales_data(store, products, selected_date)
>>>>>>> 5a07cb70806463843cc8652cf7341cd03b9df814

    return render_template(
        'store_manager/oracle.html',
        user=current_user,
        store=store,
        products=products,
        store_buffers=store_buffers,
        invensync_data=invensync_data,
        prev_inventory_date=prev_inventory_date,
<<<<<<< HEAD
        oracle_date=oracle_date.isoformat(),
=======
        pos_sales_data=pos_sales_data,
>>>>>>> 5a07cb70806463843cc8652cf7341cd03b9df814
    )


@views.route('/cluster-manager/store-order-form/<int:store_id>')
@login_required
def cluster_store_order_form(store_id):
    """Render the Store Manager Order Form for Cluster Managers (view-only except buffers).
    This allows cluster managers/admins to view a store's full order form and edit buffer %.
    """
    role = (current_user.role or '').strip()
    if role not in ('Cluster Manager', 'Admin', 'Superadmin'):
        flash('Access denied.', category='error')
        return redirect(url_for('views.home'))

    from .models import Store, ProductMaster, Cluster
    store = Store.query.get_or_404(store_id)

    # Restrict Cluster Manager to stores within their cluster
    if role == 'Cluster Manager':
        cluster = Cluster.query.filter_by(manager_id=current_user.id).first()
        if not cluster or store.cluster_id != cluster.id:
            flash('Access denied.', category='error')
            return redirect(url_for('views.home'))

    from .models import ProductMaster, StoreProductBuffer
    from datetime import date as _date
    products = ProductMaster.query.all()

    # Parse optional oracle date from query string
    oracle_date = None
    date_str = request.args.get('date', '')
    if date_str:
        try:
            oracle_date = datetime.strptime(date_str, '%Y-%m-%d').date()
        except ValueError:
            oracle_date = None
    if oracle_date is None:
        oracle_date = _date.today()

    # Provide existing saved buffers for this store so the embedded/order view
    # reflects the latest values edited by cluster managers.
    saved = StoreProductBuffer.query.filter_by(store_id=store.id).all()
    store_buffers = {b.product_id: b.buffer_pct for b in saved}

<<<<<<< HEAD
    # Fetch invensync data (ending inventory from prev day, delivery/trans from oracle date)
    invensync_data, prev_inventory_date = _fetch_oracle_invensync_data(store, products, oracle_date=oracle_date)
=======
    selected_date = _parse_iso_date(request.args.get('date'))

    # Fetch invensync data (total ending inventory, delivery, trans-in/out)
    invensync_data, prev_inventory_date = _fetch_oracle_invensync_data_for_order_form(
        store,
        products,
        selected_date,
    )
    pos_sales_data = _build_oracle_pos_sales_data(store, products, selected_date)
>>>>>>> 5a07cb70806463843cc8652cf7341cd03b9df814

    return render_template(
        'store_manager/oracle.html',
        user=current_user,
        store=store,
        products=products,
        cluster_view=True,
        store_buffers=store_buffers,
        invensync_data=invensync_data,
        prev_inventory_date=prev_inventory_date,
<<<<<<< HEAD
        oracle_date=oracle_date.isoformat(),
=======
        pos_sales_data=pos_sales_data,
>>>>>>> 5a07cb70806463843cc8652cf7341cd03b9df814
    )


@views.route('/store-manager/invensync-dashboard')
@login_required
def invensync_inventory_staff():
    """Inventory Staff dashboard - view all stores (read-only)"""
    if current_user.role != 'Inventory Staff':
        flash('Access denied.', category='error')
        return redirect(url_for('views.home'))

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

    return render_template(
        'store_manager/invensync_dashboard.html',
        user=current_user,
        stores=stores,
        store_summaries=store_summaries,
        selected_date=selected_date.strftime('%Y-%m-%d'),
        today=date.today().strftime('%Y-%m-%d')
    )


@views.route('/store-manager/invensync/sync', methods=['POST'])
@login_required
def sync_invensync_products():
    """Sync products from ProductMaster to daily ending inventory."""
    try:
        data = request.get_json()
        sync_date_str = data.get('date')
        
        if not sync_date_str:
            return jsonify({'success': False, 'error': 'Date required'}), 400
        
        # Get store for current user
        if current_user.role == 'Store Manager':
            store = Store.query.filter_by(manager_id=current_user.id).first()
        else:
            store_id = request.args.get('store_id', type=int)
            store = Store.query.get(store_id) if store_id else None
        
        if not store:
            return jsonify({'success': False, 'error': 'Store not found or not assigned'}), 404
        
        try:
            sync_date = datetime.strptime(sync_date_str, '%Y-%m-%d').date()
        except ValueError:
            return jsonify({'success': False, 'error': 'Invalid date format'}), 400
        
        # Get all products
        products = ProductMaster.query.all()
        
        if not products:
            return jsonify({'success': False, 'error': 'No products found in masterlist'}), 400
        
        # Get or create inventory record
        inventory = DailyEndingInventory.query.filter_by(
            store_id=store.id,
            inventory_date=sync_date
        ).first()
        
        if not inventory:
            inventory = DailyEndingInventory(
                store_id=store.id,
                inventory_date=sync_date,
                created_by=current_user.id
            )
            db.session.add(inventory)
            db.session.flush()
        
        synced_count = 0
        prev_date = sync_date - timedelta(days=1)
        
        for product in products:
            srp = product.sp_p if store.store_group == 'premium' else product.sp_np

            # Sync to Daily Ending Inventory
            inv_item = DailyEndingInventoryItem.query.filter_by(
                inventory_id=inventory.id,
                product_master_id=product.id
            ).first()
            
            # Get beginning qty from previous day's total ending
            beginning_qty = 0
            prev_inventory = DailyEndingInventory.query.filter_by(
                store_id=store.id,
                inventory_date=prev_date
            ).first()
            
            if prev_inventory:
                prev_inv_item = DailyEndingInventoryItem.query.filter_by(
                    inventory_id=prev_inventory.id,
                    product_master_id=product.id
                ).first()
                if prev_inv_item:
                    beginning_qty = prev_inv_item.total_ending_qty
            
            if not inv_item:
                inv_item = DailyEndingInventoryItem(
                    inventory_id=inventory.id,
                    product_master_id=product.id,
                    product_code=str(product.code) if product.code else '',
                    product_description=product.description,
                    srp_price=srp or 0,
                    beginning_qty=beginning_qty
                )
                db.session.add(inv_item)
            else:
                # Update with latest product data
                inv_item.product_code = str(product.code) if product.code else inv_item.product_code
                inv_item.product_description = product.description
                inv_item.srp_price = srp or 0
            
            synced_count += 1
        
        db.session.commit()
        
        # Log audit event
        try:
            log_audit_event(
                action='products.sync',
                entity_type='DailyEndingInventory',
                entity_id=inventory.id,
                reason='Synced products from ProductMaster to daily ending inventory',
                details={
                    'products_synced': synced_count,
                    'sync_date': sync_date_str,
                    'store_id': store.id,
                    'inventory_id': inventory.id
                }
            )
        except Exception as log_err:
            print(f"Audit log error: {log_err}")
        
        return jsonify({
            'success': True,
            'count': synced_count,
            'message': f'Successfully synced {synced_count} products'
        }), 200
        
    except Exception as e:
        db.session.rollback()
        print(f"Sync error: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500


def _recalculate_inventory_item(item, sold_override=None):
    """Recalculate all derived fields for an inventory item"""
    sold_qty = int(sold_override) if sold_override is not None else int(item.quantity_sold or 0)

    # Wastage amount
    item.wastage_amount = item.wastage_qty * item.srp_price
    
    # Total ending
    item.total_ending_qty = item.ending_d5_qty + item.ending_d4_qty + item.ending_d3_qty
    item.total_peso_srp = item.total_ending_qty * item.srp_price
    
    # THEO ending
    item.theo_ending_qty = (
        item.beginning_qty + 
        item.delivery_qty + 
        item.trans_in_qty + 
        item.bo_qty + 
        item.adv_del_qty - 
        item.trans_out_qty - 
        item.wastage_qty - 
        item.csi_qty - 
        sold_qty
    )
    
    # Variance
    item.variance_qty = item.total_ending_qty - item.theo_ending_qty
    item.variance_peso = item.variance_qty * item.srp_price
    

# ============================================================================
# PRODUCT MASTER SYNC ROUTES
# ============================================================================

@views.route('/store-manager/sync-products', methods=['POST'])
@login_required
def sync_products_from_master():
    """Sync products from ProductMaster to inventory items."""
    try:
        data = request.get_json()
        store_id = data.get('store_id')
        sync_type = data.get('type', 'inventory')
        target_date_str = data.get('date')
        
        if not store_id:
            return jsonify({'success': False, 'error': 'Store ID required'}), 400
        
        store = Store.query.get(store_id)
        if not store:
            return jsonify({'success': False, 'error': 'Store not found'}), 404
        
        # Check permissions
        if current_user.role == 'Store Manager' and store.manager_id != current_user.id:
            return jsonify({'success': False, 'error': 'Access denied'}), 403
        
        target_date = datetime.strptime(target_date_str, '%Y-%m-%d').date() if target_date_str else date.today()
        
        # Get all products from ProductMaster for syncing
        # To filter by specific codes, add them to product_codes list
        product_codes = []  # Empty list = sync all products
        
        if product_codes:
            products = ProductMaster.query.filter(
                ProductMaster.code.in_(product_codes)
            ).all()
        else:
            products = ProductMaster.query.all()
        
        synced_inventory = 0

        if sync_type == 'all':
            sync_type = 'inventory'

        # Sync to Daily Ending Inventory
        if sync_type == 'inventory':
            inventory = DailyEndingInventory.query.filter_by(
                store_id=store.id,
                inventory_date=target_date
            ).first()
            
            if not inventory:
                inventory = DailyEndingInventory(
                    store_id=store.id,
                    inventory_date=target_date,
                    created_by=current_user.id
                )
                db.session.add(inventory)
                db.session.flush()
            
            # Get previous day's ending as beginning
            prev_date = target_date - timedelta(days=1)
            prev_inventory = DailyEndingInventory.query.filter_by(
                store_id=store.id,
                inventory_date=prev_date
            ).first()
            
            existing_item_ids = {item.product_master_id: item for item in 
                DailyEndingInventoryItem.query.filter_by(inventory_id=inventory.id).all()}
            
            for product in products:
                if product.id in existing_item_ids:
                    # Update existing item
                    item = existing_item_ids[product.id]
                    item.product_code = str(product.code) if product.code else item.product_code
                    item.product_description = product.description
                    srp = product.sp_p if store.store_group == 'premium' else product.sp_np
                    item.srp_price = srp or 0
                else:
                    # Create new item
                    beginning_qty = 0
                    if prev_inventory:
                        prev_item = DailyEndingInventoryItem.query.filter_by(
                            inventory_id=prev_inventory.id,
                            product_master_id=product.id
                        ).first()
                        if prev_item:
                            beginning_qty = prev_item.total_ending_qty
                    
                    srp = product.sp_p if store.store_group == 'premium' else product.sp_np
                    
                    item = DailyEndingInventoryItem(
                        inventory_id=inventory.id,
                        product_master_id=product.id,
                        product_code=str(product.code) if product.code else '',
                        product_description=product.description,
                        srp_price=srp or 0,
                        beginning_qty=beginning_qty
                    )
                    db.session.add(item)
                    synced_inventory += 1
        
        db.session.commit()
        
        log_audit_event(
            action='products.sync',
            entity_type='ProductMaster',
            entity_id=store_id,
            details={
                'sync_type': sync_type,
                'date': target_date.isoformat(),
                'synced_inventory': synced_inventory
            }
        )
        
        return jsonify({
            'success': True,
            'message': f'Sync completed successfully',
            'synced_inventory': synced_inventory,
            'total_products': len(products)
        })
        
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500


@views.route('/api/products/masterlist')
@login_required
def get_masterlist_products():
    """Get all products from ProductMaster for selection"""
    try:
        category_filter = request.args.get('category', '')
        search = request.args.get('search', '')
        
        query = ProductMaster.query
        
        if category_filter:
            query = query.filter(ProductMaster.category == category_filter)
        
        if search:
            query = query.filter(
                db.or_(
                    ProductMaster.description.ilike(f'%{search}%'),
                    ProductMaster.code.ilike(f'%{search}%')
                )
            )
        
        products = query.order_by(ProductMaster.category, ProductMaster.description).all()
        
        return jsonify({
            'success': True,
            'products': [{
                'id': p.id,
                'code': p.code,
                'description': p.description,
                'category': p.category,
                'sub_category': p.sub_category,
                'tp': p.tp,
                'sp_p': p.sp_p,
                'sp_np': p.sp_np,
                'shelf_life': p.shelf_life
            } for p in products]
        })
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

