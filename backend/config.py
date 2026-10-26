import os
from dotenv import load_dotenv

load_dotenv()

BASE_DIR = os.path.abspath(os.path.dirname(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(BASE_DIR, '..'))

# On Vercel / serverless, filesystem is read-only except /tmp
DATABASE_DIR = os.path.join(PROJECT_ROOT, 'database')
try:
    os.makedirs(DATABASE_DIR, exist_ok=True)
except OSError:
    DATABASE_DIR = '/tmp'

# Default permanent database file
DEFAULT_DB_PATH = os.path.join(DATABASE_DIR, 'tiger_farm.db').replace('\\', '/')

# Safety fallback: If instance/tiger_farm.db exists but database/tiger_farm.db is empty/missing, copy it
INSTANCE_DB = os.path.join(PROJECT_ROOT, 'instance', 'tiger_farm.db')
if os.path.exists(INSTANCE_DB) and not os.path.exists(DEFAULT_DB_PATH):
    try:
        import shutil
        shutil.copy2(INSTANCE_DB, DEFAULT_DB_PATH)
    except Exception:
        pass


class Config:
    SECRET_KEY = os.environ.get('SECRET_KEY', 'tiger-farm-secret-key-2024')

    # Support external cloud databases (PostgreSQL, Neon, Supabase, Render, etc.)
    raw_db_url = os.environ.get('DATABASE_URL') or os.environ.get('POSTGRES_URL')
    if raw_db_url and raw_db_url.startswith('postgres://'):
        raw_db_url = raw_db_url.replace('postgres://', 'postgresql://', 1)

    SQLALCHEMY_DATABASE_URI = raw_db_url or f"sqlite:///{DEFAULT_DB_PATH}"
    SQLALCHEMY_TRACK_MODIFICATIONS = False

    UPLOAD_FOLDER = os.environ.get('UPLOAD_FOLDER', os.path.join(PROJECT_ROOT, 'uploads', 'bills'))
    try:
        os.makedirs(UPLOAD_FOLDER, exist_ok=True)
    except OSError:
        UPLOAD_FOLDER = '/tmp/uploads'
        os.makedirs(UPLOAD_FOLDER, exist_ok=True)

    MAX_CONTENT_LENGTH = 10 * 1024 * 1024  # 10 MB max upload
    ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'pdf'}
    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = 'Lax'
    PERMANENT_SESSION_LIFETIME = 86400  # 24 hours


class DevelopmentConfig(Config):
    DEBUG = True


class ProductionConfig(Config):
    DEBUG = False
    SESSION_COOKIE_SECURE = False  # Set to True if using HTTPS custom domain


config = {
    'development': DevelopmentConfig,
    'production': ProductionConfig,
    'default': DevelopmentConfig,
}
