// Builders for the baseline suites. Every record is created through the HTTP
// API, so setup runs the same code paths the tests check. Each builder throws
// with the response body when the API refuses, so a broken fixture fails at
// the line that built it rather than three assertions later.
// `jest` is not required here: Jest injects it into every module it loads,
// and requiring @jest/globals as well is a duplicate declaration.
/* global jest */
const { createUserAndLogin, ROLE } = require('./helpers');

const API = '/api/v1';

function expectOk(res, status = 200) {
  if (res.status !== status) {
    throw new Error(
      `${res.req.method} ${res.req.path} → ${res.status} (wanted ${status}): ${JSON.stringify(res.body)}`
    );
  }
  return res.body;
}

// legacyRole 'admin' matters: logging time for others, deleting other
// people's time and managing teams still check User.role (quirk Q6).
function makeAdmin(username = 'admin') {
  return createUserAndLogin({ username, roleName: ROLE.ADMIN, legacyRole: 'admin' });
}

async function makeDept(admin, name, shortCode) {
  return expectOk(await admin.agent.post(`${API}/departments`).send({ name, shortCode }), 201).department;
}

function makeUser(username, roleName, departmentId) {
  return createUserAndLogin({ username, roleName, departmentId });
}
const makeTech = (username, departmentId) => makeUser(username, ROLE.TECHNICIAN, departmentId);
const makeManager = (username, departmentId) => makeUser(username, ROLE.DEPARTMENT_MANAGER, departmentId);
const makeStaff = (username, departmentId) => makeUser(username, ROLE.DEPARTMENT_STAFF, departmentId);

// No seeded role is "own"-tier, so narrow Department Staff with overrides.
const OWN_TIER_OVERRIDES = [
  ['tickets.view_department', false], ['tickets.view_own', true],
  ['projects.view_department', false], ['projects.view_own', true], ['projects.edit_own', true],
];
async function makeOwnTier(admin, username, departmentId) {
  const u = await makeStaff(username, departmentId);
  for (const [permissionKey, granted] of OWN_TIER_OVERRIDES) {
    // eslint-disable-next-line no-await-in-loop
    expectOk(await admin.agent.post(`${API}/users/${u.user.id}/overrides`).send({ permissionKey, granted }), 201);
  }
  return u;
}

async function makeContractor(admin, username, departmentId, { rate }) {
  const u = await makeTech(username, departmentId);
  expectOk(await admin.agent.patch(`${API}/users/${u.user.id}`).send({ userType: 'contractor', hourlyRate: rate }));
  return u;
}

let contactSeq = 0;
async function makeContact(admin, fields = {}) {
  contactSeq += 1;
  const body = { firstName: 'Casey', lastName: 'Contact', email: `contact${contactSeq}@example.com`, ...fields };
  return expectOk(await admin.agent.post(`${API}/contacts`).send(body), 201).contact;
}

async function makeTicket(agent, fields) {
  return expectOk(await agent.post(`${API}/tickets`).send(fields), 201).ticket;
}

async function makeProject(agent, fields) {
  return expectOk(await agent.post(`${API}/projects`).send(fields), 201).project;
}

async function makeTask(agent, projectId, fields = {}) {
  return expectOk(await agent.post(`${API}/projects/${projectId}/tasks`).send({ title: 'Task', ...fields }), 201).task;
}

async function makeSubtask(agent, projectId, taskId, fields = {}) {
  const res = await agent.post(`${API}/projects/${projectId}/tasks/${taskId}/subtasks`).send({ title: 'Subtask', ...fields });
  return expectOk(res, 201).subtask;
}

async function makeTeam(admin, name, members) {
  return expectOk(await admin.agent.post(`${API}/teams`).send({ name, members }), 201).team;
}

async function setSettings(admin, settings) {
  return expectOk(await admin.agent.patch(`${API}/settings`).send(settings)).settings;
}

async function projectStatusId(agent, name) {
  const { statuses } = expectOk(await agent.get(`${API}/project-statuses`));
  const found = statuses.find((s) => s.name === name);
  if (!found) throw new Error(`project status "${name}" not seeded`);
  return found.id;
}

// Fakes Date and nothing else: the MariaDB driver and supertest need real
// timers. Only freeze to instants earlier than the real clock, and don't
// reuse an agent after unfreezing: the session cookie is rolling, so a
// request made under the frozen clock re-dates its expiry from that clock.
const REAL_TIMERS = [
  'hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame',
  'requestIdleCallback', 'cancelIdleCallback', 'setImmediate', 'clearImmediate', 'setInterval',
  'clearInterval', 'setTimeout', 'clearTimeout',
];
function freezeClock(iso) {
  jest.useFakeTimers({ doNotFake: REAL_TIMERS, now: new Date(iso) });
}
function advanceClock(ms) {
  jest.setSystemTime(new Date(Date.now() + ms));
}
function unfreezeClock() {
  jest.useRealTimers();
}

// For fire-and-forget work (the reply email): polls until `predicate()` is
// true, or throws after `timeoutMs`. Counts attempts rather than reading
// Date.now(), which a frozen clock would stop.
async function waitFor(predicate, timeoutMs = 2000) {
  for (let waited = 0; !predicate(); waited += 25) {
    if (waited >= timeoutMs) throw new Error('waitFor: condition not met in time');
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => { setTimeout(resolve, 25); });
  }
}

async function makeWorld() {
  const admin = await makeAdmin();
  const deptA = await makeDept(admin, 'Service Desk', 'SD');
  const deptB = await makeDept(admin, 'Facilities', 'FAC');
  const contact = await makeContact(admin);
  return { admin, deptA, deptB, contact };
}

module.exports = {
  API, expectOk, makeAdmin, makeDept, makeUser, makeTech, makeManager, makeStaff, makeOwnTier,
  makeContractor, makeContact, makeTicket, makeProject, makeTask, makeSubtask, makeTeam,
  setSettings, projectStatusId, freezeClock, advanceClock, unfreezeClock, waitFor, makeWorld,
};
