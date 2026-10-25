// The Tasks tab: filter pills, tasks grouped by phase (each collapsible, with
// a quick-add row) and the inline task details.
import { useEffect, useMemo, useRef, useState } from 'react';
import api, { errMessage } from '../../../api/api';
import Pill from '../../../components/ui/Pill';
import TaskDetails from '../../../components/work/TaskDetails';
import { workPaths } from '../../../components/work/workPaths';
import PhaseSection from './PhaseSection';
import { FILTERS, filterTasks, groupByPhase, isDone } from './taskFilters';

export default function TasksTab({
  projectId, tasks, phases, statuses, assignableUsers, canEdit, canLog, canManageOthers, currentUser, timerLabel,
  today, addFocus, onStopRequest, onChanged,
}) {
  const paths = workPaths('project', projectId);
  const [filter, setFilter] = useState('all');
  const [openId, setOpenId] = useState(null);
  // Only phases the person has opened or closed by hand are in here; the rest
  // follow the default (a finished phase starts collapsed).
  const [collapsedBy, setCollapsedBy] = useState({});
  const quickRefs = useRef({});

  const visible = useMemo(
    () => filterTasks(tasks, filter, { userId: currentUser?.id, today }),
    [tasks, filter, currentUser, today],
  );
  const groups = useMemo(() => groupByPhase(visible, phases), [visible, phases]);
  const all = useMemo(() => groupByPhase(tasks, phases), [tasks, phases]);
  const allOf = (phase) => all.find((g) => (g.phase ? g.phase.id : null) === (phase ? phase.id : null))?.tasks || [];

  const call = async (fn) => {
    try { await fn(); } catch (err) { alert(errMessage(err)); }
    await onChanged();
  };

  // The checkbox moves a task between the first open and first closed status.
  const toggle = (task) => {
    const closed = task.status?.behaviorType === 'closed';
    const next = statuses.find((s) => s.behaviorType === (closed ? 'open' : 'closed'));
    if (next) call(() => api.patch(paths.task(task.id), { statusId: next.id }));
  };

  // Swap with the neighbour in the same phase; the server wants every task's id.
  const peersOf = (task) => tasks.filter((t) => (t.phaseId ?? null) === (task.phaseId ?? null));
  const canMove = (task, dir) => {
    const peers = peersOf(task);
    const i = peers.findIndex((t) => t.id === task.id);
    return i + dir >= 0 && i + dir < peers.length;
  };
  const move = (task, dir) => {
    const peers = peersOf(task).map((t) => t.id);
    const i = peers.indexOf(task.id);
    [peers[i], peers[i + dir]] = [peers[i + dir], peers[i]];
    const slots = new Set(peers);
    let k = 0;
    const order = tasks.map((t) => (slots.has(t.id) ? peers[k++] : t.id));
    call(() => api.patch(paths.reorder, { order }));
  };

  const quickAdd = (title, phaseId) => call(() => api.post(paths.tasks, phaseId ? { title, phaseId } : { title }));

  const isCollapsed = (g) => {
    const key = g.phase ? g.phase.id : 'none';
    if (key in collapsedBy) return collapsedBy[key];
    if (filter !== 'all') return false;
    const t = allOf(g.phase);
    return t.length > 0 && t.every(isDone);
  };

  // "Add task" in the header: focus the first quick-add row that is showing.
  useEffect(() => {
    if (!addFocus) return;
    const first = groups.find((g) => !isCollapsed(g));
    quickRefs.current[first ? (first.phase ? first.phase.id : 'none') : 'none']?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addFocus]);

  const ctx = {
    projectId,
    canEdit,
    canLog,
    today,
    timerLabel,
    openId,
    setOpenId,
    isDone,
    filtered: filter !== 'all',
    onToggle: toggle,
    onMove: move,
    canMove,
    onStopRequest,
    renderDetails: (task) => (
      <TaskDetails
        key={task.id}
        kind="project" parentId={projectId} task={task} tasks={tasks} statuses={statuses}
        assignableUsers={assignableUsers} canEdit={canEdit} canLog={canLog} canManageOthers={canManageOthers}
        currentUser={currentUser} timerLabel={timerLabel} onChanged={onChanged}
      />
    ),
  };

  // First phase with unfinished work is the one drawn in the accent colour.
  const activeKey = (() => {
    const g = all.find((x) => x.phase && x.tasks.some((t) => !isDone(t)));
    return g ? g.phase.id : null;
  })();

  return (
    <div>
      <div role="group" aria-label="Filter tasks" className="my-4 flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <Pill key={f.id} on={filter === f.id} onClick={() => setFilter(f.id)}>{f.label}</Pill>
        ))}
      </div>
      {tasks.length === 0 && phases.length === 0 && !canEdit && (
        <p className="rounded-xl border border-navy-100 bg-surface p-6 text-center text-sm text-navy-400">No tasks yet.</p>
      )}
      {groups
        .filter((g) => filter === 'all' || g.tasks.length > 0)
        .map((g) => {
          const key = g.phase ? g.phase.id : 'none';
          return (
            <PhaseSection
              key={key}
              group={g}
              ctx={ctx}
              allTasks={allOf(g.phase)}
              collapsed={isCollapsed(g)}
              active={g.phase ? g.phase.id === activeKey : false}
              onToggle={() => setCollapsedBy((m) => ({ ...m, [key]: !isCollapsed(g) }))}
              onQuickAdd={quickAdd}
              quickRef={(el) => { quickRefs.current[key] = el; }}
            />
          );
        })}
      {phases.length === 0 && tasks.length === 0 && canEdit && (
        <PhaseSection
          group={{ phase: null, tasks: [] }} ctx={ctx} allTasks={[]} collapsed={false} active={false}
          onToggle={() => {}} onQuickAdd={quickAdd} quickRef={(el) => { quickRefs.current.none = el; }}
        />
      )}
    </div>
  );
}
