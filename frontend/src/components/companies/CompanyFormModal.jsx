import { useState } from 'react';
import api, { errMessage } from '../../api/api';
import Modal from '../Modal';

// Creates a company: a client, a vendor, or both.
export default function CompanyFormModal({ onClose, onSaved }) {
  const [form, setForm] = useState({ name: '', isClient: true, isVendor: false, phone: '', website: '' });
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
        name: form.name.trim(), isClient: form.isClient, isVendor: form.isVendor,
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
        {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        <div>
          <label className="label" htmlFor="company-name">Name</label>
          <input id="company-name" className="input" value={form.name} onChange={set('name')} autoFocus />
        </div>
        <div className="flex gap-6 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked={form.isClient} onChange={set('isClient')} /> Client</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={form.isVendor} onChange={set('isVendor')} /> Vendor</label>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div><label className="label" htmlFor="company-phone">Phone</label><input id="company-phone" className="input" value={form.phone} onChange={set('phone')} /></div>
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
