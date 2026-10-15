// Is a staff member's email really from them? (spec 5a, "Sender
// verification"). PRISM can't check signatures itself after the fact; it
// trusts only the verdict the receiving mail server stamped on the message:
// the top-most Authentication-Results header (anything below it may have
// been written by the sender), or the one from the configured trusted
// server. Pass = dmarc=pass for exactly the From domain.

// Microsoft's IMAP hosts. Only Exchange strips forged copies of
// X-MS-Exchange-Organization-AuthAs from outside mail, so that header only
// counts when the helpdesk mailbox is on Microsoft (user decision 2026-10-15).
const MICROSOFT_HOST = /^(?:[a-z0-9-]+\.)*(?:outlook\.com|office365\.com|outlook\.office\.com)$/i;
const isMicrosoftHost = (host) => MICROSOFT_HOST.test(String(host || '').trim());

function headerValues(headers, name) {
  if (!headers) return [];
  const v = typeof headers.get === 'function' ? headers.get(name) : headers[name];
  if (v === undefined || v === null) return [];
  return (Array.isArray(v) ? v : [v]).map((x) => (typeof x === 'string' ? x : String((x && x.value) || x)));
}

// "authserv-id [version]; method=result prop=value; ..." → { servId, results }.
// Comments in parentheses are dropped first, so nothing inside one counts.
function parseAuthResults(value) {
  let text = String(value).replace(/\s+/g, ' ');
  for (let prev = ''; prev !== text;) { prev = text; text = text.replace(/\([^()]*\)/g, ' '); }
  const parts = text.split(';').map((p) => p.trim()).filter(Boolean);
  // Microsoft 365 writes no authserv-id: the header starts with a result.
  const hasId = parts.length && !parts[0].includes('=');
  return {
    servId: hasId ? parts[0].split(' ')[0].toLowerCase() : null,
    results: hasId ? parts.slice(1) : parts,
  };
}

function verifySender(headers, fromAddress, { mode = 'strict', trustedAuthServId = '', microsoftMailbox = false } = {}) {
  if (mode === 'off') return { verified: true, reason: 'Sender check is off' };
  const from = String(fromAddress || '').trim().toLowerCase();
  const fromDomain = from.includes('@') ? from.slice(from.lastIndexOf('@') + 1) : '';
  if (!fromDomain) return { verified: false, reason: 'No From address' };

  if (microsoftMailbox) {
    const authAs = headerValues(headers, 'x-ms-exchange-organization-authas')[0];
    if (authAs && authAs.trim().toLowerCase() === 'internal') return { verified: true, reason: 'Microsoft 365 internal mail' };
  }

  const all = headerValues(headers, 'authentication-results').map(parseAuthResults);
  const trusted = String(trustedAuthServId || '').trim().toLowerCase();
  const chosen = trusted ? all.find((h) => h.servId === trusted) : all[0];
  if (!chosen) return { verified: false, reason: trusted ? `No result from ${trusted}` : 'No Authentication-Results header' };

  const dmarc = chosen.results.find((r) => /^dmarc\s*=/i.test(r));
  if (!dmarc) return { verified: false, reason: 'No DMARC result' };
  const result = /^dmarc\s*=\s*([a-z]+)/i.exec(dmarc)[1].toLowerCase();
  const headerFrom = (/\bheader\.from\s*=\s*"?([^\s;"]+)/i.exec(dmarc) || [])[1];
  if (result !== 'pass') return { verified: false, reason: `DMARC ${result}` };
  if (!headerFrom || headerFrom.toLowerCase() !== fromDomain) return { verified: false, reason: 'DMARC passed for a different domain' };
  return { verified: true, reason: 'DMARC pass' };
}

module.exports = { verifySender, isMicrosoftHost, parseAuthResults };
