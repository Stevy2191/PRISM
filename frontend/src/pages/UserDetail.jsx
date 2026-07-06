import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import api, { errMessage } from '../api/api';
import { useAuth } from '../context/AuthContext';
import Spinner from '../components/Spinner';
import Modal from '../components/Modal';
import Collapsible from '../components/Collapsible';
import AccessRestricted, { isForbidden } from '../components/AccessRestricted';

const LEGACY_ROLES = ['admin', 'technician', 'requester'];

function formatDate(value) {
  return value ? new Date(value).toLocaleString() : 'Never';
}

// ---- Assign role modal ----

function AssignRoleModal({ roles, assignedRoleIds, onAssign, onClose }) {
  const [search, setSearch] = useState('');
  const available = roles.filter(
    (r) => !assignedRoleIds.has(r.id) && r.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <Modal title="Assign a role" onClose={onClose}>
      <input
        className="input mb-3"
        placeholder="Search roles…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        autoFocus
      />
      <div className="max-h-72 space-y-1 overflow-y-auto">
        {available.map((r) => (
          <button
            key={r.id}
            onClick={() => onAssign(r.id)}
            className="flex w-full flex-col items-start rounded px-3 py-2 text-left hover:bg-navy-50"
          >
            <span className="text-sm font-medium text-navy-800">{r.name}</span>
            <span className="text-xs text-navy-400">{r.department?.name || 'System-wide'}</span>
          </button>
        ))}
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

// ---- Roles & Permissions tab ----

function RolesPermissionsTab({ userId, onPermissionsChanged }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [allRoles, setAllRoles] = useState([]);
  const [userRoles, setUserRoles] = useState([]);
  const [primaryRoleId, setPrimaryRoleId] = useState(null);
  const [overrides, setOverrides] = useState([]);
  const [allPermissions, setAllPermissions] = useState([]);
  const [effective, setEffective] = useState([]);
  const [showAssignRole, setShowAssignRole] = useState(false);
  const [showAddOverride, setShowAddOverride] = useState(false);

  const load = () => {
    setLoading(true);
    Promise.all([
      api.get('/roles'),
      api.get(`/users/${userId}/roles`),
      api.get(`/users/${userId}/overrides`),
      api.get('/permissions'),
      api.get(`/users/${userId}/permissions`),
    ])
      .then(([roles, ur, ov, perms, eff]) => {
        setAllRoles(roles.data.roles);
        setUserRoles(ur.data.userRoles);
        setPrimaryRoleId(ur.data.primaryRoleId);
        setOverrides(ov.data.overrides);
        setAllPermissions(perms.data.permissions);
        setEffective(eff.data.permissions);
      })
      .catch((err) => setError(errMessage(err)))
      .finally(() => setLoading(false));
  };
  useEffect(load, [userId]);

  const assignedRoleIds = useMemo(() => new Set(userRoles.map((ur) => ur.roleId)), [userRoles]);

  const assignRole = async (roleId) => {
    try {
      await api.post(`/users/${userId}/roles`, { roleId });
      setShowAssignRole(false);
      load();
      onPermissionsChanged();
    } catch (err) {
      alert(errMessage(err));
    }
  };

  const removeRole = async (roleId, name) => {
    if (!confirm(`Remove the "${name}" role from this user?`)) return;
    try {
      await api.delete(`/users/${userId}/roles/${roleId}`);
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
      {error && <div className="rounded-md bg-red-50 p-4 text-red-700">{error}</div>}

      {/* Section 1 — Assigned roles */}
      <div className="card p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold text-navy-900">Assigned roles</h2>
          <button className="btn-primary" onClick={() => setShowAssignRole(true)}>+ Assign role</button>
        </div>
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
                <p className="text-xs text-navy-400">{ur.role?.department?.name || 'System-wide'}</p>
              </div>
              <button onClick={() => removeRole(ur.roleId, ur.role?.name)} className="text-xs text-red-500 hover:underline">
                Remove
              </button>
            </div>
          ))}
          {userRoles.length === 0 && <p className="text-sm text-navy-400">No roles assigned.</p>}
        </div>
      </div>

      {/* Section 2 — Permission overrides */}
      <div className="card p-5">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="font-semibold text-navy-900">Individual permission overrides</h2>
          <button className="btn-primary" onClick={() => setShowAddOverride(true)}>+ Add override</button>
        </div>
        <p className="mb-3 text-sm text-navy-500">Overrides apply on top of this user's roles. Use for temporary access.</p>

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
          {activeOverrides.length === 0 && <p className="text-sm text-navy-400">No active overrides.</p>}
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
      <Collapsible title="View effective permissions" defaultOpen={false}>
        <div className="space-y-1">
          {effective.map((p) => (
            <div key={p.key} className="flex items-center justify-between border-b border-navy-50 py-2 last:border-0">
              <div>
                <p className="text-sm text-navy-800">{p.label}</p>
                <p className="text-xs text-navy-400">{p.source || 'Not granted by any role'}</p>
              </div>
              <span className={`badge ${p.granted ? 'bg-green-100 text-green-800' : 'bg-navy-100 text-navy-500'}`}>
                {p.granted ? 'Granted' : 'Denied'}
              </span>
            </div>
          ))}
        </div>
      </Collapsible>

      {showAssignRole && (
        <AssignRoleModal
          roles={allRoles}
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
  const [form, setForm] = useState({ role: user.role, departmentId: user.departmentId || '' });
  const [saving, setSaving] = useState(false);

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onUpdate({ role: form.role, departmentId: form.departmentId || null });
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
          <label className="label">Email</label>
          <p className="text-sm text-navy-700">{user.email || '—'}</p>
        </div>
        <div>
          <label className="label">Last login</label>
          <p className="text-sm text-navy-700">{formatDate(user.lastLogin)}</p>
        </div>
        <div>
          <label className="label">Account type</label>
          <p className="text-sm text-navy-700">{user.isLocalAccount ? 'Local' : 'Active Directory'}</p>
        </div>
      </div>
      <form onSubmit={save} className="grid grid-cols-1 gap-4 border-t border-navy-100 pt-4 sm:grid-cols-2">
        <div>
          <label className="label">Legacy role</label>
          <select className="input" value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}>
            {LEGACY_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Department</label>
          <select className="input" value={form.departmentId} onChange={(e) => setForm((f) => ({ ...f, departmentId: e.target.value }))}>
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
