// The PRISM agent's API (8a), mounted at /api/v1/agent. Not behind the staff
// guard: agents have no session. Enrolment is authenticated by the
// enrolment key; every other route by the device's request signature
// (middleware/agentAuth, task 3).
const express = require('express');
const { asyncHandler } = require('../middleware/error');
const { agentEnrollLimiter } = require('../middleware/rateLimit');
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

module.exports = router;
