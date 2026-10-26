import os
from flask import Blueprint, request, jsonify, session, current_app
from ..models import db, Purchase, Product, ActivityLog, StockMovement
from ..services.stock_service import record_purchase
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
    if start_date:
        query = query.filter(Purchase.purchase_date >= start_date)
    if end_date:
        query = query.filter(Purchase.purchase_date <= end_date)

    query = query.order_by(Purchase.purchase_date.desc(), Purchase.id.desc())
    total = query.count()
    purchases = query.offset((page - 1) * per_page).limit(per_page).all()

    total_cost = sum(p.total_price or 0 for p in purchases)

    return jsonify({
        'success': True,
        'purchases': [p.to_dict() for p in purchases],
        'data': [p.to_dict() for p in purchases],
        'total': total,
        'page': page,
        'per_page': per_page,
        'pages': max((total + per_page - 1) // per_page, 1),
        'total_cost': round(total_cost, 2),
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

    purchase, error = record_purchase(
        product_id=int(data['product_id']),
        quantity=float(data['quantity']),
        unit_id=int(data.get('unit_id') or 0) or None,
        unit_price=float(data['unit_price']) if data.get('unit_price') else None,
        total_price=float(data['total_price']) if data.get('total_price') else None,
        purchase_date=parse_date(data.get('purchase_date')),
        supplier_name=data.get('supplier_name') or data.get('supplier'),
        invoice_number=data.get('invoice_number'),
        remarks=data.get('remarks'),
        bill_file=bill_filename,
    )

    if error:
        return jsonify({'success': False, 'message': error, 'error': error}), 400

    try:
        product = Product.query.get(purchase.product_id)
        db.session.add(ActivityLog(
            user_id=session.get('user_id'),
            action=(
                f'Purchased {purchase.quantity} {product.unit.symbol if product and product.unit else ""} '
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
        'message': f'Purchase of {purchase.quantity} {product.unit.symbol if product and product.unit else ""} {product.name if product else ""} recorded successfully.',
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
