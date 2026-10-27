# Client portal 7b — Microsoft 365 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Contacts of any company linked to a Microsoft 365 tenant sign in to the portal with their work account; a nightly (and on-demand) sync keeps those contacts current, switches off people disabled in AD/Entra, and lists department names that need a PRISM department.

**Architecture:** One multi-tenant Microsoft app registration (settings, secret encrypted with `tokenCrypto`). A small Graph client (plain `fetch`, as `microsoftCalendar.js` does) with an app-only token per approved tenant. Microsoft sign-in is OpenID Connect against the `organizations` authority, validating the token's `tid` against linked companies and group membership. The sync is a service run by a `setInterval` scheduler like `adSyncScheduler`. Builds on plan 7a (portal sessions, scope, admin pruning).

**Tech Stack:** as 7a; `openid-client` (already used by the SSO module); Microsoft Graph v1.0 REST.

**Spec:** `docs/superpowers/specs/2026-10-27-client-portal-design.md`
**Prerequisite:** plan `2026-10-27-client-portal-7a-core.md` shipped.
**Mockups:** `docs/mockups/client-portal-7/` boards `CompanyM365`, `ContactPortal`, `SettingsPortal`, `AccountStates` (refused panel).

## Global Constraints

- The sync is for **every company**, including the organization's own. One tenant links to **one company** (unique).
- Only members of a company's **sync groups** may sign in with Microsoft or be synced.
- Microsoft sign-in matching: by Microsoft object ID, else **email within that company** (links the contact), else **create a contact** in that company with portal access on. Email belonging to a contact in **another company** → refuse ("Your account is linked to another organization — contact support"), move nothing. **Staff are not refused.**
- **Password sign-in is off** for Microsoft-linked contacts (login refused, invites not offered, existing password hash cleared on link).
- The sync **only touches existing contacts**: links unlinked ones by email within the company, or by AD object GUID ↔ on-premises immutable ID; updates name, email, phone (business phone, else mobile), job title, Microsoft 365 department; marks **inactive** when disabled or no longer in a sync group; never creates or deletes.
- A Microsoft session **re-checks the person at least every 15 minutes** (enabled, still in a sync group); failing → contact inactive, session ended.
- **Detected departments**: names among **all sync-group members** with no matching PRISM department of that company (case-insensitive, trimmed), with a people count; staff **create** or **map**; mapped/created names apply to contacts (immediately on that action, and on every sync). Microsoft 365 wins over a hand-set department once its name resolves. Department changes call 7a's `pruneAdminRoles`.
- Graph access is **read-only** (users and group members). Credentials and tokens encrypted at rest; never logged.
- Everything else from 7a's Global Constraints applies (separate identities, scoping, audit, look A, Node 24, suites once before push).

## Review Focus

- **Tenant spoofing:** an ID token from an unlinked tenant, or with a `tid`/`iss` mismatch, must never create or sign in a contact → Task 3.
- **Group membership changes mid-session:** removed from all sync groups → out within 15 minutes, contact inactive → Task 4.
- **Paging and size:** groups with more than one Graph page (and nested groups if the API returns them) are fully read; a tenant with thousands of members syncs without loading everything into one query → Task 5 (mock serves 3 pages).
- **Throttling and expired consent:** Graph 429/503 retries with `Retry-After`; 401/403 (consent withdrawn) records an error on the company's last sync and does not deactivate anyone → Task 5.
- **Same email twice:** two Microsoft users mapping to one existing contact, or a contact whose email changed in Entra to one already used by another contact → no crash, no merge; recorded as a sync error → Task 5.

---

### Task 1: Data model and the app registration settings

**Files:**
- Create: `backend/migrations/20260101000073-microsoft365.js`, `backend/src/models/DetectedDepartment.js`
- Modify: `backend/src/models/Company.js`, `Contact.js`, `index.js`, `backend/src/controllers/settingsController.js` (+ route) for `portal.msClientId`, `portal.msClientSecret` (encrypted via `tokenCrypto`, never returned in GET; GET returns `msClientSecretSet: boolean`)
- Test: `backend/test/integration/m365.model.test.js` (+ round-trip for 073)

**Interfaces — Produces:**
- `Company.msTenantId` STRING(36) unique null; `Company.msConsentAt` DATE null; `Company.msSyncGroups` JSON `[{id,name}]` default `[]`; `Company.msLastSync` JSON null `{ at, durationMs, updated, deactivated, newDetected, errors:[string] }`.
- `Contact.msObjectId` STRING(36) null; `Contact.msDepartmentName` STRING(150) null; unique index `(companyId, msObjectId)`.
- `DetectedDepartment { id, companyId, name, normalized, peopleCount, mappedDepartmentId null, createdAt, updatedAt }` unique `(companyId, normalized)`.
- `signInMethod` (7a payload) returns `'microsoft'` when `msObjectId` is set.
- 7a's `GET /portal/config` returns `microsoft: true` once a client ID and secret are saved.

- [ ] **Step 1: Failing tests:** tenant id unique across companies; secret stored encrypted and absent from settings GET; `(companyId,msObjectId)` unique.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS (apply 073 to the test DB).
- [ ] **Step 5: Commit** `feat(m365): tenant link, contact identity and detected department tables`

### Task 2: Graph client and a mock Microsoft for tests

**Files:**
- Create: `backend/src/services/microsoft365/graph.js`, `backend/test/integration/mockMicrosoft.js` (an Express app serving the token endpoint, OIDC discovery/JWKS/authorize/token for sign-in, and the Graph endpoints below; like `mockIdp.js`)
- Test: `backend/test/integration/m365.graph.test.js`

**Interfaces — Produces** (`graph.js`; base URLs overridable by env `MS_LOGIN_BASE`, `MS_GRAPH_BASE` for tests):
- `appToken(tenantId) → Promise<string>` (client credentials, `scope=https://graph.microsoft.com/.default`; cached until 5 min before expiry).
- `listGroupMembers(tenantId, groupId) → AsyncIterable<GraphUser>` (transitive members, follows `@odata.nextLink`, users only).
- `getUser(tenantId, objectId) → Promise<GraphUser|null>` (null on 404).
- `memberOfAny(tenantId, objectId, groupIds) → Promise<boolean>` (`checkMemberGroups`).
- `searchGroups(tenantId, q) → Promise<{id,name}[]>` (for the group picker).
- `GraphUser = { id, displayName, givenName, surname, mail, userPrincipalName, accountEnabled, department, jobTitle, businessPhones, mobilePhone, onPremisesImmutableId }`.
- Errors: `GraphError { status, code }`; 429/503 retried up to 3 times honouring `Retry-After`.

- [ ] **Step 1: Failing tests:** token cached; three-page member list returns every member; 429 then 200 succeeds; 403 throws `GraphError{status:403}`; secrets never appear in thrown messages.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(m365): read-only Microsoft Graph client`

### Task 3: Sign in with Microsoft

**Files:**
- Create: `backend/src/services/microsoft365/signIn.js`, routes in `backend/src/routes/portal/auth.js` (`GET /portal/auth/microsoft/start`, `GET /portal/auth/microsoft/callback`)
- Modify: `backend/src/controllers/portal/authController.js` (password login refuses Microsoft-linked contacts with the "Use Sign in with Microsoft" message), `contactsController` portal-invite (400 for Microsoft-linked)
- Test: `backend/test/integration/m365.signin.test.js`

**Interfaces — Produces:**
- `resolveMicrosoftSignIn({ tid, oid, email, name, given, family }) → Promise<{ contact } | { refused: 'not_linked'|'not_in_groups'|'other_company'|'inactive' }>` implementing the matching rules above; creating sets `portalAccess=true`, `msObjectId`, department via mapping (Task 6's `resolveDepartment`), clears `passwordHash`.
- Sign-in state (nonce, PKCE verifier, state) kept server-side like the SSO module (`SsoAuthRequest` pattern); the portal session stores `{ contactId, msTenantId, msCheckedAt }`.
- Refusal redirects to `/portal/sign-in?refused=<code>`; the frontend shows the AccountStates "not allowed" panel.

- [ ] **Step 1: Failing tests** (mock Microsoft):
  - linked tenant + member of a sync group + new email → contact created in that company, portal access on, signed in.
  - existing contact with the same email in that company → linked (not duplicated), password hash cleared.
  - unlinked tenant → `not_linked`; not in a sync group → `not_in_groups`; email used by another company's contact → `other_company`, nothing moved; inactive contact → `inactive`.
  - a token with a forged `tid` (not matching `iss`) is rejected; a replayed state/nonce is rejected.
  - a staff user's email in a linked tenant still gets a contact (staff not refused); their staff session is untouched.
  - password login for a Microsoft-linked contact → 400 with the Microsoft message.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** + `ssoOidc.test.js` → PASS.
- [ ] **Step 5: Commit** `feat(m365): sign in to the portal with a work Microsoft account`

### Task 4: The 15-minute session re-check

**Files:** Modify `backend/src/middleware/portalAuth.js` (push a check onto `portalSessionChecks`); create `backend/src/services/microsoft365/sessionCheck.js`. Test: `backend/test/integration/m365.session.test.js`.

**Interfaces:** `recheckMicrosoftSession(session, contact) → Promise<'ok'|'ended'>` — when `msCheckedAt` is older than 15 minutes: `getUser` + `memberOfAny`; disabled, missing or out of groups → contact inactive (audited `portal.access_ended_by_directory`) and `'ended'`; Graph error → `'ok'` (fail open for a transient outage, retried next request) but logged.

- [ ] **Step 1: Failing tests** with frozen time: under 15 min no Graph call; after 15 min a disabled user's next request is 401 `PORTAL_ACCESS_ENDED` and the contact is inactive; a transient 503 keeps the session.
- [ ] **Step 2–4:** Run → FAIL; implement; run → PASS.
- [ ] **Step 5: Commit** `feat(m365): Microsoft sessions re-check the account every 15 minutes`

### Task 5: The sync

**Files:**
- Create: `backend/src/services/microsoft365/sync.js`, `backend/src/services/microsoft365/syncScheduler.js` (started where `startAdSyncScheduler` starts; nightly at 02:00 company time zone)
- Modify: `backend/src/routes/companies.js` + controller: `POST /companies/:id/m365/sync` (portal.manage + fence; 409 if already running), `PUT /companies/:id/m365 { tenantId, syncGroups }`, `GET /companies/:id/m365/groups?q` (search), `GET /companies/:id/m365/consent-url`
- Test: `backend/test/integration/m365.sync.test.js`

**Interfaces — Produces:** `syncCompany(companyId) → Promise<SyncResult>` with `SyncResult = { at, durationMs, updated, deactivated, newDetected, errors }`, saved to `Company.msLastSync`. Order: read all sync-group members (dedupe by id) → link unlinked contacts (email within company, else `onPremisesImmutableId` base64 → GUID vs `adObjectGUID`) → update linked contacts' fields → deactivate linked contacts not in the member set or `accountEnabled=false` → recount detected departments → resolve departments (Task 6) → call `pruneAdminRoles` on department changes. Consent URL: `https://login.microsoftonline.com/<tenantId>/adminconsent?client_id=…&redirect_uri=…`.

- [ ] **Step 1: Failing tests** (mock Graph, 3 pages):
  - links by email and by AD GUID; never creates a contact for an unknown member.
  - updates name/email/phone/job title/department name; phone prefers business, else mobile.
  - disabled user → inactive; removed from groups → inactive; their tickets untouched.
  - consent withdrawn (403) → error recorded, nobody deactivated.
  - two members with one contact's email → one links, the other is a recorded error.
  - running sync twice concurrently → second returns 409.
- [ ] **Step 2–4:** Run → FAIL; implement; run → PASS.
- [ ] **Step 5: Commit** `feat(m365): nightly and on-demand Microsoft 365 sync`

### Task 6: Detected departments

**Files:** Create `backend/src/services/microsoft365/departments.js`; routes `GET /companies/:id/m365/detected-departments`, `POST …/:detectedId/create`, `POST …/:detectedId/map { departmentId }`. Test: `backend/test/integration/m365.departments.test.js`.

**Interfaces — Produces:** `normalizeDepartmentName(name) → string` (trim, collapse spaces, lower-case); `resolveDepartment(companyId, msDepartmentName) → Promise<departmentId|null>` (exact normalized match on a department of that company, else a detected row's `mappedDepartmentId`, else null and the row is upserted); `suggestMapping(detected, departments) → departmentId|null` (normalized equality after stripping "dept"/"department" — drives the "Looks like" hint only).

- [ ] **Step 1: Failing tests:** "Billing Dept" and "billing" both listed with counts; mapping "billing" to Billing assigns its contacts immediately and removes the row from the to-do list; "Create department" makes it in that company and assigns; a hand-set department is replaced once the name resolves; department admin of the old department is pruned.
- [ ] **Step 2–4:** Run → FAIL; implement; run → PASS.
- [ ] **Step 5: Commit** `feat(m365): detected departments to create or map`

### Task 7: Staff screens

**Files:** Create `frontend/src/components/companies/CompanyMicrosoft365.jsx` (tab per `CompanyM365`: tenant + approval link, Sync now + last sync summary, sync groups picker, detected departments table); modify `frontend/src/pages/companies/CompanyPage.jsx` (add the "Microsoft 365" tab after Overview, shown with `portal.manage`), `frontend/src/pages/settings/ClientPortal.jsx` (Microsoft 365 app panel: client ID, secret replace, redirect address with Copy, Test), the contact "Support portal" block (Microsoft sign-in details; no invite button when linked), `frontend/src/portal/pages/SignIn.jsx` (Sign in with Microsoft button; refused panel from `?refused=`). Test: `backend/test/smoke/m365.smoke.js` (mock Microsoft).

- [ ] **Step 1: Failing smoke tests:** link a tenant and pick a sync group; Sync now shows the summary; map a detected department; Settings saves the app ID and never shows the secret; the portal "Sign in with Microsoft" round-trip against the mock signs a member in and shows the refused panel for a non-member.
- [ ] **Step 2–4:** Run → FAIL; implement per boards; run + `settings.smoke.js`, `companies.page.smoke.js`, `portal.smoke.js` → PASS.
- [ ] **Step 5: Commit** `feat(m365): company Microsoft 365 tab and the Microsoft app settings`

### Task 8: Finish

- [ ] **Step 1:** ROADMAP row 7 → Shipped (date, commits, both plans); UPGRADING: Microsoft app registration steps (multi-tenant, redirect address, application permissions User.Read.All and GroupMember.Read.All, admin consent per tenant), migration 073, nightly sync, the 15-minute re-check.
- [ ] **Step 2:** Full backend and smoke suites → all green.
- [ ] **Step 3:** One fresh reviewer (security: token validation, tenant isolation, scoping), fix pass, commit, `git push origin dev`.
