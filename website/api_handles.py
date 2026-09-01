import os, json, re
from operator import or_, and_
from typing import Union

from flask import Blueprint, render_template, request, flash, jsonify, Flask, url_for, session, current_app, send_from_directory, Response
from flask_login import login_required, current_user
from sqlalchemy import asc, desc, distinct, table, func, or_, case, cast, Integer, String
from sqlalchemy.orm import aliased, selectinload
from werkzeug.security import generate_password_hash, check_password_hash

import random, string, requests
import pytz
from werkzeug.utils import secure_filename

manila_tz = pytz.timezone("Asia/Manila")
from dotenv import load_dotenv

from . import db
from datetime import datetime, date, timedelta
from .models import User, ProductMaster, ProductAlias, ProductPriceChangeLog, Cluster, Store, StoreTarget, SupplyItem, SupplyRequest, SupplyRequestItem
from .admin import log_audit_event

plt = ""  # empty this var when on live website
post_per_page = 100

api_handles = Blueprint('api_handles', __name__)

app = Flask(__name__)

CONFIG_DATA = {}  # Stores Global Config Data
load_dotenv()

#api Handles added by ItsAtomtech on 07-29-2026 v1.0


@api_handles.route('/dummy', methods=['GET', 'POST'])
def dum():
    return {"type": "success", "message": "Message test" } 
    page = 'home'

    
def manila_time():
    return datetime.now(pytz.timezone("Asia/Manila"))


def _can_manage_users():
    return hasattr(current_user, 'role') and current_user.role in ('Superadmin', 'Admin', 'General Manager')



# ================================
# Product Masterlist Section Start
# ================================

@api_handles.route('/product_masterlist', methods=['POST', 'GET'])
@login_required
def api_product_masterlist():
    if current_user.role not in ('Superadmin', 'Admin'):
        return {'type': 'error', 'message': 'Access denied.'}, 403

    try:
        current_page = int(request.form.get('page') or request.args.get('page') or 1)
    except (ValueError, TypeError):
        current_page = 1
    
    per_page = post_per_page

    query = ProductMaster.query.options(selectinload(ProductMaster.aliases))

    # -- Filters ----------------------------------------------
    filters_raw = request.form.get('filters')
    if filters_raw:
        try:
            filters = json.loads(filters_raw)

            if filters.get('category'):
                query = query.filter(ProductMaster.category == filters['category'])

            if filters.get('sub_category'):
                query = query.filter(ProductMaster.sub_category == filters['sub_category'])

        except json.JSONDecodeError:
            pass

    # -- Search -----------------------------------------------
    search = request.form.get('search')
    if search:
        pattern = f'%{search}%'
        query = query.filter(
            or_(
                cast(ProductMaster.code, String).ilike(pattern),
                ProductMaster.description.ilike(pattern),
                ProductMaster.category.ilike(pattern),
                ProductMaster.sub_category.ilike(pattern),
                cast(ProductMaster.tp, String).ilike(pattern),
                cast(ProductMaster.sp_p, String).ilike(pattern),
                cast(ProductMaster.sp_np, String).ilike(pattern),
                ProductMaster.shelf_life.ilike(pattern),
            )
        )

    # -- Sorting ----------------------------------------------
    sortby = request.form.get('sort')
    order = request.form.get('order_by', 'asc').lower()

    sortable_columns = {
        'id':          ProductMaster.id,
        'code':        ProductMaster.code,
        'description': ProductMaster.description,
        'category':    ProductMaster.category,
        'sub_category':ProductMaster.sub_category,
        'tp':          ProductMaster.tp,
        'sp_p':        ProductMaster.sp_p,
        'sp_np':       ProductMaster.sp_np,
        'shelf_life':  ProductMaster.shelf_life,
        'created_at':  ProductMaster.created_at,
    }

    if sortby in sortable_columns:
        sort_col = sortable_columns[sortby]
        query = query.order_by(desc(sort_col) if order == 'desc' else asc(sort_col))
    else:
        query = query.order_by(ProductMaster.id.asc())

    # -- Pagination -------------------------------------------
    pagination = query.paginate(page=current_page, per_page=per_page, error_out=False)
    results      = pagination.items
    total_pages  = pagination.pages
    total_results = pagination.total

    # -- Serialize --------------------------------------------
    product_list = []
    for product in results:
        product_list.append({
            'id':          product.id,
            'code':        product.code,
            'description': product.description,
            'category':    product.category,
            'sub_category':product.sub_category,
            'tp':          product.tp,
            'sp_p':        product.sp_p,
            'sp_np':       product.sp_np,
            'shelf_life':  product.shelf_life,
            'created_at':  product.created_at.strftime('%Y-%m-%d %H:%M:%S') if product.created_at else None,
            'updated_at':  product.updated_at.strftime('%Y-%m-%d %H:%M:%S') if product.updated_at else None,
            'aliases': [
                {
                    'id':         a.id,
                    'alias_name': a.alias_name,
                }
                for a in product.aliases
            ],
        })

    return {
        'type': 'success',
        'products': product_list,
        'pagination_data': {
            'current_page':  current_page,
            'total_pages':   total_pages,
            'total_results': total_results,
        }
    }



#Product Masterlist add api for v2   
@api_handles.route('/add_product_master', methods=['POST'])
@login_required
def add_product_master():
    if current_user.role not in ('Superadmin', 'Admin'):
        return {'type': 'error', 'message': 'Access denied.'}, 403
    try:
        data = request.get_json()

        # Validate required fields
        for field in ('description', 'category'):
            if not data.get(field):
                return {'type': 'error', 'message': f'Missing required field: {field}'}, 400

        # Check if code already exists
        existing = ProductMaster.query.filter_by(code=(data['code'])).first()
        if existing:
            return {'type': 'error', 'message': 'Product with this code already exists.'}, 400

        # Create new product
        product = ProductMaster(
            code        = data['code'],
            description = data['description'].strip(),
            category    = data['category'].strip(),
            sub_category= data.get('sub_category', '').strip() or None,
            tp          = float(data['tp']),
            sp_p        = float(data['sp_p']),
            sp_np       = float(data['sp_np']),
            shelf_life  = data.get('shelf_life', '').strip() or None,
        )
        db.session.add(product)
        db.session.commit()

        # Record initial prices as first price history entry
        db.session.add(ProductPriceChangeLog(
            product_id          = product.id,
            change_type         = 'CREATE',
            product_code        = str(product.code) if product.code is not None else None,
            product_description = product.description,
            old_tp              = None,
            new_tp              = product.tp,
            old_sp_p            = None,
            new_sp_p            = product.sp_p,
            old_sp_np           = None,
            new_sp_np           = product.sp_np,
            changed_by          = current_user.id,
            changed_by_username = getattr(current_user, 'username', None),
        ))
        db.session.commit()

        return {'type': 'success', 'message': 'Product added successfully.'}, 200

    except ValueError as e:
        db.session.rollback()
        return {'type': 'error', 'message': f'Invalid data format: {str(e)}'}, 400
    except Exception as e:
        db.session.rollback()
        return {'type': 'error', 'message': f'Error adding product: {str(e)}'}, 500
    
    
# Updating Product route for v2
@api_handles.route('update_product_master/<int:product_id>', methods=['POST',"GET"])
@login_required
def update_product_master(product_id):
    if current_user.role not in ('Superadmin', 'Admin'):
        return {'type': 'error', 'message': 'Access denied.'}, 403
    try:
        data = request.get_json()

        # Find product
        product = ProductMaster.query.get(product_id)
        if not product:
            return {'type': 'error', 'message': 'Product not found.'}, 404

        # Validate required fields
        for field in ('code', 'description', 'category'):
            if not data.get(field):
                return {'type': 'error', 'message': f'Missing required field: {field}'}, 400

        # Check code uniqueness against other products
        code = (data['code'])
        existing = ProductMaster.query.filter(
            ProductMaster.code == code,
            ProductMaster.id != product_id
        ).first()
        if existing:
            return {'type': 'error', 'message': 'Another product with this code already exists.'}, 400

        # Capture old prices before update
        old_tp    = product.tp
        old_sp_p  = product.sp_p
        old_sp_np = product.sp_np

        # Apply updates
        product.code         = code
        product.description  = data['description'].strip()
        product.category     = data['category'].strip()
        product.sub_category = data.get('sub_category', '').strip() or None
        product.tp           = float(data['tp'])
        product.sp_p         = float(data['sp_p'])
        product.sp_np        = float(data['sp_np'])
        product.shelf_life   = data.get('shelf_life', '').strip() or None

        db.session.commit()

        # Record price change log if any price actually changed
        if any([
            (old_tp    or 0) != (product.tp    or 0),
            (old_sp_p  or 0) != (product.sp_p  or 0),
            (old_sp_np or 0) != (product.sp_np or 0),
        ]):
            db.session.add(ProductPriceChangeLog(
                product_id          = product.id,
                change_type         = 'UPDATE',
                product_code        = str(product.code) if product.code is not None else None,
                product_description = product.description,
                old_tp              = old_tp,
                new_tp              = product.tp,
                old_sp_p            = old_sp_p,
                new_sp_p            = product.sp_p,
                old_sp_np           = old_sp_np,
                new_sp_np           = product.sp_np,
                changed_by          = current_user.id,
                changed_by_username = getattr(current_user, 'username', None),
            ))
            db.session.commit()

        # Audit log
        log_audit_event(
            current_user.id,
            'UPDATE',
            'ProductMaster',
            product.id,
            {'action': 'Updated product', 'code': product.code, 'description': product.description}
        )

        return {'type': 'success', 'message': 'Product updated successfully.'}, 200

    except ValueError as e:
        db.session.rollback()
        return {'type': 'error', 'message': f'Invalid data format: {str(e)}'}, 400
    except Exception as e:
        db.session.rollback()
        return {'type': 'error', 'message': f'Error updating product: {str(e)}'}, 500
 

#removing product from masterlist v2
@api_handles.route('/delete_product_master/<int:product_id>', methods=['POST'])
@login_required
def delete_product_master(product_id):
    if current_user.role not in ('Superadmin', 'Admin'):
        return {'type': 'error', 'message': 'Access denied.'}, 403
    try:
        # Find product
        product = ProductMaster.query.get(product_id)
        if not product:
            return {'type': 'error', 'message': 'Product not found.'}, 404

        # Store product info before deletion
        product_code        = product.code
        product_description = product.description

        # Delete product
        db.session.delete(product)
        db.session.commit()

        return {'type': 'success', 'message': 'Product deleted successfully.'}, 200

    except Exception as e:
        db.session.rollback()
        return {'type': 'error', 'message': f'Error deleting product: {str(e)}'}, 500


# = Product price change log =====
@api_handles.route('/getPriceHistoryByProductId', methods=['GET','POST'])
def get_price_history_by_product_id():
    try:
        product_id = int(request.args.get('product_id') or request.form.get('product_id'))
    except (ValueError, TypeError):
        return jsonify({'error': 'Invalid product_id'}), 400
    
    print(product_id)
    
    if not product_id:
        return jsonify({'error': 'product_id is required'}), 400

    logs = (
        db.session.query(ProductPriceChangeLog, ProductMaster)
        .join(ProductMaster, ProductPriceChangeLog.product_id == ProductMaster.id)
        .filter(ProductPriceChangeLog.product_id == product_id)
        .order_by(ProductPriceChangeLog.changed_at.asc())
        .all()
    )

    if not logs:
        return jsonify({
            'product_id':          product_id,
            'product_code':        None,
            'product_description': None,
            'product':             None,
            'stats_data':          []
        })

    # Aggregate: keep the LAST entry per calendar date
    daily = {}
    for log, product in logs:
        date_key = log.changed_at.strftime('%Y-%m-%d')
        daily[date_key] = (log, product)

    chart_data = []
    for date_key in sorted(daily.keys()):
        log, _ = daily[date_key]
        chart_data.append({
            'date':  date_key,
            'tp':    log.new_tp,
            'sp_p':  log.new_sp_p,
            'sp_np': log.new_sp_np,
        })

    _, product = list(daily.values())[-1]
    return jsonify({
        'product_id':          product_id,
        'product_code':        product.code,
        'product_description': product.description,
        'product': {
            'id':           product.id,
            'code':         product.code,
            'description':  product.description,
            'category':     product.category,
            'sub_category': product.sub_category,
            'tp':           product.tp,
            'sp_p':         product.sp_p,
            'sp_np':        product.sp_np
        },
        'stats_data': chart_data
    })

 
# ================================
# Product Masterlist Section End
# ================================

  
# ================================
# Clusters Section Start
# ================================
@api_handles.route('/clusters_list_admin', methods=['POST','GET'])
@login_required
def list_clusters_admin():
    if current_user.role not in ('Superadmin', 'Admin', 'General Manager'):
        return jsonify({ 'type': 'error', 'message': 'Access denied.' }), 403

    can_manage = current_user.role in ('Superadmin', 'Admin')

    try:
        current_page = int(request.form.get('page') or request.args.get('page') or 1)
    except (ValueError, TypeError):
        current_page = 1

    per_page = post_per_page

    query = Cluster.query.options(
        selectinload(Cluster.stores),
        selectinload(Cluster.manager)
    )

    # -- Search -----------------------------------------------
    search = request.form.get('search')
    if search:
        pattern = f'%{search}%'
        query = query.join(User, Cluster.manager_id == User.id, isouter=True).filter(
            or_(
                Cluster.name.ilike(pattern),
                Cluster.description.ilike(pattern),
                User.full_name.ilike(pattern),
                User.username.ilike(pattern),
            )
        )

    # -- Sorting ----------------------------------------------
    sortby = request.form.get('sort')
    order = request.form.get('order_by', 'asc').lower()

    sortable_columns = {
        'id':         Cluster.id,
        'name':       Cluster.name,
        'date_added': Cluster.date_added,
    }

    if sortby in sortable_columns:
        sort_col = sortable_columns[sortby]
        query = query.order_by(desc(sort_col) if order == 'desc' else asc(sort_col))
    else:
        query = query.order_by(Cluster.id.asc())

    # -- Pagination -------------------------------------------
    pagination    = query.paginate(page=current_page, per_page=per_page, error_out=False)
    results       = pagination.items
    total_pages   = pagination.pages
    total_results = pagination.total

    # -- Serialize --------------------------------------------
    data = []
    for c in results:
        data.append({
            'id':              c.id,
            'name':            c.name,
            'description':     c.description,
            'store_count':     len(c.stores),
            'manager_id':      c.manager_id,
            'manager_name':    c.manager.full_name if c.manager else 'Unassigned',
            'manager_initial': c.manager.username[0].upper() if c.manager else '?',
            'date_added':      c.date_added.strftime('%b %d, %Y') if c.date_added else None,
        })

    return jsonify({
        'type': 'success',
        'data': {
            'clusters':   data,
            'can_manage': can_manage,
        },
        'pagination_data': {
            'current_page':  current_page,
            'total_pages':   total_pages,
            'total_results': total_results,
        }
    })



@api_handles.route('/clusters_create', methods=['POST', 'GET'])
@login_required
def clusters_create_admin():
    if current_user.role not in ('Superadmin', 'Admin'):
        return jsonify({ 'type': 'error', 'message': 'Access denied.' }), 403

    try:
        body       = request.get_json()
        name       = (body.get('name') or '').strip()
        description = (body.get('description') or '').strip()
        manager_id = body.get('manager_id')

        if not name:
            return jsonify({ 'type': 'error', 'message': 'Cluster name is required.' })

        if Cluster.query.filter_by(name=name).first():
            return jsonify({ 'type': 'error', 'message': f'Cluster "{name}" already exists.' })

        new_cluster = Cluster(
            name=name,
            description=description,
            manager_id=int(manager_id) if manager_id else None
        )

        db.session.add(new_cluster)
        db.session.flush()

        log_audit_event(
            action='admin.cluster.create',
            entity_type='Cluster',
            entity_id=new_cluster.id,
            reason='Cluster created by administrator.',
            details={
                'name':        new_cluster.name,
                'description': new_cluster.description,
                'manager_id':  new_cluster.manager_id,
            },
        )

        db.session.commit()

        return jsonify({ 'type': 'success', 'message': f'Cluster "{name}" created successfully.' })

    except Exception as e:
        db.session.rollback()
        return jsonify({ 'type': 'error', 'message': f'Error creating cluster: {str(e)}.' })



@api_handles.route('/clusters_update', methods=['POST', 'GET'])
@login_required
def clusters_update_admin():
    if current_user.role not in ('Superadmin', 'Admin'):
        return jsonify({ 'type': 'error', 'message': 'Access denied.' }), 403

    try:
        body        = request.get_json()
        cluster_id  = body.get('id')
        name        = (body.get('name') or '').strip()
        description = (body.get('description') or '').strip()
        manager_id  = body.get('manager_id')

        if not cluster_id:
            return jsonify({ 'type': 'error', 'message': 'Cluster ID is required.' })

        if not name:
            return jsonify({ 'type': 'error', 'message': 'Cluster name is required.' })

        cluster = Cluster.query.get(cluster_id)

        if not cluster:
            return jsonify({ 'type': 'error', 'message': 'Cluster not found.' })

        # Check name conflict against other clusters
        existing = Cluster.query.filter_by(name=name).first()
        if existing and existing.id != cluster.id:
            return jsonify({ 'type': 'error', 'message': f'Cluster "{name}" already exists.' })

        old_details = {
            'name':        cluster.name,
            'description': cluster.description,
            'manager_id':  cluster.manager_id,
        }

        cluster.name        = name
        cluster.description = description
        cluster.manager_id  = int(manager_id) if manager_id else None

        log_audit_event(
            action='admin.cluster.update',
            entity_type='Cluster',
            entity_id=cluster.id,
            reason='Cluster updated by administrator.',
            details={
                'before': old_details,
                'after': {
                    'name':        cluster.name,
                    'description': cluster.description,
                    'manager_id':  cluster.manager_id,
                },
            },
        )

        db.session.commit()

        return jsonify({ 'type': 'success', 'message': f'Cluster "{name}" updated successfully.' })

    except Exception as e:
        db.session.rollback()
        return jsonify({ 'type': 'error', 'message': f'Error updating cluster: {str(e)}.' })
        


@api_handles.route('/clusters_delete', methods=['POST', 'GET'])
@login_required
def clusters_delete_admin():
    if current_user.role not in ('Superadmin', 'Admin'):
        return jsonify({ 'type': 'error', 'message': 'Access denied.' }), 403

    try:
        body       = request.get_json()
        cluster_id = body.get('id')

        if not cluster_id:
            return jsonify({ 'type': 'error', 'message': 'Cluster ID is required.' })

        cluster = Cluster.query.get(cluster_id)

        if not cluster:
            return jsonify({ 'type': 'error', 'message': 'Cluster not found.' })

        if cluster.stores:
            return jsonify({ 'type': 'error', 'message': f'Cluster "{cluster.name}" still has {len(cluster.stores)} store(s). Remove all stores before deleting.' })

        cluster_name = cluster.name

        log_audit_event(
            action='admin.cluster.delete',
            entity_type='Cluster',
            entity_id=cluster.id,
            reason='Cluster deleted by administrator.',
            details={
                'name':        cluster.name,
                'description': cluster.description,
                'manager_id':  cluster.manager_id,
            },
        )

        db.session.delete(cluster)
        db.session.commit()

        return jsonify({ 'type': 'success', 'message': f'Cluster "{cluster_name}" deleted successfully.' })

    except Exception as e:
        db.session.rollback()
        return jsonify({ 'type': 'error', 'message': f'Error deleting cluster: {str(e)}.' })



@api_handles.route('/clusters_managers', methods=['POST', 'GET'])
@login_required
def clusters_managers_admin():
    if current_user.role not in ('Superadmin', 'Admin'):
        return jsonify({ 'type': 'error', 'message': 'Access denied.' }), 403

    try:
        managers = User.query.filter_by(role='Cluster Manager').all()

        data = [
            {
                'id':        m.id,
                'full_name': m.full_name,
                'username':  m.username,
            }
            for m in managers
        ]

        return jsonify({ 'type': 'success', 'data': data })

    except Exception as e:
        return jsonify({ 'type': 'error', 'message': f'Error loading managers: {str(e)}.' })

# ================================
# Clusters Masterlist Section End
# ================================

 
 
# ================================
# Stores Section Start
# ================================
@api_handles.route('/stores', methods=['POST', 'GET'])
@login_required
def api_stores_list():
    if current_user.role not in ('Superadmin', 'Admin', 'General Manager', 'Cluster Manager'):
        return jsonify({'type': 'error', 'message': 'Access denied.'}), 403
    can_manage = current_user.role in ('Superadmin', 'Admin')
    try:
        current_page = int(request.form.get('page') or request.args.get('page') or 1)
    except (ValueError, TypeError):
        current_page = 1
    per_page = post_per_page
    query = Store.query.options(
        selectinload(Store.manager),
        selectinload(Store.cluster)
    )
    # -- Scope filter -----------------------------------------
    store_scope = request.form.get('store_scope') or request.args.get('store_scope')
    if store_scope == 'starlink':
        query = query.filter(Store.name.ilike('%starlink%'))
    else:
        query = query.filter(~Store.name.ilike('%starlink%'))
    # -- Search -----------------------------------------------
    search = request.form.get('search') or request.args.get('search')
    if search:
        pattern = f'%{search}%'
        query = query.filter(
            or_(
                Store.name.ilike(pattern),
                Store.address.ilike(pattern),
            )
        )
    # -- Sorting ----------------------------------------------
    sortby = request.form.get('sort') or request.args.get('sort')
    order  = (request.form.get('order_by') or request.args.get('order_by') or 'asc').lower()
    sortable_columns = {
        'id':         Store.id,
        'name':       Store.name,
        'address':    Store.address,
        'date_added': Store.date_added,
    }
    if sortby in sortable_columns:
        sort_col = sortable_columns[sortby]
        query = query.order_by(desc(sort_col) if order == 'desc' else asc(sort_col))
    else:
        query = query.order_by(Store.id.asc())
    # -- Pagination -------------------------------------------
    pagination    = query.paginate(page=current_page, per_page=per_page, error_out=False)
    results       = pagination.items
    total_pages   = pagination.pages
    total_results = pagination.total
    # -- Serialize --------------------------------------------
    data = []
    for s in results:
        data.append({
            'id':                  s.id,
            'name':                s.name,
            'address':             s.address,
            'is_one_year_already': s.is_one_year_already,
            'manager_id':          s.manager_id,
            'manager_name':        s.manager.full_name if s.manager else None,
            'manager_username':    s.manager.username if s.manager else None,
            'cluster_name':        s.cluster.name if s.cluster else None,
            'date_added':          s.date_added.strftime('%b %d, %Y') if s.date_added else None,
        })
    return jsonify({
        'type': 'success',
        'data': {
            'stores':     data,
            'can_manage': can_manage,
        },
        'pagination_data': {
            'current_page':  current_page,
            'total_pages':   total_pages,
            'total_results': total_results,
        }
    })


@api_handles.route('/stores_managers_available', methods=['GET', 'POST'])
@login_required
def api_stores_managers_available():
    from .views import _apply_store_scope_filter
    all_stores = Store.query.all()
    scoped_stores = _apply_store_scope_filter(all_stores, request)
    assigned_manager_ids = [s.manager_id for s in scoped_stores if s.manager_id]
    available_managers = User.query.filter(
        User.role == 'Store Manager',
        ~User.id.in_(assigned_manager_ids)
    ).all()
    return jsonify({
        'type': 'success',
        'data': [
            {'id': m.id, 'full_name': m.full_name, 'username': m.username}
            for m in available_managers
        ]
    })
    
    
    

@api_handles.route('/managers_all', methods=['GET', 'POST'])
@login_required
def api_stores_managers_all():
    all_managers = User.query.filter(User.role == 'Store Manager').all()
    return jsonify({
        'type': 'success',
        'data': [
            {'id': m.id, 'full_name': m.full_name, 'username': m.username}
            for m in all_managers
        ]
    })
 
 
 

@api_handles.route('/stores/create', methods=['POST'])
@login_required
def api_stores_create():
    try:
        data       = request.get_json()
        name       = (data.get('name') or '').strip()
        address    = (data.get('address') or '').strip()
        manager_id = data.get('manager_id') or None
        is_one_year_already = data.get('is_one_year_already', '0') == '1'

        if not name or not address:
            return jsonify({'type': 'error', 'message': 'Store name and address are required.'}), 400

        if Store.query.filter_by(name=name).first():
            return jsonify({'type': 'error', 'message': 'A store with this name already exists.'}), 400

        new_store = Store(
            name=name,
            address=address,
            is_one_year_already=is_one_year_already,
            manager_id=int(manager_id) if manager_id else None
        )
        db.session.add(new_store)
        db.session.flush()
        log_audit_event(
            action='admin.store.create',
            entity_type='Store',
            entity_id=new_store.id,
            reason='Store created by administrator.',
            details={
                'name':                new_store.name,
                'address':             new_store.address,
                'store_group':         new_store.store_group,
                'is_one_year_already': new_store.is_one_year_already,
                'manager_id':          new_store.manager_id,
            },
        )
        db.session.commit()
        return jsonify({'type': 'success', 'message': f'Store "{name}" created successfully.'})

    except Exception as e:
        db.session.rollback()
        return jsonify({'type': 'error', 'message': f'Error creating store: {str(e)}'}), 500
 


@api_handles.route('/stores/<int:store_id>/assign-manager', methods=['POST'])
@login_required
def api_stores_assign_manager(store_id):
    try:
        store = Store.query.get_or_404(store_id)
        data = request.get_json()
        manager_id = data.get('manager_id')
        previous_manager_id = store.manager_id

        if not manager_id:
            return jsonify({'type': 'error', 'message': 'Please select a manager.'}), 400

        manager = User.query.get(int(manager_id))
        if not manager or manager.role != 'Store Manager':
            return jsonify({'type': 'error', 'message': 'Invalid manager selection.'}), 400

        existing_store = Store.query.filter_by(manager_id=int(manager_id)).first()
        if existing_store and existing_store.id != store_id:
            return jsonify({'type': 'error', 'message': f'Manager {manager.full_name} is already assigned to {existing_store.name}.'}), 400

        store.manager_id = int(manager_id)
        log_audit_event(
            action='admin.store.assign_manager',
            entity_type='Store',
            entity_id=store.id,
            reason='Store manager reassigned.',
            details={
                'store_name':          store.name,
                'previous_manager_id': previous_manager_id,
                'new_manager_id':      store.manager_id,
            },
        )
        db.session.commit()
        return jsonify({'type': 'success', 'message': f'Manager "{manager.full_name}" assigned to "{store.name}" successfully.'})

    except Exception as e:
        db.session.rollback()
        return jsonify({'type': 'error', 'message': f'Error assigning manager: {str(e)}'}), 500


@api_handles.route('/stores/<int:store_id>/update', methods=['POST'])
@login_required
def api_stores_update(store_id):
    if current_user.role not in ('Superadmin', 'Admin'):
        return jsonify({'type': 'error', 'message': 'Access denied. Only Admins and Superadmins can update stores.'}), 403

    try:
        store = Store.query.get_or_404(store_id)
        data  = request.get_json()

        previous_state = {
            'name':                store.name,
            'address':             store.address,
            'is_one_year_already': store.is_one_year_already,
            'manager_id':          store.manager_id,
        }

        name                = (data.get('name') or '').strip()
        address             = (data.get('address') or '').strip()
        is_one_year_already = data.get('is_one_year_already', '0') == '1'
        manager_id_raw      = (data.get('manager_id') or '')

        if not name or not address:
            return jsonify({'type': 'error', 'message': 'Store name and address are required.'}), 400

        if name != store.name:
            existing = Store.query.filter(Store.name == name, Store.id != store_id).first()
            if existing:
                return jsonify({'type': 'error', 'message': 'A store with this name already exists.'}), 400

        new_manager_id = None
        if manager_id_raw:
            new_manager_id = int(manager_id_raw)
            manager = User.query.get(new_manager_id)
            if not manager or manager.role != 'Store Manager':
                return jsonify({'type': 'error', 'message': 'Invalid manager selection.'}), 400

            existing_store = Store.query.filter_by(manager_id=new_manager_id).first()
            if existing_store and existing_store.id != store_id:
                return jsonify({'type': 'error', 'message': f'Manager {manager.full_name} is already assigned to {existing_store.name}.'}), 400

        store.name                = name
        store.address             = address
        store.is_one_year_already = is_one_year_already
        store.manager_id          = new_manager_id

        log_audit_event(
            action='admin.store.update',
            entity_type='Store',
            entity_id=store.id,
            reason='Store updated by administrator.',
            details={
                'before': previous_state,
                'after': {
                    'name':                store.name,
                    'address':             store.address,
                    'is_one_year_already': store.is_one_year_already,
                    'manager_id':          store.manager_id,
                },
            },
        )
        db.session.commit()
        return jsonify({'type': 'success', 'message': f'Store "{name}" updated successfully.'})

    except Exception as e:
        db.session.rollback()
        return jsonify({'type': 'error', 'message': f'Error updating store: {str(e)}'}), 500


@api_handles.route('/stores/<int:store_id>/delete', methods=['POST'])
@login_required
def api_stores_delete(store_id):
    if current_user.role not in ('Superadmin', 'Admin'):
        return jsonify({'type': 'error', 'message': 'Access denied. Only Admins and Superadmins can delete stores.'}), 403

    try:
        store = Store.query.get_or_404(store_id)
        store_snapshot = {
            'name':       store.name,
            'address':    store.address,
            'manager_id': store.manager_id,
        }
        log_audit_event(
            action='admin.store.delete',
            entity_type='Store',
            entity_id=store.id,
            reason='Store deleted by administrator.',
            details=store_snapshot,
        )
        db.session.delete(store)
        db.session.commit()
        return jsonify({'type': 'success', 'message': f'Store "{store_snapshot["name"]}" deleted successfully.'})

    except Exception as e:
        db.session.rollback()
        return jsonify({'type': 'error', 'message': f'Error deleting store: {str(e)}'}), 500
 
# ================================
# Stores Section End
# ================================
  
  
  
# ================================
# Stores Targets Section Start
# ================================
  
@api_handles.route('/targets/sheet', methods=['GET', 'POST'])
@login_required
def targets_sheet():
    if current_user.role not in ('Superadmin', 'General Manager'):
        return jsonify({'type': 'error', 'message': 'Access denied.'}), 403

    try:
        store_id = request.form.get('store_id') or request.args.get('store_id')
        month    = (request.form.get('month') or request.args.get('month') or '').strip()

        if not store_id:
            return jsonify({'type': 'error', 'message': 'No store selected.'}), 400

        store = Store.query.get(int(store_id))
        if not store:
            return jsonify({'type': 'error', 'message': 'Store not found.'}), 404

        try:
            month_start = datetime.strptime(month, '%Y-%m').date().replace(day=1)
        except ValueError:
            month_start = date.today().replace(day=1)

        next_month = (
            date(month_start.year + 1, 1, 1)
            if month_start.month == 12
            else date(month_start.year, month_start.month + 1, 1)
        )

        targets = StoreTarget.query.filter(
            StoreTarget.store_id == int(store_id),
            StoreTarget.target_date >= month_start,
            StoreTarget.target_date < next_month,
        ).all()

        target_by_date = {t.target_date: t for t in targets}

        rows = []
        current_date = month_start
        while current_date < next_month:
            t = target_by_date.get(current_date)
            rows.append({
                'date':          current_date.strftime('%Y-%m-%d'),
                'date_label':    current_date.strftime('%b %d, %Y'),
                'target_net':    float(t.target_net    or 0) if t else 0.0,
                'last_year_net': float(t.last_year_net or 0) if t else 0.0,
                'gbi_target':    float(t.gbi_target    or 0) if t else 0.0,
            })
            current_date += timedelta(days=1)

        cluster_data_url = None
        if store.cluster_id:
            cluster_data_url = url_for(
                'views.cluster_manager_cluster_data',
                cluster_id=store.cluster_id,
                store_id=store_id,
                month=f'{month_start.month:02d}',
                year=str(month_start.year),
            )

        return jsonify({
            'type':             'success',
            'rows':             rows,
            'cluster_data_url': cluster_data_url,
        })

    except Exception as e:
        return jsonify({'type': 'error', 'message': str(e)})
  
  
@api_handles.route('/targets/save', methods=['POST'])
@login_required
def targets_save():
    if current_user.role not in ('Superadmin', 'General Manager'):
        return jsonify({'type': 'error', 'message': 'Access denied.'}), 403

    try:
        store_id       = request.form.get('store_id', type=int)
        cluster_id     = request.form.get('cluster_id', type=int)
        selected_month = (request.form.get('target_month') or '').strip()

        if not store_id:
            return jsonify({'type': 'error', 'message': 'Please select a store.'}), 400

        store = Store.query.get(store_id)
        if not store:
            return jsonify({'type': 'error', 'message': 'Store not found.'}), 404

        if not cluster_id:
            cluster_id = store.cluster_id

        try:
            month_start = datetime.strptime(selected_month, '%Y-%m').date().replace(day=1)
        except ValueError:
            return jsonify({'type': 'error', 'message': 'Invalid month format.'}), 400

        next_month = (
            date(month_start.year + 1, 1, 1)
            if month_start.month == 12
            else date(month_start.year, month_start.month + 1, 1)
        )

        existing_targets = {
            t.target_date: t
            for t in StoreTarget.query.filter(
                StoreTarget.store_id == store_id,
                StoreTarget.target_date >= month_start,
                StoreTarget.target_date < next_month,
            ).all()
        }

        date_values       = request.form.getlist('target_date[]')
        target_net_values = request.form.getlist('target_net[]')
        last_year_values  = request.form.getlist('last_year_net[]')
        gbi_target_values = request.form.getlist('gbi_target[]')

        saved_count = 0
        for idx, raw_date in enumerate(date_values):
            try:
                target_date = datetime.strptime(str(raw_date or '').strip(), '%Y-%m-%d').date()
            except ValueError:
                continue

            if target_date < month_start or target_date >= next_month:
                continue

            target = existing_targets.get(target_date)
            if not target:
                target = StoreTarget(
                    store_id=store_id,
                    target_date=target_date,
                    uploaded_by=current_user.id,
                )
                db.session.add(target)

            target.target_net    = float(target_net_values[idx])    if idx < len(target_net_values)    and target_net_values[idx]    else 0.0
            target.last_year_net = float(last_year_values[idx])     if idx < len(last_year_values)     and last_year_values[idx]     else 0.0
            target.gbi_target    = float(gbi_target_values[idx])    if idx < len(gbi_target_values)    and gbi_target_values[idx]    else 0.0
            saved_count += 1

        log_audit_event(
            action='admin.targets.month_save',
            entity_type='StoreTarget',
            entity_id=store_id,
            reason='Monthly store targets saved from grid.',
            details={
                'store_id':      store_id,
                'target_month':  selected_month,
                'records_saved': saved_count,
            },
        )
        db.session.commit()

        return jsonify({
            'type':    'success',
            'message': f'Saved {saved_count} target rows for {selected_month}. Cluster Data will reflect TARGET (NET), LAST YEAR (NET), and GBI TARGET for {store.name}.',
        })

    except Exception as e:
        db.session.rollback()
        return jsonify({'type': 'error', 'message': str(e)}), 500 
  
# ================================
# Stores Targets Section End
# ================================
   
   
   
# ================================
# Supply Request Section Start
# ================================


# ================================================
# Supply Items - List

@api_handles.route('/supply_items', methods=['GET', 'POST'])
@login_required
def api_supply_items():
    if current_user.role not in ('Superadmin', 'Admin'):
        return jsonify({'type': 'error', 'message': 'Access denied.'}), 403

    try:
        page = int(request.form.get('page') or request.args.get('page') or 1)
    except (ValueError, TypeError):
        page = 1

    category = (request.form.get('category') or request.args.get('category') or '').strip()
    search   = (request.form.get('search')   or request.args.get('search')   or '').strip()
    per_page = post_per_page

    if category == 'all':
        category = None

    query = SupplyItem.query

    if category:
        query = query.filter(SupplyItem.category == category)

    if search:
        pattern = f'%{search}%'
        query = query.filter(
            or_(
                SupplyItem.item_name.ilike(pattern),
                SupplyItem.category.ilike(pattern),
            )
        )

    # -- Sorting ----------------------------------------------
    sortby = (request.form.get('sort') or request.args.get('sort') or '').strip()
    order  = (request.form.get('order_by') or request.args.get('order_by') or 'asc').lower()
    sortable_columns = {
        'item_name':       SupplyItem.item_name,
        'category':        SupplyItem.category,
        'available_stock': SupplyItem.available_stock,
    }
    if sortby in sortable_columns:
        sort_col = sortable_columns[sortby]
        query = query.order_by(desc(sort_col) if order == 'desc' else asc(sort_col))
    else:
        query = query.order_by(SupplyItem.category.asc(), SupplyItem.item_name.asc())

    # -- Pagination -------------------------------------------
    paginated = query.paginate(page=page, per_page=per_page, error_out=False)

    categories = [
        c[0] for c in
        db.session.query(SupplyItem.category).distinct().order_by(SupplyItem.category.asc()).all()
    ]

    data = []
    for item in paginated.items:
        data.append({
            'id':              item.id,
            'item_name':       item.item_name,
            'category':        item.category,
            'available_stock': item.available_stock,
        })

    return jsonify({
        'type': 'success',
        'data': data,
        'pagination_data': {
            'current_page':  paginated.page,
            'total_pages':   paginated.pages,
            'total_results': paginated.total,
        },
        'categories': categories,
    })
   

# ================================================
# Supply Item - Create

@api_handles.route('/supply_items/create', methods=['POST'])
@login_required
def api_create_supply_item():
    if current_user.role not in ('Superadmin', 'Admin'):
        return jsonify({'type': 'error', 'message': 'Access denied.'}), 403

    data = request.get_json() or {}
    category  = str(data.get('category')  or '').strip()[:100]
    item_name = str(data.get('item_name') or '').strip()[:255]
    try:
        available_stock = max(0, int(data.get('available_stock') or 0))
    except (TypeError, ValueError):
        available_stock = 0

    if not category or not item_name:
        return jsonify({'type': 'error', 'message': 'Category and item name are required.'})

    existing = SupplyItem.query.filter(
        SupplyItem.category  == category,
        SupplyItem.item_name == item_name,
    ).first()
    if existing:
        return jsonify({'type': 'error', 'message': 'An item with this name already exists in this category.'})

    item = SupplyItem(category=category, item_name=item_name, available_stock=available_stock)
    db.session.add(item)
    try:
        db.session.flush()
        log_audit_event(
            action='admin.supply_item.create',
            entity_type='SupplyItem',
            entity_id=item.id,
            reason=f'Admin created supply item {item_name}',
            details={'category': category, 'item_name': item_name, 'available_stock': available_stock},
        )
        db.session.commit()
    except Exception as e:
        db.session.rollback()
        return jsonify({'type': 'error', 'message': 'Failed to create item.'})

    return jsonify({'type': 'success', 'message': f'Supply item "{item_name}" created.', 'id': item.id})


# ================================================
# Supply Item - Update

@api_handles.route('/supply_items/<int:item_id>/update', methods=['POST'])
@login_required
def api_update_supply_item(item_id):
    if current_user.role not in ('Superadmin', 'Admin'):
        return jsonify({'type': 'error', 'message': 'Access denied.'}), 403

    item = SupplyItem.query.get_or_404(item_id)
    data = request.get_json() or {}
    category  = str(data.get('category')  or '').strip()[:100]
    item_name = str(data.get('item_name') or '').strip()[:255]
    try:
        available_stock = max(0, int(data.get('available_stock') or 0))
    except (TypeError, ValueError):
        available_stock = 0

    if not category or not item_name:
        return jsonify({'type': 'error', 'message': 'Category and item name are required.'}), 400

    duplicate = SupplyItem.query.filter(
        SupplyItem.category  == category,
        SupplyItem.item_name == item_name,
        SupplyItem.id        != item.id,
    ).first()
    if duplicate:
        return jsonify({'type': 'error', 'message': 'An item with this name already exists in this category.'}), 400

    old_stock      = item.available_stock
    item.category  = category
    item.item_name = item_name
    item.available_stock = available_stock

    try:
        log_audit_event(
            action='admin.supply_item.update',
            entity_type='SupplyItem',
            entity_id=item.id,
            reason=f'Admin updated supply item {item_name}',
            details={
                'category':  category,
                'item_name': item_name,
                'old_stock': old_stock,
                'new_stock': available_stock,
            },
        )
        db.session.commit()
    except Exception as e:
        db.session.rollback()
        return jsonify({'type': 'error', 'message': 'Failed to update item.'}), 500

    return jsonify({'type': 'success', 'message': f'Supply item "{item_name}" updated.'})



# ================================================
# Supply Item - Delete
@api_handles.route('/supply_items/<int:item_id>/delete', methods=['POST'])
@login_required
def api_delete_supply_item(item_id):
    if current_user.role not in ('Superadmin', 'Admin'):
        return jsonify({'type': 'error', 'message': 'Access denied.'}), 403

    item = SupplyItem.query.get_or_404(item_id)
    item_name = item.item_name
    category  = item.category

    try:
        SupplyRequestItem.query.filter_by(supply_item_id=item.id).update({'supply_item_id': None})
        log_audit_event(
            action='admin.supply_item.delete',
            entity_type='SupplyItem',
            entity_id=item.id,
            reason=f'Admin deleted supply item {item_name}',
            details={'category': category, 'item_name': item_name},
        )
        db.session.delete(item)
        db.session.commit()
    except Exception as e:
        db.session.rollback()
        return jsonify({'type': 'error', 'message': 'Failed to delete item.'}), 500

    return jsonify({'type': 'success', 'message': f'Supply item "{item_name}" deleted.'})



# ================================================
# Supply Requests - List

@api_handles.route('/supply_requests', methods=['GET', 'POST'])
@login_required
def api_supply_requests():
    if current_user.role not in ('Superadmin', 'Admin'):
        return jsonify({'type': 'error', 'message': 'Access denied.'}), 403

    try:
        page = int(request.form.get('page') or request.args.get('page') or 1)
    except (ValueError, TypeError):
        page = 1

    status  = (request.form.get('status') or request.args.get('status') or '').strip()
    search  = (request.form.get('search') or request.args.get('search') or '').strip()
    per_page = post_per_page

    query = SupplyRequest.query.options(
        selectinload(SupplyRequest.items),
        selectinload(SupplyRequest.requester),
        selectinload(SupplyRequest.approver),
        selectinload(SupplyRequest.rejecter),
    )

    if status in ('Pending', 'Approved', 'Rejected'):
        query = query.filter(SupplyRequest.status == status)

    if search:
        pattern = f'%{search}%'
        query = query.filter(
            or_(
                SupplyRequest.request_no.ilike(pattern),
                SupplyRequest.store_name.ilike(pattern),
            )
        )

    # -- Sorting ----------------------------------------------
    sortby = (request.form.get('sort') or request.args.get('sort') or '').strip()
    order  = (request.form.get('order_by') or request.args.get('order_by') or 'desc').lower()
    sortable_columns = {
        'request_no': SupplyRequest.request_no,
        'store_name': SupplyRequest.store_name,
        'status':     SupplyRequest.status,
        'created_at': SupplyRequest.created_at,
    }
    if sortby in sortable_columns:
        sort_col = sortable_columns[sortby]
        query = query.order_by(desc(sort_col) if order == 'desc' else asc(sort_col))
    else:
        query = query.order_by(SupplyRequest.created_at.desc(), SupplyRequest.id.desc())

    # -- Pagination -------------------------------------------
    paginated     = query.paginate(page=page, per_page=per_page, error_out=False)
    pending_count = SupplyRequest.query.filter_by(status='Pending').count()

    def fmt_dt(dt):
        return dt.strftime('%b %d, %Y %I:%M %p') if dt else None

    data = []
    for req in paginated.items:
        data.append({
            'id':           req.id,
            'request_no':   req.request_no,
            'created_at':   fmt_dt(req.created_at),
            'store_name':   req.store_name or (req.store.name if req.store else None),
            'request_type': req.request_type,
            'requester':    req.requester.username if req.requester else None,
            'remarks':      req.remarks,
            'status':       req.status,
            'approver':     req.approver.username if req.approver else None,
            'approved_at':  fmt_dt(req.approved_at),
            'rejecter':     req.rejecter.username if req.rejecter else None,
            'rejected_at':  fmt_dt(req.rejected_at),
            'item_count':   len(req.items),
            'items': [
                {
                    'item_name': line.item_name,
                    'category':  line.category,
                    'quantity':  line.quantity,
                }
                for line in req.items
            ],
        })

    return jsonify({
        'type':          'success',
        'data':          data,
        'pending_count': pending_count,
        'pagination_data': {
            'current_page':  paginated.page,
            'total_pages':   paginated.pages,
            'total_results': paginated.total,
        },
    })


# ================================================
# Supply Request - Approve

@api_handles.route('/supply_requests/<int:request_id>/approve', methods=['POST'])
@login_required
def api_approve_supply_request(request_id):
    if current_user.role not in ('Superadmin', 'Admin'):
        return jsonify({'type': 'error', 'message': 'Access denied.'})

    supply_request = SupplyRequest.query.options(selectinload(SupplyRequest.items)).get_or_404(request_id)
    if supply_request.status != 'Pending':
        return jsonify({'type': 'error', 'message': f'This request is already {supply_request.status.lower()}.'})

    insufficient = []
    for line in supply_request.items:
        if not line.supply_item_id:
            continue
        item = SupplyItem.query.get(line.supply_item_id)
        if item and item.available_stock < line.quantity:
            insufficient.append({
                'item_name': line.item_name,
                'requested': line.quantity,
                'available': item.available_stock,
            })

    if insufficient:
        return jsonify({
            'type':               'error',
            'message':            'Insufficient stock. Update the supply item stock first.',
            'insufficient_items': insufficient,
        })

    try:
        for line in supply_request.items:
            if line.supply_item_id:
                item = SupplyItem.query.get(line.supply_item_id)
                if item:
                    item.available_stock = max(0, item.available_stock - line.quantity)

        supply_request.status      = 'Approved'
        supply_request.approved_by = current_user.id
        supply_request.approved_at = func.now()

        log_audit_event(
            action='admin.supply_request.approve',
            entity_type='SupplyRequest',
            entity_id=supply_request.id,
            reason=f'Admin approved supply request {supply_request.request_no}',
            details={
                'request_no': supply_request.request_no,
                'store_id':   supply_request.store_id,
                'store_name': supply_request.store_name,
                'items':      len(supply_request.items),
            },
        )
        db.session.commit()
    except Exception as e:
        db.session.rollback()
        return jsonify({'type': 'error', 'message': f'Failed to approve request: {str(e)}'}), 500

    return jsonify({'type': 'success', 'message': f'Supply request {supply_request.request_no} approved. Stock updated.'})


# ================================================
# Supply Request - Reject

@api_handles.route('/supply_requests/<int:request_id>/reject', methods=['POST'])
@login_required
def api_reject_supply_request(request_id):
    if current_user.role not in ('Superadmin', 'Admin'):
        return jsonify({'type': 'error', 'message': 'Access denied.'}), 403

    supply_request = SupplyRequest.query.get_or_404(request_id)
    if supply_request.status != 'Pending':
        return jsonify({'type': 'error', 'message': f'This request is already {supply_request.status.lower()}.'}), 400

    try:
        supply_request.status      = 'Rejected'
        supply_request.rejected_by = current_user.id
        supply_request.rejected_at = func.now()

        log_audit_event(
            action='admin.supply_request.reject',
            entity_type='SupplyRequest',
            entity_id=supply_request.id,
            reason=f'Admin rejected supply request {supply_request.request_no}',
            details={
                'request_no': supply_request.request_no,
                'store_id':   supply_request.store_id,
                'store_name': supply_request.store_name,
            },
        )
        db.session.commit()
    except Exception as e:
        db.session.rollback()
        return jsonify({'type': 'error', 'message': f'Failed to reject request: {str(e)}'}), 500

    return jsonify({'type': 'success', 'message': f'Supply request {supply_request.request_no} rejected.'})


# ================================================
# Supply Request - Delete

@api_handles.route('/supply_requests/<int:request_id>/delete', methods=['POST'])
@login_required
def api_delete_supply_request(request_id):
    if current_user.role not in ('Superadmin', 'Admin'):
        return jsonify({'type': 'error', 'message': 'Access denied.'}), 403

    supply_request = SupplyRequest.query.get_or_404(request_id)
    request_no     = supply_request.request_no

    try:
        log_audit_event(
            action='admin.supply_request.delete',
            entity_type='SupplyRequest',
            entity_id=supply_request.id,
            reason=f'Admin deleted supply request {request_no}',
            details={
                'request_no': request_no,
                'store_id':   supply_request.store_id,
                'store_name': supply_request.store_name,
                'status':     supply_request.status,
            },
        )
        db.session.delete(supply_request)
        db.session.commit()
    except Exception as e:
        db.session.rollback()
        return jsonify({'type': 'error', 'message': f'Failed to delete request: {str(e)}'}), 500

    return jsonify({'type': 'success', 'message': f'Supply request {request_no} deleted.'})
   
   
# ================================
# Supply Request Section End
# ================================
 
 
# ================================
# Users Section Start
# ================================
@api_handles.route('/users', methods=['POST', 'GET'])
@login_required
def api_users():
    if not _can_manage_users():
        return {'type': 'error', 'message': 'Access denied. Only Admin or Superadmin can access this page.'}, 403

    try:
        current_page = int(request.form.get('page') or request.args.get('page') or 1)
    except (ValueError, TypeError):
        current_page = 1

    per_page = post_per_page

    query = User.query.options(
        selectinload(User.assigned_stores),
        selectinload(User.assigned_clusters),
        selectinload(User.managed_stores),
        selectinload(User.managed_clusters),
    )

    # -- Search -----------------------------------------------
    search = request.form.get('search')
    if search:
        pattern = f'%{search}%'
        query = query.filter(
            or_(
                User.full_name.ilike(pattern),
                User.username.ilike(pattern),
                User.email.ilike(pattern),
                User.role.ilike(pattern),
            )
        )

    # -- Sorting ----------------------------------------------
    sortby = request.form.get('sort')
    order = request.form.get('order_by', 'asc').lower()

    sortable_columns = {
        'id':         User.id,
        'full_name':  User.full_name,
        'username':   User.username,
        'email':      User.email,
        'role':       User.role,
        'date_added': User.date_added,
    }

    if sortby in sortable_columns:
        sort_col = sortable_columns[sortby]
        query = query.order_by(desc(sort_col) if order == 'desc' else asc(sort_col))
    else:
        query = query.order_by(User.date_added.desc(), User.id.desc())

    # -- Pagination -------------------------------------------
    pagination = query.paginate(page=current_page, per_page=per_page, error_out=False)
    results      = pagination.items
    total_pages  = pagination.pages
    total_results = pagination.total

    # -- Serialize --------------------------------------------
    user_list = []
    for u in results:
        # assigned store display — mirrors the Jinja logic
        if u.role == 'Store Manager':
            managed_store = u.managed_stores[0].name if u.managed_stores else None
        else:
            managed_store = None

        if u.role == 'Cluster Manager':
            managed_cluster = u.managed_clusters[0].name if u.managed_clusters else None
        else:
            managed_cluster = None

        user_list.append({
            'id':                  u.id,
            'full_name':           u.full_name  or '',
            'username':            u.username   or '',
            'email':               u.email      or '',
            'role':                u.role       or '',
            'date_added':          u.date_added.strftime('%b %d, %Y') if u.date_added else None,
            # for display in the assigned store column
            'managed_store':       managed_store,
            'managed_cluster':     managed_cluster,
            'assigned_clusters':   [c.name for c in u.assigned_clusters],
            'assigned_stores':     [s.name for s in u.assigned_stores],
            # for edit modal checkbox pre-selection
            'assigned_store_ids':  [s.id   for s in u.assigned_stores],
            'assigned_cluster_ids':[c.id   for c in u.assigned_clusters],
        })

    return {
        'type': 'success',
        'users': user_list,
        'pagination_data': {
            'current_page':  current_page,
            'total_pages':   total_pages,
            'total_results': total_results,
        }
    }


@api_handles.route('/users/create', methods=['POST'])
@login_required
def api_create_user():
    if not _can_manage_users():
        return {'type': 'error', 'message': 'Access denied. Only Admin or Superadmin can manage users.'}, 403

    try:
        full_name        = (request.form.get('full_name')        or '').strip()
        username         = (request.form.get('username')         or '').strip()
        email            = (request.form.get('email')            or '').strip()
        role             = (request.form.get('role')             or '').strip()
        password         = request.form.get('password')          or ''
        confirm_password = request.form.get('confirm_password')  or ''
        assigned_store_ids_raw   = request.form.getlist('assigned_store_ids')
        assigned_cluster_ids_raw = request.form.getlist('assigned_cluster_ids')

        # -- Validation -------------------------------------------
        if not full_name or not username or not email or not role or not password:
            return {'type': 'error', 'message': 'All required fields must be filled.'}, 400

        if password != confirm_password:
            return {'type': 'error', 'message': 'Passwords do not match.'}, 400

        if len(password) < 6:
            return {'type': 'error', 'message': 'Password must be at least 6 characters.'}, 400

        if User.query.filter_by(email=email).first():
            return {'type': 'error', 'message': 'Email already exists.'}, 409

        if User.query.filter_by(username=username).first():
            return {'type': 'error', 'message': 'Username already exists.'}, 409

        # -- Assigned stores ---------------------------------------
        assigned_store_id = None
        assigned_stores   = []
        if role == 'Inventory Staff':
            assigned_store_ids = [int(v) for v in assigned_store_ids_raw if str(v).isdigit()]
            assigned_stores = Store.query.filter(Store.id.in_(assigned_store_ids)).order_by(Store.name.asc()).all() if assigned_store_ids else []
            if not assigned_stores:
                return {'type': 'error', 'message': 'At least one Assigned Store is required for Inventory Staff.'}, 400
            assigned_store_id = assigned_stores[0].id

        # -- Assigned clusters -------------------------------------
        assigned_clusters = []
        if role == 'Area Manager':
            assigned_cluster_ids = [int(v) for v in assigned_cluster_ids_raw if str(v).isdigit()]
            assigned_clusters = Cluster.query.filter(Cluster.id.in_(assigned_cluster_ids)).order_by(Cluster.name.asc()).all() if assigned_cluster_ids else []
            if not assigned_clusters:
                return {'type': 'error', 'message': 'At least one Cluster must be assigned to an Area Manager.'}, 400
            if len(assigned_clusters) > 6:
                return {'type': 'error', 'message': 'An Area Manager can be assigned a maximum of 6 clusters.'}, 400

        # -- Create ------------------------------------------------
        new_user = User(
            full_name        = full_name,
            username         = username,
            email            = email,
            role             = role,
            assigned_store_id= assigned_store_id,
            password         = generate_password_hash(password, method='pbkdf2:sha256')
        )

        db.session.add(new_user)
        db.session.flush()
        new_user.assigned_stores   = assigned_stores
        new_user.assigned_clusters = assigned_clusters

        log_audit_event(
            action='admin.user.create',
            entity_type='User',
            entity_id=new_user.id,
            reason='New user account created by administrator.',
            details={
                'username':            new_user.username,
                'email':               new_user.email,
                'role':                new_user.role,
                'assigned_store_id':   new_user.assigned_store_id,
                'assigned_store_ids':  [s.id for s in new_user.assigned_stores],
                'assigned_cluster_ids':[c.id for c in new_user.assigned_clusters],
            },
        )

        db.session.commit()
        return {'type': 'success', 'message': f'User {username} created successfully.'}

    except Exception as e:
        db.session.rollback()
        return {'type': 'error', 'message': f'Error creating user: {str(e)}'}, 500
 
 
@api_handles.route('/users/<int:user_id>/update', methods=['POST'])
@login_required
def api_update_user(user_id):
    if not _can_manage_users():
        return {'type': 'error', 'message': 'Access denied. Only Admin or Superadmin can manage users.'}, 403

    try:
        user = User.query.get_or_404(user_id)

        previous_state = {
            'full_name':           user.full_name,
            'username':            user.username,
            'email':               user.email,
            'role':                user.role,
            'assigned_store_id':   user.assigned_store_id,
            'assigned_store_ids':  [s.id for s in user.assigned_stores],
            'assigned_cluster_ids':[c.id for c in user.assigned_clusters],
        }

        full_name = (request.form.get('full_name') or '').strip()
        username  = (request.form.get('username')  or '').strip()
        email     = (request.form.get('email')     or '').strip()
        role      = (request.form.get('role')      or '').strip()
        new_password         = request.form.get('new_password')         or ''
        confirm_new_password = request.form.get('confirm_new_password') or ''
        assigned_store_ids_raw   = request.form.getlist('assigned_store_ids')
        assigned_cluster_ids_raw = request.form.getlist('assigned_cluster_ids')

        # -- Validation ----------------------------------------
        if not full_name or not username or not email or not role:
            return {'type': 'error', 'message': 'Full name, username, email, and role are required.'}, 400

        if User.query.filter(User.email == email, User.id != user_id).first():
            return {'type': 'error', 'message': 'Email already exists.'}, 409

        if User.query.filter(User.username == username, User.id != user_id).first():
            return {'type': 'error', 'message': 'Username already exists.'}, 409

        # -- Apply fields --------------------------------------
        user.full_name = full_name
        user.username  = username
        user.email     = email
        user.role      = role

        # -- Assigned stores -----------------------------------
        if role == 'Inventory Staff':
            assigned_store_ids = [int(v) for v in assigned_store_ids_raw if str(v).isdigit()]
            assigned_stores = Store.query.filter(Store.id.in_(assigned_store_ids)).order_by(Store.name.asc()).all() if assigned_store_ids else []
            if not assigned_stores:
                return {'type': 'error', 'message': 'At least one Assigned Store is required for Inventory Staff.'}, 400
            user.assigned_stores    = assigned_stores
            user.assigned_store_id  = assigned_stores[0].id
        else:
            user.assigned_stores   = []
            user.assigned_store_id = None

        # -- Assigned clusters ---------------------------------
        if role == 'Area Manager':
            assigned_cluster_ids = [int(v) for v in assigned_cluster_ids_raw if str(v).isdigit()]
            assigned_clusters = Cluster.query.filter(Cluster.id.in_(assigned_cluster_ids)).order_by(Cluster.name.asc()).all() if assigned_cluster_ids else []
            if not assigned_clusters:
                return {'type': 'error', 'message': 'At least one Cluster must be assigned to an Area Manager.'}, 400
            if len(assigned_clusters) > 6:
                return {'type': 'error', 'message': 'An Area Manager can be assigned a maximum of 6 clusters.'}, 400
            user.assigned_clusters = assigned_clusters
        else:
            user.assigned_clusters = []

        # -- Password ------------------------------------------
        if new_password or confirm_new_password:
            if new_password != confirm_new_password:
                return {'type': 'error', 'message': 'New password and confirm password do not match.'}, 400
            if len(new_password) < 6:
                return {'type': 'error', 'message': 'New password must be at least 6 characters.'}, 400
            user.password = generate_password_hash(new_password, method='pbkdf2:sha256')

        # -- Audit ---------------------------------------------
        log_audit_event(
            action='admin.user.update',
            entity_type='User',
            entity_id=user.id,
            reason='User account updated by administrator.',
            details={
                'before': previous_state,
                'after': {
                    'full_name':           user.full_name,
                    'username':            user.username,
                    'email':               user.email,
                    'role':                user.role,
                    'assigned_store_id':   user.assigned_store_id,
                    'assigned_store_ids':  [s.id for s in user.assigned_stores],
                    'assigned_cluster_ids':[c.id for c in user.assigned_clusters],
                    'password_changed':    bool(new_password),
                },
            },
        )

        db.session.commit()
        return {'type': 'success', 'message': f'User {user.username} updated successfully.'}

    except Exception as e:
        db.session.rollback()
        return {'type': 'error', 'message': f'Error updating user: {str(e)}'}, 500



@api_handles.route('/users/<int:user_id>/delete', methods=['POST'])
@login_required
def api_delete_user(user_id):
    if not _can_manage_users():
        return {'type': 'error', 'message': 'Access denied. Only Admin or Superadmin can manage users.'}, 403

    try:
        user = User.query.get_or_404(user_id)

        if current_user.id == user.id:
            return {'type': 'error', 'message': 'You cannot delete your own account.'}, 400

        deleted_snapshot = {
            'username': user.username,
            'email':    user.email,
            'role':     user.role,
        }

        log_audit_event(
            action='admin.user.delete',
            entity_type='User',
            entity_id=user.id,
            reason='User account deleted by administrator.',
            details=deleted_snapshot,
        )

        db.session.delete(user)
        db.session.commit()
        return {'type': 'success', 'message': f'User {user.username} deleted successfully.'}

    except Exception as e:
        db.session.rollback()
        return {'type': 'error', 'message': f'Error deleting user: {str(e)}'}, 500
       
# ================================
# Users Section End
# ================================







# ================================
# Other Section
# ================================
def is_admin(silent=False):
    if current_user.type == 1 or current_user.type == '1':
        return 1
    else:
        return 0

# ================================
# Other Section End
# ================================

