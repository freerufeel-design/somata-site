import './sweep-pass.js'; // initialisation order: this module runs after it
import { mainCtx } from '../core/render-runtime.js';
import { requestMainCanvasRender } from '../core/scheduler.js';
import {
  ensureLayerEffectState,
  getLayerEffectOwner,
  normalizeParticleConfig,
} from '../core/defaults-layers.js';
import { renderBackendTelemetry } from './backend-telemetry.js';
import { WebGPUParticleRenderer } from '../gpu/particle-renderer.js';
import { SomataFeatureHost } from './feature-host.js';
import { SomataLayerSceneService } from './layer-scene-service.js';
import { SomataGeometryRoleService } from './geometry-role-service.js';
import { noteSuppressedError } from '../core/suppressed-errors.js';

SomataFeatureHost.register('particles', {
  domain: 'effect',
  plans: ['particles'],
  reads: ['_geometryContract'],
  outputs: [],
});
function queueParticleGpuFallback(frameCtx, cfg) {
  try {
    WebGPUParticleRenderer?.warmup?.();
    requestMainCanvasRender?.();
    renderBackendTelemetry?.mark?.(
      'particles',
      'gpu',
      'particle renderer warming; no cross-feature fallback',
    );
  } catch (error) {
    noteSuppressedError('render/particle-pass#queueParticleGpuFallback', error);
  }
  return false;
}
function renderLayerParticlePass(frameCtx) {
  const effectLayer = frameCtx?.effectLayer || getLayerEffectOwner(frameCtx?.layer) || frameCtx?.layer;
  const cfg = normalizeParticleConfig(effectLayer?.particles);
  if (!cfg?.enabled || frameCtx?.layer?.visible === false) return false;
  try {
    if (frameCtx?.frame?.gpuLayerSceneDeferred !== true)
      SomataLayerSceneService.ensure(frameCtx, 'particle-effect');
    if (frameCtx?.frame?.gpuLayerSceneDeferred === true) {
      const scene = SomataLayerSceneService.resident(frameCtx),
        rec = scene?.texture
          ? WebGPUParticleRenderer?.encodeToLayerScene?.(scene.texture, frameCtx, mainCtx)
          : null;
      if (rec?.handled) {
        if (rec.commandBuffer)
          SomataLayerSceneService.queue(
            frameCtx,
            somataEffectPhase('particles'),
            rec.commandBuffer,
            'particles',
            rec.onSubmitted,
          );
        renderBackendTelemetry?.mark?.('particles', 'gpu', 'ordered Layer Scene particles');
        return true;
      }
    }
    const strictSpiral = SomataGeometryRoleService.isStrict(frameCtx);
    if (strictSpiral) {
      renderBackendTelemetry?.mark?.('particles', 'gpu', 'Spiral particle Layer Scene warmup');
      try {
        requestMainCanvasRender?.();
      } catch (error) {
        noteSuppressedError('render/particle-pass#renderLayerParticlePass', error);
      }
      return false;
    }
    const ok = WebGPUParticleRenderer?.queueLayer?.(frameCtx, mainCtx) === true;
    if (ok) {
      renderBackendTelemetry?.mark?.('particles', 'gpu', 'particle overlay compatibility path');
      return true;
    }
    return queueParticleGpuFallback(frameCtx, cfg);
  } catch (_) {
    if (SomataGeometryRoleService.isStrict(frameCtx)) return false;
    return queueParticleGpuFallback(frameCtx, cfg);
  }
}
function flushParticleFrameQueue() {
  try {
    return WebGPUParticleRenderer?.flush?.() === true;
  } catch (_) {
    return false;
  }
}

SomataFeatureHost.provide(
  'particles',
  'frameBegin',
  ({ renderFrame, displayLayers, gpuBackendAllowed, width, height }) => {
    if (!gpuBackendAllowed) return { framePatch: { particleOverlayReady: false } };
    const needed = (displayLayers || []).some((l) => {
      const e = liveEffectOwnerForFrameLayer(l);
      return l?.visible !== false && normalizeParticleConfig(e?.particles).enabled === true;
    });
    const ready =
      WebGPUParticleRenderer?.beginOverlayFrame?.(renderFrame?.id, width, height, needed) === true;
    return { framePatch: { particleOverlayReady: ready } };
  },
);
SomataFeatureHost.provide('particles', 'frameEnd', ({ gpuBackendAllowed }) => {
  if (gpuBackendAllowed) flushParticleFrameQueue();
  return null;
});

window.SomataRenderPassRegistry?.register?.('particles', {
  stage: window.SomataRenderPassRegistry.STAGES.POST_BASE,
  order: 70,
  run: renderLayerParticlePass,
});
