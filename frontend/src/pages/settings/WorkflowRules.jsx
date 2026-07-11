import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { errMessage } from '../../api/api';
import Spinner from '../../components/Spinner';
import Modal from '../../components/Modal';
import Switch from '../../components/Switch';
import { formatTicketId } from '../../utils/ticketId';

const TRIGGER_META = {
  ticket_created: { label: 'Ticket Created', badge: 'bg-emerald-100 text-emerald-700' },
  ticket_updated: { label: 'Ticket Updated', badge: 'bg-sky-100 text-sky-700' },
  ticket_status_changed: { label: 'Status Changed', badge: 'bg-amber-100 text-amber-800' },
  ticket_priority_changed: { label: 'Priority Changed', badge: 'bg-red-100 text-red-700' },
  ticket_assigned: { label: 'Ticket Assigned', badge: 'bg-violet-100 text-violet-800' },
  ticket_comment_added: { label: 'Comment Added', badge: 'bg-sky-100 text-sky-700' },
  ticket_due_date_approaching: { label: 'Due Date Approaching', badge: 'bg-amber-100 text-amber-800' },
  ticket_overdue: { label: 'Overdue', badge: 'bg-red-100 text-red-700' },
  ticket_closed: { label: 'Ticket Closed', badge: 'bg-navy-100 text-navy-700' },
};

function TriggerBadge({ triggerEvent }) {
  const meta = TRIGGER_META[triggerEvent] || { label: triggerEvent, badge: 'bg-navy-100 text-navy-700' };
  return <span className={`badge ${meta.badge}`}>{meta.label}</span>;
}

function formatWhen(value) {
  if (!value) return 'Never';
  return new Date(value).toLocaleString();
}

// ==================== Logs modal ====================
function LogsModal({ rule, onClose }) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get(`/workflow-rules/${rule.id}/logs`)
      .then(({ data }) => setLogs(data.logs))
      .catch((err) => setError(errMessage(err)))
      .finally(() => setLoading(false));
  }, [rule.id]);

  return (
    <Modal title={`Execution log — ${rule.name}`} onClose={onClose} wide>
      {loading ? (
        <Spinner />
      ) : error ? (
        <div className="rounded-md bg-red-50 p-4 text-red-700">{error}</div>
      ) : (
        <div className="max-h-[28rem] overflow-x-auto overflow-y-auto">
          <table className="min-w-full divide-y divide-navy-100">
            <thead className="bg-navy-50">
              <tr>
                <th className="table-th">Ticket</th>
                <th className="table-th">Triggered at</th>
                <th className="table-th">Conditions met</th>
                <th className="table-th">Actions executed</th>
                <th className="table-th">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-navy-100">
              {logs.map((l) => (
                <tr key={l.id}>
                  <td className="table-td">
                    {l.ticket ? (
                      <Link to={`/tickets/${l.ticket.id}`} className="text-prism hover:underline">
                        {formatTicketId(l.ticket)} {l.ticket.title}
                      </Link>
                    ) : '—'}
                  </td>
                  <td className="table-td text-navy-500">{new Date(l.triggeredAt).toLocaleString()}</td>
                  <td className="table-td">
                    {l.conditionsMet ? (
                      <span className="badge bg-emerald-100 text-emerald-700">Yes</span>
                    ) : (
                      <span className="badge bg-navy-100 text-navy-500">No</span>
                    )}
                  </td>
                  <td className="table-td text-navy-600">
                    {Array.isArray(l.actionsExecuted) && l.actionsExecuted.length ? l.actionsExecuted.join(', ') : '—'}
                  </td>
                  <td className="table-td text-xs text-navy-400">{l.notes || '—'}</td>
                </tr>
              ))}
              {logs.length === 0 && (
                <tr><td colSpan={5} className="table-td text-center text-navy-400">No executions yet.</td></tr>
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

// ==================== Rule row ====================
function RuleRow({ rule, dragging, onDragStart, onDragOver, onDrop, onDragEnd, onToggleActive, onDuplicate, onDelete, onShowLogs }) {
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      className="flex items-center gap-3 px-4 py-3"
      style={{ opacity: dragging ? 0.5 : 1 }}
    >
      <span className="cursor-grab select-none text-navy-300" title="Drag to reorder">⠿</span>
      <Switch checked={rule.isActive} onChange={onToggleActive} label={rule.isActive ? 'Active' : 'Inactive'} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link to={`/settings/workflow-rules/${rule.id}`} className="font-medium text-navy-900 hover:underline">
            {rule.name}
          </Link>
          <TriggerBadge triggerEvent={rule.triggerEvent} />
        </div>
        {rule.description && <p className="mt-0.5 text-sm text-navy-500">{rule.description}</p>}
        <p className="mt-0.5 text-xs text-navy-400">
          {rule.conditionCount} condition{rule.conditionCount === 1 ? '' : 's'} · {rule.actionCount} action{rule.actionCount === 1 ? '' : 's'} · Last triggered: {formatWhen(rule.lastTriggeredAt)}
        </p>
      </div>
      <div className="flex flex-shrink-0 gap-3 text-xs">
        <button type="button" onClick={onShowLogs} className="text-prism hover:underline">logs</button>
        <Link to={`/settings/workflow-rules/${rule.id}`} className="text-prism hover:underline">edit</Link>
        <button type="button" onClick={onDuplicate} className="text-prism hover:underline">duplicate</button>
        <button type="button" onClick={onDelete} className="text-red-500 hover:underline">delete</button>
      </div>
    </div>
  );
}

// ==================== Page ====================
export default function WorkflowRules() {
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [logsRule, setLogsRule] = useState(null);
  const dragId = useRef(null);
  const [draggingId, setDraggingId] = useState(null);

  const load = () => {
    api.get('/workflow-rules')
      .then(({ data }) => setRules(data.rules))
      .catch((err) => setError(errMessage(err)))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const handleDrop = async (targetId) => {
    const sourceId = dragId.current;
    dragId.current = null;
    setDraggingId(null);
    if (!sourceId || sourceId === targetId) return;
    const order = rules.map((r) => r.id);
    const from = order.indexOf(sourceId);
    const to = order.indexOf(targetId);
    order.splice(to, 0, order.splice(from, 1)[0]);
    setRules(order.map((id) => rules.find((r) => r.id === id)));
    try {
      await api.patch('/workflow-rules/reorder', { order });
    } catch (err) {
      alert(errMessage(err));
      load();
    }
  };

  const toggleActive = async (rule) => {
    try {
      const { data } = await api.patch(`/workflow-rules/${rule.id}`, { isActive: !rule.isActive });
      setRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, isActive: data.rule.isActive } : r)));
    } catch (err) {
      alert(errMessage(err));
    }
  };

  const duplicateRule = async (rule) => {
    try {
      const { data } = await api.get(`/workflow-rules/${rule.id}`);
      const full = data.rule;
      const { data: created } = await api.post('/workflow-rules', {
        name: `${full.name} (copy)`,
        description: full.description,
        triggerEvent: full.triggerEvent,
        conditionMatch: full.conditionMatch,
        triggerConfig: full.triggerConfig,
        isActive: false,
        conditions: full.conditions.map((c) => ({ field: c.field, operator: c.operator, value: c.value })),
        actions: full.actions.map((a) => ({ actionType: a.actionType, actionValue: a.actionValue })),
      });
      setRules((prev) => [...prev, { ...created.rule, conditionCount: full.conditions.length, actionCount: full.actions.length }]);
    } catch (err) {
      alert(errMessage(err));
    }
  };

  const deleteRule = async (rule) => {
    if (!confirm(`Delete workflow rule "${rule.name}"? This cannot be undone.`)) return;
    try {
      await api.delete(`/workflow-rules/${rule.id}`);
      setRules((prev) => prev.filter((r) => r.id !== rule.id));
    } catch (err) {
      alert(errMessage(err));
    }
  };

  if (loading) return <Spinner />;

  const activeCount = rules.filter((r) => r.isActive).length;

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <Link to="/settings" className="text-sm text-prism hover:underline">← Back to Settings</Link>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-navy-900">Workflow Rules</h1>
          <p className="text-sm text-navy-500">{activeCount} of {rules.length} rule{rules.length === 1 ? '' : 's'} active</p>
        </div>
        <Link to="/settings/workflow-rules/new" className="btn-primary">+ New rule</Link>
      </div>

      {error && <div className="rounded-md bg-red-50 p-4 text-red-700">{error}</div>}

      <div className="card divide-y divide-navy-100">
        {rules.map((r) => (
          <RuleRow
            key={r.id}
            rule={r}
            dragging={draggingId === r.id}
            onDragStart={() => { dragId.current = r.id; setDraggingId(r.id); }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => handleDrop(r.id)}
            onDragEnd={() => { dragId.current = null; setDraggingId(null); }}
            onToggleActive={() => toggleActive(r)}
            onDuplicate={() => duplicateRule(r)}
            onDelete={() => deleteRule(r)}
            onShowLogs={() => setLogsRule(r)}
          />
        ))}
        {rules.length === 0 && <p className="px-4 py-6 text-center text-sm text-navy-400">No workflow rules yet.</p>}
      </div>

      {logsRule && <LogsModal rule={logsRule} onClose={() => setLogsRule(null)} />}
    </div>
  );
}
