// Purchase orders: draft → ordered → received (in full or in part), or
// cancelled. Receiving puts shelf items on the shelf and job items on the
// job; anything with a serial number becomes the customer's asset.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { errMessage } from '../../api/api';
import Notice from '../../components/ui/Notice';
import Spinner from '../../components/Spinner';
import StatusChip from '../../components/ui/StatusChip';
import PurchaseOrderForm from './PurchaseOrderForm';
import { qty, today, usd } from './fmt';

const TONE = { draft: 'neutral', ordered: 'info', partly_received: 'waiting', received: 'good', cancelled: 'neutral' };
const label = (s) => s.replace('_', ' ');

function Receive({ po, onDone }) {
  const open = po.lines.filter((l) => Number(l.receivedQuantity) < Number(l.quantity));
  const [rows, setRows] = useState(() => Object.fromEntries(open.map((l) => [l.id, { quantity: qty(Number(l.quantity) - Number(l.receivedQuantity)), serials: '' }])));
  const [receivedOn, setReceivedOn] = useState(today());
  const [error, setError] = useState('');
  const submit = async () => {
    setError('');
    try {
      const lines = open.filter((l) => Number(rows[l.id].quantity) > 0).map((l) => ({
        lineId: l.id,
        quantity: rows[l.id].quantity,
        ...(l.product?.serialized ? { serials: rows[l.id].serials.split(/[\s,]+/).filter(Boolean) } : {}),
      }));
      await api.post(`/money/purchase-orders/${po.id}/receive`, { receivedOn, lines });
      onDone();
    } catch (err) { setError(errMessage(err)); }
  };
  return (
    <div className="space-y-2 rounded-md border border-navy-100 p-3" role="group" aria-label="Receive">
      {error && <Notice tone="bad">{error}</Notice>}
      <label className="text-xs">Received on<input type="date" className="input ml-2 inline-block h-8 w-auto" value={receivedOn} onChange={(e) => setReceivedOn(e.target.value)} /></label>
      {open.map((l) => (
        <div key={l.id} className="flex flex-wrap items-end gap-2 text-xs">
          <span className="min-w-[10rem] font-medium">{l.description}</span>
          <label>Arrived<input className="input ml-1 inline-block h-8 w-20" aria-label={`${l.description} arrived`} inputMode="decimal" value={rows[l.id].quantity} onChange={(e) => setRows({ ...rows, [l.id]: { ...rows[l.id], quantity: e.target.value } })} /></label>
          {l.product?.serialized && !l.forStock && (
            <label>Serial numbers<input className="input ml-1 inline-block h-8 w-64" aria-label={`${l.description} serial numbers`} placeholder="one per unit, comma-separated" value={rows[l.id].serials} onChange={(e) => setRows({ ...rows, [l.id]: { ...rows[l.id], serials: e.target.value } })} /></label>
          )}
        </div>
      ))}
      <button type="button" className="btn-primary h-8 px-3 text-xs" onClick={submit}>Receive</button>
    </div>
  );
}

export function PoDetail({ po, onChanged }) {
  const [receiving, setReceiving] = useState(false);
  const [error, setError] = useState('');
  const run = async (fn) => { setError(''); try { await fn(); onChanged(); } catch (err) { setError(errMessage(err)); } };
  return (
    <div className="space-y-3 text-sm">
      {error && <Notice tone="bad">{error}</Notice>}
      <p className="text-xs text-navy-500">
        {po.ticketId && <Link className="underline" to={`/tickets/${po.ticketId}`}>For a ticket</Link>}
        {po.projectId && <Link className="underline" to={`/projects/${po.projectId}`}>For a project</Link>}
        {!po.ticketId && !po.projectId && 'For the shelf'}
        {po.orderedOn && ` · ordered ${po.orderedOn}`}
      </p>
      <table className="min-w-full text-xs">
        <thead><tr>{['Item', 'Ordered', 'Received', 'Unit cost', 'Total'].map((h) => <th key={h} className="table-th">{h}</th>)}</tr></thead>
        <tbody>{po.lines.map((l) => (
          <tr key={l.id}>
            <td className="table-td">{l.description}{l.forStock && <span className="ml-2 text-navy-500">shelf</span>}</td>
            <td className="table-td num">{qty(l.quantity)}</td>
            <td className="table-td num">{qty(l.receivedQuantity)}</td>
            <td className="table-td num">{usd(l.unitCost)}</td>
            <td className="table-td num">{usd(l.total)}</td>
          </tr>
        ))}</tbody>
      </table>
      <div className="flex flex-wrap gap-2">
        {po.status === 'draft' && <button type="button" className="btn-primary h-8 px-3 text-xs" onClick={() => run(() => api.post(`/money/purchase-orders/${po.id}/order`, {}))}>Mark ordered</button>}
        {['ordered', 'partly_received'].includes(po.status) && <button type="button" className="btn-primary h-8 px-3 text-xs" onClick={() => setReceiving(!receiving)}>Receive items</button>}
        {['draft', 'ordered', 'partly_received'].includes(po.status) && (
          <button type="button" className="btn-secondary h-8 px-3 text-xs" onClick={() => window.confirm('Cancel this purchase order?') && run(() => api.post(`/money/purchase-orders/${po.id}/cancel`, {}))}>Cancel order</button>
        )}
      </div>
      {receiving && <Receive po={po} onDone={() => { setReceiving(false); onChanged(); }} />}
    </div>
  );
}

const poTotal = (po) => po.lines.reduce((s, l) => s + Number(l.total), 0);

export default function PurchaseOrders() {
  const [pos, setPos] = useState(null);
  const [open, setOpen] = useState(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const load = () => api.get('/money/purchase-orders').then(({ data }) => setPos(data.purchaseOrders)).catch((err) => setError(errMessage(err)));
  useEffect(() => { load(); }, []);
  return (
    <section aria-label="Purchase orders" className="space-y-4">
      {error && <Notice tone="bad">{error}</Notice>}
      <div className="flex"><button type="button" className="btn-primary ml-auto" onClick={() => setAdding(true)}>New purchase order</button></div>
      {!pos ? <Spinner /> : (
        <div className="card overflow-x-auto">
          <table className="min-w-full text-sm" data-testid="purchase-orders">
            <thead><tr>{['Number', 'Vendor', 'Status', 'Items', 'Total'].map((h) => <th key={h} className="table-th">{h}</th>)}</tr></thead>
            <tbody>
              {pos.map((po) => [
                <tr key={po.id} className="cursor-pointer border-t border-navy-100 hover:bg-navy-50" onClick={() => setOpen(open === po.id ? null : po.id)}>
                  <td className="table-td font-medium">{po.number}</td>
                  <td className="table-td">{po.vendor?.name}</td>
                  <td className="table-td"><StatusChip tone={TONE[po.status]}>{label(po.status)}</StatusChip></td>
                  <td className="table-td">{po.lines.map((l) => l.description).join(', ')}</td>
                  <td className="table-td num">{usd(poTotal(po))}</td>
                </tr>,
                open === po.id && <tr key={`${po.id}-open`}><td colSpan={5} className="table-td bg-navy-50"><PoDetail po={po} onChanged={load} /></td></tr>,
              ])}
              {!pos.length && <tr><td className="table-td" colSpan={5}>No purchase orders yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {adding && <PurchaseOrderForm onClose={() => setAdding(false)} onSaved={(po) => { setAdding(false); setOpen(po.id); load(); }} />}
    </section>
  );
}
