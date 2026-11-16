import './green-role-adapter.js'; // initialisation order: this module runs after it
import { WebGPUTopologyMorphBaseRenderer } from '../gpu/topology-morph-base-renderer.js';
import { SomataGeometryRoleService } from './geometry-role-service.js';
import { noteSuppressedError } from '../core/suppressed-errors.js';

(function () {
  function eligible(frameCtx, role = 'base') {
    return Boolean(WebGPUTopologyMorphBaseRenderer?.isEligible?.(frameCtx, role) === true);
  }
  function renderGlowBase(frameCtx, ctx2d, opts = {}) {
    if (!eligible(frameCtx, 'glow') || !eligible(frameCtx, 'base')) return false;
    return WebGPUTopologyMorphBaseRenderer.renderGlowAndBase?.(frameCtx, ctx2d, opts) === true;
  }
  function renderGlow(frameCtx, ctx2d, opts = {}) {
    return (
      eligible(frameCtx, 'glow') && WebGPUTopologyMorphBaseRenderer.render?.(frameCtx, ctx2d, opts) === true
    );
  }
  function renderBase(frameCtx, ctx2d) {
    return (
      eligible(frameCtx, 'base') &&
      WebGPUTopologyMorphBaseRenderer.render?.(frameCtx, ctx2d, {
        mode: 'base',
        alphaScale: Math.max(0, Math.min(1, Number(frameCtx?.lineOpacityFactor ?? 1))),
      }) === true
    );
  }
  SomataGeometryRoleService.register(
    'topology',
    {
      nativePriority: 200,
      eligible,
      renderGlowBase,
      renderGlow,
      renderBase,
      nativeEligible(frameCtx) {
        return eligible(frameCtx, 'base');
      },
      warmup() {
        try {
          WebGPUTopologyMorphBaseRenderer?.warmup?.();
        } catch (error) {
          noteSuppressedError('render/topology-role-adapter#warmup', error);
        }
      },
    },
    100,
  );
})();
