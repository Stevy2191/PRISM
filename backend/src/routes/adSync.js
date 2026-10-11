const express = require('express');
const ctrl = require('../controllers/adSyncController');
const { requirePermission } = require('../middleware/requirePermission');
const { requireOwner } = require('../services/ownership');

const router = express.Router();
const manage = requirePermission('settings.manage_system');

// Directory sync (and its group-to-role mappings) needs an Owner (user decision 2026-10-11).
router.use(manage, requireOwner('Directory sync settings'));

router.get('/settings', ctrl.getSettings);
router.put('/settings', ctrl.saveSettings);
router.post('/run', ctrl.runNow);
router.get('/logs', ctrl.listLogs);
router.get('/group-mappings', ctrl.listMappings);
router.post('/group-mappings', ctrl.createMapping);
router.delete('/group-mappings/:id', ctrl.removeMapping);

module.exports = router;
