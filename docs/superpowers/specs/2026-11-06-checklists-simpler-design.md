# Playbooks, simpler: checklists and bundles

> Status: design approved 2026-11-06 (mockups approved the same day).
> Builds on the shipped Playbooks sub-project:
> `docs/superpowers/specs/2026-11-06-playbooks-design.md`.
> Mockups: `docs/mockups/checklists-simpler/` (`node preview.js Editor Paste:dark`).
> Roadmap row: "PB2" in `docs/ROADMAP.md`.

## Intent

Playbooks shipped and work, but the owner found them hard to set up and
apply:

- Two things to build (a form, then a playbook around it) before anything can
  be used.
- Our words, not the user's: "playbook", "blocks", "limits", "per device: the
  person's devices".
- "Show when" is a small programming language (on / field / operator / value).
- The builder edits one item at a time in a side panel, while real
  checklists are just lists of lines.

This change makes them simple enough for anyone. **Nothing that works today
is taken away.** It's mostly the screens and the words, plus a few server
additions.

## Goals

1. **One thing to build: a checklist.** Creating one asks two plain
   questions: *What is it for?* (the ticket, or a device) and *When it's
   finished* (nothing else, check the device out, or check the device in).
   PRISM adds the check-out or check-in as the last step.
2. **Paste to build.** Paste a document and every line becomes a step. The
   preview shows what was made before anything is saved.
3. **A list you type into.** The editor is the checklist itself: type a line
   for a step, Enter for the next. Each line has a small toolbar: *Required*,
   *Only for…*, *Turn into* (yes/no question, pick one, write down, hidden
   password/code, note, agent-confirmed step), delete.
4. **"Only for" replaces "Show when"** for what almost every branch needs:
   tick MDMs and/or device types; a plain sentence confirms it ("Shows for
   Macs on Jamf Pro"). Steps indented under a yes/no question show only for
   that answer. The full condition builder stays, behind "Advanced".
5. **Use a checklist on its own.** On a ticket, **Add checklist** adds any
   checklist directly. A device checklist asks which devices.
6. **Bundles are optional**, for adding several checklists in one click, and
   are written as a sentence: "It's for *a person* and adds: *Account
   termination* for the ticket · *Apple device check-in* for each of their
   *Mac, iPhone, iPad* devices · *Device check-in* for each of their *other*
   devices. Suggest it on new tickets in *Accounts › Termination*."
7. **"Try it"** in the editor shows the checklist as one device would see it
   (e.g. a Mac on Jamf Pro): how many steps show and how many are hidden.

## Non-goals

- Changing how ticket forms are filled in, secured, finished, skipped, or how
  they block closing. The ticket form page keeps working as built; only its
  words change.
- Removing the condition builder. Forms with conditions that don't fit "Only
  for" or yes/no nesting keep them and show an **Advanced rules** badge.
- Renaming database tables or API routes. The words change in the screens
  only; `forms` and `playbooks` stay as they are in code and the API.
- Reading Word or PDF files. Paste takes text; people copy from their
  document.

## Words

| Was | Now (screens) |
|---|---|
| Form | **Checklist** |
| Playbook | **Bundle** |
| Apply playbook | **Add checklist** |
| Show when | **Only for** (devices) and indenting under a question |
| Per device: the person's devices | **for each of their devices** |
| Per device: devices on the ticket | **for each device added to the ticket** |
| Secure field | **Password / code (hidden)** |
| Field | **Write down** (a value) or **Pick one** |
| Agent-confirmed step | **Ticks itself when the PRISM agent reports in** |
| Device action | the **When it's finished** choice, shown as the fixed last step |
| Settings › Forms, Settings › Playbooks | **Settings › Checklists** (one page; bundles below) |

The three permissions keep their keys; their labels become "Manage checklists,
bundles and MDMs", "Reveal hidden passwords and codes on checklists" and
"Close tickets with unfinished checklists".

## Building a checklist

### New checklist

A dialog with a name, the two questions (as two and three choice cards), and
"Start with: Paste from a document | A blank checklist". *When it's finished*
is only offered for device checklists; for a ticket checklist it's "nothing
else".

- *Check the device out* adds `{ kind: 'action', action: 'check_out' }` as
  the last item. *Check the device in* adds a `check_in` action, with Ready to
  issue, In repair and On hold offered; which statuses are offered stays
  editable from the fixed step's **Statuses** link.
- Changing *When it's finished* later swaps or removes that last item.

### Paste to build

Paste is text only. Rules, in order, line by line:

- **Blank lines** are ignored except to end a run.
- **Bullets and boxes** are stripped from the start: `-`, `*`, `•`, `☐`,
  `[ ]`, `- [ ]`, `1.` / `1)`.
- **A section** is a line that starts with `#`, or `Step <n>`, or is short
  (60 characters or fewer), doesn't end with `.` or `:`, and is followed by at
  least one non-heading line. The first lines before any heading go in a
  section named after the checklist.
- **A write-down** is a line ending with `:` and nothing after it, 60
  characters or fewer ("Serial number:"). Its label is the line without the
  colon. A label containing *password*, *passcode*, *PIN*, *code* or *secret*
  becomes a **hidden password/code** instead.
- **"Only for" prefixes:** a line starting with a name of one of the install's
  MDMs or device types followed by `:` ("Jamf Pro: …", "Mac: …"), or with "If
  <name>:", "<name> only:" or "If <name> (<name>):", gets **Only for** those
  and keeps the rest of the line as the step. Names match ignoring case; "Not
  managed" and "unmanaged" mean not managed. Several names joined with `/`,
  `,` or "or" all count ("iPhone/iPad:").
- **A line ending with `?`** becomes a yes/no question.
- **"(optional)"** anywhere in a line, or a line starting "Ideally,", makes
  the step optional. Everything else is required.
- **`**bold**`** becomes bold. Everything else is plain text, escaped.

The preview shows sections, steps with their chips, and a summary ("9
sections, 31 steps, 5 things to write down, 1 password/code"). Nothing is
saved until **Create checklist**. The parser is a pure function in the
browser, tested on its own. The server still checks the result on save.

### The editor

- Sections are headings typed in place. Lines are steps by default.
- **Turn into** changes a line's kind. Kinds and their stored form:

  | Line | Stored as |
  |---|---|
  | Step | `step` |
  | Yes/no question | `field`, `fieldType: 'yesno'` |
  | Pick one | `field`, `fieldType: 'choice'`, options typed as one per line |
  | Write down (text, number, date, staff member, contact) | `field` of that type |
  | Password / code (hidden) | `secure` |
  | Note | `text` |
  | Ticks itself when the PRISM agent reports in | `agent` (device checklists only) |

- **Indenting** (Tab, or the toolbar's indent button) a line under a yes/no
  question stores `showWhen: [{ on: 'answer', field: <question>, op: 'is',
  value: true }]`. A second group, "If no:", stores `value: false`. The
  editor shows consecutive lines with exactly that one condition as indented
  under their question. Shift+Tab removes it.
- **Only for** on a line or a section stores device conditions:
  - MDMs ticked → `{ on: 'device', field: 'mdm', op: 'in', value: [mdmIds…, 'none'?] }`
    (`'none'` = Not managed).
  - Device types ticked → `{ on: 'device', field: 'categoryId', op: 'in', value: [ids…] }`.
  - Both groups must match; an empty group matches anything.
- A line or section whose conditions are anything else shows an **Advanced
  rules** badge. Clicking it opens the existing condition editor. Only for
  and indenting stay off for that line until its advanced rules are removed.
- **Try it:** choose a device type and an MDM (or Not managed). The editor
  asks the server and shows which lines would show, greying the rest, with
  "27 steps would show; 11 are hidden by Only for."
- The same save as today: every save is a new version, and tickets keep the
  version they started on.

### The new `mdm` device field

Form conditions gain one device field, `mdm`: the device's MDM id when it's
managed, else `'none'`. "Only for" uses it so that "Jamf Pro or not managed"
is one condition. The existing `mdmId` and `isManaged` fields keep working.
The import/export by name maps `mdm` values as it does `mdmId`, with `'none'`
kept as it is.

## Bundles

Written as a sentence on one page:

- "It's for **a person ▾**" (needsPerson) or "It's for **the ticket**".
- One line per checklist, in order: "*Checklist ▾* for the ticket" (once),
  "for each of their *types ▾* devices" (person's devices, limited to those
  device types, or "other" for everything not matched by a line above), or
  "for each device added to the ticket" (ticket devices). A device gets the
  first line it fits, as today.
- "Suggest it on new tickets in **category ▾**" (optional, any number of
  categories). New tickets in those categories, and tickets moved into one,
  get the suggestion. This is stored on the bundle
  (`Playbooks.suggestCategoryIds`); the *Suggest a playbook* workflow action
  stays for anything more involved.
- "Try it on someone" as today.

## On a ticket

- **Add checklist** (the header action, and the button in the Tasks tab)
  opens one dialog:
  - **Suggested for this ticket:** bundles a rule or category suggested.
  - **Bundles**, then **For the ticket**, then **For devices**, with search.
- Picking a **ticket checklist** with no person needed adds it at once.
- Picking a **device checklist** or a **bundle** goes to a second step, "Who
  is it for?": the person guessed from the subject (changeable, and optional
  for a device checklist), then their devices, ticked, each saying which
  checklist it gets and which branch ("the Jamf Pro steps"). A device nothing
  fits is flagged, with a link to set its MDM. "+ Another device" picks any
  device of the company. The button says what happens: "Add 4 checklists".
- **A checklist added on its own** remembers the person it was added for
  (`TicketForms.contactId`), so its check-out goes to them and its person
  conditions work, as a bundle's do.
- The Tasks tab groups added checklists under the bundle they came from, or
  under **Checklists** when added on their own.
- The suggestion banner reads "Suggested: **Termination** [Add] [Dismiss]".

## Server changes

- Migration 082:
  - `TicketForms.contactId` (null → Contacts, SET NULL).
  - `Playbooks.suggestCategoryIds` (JSON, null).
  - The three permissions' labels and descriptions.
- `formDefinition`: the `mdm` device field (`'none'` when not managed), in
  `DEVICE_FIELDS` and `deviceContext`.
- `POST /tickets/:id/checklists { formId, contactId?, assetIds? }`: adds one
  checklist. Ticket checklist → one ticket form. Device checklist → one per
  chosen device, which must belong to the ticket's company, linking each to
  the ticket. The same fences, task creation and activity as applying a
  playbook.
- `GET /tickets/:id/playbooks/options` also lists active checklists, grouped
  by what they're for. With `formId` (instead of `playbookId`), it lists the
  person's devices that a device checklist would be added for.
- `POST /forms/try { usage, definition, device: { categoryId, mdm } }` →
  the definition's evaluation for that device (the editor's Try it; nothing
  saved). Same permission as building checklists.
- Category suggestions: when a ticket is created, or its category changes to
  one a bundle lists, a `TicketPlaybookSuggestion` is created (once; a
  dismissed one stays dismissed), only for bundles offered for the ticket's
  company.

## Moving to it

- Existing forms and playbooks keep working and show up as checklists and
  bundles. Nothing is converted. Conditions that fit Only for or indenting
  display that way; the rest show Advanced rules.
- Old Settings addresses (`/settings/forms…`, `/settings/playbooks…`)
  redirect to `/settings/checklists…`.
- Tickets in progress are not affected.

## Acceptance

- Pasting the text of the owner's two documents produces checklists with the
  same sections and Only for chips as the acceptance fixtures (within a list
  of named differences a person then fixes in the editor, e.g. which steps
  are optional).
- A technician who has never seen the feature can build "Printer setup" (a
  ticket checklist of 5 steps) and add it to a ticket, without a manual.

## Left to the builder

- How the editor keeps the caret and focus while lines are added, indented and
  turned into other kinds, and its keyboard shortcuts beyond Enter, Tab and
  Shift+Tab.
- Exactly how the paste parser decides a heading in edge cases, as long as
  the preview shows its result before anything is saved.
