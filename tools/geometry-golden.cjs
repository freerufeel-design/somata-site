// Usage: node geom-golden.js <baseUrl> <out.json>
// In-browser golden for the static geometry kernel (buildOrbitPolylines):
// a synthetic parameter grid plus every real layer of every default.plist project.
const puppeteer = require('puppeteer-core');
const { CHROME_PATH } = require('./chrome.cjs');
const fs = require('fs');
const path = require('path');
const [, , baseUrl, outFile] = process.argv;
const inject = fs.readFileSync(path.join(__dirname, 'harness-inject.js'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const pageScript = async () => {
  /* eslint-disable no-undef */
  const api = window.__somataDebugApi || {
    openDefaultPlaylist,
    loadPlaylistProjectByIndex,
    buildOrbitPolylines,
    getState: () => state,
  };
  // Order-sensitive deep hash over own enumerable data, Float64 bit-exact.
  const f64 = new Float64Array(1),
    u32 = new Uint32Array(f64.buffer);
  function deepHash(root) {
    let h = 2166136261 >>> 0;
    const mix = (x) => {
      h ^= x >>> 0;
      h = Math.imul(h, 16777619) >>> 0;
    };
    const mixStr = (s) => {
      for (let i = 0; i < s.length; i++) mix(s.charCodeAt(i));
      mix(0xfe);
    };
    const seen = new Map();
    let points = 0;
    (function walk(v, depth) {
      if (depth > 40) {
        mix(0xdead);
        return;
      }
      if (v === null) return mix(1);
      switch (typeof v) {
        case 'undefined':
          return mix(2);
        case 'boolean':
          return mix(v ? 3 : 4);
        case 'number':
          f64[0] = v;
          mix(u32[0]);
          mix(u32[1]);
          return;
        case 'string':
          return mixStr(v);
        case 'function':
          return mix(5);
        case 'object': {
          if (seen.has(v)) {
            mix(6);
            mix(seen.get(v));
            return;
          }
          seen.set(v, seen.size);
          if (ArrayBuffer.isView(v)) {
            mix(7);
            for (let i = 0; i < v.length; i++) walk(v[i], depth + 1);
            return;
          }
          if (Array.isArray(v)) {
            mix(8);
            mix(v.length);
            for (const x of v) walk(x, depth + 1);
            return;
          }
          if (v instanceof Map || v instanceof Set || v instanceof WeakMap || v instanceof WeakSet) {
            mix(9);
            return;
          }
          if ('x' in v && 'y' in v) points++;
          for (const k of Object.keys(v)) {
            mixStr(k);
            walk(v[k], depth + 1);
          }
          return;
        }
        default:
          return mix(10);
      }
    })(root, 0);
    return { h: h.toString(16), points };
  }
  // Geometry-only hash: what the figure *is*, independent of caches/counters.
  function geomHash(paths, QUANT = false) {
    let h = 2166136261 >>> 0;
    const mix = (x) => {
      h ^= x >>> 0;
      h = Math.imul(h, 16777619) >>> 0;
    };
    const num = (v) => {
      if (typeof v !== 'number') {
        mix(v === undefined ? 0xa1 : v === null ? 0xa2 : v ? 0xa3 : 0xa4);
        return;
      }
      if (QUANT) {
        const r = Math.round(v * 1e6);
        f64[0] = Object.is(r, -0) ? 0 : r;
      } else f64[0] = v;
      mix(u32[0]);
      mix(u32[1]);
    };
    const pt = (q) => {
      num(q?.x);
      num(q?.y);
    };
    if (!Array.isArray(paths)) return 'na';
    mix(paths.length);
    for (const p of paths) {
      const pts = p?.points || [];
      mix(pts.length);
      for (const q of pts) {
        pt(q);
        num(q.widthScale);
      }
      num(Boolean(p?.closed));
      num(p?.spiralBranchIndex);
      num(p?.orbitIndex);
      const segs = p?._bezierSegments || [];
      mix(segs.length);
      for (const sg of segs) {
        pt(sg.p0);
        pt(sg.c1);
        pt(sg.c2);
        pt(sg.p3);
      }
    }
    return h.toString(16);
  }
  function summarize(paths) {
    if (!Array.isArray(paths)) return { kind: typeof paths };
    return {
      paths: paths.length,
      pts: paths.reduce((s, p) => s + (p?.points?.length || 0), 0),
      first: paths[0]?.points?.slice(0, 3).map((q) => [q.x, q.y]),
    };
  }
  const results = [];
  const run = (label, layer) => {
    let out,
      err = null;
    try {
      out = api.buildOrbitPolylines(layer);
    } catch (e) {
      err = String(e && e.message);
    }
    results.push({
      label,
      err,
      ...(err ? {} : { ...deepHash(out), gh: geomHash(out), qh: geomHash(out, true), ...summarize(out) }),
    });
  };

  // ---- synthetic grid (superset of tests/spiral-reference.cjs) ----
  const profiles = [
    [
      'segments',
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ],
      0,
      false,
    ],
    [
      'segments',
      [
        { x: -0.06, y: 0.09 },
        { x: 0.35, y: 0.15 },
        { x: 1.07, y: -0.06 },
      ],
      0.4,
      false,
    ],
    [
      'segments',
      [
        { x: 0, y: 0 },
        { x: 0.3, y: -0.2 },
        { x: 0.6, y: 0.25 },
        { x: 1, y: 0 },
      ],
      0.9,
      false,
    ],
    [
      'spline',
      [
        { x: 0, y: 0 },
        { x: 0.47, y: 0.12 },
        { x: 1, y: 0 },
      ],
      0,
      false,
    ],
    [
      'spline',
      [
        { x: 0, y: 0 },
        { x: 0.47, y: 0.12 },
        { x: 1, y: 0 },
      ],
      0,
      true,
    ],
    [
      'spline',
      [
        { x: 0, y: 0 },
        { x: 0.25, y: -0.15 },
        { x: 0.7, y: 0.2 },
        { x: 1, y: 0 },
      ],
      0.5,
      false,
    ],
  ];
  const shapes = [
    [3, 1, {}],
    [4, 1, {}],
    [8, 2, {}],
    [7, 3, {}],
    [6, 3, { customSuborbits: 2 }],
    [5, 1, { spiralStepLinked: false, spiralStep: 1.3, __spiralAnimatedN: 5.2 }],
    [9, 4, { rounding: 0.6 }],
    [5, 2, { chaosStar: true, chaosSeed: 7 }],
  ];
  for (const [N, K, extra] of shapes)
    for (const spiralOrder of [0, -2, -0.4, 0.4, 1, 2.6, 3])
      for (const [spiralClosed, spiralRoundSeams] of [
        [false, false],
        [true, false],
        [true, true],
      ])
        for (const spiralTangential of [false, true, 0.3])
          for (const [profileMode, profileNodes, rounding, wholeCurveSpline] of profiles) {
            const l = {
              N,
              K,
              radius: 150,
              rotation: 23,
              closedLoop: true,
              spiralEnabled: spiralOrder !== 0,
              spiralTwist: false,
              spiralOrder,
              spiralClosed,
              spiralRoundSeams,
              spiralTangential: spiralTangential === true,
              __spiralTangentialMix: spiralTangential === 0.3 ? 0.3 : undefined,
              profileMode,
              profileNodes: profileNodes.map((p) => ({ ...p })),
              rounding,
              wholeCurveSpline,
              ...extra,
            };
            run(
              `grid N${N}K${K}${JSON.stringify(extra)} o${spiralOrder} c${spiralClosed}/${spiralRoundSeams} t${spiralTangential} ${profileMode}${profileNodes.length}/${rounding}/${wholeCurveSpline}`,
              l,
            );
          }

  // ---- real layers from every default.plist project ----
  await api.openDefaultPlaylist();
  const n = api.getState().playlistProjects.length;
  for (let i = 0; i < n; i++) {
    await api.loadPlaylistProjectByIndex(i);
    const layers = api.getState().layers;
    for (let li = 0; li < layers.length; li++) {
      run(`project${i} layer${li}`, layers[li]);
      // the same layer at other spiral orders exercises the order builder on real profiles
      for (const ord of [0, 1, 2.5, -1.5]) {
        const saved = layers[li].spiralOrder,
          savedEn = layers[li].spiralEnabled;
        layers[li].spiralOrder = ord;
        layers[li].spiralEnabled = ord !== 0;
        run(`project${i} layer${li} order${ord}`, layers[li]);
        layers[li].spiralOrder = saved;
        layers[li].spiralEnabled = savedEn;
      }
    }
  }
  return results;
};

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    protocolTimeout: 900000,
    args: [
      '--no-sandbox',
      '--enable-unsafe-webgpu',
      '--enable-unsafe-swiftshader',
      '--use-angle=swiftshader',
      '--disable-gpu-watchdog',
      '--window-size=800,600',
    ],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 800, height: 600 });
  await page.evaluateOnNewDocument(inject);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(baseUrl + '/index.html', { waitUntil: 'load', timeout: 90000 });
  await page.waitForFunction(() => window.__spiroAppBootComplete === true, { timeout: 90000 });
  await sleep(1500);
  const t0 = Date.now();
  const results = await page.evaluate(pageScript);
  fs.writeFileSync(outFile, JSON.stringify({ results, pageErrors: errors }, null, 0));
  const errs = results.filter((r) => r.err).length;
  console.log(
    `${results.length} cases (${errs} threw) in ${Date.now() - t0} ms; page errors: ${errors.length}`,
  );
  await browser.close();
})();
