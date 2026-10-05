# Sub-project 2: Client companies — design

Phase 1, sub-project 2 of the [PSA roadmap](2026-10-03-prism-psa-roadmap-design.md).
Status lives in [`docs/ROADMAP.md`](../../ROADMAP.md). Builds on the
[test baseline](2026-10-03-test-baseline-design.md), whose suite is the safety
net for this work.

## Purpose

PRISM today has one implicit customer, the organization itself, divided into
departments. An MSP needs many client companies, each with its own people,
departments, locations, tickets, projects and equipment, and staff who may be
limited to some of those clients. Vendors are free text.

This sub-project makes the company the spine every later sub-project hangs
from (agreements, billing, the client portal, RMM devices), following roadmap
rule 1 ("Companies are the spine").

Success:

- An upgraded internal-IT install has exactly one company, the internal one,
  and nothing it does changes until a second company is added.
- An MSP can add clients and vendors, and every ticket, project, contact,
  asset, license and contract sits under the right company.
- A user can be fenced to a list of companies, and no list, report, search or
  fetch-by-id lets them see past it.

## Decisions

Made with the user while brainstorming, on 2026-10-04.

| Decision | Choice |
|---|---|
| Client subdivisions | **Departments per company.** Departments gain `companyId`. Today's departments become the internal company's; clients can have their own. Sites are separate, as physical locations. |
| Staff access | **A company access list, defaulting to all.** Each user is either "all companies" or a list. Roles can carry a company list too, which adds to their holders' access. The existing own/department/all tiers apply *within* the companies a user can reach. |
| Company kinds | **Flags.** `isClient` and `isVendor`, either or both. Exactly one company is `isInternal`. Prospects are left to the sales sub-project (14). |
| Contact membership | **One company per contact**, plus an optional department and site from that company. Contacts are labelled *Name · Company · Department* wherever they appear. |
| Ticket company | **Always the contact's company.** It is derived, never set separately, and the ticket's department must belong to it. |
| Inbound email | **Match the sender's domain, else the internal company.** Companies list their email domains; free-mail domains never match. |
| Sites | **Attach to contacts and assets.** Tickets show the contact's site but store none. |
| Projects | **`companyId` is the client.** "For department" belongs to that company. "Owned by" stays an internal-company department, and project codes keep its short code. |
| Vendor text | **Migrated to vendor companies,** deduplicated ignoring case and surrounding spaces. A merge tool cleans up near-duplicates, and doubles as the general duplicate-company tool. |
| Architecture | **A real `companyId` column plus central scope helpers** in `permissionService`, called explicitly by every handler. Not derived through joins, and not injected by global Sequelize hooks. |
| Company UI switch | **`multiCompany` means at least one client company exists.** Vendor companies alone (including those the migration creates from vendor text) never turn on company pickers. *(Ruled in plan 2a.)* |
| Large files | `TicketDetail.jsx`, `TicketNew.jsx`, `ProjectDetail.jsx`, `ticketsController.js` and `projectsController.js` are touched only lightly. Splitting them stays with sub-project 3, which rewrites them, as was ruled for sub-project 1. New code goes in new, small files. |

## Data model

### New tables

**`Companies`**

| Column | Notes |
|---|---|
| `id` | |
| `name` | Required, 1–150 characters. Unique among active companies, ignoring case. |
| `isInternal` | Exactly one row is true. Created by the migration; cannot be cleared. |
| `isClient`, `isVendor` | Booleans, default false. |
| `status` | `active` / `inactive`. |
| `phone`, `website`, `notes` | Optional. `website` must be an `http(s)` URL. |
| `accountManagerId` | Optional staff user. |
| timestamps | |

**`CompanyDomains`**: `companyId`, `domain` (lower-cased, unique across all
companies). A domain on the built-in free-mail list is refused: gmail.com,
googlemail.com, outlook.com, hotmail.com, live.com, msn.com, yahoo.com,
ymail.com, icloud.com, me.com, mac.com, aol.com, proton.me, protonmail.com,
pm.me, gmx.com, gmx.net, mail.com, zoho.com, yandex.com, fastmail.com. The
list lives in one module, so it is easy to extend.

**`Sites`**: `companyId`, `name` (unique within the company), `line1`,
`line2`, `city`, `region`, `postalCode`, `country`, `phone`, `notes`, `status`
(`active` / `inactive`), timestamps.

**`UserCompanyAccess`**: `userId`, `companyId`, unique together.
**`RoleCompanyAccess`**: `roleId`, `companyId`, unique together.

### Changed tables

| Table | Gains |
|---|---|
| `Users` | `allCompanies` (boolean, not null, default true). |
| `Departments` | `companyId` (not null). `shortCode` becomes nullable. It is required, and unique, only for internal-company departments, the only ones that can own projects. |
| `Contacts` | `companyId` (not null), `siteId` (nullable). |
| `Tickets` | `companyId` (not null), always equal to the contact's company. |
| `Projects` | `companyId` (not null). |
| `Assets` | `companyId` (not null), `siteId` (nullable), `vendorCompanyId` (nullable). `locationBuilding/Floor/Room` stay, as the location within the site. |
| `Licenses`, `Contracts` | `companyId` (not null), `vendorCompanyId` (nullable). |
| `ProjectMaterials` | `vendorCompanyId` (nullable). |

All `companyId`, `siteId` and `vendorCompanyId` columns are indexed.
The old free-text vendor columns (`Assets.vendorName`, `Licenses.vendor`,
`Contracts.vendor`, `ProjectMaterials.vendor`) stay for one release as a
safety net. The API stops writing them, and a later release drops them.

### Integrity rules (enforced in handlers, tested)

- A contact's department and site belong to the contact's company.
- A ticket's `companyId` equals its contact's `companyId`. A ticket's
  department belongs to that company, or is empty.
- A project's "for department" belongs to the project's company, or is empty.
  Its "owned by" department belongs to the internal company.
- An asset's department and site belong to the asset's company.
- `vendorCompanyId` only accepts a company with `isVendor` set. A record's
  `companyId` accepts a client company or the internal company.
- An inactive company or site cannot be newly chosen. Existing references
  stay. (Departments have no status column; adding one is out of scope.)
- Moving an asset, license or contract to another company clears its
  department, site and assigned contact unless new ones from the new company
  are given. *(Ruled in plan 2a.)*

### Migration

One migration, with a working `down()` proven by a round-trip test in
`migrations.test.js` (roadmap rule 6). Up:

1. Create the tables above.
2. Insert the internal company: `isInternal = true`, `isClient = false`,
   `isVendor = false`, named from the `company.name` setting. If the setting
   is missing, use "Internal".
3. Add the new columns, then set `companyId` to the internal company on every
   department, contact, ticket, project, asset, license and contract, before
   making the column not null.
4. For each distinct vendor string across the four vendor columns (trimmed,
   compared case-insensitively, empty ignored), create one vendor company
   (`isVendor = true`, named from the first spelling seen) and set
   `vendorCompanyId` on every matching row.
5. Set `Users.allCompanies = true` for every user.

Down reverses this. It drops the new columns and tables. The free-text vendor
columns were never removed, so no vendor data is lost.

## Scope and permissions

### Company access

`permissionService` gains:

- `getUserCompanyIds(user)`: returns `null` (meaning all companies) when the
  user has `allCompanies`, or holds the System Administrator role. Admins
  cannot be fenced: a fenced admin could lock everyone out of fixing it.
  Otherwise it returns the union of the user's `UserCompanyAccess` rows and the
  `RoleCompanyAccess` rows of every role they hold. Cached with the existing
  per-user permission cache, and invalidated whenever grants change.
- `canAccessCompany(user, companyId)`: true or false.
- `companyScopeWhere(user, column = 'companyId')`: `{}` for all, or
  `{ [column]: { [Op.in]: ids } }`. An empty list matches nothing.

### Where the fence goes

The company check runs before the existing tier check, on every read and
write:

- **Single records:** `canAccessTicket`, `canAccessProject`, and every
  `findAccessible*` link helper from sub-project 1 refuse a record whose
  company the user can't reach. Single-record routes answer as they do today:
  403 for a record outside the user's scope. Link fields keep sub-project 1's
  rule (S3–S8): a missing id and an out-of-scope id get the same answer, ids
  are parsed strictly, and the checked record's id is what gets stored.
- **Lists:** tickets (list and board), projects (list and tags), contacts,
  assets, licenses, contracts, departments, sites, the dashboard, search, the
  calendar, every report and CSV export, the custom report engine, and CSAT
  stats all add `companyScopeWhere`.
- **Assets, licenses and contracts** get record-level scope for the first
  time: their fetch-by-id and mutate-by-id handlers check company access.
  Today they check only the module permission.
- **Cross-module links** (asset ↔ ticket, license ↔ asset/contact,
  contract ↔ asset, asset checkouts, assets on the new-ticket form) must point
  at a visible record in the same company. A link made before a move is kept
  but shown only while both ends are in the same company. *(Ruled in plan 2a.)*
- **Tiers inside the fence:** "department" still means the user's own
  department, and "all" means all records in reachable companies. Contacts:
  `people.view_all` covers contacts in reachable companies, and "own
  department" is unchanged.

### New permissions

| Key | Grants | Seeded to |
|---|---|---|
| `companies.view` | See companies, their sites, departments and domains. | System Administrator, System Technician, Department Manager |
| `companies.manage` | Create, edit, merge, deactivate and delete companies; manage sites, domains and client departments. | System Administrator |
| `companies.manage_access` | Set a user's or role's company access. This grants privilege, like role assignment. | System Administrator |

Department create/update for a client company needs `companies.manage`. For
the internal company it keeps today's `people.manage_departments`.

### Audit

Each of these writes an `AuditLog` row:

- company create, update, merge, deactivate and delete;
- site create, update and deactivate;
- domain add and remove;
- client department create and update;
- a contact moving between companies.

Company-access changes also write `SystemAuditLogs` rows (`company_access_granted` /
`company_access_revoked`), next to role assignments.

## Behaviour

### Tickets and contacts

- **New ticket:** `companyId` comes from the contact. The department defaults
  to the contact's department, must belong to the contact's company, and is
  refused otherwise with 400 `VALIDATION_ERROR`.
- **A ticket's contact changes:** `companyId` follows the new contact. If the
  ticket's department is not in the new company, it resets to the new contact's
  department, or to empty.
- **A contact moves to another company** (`PATCH /contacts/:id` with
  `companyId`): every ticket of that contact moves too. The contact's
  department and site are cleared if they don't belong to the new company. The
  caller needs access to both companies and `people.edit_users`. Billing
  (sub-project 13) will later stop invoiced tickets moving; nothing is
  invoiced yet.
- **`PATCH /contacts/:id/department`** (S8) keeps its rules, and the
  department must belong to the contact's company.

### Arriving contacts

- **Inbound email:** the sender's domain is looked up in `CompanyDomains`,
  among active companies. A match creates the contact under that company;
  otherwise it goes under the internal company. Free-mail domains never match.
- **AD sync:** contacts go to the internal company. Group-to-department
  mappings are unchanged, because those are internal departments.
- **CSV import:** gains an optional "Company" column, matched against active
  company names (exact, ignoring case). A blank cell means the internal
  company. A non-blank unmatched name is flagged in the preview, and those
  rows are not imported until it is fixed.

### Merge (B into A)

`POST /companies/:id/merge { intoCompanyId }`, with a preview mode
(`?preview=true`) that returns per-table counts and changes nothing.

- One transaction moves every reference to B over to A:
  - contacts, departments, sites, tickets, projects, assets, licenses and
    contracts (`companyId`);
  - vendor links (`vendorCompanyId`);
  - `UserCompanyAccess` and `RoleCompanyAccess`, with duplicates dropped;
  - domains.
- A's `isClient` / `isVendor` become the union of both companies'.
- B is deleted.
- Same-named departments and sites are kept side by side, not merged.
- The internal company may be A but never B.
- Requires `companies.manage` and access to both companies.
- The audit row records the per-table counts.

### Deactivate and delete

- An inactive company drops out of pickers and email matching, and keeps all
  history.
- `DELETE /companies/:id` works only when nothing references the company.
  Otherwise it returns 409 `COMPANY_IN_USE` ("Deactivate or merge instead").
- The internal company cannot be deactivated, deleted, or have `isInternal`
  cleared.

### The company picker (roadmap rule 2)

`GET /companies/summary` returns `{ count, multiCompany }`. When
`multiCompany` is false, the frontend hides every company column, filter and
picker. A one-company install's only new UI is the Settings → Companies page.

## API

New routes under `/api/v1`, all fenced by company access:

| Route | Permission |
|---|---|
| `GET /companies` (filters: `kind=client\|vendor`, `status`, `search`; paginated) | `companies.view` |
| `GET /companies/summary` | any staff user |
| `GET /companies/:id` | `companies.view` |
| `POST /companies`, `PATCH /companies/:id`, `DELETE /companies/:id` | `companies.manage` |
| `POST /companies/:id/merge` | `companies.manage` |
| `GET/POST /companies/:id/sites`, `PATCH /companies/:id/sites/:siteId` | view / manage |
| `POST/DELETE /companies/:id/domains[/:domainId]` | `companies.manage` |
| `GET/PUT /users/:id/company-access`, `GET/PUT /roles/:id/company-access` | `companies.manage_access` |

Existing routes gain `companyId` in bodies and as a list filter
(`?companyId=`) where the screens below need it. `GET /departments` gains
`?companyId=`.

## Screens

New screens go in new files under `frontend/src/pages/companies/` and
`frontend/src/components/companies/`.

- **Settings → Companies** (always present): a list with client/vendor flags,
  status, contact count and open-ticket count; filters by kind and status;
  create; "Merge into…" with the preview counts and a confirmation.
- **Companies nav tab** (once `multiCompany`, behind module visibility): the
  same list, plus a company page with these tabs:
  - **Overview:** fields, domains, account manager.
  - **Sites:** add, edit, deactivate.
  - **Departments:** the company's own.
  - **Contacts, Tickets, Projects, Assets:** the existing list components with
    `?companyId=`.
  - **Vendor** (vendor companies only): contracts, licenses and assets bought
    from them.
- **Contacts everywhere** (pickers, lists, contact page, ticket header) are
  labelled *Name · Company · Department*. The company part is hidden when not
  `multiCompany`. The contact page gains Site and Company fields. Changing a
  contact's company asks for confirmation, because the move takes the
  contact's tickets with it.
- **New ticket:** after a contact is picked, the company shows read-only and
  the department list is limited to that company.
- **Projects:** the form gets a company picker. "For department" is limited
  to that company, and "Owned by" to internal departments.
- **Assets, licenses and contracts:** a company picker, and a vendor picker
  that searches vendor companies and can create one inline. Assets also get a
  Site picker.
- **List filters:** tickets, projects, assets, licenses, contracts and the
  reports get a Company filter when `multiCompany`.
- **Users and roles:** a "Company access" control ("All companies" or a
  chosen list), shown to holders of `companies.manage_access`.
- **Settings → Departments:** grouped by company.

## Testing

Integration tests in the sub-project 1 style, in new files under
`backend/test/integration/`, each under about 800 lines:

- **Migration:** up on a database seeded with today's shape.
  - Every row gains the internal company.
  - The vendor strings `"Dell"`, `"dell "` and `"DELL"` become one vendor
    company, and every matching row links to it.
  - A down/up round trip restores the old schema and data.
- **Company fence matrix:**
  - For tickets, projects, contacts, assets, licenses, contracts, departments
    and sites, every list and every fetch-by-id or mutate-by-id is tried by a
    user fenced to another company. Lists exclude the records; single records
    refuse.
  - The same for the dashboard, search, the calendar, every report and CSV
    export, the custom report engine and CSAT stats.
  - A user with role grants sees the union of user and role grants.
  - An admin can't be fenced.
- **Link fields** (contact, department, site, vendor, "for department",
  "owned by", project, company): missing, wrong-company and fenced-out ids all
  get the same refusal, and ids are parsed strictly.
- **Behaviour:**
  - the ticket company follows its contact;
  - a contact move moves its tickets and clears a foreign department and site;
  - inbound-email domain matching, with free-mail domains refused;
  - the CSV import's company column;
  - merge counts, and that no row references B afterwards;
  - the internal company can't be deleted, deactivated or merged away;
  - delete is refused while the company is in use;
  - a domain can belong to only one company.
- **Regression:** the whole existing suite passes unchanged, which proves a
  one-company install behaves as before. Any baseline test that must change is
  a ruling, recorded in the plan's ledger with the reason.

## Done when

- Everything above passes on Node 24, locally and in CI.
- Every new mutating endpoint is permission-checked and audited, and every
  fetch-by-id re-checks company and tier.
- No new file exceeds roughly 800 lines.
- A security review of the whole diff has run before shipping. This is the
  first sub-project that changes the core of authorization.
- `docs/ROADMAP.md` marks sub-project 2 **Shipped**. `UPGRADING.md` says that
  nothing changes until a second company is added, and that the old vendor
  text columns go in a later release.

## Security notes

Fixed while building plan 2a: **S9** (moving a contact to a department needed
no access to the contact), **S10** (contact list filters replaced the scope
instead of narrowing it), unchecked contact and asset ids on assets, asset
checkouts and the new-ticket form, and `/assets/12abc`-style ids that the
database read as record 12.

## Out of scope

- Company conditions in workflow rules and assignment rules.
- Per-company SLAs and business hours (sub-project 4).
- Agreements, rates and billing (Phase 3). Freezing invoiced tickets on a
  contact move comes with billing.
- Client logins and the portal (sub-project 7).
- A ticket-level site, and dispatch (sub-project 5).
- Prospects and sales (sub-project 14).
- Dropping the old vendor text columns (a later release).

## Expected size

Large. At planning time, split it into two plans if one would be unwieldy:

- (a) companies, sites, departments-per-company, the scope fence and the
  migration;
- (b) vendors, merge, CSV import and the remaining screens.

Both plans implement this one spec.
