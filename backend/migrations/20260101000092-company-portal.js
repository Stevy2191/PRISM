'use strict';

// Each company has its own portal and its own survey switch (CS part 3).
//   + Companies.portalEnabled (off until switched on, on the company's page)
//   + Companies.portalSlug    (unique: the company's link, /portal/<slug>)
//   + Companies.portalPreviousSlugs (links it had before; they keep working)
//   + Companies.csatEnabled   (satisfaction surveys for its tickets)
//   - SystemSettings portal.enabled and csat.enabled (one switch for all)
// Where the portal was on, each company with a contact who may sign in keeps
// it on (and your own company, while there are no customers); surveys keep
// the old setting.

const { slugify } = require('../src/services/portal/company');

async function columnsOf(qi, Sequelize, table) {
  const rows = await qi.sequelize.query(
    'SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table',
    { type: Sequelize.QueryTypes.SELECT, replacements: { table } }
  );
  return rows.map((r) => r.c);
}

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const qi = queryInterface;
    const select = (sql, replacements) => qi.sequelize.query(sql, { type: Sequelize.QueryTypes.SELECT, replacements });
    const run = (sql, replacements) => qi.sequelize.query(sql, { replacements });
    if ((await columnsOf(qi, Sequelize, 'Companies')).includes('portalSlug')) return; // already applied

    await qi.addColumn('Companies', 'portalEnabled', { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false });
    await qi.addColumn('Companies', 'portalSlug', { type: Sequelize.STRING(50), allowNull: true, unique: true });
    await qi.addColumn('Companies', 'portalPreviousSlugs', { type: Sequelize.JSON, allowNull: true });
    await qi.addColumn('Companies', 'csatEnabled', { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true });

    const setting = async (key) => {
      const [row] = await select('SELECT value FROM SystemSettings WHERE `key` = :key', { key });
      return row ? row.value === 'true' : false;
    };
    const portalOn = await setting('portal.enabled');
    const csatOn = await setting('csat.enabled');

    const companies = await select('SELECT id, name, isInternal, isClient FROM Companies ORDER BY isInternal DESC, id ASC');
    const withAccess = new Set((await select('SELECT DISTINCT companyId FROM Contacts WHERE portalAccess = 1 AND companyId IS NOT NULL'))
      .map((r) => r.companyId));
    const anyCustomer = companies.some((c) => !c.isInternal && c.isClient);
    const used = new Set();
    for (const c of companies) {
      const base = slugify(c.name);
      let slug = base;
      for (let n = 2; used.has(slug); n += 1) slug = `${base.slice(0, 50 - `-${n}`.length).replace(/-+$/g, '')}-${n}`;
      used.add(slug);
      const open = portalOn && (withAccess.has(c.id) || (c.isInternal && !anyCustomer));
      // eslint-disable-next-line no-await-in-loop
      await run('UPDATE Companies SET portalSlug = :slug, portalEnabled = :open, csatEnabled = :csat WHERE id = :id', {
        slug, open: open ? 1 : 0, csat: csatOn ? 1 : 0, id: c.id,
      });
    }
    await run("DELETE FROM SystemSettings WHERE `key` IN ('portal.enabled', 'csat.enabled')");
  },

  down: async (queryInterface, Sequelize) => {
    const qi = queryInterface;
    const select = (sql) => qi.sequelize.query(sql, { type: Sequelize.QueryTypes.SELECT });
    if (!(await columnsOf(qi, Sequelize, 'Companies')).includes('portalSlug')) return;
    const [{ portal, csat }] = await select('SELECT MAX(portalEnabled) AS portal, MAX(csatEnabled) AS csat FROM Companies');
    const now = new Date();
    await qi.bulkDelete('SystemSettings', { key: ['portal.enabled', 'csat.enabled'] });
    await qi.bulkInsert('SystemSettings', [
      { key: 'portal.enabled', value: portal ? 'true' : 'false', updatedAt: now },
      { key: 'csat.enabled', value: csat ? 'true' : 'false', updatedAt: now },
    ]);
    await qi.removeColumn('Companies', 'csatEnabled');
    await qi.removeColumn('Companies', 'portalPreviousSlugs');
    await qi.removeColumn('Companies', 'portalSlug');
    await qi.removeColumn('Companies', 'portalEnabled');
  },
};
