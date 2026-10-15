const express = require('express');
const ctrl = require('../controllers/recurringTicketsController');
const { requirePermission } = require('../middleware/requirePermission');

const router = express.Router();
router.use(requirePermission('tickets.recurring.manage'));

router.get('/', ctrl.list);
router.post('/', ctrl.create);
router.post('/preview', ctrl.preview); // before /:id
router.get('/:id', ctrl.get);
router.patch('/:id', ctrl.update);
router.delete('/:id', ctrl.remove);
router.post('/:id/run', ctrl.runNow);

module.exports = router;
