// Tasks tab (the ticket checklist).
import { useState } from 'react';
import { CARD_BG, BORDER, TEXT, MUTED, fieldStyle } from '../theme';

// ---- Tasks tab ----

export function TasksTab({ tasks, assignableUsers, onToggle, onReassign, onAdd }) {
  const [text, setText] = useState('');
  return (
    <div>
      <ul className="space-y-2">
        {tasks.map((t) => (
          <li key={t.id} className="flex items-center gap-3 rounded-[10px] border p-3" style={{ borderColor: BORDER, backgroundColor: CARD_BG }}>
            <input type="checkbox" checked={t.completed} onChange={() => onToggle(t)} className="h-4 w-4 accent-blue-500" />
            <span
              className="flex-1 text-sm"
              style={{ color: t.completed ? MUTED : TEXT, textDecoration: t.completed ? 'line-through' : 'none' }}
            >
              {t.description}
            </span>
            <select
              value={t.assigneeId || ''}
              onChange={(e) => onReassign(t, e.target.value || null)}
              className="input h-8 max-w-[9rem] text-xs"
              style={fieldStyle}
            >
              <option value="">Unassigned</option>
              {assignableUsers.map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}
            </select>
          </li>
        ))}
        {tasks.length === 0 && <p className="text-sm" style={{ color: MUTED }}>No tasks yet.</p>}
      </ul>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && text.trim()) { e.preventDefault(); onAdd(text.trim()); setText(''); }
        }}
        placeholder="Add a task and press Enter…"
        className="input mt-3"
        style={fieldStyle}
      />
    </div>
  );
}
