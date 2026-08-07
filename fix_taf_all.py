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
import time

app = create_app()

with app.app_context():
    print("Starting TAF sync for all records...")
    start_time = time.time()
    
    inventories = DailyEndingInventory.query.all()
    total = len(inventories)
    
    fixed_count = 0
    processed = 0
    
    for inv in inventories:
        processed += 1
        store = Store.query.get(inv.store_id)
        if not store:
            continue
            
        transaction_date = inv.inventory_date
        
        items = DailyEndingInventoryItem.query.filter_by(inventory_id=inv.id).all()
        needs_commit = False
        for item in items:
            if not item.product_master_id:
                continue
                
            # Traced in
            _, traced_in = _build_taf_transfer_trace(store, transaction_date, item.product_master_id, 'in')
            # Traced out
            _, traced_out = _build_taf_transfer_trace(store, transaction_date, item.product_master_id, 'out')
            
            needs_update = False
            if int(item.trans_in_qty or 0) != traced_in:
                # print(f"Store {store.name} | Date {transaction_date} | Product {item.product_master_id} - IN mismatch. DB: {item.trans_in_qty}, Trace: {traced_in}")
                item.trans_in_qty = traced_in
                needs_update = True
                
            if int(item.trans_out_qty or 0) != traced_out:
                # print(f"Store {store.name} | Date {transaction_date} | Product {item.product_master_id} - OUT mismatch. DB: {item.trans_out_qty}, Trace: {traced_out}")
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
                needs_commit = True
                
        if needs_commit:
            db.session.commit()
            
        if processed % 100 == 0:
            print(f"Processed {processed}/{total} inventories... (Fixed {fixed_count} items)")

    elapsed = time.time() - start_time
    print(f"Done! Fixed {fixed_count} mismatched items across {total} inventories in {elapsed:.2f} seconds.")
