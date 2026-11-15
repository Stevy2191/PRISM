# Company numbers: tickets and projects per company (CN)

Owner's request, 2026-11-15: tickets and projects belong to a company and are
numbered per company, so Washington County's work reads as Washington
County's; every department has a short identifier (Human Resources → HR);
customers see their projects in the portal; and reports show the total across
every company as well as each company's own counts.

Status: **Designing**. Decisions below are the owner's answers of 2026-11-15
unless marked *proposed*. Mockups: `docs/mockups/company-numbers-cn/`.

## 1. What changes

| | Today | After |
|---|---|---|
| Company | No code | A short **code** per company: Washington County → **WC** (letters and digits, 2–6, unique; suggested from the name, editable) |
| Ticket number | One system-wide count: `#00042` | Per company: **`WC-T0042`** (Washington County's 42nd ticket) |
| Department | Code only on your own departments (`SD`), for project numbers | Every department has a **code** (`HR`, `FIN`), unique within its company |
| Project number | Per your own department: `SD-P00007` | Per company, with the department it's for: **`WC-HR-P0007`**; a company-level project: **`WC-P0007`** |
| Ticket task | `#00012-T04` | `WC-T0012-T04` (owner: tasks keep `-T`, read as "task 4 of ticket WC-T0012") |
| Project task | `SD-P00007-T04` | `WC-HR-P0007-T04` |
| Portal | Tickets and knowledge base | Plus **Projects**: status and progress |
| Reports | All companies, or one picked company | Plus **By company**: every company side by side, with a total |

Your own company has a code too (e.g. **LIT** for Lakeside IT), so internal
tickets are `LIT-T0019` and internal projects `LIT-SD-P0003`.

## 2. Numbers

- **Counters per company.** Tickets count from T0001 per company. Projects
  count from P0001 per company, across all its departments (owner: one
  project counter per company, not per department, so `WC-HR-P0007` and
  `WC-FIN-P0007` can't both exist and a number alone identifies the project).
- **Width.** Four digits (`T0042`); a company past 9999 simply gets five
  (`T10000`). Searches and email matching don't depend on the width.
- **Never reused.** A deleted ticket's number is not handed out again (same
  rule as project numbers today).
- **Moving a ticket to another company** (changing its contact to another
  company's) gives it the next number of the new company. The old number keeps
  finding it (search, links, email replies), and its activity shows the change.
- **A project's department** is fixed when it is made (*proposed*: changing
  the department later keeps the number, so the middle code shows the
  department it started with).
- **Changing a company's code** changes how all its numbers read from then on;
  every old form keeps working in search, links and email.

## 3. Existing records (owner: renumber)

A migration gives every company a code (from its name; your own company from
the company name in Settings), every department without one a code (from its
name, unique within its company), then numbers each company's tickets and
projects in the order they were created. Washington County's oldest ticket
becomes `WC-T0001`.

Nothing that pointed at the old numbers breaks:

- The system-wide id stays underneath, so links (`/tickets/42`) keep working.
- **Email:** subjects become `[WC-T0042]`. A reply to an older email carrying
  `[Ticket #00042]` is still matched to the right ticket.
- **Search:** `WC-T0042`, `T0042` within a company filter, `#00042` and `42`
  all find it. Old project codes (`SD-P00007`) also still find their project.
- The agent and portal show the new numbers after the update.

## 4. Departments

- The department form, for every company, has **Code** beside the name,
  suggested from the name (Human Resources → HR, Finance → FIN) and editable.
- Unique within the company (Washington County and Acme can both have HR).
- Your own departments keep needing it; customer departments now need it too,
  since project numbers use it.

## 5. Projects per company and department

Projects already belong to a company; this makes it visible everywhere.

- **New project** asks, in order: **Company** (any customer, or yours),
  then **For** the whole company or one of its departments, then the
  department of yours doing the work (as today).
- The project's number shows the company and department. The Projects list
  gets a **Company** column and filter; a company's page (Work › Projects)
  already lists its projects.
- Company-level or department-level is shown on the project as "For
  Washington County" or "For Washington County › Human Resources".

## 6. Projects in the portal (owner: status and progress)

A **Projects** tab in each company's portal:

- **List:** number, name, status, progress (tasks done of tasks), due date.
- **A project:** status, progress bar, start and due dates, phases and
  milestones with their dates and done or not. Nothing internal: no tasks,
  people, time, costs, files or notes.
- **Who sees what** (owner: like tickets): company admins see every project of
  their company; department admins see their department's projects and
  company-level ones; other contacts see projects they are named on (owner: a
  project gets **Customer contacts**, picked on the project, who also see it).
- Staff choose per project whether it shows in the portal (owner: on by
  default for customer projects, off for your own).

## 7. Reporting

- **Ticket reports** get a **By company** table: each company with tickets
  opened, closed and open now in the date range, and an **All companies**
  total row. The Company filter stays for one company's report.
- **Project report:** the same By company table (active, completed, overdue).
- **Custom reports:** **Company** becomes a group-by for tickets, projects and
  time entries.
- The dashboard's totals stay system-wide for staff who see every company.

## 8. Out of scope

Billing per company (Phase 3), a customer approving project changes in the
portal, and numbering for assets or contracts.

## 9. Parts

1. Codes: company code, department codes for every company, migration
   (codes for everything existing).
2. Ticket numbers: per-company counter, renumbering migration, display
   everywhere (staff, portal, agent, emails), search and inbound email
   matching old and new.
3. Project numbers and the company/department choice on New project.
4. Projects in the portal.
5. Reports by company.

Each part is tested end to end; parts 2 and 3 include a round trip of their
migrations and a check that every old number still finds its record.
