module.exports = {
  testEnvironment: 'node',
  // Integration tests share one MariaDB schema, so they must not run
  // concurrently against each other.
  maxWorkers: 1,
  // Every test file re-requires the whole app, and that memory is never fully
  // returned, so one long-lived process grows until it hits the heap cap in
  // package.json (the full suite ran out of memory on CI, and long GC pauses
  // before that surfaced as "failed to create socket" connection timeouts).
  // Setting a limit makes Jest run the files in a worker it restarts between
  // files once the worker grows past this size.
  workerIdleMemoryLimit: '1GB',
  globalSetup: '<rootDir>/test/checkNodeVersion.js',
  setupFiles: ['<rootDir>/test/load-env.js'],
  testMatch: ['<rootDir>/test/**/*.test.js'],
  collectCoverageFrom: ['src/**/*.js'],
  testTimeout: 30000,
};
