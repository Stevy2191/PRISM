// The `mariadb` driver, wrapped to keep Sequelize's migrations working.
//
// The bug this exists for:
//
//   The driver attaches result metadata to every row array with
//   Object.defineProperty(rows, 'meta', { value, writable, enumerable }) —
//   note the missing `configurable`, which therefore defaults to false
//   (mariadb/lib/cmd/parser.js). Sequelize's MariaDB dialect then does
//   `delete data.meta` on the result of any *raw* query
//   (sequelize/lib/dialects/mariadb/query.js), in a file compiled with
//   "use strict". Deleting a non-configurable property is a silent no-op in
//   sloppy mode but throws a TypeError in strict mode, so the query fails
//   with:
//
//       Cannot delete property 'meta' of [object Array]
//
//   QueryInterface#removeColumn issues a raw information_schema lookup for
//   foreign keys before altering the table, so *every* migration whose down()
//   removes a column hit this — rollback was broken project-wide, while
//   rolling forward was unaffected. Ordinary application queries were fine
//   too: they all go through the ORM or QueryTypes, which take a different
//   branch and never reach the delete.
//
// Why fix it here rather than elsewhere:
//
//   * Pinning the driver is not viable — the defect has been present since
//     mariadb 3.1, so avoiding it means staying on 3.0.x and forgoing years
//     of driver fixes.
//   * Patching node_modules (patch-package) adds a toolchain and a patch that
//     silently stops applying whenever Sequelize is upgraded.
//   * Sequelize accepts a `dialectModule`, so the smallest correct fix is to
//     hand it a driver whose results have a *configurable* `meta`. The value
//     and behaviour are unchanged; only the property descriptor differs, so
//     Sequelize can delete it as it expects to.
//
// This becomes unnecessary if the driver ever marks the property
// configurable, or Sequelize stops deleting it. It is safe to keep either
// way: it only relaxes a descriptor that is already there.
const mariadb = require('mariadb');

// A non-configurable property cannot be redefined in place, so the descriptor
// cannot simply be relaxed — the fix is to hand back an array whose `meta` is
// configurable from the start.
//
// The copy is shallow: `slice()` duplicates the row *references*, not the rows
// themselves, so the cost is one pointer array per result set and the row
// objects are shared. `meta` is the only non-index property the driver attaches
// (verified against mariadb 3.5), and non-array results — the OkPacket returned
// by INSERT/UPDATE/DDL — carry no metadata at all and are passed straight
// through untouched.
function withConfigurableMeta(result) {
  if (!Array.isArray(result)) return result;

  const descriptor = Object.getOwnPropertyDescriptor(result, 'meta');
  if (!descriptor || descriptor.configurable) return result;

  const copy = result.slice();
  Object.defineProperty(copy, 'meta', { ...descriptor, configurable: true });
  return copy;
}

// Sequelize calls connection.query(); execute() is wrapped too so this keeps
// working if a future version switches to prepared statements.
function wrapConnection(connection) {
  for (const method of ['query', 'execute']) {
    if (typeof connection[method] !== 'function') continue;
    const original = connection[method].bind(connection);
    connection[method] = async (...args) => withConfigurableMeta(await original(...args));
  }
  return connection;
}

module.exports = {
  ...mariadb,
  async createConnection(options) {
    return wrapConnection(await mariadb.createConnection(options));
  },
  // Not used by Sequelize's mariadb dialect, which creates connections
  // directly and pools them itself, but wrapped for consistency should
  // anything reach for it.
  createPool(options) {
    const pool = mariadb.createPool(options);
    const originalGet = pool.getConnection.bind(pool);
    pool.getConnection = async () => wrapConnection(await originalGet());
    return pool;
  },
};
