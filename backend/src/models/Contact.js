const { DataTypes, Model } = require('sequelize');

// A person a tech services who does not have a PRISM login (no auth, no
// role). Contacts are the customer/end-user side of ticketing; the future
// customer portal will use this table as its user base.
module.exports = (sequelize) => {
  class Contact extends Model {}

  Contact.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      firstName: { type: DataTypes.STRING(100), allowNull: false },
      lastName: { type: DataTypes.STRING(100), allowNull: false, defaultValue: '' },
      // Auto-generated as "firstName lastName" on create; editable afterward.
      displayName: { type: DataTypes.STRING(200), allowNull: false },
      email: {
        type: DataTypes.STRING(255),
        allowNull: true,
        unique: true,
        validate: { isEmailOrNull(value) {
          if (value && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) {
            throw new Error('Invalid email address');
          }
        } },
      },
      phone: { type: DataTypes.STRING(50), allowNull: true },
      mobile: { type: DataTypes.STRING(50), allowNull: true },
      departmentId: { type: DataTypes.INTEGER, allowNull: true },
      // The company this record belongs to (client companies, sub-project 2).
      companyId: { type: DataTypes.INTEGER, allowNull: false },
      siteId: { type: DataTypes.INTEGER, allowNull: true },
      jobTitle: { type: DataTypes.STRING(150), allowNull: true },
      notes: { type: DataTypes.TEXT, allowNull: true },
      createdBy: { type: DataTypes.INTEGER, allowNull: true },
      // The tech who "owns" this contact.
      assignedTo: { type: DataTypes.INTEGER, allowNull: true },
      status: { type: DataTypes.ENUM('active', 'inactive'), allowNull: false, defaultValue: 'active' },
      // Set once this contact has ever been created/updated by AD sync —
      // controls whether future syncs manage it and whether it can be
      // deactivated (not deleted) when the AD account disappears/disables.
      adSynced: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      adObjectGUID: { type: DataTypes.STRING(64), allowNull: true },
      adLastSynced: { type: DataTypes.DATE, allowNull: true },
      // Client portal (7a): may this contact sign in to the portal at all.
      portalAccess: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      // bcrypt hash for a password sign-in. Hidden by the default scope and
      // toJSON: read it only through Contact.scope('withPassword').
      passwordHash: { type: DataTypes.STRING(255), allowNull: true },
      portalLastSignInAt: { type: DataTypes.DATE, allowNull: true },
    },
    {
      sequelize,
      modelName: 'Contact',
      tableName: 'Contacts',
      timestamps: true,
      defaultScope: { attributes: { exclude: ['passwordHash'] } },
      scopes: { withPassword: {} },
    }
  );

  // Belt and braces for an instance loaded through the withPassword scope.
  Contact.prototype.toJSON = function toJSON() {
    const values = { ...this.get({ plain: true }) };
    delete values.passwordHash;
    return values;
  };

  return Contact;
};
