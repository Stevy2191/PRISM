const express = require('express');
const { projectStatuses: ctrl } = require('../controllers/statusesController');
const { requirePermission } = require('../middleware/requirePermission');

const router = express.Router();
const manageStatuses = requirePermission('settings.manage_statuses');

router.get('/', ctrl.list);
router.post('/', manageStatuses, ctrl.create);
router.put('/reorder', manageStatuses, ctrl.reorder);
router.patch('/:id', manageStatuses, ctrl.update);
router.delete('/:id', manageStatuses, ctrl.remove);

module.exports = router;
