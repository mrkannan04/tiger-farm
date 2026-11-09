import os
from flask import Blueprint, request, jsonify, session, current_app
from ..models import db, Purchase, Product, ActivityLog, StockMovement
from ..services.stock_service import record_purchase, cancel_purchase_and_reverse_stock
from ..utils.validators import validate_purchase, parse_date, allowed_file
from werkzeug.utils import secure_filename
from datetime import date

purchases_bp = Blueprint('purchases', __name__)


def _require_auth():
    if not session.get('user_id'):
        return jsonify({'success': False, 'message': 'Authentication required.', 'error': 'Authentication required.'}), 401
    return None


@purchases_bp.route('/api/purchases', methods=['GET'])
def list_purchases():
    auth_err = _require_auth()
    if auth_err:
        return auth_err

    search = request.args.get('search', '').strip()
    product_id = request.args.get('product_id')
    category_id = request.args.get('category_id')
    payment_status = request.args.get('payment_status')
    start_date = parse_date(request.args.get('start_date'))
    end_date = parse_date(request.args.get('end_date'))
    page = int(request.args.get('page', 1))
    per_page = int(request.args.get('per_page', 20))

    query = Purchase.query.join(Product, Purchase.product_id == Product.id)

    if search:
        query = query.filter(
            db.or_(
                Product.name.ilike(f'%{search}%'),
                Purchase.supplier_name.ilike(f'%{search}%'),
                Purchase.invoice_number.ilike(f'%{search}%'),
                Purchase.batch_number.ilike(f'%{search}%'),
                Purchase.remarks.ilike(f'%{search}%'),
            )
        )
    if product_id:
        try:
            query = query.filter(Purchase.product_id == int(product_id))
        except (ValueError, TypeError):
            pass
    if category_id:
        try:
            query = query.filter(Product.category_id == int(category_id))
        except (ValueError, TypeError):
            pass
    if payment_status:
        query = query.filter(Purchase.payment_status == payment_status)
    if start_date:
        query = query.filter(Purchase.purchase_date >= start_date)
    if end_date:
        query = query.filter(Purchase.purchase_date <= end_date)

    query = query.order_by(Purchase.purchase_date.desc(), Purchase.id.desc())
    total = query.count()
    purchases = query.offset((page - 1) * per_page).limit(per_page).all()

    total_cost = sum(p.total_price or 0 for p in purchases)
    total_credit_pending = db.session.query(
        db.func.sum(Purchase.total_price)
    ).filter(Purchase.payment_status.in_(['Pending Credit', 'Partial'])).scalar() or 0.0

    return jsonify({
        'success': True,
        'purchases': [p.to_dict() for p in purchases],
        'data': [p.to_dict() for p in purchases],
        'total': total,
        'page': page,
        'per_page': per_page,
        'pages': max((total + per_page - 1) // per_page, 1),
        'total_cost': round(total_cost, 2),
        'total_credit_pending': round(float(total_credit_pending), 2),
    })


@purchases_bp.route('/api/purchases', methods=['POST'])
def create_purchase():
    auth_err = _require_auth()
    if auth_err:
        return auth_err

    if request.is_json:
        data = request.get_json(silent=True) or {}
        bill_file = None
    else:
        data = request.form.to_dict()
        bill_file = request.files.get('bill_file')

    errors = validate_purchase(data)
    if errors:
        err_msg = ', '.join(errors.values())
        return jsonify({'success': False, 'message': err_msg, 'error': err_msg, 'errors': errors}), 400

    # Save bill file if provided
    bill_filename = None
    if bill_file and bill_file.filename:
        if not allowed_file(bill_file.filename, current_app.config['ALLOWED_EXTENSIONS']):
            return jsonify({'success': False, 'message': 'Invalid file type. Allowed: JPG, PNG, PDF.', 'error': 'Invalid file type. Allowed: JPG, PNG, PDF.'}), 400
        filename = secure_filename(f"bill_{int(date.today().strftime('%Y%m%d'))}_{bill_file.filename}")
        save_path = os.path.join(current_app.config['UPLOAD_FOLDER'], filename)
        bill_file.save(save_path)
        bill_filename = filename

    qty_val = float(data['quantity']) if (data.get('quantity') is not None and str(data.get('quantity')).strip() != '') else None

    purchase, error = record_purchase(
        product_id=int(data['product_id']),
        quantity=qty_val,
        unit_id=int(data.get('unit_id') or 0) or None,
        unit_price=float(data['unit_price']) if data.get('unit_price') else None,
        total_price=float(data['total_price']) if data.get('total_price') else None,
        purchase_date=parse_date(data.get('purchase_date')),
        supplier_name=data.get('supplier_name') or data.get('supplier'),
        invoice_number=data.get('invoice_number'),
        remarks=data.get('remarks'),
        bill_file=bill_filename,
        packaging_type=data.get('packaging_type'),
        package_size=float(data['package_size']) if data.get('package_size') else None,
        package_unit=data.get('package_unit'),
        package_count=float(data['package_count']) if data.get('package_count') else None,
        loose_quantity=float(data['loose_quantity']) if (data.get('loose_quantity') not in (None, '') and str(data.get('loose_quantity')).strip() != '') else None,
        batch_number=data.get('batch_number'),
        expiry_date=parse_date(data.get('expiry_date')),
        payment_status=data.get('payment_status') or 'Paid',
        payment_due_date=parse_date(data.get('payment_due_date')),
    )

    if error:
        return jsonify({'success': False, 'message': error, 'error': error}), 400

    try:
        product = Product.query.get(purchase.product_id)
        unit_label = product.unit.symbol if product and product.unit else ""
        summary_str = purchase.package_summary or f"{purchase.quantity} {unit_label}"
        db.session.add(ActivityLog(
            user_id=session.get('user_id'),
            action=(
                f'Purchased {summary_str} of '
                f'{product.name if product else ""} for ₹{purchase.total_price or 0:,.2f}.'
            ),
            entity_type='purchase',
            entity_id=purchase.id,
        ))
        db.session.commit()
    except Exception as e:
        db.session.rollback()

    return jsonify({
        'success': True,
        'message': f'Purchase of {purchase.package_summary or f"{purchase.quantity} {unit_label}"} {product.name if product else ""} recorded successfully.',
        'purchase': purchase.to_dict(),
        'data': purchase.to_dict(),
    }), 201


@purchases_bp.route('/api/purchases/<int:purchase_id>', methods=['GET'])
def get_purchase(purchase_id):
    auth_err = _require_auth()
    if auth_err:
        return auth_err
    purchase = Purchase.query.get_or_404(purchase_id)
    return jsonify({
        'success': True,
        'purchase': purchase.to_dict(),
        'data': purchase.to_dict(),
    })


@purchases_bp.route('/api/purchases/last-price', methods=['GET'])
def get_last_price():
    auth_err = _require_auth()
    if auth_err:
        return auth_err
    product_id = request.args.get('product_id')
    if not product_id:
        return jsonify({'success': False, 'message': 'product_id required'}), 400

    pkg_type = request.args.get('packaging_type')
    query = Purchase.query.filter(Purchase.product_id == int(product_id), Purchase.unit_price > 0)
    if pkg_type and pkg_type.lower() != 'loose':
        query = query.filter(Purchase.packaging_type.ilike(pkg_type))
    last_p = query.order_by(Purchase.purchase_date.desc(), Purchase.id.desc()).first()

    if not last_p:
        last_p = Purchase.query.filter(Purchase.product_id == int(product_id), Purchase.unit_price > 0).order_by(Purchase.purchase_date.desc(), Purchase.id.desc()).first()

    if last_p:
        return jsonify({
            'success': True,
            'last_price': last_p.unit_price,
            'total_price': last_p.total_price,
            'package_summary': last_p.package_summary,
            'packaging_type': last_p.packaging_type,
            'package_size': last_p.package_size,
            'package_unit': last_p.package_unit,
            'purchase_date': last_p.purchase_date.strftime('%d %b %Y') if last_p.purchase_date else None,
            'supplier_name': last_p.supplier_name,
        })
    return jsonify({'success': True, 'last_price': None})


@purchases_bp.route('/api/purchases/<int:purchase_id>/payment', methods=['PATCH', 'PUT', 'POST'])
def update_purchase_payment(purchase_id):
    auth_err = _require_auth()
    if auth_err:
        return auth_err
    purchase = Purchase.query.get_or_404(purchase_id)
    data = request.get_json(silent=True) or request.form.to_dict() or {}
    status = data.get('payment_status') or ('Paid' if purchase.payment_status != 'Paid' else 'Pending Credit')
    due_date = parse_date(data.get('payment_due_date')) if data.get('payment_due_date') else None
    try:
        purchase.payment_status = status
        if due_date is not None:
            purchase.payment_due_date = due_date
        db.session.add(ActivityLog(
            user_id=session.get('user_id'),
            action=f"Updated payment status of Purchase #{purchase.id} to '{status}'.",
            entity_type='purchase',
            entity_id=purchase.id,
        ))
        db.session.commit()
        return jsonify({
            'success': True,
            'message': f"Payment status updated to '{status}'.",
            'purchase': purchase.to_dict(),
        })
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': f'Failed: {str(e)}'}), 500


@purchases_bp.route('/api/purchases/<int:purchase_id>', methods=['PUT'])
def update_purchase(purchase_id):
    """
    Edit existing purchase record:
    - If quantity changes, atomically adjusts product stock with difference.
    - Updates price, date, supplier, invoice, batch number, remarks, payment status.
    - Records audit log.
    """
    auth_err = _require_auth()
    if auth_err:
        return auth_err

    purchase = Purchase.query.get_or_404(purchase_id)
    if purchase.status == 'Cancelled':
        return jsonify({'success': False, 'message': 'Cannot edit a cancelled purchase.'}), 400

    data = request.get_json(silent=True) or request.form.to_dict() or {}
    product = Product.query.get(purchase.product_id)

    try:
        old_qty = purchase.quantity
        if 'quantity' in data and data['quantity'] not in (None, ''):
            new_qty = float(data['quantity'])
            if new_qty <= 0:
                return jsonify({'success': False, 'message': 'Purchase quantity must be greater than zero.'}), 400
            diff = round(new_qty - old_qty, 4)
            if abs(diff) > 0.0001 and product:
                prev_stock = product.current_quantity or 0.0
                product.current_quantity = max(0.0, round(prev_stock + diff, 4))
                db.session.add(StockMovement(
                    product_id=product.id,
                    movement_type='ADJUSTMENT',
                    quantity=diff,
                    previous_quantity=prev_stock,
                    balance_after=product.current_quantity,
                    reference_id=purchase.id,
                    user_id=session.get('user_id'),
                    movement_date=date.today(),
                    remarks=f"Purchase #{purchase.id} quantity edited: {old_qty:g} -> {new_qty:g}",
                ))
            purchase.quantity = new_qty

        if 'unit_price' in data and data['unit_price'] not in (None, ''):
            purchase.unit_price = float(data['unit_price'])
        if 'total_price' in data and data['total_price'] not in (None, ''):
            purchase.total_price = float(data['total_price'])
        if 'purchase_date' in data and data['purchase_date']:
            p_date = parse_date(data['purchase_date'])
            if p_date:
                purchase.purchase_date = p_date
        if 'supplier_name' in data:
            purchase.supplier_name = (data['supplier_name'] or '').strip() or None
        if 'invoice_number' in data:
            purchase.invoice_number = (data['invoice_number'] or '').strip() or None
        if 'batch_number' in data:
            purchase.batch_number = (data['batch_number'] or '').strip() or None
        if 'remarks' in data:
            purchase.remarks = (data['remarks'] or '').strip() or None
        if 'payment_status' in data and data['payment_status']:
            purchase.payment_status = data['payment_status']
        if 'payment_due_date' in data:
            purchase.payment_due_date = parse_date(data['payment_due_date']) if data['payment_due_date'] else None
        if 'expiry_date' in data:
            purchase.expiry_date = parse_date(data['expiry_date']) if data['expiry_date'] else None

        db.session.add(ActivityLog(
            user_id=session.get('user_id'),
            action=f"Updated details for Purchase #{purchase.id} ({purchase.product.name if purchase.product else ''}).",
            entity_type='purchase',
            entity_id=purchase.id,
        ))
        db.session.commit()

        return jsonify({
            'success': True,
            'message': f"Purchase #{purchase.id} updated successfully.",
            'purchase': purchase.to_dict(),
        })
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': f'Failed to update purchase: {str(e)}'}), 500


@purchases_bp.route('/api/purchases/<int:purchase_id>/cancel', methods=['POST'])
def cancel_purchase_endpoint(purchase_id):
    """Cancel purchase and atomically reverse inventory stock."""
    auth_err = _require_auth()
    if auth_err:
        return auth_err

    data = request.get_json(silent=True) or request.form.to_dict() or {}
    reason = data.get('reason')

    purchase, error = cancel_purchase_and_reverse_stock(
        purchase_id=purchase_id,
        user_id=session.get('user_id'),
        reason=reason,
    )
    if error:
        return jsonify({'success': False, 'message': error, 'error': error}), 400

    return jsonify({
        'success': True,
        'message': f"Purchase #{purchase.id} cancelled successfully and stock was reversed.",
        'purchase': purchase.to_dict(),
    })


@purchases_bp.route('/api/purchases/<int:purchase_id>', methods=['DELETE'])
def delete_purchase(purchase_id):
    auth_err = _require_auth()
    if auth_err:
        return auth_err

    purchase = Purchase.query.get_or_404(purchase_id)
    product = Product.query.get(purchase.product_id)

    try:
        # Reverse the stock deduction safely
        if product:
            product.current_quantity = max(0.0, round(product.current_quantity - purchase.quantity, 4))
            db.session.add(StockMovement(
                product_id=product.id,
                movement_type='ADJUSTMENT',
                quantity=-purchase.quantity,
                balance_after=product.current_quantity,
                reference_id=purchase.id,
                movement_date=date.today(),
                remarks=f'Stock reversal: Deleted purchase #{purchase.id}',
            ))

        db.session.add(ActivityLog(
            user_id=session.get('user_id'),
            action=f'Deleted purchase #{purchase_id} ({purchase.quantity} {product.unit.symbol if product and product.unit else ""}). Stock reversed.',
            entity_type='purchase',
            entity_id=purchase_id,
        ))

        db.session.delete(purchase)
        db.session.commit()

        return jsonify({
            'success': True,
            'message': 'Purchase deleted and stock quantity reversed successfully.',
        })
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': f'Delete failed: {str(e)}', 'error': str(e)}), 500
