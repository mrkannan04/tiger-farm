import io
import os
from datetime import date, datetime
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm, mm
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    HRFlowable, KeepTogether,
)
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT
from reportlab.pdfgen import canvas


# ── Color Palette Matching Tiger Farm Agriculture Theme ─────────────────────
GREEN_DARK = colors.HexColor('#1B4332')       # Deep Forest Green (Primary)
GREEN_MID = colors.HexColor('#2D6A4F')        # Medium Emerald
GREEN_ACCENT = colors.HexColor('#52B788')     # Light Green Accent
GREEN_LIGHT = colors.HexColor('#D8F3DC')      # Mint highlight
GOLD = colors.HexColor('#D4A017')             # Tiger Farm Gold Accent
AMBER_BG = colors.HexColor('#FEFCBF')         # Soft amber background
AMBER_TEXT = colors.HexColor('#744210')       # Amber alert text
RED_PRIMARY = colors.HexColor('#C53030')      # Crimson Alert
RED_LIGHT = colors.HexColor('#FED7D7')        # Soft red background
LIGHT_GRAY = colors.HexColor('#F8FAFC')       # Clean table row alternate
BORDER_GRAY = colors.HexColor('#E2E8F0')      # Table grid line
TEXT_DARK = colors.HexColor('#1A202C')        # Primary body text
TEXT_MUTED = colors.HexColor('#4A5568')       # Subdued caption text


# ── Dynamic Two-Pass Canvas for Accurate Page X of Y & Header/Footer ─────────
class NumberedCanvas(canvas.Canvas):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._saved_page_states = []

    def showPage(self):
        self._saved_page_states.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        num_pages = len(self._saved_page_states)
        for state in self._saved_page_states:
            self.__dict__.update(state)
            self.draw_page_decorations(num_pages)
            super().showPage()
        super().save()

    def draw_page_decorations(self, page_count):
        self.saveState()
        w, h = A4

        # Top Header Banner
        self.setFillColor(GREEN_DARK)
        self.rect(0, h - 25 * mm, w, 25 * mm, fill=1, stroke=0)

        # Gold Accent Line
        self.setFillColor(GOLD)
        self.rect(0, h - 26 * mm, w, 1 * mm, fill=1, stroke=0)

        # Brand Title
        self.setFillColor(colors.white)
        self.setFont('Helvetica-Bold', 14)
        self.drawString(12 * mm, h - 12 * mm, 'TIGER FARM')
        self.setFont('Helvetica', 8)
        self.setFillColor(GREEN_LIGHT)
        self.drawString(12 * mm, h - 18 * mm, 'Smart Agricultural Management & Inventory System')

        # Header Meta Information
        now_str = datetime.now().strftime("%d %b %Y, %I:%M %p")
        self.setFillColor(colors.white)
        self.setFont('Helvetica', 7.5)
        self.drawRightString(w - 12 * mm, h - 12 * mm, f'Generated: {now_str}')
        self.setFillColor(GREEN_LIGHT)
        self.setFont('Helvetica-Bold', 8)
        self.drawRightString(w - 12 * mm, h - 18 * mm, f'Page {self._pageNumber} of {page_count}')

        # Bottom Footer Bar
        self.setFillColor(LIGHT_GRAY)
        self.rect(0, 0, w, 11 * mm, fill=1, stroke=0)
        self.setFillColor(GREEN_MID)
        self.rect(0, 11 * mm, w, 0.3 * mm, fill=1, stroke=0)

        self.setFillColor(TEXT_MUTED)
        self.setFont('Helvetica', 7)
        self.drawString(12 * mm, 4 * mm, 'Tiger Farm — Official Operational & Financial Audit Document')
        self.drawRightString(w - 12 * mm, 4 * mm, f'Page {self._pageNumber} of {page_count}')

        self.restoreState()


# ── Paragraph & Document Styles ──────────────────────────────────────────────
def _build_styles():
    styles = getSampleStyleSheet()
    return {
        'doc_title': ParagraphStyle(
            'TFDocTitle', fontName='Helvetica-Bold', fontSize=16,
            textColor=GREEN_DARK, leading=20, spaceAfter=2,
        ),
        'doc_subtitle': ParagraphStyle(
            'TFDocSub', fontName='Helvetica', fontSize=8.5,
            textColor=TEXT_MUTED, leading=12, spaceAfter=8,
        ),
        'section_title': ParagraphStyle(
            'TFSectionTitle', fontName='Helvetica-Bold', fontSize=10.5,
            textColor=GREEN_DARK, leading=14, spaceBefore=8, spaceAfter=4,
        ),
        'kpi_num': ParagraphStyle(
            'TFKpiNum', fontName='Helvetica-Bold', fontSize=13,
            textColor=GREEN_DARK, leading=16, alignment=TA_CENTER,
        ),
        'kpi_label': ParagraphStyle(
            'TFKpiLabel', fontName='Helvetica', fontSize=7,
            textColor=TEXT_MUTED, leading=9, alignment=TA_CENTER,
        ),
        'th': ParagraphStyle(
            'TFTH', fontName='Helvetica-Bold', fontSize=7.5,
            textColor=colors.white, leading=9.5, alignment=TA_LEFT,
        ),
        'th_center': ParagraphStyle(
            'TFTHCenter', fontName='Helvetica-Bold', fontSize=7.5,
            textColor=colors.white, leading=9.5, alignment=TA_CENTER,
        ),
        'th_right': ParagraphStyle(
            'TFTHRight', fontName='Helvetica-Bold', fontSize=7.5,
            textColor=colors.white, leading=9.5, alignment=TA_RIGHT,
        ),
        'td': ParagraphStyle(
            'TFTD', fontName='Helvetica', fontSize=7.5,
            textColor=TEXT_DARK, leading=9.5, alignment=TA_LEFT,
        ),
        'td_bold': ParagraphStyle(
            'TFTDBold', fontName='Helvetica-Bold', fontSize=7.5,
            textColor=TEXT_DARK, leading=9.5, alignment=TA_LEFT,
        ),
        'td_center': ParagraphStyle(
            'TFTDCenter', fontName='Helvetica', fontSize=7.5,
            textColor=TEXT_DARK, leading=9.5, alignment=TA_CENTER,
        ),
        'td_right': ParagraphStyle(
            'TFTDRight', fontName='Helvetica', fontSize=7.5,
            textColor=TEXT_DARK, leading=9.5, alignment=TA_RIGHT,
        ),
        'td_muted': ParagraphStyle(
            'TFTDMuted', fontName='Helvetica', fontSize=7,
            textColor=TEXT_MUTED, leading=8.5, alignment=TA_LEFT,
        ),
        'badge_green': ParagraphStyle(
            'TFBadgeGreen', fontName='Helvetica-Bold', fontSize=6.5,
            textColor=GREEN_DARK, alignment=TA_CENTER,
        ),
        'badge_amber': ParagraphStyle(
            'TFBadgeAmber', fontName='Helvetica-Bold', fontSize=6.5,
            textColor=AMBER_TEXT, alignment=TA_CENTER,
        ),
        'badge_red': ParagraphStyle(
            'TFBadgeRed', fontName='Helvetica-Bold', fontSize=6.5,
            textColor=RED_PRIMARY, alignment=TA_CENTER,
        ),
        'empty_msg': ParagraphStyle(
            'TFEmpty', fontName='Helvetica-Oblique', fontSize=8,
            textColor=TEXT_MUTED, alignment=TA_CENTER, leading=12,
        ),
    }


def _make_doc(buffer, title):
    return SimpleDocTemplate(
        buffer,
        pagesize=A4,
        topMargin=28 * mm,
        bottomMargin=14 * mm,
        leftMargin=12 * mm,
        rightMargin=12 * mm,
        title=title,
    )


def _table_style(has_total=False):
    style = [
        ('BACKGROUND', (0, 0), (-1, 0), GREEN_DARK),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
        ('LEFTPADDING', (0, 0), (-1, -1), 4),
        ('RIGHTPADDING', (0, 0), (-1, -1), 4),
        ('ROWBACKGROUNDS', (0, 1), (-1, (-2 if has_total else -1)), [colors.white, LIGHT_GRAY]),
        ('GRID', (0, 0), (-1, (-2 if has_total else -1)), 0.3, BORDER_GRAY),
    ]
    if has_total:
        style += [
            ('BACKGROUND', (0, -1), (-1, -1), GREEN_LIGHT),
            ('TOPPADDING', (0, -1), (-1, -1), 4),
            ('BOTTOMPADDING', (0, -1), (-1, -1), 4),
            ('LINEABOVE', (0, -1), (-1, -1), 1, GREEN_MID),
            ('LINEBELOW', (0, -1), (-1, -1), 1, GREEN_DARK),
            ('GRID', (0, -1), (-1, -1), 0.3, BORDER_GRAY),
        ]
    return TableStyle(style)


def _build_kpi_cards(kpi_data, styles, width=186 * mm):
    """Render a structured horizontal row of 3 or 4 metric cards."""
    col_w = width / len(kpi_data)
    cols = []
    for val, label in kpi_data:
        cols.append([
            Paragraph(str(val), styles['kpi_num']),
            Spacer(1, 1 * mm),
            Paragraph(str(label).upper(), styles['kpi_label']),
        ])
    t = Table([cols], colWidths=[col_w] * len(kpi_data))
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), LIGHT_GRAY),
        ('BOX', (0, 0), (-1, -1), 0.6, BORDER_GRAY),
        ('INNERGRID', (0, 0), (-1, -1), 0.5, BORDER_GRAY),
        ('TOPPADDING', (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
    ]))
    return t


# ── 1. Complete Product List & Inventory Report ──────────────────────────────
def generate_stock_report(products, category_id=None, status_filter=None, search=None):
    """Generate a comprehensive, beautifully sectioned A4 Product List PDF report."""
    buffer = io.BytesIO()
    doc = _make_doc(buffer, 'Complete Farm Inventory & Product List — Tiger Farm')
    styles = _build_styles()
    story = []

    # Title & Subtitle
    story.append(Paragraph('Complete Farm Inventory & Product Master Report', styles['doc_title']))
    
    meta_parts = [f'As of {date.today().strftime("%d %B %Y")}']
    if search:
        meta_parts.append(f'Search: "{search}"')
    if category_id:
        cat_obj = next((p.category.name for p in products if p.category and str(p.category.id) == str(category_id)), None)
        if cat_obj:
            meta_parts.append(f'Category: {cat_obj}')
    if status_filter and status_filter != 'all':
        meta_parts.append(f'Status: {status_filter.replace("_", " ").title()}')
    
    story.append(Paragraph(' • '.join(meta_parts), styles['doc_subtitle']))

    # Executive KPIs
    total_prods = len(products)
    in_stock = sum(1 for p in products if p.status == 'in_stock')
    low_stock = sum(1 for p in products if p.status == 'low_stock')
    out_stock = sum(1 for p in products if p.status == 'out_of_stock')
    total_val = sum(p.stock_valuation for p in products)

    kpis = [
        (f"{total_prods}", "Total Products"),
        (f"₹ {total_val:,.2f}", "Total Inventory Value"),
        (f"{in_stock}", "In Stock (Healthy)"),
        (f"{low_stock + out_stock}", "Stock Alerts (Low/Out)"),
    ]
    story.append(_build_kpi_cards(kpis, styles))
    story.append(Spacer(1, 5 * mm))

    # Section 1: Detailed Product Inventory Table
    story.append(Paragraph('📋 Detailed Product Inventory Records', styles['section_title']))

    headers = [
        Paragraph('#', styles['th_center']),
        Paragraph('Product Name', styles['th']),
        Paragraph('Category', styles['th']),
        Paragraph('Default Packaging', styles['th']),
        Paragraph('Stock Breakdown', styles['th']),
        Paragraph('Total Stock', styles['th_right']),
        Paragraph('Min Level', styles['th_right']),
        Paragraph('Est. Value (₹)', styles['th_right']),
        Paragraph('Status', styles['th_center']),
    ]
    rows = [headers]

    for idx, p in enumerate(products, start=1):
        # Format packaging & stock
        pkg_desc = p.default_bag_summary or '—'
        breakdown = p.formatted_stock_breakdown or f"{p.current_quantity:g} {p.unit.symbol if p.unit else ''}"
        base_stock = f"{p.current_quantity:g} {p.unit.symbol if p.unit else ''}"
        min_lvl = f"{p.minimum_stock:g} {p.unit.symbol if p.unit else ''}"
        val_str = f"₹ {p.stock_valuation:,.2f}"

        # Status Badge Style
        if p.status == 'in_stock':
            status_p = Paragraph('IN STOCK', styles['badge_green'])
        elif p.status == 'low_stock':
            status_p = Paragraph('LOW STOCK', styles['badge_amber'])
        else:
            status_p = Paragraph('OUT OF STOCK', styles['badge_red'])

        rows.append([
            Paragraph(str(idx), styles['td_center']),
            Paragraph(f"<b>{p.name}</b>", styles['td']),
            Paragraph(p.category.name if p.category else '—', styles['td']),
            Paragraph(pkg_desc, styles['td_muted']),
            Paragraph(breakdown, styles['td']),
            Paragraph(base_stock, styles['td_right']),
            Paragraph(min_lvl, styles['td_right']),
            Paragraph(val_str, styles['td_right']),
            status_p,
        ])

    # Grand Total Row
    rows.append([
        Paragraph('', styles['td']),
        Paragraph('<b>GRAND TOTAL VALUATION</b>', styles['td_bold']),
        Paragraph(f'<b>{total_prods} Products</b>', styles['td_bold']),
        Paragraph('', styles['td']),
        Paragraph('', styles['td']),
        Paragraph('', styles['td']),
        Paragraph('', styles['td']),
        Paragraph(f'<b>₹ {total_val:,.2f}</b>', styles['td_right']),
        Paragraph('', styles['td']),
    ])

    col_widths = [8 * mm, 44 * mm, 24 * mm, 24 * mm, 26 * mm, 18 * mm, 14 * mm, 16 * mm, 12 * mm]
    t_stock = Table(rows, colWidths=col_widths, repeatRows=1)
    t_stock.setStyle(_table_style(has_total=True))
    story.append(t_stock)
    story.append(Spacer(1, 6 * mm))

    # Section 2: Reorder & Critical Stock Alert Section
    critical_items = [p for p in products if p.status in ('low_stock', 'out_of_stock')]
    alert_story = []
    alert_story.append(Paragraph('⚠️ Critical Stock & Reorder Requirements', styles['section_title']))

    if critical_items:
        alert_headers = [
            Paragraph('#', styles['th_center']),
            Paragraph('Alert Product', styles['th']),
            Paragraph('Category', styles['th']),
            Paragraph('Current Stock', styles['th_right']),
            Paragraph('Threshold Level', styles['th_right']),
            Paragraph('Shortage Deficit', styles['th_right']),
            Paragraph('Suggested Reorder', styles['th_right']),
        ]
        alert_rows = [alert_headers]
        for c_idx, p in enumerate(critical_items, start=1):
            unit_sym = p.unit.symbol if p.unit else ''
            deficit = max(0.0, p.minimum_stock - p.current_quantity)
            reorder_qty = max(deficit, p.default_package_size or deficit or 1.0)
            reorder_text = f"{reorder_qty:g} {unit_sym}"
            if p.default_package_size and p.default_packaging_type:
                bags_needed = max(1, round(deficit / p.default_package_size))
                reorder_text = f"{bags_needed} {p.default_packaging_type}(s) ({reorder_qty:g} {unit_sym})"

            alert_rows.append([
                Paragraph(str(c_idx), styles['td_center']),
                Paragraph(f"<b>{p.name}</b>", styles['td']),
                Paragraph(p.category.name if p.category else '—', styles['td']),
                Paragraph(f"{p.current_quantity:g} {unit_sym}", styles['td_right']),
                Paragraph(f"{p.minimum_stock:g} {unit_sym}", styles['td_right']),
                Paragraph(f"<b>-{deficit:g} {unit_sym}</b>", styles['td_right']),
                Paragraph(f"<b>{reorder_text}</b>", styles['td_right']),
            ])
        t_alert = Table(alert_rows, colWidths=[10 * mm, 46 * mm, 28 * mm, 24 * mm, 24 * mm, 24 * mm, 30 * mm], repeatRows=1)
        t_alert.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), RED_PRIMARY),
            ('TOPPADDING', (0, 0), (-1, -1), 3),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
            ('LEFTPADDING', (0, 0), (-1, -1), 4),
            ('RIGHTPADDING', (0, 0), (-1, -1), 4),
            ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, RED_LIGHT]),
            ('GRID', (0, 0), (-1, -1), 0.3, BORDER_GRAY),
        ]))
        alert_story.append(t_alert)
    else:
        alert_story.append(Paragraph('✅ All products are currently stocked at or above healthy minimum inventory thresholds.', styles['empty_msg']))

    story.append(KeepTogether(alert_story))
    story.append(Spacer(1, 6 * mm))

    # Section 3: Category Inventory Valuation Breakdown
    cat_summary = {}
    for p in products:
        cname = p.category.name if p.category else 'Uncategorized'
        if cname not in cat_summary:
            cat_summary[cname] = {'count': 0, 'valuation': 0.0}
        cat_summary[cname]['count'] += 1
        cat_summary[cname]['valuation'] += p.stock_valuation

    cat_story = []
    cat_story.append(Paragraph('🏷️ Category Inventory Distribution', styles['section_title']))
    cat_headers = [
        Paragraph('Category Name', styles['th']),
        Paragraph('Products Count', styles['th_center']),
        Paragraph('Inventory Valuation (₹)', styles['th_right']),
        Paragraph('% Share of Total Value', styles['th_right']),
    ]
    cat_rows = [cat_headers]
    for cname, cinfo in sorted(cat_summary.items(), key=lambda x: x[1]['valuation'], reverse=True):
        share = (cinfo['valuation'] / total_val * 100) if total_val > 0 else 0
        cat_rows.append([
            Paragraph(f"<b>{cname}</b>", styles['td']),
            Paragraph(str(cinfo['count']), styles['td_center']),
            Paragraph(f"₹ {cinfo['valuation']:,.2f}", styles['td_right']),
            Paragraph(f"{share:.1f}%", styles['td_right']),
        ])
    t_cat = Table(cat_rows, colWidths=[70 * mm, 36 * mm, 45 * mm, 35 * mm], repeatRows=1)
    t_cat.setStyle(_table_style())
    cat_story.append(t_cat)
    story.append(KeepTogether(cat_story))

    doc.build(story, canvasmaker=NumberedCanvas)
    buffer.seek(0)
    return buffer.getvalue()


# ── 2. Purchases & Cost Audit Report ─────────────────────────────────────────
def generate_purchase_report(purchases, start_date=None, end_date=None):
    """Generate a comprehensive itemized and sectioned Purchases PDF report."""
    buffer = io.BytesIO()
    doc = _make_doc(buffer, 'Purchase History & Invoices Report — Tiger Farm')
    styles = _build_styles()
    story = []

    # Title & Subtitle
    story.append(Paragraph('Purchase History & Supplier Invoices Report', styles['doc_title']))
    date_str = 'All Recorded Historical Purchases'
    if start_date and end_date:
        date_str = f'From {start_date.strftime("%d %b %Y")} to {end_date.strftime("%d %b %Y")}'
    elif start_date:
        date_str = f'From {start_date.strftime("%d %b %Y")} onwards'
    elif end_date:
        date_str = f'Up to {end_date.strftime("%d %b %Y")}'
    story.append(Paragraph(date_str, styles['doc_subtitle']))

    # Executive KPIs
    total_purchases = len(purchases)
    total_cost = sum(p.total_price or 0.0 for p in purchases)
    suppliers = set(p.supplier_name for p in purchases if p.supplier_name)
    total_bags = sum(p.package_count or 0.0 for p in purchases if p.package_count)

    kpis = [
        (f"{total_purchases}", "Purchase Invoices"),
        (f"₹ {total_cost:,.2f}", "Total Expenditure"),
        (f"{total_bags:g}", "Total Packages / Bags"),
        (f"{len(suppliers)}", "Active Suppliers"),
    ]
    story.append(_build_kpi_cards(kpis, styles))
    story.append(Spacer(1, 5 * mm))

    # Section 1: Itemized Purchases Table
    story.append(Paragraph('🛒 Itemized Purchase Transactions Log', styles['section_title']))

    headers = [
        Paragraph('Date', styles['th_center']),
        Paragraph('Invoice #', styles['th']),
        Paragraph('Product Name', styles['th']),
        Paragraph('Category', styles['th']),
        Paragraph('Package Details', styles['th']),
        Paragraph('Total Qty', styles['th_right']),
        Paragraph('Rate (₹)', styles['th_right']),
        Paragraph('Total Cost (₹)', styles['th_right']),
        Paragraph('Supplier', styles['th']),
    ]
    rows = [headers]

    for p in purchases:
        p_date = p.purchase_date.strftime('%d/%m/%Y') if p.purchase_date else '—'
        inv_no = p.invoice_number or '—'
        prod_name = p.product.name if p.product else '—'
        cat_name = p.product.category.name if (p.product and p.product.category) else '—'
        
        # Package details
        pkg_info = p.package_summary
        if not pkg_info and p.package_count:
            pkg_info = f"{p.package_count:g} {p.packaging_type or 'Bag'}(s)"
        pkg_info = pkg_info or '—'
        extra_meta = []
        if p.batch_number:
            extra_meta.append(f"Batch: {p.batch_number}")
        if p.expiry_date:
            extra_meta.append(f"Exp: {p.expiry_date.strftime('%d/%m/%y')}")
        if extra_meta:
            pkg_info += f"<br/><font size=6 color='#2D6A4F'>{' | '.join(extra_meta)}</font>"

        unit_sym = p.package_unit or (p.unit.symbol if p.unit else '')
        tot_qty = f"{p.quantity:g} {unit_sym}" if p.quantity else '—'
        rate_str = f"₹ {p.unit_price:,.2f}" if p.unit_price else '—'
        cost_str = f"₹ {p.total_price:,.2f}" if p.total_price else '—'
        if p.payment_status and p.payment_status != 'Paid':
            cost_str += f"<br/><font size=6 color='#C1292E'><b>[{p.payment_status.upper()}]</b></font>"
        supp = (p.supplier_name or '—')[:20]

        rows.append([
            Paragraph(p_date, styles['td_center']),
            Paragraph(inv_no, styles['td_muted']),
            Paragraph(f"<b>{prod_name}</b>", styles['td']),
            Paragraph(cat_name, styles['td_muted']),
            Paragraph(pkg_info, styles['td']),
            Paragraph(tot_qty, styles['td_right']),
            Paragraph(rate_str, styles['td_right']),
            Paragraph(f"<b>{cost_str}</b>", styles['td_right']),
            Paragraph(supp, styles['td']),
        ])

    # Grand Total Row
    rows.append([
        Paragraph('', styles['td']),
        Paragraph('<b>TOTAL</b>', styles['td_bold']),
        Paragraph(f'<b>{total_purchases} Records</b>', styles['td_bold']),
        Paragraph('', styles['td']),
        Paragraph(f'<b>{total_bags:g} Bags/Units</b>', styles['td_bold']),
        Paragraph('', styles['td']),
        Paragraph('', styles['td']),
        Paragraph(f'<b>₹ {total_cost:,.2f}</b>', styles['td_right']),
        Paragraph('', styles['td']),
    ])

    col_widths = [18 * mm, 18 * mm, 36 * mm, 22 * mm, 24 * mm, 16 * mm, 16 * mm, 18 * mm, 18 * mm]
    t_purch = Table(rows, colWidths=col_widths, repeatRows=1)
    t_purch.setStyle(_table_style(has_total=True))
    story.append(t_purch)
    story.append(Spacer(1, 6 * mm))

    # Section 2: Supplier Spend Distribution Breakdown
    supp_summary = {}
    for p in purchases:
        sname = p.supplier_name or 'Direct / Local Market'
        if sname not in supp_summary:
            supp_summary[sname] = {'count': 0, 'amount': 0.0}
        supp_summary[sname]['count'] += 1
        supp_summary[sname]['amount'] += (p.total_price or 0.0)

    if supp_summary:
        supp_story = []
        supp_story.append(Paragraph('🏢 Supplier Spend Distribution', styles['section_title']))
        supp_headers = [
            Paragraph('Vendor / Supplier Name', styles['th']),
            Paragraph('Invoices Count', styles['th_center']),
            Paragraph('Total Invoiced Amount (₹)', styles['th_right']),
            Paragraph('% Share of Total Spend', styles['th_right']),
        ]
        supp_rows = [supp_headers]
        for sname, sinfo in sorted(supp_summary.items(), key=lambda x: x[1]['amount'], reverse=True):
            share = (sinfo['amount'] / total_cost * 100) if total_cost > 0 else 0
            supp_rows.append([
                Paragraph(f"<b>{sname}</b>", styles['td']),
                Paragraph(str(sinfo['count']), styles['td_center']),
                Paragraph(f"₹ {sinfo['amount']:,.2f}", styles['td_right']),
                Paragraph(f"{share:.1f}%", styles['td_right']),
            ])
        t_supp = Table(supp_rows, colWidths=[70 * mm, 36 * mm, 45 * mm, 35 * mm], repeatRows=1)
        t_supp.setStyle(_table_style())
        supp_story.append(t_supp)
        story.append(KeepTogether(supp_story))

    doc.build(story, canvasmaker=NumberedCanvas)
    buffer.seek(0)
    return buffer.getvalue()


# ── 3. Usage & Field Consumption Report ──────────────────────────────────────
def generate_usage_report(usages, start_date=None, end_date=None):
    """Generate a comprehensive itemized and sectioned Usage PDF report."""
    buffer = io.BytesIO()
    doc = _make_doc(buffer, 'Product Usage & Field Application Report — Tiger Farm')
    styles = _build_styles()
    story = []

    # Title & Subtitle
    story.append(Paragraph('Product Usage & Field Application Audit Report', styles['doc_title']))
    date_str = 'All Recorded Historical Applications'
    if start_date and end_date:
        date_str = f'From {start_date.strftime("%d %b %Y")} to {end_date.strftime("%d %b %Y")}'
    elif start_date:
        date_str = f'From {start_date.strftime("%d %b %Y")} onwards'
    elif end_date:
        date_str = f'Up to {end_date.strftime("%d %b %Y")}'
    story.append(Paragraph(date_str, styles['doc_subtitle']))

    # Executive KPIs
    total_logs = len(usages)
    fields_treated = set(u.field_location for u in usages if u.field_location)
    solid_applied = sum(u.quantity or 0.0 for u in usages if not (u.package_unit or (u.unit.symbol if u.unit else '')).lower().startswith('l'))
    liquid_applied = sum(u.quantity or 0.0 for u in usages if (u.package_unit or (u.unit.symbol if u.unit else '')).lower().startswith('l'))

    kpis = [
        (f"{total_logs}", "Usage Records"),
        (f"{solid_applied:,.1f} kg", "Weight Inputs Applied"),
        (f"{liquid_applied:,.1f} L", "Liquid Inputs Applied"),
        (f"{len(fields_treated)}", "Treated Farm Plots"),
    ]
    story.append(_build_kpi_cards(kpis, styles))
    story.append(Spacer(1, 5 * mm))

    # Section 1: Itemized Usage Records Table
    story.append(Paragraph('🌾 Itemized Application & Consumption Records', styles['section_title']))

    headers = [
        Paragraph('Date', styles['th_center']),
        Paragraph('Product Name', styles['th']),
        Paragraph('Category', styles['th']),
        Paragraph('Packaging Applied', styles['th']),
        Paragraph('Total Qty', styles['th_right']),
        Paragraph('Field / Plot Location', styles['th']),
        Paragraph('Application Reason & Purpose', styles['th']),
    ]
    rows = [headers]

    for u in usages:
        u_date = u.usage_date.strftime('%d/%m/%Y') if u.usage_date else '—'
        p_name = u.product.name if u.product else '—'
        cat_name = u.product.category.name if (u.product and u.product.category) else '—'
        pkg_desc = u.package_summary
        if not pkg_desc and u.package_count:
            pkg_desc = f"{u.package_count:g} {u.packaging_type or 'Bag'}(s)"
        pkg_desc = pkg_desc or '—'

        u_sym = u.package_unit or (u.unit.symbol if u.unit else '')
        qty_str = f"{u.quantity:g} {u_sym}" if u.quantity else '—'
        fld = u.field_location or 'General Farm'
        if getattr(u, 'crop_season', None):
            fld += f"<br/><font size=6 color='#2D6A4F'><b>Season:</b> {u.crop_season}</font>"
        reason = u.reason or u.remarks or 'Regular Application'

        rows.append([
            Paragraph(u_date, styles['td_center']),
            Paragraph(f"<b>{p_name}</b>", styles['td']),
            Paragraph(cat_name, styles['td_muted']),
            Paragraph(pkg_desc, styles['td']),
            Paragraph(f"<b>{qty_str}</b>", styles['td_right']),
            Paragraph(fld, styles['td']),
            Paragraph(reason, styles['td_muted']),
        ])

    col_widths = [18 * mm, 36 * mm, 22 * mm, 24 * mm, 18 * mm, 28 * mm, 40 * mm]
    t_usage = Table(rows, colWidths=col_widths, repeatRows=1)
    t_usage.setStyle(_table_style())
    story.append(t_usage)
    story.append(Spacer(1, 6 * mm))

    # Section 2: Field Plot Application Summary
    field_summary = {}
    for u in usages:
        fname = u.field_location or 'General Farm / Unspecified'
        if fname not in field_summary:
            field_summary[fname] = {'events': 0, 'products': set()}
        field_summary[fname]['events'] += 1
        if u.product:
            field_summary[fname]['products'].add(u.product.name)

    if field_summary:
        fld_story = []
        fld_story.append(Paragraph('📍 Farm Plot Application Distribution', styles['section_title']))
        fld_headers = [
            Paragraph('Farm Plot / Field Location', styles['th']),
            Paragraph('Applications Count', styles['th_center']),
            Paragraph('Distinct Products Applied', styles['th']),
        ]
        fld_rows = [fld_headers]
        for fname, finfo in sorted(field_summary.items(), key=lambda x: x[1]['events'], reverse=True):
            prod_list = ', '.join(sorted(finfo['products'])) or '—'
            fld_rows.append([
                Paragraph(f"<b>{fname}</b>", styles['td']),
                Paragraph(str(finfo['events']), styles['td_center']),
                Paragraph(prod_list, styles['td_muted']),
            ])
        t_fld = Table(fld_rows, colWidths=[60 * mm, 36 * mm, 90 * mm], repeatRows=1)
        t_fld.setStyle(_table_style())
        fld_story.append(t_fld)
        story.append(KeepTogether(fld_story))

    doc.build(story, canvasmaker=NumberedCanvas)
    buffer.seek(0)
    return buffer.getvalue()


# ── 4. Detailed Single Product History & Audit Ledger ────────────────────────
def generate_product_history_report(product):
    """Generate an in-depth product lifecycle and movement ledger A4 PDF."""
    buffer = io.BytesIO()
    doc = _make_doc(buffer, f'Product History — {product.name}')
    styles = _build_styles()
    story = []

    # Product Title & Metadata
    story.append(Paragraph(f'Product Audit Ledger — {product.name}', styles['doc_title']))
    cat_name = product.category.name if product.category else 'General Category'
    unit_sym = product.unit.symbol if product.unit else 'kg'
    status_str = product.status.replace("_", " ").upper()
    story.append(Paragraph(
        f'Category: <b>{cat_name}</b>  •  Base Unit: <b>{unit_sym}</b>  •  Status: <b>{status_str}</b>',
        styles['doc_subtitle']
    ))

    # Executive KPIs for this product
    kpis = [
        (f"{product.current_quantity:g} {unit_sym}", "Current Stock"),
        (f"{product.total_purchased:g} {unit_sym}", "Total Purchased"),
        (f"{product.total_used:g} {unit_sym}", "Total Consumed"),
        (f"₹ {product.total_purchase_cost:,.2f}", "Total Expenditure"),
    ]
    story.append(_build_kpi_cards(kpis, styles))
    story.append(Spacer(1, 5 * mm))

    # Product Specification Sheet
    story.append(Paragraph('📦 Product Specifications & Inventory Breakdown', styles['section_title']))
    spec_rows = [
        [
            Paragraph('<b>Default Packaging Configuration:</b>', styles['td']),
            Paragraph(product.default_bag_summary or 'Standard Bulk / Loose', styles['td']),
        ],
        [
            Paragraph('<b>Current Packaging Stock Breakdown:</b>', styles['td']),
            Paragraph(product.formatted_stock_breakdown or f"{product.current_quantity:g} {unit_sym}", styles['td']),
        ],
        [
            Paragraph('<b>Weighted Average Unit Cost:</b>', styles['td']),
            Paragraph(f"₹ {product.average_purchase_price:,.2f} per {unit_sym}", styles['td']),
        ],
        [
            Paragraph('<b>Total Stock Valuation:</b>', styles['td']),
            Paragraph(f"₹ {product.stock_valuation:,.2f}", styles['td']),
        ],
        [
            Paragraph('<b>Low Stock Threshold:</b>', styles['td']),
            Paragraph(f"{product.minimum_stock:g} {unit_sym}", styles['td']),
        ],
        [
            Paragraph('<b>Formulation / Agricultural Description:</b>', styles['td']),
            Paragraph(product.description or 'Standard agricultural formulation.', styles['td_muted']),
        ],
    ]
    t_spec = Table(spec_rows, colWidths=[65 * mm, 121 * mm])
    t_spec.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (0, -1), LIGHT_GRAY),
        ('GRID', (0, 0), (-1, -1), 0.3, BORDER_GRAY),
        ('TOPPADDING', (0, 0), (-1, -1), 3.5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3.5),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
        ('RIGHTPADDING', (0, 0), (-1, -1), 6),
    ]))
    story.append(t_spec)
    story.append(Spacer(1, 6 * mm))

    # Section 1: Stock Movements History Audit Trail
    story.append(Paragraph('🔄 Chronological Stock Movement Ledger', styles['section_title']))
    headers = [
        Paragraph('Date', styles['th_center']),
        Paragraph('Transaction Type', styles['th']),
        Paragraph('Quantity', styles['th_right']),
        Paragraph('Packaging Info', styles['th']),
        Paragraph('Balance After', styles['th_right']),
        Paragraph('Reference / Details', styles['th']),
    ]
    move_rows = [headers]

    movements = sorted(product.stock_movements, key=lambda x: (x.movement_date, x.id))
    for m in movements:
        m_date = m.movement_date.strftime('%d/%m/%Y') if m.movement_date else '—'
        m_type = m.movement_type.replace('_', ' ').title()
        prefix = '+' if m.movement_type in ('purchase', 'adjustment_in') else ''
        qty_display = f"{prefix}{m.quantity:g} {unit_sym}"
        pkg_desc = m.package_summary or '—'
        bal = f"{m.balance_after:g} {unit_sym}"
        remarks = m.remarks or '—'

        move_rows.append([
            Paragraph(m_date, styles['td_center']),
            Paragraph(f"<b>{m_type}</b>", styles['td']),
            Paragraph(f"<b>{qty_display}</b>", styles['td_right']),
            Paragraph(pkg_desc, styles['td_muted']),
            Paragraph(f"<b>{bal}</b>", styles['td_right']),
            Paragraph(remarks, styles['td_muted']),
        ])

    if len(move_rows) > 1:
        t_move = Table(move_rows, colWidths=[20 * mm, 30 * mm, 24 * mm, 28 * mm, 24 * mm, 60 * mm], repeatRows=1)
        t_move.setStyle(_table_style())
        story.append(t_move)
    else:
        story.append(Paragraph('No movement ledger entries recorded yet for this product.', styles['empty_msg']))

    doc.build(story, canvasmaker=NumberedCanvas)
    buffer.seek(0)
    return buffer.getvalue()
