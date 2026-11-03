// The PRISM agent's API (8a), mounted at /api/v1/agent. Not behind the staff
// guard: agents have no session. Enrolment is authenticated by the
// enrolment key; every other route by the device's request signature
// (middleware/agentAuth, task 3).
const path = require('path');
const express = require('express');
const { asyncHandler } = require('../middleware/error');
const {
  agentEnrollLimiter, agentHeartbeatLimiter, agentInventoryLimiter, agentTrayTicketLimiter,
} = require('../middleware/rateLimit');
const { agentAuth, agentAuthenticate } = require('../middleware/agentAuth');
const { applyInventory } = require('../services/agent/inventory');
const { ApiError } = require('../middleware/error');
const { enroll, INTERVALS } = require('../services/agent/enrollment');
const { whoami, raiseTrayTicket } = require('../services/agent/trayTickets');
const { updateKey, updateFor, latestPackage } = require('../services/agent/updates');

const router = express.Router();

// POST /agent/v1/enroll
router.post('/v1/enroll', agentEnrollLimiter, asyncHandler(async (req, res) => {
  const { device } = await enroll(req.body, req);
  res.status(201).json({
    deviceId: device.id,
    // The install's update-signing public key: the agent installs only
    // builds signed with it (task 6).
    updatePublicKey: (await updateKey()).publicKeyB64,
    intervals: INTERVALS,
  });
}));

// POST /agent/v1/heartbeat { agentVersion, signedInUser? } → { update }
// "I'm here": sets last seen and the running version. `update` says whether
// a newer signed build is waiting (task 6).
router.post('/v1/heartbeat', agentAuthenticate, agentHeartbeatLimiter, asyncHandler(async (req, res) => {
  const { agentVersion, signedInUser } = req.body || {};
  if (typeof agentVersion !== 'string' || !/^[0-9A-Za-z.+-]{1,50}$/.test(agentVersion)) {
    throw new ApiError(400, 'agentVersion is not valid', 'VALIDATION_ERROR');
  }
  const changes = { lastSeenAt: new Date(), agentVersion };
  const account = signedInUser && typeof signedInUser.account === 'string' ? signedInUser.account.trim().slice(0, 255) : null;
  if (account !== null) changes.inventory = { ...(req.device.inventory || {}), signedInUser: { account } };
  await req.device.update(changes);
  // A package problem (missing, altered) never fails the heartbeat: the
  // agent just isn't offered an update, and GET /v1/update says why.
  let update = null;
  try {
    update = await updateFor(req.device);
  } catch (err) {
    if (err.status !== 404) throw err;
  }
  res.json({ update });
}));

// POST /agent/v1/inventory → { changedFields, software: { added, removed } }
// The computer's hardware, OS, network, software and signed-in user, into
// its Asset (services/agent/inventory). Up to 1 MB: a long software list.
router.post('/v1/inventory', agentAuth({ maxBody: 1024 * 1024 }), agentInventoryLimiter, asyncHandler(async (req, res) => {
  res.json(await applyInventory(req.device, req.body));
}));

// GET /agent/v1/tray/whoami?account=&upn= → { name, company, department,
// computer, helpdesk: { name, email, portalUrl } }. Fills the tray's form.
// The agent's service passes the account the tray's pipe token belongs to.
router.get('/v1/tray/whoami', agentAuthenticate, asyncHandler(async (req, res) => {
  res.json(await whoami(req.device, req.query));
}));

// POST /agent/v1/tray/tickets { account, upn?, subject, description, snapshot }
// → { ticketId, number }
router.post('/v1/tray/tickets', agentAuthenticate, agentTrayTicketLimiter, asyncHandler(async (req, res) => {
  res.status(201).json(await raiseTrayTicket(req.device, req.body, req));
}));

// GET /agent/v1/update → { version, sha256, size, signature }, or 204 when
// this device's agent is up to date. The signature is Ed25519, with the
// install's update key, over "platform|arch|version|sha256". The platform
// and arch are the device's own, as enrolled.
router.get('/v1/update', agentAuthenticate, asyncHandler(async (req, res) => {
  const update = await updateFor(req.device);
  if (!update) return res.status(204).end();
  return res.json(update);
}));

// GET /agent/v1/update/download → the package's bytes (signed request: no
// package is public). The agent checks the sha256 and the signature from
// GET /v1/update before installing.
router.get('/v1/update/download', agentAuthenticate, asyncHandler(async (req, res) => {
  const pkg = latestPackage(req.device.platform, req.device.arch);
  if (!pkg) throw new ApiError(404, 'The agent package is not available', 'NOT_FOUND');
  res.set('X-Prism-Version', pkg.version);
  res.set('X-Prism-Sha256', pkg.sha256);
  await new Promise((resolve, reject) => {
    res.sendFile(pkg.file, {
      dotfiles: 'deny', headers: { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${path.basename(pkg.file)}"` },
    }, (err) => (err && !res.headersSent ? reject(err) : resolve()));
  });
}));

module.exports = router;
