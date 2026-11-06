// A Secure session cookie is only issued on a request express sees as HTTPS.
// When COOKIE_SECURE=true but the request reached the backend as plain HTTP
// (the browser used http://, or a proxy in front didn't send
// X-Forwarded-Proto: https), express-session
// silently leaves the cookie off. Sign-in then "works" and the very next
// request is signed out again, with nothing to say why. Sign-in checks this
// first and says so instead.

const SESSION_COOKIE_BLOCKED_MESSAGE =
  'Signed in, but PRISM could not give your browser a session cookie: COOKIE_SECURE is "true" ' +
  'and this request reached PRISM over plain HTTP. Open PRISM at its https:// address, or ' +
  'ask your administrator to check COOKIE_SECURE in .env and that any proxy in front sends ' +
  'X-Forwarded-Proto.';

let warned = false;

// The same test express-session makes with `proxy: true` (see app.js).
function requestIsHttps(req) {
  if (req.socket && req.socket.encrypted) return true;
  const proto = String(req.get('X-Forwarded-Proto') || '').split(',')[0].trim().toLowerCase();
  return proto === 'https';
}

function secureCookieBlocked(req) {
  const cookie = req.session && req.session.cookie;
  if (!cookie || !cookie.secure) return false;
  if (requestIsHttps(req)) return false;
  if (!warned) {
    warned = true;
    console.warn(
      '[prism] Sign-in refused: COOKIE_SECURE=true, but the request arrived as plain HTTP ' +
      `(X-Forwarded-Proto: ${req.get('X-Forwarded-Proto') || 'none'}). ` +
      'Browsers would get no session cookie. Either open PRISM at its https:// address (a proxy in ' +
      'front that handles HTTPS must send X-Forwarded-Proto: https), or set COOKIE_SECURE=false ' +
      'for a plain HTTP install.'
    );
  }
  return true;
}

module.exports = { requestIsHttps, secureCookieBlocked, SESSION_COOKIE_BLOCKED_MESSAGE };
