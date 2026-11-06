// A Secure session cookie is only issued on a request express sees as HTTPS.
// When COOKIE_SECURE=true but the request reached the backend as plain HTTP
// (the browser used http://, or a proxy in front didn't pass on that it was
// HTTPS, or TRUST_PROXY isn't set so that is ignored), express-session
// silently leaves the cookie off. Sign-in then "works" and the very next
// request is signed out again, with nothing to say why. Sign-in checks this
// first and says so instead.

const SESSION_COOKIE_BLOCKED_MESSAGE =
  'Signed in, but PRISM could not give your browser a session cookie: COOKIE_SECURE is "true" ' +
  'and this request reached PRISM over plain HTTP. Open PRISM at its https:// address, or ' +
  'ask your administrator to check COOKIE_SECURE and TRUST_PROXY in .env.';

let warned = false;

function secureCookieBlocked(req) {
  const cookie = req.session && req.session.cookie;
  if (!cookie || !cookie.secure) return false;
  if (req.secure) return false;
  if (!warned) {
    warned = true;
    console.warn(
      '[prism] Sign-in refused: COOKIE_SECURE=true, but the request arrived as plain HTTP ' +
      `(X-Forwarded-Proto: ${req.get('X-Forwarded-Proto') || 'none'}, trust proxy: ${req.app.get('trust proxy')}). ` +
      'Browsers would get no session cookie. Either serve PRISM over HTTPS and set TRUST_PROXY ' +
      '(1 behind the bundled nginx), or set COOKIE_SECURE=false for a plain HTTP install.'
    );
  }
  return true;
}

module.exports = { secureCookieBlocked, SESSION_COOKIE_BLOCKED_MESSAGE };
