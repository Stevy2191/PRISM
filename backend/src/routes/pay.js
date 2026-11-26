const express = require('express');
const ctrl = require('../controllers/money/payLinkController');
const { requireCustomerBilling } = require('../middleware/customerBilling');
const { payLimiter } = require('../middleware/rateLimit');

// The pay link (Phase 3): fully public, no PRISM login. The token is the
// key; it opens one invoice. Hidden while Customer billing is off.
const router = express.Router();
router.use(requireCustomerBilling, payLimiter);
router.get('/:token', ctrl.show);
router.get('/:token/pdf', ctrl.pdf);
router.post('/:token/checkout', ctrl.checkout);

module.exports = router;
