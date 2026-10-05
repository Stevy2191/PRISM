import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { errMessage } from '../../api/api';

// A compact list of one company's records (or of what was bought from a
// vendor), with a link to the full list filtered to that company.
const KINDS = {
  contacts: { url: '/contacts', key: 'contacts', href: (r) => `/contacts/${r.id}`, full: '/contacts', cols: [['Name', (r) => r.displayName], ['Email', (r) => r.email || '—'], ['Department', (r) => r.department?.name || '—']] },
  tickets: { url: '/tickets', key: 'tickets', href: (r) => `/tickets/${r.id}`, full: '/tickets', cols: [['#', (r) => String(r.id).padStart(5, '0')], ['Title', (r) => r.title], ['Status', (r) => r.status]] },
  projects: { url: '/projects', key: 'projects', href: (r) => `/projects/${r.id}`, full: '/projects', cols: [['Code', (r) => r.projectCode], ['Name', (r) => r.name], ['Status', (r) => r.status?.name || r.status]] },
  assets: { url: '/assets', key: 'assets', href: (r) => `/assets/${r.id}`, full: '/assets', cols: [['Tag', (r) => r.assetTag], ['Name', (r) => r.name], ['Status', (r) => r.status]] },
  licenses: { url: '/licenses', key: 'licenses', href: (r) => `/assets/licenses/${r.id}`, full: '/assets/licenses', cols: [['Name', (r) => r.name], ['Expires', (r) => r.expiryDate || '—']] },
  contracts: { url: '/contracts', key: 'contracts', href: (r) => `/assets/contracts/${r.id}`, full: '/assets/contracts', cols: [['Name', (r) => r.name], ['Renews', (r) => r.renewalDate || r.endDate || '—']] },
};

export default function CompanyRecordList({ kind, companyId, vendorCompanyId }) {
  const spec = KINDS[kind];
  const [rows, setRows] = useState(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');
  useEffect(() => {
    const params = vendorCompanyId ? { vendorCompanyId, limit: 25 } : { companyId, limit: 25 };
    api.get(spec.url, { params })
      .then(({ data }) => { setRows(data[spec.key] || []); setTotal(data.total ?? (data[spec.key] || []).length); })
      .catch((err) => setError(err.response?.status === 403 ? "You don't have access to these records." : errMessage(err)));
  }, [spec, companyId, vendorCompanyId]);

  if (error) return <p className="text-sm" style={{ color: 'var(--color-muted)' }}>{error}</p>;
  if (!rows) return null;
  return (
    <div className="space-y-2">
      <table className="min-w-full text-sm">
        <thead><tr>{spec.cols.map(([h]) => <th key={h} className="table-th">{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t" style={{ borderColor: 'var(--color-border)' }}>
              {spec.cols.map(([h, get], i) => (
                <td key={h} className="table-td">{i === 0 || h === 'Name' ? <Link to={spec.href(r)} className="hover:underline">{get(r)}</Link> : get(r)}</td>
              ))}
            </tr>
          ))}
          {!rows.length && <tr><td className="table-td" colSpan={spec.cols.length}>None yet.</td></tr>}
        </tbody>
      </table>
      {!vendorCompanyId && total > rows.length && (
        <Link className="text-sm text-prism hover:underline" to={`${spec.full}?companyId=${companyId}`}>See all {total}</Link>
      )}
    </div>
  );
}
