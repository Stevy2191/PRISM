import { Link } from 'react-router-dom';
import { IconTools } from '@tabler/icons-react';

// Generic "coming soon" state for settings sections that don't have a real
// backend yet — used instead of leaving a route broken/empty. Always paired
// with a real, specific description of what the feature will do (not a
// generic "coming soon" with no context) and a matching icon.
export default function Placeholder({ title, note, icon: Icon = IconTools }) {
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Link to="/settings" className="text-sm text-prism hover:underline">← Back to Settings</Link>
      <div className="card flex flex-col items-center gap-3 p-10 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-navy-100 text-navy-400">
          <Icon size={28} stroke={1.5} />
        </div>
        <h1 className="text-xl font-bold text-navy-900">{title}</h1>
        <p className="max-w-md text-sm text-navy-500">
          {note || 'This section is coming soon.'}
        </p>
        <span className="badge bg-amber-100 text-amber-800">Planned for a future update</span>
      </div>
    </div>
  );
}
