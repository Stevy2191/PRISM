// The icon for each Settings section (registry SECTIONS[].icon), kept out of
// the registry so that stays plain data.
import {
  IconBox, IconBuilding, IconChartBar, IconClock, IconFolder, IconMail, IconServer, IconStopwatch, IconTicket, IconUser, IconUsers,
} from '@tabler/icons-react';

const ICONS = {
  user: IconUser,
  building: IconBuilding,
  users: IconUsers,
  ticket: IconTicket,
  mail: IconMail,
  clock: IconClock,
  chart: IconChartBar,
  stopwatch: IconStopwatch,
  folder: IconFolder,
  box: IconBox,
  server: IconServer,
};

export const sectionIcon = (key) => ICONS[key] || IconFolder;

// Settings reopens on the section last used (per browser; best effort).
const KEY = 'prism.settings.section';
export function rememberSection(slug) {
  try { if (slug) localStorage.setItem(KEY, slug); } catch { /* storage blocked */ }
}
export function lastSection() {
  try { return localStorage.getItem(KEY); } catch { return null; }
}
