const express = require('express');
const ctrl = require('../controllers/companiesController');
const sites = require('../controllers/sitesController');
const portalAdmins = require('../controllers/portal/adminsController');
const m365 = require('../controllers/companyM365Controller');
const agentKeys = require('../controllers/agentKeysController');
const devices = require('../controllers/devicesController');
const { requirePermission } = require('../middleware/requirePermission');

const router = express.Router();
const canView = requirePermission('companies.view');
const canManage = requirePermission('companies.manage');

router.get('/summary', ctrl.summary); // before '/:id'; any staff user
// Before '/:id'. Anyone who records purchases can pick a vendor.
router.get('/vendors', requirePermission('assets.view', 'projects.manage_expenses', 'companies.view'), ctrl.vendors);
router.get('/', canView, ctrl.list);
router.post('/', canManage, ctrl.create);
router.get('/:id', canView, ctrl.get);
router.get('/:id/glance', canView, ctrl.glance);
router.put('/:id/sla-policy', canView, ctrl.setSlaPolicy);
router.patch('/:id', canManage, ctrl.update);
router.delete('/:id', canManage, ctrl.remove);
router.post('/:id/merge', canManage, ctrl.merge);
router.post('/:id/domains', canManage, ctrl.addDomain);
router.delete('/:id/domains/:domainId', canManage, ctrl.removeDomain);
// Client portal (7a): the company's portal admins.
router.get('/:id/portal-admins', requirePermission('companies.view', 'portal.manage'), portalAdmins.listCompanyAdmins);
router.put('/:id/portal-admins', requirePermission('portal.manage'), portalAdmins.setCompanyAdmins);
// Client portal (7b): the company's Microsoft 365 link and sync.
const canManagePortal = requirePermission('portal.manage');
router.get('/:id/m365', canManagePortal, m365.get);
router.put('/:id/m365', canManagePortal, m365.update);
router.get('/:id/m365/consent-url', canManagePortal, m365.consentUrl);
router.get('/:id/m365/groups', canManagePortal, m365.searchGroups);
router.post('/:id/m365/sync', canManagePortal, m365.sync);
router.get('/:id/m365/detected-departments', canManagePortal, m365.listDetected);
router.post('/:id/m365/detected-departments/:detectedId/map', canManagePortal, m365.mapDetected);
router.post('/:id/m365/detected-departments/:detectedId/create', canManagePortal, m365.createFromDetected);
// The PRISM agent (8a): the company's enrollment keys.
const canManageDevices = requirePermission('devices.manage');
router.get('/:id/agent-keys', canManageDevices, agentKeys.list);
router.post('/:id/agent-keys', canManageDevices, agentKeys.create);
router.post('/:id/agent-keys/:keyId/revoke', canManageDevices, agentKeys.revoke);
router.post('/:id/agent-keys/:keyId/reveal', canManageDevices, agentKeys.reveal);
router.post('/:id/agent-keys/:keyId/rotate', canManageDevices, agentKeys.rotate);
// Its devices: viewing follows Assets' view permission (and company access).
router.get('/:id/devices', requirePermission('assets.view'), devices.listForCompany);
router.get('/:id/sites', canView, sites.list);
router.post('/:id/sites', canManage, sites.create);
router.patch('/:id/sites/:siteId', canManage, sites.update);

module.exports = router;
