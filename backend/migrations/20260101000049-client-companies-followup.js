// Client companies follow-up (plan 2b):
//   - the Companies nav module (spec: "behind module visibility");
//   - vendor text that 20260101000048 grouped with JavaScript trim() but
//     linked with SQL TRIM() (spaces only), so "Dell\t" got a vendor company
//     and was never linked to it. Spellings are compared here the same way
//     for grouping and linking: whitespace runs collapsed, ends trimmed,
//     case ignored.
const VENDOR_SOURCES = [['Assets', 'vendorName'], ['Licenses', 'vendor'], ['Contracts', 'vendor'], ['ProjectMaterials', 'vendor']];
const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();

module.exports = {
  up: async (queryInterface) => {
    const select = (sql, replacements) => queryInterface.sequelize.query(sql, { replacements, type: 'SELECT' });

    const [existing] = await select("SELECT id FROM ModuleVisibility WHERE moduleName = 'companies'");
    if (!existing) {
      await queryInterface.bulkInsert('ModuleVisibility', [
        { moduleName: 'companies', visibleToRoles: JSON.stringify(['admin', 'technician']) },
      ]);
    }

    const vendorIdByKey = new Map(
      (await select('SELECT id, name FROM Companies WHERE isVendor = 1 ORDER BY id'))
        .map((c) => [normalize(c.name).toLowerCase(), c.id])
    );
    for (const [table, column] of VENDOR_SOURCES) {
      // eslint-disable-next-line no-await-in-loop
      const rows = await select(`SELECT id, \`${column}\` AS text FROM \`${table}\` WHERE vendorCompanyId IS NULL AND \`${column}\` IS NOT NULL`);
      for (const row of rows) {
        const name = normalize(row.text).slice(0, 150);
        if (!name) continue; // eslint-disable-line no-continue
        const key = name.toLowerCase();
        if (!vendorIdByKey.has(key)) {
          // eslint-disable-next-line no-await-in-loop
          await queryInterface.bulkInsert('Companies', [{ name, isInternal: false, isClient: false, isVendor: true, status: 'active' }]);
          // eslint-disable-next-line no-await-in-loop
          const [made] = await select('SELECT id FROM Companies WHERE isVendor = 1 AND name = :name ORDER BY id DESC LIMIT 1', { name });
          vendorIdByKey.set(key, made.id);
        }
        // eslint-disable-next-line no-await-in-loop
        await queryInterface.sequelize.query(
          `UPDATE \`${table}\` SET vendorCompanyId = :vendorId WHERE id = :id`,
          { replacements: { vendorId: vendorIdByKey.get(key), id: row.id } }
        );
      }
    }
  },

  // The relinks are correct data and stay; only the nav module goes.
  down: async (queryInterface) => {
    await queryInterface.bulkDelete('ModuleVisibility', { moduleName: 'companies' });
  },
};
