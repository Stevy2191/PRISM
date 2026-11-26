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
      {s.customerBilling && <InvoiceSettings s={s} save={save} />}
      {s.customerBilling && <StripeSettings s={s} isOwner={isOwner} onSaved={(next) => { setS(next); setSaved('Stripe keys saved.'); }} onError={setError} />}
      <SettingsPanel title="Frontline licenses" description="Microsoft 365 license (SKU) IDs that make someone a Light user unless their tier is set by hand. One per line.">
        <form className="space-y-3 px-5 py-4" onSubmit={(e) => { e.preventDefault(); save({ frontlineSkuIds: form.frontlineSkuIds }, 'Frontline licenses'); }}>
          <textarea className="input min-h-[96px] font-mono text-xs" aria-label="Frontline license IDs" value={form.frontlineSkuIds} onChange={(e) => setForm({ ...form, frontlineSkuIds: e.target.value })} />
          <button type="submit" className="btn-primary">Save</button>
        </form>
      </SettingsPanel>
    </SettingsPage>
  );
}

// Invoices (Phase 3, step 3): numbering, auto-send, reminders, late fee and
// the optional online-payment fee.
function InvoiceSettings({ s, save }) {
  const [f, setF] = useState(() => ({
    invoicePrefix: s.invoicePrefix,
    invoiceNextNumber: String(s.invoiceNextNumber),
    autoSend: s.autoSend,
    reminderDaysBefore: String(s.reminderDaysBefore),
    reminderDaysLate: s.reminderDaysLate.join(', '),
    lateFeeType: s.lateFeeType,
    lateFeeAmount: String(Number(s.lateFeeAmount)),
    lateFeeAfterDays: String(s.lateFeeAfterDays),
    cardFeePercent: String(Number(s.cardFeePercent)),
  }));
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = (e) => {
    e.preventDefault();
    const body = {
      invoicePrefix: f.invoicePrefix,
      autoSend: f.autoSend,
      reminderDaysBefore: Number(f.reminderDaysBefore),
      reminderDaysLate: f.reminderDaysLate.split(/[\s,]+/).filter(Boolean).map(Number),
      lateFeeType: f.lateFeeType,
      lateFeeAmount: f.lateFeeAmount,
      lateFeeAfterDays: Number(f.lateFeeAfterDays),
      cardFeePercent: f.cardFeePercent,
    };
    if (Number(f.invoiceNextNumber) !== s.invoiceNextNumber) body.invoiceNextNumber = Number(f.invoiceNextNumber);
    save(body, 'Invoice settings');
  };
  return (
    <SettingsPanel title="Invoices" description="Numbers are given when an invoice is sent, so there are no gaps. The next number can only go up.">
      <form className="grid grid-cols-1 gap-4 px-5 py-4 sm:grid-cols-3" onSubmit={submit} aria-label="Invoice settings">
        <label className="text-sm">Number prefix<input className="input mt-1" maxLength={10} value={f.invoicePrefix} onChange={set('invoicePrefix')} /></label>
        <label className="text-sm">Next number<input className="input mt-1" inputMode="numeric" value={f.invoiceNextNumber} onChange={set('invoiceNextNumber')} /></label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.autoSend} onChange={(e) => setF({ ...f, autoSend: e.target.checked })} />Send the 1st's invoices without review</label>
        <label className="text-sm">Remind days before due (0: none)<input className="input mt-1" inputMode="numeric" value={f.reminderDaysBefore} onChange={set('reminderDaysBefore')} /></label>
        <label className="text-sm">Remind days late<input className="input mt-1" value={f.reminderDaysLate} onChange={set('reminderDaysLate')} /></label>
        <span />
        <label className="text-sm">Late fee<select className="input mt-1" value={f.lateFeeType} onChange={set('lateFeeType')}><option value="none">None</option><option value="flat">A flat amount</option><option value="percent">A percent of what's owed</option></select></label>
        {f.lateFeeType !== 'none' && <label className="text-sm">{f.lateFeeType === 'flat' ? 'Late fee ($)' : 'Late fee (%)'}<input className="input mt-1" inputMode="decimal" value={f.lateFeeAmount} onChange={set('lateFeeAmount')} /></label>}
        {f.lateFeeType !== 'none' && <label className="text-sm">Days after the due date<input className="input mt-1" inputMode="numeric" value={f.lateFeeAfterDays} onChange={set('lateFeeAfterDays')} /></label>}
        <label className="text-sm">Online payment fee (%)<input className="input mt-1" inputMode="decimal" value={f.cardFeePercent} onChange={set('cardFeePercent')} />
          <span className="mt-1 block text-xs text-ink-500">0 absorbs Stripe's fees. Check your state's rules on surcharges first.</span>
        </label>
        <div className="sm:col-span-3"><button type="submit" className="btn-primary">Save</button></div>
      </form>
    </SettingsPanel>
  );
}

// Stripe (Phase 3, step 3): Owners set the keys; nobody can read them back.
function StripeSettings({ s, isOwner, onSaved, onError }) {
  const [f, setF] = useState({ secretKey: '', webhookSecret: '' });
  const hook = `${window.location.origin}/api/v1/money/stripe/webhook`;
  const submit = async (e) => {
    e.preventDefault();
    onError('');
    const body = {};
    if (f.secretKey) body.secretKey = f.secretKey;
    if (f.webhookSecret) body.webhookSecret = f.webhookSecret;
    try {
      const { data } = await api.put('/money/settings/stripe', body);
      setF({ secretKey: '', webhookSecret: '' });
      onSaved(data.settings);
    } catch (err) { onError(errMessage(err)); }
  };
  return (
    <SettingsPanel title="Online payments (Stripe)" description="Customers pay on Stripe's page; card and bank details never reach PRISM.">
      <div className="space-y-3 px-5 py-4 text-sm">
        <p>Secret key: {s.stripeConfigured ? 'set' : 'not set'} · Webhook signing secret: {s.stripeWebhookConfigured ? 'set' : 'not set'}</p>
        <p>In Stripe, add a webhook to <code className="font-mono text-xs">{hook}</code> for checkout.session.completed, checkout.session.async_payment_succeeded, checkout.session.async_payment_failed and charge.refunded.</p>
        {isOwner ? (
          <form className="grid grid-cols-1 gap-3 sm:grid-cols-2" onSubmit={submit} aria-label="Stripe keys">
            <label>Secret key<input className="input mt-1 font-mono" type="password" autoComplete="off" placeholder="sk_live_…" value={f.secretKey} onChange={(e) => setF({ ...f, secretKey: e.target.value })} /></label>
            <label>Webhook signing secret<input className="input mt-1 font-mono" type="password" autoComplete="off" placeholder="whsec_…" value={f.webhookSecret} onChange={(e) => setF({ ...f, webhookSecret: e.target.value })} /></label>
            <div className="sm:col-span-2"><button type="submit" className="btn-primary">Save keys</button></div>
          </form>
        ) : <p className="text-xs text-ink-500">Only an Owner can set the keys.</p>}
      </div>
    </SettingsPanel>
  );
}
