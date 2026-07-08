import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import api, { errMessage } from '../api/api';
import { useAuth } from '../context/AuthContext';
import Spinner from '../components/Spinner';
import Modal from '../components/Modal';
import Collapsible from '../components/Collapsible';
import AccessRestricted, { isForbidden } from '../components/AccessRestricted';

function formatDate(value) {
  return value ? new Date(value).toLocaleString() : 'Never';
}

// "System-wide" vs "Department-scoped" is driven by role.scope, not the
// (separate) role.departmentId, which only locks a *custom* role to one
// specific department. A department-scoped role with no locked department
// is a reusable template — the actual department is chosen per assignment.
function roleScopeLabel(role) {
  if (role.scope === 'department') {
    return role.department?.name ? `Department-scoped — ${role.department.name}` : 'Department-scoped';
  }
  return 'System-wide';
}

// ---- Assign role modal ----

// Left-edge accent color per seed role, so admins can eyeball access level
// at a glance in the assign-role list. Custom (non-system) roles fall back
// to the neutral accent color.
const ROLE_ACCENT_BY_NAME = {
  'System Administrator': 'var(--color-danger)',
  'System Technician': 'var(--color-accent)',
  'Department Manager': 'var(--color-relation-accent)',
  'Department Staff': 'var(--color-success)',
  'Read Only': 'var(--color-text-muted)',
};
function roleAccentColor(role) {
  return ROLE_ACCENT_BY_NAME[role.name] || 'var(--color-accent)';
}

function AssignRoleOption({ role, onPick }) {
  const count = role.permissionCount ?? (role.permissions?.length || 0);
  return (
    <div className="relative flex items-stretch gap-2 overflow-hidden rounded-md border border-transparent hover:border-navy-100 hover:bg-navy-50">
      <div className="w-1 flex-shrink-0" style={{ backgroundColor: roleAccentColor(role) }} />
      <button
        type="button"
        onClick={() => onPick(role)}
        className="min-w-0 flex-1 py-2 pr-2 text-left"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-medium text-navy-800">{role.name}</span>
          <span className="flex-shrink-0 whitespace-nowrap rounded-full bg-navy-100 px-2 py-0.5 text-xs font-medium text-navy-600">
            {count} permission{count === 1 ? '' : 's'}
          </span>
        </div>
        {role.description && <p className="mt-0.5 line-clamp-2 text-xs text-navy-500">{role.description}</p>}
        <p className="mt-0.5 text-xs text-navy-400">{roleScopeLabel(role)}</p>
      </button>
      <a
        href={`/admin/roles/${role.id}`}
        target="_blank"
        rel="noopener noreferrer"
        className="flex-shrink-0 self-center whitespace-nowrap pr-3 text-xs text-prism hover:underline"
      >
        View details
      </a>
    </div>
  );
}

function AssignRoleModal({ roles, departments, assignedRoleIds, onAssign, onClose }) {
  const [search, setSearch] = useState('');
  const [pendingRole, setPendingRole] = useState(null); // role awaiting a department pick
  const [deptChoice, setDeptChoice] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const q = search.toLowerCase();
  const available = roles.filter(
    (r) =>
      // "Requester" is retired — contacts replace it, and no PRISM user
      // should be newly assigned it. Kept in the DB (not deleted) so
      // historical UserRoles rows stay valid; just hidden here.
      r.name !== 'Requester' &&
      !assignedRoleIds.has(r.id) &&
      (r.name.toLowerCase().includes(q) || (r.description || '').toLowerCase().includes(q))
  );
  const systemRoles = available.filter((r) => r.isSystemRole);
  const customRoles = available.filter((r) => !r.isSystemRole);

  const pick = (role) => {
    setError('');
    if (role.scope === 'department') {
      setPendingRole(role);
      setDeptChoice('');
    } else {
      confirm(role, null);
    }
  };

  const confirm = async (role, departmentId) => {
    setSaving(true);
    setError('');
    try {
      await onAssign(role.id, departmentId);
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setSaving(false);
    }
  };

  if (pendingRole) {
    return (
      <Modal title={`Assign "${pendingRole.name}"`} onClose={onClose}>
        <p className="mb-3 text-sm text-navy-600">Which department does this role apply to?</p>
        {error && <div className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        <select className="input mb-4" value={deptChoice} onChange={(e) => setDeptChoice(e.target.value)}>
          <option value="">Select department…</option>
          {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <div className="flex justify-end gap-3">
          <button type="button" className="btn-secondary" onClick={() => setPendingRole(null)}>Back</button>
          <button
            type="button"
            className="btn-primary"
            disabled={!deptChoice || saving}
            onClick={() => confirm(pendingRole, deptChoice)}
          >
            {saving ? 'Assigning…' : 'Assign role'}
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Assign a role" onClose={onClose} wide>
      <input
        className="input mb-3"
        placeholder="Search by name or description…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        autoFocus
      />
      {error && <div className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      <div className="max-h-96 space-y-1 overflow-y-auto">
        {systemRoles.length > 0 && (
          <>
            <p className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-navy-400">System roles</p>
            {systemRoles.map((r) => <AssignRoleOption key={r.id} role={r} onPick={pick} />)}
          </>
        )}
        {customRoles.length > 0 && (
          <>
            <p className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-navy-400">Custom roles</p>
            {customRoles.map((r) => <AssignRoleOption key={r.id} role={r} onPick={pick} />)}
          </>
        )}
        {available.length === 0 && <p className="px-3 py-4 text-sm text-navy-400">No matching roles.</p>}
      </div>
    </Modal>
  );
}

// ---- Add override modal ----

function AddOverrideModal({ permissions, onSave, onClose }) {
  const [search, setSearch] = useState('');
  const [permissionKey, setPermissionKey] = useState('');
  const [granted, setGranted] = useState(true);
  const [reason, setReason] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const filtered = permissions.filter(
    (p) => p.label.toLowerCase().includes(search.toLowerCase()) || p.key.toLowerCase().includes(search.toLowerCase())
  );
  const selected = permissions.find((p) => p.key === permissionKey);

  const submit = async (e) => {
    e.preventDefault();
    if (!permissionKey) {
      setError('Choose a permission');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onSave({ permissionKey, granted, reason: reason || null, expiresAt: expiresAt || null });
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Add permission override" onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-4">
        {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

        <div>
          <label className="label">Permission</label>
          {selected ? (
            <div className="flex items-center justify-between rounded-md border border-navy-200 px-3 py-2">
              <div>
                <p className="text-sm font-medium text-navy-800">{selected.label}</p>
                <p className="text-xs text-navy-400">{selected.key}</p>
              </div>
              <button type="button" className="text-xs text-prism hover:underline" onClick={() => setPermissionKey('')}>
                change
              </button>
            </div>
          ) : (
            <>
              <input
                className="input mb-2"
                placeholder="Search permissions…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                autoFocus
              />
              <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border border-navy-100 p-1">
                {filtered.map((p) => (
                  <button
                    type="button"
                    key={p.key}
                    onClick={() => setPermissionKey(p.key)}
                    className="flex w-full flex-col items-start rounded px-2 py-1.5 text-left hover:bg-navy-50"
                  >
                    <span className="text-sm text-navy-800">{p.label}</span>
                    <span className="text-xs text-navy-400">{p.key}</span>
                  </button>
                ))}
                {filtered.length === 0 && <p className="px-2 py-3 text-sm text-navy-400">No matches.</p>}
              </div>
            </>
          )}
        </div>

        <div>
          <label className="label">Access</label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setGranted(true)}
              className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium ${granted ? 'border-prism bg-prism/10 text-prism' : 'border-navy-200 text-navy-600'}`}
            >
              Grant
            </button>
            <button
              type="button"
              onClick={() => setGranted(false)}
              className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium ${!granted ? 'border-red-400 bg-red-50 text-red-600' : 'border-navy-200 text-navy-600'}`}
            >
              Deny
            </button>
          </div>
        </div>

        <div>
          <label className="label">Reason (optional)</label>
          <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Temporary access for Q3 audit" />
        </div>

        <div>
          <label className="label">Expires (optional — leave blank for a permanent override)</label>
          <input type="datetime-local" className="input" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
        </div>

        <div className="flex justify-end gap-3">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </Modal>
  );
}

// ---- Effective permissions (read-only, searchable, category-grouped) ----

const CATEGORY_LABELS = { tickets: 'Tickets', projects: 'Projects', people: 'People', reports: 'Reports', settings: 'Settings' };

function EffectivePermissionsSection({ effective, error }) {
  const [search, setSearch] = useState('');
  const [openCategories, setOpenCategories] = useState(() => new Set(Object.keys(CATEGORY_LABELS)));

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return effective;
    return effective.filter((p) => p.label.toLowerCase().includes(term) || p.key.toLowerCase().includes(term));
  }, [effective, search]);

  const byCategory = useMemo(() => {
    const map = new Map();
    filtered.forEach((p) => {
      if (!map.has(p.category)) map.set(p.category, []);
      map.get(p.category).push(p);
    });
    return map;
  }, [filtered]);

  const toggleCategory = (cat) => setOpenCategories((prev) => {
    const next = new Set(prev);
    if (next.has(cat)) next.delete(cat); else next.add(cat);
    return next;
  });

  return (
    <Collapsible title="View effective permissions" subtitle={`${effective.length} permission${effective.length === 1 ? '' : 's'}`} defaultOpen={false}>
      {error ? (
        <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div>
      ) : (
        <div className="space-y-3">
          <input
            className="input"
            placeholder="Filter by permission name or key…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {[...byCategory.entries()].map(([cat, perms]) => (
            <div key={cat} className="overflow-hidden rounded-md border border-navy-100">
              <button
                type="button"
                onClick={() => toggleCategory(cat)}
                className="flex w-full items-center justify-between bg-navy-50 px-3 py-2 text-left"
              >
                <span className="flex items-center gap-2">
                  <span className="badge bg-navy-100 text-navy-600">{CATEGORY_LABELS[cat] || cat}</span>
                  <span className="text-xs text-navy-400">{perms.length}</span>
                </span>
                <span className="text-navy-400">{openCategories.has(cat) ? '▾' : '▸'}</span>
              </button>
              {openCategories.has(cat) && (
                <table className="min-w-full divide-y divide-navy-100">
                  <thead className="bg-navy-50/50">
                    <tr>
                      <th className="table-th">Permission</th>
                      <th className="table-th">Status</th>
                      <th className="table-th">Source</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-navy-50">
                    {perms.map((p) => (
                      <tr key={p.key}>
                        <td className="table-td">
                          <p className="text-sm text-navy-800">{p.label}</p>
                          <p className="text-xs text-navy-400">{p.key}</p>
                        </td>
                        <td className="table-td">
                          <span className={`badge ${p.granted ? 'bg-green-100 text-green-800' : 'bg-navy-100 text-navy-500'}`}>
                            {p.granted ? 'Granted' : 'Denied'}
                          </span>
                        </td>
                        <td className="table-td text-xs text-navy-500">{p.source || 'Default: denied'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ))}
          {filtered.length === 0 && <p className="text-sm text-navy-400">No permissions match &quot;{search}&quot;.</p>}
        </div>
      )}
    </Collapsible>
  );
}

// ---- Roles & Permissions tab ----

function RolesPermissionsTab({ userId, onPermissionsChanged }) {
  const [loading, setLoading] = useState(true);
  const [allRoles, setAllRoles] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [userRoles, setUserRoles] = useState([]);
  const [primaryRoleId, setPrimaryRoleId] = useState(null);
  const [rolesError, setRolesError] = useState('');
  const [overrides, setOverrides] = useState([]);
  const [overridesError, setOverridesError] = useState('');
  const [allPermissions, setAllPermissions] = useState([]);
  const [effective, setEffective] = useState([]);
  const [effectiveError, setEffectiveError] = useState('');
  const [showAssignRole, setShowAssignRole] = useState(false);
  const [showAddOverride, setShowAddOverride] = useState(false);

  // Each of the 6 calls below is independently error-handled — a caller who
  // e.g. only holds people.edit_users (not people.manage_roles or
  // people.manage_permission_overrides) will 403 on some of these, and
  // previously that 403 anywhere in a single shared Promise.all silently
  // blanked out every section, including ones the caller *does* have access
  // to (like effective permissions). Promise.allSettled + per-section error
  // state means one failing section no longer takes the others down with it.
  const load = () => {
    setLoading(true);
    setRolesError('');
    setOverridesError('');
    setEffectiveError('');
    Promise.allSettled([
      api.get('/roles'),
      api.get('/departments'),
      api.get(`/users/${userId}/roles`),
      api.get(`/users/${userId}/overrides`),
      api.get('/permissions'),
      api.get(`/users/${userId}/permissions`),
    ]).then(([roles, depts, ur, ov, perms, eff]) => {
      if (roles.status === 'fulfilled') setAllRoles(roles.value.data.roles);
      if (depts.status === 'fulfilled') setDepartments(depts.value.data.departments);
      if (ur.status === 'fulfilled') {
        setUserRoles(ur.value.data.userRoles);
        setPrimaryRoleId(ur.value.data.primaryRoleId);
      } else {
        setRolesError(errMessage(ur.reason));
      }
      if (ov.status === 'fulfilled') setOverrides(ov.value.data.overrides);
      else setOverridesError(errMessage(ov.reason));
      if (perms.status === 'fulfilled') setAllPermissions(perms.value.data.permissions);
      if (eff.status === 'fulfilled') setEffective(eff.value.data.permissions);
      else setEffectiveError(errMessage(eff.reason));
    }).finally(() => setLoading(false));
  };
  useEffect(load, [userId]);

  const assignedRoleIds = useMemo(() => new Set(userRoles.map((ur) => ur.roleId)), [userRoles]);

  const assignRole = async (roleId, departmentId) => {
    await api.post(`/users/${userId}/roles`, { roleId, departmentId: departmentId || undefined });
    setShowAssignRole(false);
    load();
    onPermissionsChanged();
  };

  const removeRole = async (ur) => {
    if (!confirm(`Remove the "${ur.role?.name}" role from this user?`)) return;
    try {
      const params = ur.departmentId ? { departmentId: ur.departmentId } : {};
      await api.delete(`/users/${userId}/roles/${ur.roleId}`, { params });
      load();
      onPermissionsChanged();
    } catch (err) {
      alert(errMessage(err));
    }
  };

  const addOverride = async (payload) => {
    await api.post(`/users/${userId}/overrides`, payload);
    setShowAddOverride(false);
    load();
    onPermissionsChanged();
  };

  const revokeOverride = async (overrideId) => {
    if (!confirm('Revoke this override?')) return;
    try {
      await api.delete(`/users/${userId}/overrides/${overrideId}`);
      load();
      onPermissionsChanged();
    } catch (err) {
      alert(errMessage(err));
    }
  };

  if (loading) return <Spinner />;

  const activeOverrides = overrides.filter((o) => !o.expired);
  const expiredOverrides = overrides.filter((o) => o.expired);

  return (
    <div className="space-y-6">
      {/* Section 1 — Assigned roles */}
      <div className="card p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold text-navy-900">Assigned roles</h2>
          <button className="btn-primary" onClick={() => setShowAssignRole(true)}>+ Assign role</button>
        </div>
        {rolesError && <div className="mb-3 rounded-md bg-red-50 p-3 text-sm text-red-700">{rolesError}</div>}
        <div className="space-y-2">
          {userRoles.map((ur) => (
            <div key={ur.id} className="flex items-center justify-between rounded-md border border-navy-100 px-4 py-3">
              <div>
                <div className="flex items-center gap-2">
                  <p className="font-medium text-navy-800">{ur.role?.name}</p>
                  {ur.roleId === primaryRoleId && (
                    <span className="badge bg-prism/10 text-prism">Primary</span>
                  )}
                </div>
                <p className="text-xs text-navy-400">
                  {ur.role?.scope === 'department'
                    ? `Department-scoped${ur.department?.name ? ` — ${ur.department.name}` : ''}`
                    : 'System-wide'}
                </p>
              </div>
              <button onClick={() => removeRole(ur)} className="text-xs text-red-500 hover:underline">
                Remove
              </button>
            </div>
          ))}
          {userRoles.length === 0 && !rolesError && <p className="text-sm text-navy-400">No roles assigned.</p>}
        </div>
      </div>

      {/* Section 2 — Permission overrides */}
      <div className="card p-5">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="font-semibold text-navy-900">Individual permission overrides</h2>
          <button className="btn-primary" onClick={() => setShowAddOverride(true)}>+ Add override</button>
        </div>
        <p className="mb-3 text-sm text-navy-500">Overrides apply on top of this user's roles. Use for temporary access.</p>
        {overridesError && <div className="mb-3 rounded-md bg-red-50 p-3 text-sm text-red-700">{overridesError}</div>}

        <div className="space-y-2">
          {activeOverrides.map((o) => (
            <div key={o.id} className="rounded-md border border-navy-100 px-4 py-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-navy-800">{o.label}</p>
                    <span className={`badge ${o.granted ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                      {o.granted ? 'Granted' : 'Denied'}
                    </span>
                  </div>
                  <p className="text-xs text-navy-400">{o.permissionKey}</p>
                </div>
                <button onClick={() => revokeOverride(o.id)} className="text-xs text-red-500 hover:underline">Revoke</button>
              </div>
              {o.reason && <p className="mt-1 text-sm text-navy-600">{o.reason}</p>}
              <p className="mt-1 text-xs text-navy-400">
                Expires: {o.expiresAt ? formatDate(o.expiresAt) : 'Never'} · Granted by: {o.grantedByUser?.displayName || 'Unknown'}
              </p>
            </div>
          ))}
          {activeOverrides.length === 0 && !overridesError && <p className="text-sm text-navy-400">No active overrides.</p>}
        </div>

        {expiredOverrides.length > 0 && (
          <div className="mt-4">
            <Collapsible title={`Expired overrides (${expiredOverrides.length})`} defaultOpen={false}>
              <div className="space-y-2">
                {expiredOverrides.map((o) => (
                  <div key={o.id} className="rounded-md border border-navy-100 px-4 py-3 opacity-70">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-navy-800">{o.label}</p>
                      <span className={`badge ${o.granted ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                        {o.granted ? 'Granted' : 'Denied'}
                      </span>
                    </div>
                    {o.reason && <p className="mt-1 text-sm text-navy-600">{o.reason}</p>}
                    <p className="mt-1 text-xs text-navy-400">
                      Expired: {formatDate(o.expiresAt)} · Granted by: {o.grantedByUser?.displayName || 'Unknown'}
                    </p>
                  </div>
                ))}
              </div>
            </Collapsible>
          </div>
        )}
      </div>

      {/* Section 3 — Effective permissions (read-only) */}
      <EffectivePermissionsSection effective={effective} error={effectiveError} />

      {showAssignRole && (
        <AssignRoleModal
          roles={allRoles}
          departments={departments}
          assignedRoleIds={assignedRoleIds}
          onAssign={assignRole}
          onClose={() => setShowAssignRole(false)}
        />
      )}
      {showAddOverride && (
        <AddOverrideModal
          permissions={allPermissions}
          onSave={addOverride}
          onClose={() => setShowAddOverride(false)}
        />
      )}
    </div>
  );
}

// ---- Profile tab ----

function ProfileTab({ user, departments, onUpdate }) {
  const [form, setForm] = useState({
    firstName: user.firstName || '',
    lastName: user.lastName || '',
    email: user.email || '',
    phone: user.phone || '',
    jobTitle: user.jobTitle || '',
    departmentId: user.departmentId || '',
  });
  const [saving, setSaving] = useState(false);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onUpdate({
        firstName: form.firstName.trim() || null,
        lastName: form.lastName.trim() || null,
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        jobTitle: form.jobTitle.trim() || null,
        departmentId: form.departmentId || null,
      });
    } finally {
      setSaving(false);
    }
  };

  const resetPassword = async () => {
    const pw = prompt(`Set a new temporary password for ${user.displayName} (min 8 chars).\nThey will be required to change it on next login.`);
    if (!pw) return;
    await onUpdate({ password: pw });
    alert('Password reset. The user must change it on next login.');
  };

  return (
    <div className="card space-y-4 p-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="label">Username</label>
          <p className="text-sm text-navy-700">{user.username}</p>
        </div>
        <div>
          <label className="label">Last login</label>
          <p className="text-sm text-navy-700">{formatDate(user.lastLogin)}</p>
        </div>
        <div>
          <label className="label">Account type</label>
          <p className="text-sm text-navy-700">{user.isLocalAccount ? 'Local' : 'Active Directory'}</p>
        </div>
        <div>
          <label className="label">Primary role</label>
          <p className="text-sm text-navy-700">{user.primaryRole?.name || 'None assigned'}</p>
          <p className="text-xs text-navy-400">Manage in the Roles &amp; Permissions tab.</p>
        </div>
      </div>
      <form onSubmit={save} className="grid grid-cols-1 gap-4 border-t border-navy-100 pt-4 sm:grid-cols-2">
        <div>
          <label className="label">First name</label>
          <input className="input" value={form.firstName} onChange={set('firstName')} />
        </div>
        <div>
          <label className="label">Last name</label>
          <input className="input" value={form.lastName} onChange={set('lastName')} />
        </div>
        <div>
          <label className="label">Email</label>
          <input type="email" className="input" value={form.email} onChange={set('email')} />
        </div>
        <div>
          <label className="label">Phone</label>
          <input className="input" value={form.phone} onChange={set('phone')} />
        </div>
        <div>
          <label className="label">Job title</label>
          <input className="input" value={form.jobTitle} onChange={set('jobTitle')} />
        </div>
        <div>
          <label className="label">Department</label>
          <select className="input" value={form.departmentId} onChange={set('departmentId')}>
            <option value="">None</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
        <div className="sm:col-span-2 flex justify-end gap-3">
          {user.isLocalAccount && (
            <button type="button" className="btn-secondary" onClick={resetPassword}>Reset password</button>
          )}
          <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </div>
  );
}

// ---- Page ----

export default function UserDetail() {
  const { id } = useParams();
  const { refreshPermissions } = useAuth();
  const [user, setUser] = useState(null);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [forbidden, setForbidden] = useState(false);
  const [tab, setTab] = useState('profile');

  const load = () => {
    Promise.all([api.get(`/users/${id}`), api.get('/departments')])
      .then(([u, d]) => { setUser(u.data.user); setDepartments(d.data.departments); })
      .catch((err) => {
        if (isForbidden(err)) setForbidden(true);
        else setError(errMessage(err));
      })
      .finally(() => setLoading(false));
  };
  useEffect(load, [id]);

  const updateUser = async (changes) => {
    try {
      const { data } = await api.patch(`/users/${id}`, changes);
      setUser(data.user);
    } catch (err) {
      alert(errMessage(err));
    }
  };

  if (loading) return <Spinner />;
  if (forbidden) return <AccessRestricted />;
  if (error) return <div className="rounded-md bg-red-50 p-4 text-red-700">{error}</div>;
  if (!user) return null;

  const TABS = [
    { key: 'profile', label: 'Profile' },
    { key: 'access', label: 'Roles & Permissions' },
  ];

  return (
    <div className="space-y-5">
      <Link to="/admin/users" className="text-sm text-prism hover:underline">← Back to Users</Link>
      <h1 className="text-2xl font-bold text-navy-900">{user.displayName}</h1>

      <div className="flex gap-2 border-b border-navy-100">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`border-b-2 px-4 py-2 text-sm font-medium ${
              tab === t.key ? 'border-prism text-prism' : 'border-transparent text-navy-500 hover:text-navy-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'profile' && <ProfileTab user={user} departments={departments} onUpdate={updateUser} />}
      {tab === 'access' && <RolesPermissionsTab userId={id} onPermissionsChanged={refreshPermissions} />}
    </div>
  );
}
