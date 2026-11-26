// Invoices (Phase 3, step 3): drafts from the billing run (or made here),
// sent, partly paid, paid or void. A row opens to its lines and actions.
import { useEffect, useState } from 'react';
import api, { errMessage } from '../../api/api';
import { usePermission } from '../../context/AuthContext';
import Notice from '../../components/ui/Notice';
import Spinner from '../../components/Spinner';
import StatusChip from '../../components/ui/StatusChip';
import CustomerPicker from './CustomerPicker';
import InvoiceDetail from './InvoiceDetail';
import { usd } from './fmt';

const STATUSES = [['', 'All'], ['draft', 'Drafts'], ['open', 'Open'], ['paid', 'Paid'], ['void', 'Void']];
export const INVOICE_TONE = { draft: 'neutral', sent: 'info', partly_paid: 'waiting', paid: 'good', void: 'neutral' };
export const INVOICE_STATUS = { draft: 'Draft', sent: 'Sent', partly_paid: 'Partly paid', paid: 'Paid', void: 'Void' };
const KINDS = [['fee', 'Fee or service'], ['labor', 'Labor'], ['material', 'Product'], ['agreement', 'Managed services']];

function NewInvoice({ onClose, onSaved }) {
  const [companyId, setCompanyId] = useState(null);
  const [lines, setLines] = useState([{ kind: 'fee', description: '', quantity: '1', unitPrice: '' }]);
  const [error, setError] = useState('');
  const set = (i, k, v) => setLines(lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const save = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const { data } = await api.post('/money/invoices', { companyId, lines });
      onSaved(data.invoice);
    } catch (err) { setError(errMessage(err)); }
  };
  return (
    <form className="card space-y-3 p-4" aria-label="New invoice" onSubmit={save}>
      {error && <Notice tone="bad">{error}</Notice>}
      <CustomerPicker value={companyId} onChange={setCompanyId} required />
      {lines.map((l, i) => (
        <fieldset key={i} className="flex flex-wrap items-end gap-2" aria-label={`Line ${i + 1}`}>
          <label className="text-xs">Kind<select className="input mt-1 h-8" aria-label="Kind" value={l.kind} onChange={(e) => set(i, 'kind', e.target.value)}>{KINDS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></label>
          <label className="flex-1 text-xs">Description<input className="input mt-1 h-8" required maxLength={500} value={l.description} onChange={(e) => set(i, 'description', e.target.value)} /></label>
          <label className="text-xs">Qty<input className="input mt-1 h-8 w-20" inputMode="decimal" value={l.quantity} onChange={(e) => set(i, 'quantity', e.target.value)} /></label>
          <label className="text-xs">Price<input className="input mt-1 h-8 w-28" inputMode="decimal" required value={l.unitPrice} onChange={(e) => set(i, 'unitPrice', e.target.value)} /></label>
        </fieldset>
      ))}
      <div className="flex gap-2">
        <button type="button" className="text-xs underline" onClick={() => setLines([...lines, { kind: 'fee', description: '', quantity: '1', unitPrice: '' }])}>Add a line</button>
        <span className="flex-1" />
        <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
        <button type="submit" className="btn-primary">Save draft</button>
      </div>
    </form>
  );
}

export default function Invoices({ companyId: fixedCompany = null }) {
  const canManage = usePermission('money.billing.manage');
  const [invoices, setInvoices] = useState(null);
  const [status, setStatus] = useState('');
  const [companyId, setCompanyId] = useState(fixedCompany);
  const [open, setOpen] = useState(null);
  const [detail, setDetail] = useState(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const load = () => api.get('/money/invoices', { params: { ...(status ? { status } : {}), ...(companyId ? { companyId } : {}) } })
    .then(({ data }) => setInvoices(data.invoices)).catch((err) => setError(errMessage(err)));
  const loadDetail = (id) => api.get(`/money/invoices/${id}`).then(({ data }) => setDetail(data.invoice)).catch((err) => setError(errMessage(err)));
  useEffect(() => { load(); }, [status, companyId]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = (id) => { setDetail(null); setOpen(open === id ? null : id); if (open !== id) loadDetail(id); };
  const changed = () => { load(); if (open) loadDetail(open); };

  return (
    <section aria-label="Invoices" className="space-y-4">
      {error && <Notice tone="bad">{error}</Notice>}
      <div className="flex flex-wrap items-end gap-2">
        <select className="input w-auto" aria-label="Invoice status" value={status} onChange={(e) => setStatus(e.target.value)}>{STATUSES.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select>
        {!fixedCompany && <CustomerPicker value={companyId} onChange={setCompanyId} label="Customer filter" allowAll />}
        {canManage && !fixedCompany && <button type="button" className="btn-primary ml-auto" onClick={() => setAdding(true)}>New invoice</button>}
      </div>
      {adding && <NewInvoice onClose={() => setAdding(false)} onSaved={(inv) => { setAdding(false); load(); toggle(inv.id); }} />}
      {!invoices ? <Spinner /> : (
        <div className="card overflow-x-auto">
          <table className="min-w-full text-sm" data-testid="invoices">
            <thead><tr>{['Number', 'Customer', 'Date', 'Due', 'Status', 'Total', 'Balance'].map((h) => <th key={h} className="table-th">{h}</th>)}</tr></thead>
            <tbody>
              {invoices.map((inv) => [
                <tr key={inv.id} className="cursor-pointer border-t border-navy-100 hover:bg-navy-50" onClick={() => toggle(inv.id)}>
                  <td className="table-td font-medium">{inv.number || 'Draft'}{inv.kind === 'credit_note' && ' (credit)'}</td>
                  <td className="table-td">{inv.company?.name}</td>
                  <td className="table-td">{inv.issuedOn || '—'}</td>
                  <td className="table-td">{inv.dueOn || '—'}</td>
                  <td className="table-td"><StatusChip tone={INVOICE_TONE[inv.status]}>{INVOICE_STATUS[inv.status]}</StatusChip></td>
                  <td className="table-td num">{usd(inv.total)}</td>
                  <td className="table-td num">{inv.kind === 'invoice' && inv.status !== 'draft' ? usd(inv.balance) : '—'}</td>
                </tr>,
                open === inv.id && (
                  <tr key={`${inv.id}-open`}>
                    <td colSpan={7} className="table-td bg-navy-50">{detail ? <InvoiceDetail invoice={detail} onChanged={changed} /> : <Spinner />}</td>
                  </tr>
                ),
              ])}
              {!invoices.length && <tr><td className="table-td" colSpan={7}>No invoices yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
