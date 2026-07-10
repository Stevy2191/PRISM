// iCal/CalDAV URL provider — no OAuth, just a public/token-embedded URL that
// serves an .ics feed (RFC 5545). Read-only: iCal integrations can never be
// a push target, since a plain .ics URL has no write API.
const ical = require('node-ical');

function normalizeUrl(url) {
  // webcal:// is a scheme convention meaning "https:// but open in a
  // calendar app" — plain HTTP(S) fetch treats them identically.
  return url.trim().replace(/^webcal:\/\//i, 'https://');
}

// node-ical never expands RRULE into individual occurrences — a recurring
// VEVENT comes back as a single master item whose .start is only the FIRST
// occurrence, plus an .rrule (rrule.js) object. Left as-is, a weekly meeting
// that started months ago would only ever "occur" on that first date and
// would fall out of the sync window forever, even though it's still
// happening every week. Expand each recurring item into one entry per
// occurrence that falls in [rangeStart, rangeEnd], honoring EXDATE
// (cancelled instances) and RECURRENCE-ID overrides (edited instances).
function expandRecurringEvent(item, rangeStart, rangeEnd) {
  const duration = item.start && item.end ? new Date(item.end).getTime() - new Date(item.start).getTime() : 0;
  const isAllDay = item.datetype === 'date' || !!item.start?.dateOnly;
  const exdateTimes = new Set(Object.values(item.exdate || {}).map((d) => new Date(d).getTime()));
  const overridesByTime = new Map(
    Object.values(item.recurrences || {}).map((r) => [new Date(r.recurrenceid || r.start).getTime(), r])
  );

  let occurrences;
  try {
    occurrences = item.rrule.between(rangeStart, rangeEnd, true);
  } catch {
    return [];
  }

  return occurrences
    .filter((occStart) => !exdateTimes.has(occStart.getTime()))
    .map((occStart) => {
      const override = overridesByTime.get(occStart.getTime());
      const start = override ? new Date(override.start) : occStart;
      const end = override && override.end ? new Date(override.end) : new Date(occStart.getTime() + duration);
      return {
        externalEventId: String(`${item.uid}-${occStart.toISOString()}`),
        title: (override ? override.summary : item.summary) || '(untitled event)',
        startDate: start,
        endDate: end,
        isAllDay: override ? (override.datetype === 'date' || !!override.start?.dateOnly) : isAllDay,
        location: (override ? override.location : item.location) || null,
        description: (override ? override.description : item.description) || null,
      };
    });
}

// Fetches and parses an iCal feed, returning normalized events. Throws with
// a descriptive message on any failure (bad URL, non-2xx, unparseable body)
// so both the "Test URL" button and the sync job get a clear reason.
// `rangeStart`/`rangeEnd` bound how far recurring events are expanded — the
// sync job passes its actual sync window; callers that don't care (e.g. the
// "Test URL" button) get a generous default so the count is still meaningful.
async function fetchIcalEvents(url, { rangeStart, rangeEnd } = {}) {
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

  const windowStart = rangeStart || new Date(Date.now() - 60 * 86400000);
  const windowEnd = rangeEnd || new Date(Date.now() + 180 * 86400000);

  const events = [];
  Object.values(parsed).forEach((item) => {
    if (item.type !== 'VEVENT') return;
    if (item.rrule) {
      events.push(...expandRecurringEvent(item, windowStart, windowEnd));
      return;
    }
    const isAllDay = item.datetype === 'date' || !!item.start?.dateOnly;
    events.push({
      externalEventId: String(item.uid || `${item.summary}-${item.start}`),
      title: item.summary || '(untitled event)',
      startDate: item.start ? new Date(item.start) : null,
      endDate: item.end ? new Date(item.end) : null,
      isAllDay,
      location: item.location || null,
      description: item.description || null,
    });
  });

  return events.filter((e) => e.startDate && !Number.isNaN(e.startDate.getTime()));
}

// Used by the "Test URL" button — fetch + parse without persisting
// anything, just report success/failure and a sample count.
async function testIcalUrl(url) {
  const events = await fetchIcalEvents(url);
  return { valid: true, eventCount: events.length };
}

module.exports = { fetchIcalEvents, testIcalUrl, normalizeUrl };
