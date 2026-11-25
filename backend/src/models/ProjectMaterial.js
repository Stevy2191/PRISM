const { DataTypes, Model } = require('sequelize');

const billedError = () => {
  const { ApiError } = require('../middleware/error'); // eslint-disable-line global-require
  return new ApiError(409, 'This material is on an invoice and can\'t be changed or removed', 'MATERIAL_BILLED');
};

module.exports = (sequelize) => {
  class ProjectMaterial extends Model {}

  ProjectMaterial.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      // A project's material, or (Phase 3) a ticket's: exactly one is set.
      projectId: { type: DataTypes.INTEGER, allowNull: true },
      ticketId: { type: DataTypes.INTEGER, allowNull: true },
      taskId: { type: DataTypes.INTEGER, allowNull: true },
      itemName: { type: DataTypes.STRING(255), allowNull: false },
      vendor: { type: DataTypes.STRING(255), allowNull: true },
      vendorCompanyId: { type: DataTypes.INTEGER, allowNull: true },
      modelNumber: { type: DataTypes.STRING(255), allowNull: true },
      // Array of serial number strings — a line item can represent several
      // physical units of the same product.
      serialNumber: { type: DataTypes.JSON, allowNull: true },
      quantity: { type: DataTypes.DECIMAL(12, 4), allowNull: false, defaultValue: 1 },
      // Phase 3: from the catalog or the shelf, at a price, billed once.
      catalogProductId: { type: DataTypes.INTEGER, allowNull: true },
      unitPrice: { type: DataTypes.DECIMAL(12, 4), allowNull: true },
      taxCategoryId: { type: DataTypes.INTEGER, allowNull: true },
      billable: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      fromStock: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      billingStatus: { type: DataTypes.ENUM('unbilled', 'billed', 'non_billable'), allowNull: false, defaultValue: 'unbilled' },
      invoiceLineId: { type: DataTypes.INTEGER, allowNull: true },
      poLineId: { type: DataTypes.INTEGER, allowNull: true },
      unitCost: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
      totalCost: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
      notes: { type: DataTypes.TEXT, allowNull: true },
      addedBy: { type: DataTypes.INTEGER, allowNull: false },
    },
    {
      sequelize,
      modelName: 'ProjectMaterial',
      tableName: 'ProjectMaterials',
      timestamps: true,
      updatedAt: false,
      // Billed materials are locked on every path; only invoicing passes
      // { allowBilled: true } (Phase 3, as for time entries).
      hooks: {
        beforeUpdate: (m, options) => {
          if (!options.allowBilled && m.previous('billingStatus') === 'billed') throw billedError();
        },
        beforeDestroy: (m, options) => {
          if (!options.allowBilled && m.billingStatus === 'billed') throw billedError();
        },
        beforeBulkUpdate: async (options) => {
          if (!options.allowBilled && await anyBilled(options)) throw billedError();
        },
        beforeBulkDestroy: async (options) => {
          if (!options.allowBilled && await anyBilled(options)) throw billedError();
        },
      },
    }
  );

  async function anyBilled(options) {
    const { Op } = require('sequelize'); // eslint-disable-line global-require
    return (await ProjectMaterial.count({ where: { [Op.and]: [options.where || {}, { billingStatus: 'billed' }] }, transaction: options.transaction })) > 0;
  }

  return ProjectMaterial;
};
