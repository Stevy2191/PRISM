import { useNavStyle } from '../context/NavStyleContext';

// Height for pages that fill the window and scroll inside (ticket list, a
// ticket, assets…): the window less the top bar, so nothing sits below the fold.
export function useFullPageHeight() {
  const { navStyle } = useNavStyle();
  return navStyle === 'sidebar' ? '100dvh' : 'calc(100dvh - 56px)';
}
