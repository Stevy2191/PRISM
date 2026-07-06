const express = require('express');
const ctrl = require('../controllers/workflowRulesController');
const { requirePermission } = require('../middleware/requirePermission');

const router = express.Router();
const manage = requirePermission('settings.manage_system');

router.get('/', manage, ctrl.list);
router.patch('/reorder', manage, ctrl.reorder); // must precede /:id
router.get('/:id', manage, ctrl.get);
router.post('/', manage, ctrl.create);
router.patch('/:id', manage, ctrl.update);
router.delete('/:id', manage, ctrl.remove);
router.post('/:id/test', manage, ctrl.test);
router.get('/:id/logs', manage, ctrl.logs);

module.exports = router;
