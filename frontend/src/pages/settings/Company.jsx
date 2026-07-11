import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { errMessage } from '../../api/api';
import { useSettings } from '../../context/SettingsContext';
import Spinner from '../../components/Spinner';

const TIMEZONES = ['UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Europe/London', 'Europe/Berlin', 'Asia/Kolkata', 'Asia/Tokyo', 'Australia/Sydney'];
const DATE_FORMATS = ['YYYY-MM-DD', 'MM/DD/YYYY', 'DD/MM/YYYY', 'DD MMM YYYY'];
const TIME_FORMATS = [['12h', '12-hour (2:30 PM)'], ['24h', '24-hour (14:30)']];
const LANGUAGES = [['en', 'English'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German']];

export default function Company() {
  const { settings, refresh } = useSettings();
  const [form, setForm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(false);
  const fileRef = useRef();

  useEffect(() => {
    api.get('/settings')
      .then(({ data }) => {
        const s = data.settings;
        setForm({
          'company.name': s['company.name'] || '',
          'company.supportEmail': s['company.supportEmail'] || '',
          'company.timezone': s['company.timezone'] || 'UTC',
          'company.dateFormat': s['company.dateFormat'] || 'YYYY-MM-DD',
          'company.timeFormat': s['company.timeFormat'] || '12h',
          'company.language': s['company.language'] || 'en',
        });
      })
      .catch((err) => setError(errMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api.put('/settings', { settings: form });
      await refresh();
      setSavedAt(true);
      setTimeout(() => setSavedAt(false), 2500);
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setSaving(false);
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
      if (fileRef.current) fileRef.current.value = '';
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

  if (loading || !form) return <Spinner />;

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <Link to="/settings" className="text-sm text-prism hover:underline">← Back to Settings</Link>
      <h1 className="text-2xl font-bold text-navy-900">Company</h1>
      {error && <div className="rounded-md bg-red-50 p-4 text-red-700">{error}</div>}

      {/* Logo */}
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
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={uploadLogo} />
            </label>
            {settings.logoUrl && <button onClick={removeLogo} className="btn-secondary">Remove</button>}
          </div>
        </div>
        <p className="mt-2 text-xs text-navy-400">Shown in the sidebar and on the login page. PNG/SVG, up to 5MB.</p>
      </div>

      <form onSubmit={save} className="card space-y-4 p-5">
        <div>
          <label className="label">Organization name</label>
          <input className="input" value={form['company.name']} onChange={set('company.name')} required />
        </div>
        <div>
          <label className="label">Support email</label>
          <input type="email" className="input" value={form['company.supportEmail']} onChange={set('company.supportEmail')} />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="label">Timezone</label>
            <select className="input" value={form['company.timezone']} onChange={set('company.timezone')}>
              {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Date format</label>
            <select className="input" value={form['company.dateFormat']} onChange={set('company.dateFormat')}>
              {DATE_FORMATS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Time format</label>
            <select className="input" value={form['company.timeFormat']} onChange={set('company.timeFormat')}>
              {TIME_FORMATS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Default language</label>
            <select className="input" value={form['company.language']} onChange={set('company.language')}>
              {LANGUAGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
        </div>
        <div className="flex items-center justify-end gap-3">
          {savedAt && <span className="text-sm text-green-600">Saved</span>}
          <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </div>
  );
}
