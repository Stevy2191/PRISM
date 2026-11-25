// A company's Setup › Billing (Phase 3): tax (on/off, exemption with its
// certificate), payment terms, invoicing timing, its own rates, and how many
// of its people are in each support tier.
import { useEffect, useState } from 'react';
import api, { errMessage } from '../../api/api';
import { usePermission } from '../../context/AuthContext';
import Notice from '../ui/Notice';
import Spinner from '../Spinner';

const RATE_FIELDS = [['hourlyRate', 'Hourly rate'], ['afterHoursRate', 'After-hours rate'], ['tripCharge', 'Trip charge']];

export default function CompanyBilling({ company }) {
  const canEdit = usePermission('money.billing.manage');
  const [b, setB] = useState(null);
  const [rates, setRates] = useState([]);
  const [tiers, setTiers] = useState(null);
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const base = `/companies/${company.id}/billing`;
  const fill = (billing) => {
    setB(billing);
    setForm({
      termsDays: billing.overrides.termsDays ? String(billing.termsDays) : '',
      hourlyRate: billing.overrides.hourlyRate ? billing.hourlyRate : '',
      afterHoursRate: billing.overrides.afterHoursRate ? billing.afterHoursRate : '',
      tripCharge: billing.overrides.tripCharge ? billing.tripCharge : '',
      exemptExpiresOn: billing.exemptExpiresOn || '',
    });
  };
  useEffect(() => {
    api.get(base).then(({ data }) => fill(data.billing)).catch((err) => setError(errMessage(err)));
    api.get('/money/tax-rates').then(({ data }) => setRates(data.taxRates)).catch(() => {});
    api.get(`/companies/${company.id}/billing/tiers`).then(({ data }) => setTiers(data.tiers)).catch(() => {});
  }, [base, company.id]);
  const save = async (body, what) => {
    setError(''); setSaved('');
    try {
      const { data } = await api.put(base, body);
      fill(data.billing);
      setSaved(`${what} saved.`);
    } catch (err) { setError(errMessage(err)); }
  };
  const upload = async (file) => {
    setError(''); setSaved('');
    const fd = new FormData();
    fd.append('file', file);
    try {
      const { data } = await api.post(`${base}/certificate`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      fill(data.billing);
      setSaved('Certificate saved.');
    } catch (err) { setError(errMessage(err)); }
  };
  if (!b) return error ? <Notice tone="bad">{error}</Notice> : <Spinner />;
  const orNull = (v) => (v === '' ? null : v);
  return (
    <div className="space-y-5" data-testid="company-billing">
      {error && <Notice tone="bad">{error}</Notice>}
      {saved && <Notice tone="info">{saved}</Notice>}

      <section className="card space-y-3 p-5">
        <h2 className="text-[15px] font-semibold text-navy-900">Sales tax</h2>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" disabled={!canEdit} checked={b.chargeTax} onChange={(e) => save({ chargeTax: e.target.checked }, 'Tax')} /> Charge sales tax
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" disabled={!canEdit} checked={b.taxExempt} onChange={(e) => save({ taxExempt: e.target.checked }, 'Exemption')} /> Tax exempt (with a certificate)
        </label>
        {b.taxExempt && (
          <div className="flex flex-wrap items-end gap-3 text-sm">
            <label>Certificate expires
              <input type="date" className="input mt-1 w-auto" disabled={!canEdit} value={form.exemptExpiresOn}
                onChange={(e) => setForm({ ...form, exemptExpiresOn: e.target.value })}
                onBlur={() => save({ exemptExpiresOn: orNull(form.exemptExpiresOn) }, 'Expiry')} />
            </label>
            {b.exemptCertificateName
              ? <a className="hover:underline" style={{ color: 'var(--color-accent)' }} href={`/api/v1${base}/certificate`}>{b.exemptCertificateName}</a>
              : <span style={{ color: 'var(--color-text-muted)' }}>No certificate on file</span>}
            {canEdit && (
              <label className="btn-secondary cursor-pointer">
                {b.exemptCertificateName ? 'Replace certificate' : 'Upload certificate'}
                <input type="file" className="sr-only" accept=".pdf,.png,.jpg,.jpeg" aria-label="Exemption certificate" onChange={(e) => e.target.files[0] && upload(e.target.files[0])} />
              </label>
            )}
          </div>
        )}
        <label className="block text-sm">Tax rate
          <select className="input mt-1 w-auto" disabled={!canEdit} value={b.overrides.taxRate ? b.taxRateId : ''} onChange={(e) => save({ taxRateId: e.target.value ? Number(e.target.value) : null }, 'Tax rate')}>
            <option value="">{`The default${b.overrides.taxRate ? '' : ` (${b.taxRateName || 'none set'})`}`}</option>
            {rates.map((r) => <option key={r.id} value={r.id}>{`${r.name} (${Number(r.ratePercent)} %)`}</option>)}
          </select>
        </label>
      </section>

      <section className="card space-y-3 p-5">
        <h2 className="text-[15px] font-semibold text-navy-900">Invoicing</h2>
        <label className="block text-sm">When their work is invoiced
          <select className="input mt-1 w-auto" disabled={!canEdit} value={b.invoiceTiming} onChange={(e) => save({ invoiceTiming: e.target.value }, 'Invoicing')}>
            <option value="monthly">Monthly, with everything else</option>
            <option value="on_close">Each job, when its ticket closes</option>
          </select>
        </label>
        <form className="grid grid-cols-1 gap-3 sm:grid-cols-4" onSubmit={(e) => {
          e.preventDefault();
          save({
            termsDays: form.termsDays === '' ? null : Number(form.termsDays),
            ...Object.fromEntries(RATE_FIELDS.map(([k]) => [k, orNull(form[k])])),
          }, 'Terms and rates');
        }}>
          <label className="text-sm">{`Payment terms, days (default ${b.overrides.termsDays ? '' : b.termsDays})`}
            <input className="input mt-1" inputMode="numeric" disabled={!canEdit} placeholder={String(b.termsDays)} value={form.termsDays} onChange={(e) => setForm({ ...form, termsDays: e.target.value })} />
          </label>
          {RATE_FIELDS.map(([k, label]) => (
            <label key={k} className="text-sm">{`${label} ($)`}
              <input className="input mt-1" inputMode="decimal" disabled={!canEdit} placeholder={`Default ${b[k]}`} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
            </label>
          ))}
          {canEdit && <div className="sm:col-span-4"><button type="submit" className="btn-primary">Save terms and rates</button></div>}
        </form>
        <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Leave a field empty to use the default from Settings › Money.</p>
      </section>

      {tiers && (
        <section className="card p-5">
          <h2 className="text-[15px] font-semibold text-navy-900">People by support tier</h2>
          <p className="mt-1 text-sm">{`${tiers.full} full · ${tiers.light} light · ${tiers.none} not covered`}</p>
          <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>From each person&apos;s tier, else a Microsoft 365 frontline license (Light), else their department.</p>
        </section>
      )}
    </div>
  );
}
