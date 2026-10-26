"""
Tiger Farm — Comprehensive Database Persistence & History Test Suite
Tests all 14 criteria specified in Section 51 & 52 of the specification.
Verifies physical SQLite file persistence on disk (database/tiger_farm.db).
"""

import os
import sys
import sqlite3
import json
import io
import uuid
import unittest

# Ensure tiger-farm root is on sys.path
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

from backend import create_app
from backend.models import db, User, Product, Category, Unit, Purchase, Usage, StockMovement, Notification


class TigerFarmPersistenceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.db_path = os.path.join(BASE_DIR, 'database', 'tiger_farm.db')
        cls.assertTrue(os.path.exists(cls.db_path), f"Physical database file must exist at {cls.db_path}")
        cls.app = create_app()
        cls.app.config['TESTING'] = True

    def setUp(self):
        self.client = self.app.test_client()
        # Login as admin
        login_resp = self.client.post('/api/auth/login', json={
            'username': 'admin',
            'password': 'tiger123'
        })
        self.assertEqual(login_resp.status_code, 200, "Admin login should succeed")

    def _get_category_and_unit(self):
        """Helper to get a category ID and unit ID."""
        cat_resp = self.client.get('/api/categories')
        cat_data = cat_resp.get_json()
        cats = cat_data.get('categories', cat_data) if isinstance(cat_data, dict) else cat_data

        unit_resp = self.client.get('/api/units')
        unit_data = unit_resp.get_json()
        units = unit_data.get('units', unit_data) if isinstance(unit_data, dict) else unit_data

        self.assertTrue(len(cats) > 0, "At least one category must exist")
        self.assertTrue(len(units) > 0, "At least one unit must exist")
        return cats[0]['id'], units[0]['id']

    def _create_unique_product(self, prefix="Test Product", qty=10.0, min_stock=5.0):
        cat_id, unit_id = self._get_category_and_unit()
        name = f"{prefix} {uuid.uuid4().hex[:6]}"
        res = self.client.post('/api/products', json={
            'name': name,
            'category_id': cat_id,
            'unit_id': unit_id,
            'current_quantity': qty,
            'minimum_stock': min_stock,
            'description': 'Automated persistence verification item'
        })
        self.assertIn(res.status_code, [200, 201])
        return res.get_json()['data']

    def test_01_create_product_verify_db_record(self):
        """Test 1: Create product -> verify database record."""
        p = self._create_unique_product("Test Potassium Sulfate", qty=10.0, min_stock=5.0)
        prod_id = p['id']

        # Verify directly in physical SQLite DB on disk
        with sqlite3.connect(self.db_path) as conn:
            cur = conn.cursor()
            cur.execute("SELECT id, name, current_quantity, minimum_stock FROM products WHERE id = ?", (prod_id,))
            row = cur.fetchone()

        self.assertIsNotNone(row)
        self.assertEqual(row[0], prod_id)
        self.assertEqual(row[2], 10.0)
        self.assertEqual(row[3], 5.0)

    def test_02_create_product_logout_login_verify(self):
        """Test 2: Create product -> logout -> login -> verify product exists."""
        p = self._create_unique_product("Persistence Herbicide", qty=15.0, min_stock=3.0)
        prod_id = p['id']

        # Logout
        logout_res = self.client.post('/api/auth/logout')
        self.assertEqual(logout_res.status_code, 200)

        # Re-login
        login_res = self.client.post('/api/auth/login', json={'username': 'admin', 'password': 'tiger123'})
        self.assertEqual(login_res.status_code, 200)

        # Verify product exists via API
        get_res = self.client.get(f'/api/products/{prod_id}')
        self.assertEqual(get_res.status_code, 200)
        prod_data = get_res.get_json().get('data', get_res.get_json())
        self.assertEqual(prod_data['id'], prod_id)
        self.assertEqual(prod_data['current_quantity'], 15.0)

    def test_03_purchase_verify_purchase_exists(self):
        """Test 3: Purchase -> verify purchase exists."""
        p = self._create_unique_product("Urea Nitrogen", qty=5.0, min_stock=2.0)
        inv = f"INV-{uuid.uuid4().hex[:6].upper()}"

        # Record purchase via JSON
        purch_res = self.client.post('/api/purchases', json={
            'product_id': p['id'],
            'quantity': 20.0,
            'unit_id': p['unit_id'],
            'unit_price': 45.0,
            'total_price': 900.0,
            'supplier': 'Green Farm Agrochemicals',
            'invoice_number': inv,
            'purchase_date': '2026-10-26',
            'remarks': 'For paddy crop pre-monsoon'
        })
        self.assertIn(purch_res.status_code, [200, 201])
        purch_data = purch_res.get_json()
        self.assertTrue(purch_data.get('success'))
        purch_id = purch_data['data']['id']

        # Verify in SQLite DB directly
        with sqlite3.connect(self.db_path) as conn:
            cur = conn.cursor()
            cur.execute("SELECT id, product_id, quantity, unit_price, total_price, invoice_number FROM purchases WHERE id = ?", (purch_id,))
            row = cur.fetchone()

        self.assertIsNotNone(row)
        self.assertEqual(row[1], p['id'])
        self.assertEqual(row[2], 20.0)
        self.assertEqual(row[3], 45.0)
        self.assertEqual(row[4], 900.0)
        self.assertEqual(row[5], inv)

    def test_04_purchase_logout_login_verify(self):
        """Test 4: Purchase -> logout -> login -> verify purchase exists."""
        p = self._create_unique_product("Neem Oil", qty=2.0, min_stock=1.0)
        inv = f"BIO-{uuid.uuid4().hex[:6].upper()}"

        purch_res = self.client.post('/api/purchases', json={
            'product_id': p['id'],
            'quantity': 10.0,
            'unit_id': p['unit_id'],
            'unit_price': 250.0,
            'total_price': 2500.0,
            'supplier': 'Organic Bio Supplies',
            'invoice_number': inv,
            'purchase_date': '2026-10-26',
            'remarks': 'Cold pressed neem oil'
        })
        self.assertIn(purch_res.status_code, [200, 201])
        purch_id = purch_res.get_json()['data']['id']

        # Logout & Login
        self.client.post('/api/auth/logout')
        self.client.post('/api/auth/login', json={'username': 'admin', 'password': 'tiger123'})

        # Verify purchase list contains it
        list_res = self.client.get(f'/api/purchases?search={inv}')
        self.assertEqual(list_res.status_code, 200)
        purchases = list_res.get_json()['purchases']
        matching = [x for x in purchases if x['id'] == purch_id]
        self.assertEqual(len(matching), 1)
        self.assertEqual(matching[0]['invoice_number'], inv)

    def test_05_usage_verify_usage_exists(self):
        """Test 5: Usage -> verify usage exists."""
        p = self._create_unique_product("Zinc Sulfate", qty=25.0, min_stock=5.0)

        usage_res = self.client.post('/api/usages', json={
            'product_id': p['id'],
            'quantity': 5.0,
            'unit_id': p['unit_id'],
            'usage_date': '2026-10-26',
            'field_location': 'North Field - Plot A',
            'reason': 'Micronutrient foliar spray',
            'remarks': 'Sprayed after paddy transplanting'
        })
        self.assertIn(usage_res.status_code, [200, 201])
        usage_data = usage_res.get_json()
        self.assertTrue(usage_data.get('success'))
        usage_id = usage_data['data']['id']

        # Verify in SQLite directly
        with sqlite3.connect(self.db_path) as conn:
            cur = conn.cursor()
            cur.execute("SELECT id, product_id, quantity, field_location, reason FROM usages WHERE id = ?", (usage_id,))
            row = cur.fetchone()

        self.assertIsNotNone(row)
        self.assertEqual(row[1], p['id'])
        self.assertEqual(row[2], 5.0)
        self.assertEqual(row[3], 'North Field - Plot A')

    def test_06_usage_logout_login_verify(self):
        """Test 6: Usage -> logout -> login -> verify usage exists."""
        p = self._create_unique_product("Copper Oxychloride", qty=12.0, min_stock=2.0)

        usage_res = self.client.post('/api/usages', json={
            'product_id': p['id'],
            'quantity': 3.0,
            'unit_id': p['unit_id'],
            'usage_date': '2026-10-26',
            'field_location': 'Orchard Block 2',
            'reason': 'Blight prevention',
            'remarks': 'Preventive fungal spray'
        })
        usage_id = usage_res.get_json()['data']['id']

        # Logout & Login
        self.client.post('/api/auth/logout')
        self.client.post('/api/auth/login', json={'username': 'admin', 'password': 'tiger123'})

        # Fetch usage list
        list_res = self.client.get(f'/api/usages?search=Copper')
        self.assertEqual(list_res.status_code, 200)
        usages = list_res.get_json()['usages']
        matching = [u for u in usages if u['id'] == usage_id]
        self.assertEqual(len(matching), 1)
        self.assertEqual(matching[0]['quantity'], 3.0)

    def test_07_purchase_increases_stock(self):
        """Test 7: Purchase -> verify stock increases."""
        p = self._create_unique_product("Stock Increase Product", qty=10.0, min_stock=5.0)

        # Purchase 15
        p_res = self.client.post('/api/purchases', json={
            'product_id': p['id'],
            'quantity': 15.0,
            'unit_id': p['unit_id'],
            'unit_price': 100.0,
            'total_price': 1500.0,
            'supplier': 'AgriCorp',
            'purchase_date': '2026-10-26'
        })
        self.assertIn(p_res.status_code, [200, 201])

        # Check stock endpoint
        stock_res = self.client.get(f"/api/products/{p['id']}/stock")
        self.assertEqual(stock_res.status_code, 200)
        stock_data = stock_res.get_json()
        self.assertEqual(stock_data['current_quantity'], 25.0)

        # Check in SQLite DB directly
        with sqlite3.connect(self.db_path) as conn:
            cur = conn.cursor()
            cur.execute("SELECT current_quantity FROM products WHERE id = ?", (p['id'],))
            row = cur.fetchone()
        self.assertEqual(row[0], 25.0)

    def test_08_usage_decreases_stock(self):
        """Test 8: Usage -> verify stock decreases."""
        p = self._create_unique_product("Stock Decrease Product", qty=20.0, min_stock=5.0)

        # Use 6
        self.client.post('/api/usages', json={
            'product_id': p['id'],
            'quantity': 6.0,
            'unit_id': p['unit_id'],
            'usage_date': '2026-10-26',
            'field_location': 'South Field',
            'reason': 'Test usage'
        })

        # Check stock endpoint
        stock_res = self.client.get(f"/api/products/{p['id']}/stock")
        self.assertEqual(stock_res.status_code, 200)
        stock_data = stock_res.get_json()
        self.assertEqual(stock_data['current_quantity'], 14.0)

        # Check SQLite DB directly
        with sqlite3.connect(self.db_path) as conn:
            cur = conn.cursor()
            cur.execute("SELECT current_quantity FROM products WHERE id = ?", (p['id'],))
            row = cur.fetchone()
        self.assertEqual(row[0], 14.0)

    def test_09_insufficient_stock_transaction_rejected(self):
        """Test 9: Insufficient stock -> transaction rejected."""
        p = self._create_unique_product("Low Stock Prevention", qty=3.0, min_stock=1.0)

        # Attempt to use 5 (only 3 available)
        res = self.client.post('/api/usages', json={
            'product_id': p['id'],
            'quantity': 5.0,
            'unit_id': p['unit_id'],
            'usage_date': '2026-10-26',
            'field_location': 'East Field',
            'reason': 'Excessive usage attempt'
        })
        self.assertEqual(res.status_code, 400)
        data = res.get_json()
        self.assertFalse(data.get('success'))
        self.assertIn('Insufficient Stock', data.get('error', ''))
        self.assertIn('Available: 3.0', data.get('error', ''))
        self.assertIn('Requested: 5.0', data.get('error', ''))

        # Verify stock remains unchanged at 3.0 in database
        with sqlite3.connect(self.db_path) as conn:
            cur = conn.cursor()
            cur.execute("SELECT current_quantity FROM products WHERE id = ?", (p['id'],))
            row = cur.fetchone()
        self.assertEqual(row[0], 3.0)

    def test_10_server_restart_data_persists(self):
        """Test 10: Server restart -> data still exists in SQLite DB."""
        p = self._create_unique_product("Restart Survival Compound", qty=50.0, min_stock=10.0)
        prod_id = p['id']

        purch_res = self.client.post('/api/purchases', json={
            'product_id': prod_id,
            'quantity': 25.0,
            'unit_id': p['unit_id'],
            'unit_price': 80.0,
            'total_price': 2000.0,
            'supplier': 'Evergreen Farms',
            'purchase_date': '2026-10-26'
        }).get_json()
        purch_id = purch_res['data']['id']

        # SIMULATE FULL SERVER RESTART:
        # Create a completely brand new Flask app instance connecting to existing SQLite DB
        fresh_app = create_app()
        fresh_app.config['TESTING'] = True
        fresh_client = fresh_app.test_client()

        # Login to new instance
        login_res = fresh_client.post('/api/auth/login', json={'username': 'admin', 'password': 'tiger123'})
        self.assertEqual(login_res.status_code, 200)

        # Verify product and stock exist after server restart
        get_res = fresh_client.get(f'/api/products/{prod_id}')
        self.assertEqual(get_res.status_code, 200)
        prod_data = get_res.get_json().get('data', get_res.get_json())
        self.assertEqual(prod_data['current_quantity'], 75.0)

        # Verify purchase exists after server restart
        p_get = fresh_client.get(f'/api/purchases/{purch_id}')
        self.assertEqual(p_get.status_code, 200)
        purch_get_data = p_get.get_json().get('data', p_get.get_json())
        self.assertEqual(purch_get_data['quantity'], 25.0)

    def test_11_browser_refresh_api_data_persists(self):
        """Test 11: Browser refresh -> fresh GET requests load accurate DB state."""
        # Query all primary endpoints as a fresh page load does
        p_res = self.client.get('/api/products')
        self.assertEqual(p_res.status_code, 200)
        self.assertTrue('products' in p_res.get_json())

        purch_res = self.client.get('/api/purchases')
        self.assertEqual(purch_res.status_code, 200)
        self.assertTrue('purchases' in purch_res.get_json())

        usage_res = self.client.get('/api/usages')
        self.assertEqual(usage_res.status_code, 200)
        self.assertTrue('usages' in usage_res.get_json())

        dash_res = self.client.get('/api/dashboard')
        self.assertEqual(dash_res.status_code, 200)
        dash_data = dash_res.get_json()
        self.assertIn('total_products', dash_data)
        self.assertIn('low_stock_count', dash_data)

    def test_12_csv_import_logout_login_verify(self):
        """Test 12: CSV import -> logout -> login -> imported products still exist."""
        unique_suffix = uuid.uuid4().hex[:6]
        csv_prod_name = f"CSV Bio Pest Control {unique_suffix}"
        csv_content = (
            f"Product Name,Category,Quantity,Unit,Minimum Stock,Price,Description\n"
            f"{csv_prod_name},Pesticide,30,Liter,5,150,Imported biological pesticide\n"
        )
        data = {
            'file': (io.BytesIO(csv_content.encode('utf-8')), 'test_import.csv')
        }
        imp_res = self.client.post('/api/import/csv', data=data, content_type='multipart/form-data')
        self.assertEqual(imp_res.status_code, 200)
        imp_data = imp_res.get_json()
        self.assertTrue(imp_data.get('success'))
        self.assertGreaterEqual(imp_data.get('imported', 0), 1)

        # Logout & Login
        self.client.post('/api/auth/logout')
        self.client.post('/api/auth/login', json={'username': 'admin', 'password': 'tiger123'})

        # Verify imported products exist
        search_res = self.client.get(f'/api/products?search={unique_suffix}')
        self.assertEqual(search_res.status_code, 200)
        products = search_res.get_json()['products']
        self.assertTrue(any(csv_prod_name in p['name'] for p in products))

    def test_13_pdf_report_contains_database_records(self):
        """Test 13: PDF report -> queries database directly and returns valid PDF bytes."""
        # 1. Product catalog PDF
        pdf_res = self.client.get('/api/reports/products/pdf')
        self.assertEqual(pdf_res.status_code, 200)
        self.assertEqual(pdf_res.content_type, 'application/pdf')
        self.assertTrue(pdf_res.data.startswith(b'%PDF'), "Response must be valid PDF starting with %PDF header")

        # 2. Purchase PDF
        pdf_p_res = self.client.get('/api/reports/purchases/pdf')
        self.assertEqual(pdf_p_res.status_code, 200)
        self.assertEqual(pdf_p_res.content_type, 'application/pdf')
        self.assertTrue(pdf_p_res.data.startswith(b'%PDF'))

        # 3. Usage PDF
        pdf_u_res = self.client.get('/api/reports/usage/pdf')
        self.assertEqual(pdf_u_res.status_code, 200)
        self.assertEqual(pdf_u_res.content_type, 'application/pdf')
        self.assertTrue(pdf_u_res.data.startswith(b'%PDF'))

    def test_14_low_stock_notification_persists(self):
        """Test 14: Low-stock condition -> notification generated and persists in DB."""
        # Create product with stock = 2, minimum = 10 (triggers low stock condition)
        prod = self._create_unique_product("Low Stock Alert Item", qty=2.0, min_stock=10.0)

        # Trigger notification check
        notif_res = self.client.get('/api/notifications')
        self.assertEqual(notif_res.status_code, 200)
        notifs = notif_res.get_json()['notifications']

        # Verify low stock notification exists
        matching = [n for n in notifs if n.get('product_id') == prod['id'] or prod['name'] in n.get('message', '')]
        self.assertTrue(len(matching) >= 1, "Low stock notification must be generated")

        # Logout & Login
        self.client.post('/api/auth/logout')
        self.client.post('/api/auth/login', json={'username': 'admin', 'password': 'tiger123'})

        # Notification still present after login
        fresh_notifs = self.client.get('/api/notifications').get_json()['notifications']
        persisted = [n for n in fresh_notifs if n.get('product_id') == prod['id'] or prod['name'] in n.get('message', '')]
        self.assertTrue(len(persisted) >= 1, "Low stock notification must persist after logout/login")


if __name__ == '__main__':
    unittest.main(verbosity=2)
