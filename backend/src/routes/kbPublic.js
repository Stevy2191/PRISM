const express = require('express');
const ctrl = require('../controllers/knowledgeController');

// Auth-less public knowledge base portal. Every handler filters to
// published + public articles only (see PUBLIC_WHERE in the controller), so
// nothing internal or draft is reachable here even by direct slug.
const router = express.Router();

router.get('/categories', ctrl.publicListCategories);
router.get('/articles', ctrl.publicListArticles);
router.get('/articles/:slug', ctrl.publicGetArticle);
router.get('/articles/:slug/attachments/:attachmentId/download', ctrl.publicDownloadAttachment);

module.exports = router;
