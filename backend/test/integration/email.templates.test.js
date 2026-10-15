const { resetData, closeDb, models } = require('./helpers');
const {
  API, expectOk, makeWorld, makeTech,
} = require('./fixtures');
const { CATALOG } = require('../../src/services/email/catalog');

// Settings → Email templates: admins override the code defaults, the body
// is sanitized on save, and Reset deletes the override.

const URL = `${API}/settings/email-templates`;
let w;
beforeEach(async () => {
  await resetData();
  w = await makeWorld();
});
afterAll(closeDb);

it('lists every catalogue key with isDefault true at first', async () => {
  const { templates } = expectOk(await w.admin.agent.get(URL));
  expect(templates.map((t) => t.key).sort()).toEqual(Object.keys(CATALOG).sort());
  expect(templates.every((t) => t.isDefault)).toBe(true);
  const resolved = templates.find((t) => t.key === 'contact_resolved');
  expect(resolved).toEqual({ key: 'contact_resolved', name: CATALOG.contact_resolved.name, audience: 'contact', enabled: false, isDefault: true });
  const one = expectOk(await w.admin.agent.get(`${URL}/contact_tech_reply`));
  expect(one.template.subject).toBe(CATALOG.contact_tech_reply.subject);
  expect(one.template.placeholders.map((p) => p.name)).toContain('signature');
});

it('saving sanitizes the body and audits', async () => {
  const body = '<p onmouseover="x()">Hello {{contact.firstName}}<script>alert(1)</script></p>'
    + '<a href="javascript:alert(1)">x</a><img src="x" onerror="alert(1)">';
  const saved = expectOk(await w.admin.agent.put(`${URL}/contact_auto_reply`).send({ subject: 'Hi [Ticket #{{ticket.number}}]', bodyHtml: body, enabled: false })).template;
  expect(saved.bodyHtml).not.toMatch(/script|onmouseover|onerror|javascript/i);
  expect(saved.bodyHtml).toContain('Hello {{contact.firstName}}');
  expect(saved).toEqual(expect.objectContaining({ subject: 'Hi [Ticket #{{ticket.number}}]', enabled: false, isDefault: false }));
  const row = await models.EmailTemplate.findOne({ where: { key: 'contact_auto_reply' } });
  expect(row.bodyHtml).toBe(saved.bodyHtml);
  expect(row.updatedById).toBe(w.admin.user.id);
  const audit = await models.AuditLog.findOne({ where: { action: 'emailTemplate.update' } });
  expect(audit.meta).toEqual(expect.objectContaining({ key: 'contact_auto_reply' }));
});

it('rejects a bad subject or an oversized body', async () => {
  for (const send of [
    { subject: '', bodyHtml: '<p>x</p>' },
    { subject: 'x'.repeat(256), bodyHtml: '<p>x</p>' },
    { subject: 'ok', bodyHtml: `<p>${'x'.repeat(100 * 1024)}</p>` },
    { subject: 'ok', bodyHtml: 42 },
  ]) {
    // eslint-disable-next-line no-await-in-loop
    expect((await w.admin.agent.put(`${URL}/contact_auto_reply`).send(send)).status).toBe(400);
  }
});

it('reset returns the default', async () => {
  expectOk(await w.admin.agent.put(`${URL}/staff_assigned`).send({ subject: 'Mine', bodyHtml: '<p>mine</p>', enabled: true }));
  const res = expectOk(await w.admin.agent.delete(`${URL}/staff_assigned`)).template;
  expect(res).toEqual(expect.objectContaining({ subject: CATALOG.staff_assigned.subject, isDefault: true }));
  expect(await models.EmailTemplate.count()).toBe(0);
  expect(await models.AuditLog.count({ where: { action: 'emailTemplate.reset' } })).toBe(1);
});

it('unknown key is 404', async () => {
  for (const res of [
    await w.admin.agent.get(`${URL}/nope`),
    await w.admin.agent.put(`${URL}/nope`).send({ subject: 's', bodyHtml: '<p>x</p>' }),
    await w.admin.agent.delete(`${URL}/constructor`),
    await w.admin.agent.post(`${URL}/__proto__/preview`).send({ subject: 's', bodyHtml: 'x' }),
  ]) {
    expect(res.status).toBe(404);
  }
});

it('preview renders without saving', async () => {
  const res = expectOk(await w.admin.agent.post(`${URL}/contact_tech_reply/preview`).send({
    subject: 'Re: {{ticket.title}}', bodyHtml: '<p>{{comment.body}}</p><p>{{nope}}</p><script>x</script>',
  }));
  expect(res.subject).toMatch(/^Re: .+/);
  expect(res.html).toContain('<!doctype html>');
  expect(res.html).not.toContain('<script');
  expect(res.unknownPlaceholders).toEqual(['nope']);
  expect(await models.EmailTemplate.count()).toBe(0);
});

it('needs manage-system: technician gets 403', async () => {
  const tech = await makeTech('tech', w.deptA.id);
  for (const res of [
    await tech.agent.get(URL),
    await tech.agent.get(`${URL}/staff_reply`),
    await tech.agent.put(`${URL}/staff_reply`).send({ subject: 's', bodyHtml: 'x' }),
    await tech.agent.delete(`${URL}/staff_reply`),
    await tech.agent.post(`${URL}/staff_reply/preview`).send({ subject: 's', bodyHtml: 'x' }),
  ]) {
    expect(res.status).toBe(403);
  }
});
