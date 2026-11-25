'use strict';

// Support tiers (Phase 3, step 1): Full, Light or Not covered per contact.
//   + Contacts.supportTier: null = automatic (frontline license, then the
//     department's default); or set by hand.
//   + Contacts.m365Frontline: set by the Microsoft 365 sync from the
//     person's licenses (money.frontlineSkuIds).
//   + Departments.defaultSupportTier: 'full' unless set.

const TIERS = ['full', 'light', 'none'];

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const qi = queryInterface;
    const c = await qi.describeTable('Contacts');
    if (!c.supportTier) await qi.addColumn('Contacts', 'supportTier', { type: Sequelize.ENUM(...TIERS), allowNull: true });
    if (!c.m365Frontline) await qi.addColumn('Contacts', 'm365Frontline', { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false });
    const d = await qi.describeTable('Departments');
    if (!d.defaultSupportTier) {
      await qi.addColumn('Departments', 'defaultSupportTier', { type: Sequelize.ENUM(...TIERS), allowNull: false, defaultValue: 'full' });
    }
  },
  down: async (queryInterface) => {
    const c = await queryInterface.describeTable('Contacts');
    if (c.supportTier) await queryInterface.removeColumn('Contacts', 'supportTier');
    if (c.m365Frontline) await queryInterface.removeColumn('Contacts', 'm365Frontline');
    const d = await queryInterface.describeTable('Departments');
    if (d.defaultSupportTier) await queryInterface.removeColumn('Departments', 'defaultSupportTier');
  },
};
