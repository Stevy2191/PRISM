# PRISM

**PRISM** is a self-hosted ticketing and project management web application for use
across departments (starting with IT). It provides ticket tracking, project and
milestone management, time logging, attachments, reporting, and an API — all behind
Active Directory / LDAP authentication.

- **Frontend:** React (Vite) + React Router + Tailwind CSS
- **Backend:** Node.js + Express
- **Database:** MariaDB via Sequelize ORM (with migrations)
- **Auth:** Active Directory / LDAP (`ldapjs`) + a single bootstrap admin
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

Requirements: Docker + Docker Compose. **`docker-compose.yml` is the only file you
need** — it builds the frontend and backend from source, starts MariaDB, and runs
database migrations automatically.

```bash
# 1. Clone the repository
git clone https://github.com/Stevy2191/PRISM.git
cd PRISM

# 2. Create your environment file and fill in your values
cp .env.example .env
#    Edit .env — set DB_PASSWORD, SESSION_SECRET, LDAP_* and the bootstrap admin.

# 3. Build and start everything (database, backend, frontend)
docker compose up -d
```

That's it. On first start the backend waits for the database to be ready, applies
all migrations, and then comes online. Watch progress with `docker compose logs -f`.

Then open the app:
- Frontend: <http://localhost:3000>
- Backend health: <http://localhost:3001/api/v1/health>

Log in for the first time with the **bootstrap admin** credentials
(`BOOTSTRAP_ADMIN_USERNAME` / `BOOTSTRAP_ADMIN_PASSWORD` from `.env`). Then go to
**Admin → Users** to promote your real AD account to Admin, and disable the
bootstrap account by clearing those env vars and restarting.

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
`connect-session-sequelize`; all application tables come from the migration in
`backend/migrations/`.

---

## Configuring LDAP / Active Directory

LDAP settings are read from environment variables (see `.env`):

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

## Optional: deploy from prebuilt images

The standard `docker compose up -d` flow above is all most deployments need. As an
**optional** alternative, you can run from prebuilt images instead of building from
source — handy for low-powered servers where you'd rather not run a build.

On every push to `main`, GitHub Actions builds and publishes two images to GHCR:

- `ghcr.io/stevy2191/prism-backend:latest` (and `:<git-sha>`)
- `ghcr.io/stevy2191/prism-frontend:latest` (and `:<git-sha>`)

`docker-compose.prod.yml` is provided for this; it pulls those images rather than
building:

```bash
cp .env.example .env
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

Migrations still run automatically on backend startup. The frontend is exposed on
port **80**; put a TLS-terminating reverse proxy in front for HTTPS, and if it
forwards plain HTTP internally set `COOKIE_SECURE=false` so session cookies are
still issued.

> **GHCR notes:** images are private by default — either mark them public in your
> GitHub packages settings, or `docker login ghcr.io` on the host before pulling.

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
| Auth | `POST /auth/login`, `POST /auth/logout`, `GET /auth/me` |
| Users | `GET /users` (admin), `GET/PATCH/DELETE /users/:id` |
| Departments | `GET/POST /departments`, `GET/PATCH/DELETE /departments/:id` |
| Projects | `GET/POST /projects`, `GET/PATCH/DELETE /projects/:id`, `…/:id/milestones[/:milestoneId]` |
| Tickets | `GET/POST /tickets`, `GET/PATCH/DELETE /tickets/:id` |
| Ticket comments | `GET/POST /tickets/:id/comments`, `PATCH/DELETE …/:commentId` |
| Ticket attachments | `GET/POST /tickets/:id/attachments`, `GET …/:attachmentId/download`, `DELETE …/:attachmentId` |
| Ticket time | `GET/POST /tickets/:id/time`, `DELETE …/:entryId` |
| API keys | `GET/POST /apikeys`, `DELETE /apikeys/:id` |
| Reports | `GET /reports/tickets`, `GET /reports/time` (date-range params `from`, `to`) |
| Settings | `GET /settings` (admin, read-only) |

Ticket list filters (query params): `status`, `priority`, `type`, `assignee`,
`project`, `department`, `requester`.

---

## Project layout

```
prism/
├── docker-compose.yml          # the only file you need (builds from source)
├── docker-compose.prod.yml     # optional: run from prebuilt ghcr.io images
├── .env.example
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
