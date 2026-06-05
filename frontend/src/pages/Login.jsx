import { useState } from 'react';
import { useNavigate, useLocation, Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { errMessage } from '../api/api';

const TABS = [
  { key: 'ad', label: 'Active Directory' },
  { key: 'local', label: 'Local Account' },
];

export default function Login() {
  const { user, login, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mode, setMode] = useState('ad');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!loading && user) {
    const dest = location.state?.from?.pathname || '/dashboard';
    return <Navigate to={dest} replace />;
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const loggedIn = await login(username, password, mode);
      if (loggedIn.mustChangePassword) {
        navigate('/change-password', { replace: true });
        return;
      }
      const dest = location.state?.from?.pathname || '/dashboard';
      navigate(dest, { replace: true });
    } catch (err) {
      setError(errMessage(err, 'Login failed'));
    } finally {
      setSubmitting(false);
    }
  };

  const isLocal = mode === 'local';

  return (
    <div className="flex min-h-screen items-center justify-center bg-navy-900 px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center">
          <svg viewBox="0 0 64 64" className="h-14 w-14">
            <path d="M20 44 L32 16 L44 44 Z" fill="none" stroke="#38bdf8" strokeWidth="3" strokeLinejoin="round" />
            <path d="M32 16 L52 30" stroke="#5e7ce2" strokeWidth="3" strokeLinecap="round" />
            <path d="M38 30 L52 24 M38 34 L52 32 M38 38 L52 40" stroke="#38bdf8" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <h1 className="mt-3 text-3xl font-bold tracking-wide text-white">PRISM</h1>
          <p className="text-sm text-navy-300">Ticketing &amp; Project Management</p>
        </div>

        <div className="card overflow-hidden">
          {/* Tabs */}
          <div className="flex border-b border-navy-100">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => { setMode(t.key); setError(''); }}
                className={`flex-1 px-4 py-3 text-sm font-medium transition ${
                  mode === t.key
                    ? 'border-b-2 border-prism bg-navy-50 text-prism'
                    : 'text-navy-500 hover:bg-navy-50'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="space-y-4 p-6">
            {error && (
              <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
            )}

            <div>
              <label className="label" htmlFor="username">
                {isLocal ? 'Email or username' : 'Username'}
              </label>
              <input
                id="username"
                className="input"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder={isLocal ? 'you@example.com' : 'domain username'}
                required
              />
            </div>

            <div>
              <label className="label" htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                className="input"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            <button type="submit" className="btn-primary w-full" disabled={submitting}>
              {submitting ? 'Signing in…' : 'Sign in'}
            </button>

            <p className="text-center text-xs text-navy-400">
              {isLocal
                ? 'Sign in with a local PRISM account.'
                : 'Authenticate with your Active Directory credentials.'}
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
