import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { IconLock } from '@tabler/icons-react';
import api, { errMessage } from '../api/api';
import Spinner from '../components/Spinner';

function roleScopeLabel(role) {
  if (role.scope === 'department') {
    return role.department?.name ? `Department-scoped — ${role.department.name}` : 'Department-scoped';
  }
  return 'System-wide';
}

function RoleRow({ role, onDelete, onDuplicate }) {
  return (
    <div className="flex items-center justify-between gap-4 px-5 py-4">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {role.isSystemRole && <IconLock size={14} className="flex-shrink-0 text-navy-400" />}
          <p className="truncate font-semibold text-navy-900">{role.name}</p>
        </div>
        {role.description && <p className="mt-0.5 text-sm text-navy-500">{role.description}</p>}
        <p className="mt-1 text-xs text-navy-400">
          {roleScopeLabel(role)} · {role.memberCount} user{role.memberCount === 1 ? '' : 's'} ·{' '}
          {role.permissionCount} permission{role.permissionCount === 1 ? '' : 's'} granted
        </p>
      </div>
      <div className="flex flex-shrink-0 gap-3">
        <Link to={`/admin/roles/${role.id}`} className="text-xs text-prism hover:underline">edit</Link>
        <button onClick={() => onDuplicate(role)} className="text-xs text-prism hover:underline">duplicate</button>
        {!role.isSystemRole && (
          <button onClick={() => onDelete(role)} className="text-xs text-red-500 hover:underline">delete</button>
        )}
      </div>
    </div>
  );
}

export default function AdminRoles() {
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const load = () => {
    api
      .get('/roles')
      .then(({ data }) => setRoles(data.roles))
      .catch((err) => setError(errMessage(err)))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const remove = async (role) => {
    const msg = `Deleting ${role.name} will remove it from ${role.memberCount} user${role.memberCount === 1 ? '' : 's'}. Those users will fall back to their department's default role. Are you sure?`;
    if (!confirm(msg)) return;
    try {
      await api.delete(`/roles/${role.id}`);
      setRoles((rs) => rs.filter((r) => r.id !== role.id));
    } catch (err) {
      alert(errMessage(err));
    }
  };

  const duplicate = async (role) => {
    try {
      const { data } = await api.post('/roles', {
        name: `${role.name} (Copy)`,
        description: role.description,
        scope: role.scope,
        departmentId: role.departmentId,
        permissionKeys: (role.permissions || []).map((p) => p.key),
      });
      navigate(`/admin/roles/${data.role.id}`);
    } catch (err) {
      alert(errMessage(err));
    }
  };

  if (loading) return <Spinner />;

  const systemRoles = roles.filter((r) => r.isSystemRole);
  const customRoles = roles.filter((r) => !r.isSystemRole);

  return (
    <div className="space-y-5">
      <Link to="/settings" className="text-sm text-prism hover:underline">← Back to Settings</Link>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-navy-900">Roles & Permissions</h1>
        <Link to="/admin/roles/new" className="btn-primary">+ New role</Link>
      </div>
      {error && <div className="rounded-md bg-red-50 p-4 text-red-700">{error}</div>}

      <div>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-navy-400">System roles</h2>
        <div className="card divide-y divide-navy-100">
          {systemRoles.map((role) => (
            <RoleRow key={role.id} role={role} onDelete={remove} onDuplicate={duplicate} />
          ))}
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-navy-400">Custom roles</h2>
        <div className="card divide-y divide-navy-100">
          {customRoles.map((role) => (
            <RoleRow key={role.id} role={role} onDelete={remove} onDuplicate={duplicate} />
          ))}
          {customRoles.length === 0 && <p className="px-5 py-4 text-sm text-navy-400">No custom roles yet.</p>}
        </div>
      </div>
    </div>
  );
}
