import './profile-plan.js'; // initialisation order: this module runs after it
import { SomataGeometryPolicy } from './geometry-policy.js';
import { requestMainCanvasRender } from '../core/scheduler.js';
import {
  createDefaultLineMotionFxConfig,
  createDefaultLineSpriteConfig,
  ensureLayerEffectState,
  lineSpritePlacementIsSparse,
} from '../core/defaults-layers.js';
import { WebGPUPathFxRenderer } from '../gpu/path-fx-renderer.js';
import { getLayerFramePathFxTable } from '../geometry/frame-paths.js';
import { ensureGpuPathFxAnimation } from '../effects/effect-animation.js';
import { getGpuMorphArcTableForFrame } from '../gpu/morph-arc-resource.js';
import { SomataFeatureHost } from './feature-host.js';
import { SPIRO_PATH_CAPS } from './render-graph.js';
import { noteSuppressedError } from '../core/suppressed-errors.js';

SomataFeatureHost.register('motion', {
  domain: 'effect',
  plans: ['motion'],
  outputs: ['_pathFxPrequeuedMotion', '_pathFxReplacementCommitted', '_pathFxReplacementKind'],
});
SomataFeatureHost.register('sprite', {
  domain: 'effect',
  plans: ['sprite'],
  outputs: ['_pathFxPrequeuedSprite', '_pathFxReplacementCommitted', '_pathFxReplacementKind'],
});
SomataFeatureHost.provide('motion', 'frameBegin', ({ displayLayers }) => {
  if (
    Array.isArray(displayLayers) &&
    displayLayers.some((l) => l?.visible !== false && l?.lineMotionFx?.enabled === true)
  )
    ensureGpuPathFxAnimation();
  return null;
});
SomataFeatureHost.provide('sprite', 'frameBegin', ({ displayLayers }) => {
  if (
    Array.isArray(displayLayers) &&
    displayLayers.some((l) => l?.visible !== false && l?.sprite?.enabled === true)
  )
    ensureGpuPathFxAnimation();
  return null;
});

function resetPathFxEffectPlan(plan) {
  const p = plan && typeof plan === 'object' ? plan : {};
  p.enabled = false;
  p.cfg = null;
  p.table = null;
  p.gpuMorphArc = false;
  p.replaceBaseReady = false;
  p.footprint = 0;
  p.now = 0;
  return p;
}

function resolveLayerMotionEffectProvider(frameCtx, plan) {
  const owner = frameCtx.effectLayer || liveEffectOwnerForFrameLayer(frameCtx.layer),
    rawCfg = ensureLayerEffectState(owner)?.lineMotionFx || createDefaultLineMotionFxConfig(),
    cfg = { ...rawCfg };
  if (cfg.type === 'sine') cfg.type = 'seaRaft';
  plan.cfg = cfg;
  plan.enabled = cfg.enabled === true;
  plan.now = frameCtx.now;
  if (!plan.enabled) return plan;
  plan.table = getGpuMorphArcTableForFrame(frameCtx);
  plan.gpuMorphArc = plan.table?.gpuArcResident === true;
  if (!plan.table && SomataGeometryPolicy.isStrict(frameCtx)) {
    plan.enabled = false;
    try {
      requestMainCanvasRender?.();
    } catch (error) {
      noteSuppressedError('render/path-fx-plan#resolveLayerMotionEffectProvider', error);
    }
    return plan;
  }
  if (!plan.table) plan.table = getLayerFramePathFxTable(frameCtx);
  if (!(plan.table?.gpuArcResident === true) && !plan.table?.total) {
    plan.enabled = false;
    return plan;
  }
  plan.footprint = Math.max(
    1,
    ((Number(frameCtx.strokeWidth) || 1.5) * Math.max(0.2, Number(cfg.widthPercent) || 100)) / 100 +
      Math.max(0, Number(cfg.amplitudePx) || 0) *
        Math.max(0, Number.isFinite(Number(cfg.amplitudeMultiplier)) ? Number(cfg.amplitudeMultiplier) : 1),
  );
  WebGPUPathFxRenderer.warmup();
  plan.replaceBaseReady = cfg.replaceBase === true && WebGPUPathFxRenderer.isReady();
  return plan;
}
function resolveLayerSpriteEffectProvider(frameCtx, plan) {
  const effectLayer = frameCtx.effectLayer || liveEffectOwnerForFrameLayer(frameCtx.layer),
    rawCfg = ensureLayerEffectState(effectLayer)?.sprite || createDefaultLineSpriteConfig(),
    cfg = { ...rawCfg, lengthPercent: 100, amplitudePx: 0, speedPercent: 0 };
  plan.cfg = cfg;
  plan.enabled = cfg.enabled === true;
  plan.now = frameCtx.now;
  if (!plan.enabled) return plan;
  plan.table = getGpuMorphArcTableForFrame(frameCtx);
  plan.gpuMorphArc = plan.table?.gpuArcResident === true;
  if (!plan.table && SomataGeometryPolicy.isStrict(frameCtx)) {
    plan.enabled = false;
    try {
      requestMainCanvasRender?.();
    } catch (error) {
      noteSuppressedError('render/path-fx-plan#resolveLayerSpriteEffectProvider', error);
    }
    return plan;
  }
  if (!plan.table) plan.table = getLayerFramePathFxTable(frameCtx);
  if (!(plan.table?.gpuArcResident === true) && !plan.table?.total) {
    plan.enabled = false;
    return plan;
  }
  plan.footprint = Math.max(
    1,
    (((Number(frameCtx.strokeWidth) || 1.5) * Math.max(0.4, Number(cfg.widthPercent) || 1800)) / 100) *
      Math.max(0.01, Number(cfg.widthMultiplier) || 1),
  );
  WebGPUPathFxRenderer.warmup();
  plan.replaceBaseReady = !lineSpritePlacementIsSparse(cfg.mode) && WebGPUPathFxRenderer.isReady();
  return plan;
}

SomataFeatureHost?.provide?.('motion', 'effectPlan', (frameCtx, previousPlans) =>
  resolveLayerMotionEffectProvider(frameCtx, resetPathFxEffectPlan(previousPlans?.motion)),
);
SomataFeatureHost?.provide?.('sprite', 'effectPlan', (frameCtx, previousPlans) =>
  resolveLayerSpriteEffectProvider(frameCtx, resetPathFxEffectPlan(previousPlans?.sprite)),
);
SomataFeatureHost?.provide?.('motion', 'graphPass', (frameCtx, plans) => {
  const plan = plans?.motion;
  return {
    name: 'motion',
    caps:
      SPIRO_PATH_CAPS.POSITIONS |
      SPIRO_PATH_CAPS.SEGMENT_TOPOLOGY |
      SPIRO_PATH_CAPS.EXACT_ARC |
      (plan?.gpuMorphArc === true ? 0 : SPIRO_PATH_CAPS.CPU_PATH),
    active: plan?.enabled === true,
    backend: plan?.gpuMorphArc === true ? 'gpu-arc' : 'gpu-prepared',
  };
});
SomataFeatureHost?.provide?.('sprite', 'graphPass', (frameCtx, plans) => {
  const plan = plans?.sprite;
  return {
    name: 'sprite',
    caps:
      SPIRO_PATH_CAPS.POSITIONS |
      SPIRO_PATH_CAPS.SEGMENT_TOPOLOGY |
      SPIRO_PATH_CAPS.EXACT_ARC |
      (plan?.gpuMorphArc === true ? 0 : SPIRO_PATH_CAPS.CPU_PATH),
    active: plan?.enabled === true,
    backend: plan?.gpuMorphArc === true ? 'gpu-arc' : 'gpu-prepared',
  };
});
SomataFeatureHost?.provide?.('motion', 'resetEffectPlan', (plans) => resetPathFxEffectPlan(plans?.motion));
SomataFeatureHost?.provide?.('sprite', 'resetEffectPlan', (plans) => resetPathFxEffectPlan(plans?.sprite));

SomataFeatureHost?.provide?.(
  'motion',
  'strokeBatchDemand',
  (frameCtx, plans) => plans?.motion?.enabled === true,
);
SomataFeatureHost?.provide?.(
  'sprite',
  'strokeBatchDemand',
  (frameCtx, plans) => plans?.sprite?.enabled === true,
);
