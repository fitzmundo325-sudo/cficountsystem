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
from datetime import datetime, timedelta
from .models import User, ProductMaster, ProductAlias, ProductPriceChangeLog
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

    # ── Filters ──────────────────────────────────────────────
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

    # ── Search ───────────────────────────────────────────────
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

    # ── Sorting ──────────────────────────────────────────────
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

    # ── Pagination ───────────────────────────────────────────
    pagination = query.paginate(page=current_page, per_page=per_page, error_out=False)
    results      = pagination.items
    total_pages  = pagination.pages
    total_results = pagination.total

    # ── Serialize ────────────────────────────────────────────
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
        for field in ('code', 'description', 'category', 'tp', 'sp_p', 'sp_np'):
            if not data.get(field):
                return {'type': 'error', 'message': f'Missing required field: {field}'}, 400

        # Check if code already exists
        existing = ProductMaster.query.filter_by(code=int(data['code'])).first()
        if existing:
            return {'type': 'error', 'message': 'Product with this code already exists.'}, 400

        # Create new product
        product = ProductMaster(
            code        = int(data['code']),
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
        for field in ('code', 'description', 'category', 'tp', 'sp_p', 'sp_np'):
            if not data.get(field):
                return {'type': 'error', 'message': f'Missing required field: {field}'}, 400

        # Check code uniqueness against other products
        code = int(data['code'])
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
 
# ================================
# Product Masterlist Section End
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

