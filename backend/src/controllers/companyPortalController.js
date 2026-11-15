// A company's own portal and surveys (CS part 3), on its page under Setup:
//   GET  /companies/:id/portal              the switch, its link, who can sign in
//   PUT  /companies/:id/portal              { enabled?, slug? }       portal.manage
//   POST /companies/:id/portal/invite-all   invite every contact without access
//   PUT  /companies/:id/surveys             { enabled }               System settings
const { Op } = require('sequelize');
const {
  sequelize, Contact, Department, PortalToken, DepartmentPortalAdmin,
} = require('../models');
const { asyncHandler, ApiError } = require('../middleware/error');
const { writeAudit } = require('../middleware/audit');
const { hasPermission } = require('../services/permissionService');
const { loadAccessibleCompany } = require('./companiesController');
const {
  isValidSlug, slugsInUse, portalOpen,
} = require('../services/portal/company');
const { portalUrl, sendPortalLink } = require('../services/portal/portalMail');
const { issuePortalToken } = require('../services/portal/tokens');
const { signInMethod } = require('../services/portal/signInMethod');

const MAX_PREVIOUS = 10;
const MAX_LISTED = 500;
const SCORE_DAYS = 90;

// The company's surveys over the last 90 days: sent, answered, average (1-5).
async function surveyScores(companyId) {
  const [row] = await sequelize.query(
    `SELECT COUNT(s.sentAt) AS sent, COUNT(s.respondedAt) AS answered, AVG(s.rating) AS average
       FROM CsatSurveys s JOIN Tickets t ON t.id = s.ticketId
      WHERE t.companyId = :companyId AND s.createdAt >= :since`,
    { replacements: { companyId, since: new Date(Date.now() - SCORE_DAYS * 86400000) }, type: sequelize.QueryTypes.SELECT },
  );
  return {
    days: SCORE_DAYS,
    sent: Number(row.sent) || 0,
    answered: Number(row.answered) || 0,
    average: row.average === null ? null : Math.round(Number(row.average) * 10) / 10,
  };
}

async function assertCan(req, permission, message) {
  if (!(await hasPermission(req.user.id, permission))) throw new ApiError(403, message, 'FORBIDDEN');
}

const displayName = (c) => c.displayName || [c.firstName, c.lastName].filter(Boolean).join(' ') || c.email || '';

async function present(req, company) {
  const contacts = await Contact.scope('withPassword').findAll({
    where: { companyId: company.id, status: 'active' },
    attributes: ['id', 'firstName', 'lastName', 'displayName', 'email', 'portalAccess', 'portalLastSignInAt', 'passwordHash', 'msObjectId', 'departmentId'],
    include: [{ model: Department, as: 'department', attributes: ['id', 'name'] }],
    order: [['lastName', 'ASC'], ['firstName', 'ASC'], ['id', 'ASC']],
    limit: MAX_LISTED,
  });
  const ids = contacts.map((c) => c.id);
  const invites = ids.length ? await PortalToken.findAll({
    where: { contactId: ids, kind: 'invite', usedAt: null, expiresAt: { [Op.gt]: new Date() } },
    attributes: ['contactId', 'createdAt'], order: [['createdAt', 'ASC']], raw: true,
  }) : [];
  const invitedAt = new Map(invites.map((t) => [t.contactId, t.createdAt]));
  const deptAdmins = await DepartmentPortalAdmin.findAll({
    include: [
      { model: Department, as: 'department', attributes: ['id', 'name'], where: { companyId: company.id }, required: true },
      { model: Contact, as: 'contact', attributes: ['id', 'firstName', 'lastName', 'displayName', 'email'] },
    ],
  }).catch(() => []);
  return {
    portal: {
      enabled: company.portalEnabled === true,
      open: portalOpen(company),
      slug: company.portalSlug,
      url: portalUrl(company),
      previousSlugs: company.portalPreviousSlugs,
      surveys: company.csatEnabled === true,
    },
    surveyScores: await surveyScores(company.id),
    contacts: contacts.map((c) => ({
      id: c.id,
      name: displayName(c),
      email: c.email || null,
      department: c.department ? c.department.name : null,
      portalAccess: c.portalAccess === true,
      signInMethod: signInMethod(c),
      lastSignInAt: c.portalLastSignInAt,
      invitedAt: invitedAt.get(c.id) || null,
    })),
    departmentAdmins: deptAdmins.filter((a) => a.contact).map((a) => ({
      departmentId: a.department.id, department: a.department.name, contactId: a.contact.id, name: displayName(a.contact),
    })),
    canManage: await hasPermission(req.user.id, 'portal.manage'),
    canChangeSurveys: await hasPermission(req.user.id, 'settings.manage_system'),
  };
}

const get = asyncHandler(async (req, res) => {
  const company = await loadAccessibleCompany(req);
  res.json(await present(req, company));
});

// PUT { enabled?, slug? }. A new link keeps the old one working.
const save = asyncHandler(async (req, res) => {
  await assertCan(req, 'portal.manage', "Changing a company's portal needs the Manage portal access permission");
  const company = await loadAccessibleCompany(req);
  const body = req.body || {};
  const changes = {};
  if (body.enabled !== undefined) {
    if (typeof body.enabled !== 'boolean') throw new ApiError(400, 'enabled must be true or false', 'VALIDATION_ERROR');
    changes.portalEnabled = body.enabled;
  }
  if (body.slug !== undefined) {
    const slug = String(body.slug || '').trim().toLowerCase();
    if (!isValidSlug(slug)) {
      throw new ApiError(400, 'Use 1 to 50 lowercase letters, numbers and dashes, starting and ending with a letter or number', 'VALIDATION_ERROR');
    }
    if (slug !== company.portalSlug) {
      if ((await slugsInUse(company.constructor, { exceptId: company.id })).has(slug)) {
        throw new ApiError(409, 'Another company already uses that link', 'SLUG_TAKEN');
      }
      const previous = [company.portalSlug, ...company.portalPreviousSlugs].filter((s) => s && s !== slug);
      changes.portalSlug = slug;
      changes.portalPreviousSlugs = [...new Set(previous)].slice(0, MAX_PREVIOUS);
    }
  }
  if (Object.keys(changes).length) {
    const before = { enabled: company.portalEnabled, slug: company.portalSlug };
    await company.update(changes);
    await writeAudit(req, 'company.portal', 'Company', company.id, {
      before, after: { enabled: company.portalEnabled, slug: company.portalSlug },
    });
  }
  res.json(await present(req, company));
});

// POST — every active contact with an email and no access yet is given
// access and sent an invite. Microsoft-linked contacts sign in with Microsoft
// and get none.
const inviteAll = asyncHandler(async (req, res) => {
  await assertCan(req, 'portal.manage', 'Inviting contacts needs the Manage portal access permission');
  const company = await loadAccessibleCompany(req);
  if (!portalOpen(company)) throw new ApiError(409, `Turn on ${company.name}'s portal first`, 'PORTAL_CLOSED');
  const contacts = await Contact.findAll({
    where: {
      companyId: company.id, status: 'active', portalAccess: false, msObjectId: null, email: { [Op.and]: [{ [Op.ne]: null }, { [Op.ne]: '' }] },
    },
  });
  let invited = 0;
  const failed = [];
  for (const contact of contacts) {
    try {
      const { token } = await issuePortalToken(contact.id, 'invite'); // eslint-disable-line no-await-in-loop
      const sent = await sendPortalLink('invite', contact, company, token); // eslint-disable-line no-await-in-loop
      if (!sent) {
        await PortalToken.update({ usedAt: new Date() }, { where: { contactId: contact.id, kind: 'invite', usedAt: null } }); // eslint-disable-line no-await-in-loop
        throw new ApiError(409, 'The "Portal invite" email template is switched off (Settings → Email templates)', 'TEMPLATE_DISABLED');
      }
      await contact.update({ portalAccess: true }); // eslint-disable-line no-await-in-loop
      await writeAudit(req, 'portal.invite_sent', 'Contact', contact.id, { email: contact.email, via: 'invite-all' }); // eslint-disable-line no-await-in-loop
      invited += 1;
    } catch (err) {
      if (err.code === 'TEMPLATE_DISABLED') throw err;
      await PortalToken.update({ usedAt: new Date() }, { where: { contactId: contact.id, kind: 'invite', usedAt: null } }); // eslint-disable-line no-await-in-loop
      failed.push({ contactId: contact.id, message: err.message });
    }
  }
  res.json({ invited, failed, ...(await present(req, company)) });
});

const surveys = asyncHandler(async (req, res) => {
  await assertCan(req, 'settings.manage_system', "Changing a company's surveys needs the System settings permission");
  const company = await loadAccessibleCompany(req);
  const { enabled } = req.body || {};
  if (typeof enabled !== 'boolean') throw new ApiError(400, 'enabled must be true or false', 'VALIDATION_ERROR');
  if (enabled !== company.csatEnabled) {
    await company.update({ csatEnabled: enabled });
    await writeAudit(req, 'company.surveys', 'Company', company.id, { enabled });
  }
  res.json(await present(req, company));
});

module.exports = {
  get, save, inviteAll, surveys,
};
