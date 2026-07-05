const express = require('express');
const ctrl = require('../controllers/rolesController');
const { requirePermission } = require('../middleware/requirePermission');

// All routes here are already behind `authenticate` (mounted in routes/index.js).
const router = express.Router();
const manageRoles = requirePermission('people.manage_roles');

router.get('/', manageRoles, ctrl.list);
router.post('/', manageRoles, ctrl.create);

module.exports = router;
