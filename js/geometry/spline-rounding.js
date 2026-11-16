// Сплайн-скругление: сглаживание узлов, кубики, локальные участки сплайна на рёбрах, скругления изломов, путь сплайна.
import './fourier.js'; // initialisation order: this module runs after it
import { state } from '../core/state.js';
import { blendMorphFilletPaths } from './morph.js';
import { somataDrawSplineCornerMode } from './spline-corner-mode.js';
import { centripetalSplineBezierControls } from './spline.js';
import { drawUnifiedFilletPath } from './unified-fillet.js';
import { buildFourierWavePoints } from './fourier.js';

const smoothSplineRoundWorkspace = {
  px: new Float64Array(256),
  py: new Float64Array(256),
  pix: new Float64Array(256),
  piy: new Float64Array(256),
  a: [],
  b: [],
};
function smoothSplineKnotsTriangular(points, closed, h, out) {
  const n = points.length;
  if (h <= 0) {
    while (out.length < n) out.push({ x: 0, y: 0 });
    out.length = n;
    for (let i = 0; i < n; i++) {
      const p = points[i];
      out[i].x = Number(p.x) || 0;
      out[i].y = Number(p.y) || 0;
      if (Number.isFinite(Number(p.widthScale))) out[i].widthScale = Number(p.widthScale);
      else delete out[i].widthScale;
    }
    return out;
  }
  h = Math.max(1, Math.floor(h));
  const extLen = n + h * 2,
    need = extLen + 1,
    ws = smoothSplineRoundWorkspace;
  if (ws.px.length < need) {
    const cap = Math.max(need, ws.px.length * 2);
    ws.px = new Float64Array(cap);
    ws.py = new Float64Array(cap);
    ws.pix = new Float64Array(cap);
    ws.piy = new Float64Array(cap);
  }
  const px = ws.px,
    py = ws.py,
    pix = ws.pix,
    piy = ws.piy;
  px[0] = py[0] = pix[0] = piy[0] = 0;
  for (let j = 0; j < extLen; j++) {
    const rawIdx = j - h,
      idx = closed ? ((rawIdx % n) + n) % n : Math.max(0, Math.min(n - 1, rawIdx)),
      p = points[idx],
      jj = j + 1;
    const x = Number(p.x) || 0,
      y = Number(p.y) || 0;
    px[jj] = px[j] + x;
    py[jj] = py[j] + y;
    pix[jj] = pix[j] + j * x;
    piy[jj] = piy[j] + j * y;
  }
  const range = (pref, a, b) => pref[b + 1] - pref[a],
    weightSum = (h + 1) * (h + 1);
  while (out.length < n) out.push({ x: 0, y: 0 });
  out.length = n;
  for (let i = 0; i < n; i++) {
    const c = i + h,
      la = c - h,
      lb = c,
      ra = c + 1,
      rb = c + h;
    const lsumX = range(px, la, lb),
      lsumY = range(py, la, lb),
      lidxX = range(pix, la, lb),
      lidxY = range(piy, la, lb);
    let sx = lidxX - (la - 1) * lsumX,
      sy = lidxY - (la - 1) * lsumY;
    if (ra <= rb) {
      const rsumX = range(px, ra, rb),
        rsumY = range(py, ra, rb),
        ridxX = range(pix, ra, rb),
        ridxY = range(piy, ra, rb);
      sx += (rb + 1) * rsumX - ridxX;
      sy += (rb + 1) * rsumY - ridxY;
    }
    const q = out[i];
    q.x = sx / weightSum;
    q.y = sy / weightSum;
    if (Number.isFinite(Number(points[i].widthScale))) q.widthScale = Number(points[i].widthScale);
    else delete q.widthScale;
  }

  if (!closed && n > 1) {
    out[0].x = Number(points[0].x) || 0;
    out[0].y = Number(points[0].y) || 0;
    out[n - 1].x = Number(points[n - 1].x) || 0;
    out[n - 1].y = Number(points[n - 1].y) || 0;
  }
  return out;
}
function estimateSplineConstructionSpan(pointCount, cornerFlags, closed = false) {
  const n = Math.max(0, Math.floor(Number(pointCount) || 0));
  if (n < 3 || !Array.isArray(cornerFlags) || cornerFlags.length !== n) return 0;
  const marked = [];
  for (let i = 0; i < n; i++) if (cornerFlags[i] === true) marked.push(i);
  if (marked.length < 2) return 0;
  const spans = [];
  for (let k = 1; k < marked.length; k++) {
    const d = marked[k] - marked[k - 1];

    if (d > 1) spans.push(d);
  }
  if (closed) {
    const d = marked[0] + n - marked[marked.length - 1];
    if (d > 1) spans.push(d);
  }
  if (!spans.length) return 0;
  spans.sort((a, b) => a - b);
  const mid = spans.length >> 1;
  return spans.length & 1 ? spans[mid] : (spans[mid - 1] + spans[mid]) * 0.5;
}
function transformSplineKnotsForRounding(rawPoints, closed = false, roundingFrac = 0, cornerFlags = []) {
  const pts = (rawPoints || []).filter(
    (p) => p && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y)),
  );
  const amount = Math.max(0, Math.min(2, Number(roundingFrac) || 0));
  if (pts.length < 3 || amount <= 0) return pts;
  const n = pts.length,
    ws = smoothSplineRoundWorkspace;

  const constructionSpan = estimateSplineConstructionSpan(n, cornerFlags, Boolean(closed));
  const fullRadius = Math.max(1, constructionSpan > 0 ? constructionSpan * 1.2 : (4.5 * n) / 16);
  const radius = fullRadius * amount;
  const h0 = Math.floor(radius),
    h1 = Math.ceil(radius),
    radiusMix = radius - h0;
  const a = smoothSplineKnotsTriangular(pts, Boolean(closed), h0, ws.a);
  let target = a;
  if (h1 !== h0 && radiusMix > 1e-9) {
    const b = smoothSplineKnotsTriangular(pts, Boolean(closed), h1, ws.b);
    target = ws.target || (ws.target = []);
    while (target.length < n) target.push({ x: 0, y: 0 });
    target.length = n;
    for (let i = 0; i < n; i++) {
      target[i].x = a[i].x + (b[i].x - a[i].x) * radiusMix;
      target[i].y = a[i].y + (b[i].y - a[i].y) * radiusMix;
      if (Number.isFinite(Number(pts[i].widthScale))) target[i].widthScale = Number(pts[i].widthScale);
      else delete target[i].widthScale;
    }
  }

  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    out[i] = { ...p, x: Number(target[i].x) || 0, y: Number(target[i].y) || 0 };
  }

  if (!closed && n > 1) {
    out[0] = { ...pts[0] };
    out[n - 1] = { ...pts[n - 1] };
  }
  return out;
}
function splineCubicPoint(seg, t) {
  const u = Math.max(0, Math.min(1, Number(t) || 0)),
    v = 1 - u;
  return {
    x: v * v * v * seg.p0.x + 3 * v * v * u * seg.c1.x + 3 * v * u * u * seg.c2.x + u * u * u * seg.p3.x,
    y: v * v * v * seg.p0.y + 3 * v * v * u * seg.c1.y + 3 * v * u * u * seg.c2.y + u * u * u * seg.p3.y,
  };
}
function splineCubicDerivative(seg, t) {
  const u = Math.max(0, Math.min(1, Number(t) || 0)),
    v = 1 - u;
  return {
    x:
      3 * v * v * (seg.c1.x - seg.p0.x) +
      6 * v * u * (seg.c2.x - seg.c1.x) +
      3 * u * u * (seg.p3.x - seg.c2.x),
    y:
      3 * v * v * (seg.c1.y - seg.p0.y) +
      6 * v * u * (seg.c2.y - seg.c1.y) +
      3 * u * u * (seg.p3.y - seg.c2.y),
  };
}
function splitSplineCubic(seg, t) {
  const u = Math.max(0, Math.min(1, Number(t) || 0));
  const lerp = (a, b) => ({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u });
  const a = lerp(seg.p0, seg.c1),
    b = lerp(seg.c1, seg.c2),
    c = lerp(seg.c2, seg.p3);
  const d = lerp(a, b),
    e = lerp(b, c),
    m = lerp(d, e);
  return {
    left: { p0: seg.p0, c1: a, c2: d, p3: m },
    right: { p0: m, c1: e, c2: c, p3: seg.p3 },
  };
}
function subSplineCubic(seg, t0, t1) {
  let a = Math.max(0, Math.min(1, Number(t0) || 0));
  let b = Math.max(0, Math.min(1, Number(t1) || 0));
  if (b < a) {
    const q = a;
    a = b;
    b = q;
  }
  if (a <= 1e-9 && b >= 1 - 1e-9) return seg;
  if (b <= a + 1e-9) {
    const p = splineCubicPoint(seg, a);
    return { p0: p, c1: p, c2: p, p3: p };
  }
  let left = seg;
  if (b < 1 - 1e-9) left = splitSplineCubic(seg, b).left;
  if (a <= 1e-9) return left;
  const rel = a / Math.max(1e-9, b);
  return splitSplineCubic(left, rel).right;
}
function buildEdgeLocalSplineRun(runPoints, splineBlend = 1) {
  const pts = Array.isArray(runPoints) ? runPoints : [];
  const shapeBlend = Math.max(0, Math.min(1, Number(splineBlend) || 0));
  const cubics = [];
  const cumulative = [0];
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const p1 = pts[i],
      p2 = pts[i + 1];
    let c1, c2;
    if (pts.length === 2) {
      c1 = { x: p1.x + (p2.x - p1.x) / 3, y: p1.y + (p2.y - p1.y) / 3 };
      c2 = { x: p1.x + (2 * (p2.x - p1.x)) / 3, y: p1.y + (2 * (p2.y - p1.y)) / 3 };
    } else {
      const p0 = i > 0 ? pts[i - 1] : { x: 2 * p1.x - p2.x, y: 2 * p1.y - p2.y };
      const p3 = i + 2 < pts.length ? pts[i + 2] : { x: 2 * p2.x - p1.x, y: 2 * p2.y - p1.y };
      const ctrl = centripetalSplineBezierControls(p0, p1, p2, p3, 0.5);
      // During a Segments↔Spline Morph the control handles are
      // interpolated; authored endpoints and anchor motion stay put.
      const line1 = { x: p1.x + (p2.x - p1.x) / 3, y: p1.y + (p2.y - p1.y) / 3 };
      const line2 = { x: p1.x + (2 * (p2.x - p1.x)) / 3, y: p1.y + (2 * (p2.y - p1.y)) / 3 };
      c1 = {
        x: line1.x + (ctrl.c1.x - line1.x) * shapeBlend,
        y: line1.y + (ctrl.c1.y - line1.y) * shapeBlend,
      };
      c2 = {
        x: line2.x + (ctrl.c2.x - line2.x) * shapeBlend,
        y: line2.y + (ctrl.c2.y - line2.y) * shapeBlend,
      };
    }
    cubics.push({ p0: p1, c1, c2, p3: p2 });

    // Measure the actual cubic arc, not just its endpoint chord.
    // A deeply curved profile can be much longer than its chord;
    // rounding is a physical distance along the visible profile.
    const arc = [0];
    let last = p1,
      arcLength = 0;
    for (let sample = 1; sample <= 16; sample++) {
      const q = splineCubicPoint(cubics[cubics.length - 1], sample / 16);
      arcLength += Math.hypot(q.x - last.x, q.y - last.y);
      arc.push(arcLength);
      last = q;
    }
    cubics[cubics.length - 1].arcLengths = arc;
    total += arcLength;
    cumulative.push(total);
  }
  return { points: pts, cubics, cumulative, total, trimStart: 0, trimEnd: 0 };
}
function locateOnEdgeLocalSplineRun(run, distance) {
  const total = Math.max(0, Number(run?.total) || 0);
  const d = Math.max(0, Math.min(total, Number(distance) || 0));
  const cubics = run?.cubics || [],
    cum = run?.cumulative || [0];
  if (!cubics.length) {
    const p = run?.points?.[0] || { x: 0, y: 0 };
    return { segIndex: 0, t: 0, point: { x: p.x, y: p.y }, tangent: { x: 1, y: 0 } };
  }
  let i = 0;
  while (i < cubics.length - 1 && d > cum[i + 1]) i++;
  const span = Math.max(1e-9, cum[i + 1] - cum[i]);
  const segmentDistance = Math.max(0, Math.min(span, d - cum[i]));
  const arc = cubics[i].arcLengths;
  let t = segmentDistance / span;
  if (arc && arc.length > 1) {
    let j = 1;
    while (j < arc.length - 1 && segmentDistance > arc[j]) j++;
    const local = Math.max(
      0,
      Math.min(1, (segmentDistance - arc[j - 1]) / Math.max(1e-9, arc[j] - arc[j - 1])),
    );
    t = (j - 1 + local) / (arc.length - 1);
  }
  let tangent = splineCubicDerivative(cubics[i], t);
  if (Math.hypot(tangent.x, tangent.y) < 1e-8) {
    tangent = { x: cubics[i].p3.x - cubics[i].p0.x, y: cubics[i].p3.y - cubics[i].p0.y };
  }
  return { segIndex: i, t, point: splineCubicPoint(cubics[i], t), tangent };
}
function appendTrimmedEdgeLocalSplineRun(ctx, run, startLoc, endLoc) {
  const cubics = run?.cubics || [];
  if (!cubics.length) return;
  if (
    endLoc.segIndex < startLoc.segIndex ||
    (endLoc.segIndex === startLoc.segIndex && endLoc.t <= startLoc.t + 1e-9)
  )
    return;
  for (let i = startLoc.segIndex; i <= endLoc.segIndex; i++) {
    const t0 = i === startLoc.segIndex ? startLoc.t : 0;
    const t1 = i === endLoc.segIndex ? endLoc.t : 1;
    if (t1 <= t0 + 1e-9) continue;
    const seg = subSplineCubic(cubics[i], t0, t1);
    ctx.bezierCurveTo(seg.c1.x, seg.c1.y, seg.c2.x, seg.c2.y, seg.p3.x, seg.p3.y);
  }
}
function collectEdgeLocalSplineRuns(points, closed, flags, splineBlend = 1) {
  const n = points.length;
  if (n < 2) return [];
  if (!closed) {
    const cuts = [0];
    for (let i = 1; i < n - 1; i++) if (flags?.[i] === true) cuts.push(i);
    cuts.push(n - 1);
    const uniq = [...new Set(cuts)].sort((a, b) => a - b),
      runs = [];
    for (let k = 0; k < uniq.length - 1; k++) {
      const a = uniq[k],
        b = uniq[k + 1];
      if (b <= a) continue;
      runs.push({
        startBoundary: a,
        endBoundary: b,
        ...buildEdgeLocalSplineRun(points.slice(a, b + 1), splineBlend),
      });
    }
    return runs;
  }
  const boundaries = [];
  for (let i = 0; i < n; i++) if (flags?.[i] === true) boundaries.push(i);
  if (boundaries.length < 2) return [];
  const runs = [];
  for (let k = 0; k < boundaries.length; k++) {
    const a = boundaries[k],
      b = boundaries[(k + 1) % boundaries.length];
    const rp = [points[a]];
    let i = a,
      guard = 0;
    while (i !== b && guard++ <= n) {
      i = (i + 1) % n;
      rp.push(points[i]);
    }
    if (rp.length >= 2)
      runs.push({ startBoundary: a, endBoundary: b, ...buildEdgeLocalSplineRun(rp, splineBlend) });
  }
  return runs;
}
// The same bounded fillet is used by Static and by every Morph frame.
// A cubic whose control handles escape the triangle between the trimmed
// shoulders and the authored corner can turn back and draw a little
// exterior "ear".  The old Static vs Morph tangent policies also made
// the shape jump at phase boundaries.  Keep motion and corner anchors
// untouched; constrain ONLY the displayed joining cubic.
function appendLocalSplineFillet(ctx, fromLoc, toLoc, cutDistance, liveSeamMix = 0, corner = null) {
  const a = fromLoc.point,
    b = toLoc.point;
  const dx = b.x - a.x,
    dy = b.y - a.y,
    d = Math.hypot(dx, dy);
  if (d <= 1e-8) {
    ctx.lineTo(b.x, b.y);
    return;
  }
  const v =
    corner && Number.isFinite(corner.x) && Number.isFinite(corner.y)
      ? corner
      : { x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5 };
  const area = (b.x - a.x) * (v.y - a.y) - (b.y - a.y) * (v.x - a.x);
  // At a degenerate corner there is no area in which to construct
  // a round; do not invent a lateral offset or a hairpin loop.
  if (Math.abs(area) < 1e-8 * d * d) {
    ctx.lineTo(b.x, b.y);
    return;
  }
  const inTriangle = (p) => {
    const ab = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    const bv = (v.x - b.x) * (p.y - b.y) - (v.y - b.y) * (p.x - b.x);
    const va = (a.x - v.x) * (p.y - v.y) - (a.y - v.y) * (p.x - v.x);
    const sign = area > 0 ? 1 : -1;
    return ab * sign >= -1e-8 && bv * sign >= -1e-8 && va * sign >= -1e-8;
  };
  const projectOntoTriangle = (p) => {
    if (inTriangle(p)) return p;
    // Orthogonal projection onto a convex triangle is continuous
    // as animated tangents cross its boundary. A hard switch to
    // a different handle direction used to produce tiny pops.
    let nearest = null,
      best = Infinity;
    for (const [start, end] of [
      [a, b],
      [b, v],
      [v, a],
    ]) {
      const dx = end.x - start.x,
        dy = end.y - start.y;
      const denom = dx * dx + dy * dy;
      const t =
        denom > 1e-12 ? Math.max(0, Math.min(1, ((p.x - start.x) * dx + (p.y - start.y) * dy) / denom)) : 0;
      const q = { x: start.x + dx * t, y: start.y + dy * t };
      const dist = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
      if (dist < best) {
        best = dist;
        nearest = q;
      }
    }
    return nearest || p;
  };
  const safeControl = (at, tangent, backward) => {
    const cx = v.x - at.x,
      cy = v.y - at.y,
      dist = Math.hypot(cx, cy);
    const maxHandle = Math.min(dist * 0.46, d * 0.38, Math.max(0, Number(cutDistance) || 0) * 0.75);
    // Keep a small positive handle pointed into the wedge even
    // when the incoming cubic tangent points straight backward.
    const fallback = { x: at.x + cx * 0.28, y: at.y + cy * 0.28 };
    const tx = (Number(tangent?.x) || 0) * (backward ? -1 : 1);
    const ty = (Number(tangent?.y) || 0) * (backward ? -1 : 1);
    const len = Math.hypot(tx, ty);
    if (len < 1e-9 || maxHandle < 1e-9) return fallback;
    const p = { x: at.x + (tx / len) * maxHandle, y: at.y + (ty / len) * maxHandle };
    const q = projectOntoTriangle(p);
    // This small continuous bias prevents zero-length Bézier
    // derivatives when a wildly reversed tangent clips to a.
    return { x: q.x * 0.96 + fallback.x * 0.04, y: q.y * 0.96 + fallback.y * 0.04 };
  };
  const c1 = safeControl(a, fromLoc.tangent, false);
  const c2 = safeControl(b, toLoc.tangent, true);
  ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, b.x, b.y);
}
function drawWholeCentripetalSpline(ctx, points, closed, splineBlend = 1) {
  const pts = points || [],
    n = pts.length;
  if (n < 2) return;
  if (n === 2) {
    ctx.moveTo(pts[0].x, pts[0].y);
    ctx.lineTo(pts[1].x, pts[1].y);
    if (closed) ctx.closePath();
    return;
  }
  ctx.moveTo(pts[0].x, pts[0].y);
  const count = closed ? n : n - 1;
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % n,
      p1 = pts[i],
      p2 = pts[j];
    const p0 = closed
      ? pts[(i - 1 + n) % n]
      : i > 0
        ? pts[i - 1]
        : { x: 2 * p1.x - p2.x, y: 2 * p1.y - p2.y };
    const p3 = closed
      ? pts[(j + 1) % n]
      : j + 1 < n
        ? pts[j + 1]
        : { x: 2 * p2.x - p1.x, y: 2 * p2.y - p1.y };
    const c = centripetalSplineBezierControls(p0, p1, p2, p3, 0.5);
    // Use the same cubic rail at every point of a Segments↔Spline
    // transition.  Without blending the whole-curve fallback, a
    // closed profile with fewer than two logical corners snapped
    // directly to its final Spline shape at the first Morph frame.
    const b = Math.max(0, Math.min(1, Number(splineBlend) || 0));
    const a1x = p1.x + (p2.x - p1.x) / 3,
      a1y = p1.y + (p2.y - p1.y) / 3;
    const a2x = p1.x + (2 * (p2.x - p1.x)) / 3,
      a2y = p1.y + (2 * (p2.y - p1.y)) / 3;
    ctx.bezierCurveTo(
      a1x + (c.c1.x - a1x) * b,
      a1y + (c.c1.y - a1y) * b,
      a2x + (c.c2.x - a2x) * b,
      a2y + (c.c2.y - a2y) * b,
      p2.x,
      p2.y,
    );
  }
  if (closed) ctx.closePath();
}
// A near-reversal is not a roundable polygon corner: the two rails
// return along each other.  Large fillets there make an exterior hook
// (most visible for N=6/K=3: two-point, closed suborbits).  Attenuate
// only turns above 135 degrees, continuously to zero at 180 degrees.
// This is a *display* constraint. Never change the authored points or
// the Morph transport / circle / topology interpolation itself.
function highTurnRoundingFactor(incoming, outgoing) {
  const ax = Number(incoming?.x) || 0,
    ay = Number(incoming?.y) || 0;
  const bx = Number(outgoing?.x) || 0,
    by = Number(outgoing?.y) || 0;
  const al = Math.hypot(ax, ay),
    bl = Math.hypot(bx, by);
  if (al < 1e-9 || bl < 1e-9) return 1;
  const cos = Math.max(-1, Math.min(1, (ax * bx + ay * by) / (al * bl)));
  // 135deg -> 1, 180deg -> 0; squared for a gentle hairpin fade.
  const u = Math.max(0, Math.min(1, (Math.acos(-1) - Math.acos(cos)) / (Math.PI / 4)));
  return u * u;
}
// Above 100% the optional knot smoothing runs *before* the fillet.
// The high-turn guard must be LOCAL. A temporary 180° reversal on one
// transported Morph vertex used to set a single MIN factor for the
// *entire* outline, switching off extra rounding at every other corner.
// Keep the guard on that turn and its immediately incident knots only.
// A radial crossing is also constrained per knot, never globally.
// This changes only displayed smoothing, not the animated vertex rail.
function limitHighTurnExtraKnotSmoothing(original, smoothed, closed, cornerFlags) {
  const pts = original || [],
    n = pts.length;
  if (n < 3 || !Array.isArray(smoothed) || smoothed.length !== n) return smoothed;
  const factors = new Float64Array(n).fill(1);
  let hasProtectedTurn = false;
  for (let i = 0; i < n; i++) {
    if (cornerFlags?.[i] !== true || (!closed && (i === 0 || i === n - 1))) continue;
    const a = pts[(i - 1 + n) % n],
      b = pts[i],
      c = pts[(i + 1) % n];
    const turn = highTurnRoundingFactor({ x: b.x - a.x, y: b.y - a.y }, { x: c.x - b.x, y: c.y - b.y });
    if (turn >= 0.999999) continue;
    hasProtectedTurn = true;
    // Smoothing moves adjoining knots too; guard the whole local
    // three-knot reversal without suppressing unrelated corners.
    factors[i] = Math.min(factors[i], turn);
    if (closed || i > 1) factors[(i - 1 + n) % n] = Math.min(factors[(i - 1 + n) % n], turn);
    if (closed || i < n - 2) factors[(i + 1) % n] = Math.min(factors[(i + 1) % n], turn);
  }
  if (!hasProtectedTurn) return smoothed;
  const radius = pts.reduce((r, p) => Math.max(r, Math.hypot(p.x, p.y)), 0);
  const floor = radius * 0.5;
  if (floor > 1e-7) {
    for (let i = 0; i < n; i++) {
      const a = pts[i],
        b = smoothed[i];
      if (Math.hypot(a.x, a.y) <= floor + 1e-7) continue;
      const dx = b.x - a.x,
        dy = b.y - a.y,
        qa = dx * dx + dy * dy;
      if (qa < 1e-12) continue;
      const qb = 2 * (a.x * dx + a.y * dy);
      const qc = a.x * a.x + a.y * a.y - floor * floor;
      const discriminant = qb * qb - 4 * qa * qc;
      if (discriminant < 0) continue;
      const crossing = (-qb - Math.sqrt(discriminant)) / (2 * qa);
      if (crossing >= 0 && crossing < factors[i]) factors[i] = Math.max(0, crossing - 1e-7);
    }
  }
  return smoothed.map((p, i) => ({
    ...p,
    x: pts[i].x + (p.x - pts[i].x) * factors[i],
    y: pts[i].y + (p.y - pts[i].y) * factors[i],
  }));
}
// A fillet on a high-angle vertex must not consume the rail into the
// inner half of its original circumradius. The limit is only applied
// to the *fillet shoulders*, not to intentional unrounded chords
// passing through the centre (e.g. a diameter in K=N/2 mode).
// Work in distances along the actual spline run, not its chord.
function clampSplineFilletCutToHalfRadius(run, fromEnd, cut, originalRadius) {
  const floor = originalRadius * 0.5;
  if (!(floor > 1e-7 && cut > 1e-8 && run?.total > 1e-8)) return cut;
  const origin = locateOnEdgeLocalSplineRun(run, fromEnd ? run.total : 0).point;
  if (Math.hypot(origin.x, origin.y) <= floor + 1e-6) return cut;
  const sample = (d) => {
    const p = locateOnEdgeLocalSplineRun(run, fromEnd ? run.total - d : d).point;
    return Math.hypot(p.x, p.y) - floor;
  };
  // Find the first entry into the excluded circle, even if a
  // winding spline were to leave it again later in the run.
  let last = 0;
  const steps = 12;
  for (let i = 1; i <= steps; i++) {
    const d = (cut * i) / steps;
    if (sample(d) <= 1e-7) {
      let lo = last,
        hi = d;
      for (let k = 0; k < 14; k++) {
        const mid = (lo + hi) * 0.5;
        if (sample(mid) > 1e-7) lo = mid;
        else hi = mid;
      }
      return Math.max(0, lo);
    }
    last = d;
  }
  return cut;
}
function splinePathForDraw(
  ctx,
  rawPoints,
  closed = false,
  roundingFrac = 0,
  cornerFlags = [],
  bridgeRoundFlags = [],
  wholeCurveSpline = false,
  splineBlend = 1,
  liveSeamMix = 0,
  filletLayer = null,
) {
  // With rounding disabled, honor the authored Spline profile. Spline+
  // intentionally draws a polygon at 0%, which hid the original
  // edge-local cubic runs and their *unrounded* (sharp) junctions.
  // Leave the Spline+ path completely unchanged above zero.
  if (
    !state.fourierMode &&
    typeof somataDrawSplineCornerMode === 'function' &&
    (Number(roundingFrac) > 0 || (Number(roundingFrac) === 0 && filletLayer?.profileMode === 'spline')) &&
    somataDrawSplineCornerMode(ctx, rawPoints, Boolean(closed), roundingFrac, {
      baseSplineBlend: splineBlend,
      layer: filletLayer,
      sharpJunctions: !(Number(roundingFrac) > 0),
      cornerFlags: wholeCurveSpline ? [] : cornerFlags,
    })
  )
    return;
  if (
    !state.fourierMode &&
    typeof drawUnifiedFilletPath === 'function' &&
    Number(roundingFrac) > 0.00001 &&
    (wholeCurveSpline !== true || filletLayer?.roundingSmoothSplines === true)
  ) {
    const flags =
      filletLayer?.roundingSmoothSplines === true
        ? rawPoints.map((_, i) => Boolean(closed) || (i > 0 && i < rawPoints.length - 1))
        : cornerFlags;
    const filletOpts = {
      spline: true,
      layer: filletLayer,
      wholeCurveSpline,
      bridgeRoundFlags: wholeCurveSpline === true ? null : bridgeRoundFlags,
    };
    // The legacy spline renderer and the rounded rail are not the
    // same curve at 0%: abruptly choosing the rounded rail above
    // 0.00001 used to redraw an entire profile in ONE frame.
    // Blend their *geometry*, not their opacity, near zero.
    const low = Math.max(0, Math.min(1, (Number(roundingFrac) || 0) / 0.06));
    if (low < 1 && typeof blendMorphFilletPaths === 'function') {
      const u = low * low * (3 - 2 * low);
      blendMorphFilletPaths(
        ctx,
        (c) =>
          splinePathForDraw(
            c,
            rawPoints,
            closed,
            0,
            cornerFlags,
            bridgeRoundFlags,
            wholeCurveSpline,
            splineBlend,
            liveSeamMix,
            filletLayer,
          ),
        (c) => {
          if (!drawUnifiedFilletPath(c, rawPoints, Boolean(closed), roundingFrac, flags, filletOpts))
            splinePathForDraw(
              c,
              rawPoints,
              closed,
              0,
              cornerFlags,
              bridgeRoundFlags,
              wholeCurveSpline,
              splineBlend,
              liveSeamMix,
              filletLayer,
            );
        },
        u,
        Boolean(closed),
      );
      return;
    }
    if (drawUnifiedFilletPath(ctx, rawPoints, Boolean(closed), roundingFrac, flags, filletOpts)) return;
  }
  // Direct geometry callers (including GPU sampling) must use the
  // exact same sharp-junction Spline+ even without a layer object.
  if (
    !state.fourierMode &&
    !(Number(roundingFrac) > 0) &&
    typeof somataDrawSplineCornerMode === 'function' &&
    somataDrawSplineCornerMode(ctx, rawPoints, Boolean(closed), 0, {
      sharpJunctions: true,
      cornerFlags: wholeCurveSpline ? [] : cornerFlags,
      baseSplineBlend: splineBlend,
      layer: filletLayer,
    })
  )
    return;
  let points = (rawPoints || []).filter(
    (p) => p && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y)),
  );
  if (points.length < 2) return;
  const round = Math.max(0, Math.min(2, Number(roundingFrac) || 0));
  const filletRound = Math.min(1, round);
  let flags = Array.isArray(cornerFlags) ? cornerFlags.slice(0, points.length) : [];
  const bridgePolicy = Array.isArray(bridgeRoundFlags) && bridgeRoundFlags.length === points.length;
  let bridgeFlags = bridgePolicy ? bridgeRoundFlags.slice(0, points.length) : [];
  // The old code selected ONLY positive bridge flags when an array
  // existed. A valid array containing no true values inadvertently
  // suppressed EVERY authored corner during Morph. null means the
  // knot is not an edge bridge; explicit false blocks only that
  // particular straight-join bridge.
  const roundableAt = (boundary) =>
    flags[boundary] === true && (!bridgePolicy || bridgeFlags[boundary] !== false);

  if (state.fourierMode && rawPoints?._fourierPrepared !== true) {
    points = buildFourierWavePoints(points, Boolean(closed), `spline:${round.toFixed(4)}`);
    flags = [];
    bridgeFlags = [];
  }
  if (points.length === 2) {
    ctx.moveTo(points[0].x, points[0].y);
    ctx.lineTo(points[1].x, points[1].y);
    if (closed) ctx.closePath();
    return;
  }

  const runs =
    wholeCurveSpline === true || rawPoints?._spiroWholeCurveSpline === true
      ? []
      : collectEdgeLocalSplineRuns(points, Boolean(closed), flags, splineBlend);
  if (!runs.length) {
    const roundedPoints =
      round > 0.001 ? transformSplineKnotsForRounding(points, Boolean(closed), round, flags) : points;
    const boundedPoints =
      round > 1.000001
        ? limitHighTurnExtraKnotSmoothing(points, roundedPoints, Boolean(closed), flags)
        : roundedPoints;
    drawWholeCentripetalSpline(ctx, boundedPoints, Boolean(closed), splineBlend);
    return;
  }

  const junctions = [];
  const runCount = runs.length;
  // A rounding percentage refers to the COMPLETE visible profile,
  // not the length of whichever two segments happen to meet here.
  // The per-corner budget is an arc distance, independent of sampling
  // density or of a tiny segment immediately beside the corner.
  // Each shoulder is then limited to half the run between two actual
  // corners so adjacent fillets cannot overlap or reverse direction.
  const pathLength = runs.reduce((sum, run) => sum + Math.max(0, run.total), 0);
  let roundableCount = 0;
  for (let i = closed ? 0 : 1; i < runCount; i++) {
    const boundary = runs[i].startBoundary;
    if (roundableAt(boundary)) roundableCount++;
  }
  const globalShoulder = roundableCount > 0 ? ((0.5 * pathLength) / roundableCount) * filletRound : 0;
  const originalRadius = points.reduce((r, p) => Math.max(r, Math.hypot(p.x, p.y)), 0);
  const cutAtJunction = (prev, next, roundable) => {
    if (!roundable) return { left: 0, right: 0 };
    const a = Math.max(0, Number(prev.total) || 0);
    const b = Math.max(0, Number(next.total) || 0);
    const last = prev.cubics?.[prev.cubics.length - 1],
      first = next.cubics?.[0];
    const inTangent = last ? { x: last.p3.x - last.c2.x, y: last.p3.y - last.c2.y } : null;
    const outTangent = first ? { x: first.c1.x - first.p0.x, y: first.c1.y - first.p0.y } : null;
    const factor = highTurnRoundingFactor(inTangent, outTangent);
    let left = Math.min(a * 0.5, globalShoulder) * factor;
    let right = Math.min(b * 0.5, globalShoulder) * factor;
    if (factor < 0.999999) {
      left = clampSplineFilletCutToHalfRadius(prev, true, left, originalRadius);
      right = clampSplineFilletCutToHalfRadius(next, false, right, originalRadius);
    }
    return { left, right };
  };
  if (closed) {
    for (let i = 0; i < runCount; i++) {
      const prev = runs[(i - 1 + runCount) % runCount],
        next = runs[i];
      const boundary = next.startBoundary;
      const roundable = roundableAt(boundary);
      const cuts = cutAtJunction(prev, next, roundable);
      prev.trimEnd = Math.max(prev.trimEnd || 0, cuts.left);
      next.trimStart = Math.max(next.trimStart || 0, cuts.right);
      junctions.push({ boundary, roundable, cuts, prev, next });
    }
  } else {
    for (let i = 1; i < runCount; i++) {
      const prev = runs[i - 1],
        next = runs[i],
        boundary = next.startBoundary;
      const roundable = roundableAt(boundary);
      const cuts = cutAtJunction(prev, next, roundable);
      prev.trimEnd = Math.max(prev.trimEnd || 0, cuts.left);
      next.trimStart = Math.max(next.trimStart || 0, cuts.right);
      junctions.push({ boundary, roundable, cuts, prev, next });
    }
  }

  for (const run of runs) {
    const total = Math.max(0, Number(run.total) || 0);
    if (total <= 1e-9) continue;
    let start = Math.max(0, Math.min(total, Number(run.trimStart) || 0));
    let end = Math.max(0, Math.min(total, Number(run.trimEnd) || 0));
    const maxCombined = total * (1 - 0.002);
    const combined = start + end;
    if (combined > maxCombined && combined > 1e-9) {
      const k = maxCombined / combined;
      start *= k;
      end *= k;
    }
    run.trimStart = start;
    run.trimEnd = end;
  }

  const locs = runs.map((run) => {
    const d0 = Math.max(0, Math.min(run.total, run.trimStart || 0));
    const d1 = Math.max(d0, Math.min(run.total, run.total - (run.trimEnd || 0)));
    return { start: locateOnEdgeLocalSplineRun(run, d0), end: locateOnEdgeLocalSplineRun(run, d1) };
  });

  ctx.moveTo(locs[0].start.point.x, locs[0].start.point.y);
  for (let i = 0; i < runCount; i++) {
    appendTrimmedEdgeLocalSplineRun(ctx, runs[i], locs[i].start, locs[i].end);
    const hasNext = closed || i < runCount - 1;
    if (!hasNext) continue;
    const ni = (i + 1) % runCount;
    const boundary = runs[ni].startBoundary;
    const roundable = roundableAt(boundary);
    const cut = roundable ? Math.max(runs[i].trimEnd || 0, runs[ni].trimStart || 0) : 0;
    if (roundable && cut > 1e-9) {
      appendLocalSplineFillet(ctx, locs[i].end, locs[ni].start, cut, 1, points[boundary]);
    } else {
      const b = locs[ni].start.point;

      ctx.lineTo(b.x, b.y);
    }
  }
  if (closed) ctx.closePath();
}

export {
  highTurnRoundingFactor,
  limitHighTurnExtraKnotSmoothing,
  splineCubicPoint,
  splinePathForDraw,
  splitSplineCubic,
  subSplineCubic,
  transformSplineKnotsForRounding,
};
