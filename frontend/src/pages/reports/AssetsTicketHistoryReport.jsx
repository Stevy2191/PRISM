import { useEffect, useState } from 'react';
import api, { errMessage } from '../../api/api';
import Spinner from '../../components/Spinner';
import { isForbidden } from '../../components/AccessRestricted';
import { StatCard, ChartCard, SimpleBarChart, PALETTE, SortableTable } from './shared';

export default function AssetsTicketHistoryReport({ filters, onForbidden }) {
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
    api.get('/reports/assets/ticket-history', { params })
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
      <p className="text-sm text-navy-500">Which assets generate the most support tickets — sorted by ticket count, most first.</p>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatCard label="Linked tickets" value={data.summary.totalLinkedTickets} />
        <StatCard label="Assets with tickets" value={data.summary.assetsWithTickets} />
      </div>
      <ChartCard title="Top 10 assets by ticket count">
        <SimpleBarChart data={data.chartData.topAssets} color={PALETTE[4]} />
      </ChartCard>
      <SortableTable columns={data.tableData.columns} rows={data.tableData.rows} />
    </div>
  );
}
