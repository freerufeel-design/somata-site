// Usage: node tools/jerk-analyze.cjs <dir-with-jerk-hunt-json> [--verbose]
// Finds jerks in per-frame motion recorded by tools/jerk-hunt.cjs:
//   * line/skeleton jerk: a frame whose largest point displacement is far above the local motion
//     (> RATIO × median of the neighbouring frames and > MIN_PX);
//   * topology pop: the number of paths changes between consecutive frames;
//   * copy pop / copy jerk: a Corridor copy's opacity or scale changes abruptly.
const fs = require('fs');
const path = require('path');

const dir = process.argv[2];
const verbose = process.argv.includes('--verbose');
const RATIO = 4;
const MIN_PX = 6;

const median = (a) => {
  const s = a.filter(Number.isFinite).sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

// Shape distance between two frames, independent of path order and point sampling:
// the largest distance from a point of one frame to the polylines of the other (both ways).
function segmentsOf(paths) {
  const segs = [];
  for (const p of paths || []) {
    if (!p || !p.pts || p.pts.length < 1) continue;
    const a = p.pts;
    if (a.length === 1) segs.push([a[0][0], a[0][1], a[0][0], a[0][1]]);
    for (let i = 1; i < a.length; i++) segs.push([a[i - 1][0], a[i - 1][1], a[i][0], a[i][1]]);
    if (p.closed && a.length > 2) segs.push([a[a.length - 1][0], a[a.length - 1][1], a[0][0], a[0][1]]);
  }
  return segs.filter((g) => g.every(Number.isFinite));
}
const CELL = 12;
function gridOf(segs) {
  const g = new Map();
  for (const sg of segs) {
    const x0 = Math.floor(Math.min(sg[0], sg[2]) / CELL),
      x1 = Math.floor(Math.max(sg[0], sg[2]) / CELL);
    const y0 = Math.floor(Math.min(sg[1], sg[3]) / CELL),
      y1 = Math.floor(Math.max(sg[1], sg[3]) / CELL);
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++) {
        const k = (x * 73856093) ^ (y * 19349663);
        if (!g.has(k)) g.set(k, []);
        g.get(k).push(sg);
      }
  }
  return g;
}
function segDist(px, py, s) {
  const dx = s[2] - s[0],
    dy = s[3] - s[1],
    l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - s[0]) * dx + (py - s[1]) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (s[0] + t * dx), py - (s[1] + t * dy));
}
function nearest(grid, px, py, cap = 2000) {
  const cx = Math.floor(px / CELL),
    cy = Math.floor(py / CELL);
  let best = Infinity;
  for (let r = 0; r * CELL <= Math.min(best, cap) + CELL; r++) {
    for (let x = cx - r; x <= cx + r; x++)
      for (let y = cy - r; y <= cy + r; y++) {
        if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) !== r) continue;
        const list = grid.get((x * 73856093) ^ (y * 19349663));
        if (list) for (const sg of list) best = Math.min(best, segDist(px, py, sg));
      }
    if (r > 200) break;
  }
  return Math.min(best, cap);
}
function shapeDistance(prevPaths, curPaths) {
  const A = segmentsOf(prevPaths),
    B = segmentsOf(curPaths);
  if (!A.length || !B.length) return null;
  const gA = gridOf(A),
    gB = gridOf(B);
  let worst = 0;
  for (const p of curPaths || [])
    for (const q of p?.pts || []) worst = Math.max(worst, nearest(gA, q[0], q[1]));
  for (const p of prevPaths || [])
    for (const q of p?.pts || []) worst = Math.max(worst, nearest(gB, q[0], q[1]));
  return worst;
}

function pathDisplacement(prev, cur) {
  if (!prev || !cur) return null;
  const byId = (list) => {
    const m = new Map();
    const ids = list.filter(Boolean).map((p) => p.id);
    const unique = ids.every((id) => id != null) && new Set(ids).size === ids.length;
    for (const p of list) if (p) m.set(unique ? `id:${p.id}` : `slot:${p.i}`, p);
    return m;
  };
  const a = byId(prev),
    b = byId(cur);
  let worst = 0,
    worstKey = null;
  for (const [k, q] of b) {
    const p = a.get(k);
    if (!p || p.closed !== q.closed) continue;
    for (let i = 0; i < q.pts.length; i++) {
      const d = Math.hypot(q.pts[i][0] - p.pts[i][0], q.pts[i][1] - p.pts[i][1]);
      if (Number.isFinite(d) && d > worst) {
        worst = d;
        worstKey = k;
      }
    }
  }
  return { d: worst, key: worstKey };
}
function analyze(file) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const frames = data.report.frames;
  const byLayer = new Map();
  for (const f of frames) {
    if (!byLayer.has(f.li)) byLayer.set(f.li, []);
    byLayer.get(f.li).push(f);
  }
  const findings = [];
  for (const [li, list] of byLayer) {
    list.sort((x, y) => x.frame - y.frame);
    for (const kind of ['line', 'sk']) {
      const key = kind === 'line' ? 'lineD' : 'skD';
      const series = list.map((f) => (f[key] ? { d: f[key].d, key: f[key].at } : null));
      const d = series.map((s) => (s ? s.d : NaN));
      for (let t = 1; t < list.length; t++) {
        const f = list[t],
          g = list[t - 1];
        const np = f[kind + 'Count'] ?? 0,
          pp = g[kind + 'Count'] ?? 0;
        if (f[kind + 'Count'] != null && g[kind + 'Count'] != null && np !== pp)
          findings.push({
            li,
            t,
            kind: `${kind}-topology`,
            from: pp,
            to: np,
            phase: f.phase,
            serial: f.phaseSerial,
            order: [g.order, f.order],
            NK: [g.N, g.K, f.N, f.K],
            route: [g.route, f.route],
          });
        if (!Number.isFinite(d[t])) continue;
        const around = [];
        for (let k = Math.max(1, t - 6); k <= Math.min(d.length - 1, t + 6); k++)
          if (k !== t) around.push(d[k]);
        const m = median(around);
        if (d[t] > MIN_PX && d[t] > RATIO * Math.max(m, 0.25)) {
          const names = [
            'profileMode',
            'profileNodes',
            'lineJoinType',
            'closedLoop',
            'spiralEnabled',
            'spiralClosed',
            'roundingMode',
            'rounding',
            'splineRenderMode',
            'wholeCurveSpline',
            'lineProfile',
            'chaosStar',
            'customSuborbits',
          ];
          const changed = (f.props || [])
            .map((v, k) =>
              JSON.stringify(v) !== JSON.stringify(g.props?.[k])
                ? `${names[k]}:${JSON.stringify(g.props?.[k])}->${JSON.stringify(v)}`
                : null,
            )
            .filter(Boolean);
          // layer fields that jumped at this frame (change far above their own neighbourhood)
          const fieldJumps = [];
          for (const k of Object.keys(f.lp || {})) {
            const v1 = f.lp[k],
              v0 = g.lp?.[k];
            if (typeof v1 !== 'number' || typeof v0 !== 'number') {
              if (v1 !== v0) fieldJumps.push(`${k}:${JSON.stringify(v0)}->${JSON.stringify(v1)}`);
              continue;
            }
            const dv = Math.abs(v1 - v0);
            if (dv < 1e-6) continue;
            const ar = [];
            for (let q = Math.max(1, t - 6); q <= Math.min(list.length - 1, t + 6); q++)
              if (q !== t && typeof list[q].lp?.[k] === 'number' && typeof list[q - 1].lp?.[k] === 'number')
                ar.push(Math.abs(list[q].lp[k] - list[q - 1].lp[k]));
            const mm = median(ar);
            if (dv > 3 * Math.max(mm, 1e-4)) fieldJumps.push(`${k}:${v0}->${v1}`);
          }
          findings.push({
            fieldJumps,
            changed,
            li,
            t,
            kind: `${kind}-jerk`,
            px: +d[t].toFixed(2),
            localMedian: +m.toFixed(2),
            path: series[t].key,
            phase: f.phase,
            serial: f.phaseSerial,
            serialBefore: g.phaseSerial,
            order: [g.order, f.order],
            NK: [g.N, g.K, f.N, f.K],
            route: [g.route, f.route],
          });
        }
      }
    }
    // Corridor copies: per-frame worst opacity and scale change, flagged when far above the local motion.
    const alphaD = [NaN],
      scaleD = [NaN],
      who = [null];
    for (let t = 1; t < list.length; t++) {
      const f = list[t],
        g = list[t - 1];
      const prev = new Map((g.copies || []).map((c) => [c.id, c]));
      let worstA = 0,
        worstS = 0,
        wa = null,
        ws = null;
      for (const c of f.copies || []) {
        const p = prev.get(c.id);
        if (!p) continue;
        const da = Math.abs((c.al ?? 1) - (p.al ?? 1));
        if (da > worstA) {
          worstA = da;
          wa = c.id;
        }
        const ds = p.s > 0 && c.s > 0 ? Math.abs(Math.log(c.s / p.s)) : 0;
        if (ds > worstS) {
          worstS = ds;
          ws = c.id;
        }
      }
      alphaD.push(worstA);
      scaleD.push(worstS);
      who.push([wa, ws]);
    }
    for (let t = 1; t < list.length; t++) {
      const around = (arr) => {
        const v = [];
        for (let k = Math.max(1, t - 6); k <= Math.min(arr.length - 1, t + 6); k++)
          if (k !== t) v.push(arr[k]);
        return median(v);
      };
      const f = list[t];
      const ma = around(alphaD),
        ms = around(scaleD);
      if (alphaD[t] > 0.3 && alphaD[t] > RATIO * Math.max(ma, 0.02))
        findings.push({
          li,
          t,
          kind: 'copy-alpha-pop',
          delta: +alphaD[t].toFixed(2),
          localMedian: +ma.toFixed(3),
          copy: who[t][0],
          phase: f.phase,
          serial: f.phaseSerial,
        });
      if (scaleD[t] > 0.05 && scaleD[t] > RATIO * Math.max(ms, 0.005))
        findings.push({
          li,
          t,
          kind: 'copy-scale-jerk',
          logDelta: +scaleD[t].toFixed(3),
          localMedian: +ms.toFixed(4),
          copy: who[t][1],
          phase: f.phase,
          serial: f.phaseSerial,
        });
    }
  }
  // Lamps: position teleports (spikes against local motion) and brightness pops.
  const lampRecs = data.report.lamps || [];
  const bySet = new Map();
  for (const r of lampRecs) {
    const k = `${r.li}:${r.set}`;
    if (!bySet.has(k)) bySet.set(k, []);
    bySet.get(k).push(r);
  }
  for (const [k, list] of bySet) {
    list.sort((x, y) => x.frame - y.frame);
    const moves = [NaN],
      pops = [0],
      who = [null];
    for (let t = 1; t < list.length; t++) {
      const prev = new Map(list[t - 1].items.map((v) => [v[0], v]));
      let worst = 0,
        w = null,
        pop = 0;
      for (const v of list[t].items) {
        const p = prev.get(v[0]);
        if (!p) {
          if (v[3] > 0.5) pop = Math.max(pop, v[3]);
          continue;
        } // appears already bright
        const d = Math.hypot(v[1] - p[1], v[2] - p[2]);
        if (Number.isFinite(d) && Math.min(v[3], p[3]) > 0.15 && d > worst) {
          worst = d;
          w = v[0];
        }
        pop = Math.max(pop, Math.abs(v[3] - p[3]));
      }
      const cur = new Set(list[t].items.map((v) => v[0]));
      for (const p of list[t - 1].items) if (!cur.has(p[0]) && p[3] > 0.5) pop = Math.max(pop, p[3]); // vanishes while bright
      moves.push(worst);
      pops.push(pop);
      who.push(w);
    }
    for (let t = 1; t < list.length; t++) {
      const around = [];
      for (let q = Math.max(1, t - 6); q <= Math.min(moves.length - 1, t + 6); q++)
        if (q !== t) around.push(moves[q]);
      const m = median(around);
      if (moves[t] > MIN_PX && moves[t] > RATIO * Math.max(m, 0.25))
        findings.push({
          li: list[t].li,
          set: list[t].set,
          t,
          kind: 'lamp-teleport',
          px: +moves[t].toFixed(2),
          localMedian: +m.toFixed(2),
          lamp: who[t],
        });
      if (pops[t] > 0.4)
        findings.push({ li: list[t].li, set: list[t].set, t, kind: 'lamp-pop', delta: +pops[t].toFixed(2) });
    }
  }
  return { name: data.name, interval: data.interval, frames: frames.length, findings };
}

const files = fs
  .readdirSync(dir)
  .filter((f) => /^p\d+\.json$/.test(f))
  .sort();
const total = {};
for (const f of files) {
  const r = analyze(path.join(dir, f));
  const counts = {};
  for (const x of r.findings) counts[x.kind] = (counts[x.kind] || 0) + 1;
  for (const [k, v] of Object.entries(counts)) total[k] = (total[k] || 0) + v;
  console.log(
    `${f} ${r.name} (interval ${r.interval}s, ${r.frames} layer-frames): ${JSON.stringify(counts)}`,
  );
  if (verbose) for (const x of r.findings.slice(0, 40)) console.log('   ', JSON.stringify(x));
}
console.log('TOTAL', JSON.stringify(total));
