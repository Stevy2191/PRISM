const Sequelize = require('sequelize');
const {
  resetData, closeDb, sequelize, models,
} = require('./helpers');
const { makeWorld, makeTicket, makeCompany } = require('./fixtures');
const migration = require('../../migrations/20260101000072-client-portal');

// Sub-project 7a, task 1: the portal's data model, permission and setting.

const qi = () => sequelize.getQueryInterface();
const select = (sql, replacements) => sequelize.query(sql, { type: Sequelize.QueryTypes.SELECT, replacements });

let w;
beforeEach(async () => {
  await resetData();
  w = await makeWorld();
});
afterAll(closeDb);

it('a watcher is a user or a contact, never neither or both', async () => {
  const t = await makeTicket(w.admin.agent, { title: 'Watched', contactId: w.contact.id });
  await expect(models.TicketWatcher.create({ ticketId: t.id })).rejects.toThrow();
  await expect(models.TicketWatcher.create({ ticketId: t.id, userId: w.admin.user.id, contactId: w.contact.id })).rejects.toThrow();
  await models.TicketWatcher.create({ ticketId: t.id, contactId: w.contact.id });
  await models.TicketWatcher.create({ ticketId: t.id, userId: w.admin.user.id });
  // The same contact can't watch the same ticket twice.
  await expect(models.TicketWatcher.create({ ticketId: t.id, contactId: w.contact.id })).rejects.toThrow();
});

it('admin pairs are unique; an article audience row names a company or a department', async () => {
  const company = await makeCompany(w.admin, { name: 'Portal Co' });
  await models.CompanyPortalAdmin.create({ companyId: company.id, contactId: w.contact.id });
  await expect(models.CompanyPortalAdmin.create({ companyId: company.id, contactId: w.contact.id })).rejects.toThrow();
  await models.DepartmentPortalAdmin.create({ departmentId: w.deptA.id, contactId: w.contact.id });
  await expect(models.DepartmentPortalAdmin.create({ departmentId: w.deptA.id, contactId: w.contact.id })).rejects.toThrow();
  const article = await models.KbArticle.create({ title: 'A', slug: `a-${Date.now()}`, visibility: 'portal', portalScope: 'companies' });
  await expect(models.KbArticleAudience.create({ articleId: article.id })).rejects.toThrow();
  await expect(models.KbArticleAudience.create({ articleId: article.id, companyId: company.id, departmentId: w.deptA.id })).rejects.toThrow();
  await models.KbArticleAudience.create({ articleId: article.id, companyId: company.id });
  await article.destroy();
});

it('contacts start without portal access; portal.manage belongs to System Administrator only', async () => {
  const contact = await models.Contact.scope('withPassword').findByPk(w.contact.id);
  expect([contact.portalAccess, contact.passwordHash, contact.portalLastSignInAt]).toEqual([false, null, null]);
  // The hash never leaves the model unless asked for by name.
  await contact.update({ passwordHash: 'x'.repeat(60) });
  expect((await models.Contact.findByPk(w.contact.id)).toJSON()).not.toHaveProperty('passwordHash');
  expect(contact.toJSON()).not.toHaveProperty('passwordHash');
  const viaApi = await w.admin.agent.get(`/api/v1/contacts/${w.contact.id}`);
  expect(viaApi.status).toBe(200);
  expect(JSON.stringify(viaApi.body)).not.toContain('passwordHash');
  const perm = await select("SELECT category, label FROM Permissions WHERE `key` = 'portal.manage'");
  expect(perm).toEqual([{ category: 'portal', label: 'Manage portal access' }]);
  const holders = await select(
    `SELECT r.name FROM RolePermissions rp JOIN Roles r ON r.id = rp.roleId JOIN Permissions p ON p.id = rp.permissionId
      WHERE p.\`key\` = 'portal.manage' AND rp.granted = 1 ORDER BY r.name`
  );
  expect(holders.map((h) => h.name)).toEqual(['System Administrator']);
  const [setting] = await select("SELECT value FROM SystemSettings WHERE `key` = 'portal.enabled'");
  expect(setting.value).toBe('false');
});

it('round trip: "End users" articles become portal articles for all companies, and back', async () => {
  await sequelize.query("UPDATE KbArticles SET visibility = 'internal'");
  const article = await models.KbArticle.create({ title: 'Was public', slug: `was-public-${Date.now()}`, visibility: 'portal', status: 'published' });
  // Readable only by chosen companies: rolling back must not hand it to the anonymous /kb.
  const scoped = await models.KbArticle.create({ title: 'Scoped', slug: `scoped-${Date.now()}`, visibility: 'portal', portalScope: 'companies', status: 'published' });
  await migration.down(qi(), Sequelize);
  try {
    expect((await qi().describeTable('Contacts')).portalAccess).toBeUndefined();
    expect((await select('SELECT visibility FROM KbArticles WHERE id = ?', [article.id]))[0].visibility).toBe('public');
    expect((await select('SELECT visibility FROM KbArticles WHERE id = ?', [scoped.id]))[0].visibility).toBe('internal');
    expect(await select("SELECT id FROM Permissions WHERE `key` = 'portal.manage'")).toHaveLength(0);
    expect(await select("SELECT 1 FROM SystemSettings WHERE `key` = 'portal.enabled'")).toHaveLength(0);
  } finally {
    await migration.up(qi(), Sequelize);
  }
  await migration.up(qi(), Sequelize); // idempotent
  const [row] = await select('SELECT visibility, portalScope FROM KbArticles WHERE id = ?', [article.id]);
  expect(row).toEqual({ visibility: 'portal', portalScope: 'all' });
  expect(await select("SELECT id FROM Permissions WHERE `key` = 'portal.manage'")).toHaveLength(1);
  await models.KbArticle.destroy({ where: { id: [article.id, scoped.id] } });
});
