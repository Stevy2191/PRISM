import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { detectSystem } from './installSystem.js';

describe('detectSystem', () => {
  it('reads the platform, then the user agent', () => {
    assert.equal(detectSystem({ userAgentData: { platform: 'Windows' } }), 'windows');
    assert.equal(detectSystem({ userAgentData: { platform: 'macOS' } }), 'macos');
    assert.equal(detectSystem({ platform: 'MacIntel', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5)' }), 'macos');
    assert.equal(detectSystem({ platform: 'Linux x86_64', userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' }), 'linux');
    assert.equal(detectSystem({ userAgentData: { platform: 'Linux' } }), 'linux');
  });
  it('falls back to Windows, also for phones', () => {
    assert.equal(detectSystem({}), 'windows');
    assert.equal(detectSystem({ platform: 'iPhone', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' }), 'windows');
    assert.equal(detectSystem({ platform: 'Linux armv8l', userAgent: 'Mozilla/5.0 (Linux; Android 14)' }), 'windows');
  });
});
