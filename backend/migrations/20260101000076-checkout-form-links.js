'use strict';

// Checkout forms (print or email, then the signed copy back): a checkout
// remembers its own form (before, "Send checkout form" mailed whichever of
// the asset's attachments came first), when the form was printed, and the
// signed copy uploaded back. Deleting either attachment just unlinks it.

const LINKS = ['formAttachmentId', 'signedAttachmentId'];

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const cols = await queryInterface.describeTable('AssetCheckouts');
    for (const name of LINKS) {
      if (!cols[name]) {
        // eslint-disable-next-line no-await-in-loop
        await queryInterface.addColumn('AssetCheckouts', name, {
          type: Sequelize.INTEGER,
          allowNull: true,
          references: { model: 'AssetAttachments', key: 'id' },
          onDelete: 'SET NULL',
          onUpdate: 'CASCADE',
        });
      }
    }
    if (!cols.checkoutFormPrintedAt) {
      await queryInterface.addColumn('AssetCheckouts', 'checkoutFormPrintedAt', { type: Sequelize.DATE, allowNull: true });
    }
  },
  down: async (queryInterface) => {
    const cols = await queryInterface.describeTable('AssetCheckouts');
    if (cols.checkoutFormPrintedAt) await queryInterface.removeColumn('AssetCheckouts', 'checkoutFormPrintedAt');
    for (const name of LINKS) {
      // eslint-disable-next-line no-await-in-loop
      if (cols[name]) await queryInterface.removeColumn('AssetCheckouts', name);
    }
  },
};
