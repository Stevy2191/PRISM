'use strict';

// API keys checked by a SHA-256 lookup instead of bcrypt.
//   + ApiKeys.lookupHash: SHA-256 (hex) of the whole key, unique.
//   ~ ApiKeys.keyHash may be null: new keys have no bcrypt hash. A key made
//     before this keeps its bcrypt hash until its first use, which writes
//     lookupHash and clears keyHash (middleware/auth).
// A key is 32 random bytes, so a fast hash protects it as well as bcrypt
// does; bcrypt's cost exists for guessable passwords, and on every request
// it held the event loop for ~0.37 s.
//
// Rolling back: keys made after this migration have no bcrypt hash and could
// not be checked by the older code, so `down` deletes them (their owners make
// new ones). Keys moved to lookupHash on first use are deleted too, for the
// same reason.

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const cols = await queryInterface.describeTable('ApiKeys');
    if (!cols.lookupHash) {
      await queryInterface.addColumn('ApiKeys', 'lookupHash', { type: Sequelize.STRING(64), allowNull: true });
      await queryInterface.addIndex('ApiKeys', ['lookupHash'], { unique: true, name: 'api_keys_lookup_hash' });
    }
    await queryInterface.changeColumn('ApiKeys', 'keyHash', { type: Sequelize.STRING(255), allowNull: true });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.sequelize.query('DELETE FROM ApiKeys WHERE keyHash IS NULL');
    await queryInterface.changeColumn('ApiKeys', 'keyHash', { type: Sequelize.STRING(255), allowNull: false });
    const cols = await queryInterface.describeTable('ApiKeys');
    if (cols.lookupHash) {
      await queryInterface.removeIndex('ApiKeys', 'api_keys_lookup_hash');
      await queryInterface.removeColumn('ApiKeys', 'lookupHash');
    }
  },
};
