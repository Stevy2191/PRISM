import { NavLink, Outlet, useNavigate, Link } from 'react-router-dom';
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
  { to: '/admin/blueprints', label: 'Blueprints' },
  { to: '/admin/apikeys', label: 'API Keys' },
  { to: '/admin/settings', label: 'Settings' },
];

function PrismLogo() {
  return (
    <div className="flex items-center gap-2 px-5 py-5">
      <svg viewBox="0 0 64 64" className="h-8 w-8" fill="none" xmlns="http://www.w3.org/2000/svg">
        {/* Incoming white light beam */}
        <path d="M3 25 L23 30" stroke="#e2e8f0" strokeWidth="2.5" strokeLinecap="round" />
        {/* Refracted rainbow spectrum */}
        <path d="M42 31 L62 20" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" />
        <path d="M42 31 L62 25" stroke="#f97316" strokeWidth="2" strokeLinecap="round" />
        <path d="M42 31 L62 30" stroke="#eab308" strokeWidth="2" strokeLinecap="round" />
        <path d="M42 31 L62 35" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" />
        <path d="M42 31 L62 40" stroke="#38bdf8" strokeWidth="2" strokeLinecap="round" />
        <path d="M42 31 L62 45" stroke="#8b5cf6" strokeWidth="2" strokeLinecap="round" />
        {/* Prism triangle */}
        <path d="M32 11 L50 47 L14 47 Z" stroke="#93c5fd" strokeWidth="2.5" strokeLinejoin="round" fill="#1e3a5f" fillOpacity="0.6" />
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
          {user?.isLocalAccount && (
            <Link
              to="/change-password"
              className="mb-2 block text-center text-xs text-navy-300 hover:text-white"
            >
              Change password
            </Link>
          )}
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
