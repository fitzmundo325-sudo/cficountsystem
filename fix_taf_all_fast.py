import sys
import os
import time
from datetime import datetime
from collections import defaultdict
from sqlalchemy import func

sys.path.append(os.path.abspath(os.path.dirname(__file__)))

from website import create_app, db
from website.models import (
    DailyEndingInventory,
    DailyEndingInventoryItem,
    Store,
    ProductMaster,
    TafTransfer,
    TafTransferItem
)
from website.views import _build_pos_sold_master_lookups, _resolve_pos_sold_master_id

app = create_app()

with app.app_context():
    print("Starting optimized TAF sync for all records...", flush=True)
    start_time = time.time()
    
    # 1. Load all Stores
    print("Loading stores...", flush=True)
    stores = Store.query.all()
    store_name_to_id = {str(s.name or '').strip().lower(): s.id for s in stores}
    store_id_to_store = {s.id: s for s in stores}
    
    # 2. Build TAF lookups
    print("Building TAF lookups...", flush=True)
    alias_lookup, master_lookup = _build_pos_sold_master_lookups()
    
    # Query all TAF transfers that are Product Transfer
    taf_query = (
        db.session.query(TafTransferItem, TafTransfer)
        .join(TafTransfer, TafTransfer.id == TafTransferItem.transfer_id)
        .filter(func.lower(func.trim(TafTransfer.transaction_type)) == 'product transfer')
    )
    
    # Data structures to hold totals
    # (store_id, date, product_master_id) -> total_qty
    traced_out_totals = defaultdict(int)
    traced_in_totals = defaultdict(int)
    
    taf_rows = taf_query.all()
    print(f"Loaded {len(taf_rows)} TAF rows.", flush=True)
    
    for transfer_item, transfer in taf_rows:
        resolved_master_id = _resolve_pos_sold_master_id(
            transfer_item.item_name, alias_lookup, master_lookup
        )
        if not resolved_master_id:
            continue
            
        quantity = int(transfer_item.quantity or 0)
        received_qty = int(transfer_item.received_quantity) if transfer_item.received_quantity is not None else quantity
        
        tx_date = transfer.transaction_date
        
        # OUT
        out_store_id = transfer.store_id
        if quantity > 0:
            traced_out_totals[(out_store_id, tx_date, resolved_master_id)] += quantity
            
        # IN
        if str(transfer.status or '').strip().lower() != 'pending':
            transfer_to_normalized = str(transfer.transfer_to or '').strip().lower()
            in_store_id = store_name_to_id.get(transfer_to_normalized)
            if in_store_id and received_qty > 0:
                traced_in_totals[(in_store_id, tx_date, resolved_master_id)] += received_qty
                
    # 3. Iterate inventories and fix items
    print("Checking inventories for discrepancies...", flush=True)
    inventories = DailyEndingInventory.query.all()
    total = len(inventories)
    
    fixed_count = 0
    processed = 0
    
    for inv in inventories:
        processed += 1
        
        transaction_date = inv.inventory_date
        store_id = inv.store_id
        store = store_id_to_store.get(store_id)
        if not store:
            continue
            
        items = DailyEndingInventoryItem.query.filter_by(inventory_id=inv.id).all()
        needs_commit = False
        
        for item in items:
            if not item.product_master_id:
                continue
                
            pm_id = item.product_master_id
            
            # Get traced totals from dict
            traced_in = traced_in_totals.get((store_id, transaction_date, pm_id), 0)
            traced_out = traced_out_totals.get((store_id, transaction_date, pm_id), 0)
            
            needs_update = False
            
            if int(item.trans_in_qty or 0) != traced_in:
                item.trans_in_qty = traced_in
                needs_update = True
                
            if int(item.trans_out_qty or 0) != traced_out:
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
            
        if processed % 200 == 0:
            print(f"Processed {processed}/{total} inventories... (Fixed {fixed_count} items)", flush=True)

    elapsed = time.time() - start_time
    print(f"Done! Fixed {fixed_count} mismatched items across {total} inventories in {elapsed:.2f} seconds.", flush=True)
