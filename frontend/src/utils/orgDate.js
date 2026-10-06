// "Today" on the organization's calendar (Settings → Company → time zone).
// The server refuses a work date after this day, so time forms default to it
// rather than to the UTC date or the browser's.
import { useSettings } from '../context/SettingsContext';

export function orgToday(timeZone) {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timeZone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

export function useOrgToday() {
  const { settings } = useSettings();
  return orgToday(settings?.company?.timezone);
}
