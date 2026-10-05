// People tab and the Add person modal.
import { useState } from 'react';
import { IconX } from '@tabler/icons-react';
import { CARD_BG, BORDER, TEXT, MUTED, BLUE, fieldStyle } from '../theme';
import { Avatar } from './Bits';
import { Modal } from './Modal';

// ==================== People tab ====================
export function PeopleTab({ members, project, canManageMembers, onAdd, onRemove }) {
  const sorted = [...members].sort((a, b) => (a.userId === project.assignedToUserId ? -1 : b.userId === project.assignedToUserId ? 1 : 0));
  return (
    <div className="space-y-3">
      <div className="flex justify-end">{canManageMembers && <button onClick={onAdd} className="btn-primary">+ Add person</button>}</div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {sorted.map((m) => {
          const isLead = m.userId === project.assignedToUserId;
          return (
            <div key={m.id} className="relative flex items-center gap-3 rounded-[10px] border p-4" style={{ backgroundColor: CARD_BG, borderColor: BORDER }}>
              <Avatar name={m.user?.displayName} size={36} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium" style={{ color: TEXT }}>{m.user?.displayName}</p>
                <span className="text-xs font-medium" style={{ color: isLead ? BLUE : MUTED }}>{isLead ? 'Lead' : 'Member'}</span>
              </div>
              {canManageMembers && !isLead && (
                <button onClick={() => onRemove(m.userId)} className="absolute right-2 top-2" style={{ color: MUTED }}><IconX size={16} /></button>
              )}
            </div>
          );
        })}
        {members.length === 0 && <div className="col-span-full rounded-[10px] border p-8 text-center" style={{ backgroundColor: CARD_BG, borderColor: BORDER, color: MUTED }}>No members yet.</div>}
      </div>
    </div>
  );
}

export function AddPersonModal({ directory, existingIds, onClose, onSave }) {
  const [search, setSearch] = useState('');
  const [userId, setUserId] = useState('');
  const [role, setRole] = useState('member');
  const [saving, setSaving] = useState(false);

  const candidates = directory.filter((u) => !existingIds.includes(u.id) && u.displayName.toLowerCase().includes(search.toLowerCase()));

  const save = async () => {
    if (!userId) return;
    setSaving(true);
    try {
      await onSave({ userId, role });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Add person" onClose={onClose}>
      <label className="mb-1 block text-sm font-medium" style={{ color: TEXT }}>Search users</label>
      <input className="input mb-3" style={fieldStyle} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name…" autoFocus />
      <div className="mb-3 max-h-48 overflow-y-auto rounded-md border" style={{ borderColor: BORDER }}>
        {candidates.map((u) => (
          <button
            key={u.id}
            onClick={() => setUserId(u.id)}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm"
            style={{ backgroundColor: userId === u.id ? 'color-mix(in srgb, var(--color-accent) 12%, transparent)' : 'transparent', color: TEXT }}
          >
            <Avatar name={u.displayName} size={22} /> {u.displayName}
          </button>
        ))}
        {candidates.length === 0 && <p className="px-3 py-2 text-sm" style={{ color: MUTED }}>No matches.</p>}
      </div>
      <label className="mb-1 block text-sm font-medium" style={{ color: TEXT }}>Role</label>
      <select className="input mb-4" style={fieldStyle} value={role} onChange={(e) => setRole(e.target.value)}>
        <option value="member">Member</option>
        <option value="lead">Lead</option>
      </select>
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="rounded-md border px-4 py-2 text-sm font-medium" style={{ borderColor: BORDER, color: TEXT }}>Cancel</button>
        <button onClick={save} disabled={saving || !userId} className="rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" style={{ backgroundColor: BLUE }}>
          {saving ? 'Adding…' : 'Add'}
        </button>
      </div>
    </Modal>
  );
}
