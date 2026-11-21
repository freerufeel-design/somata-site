// Лампы: привязка к отрисованным путям, опорные точки на окружности.
import '../ui/audio-routing-panel.js'; // initialisation order: this module runs after it
import { lampPointAtFraction } from './lamp-attachment.js';
import { roundPolylineForDraw } from '../geometry/polyline-rounding.js';
import { gcd, getLampEvaluationConfig } from '../core/defaults-layers.js';
import { MAX_ROUNDING_PERCENT, getRoundingStrength, interpolateMorphRounding } from '../core/palette.js';
import { runtimeState, state } from '../core/state.js';
import {
  getCachedLayerDrawData,
  getEffectiveLayerRadius,
  layerGeometrySignature,
} from '../effects/motion.js';
import { frameGeometryRuntime, isCurrentFrameDynamicPathList } from '../geometry/frame-paths.js';
import {
  drawMorphPathQuality,
  isMixedSplineSegmentTransition,
  morphSplineBlend,
  resolveMorphProfileModeForRender,
  smoothMorphPath,
} from '../geometry/morph.js';
import { normalizeSplineRenderMode, useSmoothSplinePath } from '../geometry/profile-model.js';
import { splinePathForDraw } from '../geometry/spline-rounding.js';
import { buildExactSpiralEffectPaths } from '../geometry/spiral/effect-rails.js';
import { isSpiralLayer } from '../geometry/spiral/order-params.js';
import { buildChaosVertexIndices } from '../geometry/chaos-star.js';

const lampAnchorCache = new WeakMap();
const persistentLampRenderedPathsCache = new WeakMap();
function isLampContourAttachmentEnabled() {
  const cfg = getLampEvaluationConfig() || state.lamps || (state.lamps = {});
  if (typeof cfg.snapToContour === 'boolean') return cfg.snapToContour;
  if (typeof cfg.snapToPolygon === 'boolean' && typeof cfg.stickToRounding === 'boolean')
    return cfg.snapToPolygon || cfg.stickToRounding;
  if (typeof cfg.snapToPolygon === 'boolean') return cfg.snapToPolygon;
  if (typeof cfg.stickToRounding === 'boolean') return cfg.stickToRounding;
  return true;
}
function setLampContourAttachmentEnabled(enabled) {
  const cfg = getLampEvaluationConfig() || state.lamps || (state.lamps = {});
  const on = enabled !== false;
  cfg.snapToContour = on;

  cfg.snapToPolygon = on;
  cfg.stickToRounding = on;
  return on;
}
function createLampRenderedPathSampler() {
  const points = [];
  let current = null,
    first = null;
  const push = (x, y) => {
    const p = { x: Number(x) || 0, y: Number(y) || 0 };
    const last = points[points.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 1e-7) points.push(p);
    current = p;
    if (!first) first = p;
  };
  const api = {
    points,
    moveTo(x, y) {
      current = null;
      first = null;
      push(x, y);
    },
    lineTo(x, y) {
      if (!current) {
        push(x, y);
        return;
      }
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

      const steps = 12;
      for (let i = 1; i <= steps; i++) {
        const t = i / steps,
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

      const steps = 10;
      for (let i = 1; i <= steps; i++) {
        const t = i / steps,
          u = 1 - t;
        push(u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x, u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y);
      }
    },
    closePath() {
      /* path.closed closes the sampled rail without duplicating point 0 */
    },
  };
  return api;
}
function getLampMorphRenderInfo(layerIndex, t, layer) {
  const u = Math.max(0, Math.min(1, Number(t) || 0));
  const srcLayer = runtimeState.morph.renderSourceLayers?.[layerIndex] || null;
  const dstLayer = runtimeState.morph.renderTargetLayers?.[layerIndex] || null;
  const srcMode =
    runtimeState.morph.sourceProfiles?.[layerIndex]?.mode ||
    srcLayer?.profileMode ||
    layer?.profileMode ||
    'segments';
  const dstMode = runtimeState.morph.targetProfiles?.[layerIndex]?.mode || dstLayer?.profileMode || srcMode;
  const srcR = Math.max(
    0,
    Math.min(
      MAX_ROUNDING_PERCENT,
      Number(
        srcLayer?.rounding ?? runtimeState.morph.sourceVisuals?.[layerIndex]?.rounding ?? layer?.rounding,
      ) || 0,
    ),
  );
  const dstR = Math.max(
    0,
    Math.min(
      MAX_ROUNDING_PERCENT,
      Number(
        dstLayer?.rounding ?? runtimeState.morph.targetVisuals?.[layerIndex]?.rounding ?? layer?.rounding,
      ) || 0,
    ),
  );
  return {
    profileMode: resolveMorphProfileModeForRender(srcMode, dstMode, u),
    splineBlend: morphSplineBlend(srcMode, dstMode, u),
    continuousProfileBlend: isMixedSplineSegmentTransition(srcMode, dstMode),
    splineRenderMode: layer?.splineRenderMode,
    roundingFrac: interpolateMorphRounding(srcR, dstR, u) / 100,
  };
}
function buildLampRenderedAttachmentPaths(paths, layer, morphInfo = null) {
  const source = Array.isArray(paths) ? paths : [];
  if (!source.length) return source;

  if (!morphInfo && isSpiralLayer(layer) && typeof buildExactSpiralEffectPaths === 'function')
    return buildExactSpiralEffectPaths(source, layer);
  const round = Math.max(
    0,
    Math.min(2, Number(morphInfo?.roundingFrac ?? getRoundingStrength(layer?.rounding)) || 0),
  );
  const dynamic = Boolean(morphInfo) || isCurrentFrameDynamicPathList(source);
  const cacheKey = `${normalizeSplineRenderMode(layer?.splineRenderMode)}|${layer?.profileMode || 'segments'}|shape:${layer?.roundingShape || 'spline'}|corner:${layer?.roundingCornerType || 'classic'}|drop:${layer?.roundingMaxRadiusDrop ?? 30}|spline:${layer?.roundingSmoothSplines === true ? 1 : 0}|filletSteps:${typeof window !== 'undefined' && window.__somataSplineFilletSteps === 8 ? 8 : 16}|filletSweep:${typeof window !== 'undefined' && window.__somataFastFilletSweep === true ? 1 : 0}|${round.toFixed(5)}|fourier:${state.fourierMode ? 1 : 0}`;
  if (!dynamic && source && typeof source === 'object') {
    let variants = persistentLampRenderedPathsCache.get(source);
    const hit = variants?.get(cacheKey);
    if (hit) return hit;
    const built = buildLampRenderedAttachmentPathsUncached(source, layer, morphInfo, round);
    if (!variants) {
      variants = new Map();
      persistentLampRenderedPathsCache.set(source, variants);
    }
    variants.set(cacheKey, built);
    return built;
  }
  return buildLampRenderedAttachmentPathsUncached(source, layer, morphInfo, round);
}
function buildLampRenderedAttachmentPathsUncached(source, layer, morphInfo, round) {
  const out = source.map((path) => {
    const pts = path?.points || [];
    if (pts.length < 2 || path.profileCurveBaked) return path;
    const sampler = createLampRenderedPathSampler();
    const effectiveRound = isSpiralLayer(layer) && path?.spiralProfileRoundingBaked === true ? 0 : round;
    if (morphInfo) {
      drawMorphPathQuality(
        sampler,
        pts,
        Boolean(path.closed),
        effectiveRound,
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
    } else if (useSmoothSplinePath(layer, effectiveRound, path)) {
      splinePathForDraw(
        sampler,
        pts,
        Boolean(path.closed),
        effectiveRound,
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
        effectiveRound,
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
  return out;
}
function nearestPointOnLampPaths(anchor, paths, roundingFrac, useRoundedPath) {
  let best = { x: Number(anchor.x) || 0, y: Number(anchor.y) || 0 },
    bestD = Infinity;
  for (const path of paths || []) {
    let pts = path.points || [];
    if (useRoundedPath && roundingFrac > 0.001 && pts.length > 2) {
      pts = smoothMorphPath(pts, path.closed, roundingFrac, path.cornerFlags || []);
    }
    if (pts.length < 2) continue;
    const count = path.closed ? pts.length : pts.length - 1;
    for (let i = 0; i < count; i++) {
      const a = pts[i],
        b = pts[(i + 1) % pts.length];
      const vx = b.x - a.x,
        vy = b.y - a.y,
        den = vx * vx + vy * vy;
      const u =
        den > 1e-12 ? Math.max(0, Math.min(1, ((anchor.x - a.x) * vx + (anchor.y - a.y) * vy) / den)) : 0;
      const px = a.x + vx * u,
        py = a.y + vy * u,
        dx = px - anchor.x,
        dy = py - anchor.y,
        d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = { x: px, y: py };
      }
    }
  }
  return best;
}
function nearestPointOnLampPathsWithIndex(anchor, paths, orbitIndex = null) {
  let best = {
    point: { x: Number(anchor?.x) || 0, y: Number(anchor?.y) || 0 },
    pathIndex: -1,
    distanceSq: Infinity,
  };
  for (let pi = 0; pi < (paths?.length || 0); pi++) {
    const path = paths[pi];
    if (
      orbitIndex !== null &&
      Number.isFinite(Number(orbitIndex)) &&
      Number(path?.orbitIndex) !== Number(orbitIndex)
    )
      continue;
    const pts = path?.points || [];
    if (pts.length < 2) continue;
    const count = path.closed ? pts.length : pts.length - 1;
    for (let i = 0; i < count; i++) {
      const a = pts[i],
        b = pts[(i + 1) % pts.length],
        vx = b.x - a.x,
        vy = b.y - a.y,
        den = vx * vx + vy * vy;
      const u =
        den > 1e-12
          ? Math.max(
              0,
              Math.min(
                1,
                (((Number(anchor?.x) || 0) - a.x) * vx + ((Number(anchor?.y) || 0) - a.y) * vy) / den,
              ),
            )
          : 0;
      const x = a.x + vx * u,
        y = a.y + vy * u,
        dx = x - (Number(anchor?.x) || 0),
        dy = y - (Number(anchor?.y) || 0),
        d = dx * dx + dy * dy;
      if (d < best.distanceSq) best = { point: { x, y }, pathIndex: pi, distanceSq: d };
    }
  }
  if (best.pathIndex < 0 && orbitIndex !== null) return nearestPointOnLampPathsWithIndex(anchor, paths, null);
  return best;
}
function dedupeLampPoints(points, maxPoints = 260) {
  const dedup = [],
    seen = new Set();
  for (const p of points || []) {
    const key = `${Math.round((Number(p.x) || 0) * 10)},${Math.round((Number(p.y) || 0) * 10)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    dedup.push({ ...p, x: Number(p.x) || 0, y: Number(p.y) || 0 });
  }
  if (dedup.length <= maxPoints) return dedup;
  const out = [],
    step = dedup.length / maxPoints;
  for (let i = 0; i < maxPoints; i++) out.push(dedup[Math.floor(i * step)]);
  return out;
}
function dedupeSpiralLampPoints(points, maxPoints = 260) {
  const kept = [],
    endpointSeen = new Set(),
    idSeen = new Set();
  for (const src of points || []) {
    const p = { ...src, x: Number(src?.x) || 0, y: Number(src?.y) || 0 };
    const id = String(p.lampId || '');
    if (id && idSeen.has(id)) continue;
    if (id) idSeen.add(id);
    const endpoint = p.lampEndpointRole === 'start' || p.lampEndpointRole === 'end';
    if (endpoint) {
      const orbit = Number.isFinite(Number(p.orbitIndex)) ? Number(p.orbitIndex) : -1;
      const key = `${orbit}:${Math.round(p.x * 10)},${Math.round(p.y * 10)}`;
      if (endpointSeen.has(key)) continue;
      endpointSeen.add(key);
    }
    kept.push(p);
  }
  if (kept.length <= maxPoints) return kept;

  const out = [],
    step = kept.length / maxPoints;
  for (let i = 0; i < maxPoints; i++) out.push(kept[Math.min(kept.length - 1, Math.floor(i * step))]);
  return out;
}
function lampVertexArcFractions(path, includeClosing = false) {
  const pts = path?.points || [],
    n = pts.length,
    out = new Float64Array(n);
  if (n < 2) return out;
  let total = 0;
  for (let i = 1; i < n; i++) {
    const a = pts[i - 1],
      b = pts[i],
      dx = (Number(b?.x) || 0) - (Number(a?.x) || 0),
      dy = (Number(b?.y) || 0) - (Number(a?.y) || 0);
    total += Math.hypot(dx, dy);
    out[i] = total;
  }
  if (includeClosing && path.closed)
    total += Math.hypot(pts[0].x - pts[n - 1].x, pts[0].y - pts[n - 1].y);
  if (total > 1e-9) for (let i = 1; i < n; i++) out[i] /= total;
  return out;
}
function buildLampCircumferenceAnchors(layer, prepared = null, maxPoints = 260, forceAttach = false, includeProfileCorners = false) {
  if (!layer) return [];
  const drawData = prepared || getCachedLayerDrawData(layer);
  const geometryKey = drawData?.geometryKey || layerGeometrySignature(layer);
  const attach = forceAttach || isLampContourAttachmentEnabled();

  const roundingKey = Math.max(0, Math.min(MAX_ROUNDING_PERCENT, Number(layer.rounding) || 0));

  const spiralSeamShared =
    isSpiralLayer(layer) && state.tunnel?.active === true && layer.spiralClosed !== false;
  const cacheOwner = layer.__somataRenderSource || layer;
  const cacheKey = `key|${layer.id || layer.name || 'layer'}|${geometryKey}|attach:${attach ? 1 : 0}|round:${roundingKey}|corners:${includeProfileCorners}|seam:${spiralSeamShared ? 1 : 0}|max:${maxPoints}`;
  const cached = lampAnchorCache.get(cacheOwner);
  if (cached?.key === cacheKey) return cached.points;

  if (isSpiralLayer(layer)) {
    const all = [],
      layerKey = String(layer?.id || layer?.name || 'layer');
    const paths = drawData?.paths || [];
    const attachmentPaths = attach ? buildLampRenderedAttachmentPaths(paths, layer) : paths;
    for (let pathIndex = 0; pathIndex < paths.length; pathIndex++) {
      const path = paths[pathIndex],
        pts = path?.points || [];
      if (!pts.length) continue;
      const ownRail = attachmentPaths[pathIndex],
        vertexFractions = lampVertexArcFractions(path);
      const pushPoint = (p, vertexIndex, endpointRole = 'interior') => {
        const contourFraction = Math.max(0, Math.min(1, Number(vertexFractions[vertexIndex]) || 0));
        let q = { x: Number(p?.x) || 0, y: Number(p?.y) || 0 };

        if (attach && ownRail?.points?.length > 1) {
          const sampled = lampPointAtFraction(ownRail, contourFraction);
          if (sampled) q = sampled;
        }
        all.push({
          ...p,
          ...q,
          pathIndex,
          vertexIndex,
          orbitIndex: path?.orbitIndex,
          lampContourFraction: contourFraction,
          lampEndpointRole: endpointRole,
          lampId: `key:${pathIndex}:${vertexIndex}`,
          lampSeed: lampHash32(`${layerKey}:key:${pathIndex}:${vertexIndex}`),
        });
      };

      pushPoint(pts[0], 0, 'start');
      if (includeProfileCorners) {
        for (let i = 1; i < pts.length - 1; i++) {
          if (path.lampCornerFlags?.[i] || pts[i].__profileKeyCorner === true) pushPoint(pts[i], i);
        }
      }
      if (pts.length > 1 && !spiralSeamShared) pushPoint(pts[pts.length - 1], pts.length - 1, 'end');
    }
    const points = dedupeSpiralLampPoints(all, maxPoints);
    lampAnchorCache.set(cacheOwner, { key: cacheKey, points });
    return points;
  }

  const N = Math.max(2, Math.round(Number(layer.N) || 4));
  const K = Math.max(1, Math.min(Math.floor(N / 2), Math.round(Number(layer.K) || 1)));
  const R = getEffectiveLayerRadius(layer, 220);
  const rot = ((Number(layer.rotation) || 0) * Math.PI) / 180;
  const maxSub = Math.max(1, gcd(N, K));
  let activeSub = maxSub;
  if (layer.customSuborbits !== null && layer.customSuborbits !== undefined)
    activeSub = Math.max(1, Math.min(Number(layer.customSuborbits) || 1, maxSub));
  const vpo = Math.max(2, N / maxSub),
    stepAngle = (2 * Math.PI) / N;
  const raw = [],
    layerKey = String(layer?.id || layer?.name || 'layer');
  if (layer.chaosStar === true) {
    const indices = buildChaosVertexIndices(layer, N, K);
    for (let step = 0; step < indices.length; step++) {
      const idx = indices[step],
        a = idx * stepAngle + rot - Math.PI / 2;
      raw.push({
        x: R * Math.cos(a),
        y: R * Math.sin(a),
        pathIndex: 0,
        vertexIndex: step,
        lampId: `key:chaos:${step}`,
        lampSeed: lampHash32(`${layerKey}:key:chaos:${step}`),
      });
    }
  } else {
    for (let sIdx = 0; sIdx < activeSub; sIdx++) {
      const g = Math.round((sIdx * maxSub) / activeSub) % maxSub;
      for (let step = 0; step < vpo; step++) {
        const idx = (g + step * K) % N,
          a = idx * stepAngle + rot - Math.PI / 2;
        raw.push({
          x: R * Math.cos(a),
          y: R * Math.sin(a),
          pathIndex: sIdx,
          vertexIndex: step,
          lampId: `key:${sIdx}:${step}`,
          lampSeed: lampHash32(`${layerKey}:key:${sIdx}:${step}`),
        });
      }
    }
  }

  const attachmentPaths = attach
    ? buildLampRenderedAttachmentPaths(drawData?.paths || [], layer)
    : drawData?.paths || [];

  const projected = !attach
    ? raw
    : raw.map((a) => {
        const hit = nearestPointOnLampPathsWithIndex(a, attachmentPaths, a.pathIndex);
        return {
          ...a,
          ...hit.point,
          orbitIndex: a.pathIndex,
          pathIndex: hit.pathIndex >= 0 ? hit.pathIndex : a.pathIndex,
        };
      });
  const points = dedupeLampPoints(projected, maxPoints);
  lampAnchorCache.set(cacheOwner, { key: cacheKey, points });
  return points;
}
function lampHash32(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export {
  buildLampCircumferenceAnchors,
  buildLampRenderedAttachmentPaths,
  buildLampRenderedAttachmentPathsUncached,
  createLampRenderedPathSampler,
  dedupeLampPoints,
  getLampMorphRenderInfo,
  isLampContourAttachmentEnabled,
  lampAnchorCache,
  lampHash32,
  lampVertexArcFractions,
  nearestPointOnLampPaths,
  setLampContourAttachmentEnabled,
};
