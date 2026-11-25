const express = require('express');
const settings = require('../controllers/money/settingsController');
const tax = require('../controllers/money/taxController');
const products = require('../controllers/money/catalogController');
const { requirePermission } = require('../middleware/requirePermission');

// Money (Phase 3). Each route names the permission it needs; customer
// billing routes (later steps) also sit behind requireCustomerBilling.
const router = express.Router();

router.get('/config', settings.config);
router.get('/settings', requirePermission('money.settings'), settings.get);
router.put('/settings', requirePermission('money.settings'), settings.update);
router.get('/rates', requirePermission('money.rates.manage'), settings.getRates);
router.put('/rates', requirePermission('money.rates.manage'), settings.rates);

const canSettings = requirePermission('money.settings');
router.get('/tax-rates', canSettings, tax.listRates);
router.post('/tax-rates', canSettings, tax.createRate);
router.patch('/tax-rates/:id', canSettings, tax.updateRate);
router.get('/tax-categories', requirePermission('money.settings', 'money.rates.manage'), tax.listCategories);
router.post('/tax-categories', canSettings, tax.createCategory);
router.patch('/tax-categories/:id', canSettings, tax.updateCategory);

router.get('/products', requirePermission('money.billing.view', 'money.purchasing.manage', 'money.rates.manage'), products.list);
router.post('/products', requirePermission('money.rates.manage'), products.create);
router.patch('/products/:id', requirePermission('money.rates.manage'), products.update);

module.exports = router;
