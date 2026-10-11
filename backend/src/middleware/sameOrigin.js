// Refuses state-changing API requests that a browser says came from another
// site (plan 3c security review). The session cookie is SameSite=Lax, which
// stops other sites but not a sibling subdomain or another port of the same
// host ("same-site"), and the API accepts form-encoded bodies (SAML needs
// them). Browsers send Sec-Fetch-Site on every request; API tools and older
// clients send none and are not affected.
//
// SAML's assertion consumer is the one route that receives a cross-site
// form POST by design (from the identity provider); it is verified by the
// protocol's signatures instead.
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const ALLOWED_SITES = new Set(['same-origin', 'none']);
const SAML_ACS = /^\/sso\/[^/]+\/acs\/?$/;

function sameOriginWrites(req, res, next) {
  const site = req.get('Sec-Fetch-Site');
  if (SAFE_METHODS.has(req.method) || !site || ALLOWED_SITES.has(site) || SAML_ACS.test(req.path)) return next();
  return res.status(403).json({ error: true, message: 'Cross-site request refused', code: 'CROSS_SITE' });
}

module.exports = { sameOriginWrites };
