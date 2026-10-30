import re
from datetime import date


def validate_product(data):
    errors = {}
    name = (data.get('name') or '').strip()
    if not name:
        errors['name'] = 'Product name is required.'
    elif len(name) > 150:
        errors['name'] = 'Product name must be under 150 characters.'

    if not data.get('category_id'):
        errors['category_id'] = 'Category is required.'

    if not data.get('unit_id') and not data.get('unit_package') and not data.get('default_package_unit'):
        errors['unit_id'] = 'Unit is required.'

    bag_qty = data.get('bag_quantity')
    if bag_qty is not None and str(bag_qty).strip() != '':
        try:
            if float(bag_qty) < 0:
                errors['bag_quantity'] = 'Bag quantity cannot be negative.'
        except (TypeError, ValueError):
            errors['bag_quantity'] = 'Please enter a valid bag quantity.'

    loose_qty = data.get('loose_quantity')
    if loose_qty is not None and str(loose_qty).strip() != '':
        try:
            if float(loose_qty) < 0:
                errors['loose_quantity'] = 'Loose quantity cannot be negative.'
        except (TypeError, ValueError):
            errors['loose_quantity'] = 'Please enter a valid loose quantity.'

    qty = data.get('current_quantity', 0)
    try:
        qty = float(qty)
        if qty < 0:
            errors['current_quantity'] = 'Quantity cannot be negative.'
    except (TypeError, ValueError):
        errors['current_quantity'] = 'Please enter a valid quantity.'

    min_stock = data.get('minimum_stock', 0)
    try:
        min_stock = float(min_stock)
        if min_stock < 0:
            errors['minimum_stock'] = 'Minimum stock cannot be negative.'
    except (TypeError, ValueError):
        errors['minimum_stock'] = 'Please enter a valid minimum stock value.'

    return errors


def validate_purchase(data):
    errors = {}
    if not data.get('product_id'):
        errors['product_id'] = 'Please select a product.'

    qty = data.get('quantity')
    pkg_count = data.get('package_count')

    if (qty is None or str(qty).strip() == '' or float(qty or 0) <= 0) and pkg_count:
        try:
            if float(pkg_count) <= 0:
                errors['quantity'] = 'Quantity must be greater than zero.'
        except (TypeError, ValueError):
            errors['quantity'] = 'Please enter a valid package quantity.'
    else:
        try:
            qty_val = float(qty)
            if qty_val <= 0:
                errors['quantity'] = 'Quantity must be greater than zero.'
        except (TypeError, ValueError):
            errors['quantity'] = 'Please enter a valid quantity.'

    unit_price = data.get('unit_price')
    total_price = data.get('total_price')
    if unit_price:
        try:
            unit_price = float(unit_price)
            if unit_price < 0:
                errors['unit_price'] = 'Price cannot be negative.'
        except (TypeError, ValueError):
            errors['unit_price'] = 'Please enter a valid unit price.'
    if total_price:
        try:
            total_price = float(total_price)
            if total_price < 0:
                errors['total_price'] = 'Total price cannot be negative.'
        except (TypeError, ValueError):
            errors['total_price'] = 'Please enter a valid total price.'

    if not data.get('purchase_date'):
        errors['purchase_date'] = 'Purchase date is required.'

    return errors


def validate_usage(data):
    errors = {}
    if not data.get('product_id'):
        errors['product_id'] = 'Please select a product.'

    qty = data.get('quantity')
    pkg_count = data.get('package_count')

    if (qty is None or str(qty).strip() == '' or float(qty or 0) <= 0) and pkg_count:
        try:
            if float(pkg_count) <= 0:
                errors['quantity'] = 'Quantity must be greater than zero.'
        except (TypeError, ValueError):
            errors['quantity'] = 'Please enter a valid package quantity.'
    else:
        try:
            qty_val = float(qty)
            if qty_val <= 0:
                errors['quantity'] = 'Quantity must be greater than zero.'
        except (TypeError, ValueError):
            errors['quantity'] = 'Please enter a valid quantity.'

    if not data.get('usage_date'):
        errors['usage_date'] = 'Usage date is required.'

    return errors


def allowed_file(filename, allowed_extensions):
    return ('.' in filename
            and filename.rsplit('.', 1)[1].lower() in allowed_extensions)


def parse_date(date_str):
    """Parse ISO date string to date object."""
    try:
        return date.fromisoformat(date_str)
    except (ValueError, TypeError):
        return None
