const express = require('express');
const ctrl = require('../controllers/reportsController');
const savedViewsCtrl = require('../controllers/savedReportViewsController');
const { requirePermission } = require('../middleware/requirePermission');

const router = express.Router();

const viewMin = requirePermission('reports.view_own', 'reports.view_department', 'reports.view_all');
const canExport = requirePermission('reports.export');

router.use(viewMin);

// Saved report views (optional enhancement) — a user's own filter presets per report.
router.get('/saved-views', savedViewsCtrl.list);
router.post('/saved-views', savedViewsCtrl.create);
router.delete('/saved-views/:id', savedViewsCtrl.remove);

router.get('/ticket-volume', ctrl.ticketVolume);
router.get('/ticket-volume/export', canExport, ctrl.ticketVolumeExport);

router.get('/ticket-trends', ctrl.ticketTrends);
router.get('/ticket-trends/export', canExport, ctrl.ticketTrendsExport);

router.get('/team-performance', ctrl.teamPerformance);
router.get('/team-performance/export', canExport, ctrl.teamPerformanceExport);

router.get('/sla-compliance', ctrl.slaCompliance);
router.get('/sla-compliance/export', canExport, ctrl.slaComplianceExport);

router.get('/time-billing', ctrl.timeBilling);
router.get('/time-billing/export', canExport, ctrl.timeBillingExport);

router.get('/projects', ctrl.projectsReport);
router.get('/projects/export', canExport, ctrl.projectsReportExport);

router.get('/contacts', ctrl.contactsReport);
router.get('/contacts/export', canExport, ctrl.contactsReportExport);

// Pre-existing customer happiness report (see Settings -> Customer Happiness).
router.get('/csat', ctrl.csat);

module.exports = router;
