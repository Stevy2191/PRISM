# Settings redesign

**Status:** design approved in conversation 2026-10-12 (layout option A and the
grouping, picked from the mockups at
https://claude.ai/artifact/VWaSDGTgbbGSYAZH1E4oLM). This spec awaits review.

## Why

The user: "Right now it looks like someone barfed and they all landed
wherever." Today Settings is a wall of about 37 cards in 7 groups:

- Groups are catch-alls. "Customization" holds 11 unrelated things.
- Related settings are apart: Business Hours and Holidays sit under
  Organization, SLAs under Automation.
- Things overlap. The logo is on both Company and Branding. The company name
  is on both. The time zone is on both Company and General Settings.
- "General Settings" mixes the directory (AD/LDAP), incoming and outgoing
  email, the email log, the time zone, the upload limit and system info.
- Four cards open "coming soon" pages.
- Every page is a dead end with its own "← Back to Settings" link (33 of
  them) and its own layout.

## Decisions (user, 2026-10-12)

| Question | Choice |
|---|---|
| What to fix | Both the hub and the pages: regroup, and give Settings its own menu and one page layout. |
| Layout | Option A: one menu down the left with every group and page, search at the top. |
| Opening Settings | An overview of every group with its pages, a search box, and status hints. |
| "Coming soon" pages | Hidden until built. The roadmap tracks them. |

## Layout

### The Settings shell

Every Settings URL renders inside one shell, under the app's top bar or
beside its compact sidebar:

- **Left menu** (about 232px), on the sidebar colour, scrolling on its own:
  - a search box at the top;
  - "Settings home";
  - each group as an eyebrow label with its pages under it;
  - the current page highlighted (card background, accent tick on the left);
  - groups and pages the user can't open are left out; a group with nothing
    left is left out.
- **Page area** on the right, with the page's own content.
- The whole shell replaces the 33 "← Back to Settings" links. The menu is the
  way around.

### Search

- Filters the menu as you type, matching each page's name, its one-line
  description and a short list of keywords (for example Users matches
  "password" and "account"; Company profile matches "logo", "time zone").
- Enter opens the first match; Escape clears.
- The overview's search box does the same and lists matches as links.
- Search only covers pages the user can open.

### Settings home (the overview)

- Title "Settings" and a one-line description.
- A larger search box.
- Every visible group with its pages as short links (three columns wide,
  two on tablets, one on phones).
- **Status hints** next to a page, for owners only:
  - Directory (AD/LDAP): "Connected" or "Not set up";
  - Incoming email: "On" or "Off";
  - Outgoing email: "Set up" or "Not set up";
  - Single sign-on: how many providers are on.
  They come from one new owner-only endpoint, `GET /settings/status`, which
  returns only booleans and counts (never hosts, users or secrets).
- The version footer stays at the bottom of the overview.

### Phones and narrow screens

Under 768px the left menu folds into a full-width "Settings ▾" button above
the page. It opens the same menu (with search) as a sheet; choosing a page
closes it.

### One page layout

A shared `SettingsPage` component gives every page the same frame:

- a breadcrumb ("Settings / Time & work");
- the page title and a one-line description;
- an optional actions slot on the right of the title (for example "New role");
- content in panels: a header strip with the panel's name, then rows;
- a settings row puts the label and its help text on the left and the control
  on the right; under 640px they stack;
- pages that save a form end with a save bar at the bottom of the form:
  "Unsaved changes" when the form differs from what was loaded, then Save.
  A successful save shows "Saved".

List pages (Users, Roles, Statuses, Workflow rules and the like) keep their
tables but sit in the same frame, with their "New …" button in the actions
slot. Their own detail and editor pages (a user, a role, a workflow rule)
also render inside the shell with the menu.

## The grouping

The menu, in this order. Existing URLs stay so bookmarks keep working. New
pages get `/settings/...` URLs.

| Group | Page | URL | Who sees it |
|---|---|---|---|
| You | Preferences | `/settings/preferences` | everyone |
| | About PRISM | `/settings/about` | everyone |
| Organization | Company profile | `/settings/company` | `settings.manage_branding` or `settings.manage_system` |
| | Companies & vendors | `/settings/companies` | `companies.view` |
| People & access | Users | `/admin/users` | `people.view_all` or `people.create_users` |
| | Teams | `/settings/teams` | `people.view_all` or `people.manage_departments` |
| | Departments | `/admin/departments` | `people.manage_departments` |
| | Roles & permissions | `/admin/roles` | `people.manage_roles` |
| | API keys | `/admin/apikeys` | everyone with a legacy admin or technician role |
| Service desk | Statuses | `/settings/statuses` | `settings.manage_statuses` |
| | Custom fields | `/settings/layouts` | `settings.manage_system` |
| | Ticket templates | `/admin/blueprints` | legacy admin or technician |
| | Assignment rules | `/settings/assignment-rules` | `settings.manage_system` |
| | Workflow rules | `/settings/workflow-rules` | `settings.manage_system` |
| | Notifications | `/settings/notifications` | `settings.manage_system` |
| | Customer happiness | `/settings/customer-happiness` | `settings.manage_system` |
| Hours & SLAs | SLAs | `/settings/slas` | `settings.manage_system` |
| | Business hours | `/settings/business-hours` | `settings.manage_business_hours` |
| | Holidays | `/settings/holidays` | `settings.manage_business_hours` |
| Time & work | Time tracking | `/settings/time-tracking` | `settings.manage_system` |
| | Work types | `/settings/work-types` | `settings.manage_system` |
| Assets | Asset categories | `/settings/asset-categories` | `settings.manage_system` |
| | Expiry alerts | `/settings/asset-alerts` | `settings.manage_system` |
| Sign-in & email (owners) | Single sign-on | `/settings/single-sign-on` | owner + `settings.manage_system` |
| | Directory (AD/LDAP) | `/settings/directory` (new) | owner + `settings.manage_system` |
| | Directory sync | `/settings/directory-sync` | owner + `settings.manage_system` |
| | Incoming email | `/settings/incoming-email` (new) | owner + `settings.manage_system` |
| | Outgoing email | `/settings/outgoing-email` (new) | owner + `settings.manage_system` |
| | Email log | `/settings/email-log` | owner + `settings.manage_system` |
| | Calendar | `/settings/calendar-integration` | owner + `settings.manage_system` |
| System | Modules & tabs | `/settings/modules` | `settings.manage_system` |
| | Background jobs | `/settings/schedules` | `settings.manage_system` |
| | Import | `/settings/import` | legacy admin |
| | Export | `/settings/export` | legacy admin |
| | Audit log | `/settings/audit-log` | `settings.view_audit_log` |
| | System info | `/settings/system` (new) | `settings.manage_system` |

"Who sees it" is unchanged from today for every existing page: this redesign
moves pages, it does not change who may open them.

### Pages that change shape

- **Company profile** (`/settings/company`) merges Company and Branding into
  one page with panels: Details (organization name, support email),
  Regional (time zone, date format, time format, language), Look (app name,
  logo, favicon), Login page (tagline, bullet points). Each value is edited in
  one place only. `/settings/branding` redirects here. Whoever may open
  either page today may open this one (both use the same permissions).
- **General Settings is split**, and `/admin/settings` redirects to the
  overview:
  - its AD/LDAP panel becomes **Directory (AD/LDAP)**;
  - its incoming and outgoing email panels become **Incoming email** and
    **Outgoing email**;
  - its email-log card goes (Email log is in the menu);
  - the time zone goes (it is on Company profile);
  - the upload limit, database and application details become **System
    info**, with panels Uploads (max attachment size), Database and
    Application.
- **Hidden placeholders:** Email templates, Macros, Supervisor rules and
  Recycle bin leave the menu. Their URLs redirect to the overview. Their
  routes and the shared `Placeholder` page are removed; each comes back as a
  real page with its sub-project (SLA engine, service desk).

## One source of truth for access

A single settings registry (`frontend/src/pages/settings/registry.js`) lists
every page: its group, name, description, keywords, URL, component and
access rule (permission keys, legacy roles, owner). Both the menu and the
routes are built from it:

- a page is in the menu exactly when its route would let the user in;
- the route guards stay as they are today (`ProtectedRoute` with the
  permission keys or roles, plus the owner check), now generated from the
  registry instead of written out twice;
- hiding a menu entry is never the security: the server already enforces
  every one of these permissions and the owner rule, and keeps doing so.

## The new endpoint

`GET /settings/status`, owner only (as the sign-in and email settings are),
returns:

```json
{ "directory": { "configured": true, "connected": true },
  "incomingEmail": { "enabled": false },
  "outgoingEmail": { "configured": true },
  "singleSignOn": { "enabled": 1 } }
```

Booleans and counts only. A non-owner gets `403 OWNER_ONLY`, like the other
owner settings.

## Testing

- **Backend:** the status endpoint's shape, that it is owner-only, and that
  it never includes a host, username, password or secret.
- **Registry (unit):** every entry has a group, a name, a URL and an access
  rule; no two share a URL; every group in the order list exists.
- **Browser smoke tests:**
  - an owner sees every group; a System Technician sees only what their
    permissions allow, and the Sign-in & email group is absent;
  - a page's menu entry is highlighted on that page, including a user's or a
    role's detail page;
  - search narrows the menu and Enter opens the first match;
  - old URLs (`/admin/settings`, `/settings/branding`, the four
    placeholders) land where this spec says;
  - Company profile saves a value from each panel;
  - at 375px the menu is behind "Settings ▾" and the page has no sideways
    scroll;
  - the save bar says "Unsaved changes" after an edit and "Saved" after a
    save.
- Every existing Settings smoke test keeps passing (its selectors may change
  where a "Back to Settings" link or a heading moved).

## Out of scope

- Who may open which page (unchanged; see the table).
- New settings. The roadmap's sub-projects add their own pages to the
  registry when they ship.
- The rest of the app's navigation.
