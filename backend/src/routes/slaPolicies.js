const express = require('express');
const ctrl = require('../controllers/slaPoliciesController');
const { requirePermission } = require('../middleware/requirePermission');

const router = express.Router();
const manage = requirePermission('settings.manage_system');

router.get('/', manage, ctrl.list);
router.post('/', manage, ctrl.create);
router.get('/:id', manage, ctrl.get);
router.patch('/:id', manage, ctrl.update);
router.delete('/:id', manage, ctrl.remove);
router.post('/:id/default', manage, ctrl.setDefault);

module.exports = router;
