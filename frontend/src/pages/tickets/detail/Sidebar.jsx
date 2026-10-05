// The ticket page's right-hand sidebar (details, people, tags, assets).
import { useEffect, useState } from 'react';
import CompanyTag from '../../../components/companies/CompanyTag';
import { Link } from 'react-router-dom';
import { IconX } from '@tabler/icons-react';
import api from '../../../api/api';
import { initials } from '../../../utils/userDisplay';
import { formatPhone } from '../../../utils/formatPhone';
import TimeDropdownPicker from '../../../components/TimeDropdownPicker';
import {
  BG,
  CARD_BG,
  BORDER,
  TEXT,
  MUTED,
  BLUE,
  PRIORITY_META,
  formatDueDateTime,
  fieldStyle,
} from '../theme';

const PRIORITY_OPTIONS = [
  { value: 'critical', label: 'Urgent' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];

const TYPE_OPTIONS = [
  { value: 'incident', label: 'Incident' },
  { value: 'request', label: 'Request' },
  { value: 'problem', label: 'Problem' },
  { value: 'task', label: 'Task' },
  { value: 'change', label: 'Change' },
];

// ---- Sidebar ----

function SidebarSection({ title, collapsed, children }) {
  if (collapsed) return children;
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide" style={{ color: MUTED }}>{title}</h3>
      {children}
    </div>
  );
}

// Inline-editable custom field value in the sidebar — mirrors the always-
// visible status/priority selects for choice-like types (dropdown,
// multiselect, checkbox), and a click-to-edit text field (with a "—" /
// "click to add" empty state) for freeform types.
function CustomFieldValue({ field, value, disabled, onSave }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');

  useEffect(() => { setDraft(value ?? ''); }, [value]);

  const commit = (v) => {
    setEditing(false);
    if (v !== (value ?? '')) onSave(v);
  };

  if (field.fieldType === 'dropdown') {
    return (
      <select disabled={disabled} value={value || ''} onChange={(e) => onSave(e.target.value)} className="input h-9 text-sm" style={fieldStyle}>
        <option value="">—</option>
        {(field.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }

  if (field.fieldType === 'checkbox') {
    return (
      <input
        type="checkbox"
        disabled={disabled}
        checked={value === 'true'}
        onChange={(e) => onSave(e.target.checked ? 'true' : 'false')}
        className="h-4 w-4 rounded"
      />
    );
  }

  if (field.fieldType === 'multiselect') {
    const selected = Array.isArray(value) ? value : [];
    const toggle = (opt) => {
      const next = selected.includes(opt) ? selected.filter((o) => o !== opt) : [...selected, opt];
      onSave(next);
    };
    return (
      <div className="flex flex-wrap gap-1.5">
        {(field.options || []).map((o) => (
          <label
            key={o}
            className="flex items-center gap-1 rounded-[3px] px-2 py-0.5 text-xs"
            style={{ backgroundColor: selected.includes(o) ? 'color-mix(in srgb, var(--color-accent) 15%, transparent)' : BORDER, color: selected.includes(o) ? BLUE : MUTED }}
          >
            <input type="checkbox" disabled={disabled} checked={selected.includes(o)} onChange={() => toggle(o)} className="h-3 w-3" />
            {o}
          </label>
        ))}
      </div>
    );
  }

  // Freeform types: text, textarea, number, date, datetime, url, email, phone.
  if (disabled) {
    return <span style={{ color: value ? TEXT : MUTED }}>{value || '—'}</span>;
  }
  if (editing) {
    const typeAttr = { number: 'number', date: 'date', datetime: 'datetime-local', url: 'url', email: 'email', phone: 'tel' }[field.fieldType] || 'text';
    return field.fieldType === 'textarea' ? (
      <textarea
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => commit(draft)}
        className="input resize-y text-sm"
        style={{ ...fieldStyle, minHeight: '60px' }}
      />
    ) : (
      <input
        autoFocus
        type={typeAttr}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => commit(draft)}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(draft); if (e.key === 'Escape') setEditing(false); }}
        className="input h-9 text-sm"
        style={fieldStyle}
      />
    );
  }
  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="group flex w-full items-center justify-between rounded px-1.5 py-1 text-left text-sm hover:bg-[var(--color-hover)]"
    >
      <span style={{ color: value ? TEXT : MUTED }}>{value || '—'}</span>
      {!value && (
        <span className="text-xs opacity-0 transition-opacity group-hover:opacity-100" style={{ color: MUTED }}>
          click to add
        </span>
      )}
    </button>
  );
}

export function Sidebar({
  ticket, collapsed, onToggle, isStaff, canAssign, onStatusChange, patchTicket,
  assignableUsers, teams, directory, ticketStatuses,
  tags, onAddTag, onRemoveTag,
  watchers, onAddWatcher, onRemoveWatcher,
  contactDepartments, contactDeptAssign, onContactDeptChange, onAssignContactDepartment,
  customFieldDefs, onSaveCustomField,
  onLinkAsset, onUnlinkAsset,
  mobileSheet,
}) {
  const [tagInput, setTagInput] = useState('');
  const [watcherQuery, setWatcherQuery] = useState('');
  const watcherResults = watcherQuery.trim()
    ? directory
        .filter(
          (u) =>
            u.displayName.toLowerCase().includes(watcherQuery.trim().toLowerCase()) &&
            !watchers.some((w) => w.userId === u.id)
        )
        .slice(0, 6)
    : [];

  const linkedAssets = ticket.linkedAssets || [];
  const [assetQuery, setAssetQuery] = useState('');
  const [assetResults, setAssetResults] = useState([]);
  useEffect(() => {
    if (!assetQuery.trim()) { setAssetResults([]); return undefined; }
    const t = setTimeout(() => {
      api.get('/assets', { params: { search: assetQuery.trim() } })
        .then(({ data }) => setAssetResults(data.assets.filter((a) => !linkedAssets.some((la) => la.id === a.id)).slice(0, 6)))
        .catch(() => setAssetResults([]));
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetQuery]);

  const width = collapsed ? 44 : 240;

  return (
    <aside
      className="relative flex-shrink-0 transition-all"
      style={{
        width: mobileSheet ? '100%' : width,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        borderRight: mobileSheet ? 'none' : `1px solid ${BORDER}`,
        backgroundColor: CARD_BG,
      }}
    >
      {!mobileSheet && (
        <button
          type="button"
          onClick={onToggle}
          className="flex-shrink-0 flex items-center text-sm"
          style={{
            width: '100%',
            height: 36,
            padding: '0 12px',
            justifyContent: collapsed ? 'center' : 'flex-end',
            backgroundColor: 'var(--color-hover)',
            borderBottom: `1px solid ${BORDER}`,
            color: TEXT,
          }}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? '›' : '‹'}
        </button>
      )}

      <div
        className={collapsed ? 'flex flex-col items-center gap-4 pt-4' : 'space-y-5 p-4'}
        style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto' }}
      >
        <SidebarSection title="Contact Info" collapsed={collapsed}>
          {collapsed ? (
            <span title={`${ticket.contact?.displayName} · ${ticket.contact?.department?.name || 'No department'} · ${ticket.contact?.email || 'no email'}`} className="text-lg">👤</span>
          ) : (
            <>
              <dl className="space-y-1.5 text-sm">
                <div>
                  <dt className="text-xs" style={{ color: MUTED }}>Name</dt>
                  <dd>
                    {ticket.contact ? (
                      <><Link to={`/contacts/${ticket.contact.id}`} className="hover:underline" style={{ color: BLUE }}>{ticket.contact.displayName}</Link><CompanyTag company={ticket.company} /></>
                    ) : (
                      <span style={{ color: TEXT }}>—</span>
                    )}
                  </dd>
                </div>
                <div><dt className="text-xs" style={{ color: MUTED }}>Department</dt><dd style={{ color: TEXT }}>{ticket.contact?.department?.name || '—'}</dd></div>
                <div><dt className="text-xs" style={{ color: MUTED }}>Email</dt><dd style={{ color: TEXT }}>{ticket.contact?.email || '—'}</dd></div>
                <div><dt className="text-xs" style={{ color: MUTED }}>Phone</dt><dd style={{ color: TEXT }}>{ticket.contact?.phone ? formatPhone(ticket.contact.phone) : '—'}</dd></div>
              </dl>
              {ticket.contact && !ticket.contact.departmentId && (
                <div className="mt-2 rounded-md border p-2.5" style={{ borderColor: BORDER, backgroundColor: BG }}>
                  <p className="text-xs" style={{ color: TEXT }}>{ticket.contact.displayName} has no department assigned</p>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <select
                      value={contactDeptAssign.deptId}
                      onChange={(e) => onContactDeptChange(e.target.value)}
                      className="input h-8 max-w-[8rem] text-xs"
                      style={{ backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: TEXT }}
                    >
                      <option value="">Select…</option>
                      {contactDepartments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                    <button
                      type="button"
                      onClick={onAssignContactDepartment}
                      disabled={!contactDeptAssign.deptId || contactDeptAssign.saving}
                      className="rounded-md px-2 py-1 text-xs font-medium text-white disabled:opacity-40"
                      style={{ backgroundColor: BLUE }}
                    >
                      {contactDeptAssign.saving ? 'Assigning…' : 'Assign'}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </SidebarSection>

        <SidebarSection title="Ticket Info" collapsed={collapsed}>
          {collapsed ? (
            <div className="flex flex-col items-center gap-4">
              <span title={`Status: ${ticket.status}`}>●</span>
              <span title={`Priority: ${PRIORITY_META[ticket.priority]?.label}`} style={{ color: PRIORITY_META[ticket.priority]?.color }}>●</span>
              <span title={`Type: ${ticket.type}`}>▣</span>
              <span title={`Assignee: ${ticket.assignee?.displayName || 'Unassigned'}`}>🧑</span>
              <span title={`Team: ${ticket.team?.name || 'No team'}`}>👥</span>
              <span title={`Due: ${formatDueDateTime(ticket.dueDate, ticket.dueTime)}`}>📅</span>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs" style={{ color: MUTED }}>Status</label>
                <select
                  disabled={!isStaff}
                  value={ticket.status}
                  onChange={(e) => onStatusChange(e.target.value)}
                  className="input h-9 text-sm"
                  style={fieldStyle}
                >
                  {ticketStatuses.map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs" style={{ color: MUTED }}>Priority</label>
                <select
                  disabled={!isStaff}
                  value={ticket.priority}
                  onChange={(e) => patchTicket({ priority: e.target.value })}
                  className="input h-9 text-sm"
                  style={fieldStyle}
                >
                  {PRIORITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs" style={{ color: MUTED }}>Type</label>
                <select
                  disabled={!isStaff}
                  value={ticket.type}
                  onChange={(e) => patchTicket({ type: e.target.value })}
                  className="input h-9 text-sm"
                  style={fieldStyle}
                >
                  {TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              {canAssign && (
                <div>
                  <label className="mb-1 block text-xs" style={{ color: MUTED }}>Assignee</label>
                  <select
                    value={ticket.assigneeId || ''}
                    onChange={(e) => patchTicket({ assigneeId: e.target.value || null })}
                    className="input h-9 text-sm"
                    style={fieldStyle}
                  >
                    <option value="">Unassigned</option>
                    {assignableUsers.map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}
                  </select>
                </div>
              )}
              <div>
                <label className="mb-1 block text-xs" style={{ color: MUTED }}>Team</label>
                <select
                  disabled={!isStaff}
                  value={ticket.teamId || ''}
                  onChange={(e) => patchTicket({ teamId: e.target.value || null })}
                  className="input h-9 text-sm"
                  style={fieldStyle}
                >
                  <option value="">No team</option>
                  {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs" style={{ color: MUTED }}>Due Date</label>
                <input
                  type="date"
                  disabled={!isStaff}
                  value={ticket.dueDate || ''}
                  onChange={(e) => patchTicket(e.target.value ? { dueDate: e.target.value } : { dueDate: null, dueTime: null })}
                  className="input h-9 text-sm"
                  style={fieldStyle}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs" style={{ color: MUTED }}>Due Time</label>
                <div title={!ticket.dueDate ? 'Set a due date first' : ''}>
                  <TimeDropdownPicker
                    value={ticket.dueTime ? ticket.dueTime.slice(0, 5) : null}
                    onChange={(v) => patchTicket({ dueTime: v })}
                    disabled={!isStaff || !ticket.dueDate}
                    fieldStyle={fieldStyle}
                    selectClassName="input h-9 text-sm"
                  />
                </div>
              </div>
            </div>
          )}
        </SidebarSection>

        {customFieldDefs.length > 0 && (
          <SidebarSection title="Custom Fields" collapsed={collapsed}>
            {collapsed ? (
              <span title={customFieldDefs.map((f) => `${f.label}: ${ticket.customFields?.[f.fieldKey] || '—'}`).join(' · ')}>▤</span>
            ) : (
              <div className="space-y-3">
                {customFieldDefs.map((f) => (
                  <div key={f.id}>
                    <label className="mb-1 block text-xs" style={{ color: MUTED }}>
                      {f.label}{f.isRequired && <span style={{ color: 'var(--color-danger)' }}> *</span>}
                    </label>
                    <CustomFieldValue
                      field={f}
                      value={ticket.customFields?.[f.fieldKey]}
                      disabled={!isStaff}
                      onSave={(v) => onSaveCustomField(f.fieldKey, v)}
                    />
                  </div>
                ))}
              </div>
            )}
          </SidebarSection>
        )}

        <SidebarSection title="Tags" collapsed={collapsed}>
          {collapsed ? (
            <span title={(tags || []).join(', ') || 'No tags'}>🏷</span>
          ) : (
            <div>
              <div className="flex flex-wrap gap-1.5">
                {(tags || []).map((tag) => (
                  <span key={tag} className="flex items-center gap-1 rounded-[3px] px-2.5 py-0.5 text-xs font-medium" style={{ backgroundColor: BORDER, color: TEXT }}>
                    {tag}
                    <button type="button" onClick={() => onRemoveTag(tag)} style={{ color: MUTED }}><IconX size={11} /></button>
                  </span>
                ))}
              </div>
              <input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && tagInput.trim()) { e.preventDefault(); onAddTag(tagInput.trim()); setTagInput(''); }
                }}
                placeholder="Add a tag…"
                className="input mt-2 h-8 text-xs"
                style={fieldStyle}
              />
            </div>
          )}
        </SidebarSection>

        <SidebarSection title="Watchers" collapsed={collapsed}>
          {collapsed ? (
            <span title={watchers.map((w) => w.user?.displayName).join(', ') || 'No watchers'}>👁</span>
          ) : (
            <div>
              <div className="space-y-1.5">
                {watchers.map((w) => (
                  <span key={w.id} className="flex items-center gap-1.5 rounded-full py-1 pl-1 pr-2 text-xs font-medium" style={{ backgroundColor: BORDER, color: TEXT }}>
                    <span className="flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-semibold" style={{ backgroundColor: CARD_BG, color: 'var(--color-accent)' }}>
                      {initials(w.user?.displayName)}
                    </span>
                    {w.user?.displayName}
                    <button type="button" onClick={() => onRemoveWatcher(w.userId)} style={{ color: MUTED }}><IconX size={11} /></button>
                  </span>
                ))}
                {watchers.length === 0 && <p className="text-xs" style={{ color: MUTED }}>No watchers.</p>}
              </div>
              <div className="relative mt-2">
                <input
                  value={watcherQuery}
                  onChange={(e) => setWatcherQuery(e.target.value)}
                  placeholder="+ Add watcher…"
                  className="input h-8 text-xs"
                  style={fieldStyle}
                />
                {watcherResults.length > 0 && (
                  <div className="absolute left-0 top-full z-10 mt-1 w-full rounded-md border p-1 shadow-lg" style={{ backgroundColor: CARD_BG, borderColor: BORDER }}>
                    {watcherResults.map((u) => (
                      <button
                        key={u.id}
                        type="button"
                        onClick={() => { onAddWatcher(u.id); setWatcherQuery(''); }}
                        className="block w-full rounded px-2 py-1 text-left text-xs hover:bg-white/5"
                        style={{ color: TEXT }}
                      >
                        {u.displayName}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </SidebarSection>

        <SidebarSection title="Linked Assets" collapsed={collapsed}>
          {collapsed ? (
            <span title={linkedAssets.map((a) => a.assetTag).join(', ') || 'No linked assets'}>🖥</span>
          ) : (
            <div>
              <div className="space-y-1.5">
                {linkedAssets.map((a) => (
                  <span key={a.id} className="flex items-center gap-1.5 rounded-full py-1 pl-2.5 pr-2 text-xs font-medium" style={{ backgroundColor: BORDER, color: TEXT }}>
                    <Link to={`/assets/${a.id}`} className="min-w-0 flex-1 truncate hover:underline">
                      <span className="font-mono">{a.assetTag}</span> — {a.name}
                    </Link>
                    <button type="button" onClick={() => onUnlinkAsset(a.id)} style={{ color: MUTED }}><IconX size={11} /></button>
                  </span>
                ))}
                {linkedAssets.length === 0 && <p className="text-xs" style={{ color: MUTED }}>No linked assets.</p>}
              </div>
              <div className="relative mt-2">
                <input
                  value={assetQuery}
                  onChange={(e) => setAssetQuery(e.target.value)}
                  placeholder="+ Link asset…"
                  className="input h-8 text-xs"
                  style={fieldStyle}
                />
                {assetResults.length > 0 && (
                  <div className="absolute left-0 top-full z-10 mt-1 w-full rounded-md border p-1 shadow-lg" style={{ backgroundColor: CARD_BG, borderColor: BORDER }}>
                    {assetResults.map((a) => (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => { onLinkAsset(a.id); setAssetQuery(''); }}
                        className="block w-full rounded px-2 py-1 text-left text-xs hover:bg-white/5"
                        style={{ color: TEXT }}
                      >
                        <span className="font-mono">{a.assetTag}</span> — {a.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </SidebarSection>
      </div>
    </aside>
  );
}
