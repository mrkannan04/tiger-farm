import io
import os
from datetime import date
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm, mm
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    HRFlowable, PageBreak,
)
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT


# ── Color palette matching the web UI ───────────────────────────────────────
GREEN_DARK = colors.HexColor('#2D6A4F')
GREEN_MID = colors.HexColor('#52B788')
GREEN_LIGHT = colors.HexColor('#D8F3DC')
AMBER = colors.HexColor('#D4A017')
RED = colors.HexColor('#C1292E')
LIGHT_GRAY = colors.HexColor('#F7F9F7')
MID_GRAY = colors.HexColor('#DADFE0')
TEXT = colors.HexColor('#1B2E1F')
MUTED = colors.HexColor('#6B7F6E')


def _build_styles():
    styles = getSampleStyleSheet()
    return {
        'title': ParagraphStyle(
            'TFTitle', fontName='Helvetica-Bold', fontSize=20,
            textColor=GREEN_DARK, spaceAfter=4, alignment=TA_LEFT,
        ),
        'subtitle': ParagraphStyle(
            'TFSub', fontName='Helvetica', fontSize=10,
            textColor=MUTED, spaceAfter=2,
        ),
        'section': ParagraphStyle(
            'TFSection', fontName='Helvetica-Bold', fontSize=12,
            textColor=GREEN_DARK, spaceBefore=14, spaceAfter=6,
        ),
        'body': ParagraphStyle(
            'TFBody', fontName='Helvetica', fontSize=9,
            textColor=TEXT, leading=13,
        ),
        'small': ParagraphStyle(
            'TFSmall', fontName='Helvetica', fontSize=8,
            textColor=MUTED,
        ),
    }


def _header_footer(canvas, doc):
    """Draw the Tiger Farm header and page footer on every page."""
    canvas.saveState()
    w, h = A4

    # Top bar
    canvas.setFillColor(GREEN_DARK)
    canvas.rect(0, h - 30 * mm, w, 30 * mm, fill=1, stroke=0)

    canvas.setFillColor(colors.white)
    canvas.setFont('Helvetica-Bold', 16)
    canvas.drawString(1.5 * cm, h - 15 * mm, '🐯 TIGER FARM')
    canvas.setFont('Helvetica', 9)
    canvas.drawString(1.5 * cm, h - 22 * mm, 'Smart Records. Better Farming.')

    canvas.setFont('Helvetica', 8)
    canvas.drawRightString(w - 1.5 * cm, h - 15 * mm,
                           f'Generated: {date.today().strftime("%d %b %Y")}')
    canvas.drawRightString(w - 1.5 * cm, h - 22 * mm,
                           f'Page {doc.page}')

    # Bottom bar
    canvas.setFillColor(GREEN_LIGHT)
    canvas.rect(0, 0, w, 12 * mm, fill=1, stroke=0)
    canvas.setFillColor(MUTED)
    canvas.setFont('Helvetica', 7)
    canvas.drawString(1.5 * cm, 4 * mm,
                      'Tiger Farm — Confidential Farm Management Record')
    canvas.restoreState()


def _table_style(has_total=False):
    style = [
        ('BACKGROUND', (0, 0), (-1, 0), GREEN_DARK),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, 0), 9),
        ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
        ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
        ('FONTSIZE', (0, 1), (-1, -1), 8),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, LIGHT_GRAY]),
        ('GRID', (0, 0), (-1, -1), 0.3, MID_GRAY),
        ('TOPPADDING', (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
        ('RIGHTPADDING', (0, 0), (-1, -1), 6),
    ]
    if has_total:
        style += [
            ('BACKGROUND', (0, -1), (-1, -1), GREEN_LIGHT),
            ('FONTNAME', (0, -1), (-1, -1), 'Helvetica-Bold'),
        ]
    return TableStyle(style)


def _make_doc(buffer, title):
    return SimpleDocTemplate(
        buffer,
        pagesize=A4,
        topMargin=35 * mm,
        bottomMargin=20 * mm,
        leftMargin=1.5 * cm,
        rightMargin=1.5 * cm,
        title=title,
    )


# ── Stock Report ─────────────────────────────────────────────────────────────

def generate_stock_report(products):
    """Return PDF bytes for the current stock report."""
    buffer = io.BytesIO()
    doc = _make_doc(buffer, 'Stock Report — Tiger Farm')
    styles = _build_styles()
    story = []

    story.append(Paragraph('Current Stock Report', styles['title']))
    story.append(Paragraph(
        f'As of {date.today().strftime("%d %B %Y")}', styles['subtitle']
    ))
    story.append(Spacer(1, 6 * mm))

    headers = ['Product', 'Category', 'Stock', 'Unit', 'Min. Level', 'Status']
    rows = [headers]
    for p in products:
        status_label = p.status.replace('_', ' ').upper()
        rows.append([
            p.name,
            p.category.name if p.category else '',
            str(p.current_quantity),
            p.unit.symbol if p.unit else '',
            str(p.minimum_stock),
            status_label,
        ])

    col_widths = [5 * cm, 3.5 * cm, 2 * cm, 1.5 * cm, 2.5 * cm, 2.5 * cm]
    table = Table(rows, colWidths=col_widths, repeatRows=1)
    table.setStyle(_table_style())
    story.append(table)

    # Summary
    in_s = sum(1 for p in products if p.status == 'in_stock')
    low_s = sum(1 for p in products if p.status == 'low_stock')
    out_s = sum(1 for p in products if p.status == 'out_of_stock')
    story.append(Spacer(1, 6 * mm))
    story.append(Paragraph(
        f'Total Products: {len(products)}  |  In Stock: {in_s}  |  '
        f'Low Stock: {low_s}  |  Out of Stock: {out_s}',
        styles['small']
    ))

    doc.build(story, onFirstPage=_header_footer, onLaterPages=_header_footer)
    buffer.seek(0)
    return buffer.getvalue()


# ── Purchase Report ──────────────────────────────────────────────────────────

def generate_purchase_report(purchases, start_date=None, end_date=None):
    """Return PDF bytes for the purchase report."""
    buffer = io.BytesIO()
    doc = _make_doc(buffer, 'Purchase Report — Tiger Farm')
    styles = _build_styles()
    story = []

    story.append(Paragraph('Purchase Report', styles['title']))
    range_label = ''
    if start_date and end_date:
        range_label = (f'{start_date.strftime("%d %b %Y")} — '
                       f'{end_date.strftime("%d %b %Y")}')
    elif start_date:
        range_label = f'From {start_date.strftime("%d %b %Y")}'
    story.append(Paragraph(range_label or 'All Records', styles['subtitle']))
    story.append(Spacer(1, 6 * mm))

    headers = ['Date', 'Product', 'Qty', 'Unit', 'Price/Unit', 'Total', 'Supplier']
    rows = [headers]
    total_cost = 0
    for p in purchases:
        rows.append([
            p.purchase_date.strftime('%d/%m/%Y'),
            p.product.name if p.product else '',
            str(p.quantity),
            p.unit.symbol if p.unit else '',
            f'₹{p.unit_price:,.2f}' if p.unit_price else '—',
            f'₹{p.total_price:,.2f}' if p.total_price else '—',
            (p.supplier_name or '')[:20],
        ])
        total_cost += p.total_price or 0

    rows.append(['', '', '', '', 'TOTAL', f'₹{total_cost:,.2f}', ''])
    col_widths = [2.2 * cm, 4 * cm, 1.5 * cm, 1.2 * cm, 2.3 * cm, 2.8 * cm, 3 * cm]
    table = Table(rows, colWidths=col_widths, repeatRows=1)
    table.setStyle(_table_style(has_total=True))
    story.append(table)

    doc.build(story, onFirstPage=_header_footer, onLaterPages=_header_footer)
    buffer.seek(0)
    return buffer.getvalue()


# ── Usage Report ─────────────────────────────────────────────────────────────

def generate_usage_report(usages, start_date=None, end_date=None):
    buffer = io.BytesIO()
    doc = _make_doc(buffer, 'Usage Report — Tiger Farm')
    styles = _build_styles()
    story = []

    story.append(Paragraph('Usage Report', styles['title']))
    range_label = ''
    if start_date and end_date:
        range_label = (f'{start_date.strftime("%d %b %Y")} — '
                       f'{end_date.strftime("%d %b %Y")}')
    story.append(Paragraph(range_label or 'All Records', styles['subtitle']))
    story.append(Spacer(1, 6 * mm))

    headers = ['Date', 'Product', 'Qty', 'Unit', 'Field / Location', 'Reason']
    rows = [headers]
    for u in usages:
        rows.append([
            u.usage_date.strftime('%d/%m/%Y'),
            u.product.name if u.product else '',
            str(u.quantity),
            u.unit.symbol if u.unit else '',
            (u.field_location or '')[:20],
            (u.reason or '')[:30],
        ])

    col_widths = [2.2 * cm, 4 * cm, 1.5 * cm, 1.2 * cm, 3.5 * cm, 4.6 * cm]
    table = Table(rows, colWidths=col_widths, repeatRows=1)
    table.setStyle(_table_style())
    story.append(table)

    doc.build(story, onFirstPage=_header_footer, onLaterPages=_header_footer)
    buffer.seek(0)
    return buffer.getvalue()


# ── Product History Report ────────────────────────────────────────────────────

def generate_product_history_report(product):
    buffer = io.BytesIO()
    doc = _make_doc(buffer, f'Product History — {product.name}')
    styles = _build_styles()
    story = []

    story.append(Paragraph(f'Product History — {product.name}', styles['title']))
    story.append(Paragraph(
        f'Category: {product.category.name if product.category else "—"}  |  '
        f'Unit: {product.unit.symbol if product.unit else "—"}',
        styles['subtitle']
    ))
    story.append(Spacer(1, 4 * mm))

    # Info block
    info_rows = [
        ['Current Stock', f'{product.current_quantity} {product.unit.symbol if product.unit else ""}'],
        ['Total Purchased', f'{product.total_purchased} {product.unit.symbol if product.unit else ""}'],
        ['Total Used', f'{product.total_used} {product.unit.symbol if product.unit else ""}'],
        ['Total Purchase Cost', f'₹{product.total_purchase_cost:,.2f}'],
        ['Average Purchase Price', f'₹{product.average_purchase_price:,.2f} / {product.unit.symbol if product.unit else "unit"}'],
        ['Minimum Stock Level', f'{product.minimum_stock}'],
        ['Status', product.status.replace("_", " ").upper()],
    ]
    info_table = Table(info_rows, colWidths=[5 * cm, 8 * cm])
    info_table.setStyle(TableStyle([
        ('FONTNAME', (0, 0), (0, -1), 'Helvetica-Bold'),
        ('FONTNAME', (1, 0), (1, -1), 'Helvetica'),
        ('FONTSIZE', (0, 0), (-1, -1), 9),
        ('TEXTCOLOR', (0, 0), (0, -1), GREEN_DARK),
        ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
        ('GRID', (0, 0), (-1, -1), 0.3, MID_GRAY),
    ]))
    story.append(info_table)
    story.append(Spacer(1, 6 * mm))

    # Stock movements
    story.append(Paragraph('Stock Movement History', styles['section']))
    headers = ['Date', 'Type', 'Quantity', 'Balance After', 'Remarks']
    rows = [headers]
    for m in sorted(product.stock_movements, key=lambda x: x.movement_date):
        qty_str = (f'+{m.quantity}' if m.movement_type == 'purchase'
                   else str(m.quantity))
        rows.append([
            m.movement_date.strftime('%d/%m/%Y'),
            m.movement_type.capitalize(),
            qty_str,
            str(m.balance_after),
            (m.remarks or '')[:40],
        ])
    col_widths = [2.2 * cm, 2.5 * cm, 2.5 * cm, 2.8 * cm, 7 * cm]
    table = Table(rows, colWidths=col_widths, repeatRows=1)
    table.setStyle(_table_style())
    story.append(table)

    doc.build(story, onFirstPage=_header_footer, onLaterPages=_header_footer)
    buffer.seek(0)
    return buffer.getvalue()
