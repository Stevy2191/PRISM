const express = require('express');
const { ticketStatuses: ctrl } = require('../controllers/statusesController');
const { requireRole } = require('../middleware/role');

const router = express.Router();

router.get('/', ctrl.list);
router.post('/', requireRole('admin'), ctrl.create);
router.put('/reorder', requireRole('admin'), ctrl.reorder);
router.patch('/:id', requireRole('admin'), ctrl.update);
router.delete('/:id', requireRole('admin'), ctrl.remove);

module.exports = router;
