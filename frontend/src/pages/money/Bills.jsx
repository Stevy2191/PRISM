// Bills: received → entered (into the city's system, e.g. Tyler Incode, with
// its reference) → paid, or void. Each bill opens to its lines, file and
// actions.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { errMessage } from '../../api/api';
import Notice from '../../components/ui/Notice';
import Spinner from '../../components/Spinner';
import StatusChip from '../../components/ui/StatusChip';
import BillForm from './BillForm';
import { download, today, usd } from './fmt';

const STATUSES = [['', 'All'], ['received', 'Received'], ['entered', 'Entered'], ['paid', 'Paid'], ['void', 'Void']];
const TONE = { received: 'waiting', entered: 'info', paid: 'good', void: 'neutral' };
const METHODS = [['check', 'Check'], ['ach', 'ACH'], ['card', 'Card'], ['cash', 'Cash'], ['other', 'Other']];

export function BillActions({ bill, onChanged }) {
  const [ref, setRef] = useState(bill.externalRef || '');
  const [pay, setPay] = useState({ paidOn: today(), paidMethod: 'check', paidRef: '' });
  const [error, setError] = useState('');
  const run = async (fn) => {
    setError('');
    try { await fn(); onChanged(); } catch (err) { setError(errMessage(err)); }
  };
  const upload = (file) => run(async () => {
    const fd = new FormData();
    fd.append('file', file);
    await api.post(`/money/bills/${bill.id}/file`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
  });
  return (
    <div className="space-y-3 text-sm">
      {error && <Notice tone="bad">{error}</Notice>}
      <ul className="space-y-1">
        {bill.lines.map((l) => (
          <li key={l.id} className="flex justify-between gap-3">
            <span>{l.description}{l.ticketId && <Link className="ml-2 text-xs underline" to={`/tickets/${l.ticketId}`}>ticket</Link>}{l.projectId && <Link className="ml-2 text-xs underline" to={`/projects/${l.projectId}`}>project</Link>}</span>
            <span className="num">{usd(l.amount)}</span>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-3">
        {bill.fileName
          ? <button type="button" className="text-xs underline" onClick={() => download(api, `/money/bills/${bill.id}/file`, bill.fileName)}>{bill.fileName}</button>
          : <span className="text-xs text-navy-500">No file yet</span>}
        {bill.status !== 'void' && (
          <label className="text-xs">{bill.fileName ? 'Replace file' : 'Add the vendor\'s PDF'}
            <input type="file" className="ml-2 text-xs" accept=".pdf,.png,.jpg,.jpeg" aria-label="Bill file" onChange={(e) => e.target.files[0] && upload(e.target.files[0])} />
          </label>
        )}
      </div>
      {bill.status === 'received' && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs">Reference in your system (e.g. Incode)<input className="input mt-1 h-8" maxLength={100} value={ref} onChange={(e) => setRef(e.target.value)} /></label>
          <button type="button" className="btn-primary h-8 px-3 text-xs" onClick={() => run(() => api.post(`/money/bills/${bill.id}/enter`, { externalRef: ref || null }))}>Mark entered</button>
        </div>
      )}
      {bill.status === 'entered' && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs">Paid on<input type="date" className="input mt-1 h-8" value={pay.paidOn} onChange={(e) => setPay({ ...pay, paidOn: e.target.value })} /></label>
          <label className="text-xs">How<select className="input mt-1 h-8" aria-label="How" value={pay.paidMethod} onChange={(e) => setPay({ ...pay, paidMethod: e.target.value })}>{METHODS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></label>
          <label className="text-xs">Check or payment number<input className="input mt-1 h-8" maxLength={100} value={pay.paidRef} onChange={(e) => setPay({ ...pay, paidRef: e.target.value })} /></label>
          <button type="button" className="btn-primary h-8 px-3 text-xs" onClick={() => run(() => api.post(`/money/bills/${bill.id}/pay`, { ...pay, paidRef: pay.paidRef || null }))}>Mark paid</button>
        </div>
      )}
      {bill.status === 'paid' && <p className="text-xs text-navy-500">Paid {bill.paidOn} by {bill.paidMethod}{bill.paidRef ? ` #${bill.paidRef}` : ''}{bill.externalRef ? ` · ${bill.externalRef}` : ''}</p>}
      {bill.status !== 'void' && (
        <button
          type="button"
          className="text-xs"
          style={{ color: 'var(--color-danger)' }}
          onClick={() => {
            const reason = window.prompt('Why void this bill? Whatever was posted is reversed.');
            if (reason !== null) run(() => api.post(`/money/bills/${bill.id}/void`, { reason }));
          }}
        >
          Void bill
        </button>
      )}
    </div>
  );
}

export default function Bills() {
  const [bills, setBills] = useState(null);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const load = () => api.get('/money/bills', { params: { ...(status ? { status } : {}), ...(search ? { search } : {}) } })
    .then(({ data }) => setBills(data.bills)).catch((err) => setError(errMessage(err)));
  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); }, [status, search]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section aria-label="Bills" className="space-y-4">
      {error && <Notice tone="bad">{error}</Notice>}
      <div className="flex flex-wrap items-center gap-2">
        <select className="input w-auto" aria-label="Bill status" value={status} onChange={(e) => setStatus(e.target.value)}>{STATUSES.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select>
        <input className="input w-auto" placeholder="Bill number or reference" aria-label="Search bills" value={search} onChange={(e) => setSearch(e.target.value)} />
        <button type="button" className="btn-primary ml-auto" onClick={() => setAdding(true)}>Add a bill</button>
      </div>
      {!bills ? <Spinner /> : (
        <div className="card overflow-x-auto">
          <table className="min-w-full text-sm" data-testid="bills">
            <thead><tr>{['Vendor', 'Bill', 'Date', 'Due', 'Status', 'Amount'].map((h) => <th key={h} className="table-th">{h}</th>)}</tr></thead>
            <tbody>
              {bills.map((b) => [
                <tr key={b.id} className="cursor-pointer border-t border-navy-100 hover:bg-navy-50" onClick={() => setOpen(open === b.id ? null : b.id)}>
                  <td className="table-td font-medium">{b.vendor?.name}</td>
                  <td className="table-td">{b.billNumber}</td>
                  <td className="table-td">{b.billDate}</td>
                  <td className="table-td">{b.dueDate || '—'}</td>
                  <td className="table-td"><StatusChip tone={TONE[b.status]}>{b.status}</StatusChip></td>
                  <td className="table-td num">{usd(b.total)}</td>
                </tr>,
                open === b.id && <tr key={`${b.id}-open`}><td colSpan={6} className="table-td bg-navy-50"><BillActions bill={b} onChanged={load} /></td></tr>,
              ])}
              {!bills.length && <tr><td className="table-td" colSpan={6}>No bills yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {adding && <BillForm onClose={() => setAdding(false)} onSaved={(b) => { setAdding(false); setOpen(b.id); load(); }} />}
    </section>
  );
}
