// Activity tab.
import LoadMore from '../../../components/LoadMore';
import { CARD_BG, BORDER, TEXT, MUTED } from '../theme';

// ==================== Activity tab ====================
const ACTIVITY_LABELS = {
  project_created: 'created the project',
  status_changed: 'changed the status',
  task_created: 'created a task',
  task_closed: 'closed a task',
  task_deleted: 'deleted a task',
  subtask_closed: 'closed a subtask',
  time_logged: 'logged time',
  expense_added: 'added an expense',
  material_added: 'added a material',
  member_added: 'added a member',
  file_uploaded: 'uploaded a file',
};

export function ActivityTab({ activity, total, onLoadMore }) {
  return (
    <div className="rounded-[10px] border" style={{ backgroundColor: CARD_BG, borderColor: BORDER }}>
      <ul className="divide-y" style={{ borderColor: BORDER }}>
        {activity.map((a) => {
          const code = a.detail?.projectCode || a.detail?.taskCode || a.detail?.subtaskCode;
          return (
            <li key={a.id} className="flex items-center justify-between px-4 py-3 text-sm">
              <span style={{ color: TEXT }}>
                <strong>{a.user?.displayName || 'System'}</strong> {ACTIVITY_LABELS[a.action] || a.action}
                {code && <> — <code className="font-mono text-xs" style={{ color: MUTED }}>{code}</code></>}
                {a.detail?.title && <> {a.detail.title}</>}
                {a.detail?.name && <> {a.detail.name}</>}
              </span>
              <span style={{ color: MUTED }}>{new Date(a.createdAt).toLocaleString()}</span>
            </li>
          );
        })}
        {activity.length === 0 && <li className="px-4 py-6 text-center text-sm" style={{ color: MUTED }}>No activity yet.</li>}
      </ul>
      <LoadMore loaded={activity.length} total={total} onLoadMore={onLoadMore} noun="entries" />
    </div>
  );
}
