from flask import Blueprint, request, jsonify, session
from ..models import db, Product, Category, Unit, ActivityLog, StockMovement, PackageMaster, ProductPackageStock
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

    if status == 'inactive':
        query = Product.query.filter_by(is_active=False)
    elif status == 'all':
        query = Product.query
    elif status == 'active':
        query = Product.query.filter_by(is_active=True)
    else:
        # Default or in_stock/low_stock/out_of_stock filter on active items
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

    # Filter by stock status in Python (derived property)
    if status and status in ('in_stock', 'low_stock', 'out_of_stock'):
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
        unit_id = data.get('unit_id')
        if not unit_id:
            sym = (data.get('default_package_unit') or 'kg').strip().lower()
            if sym in ['l', 'ml']:
                u = Unit.query.filter(db.func.lower(Unit.symbol) == 'l').first()
            elif sym in ['g', 'gm']:
                u = Unit.query.filter(db.func.lower(Unit.symbol).in_(['kg', 'gm', 'g'])).first()
            else:
                u = Unit.query.filter(db.func.lower(Unit.symbol) == 'kg').first()
            if not u:
                u = Unit.query.first()
            unit_id = u.id if u else 1
        else:
            unit_id = int(unit_id)

        init_qty = float(data.get('current_quantity', 0))
        min_stock = float(data.get('minimum_stock', 0))
        pkg_type = data.get('default_packaging_type', 'Bag')
        pkg_size = float(data['default_package_size']) if data.get('default_package_size') not in (None, '') else None
        pkg_unit = data.get('default_package_unit') or 'kg'
        pkg_count = float(data.get('default_package_count', 1.0)) if data.get('default_package_count') not in (None, '') else 1.0

        # Read discrete bag quantity and loose quantity (Sections 6-9, 18)
        bag_qty = float(data.get('bag_quantity', pkg_count if pkg_count is not None else 0.0))
        loose_qty = float(data.get('loose_quantity', 0.0))

        if (pkg_type or '').lower() == 'loose':
            bag_qty = 0.0
            bag_weight = 0.0
            total_opening_stock = loose_qty if loose_qty > 0 else init_qty
            pkg_size = 1.0
            pkg_count = total_opening_stock
        else:
            mult = PackageMaster.compute_multiplier(pkg_size or 1.0, pkg_unit)
            bag_weight = round(bag_qty * mult, 4) if (pkg_size and bag_qty > 0) else 0.0
            total_opening_stock = round(bag_weight + loose_qty, 4)
            if total_opening_stock <= 0 and init_qty > 0:
                total_opening_stock = init_qty

        product = Product(
            name=clean_name,
            category_id=int(data['category_id']),
            unit_id=unit_id,
            current_quantity=total_opening_stock,
            minimum_stock=min_stock,
            description=(data.get('description') or '').strip() or None,
            is_active=True,
            default_packaging_type=pkg_type,
            default_package_size=pkg_size,
            default_package_unit=pkg_unit,
            default_package_count=bag_qty if bag_qty > 0 else pkg_count,
        )
        db.session.add(product)
        db.session.flush()

        base_sym = product.unit.symbol if product.unit else 'kg'

        # Create bag ProductPackageStock
        if (pkg_type or '').lower() != 'loose' and pkg_size and pkg_size > 0:
            db.session.add(ProductPackageStock(
                product_id=product.id,
                packaging_type=pkg_type or 'Bag',
                package_size=pkg_size,
                unit_symbol=pkg_unit,
                package_count=bag_qty,
                total_quantity=bag_weight,
            ))

        # Create loose ProductPackageStock if loose stock > 0
        if loose_qty > 0 or (pkg_type or '').lower() == 'loose':
            loose_c = total_opening_stock if (pkg_type or '').lower() == 'loose' else loose_qty
            db.session.add(ProductPackageStock(
                product_id=product.id,
                packaging_type='Loose',
                package_size=1.0,
                unit_symbol=base_sym,
                package_count=loose_c,
                total_quantity=loose_c,
            ))

        # If opening quantity > 0, record ledger opening balance (Sections 7, 8, 9)
        if product.current_quantity > 0:
            if (pkg_type or '').lower() == 'loose':
                pkg_summary = f"{product.current_quantity:g} {base_sym} Loose"
            elif bag_qty > 0 and loose_qty > 0 and pkg_size:
                noun = f"{pkg_type}s" if bag_qty != 1 else pkg_type
                pkg_summary = f"{bag_qty:g} × {pkg_size:g} {pkg_unit} {noun} = {bag_weight:g} {base_sym} + Loose: {loose_qty:g} {base_sym} = {total_opening_stock:g} {base_sym}"
            elif bag_qty > 0 and pkg_size:
                noun = f"{pkg_type}s" if bag_qty != 1 else pkg_type
                pkg_summary = f"{bag_qty:g} × {pkg_size:g} {pkg_unit} {noun} = {bag_weight:g} {base_sym}"
            elif loose_qty > 0:
                pkg_summary = f"{loose_qty:g} {base_sym} Loose"
            else:
                pkg_summary = f"{product.current_quantity:g} {base_sym}"

            db.session.add(StockMovement(
                product_id=product.id,
                movement_type='INITIAL',
                quantity=product.current_quantity,
                balance_after=product.current_quantity,
                movement_date=date.today(),
                packaging_type=pkg_type,
                package_summary=pkg_summary,
                remarks=f'Opening stock balance upon product creation ({pkg_summary})',
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
        if 'is_active' in data:
            product.is_active = bool(data['is_active'])
        if 'default_packaging_type' in data:
            product.default_packaging_type = data['default_packaging_type'] or 'Bag'
        if 'default_package_size' in data:
            product.default_package_size = float(data['default_package_size']) if data['default_package_size'] not in (None, '') else None
        if 'default_package_unit' in data:
            product.default_package_unit = data['default_package_unit']
        if 'default_package_count' in data:
            product.default_package_count = float(data['default_package_count']) if data['default_package_count'] not in (None, '') else 1.0

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


@products_bp.route('/api/products/<int:product_id>/toggle-status', methods=['POST'])
def toggle_product_status(product_id):
    """Toggle product between Active and Inactive state."""
    auth_err = _require_auth()
    if auth_err:
        return auth_err

    product = Product.query.get_or_404(product_id)
    try:
        product.is_active = not product.is_active
        action_verb = 'Activated' if product.is_active else 'Deactivated'
        db.session.add(ActivityLog(
            user_id=session.get('user_id'),
            action=f'{action_verb} product "{product.name}".',
            entity_type='product',
            entity_id=product.id,
        ))
        db.session.commit()
        return jsonify({
            'success': True,
            'message': f'Product "{product.name}" is now {action_verb.lower()}.',
            'is_active': product.is_active,
            'product': product.to_dict(),
        })
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': f'Status update failed: {str(e)}', 'error': str(e)}), 500


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


# ── Package / Unit Master ─────────────────────────────────────────────────────

@products_bp.route('/api/packaging-types', methods=['GET'])
def list_packaging_types():
    _require_auth()
    types = ['Bag', 'Bottle', 'Pouch', 'Container', 'Drum', 'Loose']
    return jsonify({
        'success': True,
        'packaging_types': types,
        'data': types,
    })


@products_bp.route('/api/packages', methods=['GET'])
def list_packages():
    auth_err = _require_auth()
    if auth_err:
        return auth_err

    pkg_type = request.args.get('packaging_type', '').strip()
    active_only = request.args.get('active_only', 'false').lower() == 'true'

    query = PackageMaster.query
    if active_only:
        query = query.filter_by(is_active=True)
    if pkg_type:
        query = query.filter(db.func.lower(PackageMaster.packaging_type) == pkg_type.lower())

    query = query.order_by(PackageMaster.packaging_type, PackageMaster.base_multiplier.asc())
    packages = query.all()
    pkg_list = [p.to_dict() for p in packages]

    return jsonify({
        'success': True,
        'packages': pkg_list,
        'data': pkg_list,
        'total': len(pkg_list),
    })


@products_bp.route('/api/packages', methods=['POST'])
def create_package():
    auth_err = _require_auth()
    if auth_err:
        return auth_err

    data = request.get_json() or {}
    try:
        size = float(data.get('package_size', 0))
    except (TypeError, ValueError):
        return jsonify({'success': False, 'message': 'Package size must be a valid number.', 'error': 'Invalid size.'}), 400

    unit_sym = (data.get('unit_symbol') or '').strip()
    pkg_type = (data.get('packaging_type') or 'Bag').strip()

    if size <= 0 and pkg_type.lower() != 'loose':
        return jsonify({'success': False, 'message': 'Package size must be greater than zero.', 'error': 'Invalid size.'}), 400
    if not unit_sym:
        return jsonify({'success': False, 'message': 'Unit symbol is required (e.g. kg, g, L, ml).', 'error': 'Unit symbol is required.'}), 400

    # Auto infer base unit
    u_lower = unit_sym.lower()
    base_u = data.get('base_unit') or ('L' if u_lower in ('l', 'ml', 'lt', 'liter', 'litre') else 'kg')
    multiplier = PackageMaster.compute_multiplier(size, unit_sym)

    # Check duplicate
    existing = PackageMaster.query.filter(
        PackageMaster.package_size == size,
        db.func.lower(PackageMaster.unit_symbol) == unit_sym.lower(),
        db.func.lower(PackageMaster.packaging_type) == pkg_type.lower(),
    ).first()
    if existing:
        msg = f'Package size "{size:g} {unit_sym} {pkg_type}" already exists in Package Master.'
        return jsonify({'success': False, 'message': msg, 'error': msg, 'existing_id': existing.id}), 409

    try:
        pkg = PackageMaster(
            package_size=size,
            unit_symbol=unit_sym,
            packaging_type=pkg_type,
            base_unit=base_u,
            base_multiplier=multiplier,
            is_active=True,
        )
        db.session.add(pkg)
        db.session.commit()

        db.session.add(ActivityLog(
            user_id=session.get('user_id'),
            action=f'Added package size "{pkg.label}" to Package Master.',
            entity_type='package_master',
            entity_id=pkg.id,
        ))
        db.session.commit()

        return jsonify({
            'success': True,
            'message': f'Package size "{pkg.label}" created successfully.',
            'package': pkg.to_dict(),
            'data': pkg.to_dict(),
        }), 201

    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': f'Failed to create package: {str(e)}', 'error': str(e)}), 500


@products_bp.route('/api/packages/<int:pkg_id>', methods=['PUT'])
def update_package(pkg_id):
    auth_err = _require_auth()
    if auth_err:
        return auth_err

    pkg = PackageMaster.query.get_or_404(pkg_id)
    data = request.get_json() or {}

    try:
        if 'package_size' in data:
            pkg.package_size = float(data['package_size'])
        if 'unit_symbol' in data and data['unit_symbol'].strip():
            pkg.unit_symbol = data['unit_symbol'].strip()
        if 'packaging_type' in data and data['packaging_type'].strip():
            pkg.packaging_type = data['packaging_type'].strip()
        if 'is_active' in data:
            pkg.is_active = bool(data['is_active'])

        pkg.base_multiplier = PackageMaster.compute_multiplier(pkg.package_size, pkg.unit_symbol)
        u_lower = pkg.unit_symbol.lower()
        pkg.base_unit = 'L' if u_lower in ('l', 'ml', 'lt', 'liter', 'litre') else 'kg'

        db.session.commit()
        return jsonify({
            'success': True,
            'message': f'Package size "{pkg.label}" updated successfully.',
            'package': pkg.to_dict(),
            'data': pkg.to_dict(),
        })
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': f'Update failed: {str(e)}', 'error': str(e)}), 500


@products_bp.route('/api/packages/<int:pkg_id>', methods=['DELETE'])
def delete_package(pkg_id):
    auth_err = _require_auth()
    if auth_err:
        return auth_err

    pkg = PackageMaster.query.get_or_404(pkg_id)
    try:
        db.session.delete(pkg)
        db.session.commit()
        return jsonify({'success': True, 'message': f'Package "{pkg.label}" removed from Package Master.'})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': f'Delete failed: {str(e)}', 'error': str(e)}), 500

