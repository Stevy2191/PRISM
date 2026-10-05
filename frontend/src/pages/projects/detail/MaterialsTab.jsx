// Materials tab and the Add item modal.
import { useState } from 'react';
import { IconPlus, IconX } from '@tabler/icons-react';
import LoadMore from '../../../components/LoadMore';
import { CARD_BG, BORDER, TEXT, MUTED, BLUE, fieldStyle, formatCost } from '../theme';
import { Modal } from './Modal';

// ==================== Materials tab ====================
export function MaterialsTab({ data, canManageExpenses, onAdd, onDelete, onLoadMore }) {
  return (
    <div className="overflow-x-auto rounded-[10px] border" style={{ backgroundColor: CARD_BG, borderColor: BORDER }}>
      <div className="flex items-center justify-between border-b p-4" style={{ borderColor: BORDER }}>
        <h2 className="font-semibold" style={{ color: TEXT }}>Materials</h2>
        {canManageExpenses && <button onClick={onAdd} className="btn-primary">+ Add item</button>}
      </div>
      <table className="min-w-full">
        <thead>
          <tr>{['Item', 'Vendor', 'Model', 'Qty', 'Serials', 'Total cost', ''].map((h) => <th key={h} className="table-th" style={{ borderBottom: `1px solid ${BORDER}` }}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {data.materials.map((m) => (
            <tr key={m.id}>
              <td className="table-td font-medium" style={{ color: TEXT }}>{m.itemName}</td>
              <td className="table-td" style={{ color: MUTED }}>{m.vendor || '—'}</td>
              <td className="table-td" style={{ color: MUTED }}>{m.modelNumber || '—'}</td>
              <td className="table-td" style={{ color: MUTED }}>{m.quantity}</td>
              <td className="table-td" style={{ color: MUTED }}>{(m.serialNumber || []).join(', ') || '—'}</td>
              <td className="table-td font-medium" style={{ color: TEXT }}>{formatCost(m.totalCost)}</td>
              <td className="table-td">{canManageExpenses && <button onClick={() => onDelete(m.id)} className="text-xs" style={{ color: 'var(--color-danger)' }}>delete</button>}</td>
            </tr>
          ))}
          {data.materials.length === 0 && <tr><td colSpan={7} className="table-td" style={{ color: MUTED }}>No materials logged yet.</td></tr>}
        </tbody>
      </table>
      <LoadMore loaded={data.materials.length} total={data.total} onLoadMore={onLoadMore} noun="materials" />
      <div className="border-t p-4 text-right text-sm font-semibold" style={{ borderColor: BORDER, color: TEXT }}>Total: {formatCost(data.totalAmount)}</div>
    </div>
  );
}

export function AddMaterialModal({ tasks, onClose, onSave }) {
  const [itemName, setItemName] = useState('');
  const [vendor, setVendor] = useState('');
  const [modelNumber, setModelNumber] = useState('');
  const [serials, setSerials] = useState(['']);
  const [quantity, setQuantity] = useState(1);
  const [unitCost, setUnitCost] = useState('');
  const [taskId, setTaskId] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const setSerialAt = (i, val) => setSerials((s) => s.map((x, idx) => (idx === i ? val : x)));
  const addSerialField = () => setSerials((s) => [...s, '']);
  const removeSerialField = (i) => setSerials((s) => s.filter((_, idx) => idx !== i));

  const save = async () => {
    if (!itemName.trim()) return;
    setSaving(true);
    try {
      await onSave({
        itemName, vendor, modelNumber,
        serialNumber: serials.map((s) => s.trim()).filter(Boolean),
        quantity: Number(quantity) || 1,
        unitCost: Number(unitCost) || 0,
        taskId: taskId || null,
        notes,
      });
    } finally {
      setSaving(false);
    }
  };

  const total = (Number(quantity) || 0) * (Number(unitCost) || 0);

  return (
    <Modal title="Add material" onClose={onClose}>
      <label className="mb-1 block text-sm font-medium" style={{ color: TEXT }}>Item name</label>
      <input className="input mb-3" style={fieldStyle} value={itemName} onChange={(e) => setItemName(e.target.value)} autoFocus />
      <div className="mb-3 grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-sm font-medium" style={{ color: TEXT }}>Vendor</label>
          <input className="input" style={fieldStyle} value={vendor} onChange={(e) => setVendor(e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium" style={{ color: TEXT }}>Model number</label>
          <input className="input" style={fieldStyle} value={modelNumber} onChange={(e) => setModelNumber(e.target.value)} />
        </div>
      </div>
      <label className="mb-1 block text-sm font-medium" style={{ color: TEXT }}>Serial numbers (optional)</label>
      <div className="mb-3 space-y-2">
        {serials.map((s, i) => (
          <div key={i} className="flex gap-2">
            <input className="input h-9 flex-1 text-sm" style={fieldStyle} value={s} onChange={(e) => setSerialAt(i, e.target.value)} />
            {serials.length > 1 && <button onClick={() => removeSerialField(i)} style={{ color: 'var(--color-danger)' }}><IconX size={16} /></button>}
          </div>
        ))}
        <button onClick={addSerialField} className="flex items-center gap-1 text-xs font-medium" style={{ color: BLUE }}><IconPlus size={12} /> Add another serial</button>
      </div>
      <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label className="mb-1 block text-sm font-medium" style={{ color: TEXT }}>Quantity</label>
          <input type="number" min="1" className="input" style={fieldStyle} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium" style={{ color: TEXT }}>Unit cost ($)</label>
          <input type="number" min="0" step="0.01" className="input" style={fieldStyle} value={unitCost} onChange={(e) => setUnitCost(e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium" style={{ color: TEXT }}>Total cost</label>
          <div className="input flex items-center font-mono" style={fieldStyle}>{formatCost(total)}</div>
        </div>
      </div>
      <label className="mb-1 block text-sm font-medium" style={{ color: TEXT }}>Task link (optional)</label>
      <select className="input mb-3" style={fieldStyle} value={taskId} onChange={(e) => setTaskId(e.target.value)}>
        <option value="">None</option>
        {tasks.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
      </select>
      <label className="mb-1 block text-sm font-medium" style={{ color: TEXT }}>Notes</label>
      <textarea className="input mb-4 resize-y" style={{ ...fieldStyle, minHeight: '50px' }} value={notes} onChange={(e) => setNotes(e.target.value)} />
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="rounded-md border px-4 py-2 text-sm font-medium" style={{ borderColor: BORDER, color: TEXT }}>Cancel</button>
        <button onClick={save} disabled={saving || !itemName.trim()} className="rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" style={{ backgroundColor: BLUE }}>
          {saving ? 'Saving…' : 'Add item'}
        </button>
      </div>
    </Modal>
  );
}
