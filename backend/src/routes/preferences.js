const express = require('express');
const ctrl = require('../controllers/userPreferencesController');

const router = express.Router();

router.get('/:key', ctrl.get);
router.put('/:key', ctrl.put);
router.delete('/:key', ctrl.remove);

module.exports = router;
