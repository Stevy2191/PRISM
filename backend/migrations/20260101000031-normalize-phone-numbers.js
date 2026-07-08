'use strict';

// One-time cleanup: strips existing Users.phone and Contacts.phone/mobile
// down to raw digits so they match the new "DB stores 10 clean digits only,
// frontend formats as (XXX) XXX-XXXX for display" convention. Anything that
// doesn't normalize to exactly 10 digits is set to null and logged — kept as
// a self-contained inline function (not a require of src/utils/phone) since
// a migration is a frozen snapshot that shouldn't depend on application code
// that may change later.
function normalize(value) {
  if (value === null || value === undefined || value === '') return null;
  const digits = String(value).replace(/\D/g, '');
  if (digits.length === 10) return digits;
  return null;
}

async function cleanTable(queryInterface, table, columns, logger) {
  const { QueryTypes } = require('sequelize');
  const rows = await queryInterface.sequelize.query(
    `SELECT id, ${columns.join(', ')} FROM ${table}`,
    { type: QueryTypes.SELECT }
  );

  // eslint-disable-next-line no-restricted-syntax
  for (const row of rows) {
    const changes = {};
    columns.forEach((col) => {
      const before = row[col];
      if (before === null || before === undefined || before === '') return;
      const after = normalize(before);
      if (after !== before) {
        changes[col] = after;
        if (after === null) {
          logger.push(`${table}#${row.id}.${col}: "${before}" -> null (could not normalize to 10 digits)`);
        } else {
          logger.push(`${table}#${row.id}.${col}: "${before}" -> "${after}"`);
        }
      }
    });
    if (Object.keys(changes).length) {
      const setClause = Object.keys(changes).map((c) => `${c} = :${c}`).join(', ');
      // eslint-disable-next-line no-await-in-loop
      await queryInterface.sequelize.query(
        `UPDATE ${table} SET ${setClause} WHERE id = :id`,
        { replacements: { ...changes, id: row.id } }
      );
    }
  }
}

module.exports = {
  up: async (queryInterface) => {
    const logger = [];
    await cleanTable(queryInterface, 'Users', ['phone'], logger);
    await cleanTable(queryInterface, 'Contacts', ['phone', 'mobile'], logger);

    if (logger.length) {
      // eslint-disable-next-line no-console
      console.log(`[normalize-phone-numbers] Normalized ${logger.length} phone value(s):`);
      // eslint-disable-next-line no-console
      logger.forEach((line) => console.log(`  ${line}`));
    } else {
      // eslint-disable-next-line no-console
      console.log('[normalize-phone-numbers] No phone values needed normalization.');
    }
  },

  // Not reversible — the original (possibly inconsistently formatted) values
  // are logged above but not preserved in the DB, so down() is a no-op.
  down: async () => {},
};
