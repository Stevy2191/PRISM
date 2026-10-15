const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class Comment extends Model {}

  Comment.init(
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      body: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      authorId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      ticketId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      type: {
        type: DataTypes.ENUM('reply', 'comment_private', 'comment_public'),
        allowNull: false,
        defaultValue: 'reply',
      },
      // The one-off recipients a public reply was emailed to, as a record.
      emailCc: { type: DataTypes.JSON, allowNull: true },
      emailBcc: { type: DataTypes.JSON, allowNull: true },
      // Captured from a technician's own mailbox rather than posted here.
      viaEmail: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    },
    {
      sequelize,
      modelName: 'Comment',
      tableName: 'Comments',
      timestamps: true,
    }
  );

  return Comment;
};
