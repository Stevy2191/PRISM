const { DataTypes, Model } = require('sequelize');

// A Knowledge Base article. `body` holds sanitized HTML authored in the
// rich-text editor (sanitized server-side in the controller before save, so
// any render path — staff view or public portal — is safe). An article can
// also carry file attachments (KbAttachment) for uploaded how-tos / PDFs /
// Word docs.
//
//   status:     draft     — only visible to staff in the KB (work in progress)
//               published  — visible to staff readers
//   visibility: internal  — "Agents only" in the UI: staff workspace only
//               public     — "End users" in the UI: also visible to end users
//                            (served by the /kb portal routes), but only once
//                            status === 'published'. The future end-user portal
//                            reads these same visibility='public' + published
//                            articles.
module.exports = (sequelize) => {
  class KbArticle extends Model {}

  KbArticle.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      title: { type: DataTypes.STRING(255), allowNull: false },
      // Unique URL-safe identifier; the public portal addresses articles by
      // slug (/kb/a/:slug) so ids aren't enumerable there.
      slug: { type: DataTypes.STRING(280), allowNull: false, unique: true },
      // Plain-text summary shown in list cards + portal search results. Kept
      // separate from body so lists never have to render/strip HTML.
      excerpt: { type: DataTypes.STRING(500), allowNull: true },
      // Sanitized HTML.
      body: { type: DataTypes.TEXT('long'), allowNull: true },
      categoryId: { type: DataTypes.INTEGER, allowNull: true },
      status: { type: DataTypes.ENUM('draft', 'published'), allowNull: false, defaultValue: 'draft' },
      visibility: { type: DataTypes.ENUM('internal', 'public'), allowNull: false, defaultValue: 'internal' },
      viewCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      authorId: { type: DataTypes.INTEGER, allowNull: true },
      updatedById: { type: DataTypes.INTEGER, allowNull: true },
      publishedAt: { type: DataTypes.DATE, allowNull: true },
    },
    {
      sequelize,
      modelName: 'KbArticle',
      tableName: 'KbArticles',
      timestamps: true,
    }
  );

  return KbArticle;
};
