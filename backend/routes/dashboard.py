from datetime import date, timedelta
from flask import Blueprint, jsonify, session
from sqlalchemy import func
from ..models import db, Product, Purchase, Usage, Notification, ActivityLog

dashboard_bp = Blueprint('dashboard', __name__)


def _require_auth():
    if not session.get('user_id'):
        return jsonify({'success': False, 'message': 'Authentication required.', 'error': 'Authentication required.'}), 401
    return None


@dashboard_bp.route('/api/dashboard', methods=['GET'])
def dashboard():
    auth_err = _require_auth()
    if auth_err:
        return auth_err

    today = date.today()
    month_start = date(today.year, today.month, 1)

    # Product counts directly from database queries (Section 22)
    all_products = Product.query.filter_by(is_active=True).all()
    total_products = len(all_products)
    low_stock_count = sum(1 for p in all_products if p.status == 'low_stock')
    out_of_stock_count = sum(1 for p in all_products if p.status == 'out_of_stock')

    # Total estimated stock valuation directly from database
    total_stock_value = sum(p.estimated_stock_value for p in all_products)

    # Monthly purchase total directly from database
    monthly_purchase = (
        db.session.query(func.sum(Purchase.total_price))
        .filter(Purchase.purchase_date >= month_start)
        .scalar() or 0
    )

    # Monthly usage (grouped by unit — unit-aware)
    monthly_usages = (
        Usage.query
        .filter(Usage.usage_date >= month_start)
        .all()
    )
    monthly_usage_by_unit = {}
    for u in monthly_usages:
        sym = u.unit.symbol if u.unit else '?'
        monthly_usage_by_unit[sym] = round(
            monthly_usage_by_unit.get(sym, 0) + u.quantity, 2
        )

    # Recent purchases (last 10)
    recent_purchases = (
        Purchase.query
        .order_by(Purchase.purchase_date.desc(), Purchase.id.desc())
        .limit(10).all()
    )

    # Recent usage (last 10)
    recent_usages = (
        Usage.query
        .order_by(Usage.usage_date.desc(), Usage.id.desc())
        .limit(10).all()
    )

    # Most used products (this month)
    from ..services.analytics_service import get_most_used_products
    most_used = get_most_used_products(limit=5, days=30)

    # Low stock products list
    low_stock_products = [
        p.to_dict() for p in all_products if p.status in ('low_stock', 'out_of_stock')
    ]

    # Smart summary greeting
    smart_summary = _build_smart_summary(
        all_products, monthly_purchase, monthly_usages, most_used
    )

    # Recent activity
    recent_activity = (
        ActivityLog.query
        .order_by(ActivityLog.created_at.desc())
        .limit(10).all()
    )

    return jsonify({
        'success': True,
        'total_products': total_products,
        'low_stock_count': low_stock_count,
        'out_of_stock_count': out_of_stock_count,
        'total_stock_value': round(total_stock_value, 2),
        'monthly_purchase': round(monthly_purchase, 2),
        'monthly_usage_by_unit': monthly_usage_by_unit,
        'recent_purchases': [p.to_dict() for p in recent_purchases],
        'recent_usages': [u.to_dict() for u in recent_usages],
        'most_used': most_used,
        'low_stock_products': low_stock_products,
        'smart_summary': smart_summary,
        'recent_activity': [a.to_dict() for a in recent_activity],
    })


def _build_smart_summary(products, monthly_purchase, monthly_usages, most_used):
    """Build the greeting-banner text for the dashboard."""
    lines = []

    low_count = sum(1 for p in products if p.status in ('low_stock', 'out_of_stock'))
    if low_count:
        lines.append(f'{low_count} product{"s" if low_count > 1 else ""} '
                     f'{"are" if low_count > 1 else "is"} running low on stock.')

    if monthly_purchase:
        lines.append(f'₹{monthly_purchase:,.0f} spent on purchases this month.')

    if most_used:
        top = most_used[0]
        lines.append(
            f'{top["name"]} is your most used product this month '
            f'({top["total_used"]} {top["unit"]}).'
        )

    if not lines:
        lines.append('Everything looks good. All stock levels are healthy.')

    return lines
