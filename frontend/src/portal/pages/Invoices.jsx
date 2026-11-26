import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import portalApi, { apiPath } from '../api';
import { usePortalAuth } from '../PortalAuth';
import PageHeader from '../../components/ui/PageHeader';
import StatusChip from '../../components/ui/StatusChip';

// Phase 3: the invoices this contact can see — all of the company's for a
// company admin, else the ones billed to them. Pay opens Stripe's page.
const usd = (v) => Number(v).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const TONE = { sent: 'info', partly_paid: 'waiting', paid: 'good' };
const LABEL = { sent: 'Due', partly_paid: 'Partly paid', paid: 'Paid' };

export default function Invoices() {
  const { me } = usePortalAuth();
  const [params] = useSearchParams();
  const [invoices, setInvoices] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    portalApi.get('/invoices')
      .then(({ data }) => { if (live) setInvoices(data.invoices); })
      .catch(() => { if (live) { setInvoices([]); setError("Couldn't load the invoices."); } });
    return () => { live = false; };
  }, []);
  const pay = async (inv) => {
    setError('');
    try {
      const { data } = await portalApi.post(`/invoices/${inv.id}/pay`, {});
      window.location.assign(data.url);
    } catch { setError("Online payment isn't available right now."); }
  };
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Invoices" sub={`${me?.company?.name || 'Your company'}'s invoices`} />
      {params.get('paid') && <div className="card p-4 text-sm">Thank you — your payment was received. A bank payment can take a few days to clear.</div>}
      {error && <div className="card p-4 text-sm" style={{ color: 'var(--color-danger)' }}>{error}</div>}
      {invoices && invoices.length === 0 && !error && (
        <div className="card p-10 text-center text-sm" style={{ color: 'var(--color-text-muted)' }}>No invoices yet.</div>
      )}
      <div className="flex flex-col gap-2.5" data-testid="portal-invoices">
        {(invoices || []).map((inv) => (
          <div key={inv.id} className="card flex flex-wrap items-center gap-3 p-4">
            <div className="min-w-0 flex-1">
              <div className="font-semibold">{inv.number}</div>
              <div className="text-[13px]" style={{ color: 'var(--color-text-secondary)' }}>Dated {inv.issuedOn} · due {inv.dueOn}</div>
            </div>
            <StatusChip tone={TONE[inv.status]}>{LABEL[inv.status]}</StatusChip>
            <div className="num text-right">
              <div className="font-semibold">{usd(inv.total)}</div>
              {inv.status !== 'paid' && <div className="text-[13px]" style={{ color: 'var(--color-text-muted)' }}>{usd(inv.balance)} to pay</div>}
            </div>
            <a className="text-sm underline" href={apiPath(`/invoices/${inv.id}/pdf`)}>PDF</a>
            {inv.status !== 'paid' && <button type="button" className="btn-primary" onClick={() => pay(inv)}>Pay</button>}
          </div>
        ))}
      </div>
    </div>
  );
}
