// Departments for a dropdown, kept with their company so two companies'
// "HR" never look the same. With one company in view (or company features
// off) it's a plain list; otherwise groups by company, the help desk's own
// company first, then the rest by name.
export function departmentGroups(departments, { companyId, multiCompany } = {}) {
  const list = (departments || []).filter((d) => !companyId || String(d.companyId) === String(companyId));
  if (!multiCompany || companyId) return [{ label: null, departments: list }];
  const groups = new Map();
  for (const d of list) {
    const key = d.companyId ?? 'none';
    if (!groups.has(key)) {
      groups.set(key, { label: (d.company && d.company.name) || 'No company', internal: !!(d.company && d.company.isInternal), departments: [] });
    }
    groups.get(key).departments.push(d);
  }
  return [...groups.values()]
    .sort((a, b) => (b.internal - a.internal) || a.label.localeCompare(b.label))
    .map(({ label, departments: ds }) => ({ label, departments: ds }));
}
