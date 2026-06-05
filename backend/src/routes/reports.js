const express = require('express');
const ctrl = require('../controllers/reportsController');
const { requireRole } = require('../middleware/role');

const router = express.Router();

// Reports are staff-only.
router.use(requireRole('admin', 'technician'));

router.get('/tickets', ctrl.tickets);
router.get('/time', ctrl.time);

module.exports = router;
