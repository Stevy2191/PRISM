// Renders an SVG at each size, straight from the vector (sharper small
// sizes than shrinking one big image), with a transparent background.
//   node rasterize.cjs <svg> <out-dir> <size>...
// Needs Playwright with Chromium (npm i playwright; npx playwright install chromium).
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

(async () => {
  const [svgPath, outDir, ...sizes] = process.argv.slice(2);
  const svg = fs.readFileSync(svgPath, 'utf8');
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const s of sizes.map(Number)) {
    await page.setViewportSize({ width: s, height: s });
    await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${s}" height="${s}" `)}</body></html>`);
    await page.screenshot({ path: path.join(outDir, `${s}.png`), omitBackground: true, clip: { x: 0, y: 0, width: s, height: s } });
  }
  await browser.close();
})().catch((err) => { console.error(err); process.exit(1); });
