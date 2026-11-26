// Payments (Phase 3, step 3): money received, online (Stripe) or by hand,
// and credit applied. A payment can be refunded (online ones through
// Stripe).
import { useEffect, useState } from 'react';
import api, { errMessage } from '../../api/api';
import { usePermission } from '../../context/AuthContext';
import Notice from '../../components/ui/Notice';
import Spinner from '../../components/Spinner';
import StatusChip from '../../components/ui/StatusChip';
import { usd } from './fmt';

const METHOD = { card: 'Card', us_bank_account: 'Bank (ACH)', check: 'Check', cash: 'Cash', transfer: 'Transfer', credit: 'Credit' };
const TONE = { succeeded: 'good', pending: 'waiting', failed: 'bad' };

export default function Payments({ companyId = null }) {
  const canManage = usePermission('money.billing.manage');
  const [payments, setPayments] = useState(null);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const load = () => api.get('/money/payments', { params: companyId ? { companyId } : {} })
    .then(({ data }) => setPayments(data.payments)).catch((err) => setError(errMessage(err)));
  useEffect(() => { load(); }, [companyId]); // eslint-disable-line react-hooks/exhaustive-deps
  const refund = async (p) => {
    const amount = window.prompt(`Refund how much? (up to ${usd(Number(p.amount) - Number(p.refundedAmount))})`);
    if (!amount) return;
    const reason = window.prompt('Why?') || '';
    setError(''); setInfo('');
    try {
      await api.post(`/money/payments/${p.id}/refund`, { amount, reason, method: 'check' });
      setInfo(['card', 'us_bank_account'].includes(p.method) ? 'Refunded through Stripe.' : 'Refund recorded.');
      load();
    } catch (err) { setError(errMessage(err)); }
  };
  return (
    <section aria-label="Payments" className="space-y-4">
      {error && <Notice tone="bad">{error}</Notice>}
      {info && <Notice tone="info">{info}</Notice>}
      {!payments ? <Spinner /> : (
        <div className="card overflow-x-auto">
          <table className="min-w-full text-sm" data-testid="payments">
            <thead><tr>{['Received', 'Customer', 'Invoice', 'How', 'Status', 'Amount', 'Fee', 'Refunded', ''].map((h) => <th key={h} className="table-th">{h}</th>)}</tr></thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id} className="border-t border-navy-100">
                  <td className="table-td">{p.receivedOn || '—'}</td>
                  <td className="table-td">{p.company?.name}</td>
                  <td className="table-td">{p.invoiceNumber || '—'}</td>
                  <td className="table-td">{METHOD[p.method]}{p.reference ? ` #${p.reference}` : ''}</td>
                  <td className="table-td"><StatusChip tone={TONE[p.status]}>{p.status}</StatusChip></td>
                  <td className="table-td num">{usd(p.amount)}</td>
                  <td className="table-td num">{Number(p.fee) ? usd(p.fee) : '—'}</td>
                  <td className="table-td num">{Number(p.refundedAmount) ? usd(p.refundedAmount) : '—'}</td>
                  <td className="table-td">{canManage && p.status === 'succeeded' && p.method !== 'credit' && Number(p.refundedAmount) < Number(p.amount) && <button type="button" className="text-xs underline" onClick={() => refund(p)}>Refund</button>}</td>
                </tr>
              ))}
              {!payments.length && <tr><td className="table-td" colSpan={9}>No payments yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
