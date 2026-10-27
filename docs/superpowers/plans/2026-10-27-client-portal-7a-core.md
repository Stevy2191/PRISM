# Client portal 7a — portal core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Contacts sign in to a portal (email + password from an invite), raise and reply to tickets they may see, and read the knowledge base meant for them; staff manage access, admins and contact watchers.

**Architecture:** A separate contact identity: its own session cookie mounted only on `/api/v1/portal`, its own middleware, and one scoping service every portal query goes through. Ticket creation and customer replies reuse the existing ticket services (`createTicket`, the inbound email reply path) with a system actor and a new contact author. The frontend portal is its own route tree under `/portal` with its own API client. Microsoft 365 (sign-in, sync, detected departments) is plan **7b**; 7a leaves hooks for it.

**Tech Stack:** Express, Sequelize, MariaDB, express-session, bcryptjs; React 18 + Vite + Tailwind (look A); Jest + supertest integration tests; Playwright smoke tests (`backend/test/smoke`).

**Spec:** `docs/superpowers/specs/2026-10-27-client-portal-design.md`
**Mockups:** `docs/mockups/client-portal-7/` (`node preview.js Tickets:dark` from that folder; approved 2026-10-27). Live screen wins over mockup on field and status names.

## Global Constraints

- Only contacts use the portal; staff use PRISM. **Separate identities**: a contact session is never accepted by a staff route, a staff session never by a portal route, and both can coexist in one browser.
- **Every portal query is scoped on the server** (own / watcher / department admin / company admin for tickets; public comments only; attachments of visible tickets only; articles by audience).
- Contacts **create and reply only**: no edit, close, reopen, priority or category change after creation.
- New ticket: **title and description required**; attachments, category, priority optional; **For** only for department/company admins and only for contacts they cover.
- Portal replies are customer replies (status → User responded as for email replies, never reopening a closed ticket) **recorded as written by that contact**.
- CC does not grant portal visibility; **contact watchers** do.
- Knowledge base readable **only when signed in**; article audience: Agents only, or Portal with **all companies / chosen companies / chosen departments** (several allowed). Existing "End users" articles become Portal, all companies. `/kb` forwards to the portal sign-in.
- Invite/reset links: random, single-use, stored hashed, expire after **72 hours**, invalidated by use or by a newer link. Forgot password never reveals whether an email exists.
- Passwords: `validatePassword` from `src/utils/passwordPolicy.js`, bcryptjs as for staff; login rate-limited like staff login.
- Access ends at the **next portal request** when portal access is off, the contact is inactive, or the portal is switched off.
- New permission **`portal.manage`** ("Manage portal access"), granted only to System Administrator; owners pass all checks as today. Respect limited company access (`companyFence`).
- Uploaded attachments go through virus scanning (5d) exactly like staff uploads.
- Audit-log: sign-ins, invites, access changes.
- Look A; organization branding (Company profile); phone width works (16 px gutter, 44 px targets).
- Node 24 for tests (`export PATH=~/.nvm/versions/node/v24.18.0/bin:$PATH`). Migrations reversible and round-trip tested. Full backend and smoke suites once before pushing; push to dev when green.

## Review Focus

- **A contact guessing ids:** every portal endpoint with an id (ticket, comment attachment, article slug, "For" contact, category) must 404 (not 403, no existence leak) outside scope → integration tests in Tasks 3, 4, 6.
- **Session crossover:** a browser signed in as both staff and contact keeps both; signing out of one leaves the other; a contact cookie on `/api/v1/tickets` is 401 → Task 2.
- **Admin role after a move:** department changed → old department admin removed; company changed → all admin roles removed (contact edit and any later sync) → Task 5.
- **Private data in the portal:** private comments, staff-only attachments, internal notes, time entries never appear in any portal payload → Task 4 (payload shape test asserts an exact key allow-list).
- **Long or hostile input:** 255-char title limit, empty description, HTML in a reply rendered as text, oversized/disallowed attachments refused like staff uploads → Task 4.

---

### Task 1: Data model, permission and settings

**Files:**
- Create: `backend/migrations/20260101000072-client-portal.js`
- Create: `backend/src/models/PortalToken.js`, `backend/src/models/CompanyPortalAdmin.js`, `backend/src/models/DepartmentPortalAdmin.js`, `backend/src/models/KbArticleAudience.js`
- Modify: `backend/src/models/Contact.js`, `TicketWatcher.js`, `Comment.js`, `Ticket.js`, `KbArticle.js`, `backend/src/models/index.js` (associations), `backend/src/controllers/settingsController.js` (default `portal.enabled` = `'false'`)
- Test: `backend/test/integration/portal.model.test.js`, plus the repo's migration round-trip test for 072

**Interfaces — Produces:**
- `Contact.portalAccess` BOOLEAN default false; `Contact.passwordHash` STRING null; `Contact.portalLastSignInAt` DATE null.
- `PortalToken { id, contactId, kind: ENUM('invite','reset'), tokenHash STRING(64) (sha256 hex), expiresAt, usedAt null }`.
- `CompanyPortalAdmin { companyId, contactId }` unique pair; `DepartmentPortalAdmin { departmentId, contactId }` unique pair.
- `TicketWatcher.userId` becomes nullable; new `TicketWatcher.contactId` nullable; exactly one of the two set (model validation + DB CHECK where MariaDB allows).
- `Comment.authorContactId` INTEGER null (FK Contacts).
- `Ticket.portalCreatedByContactId` INTEGER null (who raised it in the portal, when different from `contactId`).
- `KbArticle.visibility` ENUM gains `'portal'`; data migration `'public'` → `'portal'`; new `KbArticle.portalScope` ENUM('all','companies','departments') default 'all'; `KbArticleAudience { articleId, companyId null, departmentId null }` (exactly one set).
- Permission row `portal.manage` (category `portal`, label "Manage portal access"), granted to the System Administrator role.

- [ ] **Step 1: Write failing tests** — `portal.model.test.js`: a watcher with neither or both of userId/contactId is rejected; `CompanyPortalAdmin` duplicate pair rejected; after migrating up, an article that was `public` reads `portal` + `all`; `portal.manage` exists and System Administrator holds it, System Technician does not; settings default `portal.enabled === 'false'`. Add 072 to the migration round-trip test.
- [ ] **Step 2: Run** `npx jest test/integration/portal.model.test.js` → FAIL (models missing).
- [ ] **Step 3: Implement** the migration (follow `laterMigrations.js` rules and the round-trip gotchas in memory: down must not drop columns later migrations add), models and associations (`Contact.hasMany(CompanyPortalAdmin)`, etc.).
- [ ] **Step 4: Run** the test file and the migration round-trip test → PASS. Apply 072 to the test DB first (`cd backend && set -a && . ./.env.test && set +a && npx sequelize-cli db:migrate --env test`).
- [ ] **Step 5: Commit** `feat(portal): data model, portal.manage permission, portal.enabled setting`

### Task 2: Portal sessions, sign-in, invite and password reset

**Files:**
- Create: `backend/src/routes/portal/index.js` (mounted at `/api/v1/portal`), `backend/src/routes/portal/auth.js`, `backend/src/controllers/portal/authController.js`, `backend/src/middleware/portalAuth.js`, `backend/src/services/portal/tokens.js`, `backend/src/services/portal/portalMail.js`
- Modify: `backend/src/app.js` (the staff `express-session` middleware is **skipped for `/api/v1/portal/*`**; that path gets its own `express-session` instance: cookie name `prism.portal.sid`, cookie `path: '/api/v1/portal'`, same store. Two instances can't share `req.session` on one request, so each path sees only its own session), `backend/src/routes/index.js`, `backend/src/middleware/rateLimit.js` (`portalLoginLimiter`, `portalForgotLimiter`), `backend/src/routes/contacts.js` + `contactsController.js` (`POST /contacts/:id/portal-invite`, `PATCH` accepts `portalAccess` only with `portal.manage`)
- Test: `backend/test/integration/portal.auth.test.js`

**Interfaces — Produces:**
- `portalAuthenticate(req, res, next)`: reads `req.session.contactId` (the portal session on portal paths); 401 `PORTAL_UNAUTHENTICATED` if none; 401 `PORTAL_ACCESS_ENDED` (and destroys the portal session) if the contact is missing/inactive, `portalAccess` false, or setting `portal.enabled !== 'true'`; sets `req.contact` (with `company`, `department`). Exports a hook list `portalSessionChecks` that 7b appends the Microsoft re-check to.
- `issuePortalToken(contactId, kind) → { token, expiresAt }` (invalidates earlier unused tokens of that kind); `consumePortalToken(token, kind) → contact` (throws 400 `TOKEN_INVALID` for unknown, used or expired).
- `GET /portal/config` (no session) → `{ enabled: boolean, microsoft: boolean, branding:{ appName, tagline, logoUrl } }`; `microsoft` is `false` until 7b sets it from the app registration. The sign-in page shows **Sign in with Microsoft** only when it is true.
- Routes: `POST /portal/auth/login {email,password}`; `POST /portal/auth/logout`; `GET /portal/me` → `{ contact: { id, displayName, email, company:{id,name}, department:{id,name}|null, isCompanyAdmin, adminDepartmentIds, signInMethod: 'password'|'microsoft'|null } }`; `POST /portal/auth/invite/accept {token,password}`; `POST /portal/auth/forgot {email}` → always 202; `POST /portal/auth/reset {token,password}`.
- Staff: `POST /contacts/:id/portal-invite` (needs `portal.manage`, company fence, contact has email, not Microsoft-linked in 7b) → sets `portalAccess=true`, sends the invite email, audits.

- [ ] **Step 1: Write failing tests** in `portal.auth.test.js`:
  - `'invite → accept → login works; the link works once'`.
  - `'an invite link older than 72 hours is refused'` (freezeClock / advanceClock fixtures).
  - `'a newer invite invalidates the older link'`.
  - `'forgot password answers 202 for unknown and known emails alike, and emails only the known one'`.
  - `'login is refused with portal access off, contact inactive, or portal switched off'`; `'an open session ends at the next request when access is turned off'`.
  - `'a contact session is 401 on staff routes (/api/v1/tickets) and a staff session is 401 on /api/v1/portal/me'`; `'signing out of the portal keeps the staff session'`.
  - `'portal-invite needs portal.manage and respects limited company access'`.
  - `'login is rate limited'`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** Tokens: `crypto.randomBytes(32).toString('base64url')`, store sha256. Invite email links to `${PUBLIC_APP_URL}/portal/welcome?token=…`, reset to `/portal/reset?token=…` (same base URL resolution as `csatService`). Audit entries `portal.sign_in`, `portal.invite_sent`, `portal.access_changed`.
- [ ] **Step 4: Run** `portal.auth.test.js` and `auth.test.js` (staff login unaffected) → PASS.
- [ ] **Step 5: Commit** `feat(portal): contact sessions, invite links, sign-in and password reset`

### Task 3: Portal scope service

**Files:**
- Create: `backend/src/services/portal/scope.js`
- Test: `backend/test/integration/portal.scope.test.js`

**Interfaces — Produces:**
- `portalTicketWhere(contact, scope = 'all') → Promise<WhereOptions>` with `scope ∈ {'all','mine','watching','department','company'}`; `'all'` = the union. Mine = `contactId = me OR portalCreatedByContactId = me`; watching = ids from `TicketWatcher.contactId = me`; department = `Ticket.departmentId IN (departments I admin)`; company = `Ticket.companyId = my company` if I'm a company admin. A scope the contact doesn't have returns a where that matches nothing.
- `canSeeTicket(contact, ticketId) → Promise<boolean>`.
- `forContacts(contact) → Promise<Contact[]>` — contacts this admin may raise tickets for (self always; department admins: active contacts of their departments; company admins: the company's active contacts).
- `portalArticleWhere(contact) → WhereOptions` — `visibility='portal' AND status='published' AND (portalScope='all' OR (companies AND audience has my companyId) OR (departments AND audience has my departmentId))`.

- [ ] **Step 1: Write failing tests** with two companies, departments Billing/Reception, contacts: plain, department admin, company admin, watcher, and a contact of the other company:
  - plain sees only own (+ raised-by-me) tickets; watcher additionally sees the watched one; department admin sees Billing tickets but not Reception; company admin sees all of company A, none of B.
  - `canSeeTicket` false for every other-company ticket id (id guessing).
  - `forContacts`: plain → [self]; department admin → self + Billing contacts only; company admin → company contacts; never inactive contacts or other companies.
  - articles: `all` visible to both companies; `companies` only to the listed company; `departments` only to the listed department; drafts and `internal` never.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(portal): one scoping service for tickets, contacts and articles`

### Task 4: Portal tickets API

**Files:**
- Create: `backend/src/routes/portal/tickets.js`, `backend/src/controllers/portal/ticketsController.js`, `backend/src/services/tickets/customerReply.js`
- Modify: `backend/src/services/inboundEmailService.js` (use `applyCustomerReply`), `backend/src/services/tickets/ticketWrite.js` (accept `portalCreatedByContactId` when `systemSource === 'portal'`)
- Test: `backend/test/integration/portal.tickets.test.js`

**Interfaces:**
- Consumes: Task 2 `portalAuthenticate`, Task 3 scope functions, `createTicket(actor, input, { systemSource })`.
- Produces:
  - `applyCustomerReply(ticket, comment, actorId) → Promise<void>` — the existing inbound rule moved verbatim (open/on hold → User responded; closed/archived → notify assignee, no reopen); inbound email keeps calling it.
  - `GET /portal/meta` → `{ categories, priorities: ['low','medium','high','critical'], forContacts }`.
  - `GET /portal/tickets?scope&status=open|closed|all&q&page&limit` → `{ tickets:[{ id, title, status, statusBehavior, contact:{id,displayName}, updatedAt }], total, totalPages }` (open = behaviours open/on_hold; closed = closed; archived never listed).
  - `GET /portal/tickets/:id` → `{ ticket:{ id, title, description, status, priority, category:{path}|null, contact:{displayName}, createdAt, handledBy: team or department name|null }, comments:[{ id, body, createdAt, author:{ displayName, side:'you'|'contact'|'support' }, attachments }], attachments }` — **only** `reply` and `comment_public` comments; key allow-list enforced.
  - `POST /portal/tickets` multipart `{ title, description, categoryId?, priority?, forContactId? }` + files → 201 `{ ticket:{id} }`; source `portal`; contact = forContactId or me; `portalCreatedByContactId` = me when different.
  - `POST /portal/tickets/:id/replies` multipart `{ body }` + files → 201; `Comment{ type:'reply', authorId: system actor, authorContactId: me }`; then `applyCustomerReply`.
  - `GET /portal/tickets/:id/attachments/:attachmentId/download` — only attachments of the ticket or of its public comments.

- [ ] **Step 1: Write failing tests:**
  - create: title and description required (400s); 256-char title refused; category and priority optional; ticket has source `portal`, contact me, department from my contact.
  - "For": a plain contact sending `forContactId` → 403; a department admin for a Billing contact → ok with `portalCreatedByContactId`; for a Reception contact → 404.
  - list scopes and status filter match Task 3; search by number and title.
  - detail: private comments absent; payload keys equal the allow-list exactly; another company's ticket → 404.
  - reply: stored as `reply` with `authorContactId`; status moves to User responded; on a closed ticket the status stays closed and the assignee is notified; HTML in the body is returned as text.
  - attachments: an attachment on a private comment → 404; virus-scan refusal and size limits behave as on staff uploads (reuse the scanner test double).
  - inbound email tests still pass unchanged (refactor guard).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** this file + `email.*`/inbound tests → PASS.
- [ ] **Step 5: Commit** `feat(portal): raise, list, read and reply to tickets in the portal`

### Task 5: Staff side — admins, contact watchers, contact portal fields

**Files:**
- Modify: `backend/src/routes/companies.js` + `companiesController.js` (`GET/PUT /companies/:id/portal-admins {contactIds}`), `backend/src/routes/departments.js` + `departmentsController.js` (`GET/PUT /departments/:id/portal-admins {contactIds}`), `backend/src/controllers/tickets/watchers.js` + `ticketWrite.addTicketWatcher` (accept `{ contactId }`), `backend/src/controllers/contactsController.js` (contact payload: `portalAccess`, `signInMethod`, `portalLastSignInAt`, `adminOf:{ company:boolean, departments:[{id,name}] }`)
- Create: `backend/src/services/portal/adminRoles.js`
- Test: `backend/test/integration/portal.staff.test.js`

**Interfaces — Produces:**
- `pruneAdminRoles(contact, { previousDepartmentId, previousCompanyId }) → Promise<void>` — called from every place a contact's department or company changes (contact PATCH, department assign endpoint, company move in `companyHooks`; 7b's sync calls it too).
- Watchers list returns `{ id, kind:'user'|'contact', user?, contact?: { id, displayName, portalAccess } }`.

- [ ] **Step 1: Write failing tests:**
  - setting admins needs `portal.manage` + company fence; a department admin must belong to that department; a company admin to that company (400 otherwise).
  - changing a contact's department removes their old department admin role; moving company removes all their admin roles.
  - a contact watcher can be added and removed; adding a contact from another company → 400; a contact watcher can see the ticket via `/portal` (cross-check with Task 3).
  - contact payload includes the portal fields; `portalAccess` PATCH without `portal.manage` → 403.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** + existing `companies.*`, `contacts.*`, `tickets.watchers` tests → PASS.
- [ ] **Step 5: Commit** `feat(portal): company and department admins, contact watchers`

### Task 6: Knowledge base in the portal; `/kb` closes

**Files:**
- Create: `backend/src/routes/portal/kb.js` (`GET /portal/kb/categories`, `/articles?q&category`, `/articles/:slug`, attachment download)
- Modify: `backend/src/controllers/knowledgeController.js` (create/update accept `visibility:'portal'`, `portalScope`, `audience:{companyIds,departmentIds}`; validate ids exist), `backend/src/routes/index.js` (remove `/kb` public mount), delete `backend/src/routes/kbPublic.js` and the `public*` handlers
- Test: `backend/test/integration/portal.kb.test.js`

- [ ] **Step 1: Write failing tests:** a signed-out request to `/api/v1/kb/articles` → 404; portal article lists follow `portalArticleWhere`; an article slug outside my audience → 404; its attachments → 404; category counts count only visible articles; staff can save audience companies/departments and read them back.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** + `knowledge.*` tests → PASS.
- [ ] **Step 5: Commit** `feat(portal): knowledge base by audience, sign-in only`

### Task 7: "View in the portal" in ticket emails

**Files:**
- Modify: `backend/src/services/email/ticketMail.js` (`ticketContext` adds `portalUrl` per recipient contact), `backend/src/services/email/templates.js` (the customer templates render the link when present)
- Test: `backend/test/integration/portal.email.test.js`

- [ ] **Step 1: Write failing tests:** a reply email to the ticket's contact with portal access contains `/portal/tickets/<id>`; without portal access it doesn't; a CC'd contact who can't see the ticket gets no link; a contact watcher does.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** using `canSeeTicket`. **Step 4: Run** + `email.*` tests → PASS.
- [ ] **Step 5: Commit** `feat(portal): ticket emails link to the portal for contacts who can see the ticket`

### Task 8: The portal frontend

**Files:**
- Create: `frontend/src/portal/api.js` (axios instance, `baseURL: '/api/v1/portal'`, `withCredentials`, 401 → `/portal/sign-in`), `frontend/src/portal/PortalAuth.jsx` (context: `me`, `refresh`, `signOut`), `frontend/src/portal/PortalLayout.jsx` (top bar per mockups: brand "· Support", Tickets / Knowledge base, name + company, Sign out; phone menu), pages `frontend/src/portal/pages/{SignIn,Welcome,Forgot,Reset,Tickets,TicketNew,Ticket,Kb,KbArticle}.jsx`
- Modify: `frontend/src/App.jsx` (`/portal/*` routes outside the staff `Layout`; `/kb` and `/kb/a/:slug` → `<Navigate to="/portal/kb…">`), remove `frontend/src/pages/kb/*` (moved into `portal/`)
- Test: `backend/test/smoke/portal.smoke.js`

**Interfaces:** Consumes Tasks 2, 4, 6 endpoints exactly as listed. Boards: `Main` (sign in), `SignInPhone`, `AccountStates`, `Tickets`, `TicketNew`, `Ticket`, `Phone`, `Kb`, `KbArticle`.

- [ ] **Step 1: Write failing smoke tests** (`portal.smoke.js`, a contact with a password set via the invite API):
  - `'sign in, see own tickets, raise one, reply, sign out'` (phone 375 px and desktop).
  - `'a department admin sees the Billing department pill and can raise a ticket For a Billing contact'`.
  - `'the reply box is one line on a phone and opens on tap'` (mirrors the staff ticket page).
  - `'forgot password shows the same message for any email'`; `'the invite page sets a password and signs in'`.
  - `'/kb redirects to the portal sign-in when signed out'`; `'knowledge base lists only articles for my company'`.
  - `'no horizontal scroll at 375 px'` on every portal page (reuse lookA's element check).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** per the mockups (look A tokens, `PageHeader`, `Pill`, `PillRow`, `Notice` from `components/ui`). **Step 4: Run** `portal.smoke.js` + `lookA.smoke.js` → PASS.
- [ ] **Step 5: Commit** `feat(portal): the client portal screens`

### Task 9: The staff screens

**Files:**
- Modify: `frontend/src/pages/ContactDetail.jsx` (PropertiesPanel "Support portal" block: switch, sign-in method, last sign-in, Admin of, **Send portal invite**), `frontend/src/components/companies/CompanyDepartments.jsx` (Company admins card + per-department admins with **Add admin**), `frontend/src/pages/tickets/detail/Sidebar.jsx` (watcher search lists Staff and Contacts groups; contact chips marked "Contact"), `frontend/src/pages/ArticleEditor.jsx` (Audience "Portal" + "Who can read it in the portal" fieldset), `frontend/src/pages/settings/registry.js` + new `frontend/src/pages/settings/ClientPortal.jsx` (Portal on switch + portal address with Copy; the Microsoft panel arrives in 7b)
- Test: `backend/test/smoke/portal.staff.smoke.js`

- [ ] **Step 1: Write failing smoke tests:** turning portal access on and sending an invite from the contact page; marking a department admin and a company admin; adding a contact watcher from the ticket page; choosing "Chosen departments" on an article and saving; a staff user without `portal.manage` sees the block read-only and no invite button; Settings → Client portal switch persists.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** per boards `ContactPortal`, `CompanyAdmins`, `Watchers`, `KbAudience`, `SettingsPortal`. **Step 4: Run** this file + `settings.smoke.js`, `companies.page.smoke.js`, `desktools.smoke.js`, `knowledgeLook.smoke.js` → PASS.
- [ ] **Step 5: Commit** `feat(portal): staff screens for access, admins, watchers and article audiences`

### Task 10: Finish

- [ ] **Step 1:** `docs/ROADMAP.md` row 7: "Building — 7a shipped (date, commit); 7b next" with plan links; `UPGRADING.md` Unreleased: the portal (address, invites, admins, watchers), the `/kb` change (sign-in only; "End users" articles now "Portal, all companies"), `portal.manage`, migration 072, set `PUBLIC_APP_URL`.
- [ ] **Step 2:** Full suites: `cd backend && npm test` (expect all green, ≥1823 plus the new tests) and `npm run test:smoke` (all green).
- [ ] **Step 3:** One fresh reviewer over the whole 7a branch (security-heavy), fix pass, then commit and `git push origin dev`.
