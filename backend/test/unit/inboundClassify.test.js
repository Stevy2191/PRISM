const { findTicketNumber, findTicketRef, classifyInbound } = require('../../src/services/email/inboundClassify');

// The one decision function for inbound mail (spec 5a, "Inbound matching"),
// one case per row of the spec's list.

const base = {
  ticketFound: false, senderKind: 'other', verified: false, staffCanEdit: false, hasCustomerRecipient: false,
};
const classify = (over) => classifyInbound({ ...base, ...over });

describe('with a ticket', () => {
  it('contact side → reply added', () => {
    expect(classify({ ticketFound: true, senderKind: 'contact_side' })).toBe('reply_added');
  });
  it('staff, verified, can edit → staff reply added', () => {
    expect(classify({ ticketFound: true, senderKind: 'staff', verified: true, staffCanEdit: true })).toBe('staff_reply_added');
  });
  it('staff, unverified → unverified note', () => {
    expect(classify({ ticketFound: true, senderKind: 'staff', verified: false, staffCanEdit: true })).toBe('unverified_note');
  });
  it('staff, verified, without edit rights → unverified note', () => {
    expect(classify({ ticketFound: true, senderKind: 'staff', verified: true, staffCanEdit: false })).toBe('unverified_note');
  });
  it('anyone else → a new ticket for them', () => {
    expect(classify({ ticketFound: true, senderKind: 'other', verified: true, staffCanEdit: true })).toBe('ticket_created');
  });
});

describe('without a ticket', () => {
  it('staff, verified, with a customer recipient → staff ticket created', () => {
    expect(classify({ senderKind: 'staff', verified: true, hasCustomerRecipient: true })).toBe('staff_ticket_created');
  });
  it('staff, unverified, with a customer recipient → unverified staff ticket', () => {
    expect(classify({ senderKind: 'staff', verified: false, hasCustomerRecipient: true })).toBe('staff_ticket_unverified');
  });
  it('staff with no customer on the email → ignored', () => {
    expect(classify({ senderKind: 'staff', verified: true })).toBe('ignored');
    expect(classify({ senderKind: 'staff', verified: false })).toBe('ignored');
  });
  it('anyone else → a new ticket', () => {
    expect(classify({ senderKind: 'other' })).toBe('ticket_created');
    // "Contact side" only means something against a ticket.
    expect(classify({ senderKind: 'contact_side' })).toBe('ticket_created');
  });
});

it('findTicketNumber: [Ticket #00012], "Re: #12 printer", "PO#12x" (no match), headers', () => {
  expect(findTicketNumber('Re: [Ticket #00012] Printer', null, null)).toBe(12);
  expect(findTicketNumber('Re: #12 printer', null, null)).toBe(12);
  expect(findTicketNumber('#12', null, null)).toBe(12);
  expect(findTicketNumber('Fwd: [#7] x', null, null)).toBe(7);
  expect(findTicketNumber('ticket #9: still broken', null, null)).toBe(9);
  expect(findTicketNumber('PO#12x', null, null)).toBeNull();
  expect(findTicketNumber('order #12x and #abc', null, null)).toBeNull();
  expect(findTicketNumber('No number here', null, null)).toBeNull();
  // The bracket form wins over a loose number.
  expect(findTicketNumber('#3 re [Ticket #00004]', null, null)).toBe(4);
  // Headers are the fallback.
  expect(findTicketNumber('Re: hi', '<prism-ticket-34-1700000000@x.com>', null)).toBe(34);
  expect(findTicketNumber('Re: hi', null, ['<a@b>', '<prism-ticket-35-1@x.com>'])).toBe(35);
  expect(findTicketNumber('Re: hi', null, '<prism-ticket-36-1@x.com>')).toBe(36);
  // Absurd numbers are not ticket ids.
  expect(findTicketNumber('#0', null, null)).toBeNull();
  expect(findTicketNumber('#99999999999999999999', null, null)).toBeNull();
  expect(findTicketNumber(undefined, undefined, undefined)).toBeNull();
});

it('findTicketRef says whether only a bare #N matched', () => {
  expect(findTicketRef('Re: [Ticket #00012]', null, null)).toEqual({ id: 12, loose: false });
  expect(findTicketRef('Invoice #4471 overdue', null, null)).toEqual({ id: 4471, loose: true });
  // PRISM's own threading beats a bare number in the subject.
  expect(findTicketRef('Invoice #4471', '<prism-ticket-9-1@x.com>', null)).toEqual({ id: 9, loose: false });
  expect(findTicketRef('nothing', null, null)).toBeNull();
});
