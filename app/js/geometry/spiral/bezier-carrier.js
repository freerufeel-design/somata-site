// Спираль: кубические Безье-несущие — построение, периодическая сшивка, починка стыков, смешивание.
import './fillets.js'; // initialisation order: this module runs after it
import {
  SPIRAL_FILLET_MIN_TURN, spiralFilletCutScale, spiralOrdinaryFilletCut, spiralVectorTurnAngleDeg,
} from './fillets.js';
import { roundPolylineForDraw } from '../polyline-rounding.js';
import { isPreSampledSplineLayer } from '../../core/render-runtime.js';
import { runtimeState, state } from '../../core/state.js';
import { somataDrawSplineCornerMode } from '../spline-corner-mode.js';
import { centripetalSplineBezierControls } from '../spline.js';
import { getConfiguredSplinePointCount, normalizeSplineRenderMode } from '../profile-model.js';
import {
  splineCubicPoint,
  splinePathForDraw,
  splitSplineCubic,
  subSplineCubic,
  transformSplineKnotsForRounding,
} from '../spline-rounding.js';
import { transformSpiralCopyPoint } from './polyline.js';
import { getSpiralAngularVertexCount } from './order-params.js';

function drawSpiralSpaceCentripetalSpline(ctx, rawPoints, roundingFrac = 0) {
  const src = (Array.isArray(rawPoints) ? rawPoints : []).filter(
    (p) => p && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y)),
  );
  if (src.length < 2) return;
  if (src.length === 2) {
    ctx.moveTo(src[0].x, src[0].y);
    ctx.lineTo(src[1].x, src[1].y);
    return;
  }
  const round = Math.max(0, Math.min(2, Number(roundingFrac) || 0));
  const closed = src[0]?.__spiralClosed === true;
  const tangential = src[0]?.__spiralTangential === true;
  const seamRound = src[0]?.__spiralRoundSeams !== false;
  const delta = Number(src[0]?.__spiralDelta) || 0;
  const scale = Math.max(1e-6, Number(src[0]?.__spiralTargetScale) || 1);
  const seamContinuous = closed && (tangential || (seamRound && round > 0.001));
  let pts = src.map((p) => ({ ...p })),
    prevGhost = null,
    nextGhost = null;
  if (closed && Number.isFinite(delta) && Number.isFinite(scale)) {
    const prev = src.map((p) => transformSpiralCopyPoint(p, delta, scale, -1));
    const next = src.map((p) => transformSpiralCopyPoint(p, delta, scale, 1));
    if (round > 0.001) {
      if (seamContinuous) {
        const ext = [...prev.slice(0, -1), ...src, ...next.slice(1)];
        const rounded = transformSplineKnotsForRounding(ext, false, round, []);
        const off = prev.length - 1;
        pts = rounded.slice(off, off + src.length).map((p, i) => ({ ...src[i], x: p.x, y: p.y }));
        prevGhost = rounded[off - 1] || prev[Math.max(0, prev.length - 2)];
        nextGhost = rounded[off + src.length] || next[Math.min(next.length - 1, 1)];
      } else {
        const rp = transformSplineKnotsForRounding(src, false, round, []);
        pts = rp.map((p, i) => ({ ...src[i], x: p.x, y: p.y }));
      }
    }
    if (seamContinuous && !prevGhost) {
      prevGhost = prev[Math.max(0, prev.length - 2)];
      nextGhost = next[Math.min(next.length - 1, 1)];
    }
  } else if (round > 0.001) {
    const rp = transformSplineKnotsForRounding(src, false, round, []);
    pts = rp.map((p, i) => ({ ...src[i], x: p.x, y: p.y }));
  }

  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 0; i < pts.length - 1; i++) {
    const p1 = pts[i],
      p2 = pts[i + 1];
    const p0 = i > 0 ? pts[i - 1] : prevGhost || { x: 2 * p1.x - p2.x, y: 2 * p1.y - p2.y };
    const p3 = i + 2 < pts.length ? pts[i + 2] : nextGhost || { x: 2 * p2.x - p1.x, y: 2 * p2.y - p1.y };
    const ctrl = centripetalSplineBezierControls(p0, p1, p2, p3, 0.5);
    ctx.bezierCurveTo(ctrl.c1.x, ctrl.c1.y, ctrl.c2.x, ctrl.c2.y, p2.x, p2.y);
  }
}
function sampleSmoothSpiralSplineForVariableWidth(
  points,
  roundingFrac = 0,
  cornerFlags = null,
  splineShape = false,
  filletLayer = null,
) {
  const src = (Array.isArray(points) ? points : []).filter(
    (p) => p && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y)),
  );
  if (src.length < 3) return src;
  const sampled = [];
  let current = null,
    subpathStart = null; // start of the current subpath, for closePath()
  const push = (x, y) => {
    const p = { x: Number(x) || 0, y: Number(y) || 0 };
    if (sampled.length) {
      const q = sampled[sampled.length - 1];
      if (Math.hypot(p.x - q.x, p.y - q.y) < 1e-7) {
        current = p;
        return;
      }
    }
    sampled.push(p);
    current = p;
  };
  const sampler = {
    moveTo(x, y) {
      push(x, y);
      subpathStart = { x: Number(x) || 0, y: Number(y) || 0 };
    },
    lineTo(x, y) {
      push(x, y);
    },
    bezierCurveTo(c1x, c1y, c2x, c2y, x, y) {
      if (!current) {
        push(x, y);
        return;
      }
      const p0 = { ...current },
        p1 = { x: Number(c1x) || 0, y: Number(c1y) || 0 },
        p2 = { x: Number(c2x) || 0, y: Number(c2y) || 0 },
        p3 = { x: Number(x) || 0, y: Number(y) || 0 };

      const chord = Math.hypot(p3.x - p0.x, p3.y - p0.y);
      const ctrl =
        Math.hypot(p1.x - p0.x, p1.y - p0.y) +
        Math.hypot(p2.x - p1.x, p2.y - p1.y) +
        Math.hypot(p3.x - p2.x, p3.y - p2.y);
      const curvature = Math.max(1, ctrl / Math.max(1e-6, chord));
      const steps = Math.max(10, Math.min(32, Math.ceil(9 * curvature)));
      for (let i = 1; i <= steps; i++) {
        const q = i / steps;
        const t = 0.5 - 0.5 * Math.cos(Math.PI * q),
          u = 1 - t;
        push(
          u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
          u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
        );
      }
    },
    quadraticCurveTo(cx, cy, x, y) {
      if (!current) {
        push(x, y);
        return;
      }
      const p0 = { ...current },
        p1 = { x: Number(cx) || 0, y: Number(cy) || 0 },
        p2 = { x: Number(x) || 0, y: Number(y) || 0 };
      const steps = 12;
      for (let i = 1; i <= steps; i++) {
        const t = i / steps,
          u = 1 - t;
        push(u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x, u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y);
      }
    },
    closePath() {
      if (
        subpathStart &&
        current &&
        Math.hypot(current.x - subpathStart.x, current.y - subpathStart.y) > 1e-8
      )
        push(subpathStart.x, subpathStart.y);
    },
  };

  if (state.fourierMode) {
    splinePathForDraw(
      sampler,
      src,
      false,
      Math.max(0, Math.min(2, Number(roundingFrac) || 0)),
      Array.isArray(cornerFlags) ? cornerFlags : [],
      [],
    );
  } else if (splineShape && !(Number(roundingFrac) > 0)) {
    // Sample the same authored edge-local spline as the visible line;
    // do not substitute Spline+'s zero-rounding straight segments.
    splinePathForDraw(
      sampler,
      src,
      false,
      0,
      Array.isArray(cornerFlags) ? cornerFlags : [],
      [],
      filletLayer?.wholeCurveSpline === true,
      1,
      0,
      filletLayer,
    );
  } else if (splineShape && typeof somataDrawSplineCornerMode === 'function') {
    somataDrawSplineCornerMode(sampler, src, false, roundingFrac, { baseSplineBlend: 1, layer: filletLayer });
  } else {
    drawSpiralSpaceCentripetalSpline(sampler, src, roundingFrac);
  }
  if (sampled.length < 2) return src;

  const srcCum = [0],
    dstCum = [0];
  let srcTotal = 0,
    dstTotal = 0;
  for (let i = 1; i < src.length; i++) {
    srcTotal += Math.hypot(src[i].x - src[i - 1].x, src[i].y - src[i - 1].y);
    srcCum.push(srcTotal);
  }
  for (let i = 1; i < sampled.length; i++) {
    dstTotal += Math.hypot(sampled[i].x - sampled[i - 1].x, sampled[i].y - sampled[i - 1].y);
    dstCum.push(dstTotal);
  }
  let seg = 0,
    logSegment = -1,
    logA = 0,
    logSpan = 0;
  for (let i = 0; i < sampled.length; i++) {
    const f = dstTotal > 1e-9 ? dstCum[i] / dstTotal : i / Math.max(1, sampled.length - 1);
    const target = f * Math.max(1e-9, srcTotal);
    while (seg < src.length - 2 && srcCum[seg + 1] < target) seg++;
    const span = Math.max(1e-9, srcCum[seg + 1] - srcCum[seg]);
    const u = Math.max(0, Math.min(1, (target - srcCum[seg]) / span));
    // Each source edge serves many tessellated Bézier points.
    // Its endpoint widths are fixed for this call; preserve the
    // exact log-space formula but evaluate its logs only once.
    if (logSegment !== seg) {
      const wa = Math.max(0.02, Number(src[seg]?.widthScale) || 1);
      const wb = Math.max(0.02, Number(src[Math.min(src.length - 1, seg + 1)]?.widthScale) || wa);
      logA = Math.log(wa);
      logSpan = Math.log(wb) - Math.log(wa);
      logSegment = seg;
    }
    sampled[i].widthScale = Math.exp(logA + logSpan * u);
  }

  sampled[0].widthScale = Math.max(0.02, Number(src[0]?.widthScale) || 1);
  sampled[sampled.length - 1].widthScale = Math.max(0.02, Number(src[src.length - 1]?.widthScale) || 1);
  sampled._spiralSplineSampled = true;
  return sampled;
}
function buildSmoothSpiralBezierSegments(
  points,
  roundingFrac = 0,
  cornerFlags = null,
  splineShape = false,
  filletLayer = null,
  prevalidated = false,
) {
  // The caller's segment builder has already rejected invalid nodes.
  const src = prevalidated
    ? points
    : (Array.isArray(points) ? points : []).filter(
        (p) => p && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y)),
      );
  if (src.length < 2) return [];
  const segments = [];
  let current = null;
  const pushLine = (x, y) => {
    const p3 = { x: Number(x) || 0, y: Number(y) || 0 };
    if (!current) {
      current = p3;
      return;
    }
    const p0 = current,
      c1 = { x: p0.x + (p3.x - p0.x) / 3, y: p0.y + (p3.y - p0.y) / 3 },
      c2 = { x: p0.x + (2 * (p3.x - p0.x)) / 3, y: p0.y + (2 * (p3.y - p0.y)) / 3 };
    segments.push({ p0: { ...p0 }, c1, c2, p3: { ...p3 } });
    current = p3;
  };
  const recorder = {
    moveTo(x, y) {
      current = { x: Number(x) || 0, y: Number(y) || 0 };
    },
    lineTo(x, y) {
      pushLine(x, y);
    },
    bezierCurveTo(c1x, c1y, c2x, c2y, x, y) {
      const p3 = { x: Number(x) || 0, y: Number(y) || 0 };
      if (!current) {
        current = p3;
        return;
      }
      segments.push({
        p0: { ...current },
        c1: { x: Number(c1x) || 0, y: Number(c1y) || 0 },
        c2: { x: Number(c2x) || 0, y: Number(c2y) || 0 },
        p3: { ...p3 },
      });
      current = p3;
    },
    quadraticCurveTo(cx, cy, x, y) {
      const p3 = { x: Number(x) || 0, y: Number(y) || 0 };
      if (!current) {
        current = p3;
        return;
      }
      const q = { x: Number(cx) || 0, y: Number(cy) || 0 },
        p0 = current;
      segments.push({
        p0: { ...p0 },
        c1: { x: p0.x + ((q.x - p0.x) * 2) / 3, y: p0.y + ((q.y - p0.y) * 2) / 3 },
        c2: { x: p3.x + ((q.x - p3.x) * 2) / 3, y: p3.y + ((q.y - p3.y) * 2) / 3 },
        p3: { ...p3 },
      });
      current = p3;
    },
    closePath() {},
  };

  if (state.fourierMode) return [];
  // Whole-curve spline deliberately softens authored junctions. The
  // default local spline preserves them, just like the static carrier.
  const whole = points?._spiroWholeCurveSpline === true;
  if (splineShape && !(Number(roundingFrac) > 0))
    // Build the *same* unrounded authored spline in the retained GPU
    // cubics as in the static canvas and lamp sampling paths.
    splinePathForDraw(
      recorder,
      src,
      false,
      0,
      Array.isArray(cornerFlags) ? cornerFlags : [],
      [],
      whole,
      1,
      0,
      filletLayer,
    );
  else if (splineShape && typeof somataDrawSplineCornerMode === 'function')
    somataDrawSplineCornerMode(recorder, src, false, roundingFrac, {
      baseSplineBlend: 1,
      layer: filletLayer,
      prevalidated: true,
    });
  else if (whole)
    drawSpiralSpaceCentripetalSpline(recorder, src, Math.max(0, Math.min(2, Number(roundingFrac) || 0)));
  else
    splinePathForDraw(
      recorder,
      src,
      false,
      Math.max(0, Math.min(2, Number(roundingFrac) || 0)),
      Array.isArray(cornerFlags) ? cornerFlags : [],
      [],
      false,
    );
  if (!segments.length) return [];

  const direct = segments.length === src.length - 1;
  if (direct) {
    // Spline+ has exactly one cubic per transported edge.  Its
    // widths already correspond to the original nodes: no arc
    // length table or per-segment interpolation is necessary.
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      seg.widthScale0 = Math.max(0.02, Number(src[i]?.widthScale) || 1);
      seg.widthScale1 = Math.max(
        0.02,
        Number(src[Math.min(src.length - 1, i + 1)]?.widthScale) || seg.widthScale0,
      );
      seg.__profileCorner0 = src[i]?.__profileCorner === true;
      seg.__profileCorner1 = src[Math.min(src.length - 1, i + 1)]?.__profileCorner === true;
    }
  } else {
    // Keep the full approved remapping only for rails whose
    // output cubic count differs from the input node count.
    const srcCum = [0];
    let srcTotal = 0;
    for (let i = 1; i < src.length; i++) {
      srcTotal += Math.hypot(src[i].x - src[i - 1].x, src[i].y - src[i - 1].y);
      srcCum.push(srcTotal);
    }
    // The fractions in this caller are monotone (i / segmentCount).
    // Reuse the last exact arc interval instead of rescanning all
    // earlier source edges for every output cubic. Keep a reset for
    // any future caller that requests decreasing fractions.
    let widthCursor = 0,
      widthCursorTarget = -Infinity;
    let logEdge = -1,
      logEdgeStart = 0,
      logEdgeSpan = 0;
    const widthAtFraction = (f) => {
      if (src.length < 2) return Math.max(0.02, Number(src[0]?.widthScale) || 1);
      const target = Math.max(0, Math.min(1, Number(f) || 0)) * Math.max(1e-9, srcTotal);
      if (target < widthCursorTarget) widthCursor = 0;
      while (widthCursor < src.length - 2 && srcCum[widthCursor + 1] < target) widthCursor++;
      widthCursorTarget = target;
      const i = widthCursor;
      const span = Math.max(1e-9, srcCum[i + 1] - srcCum[i]),
        u = Math.max(0, Math.min(1, (target - srcCum[i]) / span));
      if (logEdge !== i) {
        const a = Math.max(0.02, Number(src[i]?.widthScale) || 1),
          b = Math.max(0.02, Number(src[Math.min(src.length - 1, i + 1)]?.widthScale) || a);
        logEdgeStart = Math.log(a);
        logEdgeSpan = Math.log(b) - Math.log(a);
        logEdge = i;
      }
      return Math.exp(logEdgeStart + logEdgeSpan * u);
    };
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      seg.widthScale0 = widthAtFraction(i / segments.length);
      seg.widthScale1 = widthAtFraction((i + 1) / segments.length);
      seg.__profileCorner0 = false;
      seg.__profileCorner1 = false;
    }
  }
  segments._spiroBezierSpiral = true;
  return segments;
}
function finalizePeriodicSpiralBezierCarrier(segments, points) {
  const out = Array.isArray(segments) ? segments : [];
  const src = Array.isArray(points) ? points : [];
  if (
    !out.length ||
    !src.length ||
    src._somataSpiralSquashedY === true ||
    src[0]?.__spiralClosed !== true ||
    src[0]?.__spiralExplicitBridge === true
  )
    return out;
  const delta = Number(src[0]?.__spiralDelta),
    scale = Math.max(1e-6, Number(src[0]?.__spiralTargetScale) || 1);
  if (!Number.isFinite(delta) || !Number.isFinite(scale)) return out;
  const first = out[0],
    last = out[out.length - 1];
  if (!first?.p0 || !first?.c1 || !last?.c2 || !last?.p3) return out;
  const c = Math.cos(delta),
    s = Math.sin(delta),
    map = (p) => ({
      x: (c * (Number(p?.x) || 0) - s * (Number(p?.y) || 0)) * scale,
      y: (s * (Number(p?.x) || 0) + c * (Number(p?.y) || 0)) * scale,
    });
  const expectedP3 = map(first.p0),
    expectedNextC1 = map(first.c1);
  const hasAutoCloseBridge = src.some((p) => p?.__spiralAutoCloseBridgeEnd === true);
  const hasExplicitSeamFillet = src.some(
    (p) =>
      p?.__spiralClosureProtected === true ||
      p?.__spiralSeamProtected === true ||
      Boolean(p?.__spiralClosureFillet) ||
      Number(p?.__spiralSeamRoundFraction) > 0,
  );

  const tangentPeriodic =
    (src[0]?.__spiralTangential === true && !hasAutoCloseBridge) || hasExplicitSeamFillet;
  last.p3.x = expectedP3.x;
  last.p3.y = expectedP3.y;
  if (tangentPeriodic) {
    last.c2.x = 2 * expectedP3.x - expectedNextC1.x;
    last.c2.y = 2 * expectedP3.y - expectedNextC1.y;
  }
  if (Number.isFinite(Number(first.widthScale0)))
    last.widthScale1 = Math.max(0.02, Number(first.widthScale0) * scale);
  out._spiroPeriodic = true;
  out._spiroPeriodicDelta = delta;
  out._spiroPeriodicScale = scale;
  out._spiroPeriodicTangent = tangentPeriodic;
  return out;
}
// 7.6.4: a large authored fillet can consume the next short span and leave a
// secondary C0/C1 kink at the boundary of the generated round.  Morph already
// repairs every smooth/non-authored join on GPU; static geometry must obey the
// same rule, not a weaker angle threshold.  The near-1 tolerance avoids only
// meaningless floating-point churn.  Authored hard corners remain untouched.
function repairRoundedSpiralBezierJoins(segments, maxTurnCos = 0.999999) {
  const out = Array.isArray(segments) ? segments : [];
  if (out.length < 2) return out;
  let repaired = 0;
  const unit = (x, y, fx = 1, fy = 0) => {
    const l = Math.hypot(x, y);
    return l > 1e-9 ? { x: x / l, y: y / l } : { x: fx, y: fy };
  };
  for (let i = 1; i < out.length; i++) {
    const prev = out[i - 1],
      next = out[i];
    if (!prev?.p3 || !prev?.c2 || !next?.p0 || !next?.c1) continue;
    if (prev.__profileCorner1 === true || next.__profileCorner0 === true) continue;
    const knot = {
      x: ((Number(prev.p3.x) || 0) + (Number(next.p0.x) || 0)) * 0.5,
      y: ((Number(prev.p3.y) || 0) + (Number(next.p0.y) || 0)) * 0.5,
    };
    const vin = { x: knot.x - (Number(prev.c2.x) || 0), y: knot.y - (Number(prev.c2.y) || 0) };
    const vout = { x: (Number(next.c1.x) || 0) - knot.x, y: (Number(next.c1.y) || 0) - knot.y };
    const lin = Math.hypot(vin.x, vin.y),
      lout = Math.hypot(vout.x, vout.y);
    if (lin <= 1e-8 || lout <= 1e-8) continue;
    const di = unit(vin.x, vin.y),
      dout = unit(vout.x, vout.y, di.x, di.y),
      dot = di.x * dout.x + di.y * dout.y;
    if (dot >= maxTurnCos) continue;
    let sx = di.x + dout.x,
      sy = di.y + dout.y,
      sl = Math.hypot(sx, sy);
    let dir;
    if (sl <= 1e-8 || dot < -0.95) dir = lin >= lout ? di : dout;
    else dir = { x: sx / sl, y: sy / sl };
    prev.c2 = { x: knot.x - dir.x * lin, y: knot.y - dir.y * lin };
    prev.p3 = { x: knot.x, y: knot.y };
    next.p0 = { x: knot.x, y: knot.y };
    next.c1 = { x: knot.x + dir.x * lout, y: knot.y + dir.y * lout };
    prev.__spiroSecondaryRound = true;
    next.__spiroSecondaryRound = true;
    repaired++;
  }
  out._spiroSecondaryRoundRepairs = (Number(out._spiroSecondaryRoundRepairs) || 0) + repaired;
  return out;
}
// Linear fallback for the author-selectable segmented Spiral mode. Cubics are
// used only as GPU storage: both handles lie on the chord, so the visible
// geometry is an ordinary polyline (no spline smoothing or corner fillets).

// Blend two Spiral carriers by matching *arc stations*, not by pairing
// unrelated Bézier indices. Split each original cubic exactly with De
// Casteljau before blending its controls: at mix=0 and mix=1 the two
// original curves are reproduced exactly (even with different counts).
// This is display-only; the Morph anchors and spiral transport are not
// modified. It eliminates the old switch at rounding=0.001.
function blendSpiralCarrierCubics(authored, rounded, mix) {
  if (!authored?.length || !rounded?.length) return rounded;
  const lerp = (a, b, t) => a + (b - a) * t;
  const point = (a, b, t) => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) });
  const cubicPoint = (q, t) => {
    const u = 1 - t;
    return {
      x: u * u * u * q.p0.x + 3 * u * u * t * q.c1.x + 3 * u * t * t * q.c2.x + t * t * t * q.p3.x,
      y: u * u * u * q.p0.y + 3 * u * u * t * q.c1.y + 3 * u * t * t * q.c2.y + t * t * t * q.p3.y,
    };
  };
  const table = (curve) => {
    const stations = [0];
    let total = 0;
    for (const q of curve) {
      let p = q.p0;
      for (let j = 1; j <= 12; j++) {
        const v = cubicPoint(q, j / 12);
        total += Math.hypot(v.x - p.x, v.y - p.y);
        stations.push(total);
        p = v;
      }
    }
    return { curve, stations, total };
  };
  const A = table(authored),
    B = table(rounded);
  if (!(A.total > 1e-9 && B.total > 1e-9)) return rounded;
  const boundary = (t) => {
    const values = [0, 1];
    for (let i = 1; i < t.curve.length; i++) values.push(t.stations[i * 12] / t.total);
    return values;
  };
  // Each interval is a subsegment of one cubic from each carrier.
  // Exact De Casteljau splitting means no uniform tessellation is
  // needed; complexity stays linear in actual authored segments.
  const stations = boundary(A).concat(boundary(B));
  stations.sort((a, b) => a - b);
  const cuts = [];
  for (const f of stations) if (!cuts.length || f - cuts[cuts.length - 1] > 1e-12) cuts.push(f);
  if (cuts[cuts.length - 1] < 1) cuts.push(1);
  const locate = (table, f, preferEnd) => {
    const target = f * table.total,
      a = table.stations;
    let lo = 0,
      hi = a.length - 1;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (a[m] < target) lo = m + 1;
      else hi = m;
    }
    let k = Math.max(1, lo);
    if (preferEnd && Math.abs(target - a[k - 1]) < 1e-9) k = Math.max(1, k - 1);
    if (!preferEnd && k % 12 === 0 && Math.abs(target - a[k]) < 1e-9 && k < a.length - 1)
      return { idx: Math.min(table.curve.length - 1, k / 12), t: 0 };
    const idx = Math.min(table.curve.length - 1, Math.floor((k - 1) / 12));
    const local = k - 1 - idx * 12;
    const d = Math.max(1e-12, a[k] - a[k - 1]);
    return { idx, t: Math.max(0, Math.min(1, (local + (target - a[k - 1]) / d) / 12)) };
  };
  const split = (q, t) => {
    const p01 = point(q.p0, q.c1, t),
      p12 = point(q.c1, q.c2, t),
      p23 = point(q.c2, q.p3, t);
    const p012 = point(p01, p12, t),
      p123 = point(p12, p23, t),
      p = point(p012, p123, t);
    return [
      { p0: q.p0, c1: p01, c2: p012, p3: p },
      { p0: p, c1: p123, c2: p23, p3: q.p3 },
    ];
  };
  const section = (table, from, to) => {
    const a = locate(table, from, false),
      b = locate(table, to, true);
    // The union grid contains all natural segment boundaries.
    const idx = a.idx,
      source = table.curve[idx];
    const t0 = a.t,
      t1 = b.idx === idx ? b.t : 1;
    const right = t0 > 0 ? split(source, t0)[1] : source;
    const span = (t1 - t0) / Math.max(1e-12, 1 - t0);
    return span < 1 - 1e-12 ? split(right, Math.max(0, Math.min(1, span)))[0] : right;
  };
  const out = [];
  for (let i = 1; i < cuts.length; i++) {
    const a = cuts[i - 1],
      b = cuts[i];
    if (b - a < 1e-12) continue;
    const pa = section(A, a, b),
      pb = section(B, a, b);
    const value = (field) => point(pa[field], pb[field], mix);
    const wa = locate(A, a, false),
      wb = locate(B, a, false);
    const ea = locate(A, b, true),
      eb = locate(B, b, true);
    const weight = (tab, l) => {
      const q = tab.curve[l.idx],
        t = l.t;
      return Math.exp(
        lerp(
          Math.log(Math.max(0.02, Number(q.widthScale0) || 1)),
          Math.log(Math.max(0.02, Number(q.widthScale1) || 1)),
          t,
        ),
      );
    };
    out.push({
      p0: value('p0'),
      c1: value('c1'),
      c2: value('c2'),
      p3: value('p3'),
      widthScale0: lerp(weight(A, wa), weight(B, wb), mix),
      widthScale1: lerp(weight(A, ea), weight(B, eb), mix),
    });
  }
  out._spiroBezierSpiral = true;
  out._spiroExactFinalSpace = true;
  return out;
}
window.__spiroBlendCarrierCubics = blendSpiralCarrierCubics;
// Resolve all cuts against the original rails before writing any fillets.
// A corner that has already been trimmed must not shorten its neighbor's budget.
function roundSpiralRailJoins(joins, strength) {
  if (!(strength > 0.001)) return false;
  const rails = new Map();
  const len = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);
  const read = (rail) => {
    if (rails.has(rail)) return rails.get(rail);
    const cubics = rail._bezierSegments;
    const marks = cubics.map((q) => {
      const stations = [0];
      let p = q.p0;
      for (let i = 1; i <= 6; i++) {
        const next = splineCubicPoint(q, i / 6);
        stations.push(stations.at(-1) + len(p, next));
        p = next;
      }
      return stations;
    });
    const record = { rail, cubics, marks, length: marks.reduce((sum, row) => sum + row.at(-1), 0) };
    rails.set(rail, record);
    return record;
  };
  const corners = [];
  for (const [left, right, period] of joins) {
    if (!left?._bezierSegments?.length || !right?._bezierSegments?.length || (!period && left === right)) continue;
    const scale = period?.scale ?? 1, angle = period?.delta ?? 0;
    if (!(scale > 0) || !Number.isFinite(scale) || !Number.isFinite(angle)) continue;
    const c = Math.cos(angle), s = Math.sin(angle);
    const map = ({ x, y }) => ({ x: scale * (c * x - s * y), y: scale * (s * x + c * y) });
    const inv = ({ x, y }) => ({ x: (c * x + s * y) / scale, y: (c * y - s * x) / scale });
    const prev = left._bezierSegments.at(-1), next = right._bezierSegments[0];
    const vertex = prev.p3, origin = map(next.p0), handle = map(next.c1);
    if (len(vertex, origin) > Math.max(1e-7, Math.hypot(vertex.x, vertex.y) * 1e-8)) continue;
    const turn = spiralVectorTurnAngleDeg(
      vertex.x - prev.c2.x, vertex.y - prev.c2.y, handle.x - origin.x, handle.y - origin.y,
    );
    if (!(turn > SPIRAL_FILLET_MIN_TURN)) continue;
    const a = read(left), b = read(right);
    const distance = spiralOrdinaryFilletCut(a.length, b.length * scale, strength);
    if (distance <= 1e-7) continue;
    const corner = { a, b, scale, map, inv, vertex, distance };
    a.end = corner;
    b.start = corner;
    corners.push(corner);
  }
  for (const rail of rails.values()) {
    const start = rail.start ? rail.start.distance / rail.start.scale : 0;
    const end = rail.end?.distance ?? 0;
    const fit = spiralFilletCutScale(start + end, rail.length);
    if (fit === 1) continue;
    if (rail.start) rail.start.distance *= fit;
    if (rail.end && rail.end !== rail.start) rail.end.distance *= fit;
  }

  const at = ({ marks, cubics }, distance, reverse) => {
    if (distance <= 0) return reverse ? { i: cubics.length - 1, t: 1 } : { i: 0, t: 0 };
    const step = reverse ? -1 : 1;
    for (let i = reverse ? marks.length - 1 : 0; i >= 0 && i < marks.length; i += step) {
      const row = marks[i], length = row.at(-1);
      if (distance >= length) {
        distance -= length;
        continue;
      }
      const target = reverse ? length - distance : distance;
      let j = 1;
      while (j < 6 && row[j] < target) j++;
      return { i, t: (j - 1 + (target - row[j - 1]) / Math.max(1e-12, row[j] - row[j - 1])) / 6 };
    }
    return reverse ? { i: 0, t: 0 } : { i: cubics.length - 1, t: 1 };
  };
  const w = (q, t) => (q.widthScale0 ?? 1) + ((q.widthScale1 ?? 1) - (q.widthScale0 ?? 1)) * t;
  const trim = (q, x, y) => x === 0 && y === 1 ? q : ({
    ...q,
    ...subSplineCubic(q, x, y),
    widthScale0: w(q, x),
    widthScale1: w(q, y),
    __profileCorner0: x === 0 && q.__profileCorner0,
    __profileCorner1: y === 1 && q.__profileCorner1,
  });
  for (const rail of rails.values()) {
    rail.first = at(rail, rail.start ? rail.start.distance / rail.start.scale : 0, false);
    rail.last = at(rail, rail.end?.distance ?? 0, true);
    rail.body = rail.cubics.slice(rail.first.i, rail.last.i + 1).map((q, j) =>
      trim(q, j === 0 ? rail.first.t : 0, j + rail.first.i === rail.last.i ? rail.last.t : 1),
    );
  }
  for (const { a, b, scale, map, inv, vertex } of corners) {
    const left = a.body.at(-1), right = b.body[0];
    const head = left.p3, tail = map(right.p0);
    // The 13.2 quadratic through the original corner, stored as two exact cubics.
    const towardVertex = (p) => ({
      x: p.x + (vertex.x - p.x) * (2 / 3),
      y: p.y + (vertex.y - p.y) * (2 / 3),
    });
    const fillet = splitSplineCubic({ p0: head, c1: towardVertex(head), c2: towardVertex(tail), p3: tail }, 0.5);
    const w0 = left.widthScale1 ?? 1, w1 = right.widthScale0 ?? 1;
    const wm = (w0 + w1 * scale) * 0.5;
    a.tail = { ...fillet.left, widthScale0: w0, widthScale1: wm };
    b.head = {
      p0: inv(fillet.right.p0), c1: inv(fillet.right.c1), c2: inv(fillet.right.c2), p3: right.p0,
      widthScale0: wm / scale, widthScale1: w1,
    };
    b.rail._somataJoinedCorner = true;
  }
  for (const { rail, cubics, head, body, tail } of rails.values()) {
    cubics.splice(0, cubics.length, ...(head ? [head] : []), ...body, ...(tail ? [tail] : []));
    rail.points._somataJoinedFillet = true;
    rail.points._spiroRetainedCubics = cubics;
    rail.spiralRetainedProfileCarrier = true;
  }
  return corners.length > 0;
}

function roundJoinedSpiralRails(left, right, strength, period = null) {
  return roundSpiralRailJoins([[left, right, period]], strength);
}

function buildSpiralBezierSegments(
  points,
  roundingFrac = 0,
  cornerFlags = null,
  smoothSpline = false,
  splineShape = false,
  filletLayer = null,
) {
  if (
    state.fourierMode !== true &&
    Array.isArray(points?._spiroRetainedCubics) &&
    points._spiroRetainedCubics.length
  ) {
    return points._somataJoinedFillet === true || points._somataFinalProfileCubics === true
      ? points._spiroRetainedCubics
      : finalizePeriodicSpiralBezierCarrier(points._spiroRetainedCubics, points);
  }
  const src = (Array.isArray(points) ? points : []).filter(
    (p) => p && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y)),
  );
  if (src.length < 2 || state.fourierMode) return [];
  if (smoothSpline === true)
    return finalizePeriodicSpiralBezierCarrier(
      buildSmoothSpiralBezierSegments(src, roundingFrac, cornerFlags, splineShape, filletLayer, true),
      src,
    );
  const segments = [];

  const unrounded = Math.max(0, Number(roundingFrac) || 0) <= 1e-10;
  const hasMappedControls =
    unrounded &&
    src.some(
      (p) =>
        Number.isFinite(Number(p?.__spiralBezierC1X)) &&
        Number.isFinite(Number(p?.__spiralBezierC1Y)) &&
        Number.isFinite(Number(p?.__spiralBezierC2X)) &&
        Number.isFinite(Number(p?.__spiralBezierC2Y)),
    );
  const hasMappedTangents =
    unrounded &&
    src.some(
      (p) =>
        Number.isFinite(Number(p?.__spiralBezierOutTx)) || Number.isFinite(Number(p?.__spiralBezierInTx)),
    );
  if (hasMappedControls || hasMappedTangents) {
    let mappedControlCount = 0,
      hermiteCount = 0;
    for (let i = 0; i < src.length - 1; i++) {
      const a = src[i],
        b = src[i + 1],
        ax = Number(a.x) || 0,
        ay = Number(a.y) || 0,
        bx = Number(b.x) || 0,
        by = Number(b.y) || 0,
        dx = bx - ax,
        dy = by - ay;
      const closureSpan = Boolean(
        a?.__spiralProfileFinalRound ||
        b?.__spiralProfileFinalRound ||
        a?.__spiralClosureProtected ||
        b?.__spiralClosureProtected ||
        a?.__spiralClosureFillet ||
        b?.__spiralClosureFillet ||
        a?.__spiralAutoCloseBridgeEnd ||
        b?.__spiralAutoCloseBridgeEnd,
      );
      const mc1x = Number(a?.__spiralBezierC1X),
        mc1y = Number(a?.__spiralBezierC1Y),
        mc2x = Number(a?.__spiralBezierC2X),
        mc2y = Number(a?.__spiralBezierC2Y);
      const direct =
        !closureSpan &&
        Number.isFinite(mc1x) &&
        Number.isFinite(mc1y) &&
        Number.isFinite(mc2x) &&
        Number.isFinite(mc2y);
      let c1x = ax + dx / 3,
        c1y = ay + dy / 3,
        c2x = ax + (dx * 2) / 3,
        c2y = ay + (dy * 2) / 3;
      if (direct) {
        c1x = mc1x;
        c1y = mc1y;
        c2x = mc2x;
        c2y = mc2y;
        mappedControlCount++;
      } else {
        const otx = Number(a?.__spiralBezierOutTx),
          oty = Number(a?.__spiralBezierOutTy),
          itx = Number(b?.__spiralBezierInTx),
          ity = Number(b?.__spiralBezierInTy);
        const hasOut = Number.isFinite(otx) && Number.isFinite(oty),
          hasIn = Number.isFinite(itx) && Number.isFinite(ity);
        let d0x = dx,
          d0y = dy,
          d1x = dx,
          d1y = dy,
          useHermite = !closureSpan && (hasOut || hasIn);
        if (useHermite) {
          d0x = hasOut ? otx : dx;
          d0y = hasOut ? oty : dy;
          d1x = hasIn ? itx : dx;
          d1y = hasIn ? ity : dy;
          const chord = Math.max(1e-6, Math.hypot(dx, dy)),
            maxDerivative = chord * 3.0;
          const cap = (x, y) => {
            const l = Math.hypot(x, y);
            return l > maxDerivative && l > 1e-12
              ? [(x * maxDerivative) / l, (y * maxDerivative) / l]
              : [x, y];
          };
          [d0x, d0y] = cap(d0x, d0y);
          [d1x, d1y] = cap(d1x, d1y);
          c1x = ax + d0x / 3;
          c1y = ay + d0y / 3;
          c2x = bx - d1x / 3;
          c2y = by - d1y / 3;
          hermiteCount++;
        }
      }
      segments.push({
        p0: { x: ax, y: ay },
        c1: { x: c1x, y: c1y },
        c2: { x: c2x, y: c2y },
        p3: { x: bx, y: by },
        widthScale0: Math.max(0.02, Number(a.widthScale) || 1),
        widthScale1: Math.max(0.02, Number(b.widthScale) || 1),
        __profileCorner0: a?.__profileCorner === true,
        __profileCorner1: b?.__profileCorner === true,
      });
    }
    if (segments.length) {
      segments._spiroBezierSpiral = true;
      segments._spiroExactFinalSpace = true;
      segments._spiroMappedControlSpans = mappedControlCount;
      segments._spiroHermiteMapped = hermiteCount > 0;
      segments._spiroHermiteSpanCount = hermiteCount;
      return finalizePeriodicSpiralBezierCarrier(segments, src);
    }
  }
  let current = null;
  const pushLine = (x, y) => {
    const p3 = { x: Number(x) || 0, y: Number(y) || 0 };
    if (!current) {
      current = p3;
      return;
    }
    const p0 = current,
      dx = p3.x - p0.x,
      dy = p3.y - p0.y;
    segments.push({
      p0: { ...p0 },
      c1: { x: p0.x + dx / 3, y: p0.y + dy / 3 },
      c2: { x: p0.x + (dx * 2) / 3, y: p0.y + (dy * 2) / 3 },
      p3: { ...p3 },
    });
    current = p3;
  };
  const recorder = {
    moveTo(x, y) {
      current = { x: Number(x) || 0, y: Number(y) || 0 };
    },
    lineTo(x, y) {
      pushLine(x, y);
    },
    bezierCurveTo(c1x, c1y, c2x, c2y, x, y) {
      const p3 = { x: Number(x) || 0, y: Number(y) || 0 };
      if (!current) {
        current = p3;
        return;
      }
      segments.push({
        p0: { ...current },
        c1: { x: Number(c1x) || 0, y: Number(c1y) || 0 },
        c2: { x: Number(c2x) || 0, y: Number(c2y) || 0 },
        p3: { ...p3 },
      });
      current = p3;
    },
    quadraticCurveTo(cx, cy, x, y) {
      const p3 = { x: Number(x) || 0, y: Number(y) || 0 };
      if (!current) {
        current = p3;
        return;
      }
      const p0 = current,
        q = { x: Number(cx) || 0, y: Number(cy) || 0 };
      segments.push({
        p0: { ...p0 },
        c1: { x: p0.x + ((q.x - p0.x) * 2) / 3, y: p0.y + ((q.y - p0.y) * 2) / 3 },
        c2: { x: p3.x + ((q.x - p3.x) * 2) / 3, y: p3.y + ((q.y - p3.y) * 2) / 3 },
        p3: { ...p3 },
      });
      current = p3;
    },
    closePath() {},
  };
  roundPolylineForDraw(
    recorder,
    src,
    false,
    Math.max(0, Math.min(2, Number(roundingFrac) || 0)),
    Array.isArray(cornerFlags) ? cornerFlags : [],
  );
  if (!segments.length) return [];

  const srcCum = [0];
  let srcTotal = 0;
  for (let i = 1; i < src.length; i++) {
    srcTotal += Math.hypot(src[i].x - src[i - 1].x, src[i].y - src[i - 1].y);
    srcCum.push(srcTotal);
  }
  // OutputArc values and their normalized fractions are nondecreasing.
  // Preserve the exact historical width formula and interval boundary
  // condition while advancing the source interval in amortized O(1).
  let widthCursor = 0,
    widthCursorTarget = -Infinity;
  let logEdge = -1,
    logEdgeStart = 0,
    logEdgeSpan = 0;
  const widthAtFraction = (f) => {
    const target = Math.max(0, Math.min(1, Number(f) || 0)) * Math.max(1e-9, srcTotal);
    if (target < widthCursorTarget) widthCursor = 0;
    while (widthCursor < src.length - 2 && srcCum[widthCursor + 1] < target) widthCursor++;
    widthCursorTarget = target;
    const i = widthCursor;
    const span = Math.max(1e-9, srcCum[i + 1] - srcCum[i]),
      u = Math.max(0, Math.min(1, (target - srcCum[i]) / span));
    if (logEdge !== i) {
      const a = Math.max(0.02, Number(src[i]?.widthScale) || 1),
        b = Math.max(0.02, Number(src[Math.min(src.length - 1, i + 1)]?.widthScale) || a);
      logEdgeStart = Math.log(a);
      logEdgeSpan = Math.log(b) - Math.log(a);
      logEdge = i;
    }
    return Math.exp(logEdgeStart + logEdgeSpan * u);
  };
  // Width belongs to positions along the original spiral rail,
  // NEVER to the index of a generated fillet cubic. 11.0.8 switched
  // from authored point widths to i/segmentCount at rounding=.001:
  // a single inserted cubic could reorder the entire width ramp.
  const direct =
    segments.length === src.length - 1 &&
    segments.every(
      (q, i) =>
        Math.hypot(q.p0.x - src[i].x, q.p0.y - src[i].y) < 1e-7 &&
        Math.hypot(q.p3.x - src[i + 1].x, q.p3.y - src[i + 1].y) < 1e-7,
    );
  const outputArc = [0];
  for (const q of segments) {
    let p = q.p0,
      total = 0;
    for (let j = 1; j <= 6; j++) {
      const t = j / 6,
        u = 1 - t,
        v = {
          x: u * u * u * q.p0.x + 3 * u * u * t * q.c1.x + 3 * u * t * t * q.c2.x + t * t * t * q.p3.x,
          y: u * u * u * q.p0.y + 3 * u * u * t * q.c1.y + 3 * u * t * t * q.c2.y + t * t * t * q.p3.y,
        };
      total += Math.hypot(v.x - p.x, v.y - p.y);
      p = v;
    }
    outputArc.push(outputArc.at(-1) + total);
  }
  const outputTotal = Math.max(1e-9, outputArc.at(-1));
  for (let i = 0; i < segments.length; i++) {
    const q = segments[i];
    q.widthScale0 = direct
      ? Math.max(0.02, Number(src[i]?.widthScale) || 1)
      : widthAtFraction(outputArc[i] / outputTotal);
    q.widthScale1 = direct
      ? Math.max(0.02, Number(src[Math.min(src.length - 1, i + 1)]?.widthScale) || q.widthScale0)
      : widthAtFraction(outputArc[i + 1] / outputTotal);
    q.__profileCorner0 = direct && src[i]?.__profileCorner === true;
    q.__profileCorner1 = direct && src[Math.min(src.length - 1, i + 1)]?.__profileCorner === true;
  }
  segments._spiroBezierSpiral = true;
  segments._spiroExactFinalSpace = true;
  const strength = Math.max(0, Number(roundingFrac) || 0);
  const mapped = src.some(
    (p) =>
      (Number.isFinite(p?.__spiralBezierC1X) &&
        Number.isFinite(p?.__spiralBezierC1Y) &&
        Number.isFinite(p?.__spiralBezierC2X) &&
        Number.isFinite(p?.__spiralBezierC2Y)) ||
      (Number.isFinite(p?.__spiralBezierOutTx) && Number.isFinite(p?.__spiralBezierOutTy)) ||
      (Number.isFinite(p?.__spiralBezierInTx) && Number.isFinite(p?.__spiralBezierInTy)),
  );
  if (strength > 1e-10 && strength < 0.12 && mapped) {
    const authored = buildSpiralBezierSegments(src, 0, cornerFlags, false);
    const u = Math.min(1, strength / 0.12),
      smooth = u * u * (3 - 2 * u);
    return finalizePeriodicSpiralBezierCarrier(blendSpiralCarrierCubics(authored, segments, smooth), src);
  }
  return finalizePeriodicSpiralBezierCarrier(segments, src);
}
window.__spiroBuildSpiralBezierSegments = buildSpiralBezierSegments;
window.__spiroFinalizePeriodicSpiralBezierCarrier = finalizePeriodicSpiralBezierCarrier;
window.__spiroRepairRoundedSpiralBezierJoins = repairRoundedSpiralBezierJoins;
// A temporary display-only carrier for the last animated spline frame,
// shared by Polygon and Spiral. Authored nodes remain unchanged. Both
// CPU geometry and the Spiral GPU cache resolve this bridge.
function resolveMorphCommittedSpiralSpline(layer) {
  if (
    runtimeState?.morph?.active !== true ||
    layer?.profileMode !== 'spline' ||
    isPreSampledSplineLayer(layer)
  )
    return null;
  const bridge = runtimeState.morph.splineCommitBridge?.get(layer);
  if (
    !bridge ||
    !Array.isArray(bridge.raw) ||
    !Array.isArray(bridge.sampled) ||
    !Array.isArray(layer.profileNodes) ||
    layer.profileNodes.length !== bridge.raw.length
  )
    return null;
  if (
    !layer.profileNodes.every(
      (p, j) =>
        Math.abs((Number(p?.x) || 0) - bridge.raw[j].x) < 1e-9 &&
        Math.abs((Number(p?.y) || 0) - bridge.raw[j].y) < 1e-9,
    )
  )
    return null;
  return bridge;
}
function spiralProfileGeometrySignature(layer) {
  if (!layer) return 'none';
  let h = 2166136261 >>> 0;
  const mix = (v) => {
    const text = String(v ?? '');
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    h ^= 124;
    h = Math.imul(h, 16777619) >>> 0;
  };
  mix(layer.profileMode || 'segments');
  mix(layer.wholeCurveSpline === true ? 1 : 0);
  mix(normalizeSplineRenderMode(layer.splineRenderMode));
  mix(layer.rounding ?? 0);
  mix(layer.roundingMode || 'standard');
  mix(layer.roundingShape || 'spline');
  mix(layer.roundingCornerType || 'classic');
  mix(layer.roundingMaxRadiusDrop ?? 30);
  mix(layer.roundingSmoothSplines === true ? 1 : 0);
  mix(typeof window !== 'undefined' && window.__somataSplineFilletSteps === 8 ? 8 : 16);
  mix(typeof window !== 'undefined' && window.__somataFastFilletSweep === true ? 1 : 0);
  mix(layer.lineJoinType || 'rounded');
  mix(getConfiguredSplinePointCount());
  mix(layer.spiralEnabled === true ? 1 : 0);
  mix(layer.N ?? 0);
  mix(layer.spiralEnabled === true ? getSpiralAngularVertexCount(layer) : '');
  mix(layer.K ?? 0);
  mix(layer.customSuborbits ?? '');
  mix(layer.spiralStep ?? '');
  mix(layer.spiralStepLinked === true ? 1 : 0);
  mix(layer.spiralStepLimiterEnabled !== false ? 1 : 0);
  mix(layer.spiralStepLimiter ?? 2);
  mix(layer.spiralOrder ?? '');
  mix(Math.round((Number(layer.radius) || 0) * 1e6));
  mix(Math.round((Number(layer.radiusMultiplier) || 1) * 1e6));
  mix(Math.round((Number(layer.rotation) || 0) * 1e6));
  mix(layer.spiralTwist === true ? 1 : 0);
  mix(layer.spiralTangential === true ? 1 : 0);
  mix(Number.isFinite(layer.__spiralTangentialMix) ? layer.__spiralTangentialMix : 0);
  mix(layer.spiralRoundSeams !== false ? 1 : 0);
  mix(layer.spiralClosed !== false ? 1 : 0);
  mix(layer.closedLoop !== false ? 1 : 0);
  // One continuous canonical branch is automatically eligible when
  // transport is connected; old saved spiralOneLine flags are ignored.
  mix(Math.round((Number(layer.fourierStrength) || 0) * 1e6));
  mix(1);
  const bridge = resolveMorphCommittedSpiralSpline(layer);
  const pts = bridge?.sampled || (Array.isArray(layer.profileNodes) ? layer.profileNodes : []);
  mix(bridge ? 1 : 0);
  mix(pts.length);
  for (const q of pts) {
    mix(Math.round((Number(q?.x) || 0) * 1e6));
    mix(Math.round((Number(q?.y) || 0) * 1e6));
    mix(q?.__profileCorner === true ? 1 : 0);
    mix(q?.__profileKeyCorner === true ? 1 : 0);
    mix(q?.kind || q?.type || '');
  }
  return `${pts.length}:${h.toString(16)}`;
}
window.__spiroSpiralProfileGeometrySignature = spiralProfileGeometrySignature;

export {
  buildSpiralBezierSegments,
  repairRoundedSpiralBezierJoins,
  resolveMorphCommittedSpiralSpline,
  roundJoinedSpiralRails,
  roundSpiralRailJoins,
  sampleSmoothSpiralSplineForVariableWidth,
  spiralProfileGeometrySignature,
};
