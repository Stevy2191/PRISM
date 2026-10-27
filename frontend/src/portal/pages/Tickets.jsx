import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { IconPlus, IconSearch } from '@tabler/icons-react';
import portalApi from '../api';
import { usePortalAuth } from '../PortalAuth';
import { ticketNo, statusTone, fmtUpdated } from '../format';
import { useNarrow } from '../../hooks/useNarrow';
import PageHeader from '../../components/ui/PageHeader';
import Pill from '../../components/ui/Pill';
import PillRow from '../../components/ui/PillRow';
import StatusChip from '../../components/ui/StatusChip';

const STATUSES = [['open', 'Open'], ['closed', 'Closed'], ['all', 'All']];

// Mockups Tickets / Phone: scope pills (none pressed = everything I can
// see), Open / Closed / All, search; a table on a desk, cards on a phone.
export default function Tickets() {
  const { me } = usePortalAuth();
  const narrow = useNarrow();
  const [scope, setScope] = useState('all');
  const [status, setStatus] = useState('open');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ tickets: [], totalPages: 1, total: 0 });
  const [loading, setLoading] = useState(true);

  const isAdmin = !!(me?.isCompanyAdmin || me?.adminDepartmentIds?.length);
  const deptName = me?.department && me.adminDepartmentIds?.includes(me.department.id) ? me.department.name : null;
  const scopes = [
    ['mine', 'Mine'], ['watching', 'Watching'],
    ...(me?.adminDepartmentIds?.length ? [['department', deptName ? `${deptName} department` : 'My departments']] : []),
    ...(me?.isCompanyAdmin ? [['company', 'Whole company']] : []),
  ];
  const sub = isAdmin ? 'Yours, the ones you watch, and the ones you look after' : 'Yours and the ones you watch';

  useEffect(() => { setPage(1); }, [scope, status, q]);
  useEffect(() => {
    let live = true;
    setLoading(true);
    const t = setTimeout(() => {
      portalApi.get('/tickets', {
        params: {
          scope, status, page, ...(q.trim() ? { q: q.trim() } : {}),
        },
      })
        .then(({ data: d }) => { if (live) setData(d); })
        .catch(() => { if (live) setData({ tickets: [], totalPages: 1, total: 0 }); })
        .finally(() => { if (live) setLoading(false); });
    }, q ? 250 : 0);
    return () => { live = false; clearTimeout(t); };
  }, [scope, status, q, page]);

  const empty = !loading && data.tickets.length === 0;
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Tickets"
        sub={sub}
        actions={(
          <Link to="/portal/tickets/new" className="btn-primary h-11 sm:h-10">
            <IconPlus size={15} aria-hidden="true" />{narrow ? 'New' : 'New ticket'}
          </Link>
        )}
      />
      <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-center">
        <PillRow label="Show" className="md:mx-0 md:px-0">
          {scopes.map(([key, label]) => (
            <Pill key={key} on={scope === key} onClick={() => setScope(scope === key ? 'all' : key)}>{label}</Pill>
          ))}
        </PillRow>
        <span className="hidden flex-1 md:block" />
        <div role="group" aria-label="Status" className="flex rounded-lg border p-0.5" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-card)' }}>
          {STATUSES.map(([key, label]) => (
            <button
              key={key}
              type="button"
              aria-pressed={status === key}
              onClick={() => setStatus(key)}
              className={`h-9 flex-1 rounded-md px-3.5 text-sm max-md:h-11 ${status === key ? 'font-semibold' : 'font-medium'}`}
              style={status === key ? { backgroundColor: 'var(--color-accent-soft)', color: 'var(--color-accent)' } : { color: 'var(--color-text-secondary)' }}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="relative block md:w-[280px]">
          <IconSearch size={14} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-muted)' }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tickets" aria-label="Search tickets" className="input h-11 pl-9 md:h-9" />
        </label>
      </div>

      {empty ? (
        <div className="card p-10 text-center text-sm" style={{ color: 'var(--color-text-muted)' }}>
          {q.trim() ? 'No tickets match that search.' : 'No tickets here yet.'}
        </div>
      ) : narrow ? (
        <div className="flex flex-col gap-2.5">
          {data.tickets.map((t) => (
            <Link key={t.id} to={`/portal/tickets/${t.id}`} className="card flex flex-col gap-1.5 p-4" style={{ color: 'var(--color-text-primary)' }}>
              <div className="flex items-center justify-between gap-2 text-[13px]">
                <span className="num font-semibold" style={{ color: 'var(--color-text-muted)' }}>{ticketNo(t.id)}</span>
                <StatusChip tone={statusTone(t.statusBehavior)}>{t.status}</StatusChip>
              </div>
              <div className="break-words font-semibold">{t.title}</div>
              <div className="flex items-center justify-between gap-2 text-[13px]" style={{ color: 'var(--color-text-secondary)' }}>
                <span className="min-w-0 truncate">{isAdmin && t.contact ? `For ${t.contact.displayName}` : ''}</span>
                <span className="flex-shrink-0">{fmtUpdated(t.updatedAt)}</span>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full table-fixed text-sm">
            <thead>
              <tr className="h-11 border-b text-left text-[12.5px] font-semibold" style={{ color: 'var(--color-text-muted)', borderColor: 'var(--color-border)' }}>
                <th className="w-[96px] px-5 font-semibold">#</th>
                <th className="px-3 font-semibold">Title</th>
                {isAdmin && <th className="w-[170px] px-3 font-semibold">For</th>}
                <th className="w-[170px] px-3 font-semibold">Status</th>
                <th className="w-[140px] px-5 font-semibold">Last update</th>
              </tr>
            </thead>
            <tbody>
              {data.tickets.map((t) => (
                <tr key={t.id} className="h-[58px] border-b last:border-b-0" style={{ borderColor: 'var(--color-border)' }}>
                  <td className="num px-5" style={{ color: 'var(--color-text-muted)' }}>{ticketNo(t.id)}</td>
                  <td className="px-3"><Link to={`/portal/tickets/${t.id}`} className="block truncate font-semibold hover:underline" style={{ color: 'var(--color-accent)' }}>{t.title}</Link></td>
                  {isAdmin && <td className="truncate px-3" style={{ color: 'var(--color-text-secondary)' }}>{t.contact?.displayName}</td>}
                  <td className="px-3"><StatusChip tone={statusTone(t.statusBehavior)}>{t.status}</StatusChip></td>
                  <td className="px-5 text-[13.5px]" style={{ color: 'var(--color-text-secondary)' }}>{fmtUpdated(t.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data.totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 text-sm">
          <button type="button" className="btn-secondary h-11 sm:h-9" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
          <span className="num" style={{ color: 'var(--color-text-secondary)' }}>Page {page} of {data.totalPages}</span>
          <button type="button" className="btn-secondary h-11 sm:h-9" disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)}>Next</button>
        </div>
      )}
    </div>
  );
}
