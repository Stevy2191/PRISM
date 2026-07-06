require('dotenv').config();

const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const session = require('express-session');
const SequelizeStore = require('connect-session-sequelize')(session.Store);

const sequelize = require('./config/database');
require('./models'); // register models + associations
const apiRoutes = require('./routes');
const { notFound, errorHandler } = require('./middleware/error');
const { UPLOAD_ROOT } = require('./middleware/upload');
const { startWorkflowScheduler } = require('./services/workflowScheduler');

const app = express();
const PORT = parseInt(process.env.PORT, 10) || 3001;

// Refuse to start with a guessable session secret in production — it lets an
// attacker forge session cookies for any user.
if (
  process.env.NODE_ENV === 'production' &&
  (!process.env.SESSION_SECRET || process.env.SESSION_SECRET === 'changeme')
) {
  console.error(
    '[prism] SESSION_SECRET is unset or left as the "changeme" placeholder. ' +
      'Set a strong random value in .env before starting in production.'
  );
  process.exit(1);
}

// Trust the reverse proxy (frontend nginx) so secure cookies work behind it.
app.set('trust proxy', 1);

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
app.use(express.urlencoded({ extended: true }));

// Session store backed by MariaDB.
const sessionStore = new SequelizeStore({
  db: sequelize,
  tableName: 'Sessions',
  checkExpirationInterval: 15 * 60 * 1000,
  expiration: 24 * 60 * 60 * 1000,
});

app.use(
  session({
    name: 'prism.sid',
    secret: process.env.SESSION_SECRET || 'changeme',
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.COOKIE_SECURE === 'true',
      maxAge: 24 * 60 * 60 * 1000,
    },
  })
);

app.use('/api/v1', apiRoutes);

// Unmatched routes + central error handler.
app.use(notFound);
app.use(errorHandler);

async function start() {
  try {
    // Ensure the uploads directory exists.
    fs.mkdirSync(UPLOAD_ROOT, { recursive: true });

    await sequelize.authenticate();
    console.log('[db] connection established');

    // Create the session table if missing (schema for app tables comes from migrations).
    await sessionStore.sync();

    app.listen(PORT, () => {
      console.log(`[prism] backend listening on port ${PORT}`);
    });

    startWorkflowScheduler();
  } catch (err) {
    console.error('[prism] failed to start:', err);
    process.exit(1);
  }
}

start();

module.exports = app;
