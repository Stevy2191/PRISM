import { Outlet } from 'react-router-dom';
import { useNavStyle } from '../context/NavStyleContext';
import TopNav from './TopNav';
import SidebarCompact from './SidebarCompact';
import TimerReminder from './work/TimerReminder';

export default function Layout() {
  const { navStyle } = useNavStyle();
  const isSidebar = navStyle === 'sidebar';

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--color-bg)' }}>
      {isSidebar ? <SidebarCompact /> : <TopNav />}
      <TimerReminder />

      <main
        className="min-h-screen w-full"
        // Clear of a sideways phone's notch (viewport-fit=cover); 0 on desktops.
        style={isSidebar
          ? { paddingLeft: 60, paddingRight: 'env(safe-area-inset-right)' }
          : { paddingTop: 56, paddingLeft: 'env(safe-area-inset-left)', paddingRight: 'env(safe-area-inset-right)' }}
      >
        <div className="w-full px-3 py-4 sm:px-6 sm:py-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
