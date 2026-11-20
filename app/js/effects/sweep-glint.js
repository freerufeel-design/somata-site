// Проблеск: куски по пути и высокоточный сэмплер.
import './graffiti-ribbon.js'; // initialisation order: this module runs after it
import { currentSweepConfig, gcd, normalizeSweepFlashMode } from '../core/defaults-layers.js';
import { getRoundingStrength } from '../core/palette.js';
import { runtimeState, state } from '../core/state.js';
import { buildFourierWavePoints } from '../geometry/fourier.js';
import {
  acquireEffectPiece,
  buildPathLengthTable,
  effectPointAt,
  frameGeometryRuntime,
  getLayerFrameAuxiliaryPaths,
  isCurrentFrameDynamicPathList,
  persistentHighPrecisionGlintCache,
  pointAtPathDistance,
  sweepSegmentScratch,
} from '../geometry/frame-paths.js';
import { drawMorphPathQuality, smoothMorphPath } from '../geometry/morph.js';
import { normalizeSplineRenderMode, useSmoothSplinePath } from '../geometry/profile-model.js';
import { isSpiralLayer } from '../geometry/spiral/order-params.js';
import { splinePathForDraw } from '../geometry/spline-rounding.js';
import { getLampMorphRenderInfo } from '../lamps/lamp-anchors.js';
import { roundPolylineForDraw } from '../geometry/polyline-rounding.js';

function buildWrappedSweepPieces(
  table,
  rangeStart,
  rangeLength,
  startWithin,
  length,
  samples,
  targetPieces = null,
  scratch = null,
) {
  const result = targetPieces || [];
  if (!table || rangeLength <= 0 || length <= 0) return result;
  const safeLength = Math.min(length, rangeLength);
  let start = ((startWithin % rangeLength) + rangeLength) % rangeLength;
  const end = start + safeLength;
  const addPiece = (a, b) => {
    if (b - a <= 1e-6) return;
    const count = Math.max(2, Math.round(samples * ((b - a) / safeLength)));
    const pts = scratch ? acquireEffectPiece(scratch) : [];
    for (let i = 0; i <= count; i++) {
      const d = rangeStart + a + (b - a) * (i / count);
      if (scratch) effectPointAt(pts, i, table, d);
      else pts.push(pointAtPathDistance(table, d));
    }
    pts.length = count + 1;
    if (pts.length > 1) result.push(pts);
  };
  if (end <= rangeLength) {
    addPiece(start, end);
  } else {
    addPiece(start, rangeLength);
    addPiece(0, end - rangeLength);
  }
  return result;
}
function getSweepSegmentsForPath(path, layer) {
  const table = buildPathLengthTable([path]);
  const segments = sweepSegmentScratch.segments;
  segments.length = 0;
  if (table.total <= 0) return { table, segments };
  const N = Math.max(2, Math.round(Number(layer?.N) || 2));
  const K = Math.max(1, Math.round(Number(layer?.K) || 1));
  const orbitCount = Math.max(1, gcd(N, K));
  const segmentCount = Math.max(1, Math.round(N / orbitCount));
  const len = table.total / segmentCount;
  while (sweepSegmentScratch.pool.length < segmentCount)
    sweepSegmentScratch.pool.push({ start: 0, length: 0, index: 0 });
  for (let i = 0; i < segmentCount; i++) {
    const seg = sweepSegmentScratch.pool[i];
    seg.start = i * len;
    seg.length = len;
    seg.index = i;
    segments.push(seg);
  }
  return { table, segments };
}
function getSweepTargetVelocity(cfg = currentSweepConfig()) {
  const mult = Math.max(0.015625, Math.min(64, Number(cfg.speedMultiplier) || 1));
  const bpm = Math.max(0, Number(state.tapTempo?.bpm) || 0);
  const synced = cfg.syncMusic !== false && bpm > 0;
  const base = synced ? bpm / 60 : Math.max(0.02, Math.min(2, Number(cfg.speed) || 0.25));
  return base * mult * (cfg.direction === 'backward' ? -1 : 1);
}
function sweepStableUnit(seed) {
  let x = (Math.imul((seed | 0) ^ 0x9e3779b9, 1664525) + 1013904223) >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 2246822507) >>> 0;
  x ^= x >>> 13;
  return (x >>> 0) / 4294967296;
}
function sampleSweepRange(table, start, length, maxSamples = 90, scratch = null) {
  if (!table || !(table.total > 0) || !(length > 1e-6)) return scratch ? null : [];
  const a = Math.max(0, Math.min(table.total, start)),
    b = Math.max(a, Math.min(table.total, start + length));
  if (b - a <= 1e-6) return scratch ? null : [];
  const n = Math.max(3, Math.min(maxSamples, Math.ceil((b - a) / 3)));
  const pts = scratch ? acquireEffectPiece(scratch) : [];
  for (let i = 0; i <= n; i++) {
    const d = a + (b - a) * (i / n);
    if (scratch) effectPointAt(pts, i, table, d);
    else pts.push(pointAtPathDistance(table, d));
  }
  pts.length = n + 1;
  return pts;
}
function normalizeGlintPrecisionValue(value) {
  return value === 'chaotic' ? 'chaotic' : value === 'spectral' ? 'spectral' : 'high';
}
function effectiveGlintType(cfg) {
  return normalizeSweepFlashMode(cfg?.flashMode) === 'spectral'
    ? 'spectral'
    : normalizeGlintPrecisionValue(cfg?.flashType ?? cfg?.glintPrecision);
}
function isHighPrecisionGlint(cfg) {
  return effectiveGlintType(cfg) === 'high';
}
const dynamicHighPrecisionGlintSamplerCache = new WeakMap();
function createSweepHighPrecisionSampler(tolerance = 0.22, maxDepth = 8) {
  let tol = Math.max(0.04, Math.min(0.7, Number(tolerance) || 0.22));
  let depthCap = Math.max(4, Math.min(11, Math.round(Number(maxDepth) || 8)));
  const points = [],
    pointPool = [];
  let pointCursor = 0,
    currentX = 0,
    currentY = 0,
    hasCurrent = false,
    startX = 0,
    startY = 0,
    hasStart = false;
  const push = (x, y) => {
    const nx = Number(x) || 0,
      ny = Number(y) || 0,
      last = points[points.length - 1];
    if (!last || Math.hypot(nx - last.x, ny - last.y) > 1e-8) {
      let p = pointPool[pointCursor];
      if (!p) p = pointPool[pointCursor] = { x: 0, y: 0 };
      pointCursor++;
      p.x = nx;
      p.y = ny;
      points.push(p);
    }
    currentX = nx;
    currentY = ny;
    hasCurrent = true;
  };
  const chordDistance = (px, py, ax, ay, bx, by) => {
    const dx = bx - ax,
      dy = by - ay,
      l2 = dx * dx + dy * dy;
    if (l2 <= 1e-16) return Math.hypot(px - ax, py - ay);
    const u = ((px - ax) * dx + (py - ay) * dy) / l2;
    return Math.hypot(px - (ax + dx * u), py - (ay + dy * u));
  };

  const flattenQuadratic = (x0, y0, x1, y1, x2, y2, depth) => {
    if (depth >= depthCap || chordDistance(x1, y1, x0, y0, x2, y2) <= tol) {
      push(x2, y2);
      return;
    }
    const ax = (x0 + x1) * 0.5,
      ay = (y0 + y1) * 0.5,
      bx = (x1 + x2) * 0.5,
      by = (y1 + y2) * 0.5,
      mx = (ax + bx) * 0.5,
      my = (ay + by) * 0.5;
    flattenQuadratic(x0, y0, ax, ay, mx, my, depth + 1);
    flattenQuadratic(mx, my, bx, by, x2, y2, depth + 1);
  };
  const flattenCubic = (x0, y0, x1, y1, x2, y2, x3, y3, depth) => {
    const flat = Math.max(chordDistance(x1, y1, x0, y0, x3, y3), chordDistance(x2, y2, x0, y0, x3, y3));
    if (depth >= depthCap || flat <= tol) {
      push(x3, y3);
      return;
    }
    const ax = (x0 + x1) * 0.5,
      ay = (y0 + y1) * 0.5,
      bx = (x1 + x2) * 0.5,
      by = (y1 + y2) * 0.5,
      cx = (x2 + x3) * 0.5,
      cy = (y2 + y3) * 0.5;
    const dx = (ax + bx) * 0.5,
      dy = (ay + by) * 0.5,
      ex = (bx + cx) * 0.5,
      ey = (by + cy) * 0.5,
      mx = (dx + ex) * 0.5,
      my = (dy + ey) * 0.5;
    flattenCubic(x0, y0, ax, ay, dx, dy, mx, my, depth + 1);
    flattenCubic(mx, my, ex, ey, cx, cy, x3, y3, depth + 1);
  };
  const api = {
    points,
    setQuality(tolerance = 0.22, maxDepth = 8) {
      tol = Math.max(0.04, Math.min(0.7, Number(tolerance) || 0.22));
      depthCap = Math.max(4, Math.min(11, Math.round(Number(maxDepth) || 8)));
      return api;
    },
    reset() {
      points.length = 0;
      pointCursor = 0;
      hasCurrent = false;
      hasStart = false;
      currentX = currentY = startX = startY = 0;
      return api;
    },
    moveTo(x, y) {
      hasCurrent = false;
      push(x, y);
      startX = currentX;
      startY = currentY;
      hasStart = true;
    },
    lineTo(x, y) {
      push(x, y);
    },
    bezierCurveTo(c1x, c1y, c2x, c2y, x, y) {
      const x3 = Number(x) || 0,
        y3 = Number(y) || 0;
      if (!hasCurrent) {
        push(x3, y3);
        return;
      }
      flattenCubic(
        currentX,
        currentY,
        Number(c1x) || 0,
        Number(c1y) || 0,
        Number(c2x) || 0,
        Number(c2y) || 0,
        x3,
        y3,
        0,
      );
    },
    quadraticCurveTo(cx, cy, x, y) {
      const x2 = Number(x) || 0,
        y2 = Number(y) || 0;
      if (!hasCurrent) {
        push(x2, y2);
        return;
      }
      flattenQuadratic(currentX, currentY, Number(cx) || 0, Number(cy) || 0, x2, y2, 0);
    },
    closePath() {
      if (hasCurrent && hasStart && Math.hypot(currentX - startX, currentY - startY) > 1e-8)
        push(startX, startY);
    },
  };
  return api;
}
function highPrecisionGlintTolerance(layer) {
  const z = Math.max(0.2, Math.min(5, Number(state?.zoom) || 1)),
    ls = Math.max(0.15, Math.min(8, Math.abs(Number(layer?.scale) || 1))),
    screenScale = z * ls;
  if (screenScale >= 4) return 0.07;
  if (screenScale >= 2) return 0.11;
  if (screenScale >= 1) return 0.19;
  if (screenScale >= 0.5) return 0.3;
  return 0.48;
}
function acquireHighPrecisionGlintSampler(path, dynamicSource, tolerance = 0.22) {
  if (dynamicSource && path && typeof path === 'object') {
    let sampler = dynamicHighPrecisionGlintSamplerCache.get(path);
    if (!sampler) {
      sampler = createSweepHighPrecisionSampler(tolerance, 8);
      dynamicHighPrecisionGlintSamplerCache.set(path, sampler);
    }
    return sampler.setQuality(tolerance, 8).reset();
  }
  return createSweepHighPrecisionSampler(tolerance, 8);
}
function buildHighPrecisionGlintPaths(frameCtx) {
  const source = getLayerFrameAuxiliaryPaths(frameCtx),
    layer = frameCtx?.layer;
  if (!Array.isArray(source) || !source.length || !layer) return source || [];
  const round = getRoundingStrength(layer.rounding),
    glintTolerance = highPrecisionGlintTolerance(layer);
  const dynamicSource =
    isCurrentFrameDynamicPathList(source) ||
    Boolean(runtimeState.morph?.active && state.morph?.mode !== 'light');

  if (source.every((path) => path?._stableRoundedSplineRail === true || path?._greenRenderedRail === true))
    return source;
  if (!dynamicSource && round <= 0.001 && source.every((path) => !useSmoothSplinePath(layer, round, path)))
    return source;
  const staticCacheable = !dynamicSource && !isSpiralLayer(layer);
  const staticKey = staticCacheable
    ? `${normalizeSplineRenderMode(layer?.splineRenderMode)}|${layer?.profileMode || 'segments'}|shape:${layer?.roundingShape || 'spline'}|r:${round.toFixed(5)}|tol:${glintTolerance.toFixed(2)}|fourier:${state.fourierMode ? 1 : 0}:${Math.round((Number(state.fourierStrength) || 0) * 100) / 100}`
    : '';
  if (staticCacheable) {
    const variants = persistentHighPrecisionGlintCache.get(source),
      hit = variants?.get(staticKey);
    if (hit) return hit;
  }

  if (isSpiralLayer(layer)) {
    const out = source.map((path) => {
      let pts = path?.points || [];
      if (round > 0.001 && Array.isArray(path?.cornerFlags) && path.cornerFlags.some(Boolean))
        pts = smoothMorphPath(pts, false, round, path.cornerFlags);
      if (state.fourierMode && pts?._fourierPrepared !== true)
        pts = buildFourierWavePoints(pts, false, `sweep-spiral:${round.toFixed(4)}`);
      return { ...path, points: pts, cornerFlags: [] };
    });
    if (isCurrentFrameDynamicPathList(source)) out._frameGeometryId = frameGeometryRuntime.frameId;
    return out;
  }
  let morphInfo = null;
  if (runtimeState.morph?.active && state.morph?.mode !== 'light') {
    const t = Number.isFinite(Number(runtimeState.morph.geometryT))
      ? Number(runtimeState.morph.geometryT)
      : Number(runtimeState.morph.progress) || 0;
    morphInfo = getLampMorphRenderInfo(frameCtx.layerIndex, t, layer);
  }
  const out = source.map((path) => {
    const pts = path?.points || [];
    if (pts.length < 2) return path;
    const sampler = acquireHighPrecisionGlintSampler(path, dynamicSource, glintTolerance);
    if (morphInfo) {
      drawMorphPathQuality(
        sampler,
        pts,
        Boolean(path.closed),
        morphInfo.roundingFrac,
        morphInfo.profileMode,
        morphInfo.splineBlend,
        morphInfo.continuousProfileBlend,
        morphInfo.splineRenderMode,
        path.cornerFlags || [],
        path.bridgeRoundFlags || [],
        layer?.wholeCurveSpline === true,
        0,
        0,
        layer,
      );
    } else if (useSmoothSplinePath(layer, round, path)) {
      splinePathForDraw(
        sampler,
        pts,
        Boolean(path.closed),
        round,
        path.cornerFlags || [],
        path.bridgeRoundFlags || [],
        layer.wholeCurveSpline === true,
        1,
        0,
        layer,
      );
    } else {
      roundPolylineForDraw(
        sampler,
        pts,
        Boolean(path.closed),
        round,
        path.cornerFlags || [],
        null,
        false,
        null,
        layer,
      );
    }
    return { ...path, points: sampler.points.length > 1 ? sampler.points : pts, cornerFlags: [] };
  });
  if (isCurrentFrameDynamicPathList(source)) out._frameGeometryId = frameGeometryRuntime.frameId;
  if (staticCacheable) {
    let variants = persistentHighPrecisionGlintCache.get(source);
    if (!variants) {
      variants = new Map();
      persistentHighPrecisionGlintCache.set(source, variants);
    }
    variants.set(staticKey, out);
  }
  return out;
}

export {
  buildHighPrecisionGlintPaths,
  buildWrappedSweepPieces,
  effectiveGlintType,
  getSweepSegmentsForPath,
  getSweepTargetVelocity,
  isHighPrecisionGlint,
  normalizeGlintPrecisionValue,
  sampleSweepRange,
  sweepStableUnit,
};
