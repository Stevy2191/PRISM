// Express application assembly. Kept separate from index.js (which owns
// process concerns: env validation, database connection, listening,
// schedulers, shutdown) so tests can exercise the real app with supertest
// without binding a port or starting background jobs.
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

const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

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
  app.use(
    session({
      name: 'prism.sid',
      secret: process.env.SESSION_SECRET,
      store,
      resave: false,
      saveUninitialized: false,
      rolling: true,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.COOKIE_SECURE === 'true',
        maxAge: SESSION_MAX_AGE_MS,
      },
    })
  );

  app.use('/api/v1', apiRoutes);

  // Unmatched routes + central error handler.
  app.use(notFound);
  app.use(errorHandler);

  app.locals.sessionStore = store;
  return app;
}

module.exports = { createApp, createSessionStore, SESSION_MAX_AGE_MS };
