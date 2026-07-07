import { createContext, useContext, useState, useEffect, useCallback } from 'react';

const NavStyleContext = createContext(null);
const STORAGE_KEY = 'prism.navStyle';

export function NavStyleProvider({ children }) {
  const [navStyle, setNavStyleState] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) || 'topbar';
    } catch {
      return 'topbar';
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, navStyle);
    } catch {
      /* ignore */
    }
  }, [navStyle]);

  const setNavStyle = useCallback((s) => setNavStyleState(s), []);

  const value = { navStyle, setNavStyle };
  return <NavStyleContext.Provider value={value}>{children}</NavStyleContext.Provider>;
}

export function useNavStyle() {
  const ctx = useContext(NavStyleContext);
  if (!ctx) throw new Error('useNavStyle must be used within NavStyleProvider');
  return ctx;
}

export const NAV_STYLE_OPTIONS = [
  { value: 'topbar', label: 'Top bar' },
  { value: 'sidebar', label: 'Side bar (compact)' },
];
