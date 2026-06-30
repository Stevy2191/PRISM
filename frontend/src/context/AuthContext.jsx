import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import api from '../api/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const { data } = await api.get('/auth/me');
      setUser(data.user);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const login = async (username, password) => {
    const { data } = await api.post('/auth/login', { username, password });
    setUser(data.user);
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
    }
  };

  const value = {
    user,
    loading,
    login,
    logout,
    changePassword,
    refresh,
    mustChangePassword: !!user?.mustChangePassword,
    isAdmin: user?.role === 'admin',
    isStaff: user?.role === 'admin' || user?.role === 'technician',
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
