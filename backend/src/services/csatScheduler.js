// Sends due CSAT survey emails and expires stale ones. Modeled on
// workflowScheduler.js — single backend instance, no Redis/cron framework,
// so a plain setInterval polling loop is the established pattern here.
const { Op } = require('sequelize');
const { CsatSurvey, Ticket, Contact, SystemSettings } = require('../models');
const { getAllSettings } = require('../controllers/settingsController');
const { buildSurveyEmail } = require('./csatService');
const { sendMail } = require('./emailSender');

const CHECK_INTERVAL_MS = 15 * 60 * 1000;

// Surveys whose send delay has elapsed and haven't gone out yet.
async function sendDueSurveys() {
  const settings = await getAllSettings();
  if (settings['csat.enabled'] !== 'true') return;

  const due = await CsatSurvey.findAll({
    where: { status: 'pending', sentAt: null, dueToSendAt: { [Op.lte]: new Date() } },
    include: [
      { model: Ticket, as: 'ticket' },
      { model: Contact, as: 'contact' },
    ],
  });
  if (!due.length) return;

  const question = settings['csat.surveyQuestion'] || 'How satisfied were you with the support you received?';
  const expiryDays = Number(settings['csat.expiryDays']) || 7;
  const companyName = settings['company.name'] || 'Support';

  // eslint-disable-next-line no-restricted-syntax
  for (const survey of due) {
    if (!survey.ticket || !survey.contact?.email) {
      // Ticket or contact vanished since the survey was queued (deleted) —
      // nothing sensible to send; mark expired so it stops being polled.
      // eslint-disable-next-line no-await-in-loop
      await survey.update({ status: 'expired' });
      continue; // eslint-disable-line no-continue
    }
    try {
      const { subject, html, text } = buildSurveyEmail({
        contactFirstName: survey.contact.firstName,
        ticketId: survey.ticket.id,
        ticketTitle: survey.ticket.title,
        question,
        surveyToken: survey.surveyToken,
        expiryDays,
        companyName,
      });
      // eslint-disable-next-line no-await-in-loop
      await sendMail({ to: survey.contact.email, subject, html, text });
      // eslint-disable-next-line no-await-in-loop
      await survey.update({ sentAt: new Date() });
    } catch (err) {
      console.error(`[csat-scheduler] failed to send survey ${survey.id} for ticket ${survey.ticketId}:`, err.message);
    }
  }
}

// Sent surveys nobody responded to within the configured window.
async function expireStaleSurveys() {
  const settings = await getAllSettings();
  const expiryDays = Number(settings['csat.expiryDays']) || 7;
  const cutoff = new Date(Date.now() - expiryDays * 86400000);

  await CsatSurvey.update(
    { status: 'expired' },
    { where: { status: 'pending', sentAt: { [Op.ne]: null, [Op.lte]: cutoff } } }
  );
}

async function runChecks() {
  try {
    await sendDueSurveys();
  } catch (err) {
    console.error('[csat-scheduler] send check failed:', err);
  }
  try {
    await expireStaleSurveys();
  } catch (err) {
    console.error('[csat-scheduler] expiry check failed:', err);
  }
  try {
    await SystemSettings.upsert({ key: 'scheduler.csatLastRun', value: new Date().toISOString() });
  } catch (err) {
    console.error('[csat-scheduler] failed to record last-run timestamp:', err);
  }
}

let started = false;
function startCsatScheduler() {
  if (started) return;
  started = true;
  runChecks();
  setInterval(runChecks, CHECK_INTERVAL_MS);
  console.log('[csat-scheduler] started (checking every 15 minutes)');
}

module.exports = { startCsatScheduler, runChecks };
