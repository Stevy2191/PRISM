const express = require('express');
const ctrl = require('../controllers/permissionsController');
const { requirePermission } = require('../middleware/requirePermission');

// All routes here are already behind `authenticate` (mounted in routes/index.js).
const router = express.Router();

router.get('/', requirePermission('people.manage_roles', 'people.manage_permission_overrides'), ctrl.list);

module.exports = router;
