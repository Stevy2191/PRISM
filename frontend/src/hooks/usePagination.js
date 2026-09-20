import { useCallback, useEffect, useRef, useState } from 'react';

// Pagination state for a list page.
//
// The subtle part this exists to get right: when a filter changes, the page
// must snap back to 1. Otherwise narrowing a filter while on page 4 leaves you
// staring at an empty table that looks like "no results" — the results are
// there, just on page 1. `filterKey` is a string describing the current
// filters; whenever it changes, the page resets.
export function usePagination({ filterKey = '', defaultLimit = 50, storageKey } = {}) {
  const [limit, setLimitState] = useState(() => {
    if (!storageKey) return defaultLimit;
    // Page size is a per-person preference worth remembering, unlike the page
    // number, which belongs to a single visit.
    const stored = Number(localStorage.getItem(storageKey));
    return Number.isFinite(stored) && stored > 0 ? stored : defaultLimit;
  });
  const [page, setPage] = useState(1);
  const [meta, setMeta] = useState({ total: 0, totalPages: 1 });

  // Skip the reset on first render — the list hasn't been fetched yet, and
  // resetting here would be a no-op that still costs a render.
  const lastFilterKey = useRef(filterKey);
  useEffect(() => {
    if (lastFilterKey.current !== filterKey) {
      lastFilterKey.current = filterKey;
      setPage(1);
    }
  }, [filterKey]);

  const setLimit = useCallback((next) => {
    setLimitState(next);
    setPage(1);
    if (storageKey) localStorage.setItem(storageKey, String(next));
  }, [storageKey]);

  // Call with the response body of a paginated endpoint.
  const applyMeta = useCallback((data) => {
    setMeta({ total: data?.total ?? 0, totalPages: data?.totalPages ?? 1 });
    // A delete that empties the last page would otherwise strand the user on
    // a page that no longer exists.
    if (data?.totalPages && data.totalPages < page) setPage(data.totalPages);
  }, [page]);

  return {
    page, setPage, limit, setLimit,
    total: meta.total, totalPages: meta.totalPages,
    applyMeta,
    // Spread straight into an axios `params` object.
    params: { page, limit },
  };
}
