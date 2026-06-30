import { useState } from 'react';
import { useNavigate, useLocation, Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import { errMessage } from '../api/api';

const TABS = [
  { key: 'ad', label: 'Active Directory' },
  { key: 'local', label: 'Local Account' },
];

const BULLETS = [
  { text: 'Ticket & project tracking', dot: '#3b82f6' },
  { text: 'Time logging & reports', dot: '#3b82f6' },
  { text: 'AD & local auth', dot: '#3b82f6' },
  { text: 'API access', dot: '#1e3a5f' },
];

export default function Login() {
  const { user, login, loading } = useAuth();
  const { settings } = useSettings();
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
  const wordmark = settings.company?.name || 'PRISM';

  const inputStyle = {
    width: '100%',
    boxSizing: 'border-box',
    backgroundColor: '#0d1120',
    border: '1px solid #1a2235',
    borderRadius: 5,
    padding: '9px 11px',
    fontSize: 13,
    color: '#e2e8f0',
    outline: 'none',
  };

  const labelStyle = {
    display: 'block',
    fontSize: 11,
    color: '#475569',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    marginBottom: 6,
  };

  return (
    <>
      <style>{`
        .prism-input::placeholder { color: #1e2d42; }
        .prism-input:focus { border-color: #3b82f6 !important; }
        .prism-btn:hover:not(:disabled) { background-color: #1e40af !important; }
      `}</style>

      <div style={{ display: 'flex', minHeight: '100vh' }}>

        {/* ── Left panel ─────────────────────────────────────────────────── */}
        <div style={{
          width: '42%',
          backgroundColor: '#0d1120',
          borderRight: '1px solid #161c2d',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '48px 40px',
        }}>

          {/* Top section */}
          <div>
            {/* Geometric mark + wordmark */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 48 }}>
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="1"  y="1"  width="9" height="9" rx="2" fill="#1d3461" stroke="#3b82f6" strokeWidth="1.2" />
                <rect x="12" y="1"  width="9" height="9" rx="2" fill="#0d1120" stroke="#1e3a5f" strokeWidth="1.2" />
                <rect x="1"  y="12" width="9" height="9" rx="2" fill="#0d1120" stroke="#1e3a5f" strokeWidth="1.2" />
                <rect x="12" y="12" width="9" height="9" rx="2" fill="#0d1120" stroke="#161c2d" strokeWidth="1.2" />
              </svg>
              <span style={{ fontSize: 12, letterSpacing: '0.35em', textTransform: 'uppercase', color: '#94a3b8' }}>
                {wordmark}
              </span>
            </div>

            {/* Tagline */}
            <p style={{ fontSize: 20, color: '#e2e8f0', fontWeight: 400, lineHeight: 1.5, margin: '0 0 32px 0' }}>
              Your team&apos;s<br />
              <em>work, organized.</em>
            </p>

            {/* Feature bullets */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {BULLETS.map(({ text, dot }) => (
                <div key={text} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: dot, flexShrink: 0 }} />
                  <span style={{ fontSize: 12, color: '#475569' }}>{text}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Bottom section */}
          <span style={{ fontSize: 11, color: '#1e2d42' }}>Self-hosted · Open source</span>
        </div>

        {/* ── Right panel ────────────────────────────────────────────────── */}
        <div style={{
          flex: 1,
          backgroundColor: '#080b12',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <div style={{ width: '100%', maxWidth: 280 }}>

            {/* Heading */}
            <h1 style={{ fontSize: 16, fontWeight: 500, color: '#f1f5f9', margin: '0 0 4px 0' }}>Sign in</h1>
            <p style={{ fontSize: 12, color: '#475569', margin: '0 0 24px 0' }}>Choose your login method below.</p>

            {/* Tab switcher */}
            <div style={{ display: 'flex', borderBottom: '1px solid #161c2d', marginBottom: 24 }}>
              {TABS.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => { setMode(t.key); setError(''); }}
                  style={{
                    background: 'none',
                    border: 'none',
                    borderBottom: mode === t.key ? '2px solid #3b82f6' : '2px solid transparent',
                    padding: '0 0 8px 0',
                    marginRight: 20,
                    marginBottom: -1,
                    fontSize: 13,
                    fontWeight: mode === t.key ? 500 : 400,
                    color: mode === t.key ? '#3b82f6' : '#334155',
                    cursor: 'pointer',
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {error && (
                <div style={{
                  padding: '8px 12px',
                  backgroundColor: '#1a0a0a',
                  border: '1px solid #7f1d1d',
                  borderRadius: 5,
                  fontSize: 12,
                  color: '#fca5a5',
                }}>
                  {error}
                </div>
              )}

              <div>
                <label htmlFor="username" style={labelStyle}>
                  {isLocal ? 'Email or username' : 'Username'}
                </label>
                <input
                  id="username"
                  className="prism-input"
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder={isLocal ? 'you@example.com' : 'domain username'}
                  required
                  style={inputStyle}
                />
              </div>

              <div>
                <label htmlFor="password" style={labelStyle}>Password</label>
                <input
                  id="password"
                  type="password"
                  className="prism-input"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  style={inputStyle}
                />
              </div>

              <button
                type="submit"
                className="prism-btn"
                disabled={submitting}
                style={{
                  width: '100%',
                  backgroundColor: '#1d4ed8',
                  border: 'none',
                  borderRadius: 5,
                  color: 'white',
                  fontSize: 13,
                  fontWeight: 500,
                  padding: '9px 0',
                  cursor: submitting ? 'not-allowed' : 'pointer',
                  opacity: submitting ? 0.7 : 1,
                }}
              >
                {submitting ? 'Signing in…' : 'Sign in'}
              </button>

              <p style={{ textAlign: 'center', fontSize: 11, color: '#1e2d42', margin: 0 }}>
                {isLocal
                  ? 'Sign in with a local PRISM account.'
                  : 'Authenticate with your Active Directory credentials.'}
              </p>
            </form>
          </div>
        </div>
      </div>
    </>
  );
}
