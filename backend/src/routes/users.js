const express = require('express');
const ctrl = require('../controllers/usersController');
const access = require('../controllers/userAccessController');
const { requireRole } = require('../middleware/role');
const { requirePermission } = require('../middleware/requirePermission');

// All routes here are already behind `authenticate` (mounted in routes/index.js).
const router = express.Router();

const manageRoles = requirePermission('people.manage_roles');
const manageOverrides = requirePermission('people.manage_permission_overrides');
const viewAccess = requirePermission('people.manage_roles', 'people.manage_permission_overrides', 'people.edit_users');

router.get('/', requirePermission('people.view_own_department', 'people.view_all'), ctrl.list);
router.post('/', requirePermission('people.create_users'), ctrl.create); // create local account
router.get('/assignable', ctrl.listAssignable); // must precede /:id
router.get('/directory', ctrl.listDirectory); // must precede /:id
router.get('/:id', ctrl.get); // self-or-admin enforced in controller
router.patch('/:id', ctrl.update); // self (profile fields) or people.edit_users (everything) — enforced in controller
router.patch('/:id/preferences', ctrl.updatePreferences); // self-or-admin enforced in controller
router.delete('/:id', requireRole('admin'), ctrl.remove);

// Roles & Permissions tab
router.get('/:id/roles', manageRoles, access.listRoles);
router.post('/:id/roles', manageRoles, access.assignRole);
router.delete('/:id/roles/:roleId', manageRoles, access.removeRole);
router.get('/:id/overrides', manageOverrides, access.listOverrides);
router.post('/:id/overrides', manageOverrides, access.createOverride);
router.delete('/:id/overrides/:overrideId', manageOverrides, access.revokeOverride);
router.get('/:id/permissions', viewAccess, access.getEffectivePermissions);

module.exports = router;
