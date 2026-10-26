import csv
import io
from datetime import date, datetime
from ..models import db, Product, Purchase, Usage, Category, Unit
from ..services.stock_service import record_purchase


# ── CSV Import ──────────────────────────────────────────────────────────────

REQUIRED_COLUMNS = {'product name', 'category', 'quantity', 'unit'}


def parse_csv(file_stream):
    """
    Parse a CSV file stream.
    Returns (rows_list, error_message).
    """
    try:
        content = file_stream.read().decode('utf-8-sig')
        reader = csv.DictReader(io.StringIO(content))
        headers = {h.strip().lower() for h in (reader.fieldnames or [])}

        missing = REQUIRED_COLUMNS - headers
        if missing:
            return None, f"Missing required columns: {', '.join(missing)}"

        rows = [
            {k.strip().lower(): (v.strip() if v else '') for k, v in row.items()}
            for row in reader
        ]
        return rows, None
    except Exception as e:
        return None, f'Could not read CSV file: {str(e)}'


def validate_and_preview(rows):
    """
    Validate CSV rows.
    Returns (valid_rows, invalid_rows).
    Each invalid_row has a 'error' key.
    """
    valid, invalid = [], []

    for i, row in enumerate(rows, start=2):  # row 1 is header
        errors = []
        name = row.get('product name', '').strip()
        category_name = row.get('category', '').strip()
        unit_name = row.get('unit', '').strip()
        qty_str = row.get('quantity', '').strip()
        price_str = row.get('price', '').strip()

        if not name:
            errors.append('Product name is required')
        if not category_name:
            errors.append('Category is required')
        if not unit_name:
            errors.append('Unit is required')

        qty = None
        if not qty_str:
            errors.append('Quantity is required')
        else:
            try:
                qty = float(qty_str)
                if qty < 0:
                    errors.append('Quantity cannot be negative')
            except ValueError:
                errors.append(f'Invalid quantity: {qty_str}')

        price = None
        if price_str:
            try:
                price = float(price_str)
                if price < 0:
                    errors.append('Price cannot be negative')
            except ValueError:
                errors.append(f'Invalid price: {price_str}')

        row_info = {
            'row': i,
            'name': name,
            'category': category_name,
            'unit': unit_name,
            'quantity': qty,
            'price': price,
            'remarks': row.get('remarks', ''),
        }

        if errors:
            row_info['error'] = '; '.join(errors)
            invalid.append(row_info)
        else:
            valid.append(row_info)

    return valid, invalid


def import_products(valid_rows):
    """
    Import validated product rows into the database.
    Returns (imported_count, skipped_rows).
    """
    imported = 0
    skipped = []

    for row in valid_rows:
        try:
            # Get or create category
            cat = Category.query.filter(
                db.func.lower(Category.name) == row['category'].lower()
            ).first()
            if not cat:
                cat = Category(name=row['category'])
                db.session.add(cat)
                db.session.flush()

            # Get or create unit
            unit = Unit.query.filter(
                db.func.lower(Unit.symbol) == row['unit'].lower()
            ).first()
            if not unit:
                unit = Unit.query.filter(
                    db.func.lower(Unit.name) == row['unit'].lower()
                ).first()
            if not unit:
                unit = Unit(name=row['unit'], symbol=row['unit'].upper())
                db.session.add(unit)
                db.session.flush()

            # Check for duplicate
            existing = Product.query.filter(
                db.func.lower(Product.name) == row['name'].lower()
            ).first()
            if existing:
                skipped.append({
                    'row': row['row'],
                    'name': row['name'],
                    'error': f'{row["name"]} already exists — skipped',
                })
                continue

            product = Product(
                name=row['name'],
                category_id=cat.id,
                unit_id=unit.id,
                current_quantity=row['quantity'],
                minimum_stock=0,
            )
            db.session.add(product)
            db.session.flush()

            # Record initial stock as a purchase if price given
            if row['price'] and row['quantity'] > 0:
                purchase, _ = record_purchase(
                    product_id=product.id,
                    quantity=row['quantity'],
                    unit_id=unit.id,
                    unit_price=row['price'],
                    total_price=row['price'] * row['quantity'],
                    purchase_date=date.today(),
                    remarks=row.get('remarks') or 'Imported via CSV',
                )

            imported += 1
        except Exception as e:
            skipped.append({'row': row['row'], 'name': row.get('name', '?'), 'error': str(e)})

    db.session.commit()
    return imported, skipped


# ── CSV Export ──────────────────────────────────────────────────────────────

def export_products_csv():
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(['Product Name', 'Category', 'Unit', 'Current Stock',
                     'Minimum Stock', 'Status', 'Total Purchased',
                     'Total Used', 'Total Cost (₹)'])
    for p in Product.query.filter_by(is_active=True).order_by(Product.name).all():
        writer.writerow([
            p.name, p.category.name if p.category else '',
            p.unit.symbol if p.unit else '',
            p.current_quantity, p.minimum_stock, p.status.replace('_', ' ').title(),
            p.total_purchased, p.total_used, p.total_purchase_cost,
        ])
    output.seek(0)
    return output.getvalue()


def export_purchases_csv(start_date=None, end_date=None):
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(['Date', 'Product', 'Category', 'Quantity', 'Unit',
                     'Unit Price (₹)', 'Total Price (₹)', 'Supplier',
                     'Invoice No.', 'Remarks'])
    query = Purchase.query.order_by(Purchase.purchase_date.desc())
    if start_date:
        query = query.filter(Purchase.purchase_date >= start_date)
    if end_date:
        query = query.filter(Purchase.purchase_date <= end_date)
    for p in query.all():
        writer.writerow([
            p.purchase_date.strftime('%d/%m/%Y'),
            p.product.name if p.product else '',
            p.product.category.name if p.product and p.product.category else '',
            p.quantity, p.unit.symbol if p.unit else '',
            p.unit_price or '', p.total_price or '',
            p.supplier_name or '', p.invoice_number or '', p.remarks or '',
        ])
    output.seek(0)
    return output.getvalue()


def export_usage_csv(start_date=None, end_date=None):
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(['Date', 'Product', 'Category', 'Quantity', 'Unit',
                     'Field / Location', 'Reason', 'Remarks'])
    query = Usage.query.order_by(Usage.usage_date.desc())
    if start_date:
        query = query.filter(Usage.usage_date >= start_date)
    if end_date:
        query = query.filter(Usage.usage_date <= end_date)
    for u in query.all():
        writer.writerow([
            u.usage_date.strftime('%d/%m/%Y'),
            u.product.name if u.product else '',
            u.product.category.name if u.product and u.product.category else '',
            u.quantity, u.unit.symbol if u.unit else '',
            u.field_location or '', u.reason or '', u.remarks or '',
        ])
    output.seek(0)
    return output.getvalue()
