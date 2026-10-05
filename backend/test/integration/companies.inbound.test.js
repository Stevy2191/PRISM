const { resetData, closeDb, models } = require('./helpers');
const { makeWorld } = require('./fixtures');
const { findOrCreateContact } = require('../../src/services/inboundEmailService');

// Inbound email files a new contact under the company that owns the
// sender's domain (plan 2a task 11).

const { Company, CompanyDomain, Contact } = models;

let acme;
let internalId;
beforeEach(async () => {
  await resetData();
  await makeWorld();
  internalId = (await Company.findOne({ where: { isInternal: true } })).id;
  acme = await Company.create({ name: 'Acme', isClient: true });
  await CompanyDomain.create({ companyId: acme.id, domain: 'acme.com' });
});
afterAll(closeDb);

it('a sender from a company\'s domain becomes that company\'s contact', async () => {
  const c = await findOrCreateContact('Ann.Smith@ACME.com', 'Ann Smith');
  expect(c.companyId).toBe(acme.id);
});

it('an unknown domain goes to the internal company', async () => {
  expect((await findOrCreateContact('bob@elsewhere.org', 'Bob')).companyId).toBe(internalId);
});

it('a free-mail domain never matches, even if someone listed it', async () => {
  // The API refuses free-mail domains; this proves the matcher refuses them
  // too, should one ever be inserted directly.
  await CompanyDomain.create({ companyId: acme.id, domain: 'gmail.com' });
  expect((await findOrCreateContact('carol@gmail.com', 'Carol')).companyId).toBe(internalId);
});

it('an inactive company\'s domain doesn\'t match', async () => {
  await acme.update({ status: 'inactive' });
  expect((await findOrCreateContact('dan@acme.com', 'Dan')).companyId).toBe(internalId);
});

it('a vendor-only company\'s domain doesn\'t match', async () => {
  // Contacts belong to a client or the internal company, never a vendor.
  const dell = await Company.create({ name: 'Dell', isVendor: true });
  await CompanyDomain.create({ companyId: dell.id, domain: 'dell.com' });
  expect((await findOrCreateContact('rep@dell.com', 'Rep')).companyId).toBe(internalId);
});

it('an existing contact is returned unchanged', async () => {
  const existing = await Contact.create({ firstName: 'Eve', displayName: 'Eve', email: 'eve@acme.com' });
  const found = await findOrCreateContact('eve@acme.com', 'Eve');
  expect([found.id, found.companyId]).toEqual([existing.id, internalId]);
});
