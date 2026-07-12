// Rate limiters for abuse-prone / high-value endpoints, plus one generous
// catch-all for everything else. All keyed by the authenticated user when
// available (req.user is already attached by the time these run, since they
// sit after `authenticate` in the guard chain) and fall back to IP for
// endpoints that run before/without authentication (login, the public
// survey link).
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

// ipKeyGenerator normalizes IPv6 addresses to a /64 prefix before using them
// as a key — using req.ip directly would let an IPv6 client cycle through
// addresses within its own subnet to dodge the limit.
function keyByUserOrIp(req) {
  return req.user ? `user:${req.user.id}` : `ip:${ipKeyGenerator(req.ip)}`;
}

// POST /auth/login — 10 attempts per 15 minutes per IP. Runs before
// authentication (there's no user yet), so this is IP-keyed same as the
// login-specific limiter it replaces.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: true, message: 'Too many login attempts, please try again later', code: 'RATE_LIMITED' },
});

// POST /survey/:token — fully public, unauthenticated. 5 submissions per
// hour per IP.
const surveySubmitLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: true, message: 'Too many attempts, please try again later', code: 'RATE_LIMITED' },
});

// POST /contacts/import(/parse) — authenticated, 5 imports per hour per user
// (a bulk write/parse operation, not a per-row action).
const contactsImportLimiter = rateLimit({
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
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: keyByUserOrIp,
  message: { error: true, message: 'Too many requests, please slow down', code: 'RATE_LIMITED' },
});

module.exports = { loginLimiter, surveySubmitLimiter, contactsImportLimiter, globalLimiter };
