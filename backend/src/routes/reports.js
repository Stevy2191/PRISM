const express = require('express');
const ctrl = require('../controllers/reportsController');
const savedViewsCtrl = require('../controllers/savedReportViewsController');
const customCtrl = require('../controllers/customReportsController');
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

// Raw ticket-list CSV dump (Settings -> Export), distinct from the
// aggregated Ticket Volume report above.
router.get('/tickets/export', canExport, ctrl.ticketsExport);

// Pre-existing customer happiness report (see Settings -> Customer Happiness).
router.get('/csat', ctrl.csat);

// Custom report builder
router.get('/custom/metadata', customCtrl.metadata);
router.post('/custom', customCtrl.run);
router.post('/custom/export-csv', canExport, customCtrl.exportCsv);
router.post('/custom/export-pdf', canExport, customCtrl.exportPdf);

// Saved custom report configurations
router.get('/saved', customCtrl.listSaved);
router.post('/saved', customCtrl.createSaved);
router.patch('/saved/:id', customCtrl.updateSaved);
router.post('/saved/:id/run', customCtrl.runSaved);
router.delete('/saved/:id', customCtrl.removeSaved);

module.exports = router;
