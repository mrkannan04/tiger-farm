import os
import unittest
from datetime import date, timedelta
from backend.app import create_app
from backend.models import db, Product, Purchase, Usage, StockMovement, Notification, Category, Unit
from backend.services.stock_service import check_expiry_notifications

class TigerFarmNewFeaturesTests(unittest.TestCase):
    def setUp(self):
        os.environ['USE_SQLITE'] = '1'
        self.app = create_app()
        self.app.config['TESTING'] = True
        self.client = self.app.test_client()
        self.ctx = self.app.app_context()
        self.ctx.push()

        # Login admin session
        with self.client.session_transaction() as sess:
            sess['user_id'] = 1
            sess['username'] = 'admin'
            sess['role'] = 'admin'

    def tearDown(self):
        self.ctx.pop()

    def test_01_purchase_batch_expiry_and_payment_status(self):
        """Test purchase creation with batch_number, expiry_date, and Pending Credit payment status."""
        prod = Product.query.first()
        self.assertIsNotNone(prod, "Product should exist")

        exp_date = (date.today() + timedelta(days=20)).isoformat()
        due_date = (date.today() + timedelta(days=15)).isoformat()

        res = self.client.post('/api/purchases', json={
            'product_id': prod.id,
            'packaging_type': 'Bag',
            'package_size': 50,
            'package_unit': 'kg',
            'package_count': 2,
            'quantity': 100,
            'unit_price': 600,
            'total_price': 1200,
            'purchase_date': date.today().isoformat(),
            'supplier_name': 'Kisan Agro Test Store',
            'batch_number': 'TEST-BATCH-999',
            'expiry_date': exp_date,
            'payment_status': 'Pending Credit',
            'payment_due_date': due_date,
            'remarks': 'Testing payment credit tracking'
        })
        self.assertEqual(res.status_code, 201)
        data = res.get_json()
        purch_id = data['purchase']['id']

        # Verify fields in database
        purch = Purchase.query.get(purch_id)
        self.assertEqual(purch.batch_number, 'TEST-BATCH-999')
        self.assertEqual(purch.payment_status, 'Pending Credit')
        self.assertIsNotNone(purch.expiry_date)

        # Test Payment status update (Toggle to Paid)
        res_pay = self.client.patch(f'/api/purchases/{purch_id}/payment', json={
            'payment_status': 'Paid'
        })
        self.assertEqual(res_pay.status_code, 200)
        purch = Purchase.query.get(purch_id)
        self.assertEqual(purch.payment_status, 'Paid')

    def test_02_last_purchase_price_endpoint(self):
        """Test GET /api/purchases/last-price returns accurate previous rate."""
        prod = Product.query.first()
        res = self.client.get(f'/api/purchases/last-price?product_id={prod.id}')
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertTrue(data['success'])
        self.assertIsNotNone(data.get('last_price'))

    def test_03_usage_with_crop_season_and_seasons_list(self):
        """Test usage with crop_season and distinct seasons endpoint."""
        prod = Product.query.first()
        # Ensure sufficient stock
        prod.current_quantity += 50
        db.session.commit()

        season_name = 'Tomato Kharif 2026 Special'
        res = self.client.post('/api/usages', json={
            'product_id': prod.id,
            'packaging_type': 'Loose',
            'package_count': 5,
            'quantity': 5,
            'usage_date': date.today().isoformat(),
            'field_location': 'North Plot 4',
            'crop_season': season_name,
            'reason': 'Pest prevention'
        })
        self.assertEqual(res.status_code, 201)
        data = res.get_json()
        self.assertEqual(data['usage']['crop_season'], season_name)

        # Check GET /api/usages/seasons
        res_seasons = self.client.get('/api/usages/seasons')
        self.assertEqual(res_seasons.status_code, 200)
        s_data = res_seasons.get_json()
        self.assertIn(season_name, s_data['seasons'])

    def test_04_stock_adjustment_deduction_and_addition(self):
        """Test stock adjustments for damaged bags and physical count correction."""
        prod = Product.query.first()
        initial_stock = prod.current_quantity

        # 1. Deduction for damage
        res_deduct = self.client.post('/api/stock/adjust', json={
            'product_id': prod.id,
            'adjustment_type': 'deduction',
            'reason': 'Damaged Bag / Torn Packaging',
            'packaging_type': 'Loose',
            'package_count': 3,
            'quantity': 3,
            'adjustment_date': date.today().isoformat(),
            'remarks': 'Mouse bite on bottom corner'
        })
        self.assertEqual(res_deduct.status_code, 201)
        prod = Product.query.get(prod.id)
        self.assertAlmostEqual(prod.current_quantity, initial_stock - 3, places=2)

        # 2. Addition for physical audit correction
        res_add = self.client.post('/api/stock/adjust', json={
            'product_id': prod.id,
            'adjustment_type': 'addition',
            'reason': 'Physical Audit Discrepancy',
            'packaging_type': 'Loose',
            'package_count': 3,
            'quantity': 3,
            'adjustment_date': date.today().isoformat(),
            'remarks': 'Recount surplus adjustment'
        })
        self.assertEqual(res_add.status_code, 201)
        prod = Product.query.get(prod.id)
        self.assertAlmostEqual(prod.current_quantity, initial_stock, places=2)

    def test_05_daily_farm_digest(self):
        """Test GET /api/dashboard/digest generates formatted text summary."""
        res = self.client.get('/api/dashboard/digest')
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertTrue(data['success'])
        self.assertIn('formatted_text', data)
        self.assertIn('TIGER FARM', data['formatted_text'])

    def test_06_expiry_notification_alert(self):
        """Test check_expiry_notifications generates alert for batches expiring <= 30 days."""
        prod = Product.query.first()
        prod.current_quantity = 25
        db.session.commit()

        exp_date = date.today() + timedelta(days=10)
        p = Purchase(
            product_id=prod.id,
            quantity=25,
            unit_id=prod.unit_id,
            purchase_date=date.today(),
            expiry_date=exp_date,
            batch_number='EXP-ALERT-01'
        )
        db.session.add(p)
        db.session.commit()

        check_expiry_notifications()

        notif = Notification.query.filter_by(product_id=prod.id, type='expiry_warning').first()
        self.assertIsNotNone(notif, "Notification should be generated for expiring batch")
        self.assertIn('expires in', notif.message.lower())

if __name__ == '__main__':
    unittest.main()

