from flask import Blueprint, request, jsonify, session
from ..models import db, Product, Category, Unit, ActivityLog, StockMovement
from ..utils.validators import validate_product
from ..services.stock_service import (
    _check_and_update_notifications, get_product_stock_history, reconcile_product_stock
)
from datetime import date

products_bp = Blueprint('products', __name__)


def _require_auth():
    if not session.get('user_id'):
        return jsonify({'success': False, 'message': 'Authentication required.', 'error': 'Authentication required.'}), 401
    return None


# ── Products ─────────────────────────────────────────────────────────────────

@products_bp.route('/api/products', methods=['GET'])
def list_products():
    auth_err = _require_auth()
    if auth_err:
        return auth_err

    search = request.args.get('search', '').strip()
    category_id = request.args.get('category_id')
    status = request.args.get('status')
    sort_by = request.args.get('sort_by', 'name')
    page = int(request.args.get('page', 1))
    per_page = int(request.args.get('per_page', 20))

    query = Product.query.filter_by(is_active=True)

    if search:
        query = query.filter(Product.name.ilike(f'%{search}%'))
    if category_id:
        try:
            query = query.filter_by(category_id=int(category_id))
        except (ValueError, TypeError):
            pass

    # Sort
    sort_map = {
        'name': Product.name,
        'quantity': Product.current_quantity,
        'created_at': Product.created_at,
    }
    query = query.order_by(sort_map.get(sort_by, Product.name))

    all_products = query.all()

    # Filter by status in Python (derived property)
    if status and status != 'all':
        all_products = [p for p in all_products if p.status == status]

    total = len(all_products)
    start = (page - 1) * per_page
    products = all_products[start:start + per_page]

    return jsonify({
        'success': True,
        'products': [p.to_dict() for p in products],
        'total': total,
        'page': page,
        'per_page': per_page,
        'pages': max((total + per_page - 1) // per_page, 1),
    })


@products_bp.route('/api/products', methods=['POST'])
def create_product():
    auth_err = _require_auth()
    if auth_err:
        return auth_err

    data = request.get_json() or {}
    errors = validate_product(data)
    if errors:
        err_msg = ', '.join(errors.values())
        return jsonify({'success': False, 'message': err_msg, 'error': err_msg, 'errors': errors}), 400

    # Duplicate check on active products
    clean_name = data['name'].strip()
    existing = Product.query.filter(
        db.func.lower(Product.name) == clean_name.lower(),
        Product.is_active == True,
    ).first()
    if existing:
        msg = f'Product "{clean_name}" already exists in the catalog.'
        return jsonify({'success': False, 'message': msg, 'error': msg, 'existing_id': existing.id}), 409

    try:
        init_qty = float(data.get('current_quantity', 0))
        min_stock = float(data.get('minimum_stock', 0))

        product = Product(
            name=clean_name,
            category_id=int(data['category_id']),
            unit_id=int(data['unit_id']),
            current_quantity=init_qty,
            minimum_stock=min_stock,
            description=(data.get('description') or '').strip() or None,
            is_active=True,
        )
        db.session.add(product)
        db.session.flush()

        # If opening quantity > 0, record ledger opening balance
        if product.current_quantity > 0:
            db.session.add(StockMovement(
                product_id=product.id,
                movement_type='INITIAL',
                quantity=product.current_quantity,
                balance_after=product.current_quantity,
                movement_date=date.today(),
                remarks='Opening stock balance upon product creation',
            ))

        db.session.add(ActivityLog(
            user_id=session.get('user_id'),
            action=f'Created product "{product.name}". Initial stock: {product.current_quantity}.',
            entity_type='product',
            entity_id=product.id,
        ))

        # Low-stock notification check
        _check_and_update_notifications(product)

        db.session.commit()

        return jsonify({
            'success': True,
            'message': f'Product "{product.name}" saved successfully.',
            'product': product.to_dict(),
            'data': product.to_dict(),
        }), 201

    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': f'Unable to save product: {str(e)}', 'error': str(e)}), 500


@products_bp.route('/api/products/<int:product_id>', methods=['GET'])
def get_product(product_id):
    auth_err = _require_auth()
    if auth_err:
        return auth_err

    product = Product.query.get_or_404(product_id)
    data = product.to_dict(include_stats=True)

    # Full history from DB queries (Section 21)
    data['purchases'] = [p.to_dict() for p in product.purchases]
    data['usages'] = [u.to_dict() for u in product.usages]
    data['stock_movements'] = [m.to_dict() for m in product.stock_movements]

    return jsonify({
        'success': True,
        'product': data,
        'data': data,
    })


@products_bp.route('/api/products/<int:product_id>/stock', methods=['GET'])
def get_product_stock_endpoint(product_id):
    auth_err = _require_auth()
    if auth_err:
        return auth_err

    product = Product.query.get_or_404(product_id)
    return jsonify({
        'success': True,
        'product_id': product.id,
        'product_name': product.name,
        'current_quantity': product.current_quantity,
        'minimum_stock': product.minimum_stock,
        'unit': product.unit.symbol if product.unit else '',
        'status': product.status,
    })


@products_bp.route('/api/products/<int:product_id>/stock-history', methods=['GET'])
def get_product_stock_history_endpoint(product_id):
    auth_err = _require_auth()
    if auth_err:
        return auth_err

    product = Product.query.get_or_404(product_id)
    history = get_product_stock_history(product.id)
    return jsonify({
        'success': True,
        'product_id': product.id,
        'product_name': product.name,
        'movements': history,
    })


@products_bp.route('/api/products/<int:product_id>/reconcile', methods=['POST'])
def reconcile_endpoint(product_id):
    auth_err = _require_auth()
    if auth_err:
        return auth_err

    data = request.get_json() or {}
    apply_fix = bool(data.get('apply_fix', False))
    res, err = reconcile_product_stock(product_id, apply_fix=apply_fix)
    if err:
        return jsonify({'success': False, 'message': err, 'error': err}), 400
    return jsonify({'success': True, 'reconciliation': res})


@products_bp.route('/api/products/<int:product_id>', methods=['PUT'])
def update_product(product_id):
    auth_err = _require_auth()
    if auth_err:
        return auth_err

    product = Product.query.get_or_404(product_id)
    data = request.get_json() or {}

    try:
        # Check duplicate name excluding self
        if 'name' in data and data['name'].strip():
            clean_name = data['name'].strip()
            existing = Product.query.filter(
                db.func.lower(Product.name) == clean_name.lower(),
                Product.id != product_id,
                Product.is_active == True,
            ).first()
            if existing:
                msg = f'"{clean_name}" already exists.'
                return jsonify({'success': False, 'message': msg, 'error': msg}), 409
            product.name = clean_name

        if 'category_id' in data and data['category_id']:
            product.category_id = int(data['category_id'])
        if 'unit_id' in data and data['unit_id']:
            product.unit_id = int(data['unit_id'])
        if 'minimum_stock' in data and data['minimum_stock'] is not None:
            product.minimum_stock = float(data['minimum_stock'])
        if 'description' in data:
            product.description = (data['description'] or '').strip() or None

        _check_and_update_notifications(product)

        db.session.add(ActivityLog(
            user_id=session.get('user_id'),
            action=f'Updated product "{product.name}".',
            entity_type='product',
            entity_id=product.id,
        ))
        db.session.commit()

        return jsonify({
            'success': True,
            'message': f'Product "{product.name}" updated successfully.',
            'product': product.to_dict(),
            'data': product.to_dict(),
        })

    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': f'Update failed: {str(e)}', 'error': str(e)}), 500


@products_bp.route('/api/products/<int:product_id>', methods=['DELETE'])
def delete_product(product_id):
    """Soft-delete (archive) preserving all historical transactions and ledger."""
    auth_err = _require_auth()
    if auth_err:
        return auth_err

    product = Product.query.get_or_404(product_id)
    try:
        product.is_active = False
        db.session.add(ActivityLog(
            user_id=session.get('user_id'),
            action=f'Archived product "{product.name}".',
            entity_type='product',
            entity_id=product.id,
        ))
        db.session.commit()
        return jsonify({
            'success': True,
            'message': f'Product "{product.name}" archived successfully.',
        })
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': f'Delete failed: {str(e)}', 'error': str(e)}), 500


# ── Categories ───────────────────────────────────────────────────────────────

@products_bp.route('/api/categories', methods=['GET'])
def list_categories():
    _require_auth()
    cats = Category.query.order_by(Category.name).all()
    cat_list = [c.to_dict() for c in cats]
    return jsonify({
        'success': True,
        'categories': cat_list,
        'data': cat_list,
    })


@products_bp.route('/api/categories', methods=['POST'])
def create_category():
    auth_err = _require_auth()
    if auth_err:
        return auth_err
    data = request.get_json() or {}
    name = (data.get('name') or '').strip()
    if not name:
        return jsonify({'success': False, 'message': 'Category name is required.', 'error': 'Category name is required.'}), 400
    if Category.query.filter(db.func.lower(Category.name) == name.lower()).first():
        return jsonify({'success': False, 'message': f'Category "{name}" already exists.', 'error': f'Category "{name}" already exists.'}), 409
    try:
        cat = Category(name=name, description=(data.get('description') or '').strip() or None,
                       color=data.get('color', '#52B788'))
        db.session.add(cat)
        db.session.commit()
        return jsonify({
            'success': True,
            'message': f'Category "{name}" created successfully.',
            'category': cat.to_dict(),
            'data': cat.to_dict(),
        }), 201
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': f'Failed to create category: {str(e)}', 'error': str(e)}), 500


@products_bp.route('/api/categories/<int:cat_id>', methods=['PUT'])
def update_category(cat_id):
    auth_err = _require_auth()
    if auth_err:
        return auth_err
    cat = Category.query.get_or_404(cat_id)
    data = request.get_json() or {}
    try:
        if 'name' in data and data['name'].strip():
            cat.name = data['name'].strip()
        if 'description' in data:
            cat.description = data['description']
        if 'color' in data:
            cat.color = data['color']
        db.session.commit()
        return jsonify({
            'success': True,
            'message': 'Category updated successfully.',
            'category': cat.to_dict(),
            'data': cat.to_dict(),
        })
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': f'Failed to update category: {str(e)}', 'error': str(e)}), 500


@products_bp.route('/api/categories/<int:cat_id>', methods=['DELETE'])
def delete_category(cat_id):
    auth_err = _require_auth()
    if auth_err:
        return auth_err
    cat = Category.query.get_or_404(cat_id)
    if cat.products:
        return jsonify({
            'success': False,
            'message': f'Cannot delete "{cat.name}" — {len(cat.products)} products are using this category.',
            'error': f'Cannot delete "{cat.name}" — {len(cat.products)} products are using this category.',
        }), 400
    try:
        db.session.delete(cat)
        db.session.commit()
        return jsonify({'success': True, 'message': 'Category deleted successfully.'})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': f'Failed to delete: {str(e)}', 'error': str(e)}), 500


# ── Units ─────────────────────────────────────────────────────────────────────

@products_bp.route('/api/units', methods=['GET'])
def list_units():
    _require_auth()
    units = Unit.query.order_by(Unit.name).all()
    unit_list = [u.to_dict() for u in units]
    return jsonify({
        'success': True,
        'units': unit_list,
        'data': unit_list,
    })


@products_bp.route('/api/units', methods=['POST'])
def create_unit():
    auth_err = _require_auth()
    if auth_err:
        return auth_err
    data = request.get_json() or {}
    name = (data.get('name') or '').strip()
    symbol = (data.get('symbol') or '').strip()
    if not name or not symbol:
        return jsonify({'success': False, 'message': 'Unit name and symbol are required.', 'error': 'Unit name and symbol are required.'}), 400
    if Unit.query.filter(db.func.lower(Unit.symbol) == symbol.lower()).first():
        return jsonify({'success': False, 'message': f'Unit "{symbol}" already exists.', 'error': f'Unit "{symbol}" already exists.'}), 409
    try:
        unit = Unit(name=name, symbol=symbol)
        db.session.add(unit)
        db.session.commit()
        return jsonify({
            'success': True,
            'message': f'Unit "{symbol}" created successfully.',
            'unit': unit.to_dict(),
            'data': unit.to_dict(),
        }), 201
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': f'Failed to create unit: {str(e)}', 'error': str(e)}), 500


@products_bp.route('/api/units/<int:unit_id>', methods=['DELETE'])
def delete_unit(unit_id):
    auth_err = _require_auth()
    if auth_err:
        return auth_err
    unit = Unit.query.get_or_404(unit_id)
    if unit.products:
        return jsonify({
            'success': False,
            'message': f'Cannot delete "{unit.symbol}" — products currently use this unit.',
            'error': f'Cannot delete "{unit.symbol}" — products currently use this unit.',
        }), 400
    try:
        db.session.delete(unit)
        db.session.commit()
        return jsonify({'success': True, 'message': f'Unit "{unit.symbol}" deleted successfully.'})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': f'Failed to delete unit: {str(e)}', 'error': str(e)}), 500
