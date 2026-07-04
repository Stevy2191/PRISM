const { DataTypes, Model } = require('sequelize');

// Per-ticket, human-readable change timeline for the Activity tab. Distinct
// from the system-wide AuditLog (cross-entity admin trail): this one is
// scoped to a single ticket and stores resolved display values (e.g. a
// technician's name rather than a raw user id) for direct rendering.
module.exports = (sequelize) => {
  class TicketActivity extends Model {}

  TicketActivity.init(
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      ticketId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      userId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      action: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      fromValue: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      toValue: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: 'TicketActivity',
      tableName: 'TicketActivities',
      timestamps: true,
      updatedAt: false,
    }
  );

  return TicketActivity;
};
