// Install links (8d): fully public. The install key in the path is the
// credential; controllers/installController answers a link that doesn't
// work the same way whatever the reason.
const express = require('express');
const ctrl = require('../controllers/installController');
const { installLimiter } = require('../middleware/rateLimit');

const router = express.Router();
router.use(installLimiter);

router.get('/:key', ctrl.getLink);
router.get('/:key/windows', ctrl.windows);
router.get('/:key/windows.ps1', ctrl.windowsScript);
router.get('/:key/mac', ctrl.mac);
router.get('/:key/mac.sh', ctrl.macScript);
router.get('/:key/linux.sh', ctrl.linuxScript);
router.get('/:key/linux/:format/:arch', ctrl.linuxPackage);

module.exports = router;
