// Browser smoke tests (plan 2b). Not part of `npm test` or CI: they need a
// built frontend and a headless Chromium. Run with `npm run test:smoke`.
module.exports = {
  testEnvironment: 'node',
  maxWorkers: 1,
  globalSetup: '<rootDir>/test/checkNodeVersion.js',
  setupFiles: ['<rootDir>/test/load-env.js'],
  testMatch: ['<rootDir>/test/smoke/**/*.smoke.js'],
  testTimeout: 60000,
};
