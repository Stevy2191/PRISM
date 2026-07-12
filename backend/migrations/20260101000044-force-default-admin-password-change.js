'use strict';

const bcrypt = require('bcryptjs');

// Security fix: the original bootstrap-admin migration
// (20260101000001-add-local-auth.js) seeded the local admin with
// mustChangePassword=false unconditionally, even when BOOTSTRAP_LOCAL_PASSWORD
// was never set and the account fell back to the well-known literal
// "changeme". Any install that deployed before that migration was patched
// (see its updated comment) may still have a local account sitting on that
// default credential with no forced rotation. Detected by bcrypt-comparing
// (not string-matching — hashes are salted) each local account's stored hash
// against the literal default; any match gets mustChangePassword flipped on.
module.exports = {
  async up(queryInterface, Sequelize) {
    const { QueryTypes } = Sequelize;
    const localAccounts = await queryInterface.sequelize.query(
      'SELECT `id`, `passwordHash` FROM `Users` WHERE `isLocalAccount` = true AND `passwordHash` IS NOT NULL',
      { type: QueryTypes.SELECT }
    );

    const idsToFix = localAccounts
      .filter((u) => bcrypt.compareSync('changeme', u.passwordHash))
      .map((u) => u.id);

    if (idsToFix.length) {
      await queryInterface.bulkUpdate('Users', { mustChangePassword: true }, { id: idsToFix });
      // eslint-disable-next-line no-console
      console.log(`[migration] forced password change for ${idsToFix.length} account(s) still on the default "changeme" password`);
    }

    return undefined;
  },

  async down() {
    // Not reversible (and shouldn't be — undoing this would silently
    // re-permit a default-password account to skip rotation).
    return undefined;
  },
};
