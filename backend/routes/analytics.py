from datetime import date
from flask import Blueprint, jsonify, request, session
from ..services import analytics_service as svc

analytics_bp = Blueprint('analytics', __name__)


def _require_auth():
    if not session.get('user_id'):
        return jsonify({'success': False, 'message': 'Authentication required.', 'error': 'Authentication required.'}), 401
    return None


@analytics_bp.route('/api/analytics', methods=['GET'])
def analytics():
    auth_err = _require_auth()
    if auth_err:
        return auth_err

    today = date.today()
    try:
        year = int(request.args.get('year', today.year))
    except (ValueError, TypeError):
        year = today.year
    try:
        month = int(request.args.get('month', today.month))
    except (ValueError, TypeError):
        month = today.month

    monthly = svc.get_monthly_summary(year, month)
    most_used = svc.get_most_used_products(limit=10, days=30)
    category_spending = svc.get_category_spending(year, month)
    purchase_trend = svc.get_monthly_purchase_trend(months=6)
    stock_status = svc.get_stock_status_summary()
    insights = svc.get_smart_insights(year, month)
    reorder = svc.get_reorder_suggestions()

    return jsonify({
        'success': True,
        'monthly_summary': monthly,
        'most_used_products': most_used,
        'category_spending': category_spending,
        'purchase_trend': purchase_trend,
        'stock_status': stock_status,
        'insights': insights,
        'reorder_suggestions': reorder,
    })


@analytics_bp.route('/api/analytics/product/<int:product_id>', methods=['GET'])
def product_analytics(product_id):
    auth_err = _require_auth()
    if auth_err:
        return auth_err

    from ..models import Product
    product = Product.query.get_or_404(product_id)

    usage_trend = svc.get_product_usage_trend(product_id, months=6)
    price_trend = svc.get_price_trend(product_id)

    return jsonify({
        'success': True,
        'product': product.to_dict(include_stats=True),
        'usage_trend': usage_trend,
        'price_trend': price_trend,
    })
