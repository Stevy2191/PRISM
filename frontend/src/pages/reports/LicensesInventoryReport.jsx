import { useEffect, useState } from 'react';
import api, { errMessage } from '../../api/api';
import Spinner from '../../components/Spinner';
import { isForbidden } from '../../components/AccessRestricted';
import { StatCard, SortableTable } from './shared';

export default function LicensesInventoryReport({ filters, onForbidden }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true); setError('');
    const params = {};
    if (filters.departmentId) params.departmentId = filters.departmentId;
    api.get('/reports/licenses/inventory', { params })
      .then(({ data: d }) => setData(d))
      .catch((err) => { if (isForbidden(err)) onForbidden?.(); else setError(errMessage(err)); })
      .finally(() => setLoading(false));
  }, [filters, onForbidden]);

  if (loading) return <Spinner />;
  if (error) return <div className="rounded-md bg-red-50 p-4 text-red-700">{error}</div>;
  if (!data) return null;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Total licenses" value={data.summary.total} />
        <StatCard label="Total seats" value={data.summary.totalSeats} />
        <StatCard label="Used seats" value={data.summary.usedSeats} />
        <StatCard label="Total annual cost" value={`$${data.summary.totalAnnualCost.toLocaleString()}`} />
      </div>
      <SortableTable columns={data.tableData.columns} rows={data.tableData.rows} />
    </div>
  );
}
