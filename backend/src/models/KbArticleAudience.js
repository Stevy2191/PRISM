const { DataTypes, Model } = require('sequelize');

// Who may read a portal article whose portalScope is 'companies' or
// 'departments': one row per chosen company or department. Exactly one of the
// two is set (model validation: MariaDB can't CHECK a cascading FK column).
module.exports = (sequelize) => {
  class KbArticleAudience extends Model {}

  KbArticleAudience.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      articleId: { type: DataTypes.INTEGER, allowNull: false },
      companyId: { type: DataTypes.INTEGER, allowNull: true },
      departmentId: { type: DataTypes.INTEGER, allowNull: true },
    },
    {
      sequelize,
      modelName: 'KbArticleAudience',
      tableName: 'KbArticleAudiences',
      timestamps: false,
      validate: {
        oneTarget() {
          if ((this.companyId == null) === (this.departmentId == null)) throw new Error('An audience row names a company or a department');
        },
      },
    }
  );

  return KbArticleAudience;
};
