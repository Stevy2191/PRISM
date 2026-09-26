# Upgrading PRISM

Every released version gets a section here. Anything landed on `main` that no
tag covers yet goes under `## Unreleased` at the top, and is folded into the
version section when it is tagged — see RELEASING.md.

To upgrade in place: set `IMAGE_TAG` in `.env` (or leave it at `latest`), then
`docker compose pull && docker compose up -d`. Migrations run automatically on
backend start.

## Unreleased

### License is now AGPL-3.0

PRISM is relicensed from MIT to the GNU Affero General Public License v3.0
(`AGPL-3.0-only`). Releases up to and including v0.2.0 stay under MIT.

Nothing changes for running PRISM unmodified. If you **modify** PRISM and let
users reach it over a network, the AGPL requires you to offer those users the
source of your modified version. The About page in Settings links to the
source for the build it's running, which is where users will look for it.

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
