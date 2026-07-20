from . import db
from flask_login import UserMixin
from sqlalchemy.sql import func
from sqlalchemy import event

inventory_staff_store = db.Table(
    'inventory_staff_store',
    db.Column('user_id', db.Integer, db.ForeignKey('user.id'), primary_key=True),
    db.Column('store_id', db.Integer, db.ForeignKey('store.id'), primary_key=True),
)

class User(db.Model, UserMixin):
    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(100), unique=True)
    username = db.Column(db.String(100), unique=True)
    full_name = db.Column(db.String(100))
    role = db.Column(db.String(100))
    assigned_store_id = db.Column(db.Integer, db.ForeignKey('store.id'), nullable=True, index=True)
    date_added = db.Column(db.DateTime(timezone=True), default=func.now())
    password = db.Column(db.String(100))
    assigned_store = db.relationship('Store', foreign_keys=[assigned_store_id], lazy=True)
    assigned_stores = db.relationship(
        'Store',
        secondary=inventory_staff_store,
        lazy=True,
        backref=db.backref('assigned_inventory_staff', lazy=True),
    )
    # Relationship for clusters managed by this user
    managed_clusters = db.relationship('Cluster', backref='manager', lazy=True)
    # Relationship for stores managed by this user
    managed_stores = db.relationship('Store', backref='manager', foreign_keys='Store.manager_id', lazy=True)

class Cluster(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), unique=True)
    description = db.Column(db.String(200))
    manager_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=True)
    date_added = db.Column(db.DateTime(timezone=True), default=func.now())
    # Relationship for stores in this cluster
    stores = db.relationship('Store', backref='cluster', lazy=True)

class Store(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100))
    address = db.Column(db.String(200))
    store_group = db.Column(db.String(20), nullable=False, default='premium')
    is_one_year_already = db.Column(db.Boolean, default=False, nullable=False)
    cluster_id = db.Column(db.Integer, db.ForeignKey('cluster.id'), nullable=True)
    manager_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=True)
    date_added = db.Column(db.DateTime(timezone=True), default=func.now())
    # Relationship for daily reports
    daily_reports = db.relationship('DailyReport', backref='store', lazy=True)

    NON_PREMIUM_STORE_NAMES = {
        'burgos',
        'sm tacloban',
        'rob north',
        'rob tac',
        'palo',
        'dulag',
        'burauen',
        'tanauan',
        'abuyog',
        'kananga',
        'alang alang',
        'carigara',
        'airport',
    }

    @staticmethod
    def _normalize_store_name(name):
        return ' '.join((name or '').strip().lower().split())

    @classmethod
    def determine_store_group(cls, name):
        normalized_name = cls._normalize_store_name(name)
        if normalized_name in cls.NON_PREMIUM_STORE_NAMES:
            return 'non_premium'
        return 'premium'


@event.listens_for(Store, 'before_insert')
def _set_store_group_before_insert(mapper, connection, target):
    target.store_group = Store.determine_store_group(target.name)

class DailyReport(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    store_id = db.Column(db.Integer, db.ForeignKey('store.id'), nullable=False)
    report_date = db.Column(db.Date, nullable=False)
    submitted_at = db.Column(db.DateTime(timezone=True), default=func.now())
    submitted_by = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    status = db.Column(db.String(20), default='Pending')  # Pending, Approved, Rejected
    
    # POS Sales
    pos_gross_sales = db.Column(db.Float, default=0.0)
    pos_net_sales = db.Column(db.Float, default=0.0)
    pos_tc = db.Column(db.Integer, default=0)
    
    # CI Regular Sales
    ci_regular_gross_sales = db.Column(db.Float, default=0.0)
    ci_regular_net_sales = db.Column(db.Float, default=0.0)
    ci_tc = db.Column(db.Integer, default=0)
    
    # CI Details
    ci_number = db.Column(db.String(50))
    ci_sales_discount = db.Column(db.Float, default=0.0)
    
    # SGA (Should be in Net Sales)
    boothselling_sales = db.Column(db.Float, default=0.0)
    boothselling_tc = db.Column(db.Integer, default=0)
    bulk_order_sales = db.Column(db.Float, default=0.0)
    bulk_order_tc = db.Column(db.Integer, default=0)
    reseller_sales = db.Column(db.Float, default=0.0)
    reseller_tc = db.Column(db.Integer, default=0)
    tieup_sales = db.Column(db.Float, default=0.0)
    tieup_tc = db.Column(db.Integer, default=0)
    gow_sales = db.Column(db.Float, default=0.0)
    gow_tc = db.Column(db.Integer, default=0)
    ambulant_sales = db.Column(db.Float, default=0.0)
    ambulant_tc = db.Column(db.Integer, default=0)
    extended_hours_sales = db.Column(db.Float, default=0.0)
    extended_hours_tc = db.Column(db.Integer, default=0)
    
    # Aggregators (Should be in Net Sales)
    gds_sales = db.Column(db.Float, default=0.0)
    gds_tc = db.Column(db.Integer, default=0)
    grab_sales = db.Column(db.Float, default=0.0)
    grab_tc = db.Column(db.Integer, default=0)
    foodpanda_sales = db.Column(db.Float, default=0.0)
    foodpanda_tc = db.Column(db.Integer, default=0)
    paymaya_sales = db.Column(db.Float, default=0.0)
    paymaya_tc = db.Column(db.Integer, default=0)
    gcash_sales = db.Column(db.Float, default=0.0)
    gcash_tc = db.Column(db.Integer, default=0)
    
    # LDTS (Last Day To Sell) - Tomorrow
    ldts_gc = db.Column(db.Integer, default=0)
    ldts_rolls = db.Column(db.Integer, default=0)
    ldts_premium = db.Column(db.Integer, default=0)
    
    # Ending Inventory
    ending_inv_gc = db.Column(db.Integer, default=0)
    ending_inv_rolls = db.Column(db.Integer, default=0)
    ending_inv_premium = db.Column(db.Integer, default=0)
    ending_inv_slices = db.Column(db.Integer, default=0)
    ending_inv_mamon = db.Column(db.Integer, default=0)
    
    # Spoilage (Amount only)
    spoilage_gc = db.Column(db.Float, default=0.0)
    spoilage_rolls = db.Column(db.Float, default=0.0)
    spoilage_premium = db.Column(db.Float, default=0.0)
    spoilage_others = db.Column(db.Float, default=0.0)
    
    # Discount Monitoring
    senior_pwd_discount = db.Column(db.Float, default=0.0)
    promo_ldts_discount = db.Column(db.Float, default=0.0)
    bulk_orders_discount = db.Column(db.Float, default=0.0)
    
    # Calculated Spoilage
    total_net_spoilage = db.Column(db.Float, default=0.0)
    spoilage_percentage = db.Column(db.Float, default=0.0)
    mtd_percentage = db.Column(db.Float, default=0.0)
    
    # Relationship
    submitter = db.relationship('User', foreign_keys=[submitted_by])
    pos_sold_items = db.relationship('PosSold', backref='daily_report', lazy=True, cascade='all, delete-orphan')


class PosSold(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    daily_report_id = db.Column(db.Integer, db.ForeignKey('daily_report.id'), nullable=False, index=True)
    product_name = db.Column(db.String(255), nullable=False)
    quantity = db.Column(db.Integer, nullable=False, default=0)
    gross_sales = db.Column(db.Float, nullable=False, default=0.0)
    discount = db.Column(db.Float, nullable=False, default=0.0)
    net_sales = db.Column(db.Float, nullable=False, default=0.0)
    z_reading_image_path = db.Column(db.String(500), nullable=True)
    uploaded_at = db.Column(db.DateTime(timezone=True), default=func.now())


class RsoDelivery(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    store_id = db.Column(db.Integer, db.ForeignKey('store.id'), nullable=False, index=True)
    report_date = db.Column(db.Date, nullable=False, index=True)
    rso_no = db.Column(db.String(255), nullable=True)
    product_name = db.Column(db.String(255), nullable=False)
    quantity = db.Column(db.Integer, nullable=False, default=0)
    received_quantity = db.Column(db.Integer, nullable=True)
    uploaded_by = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    uploaded_at = db.Column(db.DateTime(timezone=True), default=func.now())
    delivery_reviewed_date = db.Column(db.Date, nullable=True, index=True)
    upload_source = db.Column(db.String(20), nullable=False, default='delivery', index=True)
    manual_note = db.Column(db.String(500), nullable=True)

    store = db.relationship('Store', backref='rso_deliveries')
    uploader = db.relationship('User', foreign_keys=[uploaded_by])


class RsoDeliveryDraft(db.Model):
    __tablename__ = 'rso_delivery_draft'

    id = db.Column(db.Integer, primary_key=True)
    store_id = db.Column(db.Integer, db.ForeignKey('store.id'), nullable=False, index=True)
    report_date = db.Column(db.Date, nullable=False, index=True)
    items_json = db.Column(db.Text, nullable=False, default='[]')
    upload_source = db.Column(db.String(20), nullable=True)
    upload_filename = db.Column(db.String(255), nullable=True)
    updated_by = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    updated_at = db.Column(db.DateTime(timezone=True), default=func.now(), onupdate=func.now())

    store = db.relationship('Store')
    updater = db.relationship('User', foreign_keys=[updated_by])

    __table_args__ = (
        db.UniqueConstraint('store_id', 'report_date', name='uq_rso_delivery_draft_store_date'),
    )


class TafTransfer(db.Model):
    __tablename__ = 'taf_transfer'
    id = db.Column(db.Integer, primary_key=True)
    store_id = db.Column(db.Integer, db.ForeignKey('store.id'), nullable=False, index=True)
    transaction_date = db.Column(db.Date, nullable=False, index=True)
    control_no = db.Column(db.String(50), nullable=False, unique=True, index=True)
    transaction_type = db.Column(db.String(50), nullable=False, default='Product Transfer')
    transfer_from = db.Column(db.String(255), nullable=False)
    transfer_to = db.Column(db.String(255), nullable=False)
    prepared_by_name = db.Column(db.String(255), nullable=False)
    received_by_name = db.Column(db.String(255), nullable=True)
    status = db.Column(db.String(20), nullable=False, default='Pending')
    grand_total = db.Column(db.Float, nullable=False, default=0.0)
    submitted_by = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), default=func.now())

    store = db.relationship('Store', backref='taf_transfers')
    submitter = db.relationship('User', foreign_keys=[submitted_by])
    items = db.relationship(
        'TafTransferItem',
        backref='transfer',
        lazy=True,
        cascade='all, delete-orphan',
    )


class TafTransferItem(db.Model):
    __tablename__ = 'taf_transfer_item'
    id = db.Column(db.Integer, primary_key=True)
    transfer_id = db.Column(db.Integer, db.ForeignKey('taf_transfer.id'), nullable=False, index=True)
    item_name = db.Column(db.String(255), nullable=False)
    unit_cost = db.Column(db.Float, nullable=False, default=0.0)
    quantity = db.Column(db.Integer, nullable=False, default=0)
    received_quantity = db.Column(db.Integer, nullable=True)
    short_over_qty = db.Column(db.Integer, nullable=False, default=0)
    line_total = db.Column(db.Float, nullable=False, default=0.0)
    remarks = db.Column(db.String(255), nullable=True)


# Backward-compatible aliases for older imports/usages.
TafProductTransfer = TafTransfer
TafProductTransferItem = TafTransferItem


class ProductMaster(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    code = db.Column(db.Integer, nullable=True, index=True)
    description = db.Column(db.String(255), nullable=False)
    category = db.Column(db.String(100), nullable=False, index=True)
    sub_category = db.Column(db.String(100), nullable=True, index=True)
    tp = db.Column(db.Float, nullable=True)
    sp_p = db.Column(db.Float, nullable=True)
    sp_np = db.Column(db.Float, nullable=True)
    shelf_life = db.Column(db.String(100), nullable=True)
    created_at = db.Column(db.DateTime(timezone=True), default=func.now())
    updated_at = db.Column(db.DateTime(timezone=True), default=func.now(), onupdate=func.now())
    aliases = db.relationship('ProductAlias', backref='master_product', lazy=True, cascade='all, delete-orphan')


class ProductAlias(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    alias_name = db.Column(db.String(255), nullable=False)
    normalized_alias = db.Column(db.String(255), nullable=False, unique=True, index=True)
    product_master_id = db.Column(db.Integer, db.ForeignKey('product_master.id'), nullable=False, index=True)
    created_by = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=True)
    created_at = db.Column(db.DateTime(timezone=True), default=func.now())

    creator = db.relationship('User', foreign_keys=[created_by])


class MenuInventoryItem(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    product_name = db.Column(db.String(255), nullable=False)
    normalized_product_name = db.Column(db.String(255), nullable=False, unique=True, index=True)
    category = db.Column(db.String(100), nullable=False, default='Uncategorized', index=True)
    aliases_text = db.Column(db.Text, nullable=True)
    source = db.Column(db.String(30), nullable=False, default='master')
    created_at = db.Column(db.DateTime(timezone=True), default=func.now())
    updated_at = db.Column(db.DateTime(timezone=True), default=func.now(), onupdate=func.now())
    last_synced_at = db.Column(db.DateTime(timezone=True), default=func.now())

class StoreTarget(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    store_id = db.Column(db.Integer, db.ForeignKey('store.id'), nullable=False)
    target_date = db.Column(db.Date, nullable=False)
    target_net = db.Column(db.Float, default=0.0)
    gbi_target = db.Column(db.Float, default=0.0)
    last_year_net = db.Column(db.Float, default=0.0)
    uploaded_at = db.Column(db.DateTime(timezone=True), default=func.now())
    uploaded_by = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    
    # Relationships
    store = db.relationship('Store', backref='targets')
    uploader = db.relationship('User', foreign_keys=[uploaded_by])


class AuditLog(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    event_time = db.Column(db.DateTime(timezone=True), nullable=False, default=func.now(), index=True)
    actor_user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=True, index=True)
    actor_username = db.Column(db.String(100))
    action = db.Column(db.String(120), nullable=False, index=True)
    entity_type = db.Column(db.String(80), index=True)
    entity_id = db.Column(db.String(120))
    reason = db.Column(db.String(255))
    ip_address = db.Column(db.String(64))
    endpoint = db.Column(db.String(255))
    http_method = db.Column(db.String(10))
    details = db.Column(db.Text)
    previous_hash = db.Column(db.String(64))
    current_hash = db.Column(db.String(64), nullable=False, unique=True, index=True)

    actor = db.relationship('User', foreign_keys=[actor_user_id])


class GlobalInvenSyncConfig(db.Model):
    __tablename__ = 'global_invensync_config'

    id = db.Column(db.Integer, primary_key=True)
    config_data = db.Column(db.Text, nullable=False, default='{}')
    created_at = db.Column(db.DateTime(timezone=True), default=func.now())
    updated_at = db.Column(db.DateTime(timezone=True), default=func.now(), onupdate=func.now())


class DailyEndingInventory(db.Model):
    """Daily Ending Inventory - Tracks inventory by product"""
    __tablename__ = 'daily_ending_inventory'
    id = db.Column(db.Integer, primary_key=True)
    store_id = db.Column(db.Integer, db.ForeignKey('store.id'), nullable=False, index=True)
    inventory_date = db.Column(db.Date, nullable=False, index=True)
    created_at = db.Column(db.DateTime(timezone=True), default=func.now())
    updated_at = db.Column(db.DateTime(timezone=True), default=func.now(), onupdate=func.now())


    created_by = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    is_finalized = db.Column(db.Boolean, nullable=False, default=False)
    finalized_at = db.Column(db.DateTime(timezone=True), nullable=True)
    finalized_by = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=True)
    is_beginning_finalized = db.Column(db.Boolean, nullable=False, default=False)
    beginning_finalized_at = db.Column(db.DateTime(timezone=True), nullable=True)
    beginning_finalized_by = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=True)
    
    # Relationships
    store = db.relationship('Store', backref='daily_ending_inventories')
    creator = db.relationship('User', foreign_keys=[created_by])
    finalizer = db.relationship('User', foreign_keys=[finalized_by])
    beginning_finalizer = db.relationship('User', foreign_keys=[beginning_finalized_by])
    items = db.relationship('DailyEndingInventoryItem', backref='inventory', lazy=True, cascade='all, delete-orphan')


class MaintenanceMode(db.Model):
    __tablename__ = 'maintenance_mode'
    id = db.Column(db.Integer, primary_key=True)
    is_enabled = db.Column(db.Boolean, nullable=False, default=False)
    message = db.Column(db.String(500), nullable=True)
    updated_at = db.Column(db.DateTime(timezone=True), default=func.now(), onupdate=func.now())
    updated_by = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=True)

    updater = db.relationship('User', foreign_keys=[updated_by])


class DailyEndingInventoryItem(db.Model):
    """Individual product items in daily ending inventory"""
    __tablename__ = 'daily_ending_inventory_item'
    id = db.Column(db.Integer, primary_key=True)
    inventory_id = db.Column(db.Integer, db.ForeignKey('daily_ending_inventory.id'), nullable=False, index=True)
    product_master_id = db.Column(db.Integer, db.ForeignKey('product_master.id'), nullable=True)
    
    # Product info (snapshot)
    product_code = db.Column(db.String(50), nullable=True)
    product_description = db.Column(db.String(255), nullable=False)
    srp_price = db.Column(db.Float, default=0.0)
    
    # Beginning inventory (from previous day's final ending)
    beginning_qty = db.Column(db.Integer, default=0)
    
    # User inputs - Incoming
    delivery_qty = db.Column(db.Integer, default=0)
    trans_in_qty = db.Column(db.Integer, default=0)
    bo_qty = db.Column(db.Integer, default=0)
    adv_del_qty = db.Column(db.Integer, default=0)
    
    # User inputs - Outgoing
    trans_out_qty = db.Column(db.Integer, default=0)
    wastage_qty = db.Column(db.Integer, default=0)
    wastage_amount = db.Column(db.Float, default=0.0)
    csi_qty = db.Column(db.Integer, default=0)
    quantity_sold = db.Column(db.Integer, default=0)
    
    # Ending inventory inputs (3 days forecast)
    ending_d5_qty = db.Column(db.Integer, default=0)
    ending_d4_qty = db.Column(db.Integer, default=0)
    ending_d3_qty = db.Column(db.Integer, default=0)
    
    # Calculated fields
    total_ending_qty = db.Column(db.Integer, default=0)
    total_peso_srp = db.Column(db.Float, default=0.0)
    theo_ending_qty = db.Column(db.Integer, default=0)
    variance_qty = db.Column(db.Integer, default=0)
    variance_peso = db.Column(db.Float, default=0.0)
    delivery_reviewed_date = db.Column(db.Date, nullable=True)

    remarks = db.Column(db.String(255), nullable=True)


class StoreProductBuffer(db.Model):
    __tablename__ = 'store_product_buffer'
    id = db.Column(db.Integer, primary_key=True)
    store_id = db.Column(db.Integer, db.ForeignKey('store.id'), nullable=False, index=True)
    product_id = db.Column(db.Integer, db.ForeignKey('product_master.id'), nullable=False, index=True)
    buffer_pct = db.Column(db.Float, nullable=False, default=20.0)
    updated_at = db.Column(db.DateTime(timezone=True), default=func.now(), onupdate=func.now())
    updated_by = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=True)

    __table_args__ = (db.UniqueConstraint('store_id', 'product_id', name='uq_store_product_buffer'),)
