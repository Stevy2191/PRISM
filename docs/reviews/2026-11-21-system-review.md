# PRISM system review — 2026-11-21

A top-to-bottom look at PRISM as it stands on `dev` (after the CN work and the
new MCP server). Everything below was checked by running it, not just by
reading: the backend ran on MariaDB 10.11 with Node 24, the frontend was
built, the agent was vetted and tested, and every dependency tree was audited.

## Status: all four fixed (same day)

| # | Fix | Result |
|---|---|---|
| 1 | API keys stored and looked up as SHA-256 (migration 099); old keys move over on first use; `lastUsed` written at most once a minute | 0.385 s → 0.006 s per key request; a browser request behind eight key requests 2.78 s → 0.012 s |
| 2 | `npm audit fix`, nodemailer 10, React Router 7, Tiptap 3, a patched uuid; CI now audits every package and fails on high or critical | backend 19 → 5 moderate (all under `sequelize-cli`'s start-up formatter); frontend 40 → 0; MCP 0 |
| 3 | Every page and the portal load on demand, with a reload-once guard for tabs left open across an upgrade | first download 3.87 MB → 591 KB (815 → 171 KB compressed) |
| 4 | One `router.param` resolves a ticket number on every `/tickets/:id` route; access is still checked on the ticket found | all write routes take `WC-T0042` and old numbers |

Found and fixed on the way: the frontend's unit tests couldn't run (three
were written for vitest, which was never installed, and CI only built the
frontend). They now run under `node:test` in CI: 143 pass. A browser smoke
test (`email.smoke.js`) had been failing since the reply box became a
one-line bar. A new smoke test drives the rich-text editor end to end.

---

## Summary

PRISM is in good shape. The security groundwork is unusually careful: it
refuses to start with weak secrets, ignores `X-Forwarded-For` unless told to
trust a proxy, guards writes with a same-origin check, scopes every list to
what the caller may see, and keeps a regression test for each security
finding it has fixed. Only the frontend port is exposed in the default
Compose file.

Four things are worth doing, in this order:

| # | Finding | Kind | Impact | Risk | Effort | Priority |
|---|---|---|---|---|---|---|
| 1 | API keys are checked with bcrypt on every request, on the main thread | Performance / availability | 4 | 4 | 2 | **32** |
| 2 | Known-vulnerable dependencies (1 critical, 8 high) | Dependency | 2 | 4 | 1 | **30** |
| 3 | The whole app ships as one 3.9 MB script, portal included | Performance | 3 | 2 | 2 | **20** |
| 4 | Ticket write endpoints don't accept company ticket numbers | API consistency | 2 | 1 | 1 | **15** |

Priority = (Impact + Risk) × (6 − Effort); each scored 1–5.

---

## 1. API-key requests stall everyone (priority 32)

**What:** `middleware/auth.js` checks every API-key request with
`bcrypt.compare` against a cost-12 hash (`apikeysController.js:32`), using
`bcryptjs`, which is pure JavaScript and runs on Node's single main thread.
It also saves `lastUsed` to the database on every request.

**Measured** on a running backend, the same request:

| | Time |
|---|---|
| Session cookie | ~0.008 s |
| API key | ~0.37 s |
| A browser user's request while 8 API-key requests are in flight | **2.78 s** |

So any script, integration or the new MCP server (one Claude question can make
several API calls, some in parallel) slows the web app down for everyone.

**Why bcrypt isn't needed here:** bcrypt is deliberately slow to protect
*passwords*, which people choose and can be guessed. An API key is 32 random
bytes (256 bits); nobody can guess it, so a fast hash protects it just as
well.

**Fix:** store a SHA-256 (or HMAC-SHA-256 with a server secret) of the key and
look it up by that hash directly, constant-time. Migrate without reissuing
keys: on a successful bcrypt match, write the new hash and drop the bcrypt
one. Only update `lastUsed` when it's more than a minute old. About half a day,
with tests.

## 2. Vulnerable dependencies (priority 30)

`npm audit --omit=dev` (production dependencies only):

**Backend: 19 (1 critical, 5 high, 13 moderate)**

| Package | Severity | Applies to PRISM? | Fix |
|---|---|---|---|
| proxy-addr | critical | IP spoofing only with a subnet `TRUST_PROXY` | `npm audit fix` |
| body-parser | high | DoS with a compressed body: reachable | `npm audit fix` |
| multer | high | DoS on upload: reachable (attachments) | `npm audit fix` |
| mariadb | high | SQL injection only with `NO_BACKSLASH_ESCAPES`, which PRISM doesn't set | `npm audit fix` |
| source-map-js | high | build-time path | `npm audit fix` |
| nodemailer | high | cross-transport TLS name reuse; PRISM has one transport | major upgrade to 10.x |
| sequelize, uuid, connect-session-sequelize, sequelize-cli, … | moderate | | majors; plan separately |

**Frontend: 40 (3 high, 37 moderate)**: axios, follow-redirects and
markdown-it are high and fixed by `npm audit fix`; the moderates are mostly
Tiptap 2 → 3 (a major upgrade of the editor) and react-router-dom 7.18.6.

**MCP server:** 0.

**Fix:** run `npm audit fix` in `backend/` and `frontend/` now (no major
bumps), run the suites, ship. Schedule nodemailer 10 and Tiptap 3 as their
own changes. Add an `npm audit --omit=dev --audit-level=high` step to CI so new
ones get noticed.

## 3. One 3.9 MB script for everything (priority 20)

The production build is a single `index-*.js` of **3.9 MB (815 KB
gzipped)**. `App.jsx` imports all 75 pages up front and none are loaded with
`React.lazy`. Customers who open the portal on a phone to raise one ticket
download the whole staff app: dashboards, the project timeline, the rich-text
editor, reports.

**Fix:** lazy-load each route (`React.lazy` + `Suspense`), and make the
portal its own entry, or at least its own chunk. About a day; the build already
warns about it.

## 4. Ticket numbers work on reads but not writes (priority 15)

Since CN, `GET /tickets/AD-T0001` finds the ticket by its company number, but
the same number gives **404** on:

```
GET   /tickets/AD-T0001/comments
PATCH /tickets/AD-T0001
POST  /tickets/AD-T0001/comments
POST  /tickets/AD-T0001/time
```

These look the ticket up with `Ticket.findByPk(req.params.id)`. Anyone writing
against the API (the MCP server does this today) has to read the ticket first
to learn its id. **Fix:** resolve `:id` with `findTicketIdByNumber` in one
shared loader for every `/tickets/:id/...` route. An hour or two.

---

## What was checked, and the results

| Check | Result |
|---|---|
| Backend test suite (Node 24.22, MariaDB 10.11, CI settings) | **212 suites, 2,271 tests, all pass** (20.6 min) |
| Migrations on an empty database | all applied |
| Frontend production build | builds; chunk-size warning (finding 3) |
| Agent (`go vet ./...`) | clean |
| Agent (`go test ./...`) | pass, except `cmd/prism-tray`, which needs GTK/WebKitGTK headers this machine doesn't have (CI installs them) |
| MCP server tests | 13/13 |
| MCP server against a live backend | all 23 tools over stdio; HTTP mode with no key, a bad key and read-only |
| `npm audit` | finding 2 |

### Backend test suite

All 212 suites and 2,271 tests pass with CI's settings, in 20.6 minutes. The
only noise is a `MaxListenersExceededWarning` from `SequelizeStore` in one
suite, where the session store is created more than ten times in one
process; it's harmless but worth silencing so real warnings stand out.

## Smaller notes

- **The largest files** are frontend pages (`AssetDetail.jsx` 1,312 lines,
  `Dashboard.jsx` 1,117, `UserDetail.jsx` 1,025). Worth splitting when they're
  next changed, not on their own.
- **Search results name the number differently:** `/search` returns
  `ticketNumber` where every other ticket response says `number`.
- **Only 7 TODO/FIXME markers** in about 96,000 lines of JavaScript.
- **claude.ai and the Claude mobile app** can't use the MCP server yet. They
  sign in to remote MCP servers with OAuth, and PRISM has no OAuth
  authorization server. Claude Desktop and Claude Code work today.

## Suggested order

1. **This week:** `npm audit fix` in backend and frontend, plus the CI audit step
   (finding 2); the fast API-key hash (finding 1).
2. **Next:** ticket numbers on every ticket route (finding 4); route-level code
   splitting and a separate portal chunk (finding 3).
3. **Planned upgrades:** nodemailer 10, Tiptap 3, Sequelize's moderate chain.
4. **Later, if wanted:** OAuth in PRISM so claude.ai can connect.
