import { useState } from 'react';
import { useNavigate, useLocation, Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import { errMessage } from '../api/api';

const DEFAULT_BULLETS = ['Ticket & project tracking', 'Time logging & reports', 'AD & local auth', 'API access'];

export default function Login() {
  const { user, login, loading } = useAuth();
  const { settings } = useSettings();
  const navigate = useNavigate();
  const location = useLocation();
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
      const loggedIn = await login(username, password);
      if (loggedIn.mustChangePassword) {
        navigate('/change-password', { replace: true });
        return;
      }
      // Rely on the declarative <Navigate> render guard above rather than
      // calling navigate() here — avoids a race where ProtectedRoute renders
      // before setUser() propagates and bounces the user back to /login.
    } catch (err) {
      setError(errMessage(err, 'Login failed'));
    } finally {
      setSubmitting(false);
    }
  };

  const wordmark = settings.appName || settings.branding?.appName || 'PRISM';
  const tagline = settings.branding?.tagline || 'Project & Request Integrated Service Manager';
  const bullets = settings.branding?.loginBullets?.length ? settings.branding.loginBullets : DEFAULT_BULLETS;

  const inputStyle = {
    width: '100%',
    boxSizing: 'border-box',
    backgroundColor: 'var(--color-input-bg)',
    border: '1px solid var(--color-input-border)',
    borderRadius: 7,
    padding: '13px 16px',
    fontSize: 15,
    color: 'var(--color-text-primary)',
    outline: 'none',
  };

  const labelStyle = {
    display: 'block',
    fontSize: 11,
    color: 'var(--color-text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    marginBottom: 7,
  };

  return (
    <>
      <style>{`
        .prism-input::placeholder { color: var(--color-text-muted); }
        .prism-input:focus { border-color: var(--color-accent) !important; }
        .prism-btn:hover:not(:disabled) { background-color: var(--color-accent-hover) !important; filter: brightness(0.9); }

        @media (max-width: 640px) {
          .prism-layout { flex-direction: column !important; }
          .prism-left {
            width: 100% !important;
            border-right: none !important;
            border-bottom: 1px solid var(--color-border);
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
        style={{ display: 'flex', minHeight: '100vh', backgroundColor: 'var(--color-bg)' }}
      >

        {/* ── Left panel ──────────────────────────────────────────────────── */}
        <div
          className="prism-left"
          style={{
            width: '38%',
            flexShrink: 0,
            backgroundColor: 'var(--color-card)',
            borderRight: '1px solid var(--color-border)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            textAlign: 'center',
            padding: '3rem 2.5rem',
          }}
        >
          {/* Branding block: mark → wordmark → subtitle */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '2.5rem' }}>
            {settings.logoUrl ? (
              <img src={settings.logoUrl} alt={wordmark} style={{ height: 36, width: 36, objectFit: 'contain' }} />
            ) : (
              <svg width="36" height="36" viewBox="0 0 26 26" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="1"  y="1"  width="11" height="11" rx="2.5" fill="#1d3461" stroke="var(--color-accent)" strokeWidth="1.4" />
                <rect x="14" y="1"  width="11" height="11" rx="2.5" fill="var(--color-card)" stroke="#1e3a5f" strokeWidth="1.4" />
                <rect x="1"  y="14" width="11" height="11" rx="2.5" fill="var(--color-card)" stroke="#1e3a5f" strokeWidth="1.4" />
                <rect x="14" y="14" width="11" height="11" rx="2.5" fill="var(--color-card)" stroke="var(--color-border)" strokeWidth="1.4" />
              </svg>
            )}
            <span style={{ fontSize: 28, fontWeight: 600, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--color-text-primary)', marginTop: 12 }}>
              {wordmark}
            </span>
            <span style={{ fontSize: 10, color: 'var(--color-text-secondary)', letterSpacing: '0.08em', textTransform: 'uppercase', marginTop: 6 }}>
              {tagline}
            </span>
          </div>

          {/* Tagline */}
          <p
            className="prism-tagline"
            style={{ fontSize: 32, color: 'var(--color-text-primary)', fontWeight: 400, lineHeight: 1.35, letterSpacing: '-0.02em', margin: '0 0 2.5rem 0' }}
          >
            Your team&apos;s<br />
            <span style={{ display: 'block', fontWeight: 600, color: 'var(--color-text-primary)' }}>work, organized.</span>
          </p>

          {/* Feature bullets — inline-flex keeps them left-aligned inside the centered panel */}
          <div
            className="prism-bullets"
            style={{ display: 'inline-flex', flexDirection: 'column', gap: 12, alignItems: 'flex-start' }}
          >
            {bullets.map((text) => (
              <div key={text} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: 'var(--color-accent)', flexShrink: 0 }} />
                <span style={{ fontSize: 14, color: 'var(--color-text-secondary)' }}>{text}</span>
              </div>
            ))}
          </div>

          {/* Footer */}
          <span className="prism-footer" style={{ fontSize: 12, color: 'var(--color-text-faint)', marginTop: '3rem' }}>
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
            padding: '3rem 2.5rem',
          }}
        >
          <div style={{ width: '100%', maxWidth: 400 }}>

            {/* Heading */}
            <h1 style={{ fontSize: 28, fontWeight: 500, color: 'var(--color-text-primary)', margin: '0 0 2.25rem 0' }}>
              Sign in
            </h1>

            {/* Form */}
            <form onSubmit={handleSubmit}>
              {error && (
                <div style={{
                  marginBottom: '1.1rem',
                  padding: '10px 14px',
                  backgroundColor: 'color-mix(in srgb, var(--color-danger) 12%, var(--color-bg))',
                  border: '1px solid var(--color-danger)',
                  borderRadius: 7,
                  fontSize: 14,
                  color: 'var(--color-danger)',
                }}>
                  {error}
                </div>
              )}

              <div style={{ marginBottom: '1.1rem' }}>
                <label htmlFor="username" style={labelStyle}>Username or Email</label>
                <input
                  id="username"
                  className="prism-input"
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="username or email address"
                  required
                  style={inputStyle}
                />
              </div>

              <div style={{ marginBottom: '1.1rem' }}>
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
                  backgroundColor: 'var(--color-accent)',
                  border: 'none',
                  borderRadius: 7,
                  color: 'white',
                  fontSize: 15,
                  fontWeight: 500,
                  padding: '14px 0',
                  cursor: submitting ? 'not-allowed' : 'pointer',
                  opacity: submitting ? 0.7 : 1,
                  marginTop: '0.75rem',
                }}
              >
                {submitting ? 'Signing in…' : 'Sign in'}
              </button>

              <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--color-text-faint)', margin: '1.5rem 0 0 0' }}>
                Enter your PRISM credentials to continue.
              </p>
            </form>
          </div>
        </div>

      </div>
    </>
  );
}
