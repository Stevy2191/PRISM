import { useState } from 'react';
import {
  BarChart, Bar, Cell, LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid,
} from 'recharts';

export const PALETTE = [
  'var(--color-accent)',
  'var(--color-relation-accent)',
  'var(--color-success)',
  'var(--color-warning)',
  'var(--color-danger)',
  '#0891b2',
  '#db2777',
  '#65a30d',
];

export const PRESETS = [
  { key: 'today', label: 'Today' },
  { key: 'this_week', label: 'This week' },
  { key: 'this_month', label: 'This month' },
  { key: 'last_month', label: 'Last month' },
  { key: 'last_3_months', label: 'Last 3 months' },
  { key: 'last_6_months', label: 'Last 6 months' },
  { key: 'this_year', label: 'This year' },
  { key: 'custom', label: 'Custom range' },
];

function fmt(d) { return d.toISOString().slice(0, 10); }
function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }

export function presetRange(preset) {
  const today = startOfDay(new Date());
  switch (preset) {
    case 'today':
      return { startDate: fmt(today), endDate: fmt(today) };
    case 'this_week': {
      const d = new Date(today);
      const day = d.getDay() || 7;
      d.setDate(d.getDate() - day + 1);
      return { startDate: fmt(d), endDate: fmt(today) };
    }
    case 'this_month':
      return { startDate: fmt(new Date(today.getFullYear(), today.getMonth(), 1)), endDate: fmt(today) };
    case 'last_month': {
      const s = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const e = new Date(today.getFullYear(), today.getMonth(), 0);
      return { startDate: fmt(s), endDate: fmt(e) };
    }
    case 'last_3_months':
      return { startDate: fmt(new Date(today.getFullYear(), today.getMonth() - 3, today.getDate())), endDate: fmt(today) };
    case 'last_6_months':
      return { startDate: fmt(new Date(today.getFullYear(), today.getMonth() - 6, today.getDate())), endDate: fmt(today) };
    case 'this_year':
      return { startDate: fmt(new Date(today.getFullYear(), 0, 1)), endDate: fmt(today) };
    default:
      return null;
  }
}

export function formatHours(h) {
  if (h === null || h === undefined) return '—';
  return `${Number(h).toFixed(1)}h`;
}

export function StatCard({ label, value, sub }) {
  return (
    <div className="card p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-navy-400">{label}</p>
      <p className="mt-1 text-2xl font-bold text-navy-900">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-navy-400">{sub}</p>}
    </div>
  );
}

export function ChartCard({ title, children, height = 260 }) {
  return (
    <div className="card p-5">
      <h3 className="mb-4 font-semibold text-navy-900">{title}</h3>
      <div style={{ height }}>{children}</div>
    </div>
  );
}

const axisTick = { fontSize: 12, fill: 'var(--color-text-muted)' };

// `colorForName`, if given, colors each bar individually (e.g. ticket status colors).
export function SimpleBarChart({ data, dataKey = 'count', color = PALETTE[0], colorForName }) {
  if (!data || data.length === 0) return <p className="text-sm text-navy-400">No data.</p>;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
        <XAxis dataKey="name" tick={axisTick} interval={0} angle={data.length > 8 ? -30 : 0} textAnchor={data.length > 8 ? 'end' : 'middle'} height={data.length > 8 ? 50 : 30} />
        <YAxis allowDecimals={false} tick={axisTick} />
        <Tooltip />
        <Bar dataKey={dataKey} fill={color} radius={[4, 4, 0, 0]}>
          {colorForName && data.map((d, i) => <Cell key={i} fill={colorForName(d.name) || color} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// Multiple named series in one bar chart (e.g. met vs missed).
export function GroupedBarChart({ data, bars }) {
  if (!data || data.length === 0) return <p className="text-sm text-navy-400">No data.</p>;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
        <XAxis dataKey="name" tick={axisTick} />
        <YAxis allowDecimals={false} tick={axisTick} />
        <Tooltip />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {bars.map((b, i) => (
          <Bar key={b.dataKey} dataKey={b.dataKey} name={b.label} fill={b.color || PALETTE[i % PALETTE.length]} radius={[4, 4, 0, 0]} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

export function MultiLineChart({ data, lines, xKey = 'date' }) {
  if (!data || data.length === 0) return <p className="text-sm text-navy-400">No data.</p>;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
        <XAxis dataKey={xKey} tick={axisTick} />
        <YAxis allowDecimals={false} tick={axisTick} />
        <Tooltip />
        {lines.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
        {lines.map((l, i) => (
          <Line key={l.dataKey} type="monotone" dataKey={l.dataKey} name={l.label} stroke={l.color || PALETTE[i % PALETTE.length]} strokeWidth={2} dot={false} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

export function SortableTable({ columns, rows, onRowClick, emptyMessage = 'No data.' }) {
  const [sort, setSort] = useState({ key: null, dir: 'asc' });

  const sorted = [...(rows || [])];
  if (sort.key) {
    sorted.sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      if (av === bv) return 0;
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv));
      return sort.dir === 'asc' ? cmp : -cmp;
    });
  }

  const toggleSort = (key) => {
    setSort((prev) => (prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
  };

  return (
    <div className="card overflow-x-auto">
      <table className="min-w-full divide-y divide-navy-100">
        <thead className="bg-navy-50">
          <tr>
            {columns.map((c) => (
              <th key={c.key} className="table-th cursor-pointer select-none" onClick={() => toggleSort(c.key)}>
                {c.label} {sort.key === c.key ? (sort.dir === 'asc' ? '▲' : '▼') : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-navy-100">
          {sorted.map((row, i) => (
            <tr key={row.id ?? i} className={onRowClick ? 'cursor-pointer hover:bg-navy-50' : 'hover:bg-navy-50'} onClick={() => onRowClick && onRowClick(row)}>
              {columns.map((c) => (
                <td key={c.key} className="table-td">{c.render ? c.render(row) : (row[c.key] ?? '—')}</td>
              ))}
            </tr>
          ))}
          {sorted.length === 0 && (
            <tr><td colSpan={columns.length} className="table-td text-center text-navy-400">{emptyMessage}</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
