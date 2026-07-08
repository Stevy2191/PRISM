// Google Calendar OAuth2 + Calendar API v3 client — plain fetch() calls
// rather than the `googleapis` SDK, matching this backend's lean-dependency
// convention (see package.json: no HTTP client library beyond what's built
// into Node). Endpoints are Google's documented, stable OAuth2/Calendar API
// v3 surface.
const AUTH_BASE = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API_BASE = 'https://www.googleapis.com/calendar/v3';

// Read+write scope, since a syncEnabled integration needs to create/update/
// delete events on the user's chosen calendar, not just read it.
const SCOPE = 'https://www.googleapis.com/auth/calendar';

function buildAuthUrl({ clientId, redirectUri, state }) {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline', // required to receive a refresh_token
    prompt: 'consent', // forces refresh_token on every connect, not just the first
    state,
  });
  return `${AUTH_BASE}?${params.toString()}`;
}

async function exchangeCodeForTokens({ code, clientId, clientSecret, redirectUri }) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error_description || body.error || 'Google token exchange failed');
  return body; // { access_token, refresh_token, expires_in, token_type, scope }
}

async function refreshAccessToken({ refreshToken, clientId, clientSecret }) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
    }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error_description || body.error || 'Google token refresh failed');
  return body; // { access_token, expires_in, ... } — refresh_token usually NOT reissued
}

async function apiRequest(accessToken, path, opts = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  if (res.status === 204) return null;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.error?.message || `Google Calendar API error (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return body;
}

async function listCalendars(accessToken) {
  const data = await apiRequest(accessToken, '/users/me/calendarList');
  return (data.items || []).map((c) => ({ id: c.id, name: c.summaryOverride || c.summary, primary: !!c.primary }));
}

async function listEvents(accessToken, calendarId, timeMin, timeMax) {
  const params = new URLSearchParams({
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '2500',
  });
  const data = await apiRequest(accessToken, `/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`);
  return (data.items || []).map((e) => {
    const isAllDay = !!e.start?.date && !e.start?.dateTime;
    return {
      externalEventId: e.id,
      title: e.summary || '(untitled event)',
      startDate: new Date(e.start?.dateTime || e.start?.date),
      endDate: e.end ? new Date(e.end.dateTime || e.end.date) : null,
      isAllDay,
      location: e.location || null,
      description: e.description || null,
    };
  });
}

// ---- Push (PRISM -> Google) ----

function toGoogleEventBody(prismEvent) {
  // prismEvent.dueDate is a plain "YYYY-MM-DD" — every PRISM due date is
  // all-day (see calendar_rebuild memory: no dueTime exists anywhere yet).
  const nextDay = new Date(`${prismEvent.dueDate}T00:00:00Z`);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  return {
    summary: prismEvent.title,
    description: `${prismEvent.type === 'ticket' ? 'PRISM ticket' : 'PRISM project'} due date${prismEvent.url ? ` — ${prismEvent.url}` : ''}`,
    start: { date: prismEvent.dueDate },
    end: { date: nextDay.toISOString().slice(0, 10) },
  };
}

async function createEvent(accessToken, calendarId, prismEvent) {
  return apiRequest(accessToken, `/calendars/${encodeURIComponent(calendarId)}/events`, {
    method: 'POST',
    body: JSON.stringify(toGoogleEventBody(prismEvent)),
  });
}

async function updateEvent(accessToken, calendarId, externalEventId, prismEvent) {
  return apiRequest(accessToken, `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(externalEventId)}`, {
    method: 'PATCH',
    body: JSON.stringify(toGoogleEventBody(prismEvent)),
  });
}

async function deleteEvent(accessToken, calendarId, externalEventId) {
  try {
    await apiRequest(accessToken, `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(externalEventId)}`, { method: 'DELETE' });
  } catch (err) {
    if (err.status !== 404 && err.status !== 410) throw err; // already gone is fine
  }
}

module.exports = {
  buildAuthUrl, exchangeCodeForTokens, refreshAccessToken, listCalendars, listEvents,
  createEvent, updateEvent, deleteEvent,
};
