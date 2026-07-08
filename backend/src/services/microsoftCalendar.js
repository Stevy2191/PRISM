// Microsoft identity platform OAuth2 + Microsoft Graph calendar client —
// same plain-fetch approach as googleCalendar.js, no @azure/msal or
// @microsoft/microsoft-graph-client SDK dependency.
const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const SCOPE = 'offline_access User.Read Calendars.ReadWrite';

function authBase(tenantId) {
  return `https://login.microsoftonline.com/${encodeURIComponent(tenantId || 'common')}/oauth2/v2.0/authorize`;
}
function tokenUrl(tenantId) {
  return `https://login.microsoftonline.com/${encodeURIComponent(tenantId || 'common')}/oauth2/v2.0/token`;
}

function buildAuthUrl({ clientId, redirectUri, state, tenantId }) {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    response_mode: 'query',
    scope: SCOPE,
    state,
  });
  return `${authBase(tenantId)}?${params.toString()}`;
}

async function exchangeCodeForTokens({ code, clientId, clientSecret, redirectUri, tenantId }) {
  const res = await fetch(tokenUrl(tenantId), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      scope: SCOPE,
    }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error_description || body.error || 'Microsoft token exchange failed');
  return body; // { access_token, refresh_token, expires_in, token_type, scope }
}

async function refreshAccessToken({ refreshToken, clientId, clientSecret, tenantId }) {
  const res = await fetch(tokenUrl(tenantId), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      scope: SCOPE,
    }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error_description || body.error || 'Microsoft token refresh failed');
  return body;
}

async function apiRequest(accessToken, path, opts = {}) {
  const res = await fetch(`${GRAPH_BASE}${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  if (res.status === 204) return null;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.error?.message || `Microsoft Graph API error (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return body;
}

async function listCalendars(accessToken) {
  const data = await apiRequest(accessToken, '/me/calendars');
  return (data.value || []).map((c) => ({ id: c.id, name: c.name, primary: !!c.isDefaultCalendar }));
}

async function listEvents(accessToken, calendarId, timeMin, timeMax) {
  const params = new URLSearchParams({
    startDateTime: timeMin.toISOString(),
    endDateTime: timeMax.toISOString(),
    $orderby: 'start/dateTime',
    $top: '250',
  });
  const data = await apiRequest(accessToken, `/me/calendars/${encodeURIComponent(calendarId)}/calendarView?${params.toString()}`);
  return (data.value || []).map((e) => ({
    externalEventId: e.id,
    title: e.subject || '(untitled event)',
    startDate: new Date(e.start?.dateTime ? `${e.start.dateTime}Z` : e.start?.dateTime),
    endDate: e.end ? new Date(e.end.dateTime ? `${e.end.dateTime}Z` : e.end.dateTime) : null,
    isAllDay: !!e.isAllDay,
    location: e.location?.displayName || null,
    description: e.bodyPreview || null,
  }));
}

// ---- Push (PRISM -> Microsoft) ----

function toGraphEventBody(prismEvent) {
  const nextDay = new Date(`${prismEvent.dueDate}T00:00:00Z`);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  return {
    subject: prismEvent.title,
    body: {
      contentType: 'text',
      content: `${prismEvent.type === 'ticket' ? 'PRISM ticket' : 'PRISM project'} due date${prismEvent.url ? ` — ${prismEvent.url}` : ''}`,
    },
    start: { dateTime: `${prismEvent.dueDate}T00:00:00`, timeZone: 'UTC' },
    end: { dateTime: `${nextDay.toISOString().slice(0, 10)}T00:00:00`, timeZone: 'UTC' },
    isAllDay: true,
  };
}

async function createEvent(accessToken, calendarId, prismEvent) {
  return apiRequest(accessToken, `/me/calendars/${encodeURIComponent(calendarId)}/events`, {
    method: 'POST',
    body: JSON.stringify(toGraphEventBody(prismEvent)),
  });
}

async function updateEvent(accessToken, calendarId, externalEventId, prismEvent) {
  return apiRequest(accessToken, `/me/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(externalEventId)}`, {
    method: 'PATCH',
    body: JSON.stringify(toGraphEventBody(prismEvent)),
  });
}

async function deleteEvent(accessToken, calendarId, externalEventId) {
  try {
    await apiRequest(accessToken, `/me/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(externalEventId)}`, { method: 'DELETE' });
  } catch (err) {
    if (err.status !== 404) throw err;
  }
}

module.exports = {
  buildAuthUrl, exchangeCodeForTokens, refreshAccessToken, listCalendars, listEvents,
  createEvent, updateEvent, deleteEvent,
};
