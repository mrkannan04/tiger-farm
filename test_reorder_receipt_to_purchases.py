import unittest
import os
import json
from datetime import date, datetime

os.environ['USE_SQLITE'] = '1'
os.environ['FLASK_ENV'] = 'testing'

from backend import create_app
from backend.models import db, Product, Category, Unit, Reorder, Purchase, StockMovement


class TestReorderReceiptToPurchases(unittest.TestCase):
    def setUp(self):
        self.app = create_app()
        self.app.config['TESTING'] = True
        self.app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///:memory:'
        self.client = self.app.test_client()

        with self.app.app_context():
            db.create_all()

            # Ensure units exist
            if not Unit.query.filter_by(symbol='L').first():
                db.session.add(Unit(name='Litre', symbol='L', base_unit='L', conversion_factor=1.0))
            if not Unit.query.filter_by(symbol='KG').first():
                db.session.add(Unit(name='Kilogram', symbol='KG', base_unit='kg', conversion_factor=1.0))
            if not Category.query.first():
                db.session.add(Category(name='Bio-Fertilizer', description='Organic'))

            db.session.commit()

        # Login session
        with self.client.session_transaction() as sess:
            sess['user_id'] = 1
            sess['username'] = 'admin'

    def tearDown(self):
        with self.app.app_context():
            db.session.remove()
            db.drop_all()

    def test_liquid_reorder_with_ml_and_price_calc(self):
        """Test reordering a liquid product with ml/L packaging and price calculation."""
        with self.app.app_context():
            l_unit = Unit.query.filter_by(symbol='L').first()
            cat = Category.query.first()
            prod = Product(
                name='Organic Neem Oil Liquid',
                category_id=cat.id,
                unit_id=l_unit.id,
                current_quantity=5.0,
                minimum_stock=10.0,
                product_date=date(2026, 11, 9),
            )
            db.session.add(prod)
            db.session.commit()
            prod_id = prod.id

        # 1. Create a reorder with 500 ml bottles: 10 bottles = 5 L
        # Unit price = 250 per bottle -> Total price = 2500
        reorder_payload = {
            'product_id': prod_id,
            'packaging_type': 'Bottle',
            'package_size': 500,
            'package_unit': 'ml',
            'package_count': 10,
            'unit_price': 250.0,
            'total_price': 2500.0,
            'reorder_date': '2026-11-09',
            'expected_delivery_date': '2026-11-15',
            'supplier_name': 'Kisan Organics Ltd',
            'notes': '500ml liquid neem concentrate for pest management',
        }
        res = self.client.post('/api/reorders', json=reorder_payload)
        self.assertEqual(res.status_code, 201)
        data = res.get_json()
        self.assertTrue(data.get('success'))
        reorder_id = data['reorder']['id']

        self.assertEqual(data['reorder']['packaging_type'], 'Bottle')
        self.assertEqual(data['reorder']['package_size'], 500.0)
        self.assertEqual(data['reorder']['package_unit'], 'ml')
        self.assertEqual(data['reorder']['quantity'], 5.0)  # 10 * 500ml = 5L
        self.assertEqual(data['reorder']['unit_price'], 250.0)
        self.assertEqual(data['reorder']['total_price'], 2500.0)

        # Verify stock is UNCHANGED before receipt
        with self.app.app_context():
            p = Product.query.get(prod_id)
            self.assertEqual(p.current_quantity, 5.0)

        # 2. Receive the reorder with purchase details:
        # Date, invoice, rate, total amount
        receive_payload = {
            'received_quantity': 5.0,
            'purchase_date': '2026-11-10',
            'unit_price': 250.0,
            'total_price': 2500.0,
            'invoice_number': 'INV-NEEM-2026',
            'payment_status': 'Paid',
            'remarks': 'Full shipment verified intact',
        }
        recv_res = self.client.post(f'/api/reorders/{reorder_id}/receive', json=receive_payload)
        self.assertEqual(recv_res.status_code, 200)
        recv_data = recv_res.get_json()
        self.assertTrue(recv_data.get('success'))
        self.assertIn('purchase', recv_data)
        self.assertIsNotNone(recv_data['purchase'])

        # 3. Verify stock increased from 5 to 10 L
        with self.app.app_context():
            p = Product.query.get(prod_id)
            self.assertEqual(p.current_quantity, 10.0)

            # Reorder status is now Received
            ro = Reorder.query.get(reorder_id)
            self.assertEqual(ro.status, 'Received')
            self.assertEqual(ro.received_quantity, 5.0)

            # 4. Verify Purchase record is created in database!
            purchases = Purchase.query.filter_by(product_id=prod_id).all()
            self.assertEqual(len(purchases), 1)
            purch = purchases[0]
            self.assertEqual(purch.quantity, 5.0)
            self.assertEqual(purch.packaging_type, 'Bottle')
            self.assertEqual(purch.package_size, 500.0)
            self.assertEqual(purch.package_unit, 'ml')
            self.assertEqual(purch.unit_price, 250.0)
            self.assertEqual(purch.total_price, 2500.0)
            self.assertEqual(purch.invoice_number, 'INV-NEEM-2026')
            self.assertEqual(purch.supplier_name, 'Kisan Organics Ltd')
            self.assertEqual(purch.status, 'Completed')
            self.assertEqual(purch.purchase_date, date(2026, 11, 10))

        # 5. Verify /api/purchases endpoint lists this purchase!
        purch_res = self.client.get('/api/purchases')
        self.assertEqual(purch_res.status_code, 200)
        purch_data = purch_res.get_json()
        purch_items = purch_data.get('purchases') or purch_data.get('data') or []
        matching = [item for item in purch_items if item.get('product_id') == prod_id]
        self.assertEqual(len(matching), 1)
        self.assertEqual(matching[0]['invoice_number'], 'INV-NEEM-2026')
        self.assertEqual(matching[0]['total_price'], 2500.0)

    def test_partial_reorder_receipts_create_separate_purchases(self):
        """Test partial reorder receipts: each partial receipt creates its own purchase record."""
        with self.app.app_context():
            kg_unit = Unit.query.filter_by(symbol='KG').first()
            cat = Category.query.first()
            prod = Product(
                name='NPK Granular 50kg',
                category_id=cat.id,
                unit_id=kg_unit.id,
                current_quantity=0.0,
                minimum_stock=20.0,
                product_date=date(2026, 11, 9),
            )
            db.session.add(prod)
            db.session.commit()
            prod_id = prod.id

        # Create reorder for 10 bags of 50kg = 500kg @ 1500/bag = 15000 total
        res = self.client.post('/api/reorders', json={
            'product_id': prod_id,
            'packaging_type': 'Bag',
            'package_size': 50,
            'package_unit': 'kg',
            'package_count': 10,
            'unit_price': 1500.0,
            'total_price': 15000.0,
            'reorder_date': '2026-11-09',
            'supplier_name': 'Fertilizer Supply Corp',
        })
        self.assertEqual(res.status_code, 201)
        reorder_id = res.get_json()['reorder']['id']

        # Receipt 1: 4 bags (200kg)
        r1 = self.client.post(f'/api/reorders/{reorder_id}/receive', json={
            'received_quantity': 200.0,
            'purchase_date': '2026-11-10',
            'unit_price': 1500.0,
            'total_price': 6000.0,
            'invoice_number': 'BILL-PART-1',
        })
        self.assertEqual(r1.status_code, 200)

        with self.app.app_context():
            p = Product.query.get(prod_id)
            self.assertEqual(p.current_quantity, 200.0)
            ro = Reorder.query.get(reorder_id)
            self.assertEqual(ro.status, 'Partially Received')
            self.assertEqual(ro.received_quantity, 200.0)
            self.assertEqual(len(p.purchases), 1)

        # Receipt 2: remaining 6 bags (300kg)
        r2 = self.client.post(f'/api/reorders/{reorder_id}/receive', json={
            'received_quantity': 300.0,
            'purchase_date': '2026-11-12',
            'unit_price': 1500.0,
            'total_price': 9000.0,
            'invoice_number': 'BILL-PART-2',
        })
        self.assertEqual(r2.status_code, 200)

        with self.app.app_context():
            p = Product.query.get(prod_id)
            self.assertEqual(p.current_quantity, 500.0)
            ro = Reorder.query.get(reorder_id)
            self.assertEqual(ro.status, 'Received')
            self.assertEqual(ro.received_quantity, 500.0)
            # Both partial receipts created distinct Purchase entries!
            self.assertEqual(len(p.purchases), 2)
            self.assertEqual(p.total_purchased, 500.0)
            self.assertEqual(p.total_purchase_cost, 15000.0)


if __name__ == '__main__':
    unittest.main()
