// A mock identity provider for the SSO tests, speaking both protocols.
//
// SSO is normally shipped untested because standing up a real IdP is
// awkward, which is exactly why the interesting cases (replayed state,
// tampered signatures, group changes) never get covered. This fixture makes
// them cheap:
//
//   * OIDC — a real http issuer with a discovery document, JWKS, and a token
//     endpoint that signs genuine RS256 id_tokens. openid-client performs its
//     full normal validation against it; nothing is stubbed.
//   * SAML — assertions signed with xml-crypto using a keypair generated
//     here. node-saml verifies the signature for real.
//
// Keys are generated per test run and never leave the process, so there is no
// test certificate committed to the repository.
const http = require('http');
const crypto = require('crypto');
const { SignedXml } = require('xml-crypto');

// ---------------------------------------------------------------------------
// OIDC
// ---------------------------------------------------------------------------

async function startOidcIdp({ clientId = 'prism-test-client', clientSecret = 'test-secret' } = {}) {
  const jose = await import('jose');
  const { publicKey, privateKey } = await jose.generateKeyPair('RS256', { extractable: true });
  const jwk = await jose.exportJWK(publicKey);
  const kid = 'test-key-1';
  jwk.kid = kid;
  jwk.alg = 'RS256';
  jwk.use = 'sig';

  // What the next token exchange will assert. Tests set this before driving a
  // login, which keeps each case's intent visible in the test itself.
  let nextProfile = { sub: 'user-1', email: 'user@example.com', name: 'Test User', groups: [] };
  let nextNonce = null;

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${server.address().port}`);
    const json = (body, status = 200) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };

    if (url.pathname === '/.well-known/openid-configuration') {
      const issuer = `http://127.0.0.1:${server.address().port}`;
      return json({
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/jwks`,
        userinfo_endpoint: `${issuer}/userinfo`,
        response_types_supported: ['code'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256'],
        token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
        code_challenge_methods_supported: ['S256'],
        grant_types_supported: ['authorization_code'],
      });
    }

    if (url.pathname === '/jwks') return json({ keys: [jwk] });

    if (url.pathname === '/token') {
      const issuer = `http://127.0.0.1:${server.address().port}`;
      const now = Math.floor(Date.now() / 1000);
      const claims = { ...nextProfile, iss: issuer, aud: clientId, iat: now, exp: now + 300 };
      if (nextNonce) claims.nonce = nextNonce;
      const idToken = await new jose.SignJWT(claims)
        .setProtectedHeader({ alg: 'RS256', kid })
        .sign(privateKey);
      return json({ access_token: 'test-access-token', token_type: 'Bearer', expires_in: 300, id_token: idToken });
    }

    if (url.pathname === '/userinfo') return json(nextProfile);

    res.writeHead(404);
    return res.end();
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const issuer = `http://127.0.0.1:${server.address().port}`;

  return {
    issuer,
    clientId,
    clientSecret,
    setProfile(profile) { nextProfile = { ...nextProfile, ...profile }; },
    replaceProfile(profile) { nextProfile = profile; },
    setNonce(nonce) { nextNonce = nonce; },
    async close() { await new Promise((resolve) => server.close(resolve)); },
  };
}

// ---------------------------------------------------------------------------
// SAML
// ---------------------------------------------------------------------------

function createSamlIdp({ entityId = 'https://idp.test/metadata' } = {}) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  // A second, unrelated key used by the "tampered / wrong signer" test.
  const other = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  function buildResponse({
    subject, email, displayName, groups = [], audience, destination, inResponseTo,
    notOnOrAfter, signWith,
  }) {
    const now = new Date();
    const notBefore = new Date(now.getTime() - 60_000).toISOString();
    const expiry = (notOnOrAfter || new Date(now.getTime() + 5 * 60_000)).toISOString
      ? (notOnOrAfter || new Date(now.getTime() + 5 * 60_000)).toISOString()
      : String(notOnOrAfter);
    const responseId = `_${crypto.randomBytes(16).toString('hex')}`;
    const assertionId = `_${crypto.randomBytes(16).toString('hex')}`;

    const attributes = [];
    if (email) {
      attributes.push(attr('email', [email]));
    }
    if (displayName) attributes.push(attr('displayName', [displayName]));
    if (groups.length) attributes.push(attr('groups', groups));

    const xml = `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${responseId}" Version="2.0" IssueInstant="${now.toISOString()}" Destination="${destination}" InResponseTo="${inResponseTo}"><saml:Issuer>${entityId}</saml:Issuer><samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status><saml:Assertion ID="${assertionId}" Version="2.0" IssueInstant="${now.toISOString()}"><saml:Issuer>${entityId}</saml:Issuer><saml:Subject><saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified">${subject}</saml:NameID><saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><saml:SubjectConfirmationData NotOnOrAfter="${expiry}" Recipient="${destination}" InResponseTo="${inResponseTo}"/></saml:SubjectConfirmation></saml:Subject><saml:Conditions NotBefore="${notBefore}" NotOnOrAfter="${expiry}"><saml:AudienceRestriction><saml:Audience>${audience}</saml:Audience></saml:AudienceRestriction></saml:Conditions><saml:AuthnStatement AuthnInstant="${now.toISOString()}" SessionIndex="${assertionId}"><saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement>${attributes.length ? `<saml:AttributeStatement>${attributes.join('')}</saml:AttributeStatement>` : ''}</saml:Assertion></samlp:Response>`;

    // Only the assertion is signed, which is what most IdPs do by default.
    const sig = new SignedXml({
      privateKey: signWith || privateKey,
      signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
      canonicalizationAlgorithm: 'http://www.w3.org/2001/10/xml-exc-c14n#',
    });
    sig.addReference({
      xpath: "//*[local-name(.)='Assertion']",
      digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
      transforms: [
        'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
        'http://www.w3.org/2001/10/xml-exc-c14n#',
      ],
    });
    sig.computeSignature(xml, {
      location: { reference: "//*[local-name(.)='Assertion']/*[local-name(.)='Issuer']", action: 'after' },
    });

    return Buffer.from(sig.getSignedXml()).toString('base64');
  }

  function attr(name, values) {
    return `<saml:Attribute Name="${name}" NameFormat="urn:oasis:names:tc:SAML:2.0:attrname-format:basic">${
      values.map((v) => `<saml:AttributeValue>${v}</saml:AttributeValue>`).join('')
    }</saml:Attribute>`;
  }

  return { entityId, publicKey, privateKey, otherPrivateKey: other.privateKey, buildResponse };
}

module.exports = { startOidcIdp, createSamlIdp };
