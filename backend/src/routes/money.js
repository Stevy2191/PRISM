const express = require('express');
const settings = require('../controllers/money/settingsController');
const tax = require('../controllers/money/taxController');
const products = require('../controllers/money/catalogController');
const billsCtrl = require('../controllers/money/billsController');
const stockCtrl = require('../controllers/money/stockController');
const poCtrl = require('../controllers/money/purchaseOrdersController');
const expensesCtrl = require('../controllers/money/expensesController');
const payablesReports = require('../controllers/money/payablesReportsController');
const { billUpload, receiptUpload, verifyFileSignature, scanUpload } = require('../middleware/upload');
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

// Bills (step 2): contractors' and suppliers' bills.
const canBills = requirePermission('money.bills.manage');
router.get('/bills', canBills, billsCtrl.list);
router.post('/bills', canBills, billsCtrl.create);
router.get('/bills/:id', canBills, billsCtrl.get);
router.patch('/bills/:id', canBills, billsCtrl.update);
router.post('/bills/:id/enter', canBills, billsCtrl.enter);
router.post('/bills/:id/pay', canBills, billsCtrl.pay);
router.post('/bills/:id/void', canBills, billsCtrl.voidIt);
router.post('/bills/:id/file', canBills, billUpload.single('file'), verifyFileSignature, scanUpload('Bill'), billsCtrl.uploadFile);
router.get('/bills/:id/file', canBills, billsCtrl.downloadFile);

// Expenses (step 2): paid directly, with the receipt.
router.get('/expenses', canBills, expensesCtrl.list);
router.post('/expenses', canBills, expensesCtrl.create);
router.get('/expenses/:id', canBills, expensesCtrl.get);
router.patch('/expenses/:id', canBills, expensesCtrl.update);
router.post('/expenses/:id/void', canBills, expensesCtrl.voidIt);
router.post('/expenses/:id/receipt', canBills, receiptUpload.single('file'), verifyFileSignature, scanUpload('Expense'), expensesCtrl.uploadReceipt);
router.get('/expenses/:id/receipt', canBills, expensesCtrl.downloadReceipt);

// Shelf stock (step 2).
const canBuy = requirePermission('money.purchasing.manage');
router.get('/stock', canBuy, stockCtrl.list);
router.get('/stock/:productId/movements', canBuy, stockCtrl.movements);
router.post('/stock/:productId/adjust', canBuy, stockCtrl.adjust);
router.patch('/stock/:productId', canBuy, stockCtrl.update);

// Purchase orders (step 2).
router.get('/purchase-orders', canBuy, poCtrl.list);
router.post('/purchase-orders', canBuy, poCtrl.create);
router.get('/purchase-orders/:id', canBuy, poCtrl.get);
router.post('/purchase-orders/:id/order', canBuy, poCtrl.order);
router.post('/purchase-orders/:id/cancel', canBuy, poCtrl.cancel);
router.post('/purchase-orders/:id/receive', canBuy, poCtrl.receive);

// Contractor and supplier reports (step 2).
const canPayablesReports = requirePermission('money.bills.manage', 'money.books.view');
router.get('/reports/paid-by-vendor', canPayablesReports, payablesReports.paid);
router.get('/reports/1099', canPayablesReports, payablesReports.form1099);
router.get('/reports/open-bills', canPayablesReports, payablesReports.openBills);

module.exports = router;
