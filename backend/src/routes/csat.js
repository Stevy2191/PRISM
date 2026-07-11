const express = require('express');
const ctrl = require('../controllers/csatController');

const router = express.Router();

router.get('/stats', ctrl.stats);
router.get('/responses', ctrl.responses);

module.exports = router;
