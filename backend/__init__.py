"""Tiger Farm — Flask Application Factory."""
import os
from flask import Flask, send_from_directory
from .config import config
from .models import db
from .database import init_db


def create_app(config_name='default'):
    """Create and configure the Flask application."""
    frontend_folder = os.path.join(
        os.path.dirname(__file__), '..', 'frontend'
    )
    app = Flask(
        __name__,
        static_folder=os.path.abspath(frontend_folder),
        static_url_path='',
    )

    app.config.from_object(config[config_name])
    os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)

    db.init_app(app)

    from .routes.auth import auth_bp
    from .routes.products import products_bp
    from .routes.purchases import purchases_bp
    from .routes.usage import usage_bp
    from .routes.dashboard import dashboard_bp
    from .routes.analytics import analytics_bp
    from .routes.notifications import notifications_bp
    from .routes.reports import reports_bp
    from .routes.settings import settings_bp

    for bp in (auth_bp, products_bp, purchases_bp, usage_bp,
               dashboard_bp, analytics_bp, notifications_bp, reports_bp, settings_bp):
        app.register_blueprint(bp)

    @app.route('/')
    def index():
        return send_from_directory(app.static_folder, 'index.html')

    @app.route('/app')
    @app.route('/app/')
    def app_shell():
        return send_from_directory(app.static_folder, 'app.html')

    init_db(app)
    return app
