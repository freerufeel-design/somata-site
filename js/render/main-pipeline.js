import '../app/jump-trace.js'; // initialisation order: this module runs after it
import { SomataGeometryPolicy } from './geometry-policy.js';
import { runtimeState, somataWithFourierLayer, state } from '../core/state.js';
import { mainCanvas } from '../ui/profile-presets.js';
import { getLayerGeometryContract } from '../geometry/kernel.js';
import {
  fpsCounterEl,
  gridPatternEl,
  infoSuborbitsEl,
  mainContainerEl,
  mainCtx,
  renderRuntime,
  showFpsCounter,
} from '../core/render-runtime.js';
import { somataGpuBackendAllowed } from '../core/backend-policy.js';
import {
  animationScheduler,
  getRuntimeLayerById,
  performanceGovernor,
  refreshLayerLookup,
  renderPassProfiler,
  renderPerf,
  requestMainCanvasRender,
} from '../core/scheduler.js';
import { SpiroMorphController } from '../core/morph-controller.js';
import { withLayerMorphMode } from '../morph-runtime/morph-mode.js';
import {
  createVectorRecordingContext,
  ensureMainCanvasSize,
  getLayerGlowMultiplier,
  getLayerMotionRotationRadians,
  getLayerStrokeWidthMultiplier,
  getMotionViewportTransform,
  replayVectorRecording,
} from '../effects/motion.js';
import { SomataCorridorDepthCurve } from './corridor-depth-curve.js';
import { SomataCorridorCopyFrame, SomataCorridorFocus } from './corridor-copy-frame.js';
import {
  gcd,
  getLayerFillMatchStroke,
  getLayerLampsEnabled,
  getLayerLineVisible,
  linesAreEffectivelyVisible,
  syncLayerFillColorToStroke,
} from '../core/defaults-layers.js';
import { computeMaxLayerRadius } from '../geometry/artwork-extent.js';
import {
  getEffectiveSpiralOrder,
  getSpiralGeometryLayer,
  isSpiralLayer,
} from '../geometry/spiral/order-params.js';
import { WebGPUDeviceHub } from '../gpu/device-hub.js';
import { WebGPUBufferRecycler } from '../gpu/buffer-recycler.js';
import { noteFrameGraphMaterialization, renderBackendTelemetry } from './backend-telemetry.js';
import { WebGPUFinalCompositeRenderer } from '../gpu/final-composite-renderer.js';
import { WebGPUStrokeRenderer } from '../gpu/stroke-renderer.js';
import { audioApplyNumeric, ensureAudioRoutingState, hasActiveAudioRoute } from '../audio/audio-routing.js';
import { WebGPUGraffitiRibbonRenderer } from '../gpu/graffiti-ribbon-renderer.js';
import {
  acquireLayerFrameEffectContext,
  beginFrameGeometryRuntime,
  effectCullStats,
  endFrameGeometryRuntime,
} from '../geometry/frame-paths.js';
import { beginLampAdaptiveFrame, finishLampAdaptiveFrame } from '../lamps/lamp-visual.js';
import { normalizeLineProfileValue } from '../ui/effects-sidebar.js';
import { SomataFeatureHost } from './feature-host.js';
import { SomataEffectStackOrder, SomataRenderPassRegistry } from './pass-registry.js';
import {
  SOMATA_FULL_GPU_FRAME_FAULT_LIMIT,
  somataGpuContractError,
  somataGpuDiagnosticError,
} from './render-diagnostics.js';
import { SomataRenderLayerSnapshot } from './render-layer-snapshot.js';
import { SomataMorphProviderService } from './morph-provider-service.js';
import {
  beginSpiroPassIsolationFrame,
  runSpiroIsolatedLayerPreparation,
  runSpiroIsolatedRenderPass,
  spiroPassIsolationNoteFailure,
} from './pass-isolation.js';
import {
  SomataLayerSceneService,
  beginLayerSceneEffectCommandFrame,
  clearLayerSceneEffectCommands,
  collectLayerSceneCommandBuffers,
  materializeDeferredLayerScene,
  notifyLayerSceneEffectCommandsSubmitted,
} from './layer-scene-service.js';
import { SomataGeometryRoleService } from './geometry-role-service.js';
import {
  canDeferLayerSceneForFrame,
  canUseGpuOnlyCorridorLayerScene,
  somataSpiralSceneDiag,
} from './geometry-scene-routing.js';
import {
  clearFrameSceneEffectCallbacks,
  notifyFrameSceneEffectCommandsSubmitted,
  spiroGpuPreflightLayerPrerequisites,
  transferLayerSceneEffectCallbacksToFrameScene,
} from './gpu-command-scheduler.js';
import {
  beginRenderConsumerDemandFrame,
  prepareLayerConsumerDemand,
  shouldPrepareDynamicVectorMaster,
} from './consumer-demand.js';
import { prepareMainLayerEffects, resetLayerEffectsPlan } from './effects-plan.js';
import { SomataStrokeBatchService } from './stroke-batch-service.js';
import { SomataLampPassService } from './lamp-pass.js';
import { SomataFeatureLifecycle } from './feature-lifecycle.js';
import { prepareMainLayerGeometry, resetMainLayerGeometryPlan } from './geometry-executor.js';
import { resolveTunnelPaletteProfile, tunnelColorShiftIsActive } from '../corridor/corridor-appearance.js';
import {
  applyTunnelScreenEdgeFeather,
  getTunnelCopies,
  prepareTunnelVisibleInstances,
} from '../corridor/corridor-instances.js';
import { noteSuppressedError } from '../core/suppressed-errors.js';

function prepareMainRenderFrame(renderFrame) {
  const renderStartedAt = renderFrame.now;

  renderFrame.strictSpiralGpuPresentRequired = false;

  animationScheduler.consumeRenderRequest();
  beginFrameGeometryRuntime();
  beginRenderConsumerDemandFrame();
  beginLampAdaptiveFrame();
  refreshLayerLookup();
  effectCullStats.graffiti = 0;
  effectCullStats.sweep = 0;
  effectCullStats.web = 0;

  const mainContainer = mainContainerEl;
  const { w, h, dpr } = ensureMainCanvasSize(mainContainer);
  renderFrame.w = w;
  renderFrame.h = h;
  renderFrame.dpr = dpr;
  try {
    window.SomataMirror?.begin?.(renderFrame);
  } catch (error) {
    noteSuppressedError('render/main-pipeline#prepareMainRenderFrame', error);
  }
  const gpuBackendAllowed = typeof somataGpuBackendAllowed !== 'function' || somataGpuBackendAllowed();

  try {
    beginLayerSceneEffectCommandFrame?.(renderFrame);
    clearFrameSceneEffectCallbacks?.(renderFrame);
  } catch (error) {
    noteSuppressedError('render/main-pipeline#prepareMainRenderFrame', error);
  }
  if (gpuBackendAllowed) WebGPUStrokeRenderer.clearDeferredLayerScene?.();
  try {
    window.SomataSkeletonOverlay?.begin?.();
  } catch (error) {
    noteSuppressedError('render/main-pipeline#prepareMainRenderFrame', error);
  }
  const displayLayers =
    typeof SpiroMorphController !== 'undefined' && typeof SpiroMorphController.getDisplayLayers === 'function'
      ? SpiroMorphController.getDisplayLayers()
      : state.layers || [];

  const strictGeometryEntryIntent = SomataGeometryPolicy.hasStrictEntryIntent(displayLayers);
  renderFrame.strictGeometryEntryIntent = strictGeometryEntryIntent;
  renderFrame.strictSpiralEntryIntent = strictGeometryEntryIntent;
  if (strictGeometryEntryIntent) {
    try {
      WebGPUDeviceHub?.warmup?.();
    } catch (error) {
      noteSuppressedError('render/main-pipeline#prepareMainRenderFrame', error);
    }
    try {
      SomataGeometryRoleService?.warmupEntry?.(true);
    } catch (error) {
      noteSuppressedError('render/main-pipeline#prepareMainRenderFrame', error);
    }
    try {
      WebGPUFinalCompositeRenderer?.warmup?.();
    } catch (error) {
      noteSuppressedError('render/main-pipeline#prepareMainRenderFrame', error);
    }
  }

  try {
    SomataFeatureLifecycle?.begin?.(
      renderFrame,
      displayLayers,
      gpuBackendAllowed,
      mainCanvas.width,
      mainCanvas.height,
    );
  } catch (err) {
    somataGpuDiagnosticError?.('feature-lifecycle', 'frame-begin', String(err?.message || err), renderFrame, {
      recovered: true,
    });
  }

  const transparentDesktop = state.transparentDesktop === true;
  const presentationBgColor = transparentDesktop ? 'transparent' : state.bgColor;
  const bgCacheKey = `${transparentDesktop ? 'transparent' : 'opaque'}:${state.bgColor}`;
  if (renderPerf.lastBgColor !== bgCacheKey) {
    mainContainer.style.backgroundColor = presentationBgColor;
    renderPerf.lastBgColor = bgCacheKey;
  }
  const gridEl = gridPatternEl;
  const gridVisible = state.showGrid === true && !transparentDesktop;
  if (renderPerf.lastGridVisible !== gridVisible) {
    gridEl.classList.toggle('hidden', !gridVisible);
    renderPerf.lastGridVisible = gridVisible;
  }

  mainCtx.setTransform(1, 0, 0, 1, 0, 0);
  mainCtx.globalAlpha = 1;
  mainCtx.filter = 'none';
  mainCtx.shadowBlur = 0;
  mainCtx.setLineDash([]);

  mainCtx.clearRect(0, 0, mainCanvas.width, mainCanvas.height);
  renderFrame.strictSpiralPreservedPreviousCanvas = false;
  mainCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  mainCtx.save();
  renderFrame.canvasTransformSaved = true;

  const motionViewport = getMotionViewportTransform(w, h);
  renderFrame.motionPanX = motionViewport.panX;
  renderFrame.motionPanY = motionViewport.panY;
  renderFrame.motionRotationRad = motionViewport.rotationRad;
  mainCtx.translate(w / 2 + state.panX + motionViewport.panX, h / 2 + state.panY + motionViewport.panY);
  if (Math.abs(motionViewport.rotationRad) > 1e-9) mainCtx.rotate(motionViewport.rotationRad);
  mainCtx.scale(state.zoom, state.zoom);

  if (infoSuborbitsEl) {
    const activeLayer = getRuntimeLayerById(state.activeLayerId);
    if (activeLayer) {
      const maxS = gcd(activeLayer.N, activeLayer.K);
      const currentS =
        activeLayer.customSuborbits !== null && activeLayer.customSuborbits !== undefined
          ? Math.max(1, Math.min(Number(activeLayer.customSuborbits) || 1, maxS))
          : maxS;
      const infoText = `Суборбиты: ${currentS} (из ${maxS}) | Вершин/орбиту: ${activeLayer.N / maxS}${runtimeState.morph.active ? (runtimeState.morph.paused ? ' | ◇ Морфинг ⏸' : ' | ◇ Морфинг') : ''}${runtimeState.minimalMorph?.active ? (runtimeState.minimalMorph.paused ? ' | ◆ Мини-морфинг ⏸' : ' | ◆ Мини-морфинг') : ''}${state.tunnel.active ? ' | ◎ Туннель' : ''}${runtimeState.projectMorph?.active ? ' | ◆ Проектный морфин' : ''}`;
      if (renderPerf.lastInfoText !== infoText) {
        infoSuborbitsEl.textContent = infoText;
        renderPerf.lastInfoText = infoText;
      }
    }
  }

  const tunnelCopies = getTunnelCopies();
  renderFrame.tunnelCopies = tunnelCopies;
  let viewportOuterRadius = 0;
  if (state.tunnel.active) {
    const invZoom = 1 / Math.max(0.001, state.zoom);
    const originX = w / 2 + state.panX + (renderFrame.motionPanX || 0);
    const originY = h / 2 + state.panY + (renderFrame.motionPanY || 0);
    viewportOuterRadius =
      Math.max(
        Math.hypot(originX, originY),
        Math.hypot(w - originX, originY),
        Math.hypot(originX, h - originY),
        Math.hypot(w - originX, h - originY),
      ) * invZoom;
  }
  renderFrame.viewportOuterRadius = viewportOuterRadius;

  const morphProviders = SomataMorphProviderService.prepareFrameSnapshot(renderFrame);
  const minimalTransition = morphProviders.orange.transitioning;
  const renderLayerCount = minimalTransition
    ? Math.max(morphProviders.orange.sourceLayers.length, morphProviders.orange.targetLayers.length)
    : displayLayers.length;
  const audioActive = Boolean(state.audioReactive.active);
  if (audioActive) ensureAudioRoutingState();
  const audioRotationOverride = Boolean(audioActive && hasActiveAudioRoute('layer.rotation'));
  renderFrame.minimalTransition = minimalTransition; // compatibility for non-geometry passes
  renderFrame.renderLayerCount = renderLayerCount;
  renderFrame.audioActive = audioActive;
  renderFrame.audioRotationOverride = audioRotationOverride;
  return renderFrame;
}

function prepareMainLayerMorphState(frameCtx, renderFrame) {
  const providers = SomataMorphProviderService.resolveLayerProviders(frameCtx, renderFrame);
  const blue = providers.blue,
    orange = providers.orange,
    green = providers.green;
  const sourceLayer = frameCtx.sourceLayer;
  const greenLampDisplay = Boolean(
    green.lampPlan?.pairs?.some(
      (pair) => (Number(pair?.startLevel) || 0) > 0.001 || (Number(pair?.endLevel) || 0) > 0.001,
    ),
  );
  const lampDisplayEnabled = orange.active
    ? Boolean(
        (orange.sourceLayer && getLayerLampsEnabled(orange.sourceLayer)) ||
        (orange.targetLayer && getLayerLampsEnabled(orange.targetLayer)) ||
        blue.forcedLampMorph,
      )
    : greenLampDisplay || getLayerLampsEnabled(sourceLayer) || blue.forcedLampMorph;

  const renderLayerSource = blue.renderLayer || sourceLayer;
  frameCtx.layerSource = renderLayerSource;
  frameCtx.layer = SomataRenderLayerSnapshot?.create?.(renderLayerSource) || renderLayerSource;
  // Rotation focus is a live presentation preference, NOT part of anchor
  // transport.  Copy the authored layer's value into this frame snapshot so
  // editing it during Blue Morph takes effect without rebasing any points.
  const authoredFocusLayer = state.layers?.[frameCtx.layerIndex];
  if (frameCtx.layer && authoredFocusLayer) {
    // Presentation mode lives on the authored layer; the figure index may be
    // independently driven by routed Morph and therefore stays on frameCtx.layer.
    frameCtx.layer.spiralManualFocus = authoredFocusLayer.spiralManualFocus === true;
    frameCtx.layer.corridorFocusHighlight = authoredFocusLayer.corridorFocusHighlight === true;
  }
  const effectLayerSource = liveEffectOwnerForFrameLayer(renderLayerSource);
  frameCtx.effectLayerSource = effectLayerSource;
  frameCtx.effectLayer =
    effectLayerSource === renderLayerSource
      ? frameCtx.layer
      : SomataRenderLayerSnapshot?.create?.(effectLayerSource) || effectLayerSource;
  try {
    window.SomataMorphParameterRouting?.applyFrame?.(frameCtx);
  } catch (error) {
    console.warn('[Somata Parameter Routing] frame overlay skipped', error);
  }
  try {
    window.applySharedAudioParameterFrameRouting?.(frameCtx);
  } catch (error) {
    console.warn('[Somata Audio Parameter Routing] frame overlay skipped', error);
  }
  frameCtx.morphFrameActive = blue.active;
  frameCtx.lightMorphEnabled = blue.lightMorphEnabled;
  frameCtx.forcedLampMorph = blue.forcedLampMorph;
  frameCtx.greenLampDisplay = greenLampDisplay;
  frameCtx.lampDisplayEnabled = lampDisplayEnabled;
  frameCtx.lightningFlashAlpha = blue.lightningFlashAlpha;
  frameCtx.greenFramePaths = green.framePaths;
  frameCtx.greenMorphEnabled = green.geometryActive;
  frameCtx.greenFadeEnabled = green.kind === 'green-fade';
  frameCtx.greenFadeT = green.kind === 'green-fade' ? green.progress : 0;
  frameCtx.greenSourcePaths = green.sourcePaths;
  frameCtx.greenTargetPaths = green.targetPaths;
  frameCtx.greenSourceLayer = green.sourceLayer;
  frameCtx.greenTargetLayer = green.targetLayer;
  frameCtx.minimalFadeEnabled = !green.geometryActive && orange.geometryActive;
  frameCtx.circleAngularMorphEnabled = blue.circleAngular;
  frameCtx.topologyMorphEnabled = blue.topology;
  frameCtx.geometryMorphEnabled =
    green.geometryActive || orange.geometryActive || blue.circleAngular || blue.topology;
}

function prepareMainLayerTransformAndStyle(frameCtx, renderFrame) {
  const layerIndex = frameCtx.layerIndex;
  const layer = frameCtx.layer;
  const effectLayer = frameCtx.effectLayer || liveEffectOwnerForFrameLayer(layer);
  frameCtx.effectLayer = effectLayer;
  if (layer && (getLayerFillMatchStroke(layer) || getLayerFillMatchStroke(frameCtx.sourceLayer))) {
    layer.fillMatchStroke = true;
    syncLayerFillColorToStroke(layer, true);
  }
  const blue = frameCtx.blueMorphProvider;
  const audioActive = renderFrame.audioActive;
  const legacyAudioScale = audioActive ? audioApplyNumeric('layer.scale', 1, layerIndex) : 1;
  // 7.11.0: canonical Audio `Размер` must remain visible while Blue Morph owns an
  // already-resolved carrier. Compose the audio-driven radius as a post-Morph scale
  // instead of changing only the snapshot radius after the carrier was built.
  let routedRadiusScale = 1;
  if (audioActive && blue?.active === true && hasActiveAudioRoute('layer.radius')) {
    const baseRadius = Math.max(0.0001, Math.abs(Number(layer?.radius) || 1));
    const routedRadius = Math.max(0, Number(audioApplyNumeric('layer.radius', baseRadius, layerIndex)) || 0);
    routedRadiusScale = Math.max(0.0001, routedRadius / baseRadius);
  }
  const audioScale = legacyAudioScale * routedRadiusScale;
  const audioRotationOffset = audioActive ? audioApplyNumeric('layer.rotation', 0, layerIndex) : 0;
  const lightMorphScale = blue?.lightScale ?? 1;
  const lightMorphRotation = blue?.lightRotation ?? 0;
  const linearMotionRotation = (getLayerMotionRotationRadians(layer) * 180) / Math.PI;
  const baseAlpha =
    audioApplyNumeric('layer.opacity', layer.opacity !== undefined ? layer.opacity : 100, layerIndex) / 100;
  const lineOpacityFactor = Math.max(
    0,
    Math.min(1, (Number.isFinite(Number(layer?.lineOpacity)) ? Number(layer.lineOpacity) : 100) / 100),
  );
  const lineProfileApplication = ['stroke', 'graffiti'].includes(effectLayer?.lineProfileApplication)
    ? effectLayer.lineProfileApplication
    : 'stroke';
  const lineModeProfile =
    effectLayer?.sprite?.enabled === true
      ? 'round'
      : normalizeLineProfileValue(
          effectLayer?.lineProfileStroke ??
            effectLayer?.lineProfile ??
            layer?.lineProfileStroke ??
            layer?.lineProfile,
          'round',
        );

  if (effectLayer === layer) {
    layer.lineProfile = lineModeProfile;
    layer.lineProfileStroke = lineModeProfile;
  }
  const lineProfileStrokeOnly =
    linesAreEffectivelyVisible(effectLayer) &&
    ((lineProfileApplication === 'stroke' &&
      ['slash', 'square', 'circle', 'cross'].includes(lineModeProfile)) ||
      lineProfileApplication === 'graffiti') &&
    (!blue?.active || blue.mode !== 'lightning');

  frameCtx.lineProfileApplication = lineProfileApplication;
  // Graffiti replaces the ordinary Base only when the replacement GPU renderer
  // is ready. Otherwise a non-strict layer must keep its authoritative Line
  // visible while the GPU warms up; this matters most when it is soloed.
  // Strict Spiral remains retained-GPU-only and never falls back to a CPU contour.
  const graffitiWaiting =
    lineProfileApplication === 'graffiti' &&
    lineProfileStrokeOnly &&
    !SomataGeometryPolicy.isStrict(frameCtx) &&
    !(typeof WebGPUGraffitiRibbonRenderer !== 'undefined' && WebGPUGraffitiRibbonRenderer.isReady?.());
  frameCtx.lineProfileStrokeOnly = graffitiWaiting ? false : lineProfileStrokeOnly;
  frameCtx._graffitiBaseWhileGpuWarming = graffitiWaiting;
  frameCtx.lineDisplayEnabled = getLayerLineVisible(effectLayer) || frameCtx.lightningFlashAlpha > 0.001;
  frameCtx.audioScale = audioScale;
  frameCtx.audioRotationOffset = audioRotationOffset;
  frameCtx.lightMorphScale = lightMorphScale;
  frameCtx.lightMorphRotation = lightMorphRotation;
  frameCtx.linearMotionRotation = linearMotionRotation;
  frameCtx.baseAlpha = baseAlpha;
  frameCtx.lineOpacityFactor = lineOpacityFactor;
  frameCtx.lineAlpha = baseAlpha * lineOpacityFactor;
  frameCtx.lineLayerMode = 'uniform';
  frameCtx.spiralLineType = frameCtx.lineLayerMode; // legacy renderer/project alias
  frameCtx.combinedScale = audioScale * lightMorphScale;
  frameCtx.combinedRotationOffset = audioRotationOffset + lightMorphRotation + linearMotionRotation;
  frameCtx.combinedRotationRad = (frameCtx.combinedRotationOffset * Math.PI) / 180;
  frameCtx.hasCombinedScale = Math.abs(frameCtx.combinedScale - 1) > 1e-6;
  frameCtx.hasCombinedRotation = Math.abs(frameCtx.combinedRotationOffset) > 1e-6;
  frameCtx.strokeWidth = Math.max(
    0.001,
    audioApplyNumeric('layer.strokeWidth', Number(layer.strokeWidth) || 1.5, layerIndex) *
      getLayerStrokeWidthMultiplier(layer),
  );
  frameCtx.lineCap = 'round';
  frameCtx.lineJoin = (layer.lineJoinType || 'rounded') === 'straight' ? 'miter' : 'round';
  frameCtx.miterLimit = 6;
  frameCtx.lightningStroke =
    blue?.mode === 'lightning' && frameCtx.lightningFlashAlpha > 0.001
      ? blue.lightningColor || '#ffffff'
      : null;
  frameCtx.tunnelBaseStrokeColor = frameCtx.lightningStroke || layer.strokeColor || '#ffffff';
  frameCtx.tunnelBaseFillColor = layer.fillColor || 'transparent';
  frameCtx.tunnelPaletteProfile = tunnelColorShiftIsActive()
    ? resolveTunnelPaletteProfile(frameCtx.tunnelBaseStrokeColor, layer, layerIndex, 'stroke')
    : null;
  frameCtx.tunnelFillPaletteProfile = tunnelColorShiftIsActive()
    ? resolveTunnelPaletteProfile(frameCtx.tunnelBaseFillColor, layer, layerIndex, 'fill')
    : null;
}

function spiralCorridorCopiesForLayer(copies, layer, now = performance.now()) {
  // Corridor's spacing must be raised to the Spiral's radial order for ALL
  // GPU effects, never only in the specialised stroke renderer. The original
  // shared copy array is immutable from this layer's perspective.
  if (state.tunnel?.active !== true || !Array.isArray(copies)) return copies;
  // At the EXACT polygon endpoint, spiralEnabled is false. Honest 1→0
  // must nevertheless pass through this scaling stage during its final 20%
  // Corridor-unfold phase. Previously the early return below skipped it and
  // the copies jumped immediately to their full polygonal spacing.
  const polygonOutro =
    layer?.spiralEnabled !== true ? window.__somataCorridorHonestZeroOutro?.(layer?.id, now) : null;
  const layerwise = Number.isFinite(layer?.__spiralLayerwiseScaleExponent);
  const unfold = Number.isFinite(layer?.__spiralUnfoldSpiralWeight);
  if (
    layer?.spiralEnabled !== true &&
    !layerwise &&
    !unfold &&
    (!polygonOutro || polygonOutro.population >= 1)
  )
    return copies;
  // Connected spiral turns rely on exactly the same geometric step between
  // adjacent Corridor copies. An index-dependent depth warp changes their
  // scale ratio and tears periodic seams. Keep the depth control effective as
  // one common log-depth displacement instead; preserve constant copy ratio.
  const depthPercent = Number(copies._depthCurvePercent) || 0;
  const depthMultiplier = Number(copies._depthCurveMultiplier) || 0;
  let seamSafeCopies = copies;
  if (
    (layer?.spiralEnabled === true || layerwise || unfold) &&
    depthPercent &&
    depthMultiplier &&
    Number(copies._stepRatio) > 1 &&
    typeof SomataCorridorDepthCurve?.position === 'function'
  ) {
    const count = Math.max(2, Number(copies._depthCurveCount) || 2);
    const probe = (count - 1) * 0.25;
    const shift = SomataCorridorDepthCurve.position(probe, count, depthPercent, depthMultiplier) - probe;
    const logStep = Math.log(Number(copies._stepRatio));
    seamSafeCopies = copies.map((copy) => {
      const position = Number(copy?.position) || 0;
      const warped = SomataCorridorDepthCurve.position(position, count, depthPercent, depthMultiplier);
      return {
        ...copy,
        scale:
          Math.max(1e-12, Number(copy.scale) || 1) *
          Math.exp(Math.max(-30, Math.min(30, logStep * (position + shift - warped)))),
      };
    });
    for (const key of Object.keys(copies)) if (!/^\d+$/.test(key)) seamSafeCopies[key] = copies[key];
    seamSafeCopies._spiralSeamSafeDepth = true;
  }
  // Do not change the Honest Spiral's original radial collapse. At the
  // EXACT zero endpoint its old `|| 1` fallback made the entire polygonal
  // Corridor appear in a single frame. The dedicated post-morph animation
  // instead restores the full Corridor exponent gradually from zero to one.
  const order = Math.abs(Number(getEffectiveSpiralOrder?.(layer)) || 0);
  const post = order < 1e-8 ? polygonOutro || window.__somataCorridorHonestZeroOutro?.(layer?.id, now) : null;
  // Preserve the correspondence by copy position. Interpolate the spiral
  // and polygon log scales, including their different depth treatments.
  // The graph's current period shrinks to 1; it must NOT overwrite this
  // transition's still-distinct copy transforms near order zero.
  const endpointBlend = layerwise || unfold;
  const spiralWeight = layerwise
    ? layer.__spiralLayerwiseAngleMix
    : unfold
      ? layer.__spiralUnfoldSpiralWeight
      : 1;
  const exponent = layerwise
    ? layer.__spiralLayerwiseScaleExponent
    : unfold
      ? 1 - spiralWeight + spiralWeight * layer.__spiralUnfoldSpiralExponent
      : Math.max(0.000001, post ? post.population : order || 1);
  if (endpointBlend ? spiralWeight <= 0 : Math.abs(exponent - 1) < 1e-8)
    return endpointBlend ? copies : seamSafeCopies;
  const scaled = seamSafeCopies.map((copy, i) => {
    const log = Math.log(Math.max(1e-12, Math.abs(Number(copy?.scale) || 1)));
    const step = Math.max(1.000000001, Number(copy?.stepRatio) || 1);
    const flatLog = Math.log(Math.max(1e-12, Math.abs(Number(copies[i]?.scale) || 1)));
    return {
      ...copy,
      scale: Math.exp(log * (exponent - (1 - spiralWeight)) + flatLog * (1 - spiralWeight)),
      stepRatio: Math.pow(step, exponent),
    };
  });
  for (const key of Object.keys(seamSafeCopies)) if (!/^\d+$/.test(key)) scaled[key] = seamSafeCopies[key];
  if (Number(scaled._stepRatio) > 1) scaled._stepRatio = Math.pow(scaled._stepRatio, exponent);
  if (Number(scaled._logStepRatio) > 0) scaled._logStepRatio *= exponent;
  return scaled;
}
// This stage runs after the ordinary spiral/polygon transforms. Compress
// only the relative spacing around the focus; do not compound the spacing
// exponent or let the periodic seam lock undo the deliberate fold.
// Unity is the size of the same layer drawn without the Corridor. Use the
// uncompressed copy list, so reshaping the copies cannot change the pivot.
function unfoldOriginCopy(copies, baseCopies = copies) {
  const base = baseCopies?.length ? baseCopies : copies;
  const position = base._corridorOriginPosition ?? SomataSpiralZeroTransition.corridorOrigin(base)?.position;
  return (
    copies.find((copy) => copy.position === position) ??
    SomataSpiralZeroTransition.corridorOrigin(copies) ??
    copies[0]
  );
}
function untwistedUnfoldCorridorCopies(copies, layer, baseCopies = copies) {
  const frame = layer?.__spiralUntwistedFollowers;
  if ((!frame && !layer?.__somataUnfoldUntwisted) || !Array.isArray(copies) || !copies.length) return copies;
  const anchor = unfoldOriginCopy(copies, baseCopies);
  const population = frame ? layer.__spiralUnfoldPopulation : 1;
  const forming = frame ? frame.shape > 0 : true;
  const delta = forming ? Number(layer.__somataCoordinatedPeriodDelta) || 0 : 0;
  const anchorLog = Math.log(Math.max(1e-12, anchor.scale));
  const ratio = Math.max(1, Number(copies._stepRatio) || Number(anchor.stepRatio) || 1);
  const periodScale = Number(layer.__somataContinuousSpiralPeriodScale);
  const spacing = forming && periodScale > 0 ? periodScale : Math.pow(ratio, forming ? 1 : population);
  const out = copies.map((copy) => ({
    ...copy,
    scale:
      forming && periodScale > 0
        ? anchor.scale * Math.pow(spacing, copy.position - anchor.position)
        : Math.exp(
            anchorLog + (Math.log(Math.max(1e-12, copy.scale)) - anchorLog) * (forming ? 1 : population),
          ),
    stepRatio: spacing,
    alpha: copy === anchor ? copy.alpha : (copy.alpha ?? 1) * population,
    _spiralUntwistedAngle: (copy.position - anchor.position) * delta,
    _spiralUnfoldAnchorWeight: copy === anchor ? 1 - population : 0,
    _spiralUnfoldOpenStep: ratio,
  }));
  for (const key of Object.keys(copies)) if (!/^\d+$/.test(key)) out[key] = copies[key];
  out._stepRatio = spacing;
  out._logStepRatio = Math.log(spacing);
  return out;
}
function unfoldCorridorCopies(copies, layer, baseCopies = copies) {
  const population = layer?.__spiralUnfoldPopulation;
  const unfolding = layer?.__somataUnfoldSpine || Number.isFinite(population);
  if (!unfolding || !Array.isArray(copies) || copies.length < 2) return copies;
  const anchor = unfoldOriginCopy(copies, baseCopies);
  const amount = Number.isFinite(population) ? population : 1;
  const anchorLog = Math.log(Math.max(1e-12, anchor.scale));
  const ratio = Math.max(1, Number(copies._stepRatio) || Number(anchor.stepRatio) || 1);
  const spread = layer.__somataUnfoldSpine ? 1 : amount;
  const spacing = Math.pow(ratio, spread);
  const out = copies.map((copy) => ({
    ...copy,
    scale: Math.exp(anchorLog + (Math.log(Math.max(1e-12, copy.scale)) - anchorLog) * spread),
    stepRatio: spacing,
    alpha: copy === anchor ? copy.alpha : (copy.alpha ?? 1) * amount,
    _spiralUnfoldFocusPosition: anchor.position,
    _spiralUnfoldAnchorWeight: copy === anchor ? 1 - amount : 0,
    _spiralUnfoldOpenStep: ratio,
  }));
  for (const key of Object.keys(copies)) if (!/^\d+$/.test(key)) out[key] = copies[key];
  out._stepRatio = spacing;
  out._logStepRatio = Math.log(spacing);
  return out;
}
// Population animations may redistribute sizes. Keep their alpha and the
// focused copy's scale, but enforce the graph's geometric ratio for this layer.
function lockContinuousSpiralCopies(copies, layer, baseCopies = copies) {
  const ratio = layer?.__somataContinuousSpiralPeriodScale;
  if (
    Number.isFinite(layer?.__spiralLayerwiseScaleExponent) ||
    (Number.isFinite(layer?.__spiralUnfoldSpiralWeight) && !layer?.__somataUnfoldSpine) ||
    !(ratio > 0) ||
    !Array.isArray(copies) ||
    copies.length < 2
  )
    return copies;
  const focus = SomataCorridorFocus.focusPosition(layer);
  const anchor = layer.__somataUnfoldSpine
    ? unfoldOriginCopy(copies, baseCopies)
    : copies.find((copy) => copy._corridorEntryAnchor) ||
      copies.reduce((a, b) => (Math.abs(b.position - focus) < Math.abs(a.position - focus) ? b : a));
  const out = copies.map((copy) => ({
    ...copy,
    scale: anchor.scale * Math.pow(ratio, copy.position - anchor.position),
    stepRatio: ratio,
  }));
  for (const key of Object.keys(copies)) if (!/^\d+$/.test(key)) out[key] = copies[key];
  out._stepRatio = ratio;
  out._logStepRatio = Math.log(ratio);
  out._layerwiseNonUniformStep = false;
  return out;
}
function prepareMainLayerInstances(frameCtx, renderFrame) {
  const layerIndex = frameCtx.layerIndex;
  const layer = frameCtx.layer;
  const baseCopies = spiralCorridorCopiesForLayer(renderFrame.tunnelCopies, layer, frameCtx.now);
  // Coordinated changes the period, never the population. Only a separate,
  // explicit order-edit preset may run its own Corridor choreography.
  const fixedPopulation = layer.__somataCoordinatedSpine === true && !layer.__somataIndependentOrderCorridor;
  const populationCopies =
    fixedPopulation ||
    Number.isFinite(layer.__spiralLayerwiseScaleExponent) ||
    Number.isFinite(layer.__spiralUnfoldPopulation)
      ? baseCopies
      : window.__somataCorridorCopiesForLayer?.(baseCopies, layer, frameCtx.now) || baseCopies;
  const tunnelCopies =
    layer.__spiralUntwistedFollowers || layer.__somataUnfoldUntwisted
      ? untwistedUnfoldCorridorCopies(populationCopies, layer, renderFrame.tunnelCopies)
      : unfoldCorridorCopies(
          lockContinuousSpiralCopies(populationCopies, layer, renderFrame.tunnelCopies),
          layer,
          renderFrame.tunnelCopies,
        );
  // All effects including lamps must see the *same* corrected per-layer
  // transforms as Base, Web, Lightning and Glint.
  frameCtx.tunnelCopies = tunnelCopies;
  frameCtx.visibleInstances = prepareTunnelVisibleInstances(
    tunnelCopies,
    frameCtx.layerExtent,
    frameCtx.audioScale,
    renderFrame.viewportOuterRadius,
    state.zoom,
    layer?.id || layerIndex,
    frameCtx.now,
    layer,
  );
  // Resolve once for the *frame layer* before Base, Glow, Fill and Motion.
  // Use source copies (not their culled array), preserving the continuous
  // outer boundary across Corridor travel cycles and GPU/CPU render paths.
  const focusPopulation = SomataCorridorFocus.population(
    frameCtx.visibleInstances.focusCopies || frameCtx.visibleInstances.copies,
    frameCtx.layerExtent * frameCtx.audioScale,
    state.zoom,
    renderFrame.viewportOuterRadius,
    state.tunnel,
    layer,
  );
  const focusState = SomataCorridorFocus.resolveFrame(
    layer,
    tunnelCopies,
    frameCtx.layerExtent * frameCtx.audioScale,
    state.zoom,
    renderFrame.viewportOuterRadius,
    state.tunnel,
    focusPopulation,
  );
  if (layer?.id === state.activeLayerId) {
    // Track the actual current population, not a percentage denominator.
    // Do not overwrite the saved preferred figure when the corridor shrinks:
    // figure #7 becomes active again as soon as seven figures are available.
    const count = Math.max(1, focusState.total || 1);
    const configured = Math.max(1, Math.round(Number(layer?.spiralRotationFocusFigure) || 7));
    const effective = Math.min(count, layer?.spiralManualFocus === true ? configured : 7);
    for (const id of ['paramSpiralRotationFocus', 'tunnelFocusNumber']) {
      const el = document.getElementById(id);
      if (!el) continue;
      if (el.max !== String(count)) el.max = String(count);
      if (document.activeElement !== el && el.value !== String(effective)) el.value = String(effective);
    }
    for (const id of ['spiralFocusPercentText', 'tunnelFocusPercentText']) {
      const el = document.getElementById(id);
      if (el && el.textContent !== `№${effective}`) el.textContent = `№${effective}`;
    }
    for (const id of ['spiralFocusPositionText', 'tunnelFocusPositionText']) {
      const el = document.getElementById(id);
      if (el) {
        const value = `→ фигура №${focusState.index + 1}`;
        if (el.textContent !== value) el.textContent = value;
      }
    }
    const label = SomataCorridorFocus.countLabel(focusPopulation);
    for (const id of ['spiralFocusCopyCount', 'tunnelFocusCopyCount']) {
      const el = document.getElementById(id);
      if (el) {
        el.dataset.focusCount = String(count);
        if (el.textContent !== label) el.textContent = label;
      }
    }
  }
  const metrics = frameCtx.instanceMetrics;
  metrics.length = frameCtx.visibleInstances.copies.length;
  const metricZoom = Math.max(0.001, Number(state.zoom) || 1),
    metricCombined = Math.abs(Number(frameCtx.combinedScale) || 1);
  const metricRadiusBase =
    Math.max(0, Number(frameCtx.layerExtent) || 0) *
    Math.max(0.001, Number(frameCtx.audioScale) || 1) *
    metricZoom;
  for (let mi = 0; mi < metrics.length; mi++) {
    const copy = frameCtx.visibleInstances.copies[mi];
    let m = metrics[mi];
    if (!m) m = metrics[mi] = { screenScale: 1, radiusPx: 0 };
    const cs = Math.abs(Number(copy?.scale) || 0);
    m.screenScale = state.tunnel.active
      ? Math.max(0.000001, cs * metricCombined * metricZoom)
      : Math.max(0.001, metricCombined * metricZoom);
    m.radiusPx = state.tunnel.active ? metricRadiusBase * cs : metricRadiusBase;
  }
  const glowOwner = frameCtx.effectLayer || layer;
  const glowBase = frameCtx.minimalFadeEnabled
    ? Math.max(
        0,
        (Number(frameCtx.minimalSourceLayer?.glow) || 0) *
          getLayerGlowMultiplier(frameCtx.minimalSourceLayer),
        (Number(frameCtx.minimalTargetLayer?.glow) || 0) *
          getLayerGlowMultiplier(frameCtx.minimalTargetLayer),
      )
    : Math.max(0, (Number(glowOwner?.glow) || 0) * getLayerGlowMultiplier(glowOwner));
  frameCtx.glow =
    frameCtx.geometryPlan?.kind === 'lightning' ? 0 : audioApplyNumeric('layer.glow', glowBase, layerIndex);
}

function prepareMainLayerVectorMaster(frameCtx) {
  let frameVectorMaster = null;
  let frameVectorMasterScale = 1;
  const tunnelCanUseMaster = state.tunnel.active;
  const topologyGpuLazy =
    frameCtx._topologyMorphGpuLazy === true &&
    SomataGeometryRoleService.backendEligible(frameCtx, 'topology', 'base') === true;
  const outlineVisible = window.somataOutlineLayerEnabled?.(frameCtx.layerIndex) === true;
  const greenProjectGpuNative =
    SomataGeometryRoleService.backendEligible(frameCtx, 'green', 'base') === true && !outlineVisible;

  // Retained Spiral GPURenderer supports both static and Morph frames.  Do
  // not rebuild the same CPU vector master for Glow if *both* active roles
  // can consume the retained GPU rail.  Fall back to the existing Canvas
  // path whenever either role is unsupported.
  const spiralGpuBase = SomataGeometryRoleService.backendEligible(frameCtx, 'spiral', 'base') === true;
  // The actual prepared flag is set after vector/effect planning. Probe the
  // scene route without retaining that temporary state or touching geometry.
  let spiralGpuCanPresent = false;
  if (spiralGpuBase && !frameCtx.morphFrameActive) {
    const preparedBefore = frameCtx.prepared;
    try {
      frameCtx.prepared = true;
      const route = SomataGeometryRoleService.spiralRoute(frameCtx);
      spiralGpuCanPresent = Boolean(route?.deferLayerScene || route?.deferFrameScene);
    } finally {
      frameCtx.prepared = preparedBefore;
    }
  }
  // Preserve the pre-existing fast morph path; add static Spiral only when
  // its GPU Base AND (if requested) Glow renderer are actually available.
  const spiralBezierGpuNative =
    (frameCtx.morphFrameActive && spiralGpuBase) ||
    (spiralGpuCanPresent &&
      (frameCtx.glow <= 0 || SomataGeometryRoleService.backendEligible(frameCtx, 'spiral', 'glow') === true));
  const shouldRecordDynamicVector =
    topologyGpuLazy || greenProjectGpuNative || spiralBezierGpuNative
      ? false
      : shouldPrepareDynamicVectorMaster(frameCtx);
  if (shouldRecordDynamicVector) {
    frameVectorMasterScale = state.tunnel.active ? frameCtx.visibleInstances.maxScale : 1;
    try {
      const rec = createVectorRecordingContext({
        globalAlpha: 1,
        lineWidth: frameCtx.strokeWidth,
        strokeStyle: frameCtx.layer.strokeColor || '#ffffff',
        fillStyle: frameCtx.layer.fillColor || 'transparent',
        lineCap: frameCtx.lineCap,
        lineJoin: frameCtx.lineJoin,
        miterLimit: frameCtx.miterLimit,
      });
      rec.scale(frameVectorMasterScale, frameVectorMasterScale);
      if (frameCtx.lineProfileStrokeOnly) rec.__suppressStroke = true;
      frameCtx.drawLayerGeometry(rec, 1);
      if (rec.commands.length) frameVectorMaster = rec;
    } catch (err) {
      frameVectorMaster = null;
    }
  }

  frameCtx.frameVectorMaster = frameVectorMaster;
  frameCtx.frameVectorMasterScale = frameVectorMasterScale;
  frameCtx.tunnelCanUseMaster = tunnelCanUseMaster;
  frameCtx.drawLayerInstances = (
    targetCtx,
    ignoreMaster = false,
    instanceWeight = null,
    allowHiddenGraffitiCarrier = false,
  ) => {
    const copies = frameCtx.visibleInstances.copies;
    const alphas = frameCtx.visibleInstances.alphas;
    // Resolve the *same* per-frame Corridor attributes once for this Canvas pass,
    // instead of walking the FeatureHost owner chain three times per copy.
    // The cache remains owned and invalidated by SomataCorridorCopyFrame.
    const corridorActive = state.tunnel.active === true;
    const copyAttributes = corridorActive ? SomataCorridorCopyFrame.batch(frameCtx) : null;
    const closedSpiralCorridor =
      corridorActive && isSpiralLayer(frameCtx.layer) && frameCtx.layer.spiralClosed !== false;
    const previousSuppressStroke = targetCtx.__suppressStroke;
    const hiddenGraffitiCarrier =
      allowHiddenGraffitiCarrier === true &&
      frameCtx.lineProfileStrokeOnly === true &&
      frameCtx.lineProfileApplication === 'graffiti';
    if (frameCtx.lineProfileStrokeOnly && !hiddenGraffitiCarrier) targetCtx.__suppressStroke = true;
    for (let i = 0; i < copies.length; i++) {
      const copy = copies[i];
      const rawAlpha = alphas[i];
      const weight = instanceWeight
        ? Math.max(0, Math.min(1, Number(instanceWeight(copy, rawAlpha, i)) || 0))
        : 1;
      if (weight <= 0.0001) continue;
      const alpha = rawAlpha * weight;
      if (alpha <= 0.0001) continue;
      const previousSpiralAlphaEndRatio = targetCtx.__spiralCorridorAlphaEndRatio;
      if (closedSpiralCorridor) {
        let nextAlpha = alpha;
        if (i + 1 < copies.length) {
          const nextCopy = copies[i + 1];
          const nextRawAlpha = alphas[i + 1];
          const nextWeight = instanceWeight
            ? Math.max(0, Math.min(1, Number(instanceWeight(nextCopy, nextRawAlpha, i + 1)) || 0))
            : 1;
          nextAlpha = Math.max(0, nextRawAlpha * nextWeight);
        }

        targetCtx.__spiralCorridorAlphaEndRatio = alpha > 1e-8 ? nextAlpha / alpha : 1;
      } else {
        delete targetCtx.__spiralCorridorAlphaEndRatio;
      }
      if (corridorActive) {
        const copyStroke = SomataCorridorCopyFrame.strokeAt(copyAttributes, copy, i);
        const copyFill = SomataCorridorCopyFrame.fillAt(copyAttributes, copy, i);
        if (frameCtx.frameVectorMaster && frameCtx.tunnelCanUseMaster && !ignoreMaster) {
          targetCtx.save();
          const copyAngle = SomataCorridorCopyFrame.rotationAt(copyAttributes, copy, i);
          if (Math.abs(copyAngle) > 1e-12) targetCtx.rotate(copyAngle);
          replayVectorRecording(
            targetCtx,
            frameCtx.frameVectorMaster,
            alpha,
            copy.scale / frameCtx.frameVectorMasterScale,
            { strokeStyle: copyStroke, fillStyle: copyFill },
          );
          targetCtx.restore();
        } else {
          targetCtx.save();
          targetCtx.strokeStyle = copyStroke;
          targetCtx.fillStyle = copyFill;
          const copyAngle = SomataCorridorCopyFrame.rotationAt(copyAttributes, copy, i);
          if (Math.abs(copyAngle) > 1e-12) targetCtx.rotate(copyAngle);
          targetCtx.scale(copy.scale, copy.scale);
          frameCtx.drawLayerGeometry(targetCtx, alpha);
          targetCtx.restore();
        }
      } else if (frameCtx.frameVectorMaster && !ignoreMaster) {
        replayVectorRecording(targetCtx, frameCtx.frameVectorMaster, alpha, 1);
      } else {
        frameCtx.drawLayerGeometry(targetCtx, alpha);
      }
      if (previousSpiralAlphaEndRatio === undefined) delete targetCtx.__spiralCorridorAlphaEndRatio;
      else targetCtx.__spiralCorridorAlphaEndRatio = previousSpiralAlphaEndRatio;
    }
    if (previousSuppressStroke === undefined) delete targetCtx.__suppressStroke;
    else targetCtx.__suppressStroke = previousSuppressStroke;
  };

  frameCtx.drawLayerFillInstances = (targetCtx) => {
    const copies = frameCtx.visibleInstances.copies;
    const alphas = frameCtx.visibleInstances.fillAlphas || frameCtx.visibleInstances.alphas;
    const corridorActive = state.tunnel.active === true;
    const copyAttributes = corridorActive ? SomataCorridorCopyFrame.batch(frameCtx) : null;
    const prevSuppressStroke = targetCtx.__suppressStroke;
    targetCtx.__suppressStroke = true;
    for (let i = 0; i < copies.length; i++) {
      const copy = copies[i],
        alpha = Math.max(0, Math.min(1, Number(alphas[i]) || 0));
      if (alpha <= 0.0001) continue;
      if (corridorActive) {
        targetCtx.save();
        const copyFill = SomataCorridorCopyFrame.fillAt(copyAttributes, copy, i);
        targetCtx.fillStyle = copyFill;
        const copyAngle = SomataCorridorCopyFrame.rotationAt(copyAttributes, copy, i);
        if (Math.abs(copyAngle) > 1e-12) targetCtx.rotate(copyAngle);
        targetCtx.scale(copy.scale, copy.scale);
        frameCtx.drawLayerGeometry(targetCtx, alpha);
        targetCtx.restore();
      } else frameCtx.drawLayerGeometry(targetCtx, alpha);
    }
    if (prevSuppressStroke === undefined) delete targetCtx.__suppressStroke;
    else targetCtx.__suppressStroke = prevSuppressStroke;
  };
}

function prepareMainLayerFrame(renderFrame, layerIndex) {
  const frameCtx = acquireLayerFrameEffectContext(layerIndex);
  frameCtx.frame = renderFrame;
  frameCtx.runtime = renderRuntime;
  frameCtx.now = renderFrame.now;
  frameCtx.lampAnimationMs = 0;
  if (!SomataMorphProviderService.resolveFrameSource(frameCtx, renderFrame)) return null;
  prepareMainLayerMorphState(frameCtx, renderFrame);
  try {
    window.SomataTestMorph?.applyFrame?.(frameCtx, renderFrame.now);
  } catch (error) {
    console.warn('[Somata Test Morph] skipped', error);
  }
  try {
    window.__somataApplyCorridorEntranceLayer?.(frameCtx, renderFrame.now);
  } catch (error) {
    console.warn('[Somata Corridor Entrance] skipped', error);
  }
  // 13.0.26 geometry firewall: after all Morph/edit/audio/entrance overlays
  // have resolved, but BEFORE any transform, path, Corridor, Glow or render
  // planner can read K, project the cyclic connection-step limiter onto the
  // presentation snapshot. This is deliberately after Geometry > Animation:
  // an authored 8->9 tween at N=19 (limit=2) becomes a 2->1 visual tween
  // throughout ALL downstream consumers, not just its Bézier endpoint rail.
  // Never modify frameCtx.sourceLayer or state.layers (saved/raw K survives).
  {
    const project = (layer) => {
      if (!SomataRenderLayerSnapshot?.isSnapshot?.(layer)) return;
      const bounded = getSpiralGeometryLayer(layer);
      if (bounded !== layer) Object.assign(layer, bounded);
    };
    project(frameCtx.layer);
    if (frameCtx.effectLayer !== frameCtx.layer) project(frameCtx.effectLayer);
  }
  prepareMainLayerTransformAndStyle(frameCtx, renderFrame);
  prepareMainLayerGeometry(frameCtx);
  prepareMainLayerInstances(frameCtx, renderFrame);
  // Build the Line execution carrier before effect planning. Ordinary effects now derive
  // their geometry from the exact Line commands for this frame, so the recorder must exist
  // before Web/Graffiti/Sweep plans are prepared.
  prepareMainLayerVectorMaster(frameCtx);
  prepareMainLayerEffects(frameCtx);
  prepareLayerConsumerDemand(frameCtx);
  frameCtx.prepared = true;
  return frameCtx;
}

// An enabled Glint must not depend on the Base/Line being visible. With several
// line-hidden layers the shared deferred GPU Frame Scene may lose a later
// effect-only layer when its scene is recycled before final presentation.
// Present each such *completed* Layer Scene as a transparent composited image
// before advancing to the next layer. Other layers retain the normal fast GPU
// frame-scene path, and strict Spiral retains its GPU-only presentation policy.
const somataHiddenGlintComposeStats = { attempts: 0, presented: 0, failed: 0, lastLayerId: null };
function somataNeedsIsolatedHiddenGlintPresentation(frameCtx) {
  if (
    !frameCtx?.frame ||
    frameCtx.lineDisplayEnabled !== false ||
    Number(frameCtx.frame.renderLayerCount || 0) < 2
  )
    return false;
  // A frame containing any strict GPU-only Spiral cannot be materialized into
  // Canvas2D, even if this particular layer is not strict.
  if (
    frameCtx.frame.strictSpiralEntryIntent === true ||
    frameCtx.frame.strictSpiralGpuPresentRequired === true
  )
    return false;
  if (typeof SomataGeometryPolicy !== 'undefined' && SomataGeometryPolicy.isStrict(frameCtx)) return false;
  const sweep = frameCtx.effectsPlan?.sweep;
  return (
    sweep?.enabled === true &&
    (Array.isArray(sweep.instances) && sweep.instances.length
      ? sweep.instances.some((effect) => effect?.enabled === true && effect?.cfg?.effectType !== 'lightning')
      : sweep.cfg?.effectType !== 'lightning')
  );
}

function renderPreparedMainLayer(frameCtx) {
  if (!frameCtx?.prepared || !frameCtx.layer) return;

  // 7.7.7: planning is the last phase allowed to normalize render-local layer data.
  // Every effect after this point sees immutable geometry/style snapshots, so one
  // effect cannot corrupt another effect's inputs within the same frame.
  try {
    SomataRenderLayerSnapshot?.seal?.(frameCtx.layer);
    if (frameCtx.effectLayer && frameCtx.effectLayer !== frameCtx.layer)
      SomataRenderLayerSnapshot?.seal?.(frameCtx.effectLayer);
  } catch (error) {
    noteSuppressedError('render/main-pipeline#renderPreparedMainLayer', error);
  }

  mainCtx.save();
  try {
    mainCtx.lineWidth = frameCtx.strokeWidth;
    mainCtx.lineCap = frameCtx.lineCap;
    mainCtx.lineJoin = frameCtx.lineJoin;
    mainCtx.miterLimit = frameCtx.miterLimit;
    mainCtx.strokeStyle = frameCtx.lightningStroke || frameCtx.layer.strokeColor || '#ffffff';
    mainCtx.fillStyle = frameCtx.layer.fillColor || 'transparent';
    mainCtx.shadowBlur = 0;

    const runPass = (name, fn, fallback = null) => {
      const pt = renderPassProfiler.begin();
      try {
        const execute = (ctx) => {
          const work = () => fn(ctx);
          return runSpiroIsolatedRenderPass(ctx, name, work, fallback);
          work();
          return { ok: true };
        };
        if (typeof SomataFeatureHost !== 'undefined' && SomataFeatureHost.has?.(name))
          return SomataFeatureHost.run(name, frameCtx, execute);
        return execute(frameCtx);
      } finally {
        renderPassProfiler.end(name, pt);
      }
    };
    // 7.11.8: per-layer wall-clock diagnostics for the very frame that stalls.
    // The legacy pass profiler samples every ten frames and can therefore
    // report unrelated passes during a 500-1300 ms driver/Canvas stall.
    const layerTiming = frameCtx._slowFrameLayerTiming || null;
    const recordStep = (label, work) => {
      if (!layerTiming) return work();
      const started = performance.now();
      try {
        return work();
      } finally {
        const ms = performance.now() - started;
        layerTiming.steps[label] = (layerTiming.steps[label] || 0) + ms;
      }
    };
    const runRegisteredStage = (stage) =>
      recordStep('stage:' + String(stage), () =>
        SomataRenderPassRegistry.runStage(stage, frameCtx, (row) =>
          runPass(row.name, (ctx) => row.run(ctx), row.fallback ? () => row.fallback(frameCtx) : null),
        ),
      );
    const runRegisteredHooks = (stage) =>
      recordStep('hooks:' + String(stage), () =>
        SomataRenderPassRegistry.runHooks(stage, frameCtx, (row) => row.run(frameCtx)),
      );
    runRegisteredHooks('beforeLayer');
    // Fast path: do not open an offscreen Layer Scene merely because configurable
    // ordering exists. Fill/Web and later effects seed one when they actually need it.
    // A neutral root is reserved for the one case that cannot be recovered later:
    // a technically-late effect that the user has artistically moved below Geometry.
    const effectOrderPlan = SomataEffectStackOrder?.plan?.(frameCtx) || null;
    if (effectOrderPlan?.requiresEarlyScene === true) {
      try {
        SomataLayerSceneService?.ensure?.(frameCtx, 'effect-stack-order-root');
      } catch (error) {
        noteSuppressedError('render/main-pipeline#renderPreparedMainLayer', error);
      }
    }
    runRegisteredStage(SomataRenderPassRegistry.STAGES.UNDERLAY);

    // Physical scene order is explicit: Fill -> Web -> Line/Glow. Web must never be
    // hidden under a Fill attachment inside the Base batch. Fill/Web establish the
    // resident Layer Scene first; only then is the shared stroke batch encoded so it
    // can load and preserve that scene.
    try {
      SomataGeometryPolicy.invoke(frameCtx, 'ensureEffectSceneRoot');
    } catch (err) {
      try {
        spiroPassIsolationNoteFailure?.('strictSpiralRootPreflight', err, frameCtx);
      } catch (error) {
        noteSuppressedError('render/main-pipeline#renderPreparedMainLayer', error);
      }
    }
    runRegisteredStage(SomataRenderPassRegistry.STAGES.FILL);
    runRegisteredStage(SomataRenderPassRegistry.STAGES.OVER_FILL);

    try {
      recordStep('strokeBatch.prepare', () => SomataStrokeBatchService.prepare(frameCtx));
    } catch (err) {
      frameCtx._webgpuStrokeBatch = null;
      try {
        spiroPassIsolationNoteFailure?.('strokeBatch', err, frameCtx);
      } catch (error) {
        noteSuppressedError('render/main-pipeline#renderPreparedMainLayer', error);
      }
    }
    runRegisteredHooks('afterStrokeBatch');

    if (
      Number(frameCtx.frame?.renderLayerCount || 0) > 1 &&
      WebGPUStrokeRenderer.getFrameSceneTexture?.(frameCtx.frameId)
    ) {
      const batch = frameCtx._webgpuStrokeBatch,
        contract = getLayerGeometryContract(frameCtx),
        fillPrepared = frameCtx?._webgpuFillPrepared;
      const sceneHasAuthoritativeFill =
        batch?.fillInScene === true &&
        (fillPrepared?.authoritative === true || batch?.nativeFillInScene === true);
      const needsOutOfSceneFill =
        contract?.fillRequested === true &&
        !sceneHasAuthoritativeFill &&
        frameCtx?._baseFillCommitted !== true;
      const hiddenGraffitiCarrier =
        frameCtx.lineProfileStrokeOnly === true && frameCtx.lineProfileApplication === 'graffiti';
      const canJoin = Boolean(
        (batch?.sceneCombined && !needsOutOfSceneFill && canDeferLayerSceneForFrame(frameCtx, batch)) ||
        canUseGpuOnlyCorridorLayerScene(frameCtx, hiddenGraffitiCarrier) ||
        SomataGeometryPolicy.invoke(frameCtx, 'canUseFrameScene') === true ||
        SomataGeometryPolicy.invoke(
          frameCtx,
          'canUseLayerScene',
          hiddenGraffitiCarrier && frameCtx.morphFrameActive === true,
        ) === true,
      );
      if (!canJoin) {
        if (SomataGeometryPolicy.isStrict(frameCtx)) {
          renderBackendTelemetry.mark(
            'geometry',
            'gpu',
            'strict Spiral waits to join frame GPU scene; materialization forbidden',
          );
          try {
            requestMainCanvasRender?.();
          } catch (error) {
            noteSuppressedError('render/main-pipeline#renderPreparedMainLayer', error);
          }
          return;
        }

        const presented = recordStep('frameScene.presentToMain', () =>
          WebGPUStrokeRenderer.presentFrameSceneToMain?.(frameCtx.frameId, mainCtx, true),
        );
        if (presented) {
          frameCtx.frame.gpuMainCanvasHasContent = true;
          try {
            notifyFrameSceneEffectCommandsSubmitted?.(frameCtx.frame);
          } catch (error) {
            noteSuppressedError('render/main-pipeline#renderPreparedMainLayer', error);
          }
        } else
          somataGpuDiagnosticError(
            'geometry',
            'frame-scene-present',
            'GPU frame scene could not be presented',
            frameCtx,
            { fallback: 'gpu-current-frame-repaint', recovered: true },
          );
        noteFrameGraphMaterialization(frameCtx.frameId);
        frameCtx.frame.gpuMainSceneEmpty = false;
      }
    }

    try {
      SomataGeometryPolicy.invoke(frameCtx, 'ensureEffectSceneRoot');
    } catch (err) {
      try {
        spiroPassIsolationNoteFailure?.('strictSpiralRoot', err, frameCtx);
      } catch (error) {
        noteSuppressedError('render/main-pipeline#renderPreparedMainLayer', error);
      }
    }
    runRegisteredStage(SomataRenderPassRegistry.STAGES.GLOW);
    runRegisteredStage(SomataRenderPassRegistry.STAGES.BASE);

    try {
      spiroGpuPreflightLayerPrerequisites?.(frameCtx);
    } catch (err) {
      try {
        spiroPassIsolationNoteFailure?.('gpuPreflight', err, frameCtx);
      } catch (error) {
        noteSuppressedError('render/main-pipeline#renderPreparedMainLayer', error);
      }
    }
    runRegisteredStage(SomataRenderPassRegistry.STAGES.POST_BASE);
    window.SomataJumpTrace?.observeRounding?.(frameCtx);
    window.SomataJumpTrace?.sample(frameCtx);

    const strictCarrierExpected =
      SomataGeometryPolicy.isStrict(frameCtx) &&
      frameCtx.lineDisplayEnabled === true &&
      frameCtx.lineProfileStrokeOnly !== true &&
      !(typeof isPathFxBaseReplacementActive === 'function' && isPathFxBaseReplacementActive(frameCtx));
    if (strictCarrierExpected && frameCtx._baseStrokeCommitted !== true) {
      frameCtx.frame._strictSpiralGpuFrameIncomplete = true;
      somataSpiralSceneDiag.base.stage = 'base-missing-full-gpu-error';
      renderBackendTelemetry.mark('geometry', 'gpu', 'strict Spiral Base missing; Full GPU frame rejected');
      somataGpuContractError('SPIRAL_BASE_MISSING_AT_FRAME_END', frameCtx, {
        base: { ...somataSpiralSceneDiag.base },
      });
      try {
        requestMainCanvasRender?.();
      } catch (error) {
        noteSuppressedError('render/main-pipeline#renderPreparedMainLayer', error);
      }
    }

    if (frameCtx._spiralBezierFrameSceneDirect === true && frameCtx._spiralBezierFrameSceneCounted !== true) {
      frameCtx._spiralBezierFrameSceneCounted = true;
      frameCtx.frame.gpuFrameSceneLayers = (Number(frameCtx.frame.gpuFrameSceneLayers) || 0) + 1;
      if (frameCtx.frame.gpuFrameSceneLayers === frameCtx.frame.renderLayerCount)
        frameCtx.frame.gpuMainSceneEmpty = frameCtx.frame.gpuMainCanvasHasContent !== true;
    }

    // Do not make one invisible Base the implicit presentation anchor for
    // multiple independent Glints. Every hidden-line Glint owns a completed
    // transparent scene, even when other visible layers use the frame GPU path.
    if (
      somataNeedsIsolatedHiddenGlintPresentation(frameCtx) &&
      frameCtx.frame?.gpuLayerSceneDeferred === true
    ) {
      somataHiddenGlintComposeStats.attempts++;
      somataHiddenGlintComposeStats.lastLayerId = frameCtx.layer?.id || null;
      const presented = recordStep('hiddenGlint.presentLayerScene', () =>
        materializeDeferredLayerScene(frameCtx),
      );
      if (presented) {
        somataHiddenGlintComposeStats.presented++;
        SomataLayerSceneService.markMainCanvasContent(frameCtx, true);
        renderBackendTelemetry.mark('sweep', 'gpu', 'isolated hidden-line Glint Layer Scene');
      } else {
        somataHiddenGlintComposeStats.failed++;
        somataGpuDiagnosticError(
          'sweep',
          'hidden-glint-layer-presentation',
          'Independent Glint Layer Scene could not be presented',
          frameCtx,
          { fallback: 'retry-independent-glint-presentation', recovered: false },
        );
        try {
          requestMainCanvasRender?.();
        } catch (error) {
          noteSuppressedError('render/main-pipeline#renderPreparedMainLayer', error);
        }
      }
    }

    if (frameCtx.frame?.gpuLayerSceneDeferred && Number(frameCtx.frame.renderLayerCount || 0) > 1) {
      const extra = collectLayerSceneCommandBuffers(frameCtx.frame);

      WebGPUStrokeRenderer.appendFrameUnderlayCommands?.(frameCtx.frameId, extra);
      if (
        recordStep('frameScene.sealDeferred', () =>
          WebGPUStrokeRenderer.sealDeferredLayerSceneToFrame?.(frameCtx.frameId, extra),
        )
      ) {
        try {
          transferLayerSceneEffectCallbacksToFrameScene?.(frameCtx.frame);
        } catch (error) {
          noteSuppressedError('render/main-pipeline#renderPreparedMainLayer', error);
        }
        frameCtx.frame.gpuLayerSceneDeferred = false;
        clearLayerSceneEffectCommands(frameCtx.frame);
        frameCtx.frame.gpuFrameSceneLayers = (Number(frameCtx.frame.gpuFrameSceneLayers) || 0) + 1;
        if (frameCtx.frame.gpuFrameSceneLayers === frameCtx.frame.renderLayerCount) {
          frameCtx.frame.gpuMainSceneEmpty = frameCtx.frame.gpuMainCanvasHasContent !== true;
        }
      } else {
        if (SomataGeometryPolicy.isStrict(frameCtx)) {
          renderBackendTelemetry.mark('final', 'gpu', 'strict Spiral multi-layer seal failed; no fallback');
          somataGpuContractError('SPIRAL_FRAME_SCENE_SEAL_FAILED', frameCtx, {
            layers: Number(frameCtx.frame?.gpuFrameSceneLayers) || 0,
            expected: Number(frameCtx.frame?.renderLayerCount) || 0,
          });
          frameCtx.frame._strictSpiralGpuFrameIncomplete = true;
          try {
            WebGPUStrokeRenderer.discardFrameScene?.(frameCtx.frameId);
          } catch (error) {
            noteSuppressedError('render/main-pipeline#renderPreparedMainLayer', error);
          }
          try {
            WebGPUStrokeRenderer.clearDeferredLayerScene?.();
          } catch (error) {
            noteSuppressedError('render/main-pipeline#renderPreparedMainLayer', error);
          }
          try {
            WebGPUStrokeRenderer.discardFrameUnderlay?.(frameCtx.frameId);
          } catch (error) {
            noteSuppressedError('render/main-pipeline#renderPreparedMainLayer', error);
          }
          clearLayerSceneEffectCommands(frameCtx.frame);
          frameCtx.frame.gpuLayerSceneDeferred = false;
          try {
            requestMainCanvasRender?.();
          } catch (error) {
            noteSuppressedError('render/main-pipeline#renderPreparedMainLayer', error);
          }
          return;
        }

        if (WebGPUStrokeRenderer.getFrameSceneTexture?.(frameCtx.frameId)) {
          const presented = recordStep('frameScene.sealFallback', () =>
            WebGPUStrokeRenderer.presentFrameSceneToMain?.(frameCtx.frameId, mainCtx, true),
          );
          if (presented)
            try {
              notifyFrameSceneEffectCommandsSubmitted?.(frameCtx.frame);
            } catch (error) {
              noteSuppressedError('render/main-pipeline#renderPreparedMainLayer', error);
            }
        }
        materializeDeferredLayerScene(frameCtx);
        frameCtx.frame.gpuMainSceneEmpty = false;
      }
    }
  } finally {
    mainCtx.restore();
    frameCtx.drawLayerGeometry = null;
    frameCtx.drawLayerInstances = null;
    frameCtx.drawLayerFillInstances = null;
    frameCtx.frameVectorMaster = null;
    frameCtx._spiralCorridorSharedLineAuthority = false;
    frameCtx._corridorLayerSceneActive = false;
    frameCtx._spiralBezierFrameSceneDirect = false;
    frameCtx._spiralBezierFrameSceneCounted = false;
    frameCtx._webgpuStrokeBatch = null;
    frameCtx._webgpuFillPrepared = null;
    frameCtx._nativeFillMeshCandidate = null;
    frameCtx._frameContourRecord = null;
    frameCtx._geometryContract = null;
    frameCtx._geometryKernelView = null;
    frameCtx._geometryKernelStrokeView = null;
    frameCtx._fillMeshShadow = null;
    resetMainLayerGeometryPlan(frameCtx.geometryPlan);
    resetLayerEffectsPlan(frameCtx.effectsPlan);
    frameCtx.prepared = false;
  }
}

function renderMainLayer(renderFrame, layerIndex) {
  // Keep the existing Fourier-dependent GPU/CPU paths, but resolve them against
  // the layer being prepared/drawn. Never use the selected UI layer here.
  const authored = (state.layers || [])[layerIndex];
  // Тип морфинга зависит от пары слоя: спираль на любом конце — тип спирали.
  return withLayerMorphMode(layerIndex, () =>
    somataWithFourierLayer(authored, () => renderMainLayerFourierScoped(renderFrame, layerIndex)),
  );
}
function renderMainLayerFourierScoped(renderFrame, layerIndex) {
  const started = performance.now();
  const details = renderPerf.currentFramePhases?.layerDetails;
  const diagnostic = Array.isArray(details)
    ? { index: layerIndex, prepareMs: 0, drawMs: 0, totalMs: 0, steps: Object.create(null) }
    : null;
  let __pt = renderPassProfiler.begin();
  let frameCtx = null;
  try {
    frameCtx = runSpiroIsolatedLayerPreparation(renderFrame, layerIndex, () =>
      prepareMainLayerFrame(renderFrame, layerIndex),
    );
  } finally {
    renderPassProfiler.end('layerPrepare', __pt);
    if (diagnostic) diagnostic.prepareMs = performance.now() - started;
  }
  if (frameCtx) {
    try {
      window.SomataMirror?.captureLayer?.(frameCtx);
    } catch (error) {
      noteSuppressedError('render/main-pipeline#renderMainLayerFourierScoped', error);
    }
    if (diagnostic) {
      diagnostic.kind = String(frameCtx.geometryPlan?.kind || 'unknown');
      frameCtx._slowFrameLayerTiming = diagnostic;
    }
    try {
      window.SomataSkeletonOverlay?.capture?.(frameCtx, mainCtx.getTransform());
    } catch (error) {
      noteSuppressedError('render/main-pipeline#renderMainLayerFourierScoped', error);
    }
    if (SomataGeometryPolicy.isStrict(frameCtx) && renderFrame)
      renderFrame.strictSpiralGpuPresentRequired = true;
    const drawStarted = performance.now();
    try {
      renderPreparedMainLayer(frameCtx);
    } catch (err) {
      try {
        spiroPassIsolationNoteFailure?.('layerRender', err, frameCtx);
      } catch (_) {
        console.error('SpiroStar isolated layer render failure:', err);
      }
    } finally {
      if (diagnostic) {
        diagnostic.drawMs = performance.now() - drawStarted;
        frameCtx._slowFrameLayerTiming = null;
      }
    }
  }
  if (diagnostic) {
    diagnostic.totalMs = performance.now() - started;
    details.push(diagnostic);
  }
}

function renderMainLayers(renderFrame) {
  for (let layerIndex = 0; layerIndex < renderFrame.renderLayerCount; layerIndex++) {
    renderMainLayer(renderFrame, layerIndex);
  }
}

function renderMainViewportEffects(renderFrame) {
  const { w, h, dpr } = renderFrame;

  renderFrame.gpuFinalVignetteDeferred =
    (typeof somataGpuBackendAllowed !== 'function' || somataGpuBackendAllowed()) &&
    WebGPUFinalCompositeRenderer.canDeferVignette(renderFrame);

  if (!renderFrame.gpuFinalVignetteDeferred && renderFrame.strictSpiralGpuPresentRequired !== true) {
    applyTunnelScreenEdgeFeather(mainCtx, w, h, dpr);
    // eslint-disable-next-line no-undef -- известный баг исходной 15, поведение сохранено; см. docs/Code_Map.md
    if (typeof applyTunnelCenterRevealMask === 'function') applyTunnelCenterRevealMask(mainCtx, renderFrame);
  }

  if (state.showBoundingCircle) {
    const maxR = computeMaxLayerRadius();
    mainCtx.save();
    mainCtx.beginPath();
    mainCtx.arc(0, 0, maxR, 0, Math.PI * 2);
    mainCtx.setLineDash([6, 6]);
    mainCtx.strokeStyle = state.boundingCircleColor || '#94a3b8';
    mainCtx.globalAlpha = 0.42;
    mainCtx.lineWidth = 1 / Math.max(state.zoom, 0.2);
    mainCtx.shadowBlur = 0;
    mainCtx.stroke();
    mainCtx.restore();
  }

  mainCtx.restore();
  renderFrame.canvasTransformSaved = false;
}

function recoverMainRenderError(err, renderFrame) {
  const now = performance.now();
  if (!renderPerf.lastErrorAt || now - renderPerf.lastErrorAt > 1000) {
    console.error('SpiroStar render recovered from an error:', err);
    renderPerf.lastErrorAt = now;
  }
  try {
    if (renderFrame?.canvasTransformSaved) {
      mainCtx.restore();
      renderFrame.canvasTransformSaved = false;
    }
    mainCtx.setTransform(1, 0, 0, 1, 0, 0);
    mainCtx.globalAlpha = 1;
    mainCtx.filter = 'none';
    mainCtx.shadowBlur = 0;
    mainCtx.setLineDash([]);

    clearLayerSceneEffectCommands(renderFrame);
    try {
      clearFrameSceneEffectCallbacks?.(renderFrame);
    } catch (error) {
      noteSuppressedError('render/main-pipeline#recoverMainRenderError', error);
    }
    try {
      spiroPassIsolationNoteFailure?.('frame', err, { frameId: renderFrame?.id, layerIndex: -1 });
    } catch (error) {
      noteSuppressedError('render/main-pipeline#recoverMainRenderError', error);
    }
  } catch (error) {
    noteSuppressedError('render/main-pipeline#recoverMainRenderError', error);
  }
}

function recoverGpuPresentationToMainCanvas(renderFrame) {
  const frameId = Number(renderFrame?.id) || 0;
  let needed = false,
    recovered = false,
    ok = true;
  try {
    const frameScene = WebGPUStrokeRenderer.getFrameSceneTexture?.(frameId);
    if (frameScene) {
      needed = true;
      const shown = WebGPUStrokeRenderer.presentFrameSceneToMain?.(frameId, mainCtx, true) === true;
      if (shown) {
        recovered = true;
        try {
          notifyFrameSceneEffectCommandsSubmitted?.(renderFrame);
        } catch (error) {
          noteSuppressedError('render/main-pipeline#recoverGpuPresentationToMainCanvas', error);
        }
      } else ok = false;
    } else if (renderFrame?.gpuLayerSceneDeferred === true) {
      needed = true;
      const extra = collectLayerSceneCommandBuffers(renderFrame);
      const shown = WebGPUStrokeRenderer.presentDeferredLayerSceneToMain?.(frameId, mainCtx, extra) === true;
      if (shown) {
        recovered = true;
        notifyLayerSceneEffectCommandsSubmitted(renderFrame);
        clearLayerSceneEffectCommands(renderFrame);
      } else ok = false;
    }
  } catch (_) {
    ok = false;
  }
  try {
    if (renderFrame?.gpuLampsDeferred === true) {
      needed = true;
      const shown = SomataLampPassService.presentDeferred() === true;
      if (shown) recovered = true;
      else ok = false;
    }
  } catch (_) {
    ok = false;
  }
  try {
    WebGPUFinalCompositeRenderer.disable?.();
  } catch (error) {
    noteSuppressedError('render/main-pipeline#recoverGpuPresentationToMainCanvas', error);
  }
  if (renderFrame) {
    renderFrame.gpuLayerSceneDeferred = false;
    renderFrame.gpuLampsDeferred = false;
    renderFrame.gpuFinalVignetteDeferred = false;
    renderFrame.gpuMainSceneEmpty = false;
  }
  return { ok: ok === true, recovered, needed };
}

function finishMainRenderFrame(renderStartedAt, renderFrame) {
  const framePhases = renderPerf.currentFramePhases;
  let phaseAt = performance.now();
  if (renderFrame?.canvasTransformSaved) {
    try {
      mainCtx.restore();
    } catch (error) {
      noteSuppressedError('render/main-pipeline#finishMainRenderFrame', error);
    }
    renderFrame.canvasTransformSaved = false;
  }
  let presented = false;
  if (somataGpuBackendAllowed()) {
    try {
      presented = WebGPUFinalCompositeRenderer.render(renderFrame) === true;
    } catch (err) {
      somataGpuContractError('FINAL_GPU_RENDER_EXCEPTION', renderFrame, { error: String(err?.stack || err) });
    }
  } else
    somataGpuDiagnosticError(
      'final',
      'capability',
      'WebGPU is unavailable; Somata 7.5 has no CPU renderer',
      renderFrame,
    );
  if (framePhases) framePhases.finalGpuMs = performance.now() - phaseAt;
  phaseAt = performance.now();
  if (!presented) {
    const rescue = recoverGpuPresentationToMainCanvas(renderFrame);
    if (rescue.ok) {
      renderBackendTelemetry.mark(
        'final',
        'gpu',
        rescue.recovered
          ? 'GPU fallback presented current frame to main canvas'
          : 'current main-canvas frame shown; stale final GPU frame disabled',
      );
      if (rescue.needed && rescue.recovered) {
        somataGpuDiagnosticError(
          'final',
          'presentation-fallback',
          'Final WebGPU compositor declined the current frame; the current GPU scene was presented through the GPU-to-main fallback',
          renderFrame,
          { fallback: 'gpu-to-main-canvas', recovered: true },
        );
      }
    } else {
      renderBackendTelemetry.mark('final', 'gpu', 'GPU frame rejected; fallback presentation failed', true);
      const faults = Array.isArray(renderFrame?._fullGpuFaults)
        ? renderFrame._fullGpuFaults.slice(-SOMATA_FULL_GPU_FRAME_FAULT_LIMIT)
        : [];
      somataGpuContractError('FINAL_FULL_GPU_PRESENT_FAILED', renderFrame, {
        final: WebGPUFinalCompositeRenderer.status?.() || null,
        stroke: WebGPUStrokeRenderer.status?.() || null,
        faultCount: Number(renderFrame?._fullGpuFaultCount) || faults.length,
        faults,
        fallback: 'gpu-to-main-canvas-failed',
      });
      try {
        WebGPUStrokeRenderer.discardFrameScene?.(renderFrame?.id);
      } catch (error) {
        noteSuppressedError('render/main-pipeline#finishMainRenderFrame', error);
      }
      try {
        WebGPUStrokeRenderer.clearDeferredLayerScene?.();
      } catch (error) {
        noteSuppressedError('render/main-pipeline#finishMainRenderFrame', error);
      }
      try {
        WebGPUStrokeRenderer.discardFrameUnderlay?.(renderFrame?.id);
      } catch (error) {
        noteSuppressedError('render/main-pipeline#finishMainRenderFrame', error);
      }
      try {
        SomataLampPassService.clear?.();
      } catch (error) {
        noteSuppressedError('render/main-pipeline#finishMainRenderFrame', error);
      }
      clearLayerSceneEffectCommands(renderFrame);
      try {
        clearFrameSceneEffectCallbacks?.(renderFrame);
      } catch (error) {
        noteSuppressedError('render/main-pipeline#finishMainRenderFrame', error);
      }
      try {
        requestMainCanvasRender?.();
      } catch (error) {
        noteSuppressedError('render/main-pipeline#finishMainRenderFrame', error);
      }
    }
  } else if (renderFrame) {
    renderBackendTelemetry.mark('final', 'gpu', 'final WebGPU composite');
    renderFrame.gpuLayerSceneDeferred = false;
    renderFrame.gpuLampsDeferred = false;
    renderFrame.gpuFinalVignetteDeferred = false;
    renderFrame.gpuMainSceneEmpty = false;
  }
  try {
    window.SomataSkeletonOverlay?.present?.();
  } catch (error) {
    noteSuppressedError('render/main-pipeline#finishMainRenderFrame', error);
  }
  try {
    window.SomataMirror?.present?.(renderFrame, presented);
  } catch (err) {
    console.warn('[Somata Mirror] overlay skipped', err);
  }
  if (framePhases) framePhases.presentationRescueMs = performance.now() - phaseAt;
  phaseAt = performance.now();
  try {
    SomataFeatureLifecycle?.end?.(renderFrame, somataGpuBackendAllowed());
  } catch (err) {
    spiroPassIsolationNoteFailure?.('featureLifecycleEnd', err, { frameId: renderFrame?.id, layerIndex: -1 });
  }
  finishLampAdaptiveFrame();
  endFrameGeometryRuntime();
  renderRuntime.end();
  if (framePhases) framePhases.frameCleanupMs = performance.now() - phaseAt;
  const paintNow = performance.now();
  renderPerf.lastRenderMs = Math.max(0, paintNow - renderStartedAt);
  renderPerf.lastPaintAt = paintNow;
  performanceGovernor.noteFrame(paintNow, renderPerf.lastRenderMs);
  renderBackendTelemetry.commit();
  if (showFpsCounter) {
    if (!renderPerf.fpsLastFrameAt || paintNow - renderPerf.fpsLastFrameAt > 500) {
      renderPerf.fpsWindowStart = paintNow;
      renderPerf.fpsFrames = 0;
    }
    renderPerf.fpsLastFrameAt = paintNow;
    renderPerf.fpsFrames += 1;
    const elapsed = paintNow - renderPerf.fpsWindowStart;
    if (elapsed >= 750) {
      const fps = Math.max(0, Math.round((renderPerf.fpsFrames * 1000) / Math.max(1, elapsed))),
        text = `${fps} FPS`;
      if (fpsCounterEl && text !== renderPerf.lastFpsText) {
        fpsCounterEl.textContent = text;
        renderPerf.lastFpsText = text;
      }
      renderPerf.fpsWindowStart = paintNow;
      renderPerf.fpsFrames = 0;
    }
  }
  renderPassProfiler.finish();
  if (framePhases) {
    const round = (ms) => Number(Math.max(0, Number(ms) || 0).toFixed(2));
    framePhases.totalMs = round(performance.now() - renderStartedAt);
    const keys = [
      'framePrepareMs',
      'layersMs',
      'lampGpuMs',
      'viewportMs',
      'finalGpuMs',
      'presentationRescueMs',
      'frameCleanupMs',
    ];
    for (const key of keys) framePhases[key] = round(framePhases[key]);
    framePhases.unattributedMs = round(
      framePhases.totalMs - keys.reduce((sum, key) => sum + framePhases[key], 0),
    );
    // Retain only finite numeric timings and a small (up to 8) layer list;
    // never retain geometry, render contexts or GPU handles in diagnostics.
    const layerDetails = framePhases.layerDetails.slice(0, 8).map((entry) => ({
      index: entry.index,
      kind: entry.kind || 'unknown',
      prepareMs: round(entry.prepareMs),
      drawMs: round(entry.drawMs),
      totalMs: round(entry.totalMs),
      steps: Object.fromEntries(Object.entries(entry.steps).map(([key, ms]) => [key, round(ms)])),
    }));
    const snapshot = { ...framePhases, layerDetails: layerDetails };
    renderPerf.lastFramePhases = snapshot;
    if (snapshot.totalMs >= 100) {
      const history = renderPerf.recentSlowFramePhases;
      history.push(snapshot);
      if (history.length > 12) history.shift();
    }
    renderPerf.currentFramePhases = null;
  }
  renderPerf.rendering = false;
  // Notify the independent optical overlay only AFTER WebGPU composition for
  // this frame has been submitted. The foreground must sample this frame,
  // not the previous one prepared by the pre-paint animation task.
  try {
    window.SomataAmbientPrism?.afterScenePaint?.(paintNow, renderFrame?.id);
  } catch (err) {
    console.error('[Somata 3D optical post-scene render]', err);
  }
}

window.__somataReport = () => {
  let layer = null;
  try {
    layer = getRuntimeLayerById(state?.activeLayerId) || state?.layers?.[0] || null;
  } catch (_) {
    layer = state?.layers?.[0] || null;
  }
  let scheduler = null,
    hub = null,
    stroke = null,
    finalGpu = null,
    backend = null,
    morph = null;
  try {
    scheduler = animationScheduler.stats();
  } catch (error) {
    noteSuppressedError('render/main-pipeline#__somataReport', error);
  }
  try {
    hub = window.__spiroWebGPUHubStatus?.() || null;
  } catch (error) {
    noteSuppressedError('render/main-pipeline#__somataReport', error);
  }
  try {
    stroke = window.__spiroWebGPUStatus?.() || null;
  } catch (error) {
    noteSuppressedError('render/main-pipeline#__somataReport', error);
  }
  try {
    finalGpu = window.__spiroFinalGPUStatus?.() || null;
  } catch (error) {
    noteSuppressedError('render/main-pipeline#__somataReport', error);
  }
  try {
    backend = window.__spiroRenderBackendStatus?.() || null;
  } catch (error) {
    noteSuppressedError('render/main-pipeline#__somataReport', error);
  }
  try {
    morph = window.__somataSpiralBezierMorphStatus?.() || null;
  } catch (error) {
    noteSuppressedError('render/main-pipeline#__somataReport', error);
  }
  const frame = renderRuntime?.frame || null;
  const spiral = Boolean(layer && typeof isSpiralLayer === 'function' && isSpiralLayer(layer));
  const report = {
    version: '7.5',
    boot: window.__spiroAppBootComplete === true,
    now: Number(performance.now().toFixed(1)),
    scheduler,
    layer: layer
      ? {
          id: layer.id || null,
          visible: layer.visible !== false,
          spiral,
          lineVisible: getLayerLineVisible(layer),
          opacity: Number(layer.opacity),
          fill: layer.fill === true,
          profileMode: layer.profileMode || null,
          splineRenderMode: layer.splineRenderMode || null,
        }
      : null,
    frame: frame
      ? {
          id: Number(frame.id) || 0,
          strictSpiralGpuPresentRequired: frame.strictSpiralGpuPresentRequired === true,
          gpuLayerSceneDeferred: frame.gpuLayerSceneDeferred === true,
          gpuMainSceneEmpty: frame.gpuMainSceneEmpty === true,
          gpuMainCanvasHasContent: frame.gpuMainCanvasHasContent === true,
          gpuFrameSceneLayers: Number(frame.gpuFrameSceneLayers) || 0,
          renderLayerCount: Number(frame.renderLayerCount) || 0,
        }
      : null,
    spiralScene: {
      internal: { ...somataSpiralSceneDiag.internal },
      external: { ...somataSpiralSceneDiag.external },
      base: { ...somataSpiralSceneDiag.base },
    },
    webgpu: {
      hub,
      stroke: stroke
        ? {
            available: stroke.available,
            ready: stroke.ready,
            lastError: stroke.lastError,
            offscreenBaseReady: stroke.offscreenBaseReady,
            layerBatch: stroke.layerBatch,
            hub: stroke.hub,
          }
        : null,
      final: finalGpu,
      morph: morph
        ? {
            ready: morph.ready,
            initializing: morph.initializing,
            lastError: morph.lastError,
            lastDecision: morph.lastDecision,
            stats: morph.stats,
          }
        : null,
    },
    backend,
    events: typeof window.__somataDiagEvents === 'function' ? window.__somataDiagEvents() : [],
  };
  console.group('[Somata Iter31 report]');
  console.log(report);
  if (spiral && !somataSpiralSceneDiag.internal.ok)
    console.warn('[Somata Spiral] internal GPU scene blocked:', somataSpiralSceneDiag.internal.reason);
  if (hub?.lastError) console.error('[Somata WebGPU hub]', hub.lastError);
  if (stroke?.lastError) console.error('[Somata stroke]', stroke.lastError);
  if (finalGpu?.lastError) console.error('[Somata final]', finalGpu.lastError);
  console.groupEnd();
  return report;
};
window.__somataReportText = () => JSON.stringify(window.__somataReport(), null, 2);
window.__somataRenderNow = () => {
  try {
    window.__somataDiagNote?.('manual-render', '__somataRenderNow');
    renderMainCanvas();
  } catch (err) {
    console.error('[Somata manual render failed]', err);
  }
  return window.__somataReport();
};

function renderMainCanvas() {
  // Do not queue another expensive frame when the GPU is not retiring buffers.
  // The animation scheduler may continue to advance time; presentation resumes on fence completion.
  if (typeof WebGPUDeviceHub !== 'undefined' && WebGPUDeviceHub.shouldThrottle()) return;
  if (typeof WebGPUBufferRecycler !== 'undefined' && WebGPUBufferRecycler.shouldThrottle()) return;
  if (renderPerf.rendering) return;
  renderPerf.rendering = true;
  const renderStartedAt = performance.now();
  const renderFrame = renderRuntime.begin(renderStartedAt);
  const framePhases = {
    frameId: Number(renderFrame?.id) || 0,
    framePrepareMs: 0,
    layersMs: 0,
    layerDetails: [],
    lampGpuMs: 0,
    viewportMs: 0,
    finalGpuMs: 0,
    presentationRescueMs: 0,
    frameCleanupMs: 0,
    gpuMainUploadMs: 0,
    gpuQueueSubmitMs: 0,
  };
  renderPerf.currentFramePhases = framePhases;
  try {
    beginSpiroPassIsolationFrame(renderFrame?.id || renderRuntime?.frameId || 0);
  } catch (error) {
    noteSuppressedError('render/main-pipeline#renderMainCanvas', error);
  }
  renderBackendTelemetry.begin(renderFrame?.id || renderRuntime?.frameId || 0);
  renderPassProfiler.beginFrame();
  try {
    let phaseAt = performance.now();
    let __pt = renderPassProfiler.begin();
    prepareMainRenderFrame(renderFrame);
    renderPassProfiler.end('framePrepare', __pt);
    framePhases.framePrepareMs = performance.now() - phaseAt;
    phaseAt = performance.now();
    __pt = renderPassProfiler.begin();
    renderMainLayers(renderFrame);
    renderPassProfiler.end('layersTotal', __pt);
    framePhases.layersMs = performance.now() - phaseAt;

    phaseAt = performance.now();
    __pt = renderPassProfiler.begin();
    if (typeof somataGpuBackendAllowed !== 'function' || somataGpuBackendAllowed()) {
      const deferGpuLamps = WebGPUFinalCompositeRenderer.canDeferLamps(renderFrame);
      SomataLampPassService.flush(renderFrame, deferGpuLamps);
    } else renderFrame.gpuLampsDeferred = false;
    renderPassProfiler.end('lampGPU', __pt);
    framePhases.lampGpuMs = performance.now() - phaseAt;
    phaseAt = performance.now();
    __pt = renderPassProfiler.begin();
    renderMainViewportEffects(renderFrame);
    renderPassProfiler.end('viewport', __pt);
    framePhases.viewportMs = performance.now() - phaseAt;
  } catch (err) {
    recoverMainRenderError(err, renderFrame);
  } finally {
    try {
      finishMainRenderFrame(renderStartedAt, renderFrame);
    } catch (finalizeErr) {
      console.error('SpiroStar frame finalization recovered from an error:', finalizeErr);
      try {
        endFrameGeometryRuntime();
      } catch (error) {
        noteSuppressedError('render/main-pipeline#renderMainCanvas', error);
      }
      try {
        renderRuntime.end();
      } catch (error) {
        noteSuppressedError('render/main-pipeline#renderMainCanvas', error);
      }
    } finally {
      renderPerf.rendering = false;
    }
  }
}

export { renderMainCanvas };
