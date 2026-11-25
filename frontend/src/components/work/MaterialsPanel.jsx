// Materials on a ticket (Phase 3): from the catalog or straight off the
// shelf (300 ft of a 1,000 ft box), or anything typed in. Prices show only
// to those with a money permission; the server leaves them out otherwise.
import { useEffect, useState } from 'react';
import api, { errMessage } from '../../api/api';
import Notice from '../ui/Notice';
import Modal from '../Modal';
import { qty, usd } from '../../pages/money/fmt';

// Adds a material to a ticket or project from the catalog (or the shelf).
export function PickMaterialModal({ url, onClose, onSaved }) {
  const [search, setSearch] = useState('');
  const [products, setProducts] = useState([]);
  const [productId, setProductId] = useState('');
  const [itemName, setItemName] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [fromStock, setFromStock] = useState(false);
  const [serials, setSerials] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    const t = setTimeout(() => api.get('/money/products/pick', { params: search ? { search } : {} }).then(({ data }) => setProducts(data.products)).catch(() => {}), 200);
    return () => clearTimeout(t);
  }, [search]);
  const product = products.find((p) => String(p.id) === String(productId));
  const save = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await api.post(url, {
        ...(product ? { catalogProductId: product.id } : { itemName }),
        quantity,
        fromStock: !!(product?.stocked && fromStock),
        serialNumber: serials.split(/[\s,]+/).filter(Boolean),
      });
      onSaved();
    } catch (err) { setError(errMessage(err)); }
  };
  return (
    <Modal title="Add material" onClose={onClose}>
      <form onSubmit={save} aria-label="Material" className="space-y-3">
        {error && <Notice tone="bad">{error}</Notice>}
        <label className="block text-sm">Find a product<input className="input mt-1" placeholder="Name or SKU" value={search} onChange={(e) => setSearch(e.target.value)} /></label>
        <label className="block text-sm">Product<select className="input mt-1" aria-label="Product" value={productId} onChange={(e) => { setProductId(e.target.value); setFromStock(!!products.find((p) => String(p.id) === e.target.value)?.stocked); }}>
          <option value="">Not in the catalog…</option>
          {products.map((p) => <option key={p.id} value={p.id}>{p.name}{p.stocked ? ` (${qty(p.onHand)} ${p.unit} on the shelf)` : ''}</option>)}
        </select></label>
        {!product && <label className="block text-sm">Item<input className="input mt-1" required maxLength={255} value={itemName} onChange={(e) => setItemName(e.target.value)} /></label>}
        <label className="block text-sm">{`Quantity${product ? ` (${product.unit})` : ''}`}<input className="input mt-1" required inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} /></label>
        {product?.stocked && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={fromStock} onChange={(e) => setFromStock(e.target.checked)} /> Taken from the shelf</label>}
        {(!product || product.serialized) && <label className="block text-sm">Serial numbers (optional)<input className="input mt-1" value={serials} onChange={(e) => setSerials(e.target.value)} /></label>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary">Add</button>
        </div>
      </form>
    </Modal>
  );
}

export default function MaterialsPanel({ ticketId, canEdit }) {
  const url = `/tickets/${ticketId}/materials`;
  const [rows, setRows] = useState(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const load = () => api.get(url).then(({ data }) => setRows(data.materials)).catch((err) => setError(errMessage(err)));
  useEffect(() => { load(); }, [ticketId]); // eslint-disable-line react-hooks/exhaustive-deps
  const prices = rows?.some((m) => 'unitCost' in m);
  const remove = async (m) => {
    if (!window.confirm(m.fromStock ? `Remove ${m.itemName}? It goes back on the shelf.` : `Remove ${m.itemName}?`)) return;
    try { await api.delete(`${url}/${m.id}`); load(); } catch (err) { setError(errMessage(err)); }
  };
  return (
    <section aria-labelledby="ticket-materials" className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 id="ticket-materials" className="text-sm font-semibold">Materials</h3>
        {canEdit && <button type="button" className="btn-secondary h-8 px-3 text-xs" onClick={() => setAdding(true)}>Add material</button>}
      </div>
      {error && <Notice tone="bad">{error}</Notice>}
      {rows && (
        <table className="min-w-full text-sm" data-testid="materials">
          <thead><tr>{['Item', 'Quantity', ...(prices ? ['Price'] : []), ''].map((h) => <th key={h} className="table-th">{h}</th>)}</tr></thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.id} className="border-t border-navy-100">
                <td className="table-td">{m.itemName}{m.fromStock && <span className="ml-2 text-xs text-navy-500">from the shelf</span>}{(m.serialNumber || []).length > 0 && <span className="ml-2 text-xs text-navy-500">{m.serialNumber.join(', ')}</span>}</td>
                <td className="table-td num">{qty(m.quantity)}</td>
                {prices && <td className="table-td num">{usd(m.totalPrice ?? m.totalCost)}</td>}
                <td className="table-td text-right">{canEdit && m.billingStatus !== 'billed' && <button type="button" className="text-xs" style={{ color: 'var(--color-danger)' }} onClick={() => remove(m)}>Remove</button>}</td>
              </tr>
            ))}
            {!rows.length && <tr><td className="table-td" colSpan={prices ? 4 : 3}>No materials yet.</td></tr>}
          </tbody>
        </table>
      )}
      {adding && <PickMaterialModal url={url} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load(); }} />}
    </section>
  );
}
