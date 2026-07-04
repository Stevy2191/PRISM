import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import api from '../api/api';

const SettingsContext = createContext(null);

const THEME_CACHE_KEY = 'prism.theme.cache';
const LAST_USER_KEY = 'prism.lastUserId';

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
    usersCanOverrideColors: true,
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

// All CSS variables either tier ever sets — always cleared as a whole before
// re-applying both tiers, since a DOM inline style has no "layer below it"
// to fall back to: removeProperty() on a single tier would otherwise expose
// the stylesheet's base-theme value directly, skipping over the other
// active tier. See resolveColors().
const ADMIN_VARS = [
  '--color-bg', '--color-sidebar', '--color-card', '--color-border',
  '--color-accent', '--color-accent-hover', '--color-text-primary',
  '--color-text-secondary', '--color-text-muted', '--color-success',
  '--color-warning', '--color-danger', '--color-timer',
];
// Tier 1 (personal) supports a smaller field set than the admin palette.
const PERSONAL_VARS = [
  '--color-bg', '--color-sidebar', '--color-card', '--color-border',
  '--color-accent', '--color-text-primary', '--color-text-secondary',
  '--color-success', '--color-warning', '--color-danger',
];
const ALL_MANAGED_VARS = [...new Set([...ADMIN_VARS, '--brand-primary-rgb'])];

// The single authoritative color resolver: clears every managed variable,
// then re-applies tier 3 (admin palette, only when explicitly saved via
// Settings -> Appearance) and layers tier 1 (personal overrides, only when
// the admin allows it and the user has any) on top. Tiers 2/4 (personal
// theme choice and built-in defaults) are handled entirely by the
// stylesheet's [data-theme] blocks and need no JS application here.
function resolveColors({ adminTheme, userColors, usersCanOverrideColors }) {
  const root = document.documentElement;
  ALL_MANAGED_VARS.forEach((name) => root.style.removeProperty(name));

  const set = (name, val) => { if (val) root.style.setProperty(name, val); };

  if (adminTheme && adminTheme.mode === 'custom') {
    set('--color-bg', adminTheme.bg);
    set('--color-sidebar', adminTheme.sidebar);
    set('--color-card', adminTheme.card);
    set('--color-border', adminTheme.border);
    set('--color-accent', adminTheme.accent);
    set('--color-accent-hover', adminTheme.accentHover);
    set('--color-text-primary', adminTheme.textPrimary);
    set('--color-text-secondary', adminTheme.textSecondary);
    set('--color-text-muted', adminTheme.textMuted);
    set('--color-success', adminTheme.success);
    set('--color-warning', adminTheme.warning);
    set('--color-danger', adminTheme.danger);
    set('--color-timer', adminTheme.timer);
    set('--brand-primary-rgb', hexToTriplet(adminTheme.accent));
  }

  if (usersCanOverrideColors && userColors && Object.keys(userColors).length) {
    Object.entries(userColors).forEach(([name, val]) => {
      if (PERSONAL_VARS.includes(name) && val) root.style.setProperty(name, val);
    });
    if (userColors['--color-accent']) set('--brand-primary-rgb', hexToTriplet(userColors['--color-accent']));
  }
}

// Admin tier only — used by the Appearance page's own logic that doesn't
// need to know about the personal-color layer.
export function applyTheme(theme) {
  resolveColors({ adminTheme: theme, userColors: lastPersonalColors, usersCanOverrideColors: theme?.usersCanOverrideColors });
  try {
    if (theme && theme.mode === 'custom') localStorage.setItem(THEME_CACHE_KEY, JSON.stringify(theme));
    else localStorage.removeItem(THEME_CACHE_KEY);
  } catch { /* ignore */ }
}

// Kept for the favicon, which isn't a CSS variable.
function applyFavicon(faviconUrl) {
  const link = document.querySelector('link[rel="icon"]');
  if (link) link.href = faviconUrl || '/favicon.svg';
}

// Module-level (not React state) so applyTheme()'s re-resolves — triggered
// by an admin settings refresh — don't wipe out whatever personal colors
// were last applied by applyPersonalColors(). SettingsProvider is a
// singleton, so this is safe and avoids threading personal-color state
// through a provider that (by design) knows nothing about the logged-in user.
let lastAdminTheme = FALLBACK.theme;
let lastPersonalColors = null;

// Tier 1 — called by PersonalColorsSync once the logged-in user (and their
// userColors/userColorsEnabled) is known. `enabled` is the user's own
// "Use my own colors" toggle (userColorsEnabled) — kept separate from
// userColors itself so turning the toggle off never destroys the saved
// values, only stops applying them. Re-resolves both tiers together and
// caches the result per-user so the next load can apply it before React
// even mounts (see index.html's pre-mount script).
export function applyPersonalColors(userId, userColors, enabled) {
  const active = enabled && userColors && Object.keys(userColors).length ? userColors : null;
  lastPersonalColors = active;
  resolveColors({
    adminTheme: lastAdminTheme,
    userColors: active,
    usersCanOverrideColors: lastAdminTheme?.usersCanOverrideColors,
  });
  try {
    const cacheKey = `prism_colors_${userId}`;
    if (active && lastAdminTheme?.usersCanOverrideColors !== false) {
      localStorage.setItem(cacheKey, JSON.stringify(active));
      localStorage.setItem(LAST_USER_KEY, String(userId));
    } else {
      localStorage.removeItem(cacheKey);
    }
  } catch { /* ignore */ }
}

export function SettingsProvider({ children }) {
  const [settings, setSettings] = useState(FALLBACK);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const { data } = await api.get('/settings/public');
      setSettings(data);
      lastAdminTheme = data.theme;
      applyTheme(data.theme);
      applyFavicon(data.faviconUrl);
      if (data.appName) document.title = data.appName;
    } catch {
      lastAdminTheme = FALLBACK.theme;
      applyTheme(FALLBACK.theme);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const value = { settings, loading, refresh, applyTheme, applyPersonalColors };
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider');
  return ctx;
}
