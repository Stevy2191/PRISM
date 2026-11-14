import { describe, it, expect } from 'vitest';
import { isSendKey, sendOnEnter } from './sendOnEnter';

const key = (over) => ({ key: 'Enter', shiftKey: false, altKey: false, nativeEvent: {}, prevented: 0, preventDefault() { this.prevented += 1; }, ...over });

describe('Enter sends, Shift+Enter is a new line', () => {
  it('Enter alone (or with Ctrl or ⌘) sends', () => {
    expect(isSendKey(key())).toBe(true);
    expect(isSendKey(key({ ctrlKey: true }))).toBe(true);
    expect(isSendKey(key({ metaKey: true }))).toBe(true);
  });
  it('Shift+Enter, Alt+Enter, another key, and Enter while composing do not', () => {
    expect(isSendKey(key({ shiftKey: true }))).toBe(false);
    expect(isSendKey(key({ altKey: true }))).toBe(false);
    expect(isSendKey(key({ key: 'a' }))).toBe(false);
    expect(isSendKey(key({ nativeEvent: { isComposing: true } }))).toBe(false);
    expect(isSendKey(key({ keyCode: 229 }))).toBe(false);
  });
  it('sending stops the new line; a new line is left alone', () => {
    let sent = 0;
    const send = () => { sent += 1; };
    const e = key();
    sendOnEnter(send)(e);
    expect(sent).toBe(1);
    expect(e.prevented).toBe(1);
    const shifted = key({ shiftKey: true });
    sendOnEnter(send)(shifted);
    expect(sent).toBe(1);
    expect(shifted.prevented).toBe(0);
  });
});
