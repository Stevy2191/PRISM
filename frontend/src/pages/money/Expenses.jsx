// Expenses paid on the spot — fuel, a tool, toner from the store — with a
// photo of the receipt (a phone opens its camera). One for a customer's job
// can be billed on to them later. Amounts are never edited: void and redo.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { errMessage } from '../../api/api';
import Modal from '../../components/Modal';
import Notice from '../../components/ui/Notice';
import Spinner from '../../components/Spinner';
import StatusChip from '../../components/ui/StatusChip';
import VendorPicker from './VendorPicker';
import {
  EXPENSE_ACCOUNTS, accountName, download, today, usd,
} from './fmt';

const METHODS = [['card', 'Card'], ['cash', 'Cash'], ['check', 'Check'], ['ach', 'ACH'], ['reimbursed', 'Paid personally (reimbursed)'], ['other', 'Other']];

function ExpenseForm({ onClose, onSaved }) {
  const [form, setForm] = useState({
    spentOn: today(), account: '6200', description: '', amount: '', paymentMethod: 'card', vendorCompanyId: null, jobKind: '', jobId: '', rebillable: false,
  });
  const [file, setFile] = useState(null);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const save = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const { data } = await api.post('/money/expenses', {
        spentOn: form.spentOn,
        account: form.account,
        description: form.description,
        amount: form.amount,
        paymentMethod: form.paymentMethod,
        vendorCompanyId: form.vendorCompanyId || undefined,
        ...(form.jobKind === 'ticket' && form.jobId ? { ticketId: Number(form.jobId) } : {}),
        ...(form.jobKind === 'project' && form.jobId ? { projectId: Number(form.jobId) } : {}),
        rebillable: form.rebillable,
      });
      if (file) {
        const fd = new FormData();
        fd.append('file', file);
        await api.post(`/money/expenses/${data.expense.id}/receipt`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      }
      onSaved();
    } catch (err) { setError(errMessage(err)); }
  };
  return (
    <Modal title="Record an expense" onClose={onClose} wide>
      <form onSubmit={save} aria-label="Expense" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {error && <div className="sm:col-span-3"><Notice tone="bad">{error}</Notice></div>}
        <label className="text-sm">Date<input type="date" className="input mt-1" required value={form.spentOn} onChange={set('spentOn')} /></label>
        <label className="text-sm">Kind<select className="input mt-1" aria-label="Kind" value={form.account} onChange={set('account')}>{EXPENSE_ACCOUNTS.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select></label>
        <label className="text-sm">Amount ($)<input className="input mt-1" required inputMode="decimal" value={form.amount} onChange={set('amount')} /></label>
        <label className="text-sm sm:col-span-2">What for<input className="input mt-1" required maxLength={500} value={form.description} onChange={set('description')} /></label>
        <label className="text-sm">Paid by<select className="input mt-1" aria-label="Paid by" value={form.paymentMethod} onChange={set('paymentMethod')}>{METHODS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></label>
        <VendorPicker label="Where (optional)" value={form.vendorCompanyId} onChange={(v) => setForm({ ...form, vendorCompanyId: v })} />
        <label className="text-sm">For a job<select className="input mt-1" aria-label="For a job" value={form.jobKind} onChange={set('jobKind')}><option value="">No</option><option value="ticket">A ticket</option><option value="project">A project</option></select></label>
        {form.jobKind && <label className="text-sm">{form.jobKind === 'ticket' ? 'Ticket ID' : 'Project ID'}<input className="input mt-1" required inputMode="numeric" value={form.jobId} onChange={(e) => setForm({ ...form, jobId: e.target.value.replace(/\D/g, '') })} /></label>}
        {form.jobKind && <label className="flex items-center gap-2 text-sm sm:col-span-3"><input type="checkbox" checked={form.rebillable} onChange={set('rebillable')} /> Bill it on to the customer</label>}
        <label className="text-sm sm:col-span-3">Receipt (PDF or photo)<input type="file" className="mt-1 block text-sm" accept=".pdf,.png,.jpg,.jpeg,image/*" capture="environment" onChange={(e) => setFile(e.target.files[0] || null)} /></label>
        <div className="flex justify-end gap-2 sm:col-span-3">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary">Save expense</button>
        </div>
      </form>
    </Modal>
  );
}

export default function Expenses() {
  const [rows, setRows] = useState(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const load = () => api.get('/money/expenses').then(({ data }) => setRows(data.expenses)).catch((err) => setError(errMessage(err)));
  useEffect(() => { load(); }, []);
  const voidIt = async (e) => {
    const reason = window.prompt('Why void this expense? It is reversed in the books.');
    if (reason === null) return;
    try { await api.post(`/money/expenses/${e.id}/void`, { reason }); load(); } catch (err) { setError(errMessage(err)); }
  };
  return (
    <section aria-label="Expenses" className="space-y-4">
      {error && <Notice tone="bad">{error}</Notice>}
      <div className="flex"><button type="button" className="btn-primary ml-auto" onClick={() => setAdding(true)}>Record an expense</button></div>
      {!rows ? <Spinner /> : (
        <div className="card overflow-x-auto">
          <table className="min-w-full text-sm" data-testid="expenses">
            <thead><tr>{['Date', 'What for', 'Kind', 'Job', 'Receipt', 'Amount', ''].map((h) => <th key={h} className="table-th">{h}</th>)}</tr></thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id} className="border-t border-navy-100">
                  <td className="table-td">{e.spentOn}</td>
                  <td className="table-td font-medium">{e.description}{e.vendor && <span className="ml-2 text-xs text-navy-500">{e.vendor.name}</span>}</td>
                  <td className="table-td">{accountName(e.account)}</td>
                  <td className="table-td">
                    {e.ticketId && <Link className="underline" to={`/tickets/${e.ticketId}`}>ticket</Link>}
                    {e.projectId && <Link className="underline" to={`/projects/${e.projectId}`}>project</Link>}
                    {e.billingStatus === 'unbilled' && <StatusChip tone="waiting" className="ml-2">to bill</StatusChip>}
                    {e.billingStatus === 'billed' && <StatusChip tone="good" className="ml-2">billed</StatusChip>}
                  </td>
                  <td className="table-td">{e.hasReceipt ? <button type="button" className="text-xs underline" onClick={() => download(api, `/money/expenses/${e.id}/receipt`, e.receiptName || 'receipt')}>{e.receiptName || 'receipt'}</button> : '—'}</td>
                  <td className="table-td num">{usd(e.amount)}</td>
                  <td className="table-td text-right">{e.billingStatus !== 'billed' && <button type="button" className="text-xs" style={{ color: 'var(--color-danger)' }} onClick={() => voidIt(e)}>Void</button>}</td>
                </tr>
              ))}
              {!rows.length && <tr><td className="table-td" colSpan={7}>No expenses yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {adding && <ExpenseForm onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load(); }} />}
    </section>
  );
}
