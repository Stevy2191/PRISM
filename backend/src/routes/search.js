const express = require('express');
const ctrl = require('../controllers/searchController');

const router = express.Router();

router.get('/', ctrl.search);

module.exports = router;
