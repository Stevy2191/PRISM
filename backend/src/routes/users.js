const express = require('express');
const ctrl = require('../controllers/usersController');
const { requireRole } = require('../middleware/role');

// All routes here are already behind `authenticate` (mounted in routes/index.js).
const router = express.Router();

router.get('/', requireRole('admin'), ctrl.list);
router.get('/:id', ctrl.get); // self-or-admin enforced in controller
router.patch('/:id', requireRole('admin'), ctrl.update);
router.delete('/:id', requireRole('admin'), ctrl.remove);

module.exports = router;
