const express = require('express');
const ctrl = require('../controllers/apikeysController');

const { apiKeyCreateLimiter } = require('../middleware/rateLimit');

const router = express.Router();

// Any authenticated user manages their own keys; admin sees all (scoped in controller).
router.get('/', ctrl.list);
router.post('/', apiKeyCreateLimiter, ctrl.create);
router.delete('/:id', ctrl.remove);

module.exports = router;
