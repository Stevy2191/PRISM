// iCal/CalDAV URL provider — no OAuth, just a public/token-embedded URL that
// serves an .ics feed (RFC 5545). Read-only: iCal integrations can never be
// a push target, since a plain .ics URL has no write API.
const dns = require('dns').promises;
const net = require('net');
const ical = require('node-ical');

function normalizeUrl(url) {
  // webcal:// is a scheme convention meaning "https:// but open in a
  // calendar app" — plain HTTP(S) fetch treats them identically.
  return url.trim().replace(/^webcal:\/\//i, 'https://');
}

// SSRF guard — this URL is supplied by any user who can create a calendar
// integration and is fetched server-side, both on-demand (Test URL) and
// automatically every sync interval. Without this, an attacker could point
// it at loopback/link-local/internal-network addresses (e.g. the cloud
// metadata endpoint at 169.254.169.254) to reach hosts they can't otherwise.
function ipv4ToLong(ip) {
  const parts = ip.split('.').map(Number);
  return (((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0);
}
function inCidr(ip, cidr) {
  const [range, bitsStr] = cidr.split('/');
  const bits = parseInt(bitsStr, 10);
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipv4ToLong(ip) & mask) === (ipv4ToLong(range) & mask);
}
// Loopback, private (RFC1918), link-local (incl. cloud metadata), CGNAT,
// documentation/test, multicast, and reserved ranges.
const BLOCKED_IPV4_CIDRS = [
  '0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8', '169.254.0.0/16',
  '172.16.0.0/12', '192.0.0.0/24', '192.0.2.0/24', '192.168.0.0/16',
  '198.18.0.0/15', '198.51.100.0/24', '203.0.113.0/24', '224.0.0.0/4', '240.0.0.0/4',
];
function isDisallowedIp(ip) {
  if (net.isIPv4(ip)) return BLOCKED_IPV4_CIDRS.some((cidr) => inCidr(ip, cidr));
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '::') return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    if (mapped) return isDisallowedIp(mapped[1]);
    // Link-local (fe80::/10 — 3-char prefixes fe8/fe9/fea/feb) and unique
    // local (fc00::/7 — 2-char prefixes fc/fd).
    if (['fe8', 'fe9', 'fea', 'feb'].some((p) => lower.startsWith(p))
      || lower.startsWith('fc') || lower.startsWith('fd')) return true;
    return false;
  }
  return true; // unrecognized address form -> fail closed
}
async function assertPublicHost(hostname) {
  let records;
  try {
    records = await dns.lookup(hostname, { all: true });
  } catch (err) {
    throw new Error(`Could not resolve host: ${err.message}`);
  }
  if (!records.length || records.some((r) => isDisallowedIp(r.address))) {
    throw new Error('That URL resolves to a private or internal address, which is not allowed');
  }
}

// fetch() with the SSRF guard applied to the initial URL and to every
// redirect hop (redirects are followed manually so each new host is
// re-validated instead of trusting the server's own automatic-redirect logic).
async function safeFetch(inputUrl, options, redirectsLeft = 5) {
  const parsed = new URL(inputUrl);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Only http:// and https:// URLs are allowed');
  }
  await assertPublicHost(parsed.hostname);
  const res = await fetch(parsed.toString(), { ...options, redirect: 'manual' });
  if ([301, 302, 303, 307, 308].includes(res.status)) {
    const location = res.headers.get('location');
    if (!location) throw new Error('Redirect response is missing a Location header');
    if (redirectsLeft <= 0) throw new Error('Too many redirects');
    return safeFetch(new URL(location, parsed).toString(), options, redirectsLeft - 1);
  }
  return res;
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
    res = await safeFetch(normalized, { headers: { Accept: 'text/calendar, */*' } });
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
