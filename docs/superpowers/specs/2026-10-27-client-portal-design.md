# Sub-project 7 — Client portal (desk)

> Status: design approved 2026-10-27 (agreed in conversation, builder-checked).
> Mockups are approved per screen before the plan is written (as in 6b).
> Roadmap row: 7 in `docs/ROADMAP.md`.

## Intent

Today customers reach the service desk by phone or email. The portal gives
them one link where they sign in, raise tickets, follow and reply to them, and
read the knowledge base written for them.

PRISM is first for the owner's own organization (internal IT), and must work
just as well for an MSP serving client companies. So everything here applies
to **every company in PRISM**, including the organization's own internal
company. "Client" below means any company whose people are contacts.

Only **contacts** use the portal. Staff keep using PRISM itself.

## Goals

1. A contact signs in with their **work Microsoft account**, or, if their
   company has no Microsoft 365, with an email and password they set up from a
   **verification link** staff send them.
2. Microsoft 365 is the source of truth for who people are. A company is
   linked to its Microsoft 365 tenant. People in the chosen groups who sign in
   become contacts automatically, and a nightly sync keeps contacts' details
   current and switches off people disabled in AD/Entra.
3. A contact sees **their own tickets**. **Department admins** see their
   department's tickets; **company admins** see their whole company's.
4. A contact can **create** tickets and **reply** to them. Nothing else.
5. The **knowledge base for customers** lives inside the portal (sign-in
   required). Each article says which companies or departments it is for.

## Non-goals

- Editing a ticket after it is created, closing or reopening it, changing its
  priority, category or assignee from the portal.
- Per-client branding: the portal uses the organization's Company profile
  branding (logo, app name, tagline) and look A.
- Billing, quotes, approvals, assets or projects in the portal (later
  sub-projects).
- Adding everyone in a tenant as contacts ahead of time: the sync only touches
  contacts that already exist.
- Replacing the existing AD (LDAP) contact sync. It stays for installs without
  Microsoft 365; it is not the recommended setup.

## Anti-goals (failure even if it "works")

- A portal session that can call staff APIs, or a staff session silently
  treated as a contact. The two are separate identities.
- A contact who can read a ticket, comment, attachment or article outside
  their own scope by changing an id in a URL (every portal query is scoped on
  the server).
- Private staff comments, time entries, internal notes, SLA internals or staff
  names beyond the "replied by" display ever reaching the portal.
- A person disabled in AD/Entra who can still use an open portal session.
- Deleting tickets or history when a contact is deactivated.
- Service accounts becoming contacts.

## Who can get in

Every contact gets a **Portal access** checkbox (staff edit it on the contact
page). Without it, no sign-in method works.

### Microsoft sign-in

- The portal sign-in page has **Sign in with Microsoft**.
- PRISM uses **one multi-tenant Microsoft app registration** for the install
  (set up once in Settings, credentials stored encrypted like the existing SSO
  secrets).
- Each company can be linked to **one Microsoft 365 tenant** (tenant ID on the
  company page). The organization's admin approves PRISM for that tenant once
  ("admin consent"; the user confirmed they will do this for every client).
- At sign-in PRISM accepts the person only if their tenant is linked to a
  company **and** they are a member of one of that company's **sync groups**
  (below). Otherwise they see a plain "Your account isn't set up for this
  portal" message.
- Matching: by the Microsoft object ID if PRISM has seen this person before,
  else by email within that company (linking the existing contact), else a
  **new contact** is created under that company with **Portal access on**.
- **Staff are not refused.** Anyone in a linked tenant's sync groups gets
  portal access, including people who are also staff users of PRISM. Their
  staff account and their contact stay two separate identities (see
  Security). The inbound email rule that never creates a contact for a staff
  address is unchanged; only portal sign-in creates one.
- **One tenant, one company.** A tenant ID can be linked to only one company.
  If the person's email already belongs to a contact in a *different* company,
  sign-in is refused with "Your account is linked to another organization —
  contact support", and nothing is moved.
- **Password sign-in is off for Microsoft-linked contacts.** Once a contact is
  linked to a Microsoft person, only Microsoft sign-in works for them; any
  password they had stops working and invites are not offered.
- A new contact's department comes from their Microsoft 365 department if it
  maps to a PRISM department (see Detected departments); otherwise none, and
  they see only their own tickets until one is assigned.

### Verification link (no Microsoft 365)

- Staff create the contact (or pick an existing one with an email) and press
  **Send portal invite**. Sending turns Portal access on.
- The contact gets an email with a single-use, expiring link to set a
  password. Then they sign in with email and password.
- **Forgot password** on the portal sign-in page sends a new link to contacts
  who sign in with a password (no answer that reveals whether an email
  exists). *(Builder's addition, implied by passwords.)*

### Losing access

Access ends, and any open portal session stops working at its next request,
when any of these happen:

- Portal access is unticked.
- The contact is made inactive (by staff, or by the sync).
- The sync finds them **disabled** in Microsoft 365 (which follows on-prem AD
  through Entra Connect) or **no longer in the sync groups**: their contact is
  marked inactive.

Their tickets, replies and history are kept.

**Speed:** the sync runs nightly, but a session started with Microsoft also
re-checks that person with Microsoft at least every **15 minutes** while in
use (account enabled, still in a sync group). So someone disabled in AD/Entra
loses portal access within about 15 minutes, and their contact is marked
inactive then.

## Microsoft 365 sync (every company)

Configured on each company page, in a **Microsoft 365** section:

- **Tenant**: the tenant ID, with an "Approve PRISM for this tenant" link (the
  admin-consent URL) and a status (approved / not approved).
- **Sync groups**: pick one or more Microsoft 365 groups. Only members can
  sign in or be synced. Service accounts stay out by not being in them.
- **Sync now** button, plus the last sync's time and a short summary
  (updated, deactivated, new detected departments, errors).
- Runs **nightly** for every linked company, and on **Sync now**.

What the sync does, only for **contacts that already exist**:

- **Links** contacts of that company that aren't linked yet: by email within
  the company, or, for contacts that came from the AD (LDAP) contact sync, by
  their AD object GUID against the person's on-premises immutable ID. A linked
  contact's password sign-in is switched off.

Then, for linked contacts:

- Updates name, email, phone (business phone, else mobile), job title and
  department (via the mapping below).
- Marks the contact **inactive** (portal access ends) when the account is
  disabled or no longer in the sync groups. If they come back, staff
  reactivate them.
- Never creates contacts, never deletes anything.

The sync needs application access to read users and group membership in each
approved tenant. The design does not fix the exact Graph permission names;
read-only access to users and group members, nothing else.

### Detected departments

- Every Microsoft 365 department name found among **all members of the sync
  groups** (not only existing contacts) that does not match a PRISM department
  of that company goes into a **Detected departments** list on the company
  page, with how many people have it. Reading every member's department is the
  one thing the sync reads beyond existing contacts; it creates no contacts.
- For each entry staff can **Create department** (makes a PRISM department of
  that company with that name) or **Map to** an existing department (so
  "Billing Dept" and "billing" can both land in "Billing"). The list doubles as
  a to-do list for cleaning up AD.
- Once created or mapped, matching contacts get that department on the next
  sync (or immediately, builder's choice).
- Until then those people have no department.
- Microsoft 365 wins: a department set by hand is replaced when Microsoft 365
  supplies a name that is created or mapped.

## Admins

- **Department admins**: on a department (within a company), staff mark
  contacts of that department as admins. They see every ticket for that
  department.
- **Company admins**: on the company page (which lists its departments),
  staff mark contacts as company admins. They see every ticket of the company.
- A ticket belongs to a department for this purpose by its **customer
  department** (the contact department field tickets already carry), not the
  staff department working it.
- **Admin roles follow the person.** When a contact's department changes (by
  staff or by the sync), their admin role for the old department is removed.
  When a contact moves to another company, their company admin role and all
  department admin roles are removed.

### Watchers (and CC)

- A ticket's **watchers** can include contacts (today watchers are staff
  only). A contact watcher with portal access sees that ticket in their
  portal list and can open and reply to it, even if it isn't theirs. Staff
  add contact watchers on the ticket page.
- Being **CC'd** does *not* show a ticket in the portal: CC'd people keep
  getting emails, without a "View in the portal" link unless they can also
  see the ticket (own, admin scope, or watcher).

## What a contact can do

### Sign-in page

- At one portal address (e.g. `/portal`). **Sign in with Microsoft**, and email
  plus password underneath. Organization branding and tagline, look A.

### Tickets

- **List**: own tickets and tickets they watch; plus department or company
  tickets for admins.
  Columns kept short (number, title, status, last update; "for" person for
  admins). A status filter (open / closed) and a search.
- **New ticket**:
  - Required: **title** and **description**.
  - Optional: **attachments**, **category**, **priority**.
  - Department and company admins also get an optional **For** field to raise
    the ticket for another contact in their scope.
  - The ticket is created with source "Portal" and the contact (or the "For"
    person) as its contact, and goes through the same rules as any new ticket
    (SLA, workflow rules, categories, notifications).
- **A ticket**: the title, status, number, dates, and the conversation without
  private comments; the description; attachments; a reply box with
  attachments. No editing, closing or reopening.
- Replies from the portal are customer replies on the ticket, exactly as an
  email reply would be (status moves, notifications, SLA all as today), and
  are recorded as **written by that contact**: an admin or watcher replying on
  someone else's ticket shows as themselves. (Today an email reply is stored
  under a system user; portal replies record the contact.)

### Email

- Contacts keep receiving today's ticket emails. Each gains a **View in the
  portal** link when the contact has portal access **and** can see that
  ticket in the portal.
- Replying by email still works; email and portal feed one conversation.

### Knowledge base

- Readable **only when signed in** to the portal. The public `/kb` Help Center
  is removed; its address forwards to the portal sign-in.
- Article audience, chosen when the article is written:
  - **Agents only** (staff), as today.
  - **Portal**, with: **all companies**, or **chosen companies**, or **chosen
    departments** (more than one company or department can be ticked).
- Existing "End users" articles become **Portal, all companies**.
- Search and categories as in today's Help Center.

## Staff side changes (summary)

- **Contact page**: Portal access checkbox; Send portal invite; sign-in method
  shown (Microsoft / password / not set up); admin roles shown.
- **Department** (in a company): mark department admins.
- **Company page**: company admins; Microsoft 365 section (tenant, approval,
  sync groups, Sync now, last sync, detected departments).
- **Settings**: the Microsoft app registration for the portal (client id and
  secret), and the portal on/off switch for the install.
- **Knowledge editor**: the new audience choice.

## Who on staff can set this up

Granting or removing portal access, sending invites, marking department and
company admins, adding contact watchers, linking tenants and running Sync now
need a new permission, **Manage portal access**. It is held by the
administrators (the System Administrator role and owners) and by accounts
deliberately given an **application admin** role that includes it; no other
role has it by default. Staff whose company access is limited can only use it
for companies they can reach. The Microsoft app registration in Settings is
for administrators only.

## Security (standing rule: security first)

- **Separate identities**: portal sessions identify a contact, staff sessions
  a user. Portal routes live under their own API prefix and accept only a
  contact session; no staff route accepts a contact session. A browser can be
  signed in as both without either leaking into the other.
- **Every portal query is scoped on the server** to what the contact may see:
  tickets by own / watcher / department admin / company admin; comments without private
  ones; attachments only of visible tickets; articles by audience. Tests cover
  id-guessing on each.
- Verification and reset links: random, single-use, stored hashed, expiring
  (builder picks the lifetime; 72 hours suggested), invalidated on use or when
  a new one is sent.
- Passwords: the same hashing and strength rules as staff passwords; login
  rate limiting as for staff.
- Microsoft sign-in: verify the token's tenant against linked companies and
  the person's group membership at every sign-in; never trust email alone to
  create a contact in a company.
- Session check on every portal request: contact still active, portal access
  still on, company still linked.
- Uploaded attachments go through virus scanning (5d) like staff uploads.
- Microsoft credentials and tokens stored encrypted; the app has read-only
  directory access.
- Audit: sign-ins, invites, access changes and sync deactivations are logged.

## Constraints

- Stack as today: Express, Sequelize, MariaDB backend; React + Vite +
  Tailwind frontend in look A; no new UI framework.
- New npm dependencies only if needed for Microsoft sign-in/Graph and justified
  (the SSO module already uses `openid-client`; reuse it).
- Migrations follow the repo's rules (reversible, round-trip tested).
- Process: tests first for behaviour; full backend and smoke suites once before
  pushing; push to dev when green; a fresh reviewer at the end (this is
  security-heavy).
- The portal works at phone width (16 px gutter, 44 px targets).

## Decided in conversation (2026-10-27)

- Sign-in: Microsoft work account preferred; contacts only; auto-create for
  people in a linked tenant's chosen groups, portal access on by default for
  them; verification link for people without Microsoft 365.
- Disabled in AD/Entra → contact inactive, portal access ends, tickets kept.
- Full directory sync (admin approval per tenant), nightly plus Sync now; only
  existing contacts; chosen groups; pulls department and phone.
- Detected departments list: create or map; prevents duplicates; helps clean
  up AD.
- Department admins and company admins set in PRISM; portal access checkbox.
- Create and reply only; no editing. Description required; category, priority,
  attachments optional; "For" for admins.
- Emails continue with a portal link; private comments never shown.
- Knowledge base sign-in only; audience per article: all companies, chosen
  companies or chosen departments.
- Organization branding and look A, not per-client branding.
- The new sync is for every company, including the organization's own.

## Settled after the builder check (2026-10-27)

- A disabled person loses access within about 15 minutes (session re-check),
  not only at the nightly sync.
- The sync links existing contacts by email within the company, or AD GUID;
  password sign-in is off for Microsoft-linked contacts.
- Everyone in a linked tenant's sync groups gets portal access, staff
  included; identities stay separate.
- Admin roles are removed when a contact changes department or company.
- One tenant per company; a person whose email is a contact elsewhere is
  refused at sign-in.
- New "Manage portal access" permission: administrators and accounts given an
  application admin role; respects limited company access.
- Detected departments counts all sync-group members.
- Portal replies are recorded as the contact who wrote them.
- CC does not show a ticket in the portal; contact **watchers** do.

## Left to the builder

- Exact data model (tables and columns for tenant links, sync groups, admins,
  detected departments, portal identities and tokens).
- How the scheduler runs the nightly sync (the app's existing scheduled-job
  pattern).
- Portal URL details, session lifetime, and how Microsoft group membership is
  read.
- Whether mapping a detected department updates contacts immediately or at the
  next sync.
- Screen layouts, from mockups approved before building.
