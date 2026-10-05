// Ticket detail page: header, tabs and sidebar. The panels live in ./detail/.
import { useCallback, useEffect, useRef, useState } from 'react';
import CompanyTag from '../../components/companies/CompanyTag';
import { useParams, Link } from 'react-router-dom';
import { IconLink, IconFileText } from '@tabler/icons-react';
import api, { errMessage } from '../../api/api';
import { useAuth, usePermission } from '../../context/AuthContext';
import { assignableContactDepartments } from '../../utils/contactDepartments';
import { formatHMS } from '../../context/TimerContext';
import Spinner from '../../components/Spinner';
import { formatTicketId } from '../../utils/ticketId';
import {
  CARD_BG,
  BORDER,
  TEXT,
  MUTED,
  BLUE,
  PURPLE,
  PRIORITY_META,
  formatDate,
  formatDueDateTime,
} from './theme';
import { useTicketTimer, TimerWidget, OtherTicketTimerBanner } from './detail/TimerWidget';
import { SourceBadge, CsatBadge } from './detail/Badges';
import { LinkTicketModal, RelationshipsTab } from './detail/RelationshipsTab';
import { GenerateReportModal } from './detail/GenerateReportModal';
import { Sidebar } from './detail/Sidebar';
import { ConversationTab } from './detail/ConversationTab';
import { ResolutionTab } from './detail/ResolutionTab';
import { TimeEntriesTab } from './detail/TimeEntriesTab';
import { TasksTab } from './detail/TasksTab';
import { AttachmentsTab } from './detail/AttachmentsTab';
import { ActivityTab } from './detail/ActivityTab';
import { ReplyBox } from './detail/ReplyBox';
import { Modal } from './detail/Modal';

// How many rows the growing detail lists (comments, activity) load at a time.
// Matches the API's own default page size for these endpoints.
const SUBLIST_STEP = 25;

const SIDEBAR_STORAGE_KEY = 'prism.ticketDetail.sidebar';

// Status name -> {color, behaviorType} lookup built from the fetched
// ticket-statuses list (Settings -> Statuses), replacing what used to be a
// fixed label/class map — colors are now arbitrary admin-chosen hex values.
function findStatus(ticketStatuses, name) {
  return ticketStatuses.find((s) => s.name === name) || null;
}

const TABS = [
  { key: 'conversation', label: 'Conversation' },
  { key: 'resolution', label: 'Resolution' },
  { key: 'time', label: 'Time Entries' },
  { key: 'tasks', label: 'Tasks' },
  { key: 'attachments', label: 'Attachments' },
  { key: 'relationships', label: 'Relationships' },
  { key: 'activity', label: 'Activity' },
];

function dueDateColor(dueDate) {
  if (!dueDate) return MUTED;
  const today = new Date().toISOString().slice(0, 10);
  const soon = new Date();
  soon.setDate(soon.getDate() + 3);
  const soonStr = soon.toISOString().slice(0, 10);
  if (dueDate < today) return 'var(--color-danger)';
  if (dueDate <= soonStr) return 'var(--color-warning)';
  return MUTED;
}

// ---- Main page ----

export default function TicketDetail() {
  const { id } = useParams();
  const { user, isStaff, canLogTimeForOthers, hasPermission } = useAuth();
  const canAssign = usePermission('tickets.assign');
  const canViewPrivateComments = usePermission('tickets.view_private_comments');
  const fileRef = useRef(null);

  const [ticket, setTicket] = useState(null);
  const ticketTimer = useTicketTimer(ticket);
  const [comments, setComments] = useState([]);
  // "Load more" grows the page size rather than accumulating pages: almost
  // every action on this page triggers a refetch, and a grown limit survives
  // those where an accumulated page count would not.
  const [commentLimit, setCommentLimit] = useState(SUBLIST_STEP);
  const [commentTotal, setCommentTotal] = useState(0);
  const [attachments, setAttachments] = useState([]);
  const [time, setTime] = useState({ entries: [], totalMinutes: 0 });
  const [relations, setRelations] = useState([]);
  const [watchers, setWatchers] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [activity, setActivity] = useState([]);
  const [activityLimit, setActivityLimit] = useState(SUBLIST_STEP);
  const [activityTotal, setActivityTotal] = useState(0);
  const [directory, setDirectory] = useState([]);
  const [assignableUsers, setAssignableUsers] = useState([]);
  const [teams, setTeams] = useState([]);
  const [ticketStatuses, setTicketStatuses] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [contactDeptAssign, setContactDeptAssign] = useState({ deptId: '', saving: false });
  const [customFieldDefs, setCustomFieldDefs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [activeTab, setActiveTab] = useState('conversation');
  const [headerLinkModalOpen, setHeaderLinkModalOpen] = useState(false);
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(SIDEBAR_STORAGE_KEY) === 'collapsed'; } catch { return false; }
  });
  const [noTimeWarning, setNoTimeWarning] = useState(null);
  const [noResolutionWarning, setNoResolutionWarning] = useState(null);
  const [mobileDetailsOpen, setMobileDetailsOpen] = useState(false);

  useEffect(() => {
    try { localStorage.setItem(SIDEBAR_STORAGE_KEY, collapsed ? 'collapsed' : 'expanded'); } catch { /* ignore */ }
  }, [collapsed]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [t, c, a, tm, rel, w, tk, act] = await Promise.all([
        api.get(`/tickets/${id}`),
        api.get(`/tickets/${id}/comments`, { params: { limit: commentLimit } }),
        api.get(`/tickets/${id}/attachments`, { params: { limit: 'all' } }),
        api.get(`/tickets/${id}/time`, { params: { limit: 'all' } }),
        api.get(`/tickets/${id}/relations`),
        api.get(`/tickets/${id}/watchers`),
        api.get(`/tickets/${id}/tasks`),
        api.get(`/tickets/${id}/activity`, { params: { limit: activityLimit } }),
      ]);
      setTicket(t.data.ticket);
      setComments(c.data.comments);
      setCommentTotal(c.data.total);
      setAttachments(a.data.attachments);
      setTime(tm.data);
      setRelations(rel.data.relations);
      setWatchers(w.data.watchers);
      setTasks(tk.data.tasks);
      setActivity(act.data.activity);
      setActivityTotal(act.data.total);
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setLoading(false);
    }
  }, [id, commentLimit, activityLimit]);

  useEffect(() => { load(); }, [load]);

  // Actions all over this page refresh the activity feed. Routing them through
  // one helper keeps the "load more" expansion intact.
  const reloadActivity = useCallback(() => (
    api.get(`/tickets/${id}/activity`, { params: { limit: activityLimit } })
      .then(({ data }) => { setActivity(data.activity); setActivityTotal(data.total); })
      .catch(() => {})
  ), [id, activityLimit]);

  useEffect(() => {
    api.get('/ticket-statuses').then(({ data }) => setTicketStatuses(data.statuses)).catch(() => {});
    api.get('/departments').then(({ data }) => setDepartments(data.departments)).catch(() => {});
    if (isStaff) {
      api.get('/teams').then(({ data }) => setTeams(data.teams)).catch(() => {});
    }
  }, [isStaff]);

  // Assignees and watchers must reach the ticket's company (plan 2b).
  useEffect(() => {
    if (!ticket?.companyId) return;
    const params = { companyId: ticket.companyId };
    api.get('/users/directory', { params }).then(({ data }) => setDirectory(data.users)).catch(() => {});
    if (isStaff) api.get('/users/assignable', { params }).then(({ data }) => setAssignableUsers(data.users)).catch(() => {});
  }, [isStaff, ticket?.companyId]);

  const assignContactDepartment = async () => {
    if (!contactDeptAssign.deptId || !ticket?.contact) return;
    setContactDeptAssign((p) => ({ ...p, saving: true }));
    try {
      await api.patch(`/contacts/${ticket.contact.id}/department`, { departmentId: contactDeptAssign.deptId });
      await load();
      setContactDeptAssign({ deptId: '', saving: false });
    } catch (err) {
      setContactDeptAssign((p) => ({ ...p, saving: false }));
      alert(errMessage(err));
    }
  };

  // Keep a ref to the latest ticket-timer snapshot so the mount/unmount
  // effect below (which only re-runs when the ticket changes) always acts on
  // live data instead of the stale closure from when it first ran.
  const ticketTimerRef = useRef(ticketTimer);
  useEffect(() => { ticketTimerRef.current = ticketTimer; }, [ticketTimer]);

  // Automatic timer mode: start on open (unless another ticket's timer is
  // already running/paused — the warning banner handles that conflict
  // instead), stop (and log/discard/prompt per the user's preferences) on
  // navigating away; best-effort log via sendBeacon on tab close. Manual-mode
  // and paused timers deliberately persist in localStorage across tab
  // close/reopen — that's the point of the client-side persistence.
  useEffect(() => {
    if (!isStaff || !ticket || !user || user.timerMode !== 'automatic') return undefined;

    if (ticketTimerRef.current.timerState === 'idle' && !ticketTimerRef.current.otherTicket) {
      ticketTimerRef.current.start();
    }

    const handleBeforeUnload = () => {
      const t = ticketTimerRef.current;
      if (t.timerState === 'idle') return;
      const seconds = t.elapsedSeconds;
      if (seconds < (user.timerMinThreshold || 0)) return;
      const minutes = Math.max(1, Math.round(seconds / 60));
      navigator.sendBeacon(
        `/api/v1/tickets/${ticket.id}/time`,
        new Blob([JSON.stringify({ minutes })], { type: 'application/json' })
      );
    };
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      const t = ticketTimerRef.current;
      if (t.timerState === 'idle') return;
      const seconds = t.elapsedSeconds;
      const minutes = Math.max(1, Math.round(seconds / 60));
      // A rich modal isn't renderable from an unmounting component, so this
      // uses window.confirm as the closest equivalent — but a below-minimum
      // entry always gets asked about (never silently dropped), regardless
      // of timerPromptBeforeLog, matching the interactive Log Time modal's
      // "always show the warning" rule for below-threshold entries.
      if (seconds < (user.timerMinThreshold || 0)) {
        if (window.confirm(
          `This entry is ${formatHMS(seconds)} — below your minimum threshold of ${formatHMS(user.timerMinThreshold)}. Log it anyway?`
        )) {
          api.post(`/tickets/${ticket.id}/time`, { minutes }).catch(() => {});
        }
      } else if (user.timerPromptBeforeLog) {
        if (window.confirm(`Log ${formatHMS(seconds)} of time to this ticket before leaving?`)) {
          api.post(`/tickets/${ticket.id}/time`, { minutes }).catch(() => {});
        }
      } else {
        api.post(`/tickets/${ticket.id}/time`, { minutes }).catch(() => {});
      }
      t.stopToIdle();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticket?.id, isStaff, user?.id, user?.timerMode]);

  const reloadActivityAndRelations = () => {
    api.get(`/tickets/${id}/relations`).then(({ data }) => setRelations(data.relations)).catch(() => {});
    reloadActivity();
  };

  const patchTicket = async (changes) => {
    try {
      const { data } = await api.patch(`/tickets/${id}`, changes);
      setTicket(data.ticket);
      reloadActivity();
    } catch (err) {
      alert(errMessage(err));
    }
  };

  // Active custom fields for this ticket's type (Settings -> Layouts & Fields).
  useEffect(() => {
    if (!ticket?.type) return;
    api.get('/custom-fields', { params: { ticketType: ticket.type } })
      .then(({ data }) => setCustomFieldDefs(data.customFields))
      .catch(() => setCustomFieldDefs([]));
  }, [ticket?.type]);

  const saveCustomFieldValue = async (fieldKey, value) => {
    try {
      const { data } = await api.patch(`/tickets/${id}/custom-field-values`, { values: { [fieldKey]: value } });
      setTicket((prev) => (prev ? { ...prev, customFields: data.customFields } : prev));
      reloadActivity();
    } catch (err) {
      alert(errMessage(err));
    }
  };

  const saveResolution = async (text) => {
    await patchTicket({ resolution: text });
  };

  // Which status NAMES currently behave as "closed", per the admin-editable
  // Settings -> Statuses table (behaviorType), rather than a fixed list.
  const closedStatusNames = ticketStatuses.filter((s) => s.behaviorType === 'closed').map((s) => s.name);

  // Status changes now come from the sidebar's Status dropdown (the header's
  // dedicated Resolve/Close buttons were removed). Two independent warnings
  // can fire when moving into a closed state — missing resolution is checked
  // first (arguably the more important gap, since it's customer-visible
  // knowledge-base material), then the pre-existing no-time-logged check;
  // "Close without resolution" falls through into that second check rather
  // than skipping it.
  const applyStatusChange = (status) => {
    if (closedStatusNames.includes(status) && time.totalMinutes === 0) {
      setNoTimeWarning(status);
    } else {
      patchTicket({ status });
    }
  };

  const handleStatusChange = (status) => {
    if (closedStatusNames.includes(status) && !ticket.resolution?.trim()) {
      setNoResolutionWarning(status);
    } else {
      applyStatusChange(status);
    }
  };

  const reloadTime = () => {
    api.get(`/tickets/${id}/time`, { params: { limit: 'all' } }).then(({ data }) => setTime(data)).catch(() => {});
    reloadActivity();
  };

  const sendReply = async (body, type) => {
    const { data } = await api.post(`/tickets/${id}/comments`, { body, type });
    setComments((prev) => [...prev, data.comment]);
    reloadActivity();
  };

  const uploadFile = async (file) => {
    const fd = new FormData();
    fd.append('file', file);
    try {
      const { data } = await api.post(`/tickets/${id}/attachments`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setAttachments((prev) => [data.attachment, ...prev]);
      reloadActivity();
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

  // Asset linking is asset-centric on the backend (POST/DELETE
  // /assets/:assetId/tickets, not a ticket-side endpoint) — see
  // assetsController.js. A lightweight re-fetch (not the full load()) keeps
  // the rest of the page from flashing a loading spinner for this.
  const linkAsset = async (assetId) => {
    try {
      await api.post(`/assets/${assetId}/tickets`, { ticketId: id });
      const { data } = await api.get(`/tickets/${id}`);
      setTicket(data.ticket);
    } catch (err) {
      alert(errMessage(err));
    }
  };
  const unlinkAsset = async (assetId) => {
    try {
      await api.delete(`/assets/${assetId}/tickets/${id}`);
      const { data } = await api.get(`/tickets/${id}`);
      setTicket(data.ticket);
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

  const addManualTime = async ({ startTime, endTime, description, entryDate, loggedForId }) => {
    const { data } = await api.post(`/tickets/${id}/time`, {
      startTime,
      endTime,
      note: description || undefined,
      entryDate,
      userId: loggedForId,
    });
    setTime((t) => ({ entries: [data.entry, ...t.entries], totalMinutes: t.totalMinutes + data.entry.minutes }));
    reloadActivity();
  };

  if (loading) return <Spinner />;
  if (error) return <div className="rounded-md bg-red-50 p-4 text-red-700">{error}</div>;
  if (!ticket) return null;

  const parentRelation = relations.find((r) => r.relationType === 'parent' && r.direction === 'outgoing') || null;

  return (
    <div
      style={{ padding: 0, height: '100vh' }}
      className="-mx-3 -my-4 flex flex-col overflow-hidden bg-navy-50 sm:-mx-6 sm:-my-8"
    >
      {/* Header — auto height, does not grow */}
      <div
        className="flex-shrink-0 px-6 py-4"
        style={{ backgroundColor: CARD_BG, borderBottom: `1px solid ${BORDER}` }}
      >
        <div className="flex items-center justify-between gap-4">
          <Link to="/tickets" className="text-sm hover:underline" style={{ color: MUTED }}>← Back to tickets</Link>
          {parentRelation && (
            <Link
              to={`/tickets/${parentRelation.ticket.id}`}
              className="text-sm font-medium hover:underline"
              style={{ color: PURPLE }}
            >
              ↑ Parent: {formatTicketId(parentRelation.ticket)} {parentRelation.ticket.title}
            </Link>
          )}
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-mono text-lg" style={{ color: MUTED }}>{formatTicketId(ticket)}</span>
            <SourceBadge source={ticket.source} />
            <h1 className="text-xl font-bold" style={{ color: TEXT }}>{ticket.title}</h1>
            {(() => {
              const statusMeta = findStatus(ticketStatuses, ticket.status);
              const statusColor = statusMeta?.color || MUTED;
              return (
                <span
                  className="rounded-[3px] px-2.5 py-0.5 text-xs font-medium"
                  style={{ backgroundColor: `color-mix(in srgb, ${statusColor} 13%, transparent)`, color: statusColor }}
                >
                  {ticket.status}
                </span>
              );
            })()}
            <span className="flex items-center gap-1.5 text-xs font-medium" style={{ color: PRIORITY_META[ticket.priority].color }}>
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: PRIORITY_META[ticket.priority].color }} />
              {PRIORITY_META[ticket.priority].label}
            </span>
            <CsatBadge survey={ticket.csatSurvey} />
            {isStaff && (
              <button
                type="button"
                onClick={() => setHeaderLinkModalOpen(true)}
                className="flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium"
                style={{ borderColor: BORDER, color: MUTED }}
              >
                <IconLink size={13} />
                Link ticket
              </button>
            )}
            {isStaff && (
              <button
                type="button"
                onClick={() => setReportModalOpen(true)}
                className="flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium"
                style={{ borderColor: BORDER, color: MUTED }}
              >
                <IconFileText size={13} />
                Generate report
              </button>
            )}
          </div>
          <div className="flex flex-shrink-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileDetailsOpen(true)}
              className="rounded-md border px-3 py-2 text-sm font-medium md:hidden"
              style={{ borderColor: BORDER, color: TEXT }}
            >
              Details
            </button>
            {isStaff && (
              <TimerWidget
                ticket={ticket}
                ticketTimer={ticketTimer}
                onLogged={reloadTime}
                assignableUsers={assignableUsers}
                canLogTimeForOthers={canLogTimeForOthers}
                currentUser={user}
              />
            )}
          </div>
        </div>
        <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm" style={{ color: MUTED }}>
          <span>
            Customer:{' '}
            {ticket.contact ? (
              <><Link to={`/contacts/${ticket.contact.id}`} className="hover:underline" style={{ color: BLUE }}>{ticket.contact.displayName}</Link><CompanyTag company={ticket.company} /></>
            ) : (
              <span style={{ color: TEXT }}>—</span>
            )}
          </span>
          <span>Assignee: <span style={{ color: TEXT }}>{ticket.assignee?.displayName || 'Unassigned'}</span></span>
          <span>Due: <span style={{ color: dueDateColor(ticket.dueDate) }}>{ticket.dueDate ? formatDueDateTime(ticket.dueDate, ticket.dueTime) : '—'}</span></span>
          <span>Created: <span style={{ color: TEXT }}>{formatDate(ticket.createdAt)}</span></span>
        </div>
      </div>

      {isStaff && ticketTimer.otherTicket && (
        <OtherTicketTimerBanner
          otherTicket={ticketTimer.otherTicket}
          now={ticketTimer.now}
          onCleared={ticketTimer.clearOther}
        />
      )}

      {headerLinkModalOpen && (
        <LinkTicketModal ticketId={id} onClose={() => setHeaderLinkModalOpen(false)} onLinked={reloadActivityAndRelations} />
      )}
      {reportModalOpen && (
        <GenerateReportModal ticketId={id} ticketNumber={String(ticket.id).padStart(5, '0')} onClose={() => setReportModalOpen(false)} />
      )}

      {/* Body: sidebar + main. flex:1 + min-height:0 + overflow:hidden so this
          row takes exactly the remaining viewport height and its children
          (which scroll internally) never push the page taller than 100vh. */}
      <div className="flex items-stretch" style={{ flex: '1 1 auto', minHeight: 0, overflow: 'hidden' }}>
        <div className="hidden md:contents">
          <Sidebar
            ticket={ticket}
            collapsed={collapsed}
            onToggle={() => setCollapsed((c) => !c)}
            isStaff={isStaff}
            canAssign={canAssign}
            onStatusChange={handleStatusChange}
            patchTicket={patchTicket}
            assignableUsers={assignableUsers}
            teams={teams}
            directory={directory}
            ticketStatuses={ticketStatuses}
            tags={ticket.tags || []}
            onAddTag={addTag}
            onRemoveTag={removeTag}
            watchers={watchers}
            onAddWatcher={addWatcher}
            onRemoveWatcher={removeWatcher}
            contactDepartments={assignableContactDepartments(departments.filter((d) => d.companyId === ticket.companyId), user, hasPermission)}
            contactDeptAssign={contactDeptAssign}
            onContactDeptChange={(deptId) => setContactDeptAssign((p) => ({ ...p, deptId }))}
            onAssignContactDepartment={assignContactDepartment}
            customFieldDefs={customFieldDefs}
            onSaveCustomField={saveCustomFieldValue}
            onLinkAsset={linkAsset}
            onUnlinkAsset={unlinkAsset}
          />
        </div>

        <div
          className="min-w-0"
          style={{ flex: '1 1 auto', minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
        >
          {/* Hardcoded per theme via CSS classes (not --color-* variables) so
              the tab bar stays readable no matter what custom background
              color an admin or user has set. */}
          <div className="ticket-tab-bar flex flex-shrink-0 overflow-x-auto">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setActiveTab(t.key)}
                className={`ticket-tab -mb-px flex-shrink-0 whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium ${activeTab === t.key ? 'ticket-tab--active' : ''}`}
              >
                {t.key === 'relationships' && relations.length > 0 ? `${t.label} (${relations.length})` : t.label}
              </button>
            ))}
          </div>

          <div className="p-6" style={{ flex: '1 1 auto', overflowY: 'auto', minHeight: 0 }}>
            {activeTab === 'conversation' && (
              <ConversationTab
                ticket={ticket}
                comments={comments}
                total={commentTotal}
                onLoadMore={() => setCommentLimit((n) => n + SUBLIST_STEP)}
              />
            )}
            {activeTab === 'resolution' && (
              <ResolutionTab ticket={ticket} onSave={saveResolution} isStaff={isStaff} />
            )}
            {activeTab === 'time' && (
              <TimeEntriesTab
                entries={time.entries}
                totalMinutes={time.totalMinutes}
                onAdd={addManualTime}
                assignableUsers={assignableUsers}
                canLogTimeForOthers={canLogTimeForOthers}
                currentUser={user}
              />
            )}
            {activeTab === 'tasks' && (
              <TasksTab tasks={tasks} assignableUsers={assignableUsers} onToggle={toggleTask} onReassign={reassignTask} onAdd={addTask} />
            )}
            {activeTab === 'attachments' && (
              <AttachmentsTab ticketId={id} attachments={attachments} onUpload={uploadFile} onRemove={removeAttachment} />
            )}
            {activeTab === 'relationships' && (
              <RelationshipsTab ticketId={id} relations={relations} isStaff={isStaff} reload={reloadActivityAndRelations} closedStatusNames={closedStatusNames} />
            )}
            {activeTab === 'activity' && (
              <ActivityTab
                activity={activity}
                total={activityTotal}
                onLoadMore={() => setActivityLimit((n) => n + SUBLIST_STEP)}
              />
            )}
          </div>

          {/* Sibling below the scrollable tab content, not inside it — stays
              pinned to the bottom of the main content column. */}
          {activeTab === 'conversation' && (
            <ReplyBox ticket={ticket} onSend={sendReply} fileRef={fileRef} onAttach={handleReplyAttach} isStaff={isStaff} canViewPrivateComments={canViewPrivateComments} />
          )}
        </div>
      </div>

      {noResolutionWarning && (
        <Modal title="No resolution has been documented." onClose={() => setNoResolutionWarning(null)}>
          <p className="mb-4 text-sm" style={{ color: MUTED }}>
            Would you like to add one before closing?
          </p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => { setNoResolutionWarning(null); setActiveTab('resolution'); }}
              className="rounded-md border px-4 py-2 text-sm font-medium"
              style={{ borderColor: BORDER, color: TEXT }}
            >
              Add resolution
            </button>
            <button
              type="button"
              onClick={() => { const status = noResolutionWarning; setNoResolutionWarning(null); applyStatusChange(status); }}
              className="rounded-md px-4 py-2 text-sm font-semibold text-white"
              style={{ backgroundColor: 'var(--color-danger)' }}
            >
              Close without resolution
            </button>
          </div>
        </Modal>
      )}

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
              style={{ backgroundColor: 'var(--color-danger)' }}
            >
              Close anyway
            </button>
          </div>
        </Modal>
      )}

      {mobileDetailsOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileDetailsOpen(false)} />
          <div
            className="absolute inset-x-0 bottom-0 flex max-h-[85vh] flex-col overflow-hidden rounded-t-2xl border-t"
            style={{ backgroundColor: CARD_BG, borderColor: BORDER }}
          >
            <div className="flex flex-shrink-0 items-center justify-between border-b px-4 py-3" style={{ borderColor: BORDER }}>
              <h3 className="text-base font-semibold" style={{ color: TEXT }}>Details</h3>
              <button type="button" onClick={() => setMobileDetailsOpen(false)} className="text-sm font-medium" style={{ color: BLUE }}>
                Done
              </button>
            </div>
            <div style={{ flex: '1 1 auto', minHeight: 0, overflow: 'hidden' }}>
              <Sidebar
                ticket={ticket}
                collapsed={false}
                mobileSheet
                onToggle={() => {}}
                isStaff={isStaff}
                canAssign={canAssign}
                onStatusChange={handleStatusChange}
                patchTicket={patchTicket}
                assignableUsers={assignableUsers}
                teams={teams}
                directory={directory}
                ticketStatuses={ticketStatuses}
                tags={ticket.tags || []}
                onAddTag={addTag}
                onRemoveTag={removeTag}
                watchers={watchers}
                onAddWatcher={addWatcher}
                onRemoveWatcher={removeWatcher}
                contactDepartments={assignableContactDepartments(departments.filter((d) => d.companyId === ticket.companyId), user, hasPermission)}
                contactDeptAssign={contactDeptAssign}
                onContactDeptChange={(deptId) => setContactDeptAssign((p) => ({ ...p, deptId }))}
                onAssignContactDepartment={assignContactDepartment}
                customFieldDefs={customFieldDefs}
                onSaveCustomField={saveCustomFieldValue}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
