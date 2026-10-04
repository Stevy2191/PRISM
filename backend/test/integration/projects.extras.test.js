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
