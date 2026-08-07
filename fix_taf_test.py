import sys
import os
from datetime import datetime

sys.path.append(os.path.abspath(os.path.dirname(__file__)))

from website import create_app, db
from website.models import (
    DailyEndingInventory,
    DailyEndingInventoryItem,
    Store,
    ProductMaster
)
from website.views import _build_taf_transfer_trace

app = create_app()

with app.app_context():
    # Only Store 23 and 2026-07-26 for testing first
    date_to_fix = datetime.strptime('2026-07-26', '%Y-%m-%d').date()
    inventories = DailyEndingInventory.query.filter_by(store_id=23, inventory_date=date_to_fix).all()
    
    fixed_count = 0
    
    for inv in inventories:
        store = Store.query.get(inv.store_id)
        if not store:
            continue
            
        transaction_date = inv.inventory_date
        
        items = DailyEndingInventoryItem.query.filter_by(inventory_id=inv.id).all()
        for item in items:
            if not item.product_master_id:
                continue
                
            # Traced in
            _, traced_in = _build_taf_transfer_trace(store, transaction_date, item.product_master_id, 'in')
            # Traced out
            _, traced_out = _build_taf_transfer_trace(store, transaction_date, item.product_master_id, 'out')
            
            needs_update = False
            if int(item.trans_in_qty or 0) != traced_in:
                print(f"Store {store.name} | Date {transaction_date} | Product {item.product_master_id} - IN mismatch. DB: {item.trans_in_qty}, Trace: {traced_in}")
                item.trans_in_qty = traced_in
                needs_update = True
                
            if int(item.trans_out_qty or 0) != traced_out:
                print(f"Store {store.name} | Date {transaction_date} | Product {item.product_master_id} - OUT mismatch. DB: {item.trans_out_qty}, Trace: {traced_out}")
                item.trans_out_qty = traced_out
                needs_update = True
                
            if needs_update:
                sold_qty = int(item.quantity_sold or 0)
                
                # Recompute THEO
                item.theo_ending_qty = (
                    int(item.beginning_qty or 0)
                    + int(item.delivery_qty or 0)
                    + int(item.trans_in_qty or 0)
                    + int(item.bo_qty or 0)
                    + int(item.adv_del_qty or 0)
                    - int(item.trans_out_qty or 0)
                    - int(item.wastage_qty or 0)
                    - int(item.csi_qty or 0)
                    - sold_qty
                )
                
                # Recompute Variance
                item.total_ending_qty = (
                    int(item.ending_d5_qty or 0)
                    + int(item.ending_d4_qty or 0)
                    + int(item.ending_d3_qty or 0)
                )
                item.variance_qty = item.total_ending_qty - item.theo_ending_qty
                item.variance_peso = item.variance_qty * (item.srp_price or 0)
                
                fixed_count += 1
                
        db.session.commit()

    print(f"Fixed {fixed_count} mismatched items for store 23 on 2026-07-26.")
