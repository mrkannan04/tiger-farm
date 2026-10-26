import os
import shutil
from datetime import datetime, date
from flask import Blueprint, request, jsonify, session, current_app, send_file
from ..models import db, Supplier, Field, Category, Unit

settings_bp = Blueprint('settings', __name__)


def _require_auth():
    if not session.get('user_id'):
        return jsonify({'success': False, 'message': 'Authentication required.', 'error': 'Authentication required.'}), 401
    return None


# ── Suppliers ────────────────────────────────────────────────────────────────

@settings_bp.route('/api/suppliers', methods=['GET'])
def list_suppliers():
    auth_err = _require_auth()
    if auth_err:
        return auth_err
    suppliers = Supplier.query.order_by(Supplier.name).all()
    # Return as standard JSON list directly compatible with JS array methods
    return jsonify([s.to_dict() for s in suppliers])


@settings_bp.route('/api/suppliers', methods=['POST'])
def create_supplier():
    auth_err = _require_auth()
    if auth_err:
        return auth_err
    data = request.get_json() or {}
    name = (data.get('name') or '').strip()
    if not name:
        return jsonify({'success': False, 'message': 'Supplier name is required.', 'error': 'Supplier name is required.'}), 400

    try:
        s = Supplier(
            name=name,
            phone=(data.get('phone') or '').strip() or None,
            email=(data.get('email') or '').strip() or None,
            address=(data.get('address') or '').strip() or None,
        )
        db.session.add(s)
        db.session.commit()
        return jsonify({'success': True, 'id': s.id, 'name': s.name, 'message': f'Supplier "{s.name}" saved.', 'data': s.to_dict()}), 201
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': f'Failed to create supplier: {str(e)}', 'error': str(e)}), 500


@settings_bp.route('/api/suppliers/<int:sid>', methods=['PUT'])
def update_supplier(sid):
    auth_err = _require_auth()
    if auth_err:
        return auth_err
    s = Supplier.query.get_or_404(sid)
    data = request.get_json() or {}
    try:
        if 'name' in data and data['name'].strip():
            s.name = data['name'].strip()
        if 'phone' in data:
            s.phone = (data['phone'] or '').strip() or None
        if 'email' in data:
            s.email = (data['email'] or '').strip() or None
        if 'address' in data:
            s.address = (data['address'] or '').strip() or None
        db.session.commit()
        return jsonify({'success': True, 'message': f'Supplier "{s.name}" updated.', 'data': s.to_dict()})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': f'Update failed: {str(e)}', 'error': str(e)}), 500


@settings_bp.route('/api/suppliers/<int:sid>', methods=['DELETE'])
def delete_supplier(sid):
    auth_err = _require_auth()
    if auth_err:
        return auth_err
    s = Supplier.query.get_or_404(sid)
    try:
        db.session.delete(s)
        db.session.commit()
        return jsonify({'success': True, 'message': 'Supplier deleted successfully.'})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': f'Delete failed: {str(e)}', 'error': str(e)}), 500


# ── Fields / Locations ───────────────────────────────────────────────────────

@settings_bp.route('/api/fields', methods=['GET'])
def list_fields():
    auth_err = _require_auth()
    if auth_err:
        return auth_err
    fields = Field.query.order_by(Field.name).all()
    return jsonify([f.to_dict() for f in fields])


@settings_bp.route('/api/fields', methods=['POST'])
def create_field():
    auth_err = _require_auth()
    if auth_err:
        return auth_err
    data = request.get_json() or {}
    name = (data.get('name') or '').strip()
    if not name:
        return jsonify({'success': False, 'message': 'Field name is required.', 'error': 'Field name is required.'}), 400

    if Field.query.filter(db.func.lower(Field.name) == name.lower()).first():
        return jsonify({'success': False, 'message': f'Field plot "{name}" already exists.', 'error': f'Field plot "{name}" already exists.'}), 409

    try:
        f = Field(name=name, description=(data.get('description') or '').strip() or None)
        db.session.add(f)
        db.session.commit()
        return jsonify({'success': True, 'id': f.id, 'name': f.name, 'message': f'Field "{f.name}" saved.', 'data': f.to_dict()}), 201
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': f'Failed to create field: {str(e)}', 'error': str(e)}), 500


@settings_bp.route('/api/fields/<int:fid>', methods=['DELETE'])
def delete_field(fid):
    auth_err = _require_auth()
    if auth_err:
        return auth_err
    f = Field.query.get_or_404(fid)
    try:
        db.session.delete(f)
        db.session.commit()
        return jsonify({'success': True, 'message': 'Field location deleted successfully.'})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': f'Delete failed: {str(e)}', 'error': str(e)}), 500


# ── Backup / Restore Aliases ─────────────────────────────────────────────────

@settings_bp.route('/api/settings/backup', methods=['GET'])
def backup_db():
    auth_err = _require_auth()
    if auth_err:
        return auth_err
    db_uri = current_app.config['SQLALCHEMY_DATABASE_URI']
    db_path = db_uri.replace('sqlite:///', '')
    if not os.path.exists(db_path):
        return jsonify({'success': False, 'message': 'Database file not found.', 'error': 'Database file not found.'}), 404
    today_str = date.today().strftime('%Y-%m-%d')
    return send_file(db_path, as_attachment=True, download_name=f'TigerFarm_Backup_{today_str}.db', mimetype='application/octet-stream')


@settings_bp.route('/api/settings/restore', methods=['POST'])
def restore_db():
    auth_err = _require_auth()
    if auth_err:
        return auth_err
    if 'file' not in request.files:
        return jsonify({'success': False, 'message': 'No file provided.', 'error': 'No file provided.'}), 400
    file = request.files['file']
    if not file.filename.endswith('.db'):
        return jsonify({'success': False, 'message': 'Only .db files are supported.', 'error': 'Only .db files are supported.'}), 400

    db_uri = current_app.config['SQLALCHEMY_DATABASE_URI']
    db_path = db_uri.replace('sqlite:///', '')

    # Safety auto-backup before restore
    backups_dir = os.path.join(os.path.dirname(db_path), 'backups')
    os.makedirs(backups_dir, exist_ok=True)
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    safety_backup = os.path.join(backups_dir, f'tiger_farm_backup_{timestamp}.db')
    if os.path.exists(db_path):
        shutil.copy2(db_path, safety_backup)

    try:
        file.save(db_path)
        return jsonify({'success': True, 'message': 'Database restored successfully. Please refresh or restart to load the restored dataset.'})
    except Exception as e:
        if os.path.exists(safety_backup):
            shutil.copy2(safety_backup, db_path)
        return jsonify({'success': False, 'message': f'Restore failed: {str(e)}', 'error': str(e)}), 500
