const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class CsatSurvey extends Model {}

  CsatSurvey.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      ticketId: { type: DataTypes.INTEGER, allowNull: false },
      contactId: { type: DataTypes.INTEGER, allowNull: false },
      assignedToUserId: { type: DataTypes.INTEGER, allowNull: true },
      surveyToken: { type: DataTypes.STRING(36), allowNull: false, unique: true },
      status: {
        type: DataTypes.ENUM('pending', 'responded', 'expired'),
        allowNull: false,
        defaultValue: 'pending',
      },
      // When the survey email is due to go out — createdAt + configured send
      // delay. The scheduler polls for pending rows past this timestamp.
      dueToSendAt: { type: DataTypes.DATE, allowNull: false },
      sentAt: { type: DataTypes.DATE, allowNull: true },
      respondedAt: { type: DataTypes.DATE, allowNull: true },
      rating: { type: DataTypes.INTEGER, allowNull: true, validate: { min: 1, max: 5 } },
      comment: { type: DataTypes.TEXT, allowNull: true },
    },
    {
      sequelize,
      modelName: 'CsatSurvey',
      tableName: 'CsatSurveys',
      timestamps: true,
    }
  );

  return CsatSurvey;
};
