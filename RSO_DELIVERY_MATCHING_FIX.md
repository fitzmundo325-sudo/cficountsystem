# RSO Delivery to Inventory Matching Fix

## Problem
The previous product matching logic between RSO delivery data (from `delivery.html`) and the inventory "Delivery" column (in `invensync.html`) had several issues:

1. **Partial matching**: Used substring matching (`in` operator) which could incorrectly match products
2. **No product code priority**: Did not prioritize matching by product code
3. **Fuzzy matching issues**: Used SequenceMatcher with 0.7 threshold, which could match unrelated products
4. **Incorrect associations**: Products with similar starting names but different endings could be incorrectly matched

## Solution
Implemented a strict, accurate matching system with the following rules:

### Matching Priority
1. **Product Code Match** (if available in RSO data)
2. **Full Product Name Match** (exact match after normalization)

### Normalization Rules
- Case-insensitive comparison
- Trim leading/trailing whitespace
- Collapse multiple spaces into single space
- Convert to lowercase for comparison

### Important: NO Partial Matching
- **DO NOT** match using only first word or partial name
- **DO NOT** use substring matching
- **ONLY** accept matches when the **ENTIRE** normalized product name aligns
- Products sharing the same starting name but differing in remaining words will NOT match

## Implementation

### New Helper Functions

#### `_normalize_product_name(name)`
Normalizes product names for comparison:
- Converts to lowercase
- Strips whitespace
- Collapses multiple spaces

Example:
```python
"  CHOCOLATE   CREAM  " → "chocolate cream"
"chocolate cream" → "chocolate cream"
```

#### `_match_rso_to_inventory(rso_item, product)`
Implements the matching logic with these checks:

1. **Product Code Extraction**: If RSO product_name contains a code pattern (e.g., "123 - Product Name"), extract and match the code
2. **Exact Normalized Name Match**: Compare fully normalized names
3. **Code-as-Name Match**: If RSO product_name is just a product code, match against product.code

### Updated Functions

1. **`invensync()` route** (lines ~5373-5402)
   - Replaced partial matching logic with `_match_rso_to_inventory()`
   - Added tracking of matched RSO items to prevent duplicate assignments
   - Only assigns delivery qty if currently 0 (preserves manual edits)

2. **`delete_all_rso_data()` function** (lines ~2699-2809)
   - Updated to use same matching logic for consistency
   - Removes fuzzy SequenceMatcher matching
   - Uses exact product matching through ProductMaster relationship

## Code Changes

### File: `website/views.py`

#### Added Functions (before invensync route):
```python
def _normalize_product_name(name):
    """Normalize product name for comparison: lowercase, strip, collapse spaces."""
    if not name:
        return ''
    normalized = ' '.join(str(name).lower().strip().split())
    return normalized


def _match_rso_to_inventory(rso_item, product):
    """
    Match RSO delivery item to inventory product.
    Priority: Product Code > Full Product Name (exact normalized match)
    """
    # Normalize both names
    rso_name_normalized = _normalize_product_name(rso_item.product_name)
    product_desc_normalized = _normalize_product_name(product.description)
    product_code_str = str(product.code or '').strip()
    
    # Try matching by product code if embedded in product_name
    rso_name_upper = str(rso_item.product_name).strip()
    code_match = re.match(r'^(\d+)\s*[-–—]?\s*(.+)$', rso_name_upper)
    if code_match:
        rso_code_from_name = code_match.group(1).strip()
        if rso_code_from_name == product_code_str:
            return True
    
    # Primary: Exact normalized product name comparison
    if rso_name_normalized and product_desc_normalized:
        if rso_name_normalized == product_desc_normalized:
            return True
    
    # Secondary: If RSO product_name IS the product code
    if rso_name_normalized == product_code_str.lower():
        return True
    
    return False
```

#### Modified: `invensync()` route
- Removed old partial matching code (lines ~5328-5359)
- Added `matched_rso_ids` tracking set to prevent duplicates
- Calls `_match_rso_to_inventory()` for each potential match
- Only assigns if `delivery_qty == 0` (preserves manual entries)

#### Modified: `delete_all_rso_data()` function
- Removed SequenceMatcher fuzzy matching
- Uses `_match_rso_to_inventory()` for consistent matching
- Accesses ProductMaster through `product_master_id` relationship

## Examples

### Correct Matches ✓
| RSO Product Name | Inventory Product Description | Match? |
|-----------------|------------------------------|--------|
| "Chocolate Cream" | "chocolate cream" | ✓ Yes (case-insensitive) |
| "  CHOCOLATE   CREAM  " | "chocolate cream" | ✓ Yes (normalized) |
| "123 - Chocolate Cream" | Product code: 123 | ✓ Yes (code match) |
| "chocolate cream" | "Chocolate  Cream" | ✓ Yes (spaces normalized) |

### Incorrect Matches Prevented ✗
| RSO Product Name | Inventory Product Description | Match? | Reason |
|-----------------|------------------------------|--------|--------|
| "Chocolate" | "Chocolate Cream" | ✗ No | Partial match blocked |
| "Chocolate Cream" | "Chocolate Cream Deluxe" | ✗ No | Full name mismatch |
| "Vanilla Cake" | "Chocolate Cake" | ✗ No | Different products |
| "123" | Product code: 124 | ✗ No | Code mismatch |

## Testing Recommendations

1. **Upload RSO file** with known product names/codes
2. **Verify in invensync.html** that delivery quantities populate correctly
3. **Check for false positives**: Ensure similar-but-different products don't match
4. **Test edge cases**:
   - Products with extra spaces
   - Mixed case names
   - Products with special characters (-, /, etc.)
   - Products that share starting words but differ later

## Benefits

1. **Accuracy**: Only exact matches after normalization
2. **No False Positives**: Prevents incorrect product associations
3. **Consistency**: Same matching logic used across all RSO operations
4. **Maintainability**: Centralized matching logic in helper functions
5. **Traceability**: Matched RSO items tracked to prevent duplicates

## Backward Compatibility

- Existing RSO data will be re-matched using new logic on next page load
- Manual delivery qty entries are preserved (only auto-fills if qty == 0)
- No database schema changes required
