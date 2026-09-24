// What version of PRISM this process is.
//
// The authoritative version is the git tag, stamped into the image at build
// time by CI (see .github/workflows/docker-publish.yml) and read back from the
// environment here. Deliberately NOT read from package.json: that file's
// version is not maintained as part of the release process, so trusting it
// would report a number nobody set.
//
// Values you can expect:
//   "0.2.0"   — built from a v0.2.0 tag
//   "dev"     — built from the dev branch, or by hand from a checkout
//   "main"    — built from main between releases

// A tagged build gets a bare semver; anything else is a branch name or the
// Dockerfile default.
function isRelease(version) {
  return /^\d+\.\d+\.\d+/.test(version);
}

function getVersionInfo() {
  const version = process.env.APP_VERSION || 'dev';
  const gitSha = process.env.GIT_SHA || 'unknown';
  return {
    version,
    // Short sha is what you'd actually quote in a bug report. `unknown` is
    // left alone rather than truncated to a misleading "unknow".
    gitSha: gitSha === 'unknown' ? gitSha : gitSha.slice(0, 7),
    release: isRelease(version),
  };
}

module.exports = { getVersionInfo, isRelease };
