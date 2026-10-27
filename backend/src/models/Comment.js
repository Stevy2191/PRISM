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
      // A reply written by a contact in the client portal (authorId is then
      // the system actor).
      authorContactId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      // A customer's reply (portal or email). Staff answers are type 'reply'
      // too, so this, not the type, says whose side wrote it.
      fromCustomer: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
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
