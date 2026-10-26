// Project detail page: header, stats and tabs. The tabs live in ./detail/.
import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api, { errMessage } from '../../api/api';
import { useAuth, usePermission } from '../../context/AuthContext';
import Spinner from '../../components/Spinner';
import TimeLog from '../../components/work/TimeLog';
import TimeEntryForm from '../../components/work/TimeEntryForm';
import Tabs from '../../components/ui/Tabs';
import Button from '../../components/ui/Button';
import Notice from '../../components/ui/Notice';
import { useTimer } from '../../context/TimerContext';
import { AddExpenseModal } from './detail/ExpensesTab';
import { AddMaterialModal } from './detail/MaterialsTab';
import { PeopleTab, AddPersonModal } from './detail/PeopleTab';
import { FilesTab } from './detail/FilesTab';
import { ActivityTab } from './detail/ActivityTab';
import ProjectHeader from './detail/ProjectHeader';
import SummaryRow from './detail/SummaryRow';
import TasksTab from './detail/TasksTab';
import CostsTab from './detail/CostsTab';
import BudgetPanel from './detail/BudgetPanel';
import TimelineTab from './detail/TimelineTab';
import GenerateProjectReportModal from './detail/ReportModal';
import { hoursFromMinutes, localToday } from './detail/taskFilters';

// Rows loaded at a time by the growing detail lists.
const SUBLIST_STEP = 25;

export default function ProjectDetail() {
  const { id } = useParams();
  const { isStaff, user, hasAnyPermission, canLogTimeForOthers } = useAuth();
  const canDeleteProjects = usePermission('projects.delete');
  const canManageMembers = usePermission('projects.manage_members');
  const canManageExpenses = usePermission('projects.manage_expenses');
  // Your own time needs time.log and view access, which being here means (as the server does).
  const canLogTime = usePermission('time.log');
  const canEditProjectContent = hasAnyPermission(['projects.edit_own', 'projects.edit_department', 'projects.edit_all']);
  const navigate = useNavigate();

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
  const [addFocus, setAddFocus] = useState(0);
  const [reportModalOpen, setReportModalOpen] = useState(false);

  const [tasks, setTasks] = useState([]);
  const [phases, setPhases] = useState([]);
  const [expenses, setExpenses] = useState({ expenses: [], total: 0 });
  const [materials, setMaterials] = useState({ materials: [], total: 0 });
  const [members, setMembers] = useState([]);
  const [files, setFiles] = useState([]);
  const [activity, setActivity] = useState([]);

  // A stopped header timer, waiting in the Log time form.
  const [stoppedTimer, setStoppedTimer] = useState(null);
  const [logging, setLogging] = useState(false); // the phone dock's Log time form
  const { logVersion } = useTimer();
  const [showAddExpense, setShowAddExpense] = useState(false);
  const [showAddMaterial, setShowAddMaterial] = useState(false);
  const [showAddPerson, setShowAddPerson] = useState(false);
  const [closeWarning, setCloseWarning] = useState(false);
  const [dismissedCloseWarning, setDismissedCloseWarning] = useState(false);

  // How many rows of each growing list are currently loaded. Passed as the
  // request's `limit` so a refetch after an edit doesn't collapse the list
  // back to the first chunk.
  const [expenseLimit, setExpenseLimit] = useState(SUBLIST_STEP);
  const [materialLimit, setMaterialLimit] = useState(SUBLIST_STEP);
  const [activityLimit, setActivityLimit] = useState(SUBLIST_STEP);
  const [activityTotal, setActivityTotal] = useState(0);

  const loadAll = async () => {
    try {
      const [p, t, ph, ex, mat, mem, fl, act] = await Promise.all([
        api.get(`/projects/${id}`),
        api.get(`/projects/${id}/tasks`),
        api.get(`/projects/${id}/phases`),
        api.get(`/projects/${id}/expenses`, { params: { limit: expenseLimit } }),
        api.get(`/projects/${id}/materials`, { params: { limit: materialLimit } }),
        api.get(`/projects/${id}/members`),
        api.get(`/projects/${id}/files`),
        api.get(`/projects/${id}/activity`, { params: { limit: activityLimit } }),
      ]);
      setProject(p.data.project);
      setTasks(t.data.tasks);
      setPhases(ph.data.phases);
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
  }, [id, expenseLimit, materialLimit, activityLimit]);

  useEffect(() => {
    api.get('/project-statuses').then(({ data }) => setStatuses(data.statuses)).catch(() => {});
    api.get('/task-statuses', { params: { scope: 'project' } }).then(({ data }) => setTaskStatuses(data.statuses)).catch(() => {});
    api.get('/departments').then(({ data }) => setDepartments(data.departments)).catch(() => {});
    api.get('/teams').then(({ data }) => setTeams(data.teams)).catch(() => {});
    api.get('/users/directory').then(({ data }) => setDirectory(data.users)).catch(() => {});
    if (isStaff) api.get('/users/assignable').then(({ data }) => setAssignableUsers(data.users)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reloadTasks = () => Promise.all([
    api.get(`/projects/${id}/tasks`).then(({ data }) => setTasks(data.tasks)),
    api.get(`/projects/${id}/phases`).then(({ data }) => setPhases(data.phases)),
  ]);
  // After tasks or time change: tasks (their times), the project's stats, activity.
  const reloadAll = () => Promise.all([reloadTasks(), reloadProject(), reloadActivity()]).catch(() => {});
  const reloadProject = () => api.get(`/projects/${id}`).then(({ data }) => setProject(data.project));
  const reloadActivity = () => api.get(`/projects/${id}/activity`, { params: { limit: activityLimit } })
    .then(({ data }) => { setActivity(data.activity); setActivityTotal(data.total); });
  const reloadExpenses = () => api.get(`/projects/${id}/expenses`, { params: { limit: expenseLimit } }).then(({ data }) => setExpenses(data));
  const reloadMaterials = () => api.get(`/projects/${id}/materials`, { params: { limit: materialLimit } }).then(({ data }) => setMaterials(data));

  // Time the server logged by itself (a timer switched or stopped anywhere).
  useEffect(() => {
    if (project) reloadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logVersion]);

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

  if (loading) return <Spinner />;
  if (error) return <div className="rounded-md bg-red-50 p-4 text-red-700">{error}</div>;
  if (!project) return null;

  // What the viewer may change here (the server re-checks every request).
  const canEdit = !!project.access?.edit;
  const statusMeta = statuses.find((s) => s.name === project.status);
  const stats = project.stats || {};
  const today = localToday();
  const estimateMinutes = tasks.reduce((n, t) => n + (t.estimateMinutes || 0), 0);
  const tabs = [
    { id: 'tasks', label: 'Tasks', count: stats.tasksTotal },
    { id: 'timeline', label: 'Timeline' },
    { id: 'time', label: 'Time', count: `${hoursFromMinutes(stats.loggedMinutes)} h` },
    { id: 'costs', label: 'Costs' },
    { id: 'files', label: 'Files', count: files.length },
    { id: 'people', label: 'People', count: members.length },
    { id: 'activity', label: 'Activity' },
  ];

  return (
    <div className="mx-auto max-w-[1280px]">
      <ProjectHeader
        project={project}
        statusMeta={statusMeta}
        canEdit={canEdit}
        isStaff={isStaff}
        canLogTime={canLogTime}
        canDelete={canDeleteProjects && !!project.access?.delete}
        canSaveTemplate={hasAnyPermission(['projects.manage_templates'])}
        patchProject={patchProject}
        onStopRequest={setStoppedTimer}
        onAddTask={() => { setTab('tasks'); setAddFocus((n) => n + 1); }}
        onReport={() => setReportModalOpen(true)}
        onDelete={deleteProject}
      />

      {reportModalOpen && (
        <GenerateProjectReportModal
          projectId={id}
          projectCode={project.projectCode}
          onClose={() => setReportModalOpen(false)}
        />
      )}

      {/* Close-project warning */}
      {closeWarning && canEdit && (
        <Notice tone="warn" className="mt-4 justify-between">
          <p className="font-medium">All tasks are complete. Would you like to mark this project as closed?</p>
          <div className="flex flex-shrink-0 gap-2">
            <Button size="sm" onClick={() => setDismissedCloseWarning(true)}>Not yet</Button>
            <Button size="sm" variant="primary" onClick={closeProjectNow}>Close project</Button>
          </div>
        </Notice>
      )}

      <SummaryRow stats={stats} estimateMinutes={estimateMinutes} today={today} onChangeBudget={canEdit ? () => setTab('time') : undefined} />

      <Tabs items={tabs} value={tab} onChange={setTab} label="Project sections" className="mt-7" />

      <div className="mt-4 space-y-5">
      {tab === 'tasks' && (
        <TasksTab
          projectId={project.id}
          tasks={tasks}
          phases={phases}
          statuses={taskStatuses}
          assignableUsers={assignableUsers}
          canEdit={canEdit}
          canLog={canLogTime}
          canManageOthers={canLogTimeForOthers}
          currentUser={user}
          timerLabel={`${project.projectCode} ${project.name}`}
          today={today}
          addFocus={addFocus}
          activity={activity}
          onStopRequest={setStoppedTimer}
          onLogTime={() => setLogging(true)}
          onChanged={reloadAll}
        />
      )}
      {tab === 'timeline' && (
        <TimelineTab
          projectId={project.id}
          tasks={tasks}
          phases={phases}
          canEdit={canEdit}
          today={today}
          onChanged={reloadAll}
        />
      )}
      {tab === 'time' && (
        <BudgetPanel project={project} canEdit={canEdit} version={`${logVersion}-${stats.loggedMinutes}`} onSaved={reloadAll} />
      )}
      {tab === 'time' && (
        <TimeLog
          kind="project"
          parentId={project.id}
          tasks={tasks}
          canLog={canLogTime}
          canManageOthers={canLogTimeForOthers}
          currentUser={user}
          reloadKey={logVersion}
          onChanged={reloadAll}
        />
      )}
      {tab === 'costs' && (
        <CostsTab
          expenses={expenses}
          materials={materials}
          canManage={canManageExpenses && canEdit}
          onAddExpense={() => setShowAddExpense(true)}
          onDeleteExpense={async (expId) => {
            await api.delete(`/projects/${id}/expenses/${expId}`);
            await reloadExpenses();
            reloadProject();
          }}
          onMoreExpenses={() => setExpenseLimit((n) => n + SUBLIST_STEP)}
          onAddMaterial={() => setShowAddMaterial(true)}
          onDeleteMaterial={async (matId) => {
            await api.delete(`/projects/${id}/materials/${matId}`);
            await reloadMaterials();
            reloadProject();
          }}
          onMoreMaterials={() => setMaterialLimit((n) => n + SUBLIST_STEP)}
        />
      )}
      {tab === 'people' && (
        <PeopleTab
          members={members}
          project={project}
          canManageMembers={canManageMembers && canEdit}
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
          canUpload={canEditProjectContent}
          canDelete={(f) => f.uploadedBy === user.id || !!project.access?.moderate}
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

      </div>

      {/* ---- Modals ---- */}
      {stoppedTimer && (
        <TimeEntryForm
          kind="project"
          parentId={project.id}
          tasks={tasks}
          timer={stoppedTimer}
          canManageOthers={canLogTimeForOthers}
          currentUser={user}
          onSaved={reloadAll}
          onClose={() => setStoppedTimer(null)}
        />
      )}

      {logging && (
        <TimeEntryForm
          kind="project"
          parentId={project.id}
          tasks={tasks}
          canManageOthers={canLogTimeForOthers}
          currentUser={user}
          onSaved={reloadAll}
          onClose={() => setLogging(false)}
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
