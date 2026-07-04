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
      // Personal color overrides — { "--color-accent": "#e11d48", ... }.
      // Stored independently of whether they're currently active (see
      // userColorsEnabled below) so toggling personal colors off doesn't
      // destroy them; only an explicit "Reset to system defaults" clears
      // this. null/empty means the user has never saved any.
      userColors: {
        type: DataTypes.JSON,
        allowNull: true,
      },
      // Whether userColors should currently be applied. Kept separate from
      // userColors itself so the "Use my own colors" toggle can be flipped
      // off and back on non-destructively — see SettingsContext.jsx's
      // tier-based color resolution.
      userColorsEnabled: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
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
