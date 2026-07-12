import { useEffect, useState } from 'react';
import api, { errMessage } from '../../api/api';
import Spinner from '../../components/Spinner';
import { isForbidden } from '../../components/AccessRestricted';
import { StatCard, ChartCard, DonutChart, SortableTable } from './shared';

export default function SoftwareSpendReport({ filters, onForbidden }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true); setError('');
    const params = {};
    if (filters.departmentId) params.departmentId = filters.departmentId;
    api.get('/reports/licenses/spend', { params })
      .then(({ data: d }) => setData(d))
      .catch((err) => { if (isForbidden(err)) onForbidden?.(); else setError(errMessage(err)); })
      .finally(() => setLoading(false));
  }, [filters, onForbidden]);

  if (loading) return <Spinner />;
  if (error) return <div className="rounded-md bg-red-50 p-4 text-red-700">{error}</div>;
  if (!data) return null;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatCard label="Total software spend" value={`$${data.summary.totalAnnualCost.toLocaleString()}`} />
        <StatCard label="Licenses" value={data.summary.licenseCount} />
      </div>
      <ChartCard title="Annual cost by department">
        <DonutChart data={data.chartData.byDepartment} dataKey="value" />
      </ChartCard>
      <SortableTable columns={data.tableData.columns} rows={data.tableData.rows} />
    </div>
  );
}
