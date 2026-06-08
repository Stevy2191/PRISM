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
      relationType: {
        type: DataTypes.ENUM('related', 'caused_by', 'duplicates'),
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
