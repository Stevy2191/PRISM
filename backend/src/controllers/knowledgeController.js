const fs = require('fs');
const path = require('path');
const { Op } = require('sequelize');
const {
  KbArticle, KbCategory, KbAttachment, KbArticleAudience, Company, Department, User, sequelize,
} = require('../models');
const { canAccessCompany, parseRecordId } = require('../services/permissionService');
const { ApiError, asyncHandler } = require('../middleware/error');
const { parsePagination, paginated } = require('../utils/pagination');
const { writeAudit } = require('../middleware/audit');
const { UPLOAD_ROOT } = require('../middleware/upload');
const { sanitizeRichHtml, stripToText } = require('../utils/richHtml');

const userAttrs = ['id', 'displayName', 'username'];

// ==================== HTML sanitization ====================

// Article bodies are sanitized before storage with the shared rich-HTML
// config (utils/richHtml.js), the real enforcement point.
const cleanHtml = sanitizeRichHtml;
// Strip all tags → plain text, for deriving an excerpt / search preview.
const toPlainText = stripToText;

// ==================== Slugs ====================

function slugify(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 200) || 'item';
}

// Ensures a slug is unique within `model`, appending -2, -3, … on collision.
async function uniqueSlug(model, base, excludeId = null) {
  const root = slugify(base);
  let candidate = root;
  let n = 1;
  // eslint-disable-next-line no-await-in-loop
  while (true) {
    const where = { slug: candidate };
    if (excludeId) where.id = { [Op.ne]: excludeId };
    // eslint-disable-next-line no-await-in-loop
    const clash = await model.findOne({ where, attributes: ['id'] });
    if (!clash) return candidate;
    n += 1;
    candidate = `${root}-${n}`;
  }
}

// ==================== Categories ====================

const listCategories = asyncHandler(async (req, res) => {
  const categories = await KbCategory.findAll({ order: [['position', 'ASC'], ['name', 'ASC']] });
  // Attach article counts so the browse sidebar can show them.
  const counts = await KbArticle.findAll({
    attributes: ['categoryId', [KbArticle.sequelize.fn('COUNT', KbArticle.sequelize.col('id')), 'count']],
    group: ['categoryId'],
    raw: true,
  });
  const countByCat = new Map(counts.map((c) => [c.categoryId, Number(c.count)]));
  res.json({ categories: categories.map((c) => ({ ...c.toJSON(), articleCount: countByCat.get(c.id) || 0 })) });
});

const createCategory = asyncHandler(async (req, res) => {
  const { name, description, icon, position } = req.body;
  if (!name || !name.trim()) throw new ApiError(400, 'Category name is required', 'VALIDATION');
  const slug = await uniqueSlug(KbCategory, name);
  const category = await KbCategory.create({
    name: name.trim(),
    slug,
    description: description?.trim() || null,
    icon: icon?.trim() || null,
    position: Number.isInteger(position) ? position : 0,
  });
  await writeAudit(req, 'kbCategory.create', 'KbCategory', category.id, { name: category.name });
  res.status(201).json({ category });
});

const updateCategory = asyncHandler(async (req, res) => {
  const category = await KbCategory.findByPk(req.params.categoryId);
  if (!category) throw new ApiError(404, 'Category not found', 'NOT_FOUND');
  const { name, description, icon, position } = req.body;
  if (name !== undefined) {
    if (!name.trim()) throw new ApiError(400, 'Category name cannot be empty', 'VALIDATION');
    if (name.trim() !== category.name) category.slug = await uniqueSlug(KbCategory, name, category.id);
    category.name = name.trim();
  }
  if (description !== undefined) category.description = description?.trim() || null;
  if (icon !== undefined) category.icon = icon?.trim() || null;
  if (position !== undefined && Number.isInteger(position)) category.position = position;
  await category.save();
  await writeAudit(req, 'kbCategory.update', 'KbCategory', category.id, { name: category.name });
  res.json({ category });
});

const deleteCategory = asyncHandler(async (req, res) => {
  const category = await KbCategory.findByPk(req.params.categoryId);
  if (!category) throw new ApiError(404, 'Category not found', 'NOT_FOUND');
  // Articles are kept (uncategorized), not deleted with the category.
  await KbArticle.update({ categoryId: null }, { where: { categoryId: category.id } });
  await category.destroy();
  await writeAudit(req, 'kbCategory.delete', 'KbCategory', category.id, { name: category.name });
  res.json({ ok: true });
});

// ==================== Articles (staff) ====================

const articleListInclude = [
  { model: KbCategory, as: 'category', attributes: ['id', 'name', 'slug', 'icon'] },
  { model: User, as: 'author', attributes: userAttrs },
];

const listArticles = asyncHandler(async (req, res) => {
  const { q, categoryId, status, visibility } = req.query;
  const where = {};
  if (status && ['draft', 'published'].includes(status)) where.status = status;
  if (visibility && ['internal', 'portal'].includes(visibility)) where.visibility = visibility;
  if (categoryId === 'none') where.categoryId = null;
  else if (categoryId) where.categoryId = categoryId;
  if (q && q.trim()) {
    const term = `%${q.trim()}%`;
    where[Op.or] = [{ title: { [Op.like]: term } }, { excerpt: { [Op.like]: term } }];
  }
  const { page, limit, offset } = parsePagination(req);
  const { rows, count } = await KbArticle.findAndCountAll({
    where,
    include: articleListInclude,
    order: [['updatedAt', 'DESC'], ['id', 'DESC']],
    // Body is heavy and unneeded in lists.
    attributes: { exclude: ['body'] },
    limit,
    offset,
    distinct: true,
  });
  res.json(paginated('articles', { rows, count }, { page, limit }));
});

const getArticle = asyncHandler(async (req, res) => {
  const article = await KbArticle.findByPk(req.params.id, {
    include: [
      { model: KbCategory, as: 'category', attributes: ['id', 'name', 'slug', 'icon'] },
      { model: User, as: 'author', attributes: userAttrs },
      { model: User, as: 'editor', attributes: userAttrs },
      { model: KbAttachment, as: 'attachments', include: [{ model: User, as: 'uploadedBy', attributes: userAttrs }] },
    ],
    order: [[{ model: KbAttachment, as: 'attachments' }, 'createdAt', 'ASC']],
  });
  if (!article) throw new ApiError(404, 'Article not found', 'NOT_FOUND');
  res.json({ article: { ...article.toJSON(), audience: await audienceOf(article.id) } });
});

// ---- Portal audience (client portal, 7a) ----
// visibility 'portal' articles are read by signed-in contacts: all of them
// (portalScope 'all'), or only the chosen companies / departments. Every id
// must exist and be in a company the author can reach.
const PORTAL_SCOPES = ['all', 'companies', 'departments'];
const badAudience = (msg = 'Unknown company or department in the audience') => new ApiError(400, msg, 'VALIDATION_ERROR');

function idListFrom(raw) {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > 500) throw badAudience('The audience must be a list');
  const ids = raw.map(parseRecordId);
  if (ids.some((id) => !id)) throw badAudience();
  return [...new Set(ids)];
}

// Returns { portalScope, rows } to save, or null when the request doesn't touch the audience.
async function resolveAudience(req, current = {}) {
  const { portalScope, audience } = req.body || {};
  if (portalScope === undefined && audience === undefined) return null;
  const scope = portalScope === undefined ? (current.portalScope || 'all') : portalScope;
  if (!PORTAL_SCOPES.includes(scope)) throw badAudience('Unknown portal audience');
  const companyIds = scope === 'companies' ? idListFrom(audience?.companyIds) : [];
  const departmentIds = scope === 'departments' ? idListFrom(audience?.departmentIds) : [];
  const companies = companyIds.length ? await Company.findAll({ where: { id: companyIds }, attributes: ['id'] }) : [];
  const departments = departmentIds.length ? await Department.findAll({ where: { id: departmentIds }, attributes: ['id', 'companyId'] }) : [];
  if (companies.length !== companyIds.length || departments.length !== departmentIds.length) throw badAudience();
  const reach = [...companies.map((c) => c.id), ...departments.map((d) => d.companyId)];
  for (const companyId of new Set(reach)) {
    // eslint-disable-next-line no-await-in-loop
    if (!(await canAccessCompany(req.user, companyId))) throw badAudience();
  }
  return {
    portalScope: scope,
    rows: [...companyIds.map((companyId) => ({ companyId })), ...departmentIds.map((departmentId) => ({ departmentId }))],
  };
}

async function saveAudience(articleId, resolved, transaction) {
  await KbArticleAudience.destroy({ where: { articleId }, transaction });
  if (resolved.rows.length) {
    await KbArticleAudience.bulkCreate(resolved.rows.map((r) => ({ articleId, ...r })), { transaction });
  }
}

async function audienceOf(articleId) {
  const rows = await KbArticleAudience.findAll({ where: { articleId }, attributes: ['companyId', 'departmentId'] });
  const sorted = (key) => rows.map((r) => r[key]).filter((v) => v != null).sort((a, b) => a - b);
  return { companyIds: sorted('companyId'), departmentIds: sorted('departmentId') };
}

const createArticle = asyncHandler(async (req, res) => {
  const { title, body, excerpt, categoryId, status, visibility } = req.body;
  if (!title || !title.trim()) throw new ApiError(400, 'Title is required', 'VALIDATION');
  const cleanBody = cleanHtml(body);
  const st = ['draft', 'published'].includes(status) ? status : 'draft';
  const audience = await resolveAudience(req);
  const article = await sequelize.transaction(async (transaction) => {
    const created = await KbArticle.create({
      title: title.trim(),
    slug: await uniqueSlug(KbArticle, title),
    body: cleanBody,
    excerpt: (excerpt?.trim() || toPlainText(cleanBody).slice(0, 300)) || null,
    categoryId: categoryId || null,
    status: st,
    visibility: ['internal', 'portal'].includes(visibility) ? visibility : 'internal',
    authorId: req.user.id,
    updatedById: req.user.id,
    publishedAt: st === 'published' ? new Date() : null,
      portalScope: audience ? audience.portalScope : 'all',
    }, { transaction });
    if (audience) await saveAudience(created.id, audience, transaction);
    return created;
  });
  await writeAudit(req, 'kbArticle.create', 'KbArticle', article.id, { title: article.title });
  res.status(201).json({ article });
});

const updateArticle = asyncHandler(async (req, res) => {
  const article = await KbArticle.findByPk(req.params.id);
  if (!article) throw new ApiError(404, 'Article not found', 'NOT_FOUND');
  const { title, body, excerpt, categoryId, status, visibility } = req.body;

  if (title !== undefined) {
    if (!title.trim()) throw new ApiError(400, 'Title cannot be empty', 'VALIDATION');
    if (title.trim() !== article.title) article.slug = await uniqueSlug(KbArticle, title, article.id);
    article.title = title.trim();
  }
  if (body !== undefined) article.body = cleanHtml(body);
  if (excerpt !== undefined) article.excerpt = excerpt?.trim() || toPlainText(article.body).slice(0, 300) || null;
  else if (body !== undefined && !req.body.excerptLocked) article.excerpt = toPlainText(article.body).slice(0, 300) || null;
  if (categoryId !== undefined) article.categoryId = categoryId || null;
  if (visibility !== undefined && ['internal', 'portal'].includes(visibility)) article.visibility = visibility;
  if (status !== undefined && ['draft', 'published'].includes(status)) {
    if (status === 'published' && article.status !== 'published') article.publishedAt = new Date();
    article.status = status;
  }
  const audience = await resolveAudience(req, article);
  if (audience) article.portalScope = audience.portalScope;
  article.updatedById = req.user.id;
  await sequelize.transaction(async (transaction) => {
    await article.save({ transaction });
    if (audience) await saveAudience(article.id, audience, transaction);
  });
  await writeAudit(req, 'kbArticle.update', 'KbArticle', article.id, { title: article.title });
  res.json({ article });
});

const deleteArticle = asyncHandler(async (req, res) => {
  const article = await KbArticle.findByPk(req.params.id);
  if (!article) throw new ApiError(404, 'Article not found', 'NOT_FOUND');
  // Remove attachment files from disk before dropping the DB rows (cascade
  // handles the KbAttachment rows).
  const dir = path.join(UPLOAD_ROOT, 'knowledge', String(article.id));
  await article.destroy();
  fs.rm(dir, { recursive: true, force: true }, () => {});
  await writeAudit(req, 'kbArticle.delete', 'KbArticle', article.id, { title: article.title });
  res.json({ ok: true });
});

// ==================== Attachments ====================

const createAttachment = asyncHandler(async (req, res) => {
  const article = await KbArticle.findByPk(req.params.id);
  if (!article) {
    if (req.file) fs.rm(req.file.path, { force: true }, () => {});
    throw new ApiError(404, 'Article not found', 'NOT_FOUND');
  }
  if (!req.file) throw new ApiError(400, 'No file uploaded (field name must be "file")', 'NO_FILE');
  const attachment = await KbAttachment.create({
    articleId: article.id,
    filename: req.file.filename,
    originalName: req.file.originalname,
    mimeType: req.file.mimetype,
    size: req.file.size,
    uploadedById: req.user.id,
  });
  await writeAudit(req, 'kbAttachment.create', 'KbAttachment', attachment.id, { articleId: article.id, originalName: attachment.originalName });
  const fresh = await KbAttachment.findByPk(attachment.id, { include: [{ model: User, as: 'uploadedBy', attributes: userAttrs }] });
  res.status(201).json({ attachment: fresh });
});

const downloadAttachment = asyncHandler(async (req, res) => {
  const article = await KbArticle.findByPk(req.params.id);
  if (!article) throw new ApiError(404, 'Article not found', 'NOT_FOUND');
  const attachment = await KbAttachment.findOne({ where: { id: req.params.attachmentId, articleId: article.id } });
  if (!attachment) throw new ApiError(404, 'Attachment not found', 'NOT_FOUND');
  const filePath = path.join(UPLOAD_ROOT, 'knowledge', String(article.id), attachment.filename);
  res.download(filePath, attachment.originalName);
});

const removeAttachment = asyncHandler(async (req, res) => {
  const article = await KbArticle.findByPk(req.params.id);
  if (!article) throw new ApiError(404, 'Article not found', 'NOT_FOUND');
  const attachment = await KbAttachment.findOne({ where: { id: req.params.attachmentId, articleId: article.id } });
  if (!attachment) throw new ApiError(404, 'Attachment not found', 'NOT_FOUND');
  const filePath = path.join(UPLOAD_ROOT, 'knowledge', String(article.id), attachment.filename);
  await attachment.destroy();
  fs.rm(filePath, { force: true }, () => {});
  await writeAudit(req, 'kbAttachment.delete', 'KbAttachment', attachment.id, { articleId: article.id });
  res.json({ ok: true });
});

module.exports = {
  listCategories, createCategory, updateCategory, deleteCategory,
  listArticles, getArticle, createArticle, updateArticle, deleteArticle,
  createAttachment, downloadAttachment, removeAttachment,
};
