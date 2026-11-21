// Pages load on demand (React.lazy), so the first screen doesn't download
// the whole app. Each build names its files by their content, so after an
// upgrade an open tab asks for files that no longer exist: that import fails.
// The app then reloads once to pick up the new build. If the page still
// can't load right after that, the error shows rather than reloading forever.
import { lazy } from 'react';

export const RELOAD_KEY = 'prism.reloadedForUpdate';
// A reload mark older than this is from an earlier upgrade, not this one.
const RECENT_MS = 30 * 1000;

const defaultStorage = () => {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
};

export async function loadOrReload(importer, {
  storage = defaultStorage(), reload = () => window.location.reload(),
} = {}) {
  try {
    const mod = await importer();
    try { storage?.removeItem(RELOAD_KEY); } catch { /* storage unavailable */ }
    return mod;
  } catch (err) {
    let reloadedRecently = true;
    try {
      const at = Number(storage?.getItem(RELOAD_KEY));
      reloadedRecently = !storage || (at > 0 && Date.now() - at < RECENT_MS);
      if (!reloadedRecently) storage.setItem(RELOAD_KEY, String(Date.now()));
    } catch {
      // No storage (private mode): we couldn't tell a second failure from the
      // first, so never reload; the error shows instead.
      reloadedRecently = true;
    }
    if (reloadedRecently) throw err;
    reload();
    // Keep the page suspended while the browser reloads.
    return new Promise(() => {});
  }
}

// lazy() with the reload-once behaviour above.
export function lazyPage(importer) {
  return lazy(() => loadOrReload(importer));
}
