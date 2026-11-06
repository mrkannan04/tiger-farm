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

    # Total pending credit (payables to suppliers)
    total_pending_credit = (
        db.session.query(func.sum(Purchase.total_price))
        .filter(Purchase.payment_status.in_(['Pending Credit', 'Partial']))
        .scalar() or 0.0
    )

    # Expiring products within 30 days
    expiring_count = (
        Purchase.query.join(Product, Purchase.product_id == Product.id)
        .filter(
            Product.is_active == True,
            Product.current_quantity > 0,
            Purchase.expiry_date != None,
            Purchase.expiry_date <= today + timedelta(days=30)
        ).count()
    )

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
        'total_pending_credit': round(float(total_pending_credit), 2),
        'expiring_count': expiring_count,
        'monthly_purchase': round(monthly_purchase, 2),
        'monthly_usage_by_unit': monthly_usage_by_unit,
        'recent_purchases': [p.to_dict() for p in recent_purchases],
        'recent_usages': [u.to_dict() for u in recent_usages],
        'most_used': most_used,
        'low_stock_products': low_stock_products,
        'smart_summary': smart_summary,
        'recent_activity': [a.to_dict() for a in recent_activity],
    })


@dashboard_bp.route('/api/dashboard/digest', methods=['GET'])
def daily_farm_digest():
    """Generate daily farm operations digest summary formatted for WhatsApp or SMS copy."""
    auth_err = _require_auth()
    if auth_err:
        return auth_err

    today = date.today()
    purchases_today = Purchase.query.filter(Purchase.purchase_date == today).all()
    usages_today = Usage.query.filter(Usage.usage_date == today).all()
    from ..models import StockMovement
    adjustments_today = StockMovement.query.filter(
        StockMovement.movement_date == today,
        StockMovement.movement_type == 'ADJUSTMENT'
    ).all()

    all_active = Product.query.filter(Product.is_active == True).all()
    low_stock = [p for p in all_active if p.status in ('low_stock', 'out_of_stock')]
    pending_credit_total = db.session.query(func.sum(Purchase.total_price)).filter(
        Purchase.payment_status.in_(['Pending Credit', 'Partial'])
    ).scalar() or 0.0

    today_str = today.strftime('%d %b %Y')
    lines = [
        f"🌾 *TIGER FARM — DAILY OPERATIONS DIGEST*",
        f"📅 Date: {today_str}",
        "------------------------------------",
    ]

    # Purchases
    if purchases_today:
        tot_spend = sum(p.total_price or 0 for p in purchases_today)
        lines.append(f"🛒 *Purchases Today ({len(purchases_today)}):* ₹{tot_spend:,.2f}")
        for p in purchases_today:
            pkg = p.package_summary or f"{p.quantity} {p.unit.symbol if p.unit else ''}"
            supp = f" from {p.supplier_name}" if p.supplier_name else ""
            pay = f" [{p.payment_status}]" if p.payment_status != 'Paid' else ""
            lines.append(f"  • {p.product.name if p.product else 'Item'}: {pkg} (₹{p.total_price or 0:,.0f}){supp}{pay}")
    else:
        lines.append("🛒 *Purchases Today:* None recorded")

    lines.append("")

    # Usages
    if usages_today:
        lines.append(f"🌾 *Field Applications Today ({len(usages_today)}):*")
        for u in usages_today:
            pkg = u.package_summary or f"{u.quantity} {u.unit.symbol if u.unit else ''}"
            loc = f" @ {u.field_location}" if u.field_location else ""
            crop = f" ({u.crop_season})" if u.crop_season else ""
            reason = f" - {u.reason}" if u.reason else ""
            lines.append(f"  • {u.product.name if u.product else 'Item'}: {pkg}{loc}{crop}{reason}")
    else:
        lines.append("🌾 *Field Applications Today:* None recorded")

    lines.append("")

    # Adjustments
    if adjustments_today:
        lines.append(f"⚖️ *Stock Adjustments Today ({len(adjustments_today)}):*")
        for a in adjustments_today:
            sign = "+" if a.quantity > 0 else ""
            lines.append(f"  • {a.product.name if a.product else 'Item'}: {sign}{a.quantity:g} ({a.remarks or 'Adjustment'})")
        lines.append("")

    # Alerts
    if low_stock:
        lines.append(f"⚠️ *Stock Alerts ({len(low_stock)} items low/out):*")
        for p in low_stock:
            status_txt = "OUT OF STOCK" if p.current_quantity <= 0 else f"{p.current_quantity:g} {p.unit.symbol if p.unit else ''} left (min: {p.minimum_stock:g})"
            lines.append(f"  • {p.name}: {status_txt}")
        lines.append("")

    # Supplier Credit
    if pending_credit_total > 0:
        lines.append(f"💳 *Total Supplier Credit Pending:* ₹{pending_credit_total:,.2f}")
        lines.append("")

    lines.append("Generated by Tiger Farm Management System")
    formatted_text = "\n".join(lines)

    return jsonify({
        'success': True,
        'date': today.strftime('%Y-%m-%d'),
        'date_display': today_str,
        'purchases_count': len(purchases_today),
        'usages_count': len(usages_today),
        'adjustments_count': len(adjustments_today),
        'low_stock_count': len(low_stock),
        'pending_credit_total': round(float(pending_credit_total), 2),
        'formatted_text': formatted_text,
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
