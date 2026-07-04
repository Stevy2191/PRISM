import { useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSettings, applyPersonalColors } from '../context/SettingsContext';

// Bridges AuthContext (owns the logged-in user, including their personal
// userColors) and SettingsContext (owns the admin palette + does the actual
// CSS variable application) — the two contexts can't reach each other
// directly since AuthProvider is nested inside SettingsProvider. Renders
// nothing; it's a pure side-effect component mounted once near the app root.
export default function PersonalColorsSync() {
  const { user } = useAuth();
  const { settings } = useSettings();

  useEffect(() => {
    if (!user) return;
    try { localStorage.setItem('prism.lastUserId', String(user.id)); } catch { /* ignore */ }
    applyPersonalColors(user.id, user.userColors || null, !!user.userColorsEnabled);
    // Re-run whenever the admin's "allow overrides" flag flips too.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, user?.userColors, user?.userColorsEnabled, settings.theme?.usersCanOverrideColors]);

  return null;
}
