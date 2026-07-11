import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { errMessage } from '../../api/api';
import Spinner from '../../components/Spinner';

const PRIORITY_LABELS = { critical: 'Urgent', high: 'High', medium: 'Medium', low: 'Low' };

export default function SLAs() {
  const [policies, setPolicies] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [savingPriority, setSavingPriority] = useState(null);
  const [savedPriority, setSavedPriority] = useState(null);

  const load = () => {
    api.get('/sla-policies')
      .then(({ data }) => setPolicies(data.policies))
      .catch((err) => setError(errMessage(err)))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const setField = (priority, key, value) => {
    setPolicies((list) => list.map((p) => (p.priority === priority ? { ...p, [key]: value } : p)));
  };

  const save = async (priority) => {
    const policy = policies.find((p) => p.priority === priority);
    setSavingPriority(priority);
    setError('');
    try {
      const { data } = await api.patch(`/sla-policies/${priority}`, {
        firstResponseHours: policy.firstResponseHours,
        resolutionHours: policy.resolutionHours,
        useBusinessHours: policy.useBusinessHours,
      });
      setPolicies((list) => list.map((p) => (p.priority === priority ? data.policy : p)));
      setSavedPriority(priority);
      setTimeout(() => setSavedPriority(null), 2000);
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setSavingPriority(null);
    }
  };

  if (loading || !policies) return <Spinner />;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Link to="/settings" className="text-sm text-prism hover:underline">← Back to Settings</Link>
      <div>
        <h1 className="text-2xl font-bold text-navy-900">SLAs</h1>
        <p className="text-sm text-navy-500">
          Target response and resolution times per priority. These are configuration targets only —
          PRISM doesn't yet automatically calculate or flag SLA breaches against them.
        </p>
      </div>
      {error && <div className="rounded-md bg-red-50 p-4 text-red-700">{error}</div>}

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-navy-100 text-left text-xs font-semibold uppercase tracking-wide text-navy-400">
              <th className="px-4 py-3">Priority</th>
              <th className="px-4 py-3">First response (hours)</th>
              <th className="px-4 py-3">Resolution (hours)</th>
              <th className="px-4 py-3">Use business hours</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-navy-100">
            {policies.map((p) => (
              <tr key={p.priority}>
                <td className="px-4 py-3 font-medium text-navy-900">{PRIORITY_LABELS[p.priority] || p.priority}</td>
                <td className="px-4 py-3">
                  <input
                    type="number" min="0.5" step="0.5" className="input h-9 w-24 text-sm"
                    value={p.firstResponseHours}
                    onChange={(e) => setField(p.priority, 'firstResponseHours', e.target.value)}
                  />
                </td>
                <td className="px-4 py-3">
                  <input
                    type="number" min="0.5" step="0.5" className="input h-9 w-24 text-sm"
                    value={p.resolutionHours}
                    onChange={(e) => setField(p.priority, 'resolutionHours', e.target.value)}
                  />
                </td>
                <td className="px-4 py-3">
                  <input
                    type="checkbox" className="h-4 w-4 rounded border-navy-300 text-prism"
                    checked={p.useBusinessHours}
                    onChange={(e) => setField(p.priority, 'useBusinessHours', e.target.checked)}
                  />
                </td>
                <td className="px-4 py-3 text-right">
                  {savedPriority === p.priority && <span className="mr-2 text-xs text-green-600">Saved</span>}
                  <button
                    className="btn-secondary text-xs"
                    disabled={savingPriority === p.priority}
                    onClick={() => save(p.priority)}
                  >
                    {savingPriority === p.priority ? 'Saving…' : 'Save'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
