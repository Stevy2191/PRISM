# PRISM PB2 — Playbooks, simpler: checklists and bundles: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make playbooks simple enough for anyone. You build one thing, a **checklist** (two plain questions, then paste a document or type lines; *Only for* chips; indent under a yes/no question). A checklist is added to a ticket on its own, and **bundles** (written as a sentence) are optional. Everything already built keeps working.

**Architecture:**
- **Mostly screens and words.** Database tables and API routes keep their names (`forms`, `playbooks`). Settings › Forms and Settings › Playbooks become one page, **Settings › Checklists**; the ticket's Apply playbook becomes **Add checklist**.
- **The editor stores what the server already understands.** *Only for* is device conditions (`mdm in`, `categoryId in`). Indenting under a question is an answer condition. *When it's finished* is the action item. Anything else is shown as **Advanced rules** and edited with the existing condition editor.
- **Paste to build** is a pure function in the browser (`parseChecklist(text, { mdms, categories })`), unit-tested with `node:test`; the server checks the result on save as it does any checklist.
- **Server additions:**
  - the `mdm` device field;
  - adding one checklist to a ticket;
  - a Try-it evaluation;
  - category suggestions stored on the bundle;
  - migration 082.

**Spec:** `docs/superpowers/specs/2026-11-06-checklists-simpler-design.md`
**Mockups:** `docs/mockups/checklists-simpler/` (approved 2026-11-06). Boards: `Main` (Settings › Checklists), `NewChecklist`, `Paste`, `Editor`, `OnlyFor`, `Bundle`, `AddChecklist`, `WhichDevices`. Live screen wins over mockup on field and status names.

## Global Constraints

- **Nothing that works today breaks.**
  - Existing forms and playbooks, tickets in progress, the ticket form page, the close guard, secure values, agent revoke and export/import all keep working.
  - Every existing playbooks test keeps passing; tests change only where a screen's words change.
- **No new kinds of data in definitions** except the `mdm` device field. Older stored definitions stay valid.
- **The words in the spec's table are used everywhere a person reads:** screens, dialogs, activity text, permission labels, release notes. Code and API names don't change.
- **Everything from earlier sub-projects still applies:** look A, phone widths, fences, audit, Node 24, one migration (082) with a round-trip test, and both suites before each push.

## Review Focus

- **Round trip of the editor:** a definition opened and saved without changes is unchanged, whatever conditions it has, Advanced ones included → Task 5.
- **Paste on the owner's documents:** the result matches the acceptance fixtures' sections and Only for chips, within the listed differences → Task 4.
- **Adding a checklist on its own** keeps the same fences as applying a playbook: person and devices in the ticket's company → Task 2.

---

### Task 1: Migration 082 and the `mdm` device field

**Files:**
- Create: `backend/migrations/20260101000082-checklists-simpler.js`
- Modify:
  - `models/TicketForm.js` (`contactId`) and `models/Playbook.js` (`suggestCategoryIds`), plus their associations;
  - `services/playbooks/formDefinition.js` (`mdm` in `DEVICE_FIELDS`);
  - `services/playbooks/resolve.js` (`deviceContext.mdm`);
  - `services/playbooks/transfer.js` (map `mdm` values by name, keep `'none'`);
  - `test/integration/laterMigrations.js` (082 after 080).
- Test: `test/integration/checklists.model.test.js`, `test/unit/formDefinition.test.js` (added cases)

- [ ] **Step 1: Failing tests:**
  - `mdm` is the MDM id when managed and `'none'` otherwise;
  - `{ field: 'mdm', op: 'in', value: [A, 'none'] }` shows for a device on MDM A and for an unmanaged one, and hides for MDM B;
  - export/import keeps `'none'` and maps ids by name;
  - the new columns save;
  - the permission labels read "Manage checklists, bundles and MDMs", "Reveal hidden passwords and codes on checklists" and "Close tickets with unfinished checklists";
  - 082's down → up round trip.
- [ ] **Step 2–4:** Run → FAIL; implement; run → PASS.
- [ ] **Step 5: Commit** `feat(checklists): the mdm device field, checklists added on their own, bundle category suggestions (migration 082)`

### Task 2: Add one checklist to a ticket

**Files:**
- Modify:
  - `services/playbooks/apply.js` (`addChecklist`, sharing `createForms`, `linkDevice` and fences with `applyPlaybook`);
  - `controllers/tickets/playbooks.js` (the options endpoint lists checklists, and with `formId` lists the person's devices with whether each fits);
  - `routes/tickets.js` (`POST /:id/checklists`);
  - `services/playbooks/ticketForms.js` (the person for a form without a playbook comes from `TicketForm.contactId`);
  - `ticketPlaybooksView` (forms added on their own, with their person).
- Test: `test/integration/checklists.add.test.js`

**Interfaces:**
- `POST /tickets/:id/checklists { formId, contactId?, assetIds? }` → the ticket's view, plus `added: [ticketForm]`.
  - A ticket checklist adds one form.
  - A device checklist adds one form per chosen device (the person's ticked devices, plus any `assetIds` of the ticket's company), linking each device to the ticket.
  - Refused: a switched-off checklist, a person or device of another company, a device checklist with no devices.
- Activity: `checklist_added` ("Device check-in for MacBook Pro, iPhone 15", "for Jordan Reyes").

- [ ] **Step 1: Failing tests:**
  - a ticket checklist is added at once;
  - a device checklist for a person adds one form per ticked device and links them;
  - the person on the form drives its check-out and person conditions;
  - the fences above;
  - the options list groups checklists by what they're for;
  - the existing `playbooks.apply` and `playbooks.actions` tests still pass.
- [ ] **Step 2–4:** Run → FAIL; implement; run → PASS.
- [ ] **Step 5: Commit** `feat(checklists): add one checklist to a ticket`

### Task 3: Category suggestions on bundles, and Try it

**Files:**
- Modify:
  - `services/playbooks/admin.js` (`cleanPlaybook` takes `suggestCategoryIds`, checked against the ticket categories);
  - a new `services/playbooks/suggest.js` (`suggestForTicket(ticket)`), called after a ticket is created and when its category changes (`services/tickets/ticketWrite.js`);
  - `controllers/formsController.js` and `routes/forms.js` (`POST /forms/try`).
- Test: `test/integration/checklists.suggest.test.js`, `checklists.try.test.js`

- [ ] **Step 1: Failing tests:**
  - a new ticket in a bundle's category gets its suggestion, once;
  - moving a ticket into the category suggests it;
  - a dismissed suggestion stays dismissed;
  - bundles not offered for the company aren't suggested;
  - an unknown category is refused on save;
  - Try it returns which items show for a Mac on MDM A and for an unmanaged iPhone, saves nothing, and needs the playbooks permission.
- [ ] **Step 2–4:** Run → FAIL; implement; run → PASS.
- [ ] **Step 5: Commit** `feat(checklists): bundles suggest themselves by category; Try it`

### Task 4: Paste to build

**Files:**
- Create: `frontend/src/pages/settings/checklists/parseChecklist.js` and its `parseChecklist.test.js`, plus `backend/test/fixtures/playbooks/apple-check-in.txt` and `apple-check-out.txt` (the documents' text, as copied from the PDFs)
- Test: `parseChecklist.test.js` (node:test)

**Interfaces:**
- `parseChecklist(text, { name, usage, mdms: [{id,name}], categories: [{id,name}] })` → `{ definition, summary: { sections, steps, fields, secrets, onlyFor } }`, following the spec's rules in order.
- Keys are generated with `newKey`.
- Text becomes escaped `<p>` with `<b>` for `**bold**`.

- [ ] **Step 1: Failing tests:**
  - each rule on its own: bullets, headings, write-downs, hidden codes, Only for prefixes (several names, "If X (Y):", "Not managed"), `?` questions, "(optional)" / "Ideally,", bold, and escaping `<script>`;
  - **the two Apple texts produce the fixtures' section titles and Only for chips**, with the named differences listed in the test.
- [ ] **Step 2–4:** Run → FAIL; implement; run → PASS.
- [ ] **Step 5: Commit** `feat(checklists): paste a document to build a checklist`

### Task 5: The checklist editor

**Files:**
- Create in `frontend/src/pages/settings/checklists/`:
  - `ChecklistEditor.jsx`, `ChecklistLine.jsx`, `LineToolbar.jsx`, `OnlyForPicker.jsx`, `NewChecklistDialog.jsx`, `PasteBuild.jsx`, `TryIt.jsx`;
  - `editorModel.js`, with its `editorModel.test.js` holding the pure parts: conditions ↔ chips and nesting, the finished-step choice ↔ the action item, indent/outdent.
- Keep: `pages/settings/playbooks/FormBuilder.jsx`'s condition editor, used for Advanced rules.
- Test: `editorModel.test.js` (node:test)

**Notes:**
- Built per the `NewChecklist`, `Paste`, `Editor` and `OnlyFor` mockups.
- Lines are buttons and inputs, never divs with click handlers.
- Keys: Enter adds a line, Tab indents under the question above, Shift+Tab outdents, and Alt+↑/↓ moves a line. Up/down buttons stay in the toolbar.

- [ ] **Step 1: Failing tests:**
  - **round trip:** every starter form, both Apple fixtures, and a form with advanced conditions survive `toEditor` → `fromEditor` unchanged;
  - chips: MDMs and types ↔ `mdm in` / `categoryId in`, including Not managed;
  - indent under a yes/no question ↔ `answer is true` ("If no:" ↔ false);
  - a line with other conditions is marked advanced and left alone;
  - choosing check-out, check-in or nothing adds, swaps or removes the last action item.
- [ ] **Step 2–4:** Run → FAIL; implement; run → PASS.
- [ ] **Step 5: Commit** `feat(checklists): the checklist editor`

### Task 6: Settings › Checklists and bundles

**Files:**
- Create `frontend/src/pages/settings/checklists/`: `Checklists.jsx` (checklists and bundles, export/import kept) and `BundleEditor.jsx` (the sentence, Try it on someone)
- Modify:
  - `pages/settings/registry.js`: **Checklists** under Service desk, `/settings/checklists` with `new`, `:id`, `bundles/new`, `bundles/:id`; MDMs stays under Assets;
  - redirects from `/settings/forms…` and `/settings/playbooks…`;
  - `App.jsx`;
  - the rule editor's action label, now "Suggest a bundle".
- Test: `frontend/src/pages/settings/registry.test.js` (redirects), `backend/test/smoke/checklists.settings.smoke.js`

- [ ] **Step 1: Failing smoke tests:**
  - New checklist → device → check in → paste the Apple check-in text → the preview counts → Create → the editor shows Only for chips;
  - a line turned into a yes/no question, with a line indented under it;
  - Only for picker: Jamf Pro + Mac, with the sentence;
  - Try it shows the hidden count;
  - a bundle written as a sentence, with a category suggestion;
  - old Settings addresses redirect.
- [ ] **Step 2–4:** Run → FAIL; implement; run → PASS.
- [ ] **Step 5: Commit** `feat(checklists): one Checklists page, the bundle sentence`

### Task 7: Add checklist on the ticket

**Files:**
- Create `frontend/src/pages/tickets/playbooks/AddChecklistDialog.jsx`, replacing `ApplyPlaybookDialog.jsx`. It has two steps: pick, then who and which devices.
- Modify:
  - `PlaybookPanel.jsx`: "Checklists" wording; checklists added on their own are grouped under **Checklists**; the suggestion banner reads "Suggested: X [Add] [Dismiss]";
  - `TicketDetail.jsx`: header action **Add checklist**;
  - `CloseBlockedDialog.jsx` and `TicketFormPage.jsx`: words only.
- Test: `backend/test/smoke/checklists.ticket.smoke.js`; update `playbooks.ticket.smoke.js` for the new words.

- [ ] **Step 1: Failing smoke tests:**
  - a ticket checklist is added in one click;
  - a device checklist asks who and which devices (the guess, the ticks, the flagged device, "+ Another device") and adds them;
  - a suggested bundle from its category is added from the banner;
  - the button's count matches what is added;
  - everything fits a phone screen.
- [ ] **Step 2–4:** Run → FAIL; implement; run → PASS.
- [ ] **Step 5: Commit** `feat(checklists): Add checklist on the ticket`

### Task 8: Words everywhere, and finish

- [ ] **Step 1:** Sweep what people read for the spec's words:
  - activity text for `playbook_applied` and `form_*`, shown as "Checklist…" and "Bundle…" (stored action names unchanged);
  - the close dialog;
  - the Asset and Settings pages;
  - the role editor's labels, from migration 082.
- [ ] **Step 2:** `UPGRADING.md` `## Unreleased`: Checklists and bundles, the moved Settings page (old addresses redirect), the renamed permission labels, paste to build, and adding a checklist on its own. `docs/ROADMAP.md`: PB2 row → Shipped (to dev).
- [ ] **Step 3:**
  - full backend suite and the whole smoke suite (not at once);
  - `npm test` in `frontend`;
  - render the mockups beside the built screens with `preview.js` and note any difference.
- [ ] **Step 4: Commit** `docs(checklists): release notes and roadmap` and push.
