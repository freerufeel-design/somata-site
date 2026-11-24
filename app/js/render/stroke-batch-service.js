import './fill-pass.js'; // initialisation order: this module runs after it
import { SomataGeometryPolicy } from './geometry-policy.js';
import { somataFourierActive, state } from '../core/state.js';
import { getLayerGeometryContract } from '../geometry/kernel.js';
import { isSpiralLayer } from '../geometry/spiral/order-params.js';
import { WebGPUStrokeRenderer } from '../gpu/stroke-renderer.js';
import { LampGPURenderer } from '../gpu/lamp-renderer.js';
import { fourierLampPlanEligible, fourierLampSingleRail } from '../gpu/fourier-lamp-carrier.js';
import { getFrameGLStrokeCommands, recordGpuFourierCommands, gpuFourierCorridorStatus } from './stroke-command-cache.js';
import { SomataFrameContourService } from '../geometry/frame-contour.js';
import { SomataFeatureHost } from './feature-host.js';
import { SomataEffectStackOrder } from './pass-registry.js';
import { SomataLayerSceneService } from './layer-scene-service.js';
import { SomataGeometryRoleService } from './geometry-role-service.js';
import { SomataFillPassService } from './fill-pass.js';

function gpuFourierBatchIneligible(frameCtx, specs, contract, sharedAuthority, hiddenCarrier) {
  if (globalThis.__somataGpuFourierEnabled === false) return 'disabled';
  const layer = frameCtx.layer, graph = frameCtx.consumerDemand?.renderGraph || frameCtx.renderGraph;
  if (sharedAuthority || hiddenCarrier || frameCtx.lineProfileStrokeOnly || frameCtx._glStrokeCommandFrameId === frameCtx.frameId) return 'shared-cpu-carrier';
  if (!frameCtx.lineDisplayEnabled || state.tunnel?.active || state.showRoundingGuides) return 'line-policy';
  if (!['static','light-static','blue-prepared','blue-anchor-linear','blue-circle-slide','manual-prepared'].includes(frameCtx.geometryPlan?.kind)) return 'special-geometry-route';
  if (layer.fill === true || layer.spiralFillEnabled === true || contract?.fillRequested || layer.geometryCircles?.enabled || frameCtx.effectLayer?.geometryCircles?.enabled) return 'fill-or-geometry-circles';
  const lamps = graph?.passes.some(p=>p.name==='lamps') && fourierLampPlanEligible(frameCtx,state,LampGPURenderer.isWebGPUReady());
  if (!graph || graph.passes.some(p=>p.name!=='base' && !(lamps && p.name==='lamps')) || (!lamps && graph.needsCpuPath) || graph.needsCanvas || graph.needsApproxArc || graph.needsExactArc || graph.needsFill || graph.needsCpuPackedTopology) return 'additional-contour-consumer';
  if (Object.entries(frameCtx.effectsPlan || {}).some(([name,p])=>p?.error || (p?.enabled === true && !(lamps && name==='lamps')))) return 'effect-enabled';
  if (specs.length !== 1 || specs[0].role !== 'base') return 'stroke-role';
  if (!WebGPUStrokeRenderer.fourierComputeReady()) return 'compute-warming-or-unavailable';
  return '';
}
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
    fourierComputeBatches: 0,
    fourierComputeFallbacks: 0,
    lastFourierComputeDecision: null,
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
    if (state.tunnel?.active === true) {
      if (somataFourierActive(frameCtx.layer)) {
        // Corridor has a separate resident-master selector and counters.
        stats.lastFourierComputeDecision = {frameId:frameCtx.frameId,layerId:frameCtx.layer?.id,reason:'corridor-dispatch'};
      }
      return fail('corridor-owns-base', frameCtx);
    }
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
    if (somataFourierActive(frameCtx.layer)) {
      const gpuSpecs = roleSpecs(frameCtx);
      const reason = gpuFourierBatchIneligible(frameCtx, gpuSpecs, getLayerGeometryContract(frameCtx), sharedAuthority, hiddenGraffitiCarrier);
      stats.lastFourierComputeDecision = { frameId:frameCtx.frameId, layerId:frameCtx.layer?.id, reason };
      if (!reason) {
        const gpuCommands = recordGpuFourierCommands(frameCtx);
        const wantsLamps = frameCtx.effectsPlan?.lamps?.enabled === true;
        const lampRail = wantsLamps ? fourierLampSingleRail(gpuCommands) : null;
        const gpuBatch = gpuCommands && (!wantsLamps || lampRail) && WebGPUStrokeRenderer.renderLayerBatch(gpuCommands, gpuSpecs, {
          uniformKey: `${frameCtx.layerIndex}:${String(frameCtx.layer?.id || 'layer')}`,
          preserveExistingScene: Boolean(SomataLayerSceneService.resident(frameCtx)?.texture),
          ...sceneOptions(frameCtx), gpuFourier:true, fourierLampRail:lampRail,
        });
        if (gpuBatch?.gpuFourier && gpuBatch.roles?.has('base')) {
          frameCtx._webgpuStrokeBatch = gpuBatch;
          stats.batches++; stats.fourierComputeBatches++; stats.lastFailure = null;
          stats.roleSpecs += gpuSpecs.length; stats.lastRoles = gpuSpecs.map(s=>s.role);
          stats.lastFourierComputeDecision.reason = 'resident-compute';
          return gpuBatch;
        }
        stats.lastFourierComputeDecision.reason = 'unsupported-recording-or-encode';
      }
      stats.fourierComputeFallbacks++;
    }
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
      uniformKey: `${frameCtx.layerIndex}:${String(frameCtx.layer?.id || "layer")}`,
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

window.__somataGpuFourierStatus = () => {
  const s=SomataStrokeBatchService.status();
  return {...WebGPUStrokeRenderer.gpuFourierStatus(), corridor:gpuFourierCorridorStatus(), computeBatches:s.fourierComputeBatches, fallbackBatches:s.fourierComputeFallbacks, lastDecision:s.lastFourierComputeDecision};
};
export { SomataStrokeBatchService, gpuFourierBatchIneligible };
