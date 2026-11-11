#!/usr/bin/env python
"""Add sample Oracle order for testing."""
import os
import sys
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from website import create_app, db
from website.models import OracleOrder, Store, ProductMaster, User

app = create_app()

with app.app_context():
    # Get first available store
    store = Store.query.first()
    if not store:
        print("No stores found!")
        sys.exit(1)
    print(f"Using store: {store.name} (ID: {store.id})")

    # Get first available product
    product = ProductMaster.query.first()
    if not product:
        print("No products found!")
        sys.exit(1)
    print(f"Using product: {product.description} (ID: {product.id})")

    # Get first user (for created_by)
    user = User.query.first()
    if not user:
        print("No users found!")
        sys.exit(1)
    print(f"Using user: {user.username} (ID: {user.id})")

    # Create sample order for tomorrow delivery
    delivery_date = date.today() + timedelta(days=1)
    order_date = date.today()

    existing = OracleOrder.query.filter_by(
        store_id=store.id,
        product_id=product.id,
        delivery_date=delivery_date,
        order_date=order_date
    ).first()

    if existing:
        print(f"Sample order already exists: ID {existing.id}")
    else:
        order = OracleOrder(
            store_id=store.id,
            product_id=product.id,
            order_date=order_date,
            delivery_date=delivery_date,
            quantity=10,
            suggested_qty=10,
            min_suggested_qty=5,
            max_suggested_qty=15,
            status='pending',
            created_by=user.id,
        )
        db.session.add(order)
        db.session.commit()
        print(f"Created sample Oracle order: ID {order.id}")
        print(f"  Store: {store.name}")
        print(f"  Product: {product.description}")
        print(f"  Order Date: {order_date}")
        print(f"  Delivery Date: {delivery_date}")
        print(f"  Quantity: 10 (pending)")
        print(f"  Created by: {user.username}")