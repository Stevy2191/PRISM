const express = require('express');
const ctrl = require('../controllers/timerController');
const { requirePermission } = require('../middleware/requirePermission');

const router = express.Router();

// Timers exist to produce time entries, so they need time.log.
router.use(requirePermission('time.log'));

router.get('/', ctrl.list);
router.post('/start', ctrl.start);
router.post('/:timerId/stop', ctrl.stop);
router.post('/:timerId/pause', ctrl.pause);
router.post('/:timerId/resume', ctrl.resume);
router.delete('/:timerId', ctrl.cancel);

module.exports = router;
