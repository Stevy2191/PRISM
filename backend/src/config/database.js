// Runtime Sequelize instance shared across the app.
const { Sequelize } = require('sequelize');
const dialectModule = require('./mariadbDriver');

const sequelize = new Sequelize(
  process.env.DB_NAME || 'prism',
  process.env.DB_USER || 'prism',
  process.env.DB_PASSWORD || 'changeme',
  {
    host: process.env.DB_HOST || 'mariadb',
    port: parseInt(process.env.DB_PORT, 10) || 3306,
    dialect: 'mariadb',
    // Wrapped driver — see mariadbDriver.js. Without it, any raw query
    // (and therefore every migration rollback) fails on a strict-mode delete.
    dialectModule,
    dialectOptions: {
      timezone: 'Etc/UTC',
    },
    timezone: 'Etc/UTC',
    logging: process.env.NODE_ENV === 'development' ? console.log : false,
    pool: {
      max: 10,
      min: 0,
      acquire: 30000,
      idle: 10000,
    },
  }
);

module.exports = sequelize;
