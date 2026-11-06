'use strict';

// American spelling (owner, 2026-11-05): "enrollment", not "enrolment".
// 074 stored the Manage devices permission's description with the other
// spelling; new installs get the right one from 074 itself, existing ones
// from here.

const OLD = 'Create and revoke agent enrolment keys, and revoke enrolled computers';
const NEW = 'Create and revoke agent enrollment keys, and revoke enrolled computers';

module.exports = {
  up: async (queryInterface) => {
    await queryInterface.sequelize.query(
      'UPDATE Permissions SET description = :to WHERE `key` = :key AND description = :from',
      { replacements: { key: 'devices.manage', from: OLD, to: NEW } }
    );
  },
  down: async (queryInterface) => {
    await queryInterface.sequelize.query(
      'UPDATE Permissions SET description = :to WHERE `key` = :key AND description = :from',
      { replacements: { key: 'devices.manage', from: NEW, to: OLD } }
    );
  },
};
