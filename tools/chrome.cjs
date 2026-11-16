// Locates a Chrome/Chromium executable for the browser-based checks. Override with CHROME_PATH.
const fs = require('node:fs');
const candidates = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
].filter(Boolean);
const found = candidates.find((p) => {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
});
if (!found) throw new Error('Chrome not found; set CHROME_PATH');
// Headless Chrome cannot present WebGPU canvases; tools/harness-inject.js works around that.
const CHROME_ARGS = [
  '--no-sandbox',
  '--enable-unsafe-webgpu',
  '--enable-unsafe-swiftshader',
  '--use-angle=swiftshader',
  '--disable-gpu-watchdog',
];
module.exports = { CHROME_PATH: found, CHROME_ARGS };
