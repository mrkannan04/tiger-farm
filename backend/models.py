from datetime import datetime
from flask_sqlalchemy import SQLAlchemy
from flask_login import UserMixin
from werkzeug.security import generate_password_hash, check_password_hash

db = SQLAlchemy()


class User(UserMixin, db.Model):
    """Application user / farm worker account."""
    __tablename__ = 'users'

    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False, index=True)
    email = db.Column(db.String(120), unique=True, nullable=True)
    password_hash = db.Column(db.String(256), nullable=False)
    full_name = db.Column(db.String(120), nullable=True)
    role = db.Column(db.String(20), default='admin')
    is_active = db.Column(db.Boolean, default=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(
        db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )
    last_login = db.Column(db.DateTime, nullable=True)

    def __init__(self, **kwargs):
        super().__init__(**kwargs)

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)

    def to_dict(self):
        return {
            'id': self.id,
            'username': self.username,
            'full_name': self.full_name,
            'email': self.email,
            'role': self.role,
            'created_at': self.created_at.strftime('%d %b %Y') if self.created_at else None,
        }


class Category(db.Model):
    """Product category (Fertilizer, Pesticide, etc.)."""
    __tablename__ = 'categories'

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), unique=True, nullable=False, index=True)
    description = db.Column(db.Text, nullable=True)
    color = db.Column(db.String(7), default='#52B788')
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(
        db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    products = db.relationship('Product', backref='category', lazy=True)

    def __init__(self, **kwargs):
        super().__init__(**kwargs)

    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'description': self.description,
            'color': self.color,
            'product_count': len(self.products),
        }


class Unit(db.Model):
    """Measurement unit (KG, Liter, Packet, etc.)."""
    __tablename__ = 'units'

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(50), unique=True, nullable=False)
    symbol = db.Column(db.String(10), nullable=False, index=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def __init__(self, **kwargs):
        super().__init__(**kwargs)

    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'symbol': self.symbol,
        }


class Field(db.Model):
    """Farm field / location."""
    __tablename__ = 'fields'

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), unique=True, nullable=False, index=True)
    description = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def __init__(self, **kwargs):
        super().__init__(**kwargs)

    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'description': self.description,
        }


class Supplier(db.Model):
    """Agro supplier / vendor."""
    __tablename__ = 'suppliers'

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(150), nullable=False, index=True)
    phone = db.Column(db.String(20), nullable=True)
    address = db.Column(db.Text, nullable=True)
    email = db.Column(db.String(120), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    purchases = db.relationship('Purchase', backref='supplier_ref', lazy=True)

    def __init__(self, **kwargs):
        super().__init__(**kwargs)

    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'phone': self.phone,
            'address': self.address,
            'email': self.email,
        }


class Product(db.Model):
    """Farm product / inventory item."""
    __tablename__ = 'products'

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(150), nullable=False, index=True)
    category_id = db.Column(db.Integer, db.ForeignKey('categories.id'), nullable=False, index=True)
    unit_id = db.Column(db.Integer, db.ForeignKey('units.id'), nullable=False, index=True)
    current_quantity = db.Column(db.Float, default=0.0)
    minimum_stock = db.Column(db.Float, default=0.0)
    description = db.Column(db.Text, nullable=True)
    is_active = db.Column(db.Boolean, default=True, index=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(
        db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    unit = db.relationship('Unit', backref='products')
    purchases = db.relationship('Purchase', backref='product', lazy=True, order_by='desc(Purchase.purchase_date)')
    usages = db.relationship('Usage', backref='product', lazy=True, order_by='desc(Usage.usage_date)')
    stock_movements = db.relationship(
        'StockMovement', backref='product', lazy=True, order_by='desc(StockMovement.movement_date)'
    )

    def __init__(self, **kwargs):
        super().__init__(**kwargs)

    @property
    def status(self):
        if self.current_quantity <= 0:
            return 'out_of_stock'
        elif self.current_quantity <= self.minimum_stock:
            return 'low_stock'
        return 'in_stock'

    @property
    def total_purchased(self):
        return round(sum(p.quantity for p in self.purchases), 4)

    @property
    def total_used(self):
        return round(sum(u.quantity for u in self.usages), 4)

    @property
    def total_purchase_cost(self):
        return round(sum(p.total_price or 0 for p in self.purchases), 2)

    @property
    def average_purchase_price(self):
        if self.total_purchased > 0:
            return round(self.total_purchase_cost / self.total_purchased, 2)
        return 0.0

    @property
    def estimated_stock_value(self):
        return round(self.current_quantity * self.average_purchase_price, 2)

    @property
    def last_purchase_date(self):
        if self.purchases:
            return self.purchases[0].purchase_date.strftime('%d %b %Y')
        return None

    @property
    def last_usage_date(self):
        if self.usages:
            return self.usages[0].usage_date.strftime('%d %b %Y')
        return None

    def to_dict(self, include_stats=False):
        data = {
            'id': self.id,
            'name': self.name,
            'category_id': self.category_id,
            'category': self.category.name if self.category else None,
            'category_color': self.category.color if self.category else '#52B788',
            'unit_id': self.unit_id,
            'unit': self.unit.symbol if self.unit else None,
            'current_quantity': round(self.current_quantity, 4),
            'minimum_stock': self.minimum_stock,
            'status': self.status,
            'description': self.description,
            'is_active': self.is_active,
            'created_at': self.created_at.strftime('%d %b %Y') if self.created_at else None,
            'updated_at': self.updated_at.strftime('%d %b %Y') if self.updated_at else None,
        }
        if include_stats:
            data.update({
                'total_purchased': self.total_purchased,
                'total_used': self.total_used,
                'total_purchase_cost': self.total_purchase_cost,
                'average_purchase_price': self.average_purchase_price,
                'estimated_stock_value': self.estimated_stock_value,
                'last_purchase_date': self.last_purchase_date,
                'last_usage_date': self.last_usage_date,
            })
        return data


class Purchase(db.Model):
    """Record of a product purchase."""
    __tablename__ = 'purchases'

    id = db.Column(db.Integer, primary_key=True)
    product_id = db.Column(db.Integer, db.ForeignKey('products.id'), nullable=False, index=True)
    quantity = db.Column(db.Float, nullable=False)
    unit_id = db.Column(db.Integer, db.ForeignKey('units.id'), nullable=False)
    unit_price = db.Column(db.Float, nullable=True)
    total_price = db.Column(db.Float, nullable=True)
    purchase_date = db.Column(db.Date, nullable=False, index=True)
    supplier_id = db.Column(db.Integer, db.ForeignKey('suppliers.id'), nullable=True)
    supplier_name = db.Column(db.String(150), nullable=True)  # free-text fallback
    invoice_number = db.Column(db.String(100), nullable=True)
    remarks = db.Column(db.Text, nullable=True)
    bill_file = db.Column(db.String(250), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    unit = db.relationship('Unit', foreign_keys=[unit_id])

    def __init__(self, **kwargs):
        super().__init__(**kwargs)

    @property
    def supplier(self):
        return self.supplier_name or (self.supplier_ref.name if self.supplier_ref else None)

    def to_dict(self):
        return {
            'id': self.id,
            'product_id': self.product_id,
            'product_name': self.product.name if self.product else None,
            'quantity': self.quantity,
            'unit': self.unit.symbol if self.unit else None,
            'unit_price': self.unit_price,
            'total_price': self.total_price,
            'purchase_date': self.purchase_date.strftime('%d %b %Y') if self.purchase_date else None,
            'purchase_date_iso': self.purchase_date.isoformat() if self.purchase_date else None,
            'supplier_name': self.supplier_name,
            'supplier': self.supplier,
            'supplier_id': self.supplier_id,
            'invoice_number': self.invoice_number,
            'remarks': self.remarks,
            'bill_file': self.bill_file,
            'created_at': self.created_at.strftime('%d %b %Y, %I:%M %p') if self.created_at else None,
        }


class Usage(db.Model):
    """Record of product usage / stock deduction."""
    __tablename__ = 'usages'

    id = db.Column(db.Integer, primary_key=True)
    product_id = db.Column(db.Integer, db.ForeignKey('products.id'), nullable=False, index=True)
    quantity = db.Column(db.Float, nullable=False)
    unit_id = db.Column(db.Integer, db.ForeignKey('units.id'), nullable=False)
    usage_date = db.Column(db.Date, nullable=False, index=True)
    field_location = db.Column(db.String(150), nullable=True)
    reason = db.Column(db.String(250), nullable=True)
    remarks = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    unit = db.relationship('Unit', foreign_keys=[unit_id])

    def __init__(self, **kwargs):
        super().__init__(**kwargs)

    def to_dict(self):
        return {
            'id': self.id,
            'product_id': self.product_id,
            'product_name': self.product.name if self.product else None,
            'quantity': self.quantity,
            'unit': self.unit.symbol if self.unit else None,
            'usage_date': self.usage_date.strftime('%d %b %Y') if self.usage_date else None,
            'usage_date_iso': self.usage_date.isoformat() if self.usage_date else None,
            'field_location': self.field_location,
            'reason': self.reason,
            'remarks': self.remarks,
            'created_at': self.created_at.strftime('%d %b %Y, %I:%M %p') if self.created_at else None,
        }


class StockMovement(db.Model):
    """Audit log for every stock change (ledger)."""
    __tablename__ = 'stock_movements'

    id = db.Column(db.Integer, primary_key=True)
    product_id = db.Column(db.Integer, db.ForeignKey('products.id'), nullable=False, index=True)
    movement_type = db.Column(db.String(20), nullable=False)  # INITIAL / PURCHASE / USAGE / ADJUSTMENT
    quantity = db.Column(db.Float, nullable=False)           # positive or negative
    balance_after = db.Column(db.Float, nullable=False)
    reference_id = db.Column(db.Integer, nullable=True)      # purchase.id or usage.id
    movement_date = db.Column(db.Date, nullable=False, index=True)
    remarks = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def __init__(self, **kwargs):
        super().__init__(**kwargs)

    def to_dict(self):
        return {
            'id': self.id,
            'product_id': self.product_id,
            'movement_type': (self.movement_type or '').upper(),
            'quantity': self.quantity,
            'balance_after': self.balance_after,
            'movement_date': self.movement_date.strftime('%d %b %Y') if self.movement_date else None,
            'remarks': self.remarks,
            'created_at': self.created_at.strftime('%d %b %Y, %I:%M %p') if self.created_at else None,
        }


class Notification(db.Model):
    """System notifications (low stock, etc.)."""
    __tablename__ = 'notifications'

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    type = db.Column(db.String(50), nullable=False)   # low_stock / out_of_stock / info
    title = db.Column(db.String(200), nullable=False)
    message = db.Column(db.Text, nullable=False)
    product_id = db.Column(db.Integer, db.ForeignKey('products.id'), nullable=True, index=True)
    is_read = db.Column(db.Boolean, default=False, index=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def __init__(self, **kwargs):
        super().__init__(**kwargs)

    def to_dict(self):
        return {
            'id': self.id,
            'user_id': self.user_id,
            'type': self.type,
            'title': self.title,
            'message': self.message,
            'product_id': self.product_id,
            'is_read': self.is_read,
            'created_at': self.created_at.strftime('%d %b %Y, %I:%M %p') if self.created_at else None,
        }


class ActivityLog(db.Model):
    """Human-readable activity log."""
    __tablename__ = 'activity_logs'

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    action = db.Column(db.String(500), nullable=False)
    entity_type = db.Column(db.String(50), nullable=True)
    entity_id = db.Column(db.Integer, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    user = db.relationship('User', backref='activity_logs')

    def __init__(self, **kwargs):
        super().__init__(**kwargs)

    def to_dict(self):
        username = self.user.username if self.user else 'System'
        return {
            'id': self.id,
            'username': username,
            'action': self.action,
            'entity_type': self.entity_type,
            'created_at': self.created_at.strftime('%d %b %Y, %I:%M %p') if self.created_at else None,
        }
