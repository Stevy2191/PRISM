# PRISM CS — Company settings: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One place for each setting. Your company's page is in Settings; every customer company has a one-stop page with its own SLA targets, support hours, holidays, portal (its own link), surveys, categories, and a list of what applies to it. Duplicate settings go.

**Spec:** `docs/superpowers/specs/2026-11-14-company-settings-design.md` (approved 2026-11-14, with decisions 1–7).
**Mockups:** `docs/mockups/company-settings-cs/` (approved 2026-11-14). Boards: `Main`, `YourCompany`, `Preferences`, `NewCompany`, `SlaHours`, `Portal`, `Applies`, `PortalSignIn`, `PortalShared`. Live screen wins over mockup on field names.

## Global Constraints

- **A brand-new system (decision 7).** No screen says what moved or was removed. Pages that go away go, with no redirects added. Data is converted directly so the owner's test install keeps working; no compatibility layer.
- **One place per setting.** Before adding a control, check no other screen writes the same value. A removed control's backend key and its reads go too.
- **Words:** Your company, Customer companies, Vendors; Support hours (a company's SLA clock) and Staff hours (a person's week); Satisfaction surveys.
- **The single-company install** (no customer company yet) keeps working at every step: company UI hidden, `/portal` plain.
- **Portal isolation is tested from the outside:** a contact of company A, signed in, asks for company B's records by id and gets nothing.
- Everything from earlier sub-projects still applies: look A, phone widths, fences, audit, Node 24, migrations with a round-trip test (and added to `test/integration/laterMigrations.js` and the wrapper in `companies.migration.test.js` when they touch tables older round trips rebuild), both suites before each push.
- Migrations start at **091**.

## Review Focus

- **Portal:** every portal route checks the session's company against the address; sign-in never reveals that an account exists at another company → Part 3.
- **SLA conversion:** each company ends with its own targets, hours and holidays; tickets keep working clocks → Part 2.
- **No dead settings:** every removed control's key is gone from the backend's defaults, writable keys and readers → Parts 1–3.

---

## Part 1: Structure and duplicates (no SLA or portal data change)

### Task 1.1: Your company in Settings; customers in Companies

**Files:**
- Modify: `frontend/src/pages/settings/registry.js` (sections per spec §7 that don't depend on Parts 2–3), `registry.test.js`, `App.jsx`, `components/settings/sectionIcons.js`
- Create: `frontend/src/pages/settings/YourCompany.jsx` (the internal company's page inside Settings: Profile and sign-in page, then the company parts)
- Modify: `pages/companies/CompanyPage.jsx` (a customer's page only; the internal id redirects to Settings), `CompaniesList.jsx` and `GET /companies` (the internal company is not listed), `components/companies/CompanyTag.jsx` and other links to the internal company (→ `/settings/your-company`)
- Remove: `pages/settings/CompanyProfile.jsx` (its fields move into YourCompany), the `own-departments`, `own-company-page` and `ticket-categories` registry entries; `pages/settings/TicketCategories.jsx`'s page (its rule moves to Ticket rules, 1.3)
- Test: `registry.test.js`; `backend/test/integration/companies.list.test.js`; `backend/test/smoke/yourCompany.smoke.js`

- [x] **Step 1: Failing tests:** the Companies list and its API leave out the internal company; `/settings/your-company` shows Profile, Departments, Sites, Categories, Devices for it; the company name is one field (saving it updates both `company.name` and the internal company's name); opening the internal company's id under `/companies/` lands in Settings; with no customer company, Settings › Customers shows only "Add a customer company".
- [x] **Step 2–4:** Run → FAIL; implement; run → PASS.
- [x] **Step 5: Commit** `feat(settings): Your company's page is in Settings; Companies lists customers`

### Task 1.2: A company's Setup tab, and landing on a new company

**Files:**
- Modify: `CompanyPage.jsx` (Setup parts in the spec's order; parts not built yet are simply absent), `CompaniesList.jsx` (after create → the new company's page), `CompanyGlance.jsx` and `GET /companies/:id/glance` (the setup list in the mockup's order, for the steps that exist now)
- Test: `backend/test/smoke/companies.shell.smoke.js` (updated), `companies.glance.test.js`

- [x] **Step 1: Failing tests:** creating a company opens `/companies/:id` on Overview with its setup list; Setup shows Details then Categories (more parts arrive in Parts 2–4).
- [x] **Step 2–4:** Run → FAIL; implement; run → PASS.
- [x] **Step 5: Commit** `feat(companies): a new company opens on its own page`

### Task 1.3: Duplicates that need no data change

**Files:**
- Timer: `pages/settings/Preferences.jsx` (one list of choices; text that says what happens), `TimeTracking.jsx` (only the longest entry), `backend/src/controllers/settingsController.js` (drop `timeTracking.defaultMode`, `timeTracking.defaultMinThreshold`), `usersController.js` (no seeding from them)
- Ticket rules: create `pages/settings/TicketRules.jsx` ("Require a category on new tickets", "Require time before closing"); remove the unused `showRequired` copy in the category editor; `TimeTracking.jsx` loses "require before close"
- Notifications: `EmailTemplates.jsx` (no "Send this email" switch on staff notification templates), `backend/src/services/email/ticketMail.js`, `projectMail.js` (don't read the template's `enabled` for those), one list of default events shared by `settingsController.js`, `notificationMail.js` and `Notifications.jsx`
- Time zones: one list in `frontend/src/utils/timeZones.js`, used by every picker
- Merged pages: `Directory.jsx` (sign-in and sync), `Email.jsx` (incoming and outgoing; outgoing offers "same as incoming"); registry entries for the four old pages go
- Names: "Staff hours" (was Hours people work), "Calendar apps" (Settings) and "My calendars" (Preferences)
- Test: `backend/test/integration/preferences.test.js`, `settings.test.js`, `email.notifications.test.js` (updated); `backend/test/smoke/settings.smoke.js` (updated); `frontend/src/utils/timeZones.test.js`

- [x] **Step 1: Failing tests:** the two timer defaults are not writable and a new local account starts on manual; a staff notification is decided by the default and the person's choice only; the defaults list is the same on server and screen; Ticket rules saves both rules; the merged pages save what the old ones did.
- [x] **Step 2–4:** Run → FAIL; implement; run → PASS.
- [x] **Step 5: Commit** `feat(settings): one place for the timer, ticket rules, notification switches and time zones`

### Task 1.4: Part 1 finish

- [x] Full backend suite, whole smoke suite, `npm test` in `frontend`. `UPGRADING.md` one plain entry. Commit `docs(settings): part 1 notes`, push.

---

## Part 2: SLA targets, support hours and holidays per company

### Task 2.1: Migration 091 and the models

**Files:**
- Create: `backend/migrations/20260101000091-company-sla.js`
- Modify: `models/SlaPolicy.js` (`companyId`, unique, null for the starting values; `timezone` moves here from the schedule; `schedule`, `is24x7` on the policy), `models/Holiday.js` (`slaPolicyId`), `models/Company.js` (drop `slaPolicyId`), `models/index.js`; remove `models/BusinessHours.js`, `models/HolidayList.js`
- Test: `backend/test/integration/companySla.migration.test.js`; `laterMigrations.js`, `companies.migration.test.js`

**What 091 does:** for each company, one policy row of its own: a copy of the policy it is on (the default when none), with that policy's schedule, time zone (the org zone when 24×7) and holidays; `TicketSlas.slaPolicyId` → the ticket's company's row; the default becomes the starting values (`companyId` null, `isDefault` gone); other shared policies, `BusinessHours`, `HolidayLists`, `Companies.slaPolicyId`, `BusinessHours.departmentId` are dropped; workflow actions `set_sla_policy` are deleted. Down rebuilds one shared default from the starting values.

- [x] **Step 1: Failing tests** (round trip; every company has exactly one row; tickets point at their company's; the starting values row exists). **Step 2–4.** **Step 5: Commit** `feat(sla): each company has its own targets, hours and holidays (migration 091)`

### Task 2.2: The engine

**Files:** `services/sla/calendar.js` (calendar from the company's policy row), `ticketSla.js` (`selectPolicyId` = the company's row), `services/workload/index.js` and `capacity.js` (holidays = the internal company's), `services/companyService.js` (creating a company copies the starting values), `services/workflowEngine.js` and `workflowRulesController.js` (no `set_sla_policy`), `utils/orgTime.js` callers in `ticketSla.js` and `controllers/tickets/dueDate.js` (the ticket's company's zone)
- Test: `sla.clocks.test.js`, `sla.duedates.test.js`, `workload.test.js`, `test/unit/*` (updated), new `companySla.engine.test.js`

- [x] **Step 1: Failing tests:** two companies with different hours and zones get different due dates for the same ticket; a holiday of one stops only its clock; a new company starts with a copy; workload follows only your company's holidays. **Step 2–4.** **Step 5: Commit** `feat(sla): the clock follows the ticket's company`

### Task 2.3: API and screens

**Files:**
- Backend: `routes/companies.js`, new `controllers/companySlaController.js` (`GET/PUT /companies/:id/sla` targets, hours, zone, warn %; `POST/DELETE /companies/:id/holidays`; `POST /companies/:id/sla/reset`), `GET/PUT /sla/starting-values`; remove `/sla-policies`, `/business-hours`, `/holiday-lists`
- Frontend: create `components/companies/CompanySla.jsx` (per the `SlaHours` mockup), `pages/settings/StartingValues.jsx`; `CompanyPage.jsx` and `YourCompany.jsx` gain the part; `CompanyGlance` steps; remove `SLAs.jsx`, `SlaPolicyEditor.jsx`, `BusinessHours.jsx`, `Holidays.jsx`, the SLA select in `CompanyOverview.jsx`, the rule editor's action; `SlaPanel.jsx` shows no policy name
- Test: `companySla.api.test.js`; smoke `companySla.smoke.js` (replaces `sla.settings.smoke.js`)

- [x] **Step 1–4.** **Step 5: Commit** `feat(companies): Setup › SLA and hours`

### Task 2.4: Part 2 finish

- [x] Suites, notes, push.

---

## Part 3: A portal per company; surveys per company

### Task 3.1: Migration 092 and the rules

**Files:**
- Create: `backend/migrations/20260101000092-company-portal.js` (`Companies.portalEnabled` default false, `portalSlug` unique, `csatEnabled` default true; companies with any contact holding portal access get the portal on and a slug; drop the settings `portal.enabled` and `csat.enabled`)
- Create: `services/portal/company.js` (`slugFor`, `findBySlug`, `portalOpen(company)`: enabled and active), modify `middleware/portalAuth.js`, `controllers/portal/authController.js`, `services/portal/sessions.js`, `services/microsoft365/signIn.js`
- Test: `portal.company.test.js`

**Rules:** sign-in is `POST /portal/:slug/login`; a session stores its company; every portal request carries the slug and is refused unless the session's company is that company and its portal is open; a contact of another company gets the same INVALID_CREDENTIALS; Microsoft sign-in at a slug accepts only that company's tenant; with no customer company, the internal company's slug is implied by the plain address.

- [x] **Step 1: Failing tests:** all of the rules above, plus isolation: signed in at A, requests for B's tickets, attachments, articles, people and devices by id answer 404; an inactive company or a portal turned off refuses sign-in and ends sessions. **Step 2–4.** **Step 5: Commit** `feat(portal): each company has its own portal (migration 092)`

### Task 3.2: The portal's pages and emails

**Files:** `frontend/src/portal/*` (routes under `/portal/:slug`; the sign-in page names the company; `/portal` is the "use your company's link" page with "Email me my link", or the internal company's portal when there are no customers), `services/portal/portalMail.js` and `services/email/*` (links built from the contact's company's slug), `POST /portal/link` (always the same answer)
- Test: smoke `portal.company.smoke.js`; `portal.mail.test.js`

- [x] **Step 1–4.** **Step 5: Commit** `feat(portal): the company's own sign-in page and links`

### Task 3.3: Setup › Portal and Setup › Surveys

**Files:** create `components/companies/CompanyPortal.jsx` (switch, link, change the name, who can sign in with Invite and "Invite everyone", portal admins, Microsoft 365), `CompanySurveys.jsx`; backend `GET/PUT /companies/:id/portal`, `POST /companies/:id/portal/invite-all`, `PUT /companies/:id/surveys`; `csatService.js` and `csatScheduler.js` read the company's switch; `ClientPortal.jsx` and `CustomerHappiness.jsx` lose their on/off; the survey template loses "Send this email"; portal admins and Microsoft 365 leave their old parts
- Test: `companyPortal.api.test.js`, `csat.company.test.js`; smoke `companyPortal.smoke.js`

- [x] **Step 1–4.** **Step 5: Commit** `feat(companies): Setup › Portal and Surveys`

### Task 3.4: Part 3 finish

- [x] Suites, a security pass over the portal routes, notes, push.

---

## Part 4: What applies here

### Task 4.1: Lists and the bundle switch

**Files:** backend `GET /companies/:id/applies` (bundles with offered yes/no; rules whose conditions name the company's departments or categories, and the count that apply to all; recurring tickets of the company's contacts; custom fields on its categories), `PUT /companies/:id/bundles/:playbookId { offered }` (edits `Playbook.companyIds`); frontend `components/companies/CompanyApplies.jsx` (per the `Applies` mockup), "New for this company" opens the recurring editor with the company chosen
- Test: `companyApplies.test.js`; smoke `companyApplies.smoke.js`

- [x] **Step 1–4.** **Step 5: Commit** `feat(companies): Setup › What applies here`

### Task 4.2: Finish

- [x] Sweep the words; `UPGRADING.md`; `docs/ROADMAP.md` row CS → Shipped; full suites; screenshots of the built screens beside the mockups; push.
