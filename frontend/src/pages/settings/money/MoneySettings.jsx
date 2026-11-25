// Settings → Money → Money settings (Phase 3): the Customer billing switch
// (Owners), currency, default markup, payment terms, and the Microsoft 365
// licenses that make someone a Light user.
import { useEffect, useState } from 'react';
import api, { errMessage } from '../../../api/api';
import { useAuth } from '../../../context/AuthContext';
import Spinner from '../../../components/Spinner';
import Switch from '../../../components/Switch';
import Notice from '../../../components/ui/Notice';
import SettingsPage, { SettingsPanel } from '../../../components/settings/SettingsPage';

export default function MoneySettings() {
  const { isOwner } = useAuth();
  const [s, setS] = useState(null);
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  useEffect(() => {
    api.get('/money/settings').then(({ data }) => {
      setS(data.settings);
      setForm({
        currency: data.settings.currency,
        defaultMarkupPercent: String(Number(data.settings.defaultMarkupPercent)),
        defaultTermsDays: String(data.settings.defaultTermsDays),
        form1099Threshold: String(Number(data.settings.form1099Threshold)),
        frontlineSkuIds: data.settings.frontlineSkuIds.join('\n'),
      });
    }).catch((err) => setError(errMessage(err)));
  }, []);
  const save = async (body, what) => {
    setError(''); setSaved('');
    try {
      const { data } = await api.put('/money/settings', body);
      setS(data.settings);
      setSaved(`${what} saved.`);
    } catch (err) { setError(errMessage(err)); }
  };
  if (!s) return error ? <Notice tone="bad">{error}</Notice> : <Spinner />;
  return (
    <SettingsPage>
      {error && <Notice tone="bad">{error}</Notice>}
      {saved && <Notice tone="info">{saved}</Notice>}
      <SettingsPanel title="Customer billing" description="Invoices, agreements, payments, quotes and the website form. Off for a team that bills elsewhere; bills, purchasing, expenses and timesheets work either way.">
        <div className="flex items-center justify-between gap-3 px-5 py-4">
          <span className="text-sm">{s.customerBilling ? 'On' : 'Off'}{!isOwner && ' · only an Owner can change this'}</span>
          <Switch checked={s.customerBilling} disabled={!isOwner} label="Customer billing" onChange={(v) => save({ customerBilling: v }, 'Customer billing')} />
        </div>
      </SettingsPanel>
      <SettingsPanel title="Money">
        <form
          className="grid grid-cols-1 gap-4 px-5 py-4 sm:grid-cols-3"
          onSubmit={(e) => { e.preventDefault(); save({ currency: form.currency, defaultMarkupPercent: form.defaultMarkupPercent, defaultTermsDays: Number(form.defaultTermsDays), form1099Threshold: form.form1099Threshold }, 'Money settings'); }}
        >
          <label className="text-sm">Currency
            <input className="input mt-1" maxLength={3} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} />
          </label>
          <label className="text-sm">Default markup on products (%)
            <input className="input mt-1" inputMode="decimal" value={form.defaultMarkupPercent} onChange={(e) => setForm({ ...form, defaultMarkupPercent: e.target.value })} />
          </label>
          <label className="text-sm">Payment terms (days)
            <input className="input mt-1" inputMode="numeric" value={form.defaultTermsDays} onChange={(e) => setForm({ ...form, defaultTermsDays: e.target.value })} />
          </label>
          <label className="text-sm">1099 threshold ($)
            <input className="input mt-1" inputMode="decimal" value={form.form1099Threshold} onChange={(e) => setForm({ ...form, form1099Threshold: e.target.value })} />
            <span className="mt-1 block text-xs text-ink-500">Contractors paid this much or more in a year show on the 1099 report. $2,000 from 2026; check with your CPA.</span>
          </label>
          <div className="sm:col-span-3"><button type="submit" className="btn-primary">Save</button></div>
        </form>
      </SettingsPanel>
      <SettingsPanel title="Frontline licenses" description="Microsoft 365 license (SKU) IDs that make someone a Light user unless their tier is set by hand. One per line.">
        <form className="space-y-3 px-5 py-4" onSubmit={(e) => { e.preventDefault(); save({ frontlineSkuIds: form.frontlineSkuIds }, 'Frontline licenses'); }}>
          <textarea className="input min-h-[96px] font-mono text-xs" aria-label="Frontline license IDs" value={form.frontlineSkuIds} onChange={(e) => setForm({ ...form, frontlineSkuIds: e.target.value })} />
          <button type="submit" className="btn-primary">Save</button>
        </form>
      </SettingsPanel>
    </SettingsPage>
  );
}
