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

// Apply a full theme object to the document root as CSS custom properties —
// both the new named variables (--color-*, consumed directly via var(...) by
// pages built with a fixed dark palette) and the legacy rgb-triplet
// variables that the rest of the app's Tailwind classes (bg-navy-*,
// bg-surface, sidebar-surface, bg-prism/text-prism) already read, so a
// single call here repaints virtually the whole app.
export function applyTheme(theme) {
  if (!theme) return;
  const root = document.documentElement;
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
  set('--navy-50', hexToTriplet(theme.bg));
  set('--surface', hexToTriplet(theme.card));
  set('--sidebar', hexToTriplet(theme.sidebar));
  set('--navy-100', hexToTriplet(theme.border));
  set('--navy-200', hexToTriplet(theme.border));
  set('--navy-900', hexToTriplet(theme.textPrimary));
  set('--navy-800', hexToTriplet(theme.textSecondary));
  set('--navy-700', hexToTriplet(theme.textSecondary));
  set('--navy-300', hexToTriplet(theme.textMuted));

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
