const { SystemSettings, AdSyncLog, UserCalendarIntegration } = require('../models');
const { asyncHandler } = require('../middleware/error');

// Read-only view of the app's three setInterval-based background jobs — see
// index.js for where they're started. There's no cron framework here (see
// prism_backend_stack conventions), so "schedule" below just means the
// hardcoded interval each one runs on.
const list = asyncHandler(async (req, res) => {
  const workflowLastRunRow = await SystemSettings.findOne({ where: { key: 'scheduler.workflowLastRun' } });
  const lastAdSync = await AdSyncLog.findOne({ order: [['startedAt', 'DESC']] });
  const calendarIntegrations = await UserCalendarIntegration.findAll({
    where: { isActive: true },
    attributes: ['id', 'lastSynced'],
    order: [['lastSynced', 'DESC']],
  });

  const jobs = [
    {
      key: 'workflow',
      name: 'Workflow overdue/due-soon check',
      description: 'Fires "ticket overdue" and "ticket due soon" workflow rules against open tickets.',
      intervalLabel: 'Every 15 minutes',
      lastRun: workflowLastRunRow?.value || null,
    },
    {
      key: 'adSync',
      name: 'Active Directory sync',
      description: 'Pulls in new/updated AD users as contacts and deactivates removed ones.',
      intervalLabel: 'Every 15 minutes (only runs if enabled in Directory Sync)',
      lastRun: lastAdSync?.startedAt || null,
      lastStatus: lastAdSync?.status || null,
    },
    {
      key: 'calendarSync',
      name: 'Calendar integration sync',
      description: 'Pulls events from each connected Google/Microsoft/iCal calendar.',
      intervalLabel: 'Every 30 minutes',
      lastRun: calendarIntegrations[0]?.lastSynced || null,
      activeIntegrationCount: calendarIntegrations.length,
    },
  ];

  res.json({ jobs });
});

module.exports = { list };
