const { DataTypes, Model } = require('sequelize');

// Join table between Teams and Users, with a per-member lead flag.
module.exports = (sequelize) => {
  class TeamMember extends Model {}

  TeamMember.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      teamId: { type: DataTypes.INTEGER, allowNull: false },
      userId: { type: DataTypes.INTEGER, allowNull: false },
      isLead: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    },
    {
      sequelize,
      modelName: 'TeamMember',
      tableName: 'TeamMembers',
      timestamps: false,
      indexes: [{ unique: true, fields: ['teamId', 'userId'] }],
    }
  );

  return TeamMember;
};
