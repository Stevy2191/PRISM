# Ticket Categories (5c) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> Per the user's token-efficiency rule this plan lists tasks, interfaces and test names, not full code.

**Goal:** Add an admin-built category tree, up to 5 levels deep, with a cascading picker on tickets. Categories can also scope custom fields, filter the ticket list, drive workflow conditions and group the custom report builder.

**Architecture:**
- **Storage:** a `TicketCategories` adjacency-list table. `Tickets.categoryId` holds the deepest chosen node.
- **Tree logic:** one pure-function tree module in `services/tickets/categories.js` handles paths, descendants, depth and "effectively active". Every caller loads the whole tree once per request; it is a small, global table.
- **Validation:** one choke point, `resolveCategoryForSave()`. Ticket create and update, bulk edit and recurring tickets all go through it.
- **Frontend:** one shared `CategoryPicker` component, used on the create form, the ticket sidebar, the bulk bar and the recurring ticket editor.

**Tech Stack:** Express, Sequelize/MariaDB, React. Tests are Jest + supertest (backend), `node --test` (frontend pure helpers) and Playwright smoke.

**Spec:** `docs/superpowers/specs/2026-10-14-service-desk-design.md`, section "5c — Categories" (plus requirement row 12).

## Global Constraints

- **Depth:** ≤ 5 levels, root = level 1. Enforced on create and on move, counting the moved node's whole subtree.
- **Unique names:** `(parentId, name)` is unique, case-insensitive, after trimming. MariaDB's UNIQUE index lets several NULLs through, so root names are also checked in code (see Review Focus 2).
- **Names:** 1–100 characters after trimming.
- **Parsing ids:** category ids are parsed with `parseRecordId` (`services/permissionService.js:317`). A body value like `'12abc'` is refused, never truncated.
- **Visibility:** the tree is global, not per company, and holds no client data, so any authenticated staff user may read it. Writes need the new permission `tickets.categories.manage`.
- **Saving a category on a ticket:**
  - **Allowed value:** the category must be *effectively active* (it and every ancestor active). Null is always allowed.
  - **requireChild:** if `requireChild` is set and the node has active children, the save is refused with `Choose a sub-category under <name>`.
- **Setting `tickets.categoryRequired`** (default `'false'`): when it is on, a category is required on the **staff create form** only. Inbound email and recurring tickets may leave it empty.
- **Retire:** `active=false` hides the node and everything below it from pickers. Tickets keep their category. Restore sets it back to `true`.
- **Delete:** allowed only when nothing uses the node or its descendants. "Uses" means:
  - tickets;
  - custom fields whose `categoryIds` contain any of those ids;
  - workflow conditions on the `category` field;
  - recurring ticket rules.
  - Otherwise the delete is refused with `409 CATEGORY_IN_USE` and a `usage` object.
- **API shape:** a ticket's `category` is `{ id, path: ['Hardware', 'Laptop', 'Battery'] }` or `null`.
- **Audit actions:** `ticketCategory.create|update|move|reorder|retire|restore|delete|settings`, plus `ticket.category` in the ticket activity log.
- **Migration number:** `20260101000068-ticket-categories.js`. Read `sequelize_removecolumn_broken.md` (memory) before writing it. `down` must work.
- **No new npm dependency.**

## Review Focus

1. **Re-saving a ticket whose category is now retired**, or newly `requireChild`, without changing the category must still save. The value is unchanged, so it is not re-checked (same pattern as `contactId` in `prepareTicketUpdate`). Test in Task 3: `PATCH title on a ticket whose category was retired → 200, category kept`.
2. **Duplicate root names.** MariaDB UNIQUE allows several `(NULL, 'Hardware')` rows. Test in Task 2: `two roots named "Hardware" / " hardware " → second is 409 DUPLICATE_NAME`.
3. **Moving a subtree past depth 5**: a node with a 3-level subtree moved under a level-3 node gives depth 6, even though the node itself would only be at level 4. Test in Task 2: `move refused when node depth + subtree height > 5`.
4. **Changing a ticket's category leaves values in fields outside the new branch.** They are kept (not deleted) and hidden from the form. Unrelated saves keep working, and sending a new non-empty value for an out-of-branch field is refused. Test in Task 5: `after moving to another branch, PATCH title works and GET custom-field-values still returns the old value; PATCH that field → 400`.
5. **Recurring rule whose stored category was later retired** (or gained `requireChild`): the run still creates the ticket, without a category, and the rule is not paused. The recurring list flags `categoryRetired: true`. Test in Task 4: `retired template category → ticket created uncategorized, rule still active`.

---

### Task 1: Schema, model and tree module

**Files:**
- Create: `backend/migrations/20260101000068-ticket-categories.js`. It adds:
  - the `TicketCategories` table: `id, parentId FK→self ON DELETE RESTRICT, name STRING(100), sortOrder INT default 0, active BOOL default true, requireChild BOOL default false, timestamps`, with UNIQUE `(parentId, name)`;
  - `Tickets.categoryId`: nullable FK → `TicketCategories`, `ON DELETE RESTRICT`, plus an index;
  - `CustomFields.categoryIds`: JSON, nullable;
  - `RecurringTickets.categoryId`: nullable FK;
  - the permission `tickets.categories.manage` (category `tickets`, label "Manage ticket categories", description "Build and edit the ticket category tree"), granted to System Administrator using migration 066's PERMISSIONS pattern;
  - the setting `tickets.categoryRequired='false'` (only if no row exists yet).
  - `down` reverses everything (drop FKs and columns, delete the permission and its RolePermissions, delete the setting row).
- Create: `backend/src/models/TicketCategory.js`. Modify: `backend/src/models/index.js` (register it, `TicketCategory.hasMany(TicketCategory, { as: 'children', foreignKey: 'parentId' })`), `Ticket.js`, `CustomField.js`, `RecurringTicket.js` (new columns).
- Create: `backend/src/services/tickets/categories.js`
- Test: `backend/test/unit/categoryTree.test.js`, `backend/test/integration/categories.migration.test.js`

**Interfaces, produced** (pure functions take a `tree`, which is `Map<number, Node>`; Node is `{ id, parentId, name, sortOrder, active, requireChild }`):
- `loadTree(opts?: { transaction }) → Promise<Map>`
- `pathOf(tree, id) → Node[]` (root → node; `[]` if unknown)
- `depthOf(tree, id) → number` (root = 1)
- `subtreeHeight(tree, id) → number` (a leaf = 1)
- `descendantIds(tree, id) → number[]` (includes `id`)
- `isEffectivelyActive(tree, id) → boolean`
- `activeChildren(tree, id) → Node[]` (sorted by sortOrder, then name)
- `wouldCycle(tree, id, newParentId) → boolean`
- `categoryJson(tree, id) → { id, path: string[] } | null`
- `MAX_DEPTH = 5`

- [ ] Unit tests (build the Map by hand, no DB): `pathOf returns root→leaf`, `depthOf root is 1`, `subtreeHeight of leaf is 1 and of a 3-level chain is 3`, `descendantIds includes self and all levels`, `isEffectivelyActive false when an ancestor is retired`, `activeChildren excludes retired and orders by sortOrder then name`, `wouldCycle true for self and for a descendant, false otherwise`, `categoryJson null for unknown/null id`.
- [ ] Migration tests (pattern: `desktools.migration.test.js`): `up creates table and columns`, `grants tickets.categories.manage to System Administrator`, `seeds tickets.categoryRequired=false`, `down then up leaves the schema as the full chain does`.
- [ ] Run → FAIL. Implement. Apply the migration to the test DB: `cd backend && set -a && . ./.env.test && set +a && npx sequelize-cli db:migrate --env test` (`npm run test:migrate` alone fails silently here). Run → PASS.
- [ ] Commit `feat(categories): schema, model and tree helpers`.

### Task 2: Categories API

**Files:**
- Create: `backend/src/controllers/ticketCategoriesController.js`, `backend/src/routes/ticketCategories.js`
- Modify: `backend/src/routes/index.js` (`router.use('/ticket-categories', guard, ticketCategoriesRoutes)`)
- Test: `backend/test/integration/categories.api.test.js`

**Interfaces.** Consumes Task 1. Produces:
- `GET /api/v1/ticket-categories` (any staff) → `{ categories: Node[] (flat, all incl. retired, each with effectiveActive), categoryRequired: boolean }`. With `?usage=1`, holders of `tickets.categories.manage` also get `usage: { tickets, fields, rules }` per node, counting the node's own direct uses. Without the permission, `usage` is ignored silently.
- `POST /` `{ name, parentId?, requireChild? }` → 201 `{ category }`. New nodes go last among their siblings.
- `PATCH /:id` `{ name?, requireChild?, active?, parentId? }`:
  - a `parentId` change is a move: it puts the node last under the new parent, checks the depth (node depth + subtree height − 1 ≤ 5) and refuses cycles;
  - `active:false` and `true` are retire and restore.
- `POST /reorder` `{ parentId: number|null, orderedIds: number[] }`. The ids must be exactly the current children of that parent; otherwise 400.
- `DELETE /:id` → 204. If the node or a descendant is in use → `409 CATEGORY_IN_USE` with `usage: { tickets, fields, rules, recurring }` totals over the subtree.
- `PUT /settings` `{ categoryRequired: boolean }` → `{ categoryRequired }`. Writes `SystemSettings 'tickets.categoryRequired'`.
- Every write route needs `requirePermission('tickets.categories.manage')`, and every write calls `writeAudit` with the action names in Global Constraints.
- Error codes: `400 VALIDATION_ERROR` (name, depth, cycle, bad reorder), `404 NOT_FOUND`, `409 DUPLICATE_NAME`, `409 CATEGORY_IN_USE`.
- Workflow-rule usage is counted from `WorkflowConditions` where `field='category'` and `value` is one of the subtree ids, as a string.

- [ ] Tests:
  - **Permissions:** `any staff can GET; technician without the permission gets 403 on every write`.
  - **Create and rename:**
    - `create root and child; path builds`;
    - `name trimmed, empty → 400, 101 chars → 400`;
    - `duplicate sibling name (case/space-insensitive) → 409`;
    - **two roots named "Hardware" / " hardware " → 409** (Review Focus 2);
    - `rename to a sibling's name → 409`.
  - **Depth and moves:**
    - `6th level refused`;
    - **`move refused when node depth + subtree height > 5`** (Review Focus 3);
    - `move under own descendant → 400 cycle`;
    - `move under itself → 400`.
  - **Bad ids:** `parentId '12abc' → 400 and nothing written`; `unknown parentId → 400`.
  - **Reorder:** `reorder sets sortOrder; ids not matching the children → 400`.
  - **Retire and restore:** `retire hides the subtree (effectiveActive false below it); restore brings it back`.
  - **Delete:**
    - `delete unused leaf → 204`;
    - `delete blocked by a ticket on a descendant → 409 with usage.tickets`;
    - `blocked by a custom field scoped to a descendant`;
    - `blocked by a workflow condition`;
    - `blocked by a recurring rule`.
  - **Usage counts:** `?usage=1 shows counts for a manager and is omitted for a technician`.
  - **Settings:** `PUT /settings toggles categoryRequired; non-boolean → 400; non-manager → 403`.
  - **Audit:** `every write leaves its audit row`.
- [ ] Run → FAIL. Implement. Run → PASS. Commit `feat(categories): category tree API`.

### Task 3: Category on tickets (create, update, read, list filter)

**Files:**
- Modify: `backend/src/services/tickets/categories.js` (add `resolveCategoryForSave`)
- Modify: `backend/src/services/tickets/ticketWrite.js`:
  - `createTicket` (~L58): read `categoryId` from input and store it;
  - `prepareTicketUpdate` (~L257): add `categoryId` to `allowed`; an unchanged value isn't re-checked;
  - `runTicketUpdateEffects`: log activity `category` with the old and new path strings.
- Modify: `backend/src/controllers/tickets/core.js`:
  - the list WHERE builder (~L31): `?category=<id>` → `categoryId IN descendantIds`; an unknown id matches nothing;
  - the detail GET: attach `category: categoryJson(...)`.
- Modify: `backend/src/controllers/tickets/shared.js`: the ticket JSON serializer adds `category` (load the tree once per response, not per row).
- Test: `backend/test/integration/categories.tickets.test.js`

**Interfaces.** Consumes Task 1. Produces:
- `resolveCategoryForSave(raw, { current = undefined, required = false, tree? }) → Promise<number|null>`:
  - **Empty input:** `undefined` returns `current`; `null` or `''` returns `null`, unless `required`, in which case 400 `A category is required`.
  - **Bad ids:** a non-`parseRecordId` value → 400 `Category not found`.
  - **Unchanged value:** if `id === current`, return it without further checks.
  - **Inactive:** unknown or not effectively active → 400 `Category not found`.
  - **requireChild:** if `requireChild` is set and `activeChildren` is non-empty → 400 `Choose a sub-category under <name>`.
- `createTicket(actor, input, opts)` accepts `input.categoryId`. `opts.requireCategory` (boolean) is set only by the staff POST `/tickets` controller, when the setting is `'true'`.
- Ticket GET/PATCH/POST responses include `category: { id, path } | null`.
- `GET /tickets?category=<id>`. This also applies to the bulk "every ticket matching these filters" path, which shares the builder.

- [ ] Tests:
  - **Create:**
    - `create with a leaf → category path in response`;
    - `create with requireChild parent → 400 "Choose a sub-category under Hardware"`;
    - `requireChild parent with only retired children is allowed`;
    - `retired category → 400`;
    - `child of a retired parent → 400`;
    - `'12abc' → 400`;
    - `null always allowed`.
  - **Required setting:**
    - `categoryRequired=true: staff POST without one → 400`;
    - `categoryRequired=true: inbound email still creates an uncategorized ticket` (reuse `email.inbound.test.js` helpers via `handleParsedMessage`).
  - **Update:**
    - `PATCH categoryId changes it and logs activity`;
    - **`PATCH title on a ticket whose category was retired → 200, category kept`** (Review Focus 1);
    - `same for a category that later gained requireChild`;
    - `PATCH to a different retired category → 400`.
  - **List filter:**
    - `?category=<root> returns tickets in descendants`;
    - `?category=<leaf> excludes siblings`;
    - `?category=unknown → empty list`;
    - `?category=12abc → 400 or empty, never all tickets`.
  - **Access:** `category is not a way around ticket scope: own-tier user sees only own tickets under ?category`.
- [ ] Run → FAIL. Implement. Run → PASS. Also run the existing `tickets.*`, `sideEffects` and `email.inbound` tests. Commit `feat(categories): categories on tickets`.

### Task 4: Bulk edit and recurring tickets

**Files:**
- Modify: `backend/src/controllers/tickets/bulk.js`: add the action `category` to `ACTIONS`; it calls `updateTicket(req, ticket, { categoryId: value })`, so each ticket goes through the same validation and per-ticket failures are reported as the existing actions do.
- Modify: `backend/src/controllers/recurringTicketsController.js`:
  - add `categoryId` to `TEMPLATE_FIELDS` and validate it with `resolveCategoryForSave` on save;
  - the response adds `category` (categoryJson) and `categoryRetired: boolean` (stored id not effectively active).
- Modify: `backend/src/services/recurring/runRule.js`: pass `categoryId` only if `isEffectivelyActive` and it doesn't fail requireChild. Otherwise pass `null`, without pausing the rule.
- Test: extend `backend/test/integration/categories.tickets.test.js` (new `describe('bulk and recurring')`)

**Interfaces.** Consumes `resolveCategoryForSave`, `isEffectivelyActive`, `categoryJson` (Tasks 1 and 3). Produces the bulk action `{ action: 'category', value: id|null }` and recurring fields `categoryId`, `category` and `categoryRetired`.

- [ ] Tests:
  - **Bulk:** `bulk category sets it on every selected ticket`; `bulk with a requireChild parent → every ticket reported failed, none changed`.
  - **Recurring:**
    - `recurring rule saves categoryId; retired category refused on save`;
    - **`retired template category → ticket created uncategorized, rule still active, list shows categoryRetired`** (Review Focus 5);
    - `active template category → ticket carries it`.
- [ ] Run → FAIL. Implement. Run → PASS. Commit `feat(categories): bulk and recurring`.

### Task 5: Custom fields scoped to category branches

**Files:**
- Modify: `backend/src/controllers/customFieldsController.js`:
  - `validate()` (~L71): `categoryIds`, an array of known ids parsed with `parseRecordId`, or null/empty = all; an unknown id → 400;
  - `list()` (~L104): `?categoryId=<id>` also narrows to fields whose `categoryIds` is null or contains an ancestor-or-self of the given id. It combines with `?ticketType`. If `?ticketType` is given but no `categoryId`, branch-scoped fields are excluded.
- Modify: `backend/src/controllers/tickets/shared.js`, `syncCustomFieldValues` (~L101): new signature `syncCustomFieldValues(ticketId, values, t, { categoryId })`. A **non-empty** value for a field whose branch doesn't include `categoryId` → 400 `"<label>" doesn't apply to this ticket's category`. Clearing such a value is allowed.
- Modify the callers: `controllers/tickets/fields.js` `updateCustomFieldValues` passes `ticket.categoryId`; `ticketWrite.js` create passes the new ticket's category.
- Add the helper `fieldAppliesToCategory(field, tree, categoryId) → boolean` to `services/tickets/categories.js`.
- Test: `backend/test/integration/categories.fields.test.js`

**Interfaces.** Consumes Task 1 helpers and `Tickets.categoryId`. Produces `CustomFields.categoryIds` in the custom-field API, `GET /custom-fields?ticketType=&categoryId=`, and `fieldAppliesToCategory`.

- [ ] Tests:
  - **Field setup:** `field scoped to Hardware: save with unknown category id → 400`.
  - **Listing:**
    - `listed for Hardware/Laptop (descendant), not for Software`;
    - `unscoped fields listed for every category and for none`;
    - `branch-scoped field not listed when no category given`.
  - **Accepting values:**
    - `value accepted on create when category is in branch; refused (400) when out of branch`;
    - **`after moving to another branch, PATCH title works and GET custom-field-values still returns the old value; PATCH that field → 400; clearing it → 200`** (Review Focus 4).
  - **Combined scopes:** `ticketTypes and categoryIds combine (both must match)`.
- [ ] Run → FAIL. Implement. Run → PASS. Also run the existing custom-field tests (`grep -l custom-field test/integration`). Commit `feat(categories): custom fields scoped to category branches`.

### Task 6: Workflow condition and report builder

**Files:**
- Modify: `backend/src/controllers/workflowRulesController.js` (~L16, L29):
  - add the operators `is` and `is_under` to `OPERATORS`;
  - a `category` condition must use `is`, `is_under`, `is_empty` or `is_not_empty`, and its value must be a known category id string; otherwise 400;
  - `is` and `is_under` are valid only on the `category` field.
- Modify: `backend/src/services/workflowEngine.js`:
  - `loadTicketForEvaluation` (~L281) attaches `ticket._categoryPathIds` (ids root→leaf) from `loadTree`;
  - `evaluateCondition` (~L81): for `field==='category'`, `is` → `String(ticket.categoryId) === value`, `is_under` → `_categoryPathIds` includes `Number(value)`, `is_empty` / `is_not_empty` on `categoryId`.
- Modify: `backend/src/services/customReportEngine.js`:
  - `FIELD_DEFS.tickets` gets `{ key: 'category', label: 'Category', type: 'string' }`, and the record gets `category: path.join(' › ')`;
  - `GROUP_BY_OPTIONS.tickets` gets `'category'`, and `groupKeyFor` returns the full path, or `'Uncategorized'`;
  - load the tree once per report run.
- Test: `backend/test/integration/categories.workflow.test.js` (workflow plus report, one file)

**Interfaces.** Consumes Task 1 helpers. Produces the condition `{ field: 'category', operator: 'is'|'is_under'|'is_empty'|'is_not_empty', value: '<id>' }`, the report field `category` and the groupBy `category`.

- [ ] Tests:
  - **Workflow:**
    - `is matches the exact node only`;
    - `is_under matches the node and descendants, not siblings`;
    - `is_empty matches uncategorized`;
    - `rule with is_under on a non-category field → 400`;
    - `category condition with unknown id → 400`;
    - `rule fires on ticket_created with a category condition (end to end)`.
  - **Report:** `report column shows "Hardware › Laptop"`; `group by category groups by full path and puts uncategorized under "Uncategorized"`.
- [ ] Run → FAIL. Implement. Run → PASS. Also run the existing workflow and custom-report tests. Commit `feat(categories): workflow condition and report column`.

### Task 7: Picker component and Settings tree editor

**Files:**
- Create: `frontend/src/components/CategoryPicker.jsx`, a cascading picker with one `<select>` per level:
  - **Props:** `{ categories, value, onChange, includeRetiredValue?: boolean, required?: boolean, id? }`.
  - **Options:** each level lists only the chosen parent's *effectively active* children. Changing a level clears the levels below it.
  - **Retired value:** if `value` is retired, its saved path still shows read-only, labelled "(retired)", so the sidebar can show a kept category.
  - **Labels:** each select has an `aria-label`, `Category level N`.
- Create: `frontend/src/components/categoryTree.js` (pure: `buildIndex`, `pathIds`, `childrenOf`, `isEffectivelyActive`) + `frontend/src/components/categoryTree.test.js` (node --test).
- Create: `frontend/src/pages/settings/TicketCategories.jsx`:
  - a tree with add child, inline rename, the requireChild toggle, retire/restore, delete (showing the 409 usage message) and the usage counts (`?usage=1`);
  - drag-reorder within a parent via `POST /reorder` and a "Move to…" parent select (depth errors shown from the API);
  - the "Require a category on new tickets" switch (`PUT /settings`).
- Modify: `frontend/src/pages/settings/registry.js` (entry `id: 'ticket-categories'`, group 'Service desk', path `/settings/ticket-categories`, `access: { permission: ['tickets.categories.manage'] }`), `frontend/src/pages/settings/registry.test.js` if it lists the permission keys, and `frontend/src/App.jsx` (route map).
- Test: `frontend/src/components/categoryTree.test.js`, `backend/test/smoke/categories.smoke.js` (tree editor part)

**Interfaces.** Consumes the Task 2 API. Produces `<CategoryPicker>` and the `categoryTree.js` helpers, which Task 8 uses.

- [ ] Unit tests: `childrenOf orders by sortOrder then name and skips retired`; `pathIds root→leaf`; `isEffectivelyActive false under a retired ancestor`.
- [ ] Smoke tests (fixture: `beforeEach(resetRateLimits)`):
  - `admin adds Hardware › Laptop in the tree editor and it persists after reload`;
  - `retire hides it from the picker on the create form`;
  - `delete of a used category shows the in-use message`.
- [ ] Run → FAIL. Implement. `npm --prefix frontend test` → PASS. Build, then run the smoke file → PASS. Commit `feat(categories): picker and settings tree editor`.

### Task 8: Picker everywhere, filters and editors

**Files:**
- Modify: `frontend/src/pages/tickets/TicketNew.jsx`:
  - picker (required when `categoryRequired`), sending `categoryId`;
  - re-fetch custom fields with `?ticketType=&categoryId=` when the category changes, and drop values of fields that no longer show.
- Modify: `frontend/src/pages/tickets/detail/Sidebar.jsx`: picker (`includeRetiredValue`), PATCH `categoryId`; re-fetch the applicable custom fields after a change.
- Modify: `frontend/src/pages/tickets/list/BulkActionBar.jsx` (the "Category" action) and `frontend/src/pages/tickets/Tickets.jsx` (a category filter in the filters panel, sent as `params.category` and saved in the saved-filter JSON).
- Modify: `frontend/src/pages/settings/RecurringTicketEditor.jsx` (picker) and `RecurringTickets.jsx` (a "category retired" badge when `categoryRetired`).
- Modify: `frontend/src/pages/settings/Layouts.jsx`: a custom field editor "Show for categories" multi-select (any node), sending `categoryIds`.
- Modify: `frontend/src/pages/settings/WorkflowRuleEditor.jsx`: field `category` (kind `category`), operators `is` / `is under` / `is empty` / `is not empty`, value via CategoryPicker.
- Modify: `frontend/src/pages/reports/CustomReportBuilder.jsx`, only if the field and groupBy lists aren't already driven by the metadata endpoint (check first; expect no change).
- Test: extend `backend/test/smoke/categories.smoke.js`

**Interfaces.** Consumes `<CategoryPicker>` (Task 7) and the backend contracts of Tasks 3–6.

- [ ] Smoke tests:
  - `create form: picking Hardware then Laptop sends the leaf; changing level 1 clears level 2`;
  - `requireChild parent alone shows the API message`;
  - `a field scoped to Hardware appears only after Hardware is picked`;
  - `sidebar shows a retired category as "(retired)" and the ticket still saves a title change`;
  - `list filter by Hardware shows the Laptop ticket`.
- [ ] Run → FAIL. Implement. Build, then run the smoke file → PASS. Commit `feat(categories): picker on tickets, bulk, recurring, filters and editors`.

### Task 9: Finish

- [ ] Run the full backend suite once (`npm test`), the full smoke suite once (`npm run test:smoke`) and the frontend build.
- [ ] Docs:
  - `docs/ROADMAP.md`: 5c → Built and a plan link; sub-project 5 → Built once 5c ships;
  - `UPGRADING.md` Unreleased: a categories section (migration runs automatically; new permission granted to System Administrator only; other roles need it added in Roles).
- [ ] Security-relevant? Moderate: there's a new permission, and the filter could bypass ticket scope. Run one fresh reviewer over the branch diff, focusing on the scope bypass via `?category`, the permission gating and the delete-in-use completeness. Fix findings test-first.
- [ ] Update memory (new `ticket_categories_build.md` + MEMORY.md line), push to dev, and confirm that the CI image build succeeded. The test workflow only runs on `main` and pull requests.
