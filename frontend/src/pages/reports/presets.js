// Report date-range presets. Kept free of React so node:test can load it.
import { orgToday, addDays } from '../../utils/orgDate.js';

export const PRESETS = [
  { key: 'today', label: 'Today' },
  { key: 'this_week', label: 'This week' },
  { key: 'this_month', label: 'This month' },
  { key: 'last_month', label: 'Last month' },
  { key: 'last_3_months', label: 'Last 3 months' },
  { key: 'last_6_months', label: 'Last 6 months' },
  { key: 'this_year', label: 'This year' },
  { key: 'custom', label: 'Custom range' },
];

// Presets count from today on the organization's calendar, the same days
// the server bounds the report by (dates stay 'YYYY-MM-DD' strings).
function shiftMonths(dateStr, months, day) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + months, day ?? d)).toISOString().slice(0, 10);
}

export function presetRange(preset) {
  const today = orgToday();
  switch (preset) {
    case 'today':
      return { startDate: today, endDate: today };
    case 'this_week': {
      const weekday = new Date(`${today}T00:00:00Z`).getUTCDay() || 7;
      return { startDate: addDays(today, 1 - weekday), endDate: today };
    }
    case 'this_month':
      return { startDate: shiftMonths(today, 0, 1), endDate: today };
    case 'last_month':
      return { startDate: shiftMonths(today, -1, 1), endDate: addDays(shiftMonths(today, 0, 1), -1) };
    case 'last_3_months':
      return { startDate: shiftMonths(today, -3), endDate: today };
    case 'last_6_months':
      return { startDate: shiftMonths(today, -6), endDate: today };
    case 'this_year':
      return { startDate: `${today.slice(0, 4)}-01-01`, endDate: today };
    default:
      return null;
  }
}
