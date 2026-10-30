import os
import unittest

os.environ['USE_SQLITE'] = '1'

from backend.app import create_app
from backend.models import db, Product, ProductPackageStock, PackageMaster
from backend.services.stock_service import record_purchase, record_usage


class UnitPackageOpeningStockTests(unittest.TestCase):
    def setUp(self):
        self.app = create_app()
        self.app_context = self.app.app_context()
        self.app_context.push()
        self.client = self.app.test_client()

        # Login admin session
        with self.client.session_transaction() as sess:
            sess['user_id'] = 1
            sess['username'] = 'admin'
            sess['role'] = 'admin'

        # Clean any test products
        for p in Product.query.filter(Product.name.like('UREA_%')).all():
            db.session.delete(p)
        db.session.commit()

    def tearDown(self):
        for p in Product.query.filter(Product.name.like('UREA_%')).all():
            db.session.delete(p)
        db.session.commit()
        self.app_context.pop()

    def test_section_8_and_18_opening_stock_bag_plus_loose(self):
        """
        Sections 6-9, 18:
        Product: UREA_TEST
        Package: 25 kg Bag
        Bag Quantity: 1
        Loose Quantity: 5 kg
        Calculation: 1 x 25 kg = 25 kg + 5 kg Loose = 30 kg
        """
        res = self.client.post('/api/products', json={
            'name': 'UREA_TEST_OPENING',
            'category_id': 1,
            'default_packaging_type': 'Bag',
            'default_package_size': 25.0,
            'default_package_unit': 'kg',
            'default_package_count': 1.0,
            'bag_quantity': 1.0,
            'loose_quantity': 5.0,
            'minimum_stock': 5.0,
        })
        self.assertEqual(res.status_code, 201)
        data = res.get_json()
        p_id = data['product']['id']

        prod = Product.query.get(p_id)
        self.assertEqual(prod.current_quantity, 30.0)
        self.assertEqual(prod.bag_stock, 1.0)
        self.assertEqual(prod.loose_stock, 5.0)

        summary = prod.get_stock_summary()
        # Should have 25 kg Bag (1 Bag = 25 kg) and Loose KG (5 kg)
        self.assertEqual(len(summary), 2)
        bag_row = next(r for r in summary if not r['is_loose'])
        loose_row = next(r for r in summary if r['is_loose'])

        self.assertEqual(bag_row['quantity'], '1 Bag')
        self.assertEqual(bag_row['total_kg'], 25.0)
        self.assertEqual(loose_row['quantity'], '5 kg')
        self.assertEqual(loose_row['total_kg'], 5.0)

    def test_section_11_multiple_package_sizes_and_loose(self):
        """
        Section 11:
        50 kg Bags: 2 = 100 kg
        25 kg Bags: 3 = 75 kg
        10 kg Bags: 2 = 20 kg
        Loose: 5 kg
        Total: 200 kg
        """
        # Create product with initial 50 kg Bag (2 bags)
        res = self.client.post('/api/products', json={
            'name': 'UREA_MULTI_PKG',
            'category_id': 1,
            'default_packaging_type': 'Bag',
            'default_package_size': 50.0,
            'default_package_unit': 'kg',
            'bag_quantity': 2.0,
            'loose_quantity': 5.0, # 5 kg loose
            'minimum_stock': 10.0,
        })
        self.assertEqual(res.status_code, 201)
        p_id = res.get_json()['product']['id']

        # Add 3 bags of 25 kg Bag
        p1, err = record_purchase(
            product_id=p_id,
            packaging_type='Bag',
            package_size=25.0,
            package_unit='kg',
            package_count=3.0,
        )
        self.assertIsNone(err)

        # Add 2 bags of 10 kg Bag
        p2, err = record_purchase(
            product_id=p_id,
            packaging_type='Bag',
            package_size=10.0,
            package_unit='kg',
            package_count=2.0,
        )
        self.assertIsNone(err)

        prod = Product.query.get(p_id)
        # Total: 100 + 75 + 20 + 5 = 200 kg
        self.assertEqual(prod.current_quantity, 200.0)

        summary = prod.get_stock_summary()
        self.assertEqual(len(summary), 4)

        # Verify discrete package stocks
        summary_dict = {r['stock_type']: r for r in summary}
        self.assertIn('50 kg Bag', summary_dict)
        self.assertEqual(summary_dict['50 kg Bag']['quantity'], '2 Bags')
        self.assertEqual(summary_dict['50 kg Bag']['total_kg'], 100.0)

        self.assertIn('25 kg Bag', summary_dict)
        self.assertEqual(summary_dict['25 kg Bag']['quantity'], '3 Bags')
        self.assertEqual(summary_dict['25 kg Bag']['total_kg'], 75.0)

        self.assertIn('10 kg Bag', summary_dict)
        self.assertEqual(summary_dict['10 kg Bag']['quantity'], '2 Bags')
        self.assertEqual(summary_dict['10 kg Bag']['total_kg'], 20.0)

        self.assertIn('Loose', summary_dict)
        self.assertEqual(summary_dict['Loose']['quantity'], '5 kg')
        self.assertEqual(summary_dict['Loose']['total_kg'], 5.0)

    def test_section_15_and_16_usage_and_loose_usage(self):
        """
        Section 15 & 16:
        Before: 25 kg Bag: 4 Bags = 100 kg, Loose: 5 kg = 105 kg
        Use 1 Bag -> Remaining: 3 Bags = 75 kg
        Use 3 kg Loose -> Remaining Loose: 2 kg
        Total: 77 kg
        """
        res = self.client.post('/api/products', json={
            'name': 'UREA_USAGE_TEST',
            'category_id': 1,
            'default_packaging_type': 'Bag',
            'default_package_size': 25.0,
            'default_package_unit': 'kg',
            'bag_quantity': 4.0,
            'loose_quantity': 5.0,
        })
        self.assertEqual(res.status_code, 201)
        p_id = res.get_json()['product']['id']

        # 1. Use 1 bag of 25 kg
        u1, err = record_usage(
            product_id=p_id,
            packaging_type='Bag',
            package_size=25.0,
            package_unit='kg',
            package_count=1.0,
        )
        self.assertIsNone(err)

        prod = Product.query.get(p_id)
        self.assertEqual(prod.current_quantity, 80.0)
        self.assertEqual(prod.bag_stock, 3.0)
        self.assertEqual(prod.loose_stock, 5.0)

        # 2. Use 3 kg loose (Section 16: Loose Usage)
        u2, err = record_usage(
            product_id=p_id,
            packaging_type='Loose',
            package_size=1.0,
            package_unit='kg',
            package_count=3.0,
        )
        self.assertIsNone(err)

        prod = Product.query.get(p_id)
        self.assertEqual(prod.current_quantity, 77.0)
        self.assertEqual(prod.bag_stock, 3.0)
        self.assertEqual(prod.loose_stock, 2.0)

        # 3. Attempt to use 5 kg loose when only 2 kg available -> REJECT
        u3, err = record_usage(
            product_id=p_id,
            packaging_type='Loose',
            package_size=1.0,
            package_unit='kg',
            package_count=5.0,
        )
        self.assertIsNotNone(err)
        self.assertIn('Insufficient', err)


    def test_add_direct_kg_and_edit_category_unit_quantity(self):
        """
        User issue:
        1. In Add Product, select direct KG: enter quantity directly without bags.
        2. In Edit Product, user can change Category, Unit/Package, and Quantity.
        """
        # 1. Add product with direct KG
        res = self.client.post('/api/products', json={
            'name': 'UREA_DIRECT_KG',
            'category_id': 1,
            'unit_package': 'gen_kg',
            'default_packaging_type': 'Unit',
            'default_package_size': 1.0,
            'default_package_unit': 'kg',
            'bag_quantity': 50.0,  # Single direct quantity
            'loose_quantity': 0.0,
            'current_quantity': 50.0,
            'minimum_stock': 10.0,
        })
        self.assertEqual(res.status_code, 201)
        p_id = res.get_json()['product']['id']

        prod = Product.query.get(p_id)
        self.assertEqual(prod.current_quantity, 50.0)
        self.assertEqual(prod.category_id, 1)

        # 2. Edit product: Change Category (to 2), Change Packaging to 25 kg Bag, Change Quantity to 75 kg (3 bags)
        res_edit = self.client.put(f'/api/products/{p_id}', json={
            'name': 'UREA_DIRECT_KG',
            'category_id': 2,
            'default_packaging_type': 'Bag',
            'default_package_size': 25.0,
            'default_package_unit': 'kg',
            'default_package_count': 3.0,
            'bag_quantity': 3.0,
            'loose_quantity': 0.0,
            'current_quantity': 75.0,
            'minimum_stock': 15.0,
        })
        self.assertEqual(res_edit.status_code, 200)

        # Verify database record updated
        prod_updated = Product.query.get(p_id)
        self.assertEqual(prod_updated.category_id, 2)
        self.assertEqual(prod_updated.default_packaging_type, 'Bag')
        self.assertEqual(prod_updated.default_package_size, 25.0)
        self.assertEqual(prod_updated.current_quantity, 75.0)
        self.assertEqual(prod_updated.bag_stock, 3.0)

        # Verify ledger has adjustment record
        last_mov = prod_updated.stock_movements[0]
        self.assertEqual(last_mov.movement_type, 'ADJUSTMENT')
        self.assertEqual(last_mov.quantity, 25.0)  # 50 -> 75


if __name__ == '__main__':
    unittest.main()
