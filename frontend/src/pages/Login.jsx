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

  const labelStyle = {
    display: 'block',
    fontSize: 11,
    fontWeight: 600,
    color: 'var(--color-text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.14em',
    marginBottom: 8,
  };

  const inputStyle = {
    width: '100%',
    boxSizing: 'border-box',
    backgroundColor: 'var(--color-input-bg)',
    border: '1px solid var(--color-input-border)',
    borderRadius: 4,
    padding: '13px 14px',
    fontSize: 15,
    color: 'var(--color-text-primary)',
    outline: 'none',
    transition: 'border-color 0.15s',
  };

  return (
    <>
      <style>{`
        .prism-input::placeholder { color: var(--color-text-faint); }
        .prism-input:focus { border-color: var(--color-accent) !important; box-shadow: 0 0 0 1px var(--color-accent); }
        .prism-btn:hover:not(:disabled) { filter: brightness(1.08); }
        .prism-btn:active:not(:disabled) { transform: translateY(1px); }
        .prism-btn .arrow { transition: transform 0.15s; }
        .prism-btn:hover:not(:disabled) .arrow { transform: translateX(3px); }

        @keyframes prismBlink { 0%, 49% { opacity: 1; } 50%, 100% { opacity: 0; } }
        .prism-cursor { animation: prismBlink 1.1s step-end infinite; }
        @media (prefers-reduced-motion: reduce) { .prism-cursor { animation: none; } }

        @media (max-width: 720px) {
          .prism-layout { flex-direction: column !important; }
          .prism-left {
            width: 100% !important;
            border-right: none !important;
            border-bottom: 1px solid var(--color-border);
            padding: 1.75rem 1.5rem !important;
          }
          .prism-manifest, .prism-left-footer { display: none !important; }
          .prism-right   { padding: 2.25rem 1.5rem !important; }
        }
      `}</style>

      <div
        className="prism-layout"
        style={{ display: 'flex', minHeight: '100vh', backgroundColor: 'var(--color-bg)' }}
      >

        {/* ── Left panel — system status console ──────────────────────────── */}
        <div
          className="prism-left"
          style={{
            width: '44%',
            flexShrink: 0,
            backgroundColor: 'var(--color-card)',
            borderRight: '1px solid var(--color-border)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            padding: '2.75rem 3rem',
            position: 'relative',
            overflow: 'hidden',
            // Faint console dot-grid — evokes graph paper / a status board
            // without competing with the readout on top of it.
            backgroundImage:
              'radial-gradient(circle, color-mix(in srgb, var(--color-text-primary) 6%, transparent) 1px, transparent 1px)',
            backgroundSize: '22px 22px',
          }}
        >
          {/* Brand mark + wordmark */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, position: 'relative' }}>
            {settings.logoUrl ? (
              <img src={settings.logoUrl} alt={wordmark} style={{ height: 30, width: 30, objectFit: 'contain' }} />
            ) : (
              <svg width="30" height="30" viewBox="0 0 26 26" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="1"  y="1"  width="11" height="11" rx="2" fill="#1d3461" stroke="var(--color-accent)" strokeWidth="1.4" />
                <rect x="14" y="1"  width="11" height="11" rx="2" fill="var(--color-card)" stroke="#1e3a5f" strokeWidth="1.4" />
                <rect x="1"  y="14" width="11" height="11" rx="2" fill="var(--color-card)" stroke="#1e3a5f" strokeWidth="1.4" />
                <rect x="14" y="14" width="11" height="11" rx="2" fill="var(--color-card)" stroke="var(--color-border)" strokeWidth="1.4" />
              </svg>
            )}
            <span style={{ fontSize: 20, fontWeight: 700, letterSpacing: '0.22em', textTransform: 'uppercase', color: 'var(--color-text-primary)' }}>
              {wordmark}
            </span>
          </div>

          {/* Console manifest — the product described in its own operational
              vernacular. Monospace, bracketed header, blinking cursor. */}
          <div className="prism-manifest" style={{ position: 'relative', fontFamily: 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: 'var(--color-success)', boxShadow: '0 0 8px var(--color-success)' }} />
              <span style={{ fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--color-text-secondary)' }}>
                System ready
              </span>
            </div>

            <p style={{ fontSize: 11, letterSpacing: '0.12em', color: 'var(--color-text-faint)', textTransform: 'uppercase', margin: '0 0 12px 0' }}>
              ┌─ Service operations
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9, paddingLeft: 2 }}>
              {bullets.map((text) => (
                <div key={text} style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                  <span style={{ color: 'var(--color-accent)', fontSize: 13 }}>▸</span>
                  <span style={{ fontSize: 13.5, color: 'var(--color-text-secondary)', letterSpacing: '0.01em' }}>{text}</span>
                </div>
              ))}
            </div>
            <p style={{ fontSize: 11, letterSpacing: '0.12em', color: 'var(--color-text-faint)', margin: '14px 0 0 0' }}>
              └─ ready
              <span className="prism-cursor" style={{ color: 'var(--color-accent)', marginLeft: 6 }}>▊</span>
            </p>
          </div>

          {/* Footer strip */}
          <div className="prism-left-footer" style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 10, fontFamily: 'var(--font-mono, ui-monospace, monospace)', fontSize: 11, color: 'var(--color-text-faint)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            <span>{tagline}</span>
          </div>
        </div>

        {/* ── Right panel — sign in ───────────────────────────────────────── */}
        <div
          className="prism-right"
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '3rem 3rem',
          }}
        >
          <div style={{ width: '100%', maxWidth: 380 }}>

            <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--color-accent)', margin: '0 0 10px 0' }}>
              Authenticate
            </p>
            <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--color-text-primary)', margin: '0 0 2rem 0' }}>
              Sign in to {wordmark}
            </h1>

            <form onSubmit={handleSubmit}>
              {error && (
                <div style={{
                  marginBottom: '1.25rem',
                  padding: '11px 14px',
                  backgroundColor: 'color-mix(in srgb, var(--color-danger) 12%, var(--color-bg))',
                  borderLeft: '2px solid var(--color-danger)',
                  borderRadius: 3,
                  fontSize: 13.5,
                  color: 'var(--color-danger)',
                  fontFamily: 'var(--font-mono, ui-monospace, monospace)',
                }}>
                  {error}
                </div>
              )}

              <div style={{ marginBottom: '1.15rem' }}>
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

              <div style={{ marginBottom: '1.15rem' }}>
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
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  width: '100%',
                  backgroundColor: 'var(--color-accent)',
                  border: 'none',
                  borderRadius: 4,
                  color: 'white',
                  fontSize: 15,
                  fontWeight: 600,
                  padding: '14px 0',
                  cursor: submitting ? 'not-allowed' : 'pointer',
                  opacity: submitting ? 0.7 : 1,
                  marginTop: '0.5rem',
                }}
              >
                {submitting ? 'Signing in…' : 'Sign in'}
                {!submitting && <span className="arrow">→</span>}
              </button>

              <p style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11.5, color: 'var(--color-text-faint)', margin: '1.75rem 0 0 0', fontFamily: 'var(--font-mono, ui-monospace, monospace)', letterSpacing: '0.04em' }}>
                <span style={{ width: 5, height: 5, borderRadius: '50%', backgroundColor: 'var(--color-success)' }} />
                Secure session · enter your {wordmark} credentials
              </p>
            </form>
          </div>
        </div>

      </div>
    </>
  );
}
