# Claude connects to PRISM with OAuth (MCP-O): design

**Status:** approved by the owner 2026-11-21 ("go ahead, off until an admin
enables it").

## Why

The MCP server (`mcp/`) lets Claude Desktop and Claude Code work with PRISM
through an API key. claude.ai, the Claude mobile apps and Team/Enterprise
workspaces connect to remote MCP servers by URL, and the way they expect to
sign in is OAuth: each person clicks **Connect**, signs in to PRISM as
themselves, and approves. No one copies keys around; access expires and can be
revoked in PRISM.

## Goals

- A PRISM install offers `https://<PUBLIC_APP_URL>/mcp`, addable in claude.ai
  as a custom connector, with OAuth sign-in that works with claude.ai's
  registration options ("Claude's published identity" via Client ID Metadata
  Documents, "Register automatically" via Dynamic Client Registration).
- Each person signs in the way they already do (local, Active Directory, SSO)
  and Claude acts with exactly their permissions.
- **Off until an admin (Owner) turns it on** in Settings. Turning it off stops
  every connection at once.
- Admins see every connection (who, which app, when last used) and can revoke
  it. Connections and revocations are audit-logged.

## Non-goals

- A general OAuth/OpenID provider for other apps (no ID tokens, no userinfo).
- Pre-registered clients entered by hand (claude.ai's "Use your own OAuth
  client"); CIMD and DCR cover claude.ai, Claude Desktop and Claude Code.
- Contacts (portal users) connecting Claude. Staff only.
- Per-tool scopes. One scope, `prism`; the admin decides read-only or not.

## Anti-goals (a failure even if it works)

- An OAuth token that works against the rest of `/api/v1`: the MCP spec says
  the MCP server must only accept tokens issued for it and must not pass them
  through. A token must open `/mcp` and nothing else.
- Any way for an OAuth client to reach a host PRISM fetches from (SSRF) beyond
  the domains the admin allows.
- A connection that outlives its user's deactivation, the admin's revocation,
  or the feature being switched off.

## Constraints

- claude.ai connects from Anthropic's cloud: the URL must be public HTTPS on
  port 443. PRISM's own HTTPS front (nginx, TLS) already is, so `/mcp` lives
  on the same origin, proxied to the backend.
- `PUBLIC_APP_URL` (already used by SSO and Microsoft 365) is the issuer and
  the base of the resource URL. Without an `https://` value the Settings page
  says OAuth can't be turned on.
- The backend is CommonJS on Node 24 (`require()` of ES modules works); the
  MCP tools live in `mcp/` (ESM) and are shared, not copied.

## Approaches considered

1. **MCP inside the backend, PRISM as its own authorization server**
   (chosen). One URL, one service; tokens validated where they're issued.
2. **The separate MCP service behind nginx** with PRISM as authorization
   server: the service would have to forward the user's OAuth token to PRISM's
   API, which the spec forbids, and adds a container to run.
3. **Fixed bearer header in claude.ai** (works today with `mcp --http`): no
   per-person sign-in, keys copied by hand, nothing to revoke per connection.
   Kept as the fallback; README says so.

## How it works

### Endpoints

| Path | What |
|---|---|
| `GET /.well-known/oauth-protected-resource` and `…/mcp` | RFC 9728: `resource` = `<PUBLIC>/mcp`, `authorization_servers` = [`<PUBLIC>`], `scopes_supported` = [`prism`] |
| `GET /.well-known/oauth-authorization-server` | RFC 8414: endpoints below, `code_challenge_methods_supported: ["S256"]`, `token_endpoint_auth_methods_supported: ["none"]`, `client_id_metadata_document_supported: true`, `authorization_response_iss_parameter_supported: true` |
| `POST /api/v1/oauth/register` | RFC 7591 DCR: public clients only (`none` auth), redirect URIs checked against the allowed domains |
| `GET /api/v1/oauth/authorize` | Validates the request, stores it, redirects the browser to the consent page `/oauth/consent/<id>` |
| `GET /api/v1/oauth/requests/:id`, `POST …/:id/decision` | The consent page's API (staff session) |
| `POST /api/v1/oauth/token` | `authorization_code` (PKCE S256) and `refresh_token` |
| `POST /api/v1/oauth/revoke` | RFC 7009 |
| `GET/PUT /api/v1/oauth/settings`, `GET /api/v1/oauth/connections`, `DELETE …/:id` | Owner-only admin |
| `POST /mcp` | MCP Streamable HTTP, stateless, JSON responses; `GET`/`DELETE` 405 |

The well-known paths and `/mcp` sit outside `/api/v1`. nginx proxies them to
the backend. When the feature is off, every OAuth and MCP path answers 404
(the admin endpoints excepted).

### Clients

- **CIMD:** a `client_id` that is an `https://` URL is fetched (5 s timeout,
  64 KB cap, no redirects, JSON) only if its host is an allowed domain; the
  document's `client_id` must equal the URL and it supplies `client_name` and
  `redirect_uris`. Cached in `OAuthClients` and refreshed after a day.
- **DCR:** anyone may register (rate-limited), but every redirect URI's host
  must be an allowed domain. The consent page shows the redirect host.
- **Allowed domains** (setting, Owner-editable): default `claude.ai`,
  `claude.com`, `localhost`, `127.0.0.1`. Subdomains count. `localhost`
  redirects allow `http`; every other must be `https`.

### Consent

`/oauth/consent/<id>` is a staff page (sign-in first if needed; the path
survives sign-in, local or SSO). It shows the app name, "you'll go back to
<host>", who you are, and what it may do (read, or read and change, per the
admin setting) with **Allow** and **Deny**. Allow issues a one-time code
(10 minutes) bound to the client, redirect URI, PKCE challenge, resource and
user; the browser goes to `redirect_uri?code=…&state=…&iss=<PUBLIC>`. Deny
returns `error=access_denied`. An unknown client or a redirect URI not
registered for it is shown as an error on PRISM's page, never redirected.

### Tokens

- Opaque, random (32 bytes), prefixed `prism_oat_` (access) and `prism_ort_`
  (refresh); stored as SHA-256 only, like API keys.
- Access tokens live 1 hour; refresh tokens 30 days, rotated on every use.
  Presenting an already-rotated refresh token revokes the connection
  (theft detection).
- One row per connection (`OAuthConnections`): user, client, scope,
  resource, hashes, expiries, created, last used, revoked.
- `resource` (RFC 8707) must be `<PUBLIC>/mcp` (trailing slash tolerated) or
  absent (taken as that); the token is bound to it.

### `/mcp`

1. Feature on? Otherwise 404.
2. `Authorization: Bearer prism_oat_…` → SHA-256 lookup → not revoked, not
   expired, resource matches, user active. Otherwise `401` with
   `WWW-Authenticate: Bearer resource_metadata="<PUBLIC>/.well-known/oauth-protected-resource/mcp", scope="prism"`
   (and `error="invalid_token"` when a token was sent).
3. Runs the shared MCP tools (`mcp/src/tools.js`) with read-only unless the
   admin allows changes.
4. The tools reach PRISM's API **without the OAuth token**: the backend
   answers them on an internal loopback listener, authenticating each call
   with a random per-request grant held in memory for that one MCP request.
   The grant header is honoured only on that internal listener, so it can't
   be sent from outside, and an OAuth token is never accepted by `/api/v1`.

### Admin (Settings › Sign-in & email › Claude)

Owner-only page: turn on/off; "Claude can make changes" (off by default: read
only); allowed domains; the connector URL to copy, with steps for claude.ai;
every connection with person, app, created, last used and **Revoke**. A
warning when `PUBLIC_APP_URL` isn't `https://`.

### Audit

`oauth.client.register`, `oauth.connect` (allow), `oauth.deny`,
`oauth.revoke` (by user, admin or reuse detection), `oauth.settings`. Actions
Claude takes are logged as they are today, under the user.

### Deployment

- The backend image adds `mcp/` through a named build context
  (`docker/build-push-action` `build-contexts: mcp=./mcp`; compose dev
  `additional_contexts`), installed at `/mcp`.
- nginx: `location /mcp` and `location /.well-known/oauth-` → backend.
- Migration 100: `OAuthClients`, `OAuthRequests` (pending consent and codes),
  `OAuthConnections`. Settings keys `mcp.enabled` (false), `mcp.allowWrites`
  (false), `mcp.allowedDomains`.

## Left to the builder

Table column details, how expired rows are pruned (a daily job is fine), UI
copy within the house style, and exact rate-limit numbers.
