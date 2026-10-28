// Every Settings page renders in here (layout B, 2026-10-28): the section
// rail on the left, the page on the right. Under md there is no rail:
// Settings home lists the sections, then a section's pages, and a page links
// back to its section.
import { useEffect } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { IconChevronLeft } from '@tabler/icons-react';
import { useNavStyle } from '../../context/NavStyleContext';
import { findPage, sectionByName } from '../../pages/settings/registry';
import SettingsMenu from './SettingsMenu';
import { rememberSection } from './sectionIcons';

export default function SettingsShell() {
  const { navStyle } = useNavStyle();
  const { pathname } = useLocation();
  // A new page opens at its top (the menu is how you move between pages).
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  // Below the fixed top bar (56px) or beside the compact sidebar.
  const top = navStyle === 'sidebar' ? 16 : 72;
  const section = sectionByName(findPage(pathname)?.group);
  // Settings reopens on the section of the page last used.
  useEffect(() => { if (section) rememberSection(section.slug); }, [section]);

  return (
    <div className="mx-auto flex max-w-[1320px] gap-6 lg:gap-8 lg:px-6">
      <aside aria-label="Settings menu" className="hidden w-[272px] flex-shrink-0 md:block">
        <div className="sticky overflow-y-auto rounded-xl border border-navy-100 bg-surface p-2.5"
          style={{ top, maxHeight: `calc(100vh - ${top + 16}px)` }}>
          <SettingsMenu />
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        {section && (
          <Link to={`/settings?section=${section.slug}`} aria-label={`Back to ${section.name}`}
            className="mb-3 inline-flex min-h-[44px] items-center gap-1 text-sm font-semibold md:hidden" style={{ color: 'var(--color-accent)' }}>
            <IconChevronLeft size={16} aria-hidden="true" />{section.name}
          </Link>
        )}
        <Outlet />
      </div>
    </div>
  );
}
