const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class Role extends Model {}

  Role.init(
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      name: {
        type: DataTypes.STRING(255),
        allowNull: false,
        unique: true,
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      // Permanently locks a *custom* role to one specific department (rare —
      // for a genuinely bespoke per-department role). Null in the far more
      // common case, including for department-scoped *template* roles like
      // the seeded Department Manager/Department Staff, whose department is
      // instead chosen per-assignment (see UserRole.departmentId).
      departmentId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      // The actual "System-wide" vs "Department-scoped" discriminator shown
      // in the Assign-a-role dropdown. Distinct from departmentId above: a
      // role can be scope='department' with departmentId still null (a
      // reusable template assignable to any department, department chosen
      // at assignment time) or with departmentId set (locked to one dept).
      scope: {
        type: DataTypes.ENUM('system', 'department'),
        allowNull: false,
        defaultValue: 'system',
      },
      // System roles (seeded on migration) cannot be deleted from the UI.
      isSystemRole: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
    },
    {
      sequelize,
      modelName: 'Role',
      tableName: 'Roles',
      timestamps: true,
    }
  );

  return Role;
};
