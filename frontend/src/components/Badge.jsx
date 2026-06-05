// Color-coded badges for ticket status/priority/type and project status.
const STYLES = {
  // Ticket status
  open: 'bg-blue-100 text-blue-800',
  in_progress: 'bg-amber-100 text-amber-800',
  on_hold: 'bg-gray-200 text-gray-700',
  resolved: 'bg-green-100 text-green-800',
  closed: 'bg-navy-100 text-navy-700',
  // Priority
  low: 'bg-gray-100 text-gray-600',
  medium: 'bg-sky-100 text-sky-800',
  high: 'bg-orange-100 text-orange-800',
  critical: 'bg-red-100 text-red-800',
  // Project status
  active: 'bg-green-100 text-green-800',
  completed: 'bg-blue-100 text-blue-800',
  archived: 'bg-gray-200 text-gray-600',
  // Ticket type
  incident: 'bg-red-50 text-red-700',
  request: 'bg-sky-50 text-sky-700',
  task: 'bg-violet-50 text-violet-700',
  change: 'bg-amber-50 text-amber-700',
};

function label(value) {
  return String(value || '').replace(/_/g, ' ');
}

export default function Badge({ value, className = '' }) {
  const style = STYLES[value] || 'bg-navy-100 text-navy-700';
  return <span className={`badge capitalize ${style} ${className}`}>{label(value)}</span>;
}
