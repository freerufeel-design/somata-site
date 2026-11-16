import './lamp-stability.js'; // initialisation order: this module runs after it
import { SomataGeometryPolicy } from './geometry-policy.js';
import { state } from '../core/state.js';
import { mainCtx } from '../core/render-runtime.js';
import { requestMainCanvasRender } from '../core/scheduler.js';
import { applyMotionTunnelLag } from '../effects/motion.js';
import { withLampConfig } from '../core/defaults-layers.js';
import { renderBackendTelemetry } from './backend-telemetry.js';
import { SomataFrameContourService } from '../geometry/frame-contour.js';
import { LampGPURenderer } from '../gpu/lamp-renderer.js';
import { applyLayerFrameEffectTransform, getLayerFrameAuxiliaryPaths } from '../geometry/frame-paths.js';
import { lampAdaptivePointCount, lampVisualNow } from '../lamps/lamp-motion.js';
import { lampBendAnimationMs } from '../lamps/lamp-attachment.js';
import { collectMorphLampPoints } from '../lamps/lamp-topology.js';
import { lampAdaptiveFrame, prepareLampDrawStyle, prepareLampVisualPlan } from '../lamps/lamp-visual.js';
import { SomataFeatureHost } from './feature-host.js';
import { somataGpuContractError, somataGpuDiagnosticError } from './render-diagnostics.js';
import { lampContourAttachmentEnabledForFrame } from './lamp-morph-bridge.js';
import { SomataLampStability } from './lamp-stability.js';
import { noteSuppressedError } from '../core/suppressed-errors.js';

function renderLayerLampPass(frameCtx) {
  const effect = frameCtx.effectsPlan?.lamps;
  if (!effect?.enabled || !effect.instances?.copies?.length) return;
  const strictSpiralGpu = SomataGeometryPolicy.isStrict(frameCtx);
  if (strictSpiralGpu && LampGPURenderer.isWebGPUReady?.() !== true) {
    renderBackendTelemetry.mark('lamps', 'gpu', 'Spiral Full WebGPU lamp renderer unavailable');
    somataGpuContractError('SPIRAL_LAMPS_GPU_UNAVAILABLE', frameCtx, {
      lamp: LampGPURenderer.status?.() || null,
    });
    return;
  }
  for (const [setIndex, set] of effect.sets.entries()) {
    if (!set?.points?.length || set.alphaBase <= 0.001) continue;
    const drawPlan = {
      config: set.config || effect.baseConfig || {},
      audioLayerIndex: frameCtx.layerIndex,
      tunnelActive: effect.tunnelActive === true,
      zoom: frameCtx.frame?.zoom ?? state.zoom,
      outerStateIsolated: true,
      preparedStyle: set.stylePlan || {},
      cssTransformScale: 1,
    };
    const prepareVisual = () => {
      prepareLampDrawStyle(
        drawPlan.config,
        drawPlan.audioLayerIndex,
        lampAdaptivePointCount(set.points, drawPlan.config),
        effect.adaptiveCount,
        drawPlan.zoom,
        drawPlan.preparedStyle,
      );
      const plan = prepareLampVisualPlan(
        set.points,
        set.layer,
        drawPlan.config,
        drawPlan.preparedStyle,
        drawPlan.audioLayerIndex,
        set.visualPlan || (set.visualPlan = { items: [] }),
      );
      const arc = set.gpuLampNative === true && (set.gpuPrepared?.gpuLampNativeKind || 'arc') === 'arc';
      const now = frameCtx.frame?.now ?? frameCtx.now ?? lampVisualNow();
      const animating =
        frameCtx.morphFrameActive === true ||
        frameCtx.blueMorphProvider?.active === true ||
        frameCtx.minimalFadeEnabled === true ||
        Number(frameCtx.lampAnimationMs) > 0;
      const stats = SomataLampStability.apply(
        `${frameCtx.layer?.id ?? frameCtx.layerIndex}:${set.layer?.id ?? ''}:${setIndex}:${arc ? 'arc' : 'visual'}`,
        plan.items,
        {
          now,
          duration: lampBendAnimationMs(frameCtx),
          animate: animating,
          arc,
          // «Произвольное» намеренно ставит лампы густо; в остальных режимах близкие лампы одного узла сливаются.
          merge: (set.config?.positionMode || drawPlan.config?.positionMode) === 'arbitrary' ? 0 : 0.5,
        },
      );
      if (stats.pending) {
        lampAdaptiveFrame.needsSettle = true;
        requestMainCanvasRender();
      }
      window.SomataJumpTrace?.observeLamps(
        frameCtx,
        setIndex,
        stats,
        set.alphaBase,
        effect.instances,
        plan.items,
      );
      return plan;
    };
    let visualPlan = prepareVisual();

    if (!visualPlan?.items?.length) continue;
    if (set.gpuLampNative === true && set.gpuPrepared) {
      const nativeKind = set.gpuPrepared.gpuLampNativeKind || 'arc',
        arcNative = nativeKind === 'arc';
      let queued = false;
      {
        if (nativeKind === 'topology-key' || nativeKind === 'topology-ghost') {
          if (effect.tunnelActive)
            queued =
              LampGPURenderer.queueTopologyVisualPlan?.(
                mainCtx,
                visualPlan,
                set.alphaBase,
                drawPlan,
                set.gpuPrepared,
                effect.instances.copies,
                effect.instances.alphas,
                frameCtx,
              ) === true;
          else if (effect.instances.copies.length === 1) {
            const a = Math.max(0, Math.min(1, Number(effect.instances.alphas?.[0] ?? 1)));
            mainCtx.save();
            applyLayerFrameEffectTransform(mainCtx, frameCtx);
            queued =
              LampGPURenderer.queueTopologyVisualPlan?.(
                mainCtx,
                visualPlan,
                set.alphaBase * a,
                drawPlan,
                set.gpuPrepared,
                null,
                null,
                frameCtx,
              ) === true;
            mainCtx.restore();
          }
        } else if (arcNative) {
          if (effect.tunnelActive)
            queued =
              LampGPURenderer.queueArcVisualPlan?.(
                mainCtx,
                visualPlan,
                set.alphaBase,
                drawPlan,
                set.gpuPrepared,
                effect.instances.copies,
                effect.instances.alphas,
                frameCtx,
              ) === true;
          else if (effect.instances.copies.length === 1) {
            const a = Math.max(0, Math.min(1, Number(effect.instances.alphas?.[0] ?? 1)));
            mainCtx.save();
            applyLayerFrameEffectTransform(mainCtx, frameCtx);
            queued =
              LampGPURenderer.queueArcVisualPlan?.(
                mainCtx,
                visualPlan,
                set.alphaBase * a,
                drawPlan,
                set.gpuPrepared,
                null,
                null,
                frameCtx,
              ) === true;
            mainCtx.restore();
          }
        }
        if (queued) {
          const topologyNative = nativeKind === 'topology-key' || nativeKind === 'topology-ghost',
            ghostNative = nativeKind === 'topology-ghost';
          renderBackendTelemetry.mark(
            'lamps',
            'gpu',
            topologyNative
              ? effect.tunnelActive
                ? ghostNative
                  ? 'GPU topology Ghost Corridor lamps'
                  : 'GPU topology Key Corridor lamps'
                : ghostNative
                  ? 'GPU topology Ghost lamps'
                  : 'GPU topology Key lamps'
              : effect.tunnelActive
                ? 'GPU Morph Arc Corridor lamps'
                : 'GPU Morph Arc lamps',
          );
          continue;
        }
      }

      if (SomataGeometryPolicy.isStrict(frameCtx)) {
        renderBackendTelemetry.mark('lamps', 'gpu', 'Spiral lamps GPU-only warmup');
        somataGpuContractError('SPIRAL_LAMP_NATIVE_QUEUE_FAILED', frameCtx, { nativeKind });
        continue;
      }

      if (arcNative) {
        const lampT = frameCtx.blueMorphProvider?.geometryT || 0,
          rawPaths = getLayerFrameAuxiliaryPaths(frameCtx);
        let attachment = null;
        try {
          if (
            !SomataGeometryPolicy.isStrict(frameCtx) &&
            lampContourAttachmentEnabledForFrame(frameCtx) === true
          )
            attachment = SomataFrameContourService?.paths?.(frameCtx) || null;
        } catch (_) {
          attachment = null;
        }
        const fallback = withLampConfig(drawPlan.config, () =>
          collectMorphLampPoints(frameCtx.layerIndex, lampT, 260, rawPaths, attachment),
        );
        set.gpuLampNative = false;
        set.gpuPrepared = null;
        set.points = fallback;
        if (!fallback?.length) continue;
        visualPlan = prepareVisual();
      } else {
        set.gpuLampNative = false;
        set.points = set.gpuPrepared?.attachmentPoints || set.points;
        set.gpuPrepared = null;
        if (!set.points?.length) continue;
        visualPlan = prepareVisual();
      }
    }
    if (!visualPlan?.items?.length) continue;

    if (
      effect.tunnelActive &&
      LampGPURenderer.queueCorridorVisualPlan(
        mainCtx,
        visualPlan,
        set.alphaBase,
        drawPlan,
        effect.instances.copies,
        effect.instances.alphas,
        frameCtx,
      )
    ) {
      renderBackendTelemetry.mark('lamps', 'gpu', 'GPU Corridor lamps');
      continue;
    }
    const cssBase =
      Math.abs(Number(frameCtx.combinedScale) || 1) * Math.max(0.001, Number(drawPlan.zoom) || 1);
    for (let li = 0; li < effect.instances.copies.length; li++) {
      const copy = effect.instances.copies[li],
        copyAlpha = Math.max(0, Math.min(1, Number(effect.instances.alphas?.[li] ?? 1))),
        effectiveAlpha = set.alphaBase * copyAlpha;

      if (effectiveAlpha <= 0.001) continue;
      drawPlan.cssTransformScale = effect.tunnelActive
        ? Math.max(0.000001, Math.abs(Number(copy.scale) || 0) * cssBase)
        : cssBase;
      mainCtx.save();
      if (effect.tunnelActive) {
        applyMotionTunnelLag(mainCtx, copy, frameCtx.layer);
        mainCtx.scale(copy.scale, copy.scale);
      }
      applyLayerFrameEffectTransform(mainCtx, frameCtx);
      const queuedGL = LampGPURenderer.queueVisualPlan(mainCtx, visualPlan, effectiveAlpha, drawPlan);
      if (!queuedGL) {
        const gpuRequested = true;
        if (SomataGeometryPolicy.isStrict(frameCtx)) {
          renderBackendTelemetry.mark('lamps', 'gpu', 'Spiral lamps GPU-only warmup');
          somataGpuContractError('SPIRAL_LAMP_GPU_QUEUE_FAILED', frameCtx, { copyIndex: li });
        } else if (gpuRequested) {
          renderBackendTelemetry.mark('lamps', 'gpu', 'GPU lamps unavailable; Canvas fallback blocked');
          somataGpuDiagnosticError('lamps', 'queue', `GPU lamp queue failed for copy ${li}`, frameCtx, {
            copyIndex: li,
            lamp: LampGPURenderer.status?.() || null,
          });
          try {
            Promise.resolve(LampGPURenderer.ensureWebGPUReady?.()).finally(() => requestMainCanvasRender?.());
          } catch (_) {
            try {
              requestMainCanvasRender?.();
            } catch (error) {
              noteSuppressedError('render/lamp-pass#renderLayerLampPass', error);
            }
          }
        }
      } else renderBackendTelemetry.mark('lamps', 'gpu', 'GPU lamps');
      mainCtx.restore();
    }
  }
}

SomataFeatureHost.provide('lamps', 'frameBegin', ({ renderFrame, gpuBackendAllowed, width, height }) => {
  if (gpuBackendAllowed) LampGPURenderer.beginFrame(width, height, renderFrame?.now);
  return null;
});

const SomataLampPassService = {
  flush(renderFrame, deferComposite = false) {
    try {
      LampGPURenderer.flush({ deferComposite: deferComposite === true });
    } catch (_) {
      return { ok: false, deferred: false };
    }
    const deferred = LampGPURenderer.hasDeferredComposite?.() === true;
    if (renderFrame) renderFrame.gpuLampsDeferred = deferred;
    return { ok: true, deferred };
  },
  presentDeferred() {
    try {
      return LampGPURenderer.presentDeferredToMain?.() !== false;
    } catch (_) {
      return false;
    }
  },
  clear() {
    try {
      LampGPURenderer.clear?.();
      return true;
    } catch (_) {
      return false;
    }
  },
  status() {
    return {
      renderer: LampGPURenderer.status?.() || null,
      contract: 'Main compositor talks to semantic Lamp pass service, never to LampGPURenderer directly.',
    };
  },
};
window.SomataLampPassService = SomataLampPassService;

window.SomataRenderPassRegistry?.register?.('lamps', {
  stage: window.SomataRenderPassRegistry.STAGES.POST_BASE,
  order: 30,
  run: renderLayerLampPass,
});

export { SomataLampPassService };
