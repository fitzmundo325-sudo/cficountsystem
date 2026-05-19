# Trans-In Receiving Flow Update

## Overview
Updated the Trans-In quantity flow so that inventory quantities are only reflected in invensync when the store clicks the **"Confirm Receiving"** button, not when the TAF (Transaction Activity Form) is initially submitted.

## Changes Made

### 1. Modified TAF Submission Flow (`views.py` - Line 3410-3412)
**Before:**
- When a TAF was submitted, Trans-In quantities were immediately added to the destination store's inventory
- This happened via `_update_inventory_trans_quantities(transfer_record, parsed_items)`

**After:**
- TAF submission no longer updates inventory quantities
- The function call is commented out with explanation
- Inventory will only be updated when receiving is confirmed

```python
# Update inventory Trans-In/Trans-Out quantities only after receiving is confirmed
# This is now handled in store_manager_incoming_transfer_view when Confirm Receiving is clicked
# _update_inventory_trans_quantities(transfer_record, parsed_items)
```

### 2. Added New Function (`views.py` - Lines 3142-3228)
Created `_update_inventory_trans_in_on_receive(transfer, transfer_items)` function that:
- Is called when "Confirm Receiving" button is clicked
- Updates the Trans-In quantity in invensync using the **received_quantity** (confirmed amount)
- Finds or creates inventory records for the destination store
- Prevents double-counting by only updating if `trans_in_qty == 0`
- Recalculates the theoretical ending quantity

**Key Features:**
- Uses `received_quantity` instead of `sent_qty` to reflect actual received amounts
- Handles short/over deliveries correctly
- Creates inventory records if they don't exist for the transaction date
- Only processes Product Transfer and Wastage Transfer types

### 3. Integrated into Receiving Flow (`views.py` - Line 3612-3613)
Added the function call in `store_manager_incoming_transfer_view()` POST handler:

```python
# Update invensync Trans-In quantity when receiving is confirmed
_update_inventory_trans_in_on_receive(transfer, transfer_items)
```

This runs after:
- Received quantities are validated
- Short/Over variances are calculated
- Transfer status is updated (Received, Received - Short, Received - Over, etc.)

## Flow Comparison

### Old Flow:
1. Store submits TAF → ✅ Trans-In added to invensync immediately
2. Receiving store clicks "Confirm Receiving" → ❌ No inventory update (only status change)

### New Flow:
1. Store submits TAF → ❌ No inventory update (only creates TAF record)
2. Receiving store clicks "Confirm Receiving" → ✅ Trans-In added to invensync with confirmed quantities

## Benefits

1. **Accurate Inventory**: Inventory only reflects quantities that have been physically received and confirmed
2. **Handles Variances**: Uses actual received quantities (with short/over) instead of sent quantities
3. **Prevents Premature Updates**: Inventory won't show items until they're actually received
4. **Audit Trail**: Clear separation between "sent" and "received" states

## Affected Pages

- **trans.html** (Incoming Transfers list) - No changes
- **trans_view.html** (TAF view with Confirm Receiving button) - No UI changes
- **invensync.html** (Inventory sync page) - Now shows Trans-In only after confirmation
- **transaction_activity_form.html** (TAF submission) - No changes to form

## Database Impact

- `DailyEndingInventoryItem.trans_in_qty` - Only populated after receiving confirmation
- `TafTransfer.status` - Still updates normally (Pending → Received/Received - Short/etc.)
- `TafTransferItem.received_quantity` - Used as the source for Trans-In quantity

## Testing Recommendations

1. Submit a new TAF (Product Transfer)
2. Verify Trans-In does NOT appear in invensync yet
3. Go to incoming transfers and click "Confirm Receiving"
4. Verify Trans-In now appears in invensync with correct quantity
5. Test with short/over deliveries to ensure correct quantities are used
6. Verify no double-counting occurs if receiving is confirmed multiple times
