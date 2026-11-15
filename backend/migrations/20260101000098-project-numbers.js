'use strict';

// Projects numbered per company (CN part 3).
//   + Projects.companySeq; projectCode becomes WC-HR-P0007 (for a department
//     of the project's company) or WC-P0006 (for the whole company), counted
//     per company in CompanyCounters (kind 'project').
//   + Projects.previousCodes (codes it had: SD-P00007 from before CN).
//   + Projects.showInPortal: on for customer projects, off for your own.
//   + ProjectContacts: customer contacts named on a project (they see it in
//     the portal).
// A project "for" a department of another company (the old default made
// customer projects "for" the department doing the work) becomes for the
// whole company. Task codes follow (SD-P00007-T04 → WC-HR-P0007-T04).

const PAD = (col) => `IF(${col} > 9999, CAST(${col} AS CHAR), LPAD(${col}, 4, '0'))`;
const FIRST_PREVIOUS = "JSON_UNQUOTE(JSON_EXTRACT(p.previousCodes, '$[0]'))";

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const qi = queryInterface;
    const run = (sql) => qi.sequelize.query(sql);
    const cols = await qi.describeTable('Projects');
    if (!cols.companySeq) await qi.addColumn('Projects', 'companySeq', { type: Sequelize.INTEGER, allowNull: true });
    if (!cols.previousCodes) await qi.addColumn('Projects', 'previousCodes', { type: Sequelize.JSON, allowNull: true });
    const fresh = !cols.showInPortal;
    if (fresh) await qi.addColumn('Projects', 'showInPortal', { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false });
    const tables = (await qi.showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName));
    if (!tables.includes('ProjectContacts')) {
      await qi.createTable('ProjectContacts', {
        projectId: {
          type: Sequelize.INTEGER, allowNull: false, primaryKey: true, references: { model: 'Projects', key: 'id' }, onDelete: 'CASCADE',
        },
        contactId: {
          type: Sequelize.INTEGER, allowNull: false, primaryKey: true, references: { model: 'Contacts', key: 'id' }, onDelete: 'CASCADE',
        },
        createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      });
      await qi.addIndex('ProjectContacts', ['contactId'], { name: 'project_contacts_contact' });
    }
    if (!tables.includes('CompanyCounters')) {
      await qi.createTable('CompanyCounters', {
        companyId: { type: Sequelize.INTEGER, allowNull: false, primaryKey: true },
        kind: { type: Sequelize.STRING(16), allowNull: false, primaryKey: true },
        seq: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      });
    }

    // Customer projects show in their portal; your own don't.
    if (fresh) {
      await run('UPDATE Projects p JOIN Companies c ON c.id = p.companyId SET p.showInPortal = 1 WHERE c.isInternal = 0');
    }
    // "For" is the project's own company's department, or the whole company.
    await run(`UPDATE Projects p LEFT JOIN Departments d ON d.id = p.forDepartmentId
      SET p.forDepartmentId = NULL
      WHERE p.forDepartmentId IS NOT NULL AND (d.id IS NULL OR d.companyId <> p.companyId)`);

    // Each company's projects, oldest first, after any it already numbered.
    await run(`UPDATE Projects p
      JOIN (SELECT id, ROW_NUMBER() OVER (PARTITION BY companyId ORDER BY id) AS n FROM Projects WHERE companySeq IS NULL) r ON r.id = p.id
      JOIN (SELECT companyId, COALESCE(MAX(companySeq), 0) AS base FROM Projects GROUP BY companyId) b ON b.companyId = p.companyId
      SET p.companySeq = b.base + r.n,
          p.previousCodes = IF(p.projectCode IS NULL, JSON_ARRAY(), JSON_ARRAY(p.projectCode))`);
    // Then the new code, for those still on their old one (or none).
    await run(`UPDATE Projects p JOIN Companies c ON c.id = p.companyId LEFT JOIN Departments d ON d.id = p.forDepartmentId
      SET p.projectCode = CONCAT(c.code, IF(d.shortCode IS NULL OR d.shortCode = '', '', CONCAT('-', d.shortCode)), '-P', ${PAD('p.companySeq')})
      WHERE p.companySeq IS NOT NULL
        AND ((p.projectCode IS NULL AND COALESCE(JSON_LENGTH(p.previousCodes), 0) = 0)
          OR BINARY p.projectCode = BINARY ${FIRST_PREVIOUS})`);
    // Task codes: the old project code at the front becomes the new one.
    await run(`UPDATE Tasks k JOIN Projects p ON p.id = k.projectId
      SET k.code = CONCAT(p.projectCode, SUBSTRING(k.code, LENGTH(${FIRST_PREVIOUS}) + 1))
      WHERE ${FIRST_PREVIOUS} IS NOT NULL AND BINARY k.code LIKE BINARY CONCAT(${FIRST_PREVIOUS}, '-%')`);
    await run(`INSERT INTO CompanyCounters (companyId, kind, seq)
      SELECT companyId, 'project', MAX(companySeq) FROM Projects WHERE companySeq IS NOT NULL GROUP BY companyId
      ON DUPLICATE KEY UPDATE seq = GREATEST(CompanyCounters.seq, VALUES(seq))`);

    const indexes = await qi.showIndex('Projects');
    if (!indexes.some((i) => i.name === 'projects_company_seq_unique')) {
      await qi.addIndex('Projects', ['companyId', 'companySeq'], { unique: true, name: 'projects_company_seq_unique' });
    }
  },

  down: async (queryInterface) => {
    const qi = queryInterface;
    const run = (sql) => qi.sequelize.query(sql);
    const cols = await qi.describeTable('Projects');
    if (cols.previousCodes) {
      // Back to the code each project had before CN (a project made since
      // keeps its new one).
      await run(`UPDATE Tasks k JOIN Projects p ON p.id = k.projectId
        SET k.code = CONCAT(${FIRST_PREVIOUS}, SUBSTRING(k.code, LENGTH(p.projectCode) + 1))
        WHERE ${FIRST_PREVIOUS} IS NOT NULL AND BINARY k.code LIKE BINARY CONCAT(p.projectCode, '-%')`);
      await run(`UPDATE Projects p SET p.projectCode = ${FIRST_PREVIOUS} WHERE ${FIRST_PREVIOUS} IS NOT NULL`);
    }
    const indexes = await qi.showIndex('Projects');
    if (indexes.some((i) => i.name === 'projects_company_seq_unique')) await qi.removeIndex('Projects', 'projects_company_seq_unique');
    const tables = (await qi.showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName));
    if (tables.includes('ProjectContacts')) await qi.dropTable('ProjectContacts');
    if (tables.includes('CompanyCounters')) await run("DELETE FROM CompanyCounters WHERE kind = 'project'");
    for (const col of ['showInPortal', 'previousCodes', 'companySeq']) {
      if (cols[col]) await qi.removeColumn('Projects', col); // eslint-disable-line no-await-in-loop
    }
  },
};
