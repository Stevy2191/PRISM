import { useEffect, useState } from 'react';
import api, { errMessage } from '../../api/api';
import Spinner from '../../components/Spinner';
import { isForbidden } from '../../components/AccessRestricted';
import { StatCard, ChartCard, SimpleBarChart, MultiLineChart, SortableTable, PALETTE, formatHours } from './shared';

export default function ContactsReport({ filters, onForbidden }) {
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
    api.get('/reports/contacts', { params })
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

  const deptNames = [...new Set(data.chartData.submissionsByDeptOverTime.flatMap((row) => Object.keys(row).filter((k) => k !== 'date')))];
  const submissionLines = deptNames.map((name, i) => ({ dataKey: name, label: name, color: PALETTE[i % PALETTE.length] }));

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Total contacts" value={data.summary.totalContacts} />
        <StatCard label="With open tickets" value={data.summary.contactsWithOpenTickets} />
        <StatCard label="Most active contact" value={data.summary.mostActiveContact || '—'} />
        <StatCard label="Top department" value={data.summary.departmentWithMostTickets || '—'} />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <ChartCard title="Tickets per department">
          <SimpleBarChart data={data.chartData.byDepartment} color={PALETTE[0]} />
        </ChartCard>
        <ChartCard title="Top 10 contacts by ticket count">
          <SimpleBarChart data={data.chartData.topContacts} color={PALETTE[1]} />
        </ChartCard>
      </div>

      <ChartCard title="Ticket submissions by department over time">
        <MultiLineChart data={data.chartData.submissionsByDeptOverTime} lines={submissionLines} />
      </ChartCard>

      <SortableTable
        columns={[
          { key: 'name', label: 'Department' },
          { key: 'totalContacts', label: 'Contacts' },
          { key: 'totalTickets', label: 'Tickets' },
          { key: 'openTickets', label: 'Open' },
          { key: 'closedTickets', label: 'Closed' },
          { key: 'avgResolutionHours', label: 'Avg resolution', render: (r) => formatHours(r.avgResolutionHours) },
        ]}
        rows={data.tableData.rows}
      />
    </div>
  );
}
