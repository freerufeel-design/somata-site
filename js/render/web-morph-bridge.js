import './graffiti-pass.js'; // initialisation order: this module runs after it
import { state } from '../core/state.js';
import { getLayerStrokeWidthMultiplier } from '../effects/motion.js';
import { ensureLayerEffectState, getLayerWebConfig, getLayerWebEnabled } from '../core/defaults-layers.js';
import { isSpiralLayer } from '../geometry/spiral/order-params.js';
import { audioApplyNumeric } from '../audio/audio-routing.js';
import { getWebBranchFlags, getWebStyleProfile, resolveWebPrimaryColor, webRuntime } from '../effects/web.js';
import { getSharedGpuMorphPathResource } from '../gpu/morph-path-resource.js';
import {
  currentGpuBezierMorphResource,
  currentGpuBezierResourceForFrame,
  gpuMorphArcIneligibleReason,
  warmupGpuMorphArcResource,
} from '../gpu/morph-arc-resource.js';
import { getGpuWebCornerResourceForFrame, warmupGpuWebCornerResource } from '../gpu/web-corner-resource.js';
import { WebGPUWebMorphRenderer } from '../gpu/web-morph-renderer.js';
import { getTapMorphIntervalSec } from '../audio/tap-tempo.js';
import { noteSuppressedError } from '../core/suppressed-errors.js';

const gpuMorphWebBridgeStats = {
  requests: 0,
  hits: 0,
  fallbacks: 0,
  cpuPathBuildsAvoided: 0,
  cpuCornerScansAvoided: 0,
  cpuPathTablesAvoided: 0,
  lastReason: 'not-requested',
};

function gpuMorphWebIneligibleReason(frameCtx, requireReady = true) {
  const layer = frameCtx?.layer;
  if (!frameCtx || !layer) return 'no-frame';
  if (getLayerWebEnabled(layer) !== true) return 'web-disabled';
  {
    const reason = gpuMorphArcIneligibleReason(frameCtx);
    if (reason) return reason;
  }

  const morphRec = currentGpuBezierResourceForFrame(frameCtx);
  const cfg = getLayerWebConfig(layer),
    spiral = isSpiralLayer(layer) || morphRec?.specialSpiralBezierRail === true;

  const branches = spiral
    ? { inside: true, outsideStraight: false, outsideArc: false }
    : getWebBranchFlags(cfg);
  if (!branches.inside || branches.outsideStraight || branches.outsideArc)
    return 'web-multi-or-outer-branch-uses-exact-gpu-raster-fallback';
  const owner = ensureLayerEffectState(layer),
    transition = owner ? webRuntime?.transitionByLayer?.get(owner.id) : null;
  if (transition?.kind === 'visibility') return 'web-visibility-transition-uses-exact-gpu-raster-fallback';

  if (cfg?.style === 'spiderSun' && cfg?.placementMode !== 'corners')
    return 'spider-sun-crossing-placement-not-native';

  if (!morphRec?.ready) return 'gpu-retained-resource-unavailable';

  if (requireReady) {
    if (typeof WebGPUWebMorphRenderer === 'undefined' || !WebGPUWebMorphRenderer.isReady?.())
      return 'gpu-web-warming';
    if (typeof warmupGpuMorphArcResource !== 'function' || !warmupGpuMorphArcResource())
      return 'gpu-morph-arc-warming';
    if (typeof warmupGpuWebCornerResource !== 'function' || !warmupGpuWebCornerResource())
      return 'gpu-web-corner-warming';
  }
  return '';
}

function prepareGpuMorphWebFrame(frameCtx) {
  if (!frameCtx) return null;
  gpuMorphWebBridgeStats.requests++;
  try {
    WebGPUWebMorphRenderer?.warmup?.();
    warmupGpuMorphArcResource?.();
    warmupGpuWebCornerResource?.();
  } catch (error) {
    noteSuppressedError('render/web-morph-bridge#prepareGpuMorphWebFrame', error);
  }
  const reason = gpuMorphWebIneligibleReason(frameCtx, true);
  if (reason) {
    gpuMorphWebBridgeStats.fallbacks++;
    gpuMorphWebBridgeStats.lastReason = reason;
    return null;
  }
  const pair = getGpuWebCornerResourceForFrame(frameCtx);
  if (!pair?.table?.gpuArcResident || !pair?.resource?.ready) {
    gpuMorphWebBridgeStats.fallbacks++;
    gpuMorphWebBridgeStats.lastReason = 'gpu-web-corner-resource-unavailable';
    return null;
  }
  const layer = frameCtx.layer,
    owner = ensureLayerEffectState(layer),
    cfg = owner?.web || getLayerWebConfig(layer),
    idx = frameCtx.layerIndex,
    now = frameCtx.now || performance.now();
  const threshold = Math.max(
      1,
      Math.min(179, audioApplyNumeric('web.angleThreshold', Number(cfg.angleThreshold) || 60, idx)),
    ),
    spacing = Math.max(1, Math.min(80, audioApplyNumeric('web.spacing', Number(cfg.spacing) || 10, idx))),
    depthPercent = Math.max(
      0,
      Math.min(
        100,
        audioApplyNumeric(
          'web.distance',
          Number.isFinite(Number(cfg.distance)) ? Number(cfg.distance) : 60,
          idx,
        ),
      ),
    ),
    depthMultiplier = Math.max(
      0,
      Number.isFinite(Number(cfg.depthMultiplier)) ? Number(cfg.depthMultiplier) : 1,
    ),
    variation = Math.max(
      0,
      Math.min(45, audioApplyNumeric('web.angleVariation', Number(cfg.angleVariation) || 0, idx)),
    ),
    jitterStrength = Math.sin((variation * Math.PI) / 180) * 0.9;
  const color = resolveWebPrimaryColor(cfg, layer, frameCtx),
    secondaryColor = /^#[0-9a-f]{6}$/i.test(cfg.secondaryColor || '') ? cfg.secondaryColor : '#00ffff',
    baseLineWidth = Math.max(
      0.1,
      Number(frameCtx.strokeWidth) ||
        audioApplyNumeric('layer.strokeWidth', Number(layer?.strokeWidth) || 1.5, idx) *
          getLayerStrokeWidthMultiplier(layer),
    ),
    widthBase =
      cfg.widthRelative === true
        ? Math.max(
            0.05,
            Math.min(12, baseLineWidth * Math.max(0.01, Math.min(4, (Number(cfg.widthPercent) || 40) / 100))),
          )
        : Math.max(0.1, Math.min(4, Number(cfg.width) || 0.6)),
    baseWidth = Math.max(0.03, Math.min(24, audioApplyNumeric('web.width', widthBase, idx))),
    style = getWebStyleProfile(cfg, baseWidth, Number(frameCtx.frame?.dpr) || 1);
  const morphRec = pair.table._gpuMorphArcResource?.morphRec || currentGpuBezierResourceForFrame(frameCtx),
    transition = owner ? webRuntime.transitionByLayer.get(owner.id) : null;
  const data = {
    enabled: true,
    layerIndex: idx,
    paths: null,
    visualPaths: null,
    clipPath: null,
    corners: null,
    visualPathTables: null,
    persistentVectorRecord: null,
    pathBevel: null,
    pathRounding: null,
    animating: true,
    owner,
    cfg,
    transition,
    now,
    region: 'inside',
    insideEnabled: true,
    outsideStraightEnabled: false,
    outsideArcEnabled: false,
    placementMode: ['corners', 'selfIntersection', 'selfIntersectionCorridor'].includes(cfg.placementMode)
      ? cfg.placementMode
      : 'corners',
    oscillating: cfg.oscillating === true,
    oscillationStrength: Math.max(
      0,
      Math.min(100, Number.isFinite(Number(cfg.oscillationStrength)) ? Number(cfg.oscillationStrength) : 10),
    ),
    oscillationStrengthMultiplier: Math.max(
      0.015625,
      Math.min(64, Number(cfg.oscillationStrengthMultiplier) || 1),
    ),
    oscillationMultiplier: Math.max(0.015625, Math.min(64, Number(cfg.oscillationMultiplier) || 1)),
    oscillationPhase: 0,
    angleThreshold: threshold,
    spacing,
    depthPercent,
    depthMultiplier,
    jitterStrength,
    color,
    secondaryColor,
    width: style.width,
    renderWidth: style.width,
    threadAlpha: style.alpha,
    haloRadius: style.halo,
    style: style.style,
    dpr: Number(frameCtx.frame?.dpr) || 1,
    sunDegrees: Math.max(5, Math.min(90, Number(cfg.sunDegrees) || 20)),
    gpuMorphWebNative: true,
    gpuMorphArcTable: pair.table,
    gpuWebCornerResource: pair.resource,
    gpuMorphResource: morphRec,
  };
  if (data.oscillating) {
    const cycleSec = getTapMorphIntervalSec(Number(state?.morph?.intervalSec) || 5, 'full'),
      cycleMs = Math.max(100, cycleSec * 1000);
    data.oscillationPhase = ((now % cycleMs) / cycleMs) * Math.PI * 2 * data.oscillationMultiplier;
  }
  frameCtx.webPrepared = data;
  frameCtx.webPreparedReady = true;
  gpuMorphWebBridgeStats.hits++;
  gpuMorphWebBridgeStats.cpuPathBuildsAvoided++;
  gpuMorphWebBridgeStats.cpuCornerScansAvoided += morphRec?.segmentCount || 0;
  gpuMorphWebBridgeStats.cpuPathTablesAvoided += morphRec?.pathCount || 0;
  gpuMorphWebBridgeStats.lastReason = 'gpu-web-topology-arc';
  return data;
}

export { gpuMorphWebIneligibleReason, prepareGpuMorphWebFrame };
