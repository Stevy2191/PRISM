import { useEffect, useState } from 'react';
import api, { errMessage } from '../../api/api';
import Spinner from '../../components/Spinner';
import { isForbidden } from '../../components/AccessRestricted';
import { StatCard, ChartCard, SimpleBarChart, PALETTE, SortableTable } from './shared';

export default function AssetsInventoryReport({ filters, onForbidden }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    const params = {};
    if (filters.departmentId) params.departmentId = filters.departmentId;
    api.get('/reports/assets/inventory', { params })
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
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatCard label="Total assets" value={data.summary.total} />
      </div>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <ChartCard title="By category">
          <SimpleBarChart data={data.chartData.byCategory} color={PALETTE[0]} />
        </ChartCard>
        <ChartCard title="By status">
          <SimpleBarChart data={data.chartData.byStatus} color={PALETTE[2]} />
        </ChartCard>
      </div>
      <SortableTable columns={data.tableData.columns} rows={data.tableData.rows} />
    </div>
  );
}
