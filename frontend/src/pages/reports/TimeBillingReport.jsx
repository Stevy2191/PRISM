import { useEffect, useState } from 'react';
import api, { errMessage } from '../../api/api';
import Spinner from '../../components/Spinner';
import { isForbidden } from '../../components/AccessRestricted';
import { StatCard, ChartCard, SimpleBarChart, MultiLineChart, SortableTable, PALETTE } from './shared';

export default function TimeBillingReport({ filters, onForbidden }) {
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
    if (filters.assigneeId) params.assigneeId = filters.assigneeId;
    api.get('/reports/time-billing', { params })
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
        <StatCard label="Total hours logged" value={`${data.summary.totalHours}h`} />
        <StatCard label="Avg hours per ticket" value={`${data.summary.avgHoursPerTicket}h`} />
        <StatCard label="Time entries" value={data.summary.entryCount} />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <ChartCard title="Hours logged per tech">
          <SimpleBarChart data={data.chartData.byTech} dataKey="hours" color={PALETTE[0]} />
        </ChartCard>
        <ChartCard title="Hours logged per department">
          <SimpleBarChart data={data.chartData.byDepartment} dataKey="hours" color={PALETTE[1]} />
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <ChartCard title={`Hours logged per ${data.chartData.granularity}`}>
          <MultiLineChart data={data.chartData.overTime} lines={[{ dataKey: 'hours', label: 'Hours', color: PALETTE[2] }]} />
        </ChartCard>
        <ChartCard title="Hours logged per ticket type">
          <SimpleBarChart data={data.chartData.byType} dataKey="hours" color={PALETTE[3]} />
        </ChartCard>
      </div>

      <div className="card p-5">
        <h3 className="font-semibold text-navy-900">Billing summary</h3>
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <p className="text-xs text-navy-400">Internal hours</p>
            <p className="text-lg font-semibold text-navy-900">{data.summary.internalHours}h</p>
          </div>
          <div>
            <p className="text-xs text-navy-400">Contractor hours</p>
            <p className="text-lg font-semibold text-navy-900">{data.summary.contractorHours}h</p>
          </div>
          <div>
            <p className="text-xs text-navy-400">Total labor cost (contractors)</p>
            <p className="text-lg font-semibold text-navy-900">${data.summary.totalLaborCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
          </div>
        </div>
      </div>

      <SortableTable
        columns={[
          { key: 'techName', label: 'Tech' },
          { key: 'reference', label: 'Ticket/Project' },
          { key: 'note', label: 'Description' },
          { key: 'date', label: 'Date' },
          { key: 'hours', label: 'Hours' },
          { key: 'laborCost', label: 'Labor cost', render: (row) => (row.laborCost === '' || row.laborCost === null || row.laborCost === undefined ? '—' : `$${Number(row.laborCost).toFixed(2)}`) },
        ]}
        rows={data.tableData.rows}
      />
    </div>
  );
}
