'use strict';

// Ticket status rework (user decisions 2026-10-15). Ticket statuses gain an
// "on hold" kind — never closed: the SLA keeps running and the ticket stays
// in open lists — and the seeded set becomes Open, Waiting on User, User
// responded (open); On Hold, Postponed (on hold); Request completed,
// Request cancelled, Closed (closed). In Progress folds into Open, Pending
// into On Hold, Resolved is renamed Request completed. Only these seeded
// rows are touched, by name; an admin's own statuses stay. Tickets follow
// their status, and so do workflow conditions and set-status actions.
// User responded and Waiting on User carry a systemKey: replies move tickets
// into them automatically.
//
// down() is lossy: tickets once In Progress or Pending can't be told apart
// from Open and On Hold ones.

const BASE_KINDS = ['open', 'closed', 'archived'];

const SEEDED = [
  { name: 'Open', behaviorType: 'open', color: '#3b82f6', isProtected: true },
  { name: 'Waiting on User', behaviorType: 'open', color: '#8b5cf6', isProtected: true, systemKey: 'waiting_on_user' },
  { name: 'User responded', behaviorType: 'open', color: '#ec4899', isProtected: true, systemKey: 'user_responded' },
  { name: 'On Hold', behaviorType: 'on_hold', color: '#94a3b8', isProtected: false },
  { name: 'Postponed', behaviorType: 'on_hold', color: '#a8a29e', isProtected: false },
  { name: 'Request completed', behaviorType: 'closed', color: '#14b8a6', isProtected: true },
  { name: 'Request cancelled', behaviorType: 'closed', color: '#64748b', isProtected: false },
  { name: 'Closed', behaviorType: 'closed', color: '#475569', isProtected: true },
];
const OLD_SEEDED = [
  { name: 'Open', behaviorType: 'open', color: '#3b82f6', isProtected: true },
  { name: 'In Progress', behaviorType: 'open', color: '#22c55e', isProtected: false },
  { name: 'Pending', behaviorType: 'open', color: '#f59e0b', isProtected: false },
  { name: 'On Hold', behaviorType: 'open', color: '#94a3b8', isProtected: false },
  { name: 'Resolved', behaviorType: 'closed', color: '#14b8a6', isProtected: true },
  { name: 'Closed', behaviorType: 'closed', color: '#475569', isProtected: true },
];

async function setKinds(qi, kinds) {
  const list = kinds.map((k) => `'${k}'`).join(',');
  await qi.sequelize.query(`ALTER TABLE TicketStatuses MODIFY behaviorType ENUM(${list}) NOT NULL DEFAULT 'open'`);
}

async function statusNames(qi, Sequelize, t) {
  const rows = await qi.sequelize.query('SELECT name FROM TicketStatuses', { type: Sequelize.QueryTypes.SELECT, transaction: t });
  return new Set(rows.map((r) => r.name));
}

// Points tickets and workflow rules at another status name.
async function repoint(qi, Sequelize, from, to, t) {
  await qi.sequelize.query('UPDATE Tickets SET status = ? WHERE status = ?', { replacements: [to, from], transaction: t });
  const conditions = await qi.sequelize.query("SELECT id, value FROM WorkflowConditions WHERE field = 'status'", { type: Sequelize.QueryTypes.SELECT, transaction: t });
  for (const c of conditions) {
    let next = null;
    if (c.value === from) next = to;
    else {
      let parsed;
      try { parsed = JSON.parse(c.value); } catch { parsed = null; }
      if (Array.isArray(parsed) && parsed.includes(from)) next = JSON.stringify(parsed.map((v) => (v === from ? to : v)));
    }
    // eslint-disable-next-line no-await-in-loop
    if (next !== null) await qi.sequelize.query('UPDATE WorkflowConditions SET value = ? WHERE id = ?', { replacements: [next, c.id], transaction: t });
  }
  const actions = await qi.sequelize.query("SELECT id, actionValue FROM WorkflowActions WHERE actionType = 'set_status'", { type: Sequelize.QueryTypes.SELECT, transaction: t });
  for (const a of actions) {
    let v = a.actionValue;
    if (typeof v === 'string') { try { v = JSON.parse(v); } catch { v = null; } }
    if (v && v.status === from) {
      // eslint-disable-next-line no-await-in-loop
      await qi.sequelize.query('UPDATE WorkflowActions SET actionValue = ? WHERE id = ?', { replacements: [JSON.stringify({ ...v, status: to }), a.id], transaction: t });
    }
  }
}

// Folds status `from` into `to` (renaming it when `to` doesn't exist yet).
async function fold(qi, Sequelize, from, to, t) {
  const names = await statusNames(qi, Sequelize, t);
  if (!names.has(from)) return;
  if (names.has(to)) {
    await repoint(qi, Sequelize, from, to, t);
    await qi.sequelize.query('DELETE FROM TicketStatuses WHERE name = ?', { replacements: [from], transaction: t });
  } else {
    await qi.sequelize.query('UPDATE TicketStatuses SET name = ? WHERE name = ?', { replacements: [to, from], transaction: t });
    await repoint(qi, Sequelize, from, to, t);
  }
}

// Makes the seeded rows exist as listed and puts them first, in order; any
// other status keeps its relative order after them.
async function ensureSeeded(qi, Sequelize, seeded, withSystemKey, t) {
  const names = await statusNames(qi, Sequelize, t);
  for (const s of seeded) {
    const fields = { behaviorType: s.behaviorType, isProtected: s.isProtected };
    if (withSystemKey) fields.systemKey = s.systemKey || null;
    if (names.has(s.name)) {
      const sets = Object.keys(fields).map((k) => `\`${k}\` = ?`).join(', ');
      // eslint-disable-next-line no-await-in-loop
      await qi.sequelize.query(`UPDATE TicketStatuses SET ${sets} WHERE name = ?`, { replacements: [...Object.values(fields), s.name], transaction: t });
    } else {
      // eslint-disable-next-line no-await-in-loop
      await qi.bulkInsert('TicketStatuses', [{
        name: s.name, color: s.color, ...fields, isDefault: s.name === 'Open', position: 0, createdAt: new Date(),
      }], { transaction: t });
    }
  }
  const rows = await qi.sequelize.query('SELECT id, name FROM TicketStatuses ORDER BY position ASC, id ASC', { type: Sequelize.QueryTypes.SELECT, transaction: t });
  const order = [...seeded.map((s) => rows.find((r) => r.name === s.name)), ...rows.filter((r) => !seeded.some((s) => s.name === r.name))];
  for (let i = 0; i < order.length; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await qi.sequelize.query('UPDATE TicketStatuses SET position = ? WHERE id = ?', { replacements: [i, order[i].id], transaction: t });
  }
}

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const qi = queryInterface;
    await setKinds(qi, [...BASE_KINDS, 'on_hold']);
    const cols = await qi.describeTable('TicketStatuses');
    if (!cols.systemKey) {
      await qi.addColumn('TicketStatuses', 'systemKey', { type: Sequelize.STRING(32), allowNull: true, unique: true });
    }
    await qi.sequelize.transaction(async (t) => {
      await fold(qi, Sequelize, 'Resolved', 'Request completed', t);
      await ensureSeeded(qi, Sequelize, SEEDED, true, t);
      await fold(qi, Sequelize, 'In Progress', 'Open', t);
      await fold(qi, Sequelize, 'Pending', 'On Hold', t);
      await ensureSeeded(qi, Sequelize, SEEDED, true, t);
    });
  },

  down: async (queryInterface, Sequelize) => {
    const qi = queryInterface;
    await qi.sequelize.transaction(async (t) => {
      await fold(qi, Sequelize, 'Waiting on User', 'Open', t);
      await fold(qi, Sequelize, 'User responded', 'Open', t);
      await fold(qi, Sequelize, 'Postponed', 'On Hold', t);
      await fold(qi, Sequelize, 'Request cancelled', 'Closed', t);
      await fold(qi, Sequelize, 'Request completed', 'Resolved', t);
      await qi.sequelize.query("UPDATE TicketStatuses SET behaviorType = 'open' WHERE behaviorType = 'on_hold'", { transaction: t });
      await ensureSeeded(qi, Sequelize, OLD_SEEDED, false, t);
    });
    const cols = await qi.describeTable('TicketStatuses');
    if (cols.systemKey) await qi.removeColumn('TicketStatuses', 'systemKey');
    await setKinds(qi, BASE_KINDS);
  },
};
