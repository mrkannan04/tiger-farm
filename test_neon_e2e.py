"""
Tiger Farm — Neon Cloud PostgreSQL End-to-End Verification Test
Proves that Tiger Farm successfully connects to, initializes, queries,
mutates, and audits data on Neon Cloud PostgreSQL with 100% data persistence.
"""

import os
import sys
import uuid
import unittest
from dotenv import load_dotenv

load_dotenv()

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

from backend import create_app
from backend.models import db, User, Product, Category, Unit, Purchase, Usage, StockMovement


class NeonCloudE2ETests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = create_app()
        cls.app.config['TESTING'] = True
        with cls.app.app_context():
            cls.dialect = db.engine.dialect.name
            print(f"\n[NEON] Connected database engine dialect: {cls.dialect}")

    def setUp(self):
        self.client = self.app.test_client()
        # Admin login
        res = self.client.post('/api/auth/login', json={'username': 'admin', 'password': 'tiger123'})
        self.assertEqual(res.status_code, 200, "Admin login to Neon database must succeed")

    def test_01_verify_neon_connection_and_core_seeders(self):
        """Verify Neon connection and seeded taxonomies."""
        with self.app.app_context():
            self.assertEqual(self.dialect, 'postgresql', "Database engine should be PostgreSQL")
            self.assertGreaterEqual(Category.query.count(), 11)
            self.assertGreaterEqual(Unit.query.count(), 11)
            admin = User.query.filter_by(username='admin').first()
            self.assertIsNotNone(admin)

    def test_02_product_lifecycle_on_neon(self):
        """Create product, record purchase, record usage on Neon PostgreSQL."""
        cat_id = self.client.get('/api/categories').get_json()['categories'][0]['id']
        unit_id = self.client.get('/api/units').get_json()['units'][0]['id']

        # 1. Create product on Neon
        prod_name = f"Neon Super Phosphate {uuid.uuid4().hex[:6]}"
        create_res = self.client.post('/api/products', json={
            'name': prod_name,
            'category_id': cat_id,
            'unit_id': unit_id,
            'current_quantity': 10.0,
            'minimum_stock': 5.0,
            'description': 'Neon cloud persistent test fertilizer'
        })
        self.assertEqual(create_res.status_code, 201)
        prod = create_res.get_json()['data']
        prod_id = prod['id']
        self.assertEqual(prod['current_quantity'], 10.0)

        # 2. Record purchase on Neon (+10 KG -> 20 KG)
        inv = f"NEON-INV-{uuid.uuid4().hex[:6].upper()}"
        purch_res = self.client.post('/api/purchases', json={
            'product_id': prod_id,
            'quantity': 10.0,
            'unit_id': unit_id,
            'unit_price': 150.0,
            'total_price': 1500.0,
            'supplier': 'Kisan Agro Supplies',
            'invoice_number': inv,
            'purchase_date': '2026-10-26',
            'remarks': 'Neon test purchase'
        })
        self.assertEqual(purch_res.status_code, 201)

        # Verify stock updated to 20 KG on Neon
        stock_res = self.client.get(f'/api/products/{prod_id}/stock')
        self.assertEqual(stock_res.status_code, 200)
        self.assertEqual(stock_res.get_json()['current_quantity'], 20.0)

        # 3. Record usage on Neon (-2 KG -> 18 KG)
        usage_res = self.client.post('/api/usages', json={
            'product_id': prod_id,
            'quantity': 2.0,
            'unit_id': unit_id,
            'usage_date': '2026-10-26',
            'field_location': 'North Field',
            'reason': 'Crop fertilization',
            'remarks': 'Neon test usage'
        })
        self.assertEqual(usage_res.status_code, 201)

        # Verify stock updated to 18 KG on Neon
        stock_res2 = self.client.get(f'/api/products/{prod_id}/stock')
        self.assertEqual(stock_res2.get_json()['current_quantity'], 18.0)

        # 4. Verify stock movement ledger in Neon database directly
        with self.app.app_context():
            movements = StockMovement.query.filter_by(product_id=prod_id).order_by(StockMovement.id.asc()).all()
            self.assertEqual(len(movements), 3)  # INITIAL (10), PURCHASE (10), USAGE (2)
            self.assertEqual(movements[0].movement_type, 'INITIAL')
            self.assertEqual(movements[0].balance_after, 10.0)
            self.assertEqual(movements[1].movement_type, 'PURCHASE')
            self.assertEqual(movements[1].balance_after, 20.0)
            self.assertEqual(movements[2].movement_type, 'USAGE')
            self.assertEqual(movements[2].balance_after, 18.0)

    def test_03_insufficient_stock_rejection_on_neon(self):
        """Verify negative stock protection on Neon PostgreSQL."""
        cat_id = self.client.get('/api/categories').get_json()['categories'][0]['id']
        unit_id = self.client.get('/api/units').get_json()['units'][0]['id']

        prod = self.client.post('/api/products', json={
            'name': f"Neon Low Stock Test {uuid.uuid4().hex[:6]}",
            'category_id': cat_id,
            'unit_id': unit_id,
            'current_quantity': 3.0,
            'minimum_stock': 1.0
        }).get_json()['data']

        # Attempt to use 5 (only 3 available)
        res = self.client.post('/api/usages', json={
            'product_id': prod['id'],
            'quantity': 5.0,
            'unit_id': unit_id,
            'usage_date': '2026-10-26',
            'field_location': 'South Field',
            'reason': 'Excessive usage test'
        })
        self.assertEqual(res.status_code, 400)
        self.assertIn('Insufficient Stock', res.get_json()['error'])

        # Verify stock remains unchanged at 3.0 on Neon
        stock = self.client.get(f"/api/products/{prod['id']}/stock").get_json()
        self.assertEqual(stock['current_quantity'], 3.0)

    def test_04_reports_and_dashboard_on_neon(self):
        """Verify dashboard and PDF reports query Neon PostgreSQL directly."""
        dash = self.client.get('/api/dashboard')
        self.assertEqual(dash.status_code, 200)
        self.assertIn('total_products', dash.get_json())

        pdf = self.client.get('/api/reports/products/pdf')
        self.assertEqual(pdf.status_code, 200)
        self.assertTrue(pdf.data.startswith(b'%PDF'))


if __name__ == '__main__':
    unittest.main(verbosity=2)
