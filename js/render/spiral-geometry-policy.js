import './geometry-scene-routing.js'; // initialisation order: this module runs after it
import { SomataGeometryPolicy } from './geometry-policy.js';
import { runtimeState, somataFourierActive } from '../core/state.js';
import { isSpiralLayer } from '../geometry/spiral/order-params.js';
import { currentGpuBezierMorphResource, gpuMorphArcIneligibleReason } from '../gpu/morph-arc-resource.js';
import { gpuMorphWebIneligibleReason } from './web-morph-bridge.js';
import { SOMATA_STRICT_SPIRAL_GPU_PRESENTATION } from './layer-scene-service.js';
import {
  canUseGpuSpiralBezierFrameScene,
  canUseGpuSpiralBezierLayerScene,
  ensureStrictSpiralEffectLayerSceneRoot,
  resolveGpuSpiralBezierSceneRoute,
} from './geometry-scene-routing.js';
import { noteSuppressedError } from '../core/suppressed-errors.js';

(function () {
  const spiralLayer = (layer) =>
    Boolean(layer && typeof isSpiralLayer === 'function' && isSpiralLayer(layer));
  function matches(frameCtx) {
    if (frameCtx?.__somataZeroOrderPrepared === true) return false;
    if (somataFourierActive(frameCtx?.layer)) return false;
    return Boolean(
      spiralLayer(frameCtx?.layer) ||
      spiralLayer(frameCtx?.sourceLayer) ||
      spiralLayer(frameCtx?.geometryPlan?.sourceLayer) ||
      spiralLayer(frameCtx?.geometryPlan?.targetLayer) ||
      spiralLayer(frameCtx?.blueMorphProvider?.sourceLayer) ||
      spiralLayer(frameCtx?.blueMorphProvider?.targetLayer),
    );
  }
  function strict(frameCtx) {
    if (frameCtx?.__somataZeroOrderPrepared === true) return false;
    if (
      typeof SOMATA_STRICT_SPIRAL_GPU_PRESENTATION !== 'undefined' &&
      !SOMATA_STRICT_SPIRAL_GPU_PRESENTATION
    )
      return false;
    if (!frameCtx || somataFourierActive(frameCtx.layer)) return false;
    if (matches(frameCtx)) return true;
    try {
      const rec = currentGpuBezierMorphResource(frameCtx.layerIndex);
      const liveMorphAuthority =
        frameCtx.morphFrameActive === true || frameCtx.geometryPlan?.dynamic === true;
      if (liveMorphAuthority && rec?.specialSpiralBezierRail === true && rec?.gpuOnlySpiralEffects === true)
        return true;
    } catch (error) {
      noteSuppressedError('render/spiral-geometry-policy#strict', error);
    }
    return false;
  }
  function entryIntent(displayLayers) {
    if (
      typeof SOMATA_STRICT_SPIRAL_GPU_PRESENTATION !== 'undefined' &&
      !SOMATA_STRICT_SPIRAL_GPU_PRESENTATION
    )
      return false;
    if (
      Array.isArray(displayLayers) &&
      displayLayers.some(
        (layer) => layer?.visible !== false && spiralLayer(layer) && !somataFourierActive(layer),
      )
    )
      return true;
    const rt = typeof runtimeState !== 'undefined' ? runtimeState?.morph : null;
    if (rt?.active === true) {
      const src = Array.isArray(rt.renderSourceLayers) ? rt.renderSourceLayers : [],
        dst = Array.isArray(rt.renderTargetLayers) ? rt.renderTargetLayers : [],
        n = Math.max(src.length, dst.length);
      for (let i = 0; i < n; i++)
        if ((spiralLayer(src[i]) || spiralLayer(dst[i])) && !somataFourierActive(src[i] || dst[i]))
          return true;
    }
    return false;
  }
  function ineligibleReason(frameCtx, consumer) {
    const kind = String(consumer || '');
    try {
      if (kind === 'web' || kind === 'outline') return gpuMorphWebIneligibleReason(frameCtx, true);
      if (
        kind === 'lightning' ||
        kind === 'sweep' ||
        kind === 'profile' ||
        kind === 'motion' ||
        kind === 'sprite'
      )
        return gpuMorphArcIneligibleReason(frameCtx);
    } catch (error) {
      noteSuppressedError('render/spiral-geometry-policy#ineligibleReason', error);
    }
    return 'exact geometry authority unavailable';
  }
  SomataGeometryPolicy.register(
    'spiral',
    {
      matches,
      strict,
      entryIntent,
      ineligibleReason,
      graphRequiresNativeFill(frameCtx) {
        return matches(frameCtx);
      },
      ensureEffectSceneRoot(frameCtx) {
        return ensureStrictSpiralEffectLayerSceneRoot(frameCtx);
      },
      canUseFrameScene(frameCtx) {
        return canUseGpuSpiralBezierFrameScene(frameCtx);
      },
      canUseLayerScene(frameCtx, allowHiddenGraffitiCarrier = false) {
        return canUseGpuSpiralBezierLayerScene(frameCtx, allowHiddenGraffitiCarrier);
      },
      sceneRoute(frameCtx, allowHiddenGraffitiCarrier = false) {
        return resolveGpuSpiralBezierSceneRoute(frameCtx, allowHiddenGraffitiCarrier);
      },
    },
    100,
  );

  window.__somataLegacyStrictSpiralFrame = (frameCtx) => SomataGeometryPolicy.isStrict(frameCtx);
})();
