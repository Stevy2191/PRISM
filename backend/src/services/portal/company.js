// Each company has its own portal (CS part 3) at /portal/<slug>. Its contacts
// sign in there and nowhere else; the portal is open only while the company is
// active and its portal is switched on.
const { Op } = require('sequelize');

// Words a slug can't be: the portal's own pages at /portal/..., and the API's.
const RESERVED = new Set(['api', 'c', 'link', 'home', 'sign-in', 'forgot', 'reset', 'welcome', 'tickets', 'kb', 'new', 'portal', 'admin', 'settings']);
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/;
const MAX = 50;

function slugify(name) {
  const s = String(name || '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX)
    .replace(/-+$/g, '');
  return s && !RESERVED.has(s) ? s : (s ? `${s}-portal` : 'company');
}

const isValidSlug = (s) => typeof s === 'string' && SLUG_RE.test(s) && !RESERVED.has(s);

// Every link in use, current or previous, by companies other than exceptId.
async function slugsInUse(Company, { exceptId, transaction } = {}) {
  const rows = await Company.findAll({
    where: exceptId ? { id: { [Op.ne]: exceptId } } : {}, attributes: ['id', 'portalSlug', 'portalPreviousSlugs'], transaction,
  });
  return new Set(rows.flatMap((r) => [r.portalSlug, ...r.portalPreviousSlugs]).filter(Boolean));
}

// A slug for `name` no other company has: acme, acme-2, acme-3...
async function uniqueSlug(Company, name, { exceptId, transaction } = {}) {
  const base = slugify(name);
  const taken = await slugsInUse(Company, { exceptId, transaction });
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const tail = `-${n}`;
    const candidate = `${base.slice(0, MAX - tail.length).replace(/-+$/g, '')}${tail}`;
    if (!taken.has(candidate)) return candidate;
  }
}

const portalOpen = (company) => !!company && company.portalEnabled === true && company.status === 'active';

function models() {
  return require('../../models'); // eslint-disable-line global-require
}

// The company at /portal/<slug>: its current link, or one it had before.
async function findBySlug(slug) {
  if (!isValidSlug(slug)) return null;
  const { Company, sequelize } = models();
  return (await Company.findOne({ where: { portalSlug: slug } }))
    || Company.findOne({ where: sequelize.where(sequelize.fn('JSON_CONTAINS', sequelize.col('portalPreviousSlugs'), JSON.stringify(slug)), 1) });
}

// The company the plain /portal address stands for: your own, while there is
// no customer company. Otherwise none: each company uses its own link.
async function impliedCompany() {
  const { Company } = models();
  if (await Company.count({ where: { isInternal: false, isClient: true } })) return null;
  return Company.findOne({ where: { isInternal: true } });
}

module.exports = {
  slugify, isValidSlug, uniqueSlug, slugsInUse, portalOpen, findBySlug, impliedCompany, RESERVED,
};
