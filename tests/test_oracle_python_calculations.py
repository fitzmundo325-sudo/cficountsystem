"""
Unit tests for the Python Oracle calculation engine.
"""

import pytest
import sys
import os
from datetime import date, timedelta

# Add the website directory to the path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'website'))

from oracle_calculations import (
    Product,
    InventoryData,
    OracleSettings,
    DailySuggestion,
    WeeklySuggestion,
    get_avg_day,
    get_avg_day_idx,
    get_avg_daily,
    get_sales_data_point_count,
    calc_avg_consumption,
    calc_target_sales,
    get_expected_sales,
    get_incoming_quantity,
    get_transfer,
    calculate_daily_suggestions,
    calculate_weekly_suggestions,
    get_suggested_range,
    is_outside_range,
    calculate_estimated_on_hand,
    get_delivery_day_name,
    get_min_delivery_date,
    get_max_plan_end_date,
    validate_buffer_pct,
    validate_min_order,
    build_plan_dates,
    format_plan_date,
    DAYS,
    _ceil_div,
)


class TestCeilDiv:
    """Tests for the _ceil_div helper function."""

    def test_positive_values(self):
        assert _ceil_div(10, 3) == 12  # ceil(10/3)*3 = 4*3 = 12
        assert _ceil_div(12, 3) == 12
        assert _ceil_div(13, 5) == 15
        assert _ceil_div(1, 1) == 1

    def test_zero_and_negative(self):
        assert _ceil_div(0, 5) == 0
        assert _ceil_div(-5, 3) == 0
        assert _ceil_div(-1, 1) == 0


class TestSalesDataHelpers:
    """Tests for sales data helper functions."""

    def setup_method(self):
        # Create sample sales data: product_id -> weeks[week_index][day_index]
        # 4 weeks, 7 days each
        self.sales_data = {
            1: [  # Product 1
                [10, 20, 30, 40, 50, 60, 70],  # Week 0
                [15, 25, 35, 45, 55, 65, 75],  # Week 1
                [20, 30, 40, 50, 60, 70, 80],  # Week 2
                [25, 35, 45, 55, 65, 75, 85],  # Week 3
            ],
            2: [  # Product 2
                [5, 10, 15, 20, 25, 30, 35],
                [10, 15, 20, 25, 30, 35, 40],
                [15, 20, 25, 30, 35, 40, 45],
                [20, 25, 30, 35, 40, 45, 50],
            ],
        }
        self.report_counts = [4, 4, 4, 4, 4, 4, 4]  # 4 reports per weekday

    def test_get_avg_day(self):
        # Product 1, Monday (index 1): (20+25+30+35)/4 = 27.5
        avg = get_avg_day(self.sales_data, 1, 'Monday', self.report_counts)
        assert avg == 27.5

        # Product 1, Sunday (index 0): (10+15+20+25)/4 = 17.5
        avg = get_avg_day(self.sales_data, 1, 'Sunday', self.report_counts)
        assert avg == 17.5

    def test_get_avg_day_unknown_product(self):
        avg = get_avg_day(self.sales_data, 999, 'Monday', self.report_counts)
        assert avg == 0.0

    def test_get_avg_day_zero_reports(self):
        zero_counts = [0, 0, 0, 0, 0, 0, 0]
        avg = get_avg_day(self.sales_data, 1, 'Monday', zero_counts)
        assert avg == 0.0

    def test_get_avg_day_idx(self):
        # Monday is index 1
        avg = get_avg_day_idx(self.sales_data, 1, 1, self.report_counts)
        assert avg == 27.5

    def test_get_avg_daily(self):
        # Product 1 total: sum of all 28 values / 28 reports
        avg = get_avg_daily(self.sales_data, 1, self.report_counts)
        expected = sum(sum(week) for week in self.sales_data[1]) / 28
        assert avg == expected

    def test_get_sales_data_point_count(self):
        # Product 1 has 28 non-zero data points
        count = get_sales_data_point_count(self.sales_data, 1)
        assert count == 28

        # Product with some zeros
        sales_with_zeros = {1: [[0, 10, 0, 20, 0, 30, 0]] * 4}
        count = get_sales_data_point_count(sales_with_zeros, 1)
        assert count == 12  # 3 non-zero per week * 4 weeks


class TestCalcAvgConsumption:
    """Tests for average consumption calculation."""

    def setup_method(self):
        self.product = Product(
            id=1,
            code=1001,
            name='Test Product',
            category='BREADS',
            plant_price=10.0,
            selling_price=20.0,
            buffer_pct=20.0,
            min_order=12
        )
        self.sales_data = {
            1: [[100] * 7] * 4  # 100 units every day
        }
        self.report_counts = [4] * 7
        self.settings = OracleSettings(lead_time=1, default_buffer=20.0)

    def test_basic_calculation(self):
        # avg = 100, mult = 1.0, days = 1, buffer = 0.2
        # target = ceil(100 * 1 * 1 * 1.2) = 120
        # raw = 120 - 50 - 0 + 0 = 70
        # suggested = ceil(70/12)*12 = 6*12 = 72
        suggested = calc_avg_consumption(
            self.product, 'Monday', 1.0, 50, 0, 0,
            self.sales_data, self.report_counts, self.settings
        )
        assert suggested == 72

    def test_with_transfers(self):
        suggested = calc_avg_consumption(
            self.product, 'Monday', 1.0, 50, 20, 10,
            self.sales_data, self.report_counts, self.settings
        )
        # raw = 120 - 50 - 20 + 10 = 60
        # suggested = ceil(60/12)*12 = 60
        assert suggested == 60

    def test_negative_raw_returns_zero(self):
        suggested = calc_avg_consumption(
            self.product, 'Monday', 1.0, 200, 0, 0,
            self.sales_data, self.report_counts, self.settings
        )
        # raw = 120 - 200 = -80 -> max(0, -80) = 0
        assert suggested == 0

    def test_fallback_to_daily_average(self):
        # No data for specific weekday, but overall data exists
        sales_no_monday = {
            1: [[0, 0, 100, 100, 100, 100, 100]] * 4
        }
        report_counts = [0, 0, 4, 4, 4, 4, 4]
        
        # Monday (index 1) has 0 reports, should fall back to daily average
        # daily avg = (0+0+100+100+100+100+100)*4 / 20 = 500*4/20 = 100
        suggested = calc_avg_consumption(
            self.product, 'Monday', 1.0, 50, 0, 0,
            sales_no_monday, report_counts, self.settings
        )
        assert suggested > 0  # Should use fallback

    def test_no_fallback_when_insufficient_data(self):
        # Only 1 data point total, no fallback
        sales_minimal = {1: [[0, 0, 0, 0, 0, 0, 100]]}
        report_counts = [0, 0, 0, 0, 0, 0, 1]
        
        suggested = calc_avg_consumption(
            self.product, 'Monday', 1.0, 50, 0, 0,
            sales_minimal, report_counts, self.settings
        )
        # Monday avg = 0, daily avg fallback not used (only 1 data point)
        assert suggested == 0


class TestCalcTargetSales:
    """Tests for target sales (revenue share) calculation."""

    def setup_method(self):
        self.product = Product(
            id=1,
            code=1001,
            name='Test Product',
            category='BREADS',
            plant_price=10.0,
            selling_price=20.0,
            buffer_pct=20.0,
            min_order=1
        )
        self.product2 = Product(
            id=2,
            code=1002,
            name='Product 2',
            category='ROLLS',
            plant_price=15.0,
            selling_price=30.0,
            buffer_pct=20.0,
            min_order=1
        )
        self.all_products = [self.product, self.product2]
        
        # Product 1: 100 units * $20 = $2000/day
        # Product 2: 50 units * $30 = $1500/day
        # Total: $3500/day
        self.sales_data = {
            1: [[100] * 7] * 4,
            2: [[50] * 7] * 4,
        }
        self.report_counts = [4] * 7
        self.settings = OracleSettings(lead_time=1, default_buffer=20.0)

    def test_basic_target_calculation(self):
        # Target sales = $10000
        # Product 1 share = 2000/3500 = 4/7
        # Product 1 target units = ceil(10000 * 4/7 / 20) = ceil(285.7) = 286
        # With buffer: target = ceil(286 * 1.2) = 344
        # net_ending = 50, raw = 344 - 50 = 294
        suggested = calc_target_sales(
            self.product, 1, 10000, 1.0, 50, 0, 0,
            self.sales_data, self.report_counts, self.all_products, self.settings
        )
        assert suggested == 294

    def test_zero_total_revenue(self):
        # All products have zero average
        sales_zero = {1: [[0] * 7] * 4, 2: [[0] * 7] * 4}
        suggested = calc_target_sales(
            self.product, 1, 10000, 1.0, 50, 0, 0,
            sales_zero, self.report_counts, self.all_products, self.settings
        )
        assert suggested == 0


class TestExpectedSales:
    """Tests for expected sales calculation between order and delivery."""

    def setup_method(self):
        self.sales_data = {
            1: [[100] * 7] * 4,  # 100 units/day average
        }
        self.report_counts = [4] * 7
        self.all_products = [Product(id=1, code=1, name='P1', category='CAT', plant_price=10, selling_price=20)]

    def test_single_day_gap(self):
        order_date = date(2026, 1, 15)  # Thursday
        delivery_date = date(2026, 1, 17)  # Saturday (1 day gap: Friday)
        
        # Expected: Friday only = 100 units
        expected = get_expected_sales(
            1, order_date, delivery_date,
            self.sales_data, self.report_counts, self.all_products
        )
        assert expected == 100

    def test_multi_day_gap(self):
        order_date = date(2026, 1, 15)  # Thursday
        delivery_date = date(2026, 1, 20)  # Tuesday (4 days gap: Fri, Sat, Sun, Mon)
        
        expected = get_expected_sales(
            1, order_date, delivery_date,
            self.sales_data, self.report_counts, self.all_products
        )
        assert expected == 400  # 4 days * 100

    def test_same_day_zero(self):
        order_date = date(2026, 1, 15)
        delivery_date = date(2026, 1, 15)
        
        expected = get_expected_sales(
            1, order_date, delivery_date,
            self.sales_data, self.report_counts, self.all_products
        )
        assert expected == 0

    def test_fallback_to_daily_average(self):
        # Monday has no data, but others do
        sales_no_monday = {
            1: [[0, 100, 100, 100, 100, 100, 100]] * 4
        }
        report_counts = [0, 4, 4, 4, 4, 4, 4]
        
        order_date = date(2026, 1, 11)  # Sunday
        delivery_date = date(2026, 1, 13)  # Tuesday (gap: Monday)
        
        expected = get_expected_sales(
            1, order_date, delivery_date,
            sales_no_monday, report_counts, self.all_products
        )
        # Monday uses fallback daily average
        # Daily avg = (0+100*6)*4 / 24 = 600*4/24 = 100
        assert expected == 100


class TestSuggestedRange:
    """Tests for suggested min/max range."""

    def test_basic_range(self):
        min_s, max_s = get_suggested_range(100)
        assert min_s == 80
        assert max_s == 120

    def test_zero_suggested(self):
        min_s, max_s = get_suggested_range(0)
        assert min_s == 0
        assert max_s == 0

    def test_is_outside_range(self):
        assert is_outside_range(70, 100)  # Below 80
        assert is_outside_range(130, 100)  # Above 120
        assert not is_outside_range(80, 100)  # At min boundary
        assert not is_outside_range(120, 100)  # At max boundary
        assert not is_outside_range(100, 100)  # Exact


class TestEstimatedOnHand:
    """Tests for estimated on-hand calculation."""

    def test_basic(self):
        # net_ending=50, incoming=20, trans_in=10, trans_out=5, final=100
        # = 50 + 20 + 10 - 5 + 100 = 175
        result = calculate_estimated_on_hand(50, 20, 10, 5, 100)
        assert result == 175

    def test_no_incoming_no_transfers(self):
        result = calculate_estimated_on_hand(50, 0, 0, 0, 100)
        assert result == 150


class TestDateHelpers:
    """Tests for date helper functions."""

    def test_get_delivery_day_name(self):
        assert get_delivery_day_name(date(2026, 1, 12)) == 'Monday'  # Monday
        assert get_delivery_day_name(date(2026, 1, 18)) == 'Sunday'  # Sunday

    def test_get_min_delivery_date(self):
        order_date = date(2026, 1, 15)
        min_del = get_min_delivery_date(order_date)
        assert min_del == date(2026, 1, 17)  # +2 days

    def test_get_max_plan_end_date(self):
        start = date(2026, 1, 17)
        max_end = get_max_plan_end_date(start)
        assert max_end == date(2026, 1, 23)  # +6 days

    def test_build_plan_dates(self):
        start = date(2026, 1, 17)
        end = date(2026, 1, 20)
        dates = build_plan_dates(start, end)
        assert len(dates) == 4
        assert dates == [
            date(2026, 1, 17),
            date(2026, 1, 18),
            date(2026, 1, 19),
            date(2026, 1, 20),
        ]

    def test_build_plan_dates_max_7(self):
        start = date(2026, 1, 17)
        end = date(2026, 1, 30)  # 14 days
        dates = build_plan_dates(start, end)
        assert len(dates) == 7  # Capped at 7

    def test_format_plan_date(self):
        d = date(2026, 1, 15)
        formatted = format_plan_date(d)
        assert 'Jan' in formatted
        assert '15' in formatted


class TestValidation:
    """Tests for validation functions."""

    def test_validate_buffer_pct(self):
        assert validate_buffer_pct(-10) == 0
        assert validate_buffer_pct(0) == 0
        assert validate_buffer_pct(50) == 50
        assert validate_buffer_pct(150) == 150
        assert validate_buffer_pct(200) == 200
        assert validate_buffer_pct(250) == 200  # Clamped

    def test_validate_min_order(self):
        assert validate_min_order(0) == 1
        assert validate_min_order(1) == 1
        assert validate_min_order(12) == 12
        assert validate_min_order(-5) == 1


class TestWeeklySuggestions:
    """Tests for weekly suggestion calculation."""

    def setup_method(self):
        self.product = Product(
            id=1,
            code=1001,
            name='Test Product',
            category='BREADS',
            plant_price=10.0,
            selling_price=20.0,
            buffer_pct=20.0,
            min_order=1
        )
        self.sales_data = {
            1: [[100] * 7] * 4,
        }
        self.report_counts = [4] * 7
        self.invensync_data = {
            '1': InventoryData(ending_stock=500, delivery=0, trans_in=0, trans_out=0)
        }
        self.incoming_orders = {}
        self.all_products = [self.product]
        self.settings = OracleSettings(lead_time=1, default_buffer=20.0)
        self.final_quantities = {}

    def test_weekly_suggestion_projection(self):
        order_date = date(2026, 1, 15)
        delivery_dates = [date(2026, 1, 17), date(2026, 1, 18), date(2026, 1, 19)]
        
        result = calculate_weekly_suggestions(
            self.product, order_date, delivery_dates, 1.0, None,
            self.sales_data, self.report_counts,
            self.invensync_data, self.incoming_orders,
            self.all_products, self.settings, self.final_quantities
        )
        
        # Day 1 (Jan 17): stock=500, exp=100 (Fri), net=400, target=120, suggested=0, projected=400
        # Day 2 (Jan 18): projected=400, exp=200 (Fri+Sat), net=200, target=120, suggested=0, projected=200
        # Day 3 (Jan 19): projected=200, exp=300 (Fri+Sat+Sun), net=0, target=120, suggested=120, projected=120
        assert result.daily_suggestions[0].suggested == 0
        assert result.daily_suggestions[1].suggested == 0
        assert result.daily_suggestions[2].suggested == 120
        assert result.total_suggested == 120
        assert len(result.daily_suggestions) == 3

    def test_weekly_suggestion_with_reorder(self):
        # Low stock triggers reorder
        self.invensync_data = {'1': InventoryData(ending_stock=150)}
        
        order_date = date(2026, 1, 15)
        delivery_dates = [date(2026, 1, 17), date(2026, 1, 18), date(2026, 1, 19)]
        
        result = calculate_weekly_suggestions(
            self.product, order_date, delivery_dates, 1.0, None,
            self.sales_data, self.report_counts,
            self.invensync_data, self.incoming_orders,
            self.all_products, self.settings, self.final_quantities
        )
        
        # Day 1: stock=150, exp=100, net=50, target=120, suggested=70, projected=120
        # Day 2: stock=150, exp=200, net=0, target=120, suggested=120, projected=120
        # Day 3: stock=150, exp=300, net=0, target=120, suggested=120, projected=120
        assert result.daily_suggestions[0].suggested == 70
        assert result.daily_suggestions[1].suggested == 120
        assert result.daily_suggestions[2].suggested == 120

    def test_weekly_suggestion_with_final_override(self):
        self.invensync_data = {'1': InventoryData(ending_stock=500)}
        self.final_quantities = {
            '1|2026-01-17': 50,
            '1|2026-01-18': 60,
        }
        
        order_date = date(2026, 1, 15)
        delivery_dates = [date(2026, 1, 17), date(2026, 1, 18), date(2026, 1, 19)]
        
        result = calculate_weekly_suggestions(
            self.product, order_date, delivery_dates, 1.0, None,
            self.sales_data, self.report_counts,
            self.invensync_data, self.incoming_orders,
            self.all_products, self.settings, self.final_quantities
        )
        
        # Day 1: suggested=0, override=50
        # Day 2: suggested=0, override=60
        # Day 3: suggested=110 (because projected stock after overrides: 500-100+50=450, 450-200+60=310, 310-300=10, target=120, suggested=110)
        assert result.daily_suggestions[0].suggested == 0  # Original suggestion
        assert result.total_final == 50 + 60 + 110  # Override + override + calculated


class TestIncomingAndTransfers:
    """Tests for incoming orders and transfer helpers."""

    def test_get_incoming_quantity(self):
        incoming = {
            '1': {'2026-01-17': 50, '2026-01-18': 30},
            '2': {'2026-01-17': 20}
        }
        assert get_incoming_quantity(incoming, 1, date(2026, 1, 17)) == 50
        assert get_incoming_quantity(incoming, 1, date(2026, 1, 18)) == 30
        assert get_incoming_quantity(incoming, 2, date(2026, 1, 17)) == 20
        assert get_incoming_quantity(incoming, 1, date(2026, 1, 19)) == 0
        assert get_incoming_quantity(incoming, 999, date(2026, 1, 17)) == 0

    def test_get_transfer(self):
        invensync = {
            '1': InventoryData(trans_in=10, trans_out=5),
            '2': InventoryData(trans_in=0, trans_out=0)
        }
        assert get_transfer(invensync, 1, 'in') == 10
        assert get_transfer(invensync, 1, 'out') == 5
        assert get_transfer(invensync, 2, 'in') == 0
        assert get_transfer(invensync, 999, 'in') == 0


class TestCalcTargetSalesEdgeCases:
    """Tests for target sales calculation edge cases."""

    def setup_method(self):
        self.product = Product(
            id=1,
            code=1001,
            name='Test Product',
            category='BREADS',
            plant_price=10.0,
            selling_price=20.0,
            buffer_pct=20.0,
            min_order=1
        )
        self.product2 = Product(
            id=2,
            code=1002,
            name='Product 2',
            category='ROLLS',
            plant_price=15.0,
            selling_price=30.0,
            buffer_pct=20.0,
            min_order=1
        )
        self.all_products = [self.product, self.product2]
        self.report_counts = [4] * 7
        self.settings = OracleSettings(lead_time=1, default_buffer=20.0)

    def test_zero_selling_price(self):
        """Test target sales when product has zero selling price."""
        product_zero_price = Product(
            id=3,
            code=1003,
            name='Free Product',
            category='BREADS',
            plant_price=5.0,
            selling_price=0.0,
            buffer_pct=20.0,
            min_order=1
        )
        all_products = [self.product, self.product2, product_zero_price]
        sales_data = {
            1: [[100] * 7] * 4,
            2: [[50] * 7] * 4,
            3: [[10] * 7] * 4,
        }
        # Should handle zero price gracefully (return 0)
        suggested = calc_target_sales(
            product_zero_price, 1, 10000, 1.0, 50, 0, 0,
            sales_data, self.report_counts, all_products, self.settings
        )
        assert suggested == 0

    def test_single_product_all_revenue(self):
        """Test when only one product has revenue."""
        sales_single = {1: [[100] * 7] * 4, 2: [[0] * 7] * 4}
        suggested = calc_target_sales(
            self.product, 1, 10000, 1.0, 50, 0, 0,
            sales_single, self.report_counts, self.all_products, self.settings
        )
        # Product 1 gets 100% of target
        # target units = 10000 / 20 = 500
        # with buffer: ceil(500 * 1.2) = 600
        # raw = 600 - 50 = 550
        assert suggested == 550

    def test_high_buffer_percentage(self):
        """Test with high buffer percentage (e.g., 100%)."""
        high_buffer_product = Product(
            id=1,
            code=1001,
            name='Test Product',
            category='BREADS',
            plant_price=10.0,
            selling_price=20.0,
            buffer_pct=100.0,  # 100% buffer
            min_order=1
        )
        sales_data = {1: [[100] * 7] * 4}
        suggested = calc_target_sales(
            high_buffer_product, 1, 10000, 1.0, 50, 0, 0,
            sales_data, self.report_counts, [high_buffer_product], self.settings
        )
        # target units = 500, with 100% buffer: 500 * 2 = 1000
        # raw = 1000 - 50 = 950
        assert suggested == 950


class TestCalculateWeeklySuggestionsEdgeCases:
    """Tests for weekly suggestions edge cases."""

    def setup_method(self):
        self.product = Product(
            id=1,
            code=1001,
            name='Test Product',
            category='BREADS',
            plant_price=10.0,
            selling_price=20.0,
            buffer_pct=20.0,
            min_order=1
        )
        self.sales_data = {1: [[100] * 7] * 4}
        self.report_counts = [4] * 7
        self.invensync_data = {'1': InventoryData(ending_stock=500, delivery=0, trans_in=0, trans_out=0)}
        self.incoming_orders = {}
        self.all_products = [self.product]
        self.settings = OracleSettings(lead_time=1, default_buffer=20.0)
        self.final_quantities = {}

    def test_delivery_dates_month_boundary(self):
        """Test weekly suggestions across month boundary."""
        order_date = date(2026, 1, 28)  # End of January
        delivery_dates = [date(2026, 2, 1), date(2026, 2, 2), date(2026, 2, 3)]  # Start of February
        
        result = calculate_weekly_suggestions(
            self.product, order_date, delivery_dates, 1.0, None,
            self.sales_data, self.report_counts,
            self.invensync_data, self.incoming_orders,
            self.all_products, self.settings, self.final_quantities
        )
        assert len(result.daily_suggestions) == 3

    def test_with_incoming_orders(self):
        """Test weekly suggestions with incoming orders from previous Oracle submissions."""
        self.incoming_orders = {
            '1': {'2026-01-17': 30, '2026-01-18': 20}
        }
        order_date = date(2026, 1, 15)
        delivery_dates = [date(2026, 1, 17), date(2026, 1, 18), date(2026, 1, 19)]
        
        result = calculate_weekly_suggestions(
            self.product, order_date, delivery_dates, 1.0, None,
            self.sales_data, self.report_counts,
            self.invensync_data, self.incoming_orders,
            self.all_products, self.settings, self.final_quantities
        )
        # Day 1: incoming=30, so suggested should be lower
        assert result.daily_suggestions[0].incoming == 30
        assert result.daily_suggestions[1].incoming == 20

    def test_zero_min_order_handling(self):
        """Test that min_order of 0 is treated as 1."""
        product_zero_min = Product(
            id=1,
            code=1001,
            name='Test Product',
            category='BREADS',
            plant_price=10.0,
            selling_price=20.0,
            buffer_pct=20.0,
            min_order=0  # Should be treated as 1
        )
        order_date = date(2026, 1, 15)
        delivery_dates = [date(2026, 1, 17)]
        
        result = calculate_weekly_suggestions(
            product_zero_min, order_date, delivery_dates, 1.0, None,
            self.sales_data, self.report_counts,
            self.invensync_data, self.incoming_orders,
            [product_zero_min], self.settings, self.final_quantities
        )
        # Should work without division by zero
        assert result.daily_suggestions[0].suggested >= 0


class TestGetExpectedSalesEdgeCases:
    """Tests for expected sales edge cases."""

    def setup_method(self):
        self.sales_data = {1: [[100] * 7] * 4}
        self.report_counts = [4] * 7
        self.all_products = [Product(id=1, code=1, name='P1', category='CAT', plant_price=10, selling_price=20)]

    def test_order_after_delivery(self):
        """Test when order date is after delivery date (should return 0)."""
        order_date = date(2026, 1, 20)
        delivery_date = date(2026, 1, 15)
        
        expected = get_expected_sales(
            1, order_date, delivery_date,
            self.sales_data, self.report_counts, self.all_products
        )
        assert expected == 0

    def test_weekend_only_gap(self):
        """Test gap that only includes weekends."""
        order_date = date(2026, 1, 16)  # Friday
        delivery_date = date(2026, 1, 19)  # Monday (gap: Sat, Sun)
        
        expected = get_expected_sales(
            1, order_date, delivery_date,
            self.sales_data, self.report_counts, self.all_products
        )
        # Saturday + Sunday = 200
        assert expected == 200


if __name__ == '__main__':
    pytest.main([__file__, '-v'])