'use strict';

const bcrypt = require('bcryptjs');

/**
 * Adds local username/password authentication to the User table and seeds a
 * bootstrap local admin account (if it does not already exist) using credentials
 * from the environment:
 *   BOOTSTRAP_LOCAL_USERNAME (default: admin)
 *   BOOTSTRAP_LOCAL_PASSWORD (default: changeme)
 *
 * The bootstrap account is created with mustChangePassword=false only when
 * BOOTSTRAP_LOCAL_PASSWORD was explicitly set (the operator chose a real
 * password during setup). If it was left unset, the account falls back to
 * the well-known literal "changeme" — mustChangePassword=true in that case,
 * same as any other account, so an operator who skips the env var isn't left
 * running production with a public default credential.
 * Accounts created via Admin → Users still get mustChangePassword=true.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { STRING, BOOLEAN } = Sequelize;

    // Idempotent column adds: only add a column if it does not already exist.
    // This lets the migration safely re-run if a previous attempt added some
    // columns but did not complete (e.g. it was interrupted).
    const addColumnIfMissing = async (table, column, definition) => {
      const tableSchema = await queryInterface.describeTable(table);
      if (!tableSchema[column]) {
        await queryInterface.addColumn(table, column, definition);
      }
    };

    await addColumnIfMissing('Users', 'passwordHash', {
      type: STRING(255),
      allowNull: true,
    });
    await addColumnIfMissing('Users', 'isLocalAccount', {
      type: BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });
    await addColumnIfMissing('Users', 'mustChangePassword', {
      type: BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });

    // Seed the bootstrap local admin if no user with that username exists.
    const username = process.env.BOOTSTRAP_LOCAL_USERNAME || 'admin';
    const password = process.env.BOOTSTRAP_LOCAL_PASSWORD || 'changeme';

    // rawSelect returns the scalar `id` (or null) — not a [results, metadata]
    // array, which the sequelize-cli runner mishandles.
    const existingId = await queryInterface.rawSelect('Users', { where: { username } }, ['id']);

    if (!existingId) {
      const passwordHash = bcrypt.hashSync(password, 12);
      const now = new Date();
      await queryInterface.bulkInsert('Users', [
        {
          username,
          displayName: 'Local Administrator',
          email: null,
          role: 'admin',
          departmentId: null,
          passwordHash,
          isLocalAccount: true,
          mustChangePassword: !process.env.BOOTSTRAP_LOCAL_PASSWORD,
          lastLogin: null,
          createdAt: now,
          updatedAt: now,
        },
      ]);
      // eslint-disable-next-line no-console
      console.log(`[migration] created bootstrap local admin "${username}"`);
    }

    // Explicitly return nothing: the sequelize-cli runner errors if up() resolves
    // to the result of a queryInterface call (e.g. an array).
    return undefined;
  },

  async down(queryInterface) {
    // Remove the bootstrap admin (only if it is still a local account) and columns.
    const username = process.env.BOOTSTRAP_LOCAL_USERNAME || 'admin';
    await queryInterface.bulkDelete('Users', { username, isLocalAccount: true });

    const removeColumnIfExists = async (table, column) => {
      const tableSchema = await queryInterface.describeTable(table);
      if (tableSchema[column]) {
        await queryInterface.removeColumn(table, column);
      }
    };

    await removeColumnIfExists('Users', 'mustChangePassword');
    await removeColumnIfExists('Users', 'isLocalAccount');
    await removeColumnIfExists('Users', 'passwordHash');

    return undefined;
  },
};
