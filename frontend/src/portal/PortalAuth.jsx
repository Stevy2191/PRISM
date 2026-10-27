import {
  createContext, useCallback, useContext, useEffect, useState,
} from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import portalApi, { safeNext } from './api';

// Who is signed in to the portal (a contact, never a staff user), plus the
// public portal config (on/off, Microsoft sign-in offered, branding).
const PortalAuthContext = createContext(null);

export function PortalAuthProvider({ children }) {
  const [me, setMe] = useState(null);
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const { data } = await portalApi.get('/me');
      setMe(data.contact);
    } catch {
      setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    portalApi.get('/config').then(({ data }) => setConfig(data)).catch(() => setConfig({ enabled: false, microsoft: false, branding: {} }));
  }, [refresh]);

  const signIn = async (email, password) => {
    const { data } = await portalApi.post('/auth/login', { email, password });
    setMe(data.contact);
    return data.contact;
  };
  const signOut = async () => {
    try { await portalApi.post('/auth/logout'); } finally { setMe(null); }
  };

  return (
    <PortalAuthContext.Provider value={{
      me, setMe, config, loading, refresh, signIn, signOut,
    }}
    >
      {children}
    </PortalAuthContext.Provider>
  );
}

export function usePortalAuth() {
  return useContext(PortalAuthContext);
}

// Pages behind it need a signed-in contact; otherwise sign in and come back.
export function RequireContact({ children }) {
  const { me, loading } = usePortalAuth();
  const location = useLocation();
  if (loading) return <p className="py-16 text-center text-sm" style={{ color: 'var(--color-text-muted)' }}>Loading…</p>;
  if (!me) {
    const next = safeNext(`${location.pathname}${location.search}`);
    return <Navigate to={`/portal/sign-in?next=${encodeURIComponent(next)}`} replace />;
  }
  return children;
}
