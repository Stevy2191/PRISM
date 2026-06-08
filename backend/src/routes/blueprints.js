const express = require('express');
const ctrl = require('../controllers/blueprintsController');
const { requireRole } = require('../middleware/role');

const router = express.Router();

const staff = requireRole('admin', 'technician');

// All authenticated users may read/use blueprints; staff manage them.
router.get('/', ctrl.list);
router.get('/:id', ctrl.get);
router.post('/', staff, ctrl.create);
router.patch('/:id', staff, ctrl.update);
router.delete('/:id', staff, ctrl.remove);

module.exports = router;
