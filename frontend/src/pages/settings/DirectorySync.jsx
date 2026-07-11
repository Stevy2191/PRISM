import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { errMessage } from '../../api/api';
import Spinner from '../../components/Spinner';
import Modal from '../../components/Modal';

const SCHEDULE_OPTIONS = [
  { value: 1, label: 'Every hour' },
  { value: 4, label: 'Every 4 hours' },
  { value: 8, label: 'Every 8 hours' },
  { value: 24, label: 'Every 24 hours' },
  { value: 0, label: 'Manual only' },
];

const STATUS_META = {
  success: { label: 'Success', className: 'bg-emerald-100 text-emerald-700' },
  failed: { label: 'Failed', className: 'bg-red-100 text-red-700' },
  running: { label: 'Running…', className: 'bg-navy-100 text-navy-600' },
};

function SyncLogModal({ onClose }) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/ad-sync/logs')
      .then(({ data }) => setLogs(data.logs))
      .catch((err) => setError(errMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  return (
    <Modal title="AD sync log (last 20 runs)" onClose={onClose} wide>
      {loading ? (
        <Spinner />
      ) : error ? (
        <div className="rounded-md bg-red-50 p-4 text-sm text-red-700">{error}</div>
      ) : (
        <div className="max-h-[26rem] overflow-x-auto overflow-y-auto">
          <table className="min-w-full divide-y divide-navy-100">
            <thead className="bg-navy-50">
              <tr>
                <th className="table-th">Started</th>
                <th className="table-th">Trigger</th>
                <th className="table-th">Status</th>
                <th className="table-th">Processed</th>
                <th className="table-th">Created</th>
                <th className="table-th">Updated</th>
                <th className="table-th">Deactivated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-navy-100">
              {logs.map((l) => {
                const meta = STATUS_META[l.status] || STATUS_META.running;
                return (
                  <tr key={l.id}>
                    <td className="table-td whitespace-nowrap">{new Date(l.startedAt).toLocaleString()}</td>
                    <td className="table-td capitalize">{l.triggeredBy}</td>
                    <td className="table-td"><span className={`badge ${meta.className}`}>{meta.label}</span></td>
                    <td className="table-td">{l.usersProcessed}</td>
                    <td className="table-td">{l.contactsCreated}</td>
                    <td className="table-td">{l.contactsUpdated}</td>
                    <td className="table-td">{l.contactsDeactivated}</td>
                  </tr>
                );
              })}
              {logs.length === 0 && (
                <tr><td colSpan={7} className="table-td text-center text-navy-400">No sync runs yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-4 flex justify-end">
        <button type="button" onClick={onClose} className="btn-secondary">Close</button>
      </div>
    </Modal>
  );
}

export default function DirectorySync() {
  const [settings, setSettings] = useState(null);
  const [mappings, setMappings] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');
  const [showLog, setShowLog] = useState(false);

  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupDept, setNewGroupDept] = useState('');
  const [addingMapping, setAddingMapping] = useState(false);

  const load = () => {
    setLoading(true);
    setError('');
    Promise.all([
      api.get('/ad-sync/settings'),
      api.get('/ad-sync/group-mappings'),
      api.get('/departments'),
    ])
      .then(([s, m, d]) => {
        setSettings(s.data);
        setMappings(m.data.mappings);
        setDepartments(d.data.departments);
      })
      .catch((err) => setError(errMessage(err)))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const saveSetting = async (patch) => {
    setSaving(true);
    try {
      await api.put('/ad-sync/settings', patch);
      setSettings((prev) => ({ ...prev, ...patch }));
    } catch (err) {
      alert(errMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const syncNow = async () => {
    setSyncing(true);
    setSyncMessage('');
    try {
      const { data } = await api.post('/ad-sync/run');
      setSyncMessage(`Sync complete — ${data.log.contactsCreated} created, ${data.log.contactsUpdated} updated, ${data.log.contactsDeactivated} deactivated.`);
      load();
    } catch (err) {
      setSyncMessage(errMessage(err));
    } finally {
      setSyncing(false);
    }
  };

  const addMapping = async () => {
    if (!newGroupName.trim() || !newGroupDept) return;
    setAddingMapping(true);
    try {
      await api.post('/ad-sync/group-mappings', { adGroupName: newGroupName.trim(), departmentId: newGroupDept });
      setNewGroupName('');
      setNewGroupDept('');
      load();
    } catch (err) {
      alert(errMessage(err));
    } finally {
      setAddingMapping(false);
    }
  };

  const removeMapping = async (id) => {
    if (!confirm('Remove this group mapping?')) return;
    try {
      await api.delete(`/ad-sync/group-mappings/${id}`);
      setMappings((prev) => prev.filter((m) => m.id !== id));
    } catch (err) {
      alert(errMessage(err));
    }
  };

  if (loading) return <Spinner />;

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <Link to="/settings" className="text-sm text-prism hover:underline">← Back to Settings</Link>
      <h1 className="text-2xl font-bold text-navy-900">Directory Sync</h1>

      {error && <div className="rounded-md bg-red-50 p-4 text-sm text-red-700">{error}</div>}

      <div className="card space-y-4 p-5">
        <h2 className="font-semibold text-navy-900">AD Contact Sync</h2>
        <p className="text-sm text-navy-500">
          Reuses the LDAP connection configured in Settings → General Settings.
          {!settings.ldapConfigured && (
            <span className="ml-1 font-medium text-amber-600">LDAP is not configured — sync will not run until it is.</span>
          )}
        </p>

        <label className="flex items-center justify-between">
          <span className="text-sm font-medium text-navy-800">Enable sync</span>
          <input
            type="checkbox"
            checked={settings.enabled}
            disabled={saving}
            onChange={(e) => saveSetting({ enabled: e.target.checked })}
            className="h-5 w-5 rounded border-navy-300 text-prism"
          />
        </label>

        <div>
          <label className="label">Sync schedule</label>
          <select
            className="input max-w-xs"
            value={settings.intervalHours}
            disabled={saving}
            onChange={(e) => saveSetting({ intervalHours: Number(e.target.value) })}
          >
            {SCHEDULE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>

        <div className="flex items-center gap-3 border-t border-navy-100 pt-4">
          <button type="button" onClick={syncNow} disabled={syncing} className="btn-primary">
            {syncing ? 'Syncing…' : 'Sync now'}
          </button>
          <button type="button" onClick={() => setShowLog(true)} className="btn-secondary">Sync log</button>
        </div>
        {syncMessage && <p className="text-sm text-navy-600">{syncMessage}</p>}

        <div className="border-t border-navy-100 pt-4 text-sm text-navy-500">
          {settings.lastSync ? (
            <>
              Last sync: <span className="font-medium text-navy-800">{new Date(settings.lastSync.startedAt).toLocaleString()}</span>
              {' — '}
              <span className={settings.lastSync.status === 'success' ? 'font-medium text-emerald-600' : settings.lastSync.status === 'failed' ? 'font-medium text-red-600' : 'font-medium text-navy-500'}>
                {settings.lastSync.status === 'success' ? 'Success' : settings.lastSync.status === 'failed' ? 'Failed' : 'Running'}
              </span>
            </>
          ) : (
            'Last sync: Never run'
          )}
        </div>
      </div>

      <div className="card space-y-4 p-5">
        <h2 className="font-semibold text-navy-900">AD Group → Department Mapping</h2>
        <p className="text-sm text-navy-500">
          When a synced user belongs to a mapped AD group, their contact gets that department. If a user is in multiple mapped groups, the first match wins.
        </p>

        <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-navy-100">
          <thead className="bg-navy-50">
            <tr>
              <th className="table-th">AD Group Name</th>
              <th className="table-th">PRISM Department</th>
              <th className="table-th" />
            </tr>
          </thead>
          <tbody className="divide-y divide-navy-100">
            {mappings.map((m) => (
              <tr key={m.id}>
                <td className="table-td">{m.adGroupName}</td>
                <td className="table-td">{m.department?.name || '—'}</td>
                <td className="table-td text-right">
                  <button type="button" onClick={() => removeMapping(m.id)} className="text-xs font-medium text-red-500 hover:underline">Remove</button>
                </td>
              </tr>
            ))}
            {mappings.length === 0 && (
              <tr><td colSpan={3} className="table-td text-center text-navy-400">No group mappings yet.</td></tr>
            )}
          </tbody>
        </table>
        </div>

        <div className="flex flex-wrap items-end gap-2 border-t border-navy-100 pt-4">
          <div className="min-w-[10rem] flex-1">
            <label className="label">AD group name</label>
            <input className="input" value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)} placeholder="e.g. IT-Staff" />
          </div>
          <div className="flex-1">
            <label className="label">Department</label>
            <select className="input" value={newGroupDept} onChange={(e) => setNewGroupDept(e.target.value)}>
              <option value="">Select department…</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <button type="button" onClick={addMapping} disabled={!newGroupName.trim() || !newGroupDept || addingMapping} className="btn-primary">
            + Add mapping
          </button>
        </div>
      </div>

      {showLog && <SyncLogModal onClose={() => setShowLog(false)} />}
    </div>
  );
}
