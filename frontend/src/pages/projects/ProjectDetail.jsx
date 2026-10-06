// Project detail page: header, stats and tabs. The tabs live in ./detail/.
import { useEffect, useState } from 'react';
import CompanyTag from '../../components/companies/CompanyTag';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { IconFileText } from '@tabler/icons-react';
import api, { errMessage } from '../../api/api';
import { useAuth, usePermission } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import Spinner from '../../components/Spinner';
import { Modal } from './detail/Modal';
import {
  BG,
  CARD_BG,
  BORDER,
  TEXT,
  MUTED,
  BLUE,
  fieldStyle,
  formatSeconds,
  formatCost,
  completionColor,
} from './theme';
import { Avatar, StatCard } from './detail/Bits';
import { TasksTab, AddTaskModal } from './detail/TasksTab';
import { TimeTab, AddTimeModal } from './detail/TimeTab';
import { ExpensesTab, AddExpenseModal } from './detail/ExpensesTab';
import { MaterialsTab, AddMaterialModal } from './detail/MaterialsTab';
import { PeopleTab, AddPersonModal } from './detail/PeopleTab';
import { FilesTab } from './detail/FilesTab';
import { ActivityTab } from './detail/ActivityTab';
import { TaskDetailModal } from './detail/TaskDetailModal';

// Rows loaded at a time by the growing detail lists.
const SUBLIST_STEP = 25;

const TABS = [
  { key: 'tasks', label: 'Tasks' },
  { key: 'time', label: 'Time Entries' },
  { key: 'expenses', label: 'Expenses' },
  { key: 'materials', label: 'Materials' },
  { key: 'people', label: 'People' },
  { key: 'files', label: 'Files' },
  { key: 'activity', label: 'Activity' },
];

// Fixed set of sections (no configurable filters), so this modal is mainly
// a preview + loading state while the PDF streams down.
function GenerateProjectReportModal({ projectId, projectCode, onClose }) {
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');

  const generate = async () => {
    setGenerating(true);
    setError('');
    try {
      const res = await api.get(`/projects/${projectId}/report`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `project-[${projectCode}]-report.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      onClose();
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setGenerating(false);
    }
  };

  return (
    <Modal title="Generate report" onClose={onClose}>
      <p className="mb-4 text-sm" style={{ color: MUTED }}>
        Generates a PDF summarizing this project — team, tasks and subtasks, time entries grouped
        by tech with internal/contractor cost breakdown, expenses, materials, and an overall cost
        summary.
      </p>
      {error && <div className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-md border px-4 py-2 text-sm font-medium" style={{ borderColor: BORDER, color: TEXT }}>
          Cancel
        </button>
        <button
          type="button"
          onClick={generate}
          disabled={generating}
          className="flex items-center gap-1.5 rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          style={{ backgroundColor: BLUE }}
        >
          <IconFileText size={15} />
          {generating ? 'Generating…' : 'Generate PDF'}
        </button>
      </div>
    </Modal>
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
  // Project tasks have their own status list (sub-project 3), separate from the project's.
  const [taskStatuses, setTaskStatuses] = useState([]);
  const [assignableUsers, setAssignableUsers] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [teams, setTeams] = useState([]);
  const [directory, setDirectory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('tasks');
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [reportModalOpen, setReportModalOpen] = useState(false);

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

  // How many rows of each growing list are currently loaded. Passed as the
  // request's `limit` so a refetch after an edit doesn't collapse the list
  // back to the first chunk.
  const [timeLimit, setTimeLimit] = useState(SUBLIST_STEP);
  const [expenseLimit, setExpenseLimit] = useState(SUBLIST_STEP);
  const [materialLimit, setMaterialLimit] = useState(SUBLIST_STEP);
  const [activityLimit, setActivityLimit] = useState(SUBLIST_STEP);
  const [activityTotal, setActivityTotal] = useState(0);

  const loadAll = async () => {
    try {
      const [p, t, te, ex, mat, mem, fl, act] = await Promise.all([
        api.get(`/projects/${id}`),
        api.get(`/projects/${id}/tasks`),
        api.get(`/projects/${id}/time-entries`, { params: { limit: timeLimit } }),
        api.get(`/projects/${id}/expenses`, { params: { limit: expenseLimit } }),
        api.get(`/projects/${id}/materials`, { params: { limit: materialLimit } }),
        api.get(`/projects/${id}/members`),
        api.get(`/projects/${id}/files`),
        api.get(`/projects/${id}/activity`, { params: { limit: activityLimit } }),
      ]);
      setProject(p.data.project);
      setTasks(t.data.tasks);
      setTimeEntries(te.data);
      setExpenses(ex.data);
      setMaterials(mat.data);
      setMembers(mem.data.members);
      setFiles(fl.data.files);
      setActivity(act.data.activity);
      setActivityTotal(act.data.total);
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, timeLimit, expenseLimit, materialLimit, activityLimit]);

  useEffect(() => {
    api.get('/project-statuses').then(({ data }) => setStatuses(data.statuses)).catch(() => {});
    api.get('/task-statuses', { params: { scope: 'project' } }).then(({ data }) => setTaskStatuses(data.statuses)).catch(() => {});
    api.get('/departments').then(({ data }) => setDepartments(data.departments)).catch(() => {});
    api.get('/teams').then(({ data }) => setTeams(data.teams)).catch(() => {});
    api.get('/users/directory').then(({ data }) => setDirectory(data.users)).catch(() => {});
    if (isStaff) api.get('/users/assignable').then(({ data }) => setAssignableUsers(data.users)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reloadTasks = () => api.get(`/projects/${id}/tasks`).then(({ data }) => setTasks(data.tasks));
  const reloadProject = () => api.get(`/projects/${id}`).then(({ data }) => setProject(data.project));
  const reloadActivity = () => api.get(`/projects/${id}/activity`, { params: { limit: activityLimit } })
    .then(({ data }) => { setActivity(data.activity); setActivityTotal(data.total); });
  const reloadTime = () => api.get(`/projects/${id}/time-entries`, { params: { limit: timeLimit } }).then(({ data }) => setTimeEntries(data));
  const reloadExpenses = () => api.get(`/projects/${id}/expenses`, { params: { limit: expenseLimit } }).then(({ data }) => setExpenses(data));
  const reloadMaterials = () => api.get(`/projects/${id}/materials`, { params: { limit: materialLimit } }).then(({ data }) => setMaterials(data));

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
    const closedStatus = taskStatuses.find((s) => s.behaviorType === 'closed');
    const openStatus = taskStatuses.find((s) => s.behaviorType === 'open');
    const target = task.isComplete ? openStatus : closedStatus;
    if (!target) return;
    await api.patch(`/projects/${id}/tasks/${task.id}`, { statusId: target.id });
    await reloadTasks();
    await reloadProject();
    await reloadActivity();
  };

  const toggleSubtaskComplete = async (task, subtask) => {
    const closedStatus = taskStatuses.find((s) => s.behaviorType === 'closed');
    const openStatus = taskStatuses.find((s) => s.behaviorType === 'open');
    const isClosed = taskStatuses.find((s) => s.id === subtask.statusId)?.behaviorType === 'closed';
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
                className="cursor-pointer text-2xl font-bold tracking-tight hover:opacity-80"
                style={{ color: TEXT }}
                onClick={() => { if (isStaff) { setNameDraft(project.name); setEditingName(true); } }}
                title={isStaff ? 'Click to rename' : ''}
              >
                {project.name}
              </h1>
            )}
            <span
              className="whitespace-nowrap rounded-[3px] px-2.5 py-0.5 text-xs font-medium"
              style={{ backgroundColor: `color-mix(in srgb, ${statusMeta?.color || MUTED} 13%, transparent)`, color: statusMeta?.color || MUTED }}
            >
              {project.status}
            </span>
          </div>
          <p className="mt-1 text-sm" style={{ color: MUTED }}>
            <CompanyTag company={project.company} />
            {project.ownerDepartment?.name && (
              <span className="rounded-[3px] px-2 py-0.5 text-xs font-medium" style={{ backgroundColor: 'color-mix(in srgb, var(--color-accent) 15%, transparent)', color: BLUE }}>
                {project.ownerDepartment.name}
              </span>
            )}
            {project.forDepartment?.name && project.forDepartment.name !== project.ownerDepartment?.name && (
              <>
                {' → '}
                <span className="rounded-[3px] px-2 py-0.5 text-xs font-medium" style={{ backgroundColor: 'color-mix(in srgb, var(--color-success) 15%, transparent)', color: 'var(--color-success)' }}>
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
                  className="rounded-[3px] px-2 py-0.5 text-xs font-medium hover:opacity-75"
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
            <button
              type="button"
              onClick={() => setReportModalOpen(true)}
              className="flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium"
              style={{ borderColor: BORDER, color: MUTED }}
            >
              <IconFileText size={13} />
              Generate report
            </button>
            {canDeleteProjects && <button onClick={deleteProject} className="btn-danger">Delete</button>}
          </div>
        )}
      </div>

      {reportModalOpen && (
        <GenerateProjectReportModal
          projectId={id}
          projectCode={project.projectCode}
          onClose={() => setReportModalOpen(false)}
        />
      )}

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
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
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
      <div className="flex flex-shrink-0 overflow-x-auto" style={{ backgroundColor: CARD_BG, borderBottom: `1px solid ${BORDER}` }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className="-mb-px flex-shrink-0 whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium"
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
          statuses={taskStatuses}
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
            await reloadTime();
            reloadProject();
          }}
          onLoadMore={() => setTimeLimit((n) => n + SUBLIST_STEP)}
        />
      )}
      {tab === 'expenses' && (
        <ExpensesTab data={expenses} canManageExpenses={canManageExpenses} onAdd={() => setShowAddExpense(true)} onDelete={async (expId) => {
          await api.delete(`/projects/${id}/expenses/${expId}`);
          await reloadExpenses();
          reloadProject();
        }} onLoadMore={() => setExpenseLimit((n) => n + SUBLIST_STEP)} />
      )}
      {tab === 'materials' && (
        <MaterialsTab data={materials} canManageExpenses={canManageExpenses} onAdd={() => setShowAddMaterial(true)} onDelete={async (matId) => {
          await api.delete(`/projects/${id}/materials/${matId}`);
          await reloadMaterials();
          reloadProject();
        }} onLoadMore={() => setMaterialLimit((n) => n + SUBLIST_STEP)} />
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
      {tab === 'activity' && (
        <ActivityTab
          activity={activity}
          total={activityTotal}
          onLoadMore={() => setActivityLimit((n) => n + SUBLIST_STEP)}
        />
      )}

      {/* ---- Modals ---- */}
      {showAddTask && (
        <AddTaskModal
          statuses={taskStatuses}
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
          statuses={taskStatuses}
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
            await reloadTime();
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
            await reloadExpenses();
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
            await reloadMaterials();
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
