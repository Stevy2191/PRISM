const express = require('express');
const ctrl = require('../controllers/rolesController');
const { requirePermission } = require('../middleware/requirePermission');

// All routes here are already behind `authenticate` (mounted in routes/index.js).
const router = express.Router();

const companyAccess = require('../controllers/companyAccessController');
const manageCompanyAccess = requirePermission('companies.manage_access');
router.get('/:id/company-access', manageCompanyAccess, companyAccess.getRoleAccess);
router.put('/:id/company-access', manageCompanyAccess, companyAccess.putRoleAccess);
const manageRoles = requirePermission('people.manage_roles');

router.get('/', manageRoles, ctrl.list);
router.post('/', manageRoles, ctrl.create);
router.get('/:id', manageRoles, ctrl.get);
router.patch('/:id', manageRoles, ctrl.update);
router.delete('/:id', manageRoles, ctrl.remove);
router.post('/:id/permissions', manageRoles, ctrl.setPermissions);
router.patch('/:id/permissions/:permissionKey', manageRoles, ctrl.togglePermission);

module.exports = router;
