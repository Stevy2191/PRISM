// The client portal API, mounted at /api/v1/portal. Everything here runs on
// the portal session (app.js), never the staff one.
//
// Each company has its own portal (CS): its API is /c/<slug>/..., refused
// unless that company's portal is open (portalCompany), and everything past
// /config and /auth needs a contact signed in to that portal (portalGuard).
// Outside a company: the plain /portal address (/home), "email me my link"
// (/link), and Microsoft's one callback address.
const express = require('express');
const { portalCompany, portalAuthenticate } = require('../../middleware/portalAuth');
const { portalGlobalLimiter, portalLoginLimiter, portalForgotLimiter } = require('../../middleware/rateLimit');
const ctrl = require('../../controllers/portal/authController');
const authRoutes = require('./auth');
const ticketRoutes = require('./tickets');
const kbRoutes = require('./kb');
const ticketsCtrl = require('../../controllers/portal/ticketsController');
const projectsCtrl = require('../../controllers/portal/projectsController');
const invoicesCtrl = require('../../controllers/portal/invoicesController');
const { requireCustomerBilling } = require('../../middleware/customerBilling');
// Registers the Microsoft 15-minute re-check on every portal request (7b).
require('../../services/microsoft365/sessionCheck');

const portalGuard = [portalAuthenticate, portalGlobalLimiter];

const company = express.Router({ mergeParams: true });
company.get('/config', ctrl.config);
company.use(portalCompany);
company.use('/auth', authRoutes);
company.get('/me', portalGuard, ctrl.me);
company.get('/meta', portalGuard, ticketsCtrl.meta);
company.use('/tickets', portalGuard, ticketRoutes);
company.use('/kb', portalGuard, kbRoutes);
// CN: the company's projects (status and progress).
company.get('/projects', portalGuard, projectsCtrl.list);
company.get('/projects/:id', portalGuard, projectsCtrl.get);
// Phase 3: the company's invoices (only while Customer billing is on).
const billingGuard = [...portalGuard, requireCustomerBilling];
company.get('/invoices', billingGuard, invoicesCtrl.list);
company.get('/invoices/:id', billingGuard, invoicesCtrl.get);
company.get('/invoices/:id/pdf', billingGuard, invoicesCtrl.pdf);
company.post('/invoices/:id/pay', billingGuard, invoicesCtrl.pay);

const router = express.Router();
router.get('/home', ctrl.home);
router.post('/link', portalForgotLimiter, ctrl.sendLink);
router.get('/auth/microsoft/callback', portalLoginLimiter, ctrl.microsoftCallback);
router.use('/c/:slug', company);

module.exports = router;
module.exports.portalGuard = portalGuard;
