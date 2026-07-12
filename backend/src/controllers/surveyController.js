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

// surveyToken is always a generated UUID v4 (see CsatSurvey model / the
// scheduler that mints these) — rejecting anything else before it ever
// reaches the DB avoids a wasted query for garbage/oversized input on a
// fully public, unauthenticated endpoint.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isValidToken(token) {
  return typeof token === 'string' && UUID_RE.test(token);
}

// GET /survey/:token — details needed to render the page, or a reason it
// can't be filled out (expired / already responded / not found).
const getSurvey = asyncHandler(async (req, res) => {
  if (!isValidToken(req.params.token)) throw new ApiError(404, 'Survey not found', 'NOT_FOUND');
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

// POST /survey/:token — { rating: 1-5, comment? } — rate-limited at the
// route level (see middleware/rateLimit.js's surveySubmitLimiter).
const submitSurvey = asyncHandler(async (req, res) => {
  if (!isValidToken(req.params.token)) throw new ApiError(404, 'Survey not found', 'NOT_FOUND');
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

module.exports = { getSurvey, submitSurvey };
