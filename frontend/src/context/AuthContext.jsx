import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import api from '../api/api';

const AuthContext = createContext(null);

// Best-effort fetch of the resolved permissions map — never throws, since a
// failure here (e.g. a brand-new session mid-password-change) shouldn't
// block login/refresh; permission-gated UI just falls back to hidden.
async function fetchPermissions() {
  try {
    const { data } = await api.get('/auth/me/permissions');
    return data.permissions || {};
  } catch {
    return {};
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [permissions, setPermissions] = useState({});
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const { data } = await api.get('/auth/me');
      setUser(data.user);
      setPermissions(await fetchPermissions());
    } catch {
      setUser(null);
      setPermissions({});
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Re-fetches just the permissions map (cheaper than a full refresh()).
  // Call this immediately after a role/override change is made to the
  // current user, so temporary grants/revocations apply without a
  // logout/login. Also polled passively every 5 minutes below so a change
  // made in another session/tab still takes effect reasonably promptly.
  const refreshPermissions = useCallback(async () => {
    setPermissions(await fetchPermissions());
  }, []);

  useEffect(() => {
    if (!user) return undefined;
    const interval = setInterval(refreshPermissions, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [user, refreshPermissions]);

  const login = async (username, password) => {
    const { data } = await api.post('/auth/login', { username, password });
    setUser(data.user);
    setPermissions(await fetchPermissions());
    return data.user;
  };

  const changePassword = async (currentPassword, newPassword) => {
    const { data } = await api.post('/auth/change-password', { currentPassword, newPassword });
    setUser(data.user);
    return data.user;
  };

  const logout = async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      setUser(null);
      setPermissions({});
    }
  };

  const hasPermission = (key) => !!permissions[key];
  const hasAnyPermission = (keys) => keys.some((key) => !!permissions[key]);

  const value = {
    user,
    loading,
    permissions,
    hasPermission,
    hasAnyPermission,
    login,
    logout,
    changePassword,
    refresh,
    refreshPermissions,
    mustChangePassword: !!user?.mustChangePassword,
    isAdmin: user?.role === 'admin',
    isStaff: user?.role === 'admin' || user?.role === 'technician',
    canLogTimeForOthers: !!user?.canLogTimeForOthers,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

// usePermission('tickets.create') -> boolean. Cosmetic only — hides/shows UI;
// the backend (requirePermission middleware) is the actual enforcement.
export function usePermission(key) {
  const { hasPermission } = useAuth();
  return hasPermission(key);
}

// useAnyPermission(['settings.manage_system', ...]) -> true if ANY are granted.
export function useAnyPermission(keys) {
  const { hasAnyPermission } = useAuth();
  return hasAnyPermission(keys);
}
