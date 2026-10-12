// Creating a local account in one step: who they are, how they sign in, their
// role and any individual permission overrides. The server makes the account,
// its role and its overrides together, so a refused grant creates nothing.
import { useEffect, useMemo, useState } from 'react';
import api, { errMessage } from '../../api/api';
import { useAuth } from '../../context/AuthContext';

const EMPTY = {
  firstName: '', lastName: '', username: '', email: '', password: '', departmentId: '', roleId: '',
};
const USERNAME = /^[A-Za-z0-9._-]{3,64}$/;

export default function NewAccountForm({ departments, onCreated, onCancel }) {
  const { hasPermission } = useAuth();
  const canChooseRole = hasPermission('people.manage_roles');
  const canOverride = hasPermission('people.manage_permission_overrides');
  const [form, setForm] = useState(EMPTY);
  const [overrides, setOverrides] = useState([]);
  const [roles, setRoles] = useState([]);
  const [permissions, setPermissions] = useState([]);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (canChooseRole) {
      api.get('/roles', { params: { grantable: 1 } })
        // "Requester" is retired: contacts replace it.
        .then(({ data }) => setRoles(data.roles.filter((r) => r.grantable && r.name !== 'Requester')))
        .catch((err) => setError(errMessage(err)));
    }
    if (canOverride) {
      api.get('/permissions').then(({ data }) => setPermissions(data.permissions)).catch((err) => setError(errMessage(err)));
    }
  }, [canChooseRole, canOverride]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const role = roles.find((r) => String(r.id) === String(form.roleId));
  const department = departments.find((d) => String(d.id) === String(form.departmentId));
  const unused = useMemo(() => permissions.filter((p) => !overrides.some((o) => o.permissionKey === p.key)), [permissions, overrides]);

  const addOverride = () => {
    if (!unused.length) return;
    setOverrides((os) => [...os, { permissionKey: unused[0].key, granted: true, reason: '' }]);
  };
  const setOverride = (i, changes) => setOverrides((os) => os.map((o, j) => (j === i ? { ...o, ...changes } : o)));
  const removeOverride = (i) => setOverrides((os) => os.filter((_, j) => j !== i));

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.firstName.trim() && !form.lastName.trim()) return setError('Enter a first or last name');
    if (!USERNAME.test(form.username.trim())) return setError('Usernames are 3 to 64 characters: letters, numbers, dots, dashes and underscores');
    if (role?.scope === 'department' && !form.departmentId) return setError(`Choose a department: the ${role.name} role applies within one`);
    setCreating(true);
    try {
      const payload = {
        firstName: form.firstName.trim() || null,
        lastName: form.lastName.trim() || null,
        displayName: `${form.firstName.trim()} ${form.lastName.trim()}`.trim(),
        username: form.username.trim(),
        email: form.email.trim() || null,
        password: form.password,
        departmentId: form.departmentId || null,
      };
      if (form.roleId) payload.roleId = Number(form.roleId);
      if (overrides.length) payload.overrides = overrides.map((o) => ({ ...o, reason: o.reason.trim() || null }));
      const { data } = await api.post('/users', payload);
      onCreated(data.user);
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setCreating(false);
    }
    return undefined;
  };

  return (
    <form onSubmit={submit} className="card space-y-5 p-5" aria-label="New account">
      <div>
        <h2 className="font-semibold text-navy-900">Create local account</h2>
        <p className="text-sm text-navy-500">
          Local accounts sign in with a username or email and a password. AD users are created
          automatically on their first directory login. The new user must change their password
          on first login.
        </p>
      </div>
      {error && <div role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      <fieldset className="space-y-3">
        <legend className="eyebrow">Person</legend>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="na-first">First name</label>
            <input id="na-first" className="input" value={form.firstName} onChange={set('firstName')} />
          </div>
          <div>
            <label className="label" htmlFor="na-last">Last name</label>
            <input id="na-last" className="input" value={form.lastName} onChange={set('lastName')} />
          </div>
          <div>
            <label className="label" htmlFor="na-email">Email</label>
            <input id="na-email" type="email" className="input" value={form.email} onChange={set('email')} />
          </div>
          <div>
            <label className="label" htmlFor="na-dept">Department</label>
            <select id="na-dept" className="input" value={form.departmentId} onChange={set('departmentId')}>
              <option value="">None</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
        </div>
      </fieldset>

      <fieldset className="space-y-3 border-t border-navy-100 pt-4">
        <legend className="eyebrow">Sign-in</legend>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="na-username">Username</label>
            <input id="na-username" className="input" value={form.username} onChange={set('username')} required autoComplete="off" />
            <p className="mt-1 text-xs text-navy-400">Letters, numbers, dots, dashes and underscores.</p>
          </div>
          <div>
            <label className="label" htmlFor="na-password">Temporary password</label>
            <input id="na-password" type="password" className="input" value={form.password} onChange={set('password')} required minLength={8} autoComplete="new-password" />
          </div>
        </div>
      </fieldset>

      {canChooseRole && (
        <fieldset className="space-y-3 border-t border-navy-100 pt-4">
          <legend className="eyebrow">Role</legend>
          <div className="sm:w-1/2">
            <label className="label" htmlFor="na-role">Role</label>
            <select id="na-role" className="input" value={form.roleId} onChange={set('roleId')}>
              <option value="">
                {department?.defaultRoleId ? 'The department\'s default role' : 'Default (System Technician)'}
              </option>
              {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
            {role?.description && <p className="mt-1 text-xs text-navy-500">{role.description}</p>}
            {role?.scope === 'department' && (
              <p className="mt-1 text-xs text-navy-500">
                Applies within {department ? department.name : 'the account\'s department'}.
              </p>
            )}
            <p className="mt-1 text-xs text-navy-400">Only roles you can give are listed.</p>
          </div>
        </fieldset>
      )}

      {canOverride && (
        <fieldset className="space-y-3 border-t border-navy-100 pt-4">
          <legend className="eyebrow">Permission overrides</legend>
          <p className="text-sm text-navy-500">Optional. Grant or deny single permissions on top of the role.</p>
          {overrides.map((o, i) => {
            const options = permissions.filter((p) => p.key === o.permissionKey || unused.includes(p));
            return (
              <div key={i} className="grid grid-cols-1 gap-2 rounded-md border border-navy-100 p-3 sm:grid-cols-[2fr_auto_2fr_auto] sm:items-center">
                <select aria-label="Permission" className="input" value={o.permissionKey} onChange={(e) => setOverride(i, { permissionKey: e.target.value })}>
                  {options.map((p) => <option key={p.key} value={p.key}>{p.label} ({p.key})</option>)}
                </select>
                <select aria-label="Grant or deny" className="input" value={o.granted ? 'grant' : 'deny'} onChange={(e) => setOverride(i, { granted: e.target.value === 'grant' })}>
                  <option value="grant">Grant</option>
                  <option value="deny">Deny</option>
                </select>
                <input aria-label="Reason" className="input" placeholder="Reason (optional)" value={o.reason} onChange={(e) => setOverride(i, { reason: e.target.value })} />
                <button type="button" className="text-xs text-red-500 hover:underline" onClick={() => removeOverride(i)}>Remove</button>
              </div>
            );
          })}
          <button type="button" className="btn-secondary" onClick={addOverride} disabled={!unused.length}>+ Add override</button>
        </fieldset>
      )}

      <div className="flex justify-end gap-3 border-t border-navy-100 pt-4">
        <button type="button" className="btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn-primary" disabled={creating}>{creating ? 'Creating…' : 'Create account'}</button>
      </div>
    </form>
  );
}
