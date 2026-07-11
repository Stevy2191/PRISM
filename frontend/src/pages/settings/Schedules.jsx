import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { errMessage } from '../../api/api';
import Spinner from '../../components/Spinner';

function relativeTime(iso) {
  if (!iso) return 'Never run';
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export default function Schedules() {
  const [jobs, setJobs] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/schedules')
      .then(({ data }) => setJobs(data.jobs))
      .catch((err) => setError(errMessage(err)));
  }, []);

  if (error) return <div className="mx-auto max-w-2xl rounded-md bg-red-50 p-4 text-red-700">{error}</div>;
  if (!jobs) return <Spinner />;

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <Link to="/settings" className="text-sm text-prism hover:underline">← Back to Settings</Link>
      <div>
        <h1 className="text-2xl font-bold text-navy-900">Schedules</h1>
        <p className="text-sm text-navy-500">
          Background jobs this PRISM instance runs automatically. Read-only — configure Directory
          Sync and Calendar Integration on their own settings pages.
        </p>
      </div>

      <div className="card divide-y divide-navy-100">
        {jobs.map((job) => (
          <div key={job.key} className="p-4">
            <div className="flex items-center justify-between">
              <p className="font-medium text-navy-900">{job.name}</p>
              <span className="badge bg-navy-100 text-navy-600">{job.intervalLabel}</span>
            </div>
            <p className="mt-1 text-sm text-navy-500">{job.description}</p>
            <p className="mt-2 text-xs text-navy-400">
              Last run: <span className="font-medium text-navy-600">{relativeTime(job.lastRun)}</span>
              {job.lastStatus && (
                <span className={`ml-2 badge ${job.lastStatus === 'success' ? 'bg-green-100 text-green-700' : job.lastStatus === 'failed' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                  {job.lastStatus}
                </span>
              )}
              {job.activeIntegrationCount !== undefined && (
                <span className="ml-2">· {job.activeIntegrationCount} active integration{job.activeIntegrationCount === 1 ? '' : 's'}</span>
              )}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
