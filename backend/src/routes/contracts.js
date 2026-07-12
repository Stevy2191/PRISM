const express = require('express');
const ctrl = require('../controllers/contractsController');
const { requirePermission } = require('../middleware/requirePermission');
const { contractUpload } = require('../middleware/upload');

const router = express.Router();

const canView = requirePermission('assets.view');
const canManage = requirePermission('assets.manage_contracts');

router.use(canView);

router.get('/', ctrl.list);
router.post('/', canManage, ctrl.create);
router.get('/:id', ctrl.get);
router.patch('/:id', canManage, ctrl.update);
router.delete('/:id', canManage, ctrl.remove);

router.get('/:id/assets', ctrl.listAssets);
router.post('/:id/assets', canManage, ctrl.linkAsset);
router.delete('/:id/assets/:assetId', canManage, ctrl.unlinkAsset);

router.get('/:id/attachments', ctrl.listAttachments);
router.post('/:id/attachments', canManage, contractUpload.single('file'), ctrl.createAttachment);
router.get('/:id/attachments/:attachmentId/download', ctrl.downloadAttachment);
router.delete('/:id/attachments/:attachmentId', canManage, ctrl.removeAttachment);

router.get('/:id/activity', ctrl.listActivity);

module.exports = router;
