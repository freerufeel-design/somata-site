// Спираль: скругления внутренних и периодических стыков, автозамыкание.
import './polyline.js'; // initialisation order: this module runs after it
import {
  appendSpiralPolylineSlice,
  spiralPolylineCumulative,
  spiralPolylinePointAt,
  spiralQuadraticPoint,
  transformSpiralCopyPoint,
} from './polyline.js';
import { isFiniteGeometryPoint } from './profile-prep.js';

const spiralUnifiedRoundingStats = {
  calls: 0,
  bridges: 0,
  continuousPeriods: 0,
  detectedKinks: 0,
  roundedKinks: 0,
  tangentialCalls: 0,
  tangentialRoundedKinks: 0,
  continuousEndpointKinks: 0,
  continuousEndpointRounded: 0,
  lastBridgeLength: 0,
  lastAngles: [],
};
function spiralOrdinaryFilletCut(inSpan, outSpan, roundingStrength) {
  const a = Math.max(0, Number(inSpan) || 0),
    b = Math.max(0, Number(outSpan) || 0);

  const r = Math.max(0, Math.min(2, Number(roundingStrength) || 0));
  return 0.5 * Math.min(a, b) * r;
}
function spiralTurnAngleDeg(a, b, c) {
  if (!a || !b || !c) return 0;
  const ux = (Number(b.x) || 0) - (Number(a.x) || 0),
    uy = (Number(b.y) || 0) - (Number(a.y) || 0);
  const vx = (Number(c.x) || 0) - (Number(b.x) || 0),
    vy = (Number(c.y) || 0) - (Number(b.y) || 0);
  const ul = Math.hypot(ux, uy),
    vl = Math.hypot(vx, vy);
  if (ul < 1e-8 || vl < 1e-8) return 0;
  const dot = Math.max(-1, Math.min(1, (ux * vx + uy * vy) / (ul * vl)));
  return (Math.acos(dot) * 180) / Math.PI;
}
function spiralVectorTurnAngleDeg(ax, ay, bx, by) {
  const al = Math.hypot(ax, ay),
    bl = Math.hypot(bx, by);
  if (al < 1e-9 || bl < 1e-9) return null;
  const dot = Math.max(-1, Math.min(1, (ax * bx + ay * by) / (al * bl)));
  return (Math.acos(dot) * 180) / Math.PI;
}
function spiralExactTangentialSeamAngleDeg(points, delta, scale) {
  const src = Array.isArray(points) ? points : [];
  if (src.length < 2 || src[0]?.__spiralTangential !== true) return null;
  const first = src[0],
    last = src[src.length - 1];
  const sx = Number(first?.__spiralBezierOutTx),
    sy = Number(first?.__spiralBezierOutTy);
  const ex = Number(last?.__spiralBezierInTx),
    ey = Number(last?.__spiralBezierInTy);
  if (![sx, sy, ex, ey].every(Number.isFinite)) return null;
  const c = Math.cos(delta),
    q = Math.sin(delta),
    k = Math.max(1e-9, Number(scale) || 1);
  const expectedX = (c * sx - q * sy) * k,
    expectedY = (q * sx + c * sy) * k;
  return spiralVectorTurnAngleDeg(ex, ey, expectedX, expectedY);
}
function spiralDistance(a, b) {
  if (!a || !b) return Infinity;
  return Math.hypot((Number(a.x) || 0) - (Number(b.x) || 0), (Number(a.y) || 0) - (Number(b.y) || 0));
}
function spiralDistinctPoint(points, startIndex, step, reference, eps = 1e-7) {
  const src = Array.isArray(points) ? points : [];
  for (let i = startIndex; i >= 0 && i < src.length; i += step) {
    const p = src[i];
    if (p && isFiniteGeometryPoint(p) && spiralDistance(p, reference) > eps) return p;
  }
  return null;
}
function spiralEndpointTangentContext(src, delta, scale) {
  const points = Array.isArray(src) ? src : [];
  if (points.length < 2) return null;
  const start = points[0],
    end = points[points.length - 1];
  const prev = points.map((p) => transformSpiralCopyPoint(p, delta, scale, -1));
  const next = points.map((p) => transformSpiralCopyPoint(p, delta, scale, 1));
  const prevEnd = prev[prev.length - 1],
    nextStart = next[0];

  const startIncoming =
    spiralDistance(prevEnd, start) <= 1e-7 ? spiralDistinctPoint(prev, prev.length - 2, -1, start) : prevEnd;
  const startOutgoing = spiralDistinctPoint(points, 1, 1, start);

  const endIncoming = spiralDistinctPoint(points, points.length - 2, -1, end);
  const endOutgoing =
    spiralDistance(end, nextStart) <= 1e-7 ? spiralDistinctPoint(next, 1, 1, end) : nextStart;

  return {
    prev,
    next,
    start,
    end,
    prevEnd,
    nextStart,
    startIncoming,
    startOutgoing,
    endIncoming,
    endOutgoing,
  };
}
function copySpiralMeta(dst, src) {
  if (!dst || !src) return dst;
  dst.__spiralDelta = Number(src.__spiralDelta) || 0;
  dst.__spiralTargetScale = Math.max(1e-6, Number(src.__spiralTargetScale) || 1);
  dst.__spiralClosed = src.__spiralClosed === true;
  dst.__spiralTangential = src.__spiralTangential === true;
  dst.__spiralRoundSeams = src.__spiralRoundSeams !== false;
  return dst;
}
function appendSpiralQuadraticFillet(out, a, corner, b, steps, tag, meta) {
  const n = Math.max(4, Math.min(20, Math.round(Number(steps) || 10)));
  if (
    !out.length ||
    Math.hypot(
      (Number(out[out.length - 1]?.x) || 0) - (Number(a?.x) || 0),
      (Number(out[out.length - 1]?.y) || 0) - (Number(a?.y) || 0),
    ) > 1e-7
  ) {
    const p = copySpiralMeta({ ...a }, meta);
    p.__spiralClosureProtected = true;
    p.__spiralClosureFillet = tag;
    out.push(p);
  } else {
    const p = out[out.length - 1];
    copySpiralMeta(p, meta);
    p.__spiralClosureProtected = true;
    p.__spiralClosureFillet = tag;
  }
  for (let i = 1; i <= n; i++) {
    const q = spiralQuadraticPoint(a, corner, b, i / n);
    copySpiralMeta(q, meta);
    q.__spiralClosureProtected = true;
    q.__spiralClosureFillet = tag;
    out.push(q);
  }
}
function applySpiralInteriorFillet(points, cornerIndex, roundingFrac, tag = 'profile-end') {
  const src = Array.isArray(points) ? points : [];
  if (src.length < 3 || cornerIndex <= 0 || cornerIndex >= src.length - 1) return src;
  const meta = src[0];
  const metrics = spiralPolylineCumulative(src),
    d = metrics.cum[cornerIndex];
  const inSpan = d,
    outSpan = metrics.total - d,
    cut = spiralOrdinaryFilletCut(inSpan, outSpan, roundingFrac);
  if (cut <= 1e-7) return src;
  const inPt = spiralPolylinePointAt(src, metrics, d - cut);
  const outPt = spiralPolylinePointAt(src, metrics, d + cut);
  const out = [];
  appendSpiralPolylineSlice(out, src, metrics, 0, d - cut);
  appendSpiralQuadraticFillet(
    out,
    inPt,
    src[cornerIndex],
    outPt,
    10 + Math.ceil(8 * Math.min(1, roundingFrac)),
    tag,
    meta,
  );
  appendSpiralPolylineSlice(out, src, metrics, d + cut, metrics.total);

  for (const p of out) copySpiralMeta(p, meta);
  return out;
}
function applySpiralPeriodicEndpointFillet(points, roundingFrac, spans, tag = 'period-seam') {
  const src = Array.isArray(points) ? points : [];
  if (src.length < 3 || src[0]?.__spiralClosed !== true) return src;
  const delta = Number(src[0]?.__spiralDelta) || 0,
    scale = Math.max(1e-6, Number(src[0]?.__spiralTargetScale) || 1);
  const prev = src.map((p) => transformSpiralCopyPoint(p, delta, scale, -1));
  const next = src.map((p) => transformSpiralCopyPoint(p, delta, scale, 1));
  const pm = spiralPolylineCumulative(prev),
    cm = spiralPolylineCumulative(src),
    nm = spiralPolylineCumulative(next);
  if (cm.total <= 1e-8) return src;

  let cutStart = spiralOrdinaryFilletCut(spans?.startIncoming, spans?.startOutgoing, roundingFrac);
  let cutEnd = spiralOrdinaryFilletCut(spans?.endIncoming, spans?.endOutgoing, roundingFrac);
  const total = cutStart + cutEnd;
  if (total > cm.total * 0.9995) {
    const k = (cm.total * 0.9995) / Math.max(1e-12, total);
    cutStart *= k;
    cutEnd *= k;
  }
  if (cutStart <= 1e-7 && cutEnd <= 1e-7) return src;

  const a0 = spiralPolylinePointAt(prev, pm, Math.max(0, pm.total - cutStart));
  const v0 = { ...src[0] },
    b0 = spiralPolylinePointAt(src, cm, Math.min(cm.total, cutStart));
  const a1 = spiralPolylinePointAt(src, cm, Math.max(0, cm.total - cutEnd));
  const v1 = { ...src[src.length - 1] },
    b1 = spiralPolylinePointAt(next, nm, Math.min(nm.total, cutEnd));
  const out = [],
    steps = Math.max(8, Math.min(24, Math.ceil(8 + Math.min(1, roundingFrac) * 16)));

  for (let i = 0; i <= steps; i++) {
    const u = i / steps,
      t = 0.5 + 0.5 * u * u,
      q = spiralQuadraticPoint(a0, v0, b0, t);
    copySpiralMeta(q, src[0]);
    q.__spiralClosureProtected = true;
    q.__spiralClosureFillet = tag;
    out.push(q);
  }
  appendSpiralPolylineSlice(out, src, cm, cutStart, cm.total - cutEnd);

  if (out.length) {
    const p = out[out.length - 1];
    copySpiralMeta(p, src[0]);
    p.__spiralClosureProtected = true;
    p.__spiralClosureFillet = tag;
  }

  for (let i = 1; i <= steps; i++) {
    const u = i / steps,
      t = 0.5 - 0.5 * (1 - u) * (1 - u),
      q = spiralQuadraticPoint(a1, v1, b1, t);
    copySpiralMeta(q, src[0]);
    q.__spiralClosureProtected = true;
    q.__spiralClosureFillet = tag;
    out.push(q);
  }
  return out;
}
function buildClosedSpiralAutoCloseGeometry(
  rawPoints,
  roundingFrac = 0,
  roundSeams = true,
  windingWeight = 1,
) {
  const src = (Array.isArray(rawPoints) ? rawPoints : [])
    .filter(isFiniteGeometryPoint)
    .map((p) => ({ ...p }));
  if (src.length < 2) return src;
  spiralUnifiedRoundingStats.calls++;
  const meta = src[0],
    delta = Number(meta.__spiralDelta) || 0,
    scale = Math.max(1e-6, Number(meta.__spiralTargetScale) || 1);
  const tangential = meta.__spiralTangential === true;
  if (tangential) spiralUnifiedRoundingStats.tangentialCalls++;

  const profileMetrics = spiralPolylineCumulative(src),
    profileSpan = Math.max(1e-9, profileMetrics.total);
  const nextStart = transformSpiralCopyPoint(src[0], delta, scale, 1);
  if (windingWeight < 1) {
    // Corridor connectors are not polygon edges. At zero winding
    // their length must vanish, including on the two end spans.
    const end = src.at(-1);
    nextStart.x = end.x + (nextStart.x - end.x) * windingWeight;
    nextStart.y = end.y + (nextStart.y - end.y) * windingWeight;
    nextStart.widthScale = end.widthScale + (nextStart.widthScale - end.widthScale) * windingWeight;
  }
  const bridgeLength = Math.hypot(
    (Number(nextStart.x) || 0) - (Number(src[src.length - 1].x) || 0),
    (Number(nextStart.y) || 0) - (Number(src[src.length - 1].y) || 0),
  );
  spiralUnifiedRoundingStats.lastBridgeLength = bridgeLength;
  const bridgeEps = Math.max(1e-6, profileSpan * 1e-5);
  const hasBridge = bridgeLength > bridgeEps;
  if (hasBridge) spiralUnifiedRoundingStats.bridges++;
  else spiralUnifiedRoundingStats.continuousPeriods++;

  let period = src;
  let bridgeCornerIndex = -1;
  if (hasBridge) {
    bridgeCornerIndex = period.length - 1;
    const q = copySpiralMeta({ ...nextStart }, meta);
    q.__spiralAutoCloseBridgeEnd = true;
    period = [...period, q];
  }

  for (const p of period) p.__spiralExplicitBridge = true;
  // The "Round seams" checkbox enables only connector-corner fillets.
  // Their strength always equals the authored vertex rounding;
  // 0% remains a perfectly sharp bridge. Never impose a minimum.
  // Fillets are baked into endpoint curves before Morph begins.
  if (!roundSeams) {
    for (const p of period) {
      delete p.__spiralClosureProtected;
      delete p.__spiralClosureFillet;
      delete p.__spiralSeamRoundFraction;
      p.__spiralRoundSeams = false;
    }
    return period;
  }
  // Round seams only permits the SAME rounding strength as vertices.
  // At 0% the connecting bridge stays sharp even when checked.
  const amount = Math.max(0, Math.min(2, Number(roundingFrac) || 0)) * windingWeight;
  if (amount <= 0.001) return period;

  const tangentCtx = spiralEndpointTangentContext(src, delta, scale);

  const exactTangentialSeamAngle =
    !hasBridge && tangential ? spiralExactTangentialSeamAngleDeg(src, delta, scale) : null;
  const seamAngle = Number.isFinite(exactTangentialSeamAngle)
    ? exactTangentialSeamAngle
    : tangentCtx?.startIncoming && tangentCtx?.startOutgoing
      ? spiralTurnAngleDeg(tangentCtx.startIncoming, src[0], tangentCtx.startOutgoing)
      : 0;
  const bridgeAngle =
    hasBridge && tangentCtx?.endIncoming
      ? spiralTurnAngleDeg(tangentCtx.endIncoming, src[src.length - 1], nextStart)
      : 0;
  const nextStartAngle =
    hasBridge && tangentCtx?.endOutgoing
      ? spiralTurnAngleDeg(src[src.length - 1], nextStart, tangentCtx.endOutgoing)
      : seamAngle;
  spiralUnifiedRoundingStats.lastAngles = [seamAngle, bridgeAngle, nextStartAngle];

  const kinkThreshold = 0.75;
  if (hasBridge && bridgeAngle > kinkThreshold) {
    spiralUnifiedRoundingStats.detectedKinks++;
    period = applySpiralInteriorFillet(period, bridgeCornerIndex, amount, 'bridge-start');
    spiralUnifiedRoundingStats.roundedKinks++;
    if (tangential) spiralUnifiedRoundingStats.tangentialRoundedKinks++;
  }

  const seamIsKink = Math.max(seamAngle, nextStartAngle) > kinkThreshold;
  if (seamIsKink) {
    spiralUnifiedRoundingStats.detectedKinks++;
    if (!hasBridge) spiralUnifiedRoundingStats.continuousEndpointKinks++;
    const prevBridgeLength = hasBridge ? bridgeLength / scale : profileSpan / scale;
    const nextProfileSpan = profileSpan * scale;
    period = applySpiralPeriodicEndpointFillet(
      period,
      amount,
      {
        startIncoming: prevBridgeLength,
        startOutgoing: profileSpan,
        endIncoming: hasBridge ? bridgeLength : profileSpan,
        endOutgoing: nextProfileSpan,
      },
      hasBridge ? 'bridge-end' : 'period-seam',
    );
    spiralUnifiedRoundingStats.roundedKinks++;
    if (!hasBridge) spiralUnifiedRoundingStats.continuousEndpointRounded++;
    if (tangential) spiralUnifiedRoundingStats.tangentialRoundedKinks++;
  }

  for (const p of period) p.__spiralExplicitBridge = true;
  return period;
}

export { buildClosedSpiralAutoCloseGeometry, copySpiralMeta, spiralDistance, spiralOrdinaryFilletCut };
