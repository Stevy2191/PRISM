const { Op } = require('sequelize');
const crypto = require('crypto');
const { UserCalendarIntegration, CalendarEventCache } = require('../models');
const { ApiError, asyncHandler } = require('../middleware/error');
const { writeAudit } = require('../middleware/audit');
const { encryptToken } = require('../utils/tokenCrypto');
const { getAllSettings } = require('./settingsController');
const { syncIntegration, ensureValidAccessToken, providerCredentials } = require('../services/calendarSync');
const google = require('../services/googleCalendar');
const microsoft = require('../services/microsoftCalendar');
const ical = require('../services/icalCalendar');

const PROVIDER_LIBS = { google, microsoft };

// OAuth callbacks are a top-level browser redirect back to our own origin,
// so building an absolute callback URL from the live request (rather than a
// dedicated env var) mirrors this app's existing "same-origin by default"
// deployment story (see index.js's CORS_ORIGIN comment).
function callbackUrl(req, provider) {
  return `${req.protocol}://${req.get('host')}/api/v1/calendar/integrations/${provider}/callback`;
}

// GET /calendar/integrations
const list = asyncHandler(async (req, res) => {
  const integrations = await UserCalendarIntegration.findAll({
    where: { userId: req.user.id },
    order: [['createdAt', 'ASC']],
  });
  res.json({ integrations });
});

// POST /calendar/integrations — iCal only (Google/Microsoft go through OAuth).
const create = asyncHandler(async (req, res) => {
  const { provider, name, color, icalUrl } = req.body || {};
  if (provider !== 'ical') {
    throw new ApiError(400, 'Only iCal integrations can be created directly — use the OAuth connect flow for Google/Microsoft', 'VALIDATION_ERROR');
  }
  if (!name || !name.trim()) throw new ApiError(400, 'Calendar name is required', 'VALIDATION_ERROR');
  if (!icalUrl || !icalUrl.trim()) throw new ApiError(400, 'iCal URL is required', 'VALIDATION_ERROR');

  try {
    await ical.testIcalUrl(icalUrl);
  } catch (err) {
    throw new ApiError(400, `That URL doesn't look like a valid iCal feed: ${err.message}`, 'INVALID_ICAL_URL');
  }

  const integration = await UserCalendarIntegration.create({
    userId: req.user.id,
    provider: 'ical',
    name: name.trim(),
    color: color || '#2563eb',
    icalUrl: icalUrl.trim(),
    isActive: true,
  });
  await writeAudit(req, 'calendar_integration.create', 'UserCalendarIntegration', integration.id, { provider: 'ical', name: integration.name });

  await syncIntegration(integration);
  const fresh = await UserCalendarIntegration.findByPk(integration.id);
  res.status(201).json({ integration: fresh });
});

// POST /calendar/integrations/ical/test — { icalUrl } -> { valid, eventCount }
const testIcal = asyncHandler(async (req, res) => {
  const { icalUrl } = req.body || {};
  if (!icalUrl || !icalUrl.trim()) throw new ApiError(400, 'iCal URL is required', 'VALIDATION_ERROR');
  try {
    const result = await ical.testIcalUrl(icalUrl);
    res.json(result);
  } catch (err) {
    res.json({ valid: false, error: err.message });
  }
});

async function loadOwnIntegration(req) {
  const integration = await UserCalendarIntegration.findOne({ where: { id: req.params.id, userId: req.user.id } });
  if (!integration) throw new ApiError(404, 'Calendar integration not found', 'NOT_FOUND');
  return integration;
}

// PATCH /calendar/integrations/:id — name, color, isActive, syncEnabled, calendarId
const update = asyncHandler(async (req, res) => {
  const integration = await loadOwnIntegration(req);
  const { name, color, isActive, syncEnabled, calendarId } = req.body || {};
  const changes = {};
  if (name !== undefined) {
    if (!name.trim()) throw new ApiError(400, 'Calendar name is required', 'VALIDATION_ERROR');
    changes.name = name.trim();
  }
  if (color !== undefined) changes.color = color;
  if (isActive !== undefined) changes.isActive = !!isActive;
  if (syncEnabled !== undefined) {
    if (syncEnabled && integration.provider === 'ical') {
      throw new ApiError(400, 'iCal calendars are read-only and cannot receive pushed PRISM events', 'VALIDATION_ERROR');
    }
    changes.syncEnabled = !!syncEnabled;
  }
  if (calendarId !== undefined) changes.calendarId = calendarId;

  await integration.update(changes);
  await writeAudit(req, 'calendar_integration.update', 'UserCalendarIntegration', integration.id, changes);

  if (calendarId !== undefined) await syncIntegration(integration); // picking a new calendar needs an immediate sync
  const fresh = await UserCalendarIntegration.findByPk(integration.id);
  res.json({ integration: fresh });
});

// DELETE /calendar/integrations/:id
const remove = asyncHandler(async (req, res) => {
  const integration = await loadOwnIntegration(req);
  // No DB-level FK/cascade on CalendarEventCaches.integrationId — clean up
  // explicitly rather than leaving orphaned cache rows behind.
  await CalendarEventCache.destroy({ where: { integrationId: integration.id } });
  await integration.destroy();
  await writeAudit(req, 'calendar_integration.delete', 'UserCalendarIntegration', integration.id, { provider: integration.provider, name: integration.name });
  res.json({ ok: true });
});

// POST /calendar/integrations/:id/sync
const manualSync = asyncHandler(async (req, res) => {
  const integration = await loadOwnIntegration(req);
  const result = await syncIntegration(integration);
  const fresh = await UserCalendarIntegration.findByPk(integration.id);
  res.json({ ...result, integration: fresh });
});

// GET /calendar/integrations/:id/available-calendars
const availableCalendars = asyncHandler(async (req, res) => {
  const integration = await loadOwnIntegration(req);
  const providerLib = PROVIDER_LIBS[integration.provider];
  if (!providerLib) throw new ApiError(400, 'This provider does not support calendar selection', 'VALIDATION_ERROR');

  const creds = await providerCredentials(integration.provider);
  const accessToken = await ensureValidAccessToken(integration, providerLib, creds);
  if (!accessToken) throw new ApiError(409, 'This calendar needs to be reconnected', 'NEEDS_RECONNECT');

  const calendars = await providerLib.listCalendars(accessToken);
  res.json({ calendars });
});

// ---- OAuth: Google ----

const googleAuthUrl = asyncHandler(async (req, res) => {
  const values = await getAllSettings();
  const clientId = values['integrations.googleClientId'];
  if (!clientId || !values['integrations.googleClientSecret']) {
    throw new ApiError(400, 'Google Calendar isn\'t configured yet — an admin needs to set it up in Settings → Integrations → Calendar Integration', 'NOT_CONFIGURED');
  }
  const state = crypto.randomBytes(24).toString('hex');
  req.session.calendarOAuthState = state;
  const url = google.buildAuthUrl({ clientId, redirectUri: callbackUrl(req, 'google'), state });
  res.json({ url });
});

const googleCallback = asyncHandler(async (req, res) => {
  const { code, state, error } = req.query;
  const redirectBase = '/settings/preferences';
  if (error) return res.redirect(`${redirectBase}?calendarError=${encodeURIComponent(String(error))}`);
  if (!state || state !== req.session.calendarOAuthState) {
    return res.redirect(`${redirectBase}?calendarError=${encodeURIComponent('Invalid or expired connection attempt — please try again')}`);
  }
  delete req.session.calendarOAuthState;

  try {
    const values = await getAllSettings();
    const tokens = await google.exchangeCodeForTokens({
      code,
      clientId: values['integrations.googleClientId'],
      clientSecret: values['integrations.googleClientSecret'],
      redirectUri: callbackUrl(req, 'google'),
    });
    const integration = await UserCalendarIntegration.create({
      userId: req.user.id,
      provider: 'google',
      name: 'Google Calendar',
      accessToken: encryptToken(tokens.access_token),
      refreshToken: encryptToken(tokens.refresh_token),
      tokenExpiry: new Date(Date.now() + (tokens.expires_in || 3600) * 1000),
      isActive: true,
    });
    await writeAudit(req, 'calendar_integration.create', 'UserCalendarIntegration', integration.id, { provider: 'google' });
    res.redirect(`${redirectBase}?calendarConnected=google&integrationId=${integration.id}`);
  } catch (err) {
    res.redirect(`${redirectBase}?calendarError=${encodeURIComponent(err.message)}`);
  }
});

// ---- OAuth: Microsoft ----

const microsoftAuthUrl = asyncHandler(async (req, res) => {
  const values = await getAllSettings();
  const clientId = values['integrations.microsoftClientId'];
  if (!clientId || !values['integrations.microsoftClientSecret']) {
    throw new ApiError(400, 'Microsoft Outlook isn\'t configured yet — an admin needs to set it up in Settings → Integrations → Calendar Integration', 'NOT_CONFIGURED');
  }
  const state = crypto.randomBytes(24).toString('hex');
  req.session.calendarOAuthState = state;
  const url = microsoft.buildAuthUrl({
    clientId, redirectUri: callbackUrl(req, 'microsoft'), state, tenantId: values['integrations.microsoftTenantId'],
  });
  res.json({ url });
});

const microsoftCallback = asyncHandler(async (req, res) => {
  const { code, state, error } = req.query;
  const redirectBase = '/settings/preferences';
  if (error) return res.redirect(`${redirectBase}?calendarError=${encodeURIComponent(String(error))}`);
  if (!state || state !== req.session.calendarOAuthState) {
    return res.redirect(`${redirectBase}?calendarError=${encodeURIComponent('Invalid or expired connection attempt — please try again')}`);
  }
  delete req.session.calendarOAuthState;

  try {
    const values = await getAllSettings();
    const tokens = await microsoft.exchangeCodeForTokens({
      code,
      clientId: values['integrations.microsoftClientId'],
      clientSecret: values['integrations.microsoftClientSecret'],
      redirectUri: callbackUrl(req, 'microsoft'),
      tenantId: values['integrations.microsoftTenantId'],
    });
    const integration = await UserCalendarIntegration.create({
      userId: req.user.id,
      provider: 'microsoft',
      name: 'Outlook Calendar',
      accessToken: encryptToken(tokens.access_token),
      refreshToken: encryptToken(tokens.refresh_token),
      tokenExpiry: new Date(Date.now() + (tokens.expires_in || 3600) * 1000),
      isActive: true,
    });
    await writeAudit(req, 'calendar_integration.create', 'UserCalendarIntegration', integration.id, { provider: 'microsoft' });
    res.redirect(`${redirectBase}?calendarConnected=microsoft&integrationId=${integration.id}`);
  } catch (err) {
    res.redirect(`${redirectBase}?calendarError=${encodeURIComponent(err.message)}`);
  }
});

// GET /calendar/external-events?startDate=&endDate=
const externalEvents = asyncHandler(async (req, res) => {
  const { startDate, endDate } = req.query;
  const integrations = await UserCalendarIntegration.findAll({ where: { userId: req.user.id, isActive: true } });
  if (!integrations.length) return res.json({ events: [] });

  const where = {
    integrationId: { [Op.in]: integrations.map((i) => i.id) },
    // Rows PRISM itself pushed out (syncEnabled) get pulled back in on the
    // next sync since they're now real events on the external calendar —
    // exclude them here so a synced ticket doesn't show up twice (once as
    // its native PRISM event, once as an "external" echo of itself).
    prismEventType: { [Op.is]: null },
  };
  if (startDate) where.startDate = { ...(where.startDate || {}), [Op.gte]: new Date(startDate) };
  if (endDate) where.startDate = { ...(where.startDate || {}), [Op.lte]: new Date(`${endDate}T23:59:59`) };

  const cached = await CalendarEventCache.findAll({ where, order: [['startDate', 'ASC']] });
  const integrationById = new Map(integrations.map((i) => [i.id, i]));

  const events = cached.map((e) => {
    const integ = integrationById.get(e.integrationId);
    return {
      id: `external-${e.id}`,
      type: 'external',
      integrationId: integ.id,
      integrationName: integ.name,
      provider: integ.provider,
      color: integ.color,
      title: e.title,
      startDate: e.startDate.toISOString().slice(0, 10),
      endDate: e.endDate ? e.endDate.toISOString().slice(0, 10) : null,
      isAllDay: e.isAllDay,
      location: e.location,
      description: e.description,
      needsReconnect: integ.needsReconnect,
    };
  });
  res.json({ events });
});

module.exports = {
  list, create, testIcal, update, remove, manualSync, availableCalendars,
  googleAuthUrl, googleCallback, microsoftAuthUrl, microsoftCallback, externalEvents,
};
