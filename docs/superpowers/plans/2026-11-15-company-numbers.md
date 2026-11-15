# Company numbers (CN): build plan

Spec: `docs/superpowers/specs/2026-11-15-company-numbers-design.md` (approved
2026-11-15, with mockups `docs/mockups/company-numbers-cn/`).

Each part: failing tests first, then the change, then the backend suite for
what it touches and the smoke tests for its screens; commit per part.

## Part 1: codes (migration 096)

- `services/codes.js`: `suggestCode(name, {max})` (initials of the words that
  matter, else the first letters), `uniqueCode(base, taken, max)`.
- Migration 096: `Companies.code` (unique, 2–6 A–Z/0–9) and
  `Companies.previousCodes`; a code for every company; a code for every
  department without one, unique within its company.
- Companies API: `code` on create (suggested when left out) and update
  (unique, kept in `previousCodes` when changed). Departments: `shortCode` for
  every company, suggested when left out, unique within the company.
- Screens: Code on New company, Setup › Details and Your company's profile;
  Code on every department form, suggested from the name as it's typed.
- [x] Commit `feat(companies): a code for every company and department (migration 096)`

## Part 2: ticket numbers (migration 097)

- `Tickets.companySeq`, `Tickets.number` (`WC-T0042`, kept current),
  `Tickets.previousNumbers`; a per-company counter; renumbering migration;
  ticket task codes `WC-T0042-T01`.
- A company code change rewrites its numbers; a ticket moved to another
  company takes the next number there and keeps the old one findable.
- Everywhere a number shows (staff, portal, agent, emails, PDFs, search,
  dashboard, reports, calendar) uses `number`.
- Email subjects `[WC-T0042]`; inbound matching of `[WC-T0042]`,
  `[Ticket #00042]` and `[#00042]`.
- [x] Commit `feat(tickets): numbered per company (migration 097)`

## Part 3: project numbers (migration 098)

- `Projects.companySeq`, `projectCode` = `WC-HR-P0007` or `WC-P0006`,
  `Projects.previousCodes`; per-company counter; renumbering migration; task
  codes follow.
- New project: Company, For (whole company or a department), Done by,
  Customer contacts, Show in the portal. `ProjectContacts`,
  `Projects.showInPortal`.
- Projects list: Company column and filter.
- [x] Commit `feat(projects): numbered per company and department (migration 098)`

## Part 4: projects in the portal

- Portal API `GET /portal/c/:slug/projects`, `/projects/:id`: status,
  progress, phases, milestones only; who sees what as the spec says.
- Portal pages: Projects list and a project.
- [x] Commit `feat(portal): each company's projects`

## Part 5: reports by company

- By company tables (tickets, projects) with an All companies total; Company
  as a custom-report group-by.
- [x] Commit `feat(reports): by company, with the total`

## Finish

UPGRADING (v0.6.0 notes: numbers change, old ones still found), ROADMAP,
full suites, screenshots beside the mockups, push.
