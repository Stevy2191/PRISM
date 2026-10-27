const express = require('express');
const ctrl = require('../../controllers/portal/kbController');

// Mounted behind portalGuard: the knowledge base is for signed-in contacts.
const router = express.Router();

router.get('/categories', ctrl.listCategories);
router.get('/articles', ctrl.listArticles);
router.get('/articles/:slug', ctrl.getArticle);
router.get('/articles/:slug/attachments/:attachmentId/download', ctrl.downloadAttachment);

module.exports = router;
