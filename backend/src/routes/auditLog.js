const express = require('express');
const ctrl = require('../controllers/auditLogController');
const { requirePermission } = require('../middleware/requirePermission');

// Already behind `authenticate` (mounted in routes/index.js).
const router = express.Router();

router.get('/', requirePermission('settings.view_audit_log'), ctrl.list);

module.exports = router;
