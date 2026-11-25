'use strict';

// Shelf stock (Phase 3, step 2).
//   + CatalogProducts.onHand (usage units), lowStockAt.
//   + StockMovements: every receipt, use and count.
//   + the 'stock_low' notification.

const NEW_NOTIFICATIONS = ['stock_low'];
const tableNames = async (qi) => (await qi.showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName));

async function enumValues(qi) {
  const [rows] = await qi.sequelize.query("SHOW COLUMNS FROM `Notifications` LIKE 'type'");
  const type = rows && rows[0] ? String(rows[0].Type) : '';
  return [...type.matchAll(/'([^']*)'/g)].map((m) => m[1]);
}
async function setEnum(qi, values) {
  await qi.sequelize.query(`ALTER TABLE \`Notifications\` MODIFY \`type\` ENUM(${values.map((v) => `'${v}'`).join(',')}) NOT NULL`);
}
// A saved notifications.enabledTypes allow-list would otherwise keep it off.
async function updateEnabledTypes(qi, Sequelize, change) {
  const [row] = await qi.sequelize.query("SELECT value FROM SystemSettings WHERE `key` = 'notifications.enabledTypes'", { type: Sequelize.QueryTypes.SELECT });
  let list;
  try { list = JSON.parse(row && row.value); } catch { list = null; }
  if (!Array.isArray(list)) return;
  await qi.sequelize.query("UPDATE SystemSettings SET value = ? WHERE `key` = 'notifications.enabledTypes'", { replacements: [JSON.stringify(change(list))] });
}

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const qi = queryInterface;
    const dt = Sequelize;
    const cp = await qi.describeTable('CatalogProducts');
    if (!cp.onHand) await qi.addColumn('CatalogProducts', 'onHand', { type: dt.DECIMAL(12, 4), allowNull: false, defaultValue: 0 });
    if (!cp.lowStockAt) await qi.addColumn('CatalogProducts', 'lowStockAt', { type: dt.DECIMAL(12, 4), allowNull: true });
    if (!(await tableNames(qi)).includes('StockMovements')) {
      await qi.createTable('StockMovements', {
        id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
        productId: {
          type: dt.INTEGER, allowNull: false, references: { model: 'CatalogProducts', key: 'id' }, onDelete: 'CASCADE',
        },
        quantity: { type: dt.DECIMAL(12, 4), allowNull: false },
        reason: { type: dt.ENUM('receive', 'use', 'adjust'), allowNull: false },
        unitCost: { type: dt.DECIMAL(12, 4), allowNull: true },
        materialId: { type: dt.INTEGER, allowNull: true },
        poLineId: { type: dt.INTEGER, allowNull: true },
        note: { type: dt.STRING(255), allowNull: true },
        ledgerEntryId: { type: dt.INTEGER, allowNull: true },
        createdBy: {
          type: dt.INTEGER, allowNull: true, references: { model: 'Users', key: 'id' }, onDelete: 'SET NULL',
        },
        createdAt: { type: dt.DATE, allowNull: false },
      });
      await qi.addIndex('StockMovements', ['productId', 'createdAt'], { name: 'stock_movements_product' });
    }
    const values = await enumValues(qi);
    if (values.length && NEW_NOTIFICATIONS.some((v) => !values.includes(v))) await setEnum(qi, [...new Set([...values, ...NEW_NOTIFICATIONS])]);
    await updateEnabledTypes(qi, dt, (list) => [...new Set([...list, ...NEW_NOTIFICATIONS])]);
  },

  down: async (queryInterface, Sequelize) => {
    const qi = queryInterface;
    await updateEnabledTypes(qi, Sequelize, (list) => list.filter((x) => !NEW_NOTIFICATIONS.includes(x)));
    await qi.sequelize.query('DELETE FROM Notifications WHERE type IN (:v)', { replacements: { v: NEW_NOTIFICATIONS } });
    const values = await enumValues(qi);
    if (values.some((v) => NEW_NOTIFICATIONS.includes(v))) await setEnum(qi, values.filter((v) => !NEW_NOTIFICATIONS.includes(v)));
    if ((await tableNames(qi)).includes('StockMovements')) await qi.dropTable('StockMovements');
    const cp = await qi.describeTable('CatalogProducts');
    if (cp.lowStockAt) await qi.removeColumn('CatalogProducts', 'lowStockAt');
    if (cp.onHand) await qi.removeColumn('CatalogProducts', 'onHand');
  },
};
