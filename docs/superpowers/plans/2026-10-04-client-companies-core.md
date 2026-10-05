# Client Companies — Core (Plan 2a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give PRISM its company spine on the backend. That covers:
- the migration;
- the company, site, domain and company-access APIs;
- a company fence on every list, report and single-record route;
- the ticket and contact rules that keep records in the right company;
- inbound-email domain matching.

An upgraded one-company install must behave exactly as it does today.

**Architecture:** Real `companyId` columns, backfilled to an internal company by one reversible migration.
- Model hooks set a sensible company on every record, whatever code path creates it. A ticket always takes its contact's company, and a contact that moves company takes its tickets with it.
- Scope lives in two places only:
  - `permissionService`, for company access and single-record checks;
  - a new `services/recordScope.js`, which replaces the five near-copies of "which tickets can this user see".
- Resource routers with no record-level scope today (assets, licenses, contracts) get one `router.param('id')` fence each.

**Tech Stack:** Node 24.9+, Express 4, Sequelize 6 on MariaDB 11, Jest 30 + supertest (the sub-project 1 harness). No new dependencies.

**Spec:** [`docs/superpowers/specs/2026-10-04-client-companies-design.md`](../specs/2026-10-04-client-companies-design.md). Read it first.

**This is plan 2a of two.** It has no frontend changes and no vendor/merge/CSV work. Plan 2b, written after this one ships, covers:
- the vendor pickers and `vendorCompanyId` in the asset, license, contract and material APIs;
- merge;
- the CSV import company column;
- every screen.

Plan 2a's migration already creates the vendor companies and links them, so plan 2b only adds the APIs and UI on top.

## Global Constraints

- Node `>=24.9`. Run tests from `backend/`:
  - one file: `npm test -- <file>`;
  - everything: `npm test`.
  
  Don't use `npm run test:integration -- <file>`, which runs every integration suite. The test DB is the `prism-test-db` container on `127.0.0.1:3307`. If it's stopped, run `docker start prism-test-db`. If it's missing, see the sub-project 1 plan's Global Constraints for how to recreate it.
- After adding the migration, run `npm run test:migrate` before running tests.
- Migrations follow the repo convention:
  - no DB-level foreign keys (plain `INTEGER` columns plus Sequelize associations);
  - idempotent guards;
  - table lists normalised with `(await queryInterface.showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName))`;
  - a working `down()`.
- **Security is paramount** (the user's standing rule), covering both access control and code safety. Every new mutating endpoint is permission-checked and audited. Every fetch-by-id re-checks company and tier. Every id from a request body goes through `parseRecordId`, and the checked record's id is what gets stored. Never build SQL by string concatenation of request values; use replacements or the ORM.
- Link fields keep sub-project 1's rule: a missing id and an out-of-scope id get the same response.
- The whole existing suite (currently 637 tests) must pass unchanged. A baseline test that has to change is a ruling, recorded in the ledger with the reason.
- No new file over roughly 800 lines. `ticketsController.js`, `projectsController.js`, `contactsController.js` and `reportsController.js` get only the targeted edits listed here; their splitting belongs to sub-project 3 (the user's ruling).
- Commit after every task. End each message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Work on `dev`.
- When an assertion in this plan disagrees with the code:
  - if the plan misread the code, fix the assertion and ledger it;
  - if it's a harmless bug, pin it as a quirk in the sub-project 1 style;
  - if it's a security or access bug, stop and raise it with the user.

## Review Focus

1. **A user fenced to company A, reaching B through a back door.** Each of these must refuse B, the same way a missing id is refused:
   - a link field that points at B's record (a ticket's contact, an asset's ticket, a license's contact);
   - a report filter `?departmentId=<B's department>`;
   - search;
   - the calendar.
   
   Covered by Task 4, case 4; Task 6, cases 9–11; Task 9, cases 6–9 and 12; Task 10's report tables.
2. **Records created by code that isn't an HTTP handler.** Inbound email, AD sync, the asset-alert scheduler and the tests' own `Model.create` calls must land in a sensible company, never `NULL`. (Task 3, cases 1–4; Task 9, case 11.)
3. **A contact moving company:** its open *and* closed tickets move, and its department and site are cleared if they belong to the old company. (Task 3, cases 5–7; Task 8, cases 8–10.)
4. **A role-granted company plus a user-granted company:** the user sees both. Removing either grant takes effect immediately, with no stale cache. (Task 4, cases 5–7.)
5. **A one-company install:** every existing endpoint behaves as before, and no response loses a field. (Task 3, step 5 and every task's full-suite run.)

---
### Task 1: S9 — editing and deleting a contact checks scope; one contact-access rule

Found while planning. `PATCH /contacts/:id` and `DELETE /contacts/:id` check only the route permission:
- `tickets.create` is enough to edit a contact, so Department Staff qualify;
- delete needs `people.edit_users`.

Neither checks *which* contact. So Department Staff can rewrite any contact's email, phone or department. And the contact checks that *do* exist (`get`, `listTickets`, `listActivity`, S7's `findAccessibleContact`, S8's `assignDepartment`) are four copies of the same rule. This task makes them one rule, `canAccessContact`, which Task 5 later extends with the company fence.

**Files:**
- Modify: `backend/src/services/permissionService.js` (add `canAccessContact`; `findAccessibleContact` calls it)
- Modify: `backend/src/controllers/contactsController.js` (`get`, `update`, `remove`, `listTickets`, `listActivity`, `assignDepartment` use it)
- Test: `backend/test/integration/contacts.department.test.js` (append)

**Interfaces:**
- Produces: `canAccessContact(user, contact) → Promise<boolean>`, which is true when either:
  - the user holds `people.view_all`; or
  - `contact.departmentId != null && contact.departmentId === user.departmentId`; or
  - `contact.departmentId == null && contact.createdBy === user.id`.
  
  Task 5 adds the company check in front of this. `findAccessibleContact(user, id)` becomes `parseRecordId` → `findByPk` → `canAccessContact`.

- [ ] **Step 1: Write the failing tests** (append to `contacts.department.test.js`)

```js
describe('S9: editing and deleting a contact checks scope', () => {
  it('refuses to edit another department\'s contact', async () => {
    const res = await staff.agent.patch(`${API}/contacts/${contactB.id}`).send({ email: 'hijack@example.com' });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: true, message: 'You do not have access to this contact', code: 'FORBIDDEN' });
    expect(expectOk(await w.admin.agent.get(`${API}/contacts/${contactB.id}`)).contact.email).not.toBe('hijack@example.com');
  });

  it('refuses to delete another department\'s contact', async () => {
    // Department Manager holds people.edit_users (the delete route's gate) but
    // only people.view_own_department.
    const mgr = await makeManager('mgr', w.deptA.id);
    const res = await mgr.agent.delete(`${API}/contacts/${contactB.id}?force=true`);
    expect(res.status).toBe(403);
    expect((await w.admin.agent.get(`${API}/contacts/${contactB.id}`)).status).toBe(200);
  });

  it('still lets users edit contacts in their own department, and ones they created', async () => {
    expect((await staff.agent.patch(`${API}/contacts/${w.contact.id}`).send({ jobTitle: 'Clerk' })).status).toBe(200);
    const mine = expectOk(await staff.agent.post(`${API}/contacts`).send({ firstName: 'Mine', email: 'mine@example.com' }), 201).contact;
    expect((await staff.agent.patch(`${API}/contacts/${mine.id}`).send({ jobTitle: 'Clerk' })).status).toBe(200);
    expect((await staff.agent.get(`${API}/contacts/${mine.id}`)).status).toBe(200);
  });

  it('a missing contact is still a 404', async () => {
    expect((await staff.agent.patch(`${API}/contacts/99999`).send({ jobTitle: 'x' })).status).toBe(404);
  });
});
```

Add `makeManager` to the file's fixtures import.

- [ ] **Step 2: Run them and watch the gap**

Run: `cd backend && npm test -- contacts.department.test.js`
Expected: FAIL. Edit gets 200 instead of 403. Delete gets 200 instead of 403. GET of a contact you created yourself with no department gets 403, because today's `get` has no own-created exception.

- [ ] **Step 3: Implement `canAccessContact` and use it everywhere**

In `permissionService.js`, add this before `findAccessibleContact` and export it:

```js
// The one rule for "may this user see/act on this contact": people.view_all,
// or a contact in the user's own department, or a contact with no department
// that the user created (the new-ticket form's quick-create makes those).
// Task 5 of the client-companies plan adds the company fence in front.
async function canAccessContact(user, contact) {
  if (await hasPermission(user.id, 'people.view_all')) return true;
  if (contact.departmentId != null) return contact.departmentId === user.departmentId;
  return contact.createdBy === user.id;
}
```

Rewrite `findAccessibleContact` as:

```js
async function findAccessibleContact(user, contactId) {
  const id = parseRecordId(contactId);
  if (!id) return null;
  const contact = await Contact.findByPk(id);
  if (!contact || !(await canAccessContact(user, contact))) return null;
  return contact;
}
```

In `contactsController.js`:
- import `canAccessContact`;
- in `get`, `update`, `remove`, `listTickets` and `listActivity`, right after the existing `if (!contact) throw … 404`, put the line below, replacing each handler's inline `people.view_all` / department comparison where there is one:

```js
  if (!(await canAccessContact(req.user, contact))) {
    throw new ApiError(403, 'You do not have access to this contact', 'FORBIDDEN');
  }
```

`assignDepartment` keeps its `findAccessibleContact` (S8's "same 404" rule).

- [ ] **Step 4: Run the file, then the suite**

Run: `cd backend && npm test -- contacts.department.test.js`, then `npm test`.
Expected: PASS. The full suite is green. `tickets.extras` S7 cases still pass, because `findAccessibleContact` kept its behaviour.

- [ ] **Step 5: Commit, and record S9 for UPGRADING**

Add a bullet to `UPGRADING.md` → Unreleased → Security fixes:

```markdown
- Editing or deleting a contact now needs access to that contact (your own
  department, a contact you created, or "view all people"). Before, anyone who
  could create tickets could edit any contact.
```

```bash
git add backend/src/services/permissionService.js backend/src/controllers/contactsController.js backend/test/integration/contacts.department.test.js UPGRADING.md
git commit -m "fix(security): editing and deleting a contact checks scope (S9)"
```

---

### Task 2: Migration, models and test fixtures

**Files:**
- Create: `backend/migrations/20260101000048-client-companies.js`
- Create: `backend/src/models/Company.js`, `CompanyDomain.js`, `Site.js`, `UserCompanyAccess.js`, `RoleCompanyAccess.js`
- Modify: `backend/src/models/index.js` (load the new models, add associations, export them)
- Modify: `backend/src/models/Department.js` (drop `unique: true` on `name`, add `companyId`), `Contact.js` (`companyId`, `siteId`), `Ticket.js` (`companyId`), `Project.js` (`companyId`), `Asset.js` (`companyId`, `siteId`, `vendorCompanyId`), `License.js` and `Contract.js` (`companyId`, `vendorCompanyId`), `ProjectMaterial.js` (`vendorCompanyId`), `User.js` (`allCompanies`)
- Modify: `backend/test/integration/helpers.js` (`resetData`)
- Modify: `backend/test/integration/fixtures.js` (`makeCompany`, `setCompanyAccess`)
- Test: `backend/test/integration/migrations.test.js` (append), `backend/test/integration/companies.migration.test.js` (new)

**Interfaces:**
- Produces:
  - models `Company`, `CompanyDomain`, `Site`, `UserCompanyAccess`, `RoleCompanyAccess`, exported from `models/index.js`.
  - associations:
    - `Company.hasMany(Site, { as: 'sites' })` and `Company.hasMany(CompanyDomain, { as: 'domains' })`;
    - `X.belongsTo(Company, { as: 'company', foreignKey: 'companyId' })` for Department, Contact, Ticket, Project, Asset, License and Contract;
    - `Contact.belongsTo(Site, { as: 'site' })` and `Asset.belongsTo(Site, { as: 'site' })`;
    - `X.belongsTo(Company, { as: 'vendor', foreignKey: 'vendorCompanyId' })` for Asset, License, Contract and ProjectMaterial;
    - `Company.belongsTo(User, { as: 'accountManager', foreignKey: 'accountManagerId' })`.
  - fixtures: `makeCompany(admin, fields) → company` (via `POST /companies`, which exists from Task 4 on; until then a test that needs a company uses `models.Company.create`) and `setCompanyAccess(admin, userId, { allCompanies, companyIds }) → access` (via `PUT /users/:id/company-access`, from Task 5).

- [ ] **Step 1: Write the failing migration tests**

Create `backend/test/integration/companies.migration.test.js`:

```js
const Sequelize = require('sequelize');
const { sequelize, closeDb, models, resetData } = require('./helpers');

const migration = require('../../migrations/20260101000048-client-companies');

const qi = () => sequelize.getQueryInterface();
const q = (sql, replacements) => sequelize.query(sql, { replacements, type: Sequelize.QueryTypes.SELECT });

// The previous suite's last test may have left a client company behind,
// which down() rightly refuses to drop.
beforeAll(resetData);

afterAll(async () => {
  // Leave the schema migrated and the probe rows gone for later suites.
  await sequelize.query("DELETE FROM Assets WHERE assetTag LIKE 'MIGPROBE-%'");
  await sequelize.query("DELETE FROM AssetCategories WHERE name = 'MigProbe'");
  await sequelize.query("DELETE FROM Companies WHERE isInternal = 0");
  await closeDb();
});

describe('the client-companies migration', () => {
  it('backfills every record to one internal company and turns vendor text into vendor companies', async () => {
    await migration.down(qi(), Sequelize);
    expect((await qi().describeTable('Tickets')).companyId).toBeUndefined();

    // Today's shape: an asset category and three assets whose vendor is the
    // same company written three ways.
    await sequelize.query("INSERT INTO AssetCategories (name, createdAt, updatedAt) VALUES ('MigProbe', NOW(), NOW())");
    const [{ id: categoryId }] = await q("SELECT id FROM AssetCategories WHERE name = 'MigProbe'");
    for (const [tag, vendor] of [['MIGPROBE-1', 'Dell'], ['MIGPROBE-2', 'dell '], ['MIGPROBE-3', 'DELL']]) {
      // eslint-disable-next-line no-await-in-loop
      await sequelize.query(
        'INSERT INTO Assets (assetTag, name, categoryId, vendorName, status, createdAt, updatedAt) VALUES (:tag, :tag, :categoryId, :vendor, \'active\', NOW(), NOW())',
        { replacements: { tag, categoryId, vendor } }
      );
    }

    await migration.up(qi(), Sequelize);

    const internal = await q('SELECT id, name, isInternal FROM Companies WHERE isInternal = 1');
    expect(internal).toHaveLength(1);
    for (const table of ['Departments', 'Contacts', 'Tickets', 'Projects', 'Assets', 'Licenses', 'Contracts']) {
      // eslint-disable-next-line no-await-in-loop
      const [{ n }] = await q(`SELECT COUNT(*) AS n FROM \`${table}\` WHERE companyId IS NULL OR companyId <> :id`, { id: internal[0].id });
      expect(Number(n)).toBe(0);
    }
    const vendors = await q("SELECT id, name FROM Companies WHERE isVendor = 1 AND LOWER(name) = 'dell'");
    expect(vendors).toHaveLength(1);
    const linked = await q("SELECT COUNT(*) AS n FROM Assets WHERE assetTag LIKE 'MIGPROBE-%' AND vendorCompanyId = :id", { id: vendors[0].id });
    expect(Number(linked[0].n)).toBe(3);
    expect((await qi().describeTable('Users')).allCompanies).toBeDefined();
  });

  it('refuses to roll back once client data exists, rather than losing it', async () => {
    await models.Company.create({ name: 'Acme', isClient: true });
    await expect(migration.down(qi(), Sequelize)).rejects.toThrow(/client companies exist/i);
  });
});
```

The `INSERT INTO Assets` lists the columns the probe needs. If `Assets` has other `NOT NULL` columns without defaults, add them with neutral values; check with `DESCRIBE Assets`.

- [ ] **Step 2: Run it and watch it fail**

Run: `cd backend && npm test -- companies.migration.test.js`
Expected: FAIL with `Cannot find module '../../migrations/20260101000048-client-companies'`.

- [ ] **Step 3: Write the migration**

`backend/migrations/20260101000048-client-companies.js`:

```js
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
```

Check the refusal query's precedence before relying on it. `SELECT COUNT(*) … WHERE isInternal = 0 AND isVendor = 0 OR isClient = 1` counts:
- companies that are neither internal nor vendor;
- plus any client, including a vendor that is also a client.

That's the intended "a client exists" test.

- [ ] **Step 4: Write the models**

`backend/src/models/Company.js`:

```js
const { DataTypes, Model } = require('sequelize');

// A client, a vendor (or both), or the organization itself (isInternal —
// exactly one, created by migration). See the client-companies spec.
module.exports = (sequelize) => {
  class Company extends Model {}
  Company.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      name: { type: DataTypes.STRING(150), allowNull: false },
      isInternal: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      isClient: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      isVendor: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      status: { type: DataTypes.ENUM('active', 'inactive'), allowNull: false, defaultValue: 'active' },
      phone: { type: DataTypes.STRING(50), allowNull: true },
      website: { type: DataTypes.STRING(255), allowNull: true },
      notes: { type: DataTypes.TEXT, allowNull: true },
      accountManagerId: { type: DataTypes.INTEGER, allowNull: true },
    },
    { sequelize, modelName: 'Company', tableName: 'Companies', timestamps: true }
  );
  return Company;
};
```

`CompanyDomain.js`: `id`, `companyId` (INTEGER, not null), `domain` (STRING(253), not null, unique), with `tableName: 'CompanyDomains'` and timestamps.

`Site.js`: the columns from the migration, `tableName: 'Sites'`, timestamps.

`UserCompanyAccess.js` and `RoleCompanyAccess.js`:
- `id`;
- `userId` or `roleId` (INTEGER, not null);
- `companyId` (INTEGER, not null);
- table names `UserCompanyAccess` and `RoleCompanyAccess`;
- `timestamps: true, updatedAt: false`.

Existing models, adding these exactly:
- **`Department`:** remove `unique: true` from `name`, and add `companyId: { type: DataTypes.INTEGER, allowNull: false }`.
- **`Contact`:** `companyId` (INTEGER, not null) and `siteId` (INTEGER, null).
- **`Ticket` and `Project`:** `companyId` (INTEGER, not null).
- **`Asset`:** `companyId` (not null), `siteId` (null) and `vendorCompanyId` (null).
- **`License` and `Contract`:** `companyId` (not null) and `vendorCompanyId` (null).
- **`ProjectMaterial`:** `vendorCompanyId` (null).
- **`User`:** `allCompanies: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true }`.

In `models/index.js`, load the five new models next to the others, add them to `module.exports`, and add these associations at the end of the associations section:

```js
// Client companies (sub-project 2)
Company.hasMany(Site, { foreignKey: 'companyId', as: 'sites' });
Site.belongsTo(Company, { foreignKey: 'companyId', as: 'company' });
Company.hasMany(CompanyDomain, { foreignKey: 'companyId', as: 'domains' });
CompanyDomain.belongsTo(Company, { foreignKey: 'companyId', as: 'company' });
Company.belongsTo(User, { foreignKey: 'accountManagerId', as: 'accountManager' });
[Department, Contact, Ticket, Project, Asset, License, Contract].forEach((M) => {
  M.belongsTo(Company, { foreignKey: 'companyId', as: 'company' });
});
Contact.belongsTo(Site, { foreignKey: 'siteId', as: 'site' });
Asset.belongsTo(Site, { foreignKey: 'siteId', as: 'site' });
[Asset, License, Contract, ProjectMaterial].forEach((M) => {
  M.belongsTo(Company, { foreignKey: 'vendorCompanyId', as: 'vendor' });
});
UserCompanyAccess.belongsTo(Company, { foreignKey: 'companyId', as: 'company' });
RoleCompanyAccess.belongsTo(Company, { foreignKey: 'companyId', as: 'company' });
```

- [ ] **Step 5: Keep the internal company across test resets, and add fixtures**

In `helpers.js` → `resetData()`:
- add `'Sites'`, `'CompanyDomains'`, `'UserCompanyAccess'` and `'RoleCompanyAccess'` to `tables`;
- after the truncation loop, add the block below.

```js
  // Companies is never truncated: the internal company (created by the
  // migration) must keep its id, because model hooks and the company cache
  // rely on it. Every other company goes.
  await sequelize.query('DELETE FROM Companies WHERE isInternal = 0').catch(() => {});
```

In `fixtures.js`, add and export:

```js
async function makeCompany(admin, fields = {}) {
  const body = { name: 'Acme Corp', isClient: true, ...fields };
  return expectOk(await admin.agent.post(`${API}/companies`).send(body), 201).company;
}

async function setCompanyAccess(admin, userId, access) {
  return expectOk(await admin.agent.put(`${API}/users/${userId}/company-access`).send(access)).access;
}
```

- [ ] **Step 6: Migrate the test DB and run the migration tests**

Run: `cd backend && npm run test:migrate && npm test -- companies.migration.test.js migrations.test.js`
Expected: PASS.

- [ ] **Step 7: Run the whole suite**

Run: `cd backend && npm test`
Expected: FAIL for now, in suites that create departments, contacts, tickets and the like. `companyId` is not null, and nothing sets it until Task 3's hooks. **Do not commit yet**: Tasks 2 and 3 commit together. Go straight to Task 3.

---

### Task 3: Model hooks — every record lands in a company

**Files:**
- Create: `backend/src/models/companyHooks.js`
- Create: `backend/src/services/companyService.js`
- Modify: `backend/src/models/index.js` (register the hooks after associations)
- Test: `backend/test/integration/companies.hooks.test.js`

**Interfaces:**
- Produces:
  - `companyService.getInternalCompanyId({ transaction }?) → Promise<number>`, cached for the process.
  - `companyService.FREE_MAIL_DOMAINS: Set<string>`, the spec's list.
  - Hooks: a Department, Contact, Project, Asset, License or Contract saved without `companyId` gets the internal company. A Ticket's `companyId` is always recomputed from its contact when it's created, when its `contactId` changes, or when someone tries to set `companyId` directly. A ticket with no contact keeps a `companyId` it was given, otherwise gets the internal company. A Contact whose `companyId` changes moves all its tickets, and its `departmentId`/`siteId` are cleared when they don't belong to the new company.

- [ ] **Step 1: Write the failing tests**

`backend/test/integration/companies.hooks.test.js`:

```js
const { resetData, closeDb, models } = require('./helpers');
const { API, expectOk, makeWorld, makeTicket } = require('./fixtures');

const { Company, Contact, Ticket, Department, Site } = models;

let w;
let internalId;
beforeEach(async () => {
  await resetData();
  w = await makeWorld();
  internalId = (await Company.findOne({ where: { isInternal: true } })).id;
});
afterAll(closeDb);

describe('every record lands in a company', () => {
  it('records created without a company get the internal one', async () => {
    const c = await Contact.create({ firstName: 'Model', displayName: 'Model' });
    const d = await Department.create({ name: 'Model dept', shortCode: 'MD' });
    expect([c.companyId, d.companyId]).toEqual([internalId, internalId]);
  });

  it('a ticket takes its contact\'s company, whatever the caller sends', async () => {
    const acme = await Company.create({ name: 'Acme', isClient: true });
    const c = await Contact.create({ firstName: 'Ann', displayName: 'Ann', companyId: acme.id });
    const t = await Ticket.create({ title: 'x', status: 'Open', priority: 'medium', contactId: c.id, companyId: internalId });
    expect(t.companyId).toBe(acme.id);
  });

  it('a ticket created through the API is in its contact\'s company', async () => {
    const t = await makeTicket(w.admin.agent, { title: 'x', contactId: w.contact.id });
    expect(t.companyId).toBe(internalId);
  });

  it('a ticket with no contact gets the internal company', async () => {
    const t = await Ticket.create({ title: 'Alert', status: 'Open', priority: 'medium' });
    expect(t.companyId).toBe(internalId);
  });
});

describe('a contact moving company', () => {
  it('takes all its tickets, open and closed', async () => {
    const acme = await Company.create({ name: 'Acme', isClient: true });
    const open = await makeTicket(w.admin.agent, { title: 'Open one', contactId: w.contact.id });
    const closed = await makeTicket(w.admin.agent, { title: 'Closed one', contactId: w.contact.id, status: 'Closed' });
    await (await Contact.findByPk(w.contact.id)).update({ companyId: acme.id });
    const companies = (await Ticket.findAll({ where: { id: [open.id, closed.id] } })).map((t) => t.companyId);
    expect(companies).toEqual([acme.id, acme.id]);
  });

  it('drops a department and site that belong to the old company', async () => {
    const acme = await Company.create({ name: 'Acme', isClient: true });
    const site = await Site.create({ companyId: internalId, name: 'HQ' });
    const c = await Contact.findByPk(w.contact.id);
    await c.update({ siteId: site.id });
    await c.update({ companyId: acme.id });
    await c.reload();
    expect([c.departmentId, c.siteId]).toEqual([null, null]);
  });

  it('a ticket edited to another contact follows the new contact\'s company', async () => {
    const acme = await Company.create({ name: 'Acme', isClient: true });
    const ann = await Contact.create({ firstName: 'Ann', displayName: 'Ann', companyId: acme.id });
    const t = await makeTicket(w.admin.agent, { title: 'x', contactId: w.contact.id });
    const { ticket } = expectOk(await w.admin.agent.patch(`${API}/tickets/${t.id}`).send({ contactId: ann.id }));
    expect(ticket.companyId).toBe(acme.id);
  });
});
```

The last case needs the admin to be able to use Ann. The admin holds `people.view_all`, so S7's check passes.

- [ ] **Step 2: Run them and watch them fail**

Run: `cd backend && npm test -- companies.hooks.test.js`
Expected: FAIL with `notNull Violation: …companyId cannot be null`.

- [ ] **Step 3: Write `companyService.js`**

```js
// Company helpers shared by controllers and services. The internal company is
// created by the client-companies migration and can never be deleted, so its
// id is cached for the life of the process.
const { Company } = require('../models');

let internalCompanyId = null;

async function getInternalCompanyId({ transaction } = {}) {
  if (internalCompanyId) return internalCompanyId;
  const row = await Company.findOne({ where: { isInternal: true }, attributes: ['id'], transaction });
  if (!row) throw new Error('No internal company — run the client-companies migration');
  internalCompanyId = row.id;
  return internalCompanyId;
}

// Free-mail domains never identify a company (spec: Data model → CompanyDomains).
const FREE_MAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'yahoo.com',
  'ymail.com', 'icloud.com', 'me.com', 'mac.com', 'aol.com', 'proton.me', 'protonmail.com', 'pm.me',
  'gmx.com', 'gmx.net', 'mail.com', 'zoho.com', 'yandex.com', 'fastmail.com',
]);

module.exports = { getInternalCompanyId, FREE_MAIL_DOMAINS };
```

- [ ] **Step 4: Write `companyHooks.js`**

```js
// Keeps every record in a company whatever code path creates it — HTTP
// handlers, inbound email, AD sync, the schedulers, tests calling
// Model.create. Registered from models/index.js once associations exist.
module.exports = function registerCompanyHooks(models) {
  const {
    Contact, Ticket, Department, Project, Asset, License, Contract, Site,
  } = models;
  // Required lazily: companyService requires models/index.js.
  const internalId = (options) => require('../services/companyService') // eslint-disable-line global-require
    .getInternalCompanyId({ transaction: options.transaction });

  const defaultToInternal = async (record, options) => {
    if (record.companyId == null) record.companyId = await internalId(options);
  };
  [Department, Contact, Project, Asset, License, Contract].forEach((M) => {
    M.addHook('beforeValidate', 'defaultCompany', defaultToInternal);
  });

  // A ticket's company is always its contact's (spec decision "Ticket
  // company"); a companyId sent directly is overwritten.
  Ticket.addHook('beforeValidate', 'companyFromContact', async (ticket, options) => {
    if (ticket.contactId && (ticket.isNewRecord || ticket.changed('contactId') || ticket.changed('companyId'))) {
      const contact = await Contact.findByPk(ticket.contactId, { attributes: ['companyId'], transaction: options.transaction });
      if (contact) ticket.companyId = contact.companyId;
    }
    if (ticket.companyId == null) ticket.companyId = await internalId(options);
  });

  // A contact that moves company takes its tickets, and drops a department
  // or site that belonged to the old company.
  Contact.addHook('beforeUpdate', 'clearForeignPlacement', async (contact, options) => {
    if (!contact.changed('companyId')) return;
    if (contact.departmentId) {
      const dept = await Department.findByPk(contact.departmentId, { attributes: ['companyId'], transaction: options.transaction });
      if (!dept || dept.companyId !== contact.companyId) contact.departmentId = null;
    }
    if (contact.siteId) {
      const site = await Site.findByPk(contact.siteId, { attributes: ['companyId'], transaction: options.transaction });
      if (!site || site.companyId !== contact.companyId) contact.siteId = null;
    }
  });
  Contact.addHook('afterUpdate', 'moveTickets', async (contact, options) => {
    // after* hooks run before Sequelize resets changed(), so this still sees the move.
    if (!contact.changed('companyId')) return;
    await Ticket.update(
      { companyId: contact.companyId },
      { where: { contactId: contact.id }, transaction: options.transaction, hooks: false }
    );
  });
};
```

In `models/index.js`, after the associations and before `module.exports`, add:

```js
require('./companyHooks')({
  Contact, Ticket, Department, Project, Asset, License, Contract, Site,
});
```

The `beforeUpdate` hook only fires when the contact is saved through `contact.update(...)` or `contact.save()` — instance saves. The `Contact.update(...)` static calls in this codebase never change `companyId`. Plan 2b's merge uses static updates deliberately and moves tickets itself.

- [ ] **Step 5: Run the hook tests, then the whole suite**

Run: `cd backend && npm test -- companies.hooks.test.js`, then `npm test`.
Expected: both PASS. The whole suite, including every sub-project 1 baseline test, is green, which proves a one-company install behaves as before. If a baseline test fails, find out why. A test that pinned behaviour this plan *means* to change is a ruling; anything else is a bug in this task.

- [ ] **Step 6: Commit Tasks 2 and 3 together**

```bash
git add backend/migrations/20260101000048-client-companies.js backend/src/models backend/src/services/companyService.js backend/test/integration/helpers.js backend/test/integration/fixtures.js backend/test/integration/companies.migration.test.js backend/test/integration/companies.hooks.test.js
git commit -m "feat(companies): migration, models and hooks — every record in a company"
```

---
### Task 4: Company access — who can reach which companies, enforced on single records

**Files:**
- Modify: `backend/src/services/permissionService.js` (company access helpers; `canAccessTicket`, `canAccessProject` and `canAccessContact` check the company first)
- Create: `backend/src/controllers/companyAccessController.js`
- Modify: `backend/src/routes/users.js` and `backend/src/routes/roles.js` (company-access routes)
- Modify: `backend/src/controllers/ticketsController.js` (`generateReport`'s partial load gains `companyId`), `backend/src/controllers/projectsController.js` (the same)
- Test: `backend/test/integration/companies.access.test.js`

**Interfaces:**
- Consumes: the models and the `allCompanies` column from Task 2.
- Produces, all in `permissionService`:
  - `getUserCompanyIds(user) → Promise<null | number[]>`: `null` means every company.
  - `canAccessCompany(user, companyId) → Promise<boolean>`.
  - `companyScopeWhere(user, column = 'companyId') → Promise<object>`: `{}` or `{ [column]: { [Op.in]: ids } }`, with an empty list becoming `[-1]`, which matches nothing.
  - `isUnfenceable(user) → Promise<boolean>`.
  
  `invalidateUserPermissions` and `invalidateAllPermissions` also clear the company cache.
- Produces, the endpoints:
  - `GET/PUT /users/:id/company-access`: request `{ allCompanies: boolean, companyIds: number[] }`; response `{ access: { allCompanies, companyIds, companies: [{ id, name }], unfenceable } }`.
  - `GET/PUT /roles/:id/company-access`: request `{ companyIds }`; response `{ access: { companyIds, companies } }`.

- [ ] **Step 1: Write the failing tests**

`backend/test/integration/companies.access.test.js`. Setup:

```js
const { resetData, closeDb, models, ROLE, createUserAndLogin } = require('./helpers');
const {
  API, expectOk, makeWorld, makeTech, makeTicket, makeProject, setCompanyAccess,
} = require('./fixtures');

const { Company, Contact } = models;

let w;
let acme;
let acmeTicket;
let homeTicket;
let tech;
beforeEach(async () => {
  await resetData();
  w = await makeWorld();
  acme = await Company.create({ name: 'Acme', isClient: true });
  const ann = await Contact.create({ firstName: 'Ann', displayName: 'Ann', companyId: acme.id });
  acmeTicket = await makeTicket(w.admin.agent, { title: 'Acme printer', contactId: ann.id });
  homeTicket = await makeTicket(w.admin.agent, { title: 'Home printer', contactId: w.contact.id, departmentId: w.deptA.id });
  tech = await makeTech('tech', w.deptA.id);
});
afterAll(closeDb);

const internalId = async () => (await Company.findOne({ where: { isInternal: true } })).id;
```

| # | Test name | Request (as) | Expect |
|---|---|---|---|
| 1 | a new user reaches every company | tech: GET Acme ticket, then home ticket | 200, 200 |
| 2 | a fenced user is refused another company's records | admin: `setCompanyAccess(admin, tech, { allCompanies:false, companyIds:[internal] })`; tech GETs the Acme ticket, then home ticket | 403 `{ error:true, message:'You do not have access to this ticket', code:'FORBIDDEN' }`; 200 |
| 3 | the fence covers projects and contacts too | as 2, plus `Project` P in Acme (`makeProject(admin, { name:'P', ownerDepartmentId:A, companyId: acme.id })`, or `models.Project.create` if Task 8's `companyId` body field isn't there yet) and Ann; tech GETs P and Ann | 403 project; 403 contact |
| 4 | link fields treat a fenced-out record like a missing one | as 2; tech POST home ticket relations `{ relatedTicketId: acmeTicket.id }` vs `{ relatedTicketId: 99999 }` | both 404 `Related ticket not found`, identical bodies |
| 5 | role grants add to user grants | fence tech to [internal]; admin `PUT /roles/<System Technician id>/company-access { companyIds:[acme.id] }`; tech GETs the Acme ticket | 200 |
| 6 | removing a role grant takes effect at once | after 5: role `{ companyIds:[] }`; tech GETs the Acme ticket | 403 (no stale cache) |
| 7 | removing a user grant takes effect at once | tech fenced to [internal, acme]; GET Acme 200; then fenced to [internal]; GET Acme | 200, then 403 |
| 8 | System Administrators can't be fenced | admin `PUT /users/<admin>/company-access { allCompanies:false, companyIds:[] }`; also a user with role System Administrator but legacy `technician` | 400 `{ code:'VALIDATION_ERROR', message:'System Administrators always reach every company' }` both |
| 9 | changing access needs companies.manage_access | tech `PUT /users/<tech>/company-access` | 403 (route gate) |
| 10 | a granter can't hand out companies they can't reach | a user holding `companies.manage_access` via override, fenced to [internal]; grants acme to someone | 403 `{ code:'FORBIDDEN', message:'You can only grant companies you can reach' }` |
| 11 | access changes are on the permission audit log | after 7 | `GET /audit-log?targetUserId=<tech>` → `logs` includes `company_access_granted` (detail `{ companyIds:[acme] }`) and `company_access_revoked` |
| 12 | validation | `{ allCompanies:'yes' }`; `{ allCompanies:false, companyIds:[99999] }`; `{ allCompanies:false, companyIds:['1e1'] }` | 400 `VALIDATION_ERROR` each ('allCompanies must be true or false'; 'Unknown company'; 'Unknown company') |
| 13 | GET shows the current access | after 2: admin `GET /users/<tech>/company-access` | `{ access: { allCompanies:false, companyIds:[internal], companies:[{ id, name }], unfenceable:false } }` |
| 14 | a fenced user's ticket PDF is fenced too | as 2; tech GET `/tickets/<acme>/report` | 403 |

- [ ] **Step 2: Run them and watch them fail**

Run: `cd backend && npm test -- companies.access.test.js`
Expected: case 1 passes; the rest fail. `PUT /users/:id/company-access` returns 404 (no route), so `setCompanyAccess` throws.

- [ ] **Step 3: Add the helpers to `permissionService.js`**

Add `UserCompanyAccess`, `RoleCompanyAccess` and `User` to the models require if they aren't there already. Then add:

```js
// ---- Company access (client companies, sub-project 2) ----
// A user reaches every company (allCompanies, the default) or a list: their
// own UserCompanyAccess rows plus the RoleCompanyAccess rows of every role
// they hold. System Administrators always reach everything.
const companyCache = new Map(); // userId -> { ids: null | number[], expiresAt }

async function isUnfenceable(user) {
  if (user.role === 'admin') return true;
  const adminRole = await Role.findOne({ where: { name: 'System Administrator' }, attributes: ['id'] });
  if (!adminRole) return false;
  if (user.roleId === adminRole.id) return true;
  return !!(await UserRole.findOne({ where: { userId: user.id, roleId: adminRole.id }, attributes: ['userId'] }));
}

async function getUserCompanyIds(user) {
  const cached = companyCache.get(user.id);
  if (cached && cached.expiresAt > Date.now()) return cached.ids;

  // Fail closed: a user object loaded without the column is re-read, and an
  // unknown user reaches nothing.
  let all = user.allCompanies;
  if (all === undefined) all = (await User.findByPk(user.id, { attributes: ['allCompanies'] }))?.allCompanies ?? false;

  let ids = null;
  if (!all && !(await isUnfenceable(user))) {
    const roleIds = new Set((await UserRole.findAll({ where: { userId: user.id }, attributes: ['roleId'] })).map((r) => r.roleId));
    if (user.roleId) roleIds.add(user.roleId);
    const [own, viaRoles] = await Promise.all([
      UserCompanyAccess.findAll({ where: { userId: user.id }, attributes: ['companyId'] }),
      roleIds.size ? RoleCompanyAccess.findAll({ where: { roleId: [...roleIds] }, attributes: ['companyId'] }) : [],
    ]);
    ids = [...new Set([...own, ...viaRoles].map((r) => r.companyId))];
  }
  companyCache.set(user.id, { ids, expiresAt: Date.now() + CACHE_TTL_MS });
  return ids;
}

async function canAccessCompany(user, companyId) {
  const ids = await getUserCompanyIds(user);
  return ids === null || ids.includes(Number(companyId));
}

async function companyScopeWhere(user, column = 'companyId') {
  const ids = await getUserCompanyIds(user);
  if (ids === null) return {};
  return { [column]: { [Op.in]: ids.length ? ids : [-1] } };
}
```

Make `invalidateUserPermissions(userId)` also run `companyCache.delete(userId)`, and `invalidateAllPermissions()` also run `companyCache.clear()`.

Put the company check first in each of the three single-record rules:

```js
async function canAccessTicket(user, ticket) {
  if (!(await canAccessCompany(user, ticket.companyId))) return false;
  // …existing tier logic unchanged…
}
```

Do the same in `canAccessProject` (with `project.companyId`) and `canAccessContact` (with `contact.companyId`). Export `getUserCompanyIds`, `canAccessCompany`, `companyScopeWhere` and `isUnfenceable`.

Every caller that loads a *partial* record and passes it to these must include `companyId`:
- `ticketsController.generateReport`: `attributes: ['id', 'departmentId', 'assigneeId', 'companyId']`;
- `projectsController.generateReport`: `attributes: ['id', 'ownerDepartmentId', 'forDepartmentId', 'companyId']`.

Search for any others with `grep -rn "attributes:" backend/src/controllers | grep -i "departmentId"` and check each one that feeds a `canAccess*`.

- [ ] **Step 4: Write `companyAccessController.js`**

```js
// GET/PUT /users/:id/company-access and /roles/:id/company-access.
// Granting access is privilege-granting, like role assignment: it needs
// companies.manage_access, and a granter can only hand out companies they can
// reach themselves.
const { Op } = require('sequelize');
const {
  User, Role, Company, UserCompanyAccess, RoleCompanyAccess, sequelize,
} = require('../models');
const { ApiError, asyncHandler } = require('../middleware/error');
const { writeAudit, writeSystemAudit } = require('../middleware/audit');
const {
  parseRecordId, isUnfenceable, getUserCompanyIds, invalidateUserPermissions, invalidateAllPermissions,
} = require('../services/permissionService');

async function resolveCompanyIds(raw) {
  if (!Array.isArray(raw)) throw new ApiError(400, 'companyIds must be a list', 'VALIDATION_ERROR');
  const ids = [...new Set(raw.map(parseRecordId))];
  if (ids.some((id) => !id)) throw new ApiError(400, 'Unknown company', 'VALIDATION_ERROR');
  const found = await Company.count({ where: { id: { [Op.in]: ids.length ? ids : [-1] } } });
  if (found !== ids.length) throw new ApiError(400, 'Unknown company', 'VALIDATION_ERROR');
  return ids;
}

async function assertCanGrant(granter, companyIds) {
  const reachable = await getUserCompanyIds(granter);
  if (reachable !== null && companyIds.some((id) => !reachable.includes(id))) {
    throw new ApiError(403, 'You can only grant companies you can reach', 'FORBIDDEN');
  }
}

async function describe(companyIds) {
  const companies = companyIds.length
    ? await Company.findAll({ where: { id: companyIds }, attributes: ['id', 'name'], order: [['name', 'ASC']] })
    : [];
  return { companyIds: companies.map((c) => c.id), companies };
}

const getUserAccess = asyncHandler(async (req, res) => {
  const user = await User.findByPk(parseRecordId(req.params.id) || 0);
  if (!user) throw new ApiError(404, 'User not found', 'NOT_FOUND');
  const rows = await UserCompanyAccess.findAll({ where: { userId: user.id }, attributes: ['companyId'] });
  res.json({
    access: {
      allCompanies: user.allCompanies,
      ...(await describe(rows.map((r) => r.companyId))),
      unfenceable: await isUnfenceable(user),
    },
  });
});

const putUserAccess = asyncHandler(async (req, res) => {
  const user = await User.findByPk(parseRecordId(req.params.id) || 0);
  if (!user) throw new ApiError(404, 'User not found', 'NOT_FOUND');
  const { allCompanies, companyIds } = req.body || {};
  if (typeof allCompanies !== 'boolean') throw new ApiError(400, 'allCompanies must be true or false', 'VALIDATION_ERROR');
  if (!allCompanies && (await isUnfenceable(user))) {
    throw new ApiError(400, 'System Administrators always reach every company', 'VALIDATION_ERROR');
  }
  const ids = allCompanies ? [] : await resolveCompanyIds(companyIds || []);
  // Granting "all" is itself a grant of every company.
  if (allCompanies) {
    if ((await getUserCompanyIds(req.user)) !== null) {
      throw new ApiError(403, 'You can only grant companies you can reach', 'FORBIDDEN');
    }
  } else {
    await assertCanGrant(req.user, ids);
  }

  const before = (await UserCompanyAccess.findAll({ where: { userId: user.id }, attributes: ['companyId'] })).map((r) => r.companyId);
  await sequelize.transaction(async (t) => {
    await user.update({ allCompanies }, { transaction: t });
    await UserCompanyAccess.destroy({ where: { userId: user.id }, transaction: t });
    if (ids.length) await UserCompanyAccess.bulkCreate(ids.map((companyId) => ({ userId: user.id, companyId })), { transaction: t });
  });
  invalidateUserPermissions(user.id);

  const granted = ids.filter((id) => !before.includes(id));
  const revoked = before.filter((id) => !ids.includes(id));
  await writeAudit(req, 'user.company_access', 'User', user.id, { allCompanies, companyIds: ids });
  if (granted.length || allCompanies) await writeSystemAudit(req, 'company_access_granted', user.id, { allCompanies, companyIds: granted });
  if (revoked.length) await writeSystemAudit(req, 'company_access_revoked', user.id, { companyIds: revoked });

  res.json({ access: { allCompanies, ...(await describe(ids)), unfenceable: await isUnfenceable(user) } });
});

const getRoleAccess = asyncHandler(async (req, res) => {
  const role = await Role.findByPk(parseRecordId(req.params.id) || 0);
  if (!role) throw new ApiError(404, 'Role not found', 'NOT_FOUND');
  const rows = await RoleCompanyAccess.findAll({ where: { roleId: role.id }, attributes: ['companyId'] });
  res.json({ access: await describe(rows.map((r) => r.companyId)) });
});

const putRoleAccess = asyncHandler(async (req, res) => {
  const role = await Role.findByPk(parseRecordId(req.params.id) || 0);
  if (!role) throw new ApiError(404, 'Role not found', 'NOT_FOUND');
  const ids = await resolveCompanyIds((req.body || {}).companyIds || []);
  await assertCanGrant(req.user, ids);
  await sequelize.transaction(async (t) => {
    await RoleCompanyAccess.destroy({ where: { roleId: role.id }, transaction: t });
    if (ids.length) await RoleCompanyAccess.bulkCreate(ids.map((companyId) => ({ roleId: role.id, companyId })), { transaction: t });
  });
  invalidateAllPermissions();
  await writeAudit(req, 'role.company_access', 'Role', role.id, { companyIds: ids });
  res.json({ access: await describe(ids) });
});

module.exports = {
  getUserAccess, putUserAccess, getRoleAccess, putRoleAccess,
};
```

Routes. In `routes/users.js`, before the `/:id` catch-alls, add:

```js
const companyAccess = require('../controllers/companyAccessController');
const manageCompanyAccess = requirePermission('companies.manage_access');
router.get('/:id/company-access', manageCompanyAccess, companyAccess.getUserAccess);
router.put('/:id/company-access', manageCompanyAccess, companyAccess.putUserAccess);
```

In `routes/roles.js`, add the same pair with `getRoleAccess` and `putRoleAccess`.

- [ ] **Step 5: Run the file, then the suite**

Run: `cd backend && npm test -- companies.access.test.js`, then `npm test`.
Expected: PASS, and the whole suite is green. Every existing user is `allCompanies`, so nothing else moved.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/permissionService.js backend/src/controllers/companyAccessController.js backend/src/routes/users.js backend/src/routes/roles.js backend/src/controllers/ticketsController.js backend/src/controllers/projectsController.js backend/test/integration/companies.access.test.js
git commit -m "feat(companies): company access lists, enforced on tickets, projects and contacts"
```

---

### Task 5: Companies, domains and sites API

**Files:**
- Create: `backend/src/controllers/companiesController.js` (companies, summary, domains)
- Create: `backend/src/controllers/sitesController.js`
- Create: `backend/src/routes/companies.js`
- Modify: `backend/src/routes/index.js` (mount `/companies`)
- Test: `backend/test/integration/companies.api.test.js`

**Interfaces:**
- Consumes: `canAccessCompany`, `companyScopeWhere` and `parseRecordId` (Task 4); `FREE_MAIL_DOMAINS` (Task 3).
- Produces: the routes in the spec's API table, with these bodies:
  - `{ company }`, including `domains: [{ id, domain }]` and `accountManager: { id, displayName }` on GET;
  - `{ companies, page, limit, total, totalPages }`;
  - `{ count, multiCompany }`;
  - `{ domain }`;
  - `{ site }` and `{ sites }`.

**Ruling recorded in this plan:** `multiCompany` is true when *at least one client company* exists, active or not. The spec says "more than one company", but Task 2's migration creates vendor companies from existing vendor text. Counting those would turn on company pickers across an internal-IT install the moment it upgrades, against the spec's first success criterion. Vendors alone never count.

- [ ] **Step 1: Write the failing tests**

`backend/test/integration/companies.api.test.js`. In each test the admin acts unless stated, and `tech` is a System Technician (`companies.view` only).

| # | Test name | Request (as) | Expect |
|---|---|---|---|
| 1 | creates a client company with defaults | `POST /companies { name:'  Acme Corp  ', isClient:true }` | 201 `company` has `name:'Acme Corp', isClient:true, isVendor:false, isInternal:false, status:'active', phone:null, website:null, accountManagerId:null` |
| 2 | validates company fields | `{}`; `{ name:'   ' }`; `{ name:'x'.repeat(151) }`; `{ name:'A', website:'javascript:alert(1)' }`; `{ name:'A', accountManagerId:99999 }`; `{ name:'A', accountManagerId:'1e1' }` | 400 `VALIDATION_ERROR`: 'Company name is required' ×2; 'Company name must be 150 characters or fewer'; 'Website must be an http(s) address'; 'Unknown account manager' ×2 |
| 3 | names are unique among active companies, ignoring case | create 'Acme'; create 'ACME '; deactivate the first; create 'acme' | 201; 409 `COMPANY_NAME_TAKEN` 'A company with this name already exists'; 201 |
| 4 | isInternal can't be set or cleared through the API | `POST { name:'X', isInternal:true }`; `PATCH /companies/<internal> { isInternal:false }` | created with `isInternal:false`; internal still `isInternal:true` |
| 5 | the internal company can't be deactivated or deleted | `PATCH <internal> { status:'inactive' }`; `DELETE <internal>` | 400 'The internal company cannot be deactivated'; 400 'The internal company cannot be deleted' |
| 6 | delete works only when nothing uses the company | Acme with no records → DELETE; Beta with a contact → DELETE | 200 `{ ok:true }`; 409 `COMPANY_IN_USE` 'This company has records. Deactivate or merge it instead.' |
| 7 | lists, filters and searches | Acme (client), Dell (vendor), Old (client, inactive); `?kind=client`, `?kind=vendor`, `?status=inactive`, `?search=ac` | the paginated shape; names: [internal, Acme, Old] for client, since the internal company counts as a client of its own work; [Dell]; [Old]; [Acme] |
| 8 | summary counts clients, not vendors | no companies; then one vendor; then one client | `{ count:1, multiCompany:false }`; `{ count:2, multiCompany:false }`; `{ count:3, multiCompany:true }` |
| 9 | domains: add, normalise, refuse free-mail and duplicates | `POST /companies/<acme>/domains { domain:' @ACME.com ' }`; `{ domain:'gmail.com' }`; the same domain on Beta; `{ domain:'not a domain' }` | 201 `domain.domain:'acme.com'`; 400 "Free email domains can't identify a company"; 409 `DOMAIN_TAKEN`; 400 'Invalid domain' |
| 10 | removes a domain | DELETE `/companies/<acme>/domains/<id>`; DELETE Beta's domain via Acme's URL | 200; 404 'Domain not found' |
| 11 | sites: create, validate, list, update, deactivate | POST `{ name:'HQ', line1:'1 Main St', city:'Springfield' }`; again 'hq'; `{ name:'' }`; GET list; PATCH `{ status:'inactive' }` | 201 `site` with those fields and `status:'active'`; 409 `SITE_NAME_TAKEN`; 400 'Site name is required'; `sites` `[HQ]`; `status:'inactive'` |
| 12 | a site is only reachable through its own company | PATCH `/companies/<acme>/sites/<beta's site>` | 404 'Site not found' |
| 13 | the API is fenced by company access | tech fenced to [internal] (`setCompanyAccess`); GET list; GET Acme; GET Acme's sites; admin-level writes by a fenced manager (override `companies.manage`) on Acme | list has only the internal company; 403 `{ message:'You do not have access to this company' }` ×3 |
| 14 | permissions | tech: GET list; POST a company | 200; 403 (route gate) |
| 15 | changes are audited | create, update, add a domain, add a site | `AuditLog` (model read; no endpoint) has `company.create`, `company.update`, `company.domain_add`, `site.create` with the company or site id |
| 16 | GET shows domains and the account manager | Acme with `accountManagerId: tech` and a domain | `company.domains:[{ id, domain:'acme.com' }]`, `company.accountManager:{ id, displayName:'Test tech' }` |

- [ ] **Step 2: Run them and watch them fail**

Run: `cd backend && npm test -- companies.api.test.js`
Expected: FAIL with 404s, because `/companies` isn't mounted.

- [ ] **Step 3: Write the controllers and routes**

`companiesController.js`. Follow these rules exactly. The test table above holds the messages.
- `normalizeName(raw)`: trim; empty is 400; over 150 characters is 400.
- `assertNameFree(name, excludeId)`: `Company.findOne({ where: { status: 'active', [Op.and]: [sequelize.where(fn('LOWER', col('name')), name.toLowerCase())], ...(excludeId ? { id: { [Op.ne]: excludeId } } : {}) } })`; a hit is 409 `COMPANY_NAME_TAKEN`.
- `website`: `null`/`''` → `null`; otherwise it must match `/^https?:\/\/[^\s<>"]+$/i`.
- `accountManagerId`: `null`/`''` → `null`; otherwise `parseRecordId`, then an existing active `User`, else 400 'Unknown account manager'.
- `isClient` / `isVendor`: cast with `!!` when present. `isInternal` and `id` are ignored in bodies.
- **`list`:**
  - `where = { ...(await companyScopeWhere(req.user, 'id')) }`;
  - `kind=client` → `{ [Op.or]: [{ isClient: true }, { isInternal: true }] }`;
  - `kind=vendor` → `{ isVendor: true }`;
  - `status` → equality;
  - `search` → `name LIKE %term%`.
  
  Order by `isInternal DESC, name ASC`. Use `parsePagination` and `paginated('companies', …)`.
- **`summary`:** `count` is `Company.count()` over every company, the internal one included. `multiCompany` is `(await Company.count({ where: { isClient: true } })) > 0`. It's unfenced: the frontend needs it before anything else, and it reveals only a number.
- **`get`, `update`, `remove`, and the domain and site routes:** load the company with `parseRecordId(req.params.id) || 0`, 404 'Company not found', then `if (!(await canAccessCompany(req.user, company.id))) throw new ApiError(403, 'You do not have access to this company', 'FORBIDDEN')`.
- **`remove`:**
  - the internal company → 400;
  - in use when any of these counts is non-zero → 409:
    - `Department`, `Contact`, `Ticket`, `Project`, `Asset`, `License` or `Contract` `where companyId`;
    - `Asset`, `License`, `Contract` or `ProjectMaterial` `where vendorCompanyId`;
    - `Site where companyId`.
  - Otherwise, in a transaction, destroy its `CompanyDomain`, `UserCompanyAccess` and `RoleCompanyAccess` rows, then the company. Run `invalidateAllPermissions()`.
- **Domains:**
  - `normalizeDomain(raw)`: `String(raw).trim().toLowerCase().replace(/^@/, '')`;
  - valid when it matches `/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/`;
  - refuse when `FREE_MAIL_DOMAINS.has(domain)`;
  - `CompanyDomain.findOne({ where: { domain } })` existing → 409 `DOMAIN_TAKEN` 'This domain already belongs to a company'.
  - Removing a domain looks it up `where { id, companyId }`, else 404 'Domain not found'.
- **Audit actions:** `company.create`, `company.update` (meta = the changes), `company.delete`, `company.domain_add`, `company.domain_remove`.

`sitesController.js`:
- **`list`:** sites of the company, by name.
- **`create`:** name required and trimmed, at most 150 characters, unique within the company ignoring case (409 `SITE_NAME_TAKEN` 'This company already has a site with that name'). Optional fields:
  - `line1`/`line2` up to 200 characters;
  - `city`/`region`/`country` up to 100;
  - `postalCode` up to 20;
  - `phone` up to 50;
  - `notes`.
  
  Over-long values get 400 '<Field> is too long'.
- **`update`:** load the site `where { id: siteId, companyId: company.id }`, else 404 'Site not found'. Same validation. `status` must be `active` or `inactive`.
- **Audit actions:** `site.create`, `site.update`.

`routes/companies.js`:

```js
const express = require('express');
const ctrl = require('../controllers/companiesController');
const sites = require('../controllers/sitesController');
const { requirePermission } = require('../middleware/requirePermission');

const router = express.Router();
const canView = requirePermission('companies.view');
const canManage = requirePermission('companies.manage');

router.get('/summary', ctrl.summary); // before '/:id'; any staff user
router.get('/', canView, ctrl.list);
router.post('/', canManage, ctrl.create);
router.get('/:id', canView, ctrl.get);
router.patch('/:id', canManage, ctrl.update);
router.delete('/:id', canManage, ctrl.remove);
router.post('/:id/domains', canManage, ctrl.addDomain);
router.delete('/:id/domains/:domainId', canManage, ctrl.removeDomain);
router.get('/:id/sites', canView, sites.list);
router.post('/:id/sites', canManage, sites.create);
router.patch('/:id/sites/:siteId', canManage, sites.update);

module.exports = router;
```

In `routes/index.js`: `const companiesRoutes = require('./companies');` and `router.use('/companies', guard, companiesRoutes);`.

- [ ] **Step 4: Run the file, then the suite**

Run: `cd backend && npm test -- companies.api.test.js`, then `npm test`.
Expected: PASS, and the suite is green. `fixtures.makeCompany` works from now on.

- [ ] **Step 5: Commit**

```bash
git add backend/src/controllers/companiesController.js backend/src/controllers/sitesController.js backend/src/routes/companies.js backend/src/routes/index.js backend/test/integration/companies.api.test.js
git commit -m "feat(companies): companies, domains and sites API"
```

---
### Task 6: One shared list scope, fenced by company (and S10)

Today "which tickets can this user list" is written five times: the ticket list/board, search, the calendar, the dashboard, and the project list/tags. Projects and contacts have the same problem. This task replaces the copies with `services/recordScope.js` and adds the company fence there, once.

It also fixes **S10**, found while planning. `buildContactListWhere` builds the user's scope (`{ departmentId: <own> }`) and then *overwrites* it with the `?departmentId=` and `?noDept=true` filters. So any department-level user can list another department's contacts, emails and phones included, just by asking for them. Combining scope and filters with AND, as `andWhere` does, fixes this by construction.

**Files:**
- Create: `backend/src/services/recordScope.js`
- Modify:
  - `backend/src/controllers/ticketsController.js` (`buildTicketListWhere`; `board` passes `ignoreStatus`)
  - `backend/src/controllers/projectsController.js` (`buildProjectListWhere`)
  - `backend/src/controllers/contactsController.js` (`scopeWhere`/`buildContactListWhere`, `alphaIndex`)
  - `backend/src/controllers/searchController.js`
  - `backend/src/controllers/calendarController.js` (ticket, project and task events)
  - `backend/src/controllers/dashboardController.js` (every Ticket and Project query)
- Test: `backend/test/integration/companies.lists.test.js`

**Interfaces:**
- Consumes: `companyScopeWhere`, `getUserTicketScope`, `getUserProjectScope` and `hasPermission` (permissionService).
- Produces, in `recordScope`:
  - `isEmpty(where) → boolean`: true for `{}` with no symbol keys.
  - `andWhere(...parts) → where`: joins the non-empty parts with `Op.and`. It never spreads, so one part's `Op.or` can't overwrite another's.
  - `ticketScopeWhere(user) → Promise<where>`: company plus ticket tier.
  - `projectScopeWhere(user) → Promise<where>`: company plus project tier. It's `{ id: -1 }`-style when nothing is visible.
  - `contactScopeWhere(user) → Promise<where>`: company plus `people.view_all` or own department.

- [ ] **Step 1: Write the failing tests**

`backend/test/integration/companies.lists.test.js`. Every case checks a list two ways:
- **Positive control:** the unfenced admin's response contains the Acme record.
- **Fence:** a user fenced to the internal company gets a response whose JSON never contains the marker `ACME-SECRET`.

Checking the serialized body makes a leak through *any* field, nested include or count visible, not just through the list's main array.

```js
const { resetData, closeDb, models } = require('./helpers');
const {
  API, expectOk, makeWorld, makeTech, makeStaff, makeTicket, makeProject, makeTask, setCompanyAccess,
  freezeClock, unfreezeClock,
} = require('./fixtures');

const { Company, Contact } = models;
const MARK = 'ACME-SECRET';

let w;
let acme;
let fenced; // a System Technician fenced to the internal company
beforeEach(async () => {
  freezeClock('2026-03-11T17:00:00Z');
  await resetData();
  w = await makeWorld();
  acme = await Company.create({ name: `${MARK} Corp`, isClient: true });
  const ann = await Contact.create({ firstName: MARK, displayName: `${MARK} contact`, companyId: acme.id, email: 'ann@acme.test' });
  await makeTicket(w.admin.agent, { title: `${MARK} ticket`, contactId: ann.id, dueDate: '2026-03-12' });
  const p = await makeProject(w.admin.agent, { name: `${MARK} project`, ownerDepartmentId: w.deptA.id, tags: [MARK.toLowerCase()], dueDate: '2026-03-12' });
  await models.Project.update({ companyId: acme.id }, { where: { id: p.id } }); // Task 8 adds companyId to the API
  await makeTask(w.admin.agent, p.id, { title: `${MARK} task`, dueDate: '2026-03-12' });
  await makeTicket(w.admin.agent, { title: 'Home ticket', contactId: w.contact.id });
  fenced = await makeTech('fenced', w.deptA.id);
  const internalId = (await Company.findOne({ where: { isInternal: true } })).id;
  await setCompanyAccess(w.admin, fenced.user.id, { allCompanies: false, companyIds: [internalId] });
});
afterEach(unfreezeClock);
afterAll(closeDb);

const leaks = (body) => JSON.stringify(body).includes(MARK);
const both = async (path) => [
  expectOk(await w.admin.agent.get(`${API}${path}`)),
  expectOk(await fenced.agent.get(`${API}${path}`)),
];
```

| # | Test name | Path | Expect |
|---|---|---|---|
| 1 | ticket list | `/tickets` | admin leaks (control); fenced doesn't; fenced `total` is 1 |
| 2 | ticket board | `/tickets/board` | same; fenced column totals sum to 1 |
| 3 | the board still ignores `?status` | `/tickets/board?status=Closed` (fenced) | the home ticket is still in the Open column (guards the `ignoreStatus` change) |
| 4 | project list | `/projects` | control leaks; fenced doesn't |
| 5 | project tags | `/projects/tags` | admin's `tags` includes `acme-secret`; fenced's doesn't |
| 6 | contact list | `/contacts` | control leaks; fenced doesn't |
| 7 | contact A–Z index | `/contacts/index` | admin has an `A` entry for ACME-SECRET; fenced's counts exclude it (`leaks` false) |
| 8 | S10: contact filters narrow scope, never widen it | staff (Department Staff in A) GETs `/contacts?departmentId=<B>` and `/contacts?noDept=true`, with a dept-B contact `Bea` and an admin-created no-dept contact `Loose` | neither response contains `Bea` or `Loose` |
| 9 | search | `/search?q=ACME` | control leaks; fenced doesn't |
| 10 | search by ticket number | `/search?q=1` (the Acme ticket is id 1) | fenced `tickets` doesn't include id 1 |
| 11 | calendar | `/calendar/events?startDate=2026-03-01&endDate=2026-03-31&types=tickets,projects,tasks` | control leaks; fenced doesn't |
| 12 | dashboard | `/dashboard` (system view: both are view_all) | the admin's `stats.openTickets` is 2; the fenced user's is 1; fenced `projectHealth` and `activity` don't leak |
| 13 | dashboard for another user | the admin's `/dashboard?userId=<fenced>` vs the fenced user's own `/dashboard` | (control) the fenced user's personal mode counts only home tickets |

Case 8 fails **before** this task, because the filters overwrite the scope. That's the S10 proof.

- [ ] **Step 2: Run them and watch them fail**

Run: `cd backend && npm test -- companies.lists.test.js`
Expected: every fenced case fails (the lists leak), and case 8 fails. Controls 1–2 pass.

- [ ] **Step 3: Write `recordScope.js`**

```js
// The one definition of "which tickets / projects / contacts may this user
// list". Lists, search, the calendar and the dashboard all build their WHERE
// from here, so the company fence (and any future scope rule) is applied in
// one place. Single records are checked by permissionService.canAccess*.
const { Op } = require('sequelize');
const { ProjectMember } = require('../models');
const {
  getUserTicketScope, getUserProjectScope, hasPermission, companyScopeWhere,
} = require('./permissionService');

function isEmpty(where) {
  return !where || (Object.keys(where).length === 0 && Object.getOwnPropertySymbols(where).length === 0);
}

// AND-joins where fragments. Never spread scope into a where: a filter's
// Op.or (or a plain key like departmentId) would silently replace the scope's.
function andWhere(...parts) {
  const real = parts.filter((p) => !isEmpty(p));
  if (!real.length) return {};
  return real.length === 1 ? real[0] : { [Op.and]: real };
}

async function ticketScopeWhere(user) {
  const [company, scope] = await Promise.all([companyScopeWhere(user), getUserTicketScope(user.id)]);
  let tier = {};
  if (scope === 'department') tier = { [Op.or]: [{ departmentId: user.departmentId }, { assigneeId: user.id }] };
  else if (scope === 'own') tier = { assigneeId: user.id };
  return andWhere(company, tier);
}

async function projectScopeWhere(user) {
  const [company, scope] = await Promise.all([companyScopeWhere(user), getUserProjectScope(user.id)]);
  if (scope === 'all') return company;
  const memberships = await ProjectMember.findAll({ where: { userId: user.id }, attributes: ['projectId'], raw: true });
  const memberIds = memberships.map((m) => m.projectId);
  let tier;
  if (scope === 'department') {
    const or = [{ ownerDepartmentId: user.departmentId }, { forDepartmentId: user.departmentId }];
    if (memberIds.length) or.push({ id: { [Op.in]: memberIds } });
    tier = { [Op.or]: or };
  } else {
    tier = memberIds.length ? { id: { [Op.in]: memberIds } } : { id: -1 };
  }
  return andWhere(company, tier);
}

async function contactScopeWhere(user) {
  const [company, viewAll] = await Promise.all([companyScopeWhere(user), hasPermission(user.id, 'people.view_all')]);
  return andWhere(company, viewAll ? {} : { departmentId: user.departmentId });
}

module.exports = {
  isEmpty, andWhere, ticketScopeWhere, projectScopeWhere, contactScopeWhere,
};
```

- [ ] **Step 4: Switch every caller to it**

Rules for each caller:
- Build the filters exactly as today, but **without** the scope block.
- Return `andWhere(filters, await xScopeWhere(req.user))`.
- Delete the local scope helper.

**`ticketsController.buildTicketListWhere(req, { ignoreStatus = false } = {})`**
- Remove the `scope === 'department'` and `scope === 'own'` block and `return andWhere(where, await ticketScopeWhere(req.user))`.
- Keep `getUserTicketScope` only for the `myTickets` rule (`scope !== 'own'`).
- When `ignoreStatus` is true, skip the `status` filter and the `overdue` filter's implied-open status.
- `board` calls `buildTicketListWhere(req, { ignoreStatus: true })` and builds each column's where as `andWhere(baseWhere, { status: s.name })`.

**`projectsController.buildProjectListWhere`**
- Drop the scope branches, so `ownerDept`/`forDept` apply in every scope (filtering further is always safe).
- Keep the `myProjects` memberships short-circuit.
- Return `{ where: andWhere(filters, await projectScopeWhere(req.user)), empty }`.

**`contactsController`**
- Delete `scopeWhere`.
- `buildContactListWhere` builds `filters` (`departmentId`, `noDept` → `{ departmentId: null }`, `assignedTo`, `myContacts`, `status`, `search`) and returns `andWhere(filters, await contactScopeWhere(req.user))`.
- `alphaIndex` uses the same function.

**`searchController`**
- Delete the local `ticketScopeWhere` and `projectScopeWhere`.
- Tickets: `andWhere(await ticketScopeWhere(req.user), { [Op.or]: ticketOr })`. Projects are the same.
- Contacts: when `canViewContacts`, `andWhere(await contactScopeWhere(req.user), { [Op.or]: contactOr })`.

**`calendarController`**
- `scopedTicketWhere(req, extraWhere)` returns `andWhere(extraWhere, await ticketScopeWhere(req.user))`.
- `scopedProjectWhere(req, requestedDepartmentId)` returns `andWhere(await projectScopeWhere(req.user), requestedDepartmentId ? { [Op.or]: [{ ownerDepartmentId: requestedDepartmentId }, { forDepartmentId: requestedDepartmentId }] } : {})`.
- Tasks keep deriving from the in-scope project ids.

**`dashboardController`**
- At the top of `get` and `activityMore`, compute `const companyWhere = await companyScopeWhere(req.user)` and `const projectCompanyWhere = companyWhere`.
- AND `companyWhere` into every Ticket query, through `systemStats`, `statsForUser`, `ticketsForUser`, `teamWorkload`'s ticket counts and `activityFeed`'s ticket where. `systemStats(buckets, extraWhere)` becomes `systemStats(buckets, andWhere(extraWhere, companyWhere))`; `statsForUser(userId, scopeField, buckets, companyWhere)` ANDs it into each count.
- AND `projectCompanyWhere` into every Project query (`projectHealthFor`, `activityFeed`'s project where).
- `activityFeed` reads `TicketActivity` and `ProjectActivity` joined to their parent. Fence it by filtering the parent ids the same way the department view already does.

The fence follows the *viewer*: an admin looking at a fenced user's dashboard sees everything, and a fenced user sees only their companies.

- [ ] **Step 5: Run the file, then the suite**

Run: `cd backend && npm test -- companies.lists.test.js`, then `npm test`.
Expected: PASS, and the whole suite is green. In particular, `tickets.core` board case 38, the `projects.core` filter table and `pagination.test.js` still pass. The refactor kept today's results for unfenced users.

- [ ] **Step 6: Commit, and record S10**

`UPGRADING.md` → Unreleased → Security fixes:

```markdown
- The contact list's department filters now narrow what you can see instead
  of replacing it. Before, a user limited to their own department could list
  another department's contacts by filtering on it.
```

```bash
git add backend/src/services/recordScope.js backend/src/controllers/ticketsController.js backend/src/controllers/projectsController.js backend/src/controllers/contactsController.js backend/src/controllers/searchController.js backend/src/controllers/calendarController.js backend/src/controllers/dashboardController.js backend/test/integration/companies.lists.test.js UPGRADING.md
git commit -m "feat(companies): one shared list scope, fenced by company; contact filters can't widen scope (S10)"
```

---

### Task 7: Departments belong to a company; records stay inside their company

**Files:**
- Modify: `backend/src/controllers/departmentsController.js`, `backend/src/routes/departments.js`
- Modify: `backend/src/controllers/ticketsController.js` (department must be in the contact's company; on a contact change, a foreign department resets)
- Modify: `backend/src/controllers/contactsController.js` (department and site must be in the contact's company, including S8's `assignDepartment`)
- Modify: `backend/src/controllers/projectsController.js` ("owned by" must be internal; "for" must be in the project's company)
- Test: `backend/test/integration/companies.departments.test.js`

**Interfaces:**
- Consumes: `getInternalCompanyId` (Task 3); `canAccessCompany` and `parseRecordId` (Task 4); `andWhere` (Task 6).
- Produces:
  - `GET /departments?companyId=`, fenced, with each department carrying `company: { id, name }`;
  - `POST /departments` accepts `companyId` (default internal);
  - a shared helper `findDepartmentInCompany(departmentId, companyId) → Promise<Department|null>` in `services/companyService.js`. It returns null when the department is missing or belongs to another company.

- [ ] **Step 1: Write the failing tests**

`backend/test/integration/companies.departments.test.js`. Setup: `makeWorld()`; Acme (client, `Company.create`); Acme's department `Acme HR`, made with `POST /departments { name:'HR', companyId: acme.id }`; Ann, an Acme contact in Acme HR.

| # | Test name | Request (as) | Expect |
|---|---|---|---|
| 1 | a client can have a department named like one of yours | admin: POST `{ name:'Service Desk', companyId: acme.id }` | 201, `companyId: acme.id`, `shortCode: null` |
| 2 | names are unique within a company | admin: POST `{ name:'hr', companyId: acme.id }` | 409 `DEPARTMENT_NAME_TAKEN` 'This company already has a department with that name' |
| 3 | internal departments still need a short code; client ones don't | admin: POST `{ name:'Ops' }` (internal by default) | 400 'Short code is required (used to prefix this department\'s project IDs)' |
| 4 | client departments need companies.manage; internal ones keep people.manage_departments | a user with only `people.manage_departments` (override on Department Staff) POSTs a client department, then an internal one | 403 'Managing a client company\'s departments needs companies.manage'; 201 |
| 5 | the department list is fenced and filterable | fenced tech GETs `/departments`; admin GETs `/departments?companyId=<acme>` | the fenced list has no Acme HR; the admin's filtered list is exactly `[HR]`, with `company: { id: acme.id, name:'Acme' }` |
| 6 | a ticket's department must belong to its contact's company | admin: create a ticket for Ann with `departmentId: deptA` (internal); PATCH an Acme ticket to `departmentId: deptA` | 400 `{ code:'VALIDATION_ERROR', message:'Department not found' }` both |
| 7 | changing a ticket's contact drops a foreign department | an internal ticket in deptA; PATCH `{ contactId: ann.id }` | `companyId: acme.id`, `departmentId:` Acme HR's id (Ann's department) |
| 8 | a contact's department must belong to the contact's company | admin: POST a contact `{ firstName:'Bo', companyId: acme.id, departmentId: deptA }` (Task 8 adds `companyId`; until then use Ann and PATCH `departmentId: deptA`) | 400 'Department not found' |
| 9 | S8's assign-department keeps to the contact's company | admin: `PATCH /contacts/<ann>/department { departmentId: deptA }` | 400 'Department does not exist' |
| 10 | a project's "owned by" must be one of your departments | admin: POST a project `{ name:'P', ownerDepartmentId: <Acme HR> }` | 400 'Owned-by department does not exist' |
| 11 | a project's "for" department must be in the project's company | admin: internal project with `forDepartmentId: <Acme HR>` | 400 'For-department does not exist' |
| 12 | a fenced user can't read or edit another company's department | fenced tech: GET `/departments/<Acme HR>`; a fenced manager with `people.manage_departments` PATCHes it | 403 'You do not have access to this department' both |

- [ ] **Step 2: Run them and watch them fail**

Run: `cd backend && npm test -- companies.departments.test.js`
Expected: FAIL. Departments ignore `companyId`, and the cross-company assignments are accepted.

- [ ] **Step 3: Implement**

`companyService.findDepartmentInCompany`:

```js
const { Department } = require('../models'); // add to the existing require

async function findDepartmentInCompany(departmentId, companyId) {
  const id = require('./permissionService').parseRecordId(departmentId); // eslint-disable-line global-require
  if (!id) return null;
  const dept = await Department.findByPk(id);
  return dept && dept.companyId === companyId ? dept : null;
}
```

Export it.

**`departmentsController`**
- `list`: `where = andWhere(await companyScopeWhere(req.user), req.query.companyId ? { companyId: parseRecordId(req.query.companyId) || -1 } : {})`, with `include: [...departmentInclude, { model: Company, as: 'company', attributes: ['id', 'name'] }]`.
- `create`: resolve `companyId` (`parseRecordId(body.companyId)`, or `getInternalCompanyId()` when absent). The company must exist and be reachable (`canAccessCompany`), else 400 'Unknown company'.
  - **Internal:** requires `people.manage_departments`, and a short code as today.
  - **Client:** requires `companies.manage` (403 with the message in case 4), and the short code is optional.
  - Name uniqueness: `Department.findOne({ where: { companyId, name } })` → 409 `DEPARTMENT_NAME_TAKEN`.
- `get`, `update`, `remove`: after loading, `if (!(await canAccessCompany(req.user, department.companyId))) throw new ApiError(403, 'You do not have access to this department', 'FORBIDDEN')`. `update` ignores `companyId`. The same internal/client permission split applies.
- `routes/departments.js`: the POST and PATCH gates become `requirePermission('people.manage_departments', 'companies.manage')`. The handler checks which one applies.

**`ticketsController`**
- In `create`, after resolving `contact` (S7), compute `const companyId = contact.companyId`. If `departmentId` is given, `findDepartmentInCompany(departmentId, companyId)`, else 400 'Department not found'. Store the found department's id.
- In `update`:
  - work out the resulting contact: the new one, if `contactId` changes, else the ticket's current contact, and from it `companyId`;
  - if `changes.departmentId` is given (and truthy), check it the same way;
  - if the contact changed and no `departmentId` was sent, set `changes.departmentId` to the ticket's department when that department is in the new company, else the new contact's `departmentId` (which is in that company), else `null`.

**`contactsController`**
- `create` and `update`: a given `departmentId` must satisfy `findDepartmentInCompany(departmentId, contactCompanyId)`, else 400 'Department not found'. A given `siteId` must name a `Site` with `companyId === contactCompanyId` and `status: 'active'`, else 400 'Site not found'.
- `assignDepartment`: after the existing lookup, `if (dept.companyId !== contact.companyId) throw new ApiError(400, 'Department does not exist', 'VALIDATION_ERROR')`.

**`projectsController`**
- `create`/`update`: `ownerDepartmentId` must be in the internal company, via `findDepartmentInCompany(ownerDepartmentId, await getInternalCompanyId())`, else the existing 400 'Owned-by department does not exist'.
- `forDepartmentId`, when given, must be in the project's company (internal until Task 8), else 400 'For-department does not exist'.
- The `forDepartmentId || ownerDepartmentId` default applies only when the project is internal. A client project with no "for" department keeps `null`.

- [ ] **Step 4: Run the file, then the suite**

Run: `cd backend && npm test -- companies.departments.test.js`, then `npm test`.
Expected: PASS, and the suite is green.

- [ ] **Step 5: Commit**

```bash
git add backend/src/controllers/departmentsController.js backend/src/routes/departments.js backend/src/controllers/ticketsController.js backend/src/controllers/contactsController.js backend/src/controllers/projectsController.js backend/src/services/companyService.js backend/test/integration/companies.departments.test.js
git commit -m "feat(companies): departments per company; tickets, contacts and projects stay inside their company"
```

---

### Task 8: Choosing and changing a record's company — contacts and projects

**Files:**
- Modify: `backend/src/controllers/contactsController.js` (`companyId` on create/update; moving a contact; `company` and `site` in `contactInclude`)
- Modify: `backend/src/controllers/projectsController.js` (`companyId` on create/update; `company` in `projectInclude`; `?companyId=` list filter)
- Modify: `backend/src/controllers/ticketsController.js` (`company` in `ticketInclude`; `?companyId=` list filter)
- Modify: `backend/src/services/companyService.js` (`resolveRecordCompany`)
- Test: `backend/test/integration/companies.records.test.js`

**Interfaces:**
- Produces: `companyService.resolveRecordCompany(user, rawCompanyId) → Promise<Company>`.
  - It returns the internal company when `rawCompanyId` is absent.
  - Otherwise it returns the company when it exists, is active, is client-or-internal, and the user can reach it.
  - Anything else throws `ApiError(400, 'Unknown company', 'VALIDATION_ERROR')`. Missing and out-of-scope look the same.

- [ ] **Step 1: Write the failing tests**

`backend/test/integration/companies.records.test.js`. Setup: `makeWorld()`; Acme (client), Dell (vendor only), Old (client, inactive); `tech` (System Technician).

| # | Test name | Request (as) | Expect |
|---|---|---|---|
| 1 | a contact defaults to the internal company | tech: POST a contact `{ firstName:'Pat' }` | `companyId`: internal; `company: { id, name }` |
| 2 | a contact can be created at a client | tech: `{ firstName:'Ann', companyId: acme.id }` | `companyId: acme.id` |
| 3 | a contact's company must be an active client (or internal) the user can reach | tech: Dell's id; Old's id; 99999; `'1e1'`; a fenced tech giving Acme | 400 `{ code:'VALIDATION_ERROR', message:'Unknown company' }` each |
| 4 | a contact's site must be in its company | an Acme site `HQ`; POST `{ firstName:'Ann', companyId: acme.id, siteId: HQ }`; then an internal contact with `siteId: HQ` | 201 with `site: { id, name:'HQ' }`; 400 'Site not found' |
| 5 | moving a contact needs people.edit_users | Department Staff PATCH Ann `{ companyId: <internal> }` | 403 'Moving a contact to another company needs people.edit_users' |
| 6 | moving a contact needs access to both companies | a manager with `people.edit_users`, fenced to [internal]: PATCH Ann (at Acme) to internal | 403 'You do not have access to this contact' (the record check refuses first) |
| 7 | moving a contact is audited | admin moves Ann from Acme to internal, with Ann owning 2 tickets | `AuditLog` (model read) `contact.move` with meta `{ fromCompanyId: acme.id, toCompanyId: internal, ticketsMoved: 2 }` |
| 8 | moving a contact moves every ticket, open and closed | as 7 | both tickets: `companyId` internal |
| 9 | moving a contact drops its department and site from the old company | Ann in Acme HR at HQ; move to internal | `departmentId: null, siteId: null` |
| 10 | moving a contact refuses a department that isn't in the new company | PATCH `{ companyId: <internal>, departmentId: <Acme HR> }` | 400 'Department not found' |
| 11 | a project can belong to a client | admin: POST a project `{ name:'Acme rollout', ownerDepartmentId: deptA, companyId: acme.id, forDepartmentId: <Acme HR> }` | 201 `companyId: acme.id`, `company: { id, name:'Acme' }`; code `SD-P00001` |
| 12 | a project's company follows the same rules as a contact's | Dell, Old, a fenced user | 400 'Unknown company' each |
| 13 | moving a project keeps its "for" department valid | PATCH the project in 11 `{ companyId: <internal> }` | 400 'For-department does not exist', unless `forDepartmentId` is changed in the same request |
| 14 | lists filter by company | `/tickets?companyId=<acme>`, `/projects?companyId=<acme>`, `/contacts?companyId=<acme>` | only Acme's records |
| 15 | tickets show their company | GET an Acme ticket | `ticket.company: { id: acme.id, name:'Acme' }` |

- [ ] **Step 2: Run them and watch them fail**

Run: `cd backend && npm test -- companies.records.test.js`
Expected: FAIL. `companyId` is ignored on create, and nothing is refused.

- [ ] **Step 3: Implement**

`resolveRecordCompany` in `companyService.js`:

```js
async function resolveRecordCompany(user, rawCompanyId) {
  const { canAccessCompany, parseRecordId } = require('./permissionService'); // eslint-disable-line global-require
  const { ApiError } = require('../middleware/error'); // eslint-disable-line global-require
  if (rawCompanyId === undefined || rawCompanyId === null || rawCompanyId === '') {
    return Company.findByPk(await getInternalCompanyId());
  }
  const company = await Company.findByPk(parseRecordId(rawCompanyId) || 0);
  const usable = company && company.status === 'active' && (company.isClient || company.isInternal)
    && (await canAccessCompany(user, company.id));
  if (!usable) throw new ApiError(400, 'Unknown company', 'VALIDATION_ERROR');
  return company;
}
```

**Contacts**
- `create`: `const company = await resolveRecordCompany(req.user, req.body.companyId)`. Pass `companyId: company.id` to `Contact.create`, and validate `departmentId` and `siteId` against `company.id` (Task 7's rules).
- `update`, when `companyId` is in the body and differs from the contact's:
  1. Require `people.edit_users`, else 403 with the message in case 5.
  2. Resolve the new company with `resolveRecordCompany`, which covers access to the destination; access to the current one was checked by `canAccessContact`.
  3. If `departmentId` or `siteId` are also in the body, validate them against the *new* company.
  4. Count the contact's tickets before saving.
  5. Save with `contact.update(changes)`; the Task 3 hooks move the tickets and clear foreign placement.
  6. Write `contact.move` with `{ fromCompanyId, toCompanyId, ticketsMoved }`.
  
  Add `'companyId'` and `'siteId'` to `allowed`.
- `contactInclude` gains `{ model: Company, as: 'company', attributes: ['id', 'name'] }` and `{ model: Site, as: 'site', attributes: ['id', 'name'] }`.
- `buildContactListWhere` filters gain `companyId` (`parseRecordId(...) || -1`).

**Projects**
- `create`: `const company = await resolveRecordCompany(req.user, body.companyId)`. Validate "for" against `company.id` (Task 7), and pass `companyId: company.id`.
- `update`: when `companyId` is given and differs, resolve it the same way. The *resulting* `forDepartmentId` (the one in the body, else the project's current one) must be in the new company, or `null`, else 400 'For-department does not exist'.
- `projectInclude` gains `company`. The list filters gain `companyId`.

**Tickets**
- `ticketInclude` gains `{ model: Company, as: 'company', attributes: ['id', 'name'] }`.
- The `buildTicketListWhere` filters gain `companyId` (`parseRecordId(...) || -1`).
- `companyId` is never accepted in a ticket body: the model hook overwrites it anyway, and it isn't in `allowed`.

- [ ] **Step 4: Run the file, then the suite**

Run: `cd backend && npm test -- companies.records.test.js`, then `npm test`.
Expected: PASS, and the suite is green.

- [ ] **Step 5: Commit**

```bash
git add backend/src/controllers/contactsController.js backend/src/controllers/projectsController.js backend/src/controllers/ticketsController.js backend/src/services/companyService.js backend/test/integration/companies.records.test.js
git commit -m "feat(companies): contacts and projects choose a company; moving a contact takes its tickets"
```

---
### Task 9: Assets, licenses and contracts — fenced by company for the first time

Today these three modules check only the module permission (`assets.view` and so on). Any holder can read or change any record by id. This task:
- gives each router one company fence on `:id`;
- fences their lists and their cross-module links;
- lets them choose a company (and, for assets, a site);
- sends the alert scheduler's tickets to the right company.

**Files:**
- Create: `backend/src/middleware/companyFence.js`
- Modify: `backend/src/routes/assets.js`, `routes/licenses.js`, `routes/contracts.js` (one `router.param` each)
- Modify:
  - `backend/src/controllers/assetsController.js`: `list`, `stats`, `expirySummary`, `create`, `update`, `linkTicket`; `company`/`site` in `assetInclude`
  - `controllers/licensesController.js`: `list`, `create`, `update`, `linkAsset`, `assignContact`
  - `controllers/contractsController.js`: `list`, `create`, `update`, `linkAsset`
- Modify: `backend/src/services/assetAlertScheduler.js` (every `Ticket.create` passes the record's `companyId`)
- Modify:
  - `backend/src/controllers/calendarController.js`: subscription, license-expiry and contract-renewal events are fenced;
  - `backend/src/controllers/dashboardController.js`: `assetsSummaryStats` is fenced;
  - `backend/src/services/assetSubscriptionService.js`: `getSubscriptionRenewals` accepts an optional `where`.
- Test: `backend/test/integration/companies.assets.test.js`

**Interfaces:**
- Consumes: `canAccessCompany`, `companyScopeWhere`, `parseRecordId`, `findAccessibleTicket` and `findAccessibleContact` (Tasks 1 and 4); `resolveRecordCompany` (Task 8); `andWhere` (Task 6).
- Produces: `fenceParam(Model, label)`, an Express `router.param` callback. It loads `{ id, companyId }`, answers 403 `You do not have access to this <label>` for a record in a company the caller can't reach, and otherwise calls `next()`. A missing record falls through to the handler's own 404, so existing messages are unchanged.

- [ ] **Step 1: Write the failing tests**

`backend/test/integration/companies.assets.test.js`. Setup:
- `makeWorld()`;
- Acme (client), with site `HQ`, department `Acme HR` and contact Ann;
- an asset category;
- an Acme asset tagged `ACME-SECRET-1`, an Acme license and an Acme contract (each created by the admin with `companyId: acme.id`);
- an Acme ticket for Ann;
- `fenced`, a System Technician fenced to the internal company. Technicians hold `assets.*` and the license and contract permissions.

| # | Test name | Request (as) | Expect |
|---|---|---|---|
| 1 | assets default to the internal company | admin: POST an asset with no `companyId` | `companyId`: internal, `company: { id, name }` |
| 2 | an asset can belong to a client, at one of its sites | admin: `{ …, companyId: acme.id, siteId: HQ, departmentId: <Acme HR> }` | 201 with `site: { id, name:'HQ' }` |
| 3 | an asset's site and department must be in its company | an internal asset with `siteId: HQ`; with `departmentId: <Acme HR>` | 400 'Site not found'; 400 'Department not found' |
| 4 | a fenced user can't touch another company's asset, license or contract by id | fenced: GET, PATCH and DELETE the Acme asset; GET `/assets/<id>/tickets`, `/checkouts`, `/attachments`; GET and PATCH the Acme license and contract; `GET /licenses/<id>/reveal-key` | 403 `You do not have access to this asset` / `license` / `contract` for each |
| 5 | lists and summaries leave out other companies | fenced: `/assets`, `/assets/stats`, `/assets/expiry-summary`, `/licenses`, `/contracts` | no response contains `ACME-SECRET`; the admin's do (control) |
| 6 | an asset can only be linked to a ticket in its own company that you can see | admin: link the Acme asset to an internal ticket; fenced: link an internal asset to the Acme ticket, then to 99999 | 400 'Ticket not found'; 404 'Ticket not found' and 404 'Ticket not found' (identical bodies) |
| 7 | a license can only be linked to an asset in its own company that you can see | admin: link the Acme license to an internal asset | 400 'Asset not found' |
| 8 | a license can only be assigned to a contact in its own company that you can see | admin: assign the Acme license to the world contact (internal) | 400 'Contact not found' |
| 9 | a contract can only be linked to an asset in its own company | admin: link the Acme contract to an internal asset | 400 'Asset not found' |
| 10 | a missing id still answers 404 | fenced: GET `/assets/99999` | 404 'Asset not found' |
| 11 | alert tickets land in the record's company | an Acme asset with a subscription renewing tomorrow; call `runAssetAlertScan()` (or whatever the scheduler exports for one pass; see its `module.exports`) | the created ticket has `companyId: acme.id` |
| 12 | calendar renewal events are fenced | fenced: `/calendar/events?startDate=<this month>&endDate=<next month>&types=subscriptions,license_expiry,contract_renewal` | no `ACME-SECRET` |
| 13 | the dashboard's asset summary is fenced | the fenced user's dashboard `assetsSummary` vs the admin's | the fenced counts exclude the Acme asset, license and contract |

The plan writes 400 for a cross-company link and 404 for a missing or invisible one. That keeps each module's existing 404 shape for "not there", and the new 400 for "not allowed here" never names a record the caller can't see.

- [ ] **Step 2: Run them and watch them fail**

Run: `cd backend && npm test -- companies.assets.test.js`
Expected: FAIL. The fenced user reads everything, and links cross companies freely.

- [ ] **Step 3: Write `companyFence.js` and wire it**

```js
// router.param('id') callback for routers whose records carry companyId but
// whose handlers fetch by raw id (assets, licenses, contracts). Refusing here
// covers every current and future /:id route on the router at once.
const { ApiError } = require('./error');
const { canAccessCompany, parseRecordId } = require('../services/permissionService');

function fenceParam(Model, label) {
  return async (req, res, next, rawId) => {
    try {
      const id = parseRecordId(rawId);
      if (!id) return next(); // the handler's own 404 / validation applies
      const record = await Model.findByPk(id, { attributes: ['id', 'companyId'] });
      if (record && !(await canAccessCompany(req.user, record.companyId))) {
        return next(new ApiError(403, `You do not have access to this ${label}`, 'FORBIDDEN'));
      }
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

module.exports = { fenceParam };
```

Put `router.param('id', fenceParam(Asset, 'asset'))` right after `const router = express.Router();` in `routes/assets.js`. Do the same with `License`/`'license'` in `routes/licenses.js` and `Contract`/`'contract'` in `routes/contracts.js`, requiring the models from `../models`. The category routes in `assets.js` use `:categoryId`/`:fieldId`, so the param never fires for them. Check with `grep -n "/:id" backend/src/routes/assets.js`.

- [ ] **Step 4: Fence the lists, choose companies, fence the links**

**Lists**
- `assetsController.list`, `licensesController.list`, `contractsController.list`: `where = andWhere(<existing filters>, await companyScopeWhere(req.user))`. Add the `companyId` filter (`?companyId=`, `parseRecordId(...) || -1`).
- `assetsController.stats` and `expirySummary`: AND `companyScopeWhere` into each count's where.

**Create and update**
- `const company = await resolveRecordCompany(req.user, body.companyId)` on create. On update, call it only when `companyId` is present and differs.
- An asset's `siteId` must be an active site of that company, and `departmentId` a department of it (`findDepartmentInCompany`). The same department rule applies to licenses and contracts.
- Add `company` (and, for assets, `site`) to each include.

**Links** (same company, and visible)
- `assets.linkTicket`: `const ticket = await findAccessibleTicket(req.user, req.body.ticketId)`. Null → 404 'Ticket not found'. `ticket.companyId !== asset.companyId` → 400 'Ticket not found'. Use `ticket.id` from here on.
- `licenses.linkAsset` and `contracts.linkAsset`: load the asset with `parseRecordId`. Missing or `!(await canAccessCompany(req.user, asset.companyId))` → 404 'Asset not found'. A different company → 400 'Asset not found'.
- `licenses.assignContact`: `findAccessibleContact`. Null → 404 'Contact not found'; a different company → 400 'Contact not found'.

**Alert scheduler:** every `Ticket.create` in `assetAlertScheduler.js` adds `companyId: <the asset's / license's / contract's>.companyId`. The ticket has no contact, so the model hook keeps the value it's given.

**Calendar and dashboard**
- Calendar subscription, license-expiry and contract-renewal events: pass `await companyScopeWhere(req.user)` into the asset, license and contract queries. `getSubscriptionRenewals({ withinDays, where })` ANDs `where` into its Asset query.
- `assetsSummaryStats(companyWhere)` ANDs it into every count. `get` passes the viewer's `companyWhere`.

- [ ] **Step 5: Run the file, then the suite**

Run: `cd backend && npm test -- companies.assets.test.js`, then `npm test`.
Expected: PASS, and the suite is green.

- [ ] **Step 6: Commit, and record the access change**

`UPGRADING.md` → Unreleased → Security fixes:

```markdown
- Assets, licenses and contracts can now only be linked to tickets, contacts
  and assets you can see, in the same company. Before, a link could reach any
  ticket or contact by id and show its title or name.
```

```bash
git add backend/src/middleware/companyFence.js backend/src/routes/assets.js backend/src/routes/licenses.js backend/src/routes/contracts.js backend/src/controllers/assetsController.js backend/src/controllers/licensesController.js backend/src/controllers/contractsController.js backend/src/services/assetAlertScheduler.js backend/src/services/assetSubscriptionService.js backend/src/controllers/calendarController.js backend/src/controllers/dashboardController.js backend/test/integration/companies.assets.test.js UPGRADING.md
git commit -m "feat(companies): assets, licenses and contracts fenced by company; links stay in-company and visible"
```

---

### Task 10: Reports, the custom report builder and CSAT stats — fenced by company

**Files:**
- Modify: `backend/src/controllers/reportsController.js` (every builder)
- Modify: `backend/src/services/customReportEngine.js` (all five loaders)
- Modify: `backend/src/services/csatStatsService.js`, `backend/src/controllers/csatController.js`
- Modify: `backend/src/controllers/dashboardController.js` (`teamHappiness`)
- Test: `backend/test/integration/companies.reports.test.js`

**Interfaces:**
- Consumes: `companyScopeWhere(user, column)` (Task 4); `andWhere` and `isEmpty` (Task 6).
- Changes the shared report helpers to `ticketScopeWhere(where, scope, user, requestedDepartmentId, companyWhere)`, `projectScopeWhere(...)` and `contactDeptWhere(...)`. The new last argument is ANDed in, and every call site passes it.

- [ ] **Step 1: Write the failing tests**

`backend/test/integration/companies.reports.test.js` uses the `ACME-SECRET` marker technique from Task 6. The data under Acme:
- contact Ann;
- a ticket with 30 minutes of time, closed, with a staff CSAT rating and a pending CSAT survey;
- a project with 60 minutes of time, an expense and a material;
- an asset (`assetTag 'ACME-SECRET-1'`) with a warranty that has expired and a replacement date in 30 days;
- a license and a contract, both expiring in 30 days.

`fenced` is an *admin-tier* reporter: a user holding `reports.view_all` and `reports.export` through overrides, fenced to the internal company. Two `it.each` tables:

**JSON reports.** For each path, the admin's body contains `ACME-SECRET` (control) and the fenced user's doesn't. The paths:

```
/reports/ticket-volume              /reports/ticket-trends
/reports/team-performance           /reports/sla-compliance
/reports/time-billing               /reports/projects
/reports/contacts                   /reports/csat
/reports/customer-happiness         /reports/assets/replacement
/reports/assets/warranty            /reports/assets/inventory
/reports/assets/ticket-history      /reports/licenses/inventory
/reports/contracts/summary          /reports/licenses/spend
/reports/contracts/spend            /reports/licenses-contracts/upcoming-renewals
/csat/stats                         /csat/responses
```

**CSV exports.** For every `/export` route above, plus `/reports/tickets/export`, the same check on `res.text`.

**Custom reports.** For each `dataSource` in `tickets`, `projects`, `time_entries`, `expenses_materials` and `contacts`, `POST /reports/custom { dataSource }`: the admin's body leaks the marker and the fenced user's doesn't.

**Totals.** Fenced `time-billing` `summary.totalHours` excludes Acme's 1.5 hours. Fenced `team-performance` counts no Acme tickets.

Some reports group or aggregate, so a name may not appear verbatim. Where a report shows only numbers, assert the fenced total instead: the Acme rows' contribution is missing. Pick that per report while writing the table.

- [ ] **Step 2: Run them and watch them fail**

Run: `cd backend && npm test -- companies.reports.test.js`
Expected: every fenced row fails.

- [ ] **Step 3: Implement**

`reportsController.js`. Change the three helpers so their last parameter is `companyWhere` and they return `andWhere(<existing result>, companyWhere)`. Then in **every** `build*Report`:
- compute `const companyWhere = await companyScopeWhere(req.user)` at the top;
- pass it into each helper call;
- AND it into every other query on a company-owned table.

The builders that don't use the helpers:
- **`buildTeamPerformanceReport`:** each `Ticket.findAll` gets `companyWhere`. The `TimeEntry` sum gets `include: [{ model: Ticket, as: 'ticket', attributes: [], where: companyWhere, required: !isEmpty(companyWhere) }]`.
- **`buildTimeBillingReport`:** the ticket entries take `await companyScopeWhere(req.user, '$ticket.companyId$')`; the project entries take `await companyScopeWhere(req.user, '$project.companyId$')`.
- **`csat` and `buildCustomerHappinessReport`:** fence through the ticket (`$ticket.companyId$` with the ticket include).
- **The asset, license and contract builders** (the `resolveReportDeptId` ones): AND `companyWhere` into their top-level where.
- **`ticketsExport`:** the `ticketScopeWhere` helper.

`customReportEngine.js`:
- every loader: `andWhere(<existing where>, await companyScopeWhere(req.user))`;
- `loadTimeEntryRecords`: the `$ticket.companyId$` and `$project.companyId$` columns, as in time-billing;
- `loadExpenseMaterialRecords`: fences through `$project.companyId$` on its project include.

`csatStatsService.js`:
- `getOverview` and `getTeamHappiness` accept `companyWhere`, and filter responses and surveys through their ticket;
- `csatController` and `dashboardController` pass the viewer's.

- [ ] **Step 4: Run the file, then the suite**

Run: `cd backend && npm test -- companies.reports.test.js`, then `npm test`.
Expected: PASS. The suite is green, including `readers.reports` and `readers.other` (the ledger cross-check), which proves unfenced numbers didn't move.

- [ ] **Step 5: Commit**

```bash
git add backend/src/controllers/reportsController.js backend/src/services/customReportEngine.js backend/src/services/csatStatsService.js backend/src/controllers/csatController.js backend/src/controllers/dashboardController.js backend/test/integration/companies.reports.test.js
git commit -m "feat(companies): reports, custom reports and CSAT stats fenced by company"
```

---

### Task 11: Inbound email files new contacts under the sender's company

**Files:**
- Modify: `backend/src/services/inboundEmailService.js` (`findOrCreateContact` matches the domain; export it)
- Test: `backend/test/integration/companies.inbound.test.js`

**Interfaces:**
- Consumes: `CompanyDomain`, `Company` and `FREE_MAIL_DOMAINS` (Tasks 2 and 3).
- Produces: `findOrCreateContact(fromEmail, fromName) → Promise<Contact|null>`, exported. A new contact gets the company owning the sender's domain, if that company is active; otherwise the internal company (via the model hook).

- [ ] **Step 1: Write the failing tests**

```js
const { resetData, closeDb, models } = require('./helpers');
const { makeWorld } = require('./fixtures');
const { findOrCreateContact } = require('../../src/services/inboundEmailService');

const { Company, CompanyDomain, Contact } = models;

let acme;
let internalId;
beforeEach(async () => {
  await resetData();
  await makeWorld();
  internalId = (await Company.findOne({ where: { isInternal: true } })).id;
  acme = await Company.create({ name: 'Acme', isClient: true });
  await CompanyDomain.create({ companyId: acme.id, domain: 'acme.com' });
});
afterAll(closeDb);

it('a sender from a company\'s domain becomes that company\'s contact', async () => {
  const c = await findOrCreateContact('Ann.Smith@ACME.com', 'Ann Smith');
  expect(c.companyId).toBe(acme.id);
});

it('an unknown domain goes to the internal company', async () => {
  expect((await findOrCreateContact('bob@elsewhere.org', 'Bob')).companyId).toBe(internalId);
});

it('a free-mail domain never matches, even if someone listed it', async () => {
  // The API refuses free-mail domains; this proves the matcher refuses them
  // too, should one ever be inserted directly.
  await CompanyDomain.create({ companyId: acme.id, domain: 'gmail.com' });
  expect((await findOrCreateContact('carol@gmail.com', 'Carol')).companyId).toBe(internalId);
});

it('an inactive company\'s domain doesn\'t match', async () => {
  await acme.update({ status: 'inactive' });
  expect((await findOrCreateContact('dan@acme.com', 'Dan')).companyId).toBe(internalId);
});

it('an existing contact is returned unchanged', async () => {
  const existing = await Contact.create({ firstName: 'Eve', displayName: 'Eve', email: 'eve@acme.com' });
  const found = await findOrCreateContact('eve@acme.com', 'Eve');
  expect([found.id, found.companyId]).toEqual([existing.id, internalId]);
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd backend && npm test -- companies.inbound.test.js`
Expected: FAIL. `findOrCreateContact` isn't exported, and after exporting it, the Acme sender lands in the internal company.

- [ ] **Step 3: Implement**

In `findOrCreateContact`, before `Contact.create`:

```js
  // Spec: match the sender's domain to a company; free-mail never matches;
  // otherwise the model hook files the contact under the internal company.
  const domain = email.split('@')[1] || '';
  let companyId;
  if (domain && !FREE_MAIL_DOMAINS.has(domain)) {
    const owner = await CompanyDomain.findOne({
      where: { domain },
      include: [{ model: Company, as: 'company', where: { status: 'active' }, attributes: ['id'] }],
    });
    if (owner) companyId = owner.companyId;
  }
```

Pass `companyId` into `Contact.create` (when it's `undefined`, the hook supplies the internal company). Require `CompanyDomain` and `Company` from the models and `FREE_MAIL_DOMAINS` from `companyService`, and add `findOrCreateContact` to `module.exports`.

- [ ] **Step 4: Run the file, then the suite**

Run: `cd backend && npm test -- companies.inbound.test.js`, then `npm test`.
Expected: PASS, and the suite is green.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/inboundEmailService.js backend/test/integration/companies.inbound.test.js
git commit -m "feat(companies): inbound email files new contacts under the sender's company"
```

---

### Task 12: Docs, the whole suite, and a security review

**Files:**
- Modify: `docs/ROADMAP.md`, `UPGRADING.md`, `docs/superpowers/specs/2026-10-04-client-companies-design.md`

- [ ] **Step 1: Run the whole suite and check file sizes**

Run: `cd backend && npm test`
Expected: PASS, every suite.

Run: `wc -l backend/test/integration/companies.*.test.js backend/src/services/recordScope.js backend/src/controllers/companiesController.js backend/src/controllers/sitesController.js backend/src/controllers/companyAccessController.js | sort -n | tail -4`
Expected: nothing over about 800 lines.

- [ ] **Step 2: Write the plan's rulings back into the spec**

In the spec:
- **Decisions table:** add a row "`multiCompany` means at least one client company exists; vendor companies alone (including those the migration creates from vendor text) never turn on company pickers."
- **Scope and permissions → Where the fence goes:** add "Cross-module links (asset ↔ ticket, license ↔ asset/contact, contract ↔ asset) must point at a visible record in the same company."
- **Out of scope / security notes:** list S9 and S10 as fixed here.
- **Integrity rules:** "An inactive company, site or department cannot be newly chosen" becomes "…company or site…". Departments have no status column, and adding one is out of scope.

- [ ] **Step 3: Update `docs/ROADMAP.md` and `UPGRADING.md`**

`ROADMAP.md` sub-project 2:
- set Status to **Building**;
- set Plan to `[plan 2a](superpowers/plans/2026-10-04-client-companies-core.md)`, with "plan 2b: screens, vendors, merge, import — next" next to it.

`UPGRADING.md` → Unreleased: add a section:

```markdown
### Client companies (backend)

Upgrading creates one company for your organization and puts every existing
department, contact, ticket, project, asset, license and contract under it.
Free-text vendor names on assets, licenses, contracts and project materials
become vendor companies (the original text is kept for one more release).
Until you add a client company, nothing behaves differently.
```

- [ ] **Step 4: Security review**

Run the `security-review` skill (or `code-review` at `high`) on the range from this plan's first commit to `HEAD`, and fix any Critical or Important findings test-first. This is the first sub-project that changes the core of authorization (spec → Done when).

- [ ] **Step 5: Commit**

```bash
git add docs/ROADMAP.md UPGRADING.md docs/superpowers/specs/2026-10-04-client-companies-design.md
git commit -m "docs: client companies backend (plan 2a) — rulings, roadmap, upgrading"
```

Push only when the user says so.
