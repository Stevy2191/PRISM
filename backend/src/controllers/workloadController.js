const { ApiError, asyncHandler } = require('../middleware/error');
const { parseRecordId } = require('../services/permissionService');
const { buildWorkload } = require('../services/workload');
const { isIsoDate } = require('../services/workload/capacity');
const { addDays, isoWeekday } = require('../services/projects/schedule');

const KINDS = ['all', 'tickets', 'tasks'];

// The server's own local date, for a client that sends no (or a junk) `today`.
function serverToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const one = (value) => (Array.isArray(value) ? value[0] : value);
const bad = (message) => new ApiError(400, message, 'VALIDATION_ERROR');

// GET /workload?from=YYYY-MM-DD&days=5|10&today=YYYY-MM-DD&teamId=&kinds=all|tickets|tasks
// "Today" is the client's local date, so the highlighted column matches the
// viewer's calendar however far the server's clock is from them.
const get = asyncHandler(async (req, res) => {
  const q = req.query || {};
  const today = isIsoDate(one(q.today)) ? one(q.today) : serverToday();
  const from = one(q.from) === undefined ? addDays(today, 1 - isoWeekday(today)) : one(q.from);
  if (!isIsoDate(from)) throw bad('from must be a date like 2026-11-02');
  const rawDays = one(q.days);
  const days = rawDays === undefined ? 5 : Number(rawDays);
  if (rawDays !== undefined && !/^(5|10)$/.test(String(rawDays))) throw bad('days must be 5 or 10');
  const kinds = one(q.kinds) === undefined ? 'all' : one(q.kinds);
  if (!KINDS.includes(kinds)) throw bad('kinds must be all, tickets or tasks');
  let teamId = null;
  if (one(q.teamId) !== undefined && one(q.teamId) !== '') {
    teamId = parseRecordId(one(q.teamId));
    if (!teamId) throw bad('teamId is not valid');
  }
  res.json(await buildWorkload(req.user, {
    from, days, today, teamId, kinds,
  }));
});

module.exports = { get };
