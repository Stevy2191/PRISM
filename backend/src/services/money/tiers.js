// Support tiers (Phase 3, step 1): Full, Light or Not covered. A contact's
// own tier wins; else a Microsoft 365 frontline license makes them Light;
// else their department's default; else Full.
const { Contact, Department } = require('../../models');

const TIERS = ['full', 'light', 'none'];

function effectiveTier(contact, department) {
  if (contact.supportTier) return contact.supportTier;
  if (contact.m365Frontline) return 'light';
  if (department && department.defaultSupportTier) return department.defaultSupportTier;
  return 'full';
}

// { full, light, none } over a company's active people (not placeholders).
async function tierCounts(companyId) {
  const people = await Contact.findAll({
    where: { companyId, status: 'active', isPlaceholder: false },
    attributes: ['id', 'supportTier', 'm365Frontline', 'departmentId'],
    include: [{ model: Department, as: 'department', attributes: ['id', 'defaultSupportTier'] }],
  });
  const counts = { full: 0, light: 0, none: 0 };
  people.forEach((p) => { counts[effectiveTier(p, p.department)] += 1; });
  return counts;
}

module.exports = { TIERS, effectiveTier, tierCounts };
