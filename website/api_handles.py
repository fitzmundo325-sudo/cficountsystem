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
from .models import User, ProductMaster, ProductAlias


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
# Product Masterlist Section
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

