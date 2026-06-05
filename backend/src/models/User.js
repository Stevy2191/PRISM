const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class User extends Model {
    // Never expose the password hash in API responses.
    toJSON() {
      const values = { ...this.get() };
      delete values.passwordHash;
      return values;
    }
  }

  User.init(
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      username: {
        type: DataTypes.STRING(255),
        allowNull: false,
        unique: true,
      },
      displayName: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      email: {
        type: DataTypes.STRING(255),
        allowNull: true,
        validate: { isEmailOrNull(value) {
          if (value && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) {
            throw new Error('Invalid email address');
          }
        } },
      },
      role: {
        type: DataTypes.ENUM('admin', 'technician', 'requester'),
        allowNull: false,
        defaultValue: 'requester',
      },
      departmentId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      // Local-account fields. AD/LDAP users have isLocalAccount=false and a null
      // passwordHash; they authenticate against the directory instead.
      passwordHash: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      isLocalAccount: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      mustChangePassword: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      lastLogin: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: 'User',
      tableName: 'Users',
      timestamps: true,
    }
  );

  return User;
};
