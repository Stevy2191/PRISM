import { Link } from 'react-router-dom';

// Generic placeholder for settings sections that are specified for a later phase.
export default function Placeholder({ title, note }) {
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Link to="/settings" className="text-sm text-prism hover:underline">← Back to Settings</Link>
      <div className="card p-8 text-center">
        <p className="text-2xl">🚧</p>
        <h1 className="mt-2 text-xl font-bold text-navy-900">{title}</h1>
        <p className="mt-2 text-sm text-navy-500">
          {note || 'This section is coming soon.'}
        </p>
      </div>
    </div>
  );
}
