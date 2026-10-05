'use strict';

// Client companies (sub-project 2). Every record gets a company; the
// organization itself becomes the one internal company, so an upgraded
// install behaves exactly as before. Free-text vendors become vendor
// companies (the text columns stay one release as a safety net).
// Conventions: no DB-level FKs, idempotent guards, working down().
// See docs/superpowers/specs/2026-10-04-client-companies-design.md.

const COMPANY_TABLES = ['Departments', 'Contacts', 'Tickets', 'Projects', 'Assets', 'Licenses', 'Contracts'];
const SITE_TABLES = ['Contacts', 'Assets'];
const VENDOR_SOURCES = [['Assets', 'vendorName'], ['Licenses', 'vendor'], ['Contracts', 'vendor'], ['ProjectMaterials', 'vendor']];

const PERMISSIONS = [
  { key: 'companies.view', category: 'companies', label: 'View companies', description: 'See client and vendor companies, their sites, departments and domains' },
  { key: 'companies.manage', category: 'companies', label: 'Manage companies', description: 'Create, edit, merge, deactivate and delete companies; manage sites, domains and client departments' },
  { key: 'companies.manage_access', category: 'companies', label: 'Manage company access', description: 'Choose which companies a user or role can reach' },
];
const ROLE_GRANTS = {
  'System Administrator': ['companies.view', 'companies.manage', 'companies.manage_access'],
  'System Technician': ['companies.view'],
  'Department Manager': ['companies.view'],
};

async function tableNames(queryInterface) {
  return (await queryInterface.showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName));
}

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const { DataTypes: dt, QueryTypes } = Sequelize;
    const now = { type: dt.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') };
    const select = (sql, replacements) => queryInterface.sequelize.query(sql, { type: QueryTypes.SELECT, replacements });
    const tables = await tableNames(queryInterface);

    if (!tables.includes('Companies')) {
      await queryInterface.createTable('Companies', {
        id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
        name: { type: dt.STRING(150), allowNull: false },
        isInternal: { type: dt.BOOLEAN, allowNull: false, defaultValue: false },
        isClient: { type: dt.BOOLEAN, allowNull: false, defaultValue: false },
        isVendor: { type: dt.BOOLEAN, allowNull: false, defaultValue: false },
        status: { type: dt.ENUM('active', 'inactive'), allowNull: false, defaultValue: 'active' },
        phone: { type: dt.STRING(50), allowNull: true },
        website: { type: dt.STRING(255), allowNull: true },
        notes: { type: dt.TEXT, allowNull: true },
        accountManagerId: { type: dt.INTEGER, allowNull: true },
        createdAt: now,
        updatedAt: now,
      });
      await queryInterface.addIndex('Companies', ['name'], { name: 'companies_name' });
    }
    if (!tables.includes('CompanyDomains')) {
      await queryInterface.createTable('CompanyDomains', {
        id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
        companyId: { type: dt.INTEGER, allowNull: false },
        domain: { type: dt.STRING(253), allowNull: false, unique: true },
        createdAt: now,
        updatedAt: now,
      });
      await queryInterface.addIndex('CompanyDomains', ['companyId'], { name: 'company_domains_company_id' });
    }
    if (!tables.includes('Sites')) {
      await queryInterface.createTable('Sites', {
        id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
        companyId: { type: dt.INTEGER, allowNull: false },
        name: { type: dt.STRING(150), allowNull: false },
        line1: { type: dt.STRING(200), allowNull: true },
        line2: { type: dt.STRING(200), allowNull: true },
        city: { type: dt.STRING(100), allowNull: true },
        region: { type: dt.STRING(100), allowNull: true },
        postalCode: { type: dt.STRING(20), allowNull: true },
        country: { type: dt.STRING(100), allowNull: true },
        phone: { type: dt.STRING(50), allowNull: true },
        notes: { type: dt.TEXT, allowNull: true },
        status: { type: dt.ENUM('active', 'inactive'), allowNull: false, defaultValue: 'active' },
        createdAt: now,
        updatedAt: now,
      });
      await queryInterface.addIndex('Sites', ['companyId', 'name'], { unique: true, name: 'sites_company_name' });
    }
    for (const [table, key] of [['UserCompanyAccess', 'userId'], ['RoleCompanyAccess', 'roleId']]) {
      if (!tables.includes(table)) {
        // eslint-disable-next-line no-await-in-loop
        await queryInterface.createTable(table, {
          id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
          [key]: { type: dt.INTEGER, allowNull: false },
          companyId: { type: dt.INTEGER, allowNull: false },
          createdAt: now,
        });
        // eslint-disable-next-line no-await-in-loop
        await queryInterface.addIndex(table, [key, 'companyId'], { unique: true, name: `${table.toLowerCase()}_unique` });
      }
    }

    const userCols = await queryInterface.describeTable('Users');
    if (!userCols.allCompanies) {
      await queryInterface.addColumn('Users', 'allCompanies', { type: dt.BOOLEAN, allowNull: false, defaultValue: true });
    }

    // The internal company — named after the organization.
    let [internal] = await select('SELECT id FROM Companies WHERE isInternal = 1 LIMIT 1');
    if (!internal) {
      const [setting] = await select("SELECT value FROM SystemSettings WHERE `key` = 'company.name' LIMIT 1");
      const name = (setting && setting.value && setting.value.trim()) || 'Internal';
      await queryInterface.bulkInsert('Companies', [{ name, isInternal: true, isClient: false, isVendor: false, status: 'active' }]);
      [internal] = await select('SELECT id FROM Companies WHERE isInternal = 1 LIMIT 1');
    }

    for (const table of COMPANY_TABLES) {
      // eslint-disable-next-line no-await-in-loop
      const cols = await queryInterface.describeTable(table);
      if (!cols.companyId) {
        // eslint-disable-next-line no-await-in-loop
        await queryInterface.addColumn(table, 'companyId', { type: dt.INTEGER, allowNull: true });
        // eslint-disable-next-line no-await-in-loop
        await queryInterface.sequelize.query(`UPDATE \`${table}\` SET companyId = :id WHERE companyId IS NULL`, { replacements: { id: internal.id } });
        // eslint-disable-next-line no-await-in-loop
        await queryInterface.changeColumn(table, 'companyId', { type: dt.INTEGER, allowNull: false });
        // eslint-disable-next-line no-await-in-loop
        await queryInterface.addIndex(table, ['companyId'], { name: `${table.toLowerCase()}_company_id` });
      }
    }
    for (const table of SITE_TABLES) {
      // eslint-disable-next-line no-await-in-loop
      const cols = await queryInterface.describeTable(table);
      if (!cols.siteId) {
        // eslint-disable-next-line no-await-in-loop
        await queryInterface.addColumn(table, 'siteId', { type: dt.INTEGER, allowNull: true });
        // eslint-disable-next-line no-await-in-loop
        await queryInterface.addIndex(table, ['siteId'], { name: `${table.toLowerCase()}_site_id` });
      }
    }
    for (const [table] of VENDOR_SOURCES) {
      // eslint-disable-next-line no-await-in-loop
      const cols = await queryInterface.describeTable(table);
      if (!cols.vendorCompanyId) {
        // eslint-disable-next-line no-await-in-loop
        await queryInterface.addColumn(table, 'vendorCompanyId', { type: dt.INTEGER, allowNull: true });
        // eslint-disable-next-line no-await-in-loop
        await queryInterface.addIndex(table, ['vendorCompanyId'], { name: `${table.toLowerCase()}_vendor_company_id` });
      }
    }

    // Department names were unique across the whole install; now a client
    // may have its own "HR", so names are unique per company.
    const deptIndexes = await queryInterface.showIndex('Departments');
    if (deptIndexes.some((i) => i.name === 'name')) await queryInterface.removeIndex('Departments', 'name');
    if (!deptIndexes.some((i) => i.name === 'departments_company_name')) {
      await queryInterface.addIndex('Departments', ['companyId', 'name'], { unique: true, name: 'departments_company_name' });
    }

    // Vendor text → vendor companies, one per name ignoring case and
    // surrounding spaces; the first spelling seen names the company.
    const spellings = new Map();
    for (const [table, col] of VENDOR_SOURCES) {
      // eslint-disable-next-line no-await-in-loop
      const rows = await select(`SELECT DISTINCT \`${col}\` AS v FROM \`${table}\` WHERE \`${col}\` IS NOT NULL AND TRIM(\`${col}\`) <> ''`);
      rows.forEach(({ v }) => {
        const key = v.trim().toLowerCase();
        if (!spellings.has(key)) spellings.set(key, v.trim().slice(0, 150));
      });
    }
    for (const [key, name] of spellings) {
      // eslint-disable-next-line no-await-in-loop
      let [vendor] = await select('SELECT id FROM Companies WHERE isVendor = 1 AND LOWER(name) = :key LIMIT 1', { key });
      if (!vendor) {
        // eslint-disable-next-line no-await-in-loop
        await queryInterface.bulkInsert('Companies', [{ name, isInternal: false, isClient: false, isVendor: true, status: 'active' }]);
        // eslint-disable-next-line no-await-in-loop
        [vendor] = await select('SELECT id FROM Companies WHERE isVendor = 1 AND LOWER(name) = :key ORDER BY id DESC LIMIT 1', { key });
      }
      for (const [table, col] of VENDOR_SOURCES) {
        // eslint-disable-next-line no-await-in-loop
        await queryInterface.sequelize.query(
          `UPDATE \`${table}\` SET vendorCompanyId = :id WHERE vendorCompanyId IS NULL AND LOWER(TRIM(\`${col}\`)) = :key`,
          { replacements: { id: vendor.id, key } }
        );
      }
    }

    // Permissions, same pattern as 20260101000046-knowledge-base-permissions.
    const keys = PERMISSIONS.map((p) => p.key);
    const existing = new Set((await select('SELECT `key` FROM Permissions WHERE `key` IN (:keys)', { keys })).map((r) => r.key));
    const toInsert = PERMISSIONS.filter((p) => !existing.has(p.key)).map((p) => ({ ...p, createdAt: new Date() }));
    if (toInsert.length) await queryInterface.bulkInsert('Permissions', toInsert);
    const permIdByKey = new Map((await select('SELECT id, `key` FROM Permissions WHERE `key` IN (:keys)', { keys })).map((r) => [r.key, r.id]));
    const roleIdByName = new Map((await select('SELECT id, name FROM Roles WHERE name IN (:names)', { names: Object.keys(ROLE_GRANTS) })).map((r) => [r.name, r.id]));
    const granted = new Set((await select('SELECT roleId, permissionId FROM RolePermissions WHERE permissionId IN (:ids)', { ids: [...permIdByKey.values()] })).map((r) => `${r.roleId}:${r.permissionId}`));
    const grants = [];
    for (const [roleName, roleKeys] of Object.entries(ROLE_GRANTS)) {
      const roleId = roleIdByName.get(roleName);
      if (roleId) {
        roleKeys.forEach((k) => {
          const permissionId = permIdByKey.get(k);
          if (permissionId && !granted.has(`${roleId}:${permissionId}`)) grants.push({ roleId, permissionId, granted: true });
        });
      }
    }
    if (grants.length) await queryInterface.bulkInsert('RolePermissions', grants);
  },

  down: async (queryInterface, Sequelize) => {
    const { QueryTypes } = Sequelize;
    const select = (sql, replacements) => queryInterface.sequelize.query(sql, { type: QueryTypes.SELECT, replacements });
    const tables = await tableNames(queryInterface);
    if (!tables.includes('Companies')) return;

    // Rolling back would silently drop client data the old schema can't hold.
    // Vendor companies alone are fine: their text columns were never removed.
    const [internal] = await select('SELECT id FROM Companies WHERE isInternal = 1 LIMIT 1');
    const [{ clients }] = await select('SELECT COUNT(*) AS clients FROM Companies WHERE isInternal = 0 AND isVendor = 0 OR isClient = 1');
    let foreign = 0;
    if (internal) {
      for (const table of COMPANY_TABLES) {
        // eslint-disable-next-line no-await-in-loop
        const cols = await queryInterface.describeTable(table);
        if (cols.companyId) {
          // eslint-disable-next-line no-await-in-loop
          const [{ n }] = await select(`SELECT COUNT(*) AS n FROM \`${table}\` WHERE companyId <> :id`, { id: internal.id });
          foreign += Number(n);
        }
      }
    }
    if (Number(clients) > 0 || foreign > 0) {
      throw new Error('Client companies exist (or records belong to a non-internal company); refusing to roll back and lose them.');
    }

    const permRows = await select("SELECT id FROM Permissions WHERE `key` LIKE 'companies.%'");
    if (permRows.length) {
      const ids = permRows.map((r) => r.id);
      await queryInterface.bulkDelete('RolePermissions', { permissionId: ids });
      await queryInterface.bulkDelete('Permissions', { id: ids });
    }

    const deptIndexes = await queryInterface.showIndex('Departments');
    if (deptIndexes.some((i) => i.name === 'departments_company_name')) await queryInterface.removeIndex('Departments', 'departments_company_name');
    if (!deptIndexes.some((i) => i.name === 'name')) await queryInterface.addIndex('Departments', ['name'], { unique: true, name: 'name' });

    for (const [table] of VENDOR_SOURCES) {
      // eslint-disable-next-line no-await-in-loop
      if ((await queryInterface.describeTable(table)).vendorCompanyId) await queryInterface.removeColumn(table, 'vendorCompanyId');
    }
    for (const table of SITE_TABLES) {
      // eslint-disable-next-line no-await-in-loop
      if ((await queryInterface.describeTable(table)).siteId) await queryInterface.removeColumn(table, 'siteId');
    }
    for (const table of COMPANY_TABLES) {
      // eslint-disable-next-line no-await-in-loop
      if ((await queryInterface.describeTable(table)).companyId) await queryInterface.removeColumn(table, 'companyId');
    }
    if ((await queryInterface.describeTable('Users')).allCompanies) await queryInterface.removeColumn('Users', 'allCompanies');
    for (const table of ['RoleCompanyAccess', 'UserCompanyAccess', 'Sites', 'CompanyDomains', 'Companies']) {
      // eslint-disable-next-line no-await-in-loop
      if (tables.includes(table)) await queryInterface.dropTable(table);
    }
  },
};
