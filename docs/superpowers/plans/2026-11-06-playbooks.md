# PRISM PB — Playbooks: forms and checklists on tickets, and the device lifecycle: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Order with plan 9** (per-company ticket categories, queued after 8c): the two don't depend on each other. Whichever is built second takes the next free migration number and merges `dev` first. Workflow rules that suggest a playbook use category conditions; with plan 9 those categories belong to a company, which changes nothing here.

**Goal:** An organization writes its own **forms** (sections, steps, fields, secure fields, steps that show only when they apply) and groups them into **playbooks**. On a ticket, **Apply playbook** adds the right forms as tasks: once for the ticket, and once per device of the person it's for (or per device added to the ticket), on the right branch for each device's type, MDM, cellular and agent. Devices can be created inside the ticket. A form's last step checks the device out or in for real, and check-in revokes the computer's PRISM agent so it can be reissued cleanly. The ticket can't close while a form is unfinished unless someone with the override permission gives a reason. Devices gain **managed / MDM** (from a per-install list) and **cellular** (IMEI, phone number, carrier).

**Architecture:**
- **Forms are versioned JSON definitions.** `Forms` has one row per form; `FormVersions` holds each saved definition. A ticket form points at the version it was created from, so editing a form never changes one in progress.
- **One pure module decides what shows.** `services/playbooks/formDefinition.js` validates a definition and, given a context `{ device, person, answers }`, returns which sections and items show, what is required and whether the form is finished. The server is the source of truth: every answer saved returns the form's new state, so the browser never re-implements the rules.
- **Playbooks** hold an ordered list of blocks (form + how it applies + limits). `services/playbooks/resolve.js` turns a playbook, a ticket, a person and devices into the ticket forms to create (first match per device wins) and the devices not covered.
- **Applied playbook → ticket forms → tasks.** Applying creates a `TicketPlaybooks` row (with a snapshot of the playbook), one `TicketForms` row per form, and one ticket task per ticket form, using the existing work model. The task closes itself when its form finishes.
- **Secure values** live in `TicketFormSecrets`, encrypted with `utils/tokenCrypto.js`, returned only by a reveal endpoint that checks permission, is rate-limited and is logged.
- **One check-out / check-in service.** The asset page's check-out and check-in move out of `assetsController` into `services/assets/checkouts.js`. The asset page and form device actions both call it. Check-in can revoke the device's agent through the existing devices service.
- **One close guard.** `services/playbooks/closeGuard.js` is called wherever a ticket can move into a closed or archived status: `prepareTicketUpdate` (ticket page, bulk, API), `workflowEngine` `set_status`, and `statusMoves`. Merge moves the source tickets' forms to the target before it closes them.

**Tech Stack:** Node 24, Express, Sequelize, MariaDB, React 18, Vite, Tailwind (as before). PDFs with the existing `pdfkit` helpers (`services/pdfReport.js`). No new npm dependency.

**Spec:** `docs/superpowers/specs/2026-11-06-playbooks-design.md`
**Mockups:** `docs/mockups/playbooks-pb/` (approved 2026-11-06; `node preview.js Main TicketForm:dark` from that folder). Boards: `Main` (ticket with a playbook applied), `ApplyPlaybook`, `TicketForm`, `AddDevice`, `CloseBlocked`, `FormBuilder`, `PlaybookEditor`, `Mdms` (with the device's Management, Cellular and PRISM agent cards), `PhoneForm`. Live screen wins over the mockup on field and status names.

## Global Constraints

- **PRISM lists and records steps; it acts only on itself.** The only actions are PRISM's own: check out, check in, set the asset status, revoke the agent. Nothing reaches AD, Microsoft 365, an MDM or a carrier.
- **Nothing organization-specific in code or seeds.** No MDM, carrier, vendor or product name appears in code, migrations or starter templates. A test enforces this for the starters (Task 10).
- **Secure values never leave the reveal endpoint.** Not in ticket or form payloads, activity text, notifications, emails, search, exports, CSV or PDFs. Form payloads say only `{ set: true, setBy, setAt }`.
- **Company fences hold everywhere:**
  - the person must be a contact of the ticket's company;
  - devices offered, linked or created belong to the ticket's company;
  - a carrier must be a vendor company;
  - a playbook is offered only for the companies it lists (none = all).
- **Definitions are untrusted input:**
  - validated on save and on import;
  - text is sanitized with `utils/richHtml.js`;
  - size limits: 40 sections, 400 items, 4,000 characters per text, 256 KB per definition;
  - item keys are unique and stable across versions;
  - conditions may only refer to known device/person fields or to earlier items.
- **MDM console addresses** must be `https://` or `http://`; `{id}` is replaced with the URL-encoded MDM device ID. Anything else is refused, so a `javascript:` link can't be stored.
- **Device actions run once.** Ticking a device action locks the ticket form row and the asset in one transaction, so two clicks can't check a device out twice.
- **Everything from earlier sub-projects still applies:** audit, look A, Node 24, phone widths, one migration per task where noted with a round-trip test, and both suites once before each push.

## Review Focus

- **Secret leakage:** no endpoint other than reveal returns a secure value, including ticket payloads, form payloads, activity, search, PDF and export → Tasks 7 and 11.
- **Close guard coverage:** every path into a closed status refuses unfinished forms (ticket page, bulk, workflow rule, status moves, API) and merge carries forms over → Task 8.
- **Fences:** applying for a contact of another company, linking or creating a device of another company, or picking a non-vendor carrier is refused → Tasks 3 and 6.
- **Import safety:** an imported file with script in text, unknown kinds, conditions on later items or oversize content is refused or cleaned, and lands inactive → Task 4.
- **Agent revoke at check-in:** a reissued computer is claimed by the next enrollment, not duplicated → Task 5.

---

### Task 1: Data model and permissions

**Files:**
- Create: `backend/migrations/<next>-playbooks.js`; models `Mdm.js`, `Form.js`, `FormVersion.js`, `Playbook.js`, `TicketPlaybook.js`, `TicketForm.js`, `TicketFormSecret.js`, `TicketPlaybookSuggestion.js`
- Modify: `backend/src/models/Asset.js`, `AssetCategory.js`, `index.js` (associations)
- Test: `backend/test/integration/playbooks.model.test.js` (with the migration's down/up round trip)

**Interfaces — Produces:**
- `Mdm { id, name(100) unique, consoleUrl(500) null, isActive, position }`
- `Assets` gains:
  - `isManaged BOOLEAN default false`, `mdmId null → Mdms`, `mdmDeviceId(150) null`
  - `hasCellular BOOLEAN default false`, `imei(20) null`, `phoneNumber(40) null`, `carrierCompanyId null → Companies`
  - `holdReason(255) null`
  - `status` gains `ready_to_issue` and `on_hold`
- `AssetCategories.cellularByDefault BOOLEAN default false`
- `Form { id, name(150), description TEXT, usage ENUM('ticket','device'), isActive, currentVersionId null, createdBy }`
- `FormVersion { id, formId, version INT, definition JSON, createdBy, createdAt }`, unique `(formId, version)`
- `Playbook { id, name(150), description TEXT, needsPerson BOOLEAN, companyIds JSON null, blocks JSON, isActive, position, createdBy }`. `blocks`: `[{ formId, applies: 'once'|'person_devices'|'ticket_devices', limits: { categoryIds?, managed?, mdmIds?, hasCellular?, hasAgent? } }]`
- `TicketPlaybook { id, ticketId, playbookId, snapshot JSON, contactId null, appliedBy, appliedAt }`
- `TicketForm { id, ticketId, ticketPlaybookId null, formVersionId, assetId null, taskId unique, answers JSON, state ENUM('open','finished','skipped'), skipReason(500) null, finishedAt, finishedBy, actionDoneAt null, createdAt, updatedAt }`
- `TicketFormSecret { id, ticketFormId, itemKey(60), ciphertext TEXT, setBy, setAt }`, unique `(ticketFormId, itemKey)`
- `TicketPlaybookSuggestion { id, ticketId, playbookId, ruleId null, dismissedAt null, createdAt }`, unique `(ticketId, playbookId)`
- Permissions:
  - `settings.manage_playbooks` (settings category): System Administrator.
  - `tickets.view_secure_fields` (tickets category): System Administrator and System Technician.
  - `tickets.override_checklist` (tickets category): System Administrator.

- [x] **Step 1: Failing tests:**
  - the new asset fields save and default;
  - the two new statuses save;
  - one secret per form item;
  - one task per ticket form;
  - one suggestion per ticket and playbook;
  - the three permissions are held by exactly the roles above;
  - the migration's down → up round trip, re-applying later migrations in `afterAll` (see the `later` list in `desktools.migration.test.js`).
- [x] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS (apply the migration to the test DB).
- [x] **Step 5: Commit** `feat(playbooks): forms, playbooks, ticket forms, MDMs and cellular on devices`

---

### Task 2: Form definitions: validate and evaluate

**Files:**
- Create: `backend/src/services/playbooks/formDefinition.js`
- Test: `backend/test/unit/formDefinition.test.js`

**Interfaces — Produces:**
- Definition shape: `{ sections: [{ key, title, showWhen?, items: [Item] }] }`. An `Item` is `{ key, kind, required?, showWhen?, ... }`, where `kind` is one of:
  - `text { body }`
  - `step { body, askNote? }`
  - `field { label, fieldType: 'text'|'longtext'|'number'|'date'|'yesno'|'choice'|'choices'|'staff'|'contact', options? }`
  - `secure { label }`
  - `agent { body }`: confirmed by the agent
  - `action { action: 'check_out'|'check_in', statuses?: [...] }`
- `showWhen: [{ on: 'device'|'person'|'answer', field, op: 'is'|'is_not'|'in'|'is_empty'|'is_not_empty', value }]`, all must hold.
  - Device fields: `categoryId`, `isManaged`, `mdmId`, `hasCellular`, `carrierCompanyId`, `hasAgent`, `companyId`.
  - Person fields: `companyId`, `departmentId`.
  - Answer conditions name an earlier item key.
- `validateDefinition(def, { usage }) → cleanDef`, throws `ApiError(400, …, 'FORM_INVALID')` with the first problem, or `(413)` when too large.
  - `agent` and `action` items, and device conditions, are allowed only when `usage === 'device'`.
  - At most one `action` item; it must be the last item that shows.
  - Text goes through `richHtml`.
- `evaluate(def, ctx, answers, secretKeys) → { sections: [{ key, shown, items: [{ key, shown, required, done }] }], required, done, finished, actionReady }`
  - `actionReady`: every other required, shown item is done.

- [x] **Step 1: Failing tests:**
  - valid and invalid shapes (unknown kind, duplicate key, condition on a later item, action not last, device items on a ticket-usage form, oversize);
  - script stripped from text;
  - visibility by device MDM, type, cellular and agent, by person department, and by an earlier yes/no answer;
  - hidden items are not required and not counted;
  - `finished` and `actionReady`;
  - answers left on items that became hidden are kept but ignored.
- [x] **Step 2–4:** Run → FAIL; implement; run → PASS.
- [x] **Step 5: Commit** `feat(playbooks): form definitions and what shows when`

---

### Task 3: MDMs, managed and cellular on devices

**Files:**
- Create: `backend/src/controllers/mdmsController.js`, `backend/src/routes/mdms.js`
- Modify: `routes/index.js`, `controllers/assetsController.js` (create, update, list filters, import, export), asset categories controller (`cellularByDefault`), `controllers/searchController.js`
- Test: `backend/test/integration/assets.mdm.test.js`, `assets.cellular.test.js`

**Interfaces — Produces:**
- `GET/POST/PATCH /mdms`, plus `POST /mdms/reorder`. Reading needs `assets.view`; writing needs `settings.manage_playbooks`. There is no delete: retire by setting `isActive: false`.
- Each MDM in a list carries `deviceCount`. Each asset carries `mdmLink`, built from `consoleUrl` and `mdmDeviceId`.
- Asset create and update:
  - `mdmId` is required when `isManaged`, and cleared when it isn't.
  - IMEI is 15 digits with a valid check digit; spaces are ignored.
  - `phoneNumber` is formatted with `utils/phone.js`.
  - `carrierCompanyId` must be a vendor company.
  - The cellular fields are cleared when `hasCellular` is false.
  - `holdReason` is required for `on_hold` and cleared otherwise.
  - The response carries `warnings: ['IMEI_IN_USE' | 'PHONE_IN_USE']` when another active asset has the same value.
- A new asset in a category with `cellularByDefault` starts with `hasCellular: true` unless the body says otherwise.
- New list filters: `managed`, `mdmId`, `hasCellular`, `carrierCompanyId`. Import and export gain the same columns, matching MDM and carrier by name. Global search matches phone number (digits only) and IMEI.

- [x] **Step 1: Failing tests:**
  - MDM CRUD and permission;
  - console addresses: `javascript:` refused, `{id}` link URL-encoded;
  - managed without MDM refused;
  - a retired MDM stays on its devices but can't be newly picked;
  - IMEI check digit;
  - duplicate warnings;
  - carrier must be a vendor, and of any company the user may see;
  - `on_hold` needs a reason;
  - the category default;
  - filters, import/export round trip, search by phone and IMEI.
- [x] **Step 2–4:** Run → FAIL; implement; run → PASS.
- [x] **Step 5: Commit** `feat(assets): MDMs, managed devices and cellular details`

---

### Task 4: Forms and playbooks admin API, export and import

**Files:**
- Create: `backend/src/controllers/formsController.js`, `playbooksController.js`, `routes/forms.js`, `routes/playbooks.js`, `services/playbooks/resolve.js`, `services/playbooks/transfer.js`
- Test: `backend/test/integration/forms.admin.test.js`, `playbooks.admin.test.js`, `playbooks.transfer.test.js`, `backend/test/unit/playbookResolve.test.js`

**Interfaces — Produces:**
- **Forms** (all need `settings.manage_playbooks`; list and read also allowed with ticket edit rights, for the Apply dialog):
  - `GET /forms` returns the forms, each with its `inUse` count of open ticket forms.
  - `GET /forms/:id` returns the current definition.
  - `POST /forms` creates version 1. `PUT /forms/:id` saves a new version.
  - `PATCH /forms/:id` changes `{ isActive }`.
- **Playbooks:** `GET/POST/PUT/PATCH /playbooks`. Blocks are checked: each form exists, a per-device block uses a device form, and a `person_devices` block needs `needsPerson`.
- **Preview:** `POST /playbooks/:id/preview { contactId }` → `{ forms: [{ blockIndex, formId, asset? }], uncovered: [asset] }`. Used by "Try it on someone" and the Apply dialog.
- `resolve.js`: `resolvePlaybook(playbook, { ticket, person, personDevices, ticketDevices }) → { forms, uncovered }`. Each device takes the first per-device block it matches. A device appearing in both lists is counted once.
- **Transfer:**
  - `POST /playbooks/export { formIds, playbookIds }` → a JSON file `{ prism: 'playbooks', version: 1, forms, playbooks }`.
  - `POST /playbooks/import` takes a dry run first and returns the MDMs and categories that need mapping. A second call with `{ mapping }` saves everything **inactive**.

- [x] **Step 1: Failing tests:**
  - every save creates a version, and an in-progress ticket form keeps its own;
  - permission checks;
  - block validation;
  - first-match per device;
  - uncovered devices;
  - preview fenced to the playbook's companies;
  - export → import round trip;
  - import refuses script, unknown kinds, oversize, and conditions on later items;
  - unmapped MDMs are reported;
  - imported items are inactive.
- [x] **Step 2–4:** Run → FAIL; implement; run → PASS.
- [x] **Step 5: Commit** `feat(playbooks): forms and playbooks in settings, with export and import`

---

### Task 5: One check-out and check-in service

**Files:**
- Create: `backend/src/services/assets/checkouts.js`
- Modify: `controllers/assetsController.js` (`createCheckout`, `checkInCheckout`, `assertCheckoutContact` call the service), `controllers/devicesController.js` (export the revoke logic as a service function if it isn't one)
- Test: existing `assets.*` checkout tests must pass unchanged; new `backend/test/integration/checkouts.service.test.js`

**Interfaces — Produces:**
- `checkOut(actor, asset, contactId, { checkedOutAt, notes, generateForm }, { transaction }) → { checkout, attachment }`. Same rules and activity as today, including dev's checkout form (generate, then print, email and upload the signed copy from the asset page).
- `checkIn(actor, asset, { checkedInAt, status, holdReason, revokeAgent }, { transaction }) → { checkout | null, revoked: bool }`. Checks in the open checkout if there is one.
  - Without one (a holder set by the agent's usual-user matching), it clears the assignment and logs `assignment_changed`.
  - It sets the status.
  - With `revokeAgent` it revokes the asset's live device. That needs `devices.manage`; without it the call refuses with `AGENT_REVOKE_FORBIDDEN` and changes nothing.
- `assignedByAgent(asset) → bool`: the holder equals the device's `inventory.agentAssignedContactId`, the marker `services/agent/inventory.js` uses.
- `checkOut` clears `inventory.agentAssignedContactId`, so a checked-out holder counts as hand-set even when it's the same person the agent picked, and a later sign-in by someone else never moves it.

- [x] **Step 1: Failing tests:**
  - the asset page's check-out and check-in behave exactly as before;
  - check-in with a status and a hold reason;
  - check-in of an agent-assigned device (no checkout);
  - revoke with and without `devices.manage`;
  - after a check-out to the agent's usual user, an inventory reporting a different signed-in user doesn't change the holder;
  - **after check-in with revoke, a new enrollment with the same serial claims the same Asset** (uses `services/agent/enrollment.js`);
  - without revoke it would create a second one, which pins the reason.
- [x] **Step 2–4:** Run → FAIL; implement; run → PASS.
- [x] **Step 5: Commit** `refactor(assets): one check-out and check-in service, with agent revoke`

---

### Task 6: Applying playbooks, and devices on the ticket

**Files:**
- Create: `backend/src/services/playbooks/apply.js`, `controllers/tickets/playbooks.js`, `controllers/tickets/devices.js`, `services/playbooks/personGuess.js`
- Modify: `routes/tickets.js`, `controllers/tickets/shared.js` (ticket payload gains `playbooks`, `forms` summary, `devices`, `uncovered`, `suggestions`)
- Test: `backend/test/integration/playbooks.apply.test.js`, `tickets.devices.test.js`, `backend/test/unit/personGuess.test.js`

**Interfaces — Produces:**
- `GET /tickets/:id/playbooks/options?playbookId=` → `{ playbooks, guesses: [contact], personDevices: [{ asset, form, assignedByAgent }], uncovered }`. Lists playbooks offered for the ticket's company. The person guess matches full names, then email local parts, of the ticket's company's contacts against the subject and description, on word boundaries and ignoring accents.
- `POST /tickets/:id/playbooks { playbookId, contactId?, assetIds? }` → the applied playbook.
  - Needs ticket edit rights, and a person when `needsPerson`.
  - `assetIds` narrows the person's devices to the ticked ones.
  - In one transaction: the `TicketPlaybook` (with snapshot), `TicketForms`, ticket tasks (title "Form: Device name, TAG", or the form name for once-blocks; the default open task status) and `AssetTicket` links.
  - Activity: `playbook_applied`.
- `DELETE /tickets/:id/playbooks/:tpId` works only while none of its forms has an answer. It removes the forms and their tasks.
- **Devices on the ticket:**
  - `POST /tickets/:id/devices { assetId }` links an existing device of the ticket's company.
  - `POST /tickets/:id/devices/new { …asset fields }` creates one; needs `assets.create`. It warns `SERIAL_EMPTY` when the serial is blank.
  - Either way, the matching form is added for each applied playbook with a `ticket_devices` block.
  - `DELETE /tickets/:id/devices/:assetId` unlinks the device and removes its unstarted forms. A started form stays.

- [x] **Step 1: Failing tests:**
  - apply for a person creates the forms, tasks and links shown in the `ApplyPlaybook` mockup (Mac on Jamf-like MDM A, iPhone on MDM B, unmanaged laptop, uncovered tablet);
  - a person of another company is refused;
  - a playbook not offered for the company is refused;
  - applying twice is allowed, with separate persons;
  - removal only while untouched;
  - person guess: hits, misses, accents, two people with the same first name;
  - linking or creating a device of another company is refused;
  - adding a device adds its form; removing it removes the unstarted one;
  - the ticket payload carries `uncovered`.
- [x] **Step 2–4:** Run → FAIL; implement; run → PASS.
- [x] **Step 5: Commit** `feat(playbooks): apply a playbook to a ticket, and devices on the ticket`

---

### Task 7: Filling in forms

**Files:**
- Create: `backend/src/services/playbooks/ticketForms.js`, `controllers/tickets/forms.js`, `services/playbooks/formPdf.js`
- Modify: `routes/tickets.js`, `services/tasks/index.js` (a form task can't be closed by hand while its form is open), `services/agent/inventory.js` (after an inventory is applied, tick open `agent` items for that asset), `middleware/rateLimit.js` (reveal limit)
- Test: `backend/test/integration/playbooks.forms.test.js`, `playbooks.secrets.test.js`, `playbooks.actions.test.js`

**Interfaces — Produces:**
- `GET /tickets/:id/forms/:formId` → `{ form, version, device, person, state: evaluate(...), answers, secrets: { key: { set, setBy, setAt } } }`.
  - Step answers are `{ done, by, at, note? }`.
  - `device` includes the agent's `online`, `lastSeenAt` and `mdmLink`.
- `PATCH /tickets/:id/forms/:formId { answers: { key: value } }` → the same view. Values are checked by item kind. Finishing closes the task and logs `form_finished`.
- `PUT /tickets/:id/forms/:formId/secrets/:key { value }` encrypts the value; the activity log records that it was set, never the value.
- `POST /tickets/:id/forms/:formId/secrets/:key/reveal` → `{ value }`.
  - Needs `tickets.view_secure_fields` and the right to view the ticket.
  - Rate-limited: 20 an hour per user.
  - Every reveal is written to the audit log and to the ticket's activity as `secret_revealed`.
- `POST /tickets/:id/forms/:formId/skip { reason, notReturned?, markLost? }` needs ticket edit rights. `notReturned` with `markLost` sets the device to `lost`.
- `POST /tickets/:id/forms/:formId/action { status?, holdReason?, revokeAgent? }` runs only when `actionReady`.
  - It calls `checkouts.checkOut` (to the applied playbook's person, or `contactId` in the body when there is none) or `checkouts.checkIn`.
  - It locks the row and asset, sets `actionDoneAt`, and marks the action item done.
  - A second call returns `409 ACTION_DONE`.
- Agent items: when `inventory.js` applies an inventory for an asset, each open ticket form for that asset ticks its `agent` items if the device's inventory is newer than the form's `createdAt` (`by: null`, shown as "PRISM agent").
- `GET /tickets/:id/forms/:formId/pdf` works only when finished or skipped. It lists answers with who and when, and secure items as "recorded, not shown".

- [x] **Step 1: Failing tests:**
  - answers by kind (bad date, unknown choice, a contact of another company);
  - hidden items don't block finishing;
  - finishing closes the task, and the task can't be closed by hand before;
  - secrets never appear in GET, the ticket payload, activity, search, PDF or export, and only reveal returns them;
  - reveal permission, rate limit and audit;
  - skip and not returned;
  - check-out action refused until `actionReady`, then performs a real checkout to the person;
  - double action → 409;
  - check-in action with status and revoke;
  - agent items tick on a newer inventory and not on an older one;
  - PDF only when finished, without secrets.
- [x] **Step 2–4:** Run → FAIL; implement; run → PASS.
- [x] **Step 5: Commit** `feat(playbooks): fill in ticket forms, secure fields and device actions`

---

### Task 8: The close guard, and merge

**Files:**
- Create: `backend/src/services/playbooks/closeGuard.js`
- Modify: `services/tickets/ticketWrite.js` (`prepareTicketUpdate`), `services/workflowEngine.js` (`set_status`), `services/statusMoves.js`, `services/tickets/merge.js` (move forms, playbooks, secrets and suggestions with the tasks), `controllers/tickets/core.js` (accepts `closeOverride: { reason }`)
- Test: `backend/test/integration/playbooks.close.test.js`

**Interfaces — Produces:**
- `checkClose(ticket) → { blocking: [ticketForm], warnings: [uncoveredAsset] }`
- `assertCanClose(ticket, nextStatus, { actor, override })`. Moving into a closed or archived status with blocking forms throws `ApiError(409, …, 'FORMS_UNFINISHED', { blocking, warnings })`, unless `override.reason` is given by someone with `tickets.override_checklist`. An override is logged as `close_override` with the reason.
- Uncovered devices never block. The ticket page shows `warnings` before it sends the status change.
- A workflow `set_status` into a closed status is skipped, and the rule log records `FORMS_UNFINISHED`.
- Merge moves the sources' ticket forms (and everything that hangs off them) to the target before closing the sources, so the sources are never refused.

- [x] **Step 1: Failing tests:**
  - refused from the ticket page, bulk close, `PATCH` status and a workflow rule;
  - allowed once every form is finished or skipped;
  - override with and without the permission, and without a reason;
  - uncovered devices warn but don't block;
  - re-saving an already closed ticket isn't refused;
  - merge carries forms and closes the sources.
- [x] **Step 2–4:** Run → FAIL; implement; run → PASS.
- [x] **Step 5: Commit** `feat(playbooks): no closing with unfinished forms, with an override`

---

### Task 9: Rules suggest playbooks

**Files:**
- Modify: `controllers/workflowRulesController.js` (allowed actions gain `suggest_playbook { playbookId }`), `services/workflowEngine.js` (`executeAction` and `describeAction`), `controllers/tickets/playbooks.js` (`POST /tickets/:id/suggestions/:id/dismiss`)
- Test: `backend/test/integration/playbooks.suggest.test.js`

**Interfaces — Produces:**
- `suggest_playbook` creates a `TicketPlaybookSuggestion` once per ticket and playbook. It never applies anything.
- The ticket payload's `suggestions` drop any playbook already applied and any suggestion dismissed.
- Dismissing needs ticket edit rights.

- [x] **Step 1: Failing tests:**
  - a rule matching a category suggests the playbook;
  - nothing is applied;
  - a second match doesn't duplicate;
  - a dismissed suggestion stays dismissed;
  - applying hides it;
  - an unknown or inactive playbook id is refused when saving the rule;
  - the dry-run description.
- [x] **Step 2–4:** Run → FAIL; implement; run → PASS.
- [x] **Step 5: Commit** `feat(playbooks): workflow rules suggest a playbook`

---

### Task 10: Starter templates

**Files:**
- Create: `backend/migrations/<next>-playbook-starters.js` (inserts only when there are no forms), `backend/src/services/playbooks/starters.js` (the definitions, shared with the test)
- Test: `backend/test/integration/playbooks.starters.test.js`

**Interfaces — Produces:**
- Forms: **Device check-out** (device; includes "Record the serial number and asset tag", an optional `agent` step "PRISM agent installed and reporting" (optional so phones and tablets, which can't run the agent, aren't blocked; an install can make it required with a device-type condition), and a `check_out` action), **Device check-in** (device; wipe and condition steps, "who approved the wipe", a `check_in` action whose statuses are ready to issue, in repair, on hold and retired), **New account** and **Account termination** (ticket; general account steps).
- Playbooks: **New account** (New account once; Device check-out per device on the ticket) and **Account termination** (needs a person; Account termination once; Device check-in per device of the person).
- Phone and tablet steps refer to device conditions, not product names.

- [x] **Step 1: Failing tests:**
  - the starters pass `validateDefinition`;
  - they are seeded once and not re-seeded after being deleted;
  - **no starter text names an MDM, carrier, vendor or product** (a word list: Apple, Jamf, ManageEngine, Intune, Kandji, Mosyle, Microsoft, Google, Verizon, AT&T, T-Mobile, Dell, HP, Lenovo);
  - migration round trip.
- [x] **Step 2–4:** Run → FAIL; implement; run → PASS.
- [x] **Step 5: Commit** `feat(playbooks): vendor-neutral starter forms and playbooks`

---

### Task 11: Staff screens on the ticket

**Files:**
- Create in `frontend/src/pages/tickets/detail/`: `PlaybookSuggestion.jsx`, `ApplyPlaybookDialog.jsx`, `DevicesPanel.jsx` (replaces the Linked assets card), `AddDeviceDialog.jsx`, `CloseBlockedDialog.jsx`, `PlaybookTasks.jsx` (the Tasks tab groups forms under each applied playbook, with the uncovered notice)
- Create `frontend/src/pages/tickets/form/TicketFormPage.jsx`, a route `/tickets/:id/forms/:formId`, with `SectionCard.jsx`, `StepItem.jsx`, `FieldItem.jsx`, `SecureItem.jsx`, `ActionItem.jsx`, `DeviceCard.jsx`
- Modify: `TicketDetail.jsx`, `Sidebar.jsx`, `ActionsMenu.jsx` (Apply playbook), `App.jsx`, `api/api.js`
- Test: `backend/test/smoke/playbooks.ticket.smoke.js`, `playbooks.form.smoke.js`, `playbooks.phone.smoke.js`

**Notes:**
- Built per the `Main`, `ApplyPlaybook`, `TicketForm`, `AddDevice`, `CloseBlocked` and `PhoneForm` mockups, from look A's `components/ui`.
- Each answer is saved as it changes, and the screen redraws from the returned state. Hidden items show as "N steps hidden … Show anyway".
- Reveal shows the value for 30 seconds, then hides it again.
- On a phone: checkboxes and touch targets at least 44 px; the action and Not returned buttons pinned at the bottom.
- The Device card shows the agent's status and **Scan now** (the existing `POST /devices/:id/scan`).

- [x] **Step 1: Failing smoke tests:**
  - suggestion banner → Apply dialog with the guessed person and device list → forms on the Tasks tab;
  - fill a form: a branch hides steps, set a secure field and reveal it (and confirm it's absent without the permission), finish → check in with revoke;
  - Add device: create with cellular, and its form appears;
  - Close: blocked dialog, override with reason, the uncovered warning;
  - phone width: the form is usable with no horizontal scroll;
  - dark theme renders.
- [x] **Step 2–4:** Run → FAIL; implement; run → PASS.
- [x] **Step 5: Commit** `feat(playbooks): playbooks, devices and forms on the ticket`

---

### Task 12: Staff screens in Settings and Assets

**Files:**
- Create `frontend/src/pages/settings/`: `Forms.jsx`, `FormBuilder.jsx` (with `builder/SectionEditor.jsx`, `ItemRow.jsx`, `ItemPanel.jsx`, `ConditionEditor.jsx`), `Playbooks.jsx`, `PlaybookEditor.jsx`, `Mdms.jsx`, `PlaybookTransfer.jsx` (the export and import dialogs)
- Modify:
  - `pages/settings/registry.js`: Service desk gains Forms and Playbooks; Assets gains MDMs, all with access `settings.manage_playbooks`.
  - `App.jsx`
  - `components/AssetFormModal.jsx`: Management and Cellular sections, the statuses and the hold reason.
  - `pages/AssetDetail.jsx`: Management, Cellular and PRISM agent cards, and the MDM link.
  - The asset list filters.
  - The asset category editor (`cellularByDefault`).
  - The workflow rule editor (a Suggest playbook action).
- Test: `backend/test/smoke/playbooks.settings.smoke.js`, `assets.cellular.smoke.js`; `frontend/src/pages/settings/builder/conditions.test.js` (pure helpers: which fields a condition can use at an item's position)

**Notes:**
- Built per the `FormBuilder`, `PlaybookEditor` and `Mdms` mockups.
- Drag to reorder, with keyboard move up and down for each row.
- Saving shows "Save as version N" with the count of open ticket forms on the old version.
- **Preview** renders the form as the ticket page would, with a device and person picker.

- [x] **Step 1: Failing tests:**
  - build a form with a branch on an earlier answer and on device MDM, then save as a new version;
  - a playbook with three blocks, and "Try it on someone" shows the first match and an uncovered device;
  - MDM list: add, retire, the `{id}` link on an asset;
  - asset edit: managed/MDM, cellular with an IMEI warning, on hold needs a reason;
  - a rule with Suggest playbook;
  - export, then import with a mapping step.
- [x] **Step 2–4:** Run → FAIL; implement; run → PASS.
- [x] **Step 5: Commit** `feat(playbooks): forms, playbooks and MDMs in Settings; managed and cellular on assets`

---

### Task 13: Acceptance: the owner's two forms

**Files:**
- Create: `backend/test/fixtures/playbooks/apple-check-out.json`, `apple-check-in.json` (the owner's two documents from 2026-11-05, as definitions; test data only, never seeded)
- Test: `backend/test/integration/playbooks.acceptance.test.js`

Both forms must be expressible **with no code changes**:
- **Check-out:** "Before you start" and Steps 1–6; MDM-specific steps by device MDM; Mac-only and iPhone/iPad-only steps by device type; the temporary password as a secure field; serial, asset tag, device type, MDM, Managed Apple Account and date issued as fields; the last step **Check out this device**.
- **Check-in:** Steps 1–8; MDM-specific wipe and clean-up steps; the bypass code and Mac passcode as secure fields; "User is leaving" (yes/no) showing the account clean-up; who approved the wipe; the last step **Check in this device** with ready to issue, in repair, or on hold ("Activation Locked").

- [x] **Step 1: Failing tests:**
  - both fixtures pass validation;
  - for a Mac on MDM A, only A's and Mac steps show, and the counts match the `TicketForm` mockup's structure;
  - for an iPhone on MDM B, only B's and iPhone steps;
  - "leaving = no" hides the account clean-up;
  - the check-in action needs every other required shown step;
  - the forms import into a fresh install via the transfer file.
- [x] **Step 2–4:** Run → FAIL; fix whatever the builder can't express (in Tasks 2–12's code, not in the fixtures); run → PASS.
- [x] **Step 5: Commit** `test(playbooks): the owner's Apple check-out and check-in forms, as built by the form builder`

---

### Task 14: Finish

- [x] **Step 1:**
  - `UPGRADING.md` under `## Unreleased`: the new screens, the three permissions and who has them, the new asset statuses and fields, the close guard (and how to override), and that the agent is revoked at check-in.
  - `docs/ROADMAP.md`: PB row → **Shipped (to dev)** with this plan linked; "Where things stand".
- [x] **Step 2:** Full backend suite and the smoke suite (not at the same time), and `npm test` in `frontend`.
- [x] **Step 3:** Render every mockup board with `preview.js` beside the built screens, light and dark, and note any difference the owner should know about.
- [x] **Step 4: Commit** `docs(playbooks): release notes and roadmap` and push to `dev`.

## As built (2026-11-06)

All 14 tasks are built on branch `claude/loving-keller-icsgxx`, with `dev`
merged in. Migrations are 080 (playbooks) and 081 (starters). Differences
from the tasks above:

- **Task 1:** a secure value's ciphertext is read with
  `TicketFormSecret.unscoped()`; a second "withCiphertext" scope selected the
  column twice. The round trips for 050 (`laterMigrations.js`) and 048
  (`companies.migration.test.js`) roll 080 back around them, since ticket
  forms point at Tasks and carriers at Companies.
- **Task 3:** global search doesn't cover assets at all, so phone number and
  IMEI are searched by the Assets list's own search. Assets have no CSV
  import or export, so there was nothing to extend there.
- **Task 5:** `logAssetActivity` takes an optional transaction; an activity
  row written outside the check-out's transaction waited on the asset row it
  had locked.
- **Task 6:** the ticket's playbooks, forms, devices, uncovered devices and
  suggestions come from their own endpoint, `GET /tickets/:id/playbooks`,
  rather than the ticket payload. A playbook's forms are in block order. The
  response to applying returns the new one as `added`.
- **Task 8:** `GET /tickets/:id/close-check` lets the Close dialog show what
  is left (and the uncovered-device warning) before trying.
- **Task 11:** the Devices panel is on the Tasks tab, with the playbook's
  forms; the sidebar's existing linked-assets card stays, and now links and
  unlinks through `/tickets/:id/devices`, so forms follow. A ticked step
  shows at once and the server's answer then redraws the form.
- **Task 12:** items and sections are reordered with up/down buttons, which
  also work by keyboard, instead of drag. The form builder has no Preview;
  the playbook editor's "Try it on someone" shows which forms a person gets.
  The builder offers is / is not / is empty / is not empty; "is one of" is
  kept when a form arrives by import.
- **Task 13:** the owner's two forms were expressed without code changes.
- **Tests at the end:** full backend suite and the whole smoke suite run
  once more before the push (see the final commit).

## Notes on the spec

- **One task per ticket form**, not one per section, so a termination with four devices adds five tasks, not forty (decided with the mockups).
- **The server evaluates forms.** The spec leaves where the rules run open; running them only on the server keeps one implementation and means a crafted request can't finish a form the rules wouldn't.
- **Phones and tablets** are recognized by the device conditions an install sets up (asset categories), not by name. The starter check-out form's agent step is therefore optional; an install that wants it required adds a "type is" condition for its computer categories.
- **Agent-set holders and check-out:** dev's inventory keeps the agent's choice of holder in `Device.inventory.agentAssignedContactId`. A check-out must clear it, or a later sign-in by someone else would move a checked-out device (Task 5).
