// The tasks of a ticket or project: a compact checklist that reorders by drag
// or the up/down buttons, and expands one task at a time into its details
// (TaskDetails: fields, subtasks, time and a timer per task and subtask).
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  IconGripVertical, IconChevronDown, IconChevronRight, IconChevronUp, IconLink,
} from '@tabler/icons-react';
import api, { errMessage } from '../../api/api';
import { formatTicketId } from '../../utils/ticketId';
import Avatar from './Avatar';
import EditableCode from './EditableCode';
import TaskDetails from './TaskDetails';
import { formatSeconds } from './TimeLog';
import { workPaths } from './workPaths';

const PRIORITY_META = {
  urgent: { label: 'Urgent', color: 'var(--color-danger)' },
  high: { label: 'High', color: 'var(--color-warning)' },
  medium: { label: 'Medium', color: 'var(--color-accent)' },
  low: { label: 'Low', color: 'var(--color-text-muted)' },
};
const field = { backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: 'var(--color-text-primary)' };

function DropLine() {
  return <div className="drop-line my-1 h-0.5 rounded-full" style={{ backgroundColor: 'var(--color-accent)' }} />;
}

export default function TaskList({
  kind, parentId, tasks, statuses, assignableUsers, canEdit, canLog, canManageOthers, currentUser, timerLabel, onChanged,
}) {
  const paths = workPaths(kind, parentId);
  const [openId, setOpenId] = useState(null);
  const [order, setOrder] = useState(null); // optimistic order while a reorder saves
  const [draggedId, setDraggedId] = useState(null);
  const [overGap, setOverGap] = useState(null);
  const [newTitle, setNewTitle] = useState('');

  const list = order ? order.map((id) => tasks.find((t) => t.id === id)).filter(Boolean) : tasks;

  const call = async (fn) => {
    try { await fn(); } catch (err) { alert(errMessage(err)); }
    onChanged();
  };

  // The checkbox moves a task between the first open and first closed status.
  const toggle = (task) => {
    const closed = task.status?.behaviorType === 'closed';
    const next = statuses.find((s) => s.behaviorType === (closed ? 'open' : 'closed'));
    if (next) call(() => api.patch(paths.task(task.id), { statusId: next.id }));
  };

  const reorder = async (ids) => {
    setOrder(ids);
    try {
      await api.patch(paths.reorder, { order: ids });
    } catch (err) {
      alert(errMessage(err));
    }
    await onChanged();
    setOrder(null);
  };

  const addTask = () => {
    if (!newTitle.trim()) return;
    const title = newTitle.trim();
    setNewTitle('');
    call(() => api.post(paths.tasks, { title }));
  };

  // ---- Drag and drop (as the project task list always had) ----
  const handleDragOverTask = (e, index) => {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const midpoint = rect.top + rect.height / 2;
    setOverGap(e.clientY < midpoint ? index : index + 1);
  };
  const endDrag = () => { setDraggedId(null); setOverGap(null); };
  const dropAtGap = (gapIndex) => {
    const currentIndex = list.findIndex((t) => t.id === draggedId);
    if (currentIndex === -1) { endDrag(); return; }
    let targetIndex = gapIndex;
    if (currentIndex < targetIndex) targetIndex -= 1;
    if (targetIndex === currentIndex) { endDrag(); return; }
    const ids = list.map((t) => t.id);
    ids.splice(currentIndex, 1);
    ids.splice(targetIndex, 0, draggedId);
    endDrag();
    reorder(ids);
  };
  const moveTask = (task, direction) => {
    const idx = list.findIndex((t) => t.id === task.id);
    const swapIdx = idx + direction;
    if (swapIdx < 0 || swapIdx >= list.length) return;
    const ids = list.map((t) => t.id);
    const [moved] = ids.splice(idx, 1);
    ids.splice(swapIdx, 0, moved);
    reorder(ids);
  };

  return (
    <div className="space-y-1">
      {list.length === 0 && (
        <div className="rounded-[10px] border p-6 text-center text-sm" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }}>No tasks yet.</div>
      )}
      {list.map((task, index) => {
        const subtasks = task.subtasks || [];
        const isOpen = openId === task.id;
        const done = task.status?.behaviorType === 'closed';
        const priority = PRIORITY_META[task.priority] || PRIORITY_META.medium;
        const isDragging = draggedId === task.id;
        return (
          <div key={task.id}>
            {canEdit && draggedId != null && overGap === index && <DropLine />}
            <div
              onDragOver={canEdit ? (e) => handleDragOverTask(e, index) : undefined}
              onDrop={canEdit ? (e) => { e.preventDefault(); dropAtGap(overGap ?? index); } : undefined}
              className="group my-1.5 rounded-[10px] border p-3"
              style={{
                backgroundColor: 'var(--color-card)',
                borderColor: isDragging ? 'var(--color-accent)' : 'var(--color-border)',
                borderStyle: isDragging ? 'dashed' : 'solid',
                opacity: isDragging ? 0.5 : 1,
              }}
            >
              <div className="flex items-start gap-3">
                {canEdit && (
                  <span draggable onDragStart={() => setDraggedId(task.id)} onDragEnd={endDrag}
                    className="mt-0.5 flex-shrink-0 cursor-grab active:cursor-grabbing" style={{ color: 'var(--color-text-muted)' }} title="Drag to reorder">
                    <IconGripVertical size={16} />
                  </span>
                )}
                <input type="checkbox" aria-label={`Complete ${task.title}`} checked={done} disabled={!canEdit}
                  onClick={(e) => e.stopPropagation()} onChange={() => toggle(task)} className="mt-1 h-4 w-4 flex-shrink-0" />
                <div className="min-w-0 flex-1 cursor-pointer" onClick={() => setOpenId(isOpen ? null : task.id)}>
                  <div className="flex flex-wrap items-center gap-2">
                    {isOpen ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
                    {task.code && (
                      <EditableCode code={task.code} letter="T" disabled={!canEdit}
                        onRename={async (number) => { await api.patch(paths.code(task.id), { number }); onChanged(); }} />
                    )}
                    <span className="font-medium" style={{ color: done ? 'var(--color-text-muted)' : 'var(--color-text-primary)', textDecoration: done ? 'line-through' : 'none' }}>
                      {task.title}
                    </span>
                    <span className="whitespace-nowrap rounded-[3px] px-2 py-0.5 text-xs font-medium"
                      style={{ backgroundColor: `color-mix(in srgb, ${task.status?.color || 'var(--color-text-muted)'} 13%, transparent)`, color: task.status?.color || 'var(--color-text-muted)' }}>
                      {task.status?.name}
                    </span>
                    <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: priority.color }} /> {priority.label}
                    </span>
                    {task.linkedTicket && (
                      <Link to={`/tickets/${task.linkedTicket.id}`} onClick={(e) => e.stopPropagation()}
                        className="flex items-center gap-1 rounded-[3px] px-2 py-0.5 text-xs font-medium"
                        style={{ backgroundColor: 'color-mix(in srgb, var(--color-accent) 15%, transparent)', color: 'var(--color-accent)' }}>
                        <IconLink size={11} /> {formatTicketId(task.linkedTicket)} {task.linkedTicket.restricted ? 'Restricted ticket' : task.linkedTicket.title}
                      </Link>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-3 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                    <Avatar name={task.assignee?.displayName} size={18} />
                    <span>{task.dueDate || 'No due date'}</span>
                    {subtasks.length > 0 && <span>{subtasks.filter((s) => s.completedAt).length}/{subtasks.length} subtasks</span>}
                    {task.loggedSeconds > 0 && <span className="font-mono">{formatSeconds(task.loggedSeconds)}</span>}
                  </div>
                  {subtasks.length > 0 && (
                    <div className="mt-2 h-1 w-full max-w-xs overflow-hidden rounded-full" style={{ backgroundColor: 'var(--color-border)' }}>
                      <div className="h-full rounded-full" style={{ width: `${task.subtaskPercent || 0}%`, backgroundColor: 'var(--color-accent)' }} />
                    </div>
                  )}
                </div>
                {canEdit && (
                  <div className="flex flex-shrink-0 flex-col gap-0.5 opacity-100 md:opacity-0 md:group-hover:opacity-100">
                    <button type="button" aria-label={`Move ${task.title} up`} title="Move up" disabled={index === 0}
                      onClick={(e) => { e.stopPropagation(); moveTask(task, -1); }}
                      className="rounded disabled:cursor-not-allowed disabled:opacity-30" style={{ color: 'var(--color-text-muted)' }}>
                      <IconChevronUp size={16} />
                    </button>
                    <button type="button" aria-label={`Move ${task.title} down`} title="Move down" disabled={index === list.length - 1}
                      onClick={(e) => { e.stopPropagation(); moveTask(task, 1); }}
                      className="rounded disabled:cursor-not-allowed disabled:opacity-30" style={{ color: 'var(--color-text-muted)' }}>
                      <IconChevronDown size={16} />
                    </button>
                  </div>
                )}
              </div>
              {isOpen && (
                <TaskDetails
                  key={`${task.id}-${task.title}-${task.description}`}
                  kind={kind} parentId={parentId} task={task} tasks={tasks} statuses={statuses}
                  assignableUsers={assignableUsers} canEdit={canEdit} canLog={canLog} canManageOthers={canManageOthers}
                  currentUser={currentUser} timerLabel={timerLabel} onChanged={onChanged}
                />
              )}
            </div>
          </div>
        );
      })}
      {canEdit && draggedId != null && overGap === list.length && <DropLine />}
      {canEdit && (
        <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTask(); } }}
          placeholder="Add a task…" className="input mt-2" style={field} />
      )}
    </div>
  );
}
