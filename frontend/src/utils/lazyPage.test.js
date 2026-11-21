import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadOrReload, RELOAD_KEY } from './lazyPage.js';

function fakeStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    m,
  };
}

describe('loading a page, and reloading once after an upgrade', () => {
  let storage;
  let reloads;
  const reload = () => { reloads += 1; };
  beforeEach(() => { storage = fakeStorage(); reloads = 0; });

  it('a page that loads is returned, and clears an earlier reload mark', async () => {
    storage.setItem(RELOAD_KEY, String(Date.now()));
    const mod = { default: 'Page' };
    assert.equal(await loadOrReload(() => Promise.resolve(mod), { storage, reload }), mod);
    assert.equal(storage.getItem(RELOAD_KEY), null);
    assert.equal(reloads, 0);
  });

  it('a page missing after an upgrade reloads the app once, and waits', async () => {
    const pending = loadOrReload(() => Promise.reject(new Error('Failed to fetch dynamically imported module')), { storage, reload });
    const outcome = await Promise.race([pending.then(() => 'settled', () => 'settled'), new Promise((r) => setTimeout(() => r('waiting'), 20))]);
    assert.equal(outcome, 'waiting'); // nothing renders an error while the page reloads
    assert.equal(reloads, 1);
    assert.ok(storage.getItem(RELOAD_KEY));
  });

  it('if it still fails right after that reload, the error shows instead of looping', async () => {
    storage.setItem(RELOAD_KEY, String(Date.now()));
    const err = new Error('Failed to fetch dynamically imported module');
    await assert.rejects(loadOrReload(() => Promise.reject(err), { storage, reload }), err);
    assert.equal(reloads, 0);
  });

  it('a reload mark from long ago does not stop a new reload', async () => {
    storage.setItem(RELOAD_KEY, String(Date.now() - 60 * 60 * 1000));
    loadOrReload(() => Promise.reject(new Error('gone')), { storage, reload });
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(reloads, 1);
  });

  it('with no storage at all (private mode), it never reloads', async () => {
    const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() {} };
    const err = new Error('gone');
    await assert.rejects(loadOrReload(() => Promise.reject(err), { storage: broken, reload }), err);
    assert.equal(reloads, 0);
  });
});
