const { DataTypes, Model } = require('sequelize');

// A user's own screen choices that follow their account (migration 087):
// one row per user and key. No row means the screen's built-in default.
module.exports = (sequelize) => {
  class UserPreference extends Model {}

  UserPreference.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      userId: { type: DataTypes.INTEGER, allowNull: false },
      key: { type: DataTypes.STRING(64), allowNull: false },
      value: { type: DataTypes.JSON, allowNull: false },
    },
    {
      sequelize,
      modelName: 'UserPreference',
      tableName: 'UserPreferences',
      timestamps: true,
      indexes: [{ unique: true, fields: ['userId', 'key'], name: 'user_preferences_user_key' }],
    }
  );

  return UserPreference;
};
