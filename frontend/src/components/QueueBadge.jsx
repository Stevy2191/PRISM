import { useEffect, useState } from 'react';
import api from '../api/api';

// Unassigned open tickets waiting in my teams' queues (5b), on the Tickets
// nav item. Polled every minute, like notifications; hidden at zero.
export default function QueueBadge({ compact = false }) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = () => api.get('/tickets/queue-count')
      .then(({ data }) => { if (alive) setCount(data.count || 0); })
      .catch(() => {});
    load();
    const timer = setInterval(load, 60000);
    return () => { alive = false; clearInterval(timer); };
  }, []);
  if (!count) return null;
  return (
    <span
      title={`${count} unassigned in my queues`}
      data-testid="queue-badge"
      className={`${compact ? 'absolute right-0.5 top-1' : 'ml-1.5'} inline-flex h-4 min-w-[16px] items-center justify-center rounded-[3px] px-1 font-mono text-[10px] font-semibold text-white`}
      style={{ backgroundColor: 'var(--color-accent)' }}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}
