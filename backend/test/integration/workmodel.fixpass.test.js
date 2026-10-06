const { resetData, closeDb, models } = require('./helpers');
const {
  API, expectOk, makeWorld, makeTech, makeTicket, makeCompany, makeContact, setCompanyAccess, setSettings,
} = require('./fixtures');

// Plan 3b-1's final review: the findings fixed in its one fix pass.

let w;
beforeEach(async () => {
  await resetData();
  w = await makeWorld();
});
afterAll(closeDb);

it('I-2: dashboard hours only count companies the viewer can reach', async () => {
  const acme = await makeCompany(w.admin, { name: 'Acme' });
  const ann = await makeContact(w.admin, { firstName: 'Ann', companyId: acme.id });
  const tina = await makeTech('tina', w.deptA.id);
  const acmeTicket = await makeTicket(w.admin.agent, { title: 'Acme job', contactId: ann.id });
  expectOk(await tina.agent.post(`${API}/tickets/${acmeTicket.id}/time`).send({ durationMinutes: 60 }), 201);
  const viewer = await makeTech('viewer', w.deptA.id);
  expectOk(await w.admin.agent.post(`${API}/users/${viewer.user.id}/overrides`).send({ permissionKey: 'tickets.view_all', granted: true }), 201);
  const internalId = (await models.Company.findOne({ where: { isInternal: true } })).id;
  await setCompanyAccess(w.admin, viewer.user.id, { allCompanies: false, companyIds: [internalId] });
  const total = async (u) => expectOk(await u.agent.get(`${API}/dashboard?userId=${tina.user.id}`)).hours.total;
  expect(await total(w.admin)).toBe(1);
  expect(await total(viewer)).toBe(0);
});

it('I5: a custom report range on a date-only field is whole calendar days', async () => {
  for (const [day, title] of [['2026-02-28', 'Due before'], ['2026-03-01', 'Due first'], ['2026-03-02', 'Due after']]) {
    // eslint-disable-next-line no-await-in-loop
    await makeTicket(w.admin.agent, { title, contactId: w.contact.id, dueDate: day });
  }
  for (const zone of ['America/Chicago', 'Asia/Tokyo']) {
    // eslint-disable-next-line no-await-in-loop
    await setSettings(w.admin, { 'company.timezone': zone });
    // eslint-disable-next-line no-await-in-loop
    const { tableData } = expectOk(await w.admin.agent.post(`${API}/reports/custom`).send({
      dataSource: 'tickets', filters: { dateField: 'dueDate', startDate: '2026-03-01', endDate: '2026-03-01' },
    }));
    expect([zone, tableData.rows.map((r) => r.title)]).toEqual([zone, ['Due first']]);
  }
});

it('M5: sending userId null or empty on an edit changes nothing', async () => {
  const tech = await makeTech('tech', w.deptA.id);
  const t = await makeTicket(w.admin.agent, { title: 'T', contactId: w.contact.id, departmentId: w.deptA.id });
  const e = expectOk(await tech.agent.post(`${API}/tickets/${t.id}/time`).send({ durationMinutes: 5 }), 201).entry;
  for (const userId of [null, '']) {
    // eslint-disable-next-line no-await-in-loop
    const edited = expectOk(await w.admin.agent.patch(`${API}/tickets/${t.id}/time/${e.id}`).send({ userId, note: 'x' })).entry;
    expect(edited.userId).toBe(tech.user.id);
  }
});

it('M7: replacing a timer whose ticket was deleted says so', async () => {
  const tech = await makeTech('tech', w.deptA.id);
  const gone = await makeTicket(w.admin.agent, { title: 'Gone', contactId: w.contact.id, departmentId: w.deptA.id });
  const next = await makeTicket(w.admin.agent, { title: 'Next', contactId: w.contact.id, departmentId: w.deptA.id });
  expectOk(await tech.agent.post(`${API}/timer/start`).send({ type: 'ticket', id: gone.id }), 201);
  expectOk(await w.admin.agent.delete(`${API}/tickets/${gone.id}`));
  const res = expectOk(await tech.agent.post(`${API}/timer/start`).send({ type: 'ticket', id: next.id }), 201);
  expect(res).toEqual(expect.objectContaining({
    logged: null, discarded: 'The ticket or project this timer was running on has been deleted, so its time was discarded.',
  }));
});
