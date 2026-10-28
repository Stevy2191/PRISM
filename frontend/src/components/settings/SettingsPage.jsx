// The one layout every Settings page shares (spec: Settings redesign): a
// breadcrumb, the title and description (from the registry unless given),
// an actions slot, then panels.
import { useLocation } from 'react-router-dom';
import Breadcrumbs from '../ui/Breadcrumbs';
import { findPage, sectionByName } from '../../pages/settings/registry';

export default function SettingsPage({ title, description, actions, width, children }) {
  const { pathname } = useLocation();
  const entry = findPage(pathname);
  const w = width || entry?.width || 'narrow';
  return (
    <div className={`space-y-5 ${w === 'narrow' ? 'max-w-3xl' : ''}`}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Breadcrumbs className="mb-1" items={entry ? [{ label: 'Settings', to: '/settings' }, { label: entry.group, to: `/settings?section=${sectionByName(entry.group)?.slug}`, current: false }] : [{ label: 'Settings', to: '/settings', current: false }]} />
          <h1 className="page-title">{title || entry?.name}</h1>
          {(description || entry?.desc) && <p className="mt-1 text-sm text-navy-500">{description || entry?.desc}</p>}
        </div>
        {actions && <div className="flex flex-shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </header>
      {children}
    </div>
  );
}

export function SettingsPanel({ title, description, actions, children }) {
  return (
    <section className="card" aria-label={title}>
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-navy-100 px-5 py-4">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-navy-900">{title}</h2>
          {description && <p className="text-xs text-navy-400">{description}</p>}
        </div>
        {actions}
      </div>
      <div className="divide-y divide-navy-100">{children}</div>
    </section>
  );
}

export function SettingsRow({ label, htmlFor, help, children }) {
  return (
    <div className="grid grid-cols-1 gap-2 px-5 py-4 sm:grid-cols-[220px_minmax(0,1fr)] sm:gap-6">
      <div>
        <label htmlFor={htmlFor} className="block text-sm font-semibold text-navy-900">{label}</label>
        {help && <p className="mt-0.5 text-xs text-navy-400">{help}</p>}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
