const express = require('express');
const ctrl = require('../controllers/dashboardController');

const router = express.Router();

router.get('/', ctrl.get);
router.get('/activity', ctrl.activityMore);
router.get('/layout', ctrl.getLayout);
router.put('/layout', ctrl.saveLayout);
router.delete('/layout', ctrl.resetLayout);

module.exports = router;
