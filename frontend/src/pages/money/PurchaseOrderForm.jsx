// A purchase order: the vendor, the job it's for (or the shelf), and lines
// from the catalog. A stocked product can go on the shelf instead of the job.
import { useEffect, useState } from 'react';
import api, { errMessage } from '../../api/api';
import Modal from '../../components/Modal';
import Notice from '../../components/ui/Notice';
import VendorPicker from './VendorPicker';
import { usd } from './fmt';

const blank = () => ({ catalogProductId: '', description: '', quantity: '1', unitCost: '', forStock: false });

export default function PurchaseOrderForm({ job, onClose, onSaved }) {
  const [vendorCompanyId, setVendor] = useState(null);
  const [jobKind, setJobKind] = useState(job?.ticketId ? 'ticket' : job?.projectId ? 'project' : 'shelf');
  const [jobId, setJobId] = useState(job?.ticketId || job?.projectId || '');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState([blank()]);
  const [products, setProducts] = useState([]);
  const [error, setError] = useState('');
  useEffect(() => { api.get('/money/products').then(({ data }) => setProducts(data.products.filter((p) => p.kind === 'product'))).catch(() => {}); }, []);
  const productOf = (id) => products.find((p) => String(p.id) === String(id));
  const setLine = (i, patch) => setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const pickProduct = (i, id) => {
    const p = productOf(id);
    setLine(i, { catalogProductId: id, unitCost: p?.cost ?? '', forStock: jobKind === 'shelf' ? !!p?.stocked : false });
  };
  const total = lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unitCost) || 0), 0);

  const save = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const { data } = await api.post('/money/purchase-orders', {
        vendorCompanyId,
        ...(jobKind === 'ticket' && jobId ? { ticketId: Number(jobId) } : {}),
        ...(jobKind === 'project' && jobId ? { projectId: Number(jobId) } : {}),
        notes: notes || undefined,
        lines: lines.map((l) => ({
          catalogProductId: l.catalogProductId ? Number(l.catalogProductId) : undefined,
          description: l.description || undefined,
          quantity: l.quantity,
          unitCost: l.unitCost === '' ? undefined : String(l.unitCost),
          forStock: jobKind === 'shelf' ? true : l.forStock,
        })),
      });
      onSaved(data.purchaseOrder);
    } catch (err) { setError(errMessage(err)); }
  };

  return (
    <Modal title="New purchase order" onClose={onClose} wide>
      <form onSubmit={save} aria-label="Purchase order" className="space-y-4">
        {error && <Notice tone="bad">{error}</Notice>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <VendorPicker required value={vendorCompanyId} onChange={setVendor} />
          <label className="text-sm">For<select className="input mt-1" aria-label="For" value={jobKind} onChange={(e) => setJobKind(e.target.value)}>
            <option value="shelf">The shelf (stock)</option><option value="ticket">A ticket</option><option value="project">A project</option>
          </select></label>
          {jobKind !== 'shelf' && <label className="text-sm">{jobKind === 'ticket' ? 'Ticket ID' : 'Project ID'}<input className="input mt-1" required inputMode="numeric" value={jobId} onChange={(e) => setJobId(e.target.value.replace(/\D/g, ''))} /></label>}
        </div>
        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold">Items</legend>
          {lines.map((l, i) => {
            const p = productOf(l.catalogProductId);
            return (
              <div key={i} role="group" aria-label={`Item ${i + 1}`} className="grid grid-cols-1 gap-2 rounded-md border border-navy-100 p-3 sm:grid-cols-6">
                <label className="text-xs sm:col-span-3">Product<select className="input mt-1" aria-label="Product" value={l.catalogProductId} onChange={(e) => pickProduct(i, e.target.value)}>
                  <option value="">Not in the catalog…</option>
                  {products.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select></label>
                {!l.catalogProductId && <label className="text-xs sm:col-span-3">What is it?<input className="input mt-1" required maxLength={500} value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} /></label>}
                <label className="text-xs">{`Quantity${p?.purchaseUnit ? ` (${p.purchaseUnit})` : ''}`}<input className="input mt-1" required inputMode="decimal" value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} /></label>
                <label className="text-xs">Unit cost ($)<input className="input mt-1" inputMode="decimal" value={l.unitCost ?? ''} onChange={(e) => setLine(i, { unitCost: e.target.value })} /></label>
                {jobKind !== 'shelf' && p?.stocked && <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={l.forStock} onChange={(e) => setLine(i, { forStock: e.target.checked })} /> For the shelf</label>}
                {lines.length > 1 && <button type="button" className="self-end text-xs" style={{ color: 'var(--color-danger)' }} onClick={() => setLines(lines.filter((_, idx) => idx !== i))}>Remove</button>}
              </div>
            );
          })}
          <button type="button" className="btn-secondary h-8 px-3 text-xs" onClick={() => setLines([...lines, blank()])}>Add an item</button>
        </fieldset>
        <label className="block text-sm">Notes<textarea className="input mt-1" maxLength={5000} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold">Total {usd(total)}</span>
          <div className="flex gap-2">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary">Save purchase order</button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
