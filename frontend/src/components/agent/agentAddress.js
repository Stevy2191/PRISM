// What the Devices tab needs to know about the address staff are using, since
// the install command carries it (window.location.origin).

// The agent enrols only over https://, or http:// on this machine itself
// (agent/internal/enroll CheckURL), so a plain-HTTP LAN address won't work.
export function agentNeedsHttps(protocol, hostname) {
  if (protocol === 'https:') return false;
  return !['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname);
}

// PRISM serves its test certificate authority at /prism-test-ca.crt when
// setup.sh made one, and 404s otherwise. Anything else (an app page from a
// dev server's fallback, say) isn't a certificate.
export function isTestCertificate(status, contentType) {
  return status === 200 && /x509|pkix-cert/i.test(contentType || '');
}
