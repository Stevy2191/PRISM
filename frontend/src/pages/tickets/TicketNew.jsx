// New ticket page.
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import CategoryPicker from '../../components/CategoryPicker';
import api, { errMessage } from '../../api/api';
import { useAuth } from '../../context/AuthContext';
import { assignableContactDepartments } from '../../utils/contactDepartments';
import { useCompanySummary } from '../../context/CompanyContext';
import TagInput from '../../components/TagInput';
import TimeDropdownPicker from '../../components/TimeDropdownPicker';
import { BG, TEXT, MUTED, fieldStyle } from './theme';
import { TYPE_OPTIONS, PRIORITY_OPTIONS, SOURCE_OPTIONS, Group, Label } from './new/FormBits';
import PageHeader from '../../components/ui/PageHeader';
import Notice from '../../components/ui/Notice';
import Button from '../../components/ui/Button';
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
  const [categories, setCategories] = useState([]);
  const [categoryRequired, setCategoryRequired] = useState(false);
  const [categoryId, setCategoryId] = useState(null);
  // Required only while there is an active category to pick (as the server rules).
  const categoryNeeded = categoryRequired && categories.some((c) => c.parentId == null && c.active);
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

  useEffect(() => {
    api.get('/ticket-categories').then(({ data }) => {
      setCategories(data.categories);
      setCategoryRequired(data.categoryRequired);
    }).catch(() => {});
  }, []);

  // Additional Details section — active custom fields scoped to the
  // currently-selected ticket type and category. Re-fetched whenever either
  // changes; values for fields no longer shown are dropped so a stale hidden
  // value can't be submitted.
  // Only the latest request's answer counts: a slow one for an earlier type
  // or category must not replace the fields for the current one.
  const fieldsRequest = useRef(0);
  useEffect(() => {
    fieldsRequest.current += 1;
    const mine = fieldsRequest.current;
    api.get('/custom-fields', { params: { ticketType: type, categoryId: categoryId || '' } })
      .then(({ data }) => {
        if (mine !== fieldsRequest.current) return;
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
      .catch(() => { if (mine === fieldsRequest.current) setCustomFields([]); });
  }, [type, categoryId]);

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
        categoryId: categoryId || null,
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

      // The ticket exists by now, so a refused file (a virus, an unreachable
      // scanner) must not leave the form open to be submitted again — that
      // would create a duplicate. Report it and carry on to the ticket.
      const refused = [];
      // eslint-disable-next-line no-restricted-syntax
      for (const f of files) {
        const fd = new FormData();
        fd.append('file', f.file);
        try {
          // eslint-disable-next-line no-await-in-loop
          await api.post(`/tickets/${ticketId}/attachments`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
        } catch (uploadErr) {
          refused.push(`${f.file.name}: ${errMessage(uploadErr)}`);
        }
      }
      if (refused.length) alert(`The ticket was created, but some files were not attached:\n${refused.join('\n')}`);

      navigate(`/tickets/${ticketId}`);
    } catch (err) {
      setError(errMessage(err));
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-[1144px] pb-24 sm:pb-0 lg:px-6">
      <form onSubmit={handleSubmit} className="space-y-5">
        <PageHeader title="New Ticket" crumbs={[{ label: 'Tickets', to: '/tickets' }, { label: 'New' }]} />

        {error && <Notice tone="bad">{error}</Notice>}

        <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="divide-y divide-navy-100 rounded-xl border border-navy-100 bg-surface">
            <Group title="The problem">
              <div>
                <Label required htmlFor="new-ticket-title">Title</Label>
                <input
                  id="new-ticket-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                  className="input"
                />
              </div>
              <div>
                <Label htmlFor="new-ticket-description">Description</Label>
                <textarea
                  id="new-ticket-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="input resize-y"
                  style={{ minHeight: '140px' }}
                />
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                  <Label required htmlFor="new-ticket-type">Type</Label>
                  <select id="new-ticket-type" value={type} onChange={(e) => setType(e.target.value)} required className="input">
                    {TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div>
                  <Label required htmlFor="new-ticket-priority">Priority</Label>
                  <select id="new-ticket-priority" value={priority} onChange={(e) => setPriority(e.target.value)} required className="input">
                    {PRIORITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div>
                  <Label required htmlFor="new-ticket-source">Source</Label>
                  <select id="new-ticket-source" value={source} onChange={(e) => setSource(e.target.value)} required className="input">
                    {SOURCE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
              </div>
              {categories.length > 0 && (
                <div>
                  <Label required={categoryNeeded} htmlFor="ticket-category">Category</Label>
                  <CategoryPicker categories={categories} value={categoryId} onChange={setCategoryId} required={categoryNeeded} id="ticket-category" />
                </div>
              )}
              <div>
                <Label>Tags</Label>
                <TagInput tags={tags} onChange={setTags} />
              </div>
            </Group>

            {customFields.length > 0 && (
              <Group title="Additional details">
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
              </Group>
            )}

            <Group title="Attachments" optional>
              <Dropzone files={files} onFiles={addFiles} onRemove={removeFile} />
            </Group>
          </div>

          <div className="divide-y divide-navy-100 rounded-xl border border-navy-100 bg-surface">
            <Group title="Who it's for">
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
                      <div className="mt-2 rounded-lg border border-navy-100 p-3" style={{ backgroundColor: BG }}>
                        <p className="text-sm" style={{ color: TEXT }}>
                          {selectedContact.displayName} has no department assigned
                        </p>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <select
                            value={assignPrompt.deptId}
                            onChange={(e) => setAssignPrompt((p) => ({ ...p, deptId: e.target.value }))}
                            className="input h-9 max-w-[10rem] text-sm"
                          >
                            <option value="">Select department…</option>
                            {assignableContactDepartments(companyDepartments, user, hasPermission)
                              .map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                          </select>
                          <Button size="sm" variant="primary" onClick={handleAssignDepartment} disabled={!assignPrompt.deptId || assignPrompt.saving}>
                            {assignPrompt.saving ? 'Assigning…' : 'Assign'}
                          </Button>
                          <button type="button" onClick={handleSkipAssign} className="text-sm hover:underline" style={{ color: MUTED }}>
                            Skip
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  <div>
                    <Label htmlFor="new-ticket-customer-dept">Customer Department</Label>
                    <select id="new-ticket-customer-dept" value={customerDeptId} onChange={(e) => setCustomerDeptId(e.target.value)} className="input">
                      <option value="">None</option>
                      {companyDepartments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                  </div>
                </>
              )}

              {!isStaff && (
                <div>
                  <Label htmlFor="new-ticket-dept">Department</Label>
                  <select id="new-ticket-dept" value={customerDeptId} onChange={(e) => setCustomerDeptId(e.target.value)} className="input">
                    <option value="">None</option>
                    {companyDepartments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </div>
              )}
            </Group>

            <Group title="Who's on it">
              {isStaff && (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="new-ticket-assignee">Assignee</Label>
                    <select id="new-ticket-assignee" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} className="input">
                      <option value="">Unassigned</option>
                      {assignableUsers.map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}
                    </select>
                  </div>
                  <div>
                    <Label htmlFor="new-ticket-team">Team</Label>
                    <select id="new-ticket-team" value={teamId} onChange={(e) => setTeamId(e.target.value)} className="input">
                      <option value="">No team</option>
                      {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </div>
                </div>
              )}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="new-ticket-due">Due date</Label>
                  <input
                    id="new-ticket-due"
                    type="date"
                    value={dueDate}
                    onChange={(e) => {
                      const next = e.target.value;
                      setDueDate(next);
                      if (!next) setDueTime('');
                    }}
                    className="input w-full"
                  />
                </div>
                <div>
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

              <WatchersField directory={directory} watchers={watchers} onChange={setWatchers} />

              <AssetsField assets={linkedAssets} onChange={setLinkedAssets} />
            </Group>
          </div>
        </div>

        <div className="fixed inset-x-0 bottom-0 z-30 flex justify-end gap-3 border-t border-navy-100 bg-surface px-4 py-3 sm:static sm:z-auto sm:border-0 sm:bg-transparent sm:px-0 sm:py-0">
          <Link to="/tickets" className="btn-secondary h-10 flex-1 justify-center sm:flex-none">
            Cancel
          </Link>
          <button type="submit" disabled={saving} className="btn-primary h-10 flex-1 justify-center disabled:opacity-50 sm:flex-none">
            {saving ? 'Creating…' : 'Create Ticket'}
          </button>
        </div>
      </form>
    </div>
  );
}
