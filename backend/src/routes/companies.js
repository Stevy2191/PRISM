const express = require('express');
const ctrl = require('../controllers/companiesController');
const sites = require('../controllers/sitesController');
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
router.patch('/:id', canManage, ctrl.update);
router.delete('/:id', canManage, ctrl.remove);
router.post('/:id/merge', canManage, ctrl.merge);
router.post('/:id/domains', canManage, ctrl.addDomain);
router.delete('/:id/domains/:domainId', canManage, ctrl.removeDomain);
router.get('/:id/sites', canView, sites.list);
router.post('/:id/sites', canManage, sites.create);
router.patch('/:id/sites/:siteId', canManage, sites.update);

module.exports = router;
