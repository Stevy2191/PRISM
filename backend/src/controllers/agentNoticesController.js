// Help-desk notices for the PRISM agent (migration 088): staff post a short
// notice for one company's computers, or every company's, and take it down.
const { Op } = require('sequelize');
const { AgentNotice, Company, User } = require('../models');
const { ApiError, asyncHandler } = require('../middleware/error');
const { writeAudit } = require('../middleware/audit');
const { canAccessCompany, companyScopeWhere, parseRecordId } = require('../services/permissionService');
const { isEmpty } = require('../services/recordScope');

const line = (v, max) => (typeof v === 'string' ? v.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max + 1) : '');
const seesEveryCompany = async (user) => isEmpty(await companyScopeWhere(user));

const shape = (n) => ({
  id: n.id,
  companyId: n.companyId,
  company: n.company ? { id: n.company.id, name: n.company.name } : null,
  headline: n.headline,
  message: n.message || '',
  expiresAt: n.expiresAt,
  createdAt: n.createdAt,
  author: n.author ? { id: n.author.id, displayName: n.author.displayName } : null,
});
const include = [{ model: Company, as: 'company', attributes: ['id', 'name'] }, { model: User, as: 'author', attributes: ['id', 'displayName'] }];

// GET /agent-notices?companyId= → the notices showing now: that company's
// and the ones for every company.
const list = asyncHandler(async (req, res) => {
  const companyId = parseRecordId(req.query.companyId);
  if (companyId && !(await canAccessCompany(req.user, companyId))) throw new ApiError(404, 'Company not found', 'NOT_FOUND');
  const now = new Date();
  const everyone = { companyId: null };
  let whose = everyone;
  if (companyId) whose = { [Op.or]: [everyone, { companyId }] };
  else if (await seesEveryCompany(req.user)) whose = {};
  const rows = await AgentNotice.findAll({
    where: { removedAt: null, [Op.and]: [whose, { [Op.or]: [{ expiresAt: null }, { expiresAt: { [Op.gt]: now } }] }] },
    include,
    order: [['createdAt', 'DESC'], ['id', 'DESC']],
    limit: 100,
  });
  res.json({ notices: rows.map(shape), canPostToAll: await seesEveryCompany(req.user) });
});

// POST /agent-notices { companyId | null, headline, message?, expiresAt? }
const create = asyncHandler(async (req, res) => {
  const b = req.body || {};
  const headline = line(b.headline, 120);
  if (!headline) throw new ApiError(400, 'A headline is required', 'VALIDATION_ERROR');
  if (headline.length > 120) throw new ApiError(400, 'The headline must be 120 characters or fewer', 'VALIDATION_ERROR');
  const message = line(b.message, 500);
  if (message.length > 500) throw new ApiError(400, 'The message must be 500 characters or fewer', 'VALIDATION_ERROR');
  let companyId = null;
  if (b.companyId === null || b.companyId === undefined || b.companyId === '') {
    // Every company's computers: only for staff who reach every company.
    if (!(await seesEveryCompany(req.user))) throw new ApiError(403, 'Choose a company: you can post notices only to companies you can open', 'FORBIDDEN');
  } else {
    companyId = parseRecordId(b.companyId);
    if (!companyId || !(await canAccessCompany(req.user, companyId)) || !(await Company.findByPk(companyId, { attributes: ['id'] }))) {
      throw new ApiError(404, 'Company not found', 'NOT_FOUND');
    }
  }
  let expiresAt = null;
  if (b.expiresAt !== null && b.expiresAt !== undefined && b.expiresAt !== '') {
    expiresAt = new Date(b.expiresAt);
    if (Number.isNaN(expiresAt.getTime())) throw new ApiError(400, 'That end time is not a date', 'VALIDATION_ERROR');
    if (expiresAt <= new Date()) throw new ApiError(400, 'The end time must be in the future', 'VALIDATION_ERROR');
  }
  const notice = await AgentNotice.create({
    companyId, headline, message: message || null, expiresAt, createdBy: req.user.id,
  });
  await writeAudit(req, 'agent.notice_posted', 'AgentNotice', notice.id, { companyId, headline });
  res.status(201).json({ notice: shape(await AgentNotice.findByPk(notice.id, { include })) });
});

// DELETE /agent-notices/:id: taken down (kept for the record).
const remove = asyncHandler(async (req, res) => {
  const notice = await AgentNotice.findOne({ where: { id: parseRecordId(req.params.id) || 0, removedAt: null } });
  const reachable = notice && (notice.companyId ? await canAccessCompany(req.user, notice.companyId) : await seesEveryCompany(req.user));
  if (!reachable) throw new ApiError(404, 'Notice not found', 'NOT_FOUND');
  await notice.update({ removedAt: new Date() });
  await writeAudit(req, 'agent.notice_removed', 'AgentNotice', notice.id, { companyId: notice.companyId, headline: notice.headline });
  res.json({ removed: true });
});

module.exports = { list, create, remove };
