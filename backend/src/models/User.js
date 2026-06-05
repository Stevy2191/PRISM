const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class User extends Model {
    // Strip nothing sensitive here (no local passwords), but keep a clean shape.
    toJSON() {
      return { ...this.get() };
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
