import './spiral-geometry-policy.js'; // initialisation order: this module runs after it
import { SomataGeometryPolicy } from './geometry-policy.js';
import { WebGPUStrokeRenderer } from '../gpu/stroke-renderer.js';
import { WebGPUSpiralBezierMorphRenderer } from '../gpu/spiral-bezier-morph-renderer.js';
import { SomataGeometryRoleService } from './geometry-role-service.js';
import {
  canUseGpuSpiralBezierLayerScene,
  resolveGpuSpiralBezierSceneRoute,
} from './geometry-scene-routing.js';
import { noteSuppressedError } from '../core/suppressed-errors.js';

(function () {
  function matches(frameCtx) {
    if (frameCtx?._spiralBezierMorphGpuNative === true) return true;
    try {
      return SomataGeometryPolicy?.isStrict?.(frameCtx) === true;
    } catch (_) {
      return false;
    }
  }
  function eligible(frameCtx, role = 'base') {
    return Boolean(WebGPUSpiralBezierMorphRenderer?.isEligible?.(frameCtx, role) === true);
  }
  function route(frameCtx, allowHiddenGraffitiCarrier = false) {
    try {
      return resolveGpuSpiralBezierSceneRoute(frameCtx, allowHiddenGraffitiCarrier);
    } catch (_) {
      return { deferLayerScene: false, deferFrameScene: false, resident: false };
    }
  }
  function renderGlowBase(frameCtx, ctx2d, opts = {}) {
    if (!eligible(frameCtx, 'glow') || !eligible(frameCtx, 'base')) return false;
    const r = route(frameCtx, Boolean(opts.allowHiddenGraffitiCarrier));
    return Boolean(
      (r.deferLayerScene || r.deferFrameScene) &&
      WebGPUSpiralBezierMorphRenderer.renderGlowAndBase?.(frameCtx, ctx2d, {
        ...opts,
        deferFrameScene: r.deferFrameScene,
        deferLayerScene: r.deferLayerScene,
      }) === true,
    );
  }
  function renderGlow(frameCtx, ctx2d, opts = {}) {
    if (!eligible(frameCtx, 'glow')) return false;
    const r = route(frameCtx, Boolean(opts.allowHiddenGraffitiCarrier));
    return Boolean(
      (r.deferLayerScene || r.deferFrameScene) &&
      WebGPUSpiralBezierMorphRenderer.render?.(frameCtx, ctx2d, {
        ...opts,
        deferFrameScene: r.deferFrameScene,
        deferLayerScene: r.deferLayerScene,
      }) === true,
    );
  }
  function renderBase(frameCtx, ctx2d) {
    if (!eligible(frameCtx, 'base')) return false;
    const r = route(frameCtx, false);
    return Boolean(
      (r.deferLayerScene || r.deferFrameScene) &&
      WebGPUSpiralBezierMorphRenderer.render?.(frameCtx, ctx2d, {
        mode: 'base',
        alphaScale: Math.max(0, Math.min(1, Number(frameCtx?.lineOpacityFactor ?? 1))),
        deferFrameScene: r.deferFrameScene,
        deferLayerScene: r.deferLayerScene,
        layerScenePhase: somataEffectPhase('geometry', 20),
        layerSceneLabel: 'geometry-base',
      }) === true,
    );
  }
  function nativeEligible(frameCtx, opt = {}) {
    const hidden =
      opt.allowHiddenGraffitiCarrier === true &&
      frameCtx?.lineProfileStrokeOnly === true &&
      frameCtx?.lineProfileApplication === 'graffiti';
    return Boolean(
      (frameCtx?.morphFrameActive === true || frameCtx?.spiralEditMorph) &&
      (eligible(frameCtx, 'base') || (hidden && eligible(frameCtx, 'glow'))),
    );
  }
  function diagnostics(frameCtx, role = 'glow', allowHiddenGraffitiCarrier = false) {
    let layerSceneEligible = false;
    try {
      layerSceneEligible = canUseGpuSpiralBezierLayerScene(frameCtx, allowHiddenGraffitiCarrier);
    } catch (error) {
      noteSuppressedError('render/spiral-role-adapter#diagnostics', error);
    }
    return {
      reason: WebGPUSpiralBezierMorphRenderer?.reason?.(frameCtx, role) || null,
      layerSceneEligible,
      spiral: WebGPUSpiralBezierMorphRenderer?.status?.() || null,
      stroke: WebGPUStrokeRenderer?.status?.() || null,
    };
  }
  SomataGeometryRoleService.register(
    'spiral',
    {
      allowStrict: true,
      nativePriority: 300,
      matches,
      eligible,
      route,
      renderGlowBase,
      renderGlow,
      renderBase,
      nativeEligible,
      diagnostics,
      warmup() {
        try {
          WebGPUSpiralBezierMorphRenderer?.warmup?.();
        } catch (error) {
          noteSuppressedError('render/spiral-role-adapter#warmup', error);
        }
      },
      entryWarmup() {
        try {
          WebGPUSpiralBezierMorphRenderer?.warmup?.();
        } catch (error) {
          noteSuppressedError('render/spiral-role-adapter#entryWarmup', error);
        }
      },
    },
    300,
  );
})();
