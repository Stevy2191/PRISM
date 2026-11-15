const { DataTypes, Model } = require('sequelize');

// CN: a customer contact named on a project. They see it in their company's
// portal (status, progress, phases and milestones).
module.exports = (sequelize) => {
  class ProjectContact extends Model {}

  ProjectContact.init(
    {
      projectId: { type: DataTypes.INTEGER, allowNull: false, primaryKey: true },
      contactId: { type: DataTypes.INTEGER, allowNull: false, primaryKey: true },
      createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    },
    {
      sequelize, modelName: 'ProjectContact', tableName: 'ProjectContacts', timestamps: false,
    },
  );
  return ProjectContact;
};
