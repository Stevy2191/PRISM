const Sequelize = require('sequelize');
const { sequelize } = require('./helpers');

// The Phase 3 money migrations, in order. Each points at earlier ones, so a
// round trip of migration N undoes N and everything after it (newest first),
// then redoes them (oldest first). Add new money migrations here.
const MONEY = [
  '20260101000103-ledger',
  '20260101000104-money-permissions',
  '20260101000105-tax-and-company-billing',
  '20260101000106-catalog-products',
  '20260101000107-time-billing',
  '20260101000108-support-tiers',
  '20260101000109-bills',
  '20260101000110-stock',
  '20260101000111-materials-everywhere',
  '20260101000112-purchase-orders',
  '20260101000113-expenses',
  '20260101000114-material-unit-cost',
  '20260101000115-agreements',
  '20260101000116-invoices',
  '20260101000117-payments',
].filter((name) => {
  try { require.resolve(`../../migrations/${name}`); return true; } catch { return false; }
}).map((name) => ({ name, m: require(`../../migrations/${name}`) })); // eslint-disable-line global-require, import/no-dynamic-require

const qi = () => sequelize.getQueryInterface();
const from = (prefix) => {
  const i = MONEY.findIndex((x) => x.name.startsWith(prefix));
  if (i < 0) throw new Error(`Unknown money migration ${prefix}`);
  return MONEY.slice(i);
};

// downFrom('20260101000106'): undo 106 and everything after it.
async function downFrom(prefix) {
  for (const { m } of [...from(prefix)].reverse()) await m.down(qi(), Sequelize); // eslint-disable-line no-await-in-loop
}
async function upFrom(prefix) {
  for (const { m } of from(prefix)) await m.up(qi(), Sequelize); // eslint-disable-line no-await-in-loop
}

module.exports = { MONEY, downFrom, upFrom };
