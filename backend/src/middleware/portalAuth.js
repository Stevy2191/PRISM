// Client-portal authentication. A portal session (its own express-session,
// cookie prism.portal.sid on /api/v1/portal only, see app.js) identifies a
// contact by req.session.contactId. It never carries a userId, and staff
// routes never read this session, so the two identities can't cross.
//
// Every request re-checks that the contact may still use the portal: the
// portal is switched on, the contact exists, is active and has portal access,
// plus any checks other modules add to portalSessionChecks (7b adds the
// Microsoft re-check). Failing any of them ends the session there and then.
const {
  Contact, Company, Department, SystemSettings,
} = require('../models');
const { ApiError } = require('./error');

// async (req, contact) => void. Throw (any error) to end the session.
const portalSessionChecks = [];

async function isPortalEnabled() {
  const row = await SystemSettings.findOne({ where: { key: 'portal.enabled' } });
  return !!row && row.value === 'true';
}

const mayUsePortal = (contact) => !!contact && contact.status === 'active' && contact.portalAccess === true;

function loadPortalContact(id) {
  return Contact.findByPk(id, {
    include: [
      { model: Company, as: 'company', attributes: ['id', 'name'] },
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
    if (!contactId) return next(new ApiError(401, 'Sign in to the portal', 'PORTAL_UNAUTHENTICATED'));
    const contact = await loadPortalContact(contactId);
    let ok = mayUsePortal(contact) && (await isPortalEnabled());
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
  portalAuthenticate, portalSessionChecks, isPortalEnabled, mayUsePortal, loadPortalContact, destroySession, accessEnded,
};
