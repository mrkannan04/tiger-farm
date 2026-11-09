"""
Tiger Farm — Reorder Stock Management Blueprint
Full lifecycle: Pending -> Ordered -> Partially Received -> Received / Cancelled.
Ensures stock updates happen ONLY upon confirmation of receipt.
"""
from datetime import date
from flask import Blueprint, request, jsonify, session
from ..models import db, Reorder, Product, Supplier, PackageMaster, ActivityLog
from ..utils.validators import validate_reorder, parse_date
from ..services.stock_service import receive_reorder, cancel_reorder

reorders_bp = Blueprint('reorders', __name__)


def _require_auth():
    if not session.get('user_id'):
        return jsonify({'success': False, 'message': 'Authentication required.', 'error': 'Authentication required.'}), 401
    return None


@reorders_bp.route('/api/reorders', methods=['GET'])
def list_reorders():
    auth_err = _require_auth()
    if auth_err:
        return auth_err

    search = request.args.get('search', '').strip()
    status_filter = request.args.get('status', 'all')
    product_id = request.args.get('product_id')
    supplier_id = request.args.get('supplier_id')
    page = int(request.args.get('page', 1))
    per_page = int(request.args.get('per_page', 20))

    query = Reorder.query.join(Product, Reorder.product_id == Product.id)

    if search:
        query = query.filter(
            db.or_(
                Product.name.ilike(f'%{search}%'),
                Reorder.supplier_name.ilike(f'%{search}%'),
                Reorder.notes.ilike(f'%{search}%'),
                Reorder.package_summary.ilike(f'%{search}%'),
            )
        )
    if product_id:
        try:
            query = query.filter(Reorder.product_id == int(product_id))
        except (ValueError, TypeError):
            pass
    if supplier_id:
        try:
            query = query.filter(Reorder.supplier_id == int(supplier_id))
        except (ValueError, TypeError):
            pass
    if status_filter and status_filter != 'all':
        query = query.filter(db.func.lower(Reorder.status) == status_filter.lower())

    query = query.order_by(Reorder.reorder_date.desc(), Reorder.id.desc())
    total = query.count()
    reorders = query.offset((page - 1) * per_page).limit(per_page).all()

    # KPI counts across all reorders
    all_reorders = Reorder.query.all()
    pending_count = sum(1 for r in all_reorders if r.status in ('Pending', 'Ordered'))
    received_count = sum(1 for r in all_reorders if r.status == 'Received')
    partially_received_count = sum(1 for r in all_reorders if r.status == 'Partially Received')
    cancelled_count = sum(1 for r in all_reorders if r.status == 'Cancelled')

    return jsonify({
        'success': True,
        'reorders': [r.to_dict() for r in reorders],
        'data': [r.to_dict() for r in reorders],
        'total': total,
        'page': page,
        'per_page': per_page,
        'pages': max((total + per_page - 1) // per_page, 1),
        'pending_count': pending_count,
        'received_count': received_count,
        'partially_received_count': partially_received_count,
        'cancelled_count': cancelled_count,
    })


@reorders_bp.route('/api/reorders', methods=['POST'])
def create_reorder():
    auth_err = _require_auth()
    if auth_err:
        return auth_err

    data = request.get_json(silent=True) or request.form.to_dict() or {}
    errors = validate_reorder(data)
    if errors:
        err_msg = ', '.join(errors.values())
        return jsonify({'success': False, 'message': err_msg, 'error': err_msg, 'errors': errors}), 400

    product = Product.query.get(data['product_id'])
    if not product:
        return jsonify({'success': False, 'message': 'Product not found in catalog.'}), 404

    pkg_type = (data.get('packaging_type') or product.default_packaging_type or 'Bag').strip()
    p_size = float(data['package_size']) if (data.get('package_size') not in (None, '') and str(data.get('package_size')).strip() != '') else product.default_package_size
    p_unit = (data.get('package_unit') or product.default_package_unit or (product.unit.symbol if product.unit else 'kg')).strip()
    p_count = float(data['package_count']) if (data.get('package_count') not in (None, '') and str(data.get('package_count')).strip() != '') else None
    qty_raw = data.get('quantity')
    unit_sym = product.unit.symbol if product.unit else 'kg'

    # Compute quantity in product base unit
    if pkg_type.lower() == 'loose':
        qty = float(qty_raw) if qty_raw else (p_count or 1.0)
        p_size = 1.0
        p_count = qty
        package_summary = f"{qty:g} {p_unit} Loose"
    elif p_size and p_count:
        multiplier = PackageMaster.compute_multiplier(p_size, p_unit)
        computed_qty = round(p_count * multiplier, 4)
        qty = float(qty_raw) if (qty_raw and float(qty_raw) > 0) else computed_qty
        noun = f"{pkg_type}s" if p_count != 1 else pkg_type
        package_summary = f"{p_count:g} {noun} × {p_size:g} {p_unit} = {qty:g} {unit_sym}"
    elif qty_raw and float(qty_raw) > 0:
        qty = float(qty_raw)
        package_summary = f"{qty:g} {unit_sym}"
    else:
        qty = p_count or 1.0
        package_summary = f"{qty:g} {unit_sym}"

    unit_price = float(data['unit_price']) if (data.get('unit_price') not in (None, '') and str(data.get('unit_price')).strip() != '') else None
    total_price = float(data['total_price']) if (data.get('total_price') not in (None, '') and str(data.get('total_price')).strip() != '') else None
    if unit_price and not total_price:
        total_price = round(unit_price * (p_count if (p_count and pkg_type.lower() != 'loose') else qty), 2)
    elif total_price and not unit_price:
        divisor = p_count if (p_count and pkg_type.lower() != 'loose') else qty
        unit_price = round(total_price / divisor, 2) if divisor > 0 else 0.0

    r_date = parse_date(data.get('reorder_date')) or date.today()
    exp_date = parse_date(data.get('expected_delivery_date')) if data.get('expected_delivery_date') else None

    supplier_name = (data.get('supplier_name') or data.get('supplier') or '').strip() or None
    supplier_id = int(data['supplier_id']) if (data.get('supplier_id') not in (None, '') and str(data.get('supplier_id')).strip() != '') else None

    try:
        reorder = Reorder(
            product_id=product.id,
            quantity=qty,
            packaging_type=pkg_type,
            package_size=p_size,
            package_unit=p_unit,
            package_count=p_count,
            package_summary=package_summary,
            unit_price=unit_price,
            total_price=total_price,
            status='Pending',  # Default is Pending; does NOT add to stock yet
            reorder_date=r_date,
            expected_delivery_date=exp_date,
            supplier_id=supplier_id,
            supplier_name=supplier_name,
            notes=(data.get('notes') or '').strip() or None,
            created_by_id=session.get('user_id'),
        )
        db.session.add(reorder)
        db.session.flush()

        db.session.add(ActivityLog(
            user_id=session.get('user_id'),
            action=f"Created Reorder request #{reorder.id} for {package_summary} of {product.name} (Status: Pending). Current stock remains {product.current_quantity:g} {unit_sym}.",
            entity_type='reorder',
            entity_id=reorder.id,
        ))
        db.session.commit()

        return jsonify({
            'success': True,
            'message': f"Reorder request #{reorder.id} for {product.name} created successfully with status 'Pending'. Stock will update when received.",
            'reorder': reorder.to_dict(),
            'data': reorder.to_dict(),
        }), 201
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': f'Failed to create reorder: {str(e)}'}), 500


@reorders_bp.route('/api/reorders/<int:reorder_id>', methods=['GET'])
def get_reorder(reorder_id):
    auth_err = _require_auth()
    if auth_err:
        return auth_err
    reorder = Reorder.query.get_or_404(reorder_id)
    return jsonify({
        'success': True,
        'reorder': reorder.to_dict(),
        'data': reorder.to_dict(),
    })


@reorders_bp.route('/api/reorders/<int:reorder_id>', methods=['PUT'])
def update_reorder(reorder_id):
    auth_err = _require_auth()
    if auth_err:
        return auth_err

    reorder = Reorder.query.get_or_404(reorder_id)
    if reorder.status in ('Received', 'Cancelled'):
        return jsonify({'success': False, 'message': f'Cannot edit a reorder that is already {reorder.status}.'}), 400

    data = request.get_json(silent=True) or request.form.to_dict() or {}
    try:
        if 'status' in data and data['status'].strip():
            st = data['status'].strip()
            if st in ('Pending', 'Ordered'):
                reorder.status = st
        if 'expected_delivery_date' in data:
            reorder.expected_delivery_date = parse_date(data['expected_delivery_date']) if data['expected_delivery_date'] else None
        if 'supplier_name' in data:
            reorder.supplier_name = (data['supplier_name'] or '').strip() or None
        if 'notes' in data:
            reorder.notes = (data['notes'] or '').strip() or None
        if 'unit_price' in data and data['unit_price'] not in (None, ''):
            reorder.unit_price = float(data['unit_price'])
        if 'total_price' in data and data['total_price'] not in (None, ''):
            reorder.total_price = float(data['total_price'])

        if reorder.unit_price and not reorder.total_price:
            count = reorder.package_count if (reorder.package_count and (reorder.packaging_type or '').lower() != 'loose') else reorder.quantity
            reorder.total_price = round(reorder.unit_price * count, 2)
        elif reorder.total_price and not reorder.unit_price:
            count = reorder.package_count if (reorder.package_count and (reorder.packaging_type or '').lower() != 'loose') else reorder.quantity
            reorder.unit_price = round(reorder.total_price / count, 2) if count > 0 else 0.0

        db.session.commit()
        return jsonify({
            'success': True,
            'message': f"Reorder #{reorder.id} updated successfully.",
            'reorder': reorder.to_dict(),
        })
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': f'Failed to update reorder: {str(e)}'}), 500


@reorders_bp.route('/api/reorders/<int:reorder_id>/receive', methods=['POST'])
def receive_reorder_endpoint(reorder_id):
    """
    Confirm receipt of a reorder:
    - Atomically increments product stock and ProductPackageStock breakdown.
    - Updates reorder status to 'Received' or 'Partially Received'.
    - Automatically creates a completed Purchase record in the Purchases section.
    - Records audit log in StockMovement with user and previous quantity.
    """
    auth_err = _require_auth()
    if auth_err:
        return auth_err

    data = request.get_json(silent=True) or request.form.to_dict() or {}
    recv_qty = data.get('received_quantity')

    p_date = parse_date(data.get('purchase_date')) if data.get('purchase_date') else None
    unit_price = float(data['unit_price']) if (data.get('unit_price') not in (None, '') and str(data['unit_price']).strip() != '') else None
    total_price = float(data['total_price']) if (data.get('total_price') not in (None, '') and str(data['total_price']).strip() != '') else None
    supplier_name = (data.get('supplier_name') or data.get('supplier') or '').strip() or None
    invoice_number = (data.get('invoice_number') or '').strip() or None
    payment_status = (data.get('payment_status') or 'Paid').strip()
    remarks = (data.get('remarks') or data.get('notes') or '').strip() or None

    reorder, error = receive_reorder(
        reorder_id=reorder_id,
        received_quantity=float(recv_qty) if (recv_qty not in (None, '') and str(recv_qty).strip() != '') else None,
        user_id=session.get('user_id'),
        purchase_date=p_date,
        unit_price=unit_price,
        total_price=total_price,
        supplier_name=supplier_name,
        invoice_number=invoice_number,
        payment_status=payment_status,
        remarks=remarks,
    )

    if error:
        return jsonify({'success': False, 'message': error, 'error': error}), 400

    product = reorder.product
    unit_sym = product.unit.symbol if product and product.unit else ''
    purchase = getattr(reorder, 'created_purchase', None)
    return jsonify({
        'success': True,
        'message': f"Confirmed receipt for Reorder #{reorder.id}. Current stock of {product.name} is now {product.current_quantity:g} {unit_sym} (Recorded in Purchases as #{purchase.id if purchase else ''}).",
        'reorder': reorder.to_dict(),
        'purchase': purchase.to_dict() if purchase else None,
        'product': product.to_dict(),
    })


@reorders_bp.route('/api/reorders/<int:reorder_id>/cancel', methods=['POST'])
def cancel_reorder_endpoint(reorder_id):
    """Cancel a reorder without affecting current stock."""
    auth_err = _require_auth()
    if auth_err:
        return auth_err

    data = request.get_json(silent=True) or request.form.to_dict() or {}
    reason = data.get('reason')

    reorder, error = cancel_reorder(
        reorder_id=reorder_id,
        user_id=session.get('user_id'),
        reason=reason,
    )

    if error:
        return jsonify({'success': False, 'message': error, 'error': error}), 400

    return jsonify({
        'success': True,
        'message': f"Reorder #{reorder.id} cancelled successfully. Current stock remains unchanged.",
        'reorder': reorder.to_dict(),
    })


@reorders_bp.route('/api/reorders/<int:reorder_id>', methods=['DELETE'])
def delete_reorder(reorder_id):
    auth_err = _require_auth()
    if auth_err:
        return auth_err

    reorder = Reorder.query.get_or_404(reorder_id)
    if reorder.status == 'Received':
        return jsonify({'success': False, 'message': 'Cannot delete an already received reorder. Inventory has already been updated.'}), 400

    try:
        db.session.add(ActivityLog(
            user_id=session.get('user_id'),
            action=f"Deleted Reorder #{reorder.id} ({reorder.status}).",
            entity_type='reorder',
            entity_id=reorder.id,
        ))
        db.session.delete(reorder)
        db.session.commit()
        return jsonify({'success': True, 'message': f'Reorder #{reorder_id} deleted successfully.'})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': f'Delete failed: {str(e)}'}), 500

