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

  return (
    <>
      <style>{`
        .prism-input::placeholder { color: #1e2d42; }
        .prism-input:focus { border-color: #3b82f6 !important; }
        .prism-btn:hover:not(:disabled) { background-color: #1e40af !important; }

        @media (max-width: 640px) {
          .prism-layout { flex-direction: column !important; }
          .prism-left {
            width: 100% !important;
            border-right: none !important;
            border-bottom: 1px solid #161c2d;
            padding: 2rem 1.5rem 1.5rem !important;
          }
          .prism-tagline { font-size: 20px !important; }
          .prism-bullets { display: none !important; }
          .prism-footer  { display: none !important; }
          .prism-right   { padding: 2rem 1.5rem !important; }
        }
      `}</style>

      <div
        className="prism-layout"
        style={{ display: 'flex', minHeight: '100vh', backgroundColor: '#080b12' }}
      >

        {/* ── Left panel ──────────────────────────────────────────────────── */}
        <div
          className="prism-left"
          style={{
            width: '35%',
            flexShrink: 0,
            backgroundColor: '#0d1120',
            borderRight: '1px solid #161c2d',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            alignItems: 'center',
            textAlign: 'center',
            padding: '2.5rem 2rem',
          }}
        >
          {/* Top section */}
          <div>
            {/* Geometric mark + wordmark */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: '2.5rem' }}>
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
            <p
              className="prism-tagline"
              style={{ fontSize: 24, color: '#e2e8f0', fontWeight: 400, lineHeight: 1.45, margin: '0 0 2.5rem 0' }}
            >
              Your team&apos;s<br />
              <span style={{ display: 'block', fontWeight: 600, color: '#fff' }}>work, organized.</span>
            </p>

            {/* Feature bullets — inline-flex keeps them left-aligned inside the centered panel */}
            <div
              className="prism-bullets"
              style={{ display: 'inline-flex', flexDirection: 'column', gap: 10 }}
            >
              {BULLETS.map(({ text, dot }) => (
                <div key={text} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: dot, flexShrink: 0 }} />
                  <span style={{ fontSize: 13, color: '#475569' }}>{text}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Bottom */}
          <span className="prism-footer" style={{ fontSize: 11, color: '#1e2d42' }}>
            Self-hosted · Open source
          </span>
        </div>

        {/* ── Right panel ─────────────────────────────────────────────────── */}
        <div
          className="prism-right"
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '2.5rem 2rem',
          }}
        >
          <div style={{ width: '100%', maxWidth: 340 }}>

            {/* Heading */}
            <h1 style={{ fontSize: 22, fontWeight: 500, color: '#f1f5f9', margin: '0 0 0.4rem 0' }}>
              Sign in
            </h1>
            <p style={{ fontSize: 13, color: '#475569', margin: '0 0 2rem 0' }}>
              Choose your login method below.
            </p>

            {/* Tab switcher */}
            <div style={{ display: 'flex', borderBottom: '1px solid #161c2d', marginBottom: '1.5rem' }}>
              {TABS.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => { setMode(t.key); setError(''); }}
                  style={{
                    background: 'none',
                    border: 'none',
                    borderBottom: mode === t.key ? '2px solid #3b82f6' : '2px solid transparent',
                    padding: '10px 0',
                    marginRight: 20,
                    marginBottom: -1,
                    fontSize: 12,
                    letterSpacing: '0.04em',
                    fontWeight: mode === t.key ? 500 : 400,
                    color: mode === t.key ? '#3b82f6' : '#334155',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit}>
              {error && (
                <div style={{
                  marginBottom: '1rem',
                  padding: '9px 12px',
                  backgroundColor: '#1a0a0a',
                  border: '1px solid #7f1d1d',
                  borderRadius: 6,
                  fontSize: 13,
                  color: '#fca5a5',
                }}>
                  {error}
                </div>
              )}

              <div style={{ marginBottom: '1rem' }}>
                <label htmlFor="username" style={{
                  display: 'block',
                  fontSize: 11,
                  color: '#475569',
                  textTransform: 'uppercase',
                  letterSpacing: '0.07em',
                  marginBottom: 6,
                }}>
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
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    backgroundColor: '#0d1120',
                    border: '1px solid #1a2235',
                    borderRadius: 6,
                    padding: '11px 14px',
                    fontSize: 14,
                    color: '#e2e8f0',
                    outline: 'none',
                  }}
                />
              </div>

              <div style={{ marginBottom: '1rem' }}>
                <label htmlFor="password" style={{
                  display: 'block',
                  fontSize: 11,
                  color: '#475569',
                  textTransform: 'uppercase',
                  letterSpacing: '0.07em',
                  marginBottom: 6,
                }}>
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  className="prism-input"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    backgroundColor: '#0d1120',
                    border: '1px solid #1a2235',
                    borderRadius: 6,
                    padding: '11px 14px',
                    fontSize: 14,
                    color: '#e2e8f0',
                    outline: 'none',
                  }}
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
                  borderRadius: 6,
                  color: 'white',
                  fontSize: 14,
                  fontWeight: 500,
                  padding: '12px 0',
                  cursor: submitting ? 'not-allowed' : 'pointer',
                  opacity: submitting ? 0.7 : 1,
                  marginBottom: '1rem',
                }}
              >
                {submitting ? 'Signing in…' : 'Sign in'}
              </button>

              <p style={{ textAlign: 'center', fontSize: 12, color: '#1e2d42', margin: 0 }}>
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
