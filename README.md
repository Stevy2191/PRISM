# PRISM

**PRISM** is a self-hosted ticketing and project management web application for use
across departments (starting with IT). It provides ticket tracking, project and
milestone management, time logging, attachments, reporting, and an API — all behind
authentication.

- **Frontend:** React (Vite) + React Router + Tailwind CSS
- **Backend:** Node.js + Express
- **Database:** MariaDB via Sequelize ORM (with migrations)
- **Auth:** Active Directory / LDAP (`ldapjs`) **and** local username/password accounts
- **Deployment:** Docker Compose (frontend, backend, mariadb)
- **Storage:** Ticket attachments on a local Docker volume

---

## Architecture

```
┌────────────┐      /api      ┌────────────┐      SQL      ┌────────────┐
│  frontend  │ ─────────────▶ │  backend   │ ────────────▶ │  mariadb   │
│  (nginx +  │   (proxied)    │  (Express) │               │  10.11     │
│   React)   │ ◀───────────── │            │ ◀──────────── │            │
└────────────┘                └────────────┘               └────────────┘
                                    │ writes
                                    ▼
                              /uploads volume
```

The frontend container (nginx) serves the built React app and proxies `/api/*`
to the backend. The backend authenticates users against LDAP/AD, stores sessions
in MariaDB, and persists attachments to the `uploads` volume.

---

## Roles

| Role | Capabilities |
|------|--------------|
| **Admin** | Full access: users, departments, projects, tickets, settings, API keys |
| **Technician** | Create/edit/close tickets & projects, log time, comment, upload attachments |
| **Requester** | Read-only on projects; create & view *their own* tickets, comment on them |

New users default to **Requester** on first login. An Admin assigns roles afterward.

---

## Quick start

Requirements: Docker + Docker Compose.

```bash
git clone https://github.com/Stevy2191/PRISM.git
cd PRISM
./setup.sh
```

`setup.sh` handles everything:

1. Checks that Docker and Docker Compose are installed.
2. Asks for your admin username and password (auto-generates a strong one if you press Enter).
3. Asks what host port to serve PRISM on (default **8080** — change it if 8080 is in use).
4. Asks whether you use Active Directory / LDAP — completely optional, safe to skip.
5. Generates secure random values for all database credentials and the session secret.
6. Writes the `.env` file automatically.
7. Pulls the latest images from GitHub Container Registry.
8. Starts all containers (`docker compose up -d`).
9. Waits for the app to pass its health check.
10. Prints a summary: URL, login tab, username, and password.

The app is served on **`http://localhost:<APP_PORT>`** (default `http://localhost:8080`).
On first start the backend waits for MariaDB and applies all migrations automatically.

> **GHCR access:** images are published to `ghcr.io/stevy2191/prism-backend` and
> `…/prism-frontend`. If they're private, run `docker login ghcr.io` first (Personal
> Access Token with `read:packages` scope), or mark the packages public in GitHub.

### First login

Sign in at the URL printed by `setup.sh` on the **Local Account** tab, using the
username and password shown at the end of the script. You will be **forced to change
your password on first login**. Afterward, go to **Admin → Users** to promote your
AD account to Admin or create additional local accounts. You can delete the bootstrap
account once other admins exist.

### Changing the host port

`APP_PORT` in `.env` controls which port on your host the app listens on.
To move PRISM to a different port after initial setup:

```bash
# Edit .env and change APP_PORT, then restart:
docker compose up -d
```

### Updating to the latest images

```bash
docker compose pull && docker compose up -d
```

### Manual setup (advanced)

If you prefer to configure things yourself instead of running `setup.sh`:

```bash
cp .env.example .env
# Edit .env — set DB_PASSWORD, SESSION_SECRET, BOOTSTRAP_LOCAL_PASSWORD,
# APP_PORT (host port, default 8080), and LDAP_* variables (or leave them
# as placeholder stubs if you don't use Active Directory).
docker compose pull
docker compose up -d
```

### Building from source (development)

```bash
cp .env.example .env
docker compose -f docker-compose.dev.yml up -d --build
```

The dev stack exposes the frontend on `http://localhost:<APP_PORT>` (default 3000),
the backend on `http://localhost:3001`, and MariaDB on port `3306` for direct access.

---

## Uninstalling

To completely remove PRISM — all containers, database data, uploaded attachments,
Docker volumes, pulled images, and the `.env` file:

```bash
./uninstall.sh
```

The script will print a clear warning and ask you to type `yes` before doing
anything. Once done, delete the directory:

```bash
rm -rf /path/to/PRISM
```

---

## Database migrations

Schema is managed with **Sequelize migrations** — never with `sync({ force: true })`.

**Migrations run automatically** every time the backend container starts (see
`backend/docker-entrypoint.sh`), so the normal `docker compose up -d` flow needs no
manual migration step. New migrations are applied on the next restart.

If you ever need to run them by hand:

```bash
# Apply all pending migrations
docker compose exec backend npm run migrate

# Roll back the most recent migration
docker compose exec backend npm run migrate:undo
```

Running locally without Docker (from `backend/`):

```bash
npm install
npm run migrate
npm start
```

The Express session table (`Sessions`) is created automatically at startup by
`connect-session-sequelize`; all application tables come from the migrations in
`backend/migrations/`.

---

## Authentication

PRISM supports two login methods, selectable via tabs on the login page:

- **Active Directory** — username + password verified against LDAP/AD. AD users are
  created automatically on first login (defaulting to the **Requester** role) and
  their `displayName`/`email` are synced from the directory on every login.
- **Local Account** — username **or** email + password, verified against a bcrypt
  hash stored in the `Users` table. Local accounts are created **manually by an
  Admin** (Admin → Users → *New Local Account*) and are never created or modified by
  LDAP sync. New local accounts (including the bootstrap admin) must change their
  password on first login.

Sessions for both methods are stored in MariaDB. Programmatic clients can instead
use an `X-API-Key` header (see *Generating an API key*).

| User field | Meaning |
|------------|---------|
| `isLocalAccount` | `true` for local accounts, `false` for AD users |
| `passwordHash` | bcrypt hash (local accounts only; `null` for AD users) |
| `mustChangePassword` | forces a password change before any other action |

Admins can reset a local account's password from **Admin → Users** (which re-arms
`mustChangePassword`). AD passwords are managed in Active Directory, not in PRISM.

---

## Configuring LDAP / Active Directory

LDAP is **optional**. If you don't use Active Directory, skip it during `setup.sh`
and only the Local Account login tab will be available. To enable it later, edit the
`LDAP_*` variables in `.env` and restart (`docker compose up -d`).

LDAP settings are read from environment variables:

| Variable | Description | Example |
|----------|-------------|---------|
| `LDAP_URL` | Domain controller URL | `ldap://dc01.domain.local` (or `ldaps://…:636`) |
| `LDAP_BASE_DN` | Search base | `DC=domain,DC=local` |
| `LDAP_BIND_DN` | Service account DN used to search the directory | `CN=svc-prism,OU=Service Accounts,DC=domain,DC=local` |
| `LDAP_BIND_PASSWORD` | Service account password | — |
| `LDAP_USER_FILTER` | Filter to find the user; `{{username}}` is substituted | `(sAMAccountName={{username}})` |

**Login flow:** the backend binds with the service account, searches for the user
with `LDAP_USER_FILTER`, then re-binds as that user's DN with the supplied password
to verify the credentials. On success it syncs the user's `displayName`, `mail`,
and `sAMAccountName` into the database.

You can review the effective (non-secret) LDAP configuration in the app under
**Admin → Settings**.

---

## Image publishing & production notes

On every push to `main`, GitHub Actions builds and publishes both images to GHCR,
tagged with `latest` and the git SHA — this is what the default `docker-compose.yml`
pulls:

- `ghcr.io/stevy2191/prism-backend:latest` (and `:<git-sha>`)
- `ghcr.io/stevy2191/prism-frontend:latest` (and `:<git-sha>`)

The host port is controlled by `APP_PORT` in `.env` (default **8080**). Put a
TLS-terminating reverse proxy in front for HTTPS; if it forwards plain HTTP
internally, set `COOKIE_SECURE=false` in `.env` so session cookies are still issued.

### Pulling the images

`docker compose up -d` (and `docker compose pull`) fetch these images automatically,
so you normally don't pull by hand. Image names must be **lowercase**
(`ghcr.io/stevy2191/…`).

**If the packages are public** — no authentication is needed. Any host can pull
directly:

```bash
docker pull ghcr.io/stevy2191/prism-backend:latest
docker pull ghcr.io/stevy2191/prism-frontend:latest
```

To make them public: GitHub → your profile → **Packages** → select the package →
**Package settings** → **Danger Zone** → **Change visibility** → **Public**.

**If the packages are private** (the default) — log in to GHCR on each host first
with a Personal Access Token that has the `read:packages` scope:

```bash
echo "$GHCR_TOKEN" | docker login ghcr.io -u stevy2191 --password-stdin
docker compose pull
```

---

## Generating an API key

Programmatic clients authenticate with the `X-API-Key` header instead of a session
cookie. Keys are stored **bcrypt-hashed**; the plaintext is shown **only once** at
creation.

1. Sign in to PRISM.
2. Go to **Admin → API Keys**.
3. Enter a name (and optional expiry) and click **Generate**.
4. Copy the displayed key immediately — it cannot be retrieved again.

Use it against the API:

```bash
curl -H "X-API-Key: prism_xxxxxxxx..." \
     https://your-host/api/v1/tickets
```

Revoke a key anytime from the same page (admins see all keys; other users see
only their own).

---

## REST API

Base path: `/api/v1`. All responses are JSON. Errors use a consistent shape:

```json
{ "error": true, "message": "Ticket not found", "code": "NOT_FOUND" }
```

Authentication: session cookie (browser) **or** `X-API-Key` header (clients).

| Area | Endpoints |
|------|-----------|
| Auth | `POST /auth/login` (`mode: ad\|local`), `POST /auth/logout`, `GET /auth/me`, `POST /auth/change-password` |
| Users | `GET /users` (admin), `POST /users` (admin, local account), `GET/PATCH/DELETE /users/:id` |
| Departments | `GET/POST /departments`, `GET/PATCH/DELETE /departments/:id` |
| Projects | `GET/POST /projects`, `GET/PATCH/DELETE /projects/:id`, `…/:id/milestones[/:milestoneId]` |
| Project time | `GET/POST /projects/:id/time`, `DELETE …/:entryId` (project-level time) |
| Tickets | `GET/POST /tickets`, `GET/PATCH/DELETE /tickets/:id` |
| Ticket comments | `GET/POST /tickets/:id/comments`, `PATCH/DELETE …/:commentId` |
| Ticket attachments | `GET/POST /tickets/:id/attachments`, `GET …/:attachmentId/download`, `DELETE …/:attachmentId` |
| Ticket time | `GET/POST /tickets/:id/time`, `DELETE …/:entryId` |
| Ticket relations | `GET/POST /tickets/:id/relations`, `DELETE …/:relationId` |
| Ticket CSAT | `GET /tickets/:id/csat`, `POST /tickets/:id/csat` (requester) |
| Blueprints | `GET /blueprints`, `GET /blueprints/:id`, `POST/PATCH/DELETE` (staff) |
| Teams | `GET /teams`, `GET /teams/:id`, `POST/PATCH/DELETE` (admin) |
| Business hours | `GET /business-hours`, `POST/PATCH/DELETE` (admin) |
| Holiday lists | `GET /holiday-lists`, `POST/PATCH/DELETE`, `…/:id/holidays[/:holidayId]` (admin) |
| Modules | `GET /modules`, `PUT /modules` (admin) — sidebar visibility per role |
| Custom fields | `GET /custom-fields` (`?ticketType=&departmentId=`), `POST/PATCH/DELETE` (admin) |
| Timer | `GET /timer`, `POST /timer/start`, `POST /timer/stop`, `DELETE /timer` (staff) — per-user running timer |
| API keys | `GET/POST /apikeys`, `DELETE /apikeys/:id` |
| Reports | `GET /reports/tickets`, `GET /reports/time` (`?format=csv`), `GET /reports/csat` |
| Settings | `GET /settings/public` (no auth), `GET/PUT /settings` (admin), `POST/DELETE /settings/logo`, `GET /settings/logo` |

Ticket list filters (query params): `status`, `priority`, `type`, `assignee`,
`team`, `project`, `department`, `requester`.

### Settings system

A `/settings` hub (role-aware card grid) groups all configuration. Highlights:
**Company** (name, logo, timezone/locale — stored in `SystemSettings`), **Rebranding**
(primary/accent/login colors + welcome message applied at runtime via CSS variables,
with live preview), **Business Hours** & **Holiday Lists** (per-department schedules),
**Teams** (tickets can be assigned to a team; filterable), **Customer Happiness**
(CSAT survey on resolved/closed tickets, scored in Reports), and **Modules & Tabs**
(toggle sidebar items per role). Admins see everything; technicians see a subset;
requesters see only their **Preferences**. **Preferences** also offers a **theme
switcher** (Light / Dark / System) — the whole UI flips via CSS variables, persisted
per browser.

**Layouts & Fields** (Phase 2): admins define `CustomField`s (text/textarea/number/
select/checkbox/date/url), optionally scoped to a ticket type and/or department and
ordered via `displayOrder`. Applicable fields render dynamically on the ticket
create/edit forms; values are stored relationally in `TicketFieldValue` (one row per
ticket × field). This is distinct from blueprint custom fields, which are template-
driven and stored inline on the ticket.

### Blueprints, related tickets & time tracking

- **Blueprints** are reusable ticket templates (name, category, default field values,
  and custom fields of type text/textarea/number/select/checkbox/date). Staff manage
  them at **Admin → Blueprints**; on the new-ticket form, **Use Blueprint** pre-fills
  the form and renders the custom fields, which are stored on the ticket.
- **Ticket types** are `incident`, `request`, `problem`, `task`, `change`. A
  **problem** represents the root cause behind one or more incidents; use
  **Related Tickets** on the ticket detail page to link them (`related`, `caused_by`,
  `duplicates`).
- **Time tracking** works on both tickets and projects. A `TimeEntry` references
  exactly one of `ticketId` / `projectId`. The project detail page has a **Time Log**
  tab aggregating ticket + project-level time, and **Reports** breaks time down by
  user, project, and department with CSV export.

---

## Project layout

```
prism/
├── docker-compose.yml          # default: run from prebuilt ghcr.io images
├── docker-compose.dev.yml      # development: build everything from source
├── setup.sh                    # interactive setup wizard (run this first)
├── uninstall.sh                # complete teardown — containers, volumes, images, .env
├── .env.example                # template for .env (generated by setup.sh or copy manually)
├── .github/workflows/docker-publish.yml
├── backend/
│   ├── Dockerfile
│   ├── migrations/             # Sequelize migrations
│   └── src/
│       ├── index.js            # Express app + session store
│       ├── config/             # database, ldap, sequelize-cli config
│       ├── models/             # Sequelize models + associations
│       ├── middleware/         # auth, roles, errors, audit, uploads
│       ├── controllers/
│       └── routes/
└── frontend/
    ├── Dockerfile              # build → nginx
    ├── nginx.conf              # serves SPA + proxies /api
    └── src/
        ├── api/                # central Axios client
        ├── context/            # auth context
        ├── components/
        └── pages/
```

---

## Operational notes

- **Attachments** are limited to 25 MB and stored under `/uploads/{ticketId}/`
  on the `uploads_data` volume.
- **Audit logging:** every state-changing action writes an `AuditLog` row
  (actor, action, entity, JSON metadata).
- **Sessions** are stored in MariaDB and survive backend restarts.
- **Data integrity:** multi-step writes use Sequelize transactions; deleting a
  ticket cascades its comments, attachments, and time entries (and removes files).
