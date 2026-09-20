# PRISM SSO — design

Adds SAML 2.0 and OIDC single sign-on alongside the existing local-account and
LDAP authentication.

## Decisions

| Decision | Choice |
|---|---|
| Protocols | Both OIDC and SAML 2.0. OIDC built first; SAML reuses its provider model, provisioning and mapping. |
| Identity matching | The IdP's stable subject claim (OIDC `sub`, SAML `NameID`). Email is synced as an attribute and never used to decide identity. |
| Provisioning | Just-in-time on first login. New users get no permissions unless a group mapping matches — the same fail-closed default AD provisioning has. |
| Role assignment | IdP group/role claims mapped to PRISM roles, re-evaluated on every login. |
| Provider count | Many, each independently OIDC or SAML. |
| Coexistence | All methods work by default. An admin may enforce "SSO only", which exempts accounts flagged break-glass. |

Out of scope: SCIM provisioning, IdP-initiated login (SP-initiated only), and
Single Logout. Local logout already ends the PRISM session; SLO is
protocol-heavy and inconsistently implemented across IdPs.

## Libraries

- **`openid-client` v6** — OpenID-certified. **ESM-only**, so it is reached
  from this CommonJS codebase through a cached dynamic `import()`.
  Its `allowInsecureRequests` export is what makes a plain-http mock issuer
  testable.
- **`@node-saml/node-saml` v5** — CommonJS. The maintained core that
  `passport-saml` wraps. (The standalone `passport-saml` package is
  deprecated; it is deliberately not used.)

Passport itself is not used. It carries its own session serialization layer
that would sit awkwardly beside PRISM's existing `req.session.userId` +
`authenticate` middleware, and neither library needs it.

## Data model

Four tables.

**`SsoProviders`** — one row per IdP.
`name`, `slug` (URL-safe, used in callback paths), `protocol` (`oidc` |
`saml`), `isEnabled`, `buttonLabel`, `config` (JSON, protocol-specific),
`clientSecret` / `spPrivateKey` (encrypted at rest via the existing
`utils/tokenCrypto`), `allowJit`, `defaultRoleId`, timestamps.

OIDC `config`: `issuerUrl`, `clientId`, `scopes`, `groupsClaim`.
SAML `config`: `entryPoint`, `issuer`, `idpCert`, `wantAssertionsSigned`,
`signatureAlgorithm`, `groupsAttribute`.

**`SsoIdentities`** — `providerId`, `subject`, `userId`, `lastLoginAt`.
Unique on `(providerId, subject)`. A table rather than a column on `User`
because one person may legitimately hold identities at more than one IdP.

**`SsoGroupMappings`** — `providerId`, `claimValue`, `roleId`.
Unique on `(providerId, claimValue)`. Mirrors the existing `AdGroupMapping`.

**`SsoAuthRequests`** — in-flight login state: `state`, `providerId`,
`nonce`, `codeVerifier`, `relayState`, `returnTo`, `expiresAt`, `consumedAt`.
Single-use and expiring.

One column is added to `Users`: `isBreakGlass` (boolean, default false).

### Why login state lives in a table, not the session

SAML's HTTP-POST binding returns the assertion as a **cross-site form POST** to
the ACS endpoint. PRISM's session cookie is `sameSite: 'lax'`, which the
browser will not send on a cross-site POST — so anything stashed in the
pre-login session is unavailable exactly when SAML needs it.

Keeping state server-side, keyed by `state`/`RelayState`, solves that and
gives OIDC single-use expiring state for the same code path, rather than the
two protocols diverging.

## Flow

1. `GET /api/v1/sso/providers` — public. Returns enabled providers (id, slug,
   label) so the login page can render a button per provider. No secrets.
2. `GET /api/v1/sso/:slug/start` — creates an `SsoAuthRequest` and redirects to
   the IdP. OIDC uses PKCE (S256) plus `state` and `nonce`; SAML sends an
   `AuthnRequest` with the request id carried in `RelayState`.
3. Callback — `GET /api/v1/sso/:slug/callback` for OIDC,
   `POST /api/v1/sso/:slug/acs` for SAML. Both: look up the auth request,
   reject if missing, expired or already consumed, mark consumed, validate the
   IdP's response, then resolve the identity.
4. Identity resolution (`ssoService.resolveIdentity`):
   - find `SsoIdentity` by `(providerId, subject)`;
   - if none and JIT is enabled, create a `User` (no password, not a local
     account) plus the identity row; if JIT is disabled, fail closed;
   - sync `displayName` / `email` from the assertion;
   - re-evaluate group mappings and set the user's roles accordingly;
   - refuse if the user is inactive.
5. `req.session.regenerate()`, set `req.session.userId`, audit, redirect to the
   validated return path.

SAML additionally exposes `GET /api/v1/sso/:slug/metadata` so an IdP can be
configured from SP metadata.

## Security

- **Session fixation** — the session is regenerated on SSO login, matching the
  fix applied to password login.
- **Replay** — `SsoAuthRequests` are single-use and expiring. SAML assertions
  are additionally checked against `InResponseTo` and their `NotOnOrAfter`
  window by node-saml.
- **Open redirect** — `returnTo` is accepted only as a same-site path
  (`/^\/(?!\/)/`); anything else falls back to `/dashboard`.
- **Secrets at rest** — client secrets and SP private keys are encrypted with
  `tokenCrypto` and never read back to the UI, matching how the LDAP bind
  password is handled.
- **Enforcement lockout** — "SSO only" refuses to activate unless at least one
  enabled break-glass account exists, so a misconfigured IdP cannot lock an
  organisation out of its own helpdesk.
- **Provisioning is fail-closed** — a JIT user with no matching group mapping
  and no configured default role receives no permissions.
- **Rate limiting** — the start and callback endpoints are limited, since they
  are unauthenticated and create rows.

## Testing

A mock IdP fixture serves both protocols locally: a minimal OIDC issuer
(discovery document, JWKS, token endpoint signing real RS256 id_tokens) and a
SAML responder signing assertions with a self-signed cert generated in the
fixture. `allowInsecureRequests` permits the http issuer under test only.

Covered: happy path for both protocols; replayed state; expired state;
unknown/tampered signature; JIT disabled; group-mapping add and removal;
inactive user; open-redirect attempt; and "SSO only" enforcement including the
break-glass exemption and the refusal to enable without one.
