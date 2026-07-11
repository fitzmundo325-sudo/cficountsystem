import os
import json
import traceback
import uuid
from pathlib import Path
from re import A
from flask import Flask, redirect, render_template, request, session, url_for
from flask_sqlalchemy import SQLAlchemy
from flask_login import LoginManager, current_user
from sqlalchemy import text, func
from werkzeug.exceptions import HTTPException

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
        if 'received_quantity' not in existing_columns:
            conn.execute(text("ALTER TABLE rso_delivery ADD COLUMN received_quantity INTEGER"))
        if 'delivery_reviewed_date' not in existing_columns:
            conn.execute(text("ALTER TABLE rso_delivery ADD COLUMN delivery_reviewed_date DATE"))
        if 'upload_source' not in existing_columns:
            conn.execute(text("ALTER TABLE rso_delivery ADD COLUMN upload_source VARCHAR(20) DEFAULT 'delivery'"))
        conn.execute(text("UPDATE rso_delivery SET upload_source = 'delivery' WHERE upload_source IS NULL OR TRIM(upload_source) = ''"))
        conn.commit()


def _backfill_inventory_staff_store_assignments():
    with db.engine.connect() as conn:
        conn.execute(text(
            "INSERT OR IGNORE INTO inventory_staff_store (user_id, store_id) "
            "SELECT id, assigned_store_id FROM user "
            "WHERE role = 'Inventory Staff' AND assigned_store_id IS NOT NULL"
        ))
        conn.commit()


def _ensure_maintenance_mode_table():
    """Repair the maintenance table if it was created from an older malformed model."""
    from .models import MaintenanceMode

    with db.engine.connect() as conn:
        existing_columns = {
            row[1]
            for row in conn.execute(text("PRAGMA table_info('maintenance_mode')")).fetchall()
        }

    expected_columns = {'id', 'is_enabled', 'message', 'updated_at', 'updated_by'}
    if existing_columns and existing_columns != expected_columns:
        MaintenanceMode.__table__.drop(db.engine, checkfirst=True)
        MaintenanceMode.__table__.create(db.engine, checkfirst=True)


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


def _ensure_daily_ending_inventory_columns():
    with db.engine.connect() as conn:
        existing_columns = {
            row[1]
            for row in conn.execute(text("PRAGMA table_info('daily_ending_inventory')")).fetchall()
        }

        if 'is_finalized' not in existing_columns:
            conn.execute(text("ALTER TABLE daily_ending_inventory ADD COLUMN is_finalized BOOLEAN NOT NULL DEFAULT 0"))
        if 'finalized_at' not in existing_columns:
            conn.execute(text("ALTER TABLE daily_ending_inventory ADD COLUMN finalized_at DATETIME"))
        if 'finalized_by' not in existing_columns:
            conn.execute(text("ALTER TABLE daily_ending_inventory ADD COLUMN finalized_by INTEGER"))
        if 'is_beginning_finalized' not in existing_columns:
            conn.execute(text("ALTER TABLE daily_ending_inventory ADD COLUMN is_beginning_finalized BOOLEAN NOT NULL DEFAULT 0"))
        if 'beginning_finalized_at' not in existing_columns:
            conn.execute(text("ALTER TABLE daily_ending_inventory ADD COLUMN beginning_finalized_at DATETIME"))
        if 'beginning_finalized_by' not in existing_columns:
            conn.execute(text("ALTER TABLE daily_ending_inventory ADD COLUMN beginning_finalized_by INTEGER"))
        conn.commit()


def _backfill_beginning_finalized_flags():
    from .models import DailyEndingInventory, GlobalInvenSyncConfig

    config = GlobalInvenSyncConfig.query.first()
    if not config:
        return

    try:
        config_data = json.loads(config.config_data or '{}')
    except ValueError:
        config_data = {}

    should_seed_missing_flags = 'beginning_qty' in config_data.get('locked_columns', [])

    inventories = DailyEndingInventory.query.order_by(
        DailyEndingInventory.store_id,
        DailyEndingInventory.inventory_date,
        DailyEndingInventory.id,
    ).all()
    finalized_store_ids = set()
    has_changes = False
    for inventory in inventories:
        if inventory.store_id in finalized_store_ids:
            if inventory.is_beginning_finalized:
                inventory.is_beginning_finalized = False
                inventory.beginning_finalized_at = None
                inventory.beginning_finalized_by = None
                has_changes = True
            continue

        if inventory.is_beginning_finalized or (should_seed_missing_flags and inventory.items):
            finalized_store_ids.add(inventory.store_id)
        if should_seed_missing_flags and inventory.items and not inventory.is_beginning_finalized:
            inventory.is_beginning_finalized = True
            has_changes = True

    if has_changes:
        db.session.commit()


def _drop_daily_ending_inventory_discount_columns():
    with db.engine.connect() as conn:
        existing_columns = {
            row[1]
            for row in conn.execute(text("PRAGMA table_info('daily_ending_inventory_item')")).fetchall()
        }

        for column_name in ('discount_qty', 'discount_percent', 'total_amount_with_discount'):
            if column_name in existing_columns:
                conn.execute(text(f"ALTER TABLE daily_ending_inventory_item DROP COLUMN {column_name}"))
        conn.commit()


def _drop_daily_forecasting_tables():
    with db.engine.connect() as conn:
        conn.execute(text("DROP TABLE IF EXISTS daily_forecasting_item"))
        conn.execute(text("DROP TABLE IF EXISTS daily_forecasting"))
        conn.commit()


def create_app():
    _load_local_env()
    app = Flask(__name__)
    db_name = os.environ.get('CM_APP_DB_NAME', DB_NAME)
    app.config['SQLALCHEMY_DATABASE_URI'] = f'sqlite:///{db_name}'
    app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
    app.config['SECRET_KEY'] = 'thisisasecretkey'
    
    db.init_app(app)

    from .views import views
    from .auth import auth
    from .admin import admin

    app.register_blueprint(auth, url_prefix='/')
    app.register_blueprint(admin, url_prefix='/')
    app.register_blueprint(views, url_prefix='/')

    @app.route('/sw.js')
    def service_worker():
        response = app.send_static_file('sw.js')
        response.headers['Content-Type'] = 'application/javascript; charset=utf-8'
        response.headers['Service-Worker-Allowed'] = '/'
        response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
        return response

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
        MaintenanceMode,
        DailyEndingInventory,
        DailyEndingInventoryItem,
    )

    with app.app_context():
        db.create_all()
        _ensure_pos_sold_columns()
        _ensure_store_group_column()
        _ensure_user_assigned_store_column()
        _backfill_inventory_staff_store_assignments()
        _ensure_product_master_sp_np_column()
        _ensure_rso_delivery_columns()
        _ensure_maintenance_mode_table()
        _ensure_taf_transfer_columns()
        _ensure_taf_transfer_item_columns()
        _ensure_daily_ending_inventory_columns()
        _ensure_daily_ending_inventory_item_columns()
        _drop_daily_ending_inventory_discount_columns()
        _drop_daily_forecasting_tables()
        _backfill_store_group_values()
        _backfill_beginning_finalized_flags()
        print("Created database!")

    login_manager = LoginManager()
    login_manager.login_view = 'auth.login'
    login_manager.login_message = 'Please login to access this page.'
    login_manager.login_message_category = 'info'
    login_manager.init_app(app)

    @login_manager.user_loader
    def load_user(id):
        return User.query.get(int(id))

    @app.route('/maintenance')
    def maintenance():
        mode = MaintenanceMode.query.first()
        if not mode or not mode.is_enabled:
            return redirect(url_for('views.home') if current_user.is_authenticated else url_for('auth.login'))
        if current_user.is_authenticated and getattr(current_user, 'role', None) in ('Admin', 'Superadmin', 'General Manager'):
            return redirect(url_for('admin.dashboard'))
        return render_template('maintenance.html', maintenance_mode=mode)

    @app.before_request
    def enforce_maintenance_mode():
        if request.endpoint in ('static', 'auth.login', 'auth.logout', 'maintenance', 'service_worker'):
            return None
        if not current_user.is_authenticated:
            return None
        if getattr(current_user, 'role', None) in ('Admin', 'Superadmin', 'General Manager'):
            return None
        mode = MaintenanceMode.query.first()
        if mode and mode.is_enabled:
            return redirect(url_for('maintenance'))
        return None

    @app.context_processor
    def inject_maintenance_mode():
        mode = MaintenanceMode.query.first()
        return {'system_maintenance_mode': mode}

    @app.context_processor
    def inject_inventory_staff_store_context():
        if not current_user.is_authenticated or getattr(current_user, 'role', None) != 'Inventory Staff':
            return {}
        assigned_stores = list(getattr(current_user, 'assigned_stores', None) or [])
        legacy_store = getattr(current_user, 'assigned_store', None)
        if legacy_store and all(store.id != legacy_store.id for store in assigned_stores):
            assigned_stores.append(legacy_store)
        assigned_stores.sort(key=lambda store: (store.name or '').lower())
        assigned_ids = {store.id for store in assigned_stores}
        requested_id = request.args.get('store_id', type=int)
        if requested_id in assigned_ids:
            session['inventory_staff_store_id'] = requested_id
        selected_id = int(session.get('inventory_staff_store_id', 0) or 0)
        if selected_id not in assigned_ids:
            selected_id = assigned_stores[0].id if assigned_stores else None
            if selected_id:
                session['inventory_staff_store_id'] = selected_id
        return {
            'inventory_staff_stores': assigned_stores,
            'inventory_staff_selected_store_id': selected_id,
        }

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

    def _safe_error_form_snapshot():
        sensitive_markers = ('password', 'secret', 'token', 'csrf')
        snapshot = {}
        try:
            for key in request.form.keys():
                normalized_key = str(key or '').lower()
                values = request.form.getlist(key)
                if any(marker in normalized_key for marker in sensitive_markers):
                    snapshot[key] = '[redacted]'
                elif len(values) > 1:
                    snapshot[key] = [str(value)[:300] for value in values[:20]]
                else:
                    snapshot[key] = str(values[0] if values else '')[:300]
        except Exception:
            return {'_error': 'Unable to read form payload.'}
        return snapshot

    def _log_application_error(error, status_code=None):
        error_id = uuid.uuid4().hex[:12]
        status = int(status_code or getattr(error, 'code', 500) or 500)
        error_type = type(error).__name__
        message = str(getattr(error, 'description', None) or error)
        details = {
            'error_id': error_id,
            'status_code': status,
            'exception_type': error_type,
            'message': message[:1000],
            'path': request.path,
            'full_path': request.full_path,
            'endpoint': request.endpoint,
            'blueprint': request.blueprint,
            'method': request.method,
            'query_args': request.args.to_dict(flat=False),
            'form': _safe_error_form_snapshot() if request.method in ('POST', 'PUT', 'PATCH', 'DELETE') else {},
            'user_agent': str(request.user_agent)[:500],
            'referrer': str(request.referrer or '')[:500],
            'is_json': request.is_json,
            'pythonanywhere_hint': 'Check PythonAnywhere error logs for the same timestamp and error_id.',
        }
        if status >= 500 and not isinstance(error, HTTPException):
            details['traceback'] = ''.join(
                traceback.format_exception(type(error), error, getattr(error, '__traceback__', None))
            )[-8000:]

        try:
            db.session.rollback()
            from .audit import log_audit_event

            log_audit_event(
                action='system.error',
                entity_type='ApplicationError',
                entity_id=error_id,
                reason=f'{status} {error_type} on {request.method} {request.path}',
                details=details,
                commit=True,
            )
        except Exception:
            db.session.rollback()
            app.logger.exception('Unable to write application error to audit log. error_id=%s', error_id)

        app.logger.error(
            'Application error captured. error_id=%s status=%s path=%s type=%s',
            error_id,
            status,
            request.path,
            error_type,
            exc_info=status >= 500 and not isinstance(error, HTTPException),
        )
        return error_id

    @app.errorhandler(HTTPException)
    def handle_http_exception(error):
        status = int(getattr(error, 'code', 500) or 500)
        if status >= 400:
            _log_application_error(error, status)
        return error

    @app.errorhandler(Exception)
    def handle_unexpected_exception(error):
        error_id = _log_application_error(error, 500)
        return (
            f'Internal Server Error. Error ID: {error_id}',
            500,
            {'Content-Type': 'text/plain; charset=utf-8'},
        )
    
    return app
