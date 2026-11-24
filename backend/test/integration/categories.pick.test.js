const {
  resetData, closeDb, models,
} = require('./helpers');
const {
  API, expectOk, makeWorld, makeCompany, makeContact, makeTicket,
} = require('./fixtures');
const { createTicket } = require('../../src/services/tickets/ticketWrite');
const { getSystemActorUserId } = require('../../src/services/inboundEmailService');

// Sub-project 9, task 4: a category can ask "which app?", answered from the
// ticket company's software list, or Not listed.

let w;
let alpha;
let beta;
let amy; // alpha's contact
let bob; // beta's contact
let apps; // alpha: Software (asks which app)
let line; // alpha: Software → Won't open (inherits the question)
let net; // alpha: Network (doesn't ask)
let dentrix;
let acrobat;
let clio; // beta's app
const a = () => w.admin.agent;
const cat = async (body) => expectOk(await a().post(`${API}/ticket-categories`).send(body), 201).category;
const item = async (c, name, extra = {}) => expectOk(await a().post(`${API}/companies/${c.id}/catalog`).send({ kind: 'software', name, ...extra }), 201).item;
const ticketOf = async (id) => expectOk(await a().get(`${API}/tickets/${id}`)).ticket;
async function raise(contact, fields) {
  const actorId = await getSystemActorUserId();
  return createTicket({ id: actorId }, { title: 'Help', description: 'Please', contactId: contact.id, ...fields }, {
    createdById: actorId, source: 'portal', portal: { contact, raisedBy: contact }, requireCategory: true,
  });
}

beforeEach(async () => {
  await resetData();
  w = await makeWorld();
  alpha = await makeCompany(w.admin, { name: 'Alpha Dental' });
  beta = await makeCompany(w.admin, { name: 'Beta Law' });
  amy = await models.Contact.findByPk((await makeContact(w.admin, { companyId: alpha.id, firstName: 'Amy', lastName: 'Ng' })).id);
  bob = await models.Contact.findByPk((await makeContact(w.admin, { companyId: beta.id, firstName: 'Bob', lastName: 'Ray' })).id);
  apps = await cat({ name: 'Software', companyId: alpha.id, pickKind: 'software' });
  line = await cat({ name: "Won't open", parentId: apps.id, companyId: alpha.id });
  net = await cat({ name: 'Network', companyId: alpha.id });
  dentrix = await item(alpha, 'Dentrix');
  acrobat = await item(alpha, 'Acrobat');
  clio = await item(beta, 'Clio');
});
afterAll(closeDb);

it('a category says it asks which app; only software, or nothing', async () => {
  expect(apps.pickKind).toBe('software');
  expect(net.pickKind).toBeNull();
  const listed = expectOk(await a().get(`${API}/ticket-categories`).query({ companyId: alpha.id })).categories;
  expect(listed.find((c) => c.id === apps.id).pickKind).toBe('software');
  expect((await a().patch(`${API}/ticket-categories/${net.id}`).send({ pickKind: 'printer' })).status).toBe(400);
  expect(expectOk(await a().patch(`${API}/ticket-categories/${net.id}`).send({ pickKind: 'software' })).category.pickKind).toBe('software');
  expect(expectOk(await a().patch(`${API}/ticket-categories/${net.id}`).send({ pickKind: null })).category.pickKind).toBeNull();
});

it('staff record the app on the category, or below it; Not listed works too', async () => {
  const t = await makeTicket(a(), { title: 'Dentrix crashed', contactId: amy.id, categoryId: line.id, catalogItemId: dentrix.id });
  const shown = await ticketOf(t.id);
  expect(shown).toMatchObject({ catalogItemId: dentrix.id, catalogItemNotListed: false });
  expect(shown.catalogItem).toMatchObject({ id: dentrix.id, name: 'Dentrix' });

  const n = await makeTicket(a(), { title: 'Some app', contactId: amy.id, categoryId: apps.id, catalogItemNotListed: true });
  expect(await ticketOf(n.id)).toMatchObject({ catalogItemId: null, catalogItemNotListed: true });
  // Both at once is refused.
  expect((await a().post(`${API}/tickets`).send({
    title: 'x', contactId: amy.id, categoryId: apps.id, catalogItemId: dentrix.id, catalogItemNotListed: true,
  })).status).toBe(400);
});

it('refuses another company\'s app, a turned-off one, and an app on a category that doesn\'t ask', async () => {
  const send = (fields) => a().post(`${API}/tickets`).send({ title: 'x', contactId: amy.id, ...fields });
  expect((await send({ categoryId: apps.id, catalogItemId: clio.id })).status).toBe(400);
  expect((await send({ categoryId: net.id, catalogItemId: dentrix.id })).status).toBe(400);
  expect((await send({ categoryId: net.id, catalogItemNotListed: true })).status).toBe(400);
  expect((await send({ catalogItemId: dentrix.id })).status).toBe(400);
  await a().patch(`${API}/companies/${alpha.id}/catalog/${acrobat.id}`).send({ active: false }).expect(200);
  expect((await send({ categoryId: apps.id, catalogItemId: acrobat.id })).status).toBe(400);
  // An item of another kind (only software is offered today) is refused.
  const printer = await models.CompanyCatalogItem.create({ companyId: alpha.id, kind: 'printer', name: 'HP 400' });
  expect((await send({ categoryId: apps.id, catalogItemId: printer.id })).status).toBe(400);
});

it('a stored app survives being turned off; a new category or company clears it', async () => {
  const t = await makeTicket(a(), { title: 'Acrobat', contactId: amy.id, categoryId: apps.id, catalogItemId: acrobat.id });
  await a().patch(`${API}/companies/${alpha.id}/catalog/${acrobat.id}`).send({ active: false }).expect(200);
  // Re-sending the stored app unchanged is fine.
  expectOk(await a().patch(`${API}/tickets/${t.id}`).send({ title: 'Acrobat again', catalogItemId: acrobat.id }));
  expect((await ticketOf(t.id)).catalogItemId).toBe(acrobat.id);
  // A category that doesn't ask clears it.
  expectOk(await a().patch(`${API}/tickets/${t.id}`).send({ categoryId: net.id }));
  expect(await ticketOf(t.id)).toMatchObject({ catalogItemId: null, catalogItemNotListed: false });

  // Moving to another company clears the app with the category.
  const u = await makeTicket(a(), { title: 'Dentrix', contactId: amy.id, categoryId: apps.id, catalogItemId: dentrix.id });
  expectOk(await a().patch(`${API}/tickets/${u.id}`).send({ contactId: bob.id }));
  expect(await ticketOf(u.id)).toMatchObject({ categoryId: null, catalogItemId: null, catalogItemNotListed: false });

  // Deleting an app from the list leaves the ticket without it.
  const v = await makeTicket(a(), { title: 'Dentrix', contactId: amy.id, categoryId: apps.id, catalogItemId: dentrix.id });
  expectOk(await a().delete(`${API}/companies/${alpha.id}/catalog/${dentrix.id}`));
  expect((await ticketOf(v.id)).catalogItemId).toBeNull();
});

it('the portal and the agent must answer which app, unless not sure', async () => {
  await expect(raise(amy, { categoryId: apps.id })).rejects.toThrow(/Choose the app, or Not listed/);
  expect((await raise(amy, { categoryId: apps.id, catalogItemId: dentrix.id })).catalogItemId).toBe(dentrix.id);
  expect((await raise(amy, { categoryId: line.id, catalogItemNotListed: true })).catalogItemNotListed).toBe(true);
  expect((await raise(amy, { categoryId: apps.id, categoryUnsure: true })).catalogItemId).toBeNull();
  await expect(raise(amy, { categoryId: apps.id, catalogItemId: clio.id })).rejects.toThrow(/App not found/);
});

it('merging companies brings the list along; a shared name points at the one kept', async () => {
  const theirs = await item(beta, 'Dentrix'); // the same app on both lists
  const bApps = await cat({ name: 'Apps', companyId: beta.id, pickKind: 'software' });
  const t = await makeTicket(a(), { title: 'Dentrix', contactId: bob.id, categoryId: bApps.id, catalogItemId: theirs.id });
  expectOk(await a().post(`${API}/companies/${beta.id}/merge`).send({ intoCompanyId: alpha.id }));
  const names = expectOk(await a().get(`${API}/companies/${alpha.id}/catalog`).query({ kind: 'software' })).items.map((i) => i.name);
  expect(names.sort()).toEqual(['Acrobat', 'Clio', 'Dentrix']);
  expect((await ticketOf(t.id)).catalogItemId).toBe(dentrix.id);
});

it('reports and the ticket list (task 9): the App column, grouping by app, categories by company, a filter by app', async () => {
  const run = async (body) => expectOk(await a().post(`${API}/reports/custom`).send({ dataSource: 'tickets', ...body }));
  const meta = expectOk(await a().get(`${API}/reports/custom/metadata`)).dataSources.find((d) => d.key === 'tickets');
  expect(meta.fields.map((f) => f.key)).toContain('app');
  expect(meta.groupBy).toContain('app');

  const t1 = await makeTicket(a(), { title: 'D1', contactId: amy.id, categoryId: apps.id, catalogItemId: dentrix.id });
  await makeTicket(a(), { title: 'D2', contactId: amy.id, categoryId: line.id, catalogItemId: dentrix.id });
  await makeTicket(a(), { title: 'NL', contactId: amy.id, categoryId: apps.id, catalogItemNotListed: true });
  await makeTicket(a(), { title: 'Net', contactId: amy.id, categoryId: net.id });
  const bNet = await cat({ name: 'Network', companyId: beta.id });
  await makeTicket(a(), { title: 'B net', contactId: bob.id, categoryId: bNet.id });

  const { tableData } = await run({ fields: ['title', 'app'] });
  expect(tableData.rows.find((r) => r.id === t1.id).app).toBe('Dentrix');
  expect(tableData.rows.find((r) => r.title === 'NL').app).toBe('Not listed');

  const byApp = Object.fromEntries((await run({ fields: ['title'], groupBy: 'app' })).chartData.map((g) => [g.name, g.count]));
  expect(byApp).toEqual({ Dentrix: 2, 'Not listed': 1, 'No app': 2 });

  // Across companies, a category is named with its company: two "Network"s stay apart.
  const byCat = Object.fromEntries((await run({ fields: ['title'], groupBy: 'category' })).chartData.map((g) => [g.name, g.count]));
  expect(byCat['Alpha Dental · Network']).toBe(1);
  expect(byCat['Beta Law · Network']).toBe(1);
  // One company: just the path.
  const oneCo = Object.fromEntries((await run({ fields: ['title'], groupBy: 'category', filters: { companyId: alpha.id } })).chartData.map((g) => [g.name, g.count]));
  expect(oneCo.Network).toBe(1);

  const listed = expectOk(await a().get(`${API}/tickets`).query({ catalogItemId: dentrix.id })).tickets.map((t) => t.title).sort();
  expect(listed).toEqual(['D1', 'D2']);
});

it('review: a stored app re-sent unchanged still saves after its category stops asking', async () => {
  const t = await makeTicket(a(), { title: 'Dentrix', contactId: amy.id, categoryId: apps.id, catalogItemId: dentrix.id });
  await a().patch(`${API}/ticket-categories/${apps.id}`).send({ pickKind: null }).expect(200);
  // A client PATCHing the ticket back as it was.
  expectOk(await a().patch(`${API}/tickets/${t.id}`).send({ title: 'Dentrix again', categoryId: apps.id, catalogItemId: dentrix.id }));
  expect((await ticketOf(t.id)).catalogItemId).toBe(dentrix.id);
  // But a new app on it is refused, and a new category that doesn't ask clears it.
  expect((await a().patch(`${API}/tickets/${t.id}`).send({ catalogItemId: acrobat.id })).status).toBe(400);
  expectOk(await a().patch(`${API}/tickets/${t.id}`).send({ categoryId: net.id, catalogItemId: dentrix.id }));
  expect((await ticketOf(t.id)).catalogItemId).toBeNull();
});
