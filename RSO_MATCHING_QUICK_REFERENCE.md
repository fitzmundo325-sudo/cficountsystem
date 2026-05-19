# Quick Reference: RSO Delivery Matching

## How It Works

### Data Flow
```
delivery.html (RSO Upload) 
    ↓
RsoDelivery Table (database)
    ↓
Matching Logic (_match_rso_to_inventory)
    ↓
invensync.html (Delivery Column)
```

### Matching Rules (in order of priority)

1. **Product Code Match**
   - If RSO has format: "123 - Product Name"
   - Extracts "123" and matches to product.code

2. **Exact Product Name Match**
   - Normalizes both names (lowercase, trim, collapse spaces)
   - Must be 100% match after normalization
   - NO partial/substring matching

3. **Code-as-Name Match**
   - If RSO product_name IS just a code (e.g., "123")
   - Matches to product.code

### What Changed

**BEFORE** (Old Logic):
```python
# ❌ Partial matching - INCORRECT
is_match = (
    product_name_lower == product_desc_lower or 
    product_desc_lower in product_name_lower or  # substring match!
    product_name_lower in product_desc_lower or  # substring match!
)
```

**AFTER** (New Logic):
```python
# ✓ Exact normalized matching - CORRECT
rso_normalized = _normalize_product_name(rso_item.product_name)
product_normalized = _normalize_product_name(product.description)

is_match = (rso_normalized == product_normalized)  # exact match only!
```

### Testing Your Changes

1. **Start the Flask app**
   ```bash
   python app.py
   ```

2. **Upload an RSO file** in delivery.html
   - File should have product names/codes

3. **Check invensync.html**
   - Verify delivery quantities populated correctly
   - Check that only exact matches were made

4. **Test edge cases**:
   - Products with different cases: "Chocolate" vs "chocolate"
   - Products with extra spaces: "Chocolate  Cream" vs "Chocolate Cream"
   - Similar products: "Chocolate Cake" vs "Chocolate Cream Cake" (should NOT match)

### Key Functions Modified

| Function | File | Line | Purpose |
|----------|------|------|---------|
| `_normalize_product_name()` | views.py | ~5158 | Normalize names for comparison |
| `_match_rso_to_inventory()` | views.py | ~5168 | Core matching logic |
| `invensync()` | views.py | ~5206 | Apply matching when loading page |
| `delete_all_rso_data()` | views.py | ~2699 | Use same logic for deletion |

### Common Issues & Solutions

**Issue**: Products not matching
- **Check**: Are product names exactly the same (after normalization)?
- **Solution**: Update either RSO file or ProductMaster to match

**Issue**: Wrong products matching
- **Check**: This shouldn't happen with new logic!
- **Solution**: Verify product names are truly different

**Issue**: Delivery qty not populating
- **Check**: Is delivery_qty already > 0?
- **Solution**: System preserves manual edits, only auto-fills if qty == 0

### Important Notes

⚠️ **NO Partial Matching**: "Chocolate" will NOT match "Chocolate Cream"
✓ **Case Insensitive**: "CHOCOLATE" matches "chocolate"
✓ **Space Normalized**: "Chocolate  Cream" matches "Chocolate Cream"
✓ **Code Priority**: If code matches, name doesn't need to match
