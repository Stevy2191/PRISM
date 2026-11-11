# PRISM 9 — Per-company ticket categories, software lists and company setup: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Start only after sub-project 8c (the Linux agent) is finished and released** (owner, 2026-11-05).

**Goal:** Every company has its own ticket category tree, and nothing is shared between companies. Someone raising a ticket from the agent, the portal or a staff screen picks the category step by step (Network → Wireless → Intermittent connection). A category step can be "which of our apps?", answered from the company's own **software list**. Every step also offers **Other / I'm not sure**, so the choice is required but nobody is stuck. Each company's page gets a **Setup** checklist showing what's ready for that company and what's missing.

**Owner decisions (2026-11-05):**
1. **No default tree.** Each company builds its own; companies never share categories. A new company has none until someone adds them.
2. **Required, with a way out.** When the company has categories, the agent and the portal require a choice, and every level offers **Other / I'm not sure**.
3. **Software lists start empty.** Staff add apps by hand. The add dialog can also offer the software the agent found on that company's computers, to pick from rather than type.
4. The Linux agent (8c) comes first.
5. (2026-11-10) Build order: categories first, then the agent's form: Tasks 1, 2, 5 (the Categories tab; the Software tab with Task 3), 7; then 3, 4, 6, 8, 9.
6. (2026-11-10) The agent's form also asks the ticket's type: **Incident** or **Request** (2026-11-10, revised: two choices with an ⓘ explaining each, rather than plain-words options). Required, nothing chosen at first. Old agents' tickets stay Requests.
7. (2026-11-10) Incidents and requests have their own categories: a top-level category is for incidents, requests or both (migration 086); a ticket's category must fit its type.
8. (2026-11-11) The agent's form takes attachments: files, pasted screenshots, dropped files (up to 5, 10 MB each, 20 MB together).

**Architecture:**
- **Categories get a company.** `TicketCategories.companyId` (required). Existing categories move to the help desk's own company (the internal one), so nothing a client sees changes meaning. A category can only be set on a ticket of its own company. The tree helpers (`categoryTree.js`) stay the same and only load one company's tree.
- **"Other / I'm not sure"** isn't a stored category. Choosing it at any level saves the deepest category chosen so far (or none, at the top) and sets `Tickets.categoryUnsure`. That way staff can see what still needs triage, and `requireChild` doesn't block the person raising the ticket.
- **Company lists (catalogue).** A new `CompanyCatalogItems` table (`companyId`, `kind`, `name`, `publisher`, `notes`, `active`, `sortOrder`). `kind` is `software` for now; the same table can later hold printers, shared drives and the like. A category can say "ask which item" (`TicketCategories.pickKind = 'software'`). The ticket then records the item (`Tickets.catalogItemId`) or "not listed".
- **Where staff manage it:** a company's page gets **Categories** and **Software** tabs, beside Departments. **Settings → Ticket categories** becomes the help desk's own company's tree, the same pattern as Settings → Departments.
- **The agent** gets the company's tree and software list from `whoami`, so the form needs no new connection. Old agents' tickets (no category) are still accepted.

**Tech Stack:** as now: Node/Express/Sequelize/MariaDB, React/Vite, Go agent (the tray form in `agent/internal/trayui/form.html`). Migrations take the next free numbers after 8c's.

## Global Constraints

- **Nothing crosses companies.** Every read and write of a category or catalogue item checks the company: the API refuses another company's category or item on a ticket (`400 Category not found`, like today) and company access fences the management screens, exactly as departments are fenced.
- **A ticket that moves company** loses a category or item from its old company (cleared and logged), never keeps a foreign one.
- **Old data keeps working.** A ticket whose category was retired, or that was raised before this, saves unchanged (the existing "re-sending the stored value is never re-checked" rule).
- **The agent's text is untrusted**, as everywhere: category and item ids from the tray are checked against the device's company on the server, never trusted.
- **Required only when there is something to choose:** a company with no categories gets no category step and nothing is required.

## Review Focus

- **Company fence on categories and items** (API, management screens, the tray's ids) → Tasks 1, 3, 7.
- **Migration of the existing global tree** to the internal company, and of tickets/rules/recurring tickets/custom fields that point at it → Task 1.
- **Required-but-escapable** validation in one place (`resolveCategoryForSave`) for all sources → Task 2.

---

### Task 1: Categories belong to a company

**Files:**
- Create: `backend/migrations/<next>-company-ticket-categories.js`
- Modify: `backend/src/models/TicketCategory.js`, `backend/src/services/tickets/categories.js`, `backend/src/controllers/ticketCategoriesController.js`, `backend/src/routes/ticketCategories.js`, `backend/src/services/tickets/ticketWrite.js` (and `controllers/tickets/core.js`, `bulk.js`, `split.js`, `services/recurring/runRule.js`, workflow-rule and custom-field code that reads categories)
- Test: `backend/test/integration/ticketCategories.company.test.js`, migration round trip

- `TicketCategories.companyId` NOT NULL, FK to Companies (cascade on company delete is refused while tickets use them, like departments). Existing rows → the internal company. Sibling names are unique **within a company**.
- `loadTree(companyId)`; `resolveCategoryForSave(raw, { companyId, ... })` refuses a category of another company. Moving a ticket to another company clears a foreign category (activity log entry).
- `GET /ticket-categories?companyId=` (company access as departments); create/update/delete check `assertCanManageCategoriesOf(company)`: the internal company needs the existing category permission, a client company needs `companies.manage`.
- Custom fields scoped to a category, workflow rules and recurring tickets keep pointing at the same rows; the migration moves them with their category (they are now the internal company's).

- [x] **Step 1: Failing tests:** two companies' trees are separate (list, create with the same names, reorder); a ticket of company A can't take B's category (create, update, bulk, split, recurring); moving a ticket to B clears A's category; existing categories end up in the internal company; the migration's down/up round trip.
- [x] **Step 2–4:** Run → FAIL; implement; run → PASS.
- [x] **Step 5: Commit** `feat(categories): each company has its own ticket categories`

*As built (2026-11-10):* migration 084. The tree stays one table loaded whole (it's small); every node carries its company, and `resolveCategoryForSave(raw, { companyId })` refuses another company's category everywhere a ticket's category is saved (staff create and update, bulk, the portal, recurring rules; runs leave off one of another company). `GET /ticket-categories?companyId=` (or `internal`) gives one company's tree; without it, every category of the companies the caller can reach, each with its `companyId` (ticket list filter, rule and layout editors). Changing a category needs `tickets.categories.manage` and the company in reach (simpler than the plan's companies.manage split). A company with categories can't be deleted; merging moves them, suffixing clashing top-level names. Staff pickers ask for the ticket's (or chosen contact's) company; Settings → Ticket categories is the help desk's own company.

### Task 2: Required, with "Other / I'm not sure"

**Files:**
- Create: migration (`Tickets.categoryUnsure` BOOLEAN default false)
- Modify: `services/tickets/categories.js`, `ticketWrite.js`, portal and agent ticket creation, ticket JSON
- Test: `backend/test/integration/ticketCategories.unsure.test.js`

- Input shape for the person raising a ticket: `{ categoryId, categoryUnsure }`. `categoryUnsure: true` with a category means "this far, then not sure" and skips `requireChild`; with none, "not sure at all".
- Required (when the company has any active category) for portal and agent tickets; staff screens keep the existing per-install setting.
- Staff see **Category: Network → Wireless (not sure beyond this)**, and a ticket list filter **Category not sure** for triage. Setting a full category clears the flag.

- [x] **Step 1: Failing tests:** portal and agent tickets refused without a choice when the company has categories, accepted with none when it has none; "not sure" at the top and part way; `requireChild` skipped only when unsure; staff setting a category clears the flag; the filter.
- [x] **Step 2–4:** Run → FAIL; implement; run → PASS.
- [x] **Step 5: Commit** `feat(categories): a required choice with Other / I'm not sure`

*As built (2026-11-10):* migration 085. `createTicket(..., { requireCategory })` now means "required where the ticket's company has categories" for every source; the portal always asks for it (its "Not sure" choice sends `categoryUnsure: true` until Task 6's stepper); the staff form keeps the per-install setting. The sidebar says "Not sure beyond this" or "Raised as Other / I'm not sure"; the ticket list has a **Category not sure** pill (`?categoryUnsure=true`), kept in saved filters.

### Task 3: The company's software list

**Files:**
- Create: migration (`CompanyCatalogItems`), `backend/src/models/CompanyCatalogItem.js`, `backend/src/controllers/catalogController.js`, routes under `/companies/:id/catalog`
- Test: `backend/test/integration/catalog.test.js`

- `GET/POST/PATCH/DELETE /companies/:id/catalog?kind=software` (company access; editing needs `companies.manage`, or the category permission for the internal company). Names unique per company and kind; deactivating hides an item from pickers but keeps it on old tickets.
- `GET /companies/:id/catalog/found-software?search=`: the distinct programs the agent found on that company's computers (`AssetSoftware` joined to its Assets), with how many computers have each, and whether it's already on the list. It reads only; adding is a normal POST (owner decision 3).

- [ ] **Step 1: Failing tests:** CRUD, uniqueness, company fence (another company's list and found-software are refused), found-software groups versions and counts computers, excludes what's listed already.
- [ ] **Step 2–4:** Run → FAIL; implement; run → PASS.
- [ ] **Step 5: Commit** `feat(catalog): each company's software list`

### Task 4: "Which app?" steps

**Files:**
- Create: migration (`TicketCategories.pickKind` NULL|'software', `Tickets.catalogItemId` FK SET NULL, `Tickets.catalogItemNotListed` BOOLEAN)
- Modify: categories controller (set `pickKind`), `ticketWrite.js` (item must be the ticket company's, active, of the category's kind; or "not listed")
- Test: `backend/test/integration/ticketCategories.pick.test.js`

- A category with `pickKind` is answered by choosing one of the company's active items of that kind, or **Not listed** (which can carry the app's name in the description). The item shows on the ticket and in reports.

- [ ] **Step 1–5:** tests (item from another company refused, inactive refused, kind must match, not-listed allowed, item cleared when the ticket's company changes), implement, commit `feat(categories): a category can ask which app`

### Task 5: Staff screens: the company's Categories and Software tabs

**Files:**
- Create: `frontend/src/components/companies/CompanyCategories.jsx` (the tree editor, moved from Settings and given a `companyId`), `frontend/src/components/companies/CompanySoftware.jsx`
- Modify: `frontend/src/pages/companies/CompanyPage.jsx` (tabs), `frontend/src/pages/settings/TicketCategories.jsx` (the help desk's own company only, with a pointer to company pages, as Settings → Departments)
- Test: `backend/test/smoke/companyCategories.smoke.js`

- **Categories tab:** the existing tree editor for that company, plus "Ask which app" on a category. A company with none shows an empty state: **Add the first category**. A **Copy from another company** action copies a tree as a starting point. A copy, not a link: the copies are independent (owner decision 1).
- **Software tab:** the list (name, publisher, notes, active), **Add app** (type it in) and **Add from this company's computers** (search the found-software list, tick several, add).

- [ ] **Step 1–5:** smoke tests (build a tree, copy one, a client's tree never shows on another company or in Settings; add apps by hand and from found software), implement, commit `feat(companies): Categories and Software tabs`

*As built so far (2026-11-10):* the **Categories** tab (Settings' editor, given a company) with **For** (incidents, requests or both) on each top-level category. Still to do: **Copy from another company**, the **Software** tab (with Task 3).

### Task 6: Staff and portal ticket forms

**Files:**
- Create: `frontend/src/components/tickets/CategoryStepper.jsx` (shared step-by-step picker: one level at a time, **Other / I'm not sure** at every level, the item list on a `pickKind` step with **Not listed**)
- Modify: staff new-ticket and ticket-detail category fields (scoped to the ticket's company), the portal's new-ticket page, ticket list filters
- Test: smoke tests for both

- [ ] **Step 1–5:** tests (the picker shows only the ticket company's tree; changing the ticket's company resets it; the portal requires a choice when there are categories; not sure and not listed reach the ticket), implement, commit `feat(tickets): the category stepper on staff and portal tickets`

### Task 7: The agent's Submit a ticket window

**Files:**
- Modify: `backend/src/services/agent/trayTickets.js` (`whoami` adds `categories` (the company's active tree, trimmed) and `software` (active items); `raiseTrayTicket` takes `categoryId`, `categoryUnsure`, `catalogItemId`, `notListed`, all checked against the device's company), `agent/internal/ipc` (submit carries the choice), `agent/internal/trayui/form.html` (the stepper, keyboard-friendly, in the TrayForm style), `agent/cmd/prism-tray/tray.go`
- Test: `backend/test/integration/agent.tray.test.js`, `agent/internal/trayui` tests, smoke of the form page (headless)

- Agents from before this send no category; their tickets are still accepted (and marked not sure) so an un-updated computer can always raise a ticket.

- [x] **Step 1–5:** tests (whoami carries only the device's company's tree and list; ids from another company refused; old-agent tickets accepted; the form requires a choice when there are categories; the draft kept offline includes the choice), implement, commit `feat(agent): choose a category when submitting a ticket`

*As built (2026-11-10, 11):* whoami carries the company's active categories with their type; the form asks **Ticket type** (Incident / Request, each with an ⓘ) then the categories for that type one level at a time, with Other / I'm not sure; the offline draft keeps the choices. Attachments: up to 5 files sent after the ticket as signed raw bytes (`POST /agent/v1/tray/tickets/:id/attachments`), only to the device's own tray ticket within 30 minutes, through the usual upload checks. The software list in whoami comes with Task 3.

### Task 8: Company setup checklist

**Files:**
- Create: `frontend/src/components/companies/CompanySetup.jsx`, `GET /companies/:id/setup` (counts only)
- Modify: `CompanyPage.jsx` (a **Setup** tab, first for a company whose checklist isn't complete)

- The checklist: sites, departments, contacts, ticket categories, software list, portal access, agent installed (enrollment key made, computers reporting). Each line says what's there ("3 departments") or what's missing, with a button to the tab that fixes it. It shows the state; it doesn't block anything.
- Later, outside this plan: the same checklist as a form the client's own admin fills in through the portal.

- [ ] **Step 1–5:** tests, implement, commit `feat(companies): a setup checklist`

### Task 9: Reports, docs and release

- Category reports and filters take a company (and group by company when "all"). UPGRADING (what moved where, the migration of the existing tree to the internal company), ROADMAP, and the release notes. Full suites, then the owner's hand test.

- [ ] **Commit** `docs(9): per-company categories and software lists`


## Security review (2026-11-11): categories, the agent's form and attachments

- **Company fence on categories:** every save of a ticket's category (staff create and update, bulk, portal, recurring create and runs, the agent) checks the ticket's company in `resolveCategoryForSave`; lists without a company show only the companies the caller can reach; changes need the category permission and company access (tests in `categories.company.test.js`).
- **Type fence:** a category must fit the ticket's type, everywhere a category is saved; changing the type drops one that doesn't (`categories.type.test.js`).
- **Agent input:** the category id from the tray is checked against the device's company and the chosen type; old agents' tickets are accepted as not sure.
- **Attachments from the tray:** signed raw bytes; only to the device's own tray ticket, within 30 minutes, at most 5; the usual checks (blocked extensions, content, size, virus scan). Fixes made in review: the stored type comes from the name, not the agent's say; requests without the signature headers are refused before the body is read, and the route has a per-IP limit in front of it, so unauthenticated clients can't make PRISM buffer 25 MB bodies. The tray-to-service request reader grows with what arrives (up to 32 MB) instead of reserving it.
