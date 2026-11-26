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
router.get('/vendors', requirePermission('assets.view', 'projects.manage_expenses', 'companies.view', 'money.bills.manage', 'money.purchasing.manage'), ctrl.vendors);
router.get('/', canView, ctrl.list);
router.post('/', canManage, ctrl.create);
router.get('/:id', canView, ctrl.get);

// A company's software list (9): read by anyone who reaches the company (the
// ticket forms ask "which app?"); the controller checks the permission to
// change it.
const catalog = require('../controllers/catalogController');
// A customer's billing settings (Phase 3): permission, then reach, then any upload.
const billing = require('../controllers/money/companyBillingController');
const { requireCustomerBilling } = require('../middleware/customerBilling');
const invoicesCtrl = require('../controllers/money/invoicesController');
const paymentsCtrl = require('../controllers/money/paymentsController');
const { companyUpload, verifyFileSignature, scanUpload } = require('../middleware/upload');
const canSeeBilling = requirePermission('money.billing.view');
const canManageBilling = requirePermission('money.billing.manage');
router.get('/:id/billing', canSeeBilling, billing.loadBillingCompany, billing.get);
// A company's invoices (Phase 3, step 3): hidden while Customer billing is off.
router.get('/:id/invoices', requireCustomerBilling, requirePermission('money.billing.view', 'money.billing.manage'), billing.loadBillingCompany, invoicesCtrl.forCompany);
router.get('/:id/credit', requireCustomerBilling, requirePermission('money.billing.view', 'money.billing.manage'), billing.loadBillingCompany, paymentsCtrl.credit);
router.post('/:id/credit/refund', requireCustomerBilling, requirePermission('money.billing.manage'), billing.loadBillingCompany, paymentsCtrl.refundCredit);
router.put('/:id/billing', canManageBilling, billing.loadBillingCompany, billing.update);
router.post('/:id/billing/certificate', canManageBilling, billing.loadBillingCompany, companyUpload.single('file'), verifyFileSignature, scanUpload('Company'), billing.uploadCertificate);
router.get('/:id/billing/certificate', canSeeBilling, billing.loadBillingCompany, billing.downloadCertificate);
router.get('/:id/billing/tiers', canSeeBilling, billing.loadBillingCompany, billing.tiers);
router.get('/:id/catalog/found-software', catalog.foundSoftware);
router.get('/:id/catalog', catalog.list);
router.post('/:id/catalog', catalog.create);
router.patch('/:id/catalog/:itemId', catalog.update);
router.delete('/:id/catalog/:itemId', catalog.remove);
router.get('/:id/glance', canView, ctrl.glance);
// CS: the company's own SLA, support hours and holidays.
const companySla = require('../controllers/companySlaController');
router.get('/:id/sla', canView, companySla.get);
router.put('/:id/sla', canView, companySla.save);
router.post('/:id/sla/reset', canView, companySla.reset);
router.post('/:id/sla/holidays', canView, companySla.addHoliday);
router.delete('/:id/sla/holidays/:holidayId', canView, companySla.removeHoliday);
// CS: the company's own portal and surveys.
const companyPortal = require('../controllers/companyPortalController');
router.get('/:id/portal', canView, companyPortal.get);
router.put('/:id/portal', canView, companyPortal.save);
router.post('/:id/portal/invite-all', canView, companyPortal.inviteAll);
router.put('/:id/surveys', canView, companyPortal.surveys);
// CS: what applies to the company, and its checklist bundles on or off.
const companyApplies = require('../controllers/companyAppliesController');
router.get('/:id/applies', canView, companyApplies.get);
router.put('/:id/bundles/:playbookId', canView, companyApplies.setBundle);
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
