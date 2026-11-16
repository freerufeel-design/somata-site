// Скругление ломаной для отрисовки (roundPolylineForDraw).
import '../ui/effects-sidebar.js'; // initialisation order: this module runs after it
import { state } from '../core/state.js';
import { buildFourierWavePoints } from './fourier.js';
import { smoothMorphPath } from './morph.js';
import { somataDrawSplineCornerMode } from './spline-corner-mode.js';
import {
  highTurnRoundingFactor,
  limitHighTurnExtraKnotSmoothing,
  transformSplineKnotsForRounding,
} from './spline-rounding.js';
import { drawUnifiedFilletPath } from './unified-fillet.js';

function roundPolylineForDraw(
  ctx,
  points,
  closed,
  roundingFrac,
  cornerFlags,
  cornerFactors = null,
  independentMorphCuts = false,
  roundingGuardSource = null,
  filletLayer = null,
) {
  if (!points || points.length < 2) return;
  if (
    !state.fourierMode &&
    filletLayer &&
    !cornerFactors &&
    typeof somataDrawSplineCornerMode === 'function' &&
    somataDrawSplineCornerMode(ctx, points, Boolean(closed), roundingFrac, {
      baseSplineBlend: 0,
      layer: filletLayer,
    })
  )
    return;
  if (
    !state.fourierMode &&
    typeof ctx.bezierCurveTo === 'function' &&
    typeof drawUnifiedFilletPath === 'function' &&
    !cornerFactors &&
    drawUnifiedFilletPath(ctx, points, Boolean(closed), roundingFrac, cornerFlags, { layer: filletLayer })
  )
    return;
  const strength = Math.max(0, Math.min(2, Number(roundingFrac) || 0));

  if (strength > 1.000001 && points.length >= 3) {
    const pre = transformSplineKnotsForRounding(points, Boolean(closed), strength - 1, cornerFlags || []);
    const bounded = limitHighTurnExtraKnotSmoothing(points, pre, Boolean(closed), cornerFlags || []);
    // Preserve the authored turning angles and R when extra (>100%) knot
    // smoothing changes their local tangent directions. Otherwise a
    // 140° corner can become a 90° corner *before* the safety guard.
    return roundPolylineForDraw(
      ctx,
      bounded,
      closed,
      1,
      cornerFlags,
      cornerFactors,
      independentMorphCuts,
      points,
    );
  }

  if (state.fourierMode && points?._fourierPrepared !== true) {
    const amount = Math.min(1, strength);
    let source = points;
    if (amount > 0.001 && Array.isArray(cornerFlags) && cornerFlags.some(Boolean))
      source = smoothMorphPath(points, Boolean(closed), amount, cornerFlags);
    const wave = buildFourierWavePoints(source, Boolean(closed), `poly:${amount.toFixed(4)}`);
    if (wave.length < 2) return;
    ctx.moveTo(wave[0].x, wave[0].y);
    for (let i = 1; i < wave.length; i++) ctx.lineTo(wave[i].x, wave[i].y);
    if (closed) ctx.closePath();
    return;
  }

  const n = points.length;
  const rawPath = () => {
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < n; i++) ctx.lineTo(points[i].x, points[i].y);
    if (closed) ctx.closePath();
  };

  const amount = Math.min(1, strength);
  // A closed two-point orbit is a diameter traced in both
  // directions, not an area with roundable corners. Emit its exact
  // original rail at every rounding level (N=6, K=3, S=3).
  if (closed && n === 2) {
    rawPath();
    return;
  }
  if (amount <= 0.001) {
    rawPath();
    return;
  }

  let corners = [];
  for (let i = 0; i < n; i++) {
    if (!cornerFlags?.[i]) continue;
    if (cornerFactors && Number(cornerFactors[i]) <= 0.001) continue;
    if (!closed && (i === 0 || i === n - 1)) continue; // open ends are not fillets
    corners.push(i);
  }
  if (!corners.length) {
    rawPath();
    return;
  }

  const pointOnSegment = (a, b, f) => ({
    x: a.x + (b.x - a.x) * f,
    y: a.y + (b.y - a.y) * f,
  });

  const distanceForward = (from, to) => {
    if (from < 0 || to < 0 || from === to) return 0;
    let d = 0;
    let i = from;
    let guard = 0;
    while (i !== to && guard++ <= n) {
      const j = i + 1 < n ? i + 1 : closed ? 0 : n - 1;
      if (j === i) break;
      d += Math.hypot(points[j].x - points[i].x, points[j].y - points[i].y);
      i = j;
    }
    return d;
  };

  const pointAlongPath = (from, to, distance) => {
    if (from === to) return { ...points[from] };
    let remain = Math.max(0, distance);
    let i = from;
    let guard = 0;
    while (i !== to && guard++ <= n) {
      const j = i + 1 < n ? i + 1 : closed ? 0 : n - 1;
      if (j === i) break;
      const len = Math.hypot(points[j].x - points[i].x, points[j].y - points[i].y);
      if (len > 1e-9 && remain <= len) return pointOnSegment(points[i], points[j], remain / len);
      remain -= len;
      i = j;
    }
    return { ...points[to] };
  };

  const emitPathSlice = (from, to, startDistance, endDistance) => {
    const total = distanceForward(from, to);
    const a = Math.max(0, Math.min(total, startDistance));
    const b = Math.max(a, Math.min(total, endDistance));
    if (b <= a + 1e-9) return;

    let travelled = 0;
    let i = from;
    let guard = 0;
    while (i !== to && guard++ <= n) {
      const j = i + 1 < n ? i + 1 : closed ? 0 : n - 1;
      if (j === i) break;
      const len = Math.hypot(points[j].x - points[i].x, points[j].y - points[i].y);
      const nextTravelled = travelled + len;

      if (nextTravelled > a + 1e-9 && nextTravelled < b - 1e-9) {
        ctx.lineTo(points[j].x, points[j].y);
      }
      if (nextTravelled >= b - 1e-9) break;
      travelled = nextTravelled;
      i = j;
    }

    const endPt = pointAlongPath(from, to, b);
    ctx.lineTo(endPt.x, endPt.y);
  };

  const data = new Map();
  const m = corners.length;
  // The percentage is measured against the entire contour length,
  // not the immediately adjacent polygon segments. Equal geometric
  // shapes with different subdivision counts must round identically.
  const wholeProfileLength = closed
    ? distanceForward(0, n - 1) + Math.hypot(points[0].x - points[n - 1].x, points[0].y - points[n - 1].y)
    : distanceForward(0, n - 1);
  const globalShoulder = ((0.5 * wholeProfileLength) / Math.max(1, m)) * amount;
  const guardPoints = roundingGuardSource?.length === n ? roundingGuardSource : points;
  const originalRadius = guardPoints.reduce((r, p) => Math.max(r, Math.hypot(p.x, p.y)), 0);
  const halfRadius = originalRadius * 0.5;
  // Exact first intersection of a line segment with the inner-half
  // circle; unlike point sampling it cannot miss a short excursion
  // through the protected radius. Traverse away from each corner.
  const radialSafeCut = (corner, boundary, backwards, wanted) => {
    if (
      !(wanted > 1e-8 && halfRadius > 1e-7) ||
      Math.hypot(points[corner].x, points[corner].y) <= halfRadius + 1e-7
    )
      return wanted;
    let idx = corner,
      travelled = 0,
      guard = 0;
    while (idx !== boundary && travelled < wanted && guard++ <= n) {
      const next = backwards ? (idx - 1 + n) % n : (idx + 1) % n;
      if (!closed && (backwards ? idx === 0 : idx === n - 1)) break;
      const p = points[idx],
        v = points[next];
      const dx = v.x - p.x,
        dy = v.y - p.y,
        len = Math.hypot(dx, dy);
      const segment = Math.min(len, wanted - travelled);
      if (len > 1e-9) {
        const a = dx * dx + dy * dy,
          b = 2 * (p.x * dx + p.y * dy);
        const c = p.x * p.x + p.y * p.y - halfRadius * halfRadius;
        const disc = b * b - 4 * a * c;
        if (disc >= 0) {
          const t = (-b - Math.sqrt(disc)) / (2 * a);
          if (t >= 0 && t <= segment / len + 1e-10)
            return Math.max(0, Math.min(wanted, travelled + len * Math.max(0, t) - 1e-7));
        }
      }
      travelled += segment;
      idx = next;
    }
    return wanted;
  };
  for (let q = 0; q < m; q++) {
    const i = corners[q];
    let prevBoundary;
    let nextBoundary;

    if (closed) {
      if (m === 1) {
        prevBoundary = (i - 1 + n) % n;
        nextBoundary = (i + 1) % n;
      } else {
        prevBoundary = corners[(q - 1 + m) % m];
        nextBoundary = corners[(q + 1) % m];
      }
    } else {
      prevBoundary = q > 0 ? corners[q - 1] : 0;
      nextBoundary = q + 1 < m ? corners[q + 1] : n - 1;
    }

    const inSpan = distanceForward(prevBoundary, i);
    const outSpan = distanceForward(i, nextBoundary);
    const factor = cornerFactors ? Math.max(0, Math.min(1, Number(cornerFactors[i]) || 0)) : 1;
    // Distance-based shoulders: an arbitrary short neighbor must
    // not shrink the long-side rounding. The half-run cap prevents
    // collisions where fillets approach from both ends of a run.
    // Retain the argument for compatibility with older callers.
    // Near a complete reversal the fillet must disappear instead
    // of forming a hairpin loop. When a large-angle shoulder would
    // enter the inner half-radius, stop expanding it there too.
    let pi = (i - 1 + n) % n,
      ni = (i + 1) % n;
    while (pi !== i && Math.hypot(points[i].x - points[pi].x, points[i].y - points[pi].y) < 1e-8)
      pi = (pi - 1 + n) % n;
    while (ni !== i && Math.hypot(points[i].x - points[ni].x, points[i].y - points[ni].y) < 1e-8)
      ni = (ni + 1) % n;
    const currentTurnFactor = highTurnRoundingFactor(
      { x: points[i].x - points[pi].x, y: points[i].y - points[pi].y },
      { x: points[ni].x - points[i].x, y: points[ni].y - points[i].y },
    );
    // A strong-rounding prestep can completely change an angle.
    // Do not allow it to erase the original high-turn protection.
    const authoredTurnFactor =
      roundingGuardSource?.length === n
        ? highTurnRoundingFactor(
            { x: guardPoints[i].x - guardPoints[pi].x, y: guardPoints[i].y - guardPoints[pi].y },
            { x: guardPoints[ni].x - guardPoints[i].x, y: guardPoints[ni].y - guardPoints[i].y },
          )
        : 1;
    const turnFactor = Math.min(currentTurnFactor, authoredTurnFactor);
    let inCut = Math.min(inSpan * 0.5, globalShoulder) * factor * turnFactor;
    let outCut = Math.min(outSpan * 0.5, globalShoulder) * factor * turnFactor;
    if (turnFactor < 0.999999) {
      inCut = radialSafeCut(i, prevBoundary, true, inCut);
      outCut = radialSafeCut(i, nextBoundary, false, outCut);
    }

    const inPt = pointAlongPath(prevBoundary, i, Math.max(0, inSpan - inCut));
    const outPt = pointAlongPath(i, nextBoundary, outCut);
    data.set(i, { prevBoundary, nextBoundary, inSpan, outSpan, inCut, outCut, inPt, outPt });
  }

  // A near-180-degree reversal must NOT create an artificial side
  // loop.  The earlier special two-cubic U-cap deliberately offset
  // its midpoint sideways and produced the visible "ears" during
  // both Static and Morph.  The angle limiter above makes the cut
  // approach zero continuously; a quadratic stays within the two
  // shoulders + original corner (convex hull) at every cut length.
  const emitCornerCurve = (i, entry, exit) => {
    const vertex = points[i];
    const corner = data.get(i);
    if ((corner?.inCut || 0) < 1e-7 && (corner?.outCut || 0) < 1e-7) {
      ctx.lineTo(vertex.x, vertex.y);
      return;
    }
    ctx.quadraticCurveTo(vertex.x, vertex.y, exit.x, exit.y);
  };

  if (closed) {
    const first = corners[0];
    const firstData = data.get(first);
    ctx.moveTo(firstData.outPt.x, firstData.outPt.y);

    for (let q = 0; q < m; q++) {
      const from = corners[q];
      const to = corners[(q + 1) % m];
      const fromData = data.get(from);
      const toData = data.get(to);
      const span = distanceForward(from, to);

      emitPathSlice(from, to, fromData.outCut, Math.max(0, span - toData.inCut));

      emitCornerCurve(to, toData.inPt, toData.outPt);
    }
    ctx.closePath();
    return;
  }

  ctx.moveTo(points[0].x, points[0].y);
  let from = 0;
  let startTrim = 0;
  for (const corner of corners) {
    const d = data.get(corner);
    const span = distanceForward(from, corner);
    emitPathSlice(from, corner, startTrim, Math.max(0, span - d.inCut));
    emitCornerCurve(corner, d.inPt, d.outPt);
    from = corner;
    startTrim = d.outCut;
  }
  emitPathSlice(from, n - 1, startTrim, distanceForward(from, n - 1));
}

export { roundPolylineForDraw };
