import './topology-role-adapter.js'; // initialisation order: this module runs after it
import { SomataGeometryPolicy } from './geometry-policy.js';
import { state } from '../core/state.js';
import { somataGpuFeatureReady } from '../core/backend-policy.js';
import { requestMainCanvasRender } from '../core/scheduler.js';
import { ensureLayerLampState, getLampEvaluationConfig } from '../core/defaults-layers.js';
import { lampHash32 } from '../lamps/lamp-anchors.js';
import { SomataFrameContourService, useTopologyVisualProfileRail } from '../geometry/frame-contour.js';
import { LampGPURenderer } from '../gpu/lamp-renderer.js';
import {
  frameGeometryRuntime,
  lampArbitraryDensityFactor,
  stableContourLampFractions,
} from '../geometry/frame-paths.js';
import { lampMotionRuntime, lampVisualNow } from '../lamps/lamp-motion.js';
import { lampBendAnimationMs, lampBendTracks, trackLampBends } from '../lamps/lamp-attachment.js';
import { morphInterpolationTForCurrentMode } from '../geometry/morph-frame.js';
import {
  currentGpuBezierMorphResource,
  currentGpuBezierResourceForFrame,
  getGpuMorphArcTableForFrame,
  gpuMorphArcIneligibleReason,
  warmupGpuMorphArcResource,
} from '../gpu/morph-arc-resource.js';
import { spiroPassIsolationNoteFailure } from './pass-isolation.js';
import { prepareGpuMorphKeyLampFrame } from '../gpu/lamp-topology-resource.js';
import { prepareGpuMorphGhostLampFrame } from '../gpu/lamp-ghost-resource.js';
import { noteSuppressedError } from '../core/suppressed-errors.js';

const gpuMorphLampBridgeStats = {
  requests: 0,
  hits: 0,
  fallbacks: 0,
  attachmentsBuilt: 0,
  cpuPathBuildsAvoided: 0,
  cpuArcWalksAvoided: 0,
  lastReason: 'not-requested',
};

function gpuLampFeatureReady(frameCtx) {
  try {
    somataGpuFeatureReady?.('lamps', frameCtx);
  } catch (error) {
    noteSuppressedError('render/lamp-morph-bridge#gpuLampFeatureReady', error);
  }
  return true;
}

function gpuMorphLampPositionMode(frameCtx) {
  const cfg =
    frameCtx?.layerLampConfig ||
    frameCtx?.effectsPlan?.lamps?.baseConfig ||
    ensureLayerLampState(frameCtx?.layer) ||
    state?.lamps ||
    {};
  if (cfg.morphMotionMode === 'key') return 'key';
  const mode = cfg?.positionMode || state?.lamps?.positionMode || 'key';
  return mode === 'circumference' ? 'key' : mode;
}
function lampContourAttachmentEnabledForFrame(frameCtx) {
  const cfg =
    frameCtx?.layerLampConfig ||
    frameCtx?.effectsPlan?.lamps?.baseConfig ||
    ensureLayerLampState(frameCtx?.effectLayer || frameCtx?.layer) ||
    state?.lamps ||
    {};
  if (typeof cfg.snapToContour === 'boolean') return cfg.snapToContour;
  if (typeof cfg.snapToPolygon === 'boolean' && typeof cfg.stickToRounding === 'boolean')
    return cfg.snapToPolygon || cfg.stickToRounding;
  if (typeof cfg.snapToPolygon === 'boolean') return cfg.snapToPolygon;
  if (typeof cfg.stickToRounding === 'boolean') return cfg.stickToRounding;
  return true;
}
function useCanonicalTopologyLampAttachment(frameCtx) {
  try {
    if (typeof useTopologyVisualProfileRail === 'function') {
      if (!useTopologyVisualProfileRail(frameCtx)) return false;
    } else {
      if (!frameCtx?.layer || SomataGeometryPolicy.isStrict(frameCtx)) return false;
      if (!frameCtx.morphFrameActive || frameCtx.greenMorphEnabled || frameCtx.minimalFadeEnabled)
        return false;
      if (frameCtx.blueMorphProvider?.mode === 'fade') return false;
      if (!['topology', 'calm'].includes(state?.morph?.mode)) return false;
    }

    return lampContourAttachmentEnabledForFrame(frameCtx) === true;
  } catch (_) {
    return false;
  }
}
function gpuMorphArbitraryLampIneligibleReason(frameCtx, requireReady = true) {
  if (!frameCtx?.layer) return 'no-frame';
  if (!frameCtx.morphFrameActive || frameCtx.greenMorphEnabled || frameCtx.minimalFadeEnabled)
    return 'not-blue-topology-morph';
  if (frameCtx.blueMorphProvider?.mode === 'fade') return 'fade-provider';
  if (gpuMorphLampPositionMode(frameCtx) !== 'arbitrary') return 'position-mode-needs-prepared-identity';
  {
    const r = gpuMorphArcIneligibleReason(frameCtx);
    if (r) return r;
  }
  if (requireReady) {
    if (typeof LampGPURenderer === 'undefined' || !LampGPURenderer.isWebGPUReady?.())
      return 'lamp-gpu-warming';
    if (!warmupGpuMorphArcResource()) return 'gpu-morph-arc-warming';
  }
  return '';
}

function allocateGpuArbitraryLampCounts(layer, morphRec, t, maxPoints = 600, lampConfig = null) {
  const lengths = morphRec?.cpuEndpointPathLengths,
    pathCount = Math.max(0, Number(morphRec?.pathCount) || 0),
    layerKey = String(layer?.id || layer?.name || 'layer');
  if (!lengths || !pathCount) return [];
  const density = lampArbitraryDensityFactor(lampConfig),
    candidates = [];
  for (let pathIndex = 0; pathIndex < pathCount; pathIndex++) {
    const key = `${layerKey}:path:${pathIndex}`;
    let base = lampMotionRuntime?.arbitraryPathCounts?.get?.(key);
    if (!Number.isFinite(base)) {
      const a = Math.max(0, Number(lengths[pathIndex * 2]) || 0),
        b = Math.max(0, Number(lengths[pathIndex * 2 + 1]) || 0),
        len = a + (b - a) * Math.max(0, Math.min(1, Number(t) || 0));
      base = len > 0 ? Math.max(2, Math.min(maxPoints, Math.round(len / 24))) : 0;
      if (base > 0)
        try {
          lampMotionRuntime.arbitraryPathCounts.set(key, base);
        } catch (error) {
          noteSuppressedError('render/lamp-morph-bridge#allocateGpuArbitraryLampCounts', error);
        }
    }
    const desired =
      density <= 0.0001 || !(base > 0) ? 0 : Math.max(1, Math.min(maxPoints, Math.round(base * density)));
    if (desired) candidates.push({ pathIndex, desired, count: 0, remainder: 0 });
  }
  if (!candidates.length || maxPoints <= 0) return candidates;
  if (candidates.length <= maxPoints) {
    for (const c of candidates) c.count = 1;
  } else
    for (let i = 0; i < maxPoints; i++) candidates[Math.floor((i * candidates.length) / maxPoints)].count = 1;
  let used = candidates.reduce((n, c) => n + c.count, 0),
    remain = Math.max(0, maxPoints - used);
  if (remain > 0) {
    const weights = candidates.map((c) => Math.max(0, c.desired - c.count)),
      total = weights.reduce((a, b) => a + b, 0);
    if (total > 0) {
      let assigned = 0;
      for (let i = 0; i < candidates.length; i++) {
        const raw = (remain * weights[i]) / total,
          whole = Math.min(weights[i], Math.floor(raw));
        candidates[i].count += whole;
        candidates[i].remainder = raw - whole;
        assigned += whole;
      }
      let left = remain - assigned;
      const order = candidates
        .map((c, i) => i)
        .sort((a, b) => candidates[b].remainder - candidates[a].remainder);
      for (const i of order) {
        if (left <= 0) break;
        const c = candidates[i];
        if (c.count < c.desired) {
          c.count++;
          left--;
        }
      }
    }
  }
  return candidates;
}
function buildGpuArbitraryLampAttachmentPoints(frameCtx, morphRec, t, maxPoints = 600) {
  const layer = frameCtx.layer,
    layerKey = String(layer?.id || layer?.name || 'layer'),
    out = [],
    counts = allocateGpuArbitraryLampCounts(
      layer,
      morphRec,
      t,
      maxPoints,
      frameCtx?.layerLampConfig || frameCtx?.effectsPlan?.lamps?.baseConfig || null,
    );
  for (const c of counts) {
    if (!c.count) continue;
    const seedKey = `lamp|${layerKey}|path:${c.pathIndex}`,
      fractions = stableContourLampFractions(seedKey, c.count);
    for (let i = 0; i < fractions.length; i++) {
      const f = fractions[i];
      out.push({
        x: 0,
        y: 0,
        pathIndex: c.pathIndex,
        lampAttachFraction: f,
        lampColorPhase: f,
        lampId: `arb:${c.pathIndex}:${i}`,
        lampSeed: lampHash32(`${seedKey}:${i}`),
      });
    }
  }
  return out;
}
function prepareGpuMorphArbitraryLampFrame(frameCtx, maxPoints = 600) {
  gpuMorphLampBridgeStats.requests++;
  if (!frameCtx) return null;
  const reason = gpuMorphArbitraryLampIneligibleReason(frameCtx, true);
  if (reason) {
    gpuMorphLampBridgeStats.fallbacks++;
    gpuMorphLampBridgeStats.lastReason = reason;
    return null;
  }
  const table = getGpuMorphArcTableForFrame(frameCtx),
    arcRec = table?._gpuMorphArcResource,
    morphRec = arcRec?.morphRec;
  if (!table || !arcRec?.ready || !morphRec?.ready) {
    gpuMorphLampBridgeStats.fallbacks++;
    gpuMorphLampBridgeStats.lastReason = 'gpu-arc-resource-unavailable';
    return null;
  }
  const rawT = table.gpuMorphT ?? frameCtx.blueMorphProvider?.geometryT,
    t =
      typeof morphRec.resolveMorphT === 'function'
        ? morphRec.resolveMorphT(rawT)
        : morphInterpolationTForCurrentMode(rawT),
    points = buildGpuArbitraryLampAttachmentPoints(frameCtx, morphRec, t, maxPoints);
  if (!points.length) {
    gpuMorphLampBridgeStats.fallbacks++;
    gpuMorphLampBridgeStats.lastReason = 'no-attachments';
    return null;
  }
  const prepared = {
    gpuLampNative: true,
    gpuMorphArcTable: table,
    gpuMorphArcResource: arcRec,
    gpuMorphResource: morphRec,
    gpuMorphT: t,
    frameId: Number(frameCtx.frameId) || Number(frameGeometryRuntime?.frameId) || 0,
    attachmentPoints: points,
    attachmentCount: points.length,
  };
  gpuMorphLampBridgeStats.hits++;
  gpuMorphLampBridgeStats.attachmentsBuilt += points.length;
  gpuMorphLampBridgeStats.cpuPathBuildsAvoided++;
  gpuMorphLampBridgeStats.cpuArcWalksAvoided += Math.max(0, Number(morphRec.segmentCount) || 0);
  gpuMorphLampBridgeStats.lastReason = 'arbitrary-contour-fractions-on-gpu-arc';
  return prepared;
}
function spiralMorphFractionIdentityAtT(records, pathIndex, t, { forceEndpoints = false } = {}) {
  const rec = records?.[pathIndex] || {},
    src = Array.isArray(rec.source) ? rec.source : [],
    dst = Array.isArray(rec.target) ? rec.target : [];
  if (!src.length && !dst.length) return [];

  const sample = (arr, q) => {
    if (!arr.length) return NaN;
    if (arr.length === 1) return Math.max(0, Math.min(1, Number(arr[0]) || 0));
    const x = q * (arr.length - 1),
      i = Math.min(arr.length - 2, Math.floor(x)),
      u = x - i;
    return Math.max(
      0,
      Math.min(1, (Number(arr[i]) || 0) + ((Number(arr[i + 1]) || 0) - (Number(arr[i]) || 0)) * u),
    );
  };
  const count = Math.max(forceEndpoints ? 2 : 1, src.length, dst.length),
    tt = Math.max(0, Math.min(1, Number(t) || 0)),
    out = [];
  for (let i = 0; i < count; i++) {
    const q = count === 1 ? 0.5 : i / Math.max(1, count - 1),
      a = sample(src, q),
      b = sample(dst, q);
    const v = Number.isFinite(a) && Number.isFinite(b) ? a + (b - a) * tt : Number.isFinite(a) ? a : b;
    if (Number.isFinite(v)) out.push(Math.max(0, Math.min(1, v)));
  }
  if (forceEndpoints && out.length) {
    out[0] = 0;
    out[out.length - 1] = 1;
  }
  return out;
}
// A new coil initially has zero visible length; its lamp identity remains
// attached to the GPU Arc table, but must not create a bright pile-up at the
// single parent point. Retiring coils do the symmetric operation.
function gpuMorphCoilLampPresence(morphRec, pathIndex, t) {
  const pair = morphRec?.carrierRecords?.[pathIndex]?.pair;
  if (!pair?.coordinatedGerm) return 1;
  const x = Math.max(0, Math.min(1, Number(t) || 0));
  const smooth = (q) => {
    q = Math.max(0, Math.min(1, q));
    return q * q * (3 - 2 * q);
  };
  return pair.coordinatedGerm === 'birth' ? smooth(x / 0.22) : 1 - smooth((x - 0.78) / 0.22);
}
function gpuMorphSpecialSpiralLampFrame(frameCtx, maxPoints = 600) {
  const morphRec = currentGpuBezierResourceForFrame(frameCtx);
  if (!morphRec?.specialSpiralBezierRail || !morphRec?.ready) return null;
  const table = getGpuMorphArcTableForFrame(frameCtx),
    arcRec = table?._gpuMorphArcResource;
  if (!table?.gpuArcResident || !arcRec?.ready) return null;
  const mode = gpuMorphLampPositionMode(frameCtx),
    ranges = morphRec.cpuPathSegmentRanges,
    pathCount = Math.max(0, Number(morphRec.pathCount) || 0),
    points = [];
  if (!ranges || !pathCount) return null;
  const rawT = table.gpuMorphT ?? frameCtx.blueMorphProvider?.geometryT,
    t =
      typeof morphRec.resolveMorphT === 'function'
        ? morphRec.resolveMorphT(rawT)
        : Math.max(0, Math.min(1, Number(rawT) || 0));
  const layerKey = String(frameCtx?.layer?.id || frameCtx?.layerIndex || 'layer');

  const bends = [];
  const extinguishIntersections = (frameCtx.layerLampConfig || frameCtx.effectsPlan?.lamps?.baseConfig || getLampEvaluationConfig())?.extinguishIntersections !== false;
  if (mode !== 'corners') lampBendTracks.delete(`arc:${layerKey}`);
  const arbitraryCounts =
    mode === 'arbitrary'
      ? allocateGpuArbitraryLampCounts(
          frameCtx.layer,
          morphRec,
          t,
          maxPoints,
          frameCtx?.layerLampConfig || frameCtx?.effectsPlan?.lamps?.baseConfig || null,
        )
      : null;

  for (let pi = 0; pi < pathCount; pi++) {
    let fractions = [];
    const lampPresence = gpuMorphCoilLampPresence(morphRec, pi, t);
    if (lampPresence <= 0.002) continue;
    if (mode === 'arbitrary') {
      const countRec = arbitraryCounts?.find((c) => c.pathIndex === pi),
        desired = Math.max(0, Number(countRec?.count) || 0);
      const seedKey = `lamp|${layerKey}|path:${pi}`;
      fractions = desired > 0 ? stableContourLampFractions(seedKey, desired) : [];
      for (let j = 0; j < fractions.length; j++) {
        const f = Math.max(0, Math.min(1, Number(fractions[j]) || 0));
        points.push({
          x: 0,
          y: 0,
          pathIndex: pi,
          lampAttachFraction: f,
          lampColorPhase: f,
          lampPresence,
          lampId: `arb:${pi}:${j}`,
          lampSeed: lampHash32(`${seedKey}:${j}`),
        });
      }
    } else if (mode === 'key') {
      fractions = [0, 1];
      const periodic = Boolean(morphRec?.cpuPathPeriodic?.[pi] >>> 0),
        omitSharedSeam = periodic && state?.tunnel?.active === true;
      for (let j = 0; j < fractions.length; j++) {
        if (omitSharedSeam && j === fractions.length - 1) continue;
        const f = Math.max(0, Math.min(1, Number(fractions[j]) || 0));
        points.push({
          x: 0,
          y: 0,
          pathIndex: pi,
          lampAttachFraction: f,
          lampColorPhase: f,
          lampPresence,
          lampId: `spiral:key:${pi}:${j}`,
          lampSeed: lampHash32(`spiral:${layerKey}:key:${pi}:${j}`),
        });
      }
    } else {
      const keys = spiralMorphFractionIdentityAtT(morphRec?.cpuPathLampKeyFractions, pi, t, {
        forceEndpoints: true,
      });
      const rec = morphRec?.cpuPathCornerFractions?.[pi];
      const src = rec?.source || [],
        dst = rec?.target || [];
      const periodic = Boolean(morphRec?.cpuPathPeriodic?.[pi] >>> 0),
        omitSharedSeam = periodic && state?.tunnel?.active === true;
      const emit = (list, kind, j, f, topology = {}) => {
        if (omitSharedSeam && f >= 1 - 1e-7) return;
        const id = `spiral:${kind}:${pi}:${j}`;
        list.push({
          x: 0,
          y: 0,
          pathIndex: pi,
          lampAttachFraction: f,
          lampColorPhase: f,
          lampPresence,
          lampId: id,
          lampSeed: lampHash32(`${layerKey}:${id}`),
          ...topology,
        });
      };
      keys.forEach((f, j) => emit(points, 'key', j, f));
      for (let j = 0; j < Math.max(src.length, dst.length); j++) {
        const a = src[j],
          b = dst[j];
        if (a == null && b == null) continue;
        if (extinguishIntersections && ((a == null && t < 0.5) || (b == null && t >= 0.5))) continue;
        const f = a == null ? b : b == null ? a : a + (b - a) * t;
        if (!extinguishIntersections || !keys.some((k) => Math.abs(k - f) < 1e-6))
          emit(bends, 'bend', j, f, extinguishIntersections ? {} : {
            lampSourcePresent: a != null,
            lampTargetPresent: b != null,
            lampTravelProgress: t,
            lampPresence: lampPresence * (a == null ? t : 1),
          });
      }
    }
  }

  if (mode === 'corners') {
    const now = frameCtx.frame?.now ?? frameCtx.now;
    points.push(
      ...trackLampBends(
        `arc:${layerKey}`,
        bends,
        Number.isFinite(now) ? now : lampVisualNow(),
        lampBendAnimationMs(frameCtx),
        frameCtx.blueMorphProvider?.active === true || Number(frameCtx.lampAnimationMs) > 0,
      ).filter((p) => p.pathIndex < pathCount),
    );
  }
  if (!points.length && mode !== 'arbitrary') return null;
  // Do not fill the global lamp budget with the FIRST physical spiral arms.
  // During a high-N blue morph this made lamps appear glued to a single
  // section, while later arms received none. Allocate round-robin by path,
  // preserving each physical rail's own GPU arc index and stable lamp ID.
  let distributed = points;
  if (points.length > maxPoints) {
    const paths = new Map();
    for (const p of points) {
      let list = paths.get(p.pathIndex);
      if (!list) {
        list = [];
        paths.set(p.pathIndex, list);
      }
      list.push(p);
    }
    const groups = [...paths.values()],
      out = [];
    let round = 0;
    while (out.length < maxPoints) {
      let added = 0;
      // When there are more branches than lamps, subsample branches
      // uniformly rather than taking only the innermost ones.
      const stride = groups.length > maxPoints ? groups.length / maxPoints : 1;
      for (let i = 0; i < groups.length && out.length < maxPoints; i++) {
        if (stride > 1 && Math.floor(i / stride) === Math.floor((i - 1) / stride) && i > 0) continue;
        const p = groups[i][round];
        if (p) {
          out.push(p);
          added++;
        }
      }
      if (!added) break;
      round++;
    }
    distributed = out;
  }
  return {
    gpuLampNative: true,
    gpuLampNativeKind: 'arc',
    gpuMorphArcTable: table,
    gpuMorphArcResource: arcRec,
    gpuMorphT: t,
    frameId: Number(frameCtx.frameId) || 0,
    attachmentPoints: distributed,
    attachmentCount: distributed.length,
  };
}
function prepareGpuMorphLampFrame(frameCtx) {
  if (frameCtx?.layer?.__somataCoordinatedSpine === true) return null;
  try {
    const strictSpiral = SomataGeometryPolicy.isStrict(frameCtx),
      authoritative = strictSpiral ? currentGpuBezierResourceForFrame(frameCtx) : null;

    if (strictSpiral && (!authoritative?.ready || authoritative?.specialSpiralBezierRail !== true)) {
      gpuMorphLampBridgeStats.fallbacks++;
      gpuMorphLampBridgeStats.lastReason = 'strict-spiral-retained-rail-wait';
      try {
        requestMainCanvasRender?.();
      } catch (error) {
        noteSuppressedError('render/lamp-morph-bridge#prepareGpuMorphLampFrame', error);
      }
      return null;
    }
    const special = gpuMorphSpecialSpiralLampFrame(frameCtx, 600);
    if (special) {
      gpuLampFeatureReady(frameCtx);
      gpuMorphLampBridgeStats.hits++;
      gpuMorphLampBridgeStats.lastReason = 'spiral-exact-gpu-arc';
      return special;
    }
    if (strictSpiral) {
      gpuMorphLampBridgeStats.fallbacks++;
      gpuMorphLampBridgeStats.lastReason = 'strict-spiral-arc-wait';
      return null;
    }
    if (useCanonicalTopologyLampAttachment(frameCtx)) {
      gpuMorphLampBridgeStats.fallbacks++;
      gpuMorphLampBridgeStats.lastReason = 'v505-canonical-contour-attachment';
      return null;
    }
    // Ordinary Somata 13 morphs are rendered from a phase-owned rounded
    // contour. If "Snap to line" is enabled, GPU topology/arc shortcuts
    // cannot independently reconstruct a DIFFERENT spline for the lamp.
    // The CPU computes only the lamp anchors on that same live FrameContour;
    // the existing GPU lamp renderer still draws the lights.
    if (
      !strictSpiral &&
      frameCtx?.morphFrameActive &&
      !frameCtx?.greenMorphEnabled &&
      frameCtx?.blueMorphProvider?.mode !== 'fade' &&
      lampContourAttachmentEnabledForFrame(frameCtx)
    ) {
      let visualRail = null;
      try {
        visualRail = SomataFrameContourService?.paths?.(frameCtx) || null;
      } catch (_) {
        visualRail = null;
      }
      if (visualRail?.length) {
        gpuMorphLampBridgeStats.fallbacks++;
        gpuMorphLampBridgeStats.lastReason = 'phase-owned-rounded-visible-contour';
        return null;
      }
    }
    const mode = gpuMorphLampPositionMode(frameCtx);
    if (mode === 'key') {
      const cfg = frameCtx?.layerLampConfig || ensureLayerLampState?.(frameCtx?.layer) || state?.lamps || {},
        motion = cfg?.morphMotionMode || 'linear';
      if (motion === 'ghost' && typeof prepareGpuMorphGhostLampFrame === 'function') {
        const ghost = prepareGpuMorphGhostLampFrame(frameCtx, 260);
        if (ghost) {
          gpuLampFeatureReady(frameCtx);
          gpuMorphLampBridgeStats.hits++;
          gpuMorphLampBridgeStats.lastReason = `ghost-${ghost.gpuLampNativeKind || 'identity'}`;
          return ghost;
        }
      }
      {
        const key = prepareGpuMorphKeyLampFrame(frameCtx, 260);
        if (key) {
          gpuLampFeatureReady(frameCtx);
          gpuMorphLampBridgeStats.hits++;
          gpuMorphLampBridgeStats.lastReason = `key-${key.gpuLampNativeKind || 'identity'}`;
          return key;
        }
      }
    }
    if (mode === 'arbitrary') {
      const arb = prepareGpuMorphArbitraryLampFrame(frameCtx, 600);
      if (arb) gpuLampFeatureReady(frameCtx);
      return arb;
    }
    return null;
  } catch (err) {
    gpuMorphLampBridgeStats.fallbacks++;
    gpuMorphLampBridgeStats.lastReason = `native-preparation-error:${String(err?.message || err)}`;
    try {
      spiroPassIsolationNoteFailure?.('lamps', err, frameCtx);
    } catch (error) {
      noteSuppressedError('render/lamp-morph-bridge#prepareGpuMorphLampFrame', error);
    }
    return null;
  }
}

window.__spiroGpuMorphLampBridgeStatus = () => ({
  ...gpuMorphLampBridgeStats,
  topology: typeof __spiroGpuLampTopologyStatus === 'function' ? __spiroGpuLampTopologyStatus() : null,
  ghost: typeof __spiroGpuLampGhostStatus === 'function' ? __spiroGpuLampGhostStatus() : null,
  contract:
    'topology Morph Lamps are capability-routed before CPU geometry except when contour sticking is enabled: Topology/Calm then deliberately use the canonical v505 current-rail projection path. Strict Spiral retains its exact Arc carrier. Arbitrary uses stable contour fractions + shared Exact Arc where eligible; Key/Corners may use resident topology identity only when that does not bypass contour attachment.',
});

export { gpuMorphLampPositionMode, lampContourAttachmentEnabledForFrame, prepareGpuMorphLampFrame };
