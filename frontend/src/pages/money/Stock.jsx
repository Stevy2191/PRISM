// The shelf: what's on hand (in the unit it's used by), what it's worth at
// cost, its low level, counts after a stocktake, and every movement.
import { useEffect, useState } from 'react';
import api, { errMessage } from '../../api/api';
import Notice from '../../components/ui/Notice';
import Spinner from '../../components/Spinner';
import StatusChip from '../../components/ui/StatusChip';
import { qty, usd } from './fmt';

const REASON = { receive: 'Received', use: 'Used on a job', adjust: 'Counted' };

function StockDetail({ item, onChanged }) {
  const [moves, setMoves] = useState(null);
  const [count, setCount] = useState(qty(item.onHand));
  const [note, setNote] = useState('');
  const [low, setLow] = useState(item.lowStockAt == null ? '' : qty(item.lowStockAt));
  const [error, setError] = useState('');
  useEffect(() => { api.get(`/money/stock/${item.productId}/movements`).then(({ data }) => setMoves(data.movements)).catch(() => setMoves([])); }, [item]);
  const run = async (fn) => { setError(''); try { await fn(); onChanged(); } catch (err) { setError(errMessage(err)); } };
  return (
    <div className="space-y-3 text-sm">
      {error && <Notice tone="bad">{error}</Notice>}
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs">{`Counted on the shelf (${item.unit})`}<input className="input mt-1 h-8 w-28" inputMode="decimal" value={count} onChange={(e) => setCount(e.target.value)} /></label>
        <label className="text-xs">Note<input className="input mt-1 h-8" maxLength={255} value={note} onChange={(e) => setNote(e.target.value)} /></label>
        <button type="button" className="btn-secondary h-8 px-3 text-xs" onClick={() => run(() => api.post(`/money/stock/${item.productId}/adjust`, { onHand: count, note: note || undefined }))}>Save count</button>
        <label className="ml-4 text-xs">{`Warn at (${item.unit})`}<input className="input mt-1 h-8 w-24" inputMode="decimal" value={low} onChange={(e) => setLow(e.target.value)} /></label>
        <button type="button" className="btn-secondary h-8 px-3 text-xs" onClick={() => run(() => api.patch(`/money/stock/${item.productId}`, { lowStockAt: low === '' ? null : low }))}>Save low level</button>
      </div>
      {!moves ? <Spinner /> : (
        <ul className="max-h-64 space-y-1 overflow-y-auto text-xs">
          {moves.map((m) => (
            <li key={m.id} className="flex justify-between gap-3">
              <span>{new Date(m.createdAt).toLocaleDateString()} · {REASON[m.reason]}{m.note ? ` · ${m.note}` : ''}</span>
              <span className="num">{Number(m.quantity) > 0 ? '+' : ''}{qty(m.quantity)} {item.unit}</span>
            </li>
          ))}
          {!moves.length && <li>No movements yet.</li>}
        </ul>
      )}
    </div>
  );
}

export default function Stock() {
  const [items, setItems] = useState(null);
  const [open, setOpen] = useState(null);
  const [error, setError] = useState('');
  const load = () => api.get('/money/stock').then(({ data }) => setItems(data.items)).catch((err) => setError(errMessage(err)));
  useEffect(() => { load(); }, []);
  if (!items) return error ? <Notice tone="bad">{error}</Notice> : <Spinner />;
  const total = items.reduce((s, i) => s + Number(i.value), 0);
  return (
    <section aria-label="Stock" className="space-y-3">
      {error && <Notice tone="bad">{error}</Notice>}
      <p className="text-sm text-navy-500">Products marked “Kept in stock” in Settings › Money › Products. On the shelf at cost: <span className="num font-semibold text-navy-900">{usd(total)}</span></p>
      <div className="card overflow-x-auto">
        <table className="min-w-full text-sm" data-testid="stock">
          <thead><tr>{['Product', 'On hand', 'Value at cost', 'Warn at', ''].map((h) => <th key={h} className="table-th">{h}</th>)}</tr></thead>
          <tbody>
            {items.map((i) => [
              <tr key={i.productId} className="cursor-pointer border-t border-navy-100 hover:bg-navy-50" onClick={() => setOpen(open === i.productId ? null : i.productId)}>
                <td className="table-td font-medium">{i.name}</td>
                <td className="table-td num">{qty(i.onHand)} {i.unit}</td>
                <td className="table-td num">{usd(i.value)}</td>
                <td className="table-td num">{i.lowStockAt == null ? '—' : `${qty(i.lowStockAt)} ${i.unit}`}</td>
                <td className="table-td">{i.low && <StatusChip tone="bad">low</StatusChip>}</td>
              </tr>,
              open === i.productId && <tr key={`${i.productId}-open`}><td colSpan={5} className="table-td bg-navy-50"><StockDetail item={i} onChanged={load} /></td></tr>,
            ])}
            {!items.length && <tr><td className="table-td" colSpan={5}>Nothing is kept in stock yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}
