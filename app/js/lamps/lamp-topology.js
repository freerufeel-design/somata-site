// Лампы: топологический и линейный морф — опоры, линии наследования, ключевые точки.
import './lamp-points.js'; // initialisation order: this module runs after it
import { getTapMorphIntervalSec } from '../audio/tap-tempo.js';
import { getLampEvaluationConfig, withLampConfig } from '../core/defaults-layers.js';
import { runtimeState, state } from '../core/state.js';
import { getEffectiveLayerRadius } from '../effects/motion.js';
import {
  buildCurrentMorphPaths,
  buildCurrentMorphPathsForLamps,
  getCurrentMorphCpuPaths,
} from '../geometry/frame-paths.js';
import {
  angularDistance,
  buildCircleAnchors,
  getChaosCircleMorphPlan,
  getCircleMorphPlan,
  getMorphReferenceVertexOffset,
  interpolateMorphPolarAngle,
  pairMorphPaths,
  pathReferenceAngle,
  rotateMorphPath,
  signedAngleDelta,
} from '../geometry/morph.js';
import { buildOrbitPolylines } from '../geometry/orbit-builder.js';
import { isSpiralLayer } from '../geometry/spiral/order-params.js';
import {
  buildLampRenderedAttachmentPaths,
  dedupeLampPoints,
  getLampMorphRenderInfo,
  isLampContourAttachmentEnabled,
  lampHash32,
} from './lamp-anchors.js';
import {
  lampEndpointTravelProgress,
  lampMotionRuntime,
  lampTopologyPresence,
  lampVisualNow,
  preserveBlueMorphLampIdentity,
} from './lamp-motion.js';
import {
  interpolateLampRenderSegmentParam,
  interpolateLampSegmentRefs,
  lampPhaseInertiaProgress,
  lampRenderSegmentParam,
  mergeLampKeysAndBends,
  nearestLampFractionOnPath,
  nearestLampSegmentRefOnPath,
} from './lamp-attachment.js';
import {
  bindOpenCircleLampEdges,
  capLampPointList,
  collectArbitraryMorphLampPoints,
  collectSmoothCornerLampPoints,
  projectLampPointsToCurrentPolygon,
  projectMorphKeyLamps,
} from './lamp-points.js';
import { lampEffectiveBokeh } from './lamp-visual.js';
import {
  buildCurrentChaosCircleMorphPaths,
  buildCurrentCircleMorphPaths,
  isChaosCircleMorphPair,
} from '../effects/aux-paths.js';

const topologyLampAnchorPathsCache = new WeakMap();
function buildTopologyLampAnchorPaths(layer) {
  if (layer && typeof layer === 'object') {
    const hit = topologyLampAnchorPathsCache.get(layer);
    if (hit) return hit;
  }
  const paths = (buildCircleAnchors(layer) || [])
    .map((orbit, pathIndex) => ({
      points: (orbit.points || []).map((p, vertexIndex) => ({ x: p.x, y: p.y, pathIndex, vertexIndex })),
      closed: true,
    }))
    .filter((p) => p.points.length > 1);
  if (layer && typeof layer === 'object') topologyLampAnchorPathsCache.set(layer, paths);
  return paths;
}
function sampleLampClosedAnchor(points, fraction) {
  const pts = Array.isArray(points) ? points : [];
  const n = pts.length;
  if (!n) return { x: 0, y: 0 };
  if (n === 1) return { x: Number(pts[0]?.x) || 0, y: Number(pts[0]?.y) || 0 };
  let f = Number(fraction) || 0;
  f = ((f % 1) + 1) % 1;
  const pos = f * n,
    i0 = Math.floor(pos) % n,
    i1 = (i0 + 1) % n,
    u = pos - Math.floor(pos),
    a = pts[i0],
    b = pts[i1];
  return {
    x: (Number(a?.x) || 0) + ((Number(b?.x) || 0) - (Number(a?.x) || 0)) * u,
    y: (Number(a?.y) || 0) + ((Number(b?.y) || 0) - (Number(a?.y) || 0)) * u,
  };
}
function sampleLampClosedAngle(angles, fraction) {
  const src = Array.isArray(angles) ? angles : [];
  const n = src.length;
  if (!n) return 0;
  if (n === 1) return Number(src[0]) || 0;
  let f = Number(fraction) || 0;
  f = ((f % 1) + 1) % 1;
  const pos = f * n,
    i0 = Math.floor(pos) % n,
    i1 = (i0 + 1) % n,
    u = pos - Math.floor(pos),
    a = Number(src[i0]) || 0,
    b = Number(src[i1]) || 0;
  return a + signedAngleDelta(a, b) * u;
}
function buildNonCollapsingLampAnglePlan(srcAngles, dstAngles) {
  const sa = Array.isArray(srcAngles) ? srcAngles : [],
    da = Array.isArray(dstAngles) ? dstAngles : [],
    ns = sa.length,
    nd = da.length,
    n = Math.max(ns, nd);
  const from = new Array(n),
    to = new Array(n);
  for (let i = 0; i < n; i++) {
    from[i] = i < ns ? Number(sa[i]) || 0 : sampleLampClosedAngle(sa, nd > 0 ? i / nd : i / n);
    to[i] = i < nd ? Number(da[i]) || 0 : sampleLampClosedAngle(da, ns > 0 ? i / ns : i / n);
  }
  return { from, to };
}
function sampleLampTopologyPath(path, fraction) {
  const pts = path?.points || [];
  const n = pts.length;
  if (!n) return null;
  if (n === 1) return { x: Number(pts[0].x) || 0, y: Number(pts[0].y) || 0 };
  let f = Number(fraction) || 0;
  if (path?.closed) {
    f = ((f % 1) + 1) % 1;
    const pos = f * n,
      i0 = Math.floor(pos) % n,
      i1 = (i0 + 1) % n,
      u = pos - Math.floor(pos),
      a = pts[i0],
      b = pts[i1];
    return {
      x: (Number(a.x) || 0) + ((Number(b.x) || 0) - (Number(a.x) || 0)) * u,
      y: (Number(a.y) || 0) + ((Number(b.y) || 0) - (Number(a.y) || 0)) * u,
    };
  }
  f = Math.max(0, Math.min(1, f));
  const pos = f * (n - 1),
    i0 = Math.min(n - 2, Math.floor(pos)),
    i1 = i0 + 1,
    u = pos - i0,
    a = pts[i0],
    b = pts[i1];
  return {
    x: (Number(a.x) || 0) + ((Number(b.x) || 0) - (Number(a.x) || 0)) * u,
    y: (Number(a.y) || 0) + ((Number(b.y) || 0) - (Number(a.y) || 0)) * u,
  };
}
function buildLampTopologyPhaseSlots(sourceCount, targetCount, closed = true) {
  const slots = new Map();
  const add = (count, key) => {
    count = Math.max(0, Math.round(Number(count) || 0));
    if (!count) return;
    for (let i = 0; i < count; i++) {
      const f = closed ? i / count : count <= 1 ? 0 : i / (count - 1);
      const q = Math.round(f * 1000000);
      let rec = slots.get(q);
      if (!rec) {
        rec = { fraction: f, sourcePresent: false, targetPresent: false };
        slots.set(q, rec);
      }
      rec[key] = true;
    }
  };
  add(sourceCount, 'sourcePresent');
  add(targetCount, 'targetPresent');
  return [...slots.values()].sort((a, b) => a.fraction - b.fraction);
}
function buildLampKeyPointSamples(path, count, layerKey = '', pathIndex = 0) {
  count = Math.max(0, Math.round(Number(count) || 0));
  if (!path || !count) return [];
  const closed = Boolean(path.closed),
    out = [];
  for (let i = 0; i < count; i++) {
    const f = closed ? i / count : count <= 1 ? 0 : i / (count - 1);
    const p = sampleLampTopologyPath(path, f);
    if (p)
      out.push({
        x: Number(p.x) || 0,
        y: Number(p.y) || 0,
        keyIndex: i,
        lampSeed: lampHash32(`${layerKey || 'layer'}:key:${pathIndex}:${i}`),
      });
  }
  return out;
}
function nearestLampKeyInfo(point, keyPoints) {
  if (!point || !Array.isArray(keyPoints) || !keyPoints.length) return null;
  const x = Number(point.x) || 0,
    y = Number(point.y) || 0;
  let best = null,
    bestD2 = Infinity;
  for (const q of keyPoints) {
    const dx = x - (Number(q?.x) || 0),
      dy = y - (Number(q?.y) || 0),
      d2 = dx * dx + dy * dy;
    if (d2 < bestD2) {
      bestD2 = d2;
      best = q;
    }
  }
  return best ? { point: best, distance: Math.sqrt(bestD2) } : null;
}
function nearestLampKeyDistance(point, keyPoints) {
  const hit = nearestLampKeyInfo(point, keyPoints);
  return hit ? hit.distance : Infinity;
}
function lampNominalKeyRadius(keyPoint, cfg = getLampEvaluationConfig()) {
  const radiusMult = Math.max(0, Number(cfg?.radiusMultiplier ?? 1) || 0);
  const baseR = Math.max(1, (Number(cfg?.radius) || 50) * radiusMult);
  const seed = Number.isFinite(Number(keyPoint?.lampSeed)) ? Number(keyPoint.lampSeed) >>> 0 : 0;
  const bokeh = lampEffectiveBokeh(cfg || {});
  const sizeRandom = Math.max(
    0.12,
    1 + (lampSeedUnit(seed, 3) * 2 - 1) * Math.max(0, Number(bokeh?.sizeVar) || 0) * 0.78,
  );
  const morphSize = Math.max(0, Math.min(1, (Number(cfg?.morphSize) || 0) / 100));
  const sizeMorph = Math.max(0.12, 1 + lampMorphWave(seed, 5) * morphSize);
  return Math.max(1e-6, baseR * sizeRandom * sizeMorph);
}
function lampNearestKeyPresence(
  sourcePresent,
  targetPresent,
  currentPoint,
  sourcePoint,
  targetPoint,
  sourceKeys,
  targetKeys,
  fallbackProgress = 0,
) {
  if (getLampEvaluationConfig()?.morphMotionMode !== 'ghost' || !runtimeState.morph?.active) return 1;
  const u = Math.max(0, Math.min(1, Number(fallbackProgress) || 0));
  if (sourcePresent && targetPresent) return 1;
  if (!sourcePresent && targetPresent) {
    const startDist = nearestLampKeyDistance(sourcePoint || currentPoint, targetKeys);
    const nowDist = nearestLampKeyDistance(currentPoint, targetKeys);
    if (!Number.isFinite(startDist) || !Number.isFinite(nowDist)) return u;
    if (startDist <= 1e-6) return 1;
    return Math.max(0, Math.min(1, 1 - nowDist / startDist));
  }
  if (sourcePresent && !targetPresent) {
    const endDist = nearestLampKeyDistance(targetPoint || currentPoint, sourceKeys);
    const nowDist = nearestLampKeyDistance(currentPoint, sourceKeys);
    if (!Number.isFinite(endDist) || !Number.isFinite(nowDist)) return 1 - u;
    if (endDist <= 1e-6) return 1 - u;
    return Math.max(0, Math.min(1, 1 - nowDist / endDist));
  }
  return 0;
}
function lampLinearGateStore(layerKey) {
  const serial = Math.max(0, Number(runtimeState.morph?.lampCycleSerial) || 0);
  const key = String(layerKey || 'layer');
  let rt = lampMotionRuntime.linearGates.get(key);
  if (!rt || rt.serial !== serial) {
    rt = { serial, gates: new Map() };
    lampMotionRuntime.linearGates.set(key, rt);
  }
  return rt.gates;
}
function lampLinearSplitMergePresence(
  sourcePresent,
  targetPresent,
  currentPoint,
  sourcePoint,
  targetPoint,
  sourceKeys,
  targetKeys,
  travelProgress = 0,
  layerKey = 'layer',
  gateKey = '',
) {
  if (!['key', 'linear'].includes(getLampEvaluationConfig()?.morphMotionMode) || !runtimeState.morph?.active) return 1;
  const fallback = Math.max(0, Math.min(1, Number(travelProgress) || 0));
  if (fallback <= 1e-6) return sourcePresent ? 1 : 0;
  if (fallback >= 1 - 1e-6) return targetPresent ? 1 : 0;
  if (sourcePresent && targetPresent) return 1;
  const gates = lampLinearGateStore(layerKey);
  const kind = !sourcePresent && targetPresent ? 'split' : sourcePresent && !targetPresent ? 'merge' : 'none';
  const id = `${kind}:${gateKey}`;
  let gate = gates.get(id);
  const px = Number(currentPoint?.x) || 0,
    py = Number(currentPoint?.y) || 0;
  const sx = Number(sourcePoint?.x) || 0,
    sy = Number(sourcePoint?.y) || 0;
  const tx = Number(targetPoint?.x) || 0,
    ty = Number(targetPoint?.y) || 0;
  const clamp01 = (v) => Math.max(0, Math.min(1, Number(v) || 0));

  if (kind === 'split') {
    if (!gate) {
      const parent = nearestLampKeyInfo(sourcePoint || currentPoint, sourceKeys);
      const parentX = parent ? Number(parent.point?.x) || 0 : NaN;
      const parentY = parent ? Number(parent.point?.y) || 0 : NaN;
      const parentRadius = parent ? lampNominalKeyRadius(parent.point, getLampEvaluationConfig()) : NaN;
      const startX = Number.isFinite(Number(sourcePoint?.x)) ? sx : px;
      const startY = Number.isFinite(Number(sourcePoint?.y)) ? sy : py;
      const startParentDist = Number.isFinite(parentX) ? Math.hypot(startX - parentX, startY - parentY) : NaN;
      const ownTargetX = Number.isFinite(Number(targetPoint?.x)) ? tx : px;
      const ownTargetY = Number.isFinite(Number(targetPoint?.y)) ? ty : py;
      const ownStartDist = Math.hypot(ownTargetX - startX, ownTargetY - startY);
      gate = {
        parentX,
        parentY,
        parentRadius,
        startParentDist,
        startX,
        startY,
        targetX: ownTargetX,
        targetY: ownTargetY,
        ownStartDist,
      };
      gates.set(id, gate);
    }

    const ownRemaining =
      Number.isFinite(gate.targetX) && Number.isFinite(gate.targetY)
        ? Math.hypot(px - gate.targetX, py - gate.targetY)
        : NaN;
    const ownProgress =
      Number.isFinite(ownRemaining) && gate.ownStartDist > 1e-6
        ? clamp01(1 - ownRemaining / gate.ownStartDist)
        : fallback;

    let radiusProgress = 0;
    if (
      Number.isFinite(gate.parentX) &&
      Number.isFinite(gate.parentY) &&
      Number.isFinite(gate.parentRadius)
    ) {
      const d = Math.hypot(px - gate.parentX, py - gate.parentY);
      const d0 = Math.max(0, Number(gate.startParentDist) || 0);
      const span = gate.parentRadius - d0;
      if (span > 1e-6) radiusProgress = clamp01((d - d0) / span);
    }
    const candidate = Math.max(ownProgress, radiusProgress);

    gate.presence = Math.max(Number.isFinite(Number(gate.presence)) ? Number(gate.presence) : 0, candidate);
    return clamp01(gate.presence);
  }

  if (kind === 'merge') {
    if (!gate) {
      const receiver = nearestLampKeyInfo(targetPoint || currentPoint, targetKeys);
      const receiverX = receiver ? Number(receiver.point?.x) || 0 : tx;
      const receiverY = receiver ? Number(receiver.point?.y) || 0 : ty;
      const receiverRadius = receiver ? lampNominalKeyRadius(receiver.point, getLampEvaluationConfig()) : NaN;
      const startX = Number.isFinite(Number(sourcePoint?.x)) ? sx : px;
      const startY = Number.isFinite(Number(sourcePoint?.y)) ? sy : py;
      const ownStartDist = Math.hypot(receiverX - startX, receiverY - startY);
      gate = { receiverX, receiverY, receiverRadius, startX, startY, ownStartDist };
      gates.set(id, gate);
    }
    const d =
      Number.isFinite(gate.receiverX) && Number.isFinite(gate.receiverY)
        ? Math.hypot(px - gate.receiverX, py - gate.receiverY)
        : NaN;
    const ownRemaining =
      Number.isFinite(d) && gate.ownStartDist > 1e-6 ? clamp01(d / gate.ownStartDist) : clamp01(1 - fallback);
    const radiusRemaining =
      Number.isFinite(d) && Number.isFinite(gate.receiverRadius) && gate.receiverRadius > 1e-6
        ? clamp01(d / gate.receiverRadius)
        : ownRemaining;
    const candidate = Math.max(ownRemaining, radiusRemaining);

    gate.presence = Math.min(Number.isFinite(Number(gate.presence)) ? Number(gate.presence) : 1, candidate);
    return clamp01(gate.presence);
  }
  return 0;
}
function buildStableLampKeyLineage(sourcePoints, targetPoints) {
  const src = Array.isArray(sourcePoints) ? sourcePoints : [],
    dst = Array.isArray(targetPoints) ? targetPoints : [];
  const ns = src.length,
    nt = dst.length,
    out = [];
  if (!ns && !nt) return out;
  if (!ns) {
    for (let j = 0; j < nt; j++)
      out.push({ sourceIndex: -1, targetIndex: j, sourcePresent: false, targetPresent: true });
    return out;
  }
  if (!nt) {
    for (let i = 0; i < ns; i++)
      out.push({ sourceIndex: i, targetIndex: -1, sourcePresent: true, targetPresent: false });
    return out;
  }
  const nearestSourceForTarget = (j) => {
    const phase = (j / nt) * ns;
    let best = 0,
      bestD = Infinity;
    for (let i = 0; i < ns; i++) {
      let d = Math.abs(phase - i);
      d = Math.min(d, Math.abs(phase - (i + ns)), Math.abs(phase - (i - ns)));
      if (d < bestD - 1e-9) {
        bestD = d;
        best = i;
      }
    }
    return best;
  };
  const nearestTargetForSource = (i) => {
    const phase = (i / ns) * nt;
    let best = 0,
      bestD = Infinity;
    for (let j = 0; j < nt; j++) {
      let d = Math.abs(phase - j);
      d = Math.min(d, Math.abs(phase - (j + nt)), Math.abs(phase - (j - nt)));
      if (d < bestD - 1e-9) {
        bestD = d;
        best = j;
      }
    }
    return best;
  };
  if (nt >= ns) {
    const survivorForTarget = new Map(),
      used = new Set();
    for (let i = 0; i < ns; i++) {
      const ideal = (i / ns) * nt;
      let best = -1,
        bestD = Infinity;
      for (let j = 0; j < nt; j++) {
        if (used.has(j)) continue;
        let d = Math.abs(ideal - j);
        d = Math.min(d, Math.abs(ideal - (j + nt)), Math.abs(ideal - (j - nt)));
        if (d < bestD - 1e-9) {
          bestD = d;
          best = j;
        }
      }
      if (best < 0) best = nearestTargetForSource(i);
      used.add(best);
      survivorForTarget.set(best, i);
    }
    for (let j = 0; j < nt; j++) {
      const survivor = survivorForTarget.has(j);
      const si = survivor ? survivorForTarget.get(j) : nearestSourceForTarget(j);
      out.push({ sourceIndex: si, targetIndex: j, sourcePresent: survivor, targetPresent: true });
    }
  } else {
    const survivorForSource = new Map(),
      used = new Set();
    for (let j = 0; j < nt; j++) {
      const ideal = (j / nt) * ns;
      let best = -1,
        bestD = Infinity;
      for (let i = 0; i < ns; i++) {
        if (used.has(i)) continue;
        let d = Math.abs(ideal - i);
        d = Math.min(d, Math.abs(ideal - (i + ns)), Math.abs(ideal - (i - ns)));
        if (d < bestD - 1e-9) {
          bestD = d;
          best = i;
        }
      }
      if (best < 0) best = nearestSourceForTarget(j);
      used.add(best);
      survivorForSource.set(best, j);
    }
    for (let i = 0; i < ns; i++) {
      const survivor = survivorForSource.has(i);
      const tj = survivor ? survivorForSource.get(i) : nearestTargetForSource(i);
      out.push({ sourceIndex: i, targetIndex: tj, sourcePresent: true, targetPresent: survivor });
    }
  }
  return out;
}
function getStableTopologyLinearLampPlan(layerIndex, src, dst, base, layerKey) {
  const serial = Math.max(0, Number(runtimeState.morph?.lampCycleSerial) || 0);
  const cacheKey = String(layerKey || base?.id || layerIndex);
  let cached = lampMotionRuntime.topologyLinearPlans.get(cacheKey);
  if (cached && cached.serial === serial) return cached;
  const srcPaths = buildTopologyLampAnchorPaths(src),
    dstPaths = buildTopologyLampAnchorPaths(dst);
  const pairs = srcPaths.length && dstPaths.length ? pairMorphPaths(srcPaths, dstPaths) : [];

  let sourceRenderedRails = [],
    targetRenderedRails = [];

  let sourceMorphEndpointRails = [],
    targetMorphEndpointRails = [];
  try {
    sourceRenderedRails = buildLampRenderedAttachmentPaths(buildOrbitPolylines(src), src, null) || [];
    targetRenderedRails = buildLampRenderedAttachmentPaths(buildOrbitPolylines(dst), dst, null) || [];

    const sourceMorphEndpointPaths = buildCurrentMorphPathsForLamps(layerIndex, 0);
    sourceMorphEndpointRails =
      buildLampRenderedAttachmentPaths(
        sourceMorphEndpointPaths,
        base,
        getLampMorphRenderInfo(layerIndex, 0, base),
      ) || [];
    const targetMorphEndpointPaths = buildCurrentMorphPathsForLamps(layerIndex, 1);
    targetMorphEndpointRails =
      buildLampRenderedAttachmentPaths(
        targetMorphEndpointPaths,
        base,
        getLampMorphRenderInfo(layerIndex, 1, base),
      ) || [];
  } catch (_) {
    sourceRenderedRails = [];
    targetRenderedRails = [];
    sourceMorphEndpointRails = [];
    targetMorphEndpointRails = [];
  }
  const paths = [];
  const makeKey = (p, pathIndex, keyIndex, side) => ({
    x: Number(p?.x) || 0,
    y: Number(p?.y) || 0,
    keyIndex,
    lampSeed: lampHash32(`${cacheKey}:${side}:${pathIndex}:${keyIndex}`),
  });
  for (let pathIndex = 0; pathIndex < pairs.length; pathIndex++) {
    const pair = pairs[pathIndex],
      sp = pair?.src,
      dp = pair?.dst;
    if (!sp && !dp) continue;

    const sourcePathIndex = Math.max(0, srcPaths.indexOf(sp));
    const targetPathIndex = Math.max(0, dstPaths.indexOf(dp));
    const srcPts = sp?.points || [],
      dstPts = dp?.points || [];
    if (!srcPts.length || !dstPts.length) continue;
    const closed = Boolean(sp?.closed && dp?.closed);
    const referenceOffset = getMorphReferenceVertexOffset(
      pair,
      dstPts.length,
      closed,
      dst?.N || src?.N || base?.N,
    );
    const alignedFinal = new Array(dstPts.length);
    for (let j = 0; j < dstPts.length; j++) {
      const di = (((j + referenceOffset) % dstPts.length) + dstPts.length) % dstPts.length;
      alignedFinal[j] = dstPts[di];
    }
    const lineage = buildStableLampKeyLineage(srcPts, alignedFinal);
    const sourceKeys = srcPts.map((p, i) => makeKey(p, pathIndex, i, 'src'));
    const targetKeys = alignedFinal.map((p, i) => makeKey(p, pathIndex, i, 'dst'));
    const sourceRail = sourceRenderedRails[sourcePathIndex] || sp;
    const targetRail = targetRenderedRails[targetPathIndex] || dp;

    const sourcePairRail = sourceMorphEndpointRails[pathIndex] || sourceRail;
    const targetPairRail = targetMorphEndpointRails[pathIndex] || targetRail;
    const sourceAttachPoints = new Array(sourceKeys.length);
    const targetAttachPoints = new Array(targetKeys.length);
    const sourceAttachFractions = sourceKeys.map((p, i) => {
      const hit = sourceRail?.points?.length > 1 ? nearestLampFractionOnPath(p, sourceRail) : null;
      if (hit?.point) sourceAttachPoints[i] = { x: Number(hit.point.x) || 0, y: Number(hit.point.y) || 0 };
      else sourceAttachPoints[i] = { x: Number(p.x) || 0, y: Number(p.y) || 0 };
      return Number.isFinite(Number(hit?.fraction))
        ? Number(hit.fraction)
        : closed
          ? i / Math.max(1, sourceKeys.length)
          : sourceKeys.length <= 1
            ? 0
            : i / (sourceKeys.length - 1);
    });
    const targetAttachFractions = targetKeys.map((p, i) => {
      const hit = targetRail?.points?.length > 1 ? nearestLampFractionOnPath(p, targetRail) : null;
      if (hit?.point) targetAttachPoints[i] = { x: Number(hit.point.x) || 0, y: Number(hit.point.y) || 0 };
      else targetAttachPoints[i] = { x: Number(p.x) || 0, y: Number(p.y) || 0 };
      return Number.isFinite(Number(hit?.fraction))
        ? Number(hit.fraction)
        : closed
          ? i / Math.max(1, targetKeys.length)
          : targetKeys.length <= 1
            ? 0
            : i / (targetKeys.length - 1);
    });
    const sourceAttachSegmentRefs = sourceKeys.map((p) =>
      sourceRail?.points?.length > 1 ? nearestLampSegmentRefOnPath(p, sourceRail) : null,
    );
    const targetAttachSegmentRefs = targetKeys.map((p) =>
      targetRail?.points?.length > 1 ? nearestLampSegmentRefOnPath(p, targetRail) : null,
    );

    const sourcePairSegmentRefs = sourceAttachPoints.map((p, i) =>
      sourcePairRail?.points?.length > 1
        ? nearestLampSegmentRefOnPath(p, sourcePairRail)
        : sourceAttachSegmentRefs[i],
    );
    const targetPairSegmentRefs = targetAttachPoints.map((p, i) =>
      targetPairRail?.points?.length > 1
        ? nearestLampSegmentRefOnPath(p, targetPairRail)
        : targetAttachSegmentRefs[i],
    );
    const sourceAttachRenderParams = sourcePairSegmentRefs.map((ref) =>
      lampRenderSegmentParam(sourcePairRail, ref),
    );
    const targetAttachRenderParams = targetPairSegmentRefs.map((ref) =>
      lampRenderSegmentParam(targetPairRail, ref),
    );
    paths.push({
      pathIndex,
      sourcePathIndex,
      targetPathIndex,
      pair,
      sp,
      dp,
      srcPts,
      finalDstPts: dstPts,
      alignedFinal,
      lineage,
      referenceOffset,
      closed,
      sourceKeys,
      targetKeys,
      sourceAttachFractions,
      targetAttachFractions,
      sourceAttachPoints,
      targetAttachPoints,
      sourceAttachSegmentRefs,
      targetAttachSegmentRefs,
      sourceAttachRenderParams,
      targetAttachRenderParams,
      sourcePathPresent: pair.sourcePathPresent !== false,
      targetPathPresent: pair.targetPathPresent !== false,
      radialMerge: pair.radialMerge === true,
      radialSplit: pair.radialSplit === true,
      sourceReferenceAngle: pathReferenceAngle(sp),
      targetReferenceAngle: pathReferenceAngle(dp),
    });
  }
  cached = { serial, paths };
  lampMotionRuntime.topologyLinearPlans.set(cacheKey, cached);
  return cached;
}
function markMappedAnglePopulation(mappedAngles, originalAngles) {
  const mapped = Array.isArray(mappedAngles) ? mappedAngles : [],
    orig = Array.isArray(originalAngles) ? originalAngles : [];
  const present = new Array(mapped.length).fill(false),
    keyIndex = new Array(mapped.length).fill(-1),
    used = new Set();
  for (let k = 0; k < orig.length; k++) {
    let best = -1,
      bestD = Infinity;
    for (let i = 0; i < mapped.length; i++) {
      if (used.has(i)) continue;
      const d = angularDistance(mapped[i], orig[k]);
      if (d < bestD - 1e-9) {
        bestD = d;
        best = i;
      }
    }
    if (best >= 0) {
      used.add(best);
      present[best] = true;
      keyIndex[best] = k;
    }
  }
  for (let i = 0; i < mapped.length; i++)
    if (keyIndex[i] < 0) {
      let best = 0,
        bestD = Infinity;
      for (let k = 0; k < orig.length; k++) {
        const d = angularDistance(mapped[i], orig[k]);
        if (d < bestD - 1e-9) {
          bestD = d;
          best = k;
        }
      }
      keyIndex[i] = orig.length ? best : -1;
    }
  return { present, keyIndex };
}
// Circle plans live for a morph phase. The angle correspondence is fixed even
// while the lamps' positions and brightness change on every frame.
const circleLampCorrespondence = new WeakMap();
function getCircleLampCorrespondence(pathPlan) {
  let entry = circleLampCorrespondence.get(pathPlan);
  if (entry) return entry;
  const from = pathPlan.from || [];
  const to = from.map((angle, i) => angle + (Number(pathPlan.delta?.[i]) || 0));
  const distinct = (angles) => angles.filter((angle, i) =>
    angles.findIndex((other) => angularDistance(angle, other) < 1e-8) === i,
  );
  const srcAngles = pathPlan.lampSourceAngles?.length ? pathPlan.lampSourceAngles : distinct(from);
  const dstAngles = pathPlan.lampTargetAngles?.length ? pathPlan.lampTargetAngles : distinct(to);
  entry = {
    from,
    to,
    angularTravel: pathPlan.delta,
    srcAngles,
    dstAngles,
    srcMap: markMappedAnglePopulation(from, srcAngles),
    dstMap: markMappedAnglePopulation(to, dstAngles),
  };
  circleLampCorrespondence.set(pathPlan, entry);
  return entry;
}

function collectTrueLinearKeyLampPoints(layerIndex, t, maxPoints = 260, attach = isLampContourAttachmentEnabled(), keyMotion = false) {
  const base = state.layers[layerIndex];
  const src = runtimeState.morph.renderSourceLayers?.[layerIndex] || {
    ...base,
    ...(runtimeState.morph.sourceVisuals?.[layerIndex] || {}),
  };
  const dst = runtimeState.morph.renderTargetLayers?.[layerIndex] || {
    ...base,
    ...(runtimeState.morph.targetVisuals?.[layerIndex] || {}),
  };
  if (!base || !src || !dst) return [];
  const u = Math.max(0, Math.min(1, Number(t) || 0)),
    layerKey = String(base?.id || layerIndex),
    out = [];
  const makeKey = (p, pathIndex, keyIndex, side) => ({
    x: Number(p?.x) || 0,
    y: Number(p?.y) || 0,
    keyIndex,
    lampSeed: lampHash32(`${layerKey}:${side}:${pathIndex}:${keyIndex}`),
  });

  if (
    state.morph.mode === 'circleSlide' ||
    state.morph.mode === 'topoCircle' ||
    state.morph.mode === 'topoCircleOpacity'
  ) {
    const plan = isChaosCircleMorphPair(layerIndex)
      ? getChaosCircleMorphPlan(src, dst, state.morph.slideType || 'minimal')
      : getCircleMorphPlan(src, dst, state.morph.slideType || 'minimal');
    const rs = getEffectiveLayerRadius(src, 220),
      rd = getEffectiveLayerRadius(dst, rs),
      R = rs + (rd - rs) * u;
    for (let pathIndex = 0; pathIndex < (plan?.pathPlans?.length || 0); pathIndex++) {
      const pp = plan.pathPlans[pathIndex];
      const { from, to, angularTravel, srcAngles, dstAngles, srcMap, dstMap } = getCircleLampCorrespondence(pp);
      if (!from.length) continue;
      const sourceKeys = srcAngles.map((a, i) =>
        makeKey({ x: rs * Math.cos(a), y: rs * Math.sin(a) }, pathIndex, i, 'src'),
      );
      const targetKeys = dstAngles.map((a, i) =>
        makeKey({ x: rd * Math.cos(a), y: rd * Math.sin(a) }, pathIndex, i, 'dst'),
      );
      for (let i = 0; i < from.length; i++) {
        const sa = from[i],
          ta = to[i],
          aa = sa + angularTravel[i] * u;
        const x = R * Math.cos(aa),
          y = R * Math.sin(aa);
        const si = Math.max(0, srcMap.keyIndex[i] || 0),
          ti = Math.max(0, dstMap.keyIndex[i] || 0);
        const sp =
          sourceKeys[si] || makeKey({ x: rs * Math.cos(sa), y: rs * Math.sin(sa) }, pathIndex, si, 'src');
        const tp =
          targetKeys[ti] || makeKey({ x: rd * Math.cos(ta), y: rd * Math.sin(ta) }, pathIndex, ti, 'dst');
        const sourcePresent = pp.sourcePathPresent !== false && srcMap.present[i] === true;
        const targetPresent = pp.targetPathPresent !== false && dstMap.present[i] === true;
        const travel = u;
        const presence = lampLinearSplitMergePresence(
          sourcePresent,
          targetPresent,
          { x, y },
          sp,
          tp,
          sourceKeys,
          targetKeys,
          travel,
          layerKey,
          `circle:${pathIndex}:${i}`,
        );
        const sourceFraction = si / Math.max(1, srcAngles.length || from.length);
        const targetFraction = ti / Math.max(1, dstAngles.length || to.length);
        let arcDelta = targetFraction - sourceFraction;
        arcDelta = ((((arcDelta + 0.5) % 1) + 1) % 1) - 0.5;
        const arcFraction = (((sourceFraction + arcDelta * u) % 1) + 1) % 1;
        out.push({
          x,
          y,
          pathIndex,
          vertexIndex: i,
          lampPresence: presence,
          lampTravelProgress: travel,
          lampSourcePresent: sourcePresent,
          lampTargetPresent: targetPresent,
          lampAttachFraction: arcFraction,
          lampCircleSlotCount: from.length,
          lampAttachSourcePoint: sp,
          lampAttachTargetPoint: tp,
          lampAttachSourceFraction: sourceFraction,
          lampAttachTargetFraction: targetFraction,
          lampAttachProgress: u,
          lampId: `linear:key:${pathIndex}:${i}`,
          lampSeed: lampHash32(`${layerKey}:linear:key:${pathIndex}:${i}`),
        });
      }
    }
    return capLampPointList(out, maxPoints);
  }

  const topologyPlan = getStableTopologyLinearLampPlan(layerIndex, src, dst, base, layerKey);
  if (!topologyPlan.paths.length) return [];
  const radial = Boolean(
    state.morph.options.byVertices || state.morph.options.bySteps || state.morph.monoOrbitTransforms,
  );
  const chaosCalm = state.morph.mode === 'calm' && isChaosCircleMorphPair(layerIndex);
  for (const rec of topologyPlan.paths) {
    const {
      pathIndex,
      dp,
      srcPts,
      finalDstPts,
      alignedFinal,
      lineage,
      referenceOffset,
      closed,
      sourceKeys,
      targetKeys,
      sourceAttachFractions,
      targetAttachFractions,
      sourceAttachPoints,
      targetAttachPoints,
      sourceAttachSegmentRefs,
      targetAttachSegmentRefs,
      sourceAttachRenderParams,
      targetAttachRenderParams,
    } = rec;
    let morphDstPts = finalDstPts;
    if (rec.radialMerge || rec.radialSplit) {
      const rotated = rotateMorphPath(
        dp,
        signedAngleDelta(rec.targetReferenceAngle, rec.sourceReferenceAngle) * (1 - u),
      );
      morphDstPts = rotated?.points || finalDstPts;
    }
    const alignedMorph = new Array(finalDstPts.length);
    for (let j = 0; j < finalDstPts.length; j++) {
      const di = (((j + referenceOffset) % finalDstPts.length) + finalDstPts.length) % finalDstPts.length;
      alignedMorph[j] = morphDstPts[di % morphDstPts.length];
    }
    const useRadial = closed && (chaosCalm || (radial && (rec.radialMerge || rec.radialSplit)));
    for (let i = 0; i < lineage.length; i++) {
      const slot = lineage[i],
        si = Math.max(0, slot.sourceIndex),
        ti = Math.max(0, slot.targetIndex);
      const sourcePoint = sourceKeys[si],
        targetPoint = targetKeys[ti];
      if (!sourcePoint || !targetPoint) continue;
      const mt = alignedMorph[ti] || alignedFinal[ti] || targetPoint;
      let x, y;
      const fixedSegmentPoint = attach
        ? interpolateLampSegmentRefs(
            sourceAttachSegmentRefs?.[si],
            targetAttachSegmentRefs?.[ti],
            u,
            sourceAttachPoints?.[si] || sourcePoint,
            targetAttachPoints?.[ti] || targetPoint,
          )
        : null;

      const renderSegmentParam = attach
        ? interpolateLampRenderSegmentParam(
            sourceAttachRenderParams?.[si],
            targetAttachRenderParams?.[ti],
            u,
            closed,
          )
        : NaN;
      if (fixedSegmentPoint && !keyMotion) {
        x = Number(fixedSegmentPoint.x) || 0;
        y = Number(fixedSegmentPoint.y) || 0;
      } else if (useRadial) {
        const sr = Math.hypot(sourcePoint.x, sourcePoint.y),
          tr = Math.hypot(mt.x, mt.y);
        const sa = Math.atan2(sourcePoint.y, sourcePoint.x),
          ta = Math.atan2(mt.y, mt.x);
        const rr = sr + (tr - sr) * u,
          aa = interpolateMorphPolarAngle(sa, ta, u);
        x = rr * Math.cos(aa);
        y = rr * Math.sin(aa);
      } else {
        x = sourcePoint.x + (mt.x - sourcePoint.x) * u;
        y = sourcePoint.y + (mt.y - sourcePoint.y) * u;
      }
      const sourcePresent = rec.sourcePathPresent && slot.sourcePresent;
      const targetPresent = rec.targetPathPresent && slot.targetPresent;
      const travel = u;

      let sourceAttach = Number(sourceAttachFractions?.[si]);
      let targetAttach = Number(targetAttachFractions?.[ti]);
      if (!Number.isFinite(sourceAttach))
        sourceAttach = closed
          ? si / Math.max(1, sourceKeys.length)
          : sourceKeys.length <= 1
            ? 0
            : si / (sourceKeys.length - 1);
      if (!Number.isFinite(targetAttach))
        targetAttach = closed
          ? ti / Math.max(1, targetKeys.length)
          : targetKeys.length <= 1
            ? 0
            : ti / (targetKeys.length - 1);
      let attachDelta = targetAttach - sourceAttach;
      if (closed) attachDelta = ((((attachDelta + 0.5) % 1) + 1) % 1) - 0.5;
      let attachFraction = sourceAttach + attachDelta * u;
      attachFraction = closed ? ((attachFraction % 1) + 1) % 1 : Math.max(0, Math.min(1, attachFraction));
      const stableGateKey = `topo:${pathIndex}:${slot.sourceIndex}->${slot.targetIndex}:${i}`;
      const presence = lampLinearSplitMergePresence(
        sourcePresent,
        targetPresent,
        { x, y },
        sourcePoint,
        targetPoint,
        sourceKeys,
        targetKeys,
        travel,
        layerKey,
        stableGateKey,
      );
      const exactSourceAttach = sourceAttachPoints?.[si] || sourcePoint;
      const exactTargetAttach = targetAttachPoints?.[ti] || targetPoint;
      out.push({
        x,
        y,
        pathIndex,
        vertexIndex: i,
        lampPresence: presence,
        lampTravelProgress: travel,
        lampSourcePresent: sourcePresent,
        lampTargetPresent: targetPresent,
        lampAttachFraction: attachFraction,
        lampAttachSourceFraction: sourceAttach,
        lampAttachTargetFraction: targetAttach,
        lampAttachProgress: u,
        lampFixedSegmentBound: Boolean(fixedSegmentPoint),
        lampAttachRenderSegmentParam: renderSegmentParam,

        lampAttachSegmentWindow: Math.max(
          0.025,
          Math.min(0.18, 0.48 / Math.max(3, sourceKeys.length, targetKeys.length)),
        ),

        lampAttachSourcePoint: { x: Number(exactSourceAttach.x) || 0, y: Number(exactSourceAttach.y) || 0 },
        lampAttachTargetPoint: { x: Number(exactTargetAttach.x) || 0, y: Number(exactTargetAttach.y) || 0 },
        lampAttachSegmentKey: `${pathIndex}:${slot.sourceIndex}->${slot.targetIndex}`,
        lampId: `linear:topo:${pathIndex}:${slot.sourceIndex}->${slot.targetIndex}:${i}`,
        lampSeed: lampHash32(
          `${layerKey}:linear:topo:${pathIndex}:${slot.sourceIndex}->${slot.targetIndex}:${i}`,
        ),
      });
    }
  }
  return capLampPointList(out, maxPoints);
}
function collectLinearGeometryLampPoints(layerIndex, t, maxPoints = 260, currentPaths = null) {
  const base = state.layers[layerIndex];
  const src = runtimeState.morph.renderSourceLayers?.[layerIndex] || {
    ...base,
    ...(runtimeState.morph.sourceVisuals?.[layerIndex] || {}),
  };
  const dst = runtimeState.morph.renderTargetLayers?.[layerIndex] || {
    ...base,
    ...(runtimeState.morph.targetVisuals?.[layerIndex] || {}),
  };
  const paths = Array.isArray(currentPaths) ? currentPaths : [];
  if (!base || !src || !dst || !paths.length) return [];
  const anchorPairs = pairMorphPaths(buildTopologyLampAnchorPaths(src), buildTopologyLampAnchorPaths(dst));
  const u = Math.max(0, Math.min(1, Number(t) || 0)),
    out = [];

  let srcVisible = null,
    dstVisible = null;
  const perEdgePathLayout = anchorPairs.length !== paths.length;
  for (let pathIndex = 0; pathIndex < paths.length; pathIndex++) {
    const current = paths[pathIndex];
    if (!current?.points?.length) continue;
    const pair = anchorPairs[pathIndex] || {};
    let sourcePath = null,
      targetPath = null;
    if (current._src)
      sourcePath = {
        points: current._src.rawPoints || current._src.points || [],
        closed: Boolean(current._src.closed),
      };
    if (current._dst)
      targetPath = {
        points: current._dst.rawPoints || current._dst.points || [],
        closed: Boolean(current._dst.closed),
      };
    if (!sourcePath || !targetPath) {
      if (!srcVisible) srcVisible = buildOrbitPolylines(src);
      if (!dstVisible) dstVisible = buildOrbitPolylines(dst);
      sourcePath = sourcePath || srcVisible[pathIndex] || null;
      targetPath = targetPath || dstVisible[pathIndex] || null;
    }

    const sourceCount = perEdgePathLayout
      ? sourcePath?.points?.length
        ? 2
        : 0
      : pair?.src?.points?.length || 0;
    const targetCount = perEdgePathLayout
      ? targetPath?.points?.length
        ? 2
        : 0
      : pair?.dst?.points?.length || 0;
    const slots = buildLampTopologyPhaseSlots(sourceCount, targetCount, Boolean(current.closed));
    if (!slots.length) continue;
    const layerKey = String(base?.id || layerIndex);
    const sourceKeys = buildLampKeyPointSamples(sourcePath, sourceCount, layerKey, pathIndex);
    const targetKeys = buildLampKeyPointSamples(targetPath, targetCount, layerKey, pathIndex);
    for (let slotIndex = 0; slotIndex < slots.length; slotIndex++) {
      const slot = slots[slotIndex],
        f = slot.fraction;
      const p = sampleLampTopologyPath(current, f);
      if (!p) continue;
      const a = sourcePath ? sampleLampTopologyPath(sourcePath, f) : null,
        b = targetPath ? sampleLampTopologyPath(targetPath, f) : null;
      const travel = a && b ? lampEndpointTravelProgress(a.x, a.y, p.x, p.y, b.x, b.y, u) : u;
      const ghostPresence = lampNearestKeyPresence(
        slot.sourcePresent,
        slot.targetPresent,
        p,
        a,
        b,
        sourceKeys,
        targetKeys,
        travel,
      );
      const linearPresence = lampLinearSplitMergePresence(
        slot.sourcePresent,
        slot.targetPresent,
        p,
        a,
        b,
        sourceKeys,
        targetKeys,
        travel,
        layerKey,
        `${pathIndex}:${Math.round(f * 1000000)}`,
      );
      const presence =
        getLampEvaluationConfig()?.morphMotionMode === 'ghost' ? ghostPresence : linearPresence;
      const phaseKey = Math.round(f * 1000000);
      out.push({
        x: p.x,
        y: p.y,
        pathIndex,
        vertexIndex: slotIndex,
        lampPresence: presence,
        lampTravelProgress: travel,
        lampNearestKeyPresence: ghostPresence,
        lampLinearSplitMergePresence: linearPresence,
        lampSourcePresent: slot.sourcePresent,
        lampTargetPresent: slot.targetPresent,
        lampId: `geom:${pathIndex}:${phaseKey}`,
        lampSeed: lampHash32(`${base?.id || layerIndex}:geom:${pathIndex}:${phaseKey}`),
      });
    }
  }
  return capLampPointList(out, maxPoints);
}
function collectTopologyVertexLampPoints(layerIndex, t, maxPoints = 260) {
  const base = state.layers[layerIndex];
  const src = runtimeState.morph.renderSourceLayers?.[layerIndex] || {
    ...base,
    ...(runtimeState.morph.sourceVisuals?.[layerIndex] || {}),
  };
  const dst = runtimeState.morph.renderTargetLayers?.[layerIndex] || {
    ...base,
    ...(runtimeState.morph.targetVisuals?.[layerIndex] || {}),
  };
  if (!src || !dst) return [];
  const srcPaths = buildTopologyLampAnchorPaths(src),
    dstPaths = buildTopologyLampAnchorPaths(dst);
  if (!srcPaths.length || !dstPaths.length) return [];
  const pairs = pairMorphPaths(srcPaths, dstPaths);
  const u = Math.max(0, Math.min(1, Number(t) || 0));
  const radial = Boolean(
    state.morph.options.byVertices || state.morph.options.bySteps || state.morph.monoOrbitTransforms,
  );
  const chaosCalm = state.morph.mode === 'calm' && isChaosCircleMorphPair(layerIndex);
  const out = [];
  for (let pathIndex = 0; pathIndex < pairs.length; pathIndex++) {
    const pair = pairs[pathIndex],
      sp = pair.src,
      dp = pair.dst;
    if (!sp && !dp) continue;
    if (sp && dp) {
      const srcPts = sp.points || [],
        dstPts = dp.points || [];
      if (!srcPts.length || !dstPts.length) continue;
      let morphDst = dp;
      if (pair.radialMerge || pair.radialSplit) {
        const sa = pathReferenceAngle(sp),
          da = pathReferenceAngle(dp);
        morphDst = rotateMorphPath(dp, signedAngleDelta(da, sa) * (1 - u));
      }
      const dPts = morphDst.points || [];
      const n = Math.max(srcPts.length, dPts.length);
      const useRadial =
        Boolean(sp.closed && dp.closed) && (chaosCalm || (radial && (pair.radialMerge || pair.radialSplit)));
      const stableLampCalm = getLampEvaluationConfig()?.calmMode === true && !runtimeState.morph?.active;
      const referenceOffset = stableLampCalm
        ? 0
        : getMorphReferenceVertexOffset(
            pair,
            dPts.length,
            Boolean(sp.closed && dp.closed),
            dst?.N || src?.N || base?.N,
          );
      for (let i = 0; i < n; i++) {
        const sourcePathPresent = pair.sourcePathPresent !== false,
          targetPathPresent = pair.targetPathPresent !== false;
        const sourcePresent = sourcePathPresent && i < srcPts.length,
          targetPresent = targetPathPresent && i < dPts.length;
        const di = dPts.length ? (((i + referenceOffset) % dPts.length) + dPts.length) % dPts.length : 0;

        const sourcePoint = sourcePresent
          ? srcPts[i]
          : sampleLampClosedAnchor(srcPts, dPts.length ? di / dPts.length : i / Math.max(1, n));
        const morphTargetPoint = targetPresent
          ? dPts[di]
          : sampleLampClosedAnchor(dPts, srcPts.length ? i / srcPts.length : i / Math.max(1, n));
        const finalDstPts = dp.points || dPts;
        const targetPoint = targetPresent
          ? finalDstPts.length
            ? finalDstPts[di % finalDstPts.length]
            : morphTargetPoint
          : sampleLampClosedAnchor(finalDstPts, srcPts.length ? i / srcPts.length : i / Math.max(1, n));
        let x, y;
        if (useRadial) {
          const sr = Math.hypot(sourcePoint.x, sourcePoint.y),
            tr = Math.hypot(morphTargetPoint.x, morphTargetPoint.y);
          const sa = Math.atan2(sourcePoint.y, sourcePoint.x),
            ta = Math.atan2(morphTargetPoint.y, morphTargetPoint.x);
          const rr = sr + (tr - sr) * u,
            aa = interpolateMorphPolarAngle(sa, ta, u);
          x = rr * Math.cos(aa);
          y = rr * Math.sin(aa);
        } else {
          x = sourcePoint.x + (morphTargetPoint.x - sourcePoint.x) * u;
          y = sourcePoint.y + (morphTargetPoint.y - sourcePoint.y) * u;
        }
        const lampTravelProgress = lampEndpointTravelProgress(
          sourcePoint?.x,
          sourcePoint?.y,
          x,
          y,
          targetPoint?.x,
          targetPoint?.y,
          u,
        );
        const lampPresence = lampTopologyPresence(sourcePresent, targetPresent, lampTravelProgress);
        out.push({
          x,
          y,
          pathIndex,
          vertexIndex: i,
          lampPresence,
          lampTravelProgress,
          lampSourcePresent: sourcePresent,
          lampTargetPresent: targetPresent,
          lampId: `key:${pathIndex}:${i}`,
          lampSeed: lampHash32(`${base?.id || layerIndex}:key:${pathIndex}:${i}`),
        });
      }
    } else {
      const pts = (sp || dp)?.points || [];
      const sourcePathPresent = Boolean(sp) && pair.sourcePathPresent !== false,
        targetPathPresent = Boolean(dp) && pair.targetPathPresent !== false;
      const lampTravelProgress = u;
      const lampPresence = lampTopologyPresence(sourcePathPresent, targetPathPresent, lampTravelProgress);
      for (let i = 0; i < pts.length; i++)
        out.push({
          x: pts[i].x,
          y: pts[i].y,
          pathIndex,
          vertexIndex: i,
          lampPresence,
          lampTravelProgress,
          lampSourcePresent: sourcePathPresent,
          lampTargetPresent: targetPathPresent,
          lampId: `key:${pathIndex}:${i}`,
          lampSeed: lampHash32(`${base?.id || layerIndex}:key:${pathIndex}:${i}`),
        });
    }
  }
  return capLampPointList(out, maxPoints);
}
function collectChaosCircleVertexLampPoints(layerIndex, t, maxPoints = 260) {
  const base = state.layers[layerIndex];
  const src = runtimeState.morph.renderSourceLayers?.[layerIndex] || {
    ...base,
    ...(runtimeState.morph.sourceVisuals?.[layerIndex] || {}),
  };
  const dst = runtimeState.morph.renderTargetLayers?.[layerIndex] || {
    ...base,
    ...(runtimeState.morph.targetVisuals?.[layerIndex] || {}),
  };
  if (!src || !dst) return [];
  const plan = getChaosCircleMorphPlan(src, dst, state.morph.slideType || 'minimal');
  if (!plan?.pathPlans?.length) return [];
  const u = Math.max(0, Math.min(1, Number(t) || 0));
  const rs = getEffectiveLayerRadius(src, 220),
    rd = getEffectiveLayerRadius(dst, rs),
    R = rs + (rd - rs) * u;
  const out = [];
  for (let pathIndex = 0; pathIndex < plan.pathPlans.length; pathIndex++) {
    const pp = plan.pathPlans[pathIndex];
    const lampPlan = buildNonCollapsingLampAnglePlan(
      pp.lampSourceAngles || pp.from,
      pp.lampTargetAngles || (pp.from || []).map((a, i) => a + (pp.delta?.[i] || 0)),
    );
    for (let i = 0; i < lampPlan.from.length; i++) {
      const sourceAngle = lampPlan.from[i],
        targetAngle = lampPlan.to[i];
      const angle = sourceAngle + signedAngleDelta(sourceAngle, targetAngle) * u;
      const x = R * Math.cos(angle),
        y = R * Math.sin(angle);
      const sx = rs * Math.cos(sourceAngle),
        sy = rs * Math.sin(sourceAngle),
        tx = rd * Math.cos(targetAngle),
        ty = rd * Math.sin(targetAngle);
      const sourcePresent =
        pp.sourcePathPresent !== false && i < Math.max(0, Number(pp.sourceVertexCount) || 0);
      const targetPresent =
        pp.targetPathPresent !== false && i < Math.max(0, Number(pp.targetVertexCount) || 0);
      const lampTravelProgress = lampEndpointTravelProgress(sx, sy, x, y, tx, ty, u);
      const lampPresence = lampTopologyPresence(sourcePresent, targetPresent, lampTravelProgress);
      out.push({
        x,
        y,
        pathIndex,
        vertexIndex: i,
        lampPresence,
        lampTravelProgress,
        lampSourcePresent: sourcePresent,
        lampTargetPresent: targetPresent,
        lampId: `key:${pathIndex}:${i}`,
        lampSeed: lampHash32(`${base?.id || layerIndex}:chaos-key:${pathIndex}:${i}`),
      });
    }
  }
  return capLampPointList(out, maxPoints);
}
function collectCircleVertexLampPoints(layerIndex, t, maxPoints = 260) {
  const base = state.layers[layerIndex];
  const src = runtimeState.morph.renderSourceLayers?.[layerIndex] || {
    ...base,
    ...(runtimeState.morph.sourceVisuals?.[layerIndex] || {}),
  };
  const dst = runtimeState.morph.renderTargetLayers?.[layerIndex] || {
    ...base,
    ...(runtimeState.morph.targetVisuals?.[layerIndex] || {}),
  };
  if (!src || !dst) return [];

  const plan = getCircleMorphPlan(src, dst, state.morph.slideType || 'minimal');
  if (!plan?.pathPlans?.length) return [];
  const u = Math.max(0, Math.min(1, Number(t) || 0));
  const rs = getEffectiveLayerRadius(src, 220),
    rd = getEffectiveLayerRadius(dst, rs),
    R = rs + (rd - rs) * u;
  const out = [];
  for (let pathIndex = 0; pathIndex < plan.pathPlans.length; pathIndex++) {
    const pp = plan.pathPlans[pathIndex];
    const lampPlan = buildNonCollapsingLampAnglePlan(
      pp.lampSourceAngles || pp.from,
      pp.lampTargetAngles || (pp.from || []).map((a, i) => a + (pp.delta?.[i] || 0)),
    );
    for (let i = 0; i < lampPlan.from.length; i++) {
      const sourceAngle = lampPlan.from[i],
        targetAngle = lampPlan.to[i];
      const angle = sourceAngle + signedAngleDelta(sourceAngle, targetAngle) * u;
      const x = R * Math.cos(angle),
        y = R * Math.sin(angle);
      const sx = rs * Math.cos(sourceAngle),
        sy = rs * Math.sin(sourceAngle),
        tx = rd * Math.cos(targetAngle),
        ty = rd * Math.sin(targetAngle);
      const sourcePresent =
        pp.sourcePathPresent !== false && i < Math.max(0, Number(pp.sourceVertexCount) || 0);
      const targetPresent =
        pp.targetPathPresent !== false && i < Math.max(0, Number(pp.targetVertexCount) || 0);
      const lampTravelProgress = lampEndpointTravelProgress(sx, sy, x, y, tx, ty, u);
      const lampPresence = lampTopologyPresence(sourcePresent, targetPresent, lampTravelProgress);
      out.push({
        x,
        y,
        pathIndex,
        vertexIndex: i,
        lampPresence,
        lampTravelProgress,
        lampSourcePresent: sourcePresent,
        lampTargetPresent: targetPresent,
        lampId: `key:${pathIndex}:${i}`,
        lampSeed: lampHash32(`${base?.id || layerIndex}:key:${pathIndex}:${i}`),
      });
    }
  }
  return capLampPointList(out, maxPoints);
}
// Лампы вершин Blue-морфа — это сами вершины-носители общего скелета, по которым идёт линия
// (circleSlide, topology). У каждой своя траектория от начального места к конечному; при смене
// числа вершин лишние носители рождаются из соседней вершины или уходят в неё по своему пути.
// Никакого сопоставления «к ближайшей вершине» и никакого появления лампы на пустом месте:
// присутствие всегда 1, совпавшие лампы склеивает слияние близких ламп (lamp-stability).
function collectSkeletonVertexLampPoints(layerIndex, t, maxPoints = 260) {
  const runtime = window.SomataMorphRuntime;
  if (!runtime?.fromBlue || !runtime?.getPlan || runtimeState.morph?.active !== true) return null;
  const spec = runtime.fromBlue(layerIndex);
  if (!spec || !['circleSlide', 'topology'].includes(spec.mode)) return null;
  const a = spec.sourceLayer,
    b = spec.targetLayer;
  if (!a || !b || isSpiralLayer(a) || isSpiralLayer(b) || a.chaosStar === true || b.chaosStar === true)
    return null;
  const plan = runtime.getPlan(spec);
  if (typeof plan?.evaluate !== 'function') return null;
  // Концы фазы помощник отдаёт как сами фигуры (без носителей): берём носители чуть внутри.
  const u = Math.max(1e-6, Math.min(1 - 1e-6, Number(t) || 0));
  const carriers = plan.evaluate.lampPaths?.(Math.max(0, Math.min(1, t))) ?? plan.evaluate(u);
  if (!Array.isArray(carriers) || !carriers.length) return null;
  const layerKey = String(state.layers[layerIndex]?.id ?? layerIndex),
    seen = new Set(),
    out = [];
  // В концевых кадрах фазы видимых контуров столько, сколько орбит у самой фигуры, а носителей —
  // max(источник, цель): лишняя орбита совпадает с орбитой (номер mod число орбит), к ней и
  // привязываем лампу, иначе она не находит свой контур и гаснет на кадр.
  const atStart = !(Number(t) > 1e-6),
    atEnd = Number(t) >= 1 - 1e-6;
  const endpointOrbits = atStart ? plan.source?.length : atEnd ? plan.target?.length : 0;
  for (const carrier of carriers) {
    const orbit = Number.isInteger(carrier?.orbitIndex) ? carrier.orbitIndex : out.length;
    if (seen.has(orbit)) continue; // при смене замкнутости орбита рисуется дважды
    seen.add(orbit);
    const pts = carrier?.points || [];
    for (let j = 0; j < pts.length; j++)
      out.push({
        x: Number(pts[j]?.x) || 0,
        y: Number(pts[j]?.y) || 0,
        pathIndex: endpointOrbits > 0 ? orbit % endpointOrbits : orbit,
        vertexIndex: j,
        lampPresence: lampTopologyPresence(pts[j].lampSourcePresent !== false, pts[j].lampTargetPresent !== false, t),
        lampSourcePresent: pts[j].lampSourcePresent !== false,
        lampTargetPresent: pts[j].lampTargetPresent !== false,
        lampId: `skel:${orbit}:${j}`,
        lampSeed: lampHash32(`${layerKey}:skel:${orbit}:${j}`),
      });
  }
  return out.length ? capLampPointList(out, maxPoints) : null;
}
function collectMorphLampPoints(
  layerIndex,
  t,
  maxPoints = 260,
  preparedPaths = null,
  preparedRoundedPaths = null,
) {
  if (getLampEvaluationConfig()?.morphMotionMode === 'key') {
    const base = state.layers[layerIndex];
    const info = getLampMorphRenderInfo(layerIndex, t, base);
    const attach = info.roundingFrac > 0 || isLampContourAttachmentEnabled();
    let points = collectTrueLinearKeyLampPoints(layerIndex, t, maxPoints, attach, true);
    if (points.length) {
      let rails;
      if (attach) {
        const topology = ['topology', 'calm'].includes(state.morph.mode);
        const raw = topology
          ? buildCurrentMorphPathsForLamps(layerIndex, t)
          : base.closedLoop === false ? getCurrentMorphCpuPaths(layerIndex, t, 'lamp-paths')
            : preparedPaths || getCurrentMorphCpuPaths(layerIndex, t, 'lamp-paths');
        const visible = preparedRoundedPaths?.length ? preparedRoundedPaths : null;
        const canonical = !visible || topology ? buildLampRenderedAttachmentPaths(raw, base, info) : null;
        rails = visible || canonical;
        points = projectMorphKeyLamps(points, raw, rails, base, canonical);
      }
      return preserveBlueMorphLampIdentity(layerIndex, points, attach, t, preparedRoundedPaths);
    }
  }
  const linear = getLampEvaluationConfig()?.morphMotionMode === 'linear';
  const motionT = lampPhaseInertiaProgress(t);
  let mode = getLampEvaluationConfig()?.positionMode || 'key';
  if (mode === 'circumference') mode = 'key'; // legacy project migration
  const base = state.layers[layerIndex];
  const circleMode =
    state.morph.mode === 'circleSlide' ||
    state.morph.mode === 'topoCircle' ||
    state.morph.mode === 'topoCircleOpacity';
  const trueLinearTopology =
    getLampEvaluationConfig()?.morphMotionMode === 'linear' &&
    (state.morph.mode === 'topology' || state.morph.mode === 'calm');
  const rawPaths =
    preparedPaths ||
    (trueLinearTopology
      ? buildCurrentMorphPathsForLamps(layerIndex, t)
      : getCurrentMorphCpuPaths(layerIndex, t, 'lamp-paths'));

  const lampRawPaths = trueLinearTopology ? buildCurrentMorphPathsForLamps(layerIndex, t) : rawPaths;
  const circumferenceMode = false;
  const attach = isLampContourAttachmentEnabled();
  const morphRenderInfo = getLampMorphRenderInfo(layerIndex, t, base);
  // preparedRoundedPaths is an optional authoritative visual attachment rail.
  // In current 7.8 Topology/Calm this is FrameContour.paths: the exact local-space
  // profile carrier recorded from the Line command stream. v505 identity stays intact,
  // while the final lamp coordinate is attached to the profile the user actually sees.
  const authoritativeAttachment =
    attach && Array.isArray(preparedRoundedPaths) && preparedRoundedPaths.length
      ? preparedRoundedPaths
      : null;
  const attachmentPaths = attach
    ? authoritativeAttachment || buildLampRenderedAttachmentPaths(lampRawPaths, base, morphRenderInfo)
    : lampRawPaths;
  const finalizeMorphLampPoints = (points, { forceNearest = false } = {}) => {
    let out = capLampPointList(points || [], maxPoints);
    if (!out.length) return out;
    // On the authoritative Topology/Calm profile rail, identity must be
    // stabilised BEFORE profile attachment.  Otherwise a new raw topology
    // slot at the next Morph cycle creates a fresh arc state and appears as
    // a teleport before blue identity handoff catches up.
    if (attach) {
      out = preserveBlueMorphLampIdentity(layerIndex, out, true);
      return projectLampPointsToCurrentPolygon(out, attachmentPaths, base, true, forceNearest, lampRawPaths);
    }
    return preserveBlueMorphLampIdentity(layerIndex, out);
  };

  if (mode === 'key') {
    const exact = linear ? collectTrueLinearKeyLampPoints(layerIndex, motionT, maxPoints) : null;
    let vertices = exact?.length ? exact : collectSkeletonVertexLampPoints(layerIndex, motionT, maxPoints);
    if (attach && vertices?.length && !circleMode) vertices = bindOpenCircleLampEdges(vertices, lampRawPaths, base);
    if (vertices?.length) {
      let displayed = vertices;
      if (attach) {
        const canonical = trueLinearTopology && authoritativeAttachment
          ? buildLampRenderedAttachmentPaths(lampRawPaths, base, morphRenderInfo) : attachmentPaths;
        displayed = projectMorphKeyLamps(vertices, lampRawPaths, attachmentPaths, base, canonical);
      }
      // Carry identity using the visible centre at the end of the trajectory.
      return preserveBlueMorphLampIdentity(layerIndex, capLampPointList(displayed, maxPoints), attach, t, authoritativeAttachment);
    }
  }
  if (getLampEvaluationConfig()?.morphMotionMode === 'ghost' && mode === 'key' && rawPaths?.length) {
    let exact = collectLinearGeometryLampPoints(layerIndex, motionT, maxPoints, rawPaths);
    if (exact.length)
      return finalizeMorphLampPoints(
        getLampEvaluationConfig()?.extinguishIntersections === false ? exact : dedupeLampPoints(exact, maxPoints),
        { forceNearest: circumferenceMode },
      );
  }
  if (mode === 'arbitrary')
    return collectArbitraryMorphLampPoints(layerIndex, t, Math.max(600, maxPoints), attachmentPaths); // v308: IDs/fractions are already contour-stable; no straight-line handoff
  if (mode === 'key') {
    const srcSpiral = isSpiralLayer(
      runtimeState.morph.renderSourceLayers?.[layerIndex] ||
        runtimeState.morph.sourceVisuals?.[layerIndex] ||
        base,
    );
    const dstSpiral = isSpiralLayer(
      runtimeState.morph.renderTargetLayers?.[layerIndex] ||
        runtimeState.morph.targetVisuals?.[layerIndex] ||
        base,
    );
    if ((srcSpiral || dstSpiral) && rawPaths?.length) {
      const all = [];
      const spiralSeamShared = state.tunnel?.active === true && base?.spiralClosed !== false;
      for (let pathIndex = 0; pathIndex < rawPaths.length; pathIndex++) {
        const path = rawPaths[pathIndex],
          pts = path?.points || [];
        if (!pts.length) continue;
        all.push({ ...pts[0], pathIndex, vertexIndex: 0 });
        if (pts.length > 1 && !spiralSeamShared)
          all.push({ ...pts[pts.length - 1], pathIndex, vertexIndex: pts.length - 1 });
      }
      const points = capLampPointList(
        getLampEvaluationConfig()?.extinguishIntersections === false
          ? all
          : dedupeLampPoints(all, Math.max(maxPoints, all.length)),
        maxPoints,
      );
      return preserveBlueMorphLampIdentity(
        layerIndex,
        attach
          ? projectLampPointsToCurrentPolygon(
              points,
              attachmentPaths,
              base,
              true,
              circumferenceMode,
              lampRawPaths,
            )
          : points,
      );
    }
    let pts = circleMode
      ? isChaosCircleMorphPair(layerIndex)
        ? collectChaosCircleVertexLampPoints(layerIndex, motionT, maxPoints)
        : collectCircleVertexLampPoints(layerIndex, motionT, maxPoints)
      : collectTopologyVertexLampPoints(layerIndex, motionT, maxPoints);
    if (pts.length) {
      if (getLampEvaluationConfig()?.calmMode === true && !attach)
        return preserveBlueMorphLampIdentity(layerIndex, pts);
      return finalizeMorphLampPoints(pts, { forceNearest: circumferenceMode });
    }
  }
  if (mode === 'corners') {
    const keys = withLampConfig({ ...getLampEvaluationConfig(), positionMode: 'key' }, () =>
      collectMorphLampPoints(layerIndex, t, maxPoints, rawPaths, preparedRoundedPaths),
    );
    const bends = collectSmoothCornerLampPoints(layerIndex, rawPaths, maxPoints, true);
    const projected = attach
      ? projectLampPointsToCurrentPolygon(bends, attachmentPaths, base, true, false, lampRawPaths)
      : bends;
    return mergeLampKeysAndBends(keys, projected, maxPoints, getLampEvaluationConfig()?.extinguishIntersections !== false);
  }
  return [];
}
function lampSeedUnit(seed, salt = 0) {
  let x = ((Number(seed) || 0) ^ Math.imul(salt + 1, 0x9e3779b1)) >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}
function lampMorphWave(seed, salt = 0) {
  return 0; // 7.10.5: retired legacy relative lamp Morph; Parameter Routing owns lamp morphing.
  const cycleSec = Math.max(0.05, getTapMorphIntervalSec(state.morph.intervalSec, 'full'));
  const time = lampVisualNow() / 1000 / cycleSec;
  const phase = lampSeedUnit(seed, salt) * Math.PI * 2;
  const phase2 = lampSeedUnit(seed, salt + 17) * Math.PI * 2;
  return Math.max(
    -1,
    Math.min(
      1,
      Math.sin(time * Math.PI * 2 + phase) * 0.68 + Math.sin(time * Math.PI * 4 * 0.73 + phase2) * 0.32,
    ),
  );
}

export {
  buildLampTopologyPhaseSlots,
  buildTopologyLampAnchorPaths,
  collectMorphLampPoints,
  getStableTopologyLinearLampPlan,
  lampLinearSplitMergePresence,
  lampMorphWave,
  lampSeedUnit,
  sampleLampClosedAnchor,
};
