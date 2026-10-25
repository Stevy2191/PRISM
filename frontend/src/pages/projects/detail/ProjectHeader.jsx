// The project page header: breadcrumb, name (click to rename), status, client
// and lead, and the actions (timer, Add task, a "more" menu).
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { IconDots, IconPlus, IconFileText, IconPencil, IconTrash } from '@tabler/icons-react';
import CompanyTag from '../../../components/companies/CompanyTag';
import TimerButton from '../../../components/work/TimerButton';
import Button from '../../../components/ui/Button';
import StatusChip from '../../../components/ui/StatusChip';
import Tag from '../../../components/ui/Tag';
import { dateRange } from './taskFilters';

function MoreMenu({ items }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  if (items.length === 0) return null;
  return (
    <div className="relative" ref={ref}>
      <Button variant="icon" aria-label="More actions" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <IconDots size={18} />
      </Button>
      {open && (
        <div role="menu" className="absolute right-0 top-11 z-20 min-w-[180px] rounded-lg border border-navy-100 bg-surface p-1 shadow-lg">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              onClick={() => { setOpen(false); item.onClick(); }}
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-[var(--color-hover)]"
              style={item.danger ? { color: 'var(--color-danger)' } : undefined}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ProjectHeader({
  project, statusMeta, canEdit, isStaff, canLogTime, canDelete, patchProject, onStopRequest, onAddTask, onReport, onDelete,
}) {
  const navigate = useNavigate();
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');

  const startRename = () => { setNameDraft(project.name); setEditingName(true); };
  const saveName = async () => {
    if (nameDraft.trim() && nameDraft.trim() !== project.name) await patchProject({ name: nameDraft.trim() });
    setEditingName(false);
  };

  // Save as template joins this menu when templates exist (sub-project 6, later).
  const menu = [];
  if (canEdit) menu.push({ label: 'Rename', icon: <IconPencil size={15} />, onClick: startRename });
  if (isStaff) menu.push({ label: 'Generate report', icon: <IconFileText size={15} />, onClick: onReport });
  if (canDelete) menu.push({ label: 'Delete', icon: <IconTrash size={15} />, onClick: onDelete, danger: true });

  return (
    <>
      <nav aria-label="Breadcrumb" className="flex gap-1.5 text-[13px] text-navy-400">
        <Link to="/projects" className="hover:underline" style={{ color: 'var(--color-accent)' }}>Projects</Link>
        <span>/</span>
        <span className="num">{project.projectCode}</span>
      </nav>
      <section className="mt-2 flex flex-wrap items-end justify-between gap-6">
        <div className="min-w-0">
          {editingName ? (
            <input
              autoFocus
              aria-label="Project name"
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={saveName}
              onKeyDown={(e) => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') setEditingName(false); }}
              className="input max-w-md text-xl font-semibold"
            />
          ) : (
            <h1
              className={`page-title ${canEdit ? 'cursor-text' : ''} max-md:text-2xl`}
              onClick={canEdit ? startRename : undefined}
              title={canEdit ? 'Click to rename' : undefined}
            >
              {project.name}
            </h1>
          )}
          <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-navy-500">
            <StatusChip tone={statusMeta?.behaviorType === 'closed' ? 'neutral' : 'info'}>{project.status}</StatusChip>
            <CompanyTag company={project.company} />
            {project.ownerDepartment?.name && <span>{project.ownerDepartment.name}</span>}
            <span>Lead: {project.lead?.displayName || 'none'}</span>
            <span>{project.dueDate ? `Due ${dateRange(null, project.dueDate)}` : 'No due date'}</span>
          </div>
          {project.tags?.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {project.tags.map((tag) => (
                <button key={tag} type="button" onClick={() => navigate(`/projects?tag=${encodeURIComponent(tag)}`)} className="hover:opacity-75">
                  <Tag>{tag}</Tag>
                </button>
              ))}
            </div>
          )}
        </div>
        {isStaff && (
          <div className="flex flex-shrink-0 items-center gap-2">
            {canLogTime && (
              <TimerButton kind="project" parentId={project.id} label={`${project.projectCode} ${project.name}`} onStopRequest={onStopRequest} anyTask />
            )}
            {canEdit && (
              <Button variant="primary" onClick={onAddTask}>
                <IconPlus size={14} />
                Add task
              </Button>
            )}
            <MoreMenu items={menu} />
          </div>
        )}
      </section>
    </>
  );
}
