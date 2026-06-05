import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const NAV = [
  { to: '/dashboard', label: 'Dashboard', icon: '◧' },
  { to: '/tickets', label: 'Tickets', icon: '🎫' },
  { to: '/projects', label: 'Projects', icon: '🗂' },
  { to: '/reports', label: 'Reports', icon: '📊', staff: true },
];

const ADMIN_NAV = [
  { to: '/admin/users', label: 'Users' },
  { to: '/admin/departments', label: 'Departments' },
  { to: '/admin/apikeys', label: 'API Keys' },
  { to: '/admin/settings', label: 'Settings' },
];

function PrismLogo() {
  return (
    <div className="flex items-center gap-2 px-5 py-5">
      <svg viewBox="0 0 64 64" className="h-8 w-8">
        <path d="M20 44 L32 16 L44 44 Z" fill="none" stroke="#38bdf8" strokeWidth="3" strokeLinejoin="round" />
        <path d="M32 16 L52 30" stroke="#5e7ce2" strokeWidth="3" strokeLinecap="round" />
      </svg>
      <span className="text-xl font-bold tracking-wide text-white">PRISM</span>
    </div>
  );
}

export default function Layout() {
  const { user, logout, isStaff, isAdmin } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const linkClass = ({ isActive }) =>
    `flex items-center gap-3 rounded-md px-4 py-2 text-sm font-medium transition ${
      isActive ? 'bg-prism text-white' : 'text-navy-200 hover:bg-navy-800 hover:text-white'
    }`;

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="flex w-64 flex-shrink-0 flex-col bg-navy-900">
        <PrismLogo />
        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-2">
          {NAV.filter((n) => !n.staff || isStaff).map((n) => (
            <NavLink key={n.to} to={n.to} className={linkClass}>
              <span className="w-4 text-center">{n.icon}</span>
              {n.label}
            </NavLink>
          ))}

          {isAdmin && (
            <div className="pt-4">
              <p className="px-4 pb-1 text-xs font-semibold uppercase tracking-wider text-navy-400">
                Administration
              </p>
              {ADMIN_NAV.map((n) => (
                <NavLink key={n.to} to={n.to} className={linkClass}>
                  <span className="w-4" />
                  {n.label}
                </NavLink>
              ))}
            </div>
          )}
        </nav>

        <div className="border-t border-navy-800 p-4">
          <p className="truncate text-sm font-medium text-white">{user?.displayName}</p>
          <p className="mb-3 truncate text-xs capitalize text-navy-300">{user?.role}</p>
          <button onClick={handleLogout} className="w-full btn-secondary py-1.5 text-xs">
            Sign out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto bg-navy-50">
        <div className="mx-auto max-w-7xl px-6 py-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
