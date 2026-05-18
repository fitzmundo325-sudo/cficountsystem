import os
from pathlib import Path
from re import A
from flask import Flask
from flask_sqlalchemy import SQLAlchemy
from flask_login import LoginManager, current_user
from sqlalchemy import text, func

db = SQLAlchemy()

DB_NAME = "database.db"


def _load_local_env():
    env_path = Path(__file__).resolve().parent.parent / '.env'
    if not env_path.exists():
        return

    for raw_line in env_path.read_text(encoding='utf-8').splitlines():
        line = raw_line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue

        key, value = line.split('=', 1)
        key = key.strip()
        if not key:
            continue

        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


def _ensure_pos_sold_columns():
    with db.engine.connect() as conn:
        existing_columns = {
            row[1]
            for row in conn.execute(text("PRAGMA table_info('pos_sold')")).fetchall()
        }

        if 'gross_sales' not in existing_columns:
            conn.execute(text("ALTER TABLE pos_sold ADD COLUMN gross_sales FLOAT NOT NULL DEFAULT 0"))
        if 'discount' not in existing_columns:
            conn.execute(text("ALTER TABLE pos_sold ADD COLUMN discount FLOAT NOT NULL DEFAULT 0"))
        if 'z_reading_image_path' not in existing_columns:
            conn.execute(text("ALTER TABLE pos_sold ADD COLUMN z_reading_image_path VARCHAR(500)"))
        conn.commit()


def _ensure_store_group_column():
    with db.engine.connect() as conn:
        existing_columns = {
            row[1]
            for row in conn.execute(text("PRAGMA table_info('store')")).fetchall()
        }

        if 'store_group' not in existing_columns:
            conn.execute(
                text("ALTER TABLE store ADD COLUMN store_group VARCHAR(20) NOT NULL DEFAULT 'premium'")
            )
        conn.commit()


def _ensure_user_assigned_store_column():
    with db.engine.connect() as conn:
        existing_columns = {
            row[1]
            for row in conn.execute(text("PRAGMA table_info('user')")).fetchall()
        }

        if 'assigned_store_id' not in existing_columns:
            conn.execute(text("ALTER TABLE user ADD COLUMN assigned_store_id INTEGER"))
        conn.commit()


def _backfill_store_group_values():
    from .models import Store

    stores = Store.query.all()
    has_changes = False
    for store in stores:
        # Only auto-assign store_group if it's NULL or empty
        # This preserves manually set pricing tiers (premium/non_premium)
        if not store.store_group or store.store_group.strip() == '':
            store.store_group = Store.determine_store_group(store.name)
            has_changes = True

    if has_changes:
        db.session.commit()


def _ensure_product_master_sp_np_column():
    with db.engine.connect() as conn:
        existing_columns = {
            row[1]
            for row in conn.execute(text("PRAGMA table_info('product_master')")).fetchall()
        }

        if 'sp_np' not in existing_columns and 'sp_t' in existing_columns:
            try:
                conn.execute(text("ALTER TABLE product_master RENAME COLUMN sp_t TO sp_np"))
            except Exception:
                conn.execute(text("ALTER TABLE product_master ADD COLUMN sp_np FLOAT"))
                conn.execute(text("UPDATE product_master SET sp_np = sp_t WHERE sp_np IS NULL"))
        elif 'sp_np' not in existing_columns:
            conn.execute(text("ALTER TABLE product_master ADD COLUMN sp_np FLOAT"))

        # Backward-compatible schema sync for older product_master tables.
        # These columns exist in the SQLAlchemy model and are required by admin pages.
        existing_columns = {
            row[1]
            for row in conn.execute(text("PRAGMA table_info('product_master')")).fetchall()
        }
        missing_column_statements = {
            'sub_category': "ALTER TABLE product_master ADD COLUMN sub_category VARCHAR(100)",
            'tp': "ALTER TABLE product_master ADD COLUMN tp FLOAT",
            'sp_p': "ALTER TABLE product_master ADD COLUMN sp_p FLOAT",
            'shelf_life': "ALTER TABLE product_master ADD COLUMN shelf_life VARCHAR(100)",
            'created_at': "ALTER TABLE product_master ADD COLUMN created_at DATETIME",
            'updated_at': "ALTER TABLE product_master ADD COLUMN updated_at DATETIME",
        }
        for column_name, statement in missing_column_statements.items():
            if column_name not in existing_columns:
                conn.execute(text(statement))

        conn.commit()


def _ensure_rso_delivery_columns():
    with db.engine.connect() as conn:
        existing_columns = {
            row[1]
            for row in conn.execute(text("PRAGMA table_info('rso_delivery')")).fetchall()
        }

        if 'rso_no' not in existing_columns:
            conn.execute(text("ALTER TABLE rso_delivery ADD COLUMN rso_no VARCHAR(255)"))
        if 'delivery_reviewed_date' not in existing_columns:
            conn.execute(text("ALTER TABLE rso_delivery ADD COLUMN delivery_reviewed_date DATE"))
        conn.commit()


def _ensure_taf_transfer_columns():
    with db.engine.connect() as conn:
        existing_columns = {
            row[1]
            for row in conn.execute(text("PRAGMA table_info('taf_transfer')")).fetchall()
        }

        if 'status' not in existing_columns:
            conn.execute(
                text("ALTER TABLE taf_transfer ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'Pending'")
            )
        conn.execute(
            text(
                "UPDATE taf_transfer SET status = 'Pending' "
                "WHERE status IS NULL OR TRIM(status) = ''"
            )
        )
        conn.commit()


def _ensure_taf_transfer_item_columns():
    with db.engine.connect() as conn:
        existing_columns = {
            row[1]
            for row in conn.execute(text("PRAGMA table_info('taf_transfer_item')")).fetchall()
        }

        if 'received_quantity' not in existing_columns:
            conn.execute(text("ALTER TABLE taf_transfer_item ADD COLUMN received_quantity INTEGER"))
        if 'short_over_qty' not in existing_columns:
            conn.execute(text("ALTER TABLE taf_transfer_item ADD COLUMN short_over_qty INTEGER NOT NULL DEFAULT 0"))
        conn.execute(
            text(
                "UPDATE taf_transfer_item SET short_over_qty = 0 "
                "WHERE short_over_qty IS NULL"
            )
        )
        conn.commit()


def _ensure_daily_ending_inventory_item_columns():
    with db.engine.connect() as conn:
        existing_columns = {
            row[1]
            for row in conn.execute(text("PRAGMA table_info('daily_ending_inventory_item')")).fetchall()
        }

        if 'delivery_reviewed_date' not in existing_columns:
            conn.execute(text("ALTER TABLE daily_ending_inventory_item ADD COLUMN delivery_reviewed_date DATE"))
        conn.commit()


def create_app():
    _load_local_env()
    app = Flask(__name__)
    app.config['SQLALCHEMY_DATABASE_URI'] = f'sqlite:///{DB_NAME}'
    app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
    app.config['SECRET_KEY'] = 'thisisasecretkey'
    
    db.init_app(app)

    from .views import views
    from .auth import auth
    from .admin import admin

    app.register_blueprint(auth, url_prefix='/')
    app.register_blueprint(admin, url_prefix='/')
    app.register_blueprint(views, url_prefix='/')

    from .models import (
        User,
        Store,
        Cluster,
        DailyReport,
        PosSold,
        RsoDelivery,
        TafTransfer,
        TafTransferItem,
        ProductMaster,
        ProductAlias,
        MenuInventoryItem,
        StoreTarget,
        AuditLog,
        GlobalInvenSyncConfig,
        DailyForecasting,
        DailyForecastingItem,
        DailyEndingInventory,
        DailyEndingInventoryItem,
    )

    with app.app_context():
        db.create_all()
        _ensure_pos_sold_columns()
        _ensure_store_group_column()
        _ensure_user_assigned_store_column()
        _ensure_product_master_sp_np_column()
        _ensure_rso_delivery_columns()
        _ensure_taf_transfer_columns()
        _ensure_taf_transfer_item_columns()
        _ensure_daily_ending_inventory_item_columns()
        _backfill_store_group_values()
        print("Created database!")

    login_manager = LoginManager()
    login_manager.login_view = 'auth.login'
    login_manager.login_message = 'Please login to access this page.'
    login_manager.login_message_category = 'info'
    login_manager.init_app(app)

    @login_manager.user_loader
    def load_user(id):
        return User.query.get(int(id))

    @app.context_processor
    def inject_trans_in_pending_count():
        pending_trans_in_count = 0
        try:
            if current_user.is_authenticated and getattr(current_user, 'role', None) == 'Store Manager':
                from .models import Store, TafTransfer

                store = Store.query.filter_by(manager_id=current_user.id).first()
                if store:
                    normalized_store_name = str(store.name or '').strip().lower()
                    pending_trans_in_count = int(
                        db.session.query(func.count(TafTransfer.id))
                        .filter(func.lower(func.trim(TafTransfer.transfer_to)) == normalized_store_name)
                        .filter(TafTransfer.store_id != store.id)
                        .filter(
                            func.coalesce(
                                func.nullif(func.trim(TafTransfer.status), ''),
                                'Pending'
                            ) == 'Pending'
                        )
                        .scalar()
                        or 0
                    )
        except Exception:
            pending_trans_in_count = 0

        return {
            'pending_trans_in_count': pending_trans_in_count,
        }
    
    return app
