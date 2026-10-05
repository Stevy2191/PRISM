const { resetData, closeDb, models } = require('./helpers');
const { API, expectOk, makeWorld, makeTicket } = require('./fixtures');

const { Company, Contact, Ticket, Department, Site } = models;

let w;
let internalId;
beforeEach(async () => {
  await resetData();
  w = await makeWorld();
  internalId = (await Company.findOne({ where: { isInternal: true } })).id;
});
afterAll(closeDb);

describe('every record lands in a company', () => {
  it('records created without a company get the internal one', async () => {
    const c = await Contact.create({ firstName: 'Model', displayName: 'Model' });
    const d = await Department.create({ name: 'Model dept', shortCode: 'MD' });
    expect([c.companyId, d.companyId]).toEqual([internalId, internalId]);
  });

  it('a ticket takes its contact\'s company, whatever the caller sends', async () => {
    const acme = await Company.create({ name: 'Acme', isClient: true });
    const c = await Contact.create({ firstName: 'Ann', displayName: 'Ann', companyId: acme.id });
    const t = await Ticket.create({ title: 'x', status: 'Open', priority: 'medium', contactId: c.id, companyId: internalId });
    expect(t.companyId).toBe(acme.id);
  });

  it('a ticket created through the API is in its contact\'s company', async () => {
    const t = await makeTicket(w.admin.agent, { title: 'x', contactId: w.contact.id });
    expect(t.companyId).toBe(internalId);
  });

  it('bulk creates get companies too', async () => {
    // bulkCreate skips per-record hooks unless asked; imports and tests use it.
    const acme = await Company.create({ name: 'Acme', isClient: true });
    const ann = await Contact.create({ firstName: 'Ann', displayName: 'Ann', companyId: acme.id });
    const [d] = await Department.bulkCreate([{ name: 'Bulk dept', shortCode: 'BD' }]);
    const tickets = await Ticket.bulkCreate([
      { title: 'a', status: 'Open', priority: 'medium', contactId: ann.id },
      { title: 'b', status: 'Open', priority: 'medium' },
    ]);
    expect([d.companyId, ...tickets.map((t) => t.companyId)]).toEqual([internalId, acme.id, internalId]);
  });

  it('a ticket with no contact gets the internal company', async () => {
    const t = await Ticket.create({ title: 'Alert', status: 'Open', priority: 'medium' });
    expect(t.companyId).toBe(internalId);
  });
});

describe('a contact moving company', () => {
  it('takes all its tickets, open and closed', async () => {
    const acme = await Company.create({ name: 'Acme', isClient: true });
    const open = await makeTicket(w.admin.agent, { title: 'Open one', contactId: w.contact.id });
    const closed = await makeTicket(w.admin.agent, { title: 'Closed one', contactId: w.contact.id, status: 'Closed' });
    await (await Contact.findByPk(w.contact.id)).update({ companyId: acme.id });
    const companies = (await Ticket.findAll({ where: { id: [open.id, closed.id] } })).map((t) => t.companyId);
    expect(companies).toEqual([acme.id, acme.id]);
  });

  it('drops a department and site that belong to the old company', async () => {
    const acme = await Company.create({ name: 'Acme', isClient: true });
    const site = await Site.create({ companyId: internalId, name: 'HQ' });
    const c = await Contact.findByPk(w.contact.id);
    await c.update({ siteId: site.id });
    await c.update({ companyId: acme.id });
    await c.reload();
    expect([c.departmentId, c.siteId]).toEqual([null, null]);
  });

  it('a ticket edited to another contact follows the new contact\'s company', async () => {
    const acme = await Company.create({ name: 'Acme', isClient: true });
    const ann = await Contact.create({ firstName: 'Ann', displayName: 'Ann', companyId: acme.id });
    const t = await makeTicket(w.admin.agent, { title: 'x', contactId: w.contact.id });
    const { ticket } = expectOk(await w.admin.agent.patch(`${API}/tickets/${t.id}`).send({ contactId: ann.id }));
    expect(ticket.companyId).toBe(acme.id);
  });
});
