const express = require('express');
const settings = require('../controllers/money/settingsController');
const { requirePermission } = require('../middleware/requirePermission');

// Money (Phase 3). Each route names the permission it needs; customer
// billing routes (later steps) also sit behind requireCustomerBilling.
const router = express.Router();

router.get('/config', settings.config);
router.get('/settings', requirePermission('money.settings'), settings.get);
router.put('/settings', requirePermission('money.settings'), settings.update);
router.put('/rates', requirePermission('money.rates.manage'), settings.rates);

module.exports = router;
