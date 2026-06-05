// Mounts all API v1 routes. Auth route is public for login/logout;
// everything else sits behind the `authenticate` middleware.
const express = require('express');
const { authenticate } = require('../middleware/auth');

const authRoutes = require('./auth');
const usersRoutes = require('./users');
const departmentsRoutes = require('./departments');
const projectsRoutes = require('./projects');
const ticketsRoutes = require('./tickets');
const apikeysRoutes = require('./apikeys');
const reportsRoutes = require('./reports');
const settingsController = require('../controllers/settingsController');
const { requireRole, blockUntilPasswordChanged } = require('../middleware/role');

const router = express.Router();

router.get('/health', (req, res) => res.json({ ok: true, service: 'prism-backend' }));

router.use('/auth', authRoutes);

// Protected routes. `guard` = authenticated AND (for local accounts) not pending a
// forced password change.
const guard = [authenticate, blockUntilPasswordChanged];
router.use('/users', guard, usersRoutes);
router.use('/departments', guard, departmentsRoutes);
router.use('/projects', guard, projectsRoutes);
router.use('/tickets', guard, ticketsRoutes);
router.use('/apikeys', guard, apikeysRoutes);
router.use('/reports', guard, reportsRoutes);
router.get('/settings', guard, requireRole('admin'), settingsController.get);

module.exports = router;
