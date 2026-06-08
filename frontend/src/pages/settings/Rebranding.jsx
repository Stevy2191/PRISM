import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { errMessage } from '../../api/api';
import { useSettings, applyBranding } from '../../context/SettingsContext';
import Spinner from '../../components/Spinner';

const FIELDS = [
  ['branding.primaryColor', 'Primary color'],
  ['branding.accentColor', 'Accent color'],
  ['branding.loginBgColor', 'Login background'],
];

export default function Rebranding() {
  const { settings, refresh } = useSettings();
  const [form, setForm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);

  useEffect(() => {
    api.get('/settings')
      .then(({ data }) => {
        const s = data.settings;
        setForm({
          'branding.primaryColor': s['branding.primaryColor'] || '#3a5da6',
          'branding.accentColor': s['branding.accentColor'] || '#38bdf8',
          'branding.loginBgColor': s['branding.loginBgColor'] || '#0f1b34',
          'branding.welcomeMessage': s['branding.welcomeMessage'] || '',
        });
      })
      .catch((err) => setError(errMessage(err)))
      .finally(() => setLoading(false));
    // On unmount, restore the saved branding (in case preview was active).
    return () => applyBranding(settings.branding);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const brandingFromForm = (f) => ({
    primaryColor: f['branding.primaryColor'],
    accentColor: f['branding.accentColor'],
    loginBgColor: f['branding.loginBgColor'],
    welcomeMessage: f['branding.welcomeMessage'],
  });

  const set = (k) => (e) => {
    const next = { ...form, [k]: e.target.value };
    setForm(next);
    if (previewing) applyBranding(brandingFromForm(next));
  };

  const togglePreview = () => {
    if (previewing) {
      applyBranding(settings.branding);
      setPreviewing(false);
    } else {
      applyBranding(brandingFromForm(form));
      setPreviewing(true);
    }
  };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api.put('/settings', { settings: form });
      await refresh();
      setPreviewing(false);
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setSaving(false);
    }
  };

  if (loading || !form) return <Spinner />;

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <Link to="/settings" className="text-sm text-prism hover:underline">← Back to Settings</Link>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-navy-900">Rebranding</h1>
        <button onClick={togglePreview} className={previewing ? 'btn-primary' : 'btn-secondary'}>
          {previewing ? 'Previewing — click to stop' : 'Preview'}
        </button>
      </div>
      {error && <div className="rounded-md bg-red-50 p-4 text-red-700">{error}</div>}

      <form onSubmit={save} className="card space-y-4 p-5">
        {FIELDS.map(([key, label]) => (
          <div key={key}>
            <label className="label">{label}</label>
            <div className="flex items-center gap-3">
              <input type="color" className="h-10 w-14 rounded border border-navy-200" value={form[key]} onChange={set(key)} />
              <input className="input font-mono" value={form[key]} onChange={set(key)} />
            </div>
          </div>
        ))}
        <div>
          <label className="label">Login welcome message</label>
          <input className="input" value={form['branding.welcomeMessage']} onChange={set('branding.welcomeMessage')} />
        </div>

        {/* Mini preview */}
        <div className="rounded-md border border-navy-100 p-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-navy-400">Preview</p>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className="btn-primary">Primary button</button>
            <span className="badge bg-prism/10 text-prism">accent badge</span>
            <div className="rounded px-4 py-2 text-sm text-white" style={{ backgroundColor: form['branding.loginBgColor'] }}>
              login background
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-3">
          <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save branding'}</button>
        </div>
      </form>
    </div>
  );
}
