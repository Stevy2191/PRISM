# Service desk 5a — Email Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Branded HTML email from editable templates, ticket CC lists and
one-off CC/BCC, per-user signatures, technician email notifications, and
capture of the replies techs send from their own mailbox. Fake senders are
caught by the receiving server's DMARC result.

**Architecture:** A code catalogue of default templates, plus DB overrides,
feeds one renderer (`services/email/templates.js`). Every outbound email
goes through it. Inbound mail is split into the IMAP shell, which keeps
polling, and an exported `handleParsedMessage`. That function asks a pure
`classifyInbound` what to do and asks `senderAuth` whether staff mail is
genuine. Notification emails come off `createNotification`, so every
in-app event can also email.

**Tech Stack:** Express + Sequelize + MariaDB, nodemailer, mailparser,
sanitize-html, React + TipTap (`components/RichTextEditor.jsx`), Jest (Node
24) and the Playwright smoke suite.

**Spec:** `docs/superpowers/specs/2026-10-14-service-desk-design.md`
(section "5a — Email"). The plan lists tasks, interfaces and test names, not
full code (user rule).

## Global Constraints

- Node ≥ 24.9. From `backend/`, run `npm test -- <paths>`. Jest pins
  `TZ=America/Chicago`. Integration tests run serially on one DB. Before
  `npm run test:migrate`, load the env: `set -a; . ./.env.test; set +a`.
- No new npm dependency.
- Migration `20260101000063-service-desk-email.js` (plus `…064-ticket-status-rework.js`, Task 11), each with a working
  `down()` and a round-trip test that leaves the schema as the full chain
  does.
- Mutating endpoints: permission check plus `writeAudit`. Fetch-by-id
  re-checks scope, and missing and out-of-scope look the same. Ids are
  parsed with `parseRecordId`/`parseTicketId`.
- Every stored rich HTML (templates, signatures) goes through
  `sanitizeRichHtml` **on the server, on save**.
- Every placeholder value is HTML-escaped unless its catalogue entry says
  `html: true`. Only `signature` and `survey.starLinks` are `html: true`, and
  both are server-built or sanitized. Subjects have CR/LF stripped.
- Outbound mail never blocks or fails the request that caused it. Sends run
  after the response path (`setImmediate`), and errors go to
  `console.error`.
- Mail tests use `jest.mock('../../src/services/emailSender')` (see
  `tickets.comments.test.js`).
- Owner-only settings (`ownerSettings`): incoming/outgoing mail. Templates
  and notification defaults use `manageSystem`.
- During building run only affected files. Run the full backend suite and
  full smoke once, before the push.

## Review Focus

1. **A template containing `<script>`, `onerror=` or `javascript:` links, or
   a placeholder value containing `<b>`** → stored stripped, and the value
   arrives escaped. Tests in Tasks 2 and 3.
2. **A forged `Authentication-Results: dmarc=pass` header placed below the
   receiving server's real `dmarc=fail`** → unverified. Test in Task 8.
3. **A reply whose subject says `#123` from someone who is neither the
   contact, nor on the CC list, nor staff** → a new ticket for them, and
   nothing added to #123. Test in Task 9.
4. **The same address as contact, ticket CC and one-off BCC** → it receives
   one copy, and BCC addresses never appear in To/Cc. Test in Task 6.
5. **SMTP not configured, or the server down, while posting a reply or
   assigning** → the action succeeds, and no email is attempted beyond one
   logged failure. Test in Task 6.

---

### Task 1: Schema

**Files:**
- Create `backend/migrations/20260101000063-service-desk-email.js`.
- Create `backend/src/models/EmailTemplate.js`, `backend/src/models/TicketCc.js`.
- Modify `backend/src/models/index.js`, `User.js`, `Comment.js`,
  `EmailProcessingLog.js`.
- Test `backend/test/integration/email.migration.test.js`.

**Interfaces:**
- Produces:
  - `EmailTemplates`: `id, key STRING(64) unique, subject STRING(255),
    bodyHtml TEXT, enabled BOOL default true, updatedById INT null FK Users,
    timestamps`.
  - `TicketCcs`: `id, ticketId FK CASCADE, email STRING(255) lowercased,
    contactId null FK Contacts SET NULL, addedById null FK Users SET NULL,
    createdAt`. Unique `(ticketId,email)`.
  - Association `Ticket.hasMany(TicketCc, as 'ccs')`.
  - `Users.emailSignature TEXT null`, `Users.notificationEmailPrefs JSON
    null`.
  - `Comments.emailCc JSON null`, `Comments.emailBcc JSON null`,
    `Comments.viaEmail BOOL default false`.
  - `EmailProcessingLog.action` ENUM gains `staff_reply_added`,
    `unverified_note`, `staff_ticket_created`,
    `staff_ticket_unverified`.
  - Setting `notifications.enabledTypes`: if a stored row exists, append
    `new_in_queue`.

- [x] Write the tests:
  - `'creates the tables and columns'`
  - `'adds new_in_queue to a stored enabledTypes list'`
  - `'round-trips (down then up)'`
- [x] Run them and see them fail.
- [x] Write the migration and the models, and register the associations.
- [x] Run `test:migrate` and the tests, and see them pass.
- [x] Commit `feat(email): schema for templates, CCs, signatures, email prefs`.

### Task 2: Shared HTML sanitizer

**Files:**
- Create `backend/src/utils/richHtml.js`.
- Modify `backend/src/controllers/knowledgeController.js`: move
  `SANITIZE_CONFIG` and the strip-to-text helper out.
- Test `backend/test/unit/richHtml.test.js`.

**Interfaces:**
- Produces:
  - `sanitizeRichHtml(html) → string` (the KB config, unchanged).
  - `htmlToPlainText(html) → string`: block elements become newlines, `<br>`
    becomes a newline, `<a href>` becomes `text (url)`, entities are decoded.
  - `textToHtml(text) → string`: escape, then `\n` becomes `<br>`.
  - `escapeHtml(s)`.

- [x] Write the tests:
  - `'strips script, event handlers and javascript: urls'`
  - `'keeps the KB toolbar formatting'`
  - `'htmlToPlainText keeps paragraphs and link urls'`
  - `'textToHtml escapes and keeps line breaks'`
- [x] Run them and see them fail.
- [x] Implement, and point the KB at the new module.
- [x] Run the tests plus `knowledge*.test.js`, and see them pass.
- [x] Commit.

### Task 3: Template catalogue and renderer

**Files:**
- Create `backend/src/services/email/catalog.js` and
  `backend/src/services/email/templates.js`.
- Test `backend/test/unit/emailTemplates.test.js`.

**Interfaces:**
- Produces `CATALOG`, a frozen map `key → { audience: 'contact'|'staff',
  name, subject, bodyHtml, placeholders: [{ name, description, html? }],
  defaultEnabled }`, with these keys:
  - `contact_auto_reply`, `contact_tech_reply`
  - `contact_resolved` (**defaultEnabled false**, because it is a new email
    to customers)
  - `contact_csat_survey`
  - `staff_assigned`, `staff_reply`, `staff_watcher_update`,
    `staff_new_in_queue`, `staff_sla_warning`, `staff_sla_breached`
- Common placeholders:
  - Ticket: `ticket.number`, `ticket.title`, `ticket.url`,
    `ticket.status`, `ticket.priority`
  - People: `contact.firstName`, `contact.name`, `tech.name`
  - Org and comment: `org.name`, `comment.body`
  - Per key: `signature` (html, tech reply) and `notification.message`
    (staff keys)
  - CSAT: `survey.question`, `survey.starLinks` (html), `survey.url`
- Produces `renderTemplate(source: { subject, bodyHtml, placeholders },
  context: object, { orgName, hasLogo }) → { subject, html, text }`. It is
  pure. The body is wrapped in the branded layout. The logo is `<img
  src="cid:org-logo">` only when `hasLogo` is set.
- Produces `async render(key, context) → { subject, html, text,
  attachments, enabled }`:
  - Loads the `EmailTemplates` override or the default.
  - Reads `company.name` and the logo file.
  - `attachments` carries the logo as `{ cid: 'org-logo', path }` when a
    logo exists.
- Produces `async getTemplate(key) → { key, subject, bodyHtml, enabled,
  isDefault }`.

- [x] Write the tests:
  - `'replaces whitelisted placeholders'`
  - `'unknown placeholders render empty'`
  - `'escapes values unless the placeholder is html'`
  - `'strips CR/LF from the subject'`
  - `'text part is derived from the html'`
  - `'layout carries the org name and a cid logo only when hasLogo'`
  - `'every catalogue default only uses its own placeholders'`
- [x] Run them and see them fail.
- [x] Implement.
- [x] Run the tests and see them pass.
- [x] Commit.

### Task 4: Templates API and Settings page

**Files:**
- Create `backend/src/controllers/emailTemplatesController.js`.
- Modify `backend/src/routes/settings.js` (under `manageSystem`).
- Create `frontend/src/pages/settings/EmailTemplates.jsx`.
- Modify `frontend/src/pages/settings/registry.js`: add page `email-templates`
  in group "Sign-in & email", access SYSTEM, and **remove** the
  `/settings/email-templates` redirect. Register the route where other
  settings pages are registered.
- Test `backend/test/integration/email.templates.test.js`.

**Interfaces:**
- Endpoints:
  - `GET /settings/email-templates` → `{ templates: [{ key, name,
    audience, enabled, isDefault }] }`
  - `GET /settings/email-templates/:key` → template plus `placeholders`
  - `PUT /settings/email-templates/:key { subject, bodyHtml, enabled }`:
    unknown key → 404; subject 1–255 characters; body ≤ 100 KB; body is
    sanitized; audited.
  - `DELETE /settings/email-templates/:key` → reset to default, audited.
  - `POST /settings/email-templates/:key/preview { subject, bodyHtml }` →
    `{ subject, html }`, rendered with a fixed sample context and sanitized
    the same way. It is not saved.
- Page: list on the left; editor with a subject input, `RichTextEditor`,
  clickable placeholder chips that insert `{{name}}`, an enabled switch, a
  preview pane (iframe `srcdoc`, `sandbox=""`), Save and "Reset to default".

- [x] Write the tests:
  - `'lists every catalogue key with isDefault true at first'`
  - `'saving sanitizes the body and audits'`
  - `'reset returns the default'`
  - `'unknown key is 404'`
  - `'preview renders without saving'`
  - `'needs manage-system: technician gets 403'`
- [x] Run them and see them fail.
- [x] Implement the backend.
- [x] Run the tests and see them pass.
- [x] Build the page, and run `npm run build` (frontend).
- [x] Commit.

### Task 5: Existing emails move onto templates, plus signatures

**Files:**
- Modify `backend/src/controllers/tickets/comments.js`
  (`sendReplyEmailToContact`).
- Modify `backend/src/services/inboundEmailService.js` (`sendAutoReply`).
- Modify `backend/src/services/csatService.js` (`buildSurveyEmail` → async,
  uses `render('contact_csat_survey')`; the CSAT settings preview keeps
  working) and `csatScheduler.js`.
- Modify `backend/src/controllers/usersController.js` (`updatePreferences`
  accepts `emailSignature`).
- Modify `frontend/src/pages/settings/Preferences.jsx` (signature editor).
- Modify the ticket status-change path in
  `backend/src/controllers/tickets/core.js`: send `contact_resolved` when the
  status moves into any closed-kind status (user decision 2026-10-15) and the
  template is enabled.
- Test: update `tickets.comments.test.js` and the CSAT tests; add
  `backend/test/integration/email.signature.test.js`.

**Interfaces:**
- Consumes `render`, `textToHtml`, `sanitizeRichHtml`.
- Produces `async sendTicketEmail(key, { ticket, comment?, author?, to, cc?,
  bcc? })`, in `services/email/ticketMail.js`:
  - Builds the context: the number is 5-digit padded, and `ticket.url` comes
    from the app base URL the CSAT code already uses.
  - Skips when the template is disabled.
  - Sets `messageId` with `buildTicketMessageId`, plus the
    `X-PRISM-Ticket-ID` header.
  - The subject keeps `[Ticket #NNNNN]` (each default includes it).
  - Calls `sendMail`.
- The contact templates' `comment.body` is `textToHtml(comment.body)`,
  passed as `html: true` through an internal context key.
- Signature: ≤ 20,000 characters after sanitizing. Self or admin can set it,
  as with today's preferences.

- [ ] Write and update the tests:
  - `'a public reply emails an html+text message with the subject tag and thread headers'`
  - `'the tech signature is included; a signature with script is stored stripped'`
  - `'a disabled contact_tech_reply sends nothing'`
  - `'auto-reply and csat survey use their templates'`
  - `'contact_resolved is off by default and sends once enabled'`
- [ ] Run them and see them fail.
- [ ] Implement.
- [ ] Run the tests and see them pass.
- [ ] Build the signature editor UI.
- [ ] Commit.

### Task 6: Ticket CC list and reply recipients

**Files:**
- Create `backend/src/services/email/recipients.js` and
  `backend/src/controllers/tickets/ccs.js`.
- Modify `backend/src/routes/tickets.js`, `controllers/tickets/index.js` and
  `comments.js` (`createComment` accepts `emailCc`, `emailBcc`).
- Create `frontend/src/pages/tickets/detail/CcPanel.jsx`. Modify
  `Sidebar.jsx` and `ReplyBox.jsx` (CC/BCC fields behind a "Cc/Bcc" toggle,
  public replies only).
- Test `backend/test/unit/recipients.test.js` and
  `backend/test/integration/tickets.ccs.test.js`.

**Interfaces:**
- Produces `buildReplyRecipients({ contactEmail, ccList: string[], extraCc:
  string[], extraBcc: string[], ownAddresses: string[] }) → { to: string[],
  cc: string[], bcc: string[] }`. It is pure:
  - It lowercases and validates (the same regex as Contacts), and drops
    invalid addresses and own addresses.
  - It de-duplicates across fields with priority to > cc > bcc.
  - It throws `ApiError(400)` when `extraCc` or `extraBcc` exceeds 20.
- Produces `normalizeEmailList(input) → string[] | throws 400`.
- Endpoints:
  - `GET /tickets/:id/ccs` (view) → `{ ccs: [{ id, email, contact: {id,
    name}|null }] }`
  - `POST /tickets/:id/ccs { email }` (edit): links a contact only if
    `findAccessibleContact` finds one by that email. Duplicate → 409. A
    21st entry → 400. Audited.
  - `DELETE /tickets/:id/ccs/:ccId` (edit), audited.
- `createComment`:
  - `emailCc`/`emailBcc` are only allowed on `reply`/`comment_public`;
    on a private note they give a 400.
  - The values actually used are stored on the comment.
  - Mail goes out through `sendTicketEmail('contact_tech_reply', { to, cc,
    bcc })`.
- `ownAddresses` = the inbound mailbox address plus the SMTP from address.

- [ ] Write the tests:
  - unit: `'to/cc/bcc de-duplicate with to winning'`,
    `'own mailbox addresses are dropped'`,
    `'invalid addresses are dropped'`, `'more than 20 extra is a 400'`
  - integration: `'a public reply goes to contact + ticket CCs + one-off CC, BCC only in bcc'`
  - integration: `'private notes are never emailed and reject emailCc'`
  - integration: `'view-only users list CCs but cannot add or remove'`
  - integration: `'CC list cap and duplicate'`
  - integration: `'an inaccessible contact with that email is not linked'`
  - integration: `'SMTP not configured: the reply still saves (201)'`
- [ ] Run them and see them fail.
- [ ] Implement the backend.
- [ ] Run the tests and see them pass.
- [ ] Build the UI.
- [ ] Commit.

### Task 7: Inbound refactor (no behaviour change yet)

**Files:**
- Create `backend/src/services/email/inboundClassify.js`.
- Modify `backend/src/services/inboundEmailService.js`: split
  `processOneMessage` into the IMAP fetch/mark parts plus an exported
  `handleParsedMessage(parsed, config) → { action, ticketId|null }`, which
  writes the `EmailProcessingLog` row.
- Test `backend/test/unit/inboundClassify.test.js` and
  `backend/test/integration/email.inbound.test.js` (it feeds
  `mailparser.simpleParser` output built from raw RFC822 fixtures in
  `backend/test/fixtures/mail/`).

**Interfaces:**
- Produces `findTicketNumber(subject, inReplyTo, references) → int|null`:
  - Matches `[Ticket #N]`, then a standalone `#N` (preceded by start, space
    or `[`, and followed by end, space, `]` or `:`), then
    `prism-ticket-N-` in the headers.
  - It replaces `detectTicketId`.
- Produces `classifyInbound({ ticketFound: bool, senderKind:
  'contact_side'|'staff'|'other', verified: bool, staffCanEdit: bool,
  hasCustomerRecipient: bool }) → action`. It is pure. The actions are:
  - `reply_added`
  - `staff_reply_added`
  - `unverified_note`
  - `staff_ticket_created`
  - `staff_ticket_unverified`
  - `ticket_created`
  - `ignored`

  The cases follow the spec's list, and Task 9 wires them all.

- [ ] Write the tests: one unit test per row of the spec's matching list,
  plus `'findTicketNumber: [Ticket #00012], "Re: #12 printer", "PO#12x" (no match), headers'`.
- [ ] Write an integration test pinning today's behaviour through
  `handleParsedMessage`: `'contact reply appends'`,
  `'stranger with a guessed number gets a new ticket'`,
  `'own-mailbox loop is ignored'`.
- [ ] Run them and see them fail.
- [ ] Implement the refactor.
- [ ] Run the tests plus `companies.inbound.test.js`, and see them pass.
- [ ] Commit.

### Task 8: Sender verification

**Files:**
- Create `backend/src/services/email/senderAuth.js`.
- Modify `backend/src/controllers/emailSettingsController.js` and
  `frontend/src/pages/settings/InboundEmailSection.jsx`: add the settings
  `inboundEmail.staffSenderCheck` (`strict`|`off`, default `strict`) and
  `inboundEmail.trustedAuthServId` (optional, owner-only).
- Test `backend/test/unit/senderAuth.test.js` with header fixtures.

**Interfaces:**
- Produces `verifySender(headers: Map|object (mailparser headers), fromAddress,
  { mode, trustedAuthServId }) → { verified: bool, reason: string }`:
  - With `mode 'off'`, it always returns verified.
  - The result is taken from the `Authentication-Results` header whose
    authserv-id equals `trustedAuthServId`. Without that setting, only the
    **top-most** header counts.
  - It passes when `dmarc=pass` and `header.from` equals the From domain.
  - It also passes when `x-ms-exchange-organization-authas: Internal` is
    present.
  - Comparisons are case-insensitive.

- [ ] Write the tests:
  - `'gmail dmarc=pass passes'`
  - `'m365 dmarc=pass passes'`
  - `'m365 internal AuthAs passes'`
  - `'dmarc=fail fails'`
  - `'no header fails'`
  - `'forged pass below a real fail fails'`
  - `'header.from of another domain fails'`
  - `'trustedAuthServId picks the matching header'`
  - `'off mode always verifies'`
- [ ] Run them and see them fail.
- [ ] Implement, including the settings fields.
- [ ] Run the tests and see them pass.
- [ ] Commit.

### Task 9: Capture staff mail and CC'd senders

**Files:**
- Modify `backend/src/services/inboundEmailService.js`
  (`handleParsedMessage`).
- Modify `frontend/src/pages/tickets/detail/ConversationTab.jsx`: a
  "via email" badge on `viaEmail` comments.
- Test: add to `backend/test/integration/email.inbound.test.js`.

**Interfaces:**
- Consumes `findTicketNumber`, `classifyInbound`, `verifySender`.
- The sender kind is:
  - `contact_side` when From is the ticket's contact email or in its
    `TicketCcs`;
  - `staff` when an active `User.email` matches From (case-insensitive);
  - otherwise `other`.
- `staffCanEdit` is decided by the existing edit-access check, the same one
  PATCH uses.
- What each action writes:
  - `staff_reply_added` → a `comment_public` with author = that user and
    `viaEmail` true. **No outbound send.** First-response SLA is **not**
    recorded (the spec only counts the comment endpoint).
  - `unverified_note` → a `comment_private` from the system actor:
    "Unverified sender <addr>:\n\n<body>".
  - `staff_ticket_created` → a ticket whose contact is the first To/Cc
    recipient that is not staff and not an own address (found or created
    through `findOrCreateContact`).
    - It is assigned to the sender.
    - Other customer recipients go into `TicketCcs` (cap 20).
    - The body becomes a `comment_public` by the tech with `viaEmail`.
    - No auto-reply.
  - `staff_ticket_unverified` → the same, but unassigned, with the body as
    the unverified private note and no CCs.
  - No customer recipient → `ignored`, logged with the error text "No
    customer on the email".
  - `ticket_created` (any sender) also adds the email's Cc addresses
    (minus own addresses and the sender) to `TicketCcs`.
  - A contact is **never** created for a staff address.

- [ ] Write the tests:
  - `'a CC-listed address replying is appended'`
  - `'a verified tech CCing the helpdesk with #N adds a via-email reply and sends nothing'`
  - `'an unverified tech becomes a private unverified note'`
  - `'a verified tech without edit access becomes an unverified note'`
  - `'a tech with no number opens a ticket for the customer, assigned to the tech, others CC\'d, no auto-reply'`
  - `'an unverified tech with no number: unassigned, note, no CCs, no contact for the tech'`
  - `'only staff recipients: ignored'`
  - `'new ticket from email captures its Cc list minus our mailbox'`
  - `'a contact with "#77" in the subject on someone else\'s ticket 77 gets a new ticket'`
- [ ] Run them and see them fail.
- [ ] Implement.
- [ ] Run the tests and see them pass.
- [ ] Commit.

### Task 10: Technician email notifications

**Files:**
- Create `backend/src/services/email/notificationMail.js`.
- Modify `backend/src/services/notifications.js` (`createNotification`
  queues the email; new `notifyNewInQueue`).
- Modify `backend/src/controllers/settingsController.js`: add `new_in_queue`
  to `ALL_NOTIFICATION_TYPES`, and add the default
  `notifications.emailDefaults` as JSON in `JSON_KEYS`.
- Modify `controllers/tickets/core.js`: call `notifyNewInQueue` on create,
  and on a team change while unassigned.
- Modify `usersController.updatePreferences` (`notificationEmailPrefs`).
- Modify `frontend/src/pages/settings/Preferences.jsx` (an email switch per
  event) and `Notifications.jsx` (the default column).
- Test `backend/test/integration/email.notifications.test.js`.

**Interfaces:**
- Produces `EMAIL_EVENTS`, mapping each notification type to its template:

  | Notification type | Template |
  |---|---|
  | `assigned` | `staff_assigned` |
  | `comment` | `staff_reply` |
  | `watcher_update` | `staff_watcher_update` |
  | `new_in_queue` | `staff_new_in_queue` |
  | `sla_warning` | `staff_sla_warning` |
  | `sla_breached` | `staff_sla_breached` |

  Other types (`reply`, `overdue`, `due_soon`, `status_change`, `workflow`)
  never email.
- Default `notifications.emailDefaults` = `{ assigned: true, comment: true,
  new_in_queue: true, sla_warning: true, sla_breached: true, watcher_update:
  false }`.
- Produces `effectiveEmailPref(user, type, defaults) → bool`. A user value
  wins over the default, and an unknown type is false.
- Produces `queueNotificationEmail(notification) → void`:
  - It runs under `setImmediate`.
  - It loads the user (must be active, with an email) and the ticket.
  - It renders the `staff_*` template with `notification.message`.
  - It sends to that user only and catches errors.
- In `createNotification`, after `Notification.create` succeeds, the email is
  queued when the type is in `EMAIL_EVENTS` and the effective pref is on.
  This keeps the existing `isTypeEnabled` and `canReachTicket` gates.
- Produces `notifyNewInQueue(ticket, actorId)`. It runs only when `teamId`
  is set and `assigneeId` is null, and it notifies every `TeamMember` except
  the actor.
- `updatePreferences` accepts `notificationEmailPrefs` as an object with
  boolean values for known keys only; anything else is a 400.

- [ ] Write the tests:
  - `'assignment emails the assignee when their pref is on, not when off'`
  - `'the admin default applies when the user has no pref'`
  - `'a type turned off system-wide sends neither in-app nor email'`
  - `'new ticket into a team while unassigned notifies members except the actor'`
  - `'a user who cannot reach the ticket\'s company gets no email'`
  - `'an inactive user gets no email'`
  - `'bad notificationEmailPrefs is a 400'`
  - `'SLA warning emails through staff_sla_warning'`
- [ ] Run them and see them fail.
- [ ] Implement.
- [ ] Run the tests plus `sla*.test.js` and `notifications*`, and see them
  pass.
- [ ] Build the UI.
- [ ] Commit.

### Task 11: Ticket status rework (added 2026-10-15, user decisions)

The user asked for this during 5a (see the spec's "Status rework" section).

**Files:**
- Create `backend/migrations/20260101000064-ticket-status-rework.js`, a
  migration of its own with a working `down()`.
- Modify `backend/src/models/TicketStatus.js`, `services/statusBehavior.js`,
  `controllers/statusesController.js`, `controllers/tickets/core.js`
  (PATCH/create refuse User responded), `comments.js` (tech public reply),
  and `inboundEmailService.js` (contact-side reply).
- Frontend: the Statuses settings page (On hold kind), ticket status pickers
  (hide User responded), the list/filter "On hold" option, and badges.
- Test `backend/test/integration/statuses.rework.test.js`.

**Interfaces:**
- `TicketStatuses.behaviorType` ENUM gains `on_hold` (tickets only; project
  statuses keep open/closed/archived).
- `TicketStatuses.systemKey STRING(32) null unique`: `user_responded` and
  `waiting_on_user`. Both rows are protected.
- Seeded set and moves: Open (open), Waiting on User (open), User responded
  (open), On Hold (on_hold), Postponed (on_hold), Request completed (closed),
  Request cancelled (closed), Closed (closed).
  - In Progress → Open, Pending → On Hold, Resolved → Request completed.
  - Only the seeded rows are touched, matched by name. An admin's own
    statuses stay. Tickets follow, and so do workflow condition and action
    values that name a moved status.
- On hold never counts as closed. `getTicketStatusBuckets().open` and
  `getTicketStatusBehaviorMap()` keep reporting on-hold names as open, so
  every existing caller (SLA clocks, overdue, open lists) is unchanged.
  `buckets.onHold` and `getTicketStatusKindMap()` (the real kind) exist for
  filters, the settings page and reports.
- User responded is set only by the system. PATCH and create return 400 for
  it, unless the ticket is already in it and the status is unchanged.
- Automatic moves:
  - A contact-side inbound reply on an open or on-hold ticket → User
    responded.
  - A reply to a closed ticket keeps its status, and the assignee gets a
    `comment` notification "Customer replied to closed ticket #N".
  - A tech's public reply (`reply`/`comment_public`) through the comment
    endpoint on a User responded ticket → Waiting on User.
  - Each move goes through the normal ticket update path, so activity, SLA
    hooks and workflow rules see it.
- `contact_resolved` fires on any move into a closed-kind status (Task 5).

- [ ] Write the tests:
  - `'migration maps In Progress, Pending, Resolved and keeps admin statuses'`
  - `'round-trips (down then up)'`
  - `'on-hold tickets still count as open and keep their SLA running'`
  - `'User responded cannot be chosen by hand'`
  - `'a contact reply moves an open ticket to User responded'`
  - `'a contact reply to a closed ticket stays closed and notifies the assignee'`
  - `'a tech public reply moves User responded to Waiting on User; a private note does not'`
  - `'on_hold is refused for project statuses'`
- [ ] Run them and see them fail.
- [ ] Implement.
- [ ] Run the tests plus `settings.status*.test.js`, `sla*.test.js`, and see them pass.
- [ ] Build the UI.
- [ ] Commit.

### Task 12: Smoke, docs, push

**Files:**
- Create `backend/test/smoke/email.smoke.js`.
- Modify `docs/ROADMAP.md` (5: Building, plan link).
- Modify the plan checkboxes.
- Add release-note lines for 5a under the Phase 1 section of `UPGRADING.md`.

- [ ] Write the smoke tests:
  - `'email templates: edit, preview, reset'`
  - `'preferences: signature saves'`
  - `'ticket: add and remove a CC; reply shows Cc/Bcc toggle'`

  Follow the stub/seed recipe in the existing `companies.*.smoke.js`.
- [ ] Run the full backend suite once, then the full smoke once. Both must
  be green.
- [ ] Commit the docs, and push to `dev`.
