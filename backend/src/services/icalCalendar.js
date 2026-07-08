// iCal/CalDAV URL provider — no OAuth, just a public/token-embedded URL that
// serves an .ics feed (RFC 5545). Read-only: iCal integrations can never be
// a push target, since a plain .ics URL has no write API.
const ical = require('node-ical');

function normalizeUrl(url) {
  // webcal:// is a scheme convention meaning "https:// but open in a
  // calendar app" — plain HTTP(S) fetch treats them identically.
  return url.trim().replace(/^webcal:\/\//i, 'https://');
}

// Fetches and parses an iCal feed, returning normalized events. Throws with
// a descriptive message on any failure (bad URL, non-2xx, unparseable body)
// so both the "Test URL" button and the sync job get a clear reason.
async function fetchIcalEvents(url) {
  const normalized = normalizeUrl(url);
  let res;
  try {
    res = await fetch(normalized, { headers: { Accept: 'text/calendar, */*' } });
  } catch (err) {
    throw new Error(`Could not reach that URL: ${err.message}`);
  }
  if (!res.ok) {
    throw new Error(`URL returned HTTP ${res.status}`);
  }
  const body = await res.text();
  let parsed;
  try {
    parsed = ical.parseICS(body);
  } catch (err) {
    throw new Error(`Could not parse iCal data: ${err.message}`);
  }

  const events = Object.values(parsed)
    .filter((item) => item.type === 'VEVENT')
    .map((item) => {
      const isAllDay = item.datetype === 'date' || !!item.start?.dateOnly;
      return {
        externalEventId: String(item.uid || `${item.summary}-${item.start}`),
        title: item.summary || '(untitled event)',
        startDate: item.start ? new Date(item.start) : null,
        endDate: item.end ? new Date(item.end) : null,
        isAllDay,
        location: item.location || null,
        description: item.description || null,
      };
    })
    .filter((e) => e.startDate && !Number.isNaN(e.startDate.getTime()));

  return events;
}

// Used by the "Test URL" button — fetch + parse without persisting
// anything, just report success/failure and a sample count.
async function testIcalUrl(url) {
  const events = await fetchIcalEvents(url);
  return { valid: true, eventCount: events.length };
}

module.exports = { fetchIcalEvents, testIcalUrl, normalizeUrl };
