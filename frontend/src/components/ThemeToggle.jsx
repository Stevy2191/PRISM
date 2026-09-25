import { IconMoon, IconSun } from '@tabler/icons-react';
import { useTheme } from '../context/ThemeContext';

// One-click light/dark switch for the nav bars. Flips whatever is currently
// showing, so from "system" it pins the opposite of what the OS resolved to;
// "system" itself stays in Account Preferences. The icon is the mode you'd
// switch TO, the usual convention for a two-state toggle.
//
// `className` carries each nav's own button sizing; `renderTooltip(label)` lets
// the compact sidebar put its hover tooltip inside the button in place of the
// native title.
export default function ThemeToggle({ className, renderTooltip }) {
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const label = isDark ? 'Switch to light mode' : 'Switch to dark mode';

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      className={className}
      style={{ color: 'var(--color-text-secondary)' }}
      title={renderTooltip ? undefined : label}
      aria-label={label}
    >
      {isDark ? <IconSun size={18} stroke={1.8} /> : <IconMoon size={18} stroke={1.8} />}
      {renderTooltip?.(label)}
    </button>
  );
}
