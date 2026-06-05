const express = require('express');
const ctrl = require('../controllers/departmentsController');
const { requireRole } = require('../middleware/role');

const router = express.Router();

// Any authenticated user can read departments; only admins mutate.
router.get('/', ctrl.list);
router.get('/:id', ctrl.get);
router.post('/', requireRole('admin'), ctrl.create);
router.patch('/:id', requireRole('admin'), ctrl.update);
router.delete('/:id', requireRole('admin'), ctrl.remove);

module.exports = router;
