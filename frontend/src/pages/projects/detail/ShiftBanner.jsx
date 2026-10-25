// After a task's due date moves later: offer to move what waits on it by the
// same number of days (top of the task list).
import Button from '../../../components/ui/Button';
import Notice from '../../../components/ui/Notice';

export default function ShiftBanner({ offer, busy, onMove, onLeave }) {
  const n = offer.count;
  const days = `${offer.days} ${offer.days === 1 ? 'day' : 'days'}`;
  return (
    <Notice tone="warn" className="mt-4">
      <span className="min-w-[240px] flex-1">
        You moved <b>{offer.code}</b> {days} later. <b>{n} {n === 1 ? 'task waits' : 'tasks wait'}</b> on it.
        {' '}Move {n === 1 ? 'it' : 'them'} {days} later too?
      </span>
      <Button size="sm" variant="primary" disabled={busy} onClick={onMove}>Move {n} {n === 1 ? 'task' : 'tasks'}</Button>
      <Button size="sm" disabled={busy} onClick={onLeave}>Leave them</Button>
    </Notice>
  );
}
