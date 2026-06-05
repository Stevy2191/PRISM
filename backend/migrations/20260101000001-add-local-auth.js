'use strict';

const bcrypt = require('bcryptjs');

/**
 * Adds local username/password authentication to the User table and seeds a
 * bootstrap local admin account (if it does not already exist) using credentials
 * from the environment:
 *   BOOTSTRAP_LOCAL_USERNAME (default: admin)
 *   BOOTSTRAP_LOCAL_PASSWORD (default: changeme)
 *
 * The bootstrap account is created with mustChangePassword=true so the password
 * must be changed on first login.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { STRING, BOOLEAN } = Sequelize;

    await queryInterface.addColumn('Users', 'passwordHash', {
      type: STRING(255),
      allowNull: true,
    });
    await queryInterface.addColumn('Users', 'isLocalAccount', {
      type: BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });
    await queryInterface.addColumn('Users', 'mustChangePassword', {
      type: BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });

    // Seed the bootstrap local admin if no user with that username exists.
    const username = process.env.BOOTSTRAP_LOCAL_USERNAME || 'admin';
    const password = process.env.BOOTSTRAP_LOCAL_PASSWORD || 'changeme';

    const [existing] = await queryInterface.sequelize.query(
      'SELECT id FROM Users WHERE username = ? LIMIT 1',
      { replacements: [username] }
    );

    if (existing.length === 0) {
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
          mustChangePassword: true,
          lastLogin: null,
          createdAt: now,
          updatedAt: now,
        },
      ]);
      // eslint-disable-next-line no-console
      console.log(`[migration] created bootstrap local admin "${username}" (must change password on first login)`);
    }
  },

  async down(queryInterface) {
    // Remove the bootstrap admin (only if it is still a local account) and columns.
    const username = process.env.BOOTSTRAP_LOCAL_USERNAME || 'admin';
    await queryInterface.bulkDelete('Users', { username, isLocalAccount: true });

    await queryInterface.removeColumn('Users', 'mustChangePassword');
    await queryInterface.removeColumn('Users', 'isLocalAccount');
    await queryInterface.removeColumn('Users', 'passwordHash');
  },
};
