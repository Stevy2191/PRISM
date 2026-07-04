// Color-coded badges for ticket status/priority/type and project status.
// Ticket/project status values now match the admin-editable statuses table's
// `name` (default seeded names shown below); a custom admin-added status
// falls back to the neutral navy style unless a `color` prop is passed in.
const STYLES = {
  // Ticket status
  Open: 'bg-blue-100 text-blue-800',
  'In Progress': 'bg-amber-100 text-amber-800',
  Pending: 'bg-amber-100 text-amber-800',
  'On Hold': 'bg-gray-200 text-gray-700',
  Resolved: 'bg-green-100 text-green-800',
  Closed: 'bg-navy-100 text-navy-700',
  // Priority
  low: 'bg-gray-100 text-gray-600',
  medium: 'bg-sky-100 text-sky-800',
  high: 'bg-orange-100 text-orange-800',
  critical: 'bg-red-100 text-red-800',
  // Project status
  Active: 'bg-green-100 text-green-800',
  Completed: 'bg-blue-100 text-blue-800',
  Archived: 'bg-gray-200 text-gray-600',
  // Ticket type
  incident: 'bg-red-50 text-red-700',
  request: 'bg-sky-50 text-sky-700',
  problem: 'bg-rose-100 text-rose-800',
  task: 'bg-violet-50 text-violet-700',
  change: 'bg-amber-50 text-amber-700',
};

function label(value) {
  return String(value || '').replace(/_/g, ' ');
}

// `color` (a hex string) overrides the static STYLES lookup — pass the
// status's own color from a fetched statuses list where available.
export default function Badge({ value, color, className = '' }) {
  if (color) {
    return (
      <span className={`badge capitalize ${className}`} style={{ backgroundColor: `color-mix(in srgb, ${color} 13%, transparent)`, color }}>
        {label(value)}
      </span>
    );
  }
  const style = STYLES[value] || 'bg-navy-100 text-navy-700';
  return <span className={`badge capitalize ${style} ${className}`}>{label(value)}</span>;
}
