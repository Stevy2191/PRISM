const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class License extends Model {
    // Never expose the encrypted licenseKey ciphertext in an API response —
    // enforced here (not just in the controller) so any future serialization
    // path (a new endpoint, an include on another model) can't accidentally
    // leak it by skipping a controller-level mask helper. Reveal is a
    // dedicated, permission-gated endpoint that reads the raw column
    // directly via a separate query, not through this JSON path.
    toJSON() {
      const values = { ...this.get() };
      values.licenseKeySet = !!values.licenseKey;
      delete values.licenseKey;
      return values;
    }
  }

  License.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      name: { type: DataTypes.STRING(255), allowNull: false },
      vendor: { type: DataTypes.STRING(150), allowNull: true },
      licenseType: {
        type: DataTypes.ENUM('per_seat', 'per_device', 'site_license', 'concurrent', 'subscription'),
        allowNull: false,
        defaultValue: 'per_seat',
      },
      totalSeats: { type: DataTypes.INTEGER, allowNull: true },
      usedSeats: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      // Encrypted at rest (see utils/tokenCrypto.js) — never read directly,
      // always through the controller's encrypt/decrypt + mask helpers.
      licenseKey: { type: DataTypes.TEXT, allowNull: true },
      purchaseDate: { type: DataTypes.DATEONLY, allowNull: true },
      expiryDate: { type: DataTypes.DATEONLY, allowNull: true },
      renewalDate: { type: DataTypes.DATEONLY, allowNull: true },
      annualCost: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
      autoRenews: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      departmentId: { type: DataTypes.INTEGER, allowNull: true },
      notes: { type: DataTypes.TEXT, allowNull: true },
      createdBy: { type: DataTypes.INTEGER, allowNull: true },
    },
    {
      sequelize,
      modelName: 'License',
      tableName: 'Licenses',
      timestamps: true,
    }
  );

  return License;
};
