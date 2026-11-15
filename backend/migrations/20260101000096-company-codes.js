'use strict';

// A code for every company and department (CN part 1).
//   + Companies.code (unique; WC), Companies.previousCodes (codes it had)
//   Departments.shortCode: every department gets one, unique within its
//   company (it was only on your own company's, unique across all).
// Codes are suggested from names (Washington County → WC, Human Resources →
// HR) and made unique (WC2). Your own company's departments keep theirs.

const { suggestCode, uniqueCode } = require('../src/services/codes');

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const qi = queryInterface;
    const select = (sql, replacements) => qi.sequelize.query(sql, { type: Sequelize.QueryTypes.SELECT, replacements });
    const run = (sql, replacements) => qi.sequelize.query(sql, { replacements });
    const cols = await qi.describeTable('Companies');
    if (!cols.code) await qi.addColumn('Companies', 'code', { type: Sequelize.STRING(6), allowNull: true });
    if (!cols.previousCodes) await qi.addColumn('Companies', 'previousCodes', { type: Sequelize.JSON, allowNull: true });

    const companies = await select('SELECT id, name, code FROM Companies ORDER BY isInternal DESC, id ASC');
    const taken = new Set(companies.map((c) => c.code).filter(Boolean));
    for (const c of companies) {
      if (c.code) continue; // eslint-disable-line no-continue
      const code = uniqueCode(suggestCode(c.name), taken, 6);
      taken.add(code);
      await run('UPDATE Companies SET code = :code WHERE id = :id', { code, id: c.id }); // eslint-disable-line no-await-in-loop
    }
    const indexes = await qi.showIndex('Companies');
    if (!indexes.some((i) => i.name === 'companies_code_unique')) {
      await qi.addIndex('Companies', ['code'], { unique: true, name: 'companies_code_unique' });
    }

    const departments = await select('SELECT id, companyId, name, shortCode FROM Departments ORDER BY id ASC');
    const byCompany = new Map();
    departments.forEach((d) => {
      if (!byCompany.has(d.companyId)) byCompany.set(d.companyId, new Set());
      if (d.shortCode) byCompany.get(d.companyId).add(d.shortCode.toUpperCase());
    });
    for (const d of departments) {
      if (d.shortCode) continue; // eslint-disable-line no-continue
      const used = byCompany.get(d.companyId);
      const code = uniqueCode(suggestCode(d.name, { max: 6, single: 3 }), used, 6);
      used.add(code);
      await run('UPDATE Departments SET shortCode = :code WHERE id = :id', { code, id: d.id }); // eslint-disable-line no-await-in-loop
    }
  },

  down: async (queryInterface) => {
    const cols = await queryInterface.describeTable('Companies');
    const indexes = await queryInterface.showIndex('Companies');
    if (indexes.some((i) => i.name === 'companies_code_unique')) await queryInterface.removeIndex('Companies', 'companies_code_unique');
    if (cols.previousCodes) await queryInterface.removeColumn('Companies', 'previousCodes');
    if (cols.code) await queryInterface.removeColumn('Companies', 'code');
    // Customer departments' codes stay: harmless, and unknown which were new.
  },
};
