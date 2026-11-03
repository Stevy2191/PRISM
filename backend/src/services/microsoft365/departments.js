// Detected departments (client portal 7b): the department names Microsoft 365
// reports for a company's sync-group members, matched to PRISM departments of
// that company. A name matches a department with the same name (trimmed,
// spaces collapsed, any case); one that doesn't is a DetectedDepartment row,
// a to-do item, until staff create a department from it or map it to one.
// Mapped and created names then resolve on every sync, and Microsoft 365
// wins: a contact's hand-set department is replaced once their name resolves.
const { Department, DetectedDepartment, Contact } = require('../../models');

const normalizeDepartmentName = (name) => String(name || '').trim().replace(/\s+/g, ' ').toLowerCase();
const stripSuffixes = (name) => normalizeDepartmentName(name).replace(/[.,]/g, ' ').replace(/\b(dept|department)\b/g, ' ').replace(/\s+/g, ' ')
  .trim();

// The "Looks like Billing" hint only: same name once "dept"/"department" go.
function suggestMapping(detected, departments) {
  const key = stripSuffixes(detected.name);
  if (!key) return null;
  const match = departments.find((d) => stripSuffixes(d.name) === key);
  return match ? match.id : null;
}

// name → departmentId|null for one company, loading its departments and
// detected rows once (a sync resolves many names).
async function departmentResolver(companyId) {
  const [departments, rows] = await Promise.all([
    Department.findAll({ where: { companyId }, attributes: ['id', 'name'] }),
    DetectedDepartment.findAll({ where: { companyId } }),
  ]);
  const byName = new Map(departments.map((d) => [normalizeDepartmentName(d.name), d.id]));
  const ids = new Set(departments.map((d) => d.id));
  const mapped = new Map(rows.filter((r) => r.mappedDepartmentId && ids.has(r.mappedDepartmentId)).map((r) => [r.normalized, r.mappedDepartmentId]));
  return (name) => {
    const key = normalizeDepartmentName(name);
    if (!key) return null;
    return byName.get(key) || mapped.get(key) || null;
  };
}

// One name for one company. An unknown name is recorded as detected.
async function resolveDepartment(companyId, msDepartmentName) {
  const key = normalizeDepartmentName(msDepartmentName);
  if (!key) return null;
  const id = (await departmentResolver(companyId))(key);
  if (id) return id;
  await DetectedDepartment.findOrCreate({
    where: { companyId, normalized: key },
    defaults: { name: String(msDepartmentName).trim().replace(/\s+/g, ' ').slice(0, 150), peopleCount: 1 },
  });
  return null;
}

// Rebuilds a company's detected list from every sync-group member's
// department name (members: Graph users). Names that now match a department
// drop off; names nobody has any more drop off unless mapped (a mapping
// stays useful). → how many new to-do names appeared.
async function recountDetected(companyId, members) {
  const counts = new Map(); // normalized → { name, count }
  for (const user of members) {
    const key = normalizeDepartmentName(user.department);
    if (key) {
      const entry = counts.get(key) || { name: String(user.department).trim().replace(/\s+/g, ' ').slice(0, 150), count: 0 };
      entry.count += 1;
      counts.set(key, entry);
    }
  }
  const departments = await Department.findAll({ where: { companyId }, attributes: ['name'] });
  const existing = new Set(departments.map((d) => normalizeDepartmentName(d.name)));
  const rows = await DetectedDepartment.findAll({ where: { companyId } });
  const rowByKey = new Map(rows.map((r) => [r.normalized, r]));
  let created = 0;

  for (const row of rows) {
    const seen = counts.get(row.normalized);
    if (existing.has(row.normalized) || (!seen && !row.mappedDepartmentId)) await row.destroy(); // eslint-disable-line no-await-in-loop
    else if (!seen && row.peopleCount !== 0) await row.update({ peopleCount: 0 }); // eslint-disable-line no-await-in-loop
  }
  for (const [key, { name, count }] of counts) {
    if (!existing.has(key)) {
      const row = rowByKey.get(key);
      if (row) {
        if (row.peopleCount !== count) await row.update({ peopleCount: count }); // eslint-disable-line no-await-in-loop
      } else {
        await DetectedDepartment.create({ companyId, name, normalized: key, peopleCount: count }); // eslint-disable-line no-await-in-loop
        created += 1;
      }
    }
  }
  return created;
}

// Gives the company's Microsoft-linked contacts the department their
// Microsoft 365 name resolves to (replacing a hand-set one). The Contact
// afterUpdate hook prunes department-admin roles that no longer match.
// → how many contacts changed department.
async function applyDepartments(companyId) {
  const resolve = await departmentResolver(companyId);
  const contacts = await Contact.findAll({ where: { companyId }, attributes: ['id', 'companyId', 'departmentId', 'msObjectId', 'msDepartmentName'] });
  let changed = 0;
  for (const contact of contacts) {
    const id = contact.msObjectId ? resolve(contact.msDepartmentName) : null;
    if (id && id !== contact.departmentId) {
      await contact.update({ departmentId: id }); // eslint-disable-line no-await-in-loop
      changed += 1;
    }
  }
  return changed;
}

module.exports = {
  normalizeDepartmentName, suggestMapping, departmentResolver, resolveDepartment, recountDetected, applyDepartments,
};
