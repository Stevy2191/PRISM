const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class UserCalendarIntegration extends Model {}

  UserCalendarIntegration.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      userId: { type: DataTypes.INTEGER, allowNull: false },
      provider: { type: DataTypes.ENUM('google', 'microsoft', 'ical'), allowNull: false },
      name: { type: DataTypes.STRING(255), allowNull: false },
      color: { type: DataTypes.STRING(9), allowNull: false, defaultValue: '#2563eb' },
      isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      // Encrypted at rest (AES-256-GCM) — see utils/tokenCrypto.js. Only ever
      // decrypted transiently inside the calendar sync services, never sent
      // to the frontend.
      accessToken: { type: DataTypes.TEXT, allowNull: true },
      refreshToken: { type: DataTypes.TEXT, allowNull: true },
      tokenExpiry: { type: DataTypes.DATE, allowNull: true },
      calendarId: { type: DataTypes.STRING(500), allowNull: true },
      icalUrl: { type: DataTypes.TEXT, allowNull: true },
      syncEnabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      lastSynced: { type: DataTypes.DATE, allowNull: true },
      needsReconnect: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    },
    {
      sequelize,
      modelName: 'UserCalendarIntegration',
      tableName: 'UserCalendarIntegrations',
      timestamps: true,
      defaultScope: {
        attributes: { exclude: ['accessToken', 'refreshToken'] },
      },
      // Named scopes fully REPLACE the default scope (not merged) — an
      // empty scope definition with no `attributes` key at all is what
      // actually removes the exclusion and selects every column.
      scopes: {
        withTokens: {},
      },
    }
  );

  return UserCalendarIntegration;
};
