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
const { requireRole } = require('../middleware/role');

const router = express.Router();

router.get('/health', (req, res) => res.json({ ok: true, service: 'prism-backend' }));

router.use('/auth', authRoutes);

// Protected routes
router.use('/users', authenticate, usersRoutes);
router.use('/departments', authenticate, departmentsRoutes);
router.use('/projects', authenticate, projectsRoutes);
router.use('/tickets', authenticate, ticketsRoutes);
router.use('/apikeys', authenticate, apikeysRoutes);
router.use('/reports', authenticate, reportsRoutes);
router.get('/settings', authenticate, requireRole('admin'), settingsController.get);

module.exports = router;
