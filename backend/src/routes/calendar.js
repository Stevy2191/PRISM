const express = require('express');
const ctrl = require('../controllers/calendarController');
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

module.exports = router;
