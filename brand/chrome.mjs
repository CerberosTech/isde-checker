// Minimal Chrome DevTools Protocol client over --remote-debugging-pipe. No npm dependencies (Node >= 18).
// One headless Chrome renders every image; each page gets an exact viewport, so tiny sizes (32 x 32) work.
import { spawn } from 'node:child_process'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';

export const CHROME = process.env.CHROME || [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].find(p => fs.existsSync(p));

export async function launch() {
  if (!CHROME) throw new Error('Chrome not found. Set CHROME=/path/to/chrome.');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'isde-chrome-'));
  const proc = spawn(CHROME, ['--headless=new', '--remote-debugging-pipe', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
    '--no-default-browser-check', '--disable-extensions', '--mute-audio', `--user-data-dir=${profile}`, 'about:blank'],
  { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
  const input = proc.stdio[3], output = proc.stdio[4];
  const calls = new Map(), waiters = [];
  let seq = 0, buf = '';
  output.setEncoding('utf8');
  output.on('data', chunk => {
    buf += chunk;
    for (let i; (i = buf.indexOf('\0')) >= 0; buf = buf.slice(i + 1)) {
      const msg = JSON.parse(buf.slice(0, i));
      if (msg.id && calls.has(msg.id)) {
        const call = calls.get(msg.id); calls.delete(msg.id);
        if (msg.error) call.reject(new Error(`${call.method}: ${msg.error.message}`)); else call.resolve(msg.result);
      } else if (msg.method) {
        for (const w of [...waiters]) if (w.method === msg.method && w.sessionId === msg.sessionId) { waiters.splice(waiters.indexOf(w), 1); w.resolve(msg.params); }
      }
    }
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++seq; calls.set(id, { resolve, reject, method });
    input.write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
  });
  const once = (method, sessionId) => new Promise(resolve => waiters.push({ method, sessionId, resolve }));

  // Open a tab with a fixed viewport. transparent: no default white page background (for logos and icons).
  async function open(width, height, { transparent = false, mobile = false } = {}) {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    const s = (method, params) => send(method, params, sessionId);
    const size = { w: width, h: height };
    const metrics = () => s('Emulation.setDeviceMetricsOverride', { width: size.w, height: size.h, deviceScaleFactor: 1, mobile });
    await s('Page.enable'); await s('Runtime.enable'); await metrics();
    if (transparent) await s('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
    const tab = {
      async eval(expression) {
        const r = await s('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
        return r.result.value;
      },
      async goto(url) {
        const loaded = once('Page.loadEventFired', sessionId);
        await s('Page.navigate', { url }); await loaded;
        await tab.eval('document.fonts.ready.then(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))');
      },
      async resize(w, h) { size.w = w; size.h = h; await metrics(); },
      // fullPage: capture the whole document height, not only the viewport.
      async shot({ fullPage = false } = {}) {
        const h = fullPage ? Math.ceil(await tab.eval('document.documentElement.scrollHeight')) : size.h;
        const y = fullPage ? 0 : await tab.eval('window.scrollY'); // viewport shots show what is on screen now
        const { data } = await s('Page.captureScreenshot', { format: 'png', captureBeyondViewport: fullPage, clip: { x: 0, y, width: size.w, height: h, scale: 1 } });
        return Buffer.from(data, 'base64');
      },
      close: () => send('Target.closeTarget', { targetId }),
    };
    return tab;
  }
  async function close() {
    const exited = new Promise(r => proc.once('exit', r)), wait = ms => new Promise(r => setTimeout(r, ms));
    try { await Promise.race([send('Browser.close'), wait(3000)]); } catch { /* already gone */ }
    await Promise.race([exited, wait(5000)]);
    if (proc.exitCode === null && proc.signalCode === null) proc.kill();
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
  return { open, close };
}

// Width and height from a PNG header.
export const pngSize = png => [png.readUInt32BE(16), png.readUInt32BE(20)];
