// Usage: node tools/ui-shots.cjs <baseUrl> <outDir> <desktop|narrow|mobile>   (env VH = viewport height)
// Opens every sidebar mode, saves a screenshot of the sidebar and a JSON structure dump (groups, rows, overflow). Used to compare the UI before/after a layout change; run the app with npm start first.
const path = require('path');
const ROOT = path.join(__dirname, '..');
const puppeteer = require(path.join(ROOT, 'node_modules/puppeteer-core'));
const { CHROME_PATH, CHROME_ARGS } = require(path.join(ROOT, 'tools/chrome.cjs'));
const fs = require('fs');
const [, , baseUrl, outDir, kind] = process.argv;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MODES = ['shape', 'lines', 'lamps', 'web', 'sweep', 'lightning', 'particles', 'motion', 'ambient', 'prism', 'palette'];

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await puppeteer.launch({ executablePath: CHROME_PATH, args: CHROME_ARGS, headless: true });
  const page = await browser.newPage();
  const mobile = kind === 'mobile';
  const narrow = kind === 'narrow';
  await page.setViewport(
    mobile
      ? { width: 400, height: Number(process.env.VH||860), deviceScaleFactor: 1, isMobile: true, hasTouch: true }
      : { width: narrow ? 720 : 1440, height: Number(process.env.VH||1000), deviceScaleFactor: 1 },
  );
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(baseUrl + '/index.html', { waitUntil: 'load', timeout: 90000 });
  await page.waitForFunction(() => window.__spiroAppBootComplete === true, { timeout: 90000 }).catch(() => {});
  await sleep(2500);
  if (mobile || narrow) {
    // open the sidebar on mobile
    await page.evaluate(() => {
      const b = document.querySelector('#btnMobileSidebar, .mobile-sidebar-toggle, [data-mobile-sidebar]');
      if (b) b.click();
    });
    await sleep(500);
  }
  const dump = {};
  for (const mode of MODES) {
    await page.evaluate((m) => {
      const b = document.querySelector(`.sidebar-tool-btn[data-sidebar-mode="${m}"]`);
      b && b.click();
    }, mode);
    await sleep(500);
    dump[mode] = await page.evaluate(() => {
      const sb = document.querySelector('#settingsSidebar');
      const vis = (el) => {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden';
      };
      const groups = [...sb.querySelectorAll('.control-group')].filter(vis);
      return {
        sidebarWidth: sb.getBoundingClientRect().width,
        scrollW: sb.scrollWidth,
        groups: groups.map((g) => ({
          id: g.id,
          cls: g.className,
          title: (g.querySelector('.control-group-title')?.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60),
          rows: [...g.querySelectorAll(':scope > *')].filter(vis).map((r) => ({
            tag: r.tagName.toLowerCase(),
            id: r.id,
            cls: r.className && String(r.className).slice(0, 80),
            text: r.textContent.trim().replace(/\s+/g, ' ').slice(0, 70),
            h: Math.round(r.getBoundingClientRect().height),
            overflow: r.scrollWidth > r.clientWidth + 1,
          })),
        })),
      };
    });
    const sb = await page.$('#settingsSidebar');
    // full sidebar content: temporarily expand scroll container
    await page.evaluate(() => {
      const sc = document.querySelector('#settingsSidebar .sidebar-content, #settingsSidebar');
      sc.scrollTop = 0;
    });
    await sb.screenshot({ path: path.join(outDir, `${mode}.png`), captureBeyondViewport: true }).catch(() => {});
  }
  dump.__errors = errs;
  fs.writeFileSync(path.join(outDir, 'dump.json'), JSON.stringify(dump, null, 1));
  await browser.close();
})();
