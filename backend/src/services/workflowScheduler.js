// Time-driven workflow triggers (ticket_due_date_approaching, ticket_overdue)
// have no request to hang off, unlike the event-driven triggers wired into
// ticketsController.js. This app has no cron/job framework (single backend
// instance, no Redis — see prism_backend_stack conventions), so a plain
// setInterval is the right fit rather than adding one.
const { Op } = require('sequelize');
const { Ticket, WorkflowRuleLog, SystemSettings } = require('../models');
const { getActiveRulesForTrigger, runRuleForTicket } = require('./workflowEngine');
const { getTicketStatusBuckets } = require('./statusBehavior');

const CHECK_INTERVAL_MS = 15 * 60 * 1000;
const DEFAULT_HOURS_BEFORE = 24;

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

// A rule "hasn't fired yet for that ticket today" once any log row exists
// for this (rule, ticket) pair since midnight — written whether or not
// conditions actually matched, so a non-matching rule isn't re-checked
// every 15 minutes all day either.
async function alreadyRanToday(ruleId, ticketId) {
  const existing = await WorkflowRuleLog.findOne({
    where: { ruleId, ticketId, triggeredAt: { [Op.gte]: startOfToday() } },
  });
  return !!existing;
}

async function checkDueDateApproaching() {
  const rules = await getActiveRulesForTrigger('ticket_due_date_approaching');
  if (!rules.length) return;

  const buckets = await getTicketStatusBuckets();
  const todayStr = new Date().toISOString().slice(0, 10);

  // eslint-disable-next-line no-restricted-syntax
  for (const rule of rules) {
    const hoursBefore = Number(rule.triggerConfig?.hoursBefore) || DEFAULT_HOURS_BEFORE;
    const thresholdStr = new Date(Date.now() + hoursBefore * 3600000).toISOString().slice(0, 10);

    // eslint-disable-next-line no-await-in-loop
    const tickets = await Ticket.findAll({
      where: {
        status: { [Op.in]: buckets.open },
        dueDate: { [Op.ne]: null, [Op.gte]: todayStr, [Op.lte]: thresholdStr },
      },
      attributes: ['id'],
    });

    // eslint-disable-next-line no-restricted-syntax
    for (const t of tickets) {
      // eslint-disable-next-line no-await-in-loop
      if (await alreadyRanToday(rule.id, t.id)) continue; // eslint-disable-line no-continue
      // eslint-disable-next-line no-await-in-loop
      await runRuleForTicket(rule, t.id);
    }
  }
}

async function checkOverdue() {
  const rules = await getActiveRulesForTrigger('ticket_overdue');
  if (!rules.length) return;

  const buckets = await getTicketStatusBuckets();
  const todayStr = new Date().toISOString().slice(0, 10);
  const tickets = await Ticket.findAll({
    where: {
      status: { [Op.in]: buckets.open },
      dueDate: { [Op.ne]: null, [Op.lt]: todayStr },
    },
    attributes: ['id'],
  });
  if (!tickets.length) return;

  // eslint-disable-next-line no-restricted-syntax
  for (const rule of rules) {
    // eslint-disable-next-line no-restricted-syntax
    for (const t of tickets) {
      // eslint-disable-next-line no-await-in-loop
      if (await alreadyRanToday(rule.id, t.id)) continue; // eslint-disable-line no-continue
      // eslint-disable-next-line no-await-in-loop
      await runRuleForTicket(rule, t.id);
    }
  }
}

async function runChecks() {
  try {
    await checkDueDateApproaching();
  } catch (err) {
    console.error('[workflow-scheduler] due-date-approaching check failed:', err);
  }
  try {
    await checkOverdue();
  } catch (err) {
    console.error('[workflow-scheduler] overdue check failed:', err);
  }
  // Read by the Schedules settings page (schedulesController.js) — this
  // scheduler has no other queryable "last run" record, unlike AD sync
  // (AdSyncLog) and calendar sync (UserCalendarIntegration.lastSynced).
  try {
    await SystemSettings.upsert({ key: 'scheduler.workflowLastRun', value: new Date().toISOString() });
  } catch (err) {
    console.error('[workflow-scheduler] failed to record last-run timestamp:', err);
  }
}

let started = false;
function startWorkflowScheduler() {
  if (started) return;
  started = true;
  runChecks();
  setInterval(runChecks, CHECK_INTERVAL_MS);
  console.log('[workflow-scheduler] started (checking every 15 minutes)');
}

module.exports = { startWorkflowScheduler, runChecks };
