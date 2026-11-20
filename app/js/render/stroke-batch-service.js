import './fill-pass.js'; // initialisation order: this module runs after it
import { SomataGeometryPolicy } from './geometry-policy.js';
import { somataFourierActive, state } from '../core/state.js';
import { getLayerGeometryContract } from '../geometry/kernel.js';
import { isSpiralLayer } from '../geometry/spiral/order-params.js';
import { WebGPUStrokeRenderer } from '../gpu/stroke-renderer.js';
import { getFrameGLStrokeCommands } from './stroke-command-cache.js';
import { SomataFrameContourService } from '../geometry/frame-contour.js';
import { SomataFeatureHost } from './feature-host.js';
import { SomataEffectStackOrder } from './pass-registry.js';
import { SomataLayerSceneService } from './layer-scene-service.js';
import { SomataGeometryRoleService } from './geometry-role-service.js';
import { SomataFillPassService } from './fill-pass.js';

const SomataStrokeBatchService = (() => {
  const stats = {
    prepares: 0,
    batches: 0,
    nativeGeometrySkips: 0,
    sharedCarrierBatches: 0,
    roleSpecs: 0,
    lastRoles: [],
    lastFailure: null,
    fourierGpuBatches: 0,
    fourierNativeCommands: 0,
    fourierIndependentSubpaths: 0,
    lastFourierGpu: null,
  };
  function fail(reason, frameCtx, extra = {}) {
    stats.lastFailure = {
      reason,
      frameId: Number(frameCtx?.frameId) || 0,
      layerId: String(frameCtx?.layer?.id || ''),
      ...extra,
    };
    return null;
  }
  function roleSpecs(frameCtx) {
    const rows =
        SomataFeatureHost?.queryAll?.('strokeBatchSpec', frameCtx, frameCtx?.effectsPlan || {}) || [],
      out = [];
    for (const row of rows) {
      const value = row?.value;
      if (Array.isArray(value))
        for (const spec of value) if (spec && typeof spec === 'object') out.push(spec);
    }
    return out;
  }
  function sceneOptions(frameCtx) {
    const rows =
      SomataFeatureHost?.queryAll?.('strokeBatchScene', frameCtx, frameCtx?.effectsPlan || {}) || [];
    const out = { includeOutline: false, includeCore: false, outlineBehind: false };
    for (const row of rows) {
      const v = row?.value;
      if (!v || typeof v !== 'object') continue;
      out.includeOutline = out.includeOutline || v.includeOutline === true;
      out.includeCore = out.includeCore || v.includeCore === true;
      out.outlineBehind = out.outlineBehind || v.outlineBehind === true;
    }
    return out;
  }
  function prepare(frameCtx) {
    stats.prepares++;
    frameCtx._webgpuStrokeBatch = null;
    frameCtx._webgpuFillPrepared = null;
    frameCtx._nativeFillMeshCandidate = null;
    frameCtx._topologyMorphGpuNative = false;
    const strictSpiralBatch = SomataGeometryPolicy.isStrict(frameCtx);
    const pathFxNeeded = (
      SomataFeatureHost?.queryAll?.('strokeBatchDemand', frameCtx, frameCtx?.effectsPlan || {}) || []
    ).some((r) => r?.value === true);
    if (
      !frameCtx?.prepared ||
      state.showRoundingGuides ||
      frameCtx.geometryPlan?.kind === 'lightning' ||
      (!frameCtx.lineDisplayEnabled && !pathFxNeeded)
    )
      return fail('stroke-batch-policy-skip', frameCtx, {
        prepared: Boolean(frameCtx?.prepared),
        lineVisible: Boolean(frameCtx?.lineDisplayEnabled),
        kind: frameCtx?.geometryPlan?.kind,
      });

    const hiddenGraffitiCarrier =
      frameCtx.lineProfileStrokeOnly === true && frameCtx.lineProfileApplication === 'graffiti';
    const hiddenGraffitiMorphCarrier = frameCtx.morphFrameActive === true && hiddenGraffitiCarrier;

    const sharedRecord = SomataFrameContourService?.current?.(frameCtx) || null;
    const sharedAuthority = Boolean(sharedRecord?.commands?.length);
    frameCtx._sharedFrameContourRequired = sharedAuthority;
    const nativeGeometry = sharedAuthority
      ? null
      : SomataGeometryRoleService.nativeBaseKind(frameCtx, {
          allowHiddenGraffitiCarrier: hiddenGraffitiMorphCarrier,
          warmup: true,
        });
    if (nativeGeometry === 'spiral') {
      frameCtx._spiralBezierMorphGpuNative = true;
      stats.nativeGeometrySkips++;
      return null;
    }
    if (nativeGeometry === 'topology') {
      frameCtx._topologyMorphGpuNative = true;
      stats.nativeGeometrySkips++;
      return null;
    }
    if (nativeGeometry === 'green') {
      stats.nativeGeometrySkips++;
      return null;
    }
    if (state.tunnel?.active === true) return fail('corridor-owns-base', frameCtx);
    WebGPUStrokeRenderer.warmup();
    if (!WebGPUStrokeRenderer.isReady())
      return fail('webgpu-stroke-not-ready', frameCtx, {
        renderer: (() => {
          const st = WebGPUStrokeRenderer.status?.() || {};
          return {
            available: st.available,
            initializing: st.initializing,
            lost: st.lost,
            lastError: st.lastError,
            hubError: st.hub?.lastError,
          };
        })(),
      });
    const commands = sharedAuthority
      ? sharedRecord.commands
      : getFrameGLStrokeCommands(frameCtx, hiddenGraffitiCarrier);
    if (!commands?.length) return fail('no-stroke-commands', frameCtx, { sharedAuthority });
    if (sharedAuthority) stats.sharedCarrierBatches++;
    const specs = roleSpecs(frameCtx);
    stats.roleSpecs += specs.length;
    stats.lastRoles = specs.map((s) => s.role);

    const effectOrderPlan = SomataEffectStackOrder?.plan?.(frameCtx) || null;
    const separateFill = effectOrderPlan?.standaloneFill === true;
    const orderedFill =
      separateFill || frameCtx._fillRenderedBelowWeb === true || frameCtx._suppressLateFillForWeb === true;
    const fill = orderedFill
        ? {
            contract: getLayerGeometryContract(frameCtx),
            prepared: frameCtx._webgpuFillPrepared || null,
            nativeCandidate: Boolean(frameCtx._nativeFillMeshCandidate),
            sceneFillMask: null,
            sceneNativeFill: null,
            fillStyle: getLayerGeometryContract(frameCtx)?.fillStyle || null,
          }
        : SomataFillPassService.prepareBatchAttachment(frameCtx, strictSpiralBatch),
      sceneFlags = sceneOptions(frameCtx);
    const residentScene = SomataLayerSceneService.resident(frameCtx);
    const sceneOpt = {
      uniformKey: String(frameCtx.layer?.id || `layer-${frameCtx.layerIndex}`),
      fillMask: orderedFill ? null : fill?.sceneFillMask || null,
      fillStyle: fill?.fillStyle || null,
      nativeFillMesh: orderedFill ? null : fill?.sceneNativeFill || null,
      nativeFillFrameCtx: !orderedFill && fill?.sceneNativeFill ? frameCtx : null,
      ...sceneFlags,
      preserveExistingScene: Boolean(residentScene?.texture),
    };
    if (!specs.length)
      return fail('no-stroke-role-specifications', frameCtx, { commandCount: commands.length });
    const batch = WebGPUStrokeRenderer.renderLayerBatch(commands, specs, sceneOpt);
    if (batch?.roles?.size >= 1) {
      frameCtx._webgpuStrokeBatch = batch;
      stats.batches++;
      stats.lastFailure = null;
      if (
        somataFourierActive(frameCtx.layer) &&
        typeof isSpiralLayer === 'function' &&
        isSpiralLayer(frameCtx.layer)
      ) {
        const native = commands.filter((c) => c?.__variableWidthSpiral === true);
        const subpaths = native.reduce((total, c) => total + (c.subpaths?.length || 0), 0);
        stats.fourierGpuBatches++;
        stats.fourierNativeCommands += native.length;
        stats.fourierIndependentSubpaths += subpaths;
        stats.lastFourierGpu = {
          frameId: Number(frameCtx.frameId) || 0,
          layerId: String(frameCtx.layer?.id || ''),
          gpu: true,
          nativeCommands: native.length,
          independentSubpaths: subpaths,
          wholeTurn: true,
        };
      }
    } else
      fail('stroke-batch-encode-failed', frameCtx, {
        commandCount: commands.length,
        specs: specs.map((s) => s.role),
        rendererError: String(WebGPUStrokeRenderer.status?.()?.lastError || ''),
      });
    return frameCtx._webgpuStrokeBatch;
  }
  function status() {
    return {
      ...stats,
      lastRoles: stats.lastRoles.slice(),
      contract:
        'Somata 7.8: when FrameContour exists, the visible ordinary Line batch consumes the exact same command carrier; native topology/green bypass is disabled for that frame.',
    };
  }
  return { prepare, status };
})();
window.SomataStrokeBatchService = SomataStrokeBatchService;

export { SomataStrokeBatchService };
