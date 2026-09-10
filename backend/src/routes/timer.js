const express = require('express');
const ctrl = require('../controllers/timerController');
const { requirePermission } = require('../middleware/requirePermission');

const router = express.Router();

// The timer exists to produce time entries, so it requires the same
// permission as logging time directly.
router.use(requirePermission('projects.log_time'));

router.get('/', ctrl.get);
router.post('/start', ctrl.start);
router.post('/stop', ctrl.stop);
router.delete('/', ctrl.cancel);

module.exports = router;
