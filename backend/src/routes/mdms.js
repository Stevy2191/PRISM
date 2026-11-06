// The MDMs an install uses (Playbooks, PB). Anyone who sees assets reads the
// list (the asset form's picker); only playbook managers change it.
const express = require('express');
const ctrl = require('../controllers/mdmsController');
const { requirePermission } = require('../middleware/requirePermission');

const router = express.Router();
const canManage = requirePermission('settings.manage_playbooks');

router.get('/', requirePermission('assets.view', 'settings.manage_playbooks'), ctrl.list);
router.post('/', canManage, ctrl.create);
router.post('/reorder', canManage, ctrl.reorder);
router.patch('/:id', canManage, ctrl.update);

module.exports = router;
