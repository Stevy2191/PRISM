// The Tasks tab: filter pills, tasks grouped by phase (each collapsible, with
// a quick-add row), the shift-dependents banner and the docked task panel.
import { useEffect, useMemo, useRef, useState } from 'react';
import api, { errMessage } from '../../../api/api';
import Pill from '../../../components/ui/Pill';
import { workPaths } from '../../../components/work/workPaths';
import PhaseSection from './PhaseSection';
import PhoneTasks from './PhoneTasks';
import { useNarrow } from './useNarrow';
import ShiftBanner from './ShiftBanner';
import TaskPanel from './TaskPanel';
import { useListKeys } from './useListKeys';
import {
  FILTERS, filterTasks, groupByPhase, isDone, shortCode,
} from './taskFilters';

export default function TasksTab({
  projectId, tasks, phases, statuses, assignableUsers, canEdit, canLog, canManageOthers, currentUser, timerLabel,
  today, addFocus, activity, onStopRequest, onLogTime, onChanged,
}) {
  const narrow = useNarrow();
  const paths = workPaths('project', projectId);
  const [filter, setFilter] = useState('all');
  const [phoneFilter, setPhoneFilter] = useState('mine'); // the phone starts on the person's own tasks
  const [selectedId, setSelectedId] = useState(null);
  const [offer, setOffer] = useState(null); // the shift-dependents banner
  const [shifting, setShifting] = useState(false);
  // Only phases the person has opened or closed by hand are in here; the rest
  // follow the default (a finished phase starts collapsed).
  const [collapsedBy, setCollapsedBy] = useState({});
  const [draggedId, setDraggedId] = useState(null);
  const [overId, setOverId] = useState(null);
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
  // Moving needs the whole list showing: with a filter on, a hidden neighbour
  // would make a move look like it did nothing.
  const reorderable = canEdit && filter === 'all';
  const canMove = (task, dir) => {
    if (!reorderable) return false;
    const peers = peersOf(task);
    const i = peers.findIndex((t) => t.id === task.id);
    return i + dir >= 0 && i + dir < peers.length;
  };
  // Put the phase's tasks in the given order, keeping every other task where it is.
  const saveOrder = (peers) => {
    const slots = new Set(peers);
    let k = 0;
    const order = tasks.map((t) => (slots.has(t.id) ? peers[k++] : t.id));
    call(() => api.patch(paths.reorder, { order }));
  };
  const move = (task, dir) => {
    const peers = peersOf(task).map((t) => t.id);
    const i = peers.indexOf(task.id);
    [peers[i], peers[i + dir]] = [peers[i + dir], peers[i]];
    saveOrder(peers);
  };
  const endDrag = () => { setDraggedId(null); setOverId(null); };
  const dropOn = (target) => {
    const dragged = tasks.find((t) => t.id === draggedId);
    endDrag();
    if (!dragged || dragged.id === target.id || (dragged.phaseId ?? null) !== (target.phaseId ?? null)) return;
    const peers = peersOf(dragged).map((t) => t.id).filter((id) => id !== dragged.id);
    peers.splice(peers.indexOf(target.id), 0, dragged.id);
    saveOrder(peers);
  };

  const selected = tasks.find((t) => t.id === selectedId) || null;
  const closePanel = () => setSelectedId(null);

  // A due date moved later: the server names what waits on it.
  const showOffer = (task, found) => setOffer((cur) => {
    if (found) return { taskId: task.id, code: shortCode(task.code), days: found.days, count: found.tasks.length };
    return cur && cur.taskId === task.id ? null : cur;
  });
  const shiftThem = async () => {
    setShifting(true);
    try { await api.post(`${paths.task(offer.taskId)}/shift-dependents`, { days: offer.days }); } catch (err) { alert(errMessage(err)); }
    setShifting(false);
    setOffer(null);
    await onChanged();
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
    selectedId,
    onSelect: setSelectedId,
    compact: !!selected, // only drawn at lg+, where the panel sits beside the list
    isDone,
    filtered: filter !== 'all',
    onToggle: toggle,
    onMove: move,
    canMove,
    reorderable,
    draggedId,
    overId,
    onDragStart: (task) => setDraggedId(task.id),
    onDragEnd: endDrag,
    onDragOver: (e, task) => {
      const dragged = tasks.find((t) => t.id === draggedId);
      if (!dragged || (dragged.phaseId ?? null) !== (task.phaseId ?? null)) return;
      e.preventDefault();
      setOverId(task.id);
    },
    onDrop: dropOn,
    onStopRequest,
  };

  // First phase with unfinished work is the one drawn in the accent colour.
  const activeKey = (() => {
    const g = all.find((x) => x.phase && x.tasks.some((t) => !isDone(t)));
    return g ? g.phase.id : null;
  })();

  // J/K walk the rows showing now, in order (a collapsed phase has none).
  const keyIds = groups
    .filter((g) => !isCollapsed(g))
    .flatMap((g) => g.tasks.map((t) => t.id));
  useListKeys({ ids: keyIds, selectedId: selected ? selected.id : null, onSelect: setSelectedId, onClose: closePanel });

  // Phone: cards from the phone's own filter; Add task goes to the first phase with open work.
  const phoneGroups = groupByPhase(filterTasks(tasks, phoneFilter, { userId: currentUser?.id, today }), phases);
  const addTarget = all.find((x) => x.phase && x.tasks.some((t) => !isDone(t)))?.phase || phases[0] || null;
  const phoneCtx = { ...ctx, compact: false, reorderable: false };
  const list = narrow ? (
    <PhoneTasks
      groups={phoneGroups} filter={phoneFilter} onFilter={setPhoneFilter} ctx={phoneCtx}
      addTarget={addTarget} onQuickAdd={quickAdd} onLogTime={onLogTime} addFocus={addFocus}
    />
  ) : (
    <div className="min-w-0 flex-1">
      {offer && <ShiftBanner offer={offer} busy={shifting} onMove={shiftThem} onLeave={() => setOffer(null)} />}
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

  return (
    <div className="flex items-start gap-5">
      {list}
      {selected && (
        <div className="w-full max-w-[480px] flex-shrink-0 max-lg:contents lg:sticky lg:top-4 lg:w-[480px]">
          <TaskPanel
            key={selected.id}
            task={selected} projectId={projectId} tasks={tasks} phases={phases} statuses={statuses}
            users={assignableUsers} canEdit={canEdit} canLog={canLog} currentUser={currentUser}
            timerLabel={timerLabel} today={today} activity={activity}
            onClose={closePanel} onSelect={setSelectedId} onChanged={onChanged}
            onShiftOffer={showOffer} onStopRequest={onStopRequest}
          />
        </div>
      )}
    </div>
  );
}
