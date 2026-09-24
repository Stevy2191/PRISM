const { getVersionInfo, isRelease } = require('../../src/utils/version');

const withEnv = (env, fn) => {
  const saved = { APP_VERSION: process.env.APP_VERSION, GIT_SHA: process.env.GIT_SHA };
  Object.assign(process.env, env);
  for (const k of Object.keys(env)) if (env[k] === undefined) delete process.env[k];
  try {
    return fn();
  } finally {
    for (const k of Object.keys(saved)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
};

describe('isRelease', () => {
  test('a bare semver is a release', () => {
    expect(isRelease('0.2.0')).toBe(true);
    expect(isRelease('10.4.31')).toBe(true);
  });

  test('a branch name is not', () => {
    expect(isRelease('dev')).toBe(false);
    expect(isRelease('main')).toBe(false);
    expect(isRelease('feat-something')).toBe(false);
  });
});

describe('getVersionInfo', () => {
  test('reports the stamped version and a short sha', () => {
    withEnv({ APP_VERSION: '0.2.0', GIT_SHA: 'a1b2c3d4e5f6a7b8c9d0' }, () => {
      expect(getVersionInfo()).toEqual({ version: '0.2.0', gitSha: 'a1b2c3d', release: true });
    });
  });

  test('falls back to dev when the image carries no stamp', () => {
    withEnv({ APP_VERSION: undefined, GIT_SHA: undefined }, () => {
      expect(getVersionInfo()).toEqual({ version: 'dev', gitSha: 'unknown', release: false });
    });
  });

  test('leaves an unknown sha alone rather than truncating it', () => {
    withEnv({ APP_VERSION: 'dev', GIT_SHA: 'unknown' }, () => {
      expect(getVersionInfo().gitSha).toBe('unknown');
    });
  });

  test('a branch-built image is not reported as a release', () => {
    withEnv({ APP_VERSION: 'dev', GIT_SHA: 'abcdef1234567' }, () => {
      const info = getVersionInfo();
      expect(info.version).toBe('dev');
      expect(info.release).toBe(false);
      expect(info.gitSha).toBe('abcdef1');
    });
  });
});
