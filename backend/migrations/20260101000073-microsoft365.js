'use strict';

// Client portal, Microsoft 365 (sub-project 7b).
//   Companies            msTenantId: the one Microsoft 365 tenant linked to
//                        this company (unique: a tenant belongs to one company);
//                        msConsentAt: when its admin approved the app;
//                        msSyncGroups: [{id,name}] whose members may sign in
//                        and are synced; msLastSync: the last sync's summary.
//   Contacts             msObjectId: the person's Entra object id (unique
//                        within a company); msDepartmentName: the department
//                        Microsoft 365 reports for them.
//   DetectedDepartments  department names seen in Microsoft 365 with no
//                        matching PRISM department, to create or map.
// The app registration (portal.msClientId / portal.msClientSecret) lives in
// SystemSettings and needs no migration: unset reads as the default ''.

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const qi = queryInterface;
    const dt = Sequelize;
    const tables = (await qi.showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName));

    const companies = await qi.describeTable('Companies');
    if (!companies.msTenantId) {
      await qi.addColumn('Companies', 'msTenantId', { type: dt.STRING(36), allowNull: true });
      await qi.addIndex('Companies', ['msTenantId'], { unique: true, name: 'companies_ms_tenant' });
    }
    if (!companies.msConsentAt) await qi.addColumn('Companies', 'msConsentAt', { type: dt.DATE, allowNull: true });
    // NULL reads as no groups (the model returns []): MariaDB's JSON is
    // LONGTEXT, which can't carry a default on every supported version.
    if (!companies.msSyncGroups) await qi.addColumn('Companies', 'msSyncGroups', { type: dt.JSON, allowNull: true });
    if (!companies.msLastSync) await qi.addColumn('Companies', 'msLastSync', { type: dt.JSON, allowNull: true });

    const contacts = await qi.describeTable('Contacts');
    if (!contacts.msObjectId) {
      await qi.addColumn('Contacts', 'msObjectId', { type: dt.STRING(36), allowNull: true });
      await qi.addIndex('Contacts', ['companyId', 'msObjectId'], { unique: true, name: 'contacts_company_ms_object' });
    }
    if (!contacts.msDepartmentName) await qi.addColumn('Contacts', 'msDepartmentName', { type: dt.STRING(150), allowNull: true });

    if (!tables.includes('DetectedDepartments')) {
      await qi.createTable('DetectedDepartments', {
        id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
        companyId: {
          type: dt.INTEGER, allowNull: false, references: { model: 'Companies', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE',
        },
        name: { type: dt.STRING(150), allowNull: false },
        normalized: { type: dt.STRING(150), allowNull: false },
        peopleCount: { type: dt.INTEGER, allowNull: false, defaultValue: 0 },
        mappedDepartmentId: {
          type: dt.INTEGER, allowNull: true, references: { model: 'Departments', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL',
        },
        createdAt: { type: dt.DATE, allowNull: false },
        updatedAt: { type: dt.DATE, allowNull: false },
      });
      await qi.addIndex('DetectedDepartments', ['companyId', 'normalized'], { unique: true, name: 'detected_departments_company_name' });
    }
  },

  down: async (queryInterface) => {
    const qi = queryInterface;
    const tables = (await qi.showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName));
    if (tables.includes('DetectedDepartments')) await qi.dropTable('DetectedDepartments');

    const contacts = await qi.describeTable('Contacts');
    if (contacts.msObjectId) {
      // The pair index goes first: MariaDB won't drop a column in a multi-column index.
      if ((await qi.showIndex('Contacts')).some((i) => i.name === 'contacts_company_ms_object')) {
        await qi.removeIndex('Contacts', 'contacts_company_ms_object');
      }
      await qi.removeColumn('Contacts', 'msObjectId');
    }
    if (contacts.msDepartmentName) await qi.removeColumn('Contacts', 'msDepartmentName');

    const companies = await qi.describeTable('Companies');
    for (const col of ['msLastSync', 'msSyncGroups', 'msConsentAt', 'msTenantId']) {
      // eslint-disable-next-line no-await-in-loop
      if (companies[col]) await qi.removeColumn('Companies', col);
    }
  },
};
