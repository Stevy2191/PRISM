const express = require('express');
const ctrl = require('../controllers/contractsController');
const { requirePermission } = require('../middleware/requirePermission');
const { fenceParam } = require('../middleware/companyFence');
const { Contract } = require('../models');
const { contractUpload, verifyFileSignature } = require('../middleware/upload');

const router = express.Router();

// Every /:id route is refused for a contract in a company the caller can't reach.
router.param('id', fenceParam(Contract, 'contract'));

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
router.post('/:id/attachments', canManage, contractUpload.single('file'), verifyFileSignature, ctrl.createAttachment);
router.get('/:id/attachments/:attachmentId/download', ctrl.downloadAttachment);
router.delete('/:id/attachments/:attachmentId', canManage, ctrl.removeAttachment);

router.get('/:id/activity', ctrl.listActivity);

module.exports = router;
