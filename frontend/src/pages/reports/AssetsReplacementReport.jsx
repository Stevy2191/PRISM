import { useEffect, useState } from 'react';
import api, { errMessage } from '../../api/api';
import Spinner from '../../components/Spinner';
import { isForbidden } from '../../components/AccessRestricted';
import { StatCard, SortableTable } from './shared';

export default function AssetsReplacementReport({ filters, onForbidden }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    const params = {};
    if (filters.startDate) params.startDate = filters.startDate;
    if (filters.endDate) params.endDate = filters.endDate;
    if (filters.departmentId) params.departmentId = filters.departmentId;
    api.get('/reports/assets/replacement', { params })
      .then(({ data: d }) => setData(d))
      .catch((err) => {
        if (isForbidden(err)) onForbidden?.();
        else setError(errMessage(err));
      })
      .finally(() => setLoading(false));
  }, [filters, onForbidden]);

  if (loading) return <Spinner />;
  if (error) return <div className="rounded-md bg-red-50 p-4 text-red-700">{error}</div>;
  if (!data) return null;

  return (
    <div className="space-y-5">
      <p className="text-sm text-navy-500">Assets due for replacement — defaults to the next 90 days (including anything already overdue) when no date range is set.</p>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatCard label="Total" value={data.summary.total} />
        <StatCard label="Overdue" value={data.summary.overdue} />
        <StatCard label="Upcoming" value={data.summary.upcoming} />
      </div>
      <SortableTable columns={data.tableData.columns} rows={data.tableData.rows} />
    </div>
  );
}
