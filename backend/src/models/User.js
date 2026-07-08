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
      // firstName/lastName are optional and, when both set, are what
      // displayName is kept in sync with (see usersController's
      // computeDisplayName) — displayName itself remains the column every
      // existing read call site already uses, so this is a write-time-only
      // concern rather than something read paths need to re-resolve.
      firstName: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      lastName: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      phone: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      jobTitle: {
        type: DataTypes.STRING(150),
        allowNull: true,
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
      // The "requester" tier was retired in favor of the Contacts module —
      // PRISM users are always staff now.
      role: {
        type: DataTypes.ENUM('admin', 'technician'),
        allowNull: false,
        defaultValue: 'technician',
      },
      departmentId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      // False for deactivated accounts (e.g. legacy requester-role users
      // migrated to Contacts) — kept for history, blocked from logging in.
      isActive: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      // Primary role under the granular permissions system (see Role/
      // permissionService). Additive to the `role` enum above — a user may
      // also hold further roles via UserRoles.
      roleId: {
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
      // Manual: tech controls start/stop. Automatic: timer starts when a
      // ticket is opened and stops (prompting to log, per the two prefs
      // below) when the tech navigates away or closes the tab.
      timerMode: {
        type: DataTypes.ENUM('manual', 'automatic'),
        allowNull: false,
        defaultValue: 'manual',
      },
      // Seconds. Automatic-mode entries shorter than this are discarded silently.
      timerMinThreshold: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      // When true, always show the log-time modal before saving; when false,
      // automatic mode saves silently (still subject to timerMinThreshold).
      timerPromptBeforeLog: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
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
