import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isSendKey, sendOnEnter } from './sendOnEnter.js';

const key = (over) => ({ key: 'Enter', shiftKey: false, altKey: false, nativeEvent: {}, prevented: 0, preventDefault() { this.prevented += 1; }, ...over });

describe('Enter sends, Shift+Enter is a new line', () => {
  it('Enter alone (or with Ctrl or ⌘) sends', () => {
    assert.equal(isSendKey(key()), true);
    assert.equal(isSendKey(key({ ctrlKey: true })), true);
    assert.equal(isSendKey(key({ metaKey: true })), true);
  });
  it('Shift+Enter, Alt+Enter, another key, and Enter while composing do not', () => {
    assert.equal(isSendKey(key({ shiftKey: true })), false);
    assert.equal(isSendKey(key({ altKey: true })), false);
    assert.equal(isSendKey(key({ key: 'a' })), false);
    assert.equal(isSendKey(key({ nativeEvent: { isComposing: true } })), false);
    assert.equal(isSendKey(key({ keyCode: 229 })), false);
  });
  it('sending stops the new line; a new line is left alone', () => {
    let sent = 0;
    const send = () => { sent += 1; };
    const e = key();
    sendOnEnter(send)(e);
    assert.equal(sent, 1);
    assert.equal(e.prevented, 1);
    const shifted = key({ shiftKey: true });
    sendOnEnter(send)(shifted);
    assert.equal(sent, 1);
    assert.equal(shifted.prevented, 0);
  });
});
