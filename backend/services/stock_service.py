from datetime import date
from ..models import db, Product, StockMovement, Notification, Purchase, Usage, ProductPackageStock, PackageMaster


def record_purchase(product_id, quantity=None, unit_id=None, unit_price=0.0,
                    total_price=None, purchase_date=None, supplier_name=None,
                    invoice_number=None, remarks=None, bill_file=None,
                    packaging_type=None, package_size=None, package_unit=None, package_count=None,
                    loose_quantity=None):
    """
    Transaction-first purchase recorder:
    1. Validate product and compute standard quantity from packaging type + package size + count + optional loose quantity.
    2. Auto-compute total or unit price if missing.
    3. Create Purchase record with packaging details.
    4. Update product current_quantity and ProductPackageStock breakdown (separate bag & loose records).
    5. Create StockMovement record with package_summary.
    6. Commit transaction atomically.
    Returns (purchase, None) on success, or (None, error_str) on error.
    """
    product = Product.query.get(product_id)
    if not product:
        return None, 'Product not found in database.'

    if unit_id is None:
        unit_id = product.unit_id

    if purchase_date is None:
        purchase_date = date.today()

    unit_sym = product.unit.symbol if product.unit else 'kg'

    # Compute quantity from package parameters if package count is provided
    pkg_type = (packaging_type or '').strip()
    p_size = float(package_size) if package_size is not None and str(package_size).strip() != '' else None
    p_unit = (package_unit or unit_sym).strip()
    p_count = float(package_count) if package_count is not None and str(package_count).strip() != '' else None
    l_qty = float(loose_quantity) if loose_quantity is not None and str(loose_quantity).strip() != '' else 0.0

    bag_weight = 0.0
    if pkg_type:
        if pkg_type.lower() == 'loose':
            # Loose product: package_count or l_qty is the quantity in base unit
            if quantity is None or quantity <= 0:
                quantity = p_count if (p_count and p_count > 0) else l_qty
            package_summary = f"{quantity:g} {p_unit} Loose"
            p_size = 1.0
            p_count = quantity
            l_qty = quantity
        else:
            # Combined Product + Package Type + Package Size + Quantity + optional Loose
            multiplier = PackageMaster.compute_multiplier(p_size or 1.0, p_unit) if p_size else 1.0
            if p_size and p_count:
                bag_weight = round(p_count * multiplier, 4)
                computed_qty = round(bag_weight + l_qty, 4)
                if not quantity or quantity <= 0:
                    quantity = computed_qty
                noun = f"{pkg_type}s" if p_count != 1 else pkg_type
                if l_qty > 0:
                    package_summary = f"{p_count:g} {noun} × {p_size:g} {p_unit} = {bag_weight:g} {unit_sym} + Loose: {l_qty:g} {unit_sym} = {quantity:g} {unit_sym}"
                else:
                    package_summary = f"{p_count:g} {noun} × {p_size:g} {p_unit} = {quantity:g} {unit_sym}"
            elif l_qty > 0:
                quantity = l_qty
                package_summary = f"{l_qty:g} {unit_sym} Loose"
            else:
                package_summary = f"{quantity:g} {unit_sym}" if quantity else ""
    elif l_qty > 0:
        quantity = l_qty
        package_summary = f"{l_qty:g} {unit_sym} Loose"
    else:
        package_summary = None

    try:
        quantity = float(quantity)
    except (TypeError, ValueError):
        return None, 'Quantity must be a valid number.'

    if quantity <= 0:
        return None, 'Quantity must be greater than zero.'

    try:
        unit_price = float(unit_price or 0.0)
    except (TypeError, ValueError):
        unit_price = 0.0

    if total_price is None:
        total_price = round(quantity * unit_price, 2)

    # Calculate prices
    if unit_price and not total_price:
        total_price = round(float(unit_price) * (p_count if (p_count and pkg_type.lower() != 'loose') else quantity), 2)
    elif total_price and not unit_price:
        divisor = p_count if (p_count and pkg_type.lower() != 'loose') else quantity
        unit_price = round(float(total_price) / divisor, 2)
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
            packaging_type=pkg_type or None,
            package_size=p_size,
            package_unit=p_unit,
            package_count=p_count,
            package_summary=package_summary,
            unit_price=unit_price,
            total_price=total_price,
            purchase_date=purchase_date or date.today(),
            supplier_name=(supplier_name or '').strip() or None,
            invoice_number=(invoice_number or '').strip() or None,
            remarks=(remarks or '').strip() or None,
            bill_file=bill_file,
        )
        db.session.add(purchase)
        db.session.flush()

        # Step 2: Increment product's overall current stock
        product.current_quantity = round(product.current_quantity + quantity, 4)

        # Step 3: Update package stock breakdown (Preserve physical bags & loose stock separately)
        if pkg_type and pkg_type.lower() != 'loose':
            bag_tot = bag_weight if bag_weight > 0 else round((p_count or 1.0) * (p_size or 1.0), 4)
            stock_item = ProductPackageStock.query.filter(
                ProductPackageStock.product_id == product.id,
                db.func.lower(ProductPackageStock.packaging_type) == pkg_type.lower(),
                ProductPackageStock.package_size == (p_size or 1.0),
                db.func.lower(ProductPackageStock.unit_symbol) == p_unit.lower()
            ).first()

            if stock_item:
                stock_item.package_count = round(stock_item.package_count + (p_count or 0.0), 4)
                stock_item.total_quantity = round(stock_item.total_quantity + bag_tot, 4)
            else:
                db.session.add(ProductPackageStock(
                    product_id=product.id,
                    packaging_type=pkg_type,
                    package_size=p_size or 1.0,
                    unit_symbol=p_unit,
                    package_count=round(p_count or 0.0, 4),
                    total_quantity=round(bag_tot, 4)
                ))

        # If loose stock was entered or loose packaging was chosen, update separate Loose record
        if l_qty > 0 or (pkg_type and pkg_type.lower() == 'loose'):
            loose_amount = l_qty if l_qty > 0 else quantity
            loose_item = ProductPackageStock.query.filter(
                ProductPackageStock.product_id == product.id,
                db.func.lower(ProductPackageStock.packaging_type) == 'loose'
            ).first()

            if loose_item:
                loose_item.package_count = round(loose_item.package_count + loose_amount, 4)
                loose_item.total_quantity = round(loose_item.total_quantity + loose_amount, 4)
            else:
                db.session.add(ProductPackageStock(
                    product_id=product.id,
                    packaging_type='Loose',
                    package_size=1.0,
                    unit_symbol=unit_sym,
                    package_count=round(loose_amount, 4),
                    total_quantity=round(loose_amount, 4)
                ))

        # Step 4: Record ledger stock movement
        movement = StockMovement(
            product_id=product.id,
            movement_type='PURCHASE',
            quantity=quantity,
            balance_after=product.current_quantity,
            reference_id=purchase.id,
            packaging_type=pkg_type or None,
            package_summary=package_summary,
            movement_date=purchase.purchase_date,
            remarks=remarks or (f'{package_summary} | Bill #{purchase.invoice_number or purchase.id}' if package_summary else f'Purchase invoice #{purchase.invoice_number or purchase.id}'),
        )
        db.session.add(movement)

        # Step 5: Update notifications
        _check_and_update_notifications(product)

        # Step 6: Commit transaction
        db.session.commit()
        return purchase, None

    except Exception as e:
        db.session.rollback()
        return None, f'Database transaction failed: {str(e)}'


def record_usage(product_id, quantity=None, unit_id=None, usage_date=None,
                 field_location=None, reason=None, remarks=None,
                 packaging_type=None, package_size=None, package_unit=None, package_count=None):
    """
    Transaction-first usage recorder:
    1. Find product in DB and validate requested packaging & quantity.
    2. REJECT if requested > available.
    3. Deduct from product.current_quantity and ProductPackageStock breakdown.
    4. Create StockMovement record (USAGE) with package_summary.
    5. Commit transaction atomically.
    Returns (usage, None) on success, or (None, error_str) on error.
    """
    product = Product.query.get(product_id)
    if not product:
        return None, 'Product not found in database.'

    if unit_id is None:
        unit_id = product.unit_id

    if usage_date is None:
        usage_date = date.today()

    unit_sym = product.unit.symbol if product.unit else 'kg'

    pkg_type = (packaging_type or '').strip()
    p_size = float(package_size) if package_size is not None and str(package_size).strip() != '' else None
    p_unit = (package_unit or unit_sym).strip()
    p_count = float(package_count) if package_count is not None and str(package_count).strip() != '' else None

    if pkg_type:
        if pkg_type.lower() == 'loose':
            if quantity is None or quantity <= 0:
                quantity = p_count if p_count and p_count > 0 else 0.0
            package_summary = f"{quantity:g} {p_unit} Loose"
            p_size = 1.0
            p_count = quantity
        else:
            if p_size and p_count:
                multiplier = PackageMaster.compute_multiplier(p_size, p_unit)
                computed_qty = round(p_count * multiplier, 4)
                if not quantity or quantity <= 0:
                    quantity = computed_qty
                noun = f"{pkg_type}s" if p_count != 1 else pkg_type
                package_summary = f"{p_count:g} {noun} × {p_size:g} {p_unit} = {quantity:g} {unit_sym}"
            else:
                package_summary = f"{quantity:g} {unit_sym}" if quantity else ""
    else:
        package_summary = None

    try:
        quantity = float(quantity)
    except (TypeError, ValueError):
        return None, 'Usage quantity must be a valid number.'

    if quantity <= 0:
        return None, 'Usage quantity must be greater than zero.'

    # NEVER ALLOW NEGATIVE STOCK
    if quantity > product.current_quantity:
        avail_fmt = f"{product.current_quantity:.1f}" if product.current_quantity == int(product.current_quantity) else f"{product.current_quantity:g}"
        req_fmt = f"{quantity:.1f}" if quantity == int(quantity) else f"{quantity:g}"
        return None, (
            f'Insufficient Stock. Available: {avail_fmt} {unit_sym}. '
            f'Requested: {req_fmt} {unit_sym}.'
        )

    # Check package-level stock if specific package was picked (Section 15, 16, 25)
    stock_item = None
    if pkg_type:
        if pkg_type.lower() == 'loose':
            stock_item = ProductPackageStock.query.filter(
                ProductPackageStock.product_id == product.id,
                db.func.lower(ProductPackageStock.packaging_type) == 'loose'
            ).first()
            if stock_item and quantity > stock_item.package_count:
                return None, (
                    f"Insufficient Loose Stock. Available: {stock_item.package_count:g} {unit_sym}. "
                    f"Requested: {quantity:g} {unit_sym}."
                )
        elif p_size is not None and p_count is not None:
            stock_item = ProductPackageStock.query.filter(
                ProductPackageStock.product_id == product.id,
                db.func.lower(ProductPackageStock.packaging_type) == pkg_type.lower(),
                ProductPackageStock.package_size == p_size,
                db.func.lower(ProductPackageStock.unit_symbol) == p_unit.lower()
            ).first()
            if stock_item and p_count > stock_item.package_count:
                noun = f"{pkg_type}s" if stock_item.package_count != 1 else pkg_type
                return None, (
                    f"Insufficient {p_size:g} {p_unit} {pkg_type} Stock. "
                    f"Available: {stock_item.package_count:g} {noun}. Requested: {p_count:g} {noun}."
                )

    try:
        # Step 1: Create usage record
        usage = Usage(
            product_id=product.id,
            quantity=quantity,
            unit_id=unit_id or product.unit_id,
            packaging_type=pkg_type or None,
            package_size=p_size,
            package_unit=p_unit,
            package_count=p_count,
            package_summary=package_summary,
            usage_date=usage_date or date.today(),
            field_location=(field_location or '').strip() or None,
            reason=(reason or '').strip() or None,
            remarks=(remarks or '').strip() or None,
        )
        db.session.add(usage)
        db.session.flush()

        # Step 2: Deduct quantity from current stock persistently
        product.current_quantity = max(0.0, round(product.current_quantity - quantity, 4))

        # Step 3: Deduct from package stock breakdown if matching package found
        if stock_item:
            deduct_count = (p_count if p_count is not None else quantity) if (pkg_type and pkg_type.lower() != 'loose') else quantity
            stock_item.package_count = max(0.0, round(stock_item.package_count - deduct_count, 4))
            stock_item.total_quantity = max(0.0, round(stock_item.total_quantity - quantity, 4))
            if stock_item.package_count <= 0 and stock_item.total_quantity <= 0:
                db.session.delete(stock_item)

        # Step 4: Record ledger stock movement
        movement = StockMovement(
            product_id=product.id,
            movement_type='USAGE',
            quantity=-quantity,
            balance_after=product.current_quantity,
            reference_id=usage.id,
            packaging_type=pkg_type or None,
            package_summary=package_summary,
            movement_date=usage.usage_date,
            remarks=remarks or (f'{package_summary} | Field: {field_location or "General"}' if package_summary else (f'Field: {field_location}' if field_location else 'Application consumption')),
        )
        db.session.add(movement)

        # Step 5: Check low stock / out of stock alerts
        _check_and_update_notifications(product)

        # Step 6: Commit transaction
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
