import { useEffect, useState } from 'react';

// The sign-in page's left panel: the "service console" (brand, a terminal
// window with a live clock printing the Company profile bullet points, the
// tagline along the bottom). Restored from before the look A restyle at the
// user's request (2026-10-27). On a phone only the brand shows.
const MONO = 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace)';

// Zero-padded YYYY-MM-DD · HH:MM:SS: honest "live" telemetry, no invented metrics.
function formatClock(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}  ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export default function ServiceConsolePanel({
  wordmark, logoUrl, tagline, bullets,
}) {
  const [clock, setClock] = useState(() => formatClock(new Date()));
  useEffect(() => {
    const id = setInterval(() => setClock(formatClock(new Date())), 1000);
    return () => clearInterval(id);
  }, []);

  // Boot-log rows: the manifest header, one row per bullet, then the ready
  // prompt, each revealed in turn so the panel "prints in".
  const bootRows = [
    { kind: 'head', text: '\u250c\u2500 SERVICE OPERATIONS' },
    ...bullets.map((text) => ({ kind: 'item', text })),
    { kind: 'ready', text: '\u2514\u2500 ready' },
  ];

  return (
    <>
      <style>{`
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
        @media (max-width: 767px) {
          .prism-left {
            width: 100% !important;
            border-right: none !important;
            border-bottom: 1px solid var(--color-border);
            padding: 1.25rem 1.25rem !important;
          }
          .prism-console, .prism-left-footer { display: none !important; }
        }
      `}</style>
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
          {logoUrl ? (
            <img src={logoUrl} alt="" style={{ height: 30, width: 30, objectFit: 'contain' }} />
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
    </>
  );
}
