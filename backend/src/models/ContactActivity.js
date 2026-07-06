const { DataTypes, Model } = require('sequelize');

// Per-contact activity timeline (Activity tab) — mirrors ProjectActivity's
// JSON `detail` blob shape, since contact events vary in kind (ticket
// created/closed, contact updated, department assigned, etc.).
module.exports = (sequelize) => {
  class ContactActivity extends Model {}

  ContactActivity.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      contactId: { type: DataTypes.INTEGER, allowNull: false },
      userId: { type: DataTypes.INTEGER, allowNull: true },
      action: { type: DataTypes.STRING(100), allowNull: false },
      detail: { type: DataTypes.JSON, allowNull: true },
    },
    {
      sequelize,
      modelName: 'ContactActivity',
      tableName: 'ContactActivities',
      timestamps: true,
      updatedAt: false,
    }
  );

  return ContactActivity;
};
