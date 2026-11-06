// Forms (Playbooks, PB). Playbook managers build them; anyone who can edit
// tickets may read them (the Apply dialog and the ticket form page).
const express = require('express');
const ctrl = require('../controllers/formsController');
const { requirePermission } = require('../middleware/requirePermission');

const router = express.Router();
const canManage = requirePermission('settings.manage_playbooks');
const canRead = requirePermission('settings.manage_playbooks', 'tickets.edit_own', 'tickets.edit_department', 'tickets.edit_all');

router.get('/', canRead, ctrl.list);
router.get('/:id', canRead, ctrl.get);
router.post('/', canManage, ctrl.create);
router.put('/:id', canManage, ctrl.save);
router.patch('/:id', canManage, ctrl.setActive);

module.exports = router;
