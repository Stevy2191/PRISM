// Browser smoke tests: the real API and the built frontend, served from one
// in-process server on the integration test DB, driven by headless Chromium.
// Pages see one origin, as they do behind nginx in production.
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const { chromium } = require('playwright-core');
const { createApp, createSessionStore } = require('../../src/app');

const DIST = path.join(__dirname, '../../../frontend/dist');
const PASSWORD = 'IntegrationPass!2026'; // every fixture user's password

// PRISM_CHROMIUM wins; otherwise the newest headless shell playwright has
// installed under ~/.cache/ms-playwright.
function findChromium() {
  if (process.env.PRISM_CHROMIUM) return process.env.PRISM_CHROMIUM;
  const root = path.join(os.homedir(), '.cache/ms-playwright');
  const builds = fs.existsSync(root)
    ? fs.readdirSync(root).filter((d) => d.startsWith('chromium_headless_shell-')).sort().reverse()
    : [];
  for (const build of builds) {
    for (const sub of fs.readdirSync(path.join(root, build))) {
      const exe = path.join(root, build, sub, 'chrome-headless-shell');
      if (fs.existsSync(exe)) return exe;
    }
  }
  throw new Error('No headless Chromium found: set PRISM_CHROMIUM, or run `npx playwright-core install chromium-headless-shell`');
}

async function startSmoke() {
  if (!fs.existsSync(path.join(DIST, 'index.html'))) {
    throw new Error('frontend/dist is missing: `npm run test:smoke` builds it first');
  }
  const sessionStore = createSessionStore();
  await sessionStore.sync();

  const outer = express();
  outer.use(express.static(DIST, { index: false }));
  // Client-side routes get the SPA; everything under /api goes to the API.
  outer.use((req, res, next) => (
    req.method === 'GET' && !req.path.startsWith('/api/') ? res.sendFile(path.join(DIST, 'index.html')) : next()
  ));
  outer.use(createApp({ sessionStore }));

  const server = await new Promise((resolve) => {
    const s = outer.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ executablePath: findChromium() });

  // A page signed in as `username`: the context's request client shares its
  // cookie jar with the pages it opens.
  async function pageAs(username, password = PASSWORD) {
    const context = await browser.newContext({ baseURL: base });
    const res = await context.request.post('/api/v1/auth/login', { data: { username, password } });
    if (!res.ok()) throw new Error(`smoke login failed for ${username}: ${res.status()}`);
    return context.newPage();
  }

  async function stop() {
    await browser.close();
    await new Promise((resolve) => { server.close(resolve); });
  }

  return { base, pageAs, stop };
}

module.exports = { startSmoke };
