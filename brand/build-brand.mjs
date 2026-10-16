// ISDE-checker brand kit generator. No npm dependencies (Node >= 18); renders PNGs with headless Chrome.
// Writes to src/ (copied to dist/ by build.mjs): logo.svg, icon.svg, logo-512.png, apple-touch-icon.png,
// favicon.ico and og-image.png. Run from anywhere: node brand/build-brand.mjs
// Set CHROME=/path/to/chrome when Chrome or Chromium is not in a standard place.
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launch, pngSize } from './chrome.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const C = { ink: '#0F3D2E', green: '#146B4A', plate: '#FFCC00', paper: '#FFFFFF', mint: '#C9E4D6' };
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

// ---------- the mark ----------
// A heat-pump outdoor unit (box, two feet, side grille) whose fan is a disc with a check.
// 512 x 512 grid; the unit's bounding box is centred on (256, 256).
const unit = ({ body, fan, check, grille }) => [
  `<rect x="104" y="350" width="64" height="52" rx="12" fill="${body}"/>`,
  `<rect x="344" y="350" width="64" height="52" rx="12" fill="${body}"/>`,
  `<rect x="40" y="110" width="432" height="264" rx="40" fill="${body}"/>`,
  `<circle cx="196" cy="242" r="100" fill="${fan}"/>`,
  `<path d="M148 246l34 34 64-74" fill="none" stroke="${check}" stroke-width="32" stroke-linecap="round" stroke-linejoin="round"/>`,
  `<path d="M340 190h84M340 242h84M340 294h84" fill="none" stroke="${grille}" stroke-width="22" stroke-linecap="round"/>`,
].join('');
const onLight = unit({ body: C.ink, fan: C.plate, check: C.ink, grille: C.paper }); // for white/light backgrounds
const onDark = unit({ body: C.paper, fan: C.ink, check: C.plate, grille: C.ink }); // for veengroen backgrounds
const tile = (radius, scale) => `<rect width="512" height="512" rx="${radius}" fill="${C.ink}"/>` +
  `<g transform="translate(256 256) scale(${scale}) translate(-256 -256)">${onDark}</g>`;
const svg = (inner, size = 512) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="${size}" height="${size}">${inner}</svg>`;

const logoSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512" role="img" aria-label="ISDE-checker"><title>ISDE-checker</title>${onLight}</svg>\n`;
const iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512"><title>ISDE-checker</title>${tile(112, 0.94)}</svg>\n`;

// ---------- the Open Graph image (1200 x 630) ----------
const magnifier = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="${C.ink}" stroke-width="2.6"/><path d="M15.5 15.5L21 21" stroke="${C.ink}" stroke-width="2.6" stroke-linecap="round"/></svg>`;
const ogHtml = `<!doctype html><html lang="nl"><head><meta charset="utf-8"><style>
html,body{margin:0;width:1200px;height:630px;overflow:hidden}
body{box-sizing:border-box;display:flex;flex-direction:column;padding:60px 76px 64px;background:${C.ink};color:${C.paper};font-family:${FONT}}
.brand{display:flex;align-items:center;gap:18px;font-size:34px;font-weight:800;letter-spacing:-.01em}
.brand svg{width:84px;height:84px;margin:-10px 0}
h1{margin:auto 0 0;max-width:1010px;font-size:90px;line-height:1;font-weight:800;letter-spacing:-.035em}
.bar{display:flex;align-items:center;gap:20px;width:820px;height:96px;margin-top:46px;padding:0 30px;box-sizing:border-box;background:${C.paper};border-radius:18px;color:#4A5D55;font-size:34px}
.bar svg{flex:none;width:40px;height:40px}
.bar b{margin-left:auto;padding:12px 26px;border-radius:12px;background:${C.plate};border:3px solid ${C.ink};color:${C.ink};font-size:30px;font-weight:800}
p{margin:26px 0 0;font-size:28px;color:${C.mint}}
</style></head><body>
<div class="brand">${svg(onDark, 84)}ISDE-checker</div>
<h1>Staat jouw warmtepomp op de ISDE-lijst?</h1>
<div class="bar">${magnifier}<span>Zoek op merk, model of meldcode</span><b>Zoeken</b></div>
<p>Meldcode en subsidiebedrag per model. Onafhankelijk, niet verbonden aan RVO.</p>
</body></html>`;

// ---------- rendering ----------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'isde-brand-'));
const page = (w, h, body, bg = 'transparent') => `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:${w}px;height:${h}px;overflow:hidden;background:${bg}}svg{display:block;width:${w}px;height:${h}px}</style></head><body>${body}</body></html>`;
const chrome = await launch();
async function shoot(name, w, h, html) {
  const file = path.join(tmp, `${name}.html`);
  fs.writeFileSync(file, html);
  const tab = await chrome.open(w, h, { transparent: true });
  await tab.goto(pathToFileURL(file).href);
  const png = await tab.shot(); await tab.close();
  const [pw, ph] = pngSize(png);
  if (pw !== w || ph !== h) throw new Error(`${name}: rendered ${pw}x${ph}, expected ${w}x${h}`);
  return png;
}
// An ICO file that wraps one 32 x 32 PNG (supported by all current browsers).
function ico(png) {
  const head = Buffer.alloc(22);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(1, 4); // reserved, type 1 = icon, 1 image
  head.writeUInt8(32, 6); head.writeUInt8(32, 7); head.writeUInt8(0, 8); head.writeUInt8(0, 9); // width, height, palette, reserved
  head.writeUInt16LE(1, 10); head.writeUInt16LE(32, 12); // colour planes, bits per pixel
  head.writeUInt32LE(png.length, 14); head.writeUInt32LE(22, 18); // image size, image offset
  return Buffer.concat([head, png]);
}

const files = {
  'logo.svg': logoSvg,
  'icon.svg': iconSvg,
  'logo-512.png': await shoot('logo-512', 512, 512, page(512, 512, svg(onLight))),
  'apple-touch-icon.png': await shoot('apple-touch-icon', 180, 180, page(180, 180, svg(tile(0, 0.8)), C.ink)),
  'favicon.ico': ico(await shoot('favicon-32', 32, 32, page(32, 32, svg(tile(112, 0.94))))),
  'og-image.png': await shoot('og-image', 1200, 630, ogHtml),
};
await chrome.close();
for (const [name, data] of Object.entries(files)) {
  fs.writeFileSync(path.join(SRC, name), data);
  console.log(`src/${name}`.padEnd(26), `${(Buffer.byteLength(data) / 1024).toFixed(1)} kB`);
}
fs.rmSync(tmp, { recursive: true, force: true });
