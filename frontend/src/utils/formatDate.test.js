import { describe, expect, it } from 'vitest';
import { fmtDate, fmtDateTime } from './formatDate';

describe('fmtDate', () => {
  it('writes every date the same way', () => {
    expect(fmtDate('2026-11-12')).toBe('Nov 12, 2026');
    expect(fmtDate(new Date(2026, 0, 5, 9, 30))).toBe('Jan 5, 2026');
    expect(fmtDateTime(new Date(2026, 10, 12, 15, 23))).toBe('Nov 12, 2026, 3:23 PM');
  });
  it('a date-only value is that calendar day in any time zone', () => {
    expect(fmtDate('2026-01-01')).toBe('Jan 1, 2026');
  });
  it('nothing, or nonsense, is the empty mark', () => {
    expect(fmtDate(null)).toBe('—');
    expect(fmtDate('not a date')).toBe('—');
    expect(fmtDateTime(undefined, 'Never')).toBe('Never');
  });
});
