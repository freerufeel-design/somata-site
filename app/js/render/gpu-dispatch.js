// Выбор GPU-пути для базовой геометрии и эффектов Коридора, прогрев конвейеров.
import './gl-recording-context.js'; // initialisation order: this module runs after it
import { mainCtx } from '../core/render-runtime.js';
import { runtimeState, state } from '../core/state.js';
import { WebGPUBezierSweepRenderer } from '../gpu/bezier-sweep-renderer.js';
import { WebGPUCanonicalSweepRenderer } from '../gpu/canonical-sweep-renderer.js';
import { WebGPUGraffitiMorphRenderer } from '../gpu/graffiti-morph-renderer.js';
import { WebGPUGreenProjectMorphRenderer } from '../gpu/green-project-morph-renderer.js';
import { WebGPULampRenderer } from '../gpu/lamp-renderer.js';
import { WebGPULightningArcRenderer } from '../gpu/lightning-arc-renderer.js';
import { warmupGpuMorphArcResource } from '../gpu/morph-arc-resource.js';
import { WebGPUParticleRenderer } from '../gpu/particle-renderer.js';
import { WebGPUPathFxRenderer } from '../gpu/path-fx-renderer.js';
import { WebGPUProfileArcMarkerRenderer } from '../gpu/profile-arc-marker-renderer.js';
import { WebGPUSpiralBezierMorphRenderer } from '../gpu/spiral-bezier-morph-renderer.js';
import { WebGPUTopologyMorphBaseRenderer } from '../gpu/topology-morph-base-renderer.js';
import { warmupGpuWebCornerResource } from '../gpu/web-corner-resource.js';
import { WebGPUWebMorphRenderer } from '../gpu/web-morph-renderer.js';
import { WebGPUWebThreadSceneRenderer } from '../gpu/web-thread-scene-renderer.js';
import { SomataCorridorCopyFrame } from './corridor-copy-frame.js';
import { isSpiralLayer } from '../geometry/spiral/order-params.js';
import { WebGPUDeviceHub } from '../gpu/device-hub.js';
import { WebGPUFinalCompositeRenderer } from '../gpu/final-composite-renderer.js';
import { WebGPUStrokeRenderer } from '../gpu/stroke-renderer.js';
import { GeometryGPURenderer, LineEffectsGPURenderer } from '../gpu/line-effects-renderer.js';
import {
  canUseSpiralCorridorMasterInstancing,
  getDynamicTunnelMorphMasterStrokeCommands,
  getFrameGLStrokeCommands,
  getTunnelMasterStrokeCommands,
  sharedCorridorFrameOwner,
  spiralCorridorInstanceStats,
} from './stroke-command-cache.js';
import { WebGPUSweepRenderer } from '../gpu/sweep-renderer.js';
import { acquireReusableTunnelStrokeRecorder } from './gl-recording-context.js';
import { noteSuppressedError } from '../core/suppressed-errors.js';

const SOMATA_CORRIDOR_INTERPOLATE_COPY_ALPHA_ALONG_SPIRAL = false;
function buildCorridorGPUOptions(frameCtx, extra = {}) {
  const tr = mainCtx.getTransform(),
    alphas = frameCtx.visibleInstances?.alphas || [];
  const sharedOwner = sharedCorridorFrameOwner(frameCtx);
  const colorForCopy = (copy, i) => SomataCorridorCopyFrame.stroke(frameCtx, copy, i);
  const rotationForCopy = (copy, i) => SomataCorridorCopyFrame.rotation(frameCtx, copy, i);
  // 7.6.5: copy reveal/fade is an instance property. Never interpolate
  // the alpha of one Corridor copy into the next along the Spiral rail:
  // that creates a radial-looking dark patch on every older copy that
  // crosses the center. Static/general GPU Corridor now matches retained
  // Spiral Morph: each copy keeps one alpha for its whole geometry.
  return {
    originX: tr.e,
    originY: tr.f,
    baseAlpha: frameCtx.baseAlpha,
    alphas,
    spiralSeamAlpha: SOMATA_CORRIDOR_INTERPOLATE_COPY_ALPHA_ALONG_SPIRAL,
    copyCacheKey: sharedOwner,
    copyCacheFrameId: frameCtx.frameId,
    copyCacheVariant: 'effect',
    copyResidencyKey: frameCtx.effectLayerSource || frameCtx.sourceLayer || frameCtx.layer,
    residentCopyPayload: true,
    sharedCorridorTransformBasis: true,
    rotationForCopy,
    colorForCopy,
    ...extra,
  };
}
function tryRenderCorridorLineEffectGPU(frameCtx, opt = {}) {
  if (state.tunnel?.active !== true || state.showRoundingGuides || frameCtx.lineProfileStrokeOnly)
    return false;
  if (isSpiralLayer(frameCtx.layer) && !canUseSpiralCorridorMasterInstancing(frameCtx)) return false;
  if (!WebGPUStrokeRenderer.isReady()) return false;
  const master =
    frameCtx.geometryPlan?.dynamic === true
      ? getDynamicTunnelMorphMasterStrokeCommands(frameCtx)
      : getTunnelMasterStrokeCommands(frameCtx);
  if (!master?.length) return false;
  const copies = frameCtx.visibleInstances?.copies || [];
  if (!copies.length) return true;
  return LineEffectsGPURenderer.renderCorridor(
    master,
    copies,
    mainCtx,
    buildCorridorGPUOptions(frameCtx, {
      ...opt,
      dynamicSegments: frameCtx.geometryPlan?.dynamic === true,
      copyCacheVariant: frameCtx.geometryPlan?.dynamic === true ? 'effect-morph' : 'effect',
    }),
  );
}
function tryRenderBaseGeometryGPU(frameCtx) {
  const trace = (reason, detail = {}) => {
    if (state.tunnel?.active === true) frameCtx._corridorPerCopyGpuTrace = { reason, ...detail };
  };
  if (!frameCtx?.lineDisplayEnabled || frameCtx.lineProfileStrokeOnly || state.showRoundingGuides)
    return false;

  if (frameCtx.geometryPlan?.kind === 'lightning') return false;

  if (!GeometryGPURenderer.isAvailable()) {
    trace('gpu-renderer-unavailable');
    return false;
  }

  const tunnelMix = state.tunnel.active === true;

  const gpuOnlyTunnel =
    tunnelMix && state.tunnel?.colorShiftEnabled !== true && state.tunnel?.paletteLagEnabled !== true;
  const glWeight =
    tunnelMix && !gpuOnlyTunnel
      ? (copy, alpha, index) => {
          const r = Math.max(0, Number(frameCtx.instanceMetrics?.[index]?.radiusPx) || 0);
          const q = Math.max(0, Math.min(1, (r - 24) / 12));
          return q * q * (3 - 2 * q);
        }
      : null;
  const cpuWeight =
    tunnelMix && !gpuOnlyTunnel ? (copy, alpha, index) => 1 - glWeight(copy, alpha, index) : null;

  if (!tunnelMix) {
    const commands = getFrameGLStrokeCommands(frameCtx);
    return commands ? GeometryGPURenderer.render(commands, mainCtx) : false;
  }

  const spiralCorridor = isSpiralLayer(frameCtx.layer);
  const allowMasterInstancing = !spiralCorridor || canUseSpiralCorridorMasterInstancing(frameCtx);
  const master = allowMasterInstancing
    ? frameCtx.geometryPlan?.dynamic === true
      ? getDynamicTunnelMorphMasterStrokeCommands(frameCtx)
      : getTunnelMasterStrokeCommands(frameCtx)
    : null;
  if (master && WebGPUStrokeRenderer.isReady()) {
    const copies = frameCtx.visibleInstances?.copies || [];
    const instanced = GeometryGPURenderer.renderCorridor(
      master,
      copies,
      mainCtx,
      buildCorridorGPUOptions(frameCtx, {
        copyCacheVariant: frameCtx.geometryPlan?.dynamic === true ? 'base-morph' : 'base',
        weightForCopy: glWeight,
        deferComposite: true,
        dynamicSegments: frameCtx.geometryPlan?.dynamic === true,
      }),
    );
    if (instanced) {
      if (spiralCorridor) spiralCorridorInstanceStats.baseCommits++;
      if (cpuWeight) frameCtx.drawLayerInstances(mainCtx, true, cpuWeight);
      GeometryGPURenderer.composite(mainCtx);
      trace('instanced-committed');
      return true;
    }
    if (spiralCorridor) spiralCorridorInstanceStats.baseDeclines++;
    trace('instanced-declined', {
      masterCount: master.length,
      copyCount: copies.length,
      rendererError: String(WebGPUStrokeRenderer?.status?.()?.lastError || ''),
    });
  }

  if (spiralCorridor && frameCtx._spiralCorridorSharedLineAuthority === true) {
    // Web already attached to this exact recorded Line master in the
    // current frame. A per-copy re-recording here could silently use
    // another phase/profile. Do not display a detached Web/Line pair;
    // let Base report a GPU miss and request a fresh frame instead.
    trace('shared-line-master-not-committed', { masterCount: master?.length || 0 });
    return false;
  }
  const rec = acquireReusableTunnelStrokeRecorder(
    frameCtx.effectLayerSource || frameCtx.sourceLayer || frameCtx.layer,
    true,
  );
  try {
    frameCtx.drawLayerInstances(rec, true, glWeight);
  } catch (err) {
    trace('per-copy-record-exception', { error: String(err?.message || err) });
    return false;
  }
  if (rec.unsupported) {
    trace('per-copy-record-unsupported');
    return false;
  }
  if (!rec.commands.length) {
    if (cpuWeight) frameCtx.drawLayerInstances(mainCtx, true, cpuWeight);
    trace('per-copy-empty');
    return true;
  }
  if (!GeometryGPURenderer.render(rec.commands, mainCtx, true)) {
    trace('per-copy-gpu-declined', {
      commandCount: rec.commands.length,
      gpuActive: GeometryGPURenderer?.status?.()?.active || 'none',
    });
    return false;
  }
  if (cpuWeight) frameCtx.drawLayerInstances(mainCtx, true, cpuWeight);
  GeometryGPURenderer.composite(mainCtx);
  trace('per-copy-committed');
  return true;
}
const warmPrimaryGpuPipelines = () => {
  // Boot just the mandatory renderer paths; avoid launching a dozen
  // shader compilations together as soon as requestDevice resolves.
  try {
    WebGPUDeviceHub.warmup();
  } catch (error) {
    noteSuppressedError('render/gpu-dispatch#warmPrimaryGpuPipelines', error);
  }
  try {
    WebGPUStrokeRenderer.warmup();
  } catch (error) {
    noteSuppressedError('render/gpu-dispatch#warmPrimaryGpuPipelines', error);
  }
  try {
    WebGPUFinalCompositeRenderer.warmup();
  } catch (error) {
    noteSuppressedError('render/gpu-dispatch#warmPrimaryGpuPipelines', error);
  }
};
if (typeof requestIdleCallback === 'function') requestIdleCallback(warmPrimaryGpuPipelines, { timeout: 800 });
else setTimeout(warmPrimaryGpuPipelines, 0);
// The primary warmup may fire while requestAdapter/requestDevice is still
// pending. Prepare the specialised Corridor + Blue paths after acquisition,
// in separate idle turns rather than compiling all pipelines on first play.
const startupModeWarmup = { stage: 0, completed: false, corridorRingReady: false, error: '' };
const queueModeWarmupIdle = (step) => {
  if (typeof requestIdleCallback === 'function') requestIdleCallback(step);
  else setTimeout(step, 40);
};
void WebGPUDeviceHub.acquire()
  .then(() => {
    const stages = [
      () => {
        try {
          WebGPUStrokeRenderer.warmup();
        } catch (error) {
          noteSuppressedError('render/gpu-dispatch', error);
        }
        startupModeWarmup.corridorRingReady = WebGPUStrokeRenderer.prewarmCorridorCopies(256);
        // A renderer may still be completing its own asynchronous init.
        // If so, retry when idle; never put allocations in the first draw.
        return startupModeWarmup.corridorRingReady;
      },
      () => {
        try {
          WebGPUSpiralBezierMorphRenderer?.warmup?.();
        } catch (error) {
          noteSuppressedError('render/gpu-dispatch', error);
        }
        try {
          WebGPUTopologyMorphBaseRenderer?.warmup?.();
        } catch (error) {
          noteSuppressedError('render/gpu-dispatch', error);
        }
        return true;
      },
      () => {
        try {
          WebGPUBezierSweepRenderer?.warmup?.();
        } catch (error) {
          noteSuppressedError('render/gpu-dispatch', error);
        }
        try {
          WebGPUCanonicalSweepRenderer?.warmup?.();
        } catch (error) {
          noteSuppressedError('render/gpu-dispatch', error);
        }
        return true;
      },
      () => {
        try {
          WebGPUWebThreadSceneRenderer?.warmup?.();
        } catch (error) {
          noteSuppressedError('render/gpu-dispatch', error);
        }
        try {
          WebGPUProfileArcMarkerRenderer?.warmup?.();
        } catch (error) {
          noteSuppressedError('render/gpu-dispatch', error);
        }
        return true;
      },
      () => {
        try {
          WebGPUSweepRenderer?.warmup?.();
        } catch (error) {
          noteSuppressedError('render/gpu-dispatch', error);
        }
        try {
          WebGPULampRenderer?.warmup?.();
        } catch (error) {
          noteSuppressedError('render/gpu-dispatch', error);
        }
        return true;
      },
      () => {
        try {
          WebGPUGraffitiMorphRenderer?.warmup?.();
        } catch (error) {
          noteSuppressedError('render/gpu-dispatch', error);
        }
        try {
          WebGPULightningArcRenderer?.warmup?.();
        } catch (error) {
          noteSuppressedError('render/gpu-dispatch', error);
        }
        return true;
      },
      () => {
        try {
          WebGPUWebMorphRenderer?.warmup?.();
        } catch (error) {
          noteSuppressedError('render/gpu-dispatch', error);
        }
        try {
          WebGPUParticleRenderer?.warmup?.();
        } catch (error) {
          noteSuppressedError('render/gpu-dispatch', error);
        }
        return true;
      },
      () => {
        try {
          warmupGpuMorphArcResource?.();
        } catch (error) {
          noteSuppressedError('render/gpu-dispatch', error);
        }
        try {
          warmupGpuWebCornerResource?.();
        } catch (error) {
          noteSuppressedError('render/gpu-dispatch', error);
        }
        return true;
      },
      () => {
        try {
          WebGPUPathFxRenderer?.warmup?.();
        } catch (error) {
          noteSuppressedError('render/gpu-dispatch', error);
        }
        try {
          WebGPUGreenProjectMorphRenderer?.warmup?.();
        } catch (error) {
          noteSuppressedError('render/gpu-dispatch', error);
        }
        return true;
      },
    ];
    let copyRetries = 0;
    const run = (deadline) => {
      if (startupModeWarmup.completed) return;
      // Optional compilation must not steal a frame from active animations.
      if (runtimeState?.morph?.active === true) {
        setTimeout(() => queueModeWarmupIdle(run), 1200);
        return;
      }
      // During Corridor motion only compile when there is actual spare
      // time, never on a timeout that forcibly runs inside a busy frame.
      // This lets Blue warm while Corridor remains switched on.
      if (
        state?.tunnel?.active === true &&
        typeof requestIdleCallback === 'function' &&
        deadline?.timeRemaining?.() < 8
      ) {
        setTimeout(() => queueModeWarmupIdle(run), 250);
        return;
      }
      try {
        const done = stages[startupModeWarmup.stage]();
        if (done || startupModeWarmup.stage !== 0 || ++copyRetries >= 20) startupModeWarmup.stage++;
        if (startupModeWarmup.stage >= stages.length) {
          startupModeWarmup.completed = true;
          return;
        }
      } catch (err) {
        startupModeWarmup.error = String(err?.message || err);
        startupModeWarmup.stage++;
      }
      queueModeWarmupIdle(run);
    };
    queueModeWarmupIdle(run);
  })
  .catch((err) => {
    startupModeWarmup.error = String(err?.message || err);
  });
window.__spiroWebGPUHubStatus = () => WebGPUDeviceHub.status();
window.__spiroWebGPUStatus = () => WebGPUStrokeRenderer.status();
window.__spiroFinalGPUStatus = () => WebGPUFinalCompositeRenderer.status();

export { buildCorridorGPUOptions, tryRenderBaseGeometryGPU, tryRenderCorridorLineEffectGPU };
