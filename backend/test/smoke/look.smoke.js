const { resetData, closeDb } = require('../integration/helpers');
const { makeAdmin } = require('../integration/fixtures');
const { startSmoke } = require('./harness');

// Look A foundation: dark by default with no flash, Instrument Sans, and the
// custom-colour layer still winning over both themes.

let smoke;
beforeAll(async () => { smoke = await startSmoke(); });
afterAll(async () => { await smoke.stop(); await closeDb(); });
beforeEach(resetData);

const rgbSum = (rgb) => rgb.match(/\d+/g).slice(0, 3).reduce((a, b) => a + Number(b), 0);

describe('look A', () => {
  it('fresh browser with no stored theme opens dark (no light flash: data-theme is dark before React mounts)', async () => {
    await makeAdmin();
    const page = await smoke.pageAs('admin');
    // Before any script module runs: the inline head script has already stamped it.
    await page.addInitScript(() => {
      document.addEventListener('DOMContentLoaded', () => {
        window.__themeAtDcl = document.documentElement.getAttribute('data-theme');
      });
    });
    await page.goto('/dashboard');
    await page.getByRole('link', { name: 'Tickets' }).first().waitFor();
    expect(await page.evaluate(() => window.__themeAtDcl)).toBe('dark');
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('dark');
    expect(await page.evaluate(() => localStorage.getItem('prism.theme'))).toBe('dark');
  });

  it('stored light is kept', async () => {
    await makeAdmin();
    const page = await smoke.pageAs('admin');
    await page.goto('/settings/preferences');
    await page.evaluate(() => localStorage.setItem('prism.theme', 'light'));
    await page.goto('/dashboard');
    await page.getByRole('link', { name: 'Tickets' }).first().waitFor();
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('light');
  });

  it('body uses Instrument Sans', async () => {
    await makeAdmin();
    const page = await smoke.pageAs('admin');
    await page.goto('/dashboard');
    await page.getByRole('link', { name: 'Tickets' }).first().waitFor();
    const family = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
    expect(family).toContain('Instrument Sans');
    const loaded = await page.evaluate(async () => {
      await document.fonts.load('400 14px "Instrument Sans"');
      return document.fonts.check('400 14px "Instrument Sans"');
    });
    expect(loaded).toBe(true);
  });

  it('dark theme sets a dark --color-bg', async () => {
    await makeAdmin();
    const page = await smoke.pageAs('admin');
    await page.goto('/dashboard');
    await page.getByRole('link', { name: 'Tickets' }).first().waitFor();
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(rgbSum(bg)).toBeLessThan(200);
    const token = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--color-bg').trim());
    expect(token).toMatch(/^#/);
  });

  it('Settings → Appearance custom accent still overrides --color-accent in dark and light', async () => {
    await makeAdmin();
    const page = await smoke.pageAs('admin');
    await page.goto('/settings/preferences');
    for (const theme of ['dark', 'light']) {
      await page.evaluate((t) => localStorage.setItem('prism.theme', t), theme);
      await page.goto('/settings/preferences');
      await page.getByRole('heading', { name: 'Appearance' }).waitFor();
      const seen = await page.evaluate(() => {
        const root = document.documentElement;
        const before = getComputedStyle(root).getPropertyValue('--color-accent').trim();
        root.style.setProperty('--color-accent', '#ff00aa'); // how custom colours are layered
        const probe = document.createElement('button');
        probe.className = 'btn-primary';
        document.body.appendChild(probe);
        const after = getComputedStyle(root).getPropertyValue('--color-accent').trim();
        const bg = getComputedStyle(probe).backgroundColor;
        probe.remove();
        root.style.removeProperty('--color-accent');
        return { theme: root.getAttribute('data-theme'), before, after, bg };
      });
      expect(seen.theme).toBe(theme);
      expect(seen.before).not.toBe('#ff00aa');
      expect(seen.after).toBe('#ff00aa');
      expect(seen.bg).toBe('rgb(255, 0, 170)');
    }
  });
});
