// Usage: node visual.js <baseUrl> <outDir> [onlyNames,comma]
// Loads the app with the deterministic harness, opens each default.plist project,
// steps the virtual clock and saves screenshots + console logs.
const puppeteer = require('puppeteer-core');
const { CHROME_PATH } = require('./chrome.cjs');
const fs = require('fs');
const path = require('path');
const [, , baseUrl, outDir, only] = process.argv;
const inject = fs.readFileSync(path.join(__dirname, 'harness-inject.js'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PROJECTS = 22;
const STEPS = [0, 700, 1900]; // ms jumped in a single frame before each capture
const CONCURRENCY = Number(process.env.CONC || 1);

const scenarios = [{ name: 'default', project: null }];
for (let i = 0; i < PROJECTS; i++) scenarios.push({ name: 'p' + String(i).padStart(2, '0'), project: i });
const selected = only ? scenarios.filter((s) => only.split(',').includes(s.name)) : scenarios;

async function runScenario(browser, sc, summary) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1100, height: 720, deviceScaleFactor: 1 });
  await page.evaluateOnNewDocument(inject);
  const log = [];
  page.on('console', (m) => log.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => log.push(`[pageerror] ${e.message}\n${e.stack || ''}`));
  try {
    await page.goto(baseUrl + '/index.html', { waitUntil: 'load', timeout: 90000 });
    const booted = await page
      .waitForFunction(() => window.__spiroAppBootComplete === true, { timeout: 90000 })
      .then(
        () => true,
        () => false,
      );
    if (!booted) log.push('[harness] boot flag not set');
    // Real-time pauses let asynchronous GPU preparation finish; raise them on slow machines.
    await sleep(Number(process.env.BOOT_WAIT || 1500));
    if (sc.project != null) {
      const res = await page
        .evaluate(async (i) => {
          /* eslint-disable no-undef */
          const api = window.__somataDebugApi || { openDefaultPlaylist, loadPlaylistProjectByIndex };
          await api.openDefaultPlaylist();
          await api.loadPlaylistProjectByIndex(i);
          return 'ok';
        }, sc.project)
        .catch((e) => 'setup failed: ' + e.message);
      log.push('[harness] ' + res);
      await sleep(Number(process.env.LOAD_WAIT || 2500));
    }
    for (const n of STEPS) {
      if (n) {
        await page.evaluate((n) => window.__harness.step(1, n), n);
        await page.evaluate(() => window.__harness.step(2));
      }
      await sleep(600);
      await page.evaluate(() => window.__harness.flush());
      await sleep(200);
      await page.evaluate(() => window.__harness.flush());
      await sleep(100);
      const frame = await page.evaluate(() => Math.round(window.__harness.now));
      await page.screenshot({ path: path.join(outDir, `${sc.name}@t${frame}.png`) });
      const ups = await page.evaluate(() => window.__harness.uploads.filter((u) => u.n > 0).slice(-6));
      fs.writeFileSync(path.join(outDir, `${sc.name}@t${frame}.uploads.json`), JSON.stringify(ups, null, 1));
    }
    summary[sc.name] = {
      booted,
      errors: log.filter((l) => /^\[(pageerror|error)\]/.test(l) && !/favicon|404/.test(l)).length,
    };
  } catch (e) {
    summary[sc.name] = { failed: e.message };
  }
  fs.writeFileSync(path.join(outDir, `${sc.name}.log`), log.join('\n'));
  await page.close();
}

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    protocolTimeout: 300000,
    args: [
      '--no-sandbox',
      '--enable-unsafe-webgpu',
      '--enable-unsafe-swiftshader',
      '--use-angle=swiftshader',
      '--disable-gpu-watchdog',
      '--window-size=1100,720',
      '--autoplay-policy=no-user-gesture-required',
      '--force-device-scale-factor=1',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
    ],
  });
  const summary = {};
  const queue = [...selected];
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (queue.length) await runScenario(browser, queue.shift(), summary);
    }),
  );
  fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary));
  await browser.close();
})();
