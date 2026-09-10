require('dotenv').config();

const fs = require('fs');

// Configuration is validated before anything else is constructed — an
// insecure secret must stop the process, not be discovered later.
const { validateEnv } = require('./config/validateEnv');

validateEnv();

const sequelize = require('./config/database');
const { createApp, createSessionStore } = require('./app');
const { UPLOAD_ROOT } = require('./middleware/upload');
const { startWorkflowScheduler } = require('./services/workflowScheduler');
const { startAdSyncScheduler } = require('./services/adSyncScheduler');
const { startCalendarSyncScheduler } = require('./services/calendarSyncScheduler');
const { startInboundEmailScheduler } = require('./services/inboundEmailScheduler');
const { startCsatScheduler } = require('./services/csatScheduler');
const { startAssetAlertScheduler } = require('./services/assetAlertScheduler');

const PORT = parseInt(process.env.PORT, 10) || 3001;

const sessionStore = createSessionStore();
const app = createApp({ sessionStore });

// A rejected promise with no handler (a directory server going away
// mid-search, an IMAP socket dropping) used to terminate the process and take
// every logged-in user down with it. Log and keep serving instead: these
// failures are almost always confined to one background job.
process.on('unhandledRejection', (reason) => {
  console.error('[prism] unhandled promise rejection:', reason);
});

// An uncaught exception leaves the process in an unknown state, so this only
// buys enough time to finish in-flight responses before exiting; the container
// restart policy brings PRISM back.
process.on('uncaughtException', (err) => {
  console.error('[prism] uncaught exception — shutting down:', err);
  shutdown('uncaughtException', 1);
});

let server = null;
let shuttingDown = false;

// Stop accepting connections, let in-flight requests finish, then close the
// database pool. Without this a deploy severs open requests mid-write.
function shutdown(signal, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[prism] ${signal} received — shutting down gracefully`);

  const finish = async () => {
    try {
      await sequelize.close();
    } catch (err) {
      console.error('[prism] error closing database pool:', err);
    }
    process.exit(exitCode);
  };

  if (!server) {
    finish();
    return;
  }

  server.close(finish);

  // Don't hang forever on a stuck connection.
  setTimeout(() => {
    console.error('[prism] graceful shutdown timed out — forcing exit');
    process.exit(exitCode || 1);
  }, 15000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

async function start() {
  try {
    // Ensure the uploads directory exists.
    fs.mkdirSync(UPLOAD_ROOT, { recursive: true });

    await sequelize.authenticate();
    console.log('[db] connection established');

    // Create the session table if missing (schema for app tables comes from migrations).
    await sessionStore.sync();

    server = app.listen(PORT, () => {
      console.log(`[prism] backend listening on port ${PORT}`);
    });

    // A port collision arrives as an 'error' event, not a throw — without this
    // listener it surfaces as an unhandled 'error' event and a bare stack trace.
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`[prism] port ${PORT} is already in use — is another instance running?`);
      } else {
        console.error('[prism] server error:', err);
      }
      process.exit(1);
    });

    startWorkflowScheduler();
    startAdSyncScheduler();
    startCalendarSyncScheduler();
    startInboundEmailScheduler();
    startCsatScheduler();
    startAssetAlertScheduler();
  } catch (err) {
    console.error('[prism] failed to start:', err);
    process.exit(1);
  }
}

start();

module.exports = app;
