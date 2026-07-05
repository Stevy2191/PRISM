import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import api from '../api/api';

const SettingsContext = createContext(null);

const FALLBACK = {
  appName: 'PRISM',
  company: { name: 'Acme Corp', hasLogo: false, timezone: 'UTC', dateFormat: 'YYYY-MM-DD' },
  branding: {
    appName: 'PRISM',
    tagline: 'Project & Request Integrated Service Manager',
    loginBullets: ['Ticket & project tracking', 'Time logging & reports', 'AD & local auth', 'API access'],
  },
  logoUrl: null,
  faviconUrl: null,
};

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
      applyFavicon(data.faviconUrl);
      if (data.appName) document.title = data.appName;
    } catch {
      /* keep FALLBACK */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const value = { settings, loading, refresh };
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider');
  return ctx;
}
