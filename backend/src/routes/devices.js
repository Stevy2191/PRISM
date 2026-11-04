// The PRISM agent's devices, for staff (8a). Viewing a company's devices
// and an Asset's device is under /companies and /assets; here are the
// actions: revoking a computer and the installers.
const express = require('express');
const ctrl = require('../controllers/devicesController');
const { requirePermission } = require('../middleware/requirePermission');

const router = express.Router();
const canManage = requirePermission('devices.manage');

router.get('/packages', canManage, ctrl.listPackages);
router.get('/packages/:platform/:arch', canManage, ctrl.downloadPackage);
router.post('/:id/revoke', canManage, ctrl.revoke);
// Scan now: also for staff who can edit Assets (it only asks for a report).
router.post('/:id/scan', requirePermission('devices.manage', 'assets.edit'), ctrl.requestScan);

module.exports = router;
