import '../gpu/graffiti-morph-renderer.js'; // initialisation order: this module runs after it
import { somataGpuBackendAllowed } from '../core/backend-policy.js';
import { ensureLayerEffectState, getLayerEffectOwner } from '../core/defaults-layers.js';
import { frameGeometryRuntime } from '../geometry/frame-paths.js';
import { normalizeLineProfileValue } from '../ui/effects-sidebar.js';
import { morphInterpolationTForCurrentMode } from '../geometry/morph-frame.js';
import { getSharedGpuMorphPathResource } from '../gpu/morph-path-resource.js';
import {
  currentGpuBezierMorphResource,
  gpuMorphArcIneligibleReason,
  warmupGpuMorphArcResource,
} from '../gpu/morph-arc-resource.js';
import {
  getGpuGraffitiSampleResourceForFrame,
  warmupGpuGraffitiSampleResource,
} from '../gpu/graffiti-sample-resource.js';
import { WebGPUGraffitiMorphRenderer } from '../gpu/graffiti-morph-renderer.js';
import { noteSuppressedError } from '../core/suppressed-errors.js';

const graffitiGpuMorphBridgeStats = {
  requests: 0,
  hits: 0,
  sampledHits: 0,
  directHits: 0,
  fallbacks: 0,
  cpuPathBuildsAvoided: 0,
  cpuRibbonBuildsAvoided: 0,
  cpuResamplesAvoided: 0,
  lastReason: 'not-requested',
};

function liveGraffitiEffectLayer(frameCtx) {
  try {
    return frameCtx?.effectLayer || getLayerEffectOwner(frameCtx?.layer) || frameCtx?.layer || null;
  } catch (_) {
    return frameCtx?.layer || null;
  }
}

function gpuMorphGraffitiSampledRequirement(frameCtx) {
  const layer = liveGraffitiEffectLayer(frameCtx);
  if (!layer)
    return {
      needed: false,
      supported: false,
      reason: 'no-layer',
      variation: false,
      pinched: false,
      mode: 'perSegment',
    };
  const sizeVariation =
    layer.graffitiSizeVariationEnabled === true && Math.max(0, Number(layer.graffitiSizeVariation) || 0) > 0;
  const rotationVariation =
    layer.graffitiRotationVariationEnabled === true &&
    Math.max(0, Number(layer.graffitiRotationVariation) || 0) *
      Math.max(
        0,
        Number.isFinite(Number(layer.graffitiRotationMultiplier))
          ? Number(layer.graffitiRotationMultiplier)
          : 1,
      ) >
      0;
  const variation = sizeVariation || rotationVariation;
  const pinched = layer.graffitiNibShape === 'pinched';
  const mode = ['perSegment', 'everyNth', 'across', 'perPath', 'whole'].includes(layer.graffitiVariationMode)
    ? layer.graffitiVariationMode
    : 'perSegment';

  return { needed: pinched || variation, supported: true, reason: '', variation, pinched, mode };
}
function gpuMorphGraffitiIneligibleReason(frameCtx, requireReady = true) {
  const layer = frameCtx?.layer,
    effectLayer = liveGraffitiEffectLayer(frameCtx);
  if (!frameCtx || !layer) return 'no-frame';
  // The prepared ribbon carries per-path growth, unlike the retained cubic shortcut.
  if (frameCtx.geometryProvider?.framePaths?.some((path) => path?.strokeGrowth < 1))
    return 'prepared-stroke-growth';
  if (
    (frameCtx.lineProfileApplication ||
      effectLayer?.lineProfileApplication ||
      layer.lineProfileApplication) !== 'graffiti'
  )
    return 'not-graffiti';
  const sampleReq = gpuMorphGraffitiSampledRequirement(frameCtx);
  if (!sampleReq.supported) return sampleReq.reason;
  if (typeof gpuMorphArcIneligibleReason === 'function') {
    const reason = gpuMorphArcIneligibleReason(frameCtx);
    if (reason) return reason;
  } else {
    if (!frameCtx.morphFrameActive) return 'morph-inactive';
    if (!frameCtx.blueMorphProvider?.geometryActive) return 'blue-geometry-inactive';
    if (frameCtx.geometryProvider !== frameCtx.blueMorphProvider) return 'another-geometry-provider';
  }
  if (requireReady) {
    if (typeof WebGPUGraffitiMorphRenderer === 'undefined' || !WebGPUGraffitiMorphRenderer.isReady?.())
      return 'gpu-graffiti-warming';
    const rec = currentGpuBezierMorphResource(frameCtx.layerIndex);
    if (!rec?.ready) return 'gpu-morph-resource-unavailable';
    if (sampleReq.needed) {
      if (typeof warmupGpuMorphArcResource !== 'function' || !warmupGpuMorphArcResource())
        return 'gpu-morph-arc-warming';
      if (typeof warmupGpuGraffitiSampleResource !== 'function' || !warmupGpuGraffitiSampleResource())
        return 'gpu-graffiti-sampler-warming';
    }
  }
  return '';
}

function prepareGpuMorphGraffitiFrame(frameCtx) {
  if (!frameCtx || !somataGpuBackendAllowed()) return null;
  graffitiGpuMorphBridgeStats.requests++;
  const fid = Number(frameCtx.frameId) || Number(frameGeometryRuntime?.frameId) || 0;
  if (frameCtx._gpuMorphGraffitiPreparedFrame === fid) return frameCtx._gpuMorphGraffitiPrepared || null;
  frameCtx._gpuMorphGraffitiPreparedFrame = fid;
  frameCtx._gpuMorphGraffitiPrepared = null;
  try {
    WebGPUGraffitiMorphRenderer?.warmup?.();
  } catch (error) {
    noteSuppressedError('render/graffiti-pass#prepareGpuMorphGraffitiFrame', error);
  }
  const sampleReq = gpuMorphGraffitiSampledRequirement(frameCtx);
  if (sampleReq.needed) {
    try {
      warmupGpuMorphArcResource?.();
      warmupGpuGraffitiSampleResource?.();
    } catch (error) {
      noteSuppressedError('render/graffiti-pass#prepareGpuMorphGraffitiFrame', error);
    }
  }
  const reason = gpuMorphGraffitiIneligibleReason(frameCtx, true);
  if (reason) {
    graffitiGpuMorphBridgeStats.fallbacks++;
    graffitiGpuMorphBridgeStats.lastReason = reason;
    return null;
  }
  const rec = currentGpuBezierMorphResource(frameCtx.layerIndex);
  if (!rec?.ready) {
    graffitiGpuMorphBridgeStats.fallbacks++;
    graffitiGpuMorphBridgeStats.lastReason = 'gpu-morph-resource-unavailable';
    return null;
  }
  const rawT = frameCtx.blueMorphProvider?.geometryT ?? frameCtx.geometryPlan?.progress,
    t =
      typeof rec.resolveMorphT === 'function'
        ? rec.resolveMorphT(rawT)
        : morphInterpolationTForCurrentMode(rawT),
    layer = liveGraffitiEffectLayer(frameCtx) || frameCtx.layer;
  const prepared = {
    application: 'graffiti',
    type: normalizeLineProfileValue?.(layer?.lineProfileGraffiti, 'slash') || 'slash',
    gpuMorphNative: true,
    gpuRibbonEligible: false,
    gpuMorphResource: rec,
    gpuMorphT: t,
    frameId: fid,
    paths: null,
    rounded: null,
    variationOn: sampleReq.variation,
    variationMode: sampleReq.mode,
    gpuMorphSampled: false,
    gpuMorphArcTable: null,
    gpuGraffitiSampleResource: null,
  };
  if (sampleReq.needed) {
    const pair = getGpuGraffitiSampleResourceForFrame(frameCtx);
    if (!pair?.table || !pair?.resource?.ready) {
      graffitiGpuMorphBridgeStats.fallbacks++;
      graffitiGpuMorphBridgeStats.lastReason = 'gpu-graffiti-sample-resource-unavailable';
      return null;
    }
    prepared.gpuMorphSampled = true;
    prepared.gpuMorphArcTable = pair.table;
    prepared.gpuGraffitiSampleResource = pair.resource;
    graffitiGpuMorphBridgeStats.sampledHits++;
    graffitiGpuMorphBridgeStats.cpuResamplesAvoided += Math.max(1, Number(pair.resource.pathCount) || 1);
    graffitiGpuMorphBridgeStats.lastReason = `shared-gpu-arc-sampled-${sampleReq.pinched ? 'pinched' : sampleReq.mode}`;
  } else {
    graffitiGpuMorphBridgeStats.directHits++;
    graffitiGpuMorphBridgeStats.lastReason = 'shared-retained-bezier-cubics';
  }
  frameCtx._gpuMorphGraffitiPrepared = prepared;
  graffitiGpuMorphBridgeStats.hits++;
  graffitiGpuMorphBridgeStats.cpuPathBuildsAvoided++;
  graffitiGpuMorphBridgeStats.cpuRibbonBuildsAvoided++;
  return prepared;
}

export { prepareGpuMorphGraffitiFrame };
