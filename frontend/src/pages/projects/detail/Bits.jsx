// Small pieces of the project page: avatar, stat card, editable code, drop line.
import { useState } from 'react';
import { IconPencil } from '@tabler/icons-react';
import { errMessage } from '../../../api/api';
import { initials } from '../../../utils/userDisplay';
import { CARD_BG, BORDER, TEXT, MUTED, BLUE } from '../theme';

export function Avatar({ name, size = 24 }) {
  if (!name) return <span className="text-sm" style={{ color: MUTED }}>Unassigned</span>;
  return (
    <span
      title={name}
      className="flex flex-shrink-0 items-center justify-center rounded-full text-[10px] font-semibold"
      style={{ width: size, height: size, backgroundColor: 'var(--color-accent)', color: 'white' }}
    >
      {initials(name)}
    </span>
  );
}

export function StatCard({ label, value, color }) {
  return (
    <div className="rounded-[10px] border p-4" style={{ backgroundColor: CARD_BG, borderColor: BORDER }}>
      <p className="text-xs font-medium uppercase tracking-wide" style={{ color: MUTED }}>{label}</p>
      <p className="mt-1 text-2xl font-bold tracking-tight" style={{ color }}>{value}</p>
    </div>
  );
}

// Small inline-editable chip for a taskCode/subtaskCode's trailing number
// (e.g. the "04" in "IT-P00001-T04"). Click to edit, Enter/blur to save,
// Escape to cancel. Conflicts surface the backend's inline error message.
export function EditableCode({ code, letter, onRename, disabled }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const match = new RegExp(`-${letter}(\\d+)$`).exec(code || '');
  const currentNumber = match ? match[1] : '';
  const prefix = match ? code.slice(0, match.index) : code;

  const startEdit = (e) => {
    e.stopPropagation();
    if (disabled) return;
    setValue(currentNumber);
    setError('');
    setEditing(true);
  };

  const save = async () => {
    const num = parseInt(value, 10);
    if (!Number.isFinite(num) || num < 1 || num > 99) {
      setError('Enter a number between 1 and 99');
      return;
    }
    if (num === parseInt(currentNumber, 10)) { setEditing(false); return; }
    setSaving(true);
    setError('');
    try {
      await onRename(num);
      setEditing(false);
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <span className="inline-flex flex-col gap-0.5" onClick={(e) => e.stopPropagation()}>
        <span className="inline-flex items-center gap-1">
          <span className="font-mono text-xs" style={{ color: MUTED }}>{prefix}-{letter}</span>
          <input
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value.replace(/\D/g, '').slice(0, 2))}
            onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }}
            onBlur={save}
            disabled={saving}
            className="w-9 rounded border px-1 py-0.5 font-mono text-xs"
            style={{ borderColor: BLUE, color: TEXT, backgroundColor: 'var(--color-input-bg)' }}
          />
        </span>
        {error && <span className="text-xs" style={{ color: 'var(--color-danger)' }}>{error}</span>}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={startEdit}
      disabled={disabled}
      className="group/code inline-flex items-center gap-1 font-mono text-xs hover:opacity-75 disabled:cursor-default"
      style={{ color: MUTED }}
      title={disabled ? undefined : 'Click to renumber'}
    >
      {code}
      {!disabled && <IconPencil size={11} className="opacity-0 transition-opacity group-hover/code:opacity-100" />}
    </button>
  );
}

// Thin animated line marking exactly where a dragged task will land.
export function DropLine() {
  return <div className="drop-line my-1 h-0.5 rounded-full" style={{ backgroundColor: BLUE }} />;
}
