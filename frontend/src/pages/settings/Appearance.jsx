import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { errMessage } from '../../api/api';
import { useSettings } from '../../context/SettingsContext';
import Spinner from '../../components/Spinner';

const COLOR_FIELDS = [
  ['bg', 'App background'],
  ['sidebar', 'Sidebar background'],
  ['card', 'Card / panel background'],
  ['border', 'Border color'],
  ['accent', 'Primary accent'],
  ['accentHover', 'Primary button hover'],
  ['textPrimary', 'Text primary'],
  ['textSecondary', 'Text secondary'],
  ['textMuted', 'Text muted'],
  ['success', 'Success color'],
  ['warning', 'Warning color'],
  ['danger', 'Danger / error color'],
  ['timer', 'Timer running color'],
];

const PRESETS = {
  dark: {
    label: 'Dark (default)',
    theme: {
      bg: '#080b12', sidebar: '#0a0d14', card: '#0d1120', border: '#161c2d',
      accent: '#3b82f6', accentHover: '#1d4ed8', textPrimary: '#f1f5f9',
      textSecondary: '#94a3b8', textMuted: '#475569', success: '#22c55e',
      warning: '#f59e0b', danger: '#ef4444', timer: '#4ade80',
    },
  },
  darker: {
    label: 'Darker',
    theme: {
      bg: '#000000', sidebar: '#000000', card: '#0a0a0a', border: '#1f1f1f',
      accent: '#3b82f6', accentHover: '#1d4ed8', textPrimary: '#ffffff',
      textSecondary: '#a3a3a3', textMuted: '#525252', success: '#22c55e',
      warning: '#f59e0b', danger: '#ef4444', timer: '#4ade80',
    },
  },
  midnight: {
    label: 'Midnight',
    theme: {
      bg: '#0f0a1e', sidebar: '#0c0818', card: '#171029', border: '#2a1f47',
      accent: '#8b5cf6', accentHover: '#7c3aed', textPrimary: '#f3f0ff',
      textSecondary: '#a89fc9', textMuted: '#5b5178', success: '#22c55e',
      warning: '#f59e0b', danger: '#ef4444', timer: '#a78bfa',
    },
  },
  slate: {
    label: 'Slate',
    theme: {
      bg: '#0f172a', sidebar: '#0b1220', card: '#1e293b', border: '#334155',
      accent: '#38bdf8', accentHover: '#0ea5e9', textPrimary: '#f1f5f9',
      textSecondary: '#94a3b8', textMuted: '#64748b', success: '#22c55e',
      warning: '#f59e0b', danger: '#ef4444', timer: '#4ade80',
    },
  },
};

function MiniPreview({ theme, appName, tagline }) {
  return (
    <div
      className="overflow-hidden rounded-lg border"
      style={{ borderColor: theme.border, backgroundColor: theme.bg, fontFamily: 'Inter, system-ui, sans-serif' }}
    >
      <div className="flex" style={{ height: 220 }}>
        {/* Mini sidebar */}
        <div className="flex flex-shrink-0 flex-col gap-2 p-3" style={{ width: 70, backgroundColor: theme.sidebar }}>
          <div className="mb-2 h-3 w-10 rounded" style={{ backgroundColor: theme.accent }} />
          <div className="h-2 w-full rounded" style={{ backgroundColor: theme.accent, opacity: 0.9 }} />
          <div className="h-2 w-full rounded opacity-40" style={{ backgroundColor: theme.textSecondary }} />
          <div className="h-2 w-full rounded opacity-40" style={{ backgroundColor: theme.textSecondary }} />
        </div>
        {/* Mini main content */}
        <div className="flex-1 p-3">
          <div className="mb-2 text-[9px] font-semibold uppercase tracking-wide" style={{ color: theme.textSecondary }}>
            {appName || 'PRISM'}
          </div>
          <div className="mb-3 text-[8px]" style={{ color: theme.textMuted }}>{tagline}</div>
          <div className="mb-2 rounded p-2" style={{ backgroundColor: theme.card, border: `1px solid ${theme.border}` }}>
            <div className="mb-1 h-2 w-3/4 rounded" style={{ backgroundColor: theme.textPrimary, opacity: 0.85 }} />
            <div className="h-1.5 w-1/2 rounded" style={{ backgroundColor: theme.textMuted }} />
          </div>
          <div className="flex gap-1.5">
            <span className="rounded px-2 py-0.5 text-[8px] font-semibold text-white" style={{ backgroundColor: theme.accent }}>Primary</span>
            <span className="rounded px-2 py-0.5 text-[8px] font-semibold" style={{ backgroundColor: theme.success, color: '#052e16' }}>Success</span>
            <span className="rounded px-2 py-0.5 text-[8px] font-semibold" style={{ backgroundColor: theme.warning, color: '#451a03' }}>Warn</span>
            <span className="rounded px-2 py-0.5 text-[8px] font-semibold text-white" style={{ backgroundColor: theme.danger }}>Danger</span>
          </div>
          <div className="mt-3 flex items-center gap-2 font-mono text-[9px] font-semibold" style={{ color: theme.timer }}>
            ▶ 00:12:04
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Appearance() {
  const { settings, refresh } = useSettings();
  const [theme, setTheme] = useState(null);
  const [themeMode, setThemeMode] = useState('auto');
  const [appName, setAppName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [tagline, setTagline] = useState('');
  const [bullets, setBullets] = useState([]);
  const [newBullet, setNewBullet] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const faviconRef = useRef();

  useEffect(() => {
    api.get('/settings')
      .then(({ data }) => {
        const s = data.settings;
        setThemeMode(s['theme.mode'] || 'auto');
        setTheme({
          bg: s['theme.bg'], sidebar: s['theme.sidebar'], card: s['theme.card'], border: s['theme.border'],
          accent: s['theme.accent'], accentHover: s['theme.accentHover'], textPrimary: s['theme.textPrimary'],
          textSecondary: s['theme.textSecondary'], textMuted: s['theme.textMuted'], success: s['theme.success'],
          warning: s['theme.warning'], danger: s['theme.danger'], timer: s['theme.timer'],
        });
        setAppName(s['branding.appName'] || 'PRISM');
        setCompanyName(s['company.name'] || '');
        setTagline(s['branding.tagline'] || '');
        try {
          setBullets(JSON.parse(s['branding.loginBullets'] || '[]'));
        } catch {
          setBullets([]);
        }
      })
      .catch((err) => setError(errMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  const setColor = (key) => (e) => setTheme((t) => ({ ...t, [key]: e.target.value }));

  const applyPreset = (presetKey) => {
    setTheme(PRESETS[presetKey].theme);
  };

  const moveBullet = (index, dir) => {
    setBullets((list) => {
      const next = [...list];
      const target = index + dir;
      if (target < 0 || target >= next.length) return list;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };
  const removeBullet = (index) => setBullets((list) => list.filter((_, i) => i !== index));
  const addBullet = () => {
    if (!newBullet.trim()) return;
    setBullets((list) => [...list, newBullet.trim()]);
    setNewBullet('');
  };

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const payload = { settings: {} };
      COLOR_FIELDS.forEach(([key]) => { payload.settings[`theme.${key}`] = theme[key]; });
      payload.settings['theme.mode'] = 'custom';
      payload.settings['branding.appName'] = appName;
      payload.settings['company.name'] = companyName;
      payload.settings['branding.tagline'] = tagline;
      payload.settings['branding.loginBullets'] = JSON.stringify(bullets);
      await api.patch('/settings', payload);
      await refresh();
      setThemeMode('custom');
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setSaving(false);
    }
  };

  // Reverts to "no override" — every page then follows the viewer's own
  // light/dark/system preference (Settings -> Preferences) instead of a
  // fixed admin-chosen palette.
  const resetToDefault = async () => {
    setSaving(true);
    setError('');
    try {
      await api.patch('/settings', { settings: { 'theme.mode': 'auto' } });
      await refresh();
      setThemeMode('auto');
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const uploadFavicon = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    try {
      await api.post('/settings/favicon', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      await refresh();
      if (faviconRef.current) faviconRef.current.value = '';
    } catch (err) {
      alert(errMessage(err));
    }
  };
  const removeFavicon = async () => {
    try {
      await api.delete('/settings/favicon');
      await refresh();
    } catch (err) {
      alert(errMessage(err));
    }
  };

  if (loading || !theme) return <Spinner />;

  return (
    <div className="space-y-5">
      <Link to="/settings" className="text-sm text-prism hover:underline">← Back to Settings</Link>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-navy-900">Appearance</h1>
        <div className="flex items-center gap-3">
          {saved && <span className="text-sm text-green-600">Saved</span>}
          {themeMode === 'custom' && (
            <button onClick={resetToDefault} className="btn-secondary" disabled={saving}>Reset to default</button>
          )}
          <button onClick={save} className="btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
        </div>
      </div>
      <p className="text-sm text-navy-500">
        {themeMode === 'custom'
          ? 'A custom color palette is active for everyone and overrides each user’s own light/dark preference below.'
          : 'No custom palette is active — everyone sees their own Light/Dark/System preference from Settings → Preferences. Saving here applies a palette for all users.'}
      </p>
      {error && <div className="rounded-md bg-red-50 p-4 text-red-700">{error}</div>}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* Left: settings form */}
        <div className="space-y-5 lg:col-span-2">
          <div className="card p-5">
            <h2 className="mb-3 font-semibold text-navy-900">Preset themes</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {Object.entries(PRESETS).map(([key, preset]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => applyPreset(key)}
                  className="rounded-md border border-navy-200 p-2 text-left transition hover:border-prism"
                >
                  <div className="mb-2 flex h-8 overflow-hidden rounded">
                    <span className="w-1/3" style={{ backgroundColor: preset.theme.bg }} />
                    <span className="w-1/3" style={{ backgroundColor: preset.theme.card }} />
                    <span className="w-1/3" style={{ backgroundColor: preset.theme.accent }} />
                  </div>
                  <span className="text-xs font-medium text-navy-700">{preset.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="card p-5">
            <h2 className="mb-3 font-semibold text-navy-900">Colors</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {COLOR_FIELDS.map(([key, label]) => (
                <div key={key}>
                  <label className="label">{label}</label>
                  <div className="flex items-center gap-2">
                    <input type="color" className="h-9 w-12 rounded border border-navy-200" value={theme[key] || '#000000'} onChange={setColor(key)} />
                    <input className="input font-mono text-sm" value={theme[key] || ''} onChange={setColor(key)} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="card p-5">
            <h2 className="mb-3 font-semibold text-navy-900">Branding</h2>
            <div className="space-y-4">
              <div>
                <label className="label">App name</label>
                <input className="input" value={appName} onChange={(e) => setAppName(e.target.value)} />
                <p className="mt-1 text-xs text-navy-400">Shown in the sidebar, login page, and browser tab title.</p>
              </div>
              <div>
                <label className="label">Company name</label>
                <input className="input" value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
                <p className="mt-1 text-xs text-navy-400">Shown in email footers and reports.</p>
              </div>
              <div>
                <label className="label">Login page tagline</label>
                <input className="input" value={tagline} onChange={(e) => setTagline(e.target.value)} />
              </div>
              <div>
                <label className="label">Login page bullet points</label>
                <ul className="mb-2 space-y-1.5">
                  {bullets.map((bullet, i) => (
                    <li key={`${bullet}-${i}`} className="flex items-center gap-2 rounded border border-navy-200 px-2 py-1.5">
                      <span className="flex-1 text-sm text-navy-800">{bullet}</span>
                      <button type="button" onClick={() => moveBullet(i, -1)} disabled={i === 0} className="text-navy-400 hover:text-navy-700 disabled:opacity-30">↑</button>
                      <button type="button" onClick={() => moveBullet(i, 1)} disabled={i === bullets.length - 1} className="text-navy-400 hover:text-navy-700 disabled:opacity-30">↓</button>
                      <button type="button" onClick={() => removeBullet(i)} className="text-red-500 hover:text-red-700">✕</button>
                    </li>
                  ))}
                </ul>
                <div className="flex gap-2">
                  <input
                    className="input"
                    value={newBullet}
                    onChange={(e) => setNewBullet(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addBullet(); } }}
                    placeholder="Add a bullet point…"
                  />
                  <button type="button" onClick={addBullet} className="btn-secondary whitespace-nowrap">Add</button>
                </div>
              </div>
              <div>
                <label className="label">Favicon</label>
                <div className="flex items-center gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded border border-navy-200 bg-navy-50">
                    {settings.faviconUrl
                      ? <img src={settings.faviconUrl} alt="favicon" className="h-8 w-8 object-contain" />
                      : <span className="text-[10px] text-navy-400">default</span>}
                  </div>
                  <label className="btn-secondary cursor-pointer">
                    Upload
                    <input ref={faviconRef} type="file" accept="image/*" className="hidden" onChange={uploadFavicon} />
                  </label>
                  {settings.faviconUrl && <button onClick={removeFavicon} className="btn-secondary">Remove</button>}
                </div>
                <p className="mt-2 text-xs text-navy-400">Replaces the default geometric mark in the browser tab.</p>
              </div>
            </div>
          </div>
        </div>

        {/* Right: live preview */}
        <div className="lg:col-span-1">
          <div className="sticky top-4 card p-4">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-navy-400">Live preview</h2>
            <MiniPreview theme={theme} appName={appName} tagline={tagline} />
          </div>
        </div>
      </div>
    </div>
  );
}
