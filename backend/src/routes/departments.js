const express = require('express');
const ctrl = require('../controllers/departmentsController');
const { requirePermission } = require('../middleware/requirePermission');

const router = express.Router();

// Any authenticated user can read departments (needed for dropdowns
// throughout the app); only people.manage_departments can mutate.
router.get('/', ctrl.list);
router.get('/:id', ctrl.get);
router.post('/', requirePermission('people.manage_departments'), ctrl.create);
router.patch('/:id', requirePermission('people.manage_departments'), ctrl.update);
router.delete('/:id', requirePermission('people.manage_departments'), ctrl.remove);

module.exports = router;
