import './fill-geometry-adapter.js'; // initialisation order: this module runs after it
import { runtimeState, state, somataWithFourierLayer } from '../core/state.js';
import {
  fillMaskValidationStats,
  geometryContractStats,
  getLayerGeometryContract,
} from '../geometry/kernel.js';
import { mainCtx } from '../core/render-runtime.js';
import { isSpiralLayer } from '../geometry/spiral/order-params.js';
import { getRoundingStrength } from '../core/palette.js';
import { strokeVariableWidthSpiralPath } from './spiral-stroke.js';
import { WebGPUSpiralBezierMorphRenderer } from '../gpu/spiral-bezier-morph-renderer.js';
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
// Sample the same Line constructor, with the same rounding/profile arguments.
// Do not reconstruct a different curve from the skeleton knots for Fill.
function somataVisibleFillRail(path, layer, plan, prepared) {
  if (!path?.points || path.points.length < 2 || Number(path._alpha ?? path.alpha ?? 1) <= 0.001 ||
      Number(path.strokeGrowth ?? 1) <= 0) return null;
  let points = null;
  const recorder = {
    __spiroGLGeometryRecorder: true,
    __spiroNativeVariableWidth: true,
    globalAlpha: 1,
    lineWidth: 1,
    __recordVariableWidthBezierSpiral(cubics) {
      points = somataSampleRailPoints({ _bezierSegments: cubics });
      return true;
    },
    __recordVariableWidthSpiral(pts) {
      points = pts.map(p => ({ x: p.x, y: p.y, widthScale: p.widthScale }));
      return true;
    },
  };
  const round = getRoundingStrength(layer.rounding);
  strokeVariableWidthSpiralPath(
    recorder, path.points,
    (prepared ? path.profileCurveBaked : path.spiralProfileRoundingBaked) ? 0 : round,
    prepared ? (path.primarySkeleton ? path.cornerFlags : []) : (path.cornerFlags || []),
    prepared
      ? !path.profileCurveBaked && (plan.sourceProfileMode === 'spline' || plan.targetProfileMode === 'spline' ||
          (!plan.sourceProfileMode && layer.profileMode === 'spline'))
      : layer.profileMode === 'spline' && path.spiralProfileSplineBaked !== true,
    layer, Number(path.strokeGrowth ?? 1),
  );
  if (!points?.length) return null;
  const delta = path.points[0]?.__spiralDelta;
  if (Number.isFinite(delta)) points[0] = { ...points[0], __spiralDelta: delta };
  return { ...path, points, _bezierSegments: null, closed: false, alpha: Number(path._alpha ?? path.alpha ?? 1) };
}
const spiralFillRailStatus = { last: null };
window.__somataSpiralFillRailStatus = () => ({ last: spiralFillRailStatus.last && { ...spiralFillRailStatus.last } });
function somataSpiralFillAuxPaths(frameCtx) {
  const layer = frameCtx?.layer, plan = frameCtx?.geometryPlan || {};
  if (!layer) return null;
  const fid = Number(frameCtx.frameId) || 0;
  const note = (source, paths) => {
    spiralFillRailStatus.last = { frameId: fid, layerId: layer.id, mode: layer.spiralFillType,
      source, pathCount: paths?.length || 0, kind: plan.kind || 'static' };
    return paths?.length ? paths : null;
  };
  const cached = frameCtx._spiralFillCurrentRails;
  if (cached?.frameId === fid && cached.layer === layer && cached.plan === plan)
    return note(cached.source, cached.paths);
  let paths = null, source = 'missing-current-rail';
  // Only a selected native morph may read its retained GPU pair. A parked pair
  // from another provider/previous Blue phase is not the current Line.
  const dynamic = plan.dynamic === true || !!frameCtx.spiralEditMorph;
  const native = dynamic && frameCtx.__somataZeroOrderPrepared !== true &&
    (frameCtx._spiralBezierMorphGpuNative === true ||
      ((frameCtx.spiralEditMorph || (frameCtx.morphFrameActive && frameCtx.geometryProvider === frameCtx.blueMorphProvider)) &&
        WebGPUSpiralBezierMorphRenderer.isEligible(frameCtx, 'base')));
  if (native) {
    paths = getGpuSpiralBezierMorphAuxPaths(frameCtx.layerIndex, somataSpiralFillMorphT(frameCtx), frameCtx);
    source = paths?.length ? 'retained-current-morph' : 'missing-current-native-rail';
  } else {
    const raw = dynamic ? plan.framePaths : (plan.sourceData || frameCtx.staticDrawData)?.paths;
    if (Array.isArray(raw)) {
      paths = somataWithFourierLayer(layer, () => raw
        .filter(p => p?.spiralBranchIndex != null && Number.isFinite(Number(p.spiralBranchIndex)))
        .map(p => somataVisibleFillRail(p, layer, plan, dynamic)).filter(Boolean));
      source = dynamic ? 'current-prepared-line' : 'current-static-line';
    }
  }
  // Never memoize a failed attempt: native resources can become ready later
  // in the same frame. Cache successful rails only on the frame context.
  if (paths?.length) frameCtx._spiralFillCurrentRails = { frameId: fid, layer, plan, source, paths };
  return note(source, paths);
}
function somataSpiralMorphFillMesh(frameCtx) {
  const layer = frameCtx?.layer;
  if (!isSpiralLayer(layer) || layer?.spiralFillEnabled !== true) return null;
  const mode = layer.spiralFillType;
  const rails = somataSpiralFillAuxPaths(frameCtx);
  if (!rails?.length) return null;
  if (mode === 'mathematical')
    return FillMeshPreparer.prepareSpiralMathematical?.(frameCtx, rails) || null;
  if (!['chopped','interwinding','bandXor'].includes(mode) || layer.spiralClosed === false) return null;
  return FillMeshPreparer.prepareSpiralMorphBands?.(frameCtx, rails) || null;
}
function somataSpiralCorridorFillMesh(frameCtx) {
  const layer = frameCtx?.layer;
  if (!isSpiralLayer(layer) || layer?.spiralFillEnabled !== true || state.tunnel?.active !== true)
    return null;
  const rails = somataSpiralFillAuxPaths(frameCtx);
  if (!rails?.length) return null;
  if (layer.spiralFillType === 'mathematical') return FillMeshPreparer.prepareSpiralMathematical?.(frameCtx, rails, true) || null;
  return FillMeshPreparer.prepareSpiralMaskFill?.(frameCtx,rails,true,false) || null;

}
function somataSpiralMissingCorridorPolicy(frameCtx, contract) {
  if (frameCtx?._spiralRibbonFillEmpty?.frameId === Number(frameCtx.frameId) &&
      frameCtx._spiralRibbonFillEmpty.mode === frameCtx.layer?.spiralFillType)
    return {handled:false,required:false,suppressed:true,reason:'no-ribbon-area'};
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
  const mesh = somataSpiralMorphFillMesh(frameCtx);
  if (!mesh?.nativeComplete || !(Number(mesh.fanTriangleCount) > 0)) {
    if(frameCtx._spiralRibbonFillEmpty?.frameId===Number(frameCtx.frameId) && frameCtx._spiralRibbonFillEmpty.mode===frameCtx.layer?.spiralFillType){
      frameCtx._baseFillCommitted=true;
      return {handled:true,required:false,empty:true,reason:'no-ribbon-area'};
    }
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
