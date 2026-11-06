from flask import Blueprint, jsonify, request, session
from ..models import db, Notification, Product
from ..services.stock_service import _check_and_update_notifications, check_expiry_notifications

notifications_bp = Blueprint('notifications', __name__)


def _require_auth():
    if not session.get('user_id'):
        return jsonify({'success': False, 'message': 'Authentication required.', 'error': 'Authentication required.'}), 401
    return None


@notifications_bp.route('/api/notifications', methods=['GET'])
def list_notifications():
    auth_err = _require_auth()
    if auth_err:
        return auth_err

    # Auto-audit all active products so any low-stock condition is immediately detected
    try:
        for p in Product.query.filter_by(is_active=True).all():
            _check_and_update_notifications(p)
        check_expiry_notifications()
        db.session.commit()
    except Exception:
        db.session.rollback()

    unread_only = request.args.get('unread_only', 'false').lower() == 'true'
    page = int(request.args.get('page', 1))
    per_page = int(request.args.get('per_page', 20))

    query = Notification.query
    if unread_only:
        query = query.filter_by(is_read=False)
    query = query.order_by(Notification.created_at.desc())

    total = query.count()
    notifications = query.offset((page - 1) * per_page).limit(per_page).all()
    unread_count = Notification.query.filter_by(is_read=False).count()
    active_alerts = Notification.query.filter_by(is_read=False).filter(
        Notification.type.in_(['low_stock', 'out_of_stock', 'expired', 'expiry_warning'])
    ).all()

    return jsonify({
        'success': True,
        'notifications': [n.to_dict() for n in notifications],
        'data': [n.to_dict() for n in notifications],
        'unread_count': unread_count,
        'urgent_alerts': [n.to_dict() for n in active_alerts],
        'total': total,
        'page': page,
        'pages': max((total + per_page - 1) // per_page, 1),
    })


@notifications_bp.route('/api/notifications/<int:notif_id>/read', methods=['POST', 'PUT'])
def mark_read(notif_id):
    auth_err = _require_auth()
    if auth_err:
        return auth_err
    notif = Notification.query.get_or_404(notif_id)
    try:
        notif.is_read = True
        db.session.commit()
        return jsonify({'success': True, 'message': 'Marked as read.'})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': f'Failed to update notification: {str(e)}', 'error': str(e)}), 500


@notifications_bp.route('/api/notifications/read-all', methods=['POST'])
def mark_all_read():
    auth_err = _require_auth()
    if auth_err:
        return auth_err
    try:
        Notification.query.filter_by(is_read=False).update({'is_read': True})
        db.session.commit()
        return jsonify({'success': True, 'message': 'All notifications marked as read.'})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': f'Failed to mark all as read: {str(e)}', 'error': str(e)}), 500


@notifications_bp.route('/api/notifications/count', methods=['GET'])
def unread_count():
    auth_err = _require_auth()
    if auth_err:
        return auth_err
    try:
        for p in Product.query.filter_by(is_active=True).all():
            _check_and_update_notifications(p)
        check_expiry_notifications()
        db.session.commit()
    except Exception:
        db.session.rollback()

    count = Notification.query.filter_by(is_read=False).count()
    active_alerts = Notification.query.filter_by(is_read=False).filter(
        Notification.type.in_(['low_stock', 'out_of_stock', 'expired', 'expiry_warning'])
    ).all()
    return jsonify({
        'success': True,
        'unread_count': count,
        'urgent_alerts': [n.to_dict() for n in active_alerts],
    })
