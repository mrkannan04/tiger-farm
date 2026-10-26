from flask import Blueprint, request, jsonify, session
from datetime import datetime
from ..models import db, User, ActivityLog

auth_bp = Blueprint('auth', __name__)


@auth_bp.route('/api/auth/login', methods=['POST'])
def login():
    data = request.get_json() or {}
    username = (data.get('username') or '').strip()
    password = data.get('password', '')

    if not username or not password:
        return jsonify({'success': False, 'message': 'Username and password are required.', 'error': 'Username and password are required.'}), 400

    user = User.query.filter_by(username=username, is_active=True).first()
    if not user or not user.check_password(password):
        return jsonify({'success': False, 'message': 'Incorrect username or password.', 'error': 'Incorrect username or password.'}), 401

    session.permanent = True
    session['user_id'] = user.id
    session['username'] = user.username

    try:
        user.last_login = datetime.utcnow()
        db.session.add(ActivityLog(
            user_id=user.id,
            action=f'{user.username} logged in.',
            entity_type='auth',
        ))
        db.session.commit()
    except Exception as e:
        db.session.rollback()

    return jsonify({
        'success': True,
        'message': 'Login successful.',
        'user': user.to_dict(),
        'data': {'user': user.to_dict()},
    })


@auth_bp.route('/api/auth/logout', methods=['POST'])
def logout():
    """Logout only clears authentication session, never touching any farm inventory data."""
    user_id = session.get('user_id')
    if user_id:
        try:
            db.session.add(ActivityLog(
                user_id=user_id,
                action=f'{session.get("username", "User")} logged out.',
                entity_type='auth',
            ))
            db.session.commit()
        except Exception:
            db.session.rollback()

    session.clear()
    return jsonify({
        'success': True,
        'message': 'Logged out successfully.',
    })


@auth_bp.route('/api/auth/me', methods=['GET'])
def me():
    user_id = session.get('user_id')
    if not user_id:
        return jsonify({'success': False, 'message': 'Not authenticated.', 'error': 'Not authenticated.'}), 401
    user = User.query.get(user_id)
    if not user:
        return jsonify({'success': False, 'message': 'User not found.', 'error': 'User not found.'}), 404
    return jsonify({
        'success': True,
        'user': user.to_dict(),
        'data': user.to_dict(),
    })


@auth_bp.route('/api/auth/change-password', methods=['POST'])
def change_password():
    user_id = session.get('user_id')
    if not user_id:
        return jsonify({'success': False, 'message': 'Not authenticated.', 'error': 'Not authenticated.'}), 401

    data = request.get_json() or {}
    current_pw = data.get('current_password', '')
    new_pw = data.get('new_password', '')

    if len(new_pw) < 6:
        return jsonify({'success': False, 'message': 'New password must be at least 6 characters.', 'error': 'New password must be at least 6 characters.'}), 400

    user = User.query.get(user_id)
    if not user.check_password(current_pw):
        return jsonify({'success': False, 'message': 'Current password is incorrect.', 'error': 'Current password is incorrect.'}), 400

    try:
        user.set_password(new_pw)
        db.session.commit()
        return jsonify({'success': True, 'message': 'Password changed successfully.'})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': f'Failed to change password: {str(e)}', 'error': str(e)}), 500
