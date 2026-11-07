const { DataTypes, Model } = require('sequelize');

// A playbook (PB): forms applied to a ticket together.
// blocks: [{ formId, applies: 'once'|'person_devices'|'ticket_devices',
//            limits: { categoryIds?, managed?, mdmIds?, hasCellular?, hasAgent? } }]
// A device takes the first per-device block it matches.
// companyIds: null for every company, else the companies it's offered for.
module.exports = (sequelize) => {
  class Playbook extends Model {}

  Playbook.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      name: { type: DataTypes.STRING(150), allowNull: false },
      description: { type: DataTypes.TEXT, allowNull: true },
      needsPerson: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      companyIds: { type: DataTypes.JSON, allowNull: true },
      blocks: { type: DataTypes.JSON, allowNull: false, defaultValue: [] },
      // Ticket categories whose new tickets get this bundle suggested (PB2).
      suggestCategoryIds: { type: DataTypes.JSON, allowNull: true },
      isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      position: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      createdBy: { type: DataTypes.INTEGER, allowNull: true },
    },
    { sequelize, modelName: 'Playbook', tableName: 'Playbooks', timestamps: true }
  );

  return Playbook;
};
