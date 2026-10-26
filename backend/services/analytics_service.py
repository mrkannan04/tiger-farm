from datetime import date, timedelta
from calendar import monthrange
from sqlalchemy import func, extract
from ..models import db, Product, Purchase, Usage, Category


def get_monthly_summary(year, month):
    """Purchase and usage summary for a given month."""
    start = date(year, month, 1)
    _, last_day = monthrange(year, month)
    end = date(year, month, last_day)

    purchases = Purchase.query.filter(
        Purchase.purchase_date >= start,
        Purchase.purchase_date <= end,
    ).all()

    usages = Usage.query.filter(
        Usage.usage_date >= start,
        Usage.usage_date <= end,
    ).all()

    total_purchase_cost = sum(p.total_price or 0 for p in purchases)
    purchase_count = len(purchases)

    # Usage grouped by unit (unit-aware — never mix KG + L)
    usage_by_unit = {}
    for u in usages:
        sym = u.unit.symbol if u.unit else '?'
        usage_by_unit[sym] = usage_by_unit.get(sym, 0) + u.quantity

    return {
        'year': year,
        'month': month,
        'month_name': start.strftime('%B %Y'),
        'purchase_count': purchase_count,
        'total_purchase_cost': round(total_purchase_cost, 2),
        'usage_count': len(usages),
        'usage_by_unit': usage_by_unit,
    }


def get_most_used_products(limit=10, days=30):
    """Return products ranked by usage quantity in the past N days."""
    since = date.today() - timedelta(days=days)
    rows = (
        db.session.query(
            Usage.product_id,
            func.sum(Usage.quantity).label('total_used'),
        )
        .filter(Usage.usage_date >= since)
        .group_by(Usage.product_id)
        .order_by(func.sum(Usage.quantity).desc())
        .limit(limit)
        .all()
    )

    result = []
    for row in rows:
        product = Product.query.get(row.product_id)
        if product:
            result.append({
                'product_id': product.id,
                'name': product.name,
                'total_used': round(row.total_used, 2),
                'current_quantity': product.current_quantity,
                'unit': product.unit.symbol if product.unit else '',
                'status': product.status,
            })
    return result


def get_category_spending(year, month):
    """Total purchase spending grouped by category for the month."""
    start = date(year, month, 1)
    _, last_day = monthrange(year, month)
    end = date(year, month, last_day)

    purchases = (
        Purchase.query
        .join(Product, Purchase.product_id == Product.id)
        .filter(
            Purchase.purchase_date >= start,
            Purchase.purchase_date <= end,
        )
        .all()
    )

    spending = {}
    for p in purchases:
        cat = p.product.category.name if p.product and p.product.category else 'Other'
        color = p.product.category.color if p.product and p.product.category else '#6B7F6E'
        if cat not in spending:
            spending[cat] = {'amount': 0, 'color': color}
        spending[cat]['amount'] = round(spending[cat]['amount'] + (p.total_price or 0), 2)

    return [{'category': k, 'amount': v['amount'], 'color': v['color']}
            for k, v in sorted(spending.items(), key=lambda x: -x[1]['amount'])]


def get_monthly_purchase_trend(months=6):
    """Purchase totals for the past N months (for line/bar chart)."""
    today = date.today()
    result = []
    for i in range(months - 1, -1, -1):
        # Go back i months
        m = today.month - i
        y = today.year
        while m <= 0:
            m += 12
            y -= 1
        start = date(y, m, 1)
        _, last_day = monthrange(y, m)
        end = date(y, m, last_day)

        total = (
            db.session.query(func.sum(Purchase.total_price))
            .filter(
                Purchase.purchase_date >= start,
                Purchase.purchase_date <= end,
            )
            .scalar() or 0
        )
        result.append({
            'month': start.strftime('%b %Y'),
            'total': round(total, 2),
        })
    return result


def get_product_usage_trend(product_id, months=6):
    """Month-by-month usage for a specific product."""
    today = date.today()
    result = []
    for i in range(months - 1, -1, -1):
        m = today.month - i
        y = today.year
        while m <= 0:
            m += 12
            y -= 1
        start = date(y, m, 1)
        _, last_day = monthrange(y, m)
        end = date(y, m, last_day)

        total = (
            db.session.query(func.sum(Usage.quantity))
            .filter(
                Usage.product_id == product_id,
                Usage.usage_date >= start,
                Usage.usage_date <= end,
            )
            .scalar() or 0
        )
        result.append({'month': start.strftime('%b %Y'), 'total': round(total, 2)})
    return result


def get_price_trend(product_id):
    """Price per unit over time for a product."""
    purchases = (
        Purchase.query
        .filter_by(product_id=product_id)
        .filter(Purchase.unit_price.isnot(None))
        .order_by(Purchase.purchase_date)
        .all()
    )
    return [
        {
            'date': p.purchase_date.strftime('%d %b %Y'),
            'unit_price': p.unit_price,
            'quantity': p.quantity,
        }
        for p in purchases
    ]


def get_smart_insights(year, month):
    """Generate plain-language actionable recommendations."""
    insights = []
    summary = get_monthly_summary(year, month)
    most_used = get_most_used_products(limit=5)
    products = Product.query.filter_by(is_active=True).all()

    # Most used product insight
    if most_used:
        top = most_used[0]
        insights.append({
            'type': 'info',
            'icon': '📊',
            'text': (
                f"{top['name']} is your most frequently used product "
                f"this month ({top['total_used']} {top['unit']})."
            ),
        })

    # Low stock prediction
    for product in products:
        if product.current_quantity <= 0:
            continue
        # Average daily usage over last 30 days
        since = date.today() - timedelta(days=30)
        used_30d = (
            db.session.query(func.sum(Usage.quantity))
            .filter(Usage.product_id == product.id, Usage.usage_date >= since)
            .scalar() or 0
        )
        if used_30d > 0:
            daily_rate = used_30d / 30
            days_left = product.current_quantity / daily_rate
            if days_left < 14:
                insights.append({
                    'type': 'warning',
                    'icon': '⚠️',
                    'text': (
                        f"{product.name} may run out in about "
                        f"{int(days_left)} days based on recent usage. "
                        f"Current stock: {product.current_quantity} {product.unit.symbol}."
                    ),
                })

    # Category spending insight
    cat_spending = get_category_spending(year, month)
    if cat_spending:
        top_cat = cat_spending[0]
        insights.append({
            'type': 'info',
            'icon': '💰',
            'text': (
                f"{top_cat['category']} products accounted for the highest "
                f"purchase spending this month "
                f"(₹{top_cat['amount']:,.0f})."
            ),
        })

    # High purchase month
    if summary['total_purchase_cost'] > 0:
        prev_month = month - 1 or 12
        prev_year = year if month > 1 else year - 1
        prev = get_monthly_summary(prev_year, prev_month)
        if prev['total_purchase_cost'] > 0:
            pct = ((summary['total_purchase_cost'] - prev['total_purchase_cost'])
                   / prev['total_purchase_cost'] * 100)
            if abs(pct) > 20:
                direction = 'higher' if pct > 0 else 'lower'
                insights.append({
                    'type': 'warning' if pct > 0 else 'success',
                    'icon': '📈' if pct > 0 else '📉',
                    'text': (
                        f"Purchase spending this month is {abs(pct):.0f}% "
                        f"{direction} than last month."
                    ),
                })

    return insights[:6]  # cap at 6 insights


def get_stock_status_summary():
    """Count of products by stock status."""
    products = Product.query.filter_by(is_active=True).all()
    in_stock = sum(1 for p in products if p.status == 'in_stock')
    low_stock = sum(1 for p in products if p.status == 'low_stock')
    out_of_stock = sum(1 for p in products if p.status == 'out_of_stock')
    return {
        'in_stock': in_stock,
        'low_stock': low_stock,
        'out_of_stock': out_of_stock,
        'total': len(products),
    }


def get_reorder_suggestions():
    """Suggest reorder quantities based on usage history."""
    products = Product.query.filter_by(is_active=True).all()
    suggestions = []
    since = date.today() - timedelta(days=30)

    for product in products:
        if product.current_quantity > product.minimum_stock:
            continue
        used_30d = (
            db.session.query(func.sum(Usage.quantity))
            .filter(Usage.product_id == product.id, Usage.usage_date >= since)
            .scalar() or 0
        )
        monthly_avg = used_30d
        suggested = max(monthly_avg * 1.5, product.minimum_stock * 2)
        suggestions.append({
            'product_id': product.id,
            'name': product.name,
            'current_stock': product.current_quantity,
            'minimum_stock': product.minimum_stock,
            'monthly_avg_usage': round(monthly_avg, 2),
            'suggested_reorder': round(suggested, 2),
            'unit': product.unit.symbol if product.unit else '',
        })
    return suggestions
