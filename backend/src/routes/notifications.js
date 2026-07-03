const express = require('express');
const ctrl = require('../controllers/notificationsController');

const router = express.Router();

router.get('/', ctrl.list);
router.patch('/read-all', ctrl.readAll);

module.exports = router;
