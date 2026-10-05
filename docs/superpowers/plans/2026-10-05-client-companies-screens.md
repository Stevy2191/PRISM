# Client Companies — Screens, Vendors, Merge and Import (plan 2b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish sub-project 2. Add every client-company screen, vendor companies on assets, licenses, contracts and materials, company merge, and the CSV import's Company column, so sub-project 2 can be marked Shipped.

**Architecture:**
- **Backend:** the remaining APIs (vendors, merge, import, report filter, the ticket-people rule) build on plan 2a's helpers: `resolveRecordCompany`, `companyScopeWhere`, `andWhere` and `parseRecordId`. Merge lives in a new `services/companyMerge.js`.
- **Frontend:** a `CompanyContext` holds the `multiCompany` switch. Small shared components in `frontend/src/components/companies/` (CompanyFilter, CompanyPicker, VendorPicker, SitePicker, CompanyTag) drop into the existing pages with light edits. New screens live in `frontend/src/pages/companies/`.
- **Verification:** each screen is checked by a committed browser smoke test. Headless Chromium drives the real API and the built frontend, both served from one in-process server on the test database.

**Tech Stack:** Node 24.9+, Express 4, Sequelize 6 on MariaDB 11, Jest 30 + supertest. React 18 + Vite 6 + Tailwind. **One new dev dependency:** `playwright-core@1.61.1` in `backend/`, for the smoke tests only.

**Spec:** [`docs/superpowers/specs/2026-10-04-client-companies-design.md`](../specs/2026-10-04-client-companies-design.md). Read it first, especially *Behaviour*, *API* and *Screens*. Plan 2a ([`2026-10-04-client-companies-core.md`](2026-10-04-client-companies-core.md)) is shipped; its helpers are the interfaces this plan consumes.

**Decisions made with the user for this plan (2026-10-05):**
- **Screens are verified by a committed Playwright smoke suite.** It drives the real backend on the test DB, runs locally, and is not in CI yet.
- **Vendor-only companies are shared.** A company that is only a vendor shows in every vendor picker. A company that is also a client shows only to users who can reach it.
- **Assignees and watchers who can't reach a ticket's company are refused.** Pickers list only people who can.
- **Fixed here** (deferred minors from plan 2a): clearing `isClient` while a company still has records; the server defaulting a new ticket's department to the contact's; existence oracles; the migration's whitespace mismatch on vendor text.

## Global Constraints

- **Node `>=24.9`.** Run tests from `backend/`:
  - one file: `npm test -- <file>`;
  - everything: `npm test`, which takes about 11 minutes. Run it in the background.
- **The test DB** is the `prism-test-db` container on `127.0.0.1:3307`; `docker start prism-test-db` if it's stopped.
  - Migrate with `(set -a; . ./.env.test; set +a; npm run test:migrate)`.
- **Smoke tests:**
  - `npm run test:smoke -- <file>` builds the frontend, then runs `backend/test/smoke/<file>`.
  - They share the test DB with the integration suite. Never run both at once.
- **Build check:** `npm --prefix frontend run build` must pass after every frontend task.
- **File size:** no new file over about 800 lines. `TicketDetail.jsx`, `TicketNew.jsx`, `ProjectDetail.jsx`, `ticketsController.js` and `projectsController.js` are touched lightly; new code goes in new, small files (spec, *Large files*).
- **One-company installs:** company UI shows only when `multiCompany` is true (`GET /companies/summary`). With no client company, the only new UI is Settings → Companies (spec, *The company picker*). Vendor, site and company pickers are company UI.
- **Security rules from plans 1 and 2a apply to every new field and endpoint:**
  - ids are parsed with `parseRecordId`;
  - a missing id and an out-of-scope id get the same refusal;
  - the checked record's own id is stored;
  - lists AND the company fence (`andWhere`), never spread it.
- **Quirks stay pinned.** A test marked `[quirk]` documents current behaviour and is not changed unless the user says so (Q28: deletes skip the tier re-check).
- **Commits:**
  - one or more per task, with the message given;
  - end every message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`;
  - push only when the user says so.

## Review Focus

1. **A one-company install looks unchanged.** No company column, filter, picker, vendor picker or site picker, and no Companies nav tab; Settings → Companies is the only new screen. *(Task 9 smoke: "a one-company install shows only Settings → Companies".)*
2. **A fenced user's pickers never offer another company's records.** This covers companies, sites, departments, assignees, watchers and contacts on asset forms. Vendor pickers offer shared vendor-only companies. *(Task 3 case 1, Task 8 cases 4–5, Task 15 smoke "the asset form only offers the chosen company's departments and sites".)*
3. **A merge with clashes.** Same-named departments and sites, and a user or role granted both companies, must not break the merge or lose access. *(Task 5 cases 3–4.)*
4. **Changing a contact's company from the UI.** It asks for confirmation, then moves the tickets and clears a foreign department and site. *(Task 12 smoke "moving a contact asks first and takes its tickets".)*
5. **The server's default ticket department may change baseline tests.** A ticket created without a department now gets the contact's. Any baseline test this changes is a ledgered ruling, not a silent edit. *(Task 8 case 6, plus Task 8's full-suite step.)*

---

## File map

**Backend — create**
- `backend/jest.smoke.config.js`: Jest config for the browser smoke tests.
- `backend/test/smoke/harness.js`: in-process API plus built frontend, headless Chromium, `pageAs(username)`.
- `backend/test/smoke/*.smoke.js`: one file per screen area (Tasks 1, 9–18).
- `backend/migrations/20260101000049-client-companies-followup.js`: Companies nav module; vendor whitespace relink.
- `backend/src/services/companyMerge.js`: `mergeCounts`, `mergeCompanies`.
- `backend/src/services/ticketPeople.js`: `canWorkCompany`, `assertCanWorkTicket`.
- `backend/test/integration/`:
  - `companies.followup.test.js`;
  - `companies.vendors.test.js`;
  - `companies.manage.test.js`;
  - `companies.merge.test.js`;
  - `companies.import.test.js`;
  - `companies.reportfilter.test.js`;
  - `companies.ticketpeople.test.js`.

**Backend — modify**
- `backend/package.json`: `playwright-core` dev dependency; the `test:smoke` script.
- `backend/src/services/companyService.js`: `isSharedVendor`, `resolveVendorCompany`, `resolveVendorFields`.
- `backend/src/services/recordScope.js`: `companyFilterWhere`.
- `backend/src/controllers/`:
  - `companiesController.js`: `vendors`, `merge`, list counts, summary count, client-flag guard;
  - `assetsController.js`, `licensesController.js`, `contractsController.js`, `projectsController.js`: vendor fields;
  - `contactImportController.js`: Company column;
  - `reportsController.js`, `csatController.js`: company filter;
  - `ticketsController.js`: ticket people; department default;
  - `usersController.js`: `?companyId=` on assignable and directory;
  - `departmentsController.js`: `owners`.
- `backend/src/services/customReportEngine.js`: company filter.
- `backend/src/routes/companies.js`, `routes/departments.js`.

**Frontend — create**
- `frontend/src/context/CompanyContext.jsx`: `CompanyProvider`, `useCompanySummary()`.
- `frontend/src/hooks/useCompanyOptions.js`: active client and internal companies for pickers.
- `frontend/src/utils/contactLabel.js`: "Name · Company · Department".
- `frontend/src/components/companies/`:
  - `CompanyFilter.jsx`;
  - `CompanyPicker.jsx`;
  - `VendorPicker.jsx`;
  - `SitePicker.jsx`;
  - `CompanyTag.jsx`;
  - `CompanyFormModal.jsx`;
  - `MergeCompanyModal.jsx`;
  - `CompanyOverview.jsx`;
  - `CompanySites.jsx`;
  - `CompanyDepartments.jsx`;
  - `CompanyRecordList.jsx`;
  - `ContactCompanyFields.jsx`;
  - `CompanyAccessPanel.jsx`.
- `frontend/src/pages/companies/CompaniesList.jsx`, `CompanyPage.jsx`.

**Frontend — modify (light)**
- **App shell:** `main.jsx`, `App.jsx`, `components/navConfig.js`, `TopNav.jsx`, `SidebarCompact.jsx`, `pages/SettingsHub.jsx`.
- **Contacts:** `pages/Contacts.jsx`, `ContactDetail.jsx`.
- **Tickets:** `pages/TicketNew.jsx`, `TicketDetail.jsx`, `Tickets.jsx`.
- **Projects:** `pages/ProjectNew.jsx`, `ProjectDetail.jsx`, `Projects.jsx`.
- **Assets:**
  - pages: `pages/Assets.jsx`, `assets/Licenses.jsx`, `assets/Contracts.jsx`, `AssetDetail.jsx`, `assets/LicenseDetail.jsx`;
  - forms: `components/AssetFormModal.jsx`, `LicenseFormModal.jsx`, `ContractFormModal.jsx`.
- **Reports:** `pages/Reports.jsx`, `pages/reports/*.jsx`.
- **Users and settings:** `pages/UserDetail.jsx`, `RoleEditor.jsx`, `AdminDepartments.jsx`, `components/ImportContactsModal.jsx`.

---

### Task 1: Browser smoke harness

The frontend has no tests. This task adds a small Jest suite that serves the real API and the built SPA from one in-process server, on the integration test DB, and drives it with headless Chromium. Later tasks write a failing smoke test before each screen change.

**Files:**
- Create: `backend/jest.smoke.config.js`, `backend/test/smoke/harness.js`, `backend/test/smoke/login.smoke.js`
- Modify: `backend/package.json` (`playwright-core` dev dependency; `test:smoke` script)

**Interfaces:**
- Consumes: `createApp`, `createSessionStore` (`src/app.js`); `resetData`, `closeDb` (`test/integration/helpers.js`); `makeAdmin` (`test/integration/fixtures.js`). Fixture users all have the password `IntegrationPass!2026`.
- Produces: `startSmoke() → Promise<{ base: string, pageAs(username: string, password?: string): Promise<Page>, stop(): Promise<void> }>`. `pageAs` opens a browser page already signed in as that user, with relative URLs resolving against `base`.

- [ ] **Step 1: Write the failing smoke test**

`backend/test/smoke/login.smoke.js`:

```js
const { resetData, closeDb } = require('../integration/helpers');
const { makeAdmin } = require('../integration/fixtures');
const { startSmoke } = require('./harness');

// The harness itself: a signed-in admin reaches the dashboard through the
// real API and the built frontend.

let smoke;
beforeAll(async () => { smoke = await startSmoke(); });
afterAll(async () => { await smoke.stop(); await closeDb(); });
beforeEach(resetData);

it('a signed-in admin lands on the dashboard', async () => {
  await makeAdmin();
  const page = await smoke.pageAs('admin');
  await page.goto('/dashboard');
  await page.getByRole('link', { name: 'Tickets' }).first().waitFor();
  expect(page.url()).toContain('/dashboard');
});
```

`backend/jest.smoke.config.js`:

```js
// Browser smoke tests (plan 2b). Not part of `npm test` or CI: they need a
// built frontend and a headless Chromium. Run with `npm run test:smoke`.
module.exports = {
  testEnvironment: 'node',
  maxWorkers: 1,
  globalSetup: '<rootDir>/test/checkNodeVersion.js',
  setupFiles: ['<rootDir>/test/load-env.js'],
  testMatch: ['<rootDir>/test/smoke/**/*.smoke.js'],
  testTimeout: 60000,
};
```

In `backend/package.json` `scripts`, add after `"test"`:

```json
"test:smoke": "npm --prefix ../frontend run build && cross-env NODE_OPTIONS=--experimental-vm-modules jest -c jest.smoke.config.js",
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd backend && npm run test:smoke -- login.smoke.js`
Expected: FAIL, `Cannot find module './harness'`.

- [ ] **Step 3: Add the dependency and write the harness**

Run: `cd backend && npm install --save-dev playwright-core@1.61.1`. Version 1.61.1 drives the `chromium_headless_shell-1234` build already in `~/.cache/ms-playwright`.

`backend/test/smoke/harness.js`:

```js
// Browser smoke tests: the real API and the built frontend, served from one
// in-process server on the integration test DB, driven by headless Chromium.
// Pages see one origin, as they do behind nginx in production.
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const { chromium } = require('playwright-core');
const { createApp, createSessionStore } = require('../../src/app');

const DIST = path.join(__dirname, '../../../frontend/dist');
const PASSWORD = 'IntegrationPass!2026'; // every fixture user's password

// PRISM_CHROMIUM wins; otherwise the newest headless shell playwright has
// installed under ~/.cache/ms-playwright.
function findChromium() {
  if (process.env.PRISM_CHROMIUM) return process.env.PRISM_CHROMIUM;
  const root = path.join(os.homedir(), '.cache/ms-playwright');
  const builds = fs.existsSync(root)
    ? fs.readdirSync(root).filter((d) => d.startsWith('chromium_headless_shell-')).sort().reverse()
    : [];
  for (const build of builds) {
    for (const sub of fs.readdirSync(path.join(root, build))) {
      const exe = path.join(root, build, sub, 'chrome-headless-shell');
      if (fs.existsSync(exe)) return exe;
    }
  }
  throw new Error('No headless Chromium found: set PRISM_CHROMIUM, or run `npx playwright-core install chromium-headless-shell`');
}

async function startSmoke() {
  if (!fs.existsSync(path.join(DIST, 'index.html'))) {
    throw new Error('frontend/dist is missing: `npm run test:smoke` builds it first');
  }
  const sessionStore = createSessionStore();
  await sessionStore.sync();

  const outer = express();
  outer.use(express.static(DIST, { index: false }));
  // Client-side routes get the SPA; everything under /api goes to the API.
  outer.use((req, res, next) => (
    req.method === 'GET' && !req.path.startsWith('/api/') ? res.sendFile(path.join(DIST, 'index.html')) : next()
  ));
  outer.use(createApp({ sessionStore }));

  const server = await new Promise((resolve) => {
    const s = outer.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ executablePath: findChromium() });

  // A page signed in as `username`: the context's request client shares its
  // cookie jar with the pages it opens.
  async function pageAs(username, password = PASSWORD) {
    const context = await browser.newContext({ baseURL: base });
    const res = await context.request.post('/api/v1/auth/login', { data: { username, password } });
    if (!res.ok()) throw new Error(`smoke login failed for ${username}: ${res.status()}`);
    return context.newPage();
  }

  async function stop() {
    await browser.close();
    await new Promise((resolve) => { server.close(resolve); });
  }

  return { base, pageAs, stop };
}

module.exports = { startSmoke };
```

- [ ] **Step 4: Run it and watch it pass**

Run: `cd backend && npm run test:smoke -- login.smoke.js`
Expected: PASS (1 test). Then run `npm test -- fixtures.test.js`. Expected: PASS. Jest's default `testMatch` (`*.test.js`) doesn't pick up `*.smoke.js`, so the main suite is unchanged.

- [ ] **Step 5: Commit**

```bash
git add backend/package.json backend/package-lock.json backend/jest.smoke.config.js backend/test/smoke
git commit -m "test(smoke): browser smoke harness on the real API and built frontend"
```

---

### Task 2: Follow-up migration — Companies nav module, vendor text relink

**Two jobs:**
- **The nav module:** the Companies nav tab is "behind module visibility" (spec), so it needs a `ModuleVisibility` row.
- **The whitespace relink:** plan 2a's migration grouped vendor spellings with JavaScript `trim()` but linked rows with SQL `TRIM()`, which strips only spaces, so a value like `"Dell\t"` got a vendor company and was never linked to it. This task relinks those rows.

**Files:**
- Create: `backend/migrations/20260101000049-client-companies-followup.js`
- Test: `backend/test/integration/companies.followup.test.js`

**Interfaces:**
- Consumes: the `ModuleVisibility` table (`moduleName`, `visibleToRoles` as JSON text); the vendor columns `Assets.vendorName`, `Licenses.vendor`, `Contracts.vendor`, `ProjectMaterials.vendor`, each with `vendorCompanyId`.
- Produces: a `ModuleVisibility` row `companies` visible to `["admin","technician"]`. The frontend nav (Task 9) reads it through `GET /modules`.

- [ ] **Step 1: Write the failing tests**

```js
const Sequelize = require('sequelize');
const { resetData, closeDb, models } = require('./helpers');
const { makeWorld } = require('./fixtures');
const migration = require('../../migrations/20260101000049-client-companies-followup');

// Plan 2b task 2: the Companies nav module, and vendor text that plan 2a's
// migration couldn't link because SQL TRIM() keeps tabs and newlines.

const { Company, Asset, AssetCategory, ModuleVisibility, sequelize } = models;
const up = () => migration.up(sequelize.getQueryInterface(), Sequelize);

let category;
beforeEach(async () => {
  await resetData();
  await AssetCategory.destroy({ where: { name: 'Laptops' } });
  await makeWorld();
  category = await AssetCategory.create({ name: 'Laptops' });
});
afterAll(async () => {
  await AssetCategory.destroy({ where: { name: 'Laptops' } });
  await closeDb();
});

it('links vendor text that differs only by tabs, newlines or inner spaces', async () => {
  const dell = await Company.create({ name: 'Dell', isVendor: true });
  const a = await Asset.create({ assetTag: 'V-1', name: 'a', categoryId: category.id, vendorName: 'Dell\t' });
  const b = await Asset.create({ assetTag: 'V-2', name: 'b', categoryId: category.id, vendorName: '\nDELL ' });
  await up();
  expect((await Asset.findByPk(a.id)).vendorCompanyId).toBe(dell.id);
  expect((await Asset.findByPk(b.id)).vendorCompanyId).toBe(dell.id);
});

it('creates a vendor company for a spelling with none yet, once', async () => {
  await Asset.create({ assetTag: 'V-3', name: 'c', categoryId: category.id, vendorName: 'Big  Vendor\t' });
  await Asset.create({ assetTag: 'V-4', name: 'd', categoryId: category.id, vendorName: 'big vendor' });
  await up();
  const made = await Company.findAll({ where: { isVendor: true, name: 'Big Vendor' } });
  expect(made).toHaveLength(1);
  expect(await Asset.count({ where: { vendorCompanyId: made[0].id } })).toBe(2);
});

it('leaves blank vendor text and already-linked rows alone', async () => {
  const hp = await Company.create({ name: 'HP', isVendor: true });
  const linked = await Asset.create({ assetTag: 'V-5', name: 'e', categoryId: category.id, vendorName: 'Dell', vendorCompanyId: hp.id });
  const blank = await Asset.create({ assetTag: 'V-6', name: 'f', categoryId: category.id, vendorName: ' \t ' });
  await up();
  expect((await Asset.findByPk(linked.id)).vendorCompanyId).toBe(hp.id);
  expect((await Asset.findByPk(blank.id)).vendorCompanyId).toBeNull();
});

it('adds the Companies nav module, and running twice is harmless', async () => {
  await up();
  await up();
  const rows = await ModuleVisibility.findAll({ where: { moduleName: 'companies' } });
  expect(rows).toHaveLength(1);
  expect(JSON.parse(rows[0].visibleToRoles)).toEqual(['admin', 'technician']);
});
```

`resetData` doesn't touch `ModuleVisibility`. The migration has already run on the test DB, so the row exists before the last test; it checks there's still exactly one after two more runs.

- [ ] **Step 2: Run them and watch them fail**

Run: `cd backend && npm test -- companies.followup.test.js`
Expected: FAIL, `Cannot find module '../../migrations/20260101000049-client-companies-followup'`.

- [ ] **Step 3: Write the migration**

```js
// Client companies follow-up (plan 2b):
//   - the Companies nav module (spec: "behind module visibility");
//   - vendor text that 20260101000048 grouped with JavaScript trim() but
//     linked with SQL TRIM() (spaces only), so "Dell\t" got a vendor company
//     and was never linked to it. Spellings are compared here the same way
//     for grouping and linking: whitespace runs collapsed, ends trimmed,
//     case ignored.
const VENDOR_SOURCES = [['Assets', 'vendorName'], ['Licenses', 'vendor'], ['Contracts', 'vendor'], ['ProjectMaterials', 'vendor']];
const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();

module.exports = {
  up: async (queryInterface) => {
    const select = (sql, replacements) => queryInterface.sequelize.query(sql, { replacements, type: 'SELECT' });

    const [existing] = await select("SELECT id FROM ModuleVisibility WHERE moduleName = 'companies'");
    if (!existing) {
      await queryInterface.bulkInsert('ModuleVisibility', [
        { moduleName: 'companies', visibleToRoles: JSON.stringify(['admin', 'technician']) },
      ]);
    }

    const vendorIdByKey = new Map(
      (await select('SELECT id, name FROM Companies WHERE isVendor = 1 ORDER BY id'))
        .map((c) => [normalize(c.name).toLowerCase(), c.id])
    );
    for (const [table, column] of VENDOR_SOURCES) {
      // eslint-disable-next-line no-await-in-loop
      const rows = await select(`SELECT id, \`${column}\` AS text FROM \`${table}\` WHERE vendorCompanyId IS NULL AND \`${column}\` IS NOT NULL`);
      for (const row of rows) {
        const name = normalize(row.text).slice(0, 150);
        if (!name) continue; // eslint-disable-line no-continue
        const key = name.toLowerCase();
        if (!vendorIdByKey.has(key)) {
          // eslint-disable-next-line no-await-in-loop
          await queryInterface.bulkInsert('Companies', [{ name, isInternal: false, isClient: false, isVendor: true, status: 'active' }]);
          // eslint-disable-next-line no-await-in-loop
          const [made] = await select('SELECT id FROM Companies WHERE isVendor = 1 AND name = :name ORDER BY id DESC LIMIT 1', { name });
          vendorIdByKey.set(key, made.id);
        }
        // eslint-disable-next-line no-await-in-loop
        await queryInterface.sequelize.query(
          `UPDATE \`${table}\` SET vendorCompanyId = :vendorId WHERE id = :id`,
          { replacements: { vendorId: vendorIdByKey.get(key), id: row.id } }
        );
      }
    }
  },

  // The relinks are correct data and stay; only the nav module goes.
  down: async (queryInterface) => {
    await queryInterface.bulkDelete('ModuleVisibility', { moduleName: 'companies' });
  },
};
```

Then migrate the test DB: `cd backend && (set -a; . ./.env.test; set +a; npm run test:migrate)`.

- [ ] **Step 4: Run them and watch them pass**

Run: `cd backend && npm test -- companies.followup.test.js companies.migration.test.js migrations.test.js`
Expected: PASS. `migrations.test.js` covers the down/up round trip of every migration.

- [ ] **Step 5: Commit**

```bash
git add backend/migrations/20260101000049-client-companies-followup.js backend/test/integration/companies.followup.test.js
git commit -m "feat(companies): Companies nav module; link vendor text that differed only by whitespace"
```

---

### Task 3: Vendor companies on assets, licenses, contracts and materials

**Files:**
- Modify: `backend/src/services/companyService.js`; `backend/src/controllers/companiesController.js`, `assetsController.js`, `licensesController.js`, `contractsController.js`, `projectsController.js` (materials); `backend/src/routes/companies.js`
- Test: `backend/test/integration/companies.vendors.test.js`

**Interfaces:**
- Consumes: `canAccessCompany`, `companyScopeWhere`, `parseRecordId` (permissionService); `isEmpty`, `andWhere` (recordScope).
- Produces:
  - `isSharedVendor(company) → boolean`: `isVendor && !isClient && !isInternal`.
  - `resolveVendorCompany(user, rawId) → Promise<Company>`: 400 `Unknown vendor` unless the company is an active vendor that is shared or reachable.
  - `resolveVendorFields(user, body, record, textColumn) → Promise<object>`: the `vendorCompanyId` (plus the mirrored vendor text) to write. Empty when the body has no `vendorCompanyId`, or re-sends the record's current one.
  - `GET /companies/vendors?search=` → `{ vendors: [{ id, name }] }` (≤ 25), for holders of `assets.view`, `projects.manage_expenses` or `companies.view`.
  - Assets, licenses, contracts and materials accept `vendorCompanyId` and include `vendorCompany: { id, name }`. Asset, license and contract lists accept `?vendorCompanyId=`.

- [ ] **Step 1: Write the failing tests**

```js
const { resetData, closeDb, models } = require('./helpers');
const {
  API, expectOk, makeWorld, makeTech, makeProject, makeCompany, setCompanyAccess,
} = require('./fixtures');

// Plan 2b task 3: vendor companies. Vendor-only companies are shared
// reference data; a company that is also a client is fenced like a client.

const { Company } = models;

let w;
let category;
let dell;
let acme;
let fenced;
const a = () => w.admin.agent;
const expectErr = (res, status, code, message) => {
  expect({ status: res.status, body: res.body }).toEqual({ status, body: { error: true, message, code } });
};
beforeEach(async () => {
  await resetData();
  await models.AssetCategory.destroy({ where: { name: 'Laptops' } });
  w = await makeWorld();
  category = await models.AssetCategory.create({ name: 'Laptops' });
  dell = await Company.create({ name: 'Dell', isVendor: true });
  acme = await makeCompany(w.admin, { name: 'Acme', isClient: true, isVendor: true });
  const internalId = (await Company.findOne({ where: { isInternal: true } })).id;
  fenced = await makeTech('fenced', w.deptA.id);
  await setCompanyAccess(w.admin, fenced.user.id, { allCompanies: false, companyIds: [internalId] });
});
afterAll(async () => {
  await models.AssetCategory.destroy({ where: { name: 'Laptops' } });
  await closeDb();
});
const newAsset = (body, agent = a()) => agent.post(`${API}/assets`).send({ name: 'L', categoryId: category.id, ...body });

it('the vendor picker offers shared vendors to everyone, and a client-vendor only to those who reach it', async () => {
  const names = async (agent) => expectOk(await agent.get(`${API}/companies/vendors`)).vendors.map((v) => v.name);
  expect(await names(a())).toEqual(['Acme', 'Dell']);
  expect(await names(fenced.agent)).toEqual(['Dell']);
  expect(expectOk(await a().get(`${API}/companies/vendors?search=de`)).vendors.map((v) => v.name)).toEqual(['Dell']);
});

it('an asset can be bought from a vendor company, and its vendor text follows the company', async () => {
  const asset = expectOk(await newAsset({ assetTag: 'A-1', vendorCompanyId: dell.id, vendorName: 'typo' }), 201).asset;
  expect(asset.vendorCompany).toEqual({ id: dell.id, name: 'Dell' });
  expect(asset.vendorName).toBe('Dell');
});

it('the vendor must be an active vendor company the user may pick', async () => {
  const clientOnly = await makeCompany(w.admin, { name: 'Globex' });
  const retired = await Company.create({ name: 'Old Vendor', isVendor: true, status: 'inactive' });
  for (const [tag, vendorCompanyId] of [['B-1', clientOnly.id], ['B-2', retired.id], ['B-3', 'abc'], ['B-4', 99999], ['B-5', `${dell.id}x`]]) {
    // eslint-disable-next-line no-await-in-loop
    expectErr(await newAsset({ assetTag: tag, vendorCompanyId }), 400, 'VALIDATION_ERROR', 'Unknown vendor');
  }
  // Acme is a vendor too, but the fenced user can't reach it: the same answer.
  expectErr(await newAsset({ assetTag: 'B-6', vendorCompanyId: acme.id }, fenced.agent), 400, 'VALIDATION_ERROR', 'Unknown vendor');
  expectOk(await newAsset({ assetTag: 'B-7', vendorCompanyId: dell.id }, fenced.agent), 201);
});

it('re-sending the current vendor after it is deactivated still saves', async () => {
  const asset = expectOk(await newAsset({ assetTag: 'C-1', vendorCompanyId: dell.id }), 201).asset;
  await dell.update({ status: 'inactive' });
  expectOk(await a().patch(`${API}/assets/${asset.id}`).send({ vendorCompanyId: dell.id, notes: 'x' }));
  const cleared = expectOk(await a().patch(`${API}/assets/${asset.id}`).send({ vendorCompanyId: null })).asset;
  expect(cleared.vendorCompanyId).toBeNull();
});

it('licenses, contracts and project materials take a vendor company too', async () => {
  const license = expectOk(await a().post(`${API}/licenses`).send({ name: 'Office', vendorCompanyId: dell.id }), 201).license;
  expect([license.vendor, license.vendorCompany]).toEqual(['Dell', { id: dell.id, name: 'Dell' }]);
  // A contract needs a vendor: the company alone is enough.
  const contract = expectOk(await a().post(`${API}/contracts`).send({ name: 'Support', vendorCompanyId: dell.id }), 201).contract;
  expect([contract.vendor, contract.vendorCompany]).toEqual(['Dell', { id: dell.id, name: 'Dell' }]);
  expectErr(await a().post(`${API}/contracts`).send({ name: 'No vendor' }), 400, 'VALIDATION_ERROR', 'Vendor is required');
  const project = await makeProject(a(), { name: 'P', ownerDepartmentId: w.deptA.id });
  const material = expectOk(await a().post(`${API}/projects/${project.id}/materials`).send({ itemName: 'Switch', quantity: 1, unitCost: 5, vendorCompanyId: dell.id }), 201).material;
  expect([material.vendor, material.vendorCompanyId]).toEqual(['Dell', dell.id]);
  const { materials } = expectOk(await a().get(`${API}/projects/${project.id}/materials`));
  expect(materials[0].vendorCompany).toEqual({ id: dell.id, name: 'Dell' });
});

it('asset, license and contract lists filter by vendor', async () => {
  expectOk(await newAsset({ assetTag: 'D-1', vendorCompanyId: dell.id }), 201);
  expectOk(await newAsset({ assetTag: 'D-2' }), 201);
  const tags = expectOk(await a().get(`${API}/assets?vendorCompanyId=${dell.id}`)).assets.map((x) => x.assetTag);
  expect(tags).toEqual(['D-1']);
  expect(expectOk(await a().get(`${API}/assets?vendorCompanyId=abc`)).assets).toEqual([]);
  expectOk(await a().post(`${API}/licenses`).send({ name: 'L1', vendorCompanyId: dell.id }), 201);
  expect(expectOk(await a().get(`${API}/licenses?vendorCompanyId=${dell.id}`)).licenses).toHaveLength(1);
  expectOk(await a().post(`${API}/contracts`).send({ name: 'K1', vendorCompanyId: dell.id }), 201);
  expect(expectOk(await a().get(`${API}/contracts?vendorCompanyId=${dell.id}`)).contracts).toHaveLength(1);
});
```

Check the materials create response key before relying on it: `grep -n "res.status(201).json" backend/src/controllers/projectsController.js` near `createMaterial`. If it isn't `material`, change the test to match.

- [ ] **Step 2: Run them and watch them fail**

Run: `cd backend && npm test -- companies.vendors.test.js`
Expected: FAIL. `/companies/vendors` is caught by `GET /companies/:id`, and no vendor field is read.

- [ ] **Step 3: Vendor helpers in `companyService.js`**

Add above `module.exports`, and export the three names:

```js
// A vendor-only company (not a client, not internal) is shared reference
// data: every vendor picker offers it, whatever the user's company access
// (plan 2b decision). A company that is also a client — or the internal
// company — is fenced like any client, so a picker can't reveal its name.
const isSharedVendor = (company) => !!(company.isVendor && !company.isClient && !company.isInternal);

// A record's vendor: an active vendor company the user may pick. Missing,
// not a vendor, inactive and out of reach all get the same 400.
async function resolveVendorCompany(user, rawVendorId) {
  const { canAccessCompany, parseRecordId } = require('./permissionService'); // eslint-disable-line global-require
  const { ApiError } = require('../middleware/error'); // eslint-disable-line global-require
  const company = await Company.findByPk(parseRecordId(rawVendorId) || 0);
  const usable = company && company.status === 'active' && company.isVendor
    && (isSharedVendor(company) || (await canAccessCompany(user, company.id)));
  if (!usable) throw new ApiError(400, 'Unknown vendor', 'VALIDATION_ERROR');
  return company;
}

// The vendor fields a body sets on an asset, license, contract or project
// material. `textColumn` is the old free-text vendor column, which mirrors
// the company's name for one more release (spec: Vendor text), so reports
// and alert tickets that still read it stay right. Re-sending the current
// vendor isn't re-checked: forms send the whole record back, and the vendor
// may have been deactivated since.
async function resolveVendorFields(user, body, record, textColumn) {
  if (body.vendorCompanyId === undefined) return {};
  if (isBlank(body.vendorCompanyId)) return { vendorCompanyId: null };
  const { parseRecordId } = require('./permissionService'); // eslint-disable-line global-require
  if (record && parseRecordId(body.vendorCompanyId) === record.vendorCompanyId) return {};
  const vendor = await resolveVendorCompany(user, body.vendorCompanyId);
  return { vendorCompanyId: vendor.id, [textColumn]: vendor.name };
}
```

- [ ] **Step 4: The vendor picker endpoint**

In `companiesController.js`, add the import `const { andWhere, isEmpty } = require('../services/recordScope');` and this handler, then export `vendors`:

```js
// GET /companies/vendors?search= — the vendor picker: shared vendor-only
// companies, plus vendor companies the user can reach (see isSharedVendor).
const vendors = asyncHandler(async (req, res) => {
  const scope = await companyScopeWhere(req.user, 'id');
  const and = [{ isVendor: true, status: 'active' }];
  if (!isEmpty(scope)) and.push({ [Op.or]: [{ isClient: false, isInternal: false }, scope] });
  const term = String(req.query.search || '').trim();
  if (term) and.push({ name: { [Op.like]: `%${term}%` } });
  const rows = await Company.findAll({
    where: andWhere(...and), attributes: ['id', 'name'], order: [['name', 'ASC']], limit: 25,
  });
  res.json({ vendors: rows });
});
```

In `routes/companies.js`, directly after the `/summary` route:

```js
// Before '/:id'. Anyone who records purchases can pick a vendor.
router.get('/vendors', requirePermission('assets.view', 'projects.manage_expenses', 'companies.view'), ctrl.vendors);
```

- [ ] **Step 5: Read vendor fields in the four controllers**

- **`assetsController.js`:**
  - Import `resolveVendorFields` alongside `resolvePlacement`.
  - Add `{ model: Company, as: 'vendorCompany', attributes: ['id', 'name'] }` to `assetInclude`.
  - In `create`, after the `resolvePlacement` line: `Object.assign(values, await resolveVendorFields(req.user, body, null, 'vendorName'));`.
  - In `update`, after its `resolvePlacement` line: `Object.assign(changes, await resolveVendorFields(req.user, body, asset, 'vendorName'));`.
  - In `list`, next to `companyFilter`: `const vendorFilter = req.query.vendorCompanyId ? { vendorCompanyId: parseRecordId(req.query.vendorCompanyId) || -1 } : {};`, and add `vendorFilter` to the `andWhere(...)` call.
- **`licensesController.js`:**
  - Same import.
  - `{ model: Company, as: 'vendorCompany', attributes: ['id', 'name'] }` in `licenseInclude`.
  - In `create`, after `resolvePlacement`: `Object.assign(values, await resolveVendorFields(req.user, req.body, null, 'vendor'));`.
  - In `update`, `...(req.user, req.body, license, 'vendor')`.
  - The same `vendorFilter` in `list`.
- **`contractsController.js`:**
  - Same import, include and list filter.
  - In `create`, replace the line `if (!req.body.vendor || !req.body.vendor.trim()) throw new ApiError(400, 'Vendor is required', 'VALIDATION_ERROR');` with:

    ```js
      // A contract needs a vendor: a vendor company, or (until the text column
      // goes) a typed name.
      const vendorFields = await resolveVendorFields(req.user, req.body, null, 'vendor');
      if (!vendorFields.vendorCompanyId && (!req.body.vendor || !req.body.vendor.trim())) {
        throw new ApiError(400, 'Vendor is required', 'VALIDATION_ERROR');
      }
    ```

    and after the `resolvePlacement` line add `Object.assign(values, vendorFields);`.
  - In `update`, after `resolvePlacement`: `Object.assign(values, await resolveVendorFields(req.user, req.body, contract, 'vendor'));`.
- **`projectsController.js` (materials):**
  - Import `resolveVendorFields`.
  - Add `{ model: Company, as: 'vendorCompany', attributes: ['id', 'name'] }` to `materialInclude`, adding `Company` to the models import if it's missing.
  - In `createMaterial`, spread `...(await resolveVendorFields(req.user, req.body, null, 'vendor'))` as the last property of the object passed to `ProjectMaterial.create`.
  - In `updateMaterial`, after the `allowed` loop builds its changes: `Object.assign(<changes object>, await resolveVendorFields(req.user, req.body, material, 'vendor'));`. Use the handler's own variable names for the changes object and the loaded material.

- [ ] **Step 6: Run them and watch them pass, then the neighbours**

Run: `cd backend && npm test -- companies.vendors.test.js companies.assets.test.js projects.extras.test.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/src backend/test/integration/companies.vendors.test.js
git commit -m "feat(companies): vendor companies on assets, licenses, contracts and materials; shared vendor picker"
```

---

### Task 4: Company list counts, scoped summary, client-flag guard, conflict pins

**Files:**
- Modify: `backend/src/controllers/companiesController.js`
- Test: `backend/test/integration/companies.manage.test.js`

**Interfaces:**
- Consumes: `getTicketStatusBuckets` (`services/statusBehavior`); `companyScopeWhere`.
- Produces:
  - `GET /companies` rows gain `contactCount` and `openTicketCount`.
  - `GET /companies/summary` `count` counts only reachable companies. `multiCompany` stays global: it switches UI on for everyone, and reveals only that some client exists.
  - `PATCH /companies/:id { isClient: false }` → 409 `COMPANY_IN_USE` while the company owns records.

- [ ] **Step 1: Write the failing tests**

```js
const { resetData, closeDb, models } = require('./helpers');
const {
  API, expectOk, makeWorld, makeTech, makeTicket, makeCompany, setCompanyAccess,
} = require('./fixtures');

// Plan 2b task 4.

const { Company, Contact } = models;

let w;
let acme;
let internalId;
const a = () => w.admin.agent;
beforeEach(async () => {
  await resetData();
  w = await makeWorld();
  internalId = (await Company.findOne({ where: { isInternal: true } })).id;
  acme = await makeCompany(w.admin, { name: 'Acme' });
});
afterAll(closeDb);

it('the company list counts contacts and open tickets', async () => {
  const ann = await Contact.create({ firstName: 'Ann', displayName: 'Ann', companyId: acme.id });
  await makeTicket(a(), { title: 'open', contactId: ann.id });
  const closed = await makeTicket(a(), { title: 'done', contactId: ann.id });
  expectOk(await a().patch(`${API}/tickets/${closed.id}`).send({ status: 'Closed' }));
  const row = expectOk(await a().get(`${API}/companies`)).companies.find((c) => c.id === acme.id);
  expect([row.contactCount, row.openTicketCount]).toEqual([1, 1]);
});

it('the summary counts only companies the user can reach', async () => {
  const fenced = await makeTech('fenced', w.deptA.id);
  await setCompanyAccess(w.admin, fenced.user.id, { allCompanies: false, companyIds: [internalId] });
  expect(expectOk(await a().get(`${API}/companies/summary`))).toEqual({ count: 2, multiCompany: true });
  expect(expectOk(await fenced.agent.get(`${API}/companies/summary`))).toEqual({ count: 1, multiCompany: true });
});

it('a company can\'t stop being a client while it owns records', async () => {
  await Contact.create({ firstName: 'Ann', displayName: 'Ann', companyId: acme.id });
  const res = await a().patch(`${API}/companies/${acme.id}`).send({ isClient: false, isVendor: true });
  expect([res.status, res.body.code]).toEqual([409, 'COMPANY_IN_USE']);
  const empty = await makeCompany(w.admin, { name: 'Empty' });
  expect(expectOk(await a().patch(`${API}/companies/${empty.id}`).send({ isClient: false, isVendor: true })).company.isClient).toBe(false);
});

// Pins (expected to pass already): a conflict over a record you can't see
// gets exactly the answer a visible one does — no names, no ids.
it('[pin] conflicts don\'t describe records in companies you can\'t reach', async () => {
  const fenced = await makeTech('fenced2', w.deptA.id);
  await setCompanyAccess(w.admin, fenced.user.id, { allCompanies: false, companyIds: [internalId] });
  expectOk(await a().post(`${API}/users/${fenced.user.id}/overrides`).send({ permissionKey: 'people.view_all', granted: true }), 201);
  await Contact.create({ firstName: 'Hidden', displayName: 'Hidden', email: 'hidden@acme.test', companyId: acme.id });
  const hidden = await fenced.agent.post(`${API}/contacts`).send({ firstName: 'X', email: 'hidden@acme.test', companyId: internalId });
  const visible = await a().post(`${API}/contacts`).send({ firstName: 'Y', email: 'hidden@acme.test', companyId: internalId });
  expect(hidden.body).toEqual(visible.body);
  expect(hidden.body).toEqual({ error: true, message: 'A contact with this email already exists', code: 'EMAIL_TAKEN' });
});
```

- [ ] **Step 2: Run them and watch the first three fail**

Run: `cd backend && npm test -- companies.manage.test.js`
Expected: 3 FAIL and the `[pin]` PASS. A pin documents behaviour that's already right, so it can't fail first. Ledger it as such.

- [ ] **Step 3: Implement**

In `companiesController.js`, import `const { getTicketStatusBuckets } = require('../services/statusBehavior');`.

Replace the `res.json(paginated(...))` line of `list` with:

```js
  // Per-row counts for the list (two grouped queries, not one per row).
  const ids = rows.map((c) => c.id);
  const buckets = await getTicketStatusBuckets();
  const countBy = async (Model, extra = {}) => {
    if (!ids.length) return new Map();
    const counted = await Model.findAll({
      where: { companyId: ids, ...extra },
      attributes: ['companyId', [fn('COUNT', col('id')), 'n']],
      group: ['companyId'],
      raw: true,
    });
    return new Map(counted.map((r) => [r.companyId, Number(r.n)]));
  };
  const [contacts, openTickets] = await Promise.all([
    countBy(Contact), countBy(Ticket, { status: { [Op.in]: buckets.open } }),
  ]);
  const withCounts = rows.map((c) => ({
    ...c.toJSON(), contactCount: contacts.get(c.id) || 0, openTicketCount: openTickets.get(c.id) || 0,
  }));
  res.json(paginated('companies', { rows: withCounts, count }, { page, limit }));
```

In `summary`, change `Company.count()` to `Company.count({ where: await companyScopeWhere(req.user, 'id') })`. Update its comment: the count covers reachable companies only, and `multiCompany` stays global.

In `update`, after `const changes = await readFields(...)`:

```js
  // A company that owns contacts, tickets or other records must stay a
  // client: those records may only sit in a client (or the internal)
  // company, and clearing the flag could also switch company UI off.
  if (changes.isClient === false && company.isClient) {
    const byCompany = { where: { companyId: company.id } };
    const counts = await Promise.all(
      [Contact, Ticket, Project, Department, Site, Asset, License, Contract].map((M) => M.count(byCompany))
    );
    if (counts.some((n) => n > 0)) {
      throw new ApiError(409, 'This company still has client records. Merge it or move them before it stops being a client.', 'COMPANY_IN_USE');
    }
  }
```

- [ ] **Step 4: Run them and watch them pass**

Run: `cd backend && npm test -- companies.manage.test.js companies.api.test.js`
Expected: PASS. If `companies.api.test.js` asserts the old summary `count` for a fenced user, that change is intended: update the assertion and ledger it as a ruling.

- [ ] **Step 5: Commit**

```bash
git add backend/src/controllers/companiesController.js backend/test/integration/companies.manage.test.js
git commit -m "feat(companies): list counts, reachable summary count, client flag stays while in use"
```

---
### Task 5: Merge (B into A)

**Files:**
- Create: `backend/src/services/companyMerge.js`
- Modify: `backend/src/controllers/companiesController.js` (`merge`), `backend/src/routes/companies.js`
- Test: `backend/test/integration/companies.merge.test.js`

**Interfaces:**
- Consumes: `loadAccessibleCompany(req)` (companiesController), `canAccessCompany`, `invalidateAllPermissions`, `writeAudit`.
- Produces:
  - `POST /companies/:id/merge { intoCompanyId }` → `{ company, counts }`. `:id` is B (merged away) and `intoCompanyId` is A.
  - With `?preview=true` → `{ preview: true, counts }`, and nothing changes.
  - `counts` keys: `contacts, departments, sites, tickets, projects, assets, licenses, contracts, vendorAssets, vendorLicenses, vendorContracts, vendorMaterials, domains, userAccess, roleAccess`.
  - `mergeCounts(fromId, transaction?)` and `mergeCompanies(from, into, transaction)` in `services/companyMerge.js`.

**Rules (spec, *Merge*):**
- One transaction moves every `companyId` and `vendorCompanyId` that references B over to A, along with the access grants (duplicates dropped) and the domains.
- A's flags become the union of both companies'.
- B is deleted.
- Same-named departments and sites are kept side by side. Their names are unique per company, so B's clashing ones take a ` (B's name)` suffix.
- The internal company may be A but never B.
- Requires `companies.manage` and access to both companies.
- The audit row records the per-table counts.

- [ ] **Step 1: Write the failing tests**

```js
const { resetData, closeDb, models } = require('./helpers');
const {
  API, expectOk, makeWorld, makeTech, makeTicket, makeCompany, setCompanyAccess,
} = require('./fixtures');

// Plan 2b task 5: merging company B into company A.

const {
  Company, CompanyDomain, Contact, Department, Site, Ticket, Asset, AssetCategory, UserCompanyAccess,
  RoleCompanyAccess, Role, AuditLog,
} = models;

let w;
let acme;
let globex;
let internalId;
const a = () => w.admin.agent;
const expectErr = (res, status, code, message) => {
  expect({ status: res.status, body: res.body }).toEqual({ status, body: { error: true, message, code } });
};
const merge = (from, into, agent = a(), preview = false) => agent
  .post(`${API}/companies/${from.id}/merge${preview ? '?preview=true' : ''}`).send({ intoCompanyId: into.id });

let category;
beforeEach(async () => {
  await resetData();
  await AssetCategory.destroy({ where: { name: 'Laptops' } });
  w = await makeWorld();
  internalId = (await Company.findOne({ where: { isInternal: true } })).id;
  acme = await makeCompany(w.admin, { name: 'Acme' });
  globex = await makeCompany(w.admin, { name: 'Globex', isVendor: true });
  category = await AssetCategory.create({ name: 'Laptops' });
});
afterAll(async () => {
  await AssetCategory.destroy({ where: { name: 'Laptops' } });
  await closeDb();
});

// Globex owns one of everything; returns the ids.
async function stockGlobex() {
  const dept = await Department.create({ name: 'Ops', companyId: globex.id });
  const site = await Site.create({ name: 'Plant', companyId: globex.id });
  const gus = await Contact.create({ firstName: 'Gus', displayName: 'Gus', companyId: globex.id, departmentId: dept.id, siteId: site.id });
  const ticket = await makeTicket(a(), { title: 'Globex ticket', contactId: gus.id });
  const asset = await Asset.create({ assetTag: 'G-1', name: 'g', categoryId: category.id, companyId: globex.id, vendorCompanyId: globex.id });
  await CompanyDomain.create({ companyId: globex.id, domain: 'globex.test' });
  return { dept, site, gus, ticket, asset };
}

it('preview counts what would move and changes nothing', async () => {
  await stockGlobex();
  const { preview, counts } = expectOk(await merge(globex, acme, a(), true));
  expect(preview).toBe(true);
  expect(counts).toEqual(expect.objectContaining({
    contacts: 1, departments: 1, sites: 1, tickets: 1, assets: 1, vendorAssets: 1, domains: 1,
  }));
  expect(await Company.findByPk(globex.id)).not.toBeNull();
});

it('moves every reference to A, unions the flags, and deletes B', async () => {
  const { gus, ticket, asset } = await stockGlobex();
  const { company, counts } = expectOk(await merge(globex, acme));
  expect([company.id, company.isClient, company.isVendor]).toEqual([acme.id, true, true]);
  expect(counts.tickets).toBe(1);
  expect(await Company.findByPk(globex.id)).toBeNull();
  expect((await Contact.findByPk(gus.id)).companyId).toBe(acme.id);
  expect((await Ticket.findByPk(ticket.id)).companyId).toBe(acme.id);
  const movedAsset = await Asset.findByPk(asset.id);
  expect([movedAsset.companyId, movedAsset.vendorCompanyId]).toEqual([acme.id, acme.id]);
  expect((await CompanyDomain.findOne({ where: { domain: 'globex.test' } })).companyId).toBe(acme.id);
  // Nothing anywhere still points at B.
  for (const table of ['Contacts', 'Departments', 'Sites', 'Tickets', 'Projects', 'Assets', 'Licenses', 'Contracts', 'CompanyDomains', 'UserCompanyAccess', 'RoleCompanyAccess']) {
    // eslint-disable-next-line no-await-in-loop
    const [[{ n }]] = await models.sequelize.query(`SELECT COUNT(*) AS n FROM \`${table}\` WHERE companyId = ${globex.id}`);
    expect([table, Number(n)]).toEqual([table, 0]);
  }
  for (const table of ['Assets', 'Licenses', 'Contracts', 'ProjectMaterials']) {
    // eslint-disable-next-line no-await-in-loop
    const [[{ n }]] = await models.sequelize.query(`SELECT COUNT(*) AS n FROM \`${table}\` WHERE vendorCompanyId = ${globex.id}`);
    expect([table, Number(n)]).toEqual([table, 0]);
  }
});

it('keeps same-named departments and sites side by side', async () => {
  await Department.create({ name: 'Ops', companyId: acme.id });
  await Site.create({ name: 'Plant', companyId: acme.id });
  await stockGlobex();
  expectOk(await merge(globex, acme));
  const depts = (await Department.findAll({ where: { companyId: acme.id }, order: [['name', 'ASC']] })).map((d) => d.name);
  expect(depts).toEqual(['Ops', 'Ops (Globex)']);
  const sites = (await Site.findAll({ where: { companyId: acme.id }, order: [['name', 'ASC']] })).map((s) => s.name);
  expect(sites).toEqual(['Plant', 'Plant (Globex)']);
});

it('moves access grants, dropping duplicates', async () => {
  const both = await makeTech('both', w.deptA.id);
  const onlyB = await makeTech('onlyb', w.deptA.id);
  await setCompanyAccess(w.admin, both.user.id, { allCompanies: false, companyIds: [acme.id, globex.id] });
  await setCompanyAccess(w.admin, onlyB.user.id, { allCompanies: false, companyIds: [globex.id] });
  const role = await Role.findOne({ where: { name: 'Department Staff' } });
  await RoleCompanyAccess.bulkCreate([{ roleId: role.id, companyId: acme.id }, { roleId: role.id, companyId: globex.id }]);
  expectOk(await merge(globex, acme));
  const grants = async (userId) => (await UserCompanyAccess.findAll({ where: { userId } })).map((r) => r.companyId);
  expect(await grants(both.user.id)).toEqual([acme.id]);
  expect(await grants(onlyB.user.id)).toEqual([acme.id]);
  expect((await RoleCompanyAccess.findAll({ where: { roleId: role.id } })).map((r) => r.companyId)).toEqual([acme.id]);
  // The permission cache was invalidated: onlyB now reaches A's records.
  expect(expectOk(await onlyB.agent.get(`${API}/companies/${acme.id}`)).company.id).toBe(acme.id);
});

it('refuses impossible merges with one answer per kind', async () => {
  const internal = await Company.findByPk(internalId);
  expectErr(await merge(internal, acme), 400, 'VALIDATION_ERROR', 'The internal company cannot be merged into another');
  expectErr(await merge(acme, acme), 400, 'VALIDATION_ERROR', 'A company cannot be merged into itself');
  expectErr(await a().post(`${API}/companies/${globex.id}/merge`).send({ intoCompanyId: 99999 }), 400, 'VALIDATION_ERROR', 'Unknown company');
  await acme.update({ status: 'inactive' });
  expectErr(await merge(globex, acme), 400, 'VALIDATION_ERROR', 'Merge into an active company');
});

it('needs companies.manage and access to both companies', async () => {
  const tech = await makeTech('tech', w.deptA.id);
  expect((await merge(globex, acme, tech.agent)).status).toBe(403);
  expectOk(await a().post(`${API}/users/${tech.user.id}/overrides`).send({ permissionKey: 'companies.manage', granted: true }), 201);
  await setCompanyAccess(w.admin, tech.user.id, { allCompanies: false, companyIds: [globex.id] });
  // Can reach B but not A: A answers like a missing company.
  expectErr(await merge(globex, acme, tech.agent), 400, 'VALIDATION_ERROR', 'Unknown company');
});

it('writes an audit row with the counts', async () => {
  await stockGlobex();
  expectOk(await merge(globex, acme));
  const row = await AuditLog.findOne({ where: { action: 'company.merge' } });
  expect(row.entityId).toBe(acme.id);
  const meta = typeof row.meta === 'string' ? JSON.parse(row.meta) : row.meta;
  expect(meta).toEqual(expect.objectContaining({ fromCompanyId: globex.id, fromName: 'Globex' }));
  expect(meta.counts.contacts).toBe(1);
});
```

The column names on `AuditLog` (`entityId`, `meta`) are what `writeAudit` writes. Confirm with `grep -n "entityId\|meta" backend/src/middleware/audit.js`, and use those names.

- [ ] **Step 2: Run them and watch them fail**

Run: `cd backend && npm test -- companies.merge.test.js`
Expected: FAIL, 404 on `POST /companies/:id/merge`.

- [ ] **Step 3: Write `services/companyMerge.js`**

```js
// Merging company B ("from") into company A ("into"): every reference to B
// moves to A in one transaction, then B is deleted (spec: Merge). Static
// updates skip model hooks on purpose: a ticket's contact moves with it, so
// the "ticket company follows its contact" hook has nothing to do.
const { Op } = require('sequelize');
const {
  CompanyDomain, Site, Department, Contact, Ticket, Project, Asset, License, Contract,
  ProjectMaterial, UserCompanyAccess, RoleCompanyAccess,
} = require('../models');

const OWNED = {
  contacts: Contact, departments: Department, sites: Site, tickets: Ticket,
  projects: Project, assets: Asset, licenses: License, contracts: Contract,
};
const SUPPLIED = {
  vendorAssets: Asset, vendorLicenses: License, vendorContracts: Contract, vendorMaterials: ProjectMaterial,
};

async function mergeCounts(fromId, transaction) {
  const counts = {};
  for (const [key, Model] of Object.entries(OWNED)) {
    counts[key] = await Model.count({ where: { companyId: fromId }, transaction }); // eslint-disable-line no-await-in-loop
  }
  for (const [key, Model] of Object.entries(SUPPLIED)) {
    counts[key] = await Model.count({ where: { vendorCompanyId: fromId }, transaction }); // eslint-disable-line no-await-in-loop
  }
  counts.domains = await CompanyDomain.count({ where: { companyId: fromId }, transaction });
  counts.userAccess = await UserCompanyAccess.count({ where: { companyId: fromId }, transaction });
  counts.roleAccess = await RoleCompanyAccess.count({ where: { companyId: fromId }, transaction });
  return counts;
}

// Same-named departments and sites are kept side by side (spec), but names
// are unique per company, so B's clashing rows take a " (B)" suffix.
async function renameClashes(Model, from, into, maxLength, transaction) {
  const taken = new Set((await Model.findAll({ where: { companyId: into.id }, attributes: ['name'], transaction }))
    .map((r) => r.name.toLowerCase()));
  const label = from.name.slice(0, 40);
  const ours = await Model.findAll({ where: { companyId: from.id }, transaction });
  for (const row of ours) {
    if (!taken.has(row.name.toLowerCase())) continue; // eslint-disable-line no-continue
    let name;
    for (let n = 1; !name || taken.has(name.toLowerCase()); n += 1) {
      const suffix = n === 1 ? ` (${label})` : ` (${label} ${n})`;
      name = `${row.name.slice(0, maxLength - suffix.length)}${suffix}`;
    }
    taken.add(name.toLowerCase());
    await row.update({ name }, { transaction, hooks: false }); // eslint-disable-line no-await-in-loop
  }
}

// A user or role granted both companies keeps one grant to A.
async function moveGrants(Model, key, fromId, intoId, transaction) {
  const holders = (await Model.findAll({ where: { companyId: intoId }, attributes: [key], transaction })).map((r) => r[key]);
  if (holders.length) await Model.destroy({ where: { companyId: fromId, [key]: { [Op.in]: holders } }, transaction });
  await Model.update({ companyId: intoId }, { where: { companyId: fromId }, transaction });
}

async function mergeCompanies(from, into, transaction) {
  await renameClashes(Department, from, into, 255, transaction);
  await renameClashes(Site, from, into, 150, transaction);
  for (const Model of Object.values(OWNED)) {
    // eslint-disable-next-line no-await-in-loop
    await Model.update({ companyId: into.id }, { where: { companyId: from.id }, transaction, hooks: false });
  }
  for (const Model of new Set(Object.values(SUPPLIED))) {
    // eslint-disable-next-line no-await-in-loop
    await Model.update({ vendorCompanyId: into.id }, { where: { vendorCompanyId: from.id }, transaction, hooks: false });
  }
  await moveGrants(UserCompanyAccess, 'userId', from.id, into.id, transaction);
  await moveGrants(RoleCompanyAccess, 'roleId', from.id, into.id, transaction);
  await CompanyDomain.update({ companyId: into.id }, { where: { companyId: from.id }, transaction });
  await into.update({ isClient: into.isClient || from.isClient, isVendor: into.isVendor || from.isVendor }, { transaction });
  await from.destroy({ transaction });
}

module.exports = { mergeCounts, mergeCompanies };
```

- [ ] **Step 4: The endpoint**

In `companiesController.js`, import `const { mergeCounts, mergeCompanies } = require('../services/companyMerge');` and add, then export `merge`:

```js
// POST /companies/:id/merge { intoCompanyId } — merge :id (B) into A.
// ?preview=true returns the per-table counts and changes nothing.
const merge = asyncHandler(async (req, res) => {
  const from = await loadAccessibleCompany(req);
  if (from.isInternal) throw new ApiError(400, 'The internal company cannot be merged into another', 'VALIDATION_ERROR');
  const into = await Company.findByPk(parseRecordId((req.body || {}).intoCompanyId) || 0);
  // Missing and out-of-reach targets look the same.
  if (!into || !(await canAccessCompany(req.user, into.id))) throw new ApiError(400, 'Unknown company', 'VALIDATION_ERROR');
  if (into.id === from.id) throw new ApiError(400, 'A company cannot be merged into itself', 'VALIDATION_ERROR');
  if (into.status !== 'active') throw new ApiError(400, 'Merge into an active company', 'VALIDATION_ERROR');

  if (req.query.preview === 'true') {
    res.json({ preview: true, counts: await mergeCounts(from.id) });
    return;
  }
  const counts = await sequelize.transaction(async (transaction) => {
    const moved = await mergeCounts(from.id, transaction);
    await mergeCompanies(from, into, transaction);
    return moved;
  });
  invalidateAllPermissions();
  await writeAudit(req, 'company.merge', 'Company', into.id, { fromCompanyId: from.id, fromName: from.name, counts });
  res.json({ company: await Company.findByPk(into.id, { include: companyInclude }), counts });
});
```

The order of checks matters for the "itself" case. `merge(acme, acme)` passes the reach check first, so it must reach the `into.id === from.id` line. Keep the order above.

In `routes/companies.js`: `router.post('/:id/merge', canManage, ctrl.merge);`

- [ ] **Step 5: Run them and watch them pass**

Run: `cd backend && npm test -- companies.merge.test.js companies.api.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/companyMerge.js backend/src/controllers/companiesController.js backend/src/routes/companies.js backend/test/integration/companies.merge.test.js
git commit -m "feat(companies): merge one company into another, with a preview"
```

---

### Task 6: CSV import — the Company column

**Spec, *Arriving contacts*:**
- The CSV import gains an optional "Company" column, matched against active company names: exact, ignoring case.
- A blank cell means the internal company.
- A non-blank name that matches nothing is flagged in the preview, and those rows aren't imported until it's fixed.

Contacts belong to a client or the internal company, so vendor-only companies don't match. A company the importer can't reach also counts as "doesn't match".

**Files:**
- Modify: `backend/src/controllers/contactImportController.js`
- Test: `backend/test/integration/companies.import.test.js`

**Interfaces:**
- Consumes: `companyScopeWhere` (permissionService), `andWhere` (recordScope), `getInternalCompanyId` (companyService).
- Produces: mapping field `company`. Preview rows whose company doesn't match get `action: 'error'` with the issue message `"<name>" does not match any company`. If the importer can't reach the internal company, a blank cell's message is `Choose a company for this contact`. Department names match within the row's company.

- [ ] **Step 1: Write the failing tests**

```js
const { resetData, closeDb, models } = require('./helpers');
const {
  API, expectOk, makeWorld, makeTech, makeCompany, setCompanyAccess,
} = require('./fixtures');

// Plan 2b task 6: the CSV import's Company column.

const { Company, Contact, Department } = models;

let w;
let acme;
let internalId;
const a = () => w.admin.agent;
const mapping = { First: 'firstName', Email: 'email', Company: 'company', Dept: 'department' };
const row = (first, company = '', dept = '') => ({ First: first, Email: `${first.toLowerCase()}@x.test`, Company: company, Dept: dept });
const check = async (rows, agent = a()) => expectOk(await agent.post(`${API}/contacts/import/validate`).send({ rows, mapping }));
const commit = async (rows, agent = a()) => expectOk(await agent.post(`${API}/contacts/import`).send({ rows, mapping }));

beforeEach(async () => {
  await resetData();
  w = await makeWorld();
  internalId = (await Company.findOne({ where: { isInternal: true } })).id;
  acme = await makeCompany(w.admin, { name: 'Acme' });
  await Department.create({ name: 'HR', companyId: acme.id });
});
afterAll(closeDb);

it('files a row under the named company (ignoring case), with that company\'s department', async () => {
  const result = await commit([row('Ann', 'acme', 'hr')]);
  expect(result.created).toBe(1);
  const ann = await Contact.findOne({ where: { email: 'ann@x.test' }, include: [{ model: Department, as: 'department' }] });
  expect([ann.companyId, ann.department.name]).toEqual([acme.id, 'HR']);
});

it('a blank Company cell means the internal company', async () => {
  await commit([row('Bob')]);
  expect((await Contact.findOne({ where: { email: 'bob@x.test' } })).companyId).toBe(internalId);
});

it('an unknown company is flagged in the preview and not imported', async () => {
  const preview = await check([row('Cat', 'Nope Inc'), row('Dan', 'Acme')]);
  expect(preview.rows[0]).toEqual(expect.objectContaining({ action: 'error' }));
  expect(preview.rows[0].issues).toContainEqual({ type: 'error', message: '"Nope Inc" does not match any company' });
  expect(preview.summary.errors).toBe(1);
  const result = await commit([row('Cat', 'Nope Inc'), row('Dan', 'Acme')]);
  expect([result.created, result.failed]).toEqual([1, 1]);
});

it('a vendor-only company, or one the importer can\'t reach, doesn\'t match', async () => {
  await Company.create({ name: 'Dell', isVendor: true });
  const globex = await makeCompany(w.admin, { name: 'Globex' });
  const t = await makeTech('importer', w.deptA.id);
  await setCompanyAccess(w.admin, t.user.id, { allCompanies: false, companyIds: [internalId, acme.id] });
  expectOk(await a().post(`${API}/users/${t.user.id}/overrides`).send({ permissionKey: 'people.view_all', granted: true }), 201);
  const preview = await check([row('Eve', 'Dell'), row('Fay', 'Globex')], t.agent);
  expect(preview.rows.map((r) => r.action)).toEqual(['error', 'error']);
  expect(preview.rows[1].issues).toContainEqual({ type: 'error', message: `"${globex.name}" does not match any company` });
});

it('an importer who can\'t reach the internal company must name one', async () => {
  const t = await makeTech('acmeonly', w.deptA.id);
  await setCompanyAccess(w.admin, t.user.id, { allCompanies: false, companyIds: [acme.id] });
  expectOk(await a().post(`${API}/users/${t.user.id}/overrides`).send({ permissionKey: 'people.view_all', granted: true }), 201);
  const preview = await check([row('Gil'), row('Hal', 'Acme')], t.agent);
  expect(preview.rows[0].issues).toContainEqual({ type: 'error', message: 'Choose a company for this contact' });
  expect(preview.rows[1].action).toBe('create');
});
```

The route uses `editMin`, which fenced techs hold. If the import route refuses them, check `grep -n "editMin" backend/src/routes/contacts.js` and grant that permission in the test instead.

- [ ] **Step 2: Run them and watch them fail**

Run: `cd backend && npm test -- companies.import.test.js`
Expected: FAIL. Every row lands in the internal company, and no company issues appear.

- [ ] **Step 3: Implement**

In `contactImportController.js`:
- Change the imports to `const { Contact, Department, Company } = require('../models');`.
- Add `const { companyScopeWhere } = require('../services/permissionService');`, `const { andWhere } = require('../services/recordScope');` and `getInternalCompanyId` from `companyService`.
- Remove the `resolveRecordCompany` import, which plan 2a's R5 fix added.

Replace `buildLookups`:

```js
// Contacts can go in any active client company the importer can reach, or
// the internal company (blank Company cell). Department names match within
// the row's company only.
async function buildLookups(user) {
  const internalId = await getInternalCompanyId();
  const [contacts, companies] = await Promise.all([
    Contact.findAll({ attributes: ['id', 'email'], where: { email: { [Op.ne]: null } }, raw: true }),
    Company.findAll({
      where: andWhere(
        { status: 'active', [Op.or]: [{ isClient: true }, { isInternal: true }] },
        await companyScopeWhere(user, 'id')
      ),
      attributes: ['id', 'name'],
      raw: true,
    }),
  ]);
  const companyIds = companies.map((c) => c.id);
  const departments = companyIds.length
    ? await Department.findAll({ where: { companyId: companyIds }, attributes: ['id', 'name', 'companyId'], raw: true })
    : [];
  return {
    emailToId: new Map(contacts.map((c) => [c.email.toLowerCase(), c.id])),
    companyByName: new Map(companies.map((c) => [c.name.toLowerCase(), c.id])),
    defaultCompanyId: companyIds.includes(internalId) ? internalId : null,
    deptByKey: new Map(departments.map((d) => [`${d.companyId}:${d.name.toLowerCase()}`, d.id])),
  };
}
const deptKey = (companyId, name) => `${companyId}:${name.toLowerCase()}`;
```

In `validateRows`, replace the department check block (`if (record.department && !lookups.deptNameToId.has(...))`) with:

```js
      if (record.department && record.companyId && !lookups.deptByKey.has(deptKey(record.companyId, record.department))) {
        issues.push({ type: 'warning', message: `"${record.department}" does not match any existing department` });
      }
```

and insert this just before that block, inside the same `else`:

```js
      // The company is checked last and wins over a duplicate-email skip: a
      // row that can't be placed is an error to fix, not a row to skip.
      const companyName = (record.company || '').trim();
      record.companyId = companyName
        ? lookups.companyByName.get(companyName.toLowerCase()) || null
        : lookups.defaultCompanyId;
      if (!record.companyId) {
        issues.push({ type: 'error', message: companyName ? `"${companyName}" does not match any company` : 'Choose a company for this contact' });
        action = 'error';
      }
```

In `commit`:
- Replace the `deptId` line with `const deptId = rec.department ? lookups.deptByKey.get(deptKey(rec.companyId, rec.department)) || null : null;`.
- Add `companyId: rec.companyId,` to the `Contact.create` object.
- Both handlers already call `buildLookups(req.user)`.

- [ ] **Step 4: Run them and watch them pass, then the neighbours**

Run: `cd backend && npm test -- companies.import.test.js companies.review.test.js`
Expected: PASS. The R5 test ("CSV import matches department names in the internal company only") still holds: Acme's "HR" doesn't match a blank-company row.

- [ ] **Step 5: Commit**

```bash
git add backend/src/controllers/contactImportController.js backend/test/integration/companies.import.test.js
git commit -m "feat(companies): CSV import Company column; unmatched companies are flagged and skipped"
```

---

### Task 7: Company filter on reports, custom reports and CSAT

**Spec, *Screens*:** "the reports get a Company filter when `multiCompany`." The filter can only narrow the fence. A company the viewer can't reach matches nothing.

**Files:**
- Modify: `backend/src/services/recordScope.js`, `backend/src/controllers/reportsController.js`, `backend/src/services/customReportEngine.js`, `backend/src/controllers/csatController.js`
- Test: `backend/test/integration/companies.reportfilter.test.js`

**Interfaces:**
- Produces: `companyFilterWhere(user, rawCompanyId, column = 'companyId') → Promise<where>`: the viewer's fence, ANDed with `{ [column]: id }` when `rawCompanyId` is non-blank. A junk or unreachable id yields `-1` or an empty AND, never a wider set.
  - Report GETs and CSV exports read `?companyId=`.
  - The custom report engine reads `filters.companyId`.
  - `/csat/stats` and `/csat/responses` read `?companyId=`.

- [ ] **Step 1: Write the failing tests**

```js
const { resetData, closeDb, models } = require('./helpers');
const {
  API, expectOk, makeWorld, makeTech, makeTicket, makeCompany, setCompanyAccess,
} = require('./fixtures');

// Plan 2b task 7: ?companyId= narrows reports to one company.

const { Company, Contact } = models;

let w;
let acme;
let globex;
let internalId;
const a = () => w.admin.agent;
beforeEach(async () => {
  await resetData();
  w = await makeWorld();
  internalId = (await Company.findOne({ where: { isInternal: true } })).id;
  acme = await makeCompany(w.admin, { name: 'Acme' });
  globex = await makeCompany(w.admin, { name: 'Globex' });
  const ann = await Contact.create({ firstName: 'Ann', displayName: 'Ann', companyId: acme.id });
  const gus = await Contact.create({ firstName: 'Gus', displayName: 'Gus', companyId: globex.id });
  await makeTicket(a(), { title: 'ACME-ONE', contactId: ann.id });
  await makeTicket(a(), { title: 'GLOBEX-ONE', contactId: gus.id });
});
afterAll(closeDb);

const titles = (body) => body.tableData.rows.map((r) => r.title).sort();

it('a report narrows to one company', async () => {
  expect(titles(expectOk(await a().get(`${API}/reports/ticket-volume`)))).toEqual(['ACME-ONE', 'GLOBEX-ONE']);
  expect(titles(expectOk(await a().get(`${API}/reports/ticket-volume?companyId=${acme.id}`)))).toEqual(['ACME-ONE']);
  expect(titles(expectOk(await a().get(`${API}/reports/ticket-volume?companyId=abc`)))).toEqual([]);
});

it('a CSV export narrows the same way', async () => {
  const res = await a().get(`${API}/reports/tickets/export?companyId=${globex.id}`);
  expect(res.text).toContain('GLOBEX-ONE');
  expect(res.text).not.toContain('ACME-ONE');
});

it('a custom report narrows by filters.companyId', async () => {
  const body = expectOk(await a().post(`${API}/reports/custom`).send({ dataSource: 'tickets', filters: { companyId: acme.id } }));
  const text = JSON.stringify(body);
  expect(text).toContain('ACME-ONE');
  expect(text).not.toContain('GLOBEX-ONE');
});

it('a company outside the viewer\'s reach narrows to nothing, never widens', async () => {
  const t = await makeTech('fenced', w.deptA.id);
  await setCompanyAccess(w.admin, t.user.id, { allCompanies: false, companyIds: [internalId, acme.id] });
  expectOk(await a().post(`${API}/users/${t.user.id}/overrides`).send({ permissionKey: 'reports.view_all', granted: true }), 201);
  expect(titles(expectOk(await t.agent.get(`${API}/reports/ticket-volume?companyId=${globex.id}`)))).toEqual([]);
  expect(titles(expectOk(await t.agent.get(`${API}/reports/ticket-volume`)))).toEqual(['ACME-ONE']);
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd backend && npm test -- companies.reportfilter.test.js`
Expected: FAIL. `?companyId=` is ignored.

- [ ] **Step 3: Implement**

In `recordScope.js`:
- Import `parseRecordId` alongside `companyScopeWhere`.
- Export `companyFilterWhere`:

```js
// The viewer's company fence, narrowed to one company when a filter names
// one (?companyId= on reports). A filter only ever narrows: a junk id
// matches nothing, and an unreachable company ANDs to nothing.
async function companyFilterWhere(user, rawCompanyId, column = 'companyId') {
  const fence = await companyScopeWhere(user, column);
  if (rawCompanyId === undefined || rawCompanyId === null || rawCompanyId === '') return fence;
  return andWhere(fence, { [column]: parseRecordId(rawCompanyId) || -1 });
}
```

Mechanical replacements:
- **`reportsController.js`:**
  - import `companyFilterWhere` from `../services/recordScope`;
  - replace every `companyScopeWhere(req.user` with `companyFilterWhere(req.user, req.query.companyId` (20 call sites, `sed -i`);
  - drop `companyScopeWhere` from its permissionService import if it's now unused.
- **`customReportEngine.js`:** import `companyFilterWhere`; replace every `companyScopeWhere(req.user` with `companyFilterWhere(req.user, filters.companyId` (6 sites, all inside loaders whose second parameter is `filters`).
- **`csatController.js`:** import `companyFilterWhere`; replace each `await companyScopeWhere(req.user)` with `await companyFilterWhere(req.user, req.query.companyId)`.

Run `grep -n "companyScopeWhere(req.user" backend/src/controllers/reportsController.js backend/src/services/customReportEngine.js backend/src/controllers/csatController.js`. Expected: no output.

- [ ] **Step 4: Run them and watch them pass, then the report suites**

Run: `cd backend && npm test -- companies.reportfilter.test.js companies.reports.test.js readers.reports.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/recordScope.js backend/src/controllers/reportsController.js backend/src/services/customReportEngine.js backend/src/controllers/csatController.js backend/test/integration/companies.reportfilter.test.js
git commit -m "feat(companies): reports, custom reports and CSAT stats filter by company"
```

---

### Task 8: The people on a ticket, and form defaults

**Five rules:**
- **Assignees and watchers:** they must be able to reach the ticket's company (user decision for plan 2b). Out-of-company assignments made before this plan, or before a contact moved, stay.
- **Assignment rules:** a rule that would assign someone who can't reach the company leaves the assignee empty.
- **Pickers:** `GET /users/assignable` and `GET /users/directory` take `?companyId=`.
- **Ticket department:** a new ticket without a department takes its contact's (spec, *New ticket*).
- **"Owned by" departments:** project creators who are fenced to client companies can't list internal departments, so they need the owner list from a dedicated endpoint.

**Files:**
- Create: `backend/src/services/ticketPeople.js`
- Modify: `backend/src/controllers/ticketsController.js`, `backend/src/controllers/usersController.js`, `backend/src/controllers/departmentsController.js`, `backend/src/routes/departments.js`
- Test: `backend/test/integration/companies.ticketpeople.test.js`

**Interfaces:**
- Produces:
  - `canWorkCompany(userId, companyId) → Promise<User|null>` and `assertCanWorkTicket(userId, companyId, label) → Promise<number>`, which throws 400 `<label> can't see tickets for this company`.
  - `GET /users/assignable?companyId=` and `GET /users/directory?companyId=`: only users who can reach that company. A company the caller can't reach → 400 `Unknown company`.
  - `GET /departments/owners` → `{ departments: [{ id, name, shortCode }] }`, the internal departments, for holders of `projects.create`.

- [ ] **Step 1: Write the failing tests**

```js
const { resetData, closeDb, models } = require('./helpers');
const {
  API, expectOk, makeWorld, makeTech, makeStaff, makeTicket, makeCompany, setCompanyAccess,
} = require('./fixtures');

// Plan 2b task 8: who may work a ticket, and server-side form defaults.

const { Company, Contact, Department, AssignmentRule } = models;

let w;
let acme;
let internalId;
let ann;
let hr;
let outsider;
let insider;
const a = () => w.admin.agent;
const expectErr = (res, status, code, message) => {
  expect({ status: res.status, body: res.body }).toEqual({ status, body: { error: true, message, code } });
};
beforeEach(async () => {
  await resetData();
  w = await makeWorld();
  internalId = (await Company.findOne({ where: { isInternal: true } })).id;
  acme = await makeCompany(w.admin, { name: 'Acme' });
  hr = await Department.create({ name: 'HR', companyId: acme.id });
  ann = await Contact.create({ firstName: 'Ann', displayName: 'Ann', companyId: acme.id, departmentId: hr.id });
  outsider = await makeTech('outsider', w.deptA.id);
  await setCompanyAccess(w.admin, outsider.user.id, { allCompanies: false, companyIds: [internalId] });
  insider = await makeTech('insider', w.deptA.id);
});
afterAll(closeDb);

it('a ticket can\'t be assigned to someone who can\'t reach its company', async () => {
  expectErr(
    await a().post(`${API}/tickets`).send({ title: 'x', contactId: ann.id, assigneeId: outsider.user.id }),
    400, 'VALIDATION_ERROR', 'Assignee can\'t see tickets for this company'
  );
  const t = await makeTicket(a(), { title: 'y', contactId: ann.id, assigneeId: insider.user.id });
  expectErr(
    await a().patch(`${API}/tickets/${t.id}`).send({ assigneeId: outsider.user.id }),
    400, 'VALIDATION_ERROR', 'Assignee can\'t see tickets for this company'
  );
});

it('nor watched by them', async () => {
  expectErr(
    await a().post(`${API}/tickets`).send({ title: 'x', contactId: ann.id, watcherIds: [outsider.user.id] }),
    400, 'VALIDATION_ERROR', 'Watcher can\'t see tickets for this company'
  );
  const t = await makeTicket(a(), { title: 'y', contactId: ann.id });
  expectErr(
    await a().post(`${API}/tickets/${t.id}/watchers`).send({ userId: outsider.user.id }),
    400, 'VALIDATION_ERROR', 'Watcher can\'t see tickets for this company'
  );
  expectOk(await a().post(`${API}/tickets/${t.id}/watchers`).send({ userId: insider.user.id }), 201);
});

it('an assignment rule pointing at such a person leaves the ticket unassigned', async () => {
  await AssignmentRule.create({ name: 'all to outsider', position: 0, isActive: true, assigneeId: outsider.user.id });
  const t = await makeTicket(a(), { title: 'z', contactId: ann.id });
  expect(t.assigneeId).toBeNull();
  const home = await makeTicket(a(), { title: 'home', contactId: w.contact.id });
  expect(home.assigneeId).toBe(outsider.user.id);
});

it('the assignee and watcher pickers narrow to one company', async () => {
  const ids = async (path) => expectOk(await a().get(`${API}${path}`)).users.map((u) => u.id);
  expect(await ids(`/users/assignable?companyId=${acme.id}`)).not.toContain(outsider.user.id);
  expect(await ids(`/users/assignable?companyId=${acme.id}`)).toContain(insider.user.id);
  expect(await ids(`/users/directory?companyId=${acme.id}`)).not.toContain(outsider.user.id);
  expect(await ids('/users/assignable')).toContain(outsider.user.id);
});

it('a company the caller can\'t reach is refused as a picker filter', async () => {
  expectErr(await outsider.agent.get(`${API}/users/assignable?companyId=${acme.id}`), 400, 'VALIDATION_ERROR', 'Unknown company');
});

it('a new ticket without a department takes its contact\'s', async () => {
  expect((await makeTicket(a(), { title: 'd', contactId: ann.id })).departmentId).toBe(hr.id);
  const other = await Department.create({ name: 'Ops', companyId: acme.id });
  expect((await makeTicket(a(), { title: 'e', contactId: ann.id, departmentId: other.id })).departmentId).toBe(other.id);
});

it('project creators fenced to a client can list the internal "owned by" departments', async () => {
  const t = await makeTech('acmeonly', w.deptA.id);
  await setCompanyAccess(w.admin, t.user.id, { allCompanies: false, companyIds: [acme.id] });
  const names = expectOk(await t.agent.get(`${API}/departments/owners`)).departments.map((d) => d.name);
  expect(names).toEqual(['Facilities', 'Service Desk']);
  const staff = await makeStaff('staff', w.deptA.id);
  expect((await staff.agent.get(`${API}/departments/owners`)).status).toBe(403);
});
```

Confirm that Department Staff lacks `projects.create` (`grep -n "'Department Staff'" -A6 backend/migrations/20260101000020-roles-permissions-foundation.js`). If it has it, use the `Read Only` role through `makeUser(..., 'Read Only', ...)` instead.

- [ ] **Step 2: Run them and watch them fail**

Run: `cd backend && npm test -- companies.ticketpeople.test.js`
Expected: FAIL. Every assignment is accepted, `?companyId=` is ignored, `departmentId` stays null, and `/departments/owners` is caught by `/:id`.

- [ ] **Step 3: `services/ticketPeople.js`**

```js
// The people working a ticket must be able to open it (plan 2b decision):
// an assignee or watcher who can't reach the ticket's company would get its
// title and comments in notifications. Assignments made before this rule
// (or before a contact moved company) are left as they are.
const { User } = require('../models');
const { ApiError } = require('../middleware/error');
const { canAccessCompany, parseRecordId } = require('./permissionService');

async function canWorkCompany(userId, companyId) {
  const user = await User.findByPk(parseRecordId(userId) || 0, { attributes: ['id', 'role', 'roleId', 'allCompanies', 'isActive'] });
  return user && user.isActive && (await canAccessCompany(user, companyId)) ? user : null;
}

async function assertCanWorkTicket(userId, companyId, label) {
  const user = await canWorkCompany(userId, companyId);
  if (!user) throw new ApiError(400, `${label} can't see tickets for this company`, 'VALIDATION_ERROR');
  return user.id;
}

module.exports = { canWorkCompany, assertCanWorkTicket };
```

- [ ] **Step 4: Wire it into `ticketsController.js`**

Import `const { canWorkCompany, assertCanWorkTicket } = require('../services/ticketPeople');`.

In `create`:
- **Department default:** after the block that sets `resolvedDepartmentId` from `departmentId`, add:

  ```js
    // Spec: the department defaults to the contact's (which belongs to the
    // contact's company by the contact integrity rule).
    if (!departmentId && contact.departmentId) resolvedDepartmentId = contact.departmentId;
  ```

- **Watchers:** replace the `watcherIdList` computation (`watcherIds.map((id) => parseInt(id, 10))...`) so the list is checked after `contact` is known. Move it below the contact check:

  ```js
    const watcherIdList = [];
    for (const raw of Array.isArray(watcherIds) ? watcherIds : []) {
      // eslint-disable-next-line no-await-in-loop
      const id = await assertCanWorkTicket(raw, contact.companyId, 'Watcher');
      if (!watcherIdList.includes(id)) watcherIdList.push(id);
    }
  ```

- **Assignee:** where the ticket is created with `assigneeId: assigneeId || ruleAssigneeId || null`, compute first:

  ```js
    let resolvedAssigneeId = null;
    if (assigneeId) {
      resolvedAssigneeId = await assertCanWorkTicket(assigneeId, contact.companyId, 'Assignee');
    } else if (ruleAssigneeId && (await canWorkCompany(ruleAssigneeId, contact.companyId))) {
      // A rule's assignee who can't reach this company is skipped, not refused.
      resolvedAssigneeId = ruleAssigneeId;
    }
  ```

  and use `assigneeId: resolvedAssigneeId,` in `Ticket.create`.

In `update`, after `targetCompanyId` is computed, where `changes.assigneeId` is set:

```js
  if (changes.assigneeId && Number(changes.assigneeId) !== ticket.assigneeId) {
    changes.assigneeId = await assertCanWorkTicket(changes.assigneeId, targetCompanyId, 'Assignee');
  }
```

In `addWatcher`, after the ticket is loaded and its access checked, add `await assertCanWorkTicket(userId, ticket.companyId, 'Watcher');` before the watcher is created.

- [ ] **Step 5: `?companyId=` on the user pickers, and `/departments/owners`**

In `usersController.js`, import `canAccessCompany` and `parseRecordId` from permissionService, and add:

```js
// ?companyId= narrows a picker to people who can reach that company (an
// assignee or watcher must be able to open the ticket — plan 2b). A company
// the caller can't reach is refused like a missing one.
async function narrowToCompany(req, users) {
  const raw = req.query.companyId;
  if (raw === undefined || raw === '') return users;
  const companyId = parseRecordId(raw);
  if (!companyId || !(await canAccessCompany(req.user, companyId))) {
    throw new ApiError(400, 'Unknown company', 'VALIDATION_ERROR');
  }
  const full = await User.findAll({ where: { id: users.map((u) => u.id) }, attributes: ['id', 'role', 'roleId', 'allCompanies'] });
  const reach = new Set();
  for (const u of full) {
    if (await canAccessCompany(u, companyId)) reach.add(u.id); // eslint-disable-line no-await-in-loop
  }
  return users.filter((u) => reach.has(u.id));
}
```

In `listAssignable` and `listDirectory`, replace `res.json({ users })` with `res.json({ users: await narrowToCompany(req, users) });`.

In `departmentsController.js`, add and export:

```js
// GET /departments/owners — the internal departments a project can be
// "owned by". Every project creator needs them, including users fenced to
// client companies who can't otherwise list internal departments (plan 2b
// ruling: these are the organization's own teams, not client data).
const owners = asyncHandler(async (req, res) => {
  const departments = await Department.findAll({
    where: { companyId: await getInternalCompanyId() },
    attributes: ['id', 'name', 'shortCode'],
    order: [['name', 'ASC']],
  });
  res.json({ departments });
});
```

In `routes/departments.js`, before `router.get('/:id', ...)`, add `router.get('/owners', requirePermission('projects.create'), ctrl.owners);`, importing `requirePermission` if the file doesn't already.

- [ ] **Step 6: Run them and watch them pass**

Run: `cd backend && npm test -- companies.ticketpeople.test.js`
Expected: PASS.

- [ ] **Step 7: The full suite (Review Focus 5)**

Run (in the background): `cd backend && npm test > /tmp/task8-full.log 2>&1`, then `grep -E "^(FAIL|Tests:)" /tmp/task8-full.log`.
Expected: green. The department default can change baseline tests that create a ticket for a contact with a department and expect `departmentId: null`, or department-tier visibility built on that. Check each such failure:
- If the new value is the spec'd behaviour, update the test to it and ledger a `Ruling:` naming the test.
- Fix the code only if the change is not spec'd.

- [ ] **Step 8: Commit**

```bash
git add backend/src/services/ticketPeople.js backend/src/controllers/ticketsController.js backend/src/controllers/usersController.js backend/src/controllers/departmentsController.js backend/src/routes/departments.js backend/test/integration
git commit -m "feat(companies): assignees and watchers must reach the ticket's company; department defaults; owner departments"
```

---
### Task 9: Frontend foundations — the company switch, shared pickers, nav tab, routes

**Files:**
- Create:
  - `frontend/src/context/CompanyContext.jsx`;
  - `frontend/src/hooks/useCompanyOptions.js`;
  - `frontend/src/utils/contactLabel.js`;
  - `frontend/src/components/companies/`: `CompanyFilter.jsx`, `CompanyPicker.jsx`, `VendorPicker.jsx`, `SitePicker.jsx`, `CompanyTag.jsx`.
- Modify: `frontend/src/main.jsx`, `App.jsx`, `components/navConfig.js`, `components/TopNav.jsx`, `components/SidebarCompact.jsx`, `pages/SettingsHub.jsx`
- Test: `backend/test/smoke/companies.shell.smoke.js`

**Interfaces:**
- Consumes: `GET /companies/summary`, `GET /companies?kind=client&status=active`, `GET /companies/vendors`, `GET /companies/:id/sites`, `GET /modules` (row `companies`, Task 2).
- Produces (used by Tasks 10–18):
  - `useCompanySummary() → { count, multiCompany, refresh() }`;
  - `useCompanyOptions() → Company[]`: active clients plus the internal company, and empty while company UI is off;
  - `contactLabel(contact, { multiCompany, company? }) → string`;
  - `<CompanyFilter value onChange />`;
  - `<CompanyPicker value onChange label? disabled? style? />`, which picks a default as soon as the options load;
  - `<VendorPicker value onChange style? />`, where `value` is `{ id, name } | null`;
  - `<SitePicker companyId value onChange disabled? className? style? />`;
  - `<CompanyTag company />`.
  - Routes: `/settings/companies`, `/companies`, `/companies/:id`. The page components are placeholders until Tasks 10–11.

- [ ] **Step 1: Write the failing smoke test**

`backend/test/smoke/companies.shell.smoke.js`:

```js
const { resetData, closeDb } = require('../integration/helpers');
const { makeAdmin, makeCompany } = require('../integration/fixtures');
const { startSmoke } = require('./harness');

// Plan 2b task 9 (Review Focus 1): company UI stays hidden until a client
// company exists; Settings → Companies is always there.

let smoke;
beforeAll(async () => { smoke = await startSmoke(); });
afterAll(async () => { await smoke.stop(); await closeDb(); });
beforeEach(resetData);

it('a one-company install shows only Settings → Companies', async () => {
  await makeAdmin();
  const page = await smoke.pageAs('admin');
  await page.goto('/settings');
  await page.getByRole('link', { name: /Companies/ }).first().waitFor();
  await page.goto('/tickets');
  await page.getByRole('link', { name: 'Tickets' }).first().waitFor();
  expect(await page.getByRole('link', { name: 'Companies', exact: true }).count()).toBe(0);
  expect(await page.getByLabel('Company').count()).toBe(0);
});

it('once a client exists, the Companies tab and company filters appear', async () => {
  const admin = await makeAdmin();
  await makeCompany(admin, { name: 'Acme' });
  const page = await smoke.pageAs('admin');
  await page.goto('/tickets');
  await page.getByRole('link', { name: 'Companies', exact: true }).first().waitFor();
  await page.goto('/companies');
  await page.getByRole('heading', { name: 'Companies' }).waitFor();
});
```

`CompanyFilter` isn't placed on the ticket list until Task 16, so this test checks the Company label's absence only.

- [ ] **Step 2: Run it and watch it fail**

Run: `cd backend && npm run test:smoke -- companies.shell.smoke.js`
Expected: FAIL. There's no Companies settings card, and `/companies` is the 404 page.

- [ ] **Step 3: Context, hook and label**

`frontend/src/context/CompanyContext.jsx`:

```jsx
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import api from '../api/api';
import { useAuth } from './AuthContext';

// The company UI switch (spec: "The company picker"): every company column,
// filter and picker stays hidden until a client company exists. Pages call
// refresh() after creating, merging, deleting or re-flagging a company.
const CompanyContext = createContext({ count: 0, multiCompany: false, refresh: () => {} });

export function CompanyProvider({ children }) {
  const { user } = useAuth();
  const [summary, setSummary] = useState({ count: 0, multiCompany: false });
  const refresh = useCallback(() => {
    if (!user) return;
    api.get('/companies/summary').then(({ data }) => setSummary(data)).catch(() => {});
  }, [user]);
  useEffect(() => { refresh(); }, [refresh]);
  return <CompanyContext.Provider value={{ ...summary, refresh }}>{children}</CompanyContext.Provider>;
}

export function useCompanySummary() {
  return useContext(CompanyContext);
}
```

`frontend/src/hooks/useCompanyOptions.js`:

```js
import { useEffect, useState } from 'react';
import api from '../api/api';
import { useCompanySummary } from '../context/CompanyContext';

// Active client companies (and the internal one) the user can reach, for
// pickers and filters. Empty while company UI is off, and for users without
// companies.view (the API refuses them; their records go to the internal
// company by default).
export function useCompanyOptions() {
  const { multiCompany } = useCompanySummary();
  const [companies, setCompanies] = useState([]);
  useEffect(() => {
    if (!multiCompany) {
      setCompanies([]);
      return;
    }
    api.get('/companies', { params: { kind: 'client', status: 'active', limit: 200 } })
      .then(({ data }) => setCompanies(data.companies))
      .catch(() => setCompanies([]));
  }, [multiCompany]);
  return companies;
}
```

`frontend/src/utils/contactLabel.js`:

```js
// "Name · Company · Department" — how a contact is labelled everywhere
// (spec: Screens). The company part shows only while company UI is on.
// `company` overrides contact.company (a ticket carries its own company).
export function contactLabel(contact, { multiCompany = false, company } = {}) {
  if (!contact) return '';
  const companyName = multiCompany ? (company || contact.company)?.name : null;
  return [contact.displayName, companyName, contact.department?.name].filter(Boolean).join(' · ');
}
```

- [ ] **Step 4: The shared components**

`frontend/src/components/companies/CompanyFilter.jsx`:

```jsx
import { useCompanySummary } from '../../context/CompanyContext';
import { useCompanyOptions } from '../../hooks/useCompanyOptions';

// "All companies" filter for list pages. Renders nothing while company UI is off.
export default function CompanyFilter({ value, onChange, className = 'input h-9 flex-shrink-0 text-sm', style }) {
  const { multiCompany } = useCompanySummary();
  const companies = useCompanyOptions();
  if (!multiCompany) return null;
  return (
    <select aria-label="Company" value={value} onChange={(e) => onChange(e.target.value)} className={className} style={{ maxWidth: '12rem', ...style }}>
      <option value="">All companies</option>
      {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
    </select>
  );
}
```

`frontend/src/components/companies/CompanyPicker.jsx`:

```jsx
import { useEffect } from 'react';
import { useCompanySummary } from '../../context/CompanyContext';
import { useCompanyOptions } from '../../hooks/useCompanyOptions';

// The company a new record belongs to. Hidden while company UI is off (the
// record then goes to the internal company). When nothing is chosen yet it
// picks the internal company, or the user's first company if they can't
// reach the internal one, so the form never submits a blank it can't save.
export default function CompanyPicker({ value, onChange, label = 'Company', disabled = false, style }) {
  const { multiCompany } = useCompanySummary();
  const companies = useCompanyOptions();
  useEffect(() => {
    if (!multiCompany || value || !companies.length) return;
    const fallback = companies.find((c) => c.isInternal) || companies[0];
    onChange(String(fallback.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [multiCompany, value, companies]);
  if (!multiCompany) return null;
  return (
    <div>
      <label className="label" htmlFor="company-picker">{label}</label>
      <select id="company-picker" className="input" style={style} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        {companies.map((c) => <option key={c.id} value={c.id}>{c.name}{c.isInternal ? ' (internal)' : ''}</option>)}
      </select>
    </div>
  );
}
```

`frontend/src/components/companies/VendorPicker.jsx`:

```jsx
import { useEffect, useState } from 'react';
import api, { errMessage } from '../../api/api';
import { useAuth } from '../../context/AuthContext';

// Picks a vendor company (GET /companies/vendors). Holders of
// companies.manage can add a missing vendor inline. `value` is the chosen
// { id, name } or null.
export default function VendorPicker({ value, onChange, style }) {
  const { hasPermission } = useAuth();
  const canCreate = hasPermission('companies.manage');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    const term = query.trim();
    if (!term) {
      setResults([]);
      return undefined;
    }
    const timer = setTimeout(() => {
      api.get('/companies/vendors', { params: { search: term } })
        .then(({ data }) => setResults(data.vendors))
        .catch(() => setResults([]));
    }, 200);
    return () => clearTimeout(timer);
  }, [query]);

  const choose = (vendor) => { onChange(vendor); setQuery(''); setError(''); };
  const create = async () => {
    try {
      const { data } = await api.post('/companies', { name: query.trim(), isVendor: true, isClient: false });
      choose({ id: data.company.id, name: data.company.name });
    } catch (err) {
      setError(errMessage(err));
    }
  };

  if (value) {
    return (
      <div className="flex items-center gap-2">
        <span className="input flex-1" style={style} data-testid="vendor-chosen">{value.name}</span>
        <button type="button" className="btn-secondary h-9 px-3 text-xs" onClick={() => onChange(null)}>Change</button>
      </div>
    );
  }
  const term = query.trim();
  const exact = results.some((v) => v.name.toLowerCase() === term.toLowerCase());
  return (
    <div className="relative">
      <input aria-label="Vendor" className="input" style={style} value={query} placeholder="Search vendors…" onChange={(e) => setQuery(e.target.value)} />
      {term && (
        <div className="card absolute z-20 mt-1 w-full p-1">
          {results.map((v) => (
            <button key={v.id} type="button" className="block w-full rounded px-2 py-1 text-left text-sm hover:bg-[var(--color-hover)]" onClick={() => choose(v)}>{v.name}</button>
          ))}
          {!exact && canCreate && (
            <button type="button" className="block w-full rounded px-2 py-1 text-left text-sm text-prism hover:bg-[var(--color-hover)]" onClick={create}>+ Add vendor &quot;{term}&quot;</button>
          )}
          {!results.length && !canCreate && <p className="px-2 py-1 text-sm">No vendor found.</p>}
        </div>
      )}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
```

`frontend/src/components/companies/SitePicker.jsx`:

```jsx
import { useEffect, useState } from 'react';
import api from '../../api/api';
import { useCompanySummary } from '../../context/CompanyContext';

// A site of one company. Hidden while company UI is off. Inactive sites are
// left out unless one is the current value (which must still render).
export default function SitePicker({ companyId, value, onChange, disabled = false, className = 'input', style }) {
  const { multiCompany } = useCompanySummary();
  const [sites, setSites] = useState([]);
  useEffect(() => {
    if (!multiCompany || !companyId) {
      setSites([]);
      return;
    }
    api.get(`/companies/${companyId}/sites`).then(({ data }) => setSites(data.sites)).catch(() => setSites([]));
  }, [multiCompany, companyId]);
  if (!multiCompany || !companyId) return null;
  const shown = sites.filter((s) => s.status === 'active' || String(s.id) === String(value));
  return (
    <select aria-label="Site" className={className} style={style} value={value || ''} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      <option value="">No site</option>
      {shown.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
    </select>
  );
}
```

`frontend/src/components/companies/CompanyTag.jsx`:

```jsx
import { useCompanySummary } from '../../context/CompanyContext';

// " · Acme" after a contact's name, while company UI is on.
export default function CompanyTag({ company }) {
  const { multiCompany } = useCompanySummary();
  if (!multiCompany || !company) return null;
  return <span className="text-xs" style={{ color: 'var(--color-muted)' }}> · {company.name}</span>;
}
```

- [ ] **Step 5: Wire up the provider, the nav, the routes and the settings card**

**`main.jsx`:** import `{ CompanyProvider }` from `./context/CompanyContext`, and wrap `<TimerProvider>…</TimerProvider>` in `<CompanyProvider>…</CompanyProvider>`, inside `AuthProvider`.

**`components/navConfig.js`:**
- Add `'companies.view'` to `SETTINGS_PERMISSION_KEYS`.
- In `NAV`, after the contacts entry, add `{ key: 'companies', to: '/companies', label: 'Companies', icon: '🏢' },`.
- In `DEFAULT_ROLES`, add `companies: ['admin', 'technician'],`.
- In `permissionGate`, add `if (key === 'companies') return hasAnyPermission(['companies.view']);`.
- Change `visibleNavItems` to:

```js
// `multiCompany` hides the Companies tab until a client company exists
// (spec: the only new UI of a one-company install is Settings → Companies).
export function visibleNavItems({ visibility, user, hasAnyPermission, multiCompany = false }) {
  const rolesFor = (key) => (visibility && visibility[key]) || DEFAULT_ROLES[key] || [];
  return NAV.filter((n) => (n.key !== 'companies' || multiCompany)
    && rolesFor(n.key).includes(user?.role) && permissionGate(n.key, hasAnyPermission));
}
```

**`TopNav.jsx` and `SidebarCompact.jsx`:** import `{ useCompanySummary }`, add `const { multiCompany } = useCompanySummary();`, and pass `multiCompany` into the `visibleNavItems({ ... })` call. Check `grep -n "visibleNavItems(" frontend/src -r`: every caller passes it.

**`pages/SettingsHub.jsx`:** in the `Organization` section's `items`, after `Company`, add:

```js
      { label: 'Companies', to: '/settings/companies', desc: 'Clients, vendors, sites and domains', permission: ['companies.view'] },
```

**`App.jsx`:**
- Add `const COMPANIES_KEYS = ['companies.view'];` with the other key lists.
- Add the imports `import CompaniesList from './pages/companies/CompaniesList';` and `import CompanyPage from './pages/companies/CompanyPage';`.
- Add the routes:

```jsx
        <Route path="/companies" element={perm(<CompaniesList />, COMPANIES_KEYS)} />
        <Route path="/companies/:id" element={perm(<CompanyPage />, COMPANIES_KEYS)} />
        <Route path="/settings/companies" element={perm(<CompaniesList inSettings />, COMPANIES_KEYS)} />
```

Create placeholder pages (Task 10 and Task 11 replace them):

```jsx
// frontend/src/pages/companies/CompaniesList.jsx — replaced in Task 10.
export default function CompaniesList() {
  return <h1 className="text-2xl font-bold tracking-tight text-navy-900">Companies</h1>;
}
```

```jsx
// frontend/src/pages/companies/CompanyPage.jsx — replaced in Task 11.
export default function CompanyPage() {
  return <h1 className="text-2xl font-bold tracking-tight text-navy-900">Company</h1>;
}
```

- [ ] **Step 6: Run it and watch it pass; build**

Run: `cd backend && npm run test:smoke -- companies.shell.smoke.js login.smoke.js`
Expected: PASS. `npm run test:smoke` already built the frontend, so the build passed too.

- [ ] **Step 7: Commit**

```bash
git add frontend/src backend/test/smoke/companies.shell.smoke.js
git commit -m "feat(companies-ui): company switch, shared pickers, Companies tab and routes"
```

---

### Task 10: Settings → Companies (list, create, merge)

**Spec:** "a list with client/vendor flags, status, contact count and open-ticket count; filters by kind and status; create; 'Merge into…' with the preview counts and a confirmation." The Companies nav tab shows the same list.

**Files:**
- Create: `frontend/src/components/companies/CompanyFormModal.jsx`, `frontend/src/components/companies/MergeCompanyModal.jsx`
- Replace: `frontend/src/pages/companies/CompaniesList.jsx`
- Test: `backend/test/smoke/companies.settings.smoke.js`

**Interfaces:**
- Consumes:
  - `GET /companies` (`contactCount`, `openTicketCount` from Task 4);
  - `POST /companies`;
  - `POST /companies/:id/merge?preview=true` and `POST /companies/:id/merge` (Task 5);
  - `useCompanySummary().refresh`, `usePagination`, `Pagination`, `Modal`, `api` / `errMessage`.
- Produces: `<CompaniesList inSettings? />`.

- [ ] **Step 1: Write the failing smoke test**

```js
const { resetData, closeDb, models } = require('../integration/helpers');
const { makeAdmin, makeCompany } = require('../integration/fixtures');
const { startSmoke } = require('./harness');

// Plan 2b task 10: Settings → Companies.

let smoke;
beforeAll(async () => { smoke = await startSmoke(); });
afterAll(async () => { await smoke.stop(); await closeDb(); });
beforeEach(resetData);

it('lists companies with their counts and creates one', async () => {
  const admin = await makeAdmin();
  const acme = await makeCompany(admin, { name: 'Acme' });
  await models.Contact.create({ firstName: 'Ann', displayName: 'Ann', companyId: acme.id });
  const page = await smoke.pageAs('admin');
  await page.goto('/settings/companies');
  const row = page.getByRole('row', { name: /Acme/ });
  await row.waitFor();
  expect(await row.textContent()).toMatch(/Client/);
  await page.getByRole('button', { name: '+ New company' }).click();
  await page.getByLabel('Name').fill('Globex');
  await page.getByRole('button', { name: 'Create company' }).click();
  await page.getByRole('row', { name: /Globex/ }).waitFor();
});

it('merges one company into another after a preview', async () => {
  const admin = await makeAdmin();
  const acme = await makeCompany(admin, { name: 'Acme' });
  const globex = await makeCompany(admin, { name: 'Globex' });
  await models.Contact.create({ firstName: 'Gus', displayName: 'Gus', companyId: globex.id });
  const page = await smoke.pageAs('admin');
  await page.goto('/settings/companies');
  await page.getByRole('row', { name: /Globex/ }).getByRole('button', { name: 'Merge into…' }).click();
  await page.getByLabel('Merge into').selectOption(String(acme.id));
  await page.getByText('Contacts').first().waitFor();
  await page.getByLabel(/can't be undone/).check();
  await page.getByRole('button', { name: 'Merge into Acme' }).click();
  await page.getByRole('row', { name: /Globex/ }).waitFor({ state: 'detached' });
  expect(await models.Contact.count({ where: { companyId: acme.id } })).toBe(1);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd backend && npm run test:smoke -- companies.settings.smoke.js`
Expected: FAIL. The placeholder page has no rows.

- [ ] **Step 3: The modals**

`frontend/src/components/companies/CompanyFormModal.jsx`:

```jsx
import { useState } from 'react';
import api, { errMessage } from '../../api/api';
import Modal from '../Modal';

// Creates a company: a client, a vendor, or both.
export default function CompanyFormModal({ onClose, onSaved }) {
  const [form, setForm] = useState({ name: '', isClient: true, isVendor: false, phone: '', website: '' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) { setError('Name is required'); return; }
    if (!form.isClient && !form.isVendor) { setError('A company is a client, a vendor, or both'); return; }
    setSaving(true);
    try {
      const { data } = await api.post('/companies', {
        name: form.name.trim(), isClient: form.isClient, isVendor: form.isVendor,
        phone: form.phone || null, website: form.website || null,
      });
      onSaved(data.company);
    } catch (err) {
      setError(errMessage(err));
      setSaving(false);
    }
  };

  return (
    <Modal title="New company" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        <div>
          <label className="label" htmlFor="company-name">Name</label>
          <input id="company-name" className="input" value={form.name} onChange={set('name')} autoFocus />
        </div>
        <div className="flex gap-6 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked={form.isClient} onChange={set('isClient')} /> Client</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={form.isVendor} onChange={set('isVendor')} /> Vendor</label>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div><label className="label" htmlFor="company-phone">Phone</label><input id="company-phone" className="input" value={form.phone} onChange={set('phone')} /></div>
          <div><label className="label" htmlFor="company-website">Website</label><input id="company-website" className="input" value={form.website} onChange={set('website')} placeholder="https://" /></div>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Creating…' : 'Create company'}</button>
        </div>
      </form>
    </Modal>
  );
}
```

`frontend/src/components/companies/MergeCompanyModal.jsx`:

```jsx
import { useEffect, useState } from 'react';
import api, { errMessage } from '../../api/api';
import Modal from '../Modal';

const COUNT_LABELS = {
  contacts: 'Contacts', departments: 'Departments', sites: 'Sites', tickets: 'Tickets', projects: 'Projects',
  assets: 'Assets', licenses: 'Licenses', contracts: 'Contracts', vendorAssets: 'Assets bought from it',
  vendorLicenses: 'Licenses bought from it', vendorContracts: 'Contracts with it', vendorMaterials: 'Project materials bought from it',
  domains: 'Email domains', userAccess: 'User access grants', roleAccess: 'Role access grants',
};

// "Merge into…": pick the company to keep, see what will move, confirm.
// The merged-away company is deleted (spec: Merge).
export default function MergeCompanyModal({ company, onClose, onMerged }) {
  const [targets, setTargets] = useState([]);
  const [intoId, setIntoId] = useState('');
  const [counts, setCounts] = useState(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/companies', { params: { status: 'active', limit: 200 } })
      .then(({ data }) => setTargets(data.companies.filter((c) => c.id !== company.id)))
      .catch((err) => setError(errMessage(err)));
  }, [company.id]);

  const preview = async (id) => {
    setIntoId(id);
    setCounts(null);
    setConfirmed(false);
    setError('');
    if (!id) return;
    try {
      const { data } = await api.post(`/companies/${company.id}/merge`, { intoCompanyId: Number(id) }, { params: { preview: true } });
      setCounts(data.counts);
    } catch (err) {
      setError(errMessage(err));
    }
  };

  const merge = async () => {
    setBusy(true);
    try {
      const { data } = await api.post(`/companies/${company.id}/merge`, { intoCompanyId: Number(intoId) });
      onMerged(data.company);
    } catch (err) {
      setError(errMessage(err));
      setBusy(false);
    }
  };

  const target = targets.find((t) => String(t.id) === String(intoId));
  const moving = counts ? Object.entries(counts).filter(([, n]) => n > 0) : [];
  return (
    <Modal title={`Merge ${company.name}`} onClose={onClose}>
      <div className="space-y-4">
        {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        <div>
          <label className="label" htmlFor="merge-into">Merge into</label>
          <select id="merge-into" className="input" value={intoId} onChange={(e) => preview(e.target.value)}>
            <option value="">Choose the company to keep…</option>
            {targets.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        {counts && (
          <div className="card p-3 text-sm">
            {moving.length ? (
              <table className="w-full">
                <tbody>
                  {moving.map(([key, n]) => (
                    <tr key={key}><td className="py-0.5">{COUNT_LABELS[key] || key}</td><td className="py-0.5 text-right font-mono">{n}</td></tr>
                  ))}
                </tbody>
              </table>
            ) : <p>Nothing references {company.name}.</p>}
          </div>
        )}
        {counts && (
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            <span>I understand {company.name} will be deleted and this can&apos;t be undone.</span>
          </label>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="btn-danger" disabled={!counts || !confirmed || busy} onClick={merge}>
            {busy ? 'Merging…' : `Merge into ${target ? target.name : '…'}`}
          </button>
        </div>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 4: The list page**

Replace `frontend/src/pages/companies/CompaniesList.jsx`:

```jsx
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { errMessage } from '../../api/api';
import { useAuth } from '../../context/AuthContext';
import { useCompanySummary } from '../../context/CompanyContext';
import { usePagination } from '../../hooks/usePagination';
import Pagination from '../../components/Pagination';
import Spinner from '../../components/Spinner';
import CompanyFormModal from '../../components/companies/CompanyFormModal';
import MergeCompanyModal from '../../components/companies/MergeCompanyModal';

export function CompanyFlags({ company }) {
  const flags = [company.isInternal && 'Internal', company.isClient && 'Client', company.isVendor && 'Vendor'].filter(Boolean);
  return <span className="flex flex-wrap gap-1">{flags.map((f) => <span key={f} className="badge">{f}</span>)}</span>;
}

// Settings → Companies (always present) and the Companies nav tab (once a
// client exists) share this list; `inSettings` only changes the chrome.
export default function CompaniesList({ inSettings = false }) {
  const { hasPermission } = useAuth();
  const { refresh: refreshSummary } = useCompanySummary();
  const canManage = hasPermission('companies.manage');
  const [kind, setKind] = useState('');
  const [status, setStatus] = useState('active');
  const [search, setSearch] = useState('');
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [merging, setMerging] = useState(null);
  const pager = usePagination({ filterKey: JSON.stringify([kind, status, search]), storageKey: 'prism.companies.pageSize' });

  const load = useCallback(() => {
    const params = { ...pager.params };
    if (kind) params.kind = kind;
    if (status) params.status = status;
    if (search.trim()) params.search = search.trim();
    api.get('/companies', { params })
      .then(({ data }) => { setCompanies(data.companies); pager.applyMeta(data); setError(''); })
      .catch((err) => setError(errMessage(err)))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, status, search, pager.page, pager.limit]);
  useEffect(() => { load(); }, [load]);

  const changed = () => { load(); refreshSummary(); };

  return (
    <div className="space-y-5">
      {inSettings && <Link to="/settings" className="text-sm text-prism hover:underline">← Back to Settings</Link>}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight text-navy-900">Companies</h1>
        {canManage && <button type="button" className="btn-primary" onClick={() => setCreating(true)}>+ New company</button>}
      </div>
      {error && <div className="rounded-md bg-red-50 p-4 text-red-700">{error}</div>}
      <div className="flex flex-wrap gap-2">
        <input aria-label="Search companies" className="input h-9 flex-1 text-sm" style={{ minWidth: '14rem' }} placeholder="Search companies…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select aria-label="Kind" className="input h-9 text-sm" style={{ maxWidth: '10rem' }} value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">All kinds</option>
          <option value="client">Clients</option>
          <option value="vendor">Vendors</option>
        </select>
        <select aria-label="Status" className="input h-9 text-sm" style={{ maxWidth: '9rem' }} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="">Any status</option>
        </select>
      </div>
      {loading ? <Spinner /> : (
        <div className="card overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr>
                {['Name', 'Kind', 'Status', 'Contacts', 'Open tickets', ''].map((h) => <th key={h} className="table-th">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {companies.map((c) => (
                <tr key={c.id} className="border-t" style={{ borderColor: 'var(--color-border)' }}>
                  <td className="table-td"><Link to={`/companies/${c.id}`} className="font-semibold hover:underline">{c.name}</Link></td>
                  <td className="table-td"><CompanyFlags company={c} /></td>
                  <td className="table-td">{c.status === 'active' ? 'Active' : 'Inactive'}</td>
                  <td className="table-td font-mono">{c.contactCount}</td>
                  <td className="table-td font-mono">{c.openTicketCount}</td>
                  <td className="table-td text-right">
                    {canManage && !c.isInternal && (
                      <button type="button" className="btn-secondary h-8 px-3 text-xs" onClick={() => setMerging(c)}>Merge into…</button>
                    )}
                  </td>
                </tr>
              ))}
              {!companies.length && <tr><td className="table-td" colSpan={6}>No companies match.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={pager.page} limit={pager.limit} total={pager.total} totalPages={pager.totalPages} onPageChange={pager.setPage} onLimitChange={pager.setLimit} />
      {creating && <CompanyFormModal onClose={() => setCreating(false)} onSaved={() => { setCreating(false); changed(); }} />}
      {merging && <MergeCompanyModal company={merging} onClose={() => setMerging(null)} onMerged={() => { setMerging(null); changed(); }} />}
    </div>
  );
}
```

- [ ] **Step 5: Run it and watch it pass**

Run: `cd backend && npm run test:smoke -- companies.settings.smoke.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src backend/test/smoke/companies.settings.smoke.js
git commit -m "feat(companies-ui): Settings → Companies with create and merge"
```

---

### Task 11: The company page

**Spec, *Companies nav tab*:** a company page with these tabs:
- **Overview:** fields, domains, account manager.
- **Sites:** add, edit, deactivate.
- **Departments:** the company's own.
- **Contacts, Tickets, Projects, Assets:** that company's records.
- **Vendor** (vendor companies only): contracts, licenses and assets bought from them.

**Files:**
- Create: `frontend/src/components/companies/`: `CompanyOverview.jsx`, `CompanySites.jsx`, `CompanyDepartments.jsx`, `CompanyRecordList.jsx`
- Replace: `frontend/src/pages/companies/CompanyPage.jsx`
- Test: `backend/test/smoke/companies.page.smoke.js`

**Interfaces:**
- Consumes:
  - `GET/PATCH /companies/:id`;
  - `POST /companies/:id/domains` and `DELETE /companies/:id/domains/:domainId`;
  - `GET/POST /companies/:id/sites` and `PATCH /companies/:id/sites/:siteId`;
  - `GET /departments?companyId=` and `POST /departments { name, companyId, shortCode? }`;
  - `GET /contacts|/tickets|/projects|/assets?companyId=`;
  - `GET /assets|/licenses|/contracts?vendorCompanyId=` (Task 3);
  - `GET /users/assignable`.
- Produces: `<CompanyRecordList kind companyId? vendorCompanyId? />`, where `kind` is one of `contacts | tickets | projects | assets | licenses | contracts`. The full-list link is `?companyId=`, which list pages read in Task 16.

- [ ] **Step 1: Write the failing smoke test**

```js
const { resetData, closeDb, models } = require('../integration/helpers');
const { makeAdmin, makeCompany } = require('../integration/fixtures');
const { startSmoke } = require('./harness');

// Plan 2b task 11: the company page.

let smoke;
beforeAll(async () => { smoke = await startSmoke(); });
afterAll(async () => { await smoke.stop(); await closeDb(); });
beforeEach(resetData);

it('shows the company, and adds a domain and a site', async () => {
  const admin = await makeAdmin();
  const acme = await makeCompany(admin, { name: 'Acme' });
  await models.Contact.create({ firstName: 'Ann', displayName: 'Ann Able', companyId: acme.id });
  const page = await smoke.pageAs('admin');
  await page.goto(`/companies/${acme.id}`);
  await page.getByRole('heading', { name: 'Acme' }).waitFor();

  await page.getByLabel('New domain').fill('acme.test');
  await page.getByRole('button', { name: 'Add domain' }).click();
  await page.getByText('acme.test').waitFor();

  await page.getByRole('button', { name: 'Sites' }).click();
  await page.getByLabel('Site name').fill('HQ');
  await page.getByRole('button', { name: 'Add site' }).click();
  await page.getByRole('cell', { name: 'HQ' }).waitFor();

  await page.getByRole('button', { name: 'Contacts' }).click();
  await page.getByRole('link', { name: 'Ann Able' }).waitFor();
});

it('a vendor company has a Vendor tab listing what was bought from it', async () => {
  const admin = await makeAdmin();
  const dell = await models.Company.create({ name: 'Dell', isVendor: true });
  await models.AssetCategory.destroy({ where: { name: 'Laptops' } });
  const category = await models.AssetCategory.create({ name: 'Laptops' });
  await models.Asset.create({ assetTag: 'DELL-9', name: 'Latitude', categoryId: category.id, vendorCompanyId: dell.id });
  const page = await smoke.pageAs('admin');
  await page.goto(`/companies/${dell.id}`);
  await page.getByRole('button', { name: 'Vendor' }).click();
  await page.getByText('DELL-9').waitFor();
  await models.AssetCategory.destroy({ where: { name: 'Laptops' } });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd backend && npm run test:smoke -- companies.page.smoke.js`
Expected: FAIL. The placeholder page has no heading `Acme`.

- [ ] **Step 3: `CompanyRecordList.jsx`**

```jsx
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { errMessage } from '../../api/api';

// A compact list of one company's records (or of what was bought from a
// vendor), with a link to the full list filtered to that company.
const KINDS = {
  contacts: { url: '/contacts', key: 'contacts', href: (r) => `/contacts/${r.id}`, full: '/contacts', cols: [['Name', (r) => r.displayName], ['Email', (r) => r.email || '—'], ['Department', (r) => r.department?.name || '—']] },
  tickets: { url: '/tickets', key: 'tickets', href: (r) => `/tickets/${r.id}`, full: '/tickets', cols: [['#', (r) => String(r.id).padStart(5, '0')], ['Title', (r) => r.title], ['Status', (r) => r.status]] },
  projects: { url: '/projects', key: 'projects', href: (r) => `/projects/${r.id}`, full: '/projects', cols: [['Code', (r) => r.projectCode], ['Name', (r) => r.name], ['Status', (r) => r.status?.name || r.status]] },
  assets: { url: '/assets', key: 'assets', href: (r) => `/assets/${r.id}`, full: '/assets', cols: [['Tag', (r) => r.assetTag], ['Name', (r) => r.name], ['Status', (r) => r.status]] },
  licenses: { url: '/licenses', key: 'licenses', href: (r) => `/assets/licenses/${r.id}`, full: '/assets/licenses', cols: [['Name', (r) => r.name], ['Expires', (r) => r.expiryDate || '—']] },
  contracts: { url: '/contracts', key: 'contracts', href: (r) => `/assets/contracts/${r.id}`, full: '/assets/contracts', cols: [['Name', (r) => r.name], ['Renews', (r) => r.renewalDate || r.endDate || '—']] },
};

export default function CompanyRecordList({ kind, companyId, vendorCompanyId }) {
  const spec = KINDS[kind];
  const [rows, setRows] = useState(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');
  useEffect(() => {
    const params = vendorCompanyId ? { vendorCompanyId, limit: 25 } : { companyId, limit: 25 };
    api.get(spec.url, { params })
      .then(({ data }) => { setRows(data[spec.key] || []); setTotal(data.total ?? (data[spec.key] || []).length); })
      .catch((err) => setError(err.response?.status === 403 ? "You don't have access to these records." : errMessage(err)));
  }, [spec, companyId, vendorCompanyId]);

  if (error) return <p className="text-sm" style={{ color: 'var(--color-muted)' }}>{error}</p>;
  if (!rows) return null;
  return (
    <div className="space-y-2">
      <table className="min-w-full text-sm">
        <thead><tr>{spec.cols.map(([h]) => <th key={h} className="table-th">{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t" style={{ borderColor: 'var(--color-border)' }}>
              {spec.cols.map(([h, get], i) => (
                <td key={h} className="table-td">{i === 0 || h === 'Name' ? <Link to={spec.href(r)} className="hover:underline">{get(r)}</Link> : get(r)}</td>
              ))}
            </tr>
          ))}
          {!rows.length && <tr><td className="table-td" colSpan={spec.cols.length}>None yet.</td></tr>}
        </tbody>
      </table>
      {!vendorCompanyId && total > rows.length && (
        <Link className="text-sm text-prism hover:underline" to={`${spec.full}?companyId=${companyId}`}>See all {total}</Link>
      )}
    </div>
  );
}
```

- [ ] **Step 4: `CompanyOverview.jsx`, `CompanySites.jsx`, `CompanyDepartments.jsx`**

`frontend/src/components/companies/CompanyOverview.jsx`:

```jsx
import { useEffect, useState } from 'react';
import api, { errMessage } from '../../api/api';
import { useAuth } from '../../context/AuthContext';
import { useCompanySummary } from '../../context/CompanyContext';
import { useToast } from '../../context/ToastContext';

// Overview tab: the company's fields, email domains and account manager.
export default function CompanyOverview({ company, onSaved }) {
  const { hasPermission } = useAuth();
  const { refresh: refreshSummary } = useCompanySummary();
  const { showToast } = useToast();
  const canManage = hasPermission('companies.manage');
  const [form, setForm] = useState({
    name: company.name, isClient: company.isClient, isVendor: company.isVendor, status: company.status,
    phone: company.phone || '', website: company.website || '', notes: company.notes || '',
    accountManagerId: company.accountManagerId || '',
  });
  const [managers, setManagers] = useState([]);
  const [domain, setDomain] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { api.get('/users/assignable').then(({ data }) => setManagers(data.users)).catch(() => {}); }, []);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const save = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const { data } = await api.patch(`/companies/${company.id}`, {
        ...form, phone: form.phone || null, website: form.website || null, notes: form.notes || null,
        accountManagerId: form.accountManagerId || null,
      });
      onSaved(data.company);
      refreshSummary();
      showToast('Company saved');
    } catch (err) {
      setError(errMessage(err));
    }
  };
  const addDomain = async () => {
    setError('');
    try {
      await api.post(`/companies/${company.id}/domains`, { domain });
      setDomain('');
      const { data } = await api.get(`/companies/${company.id}`);
      onSaved(data.company);
    } catch (err) {
      setError(errMessage(err));
    }
  };
  const removeDomain = async (d) => {
    try {
      await api.delete(`/companies/${company.id}/domains/${d.id}`);
      const { data } = await api.get(`/companies/${company.id}`);
      onSaved(data.company);
    } catch (err) {
      setError(errMessage(err));
    }
  };

  return (
    <div className="space-y-5">
      {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      <form onSubmit={save} className="card grid grid-cols-1 gap-4 p-5 sm:grid-cols-2">
        <div><label className="label" htmlFor="co-name">Name</label><input id="co-name" className="input" value={form.name} disabled={!canManage} onChange={set('name')} /></div>
        <div>
          <label className="label" htmlFor="co-manager">Account manager</label>
          <select id="co-manager" className="input" value={form.accountManagerId} disabled={!canManage} onChange={set('accountManagerId')}>
            <option value="">None</option>
            {managers.map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}
          </select>
        </div>
        <div><label className="label" htmlFor="co-phone">Phone</label><input id="co-phone" className="input" value={form.phone} disabled={!canManage} onChange={set('phone')} /></div>
        <div><label className="label" htmlFor="co-website">Website</label><input id="co-website" className="input" value={form.website} disabled={!canManage} onChange={set('website')} /></div>
        <div className="flex items-center gap-6 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked={form.isClient} disabled={!canManage || company.isInternal} onChange={set('isClient')} /> Client</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={form.isVendor} disabled={!canManage} onChange={set('isVendor')} /> Vendor</label>
        </div>
        <div>
          <label className="label" htmlFor="co-status">Status</label>
          <select id="co-status" className="input" value={form.status} disabled={!canManage || company.isInternal} onChange={set('status')}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
        <div className="sm:col-span-2"><label className="label" htmlFor="co-notes">Notes</label><textarea id="co-notes" className="input" rows={3} value={form.notes} disabled={!canManage} onChange={set('notes')} /></div>
        {canManage && <div className="sm:col-span-2"><button type="submit" className="btn-primary">Save</button></div>}
      </form>

      <div className="card space-y-3 p-5">
        <p className="eyebrow">Email domains</p>
        <p className="text-sm" style={{ color: 'var(--color-muted)' }}>New contacts emailing from these domains are filed under {company.name}.</p>
        <ul className="space-y-1 text-sm">
          {(company.domains || []).map((d) => (
            <li key={d.id} className="flex items-center gap-3">
              <span className="font-mono">{d.domain}</span>
              {canManage && <button type="button" className="text-xs text-red-600 hover:underline" onClick={() => removeDomain(d)}>Remove</button>}
            </li>
          ))}
          {!(company.domains || []).length && <li style={{ color: 'var(--color-muted)' }}>No domains.</li>}
        </ul>
        {canManage && (
          <div className="flex gap-2">
            <input aria-label="New domain" className="input h-9 text-sm" placeholder="example.com" value={domain} onChange={(e) => setDomain(e.target.value)} />
            <button type="button" className="btn-secondary h-9 px-3 text-sm" onClick={addDomain} disabled={!domain.trim()}>Add domain</button>
          </div>
        )}
      </div>
    </div>
  );
}
```

`frontend/src/components/companies/CompanySites.jsx`:

```jsx
import { useCallback, useEffect, useState } from 'react';
import api, { errMessage } from '../../api/api';
import { useAuth } from '../../context/AuthContext';

// Sites tab: a company's physical locations. Deactivating keeps history.
export default function CompanySites({ company }) {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('companies.manage');
  const [sites, setSites] = useState([]);
  const [form, setForm] = useState({ name: '', line1: '', city: '', region: '', postalCode: '', country: '' });
  const [error, setError] = useState('');
  const load = useCallback(() => {
    api.get(`/companies/${company.id}/sites`).then(({ data }) => setSites(data.sites)).catch((err) => setError(errMessage(err)));
  }, [company.id]);
  useEffect(load, [load]);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const add = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const body = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v || null]));
      await api.post(`/companies/${company.id}/sites`, body);
      setForm({ name: '', line1: '', city: '', region: '', postalCode: '', country: '' });
      load();
    } catch (err) {
      setError(errMessage(err));
    }
  };
  const toggle = async (site) => {
    try {
      await api.patch(`/companies/${company.id}/sites/${site.id}`, { status: site.status === 'active' ? 'inactive' : 'active' });
      load();
    } catch (err) {
      setError(errMessage(err));
    }
  };

  return (
    <div className="space-y-4">
      {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      <table className="min-w-full text-sm">
        <thead><tr>{['Site', 'Address', 'Status', ''].map((h) => <th key={h} className="table-th">{h}</th>)}</tr></thead>
        <tbody>
          {sites.map((s) => (
            <tr key={s.id} className="border-t" style={{ borderColor: 'var(--color-border)' }}>
              <td className="table-td">{s.name}</td>
              <td className="table-td">{[s.line1, s.city, s.region, s.postalCode, s.country].filter(Boolean).join(', ') || '—'}</td>
              <td className="table-td">{s.status === 'active' ? 'Active' : 'Inactive'}</td>
              <td className="table-td text-right">
                {canManage && <button type="button" className="btn-secondary h-8 px-3 text-xs" onClick={() => toggle(s)}>{s.status === 'active' ? 'Deactivate' : 'Reactivate'}</button>}
              </td>
            </tr>
          ))}
          {!sites.length && <tr><td className="table-td" colSpan={4}>No sites yet.</td></tr>}
        </tbody>
      </table>
      {canManage && (
        <form onSubmit={add} className="card grid grid-cols-1 gap-3 p-4 sm:grid-cols-3">
          <input aria-label="Site name" className="input" placeholder="Site name" value={form.name} onChange={set('name')} />
          <input aria-label="Address line 1" className="input" placeholder="Address" value={form.line1} onChange={set('line1')} />
          <input aria-label="City" className="input" placeholder="City" value={form.city} onChange={set('city')} />
          <input aria-label="Region" className="input" placeholder="State / region" value={form.region} onChange={set('region')} />
          <input aria-label="Postal code" className="input" placeholder="Postal code" value={form.postalCode} onChange={set('postalCode')} />
          <input aria-label="Country" className="input" placeholder="Country" value={form.country} onChange={set('country')} />
          <div className="sm:col-span-3"><button type="submit" className="btn-primary" disabled={!form.name.trim()}>Add site</button></div>
        </form>
      )}
    </div>
  );
}
```

`frontend/src/components/companies/CompanyDepartments.jsx`:

```jsx
import { useCallback, useEffect, useState } from 'react';
import api, { errMessage } from '../../api/api';
import { useAuth } from '../../context/AuthContext';

// Departments tab: the company's own departments. Client departments need
// companies.manage; internal ones need people.manage_departments and a
// short code (they own projects).
export default function CompanyDepartments({ company }) {
  const { hasPermission } = useAuth();
  const canAdd = company.isInternal ? hasPermission('people.manage_departments') : hasPermission('companies.manage');
  const [departments, setDepartments] = useState([]);
  const [name, setName] = useState('');
  const [shortCode, setShortCode] = useState('');
  const [error, setError] = useState('');
  const load = useCallback(() => {
    api.get('/departments', { params: { companyId: company.id } }).then(({ data }) => setDepartments(data.departments)).catch((err) => setError(errMessage(err)));
  }, [company.id]);
  useEffect(load, [load]);

  const add = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await api.post('/departments', { name, companyId: company.id, ...(company.isInternal ? { shortCode } : {}) });
      setName('');
      setShortCode('');
      load();
    } catch (err) {
      setError(errMessage(err));
    }
  };

  return (
    <div className="space-y-4">
      {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      <ul className="space-y-1 text-sm">
        {departments.map((d) => <li key={d.id}>{d.name}{d.shortCode ? <span className="ml-2 font-mono text-xs">{d.shortCode}</span> : null}</li>)}
        {!departments.length && <li style={{ color: 'var(--color-muted)' }}>No departments yet.</li>}
      </ul>
      {canAdd && (
        <form onSubmit={add} className="flex flex-wrap gap-2">
          <input aria-label="Department name" className="input h-9 text-sm" placeholder="Department name" value={name} onChange={(e) => setName(e.target.value)} />
          {company.isInternal && <input aria-label="Short code" className="input h-9 w-28 text-sm uppercase" placeholder="Code" value={shortCode} onChange={(e) => setShortCode(e.target.value.toUpperCase())} />}
          <button type="submit" className="btn-secondary h-9 px-3 text-sm" disabled={!name.trim()}>Add department</button>
        </form>
      )}
    </div>
  );
}
```

- [ ] **Step 5: `CompanyPage.jsx`**

```jsx
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import api, { errMessage } from '../../api/api';
import Spinner from '../../components/Spinner';
import CompanyOverview from '../../components/companies/CompanyOverview';
import CompanySites from '../../components/companies/CompanySites';
import CompanyDepartments from '../../components/companies/CompanyDepartments';
import CompanyRecordList from '../../components/companies/CompanyRecordList';
import { CompanyFlags } from './CompaniesList';

const TABS = [
  ['overview', 'Overview'], ['sites', 'Sites'], ['departments', 'Departments'],
  ['contacts', 'Contacts'], ['tickets', 'Tickets'], ['projects', 'Projects'], ['assets', 'Assets'],
];

// A company's page (spec: Companies nav tab).
export default function CompanyPage() {
  const { id } = useParams();
  const [company, setCompany] = useState(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('overview');
  const load = useCallback(() => {
    api.get(`/companies/${id}`).then(({ data }) => setCompany(data.company)).catch((err) => setError(errMessage(err)));
  }, [id]);
  useEffect(load, [load]);

  if (error) return <div className="rounded-md bg-red-50 p-4 text-red-700">{error}</div>;
  if (!company) return <Spinner />;
  const tabs = company.isVendor ? [...TABS, ['vendor', 'Vendor']] : TABS;
  return (
    <div className="space-y-5">
      <Link to="/companies" className="text-sm text-prism hover:underline">← Companies</Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold tracking-tight text-navy-900">{company.name}</h1>
        <CompanyFlags company={company} />
        {company.status !== 'active' && <span className="badge">Inactive</span>}
      </div>
      <div className="flex flex-wrap gap-1 border-b" style={{ borderColor: 'var(--color-border)' }}>
        {tabs.map(([key, label]) => (
          <button key={key} type="button" onClick={() => setTab(key)} className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${tab === key ? 'border-prism text-prism' : 'border-transparent text-navy-500 hover:text-navy-700'}`}>{label}</button>
        ))}
      </div>
      {/* Keyed on updatedAt so the form re-reads a saved company. */}
      {tab === 'overview' && <CompanyOverview key={company.updatedAt} company={company} onSaved={setCompany} />}
      {tab === 'sites' && <CompanySites company={company} />}
      {tab === 'departments' && <CompanyDepartments company={company} />}
      {['contacts', 'tickets', 'projects', 'assets'].includes(tab) && <CompanyRecordList key={tab} kind={tab} companyId={company.id} />}
      {tab === 'vendor' && (
        <div className="space-y-6">
          {['assets', 'licenses', 'contracts'].map((kind) => (
            <div key={kind}><p className="eyebrow mb-2">{kind[0].toUpperCase() + kind.slice(1)}</p><CompanyRecordList kind={kind} vendorCompanyId={company.id} /></div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Run it and watch it pass**

Run: `cd backend && npm run test:smoke -- companies.page.smoke.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src backend/test/smoke/companies.page.smoke.js
git commit -m "feat(companies-ui): company page — overview, domains, sites, departments, records, vendor"
```

---
### Task 12: Contacts — company labels, company and site fields, moving a contact

**Spec, *Contacts everywhere*:**
- Contacts are labelled *Name · Company · Department* in pickers, lists, the contact page and the ticket header.
- The contact page gains Site and Company fields.
- Changing a contact's company asks for confirmation, because the move takes the contact's tickets with it.

**Files:**
- Create: `frontend/src/components/companies/ContactCompanyFields.jsx`
- Modify:
  - pages: `frontend/src/pages/ContactDetail.jsx`, `pages/Contacts.jsx`, `pages/TicketNew.jsx` (picker results and quick create), `pages/AssetDetail.jsx`, `pages/assets/LicenseDetail.jsx` (picker result labels);
  - `components/AssetFormModal.jsx` (picker result label).
- Test: `backend/test/smoke/companies.contacts.smoke.js`

**Interfaces:**
- Consumes:
  - `PATCH /contacts/:id { companyId | siteId }` (moving needs `people.edit_users`);
  - `POST /contacts { …, companyId }`;
  - `GET /contacts?companyId=`;
  - `contactLabel`, `CompanyPicker`, `CompanyTag`, `CompanyFilter`, `SitePicker`, `useCompanyOptions`, `useCompanySummary` (Task 9).
- Produces: `<ContactCompanyFields contact canEdit onSave />`.

- [ ] **Step 1: Write the failing smoke test**

```js
const { resetData, closeDb, models } = require('../integration/helpers');
const { makeAdmin, makeCompany, makeTicket } = require('../integration/fixtures');
const { startSmoke } = require('./harness');

// Plan 2b task 12 (Review Focus 4).

// Waits until fn() returns `want` (the UI saves asynchronously).
const poll = async (fn, want, ms = 5000) => {
  for (let t = 0; t < ms; t += 100) {
    // eslint-disable-next-line no-await-in-loop
    if (await fn() === want) return;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => { setTimeout(r, 100); });
  }
  expect(await fn()).toBe(want);
};

let smoke;
let admin;
let acme;
beforeAll(async () => { smoke = await startSmoke(); });
afterAll(async () => { await smoke.stop(); await closeDb(); });
beforeEach(async () => {
  await resetData();
  admin = await makeAdmin();
  acme = await makeCompany(admin, { name: 'Acme' });
});

it('moving a contact asks first and takes its tickets', async () => {
  const internal = await models.Company.findOne({ where: { isInternal: true } });
  const bob = await models.Contact.create({ firstName: 'Bob', displayName: 'Bob Home', companyId: internal.id });
  const t = await makeTicket(admin.agent, { title: 'Bob ticket', contactId: bob.id });
  const page = await smoke.pageAs('admin');
  await page.goto(`/contacts/${bob.id}`);
  let asked = '';
  page.once('dialog', (d) => { asked = d.message(); d.accept(); });
  await page.locator('#contact-company').selectOption(String(acme.id));
  await poll(async () => (await models.Ticket.findByPk(t.id)).companyId, acme.id);
  expect(asked).toMatch(/tickets move too/);
});

it('a new contact can be created for a company, and the list shows and filters by it', async () => {
  const page = await smoke.pageAs('admin');
  await page.goto('/contacts');
  await page.getByRole('button', { name: /New contact/ }).click();
  await page.locator('#company-picker').selectOption(String(acme.id));
  await page.getByPlaceholder('First name').first().fill('Cara');
  await page.getByPlaceholder('Last name').first().fill('Client');
  await page.getByRole('button', { name: /Create contact/ }).click();
  await poll(async () => (await models.Contact.findOne({ where: { firstName: 'Cara' } }))?.companyId, acme.id);
  await page.goto('/contacts');
  await page.getByText('· Acme').first().waitFor();
  await page.getByLabel('Company').selectOption(String(acme.id));
  await page.getByRole('link', { name: 'Cara Client' }).first().waitFor();
});
```

Before writing the second test, check the exact text of Contacts.jsx's "new contact" button and of its form's placeholders and submit button (`grep -n "New contact\|placeholder=\|Create contact\|type=\"submit\"" frontend/src/pages/Contacts.jsx`), and use those strings.

- [ ] **Step 2: Run it and watch it fail**

Run: `cd backend && npm run test:smoke -- companies.contacts.smoke.js`
Expected: FAIL. There's no Company field on the contact page or in the new-contact form.

- [ ] **Step 3: `ContactCompanyFields.jsx`**

```jsx
import { useAuth } from '../../context/AuthContext';
import { useCompanySummary } from '../../context/CompanyContext';
import { useCompanyOptions } from '../../hooks/useCompanyOptions';
import SitePicker from './SitePicker';

// Company and site on the contact page. Moving a contact to another company
// takes all its tickets with it and clears a department or site from the
// old company (spec), so it asks first. Moving needs people.edit_users.
export default function ContactCompanyFields({ contact, canEdit, onSave }) {
  const { multiCompany } = useCompanySummary();
  const { hasPermission } = useAuth();
  const companies = useCompanyOptions();
  if (!multiCompany) return null;
  const canMove = canEdit && hasPermission('people.edit_users');
  const listed = companies.some((c) => c.id === contact.companyId) || !contact.company
    ? companies
    : [contact.company, ...companies];

  const move = (raw) => {
    const companyId = Number(raw);
    if (!companyId || companyId === contact.companyId) return;
    const target = companies.find((c) => c.id === companyId);
    const ok = window.confirm(
      `Move ${contact.displayName} to ${target ? target.name : 'that company'}? `
      + `All of their tickets move too, and a department or site from ${contact.company?.name || 'the current company'} is cleared.`
    );
    if (ok) onSave({ companyId });
  };

  return (
    <div className="mt-3 grid grid-cols-1 gap-2 text-left">
      <div>
        <label className="label" htmlFor="contact-company">Company</label>
        <select id="contact-company" className="input h-9 text-sm" disabled={!canMove} value={contact.companyId || ''} onChange={(e) => move(e.target.value)}>
          {listed.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <div>
        <span className="label">Site</span>
        <SitePicker
          companyId={contact.companyId}
          value={contact.siteId || ''}
          disabled={!canEdit}
          className="input h-9 text-sm"
          onChange={(siteId) => onSave({ siteId: siteId ? Number(siteId) : null })}
        />
      </div>
    </div>
  );
}
```

`SitePicker` labels its own `<select>` with `aria-label="Site"`, so the visible "Site" heading above it is plain text.

- [ ] **Step 4: Edit the pages**

**`ContactDetail.jsx`:**
- Import `ContactCompanyFields`.
- In `PropertiesPanel`, directly after the department `<div className="mt-2">…</div>` (the `<select value={contact.departmentId || ''} …>` block), add `<ContactCompanyFields contact={contact} canEdit={canEdit} onSave={onSave} />`.
- Where `PropertiesPanel` is rendered, limit departments to the contact's company: `departments={assignableContactDepartments(departments.filter((d) => d.companyId === contact.companyId), user, hasPermission, contact.departmentId)}`.

**`Contacts.jsx`:**
- Imports: `CompanyPicker`, `CompanyFilter`, `CompanyTag`, and `useCompanySummary`.
- `NewContactModal`:
  - add `companyId: ''` to the initial form;
  - render `<CompanyPicker value={form.companyId} onChange={(v) => setForm((f) => ({ ...f, companyId: v, departmentId: '' }))} />` as the first field of the department/assigned-to grid;
  - limit the department options to `departments.filter((d) => !form.companyId || String(d.companyId) === String(form.companyId))`;
  - send `companyId: form.companyId || undefined` in the POST body.
- List page:
  - add `const [companyId, setCompanyId] = useState(searchParams.get('companyId') || '');`, importing `useSearchParams` from `react-router-dom` if it isn't already;
  - add `companyId` to `filterKey`'s array and to the load effect's dependencies;
  - add `if (companyId) params.companyId = companyId;` in `filterParams`/`params`;
  - render `<CompanyFilter value={companyId} onChange={setCompanyId} style={fieldStyle} />` after the department `<select>`;
  - in the table's name cell, right after the name `<Link>`, add `<CompanyTag company={c.company} />`.

**`TicketNew.jsx`:**
- Contact picker results: in the second `<p>` of each result button, show `{contactLabel(c, { multiCompany }).split(' · ').slice(1).join(' · ') || 'No department'}{c.email ? ` · ${c.email}` : ''}`. That's company · department, with the name already shown above. Add `const { multiCompany } = useCompanySummary();` in the picker component, and import `contactLabel` and `useCompanySummary`.
- `QuickCreateContact`: add `const [companyId, setCompanyId] = useState('');`, render `<CompanyPicker value={companyId} onChange={setCompanyId} style={fieldStyle} />` above the email/phone grid, and pass `companyId: companyId || undefined` in the `onCreate({...})` object.

**`AssetFormModal.jsx`, `AssetDetail.jsx`, `assets/LicenseDetail.jsx`:** in each contact search's result rows, replace the displayed `c.displayName` with `contactLabel(c, { multiCompany })`. Import `contactLabel` and `useCompanySummary`, and read `multiCompany` in the component that renders the results.

- [ ] **Step 5: Run it and watch it pass**

Run: `cd backend && npm run test:smoke -- companies.contacts.smoke.js companies.shell.smoke.js`
Expected: PASS. The shell test proves a one-company install still shows no company field.

- [ ] **Step 6: Commit**

```bash
git add frontend/src backend/test/smoke/companies.contacts.smoke.js
git commit -m "feat(companies-ui): contacts show and change their company and site; Name · Company · Department labels"
```

---

### Task 13: New ticket and ticket page

**Spec, *New ticket*:** after a contact is picked, the company shows read-only and the department list is limited to that company. **Plan 2b decision:** assignee and watcher pickers list only people who can reach that company.

**Files:**
- Modify: `frontend/src/pages/TicketNew.jsx`, `frontend/src/pages/TicketDetail.jsx`
- Test: `backend/test/smoke/companies.tickets.smoke.js`

**Interfaces:**
- Consumes: `GET /users/assignable?companyId=`, `GET /users/directory?companyId=` (Task 8); `CompanyTag`, `useCompanySummary`; `ticket.company` (included by the API since plan 2a).

- [ ] **Step 1: Write the failing smoke test**

```js
const { resetData, closeDb, models } = require('../integration/helpers');
const {
  makeAdmin, makeCompany, makeTech, makeDept, setCompanyAccess,
} = require('../integration/fixtures');
const { startSmoke } = require('./harness');

// Plan 2b task 13.

let smoke;
beforeAll(async () => { smoke = await startSmoke(); });
afterAll(async () => { await smoke.stop(); await closeDb(); });
beforeEach(resetData);

it('a new ticket for a client contact shows the company and offers only that company\'s departments and people', async () => {
  const admin = await makeAdmin();
  const home = await makeDept(admin, 'Service Desk', 'SD');
  const acme = await makeCompany(admin, { name: 'Acme' });
  await models.Department.create({ name: 'Acme HR', companyId: acme.id });
  await models.Contact.create({ firstName: 'Ann', displayName: 'Ann Acme', companyId: acme.id });
  const internal = await models.Company.findOne({ where: { isInternal: true } });
  const outsider = await makeTech('outsider', home.id);
  await setCompanyAccess(admin, outsider.user.id, { allCompanies: false, companyIds: [internal.id] });

  const page = await smoke.pageAs('admin');
  await page.goto('/tickets/new');
  await page.getByPlaceholder('Search contacts by name or email…').fill('Ann');
  await page.getByRole('button', { name: /Ann Acme/ }).click();
  await page.getByText('Company: Acme').waitFor();
  const deptOptions = await page.locator('select').filter({ hasText: 'Acme HR' }).first().locator('option').allTextContents();
  expect(deptOptions).not.toContain('Service Desk');
  const assigneeOptions = await page.locator('select').filter({ hasText: 'Unassigned' }).first().locator('option').allTextContents();
  expect(assigneeOptions).not.toContain('Test outsider');
});
```

`makeDept` creates internal departments. Check the assignee select's placeholder option text with `grep -n "Unassigned" frontend/src/pages/TicketNew.jsx`; if it differs, match it.

- [ ] **Step 2: Run it and watch it fail**

Run: `cd backend && npm run test:smoke -- companies.tickets.smoke.js`
Expected: FAIL. No "Company: Acme" text, and the department select lists every department.

- [ ] **Step 3: `TicketNew.jsx`**

- Import `useCompanySummary`, and read `const { multiCompany } = useCompanySummary();` in the page component.
- Below the contact picker, where the selected contact is shown:

  ```jsx
  {multiCompany && selectedContact?.company && (
    <p className="mt-1 text-xs" style={{ color: MUTED }}>Company: {selectedContact.company.name}</p>
  )}
  ```

- Both department lists (the `assignableContactDepartments(departments, user, hasPermission)` call near line 820 and the plain `departments` map near line 859) use `companyDepartments`:

  ```js
  // A ticket's department belongs to its contact's company (spec).
  const companyDepartments = selectedContact
    ? departments.filter((d) => d.companyId === selectedContact.companyId)
    : departments;
  ```

- Replace the one-time `api.get('/users/assignable')` (around line 568) with a fetch that follows the contact's company, and do the same for the watcher directory:

  ```js
  // Assignees and watchers must reach the ticket's company (plan 2b).
  useEffect(() => {
    const params = selectedContact ? { companyId: selectedContact.companyId } : {};
    api.get('/users/assignable', { params }).then(({ data }) => setAssignableUsers(data.users)).catch(() => {});
    api.get('/users/directory', { params }).then(({ data }) => setDirectory(data.users)).catch(() => {});
  }, [selectedContact?.companyId]); // eslint-disable-line react-hooks/exhaustive-deps
  ```

  Remove the old unconditional `/users/assignable` and `/users/directory` calls from the mount effect. Use the state setter names the page already has.
- When the contact changes, `selectContact` resets the department. Also clear an assignee and any watchers who aren't in the new lists: in `selectContact`, add `setAssigneeId(''); setWatchers([]);`.

- [ ] **Step 4: `TicketDetail.jsx`**

- Import `CompanyTag`, and in the two places that render `<Link to={`/contacts/${ticket.contact.id}`} …>{ticket.contact.displayName}</Link>` (near lines 846 and 2387), add `<CompanyTag company={ticket.company} />` right after the link.
- In the mount effect around line 2018, remove the `/users/directory` and `/users/assignable` calls and add:

  ```js
  // Assignees and watchers must reach the ticket's company (plan 2b).
  useEffect(() => {
    if (!ticket?.companyId) return;
    const params = { companyId: ticket.companyId };
    api.get('/users/directory', { params }).then(({ data }) => setDirectory(data.users)).catch(() => {});
    if (isStaff) api.get('/users/assignable', { params }).then(({ data }) => setAssignableUsers(data.users)).catch(() => {});
  }, [isStaff, ticket?.companyId]);
  ```

- The two `contactDepartments={assignableContactDepartments(departments, user, hasPermission)}` props become `assignableContactDepartments(departments.filter((d) => d.companyId === ticket.companyId), user, hasPermission)`.

- [ ] **Step 5: Run it and watch it pass**

Run: `cd backend && npm run test:smoke -- companies.tickets.smoke.js login.smoke.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src backend/test/smoke/companies.tickets.smoke.js
git commit -m "feat(companies-ui): new ticket and ticket page follow the contact's company"
```

---

### Task 14: Projects — company, "for" and "owned by" departments

**Spec, *Projects*:** the form gets a company picker. "For department" is limited to that company, and "Owned by" to internal departments.

**Files:**
- Modify: `frontend/src/pages/ProjectNew.jsx`, `frontend/src/pages/ProjectDetail.jsx` (the header shows the company)
- Test: `backend/test/smoke/companies.projects.smoke.js`

**Interfaces:**
- Consumes: `GET /departments/owners` (Task 8); `GET /departments?companyId=`; `POST /projects { companyId, ownerDepartmentId, forDepartmentId }`; `CompanyPicker`, `CompanyTag`.

- [ ] **Step 1: Write the failing smoke test**

```js
const { resetData, closeDb, models } = require('../integration/helpers');
const { makeAdmin, makeCompany, makeDept } = require('../integration/fixtures');
const { startSmoke } = require('./harness');

// Plan 2b task 14.

let smoke;
beforeAll(async () => { smoke = await startSmoke(); });
afterAll(async () => { await smoke.stop(); await closeDb(); });
beforeEach(resetData);

it('a project for a client: owned by an internal department, for one of the client\'s', async () => {
  const admin = await makeAdmin();
  const sd = await makeDept(admin, 'Service Desk', 'SD');
  const acme = await makeCompany(admin, { name: 'Acme' });
  const acmeHr = await models.Department.create({ name: 'Acme HR', companyId: acme.id });
  const page = await smoke.pageAs('admin');
  await page.goto('/projects/new');
  await page.locator('#company-picker').selectOption(String(acme.id));
  await page.getByLabel(/Project name|Name/).first().fill('Rollout');
  const owner = page.locator('select').filter({ hasText: 'Service Desk' }).first();
  expect(await owner.locator('option').allTextContents()).not.toContain('Acme HR');
  await owner.selectOption(String(sd.id));
  const forDept = page.locator('select').filter({ hasText: 'Acme HR' }).first();
  expect(await forDept.locator('option').allTextContents()).not.toContain('Service Desk');
  await forDept.selectOption(String(acmeHr.id));
  await page.getByRole('button', { name: /Create project/ }).click();
  await page.getByText('Acme').first().waitFor();
  const project = await models.Project.findOne({ where: { name: 'Rollout' } });
  expect([project.companyId, project.ownerDepartmentId, project.forDepartmentId]).toEqual([acme.id, sd.id, acmeHr.id]);
});
```

Check ProjectNew's name label and submit button text (`grep -n "label\|type=\"submit\"" frontend/src/pages/ProjectNew.jsx`) and match them.

- [ ] **Step 2: Run it and watch it fail**

Run: `cd backend && npm run test:smoke -- companies.projects.smoke.js`
Expected: FAIL. There's no `#company-picker`.

- [ ] **Step 3: `ProjectNew.jsx`**

- Imports: `CompanyPicker`.
- Add `companyId: ''` to the form's initial state.
- Replace the `api.get('/departments')` call in the mount effect with `api.get('/departments/owners').then(({ data }) => setOwnerDepartments(data.departments)).catch(() => {});`, and add `const [ownerDepartments, setOwnerDepartments] = useState([]);`.
- Load "for" departments for the chosen company:

  ```js
  // "For department" belongs to the project's company (spec); "Owned by" is
  // always an internal department (from /departments/owners).
  const [forDepartments, setForDepartments] = useState([]);
  useEffect(() => {
    const params = form.companyId ? { companyId: form.companyId } : {};
    api.get('/departments', { params }).then(({ data }) => setForDepartments(data.departments)).catch(() => {});
  }, [form.companyId]);
  ```

- Render `<CompanyPicker value={form.companyId} onChange={(v) => setForm((f) => ({ ...f, companyId: v, forDepartmentId: '' }))} />` above the department selects.
- Change the "Owned by" select to map `ownerDepartments`, and the "For department" select to map `forDepartments`.
- `ownerDepartment` (the short-code warning) now finds in `ownerDepartments`.
- Add `companyId: form.companyId || undefined,` to the payload.

**Without a client company,** `CompanyPicker` renders nothing and `form.companyId` stays `''`. The "For" list is then every department the user can see, all internal, as before.

- [ ] **Step 4: `ProjectDetail.jsx`**

Import `CompanyTag`. In the header line that shows `project.ownerDepartment.name` (around line 447), add `<CompanyTag company={project.company} />` before the owner badge.

- [ ] **Step 5: Run it and watch it pass**

Run: `cd backend && npm run test:smoke -- companies.projects.smoke.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src backend/test/smoke/companies.projects.smoke.js
git commit -m "feat(companies-ui): project form picks a company; owned-by is internal, for-department the company's"
```

---

### Task 15: Asset, license and contract forms — company, vendor, site

**Spec:**
- Assets, licenses and contracts get a company picker, and a vendor picker that searches vendor companies and can create one inline.
- Assets also get a Site picker.
- In a one-company install the old vendor text field stays, and none of these pickers show (Global Constraints).

**Files:**
- Modify: `frontend/src/components/AssetFormModal.jsx`, `LicenseFormModal.jsx`, `ContractFormModal.jsx`
- Test: `backend/test/smoke/companies.assets.smoke.js`

**Interfaces:**
- Consumes: `CompanyPicker`, `VendorPicker`, `SitePicker`, `useCompanySummary` (Task 9); the asset, license and contract APIs, which accept `companyId`, `siteId` (assets), `departmentId` and `vendorCompanyId` (Task 3); `GET /contacts?companyId=`.

- [ ] **Step 1: Write the failing smoke test**

```js
const { resetData, closeDb, models } = require('../integration/helpers');
const { makeAdmin, makeCompany, makeDept } = require('../integration/fixtures');
const { startSmoke } = require('./harness');

// Plan 2b task 15 (Review Focus 2).

let smoke;
let category;
beforeAll(async () => { smoke = await startSmoke(); });
afterAll(async () => {
  await models.AssetCategory.destroy({ where: { name: 'Laptops' } });
  await smoke.stop();
  await closeDb();
});
beforeEach(async () => {
  await resetData();
  await models.AssetCategory.destroy({ where: { name: 'Laptops' } });
  category = await models.AssetCategory.create({ name: 'Laptops' });
});

it('the asset form only offers the chosen company\'s departments and sites, and picks a vendor', async () => {
  const admin = await makeAdmin();
  await makeDept(admin, 'Service Desk', 'SD');
  const acme = await makeCompany(admin, { name: 'Acme' });
  await models.Department.create({ name: 'Acme HR', companyId: acme.id });
  await models.Site.create({ name: 'Acme HQ', companyId: acme.id });
  await models.Company.create({ name: 'Dell', isVendor: true });

  const page = await smoke.pageAs('admin');
  await page.goto('/assets');
  await page.getByRole('button', { name: /New asset|Add asset/ }).click();
  await page.locator('#company-picker').selectOption(String(acme.id));
  const deptOptions = await page.locator('select').filter({ hasText: 'Acme HR' }).first().locator('option').allTextContents();
  expect(deptOptions).not.toContain('Service Desk');
  await page.getByLabel('Site').selectOption({ label: 'Acme HQ' });
  await page.getByLabel('Vendor').fill('De');
  await page.getByRole('button', { name: 'Dell' }).click();
  await page.locator('select').filter({ hasText: 'Laptops' }).first().selectOption(String(category.id));
  await page.getByLabel(/^Name/).first().fill('Acme laptop');
  await page.getByRole('button', { name: /Create asset|Save/ }).click();
  const poll = async () => models.Asset.findOne({ where: { name: 'Acme laptop' }, include: [{ model: models.Company, as: 'vendorCompany' }] });
  let asset;
  for (let t = 0; t < 50 && !asset; t += 1) {
    asset = await poll(); // eslint-disable-line no-await-in-loop
    if (!asset) await new Promise((r) => { setTimeout(r, 100); }); // eslint-disable-line no-await-in-loop
  }
  expect([asset.companyId, asset.vendorCompany.name]).toEqual([acme.id, 'Dell']);
  expect(asset.siteId).not.toBeNull();
});
```

Match the asset page's "new asset" button and the form's name label and save button to their real text (`grep -n "New asset\|Add asset\|Save\|Create" frontend/src/pages/Assets.jsx frontend/src/components/AssetFormModal.jsx`).

- [ ] **Step 2: Run it and watch it fail**

Run: `cd backend && npm run test:smoke -- companies.assets.smoke.js`
Expected: FAIL. There's no `#company-picker` in the asset form.

- [ ] **Step 3: `AssetFormModal.jsx`**

- Imports: `CompanyPicker`, `VendorPicker`, `SitePicker`, `useCompanySummary`.
- Add `companyId: '', siteId: ''` to `DEFAULT_FORM`. Edit mode copies them from `asset` through the existing loop.
- Add `const { multiCompany } = useCompanySummary();` and `const [vendor, setVendor] = useState(asset?.vendorCompany || null);`.
- The company field: render `<CompanyPicker value={String(form.companyId || '')} onChange={(v) => setForm((f) => ({ ...f, companyId: v, departmentId: '', siteId: '' }))} />` as the first field of the department section.
- The department select maps `departments.filter((d) => !multiCompany || String(d.companyId) === String(form.companyId))`.
- Next to it, `{multiCompany && <div><Label>Site</Label><SitePicker companyId={form.companyId} value={form.siteId} onChange={(v) => setForm((f) => ({ ...f, siteId: v }))} style={fieldStyle} /></div>}`.
- Replace the "Vendor name" input line with:

  ```jsx
  <div>
    <Label>Vendor</Label>
    {multiCompany
      ? <VendorPicker value={vendor} onChange={setVendor} style={fieldStyle} />
      : <input className="input" style={fieldStyle} value={form.vendorName} onChange={set('vendorName')} />}
  </div>
  ```

- In `submit`, after building `payload`: `if (multiCompany) payload.vendorCompanyId = vendor ? vendor.id : null;`.
- The contact search (around line 91) adds the company, so only that company's contacts are offered: `api.get('/contacts', { params: { search: query.trim(), ...(multiCompany && form.companyId ? { companyId: form.companyId } : {}) } })`. The contact-search component needs `companyId` passed in as a prop if it's a separate component in the file: pass `companyId={form.companyId}`. Clear the chosen contact when the company changes: in the CompanyPicker `onChange`, also call `setContact(null)`.

- [ ] **Step 4: `LicenseFormModal.jsx` and `ContractFormModal.jsx`**

Apply the same changes to each modal:
- Add `companyId: ''` to `DEFAULT_FORM`.
- Add `const { multiCompany } = useCompanySummary();` and `const [vendor, setVendor] = useState(license?.vendorCompany || null);` (`contract?.vendorCompany` in the contract modal).
- Render `<CompanyPicker value={String(form.companyId || '')} onChange={(v) => setForm((f) => ({ ...f, companyId: v, departmentId: '' }))} />` above the department select.
- Filter the department options the same way as the asset form.
- Show `VendorPicker` in place of the vendor text input when `multiCompany`.
- Add `companyId: form.companyId || undefined,` to the payload, and `if (multiCompany) payload.vendorCompanyId = vendor ? vendor.id : null;`.
- **Contract modal only:** its client-side check `if (!form.vendor.trim()) { setError('Vendor is required'); return; }` becomes `if (multiCompany ? !vendor : !form.vendor.trim()) { setError('Vendor is required'); return; }`. Its payload's `vendor: form.vendor.trim()` becomes `vendor: multiCompany ? undefined : form.vendor.trim()`, because the server fills the text from the company.

- [ ] **Step 5: Run it and watch it pass**

Run: `cd backend && npm run test:smoke -- companies.assets.smoke.js companies.shell.smoke.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src backend/test/smoke/companies.assets.smoke.js
git commit -m "feat(companies-ui): asset, license and contract forms pick a company, vendor and site"
```

---
### Task 16: Company filters on lists and reports

**Spec, *List filters*:** tickets, projects, assets, licenses, contracts and the reports get a Company filter when `multiCompany`. Each list also reads `?companyId=` from the URL, so the company page's "See all" links open it pre-filtered (Task 11).

**Files:**
- Modify: `frontend/src/pages/Tickets.jsx`, `Projects.jsx`, `Assets.jsx`, `assets/Licenses.jsx`, `assets/Contracts.jsx`, `Reports.jsx`, `reports/*.jsx` (18 report components), `reports/CustomReportBuilder.jsx`
- Test: `backend/test/smoke/companies.filters.smoke.js`

**Interfaces:**
- Consumes: the `?companyId=` list filters (plan 2a); report `?companyId=` and custom-report `filters.companyId` (Task 7); `CompanyFilter`.

- [ ] **Step 1: Write the failing smoke test**

```js
const { resetData, closeDb, models } = require('../integration/helpers');
const { makeAdmin, makeCompany, makeTicket } = require('../integration/fixtures');
const { startSmoke } = require('./harness');

// Plan 2b task 16.

let smoke;
let admin;
let acme;
beforeAll(async () => { smoke = await startSmoke(); });
afterAll(async () => { await smoke.stop(); await closeDb(); });
beforeEach(async () => {
  await resetData();
  admin = await makeAdmin();
  acme = await makeCompany(admin, { name: 'Acme' });
  const internal = await models.Company.findOne({ where: { isInternal: true } });
  const ann = await models.Contact.create({ firstName: 'Ann', displayName: 'Ann', companyId: acme.id });
  const bob = await models.Contact.create({ firstName: 'Bob', displayName: 'Bob', companyId: internal.id });
  await makeTicket(admin.agent, { title: 'ACME ticket', contactId: ann.id });
  await makeTicket(admin.agent, { title: 'HOME ticket', contactId: bob.id });
});

it('the ticket list filters by company, and opens pre-filtered from ?companyId=', async () => {
  const page = await smoke.pageAs('admin');
  await page.goto('/tickets');
  await page.getByText('HOME ticket').first().waitFor();
  await page.getByLabel('Company').selectOption(String(acme.id));
  await page.getByText('HOME ticket').first().waitFor({ state: 'detached' });
  await page.getByText('ACME ticket').first().waitFor();
  await page.goto(`/tickets?companyId=${acme.id}`);
  await page.getByText('ACME ticket').first().waitFor();
  expect(await page.getByText('HOME ticket').count()).toBe(0);
});

it('a report filters by company', async () => {
  const page = await smoke.pageAs('admin');
  await page.goto('/reports');
  await page.getByLabel('Company').selectOption(String(acme.id));
  await page.getByText('ACME ticket').first().waitFor();
  expect(await page.getByText('HOME ticket').count()).toBe(0);
});
```

The reports page opens on its first report. If that isn't ticket volume (which lists ticket titles), click through to it first: `grep -n "endpoint: 'ticket-volume'" frontend/src/pages/Reports.jsx` shows the report's key and label, so you know what to click.

- [ ] **Step 2: Run it and watch it fail**

Run: `cd backend && npm run test:smoke -- companies.filters.smoke.js`
Expected: FAIL, because no `Company` filter exists.

- [ ] **Step 3: The five list pages**

In each of `Tickets.jsx`, `Projects.jsx`, `Assets.jsx`, `assets/Licenses.jsx` and `assets/Contracts.jsx`:
- Import `CompanyFilter`, and `useSearchParams` from `react-router-dom` if it isn't imported.
- Add `const [searchParams] = useSearchParams();` if the page doesn't have one, then `const [companyId, setCompanyId] = useState(searchParams.get('companyId') || '');`.
- Add `companyId` to the page's `filterKey` array, and to the dependency array of the effect or `useCallback` that builds the request params (`filterParams` in Tickets, the load effect in the others).
- Where the params are built, add `if (companyId) params.companyId = companyId;`.
- In the filter bar, right after the department filter `<select>` (Tickets has no department filter: put it after the priority `<select>`), render `<CompanyFilter value={companyId} onChange={setCompanyId} style={{ backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: TEXT }} />`.

- [ ] **Step 4: Reports**

- **The 18 report components:** add the company param next to the department one with one command:

  ```bash
  cd frontend/src/pages/reports && for f in *Report.jsx; do
    sed -i 's/^\(\s*\)if (filters.departmentId) params.departmentId = filters.departmentId;/&\n\1if (filters.companyId) params.companyId = filters.companyId;/' "$f"
  done
  grep -c "filters.companyId" *Report.jsx
  ```

  Expected: every file with a `filters.departmentId` line now has a `filters.companyId` line. Check that `grep -l "filters.departmentId" *Report.jsx` and `grep -l "filters.companyId" *Report.jsx` list the same files.

- **`Reports.jsx`:**
  - Add `const [companyId, setCompanyId] = useState('');`.
  - Add `companyId` to the `filters` memo (`companyId,`) and to its dependency array.
  - In the export, add `if (filters.companyId) params.companyId = filters.companyId;`.
  - Save it in saved views: add `companyId` to the saved `filters` object, and restore it with `setCompanyId(f.companyId || '');`.
  - Render `<CompanyFilter value={companyId} onChange={setCompanyId} className="input h-9" />` next to the department `<select>`. It isn't gated by `canViewAll`: the fence already limits it to reachable companies.
- **`CustomReportBuilder.jsx`:**
  - Add `companyId: ''` to `EMPTY_FILTERS`.
  - In `filtersToPayload`, add `if (filters.companyId) payload.companyId = filters.companyId;`.
  - Render `<CompanyFilter value={filters.companyId} onChange={(v) => setFilters((f) => ({ ...f, companyId: v }))} className="input" />` in its filter row, next to the department filter.

- [ ] **Step 5: Run it and watch it pass**

Run: `cd backend && npm run test:smoke -- companies.filters.smoke.js companies.shell.smoke.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src backend/test/smoke/companies.filters.smoke.js
git commit -m "feat(companies-ui): company filters on ticket, project, asset, license, contract lists and reports"
```

---

### Task 17: Company access on users and roles

**Spec, *Users and roles*:** a "Company access" control ("All companies" or a chosen list), shown to holders of `companies.manage_access`.

**Files:**
- Create: `frontend/src/components/companies/CompanyAccessPanel.jsx`
- Modify: `frontend/src/pages/UserDetail.jsx`, `frontend/src/pages/RoleEditor.jsx`
- Test: `backend/test/smoke/companies.access.smoke.js`

**Interfaces:**
- Consumes: `GET/PUT /users/:id/company-access` → `{ access: { allCompanies, companyIds, companies, unfenceable } }`; `GET/PUT /roles/:id/company-access` → `{ access: { companyIds, companies } }`. The server keeps companies the viewer can't reach, and only System Administrators can change "all companies" (plan 2a review R6).
- Produces: `<CompanyAccessPanel userId? roleId? />`.

- [ ] **Step 1: Write the failing smoke test**

```js
const { resetData, closeDb, models } = require('../integration/helpers');
const { makeAdmin, makeCompany, makeTech, makeDept } = require('../integration/fixtures');
const { startSmoke } = require('./harness');

// Plan 2b task 17.

let smoke;
beforeAll(async () => { smoke = await startSmoke(); });
afterAll(async () => { await smoke.stop(); await closeDb(); });
beforeEach(resetData);

it('an admin limits a technician to chosen companies', async () => {
  const admin = await makeAdmin();
  const dept = await makeDept(admin, 'Service Desk', 'SD');
  const acme = await makeCompany(admin, { name: 'Acme' });
  const tech = await makeTech('tina', dept.id);
  const page = await smoke.pageAs('admin');
  await page.goto(`/admin/users/${tech.user.id}`);
  await page.getByRole('button', { name: 'Roles & Permissions' }).click();
  await page.getByLabel('Chosen companies').check();
  await page.getByLabel('Acme').check();
  await page.getByRole('button', { name: 'Save company access' }).click();
  await page.getByText('Company access saved').waitFor();
  const user = await models.User.findByPk(tech.user.id);
  const rows = await models.UserCompanyAccess.findAll({ where: { userId: tech.user.id } });
  expect([user.allCompanies, rows.map((r) => r.companyId)]).toEqual([false, [acme.id]]);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd backend && npm run test:smoke -- companies.access.smoke.js`
Expected: FAIL. There's no "Chosen companies" control.

- [ ] **Step 3: `CompanyAccessPanel.jsx`**

```jsx
import { useEffect, useState } from 'react';
import api, { errMessage } from '../../api/api';
import { useAuth } from '../../context/AuthContext';
import { useCompanySummary } from '../../context/CompanyContext';
import { useCompanyOptions } from '../../hooks/useCompanyOptions';

// "Company access" on a user or a role (spec: Users and roles). A user
// reaches every company or a chosen list; a role adds its list to everyone
// holding it. Only companies the viewer can reach are listed; the server
// keeps the rest when saving (plan 2a review R6).
export default function CompanyAccessPanel({ userId, roleId }) {
  const { hasPermission } = useAuth();
  const { multiCompany } = useCompanySummary();
  const companies = useCompanyOptions();
  const allowed = hasPermission('companies.manage_access') && multiCompany;
  const url = userId ? `/users/${userId}/company-access` : `/roles/${roleId}/company-access`;
  const [access, setAccess] = useState(null);
  const [all, setAll] = useState(true);
  const [chosen, setChosen] = useState([]);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!allowed) return;
    api.get(url).then(({ data }) => {
      setAccess(data.access);
      setAll(userId ? data.access.allCompanies : false);
      setChosen(data.access.companyIds);
    }).catch((err) => setError(errMessage(err)));
  }, [allowed, url, userId]);

  if (!allowed) return null;
  if (!access) return error ? <p className="text-sm text-red-600">{error}</p> : null;
  if (access.unfenceable) {
    return <div className="card p-4 text-sm">System Administrators always reach every company.</div>;
  }
  const toggle = (id) => setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  const save = async () => {
    setError('');
    setSaved(false);
    try {
      const body = userId ? { allCompanies: all, companyIds: all ? [] : chosen } : { companyIds: chosen };
      const { data } = await api.put(url, body);
      setAccess(data.access);
      setChosen(data.access.companyIds);
      setSaved(true);
    } catch (err) {
      setError(errMessage(err));
    }
  };

  return (
    <div className="card mt-5 space-y-3 p-5">
      <p className="eyebrow">Company access</p>
      {roleId && <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Everyone with this role also reaches these companies.</p>}
      {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      {userId && (
        <div className="flex gap-6 text-sm">
          <label className="flex items-center gap-2"><input type="radio" name="company-access" checked={all} onChange={() => setAll(true)} /> All companies</label>
          <label className="flex items-center gap-2"><input type="radio" name="company-access" checked={!all} onChange={() => setAll(false)} /> Chosen companies</label>
        </div>
      )}
      <div className="grid grid-cols-1 gap-1 text-sm sm:grid-cols-2">
        {companies.map((c) => (
          <label key={c.id} className="flex items-center gap-2">
            <input type="checkbox" disabled={userId && all} checked={chosen.includes(c.id)} onChange={() => toggle(c.id)} />
            {c.name}
          </label>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <button type="button" className="btn-primary" onClick={save}>Save company access</button>
        {saved && <span className="text-sm" style={{ color: 'var(--color-success)' }}>Company access saved</span>}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Place it**

- **`UserDetail.jsx`:** import `CompanyAccessPanel`, and change `{tab === 'access' && <RolesPermissionsTab userId={id} onPermissionsChanged={refreshPermissions} />}` to:

  ```jsx
  {tab === 'access' && (
    <>
      <RolesPermissionsTab userId={id} onPermissionsChanged={refreshPermissions} />
      <CompanyAccessPanel userId={id} />
    </>
  )}
  ```

- **`RoleEditor.jsx`:** import `CompanyAccessPanel`, and render `{!isNew && <CompanyAccessPanel roleId={id} />}` as the last child of the page's outer `<div>` (after the permissions section).

- [ ] **Step 5: Run it and watch it pass**

Run: `cd backend && npm run test:smoke -- companies.access.smoke.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src backend/test/smoke/companies.access.smoke.js
git commit -m "feat(companies-ui): company access control on users and roles"
```

---

### Task 18: Settings → Departments grouped by company; import's Company column

**Files:**
- Modify: `frontend/src/pages/AdminDepartments.jsx`, `frontend/src/components/ImportContactsModal.jsx`
- Test: `backend/test/smoke/companies.departments.smoke.js`

**Interfaces:**
- Consumes: `GET /departments` (each row has `companyId` and `company: { id, name }`); `POST /departments { …, companyId }`; the import's `company` mapping field (Task 6); `CompanyPicker`, `useCompanyOptions`, `useCompanySummary`.

- [ ] **Step 1: Write the failing smoke test**

```js
const { resetData, closeDb, models } = require('../integration/helpers');
const { makeAdmin, makeCompany, makeDept } = require('../integration/fixtures');
const { startSmoke } = require('./harness');

// Plan 2b task 18.

let smoke;
beforeAll(async () => { smoke = await startSmoke(); });
afterAll(async () => { await smoke.stop(); await closeDb(); });
beforeEach(resetData);

it('departments are grouped by company, and a client department can be created there', async () => {
  const admin = await makeAdmin();
  await makeDept(admin, 'Service Desk', 'SD');
  const acme = await makeCompany(admin, { name: 'Acme' });
  await models.Department.create({ name: 'Acme HR', companyId: acme.id });
  const page = await smoke.pageAs('admin');
  await page.goto('/admin/departments');
  await page.getByText('Acme', { exact: true }).waitFor();
  await page.getByRole('button', { name: '+ New department' }).click();
  await page.locator('#company-picker').selectOption(String(acme.id));
  await page.locator('input').first().fill('Acme Ops');
  await page.getByRole('button', { name: 'Create' }).click();
  await page.getByText('Acme Ops').waitFor();
  expect((await models.Department.findOne({ where: { name: 'Acme Ops' } })).companyId).toBe(acme.id);
});

it('the import preview flags a Company the file names but PRISM doesn\'t know', async () => {
  const admin = await makeAdmin();
  await makeCompany(admin, { name: 'Acme' });
  const page = await smoke.pageAs('admin');
  await page.goto('/contacts');
  await page.getByRole('button', { name: /Import/ }).click();
  await page.locator('input[type=file]').setInputFiles({
    name: 'contacts.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('First name,Email,Company\nAnn,ann@x.test,Acme\nNed,ned@x.test,Nope Inc\n'),
  });
  await page.getByRole('button', { name: /Next|Preview|Validate/ }).first().click();
  await page.getByText('"Nope Inc" does not match any company').waitFor();
});
```

Match the import modal's button labels to the real ones (`grep -n "<button" frontend/src/components/ImportContactsModal.jsx`). Use the button that moves from mapping to the preview.

- [ ] **Step 2: Run it and watch it fail**

Run: `cd backend && npm run test:smoke -- companies.departments.smoke.js`
Expected: FAIL. There's no `Acme` group heading and no company picker. The import preview never flags companies, because the column isn't mapped and so the server never sees it.

- [ ] **Step 3: `AdminDepartments.jsx`**

- Imports: `Fragment` from `react`, `CompanyPicker`, `useCompanySummary`, `useCompanyOptions`.
- In the component:

  ```js
    const { multiCompany } = useCompanySummary();
    const companies = useCompanyOptions();
    const internalId = companies.find((c) => c.isInternal)?.id;
    // Grouped by company while company UI is on (spec: Settings → Departments).
    const sorted = multiCompany
      ? [...departments].sort((a, b) => (a.company?.name || '').localeCompare(b.company?.name || '') || a.name.localeCompare(b.name))
      : departments;
    const isInternalDept = (d) => !multiCompany || d.companyId === internalId;
  ```

- Add `companyId: ''` to `EMPTY`.
- In the form, render `{editingId === null && <CompanyPicker value={form.companyId} onChange={(v) => setForm((f) => ({ ...f, companyId: v }))} />}` above the name field.
- The short-code field: make it required only for internal departments. Compute `const formIsInternal = !multiCompany || !form.companyId || Number(form.companyId) === internalId;`, then use `required={formIsInternal}`, and show the `*` only when `formIsInternal`.
- In `submit`, add `companyId: form.companyId || undefined` to the payload on create only. The edit PATCH ignores it.
- Replace `{departments.map((d) => (` / `<div key={d.id} …>` with:

  ```jsx
  {sorted.map((d, i) => (
    <Fragment key={d.id}>
      {multiCompany && d.companyId !== sorted[i - 1]?.companyId && (
        <p className="eyebrow px-5 py-2" style={{ backgroundColor: 'var(--color-hover)' }}>{d.company?.name}</p>
      )}
      <div className="flex items-center justify-between px-5 py-3">
  ```

  and close the `Fragment` after the row's closing `</div>`.
- The "No short code" badge shows only for internal departments: wrap its ternary in `isInternalDept(d) ? (…existing ternary…) : null`.

- [ ] **Step 4: `ImportContactsModal.jsx`**

- Add `{ value: 'company', label: 'Company' }` to `FIELD_OPTIONS`, after Department.
- Add `company: ['company', 'organization', 'organisation', 'client', 'account'],` to `FIELD_SYNONYMS`.
- In the preview table, add a `Company` header next to Department and a cell `<td className="px-3 py-2" style={{ color: TEXT }}>{r.record.company || '—'}</td>`.

The preview already lists each row's issues, so the server's `"… does not match any company"` error shows with no further change. Check that the preview renders `r.issues` messages: `grep -n "issues" frontend/src/components/ImportContactsModal.jsx`. If it renders only warnings, render errors the same way.

- [ ] **Step 5: Run it and watch it pass**

Run: `cd backend && npm run test:smoke -- companies.departments.smoke.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src backend/test/smoke/companies.departments.smoke.js
git commit -m "feat(companies-ui): departments grouped by company; import maps a Company column"
```

---

### Task 19: Ship sub-project 2 — whole suite, smoke suite, docs, security review

**Files:**
- Modify: `docs/ROADMAP.md`, `UPGRADING.md`, `docs/superpowers/specs/2026-10-04-client-companies-design.md`

- [ ] **Step 1: Every test, and file sizes**

- Run in the background: `cd backend && npm test > /tmp/2b-full.log 2>&1; grep -E "^(FAIL|Tests:)" /tmp/2b-full.log`.
- Then run the smoke suite: `cd backend && npm run test:smoke`.
- Expected: both green.

Run: `wc -l frontend/src/pages/companies/*.jsx frontend/src/components/companies/*.jsx backend/src/services/companyMerge.js backend/src/services/ticketPeople.js backend/test/integration/companies.*.test.js backend/test/smoke/*.js | sort -n | tail -5`
Expected: nothing over about 800 lines.

- [ ] **Step 2: Spec write-backs**

In the spec:
- **Decisions table:** add rows for this plan's user decisions:
  - vendor-only companies are shared in vendor pickers;
  - assignees and watchers must reach the ticket's company;
  - screens are verified by a browser smoke suite.
- **Integrity rules:** add "An assignee or watcher can reach the ticket's company (assignments made before a move stay)."
- **Testing:** add "Browser smoke tests (`npm run test:smoke`) cover each screen against the real API; not in CI yet."
- **Security notes:**
  - add S11 (fixed in plan 2a's final pass);
  - add the remaining known oracle: unique values (contact email, company name, domain) answer 409 whether or not the clash is visible. Fixing it fully needs per-company uniqueness, which conflicts with inbound-email matching. Recorded, not fixed.

- [ ] **Step 3: `ROADMAP.md` and `UPGRADING.md`**

`ROADMAP.md`, sub-project 2: set Status to **Shipped**, and add "[plan 2b](superpowers/plans/2026-10-05-client-companies-screens.md)" next to plan 2a.

`UPGRADING.md` → Unreleased → the "Client companies (backend)" section: rename it **Client companies**, and append:

```markdown
Once you add a client company, PRISM shows a Companies tab, company pickers
on contacts, tickets, projects and assets, and company filters on lists and
reports. Settings → Companies is always there, also for managing vendors.

- Assignees and watchers must be able to see a ticket's company. **Changed
  response:** assigning one who can't returns `400 VALIDATION_ERROR`.
- A new ticket without a department now takes its contact's department.
- A company can't stop being a client while it still has contacts, tickets
  or other records (`409 COMPANY_IN_USE`).
- The CSV contact import takes an optional "Company" column.
- Old free-text vendor columns stay for one more release; vendor companies
  now fill them.
```

- [ ] **Step 4: Security review**

Before the final review, dispatch a fresh security reviewer (most capable model) over the plan's whole range, with the same brief as plan 2a's Task 12 security review:
- access control across every route, including untouched ones;
- privilege escalation;
- mass assignment;
- id parsing;
- injection;
- XSS through company, site and vendor names rendered in the new screens.

Fix every Critical or Important finding test-first. This sub-project changes the core of authorization (spec, *Done when*).

- [ ] **Step 5: Commit**

```bash
git add docs/ROADMAP.md UPGRADING.md docs/superpowers/specs/2026-10-04-client-companies-design.md
git commit -m "docs: client companies shipped (plan 2b) — screens, vendors, merge, import"
```

Push only when the user says so.
