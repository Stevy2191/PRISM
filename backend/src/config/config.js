// Sequelize CLI configuration. Reads connection settings from environment.
// Used by sequelize-cli for migrations and seeders.
require('dotenv').config();

// Wrapped driver — see mariadbDriver.js. This is the config sequelize-cli
// loads, so without it `db:migrate:undo` fails on any migration that removes
// a column.
const dialectModule = require('./mariadbDriver');

const base = {
  username: process.env.DB_USER || 'prism',
  password: process.env.DB_PASSWORD || 'changeme',
  database: process.env.DB_NAME || 'prism',
  host: process.env.DB_HOST || 'mariadb',
  port: parseInt(process.env.DB_PORT, 10) || 3306,
  dialect: 'mariadb',
  dialectModule,
  dialectOptions: {
    timezone: 'Etc/UTC',
  },
  define: {
    freezeTableName: false,
    underscored: false,
  },
  logging: false,
};

module.exports = {
  development: base,
  test: { ...base, database: `${base.database}_test` },
  production: base,
};
