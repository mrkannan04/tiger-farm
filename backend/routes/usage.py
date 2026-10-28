from flask import Blueprint, request, jsonify, session
from ..models import db, Usage, Product, ActivityLog, StockMovement
from ..services.stock_service import record_usage
from ..utils.validators import validate_usage, parse_date
from datetime import date

usage_bp = Blueprint('usage', __name__)


def _require_auth():
    if not session.get('user_id'):
        return jsonify({'success': False, 'message': 'Authentication required.', 'error': 'Authentication required.'}), 401
    return None


@usage_bp.route('/api/usages', methods=['GET'])
def list_usages():
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

    query = Usage.query.join(Product, Usage.product_id == Product.id)

    if search:
        query = query.filter(
            db.or_(
                Product.name.ilike(f'%{search}%'),
                Usage.field_location.ilike(f'%{search}%'),
                Usage.reason.ilike(f'%{search}%'),
                Usage.remarks.ilike(f'%{search}%'),
            )
        )
    if product_id:
        try:
            query = query.filter(Usage.product_id == int(product_id))
        except (ValueError, TypeError):
            pass
    if category_id:
        try:
            query = query.filter(Product.category_id == int(category_id))
        except (ValueError, TypeError):
            pass
    if start_date:
        query = query.filter(Usage.usage_date >= start_date)
    if end_date:
        query = query.filter(Usage.usage_date <= end_date)

    query = query.order_by(Usage.usage_date.desc(), Usage.id.desc())
    total = query.count()
    usages = query.offset((page - 1) * per_page).limit(per_page).all()

    return jsonify({
        'success': True,
        'usages': [u.to_dict() for u in usages],
        'data': [u.to_dict() for u in usages],
        'total': total,
        'page': page,
        'per_page': per_page,
        'pages': max((total + per_page - 1) // per_page, 1),
    })


@usage_bp.route('/api/usages', methods=['POST'])
def create_usage():
    auth_err = _require_auth()
    if auth_err:
        return auth_err

    data = request.get_json(silent=True) if request.is_json else (request.form.to_dict() or {})
    errors = validate_usage(data)
    if errors:
        err_msg = ', '.join(errors.values())
        return jsonify({'success': False, 'message': err_msg, 'error': err_msg, 'errors': errors}), 400

    qty_val = float(data['quantity']) if (data.get('quantity') is not None and str(data.get('quantity')).strip() != '') else None

    usage, error = record_usage(
        product_id=int(data['product_id']),
        quantity=qty_val,
        unit_id=int(data.get('unit_id') or 0) or None,
        usage_date=parse_date(data.get('usage_date')),
        field_location=data.get('field_location'),
        reason=data.get('reason'),
        remarks=data.get('remarks'),
        packaging_type=data.get('packaging_type'),
        package_size=float(data['package_size']) if data.get('package_size') else None,
        package_unit=data.get('package_unit'),
        package_count=float(data['package_count']) if data.get('package_count') else None,
    )

    if error:
        return jsonify({'success': False, 'message': error, 'error': error}), 400

    try:
        product = Product.query.get(usage.product_id)
        unit_sym = product.unit.symbol if product and product.unit else ""
        summary_str = usage.package_summary or f"{usage.quantity} {unit_sym}"
        db.session.add(ActivityLog(
            user_id=session.get('user_id'),
            action=(
                f'Used {summary_str} of {product.name if product else ""}. '
                f'Field: {usage.field_location or "General"}. Remaining stock: {product.current_quantity} {unit_sym}.'
            ),
            entity_type='usage',
            entity_id=usage.id,
        ))
        db.session.commit()
    except Exception as e:
        db.session.rollback()

    return jsonify({
        'success': True,
        'message': (
            f'Recorded usage of {usage.package_summary or f"{usage.quantity} {unit_sym}"} {product.name if product else ""}. '
            f'Remaining stock: {product.current_quantity} {unit_sym}.'
        ),
        'usage': usage.to_dict(),
        'data': usage.to_dict(),
        'new_stock': product.current_quantity if product else 0,
    }), 201


@usage_bp.route('/api/usages/<int:usage_id>', methods=['GET'])
def get_usage(usage_id):
    auth_err = _require_auth()
    if auth_err:
        return auth_err
    usage = Usage.query.get_or_404(usage_id)
    return jsonify({
        'success': True,
        'usage': usage.to_dict(),
        'data': usage.to_dict(),
    })


@usage_bp.route('/api/usages/<int:usage_id>', methods=['DELETE'])
def delete_usage(usage_id):
    auth_err = _require_auth()
    if auth_err:
        return auth_err

    usage = Usage.query.get_or_404(usage_id)
    product = Product.query.get(usage.product_id)

    try:
        # Restore the stock
        if product:
            product.current_quantity = round(product.current_quantity + usage.quantity, 4)
            db.session.add(StockMovement(
                product_id=product.id,
                movement_type='ADJUSTMENT',
                quantity=usage.quantity,
                balance_after=product.current_quantity,
                reference_id=usage.id,
                movement_date=date.today(),
                remarks=f'Stock restoration: Deleted usage #{usage.id}',
            ))

        unit_sym = product.unit.symbol if product and product.unit else ''
        db.session.add(ActivityLog(
            user_id=session.get('user_id'),
            action=f'Deleted usage #{usage_id} — restored {usage.quantity} {unit_sym} for {product.name if product else ""}.',
            entity_type='usage',
            entity_id=usage_id,
        ))

        db.session.delete(usage)
        db.session.commit()

        return jsonify({
            'success': True,
            'message': f'Usage record deleted and stock restored (+{usage.quantity} {unit_sym}).',
        })
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': f'Delete failed: {str(e)}', 'error': str(e)}), 500
