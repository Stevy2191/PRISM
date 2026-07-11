// Fully public — no auth middleware anywhere in this file. A contact reaches
// these routes via a link in the CSAT survey email; they have no PRISM login.
const express = require('express');
const ctrl = require('../controllers/surveyController');

const router = express.Router();

router.get('/:token', ctrl.getSurvey);
router.post('/:token', ctrl.submitRateLimit, ctrl.submitSurvey);

module.exports = router;
