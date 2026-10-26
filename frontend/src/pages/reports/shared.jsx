import { useState } from 'react';
import {
  BarChart, Bar, Cell, LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid,
  PieChart, Pie, LabelList,
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

export { PRESETS, presetRange } from './presets.js';

export function formatHours(h) {
  if (h === null || h === undefined) return '—';
  return `${Number(h).toFixed(1)}h`;
}

export function StatCard({ label, value, sub }) {
  return (
    <div className="card p-4 sm:p-5">
      <p className="text-[13px] font-medium" style={{ color: 'var(--color-text-secondary)' }}>{label}</p>
      <p className="num mt-1 text-2xl font-semibold tracking-tight text-navy-900">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-navy-400">{sub}</p>}
    </div>
  );
}

export function ChartCard({ title, children, height = 260 }) {
  return (
    <div className="card min-w-0 p-4 sm:p-5">
      <h3 className="mb-4 text-[15px] font-semibold text-navy-900">{title}</h3>
      <div style={{ height }}>{children}</div>
    </div>
  );
}

// One look for every chart: muted axis text, faint solid grid, tooltip on the
// card surface, values in text tokens (never the series colour).
const axisTick = { fontSize: 12, fill: 'var(--color-text-muted)' };
const axisLine = { stroke: 'var(--color-border)' };
const grid = { stroke: 'var(--color-border)', strokeOpacity: 0.6 };
const tooltip = {
  contentStyle: {
    backgroundColor: 'var(--color-card)', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: 12, color: 'var(--color-text-primary)',
  },
  labelStyle: { color: 'var(--color-text-muted)' },
  itemStyle: { color: 'var(--color-text-primary)' },
  cursor: { fill: 'var(--color-hover)', stroke: 'var(--color-border)' },
};
const valueLabel = { fontSize: 11, fontWeight: 600, fill: 'var(--color-text-primary)' };

// Single-series bars in the accent colour with the value on each bar.
// `colorForName`, if given, colors each bar individually (e.g. ticket status
// colors). layout 'horizontal' lays bars sideways (long names, e.g. people).
export function SimpleBarChart({
  data, dataKey = 'count', color = PALETTE[0], colorForName, layout = 'vertical',
}) {
  if (!data || data.length === 0) return <p className="text-sm text-navy-400">No data.</p>;
  if (layout === 'horizontal') {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ right: 36 }}>
          <CartesianGrid horizontal={false} {...grid} />
          <XAxis type="number" allowDecimals={false} tick={axisTick} axisLine={axisLine} tickLine={false} />
          <YAxis type="category" dataKey="name" tick={axisTick} width={120} axisLine={axisLine} tickLine={false} interval={0} />
          <Tooltip {...tooltip} />
          <Bar dataKey={dataKey} fill={color} radius={[0, 4, 4, 0]} maxBarSize={22}>
            {colorForName && data.map((d, i) => <Cell key={i} fill={colorForName(d.name) || color} />)}
            <LabelList dataKey={dataKey} position="right" style={valueLabel} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    );
  }
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 18 }}>
        <CartesianGrid vertical={false} {...grid} />
        <XAxis dataKey="name" tick={axisTick} interval={0} angle={data.length > 8 ? -30 : 0} textAnchor={data.length > 8 ? 'end' : 'middle'} height={data.length > 8 ? 50 : 30} axisLine={axisLine} tickLine={false} />
        <YAxis allowDecimals={false} tick={axisTick} axisLine={false} tickLine={false} width={36} />
        <Tooltip {...tooltip} />
        <Bar dataKey={dataKey} fill={color} radius={[4, 4, 0, 0]} maxBarSize={44}>
          {colorForName && data.map((d, i) => <Cell key={i} fill={colorForName(d.name) || color} />)}
          <LabelList dataKey={dataKey} position="top" style={valueLabel} />
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
        <CartesianGrid vertical={false} {...grid} />
        <XAxis dataKey="name" tick={axisTick} axisLine={axisLine} tickLine={false} />
        <YAxis allowDecimals={false} tick={axisTick} axisLine={false} tickLine={false} width={36} />
        <Tooltip {...tooltip} />
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
        <CartesianGrid vertical={false} {...grid} />
        <XAxis dataKey={xKey} tick={axisTick} axisLine={axisLine} tickLine={false} minTickGap={16} />
        <YAxis allowDecimals={false} tick={axisTick} axisLine={false} tickLine={false} width={36} />
        <Tooltip {...tooltip} />
        {lines.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
        {lines.map((l, i) => (
          <Line key={l.dataKey} type="linear" dataKey={l.dataKey} name={l.label} stroke={l.color || PALETTE[i % PALETTE.length]} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

// Donut chart showing each group's share — used by the custom report
// builder when visualization='pie'.
export function DonutChart({ data, dataKey = 'count' }) {
  if (!data || data.length === 0) return <p className="text-sm text-navy-400">No data.</p>;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie data={data} dataKey={dataKey} nameKey="name" innerRadius="55%" outerRadius="85%" paddingAngle={2}>
          {data.map((d, i) => <Cell key={d.name ?? i} fill={PALETTE[i % PALETTE.length]} />)}
        </Pie>
        <Tooltip {...tooltip} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
      </PieChart>
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
        <thead>
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
            <tr key={row.key ?? row.id ?? i} className={onRowClick ? 'cursor-pointer hover:bg-[var(--color-hover)]' : 'hover:bg-[var(--color-hover)]'} onClick={() => onRowClick && onRowClick(row)}>
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
