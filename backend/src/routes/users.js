const express = require('express');
const ctrl = require('../controllers/usersController');
const { requireRole } = require('../middleware/role');
const { requirePermission } = require('../middleware/requirePermission');

// All routes here are already behind `authenticate` (mounted in routes/index.js).
const router = express.Router();

router.get('/', requirePermission('people.view_own_department', 'people.view_all'), ctrl.list);
router.post('/', requirePermission('people.create_users'), ctrl.create); // create local account
router.get('/assignable', ctrl.listAssignable); // must precede /:id
router.get('/directory', ctrl.listDirectory); // must precede /:id
router.get('/:id', ctrl.get); // self-or-admin enforced in controller
router.patch('/:id', requirePermission('people.edit_users'), ctrl.update);
router.patch('/:id/preferences', ctrl.updatePreferences); // self-or-admin enforced in controller
router.delete('/:id', requireRole('admin'), ctrl.remove);

module.exports = router;
