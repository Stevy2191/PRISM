const { resetData, closeDb } = require('./helpers');
const {
  API, expectOk, makeWorld, makeTech, makeManager, makeStaff, makeOwnTier, makeProject, makeTask,
  freezeClock, unfreezeClock,
} = require('./fixtures');

let w;
let tech;
let proj;
beforeEach(async () => {
  await resetData();
  w = await makeWorld();
  tech = await makeTech('tech', w.deptA.id);
  proj = await makeProject(tech.agent, { name: 'Refresh', ownerDepartmentId: w.deptA.id });
});
afterEach(unfreezeClock);
afterAll(closeDb);

const EXE = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(64)]);

describe('S5: POST /projects/:id/files checks file content', () => {
  it('rejects an executable disguised as a PDF and stores nothing', async () => {
    const res = await tech.agent.post(`${API}/projects/${proj.id}/files`).attach('file', EXE, 'report.pdf');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_FILE_CONTENT');
    expect(expectOk(await tech.agent.get(`${API}/projects/${proj.id}/files`)).files).toEqual([]);
  });

  it('still accepts an ordinary text file', async () => {
    const res = await tech.agent.post(`${API}/projects/${proj.id}/files`).attach('file', Buffer.from('hello'), 'notes.txt');
    expect(res.status).toBe(201);
    expect(res.body.file).toEqual(expect.objectContaining({ filename: 'notes.txt', filesize: 5 }));
  });
});

const purl = (path, p = proj) => `${API}/projects/${p.id}/${path}`;
const today = () => new Date().toISOString().slice(0, 10);
const otherProject = () => makeProject(w.admin.agent, { name: 'Q', ownerDepartmentId: w.deptB.id });

describe('expenses', () => {
  const create = async (body, agent = tech.agent, p = proj) => expectOk(await agent.post(purl('expenses', p)).send(body), 201).expense;

  it('logs an expense', async () => {
    const t = await makeTask(tech.agent, proj.id, { title: 'Rack' });
    const e = await create({ description: '  Cables  ', amount: '12.5', category: 'materials', entryDate: '2026-01-05', taskId: t.id });
    expect(e).toEqual(expect.objectContaining({
      description: 'Cables', amount: 12.5, category: 'materials', entryDate: '2026-01-05', loggedBy: tech.user.id,
    }));
    expect(e.task).toEqual({ id: t.id, title: 'Rack' });
    const { activity } = expectOk(await tech.agent.get(purl('activity')));
    expect(activity.map((a) => [a.action, a.detail])).toContainEqual(
      ['expense_added', { expenseId: e.id, description: 'Cables', amount: 12.5 }]
    );
  });

  it('expense defaults', async () => {
    const e = await create({ description: 'x', amount: 0 });
    expect(e).toEqual(expect.objectContaining({ category: 'other', entryDate: today(), amount: 0 }));
  });

  it('expense validation', async () => {
    const cases = [
      [{ amount: 1 }, 'Description is required'],
      [{ description: '  ', amount: 1 }, 'Description is required'],
      [{ description: 'x', amount: -1 }, 'Amount must be a non-negative number'],
      [{ description: 'x', amount: 'abc' }, 'Amount must be a non-negative number'],
      [{ description: 'x' }, 'Amount must be a non-negative number'],
    ];
    for (const [body, message] of cases) {
      // eslint-disable-next-line no-await-in-loop
      const res = await tech.agent.post(purl('expenses')).send(body);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: true, message, code: 'VALIDATION_ERROR' });
    }
  });

  it('lists expenses with a whole-project total', async () => {
    await create({ description: 'a', amount: 10, entryDate: '2026-01-01' });
    await create({ description: 'b', amount: 20, entryDate: '2026-01-03' });
    await create({ description: 'c', amount: 30.5, entryDate: '2026-01-02' });
    const body = expectOk(await tech.agent.get(`${purl('expenses')}?limit=2`));
    expect(body.expenses.map((e) => e.entryDate)).toEqual(['2026-01-03', '2026-01-02']);
    expect(body).toEqual(expect.objectContaining({ total: 3, totalAmount: 60.5 }));
  });

  it('updates an expense', async () => {
    const e = await create({ description: 'x', amount: 1 });
    const changes = { description: 'y', amount: 7, category: 'travel', entryDate: '2026-02-01' };
    expect(expectOk(await tech.agent.patch(`${purl('expenses')}/${e.id}`).send(changes)).expense).toEqual(expect.objectContaining(changes));
  });

  // Likely correct: 400 as on create. Expected to change in sub-project 3.
  it('[quirk] Q33: expense update skips the create-time validation', async () => {
    const e = await create({ description: 'x', amount: 1 });
    expect(expectOk(await tech.agent.patch(`${purl('expenses')}/${e.id}`).send({ amount: -5 })).expense.amount).toBe(-5);
  });

  it('deletes an expense', async () => {
    const e = await create({ description: 'x', amount: 1 });
    expect(expectOk(await tech.agent.delete(`${purl('expenses')}/${e.id}`))).toEqual({ ok: true });
    expect(expectOk(await tech.agent.get(purl('expenses'))).expenses).toEqual([]);
  });

  it('an expense from another project is not found through this one', async () => {
    const q = await otherProject();
    const e = await create({ description: 'x', amount: 1 }, w.admin.agent, q);
    for (const res of [
      await w.admin.agent.patch(`${purl('expenses')}/${e.id}`).send({ amount: 2 }),
      await w.admin.agent.delete(`${purl('expenses')}/${e.id}`),
    ]) {
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: true, message: 'Expense not found', code: 'NOT_FOUND' });
    }
  });
});

describe('materials', () => {
  const create = async (body, agent = tech.agent, p = proj) => expectOk(await agent.post(purl('materials', p)).send(body), 201).material;
  const patch = async (m, body) => expectOk(await tech.agent.patch(`${purl('materials')}/${m.id}`).send(body)).material;

  it('adds a material and prices it', async () => {
    const m = await create({
      itemName: ' Switch ', vendor: 'Acme', modelNumber: 'S1', serialNumber: 'SN1', quantity: 3, unitCost: 19.99, notes: 'n',
    });
    expect(m).toEqual(expect.objectContaining({
      itemName: 'Switch', serialNumber: ['SN1'], quantity: 3, unitCost: 19.99, totalCost: 59.97,
    }));
    const { activity } = expectOk(await tech.agent.get(purl('activity')));
    expect(activity.map((a) => [a.action, a.detail])).toContainEqual(['material_added', { materialId: m.id, itemName: 'Switch' }]);
  });

  it('material defaults and serial lists', async () => {
    expect(await create({ itemName: 'x' })).toEqual(expect.objectContaining({
      quantity: 1, unitCost: 0, totalCost: 0, serialNumber: [],
    }));
    expect((await create({ itemName: 'y', serialNumber: ['A', '', null, 'B'] })).serialNumber).toEqual(['A', 'B']);
  });

  it('material validation', async () => {
    const cases = [
      [{}, 'Item name is required'],
      [{ itemName: '  ' }, 'Item name is required'],
      [{ itemName: 'x', quantity: 0 }, 'Quantity must be a positive number'],
      [{ itemName: 'x', unitCost: -1 }, 'Unit cost must be a non-negative number'],
    ];
    for (const [body, message] of cases) {
      // eslint-disable-next-line no-await-in-loop
      const res = await tech.agent.post(purl('materials')).send(body);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: true, message, code: 'VALIDATION_ERROR' });
    }
  });

  it('re-prices when quantity or unit cost changes, not otherwise', async () => {
    const m = await create({ itemName: 'Switch', quantity: 3, unitCost: 19.99 });
    expect((await patch(m, { quantity: 2 })).totalCost).toBe(39.98);
    expect((await patch(m, { unitCost: 5 })).totalCost).toBe(10);
    expect((await patch(m, { notes: 'z' })).totalCost).toBe(10);
  });

  // Likely correct: 400 as on create. Expected to change in sub-project 3.
  it('[quirk] Q33: material update skips validation', async () => {
    const m = await create({ itemName: 'Switch', quantity: 2, unitCost: 5 });
    expect(await patch(m, { quantity: 0 })).toEqual(expect.objectContaining({ quantity: 0, totalCost: 0 }));
  });

  it('lists materials with a whole-project total', async () => {
    await create({ itemName: 'a', quantity: 3, unitCost: 19.99 });
    await create({ itemName: 'b', quantity: 2, unitCost: 5 });
    expect(expectOk(await tech.agent.get(purl('materials'))).totalAmount).toBe(69.97);
  });

  it('a material from another project is not found through this one', async () => {
    const q = await otherProject();
    const m = await create({ itemName: 'x' }, w.admin.agent, q);
    for (const res of [
      await w.admin.agent.patch(`${purl('materials')}/${m.id}`).send({ notes: 'n' }),
      await w.admin.agent.delete(`${purl('materials')}/${m.id}`),
    ]) {
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: true, message: 'Material not found', code: 'NOT_FOUND' });
    }
  });
});

describe('members', () => {
  const add = (body) => tech.agent.post(purl('members')).send(body);

  it('adds members', async () => {
    const mgr = await makeManager('mgr', w.deptA.id);
    const staff = await makeStaff('staff', w.deptA.id);
    expect(expectOk(await add({ userId: mgr.user.id, role: 'lead' }), 201).member.role).toBe('lead');
    expect(expectOk(await add({ userId: staff.user.id, role: 'owner' }), 201).member.role).toBe('member');
    const { activity } = expectOk(await tech.agent.get(purl('activity')));
    expect(activity.map((a) => [a.action, a.detail])).toContainEqual(['member_added', { userId: mgr.user.id, displayName: 'Test mgr' }]);
  });

  it('member validation', async () => {
    const mgr = await makeManager('mgr', w.deptA.id);
    const none = await add({});
    expect(none.status).toBe(400);
    expect(none.body.message).toBe('userId is required');
    const ghost = await add({ userId: 99999 });
    expect(ghost.status).toBe(400);
    expect(ghost.body.message).toBe('User does not exist');
    expectOk(await add({ userId: mgr.user.id }), 201);
    const dup = await add({ userId: mgr.user.id });
    expect(dup.status).toBe(409);
    expect(dup.body).toEqual({ error: true, message: 'User is already a member of this project', code: 'ALREADY_MEMBER' });
  });

  it('lists leads before members', async () => {
    const mgr = await makeManager('mgr', w.deptA.id);
    const staff = await makeStaff('staff', w.deptA.id);
    expectOk(await add({ userId: staff.user.id }), 201);
    expectOk(await add({ userId: mgr.user.id, role: 'lead' }), 201);
    expect(expectOk(await tech.agent.get(purl('members'))).members.map((m) => m.userId)).toEqual([mgr.user.id, staff.user.id]);
  });

  it('removing a member removes their access', async () => {
    const own = await makeOwnTier(w.admin, 'own', w.deptA.id);
    expectOk(await add({ userId: own.user.id }), 201);
    expect((await own.agent.get(`${API}/projects/${proj.id}`)).status).toBe(200);
    expect(expectOk(await tech.agent.delete(`${purl('members')}/${own.user.id}`))).toEqual({ ok: true });
    expect((await own.agent.get(`${API}/projects/${proj.id}`)).status).toBe(403);
  });

  it('removing a non-member', async () => {
    const mgr = await makeManager('mgr', w.deptA.id);
    const res = await tech.agent.delete(`${purl('members')}/${mgr.user.id}`);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: true, message: 'Member not found', code: 'NOT_FOUND' });
  });
});

describe('files', () => {
  const upload = async (agent = tech.agent, p = proj) => expectOk(
    await agent.post(purl('files', p)).attach('file', Buffer.from('hello'), 'notes.txt'), 201
  ).file;

  it('lists, downloads and deletes a file', async () => {
    const f = await upload();
    const [listed] = expectOk(await tech.agent.get(purl('files'))).files;
    expect(listed).toEqual(expect.objectContaining({ filename: 'notes.txt', filesize: 5 }));
    expect(listed.uploadedByUser.username).toBe('tech');
    const dl = await tech.agent.get(`${purl('files')}/${f.id}/download`);
    expect(dl.status).toBe(200);
    expect(dl.text).toBe('hello');
    const { activity } = expectOk(await tech.agent.get(purl('activity')));
    expect(activity.map((a) => [a.action, a.detail])).toContainEqual(['file_uploaded', { fileId: f.id, filename: 'notes.txt' }]);
    expect(expectOk(await tech.agent.delete(`${purl('files')}/${f.id}`))).toEqual({ ok: true });
    expect(expectOk(await tech.agent.get(purl('files'))).files).toEqual([]);
  });

  it('a file from another project is not found through this one', async () => {
    const q = await otherProject();
    const f = await upload(w.admin.agent, q);
    for (const res of [
      await w.admin.agent.get(`${purl('files')}/${f.id}/download`),
      await w.admin.agent.delete(`${purl('files')}/${f.id}`),
    ]) {
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: true, message: 'File not found', code: 'NOT_FOUND' });
    }
  });

  // Likely correct: only the uploader or a moderator, as on tickets. Expected to change in sub-project 3.
  it('[quirk] Q17: any project editor can delete anyone\'s file', async () => {
    const mgr = await makeManager('mgr', w.deptA.id);
    const f = await upload();
    expect((await mgr.agent.delete(`${purl('files')}/${f.id}`)).status).toBe(200);
  });
});

it('scope applies to every extras list', async () => {
  const own = await makeOwnTier(w.admin, 'own', w.deptA.id);
  for (const path of ['expenses', 'materials', 'members', 'files']) {
    // eslint-disable-next-line no-await-in-loop
    const res = await own.agent.get(purl(path));
    expect(res.status).toBe(403);
    expect(res.body.message).toBe('You do not have access to this project');
  }
});
