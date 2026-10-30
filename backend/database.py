from sqlalchemy import text
from .models import (
    db, User, Category, Unit, Field, Supplier, Product, PackageMaster, ProductPackageStock
)


def init_db(app):
    """Initialize the database, apply safe schema migrations, and seed default core taxonomies."""
    with app.app_context():
        # Step 1: Create all tables that do not exist yet (never drops existing tables)
        db.create_all()

        # Step 2: Safe column migrations for existing SQLite databases
        _migrate_schema()

        # Step 3: Seed basic default admin, categories, units, fields, and package sizes
        _seed_defaults()


def _migrate_schema():
    """Safely check and add any missing columns in existing SQLite or PostgreSQL tables."""
    try:
        engine = db.engine
        if engine.dialect.name == 'postgresql':
            with engine.connect() as conn:
                pg_stmts = [
                    "ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP",
                    "ALTER TABLE categories ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP",
                    "ALTER TABLE notifications ADD COLUMN IF NOT EXISTS user_id INTEGER",
                    "ALTER TABLE products ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE",
                    "ALTER TABLE products ADD COLUMN IF NOT EXISTS default_packaging_type VARCHAR(50) DEFAULT 'Bag'",
                    "ALTER TABLE products ADD COLUMN IF NOT EXISTS default_package_size FLOAT",
                    "ALTER TABLE products ADD COLUMN IF NOT EXISTS default_package_unit VARCHAR(20) DEFAULT 'kg'",
                    "ALTER TABLE products ADD COLUMN IF NOT EXISTS default_package_count FLOAT DEFAULT 1.0",
                    "ALTER TABLE purchases ADD COLUMN IF NOT EXISTS packaging_type VARCHAR(50)",
                    "ALTER TABLE purchases ADD COLUMN IF NOT EXISTS package_size FLOAT",
                    "ALTER TABLE purchases ADD COLUMN IF NOT EXISTS package_unit VARCHAR(20)",
                    "ALTER TABLE purchases ADD COLUMN IF NOT EXISTS package_count FLOAT",
                    "ALTER TABLE purchases ADD COLUMN IF NOT EXISTS package_summary VARCHAR(200)",
                    "ALTER TABLE usages ADD COLUMN IF NOT EXISTS packaging_type VARCHAR(50)",
                    "ALTER TABLE usages ADD COLUMN IF NOT EXISTS package_size FLOAT",
                    "ALTER TABLE usages ADD COLUMN IF NOT EXISTS package_unit VARCHAR(20)",
                    "ALTER TABLE usages ADD COLUMN IF NOT EXISTS package_count FLOAT",
                    "ALTER TABLE usages ADD COLUMN IF NOT EXISTS package_summary VARCHAR(200)",
                    "ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS packaging_type VARCHAR(50)",
                    "ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS package_summary VARCHAR(200)",
                ]
                for stmt in pg_stmts:
                    try:
                        conn.execute(text(stmt))
                    except Exception as pg_err:
                        print(f"[WARN] Postgres migration stmt notice: {pg_err}")
                conn.commit()
            return

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
            if 'default_packaging_type' not in prod_cols:
                conn.execute(text("ALTER TABLE products ADD COLUMN default_packaging_type VARCHAR(50) DEFAULT 'Bag'"))
            if 'default_package_size' not in prod_cols:
                conn.execute(text("ALTER TABLE products ADD COLUMN default_package_size FLOAT"))
            if 'default_package_unit' not in prod_cols:
                conn.execute(text("ALTER TABLE products ADD COLUMN default_package_unit VARCHAR(20) DEFAULT 'kg'"))
            if 'default_package_count' not in prod_cols:
                conn.execute(text("ALTER TABLE products ADD COLUMN default_package_count FLOAT DEFAULT 1.0"))
            conn.commit()

            # Check purchases table packaging columns
            purch_cols = [row[1] for row in conn.execute(text("PRAGMA table_info(purchases)")).fetchall()]
            if 'packaging_type' not in purch_cols:
                conn.execute(text("ALTER TABLE purchases ADD COLUMN packaging_type VARCHAR(50)"))
            if 'package_size' not in purch_cols:
                conn.execute(text("ALTER TABLE purchases ADD COLUMN package_size FLOAT"))
            if 'package_unit' not in purch_cols:
                conn.execute(text("ALTER TABLE purchases ADD COLUMN package_unit VARCHAR(20)"))
            if 'package_count' not in purch_cols:
                conn.execute(text("ALTER TABLE purchases ADD COLUMN package_count FLOAT"))
            if 'package_summary' not in purch_cols:
                conn.execute(text("ALTER TABLE purchases ADD COLUMN package_summary VARCHAR(200)"))
            conn.commit()

            # Check usages table packaging columns
            usage_cols = [row[1] for row in conn.execute(text("PRAGMA table_info(usages)")).fetchall()]
            if 'packaging_type' not in usage_cols:
                conn.execute(text("ALTER TABLE usages ADD COLUMN packaging_type VARCHAR(50)"))
            if 'package_size' not in usage_cols:
                conn.execute(text("ALTER TABLE usages ADD COLUMN package_size FLOAT"))
            if 'package_unit' not in usage_cols:
                conn.execute(text("ALTER TABLE usages ADD COLUMN package_unit VARCHAR(20)"))
            if 'package_count' not in usage_cols:
                conn.execute(text("ALTER TABLE usages ADD COLUMN package_count FLOAT"))
            if 'package_summary' not in usage_cols:
                conn.execute(text("ALTER TABLE usages ADD COLUMN package_summary VARCHAR(200)"))
            conn.commit()

            # Check stock_movements table packaging columns
            mv_cols = [row[1] for row in conn.execute(text("PRAGMA table_info(stock_movements)")).fetchall()]
            if 'packaging_type' not in mv_cols:
                conn.execute(text("ALTER TABLE stock_movements ADD COLUMN packaging_type VARCHAR(50)"))
            if 'package_summary' not in mv_cols:
                conn.execute(text("ALTER TABLE stock_movements ADD COLUMN package_summary VARCHAR(200)"))
            conn.commit()

    except Exception as e:
        print(f"[WARN] Schema migration check notice: {e}")


def _seed_defaults():
    """Seed default admin user, categories, units, package master, and example products."""
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

    db.session.flush()

    # Seed Package Master (Reusable package sizes and packaging types)
    # Weight sizes
    weight_packages = [
        (250.0, 'g', 'Bag', 'kg', 0.25),
        (500.0, 'g', 'Bag', 'kg', 0.5),
        (1.0, 'kg', 'Bag', 'kg', 1.0),
        (2.0, 'kg', 'Bag', 'kg', 2.0),
        (2.5, 'kg', 'Bag', 'kg', 2.5),
        (5.0, 'kg', 'Bag', 'kg', 5.0),
        (10.0, 'kg', 'Bag', 'kg', 10.0),
        (20.0, 'kg', 'Bag', 'kg', 20.0),
        (25.0, 'kg', 'Bag', 'kg', 25.0),
        (40.0, 'kg', 'Bag', 'kg', 40.0),
        (45.0, 'kg', 'Bag', 'kg', 45.0),
        (50.0, 'kg', 'Bag', 'kg', 50.0),
        # Pouch weight sizes
        (250.0, 'g', 'Pouch', 'kg', 0.25),
        (500.0, 'g', 'Pouch', 'kg', 0.5),
        (1.0, 'kg', 'Pouch', 'kg', 1.0),
    ]

    # Liquid sizes
    liquid_packages = [
        (250.0, 'ml', 'Bottle', 'L', 0.25),
        (500.0, 'ml', 'Bottle', 'L', 0.5),
        (1.0, 'L', 'Bottle', 'L', 1.0),
        (2.0, 'L', 'Bottle', 'L', 2.0),
        (3.0, 'L', 'Bottle', 'L', 3.0),
        (4.0, 'L', 'Bottle', 'L', 4.0),
        (5.0, 'L', 'Bottle', 'L', 5.0),
        (10.0, 'L', 'Bottle', 'L', 10.0),
        # Containers & Drums
        (5.0, 'L', 'Container', 'L', 5.0),
        (10.0, 'L', 'Container', 'L', 10.0),
        (20.0, 'L', 'Drum', 'L', 20.0),
        (200.0, 'L', 'Drum', 'L', 200.0),
    ]

    # Loose packages
    loose_packages = [
        (1.0, 'KG', 'Loose', 'kg', 1.0),
        (1.0, 'g', 'Loose', 'kg', 0.001),
        (1.0, 'L', 'Loose', 'L', 1.0),
    ]

    for size, unit_sym, pkg_type, base_u, mult in (weight_packages + liquid_packages + loose_packages):
        exists = PackageMaster.query.filter(
            PackageMaster.package_size == size,
            db.func.lower(PackageMaster.unit_symbol) == unit_sym.lower(),
            db.func.lower(PackageMaster.packaging_type) == pkg_type.lower()
        ).first()
        if not exists:
            db.session.add(PackageMaster(
                package_size=size,
                unit_symbol=unit_sym,
                packaging_type=pkg_type,
                base_unit=base_u,
                base_multiplier=mult,
                is_active=True
            ))

    # Specified Products (from user requirements) with Bag Size & Default Quantity (1 Bag)
    fert_cat = Category.query.filter_by(name='Fertilizer').first()
    micro_cat = Category.query.filter_by(name='Micronutrient').first()
    soil_cat = Category.query.filter_by(name='Soil Treatment').first()
    org_cat = Category.query.filter_by(name='Organic Product').first()
    kg_unit = Unit.query.filter_by(symbol='KG').first()
    l_unit = Unit.query.filter_by(symbol='L').first()

    sample_products = [
        # name, category, unit, bag_size, default_qty, min_stock, pkg_type, unit_sym, description
        ('UREA', fert_cat.id if fert_cat else 1, kg_unit.id if kg_unit else 1, 45.0, 1.0, 10.0, 'Bag', 'kg', 'Primary nitrogenous fertilizer in solid crystalline/granular form (45 kg standard bag)'),
        ('Potash', fert_cat.id if fert_cat else 1, kg_unit.id if kg_unit else 1, 50.0, 1.0, 5.0, 'Bag', 'kg', 'Muriate of potash (MOP) for root strength and crop resistance (50 kg bag)'),
        ('DAP', fert_cat.id if fert_cat else 1, kg_unit.id if kg_unit else 1, 50.0, 1.0, 10.0, 'Bag', 'kg', 'Diammonium phosphate, highly soluble source of phosphorus and nitrogen (50 kg bag)'),
        ('Ammonium Sulphate', fert_cat.id if fert_cat else 1, kg_unit.id if kg_unit else 1, 50.0, 1.0, 5.0, 'Bag', 'kg', 'Inorganic water-soluble fertilizer containing 21% nitrogen and 24% sulfur (50 kg bag)'),
        ('Borax', micro_cat.id if micro_cat else 1, kg_unit.id if kg_unit else 1, 25.0, 1.0, 2.0, 'Bag', 'kg', 'Essential micronutrient for flower pollination and fruit development (25 kg bag)'),
        ('Copper Sulphate', micro_cat.id if micro_cat else 1, kg_unit.id if kg_unit else 1, 1.0, 1.0, 1.0, 'Bag', 'kg', 'Bordeaux mixture base and essential copper micronutrient (1 kg bag)'),
        ('Zinc Sulphate', micro_cat.id if micro_cat else 1, kg_unit.id if kg_unit else 1, 10.0, 1.0, 5.0, 'Bag', 'kg', 'Critical micronutrient for chlorophyll synthesis and stem elongation (10 kg bag)'),
        ('Manganese Sulphate', micro_cat.id if micro_cat else 1, kg_unit.id if kg_unit else 1, 50.0, 1.0, 2.0, 'Bag', 'kg', 'Vital for plant photosynthesis, respiration, and nitrogen assimilation (50 kg bag)'),
        ('Ferrous Sulphate', micro_cat.id if micro_cat else 1, kg_unit.id if kg_unit else 1, 50.0, 1.0, 3.0, 'Bag', 'kg', 'Corrects iron chlorosis and yellowing of young leaves (50 kg bag)'),
        ('Magnesium Sulphate', micro_cat.id if micro_cat else 1, kg_unit.id if kg_unit else 1, 50.0, 1.0, 5.0, 'Bag', 'kg', 'Epsom salt agricultural grade for chlorophyll core structure (50 kg bag)'),
        ('Neem', org_cat.id if org_cat else 1, kg_unit.id if kg_unit else 1, 50.0, 1.0, 5.0, 'Bag', 'kg', 'Organic neem cake fertilizer and natural soil nematode repellent (50 kg bag)'),
        ('Gypsum', soil_cat.id if soil_cat else 1, kg_unit.id if kg_unit else 1, 50.0, 1.0, 10.0, 'Bag', 'kg', 'Agricultural calcium sulfate soil conditioner and reclamation agent (50 kg bag)'),
        ('CMS', fert_cat.id if fert_cat else 1, kg_unit.id if kg_unit else 1, 50.0, 1.0, 5.0, 'Bag', 'kg', 'Calcium Magnesium Sulphate composite fertilizer (50 kg bag)'),
        ('12:61:0', fert_cat.id if fert_cat else 1, kg_unit.id if kg_unit else 1, 25.0, 1.0, 5.0, 'Bag', 'kg', 'Mono Ammonium Phosphate (MAP) 100% water soluble drip grade (25 kg bag)'),
        ('Liquid Urea', fert_cat.id if fert_cat else 1, l_unit.id if l_unit else 1, 2.0, 5.0, 5.0, 'Bottle', 'L', 'Liquid foliar spray and fertigation formulation (2 L bottle)'),
    ]

    for pname, cid, uid, bsize, dqty, mq, ptype, usym, desc in sample_products:
        existing_p = Product.query.filter(db.func.lower(Product.name) == pname.lower()).first()
        init_total = round(bsize * dqty, 4)
        if not existing_p:
            p = Product(
                name=pname,
                category_id=cid,
                unit_id=uid,
                current_quantity=init_total,
                minimum_stock=mq,
                description=desc,
                is_active=True,
                default_packaging_type=ptype,
                default_package_size=bsize,
                default_package_unit=usym,
                default_package_count=dqty,
            )
            db.session.add(p)
            db.session.flush()

            db.session.add(ProductPackageStock(
                product_id=p.id,
                packaging_type=ptype,
                package_size=bsize,
                unit_symbol=usym,
                package_count=dqty,
                total_quantity=init_total,
            ))
        else:
            # Update default bag size & quantity attributes
            existing_p.default_packaging_type = ptype
            existing_p.default_package_size = bsize
            existing_p.default_package_unit = usym
            existing_p.default_package_count = dqty
            if existing_p.current_quantity <= 0:
                existing_p.current_quantity = init_total

            # Ensure ProductPackageStock entry exists for this bag size
            pps = ProductPackageStock.query.filter(
                ProductPackageStock.product_id == existing_p.id,
                db.func.lower(ProductPackageStock.packaging_type) == ptype.lower(),
                ProductPackageStock.package_size == bsize,
                db.func.lower(ProductPackageStock.unit_symbol) == usym.lower(),
            ).first()
            if not pps:
                db.session.add(ProductPackageStock(
                    product_id=existing_p.id,
                    packaging_type=ptype,
                    package_size=bsize,
                    unit_symbol=usym,
                    package_count=dqty,
                    total_quantity=init_total,
                ))
            elif pps.package_count <= 0:
                pps.package_count = dqty
                pps.total_quantity = init_total

    db.session.commit()

