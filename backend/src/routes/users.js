const express = require('express');
const ctrl = require('../controllers/usersController');
const { requireRole } = require('../middleware/role');

// All routes here are already behind `authenticate` (mounted in routes/index.js).
const router = express.Router();

router.get('/', requireRole('admin'), ctrl.list);
router.post('/', requireRole('admin'), ctrl.create); // create local account
router.get('/assignable', ctrl.listAssignable); // must precede /:id
router.get('/directory', ctrl.listDirectory); // must precede /:id
router.get('/:id', ctrl.get); // self-or-admin enforced in controller
router.patch('/:id', requireRole('admin'), ctrl.update);
router.patch('/:id/preferences', ctrl.updatePreferences); // self-or-admin enforced in controller
router.delete('/:id', requireRole('admin'), ctrl.remove);

module.exports = router;
