// The knowledge base in the client portal: published portal articles whose
// audience covers the signed-in contact (services/portal/scope). Replaces
// the anonymous /kb Help Center. Responses carry reader fields only.
const path = require('path');
const { Op, fn, col } = require('sequelize');
const { KbArticle, KbCategory, KbAttachment } = require('../../models');
const { ApiError, asyncHandler } = require('../../middleware/error');
const { UPLOAD_ROOT } = require('../../middleware/upload');
const { parseRecordId } = require('../../services/permissionService');
const { portalArticleWhere } = require('../../services/portal/scope');
const { escapeLike } = require('../../utils/escapeLike');

const CATEGORY_ATTRS = ['id', 'name', 'slug', 'icon'];
const notFound = () => new ApiError(404, 'Article not found', 'NOT_FOUND');

// GET /portal/kb/categories — only categories with something I can read.
const listCategories = asyncHandler(async (req, res) => {
  const counts = await KbArticle.findAll({
    attributes: ['categoryId', [fn('COUNT', col('KbArticle.id')), 'count']],
    where: portalArticleWhere(req.contact),
    group: ['categoryId'],
    raw: true,
  });
  const countByCat = new Map(counts.map((c) => [c.categoryId, Number(c.count)]));
  const categories = await KbCategory.findAll({ order: [['position', 'ASC'], ['name', 'ASC']] });
  res.json({
    categories: categories
      .filter((c) => countByCat.get(c.id))
      .map((c) => ({
        id: c.id, name: c.name, slug: c.slug, icon: c.icon, description: c.description, articleCount: countByCat.get(c.id),
      })),
    uncategorizedCount: countByCat.get(null) || 0,
  });
});

// GET /portal/kb/articles?q&category
const listArticles = asyncHandler(async (req, res) => {
  const parts = [portalArticleWhere(req.contact)];
  const { q, category } = req.query;
  if (typeof category === 'string' && category) {
    const cat = await KbCategory.findOne({ where: { slug: category }, attributes: ['id'] });
    parts.push({ categoryId: cat ? cat.id : -1 });
  }
  if (typeof q === 'string' && q.trim()) {
    const term = `%${escapeLike(q.trim().slice(0, 200))}%`;
    parts.push({ [Op.or]: [{ title: { [Op.like]: term } }, { excerpt: { [Op.like]: term } }] });
  }
  const articles = await KbArticle.findAll({
    where: { [Op.and]: parts },
    include: [{ model: KbCategory, as: 'category', attributes: CATEGORY_ATTRS }],
    attributes: ['id', 'title', 'slug', 'excerpt', 'updatedAt', 'publishedAt', 'categoryId'],
    order: [['publishedAt', 'DESC'], ['id', 'DESC']],
    limit: 200,
  });
  res.json({ articles });
});

async function findReadable(req, attributes) {
  const slug = typeof req.params.slug === 'string' ? req.params.slug : '';
  const article = await KbArticle.findOne({ where: { [Op.and]: [{ slug }, portalArticleWhere(req.contact)] }, attributes });
  if (!article) throw notFound();
  return article;
}

// GET /portal/kb/articles/:slug
const getArticle = asyncHandler(async (req, res) => {
  const { id } = await findReadable(req, ['id']);
  const article = await KbArticle.findByPk(id, {
    attributes: ['id', 'title', 'slug', 'excerpt', 'body', 'categoryId', 'updatedAt', 'publishedAt'],
    include: [
      { model: KbCategory, as: 'category', attributes: CATEGORY_ATTRS },
      { model: KbAttachment, as: 'attachments', attributes: ['id', 'originalName', 'mimeType', 'size'] },
    ],
    order: [[{ model: KbAttachment, as: 'attachments' }, 'createdAt', 'ASC']],
  });
  KbArticle.increment('viewCount', { where: { id } }).catch(() => {});
  res.json({ article });
});

// GET /portal/kb/articles/:slug/attachments/:attachmentId/download
const downloadAttachment = asyncHandler(async (req, res) => {
  const { id } = await findReadable(req, ['id']);
  const attachmentId = parseRecordId(req.params.attachmentId);
  const attachment = attachmentId ? await KbAttachment.findOne({ where: { id: attachmentId, articleId: id } }) : null;
  if (!attachment) throw new ApiError(404, 'Attachment not found', 'NOT_FOUND');
  res.download(path.join(UPLOAD_ROOT, 'knowledge', String(id), path.basename(attachment.filename)), attachment.originalName);
});

module.exports = {
  listCategories, listArticles, getArticle, downloadAttachment,
};
