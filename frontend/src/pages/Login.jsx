import { useEffect, useState } from 'react';
import { useNavigate, useLocation, Navigate } from 'react-router-dom';
import { IconEye, IconEyeOff } from '@tabler/icons-react';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import { errMessage } from '../api/api';

const DEFAULT_BULLETS = ['Ticket & project tracking', 'Time logging & reports', 'AD & local auth', 'API access'];
const MONO = 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace)';

// Zero-padded YYYY-MM-DD · HH:MM:SS — the honest "live" telemetry that keeps
// the console feeling alive without inventing any fake system metrics.
function formatClock(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}  ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export default function Login() {
  const { user, login, loading } = useAuth();
  const { settings } = useSettings();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [clock, setClock] = useState(() => formatClock(new Date()));

  // Live session clock — ticks once a second.
  useEffect(() => {
    const id = setInterval(() => setClock(formatClock(new Date())), 1000);
    return () => clearInterval(id);
  }, []);

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

  const detectCaps = (e) => {
    if (typeof e.getModifierState === 'function') setCapsLock(e.getModifierState('CapsLock'));
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
    transition: 'border-color 0.15s, box-shadow 0.15s',
  };

  // Boot-log rows: the manifest header, one row per capability, then the
  // ready prompt. Given a sequential reveal delay so the panel "prints in".
  const bootRows = [
    { kind: 'head', text: '┌─ SERVICE OPERATIONS' },
    ...bullets.map((text) => ({ kind: 'item', text })),
    { kind: 'ready', text: '└─ ready' },
  ];

  return (
    <>
      <style>{`
        .prism-input::placeholder { color: var(--color-text-faint); }
        .prism-input:focus { border-color: var(--color-accent) !important; box-shadow: 0 0 0 1px var(--color-accent); }
        .prism-btn:hover:not(:disabled) { filter: brightness(1.08); }
        .prism-btn:active:not(:disabled) { transform: translateY(1px); }
        .prism-btn .arrow { transition: transform 0.15s; }
        .prism-btn:hover:not(:disabled) .arrow { transform: translateX(3px); }
        .prism-eye:hover { color: var(--color-text-secondary) !important; }

        @keyframes prismBlink { 0%, 49% { opacity: 1; } 50%, 100% { opacity: 0; } }
        .prism-cursor { animation: prismBlink 1.1s step-end infinite; }

        @keyframes prismReveal { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }
        .prism-reveal { opacity: 0; animation: prismReveal 0.42s cubic-bezier(0.22, 1, 0.36, 1) forwards; }

        @keyframes prismScan { 0% { transform: translateY(0); } 100% { transform: translateY(230px); } }
        .prism-scan { animation: prismScan 4.8s linear infinite; }

        @media (prefers-reduced-motion: reduce) {
          .prism-cursor, .prism-scan { animation: none; }
          .prism-reveal { opacity: 1; animation: none; }
        }

        @media (max-width: 760px) {
          .prism-layout { flex-direction: column !important; }
          .prism-left {
            width: 100% !important;
            border-right: none !important;
            border-bottom: 1px solid var(--color-border);
            padding: 1.75rem 1.5rem !important;
          }
          .prism-console, .prism-left-footer { display: none !important; }
          .prism-right   { padding: 2.25rem 1.5rem !important; }
        }
      `}</style>

      <div
        className="prism-layout"
        style={{ display: 'flex', minHeight: '100vh', backgroundColor: 'var(--color-bg)' }}
      >

        {/* ── Left panel — live service console ───────────────────────────── */}
        <div
          className="prism-left"
          style={{
            width: '46%',
            flexShrink: 0,
            backgroundColor: 'var(--color-card)',
            borderRight: '1px solid var(--color-border)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            padding: '2.75rem 3rem',
            position: 'relative',
            overflow: 'hidden',
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

          {/* Terminal window — titlebar with live clock, then the boot log. */}
          <div
            className="prism-console"
            style={{
              position: 'relative',
              borderRadius: 6,
              border: '1px solid var(--color-border)',
              backgroundColor: 'color-mix(in srgb, var(--color-bg) 70%, transparent)',
              fontFamily: MONO,
              overflow: 'hidden',
              boxShadow: '0 10px 30px -18px rgb(0 0 0 / 0.5)',
            }}
          >
            {/* Titlebar */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '9px 14px', borderBottom: '1px solid var(--color-border)', backgroundColor: 'color-mix(in srgb, var(--color-text-primary) 4%, transparent)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: 'var(--color-success)', boxShadow: '0 0 7px var(--color-success)', flexShrink: 0 }} />
                <span style={{ fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>
                  prism · service console
                </span>
              </div>
              <span style={{ fontSize: 11, letterSpacing: '0.04em', color: 'var(--color-text-faint)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                {clock}
              </span>
            </div>

            {/* Body — boot log */}
            <div style={{ position: 'relative', padding: '16px 16px 15px' }}>
              {/* Sweeping scanline for a faint live-CRT read */}
              <span
                className="prism-scan"
                aria-hidden="true"
                style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 40, background: 'linear-gradient(var(--color-accent), transparent)', opacity: 0.05, pointerEvents: 'none' }}
              />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                {bootRows.map((row, i) => {
                  const delay = `${0.12 + i * 0.11}s`;
                  if (row.kind === 'head') {
                    return (
                      <p key="head" className="prism-reveal" style={{ animationDelay: delay, margin: 0, fontSize: 11, letterSpacing: '0.12em', color: 'var(--color-text-faint)', textTransform: 'uppercase' }}>
                        {row.text}
                      </p>
                    );
                  }
                  if (row.kind === 'ready') {
                    return (
                      <p key="ready" className="prism-reveal" style={{ animationDelay: delay, margin: '5px 0 0', fontSize: 11, letterSpacing: '0.12em', color: 'var(--color-text-faint)' }}>
                        └─ ready
                        <span className="prism-cursor" style={{ color: 'var(--color-accent)', marginLeft: 6 }}>▊</span>
                      </p>
                    );
                  }
                  return (
                    <div key={row.text} className="prism-reveal" style={{ animationDelay: delay, display: 'flex', alignItems: 'baseline', gap: 10, paddingLeft: 2 }}>
                      <span style={{ color: 'var(--color-accent)', fontSize: 13 }}>▸</span>
                      <span style={{ fontSize: 13.5, color: 'var(--color-text-secondary)', letterSpacing: '0.01em' }}>{row.text}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Footer strip */}
          <div className="prism-left-footer" style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 10, fontFamily: MONO, fontSize: 11, color: 'var(--color-text-faint)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
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
                  fontFamily: MONO,
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
                <div style={{ position: 'relative' }}>
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    className="prism-input"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyUp={detectCaps}
                    onKeyDown={detectCaps}
                    onBlur={() => setCapsLock(false)}
                    required
                    style={{ ...inputStyle, paddingRight: 44 }}
                  />
                  <button
                    type="button"
                    className="prism-eye"
                    onClick={() => setShowPassword((v) => !v)}
                    tabIndex={-1}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    title={showPassword ? 'Hide password' : 'Show password'}
                    style={{
                      position: 'absolute',
                      right: 6,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: 32,
                      height: 32,
                      border: 'none',
                      background: 'transparent',
                      color: 'var(--color-text-faint)',
                      cursor: 'pointer',
                      transition: 'color 0.15s',
                    }}
                  >
                    {showPassword ? <IconEyeOff size={18} stroke={1.8} /> : <IconEye size={18} stroke={1.8} />}
                  </button>
                </div>
                {capsLock && (
                  <p style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '8px 0 0', fontSize: 11.5, color: 'var(--color-warning)', fontFamily: MONO, letterSpacing: '0.03em' }}>
                    <span style={{ width: 5, height: 5, borderRadius: '50%', backgroundColor: 'var(--color-warning)' }} />
                    Caps Lock is on
                  </p>
                )}
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
                {submitting ? 'Authenticating…' : 'Sign in'}
                {!submitting && <span className="arrow">→</span>}
              </button>

              <p style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11.5, color: 'var(--color-text-faint)', margin: '1.75rem 0 0 0', fontFamily: MONO, letterSpacing: '0.04em' }}>
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
