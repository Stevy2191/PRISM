// The one list of time zones every picker offers (CS: there were three that
// differed). Your company's zone, a company's support hours and a recurring
// ticket's schedule all choose from it.
export const TIME_ZONES = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Phoenix',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
  'America/Toronto',
  'America/Vancouver',
  'America/Mexico_City',
  'America/Sao_Paulo',
  'Europe/London',
  'Europe/Dublin',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Madrid',
  'Europe/Rome',
  'Europe/Amsterdam',
  'Europe/Stockholm',
  'Africa/Johannesburg',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Hong_Kong',
  'Asia/Tokyo',
  'Australia/Perth',
  'Australia/Sydney',
  'Pacific/Auckland',
];

// The list for a picker: a value already saved always stays offered, even
// when it isn't one of ours, so opening a form never changes it.
export function zoneOptions(current) {
  return current && !TIME_ZONES.includes(current) ? [current, ...TIME_ZONES] : TIME_ZONES;
}
