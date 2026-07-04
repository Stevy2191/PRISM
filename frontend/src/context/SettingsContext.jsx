import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import api from '../api/api';

const SettingsContext = createContext(null);

const THEME_CACHE_KEY = 'prism.theme.cache';

const FALLBACK = {
  appName: 'PRISM',
  company: { name: 'Acme Corp', hasLogo: false, timezone: 'UTC', dateFormat: 'YYYY-MM-DD' },
  branding: {
    appName: 'PRISM',
    tagline: 'Project & Request Integrated Service Manager',
    loginBullets: ['Ticket & project tracking', 'Time logging & reports', 'AD & local auth', 'API access'],
  },
  theme: {
    mode: 'auto',
    preset: 'dark',
    bg: '#080b12',
    sidebar: '#0a0d14',
    card: '#0d1120',
    border: '#161c2d',
    accent: '#3b82f6',
    accentHover: '#1d4ed8',
    textPrimary: '#f1f5f9',
    textSecondary: '#94a3b8',
    textMuted: '#475569',
    success: '#22c55e',
    warning: '#f59e0b',
    danger: '#ef4444',
    timer: '#4ade80',
  },
  logoUrl: null,
  faviconUrl: null,
};

// Convert "#rrggbb" to a "r g b" triplet for CSS variables (Tailwind alpha support).
function hexToTriplet(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(hex || '').trim());
  if (!m) return null;
  return `${parseInt(m[1], 16)} ${parseInt(m[2], 16)} ${parseInt(m[3], 16)}`;
}

const OVERRIDE_VARS = [
  '--color-bg', '--color-sidebar', '--color-card', '--color-border',
  '--color-accent', '--color-accent-hover', '--color-text-primary',
  '--color-text-secondary', '--color-text-muted', '--color-success',
  '--color-warning', '--color-danger', '--color-timer', '--brand-primary-rgb',
];

// Layer an admin custom theme (Settings -> Appearance) on top of whichever
// base theme (light/dark, see ThemeContext.jsx) is currently active — but
// ONLY when the admin has actually saved one (theme.mode === 'custom').
// Otherwise every page is left to the viewer's own light/dark/system
// preference with no override at all, which is what makes "custom colors
// layer on top of the base theme, not replace it" true in practice: this
// only ever touches the --color-* variables (plus --brand-primary-rgb,
// which mirrors --color-accent for Tailwind's bg-prism/text-prism classes),
// and deliberately never touches --navy-*/--surface, which stay owned by
// the light/dark base theme so the two systems can't collide.
export function applyTheme(theme) {
  const root = document.documentElement;

  if (!theme || theme.mode !== 'custom') {
    OVERRIDE_VARS.forEach((name) => root.style.removeProperty(name));
    try { localStorage.removeItem(THEME_CACHE_KEY); } catch { /* ignore */ }
    return;
  }

  const set = (name, val) => { if (val) root.style.setProperty(name, val); };
  set('--color-bg', theme.bg);
  set('--color-sidebar', theme.sidebar);
  set('--color-card', theme.card);
  set('--color-border', theme.border);
  set('--color-accent', theme.accent);
  set('--color-accent-hover', theme.accentHover);
  set('--color-text-primary', theme.textPrimary);
  set('--color-text-secondary', theme.textSecondary);
  set('--color-text-muted', theme.textMuted);
  set('--color-success', theme.success);
  set('--color-warning', theme.warning);
  set('--color-danger', theme.danger);
  set('--color-timer', theme.timer);
  set('--brand-primary-rgb', hexToTriplet(theme.accent));

  try { localStorage.setItem(THEME_CACHE_KEY, JSON.stringify(theme)); } catch { /* ignore */ }
}

// Kept for the favicon, which isn't a CSS variable.
function applyFavicon(faviconUrl) {
  const link = document.querySelector('link[rel="icon"]');
  if (link) link.href = faviconUrl || '/favicon.svg';
}

export function SettingsProvider({ children }) {
  const [settings, setSettings] = useState(FALLBACK);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const { data } = await api.get('/settings/public');
      setSettings(data);
      applyTheme(data.theme);
      applyFavicon(data.faviconUrl);
      if (data.appName) document.title = data.appName;
    } catch {
      applyTheme(FALLBACK.theme);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const value = { settings, loading, refresh, applyTheme };
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider');
  return ctx;
}
