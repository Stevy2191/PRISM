import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  IconPaperclip, IconAt, IconArrowUp, IconArrowDown, IconX, IconUpload,
  IconFile, IconTrash,
} from '@tabler/icons-react';
import api, { errMessage } from '../api/api';
import { useAuth } from '../context/AuthContext';
import { useTimer, formatHMS } from '../context/TimerContext';
import Spinner from '../components/Spinner';
import { formatTicketId } from '../utils/ticketId';

const BG = '#080b12';
const CARD_BG = '#0d1120';
const BORDER = '#1a2235';
const TEXT = '#e2e8f0';
const MUTED = '#64748b';
const BLUE = '#3b82f6';
const PURPLE = '#7c3aed';
const PURPLE_LIGHT = '#a78bfa';
const SIDEBAR_STORAGE_KEY = 'prism.ticketDetail.sidebar';

const STATUS_OPTIONS = [
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'on_hold', label: 'Pending' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'closed', label: 'Closed' },
];
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
const PRIORITY_META = {
  critical: { label: 'Urgent', color: '#f87171' },
  high: { label: 'High', color: '#fbbf24' },
  medium: { label: 'Medium', color: '#3b82f6' },
  low: { label: 'Low', color: '#94a3b8' },
};
const STATUS_META = {
  open: { label: 'Open', cls: 'bg-[#0d2847] text-[#60a5fa]' },
  in_progress: { label: 'In Progress', cls: 'bg-[#0c2a1a] text-[#4ade80]' },
  on_hold: { label: 'Pending', cls: 'bg-[#2d1f00] text-[#fbbf24]' },
  resolved: { label: 'Resolved', cls: 'bg-[#0c2a1a] text-[#4ade80]' },
  closed: { label: 'Closed', cls: 'bg-[#1a2235] text-[#94a3b8]' },
};
const CLOSED_STATUSES = ['resolved', 'closed'];
const TABS = [
  { key: 'conversation', label: 'Conversation' },
  { key: 'time', label: 'Time Entries' },
  { key: 'tasks', label: 'Tasks' },
  { key: 'attachments', label: 'Attachments' },
  { key: 'relationships', label: 'Relationships' },
  { key: 'activity', label: 'Activity' },
];

function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase();
}
function formatMinutes(min) {
  const m = Number(min) || 0;
  const h = Math.floor(m / 60);
  return h ? `${h}h ${m % 60}m` : `${m}m`;
}
function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
function timeAgo(dateStr) {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatDate(dateStr);
}
function dueDateColor(dueDate) {
  if (!dueDate) return MUTED;
  const today = new Date().toISOString().slice(0, 10);
  const soon = new Date();
  soon.setDate(soon.getDate() + 3);
  const soonStr = soon.toISOString().slice(0, 10);
  if (dueDate < today) return '#f87171';
  if (dueDate <= soonStr) return '#fbbf24';
  return MUTED;
}

function Modal({ title, children, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-[10px] border p-5"
        style={{ backgroundColor: CARD_BG, borderColor: BORDER }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-3 text-base font-semibold" style={{ color: TEXT }}>{title}</h2>
        {children}
      </div>
    </div>
  );
}

const fieldStyle = { backgroundColor: BG, borderColor: BORDER, color: TEXT };

// ---- Header timer widget ----

function TimerWidget({ ticket, onLogged }) {
  const timer = useTimer();
  const running = timer.isRunning('ticket', ticket.id);
  const [held, setHeld] = useState(false);
  const [heldSeconds, setHeldSeconds] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  // Once "held", the visible clock freezes at the captured snapshot and the
  // server timer is treated as stopped even though the ActiveTimer row (whose
  // startedAt never moves) isn't torn down until Confirm/Cancel resolves.
  const displayRunning = running && !held;
  const displaySeconds = displayRunning ? timer.elapsedSeconds : held ? heldSeconds : 0;

  const handleStart = () => timer.start('ticket', ticket.id, `${formatTicketId(ticket)} ${ticket.title}`);

  const handleStopClick = async () => {
    const secs = timer.elapsedSeconds;
    if (secs <= 0) {
      await timer.cancel();
      return;
    }
    setHeldSeconds(secs);
    setHeld(true);
  };

  const confirmLog = async () => {
    setSaving(true);
    try {
      // Log the exact duration captured at Stop time, not whatever the
      // server's clock reads now — the user may have spent a while filling
      // in the modal, and that time shouldn't be attributed to the entry.
      const minutes = Math.max(1, Math.round(heldSeconds / 60));
      await api.post(`/tickets/${ticket.id}/time`, { minutes, note: description || undefined });
      await timer.cancel();
      onLogged?.();
    } finally {
      setSaving(false);
      setModalOpen(false);
      setHeld(false);
      setHeldSeconds(0);
      setDescription('');
    }
  };

  const discardHeld = async () => {
    setModalOpen(false);
    await timer.cancel();
    setHeld(false);
    setHeldSeconds(0);
    setDescription('');
  };

  return (
    <div className="flex items-center gap-2">
      <span
        className="rounded-md px-3 py-1.5 font-mono text-sm font-semibold"
        style={{ backgroundColor: BG, border: `1px solid ${BORDER}`, color: displayRunning ? '#4ade80' : TEXT }}
      >
        {formatHMS(displaySeconds)}
      </span>
      {!displayRunning && !held && (
        <button
          type="button"
          onClick={handleStart}
          className="rounded-md px-3 py-1.5 text-sm font-semibold text-white"
          style={{ backgroundColor: '#16a34a' }}
        >
          Start
        </button>
      )}
      {displayRunning && (
        <button
          type="button"
          onClick={handleStopClick}
          className="rounded-md px-3 py-1.5 text-sm font-semibold text-white"
          style={{ backgroundColor: '#dc2626' }}
        >
          Stop
        </button>
      )}
      {held && heldSeconds > 0 && (
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="rounded-md px-3 py-1.5 text-sm font-semibold text-white"
          style={{ backgroundColor: BLUE }}
        >
          Log time
        </button>
      )}

      {modalOpen && (
        <Modal title="Log time" onClose={discardHeld}>
          <p className="mb-3 text-sm" style={{ color: MUTED }}>
            Duration logged: <span className="font-mono font-semibold" style={{ color: TEXT }}>{formatHMS(heldSeconds)}</span>
          </p>
          <label className="mb-1 block text-sm font-medium" style={{ color: TEXT }}>Description (optional)</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="input mb-4 resize-y"
            style={{ ...fieldStyle, minHeight: '70px' }}
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={discardHeld}
              className="rounded-md border px-4 py-2 text-sm font-medium"
              style={{ borderColor: BORDER, color: TEXT }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirmLog}
              disabled={saving}
              className="rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              style={{ backgroundColor: BLUE }}
            >
              {saving ? 'Saving…' : 'Confirm'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

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

function Sidebar({
  ticket, collapsed, onToggle, isStaff, patchTicket,
  assignableUsers, teams, directory,
  tags, onAddTag, onRemoveTag,
  watchers, onAddWatcher, onRemoveWatcher,
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

  const width = collapsed ? 44 : 240;

  return (
    <aside
      className="relative flex-shrink-0 transition-all"
      style={{ width, borderRight: `1px solid ${BORDER}`, backgroundColor: CARD_BG }}
    >
      <button
        type="button"
        onClick={onToggle}
        className="absolute -right-3 top-4 z-10 flex h-6 w-6 items-center justify-center rounded-full border text-xs"
        style={{ backgroundColor: CARD_BG, borderColor: BORDER, color: TEXT }}
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {collapsed ? '›' : '‹'}
      </button>

      <div className={collapsed ? 'flex flex-col items-center gap-4 pt-14' : 'space-y-5 p-4 pt-14'}>
        <SidebarSection title="Contact Info" collapsed={collapsed}>
          {collapsed ? (
            <span title={`${ticket.requester?.displayName} · ${ticket.requester?.department?.name || 'No department'} · ${ticket.requester?.email || 'no email'}`} className="text-lg">👤</span>
          ) : (
            <dl className="space-y-1.5 text-sm">
              <div><dt className="text-xs" style={{ color: MUTED }}>Name</dt><dd style={{ color: TEXT }}>{ticket.requester?.displayName || '—'}</dd></div>
              <div><dt className="text-xs" style={{ color: MUTED }}>Department</dt><dd style={{ color: TEXT }}>{ticket.requester?.department?.name || '—'}</dd></div>
              <div><dt className="text-xs" style={{ color: MUTED }}>Email</dt><dd style={{ color: TEXT }}>{ticket.requester?.email || '—'}</dd></div>
            </dl>
          )}
        </SidebarSection>

        <SidebarSection title="Ticket Info" collapsed={collapsed}>
          {collapsed ? (
            <div className="flex flex-col items-center gap-4">
              <span title={`Status: ${STATUS_META[ticket.status]?.label}`}>●</span>
              <span title={`Priority: ${PRIORITY_META[ticket.priority]?.label}`} style={{ color: PRIORITY_META[ticket.priority]?.color }}>●</span>
              <span title={`Type: ${ticket.type}`}>▣</span>
              <span title={`Assignee: ${ticket.assignee?.displayName || 'Unassigned'}`}>🧑</span>
              <span title={`Team: ${ticket.team?.name || 'No team'}`}>👥</span>
              <span title={`Due: ${ticket.dueDate || 'None'}`}>📅</span>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs" style={{ color: MUTED }}>Status</label>
                <select
                  disabled={!isStaff}
                  value={ticket.status}
                  onChange={(e) => patchTicket({ status: e.target.value })}
                  className="input h-9 text-sm"
                  style={fieldStyle}
                >
                  {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
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
              <div>
                <label className="mb-1 block text-xs" style={{ color: MUTED }}>Assignee</label>
                <select
                  disabled={!isStaff}
                  value={ticket.assigneeId || ''}
                  onChange={(e) => patchTicket({ assigneeId: e.target.value || null })}
                  className="input h-9 text-sm"
                  style={fieldStyle}
                >
                  <option value="">Unassigned</option>
                  {assignableUsers.map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}
                </select>
              </div>
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
                  onChange={(e) => patchTicket({ dueDate: e.target.value || null })}
                  className="input h-9 text-sm"
                  style={fieldStyle}
                />
              </div>
            </div>
          )}
        </SidebarSection>

        <SidebarSection title="Tags" collapsed={collapsed}>
          {collapsed ? (
            <span title={(tags || []).join(', ') || 'No tags'}>🏷</span>
          ) : (
            <div>
              <div className="flex flex-wrap gap-1.5">
                {(tags || []).map((tag) => (
                  <span key={tag} className="flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium" style={{ backgroundColor: BORDER, color: TEXT }}>
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
                    <span className="flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-semibold" style={{ backgroundColor: CARD_BG, color: '#93c5fd' }}>
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
      </div>
    </aside>
  );
}

// ---- Conversation tab ----

function ConversationTab({ ticket, comments }) {
  return (
    <div className="space-y-4">
      {comments.length === 0 && <p className="text-sm" style={{ color: MUTED }}>No messages yet.</p>}
      {comments.map((c) => {
        const isCustomer = c.authorId === ticket.requesterId;
        return (
          <div key={c.id} className="flex items-start gap-3">
            <span
              className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
              style={{ backgroundColor: isCustomer ? '#3b82f6' : '#22c55e' }}
            >
              {initials(c.author?.displayName)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold" style={{ color: TEXT }}>{c.author?.displayName}</span>
                <span
                  className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                  style={isCustomer ? { backgroundColor: '#0d2847', color: '#60a5fa' } : { backgroundColor: '#0c2a1a', color: '#4ade80' }}
                >
                  {isCustomer ? 'Customer' : 'Tech'}
                </span>
                <span className="text-xs" style={{ color: MUTED }}>{timeAgo(c.createdAt)}</span>
              </div>
              <div className="mt-1 rounded-[10px] border p-3 text-sm" style={{ backgroundColor: CARD_BG, borderColor: BORDER, color: TEXT }}>
                <p className="whitespace-pre-wrap">{c.body}</p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ReplyBox({ ticket, onSend, fileRef, onAttach }) {
  const draftKey = `prism.ticket.${ticket.id}.draft`;
  const [text, setText] = useState(() => { try { return localStorage.getItem(draftKey) || ''; } catch { return ''; } });
  const [sending, setSending] = useState(false);
  const textareaRef = useRef(null);

  const saveDraft = () => { try { localStorage.setItem(draftKey, text); } catch { /* ignore */ } };

  const send = async () => {
    if (!text.trim()) return;
    setSending(true);
    try {
      await onSend(text);
      setText('');
      try { localStorage.removeItem(draftKey); } catch { /* ignore */ }
    } finally {
      setSending(false);
    }
  };

  const insertAt = () => {
    const el = textareaRef.current;
    if (!el) return;
    const pos = el.selectionStart ?? text.length;
    setText(text.slice(0, pos) + '@' + text.slice(pos));
  };

  return (
    <div className="sticky bottom-0 border-t p-4" style={{ backgroundColor: CARD_BG, borderColor: BORDER }}>
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={`Reply to ${ticket.requester?.displayName || 'the customer'}...`}
        className="input resize-y"
        style={{ ...fieldStyle, minHeight: '80px' }}
      />
      <div className="mt-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => fileRef.current?.click()} title="Attach a file" className="rounded-md border p-2" style={{ borderColor: BORDER, color: MUTED }}>
            <IconPaperclip size={16} />
          </button>
          <input ref={fileRef} type="file" className="hidden" onChange={onAttach} />
          <button type="button" onClick={insertAt} title="Mention someone" className="rounded-md border p-2" style={{ borderColor: BORDER, color: MUTED }}>
            <IconAt size={16} />
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={saveDraft} className="rounded-md border px-3 py-2 text-sm font-medium" style={{ borderColor: BORDER, color: TEXT }}>
            Save draft
          </button>
          <button
            type="button"
            onClick={send}
            disabled={sending || !text.trim()}
            className="rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            style={{ backgroundColor: BLUE }}
          >
            {sending ? 'Sending…' : 'Send Reply'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- Time entries tab ----

function TimeEntriesTab({ entries, totalMinutes, onAdd }) {
  const [modalOpen, setModalOpen] = useState(false);
  const [duration, setDuration] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const match = /^(\d{1,3}):([0-5]?\d)$/.exec(duration.trim());
    if (!match) { alert('Duration must be in HH:MM format'); return; }
    const minutes = Number(match[1]) * 60 + Number(match[2]);
    if (!minutes) { alert('Duration must be greater than zero'); return; }
    setSaving(true);
    try {
      await onAdd(minutes, description);
      setModalOpen(false);
      setDuration('');
      setDescription('');
    } catch (err) {
      alert(errMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="rounded-md px-3 py-2 text-sm font-semibold text-white"
          style={{ backgroundColor: BLUE }}
        >
          Add manual time entry
        </button>
      </div>
      <div className="overflow-hidden rounded-[10px] border" style={{ borderColor: BORDER, backgroundColor: CARD_BG }}>
        {entries.length === 0 && <p className="p-4 text-sm" style={{ color: MUTED }}>No time logged.</p>}
        <ul className="divide-y" style={{ borderColor: BORDER }}>
          {entries.map((e) => (
            <li key={e.id} className="flex items-center justify-between px-4 py-3">
              <div>
                <p className="text-sm" style={{ color: TEXT }}>{e.note || 'Time entry'}</p>
                <p className="text-xs" style={{ color: MUTED }}>{e.user?.displayName} · {formatDate(e.loggedAt)}</p>
              </div>
              <span className="font-mono text-sm font-semibold" style={{ color: '#4ade80' }}>{formatMinutes(e.minutes)}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="mt-3 text-right text-sm font-semibold" style={{ color: TEXT }}>
        Total: {formatMinutes(totalMinutes)}
      </div>

      {modalOpen && (
        <Modal title="Add manual time entry" onClose={() => setModalOpen(false)}>
          <label className="mb-1 block text-sm font-medium" style={{ color: TEXT }}>Duration (HH:MM)</label>
          <input value={duration} onChange={(e) => setDuration(e.target.value)} placeholder="01:30" className="input mb-3" style={fieldStyle} />
          <label className="mb-1 block text-sm font-medium" style={{ color: TEXT }}>Description</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} className="input mb-4 resize-y" style={{ ...fieldStyle, minHeight: '70px' }} />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setModalOpen(false)} className="rounded-md border px-4 py-2 text-sm font-medium" style={{ borderColor: BORDER, color: TEXT }}>Cancel</button>
            <button type="button" onClick={submit} disabled={saving} className="rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" style={{ backgroundColor: BLUE }}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ---- Tasks tab ----

function TasksTab({ tasks, assignableUsers, onToggle, onReassign, onAdd }) {
  const [text, setText] = useState('');
  return (
    <div>
      <ul className="space-y-2">
        {tasks.map((t) => (
          <li key={t.id} className="flex items-center gap-3 rounded-[10px] border p-3" style={{ borderColor: BORDER, backgroundColor: CARD_BG }}>
            <input type="checkbox" checked={t.completed} onChange={() => onToggle(t)} className="h-4 w-4 accent-blue-500" />
            <span
              className="flex-1 text-sm"
              style={{ color: t.completed ? MUTED : TEXT, textDecoration: t.completed ? 'line-through' : 'none' }}
            >
              {t.description}
            </span>
            <select
              value={t.assigneeId || ''}
              onChange={(e) => onReassign(t, e.target.value || null)}
              className="input h-8 max-w-[9rem] text-xs"
              style={fieldStyle}
            >
              <option value="">Unassigned</option>
              {assignableUsers.map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}
            </select>
          </li>
        ))}
        {tasks.length === 0 && <p className="text-sm" style={{ color: MUTED }}>No tasks yet.</p>}
      </ul>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && text.trim()) { e.preventDefault(); onAdd(text.trim()); setText(''); }
        }}
        placeholder="Add a task and press Enter…"
        className="input mt-3"
        style={fieldStyle}
      />
    </div>
  );
}

// ---- Attachments tab ----

function AttachmentsTab({ ticketId, attachments, onUpload, onRemove }) {
  const inputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);

  const handleFiles = (files) => Array.from(files).forEach((f) => onUpload(f));

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        {attachments.map((a) => (
          <a
            key={a.id}
            href={`/api/v1/tickets/${ticketId}/attachments/${a.id}/download`}
            className="group relative flex flex-col items-center gap-2 rounded-[10px] border p-4 text-center"
            style={{ borderColor: BORDER, backgroundColor: CARD_BG }}
          >
            <IconFile size={28} style={{ color: MUTED }} />
            <span className="w-full truncate text-xs font-medium" style={{ color: TEXT }}>{a.originalName}</span>
            <span className="text-[10px]" style={{ color: MUTED }}>{(a.size / 1024).toFixed(1)} KB</span>
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); onRemove(a.id); }}
              className="absolute right-1 top-1 hidden rounded p-1 group-hover:block"
              style={{ color: MUTED }}
            >
              <IconTrash size={14} />
            </button>
          </a>
        ))}
      </div>
      {attachments.length === 0 && <p className="mb-4 text-sm" style={{ color: MUTED }}>No attachments yet.</p>}

      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
        onClick={() => inputRef.current?.click()}
        className="mt-4 cursor-pointer rounded-md border-2 border-dashed p-6 text-center"
        style={{ borderColor: dragOver ? BLUE : BORDER, backgroundColor: dragOver ? '#0d1525' : BG }}
      >
        <IconUpload size={22} style={{ color: MUTED, margin: '0 auto' }} />
        <p className="mt-2 text-sm" style={{ color: TEXT }}>Drag &amp; drop files here or browse</p>
        <input ref={inputRef} type="file" multiple className="hidden" onChange={(e) => { handleFiles(e.target.files); e.target.value = ''; }} />
      </div>
    </div>
  );
}

// ---- Relationships tab ----

function RelationLinker({ title, accent, accentLight, Icon, relationType, buttonLabel, helperText, multiple, selected, ticketId, isStaff, onLinked, onUnlink }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);

  useEffect(() => {
    if (!query.trim()) { setResults([]); return undefined; }
    const t = setTimeout(() => {
      api.get('/tickets', { params: { search: query.trim() } })
        .then(({ data }) => setResults(data.tickets.filter((x) => x.id !== Number(ticketId)).slice(0, 8)))
        .catch(() => setResults([]));
    }, 300);
    return () => clearTimeout(t);
  }, [query, ticketId]);

  const link = async (t) => {
    try {
      await api.post(`/tickets/${ticketId}/relations`, { relatedTicketId: t.id, relationType });
      onLinked();
      setQuery('');
      setResults([]);
    } catch (err) {
      alert(errMessage(err));
    }
  };

  const hideInput = !multiple && selected.length > 0;

  return (
    <div>
      <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: accent }}>
        <Icon size={16} />
        {title}
      </div>
      {isStaff && !hideInput && (
        <div className="relative mt-2 flex gap-2">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by ticket number or title…" className="input flex-1" style={fieldStyle} />
          <button type="button" onClick={() => results.length && link(results[0])} disabled={!results.length} className="whitespace-nowrap rounded-md border px-3 py-2 text-sm font-medium disabled:opacity-40" style={{ borderColor: accent, color: accentLight }}>
            {buttonLabel}
          </button>
          {results.length > 0 && (
            <div className="absolute left-0 top-full z-10 mt-1 w-full rounded-md border p-1 shadow-lg" style={{ backgroundColor: CARD_BG, borderColor: BORDER }}>
              {results.map((t) => (
                <button key={t.id} type="button" onClick={() => link(t)} className="block w-full rounded px-3 py-1.5 text-left text-sm hover:bg-white/5" style={{ color: TEXT }}>
                  {formatTicketId(t)} {t.title}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {helperText && <p className="mt-1.5 text-xs" style={{ color: MUTED }}>{helperText}</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        {selected.map((r) => (
          <span key={r.id} className="flex items-center gap-1.5 rounded-full py-1 pl-2.5 pr-2 text-xs font-medium" style={{ backgroundColor: `${accent}22`, color: accentLight }}>
            <Icon size={12} />
            <Link to={`/tickets/${r.ticket.id}`} className="hover:underline">{formatTicketId(r.ticket)} {r.ticket.title}</Link>
            {isStaff && (
              <button type="button" onClick={() => onUnlink(r.id)} style={{ color: accentLight }}><IconX size={12} /></button>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}

function RelationshipsTab({ ticketId, relations, isStaff, reload }) {
  const parent = relations.filter((r) => r.relationType === 'parent' && r.direction === 'outgoing');
  const children = relations.filter((r) => r.relationType === 'parent' && r.direction === 'incoming');
  const related = relations.filter((r) => r.relationType !== 'parent');

  const closedChildren = children.filter((r) => CLOSED_STATUSES.includes(r.ticket.status)).length;
  const childPercent = children.length ? Math.round((closedChildren / children.length) * 100) : 0;

  const unlink = async (relationId) => {
    try {
      await api.delete(`/tickets/${ticketId}/relations/${relationId}`);
      reload();
    } catch (err) {
      alert(errMessage(err));
    }
  };

  return (
    <div className="space-y-6">
      <RelationLinker
        title="Parent ticket" accent={PURPLE} accentLight={PURPLE_LIGHT} Icon={IconArrowUp}
        relationType="parent" buttonLabel="Link parent" multiple={false}
        selected={parent} ticketId={ticketId} isStaff={isStaff} onLinked={reload} onUnlink={unlink}
        helperText={parent[0] ? `This ticket rolls up to ${formatTicketId(parent[0].ticket)}.` : null}
      />
      <div className="border-t pt-5" style={{ borderColor: BORDER }}>
        <RelationLinker
          title="Child tickets" accent={BLUE} accentLight="#93c5fd" Icon={IconArrowDown}
          relationType="child" buttonLabel="Link child" multiple
          selected={children} ticketId={ticketId} isStaff={isStaff} onLinked={reload} onUnlink={unlink}
        />
        {children.length > 0 && (
          <div className="mt-3">
            <div className="h-[5px] w-full rounded-[3px]" style={{ backgroundColor: BORDER }}>
              <div className="h-full rounded-[3px]" style={{ width: `${childPercent}%`, backgroundColor: BLUE }} />
            </div>
            <p className="mt-1 text-xs" style={{ color: MUTED }}>{closedChildren} of {children.length} children closed ({childPercent}%)</p>
          </div>
        )}
      </div>
      <div className="border-t pt-5" style={{ borderColor: BORDER }}>
        <RelationLinker
          title="Related tickets" accent={MUTED} accentLight="#cbd5e1" Icon={() => null}
          relationType="related" buttonLabel="Link" multiple
          selected={related} ticketId={ticketId} isStaff={isStaff} onLinked={reload} onUnlink={unlink}
        />
      </div>
    </div>
  );
}

// ---- Activity tab ----

const ACTIVITY_DOT = {
  created: '#3b82f6',
  status: '#fbbf24',
  priority: '#f87171',
  type: '#94a3b8',
  assigneeId: '#3b82f6',
  teamId: '#3b82f6',
  departmentId: '#94a3b8',
  dueDate: '#94a3b8',
  comment: '#c084fc',
  time_logged: '#4ade80',
  attachment_added: '#94a3b8',
  relation_added: '#a78bfa',
};
const ACTIVITY_FIELD_LABEL = {
  status: 'status', priority: 'priority', type: 'type', assigneeId: 'assignee',
  teamId: 'team', departmentId: 'department', dueDate: 'due date',
};

function activityDescription(a) {
  const actor = a.user?.displayName || 'Someone';
  if (a.action === 'created') return `${actor} opened this ticket`;
  if (a.action === 'comment') return `${actor} commented on this ticket`;
  if (a.action === 'time_logged') return `${actor} logged ${a.toValue} of time`;
  if (a.action === 'attachment_added') return `${actor} added attachment "${a.toValue}"`;
  if (a.action === 'relation_added') return `${actor} linked ${a.toValue}`;
  if (ACTIVITY_FIELD_LABEL[a.action]) {
    return `${actor} changed ${ACTIVITY_FIELD_LABEL[a.action]} from ${a.fromValue || 'none'} to ${a.toValue || 'none'}`;
  }
  return `${actor} updated this ticket`;
}

function ActivityTab({ activity }) {
  return (
    <ul className="space-y-3">
      {activity.length === 0 && <p className="text-sm" style={{ color: MUTED }}>No activity yet.</p>}
      {activity.map((a) => (
        <li key={a.id} className="flex items-start gap-3">
          <span className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: ACTIVITY_DOT[a.action] || MUTED }} />
          <div>
            <p className="text-sm" style={{ color: TEXT }}>{activityDescription(a)}</p>
            <p className="text-xs" style={{ color: MUTED }}>{timeAgo(a.createdAt)}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

// ---- Main page ----

export default function TicketDetail() {
  const { id } = useParams();
  const { user, isStaff } = useAuth();
  const fileRef = useRef(null);
  const timer = useTimer();

  const [ticket, setTicket] = useState(null);
  const [comments, setComments] = useState([]);
  const [attachments, setAttachments] = useState([]);
  const [time, setTime] = useState({ entries: [], totalMinutes: 0 });
  const [relations, setRelations] = useState([]);
  const [watchers, setWatchers] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [activity, setActivity] = useState([]);
  const [directory, setDirectory] = useState([]);
  const [assignableUsers, setAssignableUsers] = useState([]);
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [activeTab, setActiveTab] = useState('conversation');
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(SIDEBAR_STORAGE_KEY) === 'collapsed'; } catch { return false; }
  });
  const [noTimeWarning, setNoTimeWarning] = useState(null);

  useEffect(() => {
    try { localStorage.setItem(SIDEBAR_STORAGE_KEY, collapsed ? 'collapsed' : 'expanded'); } catch { /* ignore */ }
  }, [collapsed]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [t, c, a, tm, rel, w, tk, act] = await Promise.all([
        api.get(`/tickets/${id}`),
        api.get(`/tickets/${id}/comments`),
        api.get(`/tickets/${id}/attachments`),
        api.get(`/tickets/${id}/time`),
        api.get(`/tickets/${id}/relations`),
        api.get(`/tickets/${id}/watchers`),
        api.get(`/tickets/${id}/tasks`),
        api.get(`/tickets/${id}/activity`),
      ]);
      setTicket(t.data.ticket);
      setComments(c.data.comments);
      setAttachments(a.data.attachments);
      setTime(tm.data);
      setRelations(rel.data.relations);
      setWatchers(w.data.watchers);
      setTasks(tk.data.tasks);
      setActivity(act.data.activity);
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    api.get('/users/directory').then(({ data }) => setDirectory(data.users)).catch(() => {});
    if (isStaff) {
      api.get('/users/assignable').then(({ data }) => setAssignableUsers(data.users)).catch(() => {});
      api.get('/teams').then(({ data }) => setTeams(data.teams)).catch(() => {});
    }
  }, [isStaff]);

  // Keep a ref to the latest timer snapshot so the mount/unmount effect below
  // (which only re-runs when the ticket changes) always acts on live data
  // instead of the stale closure from when it first ran.
  const timerRef = useRef(timer);
  useEffect(() => { timerRef.current = timer; }, [timer]);

  // Automatic timer mode: start on open, stop (and log/discard/prompt per the
  // user's preferences) on navigating away; best-effort log via sendBeacon on
  // tab close (manual-mode timers deliberately persist across tab closes —
  // that's the point of the server-backed cross-device timer).
  useEffect(() => {
    if (!isStaff || !ticket || !user || user.timerMode !== 'automatic') return undefined;

    if (!timerRef.current.isRunning('ticket', ticket.id)) {
      timerRef.current.start('ticket', ticket.id, `${formatTicketId(ticket)} ${ticket.title}`);
    }

    const handleBeforeUnload = () => {
      if (timerRef.current.isRunning('ticket', ticket.id)) {
        navigator.sendBeacon('/api/v1/timer/stop', new Blob([JSON.stringify({})], { type: 'application/json' }));
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      const t = timerRef.current;
      if (!t.isRunning('ticket', ticket.id)) return;
      const seconds = t.elapsedSeconds;
      if (seconds < (user.timerMinThreshold || 0)) {
        t.cancel();
      } else if (user.timerPromptBeforeLog) {
        if (window.confirm(`Log ${formatHMS(seconds)} of time to this ticket before leaving?`)) {
          t.stop();
        } else {
          t.cancel();
        }
      } else {
        t.stop();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticket?.id, isStaff, user?.id, user?.timerMode]);

  const reloadActivityAndRelations = () => {
    api.get(`/tickets/${id}/relations`).then(({ data }) => setRelations(data.relations)).catch(() => {});
    api.get(`/tickets/${id}/activity`).then(({ data }) => setActivity(data.activity)).catch(() => {});
  };

  const patchTicket = async (changes) => {
    try {
      const { data } = await api.patch(`/tickets/${id}`, changes);
      setTicket(data.ticket);
      api.get(`/tickets/${id}/activity`).then(({ data: d }) => setActivity(d.activity)).catch(() => {});
    } catch (err) {
      alert(errMessage(err));
    }
  };

  const handleResolveOrClose = (status) => {
    if (time.totalMinutes === 0) {
      setNoTimeWarning(status);
    } else {
      patchTicket({ status });
    }
  };

  const reloadTime = () => {
    api.get(`/tickets/${id}/time`).then(({ data }) => setTime(data)).catch(() => {});
    api.get(`/tickets/${id}/activity`).then(({ data }) => setActivity(data.activity)).catch(() => {});
  };

  const sendReply = async (body) => {
    const { data } = await api.post(`/tickets/${id}/comments`, { body });
    setComments((prev) => [...prev, data.comment]);
    api.get(`/tickets/${id}/activity`).then(({ data: d }) => setActivity(d.activity)).catch(() => {});
  };

  const uploadFile = async (file) => {
    const fd = new FormData();
    fd.append('file', file);
    try {
      const { data } = await api.post(`/tickets/${id}/attachments`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setAttachments((prev) => [data.attachment, ...prev]);
      api.get(`/tickets/${id}/activity`).then(({ data: d }) => setActivity(d.activity)).catch(() => {});
    } catch (err) {
      alert(errMessage(err));
    }
  };
  const handleReplyAttach = (e) => {
    const file = e.target.files?.[0];
    if (file) uploadFile(file);
    if (fileRef.current) fileRef.current.value = '';
  };
  const removeAttachment = async (attId) => {
    if (!confirm('Delete this attachment?')) return;
    try {
      await api.delete(`/tickets/${id}/attachments/${attId}`);
      setAttachments((prev) => prev.filter((a) => a.id !== attId));
    } catch (err) {
      alert(errMessage(err));
    }
  };

  const addTag = async (tag) => {
    const nextTags = [...(ticket.tags || []), tag];
    await patchTicket({ tags: nextTags });
  };
  const removeTag = async (tag) => {
    const nextTags = (ticket.tags || []).filter((t) => t !== tag);
    await patchTicket({ tags: nextTags });
  };

  const addWatcher = async (userId) => {
    try {
      const { data } = await api.post(`/tickets/${id}/watchers`, { userId });
      setWatchers((prev) => [...prev, data.watcher]);
    } catch (err) {
      alert(errMessage(err));
    }
  };
  const removeWatcher = async (userId) => {
    try {
      await api.delete(`/tickets/${id}/watchers/${userId}`);
      setWatchers((prev) => prev.filter((w) => w.userId !== userId));
    } catch (err) {
      alert(errMessage(err));
    }
  };

  const addTask = async (description) => {
    try {
      const { data } = await api.post(`/tickets/${id}/tasks`, { description });
      setTasks((prev) => [...prev, data.task]);
    } catch (err) {
      alert(errMessage(err));
    }
  };
  const toggleTask = async (task) => {
    try {
      const { data } = await api.patch(`/tickets/${id}/tasks/${task.id}`, { completed: !task.completed });
      setTasks((prev) => prev.map((t) => (t.id === task.id ? data.task : t)));
    } catch (err) {
      alert(errMessage(err));
    }
  };
  const reassignTask = async (task, assigneeId) => {
    try {
      const { data } = await api.patch(`/tickets/${id}/tasks/${task.id}`, { assigneeId });
      setTasks((prev) => prev.map((t) => (t.id === task.id ? data.task : t)));
    } catch (err) {
      alert(errMessage(err));
    }
  };

  const addManualTime = async (minutes, description) => {
    const { data } = await api.post(`/tickets/${id}/time`, { minutes, note: description || undefined });
    setTime((t) => ({ entries: [data.entry, ...t.entries], totalMinutes: t.totalMinutes + data.entry.minutes }));
    api.get(`/tickets/${id}/activity`).then(({ data: d }) => setActivity(d.activity)).catch(() => {});
  };

  if (loading) return <Spinner />;
  if (error) return <div className="rounded-md bg-red-50 p-4 text-red-700">{error}</div>;
  if (!ticket) return null;

  return (
    <div style={{ backgroundColor: BG, margin: '-2rem -1.5rem', padding: 0 }} className="min-h-full">
      {/* Header */}
      <div className="sticky top-0 z-20 px-6 py-4" style={{ backgroundColor: CARD_BG, borderBottom: `1px solid ${BORDER}` }}>
        <Link to="/tickets" className="text-sm hover:underline" style={{ color: MUTED }}>← Back to tickets</Link>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-mono text-lg" style={{ color: MUTED }}>{formatTicketId(ticket)}</span>
            <h1 className="text-xl font-bold" style={{ color: TEXT }}>{ticket.title}</h1>
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_META[ticket.status].cls}`}>{STATUS_META[ticket.status].label}</span>
            <span className="flex items-center gap-1.5 text-xs font-medium" style={{ color: PRIORITY_META[ticket.priority].color }}>
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: PRIORITY_META[ticket.priority].color }} />
              {PRIORITY_META[ticket.priority].label}
            </span>
          </div>
          <div className="flex flex-shrink-0 items-center gap-3">
            {isStaff && <TimerWidget ticket={ticket} onLogged={reloadTime} />}
            {isStaff && (
              <button type="button" onClick={() => handleResolveOrClose('resolved')} className="rounded-md px-3 py-1.5 text-sm font-semibold text-white" style={{ backgroundColor: '#16a34a' }}>
                Resolve
              </button>
            )}
            {isStaff && (
              <button type="button" onClick={() => handleResolveOrClose('closed')} className="rounded-md px-3 py-1.5 text-sm font-semibold" style={{ backgroundColor: BORDER, color: TEXT }}>
                Close
              </button>
            )}
          </div>
        </div>
        <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm" style={{ color: MUTED }}>
          <span>Customer: <span style={{ color: TEXT }}>{ticket.requester?.displayName || '—'}</span></span>
          <span>Assignee: <span style={{ color: TEXT }}>{ticket.assignee?.displayName || 'Unassigned'}</span></span>
          <span>Due: <span style={{ color: dueDateColor(ticket.dueDate) }}>{ticket.dueDate || '—'}</span></span>
          <span>Created: <span style={{ color: TEXT }}>{formatDate(ticket.createdAt)}</span></span>
        </div>
      </div>

      {/* Body: sidebar + main */}
      <div className="flex">
        <Sidebar
          ticket={ticket}
          collapsed={collapsed}
          onToggle={() => setCollapsed((c) => !c)}
          isStaff={isStaff}
          patchTicket={patchTicket}
          assignableUsers={assignableUsers}
          teams={teams}
          directory={directory}
          tags={ticket.tags || []}
          onAddTag={addTag}
          onRemoveTag={removeTag}
          watchers={watchers}
          onAddWatcher={addWatcher}
          onRemoveWatcher={removeWatcher}
        />

        <div className="min-w-0 flex-1">
          <div className="flex" style={{ borderBottom: `1px solid ${BORDER}` }}>
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setActiveTab(t.key)}
                className="-mb-px border-b-2 px-4 py-3 text-sm font-medium"
                style={{ borderColor: activeTab === t.key ? BLUE : 'transparent', color: activeTab === t.key ? TEXT : MUTED }}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="p-6">
            {activeTab === 'conversation' && <ConversationTab ticket={ticket} comments={comments} />}
            {activeTab === 'time' && <TimeEntriesTab entries={time.entries} totalMinutes={time.totalMinutes} onAdd={addManualTime} />}
            {activeTab === 'tasks' && (
              <TasksTab tasks={tasks} assignableUsers={assignableUsers} onToggle={toggleTask} onReassign={reassignTask} onAdd={addTask} />
            )}
            {activeTab === 'attachments' && (
              <AttachmentsTab ticketId={id} attachments={attachments} onUpload={uploadFile} onRemove={removeAttachment} />
            )}
            {activeTab === 'relationships' && (
              <RelationshipsTab ticketId={id} relations={relations} isStaff={isStaff} reload={reloadActivityAndRelations} />
            )}
            {activeTab === 'activity' && <ActivityTab activity={activity} />}
          </div>

          {activeTab === 'conversation' && (
            <ReplyBox ticket={ticket} onSend={sendReply} fileRef={fileRef} onAttach={handleReplyAttach} />
          )}
        </div>
      </div>

      {noTimeWarning && (
        <Modal title="No time has been logged on this ticket." onClose={() => setNoTimeWarning(null)}>
          <p className="mb-4 text-sm" style={{ color: MUTED }}>
            You&apos;re about to mark this ticket as {noTimeWarning} without logging any time. This is just a heads-up — you can still proceed.
          </p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setNoTimeWarning(null)}
              className="rounded-md border px-4 py-2 text-sm font-medium"
              style={{ borderColor: BORDER, color: TEXT }}
            >
              Go back and log time
            </button>
            <button
              type="button"
              onClick={() => { patchTicket({ status: noTimeWarning }); setNoTimeWarning(null); }}
              className="rounded-md px-4 py-2 text-sm font-semibold text-white"
              style={{ backgroundColor: '#dc2626' }}
            >
              Close anyway
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
