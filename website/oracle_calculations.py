"""
Oracle Calculation Engine - Python implementation of order suggestion logic.
This module mirrors the JavaScript calculations in oracle_handles.js
to provide a single source of truth for backend and frontend.
"""

from dataclasses import dataclass
from datetime import date, timedelta
from typing import Dict, List, Optional, Tuple
from math import ceil


@dataclass
class Product:
    """Product data for Oracle calculations."""
    id: int
    code: Optional[int]
    name: str
    category: str
    unit: str = 'pc'
    plant_price: float = 0.0
    selling_price: float = 0.0
    buffer_pct: float = 20.0
    min_order: int = 1


@dataclass
class InventoryData:
    """Inventory data for a product."""
    ending_stock: int = 0
    delivery: int = 0
    trans_in: int = 0
    trans_out: int = 0
    data_quality: Optional[Dict[str, str]] = None


@dataclass
class SalesDataPoint:
    """Sales data for a specific product/week/day."""
    quantity: int = 0


@dataclass
class OracleSettings:
    """Oracle calculation settings."""
    lead_time: int = 1
    default_buffer: float = 20.0
    min_order_override: Optional[int] = None


def get_global_oracle_config() -> OracleSettings:
    """Load global Oracle settings from database (or return defaults)."""
    try:
        from .models import GlobalOracleConfig, db
        config = GlobalOracleConfig.query.first()
        if config:
            return OracleSettings(
                lead_time=config.lead_time or 1,
                default_buffer=config.default_buffer_pct or 20.0,
                min_order_override=config.min_order_override
            )
    except Exception:
        pass
    return OracleSettings()


# Day name constants (matching JS)
# Python weekday: 0=Monday, 1=Tuesday, ..., 6=Sunday
# JS DAYS array: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
# So we need to map Python weekday to JS index: (weekday + 1) % 7
DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
DAYS_DISPLAY = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
DISP_TO_JS = [1, 2, 3, 4, 5, 6, 0]  # Display index -> JS index


def _ceil_div(value: float, divisor: int) -> int:
    """Ceiling division that handles negative values correctly."""
    if value <= 0:
        return 0
    return int(ceil(value / divisor)) * divisor


def get_avg_day(
    sales_data: Dict[int, List[List[int]]],
    product_id: int,
    day_name: str,
    report_counts: List[int]
) -> float:
    """
    Calculate average daily sales for a specific weekday.
    
    Args:
        sales_data: Dict of product_id -> List[weeks][days]
        product_id: Product ID
        day_name: Day name (e.g., 'Monday')
        report_counts: Number of reports per weekday (for divisor)
    
    Returns:
        Average daily sales for that weekday
    """
    try:
        day_idx = DAYS.index(day_name)
    except ValueError:
        return 0.0
    
    product_weeks = sales_data.get(product_id, [])
    if not product_weeks:
        return 0.0
    
    report_count = report_counts[day_idx] if day_idx < len(report_counts) else 0
    if report_count == 0:
        return 0.0
    
    total = sum(
        week[day_idx] if day_idx < len(week) else 0
        for week in product_weeks
    )
    return total / report_count


def get_avg_day_idx(
    sales_data: Dict[int, List[List[int]]],
    product_id: int,
    day_idx: int,
    report_counts: List[int]
) -> float:
    """Calculate average daily sales by day index (0=Sunday, 6=Saturday)."""
    product_weeks = sales_data.get(product_id, [])
    if not product_weeks:
        return 0.0
    
    report_count = report_counts[day_idx] if day_idx < len(report_counts) else 0
    if report_count == 0:
        return 0.0
    
    total = sum(
        week[day_idx] if day_idx < len(week) else 0
        for week in product_weeks
    )
    return total / report_count


def get_avg_daily(
    sales_data: Dict[int, List[List[int]]],
    product_id: int,
    report_counts: List[int]
) -> float:
    """Calculate overall average daily sales across all days."""
    product_weeks = sales_data.get(product_id, [])
    if not product_weeks:
        return 0.0
    
    total = 0
    for week in product_weeks:
        for day_idx, qty in enumerate(week):
            total += qty
    
    total_reports = sum(report_counts)
    if total_reports == 0:
        return 0.0
    return total / total_reports


def get_sales_data_point_count(
    sales_data: Dict[int, List[List[int]]],
    product_id: int
) -> int:
    """Count number of non-zero sales data points for a product."""
    product_weeks = sales_data.get(product_id, [])
    if not product_weeks:
        return 0
    
    count = 0
    for week in product_weeks:
        for qty in week:
            if qty > 0:
                count += 1
    return count


def calc_avg_consumption(
    product: Product,
    day_name: str,
    multiplier: float,
    net_ending: int,
    trans_in: int,
    trans_out: int,
    sales_data: Dict[int, List[List[int]]],
    report_counts: List[int],
    settings: OracleSettings
) -> int:
    """
    Calculate suggested order quantity using average consumption method.
    
    Formula:
        target = ceil(avg_daily * multiplier * lead_time * (1 + buffer))
        raw = target - net_ending - trans_in + trans_out
        suggested = ceil(max(0, raw) / min_order) * min_order
    
    Args:
        product: Product data
        day_name: Delivery day name
        multiplier: Forecast multiplier (e.g., 1.25 for payday)
        net_ending: Current stock minus expected sales
        trans_in: Transfer in quantity
        trans_out: Transfer out quantity
        sales_data: Historical sales data
        report_counts: Number of reports per weekday
        settings: Oracle settings (lead_time, default_buffer)
    
    Returns:
        Suggested order quantity (rounded to min_order)
    """
    avg = get_avg_day(sales_data, product.id, day_name, report_counts)
    
    # Check if we have enough data points for reliable average
    can_use_fallback = get_sales_data_point_count(sales_data, product.id) > 1
    
    if avg <= 0 and can_use_fallback:
        avg = get_avg_daily(sales_data, product.id, report_counts)
    
    buffer = product.buffer_pct / 100.0
    days = settings.lead_time
    
    target = ceil(avg * multiplier * days * (1 + buffer))
    raw = target - net_ending - trans_in + trans_out
    
    return _ceil_div(max(0, raw), product.min_order)


def calc_target_sales(
    product: Product,
    day_idx: int,
    target_sales: float,
    multiplier: float,
    net_ending: int,
    trans_in: int,
    trans_out: int,
    sales_data: Dict[int, List[List[int]]],
    report_counts: List[int],
    all_products: List[Product],
    settings: OracleSettings
) -> int:
    """
    Calculate suggested order quantity using target sales (revenue share) method.
    
    Formula:
        product_avg_revenue = avg_daily_units * selling_price
        total_revenue = sum of all products' avg_revenue
        share = product_avg_revenue / total_revenue
        qty = ceil(target_sales * share / selling_price)
        target = ceil(qty * multiplier * (1 + buffer))
        raw = target - net_ending - trans_in + trans_out
        suggested = ceil(max(0, raw) / min_order) * min_order
    
    Args:
        product: Product data
        day_idx: Delivery day index (0=Sunday)
        target_sales: Target sales amount for the day
        multiplier: Forecast multiplier
        net_ending: Current stock minus expected sales
        trans_in: Transfer in quantity
        trans_out: Transfer out quantity
        sales_data: Historical sales data
        report_counts: Number of reports per weekday
        all_products: All products for revenue calculation
        settings: Oracle settings
    
    Returns:
        Suggested order quantity
    """
    product_avg_units = get_avg_day_idx(sales_data, product.id, day_idx, report_counts)
    product_avg_revenue = product_avg_units * product.selling_price
    
    total_revenue = sum(
        get_avg_day_idx(sales_data, p.id, day_idx, report_counts) * p.selling_price
        for p in all_products
    )
    
    if total_revenue <= 0:
        return 0
    
    share = product_avg_revenue / total_revenue
    qty = ceil(target_sales * share / product.selling_price) if product.selling_price > 0 else 0
    
    buffer = product.buffer_pct / 100.0
    target = ceil(qty * multiplier * (1 + buffer))
    raw = target - net_ending - trans_in + trans_out
    
    return _ceil_div(max(0, raw), product.min_order)


def get_expected_sales(
    product_id: int,
    order_date: date,
    delivery_date: date,
    sales_data: Dict[int, List[List[int]]],
    report_counts: List[int],
    all_products: List[Product]
) -> int:
    """
    Calculate expected sales between order date and delivery date.
    
    For each day in the range, use the weekday average.
    Falls back to overall average if specific weekday has no data.
    """
    if not order_date or not delivery_date:
        return 0
    
    can_use_fallback = get_sales_data_point_count(sales_data, product_id) > 1
    total = 0
    current = order_date + timedelta(days=1)
    end = delivery_date
    safety = 0
    
    while current < end and safety < 60:
        day_name = DAYS[current.weekday()]
        weekday_avg = get_avg_day(sales_data, product_id, day_name, report_counts)
        total += weekday_avg if weekday_avg > 0 else (get_avg_daily(sales_data, product_id, report_counts) if can_use_fallback else 0)
        current += timedelta(days=1)
        safety += 1
    
    return int(round(total))


def get_incoming_quantity(
    incoming_orders: Dict[str, Dict[str, int]],
    product_id: int,
    delivery_date: date
) -> int:
    """Get incoming order quantity for a product on a specific delivery date."""
    key = str(product_id)
    date_key = delivery_date.isoformat()
    return incoming_orders.get(key, {}).get(date_key, 0)


def get_transfer(
    invensync_data: Dict[str, InventoryData],
    product_id: int,
    transfer_type: str  # 'in' or 'out'
) -> int:
    """Get transfer in/out quantity from InvenSync data."""
    inv = invensync_data.get(str(product_id))
    if not inv:
        return 0
    return inv.trans_in if transfer_type == 'in' else inv.trans_out


@dataclass
class DailySuggestion:
    """Suggested order for a single day."""
    date: date
    suggested: int
    min_suggested: int
    max_suggested: int
    average: float
    net_ending: int
    incoming: int
    trans_in: int
    trans_out: int
    expected_sales: int


def calculate_daily_suggestions(
    product: Product,
    order_date: date,
    delivery_date: date,
    multiplier: float,
    target_sales: Optional[float],
    sales_data: Dict[int, List[List[int]]],
    report_counts: List[int],
    invensync_data: Dict[str, InventoryData],
    incoming_orders: Dict[str, Dict[str, int]],
    all_products: List[Product],
    settings: OracleSettings
) -> DailySuggestion:
    """Calculate suggested order for a single product on a single delivery day."""
    
    # Current stock from InvenSync
    stock = invensync_data.get(str(product.id), InventoryData()).ending_stock
    
    # Expected sales between order and delivery
    expected = get_expected_sales(
        product.id, order_date, delivery_date,
        sales_data, report_counts, all_products
    )
    
    # Net ending (stock after expected sales)
    net_ending = max(0, stock - expected)
    
    # Incoming from previously submitted Oracle orders
    incoming = get_incoming_quantity(incoming_orders, product.id, delivery_date)
    
    # Transfers
    trans_in = get_transfer(invensync_data, product.id, 'in')
    trans_out = get_transfer(invensync_data, product.id, 'out')
    
    # Calculate suggestion
    if target_sales and target_sales > 0:
        day_idx = delivery_date.weekday()
        suggested = calc_target_sales(
            product, day_idx, target_sales, multiplier,
            net_ending, trans_in, trans_out,
            sales_data, report_counts, all_products, settings
        )
    else:
        day_name = DAYS[delivery_date.weekday()]
        suggested = calc_avg_consumption(
            product, day_name, multiplier,
            net_ending, trans_in, trans_out,
            sales_data, report_counts, settings
        )
    
    min_suggested = max(0, int(suggested * 0.8))
    max_suggested = ceil(suggested * 1.2)
    
    return DailySuggestion(
        date=delivery_date,
        suggested=suggested,
        min_suggested=min_suggested,
        max_suggested=max_suggested,
        average=0.0,  # Will be set by caller
        net_ending=net_ending,
        incoming=incoming,
        trans_in=trans_in,
        trans_out=trans_out,
        expected_sales=expected
    )


@dataclass
class WeeklySuggestion:
    """Weekly order plan for a product."""
    product: Product
    daily_suggestions: List[DailySuggestion]
    total_suggested: int
    total_final: int = 0
    total_cost: float = 0.0


def calculate_weekly_suggestions(
    product: Product,
    order_date: date,
    delivery_dates: List[date],
    multiplier: float,
    target_sales: Optional[float],
    sales_data: Dict[int, List[List[int]]],
    report_counts: List[int],
    invensync_data: Dict[str, InventoryData],
    incoming_orders: Dict[str, Dict[str, int]],
    all_products: List[Product],
    settings: OracleSettings,
    final_quantities: Dict[str, int]  # key: "product_id|date"
) -> WeeklySuggestion:
    """Calculate weekly order plan for a product across multiple delivery days."""
    
    daily_suggestions = []
    projected_stock = invensync_data.get(str(product.id), InventoryData()).ending_stock
    
    for i, delivery_date in enumerate(delivery_dates):
        # Expected sales from order date to this delivery date
        expected = get_expected_sales(
            product.id, order_date, delivery_date,
            sales_data, report_counts, all_products
        )
        
        # For subsequent days, use projected stock from previous day
        if i == 0:
            net_ending = max(0, projected_stock - expected)
        else:
            net_ending = max(0, projected_stock - expected)
        
        # Transfers only on first day
        trans_in = get_transfer(invensync_data, product.id, 'in') if i == 0 else 0
        trans_out = get_transfer(invensync_data, product.id, 'out') if i == 0 else 0
        
        # Incoming from previous Oracle orders
        incoming = get_incoming_quantity(incoming_orders, product.id, delivery_date)
        
        if target_sales and target_sales > 0:
            day_idx = delivery_date.weekday()
            suggested = calc_target_sales(
                product, day_idx, target_sales, multiplier,
                net_ending, trans_in, trans_out,
                sales_data, report_counts, all_products, settings
            )
        else:
            day_name = DAYS[delivery_date.weekday()]
            suggested = calc_avg_consumption(
                product, day_name, multiplier,
                net_ending, trans_in, trans_out,
                sales_data, report_counts, settings
            )
        
        # Check for manual override
        key = f"{product.id}|{delivery_date.isoformat()}"
        final_qty = final_quantities.get(key, suggested)
        
        min_suggested = max(0, int(suggested * 0.8))
        max_suggested = ceil(suggested * 1.2)
        
        daily_suggestions.append(DailySuggestion(
            date=delivery_date,
            suggested=suggested,
            min_suggested=min_suggested,
            max_suggested=max_suggested,
            average=suggested,  # Approximation
            net_ending=net_ending,
            incoming=incoming,
            trans_in=trans_in,
            trans_out=trans_out,
            expected_sales=expected
        ))
        
        projected_stock = net_ending + final_qty
    
    total_suggested = sum(d.suggested for d in daily_suggestions)
    total_final = sum(final_quantities.get(f"{product.id}|{d.date.isoformat()}", d.suggested) for d in daily_suggestions)
    total_cost = total_final * product.plant_price
    
    return WeeklySuggestion(
        product=product,
        daily_suggestions=daily_suggestions,
        total_suggested=total_suggested,
        total_final=total_final,
        total_cost=total_cost
    )


def get_suggested_range(suggested: int) -> Tuple[int, int]:
    """Get min/max suggested range (±20%)."""
    min_s = max(0, int(suggested * 0.8))
    max_s = ceil(suggested * 1.2)
    return (min_s, max_s)


def is_outside_range(final_qty: int, suggested: int) -> bool:
    """Check if final quantity is outside ±20% range."""
    min_s, max_s = get_suggested_range(suggested)
    return final_qty < min_s or final_qty > max_s


def calculate_estimated_on_hand(
    net_ending: int,
    incoming: int,
    trans_in: int,
    trans_out: int,
    final_order: int
) -> int:
    """Calculate estimated on-hand after delivery."""
    return net_ending + incoming + trans_in - trans_out + final_order


def get_delivery_day_name(delivery_date: date) -> str:
    """Get day name for delivery date (matches JS DAYS array)."""
    # Python weekday: 0=Mon, JS DAYS[1]=Monday, so index = (weekday + 1) % 7
    js_index = (delivery_date.weekday() + 1) % 7
    return DAYS[js_index]


def get_min_delivery_date(order_date: date) -> date:
    """Minimum delivery date is order date + 2 days."""
    return order_date + timedelta(days=2)


def get_max_plan_end_date(delivery_start: date) -> date:
    """Maximum plan end is delivery start + 6 days (7 days total)."""
    return delivery_start + timedelta(days=6)


def validate_buffer_pct(buffer_pct: float) -> float:
    """Validate and clamp buffer percentage to 0-200."""
    return max(0.0, min(200.0, float(buffer_pct)))


def validate_min_order(min_order: int) -> int:
    """Validate minimum order quantity (at least 1)."""
    return max(1, int(min_order))


def build_plan_dates(delivery_start: date, delivery_end: date) -> List[date]:
    """Build list of delivery dates from start to end (max 7 days)."""
    dates = []
    current = delivery_start
    end = delivery_end
    while current <= end and len(dates) < 7:
        dates.append(current)
        current += timedelta(days=1)
    return dates


def format_plan_date(d: date) -> str:
    """Format date for display (e.g., 'Mon Jan 15')."""
    return d.strftime('%a %b %d')