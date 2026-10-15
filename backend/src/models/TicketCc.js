const { DataTypes, Model } = require('sequelize');

// One address on a ticket's CC list: it gets every public reply. contactId
// is set when the address belongs to a contact the adder could see;
// addedById null = captured from the inbound email that opened the ticket.
module.exports = (sequelize) => {
  class TicketCc extends Model {}

  TicketCc.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      ticketId: { type: DataTypes.INTEGER, allowNull: false },
      email: {
        type: DataTypes.STRING(255),
        allowNull: false,
        set(v) { this.setDataValue('email', String(v || '').trim().toLowerCase()); },
      },
      contactId: { type: DataTypes.INTEGER, allowNull: true },
      addedById: { type: DataTypes.INTEGER, allowNull: true },
    },
    {
      sequelize,
      modelName: 'TicketCc',
      tableName: 'TicketCcs',
      timestamps: true,
      updatedAt: false,
    }
  );

  return TicketCc;
};
