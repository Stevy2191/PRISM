'use strict';

// Every phone number is stored as 10 bare digits and shown as
// (XXX) XXX-XXXX (owner, 2026-11-15). Users, contacts and devices already
// were; companies, sites and contracts kept whatever was typed. This puts
// every stored number that is 10 digits (or 11 starting with 1) into that
// form; anything else (an extension, a number from abroad) is left alone.
// Nothing to undo: the digits are the same number.

const COLUMNS = [
  ['Companies', 'phone'], ['Sites', 'phone'], ['Contracts', 'contactPhone'],
  ['Contacts', 'phone'], ['Contacts', 'mobile'], ['Users', 'phone'], ['Assets', 'phoneNumber'],
];

const digitsOf = (value) => {
  const d = String(value).replace(/\D/g, '');
  return d.length === 11 && d.startsWith('1') ? d.slice(1) : d;
};

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const { sequelize } = queryInterface;
    const tables = (await queryInterface.showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName));
    for (const [table, column] of COLUMNS) {
      if (!tables.includes(table)) continue; // eslint-disable-line no-continue
      // eslint-disable-next-line no-await-in-loop
      const cols = await queryInterface.describeTable(table);
      if (!cols[column]) continue; // eslint-disable-line no-continue
      // eslint-disable-next-line no-await-in-loop
      const rows = await sequelize.query(`SELECT id, \`${column}\` AS v FROM \`${table}\` WHERE \`${column}\` IS NOT NULL AND \`${column}\` <> ''`, { type: Sequelize.QueryTypes.SELECT });
      for (const row of rows) {
        const d = digitsOf(row.v);
        if (d.length === 10 && d !== row.v) {
          // eslint-disable-next-line no-await-in-loop
          await sequelize.query(`UPDATE \`${table}\` SET \`${column}\` = ? WHERE id = ?`, { replacements: [d, row.id] });
        }
      }
    }
  },
  down: async () => {},
};
