from datetime import date
from ..models import db, Product, StockMovement, Notification, Purchase, Usage


def record_purchase(product_id, quantity, unit_id, unit_price,
                    total_price, purchase_date, supplier_name=None,
                    invoice_number=None, remarks=None, bill_file=None):
    """
    Transaction-first purchase recorder:
    1. Validate product and positive quantity.
    2. Auto-compute total or unit price if missing.
    3. Create Purchase record.
    4. Increment product.current_quantity.
    5. Create StockMovement record (PURCHASE).
    6. Commit transaction atomically.
    Returns (purchase, None) on success, or (None, error_str) on error.
    """
    product = Product.query.get(product_id)
    if not product:
        return None, 'Product not found in database.'

    try:
        quantity = float(quantity)
    except (TypeError, ValueError):
        return None, 'Quantity must be a valid number.'

    if quantity <= 0:
        return None, 'Quantity must be greater than zero.'

    # Calculate prices
    if unit_price and not total_price:
        total_price = round(float(unit_price) * quantity, 2)
    elif total_price and not unit_price:
        unit_price = round(float(total_price) / quantity, 2)
    elif unit_price:
        unit_price = float(unit_price)
    if total_price:
        total_price = float(total_price)

    try:
        # Step 1: Create purchase record
        purchase = Purchase(
            product_id=product.id,
            quantity=quantity,
            unit_id=unit_id or product.unit_id,
            unit_price=unit_price,
            total_price=total_price,
            purchase_date=purchase_date or date.today(),
            supplier_name=(supplier_name or '').strip() or None,
            invoice_number=(invoice_number or '').strip() or None,
            remarks=(remarks or '').strip() or None,
            bill_file=bill_file,
        )
        db.session.add(purchase)
        db.session.flush()  # obtain purchase.id

        # Step 2: Increment current stock persistently
        product.current_quantity = round(product.current_quantity + quantity, 4)

        # Step 3: Record ledger stock movement
        movement = StockMovement(
            product_id=product.id,
            movement_type='PURCHASE',
            quantity=quantity,
            balance_after=product.current_quantity,
            reference_id=purchase.id,
            movement_date=purchase.purchase_date,
            remarks=remarks or f'Purchase invoice #{purchase.invoice_number or purchase.id}',
        )
        db.session.add(movement)

        # Step 4: Update notifications
        _check_and_update_notifications(product)

        # Step 5: Commit transaction
        db.session.commit()
        return purchase, None

    except Exception as e:
        db.session.rollback()
        return None, f'Database transaction failed: {str(e)}'


def record_usage(product_id, quantity, unit_id, usage_date,
                 field_location=None, reason=None, remarks=None):
    """
    Transaction-first usage recorder:
    1. Find product in DB.
    2. Read current stock.
    3. Validate requested quantity.
    4. REJECT if requested > available:
       "Insufficient Stock. Available: X KG. Requested: Y KG."
    5. Deduct quantity.
    6. Create StockMovement record (USAGE).
    7. Commit transaction atomically.
    Returns (usage, None) on success, or (None, error_str) on error.
    """
    product = Product.query.get(product_id)
    if not product:
        return None, 'Product not found in database.'

    try:
        quantity = float(quantity)
    except (TypeError, ValueError):
        return None, 'Usage quantity must be a valid number.'

    if quantity <= 0:
        return None, 'Usage quantity must be greater than zero.'

    unit_sym = product.unit.symbol if product.unit else ''

    # SECTION 12: NEVER ALLOW NEGATIVE STOCK
    if quantity > product.current_quantity:
        return None, (
            f'Insufficient Stock. Available: {product.current_quantity} {unit_sym}. '
            f'Requested: {quantity} {unit_sym}.'
        )

    try:
        # Step 1: Create usage record
        usage = Usage(
            product_id=product.id,
            quantity=quantity,
            unit_id=unit_id or product.unit_id,
            usage_date=usage_date or date.today(),
            field_location=(field_location or '').strip() or None,
            reason=(reason or '').strip() or None,
            remarks=(remarks or '').strip() or None,
        )
        db.session.add(usage)
        db.session.flush()  # obtain usage.id

        # Step 2: Deduct quantity from current stock persistently
        product.current_quantity = round(product.current_quantity - quantity, 4)

        # Step 3: Record ledger stock movement
        movement = StockMovement(
            product_id=product.id,
            movement_type='USAGE',
            quantity=-quantity,
            balance_after=product.current_quantity,
            reference_id=usage.id,
            movement_date=usage.usage_date,
            remarks=remarks or (f'Field: {field_location}' if field_location else 'Application consumption'),
        )
        db.session.add(movement)

        # Step 4: Check low stock / out of stock alerts
        _check_and_update_notifications(product)

        # Step 5: Commit transaction
        db.session.commit()
        return usage, None

    except Exception as e:
        db.session.rollback()
        return None, f'Database transaction failed: {str(e)}'


def get_current_stock(product_id):
    """Query current product stock directly from database."""
    product = Product.query.get(product_id)
    return product.current_quantity if product else 0.0


def check_low_stock(product_id):
    """Check if product stock has hit or fallen below low-stock threshold."""
    product = Product.query.get(product_id)
    if not product:
        return False
    return product.current_quantity <= product.minimum_stock


def get_product_stock_history(product_id):
    """Retrieve full chronological stock audit ledger for a product."""
    product = Product.query.get(product_id)
    if not product:
        return []
    movements = (
        StockMovement.query
        .filter_by(product_id=product.id)
        .order_by(StockMovement.movement_date.desc(), StockMovement.id.desc())
        .all()
    )
    return [m.to_dict() for m in movements]


def reconcile_product_stock(product_id, apply_fix=False):
    """
    Audit stock consistency:
    Product Current Stock = Initial Stock + Purchases - Usages + Adjustments
    """
    product = Product.query.get(product_id)
    if not product:
        return None, 'Product not found.'

    movements = StockMovement.query.filter_by(product_id=product_id).all()
    calculated = round(sum(m.quantity for m in movements), 4)
    current = round(product.current_quantity, 4)
    matches = abs(calculated - current) < 0.0001

    if not matches and apply_fix:
        try:
            diff = calculated - current
            product.current_quantity = calculated
            db.session.add(StockMovement(
                product_id=product.id,
                movement_type='ADJUSTMENT',
                quantity=diff,
                balance_after=calculated,
                movement_date=date.today(),
                remarks=f'Stock reconciliation auto-adjustment (from {current} to {calculated})',
            ))
            db.session.commit()
            current = calculated
            matches = True
        except Exception as e:
            db.session.rollback()
            return None, f'Reconciliation failed: {e}'

    return {
        'product_id': product.id,
        'product_name': product.name,
        'current_stock': current,
        'calculated_from_ledger': calculated,
        'is_consistent': matches,
    }, None


def _check_and_update_notifications(product):
    """
    Create low-stock or out-of-stock notifications when thresholds are crossed.
    Avoids duplicate unread notifications for the same product.
    """
    existing = Notification.query.filter_by(
        product_id=product.id,
        is_read=False,
    ).filter(
        Notification.type.in_(['low_stock', 'out_of_stock'])
    ).first()

    unit_sym = product.unit.symbol if product.unit else ''

    if product.current_quantity <= 0:
        if not existing or existing.type != 'out_of_stock':
            if existing:
                db.session.delete(existing)
            notif = Notification(
                type='out_of_stock',
                title=f'Out of Stock: {product.name}',
                message=f'{product.name} is completely out of stock. Please purchase immediately.',
                product_id=product.id,
            )
            db.session.add(notif)

    elif (product.minimum_stock > 0 and product.current_quantity <= product.minimum_stock):
        if not existing or existing.type != 'low_stock':
            if existing:
                db.session.delete(existing)
            notif = Notification(
                type='low_stock',
                title=f'Low Stock Alert: {product.name}',
                message=(
                    f'{product.name} stock has reached {product.current_quantity} {unit_sym} '
                    f'(threshold: {product.minimum_stock} {unit_sym}).'
                ),
                product_id=product.id,
            )
            db.session.add(notif)
    else:
        # Stock is healthy above threshold — clear any obsolete alert
        if existing:
            db.session.delete(existing)
