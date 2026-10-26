import io
import shutil
import os
from datetime import date, datetime
from flask import (
    Blueprint, jsonify, request, session, current_app,
    send_file, make_response,
)
from ..models import db, Product, Purchase, Usage, ActivityLog
from ..services import pdf_service, csv_service

reports_bp = Blueprint('reports', __name__)


def _require_auth():
    if not session.get('user_id'):
        return jsonify({'success': False, 'message': 'Authentication required.', 'error': 'Authentication required.'}), 401
    return None


# ── PDF Exports ───────────────────────────────────────────────────────────────

@reports_bp.route('/api/reports/stock/pdf')
@reports_bp.route('/api/reports/products/pdf')
def stock_pdf():
    auth_err = _require_auth()
    if auth_err:
        return auth_err
    products = Product.query.filter_by(is_active=True).order_by(Product.name).all()
    pdf_bytes = pdf_service.generate_stock_report(products)
    return _pdf_response(pdf_bytes, 'TigerFarm_Stock_Report.pdf')


@reports_bp.route('/api/reports/purchases/pdf')
def purchases_pdf():
    auth_err = _require_auth()
    if auth_err:
        return auth_err
    from ..utils.validators import parse_date
    start = parse_date(request.args.get('start_date'))
    end = parse_date(request.args.get('end_date'))
    q = Purchase.query.order_by(Purchase.purchase_date.desc())
    if start:
        q = q.filter(Purchase.purchase_date >= start)
    if end:
        q = q.filter(Purchase.purchase_date <= end)
    pdf_bytes = pdf_service.generate_purchase_report(q.all(), start, end)
    return _pdf_response(pdf_bytes, 'TigerFarm_Purchase_Report.pdf')


@reports_bp.route('/api/reports/usage/pdf')
def usage_pdf():
    auth_err = _require_auth()
    if auth_err:
        return auth_err
    from ..utils.validators import parse_date
    start = parse_date(request.args.get('start_date'))
    end = parse_date(request.args.get('end_date'))
    q = Usage.query.order_by(Usage.usage_date.desc())
    if start:
        q = q.filter(Usage.usage_date >= start)
    if end:
        q = q.filter(Usage.usage_date <= end)
    pdf_bytes = pdf_service.generate_usage_report(q.all(), start, end)
    return _pdf_response(pdf_bytes, 'TigerFarm_Usage_Report.pdf')


@reports_bp.route('/api/reports/product/<int:product_id>/pdf')
def product_history_pdf(product_id):
    auth_err = _require_auth()
    if auth_err:
        return auth_err
    product = Product.query.get_or_404(product_id)
    pdf_bytes = pdf_service.generate_product_history_report(product)
    safe_name = product.name.replace(' ', '_').lower()
    return _pdf_response(pdf_bytes, f'TigerFarm_{safe_name}_History.pdf')


def _pdf_response(pdf_bytes, filename):
    response = make_response(pdf_bytes)
    response.headers['Content-Type'] = 'application/pdf'
    response.headers['Content-Disposition'] = f'attachment; filename={filename}'
    return response


# ── CSV Exports ───────────────────────────────────────────────────────────────

@reports_bp.route('/api/export/products')
def export_products():
    _require_auth()
    csv_data = csv_service.export_products_csv()
    return _csv_response(csv_data, 'TigerFarm_Products.csv')


@reports_bp.route('/api/export/purchases')
def export_purchases():
    _require_auth()
    from ..utils.validators import parse_date
    start = parse_date(request.args.get('start_date'))
    end = parse_date(request.args.get('end_date'))
    csv_data = csv_service.export_purchases_csv(start, end)
    return _csv_response(csv_data, 'TigerFarm_Purchases.csv')


@reports_bp.route('/api/export/usage')
def export_usage():
    _require_auth()
    from ..utils.validators import parse_date
    start = parse_date(request.args.get('start_date'))
    end = parse_date(request.args.get('end_date'))
    csv_data = csv_service.export_usage_csv(start, end)
    return _csv_response(csv_data, 'TigerFarm_Usage.csv')


def _csv_response(csv_data, filename):
    response = make_response(csv_data)
    response.headers['Content-Type'] = 'text/csv; charset=utf-8'
    response.headers['Content-Disposition'] = f'attachment; filename={filename}'
    return response


# ── CSV Import ────────────────────────────────────────────────────────────────

@reports_bp.route('/api/import/csv/preview', methods=['POST'])
def csv_preview():
    auth_err = _require_auth()
    if auth_err:
        return auth_err
    if 'file' not in request.files:
        return jsonify({'success': False, 'message': 'No file uploaded.', 'error': 'No file uploaded.'}), 400
    f = request.files['file']
    rows, error = csv_service.parse_csv(f.stream)
    if error:
        return jsonify({'success': False, 'message': error, 'error': error}), 400
    valid, invalid = csv_service.validate_and_preview(rows)
    return jsonify({
        'success': True,
        'total': len(rows),
        'valid_count': len(valid),
        'invalid_count': len(invalid),
        'valid': valid,
        'invalid': invalid,
    })


@reports_bp.route('/api/import/csv', methods=['POST'])
@reports_bp.route('/api/import/products', methods=['POST'])
def csv_import():
    auth_err = _require_auth()
    if auth_err:
        return auth_err
    if 'file' not in request.files:
        return jsonify({'success': False, 'message': 'No file uploaded.', 'error': 'No file uploaded.'}), 400
    f = request.files['file']
    rows, error = csv_service.parse_csv(f.stream)
    if error:
        return jsonify({'success': False, 'message': error, 'error': error}), 400
    valid, invalid = csv_service.validate_and_preview(rows)

    try:
        imported, skipped = csv_service.import_products(valid)
        db.session.add(ActivityLog(
            user_id=session.get('user_id'),
            action=f'Imported {imported} products from CSV.',
            entity_type='import',
        ))
        db.session.commit()
        return jsonify({
            'success': True,
            'message': f'Successfully imported {imported} products into database.',
            'imported': imported,
            'skipped': skipped + invalid,
        })
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': f'Import failed: {str(e)}', 'error': str(e)}), 500


# ── Backup & Restore ──────────────────────────────────────────────────────────

def _get_active_db_path():
    uri = current_app.config['SQLALCHEMY_DATABASE_URI']
    return uri.replace('sqlite:///', '')


@reports_bp.route('/api/backup', methods=['GET'])
def backup():
    auth_err = _require_auth()
    if auth_err:
        return auth_err
    db_path = _get_active_db_path()
    if not os.path.exists(db_path):
        return jsonify({'success': False, 'message': 'Database file not found.', 'error': 'Database file not found.'}), 404
    today_str = date.today().strftime('%Y-%m-%d')
    filename = f'TigerFarm_Backup_{today_str}.db'
    return send_file(db_path, as_attachment=True, download_name=filename, mimetype='application/octet-stream')


@reports_bp.route('/api/restore', methods=['POST'])
def restore():
    auth_err = _require_auth()
    if auth_err:
        return auth_err
    if 'file' not in request.files:
        return jsonify({'success': False, 'message': 'No backup file uploaded.', 'error': 'No backup file uploaded.'}), 400
    f = request.files['file']
    if not f.filename.endswith('.db'):
        return jsonify({'success': False, 'message': 'Invalid backup file. Must be a .db file.', 'error': 'Invalid backup file. Must be a .db file.'}), 400

    db_path = _get_active_db_path()
    backups_dir = os.path.join(os.path.dirname(db_path), 'backups')
    os.makedirs(backups_dir, exist_ok=True)

    # Automatic safety backup before overwriting (Section 37)
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    safety_backup = os.path.join(backups_dir, f'tiger_farm_backup_{timestamp}.db')
    if os.path.exists(db_path):
        shutil.copy2(db_path, safety_backup)

    try:
        f.save(db_path)
        return jsonify({
            'success': True,
            'message': 'Database restored successfully! Please refresh or restart to load the restored dataset.',
            'safety_backup': safety_backup,
        })
    except Exception as e:
        if os.path.exists(safety_backup):
            shutil.copy2(safety_backup, db_path)
        return jsonify({'success': False, 'message': f'Restore failed: {str(e)}', 'error': str(e)}), 500


@reports_bp.route('/api/activity', methods=['GET'])
def activity_log():
    _require_auth()
    page = int(request.args.get('page', 1))
    per_page = int(request.args.get('per_page', 30))
    total = ActivityLog.query.count()
    logs = (ActivityLog.query
            .order_by(ActivityLog.created_at.desc())
            .offset((page - 1) * per_page).limit(per_page).all())
    return jsonify({
        'success': True,
        'logs': [l.to_dict() for l in logs],
        'total': total,
        'page': page,
        'pages': max((total + per_page - 1) // per_page, 1),
    })
