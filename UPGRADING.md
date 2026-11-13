# Upgrading PRISM

Every released version gets a section here. Anything landed on `main` that no
tag covers yet goes under `## Unreleased` at the top, and is folded into the
version section when it is tagged — see RELEASING.md.

To upgrade in place: set `IMAGE_TAG` in `.env` (or leave it at `latest`), then
`docker compose pull && docker compose up -d`. Migrations run automatically on
backend start.

## Unreleased

The PRISM agent for Windows (sub-project 8a) and macOS (8b). Every computer
it's installed on becomes an Asset of its company and keeps its hardware,
OS, disks, network, installed software and usual user current; people at
the computer get **Submit a ticket** in the notification area or the menu
bar, or in the applications list on Linux (8c), with the ticket type, a
category and attachments (see Submit a ticket below).

**Database:** migrations 074 (devices, enrollment keys, installed software,
the `agent` ticket source), 075 (the "Unknown tray user" placeholder
contact), 076 (a checkout's own form, when it was printed, and its signed
copy), 077 (Scan now), 078 (the Manage devices permission's description,
now spelled "enrollment") and 079 (each computer's package format, so a
Linux computer is only offered updates in its own: .deb, .rpm or pacman).
They run on start; nothing to do.

**Scan now:** an agent-managed Asset's page, and each computer on a
company's Devices tab, has **Scan now** (for staff who can edit Assets or
manage devices). The computer sends a fresh inventory at its next check-in,
within 5 minutes. Agents from before this change ignore it until they update
themselves.

**Checkout forms:** after checking equipment out, **Print** the form for the
person to sign there and then, or **Email** it for them to print, sign and
return. In Checkout History, **Upload signed copy** saves the scan or photo to
the checkout and marks the form received; **Create form** makes one for a
checkout that has none. Emailing now always sends the checkout's own form
(before, it sent the asset's first attachment).

**Department follows the assignee:** assigning someone in Edit asset fills in
their department; checking out to a contact, or the agent finding a new
usual user, sets the Asset's department to theirs when they have one.

**Permission:** a new **Manage devices** permission (`devices.manage`), given
to System Administrator only. It lets staff create and revoke enrollment keys,
download the installer and revoke computers. Seeing a company's devices
follows the Assets view permission and company access, as before.

**Installing the agent:**

1. Open a company → **Devices** → **New install key**, then **Show key**
   on its install card. (For one-off installs, the **Install link** is
   simpler; see install keys below.)
2. **Download for Windows (MSI)** on the same tab. The installer is served by
   your PRISM only (staff sign-in) and is never published anywhere else.
3. Install silently:

       msiexec /i prism-agent-<version>-windows-amd64.msi /qn PRISM_URL=https://prism.example.com ENROLL_KEY=pk_enr_...

   - **Group Policy:** a computer startup script running that command
     (Software Installation could only pass the two properties through a
     transform).
   - **Intune:** a Windows app (Win32) wrapping the MSI with that command
     line; detection by the MSI's product code, or the `PRISMAgent` service.

   A wrong or revoked key fails the install. Running the installer again on
   a computer already enrolled with the same PRISM changes nothing. Uninstall
   keeps the enrollment unless `REMOVE_DATA=1` is passed.

**Installing the agent on a Mac** (macOS 13 or later, Apple silicon or
Intel; sub-project 8b):

1. Company → **Devices** → **New install key** (and **Show key**), then the **macOS** tab:
   **Download for Mac** gives one `.pkg` for every Mac.
2. Open the package. The first time on each Mac, macOS stops it because it
   isn't signed with an Apple Developer ID (PRISM has none yet): open
   **System Settings → Privacy & Security**, click **Open Anyway**, then
   open the package again and install it with an administrator's password.
3. In Terminal, run the command the tab shows (copy it when the key is
   created):

       sudo prism-agent enroll --url https://prism.example.com --key pk_enr_...

   (`prism-agent` is a link to
   `/Library/Application Support/PRISM/bin/prism-agent`; use the full path
   if `/usr/local/bin` isn't trusted on that Mac.)

The Mac appears in Assets with its hardware, macOS version, disks,
network, apps and usual user; people get **Submit a ticket…** in the menu
bar. Updates install themselves without asking. Macs are installed by
hand, not by MDM, until there is a Developer ID (an unsigned package can't
be deployed by most MDMs). To remove the agent:
`sudo prism-agent uninstall` (keeps the enrollment, so reinstalling brings
the same device back) or `sudo prism-agent uninstall --remove-data`.

**Installing the agent on Linux** (x86_64 or ARM; Ubuntu 22.04 or later
and Debian, current Fedora and RHEL, Arch; sub-project 8c):

1. Company → **Devices** → **New install key** (and **Show key**), then the **Linux** tab.
   Pick the distribution and download its package (`.deb`, `.rpm` or
   `.pkg.tar.zst`).
2. Install it with the command the tab shows:

       sudo apt install ./prism-agent_<version>_amd64.deb        # Ubuntu, Debian
       sudo dnf install ./prism-agent-<version>.x86_64.rpm       # Fedora, RHEL
       sudo pacman -U prism-agent-<version>-x86_64.pkg.tar.zst   # Arch

3. Enroll it (copy the command when the key is created):

       sudo prism-agent enroll --url https://prism.example.com --key pk_enr_...

The agent runs as the systemd service `prism-agent`. The computer appears in
Assets with its hardware, distribution, disks, network, the software someone
installed (packages marked as explicitly installed, plus Flatpak and Snap
apps) and its usual user; a computer joined with realmd shows its realm.
People get **Submit a ticket** in the applications list, and a tray icon
where the desktop shows one (GNOME needs the AppIndicator extension; Ubuntu
has it). A server without a desktop installs the service alone on Debian and
Ubuntu with `--no-install-recommends`; the Arch package always needs GTK and
WebKitGTK. Updates install themselves through the computer's own package
manager, in its own format. To remove the agent: `sudo apt remove
prism-agent`, `sudo dnf remove prism-agent` or `sudo pacman -R prism-agent`
(keeps the enrollment in `/var/lib/prism-agent`, so reinstalling brings the
same device back); `sudo apt purge prism-agent`, or `sudo rm -rf
/var/lib/prism-agent` after removing it on Fedora or Arch, forgets it too.

**Install keys, install links and push scripts** (sub-project 8d):
enrollment keys are now **install keys** you can copy again whenever you
need one, rather than only once.

- **New install key** asks for a name, an expiry (never, 14 or 30 days, or
  a date) and optionally how many computers it can add. Each key shows how
  many it has added and when it was last used, with **Install**, **Rotate**
  (a new key; the old one, its link and its scripts stop working, and
  computers already enrolled keep working) and **Revoke**.
- **Install** shows the key hidden until **Show key** (logged in the audit
  log), then:
  - **Install link:** `https://<PRISM>/install/<key>`. Anyone who opens it
    gets the download for their system, named so it adds the computer to the
    company by itself: double-click it on Windows, open it on a Mac. On
    Linux the page gives a one-line command. Installing still needs an
    administrator, so on a standard user's computer someone types an
    administrator's name and password when Windows or macOS asks.
  - **Push:** one PowerShell script for **PDQ Deploy**, a **Group Policy**
    startup script, **Intune** or any **RMM**, run as SYSTEM. It installs
    silently and enrolls, and skips computers that already have the agent.
    It comes as a script, a .ps1 download or one command line. For Mac and
    Linux there's `curl -fsSL https://<PRISM>/api/v1/install/<key>/mac.sh
    | sudo sh` (or `linux.sh`) for an RMM, a Mac MDM or SSH.
- Keys made before this keep working, but PRISM never kept a copy of them:
  **Rotate** one to get a key you can copy.
- A link that doesn't work, whether unknown, revoked, expired or used up,
  shows "This install link no longer works". PRISM's nginx keeps install
  paths (which contain the key) out of its access log; a proxy in front of
  PRISM may still log them.

**Database:** migration 083 (each install key's encrypted copy, its limit
and when it was last used). Keys are encrypted with `ENCRYPTION_KEY` (or
`SESSION_SECRET`), like other stored secrets; changing it makes keys
uncopyable until rotated, but they keep enrolling.

**Network:** agents only make outgoing HTTPS requests to `PUBLIC_APP_URL`
(the same address staff use). Nothing connects to the computers; no ports
need opening on them. `PUBLIC_APP_URL` must be reachable from the client
networks, with a certificate those computers trust.

**Code signing:** the installer is unsigned unless the `AGENT_SIGNING_PFX`
(base64 .pfx) and `AGENT_SIGNING_PASSWORD` secrets are set on the repository.
With your own (self-signed) certificate, push it to the computers' **Trusted
Publishers** and **Trusted Root Certification Authorities** stores by Group
Policy or Intune first, so SmartScreen and application control accept it.
Self-updates don't depend on this: each PRISM signs its agent updates with
its own key, which the agents learned at enrollment.

**Updates:** a new PRISM image brings a new agent; enrolled computers are
offered it at their next heartbeat (every 5 minutes) and update themselves.
On Windows, the tray comes back by itself after an update, for everyone
signed in (it used to stay closed until the next sign-in).

**Submit a ticket** (the agent's window) asks:

1. **Ticket type:** **Incident** or **Request**. The ⓘ beside each explains
   it (an incident: something that worked is broken; a request: nothing is
   broken, you need something).
2. **What's it about?** The company's categories for that type, one level
   at a time, with **Other / I'm not sure** at every level (see below).
3. Subject and description, as before.
4. **Attach screenshot or file:** up to 5 files, 10 MB each and 20 MB in
   all. People can also paste a screenshot (Ctrl+V / ⌘V; it's named
   "Screenshot <date and time>") or drop files on the window. Files go
   through the same checks as any ticket attachment (blocked file types,
   content check, the size limit in Settings, the virus scan). The agent
   can only attach them to the ticket it just raised itself (within 30
   minutes, at most 5). If PRISM refuses a file, "Ticket sent" names it.
   While offline, files are kept until the window closes; the text is kept
   as a draft as before.

Agents that haven't updated yet still raise tickets (as requests, category
"not sure").

### Ticket categories per company, for incidents and requests (sub-project 9)

**Each company has its own categories**, never shared:

- The categories you had become your help desk's own company's (Settings →
  Ticket categories). Each client company's are on its page, **Categories**
  tab (same editor). A new company has none until you add them.
- A ticket can only take a category of its own company. Moving a ticket to
  another company (by changing its contact) drops a category of the old one,
  and the change shows in its activity.
- Each top-level category is **For** incidents, requests, or both (the
  default for the ones you had); its sub-categories go with it. An incident
  only takes incident (or both) categories, a request request ones; the
  other types (problem, task, change) take any. Changing a ticket's type
  drops a category of the other type. Set **For** in Settings or on the
  company's Categories tab.
- Company access applies: staff only see and change the categories of the
  companies they can reach. A company with categories can't be deleted
  (merge or deactivate it); merging moves them, suffixing top-level names
  that clash.

**Required, with a way out:**

- The **agent** and the **client portal** ask for a category whenever the
  ticket's company has categories for that type. **Other / I'm not sure**
  answers it at any level (Network → not sure beyond this, or not sure at
  all). The portal's tickets are requests, so it lists request categories
  (and those for both).
- The staff form keeps its own setting (Settings → Ticket categories →
  Require a category on new tickets), now only where the ticket's company
  has categories.
- On the ticket, staff see **Not sure beyond this** or **Raised as Other /
  I'm not sure**; choosing a category settles it. The ticket list's
  **Category not sure** pill lists what still needs one.

**Assets:** with a company picked in the Company filter, the Department
filter offers only that company's departments (the Company filter appears
once you have a client company).

**Database:** migrations 084 (each category's company; the existing ones
move to your own company), 085 (a ticket's "not sure") and 086 (what a
top-level category is for). They run on start; nothing to do.

**API:** `GET /ticket-categories?companyId=` (a number, or `internal`) lists
one company's tree; without it, every category of the companies you can
reach, each with `companyId` and `forType`. `POST /ticket-categories` takes
`companyId` and, for a top-level category, `ticketType` (`incident`,
`request` or `both`). Tickets take `categoryUnsure`, and the list
`?categoryUnsure=true`.

### Checklists and bundles: playbooks, simpler (sub-project PB2)

Playbooks keep working exactly as before; they are now much easier to set
up and use, in plainer words. A **form** is now a **checklist** and a
**playbook** a **bundle** on every screen. Nothing stored is converted, and
tickets in progress are not affected.

- **One place:** Settings › Forms and Settings › Playbooks are now one page,
  **Settings › Checklists** (checklists, then bundles below). The old
  addresses redirect, keeping ids, so bookmarks still work.
- **New checklist** asks two plain questions: what it's for (the ticket or a
  device) and, for a device, what happens when it's finished (nothing, check
  the device out, or check it in). PRISM adds the check-out or check-in as
  the last step.
- **Paste to build:** paste a document and each line becomes a step. Headings
  become sections, "Serial number:" something to write down, "Bypass code:"
  a hidden password/code, a line ending with "?" a yes/no question, and
  lines that start with an MDM or device type ("Jamf Pro: …", "If
  ManageEngine:", "Mac only: …", "iPhone/iPad: …") are set to **Only for**
  them. The preview shows what was made before anything is saved.
- **The editor is the checklist:** type a line for a step, Enter for the
  next. Each line has a toolbar: Required, Only for…, Turn into (yes/no
  question, pick one, write down, password/code, note, agent step), indent
  under a yes/no question (Tab), move, delete. **Only for** replaces "Show
  when" for MDMs and device types, with a sentence that confirms it ("Shows
  for Macs on Jamf Pro"). Other rules stay available as **Advanced rules**.
  **Try it** shows how many steps a device type on an MDM would see.
- **On a ticket, Add checklist** replaces Apply playbook. A checklist can be
  added on its own: a ticket checklist in one click; a device checklist asks
  who it's for and which devices (with "+ Another device"). Checklists added
  on their own appear under **Checklists** in the Tasks tab, and can be
  removed while nothing on them is done.
- **Bundles** are optional and written as a sentence ("It's for a person and
  adds Account termination for the ticket, Apple device check-in for each
  of their Mac, iPhone, iPad devices…"). A bundle can **suggest itself on new
  tickets in a category** (or under it, or moved into it); the "Suggest a
  bundle" workflow action still works for anything more involved.
- **Permissions** keep their keys; their names change to "Manage checklists,
  bundles and MDMs", "Reveal hidden passwords and codes on checklists" and
  "Close tickets with unfinished checklists".

**Database:** migration 082 (the person a checklist added on its own is for,
the categories a bundle suggests itself on, and the permissions' new names).
Checklist conditions gain one device field, `mdm` (the MDM, or `none` when
not managed); export and import carry it by name.

**API:** `POST /tickets/:id/checklists` and `DELETE
/tickets/:id/checklists/:formId`; `POST /forms/try`; the ticket's
`/playbooks/options` also lists checklists and suggested bundles; bundles
take `suggestCategoryIds`. Existing routes are unchanged.

### Sign-in behind an HTTPS proxy, and no more silent login loop

With `COOKIE_SECURE=true`, PRISM issues the session cookie only on a request it
knows was HTTPS. Behind a proxy that handles HTTPS in front of PRISM (Nginx Proxy
Manager, Caddy, a load balancer), PRISM's own nginx used to replace that proxy's
`X-Forwarded-Proto: https` with `http`, and the dev stack ignored the header
anyway, so sign-in appeared to work and then landed on the login page again.

- PRISM's nginx now passes on the `X-Forwarded-Proto` a proxy in front sent (its
  own scheme when there is none, or when PRISM handles HTTPS itself).
- The backend decides the session cookie from that header whatever
  `TRUST_PROXY` says. `TRUST_PROXY` still alone decides whether client IPs in
  `X-Forwarded-For` are believed.
- When the cookie still can't be set, sign-in says so (password and SSO), and
  the backend logs it once.

Rebuild or pull both images (`frontend` and `backend`). Nothing to change in
`.env`.

### Playbooks: forms and checklists on tickets (sub-project PB)

Build your own **forms** (sections of steps, fields and secure values, with
steps that show only for the right device or answer) and group them into
**playbooks**. On a ticket, **Apply playbook** adds the forms as tasks: once
for the ticket, and once per device of the person it's for, or per device
added to the ticket. A form's last step can **check a device out or in** for
real. Settings: **Service desk › Forms** and **Playbooks**, and
**Assets › MDMs**.

**Database:** migrations 080 (MDMs; managed, MDM, cellular, IMEI, phone
number, carrier and hold reason on assets; the Ready to issue and On hold
statuses; forms, playbooks and ticket forms; three permissions) and 081
(starter forms and playbooks). They run on start; nothing to do.

**Starter forms and playbooks:** an install with no forms gets Device
check-out, Device check-in, New account and Account termination forms, and
New account and Account termination playbooks. They name no product or
vendor; copy and edit them for your own process.

**New permissions** (Settings › Roles):
- **Manage forms, playbooks and MDMs** (`settings.manage_playbooks`):
  System Administrator.
- **Reveal secure form values** (`tickets.view_secure_fields`): System
  Administrator and System Technician. Every reveal is logged on the ticket
  and in the audit log, and limited to 20 an hour per person.
- **Close tickets with unfinished forms** (`tickets.override_checklist`):
  System Administrator.
Give them to other roles as you need.

**Closing tickets:** a ticket with an unfinished form (not finished and not
skipped) can no longer be closed, from the ticket page, bulk actions, the
API or a workflow rule. Someone with *Close tickets with unfinished forms*
can close it anyway with a reason, which is logged. A device no form covers
only warns. A workflow rule that tries to close such a ticket records why in
its log. Merging moves the forms to the target ticket.

**Devices:** each asset now says whether it's **managed** and by **which
MDM** (your own list, Settings › Assets › MDMs; an MDM's console address may
contain `{id}` to link to a device), and whether it has **cellular service**
(IMEI with its check digit, phone number, carrier from your vendor
companies). Asset categories can start new devices with cellular on. Two new
statuses: **Ready to issue**, and **On hold**, which needs a reason. The
Assets list filters by managed and cellular, and its search finds a phone
number or IMEI.

**The PRISM agent:** checking a computer in through a form can **revoke its
agent** (needs Manage devices), so installing the agent again for the next
person claims the same Asset rather than making a second one. A check-out
makes the holder hand-set, so the agent's usual-user matching no longer moves
a checked-out device to whoever signs in next. Forms can have steps the agent
ticks itself when the computer reports in.

**Workflow rules:** a new action, **Suggest a playbook**, shows "Suggested:
<playbook> [Apply]" on the ticket. It never applies anything by itself.

### The agent

**Attach on a Mac:** "Attach screenshot or file" now opens the file picker
(as a sheet on the form's window), and the form has Cut, Copy, Paste and
Select All, so a screenshot or text can be pasted into it.

**A fuller health snapshot:** the private note on a ticket raised from the
agent also says, where the computer can tell: whether a restart is pending
(Windows, Linux), the network (Wi-Fi and its name and signal, or wired),
the battery (charge, charger, health), antivirus and whether it's on and up
to date (Windows), and disk encryption (BitLocker, FileVault, LUKS). A line
the computer can't read is left out. Agents from before this send the
shorter snapshot until they update themselves.

**The window opens on a home** (migration 088, `AgentNotices`; it runs on
start). The home shows any notice from the help desk, a **New ticket**
button, and **My open tickets**: every open ticket of the person, wherever
it was raised, each marked Open, Needs your answer (a status that counts
as waiting on the customer) or On hold. Clicking one opens its conversation in the
window, with a box to **reply to the help desk**; the reply lands on the
ticket exactly as one written in the portal does. Private notes are never
shown. The tray menu lists the three most recent tickets too, and "Submit a
ticket" still opens straight on the form.

*Which tickets:* every **open** ticket of the contact the computer's
signed-in user matches (by email), whether it came from the agent, email,
the portal or staff. Closed tickets are in the portal, behind the person's
own sign-in; a closed ticket can't be opened or replied to from the agent.
Someone who matches no contact sees notices and can send tickets, but has
no list. *Know the trade-off:* the agent trusts the computer, not a
password, so someone with administrator rights on an enrolled computer
could ask as another contact of that same company and read that person's
open tickets (never another company's, never a private note).

**Notices:** a company's page has **Assets → Agent notices** (for staff
with Manage devices or the portal permission): a headline, an optional
message and when it comes down (2 hours, end of today, 24 hours, 3 days, or
until taken down). Staff who reach every company can post one to all of
them. Posting and taking down are audited.

**A dot that stays:** while there is a notice the person hasn't seen, or a
help-desk reply they haven't read, the agent's icon carries a dot and the
top of its menu says what's new. It clears when they open it. The agent
checks every 3 minutes, so it can lag a reply by that long.

**Pop-ups:** a new notice or help-desk reply also shows a pop-up by the
agent's icon (Windows: a notification that opens the ticket when clicked;
Mac and Linux: the system's own notification, where the dot and the menu
open it). Each is shown once per sign-in while unread.

**Capture my screen:** the new-ticket form has **Capture my screen**: the
window hides, the whole screen is pictured and attached, and the person can
remove it before sending. Windows needs nothing. A Mac asks the person once
to allow PRISM under Privacy & Security → Screen Recording. Linux uses the
desktop's own screenshot tool (gnome-screenshot, grim, spectacle, scrot or
ImageMagick); with none installed the button isn't shown.

**API:** `GET /agent-notices?companyId=`, `POST /agent-notices`, `DELETE
/agent-notices/:id`. For agents (signed): `GET /agent/v1/tray/home`, `GET
/agent/v1/tray/tickets/:id`, `POST /agent/v1/tray/tickets/:id/reply` (30 an
hour per computer).

### Screens rearranged

Nothing to do when upgrading; this is where things moved.

**Top menu:** eight items. **Clients** holds Companies and Contacts;
**Projects** holds Projects, Workload and Calendar; Assets is as before.

**Dashboard:** a **Needs attention** panel comes first: open tickets with an
SLA breached or at risk, nobody assigned, or a category the person wasn't
sure of, most urgent first, with **Take it** on the unassigned ones. A
technician sees their own and the unassigned ones they can see. The counts
at the top open the Tickets list already filtered. Team Workload lists only
people with an open ticket. The SLA at Risk panel is now off by default
(Customize brings it back); a layout saved before this keeps its panels and
gets Needs attention at the top.

**Tickets list:** a **Requester** column (the contact, and their company
where there are client companies). A technician who hasn't chosen columns
sees Requester, Priority, Status, Category, SLA and Assignee; the others
(Due date, Type, Source, Team, Time logged, Created, Open) are under
**Columns**, which each technician sets for themselves. The choice is kept
with their **account**, so it follows them to any computer or browser
(migration 087, a `UserPreferences` table; it runs on start). Someone who
already chose their columns in a browser keeps them and gains Requester:
the first time that browser opens the list, the choice moves to their
account. The list also opens filtered from an address such as
`/tickets?unassigned=1` (`mine`, `overdue`, `categoryUnsure`, `sla=breached`,
`assignee=<id>`).

**Ticket page:** Status, Priority and Assignee are under the title (they
were in the sidebar), beside the category and the SLA countdown. Five tabs:
**Conversation** (the description opens it), **Tasks**, **Time**, **Files**
and **Details** (resolution, relationships and activity). On a phone the
button that opens the sidebar is **Ticket info**.

**Company page:** five tabs. **Overview** shows open tickets, contacts,
computers and the account manager, and a **Setup** checklist (contacts,
departments, ticket categories, agent installed, email domain, portal
access, account manager, sites); each line opens the place that sets it.
**People** has Contacts, Departments and Sites; **Work** has Tickets and
Projects; **Assets** has Assets, Devices and (for a vendor) Vendor;
**Setup** has Details (the form that was Overview), Categories and
Microsoft 365.

**Contact page:** a contact's **Assigned to** is now called **Account
manager** (the same field; the Contacts list and its filter too). A field
says **Saved** when a change is kept. Recent tickets show their priority,
and the page lists the computers assigned to the contact, with the agent's
state, for staff who can see Assets.

**API:** `GET /companies/:id/glance` (the Overview's figures); `GET
/dashboard` adds `needsAttention`; `GET /contacts/:id` adds `computers`.
`GET`, `PUT` and `DELETE /preferences/tickets.columns` read, save and clear
the signed-in user's own column choice.

## v0.4.0

Phase 1, the foundation: client companies, one work model for tickets and
projects, the SLA engine, the full service desk, attachment virus scanning,
project management and workload, the look A restyle, and the client portal
with Microsoft 365 sign-in and sync.

**Before upgrading:**

1. **Take a database dump** (see `RELEASING.md`). This release runs
   migrations 048 to 073, which add and reshape many tables. Rolling back to
   v0.3.0 afterwards needs that dump.
2. **Pull the new `docker-compose.yml`** for the virus scanner (below).
3. **Set `PUBLIC_APP_URL`** in `.env` to the address people use: portal
   invites, password resets, links in emails and the Microsoft sign-in
   address are built from it.

Everything else is optional. The client portal stays off until it is
switched on, and Microsoft 365 sign-in needs nothing until it is set up.

**Pull the new `docker-compose.yml`.** Attachments are now
virus-scanned, which needs a `clamav` service that the new compose file adds
(and a `clamav_data` volume). With your old compose file, every upload and every
emailed attachment is refused until the scanner exists. The scanner needs about
1.2 GB of RAM (2.4 GB during its daily signature reload); the first start takes a
few minutes to download signatures. To opt out, set `CLAMAV_ENABLED=false` in
`.env`.

### Client portal (7a)

- **A client portal at `/portal`.** Contacts sign in there to raise tickets,
  follow and reply to them, and read the knowledge base. It is **off** until
  an administrator turns it on in **Settings → Client portal**, which also
  shows the address to give your customers.
- **Set `PUBLIC_APP_URL`** in `.env` to the address people use (e.g.
  `https://desk.example.com`): invite, password-reset and "View in the
  portal" links in emails are built from it.
- **Who gets in:** a contact needs **Portal access** (contact page → Support
  portal). **Send portal invite** turns it on and emails a one-time link (72
  hours) to set a password. Making a contact inactive, or switching access
  off, ends their portal session at its next request.
- **Admins and watchers:** on a client company's Departments tab, mark
  **company admins** (see all the company's tickets) and **department
  admins** (see their department's). Contacts can be added as ticket
  **watchers** (same company only); CC'd people still only get emails.
- **New permission `portal.manage` ("Manage portal access")**, given to the
  System Administrator role. Granting access, invites, admins and contact
  watchers need it; give it to other roles in Roles & permissions if wanted.
- **The public Help Center (`/kb`) is gone.** The knowledge base is now read
  in the portal, signed in; `/kb` forwards there. Articles that were "End
  users" are now **Portal, all companies**; an article can instead be limited
  to chosen companies or departments.
- Ticket emails to a contact who can see the ticket in the portal gain a
  **View this request in the portal** link (people CC'd who can't see it get
  a copy without it).
- In the portal, contacts see public replies and the files customers sent
  (portal uploads and emailed attachments); files staff upload on a ticket
  stay staff-only.
- **Make contact** on a user's page (Settings → Users) copies that staff
  member into Contacts (your own company, same department), so tickets can be
  raised for them and they can be invited to the portal. It's a one-time
  copy; if a contact already has their email, the button opens that one.
- Migration 072 adds the tables and columns; it runs on backend start.

### Client portal: Microsoft 365 (7b)

- **Contacts sign in with their work Microsoft account.** A company linked
  to its Microsoft 365 tenant has its people sign in to the portal with
  **Sign in with Microsoft**. Only members of the company's chosen **sync
  groups** get in. Someone new gets a contact in that company with portal
  access on, and an existing contact with the same email is linked instead.
  An email that belongs to another company's contact is refused, and nothing
  is moved. Staff in the groups get a contact too; their staff account is
  untouched.
- **Set up the Microsoft app once** (an Owner does this, in **Settings →
  Client portal**):
  1. In the Microsoft Entra admin center (your own tenant): **App
     registrations → New registration**. Supported account types:
     **Accounts in any organizational directory (multitenant)**. Redirect URI:
     platform **Web**, the **Redirect address** shown in Settings
     (`<PUBLIC_APP_URL>/api/v1/portal/auth/microsoft/callback`, so set
     `PUBLIC_APP_URL` first).
  2. **API permissions → Add a permission → Microsoft Graph → Application
     permissions:** `User.Read.All` and `GroupMember.Read.All`. Sign-in
     itself uses the delegated `openid`, `profile` and `email`. Everything
     PRISM reads is read-only.
  3. **Certificates & secrets → New client secret.** Paste the
     **Application (client) ID** and the secret's **Value** into Settings.
     The secret is stored encrypted and never shown again; note its expiry
     date and replace it before then.
- **Per company** (company page → **Microsoft 365** tab, needs **Manage
  portal access**): enter the **tenant ID**, then **Approve PRISM for this
  tenant**, which a Microsoft 365 admin of that tenant must do once (admin
  consent). Then search and add the **sync groups**. A tenant can be linked
  to only one company, including your own organization.
- **The sync** runs every night after 02:00 (your organization's time
  zone), and on **Sync now**. It only touches existing contacts: it links
  them (by AD object GUID or email), updates name, email, phone, job title
  and department, and makes people **inactive** when they're disabled in
  Microsoft 365 or no longer in a sync group. It never creates or deletes
  contacts, and if a group can't be read (approval withdrawn, an outage) it
  makes nobody inactive. The last sync's numbers and errors show on the tab.
- **Detected departments:** department names from Microsoft 365 that match
  no department of the company are listed on the tab with a people count.
  **Create department** or **Map** each one; its people get that department
  at once and on every sync. Microsoft 365 then wins over a department set
  by hand.
- **Every 15 minutes** a Microsoft portal session is checked with Microsoft
  again: someone disabled or removed from the groups is signed out and made
  inactive. If Microsoft can't be reached, the session carries on and the
  check is retried a minute later.
- **Password sign-in is off for Microsoft-linked contacts.** Linking clears
  any password, and invites and reset links aren't offered.
- **Test** in Settings signs the app in to a linked tenant, to check the
  client ID and secret.
- Migration 073 adds the tenant link, the contacts' Microsoft identity and
  the detected-departments table; it runs on backend start.

### The rest of PRISM in look A (6b)

- **Every remaining screen now uses look A**: tickets, the dashboard, assets,
  licenses and contracts, contacts, companies, Knowledge and the public Help
  Center, reports, Settings, sign in and change password. No fields, buttons
  or permissions were removed.
- **Phone changes (behaviour):** on a ticket, Link ticket, Merge and Generate
  report are in a "⋯" menu and the reply box starts as one line until tapped.
  Assets, Knowledge and Reports put their filters behind a **Filters** button;
  Knowledge categories and report date ranges become a sideways row of pills.
- **New ticket** groups its fields under "The problem", "Who it's for" and
  "Who's on it" (same fields, same required ones; tab order follows the
  groups).
- Detail pages use a breadcrumb ("Assets / LT-0014") instead of "← Back to …";
  the Users list shows the username under the name; the sign-in page drops the
  animated console for the Company profile tagline and bullet points.
- Error and status boxes on older pages now follow dark mode.
- **Workload: Assign… (new).** Every item you may move has an "Assign…"
  button that picks a person and a day, so work can be handed out by touch or
  keyboard as well as by dragging. It follows the same rules as a drag.
- **Fixed:** loading or refreshing the Assets page directly (`/assets`) no
  longer redirects to an error, and JavaScript and CSS files now carry the
  same security headers as the rest of the app (`nosniff` and the others were
  missing on them).

### Editing a ticket's title and description

- **The ticket page shows the description again**, at the top of the
  Conversation tab, and anyone who can edit the ticket can change it there or
  change the title (pencil next to it; Enter saves, Esc cancels). Both edits
  show in the ticket's Activity tab. The page rebuild had lost both.
- A title over 255 characters is now refused with a clear message instead of a
  server error.

### Dates follow the company time zone

- **"Today" is the company's today everywhere.** Overdue flags and filters,
  "due soon", expiring warranties, licences and contracts, the dashboard's
  "this week", report presets ("This month" and so on), report chart buckets
  and CSV date columns now all use Settings → Company → time zone. Before, some
  used the UTC date, which is already tomorrow during a US evening, and some used
  the browser's zone. Set the company time zone if it is still UTC.

### Project management (6)

- Three migrations (069 to 071) run automatically. If you run them by hand:
  `npm run migrate`.
- **Phases, milestones and dependencies.** Projects get phases, milestones and
  task start dates. A task can wait on another task (finish-to-start); it shows
  "waiting on", and moving a task offers to move the tasks that depend on it.
  A new Timeline tab shows it all on a calendar.
- **Helpers and person-hours.** Tasks can have helpers. Time is counted in
  person-hours: 1 hour each by two people is 2 hours on the task, the phase and
  the budget. Someone added as a helper on a task becomes a project helper:
  they can view the project and log time, but not edit it. Removing their last
  helper task removes that access (their time stays). A manager can make a
  helper a full member on the People tab.
- **Who can edit a project (behaviour change).** A project's lead and its
  members can edit it, and add files, whatever their role. Before, they also
  needed "Edit own projects", which the seeded Department Staff role doesn't
  have. Department-wide editing (Department Manager) and system-wide editing
  are unchanged. Adding files now needs edit access too: helpers, and staff who
  can only view a project, can no longer upload to it. "Edit own projects" no
  longer adds anything on its own.
- **Hour budgets.** A project can have an hour budget. The lead gets an alert at
  80% and at 100%, in PRISM and by email. The budget emails and the "task added"
  email are on by default; the "task unblocked" email is off by default. If you
  saved a notification allow-list, the four new types are added to it for you.
- **Project templates.** Build them under Settings → Projects → Project
  templates. You can copy a project, or save one as a template (task titles and
  descriptions are kept).
- **Workload screen** (top bar). It shows tickets and project tasks by person
  and day. Drag work to dispatch it. A ticket gets a "planned date" for this;
  the SLA due date never moves. Set each person's hours under Settings →
  Workload → Hours people work (default 8 hours Monday to Friday). Weekend hours
  can be stored, but Workload shows Monday to Friday only.
- **Holidays moved** from "Hours & SLAs" to the Workload group in Settings. It is
  the same page, and the SLA clock still uses it.
- **New permissions.** Manage project templates (`projects.manage_templates`) is
  granted to System Administrator only. View workload (`workload.view`) is
  granted to every role that had View all tickets or View all projects. Add
  either to other roles under Roles.
- **Look A.** The project and workload screens have PRISM's new look. This adds
  the Instrument Sans font as a new frontend dependency
  (`@fontsource/instrument-sans`), so **rebuild the frontend image**. Dark is now
  the default theme for anyone who never picked one; a stored choice is kept.
- **Known limits.** Dispatching on Workload needs a mouse (no touch or keyboard
  yet). The rest of PRISM gets the new colours and font but is restyled
  properly in 6b.

### Ticket categories (5c)

- **Settings → Ticket categories** builds a category tree up to 5 levels deep.
  Tickets get a cascading category picker (create form, ticket sidebar, bulk
  edit, recurring tickets). A category can require a sub-category; retiring one
  hides it (and everything under it) from pickers while tickets keep it.
- An optional switch requires a category on the staff create form; tickets
  from email and recurring tickets may still be uncategorized.
- Custom fields can be limited to category branches; the ticket list filters
  by category (including sub-categories); workflow rules get "category is /
  is under" conditions; the custom report builder gets a Category column and
  grouping.
- Migration 068 runs automatically. The new permission **Manage ticket
  categories** is granted to System Administrator only — add it to other roles
  under Roles if they should edit the tree. Everyone can read it.

### Attachment virus scanning (5d)

- Every file uploaded to tickets, projects, assets, licenses, contracts, the
  Knowledge Base and branding, and every email attachment, is scanned with
  ClamAV before it is stored. An infected file is refused ("Upload blocked: a
  virus was detected"); if the scanner is down, uploads are refused too.
- Inbound email: the ticket is still created; infected or unscanned attachments
  are left off and listed in a private note.
- Users holding *Manage system settings* get a notification when a virus is
  blocked or the scanner goes down (these can't be switched off). The scanner's
  state is shown under **Settings → System info**.

### Service desk: desk tools (5b)

- **Team queues.** The ticket list has a queue view: unassigned, open
  tickets in your teams first, then by SLA due time. The nav badge counts
  them, and **Take it** assigns a ticket to you.
- **Canned responses** (Settings → Canned responses) are reusable replies
  with placeholders such as `{{contact.firstName}}`, inserted from the reply
  box. Everyone keeps personal ones; the new permission **Manage shared
  canned responses** creates team-wide and everyone-wide ones.
- **Bulk actions** run on the server, one result per ticket: status,
  priority, reassign, team, close, add watcher, merge and delete. Each
  ticket is checked and logged like a single edit.
- **Merge and split.** Merge moves comments, files, time and tasks into one
  ticket and closes the others with a pointer. Split moves one message
  (with its attachments) into a new ticket.
- **Recurring tickets** (Settings → Recurring tickets) create a ticket, with
  tasks, on a daily, weekly, monthly or yearly schedule. A rule runs as
  the person who saved it. If that person can no longer create the ticket,
  the rule pauses and says why. Needs the new permission **Manage recurring
  tickets**.
- Both new permissions are granted to System Administrator only. Add them to
  other roles under Roles as needed. Staff can now also pick **Email** as a
  ticket's source by hand.

### Time waiting on the customer

- Each status has a **Counts as waiting on the customer** switch
  (Settings → Statuses), on for Waiting on User. Time spent in those
  statuses shows on the ticket page and PDF, as two Ticket Volume columns,
  and in a new **Waiting on Customer** report (by technician, company and
  period, with a closed-only filter and CSV). It is worked out from the
  status history, so older tickets are covered too. SLA times are unchanged.

### Service desk: email (5a)

- **Branded HTML email from editable templates.** Every email PRISM sends
  (auto-reply, technician replies, the satisfaction survey, and the new
  "resolved" and staff emails) now has an HTML and a plain-text part, with your
  organization name and logo. Edit them under **Settings → Email templates**:
  subject, body, placeholders such as `{{ticket.number}}`, a live preview, and
  Reset to default. Each email can be switched off.
- **"Your request is resolved" email:** new, and **off by default**. When on,
  it is sent whenever a ticket moves into any closed status.
- **CC lists.** Each ticket has a CC list (ticket sidebar) that gets every
  public reply. People who can edit the ticket manage it; Cc addresses on
  an email that opens a ticket are added automatically. A reply can add
  one-off Cc/Bcc ("Cc/Bcc" under the reply box). Bcc never shows in To/Cc.
- **Email signatures.** Technicians set theirs in Preferences; it is added to
  replies emailed to contacts.
- **Technician email notifications.** Assignments, comments, SLA warnings and
  breaches, watched-ticket updates and the new **"New in team queue"** event
  (a ticket arrives in a team unassigned) can email the technician. Admins set
  the defaults in Settings → Notifications; each person can change theirs
  in Preferences. Emails are only sent when outgoing email is set up.
- **Replies from technicians' own mailboxes are captured.** If a technician
  CCs the helpdesk mailbox with `#123` or `[Ticket #00123]` in the subject,
  the email is added to ticket 123 as their reply (marked "via email") and is
  not sent again. (A bare `#123` only counts for the ticket's own customer
  or CC list, since numbers like "Invoice #123" match tickets by chance.)
  Without a number it opens a new ticket for the customer, assigned to the
  technician, and the customer's reply-all threads back onto it. This is
  trusted only when **your mail server**, named under Settings → Incoming
  email → **Trusted mail server** (e.g. `mx.google.com`), says DMARC
  passed. **Set it, or technicians' mail is always kept as a private
  "Unverified sender" note** (attachments not saved). Microsoft 365 internal
  mail is accepted without it when the helpdesk mailbox is on Microsoft 365.
- **Only administrators who can edit users can change a user's email
  address** now, because the address decides who counts as staff on
  incoming mail.
- **Replies from CC'd people** are now added to the ticket. Before, they
  opened a new ticket.

### Ticket statuses reworked

Statuses now have an **On hold** kind next to Open and Closed. On-hold
tickets still count as open: the SLA keeps running and they stay in open
lists. The seeded statuses change on upgrade:

| Before | After |
|---|---|
| Open | Open |
| In Progress | Open |
| Pending | On Hold (on hold) |
| On Hold | On Hold (on hold) |
| Resolved | Request completed |
| Closed | Closed |
| — | Waiting on User, User responded (open); Postponed (on hold); Request cancelled (closed) |

Tickets and workflow rules follow their status; statuses you created
yourself are left alone. **Check saved ticket filters or report views that
name In Progress, Pending or Resolved.**

- **User responded** is set automatically when a customer emails a reply to
  an open or on-hold ticket. It can't be picked by hand. A reply to a closed
  ticket leaves it closed and notifies the assignee.
- **Waiting on User** is set automatically when a technician posts a public
  reply on a User responded ticket, and can also be picked by hand.
- The ticket list has an "On hold (all)" filter, and the dashboard's "In
  Progress" count is now "On hold".

### SLA engine

Tickets now have SLA clocks: how long they sit **unassigned**, time to
**first response**, and time to **resolution**. The resolution target sets
the ticket's **due date** when the ticket is created. Nothing pauses the
clocks, and technicians can only extend a due date, with a reason.

- **Targets are per ticket type and priority**, for example Incident/High
  resolved within 4 hours, Request/Low within 20 days. Hours count business
  hours; days count business days (same time of day). Each target is
  optional.
- **Your SLA settings carry over.** The per-priority response and
  resolution targets become a policy called **Standard**, the default, and
  are copied to every ticket type. It uses your global business-hours
  schedule if you have one, otherwise it counts every hour (24×7). Review
  the targets per type in Settings → SLAs.
- **Policies per customer company.** Settings → SLAs holds named policies
  (schedule, warning point, targets); put a company on a policy there.
  Companies without one use the default.
- **Due dates come from the SLA.** On a ticket with a resolution target the
  due date is set automatically and can only be moved with **Extend due
  date** (later, with a reason). Every change is kept and shown on the
  ticket. Moving a due date earlier, or without a reason, needs the new
  permission **Adjust SLA due dates** (System Administrators have it).
  Tickets whose type and priority have no resolution target keep a manual
  due date as before.
- **No pausing.** Status changes don't stop the clock; reopening a ticket
  keeps its original due date. Changing a ticket's priority, type or
  company later doesn't move its SLA dates.
- **Only tickets created after the upgrade get clocks.** Older tickets show
  "No SLA" rather than all showing as breached.
- **First response** is the first reply or public comment a staff member
  posts on the ticket. Private notes, status changes and a customer's own
  emailed reply don't count.
- New: an SLA badge and "SLA breached" / "SLA at risk" filters in the ticket
  list, an SLA panel on the ticket page, an "SLA at Risk" dashboard panel,
  and "SLA at risk" / "SLA breached" notifications to the assignee (or the
  ticket's team while it's unassigned).
- Workflow rules gain the triggers **SLA at risk** and **SLA breached**
  (for any clock or one of them) and the action **Set SLA policy**. A
  rule's **Set due date** on an SLA ticket is recorded as an adjustment.
- **Changed report:** the SLA compliance report now reads the SLA clocks:
  per-clock % on time, % that met the original SLA vs the (extended) due
  date, breaches, and every due date change with its reason.
- **Changed API:** `/sla-policies` is policy-based (`GET/POST`,
  `GET/PATCH/DELETE /:id`, `POST /:id/default`) and targets carry
  `ticketType` and a unit; the old `PATCH /sla-policies/:priority` is gone.
  Ticket responses carry `sla`; `GET /tickets` takes `?sla=breached|at_risk`;
  `POST /tickets/:id/due-date` moves an SLA due date, and `PATCH /tickets/:id`
  refuses `dueDate` on an SLA ticket (`400`).
- If you saved the notification types setting before, the two new SLA types
  are switched on for you.

### Client companies

Upgrading creates one company for your organization and puts every existing
department, contact, ticket, project, asset, license and contract under it.
Free-text vendor names on assets, licenses, contracts and project materials
become vendor companies (the original text is kept for one more release).
Until you add a client company, nothing behaves differently.

Once you add a client company, PRISM shows a Companies tab, company pickers
on contacts, tickets, projects and assets, and company filters on lists and
reports. Settings → Companies is always there, also for managing vendors.

- Assignees and watchers must be able to see a ticket's company. **Changed
  response:** assigning one who can't returns `400 VALIDATION_ERROR`.
- A new ticket without a department now takes its contact's department.
- A company can't stop being a client while it still has contacts, tickets
  or other records (`409 COMPANY_IN_USE`).
- The CSV contact import takes an optional "Company" column.
- Old free-text vendor columns stay for one more release; vendor companies
  now fill them.

### One work model, part 1: tasks and the time ledger

- **Data move.** Ticket checklist items, project tasks and project subtasks are
  now one `Tasks` table, and ticket time and project time one `TimeEntries`
  ledger. The migration copies everything; the old tables are kept, renamed
  `legacy_*`, for one release and are dropped by the next release's first
  migration. Rolling the migration back works until something exists that the
  old tables can't hold (for example, a subtask on a ticket task); it then
  refuses with a list.
- **Ticket tasks are real tasks:** statuses (To do, In progress, Done),
  subtasks, codes (`#00012-T01`), reorder and renumber, the same as project
  tasks.
- **New permissions:**
  - `time.log` lets you log your own time. It's granted to every role that
    could log time before (`projects.log_time` or any ticket edit permission),
    and per-user overrides carry across: anyone who could log time keeps it,
    anyone who couldn't doesn't gain it. Logging your own time needs view
    access to the ticket or project; `projects.log_time` is gone (part 2).
  - `time.manage_others` lets you log, edit and delete time for other people.
    It's granted to the seeded System Administrator and Department Manager
    roles. A team lead
    without it may do so for members of their own teams only. The legacy
    `admin` user role no longer decides this.
- **API field names (API-key users):**
  - Tasks use `title`, `statusId` (from `GET /task-statuses?scope=ticket|project`),
    `assigneeId`, `dueDate`, `estimateMinutes`, `parentTaskId` and `code`. A
    ticket task's old `description`/`completed` fields and a project task's
    `assignedToUserId`/`taskCode`/`subtaskCode` are gone.
  - Time takes `durationMinutes` **or** `startTime` + `endTime`, plus
    `entryDate`, `note`, `taskId`, `workTypeId` (from `GET /work-types`),
    `billable` and `userId` (who it's for). The old `minutes`, `description`
    and `loggedForUserId` are not read.
  - Time responses carry `user` (who it's for) and `loggedBy` (who entered it).
    Time lists return `totalSeconds` and `totalLaborCost`. Ticket time can now
    be edited (`PATCH /tickets/:id/time/:entryId`).
  - The project subtask URLs (`/projects/:id/tasks/:taskId/subtasks…`) still
    work for this release.
- **Time zone.** "Today" for a work date, a timer's work date and report date
  ranges now follow Settings → Company → time zone (`company.timezone`,
  default UTC), not the server's.
- **Reports.** Time is dated and filtered by its work date. Team performance
  and the dashboard count project time too. Project cost includes labour
  everywhere. The dashboard's hours cover all seven days of the week.
- **Deletes.** Deleting a ticket deletes its tasks and time, as before.
  Deleting a user keeps their time in the ledger; it used to delete their
  ticket time.

### One work model, part 2: who may change what

- **The edit tier.** Changing a ticket's or project's own data now checks the
  edit permission against that record, as the permission names say. That
  covers its fields, tasks, links, custom field values, members, expenses,
  materials, and deleting it:
  - `tickets.edit_own` means tickets assigned to you, `edit_department` your
    department's (or assigned to you), and `edit_all` any you can see.
  - `projects.edit_own` means projects you belong to or lead,
    `edit_department` your department's, and `edit_all` any you can see.
  - Commenting, attachments, project files, watchers and your own time are
    not checked against the record's edit tier: they keep the permission
    they needed before (for example any ticket edit permission to attach a
    file, `tickets.manage_watchers` for watchers), plus view access. Your
    own time needs only `time.log` and view access.
  - Recording a customer's satisfaction rating on a ticket needs the edit
    tier, since it replaces the ticket's rating.
  - Choosing a project's lead, or naming someone else as lead or member when
    creating a project, needs `projects.manage_members`. Adding a member as
    "lead" makes them the project's lead.
  - Deleting also needs `tickets.delete` / `projects.delete`, as before.
- **Seeded roles.**
  - System Technician is granted `tickets.edit_all` and `projects.edit_all`, so
    it edits everything it could before. It still can't edit or delete other
    people's comments, attachments or project files.
  - **Department Staff** can now edit only tickets assigned to them. They can
    still see, comment on and log time on the rest of their department's.
- **Logging your own time** needs `time.log` and view access to the ticket or
  project, so you can log time on a ticket you helped with. **`projects.log_time`
  is removed**; every role that had it has `time.log`.
- **Linked tickets you can't open** show as "Restricted ticket" (id only) in a
  ticket's links and on a project task.
- **Moderating** (editing or deleting someone else's comment or attachment,
  deleting someone else's project file) is now its own permission:
  `tickets.moderate` / `projects.moderate`, together with `edit_all`, or
  `edit_department` for your own department. Every role and user who could
  moderate before keeps it (System Administrator and Department Manager among
  the seeded roles); System Technician doesn't.
- **Deleting a project** now deletes its tasks, time, expenses, materials,
  files (also on disk), members and activity, and stops any timer running on
  it. It used to leave them behind.
- **Project files** can be deleted by the person who uploaded them or a
  project moderator.
- **Task statuses and work types are editable** through the API:
  - `POST/PATCH/DELETE /task-statuses` and `PUT /task-statuses/reorder` need
    `settings.manage_statuses`;
  - `POST/PATCH/DELETE /work-types` need `settings.manage_system`;
  - the Settings screens come in the next update.
- **Smaller fixes:**
  - Custom field values must fit the field (a number, a real date, one of the
    options). **Changed response:** `400 "<label>" doesn't accept that value`.
  - Ticket and project statuses must exist (`400 Unknown ticket status`).
  - A blank title or name is refused on edit, as on create.
  - A new project lead becomes a member with the lead role; the old lead stays
    a member. The lead, and members named when creating a project, must be
    active users who can work for the project's company.
  - The "escalate" workflow action sets priority to critical (it used to fail
    every time).
  - A ticket created already closed obeys "require time before close".
  - Two tickets can be linked only once, whichever direction.
  - Clearing a ticket's due date always clears its due time.
  - Expense and material edits check their values, as creating them does.
  - Watchers, custom field values, expenses, materials, members and project
    files are now in the audit log.
- **Rolling back** this part's migration takes `tickets.edit_all` and
  `projects.edit_all` back from System Technician, even if you had granted them
  yourself before upgrading, and gives `projects.log_time` back to every role
  with `time.log`. Per-user overrides of `projects.log_time` are not restored.

### One work model, part 3: the screens

- **Timers, on the server.**
  - Tickets, projects and individual tasks and subtasks use timers kept on the server (several per person: see "Several timers" below).
  - It follows you between devices and tabs, pauses and resumes, and shows in the top bar on every page.
  - Stopping it opens the Log time form, with "Keep timing" and "Discard".
  - Automatic mode, the minimum-time warning and the prompt before logging still work.
  - **Before upgrading**, stop and log any timer that is running on a ticket page: the old timer lived only in the browser and is not carried over.
- **Switching the timer** on one ticket or project from the ticket (or a task) to a subtask logs the time so far where it was worked, then starts fresh on the subtask. So the ticket's total is all of its time, and each subtask's total is how long that subtask took.
- **Ticket tasks** work like project tasks: a checklist that expands to status, priority, assignee, due date, estimate, subtasks, and time and a timer per task and subtask.
- **Log time** asks for a work type and whether it is billable, can be logged against a task or subtask, and can be edited afterwards. The Time Entries tab starts with a **Time by task** breakdown.
- **Settings:**
  - Statuses has Ticket tasks and Project tasks tabs.
  - Work types is new.
  - The role editor now shows every permission category. Time, Companies, Assets and Knowledge base permissions were missing from it before.
- **Read-only screens.** Ticket and project pages show only what you may change. A ticket you can see but not edit says "View only".

### Several timers, reminders and the longest entry

- **Several timers at once.** Each ticket or project can have its own timer, so
  timers on different items count at the same time (for work that runs in
  parallel). On the same ticket or project, starting a timer on another of its
  tasks still logs the current one first, so one piece of work isn't counted
  twice. At most 20 timers each.
- **My timers.** The top-bar timer shows how many timers are running and opens
  a list of all of them, running or paused, with Pause/Resume, Stop and log,
  Discard, and a link to each ticket or project. The ticket page's "timer
  running on another item" banner is gone.
- **Reminders.** A timer that has run 2 hours gets a "Still working on these?"
  popup, then one every hour, with Keep going, Pause and Stop and log. It is
  also a desktop notification when the browser allows one. Each person sets
  the timing, or turns reminders off, in Preferences. Reminders need a PRISM
  tab open.
- **Longest entry.** No time entry can be longer than 12 hours. Administrators
  can set 1 to 24 hours in Settings → Time Tracking. A timer stops counting
  at the limit and shows it, and its Log time form asks for the time to be
  corrected. Existing longer entries are kept until their time is edited.
  **Changed response:** a longer entry returns `400 VALIDATION_ERROR`.
- **Automatic mode** now starts the opened ticket's timer whenever that ticket
  has none, whatever runs elsewhere. Moving straight from one ticket to
  another now starts the second ticket's timer.
- **Timer API (breaking for API users):**
  - `GET /timer` returns `{ timers: [...], limitSeconds }`, newest first.
  - Each timer is acted on by id: `POST /timer/:timerId/pause`, `/resume` and
    `/stop`, and `DELETE /timer/:timerId`. These replace `POST /timer/pause`,
    `/resume` and `/stop` and `DELETE /timer`. A timer already logged
    elsewhere, or someone else's, returns `409 TIMER_CHANGED`.
  - `POST /timer/start` takes `onlyIfNone` (in place of `onlyIfIdle`). It
    returns `400 TOO_MANY_TIMERS` past 20 timers.
  - Each timer carries `atLimit` and `limitSeconds`. Resuming one at the limit
    returns `400 TIMER_AT_LIMIT`.
  - `PATCH /users/:id/preferences` takes `timerReminderMinutes` (0 to 1440;
    0 turns reminders off) and `timerReminderRepeatMinutes` (15 to 1440).
- **Rolling back** this release keeps each person's newest timer and removes
  the others without logging them.

### Settings cleanup

Settings that did nothing, or did the same job as another, are gone:

- **Removed settings:** Company profile's support email, date format, time
  format and language. Nothing in PRISM used them. They were saved but never
  shown, sent or applied. Their stored values are deleted.
- **One organization name.** The name on Company profile is also your own
  company's name under Companies & vendors. Renaming either renames both. The
  upgrade sets your company record to the Company profile name. **Changed
  response:** saving a blank organization name returns `400
  VALIDATION_ERROR`, and another active company's name returns `409
  COMPANY_NAME_TAKEN`.
- **Assignment rules are now workflow rules.** Workflow rules already did
  everything assignment rules did. Each assignment rule is converted
  automatically into a workflow rule on "Ticket created". The converted rules
  run before your other rules, apply only while a ticket has no assignee and
  no team, and keep their order, so the first match still wins. The
  Assignment rules page and `/assignment-rules` API are removed. The old
  address opens Workflow rules.
- **Workflow department conditions** now pick a department, not a
  department name. Department names can repeat across client companies, so a
  rule for one company's "IT" no longer fires for another company's "IT".
  Existing conditions are converted where the name is unique. Others keep
  working by name and say "(by name)" in the editor.
- **Workflow assignments notify the assignee**, just as assigning by hand
  does.
- **Modules & tabs is removed.** The top-bar tabs follow each person's
  permissions. Before, the old Admin/Technician role could also hide a tab
  from someone who had permission for it. The page and the `/modules` API are
  removed.
- **Rolling back** this release brings back empty Assignment rules and
  Modules & tabs tables. Converted rules stay workflow rules.

### Settings, reorganized

- **One menu.** Settings has its own menu down the left, with a search box
  that finds a page by name, description or common words ("password",
  "logo", "time zone"). On screens under 768px wide the menu is behind a
  "Settings" button. Every Settings page shares one layout: a breadcrumb,
  the title and a short description. The "Back to Settings" links are gone.
- **Settings home** lists every group you can open. Owners also see whether
  the directory, incoming and outgoing email and single sign-on are set up.
- **New groups:** You; Organization; People & access; Service desk; Hours &
  SLAs; Time & work; Assets; Sign-in & email (owners); System. Who may open
  each page has not changed. (Assignment rules and Modules & tabs were later
  removed: see "Settings cleanup".)
- **Company profile** replaces Company and Branding, so the name, logo and
  time zone are each set in one place. `/settings/branding` opens it.
- **General Settings is split** into Directory (AD/LDAP), Incoming email,
  Outgoing email and System info (upload limit, database and app). The time
  zone is set on Company profile only. `/admin/settings` opens Settings.
- **Save bars.** Company profile, Time tracking, Expiry alerts, Customer
  happiness, Notifications and System info say "Unsaved changes" until you
  save.
- Email templates, Macros, Supervisor rules and Recycle bin, which were
  "coming soon" pages, are hidden until they are built. Their addresses open
  Settings.
- **New:** `GET /settings/status` (owners only) reports whether those
  services are set up, as true/false values and counts.

### Owners

An **owner** mark on a System Administrator's account keeps a single System
Administrator from taking the system over. It's a mark on the account, not a
role.

- **The owner** (a crown next to the name): there is exactly one, and it must
  be a local account. A dedicated service account (for example `prism-owner`,
  with its password in your password vault) is best, so ownership doesn't
  leave with a person. The Users page suggests this when the owner is a
  personal account.
- **Secondary owners** (a star): any number. The owner marks and unmarks them
  on a System Administrator's page. They can do everything the owner can,
  including resetting the owner's password, except marking owners and handing
  ownership on.
- **Who is the owner after upgrading:** the oldest active local administrator
  account that has been used. An account still on the default password
  (`changeme`), or still due its first password change, is skipped unless no
  other exists. On a new install, the setup account is the owner and must
  change its password at first sign-in. **Confirm the owner right after
  upgrading** under Settings → Users.
- **Owners (the owner and secondary owners) have every permission, whatever an
  override says, and reach every company.**
- **Only owners can:**
  - make someone a System Administrator, or remove that;
  - change an administrator's account: their roles, permission overrides,
    company access, password, profile, or delete it;
  - change the sign-in, mail and integration settings: single sign-on
    (including its role mappings), Active Directory / LDAP, directory sync
    (including its group-to-role mappings), inbound and outbound email, the
    email log, and the calendar integration settings.
- **System Administrators** keep everything else: every other setting, and the
  roles and accounts below them. They can't make owners.
- **Handing over ownership:** the owner opens the new owner's page (an active
  local System Administrator), chooses "Hand ownership to …" and confirms with
  their own password. The former owner stays a System Administrator, without
  owner powers.
- **The owner's account can't be deleted or lose System Administrator.** A
  secondary owner keeps System Administrator until the owner removes their
  mark. As before, nobody changes their own roles or permission overrides.
- **If the owner's account is lost**, run this on the server:

  ```
  docker compose exec backend npm run owner:transfer -- <username>
  ```

  Ownership moves to that local, active account, which becomes a System
  Administrator if it isn't one. The move is recorded in the audit log.
- **System Administrator is never given automatically:**
  - a department's default role can't be System Administrator;
  - single sign-on can't grant it, by group mapping or as a provider's default.
    Mappings to it made before this update are ignored at sign-in.
- **API:** `GET /auth/me` and the user endpoints return `ownerLevel`
  (`"owner"`, `"secondary"` or `null`), and `GET /auth/me` returns `isOwner`
  for owner powers. `PUT /users/:id/owner` with `{ "secondary": true|false }`
  marks or unmarks a secondary owner, and `POST /users/:id/owner/transfer` with
  `{ "password" }` hands ownership on. Both are for the owner only.

### New accounts and usernames

- **New account form:** Settings → Users → New Local Account now takes the
  person's name, their role, and optional permission overrides. The role list
  shows only the roles you can give. The account, its role and its overrides
  are created together: if any of them is refused, no account is made.
- **Changing a username:** a local account's username can be changed on its
  Profile tab by anyone who can edit users. Only an Owner can change an
  administrator's username. An Owner can change their own, for example away
  from `admin`. The person stays signed in. Directory and single sign-on
  accounts keep the username their provider gives them.
- **Username rules for new and changed usernames:** 3 to 64 letters, numbers,
  dots, dashes and underscores, and no `@`. Existing usernames are not
  touched. **Changed response:** `POST /users` with any other username returns
  `400 INVALID_USERNAME`.
- `GET /roles?grantable=1` marks each role with whether you may give it, and
  `GET /users` marks administrators with `administrator: true`.
- Signing in looks for a matching username before a matching email.
- **Email addresses on local accounts:** two local accounts can't share an
  email address (case ignored). **Changed response:** creating or editing a
  local account with another local account's email returns
  `409 EMAIL_TAKEN`. Where older accounts already share one, signing in with
  that email is refused; those people sign in with their username. Directory
  and single sign-on accounts aren't checked.

### An account's main role and admin marker follow its roles

- **Fix:** removing an account's main role (for example System Administrator
  from an Owner) left it with no main role, and the Users page showed none.
  The best role the account still holds now becomes its main role: System
  Administrator first, then its oldest role. The department's default
  role is given only when no other role is left.
- **Security fix:** assigning or removing System Administrator on the Roles &
  Permissions tab didn't update the account's older "admin" marker.
  Older checks still read it: deleting users, teams, modules, everyone's API
  keys, and reaching every company. An account demoted there kept those
  powers. The marker is now set exactly while the account holds System
  Administrator, wherever its roles change.
- **Upgrading repairs existing accounts:**
  - an account with no main role, or a main role it doesn't hold, gets the
    best role it holds;
  - the admin marker is set for holders of System Administrator;
  - the marker is cleared from accounts not holding it, but only while an
    active owner exists;
  - role assignments, permission overrides and company access left behind by
    deleted accounts are removed.

  Deleting an account now removes these too.

### Security fixes

- State-changing API requests that a browser marks as coming from another site
  (including a sibling subdomain or another port of the same host) are refused
  with `403 CROSS_SITE`. API tools and scripts, which send no such marker, are
  not affected; single sign-on's SAML response is the one exception.
- Someone who manages roles or permission overrides can no longer change the
  permissions of a role they hold, or grant a permission (to a role, a new
  role or a user) that they don't hold themselves (a broader scope counts:
  holding `tickets.edit_department` allows granting `tickets.edit_own`).
  The same goes for handing out a role: assigning it, choosing it for a new
  account, or making it a department's default. System Administrators (the
  owners) are not limited, and only they can make someone a System
  Administrator.
- A department-level user with no department could see every ticket, project
  and contact that had no department, and the same in reports, the dashboard
  and the people list. A user with no department now matches no department.
- Project file responses no longer include the file's path on the server.
- A contact's ticket list, counts and recent tickets now show only the
  tickets you can open. Before, anyone who could see a contact saw every
  ticket they had raised, in any department.
- An asset's linked tickets, and its link history, show a ticket you can't
  open as "Restricted ticket" (id only). Unlinking needs access to the ticket.
- A ticket's linked project shows as restricted (id only) when you can't open
  the project, and a ticket's activity names a linked ticket only to those who
  can open it.
- Deleting a project subtask now checks that its task belongs to the project
  in the URL. Before, a user who could edit one project could delete subtasks
  in any other.
- Starting a timer now needs access to the ticket, as every other ticket
  action does.
- Linking tickets (the Link ticket dialog, and parent/child/related tickets on
  the new-ticket form) and linking a project task to a ticket now only reach
  tickets you can see. A ticket you can't see gets the same "not found" answer
  as one that doesn't exist. **Changed response:** a missing linked ticket on
  ticket create now returns `400 VALIDATION_ERROR` instead of
  `400 FK_CONSTRAINT`, and on project tasks it is now refused instead of
  stored.
- Project file uploads now get the same content check as ticket attachments,
  so an executable renamed to a document extension is refused.
- A ticket's project and contact (on the new-ticket form and when editing a
  ticket) must now be ones you can see. Before, choosing them by id showed the
  project's name and the contact's email and phone even when you had no access
  to them. Users without "view all people" can use contacts from their own
  department, or a contact they just created on the new-ticket form.
  **Changed response:** a missing or hidden project or contact now returns
  `400 VALIDATION_ERROR` ("Project not found" / "Contact not found").
- Editing or deleting a contact now needs access to that contact (your own
  department, a contact you created, or "view all people"). Before, anyone who
  could create tickets could edit any contact.
- The contact list's department filters now narrow what you can see instead
  of replacing it. Before, a user limited to their own department could list
  another department's contacts by filtering on it.
- Assigning a contact to a department (which also moves that contact's
  tickets) now needs access to the contact, and users without "view all
  people" can only assign their own department. Before, any user who could
  create tickets could move another department's contact, and its tickets,
  into their own department and read them.
- Assets, licenses and contracts can now only be linked to tickets, contacts
  and assets you can see, in the same company. This covers checking an asset
  out to a contact, linking assets on the new-ticket form, linking an asset
  to a ticket, and linking a license or contract to an asset or contact.
  Before, a link could reach any ticket or contact by id and show its title
  or name. **Changed response:** an asset id on the new-ticket form that
  isn't a whole number, or is missing, now returns `400 VALIDATION_ERROR`
  ("Asset not found") instead of being skipped.
- An asset, license or contract address with extra characters after the id
  (`/assets/12abc`) now answers "not found". Before, it opened record 12.
- **Only a System Administrator can make someone a System Administrator.**
  Before, anyone who could create or edit users (including the seeded
  Department Manager role) could make themselves or a new account an
  administrator, or reset an administrator's password. Now:
  - choosing or changing a user's role needs "Manage roles"
    (`people.manage_roles`), and setting a department's default role does too;
  - nobody can change their own roles or permission overrides;
  - only a System Administrator can grant System Administrator (directly, as
    a department's default role, or through a new account) or reset a System
    Administrator's password.
  **Changed response:** these return `403 FORBIDDEN`. Department Managers can
  still create ordinary accounts and reset ordinary passwords.
- Deleting a ticket or project now checks that you can reach its company.
- Reports now keep to your report scope everywhere. Before, an "own records"
  user could add `?assigneeId=` to the time & billing report or the custom
  report builder to see anyone's time and labour cost; the customer-happiness
  report and the CSAT stats and responses showed every department to a
  department-scoped user; and custom expense and material reports weren't
  scoped at all.
- Project time, expenses, materials and files only take a task from the same
  project. Before, another project's task id was accepted, and its title shown.

### Fixes

- Time entries show Edit and Delete only where you may change them, and the
  Log time form's "Logged for" list holds only the people you may log time
  for there. Before, a team lead saw Edit and Delete on every entry and could
  pick anyone, and the server then refused. New:
  `GET /tickets/:id/time/log-for` and `GET /projects/:id/time-entries/log-for`,
  and each listed time entry carries `canChange`.
- People without a ticket edit permission (such as Read Only) no longer see
  the ticket upload area. The server already refused their uploads.
- After the server's owner recovery command runs, the running server picks up
  the change at that person's next request. Before, it could keep their old
  permissions for up to five minutes.
- Two people creating a project in the same department at the same moment
  no longer get an error; both projects are created with their own numbers.

## v0.3.0

Nothing here needs action before upgrading an unmodified install.

### License is now AGPL-3.0

PRISM is relicensed from MIT to the GNU Affero General Public License v3.0
(`AGPL-3.0-only`). Releases up to and including v0.2.0 stay under MIT.

Nothing changes for running PRISM unmodified. If you **modify** PRISM and let
users reach it over a network, the AGPL requires you to offer those users the
source of your modified version. The About page in Settings links to the
source for the build it's running, which is where users will look for it.

### Also in this release

- Tagged versions are now published as GitHub Releases, with these notes and
  the image names to pin.
- The About page's Source code and License links go to the running build's
  own tag or commit instead of the latest code on `main`.

## v0.2.0

Nothing here needs action before upgrading.

- **`IMAGE_TAG` in `.env`** chooses which build `docker-compose.yml` pulls.
  It defaults to `latest`, so a stack whose `.env` predates it is unaffected.
  Set a version to pin or roll back — see RELEASING.md.
- **Running version is visible.** `GET /api/v1/version` (any logged-in user)
  and the Settings page footer report the build's version and commit. It is
  not on the unauthenticated `/health` endpoint.
- **Dependency security updates.** Backend: multer, ip-address, nodemailer,
  csv-parse and others, all within existing version ranges. Frontend:
  react-router and TipTap patch releases.
- **Light/dark toggle** in the nav bar, next to the user menu. "System" is
  still chosen in Account preferences.
- **About PRISM** page under Settings -> My Account: version, commit,
  license, and links to report an issue or star the project on GitHub.

## v0.1.0

The first tagged release, covering everything up to and including the
pagination work. Marks a baseline for later versions to be compared against.

### List endpoints are paginated — breaking for API consumers

Every list endpoint now returns one page instead of the whole table. The
collection keeps its key and gains metadata siblings:

```json
{ "tickets": [ ... ], "page": 1, "limit": 50, "total": 2431, "totalPages": 49 }
```

No change is needed in the PRISM web UI. **Anything else that calls the API —
a script, an integration using an API key — will silently start seeing only
the first 50 records.** Two ways to fix such a caller:

- page through it: request `?page=2`, `?page=3` … until `page` reaches `totalPages`
- or ask for everything in one response with `?limit=all` (capped at 5000 rows)

Project expense and material endpoints also renamed one field: `total` used to
be a money sum and is now the row count, with the money sum moved to
`totalAmount`. Time entries gained `totalLaborCost` for the same reason.

### Single sign-on

Adds SAML 2.0 and OIDC single sign-on. **Run migrations before starting the
new backend** (`npm run migrate`, or let the container entrypoint do it) —
this release adds four tables and one column.

Nothing changes for existing installs until an administrator configures a
provider: no new required environment variables, and local and LDAP login are
untouched.

#### One setting worth checking

Callback URLs handed to your identity provider are built from
`PUBLIC_APP_URL`. It is derived from request headers nowhere, deliberately —
`Host` and `X-Forwarded-Host` are attacker-controllable, and trusting them
would let someone have an authorization code redirected to a host of their
choosing. If `PUBLIC_APP_URL` is unset, PRISM falls back to
`http://localhost:$APP_PORT`, which is fine for local testing and wrong for
anything else.

#### If you intend to require SSO

Designate at least one **break-glass** account first (a user's page →
*Break-glass access*). PRISM will not let you enable enforcement without one,
because an identity provider outage would otherwise lock everyone out
permanently.

See the [SSO section of the README](README.md#single-sign-on-sso) for setup.

#### Fixed: migration rollback

`sequelize-cli db:migrate:undo` previously failed with
`Cannot delete property 'meta' of [object Array]`, and even when it did not,
`down()` silently dropped nothing. Both causes are fixed; rollback now works
across every migration (verified by migrating all 47 up, undoing all of them,
and re-applying).

If you maintain your own migrations in this project, note the second cause:
`queryInterface.showAllTables()` returns `{ tableName, schema }` objects in
this Sequelize version, not strings, so a guard like
`tables.includes('MyTable')` is always false. Normalize first:

```js
const tables = (await queryInterface.showAllTables())
  .map((t) => (typeof t === 'string' ? t : t.tableName));
```

---

### Security hardening

This release closes a privilege-escalation flaw and adopts fail-closed
configuration. **Read the "Before you upgrade" section — an existing
deployment will not start until its `.env` is updated.**

#### Before you upgrade

PRISM now refuses to start on an insecure configuration rather than warning
and continuing. Previously the `SESSION_SECRET` check only ran when
`NODE_ENV` was exactly `production`, so an install that never set `NODE_ENV`
would silently run on the placeholder secret published in `.env.example` —
anyone could forge a session cookie for any user.

Startup now fails, listing every problem at once, if:

| Variable | Requirement |
|---|---|
| `SESSION_SECRET` | Set, not a known placeholder, at least 32 characters |
| `DB_PASSWORD` | Not left as `changeme` |
| `BOOTSTRAP_LOCAL_PASSWORD` | Not left as `changeme` (or removed entirely) |
| `COOKIE_SECURE` | Must be `true` when `PUBLIC_APP_URL` is an `https://` address |
| `TRUST_PROXY` | Must be a valid value if set at all |

Generate secrets with:

```bash
openssl rand -hex 32
```

#### New: `ENCRYPTION_KEY` (recommended)

Credentials stored in the database — the LDAP bind password, license keys,
calendar OAuth tokens — are encrypted with a key that was derived from
`SESSION_SECRET`. That coupling means rotating `SESSION_SECRET` (routine, and
something you may need to do in a hurry) silently makes every stored
credential undecryptable, which surfaced as "AD login just stopped working"
with nothing in the logs.

Set a dedicated key so the two can be rotated independently:

```bash
ENCRYPTION_KEY=$(openssl rand -hex 32)
```

If `ENCRYPTION_KEY` is absent PRISM still falls back to `SESSION_SECRET`, so
existing installs keep working — but adopt the dedicated key at the next
convenient window. **Back it up:** losing it means re-entering the LDAP bind
password and any stored license keys.

Decryption failures are now logged explicitly instead of returning empty.

#### New: `TRUST_PROXY` (defaults to off)

The backend used to trust `X-Forwarded-For` unconditionally. Rate limiting
keys on the client IP, so a client that could reach the backend directly
could rotate a spoofed header and get a fresh allowance of login attempts
each time — unlimited password guessing.

`TRUST_PROXY` now defaults to **off**. Set it only when the backend sits
behind a trusted reverse proxy that sets the header:

```bash
TRUST_PROXY=1   # exactly one proxy hop (the bundled nginx)
```

The bundled `docker-compose.yml` sets this for you and does not publish the
backend port. **If you run your own reverse proxy, set `TRUST_PROXY=1` — and
make sure the backend port is not reachable directly.** Leaving it unset
behind a proxy is safe but means all clients share one rate-limit bucket.

#### Behaviour changes

**Authorization.** A set of endpoints was gated on the legacy `User.role`
column, which only holds `admin` or `technician` and is `technician` for every
non-admin account. Those gates therefore authorized every logged-in user
regardless of their granular permissions — a "Read Only" account could edit
and delete other people's ticket comments, create and delete project tasks and
blueprints, log time, and manage watchers.

These now require real permissions. Users may lose access they previously had
by accident:

| Area | Now requires |
|---|---|
| Project tasks, subtasks, files | `projects.edit_own` / `edit_department` / `edit_all` |
| Project time entry edits, the timer | `projects.log_time` |
| Ticket tasks, time, relations, attachments, comment edits | `tickets.edit_own` / `edit_department` / `edit_all` |
| Ticket watchers | `tickets.manage_watchers` |
| Blueprints (create/edit/delete) | `projects.create` |
| Posting internal comments | `tickets.view_private_comments` |
| Editing or deleting **someone else's** comment or attachment | `tickets.edit_department` (same department) or `tickets.edit_all` |

Review your custom roles under **Settings → Roles** after upgrading. The
seeded System Technician and Department Manager roles are unaffected.

**Passwords.** Local account passwords must now be at least 12 characters,
use three of four character classes, avoid common passwords and long
sequential runs, and must not contain the account's own name or email. This
applies to new accounts, admin resets and password changes. Existing
passwords keep working until they are next changed.

Changing a password now also signs out that account's other sessions.

**Sessions.** The session ID is regenerated on login, so any session ID known
before authentication stops working.

**CSV exports.** Values that begin with `=`, `+`, `-` or `@` are prefixed with
a single quote so spreadsheets treat them as text rather than formulas. A
separate bug that double-quoted any cell containing a comma is also fixed, so
exports that were previously mangled now open correctly.

#### Running the tests

The backend now has a test suite, and CI runs it before publishing images.

```bash
cd backend
npm ci
cp .env.example .env.test   # then set DB_* and SESSION_SECRET for a scratch database
npm run test:migrate        # applies migrations to <DB_NAME>_test
npm test
```
