from flask import Blueprint, request, jsonify, session
from ..models import db, Product, Category, Unit, ActivityLog, StockMovement, PackageMaster, ProductPackageStock
from ..utils.validators import validate_product, parse_date
from ..services.stock_service import (
    _check_and_update_notifications, get_product_stock_history, reconcile_product_stock, record_stock_adjustment
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

        p_date = parse_date(data.get('product_date')) or date.today()

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
            product_date=p_date,
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
                previous_quantity=0.0,
                balance_after=product.current_quantity,
                user_id=session.get('user_id'),
                movement_date=p_date,
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

        # Unit update with fallback resolution
        if 'unit_id' in data and data['unit_id']:
            try:
                product.unit_id = int(data['unit_id'])
            except (ValueError, TypeError):
                pass
        elif 'default_package_unit' in data or 'unit' in data:
            unit_sym = (data.get('default_package_unit') or data.get('unit') or '').strip().lower()
            if unit_sym:
                u_obj = Unit.query.filter(db.func.lower(Unit.symbol) == unit_sym).first()
                if not u_obj:
                    u_obj = Unit.query.filter(db.func.lower(Unit.name) == unit_sym).first()
                if u_obj:
                    product.unit_id = u_obj.id

        if 'minimum_stock' in data and data['minimum_stock'] is not None:
            product.minimum_stock = float(data['minimum_stock'])
        if 'description' in data:
            product.description = (data['description'] or '').strip() or None
        if 'is_active' in data:
            product.is_active = bool(data['is_active'])

        if 'product_date' in data and data['product_date']:
            parsed_pd = parse_date(str(data['product_date']))
            if parsed_pd:
                product.product_date = parsed_pd

        if 'default_packaging_type' in data:
            product.default_packaging_type = data['default_packaging_type'] or 'Bag'
        if 'default_package_size' in data:
            product.default_package_size = float(data['default_package_size']) if data['default_package_size'] not in (None, '') else None
        if 'default_package_unit' in data:
            product.default_package_unit = data['default_package_unit']
        if 'default_package_count' in data:
            product.default_package_count = float(data['default_package_count']) if data['default_package_count'] not in (None, '') else 1.0

        # Quantity / Stock adjustment in Edit Product
        if 'current_quantity' in data and data['current_quantity'] is not None:
            try:
                new_qty = float(data['current_quantity'])
                old_qty = product.current_quantity or 0.0
                bag_qty = float(data.get('bag_quantity', 0.0))
                loose_qty = float(data.get('loose_quantity', 0.0))
                pkg_type = product.default_packaging_type or 'Bag'
                pkg_size = product.default_package_size
                pkg_unit = product.default_package_unit or (product.unit.symbol if product.unit else 'kg')
                base_sym = product.unit.symbol if product.unit else 'kg'

                is_discrete = (pkg_type.lower() in ('bag', 'bottle', 'pouch', 'container', 'drum', 'box')) and (pkg_size is not None and pkg_size > 0)

                # Recreate discrete package stocks for updated stock levels
                ProductPackageStock.query.filter_by(product_id=product.id).delete(synchronize_session=False)

                if is_discrete and bag_qty > 0:
                    pkg_mult = pkg_size
                    if pkg_unit.lower() in ('g', 'gm', 'ml'):
                        pkg_mult = pkg_size / 1000.0
                    db.session.add(ProductPackageStock(
                        product_id=product.id,
                        packaging_type=pkg_type,
                        package_size=pkg_size,
                        unit_symbol=pkg_unit,
                        package_count=bag_qty,
                        total_quantity=round(bag_qty * pkg_mult, 4),
                    ))

                if loose_qty > 0 or not is_discrete:
                    loose_c = new_qty if not is_discrete else loose_qty
                    db.session.add(ProductPackageStock(
                        product_id=product.id,
                        packaging_type='Loose',
                        package_size=1.0,
                        unit_symbol=base_sym,
                        package_count=loose_c,
                        total_quantity=loose_c,
                    ))

                if abs(new_qty - old_qty) > 0.0001:
                    diff = new_qty - old_qty
                    product.current_quantity = new_qty
                    db.session.add(StockMovement(
                        product_id=product.id,
                        movement_type='ADJUSTMENT',
                        quantity=diff,
                        previous_quantity=old_qty,
                        balance_after=new_qty,
                        user_id=session.get('user_id'),
                        movement_date=product.product_date or date.today(),
                        packaging_type=pkg_type,
                        package_summary=f"Stock updated to {new_qty:g} {base_sym}",
                        remarks=f"Product master edit stock adjustment: {old_qty:g} -> {new_qty:g} {base_sym}",
                    ))
                else:
                    product.current_quantity = new_qty
            except (ValueError, TypeError):
                pass

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
    unit_list = []
    for u in units:
        d = u.to_dict()
        d['product_count'] = len(u.products) if hasattr(u, 'products') else 0
        unit_list.append(d)
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
    if Unit.query.filter(db.func.lower(Unit.name) == name.lower()).first():
        return jsonify({'success': False, 'message': f'Unit name "{name}" already exists.', 'error': f'Unit name "{name}" already exists.'}), 409
    try:
        unit = Unit(name=name, symbol=symbol)
        db.session.add(unit)
        db.session.commit()
        d = unit.to_dict()
        d['product_count'] = 0
        return jsonify({
            'success': True,
            'message': f'Unit "{symbol}" created successfully.',
            'unit': d,
            'data': d,
        }), 201
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': f'Failed to create unit: {str(e)}', 'error': str(e)}), 500


@products_bp.route('/api/units/<int:unit_id>', methods=['PUT'])
def update_unit(unit_id):
    auth_err = _require_auth()
    if auth_err:
        return auth_err
    unit = Unit.query.get_or_404(unit_id)
    data = request.get_json() or {}
    name = (data.get('name') or '').strip()
    symbol = (data.get('symbol') or '').strip()
    if not name or not symbol:
        return jsonify({'success': False, 'message': 'Unit name and symbol are required.', 'error': 'Unit name and symbol are required.'}), 400

    dup_sym = Unit.query.filter(db.func.lower(Unit.symbol) == symbol.lower(), Unit.id != unit_id).first()
    if dup_sym:
        return jsonify({'success': False, 'message': f'Unit symbol "{symbol}" is already used by another unit.', 'error': f'Unit symbol "{symbol}" already exists.'}), 409

    dup_name = Unit.query.filter(db.func.lower(Unit.name) == name.lower(), Unit.id != unit_id).first()
    if dup_name:
        return jsonify({'success': False, 'message': f'Unit name "{name}" is already used by another unit.', 'error': f'Unit name "{name}" already exists.'}), 409

    try:
        unit.name = name
        unit.symbol = symbol
        db.session.commit()
        d = unit.to_dict()
        d['product_count'] = len(unit.products) if hasattr(unit, 'products') else 0
        return jsonify({
            'success': True,
            'message': f'Unit "{symbol}" updated successfully.',
            'unit': d,
            'data': d,
        })
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': f'Failed to update unit: {str(e)}', 'error': str(e)}), 500


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
    types = ['Bag', 'Bottle', 'Pouch', 'Container', 'Drum', 'Box', 'Can', 'Bundle', 'Pieces', 'Packet', 'Loose', 'Custom']
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

    # Check duplicate or reactivation
    existing = PackageMaster.query.filter(
        PackageMaster.package_size == size,
        db.func.lower(PackageMaster.unit_symbol) == unit_sym.lower(),
        db.func.lower(PackageMaster.packaging_type) == pkg_type.lower(),
    ).first()
    if existing:
        if not existing.is_active:
            existing.is_active = True
            db.session.commit()
            return jsonify({
                'success': True,
                'message': f'Package size "{existing.label}" reactivated in Package Master.',
                'package': existing.to_dict(),
                'data': existing.to_dict(),
            }), 200
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


@products_bp.route('/api/stock/adjust', methods=['POST'])
def adjust_stock():
    auth_err = _require_auth()
    if auth_err:
        return auth_err
    data = request.get_json(silent=True) or request.form.to_dict() or {}
    product_id = data.get('product_id')
    if not product_id:
        return jsonify({'success': False, 'message': 'Product is required.'}), 400

    adjustment_type = data.get('adjustment_type', 'deduction')  # addition or deduction
    reason = data.get('reason', 'Damaged / Spillage')
    remarks = data.get('remarks')
    adjustment_date = parse_date(data.get('adjustment_date')) or date.today()

    qty_val = float(data['quantity']) if (data.get('quantity') is not None and str(data.get('quantity')).strip() != '') else None
    package_count = float(data['package_count']) if (data.get('package_count') is not None and str(data.get('package_count')).strip() != '') else None
    package_size = float(data['package_size']) if (data.get('package_size') is not None and str(data.get('package_size')).strip() != '') else None

    movement, error = record_stock_adjustment(
        product_id=int(product_id),
        adjustment_type=adjustment_type,
        quantity=qty_val,
        packaging_type=data.get('packaging_type'),
        package_size=package_size,
        package_unit=data.get('package_unit'),
        package_count=package_count,
        reason=reason,
        remarks=remarks,
        adjustment_date=adjustment_date,
        user_id=session.get('user_id')
    )
    if error:
        return jsonify({'success': False, 'message': error, 'error': error}), 400

    product = Product.query.get(int(product_id))
    try:
        db.session.add(ActivityLog(
            user_id=session.get('user_id'),
            action=f"Stock Adjustment ({adjustment_type.title()}): {movement.remarks} for {product.name if product else ''}. New Balance: {product.current_quantity if product else 0:g} {product.unit.symbol if product and product.unit else ''}.",
            entity_type='stock_adjustment',
            entity_id=product.id if product else None,
        ))
        db.session.commit()
    except Exception:
        db.session.rollback()

    return jsonify({
        'success': True,
        'message': f"Stock adjusted successfully. New stock: {product.current_quantity:g} {product.unit.symbol if product and product.unit else ''}.",
        'movement': movement.to_dict(),
        'product': product.to_dict(),
    }), 201


@products_bp.route('/api/stock/add', methods=['POST'])
def add_stock():
    """
    Dedicated endpoint to Add Stock to an existing product:
    - Validates empty, zero, negative, and invalid quantities.
    - Updates product stock atomically and permanently in database.
    - Returns updated stock immediately.
    - Records stock movement audit entry with user and previous quantity.
    """
    auth_err = _require_auth()
    if auth_err:
        return auth_err

    data = request.get_json(silent=True) or request.form.to_dict() or {}
    product_id = data.get('product_id')
    if not product_id:
        return jsonify({'success': False, 'message': 'Please select a product.'}), 400

    product = Product.query.get(product_id)
    if not product:
        return jsonify({'success': False, 'message': 'Product not found in catalog.'}), 404

    qty_val = data.get('quantity')
    package_count = data.get('package_count')

    if (qty_val is None or str(qty_val).strip() == '') and (package_count is None or str(package_count).strip() == ''):
        return jsonify({'success': False, 'message': 'Quantity to add is required.'}), 400

    try:
        if qty_val is not None and str(qty_val).strip() != '':
            q = float(qty_val)
        else:
            q = float(package_count)
        if q <= 0:
            return jsonify({'success': False, 'message': 'Quantity must be greater than zero.'}), 400
    except (ValueError, TypeError):
        return jsonify({'success': False, 'message': 'Please enter a valid numeric quantity.'}), 400

    reason = (data.get('reason') or 'Stock Added').strip()
    remarks = (data.get('remarks') or '').strip() or None
    adj_date = parse_date(data.get('adjustment_date') or data.get('date')) or date.today()

    p_size = float(data['package_size']) if (data.get('package_size') not in (None, '') and str(data.get('package_size')).strip() != '') else None
    p_cnt = float(package_count) if (package_count not in (None, '') and str(package_count).strip() != '') else None

    movement, error = record_stock_adjustment(
        product_id=int(product_id),
        adjustment_type='addition',
        quantity=float(qty_val) if (qty_val not in (None, '') and str(qty_val).strip() != '') else None,
        packaging_type=data.get('packaging_type'),
        package_size=p_size,
        package_unit=data.get('package_unit'),
        package_count=p_cnt,
        reason=reason,
        remarks=remarks,
        adjustment_date=adj_date,
        user_id=session.get('user_id')
    )

    if error:
        return jsonify({'success': False, 'message': error, 'error': error}), 400

    unit_sym = product.unit.symbol if product.unit else ''
    return jsonify({
        'success': True,
        'message': f"Added stock to {product.name}. Current stock is now {product.current_quantity:g} {unit_sym}.",
        'product': product.to_dict(),
        'previous_quantity': movement.previous_quantity if movement else None,
        'added_quantity': movement.quantity if movement else total_qty,
        'new_quantity': product.current_quantity,
        'movement': movement.to_dict() if movement else None,
    }), 201


@products_bp.route('/api/stock/edit', methods=['POST', 'PUT'])
def edit_stock():
    """
    Dedicated endpoint to Edit / Correct Stock of an existing product:
    - Validates target stock quantity (cannot be empty, negative, or invalid).
    - Saves updated stock permanently in the database.
    - Records stock difference with previous quantity, user, and reason in audit ledger.
    """
    auth_err = _require_auth()
    if auth_err:
        return auth_err

    data = request.get_json(silent=True) or request.form.to_dict() or {}
    product_id = data.get('product_id')
    if not product_id:
        return jsonify({'success': False, 'message': 'Product is required.'}), 400

    product = Product.query.get(product_id)
    if not product:
        return jsonify({'success': False, 'message': 'Product not found in catalog.'}), 404

    target_qty_raw = data.get('target_quantity') if data.get('target_quantity') is not None else data.get('current_quantity')
    if target_qty_raw is None or str(target_qty_raw).strip() == '':
        return jsonify({'success': False, 'message': 'Stock quantity is required.'}), 400

    try:
        target_qty = float(target_qty_raw)
        if target_qty < 0:
            return jsonify({'success': False, 'message': 'Stock quantity cannot be negative.'}), 400
    except (ValueError, TypeError):
        return jsonify({'success': False, 'message': 'Please enter a valid numeric stock quantity.'}), 400

    reason = (data.get('reason') or 'Stock Correction / Physical Count').strip()
    remarks = (data.get('remarks') or '').strip() or None
    adj_date = parse_date(data.get('adjustment_date') or data.get('date')) or date.today()

    try:
        old_qty = product.current_quantity or 0.0
        diff = round(target_qty - old_qty, 4)
        unit_sym = product.unit.symbol if product.unit else 'kg'

        product.current_quantity = target_qty

        # Rebuild package stock breakdown if bag / loose values provided
        bag_qty = float(data.get('bag_quantity', 0.0))
        loose_qty = float(data.get('loose_quantity', 0.0))
        pkg_type = product.default_packaging_type or 'Bag'
        pkg_size = product.default_package_size
        pkg_unit = product.default_package_unit or unit_sym

        is_discrete = (pkg_type.lower() in ('bag', 'bottle', 'pouch', 'container', 'drum', 'box')) and (pkg_size is not None and pkg_size > 0)
        ProductPackageStock.query.filter_by(product_id=product.id).delete(synchronize_session=False)

        if is_discrete and bag_qty > 0:
            pkg_mult = pkg_size
            if pkg_unit.lower() in ('g', 'gm', 'ml'):
                pkg_mult = pkg_size / 1000.0
            db.session.add(ProductPackageStock(
                product_id=product.id,
                packaging_type=pkg_type,
                package_size=pkg_size,
                unit_symbol=pkg_unit,
                package_count=bag_qty,
                total_quantity=round(bag_qty * pkg_mult, 4),
            ))

        if loose_qty > 0 or not is_discrete:
            loose_c = target_qty if not is_discrete else loose_qty
            db.session.add(ProductPackageStock(
                product_id=product.id,
                packaging_type='Loose',
                package_size=1.0,
                unit_symbol=unit_sym,
                package_count=loose_c,
                total_quantity=loose_c,
            ))

        movement = None
        if abs(diff) > 0.0001:
            action_desc = "Increased" if diff > 0 else "Decreased"
            movement = StockMovement(
                product_id=product.id,
                movement_type='ADJUSTMENT',
                quantity=diff,
                previous_quantity=old_qty,
                balance_after=target_qty,
                user_id=session.get('user_id'),
                movement_date=adj_date,
                packaging_type=pkg_type,
                package_summary=f"Stock updated to {target_qty:g} {unit_sym}",
                remarks=f"Stock Edit ({action_desc} by {abs(diff):g} {unit_sym}): [{reason}] {remarks or ''}".strip(),
            )
            db.session.add(movement)

        db.session.add(ActivityLog(
            user_id=session.get('user_id'),
            action=f"Updated stock of {product.name} from {old_qty:g} to {target_qty:g} {unit_sym}. ({reason})",
            entity_type='stock_edit',
            entity_id=product.id,
        ))

        _check_and_update_notifications(product)
        db.session.commit()

        return jsonify({
            'success': True,
            'message': f"Stock for {product.name} updated to {target_qty:g} {unit_sym} successfully.",
            'product': product.to_dict(),
            'previous_quantity': old_qty,
            'updated_quantity': target_qty,
            'new_quantity': target_qty,
            'quantity_difference': diff,
            'difference': diff,
            'movement': movement.to_dict() if movement else None,
        })
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': f'Failed to update stock: {str(e)}'}), 500


@products_bp.route('/api/stock/adjustments', methods=['GET'])
def list_stock_adjustments():
    """
    Retrieve stock adjustment history with:
    - Product name
    - Previous quantity
    - Updated quantity
    - Quantity difference
    - Adjustment date and time
    - User who performed adjustment
    - Reason for adjustment
    """
    auth_err = _require_auth()
    if auth_err:
        return auth_err

    product_id = request.args.get('product_id')
    page = int(request.args.get('page', 1))
    per_page = int(request.args.get('per_page', 50))

    query = StockMovement.query.filter(StockMovement.movement_type.in_(['ADJUSTMENT', 'INITIAL', 'REORDER_RECEIVED', 'PURCHASE_CANCELLED']))
    if product_id:
        try:
            query = query.filter(StockMovement.product_id == int(product_id))
        except (ValueError, TypeError):
            pass

    query = query.order_by(StockMovement.movement_date.desc(), StockMovement.id.desc())
    total = query.count()
    movements = query.offset((page - 1) * per_page).limit(per_page).all()

    return jsonify({
        'success': True,
        'adjustments': [m.to_dict() for m in movements],
        'total': total,
        'page': page,
        'per_page': per_page,
        'pages': max((total + per_page - 1) // per_page, 1),
    })


