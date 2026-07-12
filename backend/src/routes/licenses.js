const express = require('express');
const ctrl = require('../controllers/licensesController');
const { requirePermission } = require('../middleware/requirePermission');
const { licenseUpload, verifyFileSignature } = require('../middleware/upload');

const router = express.Router();

// Read access reuses assets.view (licenses are a sub-section of Assets);
// write access uses the module-specific assets.manage_licenses.
const canView = requirePermission('assets.view');
const canManage = requirePermission('assets.manage_licenses');
const canViewKeys = requirePermission('assets.view_license_keys');

router.use(canView);

router.get('/', ctrl.list);
router.post('/', canManage, ctrl.create);
router.get('/:id', ctrl.get);
router.patch('/:id', canManage, ctrl.update);
router.delete('/:id', canManage, ctrl.remove);

router.get('/:id/reveal-key', canViewKeys, ctrl.revealKey);

router.get('/:id/assets', ctrl.listAssets);
router.post('/:id/assets', canManage, ctrl.linkAsset);
router.delete('/:id/assets/:assetId', canManage, ctrl.unlinkAsset);

router.get('/:id/contacts', ctrl.listContacts);
router.post('/:id/contacts', canManage, ctrl.assignContact);
router.delete('/:id/contacts/:contactId', canManage, ctrl.unassignContact);

router.get('/:id/attachments', ctrl.listAttachments);
router.post('/:id/attachments', canManage, licenseUpload.single('file'), verifyFileSignature, ctrl.createAttachment);
router.get('/:id/attachments/:attachmentId/download', ctrl.downloadAttachment);
router.delete('/:id/attachments/:attachmentId', canManage, ctrl.removeAttachment);

router.get('/:id/activity', ctrl.listActivity);

module.exports = router;
