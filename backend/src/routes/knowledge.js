const express = require('express');
const ctrl = require('../controllers/knowledgeController');
const { requirePermission } = require('../middleware/requirePermission');
const { kbUpload, verifyFileSignature } = require('../middleware/upload');

const router = express.Router();

// Read the internal KB with kb.view; author/manage with kb.manage (any agent,
// per product decision — both seed roles get it).
const canView = requirePermission('kb.view');
const canManage = requirePermission('kb.manage');

router.use(canView);

// Categories
router.get('/categories', ctrl.listCategories);
router.post('/categories', canManage, ctrl.createCategory);
router.patch('/categories/:categoryId', canManage, ctrl.updateCategory);
router.delete('/categories/:categoryId', canManage, ctrl.deleteCategory);

// Articles
router.get('/articles', ctrl.listArticles);
router.post('/articles', canManage, ctrl.createArticle);
router.get('/articles/:id', ctrl.getArticle);
router.patch('/articles/:id', canManage, ctrl.updateArticle);
router.delete('/articles/:id', canManage, ctrl.deleteArticle);

// Attachments
router.post('/articles/:id/attachments', canManage, kbUpload.single('file'), verifyFileSignature, ctrl.createAttachment);
router.get('/articles/:id/attachments/:attachmentId/download', ctrl.downloadAttachment);
router.delete('/articles/:id/attachments/:attachmentId', canManage, ctrl.removeAttachment);

module.exports = router;
