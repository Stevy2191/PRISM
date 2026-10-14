const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class TicketStatus extends Model {}

  TicketStatus.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      name: { type: DataTypes.STRING(100), allowNull: false },
      color: { type: DataTypes.STRING(9), allowNull: false, defaultValue: '#3b82f6' },
      behaviorType: {
        type: DataTypes.ENUM('open', 'closed', 'archived'),
        allowNull: false,
        defaultValue: 'open',
      },
      position: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      isDefault: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      isProtected: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    },
    {
      sequelize,
      modelName: 'TicketStatus',
      tableName: 'TicketStatuses',
      timestamps: true,
      updatedAt: false,
    }
  );

  return TicketStatus;
};
