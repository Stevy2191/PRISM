// New ticket page.
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import api, { errMessage } from '../../api/api';
import { useAuth } from '../../context/AuthContext';
import { assignableContactDepartments } from '../../utils/contactDepartments';
import { useCompanySummary } from '../../context/CompanyContext';
import TagInput from '../../components/TagInput';
import TimeDropdownPicker from '../../components/TimeDropdownPicker';
import { BG, CARD_BG, BORDER, TEXT, MUTED, BLUE, fieldStyle } from './theme';
import { TYPE_OPTIONS, PRIORITY_OPTIONS, SOURCE_OPTIONS, Card, Label } from './new/FormBits';
import { CustomFieldInput } from './new/CustomFieldInput';
import { ContactPicker } from './new/ContactPicker';
import { WatchersField } from './new/WatchersField';
import { AssetsField } from './new/AssetsField';
import { Dropzone } from './new/Dropzone';

export default function TicketNew() {
  const { isStaff, user, hasPermission } = useAuth();
  const { multiCompany } = useCompanySummary();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState('request');
  const [priority, setPriority] = useState('medium');
  const [source, setSource] = useState('manual');
  const [tags, setTags] = useState([]);

  const [directory, setDirectory] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [contactId, setContactId] = useState('');
  const [selectedContact, setSelectedContact] = useState(null);
  const [customerDeptId, setCustomerDeptId] = useState('');
  const [assignPrompt, setAssignPrompt] = useState({ show: false, deptId: '', saving: false, done: false, doneText: '' });
  const [watchers, setWatchers] = useState([]);
  const [linkedAssets, setLinkedAssets] = useState([]);

  const [assignableUsers, setAssignableUsers] = useState([]);
  const [teams, setTeams] = useState([]);
  const [assigneeId, setAssigneeId] = useState('');
  const [teamId, setTeamId] = useState('');

  const [dueDate, setDueDate] = useState('');
  const [dueTime, setDueTime] = useState('');

  const [files, setFiles] = useState([]);

  const [customFields, setCustomFields] = useState([]);
  const [customFieldValues, setCustomFieldValues] = useState({});

  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get('/departments').then(({ data }) => setDepartments(data.departments)).catch(() => {});
    if (isStaff) {
      api.get('/teams').then(({ data }) => setTeams(data.teams)).catch(() => {});
    }
  }, [isStaff]);

  // Assignees and watchers must reach the ticket's company (plan 2b): once a
  // contact is picked, both lists narrow to that contact's company.
  useEffect(() => {
    const params = selectedContact ? { companyId: selectedContact.companyId } : {};
    api.get('/users/directory', { params }).then(({ data }) => setDirectory(data.users)).catch(() => {});
    if (isStaff) api.get('/users/assignable', { params }).then(({ data }) => setAssignableUsers(data.users)).catch(() => {});
  }, [isStaff, selectedContact?.companyId]); // eslint-disable-line react-hooks/exhaustive-deps

  // A ticket's department belongs to its contact's company (spec).
  const companyDepartments = selectedContact
    ? departments.filter((d) => d.companyId === selectedContact.companyId)
    : departments;

  // Additional Details section — active custom fields scoped to the
  // currently-selected ticket type. Re-fetched whenever type changes; values
  // for fields no longer shown are dropped so a stale hidden value can't be
  // submitted.
  useEffect(() => {
    api.get('/custom-fields', { params: { ticketType: type } })
      .then(({ data }) => {
        setCustomFields(data.customFields);
        setCustomFieldValues((prev) => {
          const keys = new Set(data.customFields.map((f) => f.fieldKey));
          const next = {};
          Object.keys(prev).forEach((k) => { if (keys.has(k)) next[k] = prev[k]; });
          data.customFields.forEach((f) => {
            if (next[f.fieldKey] === undefined && f.defaultValue) next[f.fieldKey] = f.defaultValue;
          });
          return next;
        });
      })
      .catch(() => setCustomFields([]));
  }, [type]);

  const setCustomFieldValue = (key, value) => setCustomFieldValues((prev) => ({ ...prev, [key]: value }));

  // Pre-fills the contact when arriving from a contact's "Create ticket" button.
  useEffect(() => {
    const preselect = searchParams.get('contactId');
    if (!preselect) return;
    api.get(`/contacts/${preselect}`).then(({ data }) => selectContact(data.contact)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pre-fills the related asset + description when arriving from an asset's
  // "Create ticket for this asset" button.
  useEffect(() => {
    const preselect = searchParams.get('assetId');
    if (!preselect) return;
    api.get(`/assets/${preselect}`).then(({ data }) => {
      setLinkedAssets((prev) => (prev.some((a) => a.id === data.asset.id) ? prev : [...prev, data.asset]));
      setDescription((prev) => prev || `Related asset: ${data.asset.assetTag} — ${data.asset.name}\n\n`);
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectContact = (contact) => {
    if (!contact) {
      setContactId('');
      setSelectedContact(null);
      setCustomerDeptId('');
      setAssignPrompt({ show: false, deptId: '', saving: false, done: false, doneText: '' });
      return;
    }
    setContactId(contact.id);
    setSelectedContact(contact);
    // The assignee and watchers are re-chosen from the new company's people.
    setAssigneeId('');
    setWatchers([]);
    if (contact.departmentId) {
      setCustomerDeptId(String(contact.departmentId));
      setAssignPrompt({ show: false, deptId: '', saving: false, done: false, doneText: '' });
    } else {
      setCustomerDeptId('');
      setAssignPrompt({ show: true, deptId: '', saving: false, done: false, doneText: '' });
    }
  };

  const handleAssignDepartment = async () => {
    if (!assignPrompt.deptId) return;
    setAssignPrompt((p) => ({ ...p, saving: true }));
    try {
      await api.patch(`/contacts/${contactId}/department`, { departmentId: assignPrompt.deptId });
      const deptName = departments.find((d) => d.id === Number(assignPrompt.deptId))?.name || 'the department';
      setSelectedContact((prev) => (prev ? { ...prev, departmentId: Number(assignPrompt.deptId) } : prev));
      setCustomerDeptId(assignPrompt.deptId);
      setAssignPrompt((p) => ({
        ...p,
        saving: false,
        done: true,
        doneText: `${selectedContact?.displayName} assigned to ${deptName} — all tickets updated`,
      }));
    } catch (err) {
      setAssignPrompt((p) => ({ ...p, saving: false }));
      alert(errMessage(err));
    }
  };

  const handleSkipAssign = () => setAssignPrompt({ show: false, deptId: '', saving: false, done: false, doneText: '' });

  const addFiles = (list) => setFiles((prev) => [...prev, ...list.map((file) => ({ file, id: `${file.name}-${file.size}-${prev.length}-${Math.random()}` }))]);
  const removeFile = (id) => setFiles((prev) => prev.filter((f) => f.id !== id));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isStaff && !contactId) {
      setError('Customer is required');
      return;
    }
    const isCustomFieldMissing = (f) => {
      const v = customFieldValues[f.fieldKey];
      if (f.fieldType === 'checkbox') return v !== 'true';
      return !String(v || '').trim();
    };
    const missingField = customFields.find((f) => f.isRequired && isCustomFieldMissing(f));
    if (missingField) {
      setError(`"${missingField.label}" is required`);
      return;
    }
    setError('');
    setSaving(true);
    try {
      const payload = {
        title: title.trim(),
        description: description || undefined,
        type,
        priority,
        source,
        tags: tags.length ? tags : undefined,
        departmentId: customerDeptId || undefined,
        dueDate: dueDate || undefined,
        dueTime: dueDate ? (dueTime || undefined) : undefined,
        watcherIds: watchers.map((w) => w.id),
        assetIds: linkedAssets.length ? linkedAssets.map((a) => a.id) : undefined,
        customFieldValues: Object.keys(customFieldValues).length ? customFieldValues : undefined,
      };
      if (isStaff) {
        payload.contactId = contactId;
        payload.assigneeId = assigneeId || undefined;
        payload.teamId = teamId || undefined;
      }
      const { data } = await api.post('/tickets', payload);
      const ticketId = data.ticket.id;

      // eslint-disable-next-line no-restricted-syntax
      for (const f of files) {
        const fd = new FormData();
        fd.append('file', f.file);
        // eslint-disable-next-line no-await-in-loop
        await api.post(`/tickets/${ticketId}/attachments`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      }

      navigate(`/tickets/${ticketId}`);
    } catch (err) {
      setError(errMessage(err));
      setSaving(false);
    }
  };

  return (
    <div style={{ backgroundColor: BG, margin: '-2rem -1.5rem', padding: '2rem 1.5rem' }} className="min-h-full">
      <form onSubmit={handleSubmit} className="mx-auto max-w-3xl space-y-6 pb-24 sm:pb-0">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: TEXT }}>New Ticket</h1>
        </div>

        {error && (
          <div
            className="rounded-md p-4 text-sm"
            style={{
              backgroundColor: 'color-mix(in srgb, var(--color-danger) 12%, var(--color-bg))',
              color: 'var(--color-danger)',
              border: '1px solid var(--color-danger)',
            }}
          >
            {error}
          </div>
        )}

        <Card title="Core Info">
          <div>
            <Label required>Title</Label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              className="input"
              style={fieldStyle}
            />
          </div>
          <div>
            <Label>Description</Label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="input resize-y"
              style={{ ...fieldStyle, minHeight: '90px' }}
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <Label required>Type</Label>
              <select value={type} onChange={(e) => setType(e.target.value)} required className="input" style={fieldStyle}>
                {TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <Label required>Priority</Label>
              <select value={priority} onChange={(e) => setPriority(e.target.value)} required className="input" style={fieldStyle}>
                {PRIORITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <Label required>Source</Label>
              <select value={source} onChange={(e) => setSource(e.target.value)} required className="input" style={fieldStyle}>
                {SOURCE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>
          <div>
            <Label>Tags</Label>
            <TagInput tags={tags} onChange={setTags} />
          </div>
        </Card>

        {customFields.length > 0 && (
          <Card title="Additional Details">
            {customFields.map((f) => (
              <div key={f.id}>
                <Label required={f.isRequired}>{f.label}</Label>
                <CustomFieldInput
                  field={f}
                  value={customFieldValues[f.fieldKey]}
                  onChange={(v) => setCustomFieldValue(f.fieldKey, v)}
                />
              </div>
            ))}
          </Card>
        )}

        <Card title="People">
          {isStaff && (
            <>
              <div>
                <Label required>Customer</Label>
                <ContactPicker selectedContact={selectedContact} onSelect={selectContact} />
                {multiCompany && selectedContact?.company && (
                  <p className="mt-1 text-xs" style={{ color: MUTED }}>Company: {selectedContact.company.name}</p>
                )}

                {assignPrompt.done && (
                  <p className="mt-2 text-sm font-medium" style={{ color: 'var(--color-success)' }}>{assignPrompt.doneText}</p>
                )}
                {assignPrompt.show && !assignPrompt.done && selectedContact && (
                  <div className="mt-2 rounded-md border p-3" style={{ borderColor: BORDER, backgroundColor: BG }}>
                    <p className="text-sm" style={{ color: TEXT }}>
                      {selectedContact.displayName} has no department assigned
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <select
                        value={assignPrompt.deptId}
                        onChange={(e) => setAssignPrompt((p) => ({ ...p, deptId: e.target.value }))}
                        className="input h-9 max-w-[10rem] text-sm"
                        style={fieldStyle}
                      >
                        <option value="">Select department…</option>
                        {assignableContactDepartments(companyDepartments, user, hasPermission)
                          .map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                      </select>
                      <button
                        type="button"
                        onClick={handleAssignDepartment}
                        disabled={!assignPrompt.deptId || assignPrompt.saving}
                        className="rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
                        style={{ backgroundColor: BLUE }}
                      >
                        {assignPrompt.saving ? 'Assigning…' : 'Assign'}
                      </button>
                      <button type="button" onClick={handleSkipAssign} className="text-sm hover:underline" style={{ color: MUTED }}>
                        Skip
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div>
                <Label>Customer Department</Label>
                <select
                  value={customerDeptId}
                  onChange={(e) => setCustomerDeptId(e.target.value)}
                  className="input"
                  style={fieldStyle}
                >
                  <option value="">None</option>
                  {companyDepartments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
            </>
          )}

          {!isStaff && (
            <div>
              <Label>Department</Label>
              <select
                value={customerDeptId}
                onChange={(e) => setCustomerDeptId(e.target.value)}
                className="input"
                style={fieldStyle}
              >
                <option value="">None</option>
                {companyDepartments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
          )}

          <WatchersField directory={directory} watchers={watchers} onChange={setWatchers} />

          <AssetsField assets={linkedAssets} onChange={setLinkedAssets} />

          {isStaff && (
            <div className="border-t pt-4" style={{ borderColor: BORDER }}>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <Label>Assignee</Label>
                  <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} className="input" style={fieldStyle}>
                    <option value="">Unassigned</option>
                    {assignableUsers.map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}
                  </select>
                </div>
                <div>
                  <Label>Team</Label>
                  <select value={teamId} onChange={(e) => setTeamId(e.target.value)} className="input" style={fieldStyle}>
                    <option value="">No team</option>
                    {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
              </div>
            </div>
          )}
        </Card>

        <Card title="Scheduling">
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-full sm:w-auto">
              <Label>Due date</Label>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => {
                  const next = e.target.value;
                  setDueDate(next);
                  if (!next) setDueTime('');
                }}
                className="input w-full sm:max-w-[12rem]"
                style={fieldStyle}
              />
            </div>
            <div className="w-full sm:w-auto">
              <Label>Due time</Label>
              <div title={!dueDate ? 'Set a due date first' : ''}>
                <TimeDropdownPicker
                  value={dueTime}
                  onChange={setDueTime}
                  disabled={!dueDate}
                  fieldStyle={fieldStyle}
                />
              </div>
            </div>
          </div>
        </Card>

        <Card title="Attachments" optional>
          <Dropzone files={files} onFiles={addFiles} onRemove={removeFile} />
        </Card>

        <div
          className="fixed inset-x-0 bottom-0 z-30 flex justify-between gap-3 border-t px-4 py-3 sm:static sm:z-auto sm:border-0 sm:px-0 sm:py-0 sm:pt-2"
          style={{ backgroundColor: CARD_BG, borderColor: BORDER }}
        >
          <Link
            to="/tickets"
            className="flex-1 rounded-md border px-4 py-2 text-center text-sm font-medium sm:flex-none"
            style={{ borderColor: BORDER, color: TEXT }}
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={saving}
            className="flex-1 rounded-md px-5 py-2 text-sm font-semibold text-white disabled:opacity-50 sm:flex-none"
            style={{ backgroundColor: BLUE }}
          >
            {saving ? 'Creating…' : 'Create Ticket'}
          </button>
        </div>
      </form>
    </div>
  );
}
