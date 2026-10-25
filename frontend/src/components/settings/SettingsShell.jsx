// Every Settings page renders in here (spec: Settings redesign): the menu on
// the left, the page on the right. Under md the menu is behind a
// "Settings menu" button, as a full-screen sheet.
import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { IconChevronDown, IconX } from '@tabler/icons-react';
import { useNavStyle } from '../../context/NavStyleContext';
import { findPage } from '../../pages/settings/registry';
import SettingsMenu from './SettingsMenu';

export default function SettingsShell() {
  const { navStyle } = useNavStyle();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  // A new page opens at its top (the menu is how you move between pages).
  useEffect(() => { setOpen(false); window.scrollTo(0, 0); }, [pathname]);
  // Below the fixed top bar (56px) or beside the compact sidebar.
  const top = navStyle === 'sidebar' ? 16 : 72;
  const here = findPage(pathname)?.name || 'Settings home';

  return (
    <div className="flex gap-6 lg:gap-8">
      <aside aria-label="Settings menu" className="hidden w-[232px] flex-shrink-0 md:block">
        <div className="sticky overflow-y-auto rounded-md border p-2.5"
          style={{ top, maxHeight: `calc(100vh - ${top + 16}px)`, backgroundColor: 'var(--color-sidebar)', borderColor: 'var(--color-border)' }}>
          <SettingsMenu />
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        <button type="button" aria-label={`Settings menu: ${here}`} onClick={() => setOpen(true)}
          className="mb-4 flex w-full items-center justify-between rounded-md border px-3 py-2 text-sm font-medium md:hidden"
          style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-card)' }}>
          <span>Settings · {here}</span><IconChevronDown size={16} />
        </button>
        <Outlet />
      </div>
      {open && (
        <div role="dialog" aria-modal="true" aria-label="Settings menu" className="fixed inset-0 z-50 overflow-y-auto p-4 md:hidden"
          style={{ backgroundColor: 'var(--color-bg)' }}>
          <div className="mb-3 flex items-center justify-between">
            <p className="font-semibold">Settings</p>
            <button type="button" aria-label="Close the settings menu" onClick={() => setOpen(false)}><IconX size={20} /></button>
          </div>
          <SettingsMenu onNavigate={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}
