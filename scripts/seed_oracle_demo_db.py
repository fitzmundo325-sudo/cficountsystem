import os
import sqlite3
import sys
from datetime import date, datetime, timedelta
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ['CM_APP_DB_NAME'] = 'oracle_demo.db'

from website import DB_NAME, create_app, db
from website.models import (
    DailyEndingInventory,
    DailyEndingInventoryItem,
    DailyReport,
    PosSold,
    ProductMaster,
    Store,
    User,
)


ANCHOR = date(2026, 6, 8)
START = ANCHOR - timedelta(days=27)
PREV_DAY = ANCHOR - timedelta(days=1)
STORE_ID = 6

DEMO_PRODUCTS = {
    1: 16,
    2: 10,
    3: 12,
    5: 8,
    7: 7,
    9: 9,
    10: 8,
    12: 7,
    13: 6,
    15: 5,
    20: 6,
    23: 6,
    28: 10,
    29: 7,
    32: 5,
    43: 4,
}

WEEKDAY_MULT = {
    0: 0.85,
    1: 0.95,
    2: 1.00,
    3: 1.05,
    4: 1.20,
    5: 1.35,
    6: 1.25,
}


def _delete_demo_window(store):
    reports = DailyReport.query.filter(
        DailyReport.store_id == store.id,
        DailyReport.report_date >= START,
        DailyReport.report_date <= ANCHOR,
    ).all()
    for report in reports:
        db.session.delete(report)

    inventories = DailyEndingInventory.query.filter(
        DailyEndingInventory.store_id == store.id,
        DailyEndingInventory.inventory_date.in_([PREV_DAY, ANCHOR]),
    ).all()
    for inventory in inventories:
        db.session.delete(inventory)

    db.session.flush()


def _copy_product_master_from_main(app):
    main_db_path = Path(app.instance_path) / DB_NAME
    if not main_db_path.exists():
        raise RuntimeError(f'Main database not found at {main_db_path}. Cannot copy ProductMaster records.')

    with sqlite3.connect(main_db_path) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            """
            SELECT id, code, description, category, sub_category, tp, sp_p, sp_np, shelf_life, created_at, updated_at
            FROM product_master
            ORDER BY id
            """
        ).fetchall()

    if not rows:
        raise RuntimeError('Main database has no ProductMaster rows to copy.')

    for row in rows:
        db.session.add(ProductMaster(
            id=row['id'],
            code=row['code'],
            description=row['description'],
            category=row['category'],
            sub_category=row['sub_category'],
            tp=row['tp'],
            sp_p=row['sp_p'],
            sp_np=row['sp_np'],
            shelf_life=row['shelf_life'],
        ))
    db.session.flush()


def _ensure_demo_master_data(app):
    if not db.session.get(User, 1):
        db.session.add(User(
            id=1,
            email='demo-admin@example.test',
            username='demo_admin',
            full_name='Demo Admin',
            role='Superadmin',
            password='demo',
        ))

    if not db.session.get(User, 7):
        db.session.add(User(
            id=7,
            email='demo-airport@example.test',
            username='airport',
            full_name='Airport Demo Manager',
            role='Store Manager',
            password='demo',
        ))

    if not ProductMaster.query.first():
        _copy_product_master_from_main(app)

    if not db.session.get(Store, STORE_ID):
        db.session.add(Store(
            id=STORE_ID,
            name='Aiport',
            address='Demo Airport Branch',
            store_group='non_premium',
            manager_id=7,
            is_one_year_already=True,
        ))

    db.session.commit()


def _seed_pos_history(store, user_id, products):
    total_reports = 0
    total_pos_rows = 0

    for offset in range((ANCHOR - START).days + 1):
        report_date = START + timedelta(days=offset)
        report = DailyReport(
            store_id=store.id,
            report_date=report_date,
            submitted_by=user_id,
            status='Approved',
        )
        db.session.add(report)
        db.session.flush()

        gross_total = 0.0
        net_total = 0.0
        qty_total = 0

        for product_id, base_qty in DEMO_PRODUCTS.items():
            product = products[product_id]
            weekday_mult = WEEKDAY_MULT[report_date.weekday()]
            variation = ((product_id + report_date.day) % 5) - 2
            qty = max(1, int(round(base_qty * weekday_mult + variation)))
            if base_qty <= 5 and report_date.weekday() in (0, 2) and product_id % 2 == 0:
                qty = 0
            if qty <= 0:
                continue

            unit_price = float(product.sp_np or product.sp_p or product.tp or 0)
            gross = round(qty * unit_price, 2)
            discount = round(gross * (0.02 if report_date.weekday() in (5, 6) else 0.01), 2)
            net = round(gross - discount, 2)

            db.session.add(PosSold(
                daily_report_id=report.id,
                product_name=product.description,
                quantity=qty,
                gross_sales=gross,
                discount=discount,
                net_sales=net,
            ))
            gross_total += gross
            net_total += net
            qty_total += qty
            total_pos_rows += 1

        report.pos_gross_sales = round(gross_total, 2)
        report.pos_net_sales = round(net_total, 2)
        report.pos_tc = max(20, int(qty_total * 0.65))
        total_reports += 1

    return total_reports, total_pos_rows


def _add_inventory(store, user_id, products, inv_date, finalized=False):
    inventory = DailyEndingInventory(
        store_id=store.id,
        inventory_date=inv_date,
        created_by=user_id,
        is_finalized=finalized,
        finalized_at=datetime.now() if finalized else None,
        finalized_by=user_id if finalized else None,
        is_beginning_finalized=finalized,
        beginning_finalized_at=datetime.now() if finalized else None,
        beginning_finalized_by=user_id if finalized else None,
    )
    db.session.add(inventory)
    db.session.flush()

    for product_id, base_qty in DEMO_PRODUCTS.items():
        product = products[product_id]
        beginning = int(round(base_qty * 2.6 + (product_id % 4)))
        sold = max(1, int(round(base_qty * WEEKDAY_MULT[inv_date.weekday()])))
        trans_in = 2 if (not finalized and product_id in (5, 28, 32)) else 0
        trans_out = 1 if (not finalized and product_id in (1, 3, 9)) else 0
        wastage = 1 if product_id in (5, 7, 28) and inv_date.weekday() in (6, 0) else 0
        delivery = 0 if not finalized else max(0, int(round(base_qty * 0.5)))
        total_ending = max(0, beginning + delivery + trans_in - trans_out - wastage - sold)
        d5 = total_ending // 3
        d4 = total_ending // 3
        d3 = total_ending - d5 - d4
        srp = float(product.sp_np or product.sp_p or product.tp or 0)

        db.session.add(DailyEndingInventoryItem(
            inventory_id=inventory.id,
            product_master_id=product.id,
            product_code=str(product.code or product.id),
            product_description=product.description,
            srp_price=srp,
            beginning_qty=beginning,
            delivery_qty=delivery,
            trans_in_qty=trans_in,
            bo_qty=0,
            adv_del_qty=0,
            trans_out_qty=trans_out,
            wastage_qty=wastage,
            wastage_amount=round(wastage * srp, 2),
            csi_qty=0,
            quantity_sold=sold,
            ending_d5_qty=d5,
            ending_d4_qty=d4,
            ending_d3_qty=d3,
            total_ending_qty=total_ending,
            total_peso_srp=round(total_ending * srp, 2),
            theo_ending_qty=total_ending,
            variance_qty=0,
            variance_peso=0.0,
            remarks='Demo Oracle seed data',
        ))


def main():
    app = create_app()
    with app.app_context():
        _ensure_demo_master_data(app)

        store = db.session.get(Store, STORE_ID)
        if not store:
            raise RuntimeError('Airport store was not created in the demo database.')

        user_id = store.manager_id or db.session.query(User.id).filter_by(role='Superadmin').scalar() or 1
        products = {
            product.id: product
            for product in ProductMaster.query.filter(ProductMaster.id.in_(list(DEMO_PRODUCTS))).all()
        }
        missing = sorted(set(DEMO_PRODUCTS) - set(products))
        if missing:
            raise RuntimeError(f'Missing demo products: {missing}')

        _delete_demo_window(store)
        total_reports, total_pos_rows = _seed_pos_history(store, user_id, products)
        _add_inventory(store, user_id, products, PREV_DAY, finalized=True)
        _add_inventory(store, user_id, products, ANCHOR, finalized=False)
        db.session.commit()

        print(f'Seeded oracle_demo.db for {store.name} ({START} to {ANCHOR}).')
        print(f'Reports: {total_reports}, POS Sold rows: {total_pos_rows}')
        print(f'InvenSync inventory dates: {PREV_DAY}, {ANCHOR}')
        print('Run with: $env:CM_APP_DB_NAME=\"oracle_demo.db\"; python app.py')


if __name__ == '__main__':
    main()
