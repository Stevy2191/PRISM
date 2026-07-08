import { useEffect, useRef, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  IconUpload, IconFile, IconTrash, IconPlus, IconX, IconGripVertical,
  IconChevronDown, IconChevronRight, IconLink, IconChevronUp, IconPencil,
} from '@tabler/icons-react';
import api, { errMessage } from '../api/api';
import { initials } from '../utils/userDisplay';
import { useAuth, usePermission } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import Spinner from '../components/Spinner';
import { formatTicketId } from '../utils/ticketId';

const BG = 'var(--color-bg)';
const CARD_BG = 'var(--color-card)';
const BORDER = 'var(--color-border)';
const TEXT = 'var(--color-text-primary)';
const MUTED = 'var(--color-text-muted)';
const BLUE = 'var(--color-accent)';
const fieldStyle = { backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: TEXT };

const TABS = [
  { key: 'tasks', label: 'Tasks' },
  { key: 'time', label: 'Time Entries' },
  { key: 'expenses', label: 'Expenses' },
  { key: 'materials', label: 'Materials' },
  { key: 'people', label: 'People' },
  { key: 'files', label: 'Files' },
  { key: 'activity', label: 'Activity' },
];

const PRIORITY_META = {
  urgent: { label: 'Urgent', color: 'var(--color-danger)' },
  high: { label: 'High', color: 'var(--color-warning)' },
  medium: { label: 'Medium', color: 'var(--color-accent)' },
  low: { label: 'Low', color: 'var(--color-text-muted)' },
};

function formatSeconds(sec) {
  const s = Number(sec) || 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}
function formatCost(n) {
  return `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
function completionColor(percent) {
  if (percent >= 80) return 'var(--color-success)';
  if (percent >= 40) return 'var(--color-warning)';
  return 'var(--color-danger)';
}

// ---- Time picker (mirrors TicketDetail.jsx's start/end-time entry UI) ----
const PICKER_HOURS_12 = Array.from({ length: 12 }, (_, i) => i + 1);
const PICKER_MINUTES_5 = Array.from({ length: 12 }, (_, i) => i * 5);
function minutesOfDayToParts(totalMinutes) {
  const norm = ((totalMinutes % 1440) + 1440) % 1440;
  const h24 = Math.floor(norm / 60);
  const m = norm % 60;
  const meridiem = h24 >= 12 ? 'PM' : 'AM';
  let h12 = h24 % 12;
  if (h12 === 0) h12 = 12;
  return { h12, m, meridiem };
}
function partsToMinutesOfDay(h12, m, meridiem) {
  let h24 = h12 % 12;
  if (meridiem === 'PM') h24 += 12;
  return h24 * 60 + m;
}
function roundToNearest5(date) {
  const mins = date.getHours() * 60 + date.getMinutes();
  return Math.round(mins / 5) * 5;
}
function buildLocalDateTime(dateStr, minutesOfDay) {
  const h = Math.floor(minutesOfDay / 60);
  const m = minutesOfDay % 60;
  return `${dateStr}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
}
function TimePicker({ minutesOfDay, onChange }) {
  const { h12, m, meridiem } = minutesOfDayToParts(minutesOfDay);
  const update = (nh12, nm, nMeridiem) => onChange(partsToMinutesOfDay(nh12, nm, nMeridiem));
  return (
    <div className="flex gap-2">
      <select value={h12} onChange={(e) => update(Number(e.target.value), m, meridiem)} className="input h-9 text-sm" style={fieldStyle}>
        {PICKER_HOURS_12.map((h) => <option key={h} value={h}>{h}</option>)}
      </select>
      <select value={m} onChange={(e) => update(h12, Number(e.target.value), meridiem)} className="input h-9 text-sm" style={fieldStyle}>
        {PICKER_MINUTES_5.map((mm) => <option key={mm} value={mm}>{String(mm).padStart(2, '0')}</option>)}
      </select>
      <select value={meridiem} onChange={(e) => update(h12, m, e.target.value)} className="input h-9 text-sm" style={fieldStyle}>
        <option value="AM">AM</option>
        <option value="PM">PM</option>
      </select>
    </div>
  );
}
function TimeEntryFields({ entryDate, onEntryDateChange, startMinutes, onStartMinutesChange, endMinutes, onEndMinutesChange, todayStr: today }) {
  const durationMin = endMinutes - startMinutes;
  const valid = durationMin > 0;
  return (
    <>
      <label className="mb-1 block text-sm font-medium" style={{ color: TEXT }}>Date</label>
      <input type="date" value={entryDate} max={today} onChange={(e) => onEntryDateChange(e.target.value)} className="input mb-3" style={fieldStyle} />
      <label className="mb-1 block text-sm font-medium" style={{ color: TEXT }}>Start Time</label>
      <div className="mb-3"><TimePicker minutesOfDay={startMinutes} onChange={onStartMinutesChange} /></div>
      <label className="mb-1 block text-sm font-medium" style={{ color: TEXT }}>End Time</label>
      <div className="mb-3"><TimePicker minutesOfDay={endMinutes} onChange={onEndMinutesChange} /></div>
      <label className="mb-1 block text-sm font-medium" style={{ color: TEXT }}>Duration</label>
      <div
        className="mb-3 rounded-md border px-3 py-2 font-mono text-sm font-semibold"
        style={{ borderColor: valid ? 'var(--color-success)' : 'var(--color-danger)', color: valid ? 'var(--color-success)' : 'var(--color-danger)', backgroundColor: BG }}
      >
        {valid ? formatSeconds(durationMin * 60) : 'End time must be after start time'}
      </div>
    </>
  );
}

function Modal({ title, children, onClose, wide }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className={`w-full ${wide ? 'max-w-2xl' : 'max-w-md'} max-h-[90vh] overflow-y-auto rounded-[10px] border p-5`}
        style={{ backgroundColor: CARD_BG, borderColor: BORDER }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-3 text-base font-semibold" style={{ color: TEXT }}>{title}</h2>
        {children}
      </div>
    </div>
  );
}

function Avatar({ name, size = 24 }) {
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

export default function ProjectDetail() {
  const { id } = useParams();
  const { isAdmin, isStaff, user, hasAnyPermission } = useAuth();
  const canDeleteProjects = usePermission('projects.delete');
  const canManageMembers = usePermission('projects.manage_members');
  const canManageExpenses = usePermission('projects.manage_expenses');
  const canLogTime = usePermission('projects.log_time');
  const canEditProjectContent = hasAnyPermission(['projects.edit_own', 'projects.edit_department', 'projects.edit_all']);
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [project, setProject] = useState(null);
  const [statuses, setStatuses] = useState([]);
  const [assignableUsers, setAssignableUsers] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [teams, setTeams] = useState([]);
  const [directory, setDirectory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('tasks');
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');

  const [tasks, setTasks] = useState([]);
  const [timeEntries, setTimeEntries] = useState({ entries: [], totalSeconds: 0 });
  const [expenses, setExpenses] = useState({ expenses: [], total: 0 });
  const [materials, setMaterials] = useState({ materials: [], total: 0 });
  const [members, setMembers] = useState([]);
  const [files, setFiles] = useState([]);
  const [activity, setActivity] = useState([]);

  const [openTask, setOpenTask] = useState(null);
  const [showAddTask, setShowAddTask] = useState(false);
  const [showAddTime, setShowAddTime] = useState(false);
  const [showAddExpense, setShowAddExpense] = useState(false);
  const [showAddMaterial, setShowAddMaterial] = useState(false);
  const [showAddPerson, setShowAddPerson] = useState(false);
  const [closeWarning, setCloseWarning] = useState(false);
  const [dismissedCloseWarning, setDismissedCloseWarning] = useState(false);

  const loadAll = async () => {
    try {
      const [p, t, te, ex, mat, mem, fl, act] = await Promise.all([
        api.get(`/projects/${id}`),
        api.get(`/projects/${id}/tasks`),
        api.get(`/projects/${id}/time-entries`),
        api.get(`/projects/${id}/expenses`),
        api.get(`/projects/${id}/materials`),
        api.get(`/projects/${id}/members`),
        api.get(`/projects/${id}/files`),
        api.get(`/projects/${id}/activity`),
      ]);
      setProject(p.data.project);
      setTasks(t.data.tasks);
      setTimeEntries(te.data);
      setExpenses(ex.data);
      setMaterials(mat.data);
      setMembers(mem.data.members);
      setFiles(fl.data.files);
      setActivity(act.data.activity);
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    api.get('/project-statuses').then(({ data }) => setStatuses(data.statuses)).catch(() => {});
    api.get('/departments').then(({ data }) => setDepartments(data.departments)).catch(() => {});
    api.get('/teams').then(({ data }) => setTeams(data.teams)).catch(() => {});
    api.get('/users/directory').then(({ data }) => setDirectory(data.users)).catch(() => {});
    if (isStaff) api.get('/users/assignable').then(({ data }) => setAssignableUsers(data.users)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reloadTasks = () => api.get(`/projects/${id}/tasks`).then(({ data }) => setTasks(data.tasks));
  const reloadProject = () => api.get(`/projects/${id}`).then(({ data }) => setProject(data.project));
  const reloadActivity = () => api.get(`/projects/${id}/activity`).then(({ data }) => setActivity(data.activity));

  // All-tasks-closed prompt: fires once completion hits 100% while the
  // project's own status is still open-behavior.
  useEffect(() => {
    if (!project || dismissedCloseWarning) return;
    const currentBehavior = statuses.find((s) => s.name === project.status)?.behaviorType;
    if (project.stats?.totalTasks > 0 && project.stats?.completionPercent === 100 && currentBehavior !== 'closed') {
      setCloseWarning(true);
    } else {
      setCloseWarning(false);
    }
  }, [project, statuses, dismissedCloseWarning]);

  const patchProject = async (changes) => {
    try {
      const { data } = await api.patch(`/projects/${id}`, changes);
      setProject(data.project);
    } catch (err) {
      alert(errMessage(err));
    }
  };

  const closeProjectNow = async () => {
    const closedStatus = statuses.find((s) => s.behaviorType === 'closed');
    if (!closedStatus) return;
    await patchProject({ status: closedStatus.name });
    setCloseWarning(false);
  };

  const deleteProject = async () => {
    if (!confirm(`Delete project "${project.name}"? This cannot be undone.`)) return;
    try {
      await api.delete(`/projects/${id}`);
      navigate('/projects');
    } catch (err) {
      alert(errMessage(err));
    }
  };

  const saveName = async () => {
    if (nameDraft.trim() && nameDraft.trim() !== project.name) {
      await patchProject({ name: nameDraft.trim() });
    }
    setEditingName(false);
  };

  // ---- Task reorder (drag-and-drop or the up/down buttons) ----
  // `order` is the full array of task IDs in their new order; a single
  // bulk PATCH updates every affected position in one request.
  const handleReorderTasks = async (order) => {
    setTasks((prev) => order.map((tid) => prev.find((t) => t.id === tid)).filter(Boolean));
    try {
      await api.patch(`/projects/${id}/tasks/reorder`, { order });
      showToast('Order saved.');
    } catch (err) {
      alert(errMessage(err));
    } finally {
      reloadTasks();
    }
  };

  const toggleTaskComplete = async (task) => {
    const closedStatus = statuses.find((s) => s.behaviorType === 'closed');
    const openStatus = statuses.find((s) => s.behaviorType === 'open');
    const target = task.isComplete ? openStatus : closedStatus;
    if (!target) return;
    await api.patch(`/projects/${id}/tasks/${task.id}`, { statusId: target.id });
    await reloadTasks();
    await reloadProject();
    await reloadActivity();
  };

  const toggleSubtaskComplete = async (task, subtask) => {
    const closedStatus = statuses.find((s) => s.behaviorType === 'closed');
    const openStatus = statuses.find((s) => s.behaviorType === 'open');
    const isClosed = statuses.find((s) => s.id === subtask.statusId)?.behaviorType === 'closed';
    const target = isClosed ? openStatus : closedStatus;
    if (!target) return;
    await api.patch(`/projects/${id}/tasks/${task.id}/subtasks/${subtask.id}`, { statusId: target.id });
    await reloadTasks();
    await reloadProject();
    await reloadActivity();
  };

  const deleteTask = async (taskId) => {
    if (!confirm('Delete this task and its subtasks?')) return;
    await api.delete(`/projects/${id}/tasks/${taskId}`);
    setOpenTask(null);
    await reloadTasks();
    await reloadProject();
  };

  if (loading) return <Spinner />;
  if (error) return <div className="rounded-md bg-red-50 p-4 text-red-700">{error}</div>;
  if (!project) return null;

  const statusMeta = statuses.find((s) => s.name === project.status);
  const stats = project.stats || {};
  const compColor = completionColor(stats.completionPercent || 0);

  return (
    <div style={{ backgroundColor: BG, margin: '-2rem -1.5rem', padding: '1.5rem' }} className="min-h-full space-y-5">
      <Link to="/projects" className="text-sm hover:underline" style={{ color: BLUE }}>← Back to projects</Link>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          {project.projectCode && (
            <p className="font-mono text-xs" style={{ color: MUTED }}>{project.projectCode}</p>
          )}
          <div className="flex items-center gap-3">
            {editingName ? (
              <input
                autoFocus
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onBlur={saveName}
                onKeyDown={(e) => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') setEditingName(false); }}
                className="input text-xl font-bold"
                style={{ ...fieldStyle, maxWidth: '24rem' }}
              />
            ) : (
              <h1
                className="cursor-pointer text-2xl font-bold hover:opacity-80"
                style={{ color: TEXT }}
                onClick={() => { if (isStaff) { setNameDraft(project.name); setEditingName(true); } }}
                title={isStaff ? 'Click to rename' : ''}
              >
                {project.name}
              </h1>
            )}
            <span
              className="whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium"
              style={{ backgroundColor: `color-mix(in srgb, ${statusMeta?.color || MUTED} 13%, transparent)`, color: statusMeta?.color || MUTED }}
            >
              {project.status}
            </span>
          </div>
          <p className="mt-1 text-sm" style={{ color: MUTED }}>
            {project.ownerDepartment?.name && (
              <span className="rounded-full px-2 py-0.5 text-xs font-medium" style={{ backgroundColor: 'color-mix(in srgb, var(--color-accent) 15%, transparent)', color: BLUE }}>
                {project.ownerDepartment.name}
              </span>
            )}
            {project.forDepartment?.name && project.forDepartment.name !== project.ownerDepartment?.name && (
              <>
                {' → '}
                <span className="rounded-full px-2 py-0.5 text-xs font-medium" style={{ backgroundColor: 'color-mix(in srgb, var(--color-success) 15%, transparent)', color: 'var(--color-success)' }}>
                  {project.forDepartment.name}
                </span>
              </>
            )}
          </p>
          {project.tags && project.tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {project.tags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => navigate(`/projects?tag=${encodeURIComponent(tag)}`)}
                  className="rounded-full px-2 py-0.5 text-xs font-medium hover:opacity-75"
                  style={{ backgroundColor: BORDER, color: TEXT }}
                >
                  {tag}
                </button>
              ))}
            </div>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-4 text-sm" style={{ color: MUTED }}>
            <span className="flex items-center gap-2"><Avatar name={project.lead?.displayName} size={20} /> {project.lead?.displayName || 'No lead'}</span>
            <span>{project.dueDate ? `Due ${project.dueDate}` : 'No due date'}</span>
            <span>Created {project.createdAt ? project.createdAt.slice(0, 10) : '—'}</span>
          </div>
        </div>
        {isStaff && (
          <div className="flex flex-shrink-0 items-center gap-2">
            {canDeleteProjects && <button onClick={deleteProject} className="btn-danger">Delete</button>}
          </div>
        )}
      </div>

      {/* Close-project warning */}
      {closeWarning && (
        <div
          className="flex items-center justify-between gap-4 rounded-[10px] border p-4"
          style={{ backgroundColor: 'color-mix(in srgb, var(--color-warning) 10%, var(--color-bg))', borderColor: 'var(--color-warning)' }}
        >
          <p className="text-sm font-medium" style={{ color: TEXT }}>All tasks are complete. Would you like to mark this project as closed?</p>
          <div className="flex flex-shrink-0 gap-2">
            <button onClick={() => setDismissedCloseWarning(true)} className="rounded-md border px-3 py-1.5 text-sm font-medium" style={{ borderColor: BORDER, color: TEXT }}>Not yet</button>
            <button onClick={closeProjectNow} className="rounded-md px-3 py-1.5 text-sm font-semibold text-white" style={{ backgroundColor: 'var(--color-warning)' }}>Close project</button>
          </div>
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Completion" value={`${stats.completionPercent || 0}%`} color={compColor} />
        <StatCard label="Total time logged" value={formatSeconds(stats.totalTimeSeconds)} color={TEXT} />
        <StatCard label="Total cost" value={formatCost(stats.totalCost)} color={TEXT} />
        <StatCard label="Open linked tickets" value={stats.openTicketsCount || 0} color={TEXT} />
      </div>

      {/* Progress bar */}
      <div className="h-2 w-full overflow-hidden rounded-full" style={{ backgroundColor: BORDER }}>
        <div className="h-full rounded-full transition-all" style={{ width: `${stats.completionPercent || 0}%`, backgroundColor: compColor }} />
      </div>

      {/* Tabs */}
      <div className="flex flex-shrink-0" style={{ backgroundColor: CARD_BG, borderBottom: `1px solid ${BORDER}` }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className="-mb-px border-b-2 px-4 py-3 text-sm font-medium"
            style={{ borderColor: tab === t.key ? BLUE : 'transparent', color: tab === t.key ? BLUE : MUTED }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'tasks' && (
        <TasksTab
          tasks={tasks}
          isStaff={isStaff}
          canEdit={canEditProjectContent}
          statuses={statuses}
          assignableUsers={assignableUsers}
          onOpenTask={setOpenTask}
          onAdd={() => setShowAddTask(true)}
          onToggleTask={toggleTaskComplete}
          onToggleSubtask={toggleSubtaskComplete}
          onReorder={handleReorderTasks}
          projectId={id}
          onRenumbered={reloadTasks}
        />
      )}
      {tab === 'time' && (
        <TimeTab
          data={timeEntries}
          isStaff={isStaff}
          canLogTime={canLogTime}
          user={user}
          isAdmin={isAdmin}
          tasks={tasks}
          onAdd={() => setShowAddTime(true)}
          onDelete={async (entryId) => {
            await api.delete(`/projects/${id}/time-entries/${entryId}`);
            const { data } = await api.get(`/projects/${id}/time-entries`);
            setTimeEntries(data);
            reloadProject();
          }}
        />
      )}
      {tab === 'expenses' && (
        <ExpensesTab data={expenses} canManageExpenses={canManageExpenses} onAdd={() => setShowAddExpense(true)} onDelete={async (expId) => {
          await api.delete(`/projects/${id}/expenses/${expId}`);
          const { data } = await api.get(`/projects/${id}/expenses`);
          setExpenses(data);
          reloadProject();
        }} />
      )}
      {tab === 'materials' && (
        <MaterialsTab data={materials} canManageExpenses={canManageExpenses} onAdd={() => setShowAddMaterial(true)} onDelete={async (matId) => {
          await api.delete(`/projects/${id}/materials/${matId}`);
          const { data } = await api.get(`/projects/${id}/materials`);
          setMaterials(data);
          reloadProject();
        }} />
      )}
      {tab === 'people' && (
        <PeopleTab
          members={members}
          project={project}
          canManageMembers={canManageMembers}
          onAdd={() => setShowAddPerson(true)}
          onRemove={async (userId) => {
            await api.delete(`/projects/${id}/members/${userId}`);
            const { data } = await api.get(`/projects/${id}/members`);
            setMembers(data.members);
          }}
        />
      )}
      {tab === 'files' && (
        <FilesTab
          files={files}
          onUpload={async (file) => {
            const fd = new FormData();
            fd.append('file', file);
            await api.post(`/projects/${id}/files`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
            const { data } = await api.get(`/projects/${id}/files`);
            setFiles(data.files);
          }}
          onDelete={async (fileId) => {
            await api.delete(`/projects/${id}/files/${fileId}`);
            const { data } = await api.get(`/projects/${id}/files`);
            setFiles(data.files);
          }}
        />
      )}
      {tab === 'activity' && <ActivityTab activity={activity} />}

      {/* ---- Modals ---- */}
      {showAddTask && (
        <AddTaskModal
          statuses={statuses}
          assignableUsers={assignableUsers}
          onClose={() => setShowAddTask(false)}
          onSave={async (payload) => {
            await api.post(`/projects/${id}/tasks`, payload);
            setShowAddTask(false);
            await reloadTasks();
            await reloadProject();
          }}
        />
      )}

      {openTask && (
        <TaskDetailModal
          projectId={id}
          task={openTask}
          statuses={statuses}
          assignableUsers={assignableUsers}
          onClose={() => setOpenTask(null)}
          onChanged={async () => { await reloadTasks(); await reloadProject(); await reloadActivity(); }}
          onDeleted={() => deleteTask(openTask.id)}
        />
      )}

      {showAddTime && (
        <AddTimeModal
          tasks={tasks}
          isAdmin={isAdmin}
          assignableUsers={assignableUsers}
          onClose={() => setShowAddTime(false)}
          onSave={async (payload) => {
            await api.post(`/projects/${id}/time-entries`, payload);
            setShowAddTime(false);
            const { data } = await api.get(`/projects/${id}/time-entries`);
            setTimeEntries(data);
            reloadProject();
          }}
        />
      )}

      {showAddExpense && (
        <AddExpenseModal
          tasks={tasks}
          onClose={() => setShowAddExpense(false)}
          onSave={async (payload) => {
            await api.post(`/projects/${id}/expenses`, payload);
            setShowAddExpense(false);
            const { data } = await api.get(`/projects/${id}/expenses`);
            setExpenses(data);
            reloadProject();
          }}
        />
      )}

      {showAddMaterial && (
        <AddMaterialModal
          tasks={tasks}
          onClose={() => setShowAddMaterial(false)}
          onSave={async (payload) => {
            await api.post(`/projects/${id}/materials`, payload);
            setShowAddMaterial(false);
            const { data } = await api.get(`/projects/${id}/materials`);
            setMaterials(data);
            reloadProject();
          }}
        />
      )}

      {showAddPerson && (
        <AddPersonModal
          directory={directory}
          existingIds={members.map((m) => m.userId)}
          onClose={() => setShowAddPerson(false)}
          onSave={async (payload) => {
            await api.post(`/projects/${id}/members`, payload);
            setShowAddPerson(false);
            const { data } = await api.get(`/projects/${id}/members`);
            setMembers(data.members);
          }}
        />
      )}
    </div>
  );
}

function StatCard({ label, value, color }) {
  return (
    <div className="rounded-[10px] border p-4" style={{ backgroundColor: CARD_BG, borderColor: BORDER }}>
      <p className="text-xs font-medium uppercase tracking-wide" style={{ color: MUTED }}>{label}</p>
      <p className="mt-1 text-2xl font-bold" style={{ color }}>{value}</p>
    </div>
  );
}

// Small inline-editable chip for a taskCode/subtaskCode's trailing number
// (e.g. the "04" in "IT-P00001-T04"). Click to edit, Enter/blur to save,
// Escape to cancel. Conflicts surface the backend's inline error message.
function EditableCode({ code, letter, onRename, disabled }) {
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
function DropLine() {
  return <div className="drop-line my-1 h-0.5 rounded-full" style={{ backgroundColor: BLUE }} />;
}

// ==================== Tasks tab ====================
function TasksTab({ tasks, isStaff, canEdit, statuses, assignableUsers, onOpenTask, onAdd, onToggleTask, onToggleSubtask, onReorder, projectId, onRenumbered }) {
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
                    <span className="whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium" style={{ backgroundColor: `color-mix(in srgb, ${task.status?.color || MUTED} 13%, transparent)`, color: task.status?.color || MUTED }}>
                      {task.status?.name}
                    </span>
                    <span className="flex items-center gap-1 text-xs" style={{ color: MUTED }}>
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: priorityMeta.color }} /> {priorityMeta.label}
                    </span>
                    {task.linkedTicket && (
                      <Link
                        to={`/tickets/${task.linkedTicket.id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
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
                  <div className="flex flex-shrink-0 flex-col gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
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

function AddTaskModal({ statuses, assignableUsers, onClose, onSave }) {
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

function TaskDetailModal({ projectId, task, statuses, assignableUsers, onClose, onChanged, onDeleted }) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description || '');
  const [statusId, setStatusId] = useState(task.statusId);
  const [priority, setPriority] = useState(task.priority);
  const [assignedToUserId, setAssignedToUserId] = useState(task.assignedToUserId || '');
  const [dueDate, setDueDate] = useState(task.dueDate || '');
  const [subtasks, setSubtasks] = useState(task.subtasks || []);
  const [newSubtask, setNewSubtask] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await api.patch(`/projects/${projectId}/tasks/${task.id}`, {
        title, description, statusId, priority, assignedToUserId: assignedToUserId || null, dueDate: dueDate || null,
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
      {task.taskCode && (
        <div className="mb-3">
          <EditableCode code={task.taskCode} letter="T" onRename={renumberTask} />
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
              {st.subtaskCode && <EditableCode code={st.subtaskCode} letter="S" onRename={(n) => renumberSubtask(st, n)} />}
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

// ==================== Time entries tab ====================
function TimeTab({ data, canLogTime, user, isAdmin, onAdd, onDelete }) {
  return (
    <div className="rounded-[10px] border" style={{ backgroundColor: CARD_BG, borderColor: BORDER }}>
      <div className="flex items-center justify-between border-b p-4" style={{ borderColor: BORDER }}>
        <h2 className="font-semibold" style={{ color: TEXT }}>Time Entries</h2>
        {canLogTime && <button onClick={onAdd} className="btn-primary">+ Log time</button>}
      </div>
      <table className="min-w-full">
        <thead>
          <tr>
            {['Description', 'Task', 'Logged by', 'Date', 'Duration', ''].map((h) => (
              <th key={h} className="table-th" style={{ borderBottom: `1px solid ${BORDER}` }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.entries.map((e) => (
            <tr key={e.id}>
              <td className="table-td" style={{ color: TEXT }}>{e.description || '—'}</td>
              <td className="table-td" style={{ color: MUTED }}>{e.task?.title || '—'}</td>
              <td className="table-td" style={{ color: MUTED }}>{e.loggedFor?.displayName || '—'}</td>
              <td className="table-td" style={{ color: MUTED }}>{e.entryDate}</td>
              <td className="table-td font-medium" style={{ color: TEXT }}>{formatSeconds(e.durationSeconds)}</td>
              <td className="table-td">
                {(e.userId === user.id || isAdmin) && (
                  <button onClick={() => onDelete(e.id)} className="text-xs" style={{ color: 'var(--color-danger)' }}>delete</button>
                )}
              </td>
            </tr>
          ))}
          {data.entries.length === 0 && <tr><td colSpan={6} className="table-td" style={{ color: MUTED }}>No time logged yet.</td></tr>}
        </tbody>
      </table>
      <div className="border-t p-4 text-right text-sm font-semibold" style={{ borderColor: BORDER, color: TEXT }}>
        Total: {formatSeconds(data.totalSeconds)}
      </div>
    </div>
  );
}

function AddTimeModal({ tasks, isAdmin, assignableUsers, onClose, onSave }) {
  const [taskId, setTaskId] = useState('');
  const [description, setDescription] = useState('');
  const [loggedForUserId, setLoggedForUserId] = useState('');
  const [entryDate, setEntryDate] = useState(todayStr());
  const [startMinutes, setStartMinutes] = useState(roundToNearest5(new Date()) - 60);
  const [endMinutes, setEndMinutes] = useState(roundToNearest5(new Date()));
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (endMinutes <= startMinutes) return;
    setSaving(true);
    try {
      await onSave({
        taskId: taskId || null,
        description,
        loggedForUserId: loggedForUserId || undefined,
        entryDate,
        startTime: buildLocalDateTime(entryDate, startMinutes),
        endTime: buildLocalDateTime(entryDate, endMinutes),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Log time" onClose={onClose}>
      <TimeEntryFields entryDate={entryDate} onEntryDateChange={setEntryDate} startMinutes={startMinutes} onStartMinutesChange={setStartMinutes} endMinutes={endMinutes} onEndMinutesChange={setEndMinutes} todayStr={todayStr()} />
      <label className="mb-1 block text-sm font-medium" style={{ color: TEXT }}>Task (optional)</label>
      <select className="input mb-3" style={fieldStyle} value={taskId} onChange={(e) => setTaskId(e.target.value)}>
        <option value="">No specific task</option>
        {tasks.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
      </select>
      {isAdmin && (
        <>
          <label className="mb-1 block text-sm font-medium" style={{ color: TEXT }}>Logged for</label>
          <select className="input mb-3" style={fieldStyle} value={loggedForUserId} onChange={(e) => setLoggedForUserId(e.target.value)}>
            <option value="">Myself</option>
            {assignableUsers.map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}
          </select>
        </>
      )}
      <label className="mb-1 block text-sm font-medium" style={{ color: TEXT }}>Description</label>
      <textarea className="input mb-4 resize-y" style={{ ...fieldStyle, minHeight: '60px' }} value={description} onChange={(e) => setDescription(e.target.value)} />
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="rounded-md border px-4 py-2 text-sm font-medium" style={{ borderColor: BORDER, color: TEXT }}>Cancel</button>
        <button onClick={save} disabled={saving || endMinutes <= startMinutes} className="rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" style={{ backgroundColor: BLUE }}>
          {saving ? 'Saving…' : 'Save time entry'}
        </button>
      </div>
    </Modal>
  );
}

// ==================== Expenses tab ====================
const EXPENSE_CATEGORIES = ['materials', 'labor', 'travel', 'equipment', 'other'];
function ExpensesTab({ data, canManageExpenses, onAdd, onDelete }) {
  return (
    <div className="rounded-[10px] border" style={{ backgroundColor: CARD_BG, borderColor: BORDER }}>
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
              <td className="table-td"><span className="rounded-full px-2 py-0.5 text-xs font-medium capitalize" style={{ backgroundColor: BORDER, color: TEXT }}>{e.category}</span></td>
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
      <div className="border-t p-4 text-right text-sm font-semibold" style={{ borderColor: BORDER, color: TEXT }}>Total: {formatCost(data.total)}</div>
    </div>
  );
}
function AddExpenseModal({ tasks, onClose, onSave }) {
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

// ==================== Materials tab ====================
function MaterialsTab({ data, canManageExpenses, onAdd, onDelete }) {
  return (
    <div className="rounded-[10px] border" style={{ backgroundColor: CARD_BG, borderColor: BORDER }}>
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
      <div className="border-t p-4 text-right text-sm font-semibold" style={{ borderColor: BORDER, color: TEXT }}>Total: {formatCost(data.total)}</div>
    </div>
  );
}
function AddMaterialModal({ tasks, onClose, onSave }) {
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
      <div className="mb-3 grid grid-cols-3 gap-3">
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

// ==================== People tab ====================
function PeopleTab({ members, project, canManageMembers, onAdd, onRemove }) {
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
function AddPersonModal({ directory, existingIds, onClose, onSave }) {
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

// ==================== Files tab ====================
function FilesTab({ files, onUpload, onDelete }) {
  const inputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);
  const handleFiles = (fl) => Array.from(fl).forEach((f) => onUpload(f));

  return (
    <div>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
        onClick={() => inputRef.current?.click()}
        className="mb-4 cursor-pointer rounded-md border-2 border-dashed p-6 text-center"
        style={{ borderColor: dragOver ? BLUE : BORDER, backgroundColor: dragOver ? 'color-mix(in srgb, var(--color-accent) 8%, var(--color-bg))' : BG }}
      >
        <IconUpload size={22} style={{ color: MUTED, margin: '0 auto' }} />
        <p className="mt-2 text-sm" style={{ color: TEXT }}>Drag &amp; drop files here or click to browse</p>
        <input ref={inputRef} type="file" multiple className="hidden" onChange={(e) => { handleFiles(e.target.files); e.target.value = ''; }} />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        {files.map((f) => (
          <div key={f.id} className="relative rounded-[10px] border p-3" style={{ backgroundColor: CARD_BG, borderColor: BORDER }}>
            <a href={`/api/v1/projects/${f.projectId}/files/${f.id}/download`} target="_blank" rel="noreferrer" className="flex flex-col items-center gap-2">
              <IconFile size={28} style={{ color: MUTED }} />
              <span className="w-full truncate text-center text-xs font-medium" style={{ color: TEXT }}>{f.filename}</span>
              <span className="text-[10px]" style={{ color: MUTED }}>{Math.round(f.filesize / 1024)} KB</span>
            </a>
            <button onClick={() => onDelete(f.id)} className="absolute right-1 top-1" style={{ color: MUTED }}><IconTrash size={14} /></button>
          </div>
        ))}
        {files.length === 0 && <p className="col-span-full text-center text-sm" style={{ color: MUTED }}>No files uploaded yet.</p>}
      </div>
    </div>
  );
}

// ==================== Activity tab ====================
const ACTIVITY_LABELS = {
  project_created: 'created the project',
  status_changed: 'changed the status',
  task_created: 'created a task',
  task_closed: 'closed a task',
  task_deleted: 'deleted a task',
  subtask_closed: 'closed a subtask',
  time_logged: 'logged time',
  expense_added: 'added an expense',
  material_added: 'added a material',
  member_added: 'added a member',
  file_uploaded: 'uploaded a file',
};
function ActivityTab({ activity }) {
  return (
    <div className="rounded-[10px] border" style={{ backgroundColor: CARD_BG, borderColor: BORDER }}>
      <ul className="divide-y" style={{ borderColor: BORDER }}>
        {activity.map((a) => {
          const code = a.detail?.projectCode || a.detail?.taskCode || a.detail?.subtaskCode;
          return (
            <li key={a.id} className="flex items-center justify-between px-4 py-3 text-sm">
              <span style={{ color: TEXT }}>
                <strong>{a.user?.displayName || 'System'}</strong> {ACTIVITY_LABELS[a.action] || a.action}
                {code && <> — <code className="font-mono text-xs" style={{ color: MUTED }}>{code}</code></>}
                {a.detail?.title && <> {a.detail.title}</>}
                {a.detail?.name && <> {a.detail.name}</>}
              </span>
              <span style={{ color: MUTED }}>{new Date(a.createdAt).toLocaleString()}</span>
            </li>
          );
        })}
        {activity.length === 0 && <li className="px-4 py-6 text-center text-sm" style={{ color: MUTED }}>No activity yet.</li>}
      </ul>
    </div>
  );
}
