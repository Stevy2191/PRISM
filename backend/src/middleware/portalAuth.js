// Client-portal authentication. A portal session (its own express-session,
// cookie prism.portal.sid on /api/v1/portal only, see app.js) identifies a
// contact by req.session.contactId, and the company whose portal they signed
// in to by req.session.companyId. It never carries a userId, and staff
// routes never read this session, so the two identities can't cross.
//
// Each company has its own portal (CS): every request names it
// (/api/v1/portal/c/<slug>/...). portalCompany finds it and refuses it unless
// it is open. portalAuthenticate then re-checks that the contact may still
// use it: signed in to this company's portal, still this company's contact,
// active and with portal access, plus any checks other modules add to
// portalSessionChecks (7b adds the Microsoft re-check). A session from
// another company's portal is simply not signed in here; losing access ends
// the session there and then.
const { Contact, Company, Department } = require('../models');
const { ApiError } = require('./error');
const { findBySlug, portalOpen } = require('../services/portal/company');

// async (req, contact) => void. Throw (any error) to end the session.
const portalSessionChecks = [];

const portalClosed = () => new ApiError(404, 'This portal is not open', 'PORTAL_CLOSED');

// /c/:slug — the company whose portal this is. Unknown, switched off and
// inactive all answer the same, so a link can't be used to probe.
async function portalCompany(req, res, next) {
  try {
    const company = await findBySlug(req.params.slug);
    if (!portalOpen(company)) return next(portalClosed());
    req.portalCompany = company;
    return next();
  } catch (err) {
    return next(err);
  }
}

const mayUsePortal = (contact) => !!contact && contact.status === 'active' && contact.portalAccess === true;

function loadPortalContact(id) {
  return Contact.findByPk(id, {
    include: [
      { model: Company, as: 'company', attributes: ['id', 'name', 'portalSlug'] },
      { model: Department, as: 'department', attributes: ['id', 'name'] },
    ],
  });
}

function destroySession(req) {
  return new Promise((resolve) => {
    if (!req.session || typeof req.session.destroy !== 'function') return resolve();
    return req.session.destroy(() => resolve());
  });
}

const accessEnded = () => new ApiError(401, 'Your portal access has ended. Contact support if this is unexpected.', 'PORTAL_ACCESS_ENDED');

async function portalAuthenticate(req, res, next) {
  try {
    const contactId = req.session && req.session.contactId;
    const company = req.portalCompany;
    // Signed in to another company's portal (or none): not signed in here.
    if (!contactId || !company || req.session.companyId !== company.id) {
      return next(new ApiError(401, 'Sign in to the portal', 'PORTAL_UNAUTHENTICATED'));
    }
    const contact = await loadPortalContact(contactId);
    let ok = mayUsePortal(contact) && contact.companyId === company.id;
    if (ok) {
      try {
        for (const check of portalSessionChecks) await check(req, contact); // eslint-disable-line no-await-in-loop
      } catch (err) {
        ok = false;
      }
    }
    if (!ok) {
      await destroySession(req);
      return next(accessEnded());
    }
    req.contact = contact;
    return next();
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  portalCompany, portalAuthenticate, portalSessionChecks, portalClosed, mayUsePortal, loadPortalContact, destroySession, accessEnded,
};
