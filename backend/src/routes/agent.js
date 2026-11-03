// The PRISM agent's API (8a), mounted at /api/v1/agent. Not behind the staff
// guard: agents have no session. Enrolment is authenticated by the
// enrolment key; every other route by the device's request signature
// (middleware/agentAuth, task 3).
const express = require('express');
const { asyncHandler } = require('../middleware/error');
const { agentEnrollLimiter, agentHeartbeatLimiter } = require('../middleware/rateLimit');
const { agentAuthenticate } = require('../middleware/agentAuth');
const { ApiError } = require('../middleware/error');
const { enroll, INTERVALS } = require('../services/agent/enrollment');

const router = express.Router();

// POST /agent/v1/enroll
router.post('/v1/enroll', agentEnrollLimiter, asyncHandler(async (req, res) => {
  const { device } = await enroll(req.body, req);
  res.status(201).json({
    deviceId: device.id,
    // The install's update-signing public key arrives with task 6.
    updatePublicKey: null,
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
  res.json({ update: null });
}));

module.exports = router;
