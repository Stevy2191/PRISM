// The projects list (look A): attention tiles, filter pills and one row per
// project. The tiles and pills only build a query; the server does the filtering.
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import api, { errMessage } from '../api/api';
import CompanyFilter from '../components/companies/CompanyFilter';
import Pagination from '../components/Pagination';
import Spinner from '../components/Spinner';
import Pill from '../components/ui/Pill';
import { useAuth, usePermission } from '../context/AuthContext';
import { usePagination } from '../hooks/usePagination';
import AttentionTiles from './projects/list/AttentionTiles';
import BulkBar from './projects/list/BulkBar';
import ProjectRow, { COLUMNS } from './projects/list/ProjectRow';
import TagsMenu from './projects/list/TagsMenu';
import { PILLS, listParams, pickTile } from './projects/list/listFilters';
import { localToday } from './projects/detail/taskFilters';

const HEADS = ['Project', 'Lead', "Where it's at", 'Hours', 'Next milestone', 'Due', 'Status'];

export default function Projects() {
  const { isStaff } = useAuth();
  const canCreate = usePermission('projects.create');
  const [searchParams, setSearchParams] = useSearchParams();
  const [projects, setProjects] = useState([]);
  const [statuses, setStatuses] = useState([]);
  const [users, setUsers] = useState([]);
  const [allTags, setAllTags] = useState([]);
  const [counts, setCounts] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(() => new Set());

  const [filters, setFilters] = useState({
    pill: 'open', attention: '', companyId: searchParams.get('companyId') || '', tag: searchParams.get('tag') || '', search: '',
  });
  const today = localToday();
  const params = useMemo(() => listParams({ ...filters, today }), [filters, today]);
  const filterKey = JSON.stringify(params);
  const pager = usePagination({ filterKey, storageKey: 'prism.projects.pageSize' });
  const change = (patch) => { setFilters((f) => ({ ...f, ...patch })); setSelected(new Set()); };
  const setTag = (tag) => { change({ tag }); setSearchParams(tag ? { tag } : {}); };

  const loadCounts = () => api.get('/projects/attention', { params: { today } })
    .then(({ data }) => setCounts(data)).catch(() => {});

  const load = () => {
    setLoading(true);
    api.get('/projects', { params: { ...params, ...pager.params } })
      .then(({ data }) => { setProjects(data.projects); pager.applyMeta(data); setError(''); })
      .catch((err) => setError(errMessage(err)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    api.get('/project-statuses').then(({ data }) => setStatuses(data.statuses)).catch(() => {});
    api.get('/projects/tags').then(({ data }) => setAllTags(data.tags)).catch(() => {});
    if (isStaff) api.get('/users/assignable').then(({ data }) => setUsers(data.users)).catch(() => {});
    loadCounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey, pager.page, pager.limit]);

  const statusOf = (name) => statuses.find((s) => s.name === name);
  const toggle = (id) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <div className="mx-auto max-w-[1280px]">
      <section className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title max-md:text-2xl">Projects</h1>
          <p className="mt-1 text-sm text-navy-400">{pager.total} {pager.total === 1 ? 'project' : 'projects'} in this list</p>
        </div>
        {canCreate && (
          <Link
            to="/projects/new"
            className="inline-flex h-10 items-center gap-2 rounded-md px-4 text-sm font-semibold hover:opacity-90 max-sm:min-h-[44px]"
            style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-on-accent)' }}
          >
            New project
          </Link>
        )}
      </section>

      <AttentionTiles counts={counts} active={filters.attention} onPick={(kind) => setFilters((f) => ({ ...pickTile(f, kind) }))} />

      <div className="mt-5 flex flex-wrap items-center gap-2" role="toolbar" aria-label="Filter projects">
        {PILLS.map((p) => (
          <Pill key={p.id} on={filters.pill === p.id} onClick={() => change({ pill: p.id })}>{p.label}</Pill>
        ))}
        <span className="flex-1" />
        <CompanyFilter value={filters.companyId} onChange={(companyId) => change({ companyId })} className="input h-8 text-[13px]" />
        <TagsMenu allTags={allTags} value={filters.tag} onChange={setTag} />
        <input
          type="search"
          value={filters.search}
          onChange={(e) => change({ search: e.target.value })}
          placeholder="Find a project"
          aria-label="Find a project"
          className="input h-8 w-56 text-[13px] max-sm:w-full"
        />
      </div>

      {error && <div role="alert" className="mt-4 rounded-md bg-red-50 p-4 text-red-700">{error}</div>}
      {selected.size > 0 && isStaff && (
        <BulkBar ids={[...selected]} statuses={statuses} users={users} onClear={() => setSelected(new Set())} onDone={() => { setSelected(new Set()); load(); loadCounts(); }} />
      )}

      <div className="mt-4 overflow-hidden rounded-xl border border-navy-100 bg-surface" role="table" aria-label="Projects">
        <div role="row" className="grid gap-x-4 px-5 py-3 text-xs font-semibold text-navy-400 max-lg:hidden" style={{ gridTemplateColumns: COLUMNS }}>
          {HEADS.map((h) => <span key={h} role="columnheader">{h}</span>)}
        </div>
        {loading ? (
          <div className="flex justify-center p-10"><Spinner /></div>
        ) : projects.length === 0 ? (
          <p className="border-t border-navy-100 p-8 text-center text-navy-400">No projects match.</p>
        ) : projects.map((p) => {
          const st = statusOf(p.status);
          return (
            <ProjectRow
              key={p.id}
              project={p}
              statusColor={p.statusColor || st?.color}
              closed={st?.behaviorType === 'closed'}
              selectable={isStaff}
              selected={selected.has(p.id)}
              onToggle={() => toggle(p.id)}
            />
          );
        })}
      </div>

      {!loading && projects.length > 0 && (
        <Pagination
          page={pager.page}
          limit={pager.limit}
          total={pager.total}
          totalPages={pager.totalPages}
          onPageChange={(next) => { pager.setPage(next); setSelected(new Set()); }}
          onLimitChange={(next) => { pager.setLimit(next); setSelected(new Set()); }}
        />
      )}
    </div>
  );
}
