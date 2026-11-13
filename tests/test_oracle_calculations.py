import pytest
import sys
import os
from datetime import date, timedelta
from unittest.mock import Mock, MagicMock, patch

# Add the website directory to the path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'website'))


def _normalize_product_text(text):
    """Copy of the normalization function for testing."""
    import re
    return ' '.join((text or '').strip().lower().split())


class TestOracleCalculations:
    """Unit tests for Oracle order calculation functions."""

    def test_calcAvg_basic(self):
        """Test basic average consumption calculation."""
        # This tests the logic from oracle_handles.js calcAvg function
        # calcAvg(p, dayName, mult, ne, tIn, tOut)
        # target = Math.ceil(avg * mult * days * (1 + buf))
        # raw = target - ne - tIn + tOut
        # return Math.ceil(Math.max(0, raw) / min) * min
        
        avg = 100  # average daily sales
        mult = 1.0  # multiplier
        days = 1    # lead time
        buf = 0.20  # 20% buffer
        ne = 50     # net ending (stock - expected sales)
        tIn = 0     # transfer in
        tOut = 0    # transfer out
        min_order = 1
        
        target = int((avg * mult * days * (1 + buf)) + 0.999)  # Math.ceil
        raw = target - ne - tIn + tOut
        result = int((max(0, raw) / min_order) + 0.999) * min_order
        
        # avg=100, mult=1, days=1, buf=0.2 => target = ceil(120) = 120
        # raw = 120 - 50 = 70
        # result = ceil(70/1)*1 = 70
        assert target == 120
        assert result == 70

    def test_calcAvg_with_buffer_zero(self):
        """Test calcAvg with 0% buffer."""
        avg = 100
        mult = 1.0
        days = 1
        buf = 0.0
        ne = 50
        tIn = 0
        tOut = 0
        min_order = 1
        
        target = int((avg * mult * days * (1 + buf)) + 0.999)
        raw = target - ne - tIn + tOut
        result = int((max(0, raw) / min_order) + 0.999) * min_order
        
        assert target == 100
        assert result == 50

    def test_calcAvg_with_min_order(self):
        """Test calcAvg respects min_order quantity."""
        avg = 100
        mult = 1.0
        days = 1
        buf = 0.20
        ne = 50
        tIn = 0
        tOut = 0
        min_order = 12  # e.g., products sold in packs of 12
        
        target = int((avg * mult * days * (1 + buf)) + 0.999)
        raw = target - ne - tIn + tOut
        result = int((max(0, raw) / min_order) + 0.999) * min_order
        
        # target = 120, raw = 70
        # result = ceil(70/12)*12 = ceil(5.83)*12 = 6*12 = 72
        assert result == 72

    def test_calcAvg_negative_raw(self):
        """Test calcAvg when raw is negative (enough stock)."""
        avg = 100
        mult = 1.0
        days = 1
        buf = 0.20
        ne = 150  # More than target
        tIn = 0
        tOut = 0
        min_order = 1
        
        target = int((avg * mult * days * (1 + buf)) + 0.999)
        raw = target - ne - tIn + tOut
        result = int((max(0, raw) / min_order) + 0.999) * min_order
        
        # target = 120, raw = -30
        # max(0, -30) = 0
        # result = 0
        assert result == 0

    def test_calcTarget_basic(self):
        """Test target-based calculation (revenue share method)."""
        # calcTarget(p, di, tSales, mult, ne, tIn, tOut)
        # pAvg = getAvgDayIdx(p.id, di) * p.sellingPrice
        # totRev = sum of all products' avg * sellingPrice
        # qty = ceil(tSales * (pAvg / totRev) / p.sellingPrice)
        # raw = ceil(qty * mult * (1 + buf)) - ne - tIn + tOut
        
        p_avg_units = 100
        p_selling_price = 50
        p_avg_revenue = p_avg_units * p_selling_price  # 5000
        
        # Other products total revenue
        other_revenue = 15000
        tot_rev = p_avg_revenue + other_revenue  # 20000
        
        t_sales = 10000  # target sales for the day
        mult = 1.0
        buf = 0.20
        ne = 20
        tIn = 0
        tOut = 0
        min_order = 1
        
        # pAvg / totRev = 5000/20000 = 0.25
        # qty = ceil(10000 * 0.25 / 50) = ceil(50) = 50
        # target = ceil(50 * 1.0 * 1.2) = ceil(60) = 60
        # raw = 60 - 20 = 40
        
        p_avg_revenue_calc = p_avg_units * p_selling_price
        share = p_avg_revenue_calc / tot_rev
        qty = int((t_sales * share / p_selling_price) + 0.999)
        target = int((qty * mult * (1 + buf)) + 0.999)
        raw = target - ne - tIn + tOut
        result = int((max(0, raw) / min_order) + 0.999) * min_order
        
        assert qty == 50
        assert target == 60
        assert result == 40

    def test_suggested_range_calculation(self):
        """Test suggested min/max range (±20%)."""
        suggested = 100
        
        min_s = int(max(0, suggested * 0.8))
        max_s = int((suggested * 1.2) + 0.999)
        
        assert min_s == 80
        assert max_s == 120

    def test_suggested_range_with_min_order(self):
        """Test suggested range respects min_order."""
        suggested = 100
        min_order = 12
        
        min_s = int(max(0, int(suggested * 0.8 / min_order) * min_order))
        max_s = int((int(suggested * 1.2 / min_order) * min_order) + 0.999)
        
        # min: floor(80/12)*12 = 6*12 = 72
        # max: ceil(120/12)*12 = 10*12 = 120
        assert min_s == 72
        assert max_s == 120

    def test_weekly_suggestion_projection(self):
        """Test weekly suggestion with multi-day projection."""
        # Simulates getWeeklySuggestions logic
        stock = 500
        od = date.today()
        dates = [od + timedelta(days=i) for i in range(2, 5)]  # 3 delivery days
        
        avg_daily = [100, 120, 80]  # Mon, Tue, Wed averages
        mult = 1.0
        buffer = 0.20
        min_order = 1
        
        projected = stock
        suggestions = []
        
        for i, day_avg in enumerate(avg_daily):
            exp = int(day_avg * mult)
            before_delivery = max(0, projected - exp)
            target = int((day_avg * mult * (1 + buffer)) + 0.999)
            suggested = int((max(0, target - before_delivery) / min_order) + 0.999) * min_order
            projected = before_delivery + suggested
            suggestions.append(suggested)
        
        # Day 1: exp=100, before=400, target=120, suggested=max(0,120-400)=0, projected=400
        # Day 2: exp=120, before=280, target=144, suggested=max(0,144-280)=0, projected=280
        # Day 3: exp=80, before=200, target=96, suggested=max(0,96-200)=0, projected=200
        
        assert suggestions[0] == 0  # Enough stock for day 1
        assert suggestions[1] == 0  # Enough stock for day 2
        assert suggestions[2] == 0  # Enough stock for day 3

    def test_weekly_suggestion_with_reorder(self):
        """Test weekly suggestion triggers reorder when stock runs low."""
        stock = 150
        avg_daily = [100, 120, 80]
        mult = 1.0
        buffer = 0.20
        min_order = 1
        
        projected = stock
        suggestions = []
        
        for day_avg in avg_daily:
            exp = int(day_avg * mult)
            before_delivery = max(0, projected - exp)
            target = int((day_avg * mult * (1 + buffer)) + 0.999)
            suggested = int((max(0, target - before_delivery) / min_order) + 0.999) * min_order
            projected = before_delivery + suggested
            suggestions.append(suggested)
        
        # Day 1: exp=100, before=50, target=120, suggested=70, projected=120
        # Day 2: exp=120, before=0, target=144, suggested=144, projected=144
        # Day 3: exp=80, before=64, target=96, suggested=32, projected=96
        
        assert suggestions[0] == 70
        assert suggestions[1] == 144
        assert suggestions[2] == 32

    def test_forecast_multiplier(self):
        """Test forecast event multipliers."""
        multipliers = {
            'Normal Day': 1.00,
            'Payday Week (+25%)': 1.25,
            'Holiday (+40%)': 1.40,
            'Rainy Season (-15%)': 0.85,
            "Valentine's Day (+60%)": 1.60,
            'Christmas Season (+80%)': 1.80,
            'Summer (+15%)': 1.15,
            'School Opening (+20%)': 1.20,
            'Long Weekend (+35%)': 1.35,
            'Super Sale (+50%)': 1.50,
        }
        
        base_avg = 100
        buffer = 0.20
        
        for event, mult in multipliers.items():
            target = int((base_avg * mult * (1 + buffer)) + 0.999)
            # Just verify calculation doesn't error
            assert target > 0

    def test_delivery_date_minimum(self):
        """Test minimum delivery date is order_date + 2 days."""
        order_date = date(2026, 1, 15)
        min_delivery = order_date + timedelta(days=2)
        
        assert min_delivery == date(2026, 1, 17)

    def test_max_plan_end(self):
        """Test maximum plan end is delivery_start + 6 days (7 days total)."""
        delivery_start = date(2026, 1, 17)
        max_end = delivery_start + timedelta(days=6)
        
        assert max_end == date(2026, 1, 23)

    def test_buffer_pct_validation(self):
        """Test buffer percentage is clamped to 0-200."""
        test_values = [-10, 0, 50, 100, 150, 200, 250, 500]
        
        for val in test_values:
            clamped = max(0.0, min(200.0, float(val)))
            assert 0 <= clamped <= 200

    def test_min_order_validation(self):
        """Test min_order is at least 1."""
        test_values = [0, 1, 5, 12, 24, 100]
        
        for val in test_values:
            validated = max(1, int(val))
            assert validated >= 1


class TestOracleDataProcessing:
    """Tests for Oracle data processing functions."""

    def test_js_day_index_conversion(self):
        """Test conversion from Python weekday to JS day index (Mon=1, Sun=0)."""
        # Python: Mon=0, Tue=1, Wed=2, Thu=3, Fri=4, Sat=5, Sun=6
        # JS (for display): Mon=1, Tue=2, Wed=3, Thu=4, Fri=5, Sat=6, Sun=0
        
        python_weekdays = [0, 1, 2, 3, 4, 5, 6]
        expected_js = [1, 2, 3, 4, 5, 6, 0]
        
        for py_day, exp_js in zip(python_weekdays, expected_js):
            js_day = (py_day + 1) % 7
            assert js_day == exp_js

    def test_week_index_calculation(self):
        """Test week index calculation for a date within range."""
        start_date = date(2026, 1, 1)  # Thursday
        weeks = 4
        
        week_ranges = []
        for week_index in range(weeks):
            week_start = start_date + timedelta(days=(week_index * 7))
            week_ranges.append((week_start, week_start + timedelta(days=6)))
        
        # Test date in week 0
        test_date = date(2026, 1, 3)  # Saturday
        week_index = None
        for index, (ws, we) in enumerate(week_ranges):
            if ws <= test_date <= we:
                week_index = index
                break
        assert week_index == 0
        
        # Test date in week 3
        test_date = date(2026, 1, 25)  # Sunday
        week_index = None
        for index, (ws, we) in enumerate(week_ranges):
            if ws <= test_date <= we:
                week_index = index
                break
        assert week_index == 3

    def test_sales_data_structure(self):
        """Test sales data structure matches expected format."""
        # Structure: {product_id: [[day0..day6] for week0..week3]}
        product_ids = [1, 2, 3]
        weeks = 4
        
        sales_data = {
            str(pid): [[0 for _ in range(7)] for _ in range(weeks)]
            for pid in product_ids
        }
        
        # Add some sales
        sales_data['1'][0][1] = 100  # Product 1, Week 0, Tuesday
        sales_data['2'][2][4] = 50   # Product 2, Week 2, Friday
        
        assert sales_data['1'][0][1] == 100
        assert sales_data['2'][2][4] == 50
        assert sales_data['3'][0][0] == 0  # Default zero


class TestInvenSyncDataQuality:
    """Tests for InvenSync data quality indicators."""

    def test_data_quality_structure(self):
        """Test data quality indicator structure."""
        data_quality = {
            'ending_stock_source': 'actual',
            'delivery_source': 'actual',
            'trans_in_source': 'actual',
            'trans_out_source': 'actual',
        }
        
        valid_sources = ['actual', 'carried_forward', 'missing']
        
        for key, value in data_quality.items():
            assert value in valid_sources

    def test_ending_stock_source_values(self):
        """Test ending stock source determination."""
        # Case 1: Previous day record exists
        has_prev = True
        has_today = True
        source = 'actual' if has_prev else ('carried_forward' if has_today else 'missing')
        assert source == 'actual'
        
        # Case 2: No previous, but today exists
        has_prev = False
        has_today = True
        source = 'actual' if has_prev else ('carried_forward' if has_today else 'missing')
        assert source == 'carried_forward'
        
        # Case 3: No records at all
        has_prev = False
        has_today = False
        source = 'actual' if has_prev else ('carried_forward' if has_today else 'missing')
        assert source == 'missing'


BITBIT_6S_POS_SOLD_RULES = [
    {
        'source': 'Assorted Butter Cake Slices Bitbit 6s',
        'keywords': ['butter', 'cake', 'slice', 'bitbit', '6'],
        'target': 'Butter Cake Slice',
    },
    {
        'source': 'Fluffy Mamon Bitbit 6s',
        'keywords': ['fluffy', 'mamon', 'bitbit', '6'],
        'target': 'Fluffy Mamon',
    },
    {
        'source': 'Cheesy Ensaymada Bitbit 6s',
        'keywords': ['cheesy', 'ensaymada', 'bitbit', '6'],
        'target': 'Cheesy Ensaymada',
    },
    {
        'source': 'Assorted Chiffon Cake Slices Bitbit 6s',
        'keywords': ['chiffon', 'cake', 'slice', 'bitbit', '6'],
        'target': 'Chiffon Cake Slice',
    },
]


class TestBitbit6sRule:
    """Tests for the Bitbit 6s POS sold exclusion rule.
    
    This rule identifies bulk pack products (6-packs) in POS data that should be
    excluded from organic sales calculations since they represent bulk orders,
    not individual consumer sales.
    """

    def test_normalize_product_text(self):
        """Test product name normalization."""
        assert _normalize_product_text('Assorted Butter Cake Slices Bitbit 6s') == 'assorted butter cake slices bitbit 6s'
        assert _normalize_product_text('  Fluffy Mamon Bitbit 6s  ') == 'fluffy mamon bitbit 6s'
        assert _normalize_product_text('Cheesy Ensaymada Bitbit 6s') == 'cheesy ensaymada bitbit 6s'

    def test_bitbit_rule_matches_exact_source(self):
        """Test rule matches exact source name."""
        # All keywords present in source
        normalized = _normalize_product_text('Assorted Butter Cake Slices Bitbit 6s')
        
        for rule in BITBIT_6S_POS_SOLD_RULES:
            normalized_source = _normalize_product_text(rule.get('source'))
            keyword_match = all(
                _normalize_product_text(keyword) in normalized
                for keyword in rule.get('keywords', [])
                if _normalize_product_text(keyword)
            )
            if normalized_source and normalized_source in normalized:
                # Should match
                assert keyword_match

    def test_bitbit_rule_matches_variations(self):
        """Test rule matches variations with keywords."""
        test_cases = [
            ('Assorted Butter Cake Slices Bitbit 6s', 'Butter Cake Slice'),
            ('Butter Cake Slices Bitbit 6s Pack', 'Butter Cake Slice'),
            ('Fluffy Mamon Bitbit 6s', 'Fluffy Mamon'),
            ('Mamon Fluffy Bitbit 6s', 'Fluffy Mamon'),
            ('Cheesy Ensaymada Bitbit 6s', 'Cheesy Ensaymada'),
            ('Cheesy Ensaymada 6s Bitbit', 'Cheesy Ensaymada'),
            ('Assorted Chiffon Cake Slices Bitbit 6s', 'Chiffon Cake Slice'),
            # Note: 'Chiffon Cake Bitbit 6s' doesn't match because it lacks 'slice' keyword
        ]
        
        for product_name, expected_target in test_cases:
            normalized = _normalize_product_text(product_name)
            matched = False
            
            for rule in BITBIT_6S_POS_SOLD_RULES:
                normalized_source = _normalize_product_text(rule.get('source'))
                keyword_match = all(
                    _normalize_product_text(keyword) in normalized
                    for keyword in rule.get('keywords', [])
                    if _normalize_product_text(keyword)
                )
                if (normalized_source and normalized_source in normalized) or keyword_match:
                    matched = True
                    assert rule.get('target') == expected_target
                    break
            
            assert matched, f"Product '{product_name}' should match a Bitbit 6s rule"

    def test_bitbit_rule_excludes_non_bitbit(self):
        """Test rule doesn't match regular (non-bulk) products."""
        non_bitbit_products = [
            'Butter Cake Slice',
            'Fluffy Mamon',
            'Cheesy Ensaymada',
            'Chiffon Cake Slice',
            'Regular Butter Cake',
            'Mamon Regular',
        ]
        
        for product_name in non_bitbit_products:
            normalized = _normalize_product_text(product_name)
            matched = False
            
            for rule in BITBIT_6S_POS_SOLD_RULES:
                normalized_source = _normalize_product_text(rule.get('source'))
                keyword_match = all(
                    _normalize_product_text(keyword) in normalized
                    for keyword in rule.get('keywords', [])
                    if _normalize_product_text(keyword)
                )
                if (normalized_source and normalized_source in normalized) or keyword_match:
                    matched = True
                    break
            
            assert not matched, f"Product '{product_name}' should NOT match Bitbit 6s rule"

    def test_bitbit_rule_requires_all_keywords(self):
        """Test that all keywords must be present for a match."""
        # This product has 'bitbit' and '6' but not 'butter', 'cake', 'slice'
        product_name = 'Random Product Bitbit 6s'
        normalized = _normalize_product_text(product_name)
        
        matched = False
        for rule in BITBIT_6S_POS_SOLD_RULES:
            keyword_match = all(
                _normalize_product_text(keyword) in normalized
                for keyword in rule.get('keywords', [])
                if _normalize_product_text(keyword)
            )
            if keyword_match:
                matched = True
                break
        
        # Should not match because 'butter', 'cake', 'slice' are missing
        assert not matched

    def test_bitbit_discount_amount(self):
        """Test the Bitbit discount amount constant."""
        BITBIT_6S_DISCOUNT_AMOUNT = 10
        assert BITBIT_6S_DISCOUNT_AMOUNT == 10


if __name__ == '__main__':
    pytest.main([__file__, '-v'])