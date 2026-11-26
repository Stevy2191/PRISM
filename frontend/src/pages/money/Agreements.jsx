// Agreements (Phase 3, step 3): what each recurring customer pays every
// month, billed in advance on the 1st. Lines are per user (Full or Light),
// per device type, per license (counted from Microsoft 365 or typed), flat,
// or a prepaid block of hours. The preview shows this month's counts.
import { useEffect, useState } from 'react';
import api, { errMessage } from '../../api/api';
import { usePermission } from '../../context/AuthContext';
import Notice from '../../components/ui/Notice';
import Spinner from '../../components/Spinner';
import StatusChip from '../../components/ui/StatusChip';
import CustomerPicker from './CustomerPicker';
import { qty, today, usd } from './fmt';

const KINDS = [['per_user', 'Per user'], ['per_device', 'Per device'], ['license', 'License'], ['flat', 'Flat fee'], ['prepaid_hours', 'Prepaid hours']];
const SOURCE = { tiers: 'support tiers', assets: 'assets', m365: 'Microsoft 365', manual: 'typed count', fixed: '' };
const blankLine = () => ({ kind: 'per_user', tier: 'full', description: 'Full user', unitPrice: '' });

function LineFields({ line, onChange, onRemove, categories, n }) {
  const set = (k, v) => onChange({ ...line, [k]: v });
  return (
    <fieldset className="flex flex-wrap items-end gap-2 border-t border-navy-100 pt-2" aria-label={`Line ${n}`}>
      <label className="text-xs">Kind<select className="input mt-1 h-8" aria-label="Kind" value={line.kind} onChange={(e) => set('kind', e.target.value)}>{KINDS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></label>
      <label className="flex-1 text-xs">Description<input className="input mt-1 h-8" required maxLength={500} aria-label="Description" value={line.description} onChange={(e) => set('description', e.target.value)} /></label>
      <label className="text-xs">Price<input className="input mt-1 h-8 w-24" inputMode="decimal" required aria-label="Price" value={line.unitPrice} onChange={(e) => set('unitPrice', e.target.value)} /></label>
      {line.kind === 'per_user' && (
        <label className="text-xs">Users<select className="input mt-1 h-8" aria-label="Users" value={line.tier || 'full'} onChange={(e) => set('tier', e.target.value)}><option value="full">Full</option><option value="light">Light</option></select></label>
      )}
      {line.kind === 'per_device' && (
        <label className="text-xs">Device type<select className="input mt-1 h-8" aria-label="Device type" required value={line.assetCategoryId || ''} onChange={(e) => set('assetCategoryId', Number(e.target.value) || null)}><option value="">Choose…</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      )}
      {line.kind === 'license' && (
        <>
          <label className="text-xs">Count<select className="input mt-1 h-8" aria-label="Count from" value={line.countSource || 'manual'} onChange={(e) => set('countSource', e.target.value)}><option value="manual">Typed</option><option value="m365">From Microsoft 365</option></select></label>
          {line.countSource === 'm365' && <label className="text-xs">License (SKU) ID<input className="input mt-1 h-8 w-72 font-mono" maxLength={64} aria-label="License SKU" value={line.skuId || ''} onChange={(e) => set('skuId', e.target.value)} /></label>}
          <label className="text-xs">{line.countSource === 'm365' ? 'If Microsoft 365 can\'t be read' : 'How many'}<input className="input mt-1 h-8 w-20" inputMode="decimal" aria-label="License count" value={line.manualCount || ''} onChange={(e) => set('manualCount', e.target.value)} /></label>
        </>
      )}
      {line.kind === 'prepaid_hours' && (
        <>
          <label className="text-xs">Hours<input className="input mt-1 h-8 w-20" inputMode="decimal" aria-label="Hours" required value={line.hours || ''} onChange={(e) => set('hours', e.target.value)} /></label>
          <label className="text-xs">Overage rate<input className="input mt-1 h-8 w-24" inputMode="decimal" aria-label="Overage rate" value={line.overageRate || ''} onChange={(e) => set('overageRate', e.target.value)} /></label>
          <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={!!line.rollover} onChange={(e) => set('rollover', e.target.checked)} />Unused hours roll over</label>
        </>
      )}
      <button type="button" className="text-xs" style={{ color: 'var(--color-danger)' }} onClick={onRemove}>Remove</button>
    </fieldset>
  );
}

function AgreementForm({ agreement, companyId: fixedCompany, onClose, onSaved }) {
  const [categories, setCategories] = useState([]);
  const [form, setForm] = useState(() => ({
    companyId: agreement ? agreement.companyId : fixedCompany,
    name: agreement ? agreement.name : 'Managed services',
    startsOn: agreement ? agreement.startsOn : today(),
    termsDays: agreement && agreement.termsDays !== null ? String(agreement.termsDays) : '',
    lines: agreement ? agreement.lines : [blankLine()],
  }));
  const [error, setError] = useState('');
  useEffect(() => { api.get('/assets/categories').then(({ data }) => setCategories(data.categories || [])).catch(() => {}); }, []);
  const save = async (e) => {
    e.preventDefault();
    setError('');
    const body = {
      name: form.name, startsOn: form.startsOn, termsDays: form.termsDays === '' ? null : Number(form.termsDays), lines: form.lines,
    };
    try {
      const { data } = agreement
        ? await api.patch(`/money/agreements/${agreement.id}`, body)
        : await api.post('/money/agreements', { ...body, companyId: form.companyId });
      onSaved(data.agreement);
    } catch (err) { setError(errMessage(err)); }
  };
  return (
    <form className="card space-y-3 p-4" aria-label="Agreement" onSubmit={save}>
      {error && <Notice tone="bad">{error}</Notice>}
      <div className="flex flex-wrap gap-3">
        {!agreement && !fixedCompany && <CustomerPicker value={form.companyId} onChange={(v) => setForm({ ...form, companyId: v })} required />}
        <label className="text-sm">Name<input className="input mt-1" required maxLength={200} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
        <label className="text-sm">Starts<input type="date" className="input mt-1" required value={form.startsOn} onChange={(e) => setForm({ ...form, startsOn: e.target.value })} /></label>
        <label className="text-sm">Terms (days, blank: the customer's)<input className="input mt-1 w-28" inputMode="numeric" value={form.termsDays} onChange={(e) => setForm({ ...form, termsDays: e.target.value })} /></label>
      </div>
      {form.lines.map((l, i) => (
        <LineFields
          key={l.id || `new-${i}`}
          n={i + 1}
          line={l}
          categories={categories}
          onChange={(next) => setForm({ ...form, lines: form.lines.map((x, j) => (j === i ? next : x)) })}
          onRemove={() => setForm({ ...form, lines: form.lines.filter((_, j) => j !== i) })}
        />
      ))}
      <div className="flex gap-2">
        <button type="button" className="text-xs underline" onClick={() => setForm({ ...form, lines: [...form.lines, blankLine()] })}>Add a line</button>
        <span className="flex-1" />
        <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
        <button type="submit" className="btn-primary">Save agreement</button>
      </div>
    </form>
  );
}

function Preview({ agreement }) {
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api.get(`/money/agreements/${agreement.id}/preview`).then(({ data }) => setPreview(data)).catch((err) => setError(errMessage(err)));
  }, [agreement]);
  if (error) return <Notice tone="bad">{error}</Notice>;
  if (!preview) return <Spinner />;
  return (
    <table className="min-w-full text-sm" data-testid="agreement-preview">
      <thead><tr>{['Line', 'This month', 'Price', 'Amount'].map((h) => <th key={h} className="table-th">{h}</th>)}</tr></thead>
      <tbody>
        {preview.lines.map((l) => (
          <tr key={l.id} className="border-t border-navy-100">
            <td className="table-td">{l.description}</td>
            <td className="table-td">{qty(l.quantity)}{SOURCE[l.source] ? <span className="ml-1 text-xs text-navy-500">({SOURCE[l.source]})</span> : null}</td>
            <td className="table-td num">{usd(l.unitPrice)}</td>
            <td className="table-td num">{usd(l.amount)}</td>
          </tr>
        ))}
        <tr className="border-t border-navy-200 font-semibold"><td className="table-td" colSpan={3}>A month</td><td className="table-td num">{usd(preview.total)}</td></tr>
      </tbody>
    </table>
  );
}

export default function Agreements({ companyId = null }) {
  const canManage = usePermission('money.billing.manage');
  const [agreements, setAgreements] = useState(null);
  const [open, setOpen] = useState(null);
  const [editing, setEditing] = useState(null); // 'new' or an agreement
  const [error, setError] = useState('');
  const load = () => api.get('/money/agreements', { params: companyId ? { companyId } : {} })
    .then(({ data }) => setAgreements(data.agreements)).catch((err) => setError(errMessage(err)));
  useEffect(() => { load(); }, [companyId]); // eslint-disable-line react-hooks/exhaustive-deps
  const cancel = async (a) => {
    const day = window.prompt('Last day of the agreement (YYYY-MM-DD)? Its last invoice carries only extras.', today());
    if (!day) return;
    try { await api.post(`/money/agreements/${a.id}/cancel`, { cancelledOn: day }); load(); } catch (err) { setError(errMessage(err)); }
  };
  return (
    <section aria-label="Agreements" className="space-y-4">
      {error && <Notice tone="bad">{error}</Notice>}
      {canManage && !editing && <button type="button" className="btn-primary" onClick={() => setEditing('new')}>New agreement</button>}
      {editing && (
        <AgreementForm
          agreement={editing === 'new' ? null : editing}
          companyId={companyId}
          onClose={() => setEditing(null)}
          onSaved={(a) => { setEditing(null); setOpen(a.id); load(); }}
        />
      )}
      {!agreements ? <Spinner /> : (
        <div className="card overflow-x-auto">
          <table className="min-w-full text-sm" data-testid="agreements">
            <thead><tr>{['Customer', 'Agreement', 'Starts', 'Ends', 'Status'].map((h) => <th key={h} className="table-th">{h}</th>)}</tr></thead>
            <tbody>
              {agreements.map((a) => [
                <tr key={a.id} className="cursor-pointer border-t border-navy-100 hover:bg-navy-50" onClick={() => setOpen(open === a.id ? null : a.id)}>
                  <td className="table-td font-medium">{a.company?.name}</td>
                  <td className="table-td">{a.name}</td>
                  <td className="table-td">{a.startsOn}</td>
                  <td className="table-td">{a.endsOn || '—'}</td>
                  <td className="table-td"><StatusChip tone={a.status === 'active' ? 'good' : 'neutral'}>{a.status}</StatusChip></td>
                </tr>,
                open === a.id && (
                  <tr key={`${a.id}-open`}>
                    <td colSpan={5} className="table-td space-y-3 bg-navy-50">
                      <Preview agreement={a} />
                      {canManage && a.status === 'active' && (
                        <div className="flex gap-3">
                          <button type="button" className="text-xs underline" onClick={() => setEditing(a)}>Change</button>
                          <button type="button" className="text-xs" style={{ color: 'var(--color-danger)' }} onClick={() => cancel(a)}>Cancel agreement</button>
                        </div>
                      )}
                    </td>
                  </tr>
                ),
              ])}
              {!agreements.length && <tr><td className="table-td" colSpan={5}>No agreements yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
