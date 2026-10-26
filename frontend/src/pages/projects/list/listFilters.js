// Pure helpers behind the projects list: which query the pills and tiles make.

export const PILLS = [
  { id: 'open', label: 'Open' },
  { id: 'mine', label: "I'm on" },
  { id: 'lead', label: 'I lead' },
  { id: 'closed', label: 'Closed' },
  { id: 'all', label: 'All' },
];

// The query for the list. `today` is the browser's local 'YYYY-MM-DD'.
// `dept` is '' | 'mine' | 'owner:ID' | 'for:ID'; `status` is a status name or ''.
export function deptParams(dept) {
  if (dept === 'mine') return { myDepartment: 'true' };
  const [kind, id] = String(dept || '').split(':');
  if (kind === 'owner' && id) return { ownerDept: id };
  if (kind === 'for' && id) return { forDept: id };
  return {};
}

// What the tiles count with: the same company and department narrowing as the list.
export function tileParams({ companyId, dept, today }) {
  return { today, ...(companyId ? { companyId } : {}), ...deptParams(dept) };
}

export function listParams({
  pill, attention, companyId, tag, search, today, dept = '', status = '',
}) {
  const params = { ...deptParams(dept) };
  if (status) params.status = status;
  if (!status) {
    if (pill === 'closed') params.state = 'closed';
    else if (pill !== 'all') params.state = 'open';
  }
  if (pill === 'mine') params.mine = 'member';
  if (pill === 'lead') params.mine = 'lead';
  if (attention) { params.attention = attention; params.today = today; }
  if (companyId) params.companyId = companyId;
  if (tag) params.tag = tag;
  if (search) params.search = search;
  return params;
}

// A tile shows open projects only, so choosing one leaves Closed behind;
// choosing the same tile again clears it.
export function pickTile(state, kind) {
  if (state.attention === kind) return { ...state, attention: '' };
  return { ...state, attention: kind, pill: state.pill === 'closed' ? 'open' : state.pill };
}

// "74.5" from minutes, one decimal at most, no trailing ".0".
export const hoursText = (minutes) => `${Math.round(((Number(minutes) || 0) / 60) * 10) / 10}`;

// Percent of the budget used, rounded, or null with no budget.
export function budgetPercent(used, budget) {
  if (budget == null || !(Number(budget) > 0)) return null;
  return Math.round(((Number(used) || 0) / Number(budget)) * 100);
}

// A due date is late when it is before today and the project is still open.
// Both are 'YYYY-MM-DD', so a string compare is a date compare.
export const isLate = (dueDate, today, closed) => !!dueDate && !closed && dueDate < today;
