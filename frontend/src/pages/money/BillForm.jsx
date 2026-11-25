// A contractor's or supplier's bill: the vendor, their number and dates, and
// lines — contractor work, materials for a job, stock for the shelf, or an
// expense — each optionally for a ticket or project. The vendor's PDF goes
// on after saving.
import { useState } from 'react';
import api, { errMessage } from '../../api/api';
import Modal from '../../components/Modal';
import Notice from '../../components/ui/Notice';
import VendorPicker from './VendorPicker';
import { EXPENSE_ACCOUNTS, today, usd } from './fmt';

const KINDS = [['contractor', 'Contractor work'], ['materials', 'Materials for a job'], ['stock', 'Stock for the shelf'], ['expense', 'Expense']];
const blankLine = (job) => ({ kind: 'contractor', description: '', amount: '', expenseAccount: '6300', ticketId: job?.ticketId || '', projectId: job?.projectId || '' });

export default function BillForm({ job, onClose, onSaved }) {
  const [form, setForm] = useState({ vendorCompanyId: null, billNumber: '', billDate: today(), dueDate: '', notes: '' });
  const [lines, setLines] = useState([blankLine(job)]);
  const [file, setFile] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const setLine = (i, k, v) => setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, [k]: v } : l)));
  const total = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);

  const save = async (e) => {
    e.preventDefault();
    setError(''); setSaving(true);
    try {
      const body = {
        ...form,
        dueDate: form.dueDate || null,
        total: total.toFixed(2),
        lines: lines.map((l) => ({
          kind: l.kind,
          description: l.description,
          amount: l.amount,
          expenseAccount: l.kind === 'expense' ? l.expenseAccount : undefined,
          ticketId: String(l.ticketId).trim() || undefined,
          projectId: l.projectId ? Number(l.projectId) : undefined,
        })),
      };
      const { data } = await api.post('/money/bills', body);
      if (file) {
        const fd = new FormData();
        fd.append('file', file);
        await api.post(`/money/bills/${data.bill.id}/file`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      }
      onSaved(data.bill);
    } catch (err) { setError(errMessage(err)); } finally { setSaving(false); }
  };

  return (
    <Modal title="Add a bill" onClose={onClose} wide>
      <form onSubmit={save} aria-label="Bill" className="space-y-4">
        {error && <Notice tone="bad">{error}</Notice>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <VendorPicker required value={form.vendorCompanyId} onChange={(v) => setForm({ ...form, vendorCompanyId: v })} />
          <label className="text-sm">Their bill number<input className="input mt-1" required maxLength={100} value={form.billNumber} onChange={(e) => setForm({ ...form, billNumber: e.target.value })} /></label>
          <label className="text-sm">Bill date<input type="date" className="input mt-1" required value={form.billDate} onChange={(e) => setForm({ ...form, billDate: e.target.value })} /></label>
          <label className="text-sm">Due<input type="date" className="input mt-1" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} /></label>
        </div>
        <fieldset className="space-y-3">
          <legend className="text-sm font-semibold">Lines</legend>
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-1 gap-2 rounded-md border border-navy-100 p-3 sm:grid-cols-6" aria-label={`Line ${i + 1}`} role="group">
              <label className="text-xs sm:col-span-2">Kind<select className="input mt-1" aria-label="Kind" value={l.kind} onChange={(e) => setLine(i, 'kind', e.target.value)}>{KINDS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></label>
              <label className="text-xs sm:col-span-3">Description<input className="input mt-1" required maxLength={500} value={l.description} onChange={(e) => setLine(i, 'description', e.target.value)} /></label>
              <label className="text-xs">Amount ($)<input className="input mt-1" required inputMode="decimal" value={l.amount} onChange={(e) => setLine(i, 'amount', e.target.value)} /></label>
              {l.kind === 'expense' && (
                <label className="text-xs sm:col-span-2">Expense kind<select className="input mt-1" aria-label="Expense kind" value={l.expenseAccount} onChange={(e) => setLine(i, 'expenseAccount', e.target.value)}>{EXPENSE_ACCOUNTS.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select></label>
              )}
              {l.kind !== 'stock' && (
                <>
                  <label className="text-xs">Ticket number<input className="input mt-1" placeholder="WC-T0042" maxLength={40} value={l.ticketId} onChange={(e) => setLine(i, 'ticketId', e.target.value)} /></label>
                  <label className="text-xs">Project ID<input className="input mt-1" inputMode="numeric" value={l.projectId} onChange={(e) => setLine(i, 'projectId', e.target.value.replace(/\D/g, ''))} /></label>
                </>
              )}
              {lines.length > 1 && <button type="button" className="self-end text-xs" style={{ color: 'var(--color-danger)' }} onClick={() => setLines(lines.filter((_, idx) => idx !== i))}>Remove line</button>}
            </div>
          ))}
          <button type="button" className="btn-secondary h-8 px-3 text-xs" onClick={() => setLines([...lines, blankLine(job)])}>Add a line</button>
        </fieldset>
        <label className="block text-sm">The vendor's bill (PDF or photo)<input type="file" className="mt-1 block text-sm" accept=".pdf,.png,.jpg,.jpeg" onChange={(e) => setFile(e.target.files[0] || null)} /></label>
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold">Total {usd(total)}</span>
          <div className="flex gap-2">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save bill'}</button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
