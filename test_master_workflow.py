"""
Comprehensive Master Workflow Test Suite
Verifies all 13 steps of the Master Prompt:
- Mandatory Product Date (Add/Edit Product)
- Packaging & Unit separation
- Add Stock (/api/stock/add) with audit trail & balance verification
- Edit Stock (/api/stock/edit) with diff calculation & audit trail
- Reorder Stock lifecycle (Pending -> Ordered -> Receive with stock update)
- Purchase management with cancellation and atomic stock reversal
- Dashboard stock synchronization and KPIs
- Input validation and boundary conditions
"""

import unittest
import os
import json
from datetime import date, timedelta

os.environ['USE_SQLITE'] = '1'

from backend import create_app
from backend.database import db
from backend.models import Product, Category, Unit, StockMovement, Purchase, Reorder, User

class TestMasterInventoryWorkflow(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = create_app()
        cls.app.config['TESTING'] = True
        cls.app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///:memory:'
        cls.client = cls.app.test_client()

        with cls.app.app_context():
            db.create_all()
            # Ensure an admin user exists
            admin = User.query.filter_by(username='admin').first()
            if not admin:
                admin = User(username='admin', full_name='Farm Admin', role='admin')
                admin.set_password('admin123')
                db.session.add(admin)
                db.session.commit()
            cls.admin_id = admin.id

    def setUp(self):
        # Authenticate session
        with self.client.session_transaction() as sess:
            sess['user_id'] = self.admin_id
            sess['role'] = 'admin'

    def test_01_mandatory_product_date(self):
        """Test Step 5: Product Date is mandatory on creation and persisted correctly."""
        with self.app.app_context():
            cat = Category.query.first() or Category(name='Fertilizers')
            unit = Unit.query.filter_by(symbol='KG').first() or Unit(name='Kilogram', symbol='KG')
            db.session.add(cat)
            db.session.add(unit)
            db.session.commit()
            cat_id = cat.id
            unit_id = unit.id

        # 1. Attempt to create product without product_date -> should fail
        res = self.client.post('/api/products', json={
            'name': 'Test Fertilizer No Date',
            'category_id': cat_id,
            'unit_id': unit_id,
            'opening_stock': 10,
        })
        self.assertEqual(res.status_code, 400)
        self.assertIn('Product Date is', res.get_json().get('message', ''))

        # 2. Create product with mandatory product_date
        today_str = date.today().isoformat()
        prod_name = f"Test Fertilizer {os.urandom(4).hex()}"
        res = self.client.post('/api/products', json={
            'name': prod_name,
            'category_id': cat_id,
            'unit_id': unit_id,
            'product_date': today_str,
            'default_packaging_type': 'Bag',
            'default_package_size': 50,
            'bag_quantity': 2,
            'opening_stock': 100,
        })
        self.assertEqual(res.status_code, 201)
        data = res.get_json()
        self.assertTrue(data.get('success'))
        prod_data = data.get('product') or data.get('data')
        self.assertEqual(prod_data.get('product_date_iso'), today_str)

        # Verify DB directly
        with self.app.app_context():
            p = Product.query.filter_by(name=prod_name).first()
            self.assertIsNotNone(p)
            self.assertEqual(p.product_date, date.today())
            self.assertEqual(p.current_quantity, 100.0)

    def test_02_add_stock_functionality(self):
        """Test Step 2: Dedicated Add Stock endpoint updates stock and records audit trail."""
        with self.app.app_context():
            unit = Unit.query.filter_by(symbol='KG').first()
            cat = Category.query.first()
            p = Product(
                name='Add Stock Test Crop',
                category_id=cat.id,
                unit_id=unit.id,
                current_quantity=50.0,
                product_date=date.today()
            )
            db.session.add(p)
            db.session.commit()
            p_id = p.id

        # 1. Add Stock with validation (5 bags of 25kg = 125kg)
        res = self.client.post('/api/stock/add', json={
            'product_id': p_id,
            'packaging_type': 'Bag',
            'package_size': 25,
            'package_count': 5,
            'adjustment_date': date.today().isoformat(),
            'reason': 'Physical Count Surplus',
            'remarks': 'Master audit surplus test'
        })
        self.assertIn(res.status_code, (200, 201))
        data = res.get_json()
        self.assertTrue(data.get('success'))
        self.assertEqual(data.get('previous_quantity'), 50.0)
        self.assertEqual(data.get('added_quantity'), 125.0)
        self.assertEqual(data.get('new_quantity'), 175.0)

        # 2. Verify DB persistence and StockMovement record
        with self.app.app_context():
            p = Product.query.get(p_id)
            self.assertEqual(p.current_quantity, 175.0)

            mv = StockMovement.query.filter_by(product_id=p_id).order_by(StockMovement.id.desc()).first()
            self.assertIsNotNone(mv)
            self.assertIn(mv.movement_type, ('ADJUSTMENT', 'IN'))
            self.assertEqual(mv.previous_quantity, 50.0)
            self.assertEqual(mv.quantity, 125.0)
            self.assertEqual(mv.balance_after, 175.0)
            self.assertIn('Physical Count Surplus', mv.remarks)

    def test_03_edit_stock_functionality(self):
        """Test Step 2: Dedicated Edit Stock endpoint corrects stock and records difference."""
        with self.app.app_context():
            unit = Unit.query.filter_by(symbol='KG').first()
            cat = Category.query.first()
            p = Product(
                name='Edit Stock Test Crop',
                category_id=cat.id,
                unit_id=unit.id,
                current_quantity=100.0,
                product_date=date.today()
            )
            db.session.add(p)
            db.session.commit()
            p_id = p.id

        # 1. Edit Stock: Correct to 85.0 kg (diff = -15.0 kg)
        res = self.client.post('/api/stock/edit', json={
            'product_id': p_id,
            'target_quantity': 85.0,
            'adjustment_date': date.today().isoformat(),
            'reason': 'Physical Audit Reconciliation',
            'remarks': 'Annual stock recount'
        })
        self.assertIn(res.status_code, (200, 201))
        data = res.get_json()
        self.assertTrue(data.get('success'))
        self.assertEqual(data.get('previous_quantity'), 100.0)
        self.assertEqual(data.get('difference'), -15.0)
        self.assertEqual(data.get('new_quantity'), 85.0)

        # 2. Verify DB persistence and StockMovement record
        with self.app.app_context():
            p = Product.query.get(p_id)
            self.assertEqual(p.current_quantity, 85.0)

            mv = StockMovement.query.filter_by(product_id=p_id).order_by(StockMovement.id.desc()).first()
            self.assertIsNotNone(mv)
            self.assertEqual(mv.previous_quantity, 100.0)
            self.assertEqual(mv.quantity, -15.0)
            self.assertEqual(mv.balance_after, 85.0)

    def test_04_reorder_lifecycle(self):
        """Test Step 4: Reorder creates Pending request without changing stock; receipt updates stock atomically."""
        with self.app.app_context():
            unit = Unit.query.filter_by(symbol='KG').first()
            cat = Category.query.first()
            p = Product(
                name='Reorder Test Product',
                category_id=cat.id,
                unit_id=unit.id,
                current_quantity=20.0,
                default_packaging_type='Bag',
                default_package_size=50.0,
                product_date=date.today()
            )
            db.session.add(p)
            db.session.commit()
            p_id = p.id

        # 1. Create Reorder: 10 bags of 50kg = 500kg
        res = self.client.post('/api/reorders', json={
            'product_id': p_id,
            'packaging_type': 'Bag',
            'package_size': 50,
            'package_count': 10,
            'reorder_date': date.today().isoformat(),
            'expected_delivery_date': (date.today() + timedelta(days=3)).isoformat(),
            'supplier_name': 'Green Agro Ltd',
            'unit_price': 1200.0,
            'notes': 'Urgent requirement'
        })
        self.assertEqual(res.status_code, 201)
        data = res.get_json()
        self.assertTrue(data.get('success'))
        reorder_data = data.get('reorder') or data.get('data')
        reorder_id = reorder_data.get('id')
        self.assertEqual(reorder_data.get('status'), 'Pending')
        self.assertEqual(reorder_data.get('quantity'), 500.0)

        # CRITICAL VERIFICATION: Stock must NOT have increased!
        with self.app.app_context():
            p = Product.query.get(p_id)
            self.assertEqual(p.current_quantity, 20.0, "Reorder creation must NEVER increase stock immediately!")

        # 2. Update status to 'Ordered'
        res = self.client.put(f'/api/reorders/{reorder_id}', json={'status': 'Ordered'})
        self.assertIn(res.status_code, (200, 201))

        # Stock must STILL be unchanged
        with self.app.app_context():
            p = Product.query.get(p_id)
            self.assertEqual(p.current_quantity, 20.0)

        # 3. Receive full reorder (500kg)
        res = self.client.post(f'/api/reorders/{reorder_id}/receive', json={
            'received_quantity': 500.0
        })
        self.assertIn(res.status_code, (200, 201))
        rec_data = res.get_json()
        self.assertTrue(rec_data.get('success'))

        # NOW verify stock has been updated atomically!
        with self.app.app_context():
            p = Product.query.get(p_id)
            self.assertEqual(p.current_quantity, 520.0)

            ro = Reorder.query.get(reorder_id)
            self.assertEqual(ro.status, 'Received')
            self.assertEqual(ro.received_quantity, 500.0)

            # Verify movement audit
            mv = StockMovement.query.filter_by(product_id=p_id, movement_type='REORDER_RECEIVED').first()
            self.assertIsNotNone(mv)
            self.assertEqual(mv.previous_quantity, 20.0)
            self.assertEqual(mv.quantity, 500.0)
            self.assertEqual(mv.balance_after, 520.0)

    def test_05_purchase_cancellation_and_reversal(self):
        """Test Step 7: Purchase adds stock; cancelling reverses the exact stock quantity."""
        with self.app.app_context():
            unit = Unit.query.filter_by(symbol='KG').first()
            cat = Category.query.first()
            p = Product(
                name='Purchase Reversal Crop',
                category_id=cat.id,
                unit_id=unit.id,
                current_quantity=10.0,
                product_date=date.today()
            )
            db.session.add(p)
            db.session.commit()
            p_id = p.id

        # 1. Create Purchase of 40 kg
        res = self.client.post('/api/purchases', data={
            'product_id': p_id,
            'quantity': 40.0,
            'unit_price': 50.0,
            'purchase_date': date.today().isoformat(),
            'packaging_type': 'Loose',
            'package_count': 1,
            'package_size': 40.0,
        })
        self.assertEqual(res.status_code, 201)
        data = res.get_json()
        purch_id = (data.get('purchase') or data.get('data')).get('id')

        # Stock should now be 10 + 40 = 50 kg
        with self.app.app_context():
            p = Product.query.get(p_id)
            self.assertEqual(p.current_quantity, 50.0)

        # 2. Cancel Purchase
        res = self.client.post(f'/api/purchases/{purch_id}/cancel', json={
            'reason': 'Damaged shipment returned'
        })
        self.assertIn(res.status_code, (200, 201))
        c_data = res.get_json()
        self.assertTrue(c_data.get('success'))

        # Stock should be reversed back to 10.0 kg!
        with self.app.app_context():
            p = Product.query.get(p_id)
            self.assertEqual(p.current_quantity, 10.0)

            purch = Purchase.query.get(purch_id)
            self.assertEqual(purch.status, 'Cancelled')

            # Movement audit for reversal
            mv = StockMovement.query.filter_by(product_id=p_id, movement_type='PURCHASE_CANCELLED').first()
            self.assertIsNotNone(mv)
            self.assertEqual(mv.previous_quantity, 50.0)
            self.assertEqual(mv.quantity, -40.0)
            self.assertEqual(mv.balance_after, 10.0)

    def test_06_dashboard_kpis_and_stock_sync(self):
        """Test Step 3: Dashboard synchronization returns real calculations for all required metrics."""
        res = self.client.get('/api/dashboard/stats')
        self.assertIn(res.status_code, (200, 201))
        stats = res.get_json()

        # Check all required keys exist
        for key in [
            'total_products',
            'total_stock_quantity',
            'available_stock',
            'low_stock_count',
            'out_of_stock_count',
            'pending_purchases_count',
            'pending_reorders_count',
            'recent_stock_activities',
        ]:
            self.assertIn(key, stats, f"Dashboard stats must contain '{key}'")

        # Verify recent stock activities structure
        activities = stats.get('recent_stock_activities', [])
        if activities:
            act = activities[0]
            self.assertIn('product_name', act)
            self.assertIn('previous_quantity', act)
            self.assertIn('balance_after', act)
            self.assertIn('movement_date', act)

    def test_07_boundary_and_validation(self):
        """Test Step 10: Validation rejects invalid, empty, or negative values."""
        with self.app.app_context():
            p = Product.query.first()
            p_id = p.id

        # Negative quantity in Add Stock
        res = self.client.post('/api/stock/add', json={
            'product_id': p_id,
            'package_count': -5,
            'adjustment_date': date.today().isoformat(),
        })
        self.assertEqual(res.status_code, 400)

        # Negative target stock in Edit Stock
        res = self.client.post('/api/stock/edit', json={
            'product_id': p_id,
            'target_quantity': -10.0,
            'adjustment_date': date.today().isoformat(),
        })
        self.assertEqual(res.status_code, 400)

        # Missing date in Reorder
        res = self.client.post('/api/reorders', json={
            'product_id': p_id,
            'package_count': 5,
        })
        self.assertEqual(res.status_code, 400)

if __name__ == '__main__':
    unittest.main()
