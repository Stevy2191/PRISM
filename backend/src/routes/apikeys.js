const express = require('express');
const ctrl = require('../controllers/apikeysController');

const router = express.Router();

// Any authenticated user manages their own keys; admin sees all (scoped in controller).
router.get('/', ctrl.list);
router.post('/', ctrl.create);
router.delete('/:id', ctrl.remove);

module.exports = router;
