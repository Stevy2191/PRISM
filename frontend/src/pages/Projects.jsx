import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api, { errMessage } from '../api/api';
import { useAuth } from '../context/AuthContext';
import Spinner from '../components/Spinner';

const BORDER = 'var(--color-border)';
const CARD_BG = 'var(--color-card)';
const TEXT = 'var(--color-text-primary)';
const MUTED = 'var(--color-text-muted)';
const BLUE = 'var(--color-accent)';

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase();
}

function dueDateColor(dueDate, closed) {
  if (!dueDate || closed) return MUTED;
  const days = Math.round((new Date(dueDate) - new Date(todayStr())) / 86400000);
  if (days < 0) return 'var(--color-danger)';
  if (days <= 14) return 'var(--color-warning)';
  return MUTED;
}

function formatCost(n) {
  return `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function StatusBadge({ status, color }) {
  const c = color || MUTED;
  return (
    <span
      className="whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium"
      style={{ backgroundColor: `color-mix(in srgb, ${c} 13%, transparent)`, color: c }}
    >
      {status}
    </span>
  );
}

function DeptLine({ project }) {
  const owner = project.ownerDepartment?.name;
  const forDept = project.forDepartment?.name;
  if (!owner && !forDept) return <span style={{ color: MUTED }}>No department</span>;
  if (owner && forDept && owner !== forDept) {
    return <span>Owned by <strong>{owner}</strong> → For <strong>{forDept}</strong></span>;
  }
  return <span>{owner || forDept}</span>;
}

function AvatarStack({ members }) {
  const shown = members.slice(0, 4);
  const extra = members.length - shown.length;
  return (
    <div className="flex items-center -space-x-2">
      {shown.map((m) => (
        <span
          key={m.id}
          title={m.user?.displayName}
          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border-2 text-[10px] font-semibold"
          style={{ backgroundColor: 'var(--color-accent)', color: 'white', borderColor: CARD_BG }}
        >
          {initials(m.user?.displayName)}
        </span>
      ))}
      {extra > 0 && (
        <span
          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border-2 text-[10px] font-semibold"
          style={{ backgroundColor: BORDER, color: TEXT, borderColor: CARD_BG }}
        >
          +{extra}
        </span>
      )}
    </div>
  );
}

function ProgressBar({ percent, label }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs" style={{ color: MUTED }}>
        <span>{label}</span>
        <span>{percent}%</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ backgroundColor: BORDER }}>
        <div className="h-full rounded-full" style={{ width: `${percent}%`, backgroundColor: BLUE }} />
      </div>
    </div>
  );
}

export default function Projects() {
  const { isStaff } = useAuth();
  const navigate = useNavigate();
  const [projects, setProjects] = useState([]);
  const [statuses, setStatuses] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [assignableUsers, setAssignableUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [ownerDeptFilter, setOwnerDeptFilter] = useState('');
  const [forDeptFilter, setForDeptFilter] = useState('');
  const [assigneeFilter, setAssigneeFilter] = useState('');
  const [myProjects, setMyProjects] = useState(false);
  const [overdue, setOverdue] = useState(false);
  const [view, setView] = useState('card');

  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [bulkActionType, setBulkActionType] = useState('');
  const [bulkValue, setBulkValue] = useState('');
  const [bulkSaving, setBulkSaving] = useState(false);
  const [showBulkBar, setShowBulkBar] = useState(false);
  const [bulkBarClosing, setBulkBarClosing] = useState(false);

  const load = () => {
    setLoading(true);
    const params = {};
    if (search) params.search = search;
    if (statusFilter) params.status = statusFilter;
    if (ownerDeptFilter) params.ownerDept = ownerDeptFilter;
    if (forDeptFilter) params.forDept = forDeptFilter;
    if (assigneeFilter) params.assignee = assigneeFilter;
    if (myProjects) params.myProjects = 'true';
    if (overdue) params.overdue = 'true';
    api.get('/projects', { params })
      .then(({ data }) => setProjects(data.projects))
      .catch((err) => setError(errMessage(err)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    api.get('/project-statuses').then(({ data }) => setStatuses(data.statuses)).catch(() => {});
    api.get('/departments').then(({ data }) => setDepartments(data.departments)).catch(() => {});
    if (isStaff) api.get('/users/assignable').then(({ data }) => setAssignableUsers(data.users)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, statusFilter, ownerDeptFilter, forDeptFilter, assigneeFilter, myProjects, overdue]);

  useEffect(() => {
    if (selectedIds.size > 0) {
      setBulkBarClosing(false);
      setShowBulkBar(true);
    } else if (showBulkBar) {
      setBulkBarClosing(true);
      const t = setTimeout(() => { setShowBulkBar(false); setBulkBarClosing(false); }, 180);
      return () => clearTimeout(t);
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds.size]);

  const colorFor = (name) => statuses.find((s) => s.name === name)?.color;
  const allSelected = projects.length > 0 && selectedIds.size === projects.length;
  const toggleSelectAll = () => setSelectedIds(allSelected ? new Set() : new Set(projects.map((p) => p.id)));
  const toggleOne = (id) => setSelectedIds((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const clearSelection = () => setSelectedIds(new Set());

  const applyBulkAction = async () => {
    if (!bulkActionType) return;
    setBulkSaving(true);
    try {
      const ids = [...selectedIds];
      if (bulkActionType === 'status') {
        await Promise.all(ids.map((id) => api.patch(`/projects/${id}`, { status: bulkValue })));
      } else if (bulkActionType === 'lead') {
        await Promise.all(ids.map((id) => api.patch(`/projects/${id}`, { assignedToUserId: bulkValue })));
      } else if (bulkActionType === 'close') {
        const closedStatus = statuses.find((s) => s.behaviorType === 'closed');
        if (closedStatus) await Promise.all(ids.map((id) => api.patch(`/projects/${id}`, { status: closedStatus.name })));
      }
      clearSelection();
      setBulkActionType('');
      setBulkValue('');
      load();
    } catch (err) {
      alert(errMessage(err));
    } finally {
      setBulkSaving(false);
    }
  };

  const deleteProject = async (id, name) => {
    if (!confirm(`Delete project "${name}"? This cannot be undone.`)) return;
    try {
      await api.delete(`/projects/${id}`);
      load();
    } catch (err) {
      alert(errMessage(err));
    }
  };

  const totalCost = useMemo(() => (p) => Number(p.totalCost || 0), []);

  return (
    <div style={{ margin: '-2rem -1.5rem', padding: 0, height: '100vh' }} className="flex flex-col overflow-hidden bg-navy-50">
      <div className="flex-shrink-0 space-y-3 px-6 py-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold" style={{ color: TEXT }}>Projects</h1>
          {isStaff && <Link to="/projects/new" className="btn-primary">+ New Project</Link>}
        </div>

        <div className="flex flex-wrap items-center gap-2 lg:flex-nowrap">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or description…"
            className="input h-9 flex-1 text-sm"
            style={{ backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: TEXT }}
          />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="input h-9 flex-shrink-0 text-sm"
            style={{ backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: TEXT, maxWidth: '10rem' }}
          >
            <option value="">All statuses</option>
            {statuses.map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
          </select>
          <select
            value={ownerDeptFilter}
            onChange={(e) => setOwnerDeptFilter(e.target.value)}
            className="input h-9 flex-shrink-0 text-sm"
            style={{ backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: TEXT, maxWidth: '11rem' }}
          >
            <option value="">Owned by (any dept)</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <select
            value={forDeptFilter}
            onChange={(e) => setForDeptFilter(e.target.value)}
            className="input h-9 flex-shrink-0 text-sm"
            style={{ backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: TEXT, maxWidth: '11rem' }}
          >
            <option value="">For (any dept)</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          {isStaff && (
            <select
              value={assigneeFilter}
              onChange={(e) => setAssigneeFilter(e.target.value)}
              className="input h-9 flex-shrink-0 text-sm"
              style={{ backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: TEXT, maxWidth: '11rem' }}
            >
              <option value="">All leads</option>
              {assignableUsers.map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}
            </select>
          )}
          <button
            type="button"
            onClick={() => setMyProjects((v) => !v)}
            className="h-9 flex-shrink-0 rounded-md border px-3 text-sm font-medium"
            style={{ borderColor: myProjects ? BLUE : BORDER, backgroundColor: myProjects ? BLUE : CARD_BG, color: myProjects ? 'white' : TEXT }}
          >
            My projects
          </button>
          <button
            type="button"
            onClick={() => setOverdue((v) => !v)}
            className="h-9 flex-shrink-0 rounded-md border px-3 text-sm font-medium"
            style={{ borderColor: overdue ? 'var(--color-danger)' : BORDER, backgroundColor: overdue ? 'var(--color-danger)' : CARD_BG, color: overdue ? 'white' : TEXT }}
          >
            Overdue
          </button>
          <div className="flex flex-shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setView('card')}
              className="h-9 rounded-md border px-3 text-sm font-medium"
              style={{ backgroundColor: view === 'card' ? BLUE : CARD_BG, color: view === 'card' ? 'white' : TEXT, borderColor: BORDER }}
            >
              Card
            </button>
            <button
              type="button"
              onClick={() => setView('table')}
              className="h-9 rounded-md border px-3 text-sm font-medium"
              style={{ backgroundColor: view === 'table' ? BLUE : CARD_BG, color: view === 'table' ? 'white' : TEXT, borderColor: BORDER }}
            >
              Table
            </button>
          </div>
        </div>

        {error && <div className="rounded-md bg-red-50 p-4 text-red-700">{error}</div>}
      </div>

      {isStaff && view === 'table' && showBulkBar && (
        <div
          className={`flex flex-shrink-0 items-center ${bulkBarClosing ? 'bulk-bar--closing' : 'bulk-bar--opening'}`}
          style={{
            gap: '12px',
            padding: '8px 16px',
            backgroundColor: 'color-mix(in srgb, var(--color-accent) 12%, transparent)',
            borderBottom: '1px solid color-mix(in srgb, var(--color-accent) 35%, transparent)',
          }}
        >
          <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} className="h-4 w-4 flex-shrink-0 accent-blue-500" />
          <span className="flex-shrink-0 whitespace-nowrap font-medium" style={{ color: BLUE, fontSize: '13px' }}>
            {selectedIds.size} selected
          </span>
          <span className="flex-shrink-0 whitespace-nowrap" style={{ color: MUTED, fontSize: '12px' }}>Action:</span>
          <select
            value={bulkActionType}
            onChange={(e) => { setBulkActionType(e.target.value); setBulkValue(''); }}
            className="input h-9 max-w-[11rem] flex-shrink-0 text-sm"
            style={{ backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: TEXT }}
          >
            <option value="">Choose action…</option>
            <option value="status">Change status</option>
            <option value="lead">Reassign lead</option>
            <option value="close">Close selected</option>
          </select>
          {bulkActionType === 'status' && (
            <select value={bulkValue} onChange={(e) => setBulkValue(e.target.value)} className="input h-9 max-w-[9rem] flex-shrink-0 text-sm" style={{ backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: TEXT }}>
              <option value="">Select status…</option>
              {statuses.map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
            </select>
          )}
          {bulkActionType === 'lead' && (
            <select value={bulkValue} onChange={(e) => setBulkValue(e.target.value)} className="input h-9 max-w-[11rem] flex-shrink-0 text-sm" style={{ backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: TEXT }}>
              <option value="">Select lead…</option>
              {assignableUsers.map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}
            </select>
          )}
          <button
            type="button"
            onClick={applyBulkAction}
            disabled={bulkSaving || !bulkActionType || (bulkActionType !== 'close' && !bulkValue)}
            className="flex-shrink-0 rounded-md px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
            style={{ backgroundColor: BLUE }}
          >
            Apply
          </button>
          <button type="button" onClick={clearSelection} className="flex-shrink-0 whitespace-nowrap text-sm hover:underline" style={{ color: MUTED, marginLeft: 'auto' }}>
            Clear selection
          </button>
        </div>
      )}

      <div className="px-6 pb-6" style={{ flex: '1 1 auto', minHeight: 0, overflow: 'auto' }}>
        {loading ? (
          <div className="flex h-full items-center justify-center"><Spinner /></div>
        ) : projects.length === 0 ? (
          <div className="mt-4 rounded-[10px] border p-8 text-center" style={{ backgroundColor: CARD_BG, borderColor: BORDER, color: MUTED }}>
            No projects yet.
          </div>
        ) : view === 'card' ? (
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {projects.map((p) => {
              const closed = statuses.find((s) => s.name === p.status)?.behaviorType === 'closed';
              return (
                <div
                  key={p.id}
                  className="group relative rounded-[10px] border p-5 transition hover:shadow-md"
                  style={{ backgroundColor: CARD_BG, borderColor: BORDER }}
                >
                  {isStaff && (
                    <div className="absolute right-3 top-3 hidden items-center gap-2 group-hover:flex">
                      <button type="button" onClick={() => navigate(`/projects/${p.id}`)} title="Edit" style={{ color: MUTED }}>✎</button>
                      <button type="button" onClick={() => deleteProject(p.id, p.name)} title="Delete" style={{ color: 'var(--color-danger)' }}>🗑</button>
                    </div>
                  )}
                  <Link to={`/projects/${p.id}`} className="block">
                    <div className="flex items-start justify-between gap-2 pr-10">
                      <h2 className="font-semibold" style={{ color: TEXT }}>{p.name}</h2>
                      <StatusBadge status={p.status} color={p.statusColor || colorFor(p.status)} />
                    </div>
                    <p className="mt-2 line-clamp-2 text-sm" style={{ color: MUTED }}>{p.description || 'No description.'}</p>
                    <p className="mt-3 text-xs" style={{ color: MUTED }}><DeptLine project={p} /></p>
                    <p className="mt-1 text-xs font-medium" style={{ color: dueDateColor(p.dueDate, closed) }}>
                      {p.dueDate ? `Due ${p.dueDate}` : 'No due date'}
                    </p>
                    <div className="mt-3">
                      <ProgressBar percent={p.completion?.percent || 0} label={`${p.completion?.closedTasks || 0} of ${p.completion?.totalTasks || 0} tasks closed`} />
                    </div>
                    <div className="mt-4 flex items-center justify-between">
                      <AvatarStack members={p.members || []} />
                      <span className="text-sm font-semibold" style={{ color: TEXT }}>{formatCost(totalCost(p))}</span>
                    </div>
                  </Link>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="mt-4 rounded-[10px] border" style={{ backgroundColor: CARD_BG, borderColor: BORDER }}>
            <table className="min-w-full">
              <thead>
                <tr>
                  {isStaff && (
                    <th className="px-4 py-3" style={{ position: 'sticky', top: 0, zIndex: 10, backgroundColor: CARD_BG, borderBottom: `1px solid ${BORDER}` }}>
                      <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} className="h-4 w-4" />
                    </th>
                  )}
                  {['Name', 'Status', 'Owner dept', 'For dept', 'Lead', 'Due date', 'Progress', 'Tasks', 'Cost', 'Created'].map((h) => (
                    <th key={h} className="table-th" style={{ position: 'sticky', top: 0, zIndex: 10, backgroundColor: CARD_BG, borderBottom: `1px solid ${BORDER}` }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => (
                  <tr key={p.id} className="cursor-pointer hover:opacity-90" onClick={() => navigate(`/projects/${p.id}`)}>
                    {isStaff && (
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={selectedIds.has(p.id)} onChange={() => toggleOne(p.id)} className="h-4 w-4" />
                      </td>
                    )}
                    <td className="table-td font-medium" style={{ color: TEXT }}>{p.name}</td>
                    <td className="table-td"><StatusBadge status={p.status} color={p.statusColor || colorFor(p.status)} /></td>
                    <td className="table-td" style={{ color: MUTED }}>{p.ownerDepartment?.name || '—'}</td>
                    <td className="table-td" style={{ color: MUTED }}>{p.forDepartment?.name || '—'}</td>
                    <td className="table-td" style={{ color: MUTED }}>{p.lead?.displayName || '—'}</td>
                    <td className="table-td" style={{ color: MUTED }}>{p.dueDate || '—'}</td>
                    <td className="table-td" style={{ color: MUTED }}>{p.completion?.percent || 0}%</td>
                    <td className="table-td" style={{ color: MUTED }}>{p.completion?.closedTasks || 0}/{p.completion?.totalTasks || 0}</td>
                    <td className="table-td" style={{ color: MUTED }}>{formatCost(totalCost(p))}</td>
                    <td className="table-td" style={{ color: MUTED }}>{p.createdAt ? p.createdAt.slice(0, 10) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
