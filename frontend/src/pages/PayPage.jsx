// The pay link (Phase 3, step 3): fully public, reached from the invoice
// email, no PRISM login. Shows that one invoice; Pay now goes to Stripe
// Checkout for the balance the server works out. Card and bank details are
// typed on Stripe's page, never here. Also Stripe's thank-you and
// cancelled return pages (they carry no token).
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import api, { errMessage } from '../api/api';
import Spinner from '../components/Spinner';

const usd = (v) => Number(v).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const Frame = ({ children }) => (
  <div className="min-h-screen px-4 py-10" style={{ backgroundColor: 'var(--color-bg)' }}>
    <div className="card mx-auto max-w-2xl space-y-5 p-6">{children}</div>
  </div>
);

export function PayReturn({ paid }) {
  return (
    <Frame>
      <h1 className="text-xl font-semibold">{paid ? 'Thank you' : 'Payment cancelled'}</h1>
      <p className="text-sm">{paid
        ? 'Your payment was received. A bank payment can take a few days to clear; you\'ll get a receipt from Stripe.'
        : 'Nothing was charged. You can go back to the link in your email to pay when you\'re ready.'}
      </p>
    </Frame>
  );
}

export default function PayPage() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [paying, setPaying] = useState(false);
  useEffect(() => {
    api.get(`/pay/${encodeURIComponent(token)}`).then(({ data: d }) => setData(d)).catch((err) => setError(errMessage(err, 'This payment link isn\'t valid. Ask us for a new one.')));
  }, [token]);
  const pay = async () => {
    setPaying(true); setError('');
    try {
      const { data: d } = await api.post(`/pay/${encodeURIComponent(token)}/checkout`, {});
      window.location.assign(d.url);
    } catch (err) { setError(errMessage(err)); setPaying(false); }
  };
  if (error && !data) return <Frame><p className="text-sm" role="alert">{error}</p></Frame>;
  if (!data) return <Spinner className="min-h-screen" />;
  const inv = data.invoice;
  return (
    <Frame>
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-navy-500">{data.business.name}</p>
          <h1 className="text-xl font-semibold">Invoice {inv.number}</h1>
          <p className="text-sm text-navy-500">Dated {inv.issuedOn} · due {inv.dueOn}</p>
        </div>
        <a className="text-sm underline" href={`/api/v1/pay/${encodeURIComponent(token)}/pdf`} target="_blank" rel="noreferrer">PDF</a>
      </header>
      <table className="min-w-full text-sm">
        <thead><tr><th className="table-th">Description</th><th className="table-th text-right">Amount</th></tr></thead>
        <tbody>
          {inv.lines.map((l, i) => (
            <tr key={i} className="border-t border-navy-100"><td className="table-td">{l.description}</td><td className="table-td num text-right">{usd(l.amount)}</td></tr>
          ))}
        </tbody>
      </table>
      <dl className="ml-auto grid w-64 grid-cols-2 gap-1 text-right text-sm">
        <dt>Subtotal</dt><dd className="num">{usd(inv.subtotal)}</dd>
        <dt>Sales tax</dt><dd className="num">{usd(inv.taxTotal)}</dd>
        <dt>Total</dt><dd className="num">{usd(inv.total)}</dd>
        {Number(inv.paid) > 0 && <><dt>Paid</dt><dd className="num">{usd(inv.paid)}</dd></>}
        <dt className="font-semibold">Balance due</dt><dd className="num font-semibold" data-testid="pay-balance">{usd(inv.balance)}</dd>
      </dl>
      {error && <p className="text-sm" role="alert" style={{ color: 'var(--color-danger)' }}>{error}</p>}
      {data.canPayOnline
        ? <button type="button" className="btn-primary w-full" disabled={paying} onClick={pay}>{paying ? 'Opening the secure payment page…' : `Pay ${usd(inv.balance)} now`}</button>
        : <p className="text-sm text-navy-500">Online payment isn't available yet. Please pay by check or transfer, quoting {inv.number}.</p>}
      <p className="text-xs text-navy-500">Card and bank payments are taken by Stripe; your details never reach us.</p>
    </Frame>
  );
}
