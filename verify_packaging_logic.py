import os
import sys
os.environ['USE_SQLITE'] = '1'
os.environ.pop('DATABASE_URL', None)
os.environ.pop('POSTGRES_URL', None)

import unittest
from datetime import date
from backend import create_app
from backend.database import db
from backend.models import Product, PackageMaster, ProductPackageStock, Purchase, Usage, Category, Unit, StockMovement
from backend.services.stock_service import record_purchase, record_usage

class TestPackagingLogic(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = create_app()
        cls.app.config['TESTING'] = True
        cls.ctx = cls.app.app_context()
        cls.ctx.push()
        from backend.database import init_db
        init_db(cls.app)

    @classmethod
    def tearDownClass(cls):
        cls.ctx.pop()

    def test_package_master_contains_no_product_names(self):
        """Package/Unit Master must only contain reusable package sizes and units, NO product names."""
        packages = PackageMaster.query.all()
        self.assertGreater(len(packages), 0, "Package Master should have seeded packages")
        
        forbidden_words = ['urea', 'dap', 'potash', 'borax', 'copper', 'zinc', 'manganese', 'neem', 'gypsum']
        for p in packages:
            label_lower = p.label.lower()
            pkg_type_lower = p.packaging_type.lower()
            for fw in forbidden_words:
                self.assertNotIn(fw, label_lower, f"Package label '{p.label}' should not contain product name '{fw}'")
                self.assertNotIn(fw, pkg_type_lower, f"Package type '{p.packaging_type}' should not contain product name '{fw}'")

    def test_standard_reusable_packages_exist(self):
        """Check all required standard package sizes exist in PackageMaster."""
        expected_weights = [(250.0, 'g'), (500.0, 'g'), (1.0, 'kg'), (2.0, 'kg'), (2.5, 'kg'), (5.0, 'kg'), (10.0, 'kg'), (25.0, 'kg'), (45.0, 'kg'), (50.0, 'kg')]
        bag_sizes_units = {(p.package_size, p.unit_symbol.lower()) for p in PackageMaster.query.filter_by(packaging_type='Bag').all()}
        for size, unit in expected_weights:
            self.assertIn((size, unit.lower()), bag_sizes_units, f"Expected Bag ({size} {unit}) not found in Package Master")

        expected_liquids = [(250.0, 'ml'), (500.0, 'ml'), (1.0, 'l'), (2.0, 'l'), (3.0, 'l'), (4.0, 'l'), (5.0, 'l'), (10.0, 'l')]
        bottle_sizes_units = {(p.package_size, p.unit_symbol.lower()) for p in PackageMaster.query.filter_by(packaging_type='Bottle').all()}
        for size, unit in expected_liquids:
            self.assertIn((size, unit.lower()), bottle_sizes_units, f"Expected Bottle ({size} {unit}) not found in Package Master")

    def test_user_examples_purchases_and_stock(self):
        """
        Verify the exact examples from the user specification:
        Example 1: UREA -> Bag -> 50 kg -> 5 Bags = 250 kg
        Example 2: UREA -> Bag -> 25 kg -> 3 Bags = 75 kg
        Example 3: Liquid Urea -> Bottle -> 1 L -> 10 Bottles = 10 L
        Example 4: Liquid Urea -> Bottle -> 2 L -> 5 Bottles = 10 L
        Example 5: UREA -> Loose -> KG -> 7 kg = 7 kg Loose
        """
        # Find or create UREA product
        urea = Product.query.filter(db.func.lower(Product.name) == 'urea', Product.is_active == True).first()
        self.assertIsNotNone(urea, "UREA product must exist in database")
        
        initial_urea_qty = urea.current_quantity
        
        # Example 1: 5 Bags × 50 kg = 250 kg
        p1, err1 = record_purchase(
            product_id=urea.id,
            purchase_date=date.today(),
            unit_price=10.0,
            packaging_type='Bag',
            package_size=50.0,
            package_unit='kg',
            package_count=5.0
        )
        self.assertIsNone(err1)
        self.assertIsNotNone(p1)
        self.assertEqual(p1.quantity, 250.0)
        self.assertIn("5 bags × 50 kg = 250 kg", p1.package_summary.lower().replace('kg', 'kg'))

        # Example 2: 3 Bags × 25 kg = 75 kg
        p2, err2 = record_purchase(
            product_id=urea.id,
            purchase_date=date.today(),
            unit_price=12.0,
            packaging_type='Bag',
            package_size=25.0,
            package_unit='kg',
            package_count=3.0
        )
        self.assertIsNone(err2)
        self.assertEqual(p2.quantity, 75.0)
        self.assertIn("3 bags × 25 kg = 75 kg", p2.package_summary.lower())

        # Example 5: 7 kg Loose
        p5, err5 = record_purchase(
            product_id=urea.id,
            purchase_date=date.today(),
            unit_price=15.0,
            packaging_type='Loose',
            package_size=1.0,
            package_unit='kg',
            package_count=7.0
        )
        self.assertIsNone(err5)
        self.assertEqual(p5.quantity, 7.0)
        self.assertIn("7 kg loose", p5.package_summary.lower())

        # Check total UREA quantity added: 250 + 75 + 7 = 332 kg
        db.session.refresh(urea)
        self.assertAlmostEqual(urea.current_quantity, initial_urea_qty + 332.0, places=2)

        # Verify package breakdown for UREA
        urea_dict = urea.to_dict()
        breakdown = {f"{pb['packaging_type']}_{pb['size_display']}": pb['package_count'] for pb in urea_dict['package_breakdown']}
        self.assertGreaterEqual(breakdown.get('Bag_50', 0), 5.0)
        self.assertGreaterEqual(breakdown.get('Bag_25', 0), 3.0)
        self.assertGreaterEqual(breakdown.get('Loose_1', 0), 7.0)

        # Find or create Liquid Urea product
        liquid_urea = Product.query.filter(db.func.lower(Product.name) == 'liquid urea', Product.is_active == True).first()
        self.assertIsNotNone(liquid_urea, "Liquid Urea product must exist in database")
        initial_liq_qty = liquid_urea.current_quantity

        # Example 3: 10 Bottles × 1 L = 10 L
        p3, err3 = record_purchase(
            product_id=liquid_urea.id,
            purchase_date=date.today(),
            unit_price=150.0,
            packaging_type='Bottle',
            package_size=1.0,
            package_unit='L',
            package_count=10.0
        )
        self.assertIsNone(err3)
        self.assertEqual(p3.quantity, 10.0)
        self.assertIn("10 bottles × 1 l = 10 l", p3.package_summary.lower())

        # Example 4: 5 Bottles × 2 L = 10 L
        p4, err4 = record_purchase(
            product_id=liquid_urea.id,
            purchase_date=date.today(),
            unit_price=280.0,
            packaging_type='Bottle',
            package_size=2.0,
            package_unit='L',
            package_count=5.0
        )
        self.assertIsNone(err4)
        self.assertEqual(p4.quantity, 10.0)
        self.assertIn("5 bottles × 2 l = 10 l", p4.package_summary.lower())

        db.session.refresh(liquid_urea)
        self.assertAlmostEqual(liquid_urea.current_quantity, initial_liq_qty + 20.0, places=2)

        # Liquid Urea package breakdown: 10 of 1 L bottles, 5 of 2 L bottles
        liq_dict = liquid_urea.to_dict()
        liq_breakdown = {f"{pb['packaging_type']}_{pb['size_display']}": pb['package_count'] for pb in liq_dict['package_breakdown']}
        self.assertGreaterEqual(liq_breakdown.get('Bottle_1', 0), 10.0)
        self.assertGreaterEqual(liq_breakdown.get('Bottle_2', 0), 5.0)

    def test_usage_deduction_by_package(self):
        """Verify using packages deducts from specific package stock and total product stock."""
        urea = Product.query.filter(db.func.lower(Product.name) == 'urea', Product.is_active == True).first()
        
        # Ensure sufficient stock by adding 4 Bags of 50 kg
        p, _ = record_purchase(
            product_id=urea.id,
            unit_price=10.0,
            packaging_type='Bag',
            package_size=50.0,
            package_unit='kg',
            package_count=4.0
        )
        db.session.refresh(urea)
        initial_qty = urea.current_quantity

        # Record usage: 2 Bags of 50 kg = 100 kg
        u1, err = record_usage(
            product_id=urea.id,
            usage_date=date.today(),
            packaging_type='Bag',
            package_size=50.0,
            package_unit='kg',
            package_count=2.0,
            field_location='Plot A - North',
            reason='Fertilizing'
        )
        self.assertIsNone(err)
        self.assertEqual(u1.quantity, 100.0)
        self.assertIn("2 bags × 50 kg = 100 kg", u1.package_summary.lower())

        db.session.refresh(urea)
        self.assertAlmostEqual(urea.current_quantity, initial_qty - 100.0, places=2)

if __name__ == '__main__':
    unittest.main()
