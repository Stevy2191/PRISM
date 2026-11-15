'use strict';

// Tickets numbered per company (CN part 2).
//   + CompanyCounters (companyId, kind, seq): each company's last ticket
//     number (kind 'ticket'; projects use it too). No foreign keys, so
//     counting never waits on a lock held on the company's row.
//   + Tickets.companySeq, Tickets.number (WC-T0042, unique),
//     Tickets.previousNumbers (numbers it had: 00042 from before CN).
// Every ticket is renumbered within its company in the order it was made,
// and its tasks' codes follow (#00042-T04 → WC-T0012-T04). The id stays the
// key, so old links, emails ([Ticket #00042]) and searches still find it.

const LEGACY = (col) => `IF(${col} > 99999, CAST(${col} AS CHAR), LPAD(${col}, 5, '0'))`;
const PAD = (col) => `IF(${col} > 9999, CAST(${col} AS CHAR), LPAD(${col}, 4, '0'))`;

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const qi = queryInterface;
    const run = (sql) => qi.sequelize.query(sql);
    const tables = (await qi.showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName));
    if (!tables.includes('CompanyCounters')) {
      await qi.createTable('CompanyCounters', {
        companyId: { type: Sequelize.INTEGER, allowNull: false, primaryKey: true },
        kind: { type: Sequelize.STRING(16), allowNull: false, primaryKey: true },
        seq: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      });
    }
    const tickets = await qi.describeTable('Tickets');
    if (!tickets.companySeq) await qi.addColumn('Tickets', 'companySeq', { type: Sequelize.INTEGER, allowNull: true });
    if (!tickets.number) await qi.addColumn('Tickets', 'number', { type: Sequelize.STRING(24), allowNull: true });
    if (!tickets.previousNumbers) await qi.addColumn('Tickets', 'previousNumbers', { type: Sequelize.JSON, allowNull: true });

    // Each company's tickets, oldest first, after any it already numbered.
    await run(`UPDATE Tickets t
      JOIN (SELECT id, ROW_NUMBER() OVER (PARTITION BY companyId ORDER BY id) AS n FROM Tickets WHERE companySeq IS NULL) r ON r.id = t.id
      JOIN (SELECT companyId, COALESCE(MAX(companySeq), 0) AS base FROM Tickets GROUP BY companyId) b ON b.companyId = t.companyId
      SET t.companySeq = b.base + r.n`);
    await run(`UPDATE Tickets t JOIN Companies c ON c.id = t.companyId
      SET t.number = CONCAT(c.code, '-T', ${PAD('t.companySeq')}),
          t.previousNumbers = JSON_ARRAY(${LEGACY('t.id')})
      WHERE t.number IS NULL`);
    // Task codes: "#00042-T04" → "WC-T0012-T04" (subtasks carry ticketId too).
    await run(`UPDATE Tasks k JOIN Tickets t ON t.id = k.ticketId
      SET k.code = CONCAT(t.number, SUBSTRING(k.code, LENGTH(CONCAT('#', ${LEGACY('t.id')})) + 1))
      WHERE BINARY k.code LIKE BINARY CONCAT('#', ${LEGACY('t.id')}, '-%')`);
    await run(`INSERT INTO CompanyCounters (companyId, kind, seq)
      SELECT companyId, 'ticket', MAX(companySeq) FROM Tickets WHERE companySeq IS NOT NULL GROUP BY companyId
      ON DUPLICATE KEY UPDATE seq = GREATEST(CompanyCounters.seq, VALUES(seq))`);

    const indexes = await qi.showIndex('Tickets');
    if (!indexes.some((i) => i.name === 'tickets_number_unique')) {
      await qi.addIndex('Tickets', ['number'], { unique: true, name: 'tickets_number_unique' });
    }
    if (!indexes.some((i) => i.name === 'tickets_company_seq_unique')) {
      await qi.addIndex('Tickets', ['companyId', 'companySeq'], { unique: true, name: 'tickets_company_seq_unique' });
    }
  },

  down: async (queryInterface) => {
    const qi = queryInterface;
    const tickets = await qi.describeTable('Tickets');
    if (tickets.number) {
      await qi.sequelize.query(`UPDATE Tasks k JOIN Tickets t ON t.id = k.ticketId
        SET k.code = CONCAT('#', ${LEGACY('t.id')}, SUBSTRING(k.code, LENGTH(t.number) + 1))
        WHERE t.number IS NOT NULL AND BINARY k.code LIKE BINARY CONCAT(t.number, '-%')`);
    }
    const indexes = await qi.showIndex('Tickets');
    for (const name of ['tickets_company_seq_unique', 'tickets_number_unique']) {
      if (indexes.some((i) => i.name === name)) await qi.removeIndex('Tickets', name); // eslint-disable-line no-await-in-loop
    }
    for (const col of ['previousNumbers', 'number', 'companySeq']) {
      if (tickets[col]) await qi.removeColumn('Tickets', col); // eslint-disable-line no-await-in-loop
    }
    const tables = (await qi.showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName));
    if (tables.includes('CompanyCounters')) await qi.dropTable('CompanyCounters');
  },
};
