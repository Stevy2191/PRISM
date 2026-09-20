const express = require('express');
const ctrl = require('../controllers/ssoAdminController');
const { requirePermission } = require('../middleware/requirePermission');

const router = express.Router();

// Configuring an identity provider is equivalent to configuring who can log
// in at all, so it sits behind the same permission as the rest of system
// settings rather than anything narrower.
const manageSystem = requirePermission('settings.manage_system');
router.use(manageSystem);

router.get('/providers', ctrl.listProviders);
router.post('/providers', ctrl.createProvider);
router.get('/providers/:id', ctrl.getProvider);
router.patch('/providers/:id', ctrl.updateProvider);
router.delete('/providers/:id', ctrl.removeProvider);

router.get('/providers/:id/mappings', ctrl.listMappings);
router.post('/providers/:id/mappings', ctrl.createMapping);
router.delete('/providers/:id/mappings/:mappingId', ctrl.removeMapping);

router.get('/enforcement', ctrl.getEnforcement);
router.put('/enforcement', ctrl.setEnforcement);
router.put('/break-glass/:userId', ctrl.setBreakGlass);

module.exports = router;
