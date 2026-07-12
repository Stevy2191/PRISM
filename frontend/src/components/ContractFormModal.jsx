import { useState } from 'react';
import api, { errMessage } from '../api/api';
import Modal from './Modal';
import { CONTRACT_TYPE_LABELS } from '../pages/assets/Contracts';

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
  name: '', vendor: '', contractType: 'support',
  startDate: '', endDate: '', renewalDate: '',
  annualCost: '', totalValue: '', autoRenews: false,
  contactPerson: '', contactEmail: '', contactPhone: '',
  departmentId: '', notes: '',
};

export default function ContractFormModal({ contract, departments, onClose, onSaved }) {
  const isEdit = !!contract;
  const [form, setForm] = useState(() => {
    if (!contract) return DEFAULT_FORM;
    const f = { ...DEFAULT_FORM };
    Object.keys(f).forEach((k) => { if (contract[k] !== undefined && contract[k] !== null) f[k] = contract[k]; });
    return f;
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) { setError('Name is required'); return; }
    if (!form.vendor.trim()) { setError('Vendor is required'); return; }
    setError('');
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        vendor: form.vendor.trim(),
        contractType: form.contractType,
        startDate: form.startDate || null,
        endDate: form.endDate || null,
        renewalDate: form.renewalDate || null,
        annualCost: form.annualCost === '' ? null : Number(form.annualCost),
        totalValue: form.totalValue === '' ? null : Number(form.totalValue),
        autoRenews: !!form.autoRenews,
        contactPerson: form.contactPerson || null,
        contactEmail: form.contactEmail || null,
        contactPhone: form.contactPhone || null,
        departmentId: form.departmentId || null,
        notes: form.notes || null,
      };

      const { data } = isEdit
        ? await api.patch(`/contracts/${contract.id}`, payload)
        : await api.post('/contracts', payload);
      onSaved(data.contract);
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={isEdit ? 'Edit contract' : 'New contract'} onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-4">
        {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label required>Name</Label>
            <input className="input" style={fieldStyle} value={form.name} onChange={set('name')} placeholder="e.g. Cisco SmartNet Support" />
          </div>
          <div>
            <Label required>Vendor</Label>
            <input className="input" style={fieldStyle} value={form.vendor} onChange={set('vendor')} />
          </div>
        </div>

        <div>
          <Label>Contract type</Label>
          <select className="input max-w-xs" style={fieldStyle} value={form.contractType} onChange={set('contractType')}>
            {Object.entries(CONTRACT_TYPE_LABELS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <Label>Start date</Label>
            <input type="date" className="input" style={fieldStyle} value={form.startDate} onChange={set('startDate')} />
          </div>
          <div>
            <Label>End date</Label>
            <input type="date" className="input" style={fieldStyle} value={form.endDate} onChange={set('endDate')} />
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
            <Label>Total contract value ($)</Label>
            <input type="number" min="0" step="0.01" className="input" style={fieldStyle} value={form.totalValue} onChange={set('totalValue')} />
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm" style={{ color: TEXT }}>
          <input type="checkbox" checked={form.autoRenews} onChange={(e) => setForm((f) => ({ ...f, autoRenews: e.target.checked }))} className="h-4 w-4" />
          Auto-renews
        </label>

        <div className="border-t pt-4" style={{ borderColor: 'var(--color-border)' }}>
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-text-muted)' }}>Vendor contact</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <Label>Name</Label>
              <input className="input" style={fieldStyle} value={form.contactPerson} onChange={set('contactPerson')} />
            </div>
            <div>
              <Label>Email</Label>
              <input type="email" className="input" style={fieldStyle} value={form.contactEmail} onChange={set('contactEmail')} />
            </div>
            <div>
              <Label>Phone</Label>
              <input className="input" style={fieldStyle} value={form.contactPhone} onChange={set('contactPhone')} />
            </div>
          </div>
        </div>

        <div>
          <Label>Department</Label>
          <select className="input max-w-xs" style={fieldStyle} value={form.departmentId} onChange={set('departmentId')}>
            <option value="">None</option>
            {(departments || []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>

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
