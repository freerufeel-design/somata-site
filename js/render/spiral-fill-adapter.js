import './fill-geometry-adapter.js'; // initialisation order: this module runs after it
import { runtimeState, state } from '../core/state.js';
import {
  fillMaskValidationStats,
  geometryContractStats,
  getLayerGeometryContract,
} from '../geometry/kernel.js';
import { mainCtx } from '../core/render-runtime.js';
import { isSpiralLayer } from '../geometry/spiral/order-params.js';
import { FillGPURenderer } from '../gpu/fill-renderer.js';
import { renderBackendTelemetry } from './backend-telemetry.js';
import { FillMeshPreparer } from './fill-plan.js';
import { SomataEffectStackOrder } from './pass-registry.js';
import { SomataLayerSceneService } from './layer-scene-service.js';
import { SomataGeometryRoleService } from './geometry-role-service.js';
import { SomataFillGeometryAdapter } from './fill-geometry-adapter.js';
import { noteFillRuntime } from './fill-pass.js';
import { noteSuppressedError } from '../core/suppressed-errors.js';

function somataSpiralFillMorphT(frameCtx) {
  if (frameCtx?.spiralEditMorph && Number.isFinite(Number(frameCtx.spiralEditMorph.progress)))
    return Number(frameCtx.spiralEditMorph.progress);
  if (Number.isFinite(Number(frameCtx?.blueMorphProvider?.geometryT)))
    return Number(frameCtx.blueMorphProvider.geometryT);
  if (Number.isFinite(Number(frameCtx?.geometryPlan?.progress)))
    return Number(frameCtx.geometryPlan.progress);
  return Number(runtimeState?.morph?.geometryT) || 0;
}
// Согласованные типы морфинга публикуют спираль как отдельные ветви (`framePaths` со
// `spiralBranchIndex`), а не как кадр удерживаемой GPU-ветви. Из этих ветвей собираются полосы
// заливки: кривые Безье ветви разворачиваются в ломаную, скругления остаются на месте.
const SOMATA_FILL_RAIL_SAMPLES = 14;
function somataSampleRailPoints(path) {
  const segments = path?._bezierSegments;
  if (!Array.isArray(segments) || !segments.length) return path?.points || [];
  const out = [];
  segments.forEach((s, index) => {
    for (let i = index === 0 ? 0 : 1; i <= SOMATA_FILL_RAIL_SAMPLES; i++) {
      const t = i / SOMATA_FILL_RAIL_SAMPLES,
        u = 1 - t;
      out.push({
        x: u * u * u * s.p0.x + 3 * u * u * t * s.c1.x + 3 * u * t * t * s.c2.x + t * t * t * s.p3.x,
        y: u * u * u * s.p0.y + 3 * u * u * t * s.c1.y + 3 * u * t * t * s.c2.y + t * t * t * s.p3.y,
      });
    }
  });
  return out;
}
function somataCoordinatedFillRails(frameCtx) {
  const framePaths = frameCtx?.geometryPlan?.framePaths;
  if (!Array.isArray(framePaths)) return null;
  const rails = [];
  for (const path of framePaths) {
    if (!Number.isFinite(Number(path?.spiralBranchIndex))) continue;
    const points = somataSampleRailPoints(path);
    if (points.length < 2) continue;
    rails.push({ ...path, points, alpha: Number(path?._alpha ?? path?.alpha ?? 1) });
  }
  return rails.length >= 2 ? rails : null;
}
function somataSpiralFillAuxPaths(frameCtx) {
  let paths = null;
  try {
    paths =
      typeof getGpuSpiralBezierMorphAuxPaths === 'function'
        ? getGpuSpiralBezierMorphAuxPaths(frameCtx.layerIndex, somataSpiralFillMorphT(frameCtx), frameCtx)
        : null;
  } catch (_) {
    paths = null;
  }
  return paths?.length ? paths : somataCoordinatedFillRails(frameCtx);
}
function somataSpiralMorphFillMesh(frameCtx) {
  const layer = frameCtx?.layer;
  if (!isSpiralLayer(layer) || layer?.spiralFillEnabled !== true) return null;
  const mode = layer.spiralFillType;

  if (mode === 'mathematical')
    return FillMeshPreparer.prepareSpiralMathematical?.(frameCtx, somataSpiralFillAuxPaths(frameCtx)) || null;
  if (mode === 'interwinding') {
    const rails = somataSpiralFillAuxPaths(frameCtx);
    return (
      FillMeshPreparer.prepareSpiralInterwinding?.(frameCtx, rails) ||
      // Если у кадра нет локальных межвитковых ячеек (например, у спирали порядка 1 витки не
      // перекрываются), заливка остаётся полосами между соседними ветвями, как в 13.2.
      (frameCtx?.geometryPlan?.dynamic === true && Array.isArray(rails) && rails.length >= 2
        ? FillMeshPreparer.prepareSpiralMorphBands?.(frameCtx, rails)
        : null) ||
      null
    );
  }
  if (mode !== 'chopped') return null;
  if (
    (frameCtx?.geometryPlan?.dynamic !== true && !frameCtx?.spiralEditMorph) ||
    layer?.spiralClosed === false
  )
    return null;
  const paths = somataSpiralFillAuxPaths(frameCtx);
  if (!paths?.length) return null;
  return FillMeshPreparer.prepareSpiralMorphBands?.(frameCtx, paths) || null;
}
function somataSpiralCorridorFillMesh(frameCtx) {
  const layer = frameCtx?.layer;
  if (!isSpiralLayer(layer) || layer?.spiralFillEnabled !== true || state.tunnel?.active !== true)
    return null;
  if (layer.spiralFillType === 'mathematical')
    return FillMeshPreparer.prepareSpiralMathematical?.(frameCtx, somataSpiralFillAuxPaths(frameCtx)) || null;
  if (layer.spiralFillType === 'chopped') {
    const retained =
      frameCtx?._spiralBezierMorphGpuNative === true ? somataSpiralMorphFillMesh(frameCtx) : null;

    return (
      retained ||
      FillMeshPreparer.prepareInterwindingCorridor?.(frameCtx, null, true) ||
      FillMeshPreparer.prepareSpiralChopped?.(frameCtx) ||
      null
    );
  }
  if (layer.spiralFillType !== 'interwinding') return null;
  if (frameCtx?.geometryPlan?.dynamic === true) {
    return FillMeshPreparer.prepareSpiralInterwinding?.(frameCtx, somataSpiralFillAuxPaths(frameCtx)) || null;
  }

  return FillMeshPreparer.prepareInterwindingCorridor?.(frameCtx, null) || null;
}
function somataSpiralMissingCorridorPolicy(frameCtx, contract) {
  if (
    frameCtx?.layer?.spiralFillEnabled === true &&
    frameCtx.layer.spiralFillType === 'mathematical' &&
    contract?.spiral === true
  ) {
    const status = window.__somataSpiralMathematicalFillStatus?.()?.last;
    return status?.frameId === Number(frameCtx.frameId) &&
      !['missing-current-line-master', 'missing-current-visible-rail'].includes(status.reason)
      ? { handled: false, required: false, suppressed: true, reason: status.reason || 'no-bounded-faces' }
      : { handled: false, required: true, reason: 'mathematical Spiral Fill requires a current Line master' };
  }
  if (frameCtx?.geometryPlan?.dynamic === true && contract?.spiral === true)
    return {
      handled: false,
      required: false,
      suppressed: true,
      reason: 'dynamic Spiral Corridor has no closed native Fill contour',
    };
  return null;
}
function somataPrepareRetainedSpiralFillScene(frameCtx, { glowRequested = false } = {}) {
  const contract = getLayerGeometryContract(frameCtx);
  if (contract?.fillRequested !== true) return null;
  if (frameCtx?._spiralBezierMorphGpuNative !== true) return null;
  if (SomataGeometryRoleService.canRenderRole(frameCtx, 'base') !== true)
    return { handled: false, required: false, reason: 'retained geometry Base role not active' };
  if (glowRequested && SomataGeometryRoleService.canRenderRole(frameCtx, 'glow') !== true)
    return { handled: false, required: true, reason: 'retained geometry Glow role not active' };
  if (state.tunnel?.active === true) return null;
  if (contract.nativeGpuFillEligible !== true)
    return {
      handled: false,
      required: true,
      reason: 'retained Spiral Fill has no native GPU topology for this frame',
    };
  const mesh =
    frameCtx?.geometryPlan?.dynamic === true || frameCtx?.spiralEditMorph
      ? somataSpiralMorphFillMesh(frameCtx)
      : frameCtx?._nativeFillMeshCandidate ||
        frameCtx?._fillMeshShadow ||
        FillMeshPreparer.prepareFrame?.(frameCtx);
  if (!mesh?.nativeComplete || !(Number(mesh.fanTriangleCount) > 0)) {
    if (frameCtx?.layer?.spiralFillType === 'mathematical') {
      const status = window.__somataSpiralMathematicalFillStatus?.()?.last;
      if (
        status?.frameId === Number(frameCtx.frameId) &&
        !['missing-current-line-master', 'missing-current-visible-rail'].includes(status.reason)
      ) {
        frameCtx._baseFillCommitted = true;
        noteFillRuntime(frameCtx, {
          handled: true,
          stage: 'math-no-bounded-face',
          backend: 'none',
          reason: status.reason || 'no-bounded-faces',
        });
        return { handled: true, required: false, empty: true, reason: status.reason || 'no-bounded-faces' };
      }
      return {
        handled: false,
        required: true,
        reason: 'mathematical Spiral Fill requires a current Line master',
      };
    }
    return { handled: false, required: true, reason: 'native retained Spiral Fill mesh unavailable' };
  }
  try {
    FillGPURenderer.isAvailable?.();
  } catch (error) {
    noteSuppressedError('render/spiral-fill-adapter#somataPrepareRetainedSpiralFillScene', error);
  }
  if (!FillGPURenderer.canEncodeMeshToTexture?.(frameCtx, mesh))
    return { handled: false, required: true, reason: 'native WebGPU Fill pipeline warming/unavailable' };
  const plan = SomataEffectStackOrder?.plan?.(frameCtx) || null;
  const resident = SomataLayerSceneService.resident(frameCtx);
  let rootSeed = !resident?.texture && plan?.fillCanSeedRoot === true;
  let target = resident?.texture
    ? resident
    : rootSeed
      ? SomataLayerSceneService.target(frameCtx, 'retained-native-fill-root')
      : SomataLayerSceneService.ensure(frameCtx, 'retained-native-fill');
  if (rootSeed && !target?.texture) {
    rootSeed = false;
    target = SomataLayerSceneService.ensure(frameCtx, 'retained-native-fill');
  }
  if (!target?.texture)
    return { handled: false, required: true, reason: 'GPU Layer Scene target unavailable' };
  const preserve = Boolean(resident?.texture || !rootSeed);
  const rec = preserve
    ? FillGPURenderer.encodeMeshIsolatedCommandToTexture?.(target.texture, frameCtx, mesh, mainCtx, false)
    : FillGPURenderer.encodeMeshCommandToTexture?.(target.texture, frameCtx, mesh, mainCtx, false);
  if (!rec?.handled)
    return {
      handled: false,
      required: true,
      reason:
        rec?.reason || FillGPURenderer.status?.()?.nativeMesh?.lastError || 'retained Fill encode failed',
    };
  if (rec.commandBuffer) {
    const accepted = rootSeed
      ? SomataLayerSceneService.queueAsRoot(
          frameCtx,
          somataEffectPhase('fill'),
          rec.commandBuffer,
          'retained-native-fill',
        )
      : SomataLayerSceneService.queue(
          frameCtx,
          somataEffectPhase('fill'),
          rec.commandBuffer,
          'retained-native-fill',
        );
    if (!accepted)
      return {
        handled: false,
        required: true,
        reason: resident?.texture
          ? 'retained Fill command could not join resident Layer Scene'
          : 'retained Fill command could not become Layer Scene root',
      };
    SomataLayerSceneService.markDeferred(frameCtx, { mainSceneEmpty: false });
  }
  frameCtx._nativeFillMeshCandidate = mesh;
  frameCtx._baseFillCommitted = true;
  frameCtx._spiralFillGlowScenePrepared = true;
  frameCtx._spiralFillScenePrepared = true;
  fillMaskValidationStats.gpuSuppression++;
  geometryContractStats.gpuFill++;
  geometryContractStats.nativeMeshFill++;
  renderBackendTelemetry.mark(
    'fill',
    'gpu',
    glowRequested ? 'native retained Fill seeded below Glow' : 'native retained Fill seeded below Base',
  );
  noteFillRuntime(frameCtx, {
    handled: true,
    stage: glowRequested ? 'retained-pre-glow-layer-scene' : 'retained-pre-base-layer-scene',
    backend: 'webgpu-native-retained-scene',
    reason: '',
  });
  return {
    handled: true,
    required: true,
    deferred: Boolean(rec.commandBuffer),
    joinedResident: Boolean(resident?.texture),
    triangles: Number(rec.triangles || 0) + Number(rec.windingTriangles || 0),
  };
}
SomataFillGeometryAdapter.register(
  'spiral',
  {
    directMesh(frameCtx) {
      return somataSpiralMorphFillMesh(frameCtx);
    },
    corridorMesh(frameCtx) {
      return somataSpiralCorridorFillMesh(frameCtx);
    },
    missingCorridorPolicy(frameCtx, contract) {
      return somataSpiralMissingCorridorPolicy(frameCtx, contract);
    },
    retainedScene(frameCtx, opt) {
      return somataPrepareRetainedSpiralFillScene(frameCtx, opt);
    },
  },
  100,
);
