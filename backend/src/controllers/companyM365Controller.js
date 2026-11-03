// A company's Microsoft 365 link (client portal 7b): tenant and sync groups,
// the admin-approval link, the group picker and Sync now. Needs
// portal.manage (route) and the company in the caller's reach.
const { Company } = require('../models');
const { ApiError, asyncHandler } = require('../middleware/error');
const { writeAudit } = require('../middleware/audit');
const { loadAccessibleCompany } = require('./companiesController');
const { getPortalMicrosoftApp } = require('./settingsController');
const graph = require('../services/microsoft365/graph');
const { microsoftRedirectUri } = require('../services/microsoft365/signIn');
const { syncCompany } = require('../services/microsoft365/sync');

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_GROUPS = 50;
const loginBase = () => (process.env.MS_LOGIN_BASE || 'https://login.microsoftonline.com').replace(/\/$/, '');

const m365Json = (c) => ({
  tenantId: c.msTenantId, consentAt: c.msConsentAt, syncGroups: c.msSyncGroups || [], lastSync: c.msLastSync,
});

function parseSyncGroups(raw) {
  if (!Array.isArray(raw) || raw.length > MAX_GROUPS) throw new ApiError(400, `Sync groups must be a list of at most ${MAX_GROUPS} groups`, 'VALIDATION_ERROR');
  const seen = new Set();
  return raw.map((g) => {
    const id = typeof g?.id === 'string' ? g.id.trim().toLowerCase() : '';
    if (!GUID.test(id)) throw new ApiError(400, 'Each sync group needs a Microsoft group id', 'VALIDATION_ERROR');
    const name = typeof g.name === 'string' ? g.name.trim().slice(0, 255) : '';
    return { id, name: name || id };
  }).filter((g) => (seen.has(g.id) ? false : seen.add(g.id)));
}

// A GraphError as the staff screen should see it.
function graphFailure(err) {
  if (err.name !== 'GraphError') return err;
  if (err.code === 'APP_NOT_CONFIGURED') return new ApiError(400, err.message, 'APP_NOT_CONFIGURED');
  if (err.status === 401 || err.status === 403 || err.code === 'invalid_client' || err.code === 'unauthorized_client') {
    return new ApiError(502, 'Microsoft refused: approve PRISM for this tenant (or check the app in Settings)', 'M365_NOT_APPROVED');
  }
  return new ApiError(502, `Microsoft could not be reached (${err.status || 'no response'})`, 'M365_UNAVAILABLE');
}

// GET /companies/:id/m365
const get = asyncHandler(async (req, res) => {
  res.json({ m365: m365Json(await loadAccessibleCompany(req)) });
});

// PUT /companies/:id/m365 { tenantId, syncGroups }
const update = asyncHandler(async (req, res) => {
  const company = await loadAccessibleCompany(req);
  const body = req.body || {};
  const rawTenant = typeof body.tenantId === 'string' ? body.tenantId.trim().toLowerCase() : body.tenantId;
  const tenantId = rawTenant ? rawTenant : null;
  if (tenantId && !GUID.test(tenantId)) throw new ApiError(400, 'The tenant ID is a GUID (Microsoft Entra → Overview → Tenant ID)', 'VALIDATION_ERROR');
  const syncGroups = body.syncGroups === undefined ? company.msSyncGroups : parseSyncGroups(body.syncGroups);
  if (tenantId) {
    const other = await Company.findOne({ where: { msTenantId: tenantId } });
    if (other && other.id !== company.id) throw new ApiError(409, `That tenant is already linked to ${other.name}`, 'TENANT_IN_USE');
  }
  const tenantChanged = tenantId !== company.msTenantId;
  await company.update({
    msTenantId: tenantId,
    // Groups belong to a tenant: a new tenant starts with none.
    msSyncGroups: tenantChanged && body.syncGroups === undefined ? [] : syncGroups,
    ...(tenantChanged ? { msConsentAt: null, msLastSync: null } : {}),
  });
  await writeAudit(req, 'company.m365_changed', 'Company', company.id, { tenantId, syncGroups: company.msSyncGroups });
  res.json({ m365: m365Json(company) });
});

// GET /companies/:id/m365/consent-url — the tenant admin's "Approve PRISM"
// link. Microsoft returns to the portal callback (the one address the app
// registers), which forwards to this company's page.
const consentUrl = asyncHandler(async (req, res) => {
  const company = await loadAccessibleCompany(req);
  if (!company.msTenantId) throw new ApiError(400, 'Link a tenant first', 'VALIDATION_ERROR');
  const { clientId, clientSecret } = await getPortalMicrosoftApp();
  if (!clientId || !clientSecret) throw new ApiError(400, 'Set up the Microsoft app first (Settings → Client portal)', 'APP_NOT_CONFIGURED');
  const params = new URLSearchParams({ client_id: clientId, redirect_uri: microsoftRedirectUri(), state: `consent-${company.id}` });
  res.json({ url: `${loginBase()}/${company.msTenantId}/adminconsent?${params}` });
});

// GET /companies/:id/m365/groups?q= — the sync-group picker.
const searchGroups = asyncHandler(async (req, res) => {
  const company = await loadAccessibleCompany(req);
  if (!company.msTenantId) throw new ApiError(400, 'Link a tenant first', 'VALIDATION_ERROR');
  let groups;
  try {
    groups = await graph.searchGroups(company.msTenantId, typeof req.query.q === 'string' ? req.query.q : '');
  } catch (err) {
    throw graphFailure(err);
  }
  if (!company.msConsentAt) await company.update({ msConsentAt: new Date() });
  res.json({ groups });
});

// POST /companies/:id/m365/sync — Sync now. 409 while one is running.
const sync = asyncHandler(async (req, res) => {
  const company = await loadAccessibleCompany(req);
  if (!company.msTenantId) throw new ApiError(400, 'Link a tenant first', 'VALIDATION_ERROR');
  const result = await syncCompany(company.id);
  await writeAudit(req, 'company.m365_synced', 'Company', company.id, {
    updated: result.updated, deactivated: result.deactivated, errors: result.errors.length,
  });
  res.json({ lastSync: result });
});

module.exports = {
  get, update, consentUrl, searchGroups, sync,
};
