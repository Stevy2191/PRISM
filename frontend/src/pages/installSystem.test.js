import { describe, expect, it } from 'vitest';
import { detectSystem } from './installSystem';

describe('detectSystem', () => {
  it('reads the platform, then the user agent', () => {
    expect(detectSystem({ userAgentData: { platform: 'Windows' } })).toBe('windows');
    expect(detectSystem({ userAgentData: { platform: 'macOS' } })).toBe('macos');
    expect(detectSystem({ platform: 'MacIntel', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5)' })).toBe('macos');
    expect(detectSystem({ platform: 'Linux x86_64', userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' })).toBe('linux');
    expect(detectSystem({ userAgentData: { platform: 'Linux' } })).toBe('linux');
  });
  it('falls back to Windows, also for phones', () => {
    expect(detectSystem({})).toBe('windows');
    expect(detectSystem({ platform: 'iPhone', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' })).toBe('windows');
    expect(detectSystem({ platform: 'Linux armv8l', userAgent: 'Mozilla/5.0 (Linux; Android 14)' })).toBe('windows');
  });
});
