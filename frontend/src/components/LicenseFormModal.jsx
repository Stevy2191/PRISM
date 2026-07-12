import { useState } from 'react';
import api, { errMessage } from '../api/api';
import Modal from './Modal';
import { LICENSE_TYPE_LABELS } from '../pages/assets/Licenses';

const TEXT = 'var(--color-text-primary)';
const fieldStyle = { backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: TEXT };

function Label({ children, required }) {
  return (
    <label className="mb-1 block text-sm font-medium" style={{ color: TEXT }}>
      {children}{required && <span style={{ color: 'var(--color-danger)' }}> *</span>}
    </label>
  );
}

const DEFAULT_FORM = {
  name: '', vendor: '', licenseType: 'per_seat', totalSeats: '', licenseKey: '',
  purchaseDate: '', expiryDate: '', renewalDate: '', annualCost: '', autoRenews: false,
  departmentId: '', notes: '',
};

// Create/edit form for a License record — new (no `license` prop) or edit
// (pass the current license). `licenseKey` is write-only: blank on edit
// means "leave unchanged" (same convention as settings secret fields), so
// this never round-trips the actual key value even for a same-value re-save.
export default function LicenseFormModal({ license, departments, onClose, onSaved }) {
  const isEdit = !!license;
  const [form, setForm] = useState(() => {
    if (!license) return DEFAULT_FORM;
    const f = { ...DEFAULT_FORM };
    Object.keys(f).forEach((k) => {
      if (k === 'licenseKey') return;
      if (license[k] !== undefined && license[k] !== null) f[k] = license[k];
    });
    return f;
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) { setError('Name is required'); return; }
    setError('');
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        vendor: form.vendor || null,
        licenseType: form.licenseType,
        totalSeats: form.licenseType === 'site_license' ? null : (form.totalSeats === '' ? null : Number(form.totalSeats)),
        purchaseDate: form.purchaseDate || null,
        expiryDate: form.expiryDate || null,
        renewalDate: form.renewalDate || null,
        annualCost: form.annualCost === '' ? null : Number(form.annualCost),
        autoRenews: !!form.autoRenews,
        departmentId: form.departmentId || null,
        notes: form.notes || null,
      };
      if (form.licenseKey) payload.licenseKey = form.licenseKey;

      const { data } = isEdit
        ? await api.patch(`/licenses/${license.id}`, payload)
        : await api.post('/licenses', payload);
      onSaved(data.license);
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={isEdit ? 'Edit license' : 'New license'} onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-4">
        {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label required>Name</Label>
            <input className="input" style={fieldStyle} value={form.name} onChange={set('name')} placeholder="e.g. Microsoft 365" />
          </div>
          <div>
            <Label>Vendor</Label>
            <input className="input" style={fieldStyle} value={form.vendor} onChange={set('vendor')} />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label>License type</Label>
            <select className="input" style={fieldStyle} value={form.licenseType} onChange={set('licenseType')}>
              {Object.entries(LICENSE_TYPE_LABELS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
          </div>
          {form.licenseType !== 'site_license' && (
            <div>
              <Label>Total seats</Label>
              <input type="number" min="0" className="input" style={fieldStyle} value={form.totalSeats} onChange={set('totalSeats')} />
            </div>
          )}
        </div>

        <div>
          <Label>License key {isEdit && <span className="font-normal" style={{ color: 'var(--color-text-muted)' }}>(leave blank to keep current)</span>}</Label>
          <input type="password" autoComplete="new-password" className="input" style={fieldStyle} value={form.licenseKey} onChange={set('licenseKey')} placeholder={isEdit ? '••••••••' : ''} />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <Label>Purchase date</Label>
            <input type="date" className="input" style={fieldStyle} value={form.purchaseDate} onChange={set('purchaseDate')} />
          </div>
          <div>
            <Label>Expiry date</Label>
            <input type="date" className="input" style={fieldStyle} value={form.expiryDate} onChange={set('expiryDate')} />
          </div>
          <div>
            <Label>Renewal date</Label>
            <input type="date" className="input" style={fieldStyle} value={form.renewalDate} onChange={set('renewalDate')} />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label>Annual cost ($)</Label>
            <input type="number" min="0" step="0.01" className="input" style={fieldStyle} value={form.annualCost} onChange={set('annualCost')} />
          </div>
          <div>
            <Label>Department</Label>
            <select className="input" style={fieldStyle} value={form.departmentId} onChange={set('departmentId')}>
              <option value="">None</option>
              {(departments || []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm" style={{ color: TEXT }}>
          <input type="checkbox" checked={form.autoRenews} onChange={(e) => setForm((f) => ({ ...f, autoRenews: e.target.checked }))} className="h-4 w-4" />
          Auto-renews
        </label>

        <div>
          <Label>Notes</Label>
          <textarea className="input resize-y" style={{ ...fieldStyle, minHeight: '70px' }} value={form.notes} onChange={set('notes')} />
        </div>

        <div className="flex justify-end gap-2 border-t pt-4" style={{ borderColor: 'var(--color-border)' }}>
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="submit" disabled={saving} className="btn-primary">{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </Modal>
  );
}
