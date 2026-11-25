// Settings → Money → Sales tax (Phase 3): rates (one default) and tax
// categories with the share of a charge that is taxable.
import { useEffect, useState } from 'react';
import api, { errMessage } from '../../../api/api';
import Spinner from '../../../components/Spinner';
import Notice from '../../../components/ui/Notice';
import SettingsPage, { SettingsPanel } from '../../../components/settings/SettingsPage';

const pct = (v) => String(Number(v));

export default function TaxSettings() {
  const [rates, setRates] = useState(null);
  const [cats, setCats] = useState([]);
  const [error, setError] = useState('');
  const [newRate, setNewRate] = useState({ name: '', ratePercent: '' });
  const [newCat, setNewCat] = useState({ name: '', taxablePercent: '' });
  const load = () => Promise.all([api.get('/money/tax-rates'), api.get('/money/tax-categories')])
    .then(([r, c]) => { setRates(r.data.taxRates); setCats(c.data.taxCategories); })
    .catch((err) => setError(errMessage(err)));
  useEffect(() => { load(); }, []);
  const run = async (fn) => {
    setError('');
    try { await fn(); await load(); return true; } catch (err) { setError(errMessage(err)); return false; }
  };
  if (!rates) return error ? <Notice tone="bad">{error}</Notice> : <Spinner />;
  return (
    <SettingsPage width="wide">
      {error && <Notice tone="bad">{error}</Notice>}
      <Notice tone="info">The taxable shares start from common Texas treatment (many IT services taxed on 80 %). Confirm each with your CPA or the Comptroller before charging tax.</Notice>
      <SettingsPanel title="Tax rates" description="The combined rate for where you are (state plus local). The default applies unless a customer has its own.">
        {rates.map((r) => (
          <div key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
            <span className="min-w-[12rem] font-medium">{r.name}</span>
            <span>{pct(r.ratePercent)} %</span>
            {r.isDefault ? <span className="eyebrow">default</span> : (
              <button type="button" className="text-xs hover:underline" style={{ color: 'var(--color-accent)' }} onClick={() => run(() => api.patch(`/money/tax-rates/${r.id}`, { isDefault: true }))}>make default</button>
            )}
          </div>
        ))}
        <form className="flex flex-wrap items-center gap-2 px-5 py-3" onSubmit={async (e) => { e.preventDefault(); if (await run(() => api.post('/money/tax-rates', { ...newRate, isDefault: !rates.length }))) setNewRate({ name: '', ratePercent: '' }); }}>
          <input className="input w-auto" placeholder="Name" aria-label="New tax rate name" required value={newRate.name} onChange={(e) => setNewRate({ ...newRate, name: e.target.value })} />
          <input className="input w-28" placeholder="8.25" aria-label="New tax rate percent" required inputMode="decimal" value={newRate.ratePercent} onChange={(e) => setNewRate({ ...newRate, ratePercent: e.target.value })} />
          <button type="submit" className="btn-primary">Add rate</button>
        </form>
      </SettingsPanel>
      <SettingsPanel title="Tax categories" description="Every product and service has one. The share is how much of a charge is taxed: 100, 80 or 0 %.">
        {cats.map((c) => (
          <div key={c.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
            <span className="min-w-[12rem] font-medium">{c.name}</span>
            <label className="flex items-center gap-1">
              <input
                className="input w-24"
                aria-label={`${c.name} taxable share`}
                defaultValue={pct(c.taxablePercent)}
                onBlur={(e) => { if (e.target.value !== pct(c.taxablePercent)) run(() => api.patch(`/money/tax-categories/${c.id}`, { taxablePercent: e.target.value })); }}
              /> % taxable
            </label>
          </div>
        ))}
        <form className="flex flex-wrap items-center gap-2 px-5 py-3" onSubmit={async (e) => { e.preventDefault(); if (await run(() => api.post('/money/tax-categories', newCat))) setNewCat({ name: '', taxablePercent: '' }); }}>
          <input className="input w-auto" placeholder="Name" aria-label="New tax category name" required value={newCat.name} onChange={(e) => setNewCat({ ...newCat, name: e.target.value })} />
          <input className="input w-24" placeholder="100" aria-label="New tax category share" required inputMode="decimal" value={newCat.taxablePercent} onChange={(e) => setNewCat({ ...newCat, taxablePercent: e.target.value })} />
          <button type="submit" className="btn-primary">Add category</button>
        </form>
      </SettingsPanel>
    </SettingsPage>
  );
}
