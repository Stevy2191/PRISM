const { verifySender, isMicrosoftHost } = require('../../src/services/email/senderAuth');

// Staff mail is believed only on the receiving server's own verdict: the
// top-most Authentication-Results (or the one from the configured trusted
// server) must say dmarc=pass for the From domain. Microsoft 365 internal
// mail also passes, but only on a Microsoft-hosted mailbox.

const FROM = 'tina@acme.com';
// Strict mode trusts only the named receiving server (user decision
// 2026-10-15): with no name, nothing but M365 internal mail can pass.
const strict = { mode: 'strict', trustedAuthServId: 'mx.google.com', microsoftMailbox: false };
const unnamed = { ...strict, trustedAuthServId: '' };
const headers = (obj) => new Map(Object.entries(obj));

const GMAIL_PASS = 'mx.google.com;\r\n       dkim=pass header.i=@acme.com header.s=s1 header.b=AbC;\r\n'
  + '       spf=pass (google.com: domain of tina@acme.com designates 203.0.113.5 as permitted sender) smtp.mailfrom=tina@acme.com;\r\n'
  + '       dmarc=pass (p=REJECT sp=REJECT dis=NONE) header.from=acme.com';
const M365_PASS = 'spf=pass (sender IP is 203.0.113.9) smtp.mailfrom=acme.com; dkim=pass (signature was verified) '
  + 'header.d=acme.com;dmarc=pass action=none header.from=acme.com;compauth=pass reason=100';
const M365_FAIL = 'spf=fail (sender IP is 198.51.100.7) smtp.mailfrom=acme.com; dkim=none (message not signed) '
  + 'header.d=none;dmarc=fail action=quarantine header.from=acme.com;compauth=fail reason=000';

it('gmail dmarc=pass passes', () => {
  expect(verifySender(headers({ 'authentication-results': GMAIL_PASS }), FROM, strict)).toEqual({ verified: true, reason: expect.any(String) });
});

it('no trusted server set: even a top-most pass fails (the receiving host may add none)', () => {
  // A host that stamps nothing leaves the sender's own forged header on top.
  expect(verifySender(headers({ 'authentication-results': GMAIL_PASS }), FROM, unnamed)).toEqual({ verified: false, reason: expect.stringMatching(/trusted mail server/i) });
  expect(verifySender(headers({ 'authentication-results': M365_PASS }), 'Tina@ACME.com', unnamed).verified).toBe(false);
  // M365 internal mail on a Microsoft mailbox still passes without a name.
  expect(verifySender(headers({ 'x-ms-exchange-organization-authas': 'Internal' }), FROM, { ...unnamed, microsoftMailbox: true }).verified).toBe(true);
});

it('m365 internal AuthAs passes', () => {
  const h = headers({ 'x-ms-exchange-organization-authas': 'Internal' });
  expect(verifySender(h, FROM, { ...strict, microsoftMailbox: true }).verified).toBe(true);
});

it('m365 AuthAs on a non-Microsoft mailbox fails', () => {
  const h = headers({ 'x-ms-exchange-organization-authas': 'Internal', 'authentication-results': 'mx.google.com; dmarc=fail header.from=acme.com' });
  expect(verifySender(h, FROM, strict).verified).toBe(false);
  expect(verifySender(headers({ 'x-ms-exchange-organization-authas': 'Anonymous' }), FROM, { ...strict, microsoftMailbox: true }).verified).toBe(false);
});

it('dmarc=fail fails', () => {
  expect(verifySender(headers({ 'authentication-results': `mx.google.com; ${M365_FAIL}` }), FROM, strict)).toEqual({ verified: false, reason: expect.stringMatching(/dmarc/i) });
  expect(verifySender(headers({ 'authentication-results': 'mx.google.com; dmarc=none header.from=acme.com' }), FROM, strict).verified).toBe(false);
});

it('no header fails', () => {
  expect(verifySender(headers({}), FROM, strict).verified).toBe(false);
  expect(verifySender(null, FROM, strict).verified).toBe(false);
  expect(verifySender(headers({ 'authentication-results': GMAIL_PASS }), '', strict).verified).toBe(false);
});

it('forged pass below a real fail fails', () => {
  const h = headers({ 'authentication-results': ['mx.google.com; dmarc=fail (p=REJECT) header.from=acme.com', GMAIL_PASS] });
  expect(verifySender(h, FROM, unnamed).verified).toBe(false);
  expect(verifySender(h, FROM, strict).verified).toBe(false);
});

it('header.from of another domain fails', () => {
  const h = headers({ 'authentication-results': 'mx.google.com; dmarc=pass header.from=evil.example' });
  expect(verifySender(h, FROM, strict).verified).toBe(false);
  // A subdomain is another domain.
  expect(verifySender(headers({ 'authentication-results': 'mx.google.com; dmarc=pass header.from=mail.acme.com' }), FROM, strict).verified).toBe(false);
  // header.from tucked inside a comment doesn't count.
  expect(verifySender(headers({ 'authentication-results': 'mx.google.com; dmarc=pass (header.from=acme.com) header.from=evil.example' }), FROM, strict).verified).toBe(false);
});

it('trustedAuthServId picks the matching header', () => {
  const h = headers({
    'authentication-results': [
      'relay.other.example; dmarc=fail header.from=acme.com',
      'MX.Receiver.example 1; dmarc=pass header.from=acme.com',
      'attacker.example; dmarc=pass header.from=acme.com',
    ],
  });
  expect(verifySender(h, FROM, { ...strict, trustedAuthServId: 'mx.receiver.example' }).verified).toBe(true);
  expect(verifySender(h, FROM, { ...strict, trustedAuthServId: 'nope.example' }).verified).toBe(false);
  // With a trusted id, a header without one (M365 style) never counts.
  expect(verifySender(headers({ 'authentication-results': M365_PASS }), FROM, { ...strict, trustedAuthServId: 'mx.receiver.example' }).verified).toBe(false);
});

it('off mode always verifies', () => {
  expect(verifySender(headers({}), FROM, { ...strict, mode: 'off' })).toEqual({ verified: true, reason: expect.any(String) });
});

it('isMicrosoftHost knows Microsoft\'s IMAP hosts', () => {
  for (const h of ['outlook.office365.com', 'OUTLOOK.office365.com', 'imap-mail.outlook.com', 'outlook.office.com']) expect(isMicrosoftHost(h)).toBe(true);
  for (const h of ['imap.gmail.com', 'outlook.office365.com.evil.example', 'evil-outlook.com', '', null]) expect(isMicrosoftHost(h)).toBe(false);
});
