# Playbooks — forms and checklists on tickets, and the device lifecycle

> Status: design drafted 2026-11-06 from conversation; waiting for review.
> Mockups are approved per screen before the plan is written (as in 6b and 7).
> Roadmap row: "Playbooks" in `docs/ROADMAP.md` (Phase 1 addition).

## Intent

A lot of desk work is a known list of steps: setting up a new account,
issuing a laptop, taking devices back when someone leaves. Today those steps
live in documents outside PRISM, nothing makes sure they are done, and a
ticket can be closed with a laptop still unaccounted for.

This sub-project lets an organization write its own **forms** (checklists with
fields), group them into **playbooks**, and apply a playbook to a ticket with
one click. PRISM works out which steps apply from what it already knows (the
person the work is for, their devices, each device's type and MDM) and won't
let the ticket close until the required steps are done.

PRISM **produces and tracks the steps; it does not perform them** in AD,
Microsoft 365, an MDM or anywhere else.

PRISM is installed by many organizations, internal IT and MSPs alike. Nothing
here is specific to one organization's tools: MDMs, device types, forms and
playbooks are all set up by each install. The owner's Apple check-out and
check-in documents (below) are the acceptance test for the form builder, not
built-in content.

## Goals

1. Staff with the right permission build **forms**: sections, explanatory
   text, checkbox steps, fields to record (including **secure** fields), and
   steps that show only when they apply.
2. Forms are grouped into **playbooks**. A playbook block applies **once per
   ticket** or **once per device**, and per-device blocks can be limited by
   device type, managed or not, and MDM.
3. On any ticket, **Apply playbook** adds the playbook's forms to the ticket.
   Each form shows as a task on the ticket. Workflow rules can **suggest** a
   playbook; they never apply one on their own.
4. A playbook that needs a person asks for one **when it is applied**, with a
   guess taken from the ticket's subject. The person's assigned devices are
   offered for per-device blocks.
5. Devices can be **picked or created inside the ticket**; a created device is
   a real asset. Adding a device to a ticket that has an applied playbook adds
   the forms that device needs.
6. A form step can **check a device out or in** in PRISM, with the result
   status chosen in the step.
7. A ticket **cannot close** while any of its forms is unfinished, unless
   someone with the override permission closes it with a reason.
8. Devices record whether they are **managed** and, if so, by **which MDM**,
   from a list each install keeps.
9. Forms and playbooks can be **exported and imported** as a file, so
   organizations can share processes without anything being hard-coded.
10. Devices record whether they have **cellular service** and, if so, the
    **IMEI**, **phone number** and **carrier**. Forms and playbooks can use
    "has cellular" (e.g. "cancel or move the line" only for devices with one).
11. Works with the **PRISM agent** (sub-project 8): a device created in a
    ticket is the Asset the agent claims; steps can be confirmed by the
    agent; checking a computer in revokes its agent so it can be reissued
    cleanly.

## Non-goals (this sub-project)

- Performing steps in other systems (creating accounts, assigning licenses,
  wiping devices). PRISM only lists, records and checks steps off.
- Steps confirmed automatically by AD or Microsoft 365 sync ("AD account
  disabled" ticked once sync sees it). Follow-up; see "Later".
- Opening a termination ticket automatically when a contact is disabled.
  Follow-up.
- The user profile view (everything about a person: devices, licenses, AD and
  Microsoft 365 details, mapped drives). Its own follow-up sub-project.
- Forms on projects or project tasks. Tickets only.
- Contacts seeing or filling in forms in the client portal.
- A person field on the ticket itself (decided: the person belongs to the
  applied playbook, not the ticket).
- Reworking ticket Blueprints. They are untouched here.

## Anti-goals (failure even if it "works")

- Any MDM, device type, vendor or organization name built into the code or the
  shipped templates.
- A ticket that closes with an unfinished required step and no recorded
  override.
- A secure value (password, bypass code, passcode) appearing anywhere except
  the reveal on its own form: not in lists, activity, notifications, email,
  PDFs, exports, search or CSV.
- Editing a form in Settings changing a form already in progress on a ticket.
- A device checked out by a form step without its normal check-out history,
  activity and assignment, i.e. a second check-out path that drifts from the
  first.
- A rule applying a playbook without a person clicking Apply.

## Words used here

- **Form**: a reusable template: sections of text, steps and fields.
- **Playbook**: a named set of form blocks, each applied once or per device.
- **Applied playbook**: one use of a playbook on one ticket, with the person
  it was applied for.
- **Ticket form**: a copy of a form on a ticket (for one device, or for the
  ticket), with its answers. Shows as one ticket task.
- **Device**: an asset. "Device type" is the asset's category.

## Devices: managed and MDM

- **Settings › Assets › MDMs**: a list each install keeps. Each entry has a
  name, an optional console address, and active/inactive. Retiring an MDM
  keeps it on the devices that have it and hides it from new choices.
  Records point at the MDM's id, so renaming one changes it everywhere.
- **On every asset**:
  - **Managed**: yes or no (default no; existing assets start as no).
  - **MDM**: shown and required when managed is yes; from the active list.
  - **MDM device ID**: optional text. The MDM's console address may contain
    `{id}`, which is replaced with the device's MDM ID to make an "Open in
    <MDM>" link on the asset and on its ticket forms.
- Asset list filters and the asset import gain managed and MDM.

### Cellular

Phones and tablets usually have a line; some laptops do too, so this is not
tied to a device type.

- **On every asset**: **Cellular**: yes or no (default no). When yes:
  - **IMEI**: 15 digits, checked with the standard check digit. A warning (not
    a refusal) if another active asset already has it.
  - **Phone number**: optional (data-only lines have none), shown and stored
    with the existing phone formatting. A warning if another active asset
    already has it.
  - **Carrier**: a **vendor company** (vendors are already companies in
    PRISM), so each install keeps its own carriers, with their contacts and
    contracts, and nothing is hard-coded.
- Asset categories gain **"Cellular by default"**, so a new phone or tablet
  starts with cellular on; it can still be switched either way per device.
- Asset list filters, the asset import and export, and global search
  (phone number, IMEI) include these fields.
- Not secret: shown to anyone who can view the asset.
- **Asset statuses**: today `active`, `in_repair`, `retired`, `in_storage`,
  `lost`. Add:
  - `ready_to_issue` (in stock, checked in, ready for the next person), and
  - `on_hold` with a required reason (can't be issued yet: locked, waiting on
    a part, legal hold). The reason shows on the asset.
  Check-out from the asset page warns on a device that is on hold.

## Forms

Built in **Settings › Service desk › Forms**. A form has a name, a
description, and an ordered list of **sections**, each with a title and
ordered **items**.

### Item kinds

| Kind | What it is |
|---|---|
| Text | Explanation or a warning between steps. Rich text, sanitized. |
| Step | A checkbox. Optional note when ticked. |
| Field | Something to record: short text, long text, number, date, yes/no, choice (single), choices (multiple), staff member, contact. |
| Secure field | A value kept secret: encrypted, hidden until revealed, every reveal logged. |
| Confirmed by the agent | A step that ticks itself when the device's PRISM agent reports in after the form was created. Only on forms used per device. |
| Device action | **Check out this device** or **Check in this device** (see "Device actions"). Only on forms used per device. |

Every step, field and device action can be **required**. A form is finished
when every required item that currently shows is done (step ticked, field
filled, action carried out).

### Showing steps only when they apply

Any section or item can have **show when** conditions, all of which must
hold:

- about the **device** the form is for: type (asset category), managed,
  MDM, has cellular, carrier, has the PRISM agent, company;
- about the **person** the playbook was applied for: company, department;
- about an **earlier answer** in the same form ("MDM choice is X", "User is
  leaving: yes").

Items that don't show are not required and not counted. If an answer changes
so that items with values stop showing, the values are kept but ignored, and
the form says so.

The owner's two documents test this directly: "If ManageEngine / If Jamf Pro"
becomes *device MDM is …*; "Mac only" / "iPhone/iPad" becomes *device type is
…*; "User is staying / leaving" becomes an earlier yes/no answer.

### Versions

Editing a form creates a new version. Ticket forms keep the version they were
created from; a form already on a ticket never changes underneath the person
working it. New applications use the latest version.

### Starter templates

Four vendor-neutral forms and two playbooks are seeded, editable and
deletable: **Device check-out**, **Device check-in**, **New account** and
**Account termination** forms; **New account** and **Account termination**
playbooks. Their steps are general ("Record the serial number", "Confirm the
device is wiped") with no product names.

## Playbooks

Built in **Settings › Service desk › Playbooks**. A playbook has a name, a
description, which companies it is offered for (default all), whether it
**needs a person**, and an ordered list of **blocks**. Each block is a form
plus how it applies:

| Applies | Meaning |
|---|---|
| Once | One copy on the ticket. |
| Per device: the person's devices | One copy per device assigned to the chosen person when applied. Needs a person. |
| Per device: devices on the ticket | One copy per device linked to the ticket, now and when more are added later. |

A per-device block can be limited by device type, managed, MDM and has
cellular. **A device gets the first per-device block it matches**, in the
playbook's order, so "Apple check-in for Apple devices, then Device check-in
for everything else" gives each device one form. A device that matches none
of a playbook's per-device blocks is listed on the ticket as **not covered**
so it isn't silently missed (e.g. a device with no MDM set yet).

Example (the owner's setup, built by them, not shipped):
*Account termination*: "Account termination" form once; "Apple check-in"
per device of the person's devices limited to Apple device types; "Device
check-in" per device of the person's other devices.

## On the ticket

### Apply playbook

- An **Apply playbook** button on every ticket, for anyone who can edit the
  ticket. It lists the playbooks offered for the ticket's company.
- If the playbook needs a person, the dialog asks **who it is for**, with a
  guess: contacts in the ticket's company whose full name, or email name,
  appears in the ticket's subject or description. The guess is a suggestion
  only.
- For "the person's devices" blocks, the dialog lists the person's assigned
  devices with a checkbox each (all ticked), and which form each will get.
- Applying adds the ticket forms as ticket tasks and logs it on the ticket
  ("Account termination applied for J. Smith by S. Stevens").
- A playbook can be applied more than once on a ticket (two new hires in one
  HR request); each application is listed separately with its person.
- An applied playbook can be removed while none of its forms has been
  started.

### Suggested by rules

- A new workflow rule action, **Suggest playbook**, shows a banner on the
  ticket: "Suggested: Account termination [Apply] [Dismiss]". Existing
  conditions (category, type, title contains, department…) decide when.
- Apply opens the same dialog. Dismiss hides it for that ticket. A
  suggestion is never applied without a click.

### Devices on the ticket

The existing linked-assets area becomes a **Devices** panel:

- **Add device**: pick an existing device of the ticket's company (devices
  `ready_to_issue` first), or **create one** in a short form (type, name,
  make, model, serial, asset tag, managed, MDM, cellular and, when on, IMEI,
  phone number and carrier). Creating needs `assets.create`; the new asset
  belongs to the ticket's company. A blank serial number gets a warning,
  because the agent claims devices by it (see "The PRISM agent").
- Adding a device to a ticket with an applied playbook that has a "devices on
  the ticket" block adds the matching form for it.
- Removing a device removes its forms that haven't been started. A started
  form stays and has to be finished or skipped.

### Ticket forms as tasks

- Each ticket form is one ticket task, titled from the form and device
  ("Device check-in: MacBook Pro, TAG-0012"), showing progress (required items
  done / required items showing).
- Opening the task opens the form: sections, steps to tick, fields to fill,
  items that don't apply hidden.
- The task closes itself when the form is finished and can't be closed by
  hand before then. It can be assigned like any task.
- **Skip with reason**: a ticket form can be skipped by someone who can edit
  the ticket, with a required reason; it then counts as finished. Per-device
  check-in forms have a shortcut, **Not returned**, which skips with that
  reason and offers to set the device to `lost`.
- **Printable copy**: a finished form can be downloaded as a PDF for the
  record (answers and who ticked what, when). Secure values are never
  included; the PDF says "recorded, not shown".

### Device actions

- **Check out this device** carries out PRISM's normal check-out (the same
  service the asset page uses, with its history and activity, and the
  agreement form generated, printed or emailed, and its signed copy uploaded
  later, as on the asset page) to the applied playbook's person, or asks for one if there
  is none. It fails with a clear message if the device is already checked
  out to someone else.
- **Check in this device** carries out the normal check-in and sets the
  status chosen in the step: `ready_to_issue`, `in_repair`, `on_hold` (with
  reason) or `retired`, and revokes the device's PRISM agent when ticked
  (see "The PRISM agent").
- The action becomes available once every other required item showing on the
  form is done, so it is always the last thing that happens.
- Ticking the step is what carries the action out. It is done once; un-ticking
  doesn't reverse it (the asset page does that).

### Closing

- A ticket can't move to a closed or archived status while any of its ticket
  forms is unfinished (not finished and not skipped). This holds however the
  status changes: the ticket page, bulk actions, workflow rules, email, the
  API. The refusal lists what is left.
- **Close anyway**: someone with `tickets.override_checklist` can close it
  with a required reason; the override and reason go on the ticket's
  activity.
- A device that no form covers (e.g. no MDM set) **warns but doesn't block**:
  the close dialog lists it, and the ticket can close without an override.
  If nothing else is unfinished, the warning is shown and closing goes ahead
  on confirmation.
- A workflow rule that tries to close such a ticket is refused and the rule
  log records why.
- Merging: the source ticket's ticket forms move to the target ticket.

## The PRISM agent (sub-project 8, on dev)

The agent exists (sub-project 8: Windows, macOS and Linux, with the tray
app). What it already does that this sub-project relies on:

- **Enrollment claims an existing Asset.** An agent enrolls with its
  company's enrollment key and claims an Asset of that company with the same
  serial number that has no live agent (none, revoked, or never reported);
  only if there is none does it create a new Asset in Computers.
- **The agent owns the hardware fields** and overwrites them at every
  inventory: name (the hostname), make, model, serial, processor, RAM,
  storage, OS and version, firmware, IP and MAC. Everything else stays
  staff-owned.
- **The usual user**: the signed-in account is matched to a contact of the
  Asset's company and set as the assigned contact, but only while nobody has
  set it by hand.

What this sub-project does with it:

- **Devices created in a ticket are claimed, not duplicated.** A computer
  created in a ticket with its serial number is the Asset the agent claims
  when it is installed with that company's key. A blank serial on a created
  device gets a warning for this reason. The name typed in is replaced by the
  hostname at the first inventory; that is expected.
- **A check-out sets the holder by hand**, so the agent's usual-user
  matching never overrides a device checked out through a form.
- **New condition, "has the PRISM agent"** (a live, not revoked agent), for
  show-when rules and per-device playbook limits.
- **New item kind, "confirmed by the agent"**: a step that ticks itself when
  the device's agent sends an inventory after the ticket form was created
  (e.g. "PRISM agent installed and reporting"). It can still be ticked by
  hand. The vendor-neutral **Device check-out** starter form includes it.
  The form's Device card shows the agent's last seen time and **Scan now**.
- **Checking a computer in revokes its agent.** A wiped computer's old agent
  stays live in PRISM with its last inventory, so when the agent is
  installed again for the next person, enrollment would not claim the Asset
  and would create a duplicate. The **Check in this device** action therefore
  offers **Revoke its PRISM agent** (ticked by default when the device has a
  live agent). Revoking needs the agent's **Manage devices** permission;
  without it the action says who to ask and the form shows a required step
  "Agent revoked" instead. The **Device check-in** starter form includes it.
- **The person's devices** (termination) are the devices assigned to them,
  whether by a check-out or by the agent's usual-user matching. The Apply
  dialog marks the second kind ("assigned by the agent, no check-out").
  Checking in such a device clears the assignment and sets the status; there
  is no check-out record to close.
- **Phones and tablets don't run the agent** (iOS and iPadOS don't allow
  it). Their details are entered by hand, or later read from the MDM by a
  connector (see "Later").

## Export and import

- Settings › Forms and Playbooks can export one or more forms and playbooks
  to a file, and import one.
- On import, MDMs and device types are matched by name; anything not found is
  listed for the importer to map or drop before saving. Imported items arrive
  inactive until reviewed.

## Who can do what

| Action | Needs |
|---|---|
| Manage forms, playbooks and MDMs | new `settings.manage_playbooks` |
| Apply or remove a playbook, fill in and skip forms | edit permission on the ticket |
| Create a device from a ticket | `assets.create` |
| Device actions (check out / in) | `assets.edit` |
| Revoke the agent during check-in | `devices.manage` (from sub-project 8) |
| Reveal a secure value | new `tickets.view_secure_fields`, and able to view the ticket |
| Close with unfinished forms | new `tickets.override_checklist` |

Seeded: System Administrator gets all three new permissions; System
Technician gets `tickets.view_secure_fields`; others none.

## Security (standing rule: security first)

- Secure values are encrypted at rest with the existing credential
  encryption (`utils/tokenCrypto.js`) in their own table, and are never
  returned by list or detail endpoints, only by a reveal endpoint.
- Every reveal is recorded (who, when, which ticket form and field) on the
  ticket's activity and in the audit log. The reveal endpoint is
  rate-limited.
- Secure values never appear in activity text, notifications, emails, PDFs,
  exports, search results or CSV.
- Form text is sanitized with the existing rich-text rules. Form and playbook
  definitions have size limits (sections, items, text length) checked on
  save and on import.
- Imported files are validated against the same rules as a form saved in
  Settings; nothing in an import runs code or fetches anything.

## Constraints

- Builds on existing pieces: ticket tasks (the work model), workflow rules,
  asset check-out and check-in (including dev's checkout forms: print, email,
  signed copy), asset-ticket links, the PRISM agent's devices (sub-project
  8), the audit log and credential encryption. No new external services, no new npm dependency
  expected.
- Every new screen in look A. Mockups approved per screen before the plan.
- Works on a phone width: ticking steps and filling fields on a ticket form
  must be usable on a phone (people do this at a desk with the device).
- Migration adds the MDM list, the asset fields and statuses, the form,
  playbook, applied-playbook, ticket-form and secure-value tables, and the new
  permissions. Existing data is untouched apart from assets gaining
  `managed = no`.

## Decided in conversation (2026-11-06)

- No person field on the ticket. The person is chosen when a playbook is
  applied, guessed from the subject, and stored with that application.
- Rules suggest a playbook; a person applies it with a button.
- PRISM lists and tracks steps; it doesn't act in other systems.
- MDMs are a per-install list; devices record managed yes/no and which MDM.
- Nothing organization-specific ships; the owner's Apple forms are built in
  their own install as the acceptance test.
- Required steps must be done before the ticket closes.
- Devices can be created from inside the ticket and become assets.
- Devices record cellular (yes/no) with IMEI, phone number and carrier; any
  device type can have it (laptops too). Carriers are vendor companies.
- The agent exists on dev (sub-project 8). A device created in a ticket is
  the Asset the agent claims by serial number; checking a computer in revokes
  its agent; steps can be confirmed by the agent.
- A device gets the first per-device form it matches; a form's device action
  waits until its other required steps are done (settled with the mockups).
- A device no form covers warns when closing; it doesn't block (2026-11-06).

## Acceptance test: the owner's two forms

Built in the owner's install with the form builder, without code changes:

- **Apple Device Check-Out: Enroll and Assign**: "Before you start" and
  Steps 1–6; MDM-specific steps by device MDM; Mac-only and iPhone/iPad-only
  steps by device type; the temporary password as a secure field; serial,
  asset tag, device type, MDM, Managed Apple Account and date issued as
  fields; the last step as **Check out this device**.
- **Apple Device Check-In: Deprovision for Reuse**: Steps 1–8; MDM-specific
  wipe and clean-up steps; bypass code and Mac passcode as secure fields;
  "User is leaving" as a yes/no that shows the account clean-up steps; who
  approved the wipe as a field; the last step as **Check in this device** with
  `ready_to_issue`, `in_repair` or `on_hold` ("Activation Locked").

## Later (follow-ups, not in this sub-project)

- **Sync-confirmed steps**: a step can be marked "confirmed by directory
  sync" (account disabled, license assigned or removed, mailbox exists) and
  is ticked when AD or Microsoft 365 sync sees it.
- **Termination on disable**: when sync makes a contact inactive, open a
  ticket with the termination playbook suggested (if the install turns it
  on).
- **User profile**: one view of a person: details, devices and checkout
  history, licenses, tickets, AD and Microsoft 365 details, home and mapped
  drives (from group-to-drive mappings, or reported by the agent once its inventory includes the signed-in user's mapped drives).
- Forms on project tasks.
- **MDM connectors**: read device details (serial, IMEI, phone number,
  managed state) from an install's MDM, for phones and tablets the agent
  can't run on.

## Left to the builder

- Exact tables and how a form definition is stored (one document per version
  is expected), and how ticket forms link to tasks.
- Where the close check lives so every status-change path goes through it
  (one shared place, not one check per path).
- How the person guess matches names (word boundaries, accents, short names)
  and how many guesses to show.
- How the per-device "devices on the ticket" block behaves when a device is
  re-added after being removed.
