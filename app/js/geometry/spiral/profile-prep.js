// Спираль: подготовка профиля (уплотнение, изломы, скругление в итоговом пространстве, целостность точек).
import '../../ui/profile-topology-badge.js'; // initialisation order: this module runs after it
import { centripetalSplineBezierControls } from '../spline.js';
import { getConfiguredSplinePointCount } from '../profile-model.js';
import { subSplineCubic } from '../spline-rounding.js';
import {
  appendSpiralPolylineSlice,
  spiralPolylineCumulative,
  spiralPolylinePointAt,
  spiralQuadraticPoint,
} from './polyline.js';
import { copySpiralMeta, spiralDistance, spiralOrdinaryFilletCut } from './fillets.js';
import {
  getEffectiveSpiralOrder,
  getEffectiveSpiralStep,
  getSpiralAngularVertexCount,
  getSpiralClosureRatio,
  normalizeSpiralStep,
  spiralDirection,
  spiralRadialExponent,
} from './order-params.js';
import { mapProfileOntoSpiralEdge } from './carrier.js';

function densifySegmentProfileForSpiral(points, targetCount = 32, markInputCorners = true) {
  if (!Array.isArray(points) || points.length < 2) return Array.isArray(points) ? points : [];
  const target = Math.max(points.length, Math.max(8, Math.round(Number(targetCount) || 32)));
  const segCount = points.length - 1;
  const out = [];
  for (let seg = 0; seg < segCount; seg++) {
    const a = points[seg],
      b = points[seg + 1];
    const steps = Math.max(1, Math.round((target - 1) / segCount));
    for (let k = 0; k < steps; k++) {
      const t = k / steps;
      out.push({
        x: (Number(a.x) || 0) + ((Number(b.x) || 0) - (Number(a.x) || 0)) * t,
        y: (Number(a.y) || 0) + ((Number(b.y) || 0) - (Number(a.y) || 0)) * t,
        __profileCorner: markInputCorners && k === 0 && seg > 0,
      });
    }
  }
  const last = points[points.length - 1];
  out.push({ x: Number(last.x) || 0, y: Number(last.y) || 0, __profileCorner: false });
  return out;
}
function segmentProfileCornerFlags(points) {
  const pts = Array.isArray(points) ? points : [];
  return pts.map((p, idx) => {
    if (idx <= 0 || idx >= pts.length - 1) return false;
    const prev = pts[idx - 1],
      next = pts[idx + 1];
    const ax = (Number(p?.x) || 0) - (Number(prev?.x) || 0);
    const ay = (Number(p?.y) || 0) - (Number(prev?.y) || 0);
    const bx = (Number(next?.x) || 0) - (Number(p?.x) || 0);
    const by = (Number(next?.y) || 0) - (Number(p?.y) || 0);
    const al = Math.hypot(ax, ay),
      bl = Math.hypot(bx, by);
    if (al < 1e-7 || bl < 1e-7) return false;
    const cross = Math.abs((ax * by - ay * bx) / (al * bl));
    const dot = (ax * bx + ay * by) / (al * bl);
    return cross > 0.001 || dot < -0.999;
  });
}
function nearestSpiralProfileLogicalCornerFlags(sampled, authored, authoredFlags) {
  const pts = Array.isArray(sampled) ? sampled : [],
    out = pts.map(() => false);
  for (let i = 0; i < (authoredFlags?.length || 0); i++) {
    if (!authoredFlags[i]) continue;
    const a = authored?.[i];
    let best = -1,
      bestD = Infinity;
    for (let j = 0; j < pts.length; j++) {
      const dx = (Number(pts[j]?.x) || 0) - (Number(a?.x) || 0);
      const dy = (Number(pts[j]?.y) || 0) - (Number(a?.y) || 0);
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = j;
      }
    }
    if (best >= 0) out[best] = true;
  }
  return out;
}
function buildPolygonProfileSplineSamplesForSpiral(points, targetCount = 32) {
  const src = (Array.isArray(points) ? points : [])
    .filter((p) => p && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y)))
    .map((p) => ({ x: Number(p.x) || 0, y: Number(p.y) || 0 }));
  if (src.length < 2) return src;
  if (src.length === 2) {
    const a = { ...src[0] },
      b = { ...src[1] },
      dx = b.x - a.x,
      dy = b.y - a.y;
    a.__profileBezierC1X = a.x + dx / 3;
    a.__profileBezierC1Y = a.y + dy / 3;
    a.__profileBezierC2X = a.x + (dx * 2) / 3;
    a.__profileBezierC2Y = a.y + (dy * 2) / 3;
    return [a, b];
  }
  const spans = [];
  let weightTotal = 0;
  for (let i = 0; i < src.length - 1; i++) {
    const p1 = src[i],
      p2 = src[i + 1];
    const p0 = i > 0 ? src[i - 1] : { x: 2 * p1.x - p2.x, y: 2 * p1.y - p2.y };
    const p3 = i + 2 < src.length ? src[i + 2] : { x: 2 * p2.x - p1.x, y: 2 * p2.y - p1.y };
    const ctrl = centripetalSplineBezierControls(p0, p1, p2, p3, 0.5);
    const seg = { p0: { ...p1 }, c1: { ...ctrl.c1 }, c2: { ...ctrl.c2 }, p3: { ...p2 } };
    const chord = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const controlLength =
      Math.hypot(seg.c1.x - seg.p0.x, seg.c1.y - seg.p0.y) +
      Math.hypot(seg.c2.x - seg.c1.x, seg.c2.y - seg.c1.y) +
      Math.hypot(seg.p3.x - seg.c2.x, seg.p3.y - seg.c2.y);
    const weight = Math.max(1e-6, Math.max(chord, controlLength));
    spans.push({ seg, weight, pieces: 1, frac: 0 });
    weightTotal += weight;
  }
  const desired = Math.max(spans.length * 2, Math.max(1, Math.round(Number(targetCount) || 32) - 1));
  let assigned = spans.length;
  if (desired > assigned && weightTotal > 1e-9) {
    const extra = desired - assigned;
    for (const s of spans) {
      const raw = (extra * s.weight) / weightTotal;
      const whole = Math.floor(raw);
      s.pieces += whole;
      s.frac = raw - whole;
      assigned += whole;
    }
    while (assigned < desired) {
      let best = 0;
      for (let i = 1; i < spans.length; i++) if (spans[i].frac > spans[best].frac) best = i;
      spans[best].pieces++;
      spans[best].frac = -1;
      assigned++;
    }
  }
  const out = [];
  for (let si = 0; si < spans.length; si++) {
    const { seg, pieces } = spans[si];
    for (let j = 0; j < pieces; j++) {
      const sub = subSplineCubic(seg, j / pieces, (j + 1) / pieces);
      if (!out.length) out.push({ ...sub.p0 });
      const a = out[out.length - 1];
      a.__profileBezierC1X = sub.c1.x;
      a.__profileBezierC1Y = sub.c1.y;
      a.__profileBezierC2X = sub.c2.x;
      a.__profileBezierC2Y = sub.c2.y;
      a.__profileBezierSource = 'polygon-centripetal';
      out.push({ ...sub.p3 });
    }
  }
  if (out.length) {
    out[0].x = src[0].x;
    out[0].y = src[0].y;
    out[out.length - 1].x = src[src.length - 1].x;
    out[out.length - 1].y = src[src.length - 1].y;
  }
  out._spiroPolygonProfileSpline = true;
  out._spiroProfileSourceCubicCount = Math.max(0, out.length - 1);
  return out;
}
function buildSpiralProfileForDraw(
  layer,
  baseProfilePts,
  targetCount,
  roundingFrac,
  profileSpaceSplineAlreadySampled = false,
) {
  const base = (Array.isArray(baseProfilePts) ? baseProfilePts : []).map((p) => ({
    x: Number(p?.x) || 0,
    y: Number(p?.y) || 0,
  }));
  if (base.length < 2)
    return { points: base, roundingBaked: false, splineBaked: false, keyFlags: base.map(() => false) };
  const target = Math.max(base.length, Math.max(8, Math.round(Number(targetCount) || 32)));

  if (layer?.profileMode === 'spline') {
    if (profileSpaceSplineAlreadySampled === true) {
      const carried =
        Array.isArray(layer?.__lampLogicalCornerFlags) &&
        layer.__lampLogicalCornerFlags.length === base.length
          ? layer.__lampLogicalCornerFlags.map(Boolean)
          : base.map(() => false);
      return {
        points: base,
        roundingBaked: true,
        splineBaked: true,
        profileSpaceSplineBaked: true,
        polygonProfileSplineCarrier: false,
        keyFlags: carried,
      };
    }
    if (layer.roundingCornerType === 'simple') {
      // Somata 6.7: the smooth spline is constructed in final spiral
      // coordinates, not in flat profile space. Discrete uses sampled points.
      const points = layer.splineRenderMode === 'discrete'
        ? densifySegmentProfileForSpiral(base, target, false) : base;
      return { points, roundingBaked: false, splineBaked: false,
        keyFlags: points.map(() => false), legacySimpleProfile: true };
    }
    const polygonSpline = buildPolygonProfileSplineSamplesForSpiral(base, target);
    const authoredLogicalCorners = segmentProfileCornerFlags(base);
    return {
      points: polygonSpline,
      roundingBaked: true,
      splineBaked: true,
      profileSpaceSplineBaked: true,
      polygonProfileSplineCarrier: true,
      profileSourceCubicCount:
        Number(polygonSpline?._spiroProfileSourceCubicCount) || Math.max(0, polygonSpline.length - 1),

      keyFlags: nearestSpiralProfileLogicalCornerFlags(polygonSpline, base, authoredLogicalCorners),
    };
  }

  if (layer?.profileMode !== 'segments') {
    const dense = densifySegmentProfileForSpiral(base, target, false);
    return { points: dense, roundingBaked: false, splineBaked: false, keyFlags: dense.map(() => false) };
  }

  const authoredFlags = segmentProfileCornerFlags(base);
  const N = getSpiralAngularVertexCount(layer);
  const step = getEffectiveSpiralStep(layer);
  const delta = Math.abs((Math.PI * 2 * step) / N);
  const maxAngularSpan = Math.PI / 4; // <=45deg per cubic; still compact, but robust under live profile edits.
  const compact = [];
  for (let i = 0; i < base.length - 1; i++) {
    const a = base[i],
      b = base[i + 1],
      span = Math.abs((Number(b.x) || 0) - (Number(a.x) || 0));
    const pieces = Math.max(1, Math.min(6, Math.ceil((delta * span) / maxAngularSpan)));
    for (let j = 0; j < pieces; j++) {
      if (i === 0 && j === 0) compact.push({ ...a, __profileKeyCorner: authoredFlags[i] === true });
      const t = (j + 1) / pieces;
      compact.push({
        x: (Number(a.x) || 0) + ((Number(b.x) || 0) - (Number(a.x) || 0)) * t,
        y: (Number(a.y) || 0) + ((Number(b.y) || 0) - (Number(a.y) || 0)) * t,
        __profileKeyCorner: j === pieces - 1 && authoredFlags[i + 1] === true,
      });
    }
  }
  if (compact.length < 2)
    return {
      points: base,
      roundingBaked: false,
      splineBaked: false,
      keyFlags: base.map((_, i) => authoredFlags[i] === true),
    };
  return {
    points: compact,
    roundingBaked: false,
    splineBaked: false,
    keyFlags: compact.map((p) => p.__profileKeyCorner === true),
    authoredCornerCount: authoredFlags.filter(Boolean).length,
    compactBezierProfile: true,
  };
}
// CPU Morph and Static must begin corner rounding from the same compact
// authored segment profile. The old CPU fallback densified every segment
// uniformly; that moved fillet locations on the handoff to Static.
window.__spiroPrepareRoundedSegmentMorphProfile = (points, angularN, step) => {
  const n = Math.max(2, Number(angularN) || 4),
    k = Math.max(1e-9, Number(step) || 1);
  return buildSpiralProfileForDraw(
    {
      profileMode: 'segments',
      spiralEnabled: true,
      spiralOrder: 1,
      N: Math.round(n),
      __spiralAnimatedN: n,
      K: Math.max(1, Math.round(k)),
      spiralStep: k,
      spiralStepLinked: false,
    },
    points,
    Math.max(points?.length || 2, getConfiguredSplinePointCount()),
    1,
  ).points;
};
const spiralFinalSpaceProfileRoundStats = {
  calls: 0,
  corners: 0,
  roundedCorners: 0,
  hardSeamPreserved: 0,
  collisionLimits: 0,
  maxRequestedCut: 0,
  maxAppliedCut: 0,
  lastCuts: [],
  globalWarpPasses: 0,
};
function spiralProfileCornerArcLayout(points, flags) {
  const metrics = spiralPolylineCumulative(points);
  const cornerIndices = [];
  for (let i = 1; i < points.length - 1; i++) if (flags?.[i]) cornerIndices.push(i);
  const anchors = [0, ...cornerIndices, points.length - 1];
  const anchorDistances = anchors.map((i) => metrics.cum[i]);
  return { metrics, cornerIndices, anchors, anchorDistances };
}
function allocateSpiralProfileFilletCuts(points, flags, strength) {
  const src = Array.isArray(points) ? points : [];
  const s = Math.max(0, Math.min(2, Number(strength) || 0));
  const layout = spiralProfileCornerArcLayout(src, flags);
  const cuts = new Map();
  const cornerSet = new Set(layout.cornerIndices);

  for (let ai = 1; ai < layout.anchors.length - 1; ai++) {
    const idx = layout.anchors[ai];
    if (!cornerSet.has(idx)) continue;
    const leftSpan = layout.anchorDistances[ai] - layout.anchorDistances[ai - 1];
    const rightSpan = layout.anchorDistances[ai + 1] - layout.anchorDistances[ai];
    const requested = spiralOrdinaryFilletCut(leftSpan, rightSpan, s);
    cuts.set(idx, requested);
    spiralFinalSpaceProfileRoundStats.maxRequestedCut = Math.max(
      spiralFinalSpaceProfileRoundStats.maxRequestedCut,
      requested,
    );
  }

  for (let pass = 0; pass < 8; pass++) {
    let changed = false;
    for (let ai = 0; ai < layout.anchors.length - 1; ai++) {
      const leftIdx = layout.anchors[ai],
        rightIdx = layout.anchors[ai + 1];
      const span = Math.max(0, layout.anchorDistances[ai + 1] - layout.anchorDistances[ai]);
      if (span <= 1e-9) continue;
      const leftCut = cornerSet.has(leftIdx) ? cuts.get(leftIdx) || 0 : 0;
      const rightCut = cornerSet.has(rightIdx) ? cuts.get(rightIdx) || 0 : 0;
      const usage = leftCut + rightCut;
      const cap = span * 0.999;
      if (usage > cap + 1e-9) {
        const k = cap / usage;
        if (cornerSet.has(leftIdx)) cuts.set(leftIdx, leftCut * k);
        if (cornerSet.has(rightIdx)) cuts.set(rightIdx, rightCut * k);
        spiralFinalSpaceProfileRoundStats.collisionLimits++;
        changed = true;
      }
    }
    if (!changed) break;
  }
  return { ...layout, cuts };
}
function appendSpiralProfileFillet(out, a, corner, b, steps, cornerIndex, cut, meta) {
  const n = Math.max(5, Math.min(28, Math.round(Number(steps) || 10)));
  if (!out.length || spiralDistance(out[out.length - 1], a) > 1e-7) {
    const p = copySpiralMeta({ ...a }, meta);
    p.__spiralProfileFinalRound = true;
    p.__spiralProfileFillet = true;
    p.__spiralProfileCornerIndex = cornerIndex;
    p.__spiralProfileCut = cut;
    out.push(p);
  } else {
    const p = out[out.length - 1];
    copySpiralMeta(p, meta);
    p.__spiralProfileFinalRound = true;
    p.__spiralProfileFillet = true;
    p.__spiralProfileCornerIndex = cornerIndex;
    p.__spiralProfileCut = cut;
  }
  for (let i = 1; i <= n; i++) {
    const q = spiralQuadraticPoint(a, corner, b, i / n);
    copySpiralMeta(q, meta);
    q.__spiralProfileFinalRound = true;
    q.__spiralProfileFillet = true;
    q.__spiralProfileCornerIndex = cornerIndex;
    if (i === Math.round(n / 2)) q.__profileLampAnchorIndex = corner.ptIdx ?? cornerIndex;
    q.__spiralProfileCut = cut;
    out.push(q);
  }
}
function applySpiralFinalSpaceProfileRounding(points, roundingStrength = 0) {
  const src = (Array.isArray(points) ? points : []).map((p) => ({ ...p }));
  const strength = Math.max(0, Math.min(2, Number(roundingStrength) || 0));
  if (src.length < 3 || strength <= 0.001) return src;

  const flags = src.map((p, i) => i > 0 && i < src.length - 1 && p?.__profileCorner === true);
  const cornerCount = flags.filter(Boolean).length;
  spiralFinalSpaceProfileRoundStats.calls++;
  spiralFinalSpaceProfileRoundStats.corners += cornerCount;
  if (!cornerCount) return src;

  const allocation = allocateSpiralProfileFilletCuts(src, flags, strength);
  const { metrics, cornerIndices, cuts } = allocation;
  const meta = src[0],
    out = [];
  let cursor = 0,
    roundedCount = 0;
  const cutsForStatus = [];

  for (const idx of cornerIndices) {
    const cut = Math.max(0, cuts.get(idx) || 0);
    if (cut <= 1e-7) continue;
    const d = metrics.cum[idx];
    const inD = Math.max(cursor, d - cut),
      outD = Math.min(metrics.total, d + cut);
    if (outD <= inD + 1e-8) continue;

    appendSpiralPolylineSlice(out, src, metrics, cursor, inD);
    const a = spiralPolylinePointAt(src, metrics, inD);
    const b = spiralPolylinePointAt(src, metrics, outD);
    appendSpiralProfileFillet(out, a, src[idx], b, 8 + Math.ceil(8 * strength), idx, cut, meta);
    cursor = outD;
    roundedCount++;
    cutsForStatus.push({ index: idx, cut });
    spiralFinalSpaceProfileRoundStats.maxAppliedCut = Math.max(
      spiralFinalSpaceProfileRoundStats.maxAppliedCut,
      cut,
    );
  }
  appendSpiralPolylineSlice(out, src, metrics, cursor, metrics.total);

  if (!out.length) return src;
  for (const p of out) copySpiralMeta(p, meta);

  out[0] = { ...out[0], x: src[0].x, y: src[0].y, widthScale: src[0].widthScale };
  out[out.length - 1] = {
    ...out[out.length - 1],
    x: src[src.length - 1].x,
    y: src[src.length - 1].y,
    widthScale: src[src.length - 1].widthScale,
  };
  copySpiralMeta(out[0], meta);
  copySpiralMeta(out[out.length - 1], meta);

  spiralFinalSpaceProfileRoundStats.roundedCorners += roundedCount;
  spiralFinalSpaceProfileRoundStats.hardSeamPreserved++;
  spiralFinalSpaceProfileRoundStats.lastCuts = cutsForStatus;

  spiralFinalSpaceProfileRoundStats.globalWarpPasses = 0;
  return out;
}
function getSpiralRenderSampleCount(layer, baseCount = 2) {
  const N = getSpiralAngularVertexCount(layer);
  const step = Math.abs(getEffectiveSpiralStep(layer));
  const angularSpan = Math.abs((Math.PI * 2 * step) / N);
  const angularSamples = Math.ceil(angularSpan / (Math.PI / 24)) + 1;
  return Math.max(Number(baseCount) || 2, Math.min(48, Math.max(16, angularSamples)));
}
function rotateSpiralPoint(p, angle, scale = 1) {
  const x = Number(p?.x) || 0,
    y = Number(p?.y) || 0;
  const c = Math.cos(angle),
    ss = Math.sin(angle);
  return { x: (x * c - y * ss) * scale, y: (x * ss + y * c) * scale };
}
// Render-only transition strength: the saved setting remains boolean.
// Both the authored polygonal and tangential carriers share endpoints;
// interpolate their positions AND derivatives, not their whole paths.
function getSpiralTangentialBlend(layer) {
  if (!layer || Math.abs(getEffectiveSpiralOrder(layer)) <= 1e-8) return 0;
  const v = layer.__spiralTangentialMix;
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : layer.spiralTangential === true ? 1 : 0;
}
const spiralEdgeIntegrityStats = {
  checks: 0,
  roundedFallbacks: 0,
  baselineFallbacks: 0,
  hardRepairs: 0,
  lastReason: '',
};
function isFiniteGeometryPoint(p) {
  return Boolean(p && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y)));
}
function validateSpiralEdgePoints(points) {
  spiralEdgeIntegrityStats.checks++;
  const pts = Array.isArray(points) ? points : [];
  if (pts.length < 2) return { ok: false, reason: 'point-count' };
  let nonDegenerate = 0,
    last = null;
  for (const p of pts) {
    const x = Number(p?.x),
      y = Number(p?.y),
      w = Number(p?.widthScale);
    if (!isFiniteGeometryPoint(p) || !Number.isFinite(w) || w <= 0)
      return { ok: false, reason: 'non-finite' };
    if (last && Math.hypot(x - last.x, y - last.y) > 1e-7) nonDegenerate++;
    last = { x, y };
  }
  if (nonDegenerate < 1) return { ok: false, reason: 'collapsed' };
  return { ok: true, reason: '' };
}
function repairSpiralEdgePoints(
  points,
  rawPoints,
  P,
  edgeIndex,
  R,
  order,
  tangential,
  spiralStep,
  polygonN,
  spiralClosed,
  graph = null,
) {
  let v = validateSpiralEdgePoints(points);
  if (v.ok) return points;
  spiralEdgeIntegrityStats.lastReason = v.reason;
  v = validateSpiralEdgePoints(rawPoints);
  if (v.ok) {
    spiralEdgeIntegrityStats.roundedFallbacks++;
    return rawPoints;
  }
  const safe = mapProfileOntoSpiralEdge(
    [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ],
    P,
    edgeIndex,
    R,
    order,
    tangential,
    null,
    spiralStep,
    polygonN,
    spiralClosed,
    0,
    null,
    null,
    graph,
  );
  v = validateSpiralEdgePoints(safe);
  if (v.ok) {
    spiralEdgeIntegrityStats.baselineFallbacks++;
    return safe;
  }
  const N = Math.max(2, Number(polygonN) || P.length),
    step = normalizeSpiralStep(spiralStep, N),
    direction = spiralDirection(order) * (graph?.twist ?? 1),
    delta = ((Math.PI * 2 * step) / N) * direction,
    targetScale = Math.pow(Math.max(1.0000001, getSpiralClosureRatio()), spiralRadialExponent(order));
  const p0 = P[edgeIndex % P.length] || { x: 0, y: 0 },
    p1 = rotateSpiralPoint(p0, delta, targetScale);
  spiralEdgeIntegrityStats.hardRepairs++;
  return [
    {
      x: Number(p0.x) || 0,
      y: Number(p0.y) || 0,
      widthScale: 1,
      ptIdx: 0,
      __spiralDelta: delta,
      __spiralTargetScale: targetScale,
      __spiralClosed: spiralClosed !== false,
      __spiralTangential: tangential === true,
    },
    {
      x: Number(p1.x) || 0,
      y: Number(p1.y) || 0,
      widthScale: targetScale,
      ptIdx: 1,
      __spiralDelta: delta,
      __spiralTargetScale: targetScale,
      __spiralClosed: spiralClosed !== false,
      __spiralTangential: tangential === true,
    },
  ];
}

export {
  applySpiralFinalSpaceProfileRounding,
  buildSpiralProfileForDraw,
  densifySegmentProfileForSpiral,
  getSpiralRenderSampleCount,
  getSpiralTangentialBlend,
  isFiniteGeometryPoint,
  nearestSpiralProfileLogicalCornerFlags,
  repairSpiralEdgePoints,
  rotateSpiralPoint,
  segmentProfileCornerFlags,
  validateSpiralEdgePoints,
};
