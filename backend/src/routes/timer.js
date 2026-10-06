const express = require('express');
const ctrl = require('../controllers/timerController');
const { requirePermission } = require('../middleware/requirePermission');

const router = express.Router();

// The timer exists to produce time entries, so it needs time.log.
router.use(requirePermission('time.log'));

router.get('/', ctrl.get);
router.post('/start', ctrl.start);
router.post('/stop', ctrl.stop);
router.delete('/', ctrl.cancel);

module.exports = router;
