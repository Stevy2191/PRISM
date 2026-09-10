const express = require('express');
const ctrl = require('../controllers/blueprintsController');
const { requirePermission } = require('../middleware/requirePermission');

const router = express.Router();

const canManage = requirePermission('projects.create');

// Anyone who can view projects may read/use blueprints; managing them
// requires the same permission as creating a project from one.
router.get('/', ctrl.list);
router.get('/:id', ctrl.get);
router.post('/', canManage, ctrl.create);
router.patch('/:id', canManage, ctrl.update);
router.delete('/:id', canManage, ctrl.remove);

module.exports = router;
