// Tasks tab: the drag-reorderable task list and the Add task modal.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  IconGripVertical,
  IconChevronDown,
  IconChevronRight,
  IconLink,
  IconChevronUp,
} from '@tabler/icons-react';
import api from '../../../api/api';
import { formatTicketId } from '../../../utils/ticketId';
import { CARD_BG, BORDER, TEXT, MUTED, BLUE, fieldStyle, PRIORITY_META } from '../theme';
import { Avatar, EditableCode, DropLine } from './Bits';
import { Modal } from './Modal';

// ==================== Tasks tab ====================
export function TasksTab({ tasks, isStaff, canEdit, statuses, assignableUsers, onOpenTask, onAdd, onToggleTask, onToggleSubtask, onReorder, projectId, onRenumbered }) {
  const [expanded, setExpanded] = useState(() => new Set(tasks.filter((t) => (t.subtasks || []).length > 0).map((t) => t.id)));
  const [draggedId, setDraggedId] = useState(null);
  const [overGap, setOverGap] = useState(null);
  const toggleExpand = (id) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const handleDragOverTask = (e, index) => {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const midpoint = rect.top + rect.height / 2;
    setOverGap(e.clientY < midpoint ? index : index + 1);
  };

  const endDrag = () => { setDraggedId(null); setOverGap(null); };

  const dropAtGap = (gapIndex) => {
    const currentIndex = tasks.findIndex((t) => t.id === draggedId);
    if (currentIndex === -1) { endDrag(); return; }
    let targetIndex = gapIndex;
    if (currentIndex < targetIndex) targetIndex -= 1;
    if (targetIndex === currentIndex) { endDrag(); return; }
    const order = tasks.map((t) => t.id);
    order.splice(currentIndex, 1);
    order.splice(targetIndex, 0, draggedId);
    endDrag();
    onReorder(order);
  };

  const moveTask = (task, direction) => {
    const idx = tasks.findIndex((t) => t.id === task.id);
    const swapIdx = idx + direction;
    if (swapIdx < 0 || swapIdx >= tasks.length) return;
    const order = tasks.map((t) => t.id);
    const [moved] = order.splice(idx, 1);
    order.splice(swapIdx, 0, moved);
    onReorder(order);
  };

  const renumberTask = async (task, number) => {
    await api.patch(`/projects/${projectId}/tasks/${task.id}/code`, { number });
    onRenumbered();
  };
  const renumberSubtask = async (task, subtask, number) => {
    await api.patch(`/projects/${projectId}/tasks/${task.id}/subtasks/${subtask.id}/code`, { number });
    onRenumbered();
  };

  return (
    <div className="space-y-1">
      <div className="mb-2 flex justify-end">
        {canEdit && <button onClick={onAdd} className="btn-primary">+ Add task</button>}
      </div>
      {tasks.length === 0 && (
        <div className="rounded-[10px] border p-8 text-center" style={{ backgroundColor: CARD_BG, borderColor: BORDER, color: MUTED }}>No tasks yet.</div>
      )}
      {tasks.map((task, index) => {
        const subtasks = task.subtasks || [];
        const isOpen = expanded.has(task.id);
        const priorityMeta = PRIORITY_META[task.priority] || PRIORITY_META.medium;
        const isDragging = draggedId === task.id;
        return (
          <div key={task.id}>
            {canEdit && draggedId != null && overGap === index && <DropLine />}
            <div
              onDragOver={canEdit ? (e) => handleDragOverTask(e, index) : undefined}
              onDrop={canEdit ? (e) => { e.preventDefault(); dropAtGap(overGap ?? index); } : undefined}
              className="group my-2 rounded-[10px] border p-4 transition-all"
              style={{
                backgroundColor: CARD_BG,
                borderColor: isDragging ? BLUE : BORDER,
                borderStyle: isDragging ? 'dashed' : 'solid',
                opacity: isDragging ? 0.5 : 1,
                transform: isDragging ? 'scale(0.97)' : 'scale(1)',
              }}
            >
              <div className="flex items-start gap-3">
                {canEdit && (
                  <span
                    draggable
                    onDragStart={() => setDraggedId(task.id)}
                    onDragEnd={endDrag}
                    className="mt-1 flex-shrink-0 cursor-grab active:cursor-grabbing"
                    style={{ color: MUTED }}
                    title="Drag to reorder"
                  >
                    <IconGripVertical size={16} />
                  </span>
                )}
                <input
                  type="checkbox"
                  checked={task.isComplete}
                  onClick={(e) => e.stopPropagation()}
                  onChange={() => onToggleTask(task)}
                  className="mt-1 h-4 w-4 flex-shrink-0"
                />
                <div className="min-w-0 flex-1 cursor-pointer" onClick={() => onOpenTask(task)}>
                  <div className="flex flex-wrap items-center gap-2">
                    {task.taskCode && (
                      <EditableCode code={task.taskCode} letter="T" disabled={!canEdit} onRename={(n) => renumberTask(task, n)} />
                    )}
                    <span className="font-medium" style={{ color: task.isComplete ? MUTED : TEXT, textDecoration: task.isComplete ? 'line-through' : 'none' }}>
                      {task.title}
                    </span>
                    <span className="whitespace-nowrap rounded-[3px] px-2 py-0.5 text-xs font-medium" style={{ backgroundColor: `color-mix(in srgb, ${task.status?.color || MUTED} 13%, transparent)`, color: task.status?.color || MUTED }}>
                      {task.status?.name}
                    </span>
                    <span className="flex items-center gap-1 text-xs" style={{ color: MUTED }}>
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: priorityMeta.color }} /> {priorityMeta.label}
                    </span>
                    {task.linkedTicket && (
                      <Link
                        to={`/tickets/${task.linkedTicket.id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="flex items-center gap-1 rounded-[3px] px-2 py-0.5 text-xs font-medium"
                        style={{ backgroundColor: 'color-mix(in srgb, var(--color-accent) 15%, transparent)', color: BLUE }}
                      >
                        <IconLink size={11} /> {formatTicketId(task.linkedTicket)} {task.linkedTicket.title}
                      </Link>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-3 text-xs" style={{ color: MUTED }}>
                    <Avatar name={task.assignee?.displayName} size={18} />
                    <span>{task.dueDate || 'No due date'}</span>
                    {subtasks.length > 0 && (
                      <button onClick={(e) => { e.stopPropagation(); toggleExpand(task.id); }} className="flex items-center gap-1 hover:underline">
                        {isOpen ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
                        {subtasks.filter((s) => s.completedAt).length}/{subtasks.length} subtasks
                      </button>
                    )}
                  </div>
                  {subtasks.length > 0 && (
                    <div className="mt-2 h-1 w-full max-w-xs overflow-hidden rounded-full" style={{ backgroundColor: BORDER }}>
                      <div className="h-full rounded-full" style={{ width: `${task.subtaskPercent || 0}%`, backgroundColor: BLUE }} />
                    </div>
                  )}
                  {isOpen && subtasks.length > 0 && (
                    <ul className="mt-3 space-y-1.5 border-l-2 pl-3" style={{ borderColor: BORDER }} onClick={(e) => e.stopPropagation()}>
                      {subtasks.map((st) => (
                        <li key={st.id} className="flex flex-wrap items-center gap-2 text-sm">
                          <input type="checkbox" checked={!!st.completedAt} onChange={() => onToggleSubtask(task, st)} className="h-3.5 w-3.5" />
                          {st.subtaskCode && (
                            <EditableCode code={st.subtaskCode} letter="S" disabled={!canEdit} onRename={(n) => renumberSubtask(task, st, n)} />
                          )}
                          <span style={{ color: st.completedAt ? MUTED : TEXT, textDecoration: st.completedAt ? 'line-through' : 'none' }}>{st.title}</span>
                          <Avatar name={st.assignee?.displayName} size={16} />
                          {st.dueDate && <span className="text-xs" style={{ color: MUTED }}>{st.dueDate}</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {canEdit && (
                  <div className="flex flex-shrink-0 flex-col gap-0.5 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); moveTask(task, -1); }}
                      disabled={index === 0}
                      title="Move up"
                      className="rounded disabled:cursor-not-allowed disabled:opacity-30"
                      style={{ color: MUTED }}
                    >
                      <IconChevronUp size={16} />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); moveTask(task, 1); }}
                      disabled={index === tasks.length - 1}
                      title="Move down"
                      className="rounded disabled:cursor-not-allowed disabled:opacity-30"
                      style={{ color: MUTED }}
                    >
                      <IconChevronDown size={16} />
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
      {canEdit && draggedId != null && overGap === tasks.length && <DropLine />}
    </div>
  );
}

export function AddTaskModal({ statuses, assignableUsers, onClose, onSave }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [statusId, setStatusId] = useState('');
  const [priority, setPriority] = useState('medium');
  const [assignedToUserId, setAssignedToUserId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!title.trim()) return;
    setSaving(true);
    try {
      await onSave({ title, description, statusId: statusId || undefined, priority, assignedToUserId: assignedToUserId || null, dueDate: dueDate || null });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Add task" onClose={onClose}>
      <label className="mb-1 block text-sm font-medium" style={{ color: TEXT }}>Title</label>
      <input className="input mb-3" style={fieldStyle} value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
      <label className="mb-1 block text-sm font-medium" style={{ color: TEXT }}>Description</label>
      <textarea className="input mb-3 resize-y" style={{ ...fieldStyle, minHeight: '60px' }} value={description} onChange={(e) => setDescription(e.target.value)} />
      <div className="mb-3 grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-sm font-medium" style={{ color: TEXT }}>Status</label>
          <select className="input" style={fieldStyle} value={statusId} onChange={(e) => setStatusId(e.target.value)}>
            <option value="">Default (open)</option>
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
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="rounded-md border px-4 py-2 text-sm font-medium" style={{ borderColor: BORDER, color: TEXT }}>Cancel</button>
        <button onClick={save} disabled={saving || !title.trim()} className="rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" style={{ backgroundColor: BLUE }}>
          {saving ? 'Saving…' : 'Add task'}
        </button>
      </div>
    </Modal>
  );
}
