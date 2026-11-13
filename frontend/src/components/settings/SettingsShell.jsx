// Every Settings page renders in here (layout B, 2026-10-28): the section
// rail on the left, the page on the right. Under md there is no rail:
// Settings home lists the sections, then a section's pages, and a page links
// back to its section.
import { useEffect } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { IconChevronLeft } from '@tabler/icons-react';
import { findPage, sectionByName } from '../../pages/settings/registry';
import SettingsMenu from './SettingsMenu';
import { rememberSection } from './sectionIcons';

export default function SettingsShell() {
  const { pathname } = useLocation();
  // A new page opens at its top (the menu is how you move between pages).
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  const section = sectionByName(findPage(pathname)?.group);
  // Settings reopens on the section of the page last used.
  useEffect(() => { if (section) rememberSection(section.slug); }, [section]);

  return (
    // The whole width of the window, from the left (owner, 2026-11-13: it sat
    // in the middle with half the page empty), and nothing here scrolls on
    // its own: the menu is as tall as it needs and moves with the page.
    <div className="flex gap-6 lg:gap-8 lg:px-2">
      <aside aria-label="Settings menu" className="hidden w-[272px] flex-shrink-0 self-start md:block">
        <div className="rounded-xl border border-navy-100 bg-surface p-2.5">
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
