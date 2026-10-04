// Runs once before the suite: pins the time zone, then checks the Node version.
//
// Several dependencies in the runtime graph are ESM-only (sanitize-html pulls
// in htmlparser2; openid-client is ESM throughout). Jest can only `require()`
// an ES module natively on Node 24.9 and later — on anything older, every
// integration suite that loads the app fails with a stack trace pointing at
// `require('sanitize-html')`, which says nothing about the real cause.
//
// This turns that into one clear message. It is also why the `test` script
// passes --experimental-vm-modules: the native support needs the flag as well.
const MINIMUM = [24, 9, 0];

module.exports = async () => {
  // Every suite runs in a fixed non-UTC zone so tests that depend on "the
  // local date" behave the same on a developer machine and on the UTC CI
  // runner. Set here, in globalSetup, because assigning TZ inside a test
  // file's VM context does not reach Node's date handling; workers spawned
  // after globalSetup inherit it.
  process.env.TZ = 'America/Chicago';
  const actual = process.versions.node.split('.').map(Number);
  const tooOld = actual[0] < MINIMUM[0]
    || (actual[0] === MINIMUM[0] && actual[1] < MINIMUM[1]);

  if (tooOld) {
    throw new Error(
      `\nPRISM's test suite needs Node ${MINIMUM.join('.')} or newer — found ${process.versions.node}.\n`
      + 'Jest can only require() ES modules natively from that version, and several\n'
      + 'dependencies (sanitize-html, openid-client) are ESM-only.\n'
      + 'The Dockerfiles and CI both pin Node 24; match that locally (nvm use 24).\n'
    );
  }
};
