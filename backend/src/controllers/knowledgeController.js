const fs = require('fs');
const path = require('path');
const { Op } = require('sequelize');
const sanitizeHtml = require('sanitize-html');
const { KbArticle, KbCategory, KbAttachment, User } = require('../models');
const { ApiError, asyncHandler } = require('../middleware/error');
const { writeAudit } = require('../middleware/audit');
const { UPLOAD_ROOT } = require('../middleware/upload');

const userAttrs = ['id', 'displayName', 'username'];

// ==================== HTML sanitization ====================

// Article bodies are authored as HTML in the rich-text editor and later
// rendered — including on the auth-less public portal — so they MUST be
// sanitized before storage. This is the real enforcement point (the frontend
// editor is not trusted). Allows the formatting the toolbar can produce
// (headings, marks, lists, quotes, code, links, images, tables, text
// color/highlight, alignment) and nothing script-bearing.
const colorRe = [/^#(0x)?[0-9a-f]{3,8}$/i, /^rgb\(\s*(\d{1,3}\s*,\s*){2}\d{1,3}\s*\)$/i, /^rgba\(\s*(\d{1,3}\s*,\s*){3}[\d.]+\s*\)$/i, /^[a-z]+$/i];
const SANITIZE_CONFIG = {
  allowedTags: [
    'h1', 'h2', 'h3', 'h4', 'p', 'br', 'hr', 'strong', 'b', 'em', 'i', 'u', 's', 'strike',
    'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'a', 'img', 'span', 'mark',
    'table', 'thead', 'tbody', 'tr', 'th', 'td', 'colgroup', 'col',
  ],
  allowedAttributes: {
    a: ['href', 'target', 'rel'],
    img: ['src', 'alt', 'title', 'width', 'height'],
    span: ['style'],
    mark: ['style'],
    p: ['style'], h1: ['style'], h2: ['style'], h3: ['style'], h4: ['style'],
    li: ['style'], blockquote: ['style'], td: ['style', 'colspan', 'rowspan'], th: ['style', 'colspan', 'rowspan'],
    col: ['style', 'span'],
  },
  allowedStyles: {
    '*': {
      'text-align': [/^(left|right|center|justify)$/],
      color: colorRe,
      'background-color': colorRe,
      width: [/^\d+(\.\d+)?(px|%)$/],
    },
  },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  // Data URIs allowed only for inline images (pasted/embedded), never for
  // links or other tags.
  allowedSchemesByTag: { img: ['http', 'https', 'data'] },
  transformTags: {
    // Force external links safe — new tab + no referrer/opener leakage.
    a: (tagName, attribs) => ({ tagName, attribs: { ...attribs, target: '_blank', rel: 'noopener noreferrer nofollow' } }),
  },
};

function cleanHtml(html) {
  if (!html) return '';
  return sanitizeHtml(String(html), SANITIZE_CONFIG);
}

// Strip all tags → plain text, for deriving an excerpt / search preview.
function toPlainText(html) {
  return sanitizeHtml(String(html || ''), { allowedTags: [], allowedAttributes: {} })
    .replace(/\s+/g, ' ')
    .trim();
}

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
  if (visibility && ['internal', 'public'].includes(visibility)) where.visibility = visibility;
  if (categoryId === 'none') where.categoryId = null;
  else if (categoryId) where.categoryId = categoryId;
  if (q && q.trim()) {
    const term = `%${q.trim()}%`;
    where[Op.or] = [{ title: { [Op.like]: term } }, { excerpt: { [Op.like]: term } }];
  }
  const articles = await KbArticle.findAll({
    where,
    include: articleListInclude,
    order: [['updatedAt', 'DESC']],
    // Body is heavy and unneeded in lists.
    attributes: { exclude: ['body'] },
  });
  res.json({ articles });
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
  res.json({ article });
});

const createArticle = asyncHandler(async (req, res) => {
  const { title, body, excerpt, categoryId, status, visibility } = req.body;
  if (!title || !title.trim()) throw new ApiError(400, 'Title is required', 'VALIDATION');
  const cleanBody = cleanHtml(body);
  const st = ['draft', 'published'].includes(status) ? status : 'draft';
  const article = await KbArticle.create({
    title: title.trim(),
    slug: await uniqueSlug(KbArticle, title),
    body: cleanBody,
    excerpt: (excerpt?.trim() || toPlainText(cleanBody).slice(0, 300)) || null,
    categoryId: categoryId || null,
    status: st,
    visibility: ['internal', 'public'].includes(visibility) ? visibility : 'internal',
    authorId: req.user.id,
    updatedById: req.user.id,
    publishedAt: st === 'published' ? new Date() : null,
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
  if (visibility !== undefined && ['internal', 'public'].includes(visibility)) article.visibility = visibility;
  if (status !== undefined && ['draft', 'published'].includes(status)) {
    if (status === 'published' && article.status !== 'published') article.publishedAt = new Date();
    article.status = status;
  }
  article.updatedById = req.user.id;
  await article.save();
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

// ==================== Public portal (auth-less) ====================

// Only ever serves published + public articles. Every public handler filters
// on BOTH conditions so a draft or internal article can never leak, even by
// direct slug guess.
const PUBLIC_WHERE = { status: 'published', visibility: 'public' };

const publicListCategories = asyncHandler(async (req, res) => {
  const counts = await KbArticle.findAll({
    attributes: ['categoryId', [KbArticle.sequelize.fn('COUNT', KbArticle.sequelize.col('id')), 'count']],
    where: PUBLIC_WHERE,
    group: ['categoryId'],
    raw: true,
  });
  const countByCat = new Map(counts.map((c) => [c.categoryId, Number(c.count)]));
  const categories = await KbCategory.findAll({ order: [['position', 'ASC'], ['name', 'ASC']] });
  // Only surface categories that actually have public content.
  const withArticles = categories
    .filter((c) => countByCat.get(c.id))
    .map((c) => ({ id: c.id, name: c.name, slug: c.slug, icon: c.icon, description: c.description, articleCount: countByCat.get(c.id) }));
  res.json({ categories: withArticles, uncategorizedCount: countByCat.get(null) || 0 });
});

const publicListArticles = asyncHandler(async (req, res) => {
  const { q, category } = req.query;
  const where = { ...PUBLIC_WHERE };
  if (category) {
    const cat = await KbCategory.findOne({ where: { slug: category }, attributes: ['id'] });
    where.categoryId = cat ? cat.id : -1;
  }
  if (q && q.trim()) {
    const term = `%${q.trim()}%`;
    where[Op.or] = [{ title: { [Op.like]: term } }, { excerpt: { [Op.like]: term } }];
  }
  const articles = await KbArticle.findAll({
    where,
    include: [{ model: KbCategory, as: 'category', attributes: ['id', 'name', 'slug', 'icon'] }],
    attributes: ['id', 'title', 'slug', 'excerpt', 'updatedAt', 'publishedAt', 'categoryId'],
    order: [['publishedAt', 'DESC']],
    limit: 200,
  });
  res.json({ articles });
});

const publicGetArticle = asyncHandler(async (req, res) => {
  const article = await KbArticle.findOne({
    where: { slug: req.params.slug, ...PUBLIC_WHERE },
    include: [
      { model: KbCategory, as: 'category', attributes: ['id', 'name', 'slug', 'icon'] },
      { model: KbAttachment, as: 'attachments', attributes: ['id', 'originalName', 'mimeType', 'size'] },
    ],
    order: [[{ model: KbAttachment, as: 'attachments' }, 'createdAt', 'ASC']],
  });
  if (!article) throw new ApiError(404, 'Article not found', 'NOT_FOUND');
  // Fire-and-forget view increment.
  KbArticle.increment('viewCount', { where: { id: article.id } }).catch(() => {});
  res.json({ article });
});

const publicDownloadAttachment = asyncHandler(async (req, res) => {
  const article = await KbArticle.findOne({ where: { slug: req.params.slug, ...PUBLIC_WHERE }, attributes: ['id'] });
  if (!article) throw new ApiError(404, 'Article not found', 'NOT_FOUND');
  const attachment = await KbAttachment.findOne({ where: { id: req.params.attachmentId, articleId: article.id } });
  if (!attachment) throw new ApiError(404, 'Attachment not found', 'NOT_FOUND');
  const filePath = path.join(UPLOAD_ROOT, 'knowledge', String(article.id), attachment.filename);
  res.download(filePath, attachment.originalName);
});

module.exports = {
  listCategories, createCategory, updateCategory, deleteCategory,
  listArticles, getArticle, createArticle, updateArticle, deleteArticle,
  createAttachment, downloadAttachment, removeAttachment,
  publicListCategories, publicListArticles, publicGetArticle, publicDownloadAttachment,
};
