const { buildReplyRecipients, normalizeEmailList } = require('../../src/services/email/recipients');

// Who a public reply goes to: the contact (To), the ticket's CC list and the
// reply's one-off CC (Cc), the one-off BCC (Bcc). Never PRISM's own mailbox.

const base = {
  contactEmail: 'ann@acme.com', ccList: [], extraCc: [], extraBcc: [], ownAddresses: ['help@prism.example', 'noreply@prism.example'],
};

it('to/cc/bcc de-duplicate with to winning', () => {
  const r = buildReplyRecipients({
    ...base,
    ccList: ['bob@acme.com', 'ANN@acme.com'],
    extraCc: ['carl@acme.com', 'bob@acme.com'],
    extraBcc: ['Ann@Acme.com', 'bob@acme.com', 'dee@acme.com', 'dee@acme.com'],
  });
  expect(r).toEqual({ to: ['ann@acme.com'], cc: ['bob@acme.com', 'carl@acme.com'], bcc: ['dee@acme.com'] });
});

it('own mailbox addresses are dropped', () => {
  const r = buildReplyRecipients({
    ...base, contactEmail: 'HELP@prism.example', ccList: ['noreply@prism.example'], extraBcc: ['help@prism.example', 'x@y.com'],
  });
  expect(r).toEqual({ to: [], cc: [], bcc: ['x@y.com'] });
});

it('invalid addresses are dropped', () => {
  const r = buildReplyRecipients({
    ...base, contactEmail: null, ccList: ['not-an-email', 'a,b@x.com', 'evil@x.com\r\nBcc: z@z.com', ' ok@x.com '],
  });
  expect(r).toEqual({ to: [], cc: ['ok@x.com'], bcc: [] });
});

it('more than 20 extra is a 400', () => {
  const many = Array.from({ length: 21 }, (_, i) => `p${i}@x.com`);
  for (const extra of [{ extraCc: many }, { extraBcc: many }]) {
    expect(() => buildReplyRecipients({ ...base, ...extra })).toThrow(expect.objectContaining({ status: 400 }));
  }
  expect(() => buildReplyRecipients({ ...base, extraCc: many.slice(0, 20) })).not.toThrow();
});

it('normalizeEmailList accepts a list or a separated string and refuses bad input', () => {
  expect(normalizeEmailList(undefined)).toEqual([]);
  expect(normalizeEmailList('A@x.com, b@x.com; a@x.com')).toEqual(['a@x.com', 'b@x.com']);
  expect(normalizeEmailList([' C@x.com ', ''])).toEqual(['c@x.com']);
  for (const bad of ['nope', ['a@x.com', 42], { a: 1 }, ['<a@x.com>'], [`${'a'.repeat(250)}@x.com`]]) {
    expect(() => normalizeEmailList(bad)).toThrow(expect.objectContaining({ status: 400 }));
  }
  expect(() => normalizeEmailList(Array.from({ length: 21 }, (_, i) => `p${i}@x.com`))).toThrow(expect.objectContaining({ status: 400 }));
});
