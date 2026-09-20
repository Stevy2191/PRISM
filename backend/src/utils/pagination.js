// Shared offset pagination for list endpoints.
//
// Every paginated endpoint answers in the same shape the audit log has used
// since it was built — the collection under its own key, plus flat metadata
// siblings:
//
//   { tickets: [...], page: 2, limit: 50, total: 2431, totalPages: 49 }
//
// Callers that send no ?page get page 1 at DEFAULT_LIMIT rather than the whole
// table. API-key integrations that genuinely need everything can pass
// ?limit=all, which is still bounded (MAX_LIMIT_ALL) so no single query can
// ever try to serialize an unbounded result set.

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
// Ceiling for the ?limit=all escape hatch. High enough to cover a full export
// for a mid-sized install, low enough that it can't take the process down.
const MAX_LIMIT_ALL = 5000;

function toInt(value, fallback) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

// Reads ?page / ?limit off the request and normalizes them.
//
//   defaultLimit — page size when the caller doesn't ask for one
//   maxLimit     — ceiling on an explicit ?limit
//   allowAll     — whether ?limit=all is honoured on this endpoint
//
// Returns { page, limit, offset, all }. `all` is informational — `limit` and
// `offset` are always set to values you can hand straight to Sequelize, so a
// handler never needs to branch on it.
function parsePagination(req, options = {}) {
  const {
    defaultLimit = DEFAULT_LIMIT,
    maxLimit = MAX_LIMIT,
    allowAll = true,
  } = options;

  const rawLimit = req.query?.limit;
  if (allowAll && typeof rawLimit === 'string' && rawLimit.toLowerCase() === 'all') {
    return { page: 1, limit: MAX_LIMIT_ALL, offset: 0, all: true };
  }

  const page = Math.max(1, toInt(req.query?.page, 1));
  const limit = Math.min(maxLimit, Math.max(1, toInt(rawLimit, defaultLimit)));
  return { page, limit, offset: (page - 1) * limit, all: false };
}

// Shapes a findAndCountAll result into the standard response body.
//
// `count` comes back as a number normally, but as an array of group rows when
// the query used `group` — accept both so grouped list endpoints can share
// this helper instead of hand-rolling the metadata.
function paginated(key, { rows, count }, { page, limit }) {
  const total = Array.isArray(count) ? count.length : count;
  return {
    [key]: rows,
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  };
}

module.exports = {
  parsePagination, paginated, DEFAULT_LIMIT, MAX_LIMIT, MAX_LIMIT_ALL,
};
