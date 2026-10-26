const fs = require('fs'), path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || require('os').homedir() + '/.npm/_npx/361ceb562f3b3235/node_modules/playwright-core');
const exe = require('child_process').execSync('ls -d ~/.cache/ms-playwright/chromium_headless_shell-*/chrome-*/chrome-headless-shell | head -1').toString().trim();
// Renders mockups to PNG for side-by-side checks while building.
// Usage (from this folder): node preview.js Main Ticket:dark ...   -> $OUT (default /tmp/look-a-preview)
const OUT = process.env.OUT || '/tmp/look-a-preview';
fs.mkdirSync(OUT, { recursive: true });
const css = fs.readFileSync('looka.css', 'utf8');
(async () => {
  const b = await chromium.launch({ executablePath: exe });
  for (const arg of process.argv.slice(2)) {
    const [name, theme] = arg.split(':');
    let h = fs.readFileSync(`${name}.dc.html`, 'utf8');
    const m = h.match(/"width":(\d+),"height":(\d+)/);
    h = h.replace(/<script[\s\S]*?<\/script>/g, '').replace('<link rel="stylesheet" href="/_blob/c5853215c172bfe2d0c9d7a4bd04f8a4">', `<style>${css}</style>`).replace(/\{\{cls\}\}/g, 'app t-' + (theme || 'light'));
    fs.writeFileSync(`${OUT}/${name}.html`, h);
    const p = await b.newPage({ viewport: { width: +m[1], height: +m[2] } });
    await p.goto('file://' + path.resolve(`${OUT}/${name}.html`));
    await p.waitForTimeout(400);
    await p.screenshot({ path: `${OUT}/${name}-${theme || 'light'}.png` });
    await p.close();
  }
  await b.close();
})();
