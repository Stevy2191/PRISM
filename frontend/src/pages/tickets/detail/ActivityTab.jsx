// Activity tab.
import LoadMore from '../../../components/LoadMore';
import { TEXT, MUTED, timeAgo } from '../theme';

// ---- Activity tab ----

const ACTIVITY_DOT = {
  created: 'var(--color-accent)',
  status: 'var(--color-warning)',
  priority: 'var(--color-danger)',
  type: 'var(--color-text-muted)',
  assigneeId: 'var(--color-accent)',
  teamId: 'var(--color-accent)',
  departmentId: 'var(--color-text-muted)',
  dueDate: 'var(--color-text-muted)',
  dueTime: 'var(--color-text-muted)',
  comment: 'var(--color-relation-accent)',
  time_logged: 'var(--color-success)',
  attachment_added: 'var(--color-text-muted)',
  relation_added: 'var(--color-relation-accent-light)',
};

const ACTIVITY_FIELD_LABEL = {
  status: 'status', priority: 'priority', type: 'type', assigneeId: 'assignee',
  teamId: 'team', departmentId: 'department', dueDate: 'due date', dueTime: 'due time',
};

function activityDescription(a) {
  const actor = a.user?.displayName || 'Someone';
  if (a.action === 'created') return `${actor} opened this ticket`;
  if (a.action === 'comment') return `${actor} commented on this ticket`;
  if (a.action === 'time_logged') return `${actor} logged ${a.toValue} of time`;
  if (a.action === 'attachment_added') return `${actor} added attachment "${a.toValue}"`;
  if (a.action === 'relation_added') return `${actor} linked ${a.toValue}`;
  if (a.action === 'custom_fields') return `${actor} updated a custom field`;
  if (ACTIVITY_FIELD_LABEL[a.action]) {
    return `${actor} changed ${ACTIVITY_FIELD_LABEL[a.action]} from ${a.fromValue || 'none'} to ${a.toValue || 'none'}`;
  }
  return `${actor} updated this ticket`;
}

export function ActivityTab({ activity, total, onLoadMore }) {
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
      <LoadMore loaded={activity.length} total={total} onLoadMore={onLoadMore} noun="entries" />
    </ul>
  );
}
