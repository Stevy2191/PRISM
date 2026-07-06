import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api, { errMessage } from '../../api/api';
import Spinner from '../../components/Spinner';
import { isForbidden } from '../../components/AccessRestricted';
import { StatCard, ChartCard, SimpleBarChart, SortableTable, PALETTE } from './shared';

export default function ProjectsReport({ filters, onForbidden }) {
  const navigate = useNavigate();
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
    api.get('/reports/projects', { params })
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

  const money = (v) => `$${Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard label="Active projects" value={data.summary.totalActive} />
        <StatCard label="Completed in period" value={data.summary.totalCompletedInPeriod} />
        <StatCard label="Avg completion" value={`${data.summary.avgCompletion}%`} />
        <StatCard label="Materials cost" value={money(data.summary.totalMaterialsCost)} />
        <StatCard label="Expenses cost" value={money(data.summary.totalExpensesCost)} />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <ChartCard title="Projects by status">
          <SimpleBarChart data={data.chartData.byStatus} color={PALETTE[0]} />
        </ChartCard>
        <ChartCard title="Total cost per department">
          <SimpleBarChart data={data.chartData.costByDepartment} dataKey="cost" color={PALETTE[1]} />
        </ChartCard>
        <ChartCard title="Completion % distribution">
          <SimpleBarChart data={data.chartData.completionDistribution} color={PALETTE[2]} />
        </ChartCard>
      </div>

      <SortableTable
        columns={[
          { key: 'projectCode', label: 'Project' },
          { key: 'name', label: 'Name' },
          { key: 'ownedBy', label: 'Owned by' },
          { key: 'forDept', label: 'For dept' },
          { key: 'status', label: 'Status' },
          { key: 'completion', label: 'Completion', render: (r) => `${r.completion}%` },
          { key: 'dueDate', label: 'Due date' },
          { key: 'timeLoggedHours', label: 'Time (hrs)' },
          { key: 'materialsCost', label: 'Materials', render: (r) => money(r.materialsCost) },
          { key: 'expensesCost', label: 'Expenses', render: (r) => money(r.expensesCost) },
          { key: 'totalCost', label: 'Total cost', render: (r) => money(r.totalCost) },
        ]}
        rows={data.tableData.rows}
        onRowClick={(row) => navigate(`/projects/${row.id}`)}
      />
    </div>
  );
}
