const { DataTypes, Model } = require('sequelize');

// People who get notified on ticket create/comment/status-change without
// necessarily being the assignee: a staff user, or (client portal) a contact,
// who then also sees the ticket in the portal. Exactly one of the two is set;
// the model validates that (MariaDB can't CHECK a cascading FK column).
module.exports = (sequelize) => {
  class TicketWatcher extends Model {}

  TicketWatcher.init(
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      ticketId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      userId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      contactId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
    },
    {
      validate: {
        oneWatcher() {
          if ((this.userId == null) === (this.contactId == null)) throw new Error('A watcher is either a user or a contact');
        },
      },
      sequelize,
      modelName: 'TicketWatcher',
      tableName: 'TicketWatchers',
      timestamps: true,
      updatedAt: false,
    }
  );

  return TicketWatcher;
};
