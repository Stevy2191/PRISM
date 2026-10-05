# One Work Model — Split and Guard (plan 3a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the oversized ticket, project and report files into small, single-purpose modules without changing any behaviour, guarded by browser smoke tests, so plans 3b and 3c can change the model on files that fit in one reading.

**Architecture:** Pure refactor. Each backend controller becomes a folder of modules plus a one-line index that re-exports exactly the old names, so routes, `customReportEngine` and tests keep importing the same paths. Each large page becomes a folder: a shell component plus one file per panel, tab or toolbar piece. Code moves verbatim; only imports, exports and the wiring between files change.

**Tech Stack:** Node 24.9+, Express 4, Sequelize 6 (CommonJS); React 18 + Vite 6. Jest 30 integration tests, plus the browser smoke suite from plan 2b (`npm run test:smoke`). No new dependencies.

**Spec:** [`docs/superpowers/specs/2026-10-05-one-work-model-design.md`](../specs/2026-10-05-one-work-model-design.md), sections *Code structure* and *Plans* (3a). Read it first.

## Global Constraints

- **No behaviour change.** Every existing test, integration and smoke, passes unchanged after every task. A test that has to change means the refactor changed behaviour: undo the change, don't edit the test.
- **Code moves verbatim.** Don't rename functions, reorder logic or "improve" code while moving it; plans 3b and 3c do that. The only edits allowed are imports, exports, and passing values that used to be in scope as props or parameters.
- **Old import paths keep working:**
  - `require('../controllers/ticketsController')`, `projectsController` and `reportsController` keep exporting exactly the same names, which you check by comparing key lists;
  - `App.jsx` routes keep the same URLs.
- **Size:** after this plan, no file in `backend/src/controllers/{tickets,projects,reports}/` or `frontend/src/pages/{tickets,projects}/` is over about 800 lines; aim for under 400.
- **Tests:**
  - `cd backend && npm test` runs the whole suite (about 11 minutes; run it in the background);
  - `npm run test:smoke` builds the frontend and runs the browser suite;
  - never run the two at once, because they share the test database.
- **Commits:** at least one per task. End every message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Push only when the user says so.

## Review Focus

1. **A value that was in scope in the big file but not passed to the moved component.** For example, a style constant, a helper such as `formatMinutes`, or the page's `user`. In React this renders "undefined" or crashes only when that tab opens. *(Task 1's smoke tests open every ticket and project tab.)*
2. **A module-level variable shared between handlers that ends up duplicated.** For example, a cache or a `Map` in two files, so one module's writes are invisible to the other. *(Task 2–4 step: grep each module for top-level `let`/`new Map`, then check that no state moved into two places.)*
3. **A helper exported from a controller that another module imported by name.** `customReportEngine` uses `reportsController`'s scope helpers. *(Tasks 2–4: export-key comparison.)*
4. **Circular requires introduced by the new `shared.js` files.** They show up as `undefined` at call time, not at load time. *(Tasks 2–4: the full suite, plus a `node -e` load of every new module.)*
5. **Mobile and desktop variants of the same page.** `Tickets.jsx` renders both a card list and a table. *(Task 7 smoke: both the board and the table render.)*

---

## File map

**Create (backend)**
- `controllers/tickets/`:
  - `shared.js`, `core.js`, `comments.js`, `attachments.js`, `time.js`;
  - `relations.js`, `csat.js`, `watchers.js`, `tasks.js`, `fields.js`, `activity.js`.
- `controllers/projects/`:
  - `shared.js`, `core.js`, `tasks.js`, `time.js`, `expenses.js`;
  - `materials.js`, `members.js`, `files.js`, `activity.js`.
- `controllers/reports/`:
  - `shared.js`, `tickets.js`, `team.js`, `sla.js`, `time.js`, `projects.js`;
  - `contacts.js`, `happiness.js`, `assets.js`, `licenses.js`.

**Modify (backend):** `controllers/ticketsController.js`, `projectsController.js` and `reportsController.js` become re-export indexes.

**Create (frontend)**
- `pages/tickets/`:
  - `theme.js`;
  - `TicketDetail.jsx`, plus `detail/*.jsx` (one per panel or tab);
  - `Tickets.jsx`, plus `list/*.jsx`;
  - `TicketNew.jsx`, plus `new/*.jsx`.
- `pages/projects/`: `theme.js`, `ProjectDetail.jsx`, plus `detail/*.jsx`.

**Delete:** `pages/TicketDetail.jsx`, `pages/ProjectDetail.jsx`, `pages/Tickets.jsx` and `pages/TicketNew.jsx`, after their content moves. `App.jsx`'s imports point at the new paths.

**Test:** `backend/test/smoke/work.tickets.smoke.js`, `work.projects.smoke.js`, `work.list.smoke.js`.

---

### Task 1: Smoke guard for the ticket and project pages

These are characterization tests. They pin today's screens so the splits can't quietly break a tab. **They pass before any refactor; that's expected and correct.** Their job is to fail if Tasks 5–7 break something.

**Files:**
- Create: `backend/test/smoke/work.tickets.smoke.js`, `backend/test/smoke/work.projects.smoke.js`, `backend/test/smoke/work.list.smoke.js`

**Interfaces:**
- Consumes: `startSmoke()` (`test/smoke/harness.js`); fixtures `makeWorld`, `makeTech`, `makeTicket`, `makeProject`, `makeTask`, `makeSubtask`, `API`, `expectOk`.

- [ ] **Step 1: Write the ticket page guard**

`backend/test/smoke/work.tickets.smoke.js`:

```js
const { resetData, closeDb } = require('../integration/helpers');
const {
  API, expectOk, makeWorld, makeTech, makeTicket,
} = require('../integration/fixtures');
const { startSmoke } = require('./harness');

// Plan 3a guard: every tab of the ticket page renders its seeded content,
// and the quick actions still work. Characterization tests — they pass
// before the split and must pass after it.

const shown = (page, text) => page.getByText(text).filter({ visible: true }).first();

let smoke;
let w;
let other;
let ticket;
beforeAll(async () => {
  smoke = await startSmoke();
  await resetData();
  w = await makeWorld();
  const tina = await makeTech('tina', w.deptA.id);
  ticket = await makeTicket(w.admin.agent, {
    title: 'Printer offline', contactId: w.contact.id, assigneeId: tina.user.id, description: 'It will not print',
  });
  other = await makeTicket(w.admin.agent, { title: 'Toner order', contactId: w.contact.id });
  const a = w.admin.agent;
  expectOk(await a.post(`${API}/tickets/${ticket.id}/comments`).send({ body: 'Seeded reply text', type: 'reply' }), 201);
  expectOk(await a.post(`${API}/tickets/${ticket.id}/time`).send({ minutes: 45, note: 'Seeded time note' }), 201);
  expectOk(await a.post(`${API}/tickets/${ticket.id}/tasks`).send({ description: 'Seeded checklist item' }), 201);
  expectOk(await a.post(`${API}/tickets/${ticket.id}/relations`).send({ relatedTicketId: other.id, relationType: 'related' }), 201);
});
afterAll(async () => { await smoke.stop(); await closeDb(); });

it('the header and conversation render', async () => {
  const page = await smoke.pageAs('admin');
  await page.goto(`/tickets/${ticket.id}`);
  await shown(page, 'Printer offline').waitFor();
  await shown(page, 'Seeded reply text').waitFor();
});

it('every tab opens and shows its content', async () => {
  const page = await smoke.pageAs('admin');
  await page.goto(`/tickets/${ticket.id}`);
  const tab = (name) => page.getByRole('button', { name, exact: true }).first().click();
  await tab('Time Entries');
  await shown(page, 'Seeded time note').waitFor();
  await tab('Tasks');
  await shown(page, 'Seeded checklist item').waitFor();
  await tab('Relationships');
  await shown(page, 'Toner order').waitFor();
  await tab('Resolution');
  await page.getByPlaceholder('Describe what resolved this issue...').waitFor();
  await tab('Attachments');
  await tab('Activity');
  await shown(page, 'Created').waitFor();
});

it('a task can be added from the Tasks tab', async () => {
  const page = await smoke.pageAs('admin');
  await page.goto(`/tickets/${ticket.id}`);
  await page.getByRole('button', { name: 'Tasks', exact: true }).first().click();
  const input = page.getByPlaceholder('Add a task and press Enter…');
  await input.fill('Added from the guard');
  await input.press('Enter');
  await shown(page, 'Added from the guard').waitFor();
});
```

Check the tab buttons' role, and the Activity tab's "Created" wording, before relying on them:
- **Tabs:** `grep -n "TABS.map" -A6 frontend/src/pages/TicketDetail.jsx`. If they aren't `<button>`s, use `page.getByText(name, { exact: true })`.
- **Activity:** check the action label map near `ACTIVITY_FIELD_LABEL`, and use the label a `created` entry renders.

- [ ] **Step 2: Write the project page guard**

`backend/test/smoke/work.projects.smoke.js`:

```js
const { resetData, closeDb } = require('../integration/helpers');
const {
  API, expectOk, makeWorld, makeProject, makeTask, makeSubtask,
} = require('../integration/fixtures');
const { startSmoke } = require('./harness');

// Plan 3a guard for the project page: every tab renders its seeded content.

const shown = (page, text) => page.getByText(text).filter({ visible: true }).first();

let smoke;
let project;
beforeAll(async () => {
  smoke = await startSmoke();
  await resetData();
  const w = await makeWorld();
  const a = w.admin.agent;
  project = await makeProject(a, { name: 'Office move', ownerDepartmentId: w.deptA.id });
  const task = await makeTask(a, project.id, { title: 'Seeded project task' });
  await makeSubtask(a, project.id, task.id, { title: 'Seeded subtask' });
  expectOk(await a.post(`${API}/projects/${project.id}/time-entries`).send({
    startTime: '2026-03-10T13:00:00Z', endTime: '2026-03-10T14:00:00Z', entryDate: '2026-03-10', description: 'Seeded project time',
  }), 201);
  expectOk(await a.post(`${API}/projects/${project.id}/expenses`).send({ description: 'Seeded expense', amount: 12 }), 201);
  expectOk(await a.post(`${API}/projects/${project.id}/materials`).send({ itemName: 'Seeded material', quantity: 1, unitCost: 3 }), 201);
});
afterAll(async () => { await smoke.stop(); await closeDb(); });

it('the header and the tasks tab render', async () => {
  const page = await smoke.pageAs('admin');
  await page.goto(`/projects/${project.id}`);
  await shown(page, 'Office move').waitFor();
  await shown(page, 'Seeded project task').waitFor();
});

it('every tab opens and shows its content', async () => {
  const page = await smoke.pageAs('admin');
  await page.goto(`/projects/${project.id}`);
  const tab = (name) => page.getByRole('button', { name, exact: true }).first().click();
  await tab('Time Entries');
  await shown(page, 'Seeded project time').waitFor();
  await tab('Expenses');
  await shown(page, 'Seeded expense').waitFor();
  await tab('Materials');
  await shown(page, 'Seeded material').waitFor();
  await tab('People');
  await shown(page, 'Test admin').waitFor();
  await tab('Files');
  await tab('Activity');
});

it('a task opens its detail with its subtask', async () => {
  const page = await smoke.pageAs('admin');
  await page.goto(`/projects/${project.id}`);
  await shown(page, 'Seeded project task').click();
  await shown(page, 'Seeded subtask').waitFor();
});
```

The People tab lists project members. If the admin who created the project isn't shown as a member, assert the "+ Add person" button instead.

- [ ] **Step 3: Write the ticket list and new-ticket guard**

`backend/test/smoke/work.list.smoke.js`:

```js
const { resetData, closeDb } = require('../integration/helpers');
const { makeWorld, makeTicket } = require('../integration/fixtures');
const { startSmoke } = require('./harness');

// Plan 3a guard for the ticket list (table and board) and the new-ticket form.

const shown = (page, text) => page.getByText(text).filter({ visible: true }).first();

let smoke;
let w;
beforeAll(async () => {
  smoke = await startSmoke();
  await resetData();
  w = await makeWorld();
  await makeTicket(w.admin.agent, { title: 'Listed ticket', contactId: w.contact.id });
});
afterAll(async () => { await smoke.stop(); await closeDb(); });

it('the table and the board both show the ticket', async () => {
  const page = await smoke.pageAs('admin');
  await page.goto('/tickets');
  await shown(page, 'Listed ticket').waitFor();
  await page.getByRole('button', { name: /Board/ }).filter({ visible: true }).first().click();
  await shown(page, 'Listed ticket').waitFor();
});

it('selecting a ticket shows the bulk action bar', async () => {
  const page = await smoke.pageAs('admin');
  await page.goto('/tickets');
  await shown(page, 'Listed ticket').waitFor();
  await page.locator('table input[type=checkbox]').nth(1).check();
  await shown(page, '1 selected').waitFor();
});

it('a ticket can be created from the new-ticket form', async () => {
  const page = await smoke.pageAs('admin');
  await page.goto('/tickets/new');
  await page.getByPlaceholder('Search contacts by name or email…').fill('Casey');
  await page.getByRole('button', { name: /Casey/ }).first().click();
  await page.getByLabel(/Title|Subject/).first().fill('Guard-created ticket');
  await page.getByRole('button', { name: /Create ticket|Submit/ }).first().click();
  await page.waitForURL(/\/tickets\/\d+/);
});
```

Check these selectors against the code before trusting them:
- **Board toggle:** `grep -n "setView('board')" -B2 -A6 frontend/src/pages/Tickets.jsx`; use its visible label or aria-label.
- **Bulk bar:** check its "N selected" wording near line 875.
- **Title and submit:** check the new-ticket form's title input (label, placeholder or `name`) and submit button text in `TicketNew.jsx`.

Record every adjusted selector as a ruling.

- [ ] **Step 4: Run the guards; they must pass now**

Run: `cd backend && npm run test:smoke -- work.tickets.smoke.js work.projects.smoke.js work.list.smoke.js`
Expected: PASS. These are characterization tests, so they pass against today's code. A failure here means the selector is wrong, not the app: fix the selector and record it as a ruling.

- [ ] **Step 5: Commit**

```bash
git add backend/test/smoke/work.*.smoke.js
git commit -m "test(smoke): guard the ticket and project pages before the split"
```

---

### Task 2: Split `ticketsController.js`

**Files:**
- Create: `backend/src/controllers/tickets/`:
  - `shared.js`, `core.js`, `comments.js`, `attachments.js`, `time.js`;
  - `relations.js`, `csat.js`, `watchers.js`, `tasks.js`, `fields.js`, `activity.js`.
- Modify: `backend/src/controllers/ticketsController.js`, which becomes the index.

**Interfaces:**
- Produces: `require('./controllers/ticketsController')` exports exactly the same keys as before. No other file changes.

**What goes where** (move each definition verbatim, with its comment block):

| Module | Definitions |
|---|---|
| `shared.js` | `userAttrs`, `ticketInclude`, `syncCustomFieldValues`, `buildCustomFieldsObject`, `withCustomFields`, `canLogForOthers`, plus any other top-level helper or constant used by more than one module below |
| `core.js` | `SORTABLE_COLUMNS`, `buildTicketListWhere`, `resolveCustomFieldSort`, `fetchTicketPage`, `timeLoggedByTicket`, `list`, `board`, `create`, `get`, `update`, `remove` |
| `comments.js` | `COMMENT_TYPES`, `listComments`, `sendReplyEmailToContact`, `createComment`, `updateComment`, `removeComment` |
| `attachments.js` | `listAttachments`, `createAttachment`, `downloadAttachment`, `removeAttachment` |
| `time.js` | `listTime`, `createTime`, `removeTime` |
| `relations.js` | `relTicketAttrs`, `listRelations`, `createRelation`, `removeRelation` |
| `csat.js` | `getCsat`, `submitCsat` |
| `watchers.js` | `listWatchers`, `addWatcher`, `removeWatcher` |
| `tasks.js` | `listTasks`, `createTask`, `updateTask` |
| `fields.js` | `getCustomFieldValues`, `updateCustomFieldValues` |
| `activity.js` | `listActivity`, `generateReport` |

- [ ] **Step 1: Record the current export keys**

Run: `cd backend && node -e "console.log(Object.keys(require('./src/controllers/ticketsController')).sort().join('\n'))" > /tmp/tickets-keys.before`
Expected: the file lists every exported handler, one per line.

- [ ] **Step 2: Create the modules**

Each module:
- starts with a one-line comment naming its job (e.g. `// Ticket comments: list, create (reply email), edit, delete.`);
- requires only what its moved code uses: models, `ApiError`/`asyncHandler`, services, and shared helpers via `require('./shared')`;
- ends with `module.exports = { …its handlers… };`.

`shared.js` exports every helper the others need. Paths change by one level (`../models` becomes `../../models`, and so on).

- **Missing requires:** to see which imports a module needs, use each identifier the moved code references that isn't defined in it. Running the module (Step 4) fails with `ReferenceError` at call time, not at load, so also grep each new module for every name in the old file's top-level `require` destructures.
- **Module-level state (Review Focus 2):** run `grep -nE "^(let|var) |new Map\(|new Set\(" backend/src/controllers/ticketsController.js` before moving. Any such state used by more than one handler goes in `shared.js`, exported once.

- [ ] **Step 3: Turn `ticketsController.js` into the index**

```js
// Tickets controller index. The handlers live in ./tickets/, one module per
// area; this file keeps the original import path and export names.
module.exports = {
  ...require('./tickets/core'),
  ...require('./tickets/comments'),
  ...require('./tickets/attachments'),
  ...require('./tickets/time'),
  ...require('./tickets/relations'),
  ...require('./tickets/csat'),
  ...require('./tickets/watchers'),
  ...require('./tickets/tasks'),
  ...require('./tickets/fields'),
  ...require('./tickets/activity'),
};
```

If the old file also exported helpers (check `/tmp/tickets-keys.before` for non-handler names, such as `ticketInclude`), add `...require('./tickets/shared')` or export them explicitly, so the key list matches.

- [ ] **Step 4: Check the exports, the loads and the sizes**

Run:

```bash
cd backend
node -e "console.log(Object.keys(require('./src/controllers/ticketsController')).sort().join('\n'))" > /tmp/tickets-keys.after
diff /tmp/tickets-keys.before /tmp/tickets-keys.after && echo SAME-KEYS
for f in src/controllers/tickets/*.js; do node -e "require('./$f')" || echo "LOAD FAIL $f"; done
wc -l src/controllers/tickets/*.js src/controllers/ticketsController.js | sort -n | tail -3
```

Expected: `SAME-KEYS`, no `LOAD FAIL`, and the largest module under about 800 lines (`core.js` is the biggest).

- [ ] **Step 5: The full suite, unchanged**

Run (in the background): `cd backend && npm test > /tmp/3a-t2.log 2>&1; grep -E "^(FAIL|Tests:)" /tmp/3a-t2.log`
Expected: every test passes, the same count as before this task. A failure means a missing require or moved state: fix the module, never the test.

- [ ] **Step 6: Commit**

```bash
git add backend/src/controllers/ticketsController.js backend/src/controllers/tickets
git commit -m "refactor(tickets): split the tickets controller into one module per area"
```

---

### Task 3: Split `projectsController.js`

**Files:**
- Create: `backend/src/controllers/projects/`:
  - `shared.js`, `core.js`, `tasks.js`, `time.js`, `expenses.js`;
  - `materials.js`, `members.js`, `files.js`, `activity.js`.
- Modify: `backend/src/controllers/projectsController.js`, which becomes the index.

**What goes where:**

| Module | Definitions |
|---|---|
| `shared.js` | `userAttrs`, `projectInclude`, `canLogForOthers`, `buildProjectStats`, `getProjectWithDetail`, `taskIncludeFor`, and any other helper used by more than one module |
| `core.js` | `buildProjectListWhere`, `list`, `listTags`, `create`, `get`, `update`, `remove`, `getStats` |
| `tasks.js` | `listTasks`, `createTask`, `updateTask`, `removeTask`, `reorderTasks`, `renumberTask`, `createSubtask`, `updateSubtask`, `renumberSubtask`, `removeSubtask` |
| `time.js` | `timeEntryInclude`, `listTimeEntries`, `createTimeEntry`, `updateTimeEntry`, `removeTimeEntry` |
| `expenses.js` | `expenseInclude`, `listExpenses`, `createExpense`, `updateExpense`, `removeExpense` |
| `materials.js` | `materialInclude`, `listMaterials`, `createMaterial`, `updateMaterial`, `removeMaterial` |
| `members.js` | `listMembers`, `addMember`, `removeMember` |
| `files.js` | `listFiles`, `uploadFile`, `downloadFile`, `removeFile` |
| `activity.js` | `listActivity`, `generateReport` |

- [ ] **Step 1: Record the export keys**

Run: `cd backend && node -e "console.log(Object.keys(require('./src/controllers/projectsController')).sort().join('\n'))" > /tmp/projects-keys.before`

- [ ] **Step 2: Create the modules**

Same rules as Task 2, Step 2: a header comment; requires adjusted by one level; shared helpers from `./shared`; module-level state moved once into `shared.js`.

- [ ] **Step 3: Turn `projectsController.js` into the index**

```js
// Projects controller index. The handlers live in ./projects/, one module
// per area; this file keeps the original import path and export names.
module.exports = {
  ...require('./projects/core'),
  ...require('./projects/tasks'),
  ...require('./projects/time'),
  ...require('./projects/expenses'),
  ...require('./projects/materials'),
  ...require('./projects/members'),
  ...require('./projects/files'),
  ...require('./projects/activity'),
};
```

Add `...require('./projects/shared')` if the old export list includes helpers.

- [ ] **Step 4: Check the exports, the loads and the sizes**

Run:

```bash
cd backend
node -e "console.log(Object.keys(require('./src/controllers/projectsController')).sort().join('\n'))" > /tmp/projects-keys.after
diff /tmp/projects-keys.before /tmp/projects-keys.after && echo SAME-KEYS
for f in src/controllers/projects/*.js; do node -e "require('./$f')" || echo "LOAD FAIL $f"; done
wc -l src/controllers/projects/*.js | sort -n | tail -3
```

Expected: `SAME-KEYS`, no `LOAD FAIL`, and every file under about 800 lines.

- [ ] **Step 5: The full suite, unchanged**

Run (in the background): `cd backend && npm test > /tmp/3a-t3.log 2>&1; grep -E "^(FAIL|Tests:)" /tmp/3a-t3.log`
Expected: all pass, the same count.

- [ ] **Step 6: Commit**

```bash
git add backend/src/controllers/projectsController.js backend/src/controllers/projects
git commit -m "refactor(projects): split the projects controller into one module per area"
```

---

### Task 4: Split `reportsController.js`

**Files:**
- Create: `backend/src/controllers/reports/`:
  - `shared.js`, `tickets.js`, `team.js`, `sla.js`, `time.js`;
  - `projects.js`, `contacts.js`, `happiness.js`, `assets.js`, `licenses.js`.
- Modify: `backend/src/controllers/reportsController.js`, which becomes the index.

**Interfaces:**
- Produces: the same export keys, including the helpers `customReportEngine` uses: `ticketScopeWhere`, `projectScopeWhere`, `contactDeptWhere`, `dateWhere`. It keeps `require('../controllers/reportsController')`.

**What goes where:**

| Module | Definitions |
|---|---|
| `shared.js` | `parseDateRange`, `dateWhere`, `parseDepartmentId`, `resolveReportDeptId`, `parseAssigneeId`, `granularityFor`, `weekStart`, `bucketKey`, `ticketScopeWhere`, `projectScopeWhere`, `contactDeptWhere`, `sendCsv`, `hoursBetween`, `userAttrs`, and the shared includes (`assetInclude`, `licenseInclude`, `contractIncludeReport`, row mappers such as `assetRow`, `licenseRow`, `contractRow`) |
| `tickets.js` | `buildTicketVolumeReport`, `ticketVolume`, `ticketVolumeExport`, `buildTicketTrendsReport`, `ticketTrends`, `ticketTrendsExport`, `ticketsExport` (and its column constant) |
| `team.js` | `buildTeamPerformanceReport`, `teamPerformanceColumns`, `teamPerformance`, `teamPerformanceExport` |
| `sla.js` | `buildSlaComplianceReport`, `slaCompliance`, `slaComplianceExport` |
| `time.js` | `buildTimeBillingReport`, `timeBilling`, `timeBillingExport` |
| `projects.js` | `buildProjectsReport`, `projectsReport`, `projectsReportExport` |
| `contacts.js` | `buildContactsReport`, `contactsReport`, `contactsReportExport` |
| `happiness.js` | `csat`, `buildCustomerHappinessReport`, `customerHappinessColumns`, `customerHappiness`, `customerHappinessExport` |
| `assets.js` | the four asset report builders and their handlers/exports |
| `licenses.js` | the license, contract, software-spend, contract-spend and upcoming-renewals builders and their handlers/exports |

Check the real names first: `grep -nE "^(async )?function |^const [a-zA-Z]+ = (asyncHandler|\[)" backend/src/controllers/reportsController.js`. Any helper not listed above goes to `shared.js` if more than one module uses it, otherwise to its one user.

- [ ] **Step 1: Record the export keys**

Run: `cd backend && node -e "console.log(Object.keys(require('./src/controllers/reportsController')).sort().join('\n'))" > /tmp/reports-keys.before`

- [ ] **Step 2: Create the modules**

Same rules as Task 2, Step 2.

- [ ] **Step 3: The index**

```js
// Reports controller index. Builders live in ./reports/, one module per
// report family; shared helpers (also used by customReportEngine) are
// re-exported from ./reports/shared.
module.exports = {
  ...require('./reports/shared'),
  ...require('./reports/tickets'),
  ...require('./reports/team'),
  ...require('./reports/sla'),
  ...require('./reports/time'),
  ...require('./reports/projects'),
  ...require('./reports/contacts'),
  ...require('./reports/happiness'),
  ...require('./reports/assets'),
  ...require('./reports/licenses'),
};
```

`shared.js` may define helpers the old file didn't export, such as `weekStart` and `assetRow`. Then the spread adds keys and the diff below shows extra lines. Remove the extras from `shared.js`'s exports and import them by name where needed, or export only the old public set from the index. The rule is that the key list is identical.

- [ ] **Step 4: Check the exports, the loads and the sizes**

```bash
cd backend
node -e "console.log(Object.keys(require('./src/controllers/reportsController')).sort().join('\n'))" > /tmp/reports-keys.after
diff /tmp/reports-keys.before /tmp/reports-keys.after && echo SAME-KEYS
for f in src/controllers/reports/*.js; do node -e "require('./$f')" || echo "LOAD FAIL $f"; done
node -e "require('./src/services/customReportEngine')" && echo ENGINE-LOADS
wc -l src/controllers/reports/*.js | sort -n | tail -3
```

Expected: `SAME-KEYS`, no `LOAD FAIL`, `ENGINE-LOADS`, and every file under about 800 lines.

- [ ] **Step 5: The full suite, unchanged**

Run (in the background): `cd backend && npm test > /tmp/3a-t4.log 2>&1; grep -E "^(FAIL|Tests:)" /tmp/3a-t4.log`
Expected: all pass, the same count. The report suites (`readers.reports`, `companies.reports`, `companies.reportfilter`) are the ones that matter here.

- [ ] **Step 6: Commit**

```bash
git add backend/src/controllers/reportsController.js backend/src/controllers/reports
git commit -m "refactor(reports): split the reports controller by report family"
```

---

### Task 5: Split `TicketDetail.jsx`

**Files:**
- Create:
  - `frontend/src/pages/tickets/theme.js`;
  - `frontend/src/pages/tickets/TicketDetail.jsx`;
  - `frontend/src/pages/tickets/detail/`:
    - `Badges.jsx`, `TimeFields.jsx`, `Modal.jsx`, `TimerWidget.jsx`;
    - `Sidebar.jsx`, `ConversationTab.jsx`, `ReplyBox.jsx`, `ResolutionTab.jsx`;
    - `TimeEntriesTab.jsx`, `TasksTab.jsx`, `AttachmentsTab.jsx`, `RelationshipsTab.jsx`, `ActivityTab.jsx`.
- Delete: `frontend/src/pages/TicketDetail.jsx`
- Modify: `frontend/src/App.jsx` (one import path)

**What goes where:**

| File | From `pages/TicketDetail.jsx` |
|---|---|
| `theme.js` | the color constants (`BG`, `CARD_BG`, `BORDER`, `TEXT`, `MUTED`, `BLUE`, `TIMER_COLOR`, `PURPLE`, `PURPLE_LIGHT`, `AMBER`), `fieldStyle`, and `formatMinutes`, each exported by name |
| `detail/Badges.jsx` | `SourceBadge`, `CsatBadge`, `PRIORITY_OPTIONS`, `TYPE_OPTIONS`, `PRIORITY_META`, `SOURCE_META` |
| `detail/TimeFields.jsx` | `TimePicker`, `TimeEntryFields`, `LoggedForField`, and the small time helpers they use |
| `detail/Modal.jsx` | `Modal` |
| `detail/TimerWidget.jsx` | `TICKET_TIMER_KEY`, `TimerWidget`, `OtherTicketTimerBanner`, and the timer helpers |
| `detail/Sidebar.jsx` | `SidebarSection`, `CustomFieldValue`, `Sidebar`, `SIDEBAR_STORAGE_KEY` |
| `detail/ConversationTab.jsx` | `ConversationTab` |
| `detail/ReplyBox.jsx` | `ReplyBox` |
| `detail/ResolutionTab.jsx` | `ResolutionTab` |
| `detail/TimeEntriesTab.jsx` | `TimeEntriesTab` |
| `detail/TasksTab.jsx` | `TasksTab` |
| `detail/AttachmentsTab.jsx` | `AttachmentsTab` |
| `detail/RelationshipsTab.jsx` | `LinkSection`, `LinkTicketModal`, `RelationChip`, `RelationshipsTab` |
| `detail/ActivityTab.jsx` | `ACTIVITY_DOT`, `ACTIVITY_FIELD_LABEL`, `ActivityTab` |
| `TicketDetail.jsx` | `TABS`, `SUBLIST_STEP`, `GenerateReportModal`, and the page component `TicketDetail` |

Check the real list first: `grep -nE "^(export default )?function [A-Za-z]+|^const [A-Za-z_]+ = " frontend/src/pages/TicketDetail.jsx`. Any helper not named above goes with its only user, or to `theme.js` if more than one file uses it.

- [ ] **Step 1: Run the guard before changing anything**

Run: `cd backend && npm run test:smoke -- work.tickets.smoke.js`
Expected: PASS.

- [ ] **Step 2: Move the code**

For each file:
- import React hooks, `api`/`errMessage`, icons and shared helpers exactly as the original file did, with paths one level deeper (`'../api/api'` becomes `'../../api/api'`, and `'../../../api/api'` from `detail/`);
- export each moved component by name (`export function Sidebar(…)`);
- import the theme constants it uses from `../theme` (or `./theme` for the shell).

The shell `TicketDetail.jsx` imports every tab and panel it renders.

To find a moved component's missing names, run `npm --prefix frontend run build`. Vite doesn't fail on an undeclared identifier in JSX: it becomes a runtime `ReferenceError` when that tab renders. Task 1's guard opens every tab and catches these.

- [ ] **Step 3: Point the route at the new file**

In `App.jsx`, change `import TicketDetail from './pages/TicketDetail';` to `import TicketDetail from './pages/tickets/TicketDetail';`. Then delete `frontend/src/pages/TicketDetail.jsx`.

- [ ] **Step 4: Build, the guard, and the size**

Run: `npm --prefix frontend run build && cd backend && npm run test:smoke -- work.tickets.smoke.js companies.tickets.smoke.js companies.shell.smoke.js`
Expected: the build passes and the smoke tests pass.

Run: `wc -l frontend/src/pages/tickets/TicketDetail.jsx frontend/src/pages/tickets/detail/*.jsx | sort -n | tail -3`
Expected: every file under about 800 lines.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/App.jsx frontend/src/pages/tickets frontend/src/pages/TicketDetail.jsx
git commit -m "refactor(ticket page): split TicketDetail into a shell and one file per panel"
```

---

### Task 6: Split `ProjectDetail.jsx`

**Files:**
- Create:
  - `frontend/src/pages/projects/theme.js`;
  - `frontend/src/pages/projects/ProjectDetail.jsx`;
  - `frontend/src/pages/projects/detail/`:
    - `TimeFields.jsx`, `Modal.jsx`, `Bits.jsx`, `TasksTab.jsx`, `TaskDetailModal.jsx`;
    - `TimeTab.jsx`, `ExpensesTab.jsx`, `MaterialsTab.jsx`, `PeopleTab.jsx`, `FilesTab.jsx`, `ActivityTab.jsx`.
- Delete: `frontend/src/pages/ProjectDetail.jsx`
- Modify: `frontend/src/App.jsx`

**What goes where:**

| File | From `pages/ProjectDetail.jsx` |
|---|---|
| `theme.js` | the color constants and `fieldStyle`, plus `formatSeconds`, `formatCost`, `todayStr` and `completionColor` |
| `detail/TimeFields.jsx` | `minutesOfDayToParts`, `partsToMinutesOfDay`, `roundToNearest5`, `buildLocalDateTime`, `TimePicker`, `TimeEntryFields` |
| `detail/Modal.jsx` | `Modal` |
| `detail/Bits.jsx` | `Avatar`, `StatCard`, `EditableCode`, `DropLine` |
| `detail/TasksTab.jsx` | `TasksTab`, `AddTaskModal` |
| `detail/TaskDetailModal.jsx` | `TaskDetailModal` |
| `detail/TimeTab.jsx` | `TimeTab`, `AddTimeModal` |
| `detail/ExpensesTab.jsx` | `ExpensesTab`, `AddExpenseModal` |
| `detail/MaterialsTab.jsx` | `MaterialsTab`, `AddMaterialModal` |
| `detail/PeopleTab.jsx` | `PeopleTab`, `AddPersonModal` |
| `detail/FilesTab.jsx` | `FilesTab` |
| `detail/ActivityTab.jsx` | `ActivityTab` |
| `ProjectDetail.jsx` | `TABS`, `GenerateProjectReportModal`, and the page component `ProjectDetail` |

- [ ] **Step 1: Run the guard first**

Run: `cd backend && npm run test:smoke -- work.projects.smoke.js`
Expected: PASS.

- [ ] **Step 2: Move the code** (same rules as Task 5, Step 2)

- [ ] **Step 3: Repoint the route; delete the old file**

In `App.jsx`, change `import ProjectDetail from './pages/ProjectDetail';` to `import ProjectDetail from './pages/projects/ProjectDetail';`. Delete `frontend/src/pages/ProjectDetail.jsx`.

- [ ] **Step 4: Build, the guard, and the size**

Run: `npm --prefix frontend run build && cd backend && npm run test:smoke -- work.projects.smoke.js companies.projects.smoke.js`
Expected: PASS.

Run: `wc -l frontend/src/pages/projects/ProjectDetail.jsx frontend/src/pages/projects/detail/*.jsx | sort -n | tail -3`
Expected: every file under about 800 lines.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/App.jsx frontend/src/pages/projects frontend/src/pages/ProjectDetail.jsx
git commit -m "refactor(project page): split ProjectDetail into a shell and one file per tab"
```

---

### Task 7: Split `Tickets.jsx` and `TicketNew.jsx`

`Tickets()` is itself about 845 lines, so moving the helper components alone isn't enough. The board view and the bulk-action bar also come out of it as components.

**Files:**
- Create:
  - `frontend/src/pages/tickets/Tickets.jsx`;
  - `frontend/src/pages/tickets/list/`: `Cells.jsx`, `SavedFiltersMenu.jsx`, `ColumnsMenu.jsx`, `TicketBoard.jsx`, `BulkActionBar.jsx`, `listHelpers.js`;
  - `frontend/src/pages/tickets/TicketNew.jsx`;
  - `frontend/src/pages/tickets/new/`: `FormBits.jsx`, `ContactPicker.jsx`, `CustomFieldInput.jsx`, `AssetsField.jsx`, `WatchersField.jsx`, `Dropzone.jsx`.
- Delete: `frontend/src/pages/Tickets.jsx`, `frontend/src/pages/TicketNew.jsx`
- Modify: `frontend/src/App.jsx`

**What goes where (`Tickets.jsx`):**

| File | Content |
|---|---|
| `list/listHelpers.js` | `BASE_STATUS_OPTIONS`, `buildStatusFilterOptions`, `PRIORITY_OPTIONS`, `PRIORITY_META`, `SOURCE_META`, `FIXED_COLUMNS`, `DEFAULT_COLUMN_ORDER`, `COLUMN_LABELS`, `SORTABLE_COLUMNS`, `COLUMN_STORAGE_KEY`, `SORTABLE_CUSTOM_FIELD_TYPES`, `formatCustomFieldValue`, `todayStr`, `isClosedStatus`, `ageDays`, `formatMinutes`, `loadColumnPrefs` |
| `list/Cells.jsx` | `Avatar`, `PriorityCell`, `SourceCell`, `StatusBadge`, `DueDateCell`, `AgeLine`, `DeptPill`, `SortIcon` |
| `list/SavedFiltersMenu.jsx` | `SavedFiltersMenu` |
| `list/ColumnsMenu.jsx` | `ColumnsMenu` |
| `list/TicketBoard.jsx` | the JSX of the `view === 'board'` branch (around line 974), as `export function TicketBoard(props)`, with every value it reads passed as a prop |
| `list/BulkActionBar.jsx` | the bulk bar JSX (around lines 875–964), as `export function BulkActionBar(props)`, with every value and handler it reads passed as a prop |
| `Tickets.jsx` | the page component, rendering `<TicketBoard … />` and `<BulkActionBar … />` |

The color constants come from `../theme` (Task 5's `pages/tickets/theme.js`).

**What goes where (`TicketNew.jsx`):**

| File | Content |
|---|---|
| `new/FormBits.jsx` | `Required`, `OptionalPill`, `Card`, `Label`, `TYPE_OPTIONS`, `PRIORITY_OPTIONS`, `SOURCE_OPTIONS`, `MAX_FILE_SIZE` |
| `new/ContactPicker.jsx` | `ContactPicker`, `QuickCreateContact` |
| `new/CustomFieldInput.jsx` | `CustomFieldInput` |
| `new/AssetsField.jsx` | `AssetsField` |
| `new/WatchersField.jsx` | `WatchersField` |
| `new/Dropzone.jsx` | `Dropzone` |
| `TicketNew.jsx` | the page component |

- [ ] **Step 1: Run the guards first**

Run: `cd backend && npm run test:smoke -- work.list.smoke.js companies.filters.smoke.js companies.tickets.smoke.js`
Expected: PASS.

- [ ] **Step 2: Move the helpers and components** (same rules as Task 5, Step 2)

- [ ] **Step 3: Extract `TicketBoard` and `BulkActionBar`**

For each block:
1. Cut the JSX into the new component's `return`.
2. List every identifier it uses that was defined inside `Tickets()`: state values, setters, handlers and derived values such as `selectionCount`.
3. Pass each one as a prop with the same name, so the moved JSX reads unchanged.
4. In `Tickets()`, replace the block with `<TicketBoard {...{ columns, … }} />`, naming every prop.

Don't move state into the new components: the page keeps all state.

- [ ] **Step 4: Repoint the routes; delete the old files**

In `App.jsx`:
- `import Tickets from './pages/Tickets';` becomes `import Tickets from './pages/tickets/Tickets';`;
- `import TicketNew from './pages/TicketNew';` becomes `import TicketNew from './pages/tickets/TicketNew';`.

Delete the two old files.

- [ ] **Step 5: Build, the guards, and the sizes**

Run: `npm --prefix frontend run build && cd backend && npm run test:smoke -- work.list.smoke.js companies.filters.smoke.js companies.tickets.smoke.js companies.contacts.smoke.js`
Expected: PASS.

Run: `wc -l frontend/src/pages/tickets/*.jsx frontend/src/pages/tickets/list/* frontend/src/pages/tickets/new/* | sort -n | tail -3`
Expected: every file under about 800 lines.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/App.jsx frontend/src/pages/tickets frontend/src/pages/Tickets.jsx frontend/src/pages/TicketNew.jsx
git commit -m "refactor(ticket list): split Tickets and TicketNew into page shells and parts"
```

---

### Task 8: Whole suite, smoke suite, docs

**Files:**
- Modify: `docs/ROADMAP.md`

- [ ] **Step 1: Every test**

Run (in the background, one after the other): `cd backend && npm test > /tmp/3a-full.log 2>&1; npm run test:smoke > /tmp/3a-smoke.log 2>&1; grep -E "^(FAIL|Tests:)" /tmp/3a-full.log /tmp/3a-smoke.log`
Expected: both green; the backend count equals the one before Task 2, and the smoke count is the plan 2b count plus Task 1's guards.

- [ ] **Step 2: Sizes**

Run: `wc -l backend/src/controllers/{tickets,projects,reports}/*.js frontend/src/pages/{tickets,projects}/*.jsx frontend/src/pages/{tickets,projects}/*/*.jsx | sort -n | tail -5`
Expected: nothing over about 800 lines.

- [ ] **Step 3: ROADMAP**

In `docs/ROADMAP.md`, sub-project 3's row:
- set Status to **Building**;
- set Plan to `[plan 3a](superpowers/plans/2026-10-06-work-model-split.md) (split and guard); plan 3b (the model) and 3c (the screens) next`.

- [ ] **Step 4: Commit**

```bash
git add docs/ROADMAP.md
git commit -m "docs(roadmap): sub-project 3 building (plan 3a: split and guard)"
```

Push only when the user says so.
