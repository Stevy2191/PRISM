// Shared sync logic for one calendar integration — used by both the manual
// "Refresh"/per-integration sync trigger and the 30-minute background job
// (calendarSyncScheduler.js), so there's exactly one place that knows how
// to pull events for a provider and reconcile them into the cache table.
const { Op } = require('sequelize');
const { CalendarEventCache, UserCalendarIntegration } = require('../models');
const { encryptToken, decryptToken } = require('../utils/tokenCrypto');
const { getAllSettings } = require('../controllers/settingsController');
const google = require('./googleCalendar');
const microsoft = require('./microsoftCalendar');
const ical = require('./icalCalendar');

// Matches the Calendar page's own fetch buffer (visible range +/- 1 month) —
// no point caching further out than the UI will ever request without a
// separate fetch anyway.
const SYNC_WINDOW_PAST_DAYS = 45;
const SYNC_WINDOW_FUTURE_DAYS = 90;

async function providerCredentials(provider) {
  const values = await getAllSettings();
  if (provider === 'google') {
    return { clientId: values['integrations.googleClientId'], clientSecret: values['integrations.googleClientSecret'] };
  }
  if (provider === 'microsoft') {
    return {
      clientId: values['integrations.microsoftClientId'],
      clientSecret: values['integrations.microsoftClientSecret'],
      tenantId: values['integrations.microsoftTenantId'],
    };
  }
  return {};
}

// Returns a valid (possibly freshly-refreshed) access token, or null if the
// token is expired/invalid and refresh also failed — callers should treat
// null as "mark needsReconnect and skip this sync."
async function ensureValidAccessToken(integration, providerLib, creds) {
  const withTokens = await UserCalendarIntegration.scope('withTokens').findByPk(integration.id);
  const accessToken = decryptToken(withTokens.accessToken);
  const refreshToken = decryptToken(withTokens.refreshToken);
  const expiry = withTokens.tokenExpiry ? new Date(withTokens.tokenExpiry) : null;
  const stillValid = accessToken && expiry && expiry.getTime() - Date.now() > 60000; // 1 min safety margin
  if (stillValid) return accessToken;
  if (!refreshToken) return null;

  try {
    const refreshed = await providerLib.refreshAccessToken({ refreshToken, ...creds });
    const newExpiry = new Date(Date.now() + (refreshed.expires_in || 3600) * 1000);
    await withTokens.update({
      accessToken: encryptToken(refreshed.access_token),
      // Google/Microsoft don't always reissue a refresh_token — keep the old one if absent.
      refreshToken: refreshed.refresh_token ? encryptToken(refreshed.refresh_token) : withTokens.refreshToken,
      tokenExpiry: newExpiry,
      needsReconnect: false,
    });
    return refreshed.access_token;
  } catch {
    await withTokens.update({ needsReconnect: true });
    return null;
  }
}

async function reconcileCache(integrationId, freshEvents) {
  const now = new Date();
  const existing = await CalendarEventCache.findAll({ where: { integrationId }, attributes: ['id', 'externalEventId'] });
  const existingByExternalId = new Map(existing.map((e) => [e.externalEventId, e.id]));
  const freshIds = new Set(freshEvents.map((e) => e.externalEventId));

  // eslint-disable-next-line no-restricted-syntax
  for (const ev of freshEvents) {
    const payload = {
      integrationId,
      externalEventId: ev.externalEventId,
      title: ev.title,
      startDate: ev.startDate,
      endDate: ev.endDate,
      isAllDay: ev.isAllDay,
      location: ev.location,
      description: ev.description,
      lastFetched: now,
    };
    if (existingByExternalId.has(ev.externalEventId)) {
      // eslint-disable-next-line no-await-in-loop
      await CalendarEventCache.update(payload, { where: { integrationId, externalEventId: ev.externalEventId } });
    } else {
      // eslint-disable-next-line no-await-in-loop
      await CalendarEventCache.create(payload);
    }
  }

  const staleIds = existing.filter((e) => !freshIds.has(e.externalEventId)).map((e) => e.id);
  if (staleIds.length) await CalendarEventCache.destroy({ where: { id: { [Op.in]: staleIds } } });
}

// Syncs one integration. Never throws — sync failures are recorded on the
// integration row (needsReconnect) rather than bubbling up, since both call
// sites (manual trigger, background job) sync many integrations in a loop
// and one bad integration shouldn't abort the rest.
async function syncIntegration(integration) {
  const timeMin = new Date(Date.now() - SYNC_WINDOW_PAST_DAYS * 86400000);
  const timeMax = new Date(Date.now() + SYNC_WINDOW_FUTURE_DAYS * 86400000);

  try {
    let events;
    if (integration.provider === 'ical') {
      events = await ical.fetchIcalEvents(integration.icalUrl);
      events = events.filter((e) => e.startDate >= timeMin && e.startDate <= timeMax);
    } else {
      const providerLib = integration.provider === 'google' ? google : microsoft;
      const creds = await providerCredentials(integration.provider);
      const accessToken = await ensureValidAccessToken(integration, providerLib, creds);
      if (!accessToken) return { ok: false, reason: 'needsReconnect' };
      events = await providerLib.listEvents(accessToken, integration.calendarId, timeMin, timeMax);
    }
    await reconcileCache(integration.id, events);
    await integration.update({ lastSynced: new Date(), needsReconnect: false });
    return { ok: true, count: events.length };
  } catch (err) {
    // A transient fetch failure (network blip, provider outage) isn't the
    // same as an expired token — don't force a reconnect for those, just
    // leave the existing cache in place and try again next cycle.
    return { ok: false, reason: err.message };
  }
}

module.exports = { syncIntegration, ensureValidAccessToken, providerCredentials, SYNC_WINDOW_PAST_DAYS, SYNC_WINDOW_FUTURE_DAYS };
