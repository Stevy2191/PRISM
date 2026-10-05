// Expenses tab and the Add expense modal.
import { useState } from 'react';
import LoadMore from '../../../components/LoadMore';
import { CARD_BG, BORDER, TEXT, MUTED, BLUE, fieldStyle, formatCost, todayStr } from '../theme';
import { Modal } from './Modal';

// ==================== Expenses tab ====================
const EXPENSE_CATEGORIES = ['materials', 'labor', 'travel', 'equipment', 'other'];

export function ExpensesTab({ data, canManageExpenses, onAdd, onDelete, onLoadMore }) {
  return (
    <div className="overflow-x-auto rounded-[10px] border" style={{ backgroundColor: CARD_BG, borderColor: BORDER }}>
      <div className="flex items-center justify-between border-b p-4" style={{ borderColor: BORDER }}>
        <h2 className="font-semibold" style={{ color: TEXT }}>Expenses</h2>
        {canManageExpenses && <button onClick={onAdd} className="btn-primary">+ Add expense</button>}
      </div>
      <table className="min-w-full">
        <thead>
          <tr>{['Description', 'Category', 'Task', 'Logged by', 'Date', 'Amount', ''].map((h) => <th key={h} className="table-th" style={{ borderBottom: `1px solid ${BORDER}` }}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {data.expenses.map((e) => (
            <tr key={e.id}>
              <td className="table-td" style={{ color: TEXT }}>{e.description}</td>
              <td className="table-td"><span className="rounded-[3px] px-2 py-0.5 text-xs font-medium capitalize" style={{ backgroundColor: BORDER, color: TEXT }}>{e.category}</span></td>
              <td className="table-td" style={{ color: MUTED }}>{e.task?.title || '—'}</td>
              <td className="table-td" style={{ color: MUTED }}>{e.loggedByUser?.displayName || '—'}</td>
              <td className="table-td" style={{ color: MUTED }}>{e.entryDate}</td>
              <td className="table-td font-medium" style={{ color: TEXT }}>{formatCost(e.amount)}</td>
              <td className="table-td">{canManageExpenses && <button onClick={() => onDelete(e.id)} className="text-xs" style={{ color: 'var(--color-danger)' }}>delete</button>}</td>
            </tr>
          ))}
          {data.expenses.length === 0 && <tr><td colSpan={7} className="table-td" style={{ color: MUTED }}>No expenses yet.</td></tr>}
        </tbody>
      </table>
      <LoadMore loaded={data.expenses.length} total={data.total} onLoadMore={onLoadMore} noun="expenses" />
      {/* totalAmount is the project's whole spend; `total` is the row count. */}
      <div className="border-t p-4 text-right text-sm font-semibold" style={{ borderColor: BORDER, color: TEXT }}>Total: {formatCost(data.totalAmount)}</div>
    </div>
  );
}

export function AddExpenseModal({ tasks, onClose, onSave }) {
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('other');
  const [entryDate, setEntryDate] = useState(todayStr());
  const [taskId, setTaskId] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!description.trim() || !amount) return;
    setSaving(true);
    try {
      await onSave({ description, amount: Number(amount), category, entryDate, taskId: taskId || null, notes });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Add expense" onClose={onClose}>
      <label className="mb-1 block text-sm font-medium" style={{ color: TEXT }}>Description</label>
      <input className="input mb-3" style={fieldStyle} value={description} onChange={(e) => setDescription(e.target.value)} autoFocus />
      <div className="mb-3 grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-sm font-medium" style={{ color: TEXT }}>Amount ($)</label>
          <input type="number" min="0" step="0.01" className="input" style={fieldStyle} value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium" style={{ color: TEXT }}>Category</label>
          <select className="input" style={fieldStyle} value={category} onChange={(e) => setCategory(e.target.value)}>
            {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c} className="capitalize">{c[0].toUpperCase() + c.slice(1)}</option>)}
          </select>
        </div>
      </div>
      <div className="mb-3 grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-sm font-medium" style={{ color: TEXT }}>Date</label>
          <input type="date" className="input" style={fieldStyle} value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium" style={{ color: TEXT }}>Task (optional)</label>
          <select className="input" style={fieldStyle} value={taskId} onChange={(e) => setTaskId(e.target.value)}>
            <option value="">None</option>
            {tasks.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
          </select>
        </div>
      </div>
      <label className="mb-1 block text-sm font-medium" style={{ color: TEXT }}>Notes</label>
      <textarea className="input mb-4 resize-y" style={{ ...fieldStyle, minHeight: '50px' }} value={notes} onChange={(e) => setNotes(e.target.value)} />
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="rounded-md border px-4 py-2 text-sm font-medium" style={{ borderColor: BORDER, color: TEXT }}>Cancel</button>
        <button onClick={save} disabled={saving || !description.trim() || !amount} className="rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" style={{ backgroundColor: BLUE }}>
          {saving ? 'Saving…' : 'Add expense'}
        </button>
      </div>
    </Modal>
  );
}
