// Mounts all API v1 routes. Auth + public settings are open; everything else
// sits behind the `authenticate` (+ forced-password-change) guard.
const express = require('express');
const { authenticate } = require('../middleware/auth');
const { blockUntilPasswordChanged } = require('../middleware/role');

const authRoutes = require('./auth');
const usersRoutes = require('./users');
const rolesRoutes = require('./roles');
const permissionsRoutes = require('./permissions');
const departmentsRoutes = require('./departments');
const projectsRoutes = require('./projects');
const ticketsRoutes = require('./tickets');
const apikeysRoutes = require('./apikeys');
const reportsRoutes = require('./reports');
const blueprintsRoutes = require('./blueprints');
const settingsRoutes = require('./settings');
const teamsRoutes = require('./teams');
const businessHoursRoutes = require('./businessHours');
const holidaysRoutes = require('./holidays');
const modulesRoutes = require('./modules');
const customFieldsRoutes = require('./customFields');
const timerRoutes = require('./timer');
const dashboardRoutes = require('./dashboard');
const notificationsRoutes = require('./notifications');
const savedFiltersRoutes = require('./savedFilters');
const contactsRoutes = require('./contacts');
const ticketStatusesRoutes = require('./ticketStatuses');
const projectStatusesRoutes = require('./projectStatuses');
const auditLogRoutes = require('./auditLog');
const workflowRulesRoutes = require('./workflowRules');
const searchRoutes = require('./search');
const adSyncRoutes = require('./adSync');
const calendarRoutes = require('./calendar');
const assignmentRulesRoutes = require('./assignmentRules');
const slaPoliciesRoutes = require('./slaPolicies');
const schedulesRoutes = require('./schedules');
const surveyRoutes = require('./survey');
const csatRoutes = require('./csat');

const router = express.Router();

router.get('/health', (req, res) => res.json({ ok: true, service: 'prism-backend' }));

router.use('/auth', authRoutes);

// Fully public — contact CSAT survey links, no PRISM login involved.
router.use('/survey', surveyRoutes);

// Settings has its own public (login branding) + admin endpoints inside it.
router.use('/settings', settingsRoutes);

// Protected routes. `guard` = authenticated AND (for local accounts) not pending a
// forced password change.
const guard = [authenticate, blockUntilPasswordChanged];
router.use('/users', guard, usersRoutes);
router.use('/roles', guard, rolesRoutes);
router.use('/permissions', guard, permissionsRoutes);
router.use('/departments', guard, departmentsRoutes);
router.use('/projects', guard, projectsRoutes);
router.use('/tickets', guard, ticketsRoutes);
router.use('/apikeys', guard, apikeysRoutes);
router.use('/reports', guard, reportsRoutes);
router.use('/blueprints', guard, blueprintsRoutes);
router.use('/teams', guard, teamsRoutes);
router.use('/business-hours', guard, businessHoursRoutes);
router.use('/holiday-lists', guard, holidaysRoutes);
router.use('/modules', guard, modulesRoutes);
router.use('/custom-fields', guard, customFieldsRoutes);
router.use('/timer', guard, timerRoutes);
router.use('/dashboard', guard, dashboardRoutes);
router.use('/notifications', guard, notificationsRoutes);
router.use('/saved-filters', guard, savedFiltersRoutes);
router.use('/contacts', guard, contactsRoutes);
router.use('/ticket-statuses', guard, ticketStatusesRoutes);
router.use('/project-statuses', guard, projectStatusesRoutes);
router.use('/audit-log', guard, auditLogRoutes);
router.use('/workflow-rules', guard, workflowRulesRoutes);
router.use('/search', guard, searchRoutes);
router.use('/ad-sync', guard, adSyncRoutes);
router.use('/calendar', guard, calendarRoutes);
router.use('/assignment-rules', guard, assignmentRulesRoutes);
router.use('/sla-policies', guard, slaPoliciesRoutes);
router.use('/schedules', guard, schedulesRoutes);
router.use('/csat', guard, csatRoutes);

module.exports = router;
