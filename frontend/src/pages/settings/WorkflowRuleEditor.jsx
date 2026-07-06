import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import api, { errMessage } from '../../api/api';
import Spinner from '../../components/Spinner';
import Modal from '../../components/Modal';
import Switch from '../../components/Switch';

const TRIGGER_OPTIONS = [
  { value: 'ticket_created', label: 'Ticket created' },
  { value: 'ticket_updated', label: 'Any ticket field updated' },
  { value: 'ticket_status_changed', label: 'Status changed' },
  { value: 'ticket_priority_changed', label: 'Priority changed' },
  { value: 'ticket_assigned', label: 'Assignee changed' },
  { value: 'ticket_comment_added', label: 'Reply or comment added' },
  { value: 'ticket_due_date_approaching', label: 'Due date approaching' },
  { value: 'ticket_overdue', label: 'Ticket becomes overdue' },
  { value: 'ticket_closed', label: 'Ticket closed' },
];

const STATIC_CONDITION_FIELDS = [
  { value: 'status', label: 'Status', kind: 'status' },
  { value: 'priority', label: 'Priority', kind: 'priority' },
  { value: 'type', label: 'Ticket type', kind: 'type' },
  { value: 'department', label: 'Department (ticket)', kind: 'department' },
  { value: 'assignee', label: 'Assignee', kind: 'assignee' },
  { value: 'team', label: 'Team', kind: 'team' },
  { value: 'tag', label: 'Tag', kind: 'text' },
  { value: 'title', label: 'Title', kind: 'text' },
  { value: 'contact_department', label: "Contact's department", kind: 'department' },
  { value: 'created_by_role', label: 'Created by (role)', kind: 'role' },
  { value: 'time_since_created', label: 'Hours since created', kind: 'number' },
  { value: 'time_since_last_update', label: 'Hours since last update', kind: 'number' },
];

const TEXT_OPERATORS = [
  { value: 'equals', label: 'equals' },
  { value: 'not_equals', label: 'does not equal' },
  { value: 'contains', label: 'contains' },
  { value: 'not_contains', label: 'does not contain' },
  { value: 'is_empty', label: 'is empty' },
  { value: 'is_not_empty', label: 'is not empty' },
];
const NUMBER_OPERATORS = [
  { value: 'equals', label: 'equals' },
  { value: 'not_equals', label: 'does not equal' },
  { value: 'greater_than', label: 'greater than' },
  { value: 'less_than', label: 'less than' },
  { value: 'is_empty', label: 'is empty' },
  { value: 'is_not_empty', label: 'is not empty' },
];

const ACTION_OPTIONS = [
  { value: 'assign_to_user', label: 'Assign to user' },
  { value: 'assign_to_team', label: 'Assign to team' },
  { value: 'assign_round_robin', label: 'Round-robin assign within team' },
  { value: 'set_status', label: 'Set status' },
  { value: 'set_priority', label: 'Set priority' },
  { value: 'add_tag', label: 'Add tag' },
  { value: 'remove_tag', label: 'Remove tag' },
  { value: 'set_due_date', label: 'Set due date' },
  { value: 'send_notification', label: 'Send notification' },
  { value: 'add_private_comment', label: 'Add private comment' },
  { value: 'escalate_to_user', label: 'Escalate to user' },
];
const PRIORITY_OPTIONS = ['low', 'medium', 'high', 'critical'];

function fieldKind(field, customFieldDefs) {
  if (field.startsWith('custom_field:')) {
    const key = field.slice('custom_field:'.length);
    const cf = customFieldDefs.find((f) => f.fieldKey === key);
    if (cf?.fieldType === 'number') return 'number';
    if (cf?.fieldType === 'dropdown') return 'customDropdown';
    return 'text';
  }
  return STATIC_CONDITION_FIELDS.find((f) => f.value === field)?.kind || 'text';
}

// ==================== Condition row ====================
function ConditionRow({ condition, onChange, onDelete, statuses, departments, assignableUsers, teams, roles, customFieldDefs }) {
  const kind = fieldKind(condition.field, customFieldDefs);
  const operators = kind === 'number' ? NUMBER_OPERATORS : TEXT_OPERATORS;
  const needsValue = !['is_empty', 'is_not_empty'].includes(condition.operator);

  const fieldOptions = [
    ...STATIC_CONDITION_FIELDS,
    ...customFieldDefs.map((f) => ({ value: `custom_field:${f.fieldKey}`, label: `Custom field: ${f.label}`, kind: 'custom' })),
  ];

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-navy-100 p-2.5">
      <select className="input h-9 max-w-[13rem] text-sm" value={condition.field} onChange={(e) => onChange({ ...condition, field: e.target.value, value: '' })}>
        {fieldOptions.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
      </select>
      <select className="input h-9 max-w-[10rem] text-sm" value={condition.operator} onChange={(e) => onChange({ ...condition, operator: e.target.value })}>
        {operators.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {needsValue && (
        <ConditionValueInput
          kind={kind}
          field={condition.field}
          value={condition.value || ''}
          onChange={(value) => onChange({ ...condition, value })}
          statuses={statuses}
          departments={departments}
          assignableUsers={assignableUsers}
          teams={teams}
          roles={roles}
          customFieldDefs={customFieldDefs}
        />
      )}
      <button type="button" onClick={onDelete} className="ml-auto text-red-500">✕</button>
    </div>
  );
}

function ConditionValueInput({ kind, field, value, onChange, statuses, departments, assignableUsers, teams, roles, customFieldDefs }) {
  const cls = 'input h-9 flex-1 text-sm';
  if (kind === 'status') {
    return (
      <select className={cls} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Select status…</option>
        {statuses.map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
      </select>
    );
  }
  if (kind === 'priority') {
    return (
      <select className={cls} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Select priority…</option>
        {PRIORITY_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
      </select>
    );
  }
  if (kind === 'type') {
    return (
      <select className={cls} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Select type…</option>
        {['incident', 'request', 'problem', 'change'].map((t) => <option key={t} value={t}>{t}</option>)}
      </select>
    );
  }
  if (kind === 'department') {
    return (
      <select className={cls} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Select department…</option>
        {departments.map((d) => <option key={d.id} value={d.name}>{d.name}</option>)}
      </select>
    );
  }
  if (kind === 'assignee') {
    return (
      <select className={cls} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Select…</option>
        <option value="unassigned">Unassigned</option>
        {assignableUsers.map((u) => <option key={u.id} value={String(u.id)}>{u.displayName}</option>)}
      </select>
    );
  }
  if (kind === 'team') {
    return (
      <select className={cls} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Select…</option>
        <option value="no_team">No team</option>
        {teams.map((t) => <option key={t.id} value={String(t.id)}>{t.name}</option>)}
      </select>
    );
  }
  if (kind === 'role') {
    return (
      <select className={cls} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Select role…</option>
        {roles.map((r) => <option key={r.id} value={r.name}>{r.name}</option>)}
      </select>
    );
  }
  if (kind === 'customDropdown') {
    const cf = customFieldDefs.find((f) => `custom_field:${f.fieldKey}` === field);
    return (
      <select className={cls} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Select…</option>
        {(cf?.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }
  if (kind === 'number') {
    return <input type="number" className={cls} value={value} onChange={(e) => onChange(e.target.value)} placeholder="Hours" />;
  }
  return <input className={cls} value={value} onChange={(e) => onChange(e.target.value)} placeholder="Value" />;
}

// ==================== Action row ====================
function ActionRow({ action, dragging, onDragStart, onDragOver, onDrop, onDragEnd, onChange, onDelete, statuses, assignableUsers, teams }) {
  const v = action.actionValue || {};
  const setValue = (patch) => onChange({ ...action, actionValue: { ...v, ...patch } });

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      className="space-y-2 rounded-md border border-navy-100 p-3"
      style={{ opacity: dragging ? 0.5 : 1 }}
    >
      <div className="flex items-center gap-2">
        <span className="cursor-grab select-none text-navy-300" title="Drag to reorder">⠿</span>
        <select
          className="input h-9 flex-1 text-sm"
          value={action.actionType}
          onChange={(e) => onChange({ ...action, actionType: e.target.value, actionValue: {} })}
        >
          {ACTION_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <button type="button" onClick={onDelete} className="text-red-500">✕</button>
      </div>

      {(action.actionType === 'assign_to_user' || action.actionType === 'escalate_to_user') && (
        <select className="input h-9 text-sm" value={v.userId || ''} onChange={(e) => setValue({ userId: Number(e.target.value) })}>
          <option value="">Select user…</option>
          {assignableUsers.map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}
        </select>
      )}

      {(action.actionType === 'assign_to_team' || action.actionType === 'assign_round_robin') && (
        <select className="input h-9 text-sm" value={v.teamId || ''} onChange={(e) => setValue({ teamId: Number(e.target.value) })}>
          <option value="">Select team…</option>
          {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      )}

      {action.actionType === 'set_status' && (
        <select className="input h-9 text-sm" value={v.status || ''} onChange={(e) => setValue({ status: e.target.value })}>
          <option value="">Select status…</option>
          {statuses.map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
        </select>
      )}

      {action.actionType === 'set_priority' && (
        <select className="input h-9 text-sm" value={v.priority || ''} onChange={(e) => setValue({ priority: e.target.value })}>
          <option value="">Select priority…</option>
          {PRIORITY_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      )}

      {(action.actionType === 'add_tag' || action.actionType === 'remove_tag') && (
        <input className="input h-9 text-sm" value={v.tag || ''} onChange={(e) => setValue({ tag: e.target.value })} placeholder="Tag name" />
      )}

      {action.actionType === 'set_due_date' && (
        <div className="flex gap-2">
          <input type="number" min="1" className="input h-9 w-24 text-sm" value={v.amount || ''} onChange={(e) => setValue({ amount: Number(e.target.value) })} />
          <select className="input h-9 text-sm" value={v.unit || 'hours'} onChange={(e) => setValue({ unit: e.target.value })}>
            <option value="hours">Hours from now</option>
            <option value="days">Days from now</option>
          </select>
        </div>
      )}

      {action.actionType === 'send_notification' && (
        <div className="space-y-2">
          <select className="input h-9 text-sm" value={v.recipient || ''} onChange={(e) => setValue({ recipient: e.target.value })}>
            <option value="">Select recipient…</option>
            <option value="assignee">Assignee</option>
            <option value="contact">Contact</option>
            <option value="user">Specific user</option>
            <option value="team">Team members</option>
          </select>
          {v.recipient === 'user' && (
            <select className="input h-9 text-sm" value={v.userId || ''} onChange={(e) => setValue({ userId: Number(e.target.value) })}>
              <option value="">Select user…</option>
              {assignableUsers.map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}
            </select>
          )}
          {v.recipient === 'team' && (
            <select className="input h-9 text-sm" value={v.teamId || ''} onChange={(e) => setValue({ teamId: Number(e.target.value) })}>
              <option value="">Select team…</option>
              {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          )}
          <input
            className="input h-9 text-sm"
            value={v.message || ''}
            onChange={(e) => setValue({ message: e.target.value })}
            placeholder="Message (supports {{ticket.title}}, {{ticket.status}}, {{contact.name}})"
          />
        </div>
      )}

      {action.actionType === 'add_private_comment' && (
        <div>
          <textarea
            className="input resize-y text-sm"
            style={{ minHeight: '70px' }}
            value={v.text || ''}
            onChange={(e) => setValue({ text: e.target.value })}
            placeholder="Comment text — supports {{ticket.title}}, {{ticket.status}}, {{contact.name}}"
          />
        </div>
      )}
    </div>
  );
}

// ==================== Test rule modal ====================
function TestRuleModal({ ruleId, onClose }) {
  const [ticketId, setTicketId] = useState('');
  const [tickets, setTickets] = useState([]);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    api.get('/tickets').then(({ data }) => setTickets(data.tickets.slice(0, 100))).catch(() => {});
  }, []);

  const run = async () => {
    if (!ticketId) return;
    setTesting(true);
    setError('');
    setResult(null);
    try {
      const { data } = await api.post(`/workflow-rules/${ruleId}/test`, { ticketId });
      setResult(data);
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setTesting(false);
    }
  };

  return (
    <Modal title="Test this rule" onClose={onClose} wide>
      <div className="space-y-4">
        <p className="text-sm text-navy-500">
          Pick a ticket to simulate this rule against. No actions are actually executed.
        </p>
        <div className="flex gap-2">
          <select className="input h-9 flex-1 text-sm" value={ticketId} onChange={(e) => setTicketId(e.target.value)}>
            <option value="">Select a ticket…</option>
            {tickets.map((t) => <option key={t.id} value={t.id}>#{String(t.id).padStart(5, '0')} {t.title}</option>)}
          </select>
          <button type="button" onClick={run} disabled={!ticketId || testing} className="btn-primary">
            {testing ? 'Testing…' : 'Run test'}
          </button>
        </div>

        {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

        {result && (
          <div className="space-y-3">
            <div className={`rounded-md p-3 text-sm font-medium ${result.matched ? 'bg-emerald-50 text-emerald-700' : 'bg-navy-50 text-navy-500'}`}>
              {result.matched ? 'Conditions matched — actions below would run.' : 'Conditions did not match — no actions would run.'}
            </div>
            {result.conditionResults.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-navy-400">Conditions</p>
                <ul className="space-y-1 text-sm">
                  {result.conditionResults.map((c, i) => (
                    <li key={i} className="flex items-center gap-2">
                      <span className={c.matched ? 'text-emerald-600' : 'text-red-500'}>{c.matched ? '✓' : '✕'}</span>
                      <span className="text-navy-700">{c.field} {c.operator.replace(/_/g, ' ')} {c.value ?? ''}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {result.wouldExecute.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-navy-400">Would execute</p>
                <ul className="space-y-1 text-sm text-navy-700">
                  {result.wouldExecute.map((a, i) => <li key={i}>{a.description}</li>)}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
      <div className="mt-4 flex justify-end">
        <button type="button" onClick={onClose} className="btn-secondary">Close</button>
      </div>
    </Modal>
  );
}

// ==================== Page ====================
export default function WorkflowRuleEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isNew = !id;

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [triggerEvent, setTriggerEvent] = useState('ticket_created');
  const [hoursBefore, setHoursBefore] = useState(24);
  const [conditionMatch, setConditionMatch] = useState('all');
  const [conditions, setConditions] = useState([]);
  const [actions, setActions] = useState([]);

  const [statuses, setStatuses] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [assignableUsers, setAssignableUsers] = useState([]);
  const [teams, setTeams] = useState([]);
  const [roles, setRoles] = useState([]);
  const [customFieldDefs, setCustomFieldDefs] = useState([]);

  const [loading, setLoading] = useState(!isNew);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [showTest, setShowTest] = useState(false);

  const dragActionId = useRef(null);
  const [draggingActionIdx, setDraggingActionIdx] = useState(null);

  useEffect(() => {
    api.get('/ticket-statuses').then(({ data }) => setStatuses(data.statuses)).catch(() => {});
    api.get('/departments').then(({ data }) => setDepartments(data.departments)).catch(() => {});
    api.get('/users/assignable').then(({ data }) => setAssignableUsers(data.users)).catch(() => {});
    api.get('/teams').then(({ data }) => setTeams(data.teams)).catch(() => {});
    api.get('/roles').then(({ data }) => setRoles(data.roles)).catch(() => {});
    api.get('/custom-fields').then(({ data }) => setCustomFieldDefs(data.customFields.filter((f) => f.isActive))).catch(() => {});
  }, []);

  useEffect(() => {
    if (isNew) return;
    api.get(`/workflow-rules/${id}`)
      .then(({ data }) => {
        const rule = data.rule;
        setName(rule.name);
        setDescription(rule.description || '');
        setIsActive(rule.isActive);
        setTriggerEvent(rule.triggerEvent);
        setHoursBefore(rule.triggerConfig?.hoursBefore || 24);
        setConditionMatch(rule.conditionMatch);
        setConditions(rule.conditions.map((c) => ({ field: c.field, operator: c.operator, value: c.value || '' })));
        setActions(rule.actions.map((a) => ({ actionType: a.actionType, actionValue: a.actionValue || {} })));
      })
      .catch((err) => setError(errMessage(err)))
      .finally(() => setLoading(false));
  }, [id, isNew]);

  const addCondition = () => setConditions((prev) => [...prev, { field: 'status', operator: 'equals', value: '' }]);
  const updateCondition = (idx, next) => setConditions((prev) => prev.map((c, i) => (i === idx ? next : c)));
  const removeCondition = (idx) => setConditions((prev) => prev.filter((_, i) => i !== idx));

  const addAction = () => setActions((prev) => [...prev, { actionType: 'assign_to_user', actionValue: {} }]);
  const updateAction = (idx, next) => setActions((prev) => prev.map((a, i) => (i === idx ? next : a)));
  const removeAction = (idx) => setActions((prev) => prev.filter((_, i) => i !== idx));
  const dropAction = (targetIdx) => {
    const sourceIdx = dragActionId.current;
    dragActionId.current = null;
    setDraggingActionIdx(null);
    if (sourceIdx === null || sourceIdx === targetIdx) return;
    setActions((prev) => {
      const next = [...prev];
      const [moved] = next.splice(sourceIdx, 1);
      next.splice(targetIdx, 0, moved);
      return next;
    });
  };

  const save = async (e) => {
    e.preventDefault();
    if (!name.trim()) { setError('Rule name is required'); return; }
    if (actions.length === 0) { setError('At least one action is required'); return; }
    setError('');
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        description: description || null,
        isActive,
        triggerEvent,
        triggerConfig: triggerEvent === 'ticket_due_date_approaching' ? { hoursBefore: Number(hoursBefore) || 24 } : null,
        conditionMatch,
        conditions,
        actions,
      };
      if (isNew) {
        const { data } = await api.post('/workflow-rules', payload);
        navigate(`/settings/workflow-rules/${data.rule.id}`);
      } else {
        await api.patch(`/workflow-rules/${id}`, payload);
        navigate('/settings/workflow-rules');
      }
    } catch (err) {
      setError(errMessage(err));
      setSaving(false);
    }
  };

  if (loading) return <Spinner />;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Link to="/settings/workflow-rules" className="text-sm text-prism hover:underline">← Back to Workflow Rules</Link>
      <h1 className="text-2xl font-bold text-navy-900">{isNew ? 'New workflow rule' : 'Edit workflow rule'}</h1>

      {error && <div className="rounded-md bg-red-50 p-4 text-red-700">{error}</div>}

      <form onSubmit={save} className="space-y-5">
        <div className="card space-y-4 p-5">
          <h2 className="font-semibold text-navy-900">Rule details</h2>
          <div>
            <label className="label">Name *</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div>
            <label className="label">Description</label>
            <textarea className="input resize-y" style={{ minHeight: '60px' }} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm font-medium text-navy-700">
            <Switch checked={isActive} onChange={setIsActive} label="Active" /> Active
          </label>
        </div>

        <div className="card space-y-4 p-5">
          <h2 className="font-semibold text-navy-900">Trigger</h2>
          <div>
            <label className="label">Trigger event</label>
            <select className="input" value={triggerEvent} onChange={(e) => setTriggerEvent(e.target.value)}>
              {TRIGGER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          {triggerEvent === 'ticket_due_date_approaching' && (
            <div>
              <label className="label">Hours before due date</label>
              <input type="number" min="1" className="input max-w-[10rem]" value={hoursBefore} onChange={(e) => setHoursBefore(e.target.value)} />
            </div>
          )}
        </div>

        <div className="card space-y-4 p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-navy-900">Conditions</h2>
            <div className="flex items-center gap-3">
              {conditions.length > 0 && (
                <div className="flex gap-1 rounded-md border border-navy-100 p-0.5 text-xs">
                  <button type="button" onClick={() => setConditionMatch('all')} className={`rounded px-2 py-1 ${conditionMatch === 'all' ? 'bg-prism text-white' : 'text-navy-500'}`}>Match ALL</button>
                  <button type="button" onClick={() => setConditionMatch('any')} className={`rounded px-2 py-1 ${conditionMatch === 'any' ? 'bg-prism text-white' : 'text-navy-500'}`}>Match ANY</button>
                </div>
              )}
              <button type="button" onClick={addCondition} className="text-sm text-prism hover:underline">+ Add condition</button>
            </div>
          </div>
          {conditions.length === 0 ? (
            <p className="text-sm text-navy-400">
              This rule will fire for every {TRIGGER_OPTIONS.find((t) => t.value === triggerEvent)?.label.toLowerCase()} event.
            </p>
          ) : (
            <div className="space-y-2">
              {conditions.map((c, idx) => (
                <ConditionRow
                  key={idx}
                  condition={c}
                  onChange={(next) => updateCondition(idx, next)}
                  onDelete={() => removeCondition(idx)}
                  statuses={statuses}
                  departments={departments}
                  assignableUsers={assignableUsers}
                  teams={teams}
                  roles={roles}
                  customFieldDefs={customFieldDefs}
                />
              ))}
            </div>
          )}
        </div>

        <div className="card space-y-4 p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-navy-900">Actions</h2>
            <button type="button" onClick={addAction} className="text-sm text-prism hover:underline">+ Add action</button>
          </div>
          {actions.length === 0 && <p className="text-sm text-navy-400">At least one action is required.</p>}
          <div className="space-y-2">
            {actions.map((a, idx) => (
              <ActionRow
                key={idx}
                action={a}
                dragging={draggingActionIdx === idx}
                onDragStart={() => { dragActionId.current = idx; setDraggingActionIdx(idx); }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => dropAction(idx)}
                onDragEnd={() => { dragActionId.current = null; setDraggingActionIdx(null); }}
                onChange={(next) => updateAction(idx, next)}
                onDelete={() => removeAction(idx)}
                statuses={statuses}
                assignableUsers={assignableUsers}
                teams={teams}
              />
            ))}
          </div>
        </div>

        {!isNew && (
          <div className="card space-y-3 p-5">
            <h2 className="font-semibold text-navy-900">Test rule</h2>
            <p className="text-sm text-navy-500">Simulate this rule against a real ticket without executing any actions.</p>
            <button type="button" onClick={() => setShowTest(true)} className="btn-secondary">Test this rule</button>
          </div>
        )}

        <div className="flex justify-end gap-3">
          <Link to="/settings/workflow-rules" className="btn-secondary">Cancel</Link>
          <button type="submit" disabled={saving} className="btn-primary">{saving ? 'Saving…' : 'Save rule'}</button>
        </div>
      </form>

      {showTest && <TestRuleModal ruleId={id} onClose={() => setShowTest(false)} />}
    </div>
  );
}
