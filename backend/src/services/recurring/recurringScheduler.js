// The recurring tickets scheduler (service desk 5b). Every minute, each due
// rule is claimed with a conditional UPDATE on the nextRunAt it was seen
// with, so overlapping passes (or two instances) make its ticket once. The
// next run is computed from now, not from the missed one: after downtime a
// rule makes one ticket and moves on, with no backlog. A rule whose ticket
// can't be made (its run-as user lost access, its contact went away) pauses
// itself, records why, and tells that user.
const { Op } = require('sequelize');
const { RecurringTicket } = require('../../models');
const { nextRun } = require('./schedule');
// Called through the module so a test can stand in for it.
const runner = require('./runRule');
const { createNotification } = require('../notifications');

const CHECK_INTERVAL_MS = 60 * 1000;
const BATCH = 100;

async function pause(rule, err) {
  // Only a refusal the app phrased (an ApiError below 500) is shown; anything
  // else may carry internals and is in the server log already.
  const expected = err && err.status && err.status < 500;
  const message = expected ? String(err.message).slice(0, 500) : 'Could not create the ticket; see the server log';
  await RecurringTicket.update({ active: false, lastError: message }, { where: { id: rule.id } });
  await createNotification({
    userId: rule.createdById,
    type: 'recurring_paused',
    message: `Recurring ticket "${rule.title}" was paused: ${message}`,
  }).catch((e) => console.error('[recurring] notice failed:', e.message));
}

async function runDueRecurring(now = new Date()) {
  const result = { created: 0, paused: 0 };
  const rules = await RecurringTicket.findAll({
    where: { active: true, nextRunAt: { [Op.ne]: null, [Op.lte]: now } },
    order: [['nextRunAt', 'ASC'], ['id', 'ASC']],
    limit: BATCH,
  });
  for (const rule of rules) {
    const next = nextRun(rule, now);
    // eslint-disable-next-line no-await-in-loop
    const [claimed] = await RecurringTicket.update(
      { nextRunAt: next, lastRunAt: now, ...(next ? {} : { active: false }) },
      { where: { id: rule.id, active: true, nextRunAt: rule.nextRunAt } }
    );
    if (claimed !== 1) continue; // eslint-disable-line no-continue
    try {
      // eslint-disable-next-line no-await-in-loop
      await runner.runRule(rule, { now });
      result.created += 1;
    } catch (err) {
      if (!err || !err.status || err.status >= 500) console.error(`[recurring] rule ${rule.id} failed:`, err);
      // eslint-disable-next-line no-await-in-loop
      await pause(rule, err);
      result.paused += 1;
    }
  }
  return result;
}

let started = false;
function startRecurringScheduler() {
  if (started) return;
  started = true;
  const tick = () => runDueRecurring(new Date()).catch((err) => console.error('[recurring] pass failed:', err));
  tick();
  setInterval(tick, CHECK_INTERVAL_MS);
}

module.exports = { runDueRecurring, startRecurringScheduler };
