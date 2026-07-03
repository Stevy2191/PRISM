const express = require('express');
const ctrl = require('../controllers/dashboardController');

const router = express.Router();

router.get('/', ctrl.get);

module.exports = router;
