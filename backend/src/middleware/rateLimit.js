// Rate limiters for abuse-prone / high-value endpoints, plus one generous
// catch-all for everything else. All keyed by the authenticated user when
// available (req.user is already attached by the time these run, since they
// sit after `authenticate` in the guard chain) and fall back to IP for
// endpoints that run before/without authentication (login, the public
// survey link).
const { rateLimit, ipKeyGenerator, MemoryStore } = require('express-rate-limit');

// ipKeyGenerator normalizes IPv6 addresses to a /64 prefix before using them
// as a key — using req.ip directly would let an IPv6 client cycle through
// addresses within its own subnet to dodge the limit.
function keyByUserOrIp(req) {
  return req.user ? `user:${req.user.id}` : `ip:${ipKeyGenerator(req.ip)}`;
}

// POST /auth/login — 10 attempts per 15 minutes per IP. Runs before
// authentication (there's no user yet), so this is IP-keyed same as the
// login-specific limiter it replaces.
const loginStore = new MemoryStore();
const loginLimiter = rateLimit({
  store: loginStore,
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: true, message: 'Too many login attempts, please try again later', code: 'RATE_LIMITED' },
});

// POST /survey/:token — fully public, unauthenticated. 5 submissions per
// hour per IP.
const surveyStore = new MemoryStore();
const surveySubmitLimiter = rateLimit({
  store: surveyStore,
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: true, message: 'Too many attempts, please try again later', code: 'RATE_LIMITED' },
});

// POST /contacts/import(/parse) — authenticated, 5 imports per hour per user
// (a bulk write/parse operation, not a per-row action).
const contactsImportStore = new MemoryStore();
const contactsImportLimiter = rateLimit({
  store: contactsImportStore,
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: keyByUserOrIp,
  message: { error: true, message: 'Too many import attempts, please try again later', code: 'RATE_LIMITED' },
});

// Everything else behind `guard` — generous, just a backstop against a
// runaway client/script rather than a normal-usage limit. 200 requests/min
// per authenticated user.
const globalStore = new MemoryStore();
const globalLimiter = rateLimit({
  store: globalStore,
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: keyByUserOrIp,
  message: { error: true, message: 'Too many requests, please slow down', code: 'RATE_LIMITED' },
});


// POST /apikeys — an API key is a long-lived bearer credential carrying the
// full permission set of the user who minted it, so creation is deliberately
// slow: 10 per hour per user. Also blunts a compromised session being used to
// mint a persistent foothold.
const apiKeyCreateStore = new MemoryStore();
const apiKeyCreateLimiter = rateLimit({
  store: apiKeyCreateStore,
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: keyByUserOrIp,
  message: { error: true, message: 'Too many API keys created, please try again later', code: 'RATE_LIMITED' },
});

// POST /auth/change-password — throttles online guessing of the *current*
// password by someone holding a hijacked session, which the login limiter
// never sees.
const passwordChangeStore = new MemoryStore();
const passwordChangeLimiter = rateLimit({
  store: passwordChangeStore,
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: keyByUserOrIp,
  message: { error: true, message: 'Too many password change attempts, please try again later', code: 'RATE_LIMITED' },
});


// SSO start/callback — unauthenticated, and each start creates a row. Keyed
// by IP since there is no user yet. Generous enough for a shared egress IP in
// an office, tight enough to stop someone filling the table.
const ssoStore = new MemoryStore();
const ssoLimiter = rateLimit({
  store: ssoStore,
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: true, message: 'Too many sign-on attempts, please try again later', code: 'RATE_LIMITED' },
});

// Clears every limiter's counters. Used by the test suite so one case's
// login attempts don't rate-limit the next; never called at runtime.
function resetRateLimits() {
  [loginStore, surveyStore, contactsImportStore, apiKeyCreateStore, passwordChangeStore, globalStore, ssoStore]
    .forEach((store) => store.resetAll && store.resetAll());
}

module.exports = {
  loginLimiter, surveySubmitLimiter, contactsImportLimiter, globalLimiter,
  apiKeyCreateLimiter, passwordChangeLimiter, ssoLimiter, resetRateLimits,
};
