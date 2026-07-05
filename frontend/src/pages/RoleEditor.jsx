import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import api, { errMessage } from '../api/api';
import Spinner from '../components/Spinner';
import Switch from '../components/Switch';
import Collapsible from '../components/Collapsible';

const CATEGORY_ORDER = ['tickets', 'projects', 'people', 'reports', 'settings'];
const CATEGORY_LABELS = { tickets: 'Tickets', projects: 'Projects', people: 'People', reports: 'Reports', settings: 'Settings' };

// Broader-scope -> narrower-scope pairs. If the broader one is granted but
// the narrower isn't, we show an informational (non-blocking) note.
const SCOPE_CHAINS = {
  tickets: [
    ['tickets.view_all', 'tickets.view_department'],
    ['tickets.view_department', 'tickets.view_own'],
    ['tickets.edit_all', 'tickets.edit_department'],
    ['tickets.edit_department', 'tickets.edit_own'],
  ],
  projects: [
    ['projects.view_all', 'projects.view_department'],
    ['projects.view_department', 'projects.view_own'],
    ['projects.edit_all', 'projects.edit_department'],
    ['projects.edit_department', 'projects.edit_own'],
  ],
};

function hasScopeConflict(grantedSet, category) {
  const chains = SCOPE_CHAINS[category];
  if (!chains) return false;
  return chains.some(([broader, narrower]) => grantedSet.has(broader) && !grantedSet.has(narrower));
}

export default function RoleEditor() {
  const { id } = useParams();
  const isNew = !id;
  const navigate = useNavigate();

  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [departments, setDepartments] = useState([]);
  const [role, setRole] = useState(null); // existing role detail (edit mode only)
  const [form, setForm] = useState({ name: '', description: '', departmentId: '' });
  const [permissions, setPermissions] = useState([]); // [{ key, category, label, description, granted }]

  useEffect(() => {
    api.get('/departments').then(({ data }) => setDepartments(data.departments)).catch(() => {});

    if (isNew) {
      api.get('/permissions')
        .then(({ data }) => setPermissions(data.permissions.map((p) => ({ ...p, granted: false }))))
        .catch((err) => setError(errMessage(err)))
        .finally(() => setLoading(false));
    } else {
      api.get(`/roles/${id}`)
        .then(({ data }) => {
          setRole(data.role);
          setForm({
            name: data.role.name,
            description: data.role.description || '',
            departmentId: data.role.departmentId || '',
          });
          setPermissions(data.role.permissions);
        })
        .catch((err) => setError(errMessage(err)))
        .finally(() => setLoading(false));
    }
  }, [id, isNew]);

  const isSystemRole = !isNew && role?.isSystemRole;
  const isFullyLocked = !isNew && role?.name === 'System Administrator';

  const grantedSet = useMemo(() => new Set(permissions.filter((p) => p.granted).map((p) => p.key)), [permissions]);

  const grouped = useMemo(() => {
    const byCategory = {};
    permissions.forEach((p) => {
      if (!byCategory[p.category]) byCategory[p.category] = [];
      byCategory[p.category].push(p);
    });
    return byCategory;
  }, [permissions]);

  const togglePermission = async (key, granted) => {
    setPermissions((ps) => ps.map((p) => (p.key === key ? { ...p, granted } : p)));
    if (isNew) return; // staged locally; persisted when the role is created
    try {
      await api.patch(`/roles/${id}/permissions/${key}`, { granted });
    } catch (err) {
      setPermissions((ps) => ps.map((p) => (p.key === key ? { ...p, granted: !granted } : p)));
      alert(errMessage(err));
    }
  };

  const saveMetadata = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      if (isNew) {
        const { data } = await api.post('/roles', {
          name: form.name,
          description: form.description || null,
          departmentId: form.departmentId || null,
          permissionKeys: permissions.filter((p) => p.granted).map((p) => p.key),
        });
        navigate(`/admin/roles/${data.role.id}`, { replace: true });
      } else {
        const { data } = await api.patch(`/roles/${id}`, {
          name: form.name,
          description: form.description || null,
          departmentId: form.departmentId || null,
        });
        setRole((r) => ({ ...r, ...data.role }));
      }
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Spinner />;

  return (
    <div className="space-y-5">
      <Link to="/admin/roles" className="text-sm text-prism hover:underline">← Back to Roles & Permissions</Link>
      <h1 className="text-2xl font-bold text-navy-900">{isNew ? 'New role' : form.name}</h1>
      {error && <div className="rounded-md bg-red-50 p-4 text-red-700">{error}</div>}

      {isFullyLocked && (
        <div className="rounded-md bg-navy-50 px-4 py-3 text-sm text-navy-600">
          System Administrator has every permission granted and cannot be changed.
        </div>
      )}
      {isSystemRole && !isFullyLocked && (
        <div className="rounded-md bg-navy-50 px-4 py-3 text-sm text-navy-600">
          System roles keep a fixed name, description, and scope — duplicate this role from the list page to create a customizable variant. Its permissions can still be edited below.
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* Left: metadata */}
        <form onSubmit={saveMetadata} className="card space-y-4 p-5 lg:col-span-1">
          <div>
            <label className="label">Name</label>
            <input
              className="input"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              disabled={isSystemRole}
              required
            />
          </div>
          <div>
            <label className="label">Description</label>
            <textarea
              className="input"
              rows={3}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              disabled={isSystemRole}
            />
          </div>
          <div>
            <label className="label">Scope</label>
            <select
              className="input"
              value={form.departmentId}
              onChange={(e) => setForm((f) => ({ ...f, departmentId: e.target.value }))}
              disabled={isSystemRole}
            >
              <option value="">System-wide</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <p className="mt-1 text-xs text-navy-400">
              System-wide roles apply regardless of department; department-scoped roles only apply to users in that department.
            </p>
          </div>
          {!isSystemRole && (
            <button type="submit" className="btn-primary w-full" disabled={saving}>
              {saving ? 'Saving…' : 'Save role'}
            </button>
          )}
          {!isNew && (
            <p className="text-xs text-navy-400">{role.memberCount} user{role.memberCount === 1 ? '' : 's'} assigned</p>
          )}
        </form>

        {/* Right: permission toggles by category */}
        <div className="space-y-4 lg:col-span-2">
          {CATEGORY_ORDER.filter((cat) => grouped[cat]?.length).map((cat) => {
            const perms = grouped[cat];
            const grantedCount = perms.filter((p) => p.granted).length;
            const conflict = hasScopeConflict(grantedSet, cat);
            return (
              <Collapsible key={cat} title={`${CATEGORY_LABELS[cat]} — ${grantedCount}/${perms.length} granted`}>
                <div className="space-y-4">
                  {conflict && (
                    <div className="rounded-md bg-sky-50 px-3 py-2 text-xs text-sky-700">
                      Enabling a broader scope automatically includes narrower scopes.
                    </div>
                  )}
                  {perms.map((p) => (
                    <div key={p.key} className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-navy-800">{p.label}</p>
                        {p.description && <p className="text-xs text-navy-400">{p.description}</p>}
                      </div>
                      <Switch
                        checked={p.granted}
                        disabled={isFullyLocked}
                        label={p.label}
                        onChange={(v) => togglePermission(p.key, v)}
                      />
                    </div>
                  ))}
                </div>
              </Collapsible>
            );
          })}
        </div>
      </div>
    </div>
  );
}
