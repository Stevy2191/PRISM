# Settings cleanup: your company, customer companies, one place for each setting

> Status: design and decisions approved by the owner 2026-11-14. Mockups and
> plan to follow.
> Builds on today's first pass (`497fe41`, "Settings: global only; per-company
> settings on each company's page") and on Playbooks/Checklists (PB, PB2), the
> client portal (7a, 7b), SLAs (5a, 5b) and per-company categories (9).
> Roadmap row: "CS" in `docs/ROADMAP.md` (to add with the plan).

## What the owner asked for (2026-11-14)

1. A clear line between **my company** and **customer companies**.
2. **Each company has its own SLAs.** (Answer: its own targets on its page, no
   shared list; a new company starts from a copy of the starting targets.)
3. Every setting that is about one customer company is **on that company's
   page**: a one-stop page, and where you land after creating a company.
   (Answer: also its business hours and holidays, its portal, its
   satisfaction surveys, and the checklists and rules that apply to it.)
4. **No duplicate settings.** The example: the timer's automatic/manual mode
   in Preferences and again in Time tracking. (Answer: each person sets their
   own; the "for new users" default goes.)
5. **Each company has its own portal link**, and nobody from one company can
   sign in to, or see anything in, another company's portal.

## The rule this design follows

A setting lives in exactly one place, chosen by what it is about:

| It is about… | It lives… |
|---|---|
| One person | **Preferences** (their own) or the person's page (set by an admin) |
| One company, yours included | **That company's page** |
| The help desk as a whole | **Settings** |

Where two switches decided one thing, one of them goes. Where a setting did
nothing, it goes.

## 1. Your company and customer companies

- **Your company's page is in Settings**, as *Settings › Your company*. It is
  the same one-stop page a customer company has (below), plus what only your
  company has: logo, login page, app name, your staff's departments with
  their short codes and default roles.
- **Your company is no longer in the Companies list.** *Companies* (the nav
  tab and *Settings › Customers*) lists customers and vendors only. Tickets,
  contacts and assets of your own company still show your company's name and
  link to *Settings › Your company*.
- The same words everywhere: **Your company**, **Customer companies**,
  **Vendors**. "Clients", "Companies & vendors" and "Organization" go.

### An install with only your own company

Some installs serve one organization: the help desk's own. Your company is
then the owner and the only "customer". PRISM already knows this case (no
customer company exists yet) and hides company pickers and tags. This design
follows the same switch:

- **Everything is under *Settings › Your company*:** its SLA targets, support
  hours, holidays, categories, portal and surveys. Your own staff and
  employees are its contacts, and its SLA is the one every ticket uses.
- ***Settings › Customers* shows one line**, "Add a customer company", and
  nothing else. *Starting values for new companies* is hidden: there is
  nothing to copy them to.
- **The portal keeps the plain address.** `/portal` goes straight to your
  company's portal, and `/portal/<your company>` works too. Nobody is told
  to "use your company's link" when there is only one company.
- **Adding the first customer company** turns the rest on: the Customers
  section, company pickers and tags, the starting values (seeded from your
  company's own targets, hours and holidays), and `/portal` becomes the
  "use your company's link" page. Your company's settings don't move.

When you do have customers, your company can still have its own portal and
SLA, for your own employees' tickets: it is a company like the others, kept
in Settings.

## 2. A company's one-stop page

A company's page keeps its five tabs. **Setup** becomes the one place for
everything you set for that company, in this order:

| Part | What you set there | Today |
|---|---|---|
| **Details** | Name, account manager, phone, website, client/vendor, status, notes, email domains | Same |
| **SLA and hours** | The company's response and resolution targets; its business hours and time zone; its holidays | Targets are a shared list in Settings; hours and holidays are in Settings |
| **Portal** | Portal on or off for this company; its own portal link; which contacts can sign in, with Invite; company and department portal admins; Microsoft 365 | Split over Settings, the contact's page, People › Departments and Setup › Microsoft 365 |
| **Surveys** | Whether this company's contacts get a satisfaction survey; its recent scores | One global switch |
| **Categories** | The company's ticket categories | Same |
| **What applies here** | The checklist bundles offered for this company (editable: on or off for this company), and the workflow rules, recurring tickets and custom fields that apply to it, each linking to where it is edited | Not shown anywhere |

- **Creating a company opens its page** on Overview, whose setup checklist
  gains: SLA targets reviewed, business hours set, portal on, surveys chosen.
  A new company starts with a copy of the starting targets, hours and
  holidays (section 3), the portal off, and surveys on.
- Devices, install keys and agent notices stay under Assets: they are things
  you manage, not settings.

## 3. Each company has its own SLA, hours and holidays

- **Targets.** A company's targets (by ticket type and priority, as now) are
  edited on its page. There is no list of policies to choose from.
- **Business hours and time zone.** Each company has one weekly schedule (or
  24×7) and one time zone, on its page. Its SLA clock follows them.
- **Holidays.** Each company has its own list of days off, on its page. A
  holiday closes that company's SLA clock for the day.
- **Starting values.** *Settings › Hours & SLAs › Starting values for new
  companies* holds one set of targets, hours and holidays. It is only copied
  when a company is created; changing it later changes no existing company.
- **Your company's** hours and holidays are on *Settings › Your company*.
  Staff workload (who is free on which day) uses your company's holidays, and
  nothing else: a customer's holiday never changes a technician's capacity.
- **Moving over, with no ticket's due date changing:**
  - Each company gets its own copy of the policy it is on today (the default
    for those that chose none), with that policy's hours and holidays.
  - Open tickets are pointed at their company's copy. The targets and hours
    are identical, so their clocks and due dates don't move.
  - The default policy becomes the starting values. Other shared policies are
    removed once every company has its copy.
- **Workflow rules.** The action "Set SLA policy" goes: there are no shared
  policies to name. Rules that use it keep their other actions; the upgrade
  notes list them. (What it was used for is now done by the company's own
  targets and by changing a ticket's priority.)
- **Removed because they did nothing or doubled up:** the department on a
  business-hours schedule (never read), the department on a holiday list
  (replaced by the company), *Settings › SLAs*, *Business hours* and
  *Holidays* as lists.

## 4. Each company has its own portal

- **Its own link.** `https://<your PRISM>/portal/<company>` (for example
  `/portal/acme`). The name is made from the company's name when the portal
  is first switched on and can be changed on Setup › Portal; the old link
  keeps working after a rename.
- **Its own switch.** The portal is on or off per company. A company whose
  portal is off, or that is inactive, cannot be signed in to at all.
  (Today a contact of an inactive company can still sign in with a password.
  That is closed.)
- **Only its own people.**
  - A company's sign-in page accepts only that company's contacts. A contact
    of another company gets the same "wrong email or password" as anyone
    else; the page never says the account exists elsewhere.
  - A session belongs to one company. Every portal request checks it against
    the company in the address; a mismatch is refused.
  - Everything a contact sees is already limited to their company (tickets,
    assets, knowledge-base articles for their company). This is re-checked
    with tests that sign in as a contact of company A and ask for company B's
    tickets, attachments, articles and people by id.
  - Microsoft sign-in at a company's link accepts only that company's tenant.
- **Emails** (invites, password resets, ticket replies) link to the
  contact's own company portal.
- **The old shared address** `/portal` no longer signs anyone in. It shows a
  short page: "Use the portal link your IT help desk gave you." Links in
  emails already sent keep working: they carry the ticket, PRISM finds the
  company and sends the person to its portal.
- **Settings › Customers › Client portal** keeps only what is global: the
  Microsoft sign-in app, and who may manage portal access. The global on/off
  switch goes (each company has its own).

## 5. Satisfaction surveys

- **Per company:** on or off, on Setup › Surveys, with that company's recent
  scores.
- **Settings › Customers › Satisfaction surveys** keeps what is the same for
  everyone: the question, when it is sent, how long the link works, and how
  many responses before a technician's score shows.
- **One switch, not three.** The global on/off goes, and so does "Send this
  email" on the survey's email template. The template stays for the wording.

## 6. Duplicates removed

Found by reading every Settings page, the user and company pages, and what
each control writes.

| # | Today | After |
|---|---|---|
| 1 | Timer mode in Preferences and "for new users" in Time tracking | Preferences only. New accounts start on manual. |
| 2 | Minimum timer length in both, with different choices and help text that disagrees | Preferences only, one list of choices, text that says what happens |
| 3 | Organization name on Company profile and on your company's Details, kept in step by code | One field, on *Settings › Your company* |
| 4 | Your departments in Settings and on your company's page | One place: *Settings › Your company* |
| 5 | "Require a category on new tickets" twice in the code, one never shown | One switch |
| 6 | Four switches decide one staff notification email (event on/off, email default, each person's choice, the email template's own switch) | Two: the help desk's default (Notifications) and each person's own choice (Preferences). Templates keep their wording, lose their switch. One list of defaults, not three that disagree. |
| 7 | Survey on/off in two places | Section 5 |
| 8 | Holidays wired two ways (workload by department; SLA only through a schedule) | Section 3: by company |
| 9 | A department on a business-hours schedule, with a warning that isn't true | Removed |
| 10 | Three time-zone lists that differ | One list. Your company's zone on its page; a customer's on its SLA and hours. |
| 11 | "Business hours" (the SLA clock) and "Hours people work" (workload) look alike and sit in two sections | Named **Support hours** (per company) and **Staff hours** (per person), with a line saying which is which |
| 12 | The help desk's mailbox typed twice (incoming address, outgoing "from") | Outgoing offers "same as incoming" |
| 13 | Calendar: app credentials (Settings) and each person's connection (Preferences) under one name | Named **Calendar apps** and **My calendars** |

Left alone on purpose: a department's default role and a sign-in provider's
default role (they answer different questions); a contact's department set by
hand or by directory sync (the sync page already says which wins).

## 7. Settings after the cleanup

| Section | Pages |
|---|---|
| **You** | Preferences |
| **Your company** | Your company (one page: Profile and login page, Departments, Sites, Support hours and holidays, SLA, Categories, Portal, Devices) |
| **Customers** | Customer companies (the list) · Client portal (Microsoft app, who manages access) · Satisfaction surveys |
| **People & access** | Users · Teams · Roles & permissions · API keys |
| **Service desk** | Statuses · Custom fields · Ticket templates · Canned responses · Recurring tickets · Checklists · Workflow rules · Notifications · Ticket rules (require a category; require time before closing) |
| **Hours & SLAs** | Starting values for new companies · Staff hours |
| **Time & work** | Time tracking (the longest entry) · Work types |
| **Projects** | Project templates |
| **Assets** | Asset categories · MDMs · Expiry alerts |
| **Sign-in & email** | Single sign-on · Directory (sign-in and sync on one page) · Email (incoming and outgoing on one page) · Email templates · Email log · Calendar apps |
| **System** | Background jobs · Import · Export · Audit log · System info |
| **About** | About PRISM |

Gone as separate pages: Departments, Ticket categories, SLAs, Business hours,
Holidays, Directory sync, Incoming email, Outgoing email. Their old addresses
redirect to where the setting now is.

## 8. In four parts

Each part is usable on its own and ends with both test suites passing.

1. **Structure and duplicates.** Your company in Settings and out of the
   Companies list; the Setup tab's new order; creating a company opens its
   page; the duplicates of section 6 that need no data change (1–7, 9–13);
   merged pages; the words.
2. **SLA, hours and holidays per company** (section 3), with the move-over
   that keeps every open ticket's due date.
3. **A portal per company** (section 4) and **surveys per company**
   (section 5).
4. **What applies here** (section 2's last row): bundles offered for this
   company, and the lists of rules, recurring tickets and custom fields.

## Decisions (owner, 2026-11-14)

1. **Your company's page moves into Settings and leaves the Companies
   list.** Yes.
2. **Portal links are a path** (`/portal/acme`), not a sub-domain. Yes.
3. **The old shared `/portal` stops signing people in** once there are
   customer companies (with only your own company, it goes to yours). Yes.
4. **"Set SLA policy" in workflow rules is removed.** Yes; no rule of the
   owner's uses it. The migration still lists any rule that does.
5. **Each company has its own time zone** for its SLA clock and the due
   dates on its tickets. Yes.

## Not in this change

- A different survey question, or different email wording, per company.
- Different portal branding (logo, colours) per company: the portal shows
  the company's name; the look stays yours.
- A company condition in workflow rules ("only for Acme"). Rules reach a
  company through its departments and categories, as now; part 4 lists them.
