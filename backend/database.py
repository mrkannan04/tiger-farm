from sqlalchemy import text
from .models import (
    db, User, Category, Unit, Field, Supplier
)


def init_db(app):
    """Initialize the database, apply safe schema migrations, and seed default core taxonomies."""
    with app.app_context():
        # Step 1: Create all tables that do not exist yet (never drops existing tables)
        db.create_all()

        # Step 2: Safe column migrations for existing SQLite databases
        _migrate_schema()

        # Step 3: Seed basic default admin, categories, units, fields if missing
        _seed_defaults()


def _migrate_schema():
    """Safely check and add any missing columns in existing SQLite tables."""
    try:
        engine = db.engine
        if engine.dialect.name != 'sqlite':
            return
        with engine.connect() as conn:
            # Check users table
            user_cols = [row[1] for row in conn.execute(text("PRAGMA table_info(users)")).fetchall()]
            if 'updated_at' not in user_cols:
                conn.execute(text("ALTER TABLE users ADD COLUMN updated_at DATETIME"))
                conn.commit()

            # Check categories table
            cat_cols = [row[1] for row in conn.execute(text("PRAGMA table_info(categories)")).fetchall()]
            if 'updated_at' not in cat_cols:
                conn.execute(text("ALTER TABLE categories ADD COLUMN updated_at DATETIME"))
                conn.commit()

            # Check notifications table
            notif_cols = [row[1] for row in conn.execute(text("PRAGMA table_info(notifications)")).fetchall()]
            if 'user_id' not in notif_cols:
                conn.execute(text("ALTER TABLE notifications ADD COLUMN user_id INTEGER"))
                conn.commit()

            # Check products table
            prod_cols = [row[1] for row in conn.execute(text("PRAGMA table_info(products)")).fetchall()]
            if 'is_active' not in prod_cols:
                conn.execute(text("ALTER TABLE products ADD COLUMN is_active BOOLEAN DEFAULT 1"))
                conn.commit()

    except Exception as e:
        print(f"[WARN] Schema migration check notice: {e}")


def _seed_defaults():
    """Seed default admin user, categories, units, and field plots."""
    # Admin user
    if not User.query.filter_by(username='admin').first():
        admin = User(username='admin', full_name='Farm Admin', role='admin')
        admin.set_password('tiger123')
        db.session.add(admin)

    # Default categories
    default_categories = [
        ('Fertilizer', '#2D6A4F'),
        ('Micronutrient', '#52B788'),
        ('Chemical', '#8B6914'),
        ('Pesticide', '#C1292E'),
        ('Fungicide', '#6B3A8C'),
        ('Herbicide', '#D4A017'),
        ('Seed', '#5C8A3C'),
        ('Organic Product', '#7FB069'),
        ('Plant Growth Regulator', '#4A90D9'),
        ('Soil Treatment', '#A0522D'),
        ('Other', '#6B7F6E'),
    ]
    for name, color in default_categories:
        if not Category.query.filter_by(name=name).first():
            db.session.add(Category(name=name, color=color))

    # Default units
    default_units = [
        ('Kilogram', 'KG'), ('Gram', 'GM'), ('Milligram', 'MG'),
        ('Liter', 'L'), ('Milliliter', 'ML'), ('Unit', 'Unit'),
        ('Packet', 'Pkt'), ('Bag', 'Bag'), ('Bottle', 'Btl'),
        ('Box', 'Box'), ('Ton', 'Ton'),
    ]
    for name, symbol in default_units:
        if not Unit.query.filter_by(symbol=symbol).first():
            db.session.add(Unit(name=name, symbol=symbol))

    # Default fields / locations
    default_fields = [
        ('North Field', 'Northern section of the farm'),
        ('South Field', 'Southern section of the farm'),
        ('Paddy Field', 'Rice cultivation area'),
        ('Tomato Field', 'Tomato crop section'),
        ('Vegetable Garden', 'Mixed vegetable area'),
        ('Greenhouse', 'Covered growing area'),
    ]
    for name, desc in default_fields:
        if not Field.query.filter_by(name=name).first():
            db.session.add(Field(name=name, description=desc))

    # Default supplier
    if not Supplier.query.filter_by(name='Kisan Agro Supplies').first():
        db.session.add(Supplier(
            name='Kisan Agro Supplies',
            phone='9876543210',
            address='Main Market, Agro Hub',
            email='kisan@example.com'
        ))

    db.session.commit()
