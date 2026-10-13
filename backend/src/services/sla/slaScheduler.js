// Flags SLA warnings and breaches on running clocks, once each, then
// notifies and fires the sla_warning / sla_breached workflow rules. Clock
// state itself is kept current by services/sla/ticketSla.js; this only
// watches the derived warnAt/dueAt instants. Plain setInterval like the
// app's other schedulers (single backend instance, no job framework).
const { Op } = require('sequelize');
const {
  TicketSla, Ticket, TeamMember, SystemSettings,
} = require('../../models');
const { createNotification } = require('../notifications');
const { getActiveRulesForTrigger, runRuleForTicket } = require('../workflowEngine');

const CHECK_INTERVAL_MS = 60 * 1000;
const BATCH = 200;
const CLOCKS = ['assign', 'response', 'resolution'];
const LABEL = { assign: 'Assignment', response: 'First response', resolution: 'Resolution' };
const KINDS = {
  warn: {
    at: 'WarnAt', flag: 'WarnedAt', trigger: 'sla_warning', type: 'sla_warning', words: 'at risk',
  },
  breach: {
    at: 'DueAt', flag: 'BreachedAt', trigger: 'sla_breached', type: 'sla_breached', words: 'breached',
  },
};

// The assignment clock only runs while nobody is assigned, so its notices
// go to the ticket's team; the others go to the assignee. createNotification
// drops anyone who can't reach the ticket or a switched-off type.
async function recipients(ticket, clock) {
  if (clock === 'assign' || !ticket.assigneeId) {
    if (!ticket.teamId) return [];
    return (await TeamMember.findAll({ where: { teamId: ticket.teamId }, attributes: ['userId'] })).map((m) => m.userId);
  }
  return [ticket.assigneeId];
}

async function announce(ticketId, clock, kind) {
  const k = KINDS[kind];
  const ticket = await Ticket.findByPk(ticketId, { attributes: ['id', 'title', 'assigneeId', 'teamId'] });
  if (!ticket) return;
  // eslint-disable-next-line no-restricted-syntax
  for (const userId of await recipients(ticket, clock)) {
    // eslint-disable-next-line no-await-in-loop
    await createNotification({
      userId, type: k.type, message: `${LABEL[clock]} SLA ${k.words}: ${ticket.title}`, ticketId,
    });
  }
  const rules = await getActiveRulesForTrigger(k.trigger);
  // eslint-disable-next-line no-restricted-syntax
  for (const rule of rules) {
    const watched = (rule.triggerConfig && rule.triggerConfig.clock) || 'any';
    // eslint-disable-next-line no-await-in-loop
    if (watched === 'any' || watched === clock) await runRuleForTicket(rule, ticketId);
  }
}

async function flag(clock, kind, now) {
  const k = KINDS[kind];
  const atCol = `${clock}${k.at}`;
  const flagCol = `${clock}${k.flag}`;
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const rows = await TicketSla.findAll({
      where: {
        [`${clock}RunningSince`]: { [Op.ne]: null },
        [atCol]: { [Op.ne]: null, [Op.lte]: now },
        [flagCol]: null,
      },
      attributes: ['id', 'ticketId', atCol],
      order: [[atCol, 'ASC']],
      limit: BATCH,
    });
    // eslint-disable-next-line no-restricted-syntax
    for (const row of rows) {
      // Claim the row: only the pass whose update changed it announces, so
      // overlapping passes (or a restart mid-pass) never fire twice. A
      // breach is dated at its due time, not at whenever the pass ran.
      // eslint-disable-next-line no-await-in-loop
      const [claimed] = await TicketSla.update(
        { [flagCol]: kind === 'breach' ? row[atCol] : now },
        { where: { id: row.id, [flagCol]: null }, hooks: false }
      );
      if (claimed === 1) {
        try {
          // eslint-disable-next-line no-await-in-loop
          await announce(row.ticketId, clock, kind);
        } catch (err) {
          console.error(`[sla-scheduler] ${kind} for ticket ${row.ticketId} failed:`, err.message);
        }
      }
    }
    if (rows.length < BATCH) return;
  }
}

async function runSlaPass(now = new Date()) {
  // eslint-disable-next-line no-restricted-syntax
  for (const kind of ['warn', 'breach']) {
    // eslint-disable-next-line no-restricted-syntax
    for (const clock of CLOCKS) {
      // eslint-disable-next-line no-await-in-loop
      await flag(clock, kind, now);
    }
  }
}

async function runChecks() {
  try {
    await runSlaPass(new Date());
    await SystemSettings.upsert({ key: 'scheduler.slaLastRun', value: new Date().toISOString() });
  } catch (err) {
    console.error('[sla-scheduler] pass failed:', err);
  }
}

let started = false;
function startSlaScheduler() {
  if (started) return;
  started = true;
  runChecks();
  setInterval(runChecks, CHECK_INTERVAL_MS);
}

module.exports = { runSlaPass, startSlaScheduler };
