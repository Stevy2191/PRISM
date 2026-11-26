const express = require('express');
const ctrl = require('../controllers/timesheetsController');
const { requirePermission } = require('../middleware/requirePermission');

// Timesheets (Phase 3): not behind the Customer billing switch.
const router = express.Router();
const canApprove = requirePermission('money.timesheets.approve');
router.get('/mine', requirePermission('time.log'), ctrl.mine);
router.post('/mine/submit', requirePermission('time.log'), ctrl.submit);
router.get('/pending', canApprove, ctrl.pending);
router.post('/:id/approve', canApprove, ctrl.approve);
router.post('/:id/reject', canApprove, ctrl.reject);

module.exports = router;
