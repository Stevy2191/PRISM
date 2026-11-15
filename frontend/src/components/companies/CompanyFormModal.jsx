import { useState } from 'react';
import Notice from '../ui/Notice';
import api, { errMessage } from '../../api/api';
import Modal from '../Modal';
import { formatPhone } from '../../utils/formatPhone';
import { suggestCode, cleanCode } from '../../utils/codes';

// Creates a company: a client, a vendor, or both.
export default function CompanyFormModal({ onClose, onSaved }) {
  const [form, setForm] = useState({
    name: '', code: '', isClient: true, isVendor: false, phone: '', website: '',
  });
  // The code follows the name until someone types their own (CN).
  const [codeTouched, setCodeTouched] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) { setError('Name is required'); return; }
    if (!form.isClient && !form.isVendor) { setError('A company is a client, a vendor, or both'); return; }
    setSaving(true);
    try {
      const { data } = await api.post('/companies', {
        name: form.name.trim(), code: form.code || undefined, isClient: form.isClient, isVendor: form.isVendor,
        phone: form.phone || null, website: form.website || null,
      });
      onSaved(data.company);
    } catch (err) {
      setError(errMessage(err));
      setSaving(false);
    }
  };

  return (
    <Modal title="New company" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {error && <Notice tone="bad">{error}</Notice>}
        <div className="flex flex-wrap gap-3">
          <div className="min-w-0 flex-[1_1_220px]">
            <label className="label" htmlFor="company-name">Name</label>
            <input id="company-name" className="input" value={form.name} onChange={(e) => { const name = e.target.value; setForm((f) => ({ ...f, name, code: codeTouched ? f.code : suggestCode(name) })); }} autoFocus />
          </div>
          <div className="w-28">
            <label className="label" htmlFor="company-code">Code</label>
            <input id="company-code" className="input font-mono" value={form.code} onChange={(e) => { setCodeTouched(true); setForm((f) => ({ ...f, code: cleanCode(e.target.value) })); }} placeholder="WC" />
          </div>
        </div>
        {form.code && <p className="-mt-2 text-xs text-navy-500">Its tickets will be {form.code}-T0001, {form.code}-T0002…</p>}
        <div className="flex gap-6 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked={form.isClient} onChange={set('isClient')} /> Client</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={form.isVendor} onChange={set('isVendor')} /> Vendor</label>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div><label className="label" htmlFor="company-phone">Phone</label><input id="company-phone" className="input" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: formatPhone(e.target.value) }))} placeholder="(555) 123-4567" inputMode="tel" /></div>
          <div><label className="label" htmlFor="company-website">Website</label><input id="company-website" className="input" value={form.website} onChange={set('website')} placeholder="https://" /></div>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Creating…' : 'Create company'}</button>
        </div>
      </form>
    </Modal>
  );
}
