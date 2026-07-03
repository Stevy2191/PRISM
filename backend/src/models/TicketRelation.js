const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class TicketRelation extends Model {}

  TicketRelation.init(
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
      relatedTicketId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      // related        — generic association
      // caused_by      — this ticket is caused by the related ticket (e.g. an
      //                  incident caused_by a problem)
      // duplicates     — this ticket duplicates the related ticket
      // parent         — stored from the child's side (ticketId=child,
      //                  relatedTicketId=parent); viewed from the parent's
      //                  side (incoming) it reads as "this is my child"
      relationType: {
        type: DataTypes.ENUM('related', 'caused_by', 'duplicates', 'parent'),
        allowNull: false,
        defaultValue: 'related',
      },
    },
    {
      sequelize,
      modelName: 'TicketRelation',
      tableName: 'TicketRelations',
      timestamps: true,
      updatedAt: false,
    }
  );

  return TicketRelation;
};
