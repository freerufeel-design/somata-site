// Records per-frame motion with SomataJumpTrace on a stepped clock and saves the raw report.
// Usage: node tools/jerk-hunt.cjs <baseUrl> <outDir> <projectIndexes,comma|all> [frames] [dtMs]
// Each frame advances the clock by dtMs; a "jump" in the report is the largest per-frame
// displacement of sampled points (line contour, skeleton) or Corridor copies, in CSS px.
// tools/jerk-analyze.cjs turns the series into a list of jerks (spikes against the local motion).
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const { CHROME_PATH, CHROME_ARGS } = require('./chrome.cjs');

const [, , baseUrl, outDir, which = 'all', framesArg, dtArg] = process.argv;
const FRAMES = Number(framesArg) || 250;
const DT = Number(dtArg) || 40;
const inject = fs.readFileSync(path.join(__dirname, 'harness-inject.js'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const count = 22;
  const list = which === 'all' ? [...Array(count).keys()] : which.split(',').map(Number);
  for (const i of list) {
    // A fresh browser per project: reusing one after a heavy WebGPU page can stall navigation.
    const browser = await puppeteer.launch({
      executablePath: CHROME_PATH,
      headless: 'new',
      protocolTimeout: 1800000,
      args: [...CHROME_ARGS, '--window-size=900,600'],
    });
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 900, height: 600 });
      await page.evaluateOnNewDocument(inject);
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      const t0 = Date.now();
      await page.goto(baseUrl + '/index.html', { waitUntil: 'load', timeout: 240000 });
      await page.waitForFunction(() => window.__spiroAppBootComplete === true, { timeout: 120000 });
      await sleep(Number(process.env.BOOT_WAIT || 2000));
      await page.evaluate(async (i) => {
        const api = window.__somataDebugApi;
        await api.openDefaultPlaylist();
        await api.loadPlaylistProjectByIndex(i);
      }, i);
      await sleep(Number(process.env.LOAD_WAIT || 4000));
      if (process.env.MODE === 'green')
        // Project morph (Green): switch to the next playlist project every 4 s with a 3 s transition.
        await page.evaluate(() => {
          const api = window.__somataDebugApi;
          api.normalizeProjectMorphSettings({
            intervalSec: 4,
            syncTap: false,
            transitionSec: 3,
            transitionType: 'smooth',
          });
          api.startProjectMorphing();
        });
      // Raw per-frame recorder: wraps SomataJumpTrace.sample, which the pipeline calls once per layer frame.
      await page.evaluate(() => {
        const orig = window.SomataJumpTrace;
        const rec = (window.__motionRec = { frames: [], errors: [] });
        const pick = (paths) => {
          if (!Array.isArray(paths)) return null;
          return paths.slice(0, 96).map((p, i) => {
            const a = p?.points || [];
            const n = a.length;
            if (n < 2) return null;
            const k = Math.min(24, n);
            const pts = [];
            for (let j = 0; j < k; j++) {
              const v = a[Math.round((j * (n - 1)) / Math.max(1, k - 1))];
              pts.push([Math.round(Number(v?.x) * 100) / 100, Math.round(Number(v?.y) * 100) / 100]);
            }
            return {
              id: p.branchId ?? p.orbitId ?? p.pathId ?? p.id ?? null,
              i,
              n,
              closed: p.closed === true,
              pts,
            };
          });
        };
        // Full-resolution shape distance between consecutive frames of one layer: the largest distance
        // from any point of one frame to the polylines of the other, both ways. Path order and point
        // sampling do not matter; a shape that jumps or a branch that pops in does.
        const CELL = 8;
        const flat = (paths) => {
          if (!Array.isArray(paths)) return null;
          const segs = [],
            pts = [];
          for (const p of paths) {
            const a = p?.points || [];
            let prev = null,
              first = null;
            for (const v of a) {
              const x = Number(v?.x),
                y = Number(v?.y);
              if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
              pts.push(x, y);
              if (prev) segs.push(prev[0], prev[1], x, y);
              else first = [x, y];
              prev = [x, y];
            }
            if (p?.closed && prev && first) segs.push(prev[0], prev[1], first[0], first[1]);
            if (prev && a.length === 1) segs.push(prev[0], prev[1], prev[0], prev[1]);
          }
          const grid = new Map();
          for (let i = 0; i < segs.length; i += 4) {
            const x0 = Math.floor(Math.min(segs[i], segs[i + 2]) / CELL),
              x1 = Math.floor(Math.max(segs[i], segs[i + 2]) / CELL);
            const y0 = Math.floor(Math.min(segs[i + 1], segs[i + 3]) / CELL),
              y1 = Math.floor(Math.max(segs[i + 1], segs[i + 3]) / CELL);
            for (let gx = x0; gx <= x1; gx++)
              for (let gy = y0; gy <= y1; gy++) {
                const k = gx * 100003 + gy;
                let l = grid.get(k);
                if (!l) grid.set(k, (l = []));
                l.push(i);
              }
          }
          return { segs, pts, grid };
        };
        const near = (F, px, py) => {
          const cx = Math.floor(px / CELL),
            cy = Math.floor(py / CELL);
          let best = Infinity;
          for (let r = 0; r <= 400 && r * CELL <= best + CELL; r++) {
            for (let gx = cx - r; gx <= cx + r; gx++)
              for (let gy = cy - r; gy <= cy + r; gy++) {
                if (Math.max(Math.abs(gx - cx), Math.abs(gy - cy)) !== r) continue;
                const l = F.grid.get(gx * 100003 + gy);
                if (!l) continue;
                for (const i of l) {
                  const sg = F.segs,
                    dx = sg[i + 2] - sg[i],
                    dy = sg[i + 3] - sg[i + 1],
                    l2 = dx * dx + dy * dy;
                  let t = l2 > 0 ? ((px - sg[i]) * dx + (py - sg[i + 1]) * dy) / l2 : 0;
                  t = t < 0 ? 0 : t > 1 ? 1 : t;
                  const d = Math.hypot(px - (sg[i] + t * dx), py - (sg[i + 1] + t * dy));
                  if (d < best) best = d;
                }
              }
          }
          return best;
        };
        const shapeDistance = (A, B) => {
          if (!A || !B || !A.segs.length || !B.segs.length) return null;
          let worst = 0,
            at = null;
          for (let i = 0; i < B.pts.length; i += 2) {
            const d = near(A, B.pts[i], B.pts[i + 1]);
            if (d > worst) {
              worst = d;
              at = [Math.round(B.pts[i]), Math.round(B.pts[i + 1]), 'new'];
            }
          }
          for (let i = 0; i < A.pts.length; i += 2) {
            const d = near(B, A.pts[i], A.pts[i + 1]);
            if (d > worst) {
              worst = d;
              at = [Math.round(A.pts[i]), Math.round(A.pts[i + 1]), 'old'];
            }
          }
          return { d: Math.round(worst * 1000) / 1000, at };
        };
        const prevShapes = new Map();
        const clockOf = () => window.__somataBlueMorphPhaseClock?.();
        rec.lamps = [];
        window.SomataJumpTrace = Object.freeze({
          ...orig,
          observeLamps(f, setIndex, stats, alpha, instances, items) {
            try {
              if (Array.isArray(items) && rec.lamps.length < 400000)
                rec.lamps.push({
                  li: f?.layerIndex,
                  set: setIndex,
                  frame: f?.frameId,
                  now: performance.now(),
                  items: items
                    .slice(0, 160)
                    .map((v) => [
                      v.lampTraceId ?? null,
                      Number(v.px),
                      Number(v.py),
                      Number(v.intensityAlpha),
                      v.pathIndex ?? null,
                      v.lampAttachFraction ?? null,
                    ]),
                });
            } catch (e) {
              if (rec.errors.length < 5) rec.errors.push(String(e?.message || e));
            }
            return orig.observeLamps(f, setIndex, stats, alpha, instances, items);
          },
          sample(f) {
            try {
              if (f?.layer) {
                const clock = clockOf();
                const contour = window.SomataFrameContourService?.current?.(f);
                const copies = (f.visibleInstances?.copies || []).slice(0, 48);
                rec.frames.push({
                  li: f.layerIndex,
                  frame: f.frameId,
                  now: performance.now(),
                  phaseSerial: clock?.phaseSerial ?? null,
                  phase:
                    clock?.active && clock.durationMs > 0
                      ? (performance.now() - clock.phaseStart) / clock.durationMs
                      : null,
                  order: f.layer.spiralOrder,
                  N: f.layer.N,
                  K: f.layer.K,
                  route: f.geometryPlan?.kind ?? null,
                  lp: (() => {
                    // every primitive field of the frame layer (numbers rounded), to find what switched at a jerk
                    const o = {};
                    const add = (prefix, obj) => {
                      if (!obj || typeof obj !== 'object') return;
                      for (const [k, v] of Object.entries(obj)) {
                        if (/color|hue/i.test(k)) continue; // colours change every frame; not geometry
                        if (typeof v === 'number') o[prefix + k] = Math.round(v * 1e4) / 1e4;
                        else if (typeof v === 'string' || typeof v === 'boolean') o[prefix + k] = v;
                        else if (Array.isArray(v)) o[prefix + k + '#'] = v.length;
                      }
                    };
                    add('', f.layer);
                    add('f.', f);
                    add('gp.', f.geometryProvider);
                    add('bm.', f.blueMorphProvider);
                    add('plan.', f.geometryPlan);
                    return o;
                  })(),
                  props: (() => {
                    const l = f.layer;
                    return [
                      l.profileMode,
                      l.profileNodes?.length,
                      l.lineJoinType,
                      l.closedLoop,
                      l.spiralEnabled,
                      l.spiralClosed,
                      l.roundingMode,
                      Math.round((Number(l.rounding) || 0) * 1000) / 1000,
                      l.splineRenderMode,
                      l.wholeCurveSpline,
                      l.lineProfile?.mode ?? l.lineProfile?.type ?? null,
                      l.chaosStar,
                      l.customSuborbits,
                    ].map((v) => (v === undefined ? null : v));
                  })(),
                  ...(() => {
                    const linePaths = contour?.paths ?? f.geometryProvider?.framePaths ?? f.roundedPaths;
                    const skPaths = f.__somataSkeletonFrame ?? f.geometryProvider?.skeletonFrame;
                    const line = flat(linePaths),
                      sk = flat(skPaths);
                    const prev = prevShapes.get(f.layerIndex);
                    prevShapes.set(f.layerIndex, { line, sk });
                    return {
                      lineD: prev ? shapeDistance(prev.line, line) : null,
                      skD: prev ? shapeDistance(prev.sk, sk) : null,
                      lineCount: Array.isArray(linePaths) ? linePaths.length : null,
                      skCount: Array.isArray(skPaths) ? skPaths.length : null,
                      linePoints: line ? line.pts.length / 2 : null,
                    };
                  })(),
                  copies: copies.map((c, k) => ({
                    id: c.copyId ?? k,
                    s: c.scale,
                    a: c.angle ?? c.rotation ?? null,
                    x: c.x ?? c.tx ?? null,
                    y: c.y ?? c.ty ?? null,
                    al: f.visibleInstances?.alphas?.[k] ?? null,
                  })),
                  copyKeys: copies[0] ? Object.keys(copies[0]).slice(0, 30) : null,
                });
              }
            } catch (e) {
              if (rec.errors.length < 5) rec.errors.push(String(e?.message || e));
            }
            return orig.sample(f);
          },
        });
      });
      for (let done = 0; done < FRAMES; done += 25)
        await page.evaluate((dt) => window.__harness.step(25, dt), DT);
      const report = await page.evaluate(() => window.__motionRec);
      const meta = await page.evaluate(() => {
        const st = window.__somataDebugApi.getState();
        return {
          name: st.playlistProjects?.[
            st.playlistProjects.findIndex((p) => p.id === st.playlistCurrentProjectId)
          ]?.name,
          interval: st.morph?.intervalSec,
          layers: st.layers.length,
        };
      });
      fs.writeFileSync(
        path.join(outDir, `p${String(i).padStart(2, '0')}.json`),
        JSON.stringify({ project: i, ...meta, frames: FRAMES, dt: DT, errors, report }),
      );
      console.log(
        `p${i} ${meta.name}: ${report.frames.length} layer-frames, errors ${report.errors.length}, ${((Date.now() - t0) / 1000).toFixed(0)} s`,
      );
      await page.close();
    } catch (e) {
      console.log(`p${i} FAILED: ${e.message}`);
    }
    await browser.close().catch(() => {});
  }
})();
