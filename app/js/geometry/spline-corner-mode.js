import './unified-fillet.js'; // initialisation order: this module runs after it
import { somataDrawFullRoundingCircle } from './unified-fillet.js';
import { drawSimplePolyline } from './polyline-rounding.js';
import { drawSimpleSpline } from './spline-rounding.js';
import { somataWithFourierLayer } from '../core/state.js';

function somataDrawSplineCornerMode(ctx, raw, closed, rounding, options = {}) {
  if (!ctx || typeof ctx.bezierCurveTo !== 'function' || !Array.isArray(raw) || raw.length < 2) return false;

  const pts =
    options.prevalidated === true
      ? raw
      : raw.filter((p) => p && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y)));
  if (pts.length < 2) return false;
  const value = Math.max(0, Math.min(2, Number(rounding) || 0));

  // The 6.7 method is not a Spline+ variant. Dispatch before its
  // sharp-junction and radial/local policies, including at zero rounding.
  if (options.layer?.roundingCornerType === 'simple') {
    const flags = options.cornerFlags?.length === pts.length
      ? options.cornerFlags
      : pts.map((_, i) => Boolean(closed) || (i > 0 && i < pts.length - 1));
    if (options.baseSplineBlend === 0 || options.layer?.splineRenderMode === 'discrete' ||
        (options.layer?.profileMode !== 'spline' && options.baseSplineBlend !== 1))
      somataWithFourierLayer(options.layer, () => drawSimplePolyline(ctx, pts, Boolean(closed), value, flags));
    else
      somataWithFourierLayer(options.layer, () => drawSimpleSpline(ctx, pts, Boolean(closed), value, options.cornerFlags || [], options.bridgeRoundFlags || []));
    return true;
  }
  if (options.sharpJunctions === true && value <= 1e-10) {
    return somataDrawSharpJunctionSplinePlus(
      ctx,
      pts,
      Boolean(closed),
      options.baseSplineBlend,
      options.cornerFlags,
      options.duplicateStable === true,
      options.layer,
    );
  }

  const draw =
    options.layer?.roundingCornerType === 'local'
      ? somataDrawLocalSplineRounding
      : somataDrawRadialSplineRounding;
  return draw(ctx, pts, Boolean(closed), value, options.layer, options.duplicateStable === true);
}

function somataDrawSharpJunctionSplinePlus(
  ctx,
  pts,
  closed,
  splineBlend = 1,
  cornerFlags = [],
  duplicateStable = false,
  layer = null,
) {
  const n = pts.length,
    edges = closed ? n : n - 1;
  if (n < 2) return false;
  const clamp = (t) => Math.max(0, Math.min(1, Number(t) || 0));
  const b = clamp(splineBlend === undefined ? 1 : splineBlend);
  const mix = b * b * b * (b * (6 * b - 15) + 10);
  const flags = Array.isArray(cornerFlags) ? cornerFlags : [];
  ctx.moveTo(pts[0].x, pts[0].y);
  if (mix <= 1e-12 || n === 2) {
    for (let i = 1; i < n; i++) ctx.lineTo(pts[i].x, pts[i].y);
    if (closed) ctx.closePath();
    return true;
  }
  const tangents = new Array(n);
  for (let i = 0; i < n; i++) {
    const prev = pts[i === 0 && !closed ? 0 : (i - 1 + n) % n];
    const next = pts[i === n - 1 && !closed ? n - 1 : (i + 1) % n];
    const dx = next.x - prev.x,
      dy = next.y - prev.y;
    const length = Math.hypot(dx, dy);
    tangents[i] = length > 1e-12 ? { x: dx / length, y: dy / length } : { x: 0, y: 0 };
  }
  if (duplicateStable && typeof somataStabilizeSplineDuplicateTangents === 'function' && n > 2) {
    let total = 0;
    for (let i = 0; i < edges; i++) {
      const p = pts[i],
        q = pts[(i + 1) % n];
      total += Math.hypot(q.x - p.x, q.y - p.y);
    }
    const radius = Number(layer?.radius) * Number(layer?.radiusMultiplier ?? 1);
    const sides = Math.round(Number(layer?.N));
    const baseEdge =
      radius > 0 && sides >= 3 ? 2 * radius * Math.sin(Math.PI / sides) : total / Math.max(2, edges);
    const native = tangents.map((t) => ({ ...t }));
    somataStabilizeSplineDuplicateTangents(pts, pts, tangents, native, closed, baseEdge);
  }
  for (let i = 0; i < edges; i++) {
    const j = (i + 1) % n,
      p = pts[i],
      q = pts[j];
    const dx = q.x - p.x,
      dy = q.y - p.y;
    const chord = Math.hypot(dx, dy);
    const line1x = p.x + dx / 3,
      line1y = p.y + dy / 3;
    const line2x = q.x - dx / 3,
      line2y = q.y - dy / 3;
    const out = flags[i] === true ? { x: dx / (chord || 1), y: dy / (chord || 1) } : tangents[i];
    const inc = flags[j] === true ? { x: dx / (chord || 1), y: dy / (chord || 1) } : tangents[j];
    const h = chord * 0.28;
    const curve1x = p.x + out.x * h,
      curve1y = p.y + out.y * h;
    const curve2x = q.x - inc.x * h,
      curve2y = q.y - inc.y * h;
    ctx.bezierCurveTo(
      line1x + (curve1x - line1x) * mix,
      line1y + (curve1y - line1y) * mix,
      line2x + (curve2x - line2x) * mix,
      line2y + (curve2y - line2y) * mix,
      q.x,
      q.y,
    );
  }
  if (closed) ctx.closePath();
  return true;
}

function somataStabilizeSplineOpenEndpointKnots(points, knots, baseEdge) {
  const n = points.length;
  if (n < 3) return;
  const lengths = new Float64Array(n - 1);
  let maxEdge = 0;
  for (let i = 0; i < n - 1; i++) {
    lengths[i] = Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y);
    maxEdge = Math.max(maxEdge, lengths[i]);
  }
  const threshold = Math.min(Math.max(0, Number(baseEdge) || 0) * 0.14, maxEdge * 0.35);
  if (!(threshold > 1e-12)) return;
  const stabilize = (atStart) => {
    let count = 0,
      maxShort = 0;
    while (count < n - 2) {
      const edge = atStart ? count : n - 2 - count;
      if (lengths[edge] >= threshold) break;
      maxShort = Math.max(maxShort, lengths[edge]);
      count++;
    }
    if (count === 0) return;
    const outer = atStart ? lengths[count] : lengths[n - 2 - count];
    const margin = Math.min(threshold, outer * 0.2);
    if (!(margin > 1e-12 && maxShort < margin)) return;
    const q = 1 - maxShort / margin,
      w = q * q * (3 - 2 * q);
    const endpoint = atStart ? knots[0] : knots[n - 1];
    for (let k = 1; k <= count; k++) {
      const knot = knots[atStart ? k : n - 1 - k];
      knot.x += (endpoint.x - knot.x) * w;
      knot.y += (endpoint.y - knot.y) * w;
    }
  };
  stabilize(true);
  stabilize(false);
}

function somataStabilizeSplineDuplicateTangents(points, knots, tangents, nativeTangents, closed, baseEdge) {
  const n = points.length,
    edgeCount = closed ? n : n - 1;
  if (n < 3) return;
  const edgeLengths = new Float64Array(edgeCount);
  let maxEdge = 0;
  for (let i = 0; i < edgeCount; i++) {
    const a = points[i],
      b = points[(i + 1) % n];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    edgeLengths[i] = length;
    if (length > maxEdge) maxEdge = length;
  }

  const threshold = Math.min(Math.max(0, Number(baseEdge) || 0) * 0.14, maxEdge * 0.35);
  if (!(threshold > 1e-12)) return;
  let startVertex = 0;
  if (closed) {
    let anchor = -1;
    for (let i = 0; i < n; i++)
      if (edgeLengths[i] >= threshold) {
        anchor = i;
        break;
      }
    if (anchor < 0) return;
    startVertex = (anchor + 1) % n;
  }
  const vertex = (k) => (closed ? (startVertex + k) % n : k);
  const segment = (k) => edgeLengths[vertex(k)];
  let pos = 0;
  while (pos < n) {
    const first = pos;
    let largestShort = 0;
    while (pos < n - 1 && segment(pos) < threshold) {
      largestShort = Math.max(largestShort, segment(pos));
      pos++;
    }
    const last = pos;
    if (last > first) {
      const before = first > 0 || closed ? vertex((first - 1 + n) % n) : -1;
      const after = last < n - 1 || closed ? vertex((last + 1) % n) : -1;
      const inbound = before >= 0 ? edgeLengths[before] : Infinity;
      const outbound = after >= 0 ? edgeLengths[vertex(last)] : Infinity;
      const support = Math.min(inbound, outbound);

      const margin = Math.min(threshold, support * 0.2);
      if (margin > 1e-12 && largestShort < margin) {
        let tx = 0,
          ty = 0;
        if (before < 0) {
          tx = nativeTangents[vertex(first)].x;
          ty = nativeTangents[vertex(first)].y;
        } else if (after < 0) {
          tx = nativeTangents[vertex(last)].x;
          ty = nativeTangents[vertex(last)].y;
        } else {
          tx = knots[after].x - knots[before].x;
          ty = knots[after].y - knots[before].y;
        }
        const norm = Math.hypot(tx, ty);
        if (norm > 1e-12) {
          tx /= norm;
          ty /= norm;
          const q = 1 - largestShort / margin;
          const weight = q * q * (3 - 2 * q);
          for (let k = first; k <= last; k++) {
            const i = vertex(k),
              old = tangents[i];

            if (!closed && (i === 0 || i === n - 1)) continue;
            const x = old.x * (1 - weight) + tx * weight;
            const y = old.y * (1 - weight) + ty * weight;
            const len = Math.hypot(x, y);
            tangents[i] = len > 1e-12 ? { x: x / len, y: y / len } : { x: tx, y: ty };
          }
        }
      }
    }
    pos++;
  }
}

function somataLocalCornerFilletPlan(pts, closed, u, layer, preparedEdgeLengths = null, preparedTotal = 0) {
  const n = pts.length,
    edges = closed ? n : n - 1;

  const len = preparedEdgeLengths || new Float64Array(edges);
  let total = preparedEdgeLengths ? preparedTotal : 0;
  if (!preparedEdgeLengths) {
    for (let i = 0; i < edges; i++) {
      const a = pts[i],
        b = pts[(i + 1) % n];
      len[i] = Math.hypot(b.x - a.x, b.y - a.y);
      total += len[i];
    }
  }
  const radius = Number(layer?.radius) * Number(layer?.radiusMultiplier ?? 1);
  const sides = Math.round(Number(layer?.N));
  const baseEdge =
    Number.isFinite(radius) && radius > 1e-12 && sides >= 3
      ? 2 * radius * Math.sin(Math.PI / sides)
      : total / Math.max(closed ? 3 : 2, Math.min(edges, 10));
  const incoming = new Array(n),
    outgoing = new Array(n),
    controlIn = new Array(n),
    controlOut = new Array(n);
  for (let i = 0; i < n; i++) {
    const atEndpoint = !closed && (i === 0 || i === n - 1);
    const p = pts[i],
      prev = pts[(i - 1 + n) % n],
      next = pts[(i + 1) % n];
    const before = atEndpoint ? 0 : len[(i - 1 + n) % n],
      after = atEndpoint ? 0 : len[i];
    const t = atEndpoint ? 0 : Math.min(0.5 * baseEdge * u, 0.49 * before, 0.49 * after);
    const ax = before > 1e-12 ? (p.x - prev.x) / before : 0,
      ay = before > 1e-12 ? (p.y - prev.y) / before : 0;
    const bx = after > 1e-12 ? (next.x - p.x) / after : 0,
      by = after > 1e-12 ? (next.y - p.y) / after : 0;
    const beforePoint = { x: p.x - ax * t, y: p.y - ay * t };
    const afterPoint = { x: p.x + bx * t, y: p.y + by * t };
    incoming[i] = beforePoint;
    outgoing[i] = afterPoint;

    const dot = Math.max(-1, Math.min(1, ax * bx + ay * by));
    const halfCos = Math.sqrt(Math.max(0, (1 + dot) * 0.5));
    const handle = (t * (4 / 3) * halfCos) / (1 + halfCos);
    controlIn[i] = { x: beforePoint.x + ax * handle, y: beforePoint.y + ay * handle };
    controlOut[i] = { x: afterPoint.x - bx * handle, y: afterPoint.y - by * handle };
  }
  return { incoming, outgoing, controlIn, controlOut };
}

function somataDrawLocalCornerFilletsStreaming(ctx, pts, closed, u, layer) {
  const n = pts.length,
    edges = closed ? n : n - 1;
  const len = new Float64Array(edges);
  let total = 0;
  for (let i = 0; i < edges; i++) {
    const a = pts[i],
      b = pts[(i + 1) % n];
    len[i] = Math.hypot(b.x - a.x, b.y - a.y);
    total += len[i];
  }
  const radius = Number(layer?.radius) * Number(layer?.radiusMultiplier ?? 1);
  const sides = Math.round(Number(layer?.N));
  const baseEdge =
    Number.isFinite(radius) && radius > 1e-12 && sides >= 3
      ? 2 * radius * Math.sin(Math.PI / sides)
      : total / Math.max(closed ? 3 : 2, Math.min(edges, 10));
  const drawCorner = (i, first) => {
    const endpoint = !closed && (i === 0 || i === n - 1);
    const p = pts[i],
      prev = pts[(i - 1 + n) % n],
      next = pts[(i + 1) % n];
    const before = endpoint ? 0 : len[(i - 1 + n) % n],
      after = endpoint ? 0 : len[i];
    const reach = endpoint ? 0 : Math.min(0.5 * baseEdge * u, 0.49 * before, 0.49 * after);
    const ax = before > 1e-12 ? (p.x - prev.x) / before : 0,
      ay = before > 1e-12 ? (p.y - prev.y) / before : 0;
    const bx = after > 1e-12 ? (next.x - p.x) / after : 0,
      by = after > 1e-12 ? (next.y - p.y) / after : 0;
    const inX = p.x - ax * reach,
      inY = p.y - ay * reach;
    const outX = p.x + bx * reach,
      outY = p.y + by * reach;
    if (first) {
      ctx.moveTo(outX, outY);
      return;
    }
    ctx.lineTo(inX, inY);
    if (closed || i !== n - 1) {
      const dot = Math.max(-1, Math.min(1, ax * bx + ay * by));
      const halfCos = Math.sqrt(Math.max(0, (1 + dot) * 0.5));
      const handle = (reach * (4 / 3) * halfCos) / (1 + halfCos);
      ctx.bezierCurveTo(
        inX + ax * handle,
        inY + ay * handle,
        outX - bx * handle,
        outY - by * handle,
        outX,
        outY,
      );
    }
  };
  drawCorner(0, true);
  for (let i = 1; i < edges + 1; i++) drawCorner(i % n, false);
  if (closed) ctx.closePath();
  return true;
}

function somataDrawRadialSplineRounding(ctx, pts, closed, value, layer, duplicateStable = false) {
  const n = pts.length,
    edgeCount = closed ? n : n - 1;
  if (n < 2) return false;
  if (value <= 0) {
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < n; i++) ctx.lineTo(pts[i].x, pts[i].y);
    if (closed) ctx.closePath();
    return true;
  }
  if (n === 2) {
    ctx.moveTo(pts[0].x, pts[0].y);
    ctx.lineTo(pts[1].x, pts[1].y);
    if (closed) ctx.closePath();
    return true;
  }
  const clip = (t) => Math.max(0, Math.min(1, t));
  const smooth = (t) => {
    const s = clip(t);
    return s * s * (3 - 2 * s);
  };
  const u = clip(value);

  const spiralCarrier = layer?.spiralEnabled === true;

  if (spiralCarrier) return somataDrawFastSpiralSpline(ctx, pts, closed, value, layer, duplicateStable);
  const circleWeight = !spiralCarrier && closed && value > 1 ? smooth(value - 1) : 0;
  let radius = 0,
    total = 0,
    longest = 0;
  const arc = [0];
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    radius = Math.max(radius, Math.hypot(p.x, p.y));
    if (i < edgeCount) {
      const q = pts[(i + 1) % n],
        length = Math.hypot(q.x - p.x, q.y - p.y);
      total += length;
      longest = Math.max(longest, length);
      arc.push(total);
    }
  }
  if (!Number.isFinite(total) || total < 1e-12) {
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < n; i++) ctx.lineTo(pts[i].x, pts[i].y);
    if (closed) ctx.closePath();
    return true;
  }

  if (
    !spiralCarrier &&
    closed &&
    value >= 2 &&
    n >= 96 &&
    radius > 1e-10 &&
    longest <= total / 16 &&
    typeof somataDrawFullRoundingCircle === 'function'
  ) {
    somataDrawFullRoundingCircle(ctx, radius, 0, 1);
    return true;
  }

  const baseRadius = Number(layer?.radius) * Number(layer?.radiusMultiplier ?? 1);
  const sides = Math.round(Number(layer?.N));
  const baseEdge =
    Number.isFinite(baseRadius) && baseRadius > 1e-12 && sides >= 3
      ? 2 * baseRadius * Math.sin(Math.PI / sides)
      : total / Math.max(closed ? 3 : 2, Math.min(edgeCount, 10));

  const spiralExtra = spiralCarrier && value > 1 ? 0.12 * smooth(value - 1) : 0;
  const reach = Math.min(0.5 * baseEdge * (u + spiralExtra), total / (closed ? 4 : 2.25));
  const cursors = [0, 0];
  const sample = (station, which) => {
    if (closed) station = ((station % total) + total) % total;
    else station = Math.max(0, Math.min(total, station));
    let j = cursors[which];
    if (station < arc[j]) j = 0;
    while (j < edgeCount - 1 && arc[j + 1] < station) j++;
    cursors[which] = j;
    const length = arc[j + 1] - arc[j],
      t = length > 1e-14 ? clip((station - arc[j]) / length) : 0;
    const a = pts[j],
      b = pts[(j + 1) % n];
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  };
  const knots = new Array(n),
    tangents = new Array(n),
    nativeTangents = new Array(n);
  for (let i = 0; i < n; i++) {
    const p = pts[i];

    const endpoint = !closed && (i === 0 || i === n - 1);
    const a = sample(arc[i] - reach, 0),
      b = sample(arc[i] + reach, 1);
    const dx = b.x - a.x,
      dy = b.y - a.y,
      dnorm = Math.hypot(dx, dy);
    let tx = dnorm > 1e-12 ? dx / dnorm : 0,
      ty = dnorm > 1e-12 ? dy / dnorm : 0;
    if (dnorm <= 1e-12) {
      const prev = pts[Math.max(0, i - 1)],
        next = pts[Math.min(n - 1, i + 1)];
      const fx = next.x - prev.x,
        fy = next.y - prev.y,
        fn = Math.hypot(fx, fy);
      if (fn > 1e-12) {
        tx = fx / fn;
        ty = fy / fn;
      }
    }
    const weight = smooth(u);
    const fx = endpoint ? p.x : p.x + (0.5 * (a.x + b.x) - p.x) * weight;
    const fy = endpoint ? p.y : p.y + (0.5 * (a.y + b.y) - p.y) * weight;
    knots[i] = { x: fx, y: fy };
    nativeTangents[i] = { x: tx, y: ty };
  }
  if (duplicateStable && !closed) somataStabilizeSplineOpenEndpointKnots(pts, knots, baseEdge);

  for (let i = 0; i < n; i++) {
    const p = knots[i],
      a = knots[i === 0 ? (closed ? n - 1 : 0) : i - 1],
      b = knots[i === n - 1 ? (closed ? 0 : n - 1) : i + 1];
    const dx = b.x - a.x,
      dy = b.y - a.y,
      d = Math.hypot(dx, dy);

    let t = d > 1e-12 ? { x: dx / d, y: dy / d } : nativeTangents[i];
    if (!closed && i === 0) t = nativeTangents[i];
    if (!closed && i === n - 1) t = nativeTangents[i];
    tangents[i] = t;
  }
  if (duplicateStable)
    somataStabilizeSplineDuplicateTangents(pts, knots, tangents, nativeTangents, closed, baseEdge);

  const circleKnots = circleWeight > 0 ? new Array(n) : null;
  const circleTangent = circleWeight > 0 ? new Array(n) : null;
  if (circleKnots) {
    let momentX = 0,
      momentY = 0;

    const cosStation = new Float64Array(n),
      sinStation = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const phase = (2 * Math.PI * arc[i]) / total;
      const co = Math.cos(phase),
        si = Math.sin(phase);
      cosStation[i] = co;
      sinStation[i] = si;
      const previous = arc[i] - arc[i === 0 ? n - 1 : i - 1] + (i === 0 ? total : 0);
      const following = arc[i + 1] - arc[i];
      const weight = (previous + following) * 0.5;
      momentX += weight * (pts[i].x * co + pts[i].y * si);
      momentY += weight * (pts[i].y * co - pts[i].x * si);
    }
    const confidence = Math.hypot(momentX, momentY) / Math.max(1e-12, total * radius);
    const gaugeWeight = smooth((confidence - 0.003) / 0.12);
    const anchorLength = Math.hypot(momentX, momentY);
    const anchorCos = anchorLength > 0 ? momentX / anchorLength : 1;
    const anchorSin = anchorLength > 0 ? momentY / anchorLength : 0;
    for (let i = 0; i < n; i++) {
      const co = anchorCos * cosStation[i] - anchorSin * sinStation[i];
      const si = anchorSin * cosStation[i] + anchorCos * sinStation[i];
      const p = pts[i];
      const plen = Math.hypot(p.x, p.y);

      const candidate = plen > 1e-9 * radius ? p : knots[i];
      const candidateLen = Math.hypot(candidate.x, candidate.y);
      const rx = candidateLen > 1e-12 ? candidate.x / candidateLen : co;
      const ry = candidateLen > 1e-12 ? candidate.y / candidateLen : si;
      let nx = gaugeWeight * co + (1 - gaugeWeight) * rx;
      let ny = gaugeWeight * si + (1 - gaugeWeight) * ry;
      let norm = Math.hypot(nx, ny);
      if (norm < 1e-10) {
        nx = rx;
        ny = ry;
        norm = 1;
      }
      nx /= norm;
      ny /= norm;
      const x = radius * nx,
        y = radius * ny;
      circleKnots[i] = { x, y };
      circleTangent[i] = { x: -ny, y: nx };
      knots[i].x += (x - knots[i].x) * circleWeight;
      knots[i].y += (y - knots[i].y) * circleWeight;
      const tx = tangents[i].x * (1 - circleWeight) + circleTangent[i].x * circleWeight;
      const ty = tangents[i].y * (1 - circleWeight) + circleTangent[i].y * circleWeight;
      const tn = Math.hypot(tx, ty);
      tangents[i] = tn > 1e-10 ? { x: tx / tn, y: ty / tn } : circleTangent[i];
    }
  }

  ctx.moveTo(knots[0].x, knots[0].y);
  for (let i = 0; i < edgeCount; i++) {
    const j = (i + 1) % n,
      p = knots[i],
      q = knots[j];
    const length = Math.hypot(q.x - p.x, q.y - p.y);
    const h = length * (0.28 * smooth(u / 0.12));

    const a0 = circleKnots ? Math.atan2(circleKnots[i].y, circleKnots[i].x) : 0;
    const a1 = circleKnots ? Math.atan2(circleKnots[j].y, circleKnots[j].x) : 0;
    const delta = circleKnots ? Math.abs(Math.atan2(Math.sin(a1 - a0), Math.cos(a1 - a0))) : 0;
    const circleHandle = circleKnots ? ((4 * radius) / 3) * Math.tan(delta / 4) : 0;
    const handle = h + (circleHandle - h) * circleWeight;
    const a = tangents[i],
      b = tangents[j];
    ctx.bezierCurveTo(
      p.x + a.x * handle,
      p.y + a.y * handle,
      q.x - b.x * handle,
      q.y - b.y * handle,
      q.x,
      q.y,
    );
  }
  if (closed) ctx.closePath();
  return true;
}

function somataDrawLocalSplineRounding(ctx, pts, closed, value, layer, duplicateStable = false) {
  const n = pts.length,
    edgeCount = closed ? n : n - 1;
  if (n < 2) return false;
  if (value <= 0) {
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < n; i++) ctx.lineTo(pts[i].x, pts[i].y);
    if (closed) ctx.closePath();
    return true;
  }
  if (n === 2) {
    ctx.moveTo(pts[0].x, pts[0].y);
    ctx.lineTo(pts[1].x, pts[1].y);
    if (closed) ctx.closePath();
    return true;
  }
  const clip = (t) => Math.max(0, Math.min(1, t));
  const smooth = (t) => {
    const s = clip(t);
    return s * s * (3 - 2 * s);
  };
  const u = clip(value);

  const spiralCarrier = layer?.spiralEnabled === true;

  if (spiralCarrier) return somataDrawFastSpiralSpline(ctx, pts, closed, value, layer, duplicateStable);

  if (u <= 0.7) return somataDrawLocalCornerFilletsStreaming(ctx, pts, closed, u, layer);
  const shareFilletEdges = u < 1;
  const edgeLengths = shareFilletEdges ? new Float64Array(edgeCount) : null;
  const circleWeight = !spiralCarrier && closed && value > 1 ? smooth(value - 1) : 0;

  const needsCircleRadius = circleWeight > 0 || value >= 2;
  const needsLongestEdge = value >= 2;
  let radius = 0,
    total = 0,
    longest = 0;
  const arc = [0];
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    if (needsCircleRadius) radius = Math.max(radius, Math.hypot(p.x, p.y));
    if (i < edgeCount) {
      const q = pts[(i + 1) % n],
        length = Math.hypot(q.x - p.x, q.y - p.y);
      if (edgeLengths) edgeLengths[i] = length;
      total += length;
      if (needsLongestEdge) longest = Math.max(longest, length);
      arc.push(total);
    }
  }

  const localPlan = shareFilletEdges
    ? somataLocalCornerFilletPlan(pts, closed, u, layer, edgeLengths, total)
    : null;
  const localBlend = localPlan ? smooth((u - 0.7) / 0.3) : 1;
  if (!Number.isFinite(total) || total < 1e-12) {
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < n; i++) ctx.lineTo(pts[i].x, pts[i].y);
    if (closed) ctx.closePath();
    return true;
  }

  if (
    !spiralCarrier &&
    closed &&
    value >= 2 &&
    n >= 96 &&
    radius > 1e-10 &&
    longest <= total / 16 &&
    typeof somataDrawFullRoundingCircle === 'function'
  ) {
    somataDrawFullRoundingCircle(ctx, radius, 0, 1);
    return true;
  }

  const baseRadius = Number(layer?.radius) * Number(layer?.radiusMultiplier ?? 1);
  const sides = Math.round(Number(layer?.N));
  const baseEdge =
    Number.isFinite(baseRadius) && baseRadius > 1e-12 && sides >= 3
      ? 2 * baseRadius * Math.sin(Math.PI / sides)
      : total / Math.max(closed ? 3 : 2, Math.min(edgeCount, 10));

  const spiralExtra = spiralCarrier && value > 1 ? 0.12 * smooth(value - 1) : 0;
  const reach = Math.min(0.5 * baseEdge * (u + spiralExtra), total / (closed ? 4 : 2.25));
  const cursors = [0, 0];
  const sample = (station, which) => {
    if (closed) station = ((station % total) + total) % total;
    else station = Math.max(0, Math.min(total, station));
    let j = cursors[which];
    if (station < arc[j]) j = 0;
    while (j < edgeCount - 1 && arc[j + 1] < station) j++;
    cursors[which] = j;
    const length = arc[j + 1] - arc[j],
      t = length > 1e-14 ? clip((station - arc[j]) / length) : 0;
    const a = pts[j],
      b = pts[(j + 1) % n];
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  };
  const knots = new Array(n),
    tangents = new Array(n),
    nativeTangents = new Array(n);
  for (let i = 0; i < n; i++) {
    const p = pts[i];

    const endpoint = !closed && (i === 0 || i === n - 1);
    const a = sample(arc[i] - reach, 0),
      b = sample(arc[i] + reach, 1);
    const dx = b.x - a.x,
      dy = b.y - a.y,
      dnorm = Math.hypot(dx, dy);
    let tx = dnorm > 1e-12 ? dx / dnorm : 0,
      ty = dnorm > 1e-12 ? dy / dnorm : 0;
    if (dnorm <= 1e-12) {
      const prev = pts[Math.max(0, i - 1)],
        next = pts[Math.min(n - 1, i + 1)];
      const fx = next.x - prev.x,
        fy = next.y - prev.y,
        fn = Math.hypot(fx, fy);
      if (fn > 1e-12) {
        tx = fx / fn;
        ty = fy / fn;
      }
    }
    const weight = smooth(u);
    const fx = endpoint ? p.x : p.x + (0.5 * (a.x + b.x) - p.x) * weight;
    const fy = endpoint ? p.y : p.y + (0.5 * (a.y + b.y) - p.y) * weight;
    knots[i] = { x: fx, y: fy };
    nativeTangents[i] = { x: tx, y: ty };
  }
  if (duplicateStable && !closed) somataStabilizeSplineOpenEndpointKnots(pts, knots, baseEdge);

  for (let i = 0; i < n; i++) {
    const p = knots[i],
      a = knots[i === 0 ? (closed ? n - 1 : 0) : i - 1],
      b = knots[i === n - 1 ? (closed ? 0 : n - 1) : i + 1];
    const dx = b.x - a.x,
      dy = b.y - a.y,
      d = Math.hypot(dx, dy);

    let t = d > 1e-12 ? { x: dx / d, y: dy / d } : nativeTangents[i];
    if (!closed && i === 0) t = nativeTangents[i];
    if (!closed && i === n - 1) t = nativeTangents[i];
    tangents[i] = t;
  }
  if (duplicateStable)
    somataStabilizeSplineDuplicateTangents(pts, knots, tangents, nativeTangents, closed, baseEdge);

  const circleKnots = circleWeight > 0 ? new Array(n) : null;
  const circleTangent = circleWeight > 0 ? new Array(n) : null;
  if (circleKnots) {
    let momentX = 0,
      momentY = 0;

    const cosStation = new Float64Array(n),
      sinStation = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const phase = (2 * Math.PI * arc[i]) / total;
      const co = Math.cos(phase),
        si = Math.sin(phase);
      cosStation[i] = co;
      sinStation[i] = si;
      const previous = arc[i] - arc[i === 0 ? n - 1 : i - 1] + (i === 0 ? total : 0);
      const following = arc[i + 1] - arc[i];
      const weight = (previous + following) * 0.5;
      momentX += weight * (pts[i].x * co + pts[i].y * si);
      momentY += weight * (pts[i].y * co - pts[i].x * si);
    }
    const confidence = Math.hypot(momentX, momentY) / Math.max(1e-12, total * radius);
    const gaugeWeight = smooth((confidence - 0.003) / 0.12);
    const anchorLength = Math.hypot(momentX, momentY);
    const anchorCos = anchorLength > 0 ? momentX / anchorLength : 1;
    const anchorSin = anchorLength > 0 ? momentY / anchorLength : 0;
    for (let i = 0; i < n; i++) {
      const co = anchorCos * cosStation[i] - anchorSin * sinStation[i];
      const si = anchorSin * cosStation[i] + anchorCos * sinStation[i];
      const p = pts[i];
      const plen = Math.hypot(p.x, p.y);

      const candidate = plen > 1e-9 * radius ? p : knots[i];
      const candidateLen = Math.hypot(candidate.x, candidate.y);
      const rx = candidateLen > 1e-12 ? candidate.x / candidateLen : co;
      const ry = candidateLen > 1e-12 ? candidate.y / candidateLen : si;
      let nx = gaugeWeight * co + (1 - gaugeWeight) * rx;
      let ny = gaugeWeight * si + (1 - gaugeWeight) * ry;
      let norm = Math.hypot(nx, ny);
      if (norm < 1e-10) {
        nx = rx;
        ny = ry;
        norm = 1;
      }
      nx /= norm;
      ny /= norm;
      const x = radius * nx,
        y = radius * ny;
      circleKnots[i] = { x, y };
      circleTangent[i] = { x: -ny, y: nx };
      knots[i].x += (x - knots[i].x) * circleWeight;
      knots[i].y += (y - knots[i].y) * circleWeight;
      const tx = tangents[i].x * (1 - circleWeight) + circleTangent[i].x * circleWeight;
      const ty = tangents[i].y * (1 - circleWeight) + circleTangent[i].y * circleWeight;
      const tn = Math.hypot(tx, ty);
      tangents[i] = tn > 1e-10 ? { x: tx / tn, y: ty / tn } : circleTangent[i];
    }
  }

  const lerp = (a, b, t) => a + (b - a) * t;
  const start = localPlan
    ? {
        x: lerp(localPlan.outgoing[0].x, knots[0].x, localBlend),
        y: lerp(localPlan.outgoing[0].y, knots[0].y, localBlend),
      }
    : knots[0];

  const handleFactor = 0.28 * smooth(u / 0.12);
  ctx.moveTo(start.x, start.y);
  for (let i = 0; i < edgeCount; i++) {
    const j = (i + 1) % n,
      p = knots[i],
      q = knots[j];
    const length = Math.hypot(q.x - p.x, q.y - p.y);

    const h = length * handleFactor;

    const a0 = circleKnots ? Math.atan2(circleKnots[i].y, circleKnots[i].x) : 0;
    const a1 = circleKnots ? Math.atan2(circleKnots[j].y, circleKnots[j].x) : 0;
    const delta = circleKnots ? Math.abs(Math.atan2(Math.sin(a1 - a0), Math.cos(a1 - a0))) : 0;
    const circleHandle = circleKnots ? ((4 * radius) / 3) * Math.tan(delta / 4) : 0;
    const handle = h + (circleHandle - h) * circleWeight;
    const a = tangents[i],
      b = tangents[j];
    const c1x = p.x + a.x * handle,
      c1y = p.y + a.y * handle;
    const c2x = q.x - b.x * handle,
      c2y = q.y - b.y * handle;
    if (localPlan) {
      const a1x = (p.x + c1x) * 0.5,
        a1y = (p.y + c1y) * 0.5;
      const a2x = (c1x + c2x) * 0.5,
        a2y = (c1y + c2y) * 0.5;
      const a3x = (c2x + q.x) * 0.5,
        a3y = (c2y + q.y) * 0.5;
      const b1x = (a1x + a2x) * 0.5,
        b1y = (a1y + a2y) * 0.5;
      const b2x = (a2x + a3x) * 0.5,
        b2y = (a2y + a3y) * 0.5;
      const midx = (b1x + b2x) * 0.5,
        midy = (b1y + b2y) * 0.5;
      const s = localPlan.outgoing[i],
        e = localPlan.incoming[j];
      const line1x = s.x + (e.x - s.x) / 3,
        line1y = s.y + (e.y - s.y) / 3;
      const line2x = e.x - (e.x - s.x) / 3,
        line2y = e.y - (e.y - s.y) / 3;
      const first1x = lerp(line1x, a1x, localBlend),
        first1y = lerp(line1y, a1y, localBlend);
      const first2x = lerp(line2x, b1x, localBlend),
        first2y = lerp(line2y, b1y, localBlend);
      const splitx = lerp(e.x, midx, localBlend),
        splity = lerp(e.y, midy, localBlend);
      const cin = localPlan.controlIn[j],
        cout = localPlan.controlOut[j];
      const second1x = lerp(cin.x, b2x, localBlend),
        second1y = lerp(cin.y, b2y, localBlend);
      const second2x = lerp(cout.x, a3x, localBlend),
        second2y = lerp(cout.y, a3y, localBlend);
      const out = localPlan.outgoing[j];
      const endx = lerp(out.x, q.x, localBlend),
        endy = lerp(out.y, q.y, localBlend);
      ctx.bezierCurveTo(first1x, first1y, first2x, first2y, splitx, splity);
      ctx.bezierCurveTo(second1x, second1y, second2x, second2y, endx, endy);
    } else ctx.bezierCurveTo(c1x, c1y, c2x, c2y, q.x, q.y);
  }
  if (closed) ctx.closePath();
  return true;
}

function somataDrawFastSpiralSpline(ctx, pts, closed, value, layer, duplicateStable = false) {
  const n = pts.length,
    edgeCount = closed ? n : n - 1;
  const clip = (t) => Math.max(0, Math.min(1, t));
  const smooth = (t) => {
    const s = clip(t);
    return s * s * (3 - 2 * s);
  };
  const u = clip(value),
    arc = [0];
  let total = 0;
  for (let i = 0; i < edgeCount; i++) {
    const p = pts[i],
      q = pts[(i + 1) % n];
    total += Math.hypot(q.x - p.x, q.y - p.y);
    arc.push(total);
  }
  if (!Number.isFinite(total) || total < 1e-12) {
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < n; i++) ctx.lineTo(pts[i].x, pts[i].y);
    if (closed) ctx.closePath();
    return true;
  }
  const baseRadius = Number(layer?.radius) * Number(layer?.radiusMultiplier ?? 1);
  const sides = Math.round(Number(layer?.N));
  const baseEdge =
    Number.isFinite(baseRadius) && baseRadius > 1e-12 && sides >= 3
      ? 2 * baseRadius * Math.sin(Math.PI / sides)
      : total / Math.max(closed ? 3 : 2, Math.min(edgeCount, 10));
  const spiralExtra = value > 1 ? 0.12 * smooth(value - 1) : 0;
  const reach = Math.min(0.5 * baseEdge * (u + spiralExtra), total / (closed ? 4 : 2.25));
  const cursors = [0, 0];
  const sample = (station, which) => {
    if (closed) station = ((station % total) + total) % total;
    else station = Math.max(0, Math.min(total, station));
    let j = cursors[which];
    if (station < arc[j]) j = 0;
    while (j < edgeCount - 1 && arc[j + 1] < station) j++;
    cursors[which] = j;
    const length = arc[j + 1] - arc[j],
      t = length > 1e-14 ? clip((station - arc[j]) / length) : 0;
    const a = pts[j],
      b = pts[(j + 1) % n];
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  };
  const knots = new Array(n),
    tangents = new Array(n),
    nativeTangents = new Array(n);
  const weight = smooth(u);
  for (let i = 0; i < n; i++) {
    const p = pts[i],
      endpoint = !closed && (i === 0 || i === n - 1);
    const a = sample(arc[i] - reach, 0),
      b = sample(arc[i] + reach, 1);
    const dx = b.x - a.x,
      dy = b.y - a.y,
      dnorm = Math.hypot(dx, dy);
    let tx = dnorm > 1e-12 ? dx / dnorm : 0,
      ty = dnorm > 1e-12 ? dy / dnorm : 0;
    if (dnorm <= 1e-12) {
      const prev = pts[Math.max(0, i - 1)],
        next = pts[Math.min(n - 1, i + 1)];
      const fx = next.x - prev.x,
        fy = next.y - prev.y,
        fn = Math.hypot(fx, fy);
      if (fn > 1e-12) {
        tx = fx / fn;
        ty = fy / fn;
      }
    }
    const fx = endpoint ? p.x : p.x + (0.5 * (a.x + b.x) - p.x) * weight;
    const fy = endpoint ? p.y : p.y + (0.5 * (a.y + b.y) - p.y) * weight;
    knots[i] = { x: fx, y: fy };
    nativeTangents[i] = { x: tx, y: ty };
  }
  if (duplicateStable && !closed) somataStabilizeSplineOpenEndpointKnots(pts, knots, baseEdge);
  for (let i = 0; i < n; i++) {
    const p = knots[i],
      a = knots[i === 0 ? (closed ? n - 1 : 0) : i - 1],
      b = knots[i === n - 1 ? (closed ? 0 : n - 1) : i + 1];
    const dx = b.x - a.x,
      dy = b.y - a.y,
      d = Math.hypot(dx, dy);
    let t = d > 1e-12 ? { x: dx / d, y: dy / d } : nativeTangents[i];
    if (!closed && i === 0) t = nativeTangents[i];
    if (!closed && i === n - 1) t = nativeTangents[i];
    tangents[i] = t;
  }
  if (duplicateStable)
    somataStabilizeSplineDuplicateTangents(pts, knots, tangents, nativeTangents, closed, baseEdge);

  const handleFactor = 0.28 * smooth(u / 0.12);
  ctx.moveTo(knots[0].x, knots[0].y);
  for (let i = 0; i < edgeCount; i++) {
    const j = (i + 1) % n,
      p = knots[i],
      q = knots[j];
    const length = Math.hypot(q.x - p.x, q.y - p.y);
    const h = length * handleFactor;
    const a = tangents[i],
      b = tangents[j];
    ctx.bezierCurveTo(p.x + a.x * h, p.y + a.y * h, q.x - b.x * h, q.y - b.y * h, q.x, q.y);
  }
  if (closed) ctx.closePath();
  return true;
}

export { somataDrawSplineCornerMode };
