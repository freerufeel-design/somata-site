// WebGPU: штрихи линий (основной рендерер линий и Коридора).
import './final-composite-renderer.js'; // initialisation order: this module runs after it
import { getRoundingStrength } from '../core/palette.js';
import { mainCtx, renderRuntime } from '../core/render-runtime.js';
import { performanceGovernor, requestMainCanvasRender } from '../core/scheduler.js';
import { runtimeState, state } from '../core/state.js';
import { frameGeometryRuntime } from '../geometry/frame-paths.js';
import { GeometryKernel } from '../geometry/kernel.js';
import { mainCanvas } from '../ui/profile-presets.js';
import { spiralSmoothStep01 } from '../geometry/spiral/polyline.js';
import { isSpiralLayer } from '../geometry/spiral/order-params.js';
import { isFiniteGeometryPoint } from '../geometry/spiral/profile-prep.js';
import { WebGPUDeviceHub } from './device-hub.js';
import { FOURIER_GPU_POINTS, warmupGpuFourier, encodeGpuFourier, gpuFourierStatus } from './fourier-compute.js';
import { WebGPUBufferRecycler } from './buffer-recycler.js';
import { GPUColorCache, assertWebGPUShaderModule } from './gpu-utils.js';
import { WebGPUCorridorCopyStore } from './corridor-copy-store.js';
import { FillGPURenderer } from './fill-renderer.js';
import { spiralCorridorMasterGuardStats } from '../render/stroke-command-cache.js';
import { createGeometryGLRecordingContext } from '../render/gl-recording-context.js';
import { noteSuppressedError } from '../core/suppressed-errors.js';

const WebGPUStrokeRenderer = (() => {
  const FLOATS_PER_INSTANCE = 11;

  const BEZIER_SUBDIVISIONS = 24,
    BEZIER_FLOATS_PER_CUBIC = 20;
  let bezierBindGroupLayout = null,
    bezierPipelineMax = null,
    bezierPipelineOver = null,
    bezierUniformPipelineMax = null,
    bezierUniformPipelineOver = null;
  let bezierGeometryCache = new WeakMap(),
    bezierBufferRecords = new Set(),
    bezierBuilds = 0,
    bezierHits = 0,
    bezierUploads = 0,
    bezierCubics = 0,
    bezierGpuSegments = 0,
    bezierCpuSamplesAvoided = 0;

  let bezierBufferGrows = 0,
    bezierBufferReuses = 0,
    bezierCapacityPeak = 0,
    bezierOversizeRejects = 0,
    bezierReleases = 0;
  const canvas = document.createElement('canvas');
  let adapter = null,
    device = null,
    context = null,
    format = null;
  let cornerBuffer = null,
    instanceBuffers = [null, null, null],
    uniformBuffer = null,
    bindGroupLayout = null,
    bindGroup = null;
  let pipelineMax = null,
    pipelineOver = null;
  let attempted = false,
    initializing = false,
    ready = false,
    lost = false,
    lastError = '',
    lastInitError = '',
    retryCount = 0,
    hubGeneration = 0,
    optionalInitErrors = [];
  let width = 0,
    height = 0,
    capacity = 0,
    data = null,
    lastMode = -1,
    lastSubmit = 0;
  let variableWidthPackedSegments = 0,
    variableWidthPackedCommands = 0;
  let adaptivePackedCommands = 0,
    adaptiveCanonicalSegments = 0,
    adaptiveGpuSegments = 0;

  let sharedJoinBindGroupLayout = null,
    sharedJoinBodyPipeline = null,
    sharedJoinPointPipeline = null;
  const SHARED_JOIN_STATIC_LIMIT_BASE = 48,
    SHARED_JOIN_DYNAMIC_RING = 12,
    sharedJoinStaticBuffers = new Map(),
    sharedJoinEligibilityCache = new WeakMap(),
    sharedJoinDynamicFrameCache = new WeakMap();
  const sharedJoinStaticLimit = () =>
    SHARED_JOIN_STATIC_LIMIT_BASE * Math.max(1, performanceGovernor.residencyScale?.() || 1);
  let sharedJoinDynamicSlots = [],
    sharedJoinDynamicCursor = 0;
  let sharedJoinEligibilityChecks = 0,
    sharedJoinEligibilityHits = 0,
    sharedJoinEligibilityRejects = 0,
    sharedJoinMorphBypasses = 0,
    sharedJoinDynamicBypasses = 0,
    sharedJoinStaticHits = 0,
    sharedJoinStaticBuilds = 0,
    sharedJoinStaticEvictions = 0,
    sharedJoinDynamicBuilds = 0,
    sharedJoinDynamicFrameHits = 0,
    sharedJoinDynamicSlotGrows = 0,
    sharedJoinDraws = 0,
    sharedJoinBodyInstances = 0,
    sharedJoinPointInstances = 0,
    sharedJoinUploadBytes = 0,
    sharedJoinFallbacks = 0;
  const uniformData = new Float32Array(16),
    strokeUniformLast = new Float32Array(12);
  let strokeUniformHasLast = false,
    strokeUniformUploads = 0,
    strokeUniformUploadSkips = 0,
    strokeUniformUploadBytes = 0;

  const LAYER_BATCH_ROLES = ['glow', 'base', 'outline', 'core'];
  const layerBatchSurfaces = Object.fromEntries(
    LAYER_BATCH_ROLES.map((role) => [
      role,
      {
        role,
        texture: null,
        view: null,
        underlayBindGroup: null,
        underlayBundle: null,
        underlayBundleList: [],
        fallbackCanvas: null,
        fallbackContext: null,
        fallbackWidth: 0,
        fallbackHeight: 0,
        uniformBuffer: null,
        bindGroup: null,
        data: new Float32Array(12),
        lastData: new Float32Array(12),
        hasLastData: false,
      },
    ]),
  );

  const layerSceneFallbackSurface = { canvas: null, context: null, width: 0, height: 0 };
  let layerSceneTexture = null,
    layerSceneView = null,
    layerScenePipeline = null,
    layerSceneSampler = null,
    layerSceneUniformBuffer = null,
    layerSceneMaskTexture = null,
    layerSceneMaskView = null,
    layerSceneNativeFillTexture = null,
    layerSceneNativeFillView = null,
    layerSceneBindGroupLayout = null;
  const layerSceneUniform = new Float32Array(12),
    layerSceneUniformLast = new Float32Array(12);
  let layerSceneUniformHasLast = false,
    layerSceneBindGroupCache = new Map();

  let layerSceneUniformRecords = new Map(),
    layerSceneUniformSerial = 0;
  let layerSceneUniformRecordBuilds = 0,
    layerSceneUniformRecordHits = 0,
    layerSceneUniformRecordUploads = 0,
    layerSceneUniformRecordUploadSkips = 0;
  let layerSceneCompositeBundleBuilds = 0,
    layerSceneCompositeBundleHits = 0,
    layerSceneCompositeBundleExecutes = 0,
    layerSceneCompositeBundleFallbacks = 0;
  let layerSceneWidth = 0,
    layerSceneHeight = 0,
    layerSceneFrames = 0,
    layerSceneComposites = 0,
    layerSceneFillUploads = 0,
    layerSceneBindGroups = 0,
    layerSceneBindGroupHits = 0,
    layerSceneTextureViewBuilds = 0,
    layerSceneOutlineFrames = 0;
  let layerBatchUniformUploads = 0,
    layerBatchUniformUploadSkips = 0,
    layerBatchUniformUploadBytes = 0,
    layerSceneUniformUploads = 0,
    layerSceneUniformUploadSkips = 0;

  let layerSceneResidentFillMaskCache = new WeakMap(),
    layerSceneResidentFillMaskRecords = new Set(),
    layerSceneResidentFillMaskSerial = 0;
  let layerSceneResidentFillMaskBuilds = 0,
    layerSceneResidentFillMaskHits = 0,
    layerSceneResidentFillMaskUploads = 0,
    layerSceneResidentFillMaskUploadSkips = 0,
    layerSceneResidentFillMaskEvictions = 0,
    layerSceneResidentFillMaskBytes = 0;
  function layerSceneResidentFillMaskLimit() {
    const pixels = Math.max(
      1,
      (layerSceneWidth || mainCanvas.width || 1) * (layerSceneHeight || mainCanvas.height || 1),
    );
    const budget = 96 * 1024 * 1024 * Math.max(1, performanceGovernor.residencyScale?.() || 1);
    return Math.max(3, Math.min(48, Math.floor(budget / Math.max(4, pixels * 4))));
  }
  function clearLayerSceneResidentFillMasks() {
    for (const rec of layerSceneResidentFillMaskRecords)
      try {
        rec?.texture?.destroy?.();
      } catch (error) {
        noteSuppressedError('gpu/stroke-renderer#clearLayerSceneResidentFillMasks', error);
      }
    layerSceneResidentFillMaskRecords.clear();
    layerSceneResidentFillMaskCache = new WeakMap();
    layerSceneResidentFillMaskBytes = 0;
  }
  function pruneLayerSceneResidentFillMasks(keep = null) {
    const limit = layerSceneResidentFillMaskLimit();
    while (layerSceneResidentFillMaskRecords.size > limit) {
      let victim = null;
      for (const rec of layerSceneResidentFillMaskRecords) {
        if (rec === keep) continue;
        if (!victim || Number(rec.lastUsedFrame || 0) < Number(victim.lastUsedFrame || 0)) victim = rec;
      }
      if (!victim) break;
      try {
        victim.texture?.destroy?.();
      } catch (error) {
        noteSuppressedError('gpu/stroke-renderer#pruneLayerSceneResidentFillMasks', error);
      }
      if (victim.mask) layerSceneResidentFillMaskCache.delete(victim.mask);
      layerSceneResidentFillMaskRecords.delete(victim);
      layerSceneResidentFillMaskBytes = Math.max(
        0,
        layerSceneResidentFillMaskBytes - Number(victim.bytes || 0),
      );
      layerSceneResidentFillMaskEvictions++;
    }
  }
  function prepareLayerSceneFillMaskResource(mask) {
    if (!mask) return null;
    const isStatic = mask.__spiroStaticFillMask === true,
      frameId = Math.max(1, Number(renderRuntime?.frameId) || 1);
    if (!isStatic) {
      device.queue.copyExternalImageToTexture({ source: mask }, { texture: layerSceneMaskTexture }, [
        layerSceneWidth,
        layerSceneHeight,
      ]);
      layerSceneFillUploads++;
      return { view: layerSceneMaskView, bindGroups: layerSceneBindGroupCache, resident: false };
    }
    const revision = Math.max(0, Number(mask.__spiroFillMaskRevision) || 0),
      w = layerSceneWidth | 0,
      h = layerSceneHeight | 0;
    let rec = layerSceneResidentFillMaskCache.get(mask);
    if (!rec || rec.generation !== hubGeneration || rec.width !== w || rec.height !== h || !rec.texture) {
      if (rec) {
        try {
          rec.texture?.destroy?.();
        } catch (error) {
          noteSuppressedError('gpu/stroke-renderer#prepareLayerSceneFillMaskResource', error);
        }
        layerSceneResidentFillMaskRecords.delete(rec);
        layerSceneResidentFillMaskBytes = Math.max(
          0,
          layerSceneResidentFillMaskBytes - Number(rec.bytes || 0),
        );
      }
      const texture = device.createTexture({
        label: `SpiroStar resident static Fill mask ${++layerSceneResidentFillMaskSerial}`,
        size: [w, h, 1],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
      });
      rec = {
        mask,
        texture,
        view: texture.createView(),
        bindGroups: new Map(),
        revision: -1,
        width: w,
        height: h,
        generation: hubGeneration,
        lastUsedFrame: frameId,
        bytes: w * h * 4,
      };
      layerSceneResidentFillMaskCache.set(mask, rec);
      layerSceneResidentFillMaskRecords.add(rec);
      layerSceneResidentFillMaskBytes += rec.bytes;
      layerSceneResidentFillMaskBuilds++;
    } else layerSceneResidentFillMaskHits++;
    rec.lastUsedFrame = frameId;
    if (rec.revision !== revision) {
      device.queue.copyExternalImageToTexture({ source: mask }, { texture: rec.texture }, [w, h]);
      rec.revision = revision;
      layerSceneFillUploads++;
      layerSceneResidentFillMaskUploads++;
    } else layerSceneResidentFillMaskUploadSkips++;
    pruneLayerSceneResidentFillMasks(rec);
    return { view: rec.view, bindGroups: rec.bindGroups, resident: true, record: rec };
  }

  let circleScratchTexture = null,
    circleScratchView = null,
    circleCompositeBindGroup = null,
    circleCompositePipeline = null,
    circleCompositeLayout = null,
    circleSampler = null;

  let circleCompositeBundle = null,
    circleCompositeBundleList = [],
    frameSceneCompositeBundle = null,
    frameSceneCompositeBundleList = [];
  let renderBundleBuilds = 0,
    renderBundleExecutes = 0,
    underlayBundleBuilds = 0,
    underlayBundleExecutes = 0;
  function buildFullscreenBundle(pipelineRef, bindGroupRef, label) {
    if (!device || !pipelineRef || !bindGroupRef || typeof device.createRenderBundleEncoder !== 'function')
      return null;
    try {
      const rbe = device.createRenderBundleEncoder({ label, colorFormats: [format] });
      rbe.setPipeline(pipelineRef);
      rbe.setBindGroup(0, bindGroupRef);
      rbe.draw(3);
      renderBundleBuilds++;
      return rbe.finish();
    } catch (_) {
      return null;
    }
  }
  let circleCapacity = 0,
    circleData = null,
    circleCursor = 0,
    circleInstanceBuffers = [],
    circleUniformBuffers = [],
    circleUniformBindGroups = [],
    circleUniformLastData = [],
    circleUniformHasLast = [],
    circleUniformCursor = 0;
  const circleUniformData = new Float32Array(12);
  const desiredCircleRingCount = () => {
    const l = performanceGovernor.level();
    return l >= 3 ? 64 : l === 2 ? 48 : l === 1 ? 32 : 24;
  };
  let circleScratchFrames = 0,
    circleScratchDraws = 0,
    circleScratchSegments = 0,
    circleScratchUploadBytes = 0,
    circleScratchFallbacks = 0,
    circleResidentBufferReuses = 0,
    circleFallbackPacks = 0,
    circleUniformUploads = 0,
    circleUniformUploadSkips = 0,
    circleBindGroupBuilds = 0,
    circleTargetViewReuses = 0;
  function ensureCircleUniformRingCount(count) {
    count = Math.max(1, Math.floor(Number(count) || 1));
    while (circleUniformBuffers.length < count) {
      const i = circleUniformBuffers.length,
        ub = device.createBuffer({
          size: 48,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
          label: `SpiroStar Geometry Circles uniforms ${i}`,
        });
      circleUniformBuffers.push(ub);
      circleUniformBindGroups.push(
        device.createBindGroup({
          layout: bindGroupLayout,
          entries: [{ binding: 0, resource: { buffer: ub } }],
        }),
      );
      circleUniformLastData.push(new Float32Array(12));
      circleUniformHasLast.push(false);
      circleBindGroupBuilds++;
    }
  }

  let frameUnderlayTexture = null,
    frameUnderlayView = null,
    frameUnderlayPipelineBehind = null,
    frameUnderlayFrameId = 0,
    frameUnderlayActive = false,
    frameUnderlayDisabledFrameId = 0;
  let frameUnderlayClearCommand = null,
    frameUnderlayPendingCommands = [],
    frameUnderlayPendingFrameId = 0;
  let frameUnderlayClears = 0,
    frameUnderlayComposites = 0,
    frameUnderlaySubmissions = 0,
    frameUnderlayFallbacks = 0,
    frameUnderlayPresented = 0;
  let frameUnderlayQueuedCommands = 0,
    frameUnderlayMergedSubmissions = 0,
    frameUnderlayEmbeddedCommands = 0,
    frameUnderlayDeferredBatches = 0;

  let frameSceneTexture = null,
    frameSceneView = null,
    frameSceneLayerBindGroup = null,
    frameSceneFrameId = 0,
    frameSceneActive = false,
    frameSceneDisabledFrameId = 0;
  let frameSceneClearCommand = null,
    frameScenePendingCommands = [],
    frameScenePendingFrameId = 0,
    frameSceneSealedLayers = 0;
  let frameSceneClears = 0,
    frameSceneSeals = 0,
    frameSceneQueuedCommands = 0,
    frameScenePresented = 0,
    frameSceneFallbacks = 0,
    frameSceneCanvasUploadAvoided = 0,
    frameSceneDirectExternalLayers = 0,
    frameSceneDirectExternalCommands = 0;
  let deferredLayerScene = null,
    layerSceneDeferredFrames = 0,
    layerSceneDeferredPresented = 0,
    layerSceneDeferredFallbacks = 0,
    externalLayerSceneFrames = 0,
    externalLayerSceneSubmissions = 0;
  let layerBatchWidth = 0,
    layerBatchHeight = 0,
    layerBatchSubmissions = 0,
    layerBatchFrames = 0,
    layerBatchDraws = 0,
    layerBatchComposites = 0,
    layerBatchFailures = 0,
    layerBatchPackedReuse = 0;

  const STATIC_BUFFER_LIMIT_BASE = 48;
  const staticBufferLimit = () =>
    STATIC_BUFFER_LIMIT_BASE * Math.max(1, performanceGovernor.residencyScale?.() || 1);
  const staticGeometryBuffers = new Map();
  let staticBufferHits = 0,
    staticBufferBuilds = 0,
    staticBufferEvictions = 0,
    staticUploadBytes = 0,
    dynamicUploadBytes = 0;

  const FRAME_RESIDENT_DYNAMIC_RING = 16;
  let frameResidentDynamicSlots = [],
    frameResidentDynamicCursor = 0,
    frameResidentDynamicCache = new WeakMap();
  let frameResidentDynamicBuilds = 0,
    frameResidentDynamicHits = 0,
    frameResidentDynamicEffectHits = 0,
    frameResidentDynamicBatchHits = 0,
    frameResidentDynamicSlotGrows = 0,
    frameResidentDynamicUploadBytes = 0,
    frameResidentDynamicSegments = 0,
    frameResidentDynamicTopologyChanges = 0;
  const frameResidentDynamicTopologyByLayer = new WeakMap();

  const INDEXED_MORPH_RING = 16;
  let indexedMorphBindGroupLayout = null,
    indexedMorphPipelineMax = null,
    indexedMorphPipelineOver = null,
    indexedMorphLinearBindGroupLayout = null,
    indexedMorphLinearPipelineMax = null,
    indexedMorphLinearPipelineOver = null,
    indexedMorphCorridorBindGroupLayout = null,
    indexedMorphCorridorPipelineMax = null,
    indexedMorphCorridorPipelineOver = null;
  let indexedMorphTopologyCache = new WeakMap(),
    indexedMorphTopologyRecords = new Set(),
    indexedMorphRetiredTopologies = [],
    indexedMorphSlots = [],
    indexedMorphCursor = 0,
    indexedMorphFrameCache = new WeakMap();
  const indexedMorphResidencySupported = typeof WeakRef === 'function';
  let indexedMorphResidentCache = new WeakMap(),
    indexedMorphResidentRecords = new Set();
  let indexedMorphTopologyBuilds = 0,
    indexedMorphTopologyHits = 0,
    indexedMorphTopologyChanges = 0,
    indexedMorphFrameBuilds = 0,
    indexedMorphFrameHits = 0,
    indexedMorphSlotGrows = 0,
    indexedMorphDraws = 0,
    indexedMorphSegments = 0,
    indexedMorphPoints = 0,
    indexedMorphUploadBytes = 0,
    indexedMorphTopologyUploadBytes = 0,
    indexedMorphAlphaUploadBytes = 0,
    indexedMorphAlphaUploadSkips = 0,
    indexedMorphBindGroupBuilds = 0,
    indexedMorphBindGroupHits = 0,
    indexedMorphFallbacks = 0,
    indexedMorphLegacyEquivalentBytes = 0;
  let indexedMorphResidentPins = 0,
    indexedMorphResidentHits = 0,
    indexedMorphResidentReclaims = 0,
    indexedMorphCpuSegmentGeometryChecksAvoided = 0;
  let indexedMorphLinearBuilds = 0,
    indexedMorphLinearHits = 0,
    indexedMorphLinearFrames = 0,
    indexedMorphLinearFallbacks = 0,
    indexedMorphLinearEndpointUploadBytes = 0,
    indexedMorphLinearPointUploadBytesAvoided = 0,
    indexedMorphLinearBindGroupBuilds = 0,
    indexedMorphLinearBindGroupHits = 0,
    indexedMorphLinearTransformUploads = 0,
    indexedMorphLinearTransformUploadSkips = 0,
    indexedMorphLinearTransformUploadBytes = 0,
    indexedMorphLinearAudioTransformFrames = 0,
    indexedMorphLinearBundleBuilds = 0,
    indexedMorphLinearBundleHits = 0,
    indexedMorphLinearBundleExecutes = 0,
    indexedMorphLinearBundleFallbacks = 0;
  let indexedMorphPointUploadSkips = 0,
    indexedMorphCommandUploadSkips = 0,
    indexedMorphAlphaContentUploadSkips = 0,
    indexedMorphUploadBytesAvoided = 0;
  let indexedMorphCorridorDraws = 0,
    indexedMorphCorridorCopies = 0,
    indexedMorphCorridorSegments = 0,
    indexedMorphCorridorBindGroups = 0,
    indexedMorphCorridorFallbacks = 0,
    indexedMorphCorridorAvoidedSegmentBytes = 0;

  const CORRIDOR_SEGMENT_LIMIT_BASE = 48;
  const corridorSegmentLimit = () =>
    CORRIDOR_SEGMENT_LIMIT_BASE * Math.max(1, performanceGovernor.residencyScale?.() || 1);
  const corridorSegmentBuffers = new Map();

  let corridorDynamicSegmentBuffers = [null, null, null],
    corridorDynamicSegmentCapacity = 0,
    corridorDynamicSegmentData = null,
    corridorDynamicSegmentCursor = 0,
    corridorDynamicSegmentGeneration = 0,
    corridorDynamicSegmentCache = new WeakMap();
  let corridorDynamicSegmentUploadBytes = 0,
    corridorDynamicSegmentBuilds = 0,
    corridorDynamicSegmentReuseHits = 0;
  let corridorBindGroupLayout = null,
    corridorPipelineMax = null,
    corridorPipelineOver = null,
    corridorUniformBuffer = null;

  let bezierCorridorBindGroupLayout = null,
    bezierCorridorPipelineMax = null,
    bezierCorridorPipelineOver = null;
  let bezierCorridorDraws = 0,
    bezierCorridorCopies = 0,
    bezierCorridorGpuSegments = 0,
    bezierCorridorBindGroupBuilds = 0;

  let corridorDeferredUniformBuffers = [],
    corridorDeferredUniformCursor = 0;
  let corridorCopyBuffers = [null, null, null],
    corridorCopyCapacity = 0,
    corridorCopyData = null,
    corridorSubmit = 0,
    corridorCopyGeneration = 0;
  const strokeRuntimeErrorKeys = new Set();
  function reportStrokeRuntimeErrorOnce(scope, err) {
    const msg = String(err?.message || err || 'unknown error'),
      key = `${scope}|${msg}`;
    if (strokeRuntimeErrorKeys.has(key)) return;
    strokeRuntimeErrorKeys.add(key);
    console.error(`[SpiroStar WebGPU Stroke] ${scope}: ${msg}`, err);
  }
  const corridorUniformU32 = new Uint32Array(12),
    corridorUniformF32 = new Float32Array(corridorUniformU32.buffer),
    corridorUniformLastU32 = new Uint32Array(12);
  let corridorUniformHasLast = false,
    corridorUniformUploads = 0,
    corridorUniformUploadSkips = 0,
    corridorUniformUploadBytes = 0;
  let corridorSegmentHits = 0,
    corridorSegmentBuilds = 0,
    corridorSegmentEvictions = 0,
    corridorSegmentUploadBytes = 0,
    corridorCopyUploadBytes = 0,
    corridorDraws = 0,
    corridorEffectDraws = 0,
    corridorBindGroupBuilds = 0,
    corridorVariableWidthSegments = 0,
    staticEffectReuseHits = 0,
    corridorSharedBasisUses = 0;
  let corridorSpiralSeamCopies = 0,
    corridorSpiralSeamSegments = 0,
    corridorSpiralMasterBuilds = 0,
    corridorSpiralMasterHits = 0;

  const commandSegmentMetaCache = new WeakMap();
  let canonicalMetaBuilds = 0,
    canonicalMetaHits = 0;
  const corridorFrameCopyCache = new WeakMap();
  let corridorCopyReuseHits = 0;

  const corridorResidentCopyRecords = new Map(),
    corridorResidentOwnerIds = new WeakMap();
  let corridorResidentOwnerSeq = 1,
    corridorResidentBuilds = 0,
    corridorResidentHits = 0,
    corridorResidentUploads = 0,
    corridorResidentUploadBytes = 0,
    corridorResidentUploadSkips = 0,
    corridorResidentUploadBytesAvoided = 0,
    corridorResidentGrows = 0,
    corridorResidentEvictions = 0;
  const corridorResidentCopyLimit = () => 64 * Math.max(1, performanceGovernor.residencyScale?.() || 1);
  function corridorResidentOwnerId(owner) {
    let id = corridorResidentOwnerIds.get(owner);
    if (!id) {
      id = corridorResidentOwnerSeq++;
      corridorResidentOwnerIds.set(owner, id);
    }
    return id;
  }
  function clearCorridorResidentCopies() {
    for (const rec of corridorResidentCopyRecords.values())
      try {
        rec?.buffer?.destroy?.();
      } catch (error) {
        noteSuppressedError('gpu/stroke-renderer#clearCorridorResidentCopies', error);
      }
    corridorResidentCopyRecords.clear();
  }
  function touchCorridorResidentCopyRecord(key, rec) {
    corridorResidentCopyRecords.delete(key);
    corridorResidentCopyRecords.set(key, rec);
    return rec;
  }
  function acquireCorridorResidentCopyRecord(owner, variant, count, frameId) {
    if (!owner || typeof owner !== 'object' || !(count > 0)) return null;
    const key = `${corridorResidentOwnerId(owner)}|${String(variant || 'default')}`;
    let rec = corridorResidentCopyRecords.get(key);
    if (!rec) {
      rec = {
        key,
        buffer: null,
        snapshot: null,
        capacity: 0,
        k: 0,
        multiColor: false,
        spiralSeamAlpha: false,
        lastFrameId: -1,
      };
      corridorResidentBuilds++;
    }
    if (count > rec.capacity || !rec.buffer || !rec.snapshot) {
      const next = performanceGovernor.capacityFor(count, rec.capacity, 64, 1.6),
        oldBuffer = rec.buffer;
      rec.capacity = next;
      rec.buffer = WebGPUBufferRecycler.acquire(
        device,
        hubGeneration,
        Math.max(64, next * 16 * 4),
        GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        `SpiroStar resident Corridor copies ${key}`,
      );
      if (oldBuffer) WebGPUBufferRecycler.recycle(device, hubGeneration, oldBuffer);
      rec.snapshot = new Float32Array(next * 16);
      rec.k = 0;
      corridorResidentGrows++;
    }
    rec.lastFrameId = Number(frameId) || 0;
    touchCorridorResidentCopyRecord(key, rec);
    const limit = corridorResidentCopyLimit();
    while (corridorResidentCopyRecords.size > limit) {
      const first = corridorResidentCopyRecords.entries().next().value;
      if (!first) break;
      const [oldKey, old] = first;
      if (old === rec && corridorResidentCopyRecords.size === 1) break;
      try {
        old?.buffer?.destroy?.();
      } catch (error) {
        noteSuppressedError('gpu/stroke-renderer#acquireCorridorResidentCopyRecord', error);
      }
      corridorResidentCopyRecords.delete(oldKey);
      corridorResidentEvictions++;
    }
    return rec;
  }
  function uploadCorridorResidentPayload(rec, src, k, multiColor, seamAlpha) {
    if (!rec || !rec.buffer || !rec.snapshot || !k) return false;
    const n = k * 16;
    let same = rec.k === k && rec.multiColor === multiColor && rec.spiralSeamAlpha === seamAlpha;
    if (same) {
      for (let i = 0; i < n; i++) {
        if (rec.snapshot[i] !== src[i]) {
          same = false;
          break;
        }
      }
    }
    const bytes = n * 4;
    if (same) {
      corridorResidentHits++;
      corridorResidentUploadSkips++;
      corridorResidentUploadBytesAvoided += bytes;
      return false;
    }
    rec.snapshot.set(src.subarray(0, n), 0);
    rec.k = k;
    rec.multiColor = multiColor;
    rec.spiralSeamAlpha = seamAlpha;
    device.queue.writeBuffer(rec.buffer, 0, src.buffer, src.byteOffset, bytes);
    corridorResidentUploads++;
    corridorResidentUploadBytes += bytes;
    return true;
  }

  const SAIYAN_PLASMA_WGSL = `
fn saiyanCoverage(pixel:vec2<f32>, d:f32, halfWidth:f32, radius:f32, packed:f32)->f32{
    let phase=clamp((fract(packed+0.00001)-0.01)/0.98,0.0,1.0);
    let span=clamp(exp2((floor(packed+0.00001)-96.0)/16.0),0.015625,64.0);
    let theta=phase*6.28318530718;
    
    let tongues=clamp(0.57+min(span,6.0)*(0.19*sin(pixel.x*0.082+pixel.y*0.045+theta)
                    +0.13*sin(pixel.x*0.163-pixel.y*0.029+theta*2.0)),0.18,0.98);
    let outer=max(0.0,d-halfWidth);
    let q=outer/(max(0.01,radius)*max(0.20,tongues));
    let flame=exp(-2.65*q*q)*(1.0-smoothstep(0.83,1.09,q));
    let hot=1.0-smoothstep(0.0,max(1.0,radius*0.14),outer);
    return clamp(max(hot,flame*(0.74+0.26*sin(pixel.x*0.11+pixel.y*0.054+theta*3.0))),0.0,1.0);
}


fn dripCoverage(pixel:vec2<f32>,d:f32,halfWidth:f32,radius:f32,packed:f32)->f32{
    let phase=clamp((fract(packed+0.00001)-0.01)/0.98,0.0,1.0);
    let span=clamp(exp2((floor(packed+0.00001)-96.0)/16.0),0.015625,64.0);
    let outer=max(0.0,d-halfWidth);
    let r=max(1.0,radius);
    let track=outer/r;
    let center=track-0.48;let channel=exp(-42.0*center*center);
    let flow=0.55+0.45*sin(pixel.y*0.13-phase*6.28318530718*3.0+sin(pixel.x*0.035)*1.4);
    let rivulets=0.65+0.35*sin(pixel.x*0.19+pixel.y*0.017);
    let moving=pow(max(0.0,flow),max(0.3,2.0/max(0.10,span)));
    let body=exp(-3.0*track*track)*(1.0-smoothstep(0.84,1.05,track));
    return clamp(channel*mix(0.25,1.0,moving)*rivulets+body*0.30,0.0,1.0);
}


fn mountainCoverage(pixel:vec2<f32>,d:f32,halfWidth:f32,radius:f32,packed:f32)->f32{
    let phase=clamp((fract(packed+0.00001)-0.01)/0.98,0.0,1.0);
    let theta=phase*6.28318530718;
    let growth=0.55+0.45*(0.5-0.5*cos(theta));
    let ridge=pow(max(0.0,0.5+0.5*cos(pixel.x*0.023+0.13*sin(pixel.x*0.011))),4.0);
    
    
    
    let upperFacing=1.0-smoothstep(-0.75,0.25,dpdy(d));
    let height=max(1.0,radius*(0.035+0.965*growth*ridge*upperFacing));
    let q=max(0.0,d-halfWidth)/height;
    let crest=(1.0-smoothstep(0.75,1.04,q))*exp(-1.35*q*q);
    let whiteCore=1.0-smoothstep(0.0,max(1.0,radius*0.075),max(0.0,d-halfWidth));
    return clamp(max(crest,whiteCore),0.0,1.0);
}
fn auraCoverage(pixel:vec2<f32>,d:f32,halfWidth:f32,radius:f32,packed:f32,kind:u32)->f32{
    if(kind==5u){return saiyanCoverage(pixel,d,halfWidth,radius,packed);}
    if(kind==6u){return dripCoverage(pixel,d,halfWidth,radius,packed);}
    return mountainCoverage(pixel,d,halfWidth,radius,packed);
}
fn auraFloatKind(mode:f32)->u32{
    if(mode>2.05&&mode<2.45){return 5u;}
    if(mode>4.05&&mode<4.45){return 6u;}
    if(mode>4.45&&mode<4.85){return 7u;}
    return 0u;
}
fn auraFloatPacked(mode:f32,kind:u32)->f32{
    let base=select(select(4.5,4.1,kind==6u),2.1,kind==5u);
    return clamp((mode-base)*(256.0/0.3),0.0,255.999);
}
`;
  const BEZIER_WGSL = `
${SAIYAN_PLASMA_WGSL}
struct Uniforms {
    viewport: vec2<f32>,
    mode: f32,
    effectUniformEnabled: f32,
    effectParam: f32,
    baseLineWidth: f32,
    alphaScale: f32,
    overrideEnabled: f32,
    overrideColor: vec4<f32>,
};
@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage,read> cubicData: array<vec4<f32>>;
struct VSIn { @location(0) corner: vec2<f32>, };
struct VSOut {
    @builtin(position) position: vec4<f32>,
    @location(0) local: vec2<f32>,
    @location(1) @interpolate(flat) segLen: f32,
    @location(2) @interpolate(flat) halfWidthStart: f32, 
    @location(3) @interpolate(flat) halfWidthEnd: f32, 
    @location(4) @interpolate(flat) color: vec4<f32>,
    @location(5) @interpolate(flat) baseHalfWidth: f32,
};
fn cubic(p0:vec2<f32>,c1:vec2<f32>,c2:vec2<f32>,p3:vec2<f32>,t:f32)->vec2<f32>{
    let q=1.0-t;return q*q*q*p0+3.0*q*q*t*c1+3.0*q*t*t*c2+t*t*t*p3;
}
fn effectRadius(hw:f32,baseHw:f32)->f32{
    if(u.effectUniformEnabled<0.5){return 0.0;}
    if((u.mode>0.5&&u.mode<1.5)||(u.mode>2.5&&u.mode<3.5)){return max(0.0,u.effectParam*(2.0*baseHw/max(0.001,u.baseLineWidth)));}
    return max(0.1,u.effectParam);
}
@vertex fn vsMain(v:VSIn,@builtin(instance_index) iid:u32)->VSOut{
    let cubicIndex=iid/${BEZIER_SUBDIVISIONS}u;let sub=iid%${BEZIER_SUBDIVISIONS}u;let b=cubicIndex*5u;
    let g0=cubicData[b];let g1=cubicData[b+1u];let g2=cubicData[b+2u];let g3=cubicData[b+3u];let g4=cubicData[b+4u];
    let t0=f32(sub)/f32(${BEZIER_SUBDIVISIONS});let t1=f32(sub+1u)/f32(${BEZIER_SUBDIVISIONS});
    let start=cubic(g0.xy,g0.zw,g1.xy,g1.zw,t0);let end=cubic(g0.xy,g0.zw,g1.xy,g1.zw,t1);
    let delta=end-start;let len=max(length(delta),0.0001);let dir=delta/len;let n=vec2<f32>(-dir.y,dir.x);
    let hw0=max(0.001,exp(mix(log(max(0.001,g2.x)),log(max(0.001,g2.y)),t0)));
    let hw1=max(0.001,exp(mix(log(max(0.001,g2.x)),log(max(0.001,g2.y)),t1)));
    let rawAlpha=mix(g2.z,g2.w,(t0+t1)*0.5);var color=vec4<f32>(g3.rgb,clamp(rawAlpha*g3.a,0.0,1.0));
    if(u.effectUniformEnabled>0.5){
        if(u.overrideEnabled>0.5){color=vec4<f32>(u.overrideColor.rgb,clamp(rawAlpha*u.alphaScale*u.overrideColor.a,0.0,1.0));}
        else{color.a=clamp(color.a*u.alphaScale,0.0,1.0);}
    }
    let maxHw=max(hw0,hw1);var pad=maxHw+effectRadius(maxHw,g4.x)+2.5;if((u.mode>3.5&&u.mode<4.05)){pad=maxHw+2.025;}
    let tx=(v.corner.x+1.0)*0.5;let lx=mix(-pad,len+pad,tx);let ly=v.corner.y*pad;let p=start+dir*lx+n*ly;
    var o:VSOut;o.position=vec4<f32>(p.x/u.viewport.x*2.0-1.0,1.0-p.y/u.viewport.y*2.0,0.0,1.0);o.local=vec2<f32>(lx,ly);o.segLen=len;o.halfWidthStart=log(max(0.001,hw0));o.halfWidthEnd=log(max(0.001,hw1));o.color=color;o.baseHalfWidth=g4.x;return o;
}
@fragment fn fsMain(v:VSOut)->@location(0) vec4<f32>{
    let cx=clamp(v.local.x,0.0,v.segLen);let t=clamp(cx/max(0.0001,v.segLen),0.0,1.0);let hw=max(0.001,exp(mix(v.halfWidthStart,v.halfWidthEnd,t)));let d=length(vec2<f32>(v.local.x-cx,v.local.y));
    var cov=0.0;let radius=effectRadius(hw,v.baseHalfWidth);
    if((u.mode>3.5&&u.mode<4.05)){let cc=min(1.0,2.0*hw);cov=min(cc,clamp(hw+0.5-d,0.0,1.0));}
    else if(u.mode<0.5){let r=max(0.001,radius);let q=max(0.0,d-hw)/r;cov=exp(-3.15*q*q)*(1.0-smoothstep(0.82,1.04,q));}
    else if(u.mode<1.5){let edge=hw+max(0.0,radius);let cc=min(1.0,2.0*edge);cov=min(cc,clamp(edge+0.5-d,0.0,1.0));}
    else if(u.mode<2.5){let r=max(0.001,radius);let e=max(0.0,d-hw);let q=e/r;cov=exp(-3.15*q*q)*(1.0-smoothstep(0.82,1.04,q))*smoothstep(0.0,min(1.0,r*0.55),e);}
    else{let edge=max(0.0,hw-max(0.0,radius));let cc=min(1.0,2.0*edge);cov=min(cc,clamp(edge+0.5-d,0.0,1.0));}
    let auraKind=auraFloatKind(u.mode);if(auraKind>0u){cov=auraCoverage(v.position.xy,d,hw,radius,auraFloatPacked(u.mode,auraKind),auraKind);}
    let a=clamp(v.color.a*cov,0.0,1.0);if(a<0.00015){discard;}return vec4<f32>(select(v.color.rgb,vec3<f32>(1.0),auraFloatKind(u.mode)==7u)*a,a);
}

struct UniformVSOut {
    @builtin(position) position: vec4<f32>,
    @location(0) edge: f32,
    @location(1) halfWidth: f32,
    @location(2) color: vec4<f32>,
};
fn cubicDerivative(p0:vec2<f32>,c1:vec2<f32>,c2:vec2<f32>,p3:vec2<f32>,t:f32)->vec2<f32>{
    let q=1.0-t;return 3.0*q*q*(c1-p0)+6.0*q*t*(c2-c1)+3.0*t*t*(p3-c2);
}
fn safeUnit(v:vec2<f32>,fallback:vec2<f32>)->vec2<f32>{
    let lv=length(v);if(lv>0.00001){return v/lv;}let lf=length(fallback);if(lf>0.00001){return fallback/lf;}return vec2<f32>(1.0,0.0);
}
fn recordTangent(ci:u32,t:f32,fallback:vec2<f32>)->vec2<f32>{
    let b=ci*5u;let a=cubicData[b];let z=cubicData[b+1u];return safeUnit(cubicDerivative(a.xy,a.zw,z.xy,z.zw,t),fallback);
}
fn joinedTangent(ci:u32,t:f32,flags:f32,fallback:vec2<f32>)->vec2<f32>{
    let cur=recordTangent(ci,t,fallback);var sum=cur;
    let first=(flags>=0.5&&flags<1.5)||(flags>=2.5);
    let last=flags>=1.5;
    if(t<0.00001&&!first){sum=sum+recordTangent(ci-1u,1.0,cur);}
    if(t>0.99999&&!last){sum=sum+recordTangent(ci+1u,0.0,cur);}
    return safeUnit(sum,cur);
}
@vertex fn vsUniform(v:VSIn,@builtin(instance_index) iid:u32)->UniformVSOut{
    let ci=iid/${BEZIER_SUBDIVISIONS}u;let sub=iid%${BEZIER_SUBDIVISIONS}u;let b=ci*5u;
    let g0=cubicData[b];let g1=cubicData[b+1u];let g2=cubicData[b+2u];let g3=cubicData[b+3u];let g4=cubicData[b+4u];
    let t=select(f32(sub)/f32(${BEZIER_SUBDIVISIONS}),f32(sub+1u)/f32(${BEZIER_SUBDIVISIONS}),v.corner.x>0.0);
    let center=cubic(g0.xy,g0.zw,g1.xy,g1.zw,t);
    let chord=cubic(g0.xy,g0.zw,g1.xy,g1.zw,min(1.0,t+0.001))-cubic(g0.xy,g0.zw,g1.xy,g1.zw,max(0.0,t-0.001));
    let tangent=joinedTangent(ci,t,g4.w,chord);let normal=vec2<f32>(-tangent.y,tangent.x);
    let hw=max(0.001,exp(mix(log(max(0.001,g2.x)),log(max(0.001,g2.y)),t)));let pad=hw+0.75;
    
    
    
    
    let right=v.corner.x>0.0;
    let first=(g4.w>=.5&&g4.w<1.5)||g4.w>=2.5;
    let last=g4.w>=1.5;
    let hasNeighbor=select(sub>0u||!first,sub+1u<${BEZIER_SUBDIVISIONS}u||!last,right);
    let overlap=select(0.0,min(.55,max(.18,hw*.16)),hasNeighbor);
    let along=select(-overlap,overlap,right);
    let p=center+tangent*along+normal*(v.corner.y*pad);let rawAlpha=mix(g2.z,g2.w,t);var color=vec4<f32>(g3.rgb,clamp(rawAlpha*g3.a,0.0,1.0));
    if(u.effectUniformEnabled>0.5){if(u.overrideEnabled>0.5){color=vec4<f32>(u.overrideColor.rgb,clamp(rawAlpha*u.alphaScale*u.overrideColor.a,0.0,1.0));}else{color.a=clamp(color.a*u.alphaScale,0.0,1.0);}}
    var o:UniformVSOut;o.position=vec4<f32>(p.x/u.viewport.x*2.0-1.0,1.0-p.y/u.viewport.y*2.0,0.0,1.0);o.edge=v.corner.y*pad;o.halfWidth=hw;o.color=color;return o;
}
@fragment fn fsUniform(v:UniformVSOut)->@location(0) vec4<f32>{
    let hw=max(0.001,v.halfWidth);let cc=min(1.0,2.0*hw);let cov=min(cc,clamp(hw+0.5-abs(v.edge),0.0,1.0));let a=clamp(v.color.a*cov,0.0,1.0);if(a<0.00015){discard;}return vec4<f32>(v.color.rgb*a,a);
}
`;

  const WGSL = `
${SAIYAN_PLASMA_WGSL}
struct Uniforms {
    viewport: vec2<f32>,
    mode: f32,
    effectUniformEnabled: f32,
    effectParam: f32,
    baseLineWidth: f32,
    alphaScale: f32,
    overrideEnabled: f32,
    overrideColor: vec4<f32>,
};
@group(0) @binding(0) var<uniform> u: Uniforms;

struct VSIn {
    @location(0) corner: vec2<f32>,
    @location(1) start: vec2<f32>,
    @location(2) end: vec2<f32>,
    @location(3) halfWidthStart: f32,
    @location(4) halfWidthEnd: f32,
    @location(5) radius: f32,
    @location(6) color: vec4<f32>,
};
struct VSOut {
    @builtin(position) position: vec4<f32>,
    @location(0) local: vec2<f32>,
    @location(1) @interpolate(flat) segLen: f32,
    @location(2) @interpolate(flat) halfWidthStart: f32,
    @location(3) @interpolate(flat) halfWidthEnd: f32,
    @location(4) @interpolate(flat) radius: f32,
    @location(5) @interpolate(flat) color: vec4<f32>,
};

@vertex fn vsMain(v: VSIn) -> VSOut {
    var out: VSOut;
    let delta=v.end-v.start;
    let len=max(length(delta),0.0001);
    let dir=delta/len;
    let n=vec2<f32>(-dir.y,dir.x);
    let maxHalfWidth=max(v.halfWidthStart,v.halfWidthEnd);
    var radius=v.radius;
    var color=v.color;
    if(u.effectUniformEnabled>0.5){
        if((u.mode>0.5 && u.mode<1.5) || (u.mode>2.5 && u.mode<3.5)){
            radius=max(0.0,u.effectParam*(2.0*maxHalfWidth/max(0.001,u.baseLineWidth)));
        }else{
            radius=max(0.1,u.effectParam);
        }
        let scaledAlpha=color.a*u.alphaScale;
        if(u.overrideEnabled>0.5){
            let commandAlpha=color.a/max(0.000001,v.radius);
            color=vec4<f32>(u.overrideColor.rgb,commandAlpha*u.alphaScale*u.overrideColor.a);
        }else{
            color=vec4<f32>(color.rgb,scaledAlpha);
        }
    }
    var pad=maxHalfWidth+radius+2.5;
    if((u.mode>3.5&&u.mode<4.05)){ pad=maxHalfWidth+2.025; }
    let tx=(v.corner.x+1.0)*0.5;
    let lx=mix(-pad,len+pad,tx);
    let ly=v.corner.y*pad;
    let p=v.start+dir*lx+n*ly;
    out.position=vec4<f32>(p.x/u.viewport.x*2.0-1.0,1.0-p.y/u.viewport.y*2.0,0.0,1.0);
    out.local=vec2<f32>(lx,ly);
    out.segLen=len;
    out.halfWidthStart=v.halfWidthStart;
    out.halfWidthEnd=v.halfWidthEnd;
    out.radius=v.radius;
    out.color=color;
    return out;
}
fn seg(x:f32,a:f32,b:f32)->f32 { return clamp((x-a)/max(0.000001,b-a),0.0,1.0); }

@fragment fn fsMain(v: VSOut) -> @location(0) vec4<f32> {
    let cx=clamp(v.local.x,0.0,v.segLen);
    let widthT=clamp(cx/max(0.0001,v.segLen),0.0,1.0);
    let halfWidth=max(0.001,exp(mix(log(max(0.001,v.halfWidthStart)),log(max(0.001,v.halfWidthEnd)),widthT)));
    let d=length(vec2<f32>(v.local.x-cx,v.local.y));
    var radius=v.radius;
    if(u.effectUniformEnabled>0.5){
        if((u.mode>0.5 && u.mode<1.5) || (u.mode>2.5 && u.mode<3.5)){
            radius=max(0.0,u.effectParam*(2.0*halfWidth/max(0.001,u.baseLineWidth)));
        }else{ radius=max(0.1,u.effectParam); }
    }
    var cov=0.0;
    if((u.mode>3.5&&u.mode<4.05)){
        let centerCoverage=min(1.0,2.0*halfWidth);
        cov=min(centerCoverage,clamp(halfWidth+0.5-d,0.0,1.0));
    }else if(u.mode<0.5){
        let r=max(0.001,radius);
        let q=max(0.0,d-halfWidth)/r;
        let tail=exp(-3.15*q*q);
        let cutoff=1.0-smoothstep(0.82,1.04,q);
        cov=tail*cutoff;
    }else if(u.mode<1.5){
        let edge=halfWidth+max(0.0,radius);
        let centerCoverage=min(1.0,2.0*edge);
        cov=min(centerCoverage,clamp(edge+0.5-d,0.0,1.0));
    }else if(u.mode<2.5){
        let r=max(0.001,radius);
        let e=max(0.0,d-halfWidth);
        let q=e/r;
        let tail=exp(-3.15*q*q);
        let cutoff=1.0-smoothstep(0.82,1.04,q);
        let outside=smoothstep(0.0,min(1.0,r*0.55),e);
        cov=tail*cutoff*outside;
    }else{
        let edge=max(0.0,halfWidth-max(0.0,radius));
        let centerCoverage=min(1.0,2.0*edge);
        cov=min(centerCoverage,clamp(edge+0.5-d,0.0,1.0));
    }
    let auraKind=auraFloatKind(u.mode);if(auraKind>0u){cov=auraCoverage(v.position.xy,d,halfWidth,radius,auraFloatPacked(u.mode,auraKind),auraKind);}
    let a=clamp(v.color.a*cov,0.0,1.0);
    if(a<0.00015){ discard; }
    return vec4<f32>(select(v.color.rgb,vec3<f32>(1.0),auraFloatKind(u.mode)==7u)*a,a);
}`;

  const INDEXED_MORPH_WGSL = `
${SAIYAN_PLASMA_WGSL}
struct Uniforms {
    viewport: vec2<f32>,
    mode: f32,
    effectUniformEnabled: f32,
    effectParam: f32,
    baseLineWidth: f32,
    alphaScale: f32,
    overrideEnabled: f32,
    overrideColor: vec4<f32>,
};
struct CommandData {
    color: vec4<f32>,
    params: vec4<f32>,
};
struct MorphAffine {
    row0: vec4<f32>,
    row1: vec4<f32>,
};
@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage,read> pointData: array<vec4<f32>>;
@group(0) @binding(2) var<storage,read> topologyData: array<vec4<u32>>;
@group(0) @binding(3) var<storage,read> segmentAlpha: array<f32>;
@group(0) @binding(4) var<storage,read> commandData: array<CommandData>;

struct VSIn { @location(0) corner: vec2<f32>, };
struct VSOut {
    @builtin(position) position: vec4<f32>,
    @location(0) local: vec2<f32>,
    @location(1) @interpolate(flat) segLen: f32,
    @location(2) @interpolate(flat) halfWidthStart: f32, 
    @location(3) @interpolate(flat) halfWidthEnd: f32, 
    @location(4) @interpolate(flat) rawColor: vec4<f32>,
    @location(5) @interpolate(flat) rawAlpha: f32,
};

fn effectRadius(halfWidth:f32)->f32{
    if(u.effectUniformEnabled>0.5){
        if((u.mode>0.5 && u.mode<1.5) || (u.mode>2.5 && u.mode<3.5)){
            return max(0.0,u.effectParam*(2.0*halfWidth/max(0.001,u.baseLineWidth)));
        }
        return max(0.1,u.effectParam);
    }
    return 0.0;
}
fn finalColor(base:vec4<f32>,rawAlpha:f32)->vec4<f32>{
    if(u.effectUniformEnabled>0.5){
        if(u.overrideEnabled>0.5){
            return vec4<f32>(u.overrideColor.rgb,rawAlpha*u.alphaScale*u.overrideColor.a);
        }
        return vec4<f32>(base.rgb,base.a*rawAlpha*u.alphaScale);
    }
    return vec4<f32>(base.rgb,base.a*rawAlpha);
}

@vertex fn vsMain(v:VSIn,@builtin(instance_index) iid:u32)->VSOut{
    let topo=topologyData[iid];
    let a=pointData[topo.x];
    let b=pointData[topo.y];
    let cmd=commandData[topo.z];
    let start=a.xy;
    let end=b.xy;
    let delta=end-start;
    let rawLen=length(delta);
    let len=max(rawLen,0.0001);
    let dir=delta/len;
    let n=vec2<f32>(-dir.y,dir.x);
    let halfWidthStart=max(0.001,cmd.params.x*max(0.02,a.z));
    let halfWidthEnd=max(0.001,cmd.params.x*max(0.02,b.z));
    let maxHalfWidth=max(halfWidthStart,halfWidthEnd);
    let pad=maxHalfWidth+effectRadius(maxHalfWidth)+2.5;
    let finalPad=select(pad,maxHalfWidth+2.025,(u.mode>3.5&&u.mode<4.05));
    let tx=(v.corner.x+1.0)*0.5;
    let lx=mix(-finalPad,len+finalPad,tx);
    let ly=v.corner.y*finalPad;
    let p=start+dir*lx+n*ly;
    var out:VSOut;
    out.position=vec4<f32>(p.x/u.viewport.x*2.0-1.0,1.0-p.y/u.viewport.y*2.0,0.0,1.0);
    out.local=vec2<f32>(lx,ly);
    out.segLen=len;
    out.halfWidthStart=log(max(0.001,halfWidthStart));
    out.halfWidthEnd=log(max(0.001,halfWidthEnd));
    out.rawColor=cmd.color;
    out.rawAlpha=select(cmd.params.y,segmentAlpha[iid],topo.w!=0u)*select(0.0,1.0,rawLen>=0.000001);
    return out;
}

@fragment fn fsMain(v:VSOut)->@location(0) vec4<f32>{
    let cx=clamp(v.local.x,0.0,v.segLen);
    let widthT=clamp(cx/max(0.0001,v.segLen),0.0,1.0);
    let halfWidth=max(0.001,exp(mix(v.halfWidthStart,v.halfWidthEnd,widthT)));
    let d=length(vec2<f32>(v.local.x-cx,v.local.y));
    let radius=effectRadius(halfWidth);
    var cov=0.0;
    if((u.mode>3.5&&u.mode<4.05)){
        let centerCoverage=min(1.0,2.0*halfWidth);
        cov=min(centerCoverage,clamp(halfWidth+0.5-d,0.0,1.0));
    }else if(u.mode<0.5){
        let r=max(0.001,radius);
        let q=max(0.0,d-halfWidth)/r;
        cov=exp(-3.15*q*q)*(1.0-smoothstep(0.82,1.04,q));
    }else if(u.mode<1.5){
        let edge=halfWidth+max(0.0,radius);
        let centerCoverage=min(1.0,2.0*edge);
        cov=min(centerCoverage,clamp(edge+0.5-d,0.0,1.0));
    }else if(u.mode<2.5){
        let r=max(0.001,radius);
        let e=max(0.0,d-halfWidth);
        let q=e/r;
        cov=exp(-3.15*q*q)*(1.0-smoothstep(0.82,1.04,q))*smoothstep(0.0,min(1.0,r*0.55),e);
    }else{
        let edge=max(0.0,halfWidth-max(0.0,radius));
        let centerCoverage=min(1.0,2.0*edge);
        cov=min(centerCoverage,clamp(edge+0.5-d,0.0,1.0));
    }
    let c=finalColor(v.rawColor,v.rawAlpha);
    let auraKind=auraFloatKind(u.mode);if(auraKind>0u){cov=auraCoverage(v.position.xy,d,halfWidth,radius,auraFloatPacked(u.mode,auraKind),auraKind);}
    let alpha=clamp(c.a*cov,0.0,1.0);
    if(alpha<0.00015){discard;}
    return vec4<f32>(select(c.rgb,vec3<f32>(1.0),auraFloatKind(u.mode)==7u)*alpha,alpha);
}
`;

  const INDEXED_MORPH_LINEAR_WGSL = `
${SAIYAN_PLASMA_WGSL}
struct Uniforms {
    viewport: vec2<f32>,
    mode: f32,
    effectUniformEnabled: f32,
    effectParam: f32,
    baseLineWidth: f32,
    alphaScale: f32,
    overrideEnabled: f32,
    overrideColor: vec4<f32>,
};
struct CommandData {
    color: vec4<f32>,
    params: vec4<f32>,
};
struct MorphAffine {
    row0: vec4<f32>,
    row1: vec4<f32>,
};
@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage,read> sourcePointData: array<vec4<f32>>;
@group(0) @binding(2) var<storage,read> targetPointData: array<vec4<f32>>;
@group(0) @binding(3) var<storage,read> topologyData: array<vec4<u32>>;
@group(0) @binding(4) var<storage,read> segmentAlpha: array<f32>;
@group(0) @binding(5) var<storage,read> commandData: array<CommandData>;
@group(0) @binding(6) var<uniform> morphAffine: MorphAffine;

fn applyMorphAffine(p:vec2<f32>)->vec2<f32>{
    return vec2<f32>(
        morphAffine.row0.x*p.x + morphAffine.row0.y*p.y + morphAffine.row0.z,
        morphAffine.row1.x*p.x + morphAffine.row1.y*p.y + morphAffine.row1.z
    );
}

struct VSIn { @location(0) corner: vec2<f32>, };
struct VSOut {
    @builtin(position) position: vec4<f32>,
    @location(0) local: vec2<f32>,
    @location(1) @interpolate(flat) segLen: f32,
    @location(2) @interpolate(flat) halfWidthStart: f32, 
    @location(3) @interpolate(flat) halfWidthEnd: f32, 
    @location(4) @interpolate(flat) rawColor: vec4<f32>,
    @location(5) @interpolate(flat) rawAlpha: f32,
};

fn effectRadius(halfWidth:f32)->f32{
    if(u.effectUniformEnabled>0.5){
        if((u.mode>0.5 && u.mode<1.5) || (u.mode>2.5 && u.mode<3.5)){
            return max(0.0,u.effectParam*(2.0*halfWidth/max(0.001,u.baseLineWidth)));
        }
        return max(0.1,u.effectParam);
    }
    return 0.0;
}
fn finalColor(base:vec4<f32>,rawAlpha:f32)->vec4<f32>{
    if(u.effectUniformEnabled>0.5){
        if(u.overrideEnabled>0.5){
            return vec4<f32>(u.overrideColor.rgb,rawAlpha*u.alphaScale*u.overrideColor.a);
        }
        return vec4<f32>(base.rgb,base.a*rawAlpha*u.alphaScale);
    }
    return vec4<f32>(base.rgb,base.a*rawAlpha);
}

@vertex fn vsMain(v:VSIn,@builtin(instance_index) iid:u32)->VSOut{
    let topo=topologyData[iid];
    let cmd=commandData[topo.z];
    let morphT=clamp(morphAffine.row0.w,0.0,1.0);
    let a=mix(sourcePointData[topo.x],targetPointData[topo.x],morphT);
    let b=mix(sourcePointData[topo.y],targetPointData[topo.y],morphT);
    let start=applyMorphAffine(a.xy);
    let end=applyMorphAffine(b.xy);
    let delta=end-start;
    let rawLen=length(delta);
    let len=max(rawLen,0.0001);
    let dir=delta/len;
    let n=vec2<f32>(-dir.y,dir.x);
    let halfWidthStart=max(0.001,cmd.params.x*max(0.02,a.z));
    let halfWidthEnd=max(0.001,cmd.params.x*max(0.02,b.z));
    let maxHalfWidth=max(halfWidthStart,halfWidthEnd);
    let pad=maxHalfWidth+effectRadius(maxHalfWidth)+2.5;
    let finalPad=select(pad,maxHalfWidth+2.025,(u.mode>3.5&&u.mode<4.05));
    let tx=(v.corner.x+1.0)*0.5;
    let lx=mix(-finalPad,len+finalPad,tx);
    let ly=v.corner.y*finalPad;
    let p=start+dir*lx+n*ly;
    var out:VSOut;
    out.position=vec4<f32>(p.x/u.viewport.x*2.0-1.0,1.0-p.y/u.viewport.y*2.0,0.0,1.0);
    out.local=vec2<f32>(lx,ly);
    out.segLen=len;
    out.halfWidthStart=log(max(0.001,halfWidthStart));
    out.halfWidthEnd=log(max(0.001,halfWidthEnd));
    out.rawColor=cmd.color;
    out.rawAlpha=select(cmd.params.y,segmentAlpha[iid],topo.w!=0u)*select(0.0,1.0,rawLen>=0.000001);
    return out;
}

@fragment fn fsMain(v:VSOut)->@location(0) vec4<f32>{
    let cx=clamp(v.local.x,0.0,v.segLen);
    let widthT=clamp(cx/max(0.0001,v.segLen),0.0,1.0);
    let halfWidth=max(0.001,exp(mix(v.halfWidthStart,v.halfWidthEnd,widthT)));
    let d=length(vec2<f32>(v.local.x-cx,v.local.y));
    let radius=effectRadius(halfWidth);
    var cov=0.0;
    if((u.mode>3.5&&u.mode<4.05)){
        let centerCoverage=min(1.0,2.0*halfWidth);
        cov=min(centerCoverage,clamp(halfWidth+0.5-d,0.0,1.0));
    }else if(u.mode<0.5){
        let r=max(0.001,radius);
        let q=max(0.0,d-halfWidth)/r;
        cov=exp(-3.15*q*q)*(1.0-smoothstep(0.82,1.04,q));
    }else if(u.mode<1.5){
        let edge=halfWidth+max(0.0,radius);
        let centerCoverage=min(1.0,2.0*edge);
        cov=min(centerCoverage,clamp(edge+0.5-d,0.0,1.0));
    }else if(u.mode<2.5){
        let r=max(0.001,radius);
        let e=max(0.0,d-halfWidth);
        let q=e/r;
        cov=exp(-3.15*q*q)*(1.0-smoothstep(0.82,1.04,q))*smoothstep(0.0,min(1.0,r*0.55),e);
    }else{
        let edge=max(0.0,halfWidth-max(0.0,radius));
        let centerCoverage=min(1.0,2.0*edge);
        cov=min(centerCoverage,clamp(edge+0.5-d,0.0,1.0));
    }
    let c=finalColor(v.rawColor,v.rawAlpha);
    let auraKind=auraFloatKind(u.mode);if(auraKind>0u){cov=auraCoverage(v.position.xy,d,halfWidth,radius,auraFloatPacked(u.mode,auraKind),auraKind);}
    let alpha=clamp(c.a*cov,0.0,1.0);
    if(alpha<0.00015){discard;}
    return vec4<f32>(select(c.rgb,vec3<f32>(1.0),auraFloatKind(u.mode)==7u)*alpha,alpha);
}
`;

  const INDEXED_MORPH_CORRIDOR_WGSL = `
${SAIYAN_PLASMA_WGSL}
struct CorridorUniforms {
    viewport: vec2<f32>,
    segmentCount: u32,
    mode: u32,
    effect: vec4<f32>,
    overrideColor: vec4<f32>,
};
struct CommandData {
    color: vec4<f32>,
    params: vec4<f32>,
};
@group(0) @binding(0) var<uniform> u: CorridorUniforms;
@group(0) @binding(1) var<storage,read> pointData: array<vec4<f32>>;
@group(0) @binding(2) var<storage,read> topologyData: array<vec4<u32>>;
@group(0) @binding(3) var<storage,read> segmentAlpha: array<f32>;
@group(0) @binding(4) var<storage,read> commandData: array<CommandData>;
@group(0) @binding(5) var<storage,read> copyData: array<vec4<f32>>;

struct VSIn { @location(0) corner: vec2<f32>, };
struct VSOut {
    @builtin(position) position: vec4<f32>,
    @location(0) local: vec2<f32>,
    @location(1) @interpolate(flat) segLen: f32,
    @location(2) @interpolate(flat) halfWidthStart: f32, 
    @location(3) @interpolate(flat) halfWidthEnd: f32, 
    @location(4) @interpolate(flat) radiusMax: f32,
    @location(5) @interpolate(flat) color: vec4<f32>,
};
fn transformPoint(p:vec2<f32>,m:vec4<f32>,t:vec4<f32>)->vec2<f32>{
    return vec2<f32>(m.x*p.x+m.y*p.y+t.x,m.z*p.x+m.w*p.y+t.y);
}
@vertex fn vsMain(v:VSIn,@builtin(instance_index) iid:u32)->VSOut{
    let si=iid%u.segmentCount;
    let ci=iid/u.segmentCount;
    let topo=topologyData[si];
    let pa=pointData[topo.x];
    let pb=pointData[topo.y];
    let cmd=commandData[topo.z];
    let c0=copyData[ci*4u];
    let c1=copyData[ci*4u+1u];
    let c2=copyData[ci*4u+2u];
    let c3=copyData[ci*4u+3u];
    let start=transformPoint(pa.xy,c0,c1);
    let end=transformPoint(pb.xy,c0,c1);
    let delta=end-start;
    let rawLen=length(delta);
    let len=max(rawLen,0.0001);
    let dir=delta/len;
    let n=vec2<f32>(-dir.y,dir.x);
    let hwStart=max(0.001,cmd.params.x*max(0.02,pa.z)*c1.z);
    let hwEnd=max(0.001,cmd.params.x*max(0.02,pb.z)*c1.z);
    let hwMax=max(hwStart,hwEnd);
    var radiusMax=0.0;
    if(u.mode==1u || u.mode==3u){
        radiusMax=max(0.0,u.effect.x*((2.0*hwMax)/max(0.001,u.effect.y)));
    }else if(u.mode==0u || u.mode==2u || (u.mode>=5u&&u.mode<=7u)){
        radiusMax=max(0.1,u.effect.x);
    }
    let strokeAlpha=select(cmd.params.y,segmentAlpha[si],topo.w!=0u)*select(0.0,1.0,rawLen>=0.000001);
    var rgb=c2.rgb;
    var colorAlpha=clamp(strokeAlpha*c1.w*c2.a*u.effect.z,0.0,1.0);
    if(u.effect.w>0.5){rgb=u.overrideColor.rgb;colorAlpha=clamp(strokeAlpha*c1.w*u.overrideColor.a*u.effect.z,0.0,1.0);}
    var pad=hwMax+radiusMax+2.5;
    if(u.mode==4u){pad=hwMax+2.025;}
    let tx=(v.corner.x+1.0)*0.5;
    let lx=mix(-pad,len+pad,tx);
    let ly=v.corner.y*pad;
    let p=start+dir*lx+n*ly;
    var out:VSOut;
    out.position=vec4<f32>(p.x/u.viewport.x*2.0-1.0,1.0-p.y/u.viewport.y*2.0,0.0,1.0);
    out.local=vec2<f32>(lx,ly);
    out.segLen=len;
    out.halfWidthStart=log(max(0.001,hwStart));
    out.halfWidthEnd=log(max(0.001,hwEnd));
    out.radiusMax=radiusMax;
    out.color=vec4<f32>(rgb,colorAlpha);
    return out;
}
@fragment fn fsMain(v:VSOut)->@location(0) vec4<f32>{
    let cx=clamp(v.local.x,0.0,v.segLen);
    let widthT=clamp(cx/max(0.0001,v.segLen),0.0,1.0);
    let halfWidth=max(0.001,exp(mix(v.halfWidthStart,v.halfWidthEnd,widthT)));
    let d=length(vec2<f32>(v.local.x-cx,v.local.y));
    var radius=v.radiusMax;
    if(u.mode==1u || u.mode==3u){radius=max(0.0,u.effect.x*((2.0*halfWidth)/max(0.001,u.effect.y)));}
    else if(u.mode==0u || u.mode==2u || (u.mode>=5u&&u.mode<=7u)){radius=max(0.1,u.effect.x);}
    var cov=0.0;
    if(u.mode==4u){
        let centerCoverage=min(1.0,2.0*halfWidth);
        cov=min(centerCoverage,clamp(halfWidth+0.5-d,0.0,1.0));
    }else if(u.mode==0u){
        let r=max(0.001,radius);let q=max(0.0,d-halfWidth)/r;
        cov=exp(-3.15*q*q)*(1.0-smoothstep(0.82,1.04,q));
    }else if(u.mode==1u){
        let edge=halfWidth+max(0.0,radius);let centerCoverage=min(1.0,2.0*edge);
        cov=min(centerCoverage,clamp(edge+0.5-d,0.0,1.0));
    }else if(u.mode==2u){
        let r=max(0.001,radius);let e=max(0.0,d-halfWidth);let q=e/r;
        cov=exp(-3.15*q*q)*(1.0-smoothstep(0.82,1.04,q))*smoothstep(0.0,min(1.0,r*0.55),e);
    }else{
        let edge=max(0.0,halfWidth-max(0.0,radius));let centerCoverage=min(1.0,2.0*edge);
        cov=min(centerCoverage,clamp(edge+0.5-d,0.0,1.0));
    }
    if(u.mode>=5u&&u.mode<=7u){cov=auraCoverage(v.position.xy,d,halfWidth,radius,u.effect.y,u.mode);}
    let a=clamp(v.color.a*cov,0.0,1.0);
    if(a<0.00015){discard;}
    return vec4<f32>(select(v.color.rgb,vec3<f32>(1.0),u.mode==7u)*a,a);
}
`;

  const SHARED_JOIN_WGSL = `
${SAIYAN_PLASMA_WGSL}
struct Uniforms {
    viewport: vec2<f32>,
    mode: f32,
    effectUniformEnabled: f32,
    effectParam: f32,
    baseLineWidth: f32,
    alphaScale: f32,
    overrideEnabled: f32,
    overrideColor: vec4<f32>,
};
struct Style { color: vec4<f32>, };
@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage,read> pointData: array<vec4<f32>>;
@group(0) @binding(2) var<storage,read> segData: array<vec2<f32>>;
@group(0) @binding(3) var<uniform> style: Style;

struct VSIn { @location(0) corner: vec2<f32>, };
struct BodyOut {
    @builtin(position) position: vec4<f32>,
    @location(0) local: vec2<f32>,
    @location(1) @interpolate(flat) segLen: f32,
    @location(2) @interpolate(flat) halfWidthStart: f32, 
    @location(3) @interpolate(flat) halfWidthEnd: f32, 
    @location(4) @interpolate(flat) rawAlpha: f32,
};
struct PointOut {
    @builtin(position) position: vec4<f32>,
    @location(0) local: vec2<f32>,
    @location(1) @interpolate(flat) halfWidth: f32,
    @location(2) @interpolate(flat) prevDir: vec2<f32>,
    @location(3) @interpolate(flat) nextDir: vec2<f32>,
    @location(4) @interpolate(flat) prevAlpha: f32,
    @location(5) @interpolate(flat) nextAlpha: f32,
    @location(6) @interpolate(flat) flags: f32,
};

fn effectRadius(halfWidth:f32)->f32{
    if(u.effectUniformEnabled>0.5){
        if((u.mode>0.5 && u.mode<1.5) || (u.mode>2.5 && u.mode<3.5)){
            return max(0.0,u.effectParam*(2.0*halfWidth/max(0.001,u.baseLineWidth)));
        }
        return max(0.1,u.effectParam);
    }
    return 0.0;
}
fn finalColor(rawAlpha:f32)->vec4<f32>{
    let a=max(0.0,rawAlpha);
    if(u.effectUniformEnabled>0.5){
        if(u.overrideEnabled>0.5){return vec4<f32>(u.overrideColor.rgb,a*u.alphaScale*u.overrideColor.a);}
        return vec4<f32>(style.color.rgb,style.color.a*a*u.alphaScale);
    }
    return vec4<f32>(style.color.rgb,style.color.a*a);
}
fn coverage(d:f32,halfWidth:f32,pixel:vec2<f32>)->f32{
    var radius=effectRadius(halfWidth);
    let kind=auraFloatKind(u.mode);if(kind>0u){return auraCoverage(pixel,d,halfWidth,radius,auraFloatPacked(u.mode,kind),kind);}
    if((u.mode>3.5&&u.mode<4.05)){
        let centerCoverage=min(1.0,2.0*halfWidth);
        return min(centerCoverage,clamp(halfWidth+0.5-d,0.0,1.0));
    }
    if(u.mode<0.5){
        let r=max(0.001,radius);
        let q=max(0.0,d-halfWidth)/r;
        return exp(-3.15*q*q)*(1.0-smoothstep(0.82,1.04,q));
    }
    if(u.mode<1.5){
        let edge=halfWidth+max(0.0,radius);
        let centerCoverage=min(1.0,2.0*edge);
        return min(centerCoverage,clamp(edge+0.5-d,0.0,1.0));
    }
    if(u.mode<2.5){
        let r=max(0.001,radius);
        let e=max(0.0,d-halfWidth);
        let q=e/r;
        let outside=smoothstep(0.0,min(1.0,r*0.55),e);
        return exp(-3.15*q*q)*(1.0-smoothstep(0.82,1.04,q))*outside;
    }
    let edge=max(0.0,halfWidth-max(0.0,radius));
    let centerCoverage=min(1.0,2.0*edge);
    return min(centerCoverage,clamp(edge+0.5-d,0.0,1.0));
}

@vertex fn vsBody(v:VSIn,@builtin(instance_index) iid:u32)->BodyOut{
    let sd=segData[iid];
    let pi=u32(sd.x+0.5);
    let g0=pointData[pi*2u];
    let g1=pointData[(pi+1u)*2u];
    let start=g0.xy;
    let end=g1.xy;
    let delta=end-start;
    let len=max(length(delta),0.0001);
    let dir=delta/len;
    let n=vec2<f32>(-dir.y,dir.x);
    let hw0=max(0.001,g0.z);
    let hw1=max(0.001,g1.z);
    let pad=max(hw0+effectRadius(hw0),hw1+effectRadius(hw1))+2.5;
    let t=(v.corner.x+1.0)*0.5;
    let lx=t*len;
    let ly=v.corner.y*pad;
    let p=start+dir*lx+n*ly;
    var o:BodyOut;
    o.position=vec4<f32>(p.x/u.viewport.x*2.0-1.0,1.0-p.y/u.viewport.y*2.0,0.0,1.0);
    o.local=vec2<f32>(lx,ly);
    o.segLen=len;
    o.halfWidthStart=log(max(0.001,hw0));
    o.halfWidthEnd=log(max(0.001,hw1));
    o.rawAlpha=sd.y;
    return o;
}
@fragment fn fsBody(v:BodyOut)->@location(0) vec4<f32>{
    let t=clamp(v.local.x/max(0.0001,v.segLen),0.0,1.0);
    let hw=max(0.001,exp(mix(v.halfWidthStart,v.halfWidthEnd,t)));
    let cov=coverage(abs(v.local.y),hw,v.position.xy);
    let c=finalColor(v.rawAlpha);
    let a=clamp(c.a*cov,0.0,1.0);
    if(a<0.00015){discard;}
    return vec4<f32>(select(c.rgb,vec3<f32>(1.0),auraFloatKind(u.mode)==7u)*a,a);
}

@vertex fn vsPoint(v:VSIn,@builtin(instance_index) iid:u32)->PointOut{
    let g=pointData[iid*2u];
    let q=pointData[iid*2u+1u];
    let hw=max(0.001,g.z);
    var pad=hw+effectRadius(hw)+2.5;
    if((u.mode>3.5&&u.mode<4.05)){pad=hw+2.025;}
    let local=v.corner*pad;
    let p=g.xy+local;
    var o:PointOut;
    o.position=vec4<f32>(p.x/u.viewport.x*2.0-1.0,1.0-p.y/u.viewport.y*2.0,0.0,1.0);
    o.local=local;
    o.halfWidth=hw;
    o.prevDir=vec2<f32>(cos(q.x),sin(q.x));
    o.nextDir=vec2<f32>(cos(q.y),sin(q.y));
    o.prevAlpha=q.z;
    o.nextAlpha=q.w;
    o.flags=g.w;
    return o;
}
@fragment fn fsPoint(v:PointOut)->@location(0) vec4<f32>{

    let hasPrev=fract(v.flags*0.5)>=0.25; 
    let hasNext=v.flags>=2.0;            
    let prevActive=hasPrev && dot(v.local,v.prevDir)>=-0.00001;
    let nextActive=hasNext && dot(v.local,v.nextDir)<=0.00001;
    var rawAlpha=0.0;
    if(prevActive){rawAlpha=max(rawAlpha,v.prevAlpha);}
    if(nextActive){rawAlpha=max(rawAlpha,v.nextAlpha);}
    if(rawAlpha<=0.000001){discard;}
    let cov=coverage(length(v.local),v.halfWidth,v.position.xy);
    let c=finalColor(rawAlpha);
    let a=clamp(c.a*cov,0.0,1.0);
    if(a<0.00015){discard;}
    return vec4<f32>(select(c.rgb,vec3<f32>(1.0),auraFloatKind(u.mode)==7u)*a,a);
}
`;

  const CORRIDOR_WGSL = `
${SAIYAN_PLASMA_WGSL}
struct CorridorUniforms {
    viewport: vec2<f32>,
    segmentCount: u32,
    mode: u32,
    effect: vec4<f32>,
    overrideColor: vec4<f32>,
};
@group(0) @binding(0) var<uniform> u: CorridorUniforms;
@group(0) @binding(1) var<storage,read> segData: array<vec4<f32>>;
@group(0) @binding(2) var<storage,read> copyData: array<vec4<f32>>;
struct VSIn { @location(0) corner: vec2<f32>, };
struct VSOut {
    @builtin(position) position: vec4<f32>,
    @location(0) local: vec2<f32>,
    @location(1) @interpolate(flat) segLen: f32,
    @location(2) @interpolate(flat) halfWidthStart: f32, 
    @location(3) @interpolate(flat) halfWidthEnd: f32, 
    @location(4) @interpolate(flat) radiusMax: f32,
    @location(5) @interpolate(flat) color: vec4<f32>,
};
fn transformPoint(p:vec2<f32>,m:vec4<f32>,t:vec4<f32>)->vec2<f32>{
    return vec2<f32>(m.x*p.x+m.y*p.y+t.x,m.z*p.x+m.w*p.y+t.y);
}
@vertex fn vsCorridor(v:VSIn,@builtin(instance_index) iid:u32)->VSOut{
    var out:VSOut;
    let si=iid%u.segmentCount;
    let ci=iid/u.segmentCount;
    let s0=segData[si*2u];
    let s1=segData[si*2u+1u];
    let c0=copyData[ci*4u];
    let c1=copyData[ci*4u+1u];
    let c2=copyData[ci*4u+2u];
    let c3=copyData[ci*4u+3u];
    let start=transformPoint(s0.xy,c0,c1);
    let end=transformPoint(s0.zw,c0,c1);
    let delta=end-start;
    let len=max(length(delta),0.0001);
    let dir=delta/len;
    let n=vec2<f32>(-dir.y,dir.x);

    let hwStart=max(0.001,s1.x*c1.z);
    let hwEnd=max(0.001,s1.y*c1.z);
    let hwMax=max(hwStart,hwEnd);
    var radiusMax=0.0;
    if(u.mode==1u || u.mode==3u){
        radiusMax=max(0.0,u.effect.x*((2.0*hwMax)/max(0.001,u.effect.y)));
    }else if(u.mode==0u || u.mode==2u || (u.mode>=5u&&u.mode<=7u)){
        radiusMax=max(0.1,u.effect.x);
    }
    var rgb=c2.rgb;

    let copyAlpha=mix(c1.w,c3.x,clamp(s1.w,0.0,1.0));
    var colorAlpha=clamp(s1.z*copyAlpha*c2.a*u.effect.z,0.0,1.0);
    if(u.effect.w>0.5){rgb=u.overrideColor.rgb;colorAlpha=clamp(s1.z*copyAlpha*u.overrideColor.a*u.effect.z,0.0,1.0);}
    var pad=hwMax+radiusMax+2.5;
    if(u.mode==4u){pad=hwMax+2.025;}
    let tx=(v.corner.x+1.0)*0.5;
    let lx=mix(-pad,len+pad,tx);
    let ly=v.corner.y*pad;
    let p=start+dir*lx+n*ly;
    out.position=vec4<f32>(p.x/u.viewport.x*2.0-1.0,1.0-p.y/u.viewport.y*2.0,0.0,1.0);
    out.local=vec2<f32>(lx,ly);
    out.segLen=len;
    out.halfWidthStart=log(max(0.001,hwStart));
    out.halfWidthEnd=log(max(0.001,hwEnd));
    out.radiusMax=radiusMax;
    out.color=vec4<f32>(rgb,colorAlpha);
    return out;
}
@fragment fn fsCorridor(v:VSOut)->@location(0) vec4<f32>{
    let cx=clamp(v.local.x,0.0,v.segLen);
    let widthT=clamp(cx/max(0.0001,v.segLen),0.0,1.0);
    let halfWidth=max(0.001,exp(mix(v.halfWidthStart,v.halfWidthEnd,widthT)));
    let d=length(vec2<f32>(v.local.x-cx,v.local.y));
    var radius=v.radiusMax;
    if(u.mode==1u || u.mode==3u){radius=max(0.0,u.effect.x*((2.0*halfWidth)/max(0.001,u.effect.y)));}
    else if(u.mode==0u || u.mode==2u || (u.mode>=5u&&u.mode<=7u)){radius=max(0.1,u.effect.x);}
    var cov=0.0;
    if(u.mode==4u){
        let centerCoverage=min(1.0,2.0*halfWidth);
        cov=min(centerCoverage,clamp(halfWidth+0.5-d,0.0,1.0));
    }else if(u.mode==0u){
        let r=max(0.001,radius);let q=max(0.0,d-halfWidth)/r;
        cov=exp(-3.15*q*q)*(1.0-smoothstep(0.82,1.04,q));
    }else if(u.mode==1u){
        let edge=halfWidth+max(0.0,radius);let centerCoverage=min(1.0,2.0*edge);
        cov=min(centerCoverage,clamp(edge+0.5-d,0.0,1.0));
    }else if(u.mode==2u){
        let r=max(0.001,radius);let e=max(0.0,d-halfWidth);let q=e/r;
        cov=exp(-3.15*q*q)*(1.0-smoothstep(0.82,1.04,q))*smoothstep(0.0,min(1.0,r*0.55),e);
    }else{
        let edge=max(0.0,halfWidth-max(0.0,radius));let centerCoverage=min(1.0,2.0*edge);
        cov=min(centerCoverage,clamp(edge+0.5-d,0.0,1.0));
    }
    if(u.mode>=5u&&u.mode<=7u){cov=auraCoverage(v.position.xy,d,halfWidth,radius,u.effect.y,u.mode);}
    let a=clamp(v.color.a*cov,0.0,1.0);
    if(a<0.00015){discard;}
    return vec4<f32>(select(v.color.rgb,vec3<f32>(1.0),u.mode==7u)*a,a);
}`;

  const BEZIER_CORRIDOR_WGSL = `
${SAIYAN_PLASMA_WGSL}
struct CorridorUniforms {
    viewport: vec2<f32>,
    segmentCount: u32,
    mode: u32,
    effect: vec4<f32>,
    overrideColor: vec4<f32>,
};
@group(0) @binding(0) var<uniform> u: CorridorUniforms;
@group(0) @binding(1) var<storage,read> cubicData: array<vec4<f32>>;
@group(0) @binding(2) var<storage,read> copyData: array<vec4<f32>>;
struct VSIn { @location(0) corner: vec2<f32>, };
struct VSOut {
    @builtin(position) position: vec4<f32>,
    @location(0) local: vec2<f32>,
    @location(1) @interpolate(flat) segLen: f32,
    @location(2) @interpolate(flat) halfWidthStart: f32, 
    @location(3) @interpolate(flat) halfWidthEnd: f32, 
    @location(4) @interpolate(flat) radiusMax: f32,
    @location(5) @interpolate(flat) color: vec4<f32>,
};
fn cubic(p0:vec2<f32>,c1:vec2<f32>,c2:vec2<f32>,p3:vec2<f32>,t:f32)->vec2<f32>{
    let q=1.0-t;return q*q*q*p0+3.0*q*q*t*c1+3.0*q*t*t*c2+t*t*t*p3;
}
fn transformPoint(p:vec2<f32>,m:vec4<f32>,t:vec4<f32>)->vec2<f32>{
    return vec2<f32>(m.x*p.x+m.y*p.y+t.x,m.z*p.x+m.w*p.y+t.y);
}
@vertex fn vsCorridor(v:VSIn,@builtin(instance_index) iid:u32)->VSOut{
    var out:VSOut;
    let micro=iid%u.segmentCount;
    let ci=iid/u.segmentCount;
    let cubicIndex=micro/${BEZIER_SUBDIVISIONS}u;
    let sub=micro%${BEZIER_SUBDIVISIONS}u;
    let b=cubicIndex*5u;
    let g0=cubicData[b];let g1=cubicData[b+1u];let g2=cubicData[b+2u];let g4=cubicData[b+4u];
    let c0=copyData[ci*4u];let c1=copyData[ci*4u+1u];let c2=copyData[ci*4u+2u];let c3=copyData[ci*4u+3u];
    let t0=f32(sub)/f32(${BEZIER_SUBDIVISIONS});let t1=f32(sub+1u)/f32(${BEZIER_SUBDIVISIONS});
    let p0=cubic(g0.xy,g0.zw,g1.xy,g1.zw,t0);let p1=cubic(g0.xy,g0.zw,g1.xy,g1.zw,t1);
    let start=transformPoint(p0,c0,c1);let end=transformPoint(p1,c0,c1);
    let delta=end-start;let len=max(length(delta),0.0001);let dir=delta/len;let n=vec2<f32>(-dir.y,dir.x);
    let hwStart=max(0.001,exp(mix(log(max(0.001,g2.x)),log(max(0.001,g2.y)),t0))*c1.z);
    let hwEnd=max(0.001,exp(mix(log(max(0.001,g2.x)),log(max(0.001,g2.y)),t1))*c1.z);
    let hwMax=max(hwStart,hwEnd);
    var radiusMax=0.0;
    if(u.mode==1u || u.mode==3u){radiusMax=max(0.0,u.effect.x*((2.0*hwMax)/max(0.001,u.effect.y)));}
    else if(u.mode==0u || u.mode==2u || (u.mode>=5u&&u.mode<=7u)){radiusMax=max(0.1,u.effect.x);}
    let rawAlpha=mix(g2.z,g2.w,(t0+t1)*0.5);

    let seamT=mix(g4.y,g4.z,(t0+t1)*0.5);
    let copyAlpha=mix(c1.w,c3.x,clamp(seamT,0.0,1.0));
    var rgb=c2.rgb;var colorAlpha=clamp(rawAlpha*copyAlpha*c2.a*u.effect.z,0.0,1.0);
    if(u.effect.w>0.5){rgb=u.overrideColor.rgb;colorAlpha=clamp(rawAlpha*copyAlpha*u.overrideColor.a*u.effect.z,0.0,1.0);}
    var pad=hwMax+radiusMax+2.5;if(u.mode==4u){pad=hwMax+2.025;}
    let tx=(v.corner.x+1.0)*0.5;let lx=mix(-pad,len+pad,tx);let ly=v.corner.y*pad;let p=start+dir*lx+n*ly;
    out.position=vec4<f32>(p.x/u.viewport.x*2.0-1.0,1.0-p.y/u.viewport.y*2.0,0.0,1.0);
    out.local=vec2<f32>(lx,ly);out.segLen=len;out.halfWidthStart=log(max(0.001,hwStart));out.halfWidthEnd=log(max(0.001,hwEnd));out.radiusMax=radiusMax;out.color=vec4<f32>(rgb,colorAlpha);return out;
}
@fragment fn fsCorridor(v:VSOut)->@location(0) vec4<f32>{
    let cx=clamp(v.local.x,0.0,v.segLen);let widthT=clamp(cx/max(0.0001,v.segLen),0.0,1.0);
    let halfWidth=max(0.001,exp(mix(v.halfWidthStart,v.halfWidthEnd,widthT)));
    let d=length(vec2<f32>(v.local.x-cx,v.local.y));var radius=v.radiusMax;
    if(u.mode==1u || u.mode==3u){radius=max(0.0,u.effect.x*((2.0*halfWidth)/max(0.001,u.effect.y)));}
    else if(u.mode==0u || u.mode==2u || (u.mode>=5u&&u.mode<=7u)){radius=max(0.1,u.effect.x);}
    var cov=0.0;
    if(u.mode==4u){let centerCoverage=min(1.0,2.0*halfWidth);cov=min(centerCoverage,clamp(halfWidth+0.5-d,0.0,1.0));}
    else if(u.mode==0u){let r=max(0.001,radius);let q=max(0.0,d-halfWidth)/r;cov=exp(-3.15*q*q)*(1.0-smoothstep(0.82,1.04,q));}
    else if(u.mode==1u){let edge=halfWidth+max(0.0,radius);let centerCoverage=min(1.0,2.0*edge);cov=min(centerCoverage,clamp(edge+0.5-d,0.0,1.0));}
    else if(u.mode==2u){let r=max(0.001,radius);let e=max(0.0,d-halfWidth);let q=e/r;cov=exp(-3.15*q*q)*(1.0-smoothstep(0.82,1.04,q))*smoothstep(0.0,min(1.0,r*0.55),e);}
    else{let edge=max(0.0,halfWidth-max(0.0,radius));let centerCoverage=min(1.0,2.0*edge);cov=min(centerCoverage,clamp(edge+0.5-d,0.0,1.0));}
    if(u.mode>=5u&&u.mode<=7u){cov=auraCoverage(v.position.xy,d,halfWidth,radius,u.effect.y,u.mode);}
    let a=clamp(v.color.a*cov,0.0,1.0);if(a<0.00015){discard;}return vec4<f32>(select(v.color.rgb,vec3<f32>(1.0),u.mode==7u)*a,a);
}`;

  const LAYER_SCENE_WGSL = `
struct SceneUniform { fillColor: vec4<f32>, flags: vec4<f32>, extra: vec4<f32> };
@group(0) @binding(0) var glowTex: texture_2d<f32>;
@group(0) @binding(1) var baseTex: texture_2d<f32>;
@group(0) @binding(2) var maskTex: texture_2d<f32>;
@group(0) @binding(3) var outlineTex: texture_2d<f32>;
@group(0) @binding(4) var coreTex: texture_2d<f32>;
@group(0) @binding(5) var sceneSampler: sampler;
@group(0) @binding(6) var<uniform> u: SceneUniform;
@group(0) @binding(7) var nativeFillTex: texture_2d<f32>;
struct SceneVSOut { @builtin(position) pos: vec4<f32>, @location(0) uv: vec2<f32> };
@vertex fn vsScene(@builtin(vertex_index) vid:u32)->SceneVSOut{
    let p=array<vec2<f32>,3>(vec2<f32>(-1.0,-1.0),vec2<f32>(3.0,-1.0),vec2<f32>(-1.0,3.0));
    let q=p[vid];var o:SceneVSOut;o.pos=vec4<f32>(q,0.0,1.0);o.uv=vec2<f32>((q.x+1.0)*0.5,(1.0-q.y)*0.5);return o;
}
fn over(src:vec4<f32>,dst:vec4<f32>)->vec4<f32>{return src+dst*(1.0-src.a);}
@fragment fn fsScene(v:SceneVSOut)->@location(0) vec4<f32>{
    var out=vec4<f32>(0.0);
    if(u.flags.w>0.5 && u.extra.y>0.5){out=textureSample(outlineTex,sceneSampler,v.uv);}
    if(u.flags.y>0.5){let cov=clamp(textureSample(maskTex,sceneSampler,v.uv).a,0.0,1.0);let a=clamp(u.fillColor.a*cov,0.0,1.0);out=over(vec4<f32>(u.fillColor.rgb*a,a),out);}
    if(u.extra.z>0.5){out=over(textureSample(nativeFillTex,sceneSampler,v.uv),out);}
    if(u.flags.x>0.5){out=over(textureSample(glowTex,sceneSampler,v.uv),out);}
    if(u.flags.z>0.5){out=over(textureSample(baseTex,sceneSampler,v.uv),out);}
    if(u.flags.w>0.5 && u.extra.y<0.5){out=over(textureSample(outlineTex,sceneSampler,v.uv),out);}
    if(u.extra.x>0.5){out=over(textureSample(coreTex,sceneSampler,v.uv),out);}
    return out;
}`;

  const CIRCLE_COMPOSITE_WGSL = `
@group(0) @binding(0) var srcTex:texture_2d<f32>;
@group(0) @binding(1) var srcSampler:sampler;
struct O{@builtin(position) pos:vec4<f32>,@location(0) uv:vec2<f32>};
@vertex fn vs(@builtin(vertex_index) i:u32)->O{
    let p=array<vec2<f32>,3>(vec2<f32>(-1.0,-1.0),vec2<f32>(3.0,-1.0),vec2<f32>(-1.0,3.0));
    let q=p[i];var o:O;o.pos=vec4<f32>(q,0.0,1.0);o.uv=vec2<f32>((q.x+1.0)*0.5,(1.0-q.y)*0.5);return o;
}
@fragment fn fs(v:O)->@location(0) vec4<f32>{return textureSample(srcTex,srcSampler,v.uv);}
`;
  const parseColor = GPUColorCache.rgba;
  function blendState(kind) {
    if (kind === 'max')
      return {
        color: { srcFactor: 'one', dstFactor: 'one', operation: 'max' },
        alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'max' },
      };
    if (kind === 'behind')
      return {
        color: { srcFactor: 'one-minus-dst-alpha', dstFactor: 'one', operation: 'add' },
        alpha: { srcFactor: 'one-minus-dst-alpha', dstFactor: 'one', operation: 'add' },
      };
    return {
      color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
    };
  }
  async function initAsync() {
    if (ready && !lost) return true;
    if (initializing) return false;
    if (attempted && !ready) return false;
    attempted = true;
    initializing = true;
    lastError = '';
    try {
      const shared = await WebGPUDeviceHub.acquire();
      adapter = shared.adapter;
      device = shared.device;
      hubGeneration = shared.generation;
      lost = false;
      context = canvas.getContext('webgpu');

      format = navigator.gpu.getPreferredCanvasFormat();
      optionalInitErrors = [];
      const module = device.createShaderModule({ label: 'SpiroStar stroke WGSL', code: WGSL });
      await assertWebGPUShaderModule(module, 'SpiroStar stroke WGSL');
      bindGroupLayout = device.createBindGroupLayout({
        entries: [
          {
            binding: 0,
            visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
            buffer: { type: 'uniform' },
          },
        ],
      });
      const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] });
      const vertexBuffers = [
        {
          arrayStride: 8,
          stepMode: 'vertex',
          attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }],
        },
        {
          arrayStride: FLOATS_PER_INSTANCE * 4,
          stepMode: 'instance',
          attributes: [
            { shaderLocation: 1, offset: 0, format: 'float32x2' },
            { shaderLocation: 2, offset: 8, format: 'float32x2' },
            { shaderLocation: 3, offset: 16, format: 'float32' },
            { shaderLocation: 4, offset: 20, format: 'float32' },
            { shaderLocation: 5, offset: 24, format: 'float32' },
            { shaderLocation: 6, offset: 28, format: 'float32x4' },
          ],
        },
      ];
      const makePipeline = (kind) =>
        device.createRenderPipelineAsync({
          label: `SpiroStar stroke ${kind}`,
          layout: pipelineLayout,
          vertex: { module, entryPoint: 'vsMain', buffers: vertexBuffers },
          fragment: { module, entryPoint: 'fsMain', targets: [{ format, blend: blendState(kind) }] },
          primitive: { topology: 'triangle-list', cullMode: 'none' },
        });
      [pipelineMax, pipelineOver] = await Promise.all([makePipeline('max'), makePipeline('over')]);

      const bezierModule = device.createShaderModule({
        label: 'Somata Smooth Spiral Bézier WGSL',
        code: BEZIER_WGSL,
      });
      await assertWebGPUShaderModule(bezierModule, 'Somata Smooth Spiral Bézier WGSL');
      bezierBindGroupLayout = device.createBindGroupLayout({
        entries: [
          {
            binding: 0,
            visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
            buffer: { type: 'uniform' },
          },
          { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
        ],
      });
      const bezierLayout = device.createPipelineLayout({ bindGroupLayouts: [bezierBindGroupLayout] });
      const bezierVertexBuffers = [
        {
          arrayStride: 8,
          stepMode: 'vertex',
          attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }],
        },
      ];
      const makeBezierPipeline = (kind) =>
        device.createRenderPipelineAsync({
          label: `Somata Smooth Spiral Bézier ${kind}`,
          layout: bezierLayout,
          vertex: { module: bezierModule, entryPoint: 'vsMain', buffers: bezierVertexBuffers },
          fragment: {
            module: bezierModule,
            entryPoint: 'fsMain',
            targets: [{ format, blend: blendState(kind) }],
          },
          primitive: { topology: 'triangle-list', cullMode: 'none' },
        });
      const makeBezierUniformPipeline = (kind) =>
        device.createRenderPipelineAsync({
          label: `Somata Uniform Spiral Bézier ${kind}`,
          layout: bezierLayout,
          vertex: { module: bezierModule, entryPoint: 'vsUniform', buffers: bezierVertexBuffers },
          fragment: {
            module: bezierModule,
            entryPoint: 'fsUniform',
            targets: [{ format, blend: blendState(kind) }],
          },
          primitive: { topology: 'triangle-list', cullMode: 'none' },
        });
      [bezierPipelineMax, bezierPipelineOver] = await Promise.all([makeBezierPipeline('max'), makeBezierPipeline('over')]);
      [bezierUniformPipelineMax, bezierUniformPipelineOver] = await Promise.all([makeBezierUniformPipeline('max'), makeBezierUniformPipeline('over')]);
      try {
        const indexedMorphModule = device.createShaderModule({
          label: 'SpiroStar indexed Morph capsule WGSL',
          code: INDEXED_MORPH_WGSL,
        });
        await assertWebGPUShaderModule(indexedMorphModule, 'SpiroStar indexed Morph capsule WGSL');
        indexedMorphBindGroupLayout = device.createBindGroupLayout({
          entries: [
            {
              binding: 0,
              visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
              buffer: { type: 'uniform' },
            },
            { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
            { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
            { binding: 3, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
            {
              binding: 4,
              visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
              buffer: { type: 'read-only-storage' },
            },
          ],
        });
        const indexedMorphLayout = device.createPipelineLayout({
          bindGroupLayouts: [indexedMorphBindGroupLayout],
        });
        const indexedMorphVertexBuffers = [
          {
            arrayStride: 8,
            stepMode: 'vertex',
            attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }],
          },
        ];
        const makeIndexedMorphPipeline = (kind) =>
          device.createRenderPipelineAsync({
            label: `SpiroStar indexed Morph capsule ${kind}`,
            layout: indexedMorphLayout,
            vertex: { module: indexedMorphModule, entryPoint: 'vsMain', buffers: indexedMorphVertexBuffers },
            fragment: {
              module: indexedMorphModule,
              entryPoint: 'fsMain',
              targets: [{ format, blend: blendState(kind) }],
            },
            primitive: { topology: 'triangle-list', cullMode: 'none' },
          });
        [indexedMorphPipelineMax, indexedMorphPipelineOver] = await Promise.all([makeIndexedMorphPipeline('max'), makeIndexedMorphPipeline('over')]);
        const indexedMorphLinearModule = device.createShaderModule({
          label: 'SpiroStar protected linear Morph WGSL',
          code: INDEXED_MORPH_LINEAR_WGSL,
        });
        await assertWebGPUShaderModule(indexedMorphLinearModule, 'SpiroStar protected linear Morph WGSL');
        indexedMorphLinearBindGroupLayout = device.createBindGroupLayout({
          entries: [
            {
              binding: 0,
              visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
              buffer: { type: 'uniform' },
            },
            { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
            { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
            { binding: 3, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
            { binding: 4, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
            {
              binding: 5,
              visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
              buffer: { type: 'read-only-storage' },
            },
            { binding: 6, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
          ],
        });
        const indexedMorphLinearLayout = device.createPipelineLayout({
          bindGroupLayouts: [indexedMorphLinearBindGroupLayout],
        });
        const makeIndexedMorphLinearPipeline = (kind) =>
          device.createRenderPipelineAsync({
            label: `SpiroStar protected linear Morph ${kind}`,
            layout: indexedMorphLinearLayout,
            vertex: {
              module: indexedMorphLinearModule,
              entryPoint: 'vsMain',
              buffers: indexedMorphVertexBuffers,
            },
            fragment: {
              module: indexedMorphLinearModule,
              entryPoint: 'fsMain',
              targets: [{ format, blend: blendState(kind) }],
            },
            primitive: { topology: 'triangle-list', cullMode: 'none' },
          });
        [indexedMorphLinearPipelineMax, indexedMorphLinearPipelineOver] = await Promise.all([makeIndexedMorphLinearPipeline('max'), makeIndexedMorphLinearPipeline('over')]);
        const indexedMorphCorridorModule = device.createShaderModule({
          label: 'SpiroStar indexed Morph Corridor WGSL',
          code: INDEXED_MORPH_CORRIDOR_WGSL,
        });
        await assertWebGPUShaderModule(indexedMorphCorridorModule, 'SpiroStar indexed Morph Corridor WGSL');
        indexedMorphCorridorBindGroupLayout = device.createBindGroupLayout({
          entries: [
            {
              binding: 0,
              visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
              buffer: { type: 'uniform' },
            },
            { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
            { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
            { binding: 3, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
            { binding: 4, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
            {
              binding: 5,
              visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
              buffer: { type: 'read-only-storage' },
            },
          ],
        });
        const indexedMorphCorridorLayout = device.createPipelineLayout({
          bindGroupLayouts: [indexedMorphCorridorBindGroupLayout],
        });
        const makeIndexedMorphCorridorPipeline = (kind) =>
          device.createRenderPipelineAsync({
            label: `SpiroStar indexed Morph Corridor ${kind}`,
            layout: indexedMorphCorridorLayout,
            vertex: {
              module: indexedMorphCorridorModule,
              entryPoint: 'vsMain',
              buffers: indexedMorphVertexBuffers,
            },
            fragment: {
              module: indexedMorphCorridorModule,
              entryPoint: 'fsMain',
              targets: [{ format, blend: blendState(kind) }],
            },
            primitive: { topology: 'triangle-list', cullMode: 'none' },
          });
        [indexedMorphCorridorPipelineMax, indexedMorphCorridorPipelineOver] = await Promise.all([makeIndexedMorphCorridorPipeline('max'), makeIndexedMorphCorridorPipeline('over')]);
      } catch (err) {
        optionalInitErrors.push(`indexed-morph: ${String(err?.message || err)}`);
        indexedMorphBindGroupLayout = null;
        indexedMorphPipelineMax = null;
        indexedMorphPipelineOver = null;
        indexedMorphLinearBindGroupLayout = null;
        indexedMorphLinearPipelineMax = null;
        indexedMorphLinearPipelineOver = null;
        indexedMorphCorridorBindGroupLayout = null;
        indexedMorphCorridorPipelineMax = null;
        indexedMorphCorridorPipelineOver = null;
      }
      try {
        const sharedJoinModule = device.createShaderModule({
          label: 'SpiroStar shared-join spiral WGSL',
          code: SHARED_JOIN_WGSL,
        });
        await assertWebGPUShaderModule(sharedJoinModule, 'SpiroStar shared-join spiral WGSL');
        sharedJoinBindGroupLayout = device.createBindGroupLayout({
          entries: [
            {
              binding: 0,
              visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
              buffer: { type: 'uniform' },
            },
            { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
            { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
            { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
          ],
        });
        const sharedJoinLayout = device.createPipelineLayout({
          bindGroupLayouts: [sharedJoinBindGroupLayout],
        });
        const sharedJoinVertexBuffers = [
          {
            arrayStride: 8,
            stepMode: 'vertex',
            attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }],
          },
        ];
        sharedJoinBodyPipeline = await device.createRenderPipelineAsync({
          label: 'SpiroStar shared-join spiral bodies',
          layout: sharedJoinLayout,
          vertex: { module: sharedJoinModule, entryPoint: 'vsBody', buffers: sharedJoinVertexBuffers },
          fragment: {
            module: sharedJoinModule,
            entryPoint: 'fsBody',
            targets: [{ format, blend: blendState('max') }],
          },
          primitive: { topology: 'triangle-list', cullMode: 'none' },
        });
        sharedJoinPointPipeline = await device.createRenderPipelineAsync({
          label: 'SpiroStar shared-join spiral knots',
          layout: sharedJoinLayout,
          vertex: { module: sharedJoinModule, entryPoint: 'vsPoint', buffers: sharedJoinVertexBuffers },
          fragment: {
            module: sharedJoinModule,
            entryPoint: 'fsPoint',
            targets: [{ format, blend: blendState('max') }],
          },
          primitive: { topology: 'triangle-list', cullMode: 'none' },
        });
      } catch (err) {
        optionalInitErrors.push(`shared-join: ${String(err?.message || err)}`);
        sharedJoinBindGroupLayout = null;
        sharedJoinBodyPipeline = null;
        sharedJoinPointPipeline = null;
      }
      const layerSceneModule = device.createShaderModule({
        label: 'SpiroStar layer scene WGSL',
        code: LAYER_SCENE_WGSL,
      });
      await assertWebGPUShaderModule(layerSceneModule, 'SpiroStar layer scene WGSL');
      layerSceneBindGroupLayout = device.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
          { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
          { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
          { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
          { binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
          { binding: 5, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
          { binding: 6, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
          { binding: 7, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        ],
      });
      const layerSceneLayout = device.createPipelineLayout({ bindGroupLayouts: [layerSceneBindGroupLayout] });
      layerScenePipeline = await device.createRenderPipelineAsync({
        label: 'SpiroStar layer scene pipeline',
        layout: layerSceneLayout,
        vertex: { module: layerSceneModule, entryPoint: 'vsScene' },
        fragment: {
          module: layerSceneModule,
          entryPoint: 'fsScene',
          targets: [{ format, blend: blendState('over') }],
        },
        primitive: { topology: 'triangle-list' },
      });
      layerSceneSampler = device.createSampler({
        magFilter: 'linear',
        minFilter: 'linear',
        addressModeU: 'clamp-to-edge',
        addressModeV: 'clamp-to-edge',
      });
      layerSceneUniformBuffer = device.createBuffer({
        size: 48,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        label: 'SpiroStar layer scene uniforms',
      });
      const circleCompositeModule = device.createShaderModule({
        label: 'SpiroStar Geometry Circles scratch composite WGSL',
        code: CIRCLE_COMPOSITE_WGSL,
      });
      await assertWebGPUShaderModule(
        circleCompositeModule,
        'SpiroStar Geometry Circles scratch composite WGSL',
      );
      circleCompositeLayout = device.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
          { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
        ],
      });
      const circleCompositePipelineLayout = device.createPipelineLayout({
        bindGroupLayouts: [circleCompositeLayout],
      });
      circleCompositePipeline = await device.createRenderPipelineAsync({
        label: 'SpiroStar Geometry Circles scratch -> Layer Scene',
        layout: circleCompositePipelineLayout,
        vertex: { module: circleCompositeModule, entryPoint: 'vs' },
        fragment: {
          module: circleCompositeModule,
          entryPoint: 'fs',
          targets: [{ format, blend: blendState('over') }],
        },
        primitive: { topology: 'triangle-list' },
      });
      frameUnderlayPipelineBehind = await device.createRenderPipelineAsync({
        label: 'SpiroStar global destination-over underlay',
        layout: circleCompositePipelineLayout,
        vertex: { module: circleCompositeModule, entryPoint: 'vs' },
        fragment: {
          module: circleCompositeModule,
          entryPoint: 'fs',
          targets: [{ format, blend: blendState('behind') }],
        },
        primitive: { topology: 'triangle-list' },
      });
      circleSampler = device.createSampler({
        magFilter: 'linear',
        minFilter: 'linear',
        addressModeU: 'clamp-to-edge',
        addressModeV: 'clamp-to-edge',
      });
      circleUniformBuffers = [];
      circleUniformBindGroups = [];
      circleUniformLastData = [];
      circleUniformHasLast = [];
      ensureCircleUniformRingCount(desiredCircleRingCount());
      circleUniformCursor = 0;
      try {
        const corridorModule = device.createShaderModule({
          label: 'SpiroStar Corridor instancing WGSL',
          code: CORRIDOR_WGSL,
        });
        await assertWebGPUShaderModule(corridorModule, 'SpiroStar Corridor instancing WGSL');
        corridorBindGroupLayout = device.createBindGroupLayout({
          entries: [
            {
              binding: 0,
              visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
              buffer: { type: 'uniform' },
            },
            { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
            { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
          ],
        });
        const corridorLayout = device.createPipelineLayout({ bindGroupLayouts: [corridorBindGroupLayout] });
        const corridorVertexBuffers = [
          {
            arrayStride: 8,
            stepMode: 'vertex',
            attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }],
          },
        ];
        const makeCorridorPipeline = (kind) =>
          device.createRenderPipelineAsync({
            label: `SpiroStar Corridor ${kind}`,
            layout: corridorLayout,
            vertex: { module: corridorModule, entryPoint: 'vsCorridor', buffers: corridorVertexBuffers },
            fragment: {
              module: corridorModule,
              entryPoint: 'fsCorridor',
              targets: [{ format, blend: blendState(kind) }],
            },
            primitive: { topology: 'triangle-list', cullMode: 'none' },
          });
        [corridorPipelineMax, corridorPipelineOver] = await Promise.all([makeCorridorPipeline('max'), makeCorridorPipeline('over')]);
        const bezierCorridorModule = device.createShaderModule({
          label: 'Somata 7.5 Bézier Corridor WGSL',
          code: BEZIER_CORRIDOR_WGSL,
        });
        await assertWebGPUShaderModule(bezierCorridorModule, 'Somata 7.5 Bézier Corridor WGSL');
        bezierCorridorBindGroupLayout = device.createBindGroupLayout({
          entries: [
            {
              binding: 0,
              visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
              buffer: { type: 'uniform' },
            },
            { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
            { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
          ],
        });
        const bezierCorridorLayout = device.createPipelineLayout({
          bindGroupLayouts: [bezierCorridorBindGroupLayout],
        });
        const makeBezierCorridorPipeline = (kind) =>
          device.createRenderPipelineAsync({
            label: `Somata 7.5 Bézier Corridor ${kind}`,
            layout: bezierCorridorLayout,
            vertex: {
              module: bezierCorridorModule,
              entryPoint: 'vsCorridor',
              buffers: corridorVertexBuffers,
            },
            fragment: {
              module: bezierCorridorModule,
              entryPoint: 'fsCorridor',
              targets: [{ format, blend: blendState(kind) }],
            },
            primitive: { topology: 'triangle-list', cullMode: 'none' },
          });
        [bezierCorridorPipelineMax, bezierCorridorPipelineOver] = await Promise.all([makeBezierCorridorPipeline('max'), makeBezierCorridorPipeline('over')]);
        corridorUniformBuffer = device.createBuffer({
          size: 48,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
          label: 'SpiroStar Corridor uniforms',
        });
        corridorDeferredUniformBuffers = Array.from({ length: 32 }, (_, i) =>
          device.createBuffer({
            size: 48,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            label: `SpiroStar Corridor deferred uniforms ${i}`,
          }),
        );
        corridorDeferredUniformCursor = 0;
      } catch (err) {
        optionalInitErrors.push(`corridor: ${String(err?.message || err)}`);
        corridorBindGroupLayout = null;
        corridorPipelineMax = null;
        corridorPipelineOver = null;
        bezierCorridorBindGroupLayout = null;
        bezierCorridorPipelineMax = null;
        bezierCorridorPipelineOver = null;
        corridorUniformBuffer = null;
      }
      cornerBuffer = device.createBuffer({
        size: 12 * 4,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        label: 'SpiroStar stroke corners',
      });
      device.queue.writeBuffer(cornerBuffer, 0, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]));
      uniformBuffer = device.createBuffer({
        size: 48,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        label: 'SpiroStar stroke uniforms',
      });
      bindGroup = device.createBindGroup({
        layout: bindGroupLayout,
        entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
      });
      for (const role of LAYER_BATCH_ROLES) {
        const surf = layerBatchSurfaces[role];
        surf.uniformBuffer = device.createBuffer({
          size: 48,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
          label: `SpiroStar layer batch uniforms ${role}`,
        });
        surf.bindGroup = device.createBindGroup({
          layout: bindGroupLayout,
          entries: [{ binding: 0, resource: { buffer: surf.uniformBuffer } }],
        });
      }
      ready = true;
      initializing = false;
      lastError = '';
      requestMainCanvasRender();
      return true;
    } catch (err) {
      ready = false;
      initializing = false;
      lastError = String(err?.message || err);
      lastInitError = lastError;
      requestMainCanvasRender();
      return false;
    }
  }
  function warmup() {
    const hubReady = WebGPUDeviceHub.warmup(),
      gen = WebGPUDeviceHub.getGeneration();
    if (ready && (!hubReady || gen !== hubGeneration)) {
      ready = false;
      attempted = false;
      initializing = false;
      lost = !hubReady;
      try {
        context?.unconfigure?.();
      } catch (error) {
        noteSuppressedError('gpu/stroke-renderer#warmup', error);
      }
      for (const b of instanceBuffers)
        try {
          b?.destroy?.();
        } catch (error) {
          noteSuppressedError('gpu/stroke-renderer#warmup', error);
        }
      instanceBuffers = [null, null, null];
      capacity = 0;
      data = null;
      for (const b of corridorCopyBuffers)
        try {
          b?.destroy?.();
        } catch (error) {
          noteSuppressedError('gpu/stroke-renderer#warmup', error);
        }
      corridorCopyBuffers = [null, null, null];
      corridorCopyCapacity = 0;
      corridorCopyData = null;
      corridorCopyGeneration++;
      for (const b of corridorDeferredUniformBuffers)
        try {
          b?.destroy?.();
        } catch (error) {
          noteSuppressedError('gpu/stroke-renderer#warmup', error);
        }
      corridorDeferredUniformBuffers = [];
      corridorDeferredUniformCursor = 0;
      strokeUniformHasLast = false;
      corridorUniformHasLast = false;
      clearCorridorResidentCopies();
      for (const b of corridorDynamicSegmentBuffers)
        try {
          b?.destroy?.();
        } catch (error) {
          noteSuppressedError('gpu/stroke-renderer#warmup', error);
        }
      corridorDynamicSegmentBuffers = [null, null, null];
      corridorDynamicSegmentCapacity = 0;
      corridorDynamicSegmentData = null;
      corridorDynamicSegmentCursor = 0;
      corridorDynamicSegmentGeneration++;
      corridorDynamicSegmentCache = new WeakMap();
      for (const rec of staticGeometryBuffers.values())
        try {
          rec?.buffer?.destroy?.();
        } catch (error) {
          noteSuppressedError('gpu/stroke-renderer#warmup', error);
        }
      staticGeometryBuffers.clear();
      for (const rec of frameResidentDynamicSlots)
        try {
          rec?.buffer?.destroy?.();
        } catch (error) {
          noteSuppressedError('gpu/stroke-renderer#warmup', error);
        }
      frameResidentDynamicSlots = [];
      frameResidentDynamicCursor = 0;
      frameResidentDynamicCache = new WeakMap();
      for (const rec of indexedMorphSlots) {
        try {
          rec?.pointBuffer?.destroy?.();
        } catch (error) {
          noteSuppressedError('gpu/stroke-renderer#warmup', error);
        }
        try {
          rec?.alphaBuffer?.destroy?.();
        } catch (error) {
          noteSuppressedError('gpu/stroke-renderer#warmup', error);
        }
        try {
          rec?.commandBuffer?.destroy?.();
        } catch (error) {
          noteSuppressedError('gpu/stroke-renderer#warmup', error);
        }
        try {
          rec?.linearSourceBuffer?.destroy?.();
        } catch (error) {
          noteSuppressedError('gpu/stroke-renderer#warmup', error);
        }
        try {
          rec?.linearTargetBuffer?.destroy?.();
        } catch (error) {
          noteSuppressedError('gpu/stroke-renderer#warmup', error);
        }
      }
      indexedMorphSlots = [];
      indexedMorphCursor = 0;
      indexedMorphFrameCache = new WeakMap();
      indexedMorphResidentCache = new WeakMap();
      indexedMorphResidentRecords.clear();
      for (const topo of indexedMorphTopologyRecords)
        try {
          topo?.buffer?.destroy?.();
        } catch (error) {
          noteSuppressedError('gpu/stroke-renderer#warmup', error);
        }
      indexedMorphTopologyRecords.clear();
      for (const topo of indexedMorphRetiredTopologies)
        try {
          topo?.record?.buffer?.destroy?.();
        } catch (error) {
          noteSuppressedError('gpu/stroke-renderer#warmup', error);
        }
      indexedMorphRetiredTopologies = [];
      indexedMorphTopologyCache = new WeakMap();
      indexedMorphBindGroupLayout = null;
      indexedMorphPipelineMax = null;
      indexedMorphPipelineOver = null;
      indexedMorphLinearBindGroupLayout = null;
      indexedMorphLinearPipelineMax = null;
      indexedMorphLinearPipelineOver = null;
      indexedMorphCorridorBindGroupLayout = null;
      indexedMorphCorridorPipelineMax = null;
      indexedMorphCorridorPipelineOver = null;
      for (const rec of sharedJoinStaticBuffers.values()) {
        try {
          rec?.pointBuffer?.destroy?.();
        } catch (error) {
          noteSuppressedError('gpu/stroke-renderer#warmup', error);
        }
        try {
          rec?.segmentBuffer?.destroy?.();
        } catch (error) {
          noteSuppressedError('gpu/stroke-renderer#warmup', error);
        }
        try {
          rec?.styleBuffer?.destroy?.();
        } catch (error) {
          noteSuppressedError('gpu/stroke-renderer#warmup', error);
        }
      }
      sharedJoinStaticBuffers.clear();
      for (const rec of sharedJoinDynamicSlots) {
        try {
          rec?.pointBuffer?.destroy?.();
        } catch (error) {
          noteSuppressedError('gpu/stroke-renderer#warmup', error);
        }
        try {
          rec?.segmentBuffer?.destroy?.();
        } catch (error) {
          noteSuppressedError('gpu/stroke-renderer#warmup', error);
        }
        try {
          rec?.styleBuffer?.destroy?.();
        } catch (error) {
          noteSuppressedError('gpu/stroke-renderer#warmup', error);
        }
      }
      sharedJoinDynamicSlots = [];
      sharedJoinDynamicCursor = 0;
      sharedJoinBindGroupLayout = null;
      sharedJoinBodyPipeline = null;
      sharedJoinPointPipeline = null;
      for (const rec of bezierBufferRecords)
        try {
          rec?.buffer?.destroy?.();
        } catch (error) {
          noteSuppressedError('gpu/stroke-renderer#warmup', error);
        }
      bezierBufferRecords.clear();
      bezierGeometryCache = new WeakMap();
      bezierBindGroupLayout = null;
      bezierPipelineMax = null;
      bezierPipelineOver = null;
      bezierUniformPipelineMax = null;
      bezierUniformPipelineOver = null;
      bezierCorridorBindGroupLayout = null;
      bezierCorridorPipelineMax = null;
      bezierCorridorPipelineOver = null;
      for (const rec of corridorSegmentBuffers.values())
        try {
          rec?.buffer?.destroy?.();
        } catch (error) {
          noteSuppressedError('gpu/stroke-renderer#warmup', error);
        }
      corridorSegmentBuffers.clear();
      for (const role of LAYER_BATCH_ROLES) {
        const surf = layerBatchSurfaces[role];
        try {
          surf.uniformBuffer?.destroy?.();
        } catch (error) {
          noteSuppressedError('gpu/stroke-renderer#warmup', error);
        }
        surf.texture?.destroy?.();
        try {
          surf.fallbackContext?.unconfigure?.();
        } catch (error) {
          noteSuppressedError('gpu/stroke-renderer#warmup', error);
        }
        surf.texture = null;
        surf.view = null;
        surf.underlayBindGroup = null;
        surf.underlayBundle = null;
        surf.underlayBundleList.length = 0;
        surf.fallbackCanvas = null;
        surf.fallbackContext = null;
        surf.fallbackWidth = 0;
        surf.fallbackHeight = 0;
        surf.uniformBuffer = null;
        surf.bindGroup = null;
        surf.hasLastData = false;
      }
      clearLayerSceneResidentFillMasks();
      try {
        layerSceneUniformBuffer?.destroy?.();
      } catch (error) {
        noteSuppressedError('gpu/stroke-renderer#warmup', error);
      }
      try {
        layerSceneMaskTexture?.destroy?.();
      } catch (error) {
        noteSuppressedError('gpu/stroke-renderer#warmup', error);
      }
      try {
        layerSceneNativeFillTexture?.destroy?.();
      } catch (error) {
        noteSuppressedError('gpu/stroke-renderer#warmup', error);
      }
      try {
        layerSceneTexture?.destroy?.();
      } catch (error) {
        noteSuppressedError('gpu/stroke-renderer#warmup', error);
      }
      try {
        layerSceneFallbackSurface.context?.unconfigure?.();
      } catch (error) {
        noteSuppressedError('gpu/stroke-renderer#warmup', error);
      }
      layerSceneFallbackSurface.canvas = null;
      layerSceneFallbackSurface.context = null;
      layerSceneFallbackSurface.width = 0;
      layerSceneFallbackSurface.height = 0;
      layerSceneTexture = null;
      layerSceneView = null;
      layerSceneUniformBuffer = null;
      layerSceneMaskTexture = null;
      layerSceneMaskView = null;
      layerSceneNativeFillTexture = null;
      layerSceneNativeFillView = null;
      layerScenePipeline = null;
      layerSceneSampler = null;
      layerSceneBindGroupLayout = null;
      layerSceneBindGroupCache = new Map();
      layerSceneUniformHasLast = false;
      clearLayerSceneUniformRecords();
      deferredLayerScene = null;
      try {
        circleScratchTexture?.destroy?.();
      } catch (error) {
        noteSuppressedError('gpu/stroke-renderer#warmup', error);
      }
      circleScratchTexture = null;
      circleScratchView = null;
      circleCompositeBindGroup = null;
      circleCompositePipeline = null;
      circleCompositeLayout = null;
      circleSampler = null;
      try {
        frameUnderlayTexture?.destroy?.();
      } catch (error) {
        noteSuppressedError('gpu/stroke-renderer#warmup', error);
      }
      frameUnderlayTexture = null;
      frameUnderlayView = null;
      frameUnderlayPipelineBehind = null;
      frameUnderlayFrameId = 0;
      frameUnderlayActive = false;
      frameUnderlayDisabledFrameId = 0;
      frameUnderlayClearCommand = null;
      frameUnderlayPendingCommands.length = 0;
      frameUnderlayPendingFrameId = 0;
      try {
        frameSceneTexture?.destroy?.();
      } catch (error) {
        noteSuppressedError('gpu/stroke-renderer#warmup', error);
      }
      frameSceneTexture = null;
      frameSceneView = null;
      frameSceneLayerBindGroup = null;
      frameSceneCompositeBundle = null;
      frameSceneCompositeBundleList.length = 0;
      circleCompositeBundle = null;
      circleCompositeBundleList.length = 0;
      frameSceneFrameId = 0;
      frameSceneActive = false;
      frameSceneDisabledFrameId = 0;
      frameSceneClearCommand = null;
      frameScenePendingCommands.length = 0;
      frameScenePendingFrameId = 0;
      frameSceneSealedLayers = 0;
      for (const b of circleInstanceBuffers)
        try {
          b?.destroy?.();
        } catch (error) {
          noteSuppressedError('gpu/stroke-renderer#warmup', error);
        }
      circleInstanceBuffers = [];
      circleCapacity = 0;
      circleData = null;
      circleCursor = 0;
      for (const b of circleUniformBuffers)
        try {
          b?.destroy?.();
        } catch (error) {
          noteSuppressedError('gpu/stroke-renderer#warmup', error);
        }
      circleUniformBuffers = [];
      circleUniformBindGroups = [];
      circleUniformLastData = [];
      circleUniformHasLast = [];
      circleUniformCursor = 0;
      layerBatchWidth = 0;
      layerBatchHeight = 0;
      layerSceneWidth = 0;
      layerSceneHeight = 0;
    }
    if (!ready && !initializing && (!attempted || lost)) void initAsync();
    return ready && !lost && hubReady;
  }

  function retry() {
    if (ready && !lost) return true;
    if (initializing) return false;
    attempted = false;
    lost = false;
    retryCount++;
    void initAsync();
    return false;
  }
  function ensureSize(w, h) {
    if (!ready || lost || !device || !context) return false;
    w = Math.max(1, Math.floor(w));
    h = Math.max(1, Math.floor(h));
    if (width === w && height === h && canvas.width === w && canvas.height === h) return true;
    canvas.width = w;
    canvas.height = h;
    width = w;
    height = h;
    context.configure({ device, format, alphaMode: 'premultiplied' });
    return true;
  }
  function ensureCapacity(count) {
    const desired = performanceGovernor.stickyRingCount(3, instanceBuffers.length),
      grow = count > capacity || !data || instanceBuffers.some((x) => !x),
      usage = GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST;
    if (grow) {
      capacity = performanceGovernor.capacityFor(count, capacity, 256, 1.6);
      data = new Float32Array(capacity * FLOATS_PER_INSTANCE);
      for (const b of instanceBuffers) if (b) WebGPUBufferRecycler.recycle(device, hubGeneration, b);
      instanceBuffers = [];
    }
    while (instanceBuffers.length < desired)
      instanceBuffers.push(
        WebGPUBufferRecycler.acquire(
          device,
          hubGeneration,
          capacity * FLOATS_PER_INSTANCE * 4,
          usage,
          `SpiroStar stroke instances ${instanceBuffers.length}`,
        ),
      );
  }
  function fillStrokeUniformArray(out, mode, opt = null) {
    const viewportW = Math.max(1, Number(mainCanvas?.width) || Number(layerBatchWidth) || Number(width) || 1);
    const viewportH = Math.max(
      1,
      Number(mainCanvas?.height) || Number(layerBatchHeight) || Number(height) || 1,
    );
    out.fill(0);
    out[0] = viewportW;
    out[1] = viewportH;
    out[2] = mode;
    if (opt?.reuseStatic === true) {
      out[3] = 1;
      out[4] = Math.max(0, Number(opt.effectParam) || 0);
      out[5] = Math.max(0.001, Number(opt.baseLineWidth) || 1);
      const a = Number(opt.alphaScale);
      out[6] = Math.max(0, Number.isFinite(a) ? a : 1);
      if (opt.overrideColor) {
        const c = parseColor(opt.overrideColor);
        out[7] = 1;
        out[8] = c[0];
        out[9] = c[1];
        out[10] = c[2];
        out[11] = c[3];
      }
    } else out[6] = 1;
    return out;
  }
  function writeStrokeUniforms(mode, opt = null) {
    fillStrokeUniformArray(uniformData, mode, opt);
    if (strokeUniformHasLast && sameF32Data(uniformData, strokeUniformLast, 12)) {
      strokeUniformUploadSkips++;
      return false;
    }
    device.queue.writeBuffer(uniformBuffer, 0, uniformData.buffer, uniformData.byteOffset, 48);
    strokeUniformLast.set(uniformData.subarray(0, 12));
    strokeUniformHasLast = true;
    strokeUniformUploads++;
    strokeUniformUploadBytes += 48;
    return true;
  }
  function sameF32Data(a, b, count) {
    for (let i = 0; i < count; i++) if (a[i] !== b[i]) return false;
    return true;
  }
  function sameU32Data(a, b, count) {
    for (let i = 0; i < count; i++) if (a[i] !== b[i]) return false;
    return true;
  }
  function writeCorridorUniforms() {
    if (corridorUniformHasLast && sameU32Data(corridorUniformU32, corridorUniformLastU32, 12)) {
      corridorUniformUploadSkips++;
      return false;
    }
    device.queue.writeBuffer(
      corridorUniformBuffer,
      0,
      corridorUniformU32.buffer,
      corridorUniformU32.byteOffset,
      48,
    );
    corridorUniformLastU32.set(corridorUniformU32);
    corridorUniformHasLast = true;
    corridorUniformUploads++;
    corridorUniformUploadBytes += 48;
    return true;
  }
  function acquireDeferredCorridorUniform() {
    if (!corridorDeferredUniformBuffers.length) return null;
    const slot = corridorDeferredUniformCursor++ % corridorDeferredUniformBuffers.length,
      buffer = corridorDeferredUniformBuffers[slot];
    device.queue.writeBuffer(buffer, 0, corridorUniformU32.buffer, corridorUniformU32.byteOffset, 48);
    corridorUniformUploads++;
    corridorUniformUploadBytes += 48;
    return { buffer, slot };
  }
  function getLayerBatchUniformRecord(surf, layerKey) {
    // Command encoding does not snapshot uniform contents. A later queue
    // write must not change an earlier deferred layer's opacity or style.
    if (!layerKey) return surf;
    const rec = getLayerSceneUniformRecord(`stroke-role:${layerKey}:${surf.role}`);
    if (!rec.bindGroup) {
      rec.uniformBuffer = rec.buffer;
      rec.data = new Float32Array(12);
      rec.hasLastData = false;
      rec.bindGroup = device.createBindGroup({
        layout: bindGroupLayout,
        entries: [{ binding: 0, resource: { buffer: rec.buffer } }],
      });
    }
    return rec;
  }
  function writeLayerBatchUniform(surf, mode, effectOpt) {
    fillStrokeUniformArray(surf.data, mode, effectOpt);
    if (surf.hasLastData && sameF32Data(surf.data, surf.lastData, 12)) {
      layerBatchUniformUploadSkips++;
      return false;
    }
    device.queue.writeBuffer(surf.uniformBuffer, 0, surf.data);
    surf.lastData.set(surf.data);
    surf.hasLastData = true;
    layerBatchUniformUploads++;
    layerBatchUniformUploadBytes += surf.data.byteLength;
    return true;
  }
  function writeLayerSceneUniform() {
    if (layerSceneUniformHasLast && sameF32Data(layerSceneUniform, layerSceneUniformLast, 12)) {
      layerSceneUniformUploadSkips++;
      return false;
    }
    device.queue.writeBuffer(layerSceneUniformBuffer, 0, layerSceneUniform);
    layerSceneUniformLast.set(layerSceneUniform);
    layerSceneUniformHasLast = true;
    layerSceneUniformUploads++;
    return true;
  }
  function clearLayerSceneUniformRecords() {
    for (const rec of layerSceneUniformRecords.values())
      try {
        rec?.buffer?.destroy?.();
      } catch (error) {
        noteSuppressedError('gpu/stroke-renderer#clearLayerSceneUniformRecords', error);
      }
    layerSceneUniformRecords.clear();
  }
  function getLayerSceneUniformRecord(key) {
    const id = String(key || '');
    if (!id) return null;
    const frameId = Math.max(1, Number(renderRuntime?.frameId) || 1);
    let rec = layerSceneUniformRecords.get(id);
    if (!rec || rec.generation !== hubGeneration || !rec.buffer) {
      if (rec)
        try {
          rec.buffer?.destroy?.();
        } catch (error) {
          noteSuppressedError('gpu/stroke-renderer#getLayerSceneUniformRecord', error);
        }
      rec = {
        id: ++layerSceneUniformSerial,
        key: id,
        buffer: device.createBuffer({
          size: 48,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
          label: `SpiroStar Layer Scene uniform ${id}`,
        }),
        lastData: new Float32Array(12),
        hasLast: false,
        generation: hubGeneration,
        lastUsedFrame: frameId,
      };
      layerSceneUniformRecords.set(id, rec);
      layerSceneUniformRecordBuilds++;
    } else layerSceneUniformRecordHits++;
    rec.lastUsedFrame = frameId;
    // The logical key contains the Orange-authored layer ID. Release old
    // uniforms and their cached bind groups after their frame window.
    if (layerSceneUniformRecords.size > 32) {
      const old = [...layerSceneUniformRecords.entries()].sort(
        (a, b) => a[1].lastUsedFrame - b[1].lastUsedFrame,
      );
      for (const [oldKey, oldRec] of old) {
        if (layerSceneUniformRecords.size <= 32) break;
        if (frameId - (Number(oldRec.lastUsedFrame) || 0) <= 8) continue;
        for (const bindKey of layerSceneBindGroupCache.keys()) {
          if (bindKey.startsWith(`u${oldRec.id}|`)) layerSceneBindGroupCache.delete(bindKey);
        }
        try {
          oldRec.buffer?.destroy?.();
        } catch (error) {
          noteSuppressedError('gpu/stroke-renderer#getLayerSceneUniformRecord', error);
        }
        layerSceneUniformRecords.delete(oldKey);
      }
    }
    return rec;
  }
  function writeLayerSceneUniformRecord(key) {
    const rec = getLayerSceneUniformRecord(key);
    if (!rec) {
      writeLayerSceneUniform();
      return { buffer: layerSceneUniformBuffer, id: 0, shared: true };
    }
    if (rec.hasLast && sameF32Data(layerSceneUniform, rec.lastData, 12)) {
      layerSceneUniformUploadSkips++;
      layerSceneUniformRecordUploadSkips++;
      return rec;
    }
    device.queue.writeBuffer(rec.buffer, 0, layerSceneUniform);
    rec.lastData.set(layerSceneUniform);
    rec.hasLast = true;
    layerSceneUniformUploads++;
    layerSceneUniformRecordUploads++;
    return rec;
  }
  function ensureLayerBatchSize(w, h) {
    if (!ready || lost || !device) return false;
    w = Math.max(1, Math.floor(w));
    h = Math.max(1, Math.floor(h));
    width = w;
    height = h;
    if (
      layerBatchWidth === w &&
      layerBatchHeight === h &&
      layerSceneWidth === w &&
      layerSceneHeight === h &&
      layerSceneMaskTexture &&
      layerSceneNativeFillTexture &&
      layerSceneTexture &&
      circleScratchTexture &&
      frameUnderlayTexture &&
      frameSceneTexture &&
      LAYER_BATCH_ROLES.every((role) => Boolean(layerBatchSurfaces[role]?.texture))
    )
      return true;
    layerBatchWidth = w;
    layerBatchHeight = h;
    layerSceneWidth = w;
    layerSceneHeight = h;
    const roleUsage =
      GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC;
    for (const role of LAYER_BATCH_ROLES) {
      const surf = layerBatchSurfaces[role];
      surf.texture?.destroy?.();
      surf.texture = device.createTexture({
        label: `SpiroStar offscreen layer batch ${role}`,
        size: [w, h, 1],
        format,
        usage: roleUsage,
      });
      surf.view = surf.texture.createView();
      surf.underlayBindGroup = null;
      surf.underlayBundle = null;
      surf.underlayBundleList.length = 0;
      surf.hasLastData = false;
      layerSceneTextureViewBuilds++;
    }
    clearLayerSceneResidentFillMasks();
    try {
      layerSceneMaskTexture?.destroy?.();
    } catch (error) {
      noteSuppressedError('gpu/stroke-renderer#ensureLayerBatchSize', error);
    }
    try {
      layerSceneNativeFillTexture?.destroy?.();
    } catch (error) {
      noteSuppressedError('gpu/stroke-renderer#ensureLayerBatchSize', error);
    }
    try {
      layerSceneTexture?.destroy?.();
    } catch (error) {
      noteSuppressedError('gpu/stroke-renderer#ensureLayerBatchSize', error);
    }
    try {
      circleScratchTexture?.destroy?.();
    } catch (error) {
      noteSuppressedError('gpu/stroke-renderer#ensureLayerBatchSize', error);
    }
    try {
      frameUnderlayTexture?.destroy?.();
    } catch (error) {
      noteSuppressedError('gpu/stroke-renderer#ensureLayerBatchSize', error);
    }
    try {
      frameSceneTexture?.destroy?.();
    } catch (error) {
      noteSuppressedError('gpu/stroke-renderer#ensureLayerBatchSize', error);
    }
    layerSceneMaskTexture = device.createTexture({
      label: 'SpiroStar layer scene fill mask',
      size: [w, h, 1],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    layerSceneMaskView = layerSceneMaskTexture.createView();
    layerSceneNativeFillTexture = device.createTexture({
      label: 'SpiroStar layer scene native fill',
      size: [w, h, 1],
      format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    layerSceneNativeFillView = layerSceneNativeFillTexture.createView();
    layerSceneTexture = device.createTexture({
      label: 'SpiroStar offscreen layer scene',
      size: [w, h, 1],
      format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
    });
    layerSceneView = layerSceneTexture.createView();
    circleScratchTexture = device.createTexture({
      label: 'SpiroStar Geometry Circles MAX scratch',
      size: [w, h, 1],
      format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    circleScratchView = circleScratchTexture.createView();
    circleCompositeBindGroup = device.createBindGroup({
      layout: circleCompositeLayout,
      entries: [
        { binding: 0, resource: circleScratchView },
        { binding: 1, resource: circleSampler },
      ],
    });
    circleBindGroupBuilds++;
    circleCompositeBundle = buildFullscreenBundle(
      circleCompositePipeline,
      circleCompositeBindGroup,
      'SpiroStar Geometry Circles composite bundle',
    );
    circleCompositeBundleList.length = 0;
    if (circleCompositeBundle) circleCompositeBundleList[0] = circleCompositeBundle;
    frameUnderlayTexture = device.createTexture({
      label: 'SpiroStar global destination-over underlay',
      size: [w, h, 1],
      format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
    });
    frameUnderlayView = frameUnderlayTexture.createView();
    frameSceneTexture = device.createTexture({
      label: 'SpiroStar global GPU frame scene',
      size: [w, h, 1],
      format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
    });
    frameSceneView = frameSceneTexture.createView();
    frameSceneLayerBindGroup = device.createBindGroup({
      layout: circleCompositeLayout,
      entries: [
        { binding: 0, resource: layerSceneView },
        { binding: 1, resource: circleSampler },
      ],
    });
    frameSceneCompositeBundle = buildFullscreenBundle(
      circleCompositePipeline,
      frameSceneLayerBindGroup,
      'SpiroStar Layer Scene -> frame scene bundle',
    );
    frameSceneCompositeBundleList.length = 0;
    if (frameSceneCompositeBundle) frameSceneCompositeBundleList[0] = frameSceneCompositeBundle;
    layerSceneTextureViewBuilds += 5;
    layerSceneBindGroupCache = new Map();
    layerSceneUniformHasLast = false;
    clearLayerSceneUniformRecords();
    frameUnderlayActive = false;
    frameUnderlayFrameId = 0;
    frameUnderlayDisabledFrameId = 0;
    frameUnderlayClearCommand = null;
    frameUnderlayPendingCommands = [];
    frameUnderlayPendingFrameId = 0;
    frameSceneActive = false;
    frameSceneFrameId = 0;
    frameSceneDisabledFrameId = 0;
    frameSceneClearCommand = null;
    frameScenePendingCommands = [];
    frameScenePendingFrameId = 0;
    frameSceneSealedLayers = 0;
    return true;
  }
  function ensureLayerBatchFallbackSurface(role) {
    const surf = layerBatchSurfaces[role],
      w = layerBatchWidth | 0,
      h = layerBatchHeight | 0;
    if (!surf || !w || !h || !device) return false;
    if (!surf.fallbackCanvas) {
      surf.fallbackCanvas = document.createElement('canvas');
      surf.fallbackContext = surf.fallbackCanvas.getContext('webgpu');
      if (!surf.fallbackContext) throw new Error(`WebGPU layer-batch fallback context недоступен: ${role}`);
    }
    if (surf.fallbackWidth !== w || surf.fallbackHeight !== h) {
      surf.fallbackWidth = w;
      surf.fallbackHeight = h;
      surf.fallbackCanvas.width = w;
      surf.fallbackCanvas.height = h;
      surf.fallbackContext.configure({
        device,
        format,
        alphaMode: 'premultiplied',
        usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
      });
    }
    return true;
  }
  function ensureLayerSceneFallbackSurface() {
    const w = layerSceneWidth | 0,
      h = layerSceneHeight | 0;
    if (!w || !h || !device) return false;
    let surf = layerSceneFallbackSurface;
    if (!surf.canvas) {
      surf.canvas = document.createElement('canvas');
      surf.context = surf.canvas.getContext('webgpu');
      if (!surf.context) throw new Error('WebGPU layer-scene fallback context недоступен');
    }
    if (surf.width !== w || surf.height !== h) {
      surf.width = w;
      surf.height = h;
      surf.canvas.width = w;
      surf.canvas.height = h;
      surf.context.configure({
        device,
        format,
        alphaMode: 'premultiplied',
        usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
      });
    }
    return true;
  }
  function inspectSharedJoinEligibility(commands) {
    if (!commands || typeof commands !== 'object') return null;
    const cached = sharedJoinEligibilityCache.get(commands);
    if (cached !== undefined) return cached;
    sharedJoinEligibilityChecks++;
    let style = null,
      pointCount = 0,
      segmentCount = 0,
      ok = true;
    for (const cmd of commands || []) {
      if (cmd?.__variableWidthSpiral !== true) {
        ok = false;
        break;
      }
      const s = String(cmd.strokeStyle || '#ffffff');
      if (style === null) style = s;
      else if (s !== style) {
        ok = false;
        break;
      }
      if (cmd?.lineCap && cmd.lineCap !== 'round') {
        ok = false;
        break;
      }
      if (cmd?.lineJoin && cmd.lineJoin !== 'round') {
        ok = false;
        break;
      }
      for (const sp of cmd.subpaths || []) {
        if (sp?.closed === true) {
          ok = false;
          break;
        }
        const pts = sp?.points || [];
        if (pts.length < 2) {
          continue;
        }
        pointCount += pts.length;
        for (let i = 0; i < pts.length - 1; i++) {
          const a = pts[i],
            b = pts[i + 1];
          if (
            !isFiniteGeometryPoint(a) ||
            !isFiniteGeometryPoint(b) ||
            !Number.isFinite(Number(a?.widthScale)) ||
            !Number.isFinite(Number(b?.widthScale))
          ) {
            ok = false;
            break;
          }
          if (Math.hypot(Number(b.x) - Number(a.x), Number(b.y) - Number(a.y)) > 1e-6) segmentCount++;
        }
        if (!ok) break;
      }
      if (!ok) break;
    }
    const topo = ok ? getCommandSegmentMeta(commands) : null;
    if (topo) GeometryKernel.strokeSegments(commands, 'sharedJoinInspect');
    if (!ok || !pointCount || !segmentCount || topo?.continuityRisk) {
      sharedJoinEligibilityRejects++;
      sharedJoinEligibilityCache.set(commands, null);
      return null;
    }

    segmentCount = topo.count;
    const result = { pointCount, segmentCount, style: style || '#ffffff' };
    sharedJoinEligibilityHits++;
    sharedJoinEligibilityCache.set(commands, result);
    return result;
  }
  function packSharedJoinGeometry(commands, pointOut, segmentOut) {
    let pCount = 0,
      sCount = 0;
    for (const cmd of commands || []) {
      const hwBase = Math.max(0.001, (Number(cmd.screenLineWidth) || 1) * 0.5),
        cmdAlpha = Math.max(0, Math.min(1, Number(cmd.alpha) || 0));
      for (const sp of cmd.subpaths || []) {
        const pts = sp.points || [];
        if (pts.length < 2) continue;
        const segAlpha =
          Array.isArray(sp.segmentAlphas) || ArrayBuffer.isView(sp.segmentAlphas) ? sp.segmentAlphas : null;
        const base = pCount,
          visibleSegAlpha = new Float32Array(Math.max(0, pts.length - 1)),
          segAngle = new Float32Array(Math.max(0, pts.length - 1));
        for (let i = 0; i < pts.length - 1; i++) {
          const a = pts[i],
            b = pts[i + 1],
            dx = Number(b.x) - Number(a.x),
            dy = Number(b.y) - Number(a.y),
            len = Math.hypot(dx, dy);
          const raw =
            segAlpha && Number.isFinite(Number(segAlpha[i]))
              ? Math.max(0, Math.min(1, Number(segAlpha[i])))
              : cmdAlpha;
          visibleSegAlpha[i] = len > 1e-6 ? raw : 0;
          segAngle[i] = len > 1e-6 ? Math.atan2(dy, dx) : 0;
        }
        for (let i = 0; i < pts.length; i++) {
          const p = pts[i],
            wa = Math.max(0.02, Number(p?.widthScale) || 1),
            hasPrev = i > 0 && visibleSegAlpha[i - 1] > 0.0001,
            hasNext = i < visibleSegAlpha.length && visibleSegAlpha[i] > 0.0001;
          const flags = (hasPrev ? 1 : 0) + (hasNext ? 2 : 0),
            o = pCount * 8;
          pointOut[o] = Number(p.x);
          pointOut[o + 1] = Number(p.y);
          pointOut[o + 2] = hwBase * wa;
          pointOut[o + 3] = flags;
          pointOut[o + 4] = hasPrev ? segAngle[i - 1] : 0;
          pointOut[o + 5] = hasNext ? segAngle[i] : 0;
          pointOut[o + 6] = hasPrev ? visibleSegAlpha[i - 1] : 0;
          pointOut[o + 7] = hasNext ? visibleSegAlpha[i] : 0;
          pCount++;
        }
        for (let i = 0; i < visibleSegAlpha.length; i++) {
          const sa = visibleSegAlpha[i];
          if (sa <= 0.0001) continue;
          const so = sCount * 2;
          segmentOut[so] = base + i;
          segmentOut[so + 1] = sa;
          sCount++;
        }
      }
    }
    return { pointCount: pCount, segmentCount: sCount };
  }
  function touchSharedJoinStatic(commands, rec) {
    sharedJoinStaticBuffers.delete(commands);
    sharedJoinStaticBuffers.set(commands, rec);
    return rec;
  }
  function getSharedJoinStaticRecord(commands) {
    const eligibility = inspectSharedJoinEligibility(commands);
    if (!eligibility) return null;
    let rec = sharedJoinStaticBuffers.get(commands);
    if (rec && rec.generation === hubGeneration && rec.pointBuffer && rec.segmentBuffer) {
      sharedJoinStaticHits++;
      return touchSharedJoinStatic(commands, rec);
    }
    if (rec) {
      try {
        rec.pointBuffer?.destroy?.();
      } catch (error) {
        noteSuppressedError('gpu/stroke-renderer#getSharedJoinStaticRecord', error);
      }
      try {
        rec.segmentBuffer?.destroy?.();
      } catch (error) {
        noteSuppressedError('gpu/stroke-renderer#getSharedJoinStaticRecord', error);
      }
      try {
        rec.styleBuffer?.destroy?.();
      } catch (error) {
        noteSuppressedError('gpu/stroke-renderer#getSharedJoinStaticRecord', error);
      }
      sharedJoinStaticBuffers.delete(commands);
    }
    const pData = new Float32Array(eligibility.pointCount * 8),
      sData = new Float32Array(eligibility.segmentCount * 2),
      packed = packSharedJoinGeometry(commands, pData, sData);
    if (!packed.pointCount || !packed.segmentCount) return null;
    const pointBuffer = device.createBuffer({
      size: Math.max(32, packed.pointCount * 8 * 4),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      label: 'SpiroStar shared-join spiral points',
    });
    const segmentBuffer = device.createBuffer({
      size: Math.max(8, packed.segmentCount * 2 * 4),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      label: 'SpiroStar shared-join spiral segments',
    });
    const styleBuffer = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      label: 'SpiroStar shared-join spiral style',
    });
    const rgba = parseColor(eligibility.style);
    device.queue.writeBuffer(pointBuffer, 0, pData.buffer, 0, packed.pointCount * 8 * 4);
    device.queue.writeBuffer(segmentBuffer, 0, sData.buffer, 0, packed.segmentCount * 2 * 4);
    device.queue.writeBuffer(styleBuffer, 0, new Float32Array(rgba));
    sharedJoinUploadBytes += packed.pointCount * 8 * 4 + packed.segmentCount * 2 * 4 + 16;
    sharedJoinStaticBuilds++;
    rec = {
      pointBuffer,
      segmentBuffer,
      styleBuffer,
      pointCount: packed.pointCount,
      segmentCount: packed.segmentCount,
      generation: hubGeneration,
      bindGroups: new Map(),
    };
    touchSharedJoinStatic(commands, rec);
    while (sharedJoinStaticBuffers.size > sharedJoinStaticLimit()) {
      const first = sharedJoinStaticBuffers.keys().next().value,
        old = sharedJoinStaticBuffers.get(first);
      try {
        old?.pointBuffer?.destroy?.();
      } catch (error) {
        noteSuppressedError('gpu/stroke-renderer#getSharedJoinStaticRecord', error);
      }
      try {
        old?.segmentBuffer?.destroy?.();
      } catch (error) {
        noteSuppressedError('gpu/stroke-renderer#getSharedJoinStaticRecord', error);
      }
      try {
        old?.styleBuffer?.destroy?.();
      } catch (error) {
        noteSuppressedError('gpu/stroke-renderer#getSharedJoinStaticRecord', error);
      }
      sharedJoinStaticBuffers.delete(first);
      sharedJoinStaticEvictions++;
    }
    return rec;
  }
  function currentSharedJoinFrameId() {
    return Math.max(1, Number(renderRuntime?.frameId) || Number(frameGeometryRuntime?.frameId) || 1);
  }
  function ensureSharedJoinDynamicSlot(index, pointCount, segmentCount) {
    let rec = sharedJoinDynamicSlots[index];
    const needPoints = Math.max(2, pointCount),
      needSegments = Math.max(1, segmentCount);
    if (!rec) {
      rec = {
        pointCapacity: 0,
        segmentCapacity: 0,
        pointBuffer: null,
        segmentBuffer: null,
        styleBuffer: null,
        bindGroups: new Map(),
        generation: hubGeneration,
        slot: index,
        lastFrameId: 0,
      };
      sharedJoinDynamicSlots[index] = rec;
    }
    if (rec.generation !== hubGeneration) {
      try {
        rec.pointBuffer?.destroy?.();
      } catch (error) {
        noteSuppressedError('gpu/stroke-renderer#ensureSharedJoinDynamicSlot', error);
      }
      try {
        rec.segmentBuffer?.destroy?.();
      } catch (error) {
        noteSuppressedError('gpu/stroke-renderer#ensureSharedJoinDynamicSlot', error);
      }
      try {
        rec.styleBuffer?.destroy?.();
      } catch (error) {
        noteSuppressedError('gpu/stroke-renderer#ensureSharedJoinDynamicSlot', error);
      }
      rec.pointBuffer = rec.segmentBuffer = rec.styleBuffer = null;
      rec.pointCapacity = rec.segmentCapacity = 0;
      rec.bindGroups = new Map();
      rec.generation = hubGeneration;
    }
    if (needPoints > rec.pointCapacity || !rec.pointBuffer) {
      rec.pointCapacity = performanceGovernor.capacityFor(needPoints, rec.pointCapacity, 128, 1.6);
      try {
        rec.pointBuffer?.destroy?.();
      } catch (error) {
        noteSuppressedError('gpu/stroke-renderer#ensureSharedJoinDynamicSlot', error);
      }
      rec.pointBuffer = device.createBuffer({
        size: rec.pointCapacity * 8 * 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        label: `SpiroStar dynamic shared-join points ${index}`,
      });
      rec.bindGroups = new Map();
      sharedJoinDynamicSlotGrows++;
    }
    if (needSegments > rec.segmentCapacity || !rec.segmentBuffer) {
      rec.segmentCapacity = performanceGovernor.capacityFor(needSegments, rec.segmentCapacity, 128, 1.6);
      try {
        rec.segmentBuffer?.destroy?.();
      } catch (error) {
        noteSuppressedError('gpu/stroke-renderer#ensureSharedJoinDynamicSlot', error);
      }
      rec.segmentBuffer = device.createBuffer({
        size: rec.segmentCapacity * 2 * 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        label: `SpiroStar dynamic shared-join segments ${index}`,
      });
      rec.bindGroups = new Map();
      sharedJoinDynamicSlotGrows++;
    }
    if (!rec.styleBuffer) {
      rec.styleBuffer = device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        label: `SpiroStar dynamic shared-join style ${index}`,
      });
      rec.bindGroups = new Map();
    }
    return rec;
  }
  function acquireSharedJoinDynamicSlot(pointCount, segmentCount, frameId) {
    const initial = Math.max(SHARED_JOIN_DYNAMIC_RING, sharedJoinDynamicSlots.length);
    for (let attempt = 0; attempt < initial; attempt++) {
      const idx = (sharedJoinDynamicCursor + attempt) % Math.max(1, initial);
      const rec = sharedJoinDynamicSlots[idx];
      if (!rec || rec.lastFrameId !== frameId) {
        sharedJoinDynamicCursor =
          (idx + 1) %
          Math.max(SHARED_JOIN_DYNAMIC_RING, sharedJoinDynamicSlots.length || SHARED_JOIN_DYNAMIC_RING);
        return ensureSharedJoinDynamicSlot(idx, pointCount, segmentCount);
      }
    }
    const idx = sharedJoinDynamicSlots.length;
    sharedJoinDynamicCursor = (idx + 1) % Math.max(SHARED_JOIN_DYNAMIC_RING, idx + 1);
    return ensureSharedJoinDynamicSlot(idx, pointCount, segmentCount);
  }
  function getSharedJoinDynamicRecord(commands) {
    const eligibility = inspectSharedJoinEligibility(commands);
    if (!eligibility) return null;
    const frameId = currentSharedJoinFrameId(),
      cached = sharedJoinDynamicFrameCache.get(commands);
    if (cached?.frameId === frameId && cached.record?.generation === hubGeneration) {
      sharedJoinDynamicFrameHits++;
      return cached.record;
    }
    const rec = acquireSharedJoinDynamicSlot(eligibility.pointCount, eligibility.segmentCount, frameId);
    const pData = new Float32Array(eligibility.pointCount * 8),
      sData = new Float32Array(eligibility.segmentCount * 2),
      packed = packSharedJoinGeometry(commands, pData, sData);
    if (!packed.pointCount || !packed.segmentCount) return null;
    const rgba = parseColor(eligibility.style);
    device.queue.writeBuffer(rec.pointBuffer, 0, pData.buffer, 0, packed.pointCount * 8 * 4);
    device.queue.writeBuffer(rec.segmentBuffer, 0, sData.buffer, 0, packed.segmentCount * 2 * 4);
    device.queue.writeBuffer(rec.styleBuffer, 0, new Float32Array(rgba));
    sharedJoinUploadBytes += packed.pointCount * 8 * 4 + packed.segmentCount * 2 * 4 + 16;
    sharedJoinDynamicBuilds++;
    rec.pointCount = packed.pointCount;
    rec.segmentCount = packed.segmentCount;
    rec.frameId = frameId;
    rec.lastFrameId = frameId;
    rec.dynamic = true;
    rec.bindGroups = new Map();
    sharedJoinDynamicFrameCache.set(commands, { frameId, record: rec });
    return rec;
  }
  function commandLineLayerMode(commands) {
    return 'uniform';
  }
  function commandLineBlendKind(commands, fallback = 'max') {
    return commandLineLayerMode(commands) === 'segmented' ? 'over' : fallback;
  }
  function prepareSharedJoinRecord(commands) {
    if (!sharedJoinBindGroupLayout || !sharedJoinBodyPipeline || !sharedJoinPointPipeline) return null;

    if (commandLineLayerMode(commands) === 'segmented') {
      sharedJoinDynamicBypasses++;
      return null;
    }

    if (runtimeState?.morph?.active && state?.morph?.mode !== 'light') {
      sharedJoinMorphBypasses++;
      return null;
    }
    if (commands?.__spiroPersistentStatic === true) return getSharedJoinStaticRecord(commands);
    const rec = getSharedJoinDynamicRecord(commands);
    if (!rec) sharedJoinDynamicBypasses++;
    return rec;
  }
  function sharedJoinBindGroup(rec, uniformBufferRef, key = 'main') {
    if (!rec || !uniformBufferRef) return null;
    const cacheKey = rec.dynamic ? `${key}|f${rec.frameId}|s${rec.slot}` : key;
    let bg = rec.bindGroups?.get?.(cacheKey);
    if (bg) return bg;
    bg = device.createBindGroup({
      layout: sharedJoinBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: uniformBufferRef } },
        { binding: 1, resource: { buffer: rec.pointBuffer } },
        { binding: 2, resource: { buffer: rec.segmentBuffer } },
        { binding: 3, resource: { buffer: rec.styleBuffer } },
      ],
    });
    rec.bindGroups?.set?.(cacheKey, bg);
    return bg;
  }
  function encodeSharedJoinPass(pass, rec, bg) {
    pass.setBindGroup(0, bg);
    pass.setVertexBuffer(0, cornerBuffer);
    pass.setPipeline(sharedJoinBodyPipeline);
    pass.draw(6, rec.segmentCount);
    pass.setPipeline(sharedJoinPointPipeline);
    pass.draw(6, rec.pointCount);
    sharedJoinDraws += 2;
    sharedJoinBodyInstances += rec.segmentCount;
    sharedJoinPointInstances += rec.pointCount;
  }
  function submitSharedJoin(
    rec,
    mode,
    targetCtx,
    composite = 'source-over',
    deferComposite = false,
    effectOpt = null,
  ) {
    if (!rec || !ensureSize(mainCanvas.width, mainCanvas.height)) return false;
    try {
      writeStrokeUniforms(mode, effectOpt);
      const bg = sharedJoinBindGroup(rec, uniformBuffer, 'main');
      const encoder = device.createCommandEncoder({ label: 'SpiroStar shared-join spiral encoder' }),
        pass = encoder.beginRenderPass({
          colorAttachments: [
            {
              view: context.getCurrentTexture().createView(),
              clearValue: { r: 0, g: 0, b: 0, a: 0 },
              loadOp: 'clear',
              storeOp: 'store',
            },
          ],
        });
      encodeSharedJoinPass(pass, rec, bg);
      pass.end();
      device.queue.submit([encoder.finish()]);
      lastMode = mode;
      lastSubmit++;
      if (!deferComposite) return compositeTo(targetCtx, composite);
      return true;
    } catch (err) {
      lastError = String(err?.message || err);
      sharedJoinFallbacks++;
      return false;
    }
  }

  function isBezierSpiralCommandSet(commands) {
    if (!bezierPipelineMax || !bezierPipelineOver || !commands?.length) return false;
    let seen = false;
    for (const cmd of commands) {
      if (
        cmd?.__variableWidthBezierSpiral !== true ||
        !Array.isArray(cmd?.bezierSegments) ||
        !cmd.bezierSegments.length
      )
        return false;
      seen = true;
    }
    return seen;
  }
  function packBezierSpiralCommands(commands, scratch = null) {
    const maxCubics = Math.max(
      1024,
      Math.min(
        262144,
        Math.floor(
          (Number(device?.limits?.maxStorageBufferBindingSize) || 134217728) / (BEZIER_FLOATS_PER_CUBIC * 4),
        ),
      ),
    );
    let cubicCount = 0,
      multiStyle = false,
      firstStyle = null;
    for (const cmd of commands || []) {
      const n = Array.isArray(cmd?.bezierSegments) ? cmd.bezierSegments.length : 0;
      if (!Number.isSafeInteger(n) || n < 0 || cubicCount > maxCubics - n) {
        bezierOversizeRejects++;
        lastError = `Spiral Bézier cubic count rejected (${cubicCount}+${n} > ${maxCubics})`;
        return null;
      }
      cubicCount += n;
      const st = String(cmd?.strokeStyle || '#ffffff');
      if (firstStyle === null) firstStyle = st;
      else if (st !== firstStyle) multiStyle = true;
    }
    if (!cubicCount) return null;
    const needed = cubicCount * BEZIER_FLOATS_PER_CUBIC,
      out = scratch instanceof Float32Array && scratch.length >= needed ? scratch : new Float32Array(needed);
    let k = 0;
    for (const cmd of commands) {
      const rgba = parseColor(cmd?.strokeStyle),
        baseHw = Math.max(0.001, (Number(cmd?.screenLineWidth) || 1) * 0.5),
        all = cmd.bezierSegments || [],
        qn = Math.max(1, all.length);
      const lastScale = Math.max(0.000001, Number(all[all.length - 1]?.widthScale1) || 1),
        logSpan = Math.log(lastScale);
      const hasWidthSeamSpan = Math.abs(logSpan) > 1e-8;
      const seamOf = (ws, fallback) => {
        const w = Math.max(0.000001, Number(ws) || 1);
        const t = hasWidthSeamSpan ? Math.log(w) / logSpan : fallback;
        return spiralSmoothStep01(Math.max(0, Math.min(1, t)));
      };
      // Consecutive retained cubics share the same boundary width. Reuse the
      // exact already computed end seam for the next start seam. With a
      // degenerate log span, seamOf uses the segment-position fallback;
      // these are different at a shared boundary, so do not reuse them.
      let precedingWidth,
        precedingSeam = 0,
        hasPrecedingWidth = false;
      for (let qi = 0; qi < all.length; qi++) {
        const q = all[qi];
        const p0 = q?.p0,
          c1 = q?.c1,
          c2 = q?.c2,
          p3 = q?.p3;
        if (!p0 || !c1 || !c2 || !p3) continue;
        // Performance: avoid a new Array + Array.some callback and a second
        // Number() conversion for every exact retained Spiral cubic.
        // Preserve the original finite gate and Float32 ordering.
        const x0 = Number(p0.x),
          y0 = Number(p0.y),
          x1 = Number(c1.x),
          y1 = Number(c1.y),
          x2 = Number(c2.x),
          y2 = Number(c2.y),
          x3 = Number(p3.x),
          y3 = Number(p3.y);
        if (
          !Number.isFinite(x0) ||
          !Number.isFinite(y0) ||
          !Number.isFinite(x1) ||
          !Number.isFinite(y1) ||
          !Number.isFinite(x2) ||
          !Number.isFinite(y2) ||
          !Number.isFinite(x3) ||
          !Number.isFinite(y3)
        )
          continue;
        const o = k * BEZIER_FLOATS_PER_CUBIC;
        out[o] = x0;
        out[o + 1] = y0;
        out[o + 2] = x1;
        out[o + 3] = y1;
        out[o + 4] = x2;
        out[o + 5] = y2;
        out[o + 6] = x3;
        out[o + 7] = y3;
        out[o + 8] = baseHw * Math.max(0.02, Number(q.widthScale0) || 1);
        out[o + 9] = baseHw * Math.max(0.02, Number(q.widthScale1) || 1);
        out[o + 10] = Math.max(0, Math.min(1, Number(q.alpha0 ?? cmd.alpha) || 0));
        out[o + 11] = Math.max(0, Math.min(1, Number(q.alpha1 ?? cmd.alpha) || 0));
        out[o + 12] = rgba[0];
        out[o + 13] = rgba[1];
        out[o + 14] = rgba[2];
        out[o + 15] = rgba[3];
        out[o + 16] = baseHw;

        const startingSeam =
          hasWidthSeamSpan && hasPrecedingWidth && q.widthScale0 === precedingWidth
            ? precedingSeam
            : seamOf(q.widthScale0, qi / qn);
        const endingSeam = seamOf(q.widthScale1, (qi + 1) / qn);
        out[o + 17] = startingSeam;
        out[o + 18] = endingSeam;
        out[o + 19] = (qi === 0 ? 1 : 0) + (qi === all.length - 1 ? 2 : 0);
        precedingWidth = q.widthScale1;
        precedingSeam = endingSeam;
        hasPrecedingWidth = true;
        k++;
      }
    }
    if (!k) return null;
    return {
      data: out,
      cubicCount: k,
      byteLength: k * BEZIER_FLOATS_PER_CUBIC * 4,
      blendKind: multiStyle ? 'over' : 'max',
    };
  }
  function getBezierSpiralRecord(commands) {
    if (!isBezierSpiralCommandSet(commands)) return null;
    const persistent = commands?.__spiroPersistentStatic === true,
      frameId = Math.max(0, Number(commands?.__spiroFrameId) || Number(renderRuntime?.frameId) || 0),
      geometryVersion = Math.max(0, Number(commands?.__spiroGeometryVersion) || 0),
      profileSignature = String(commands?.__spiroProfileSignature || '');
    let rec = bezierGeometryCache.get(commands);

    if (
      rec &&
      rec.generation === hubGeneration &&
      rec.buffer &&
      (persistent || rec.frameId === frameId) &&
      Number(rec.geometryVersion || 0) === geometryVersion &&
      String(rec.profileSignature || '') === profileSignature
    ) {
      rec.lineRenderMode = commandLineLayerMode(commands);
      bezierHits++;
      return rec;
    }
    const packed = packBezierSpiralCommands(commands, rec?.cpuData);
    if (!packed) return null;

    const currentCapacity = Math.max(0, Number(rec?.capacity) || 0);
    if (!rec || rec.generation !== hubGeneration || !rec.buffer || currentCapacity < packed.cubicCount) {
      if (rec) {
        try {
          rec.buffer?.destroy?.();
        } catch (error) {
          noteSuppressedError('gpu/stroke-renderer#getBezierSpiralRecord', error);
        }
        bezierBufferRecords.delete(rec);
      }
      const cap = performanceGovernor.capacityFor(packed.cubicCount, currentCapacity, 32, 1.6);
      const buffer = device.createBuffer({
        size: Math.max(64, cap * BEZIER_FLOATS_PER_CUBIC * 4),
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        label: 'Somata Smooth Spiral Bézier cubics',
      });
      const cpuData =
        packed.data.length >= cap * BEZIER_FLOATS_PER_CUBIC
          ? packed.data
          : new Float32Array(cap * BEZIER_FLOATS_PER_CUBIC);
      if (cpuData !== packed.data)
        cpuData.set(packed.data.subarray(0, packed.cubicCount * BEZIER_FLOATS_PER_CUBIC));
      rec = {
        buffer,
        capacity: cap,
        cpuData,
        generation: hubGeneration,
        bindGroups: new WeakMap(),
        corridorBindGroups: new WeakMap(),
        frameId: -1,
        cubicCount: 0,
        blendKind: 'max',
      };
      bezierBufferRecords.add(rec);
      packed.data = cpuData;
      bezierBufferGrows++;
      bezierCapacityPeak = Math.max(bezierCapacityPeak, cap);
    } else {
      rec.cpuData = packed.data;
      bezierBufferReuses++;
    }
    device.queue.writeBuffer(rec.buffer, 0, packed.data.buffer, packed.data.byteOffset, packed.byteLength);
    bezierUploads += packed.byteLength;
    bezierBuilds++;
    bezierCubics += packed.cubicCount;
    bezierGpuSegments += packed.cubicCount * BEZIER_SUBDIVISIONS;
    bezierCpuSamplesAvoided += packed.cubicCount * 18;
    rec.frameId = frameId;
    rec.cubicCount = packed.cubicCount;
    rec.blendKind = packed.blendKind;
    rec.persistent = persistent;
    rec.geometryVersion = geometryVersion;
    rec.profileSignature = profileSignature;
    rec.lineRenderMode = commandLineLayerMode(commands);
    bezierGeometryCache.set(commands, rec);
    return rec;
  }
  function getBezierBindGroup(rec, uniform) {
    let bg = rec?.bindGroups?.get(uniform) || null;
    if (bg) return bg;
    bg = device.createBindGroup({
      layout: bezierBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: uniform } },
        { binding: 1, resource: { buffer: rec.buffer } },
      ],
    });
    rec.bindGroups.set(uniform, bg);
    return bg;
  }
  function getBezierCorridorBindGroup(rec, copyBuffer, uniform) {
    if (!rec?.buffer || !copyBuffer || !uniform || !bezierCorridorBindGroupLayout) return null;
    if (!rec.corridorBindGroups) rec.corridorBindGroups = new WeakMap();
    let byUniform = rec.corridorBindGroups.get(copyBuffer);
    if (!byUniform) {
      byUniform = new WeakMap();
      rec.corridorBindGroups.set(copyBuffer, byUniform);
    }
    let bg = byUniform.get(uniform) || null;
    if (bg) return bg;
    bg = device.createBindGroup({
      layout: bezierCorridorBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: uniform } },
        { binding: 1, resource: { buffer: rec.buffer } },
        { binding: 2, resource: { buffer: copyBuffer } },
      ],
    });
    byUniform.set(uniform, bg);
    bezierCorridorBindGroupBuilds++;
    return bg;
  }
  function encodeBezierPass(pass, rec, uniform, mode) {
    const segmented = rec?.lineRenderMode === 'segmented',
      uniformCore = mode === 4 && !segmented && bezierUniformPipelineMax;
    const pipe = segmented
      ? bezierPipelineOver
      : uniformCore
        ? rec.blendKind === 'over'
          ? bezierUniformPipelineOver
          : bezierUniformPipelineMax
        : mode === 4
          ? rec.blendKind === 'over'
            ? bezierPipelineOver
            : bezierPipelineMax
          : bezierPipelineMax;
    pass.setPipeline(pipe);
    pass.setBindGroup(0, getBezierBindGroup(rec, uniform));
    pass.setVertexBuffer(0, cornerBuffer);
    pass.draw(6, rec.cubicCount * BEZIER_SUBDIVISIONS);
  }
  function submitBezierSpiral(
    rec,
    mode,
    targetCtx,
    composite = 'source-over',
    deferComposite = false,
    effectOpt = null,
  ) {
    if (!rec?.cubicCount || !ensureSize(mainCanvas.width, mainCanvas.height)) return false;
    try {
      writeStrokeUniforms(mode, effectOpt);
      const encoder = device.createCommandEncoder({ label: 'Somata Smooth Spiral Bézier encoder' }),
        pass = encoder.beginRenderPass({
          colorAttachments: [
            {
              view: context.getCurrentTexture().createView(),
              clearValue: { r: 0, g: 0, b: 0, a: 0 },
              loadOp: 'clear',
              storeOp: 'store',
            },
          ],
        });
      encodeBezierPass(pass, rec, uniformBuffer, mode);
      pass.end();
      device.queue.submit([encoder.finish()]);
      lastMode = mode;
      lastSubmit++;
      if (!deferComposite) return compositeTo(targetCtx, composite);
      return true;
    } catch (err) {
      lastError = String(err?.message || err);
      return false;
    }
  }

  function prepareLayerBatchGeometry(commands) {
    const bezier = getBezierSpiralRecord(commands);
    if (bezier) {
      bezier.bezierSpiral = true;
      bezier.k = bezier.cubicCount * BEZIER_SUBDIVISIONS;
      return bezier;
    }
    const indexed = getIndexedMorphFrameRecord(commands);
    if (indexed) {
      indexed.k = indexed.segmentCount;
      indexed.lineRenderMode = commandLineLayerMode(commands);
      layerBatchPackedReuse++;
      return indexed;
    }
    const shared = prepareSharedJoinRecord(commands);
    if (shared) {
      if (commands?.__spiroPersistentStatic === true) layerBatchPackedReuse++;
      shared.sharedJoin = true;
      shared.k = shared.segmentCount;
      shared.blendKind = 'max';
      return shared;
    }
    const resident = getFrameResidentDynamicRecord(commands);
    if (resident) {
      resident.lineRenderMode = commandLineLayerMode(commands);
      resident.blendKind = commandLineBlendKind(commands, resident.blendKind);
      frameResidentDynamicBatchHits++;
      layerBatchPackedReuse++;
      return resident;
    }
    if (commands?.__spiroPersistentStatic === true) {
      const rec = getStaticGeometryRecord(commands);
      if (rec) {
        rec.lineRenderMode = commandLineLayerMode(commands);
        rec.blendKind = commandLineBlendKind(commands, rec.blendKind);
      }
      if (rec?.k) layerBatchPackedReuse++;
      return rec;
    }
    const count = countCommandSegments(commands);
    if (!count)
      return {
        buffer: null,
        k: 0,
        blendKind: commandLineBlendKind(commands, 'max'),
        lineRenderMode: commandLineLayerMode(commands),
      };
    // Deferred layers may be encoded without advancing lastSubmit. Reserve
    // a separate vertex buffer for each live batch instead of overwriting it.
    const frameId = frameResidentDynamicFrameId(commands);
    const slot = acquireFrameResidentDynamicSlot(count, frameId);
    const meta = packGeometryCommands(commands, slot.data);
    meta.blendKind = commandLineBlendKind(commands, meta.blendKind);
    meta.lineRenderMode = commandLineLayerMode(commands);
    if (!meta.k)
      return { buffer: null, k: 0, blendKind: meta.blendKind, lineRenderMode: meta.lineRenderMode };
    slot.lastFrameId = frameId;
    slot.frameId = frameId;
    slot.k = meta.k;
    slot.blendKind = meta.blendKind;
    slot.lineRenderMode = meta.lineRenderMode;
    device.queue.writeBuffer(slot.buffer, 0, slot.data.buffer, slot.data.byteOffset, meta.k * FLOATS_PER_INSTANCE * 4);
    dynamicUploadBytes += meta.k * FLOATS_PER_INSTANCE * 4;
    return slot;
  }
  function layerBatchMode(spec) {
    const base = { saiyan: 2.1, drip: 4.1, mountain: 4.5 }[spec?.mode];
    return base != null
      ? base + (0.3 * Math.max(0, Math.min(255.999, Number(spec.auraPacked ?? 96)))) / 256
      : spec?.mode === 'outline'
        ? 1
        : spec?.mode === 'halo'
          ? 2
          : spec?.mode === 'coreInset'
            ? 3
            : spec?.mode === 'base'
              ? 4
              : 0;
  }
  function strokeCompositeRect(commands, roles) {
    const contours = getCommandSegmentMeta(commands).contours;
    if (!contours?.length) return null;
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
    for (const { bounds, command } of contours) {
      if (!bounds || command.__variableWidthSpiral) return null;
      const width = Math.max(0.002, Number(command.screenLineWidth) || 1);
      let reach = width * 0.5;
      for (const spec of roles) {
        const radius = spec.mode === 'outline' || spec.mode === 'coreInset'
          ? Math.max(0, Number(spec.extraLocal) || 0) * width / Math.max(0.001, Number(spec.baseLineWidth) || 1)
          : Math.max(0.1, Number(spec.radiusPx) || 1);
        reach = Math.max(reach, width * 0.5 + radius);
      }
      // The segment quads can extend in both tangent and normal directions.
      // Allow for their diagonal, raster edge and linear texture filtering.
      const pad = Math.ceil(Math.SQRT2 * (reach + 2.5)) + 2;
      left = Math.min(left, bounds.minX - pad);
      top = Math.min(top, bounds.minY - pad);
      right = Math.max(right, bounds.maxX + pad);
      bottom = Math.max(bottom, bounds.maxY + pad);
    }
    const x = Math.max(0, Math.min(mainCanvas.width, Math.floor(left)));
    const y = Math.max(0, Math.min(mainCanvas.height, Math.floor(top)));
    const w = Math.max(0, Math.min(mainCanvas.width, Math.ceil(right)) - x);
    const h = Math.max(0, Math.min(mainCanvas.height, Math.ceil(bottom)) - y);
    return w * h < mainCanvas.width * mainCanvas.height ? [x, y, w, h] : null;
  }
  function fourierComputeReady() {
    return Boolean(ready && !lost && indexedMorphPipelineMax && indexedMorphPipelineOver &&
      warmupGpuFourier(device, requestMainCanvasRender));
  }
  function prepareResidentFourierBatch(commands, encoder) {
    const rails = [], topology = [], styles = new Float32Array(commands.length * 8);
    let firstStyle = null, multiStyle = false;
    for (let ci = 0; ci < commands.length; ci++) {
      const cmd = commands[ci], style = String(cmd.strokeStyle || '#ffffff');
      if (firstStyle === null) firstStyle = style;
      else if (style !== firstStyle) multiStyle = true;
      styles.set([...parseColor(style), Math.max(0.001, Number(cmd.screenLineWidth)*0.5), Math.max(0, Math.min(1, Number(cmd.alpha))), 0, 0], ci*8);
      for (const sp of cmd.subpaths) {
        if (!sp.gpuFourier || sp.points.length) return null;
        const base = rails.length*FOURIER_GPU_POINTS;
        rails.push(sp.gpuFourier);
        const count = FOURIER_GPU_POINTS - (sp.closed ? 0 : 1);
        for (let j = 0; j < count; j++) topology.push(base+j,base+(j+1)%FOURIER_GPU_POINTS,ci,0);
      }
    }
    if (!rails.length || !topology.length || !styles.every(Number.isFinite)) return null;
    const topoData = new Uint32Array(topology);
    const limit = Math.min(device.limits.maxStorageBufferBindingSize, device.limits.maxBufferSize);
    if (Math.max(topoData.byteLength,styles.byteLength,topology.length) > limit) return null;
    const pointBuffer = encodeGpuFourier(device, encoder, rails);
    if (!pointBuffer) return null;
    const makeBuffer = (label, data) => {
      const b = device.createBuffer({ label, size: data.byteLength, usage: GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST });
      device.queue.writeBuffer(b,0,data); return b;
    };
    // A full alpha buffer is needed even without per-segment alpha: WGSL
    // select evaluates both arguments. The same indexed renderer draws rails.
    const segmentCount = topology.length/4;
    return { indexedMorph: true, gpuFourier: true, k: segmentCount, segmentCount,
      pointBuffer, topology: { buffer:makeBuffer('Somata Fourier topology',topoData),identity:'fourier' },
      alphaBuffer:makeBuffer('Somata Fourier alpha',new Float32Array(segmentCount)),
      commandBuffer:makeBuffer('Somata Fourier styles',styles), bindGroups:new Map(), slot:0,
      lineRenderMode:'uniform', blendKind:multiStyle?'over':'max' };
  }
  function renderLayerBatch(commands, specs, sceneOpt = null) {
    if (
      !commands?.length ||
      !Array.isArray(specs) ||
      !specs.length ||
      !ready ||
      lost ||
      !ensureLayerBatchSize(mainCanvas.width, mainCanvas.height)
    )
      return null;
    const filtered = specs.filter((spec) => spec && LAYER_BATCH_ROLES.includes(spec.role));
    if (!filtered.length) return null;
    const wantsScene = filtered.some((spec) => spec.role === 'base');
    try {
      const fillMaskResource =
        sceneOpt?.fillMask && wantsScene ? prepareLayerSceneFillMaskResource(sceneOpt.fillMask) : null;
      const encoder = device.createCommandEncoder({
          label: wantsScene ? 'SpiroStar layer scene batch' : 'SpiroStar layer stroke batch',
        }),
        roles = new Set(),
        roleTextures = Object.create(null);
      // The compute pass precedes all draws in this very command buffer.
      // Lamp accumulation can submit before deferred layer composition. Submit
      // the shared prerequisite once, independently of the artistic pass order.
      const lampRail = sceneOpt?.fourierLampRail;
      const fourierPrerequisite = lampRail ? device.createCommandEncoder({label:'Somata Fourier line + lamp prerequisite'}) : null;
      const rec = sceneOpt?.gpuFourier === true
        ? (fourierPrerequisite ? prepareResidentFourierBatch(commands, fourierPrerequisite) : prepareResidentFourierBatch(commands, encoder)) : prepareLayerBatchGeometry(commands);
      if (lampRail && rec?.pointBuffer) device.queue.submit([fourierPrerequisite.finish()]);
      if (!rec?.k) return { roles: new Set(), empty: true };
      for (const spec of filtered) {
        const surf = layerBatchSurfaces[spec.role],
          mode = layerBatchMode(spec),
          effectOpt = {
            reuseStatic: true,
            effectParam:
              mode === 4
                ? 0
                : mode === 1 || mode === 3
                  ? Math.max(0, Number(spec.extraLocal) || 0)
                  : Math.max(0.1, Number(spec.radiusPx) || 1),
            baseLineWidth: Math.max(0.001, Number(spec.baseLineWidth) || 1),
            alphaScale: Number.isFinite(Number(spec.alphaScale)) ? Number(spec.alphaScale) : 1,
            overrideColor: mode === 4 ? null : spec.colorOverride || null,
          };
        const uniform = getLayerBatchUniformRecord(surf, sceneOpt?.uniformKey);
        const bindKey = `role-${spec.role}-u${uniform.id || 0}`;
        writeLayerBatchUniform(uniform, mode, effectOpt);
        const tex = surf.texture;
        roleTextures[spec.role] = tex;
        const pass = encoder.beginRenderPass({
          colorAttachments: [
            { view: surf.view, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' },
          ],
        });
        if (rec.bezierSpiral) {
          encodeBezierPass(pass, rec, uniform.uniformBuffer, mode);
        } else if (rec.indexedMorph) {
          encodeIndexedMorphPass(pass, rec, uniform.uniformBuffer, mode, bindKey);
        } else if (rec.sharedJoin) {
          const bg = sharedJoinBindGroup(rec, uniform.uniformBuffer, bindKey);
          encodeSharedJoinPass(pass, rec, bg);
        } else {
          pass.setPipeline(
            rec.lineRenderMode === 'segmented'
              ? pipelineOver
              : mode === 4
                ? rec.blendKind === 'max'
                  ? pipelineMax
                  : pipelineOver
                : pipelineMax,
          );
          pass.setBindGroup(0, uniform.bindGroup);
          pass.setVertexBuffer(0, cornerBuffer);
          pass.setVertexBuffer(1, rec.buffer);
          pass.draw(6, rec.k);
        }
        pass.end();
        roles.add(spec.role);
        layerBatchDraws++;
      }
      let sceneCombined = false,
        sceneTexture = null,
        outlineInScene = false,
        nativeFillInScene = false,
        compositeRect = null;
      if (wantsScene) {
        if (sceneOpt?.nativeFillMesh && sceneOpt?.nativeFillFrameCtx && layerSceneNativeFillTexture) {
          const fillRec = FillGPURenderer.encodeMeshToTexture(
            encoder,
            layerSceneNativeFillTexture,
            sceneOpt.nativeFillFrameCtx,
            sceneOpt.nativeFillMesh,
            mainCtx,
          );
          nativeFillInScene = fillRec?.handled === true;
        }
        const baseTex = roleTextures.base,
          glowTex = roleTextures.glow || baseTex,
          maskTex = sceneOpt?.fillMask ? layerSceneMaskTexture : baseTex;
        const includeOutline =
          sceneOpt?.includeOutline === true && roles.has('outline') && Boolean(roleTextures.outline);
        const outlineTex = includeOutline ? roleTextures.outline : baseTex;
        const includeCore = roles.has('core') && Boolean(roleTextures.core);
        const coreTex = includeCore ? roleTextures.core : baseTex;
        if (baseTex && glowTex && maskTex && outlineTex && coreTex) {
          const fill = sceneOpt?.fillStyle ? parseColor(sceneOpt.fillStyle) : [0, 0, 0, 0];
          layerSceneUniform.fill(0);
          layerSceneUniform[0] = fill[0];
          layerSceneUniform[1] = fill[1];
          layerSceneUniform[2] = fill[2];
          layerSceneUniform[3] = fill[3];
          layerSceneUniform[4] = roles.has('glow') ? 1 : 0;
          layerSceneUniform[5] = sceneOpt?.fillMask ? 1 : 0;
          layerSceneUniform[6] = 1;
          layerSceneUniform[7] = includeOutline ? 1 : 0;
          layerSceneUniform[8] = includeCore ? 1 : 0;
          layerSceneUniform[9] = includeOutline && sceneOpt?.outlineBehind === true ? 1 : 0;
          layerSceneUniform[10] = nativeFillInScene ? 1 : 0;
          const sceneUniformRec = writeLayerSceneUniformRecord(sceneOpt?.uniformKey);
          const sceneKey =
              (roles.has('glow') ? 1 : 0) |
              (sceneOpt?.fillMask ? 2 : 0) |
              (includeOutline ? 4 : 0) |
              (includeCore ? 8 : 0) |
              (nativeFillInScene ? 16 : 0),
            sceneBindCache = fillMaskResource?.bindGroups || layerSceneBindGroupCache,
            sceneCacheKey = `u${sceneUniformRec?.id || 0}|s${sceneKey}`;
          let entry = sceneBindCache.get(sceneCacheKey);
          if (entry) {
            layerSceneBindGroupHits++;
            if (entry.bundle) layerSceneCompositeBundleHits++;
          } else {
            const baseView = layerBatchSurfaces.base.view,
              glowView = roles.has('glow') ? layerBatchSurfaces.glow.view : baseView,
              maskView = sceneOpt?.fillMask ? fillMaskResource?.view || layerSceneMaskView : baseView,
              outlineView = includeOutline ? layerBatchSurfaces.outline.view : baseView,
              coreView = includeCore ? layerBatchSurfaces.core.view : baseView,
              nativeView = nativeFillInScene ? layerSceneNativeFillView : baseView;
            const bg = device.createBindGroup({
              layout: layerSceneBindGroupLayout,
              entries: [
                { binding: 0, resource: glowView },
                { binding: 1, resource: baseView },
                { binding: 2, resource: maskView },
                { binding: 3, resource: outlineView },
                { binding: 4, resource: coreView },
                { binding: 5, resource: layerSceneSampler },
                { binding: 6, resource: { buffer: sceneUniformRec?.buffer || layerSceneUniformBuffer } },
                { binding: 7, resource: nativeView },
              ],
            });
            const bundle = buildFullscreenBundle(
              layerScenePipeline,
              bg,
              `SpiroStar Layer Scene composite ${sceneCacheKey}`,
            );
            entry = { bg, bundle, list: bundle ? [bundle] : null };
            sceneBindCache.set(sceneCacheKey, entry);
            layerSceneBindGroups++;
            if (bundle) layerSceneCompositeBundleBuilds++;
            else layerSceneCompositeBundleFallbacks++;
          }
          const sceneTex = layerSceneTexture,
            scenePass = encoder.beginRenderPass({
              colorAttachments: [
                {
                  view: layerSceneView,
                  clearValue: { r: 0, g: 0, b: 0, a: 0 },
                  loadOp: sceneOpt?.preserveExistingScene === true ? 'load' : 'clear',
                  storeOp: 'store',
                },
              ],
            });
          if (!sceneOpt?.fillMask && !nativeFillInScene && !sceneOpt?.preserveExistingScene &&
              !rec.bezierSpiral && !rec.indexedMorph) {
            compositeRect = strokeCompositeRect(commands, filtered);
            if (compositeRect) scenePass.setScissorRect(...compositeRect);
          }
          if (entry.bundle) {
            scenePass.executeBundles(entry.list);
            layerSceneCompositeBundleExecutes++;
            renderBundleExecutes++;
          } else {
            scenePass.setPipeline(layerScenePipeline);
            scenePass.setBindGroup(0, entry.bg);
            scenePass.draw(3);
          }
          scenePass.end();
          sceneCombined = true;
          sceneTexture = sceneTex;
          outlineInScene = includeOutline;
          if (includeOutline) layerSceneOutlineFrames++;
          layerSceneFrames++;
        }
      }
      const commandBuffer = encoder.finish();
      layerBatchFrames++;
      return {
        roles,
        gpuFourier: rec.gpuFourier === true,
        fourierLampCarrier: lampRail ? {device, buffer:rec.pointBuffer, closed:lampRail.rail.closed, matrix:lampRail.matrix.slice()} : null,
        sceneCombined,
        sceneTexture,
        compositeRect,
        outlineInScene,
        nativeFillInScene,
        preserveExistingScene: sceneOpt?.preserveExistingScene === true,
        commandBuffer,
        submitted: false,
        fillInScene: sceneCombined && Boolean(sceneOpt?.fillMask || nativeFillInScene),
        composites: Object.fromEntries(filtered.map((spec) => [spec.role, spec.composite || 'source-over'])),
      };
    } catch (err) {
      layerBatchFailures++;
      lastError = String(err?.message || err);
      return null;
    }
  }
  function ensureCircleCapacity(count) {
    const wantedRing = Math.max(desiredCircleRingCount(), circleInstanceBuffers.length || 0),
      needCapacity = count > circleCapacity || !circleData;
    ensureCircleUniformRingCount(wantedRing);
    if (!needCapacity && circleInstanceBuffers.length >= wantedRing && circleInstanceBuffers.every(Boolean))
      return;
    if (needCapacity) {
      circleCapacity = performanceGovernor.capacityFor(count, circleCapacity, 256, 1.6);
      circleData = new Float32Array(circleCapacity * FLOATS_PER_INSTANCE);
      for (const b of circleInstanceBuffers)
        try {
          b?.destroy?.();
        } catch (error) {
          noteSuppressedError('gpu/stroke-renderer#ensureCircleCapacity', error);
        }
      circleInstanceBuffers = [];
    }
    while (circleInstanceBuffers.length < wantedRing) {
      const i = circleInstanceBuffers.length;
      circleInstanceBuffers.push(
        device.createBuffer({
          size: circleCapacity * FLOATS_PER_INSTANCE * 4,
          usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
          label: `SpiroStar Geometry Circles instances ${i}`,
        }),
      );
    }
    circleCursor = 0;
  }
  function canEncodeGeometryCirclesToLayerScene(commands) {
    return Boolean(
      ready &&
      !lost &&
      commands?.length &&
      countCommandSegments(commands) > 0 &&
      circleCompositePipeline &&
      circleCompositeLayout &&
      circleSampler,
    );
  }
  function encodeGeometryCirclesToLayerScene(targetTexture, commands, glowOpt = null) {
    if (
      !targetTexture ||
      !canEncodeGeometryCirclesToLayerScene(commands) ||
      !ensureSize(mainCanvas.width, mainCanvas.height) ||
      !ensureLayerBatchSize(mainCanvas.width, mainCanvas.height)
    )
      return { handled: false, commandBuffer: null };
    try {
      const count = countCommandSegments(commands);
      ensureCircleCapacity(count);
      let vb = null,
        k = 0,
        blendKind = 'max';
      const resident = prepareLayerBatchGeometry(commands);
      if (resident && !resident.indexedMorph && !resident.sharedJoin && resident.buffer && resident.k) {
        vb = resident.buffer;
        k = resident.k;
        blendKind = resident.blendKind || 'max';
        circleResidentBufferReuses++;
      } else {
        const packed = packGeometryCommands(commands, circleData);
        if (!packed.k) return { handled: true, commandBuffer: null };
        k = packed.k;
        blendKind = packed.blendKind;
        vb = circleInstanceBuffers[circleCursor++ % circleInstanceBuffers.length];
        device.queue.writeBuffer(
          vb,
          0,
          circleData.buffer,
          circleData.byteOffset,
          k * FLOATS_PER_INSTANCE * 4,
        );
        circleScratchUploadBytes += k * FLOATS_PER_INSTANCE * 4;
        circleFallbackPacks++;
      }
      // The deferred frame may queue multiple per-layer glow+core passes
      // before any queue submit. Do not overwrite a uniform from a
      // previously encoded pass in the same frame.
      ensureCircleUniformRingCount(Math.max(128, desiredCircleRingCount()));
      if (!circleUniformBuffers.length || !circleScratchView || !circleCompositeBindGroup)
        return { handled: false, commandBuffer: null };
      const encoder = device.createCommandEncoder({ label: 'SpiroStar Geometry Circles Glow then Core' });
      const targetView =
        targetTexture === layerSceneTexture
          ? (circleTargetViewReuses++, layerSceneView)
          : targetTexture.createView();
      const paint = (mode, opt) => {
        const uslot = circleUniformCursor++ % circleUniformBuffers.length,
          ub = circleUniformBuffers[uslot];
        fillStrokeUniformArray(circleUniformData, mode, opt);
        if (
          !circleUniformHasLast[uslot] ||
          !sameF32Data(circleUniformData, circleUniformLastData[uslot], 12)
        ) {
          device.queue.writeBuffer(ub, 0, circleUniformData);
          circleUniformLastData[uslot].set(circleUniformData);
          circleUniformHasLast[uslot] = true;
          circleUniformUploads++;
        } else circleUniformUploadSkips++;
        const scratch = encoder.beginRenderPass({
          colorAttachments: [
            {
              view: circleScratchView,
              clearValue: { r: 0, g: 0, b: 0, a: 0 },
              loadOp: 'clear',
              storeOp: 'store',
            },
          ],
        });
        scratch.setPipeline(blendKind === 'max' ? pipelineMax : pipelineOver);
        scratch.setBindGroup(0, circleUniformBindGroups[uslot]);
        scratch.setVertexBuffer(0, cornerBuffer);
        scratch.setVertexBuffer(1, vb);
        scratch.draw(6, k);
        scratch.end();
        const composite = encoder.beginRenderPass({
          colorAttachments: [{ view: targetView, loadOp: 'load', storeOp: 'store' }],
        });
        if (circleCompositeBundle) {
          composite.executeBundles(circleCompositeBundleList);
          renderBundleExecutes++;
        } else {
          composite.setPipeline(circleCompositePipeline);
          composite.setBindGroup(0, circleCompositeBindGroup);
          composite.draw(3);
        }
        composite.end();
        circleScratchFrames++;
        circleScratchDraws += 2;
      };
      if (Number(glowOpt?.radiusPx) > 0 && Number(glowOpt?.alphaScale) > 0) {
        // Same RGB and stroke geometry as the core; only optical radius differs.
        paint(0, {
          reuseStatic: true,
          effectParam: Number(glowOpt.radiusPx),
          baseLineWidth: 1,
          alphaScale: Number(glowOpt.alphaScale),
        });
      }
      paint(4, null);
      circleScratchSegments += k;
      return { handled: true, commandBuffer: encoder.finish() };
    } catch (err) {
      lastError = String(err?.message || err);
      circleScratchFallbacks++;
      return { handled: false, commandBuffer: null };
    }
  }
  function submitLayerBatchCommands(batch, extraCommands = null) {
    if (!batch) return false;
    const commands = [];
    const ownsBatch = batch.submitted !== true;
    if (ownsBatch) {
      if (!batch.commandBuffer) return false;
      commands.push(batch.commandBuffer);
    }
    if (Array.isArray(extraCommands)) {
      for (const cmd of extraCommands) if (cmd) commands.push(cmd);
    } else if (extraCommands) commands.push(extraCommands);
    if (!commands.length) return true;
    try {
      device.queue.submit(commands);
      if (ownsBatch) {
        batch.submitted = true;
        batch.commandBuffer = null;
        if (deferredLayerScene?.batch === batch) deferredLayerScene.commandBuffer = null;
        lastSubmit++;
        layerBatchSubmissions++;
      }
      return true;
    } catch (err) {
      lastError = String(err?.message || err);
      return false;
    }
  }
  function canUseFrameScene(frameId = 0) {
    warmup();
    const id = Number(frameId) || 0;
    if (!ready || lost || (!id ? false : frameSceneDisabledFrameId === id)) return false;
    if (!ensureLayerBatchSize(mainCanvas.width, mainCanvas.height)) return false;
    return Boolean(
      frameSceneTexture && frameSceneView && frameSceneLayerBindGroup && circleCompositePipeline,
    );
  }
  function resetFrameSceneQueue() {
    frameSceneClearCommand = null;
    frameScenePendingCommands.length = 0;
    frameScenePendingFrameId = 0;
    frameSceneSealedLayers = 0;
  }
  function prepareFrameScene(frameId) {
    const id = Number(frameId) || 0;
    if (!id || !canUseFrameScene(id) || !ensureLayerBatchSize(mainCanvas.width, mainCanvas.height))
      return null;
    if (frameSceneActive && frameSceneFrameId === id)
      return { texture: frameSceneTexture, frameId: id, sealedLayers: frameSceneSealedLayers };
    try {
      const enc = device.createCommandEncoder({ label: 'SpiroStar global GPU frame scene clear' }),
        pass = enc.beginRenderPass({
          colorAttachments: [
            {
              view: frameSceneView,
              clearValue: { r: 0, g: 0, b: 0, a: 0 },
              loadOp: 'clear',
              storeOp: 'store',
            },
          ],
        });
      pass.end();
      resetFrameSceneQueue();
      frameSceneClearCommand = enc.finish();
      frameScenePendingFrameId = id;
      frameSceneClears++;
      frameSceneQueuedCommands++;
      frameSceneActive = true;
      frameSceneFrameId = id;
      return { texture: frameSceneTexture, frameId: id, sealedLayers: 0 };
    } catch (err) {
      lastError = String(err?.message || err);
      frameSceneDisabledFrameId = id;
      frameSceneActive = false;
      resetFrameSceneQueue();
      return null;
    }
  }
  function getFrameSceneTexture(frameId) {
    const id = Number(frameId) || 0;
    return frameSceneActive && frameSceneFrameId === id
      ? {
          texture: frameSceneTexture,
          view: frameSceneView,
          width: layerSceneWidth,
          height: layerSceneHeight,
          format,
          frameId: id,
          sealedLayers: frameSceneSealedLayers,
          globalFrameScene: true,
        }
      : null;
  }
  function getFrameSceneCommandBuffers(frameId) {
    const id = Number(frameId) || 0;
    if (!getFrameSceneTexture(id) || frameScenePendingFrameId !== id) return [];
    const out = [];
    if (frameSceneClearCommand) out.push(frameSceneClearCommand);
    for (const cmd of frameScenePendingCommands) if (cmd) out.push(cmd);
    return out;
  }

  function getExternalFrameSceneTarget(frameId = 0) {
    const id = Number(frameId) || 0;
    if (!id || !prepareFrameScene(id)) return null;
    return {
      texture: frameSceneTexture,
      view: frameSceneView,
      width: layerSceneWidth,
      height: layerSceneHeight,
      format,
      frameId: id,
      globalFrameScene: true,
    };
  }
  function deferExternalFrameScene(commandBuffer, frameId, label = 'external-frame') {
    const id = Number(frameId) || 0;
    if (!commandBuffer || !id || !prepareFrameScene(id) || frameScenePendingFrameId !== id) return false;
    if (frameSceneClearCommand) {
      frameScenePendingCommands.push(frameSceneClearCommand);
      frameSceneClearCommand = null;
    }
    frameScenePendingCommands.push(commandBuffer);
    frameSceneQueuedCommands++;
    frameSceneSealedLayers++;
    frameSceneDirectExternalLayers++;
    frameSceneDirectExternalCommands++;
    return true;
  }
  function sealDeferredLayerSceneToFrame(frameId, extraCommands = null) {
    const id = Number(frameId) || 0,
      rec = getDeferredLayerSceneTexture(id);
    if (!rec || !prepareFrameScene(id)) return false;
    try {
      const enc = device.createCommandEncoder({ label: 'SpiroStar Layer Scene -> global GPU frame scene' }),
        pass = enc.beginRenderPass({
          colorAttachments: [{ view: frameSceneView, loadOp: 'load', storeOp: 'store' }],
        });
      // An additional effect may have drawn outside the stroke rectangle.
      const rect = extraCommands?.length ? null : rec.batch?.compositeRect;
      if (rect) pass.setScissorRect(...rect);
      if (frameSceneCompositeBundle) {
        pass.executeBundles(frameSceneCompositeBundleList);
        renderBundleExecutes++;
      } else {
        pass.setPipeline(circleCompositePipeline);
        pass.setBindGroup(0, frameSceneLayerBindGroup);
        pass.draw(3);
      }
      pass.end();
      if (frameSceneClearCommand) {
        frameScenePendingCommands.push(frameSceneClearCommand);
        frameSceneClearCommand = null;
      }
      if (rec.commandBuffer) frameScenePendingCommands.push(rec.commandBuffer);
      let extraCount = 0;
      if (Array.isArray(extraCommands))
        for (const cmd of extraCommands)
          if (cmd) {
            frameScenePendingCommands.push(cmd);
            extraCount++;
          }
      frameScenePendingCommands.push(enc.finish());
      frameSceneQueuedCommands += 2 + extraCount;
      frameSceneSeals++;
      frameSceneSealedLayers++;
      if (rec.batch) {
        rec.batch.submitted = true;
        rec.batch.commandBuffer = null;
      } else if (rec.external === true) externalLayerSceneSubmissions++;
      deferredLayerScene = null;
      layerSceneDeferredPresented++;
      return true;
    } catch (err) {
      lastError = String(err?.message || err);
      frameSceneDisabledFrameId = id;
      return false;
    }
  }
  function markFrameScenePresented(frameId) {
    const id = Number(frameId) || 0;
    if (!getFrameSceneTexture(id)) return false;
    if (frameSceneSealedLayers > 0) frameSceneCanvasUploadAvoided++;
    resetFrameSceneQueue();
    frameSceneActive = false;
    frameScenePresented++;
    return true;
  }

  function discardFrameScene(frameId) {
    const id = Number(frameId) || 0;
    if (!id || frameSceneFrameId !== id) return false;
    resetFrameSceneQueue();
    frameSceneActive = false;
    frameSceneFallbacks++;
    return true;
  }
  function presentFrameSceneToMain(frameId, targetCtx = mainCtx, disableForFrame = true) {
    const id = Number(frameId) || 0;
    if (!getFrameSceneTexture(id) || !targetCtx) return false;
    try {
      if (!ensureLayerSceneFallbackSurface()) return false;
      const enc = device.createCommandEncoder({ label: 'SpiroStar global GPU frame scene fallback copy' });
      enc.copyTextureToTexture(
        { texture: frameSceneTexture },
        { texture: layerSceneFallbackSurface.context.getCurrentTexture() },
        [layerSceneWidth, layerSceneHeight, 1],
      );
      const commands = getFrameSceneCommandBuffers(id).slice();
      commands.push(enc.finish());
      device.queue.submit(commands);
      targetCtx.save();
      targetCtx.setTransform(1, 0, 0, 1, 0, 0);
      targetCtx.globalAlpha = 1;
      targetCtx.globalCompositeOperation = 'source-over';
      targetCtx.filter = 'none';
      targetCtx.drawImage(layerSceneFallbackSurface.canvas, 0, 0);
      targetCtx.restore();
      resetFrameSceneQueue();
      frameSceneActive = false;
      frameSceneFallbacks++;
      if (disableForFrame) frameSceneDisabledFrameId = id;
      return true;
    } catch (err) {
      lastError = String(err?.message || err);
      return false;
    }
  }
  function abandonFrameScene(frameId, targetCtx = mainCtx) {
    const id = Number(frameId) || 0;
    if (getFrameSceneTexture(id)) presentFrameSceneToMain(id, targetCtx, true);
    else {
      frameSceneDisabledFrameId = id;
      resetFrameSceneQueue();
    }
    return true;
  }
  function canUseFrameUnderlay(frameId = 0) {
    warmup();
    const id = Number(frameId) || 0;
    return Boolean(
      ready &&
      !lost &&
      frameUnderlayTexture &&
      frameUnderlayPipelineBehind &&
      circleCompositeLayout &&
      circleSampler &&
      (!id || frameUnderlayDisabledFrameId !== id),
    );
  }
  function resetFrameUnderlayQueue() {
    frameUnderlayClearCommand = null;
    frameUnderlayPendingCommands.length = 0;
    frameUnderlayPendingFrameId = 0;
  }
  function prepareFrameUnderlay(frameId) {
    const id = Number(frameId) || 0;
    if (!id || !canUseFrameUnderlay(id) || !ensureLayerBatchSize(mainCanvas.width, mainCanvas.height))
      return null;
    if (frameUnderlayActive && frameUnderlayFrameId === id)
      return { texture: frameUnderlayTexture, frameId: id };
    try {
      const enc = device.createCommandEncoder({ label: 'SpiroStar global underlay clear' }),
        pass = enc.beginRenderPass({
          colorAttachments: [
            {
              view: frameUnderlayView,
              clearValue: { r: 0, g: 0, b: 0, a: 0 },
              loadOp: 'clear',
              storeOp: 'store',
            },
          ],
        });
      pass.end();
      resetFrameUnderlayQueue();
      frameUnderlayClearCommand = enc.finish();
      frameUnderlayPendingFrameId = id;
      frameUnderlayClears++;
      frameUnderlayQueuedCommands++;
      frameUnderlayActive = true;
      frameUnderlayFrameId = id;
      return { texture: frameUnderlayTexture, frameId: id };
    } catch (err) {
      lastError = String(err?.message || err);
      frameUnderlayDisabledFrameId = id;
      frameUnderlayActive = false;
      resetFrameUnderlayQueue();
      return null;
    }
  }
  function getFrameUnderlayTexture(frameId) {
    const id = Number(frameId) || 0;
    return frameUnderlayActive && frameUnderlayFrameId === id
      ? { texture: frameUnderlayTexture, frameId: id }
      : null;
  }
  function getFrameUnderlayCommandBuffers(frameId) {
    const id = Number(frameId) || 0;
    if (!getFrameUnderlayTexture(id) || frameUnderlayPendingFrameId !== id)
      return { clearCommand: null, effectCommands: [] };
    return { clearCommand: frameUnderlayClearCommand, effectCommands: frameUnderlayPendingCommands };
  }
  function markFrameUnderlayCommandsSubmitted(frameId) {
    const id = Number(frameId) || 0;
    if (frameUnderlayPendingFrameId !== id) return false;
    resetFrameUnderlayQueue();
    return true;
  }
  function submitFrameUnderlayCommand(frameId, commandBuffer) {
    const id = Number(frameId) || 0;
    if (!commandBuffer || !getFrameUnderlayTexture(id)) return false;
    if (frameUnderlayPendingFrameId !== id) frameUnderlayPendingFrameId = id;
    frameUnderlayPendingCommands.push(commandBuffer);
    frameUnderlayComposites++;
    frameUnderlayQueuedCommands++;
    return true;
  }

  function appendFrameUnderlayCommands(frameId, target) {
    const id = Number(frameId) || 0;
    if (!Array.isArray(target) || !getFrameUnderlayTexture(id) || frameUnderlayPendingFrameId !== id)
      return 0;
    let n = 0;
    if (frameUnderlayClearCommand) {
      target.push(frameUnderlayClearCommand);
      frameUnderlayClearCommand = null;
      n++;
    }
    for (const cmd of frameUnderlayPendingCommands)
      if (cmd) {
        target.push(cmd);
        n++;
      }
    frameUnderlayPendingCommands.length = 0;
    frameUnderlayPendingFrameId = id;
    frameUnderlayEmbeddedCommands += n;
    return n;
  }
  function compositeLayerBatchToFrameUnderlay(batch, role, frameId) {
    const id = Number(frameId) || 0;
    if (!batch?.roles?.has?.(role) || !prepareFrameUnderlay(id)) return false;
    const surf = layerBatchSurfaces[role];
    if (!surf?.texture) return false;
    try {
      let bg = surf.underlayBindGroup;
      if (!bg) {
        bg = device.createBindGroup({
          layout: circleCompositeLayout,
          entries: [
            { binding: 0, resource: surf.view },
            { binding: 1, resource: circleSampler },
          ],
        });
        surf.underlayBindGroup = bg;
      }
      if (!surf.underlayBundle) {
        surf.underlayBundle = buildFullscreenBundle(
          frameUnderlayPipelineBehind,
          bg,
          `SpiroStar ${role} underlay render bundle`,
        );
        if (surf.underlayBundle) {
          surf.underlayBundleList[0] = surf.underlayBundle;
          underlayBundleBuilds++;
        }
      }
      const enc = device.createCommandEncoder({
          label: `SpiroStar ${role} -> global destination-over underlay`,
        }),
        pass = enc.beginRenderPass({
          colorAttachments: [{ view: frameUnderlayView, loadOp: 'load', storeOp: 'store' }],
        });
      if (surf.underlayBundle) {
        pass.executeBundles(surf.underlayBundleList);
        underlayBundleExecutes++;
        renderBundleExecutes++;
      } else {
        pass.setPipeline(frameUnderlayPipelineBehind);
        pass.setBindGroup(0, bg);
        pass.draw(3);
      }
      pass.end();
      const underlayCommand = enc.finish();

      if (
        deferredLayerScene?.batch === batch &&
        deferredLayerScene?.frameId === id &&
        deferredLayerScene?.commandBuffer
      ) {
        if (frameUnderlayPendingFrameId !== id) frameUnderlayPendingFrameId = id;
        frameUnderlayPendingCommands.push(underlayCommand);
        frameUnderlayComposites++;
        frameUnderlayQueuedCommands++;
        frameUnderlayDeferredBatches++;
        return true;
      }

      const commands = [];
      if (frameUnderlayClearCommand) commands.push(frameUnderlayClearCommand);
      const ownsBatch = batch.submitted !== true;
      if (ownsBatch) {
        if (!batch.commandBuffer) return false;
        commands.push(batch.commandBuffer);
      }
      for (const cmd of frameUnderlayPendingCommands) if (cmd) commands.push(cmd);
      commands.push(underlayCommand);
      device.queue.submit(commands);
      frameUnderlaySubmissions++;
      frameUnderlayMergedSubmissions++;
      frameUnderlayComposites++;
      if (ownsBatch) {
        batch.submitted = true;
        batch.commandBuffer = null;
        if (deferredLayerScene?.batch === batch) deferredLayerScene.commandBuffer = null;
        lastSubmit++;
        layerBatchSubmissions++;
      }
      markFrameUnderlayCommandsSubmitted(id);
      return true;
    } catch (err) {
      lastError = String(err?.message || err);
      return false;
    }
  }
  function presentFrameUnderlayToMain(frameId, targetCtx = mainCtx, disableForFrame = true) {
    const id = Number(frameId) || 0;
    if (!getFrameUnderlayTexture(id) || !targetCtx) return false;
    try {
      if (!ensureLayerSceneFallbackSurface()) return false;
      const enc = device.createCommandEncoder({ label: 'SpiroStar global underlay fallback copy' });
      enc.copyTextureToTexture(
        { texture: frameUnderlayTexture },
        { texture: layerSceneFallbackSurface.context.getCurrentTexture() },
        [layerSceneWidth, layerSceneHeight, 1],
      );
      const q = getFrameUnderlayCommandBuffers(id),
        commands = [];
      if (q.clearCommand) commands.push(q.clearCommand);
      for (const cmd of q.effectCommands) if (cmd) commands.push(cmd);
      commands.push(enc.finish());
      device.queue.submit(commands);
      frameUnderlaySubmissions++;
      if (commands.length > 1) frameUnderlayMergedSubmissions++;
      markFrameUnderlayCommandsSubmitted(id);
      targetCtx.save();
      targetCtx.setTransform(1, 0, 0, 1, 0, 0);
      targetCtx.globalAlpha = 1;
      targetCtx.globalCompositeOperation = 'destination-over';
      targetCtx.filter = 'none';
      targetCtx.drawImage(layerSceneFallbackSurface.canvas, 0, 0);
      targetCtx.restore();
      frameUnderlayFallbacks++;
      frameUnderlayPresented++;
      frameUnderlayActive = false;
      if (disableForFrame) frameUnderlayDisabledFrameId = id;
      return true;
    } catch (err) {
      lastError = String(err?.message || err);
      return false;
    }
  }
  function markFrameUnderlayPresented(frameId) {
    const id = Number(frameId) || 0;
    if (!getFrameUnderlayTexture(id)) return false;
    markFrameUnderlayCommandsSubmitted(id);
    frameUnderlayActive = false;
    frameUnderlayPresented++;
    return true;
  }
  function discardFrameUnderlay(frameId) {
    const id = Number(frameId) || 0;
    if (!id || frameUnderlayFrameId !== id) return false;
    resetFrameUnderlayQueue();
    frameUnderlayActive = false;
    frameUnderlayFallbacks++;
    return true;
  }
  function abandonFrameUnderlay(frameId, targetCtx = mainCtx) {
    const id = Number(frameId) || 0;
    if (getFrameUnderlayTexture(id)) presentFrameUnderlayToMain(id, targetCtx, true);
    else {
      frameUnderlayDisabledFrameId = id;
      resetFrameUnderlayQueue();
    }
    return true;
  }
  function deferLayerScene(batch, frameId) {
    if (!batch?.sceneCombined || !batch?.sceneTexture || batch.submitted === true || !batch.commandBuffer)
      return false;
    deferredLayerScene = {
      texture: batch.sceneTexture,
      commandBuffer: batch.commandBuffer,
      batch,
      frameId: Number(frameId) || 0,
      generation: hubGeneration,
    };
    layerSceneDeferredFrames++;
    return true;
  }
  function canUseExternalLayerScene(frameId = 0) {
    warmup();
    const id = Number(frameId) || 0;
    return Boolean(
      ready &&
      !lost &&
      !deferredLayerScene &&
      ensureLayerBatchSize(mainCanvas.width, mainCanvas.height) &&
      (!id || frameSceneDisabledFrameId !== id),
    );
  }

  function getExternalLayerSceneTarget(frameId = 0) {
    const id = Number(frameId) || 0;
    if (!canUseExternalLayerScene(id)) return null;
    return {
      texture: layerSceneTexture,
      view: layerSceneView,
      width: layerSceneWidth,
      height: layerSceneHeight,
      format,
      frameId: id,
    };
  }

  function beginExternalLayerScene(frameId = 0, label = 'external-empty') {
    const t = getExternalLayerSceneTarget(frameId);
    if (!t?.view) return false;
    try {
      const enc = device.createCommandEncoder({ label: `SpiroStar ${label} Layer Scene root` }),
        pass = enc.beginRenderPass({
          colorAttachments: [
            { view: t.view, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' },
          ],
        });
      pass.end();
      return deferExternalLayerScene(enc.finish(), frameId, label);
    } catch (err) {
      lastError = String(err?.message || err);
      return false;
    }
  }
  function deferExternalLayerScene(commandBuffer, frameId, label = 'external') {
    if (!commandBuffer || !canUseExternalLayerScene(frameId)) return false;
    const id = Number(frameId) || 0;
    deferredLayerScene = {
      texture: layerSceneTexture,
      commandBuffer,
      batch: null,
      frameId: id,
      generation: hubGeneration,
      external: true,
      label: String(label || 'external'),
    };
    layerSceneDeferredFrames++;
    externalLayerSceneFrames++;
    return true;
  }
  function getDeferredLayerSceneTexture(frameId) {
    if (!deferredLayerScene || deferredLayerScene.generation !== hubGeneration) return null;
    const id = Number(frameId) || 0;
    if (id && deferredLayerScene.frameId !== id) return null;
    return deferredLayerScene;
  }
  function getDeferredLayerSceneCommandBuffer(frameId) {
    const rec = getDeferredLayerSceneTexture(frameId);
    return rec?.commandBuffer || null;
  }
  function markDeferredLayerScenePresented(frameId) {
    const rec = getDeferredLayerSceneTexture(frameId);
    if (!rec) return false;
    if (rec.batch) {
      rec.batch.submitted = true;
      rec.batch.commandBuffer = null;
    } else if (rec.external === true) externalLayerSceneSubmissions++;
    lastSubmit++;
    layerBatchSubmissions++;
    deferredLayerScene = null;
    layerSceneDeferredPresented++;
    return true;
  }
  function copyLayerSceneToFallback(commandBuffer = null, extraCommands = null) {
    if (!layerSceneTexture || !ensureLayerSceneFallbackSurface()) return false;
    const encoder = device.createCommandEncoder({ label: 'SpiroStar layer scene fallback copy' });
    encoder.copyTextureToTexture(
      { texture: layerSceneTexture },
      { texture: layerSceneFallbackSurface.context.getCurrentTexture() },
      [layerSceneWidth, layerSceneHeight, 1],
    );
    const copyCommand = encoder.finish();
    const commands = [];
    if (commandBuffer) commands.push(commandBuffer);
    if (Array.isArray(extraCommands)) for (const cmd of extraCommands) if (cmd) commands.push(cmd);
    commands.push(copyCommand);
    device.queue.submit(commands);
    if (commandBuffer) {
      lastSubmit++;
      layerBatchSubmissions++;
    }
    return true;
  }
  function presentDeferredLayerSceneToMain(frameId, targetCtx = mainCtx, extraCommands = null) {
    const rec = getDeferredLayerSceneTexture(frameId);
    if (!rec || !targetCtx) return false;
    try {
      if (!copyLayerSceneToFallback(rec.commandBuffer, extraCommands)) return false;
      if (rec.batch) {
        rec.batch.submitted = true;
        rec.batch.commandBuffer = null;
      } else if (rec.external === true) externalLayerSceneSubmissions++;
      targetCtx.save();
      targetCtx.setTransform(1, 0, 0, 1, 0, 0);
      targetCtx.globalAlpha = 1;
      targetCtx.globalCompositeOperation = 'source-over';
      targetCtx.filter = 'none';
      targetCtx.drawImage(layerSceneFallbackSurface.canvas, 0, 0);
      targetCtx.restore();
      deferredLayerScene = null;
      layerSceneDeferredFallbacks++;
      layerSceneComposites++;
      return true;
    } catch (err) {
      lastError = String(err?.message || err);
      return false;
    }
  }
  function clearDeferredLayerScene() {
    deferredLayerScene = null;
  }
  function compositeLayerScene(batch, targetCtx) {
    if (!batch?.sceneCombined || !targetCtx) return false;
    try {
      if (!copyLayerSceneToFallback(batch.submitted ? null : batch.commandBuffer)) return false;
      if (!batch.submitted) {
        batch.submitted = true;
        batch.commandBuffer = null;
      }
      targetCtx.save();
      targetCtx.setTransform(1, 0, 0, 1, 0, 0);
      targetCtx.globalAlpha = 1;
      targetCtx.globalCompositeOperation = 'source-over';
      targetCtx.filter = 'none';
      targetCtx.drawImage(layerSceneFallbackSurface.canvas, 0, 0);
      targetCtx.restore();
      layerSceneComposites++;
      return true;
    } catch (err) {
      lastError = String(err?.message || err);
      return false;
    }
  }
  function compositeLayerBatch(batch, role, targetCtx, composite = null) {
    if (!batch?.roles?.has?.(role) || !targetCtx) return false;
    const surf = layerBatchSurfaces[role];
    if (!surf?.texture) return false;
    try {
      if (!ensureLayerBatchFallbackSurface(role)) return false;
      const encoder = device.createCommandEncoder({ label: `SpiroStar layer batch ${role} fallback copy` });
      encoder.copyTextureToTexture(
        { texture: surf.texture },
        { texture: surf.fallbackContext.getCurrentTexture() },
        [layerBatchWidth, layerBatchHeight, 1],
      );
      const copyCommand = encoder.finish();
      if (!submitLayerBatchCommands(batch, [copyCommand])) return false;
      targetCtx.save();
      targetCtx.setTransform(1, 0, 0, 1, 0, 0);
      targetCtx.globalAlpha = 1;
      targetCtx.globalCompositeOperation = composite || batch.composites?.[role] || 'source-over';
      targetCtx.filter = 'none';
      targetCtx.drawImage(surf.fallbackCanvas, 0, 0);
      targetCtx.restore();
      layerBatchComposites++;
      return true;
    } catch (err) {
      lastError = String(err?.message || err);
      return false;
    }
  }
  function submitBuffer(
    buffer,
    k,
    mode,
    blendKind,
    targetCtx,
    composite,
    deferComposite = false,
    effectOpt = null,
  ) {
    if (!buffer || !k || !ensureSize(mainCanvas.width, mainCanvas.height)) return false;
    try {
      writeStrokeUniforms(mode, effectOpt);
      const encoder = device.createCommandEncoder({ label: 'SpiroStar stroke encoder' });
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: context.getCurrentTexture().createView(),
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            loadOp: 'clear',
            storeOp: 'store',
          },
        ],
      });
      pass.setPipeline(blendKind === 'max' ? pipelineMax : pipelineOver);
      pass.setBindGroup(0, bindGroup);
      pass.setVertexBuffer(0, cornerBuffer);
      pass.setVertexBuffer(1, buffer);
      pass.draw(6, k);
      pass.end();
      device.queue.submit([encoder.finish()]);
      lastMode = mode;
      lastSubmit++;
      if (!deferComposite) return compositeTo(targetCtx, composite);
      return true;
    } catch (err) {
      lastError = String(err?.message || err);
      return false;
    }
  }
  function submit(k, mode, blendKind, targetCtx, composite, deferComposite = false, effectOpt = null) {
    if (!k || !ensureSize(mainCanvas.width, mainCanvas.height)) return false;
    const ringBuffer = instanceBuffers[lastSubmit % instanceBuffers.length];
    try {
      device.queue.writeBuffer(ringBuffer, 0, data.buffer, data.byteOffset, k * FLOATS_PER_INSTANCE * 4);
      dynamicUploadBytes += k * FLOATS_PER_INSTANCE * 4;
    } catch (err) {
      lastError = String(err?.message || err);
      return false;
    }
    return submitBuffer(ringBuffer, k, mode, blendKind, targetCtx, composite, deferComposite, effectOpt);
  }
  function compositeTo(targetCtx, composite = 'source-over') {
    if (!targetCtx || !canvas || !ready) return false;
    try {
      targetCtx.save();
      targetCtx.setTransform(1, 0, 0, 1, 0, 0);
      targetCtx.globalAlpha = 1;
      targetCtx.globalCompositeOperation = composite || 'source-over';
      targetCtx.filter = 'none';
      targetCtx.drawImage(canvas, 0, 0);
      targetCtx.restore();
      return true;
    } catch (err) {
      lastError = String(err?.message || err);
      return false;
    }
  }
  function getCommandSegmentMeta(commands) {
    if (!commands || typeof commands !== 'object') return GeometryKernel.inspectStrokeCommands(commands);
    const hit = commandSegmentMetaCache.get(commands);
    if (hit) {
      canonicalMetaHits++;
      return hit;
    }
    const meta = GeometryKernel.inspectStrokeCommands(commands);
    commandSegmentMetaCache.set(commands, meta);
    canonicalMetaBuilds++;
    return meta;
  }
  function countCommandSegments(commands) {
    return getCommandSegmentMeta(commands).count;
  }
  function packGeometryCommands(commands, out) {
    let k = 0,
      firstStyle = null,
      multiStyle = false;

    for (const cmd of commands || []) {
      const style = String(cmd?.strokeStyle || '#ffffff');
      if (firstStyle === null) firstStyle = style;
      else if (style !== firstStyle) multiStyle = true;
      if (cmd?.__variableWidthSpiral === true) {
        variableWidthPackedCommands++;
        if (cmd?.__adaptiveWebGPU === true) {
          adaptivePackedCommands++;
          adaptiveCanonicalSegments += Math.max(0, (Number(cmd.__canonicalPointCount) || 0) - 1);
          adaptiveGpuSegments += Math.max(0, (Number(cmd.__gpuPointCount) || 0) - 1);
        }
      }
    }
    let lastCmd = null,
      c = null,
      hwBase = 1,
      colorAlpha = 1;
    for (const seg of GeometryKernel.strokeSegments(commands, 'strokePack')) {
      const cmd = seg.command;
      if (cmd !== lastCmd) {
        c = parseColor(cmd?.strokeStyle);
        colorAlpha = c[3];
        hwBase = Math.max(0.001, (Number(cmd?.screenLineWidth) || 1) * 0.5);
        lastCmd = cmd;
      }
      const alpha = Math.max(0, Math.min(1, Number(seg.rawAlpha) * colorAlpha));
      if (alpha <= 0.0001) continue;
      const o = k * FLOATS_PER_INSTANCE;
      out[o] = seg.ax;
      out[o + 1] = seg.ay;
      out[o + 2] = seg.bx;
      out[o + 3] = seg.by;
      out[o + 4] = hwBase * seg.widthScaleA;
      out[o + 5] = hwBase * seg.widthScaleB;
      out[o + 6] = colorAlpha;
      out[o + 7] = c[0];
      out[o + 8] = c[1];
      out[o + 9] = c[2];
      out[o + 10] = alpha;
      k++;
      if (seg.variable) variableWidthPackedSegments++;
    }
    return { k, blendKind: multiStyle ? 'over' : 'max' };
  }
  function touchStaticGeometryRecord(commands, rec) {
    staticGeometryBuffers.delete(commands);
    staticGeometryBuffers.set(commands, rec);
    return rec;
  }
  function getStaticGeometryRecord(commands) {
    let rec = staticGeometryBuffers.get(commands);
    if (rec && rec.generation === hubGeneration && rec.buffer) {
      staticBufferHits++;
      return touchStaticGeometryRecord(commands, rec);
    }
    if (rec) {
      try {
        rec.buffer?.destroy?.();
      } catch (error) {
        noteSuppressedError('gpu/stroke-renderer#getStaticGeometryRecord', error);
      }
      staticGeometryBuffers.delete(commands);
    }
    const count = countCommandSegments(commands);
    if (!count) return { buffer: null, k: 0, blendKind: 'max', generation: hubGeneration };
    const packed = new Float32Array(count * FLOATS_PER_INSTANCE),
      meta = packGeometryCommands(commands, packed);
    if (!meta.k) return { buffer: null, k: 0, blendKind: meta.blendKind, generation: hubGeneration };
    const buffer = device.createBuffer({
      size: Math.max(4, meta.k * FLOATS_PER_INSTANCE * 4),
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      label: 'SpiroStar static stroke instances',
    });
    device.queue.writeBuffer(buffer, 0, packed.buffer, packed.byteOffset, meta.k * FLOATS_PER_INSTANCE * 4);
    staticUploadBytes += meta.k * FLOATS_PER_INSTANCE * 4;
    staticBufferBuilds++;
    rec = { buffer, k: meta.k, blendKind: meta.blendKind, generation: hubGeneration };
    touchStaticGeometryRecord(commands, rec);
    while (staticGeometryBuffers.size > staticBufferLimit()) {
      const first = staticGeometryBuffers.keys().next().value,
        old = staticGeometryBuffers.get(first);
      try {
        old?.buffer?.destroy?.();
      } catch (error) {
        noteSuppressedError('gpu/stroke-renderer#getStaticGeometryRecord', error);
      }
      staticGeometryBuffers.delete(first);
      staticBufferEvictions++;
    }
    return rec;
  }
  function canUseIndexedMorphCapsules(commands) {
    return Boolean(
      commands?.__spiroPhaseResidentRecorder === true &&
      commands?.__spiroFrameResidentDynamic === true &&
      indexedMorphBindGroupLayout &&
      indexedMorphPipelineMax &&
      indexedMorphPipelineOver,
    );
  }
  function indexedMorphTopologyIdentity(commands) {
    return `${Number(commands?.__spiroTopologyHash) || 0}|${commands?.length || 0}|${Number(commands?.__spiroPhaseSerial) || 0}`;
  }
  // WeakMap keys alone are not enough: indexedMorphTopologyRecords is a
  // strong Set and Orange replaces the command owner on every generation.
  // Retire old topology buffers after the GPU in-flight safety window.
  function retireIndexedMorphTopologyRecord(rec, frameId) {
    if (!rec || !indexedMorphTopologyRecords.has(rec)) return;
    if (rec.cacheCommands) indexedMorphTopologyCache.delete(rec.cacheCommands);
    rec.cacheCommands = null;
    indexedMorphTopologyRecords.delete(rec);
    indexedMorphRetiredTopologies.push({ record: rec, retireAfterFrame: frameId + 4 });
  }
  function pruneIndexedMorphTopologies(frameId) {
    if (indexedMorphRetiredTopologies.length) {
      const keep = [];
      for (const item of indexedMorphRetiredTopologies) {
        if (item.retireAfterFrame <= frameId) {
          try {
            item.record?.buffer?.destroy?.();
          } catch (error) {
            noteSuppressedError('gpu/stroke-renderer#pruneIndexedMorphTopologies', error);
          }
          item.record.buffer = null;
        } else keep.push(item);
      }
      indexedMorphRetiredTopologies = keep;
    }
    const limit = 32,
      staleAfterFrames = 150;
    for (const rec of [...indexedMorphTopologyRecords]) {
      if (frameId - (Number(rec.lastUsedFrame) || 0) > staleAfterFrames)
        retireIndexedMorphTopologyRecord(rec, frameId);
    }
    if (indexedMorphTopologyRecords.size > limit) {
      const old = [...indexedMorphTopologyRecords].sort(
        (a, b) => (a.lastUsedFrame || 0) - (b.lastUsedFrame || 0),
      );
      for (const rec of old) {
        if (indexedMorphTopologyRecords.size <= limit) break;
        if (frameId - (Number(rec.lastUsedFrame) || 0) > 8) retireIndexedMorphTopologyRecord(rec, frameId);
      }
    }
  }
  function buildIndexedMorphTopology(commands) {
    if (!canUseIndexedMorphCapsules(commands)) return null;
    const identity = indexedMorphTopologyIdentity(commands),
      hit = indexedMorphTopologyCache.get(commands),
      frameId = frameResidentDynamicFrameId(commands);
    if (hit?.identity === identity && hit?.buffer) {
      hit.lastUsedFrame = frameId;
      indexedMorphTopologyHits++;
      pruneIndexedMorphTopologies(frameId);
      return hit;
    }
    if (hit?.buffer) {
      indexedMorphTopologyChanges++;
      retireIndexedMorphTopologyRecord(hit, frameId);
    }
    pruneIndexedMorphTopologies(frameId);
    const pointEntries = [],
      segmentEntries = [],
      commandEntries = [];
    let segmentCount = 0,
      hasPerSegmentAlpha = false;
    for (let ci = 0; ci < commands.length; ci++) {
      const cmd = commands[ci];
      commandEntries.push(cmd);
      const variable = cmd?.__variableWidthSpiral === true;
      for (const sp of cmd?.subpaths || []) {
        const pts = sp?.points || [],
          base = pointEntries.length,
          segmentAlphaArray =
            Array.isArray(sp?.segmentAlphas) || ArrayBuffer.isView(sp?.segmentAlphas)
              ? sp.segmentAlphas
              : null;
        if (segmentAlphaArray) hasPerSegmentAlpha = true;
        for (const p of pts) pointEntries.push({ point: p, variable });
        const n = Math.max(0, pts.length - 1) + (sp?.closed ? 1 : 0);
        for (let si = 0; si < n; si++) {
          segmentEntries.push({
            sp,
            segIndex: si,
            cmd,
            cmdIndex: ci,
            a: base + si,
            b: base + ((si + 1) % pts.length),
            hasSegmentAlpha: Boolean(segmentAlphaArray),
          });
          segmentCount++;
        }
      }
    }
    if (pointEntries.length < 2 || segmentCount < 1) return null;
    const topoData = new Uint32Array(segmentCount * 4);
    for (let i = 0; i < segmentEntries.length; i++) {
      const e = segmentEntries[i],
        o = i * 4;
      topoData[o] = e.a;
      topoData[o + 1] = e.b;
      topoData[o + 2] = e.cmdIndex;
      topoData[o + 3] = e.hasSegmentAlpha ? 1 : 0;
    }
    const buffer = device.createBuffer({
      size: Math.max(16, topoData.byteLength),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      label: 'SpiroStar indexed Morph topology',
    });
    device.queue.writeBuffer(buffer, 0, topoData.buffer, topoData.byteOffset, topoData.byteLength);
    indexedMorphTopologyUploadBytes += topoData.byteLength;
    indexedMorphTopologyBuilds++;
    const rec = {
      identity,
      buffer,
      pointEntries,
      segmentEntries,
      commandEntries,
      pointCount: pointEntries.length,
      segmentCount,
      commandCount: commandEntries.length,
      hasPerSegmentAlpha,
      generation: hubGeneration,
      cacheCommands: commands,
      lastUsedFrame: frameId,
    };
    indexedMorphTopologyCache.set(commands, rec);
    indexedMorphTopologyRecords.add(rec);
    pruneIndexedMorphTopologies(frameId);
    return rec;
  }
  function ensureIndexedMorphSlot(index, topology) {
    let rec = indexedMorphSlots[index];
    if (!rec) {
      rec = {
        pointBuffer: null,
        alphaBuffer: null,
        commandBuffer: null,
        pointData: null,
        alphaData: null,
        commandData: null,
        pointCapacity: 0,
        segmentCapacity: 0,
        commandCapacity: 0,
        lastFrameId: 0,
        frameId: 0,
        slot: index,
        generation: hubGeneration,
        bindGroups: new Map(),
        linearBindGroups: new Map(),
        residentOwnerRef: null,
        residentPinned: false,
        pointUploadValid: false,
        alphaUploadValid: false,
        commandUploadValid: false,
        linearSourceBuffer: null,
        linearTargetBuffer: null,
        linearSourceData: null,
        linearTargetData: null,
        linearCapacity: 0,
        linearIdentity: null,
        linearSignature: null,
        linearActive: false,
        linearT: 0,
        linearTransformBuffer: null,
        linearTransformData: null,
        linearTransformValid: false,
        linearBundles: new Map(),
      };
      indexedMorphSlots[index] = rec;
    }
    if (rec.generation !== hubGeneration) {
      try {
        rec.pointBuffer?.destroy?.();
      } catch (error) {
        noteSuppressedError('gpu/stroke-renderer#ensureIndexedMorphSlot', error);
      }
      try {
        rec.alphaBuffer?.destroy?.();
      } catch (error) {
        noteSuppressedError('gpu/stroke-renderer#ensureIndexedMorphSlot', error);
      }
      try {
        rec.commandBuffer?.destroy?.();
      } catch (error) {
        noteSuppressedError('gpu/stroke-renderer#ensureIndexedMorphSlot', error);
      }
      rec.pointBuffer = rec.alphaBuffer = rec.commandBuffer = null;
      rec.pointData = rec.alphaData = rec.commandData = null;
      rec.pointCapacity = rec.segmentCapacity = rec.commandCapacity = 0;
      rec.generation = hubGeneration;
      rec.bindGroups = new Map();
      rec.linearBindGroups = new Map();
      rec.linearBundles = new Map();
      rec.residentOwnerRef = null;
      rec.residentPinned = false;
      rec.pointUploadValid = rec.alphaUploadValid = rec.commandUploadValid = false;
      try {
        rec.linearSourceBuffer?.destroy?.();
      } catch (error) {
        noteSuppressedError('gpu/stroke-renderer#ensureIndexedMorphSlot', error);
      }
      try {
        rec.linearTargetBuffer?.destroy?.();
      } catch (error) {
        noteSuppressedError('gpu/stroke-renderer#ensureIndexedMorphSlot', error);
      }
      rec.linearSourceBuffer = rec.linearTargetBuffer = null;
      rec.linearSourceData = rec.linearTargetData = null;
      rec.linearCapacity = 0;
      rec.linearIdentity = null;
      rec.linearSignature = null;
      rec.linearActive = false;
      try {
        rec.linearTransformBuffer?.destroy?.();
      } catch (error) {
        noteSuppressedError('gpu/stroke-renderer#ensureIndexedMorphSlot', error);
      }
      rec.linearTransformBuffer = null;
      rec.linearTransformData = null;
      rec.linearTransformValid = false;
    }
    if (topology.pointCount > rec.pointCapacity || !rec.pointBuffer) {
      rec.pointCapacity = Math.max(
        topology.pointCount,
        Math.ceil(
          Math.max(
            performanceGovernor.minDynamicCapacity(256),
            rec.pointCapacity * performanceGovernor.growthFactor(),
          ),
        ),
      );
      rec.pointData = new Float32Array(rec.pointCapacity * 4);
      try {
        rec.pointBuffer?.destroy?.();
      } catch (error) {
        noteSuppressedError('gpu/stroke-renderer#ensureIndexedMorphSlot', error);
      }
      rec.pointBuffer = device.createBuffer({
        size: rec.pointCapacity * 16,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        label: `SpiroStar indexed Morph points ${index}`,
      });
      rec.bindGroups = new Map();
      rec.pointUploadValid = false;
      indexedMorphSlotGrows++;
    }
    if (topology.segmentCount > rec.segmentCapacity || !rec.alphaBuffer) {
      rec.segmentCapacity = Math.max(
        topology.segmentCount,
        Math.ceil(
          Math.max(
            performanceGovernor.minDynamicCapacity(256),
            rec.segmentCapacity * performanceGovernor.growthFactor(),
          ),
        ),
      );
      rec.alphaData = new Float32Array(rec.segmentCapacity);
      try {
        rec.alphaBuffer?.destroy?.();
      } catch (error) {
        noteSuppressedError('gpu/stroke-renderer#ensureIndexedMorphSlot', error);
      }
      rec.alphaBuffer = device.createBuffer({
        size: Math.max(4, rec.segmentCapacity * 4),
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        label: `SpiroStar indexed Morph alpha ${index}`,
      });
      rec.bindGroups = new Map();
      rec.linearBindGroups = new Map();
      rec.linearBundles = new Map();
      rec.alphaUploadValid = false;
      indexedMorphSlotGrows++;
    }
    if (topology.commandCount > rec.commandCapacity || !rec.commandBuffer) {
      rec.commandCapacity = Math.max(
        topology.commandCount,
        Math.ceil(
          Math.max(
            performanceGovernor.minDynamicCapacity(16),
            rec.commandCapacity * performanceGovernor.growthFactor(),
          ),
        ),
      );
      rec.commandData = new Float32Array(rec.commandCapacity * 8);
      try {
        rec.commandBuffer?.destroy?.();
      } catch (error) {
        noteSuppressedError('gpu/stroke-renderer#ensureIndexedMorphSlot', error);
      }
      rec.commandBuffer = device.createBuffer({
        size: Math.max(32, rec.commandCapacity * 32),
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        label: `SpiroStar indexed Morph commands ${index}`,
      });
      rec.bindGroups = new Map();
      rec.linearBindGroups = new Map();
      rec.linearBundles = new Map();
      rec.commandUploadValid = false;
      indexedMorphSlotGrows++;
    }
    return rec;
  }
  function reapIndexedMorphResidentSlots() {
    if (!indexedMorphResidencySupported || !indexedMorphResidentRecords.size) return;
    for (const rec of Array.from(indexedMorphResidentRecords)) {
      if (rec?.residentOwnerRef?.deref?.()) continue;
      if (rec) {
        rec.residentOwnerRef = null;
        rec.residentPinned = false;
        rec.bindGroups = new Map();
      }
      indexedMorphResidentRecords.delete(rec);
      indexedMorphResidentReclaims++;
    }
  }
  function acquireIndexedMorphSlot(topology, frameId, commands) {
    if (indexedMorphResidencySupported && commands && typeof commands === 'object') {
      const resident = indexedMorphResidentCache.get(commands);
      if (resident?.generation === hubGeneration && resident.residentPinned) {
        indexedMorphResidentHits++;
        return ensureIndexedMorphSlot(resident.slot, topology);
      }

      reapIndexedMorphResidentSlots();
      let idx = -1;
      for (let i = 0; i < indexedMorphSlots.length; i++) {
        const r = indexedMorphSlots[i];
        if (r && !r.residentPinned && r.lastFrameId !== frameId) {
          idx = i;
          break;
        }
      }
      if (idx < 0) idx = indexedMorphSlots.length;
      const rec = ensureIndexedMorphSlot(idx, topology);
      rec.residentOwnerRef = new WeakRef(commands);
      rec.residentPinned = true;
      indexedMorphResidentCache.set(commands, rec);
      indexedMorphResidentRecords.add(rec);
      indexedMorphResidentPins++;
      return rec;
    }
    const normal = Math.max(INDEXED_MORPH_RING, indexedMorphSlots.length);
    for (let attempt = 0; attempt < normal; attempt++) {
      const idx = (indexedMorphCursor + attempt) % Math.max(1, normal),
        rec = indexedMorphSlots[idx];
      if (!rec || (!rec.residentPinned && rec.lastFrameId !== frameId)) {
        indexedMorphCursor =
          (idx + 1) % Math.max(INDEXED_MORPH_RING, indexedMorphSlots.length || INDEXED_MORPH_RING);
        return ensureIndexedMorphSlot(idx, topology);
      }
    }
    const idx = indexedMorphSlots.length;
    indexedMorphCursor = (idx + 1) % Math.max(INDEXED_MORPH_RING, idx + 1);
    return ensureIndexedMorphSlot(idx, topology);
  }
  function protectedLinearMorphEligibility(commands) {
    const ref = commands?.__spiroFrameCtxRef,
      frameCtx = ref?.deref ? ref.deref() : ref;
    if (!frameCtx) return null;
    const plan = frameCtx.geometryPlan,
      layer = frameCtx.layer;
    if (!plan || plan.dynamic !== true || String(plan.kind) !== 'blue-circle') return null;
    if (
      state.tunnel?.active === true ||
      state.showRoundingGuides ||
      frameCtx.lineProfileStrokeOnly ||
      isSpiralLayer(layer) ||
      plan.byTopology === true
    )
      return null;
    if (getRoundingStrength(layer?.rounding) > 1e-9) return null;
    const spm = String(plan.sourceProfileMode || layer?.profileMode || 'segments'),
      tpm = String(plan.targetProfileMode || spm),
      lpm = String(layer?.profileMode || spm);
    if (spm === 'spline' || tpm === 'spline' || lpm === 'spline') return null;
    if (
      !Array.isArray(plan.sourceGeometry) ||
      !Array.isArray(plan.targetGeometry) ||
      !plan.sourceGeometry.length ||
      !plan.targetGeometry.length
    )
      return null;
    const s = Number(frameCtx.combinedScale),
      r = Number(frameCtx.combinedRotationRad);
    if (!Number.isFinite(s) || Math.abs(s) < 1e-6 || !Number.isFinite(r)) return null;
    return frameCtx;
  }
  function indexedMorphEndpointSignature(frameCtx, topology) {
    const tr = mainCtx.getTransform(),
      p = frameCtx.geometryPlan;

    return `${topology.identity}|${mainCanvas.width | 0}x${mainCanvas.height | 0}|${tr.a},${tr.b},${tr.c},${tr.d},${tr.e},${tr.f}|${String(p?.kind || '')}|${Number(commandsSafePhaseSerial(frameCtx))}`;
  }
  function commandsSafePhaseSerial(frameCtx) {
    try {
      return (
        Number(frameCtx?._glStrokeCommands?.__spiroPhaseSerial) ||
        Number(frameCtx?.geometryPlan?.progress >= 0 ? frameCtx._glStrokeCommands?.__spiroPhaseSerial : 0) ||
        0
      );
    } catch (_) {
      return 0;
    }
  }
  function multiplyProtectedAffine(a, b) {
    return [
      a[0] * b[0] + a[2] * b[1],
      a[1] * b[0] + a[3] * b[1],
      a[0] * b[2] + a[2] * b[3],
      a[1] * b[2] + a[3] * b[3],
      a[0] * b[4] + a[2] * b[5] + a[4],
      a[1] * b[4] + a[3] * b[5] + a[5],
    ];
  }
  function protectedMorphScreenAffine(frameCtx) {
    const m = mainCtx.getTransform(),
      base = [
        Number(m.a) || 0,
        Number(m.b) || 0,
        Number(m.c) || 0,
        Number(m.d) || 0,
        Number(m.e) || 0,
        Number(m.f) || 0,
      ],
      det = base[0] * base[3] - base[1] * base[2];
    if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
    const inv = [
      base[3] / det,
      -base[1] / det,
      -base[2] / det,
      base[0] / det,
      (base[2] * base[5] - base[3] * base[4]) / det,
      (base[1] * base[4] - base[0] * base[5]) / det,
    ];
    const s = Number(frameCtx?.combinedScale),
      r = Number(frameCtx?.combinedRotationRad);
    if (!Number.isFinite(s) || !Number.isFinite(r)) return null;
    const c = Math.cos(r) * s,
      q = Math.sin(r) * s,
      local = [c, q, -q, c, 0, 0];
    return multiplyProtectedAffine(multiplyProtectedAffine(base, local), inv);
  }
  function updateProtectedMorphTransform(rec, frameCtx) {
    const a = protectedMorphScreenAffine(frameCtx);
    if (!a) return false;
    if (!rec.linearTransformBuffer || !rec.linearTransformData) {
      rec.linearTransformData = new Float32Array(8);
      rec.linearTransformBuffer = device.createBuffer({
        size: 32,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        label: `SpiroStar protected Morph affine ${rec.slot}`,
      });
      rec.linearTransformValid = false;
      rec.linearBindGroups = new Map();
      rec.linearBundles = new Map();
    }

    const d = rec.linearTransformData,
      v = [a[0], a[2], a[4], Math.max(0, Math.min(1, Number(rec.linearT) || 0)), a[1], a[3], a[5], 0];
    let changed = !rec.linearTransformValid;
    for (let i = 0; i < 8; i++) {
      if (!changed && Math.abs(d[i] - v[i]) > 1e-7) changed = true;
      d[i] = v[i];
    }
    if (changed) {
      device.queue.writeBuffer(rec.linearTransformBuffer, 0, d.buffer, d.byteOffset, 32);
      rec.linearTransformValid = true;
      indexedMorphLinearTransformUploads++;
      indexedMorphLinearTransformUploadBytes += 32;
    } else indexedMorphLinearTransformUploadSkips++;
    if (frameCtx?.hasCombinedScale || frameCtx?.hasCombinedRotation) indexedMorphLinearAudioTransformFrames++;
    return true;
  }
  function recordProtectedMorphEndpoint(frameCtx, t) {
    const plan = frameCtx?.geometryPlan;
    if (!plan || !frameCtx?.drawLayerInstances) return null;
    const old = plan.progress,
      oldScale = frameCtx.combinedScale,
      oldRot = frameCtx.combinedRotationRad,
      oldRotOffset = frameCtx.combinedRotationOffset,
      oldHasScale = frameCtx.hasCombinedScale,
      oldHasRot = frameCtx.hasCombinedRotation,
      rec = createGeometryGLRecordingContext(mainCtx);
    rec.__suppressFill = true;
    try {
      plan.progress = t;
      frameCtx.combinedScale = 1;
      frameCtx.combinedRotationRad = 0;
      frameCtx.combinedRotationOffset = 0;
      frameCtx.hasCombinedScale = false;
      frameCtx.hasCombinedRotation = false;
      frameCtx.drawLayerInstances(rec, true);
      rec.__finishFrame?.();
    } catch (_) {
      return null;
    } finally {
      plan.progress = old;
      frameCtx.combinedScale = oldScale;
      frameCtx.combinedRotationRad = oldRot;
      frameCtx.combinedRotationOffset = oldRotOffset;
      frameCtx.hasCombinedScale = oldHasScale;
      frameCtx.hasCombinedRotation = oldHasRot;
    }
    if (rec.unsupported || !rec.commands?.length) return null;
    return rec.commands;
  }
  function packProtectedEndpoint(commands, topology, out) {
    if (!commands || commands.length !== topology.commandEntries.length) return false;
    let pi = 0;
    for (let ci = 0; ci < topology.commandEntries.length; ci++) {
      const base = topology.commandEntries[ci],
        cmd = commands[ci],
        baseSp = base?.subpaths || [],
        sp = cmd?.subpaths || [];
      if (sp.length !== baseSp.length) return false;
      for (let si = 0; si < baseSp.length; si++) {
        const a = baseSp[si],
          b = sp[si],
          ap = a?.points || [],
          bp = b?.points || [];
        if (Boolean(a?.closed) !== Boolean(b?.closed) || ap.length !== bp.length) return false;
        for (let j = 0; j < bp.length; j++, pi++) {
          const p = bp[j],
            x = Number(p?.x),
            y = Number(p?.y),
            w = topology.pointEntries[pi]?.variable ? Math.max(0.02, Number(p?.widthScale) || 1) : 1,
            o = pi * 4;
          if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(w)) return false;
          out[o] = x;
          out[o + 1] = y;
          out[o + 2] = w;
          out[o + 3] = 0;
        }
      }
    }
    return pi === topology.pointCount;
  }
  function prepareProtectedLinearMorph(commands, topology, rec) {
    rec.linearActive = false;
    const frameCtx = protectedLinearMorphEligibility(commands);
    if (
      !frameCtx ||
      !indexedMorphLinearBindGroupLayout ||
      !indexedMorphLinearPipelineMax ||
      !indexedMorphLinearPipelineOver
    ) {
      indexedMorphLinearFallbacks++;
      return false;
    }
    const signature = indexedMorphEndpointSignature(frameCtx, topology),
      plan = frameCtx.geometryPlan;
    if (
      rec.linearIdentity === topology.identity &&
      rec.linearSignature === signature &&
      rec.linearSourceBuffer &&
      rec.linearTargetBuffer
    ) {
      rec.linearActive = true;
      rec.linearT = Math.max(0, Math.min(1, Number(plan.progress) || 0));
      if (!updateProtectedMorphTransform(rec, frameCtx)) {
        rec.linearActive = false;
        indexedMorphLinearFallbacks++;
        return false;
      }
      indexedMorphLinearHits++;
      return true;
    }
    const source = recordProtectedMorphEndpoint(frameCtx, 0),
      target = recordProtectedMorphEndpoint(frameCtx, 1);
    if (!source || !target) {
      indexedMorphLinearFallbacks++;
      return false;
    }
    if (topology.pointCount > rec.linearCapacity || !rec.linearSourceData || !rec.linearTargetData) {
      const next = performanceGovernor.capacityFor(topology.pointCount, rec.linearCapacity, 256, 1.6),
        oldSource = rec.linearSourceBuffer,
        oldTarget = rec.linearTargetBuffer;
      rec.linearCapacity = next;
      rec.linearSourceData = new Float32Array(next * 4);
      rec.linearTargetData = new Float32Array(next * 4);

      rec.linearSourceBuffer = WebGPUBufferRecycler.acquire(
        device,
        hubGeneration,
        Math.max(64, next * 16),
        GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        `SpiroStar protected Morph source ${rec.slot}`,
      );
      rec.linearTargetBuffer = WebGPUBufferRecycler.acquire(
        device,
        hubGeneration,
        Math.max(64, next * 16),
        GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        `SpiroStar protected Morph target ${rec.slot}`,
      );
      if (oldSource) WebGPUBufferRecycler.recycle(device, hubGeneration, oldSource);
      if (oldTarget) WebGPUBufferRecycler.recycle(device, hubGeneration, oldTarget);
      rec.linearBindGroups = new Map();
      rec.linearBundles = new Map();
    }
    if (
      !packProtectedEndpoint(source, topology, rec.linearSourceData) ||
      !packProtectedEndpoint(target, topology, rec.linearTargetData)
    ) {
      indexedMorphLinearFallbacks++;
      rec.linearIdentity = null;
      return false;
    }
    const bytes = topology.pointCount * 16;
    device.queue.writeBuffer(rec.linearSourceBuffer, 0, rec.linearSourceData.buffer, 0, bytes);
    device.queue.writeBuffer(rec.linearTargetBuffer, 0, rec.linearTargetData.buffer, 0, bytes);
    indexedMorphLinearEndpointUploadBytes += bytes * 2;
    rec.linearIdentity = topology.identity;
    rec.linearSignature = signature;
    rec.linearActive = true;
    rec.linearT = Math.max(0, Math.min(1, Number(plan.progress) || 0));
    rec.linearBindGroups = new Map();
    rec.linearBundles = new Map();
    if (!updateProtectedMorphTransform(rec, frameCtx)) {
      rec.linearActive = false;
      indexedMorphLinearFallbacks++;
      return false;
    }
    indexedMorphLinearBuilds++;
    return true;
  }
  function packIndexedMorphFrame(commands, topology, rec) {
    const topologyChanged = rec.topology !== topology;
    if (topologyChanged) {
      rec.pointUploadValid = false;
      rec.alphaUploadValid = false;
      rec.commandUploadValid = false;
      if (rec.linearIdentity !== topology.identity) {
        rec.linearActive = false;
        rec.linearIdentity = null;
        rec.linearBindGroups = new Map();
        rec.linearBundles = new Map();
      }
    }
    let valid = true,
      firstStyle = null,
      multiStyle = false,
      pointChanged = !rec.pointUploadValid,
      commandChanged = !rec.commandUploadValid;
    if (!rec.linearActive) {
      for (let i = 0; i < topology.pointEntries.length; i++) {
        const e = topology.pointEntries[i],
          p = e.point,
          x = Number(p?.x),
          y = Number(p?.y),
          w = e.variable ? Math.max(0.02, Number(p?.widthScale) || 1) : 1,
          o = i * 4;
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(w)) {
          valid = false;
          break;
        }
        if (
          !pointChanged &&
          (rec.pointData[o] !== x ||
            rec.pointData[o + 1] !== y ||
            rec.pointData[o + 2] !== w ||
            rec.pointData[o + 3] !== 0)
        )
          pointChanged = true;
        rec.pointData[o] = x;
        rec.pointData[o + 1] = y;
        rec.pointData[o + 2] = w;
        rec.pointData[o + 3] = 0;
      }
      if (!valid) return null;
    } else pointChanged = false;
    for (let ci = 0; ci < topology.commandEntries.length; ci++) {
      const cmd = topology.commandEntries[ci],
        style = String(cmd?.strokeStyle || '#ffffff'),
        c = parseColor(style),
        o = ci * 8;

      const v0 = c[0],
        v1 = c[1],
        v2 = c[2],
        v3 = c[3],
        v4 = Math.max(0.001, (Number(cmd?.screenLineWidth) || 1) * 0.5),
        v5 = Math.max(0, Math.min(1, Number(cmd?.alpha) || 0)),
        v6 = 0;
      if (firstStyle === null) firstStyle = style;
      else if (style !== firstStyle) multiStyle = true;
      if (
        !commandChanged &&
        (rec.commandData[o] !== v0 ||
          rec.commandData[o + 1] !== v1 ||
          rec.commandData[o + 2] !== v2 ||
          rec.commandData[o + 3] !== v3 ||
          rec.commandData[o + 4] !== v4 ||
          rec.commandData[o + 5] !== v5 ||
          rec.commandData[o + 6] !== v6 ||
          rec.commandData[o + 7] !== 0)
      )
        commandChanged = true;
      rec.commandData[o] = v0;
      rec.commandData[o + 1] = v1;
      rec.commandData[o + 2] = v2;
      rec.commandData[o + 3] = v3;
      rec.commandData[o + 4] = v4;
      rec.commandData[o + 5] = v5;
      rec.commandData[o + 6] = v6;
      rec.commandData[o + 7] = 0;
    }

    let visible = 0,
      alphaChanged = !rec.alphaUploadValid;
    if (topology.hasPerSegmentAlpha) {
      for (let si = 0; si < topology.segmentEntries.length; si++) {
        const e = topology.segmentEntries[si],
          sp = e.sp,
          segAlpha = e.hasSegmentAlpha
            ? Array.isArray(sp?.segmentAlphas) || ArrayBuffer.isView(sp?.segmentAlphas)
              ? sp.segmentAlphas
              : null
            : null;
        let raw =
          e.hasSegmentAlpha && segAlpha && Number.isFinite(Number(segAlpha[e.segIndex]))
            ? Number(segAlpha[e.segIndex])
            : Number(e.cmd?.alpha) || 0;
        raw = Math.max(0, Math.min(1, raw));
        if (e.hasSegmentAlpha) {
          if (!alphaChanged && rec.alphaData[si] !== raw) alphaChanged = true;
          rec.alphaData[si] = raw;
        }
        if (raw > 0.0001) visible++;
      }
    } else {
      indexedMorphCpuSegmentGeometryChecksAvoided += topology.segmentCount;
      for (const cmd of topology.commandEntries)
        if ((Number(cmd?.alpha) || 0) > 0.0001) {
          visible = 1;
          break;
        }
    }
    if (!visible) return null;
    const pointBytes = topology.pointCount * 16,
      alphaBytes = topology.hasPerSegmentAlpha ? topology.segmentCount * 4 : 0,
      commandBytes = topology.commandCount * 32;
    if (rec.linearActive) {
      indexedMorphLinearPointUploadBytesAvoided += pointBytes;
      indexedMorphPointUploadSkips++;
      indexedMorphUploadBytesAvoided += pointBytes;
    } else if (pointChanged) {
      device.queue.writeBuffer(rec.pointBuffer, 0, rec.pointData.buffer, 0, pointBytes);
      rec.pointUploadValid = true;
      indexedMorphUploadBytes += pointBytes;
    } else {
      indexedMorphPointUploadSkips++;
      indexedMorphUploadBytesAvoided += pointBytes;
    }
    if (alphaBytes) {
      if (alphaChanged) {
        device.queue.writeBuffer(rec.alphaBuffer, 0, rec.alphaData.buffer, 0, alphaBytes);
        rec.alphaUploadValid = true;
        indexedMorphAlphaUploadBytes += alphaBytes;
        indexedMorphUploadBytes += alphaBytes;
      } else {
        indexedMorphAlphaContentUploadSkips++;
        indexedMorphUploadBytesAvoided += alphaBytes;
      }
    } else indexedMorphAlphaUploadSkips++;
    if (commandChanged) {
      device.queue.writeBuffer(rec.commandBuffer, 0, rec.commandData.buffer, 0, commandBytes);
      rec.commandUploadValid = true;
      indexedMorphUploadBytes += commandBytes;
    } else {
      indexedMorphCommandUploadSkips++;
      indexedMorphUploadBytesAvoided += commandBytes;
    }
    indexedMorphLegacyEquivalentBytes += topology.segmentCount * FLOATS_PER_INSTANCE * 4;
    if (topologyChanged) rec.bindGroups = new Map();
    rec.segmentCount = topology.segmentCount;
    rec.pointCount = topology.pointCount;
    rec.commandCount = topology.commandCount;
    rec.topology = topology;
    rec.blendKind = multiStyle ? 'over' : 'max';
    return rec;
  }
  function getIndexedMorphFrameRecord(commands) {
    if (!canUseIndexedMorphCapsules(commands)) return null;
    const frameId = frameResidentDynamicFrameId(commands),
      cached = indexedMorphFrameCache.get(commands);
    if (cached?.frameId === frameId && cached.record?.generation === hubGeneration) {
      indexedMorphFrameHits++;
      return cached.record;
    }
    const topology = buildIndexedMorphTopology(commands);
    if (!topology) return null;
    const rec = acquireIndexedMorphSlot(topology, frameId, commands);
    prepareProtectedLinearMorph(commands, topology, rec);
    if (!packIndexedMorphFrame(commands, topology, rec)) {
      indexedMorphFallbacks++;
      return null;
    }
    if (rec.linearActive) indexedMorphLinearFrames++;
    rec.frameId = frameId;
    rec.lastFrameId = frameId;
    rec.generation = hubGeneration;
    rec.indexedMorph = true;
    indexedMorphFrameBuilds++;
    indexedMorphSegments += topology.segmentCount;
    indexedMorphPoints += topology.pointCount;
    indexedMorphFrameCache.set(commands, { frameId, record: rec });
    return rec;
  }
  function indexedMorphBindGroup(rec, uniformBufferRef, key = 'main') {
    if (!rec || !uniformBufferRef || !rec.topology?.buffer) return null;
    const cacheKey = `${key}|s${rec.slot}|t${rec.topology.identity}`;
    let bg = rec.bindGroups.get(cacheKey);
    if (bg) {
      indexedMorphBindGroupHits++;
      return bg;
    }
    bg = device.createBindGroup({
      layout: indexedMorphBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: uniformBufferRef } },
        { binding: 1, resource: { buffer: rec.pointBuffer } },
        { binding: 2, resource: { buffer: rec.topology.buffer } },
        { binding: 3, resource: { buffer: rec.alphaBuffer } },
        { binding: 4, resource: { buffer: rec.commandBuffer } },
      ],
    });
    rec.bindGroups.set(cacheKey, bg);
    indexedMorphBindGroupBuilds++;
    return bg;
  }
  function indexedMorphLinearBindGroup(rec, uniformBufferRef, key = 'main') {
    if (
      !rec?.linearActive ||
      !uniformBufferRef ||
      !rec.linearSourceBuffer ||
      !rec.linearTargetBuffer ||
      !rec.linearTransformBuffer ||
      !rec.topology?.buffer
    )
      return null;
    const cacheKey = `${key}|s${rec.slot}|t${rec.topology.identity}`;
    let bg = rec.linearBindGroups.get(cacheKey);
    if (bg) {
      indexedMorphLinearBindGroupHits++;
      return bg;
    }
    bg = device.createBindGroup({
      layout: indexedMorphLinearBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: uniformBufferRef } },
        { binding: 1, resource: { buffer: rec.linearSourceBuffer } },
        { binding: 2, resource: { buffer: rec.linearTargetBuffer } },
        { binding: 3, resource: { buffer: rec.topology.buffer } },
        { binding: 4, resource: { buffer: rec.alphaBuffer } },
        { binding: 5, resource: { buffer: rec.commandBuffer } },
        { binding: 6, resource: { buffer: rec.linearTransformBuffer } },
      ],
    });
    rec.linearBindGroups.set(cacheKey, bg);
    indexedMorphLinearBindGroupBuilds++;
    return bg;
  }
  function indexedMorphLinearRenderBundle(rec, uniformBufferRef, mode, key = 'main') {
    if (
      !rec?.linearActive ||
      typeof device?.createRenderBundleEncoder !== 'function' ||
      !format ||
      !cornerBuffer
    )
      return null;
    if (!rec.linearBundles) rec.linearBundles = new Map();
    const blendKind =
        rec?.lineRenderMode === 'segmented'
          ? 'over'
          : mode === 4
            ? rec.blendKind === 'max'
              ? 'max'
              : 'over'
            : 'max',
      cacheKey = `${key}|p${mode === 4 ? 'base' : 'effect'}|b${blendKind}|n${rec.segmentCount}`;
    const hit = rec.linearBundles.get(cacheKey);
    if (hit) {
      indexedMorphLinearBundleHits++;
      return hit;
    }
    const bg = indexedMorphLinearBindGroup(rec, uniformBufferRef, key);
    if (!bg) return null;
    try {
      const pipeline = blendKind === 'over' ? indexedMorphLinearPipelineOver : indexedMorphLinearPipelineMax;
      const rbe = device.createRenderBundleEncoder({
        label: `SpiroStar protected Morph bundle ${cacheKey}`,
        colorFormats: [format],
      });
      rbe.setPipeline(pipeline);
      rbe.setBindGroup(0, bg);
      rbe.setVertexBuffer(0, cornerBuffer);
      rbe.draw(6, rec.segmentCount);
      const bundle = rbe.finish(),
        entry = { bundle, list: [bundle] };
      rec.linearBundles.set(cacheKey, entry);
      indexedMorphLinearBundleBuilds++;
      return entry;
    } catch (_) {
      indexedMorphLinearBundleFallbacks++;
      return null;
    }
  }
  function encodeIndexedMorphPass(pass, rec, uniformBufferRef, mode, key = 'main') {
    const linear = rec?.linearActive === true;
    if (linear) {
      const bundle = indexedMorphLinearRenderBundle(rec, uniformBufferRef, mode, key);
      if (bundle) {
        pass.executeBundles(bundle.list);
        indexedMorphLinearBundleExecutes++;
        indexedMorphDraws++;
        return true;
      }
    }
    const bg = linear
      ? indexedMorphLinearBindGroup(rec, uniformBufferRef, key)
      : indexedMorphBindGroup(rec, uniformBufferRef, key);
    if (!bg) return false;
    const segmented = rec?.lineRenderMode === 'segmented';
    if (linear)
      pass.setPipeline(
        segmented
          ? indexedMorphLinearPipelineOver
          : mode === 4
            ? rec.blendKind === 'max'
              ? indexedMorphLinearPipelineMax
              : indexedMorphLinearPipelineOver
            : indexedMorphLinearPipelineMax,
      );
    else
      pass.setPipeline(
        segmented
          ? indexedMorphPipelineOver
          : mode === 4
            ? rec.blendKind === 'max'
              ? indexedMorphPipelineMax
              : indexedMorphPipelineOver
            : indexedMorphPipelineMax,
      );
    pass.setBindGroup(0, bg);
    pass.setVertexBuffer(0, cornerBuffer);
    pass.draw(6, rec.segmentCount);
    indexedMorphDraws++;
    return true;
  }
  function submitIndexedMorph(
    rec,
    mode,
    targetCtx,
    composite = 'source-over',
    deferComposite = false,
    effectOpt = null,
  ) {
    if (!rec || !ensureSize(mainCanvas.width, mainCanvas.height)) return false;
    try {
      writeStrokeUniforms(mode, effectOpt);
      const enc = device.createCommandEncoder({ label: 'SpiroStar indexed Morph capsule encoder' }),
        pass = enc.beginRenderPass({
          colorAttachments: [
            {
              view: context.getCurrentTexture().createView(),
              clearValue: { r: 0, g: 0, b: 0, a: 0 },
              loadOp: 'clear',
              storeOp: 'store',
            },
          ],
        });
      if (!encodeIndexedMorphPass(pass, rec, uniformBuffer, mode, 'main')) {
        pass.end();
        return false;
      }
      pass.end();
      device.queue.submit([enc.finish()]);
      lastMode = mode;
      lastSubmit++;
      if (!deferComposite) return compositeTo(targetCtx, composite);
      return true;
    } catch (err) {
      lastError = String(err?.message || err);
      indexedMorphFallbacks++;
      return false;
    }
  }

  function frameResidentDynamicFrameId(commands) {
    return Math.max(1, Number(commands?.__spiroFrameId) || Number(renderRuntime?.frameId) || 1);
  }
  function ensureFrameResidentDynamicSlot(index, count) {
    let rec = frameResidentDynamicSlots[index];
    if (!rec) {
      rec = {
        buffer: null,
        data: null,
        capacity: 0,
        lastFrameId: 0,
        frameId: 0,
        k: 0,
        blendKind: 'max',
        generation: hubGeneration,
        slot: index,
      };
      frameResidentDynamicSlots[index] = rec;
    }
    if (rec.generation !== hubGeneration) {
      try {
        rec.buffer?.destroy?.();
      } catch (error) {
        noteSuppressedError('gpu/stroke-renderer#ensureFrameResidentDynamicSlot', error);
      }
      rec.buffer = null;
      rec.data = null;
      rec.capacity = 0;
      rec.generation = hubGeneration;
      rec.lastFrameId = 0;
    }
    if (count > rec.capacity || !rec.buffer || !rec.data) {
      rec.capacity = Math.max(
        count,
        Math.ceil(
          Math.max(
            performanceGovernor.minDynamicCapacity(256),
            rec.capacity * performanceGovernor.growthFactor(),
          ),
        ),
      );
      rec.data = new Float32Array(rec.capacity * FLOATS_PER_INSTANCE);
      try {
        rec.buffer?.destroy?.();
      } catch (error) {
        noteSuppressedError('gpu/stroke-renderer#ensureFrameResidentDynamicSlot', error);
      }
      rec.buffer = device.createBuffer({
        size: Math.max(4, rec.capacity * FLOATS_PER_INSTANCE * 4),
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        label: `SpiroStar frame-resident dynamic stroke ${index}`,
      });
      frameResidentDynamicSlotGrows++;
    }
    return rec;
  }
  function acquireFrameResidentDynamicSlot(count, frameId) {
    const normalCount = Math.max(FRAME_RESIDENT_DYNAMIC_RING, frameResidentDynamicSlots.length);
    for (let attempt = 0; attempt < normalCount; attempt++) {
      const index = (frameResidentDynamicCursor + attempt) % Math.max(1, normalCount);
      const rec = frameResidentDynamicSlots[index];
      if (!rec || rec.lastFrameId !== frameId) {
        frameResidentDynamicCursor =
          (index + 1) %
          Math.max(
            FRAME_RESIDENT_DYNAMIC_RING,
            frameResidentDynamicSlots.length || FRAME_RESIDENT_DYNAMIC_RING,
          );
        return ensureFrameResidentDynamicSlot(index, count);
      }
    }

    const index = frameResidentDynamicSlots.length;
    frameResidentDynamicCursor = (index + 1) % Math.max(FRAME_RESIDENT_DYNAMIC_RING, index + 1);
    return ensureFrameResidentDynamicSlot(index, count);
  }
  function inspectFrameResidentDynamicTopology(commands) {
    const layer = commands?.__spiroLayerRef;
    if (!layer || typeof layer !== 'object') return;
    const meta = getCommandSegmentMeta(commands),
      kind = String(commands?.__spiroGeometryKind || 'dynamic');
    const prev = frameResidentDynamicTopologyByLayer.get(layer);
    if (prev && prev.kind === kind && prev.count !== meta.count) frameResidentDynamicTopologyChanges++;
    frameResidentDynamicTopologyByLayer.set(layer, {
      kind,
      count: meta.count,
      frameId: frameResidentDynamicFrameId(commands),
    });
  }
  function getFrameResidentDynamicRecord(commands) {
    if (!commands?.__spiroFrameResidentDynamic || commands?.__spiroPersistentStatic === true) return null;
    const frameId = frameResidentDynamicFrameId(commands),
      cached = frameResidentDynamicCache.get(commands);
    if (cached?.frameId === frameId && cached.record?.generation === hubGeneration) {
      frameResidentDynamicHits++;
      return cached.record;
    }
    const topo = getCommandSegmentMeta(commands);
    if (topo.continuityRisk || !topo.count) return null;
    const rec = acquireFrameResidentDynamicSlot(topo.count, frameId);
    const packed = packGeometryCommands(commands, rec.data);
    if (!packed.k) return null;
    const bytes = packed.k * FLOATS_PER_INSTANCE * 4;
    device.queue.writeBuffer(rec.buffer, 0, rec.data.buffer, rec.data.byteOffset, bytes);
    rec.k = packed.k;
    rec.blendKind = packed.blendKind;
    rec.frameId = frameId;
    rec.lastFrameId = frameId;
    rec.generation = hubGeneration;
    rec.frameResidentDynamic = true;
    rec.hasVariableWidth = (commands || []).some((cmd) => cmd?.__variableWidthSpiral === true);
    frameResidentDynamicUploadBytes += bytes;
    frameResidentDynamicSegments += packed.k;
    frameResidentDynamicBuilds++;
    inspectFrameResidentDynamicTopology(commands);
    frameResidentDynamicCache.set(commands, { frameId, record: rec });
    return rec;
  }

  function renderGeometry(commands, targetCtx, deferComposite = false) {
    if (!commands?.length || !ready || lost) return false;
    const lineScale = Math.max(
      0,
      Math.min(
        1,
        (Number.isFinite(Number(commands?.__spiroLayerRef?.lineOpacity))
          ? Number(commands.__spiroLayerRef.lineOpacity)
          : 100) / 100,
      ),
    );
    const baseEffect = {
      reuseStatic: true,
      effectParam: 0,
      baseLineWidth: 1,
      alphaScale: lineScale,
      overrideColor: null,
    };
    try {
      const bezier = getBezierSpiralRecord(commands);
      if (bezier) return submitBezierSpiral(bezier, 4, targetCtx, 'source-over', deferComposite, baseEffect);
    } catch (err) {
      lastError = String(err?.message || err);
    }
    try {
      const indexed = getIndexedMorphFrameRecord(commands);
      if (indexed) {
        indexed.lineRenderMode = commandLineLayerMode(commands);
        indexed.blendKind = commandLineBlendKind(commands, indexed.blendKind);
        return submitIndexedMorph(indexed, 4, targetCtx, 'source-over', deferComposite, baseEffect);
      }
    } catch (err) {
      lastError = String(err?.message || err);
      indexedMorphFallbacks++;
    }
    try {
      const shared = prepareSharedJoinRecord(commands);
      if (shared) return submitSharedJoin(shared, 4, targetCtx, 'source-over', deferComposite, baseEffect);
    } catch (err) {
      lastError = String(err?.message || err);
      sharedJoinFallbacks++;
    }
    try {
      const resident = getFrameResidentDynamicRecord(commands);
      if (resident)
        return submitBuffer(
          resident.buffer,
          resident.k,
          4,
          commandLineBlendKind(commands, resident.blendKind),
          targetCtx,
          'source-over',
          deferComposite,
          baseEffect,
        );
    } catch (err) {
      lastError = String(err?.message || err);
    }
    if (commands.__spiroPersistentStatic === true) {
      try {
        const rec = getStaticGeometryRecord(commands);
        if (!rec.k) return true;
        return submitBuffer(
          rec.buffer,
          rec.k,
          4,
          commandLineBlendKind(commands, rec.blendKind),
          targetCtx,
          'source-over',
          deferComposite,
          baseEffect,
        );
      } catch (err) {
        lastError = String(err?.message || err);
      }
    }
    const count = countCommandSegments(commands);
    if (!count) return true;
    ensureCapacity(count);
    const meta = packGeometryCommands(commands, data);
    if (!meta.k) return true;
    return submit(
      meta.k,
      4,
      commandLineBlendKind(commands, meta.blendKind),
      targetCtx,
      'source-over',
      deferComposite,
      baseEffect,
    );
  }
  function renderEffects(commands, targetCtx, opt = {}) {
    if (!commands?.length || !ready || lost) return false;
    const auraBase = { saiyan: 2.1, drip: 4.1, mountain: 4.5 }[opt.mode];
    const mode =
      auraBase != null
        ? auraBase + (0.3 * Math.max(0, Math.min(255.999, Number(opt.auraPacked ?? 96)))) / 256
        : opt.mode === 'outline'
          ? 1
          : opt.mode === 'halo'
            ? 2
            : opt.mode === 'coreInset'
              ? 3
              : 0;
    const effectParam =
      mode === 1 || mode === 3
        ? Math.max(0, Number(opt.extraLocal) || 0)
        : Math.max(0.1, Number(opt.radiusPx) || 1);
    const sharedEffectOpt = {
      reuseStatic: true,
      effectParam,
      baseLineWidth: Math.max(0.001, Number(opt.baseLineWidth) || 1),
      alphaScale: Number.isFinite(Number(opt.alphaScale)) ? Number(opt.alphaScale) : 1,
      overrideColor: opt.colorOverride || null,
    };
    try {
      const bezier = getBezierSpiralRecord(commands);
      if (bezier)
        return submitBezierSpiral(
          bezier,
          mode,
          targetCtx,
          opt.composite || 'source-over',
          false,
          sharedEffectOpt,
        );
    } catch (err) {
      lastError = String(err?.message || err);
    }
    try {
      const shared = prepareSharedJoinRecord(commands);
      if (shared)
        return submitSharedJoin(
          shared,
          mode,
          targetCtx,
          opt.composite || 'source-over',
          false,
          sharedEffectOpt,
        );
    } catch (err) {
      lastError = String(err?.message || err);
      sharedJoinFallbacks++;
    }
    try {
      const resident = getFrameResidentDynamicRecord(commands);

      if (resident && !resident.hasVariableWidth) {
        frameResidentDynamicEffectHits++;
        return submitBuffer(
          resident.buffer,
          resident.k,
          mode,
          commandLineBlendKind(commands, 'max'),
          targetCtx,
          opt.composite || 'source-over',
          false,
          sharedEffectOpt,
        );
      }
    } catch (err) {
      lastError = String(err?.message || err);
    }

    if (commands.__spiroPersistentStatic === true) {
      try {
        const rec = getStaticGeometryRecord(commands);
        if (!rec.k) return true;
        staticEffectReuseHits++;
        return submitBuffer(
          rec.buffer,
          rec.k,
          mode,
          commandLineBlendKind(commands, 'max'),
          targetCtx,
          opt.composite || 'source-over',
          false,
          sharedEffectOpt,
        );
      } catch (err) {
        lastError = String(err?.message || err);
      }
    }
    let count = 0;
    for (const cmd of commands)
      for (const sp of cmd.subpaths || [])
        count += Math.max(0, (sp.points?.length || 0) - 1) + (sp.closed ? 1 : 0);
    if (!count) return true;
    ensureCapacity(count);
    let k = 0;
    const override = opt.colorOverride ? parseColor(opt.colorOverride) : null;
    for (const cmd of commands) {
      const c = override || parseColor(cmd.strokeStyle),
        alpha = Math.max(
          0,
          Math.min(
            1,
            (Number(cmd.alpha) || 0) *
              (Number.isFinite(Number(opt.alphaScale)) ? Number(opt.alphaScale) : 1) *
              c[3],
          ),
        );
      if (alpha <= 0.0001) continue;
      const hw = Math.max(0.001, (Number(cmd.screenLineWidth) || 1) * 0.5);
      const extra =
        mode === 1 || mode === 3
          ? Math.max(
              0,
              (Number(opt.extraLocal) || 0) *
                ((Number(cmd.screenLineWidth) || 1) / Math.max(0.001, Number(opt.baseLineWidth) || 1)),
            )
          : Math.max(0.1, Number(opt.radiusPx) || 1);
      for (const sp of cmd.subpaths || []) {
        const pts = sp.points || [],
          n = pts.length - 1 + (sp.closed ? 1 : 0);
        for (let i = 0; i < n; i++) {
          const a = pts[i],
            b = pts[(i + 1) % pts.length];
          if (!a || !b || (b.x - a.x) ** 2 + (b.y - a.y) ** 2 < 1e-8) continue;
          const variable = cmd?.__variableWidthSpiral === true,
            wa = variable ? Math.max(0.02, Number(a?.widthScale) || 1) : 1,
            wb = variable ? Math.max(0.02, Number(b?.widthScale) || wa) : 1;
          const o = k * FLOATS_PER_INSTANCE;
          data[o] = a.x;
          data[o + 1] = a.y;
          data[o + 2] = b.x;
          data[o + 3] = b.y;
          data[o + 4] = hw * wa;
          data[o + 5] = hw * wb;
          data[o + 6] = extra;
          data[o + 7] = c[0];
          data[o + 8] = c[1];
          data[o + 9] = c[2];
          data[o + 10] = alpha;
          k++;
        }
      }
    }
    if (!k) return true;
    return submit(
      k,
      mode,
      commandLineBlendKind(commands, 'max'),
      targetCtx,
      opt.composite || 'source-over',
      false,
    );
  }
  function corridorSpiralSeamT(points, index) {
    const pts = Array.isArray(points) ? points : [],
      n = pts.length;
    if (n < 2) return 0;
    const a = pts[index],
      b = pts[Math.min(n - 1, index + 1)];
    const wa = Math.max(0.02, Number(a?.widthScale) || 1),
      wb = Math.max(0.02, Number(b?.widthScale) || wa);
    const lastWidthScale = Math.max(0.02, Number(pts[n - 1]?.widthScale) || 1),
      logWidthSpan = Math.log(lastWidthScale);
    let t;
    if (Math.abs(logWidthSpan) > 1e-7) {
      const wm = Math.max(0.02, Math.sqrt(wa * wb));
      t = Math.max(0, Math.min(1, Math.log(wm) / logWidthSpan));
    } else t = Math.max(0, Math.min(1, (index + 0.5) / Math.max(1, n - 1)));
    return spiralSmoothStep01(t);
  }
  function markSpiralCorridorMaster(commands, enabled = true) {
    if (!commands || typeof commands !== 'object') return commands;
    try {
      Object.defineProperty(commands, '__spiroSpiralCorridorSeam', {
        value: enabled === true,
        configurable: true,
        writable: true,
      });
    } catch (_) {
      commands.__spiroSpiralCorridorSeam = enabled === true;
    }
    return commands;
  }
  function touchCorridorSegmentRecord(commands, rec) {
    corridorSegmentBuffers.delete(commands);
    corridorSegmentBuffers.set(commands, rec);
    return rec;
  }
  function getCorridorSegmentRecord(commands) {
    let rec = corridorSegmentBuffers.get(commands);
    if (rec && rec.generation === hubGeneration && rec.buffer) {
      corridorSegmentHits++;
      return touchCorridorSegmentRecord(commands, rec);
    }
    if (rec) {
      try {
        rec.buffer?.destroy?.();
      } catch (error) {
        noteSuppressedError('gpu/stroke-renderer#getCorridorSegmentRecord', error);
      }
      corridorSegmentBuffers.delete(commands);
    }
    const meta = getCommandSegmentMeta(commands),
      count = meta.count;
    if (!count) return { buffer: null, k: 0, generation: hubGeneration };
    const packed = new Float32Array(count * 8);
    let k = 0,
      lastCmd = null,
      hw = 0.5;
    for (const seg of GeometryKernel.strokeSegments(commands, 'corridorPack')) {
      const cmd = seg.command;
      if (cmd !== lastCmd) {
        hw = Math.max(0.001, (Number(cmd?.screenLineWidth) || 1) * 0.5);
        lastCmd = cmd;
      }
      const sa = Math.max(0, Math.min(1, Number(seg.rawAlpha) || 0));
      if (sa <= 0.0001) continue;
      const o = k * 8;
      packed[o] = seg.ax;
      packed[o + 1] = seg.ay;
      packed[o + 2] = seg.bx;
      packed[o + 3] = seg.by;
      packed[o + 4] = hw * seg.widthScaleA;
      packed[o + 5] = hw * seg.widthScaleB;
      packed[o + 6] = sa;
      packed[o + 7] = seg.variable ? corridorSpiralSeamT(seg.points, seg.segmentIndex) : 0;
      k++;
      if (seg.variable) {
        corridorVariableWidthSegments++;
        if (commands?.__spiroSpiralCorridorSeam === true) corridorSpiralSeamSegments++;
      }
    }
    if (!k) return { buffer: null, k: 0, generation: hubGeneration };
    const buffer = device.createBuffer({
      size: Math.max(32, k * 8 * 4),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      label: 'SpiroStar Corridor master segments',
    });
    device.queue.writeBuffer(buffer, 0, packed.buffer, packed.byteOffset, k * 8 * 4);
    corridorSegmentUploadBytes += k * 8 * 4;
    corridorSegmentBuilds++;
    rec = { buffer, k, generation: hubGeneration, bindGroups: [null, null, null], bindGeneration: -1 };
    touchCorridorSegmentRecord(commands, rec);
    while (corridorSegmentBuffers.size > corridorSegmentLimit()) {
      const first = corridorSegmentBuffers.keys().next().value,
        old = corridorSegmentBuffers.get(first);
      try {
        old?.buffer?.destroy?.();
      } catch (error) {
        noteSuppressedError('gpu/stroke-renderer#getCorridorSegmentRecord', error);
      }
      corridorSegmentBuffers.delete(first);
      corridorSegmentEvictions++;
    }
    return rec;
  }
  function ensureDynamicCorridorSegmentCapacity(count) {
    const desired = performanceGovernor.stickyRingCount(3, corridorDynamicSegmentBuffers.length),
      grow =
        count > corridorDynamicSegmentCapacity ||
        !corridorDynamicSegmentData ||
        corridorDynamicSegmentBuffers.some((x) => !x);
    if (grow) {
      corridorDynamicSegmentCapacity = performanceGovernor.capacityFor(
        count,
        corridorDynamicSegmentCapacity,
        256,
        1.6,
      );
      corridorDynamicSegmentData = new Float32Array(corridorDynamicSegmentCapacity * 8);
      for (const b of corridorDynamicSegmentBuffers)
        try {
          b?.destroy?.();
        } catch (error) {
          noteSuppressedError('gpu/stroke-renderer#ensureDynamicCorridorSegmentCapacity', error);
        }
      corridorDynamicSegmentBuffers = [];
      corridorDynamicSegmentGeneration++;
      corridorDynamicSegmentCache = new WeakMap();
    }
    while (corridorDynamicSegmentBuffers.length < desired)
      corridorDynamicSegmentBuffers.push(
        device.createBuffer({
          size: Math.max(32, corridorDynamicSegmentCapacity * 8 * 4),
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
          label: `SpiroStar dynamic Corridor master segments ${corridorDynamicSegmentBuffers.length}`,
        }),
      );
  }
  function getDynamicCorridorSegmentRecord(commands) {
    // Phase-resident recorder arrays are updated in place every animation frame.
    // Their identity is stable, but their geometry is NOT. Reuse a GPU master
    // only inside its exact frame; otherwise upload the new shape once.
    const frameId = Number(commands?.__spiroFrameId);
    const cacheFrame = Number.isFinite(frameId) ? frameId : -1;
    const hit = corridorDynamicSegmentCache.get(commands);
    if (
      hit &&
      cacheFrame >= 0 &&
      hit.generation === hubGeneration &&
      hit.dynamicGeneration === corridorDynamicSegmentGeneration &&
      hit.buffer &&
      hit.frameId === cacheFrame
    ) {
      corridorDynamicSegmentReuseHits++;
      return hit;
    }
    const meta = getCommandSegmentMeta(commands),
      count = meta.count;
    if (!count)
      return {
        buffer: null,
        k: 0,
        generation: hubGeneration,
        dynamicGeneration: corridorDynamicSegmentGeneration,
        bindGroups: [null, null, null],
        bindGeneration: -1,
      };
    ensureDynamicCorridorSegmentCapacity(count);
    let k = 0,
      lastCmd = null,
      hw = 0.5;
    for (const seg of GeometryKernel.strokeSegments(commands, 'corridorPack')) {
      const cmd = seg.command;
      if (cmd !== lastCmd) {
        hw = Math.max(0.001, (Number(cmd?.screenLineWidth) || 1) * 0.5);
        lastCmd = cmd;
      }
      const sa = Math.max(0, Math.min(1, Number(seg.rawAlpha) || 0));
      if (sa <= 0.0001) continue;
      const o = k * 8;
      corridorDynamicSegmentData[o] = seg.ax;
      corridorDynamicSegmentData[o + 1] = seg.ay;
      corridorDynamicSegmentData[o + 2] = seg.bx;
      corridorDynamicSegmentData[o + 3] = seg.by;
      corridorDynamicSegmentData[o + 4] = hw * seg.widthScaleA;
      corridorDynamicSegmentData[o + 5] = hw * seg.widthScaleB;
      corridorDynamicSegmentData[o + 6] = sa;
      corridorDynamicSegmentData[o + 7] = seg.variable
        ? corridorSpiralSeamT(seg.points, seg.segmentIndex)
        : 0;
      k++;
      if (seg.variable) {
        corridorVariableWidthSegments++;
        if (commands?.__spiroSpiralCorridorSeam === true) corridorSpiralSeamSegments++;
      }
    }
    if (!k)
      return {
        buffer: null,
        k: 0,
        generation: hubGeneration,
        dynamicGeneration: corridorDynamicSegmentGeneration,
        bindGroups: [null, null, null],
        bindGeneration: -1,
      };
    const buffer =
      corridorDynamicSegmentBuffers[corridorDynamicSegmentCursor++ % corridorDynamicSegmentBuffers.length];
    device.queue.writeBuffer(
      buffer,
      0,
      corridorDynamicSegmentData.buffer,
      corridorDynamicSegmentData.byteOffset,
      k * 8 * 4,
    );
    corridorDynamicSegmentUploadBytes += k * 8 * 4;
    corridorDynamicSegmentBuilds++;
    const rec = {
      buffer,
      k,
      frameId: cacheFrame,
      generation: hubGeneration,
      dynamicGeneration: corridorDynamicSegmentGeneration,
      bindGroups: [null, null, null],
      bindGeneration: -1,
    };
    corridorDynamicSegmentCache.set(commands, rec);
    return rec;
  }
  function ensureCorridorCopyCapacity(count) {
    const desired = performanceGovernor.stickyRingCount(3, corridorCopyBuffers.length),
      grow = count > corridorCopyCapacity || !corridorCopyData || corridorCopyBuffers.some((x) => !x),
      usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;
    if (grow) {
      corridorCopyCapacity = Math.max(
        count,
        Math.ceil(
          Math.max(
            performanceGovernor.minDynamicCapacity(64),
            corridorCopyCapacity * performanceGovernor.growthFactor(),
          ),
        ),
      );
      corridorCopyData = new Float32Array(corridorCopyCapacity * 16);
      for (const b of corridorCopyBuffers) if (b) WebGPUBufferRecycler.recycle(device, hubGeneration, b);
      corridorCopyBuffers = [];
      corridorCopyGeneration++;
    }
    while (corridorCopyBuffers.length < desired)
      corridorCopyBuffers.push(
        WebGPUBufferRecycler.acquire(
          device,
          hubGeneration,
          corridorCopyCapacity * 16 * 4,
          usage,
          `SpiroStar Corridor copies ${corridorCopyBuffers.length}`,
        ),
      );
  }
  // Allocate the copy ring before Corridor's first rendered frame. No copy
  // contents are uploaded here: phase/alpha/colour still come from the
  // authoritative frame packer, so visuals and ordering are unchanged.
  function prewarmCorridorCopies(count = 256) {
    if (!ready || lost || !device || !WebGPUDeviceHub.isReady()) return false;
    const n = Math.max(1, Math.min(256, Math.ceil(Number(count) || 256)));
    try {
      ensureCorridorCopyCapacity(n);
      return true;
    } catch (err) {
      lastError = String(err?.message || err);
      return false;
    }
  }
  function canUseIndexedMorphCorridor(commands) {
    return Boolean(
      commands?.__spiroSpiralCorridorSeam !== true &&
      canUseIndexedMorphCapsules(commands) &&
      indexedMorphCorridorBindGroupLayout &&
      indexedMorphCorridorPipelineMax &&
      indexedMorphCorridorPipelineOver,
    );
  }
  function indexedMorphCorridorBindGroup(
    rec,
    copyBuffer,
    key,
    uniformBuffer = corridorUniformBuffer,
    uniformKey = 'main',
  ) {
    if (!rec || !copyBuffer || !rec.topology?.buffer || !uniformBuffer) return null;
    const cacheKey = `corridor|${key}|u${uniformKey}|s${rec.slot}|t${rec.topology.identity}`;
    let bg = rec.bindGroups.get(cacheKey);
    if (bg) return bg;
    bg = device.createBindGroup({
      layout: indexedMorphCorridorBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: uniformBuffer } },
        { binding: 1, resource: { buffer: rec.pointBuffer } },
        { binding: 2, resource: { buffer: rec.topology.buffer } },
        { binding: 3, resource: { buffer: rec.alphaBuffer } },
        { binding: 4, resource: { buffer: rec.commandBuffer } },
        { binding: 5, resource: { buffer: copyBuffer } },
      ],
    });
    rec.bindGroups.set(cacheKey, bg);
    indexedMorphCorridorBindGroups++;
    return bg;
  }
  function corridorLayerSceneRole(opt) {
    const role = String(opt?.layerSceneRole || '');
    return LAYER_BATCH_ROLES.includes(role) ? role : '';
  }
  function compositeCorridorRoleToLayerScene(encoder, role, clearScene = false) {
    const surf = layerBatchSurfaces[role];
    if (
      !encoder ||
      !surf?.view ||
      !layerSceneView ||
      !circleCompositePipeline ||
      !circleCompositeLayout ||
      !circleSampler
    )
      return false;
    let bg = surf.underlayBindGroup;
    if (!bg) {
      bg = device.createBindGroup({
        layout: circleCompositeLayout,
        entries: [
          { binding: 0, resource: surf.view },
          { binding: 1, resource: circleSampler },
        ],
      });
      surf.underlayBindGroup = bg;
    }
    const attachment = { view: layerSceneView, loadOp: clearScene ? 'clear' : 'load', storeOp: 'store' };
    if (clearScene) attachment.clearValue = { r: 0, g: 0, b: 0, a: 0 };
    const pass = encoder.beginRenderPass({ colorAttachments: [attachment] });
    pass.setPipeline(circleCompositePipeline);
    pass.setBindGroup(0, bg);
    pass.draw(3);
    pass.end();
    return true;
  }
  function emptyCorridorLayerSceneCommand(clearScene = false) {
    if (!clearScene) return { handled: true, commandBuffer: null };
    if (!layerSceneView) return { handled: false, commandBuffer: null };
    const encoder = device.createCommandEncoder({ label: 'SpiroStar empty Corridor Layer Scene clear' }),
      pass = encoder.beginRenderPass({
        colorAttachments: [
          { view: layerSceneView, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' },
        ],
      });
    pass.end();
    return { handled: true, commandBuffer: encoder.finish() };
  }
  function renderIndexedMorphCorridor(
    rec,
    copyBuffer,
    copyCount,
    multiColor,
    effectMode,
    targetCtx,
    opt,
    copyKey,
    existingEncoder = null,
  ) {
    if (!rec?.segmentCount || !copyCount || !copyBuffer) return false;
    try {
      corridorUniformU32.fill(0);
      corridorUniformF32[0] = width;
      corridorUniformF32[1] = height;
      corridorUniformU32[2] = rec.segmentCount;
      corridorUniformU32[3] = effectMode;
      corridorUniformF32[4] =
        effectMode === 1 || effectMode === 3
          ? Math.max(0, Number(opt.extraLocal) || 0)
          : Math.max(0.1, Number(opt.radiusPx) || 1);
      corridorUniformF32[5] =
        effectMode >= 5 && effectMode <= 7
          ? Math.max(0, Math.min(255.999, Number(opt.auraPacked ?? 96)))
          : Math.max(0.001, Number(opt.baseLineWidth) || 1);
      const alphaScale = Number(opt.alphaScale);
      corridorUniformF32[6] = Math.max(0, Number.isFinite(alphaScale) ? alphaScale : 1);
      const override = opt.colorOverride ? parseColor(opt.colorOverride) : null;
      corridorUniformF32[7] = override ? 1 : 0;
      if (override) {
        corridorUniformF32[8] = override[0];
        corridorUniformF32[9] = override[1];
        corridorUniformF32[10] = override[2];
        corridorUniformF32[11] = override[3];
      }
      const sceneRole = corridorLayerSceneRole(opt),
        deferredUniform = sceneRole ? acquireDeferredCorridorUniform() : null;
      if (sceneRole && !deferredUniform) return false;
      if (!sceneRole) writeCorridorUniforms();
      const bg = indexedMorphCorridorBindGroup(
        rec,
        copyBuffer,
        copyKey,
        deferredUniform?.buffer || corridorUniformBuffer,
        sceneRole ? `deferred-${deferredUniform.slot}` : 'main',
      );
      if (!bg) return false;
      const surf = sceneRole ? layerBatchSurfaces[sceneRole] : null,
        targetView = sceneRole ? surf?.view : context.getCurrentTexture().createView();
      if (!targetView) return false;
      const encoder = existingEncoder || device.createCommandEncoder({
          label: sceneRole
            ? `SpiroStar indexed Morph Corridor ${sceneRole} -> Layer Scene`
            : effectMode === 4
              ? 'SpiroStar indexed Morph Corridor encoder'
              : 'SpiroStar indexed Morph Corridor effect encoder',
        }),
        pass = encoder.beginRenderPass({
          colorAttachments: [
            { view: targetView, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' },
          ],
        });

      const segmented = rec?.lineRenderMode === 'segmented';
      pass.setPipeline(
        segmented || (effectMode === 4 && multiColor)
          ? indexedMorphCorridorPipelineOver
          : indexedMorphCorridorPipelineMax,
      );
      pass.setBindGroup(0, bg);
      pass.setVertexBuffer(0, cornerBuffer);
      pass.draw(6, rec.segmentCount * copyCount);
      pass.end();
      if (sceneRole && !compositeCorridorRoleToLayerScene(encoder, sceneRole, opt.layerSceneClear === true))
        return false;
      const command = encoder.finish();
      corridorSubmit++;
      corridorDraws++;
      indexedMorphCorridorDraws++;
      indexedMorphCorridorCopies += copyCount;
      indexedMorphCorridorSegments += rec.segmentCount * copyCount;
      indexedMorphCorridorAvoidedSegmentBytes += rec.segmentCount * 8 * 4;
      if (effectMode !== 4) {
        corridorEffectDraws++;
        staticEffectReuseHits++;
      }
      if (sceneRole) return { handled: true, commandBuffer: command };
      device.queue.submit([command]);
      lastSubmit++;
      if (opt.deferComposite === true) return true;
      return compositeTo(targetCtx, opt.composite || 'source-over');
    } catch (err) {
      lastError = String(err?.message || err);
      indexedMorphCorridorFallbacks++;
      reportStrokeRuntimeErrorOnce('Indexed Morph Corridor render failed', err);
      return false;
    }
  }
  function renderCorridor(commands, copies, targetCtx, opt = {}) {
    const sceneRole = corridorLayerSceneRole(opt),
      sizeReady = sceneRole
        ? ensureLayerBatchSize(mainCanvas.width, mainCanvas.height)
        : ensureSize(mainCanvas.width, mainCanvas.height);
    if (!commands?.length || !Array.isArray(copies) || !copies.length || !ready || lost || !sizeReady)
      return false;
    try {
      lastError = '';
      // Fourier master: compute once, then instance the same points for all copies.
      // Descriptor-only commands must never fall through to CPU segment builders.
      const fourier = opt.gpuFourier === true;
      if (fourier && (!fourierComputeReady() || !indexedMorphCorridorPipelineMax || !indexedMorphCorridorPipelineOver || (opt.effectMode && opt.effectMode !== 'base') || opt.weightForCopy || opt.spiralSeamAlpha)) return false;
      const fourierEncoder = fourier ? device.createCommandEncoder({label:'Somata Fourier master + Corridor'}) : null;
      const indexed = fourier ? prepareResidentFourierBatch(commands, fourierEncoder)
        : canUseIndexedMorphCorridor(commands) ? getIndexedMorphFrameRecord(commands) : null;
      if (fourier && !indexed) return false;
      if (indexed && !fourier) {
        indexed.lineRenderMode = commandLineLayerMode(commands);
        indexed.blendKind = commandLineBlendKind(commands, indexed.blendKind);
      }
      const bezier = indexed ? null : getBezierSpiralRecord(commands);
      const segmented = commandLineLayerMode(commands) === 'segmented';
      const seg =
        indexed || bezier
          ? null
          : opt.dynamicSegments === true
            ? getDynamicCorridorSegmentRecord(commands)
            : getCorridorSegmentRecord(commands);

      if (!indexed && !bezier && !seg?.k) {
        spiralCorridorMasterGuardStats.corridorEmptyFallbacks++;
        return false;
      }
      let k = 0,
        multiColor = false,
        copyBuffer = null,
        residentRec = null;
      const cacheFrameId = opt.copyCacheFrameId,
        cacheKey =
          cacheFrameId !== undefined &&
          cacheFrameId !== null &&
          opt.copyCacheKey &&
          typeof opt.copyCacheKey === 'object'
            ? opt.copyCacheKey
            : null,
        cacheVariant = String(opt.copyCacheVariant || 'default'),
        residencyOwner =
          opt.residentCopyPayload !== false &&
          opt.copyResidencyKey &&
          typeof opt.copyResidencyKey === 'object'
            ? opt.copyResidencyKey
            : null;
      let prepared = null;

      ensureCorridorCopyCapacity(copies.length);
      if (cacheKey) {
        const bucket = corridorFrameCopyCache.get(cacheKey);
        prepared = bucket?.[cacheVariant] || null;
        if (
          prepared &&
          (prepared.frameId !== cacheFrameId ||
            prepared.generation !== hubGeneration ||
            prepared.copyGeneration !== corridorCopyGeneration ||
            prepared.copies !== copies ||
            prepared.spiralSeamAlpha !== (opt.spiralSeamAlpha === true))
        )
          prepared = null;
      }
      let residentPayload = false;
      if (prepared) {
        k = prepared.k;
        multiColor = prepared.multiColor;
        copyBuffer = prepared.buffer;
        residentPayload = prepared.resident === true;
        corridorCopyReuseHits++;
      } else {
        let firstColor = null;
        const originX = Number(opt.originX) || 0,
          originY = Number(opt.originY) || 0,
          baseAlpha = Math.max(0, Number.isFinite(Number(opt.baseAlpha)) ? Number(opt.baseAlpha) : 1),
          alphas = opt.alphas || [],
          seamAlpha = opt.spiralSeamAlpha === true;
        const sharedBasis =
          opt.sharedCorridorTransformBasis === true && cacheKey
            ? WebGPUCorridorCopyStore.getTransformBasis(cacheKey, copies, alphas, cacheKey?.layer)
            : null;
        if (sharedBasis) corridorSharedBasisUses++;
        const weightedAlphaAt = (i) => {
          if (i < 0 || i >= copies.length) return 0;
          const raw = sharedBasis
              ? sharedBasis.data[i * 6 + 4]
              : Math.max(0, Math.min(1, Number(alphas[i] ?? 1))),
            copy = copies[i],
            w = opt.weightForCopy
              ? Math.max(0, Math.min(1, Number(opt.weightForCopy(copy, raw, i)) || 0))
              : 1;
          return raw * w * baseAlpha;
        };
        for (let i = 0; i < copies.length; i++) {
          const copy = copies[i],
            alpha = weightedAlphaAt(i);
          if (alpha <= 0.0001) continue;
          const nextAlpha = seamAlpha ? (i + 1 < copies.length ? weightedAlphaAt(i + 1) : alpha) : alpha;
          let scale, c, sn;
          if (sharedBasis) {
            const b = i * 6;
            scale = sharedBasis.data[b];
            c = sharedBasis.data[b + 2];
            sn = sharedBasis.data[b + 3];
          } else {
            scale = Math.max(0.000001, Math.abs(Number(copy?.scale) || 0));
            const angle = opt.rotationForCopy ? Number(opt.rotationForCopy(copy, i)) || 0 : 0;
            c = Math.cos(angle);
            sn = Math.sin(angle);
          }
          const m00 = scale * c,
            m01 = -scale * sn,
            m10 = scale * sn,
            m11 = scale * c;
          const tx = originX - (m00 * originX + m01 * originY),
            ty = originY - (m10 * originX + m11 * originY),
            style = opt.colorForCopy
              ? String(opt.colorForCopy(copy, i) || '#ffffff')
              : String(opt.color || '#ffffff'),
            rgba = parseColor(style);
          if (firstColor === null) firstColor = style;
          else if (style !== firstColor) multiColor = true;
          const o = k * 16;
          corridorCopyData[o] = m00;
          corridorCopyData[o + 1] = m01;
          corridorCopyData[o + 2] = m10;
          corridorCopyData[o + 3] = m11;
          corridorCopyData[o + 4] = tx;
          corridorCopyData[o + 5] = ty;
          corridorCopyData[o + 6] = scale;
          corridorCopyData[o + 7] = alpha;
          corridorCopyData[o + 8] = rgba[0];
          corridorCopyData[o + 9] = rgba[1];
          corridorCopyData[o + 10] = rgba[2];
          corridorCopyData[o + 11] = rgba[3];
          corridorCopyData[o + 12] = nextAlpha;
          corridorCopyData[o + 13] = seamAlpha ? 1 : 0;
          corridorCopyData[o + 14] = 0;
          corridorCopyData[o + 15] = 0;
          k++;
          if (seamAlpha) corridorSpiralSeamCopies++;
        }
        if (!k) return sceneRole ? emptyCorridorLayerSceneCommand(opt.layerSceneClear === true) : true;
        if ((!indexed || opt.forceResidentCopyPayload === true) && residencyOwner) {
          residentRec = acquireCorridorResidentCopyRecord(residencyOwner, cacheVariant, k, cacheFrameId);
          if (!residentRec) return false;
          copyBuffer = residentRec.buffer;
          residentPayload = true;
          uploadCorridorResidentPayload(residentRec, corridorCopyData, k, multiColor, seamAlpha);
        } else {
          copyBuffer = corridorCopyBuffers[corridorSubmit % corridorCopyBuffers.length];
          device.queue.writeBuffer(
            copyBuffer,
            0,
            corridorCopyData.buffer,
            corridorCopyData.byteOffset,
            k * 16 * 4,
          );
          corridorCopyUploadBytes += k * 16 * 4;
        }
        if (cacheKey) {
          let bucket = corridorFrameCopyCache.get(cacheKey);
          if (!bucket) {
            bucket = Object.create(null);
            corridorFrameCopyCache.set(cacheKey, bucket);
          }
          bucket[cacheVariant] = {
            buffer: copyBuffer,
            k,
            multiColor,
            copies,
            frameId: cacheFrameId,
            generation: hubGeneration,
            copyGeneration: corridorCopyGeneration,
            spiralSeamAlpha: seamAlpha,
            resident: !!residentRec,
          };
        }
      }
      const effectMode =
        { saiyan: 5, drip: 6, mountain: 7 }[opt.effectMode] ??
        (opt.effectMode === 'glow'
          ? 0
          : opt.effectMode === 'outline'
            ? 1
            : opt.effectMode === 'halo'
              ? 2
              : opt.effectMode === 'coreInset'
                ? 3
                : 4);
      if (indexed) {
        if (fourier && indexed.segmentCount * k > 0xffffffff) return false;
        return renderIndexedMorphCorridor(
          indexed,
          copyBuffer,
          k,
          multiColor,
          effectMode,
          targetCtx,
          opt,
          `${cacheVariant}|${corridorCopyGeneration}|${corridorSubmit % Math.max(1, corridorCopyBuffers.length)}`,
          fourierEncoder,
        );
      }
      if (bezier) {
        const microCount = bezier.cubicCount * BEZIER_SUBDIVISIONS;
        if (!microCount || !bezierCorridorPipelineMax || !bezierCorridorPipelineOver) return false;
        corridorUniformU32.fill(0);
        corridorUniformF32[0] = width;
        corridorUniformF32[1] = height;
        corridorUniformU32[2] = microCount;
        corridorUniformU32[3] = effectMode;
        corridorUniformF32[4] =
          effectMode === 1 || effectMode === 3
            ? Math.max(0, Number(opt.extraLocal) || 0)
            : Math.max(0.1, Number(opt.radiusPx) || 1);
        corridorUniformF32[5] =
          effectMode >= 5 && effectMode <= 7
            ? Math.max(0, Math.min(255.999, Number(opt.auraPacked ?? 96)))
            : Math.max(0.001, Number(opt.baseLineWidth) || 1);
        const alphaScale = Number(opt.alphaScale);
        corridorUniformF32[6] = Math.max(0, Number.isFinite(alphaScale) ? alphaScale : 1);
        const override = opt.colorOverride ? parseColor(opt.colorOverride) : null;
        corridorUniformF32[7] = override ? 1 : 0;
        if (override) {
          corridorUniformF32[8] = override[0];
          corridorUniformF32[9] = override[1];
          corridorUniformF32[10] = override[2];
          corridorUniformF32[11] = override[3];
        }
        const deferredUniform = sceneRole ? acquireDeferredCorridorUniform() : null;
        if (sceneRole && !deferredUniform) return false;
        if (!sceneRole) writeCorridorUniforms();
        const activeUniformBuffer = deferredUniform?.buffer || corridorUniformBuffer;
        const bg = getBezierCorridorBindGroup(bezier, copyBuffer, activeUniformBuffer);
        if (!bg) return false;
        const surf = sceneRole ? layerBatchSurfaces[sceneRole] : null,
          targetView = sceneRole ? surf?.view : context.getCurrentTexture().createView();
        if (!targetView) return false;
        const encoder = device.createCommandEncoder({
            label: sceneRole
              ? `Somata 7.5 Bézier Corridor ${sceneRole}`
              : 'Somata 7.5 Bézier Corridor encoder',
          }),
          pass = encoder.beginRenderPass({
            colorAttachments: [
              { view: targetView, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' },
            ],
          });
        const useOver = segmented || (effectMode === 4 && multiColor);
        pass.setPipeline(useOver ? bezierCorridorPipelineOver : bezierCorridorPipelineMax);
        pass.setBindGroup(0, bg);
        pass.setVertexBuffer(0, cornerBuffer);
        pass.draw(6, microCount * k);
        pass.end();
        if (sceneRole && !compositeCorridorRoleToLayerScene(encoder, sceneRole, opt.layerSceneClear === true))
          return false;
        const command = encoder.finish();
        corridorSubmit++;
        corridorDraws++;
        bezierCorridorDraws++;
        bezierCorridorCopies += k;
        bezierCorridorGpuSegments += microCount * k;
        if (effectMode !== 4) {
          corridorEffectDraws++;
          staticEffectReuseHits++;
        }
        if (sceneRole) return { handled: true, commandBuffer: command };
        device.queue.submit([command]);
        lastSubmit++;
        if (opt.deferComposite === true) return true;
        return compositeTo(targetCtx, opt.composite || 'source-over');
      }
      corridorUniformU32.fill(0);
      corridorUniformF32[0] = width;
      corridorUniformF32[1] = height;
      corridorUniformU32[2] = seg.k;
      corridorUniformU32[3] = effectMode;
      corridorUniformF32[4] =
        effectMode === 1 || effectMode === 3
          ? Math.max(0, Number(opt.extraLocal) || 0)
          : Math.max(0.1, Number(opt.radiusPx) || 1);
      corridorUniformF32[5] =
        effectMode >= 5 && effectMode <= 7
          ? Math.max(0, Math.min(255.999, Number(opt.auraPacked ?? 96)))
          : Math.max(0.001, Number(opt.baseLineWidth) || 1);
      const alphaScale = Number(opt.alphaScale);
      corridorUniformF32[6] = Math.max(0, Number.isFinite(alphaScale) ? alphaScale : 1);
      const override = opt.colorOverride ? parseColor(opt.colorOverride) : null;
      corridorUniformF32[7] = override ? 1 : 0;
      if (override) {
        corridorUniformF32[8] = override[0];
        corridorUniformF32[9] = override[1];
        corridorUniformF32[10] = override[2];
        corridorUniformF32[11] = override[3];
      }
      const deferredUniform = sceneRole ? acquireDeferredCorridorUniform() : null;
      if (sceneRole && !deferredUniform) return false;
      if (!sceneRole) writeCorridorUniforms();
      const activeUniformBuffer = deferredUniform?.buffer || corridorUniformBuffer;
      let bg = null;
      if (sceneRole) {
        bg = device.createBindGroup({
          layout: corridorBindGroupLayout,
          entries: [
            { binding: 0, resource: { buffer: activeUniformBuffer } },
            { binding: 1, resource: { buffer: seg.buffer } },
            { binding: 2, resource: { buffer: copyBuffer } },
          ],
        });
        corridorBindGroupBuilds++;
      } else if (residentPayload) {
        if (!seg.residentCopyBindGroups) seg.residentCopyBindGroups = new WeakMap();
        bg = seg.residentCopyBindGroups.get(copyBuffer) || null;
        if (!bg) {
          bg = device.createBindGroup({
            layout: corridorBindGroupLayout,
            entries: [
              { binding: 0, resource: { buffer: corridorUniformBuffer } },
              { binding: 1, resource: { buffer: seg.buffer } },
              { binding: 2, resource: { buffer: copyBuffer } },
            ],
          });
          seg.residentCopyBindGroups.set(copyBuffer, bg);
          corridorBindGroupBuilds++;
        }
      } else {
        const slot = corridorSubmit % corridorCopyBuffers.length;
        if (seg.bindGeneration !== corridorCopyGeneration) {
          seg.bindGeneration = corridorCopyGeneration;
          seg.bindGroups = [null, null, null];
        }
        bg = seg.bindGroups[slot];
        if (!bg) {
          bg = device.createBindGroup({
            layout: corridorBindGroupLayout,
            entries: [
              { binding: 0, resource: { buffer: corridorUniformBuffer } },
              { binding: 1, resource: { buffer: seg.buffer } },
              { binding: 2, resource: { buffer: copyBuffer } },
            ],
          });
          seg.bindGroups[slot] = bg;
          corridorBindGroupBuilds++;
        }
      }
      const surf = sceneRole ? layerBatchSurfaces[sceneRole] : null,
        targetView = sceneRole ? surf?.view : context.getCurrentTexture().createView();
      if (!targetView) return false;
      const encoder = device.createCommandEncoder({
          label: sceneRole
            ? `SpiroStar Corridor ${sceneRole} -> Layer Scene`
            : effectMode === 4
              ? 'SpiroStar Corridor instanced encoder'
              : 'SpiroStar Corridor effect instanced encoder',
        }),
        pass = encoder.beginRenderPass({
          colorAttachments: [
            { view: targetView, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' },
          ],
        });
      const useOver = segmented || (effectMode === 4 && multiColor);
      pass.setPipeline(useOver ? corridorPipelineOver : corridorPipelineMax);
      pass.setBindGroup(0, bg);
      pass.setVertexBuffer(0, cornerBuffer);
      pass.draw(6, seg.k * k);
      pass.end();
      if (sceneRole && !compositeCorridorRoleToLayerScene(encoder, sceneRole, opt.layerSceneClear === true))
        return false;
      const command = encoder.finish();
      corridorSubmit++;
      corridorDraws++;
      if (effectMode !== 4) {
        corridorEffectDraws++;
        staticEffectReuseHits++;
      }
      if (sceneRole) return { handled: true, commandBuffer: command };
      device.queue.submit([command]);
      lastSubmit++;
      if (opt.deferComposite === true) return true;
      return compositeTo(targetCtx, opt.composite || 'source-over');
    } catch (err) {
      lastError = String(err?.message || err);
      reportStrokeRuntimeErrorOnce('Corridor render failed', err);
      return false;
    }
  }
  function releaseBezierGeometryRecord(commands) {
    const rec = commands && typeof commands === 'object' ? bezierGeometryCache.get(commands) : null;
    if (!rec) return false;
    try {
      rec.buffer?.destroy?.();
    } catch (error) {
      noteSuppressedError('gpu/stroke-renderer#releaseBezierGeometryRecord', error);
    }
    bezierBufferRecords.delete(rec);
    try {
      bezierGeometryCache.delete(commands);
    } catch (error) {
      noteSuppressedError('gpu/stroke-renderer#releaseBezierGeometryRecord', error);
    }
    bezierReleases++;
    return true;
  }
  function releaseCorridorStatic(commands) {
    let released = releaseBezierGeometryRecord(commands);
    const rec = commands ? corridorSegmentBuffers.get(commands) : null;
    if (rec) {
      try {
        rec.buffer?.destroy?.();
      } catch (error) {
        noteSuppressedError('gpu/stroke-renderer#releaseCorridorStatic', error);
      }
      corridorSegmentBuffers.delete(commands);
      released = true;
    }
    return released;
  }
  function releaseStatic(commands) {
    let released = releaseBezierGeometryRecord(commands);
    const rec = commands ? staticGeometryBuffers.get(commands) : null;
    if (rec) {
      try {
        rec.buffer?.destroy?.();
      } catch (error) {
        noteSuppressedError('gpu/stroke-renderer#releaseStatic', error);
      }
      staticGeometryBuffers.delete(commands);
      released = true;
    }
    const sj = commands ? sharedJoinStaticBuffers.get(commands) : null;
    if (sj) {
      try {
        sj.pointBuffer?.destroy?.();
      } catch (error) {
        noteSuppressedError('gpu/stroke-renderer#releaseStatic', error);
      }
      try {
        sj.segmentBuffer?.destroy?.();
      } catch (error) {
        noteSuppressedError('gpu/stroke-renderer#releaseStatic', error);
      }
      try {
        sj.styleBuffer?.destroy?.();
      } catch (error) {
        noteSuppressedError('gpu/stroke-renderer#releaseStatic', error);
      }
      sharedJoinStaticBuffers.delete(commands);
      released = true;
    }
    return released;
  }
  function clear() {
    deferredLayerScene = null; /* every WebGPU pass uses loadOp=clear; no retained pixel state */
  }
  function status() {
    warmup();
    return {
      supported: !!navigator?.gpu,
      secure: !!globalThis.isSecureContext,
      attempted,
      initializing,
      available: ready && !lost && WebGPUDeviceHub.isReady(),
      offscreenBaseReady: ready && !lost && WebGPUDeviceHub.isReady(),
      hiddenPresentationContext: !!context,
      optionalInitErrors: [...optionalInitErrors],
      lost,
      lastError,
      lastInitError,
      retryCount,
      width,
      height,
      backend: ready && !lost && WebGPUDeviceHub.isReady() ? 'webgpu' : 'fallback',
      submissions: lastSubmit,
      ringBuffers: instanceBuffers.length,
      staticBuffers: staticGeometryBuffers.size,
      staticBufferLimit: staticBufferLimit(),
      corridorSegmentLimit: corridorSegmentLimit(),
      performanceGovernor: performanceGovernor.status(),
      staticBufferHits,
      staticBufferBuilds,
      staticBufferEvictions,
      staticUploadBytes,
      dynamicUploadBytes,
      uniformResidency: {
        stroke: {
          uploads: strokeUniformUploads,
          uploadSkips: strokeUniformUploadSkips,
          uploadBytes: strokeUniformUploadBytes,
        },
        corridor: {
          uploads: corridorUniformUploads,
          uploadSkips: corridorUniformUploadSkips,
          uploadBytes: corridorUniformUploadBytes,
        },
        bufferRecycler: true,
        policy: 'exact 48-byte uniform dedup + recycler-backed grow-only stroke/corridor rings',
      },
      frameResidentDynamic: {
        slots: frameResidentDynamicSlots.length,
        builds: frameResidentDynamicBuilds,
        hits: frameResidentDynamicHits,
        effectHits: frameResidentDynamicEffectHits,
        batchHits: frameResidentDynamicBatchHits,
        slotGrows: frameResidentDynamicSlotGrows,
        uploadBytes: frameResidentDynamicUploadBytes,
        segments: frameResidentDynamicSegments,
        topologyChanges: frameResidentDynamicTopologyChanges,
      },
      indexedMorph: {
        slots: indexedMorphSlots.length,
        topologyRecords: indexedMorphTopologyRecords.size,
        retiredTopologies: indexedMorphRetiredTopologies.length,
        residencySupported: indexedMorphResidencySupported,
        residentRecords: indexedMorphResidentRecords.size,
        residentPins: indexedMorphResidentPins,
        residentHits: indexedMorphResidentHits,
        residentReclaims: indexedMorphResidentReclaims,
        cpuSegmentGeometryChecksAvoided: indexedMorphCpuSegmentGeometryChecksAvoided,
        pointUploadSkips: indexedMorphPointUploadSkips,
        commandUploadSkips: indexedMorphCommandUploadSkips,
        alphaContentUploadSkips: indexedMorphAlphaContentUploadSkips,
        uploadBytesAvoided: indexedMorphUploadBytesAvoided,
        topologyBuilds: indexedMorphTopologyBuilds,
        topologyHits: indexedMorphTopologyHits,
        topologyChanges: indexedMorphTopologyChanges,
        frameBuilds: indexedMorphFrameBuilds,
        frameHits: indexedMorphFrameHits,
        slotGrows: indexedMorphSlotGrows,
        draws: indexedMorphDraws,
        segments: indexedMorphSegments,
        points: indexedMorphPoints,
        uploadBytes: indexedMorphUploadBytes,
        topologyUploadBytes: indexedMorphTopologyUploadBytes,
        alphaUploadBytes: indexedMorphAlphaUploadBytes,
        alphaUploadSkips: indexedMorphAlphaUploadSkips,
        bindGroupBuilds: indexedMorphBindGroupBuilds,
        bindGroupHits: indexedMorphBindGroupHits,
        legacyEquivalentBytes: indexedMorphLegacyEquivalentBytes,
        uploadRatio: indexedMorphLegacyEquivalentBytes
          ? indexedMorphUploadBytes / indexedMorphLegacyEquivalentBytes
          : 1,
        fallbacks: indexedMorphFallbacks,
        protectedLinear: {
          builds: indexedMorphLinearBuilds,
          hits: indexedMorphLinearHits,
          frames: indexedMorphLinearFrames,
          fallbacks: indexedMorphLinearFallbacks,
          endpointUploadBytes: indexedMorphLinearEndpointUploadBytes,
          pointUploadBytesAvoided: indexedMorphLinearPointUploadBytesAvoided,
          bindGroupBuilds: indexedMorphLinearBindGroupBuilds,
          bindGroupHits: indexedMorphLinearBindGroupHits,
          transformUploads: indexedMorphLinearTransformUploads,
          transformUploadSkips: indexedMorphLinearTransformUploadSkips,
          transformUploadBytes: indexedMorphLinearTransformUploadBytes,
          audioTransformFrames: indexedMorphLinearAudioTransformFrames,
          renderBundles: {
            supported: typeof device?.createRenderBundleEncoder === 'function',
            builds: indexedMorphLinearBundleBuilds,
            hits: indexedMorphLinearBundleHits,
            executes: indexedMorphLinearBundleExecutes,
            fallbacks: indexedMorphLinearBundleFallbacks,
          },
          progressCarrier: 'affine-uniform-row0.w',
          progressUploadBytesPerChange: 32,
          endpointBufferRecycler: true,
          shaderContract: 'MorphAffine(row0.w=t)',
          eligibility:
            'blue-circle only; no tunnel/spiral/rounding/spline/topology morph; live scale/rotation + progress handled by affine uniform',
        },
        corridor: {
          draws: indexedMorphCorridorDraws,
          copies: indexedMorphCorridorCopies,
          logicalSegments: indexedMorphCorridorSegments,
          bindGroups: indexedMorphCorridorBindGroups,
          fallbacks: indexedMorphCorridorFallbacks,
          avoidedLegacySegmentBytes: indexedMorphCorridorAvoidedSegmentBytes,
        },
        semantic:
          'phase topology + per-command GPU record resident for complete Morph phase; unchanged point/style/alpha payloads skip queue.writeBuffer; in-place canonical descriptors; per-segment alpha only when authored; analytic capsules with GPU degeneracy guard',
      },
      corridor: {
        segmentBuffers: corridorSegmentBuffers.size,
        segmentHits: corridorSegmentHits,
        segmentBuilds: corridorSegmentBuilds,
        segmentEvictions: corridorSegmentEvictions,
        segmentUploadBytes: corridorSegmentUploadBytes,
        dynamicSegmentRing: corridorDynamicSegmentBuffers.length,
        dynamicSegmentBuilds: corridorDynamicSegmentBuilds,
        dynamicSegmentReuseHits: corridorDynamicSegmentReuseHits,
        dynamicSegmentUploadBytes: corridorDynamicSegmentUploadBytes,
        copyUploadBytes: corridorCopyUploadBytes,
        copyReuseHits: corridorCopyReuseHits,
        sharedTransformBasisUses: corridorSharedBasisUses,
        draws: corridorDraws,
        effectDraws: corridorEffectDraws,
        bindGroupBuilds: corridorBindGroupBuilds,
        copyRingBuffers: corridorCopyBuffers.length,
        residentCopies: {
          records: corridorResidentCopyRecords.size,
          limit: corridorResidentCopyLimit(),
          builds: corridorResidentBuilds,
          hits: corridorResidentHits,
          uploads: corridorResidentUploads,
          uploadBytes: corridorResidentUploadBytes,
          uploadSkips: corridorResidentUploadSkips,
          uploadBytesAvoided: corridorResidentUploadBytesAvoided,
          grows: corridorResidentGrows,
          evictions: corridorResidentEvictions,
          policy:
            'per-layer/variant persistent 16xf32 copy payload; exact cross-frame upload dedup; indexed Morph excluded by default, deferred Layer Scene opt-in supported',
        },
        variableWidthSegments: corridorVariableWidthSegments,
        spiralSeam: {
          masterBuilds: corridorSpiralMasterBuilds,
          masterHits: corridorSpiralMasterHits,
          copies: corridorSpiralSeamCopies,
          segments: corridorSpiralSeamSegments,
          copyStrideFloats: 16,
          semantic: 'segment seamT × current/next copy alpha',
        },
      },
      staticEffectReuseHits,
      layerBatch: {
        frames: layerBatchFrames,
        submissions: layerBatchSubmissions,
        draws: layerBatchDraws,
        composites: layerBatchComposites,
        failures: layerBatchFailures,
        packedReuse: layerBatchPackedReuse,
        width: layerBatchWidth,
        height: layerBatchHeight,
        uniformUploads: layerBatchUniformUploads,
        uniformUploadSkips: layerBatchUniformUploadSkips,
        uniformUploadBytes: layerBatchUniformUploadBytes,
        sceneFrames: layerSceneFrames,
        sceneComposites: layerSceneComposites,
        sceneFillUploads: layerSceneFillUploads,
        residentFillMasks: {
          records: layerSceneResidentFillMaskRecords.size,
          limit: layerSceneResidentFillMaskLimit(),
          builds: layerSceneResidentFillMaskBuilds,
          hits: layerSceneResidentFillMaskHits,
          uploads: layerSceneResidentFillMaskUploads,
          uploadSkips: layerSceneResidentFillMaskUploadSkips,
          evictions: layerSceneResidentFillMaskEvictions,
          estimatedBytes: layerSceneResidentFillMaskBytes,
          policy: 'exact static Canvas fill-rule mask -> persistent per-mask WebGPU texture',
        },
        sceneBindGroups: layerSceneBindGroups,
        sceneBindGroupHits: layerSceneBindGroupHits,
        sceneBindGroupCacheSize: layerSceneBindGroupCache.size,
        sceneTextureViewBuilds: layerSceneTextureViewBuilds,
        sceneUniformUploads: layerSceneUniformUploads,
        sceneUniformUploadSkips: layerSceneUniformUploadSkips,
        residentSceneUniforms: {
          records: layerSceneUniformRecords.size,
          builds: layerSceneUniformRecordBuilds,
          hits: layerSceneUniformRecordHits,
          uploads: layerSceneUniformRecordUploads,
          uploadSkips: layerSceneUniformRecordUploadSkips,
          bytes: layerSceneUniformRecords.size * 48,
          policy: 'one persistent 48-byte uniform per logical layer; exact upload dedup; deferred-safe',
        },
        sceneCompositeBundles: {
          supported: typeof device?.createRenderBundleEncoder === 'function',
          builds: layerSceneCompositeBundleBuilds,
          hits: layerSceneCompositeBundleHits,
          executes: layerSceneCompositeBundleExecutes,
          fallbacks: layerSceneCompositeBundleFallbacks,
        },
        sceneOutlineFrames: layerSceneOutlineFrames,
        deferredFrames: layerSceneDeferredFrames,
        deferredPresented: layerSceneDeferredPresented,
        deferredFallbacks: layerSceneDeferredFallbacks,
        deferredPending: Boolean(deferredLayerScene),
        externalFrames: externalLayerSceneFrames,
        externalSubmissions: externalLayerSceneSubmissions,
        sceneStorage: 'gpu-texture',
        roleStorage: 'gpu-textures',
        roleFallbackSurfaces: LAYER_BATCH_ROLES.reduce(
          (n, role) => n + (layerBatchSurfaces[role].fallbackCanvas ? 1 : 0),
          0,
        ),
        fallbackSurfaceAllocated: Boolean(layerSceneFallbackSurface.canvas),
        geometryCircles: {
          frames: circleScratchFrames,
          draws: circleScratchDraws,
          segments: circleScratchSegments,
          uploadBytes: circleScratchUploadBytes,
          fallbacks: circleScratchFallbacks,
          residentBufferReuses: circleResidentBufferReuses,
          fallbackPacks: circleFallbackPacks,
          uniformUploads: circleUniformUploads,
          uniformUploadSkips: circleUniformUploadSkips,
          bindGroupBuilds: circleBindGroupBuilds,
          targetViewReuses: circleTargetViewReuses,
          instanceRing: circleInstanceBuffers.length,
          uniformRing: circleUniformBuffers.length,
          capacity: circleCapacity,
          scratch: 'max->source-over; persistent views/binds; canonical buffer reuse',
        },
        underlay: {
          active: frameUnderlayActive,
          frameId: frameUnderlayFrameId,
          disabledFrameId: frameUnderlayDisabledFrameId,
          clears: frameUnderlayClears,
          composites: frameUnderlayComposites,
          submissions: frameUnderlaySubmissions,
          queuedCommands: frameUnderlayQueuedCommands,
          pendingCommands: frameUnderlayPendingCommands.length + (frameUnderlayClearCommand ? 1 : 0),
          mergedSubmissions: frameUnderlayMergedSubmissions,
          embeddedCommands: frameUnderlayEmbeddedCommands,
          deferredBatches: frameUnderlayDeferredBatches,
          fallbacks: frameUnderlayFallbacks,
          presented: frameUnderlayPresented,
        },
        frameScene: {
          active: frameSceneActive,
          frameId: frameSceneFrameId,
          disabledFrameId: frameSceneDisabledFrameId,
          sealedLayers: frameSceneSealedLayers,
          clears: frameSceneClears,
          seals: frameSceneSeals,
          directExternalLayers: frameSceneDirectExternalLayers,
          directExternalCommands: frameSceneDirectExternalCommands,
          queuedCommands: frameSceneQueuedCommands,
          pendingCommands: frameScenePendingCommands.length + (frameSceneClearCommand ? 1 : 0),
          presented: frameScenePresented,
          fallbacks: frameSceneFallbacks,
          canvasUploadAvoided: frameSceneCanvasUploadAvoided,
          storage: 'persistent GPU texture',
          renderBundles: {
            supported: typeof device?.createRenderBundleEncoder === 'function',
            builds: renderBundleBuilds,
            executes: renderBundleExecutes,
            underlayBuilds: underlayBundleBuilds,
            underlayExecutes: underlayBundleExecutes,
          },
        },
      },
      smoothSpiralBezier: {
        available: Boolean(bezierPipelineMax && bezierPipelineOver),
        subdivisionsPerCubic: BEZIER_SUBDIVISIONS,
        bufferRecords: bezierBufferRecords.size,
        builds: bezierBuilds,
        hits: bezierHits,
        uploadBytes: bezierUploads,
        cubics: bezierCubics,
        gpuSegments: bezierGpuSegments,
        cpuSamplesAvoidedEstimate: bezierCpuSamplesAvoided,
        bufferGrows: bezierBufferGrows,
        bufferReuses: bezierBufferReuses,
        capacityPeakCubics: bezierCapacityPeak,
        oversizeRejects: bezierOversizeRejects,
        releases: bezierReleases,
        fourierFallback: true,
        corridorFallback: false,
        bezierCorridor: {
          available: Boolean(bezierCorridorPipelineMax && bezierCorridorPipelineOver),
          draws: bezierCorridorDraws,
          copies: bezierCorridorCopies,
          gpuSegments: bezierCorridorGpuSegments,
          bindGroupBuilds: bezierCorridorBindGroupBuilds,
        },
        policy:
          'compact cubic control points -> WebGPU vertex evaluation; retained-cubic Corridor uses the same GPU rail; Fourier alone retains compatibility sampling',
      },
      nativeVariableWidth: {
        packedCommands: variableWidthPackedCommands,
        packedSegments: variableWidthPackedSegments,
        adaptivePackedCommands,
        adaptiveCanonicalSegments,
        adaptiveGpuSegments,
        adaptiveSavedSegments: Math.max(0, adaptiveCanonicalSegments - adaptiveGpuSegments),
        adaptiveRetention: adaptiveCanonicalSegments ? adaptiveGpuSegments / adaptiveCanonicalSegments : 1,
        sharedJoin: {
          staticLimit: sharedJoinStaticLimit(),
          eligibilityChecks: sharedJoinEligibilityChecks,
          eligibilityHits: sharedJoinEligibilityHits,
          eligibilityRejects: sharedJoinEligibilityRejects,
          morphBypasses: sharedJoinMorphBypasses,
          dynamicBypasses: sharedJoinDynamicBypasses,
          staticBuffers: sharedJoinStaticBuffers.size,
          staticHits: sharedJoinStaticHits,
          staticBuilds: sharedJoinStaticBuilds,
          staticEvictions: sharedJoinStaticEvictions,
          dynamicSlots: sharedJoinDynamicSlots.length,
          dynamicBuilds: sharedJoinDynamicBuilds,
          dynamicFrameHits: sharedJoinDynamicFrameHits,
          dynamicSlotGrows: sharedJoinDynamicSlotGrows,
          draws: sharedJoinDraws,
          bodyInstances: sharedJoinBodyInstances,
          pointInstances: sharedJoinPointInstances,
          uploadBytes: sharedJoinUploadBytes,
          fallbacks: sharedJoinFallbacks,
          semantic: 'segment-body + directional endpoint half-caps / MAX',
        },
      },
      canonicalMeta: {
        builds: canonicalMetaBuilds,
        hits: canonicalMetaHits,
        delegatedToGeometryKernel: true,
      },
      hub: WebGPUDeviceHub.status(),
    };
  }
  function invalidateMutableCommands(commands) {
    if (!commands || typeof commands !== 'object') return false;
    try {
      commandSegmentMetaCache.delete(commands);
    } catch (error) {
      noteSuppressedError('gpu/stroke-renderer#invalidateMutableCommands', error);
    }
    try {
      GeometryKernel.invalidateCommands(commands);
    } catch (error) {
      noteSuppressedError('gpu/stroke-renderer#invalidateMutableCommands', error);
    }
    try {
      sharedJoinEligibilityCache.delete(commands);
    } catch (error) {
      noteSuppressedError('gpu/stroke-renderer#invalidateMutableCommands', error);
    }
    try {
      frameResidentDynamicCache.delete(commands);
    } catch (error) {
      noteSuppressedError('gpu/stroke-renderer#invalidateMutableCommands', error);
    }
    try {
      indexedMorphFrameCache.delete(commands);
    } catch (error) {
      noteSuppressedError('gpu/stroke-renderer#invalidateMutableCommands', error);
    }

    try {
      const br = bezierGeometryCache.get(commands);
      if (br) {
        br.frameId = -1;
        br.geometryVersion = -1;
        br.profileSignature = '';
      }
    } catch (error) {
      noteSuppressedError('gpu/stroke-renderer#invalidateMutableCommands', error);
    }
    return true;
  }
  return {
    warmup,
    retry,
    prewarmCorridorCopies,
    isInitializing: () => initializing,
    isReady: () => {
      warmup();
      return ready && !lost;
    },
    supportsBezierSpiral: () => Boolean(ready && !lost && bezierPipelineMax && bezierPipelineOver),
    supportsBezierSpiralCorridor: () =>
      Boolean(
        ready &&
        !lost &&
        bezierPipelineMax &&
        bezierPipelineOver &&
        bezierCorridorPipelineMax &&
        bezierCorridorPipelineOver,
      ),
    renderGeometry,
    renderEffects,
    renderCorridor,
    renderLayerBatch,
    fourierComputeReady,
    gpuFourierStatus,
    compositeLayerBatch,
    compositeLayerScene,
    deferLayerScene,
    canUseExternalLayerScene,
    getExternalLayerSceneTarget,
    beginExternalLayerScene,
    deferExternalLayerScene,
    getDeferredLayerSceneTexture,
    getDeferredLayerSceneCommandBuffer,
    markDeferredLayerScenePresented,
    presentDeferredLayerSceneToMain,
    clearDeferredLayerScene,
    canUseFrameScene,
    prepareFrameScene,
    getFrameSceneTexture,
    getFrameSceneCommandBuffers,
    getExternalFrameSceneTarget,
    deferExternalFrameScene,
    sealDeferredLayerSceneToFrame,
    markFrameScenePresented,
    discardFrameScene,
    presentFrameSceneToMain,
    abandonFrameScene,
    canUseFrameUnderlay,
    prepareFrameUnderlay,
    getFrameUnderlayTexture,
    getFrameUnderlayCommandBuffers,
    markFrameUnderlayCommandsSubmitted,
    submitFrameUnderlayCommand,
    appendFrameUnderlayCommands,
    compositeLayerBatchToFrameUnderlay,
    presentFrameUnderlayToMain,
    markFrameUnderlayPresented,
    discardFrameUnderlay,
    abandonFrameUnderlay,
    canEncodeGeometryCirclesToLayerScene,
    encodeGeometryCirclesToLayerScene,
    inspectCommands: getCommandSegmentMeta,
    invalidateMutableCommands,
    composite: compositeTo,
    releaseStatic,
    releaseCorridorStatic,
    clear,
    status,
  };
})();

export { WebGPUStrokeRenderer };
