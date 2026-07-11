const express = require('express');
const ctrl = require('../controllers/slaPoliciesController');
const { requirePermission } = require('../middleware/requirePermission');

const router = express.Router();
const manage = requirePermission('settings.manage_system');

router.get('/', manage, ctrl.list);
router.patch('/:priority', manage, ctrl.update);

module.exports = router;
