import { test } from 'node:test';
import assert from 'node:assert/strict';
import { opensPicker, installDatePickerOpener } from './datePicker.js';

const field = (over = {}) => ({ tagName: 'INPUT', type: 'date', disabled: false, readOnly: false, showPicker() { this.opened = true; }, ...over });

test('date-like fields open their picker', () => {
  for (const type of ['date', 'datetime-local', 'month', 'week', 'time']) assert.equal(opensPicker(field({ type })), true, type);
});

test('other fields, disabled and read-only ones, and old browsers do not', () => {
  assert.equal(opensPicker(field({ type: 'text' })), false);
  assert.equal(opensPicker(field({ tagName: 'SELECT' })), false);
  assert.equal(opensPicker(field({ disabled: true })), false);
  assert.equal(opensPicker(field({ readOnly: true })), false);
  assert.equal(opensPicker(field({ showPicker: undefined })), false);
  assert.equal(opensPicker(null), false);
});

test('a click opens it, and a browser that refuses is ignored', () => {
  let handler;
  installDatePickerOpener({ addEventListener: (t, h, capture) => { assert.equal(t, 'click'); assert.equal(capture, true); handler = h; } });
  const f = field();
  handler({ target: f });
  assert.equal(f.opened, true);
  handler({ target: field({ showPicker() { throw new Error('NotAllowedError'); } }) });
});
