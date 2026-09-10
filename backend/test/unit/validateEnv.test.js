const { validateEnv, resolveTrustProxy, parseTrustProxy } = require('../../src/config/validateEnv');

const GOOD_SECRET = 'a'.repeat(48);
const check = (env) => validateEnv(env, { exitOnFailure: false });

describe('validateEnv', () => {
  it('accepts a complete, non-placeholder configuration', () => {
    expect(check({ SESSION_SECRET: GOOD_SECRET }).ok).toBe(true);
  });

  it('refuses to start with no SESSION_SECRET', () => {
    const result = check({});
    expect(result.ok).toBe(false);
    expect(result.problems.join(' ')).toMatch(/SESSION_SECRET is not set/);
  });

  // This is the regression that mattered: the placeholder was only rejected
  // when NODE_ENV was exactly "production", so an install that never set
  // NODE_ENV happily ran on the secret published in .env.example.
  it.each(['production', 'development', 'staging', undefined])(
    'rejects the "changeme" placeholder when NODE_ENV=%s',
    (nodeEnv) => {
      const result = check({ SESSION_SECRET: 'changeme', NODE_ENV: nodeEnv });
      expect(result.ok).toBe(false);
      expect(result.problems.join(' ')).toMatch(/placeholder/);
    }
  );

  it('rejects a secret shorter than 32 characters', () => {
    const result = check({ SESSION_SECRET: 'short-but-not-a-placeholder' });
    expect(result.ok).toBe(false);
    expect(result.problems.join(' ')).toMatch(/32 or more/);
  });

  it('rejects placeholder database and bootstrap passwords', () => {
    const result = check({
      SESSION_SECRET: GOOD_SECRET,
      DB_PASSWORD: 'changeme',
      BOOTSTRAP_LOCAL_PASSWORD: 'changeme',
    });
    expect(result.problems).toHaveLength(2);
  });

  it('requires a Secure cookie when the app advertises https', () => {
    const result = check({ SESSION_SECRET: GOOD_SECRET, PUBLIC_APP_URL: 'https://help.example.com' });
    expect(result.ok).toBe(false);
    expect(result.problems.join(' ')).toMatch(/COOKIE_SECURE/);
  });

  it('allows plain http deployments to leave COOKIE_SECURE off', () => {
    expect(check({ SESSION_SECRET: GOOD_SECRET, PUBLIC_APP_URL: 'http://helpdesk.internal' }).ok).toBe(true);
  });

  it('reports every problem at once rather than one per restart', () => {
    const result = check({ SESSION_SECRET: 'changeme', DB_PASSWORD: 'changeme' });
    expect(result.problems.length).toBeGreaterThan(1);
  });
});

describe('resolveTrustProxy', () => {
  // Defaulting to "trust" is what let a client forge X-Forwarded-For and reset
  // the login rate limiter, so silence must mean "do not trust".
  it('does not trust proxy headers by default', () => {
    expect(resolveTrustProxy({})).toBe(false);
    expect(resolveTrustProxy({ TRUST_PROXY: '' })).toBe(false);
  });

  it('accepts a hop count', () => {
    expect(resolveTrustProxy({ TRUST_PROXY: '1' })).toBe(1);
  });

  it('accepts an explicit false', () => {
    expect(resolveTrustProxy({ TRUST_PROXY: 'false' })).toBe(false);
  });

  it('accepts a list of trusted proxies', () => {
    expect(resolveTrustProxy({ TRUST_PROXY: '10.0.0.1, 10.0.0.2' })).toEqual(['10.0.0.1', '10.0.0.2']);
  });

  it('falls back to not trusting when the value is unusable', () => {
    expect(parseTrustProxy('   ')).toBe(false);
  });
});
