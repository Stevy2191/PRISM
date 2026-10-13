// How a ticket's SLA reaches the client, plus the "breached" / "at risk"
// ticket filters used by the list and the dashboard. The view is derived
// from the stored TicketSlas row at read time, so "at risk" is live even
// between scheduler passes.
const { Op } = require('sequelize');
const { sequelize } = require('../../models');

const CLOCKS = ['assign', 'response', 'resolution'];
const SLA_FILTERS = ['breached', 'at_risk'];

const time = (d) => (d ? new Date(d).getTime() : null);

function clockView(row, c, nowMs) {
  const target = row[`${c}TargetMinutes`];
  const running = !!row[`${c}RunningSince`];
  const dueAt = row[`${c}DueAt`];
  const warnAt = row[`${c}WarnAt`];
  const breachedAt = row[`${c}BreachedAt`];
  const metAt = row[`${c}MetAt`];
  let state;
  if (target === null || target === undefined) state = 'untracked';
  else if (breachedAt || (running && dueAt && time(dueAt) <= nowMs)) state = 'breached';
  else if (running) state = 'running';
  else if (metAt) state = 'met';
  else state = 'paused';
  return {
    state,
    targetMinutes: target ?? null,
    usedMinutes: row[`${c}UsedMinutes`] || 0,
    dueAt: dueAt || null,
    metAt: metAt || null,
    breachedAt: breachedAt || null,
    atRisk: state === 'running' && !!warnAt && time(warnAt) <= nowMs,
  };
}

// → { policy, clocks: { assign, response, resolution }, worst } or null.
// `worst` is the running clock due soonest — what a list badge shows.
function toSlaView(row, now = new Date()) {
  if (!row) return null;
  const nowMs = time(now);
  const clocks = {};
  CLOCKS.forEach((c) => { clocks[c] = clockView(row, c, nowMs); });
  let worst = null;
  CLOCKS.forEach((c) => {
    const v = clocks[c];
    if (!row[`${c}RunningSince`] || v.state === 'untracked' || !v.dueAt) return;
    if (!worst || time(v.dueAt) < time(worst.dueAt)) {
      let state = 'running';
      if (v.state === 'breached') state = 'breached';
      else if (v.atRisk) state = 'at_risk';
      worst = { clock: c, dueAt: v.dueAt, state };
    }
  });
  return {
    policy: row.policy ? { id: row.policy.id, name: row.policy.name } : { id: row.slaPolicyId, name: null },
    clocks,
    worst,
  };
}

const anyBreached = CLOCKS.map((c) => `${c}BreachedAt IS NOT NULL`).join(' OR ');
const noneBreached = CLOCKS.map((c) => `${c}BreachedAt IS NULL`).join(' AND ');

// A where fragment on Tickets.id for `kind` ('breached' | 'at_risk'). The SQL
// is fixed text; the only value, `now`, is escaped. Callers AND it into a
// scoped where (and limit to open tickets).
function slaFilterWhere(kind, now = new Date()) {
  let sql;
  if (kind === 'breached') {
    sql = `SELECT ticketId FROM TicketSlas WHERE ${anyBreached}`;
  } else {
    const at = sequelize.escape(new Date(now));
    const warned = CLOCKS.map((c) => `(${c}RunningSince IS NOT NULL AND ${c}WarnAt <= ${at})`).join(' OR ');
    sql = `SELECT ticketId FROM TicketSlas WHERE ${noneBreached} AND (${warned})`;
  }
  return { id: { [Op.in]: sequelize.literal(`(${sql})`) } };
}

module.exports = {
  toSlaView, slaFilterWhere, SLA_FILTERS,
};
