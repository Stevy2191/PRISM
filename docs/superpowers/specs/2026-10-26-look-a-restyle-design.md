# Sub-project 6b — Restyle the rest of PRISM in look A

> Status: design approved 2026-10-26 (every area's mockup approved by the user).
> Mockups: https://claude.ai/artifact/8New39PfVsHf1Hsjdnk6oM (one canvas page per area).
> A copy of every mockup lives in `docs/mockups/look-a-6b/` (see "Mockup files" below).
> Foundation: sub-project 6 (`2026-10-25-project-management-design.md`, "Decided on the mockups").

## Intent

Sub-project 6 introduced look A ("Clear desk") and rebuilt the project and
Workload screens in it. The rest of PRISM still has the earlier
operations-console layouts sitting on look A colours. 6b finishes the job, so
every screen looks like one product.

It is a **visual restyle only**. Every field, column, filter, button, permission
check, API call and piece of wording stays as it is today, except for the few
changes the user approved, listed under "Approved behaviour changes".

## Scope

Tickets (list, board, a ticket, new ticket), Dashboard, Assets (assets,
licenses, contracts), Contacts, Companies, Knowledge (staff pages and the
public `/kb` Help Center), Reports (built-in reports and the custom report
builder), Settings (shell, menu, home and every settings page), Sign in and
Change password.

Out of scope: Projects and Workload (already done in 6); Calendar; the CSAT
survey page; any backend change; any new feature.

## Goals

- Each screen matches its approved mockup in **dark (the default) and light**,
  on desktop and at phone width (390 px).
- Reuse the look A foundation from 6: the `--color-*` tokens in
  `frontend/src/index.css`, the shared classes (`.card`, `.btn-*`, `.chip`,
  `.eyebrow`, `.page-title`, `.num`, …) and the primitives in
  `frontend/src/components/ui/` (Button, Field, Pill, StatusChip, Tabs, Tag,
  Avatar, Meter, Notice). Add new shared pieces only where several areas
  need the same thing (see "New shared pieces").
- Custom colours from Settings → Appearance keep working: new styles use the
  `--color-*` variables, not hard-coded hex, except where the foundation
  already hard-codes (e.g. per-person avatar hues, status colours that come
  from the database).

## Non-goals and anti-goals

- No behaviour change beyond the approved list. If a build step finds that a
  mockup implies another one, stop and ask.
- No backend, API, permission or data change.
- No new chart library: Reports keep recharts and restyle it.
- Not a failure mode to accept: a page that "looks right" but has lost a
  control, a label used by screen readers, a keyboard path or a permission
  gate it had before. The existing smoke tests (selectors by role and
  label) are the guard; they must keep passing unchanged unless the change is
  one of the approved ones.

## Approved behaviour changes (the only ones)

1. **Ticket page on a phone:** Link ticket, Merge and Report move into a "⋯"
   menu in the header. The reply box starts as a single line and expands into
   the full reply box when tapped (all its controls then appear as today).
2. **New ticket form:** fields regrouped into two columns — "The problem",
   "Who it's for", "Who's on it" — which changes tab order. Same fields, same
   required ones.
3. **Ticket list:** all 13 columns stay on by default; the existing Columns
   menu hides and adds them (no change to that menu's behaviour).
4. **Assets on a phone:** filters move behind a "Filters" button that opens
   a bottom sheet, like Tickets on a phone.
5. **Knowledge on a phone:** categories become a sideways-scrolling row of
   pills above the articles; Audience and Status move behind a "Filters"
   button (bottom sheet).
6. **Reports on a phone:** the date presets become a sideways-scrolling row of
   pills; Department, Company and Assignee move behind a "Filters" button
   (bottom sheet). Save view and Export CSV stay as buttons.

Desktop layouts of all of these are unchanged in behaviour.

## Approved visual choices (no behaviour change)

- **Tickets:** single-column conversation; your replies have a blue tint and
  private comments an amber one (no left/right chat bubbles). SLA "Met" and
  "On hold" show as plain muted text, as SlaBadge does today. A ticket whose
  clocks have all stopped still says "On hold" (unchanged).
- **Detail pages** (asset, license, contract, contact, company, knowledge
  article, knowledge editor) use a breadcrumb such as "Assets / LT-0014"
  instead of "← Back to …". Same destination. The public Help Center keeps
  "Back to Help Center".
- **Licenses list:** a thin seat-usage meter under "23/25".
- **Companies:** status shown as a coloured chip instead of plain text.
- **Knowledge:** the article list is one card with a row per article; article
  bodies sit on a card (staff and public).
- **Reports:** the report's name is shown as a heading above the filters;
  single-series bar charts use the accent colour (the status chart keeps the
  database status colours) with the value on top of each bar; gridlines are
  solid and faint; the line chart is a 2 px accent line; custom-report
  results grouped by person or team use horizontal bars.
- **Settings:** the shared shell, menu, page header, panels and rows restyled;
  the Users table shows the username under the person's name (beside the job
  title) instead of in its own column.
- **Sign in:** the animated "service console" panel (live clock, typing boot
  log, scan line) is replaced by a calm panel: the tagline as a large heading
  and the bullet points as a checklist with ticks — both still read from
  Company profile. The "AUTHENTICATE" eyebrow is dropped; labels are sentence
  case ("Username or email"). On a phone the tagline shows under the logo.
- **Change password:** the forced and normal versions are a centred card on
  the page background in look A (was a navy page).

## New shared pieces

- **`PageHeader`** — title, optional sub line, optional breadcrumb, actions
  slot. Used by list and detail pages that don't already have one.
- **`Breadcrumbs`** — `[{ label, to? }]`, last item is the current page.
- **`FiltersSheet`** — the phone bottom sheet extracted from `Tickets.jsx`
  (overlay, title, "Done", body slot), reused by Assets, Knowledge and Reports.
  Must trap focus while open, close on Esc and overlay click, and return
  focus to the "Filters" button.
- **`PillRow`** — the sideways-scrolling row of Pills used on phones
  (Tickets quick filters already do this; extract if it is not shared yet).
- **Chart styling** in `pages/reports/shared.jsx`: one place for axis, grid,
  tooltip, bar radius and colours.

Anything else is page-local.

## Mockup files

`docs/mockups/look-a-6b/` holds every approved board as `<Name>.dc.html`
(light; each takes a `theme` prop) and `<Name>-dark.dc.html` (dark wrapper),
plus `canvas.json` (which board belongs to which area), `looka.css` (the
mockups' stylesheet; its tokens mirror `index.css`) and `preview.js`, which
renders boards to PNG with headless Chromium for side-by-side checks while
building (`node preview.js Main Ticket:dark`). Board names by area:

- Tickets: Main (list), Ticket, TicketNew, Board, TicketsPhone
- Dashboard: Dashboard, DashAdmin (customizing), DashPhone
- Assets: AssetsList, AssetDetail, LicenseDetail, Licenses, Contracts,
  ContractDetail, AssetsPhone
- Contacts and companies: ContactsList, ContactDetail, CompaniesList,
  CompanyPage, ContactsPhone
- Knowledge: KbList, KbArticle, KbEditor, KbPortal, KbPortalArticle, KbPhone
- Reports: ReportsVolume, ReportsCustom, ReportsPhone
- Settings: SettingsHome, CompanyProfile, RoleEditor, UsersList, SettingsPhone
- Sign in: Login, ChangePassword, LoginPhone

The mockups use sample data. Where a mockup and the live screen disagree on a
field, column, action or label, **the live screen wins** (the mockups were
drawn from the live screens; a mismatch is a mockup slip, not a change).

## Constraints

- Frontend only (React + Vite + Tailwind). No new dependencies.
- Dark first: check every screen in dark, then light.
- Phone: 16 px side gutter, no horizontal page scroll, 44 px touch targets.
- Accessibility kept or improved: labels, roles, `aria-current`, focus rings,
  4.5:1 text contrast (the tokens already clear it).
- Security: no `dangerouslySetInnerHTML` added; knowledge bodies keep using
  the existing server-sanitised HTML path; the ticket description stays plain
  text.
- Process (standing rules): tests first for the approved behaviour changes;
  full backend and smoke suites once before pushing; push to dev when green.

## Testing

- **Smoke (Playwright), written first** for each approved behaviour change:
  phone ticket "⋯" menu holds Link/Merge/Report; phone reply box expands on
  tap; Assets, Knowledge and Reports "Filters" sheets open, filter, close on
  Esc and return focus; Knowledge category pills filter the list; Reports
  preset pills change the range.
- **Existing smoke suite** must pass unchanged otherwise.
- **Visual check**: per area, screenshot the built page (dark and light,
  1440 and 390 wide) with the stub-API recipe and compare against the
  mockup PNGs from `preview.js`. Eyeball, not pixel-diff.
- Frontend unit tests (`node --test`) for any extracted helper with logic.

## Left to the builder

Exact component boundaries inside each page, Tailwind vs. token-driven
inline styles, and the order of areas within the plan — as long as each
area lands whole (dark + light + phone) and the suites are green before push.
