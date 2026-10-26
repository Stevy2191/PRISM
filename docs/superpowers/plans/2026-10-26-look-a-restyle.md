# Look A Restyle (sub-project 6b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle Tickets, Dashboard, Assets, Contacts, Companies, Knowledge (staff and public), Reports, Settings and Sign in to the approved look A mockups, changing behaviour only where the user approved it.

**Architecture:** Frontend-only. Each area's pages are re-laid-out to match its boards in `docs/mockups/look-a-6b/`, using the look A tokens and classes in `frontend/src/index.css` and the primitives in `frontend/src/components/ui/`. Four small shared pieces are added first (PageHeader, Breadcrumbs, FiltersSheet, PillRow), then the areas are done one by one, each landing whole (dark, light, phone).

**Tech Stack:** React 18 + Vite + Tailwind, recharts (Reports), Jest + Playwright smoke tests (`backend/test/smoke`), `node --test` for frontend helpers.

**Spec:** `docs/superpowers/specs/2026-10-26-look-a-restyle-design.md`

## Global Constraints

- Visual restyle only. The only behaviour changes are the six in the spec's "Approved behaviour changes". Anything else a mockup seems to imply: stop and ask.
- Where a mockup and the live screen disagree on a field, column, action or label, the live screen wins.
- Dark is the default theme: build and check dark first, then light.
- Colours come from `--color-*` variables (Settings → Appearance must still repaint them). No new hard-coded hex except database status colours and the existing per-person avatar hues.
- Phone (390 px): 16 px side gutter, no horizontal page scroll, 44 px touch targets.
- No new dependencies, no backend changes, no new `dangerouslySetInnerHTML`.
- Keep every existing accessible name; add labels where a control has none.
- Node 24 for all test commands: `export PATH=~/.nvm/versions/node/v24.18.0/bin:$PATH`.
- One smoke file: `cd backend && npm --prefix ../frontend run build && NODE_OPTIONS="--experimental-vm-modules --max-old-space-size=3072" npx jest -c jest.smoke.config.js test/smoke/<file>`.
- Full backend and smoke suites run once, in the last task, before pushing to dev.

## Review Focus

- **Custom colours:** with a custom accent set in Settings → Appearance, restyled pages must use it, not the default blue → `lookA.smoke.js` "custom accent reaches restyled pages" (Task 13).
- **Phone overflow with long content:** a 200-character ticket title, a long company name or email must not create horizontal page scroll at 375 px → `lookA.smoke.js` phone-overflow loop over every restyled route, seeded with long values (Task 1, routes added per task).
- **Lower permissions:** restyled headers must still hide actions the user can't use (New article without `kb.manage`, Export CSV without `reports.export`, Edit title without edit access) → per-area smoke checks as a view-only user (Tasks 3, 8, 9).
- **Keyboard in the Filters sheet:** Esc closes it, focus returns to the Filters button, Tab stays inside while open → `lookA.smoke.js` (Task 1).
- **Empty states:** no articles, no report data, no licenses — restyled empty states still render their message and their create action → covered in each area's smoke file (Tasks 6, 8, 9).

---

### Task 1: Shared pieces, mockups in the repo, the look A smoke harness

**Files:**
- Add (already copied, commit them): `docs/mockups/look-a-6b/*`, `docs/superpowers/specs/2026-10-26-look-a-restyle-design.md`, this plan
- Create: `frontend/src/components/ui/PageHeader.jsx`, `frontend/src/components/ui/Breadcrumbs.jsx`, `frontend/src/components/ui/FiltersSheet.jsx`, `frontend/src/components/ui/PillRow.jsx`
- Modify: `frontend/src/pages/tickets/Tickets.jsx` (its inline bottom sheet, ~lines 838–905, becomes `<FiltersSheet>`; quick-filter pills on phone use `<PillRow>`)
- Create: `backend/test/smoke/lookA.smoke.js`

**Interfaces:**
- Produces:
  - `PageHeader({ title, sub?, crumbs?, actions?, className? })` — `crumbs` is passed to Breadcrumbs; renders `<h1 className="page-title">`.
  - `Breadcrumbs({ items: [{ label, to? }] })` — `<nav aria-label="Breadcrumb">`, last item has `aria-current="page"` and no link.
  - `FiltersSheet({ open, onClose, title = 'Filters', children })` — `role="dialog"`, `aria-modal="true"`, `aria-label={title}`; overlay click and Esc call `onClose`; focus moves into the sheet on open, Tab is trapped, focus returns to the element focused before opening; a "Done" button calls `onClose`. Rendered only below `lg`.
  - `PillRow({ label, children })` — `role="group" aria-label={label}`, one row, `overflow-x-auto`, no wrap, hides the scrollbar.
  - `lookA.smoke.js` exports nothing; it holds `PHONE_ROUTES` (array of `{ name, path, as = 'admin', before?: async (page) => void }`; `as: null` means signed out) that later tasks extend.

- [ ] **Step 1: Write the failing smoke tests** in `lookA.smoke.js` (world from `makeWorld()`; one ticket titled `'X'.repeat(200)`; a company named `'Riverside Family Clinic and Associated Practices of the Greater Valley'`):
  - `it('Filters sheet: opens, traps Tab, Esc closes and focus returns')` — at `{ viewport: { width: 375, height: 812 } }`, `/tickets`: click button "Filters" → `getByRole('dialog', { name: 'Filters' })` visible; press Tab 15× → `document.activeElement` is inside the dialog; press Escape → dialog hidden and the focused element's accessible name is "Filters".
  - `it.each(PHONE_ROUTES)('no horizontal page scroll at 375px: %s')` — `document.documentElement.scrollWidth <= clientWidth`. Start with `[{ name: 'tickets', path: '/tickets' }]`.
- [ ] **Step 2: Run** `lookA.smoke.js` → the Filters test FAILS (no dialog role / Esc does nothing).
- [ ] **Step 3: Implement** the four components and switch `Tickets.jsx` to them. Styling follows the TicketsPhone board (sheet: card surface, 16 px radius top corners, 85vh max).
- [ ] **Step 4: Run** `lookA.smoke.js` and `desktools.smoke.js` → PASS.
- [ ] **Step 5: Commit** — `feat(look): shared PageHeader, Breadcrumbs, FiltersSheet and PillRow for 6b` (include the mockups, spec and plan).

### Task 2: Tickets list and board

**Files:** Modify `frontend/src/pages/tickets/Tickets.jsx`, `pages/tickets/list/{Cells.jsx,TicketBoard.jsx,BulkActionBar.jsx,ColumnsMenu.jsx,SavedFiltersMenu.jsx}`, `pages/tickets/theme.js`.
Boards: `Main`, `Board`, left phone of `TicketsPhone`.

- [ ] **Step 1:** Add `{ name: 'tickets board', path: '/tickets', before: (p) => p.getByRole('button', { name: 'Board' }).first().click() }` to `PHONE_ROUTES` (the board is a view toggle, not a URL); run it and keep it whatever the result — it must PASS by Step 4.
- [ ] **Step 2: Restyle** header (title, count sub line, New ticket), filter pills + selects toolbar, table (13 columns default unchanged, sticky header, row heights, status/priority/SLA cells per board), bulk bar, board columns and cards, phone card list. Columns menu behaviour unchanged.
- [ ] **Step 3: Visual check** — `node docs/mockups/look-a-6b/preview.js Main Main:dark Board TicketsPhone` vs screenshots of the built page (see Task 13 step 1 for the screenshot helper; until then use `pageAs` in a scratch script).
- [ ] **Step 4: Run** `lookA.smoke.js`, `desktools.smoke.js`, `companies.tickets.smoke.js`, `sla.tickets.smoke.js`, `waiting.smoke.js` → PASS.
- [ ] **Step 5: Commit** — `style(tickets): list and board in look A`.

### Task 3: A ticket (desktop, and the phone ⋯ menu and collapsed reply)

**Files:** Modify `pages/tickets/TicketDetail.jsx`, `pages/tickets/detail/{ConversationTab.jsx,ReplyBox.jsx,Sidebar.jsx,SlaPanel.jsx,Badges.jsx,TicketText.jsx,ActivityTab.jsx,AttachmentsTab.jsx,RelationshipsTab.jsx,ResolutionTab.jsx}`, `frontend/src/index.css` (`.conv-bubble*`, `.ticket-tab*` rules).
Create `backend/test/smoke/ticketPhone.smoke.js`.
Boards: `Ticket`, right phone of `TicketsPhone`.

**Interfaces:**
- Produces: `ReplyBox` gains prop `collapsible: boolean` (true below `md`); collapsed it renders one textbox named "Reply" that expands the full box on focus/tap.

- [ ] **Step 1: Write failing smoke tests** in `ticketPhone.smoke.js` (375×812, admin, one ticket):
  - `'Link ticket, Merge and Report are in the ⋯ menu on a phone'` — `getByRole('button', { name: 'More actions' })` click → menuitems "Link ticket", "Merge…", "Report" visible; none of them visible as top-level buttons before opening.
  - `'the reply box starts as one line and expands on tap'` — textbox "Reply" visible, "Send" button not visible; click the textbox → Send visible.
  - `'desktop keeps Link ticket, Merge and Report as buttons'` — 1440×900: the three buttons visible without a menu.
  - `'a view-only user sees no Edit title'` — reuse `makeStaff('viewer', …)`; no button "Edit title".
- [ ] **Step 2: Run** → the first two FAIL.
- [ ] **Step 3: Implement** the phone header menu (`<details>`-free: a button with `aria-haspopup="menu"`, `aria-expanded`, menu `role="menu"`, Esc closes) and `ReplyBox collapsible`. Restyle header, tabs, single-column tinted conversation (replies `--color-accent-soft` tint, private amber `--color-waiting-bg`; drop the hard-coded `[data-theme]` bubble colours in favour of tokens), description card, sidebar details, SLA panel.
- [ ] **Step 4: Run** `ticketPhone.smoke.js`, `ticketEdit.smoke.js`, `desktools.smoke.js`, `email.smoke.js`, `virusscan.smoke.js`, `sla.tickets.smoke.js` → PASS.
- [ ] **Step 5: Commit** — `style(tickets): ticket page in look A; phone actions menu and one-line reply`.

### Task 4: New ticket (two-column regroup)

**Files:** Modify `pages/tickets/TicketNew.jsx`, `pages/tickets/new/*.jsx`. Board: `TicketNew`.

- [ ] **Step 1: Write failing smoke test** (append to `ticketPhone.smoke.js` or a new `ticketNew.smoke.js`): `'New ticket groups fields under The problem, Who it's for, Who's on it'` — `getByRole('group', { name: "The problem" })` contains textbox "Title"; group "Who it's for" contains the contact picker; group "Who's on it" contains the assignee control; submitting with Title empty still shows today's required message.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** with `<fieldset>`/`<legend>` per group in a two-column grid (one column below `lg`). Same fields, same `required`, same order within each group as today.
- [ ] **Step 4: Run** the new test + `categories.smoke.js`, `companies.tickets.smoke.js` → PASS.
- [ ] **Step 5: Commit** — `style(tickets): new ticket form in two groups`.

### Task 5: Dashboard

**Files:** Modify `pages/Dashboard.jsx` (split panel components out into `pages/dashboard/` only if the file gets harder to follow). Boards: `Dashboard`, `DashAdmin`, `DashPhone`.

- [ ] **Step 1:** Add `{ name: 'dashboard', path: '/dashboard' }` to `PHONE_ROUTES`.
- [ ] **Step 2: Restyle** stat tiles, panels (lists, hours bars, CSAT), customize mode (drag handles, hide/show, Add panel) per DashAdmin; phone single column per DashPhone. Panel set, order logic and drag-drop unchanged.
- [ ] **Step 3: Run** `lookA.smoke.js`, `login.smoke.js` → PASS.
- [ ] **Step 4: Commit** — `style(dashboard): look A`.

### Task 6: Assets list, an asset, and the phone Filters sheet

**Files:** Modify `pages/Assets.jsx`, `pages/AssetDetail.jsx`, `pages/assets/*`, `components/AssetsSubNav.jsx`. Create `backend/test/smoke/assetsLook.smoke.js`. Boards: `AssetsList`, `AssetDetail`, `AssetsPhone`.

- [ ] **Step 1: Write failing smoke tests** in `assetsLook.smoke.js`:
  - `'on a phone the asset filters are behind Filters'` — 375 px `/assets`: comboboxes "Category", "Department", "Status", "Assigned to" not visible; click "Filters" → dialog "Filters" contains them; pick a Status → list refreshes (row count changes as seeded); Done closes.
  - `'desktop keeps the filters inline'` — 1440 px: the four comboboxes visible.
  - `'an asset page has a breadcrumb back to Assets'` — `getByRole('navigation', { name: 'Breadcrumb' })` link "Assets" → `/assets`.
  - `'no assets shows the empty state and New asset'`.
- [ ] **Step 2: Run** → FAIL (selects have no labels; no sheet).
- [ ] **Step 3: Implement** — add `aria-label`s to the four selects, inline toolbar ≥ `lg`, `FiltersSheet` below. Restyle list, detail header (breadcrumb, tag, category, status), tabs, cards. Add `/assets` and one asset page to `PHONE_ROUTES`.
- [ ] **Step 4: Run** `assetsLook.smoke.js`, `companies.assets.smoke.js`, `lookA.smoke.js` → PASS.
- [ ] **Step 5: Commit** — `style(assets): list and asset page in look A; phone Filters sheet`.

### Task 7: Licenses and contracts

**Files:** Modify the license/contract list and detail pages under `pages/assets/` and `components/{LicenseFormModal,ContractFormModal}.jsx` (modal styling only). Boards: `Licenses`, `LicenseDetail`, `Contracts`, `ContractDetail`.

**Interfaces:** Consumes `Meter` from `components/ui/Meter.jsx` for seat usage (`used` = seats assigned, `budget` = seat count; omit for unlimited).

- [ ] **Step 1:** Append to `assetsLook.smoke.js`: `'licenses list shows a seat meter'` — row for a 25-seat license with 23 assigned has text "23/25" and a `role="meter"` (or the Meter's existing role) with value 23; `'no licenses shows the empty state'`.
- [ ] **Step 2: Run** → FAIL; **implement** the restyle (breadcrumbs, masked key row as today, seats tab).
- [ ] **Step 3: Run** `assetsLook.smoke.js` → PASS.
- [ ] **Step 4: Commit** — `style(assets): licenses and contracts in look A`.

### Task 8: Contacts and companies

**Files:** Modify `pages/Contacts.jsx`, `pages/ContactDetail.jsx`, `pages/companies/*`, `components/companies/*` (visual only). Boards: `ContactsList`, `ContactDetail`, `CompaniesList`, `CompanyPage`, `ContactsPhone`.

- [ ] **Step 1:** Add contacts list, a contact, companies list and the long-named company to `PHONE_ROUTES`; add to `companies.page.smoke.js`: `'company status shows as a chip'` (`getByText('Client')` has the chip class / is inside the header). Run → FAIL.
- [ ] **Step 2: Restyle** per boards: contact page keeps its three regions and inline editing (no Edit button); company status chip; breadcrumbs on detail pages.
- [ ] **Step 3: Run** all `companies.*.smoke.js`, `lookA.smoke.js` → PASS.
- [ ] **Step 4: Commit** — `style(contacts): contacts and companies in look A`.

### Task 9: Knowledge — staff pages and phone pills/Filters

**Files:** Modify `pages/KnowledgeBase.jsx`, `pages/ArticleView.jsx`, `pages/ArticleEditor.jsx`, `components/RichTextEditor.jsx` (toolbar styling only), `index.css` `.kb-content` (headings, code, blockquote per KbArticle). Create `backend/test/smoke/knowledgeLook.smoke.js`. Boards: `KbList`, `KbArticle`, `KbEditor`, left phone of `KbPhone`.

- [ ] **Step 1: Write failing smoke tests** (seed two categories with one article each, one draft):
  - `'phone: categories are a row of pills that filter the list'` — 375 px `/knowledge`: `getByRole('group', { name: 'Categories' })` has buttons "All articles", "Network & VPN"…; click "Network & VPN" → only its article listed.
  - `'phone: Audience and Status are behind Filters'` — selects hidden until Filters opens; choosing Status "Draft" lists only the draft.
  - `'desktop keeps the category rail'` — 1440 px: `getByRole('navigation', { name: 'Categories' })` visible.
  - `'without kb.manage there is no New article, Edit or Delete'` — as a staff user without `kb.manage`.
  - `'no articles shows the empty state'`.
  - `'an article has a breadcrumb back to Knowledge Base'`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** — rail ≥ `lg`, `PillRow label="Categories"` + `FiltersSheet` below; single-card article list; article on a card with breadcrumbs; editor per KbEditor (toolbar unchanged in buttons and titles).
- [ ] **Step 4: Run** `knowledgeLook.smoke.js` → PASS.
- [ ] **Step 5: Commit** — `style(knowledge): staff pages in look A; phone category pills and Filters`.

### Task 10: Public Help Center (`/kb`)

**Files:** Modify `pages/kb/KbPortal.jsx`, `pages/kb/KbPortalArticle.jsx` (extract their duplicated header into `pages/kb/PortalShell.jsx`). Boards: `KbPortal`, `KbPortalArticle`, right phone of `KbPhone`.

- [ ] **Step 1:** Append to `knowledgeLook.smoke.js`: `'public Help Center lists categories and opens an article, signed out'` (fresh context, no login) and add `/kb` to `PHONE_ROUTES` with an unauthenticated page. Run → PASS before and after (guard test).
- [ ] **Step 2: Restyle** per boards; keep the bare axios client, "Staff sign in →" and "Back to Help Center".
- [ ] **Step 3: Run** `knowledgeLook.smoke.js` → PASS.
- [ ] **Step 4: Commit** — `style(kb): public Help Center in look A`.

### Task 11: Reports

**Files:** Modify `pages/Reports.jsx`, `pages/reports/shared.jsx`, `pages/reports/CustomReportBuilder.jsx`, each `pages/reports/*Report.jsx` only where it bypasses `shared.jsx` (raw `bg-red-50` errors → `Notice tone="bad"`). Create `backend/test/smoke/reportsLook.smoke.js`. Boards: `ReportsVolume`, `ReportsCustom`, `ReportsPhone`.

**Interfaces:**
- `shared.jsx` keeps its exports (`StatCard`, `ChartCard`, `SimpleBarChart`, `GroupedBarChart`, `MultiLineChart`, `DonutChart`, `SortableTable`, `PALETTE`, `formatHours`). `SimpleBarChart` gains `layout = 'vertical' | 'horizontal'` (default vertical) and always labels bar values; default bar colour is `var(--color-accent)`; `colorForName` still wins (status chart).
- `CustomReportBuilder` passes `layout="horizontal"` to the bar chart when `groupBy` is `assignee` or `tech` (people); every other grouping stays vertical, and month keeps the line chart.

- [ ] **Step 1: Write failing smoke tests:**
  - `'phone: presets are a row of pills; Department, Company and Assignee are behind Filters'` — 375 px `/reports`: `getByRole('group', { name: 'Date range' })` contains "This month" pressed; combobox "Department" hidden until Filters opens.
  - `'phone: picking Last month changes the range'` — click pill → request to `/reports/ticket-volume` carries the last-month `startDate` (wait on response URL).
  - `'the report name is a heading'` — `getByRole('heading', { name: 'Ticket Volume' })`.
  - `'without reports.export there is no Export CSV'`.
  - `'a report with no data shows No data.'` (fresh range with no tickets: Custom range in the future).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** the shell (nav rail, phone dropdown unchanged in behaviour), filter card, `PillRow label="Date range"` with `aria-pressed`, `FiltersSheet`, chart styling in `shared.jsx` (solid faint grid `--color-border`, 4 px top radius, value labels, tooltip on card surface), builder steps per ReportsCustom.
- [ ] **Step 4: Run** `reportsLook.smoke.js`, and `cd frontend && node --test src/pages/reports/presets.test.js` → PASS.
- [ ] **Step 5: Commit** — `style(reports): look A; phone date pills and Filters`.

### Task 12: Settings

**Files:** Modify `components/settings/{SettingsShell,SettingsMenu,SettingsPage,SaveBar}.jsx`, `pages/settings/SettingsHome.jsx`, `pages/AdminUsers.jsx`, `pages/RoleEditor.jsx`, `components/Collapsible.jsx`, `components/Switch.jsx`; then sweep `pages/settings/*.jsx`, `pages/Admin*.jsx`, `pages/UserDetail.jsx` for raw palette classes (`bg-red-50`, `text-red-700`, `bg-amber-50`, `bg-sky-50`, `bg-violet-100`, `bg-navy-50` notices) → `Notice` / `StatusChip` / tokens. Boards: `SettingsHome`, `CompanyProfile`, `RoleEditor`, `UsersList`, `SettingsPhone`.

- [ ] **Step 1:** Add to `settings.smoke.js`: `'Users shows the username under the name'` — the row for `dortiz`-like fixture user has the username inside the Name cell and there is no "Username" column header. Run → FAIL.
- [ ] **Step 2: Restyle** shell/menu/page/panel/row/save bar (one change carries every settings page), home grid with status hints, Users table, Role editor (scope segment, collapsible sections with "N/M granted", switches), phone menu sheet. Then the sweep. Add `/settings` and `/settings/company` to `PHONE_ROUTES`.
- [ ] **Step 3: Run** `settings.smoke.js`, `users.accounts.smoke.js`, `owner.smoke.js`, `sla.settings.smoke.js`, `work.settings.smoke.js`, `companies.settings.smoke.js`, `projectTemplates.smoke.js`, `lookA.smoke.js` → PASS.
- [ ] **Step 4: Commit** — `style(settings): look A shell, home, users and roles; colour sweep`.

### Task 13: Sign in, change password, final checks, push

**Files:** Modify `pages/Login.jsx`, `pages/ChangePassword.jsx`. Modify `backend/test/smoke/lookA.smoke.js`. Modify `docs/ROADMAP.md` (row 6b → Done, date, commit), `UPGRADING.md` (one line under Unreleased: "PRISM's remaining screens use look A; phone filters on Assets, Knowledge and Reports moved behind a Filters button").

- [ ] **Step 1: Write failing/guard tests** in `lookA.smoke.js`:
  - `'sign in shows the Company profile tagline and bullets'` — set tagline and two bullets via the settings API; `/login` shows both; no element with text "AUTHENTICATE".
  - `'custom accent reaches restyled pages'` — set a custom accent (`#0f766e`) as in `look.smoke.js`; on `/reports` and `/knowledge` the primary button's computed background is `rgb(15, 118, 110)`.
  - Add `/login` (signed out) and `/change-password` to `PHONE_ROUTES`.
  - Opt-in screenshot helper: `describe.skip` unless `LOOK_SHOTS=1`, screenshots every `PHONE_ROUTES` entry plus the desktop routes at 1440 and 390, dark and light, into `$OUT`.
- [ ] **Step 2: Run** → the tagline test FAILs on "AUTHENTICATE".
- [ ] **Step 3: Implement** Login and ChangePassword per boards (keep caps-lock warning, show/hide password, SSO buttons, `?ssoError`, must-change redirect).
- [ ] **Step 4: Run** `lookA.smoke.js`, `login.smoke.js`, `look.smoke.js` → PASS. Then `LOOK_SHOTS=1` once and compare every screen against `preview.js` output, dark and light; fix drift.
- [ ] **Step 5: Full suites** — `cd backend && npm test` (expect all green, ≥1823) and `npm run test:smoke` (expect all green, ≥202 plus the new tests).
- [ ] **Step 6: Commit and push** — `style(login): look A sign in and change password; 6b done`, then `git push origin dev`.
