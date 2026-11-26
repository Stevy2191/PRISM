// One invoice (Phase 3, step 3): its lines and totals, and what can be done
// with it — a draft is sent or deleted; a sent invoice takes payments,
// customer credit, a credit note, is emailed again, or voided. Amounts are
// worked out by the server; this only shows them.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import api, { errMessage } from '../../api/api';
import { usePermission } from '../../context/AuthContext';
import Notice from '../../components/ui/Notice';
import { download, qty, today, usd } from './fmt';

const METHODS = [['check', 'Check'], ['cash', 'Cash'], ['transfer', 'Transfer']];

export default function InvoiceDetail({ invoice, onChanged }) {
  const canManage = usePermission('money.billing.manage');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [pay, setPay] = useState({ method: 'check', amount: invoice.balance, receivedOn: today(), reference: '' });
  const [credit, setCredit] = useState('');
  const run = async (fn, done) => {
    setError(''); setInfo('');
    try {
      const res = await fn();
      if (done) setInfo(done(res));
      onChanged();
    } catch (err) { setError(errMessage(err)); }
  };
  const open = ['sent', 'partly_paid'].includes(invoice.status);
  const delivered = (res) => {
    const d = res.data.delivery;
    if (!d) return 'Sent.';
    return d.emailed ? `Sent and emailed to ${d.to.join(', ')}.` : `Sent, but not emailed: ${d.reason}`;
  };
  return (
    <div className="space-y-3 text-sm" data-testid="invoice-detail">
      {error && <Notice tone="bad">{error}</Notice>}
      {info && <Notice tone="info">{info}</Notice>}
      <table className="min-w-full text-sm">
        <thead><tr>{['Description', 'Qty', 'Price', 'Amount', 'Tax'].map((h) => <th key={h} className="table-th">{h}</th>)}</tr></thead>
        <tbody>
          {invoice.lines.map((l) => (
            <tr key={l.id} className="border-t border-navy-100">
              <td className="table-td">{l.description}{l.ticketId && <Link className="ml-2 text-xs underline" to={`/tickets/${l.ticketId}`}>ticket</Link>}</td>
              <td className="table-td num">{qty(l.quantity)}</td>
              <td className="table-td num">{usd(l.unitPrice)}</td>
              <td className="table-td num">{usd(l.amount)}</td>
              <td className="table-td num">{usd(l.tax)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="ml-auto grid w-64 grid-cols-2 gap-1 text-right">
        <dt>Subtotal</dt><dd className="num">{usd(invoice.subtotal)}</dd>
        <dt>Sales tax</dt><dd className="num">{usd(invoice.taxTotal)}</dd>
        <dt className="font-semibold">Total</dt><dd className="num font-semibold">{usd(invoice.total)}</dd>
        {invoice.kind === 'invoice' && invoice.status !== 'draft' && <><dt>Balance due</dt><dd className="num" data-testid="invoice-balance">{usd(invoice.balance)}</dd></>}
      </dl>
      {invoice.creditNotes && invoice.creditNotes.length > 0 && (
        <p className="text-xs text-navy-500">Credit notes: {invoice.creditNotes.map((c) => `${c.number} (${usd(c.total)})`).join(', ')}</p>
      )}
      <div className="flex flex-wrap gap-3">
        <button type="button" className="text-xs underline" onClick={() => download(api, `/money/invoices/${invoice.id}/pdf`, `${invoice.number || `draft-${invoice.id}`}.pdf`)}>PDF</button>
        {canManage && invoice.status === 'draft' && (
          <>
            <button type="button" className="btn-primary h-8 px-3 text-xs" onClick={() => run(() => api.post(`/money/invoices/${invoice.id}/send`, {}), delivered)}>Send invoice</button>
            <button type="button" className="text-xs" style={{ color: 'var(--color-danger)' }} onClick={() => window.confirm('Delete this draft? What it billed goes back to unbilled.') && run(() => api.delete(`/money/invoices/${invoice.id}`))}>Delete draft</button>
          </>
        )}
        {canManage && open && (
          <button type="button" className="text-xs underline" onClick={() => run(() => api.post(`/money/invoices/${invoice.id}/email`, {}), (res) => (res.data.delivery.emailed ? `Emailed to ${res.data.delivery.to.join(', ')}.` : `Not emailed: ${res.data.delivery.reason}`))}>Email again (new pay link)</button>
        )}
      </div>
      {canManage && open && (
        <form
          className="flex flex-wrap items-end gap-2"
          aria-label="Record a payment"
          onSubmit={(e) => { e.preventDefault(); run(() => api.post(`/money/invoices/${invoice.id}/payments`, { ...pay, reference: pay.reference || null }), () => 'Payment recorded.'); }}
        >
          <label className="text-xs">How<select className="input mt-1 h-8" aria-label="Payment method" value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })}>{METHODS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></label>
          <label className="text-xs">Amount<input className="input mt-1 h-8 w-28" inputMode="decimal" aria-label="Payment amount" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} /></label>
          <label className="text-xs">Received<input type="date" className="input mt-1 h-8" value={pay.receivedOn} onChange={(e) => setPay({ ...pay, receivedOn: e.target.value })} /></label>
          <label className="text-xs">Check or reference<input className="input mt-1 h-8" maxLength={100} value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} /></label>
          <button type="submit" className="btn-primary h-8 px-3 text-xs">Record payment</button>
        </form>
      )}
      {canManage && open && (
        <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); run(() => api.post(`/money/invoices/${invoice.id}/apply-credit`, { amount: credit }), () => 'Credit applied.'); }}>
          <label className="text-xs">Use customer credit<input className="input mt-1 h-8 w-28" inputMode="decimal" aria-label="Credit to apply" value={credit} onChange={(e) => setCredit(e.target.value)} /></label>
          <button type="submit" className="h-8 px-3 text-xs underline">Apply credit</button>
        </form>
      )}
      {canManage && invoice.kind === 'invoice' && ['sent', 'partly_paid', 'paid'].includes(invoice.status) && (
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            className="text-xs underline"
            onClick={() => {
              const amount = window.prompt('Credit how much (before tax)?');
              if (!amount) return;
              const reason = window.prompt('Why? (shown on the credit note)');
              if (reason) run(() => api.post(`/money/invoices/${invoice.id}/credit-note`, { reason, lines: [{ kind: 'fee', description: reason, quantity: '1', unitPrice: amount }] }), (res) => `Credit note ${res.data.invoice.number} issued.`);
            }}
          >
            Issue a credit note
          </button>
          {invoice.status !== 'paid' && (
            <button
              type="button"
              className="text-xs"
              style={{ color: 'var(--color-danger)' }}
              onClick={() => {
                const reason = window.prompt('Why void this invoice? Its posting is reversed and what it billed is freed.');
                if (reason) run(() => api.post(`/money/invoices/${invoice.id}/void`, { reason }));
              }}
            >
              Void invoice
            </button>
          )}
        </div>
      )}
    </div>
  );
}
