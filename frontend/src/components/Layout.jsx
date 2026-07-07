import { Outlet } from 'react-router-dom';
import { useNavStyle } from '../context/NavStyleContext';
import TopNav from './TopNav';
import SidebarCompact from './SidebarCompact';

export default function Layout() {
  const { navStyle } = useNavStyle();
  const isSidebar = navStyle === 'sidebar';

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--color-bg)' }}>
      {isSidebar ? <SidebarCompact /> : <TopNav />}

      <main
        className="min-h-screen w-full"
        style={isSidebar ? { paddingLeft: 60 } : { paddingTop: 52 }}
      >
        <div className="w-full px-6 py-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
