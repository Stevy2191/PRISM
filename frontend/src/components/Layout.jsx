import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { useNavStyle } from '../context/NavStyleContext';
import { SETTINGS_SCROLL_KEY } from '../pages/SettingsHub';
import TopNav from './TopNav';
import SidebarCompact from './SidebarCompact';

// Settings sub-pages live under both /settings/* (e.g. /settings/company)
// and /admin/* (e.g. /admin/users, /admin/roles — reached from the Settings
// hub's own cards, see SettingsHub.jsx's SECTIONS) — both count as "still
// in the settings area" for scroll-restore purposes.
function isSettingsArea(pathname) {
  return pathname.startsWith('/settings') || pathname.startsWith('/admin');
}

export default function Layout() {
  const { navStyle } = useNavStyle();
  const isSidebar = navStyle === 'sidebar';
  const location = useLocation();

  // SettingsHub.jsx's saved scroll position is deliberately NOT cleared on
  // restore (so repeated back-and-forth within Settings keeps working) —
  // this is the one place that clears it, once the user actually leaves
  // the settings/admin area for good, so a stale position doesn't linger
  // forever in sessionStorage or "leak" into some unrelated future visit.
  useEffect(() => {
    if (!isSettingsArea(location.pathname)) {
      try {
        sessionStorage.removeItem(SETTINGS_SCROLL_KEY);
      } catch {
        /* ignore */
      }
    }
  }, [location.pathname]);

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--color-bg)' }}>
      {isSidebar ? <SidebarCompact /> : <TopNav />}

      <main
        className="min-h-screen w-full"
        style={isSidebar ? { paddingLeft: 60 } : { paddingTop: 52 }}
      >
        <div className="w-full px-3 py-4 sm:px-6 sm:py-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
