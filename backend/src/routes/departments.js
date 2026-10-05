const express = require('express');
const ctrl = require('../controllers/departmentsController');
const { requirePermission } = require('../middleware/requirePermission');

const router = express.Router();

// Any authenticated user can read departments in companies they can reach
// (needed for dropdowns throughout the app). Mutations need
// people.manage_departments for the internal company's departments or
// companies.manage for a client's — the gate admits either; the controller
// decides which one applies.
const canManage = requirePermission('people.manage_departments', 'companies.manage');
router.get('/', ctrl.list);
// Before '/:id': the internal "owned by" departments for project creators.
router.get('/owners', requirePermission('projects.create'), ctrl.owners);
router.get('/:id', ctrl.get);
router.post('/', canManage, ctrl.create);
router.patch('/:id', canManage, ctrl.update);
router.delete('/:id', canManage, ctrl.remove);

module.exports = router;
