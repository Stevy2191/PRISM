const fs = require('fs'), path = require('path');
// Renders the Playbooks mockups to PNG for side-by-side checks while building.
// Usage (from this folder): node preview.js Main TicketForm:dark ...   -> $OUT (default /tmp/pb-preview)
// Each board has a light/dark "theme" switch; the argument after ':' picks it.
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const OUT = process.env.OUT || '/tmp/pb-preview';
fs.mkdirSync(OUT, { recursive: true });
const css = fs.readFileSync(path.join(__dirname, 'pb.css'), 'utf8');
(async () => {
  const b = await chromium.launch();
  for (const arg of process.argv.slice(2)) {
    const [name, theme] = arg.split(':');
    let h = fs.readFileSync(path.join(__dirname, `${name}.dc.html`), 'utf8');
    const m = h.match(/"width":(\d+),"height":(\d+)/);
    h = h.replace(/<script[\s\S]*?<\/script>/g, '')
      .replace('<link rel="stylesheet" href="./pb.css">', `<style>${css}</style>`)
      .replace(/\{\{cls\}\}/g, 'app t-' + (theme || 'light'));
    fs.writeFileSync(`${OUT}/${name}.html`, h);
    const p = await b.newPage({ viewport: { width: +m[1], height: +m[2] } });
    await p.goto('file://' + path.resolve(`${OUT}/${name}.html`));
    await p.waitForTimeout(400);
    await p.screenshot({ path: `${OUT}/${name}-${theme || 'light'}.png`, fullPage: true });
    await p.close();
  }
  await b.close();
})();
