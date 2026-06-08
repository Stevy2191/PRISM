import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import api from '../api/api';

const SettingsContext = createContext(null);

const FALLBACK = {
  company: { name: 'PRISM', hasLogo: false, timezone: 'UTC', dateFormat: 'YYYY-MM-DD' },
  branding: {
    primaryColor: '#3a5da6',
    accentColor: '#38bdf8',
    loginBgColor: '#0f1b34',
    welcomeMessage: 'Project & Request Integrated Service Manager',
  },
  logoUrl: null,
};

// Convert "#rrggbb" to a "r g b" triplet for CSS variables.
function hexToTriplet(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(hex || '').trim());
  if (!m) return null;
  return `${parseInt(m[1], 16)} ${parseInt(m[2], 16)} ${parseInt(m[3], 16)}`;
}

// Apply a branding object to the document root via CSS variables.
export function applyBranding(branding) {
  if (!branding) return;
  const root = document.documentElement;
  const primary = hexToTriplet(branding.primaryColor);
  const accent = hexToTriplet(branding.accentColor);
  if (primary) root.style.setProperty('--brand-primary-rgb', primary);
  if (accent) root.style.setProperty('--brand-accent-rgb', accent);
  if (branding.loginBgColor) root.style.setProperty('--login-bg', branding.loginBgColor);
}

export function SettingsProvider({ children }) {
  const [settings, setSettings] = useState(FALLBACK);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const { data } = await api.get('/settings/public');
      setSettings(data);
      applyBranding(data.branding);
    } catch {
      applyBranding(FALLBACK.branding);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const value = { settings, loading, refresh, applyBranding };
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider');
  return ctx;
}
