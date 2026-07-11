// Fully public (no auth) — the contact reaches this via an emailed link with
// no PRISM login. See routes/survey.js for the (deliberately guard-free)
// mount point.
const { CsatSurvey, Ticket } = require('../models');
const { ApiError, asyncHandler } = require('../middleware/error');
const { getAllSettings } = require('./settingsController');

function isExpired(survey, expiryDays) {
  const anchor = survey.sentAt || survey.createdAt;
  return Date.now() - new Date(anchor).getTime() > expiryDays * 86400000;
}

// GET /survey/:token — details needed to render the page, or a reason it
// can't be filled out (expired / already responded / not found).
const getSurvey = asyncHandler(async (req, res) => {
  const survey = await CsatSurvey.findOne({
    where: { surveyToken: req.params.token },
    include: [{ model: Ticket, as: 'ticket', attributes: ['id', 'title'] }],
  });
  if (!survey) throw new ApiError(404, 'Survey not found', 'NOT_FOUND');

  const settings = await getAllSettings();
  const expiryDays = Number(settings['csat.expiryDays']) || 7;

  if (survey.status === 'responded') {
    return res.json({ status: 'responded', message: 'This survey has already been completed.' });
  }
  if (survey.status === 'expired' || isExpired(survey, expiryDays)) {
    if (survey.status !== 'expired') await survey.update({ status: 'expired' });
    return res.json({ status: 'expired', message: 'This survey link has expired.' });
  }

  return res.json({
    status: 'pending',
    question: settings['csat.surveyQuestion'] || 'How satisfied were you with the support you received?',
    ticketNumber: String(survey.ticket.id).padStart(5, '0'),
    ticketTitle: survey.ticket.title,
    companyName: settings['company.name'] || '',
  });
});

// Very light abuse guard — a survey token is a full UUID (128 bits), so
// brute-forcing isn't realistically feasible, but repeated bad requests to
// the same token (script re-submitting, etc.) are still worth capping.
const submitAttempts = new Map();
const SUBMIT_WINDOW_MS = 15 * 60 * 1000;
const SUBMIT_MAX = 10;
function submitRateLimit(req, res, next) {
  const key = req.ip || 'unknown';
  const now = Date.now();
  const record = submitAttempts.get(key);
  if (!record || now > record.resetAt) {
    submitAttempts.set(key, { count: 1, resetAt: now + SUBMIT_WINDOW_MS });
    return next();
  }
  record.count += 1;
  if (record.count > SUBMIT_MAX) {
    return res.status(429).json({ error: true, message: 'Too many attempts, please try again later', code: 'RATE_LIMITED' });
  }
  return next();
}

// POST /survey/:token — { rating: 1-5, comment? }
const submitSurvey = asyncHandler(async (req, res) => {
  const survey = await CsatSurvey.findOne({ where: { surveyToken: req.params.token } });
  if (!survey) throw new ApiError(404, 'Survey not found', 'NOT_FOUND');

  const settings = await getAllSettings();
  const expiryDays = Number(settings['csat.expiryDays']) || 7;

  if (survey.status === 'responded') {
    throw new ApiError(409, 'This survey has already been completed.', 'ALREADY_RESPONDED');
  }
  if (survey.status === 'expired' || isExpired(survey, expiryDays)) {
    if (survey.status !== 'expired') await survey.update({ status: 'expired' });
    throw new ApiError(410, 'This survey link has expired.', 'EXPIRED');
  }

  const rating = Number(req.body.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new ApiError(400, 'Rating must be an integer from 1 to 5', 'INVALID_RATING');
  }
  const comment = typeof req.body.comment === 'string' ? req.body.comment.trim().slice(0, 5000) : null;

  await survey.update({
    rating,
    comment: comment || null,
    respondedAt: new Date(),
    status: 'responded',
  });

  res.json({ status: 'responded', message: 'Thank you for your feedback! Your response helps us improve our service.' });
});

module.exports = { getSurvey, submitSurvey, submitRateLimit };
