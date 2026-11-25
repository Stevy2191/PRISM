// Settings → Money → Products and services (Phase 3): what you sell or buy,
// what one unit costs and sells for. A product bought by the box and used by
// the foot says how many feet a box holds.
import { useEffect, useState } from 'react';
import api, { errMessage } from '../../../api/api';
import { usePermission } from '../../../context/AuthContext';
import Spinner from '../../../components/Spinner';
import Notice from '../../../components/ui/Notice';
import SettingsPage, { SettingsPanel } from '../../../components/settings/SettingsPage';

const KINDS = [['product', 'Product'], ['service', 'Service'], ['labor', 'Labor'], ['license', 'License'], ['fee', 'Fee']];
const BLANK = {
  name: '', sku: '', kind: 'product', unit: 'each', cost: '', price: '', markupPercent: '', purchaseUnit: '', usagePerPurchase: '1', taxCategoryId: '', stocked: false, serialized: false,
};
const money4 = (v) => (v === null || v === undefined ? '—' : `$${Number(v).toFixed(Number(v) < 1 ? 4 : 2)}`);

export default function ProductsSettings() {
  const canEdit = usePermission('money.rates.manage');
  const [products, setProducts] = useState(null);
  const [cats, setCats] = useState([]);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState(null); // null, or a product being added/edited
  const [error, setError] = useState('');
  const load = () => api.get('/money/products', { params: search ? { search } : {} })
    .then(({ data }) => setProducts(data.products)).catch((err) => setError(errMessage(err)));
  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); }, [search]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { api.get('/money/tax-categories').then(({ data }) => setCats(data.taxCategories)).catch(() => {}); }, []);

  const save = async (e) => {
    e.preventDefault();
    setError('');
    const body = {
      ...form,
      sku: form.sku || null,
      cost: form.cost === '' ? null : form.cost,
      price: form.price === '' ? null : form.price,
      markupPercent: form.markupPercent === '' ? null : form.markupPercent,
      purchaseUnit: form.purchaseUnit || null,
      taxCategoryId: form.taxCategoryId ? Number(form.taxCategoryId) : null,
    };
    delete body.id;
    try {
      if (form.id) await api.patch(`/money/products/${form.id}`, body);
      else await api.post('/money/products', body);
      setForm(null);
      load();
    } catch (err) { setError(errMessage(err)); }
  };
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  if (!products) return error ? <Notice tone="bad">{error}</Notice> : <Spinner />;
  return (
    <SettingsPage width="wide" actions={canEdit && <button type="button" className="btn-primary" onClick={() => setForm({ ...BLANK })}>Add product</button>}>
      {error && <Notice tone="bad">{error}</Notice>}
      {form && (
        <SettingsPanel title={form.id ? `Edit ${form.name}` : 'Add a product or service'}>
          <form className="grid grid-cols-1 gap-3 px-5 py-4 sm:grid-cols-3" onSubmit={save} aria-label="Product">
            <label className="text-sm sm:col-span-2">Name<input className="input mt-1" required maxLength={255} value={form.name} onChange={set('name')} /></label>
            <label className="text-sm">SKU<input className="input mt-1" maxLength={100} value={form.sku || ''} onChange={set('sku')} /></label>
            <label className="text-sm">Kind<select className="input mt-1" value={form.kind} onChange={set('kind')}>{KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
            <label className="text-sm">Sold per (unit)<input className="input mt-1" maxLength={20} value={form.unit} onChange={set('unit')} /></label>
            <label className="text-sm">Tax category<select className="input mt-1" value={form.taxCategoryId || ''} onChange={set('taxCategoryId')}><option value="">None</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
            <label className="text-sm">Bought per (unit, if different)<input className="input mt-1" maxLength={20} placeholder="box" value={form.purchaseUnit || ''} onChange={set('purchaseUnit')} /></label>
            <label className="text-sm">{`${form.unit || 'units'} in one ${form.purchaseUnit || 'purchase'}`}<input className="input mt-1" inputMode="decimal" value={form.usagePerPurchase} onChange={set('usagePerPurchase')} /></label>
            <label className="text-sm">{`Cost per ${form.purchaseUnit || form.unit || 'unit'} ($)`}<input className="input mt-1" inputMode="decimal" value={form.cost ?? ''} onChange={set('cost')} /></label>
            <label className="text-sm">{`Price per ${form.unit || 'unit'} ($, leave empty to use cost + markup)`}<input className="input mt-1" inputMode="decimal" value={form.price ?? ''} onChange={set('price')} /></label>
            <label className="text-sm">Markup (%, empty = the default)<input className="input mt-1" inputMode="decimal" value={form.markupPercent ?? ''} onChange={set('markupPercent')} /></label>
            <div className="flex items-center gap-4 text-sm">
              <label className="flex items-center gap-1"><input type="checkbox" checked={!!form.stocked} onChange={set('stocked')} /> Kept in stock</label>
              <label className="flex items-center gap-1"><input type="checkbox" checked={!!form.serialized} onChange={set('serialized')} /> Has serial numbers</label>
            </div>
            <div className="flex gap-2 sm:col-span-3">
              <button type="submit" className="btn-primary">Save</button>
              <button type="button" className="btn-secondary" onClick={() => setForm(null)}>Cancel</button>
            </div>
          </form>
        </SettingsPanel>
      )}
      <SettingsPanel title="Products and services" actions={<input className="input w-auto" placeholder="Search" aria-label="Search products" value={search} onChange={(e) => setSearch(e.target.value)} />}>
        <table className="min-w-full text-sm" data-testid="products">
          <thead><tr>{['Name', 'Kind', 'Cost', 'Price', ''].map((h) => <th key={h} className="table-th">{h}</th>)}</tr></thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.id} className="border-t" style={{ borderColor: 'var(--color-border)' }}>
                <td className="table-td font-medium">{p.name}{p.sku && <span className="ml-2 text-xs" style={{ color: 'var(--color-text-muted)' }}>{p.sku}</span>}</td>
                <td className="table-td">{KINDS.find(([v]) => v === p.kind)?.[1]}</td>
                <td className="table-td">{p.usageCost === null ? '—' : `${money4(p.usageCost)}/${p.unit}`}</td>
                <td className="table-td">{`${money4(p.unitPrice)}/${p.unit}`}</td>
                <td className="table-td text-right">{canEdit && <button type="button" className="btn-secondary h-8 px-3 text-xs" onClick={() => setForm({ ...BLANK, ...p, taxCategoryId: p.taxCategoryId || '' })}>Edit</button>}</td>
              </tr>
            ))}
            {!products.length && <tr><td className="table-td" colSpan={5}>No products yet.</td></tr>}
          </tbody>
        </table>
      </SettingsPanel>
    </SettingsPage>
  );
}
