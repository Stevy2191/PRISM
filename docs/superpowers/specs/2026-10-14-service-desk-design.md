# Service desk, full feature — design

Sub-project 5 of the [PSA roadmap](2026-10-03-prism-psa-roadmap-design.md).
Status: designed 2026-10-14, awaiting review.

## Goal

The ticket desk gets the day-to-day tools a service desk expects. Email
becomes branded and complete: editable templates, CC/BCC, signatures,
technician email notifications, and replies a tech sends from their own mailbox
are captured onto the ticket. Then come the desk tools: team queues, canned
responses, server-side bulk actions, merge and split, and recurring tickets.
Last is a fully customizable, dependent category tree, so a ticket's
categories narrow as you pick them.

Three plans, built and shipped in this order: **5a Email**, **5b Desk tools**,
**5c Categories**.

## Scope changes from the roadmap (agreed 2026-10-14)

- **Dispatch board → sub-project 6.** It merges with 6's workload view into
  one "who's busy with what" screen over tickets and project tasks. A
  schedule grid (techs × time slots) can be added there if needed.
- **Approvals → dropped.** The desk's flow is submit → unassigned queue → a
  tech takes it. Clients agreeing to costs is covered by quotes with
  e-signature (sub-project 14). Approvals can return later as a workflow-rule
  action without redesign.
- **Added: dependent categories (5c)** and **capturing tech replies sent
  from their own mailbox (5a)**.

## Today

- Outbound mail (`emailSender.sendMail`) is plain text. A tech's public reply
  goes to the ticket's contact only. The auto-reply and CSAT survey are
  hard-coded.
- Inbound (`inboundEmailService`): a reply is matched to a ticket by
  `[Ticket #N]` in the subject or a `prism-ticket-N-` Message-ID in the
  headers. It is appended **only if From is the ticket's contact**; anything
  else opens a new ticket for that sender. So a reply from a CC'd person
  opens a new ticket today.
- Notifications are in-app only. They all go through
  `notifications.createNotification`, and `notifications.enabledTypes` is a
  system-wide on/off per type.
- Teams exist (`Ticket.teamId`). There are no queue views.
- Bulk actions loop single PATCHes from the browser.
- There are no canned responses, merge/split, recurring tickets, categories,
  CC lists or signatures.
- The ticket type (incident/request/…) is a fixed enum and stays as it is.
- **S18 (fixed 2026-10-14, before this spec):** `tickets.assign` was checked
  only in the UI. The API now enforces it: without it you may take an
  unassigned ticket, drop your own, or resend the current assignee, but never
  give a ticket to someone else or take one from them.

## Decisions (agreed 2026-10-14)

| # | Decision |
|---|---|
| 1 | Email is HTML + plain-text multipart, with editable templates and placeholders. |
| 2 | Each ticket has a CC list that gets every public reply. CCs from the inbound email that opened the ticket are added. Each reply can add one-off CC/BCC. |
| 3 | Per-user rich-text email signatures. |
| 4 | Technician email notifications: on/off per user per event. Admins set the defaults; the system-wide switch still wins. |
| 5 | A tech's email from their own mailbox that CCs/BCCs the helpdesk is captured. With a ticket number in the subject it is added to that ticket; without one it opens a new ticket the tech can merge. |
| 6 | Captured staff mail must pass the receiving server's sender check (DMARC). Otherwise it is kept as a private note marked "unverified sender". |
| 7 | Queues are Teams. "Take it" claims a queued ticket. |
| 8 | Canned responses: plain text with placeholders; personal, team or everyone. No field-changing macros. |
| 9 | Bulk actions are one server endpoint with a result per ticket. |
| 10 | Merge moves everything into the target; the source is closed with `mergedIntoId`. Same company only. Split makes a new ticket from one comment. |
| 11 | Recurring tickets: template + schedule; one ticket per due run; no backlog after downtime. |
| 12 | Categories: a tree up to 5 levels, built in Settings, with cascading pickers. Each category can be marked "must choose a sub-category". Custom fields can be limited to category branches. |

## 5a — Email

### Templates

- **Defaults live in code**: one entry per template key with subject, HTML
  body and allowed placeholders. **`EmailTemplates`** (new) stores only
  admin overrides: `key (unique), subject, bodyHtml, enabled, updatedById,
  timestamps`. "Reset to default" deletes the row.
- Template keys:
  - To contacts: `contact_auto_reply`, `contact_tech_reply`,
    `contact_resolved`, `contact_csat_survey`.
  - To staff: `staff_assigned`, `staff_reply`, `staff_watcher_update`,
    `staff_new_in_queue`, `staff_sla_warning`, `staff_sla_breached`.
- **`services/email/templates.js`** — `render(key, context) → { subject,
  html, text }`.
  - Placeholders are `{{a.b}}` from that key's whitelist. Values are
    HTML-escaped in the body and plain in the subject (CR/LF stripped).
    Unknown placeholders render empty, and the editor preview flags them.
  - Template HTML is sanitized **on save** with the KB's sanitize-html
    config.
  - The output is wrapped in a branded layout: org name, and the logo as an
    inline CID attachment, never a remote URL. `text` is derived from the
    HTML.
- Every existing sender moves onto `render`: the auto-reply, tech replies,
  the CSAT survey email and the new notification emails.
- **Settings → Email templates**: a list of keys, and an editor with subject,
  TipTap body, placeholder list, live preview (sample ticket) and Reset.
  Admin only, under the existing settings permission.

### Replies, CC/BCC, signatures

- **`Users.emailSignature`** (TEXT, sanitized HTML). Edited on the profile
  with TipTap. The `contact_tech_reply` template includes `{{signature}}`.
- Reply bodies stay plain text in the textarea. They are escaped and line
  breaks become `<br>` in the HTML part.
- **`TicketCcs`** (new): `id, ticketId, email (lowercased), contactId
  (nullable), addedById (nullable = from email), createdAt`. Unique
  `(ticketId, email)`, capped at 20 per ticket.
  - Managed in the ticket sidebar by anyone who can edit the ticket. Viewers
    see the list.
- **`Comments.emailCc` / `Comments.emailBcc`** (JSON, nullable): the one-off
  recipients actually used on that reply, kept as a record.
- A public reply (`reply` or `comment_public`) is sent to the contact, the
  ticket's CC list and the reply's CC as **To/Cc**, and the reply's BCC as
  **Bcc**. Addresses are validated and de-duplicated, at most 20 per field,
  and PRISM's own mailbox addresses are never sent to.
- Inbound email that **creates** a ticket adds its Cc addresses (minus
  PRISM's mailbox and the sender) to the CC list.

### Inbound matching (rewritten as one decision function)

`classifyInbound(parsed) → { action, ticketId?, author, verified }`, unit-tested
on its own. In order:

1. Find the ticket number: `[Ticket #N]` or a plain `#N` in the subject, then
   `prism-ticket-N-` in In-Reply-To/References. If the ticket was merged,
   follow `mergedIntoId` to the live ticket (this branch is added in 5b,
   together with the column).
2. Work out who the sender is:
   - **Contact side:** From is the ticket's contact or on its CC list.
   - **Staff:** From matches an active PRISM user's email.
   - **Other:** anyone else.
3. Act on it:
   - **Ticket + contact side** → add a `reply`, as today. The sender's
     Cc addresses are not auto-added; only staff curate the list after
     creation.
   - **Ticket + staff + verified + user can edit the ticket** → add a
     `comment_public` authored by that user, marked "via email". It is
     **not re-sent**, because the recipients already got it.
   - **Ticket + staff, unverified or without edit rights** → add a
     `comment_private` from the system actor, flagged "unverified sender:
     <address>".
   - **No ticket + staff + verified** → new ticket:
     - The contact is the first To/Cc recipient that is not staff or the
       helpdesk mailbox (found or created as today).
     - It is assigned to the sender (the S18 rule applies, so the
       self-assign is fine).
     - Remaining non-staff recipients go on the CC list.
     - The email is the first comment, authored by the tech.
     - No auto-reply is sent.
     - If no non-staff recipient exists, the email is logged as `ignored`
       ("no customer on the email").
   - **No ticket + staff, unverified** → the same as verified (contact from
     the recipients, otherwise `ignored`), but **unassigned**, with the email
     as a private "unverified sender" note and no CCs added. No auto-reply.
     A contact is never created for a staff address.
   - **Ticket + other** → a new ticket for the sender, as today.
   - **No ticket + other** → a new ticket, as today.
- **Sender verification** (`services/email/senderAuth.js`):
  - **Trusted results:** only results added by the receiving system count,
    meaning the top-most `Authentication-Results` header, or the one whose
    authserv-id equals a configured "trusted mail server" value. Microsoft
    365 internal mail is also accepted when
    `X-MS-Exchange-Organization-AuthAs: Internal` is present.
  - **Pass:** `dmarc=pass` with `header.from` equal to the From domain.
  - **Setting** `inboundEmail.staffSenderCheck`: `strict` (default) or `off`.
  - Tested with real-shaped Gmail and M365 header sets, including a forged
    lower header.
- Every action is written to `EmailProcessingLog`, with new action values for
  the staff cases.

### Technician email notifications

- **`Users.notificationEmailPrefs`** (JSON, nullable = use defaults).
  - Admin defaults live in setting `notifications.emailDefaults`.
  - Events: `assigned`, `comment`, `watcher_update`, `new_in_queue`,
    `sla_warning`, `sla_breached`.
- `createNotification` keeps creating the in-app row. If the type is enabled
  system-wide, the user's effective email preference is on and SMTP is
  configured, it queues an email (`staff_*` template).
  - Emails are sent after the request's transaction commits (fire-and-forget
    with logging), so a mail failure never fails the action.
  - The existing `canReachTicket` check runs first.
- **New event `new_in_queue`:** a ticket is created or moved into a team while
  unassigned. It goes to the team's members, except the actor.
- **Profile → Notifications** has the per-event email switches. **Settings →
  Notifications** gains the default column.

### 5a testing

- **Unit:** `render` (whitelist, escaping, subject CR/LF), `classifyInbound`
  every branch, and `senderAuth` (pass, fail, forged lower header, M365
  internal, `off`).
- **Integration** (stub mail transport capturing messages):
  - Who receives a public reply: contact, CC list, one-off CC/BCC; BCC never
    in To/Cc.
  - Private notes are never emailed.
  - CC list permissions, the cap, and inbound CC capture.
  - A reply from a CC'd address is appended; a stranger with a guessed number
    still gets a new ticket.
  - Staff capture: verified, unverified, no edit rights, no ticket number.
  - Template override and reset; sanitizing on save strips `<script>` and
    event handlers.
  - Notification emails follow preferences, defaults and the system switch.
- **Smoke:** template editor and preview, signature editor, CC panel.

## 5b — Desk tools

### Queues

- The ticket list gets a **Queue** picker: "My queues" (every team I belong
  to) or a single team. Queue views sort unassigned first, then by the
  earliest SLA due date. A badge on the nav shows the unassigned count in my
  queues.
- **Take it** (`POST /tickets/:id/take`): allowed when the ticket is
  unassigned, the user can view it, and they are a member of its team or
  hold `tickets.assign`. It is a self-assign under S18, so no new permission
  is needed. It is atomic: `UPDATE … WHERE assigneeId IS NULL`, and a lost
  race returns 409 "Already taken by X".

### Canned responses

- **`CannedResponses`** (new): `id, title, body (TEXT), visibility
  (personal|team|everyone), ownerId, teamId (nullable), timestamps`.
- **Permissions:**
  - Any staff user manages their own personal responses.
  - `team`/`everyone` responses need a new permission,
    `tickets.canned.manage`.
  - A user sees their own, their teams', and everyone's.
- `POST /tickets/:id/canned/:cannedId/render` fills placeholders server-side
  with the plain-text renderer from 5a. It checks access to both the ticket
  and the response.
- The reply box gets an **Insert** picker with search, which inserts at the
  cursor. Responses are managed in **Settings → Canned responses**; personal
  ones also from the picker.

### Bulk actions

- `POST /tickets/bulk { ids (≤100), action, value }`.
  - Actions: `status`, `priority`, `assign`, `team`, `add_watcher`, `close`,
    `delete`, `merge` (`value` = target id).
  - Each ticket goes through the **same service function** as the single
    edit: edit/assign/delete checks, activity log, workflow rules,
    notifications.
  - The response is `{ results: [{ id, ok, error? }] }`, with "not found" and
    "no access" looking the same.
- The bulk bar adds team, add watcher, merge and delete, and shows the result
  summary.

### Merge and split

- **`Tickets.mergedIntoId`** (nullable FK).
- `POST /tickets/:id/merge { sourceIds }` (target = `:id`):
  - **Who and what can merge:** all tickets in the same company, the user
    can edit every one, no source is the target, and no source is already
    merged.
  - It runs in **one transaction**. Moved over: comments (original
    timestamps kept), attachments, time entries, tasks, watchers and CCs (no
    duplicates), asset links and relations. Relations between the merged
    tickets are dropped.
  - Each source is closed, gets a system comment "Merged into #T", and logs
    activity. The target gets "Merged #S1, #S2 into this ticket".
  - SLA: the target's clocks are unchanged and the sources' clocks stop.
  - Inbound mail for a source follows `mergedIntoId` (see 5a step 1). A
    merged ticket's page shows a banner linking to the target.
- `POST /tickets/:id/split { commentId }`:
  - Needs edit rights on the ticket, and the comment must belong to it.
  - It makes a new ticket with the same contact, company, department and
    team. The title is "Split from #N: <first line>". The comment and its
    attachments move over.
  - The two tickets are linked as related.

### Recurring tickets

- **`RecurringTickets`** (new):
  - Ticket fields: `title, description, priority, type, contactId,
    departmentId, teamId, assigneeId, tasks (JSON list of titles)`.
  - Schedule: `frequency (daily|weekly|monthly|yearly), interval (≥1),
    weekdays (JSON, weekly), dayOfMonth (1–31, last-day clamp; monthly and
    yearly), monthOfYear (yearly), timeOfDay, timezone, startDate, endDate
    (nullable)`.
  - State: `nextRunAt, lastRunAt, lastTicketId, active, createdById,
    timestamps`.
- **Permissions:** managing them needs `tickets.recurring.manage`. The
  contact, department and assignee are validated with the same
  `findAccessible*`/`assertCanWorkTicket` helpers as ticket create, against
  the **creator's** access.
- **`services/recurring/schedule.js`** — `nextRun(rule, after) → Date`, a
  pure function. It handles month-end clamping and DST in the rule's
  timezone.
- **Scheduler:** `setInterval`, every 60 s.
  - It claims each due rule with `UPDATE … SET nextRunAt = <next> WHERE id =
    ? AND nextRunAt = <seen>`, so only the winner creates the ticket.
  - It creates one ticket per claim. After downtime it skips to the next
    future run, so there is no backlog.
  - Tickets get `source='recurring'` (added to the enum) and their tasks.
    They are created as the system actor.
  - It runs the normal create path (SLA clock, workflow rules,
    notifications).
- **Settings → Recurring tickets:** list, editor with a "next 5 runs"
  preview, pause/resume, "Run now".

### 5b testing

- **Integration:**
  - Take-it: success, 409 race, not in team, assigned already.
  - Canned-response visibility and permission; rendering with no ticket
    access is refused.
  - Bulk with mixed access and per-ticket results; each bulk action matches
    its single-edit twin (activity and rules fire).
  - Merge moves everything, refuses across companies and refuses
    already-merged tickets; inbound mail routes to the merged target.
  - Split.
  - Recurring CRUD and permission checks.
  - Scheduler: claims once under two concurrent ticks, and no backlog after
    downtime.
- **Unit:** `nextRun` (month-end, Feb 29, DST forward/back, interval > 1,
  end date).
- **Smoke:** queue view + take, merge dialog, recurring editor.

## 5c — Categories

- **`TicketCategories`** (new): `id, parentId (nullable), name, sortOrder,
  active, requireChild (bool), timestamps`. Unique `(parentId, name)`.
  - Depth ≤ 5, enforced on create/move.
  - Delete is allowed only when no ticket, rule or field uses the category or
    anything below it. Otherwise retire it (`active=false`): it is hidden
    from pickers, along with everything below it, but tickets keep it.
- **`Tickets.categoryId`** (nullable FK) holds the deepest chosen node. The
  API returns `category: { id, path: ['Hardware','Laptop','Battery'] }`.
- **Validation on create/update:**
  - The category must be active.
  - If it has active children and `requireChild` is set, the save is refused
    with "Choose a sub-category under X".
  - Null is always allowed: inbound email and recurring tickets may leave it
    empty.
  - Setting `tickets.categoryRequired` (default off) makes it required on the
    staff create form.
- **Cascading picker** component: one select per level, each showing only the
  chosen parent's active children. Changing a level clears the levels below
  it. It is used on create, the ticket sidebar, the bulk bar and recurring
  templates.
- **Custom fields:** `CustomFields.categoryIds` (JSON, nullable = all). A
  field shows, and is accepted, only when the ticket's category is one of
  those nodes or below one. This works alongside the existing `ticketTypes`
  scope.
- **Everywhere else:**
  - List filter `?category=<id>` includes descendants.
  - Workflow condition field `category` with operators `is` and `is_under`.
  - Category column and grouping in the custom report builder.
- **Settings → Ticket categories:** a tree editor with add child, rename,
  drag reorder or move (depth checked), retire/restore, the `requireChild`
  toggle and usage counts. It needs a new permission,
  `tickets.categories.manage`.
- **Security:** category ids are parsed strictly (`parseRecordId`). The tree
  is global (not per company) and holds no client data, so any staff user
  may read it.

### 5c testing

- **Integration:** depth limit, move cycles refused, `requireChild`
  enforcement, a retired category is refused on new saves but kept on
  existing tickets, delete blocked while in use, the descendant filter,
  custom-field branch scoping (shown and accepted only in branch), and the
  workflow `is_under` condition.
- **Smoke:** tree editor, cascading picker on create.

## Out of scope

- Dispatch board / schedule grid (sub-project 6).
- Approvals (dropped).
- Rich-text reply bodies.
- Field-changing macros.
- Per-company category trees.
- Parsing forwarded emails to find the original sender.
- Stripping quoted text from inbound replies.

## Open question for the user

- **`tickets.close`** is only checked by the bulk "Close selected" button;
  anyone who can edit a ticket can close it on its page and through the API.
  Should closing require `tickets.close` everywhere (it would be enforced in
  5b's shared status path), or should the permission be retired?
