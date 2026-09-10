module.exports = {
  testEnvironment: 'node',
  // Integration tests share one MariaDB schema, so they must not run
  // concurrently against each other.
  maxWorkers: 1,
  setupFiles: ['<rootDir>/test/load-env.js'],
  testMatch: ['<rootDir>/test/**/*.test.js'],
  collectCoverageFrom: ['src/**/*.js'],
  testTimeout: 30000,
};
