// "Today" on the organization's calendar (Settings → Company → time zone).
// The server works out overdue, expiring-soon and report day bounds on this
// calendar, so the browser does too: never the UTC date (already tomorrow
// during a US evening) or the browser's own zone. No React here, so the
// node:test helpers can import it; the hook is in useOrgToday.js.

// SettingsProvider keeps this in step with the loaded settings, so plain
// helpers outside React can ask for "today" without a hook.
let currentZone = 'UTC';
export function setOrgTimeZone(timeZone) {
  currentZone = timeZone || 'UTC';
}

export function orgToday(timeZone = currentZone) {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());
  } catch {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());
  }
}

// 'YYYY-MM-DD' plus `days` calendar days (negative goes back).
export function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
