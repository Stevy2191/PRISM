// A project task's detail modal, with its subtasks.
import { useState } from 'react';
import { IconX } from '@tabler/icons-react';
import api, { errMessage } from '../../../api/api';
import { Modal } from './Modal';
import { EditableCode } from './Bits';
import { BORDER, TEXT, MUTED, BLUE, fieldStyle, PRIORITY_META } from '../theme';

export function TaskDetailModal({ projectId, task, statuses, assignableUsers, onClose, onChanged, onDeleted }) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description || '');
  const [statusId, setStatusId] = useState(task.statusId);
  const [priority, setPriority] = useState(task.priority);
  const [assignedToUserId, setAssignedToUserId] = useState(task.assigneeId || '');
  const [dueDate, setDueDate] = useState(task.dueDate || '');
  const [subtasks, setSubtasks] = useState(task.subtasks || []);
  const [newSubtask, setNewSubtask] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await api.patch(`/projects/${projectId}/tasks/${task.id}`, {
        title, description, statusId, priority, assigneeId: assignedToUserId || null, dueDate: dueDate || null,
      });
      await onChanged();
      onClose();
    } catch (err) {
      alert(errMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const addSubtask = async () => {
    if (!newSubtask.trim()) return;
    const { data } = await api.post(`/projects/${projectId}/tasks/${task.id}/subtasks`, { title: newSubtask.trim() });
    setSubtasks((s) => [...s, data.subtask]);
    setNewSubtask('');
    onChanged();
  };
  const toggleSubtask = async (st) => {
    const isClosed = statuses.find((s) => s.id === st.statusId)?.behaviorType === 'closed';
    const target = statuses.find((s) => s.behaviorType === (isClosed ? 'open' : 'closed'));
    if (!target) return;
    const { data } = await api.patch(`/projects/${projectId}/tasks/${task.id}/subtasks/${st.id}`, { statusId: target.id });
    setSubtasks((s) => s.map((x) => (x.id === st.id ? data.subtask : x)));
    onChanged();
  };
  const removeSubtask = async (stId) => {
    await api.delete(`/projects/${projectId}/tasks/${task.id}/subtasks/${stId}`);
    setSubtasks((s) => s.filter((x) => x.id !== stId));
    onChanged();
  };

  const renumberTask = async (number) => {
    await api.patch(`/projects/${projectId}/tasks/${task.id}/code`, { number });
    await onChanged();
  };
  const renumberSubtask = async (st, number) => {
    const { data } = await api.patch(`/projects/${projectId}/tasks/${task.id}/subtasks/${st.id}/code`, { number });
    setSubtasks((s) => s.map((x) => (x.id === st.id ? data.subtask : x)));
    onChanged();
  };

  return (
    <Modal title="Task details" onClose={onClose} wide>
      {task.code && (
        <div className="mb-3">
          <EditableCode code={task.code} letter="T" onRename={renumberTask} />
        </div>
      )}
      <label className="mb-1 block text-sm font-medium" style={{ color: TEXT }}>Title</label>
      <input className="input mb-3" style={fieldStyle} value={title} onChange={(e) => setTitle(e.target.value)} />
      <label className="mb-1 block text-sm font-medium" style={{ color: TEXT }}>Description</label>
      <textarea className="input mb-3 resize-y" style={{ ...fieldStyle, minHeight: '70px' }} value={description} onChange={(e) => setDescription(e.target.value)} />
      <div className="mb-3 grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-sm font-medium" style={{ color: TEXT }}>Status</label>
          <select className="input" style={fieldStyle} value={statusId} onChange={(e) => setStatusId(Number(e.target.value))}>
            {statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium" style={{ color: TEXT }}>Priority</label>
          <select className="input" style={fieldStyle} value={priority} onChange={(e) => setPriority(e.target.value)}>
            {Object.entries(PRIORITY_META).map(([v, m]) => <option key={v} value={v}>{m.label}</option>)}
          </select>
        </div>
      </div>
      <div className="mb-4 grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-sm font-medium" style={{ color: TEXT }}>Assignee</label>
          <select className="input" style={fieldStyle} value={assignedToUserId} onChange={(e) => setAssignedToUserId(e.target.value)}>
            <option value="">Unassigned</option>
            {assignableUsers.map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium" style={{ color: TEXT }}>Due date</label>
          <input type="date" className="input" style={fieldStyle} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </div>
      </div>

      <div className="mb-4 rounded-md border p-3" style={{ borderColor: BORDER }}>
        <p className="mb-2 text-sm font-semibold" style={{ color: TEXT }}>Subtasks</p>
        <ul className="mb-2 space-y-1.5">
          {subtasks.map((st) => (
            <li key={st.id} className="flex flex-wrap items-center gap-2 text-sm">
              <input type="checkbox" checked={!!st.completedAt} onChange={() => toggleSubtask(st)} className="h-4 w-4" />
              {st.code && <EditableCode code={st.code} letter="S" onRename={(n) => renumberSubtask(st, n)} />}
              <span className="flex-1" style={{ color: st.completedAt ? MUTED : TEXT, textDecoration: st.completedAt ? 'line-through' : 'none' }}>{st.title}</span>
              <button onClick={() => removeSubtask(st.id)} style={{ color: 'var(--color-danger)' }}><IconX size={14} /></button>
            </li>
          ))}
          {subtasks.length === 0 && <li className="text-sm" style={{ color: MUTED }}>No subtasks.</li>}
        </ul>
        <div className="flex gap-2">
          <input
            className="input h-9 flex-1 text-sm"
            style={fieldStyle}
            placeholder="Add a subtask…"
            value={newSubtask}
            onChange={(e) => setNewSubtask(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addSubtask(); } }}
          />
          <button onClick={addSubtask} className="rounded-md border px-3 text-sm font-medium" style={{ borderColor: BORDER, color: TEXT }}>Add</button>
        </div>
      </div>

      <div className="flex justify-between gap-2">
        <button onClick={onDeleted} className="rounded-md border px-4 py-2 text-sm font-medium" style={{ borderColor: 'var(--color-danger)', color: 'var(--color-danger)' }}>Delete task</button>
        <div className="flex gap-2">
          <button onClick={onClose} className="rounded-md border px-4 py-2 text-sm font-medium" style={{ borderColor: BORDER, color: TEXT }}>Close</button>
          <button onClick={save} disabled={saving} className="rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" style={{ backgroundColor: BLUE }}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
