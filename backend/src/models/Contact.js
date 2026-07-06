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
      jobTitle: { type: DataTypes.STRING(150), allowNull: true },
      notes: { type: DataTypes.TEXT, allowNull: true },
      createdBy: { type: DataTypes.INTEGER, allowNull: true },
      // The tech who "owns" this contact.
      assignedTo: { type: DataTypes.INTEGER, allowNull: true },
    },
    {
      sequelize,
      modelName: 'Contact',
      tableName: 'Contacts',
      timestamps: true,
    }
  );

  return Contact;
};
