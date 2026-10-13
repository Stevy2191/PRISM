// Company and Branding as one page (spec: Settings redesign): each value is
// edited in one place. The logo and favicon save on upload (needs
// settings.manage_branding or manage_system); the rest saves with Save, which
// the server allows only with settings.manage_system, so a branding-only
// user sees those fields read-only.
import { useEffect, useRef, useState } from 'react';
import api, { errMessage } from '../../api/api';
import { useAuth } from '../../context/AuthContext';
import { useSettings } from '../../context/SettingsContext';
import Spinner from '../../components/Spinner';
import SettingsPage, { SettingsPanel, SettingsRow } from '../../components/settings/SettingsPage';
import SaveBar, { isDirty } from '../../components/settings/SaveBar';

const TIMEZONES = ['UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Europe/London', 'Europe/Berlin', 'Asia/Kolkata', 'Asia/Tokyo', 'Australia/Sydney'];
const DATE_FORMATS = ['YYYY-MM-DD', 'MM/DD/YYYY', 'DD/MM/YYYY', 'DD MMM YYYY'];
const TIME_FORMATS = [['12h', '12-hour (2:30 PM)'], ['24h', '24-hour (14:30)']];
const LANGUAGES = [['en', 'English'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German']];
const KEYS = ['company.name', 'company.supportEmail', 'company.timezone', 'company.dateFormat', 'company.timeFormat', 'company.language', 'branding.appName', 'branding.tagline'];
const DEFAULTS = { 'company.timezone': 'UTC', 'company.dateFormat': 'YYYY-MM-DD', 'company.timeFormat': '12h', 'company.language': 'en', 'branding.appName': 'PRISM' };

function ImagePicker({ label, url, onUpload, onRemove, help }) {
  const ref = useRef();
  return (
    <div className="flex flex-wrap items-center gap-4">
      <div className="flex h-14 w-14 items-center justify-center rounded border border-navy-200 bg-navy-50">
        {url ? <img src={url} alt={label} className="h-12 w-12 object-contain" /> : <span className="text-[10px] text-navy-400">none</span>}
      </div>
      <label className="btn-secondary cursor-pointer">
        Upload
        <input ref={ref} type="file" accept="image/*" className="hidden" aria-label={`Upload ${label.toLowerCase()}`}
          onChange={async (e) => { await onUpload(e.target.files?.[0]); if (ref.current) ref.current.value = ''; }} />
      </label>
      {url && <button type="button" onClick={onRemove} className="btn-secondary">Remove</button>}
      {help && <p className="w-full text-xs text-navy-400">{help}</p>}
    </div>
  );
}

export default function CompanyProfile() {
  const { hasPermission } = useAuth();
  const canSave = hasPermission('settings.manage_system');
  const { settings, refresh } = useSettings();
  const [form, setForm] = useState(null);
  const [snapshot, setSnapshot] = useState(null);
  const [bullets, setBullets] = useState([]);
  const [newBullet, setNewBullet] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.get('/settings').then(({ data }) => {
      const s = data.settings;
      const f = Object.fromEntries(KEYS.map((k) => [k, s[k] || DEFAULTS[k] || '']));
      let b = [];
      try { b = JSON.parse(s['branding.loginBullets'] || '[]'); } catch { b = []; }
      setForm(f);
      setBullets(b);
      setSnapshot({ f, b });
    }).catch((err) => setError(errMessage(err)));
  }, []);

  if (!form) return error ? <div className="rounded-md bg-red-50 p-4 text-red-700">{error}</div> : <Spinner />;

  const dirty = isDirty({ f: form, b: bullets }, snapshot);
  const set = (k) => (e) => { setSaved(false); setForm((f) => ({ ...f, [k]: e.target.value })); };
  const setList = (next) => { setSaved(false); setBullets(next); };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api.patch('/settings', { settings: { ...form, 'branding.loginBullets': JSON.stringify(bullets) } });
      await refresh();
      setSnapshot({ f: form, b: bullets });
      setSaved(true);
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const upload = (path) => async (file) => {
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    try {
      await api.post(path, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      await refresh();
    } catch (err) { setError(errMessage(err)); }
  };
  const remove = (path) => async () => {
    try { await api.delete(path); await refresh(); } catch (err) { setError(errMessage(err)); }
  };
  const move = (i, dir) => {
    const next = [...bullets];
    const t = i + dir;
    if (t < 0 || t >= next.length) return;
    [next[i], next[t]] = [next[t], next[i]];
    setList(next);
  };

  return (
    <SettingsPage>
      {error && <div role="alert" className="rounded-md bg-red-50 p-4 text-red-700">{error}</div>}
      <SettingsPanel title="Look" description="Saved as soon as you upload.">
        <SettingsRow label="Logo" help="Shown in the top bar and on the login page. PNG or SVG, up to 5 MB.">
          <ImagePicker label="Logo" url={settings.logoUrl} onUpload={upload('/settings/logo')} onRemove={remove('/settings/logo')} />
        </SettingsRow>
        <SettingsRow label="Favicon" help="The icon in the browser tab.">
          <ImagePicker label="Favicon" url={settings.faviconUrl} onUpload={upload('/settings/favicon')} onRemove={remove('/settings/favicon')} />
        </SettingsRow>
      </SettingsPanel>

      <form onSubmit={save} className="space-y-5">
        <fieldset disabled={!canSave} className="space-y-5">
          <SettingsPanel title="Details">
            <SettingsRow label="Organization name" htmlFor="company-name" help="Shown in email footers and reports.">
              <input id="company-name" className="input" value={form['company.name']} onChange={set('company.name')} required />
            </SettingsRow>
            <SettingsRow label="Support email" htmlFor="support-email">
              <input id="support-email" type="email" className="input" value={form['company.supportEmail']} onChange={set('company.supportEmail')} />
            </SettingsRow>
            <SettingsRow label="App name" htmlFor="app-name" help="Shown in the top bar, the login page and the browser tab.">
              <input id="app-name" className="input" value={form['branding.appName']} onChange={set('branding.appName')} />
            </SettingsRow>
          </SettingsPanel>

          <SettingsPanel title="Regional">
            <SettingsRow label="Time zone" htmlFor="tz" help="Used for dates, reports and the time ledger.">
              <select id="tz" className="input" value={form['company.timezone']} onChange={set('company.timezone')}>
                {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
              </select>
            </SettingsRow>
            <SettingsRow label="Date format" htmlFor="date-format">
              <select id="date-format" className="input" value={form['company.dateFormat']} onChange={set('company.dateFormat')}>
                {DATE_FORMATS.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </SettingsRow>
            <SettingsRow label="Time format" htmlFor="time-format">
              <select id="time-format" className="input" value={form['company.timeFormat']} onChange={set('company.timeFormat')}>
                {TIME_FORMATS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </SettingsRow>
            <SettingsRow label="Language" htmlFor="language">
              <select id="language" className="input" value={form['company.language']} onChange={set('company.language')}>
                {LANGUAGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </SettingsRow>
          </SettingsPanel>

          <SettingsPanel title="Login page">
            <SettingsRow label="Login page tagline" htmlFor="tagline">
              <input id="tagline" className="input" value={form['branding.tagline']} onChange={set('branding.tagline')} />
            </SettingsRow>
            <SettingsRow label="Bullet points" help="Shown beside the sign-in form.">
              <ul className="mb-2 space-y-1.5">
                {bullets.map((b, i) => (
                  <li key={`${b}-${i}`} className="flex items-center gap-2 rounded border border-navy-200 px-2 py-1.5">
                    <span className="min-w-0 flex-1 text-sm text-navy-800">{b}</span>
                    <button type="button" aria-label={`Move "${b}" up`} onClick={() => move(i, -1)} disabled={i === 0} className="text-navy-400 disabled:opacity-30">↑</button>
                    <button type="button" aria-label={`Move "${b}" down`} onClick={() => move(i, 1)} disabled={i === bullets.length - 1} className="text-navy-400 disabled:opacity-30">↓</button>
                    <button type="button" aria-label={`Remove "${b}"`} onClick={() => setList(bullets.filter((_, j) => j !== i))} className="text-red-500">✕</button>
                  </li>
                ))}
              </ul>
              <div className="flex gap-2">
                <input className="input" aria-label="New bullet point" value={newBullet} placeholder="Add a bullet point…"
                  onChange={(e) => setNewBullet(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (newBullet.trim()) { setList([...bullets, newBullet.trim()]); setNewBullet(''); } } }} />
                <button type="button" className="btn-secondary" onClick={() => { if (newBullet.trim()) { setList([...bullets, newBullet.trim()]); setNewBullet(''); } }}>Add</button>
              </div>
            </SettingsRow>
          </SettingsPanel>
        </fieldset>
        <SaveBar dirty={dirty} saving={saving} saved={saved}
          note={canSave ? null : 'Changing these needs the System settings permission. You can still change the logo and favicon.'} />
      </form>
    </SettingsPage>
  );
}
