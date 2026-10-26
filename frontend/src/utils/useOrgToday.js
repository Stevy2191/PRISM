import { useSettings } from '../context/SettingsContext';
import { orgToday } from './orgDate';

// "Today" on the organization's calendar, re-read when the settings change.
export function useOrgToday() {
  const { settings } = useSettings();
  return orgToday(settings?.company?.timezone || 'UTC');
}
