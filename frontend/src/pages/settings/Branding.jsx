import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { errMessage } from '../../api/api';
import { useSettings } from '../../context/SettingsContext';
import Spinner from '../../components/Spinner';

export default function Branding() {
  const { settings, refresh } = useSettings();
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
  const logoRef = useRef();

  useEffect(() => {
    api.get('/settings')
      .then(({ data }) => {
        const s = data.settings;
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
      await api.patch('/settings', {
        settings: {
          'branding.appName': appName,
          'company.name': companyName,
          'branding.tagline': tagline,
          'branding.loginBullets': JSON.stringify(bullets),
        },
      });
      await refresh();
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

  const uploadLogo = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    try {
      await api.post('/settings/logo', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      await refresh();
      if (logoRef.current) logoRef.current.value = '';
    } catch (err) {
      alert(errMessage(err));
    }
  };
  const removeLogo = async () => {
    try {
      await api.delete('/settings/logo');
      await refresh();
    } catch (err) {
      alert(errMessage(err));
    }
  };

  if (loading) return <Spinner />;

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <Link to="/settings" className="text-sm text-prism hover:underline">← Back to Settings</Link>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-navy-900">Branding</h1>
        <div className="flex items-center gap-3">
          {saved && <span className="text-sm text-green-600">Saved</span>}
          <button onClick={save} className="btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
        </div>
      </div>
      {error && <div className="rounded-md bg-red-50 p-4 text-red-700">{error}</div>}

      <div className="card p-5">
        <h2 className="mb-3 font-semibold text-navy-900">Logo</h2>
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded border border-navy-200 bg-navy-50">
            {settings.logoUrl
              ? <img src={settings.logoUrl} alt="logo" className="h-14 w-14 object-contain" />
              : <span className="text-xs text-navy-400">none</span>}
          </div>
          <div className="flex gap-2">
            <label className="btn-secondary cursor-pointer">
              Upload
              <input ref={logoRef} type="file" accept="image/*" className="hidden" onChange={uploadLogo} />
            </label>
            {settings.logoUrl && <button onClick={removeLogo} className="btn-secondary">Remove</button>}
          </div>
        </div>
        <p className="mt-2 text-xs text-navy-400">Shown in the sidebar and on the login page. PNG/SVG, up to 5MB.</p>
      </div>

      <div className="card p-5">
        <h2 className="mb-3 font-semibold text-navy-900">Favicon</h2>
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

      <div className="card space-y-4 p-5">
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
      </div>
    </div>
  );
}
