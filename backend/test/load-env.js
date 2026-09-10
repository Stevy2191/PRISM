// Loads .env.test before anything imports src/config/database.js.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.test') });
process.env.NODE_ENV = 'test';
// config/config.js appends "_test" to DB_NAME for the test environment; the
// runtime Sequelize instance in config/database.js reads DB_NAME directly, so
// point it at the same schema the migrations were applied to.
if (process.env.DB_NAME && !process.env.DB_NAME.endsWith('_test')) {
  process.env.DB_NAME = `${process.env.DB_NAME}_test`;
}
