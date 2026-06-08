import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { errMessage } from '../../api/api';
import Spinner from '../../components/Spinner';

const ROLES = ['admin', 'technician', 'requester'];
const LABELS = {
  dashboard: 'Dashboard', tickets: 'Tickets', projects: 'Projects',
  reports: 'Reports', calendar: 'Calendar', settings: 'Settings',
};

export default function Modules() {
  const [modules, setModules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(false);

  useEffect(() => {
    api.get('/modules')
      .then(({ data }) => setModules(data.modules))
      .catch((err) => setError(errMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  const toggle = (moduleName, role) => setModules((ms) => ms.map((m) => {
    if (m.moduleName !== moduleName) return m;
    const roles = m.visibleToRoles || [];
    return {
      ...m,
      visibleToRoles: roles.includes(role) ? roles.filter((r) => r !== role) : [...roles, role],
    };
  }));

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await api.put('/modules', { modules });
      setSavedAt(true);
      setTimeout(() => setSavedAt(false), 2500);
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Spinner />;

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <Link to="/settings" className="text-sm text-prism hover:underline">← Back to Settings</Link>
      <h1 className="text-2xl font-bold text-navy-900">Modules &amp; Tabs</h1>
      <p className="text-sm text-navy-500">Choose which sidebar modules are visible to each role.</p>
      {error && <div className="rounded-md bg-red-50 p-4 text-red-700">{error}</div>}

      <div className="card overflow-x-auto">
        <table className="min-w-full divide-y divide-navy-100">
          <thead className="bg-navy-50">
            <tr>
              <th className="table-th">Module</th>
              {ROLES.map((r) => <th key={r} className="table-th text-center capitalize">{r}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-navy-100">
            {modules.map((m) => (
              <tr key={m.moduleName} className="hover:bg-navy-50">
                <td className="table-td font-medium">{LABELS[m.moduleName] || m.moduleName}</td>
                {ROLES.map((r) => (
                  <td key={r} className="table-td text-center">
                    <input type="checkbox" checked={(m.visibleToRoles || []).includes(r)}
                      onChange={() => toggle(m.moduleName, r)}
                      className="h-4 w-4 rounded border-navy-300 text-prism" />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-end gap-3">
        {savedAt && <span className="text-sm text-green-600">Saved</span>}
        <button onClick={save} className="btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
      </div>
    </div>
  );
}
