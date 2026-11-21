import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fmtDate, fmtDateTime } from './formatDate.js';

describe('fmtDate', () => {
  it('writes every date the same way', () => {
    assert.equal(fmtDate('2026-11-12'), 'Nov 12, 2026');
    assert.equal(fmtDate(new Date(2026, 0, 5, 9, 30)), 'Jan 5, 2026');
    assert.equal(fmtDateTime(new Date(2026, 10, 12, 15, 23)), 'Nov 12, 2026, 3:23 PM');
  });
  it('a date-only value is that calendar day in any time zone', () => {
    assert.equal(fmtDate('2026-01-01'), 'Jan 1, 2026');
  });
  it('nothing, or nonsense, is the empty mark', () => {
    assert.equal(fmtDate(null), '—');
    assert.equal(fmtDate('not a date'), '—');
    assert.equal(fmtDateTime(undefined, 'Never'), 'Never');
  });
});
