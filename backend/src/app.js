// Express application assembly. Kept separate from index.js (which owns
// process concerns: env validation, database connection, listening,
// schedulers, shutdown) so tests can exercise the real app with supertest
// without binding a port or starting background jobs.
const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const session = require('express-session');
const SequelizeStore = require('connect-session-sequelize')(session.Store);

const sequelize = require('./config/database');
const { resolveTrustProxy } = require('./config/validateEnv');
require('./models'); // register models + associations
const apiRoutes = require('./routes');
const { notFound, errorHandler } = require('./middleware/error');
const { sameOriginWrites } = require('./middleware/sameOrigin');

const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const PORTAL_API_PATH = '/api/v1/portal';
const PORTAL_PATH_RE = /^\/api\/v1\/portal(\/|$)/i;

function portalSessionSecret() {
  return crypto.createHmac('sha256', process.env.SESSION_SECRET).update('prism.portal.sid').digest('hex');
}

function createSessionStore() {
  return new SequelizeStore({
    db: sequelize,
    tableName: 'Sessions',
    checkExpirationInterval: 15 * 60 * 1000,
    expiration: SESSION_MAX_AGE_MS,
  });
}

function createApp({ sessionStore } = {}) {
  const app = express();
  const store = sessionStore || createSessionStore();

  // Whether X-Forwarded-For is believed. Defaults to false: trusting it while
  // the backend is reachable directly lets a client forge its source IP and
  // reset the login rate limiter at will. Deployments behind the bundled nginx
  // set TRUST_PROXY=1.
  app.set('trust proxy', resolveTrustProxy(process.env));

  // Standard security headers. This backend is a pure JSON API (no HTML
  // rendering, no cross-origin asset requests — the frontend always reaches it
  // through a same-origin proxy, see vite.config.js / nginx.conf), so helmet's
  // defaults apply cleanly with no per-directive tuning needed.
  app.use(helmet());

  app.use(
    cors({
      // In the default Docker Compose setup all browser requests are same-origin
      // (nginx reverse-proxy), so CORS headers are not required. Set CORS_ORIGIN
      // when the frontend is served from a different origin than the backend.
      origin: process.env.CORS_ORIGIN
        ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim())
        : false,
      credentials: true,
    })
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  // SESSION_SECRET has no fallback on purpose. It signs session cookies and
  // derives the key protecting stored credentials; validateEnv() refuses to
  // boot without a real one, so reaching here with it unset is a programming
  // error, not something to paper over with a default.
  const sessionOptions = (name, secret, sessionStore, cookie = {}) => ({
    name,
    secret,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.COOKIE_SECURE === 'true',
      maxAge: SESSION_MAX_AGE_MS,
      ...cookie,
    },
  });
  const staffSession = session(sessionOptions('prism.sid', process.env.SESSION_SECRET, store));
  // The client portal's contact session (sub-project 7). Its own cookie,
  // scoped to the portal API path, signed with a key derived from the session
  // secret, so neither cookie verifies as the other.
  // express-session writes its own store.generate (which sets the new
  // session's cookie options) onto the store it is given, so the two
  // instances can't be handed the same object: the second would give staff
  // sessions the portal's cookie path. Object.create shares the table and
  // every method while keeping each instance's generate apart.
  const portalSession = session(sessionOptions('prism.portal.sid', portalSessionSecret(), Object.create(store), { path: PORTAL_API_PATH }));
  // Exactly one session per request: portal paths see only the portal
  // session and every other path only the staff one. Two instances can't
  // share req.session, and this is what keeps a contact session off staff
  // routes and a staff session off the portal. Case-insensitive, as routing is.
  app.use((req, res, next) => (PORTAL_PATH_RE.test(req.path) ? portalSession : staffSession)(req, res, next));

  app.use('/api/v1', sameOriginWrites, apiRoutes);

  // Unmatched routes + central error handler.
  app.use(notFound);
  app.use(errorHandler);

  app.locals.sessionStore = store;
  return app;
}

module.exports = { createApp, createSessionStore, SESSION_MAX_AGE_MS };
