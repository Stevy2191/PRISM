const express = require('express');
const ctrl = require('../controllers/timerController');
const { requireRole } = require('../middleware/role');

const router = express.Router();

// Time logging is staff-only, so the timer is too.
router.use(requireRole('admin', 'technician'));

router.get('/', ctrl.get);
router.post('/start', ctrl.start);
router.post('/stop', ctrl.stop);
router.delete('/', ctrl.cancel);

module.exports = router;
