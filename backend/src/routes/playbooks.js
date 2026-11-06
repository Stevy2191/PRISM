// Playbooks (Playbooks, PB). Playbook managers build, export and import
// them; anyone who can edit tickets may read them (the Apply dialog).
const express = require('express');
const ctrl = require('../controllers/playbooksController');
const { requirePermission } = require('../middleware/requirePermission');

const router = express.Router();
const canManage = requirePermission('settings.manage_playbooks');
const canRead = requirePermission('settings.manage_playbooks', 'tickets.edit_own', 'tickets.edit_department', 'tickets.edit_all');

router.post('/export', canManage, ctrl.exportPlaybooks);
router.post('/import', canManage, ctrl.importPlaybooks);
router.get('/', canRead, ctrl.list);
router.get('/:id', canRead, ctrl.get);
router.post('/', canManage, ctrl.create);
router.put('/:id', canManage, ctrl.update);
router.patch('/:id', canManage, ctrl.setActive);
router.post('/:id/preview', canManage, ctrl.preview);

module.exports = router;
