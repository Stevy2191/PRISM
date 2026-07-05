const express = require('express');
const ctrl = require('../controllers/reportsController');
const { requirePermission } = require('../middleware/requirePermission');

const router = express.Router();

// requires reports.view_own minimum (any tier passes the route guard).
router.use(requirePermission('reports.view_own', 'reports.view_department', 'reports.view_all'));

router.get('/tickets', ctrl.tickets);
router.get('/time', ctrl.time);
router.get('/csat', ctrl.csat);

module.exports = router;
