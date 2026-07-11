const express = require('express');
const ctrl = require('../controllers/schedulesController');
const { requirePermission } = require('../middleware/requirePermission');

const router = express.Router();
const manage = requirePermission('settings.manage_system');

router.get('/', manage, ctrl.list);

module.exports = router;
