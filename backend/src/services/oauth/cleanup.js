// Daily housekeeping for Claude connections (MCP-O). Apps can register
// themselves, so without this, abandoned consents, spent codes, dead
// connections and apps that never connected would pile up forever.
//   - consents and codes: a day after they expired (they live 10 minutes)
//   - connections: 30 days after they were revoked or their refresh expired
//     (kept that long so Settings › Claude and the audit trail make sense)
//   - apps: a day after registering, once nothing refers to them
const { Op } = require('sequelize');
const {
  OAuthRequest, OAuthConnection, OAuthClient, sequelize,
} = require('../../models');

const DAY_MS = 24 * 60 * 60 * 1000;
const CHECK_INTERVAL_MS = DAY_MS;
let started = false;

async function pruneOAuth(now = new Date()) {
  const dayAgo = new Date(now.getTime() - DAY_MS);
  const monthAgo = new Date(now.getTime() - 30 * DAY_MS);
  const requests = await OAuthRequest.destroy({ where: { expiresAt: { [Op.lt]: dayAgo } } });
  const connections = await OAuthConnection.destroy({
    where: { [Op.or]: [{ revokedAt: { [Op.lt]: monthAgo } }, { refreshExpiresAt: { [Op.lt]: monthAgo } }] },
  });
  const clients = await OAuthClient.destroy({
    where: {
      createdAt: { [Op.lt]: dayAgo },
      id: { [Op.notIn]: sequelize.literal('(SELECT clientId FROM OAuthConnections UNION SELECT clientId FROM OAuthRequests)') },
    },
  });
  return { requests, connections, clients };
}

function startOAuthCleanup() {
  if (started) return;
  started = true;
  const run = () => pruneOAuth().catch((err) => console.error('[oauth-cleanup] failed:', err.message));
  run();
  setInterval(run, CHECK_INTERVAL_MS).unref();
  console.log('[oauth-cleanup] started (daily)');
}

module.exports = { pruneOAuth, startOAuthCleanup };
