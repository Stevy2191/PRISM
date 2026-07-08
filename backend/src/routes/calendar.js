const express = require('express');
const ctrl = require('../controllers/calendarController');
const integrationsCtrl = require('../controllers/calendarIntegrationsController');
const { requirePermission } = require('../middleware/requirePermission');

const router = express.Router();

// Any minimum ticket-view OR project-view permission is enough to see the
// calendar — it aggregates both, and a project-only viewer with no ticket
// access at all shouldn't be locked out just because tickets happen to be
// one of the event types.
const viewMin = requirePermission(
  'tickets.view_own', 'tickets.view_department', 'tickets.view_all',
  'projects.view_own', 'projects.view_department', 'projects.view_all'
);

router.get('/events', viewMin, ctrl.listEvents);

// Calendar integrations are a personal account feature (Account
// Preferences) — every authenticated user manages their own, independent of
// ticket/project view permissions (already enforced by the outer route
// guard in routes/index.js, no extra gate needed here).

// OAuth sub-paths registered before the /:id routes as a defensive
// convention (see the department-creation route-ordering bug memory) even
// though these particular path shapes don't actually collide.
router.get('/integrations/google/auth-url', integrationsCtrl.googleAuthUrl);
router.get('/integrations/google/callback', integrationsCtrl.googleCallback);
router.get('/integrations/microsoft/auth-url', integrationsCtrl.microsoftAuthUrl);
router.get('/integrations/microsoft/callback', integrationsCtrl.microsoftCallback);
router.post('/integrations/ical/test', integrationsCtrl.testIcal);

router.get('/integrations', integrationsCtrl.list);
router.post('/integrations', integrationsCtrl.create);
router.patch('/integrations/:id', integrationsCtrl.update);
router.delete('/integrations/:id', integrationsCtrl.remove);
router.post('/integrations/:id/sync', integrationsCtrl.manualSync);
router.get('/integrations/:id/available-calendars', integrationsCtrl.availableCalendars);

router.get('/external-events', integrationsCtrl.externalEvents);

module.exports = router;
