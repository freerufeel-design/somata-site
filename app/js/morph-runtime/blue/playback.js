// Blue Morph: воспроизведение (фазы, подготовка GPU, смена порядка).
import { recentManualGeometryIntent, markManualGeometryRebase } from '../../app/geometry-monitor-origin.js';
import './targets.js'; // initialisation order: this module runs after it
import { renderProfileEditor } from '../../ui/profile-editor.js';
import {
  getEffectiveSpiralOrder,
  getEffectiveSpiralStep,
  isSpiralLayer,
  normalizeSpiralOrder,
  normalizeSpiralStep,
} from '../../geometry/spiral/order-params.js';
import {
  nearestSpiralProfileLogicalCornerFlags,
  segmentProfileCornerFlags,
} from '../../geometry/spiral/profile-prep.js';
import { buildOrbitPolylines } from '../../geometry/orbit-builder.js';
import { WebGPUFinalCompositeRenderer } from '../../gpu/final-composite-renderer.js';
import { WebGPUStrokeRenderer } from '../../gpu/stroke-renderer.js';
import { ensureAudioRoutingState, routeBandForLayerIndex } from '../../audio/audio-routing.js';
import { lampMotionRuntime } from '../../lamps/lamp-motion.js';
import {
  applyPendingWebSwitchAtMorphBoundary,
  flushPendingWebSwitchIfMorphStopped,
  webRuntime,
} from '../../effects/web.js';
import { somataGpuBackendAllowed } from '../../core/backend-policy.js';
import {
  DEFAULT_FILL_OPACITY_PERCENT,
  cloneEffectConfig,
  colorBaseHex6,
  effectStateReadyLayers,
  ensureLayerEffectState,
  ensureLayerLampState,
  gcd,
  getFillOpacityPercent,
  getFillOpacityUnit,
  getLayerLampsEnabled,
  getLayerSweepConfig,
  getLayerWebConfig,
  getLayerWebEnabled,
  randomBrightLayerColor,
  setSidebarFeatureEnabled,
  withLampConfig,
} from '../../core/defaults-layers.js';
import { getLayerVersions } from '../../core/layer-versions.js';
import { SpiroMorphController } from '../../core/morph-controller.js';
import {
  MAX_ROUNDING_PERCENT,
  cyclePlaylistPaletteForContext,
  getEffectivePlaylistHueOffset,
  interpolateMorphRounding,
  morphPaletteSyncEnabled,
  normalizePlaylistHueOffset,
  setMorphPaletteForContext,
} from '../../core/palette.js';
import {
  invalidateLayerGeometry,
  invalidateLayerStyle,
  invalidateLayerTransform,
  isPreSampledSplineLayer,
  setPreSampledSplineLayer,
} from '../../core/render-runtime.js';
import { animationScheduler, requestMainCanvasRender } from '../../core/scheduler.js';
import { runtimeState, somataFourierActive, state } from '../../core/state.js';
import { getCachedLayerDrawData } from '../../effects/motion.js';
import { collectStaticLampPoints } from '../../geometry/frame-paths.js';
import { prepareMorphLayerSampleBudgets } from '../../geometry/morph-budget.js';
import {
  invalidateMorphFrameInterpolationPlans,
  prepareMorphFrameInterpolationPlans,
} from '../../geometry/morph-frame.js';
import { getCircleMorphPlan, getMorphClosureTransitionPlan, profileModeTransitionProgress } from '../../geometry/morph.js';
import { WebGPUBezierSweepRenderer } from '../../gpu/bezier-sweep-renderer.js';
import { WebGPUCanonicalSweepRenderer } from '../../gpu/canonical-sweep-renderer.js';
import { WebGPUGraffitiMorphRenderer } from '../../gpu/graffiti-morph-renderer.js';
import {
  buildGpuGraffitiSampleResource,
  ensureGpuGraffitiSamplePipeline,
} from '../../gpu/graffiti-sample-resource.js';
import { LampGPURenderer } from '../../gpu/lamp-renderer.js';
import { WebGPULightningArcRenderer } from '../../gpu/lightning-arc-renderer.js';
import {
  currentGpuBezierMorphResource,
  ensureGpuMorphArcPipelines,
  getGpuMorphArcResource,
  warmupGpuMorphArcResource,
} from '../../gpu/morph-arc-resource.js';
import { prepareSharedGpuMorphPathResources } from '../../gpu/morph-path-resource.js';
import { WebGPUParticleRenderer } from '../../gpu/particle-renderer.js';
import { WebGPUPathFxRenderer } from '../../gpu/path-fx-renderer.js';
import { WebGPUProfileArcMarkerRenderer } from '../../gpu/profile-arc-marker-renderer.js';
import { WebGPUSpiralBezierMorphRenderer } from '../../gpu/spiral-bezier-morph-renderer.js';
import { WebGPUTopologyMorphBaseRenderer } from '../../gpu/topology-morph-base-renderer.js';
import {
  buildGpuWebCornerResource,
  ensureGpuWebCornerPipelines,
  warmupGpuWebCornerResource,
} from '../../gpu/web-corner-resource.js';
import { WebGPUWebMorphRenderer } from '../../gpu/web-morph-renderer.js';
import { WebGPUWebThreadSceneRenderer } from '../../gpu/web-thread-scene-renderer.js';
import { renderMainCanvas } from '../../render/main-pipeline.js';
import { somataGpuContractError } from '../../render/render-diagnostics.js';
import { rotateBluePaletteHueColor } from '../../corridor/corridor-appearance.js';
import {
  shiftHonestZeroCorridorIntro,
  shiftHonestZeroCorridorOutro,
  stopHonestZeroCorridorIntro,
  stopHonestZeroCorridorOutro,
} from '../../corridor/corridor-transitions.js';
import {
  getLayerEditTargets,
  isAudioRotationOverrideActive,
  updateLayerListUI,
} from '../../ui/layer-selection.js';
import { formatDisplayNumber, normalizeMorphVertexRangeValues } from '../../ui/geometry-n-control.js';
import {
  UNIFIED_SPIRAL_TRANSPORTS,
  buildBlueProfileCarrierPlans,
  getEffectiveCircleSlideType,
  getMorphModeForLayer,
  getPolygonMorphMode,
  getSpiralMorphMode,
  getSpiralMorphType,
  getUnifiedMorphMode,
  isSpiralLayerMorphEnabled,
  setUnifiedMorphMode,
  spiralMorphKeepsContinuity,
  spiralMorphLocksK,
  spiralMorphLocksN,
  spiralMorphUsesCorridorPhase,
  spiralMorphUsesRetainedBezierRail,
} from '../morph-mode.js';
import { syncSidebarInputs, updateSidebarFromMorph } from '../../ui/sidebar-sync.js';
import { syncBlueMorphParameterDecorations } from '../../ui/blue-morph/parameter-bindings.js';
import { morphSpecialLayerCoverage } from '../../ui/blue-morph/profile-bindings.js';
import { syncMorphPlaybackButton, syncMorphProfileUI } from '../../ui/blue-morph/profiles.js';
import { applyMasterPath, cloneMasterLayerValue, masterPathValue } from '../../ui/master-layer.js';
import {
  activeEnsureFullMorphSchedulerOwnership,
  activePauseFullMorphForProjectOrange,
  morphSidebarRebaseRuntime,
  setActiveEnsureFullMorphSchedulerOwnership,
  setActivePauseFullMorphForProjectOrange,
  setActiveRebaseMinimalMorphing,
  setActiveRebaseMorphing,
  setActiveResumeFullMorphFromProjectOrange,
  setActiveStartMinimalMorphing,
  setActiveStartMorphing,
  setActiveStopMinimalMorphing,
  setActiveStopMorphing,
} from '../morph-hooks.js';
import {
  blueOrderPhaseDurationMs,
  getMorphIntervalMultiplier,
  getNextTapBoundary,
  getTapMorphIntervalSec,
  getTapTempoIntervalSec,
  isTapMorphSyncActive,
  sampleBlueSpiralOrder,
  syncGeometryMorphDuration,
} from '../../audio/tap-tempo.js';
import {
  refreshPlaylistPaletteHuePreviews,
  syncPlaylistPaletteHueOffsetUI,
} from '../../ui/playlist-palettes.js';
import { hasOrangeColorRoute } from '../../ui/orange-morph/routing-ui.js';
import { syncMorphIntervalQuickButtons } from '../../ui/morph-settings-panel.js';
import { getMorphLongPeriodDetailScale } from './interpolation.js';
import { acceptPlan, activeOrbitCount, planNextCycle } from './fill-lookahead.js';
import { noteSuppressedError } from '../../core/suppressed-errors.js';

function noteMorphGpuPrepareWait(owner, morphKind, now) {
  if (!owner) return false;
  if (owner.gpuPhasePreparing !== true) {
    owner._freezeGpuWaitStart = 0;
    owner._freezeGpuWaitSerial = -1;
    owner._freezeGpuWaitReportedAt = 0;
    return false;
  }
  const serial = Number(owner.gpuPhasePrepareSerial) || 0;
  if (owner._freezeGpuWaitSerial !== serial) {
    owner._freezeGpuWaitSerial = serial;
    owner._freezeGpuWaitStart = Number(now) || performance.now();
    owner._freezeGpuWaitReportedAt = 0;
  }
  const waitMs = Math.max(0, (Number(now) || performance.now()) - (Number(owner._freezeGpuWaitStart) || 0));
  if (
    waitMs >= 120 &&
    (Number(now) || performance.now()) - (Number(owner._freezeGpuWaitReportedAt) || 0) >= 1500
  ) {
    owner._freezeGpuWaitReportedAt = Number(now) || performance.now();
    try {
      animationScheduler.reportMorphFreeze?.('MORPH_GPU_PREPARE_WAIT', {
        durationMs: waitMs,
        morphKind: String(morphKind || 'Morph'),
        task: 'gpu-phase-prewarm',
        prepareSerial: serial,
      });
    } catch (error) {
      noteSuppressedError('morph-runtime/blue/playback#noteMorphGpuPrepareWait', error);
    }
  }
  return true;
}
function createMorphPlaybackModule(deps) {
  const { createOrangeComposition, MorphInterpolation, MorphTargets, MorphGeometry } = deps;
  const {
    MORPH_SAMPLE_COUNT,
    MORPH_PROFILE_MAX_POINTS,
    getMorphSplinePointCount,
    cloneProfileNodes,
    stripNearDuplicateProfilePoints,
    profileHasBacktrackingX,
    loopOrientationSign,
    polylineArcFractions,
    sampleOpenPolylineAtFractions,
    resampleOpenPolylineExact,
    densifyProfilePreservingCorners,
    compactMorphProfileNodes,
    pairCompactMorphProfiles,
    resolveMorphProfileMode,
    clamp01,
    easeSmooth,
    cubicBezierEase,
    androidBounce,
    fastOutSlowIn,
    MORPH_EASINGS,
    applyMorphEasing,
    sampleProfileForMorph,
    hexToRgb,
    rgbToHsl,
    hslToHex,
    lerpColorHsl,
    lerpPreparedHsl,
    lerpPreparedHslWithHueAmount,
  } = MorphInterpolation;
  const {
    colorWithAlpha,
    colorWithPercentAlpha,
    colorWithUnitAlpha,
    shiftHueHex,
    FILL_HARMONY_OFFSETS,
    getFillHarmonyOffsets,
    chooseFillHarmonyOffset,
    signedHueOffsetDegrees,
    lerpAngleDegrees,
    normalizedMorphShapeOptions,
    makeOpenProfileVariant,
    makeOpenAngularProfileVariant,
    morphProfileMetaMatches,
    morphLibraryProfileCandidates,
    createLibraryMorphProfileVariant,
    createElegantProceduralLoop,
    createMorphProfileVariant,
    getProfileKeyForLayer,
    pickMorphPalette,
    sameProfileVariant,
    chooseMorphVertexTarget,
    getActiveOrbitCount,
    chooseMorphOrbitTarget,
    getMorphSizeVariationFactor,
    chooseMorphSpiralLayerSet,
    chooseMorphSpiralOrderTarget,
    chooseMorphRotationDelta,
    chooseMorphTopologyTarget,
    buildMorphVisualTargets,
    buildLightMorphVisualTargets,
  } = MorphTargets;

  const toMorphHsl = (hex) => {
    const rgb = hexToRgb(hex);
    return rgbToHsl(rgb.r, rgb.g, rgb.b);
  };
  const getMorphVisualOrbitCount = (visual, fallbackLayer = null) => {
    const remembered = Number(visual?.morphOrbitCopies);
    if (Number.isFinite(remembered) && remembered >= 1) return Math.max(1, Math.round(remembered));
    const n = Math.max(2, Math.round(Number(visual?.N ?? fallbackLayer?.N) || 4));
    const k = Math.max(
      1,
      Math.min(Math.floor(n / 2), Math.round(Number(visual?.K ?? fallbackLayer?.K) || 1)),
    );
    const total = Math.max(1, gcd(n, k));
    const custom = visual?.customSuborbits === undefined ? fallbackLayer?.customSuborbits : visual.customSuborbits;
    if (custom === null || custom === undefined) return total;
    return Math.max(1, Math.min(total, Math.round(Number(custom) || 1)));
  };
  const orbitCopiesForTarget = (target, sourceCount) =>
    state.morph.monoOrbitTransforms
      ? getActiveOrbitCount(target.N, target.K, target.customSuborbits)
      : Math.max(1, sourceCount);
  const rotateMorphGeometryPathCopy = (path, angle) => {
    const c = Math.cos(angle),
      ss = Math.sin(angle);
    const rot = (pts) =>
      (pts || []).map((p) => ({
        ...p,
        x: (Number(p?.x) || 0) * c - (Number(p?.y) || 0) * ss,
        y: (Number(p?.x) || 0) * ss + (Number(p?.y) || 0) * c,
      }));
    return {
      ...path,
      points: rot(path?.points),
      rawPoints: Array.isArray(path?.rawPoints) ? rot(path.rawPoints) : path?.rawPoints,
      cornerFlags: Array.isArray(path?.cornerFlags) ? path.cornerFlags.slice() : [],
      cornerParams: Array.isArray(path?.cornerParams) ? path.cornerParams.slice() : [],
      bridgeRoundFlags: Array.isArray(path?.bridgeRoundFlags) ? path.bridgeRoundFlags.slice() : [],
      bridgeParams: Array.isArray(path?.bridgeParams) ? path.bridgeParams.slice() : [],
    };
  };
  const expandMorphGeometryToVisualOrbits = (paths, visual) => {
    if (!Array.isArray(paths) || !paths.length) return paths || [];
    if (
      state.morph.monoOrbitTransforms !== true ||
      visual?.chaosStar === true ||
      visual?.spiralEnabled === true
    )
      return paths;
    const copies = Math.max(1, Math.round(Number(visual?.morphOrbitCopies) || paths.length || 1));
    if (paths.length === copies) return paths;
    const base = paths[0];
    if (!base) return paths;
    const n = Math.max(2, Math.round(Number(visual?.N) || 4));
    const virtualTotal = Math.max(copies, Math.round(Number(visual?.morphOrbitVirtualTotal) || copies));
    const out = [];
    for (let i = 0; i < copies; i++) {
      const group = Math.round((i * virtualTotal) / copies) % virtualTotal;
      const angle = group * ((Math.PI * 2) / n);
      const p = rotateMorphGeometryPathCopy(base, angle);
      p._virtualOrbitIndex = i;
      p._virtualOrbitCopies = copies;
      p._virtualOrbitGroup = group;
      out.push(p);
    }
    return out;
  };

  const wrapSignedDegreesForSpiralCompensation = (value, period = 360) => {
    const p = Math.max(1e-6, Math.abs(Number(period) || 360));
    let d = Number(value) || 0;
    d = ((((d + p * 0.5) % p) + p) % p) - p * 0.5;
    return d;
  };
  const spiralHalfStepPhaseDegrees = (visual) => {
    const n = Math.max(2, Math.round(Number(visual?.N) || 4));
    const step = normalizeSpiralStep(visual?.spiralStep ?? visual?.K ?? 1, visual || {});
    const order = normalizeSpiralOrder(visual?.spiralOrder, false);
    const dir = order < 0 ? -1 : order > 0 ? 1 : 0;

    return 180 * (step / n) * dir;
  };
  const estimateCirclePlanRotationDeltaDegrees = (sourceLayer, targetLayer, slideTypeOverride = null) => {
    if (typeof getCircleMorphPlan !== 'function') return NaN;
    try {
      const slideType = slideTypeOverride || getEffectiveCircleSlideType();
      const plan = getCircleMorphPlan(sourceLayer, targetLayer, slideType);

      let sx = 0,
        sy = 0,
        count = 0;
      for (const pp of plan?.pathPlans || []) {
        for (const raw of pp?.delta || []) {
          const d = Number(raw);
          if (!Number.isFinite(d)) continue;
          sx += Math.cos(d);
          sy += Math.sin(d);
          count++;
        }
      }
      if (!count) return NaN;
      const strength = Math.hypot(sx, sy) / count;

      if (strength < 0.08) return NaN;
      return (Math.atan2(sy, sx) * 180) / Math.PI;
    } catch (_) {
      return NaN;
    }
  };

  const estimateSpiralOuterTipRotationDeltaDegrees = (sourceLayer, targetLayer) => {
    if (typeof buildOrbitPolylines !== 'function' || typeof MorphGeometry === 'undefined') return NaN;
    try {
      const src = buildOrbitPolylines(sourceLayer) || [],
        dst = buildOrbitPolylines(targetLayer) || [];
      const pairs = MorphGeometry.pairMorphPaths?.(src, dst) || [];
      let best = null;
      for (const pair of pairs) {
        const sp = pair?.src?.points || [],
          dp = pair?.dst?.points || [];
        if (!sp.length || !dp.length) continue;
        const a = sp[sp.length - 1],
          b = dp[dp.length - 1];
        const radius = Math.max(
          Math.hypot(Number(a.x) || 0, Number(a.y) || 0),
          Math.hypot(Number(b.x) || 0, Number(b.y) || 0),
        );
        const sa = Math.atan2(Number(a.y) || 0, Number(a.x) || 0),
          da = Math.atan2(Number(b.y) || 0, Number(b.x) || 0);
        const delta = wrapSignedDegreesForSpiralCompensation(((da - sa) * 180) / Math.PI, 360);
        if (Number.isFinite(delta) && (!best || radius > best.radius)) best = { radius, delta };
      }
      return best?.delta ?? NaN;
    } catch (_) {
      return NaN;
    }
  };
  const spiralLayerRotationCompensationDeltaDegrees = (
    sourceLayer,
    targetLayer,
    type = getSpiralMorphType(),
  ) => {
    const sr = Number(sourceLayer?.rotation) || 0,
      dr = Number(targetLayer?.rotation) || 0;
    const authoredDelta = dr - sr;
    if (type === 'torn') {
      return wrapSignedDegreesForSpiralCompensation(authoredDelta, 360);
    }
    if (type === 'continuous') {
      return authoredDelta;
    }
    if (type === 'phaseCircle') {
      const tip = estimateSpiralOuterTipRotationDeltaDegrees(sourceLayer, targetLayer);
      if (Number.isFinite(tip)) return tip;
      const planned = estimateCirclePlanRotationDeltaDegrees(
        sourceLayer,
        targetLayer,
        state.morph?.slideType || 'minimal',
      );
      return Number.isFinite(planned) ? planned : wrapSignedDegreesForSpiralCompensation(authoredDelta, 360);
    }
    if (type === 'minimalTurn') {
      const tip = estimateSpiralOuterTipRotationDeltaDegrees(sourceLayer, targetLayer);
      if (Number.isFinite(tip)) return tip;
      const planned = estimateCirclePlanRotationDeltaDegrees(sourceLayer, targetLayer, 'minimal');
      return Number.isFinite(planned) ? planned : wrapSignedDegreesForSpiralCompensation(authoredDelta, 360);
    }
    if (type === 'phase') {
      // Phase morph keeps N fixed and changes K itself as the effective spiral step.
      // Pin the actually visible outer tip first; this makes the optional rotation
      // compensation keep the outermost spiral visually stationary in every morph mode.
      const tip = estimateSpiralOuterTipRotationDeltaDegrees(sourceLayer, targetLayer);
      if (Number.isFinite(tip)) return tip;
      const planned = estimateCirclePlanRotationDeltaDegrees(sourceLayer, targetLayer, 'phase');
      if (Number.isFinite(planned)) return planned;
      const a = spiralHalfStepPhaseDegrees(sourceLayer),
        b = spiralHalfStepPhaseDegrees(targetLayer);
      return authoredDelta + wrapSignedDegreesForSpiralCompensation(b - a, 360);
    }
    return authoredDelta;
  };
  const prepareSpiralMorphRotationCompensationPhase = () => {
    const rt = runtimeState.morph;
    const src = Array.isArray(rt.renderSourceLayers) ? rt.renderSourceLayers : [];
    const dst = Array.isArray(rt.renderTargetLayers) ? rt.renderTargetLayers : [];
    const type = getSpiralMorphType();
    let anchor = null,
      participants = 0;
    const count = Math.max(src.length, dst.length, state.layers?.length || 0);
    for (let i = 0; i < count; i++) {
      const a = src[i] || state.layers?.[i],
        b = dst[i] || a,
        live = state.layers?.[i] || a;
      if (!(a?.spiralEnabled === true || b?.spiralEnabled === true || isSpiralLayer(live))) continue;
      if (live?.visible === false) continue;
      const layerRadius = (q) =>
        Math.max(
          0,
          (Number(q?.radius) || 0) *
            Math.max(0, Number.isFinite(Number(q?.radiusMultiplier)) ? Number(q.radiusMultiplier) : 1),
        );
      const radius = Math.max(1, layerRadius(a), layerRadius(b), layerRadius(live));
      const delta = spiralLayerRotationCompensationDeltaDegrees(a, b, type);
      if (!Number.isFinite(delta)) continue;
      participants++;

      if (
        !anchor ||
        radius > anchor.radius + 1e-9 ||
        (Math.abs(radius - anchor.radius) <= 1e-9 && i > anchor.index)
      )
        anchor = { index: i, radius, delta, id: String(live?.id || a?.id || b?.id || '') };
    }
    rt.spiralRotationCompensationPhaseDeg = anchor ? anchor.delta : 0;
    rt.spiralRotationCompensationPhaseType = type;
    rt.spiralRotationCompensationParticipants = participants;
    rt.spiralRotationCompensationAnchorIndex = anchor?.index ?? -1;
    rt.spiralRotationCompensationAnchorId = anchor?.id || '';
    rt.spiralRotationCompensationAnchorRadius = anchor?.radius || 0;
    return rt.spiralRotationCompensationPhaseDeg;
  };
  const commitSpiralMorphRotationCompensationProgress = (progress) => {
    const rt = runtimeState.morph;
    const p = Math.max(0, Math.min(1, Number(progress) || 0));
    const phase = Number.isFinite(Number(rt.spiralRotationCompensationPhaseDeg))
      ? Number(rt.spiralRotationCompensationPhaseDeg)
      : 0;
    const base = Number.isFinite(Number(rt.spiralRotationCompensationBaseDeg))
      ? Number(rt.spiralRotationCompensationBaseDeg)
      : 0;
    rt.spiralRotationCompensationBaseDeg = base + phase * p;
    rt.spiralRotationCompensationPhaseDeg = 0;
    rt.spiralRotationCompensationParticipants = 0;
    return rt.spiralRotationCompensationBaseDeg;
  };

  // Топология следующего цикла выбирается заранее (см. fill-lookahead.js).
  // План, выбранный в прошлом цикле. Годится только для цикла, который он готовил.
  const takeTopologyPlan = () => {
    const rt = runtimeState.morph;
    const stored = rt.nextTopologyPlan;
    rt.nextTopologyPlan = null;
    if (!stored || stored.serial !== rt.lampCycleSerial) return null;
    return acceptPlan(stored.plan, state.layers, state.morph);
  };
  // Спиральные режимы могут принудительно фиксировать N/K после выбора цели (и спираль может
  // появиться случайно) — тогда заранее выбранной топологии верить нельзя.
  const topologyPlanBlocked = () =>
    state.morph.options.bySpiralLayers === true ||
    state.morph.options.bySpiralOrder === true ||
    spiralMorphLocksN() ||
    spiralMorphLocksK() ||
    ['continuous', 'phase', 'minimalTurn'].includes(getSpiralMorphType());

  const profileResetFor = (layer) => runtimeState.morph.manualProfileResetIds?.has(layer?.id) === true;
  const prepareMorphCycle = (now) => {
    runtimeState.morph.returnToPhaseStart = null;
    // План следующего цикла берём до любых изменений слоёв и счётчика цикла.
    const topologyPlan = takeTopologyPlan();

    // Blue takes ownership of the whole frame; cancel any previous
    // manual corridor prelude as well as the last Blue cycle's.
    stopHonestZeroCorridorIntro();
    for (const id of runtimeState.morph.honestZeroCorridorOutro?.ids || []) stopHonestZeroCorridorOutro(id);
    runtimeState.morph.honestZeroCorridorIntro = null;
    runtimeState.morph.honestZeroCorridorOutro = null;
    if (runtimeState.morph.gpuPhasePreparing !== true) {
      const handoff = Number.isFinite(Number(runtimeState.morph.geometryT))
        ? Number(runtimeState.morph.geometryT)
        : Number(runtimeState.morph.progress) || 0;
      runtimeState.morph.gpuPhaseHandoffT = Math.max(0, Math.min(1, handoff));
    }
    // Preserve the *visible* Fill of the previous final frame before
    // palette changes or freshly sampled targets mutate the layer.
    const previousFillHandoff = Array.isArray(runtimeState.morph.fillPhaseEndpoints)
      ? runtimeState.morph.fillPhaseEndpoints.map((e) => e?.to || null)
      : null;
    SpiroMorphController?.beginBlueCycle?.('prepareMorphCycle');

    invalidateMorphFrameInterpolationPlans('prepareMorphCycle');
    if (runtimeState.morph.suppressPaletteCycleOnce === true)
      runtimeState.morph.suppressPaletteCycleOnce = false;
    else cyclePlaylistPaletteForContext('blue');
    runtimeState.morph.sourceGlobalHueOffset = normalizePlaylistHueOffset(state.playlistPaletteHueOffset);
    runtimeState.morph.frameGlobalHueOffset = runtimeState.morph.sourceGlobalHueOffset;
    const globalHueAmount = Math.max(0, Math.min(360, Number(state.morph.globalHueOffsetRange) || 0));

    runtimeState.morph.targetGlobalHueOffset =
      state.morph.morphGlobalHueOffset === true
        ? runtimeState.morph.sourceGlobalHueOffset + globalHueAmount
        : runtimeState.morph.sourceGlobalHueOffset;

    runtimeState.morph.lampCycleSerial =
      (Math.max(0, Number(runtimeState.morph.lampCycleSerial) || 0) + 1) >>> 0;

    lampMotionRuntime.calm.clear();
    lampMotionRuntime.snap.clear();
    lampMotionRuntime.profileAttach?.clear?.();

    captureBlueStablePoint(runtimeState.morph);
    const lightMode = state.morph.mode === 'light';

    runtimeState.morph.cycleStart = 0;
    runtimeState.morph.gpuSpecializedSpiralReady = false;
    runtimeState.morph.boundaryPaintPending = false;
    runtimeState.morph.transitionMs = Math.max(
      100,
      getTapMorphIntervalSec(state.morph.intervalSec, 'full') * 1000,
    );
    runtimeState.morph.progress = 0;
    runtimeState.morph.geometryT = 0;
    runtimeState.morph.lightScales = state.layers.map(() => 1);
    runtimeState.morph.lightRotations = state.layers.map(() => 0);
    runtimeState.morph.lightGeometryBucket = -1;
    runtimeState.morph.runtimeProfiles = [];
    runtimeState.morph.renderSourceLayers = [];
    runtimeState.morph.renderTargetLayers = [];
    runtimeState.morph.profileCarrierPlans = [];
    runtimeState.morph.lastFrameUpdate = 0;
    if (state.morph.mode === 'lightning') {
      if (state.morph.lightningWhite) runtimeState.morph.lightningCycleColor = '#ffffff';
      else if (state.morph.lightningRandom) runtimeState.morph.lightningCycleColor = randomBrightLayerColor();
      else runtimeState.morph.lightningCycleColor = state.morph.lightningColor || '#ffffff';
    }
    runtimeState.morph.lightLayers = lightMode
      ? state.layers.map((layer) => ({
          ...layer,
          profileNodes: (layer.profileNodes || []).map((p) => ({ x: Number(p.x) || 0, y: Number(p.y) || 0 })),
        }))
      : [];
    runtimeState.morph.lightDrawData = [];
    // The Fill min/max controls constrain the NEXT state, not the current
    // one.  Trimming existing filled layers to the target maximum made
    // a filled source vanish at the very first Blue Morph frame (e.g.
    // two filled layers -> target maximum 0). Preserve every authored
    // source fill and let applyFillMorphFrame fade it over geometryT.
    runtimeState.morph.sourceFillIndices = state.layers
      .map((layer, idx) => (layer.fill === true && layer.closedLoop !== false ? idx : -1))
      .filter((idx) => idx >= 0);

    const phaseProfileHandoff = Array.isArray(runtimeState.morph.phaseSourceProfileHandoff)
      ? runtimeState.morph.phaseSourceProfileHandoff
      : [];
    runtimeState.morph.phaseSourceProfileHandoff = null;
    runtimeState.morph.sourceProfiles = state.layers.map((layer, idx) => {
      const hand = phaseProfileHandoff[idx];
      const mode = hand?.mode || layer.profileMode || 'segments';
      const legacyHandoff = ['topology', 'calm', 'circleSlide'].includes(getMorphModeForLayer(idx));
      if (Array.isArray(hand?.nodes) && hand.nodes.length >= 2) {
        const exact = hand.nodes.map((p) => ({ x: Number(p.x) || 0, y: Number(p.y) || 0 }));
        return {
          mode,
          nodes: exact.map((p) => ({ ...p })),

          // The phase carrier may be a paired/resampled interpolation grid.
          // It must NEVER replace the user's authored contour. In particular,
          // rounding the paired knots as if they were true corners produced
          // a different first frame and a last-moment phase snap.
          rawNodes: legacyHandoff
            ? exact.map((p) => ({ ...p }))
            : (layer.profileNodes || exact).map((p) => ({ x: Number(p.x) || 0, y: Number(p.y) || 0 })),
          authoredNodes: (layer.profileNodes || exact).map((p) => ({
            x: Number(p.x) || 0,
            y: Number(p.y) || 0,
          })),
          // Preserve the original 10.4.19.27 sampled handoff contract
          // for Circle Slide, independent of the new topoCircle path.
          phaseHandoff: legacyHandoff ? true : hand.alreadySampled === true,
          alreadySampled: legacyHandoff ? mode === 'spline' : hand.alreadySampled === true,
          lampLogicalCornerFlags: Array.isArray(hand?.lampLogicalCornerFlags)
            ? hand.lampLogicalCornerFlags.map(Boolean)
            : [],
        };
      }
      return {
        mode,

        nodes: compactMorphProfileNodes(layer.profileNodes, mode, isPreSampledSplineLayer(layer)),
        rawNodes: (layer.profileNodes || []).map((p) => ({ x: Number(p.x) || 0, y: Number(p.y) || 0 })),
        phaseHandoff: false,
        alreadySampled: isPreSampledSplineLayer(layer),
        lampLogicalCornerFlags: [],
      };
    });
    const useNativeFillHarmony = (state.morph.fillHueHarmony || 'native') === 'native';
    runtimeState.morph.sourceVisuals = state.layers.map((layer, idx) => {
      const strokeColor = layer.strokeColor || '#6366f1';
      const authoredFillColor = layer.fillColor;
      const fillOpacity = getFillOpacityPercent(authoredFillColor);
      const resolvedFillColor =
        useNativeFillHarmony || !layer.fill || !authoredFillColor
          ? colorWithPercentAlpha(strokeColor, fillOpacity)
          : authoredFillColor;
      return {
        N: Number(layer.N) || 4,
        K: Number(layer.K) || 1,
        customSuborbits: layer.customSuborbits ?? null,
        chaosStar: layer.chaosStar === true,
        chaosStepMinus: Math.max(0, Math.round(Number(layer.chaosStepMinus) || 0)),
        chaosStepPlus: Math.max(0, Math.round(Number(layer.chaosStepPlus) || 0)),
        chaosClosures: Math.max(1, Math.round(Number(layer.chaosClosures) || 1)),
        chaosSeed: Number(layer.chaosSeed) >>> 0,
        radius: Number(layer.radius) || 220,
        rotation: Number(layer.rotation) || 0,
        spiralEnabled: isSpiralLayer(layer),
        spiralOrder: normalizeSpiralOrder(layer.spiralOrder, false),
        spiralStep: normalizeSpiralStep(layer.spiralStep ?? layer.K ?? 1, layer),
        spiralStepLinked: layer.spiralStepLinked !== false,
        spiralStepLimiterEnabled: layer.spiralStepLimiterEnabled !== false,
        spiralStepLimiter: Math.max(1, Math.min(120, Math.round(Number(layer.spiralStepLimiter ?? 2) || 2))),
        spiralClosed: layer.spiralClosed !== false,
        spiralTwist: layer.spiralTwist === true,
        spiralTangential: layer.spiralTangential === true,
        spiralRoundSeams: layer.spiralRoundSeams !== false,

        strokeColor,
        // Authored source Fill is authoritative at phase 0. The new
        // target may contain fewer filled layers, but they fade out
        // continuously instead of disappearing before animation.
        fill: Boolean(layer.fill) && layer.closedLoop !== false,
        fillHueOffset: useNativeFillHarmony
          ? 0
          : signedHueOffsetDegrees(strokeColor, authoredFillColor || strokeColor),
        fillOpacity,
        fillColor: resolvedFillColor,
        strokeWidth: Number(layer.strokeWidth) || 1.5,
        glow: Number(layer.glow) || 5,
        opacity: Number(layer.opacity) || 90,
        rounding: Number(layer.rounding) || 0,
        lineJoinType: layer.lineJoinType || 'rounded',
        closedLoop: layer.closedLoop !== false,
      };
    });

    // The source Fill of this phase is the exact target Fill of the
    // preceding one, even if a palette rotates at the phase boundary.
    // Do not copy the preceding geometric transport grid here.
    if (previousFillHandoff?.length === runtimeState.morph.sourceVisuals.length) {
      runtimeState.morph.sourceVisuals.forEach((v, i) => {
        const hand = previousFillHandoff[i];
        if (!hand) return;
        v.fill = hand.enabled === true;
        v.fillColor = hand.color;
        v.fillOpacity = hand.alpha * 100;
      });
    }
    runtimeState.morph.targetVisuals = buildMorphVisualTargets(state.layers, topologyPlan);
    const orderRt = runtimeState.morph,
      zero = SomataSpiralZeroTransition;
    orderRt.orderRailDurations = new Map();
    orderRt.orderRailMinimumMs = 0;
    if (isSpiralLayerMorphEnabled())
      state.layers.forEach((layer, i) => {
        const from = getEffectiveSpiralOrder(orderRt.sourceVisuals[i]),
          to = getEffectiveSpiralOrder(orderRt.targetVisuals[i]);
        if (!zero.needsOrderAnimation(from, to) || layer.testMorph?.syncWithMorph === true) return;
        const ms = zero.durationMs(layer, orderRt.transitionMs);
        orderRt.orderRailDurations.set(layer.id, ms);
        orderRt.orderRailMinimumMs = Math.max(orderRt.orderRailMinimumMs, ms);
      });
    orderRt.transitionMs = blueOrderPhaseDurationMs(orderRt.transitionMs);
    syncGeometryMorphDuration();
    // 13.0.4: Freeze *both* authored Fill endpoint states before any
    // per-frame layer mutation. The next phase starts from the committed
    // target state, not a recycled intermediate Fill flag / alpha.
    runtimeState.morph.fillPhaseEndpoints = runtimeState.morph.sourceVisuals.map((src, idx) => {
      const dst = runtimeState.morph.targetVisuals[idx] || src;
      const capture = (v) =>
        Object.freeze({
          enabled: v?.fill === true && v?.closedLoop !== false && v?.spiralEnabled !== true,
          color: String(v?.fillColor || v?.strokeColor || '#000000'),
          alpha:
            v?.fill === true && v?.closedLoop !== false && v?.spiralEnabled !== true
              ? getFillOpacityUnit(v.fillColor, v.fillOpacity ?? DEFAULT_FILL_OPACITY_PERCENT)
              : 0,
        });
      return Object.freeze({ from: capture(src), to: capture(dst) });
    });
    {
      const ids = state.layers.map((l, i) => l.id ?? i),
        src = runtimeState.morph.sourceVisuals,
        dst = runtimeState.morph.targetVisuals;
      const profile = window.SomataMorphParameterRouting?.activeProfile?.(state.morph, state.minimalMorph);
      const bindings =
        window.SomataMorphParameterRouting?.workingBindings?.(state.morph, state.minimalMorph, profile) || [];
      const fields = {
        'geometry.N': ['N'],
        'geometry.K': ['K'],
        'layer.radius': ['radius'],
        'layer.rotation': ['rotation'],
        'layer.rounding': ['rounding'],
        'layer.strokeWidth': ['strokeWidth'],
        'layer.opacity': ['opacity'],
        'layer.strokeColor': ['strokeColor'],
        'layer.fillColor': ['fill', 'fillHueOffset', 'fillColor'],
        'layer.fillOpacity': ['fillOpacity'],
      };
      for (const b of bindings) {
        if (b.enabled === false || !fields[b.parameter] || window.SomataParameterCoverage.full(b)) continue;
        const affected = window.SomataParameterCoverage.select(b, ids);
        for (let i = 0; i < dst.length; i++)
          if (!affected.has(ids[i])) for (const key of fields[b.parameter]) dst[i][key] = src[i][key];
      }
      const specials = {
        'geometry.orbits': ['customSuborbits'],
        'geometry.chaos': ['chaosStar', 'chaosStepMinus', 'chaosStepPlus', 'chaosClosures', 'chaosSeed'],
        'spiral.layers': [
          'spiralEnabled',
          'spiralStep',
          'spiralStepLinked',
          'spiralClosed',
          'spiralTangential',
          'spiralRoundSeams',
          ...(state.morph.options.bySpiralOrder === true ? [] : ['spiralOrder']),
        ],
        'spiral.order': ['spiralOrder', 'spiralEnabled'],
      };
      for (const [id, keys] of Object.entries(specials)) {
        const p = morphSpecialLayerCoverage(state.morph, id);
        if (p === 100) continue;
        const affected = window.SomataParameterCoverage.select({ layerPercent: p }, ids);
        for (let i = 0; i < dst.length; i++)
          if (!affected.has(ids[i])) for (const key of keys) dst[i][key] = src[i][key];
      }
      // Authoritative Morph-only N/K locks. Apply after coverage,
      // generator, and all random target routing; no downstream mode
      // is allowed to choose a new value for a fixed parameter.
      const mode = getSpiralMorphType();
      for (let i = 0; i < dst.length; i++) {
        if (!(
          src[i]?.spiralEnabled === true ||
          dst[i]?.spiralEnabled === true ||
          UNIFIED_SPIRAL_TRANSPORTS.has(getSpiralMorphMode())
        ))
          continue;
        if (mode === 'continuous' || mode === 'phase') dst[i].N = src[i].N;
        if (mode === 'continuous' || mode === 'minimalTurn') dst[i].K = src[i].K;
        if (mode === 'minimalTurn') {
          const minN = 2 * Math.max(1, Math.round(Number(dst[i].K) || 1));
          dst[i].N = Math.max(minN, Math.round(Number(dst[i].N) || minN));
        }
        // Effective K is the only step used for drawing, but keep
        // the authored K unchanged in the project and inspector.
        if ((mode === 'continuous' || mode === 'minimalTurn') && dst[i].K === src[i].K) {
          dst[i].spiralStep = src[i].spiralStep;
        }
      }
      const shapePct = morphSpecialLayerCoverage(state.morph, 'geometry.shape');
      if (shapePct < 100) {
        const affected = window.SomataParameterCoverage.select({ layerPercent: shapePct }, ids);
        for (let i = 0; i < dst.length; i++)
          if (!affected.has(ids[i]) && !profileResetFor(state.layers[i])) {
            const layer = state.layers[i],
              v = dst[i],
              origin = runtimeState.morph.sourceProfiles?.[i];
            v.mode = origin?.mode || layer.profileMode || 'segments';
            v.nodes = (origin?.nodes || layer.profileNodes || []).map((x) => ({ ...x }));
            v.rawNodes = (origin?.rawNodes || layer.profileNodes || []).map((x) => ({ ...x }));
            v.closedLoop = layer.closedLoop !== false;
          }
      }
    }

    if (getSpiralMorphType() === 'continuous' && state.morph.mode !== 'fade') {
      for (let i = 0; i < runtimeState.morph.targetVisuals.length; i++) {
        const sv = runtimeState.morph.sourceVisuals[i] || {},
          tv = runtimeState.morph.targetVisuals[i] || sv;
        const sourceOn = sv.spiralEnabled === true,
          targetOn = tv.spiralEnabled === true;
        const so = sourceOn ? normalizeSpiralOrder(sv.spiralOrder, false) : 0;
        const to = targetOn ? normalizeSpiralOrder(tv.spiralOrder, false) : 0;
        if (sourceOn !== targetOn || Math.abs(so - to) > 1e-7) {
          tv.N = sv.N;
          tv.K = sv.K;
          tv.spiralStep = normalizeSpiralStep(sv.spiralStep ?? sv.K ?? 1, sv);
          tv.spiralStepLinked = sv.spiralStepLinked !== false;
          tv.customSuborbits = sv.customSuborbits ?? null;
        }
      }
    }

    // 9.2.16: the retained Spiral Bézier carrier already takes the shortest
    // angular route between endpoints.  The ordinary resolved-layer path
    // used the raw (possibly multi-turn) authored rotation instead.  In
    // particular, +360°/-360° targets reached the right point in the GPU
    // carrier, then appeared to spin when another pass or cycle took over.
    // Choose an equivalent destination angle modulo 360 BEFORE creating
    // source/target GPU resources.  This is a counter-rotation of whole
    // turns, not a new geometry/pixel transform: it leaves the destination
    // exactly unchanged and is automatically inherited by the next cycle.
    // For an exact 180° tie choose the turn opposite the main spiral phase.
    runtimeState.morph.spiralPhaseCounterRotation = [];
    if (
      state.morph.mode !== 'fade' &&
      getSpiralMorphType() !== 'torn' &&
      state.morph.options.byRotation === true &&
      !isAudioRotationOverrideActive()
    ) {
      const src = runtimeState.morph.sourceVisuals || [],
        dst = runtimeState.morph.targetVisuals || [];
      for (let i = 0; i < dst.length; i++) {
        const a = src[i],
          b = dst[i];
        if (!a || !b || !(a.spiralEnabled === true || b.spiralEnabled === true)) continue;
        const from = Number(a.rotation),
          requested = Number(b.rotation);
        if (!Number.isFinite(from) || !Number.isFinite(requested)) continue;
        const raw = requested - from;
        let shortest = wrapSignedDegreesForSpiralCompensation(raw, 360);
        if (Math.abs(Math.abs(shortest) - 180) < 1e-8) {
          const phase = (v) => {
            const n = Math.max(2, Number(v?.N) || 2),
              k = Number(v?.K) || 1;
            const order = Number(v?.spiralOrder) || 0;
            return ((180 * k) / n) * Math.max(-1, Math.min(1, order));
          };
          const phaseTurn = phase(b) - phase(a);
          if (phaseTurn > 1e-8) shortest = -180;
          else if (phaseTurn < -1e-8) shortest = 180;
          else shortest = raw >= 0 ? -180 : 180;
        }
        const counter = shortest - raw;
        if (Math.abs(counter) > 1e-8) {
          b.rotation = from + shortest;
          runtimeState.morph.spiralPhaseCounterRotation.push({
            layerIndex: i,
            counterDegrees: counter,
            from,
            target: b.rotation,
          });
        }
      }
    }

    if (!Array.isArray(runtimeState.morph.orbitCopyMemory)) runtimeState.morph.orbitCopyMemory = [];
    state.layers.forEach((layer, idx) => {
      const sv = runtimeState.morph.sourceVisuals[idx] || {};
      const tv = runtimeState.morph.targetVisuals[idx] || sv;
      const remembered = Number(runtimeState.morph.orbitCopyMemory[idx]);
      const sourceCount =
        Number.isFinite(remembered) && remembered >= 1
          ? Math.max(1, Math.round(remembered))
          : getMorphVisualOrbitCount(sv, layer);
      // Число копий орбит, выбранное заранее, действует, только если цель осталась той же.
      const planned = topologyPlan?.items?.[idx];
      const plannedValid =
        planned &&
        planned.srcCopies === sourceCount &&
        planned.N === tv.N &&
        planned.K === tv.K &&
        JSON.stringify(planned.customSuborbits ?? null) === JSON.stringify(tv.customSuborbits ?? null);
      const targetCount = plannedValid ? planned.copies : orbitCopiesForTarget(tv, sourceCount);
      const sn = Math.max(2, Math.round(Number(sv.N) || 4));
      const sk = Math.max(1, Math.min(Math.floor(sn / 2), Math.round(Number(sv.K) || 1)));
      const tn = Math.max(2, Math.round(Number(tv.N) || sn));
      const tk = Math.max(1, Math.min(Math.floor(tn / 2), Math.round(Number(tv.K) || sk)));
      const virtualTotal = Math.max(1, gcd(sn, sk), gcd(tn, tk), sourceCount, targetCount);
      sv.morphOrbitCopies = sourceCount;
      tv.morphOrbitCopies = targetCount;
      sv.morphOrbitVirtualTotal = virtualTotal;
      tv.morphOrbitVirtualTotal = virtualTotal;
    });

    // Выбираем топологию СЛЕДУЮЩЕГО цикла сейчас и по ней решаем, гасить ли заливку в хвосте этого.
    {
      const rt = runtimeState.morph;
      const next = planNextCycle({
        layers: state.layers,
        targets: rt.targetVisuals,
        endpoints: rt.fillPhaseEndpoints,
        morph: state.morph,
        hooks: {
          blocked: topologyPlanBlocked,
          topology: (layer, i) => chooseMorphTopologyTarget(layer, i),
          copies: (_src, dst, count) => orbitCopiesForTarget(dst, count),
          orbits: (visual, layer) => getMorphVisualOrbitCount(visual, layer),
        },
      });
      rt.nextTopologyPlan = next ? { plan: next, serial: rt.lampCycleSerial } : null;
    }

    // Derive all four cycle color tables in one pass. Keep separate
    // arrays because palette rotation mutates them independently.
    const sourceColorHsl = [],
      targetColorHsl = [],
      sourceFillColorHsl = [],
      targetFillColorHsl = [];
    const sourceVisuals = runtimeState.morph.sourceVisuals;
    const targetVisuals = runtimeState.morph.targetVisuals;
    for (let i = 0; i < Math.max(sourceVisuals.length, targetVisuals.length); i++) {
      if (i < sourceVisuals.length) {
        const source = sourceVisuals[i];
        sourceColorHsl.push(toMorphHsl(source.strokeColor || '#000000'));
        sourceFillColorHsl.push(toMorphHsl(colorBaseHex6(source.fillColor, source.strokeColor || '#000000')));
      }
      if (i < targetVisuals.length) {
        const target = targetVisuals[i];
        targetColorHsl.push(toMorphHsl(target.strokeColor || '#000000'));
        targetFillColorHsl.push(toMorphHsl(colorBaseHex6(target.fillColor, target.strokeColor || '#000000')));
      }
    }
    runtimeState.morph.sourceColorHsl = sourceColorHsl;
    runtimeState.morph.targetColorHsl = targetColorHsl;
    runtimeState.morph.sourceFillColorHsl = sourceFillColorHsl;
    runtimeState.morph.targetFillColorHsl = targetFillColorHsl;
    const lampLogicalCornerFlagsForMorphGrid = (sampled, raw, mode) => {
      const pts = Array.isArray(sampled) ? sampled : [],
        authored = Array.isArray(raw) ? raw : [];
      if (mode !== 'spline' || pts.length < 2 || authored.length < 3) return pts.map(() => false);
      try {
        const bends = segmentProfileCornerFlags(authored);
        return nearestSpiralProfileLogicalCornerFlags(pts, authored, bends);
      } catch (_) {
        return pts.map(() => false);
      }
    };
    runtimeState.morph.targetProfiles = runtimeState.morph.targetVisuals.map((v, idx) => {
      const source = runtimeState.morph.sourceProfiles[idx] || {
        mode: 'segments',
        rawNodes: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
        ],
      };
      const targetRaw = (v.rawNodes || v.nodes || []).map((p) => ({
        x: Number(p.x) || 0,
        y: Number(p.y) || 0,
      }));
      const paired = pairCompactMorphProfiles(
        source.rawNodes || source.nodes,
        source.mode || 'segments',
        targetRaw,
        v.mode || 'segments',
        source.alreadySampled === true,
        false,
        source.phaseHandoff === true,
      );

      source.nodes = paired.source.map((p) => ({ ...p }));
      if (!(
        source.phaseHandoff === true &&
        Array.isArray(source.lampLogicalCornerFlags) &&
        source.lampLogicalCornerFlags.length === source.nodes.length
      ))
        source.lampLogicalCornerFlags = lampLogicalCornerFlagsForMorphGrid(
          source.nodes,
          source.rawNodes || source.nodes,
          source.mode || 'segments',
        );
      const targetNodes = paired.target.map((p) => ({ ...p }));
      return {
        mode: v.mode,
        rawNodes: targetRaw,
        nodes: targetNodes,
        lampLogicalCornerFlags: lampLogicalCornerFlagsForMorphGrid(
          targetNodes,
          targetRaw,
          v.mode || 'segments',
        ),
      };
    });

    // Тип морфинга зависит от пары слоя (спираль — тип спирали, иначе — многоугольника).
    const blueLayerMode = (idx) =>
      getMorphModeForLayer(idx, {
        sourceLayer: runtimeState.morph.sourceVisuals?.[idx],
        targetLayer: runtimeState.morph.targetVisuals?.[idx],
      });
    const referenceLegacyMorphFor = (idx) => ['topology', 'calm'].includes(blueLayerMode(idx));
    // The next phase must start on the exact *rendered* spiral carrier
    // that ended the previous phase. Recreating it from committed
    // authored knots loses sampled spline/profile correspondence and
    // can visibly teleport the spiral at the phase seam (even with
    // Morph rotation disabled). Consume this handoff only once.
    const spiralRenderHandoff = Array.isArray(runtimeState.morph.phaseSourceSpiralRenderHandoff)
      ? runtimeState.morph.phaseSourceSpiralRenderHandoff
      : [];
    runtimeState.morph.phaseSourceSpiralRenderHandoff = null;
    runtimeState.morph.renderSourceLayers = state.layers.map((layer, idx) => {
      const sourceProfile = runtimeState.morph.sourceProfiles[idx];
      // Segment knots are already the authoritative static contour.
      // The matched Morph grid is only a correspondence helper, not
      // a valid replacement for the final rounded segment profile.
      // The retained Spiral GPU rail can equalize its endpoint cubic
      // strokes exactly; feed it the real authored endpoints.
      // v19 legacy morph: BOTH segment and spline carriers consume
      // the paired node grid. Raw authoring nodes here change the
      // count and index correspondence while the GPU still expects
      // paired samples (10.4.19.35 regression).
      const strictSpiralSource = runtimeState.morph.sourceVisuals?.[idx]?.spiralEnabled === true;
      const sourceNodes =
        (strictSpiralSource
          ? sourceProfile?.authoredNodes || layer.profileNodes
          : referenceLegacyMorphFor(idx)
            ? sourceProfile?.nodes
            : sourceProfile?.mode === 'segments'
              ? sourceProfile.rawNodes
              : sourceProfile?.nodes) ||
        layer.profileNodes ||
        [];
      const snap = {
        ...layer,
        ...(runtimeState.morph.sourceVisuals[idx] || {}),
        profileMode: runtimeState.morph.sourceProfiles[idx]?.mode || layer.profileMode || 'segments',

        profileNodes: sourceNodes.map((p) => ({ x: Number(p?.x) || 0, y: Number(p?.y) || 0 })),
        // The equalized Morph grid is NOT the authored visible spline.
        // Preserve the actual endpoint knots for the exact Polygon
        // contour interpolator, without changing GPU/Spiral inputs.
        // Endpoint rendering always uses authored knots. Keep the paired
        // sourceNodes above for the legacy Topology/Calm/Circle transport.
        __morphExactProfileNodes: (sourceProfile?.authoredNodes || layer.profileNodes || sourceNodes).map(
          (p) => ({ x: Number(p?.x) || 0, y: Number(p?.y) || 0 }),
        ),
        __morphExactProfileSampled: false,
        __lampLogicalCornerFlags: (runtimeState.morph.sourceProfiles[idx]?.lampLogicalCornerFlags || []).map(
          Boolean,
        ),
      };
      setPreSampledSplineLayer(snap, !strictSpiralSource && snap.profileMode === 'spline');
      const previous = spiralRenderHandoff[idx];
      // commitFullMorphTargetAtBoundary() and prepareMorphCycle()
      // run synchronously in the *same* boundary callback. There
      // cannot be an intervening user edit. Comparing newly
      // re-paired source knots against the previous terminal
      // snapshot rejects precisely the Shape/N/K cases which
      // need the handoff most. Identity is the safe boundary
      // guard here; the snapshot is consumed once only.
      if (
        previous?.spiralEnabled === true &&
        snap.spiralEnabled === true &&
        previous.id === snap.id &&
        getEffectiveSpiralOrder(previous) === getEffectiveSpiralOrder(snap) &&
        (previous.spiralClosed !== false) === (snap.spiralClosed !== false)
      ) {
        return { ...snap, ...previous };
      }
      return snap;
    });
    runtimeState.morph.renderTargetLayers = state.layers.map((layer, idx) => {
      const targetProfile = runtimeState.morph.targetProfiles[idx];
      // Spiral's endpoint must be *the static authored target*, not
      // the phase-correspondence spline sample grid. That grid is
      // useful for movement only; it can produce different tip
      // curvature from the actual static Spline+ figure.
      const strictSpiralTarget = runtimeState.morph.targetVisuals?.[idx]?.spiralEnabled === true;
      const targetNodes =
        (strictSpiralTarget
          ? targetProfile?.rawNodes || layer.profileNodes
          : referenceLegacyMorphFor(idx)
            ? targetProfile?.nodes
            : targetProfile?.mode === 'segments'
              ? targetProfile.rawNodes
              : targetProfile?.nodes) ||
        layer.profileNodes ||
        [];
      const snap = {
        ...layer,
        ...(runtimeState.morph.targetVisuals[idx] || {}),
        profileMode: runtimeState.morph.targetProfiles[idx]?.mode || layer.profileMode || 'segments',
        profileNodes: targetNodes.map((p) => ({ x: Number(p?.x) || 0, y: Number(p?.y) || 0 })),
        __morphExactProfileNodes: (targetProfile?.rawNodes || targetNodes).map((p) => ({
          x: Number(p?.x) || 0,
          y: Number(p?.y) || 0,
        })),
        __morphExactProfileSampled: false,
        __lampLogicalCornerFlags: (runtimeState.morph.targetProfiles[idx]?.lampLogicalCornerFlags || []).map(
          Boolean,
        ),
      };
      setPreSampledSplineLayer(snap, !strictSpiralTarget && snap.profileMode === 'spline');
      return snap;
    });

    // Заливка «вперёд»: если по плану следующая фаза раздвоит орбиты, их дубли входят в заливку
    // уже в хвосте этой фазы (__fillSplitAhead[j] — сколько дублей получит орбита j цели), а
    // следующая фаза, где это совпало с фактом, их не вводит заново (__fillSplitDone).
    {
      const rt = runtimeState.morph;
      const hide = (obj, key, value) => {
        if (obj)
          Object.defineProperty(obj, key, { value, writable: true, configurable: true, enumerable: false });
      };
      const prevAhead = Array.isArray(rt.fillSplitAheadCounts) ? rt.fillSplitAheadCounts : [];
      const nextCounts = [];
      state.layers.forEach((layer, idx) => {
        const sv = rt.sourceVisuals?.[idx],
          tv = rt.targetVisuals?.[idx];
        const srcOrbits = sv ? activeOrbitCount(sv.N, sv.K, sv.customSuborbits) : 0,
          dstOrbits = tv ? activeOrbitCount(tv.N, tv.K, tv.customSuborbits) : 0;
        const actualSplit = Math.max(0, dstOrbits - srcOrbits);
        hide(
          rt.renderSourceLayers?.[idx],
          '__fillSplitDone',
          actualSplit > 0 &&
            prevAhead[idx] === actualSplit &&
            ['circleSlide', 'topology'].includes(getMorphModeForLayer(idx)),
        );
        let splitCounts = null;
        if (actualSplit > 0 && srcOrbits > 0) {
          splitCounts = new Array(srcOrbits).fill(0);
          for (let s = srcOrbits; s < dstOrbits; s++) splitCounts[s % srcOrbits]++;
        }
        hide(rt.renderSourceLayers?.[idx], '__fillSplitCounts', splitCounts);
        const item = rt.nextTopologyPlan?.plan?.items?.[idx];
        let ahead = null;
        // Пометки «лишних» путей ставит только общий помощник polygon (circleSlide, topology).
        const ghostCarriers = ['circleSlide', 'topology'].includes(getMorphModeForLayer(idx));
        if (ghostCarriers && item && tv && tv.spiralEnabled !== true && tv.chaosStar !== true) {
          const nextOrbits = activeOrbitCount(item.N, item.K, item.customSuborbits);
          if (nextOrbits > dstOrbits && dstOrbits > 0) {
            ahead = new Array(dstOrbits).fill(0);
            for (let s = dstOrbits; s < nextOrbits; s++) ahead[s % dstOrbits]++;
            nextCounts[idx] = nextOrbits - dstOrbits;
          }
        }
        hide(rt.renderTargetLayers?.[idx], '__fillSplitAhead', ahead);
      });
      rt.fillSplitAheadCounts = nextCounts;
    }

    buildBlueProfileCarrierPlans();
    prepareSpiralMorphRotationCompensationPhase();

    const chaosGeometryMode = state.layers.some(
      (layer, idx) => layer.chaosStar === true || runtimeState.morph.targetVisuals?.[idx]?.chaosStar === true,
    );
    const phaseLayers = [...state.layers, ...runtimeState.morph.renderSourceLayers, ...runtimeState.morph.renderTargetLayers].filter(Boolean);
    const warmWeb = phaseLayers.some(layer => layer.showWeb === true || layer.web?.enabled === true);
    const warmGraffiti = phaseLayers.some(layer => layer.lineProfileApplication === 'graffiti');
    const warmSweep = phaseLayers.some(layer => layer.sweep?.enabled || layer.lineSweep?.enabled);
    const warmParticles = phaseLayers.some(layer => layer.particles?.enabled);
    const warmArc = warmWeb || warmGraffiti || warmSweep || warmParticles || phaseLayers.some(layer => layer.showLamps || layer.lamps?.enabled || layer.spiralEnabled || layer.sprite?.enabled || layer.lineMotionFx?.enabled);
    const spiralBezierEndpointMode = runtimeState.morph.renderSourceLayers.some(
      (layer, idx) =>
        layer?.spiralEnabled === true || runtimeState.morph.renderTargetLayers?.[idx]?.spiralEnabled === true,
    );
    const spiralBezierExtraGeometry =
      spiralBezierEndpointMode &&
      Boolean(
        state.morph.options.byRounding ||
        state.morph.options.bySize ||
        state.morph.options.byRotation ||
        state.morph.options.bySpiralOrder ||
        state.morph.options.bySpiralLayers,
      );
    const spiralBezierGeometryRequested =
      spiralBezierEndpointMode &&
      Boolean(
        state.morph.options.byVertices ||
        state.morph.options.bySteps ||
        state.morph.options.byShape ||
        state.layers.some(profileResetFor) ||
        state.morph.monoOrbitTransforms ||
        spiralBezierExtraGeometry,
      );

    // «Прямые» типы строят путь на каждом кадре и не хранят геометрию цикла. Раньше тип был
    // общим; теперь он выбирается по паре слоя, поэтому прямой путь для всего цикла
    // включается, только если ему подчиняются ВСЕ слои (при одинаковых типах — как раньше).
    const layerUsesCircleDirectPath = (idx) =>
      ['circleSlide', 'topoCircle', 'topoCircleOpacity'].includes(blueLayerMode(idx));
    const circleDirectPathMode =
      state.layers.length > 0 && state.layers.every((_layer, idx) => layerUsesCircleDirectPath(idx));

    const circleAngularMode =
      circleDirectPathMode &&
      (state.morph.options.byVertices ||
        state.morph.options.bySteps ||
        state.morph.options.byShape ||
        state.layers.some(profileResetFor) ||
        state.morph.monoOrbitTransforms ||
        spiralBezierExtraGeometry);
    const mixedBackendSpiralBezierMode =
      !circleAngularMode &&
      !chaosGeometryMode &&
      spiralBezierGeometryRequested &&
      spiralMorphUsesRetainedBezierRail();

    const usesRetainedGpuSpiralLayer = (idx) =>
      Boolean(
        mixedBackendSpiralBezierMode &&
        (typeof somataGpuBackendAllowed !== 'function' || somataGpuBackendAllowed()) &&
        !somataFourierActive(runtimeState.morph.renderSourceLayers?.[idx] || state.layers[idx]) &&
        (runtimeState.morph.renderSourceLayers?.[idx]?.spiralEnabled === true ||
          runtimeState.morph.renderTargetLayers?.[idx]?.spiralEnabled === true),
      );
    if (lightMode || circleDirectPathMode) {
      runtimeState.morph.sourceGeometry = [];
      runtimeState.morph.targetGeometry = [];
      if (
        circleAngularMode &&
        typeof prepareGpuSpiralBezierMorphResources === 'function' &&
        (typeof somataGpuBackendAllowed !== 'function' || somataGpuBackendAllowed())
      ) {
        try {
          WebGPUSpiralBezierMorphRenderer?.warmup?.();
        } catch (error) {
          noteSuppressedError('morph-runtime/blue/playback#prepareMorphCycle', error);
        }
        const prepSerial = (Math.max(0, Number(runtimeState.morph.gpuPhasePrepareSerial) || 0) + 1) >>> 0;
        runtimeState.morph.gpuPhasePrepareSerial = prepSerial;
        runtimeState.morph.gpuPhasePreparing = false;
        runtimeState.morph.gpuPhaseWarming = true;
        runtimeState.morph.gpuPhaseWarmSerial = prepSerial;

        const task = Promise.resolve().then(async () => {
          const retainedPhaseLayers = [];
          for (let li = 0; li < state.layers.length; li++) {
            const src = runtimeState.morph.renderSourceLayers?.[li],
              dst = runtimeState.morph.renderTargetLayers?.[li];
            if (src?.spiralEnabled === true || dst?.spiralEnabled === true) retainedPhaseLayers.push(li);
          }
          const lampPhaseLayers = retainedPhaseLayers.filter((li) => {
            try {
              return getLayerLampsEnabled?.(state.layers[li]) === true;
            } catch (_) {
              return false;
            }
          });

          if (lampPhaseLayers.length) {
            if (
              typeof LampGPURenderer?.ensureWebGPUReady !== 'function' ||
              (await LampGPURenderer.ensureWebGPUReady()) !== true
            )
              throw new Error(
                `Phase-circle WebGPU Lamp renderer unavailable: ${String(window.__spiroLampGPUStatus?.()?.webgpu?.lastError || 'not-ready')}`,
              );
            if (
              typeof ensureGpuMorphArcPipelines !== 'function' ||
              (await ensureGpuMorphArcPipelines()) !== true
            )
              throw new Error(
                `Phase-circle Exact Arc pipelines unavailable: ${String(window.__spiroGpuMorphArcStatus?.()?.lastError || 'not-ready')}`,
              );
          }
          const built = await prepareGpuSpiralBezierMorphResources();
          if (retainedPhaseLayers.length && !built)
            throw new Error('Phase-circle retained Spiral phase build returned no resources');
          for (const li of retainedPhaseLayers) {
            const rec = WebGPUSpiralBezierMorphRenderer?.getResource?.(li);
            if (
              !rec?.ready ||
              rec?.specialSpiralBezierRail !== true ||
              Number(rec.phaseSerial) !== prepSerial
            )
              throw new Error(`Phase-circle retained Spiral rail unavailable/stale for layer ${li}`);
          }
          if (lampPhaseLayers.length) {
            for (const li of lampPhaseLayers) {
              const rail = WebGPUSpiralBezierMorphRenderer?.getResource?.(li),
                arc = getGpuMorphArcResource(li);
              if (!arc?.ready || arc.morphRec !== rail || Number(rail?.phaseSerial) !== prepSerial)
                throw new Error(`Phase-circle Lamp Arc resource unavailable/stale for layer ${li}`);
            }
          }

          try {
            WebGPUStrokeRenderer?.warmup?.();
          } catch (error) {
            noteSuppressedError('morph-runtime/blue/playback#prepareMorphCycle', error);
          }
          try {
            WebGPUFinalCompositeRenderer?.warmup?.();
          } catch (error) {
            noteSuppressedError('morph-runtime/blue/playback#prepareMorphCycle', error);
          }
          try {
            if (warmSweep) WebGPUBezierSweepRenderer?.warmup?.();
          } catch (error) {
            noteSuppressedError('morph-runtime/blue/playback#prepareMorphCycle', error);
          }
          try {
            if (warmSweep) WebGPUCanonicalSweepRenderer?.warmup?.();
          } catch (error) {
            noteSuppressedError('morph-runtime/blue/playback#prepareMorphCycle', error);
          }
          try {
            if (warmSweep) WebGPULightningArcRenderer?.warmup?.();
          } catch (error) {
            noteSuppressedError('morph-runtime/blue/playback#prepareMorphCycle', error);
          }
          try {
            if (warmWeb) WebGPUWebMorphRenderer?.warmup?.();
          } catch (error) {
            noteSuppressedError('morph-runtime/blue/playback#prepareMorphCycle', error);
          }
          try {
            if (warmWeb) WebGPUWebThreadSceneRenderer?.warmup?.();
          } catch (error) {
            noteSuppressedError('morph-runtime/blue/playback#prepareMorphCycle', error);
          }
          try {
            if (warmGraffiti) WebGPUGraffitiMorphRenderer?.warmup?.();
          } catch (error) {
            noteSuppressedError('morph-runtime/blue/playback#prepareMorphCycle', error);
          }
          try {
            WebGPUProfileArcMarkerRenderer?.warmup?.();
          } catch (error) {
            noteSuppressedError('morph-runtime/blue/playback#prepareMorphCycle', error);
          }
          try {
            if (warmParticles) WebGPUParticleRenderer?.warmup?.();
          } catch (error) {
            noteSuppressedError('morph-runtime/blue/playback#prepareMorphCycle', error);
          }
          try {
            WebGPUPathFxRenderer?.warmup?.();
          } catch (error) {
            noteSuppressedError('morph-runtime/blue/playback#prepareMorphCycle', error);
          }
          try {
            LampGPURenderer?.isWebGPUReady?.();
          } catch (error) {
            noteSuppressedError('morph-runtime/blue/playback#prepareMorphCycle', error);
          }

          const optionalReady = [];

          try {
            if (!lampPhaseLayers.length && typeof ensureGpuMorphArcPipelines === 'function')
              optionalReady.push(Promise.resolve(ensureGpuMorphArcPipelines()));
          } catch (error) {
            noteSuppressedError('morph-runtime/blue/playback#prepareMorphCycle', error);
          }
          try {
            if (warmWeb) optionalReady.push(Promise.resolve(ensureGpuWebCornerPipelines()));
          } catch (error) {
            noteSuppressedError('morph-runtime/blue/playback#prepareMorphCycle', error);
          }
          try {
            if (warmGraffiti) optionalReady.push(Promise.resolve(ensureGpuGraffitiSamplePipeline()));
          } catch (error) {
            noteSuppressedError('morph-runtime/blue/playback#prepareMorphCycle', error);
          }
          if (optionalReady.length) {
            Promise.allSettled(optionalReady)
              .then(() => {
                if (!runtimeState.morph.active || runtimeState.morph.gpuPhasePrepareSerial !== prepSerial)
                  return;
                try {
                  for (let li = 0; li < state.layers.length; li++) {
                    const rec = currentGpuBezierMorphResource(li);
                    if (!rec?.ready || rec?.specialSpiralBezierRail !== true) continue;
                    const arc = getGpuMorphArcResource(li);
                    if (!arc?.ready) continue;

                    try {
                      if (warmWeb) buildGpuWebCornerResource(arc);
                    } catch (error) {
                      noteSuppressedError('morph-runtime/blue/playback#prepareMorphCycle', error);
                    }
                    try {
                      if (warmGraffiti) buildGpuGraffitiSampleResource(arc);
                    } catch (error) {
                      noteSuppressedError('morph-runtime/blue/playback#prepareMorphCycle', error);
                    }
                  }
                } catch (error) {
                  noteSuppressedError('morph-runtime/blue/playback#prepareMorphCycle', error);
                }
                try {
                  requestMainCanvasRender?.();
                } catch (error) {
                  noteSuppressedError('morph-runtime/blue/playback#prepareMorphCycle', error);
                }
              })
              .catch(() => {});
          }
          return built;
        });
        runtimeState.morph.gpuPhasePreparePromise = task;
        task
          .then(() => {
            if (!runtimeState.morph.active || runtimeState.morph.gpuPhasePrepareSerial !== prepSerial) return;
            runtimeState.morph.gpuPhasePreparing = false;
            runtimeState.morph.gpuPhaseWarming = false;
            runtimeState.morph.gpuSpecializedSpiralReady = true;
            runtimeState.morph.gpuPhasePreparePromise = null;
            requestMainCanvasRender();
          })
          .catch((err) => {
            if (!runtimeState.morph.active || runtimeState.morph.gpuPhasePrepareSerial !== prepSerial) return;
            runtimeState.morph.gpuPhasePreparePromise = null;
            runtimeState.morph.gpuPhasePreparing = false;
            runtimeState.morph.gpuPhaseWarming = false;
            runtimeState.morph.gpuSpecializedSpiralReady = false;
            const detail = {
              error: String(err?.stack || err),
              phaseSerial: prepSerial,
              lamp: window.__spiroLampGPUStatus?.() || null,
              arc: window.__spiroGpuMorphArcStatus?.() || null,
              spiral: window.__somataSpiralBezierMorphStatus?.() || null,
            };
            try {
              somataGpuContractError?.('PHASE_CIRCLE_FULL_GPU_PREWARM_FAILED', null, detail);
            } catch (_) {
              console.error('[Somata 7.5 FullGPU] PHASE_CIRCLE_FULL_GPU_PREWARM_FAILED', detail);
            }
          });

        runtimeState.morph.cycleStart = performance.now();
      } else {
        runtimeState.morph.gpuPhasePreparing = false;
        runtimeState.morph.gpuPhaseWarming = false;
        runtimeState.morph.gpuPhasePreparePromise = null;
        runtimeState.morph.cycleStart = performance.now();
      }
      return;
    }

    const makeSnapshotLayer = (layer, visual, profile, counterpartVisual = null) => {
      const visualSpiral = visual?.spiralEnabled === true,
        counterpartSpiral = counterpartVisual?.spiralEnabled === true;
      const carefulSpiral = spiralMorphKeepsContinuity() && (visualSpiral || counterpartSpiral);

      const endpointSpiral = carefulSpiral ? true : visualSpiral;
      const counterpartOrder = normalizeSpiralOrder(
          counterpartVisual?.spiralOrder ?? layer.spiralOrder,
          false,
        ),
        guideSign = counterpartOrder < 0 ? -1 : 1;
      const endpointOrder = normalizeSpiralOrder(visual.spiralOrder ?? layer.spiralOrder, false); // exact zero: no artificial epsilon
      const snap = {
        ...layer,
        N: visual.N,
        K: visual.K,
        customSuborbits: visual.chaosStar === true ? null : (visual.customSuborbits ?? null),
        chaosStar: visual.chaosStar === true,
        chaosStepMinus: Math.max(0, Math.round(Number(visual.chaosStepMinus) || 0)),
        chaosStepPlus: Math.max(0, Math.round(Number(visual.chaosStepPlus) || 0)),
        chaosClosures: Math.max(1, Math.round(Number(visual.chaosClosures) || 1)),
        chaosSeed: Number(visual.chaosSeed) >>> 0,
        radius: visual.radius,
        rotation: visual.rotation,
        spiralEnabled: endpointSpiral,
        spiralOrder: endpointOrder,
        spiralStep: normalizeSpiralStep(visual.spiralStep ?? layer.spiralStep ?? layer.K ?? 1, visual),
        spiralStepLinked: visual.spiralStepLinked !== false && layer.spiralStepLinked !== false,
        spiralStepLimiterEnabled:
          visual.spiralStepLimiterEnabled !== false && layer.spiralStepLimiterEnabled !== false,
        spiralStepLimiter: Math.max(
          1,
          Math.min(120, Math.round(Number(visual.spiralStepLimiter ?? layer.spiralStepLimiter ?? 2) || 2)),
        ),
        spiralClosed: visual.spiralClosed !== false && layer.spiralClosed !== false,
        spiralTwist: (visual.spiralTwist ?? layer.spiralTwist) === true,
        spiralTangential: visual.spiralTangential === true || layer.spiralTangential === true,
        spiralRoundSeams: visual.spiralRoundSeams !== false && layer.spiralRoundSeams !== false,

        rounding: visual.rounding,
        lineJoinType: visual.lineJoinType || 'rounded',
        closedLoop: endpointSpiral ? false : visual.closedLoop !== false,
        profileMode: profile.mode || layer.profileMode || 'segments',
        profileNodes: profile.nodes.map((p) => ({ ...p })),
        _carefulSpiralEndpoint: carefulSpiral,
        _carefulSpiralVisibleEndpoint: visualSpiral,
      };
      setPreSampledSplineLayer(snap, snap.profileMode === 'spline');
      return snap;
    };

    const sourcePool =
      runtimeState.morph._sourceGeometryPool || (runtimeState.morph._sourceGeometryPool = []);
    const targetPool =
      runtimeState.morph._targetGeometryPool || (runtimeState.morph._targetGeometryPool = []);
    if (sourcePool.length > state.layers.length) sourcePool.length = state.layers.length;
    if (targetPool.length > state.layers.length) targetPool.length = state.layers.length;

    const sampleBudgets = prepareMorphLayerSampleBudgets();
    runtimeState.morph.sourceGeometry = state.layers.map((layer, idx) => {
      const reuse = sourcePool[idx] || (sourcePool[idx] = []);
      if (usesRetainedGpuSpiralLayer(idx) || layerUsesCircleDirectPath(idx)) {
        reuse.length = 0;
        return reuse;
      }
      const visual = runtimeState.morph.sourceVisuals[idx];
      const profile = runtimeState.morph.sourceProfiles[idx];
      return MorphGeometry.buildMorphGeometry(
        makeSnapshotLayer(layer, visual, profile, runtimeState.morph.targetVisuals[idx]),
        sampleBudgets[idx] || 720,
        reuse,
      );
    });
    runtimeState.morph.targetGeometry = state.layers.map((layer, idx) => {
      const reuse = targetPool[idx] || (targetPool[idx] = []);
      if (usesRetainedGpuSpiralLayer(idx) || layerUsesCircleDirectPath(idx)) {
        reuse.length = 0;
        return reuse;
      }
      const visual = runtimeState.morph.targetVisuals[idx];
      const profile = runtimeState.morph.targetProfiles[idx];
      return MorphGeometry.buildMorphGeometry(
        makeSnapshotLayer(layer, visual, profile, runtimeState.morph.sourceVisuals[idx]),
        sampleBudgets[idx] || 720,
        reuse,
      );
    });
    if (state.morph.monoOrbitTransforms === true) {
      runtimeState.morph.sourceGeometry = runtimeState.morph.sourceGeometry.map((paths, idx) =>
        expandMorphGeometryToVisualOrbits(paths, runtimeState.morph.sourceVisuals[idx]),
      );
      runtimeState.morph.targetGeometry = runtimeState.morph.targetGeometry.map((paths, idx) =>
        expandMorphGeometryToVisualOrbits(paths, runtimeState.morph.targetVisuals[idx]),
      );
    }

    prepareMorphFrameInterpolationPlans();

    try {
      WebGPUTopologyMorphBaseRenderer?.warmup?.();
    } catch (error) {
      noteSuppressedError('morph-runtime/blue/playback#prepareMorphCycle', error);
    }
    try {
      if (warmGraffiti) WebGPUGraffitiMorphRenderer?.warmup?.();
    } catch (error) {
      noteSuppressedError('morph-runtime/blue/playback#prepareMorphCycle', error);
    }
    try {
      if (warmSweep) WebGPULightningArcRenderer?.warmup?.();
    } catch (error) {
      noteSuppressedError('morph-runtime/blue/playback#prepareMorphCycle', error);
    }
    try {
      if (warmWeb) WebGPUWebMorphRenderer?.warmup?.();
    } catch (error) {
      noteSuppressedError('morph-runtime/blue/playback#prepareMorphCycle', error);
    }
    try {
      if (warmParticles) WebGPUParticleRenderer?.warmup?.();
    } catch (error) {
      noteSuppressedError('morph-runtime/blue/playback#prepareMorphCycle', error);
    }
    try {
      if (warmArc) warmupGpuMorphArcResource?.();
    } catch (error) {
      noteSuppressedError('morph-runtime/blue/playback#prepareMorphCycle', error);
    }
    try {
      if (warmWeb) warmupGpuWebCornerResource?.();
    } catch (error) {
      noteSuppressedError('morph-runtime/blue/playback#prepareMorphCycle', error);
    }

    const canWarmGpuPhase = typeof somataGpuBackendAllowed !== 'function' || somataGpuBackendAllowed();
    if (canWarmGpuPhase) {
      const prepSerial = (Math.max(0, Number(runtimeState.morph.gpuPhasePrepareSerial) || 0) + 1) >>> 0;
      runtimeState.morph.gpuPhasePrepareSerial = prepSerial;
      runtimeState.morph.gpuPhasePreparing = false;
      runtimeState.morph.gpuPhaseWarming = true;
      runtimeState.morph.gpuPhaseWarmSerial = prepSerial;
      const task = Promise.resolve().then(async () => {
        await prepareSharedGpuMorphPathResources();

        if (mixedBackendSpiralBezierMode && typeof prepareGpuSpiralBezierMorphResources === 'function')
          await prepareGpuSpiralBezierMorphResources();

        if (warmArc) {
          const arcOk = await ensureGpuMorphArcPipelines();
          if (arcOk !== true) throw new Error('Exact GPU Morph Arc pipelines unavailable');
          for (let li = 0; li < state.layers.length; li++) {
            const arc = getGpuMorphArcResource(li);
            const needsArc =
              usesRetainedGpuSpiralLayer(li) ||
              state.layers[li]?.lamps?.enabled === true ||
              state.layers[li]?.web?.enabled === true ||
              state.layers[li]?.lineSweep?.enabled === true ||
              state.layers[li]?.particles?.enabled === true;
            if (needsArc && !arc?.ready)
              throw new Error(`Exact GPU Morph Arc resource unavailable for layer ${li}`);
          }
        }

        const webNeeded = state.layers.some((layer) => {
          try {
            return getLayerWebEnabled(layer) === true;
          } catch (_) {
            return false;
          }
        });
        if (webNeeded) {
          Promise.resolve()
            .then(async () => {
              const rendererOk =
                typeof WebGPUWebMorphRenderer !== 'undefined' &&
                typeof WebGPUWebMorphRenderer.ensureReady === 'function'
                  ? await WebGPUWebMorphRenderer.ensureReady()
                  : Boolean(WebGPUWebMorphRenderer?.isReady?.());
              if (rendererOk !== true)
                throw new Error(
                  `GPU Web renderer unavailable: ${String(WebGPUWebMorphRenderer?.status?.()?.lastError || 'not-ready')}`,
                );
              if (
                typeof ensureGpuWebCornerPipelines !== 'function' ||
                (await ensureGpuWebCornerPipelines()) !== true
              )
                throw new Error(
                  `GPU Web corner pipelines unavailable: ${String(window.__spiroGpuWebCornerStatus?.()?.lastError || 'not-ready')}`,
                );
              for (let li = 0; li < state.layers.length; li++) {
                if (!(getLayerWebEnabled(state.layers[li]) === true)) continue;
                if (!runtimeState.morph.active || runtimeState.morph.gpuPhasePrepareSerial !== prepSerial)
                  return false;
                const arc = getGpuMorphArcResource(li);
                const corners =
                  arc?.ready && typeof buildGpuWebCornerResource === 'function'
                    ? buildGpuWebCornerResource(arc)
                    : null;
                if (!corners?.ready) throw new Error(`GPU Web corner resource unavailable for layer ${li}`);
              }
              if (runtimeState.morph.active && runtimeState.morph.gpuPhasePrepareSerial === prepSerial)
                requestMainCanvasRender();
              return true;
            })
            .catch((err) => {
              const detail = {
                error: String(err?.stack || err),
                phaseSerial: prepSerial,
                web: WebGPUWebMorphRenderer?.status?.() || null,
                corner: window.__spiroGpuWebCornerStatus?.() || null,
              };
              try {
                somataGpuContractError?.('MORPH_WEB_FULL_GPU_PREWARM_FAILED', null, detail);
              } catch (_) {
                console.error('[Somata 7.5 FullGPU] MORPH_WEB_FULL_GPU_PREWARM_FAILED', detail);
              }
            });
        }
        return true;
      });
      runtimeState.morph.gpuPhasePreparePromise = task;
      task
        .then(() => {
          if (!runtimeState.morph.active || runtimeState.morph.gpuPhasePrepareSerial !== prepSerial) return;
          runtimeState.morph.gpuPhasePreparing = false;
          runtimeState.morph.gpuPhaseWarming = false;
          runtimeState.morph.gpuPhasePreparePromise = null;
          requestMainCanvasRender();
        })
        .catch((err) => {
          if (!runtimeState.morph.active || runtimeState.morph.gpuPhasePrepareSerial !== prepSerial) return;
          runtimeState.morph.gpuPhasePreparePromise = null;
          const detail = {
            error: String(err?.stack || err),
            phaseSerial: prepSerial,
            recovered: false,
            cpuGeometryLayers: [],
          };
          try {
            // A failed optional GPU Morph prewarm must not deadlock the Blue Morph clock.
            // Retained Spiral layers skipped CPU geometry above, so materialize only those
            // layers before releasing the gate; the normal GPU stroke path can then consume
            // the finite frame geometry while the failed specialised resource stays diagnosed.
            for (let li = 0; li < state.layers.length; li++) {
              if (!usesRetainedGpuSpiralLayer(li)) continue;
              const layer = state.layers[li];
              const srcReuse = sourcePool[li] || (sourcePool[li] = []);
              const dstReuse = targetPool[li] || (targetPool[li] = []);
              srcReuse.length = 0;
              dstReuse.length = 0;
              const srcVisual = runtimeState.morph.sourceVisuals[li],
                dstVisual = runtimeState.morph.targetVisuals[li];
              const srcProfile = runtimeState.morph.sourceProfiles[li],
                dstProfile = runtimeState.morph.targetProfiles[li];
              let srcPaths = MorphGeometry.buildMorphGeometry(
                makeSnapshotLayer(layer, srcVisual, srcProfile, dstVisual),
                sampleBudgets[li] || 720,
                srcReuse,
              );
              let dstPaths = MorphGeometry.buildMorphGeometry(
                makeSnapshotLayer(layer, dstVisual, dstProfile, srcVisual),
                sampleBudgets[li] || 720,
                dstReuse,
              );
              if (state.morph.monoOrbitTransforms === true) {
                srcPaths = expandMorphGeometryToVisualOrbits(srcPaths, srcVisual);
                dstPaths = expandMorphGeometryToVisualOrbits(dstPaths, dstVisual);
              }
              runtimeState.morph.sourceGeometry[li] = srcPaths;
              runtimeState.morph.targetGeometry[li] = dstPaths;
              detail.cpuGeometryLayers.push(li);
            }
            invalidateMorphFrameInterpolationPlans('gpu-prewarm-recovery');
            prepareMorphFrameInterpolationPlans();
            detail.recovered = true;
          } catch (recoveryErr) {
            detail.recoveryError = String(recoveryErr?.stack || recoveryErr);
          }
          runtimeState.morph.gpuPhasePreparing = false;
          runtimeState.morph.gpuPhaseWarming = false;
          runtimeState.morph.lastGpuPrewarmRecovery = { at: Date.now(), ...detail };
          try {
            window.__somataLastMorphGpuPrewarmRecovery = { ...runtimeState.morph.lastGpuPrewarmRecovery };
          } catch (error) {
            noteSuppressedError('morph-runtime/blue/playback#prepareMorphCycle', error);
          }
          try {
            somataGpuContractError?.('MORPH_FULL_GPU_PREWARM_FAILED', null, detail);
          } catch (_) {
            console.error('[Somata 7.5 FullGPU] MORPH_FULL_GPU_PREWARM_FAILED', detail);
          }
          requestMainCanvasRender();
          try {
            activeEnsureFullMorphSchedulerOwnership?.('gpu-prewarm-recovery');
          } catch (error) {
            noteSuppressedError('morph-runtime/blue/playback#prepareMorphCycle', error);
          }
        });
      runtimeState.morph.cycleStart = performance.now();
    } else {
      runtimeState.morph.gpuPhasePreparing = false;
      runtimeState.morph.gpuPhaseWarming = false;
      runtimeState.morph.gpuPhasePreparePromise = null;
      runtimeState.morph.cycleStart = performance.now();
    }
  };

  // A topology Morph reuses the same orbital path when one source orbit
  // branches into several targets (and conversely when paths merge).
  // The overlapping paths are drawn separately with source-over Fill.
  // Correct the per-path alpha, NOT the persistent layer Fill setting:
  //   1 - (1 - a_per_path)^duplicateCount = authored alpha.
  // This also works for 3 -> 1 and avoids the brightness spike at a
  // cycle boundary. Target Fill opacity / OFF is still reached at t=1.
  const morphOrbitFillEndpoints = (src, dst) => {
    if (
      state.morph.monoOrbitTransforms !== true ||
      !['topology', 'calm'].includes(getPolygonMorphMode()) ||
      src.spiralEnabled === true ||
      dst.spiralEnabled === true ||
      src.chaosStar === true ||
      dst.chaosStar === true ||
      src.closedLoop === false ||
      dst.closedLoop === false
    )
      return null;
    const from = getMorphVisualOrbitCount(src),
      to = getMorphVisualOrbitCount(dst);
    if (from === to) return null;
    const n = Math.max(1, from, to);
    const compositeToPath = (a, count) =>
      1 - Math.pow(1 - Math.max(0, Math.min(1, a)), Math.max(1, count) / n);
    const a = src.fill
      ? getFillOpacityUnit(src.fillColor, src.fillOpacity ?? DEFAULT_FILL_OPACITY_PERCENT)
      : 0;
    const b = dst.fill
      ? getFillOpacityUnit(dst.fillColor, dst.fillOpacity ?? DEFAULT_FILL_OPACITY_PERCENT)
      : 0;
    return { start: compositeToPath(a, from), end: compositeToPath(b, to) };
  };
  const applyFillMorphFrame = (renderLayer, idx, t, strokeColor) => {
    if (!renderLayer) return;
    const src = runtimeState.morph.sourceVisuals[idx] || {};
    const dst = runtimeState.morph.targetVisuals[idx] || src;
    // This is frame-only metadata for the GPU union/stencil carrier.
    // Never persist it in authored layer state or project files.
    if (Object.prototype.hasOwnProperty.call(renderLayer, '__morphOrbitFillCompositeColor'))
      delete renderLayer.__morphOrbitFillCompositeColor;
    const orbitFill = morphOrbitFillEndpoints(src, dst);
    const fillEndpoints = runtimeState.morph.fillPhaseEndpoints?.[idx];
    const endpointSource = fillEndpoints?.from;
    const endpointTarget = fillEndpoints?.to;
    if (
      !orbitFill &&
      !state.morph.options.byFillColor &&
      endpointSource?.enabled === endpointTarget?.enabled &&
      Math.abs((endpointSource?.alpha ?? 0) - (endpointTarget?.alpha ?? 0)) < 1e-9 &&
      endpointSource?.color === endpointTarget?.color &&
      state.morph.options.byColor !== true &&
      state.morph.morphGlobalHueOffset !== true
    ) {
      // The resolved frame is recycled across Blue phases. Its canonical
      // Fill flag may intentionally stay ON as an authored preference
      // when an open/Spiral phase cannot display Fill. Never inherit
      // that flag at the next phase's t=0: the visible endpoint is
      // sourceVisuals, even when the Fill route itself is disabled.
      const sourceAlpha = src.fill
        ? getFillOpacityUnit(src.fillColor, src.fillOpacity ?? DEFAULT_FILL_OPACITY_PERCENT)
        : 0;
      renderLayer.fill = sourceAlpha > 0.000001;
      const color =
        renderLayer.fill && (state.morph.options.byColor || state.morph.morphGlobalHueOffset === true)
          ? strokeColor || renderLayer.strokeColor || '#000000'
          : src.fillColor || renderLayer.fillColor || strokeColor || '#000000';
      renderLayer.fillColor = colorWithUnitAlpha(color, sourceAlpha);
      return;
    }
    // A geometry/Spiral topology transition can make Fill unavailable
    // even without its dedicated Morph route. Cross-fade that change
    // over the same phase; never switch the visible fill in one frame.
    const sourceOn = (endpointSource?.enabled ?? src.fill) ? 1 : 0;
    const targetOn = (endpointTarget?.enabled ?? dst.fill) ? 1 : 0;

    const fillT = profileModeTransitionProgress(t); // shared profile transition window; Line keeps its own clock
    const sourceAlpha = orbitFill
      ? orbitFill.start
      : sourceOn
        ? (endpointSource?.alpha ??
          getFillOpacityUnit(src.fillColor, src.fillOpacity ?? DEFAULT_FILL_OPACITY_PERCENT))
        : 0;
    const targetAlpha = orbitFill
      ? orbitFill.end
      : targetOn
        ? (endpointTarget?.alpha ??
          getFillOpacityUnit(dst.fillColor, dst.fillOpacity ?? DEFAULT_FILL_OPACITY_PERCENT))
        : 0;
    const fillAlpha = Math.max(0, Math.min(1, sourceAlpha + (targetAlpha - sourceAlpha) * fillT));
    renderLayer.fill = fillAlpha > 0.000001;
    if (!renderLayer.fill) {
      renderLayer.fillColor = colorWithUnitAlpha(strokeColor || renderLayer.strokeColor || '#000000', 0);
      return;
    }
    const fillHex =
      state.morph.morphGlobalHueOffset === true
        ? lerpPreparedHslWithHueAmount(
            runtimeState.morph.sourceFillColorHsl?.[idx],
            runtimeState.morph.targetFillColorHsl?.[idx],
            fillT,
            state.morph.globalHueOffsetRange,
          )
        : orbitFill && !state.morph.options.byFillColor && !state.morph.options.byColor
          ? colorBaseHex6(renderLayer.fillColor || src.fillColor, strokeColor || src.strokeColor || '#000000')
          : lerpPreparedHsl(
              runtimeState.morph.sourceFillColorHsl?.[idx],
              runtimeState.morph.targetFillColorHsl?.[idx],
              fillT,
            );
    renderLayer.fillColor = colorWithUnitAlpha(
      fillT <= 0 ? endpointSource?.color || fillHex : fillT >= 1 ? endpointTarget?.color || fillHex : fillHex,
      fillAlpha,
    );
    if (orbitFill) {
      // Canvas draws each closed orbit separately, so it uses the
      // source-over corrected per-path alpha above. The native GPU
      // Fill stencil covers the UNION once instead; give it the
      // original composed alpha and winding (not parity), otherwise
      // overlapping duplicates would cancel / suddenly darken.
      const authoredA = sourceOn
        ? getFillOpacityUnit(src.fillColor, src.fillOpacity ?? DEFAULT_FILL_OPACITY_PERCENT)
        : 0;
      const authoredB = targetOn
        ? getFillOpacityUnit(dst.fillColor, dst.fillOpacity ?? DEFAULT_FILL_OPACITY_PERCENT)
        : 0;
      const composedAlpha = Math.max(0, Math.min(1, authoredA + (authoredB - authoredA) * fillT));
      Object.defineProperty(renderLayer, '__morphOrbitFillCompositeColor', {
        value: colorWithUnitAlpha(fillHex, composedAlpha),
        writable: true,
        configurable: true,
        enumerable: false,
      });
    }
  };

  const commitLightMorphTransient = () => {
    if (state.morph.mode !== 'light') return;
    const snapshots = runtimeState.morph.lightLayers || [];
    const spiralMorphEnabled = isSpiralLayerMorphEnabled();
    const rotationAudioOverride = isAudioRotationOverrideActive();
    state.layers.forEach((layer, idx) => {
      const snap = snapshots[idx];
      if (!snap) return;
      const scale = Number(runtimeState.morph.lightScales?.[idx]);
      const rot = Number(runtimeState.morph.lightRotations?.[idx]);
      layer.N = Math.max(2, Math.min(120, Math.round(Number(snap.N) || Number(layer.N) || 4)));
      layer.K = Math.max(
        1,
        Math.min(Math.floor(layer.N / 2), Math.round(Number(snap.K) || Number(layer.K) || 1)),
      );
      if (snap.chaosStar === true) {
        layer.chaosStar = true;
        layer.customSuborbits = null;
        layer.chaosStepMinus = Math.max(0, Math.round(Number(snap.chaosStepMinus) || 0));
        layer.chaosStepPlus = Math.max(0, Math.round(Number(snap.chaosStepPlus) || 0));
        layer.chaosClosures = Math.max(1, Math.round(Number(snap.chaosClosures) || 1));
        layer.chaosSeed = Number(snap.chaosSeed) >>> 0;
      } else if (snap.customSuborbits !== undefined) layer.customSuborbits = snap.customSuborbits ?? null;
      layer.profileMode = snap.profileMode || layer.profileMode || 'segments';
      layer.profileNodes = (snap.profileNodes || layer.profileNodes || []).map((p) => ({
        x: Number(p.x) || 0,
        y: Number(p.y) || 0,
      }));
      const endOrder =
        window.SomataTestMorph?.independentOrderTarget?.(layer.id) ??
        (state.morph.options.bySpiralOrder === true
          ? runtimeState.morph.targetVisuals?.[idx]?.spiralOrder
          : null);
      layer.spiralOrder = normalizeSpiralOrder(endOrder ?? snap.spiralOrder ?? layer.spiralOrder, false);
      layer.spiralEnabled = Math.abs(layer.spiralOrder) > 1e-8;
      layer.spiralClosed = snap.spiralClosed !== false;
      layer.closedLoop =
        !layer.spiralEnabled &&
        (endOrder != null && snap.spiralEnabled === true ? layer.spiralClosed : snap.closedLoop !== false);
      layer.spiralTangential = snap.spiralTangential === true;
      layer.spiralRoundSeams = snap.spiralRoundSeams !== false && layer.spiralRoundSeams !== false;

      layer.rounding = Math.max(0, Math.min(MAX_ROUNDING_PERCENT, Number(snap.rounding) || 0));
      layer.lineJoinType = snap.lineJoinType || layer.lineJoinType || 'rounded';
      if (Number.isFinite(scale))
        layer.radius = Math.max(1, (Number(snap.radius) || Number(layer.radius) || 220) * scale);
      if (Number.isFinite(rot) && !rotationAudioOverride)
        layer.rotation = (Number(snap.rotation) || Number(layer.rotation) || 0) + rot;
      const overlay = Number(snap.__bluePaletteHueShift) || 0;
      layer.strokeColor = overlay
        ? rotateBluePaletteHueColor(snap.strokeColor || layer.strokeColor, -overlay)
        : snap.strokeColor || layer.strokeColor;
      layer.strokeWidth = Math.max(
        0.5,
        Math.min(20, Number(snap.strokeWidth) || Number(layer.strokeWidth) || 1.5),
      );

      if (state.morph.options.byOpacity)
        layer.opacity = Math.max(0, Math.min(100, Number(snap.opacity) || 0));
      if (state.morph.options.byFillColor) {
        layer.fill = Boolean(snap.fill);
        layer.fillColor =
          (overlay ? rotateBluePaletteHueColor(snap.fillColor || '#000000', -overlay) : snap.fillColor) ||
          colorWithPercentAlpha(layer.strokeColor, layer.fill ? getFillOpacityPercent(layer.fillColor) : 0);
      } else if (layer.fill) {
        layer.fillColor = colorWithPercentAlpha(layer.strokeColor, getFillOpacityPercent(layer.fillColor));
      }
    });
    runtimeState.morph.lightScales = state.layers.map(() => 1);
    runtimeState.morph.lightRotations = state.layers.map(() => 0);
    runtimeState.morph.lightLayers = [];
    runtimeState.morph.lightDrawData = [];
    runtimeState.morph.lightGeometryBucket = -1;
  };

  // One zero-endpoint contract for Light and Full Blue Morph. Both paths
  // keep their existing geometry and closure post-processing rules.
  const applyBlueSpiralZeroOrderFrame = (
    frame,
    authoredLayer,
    source,
    target,
    sourceOn,
    targetOn,
    enabled,
    t,
    corridorActive,
  ) => {
    const zero = window.SomataSpiralZeroTransition;
    const from = sourceOn ? Number(source.spiralOrder) || 0 : 0;
    const to = targetOn ? Number(target.spiralOrder) || 0 : 0;
    const mode = zero.modeFor(authoredLayer);
    if (enabled && isSpiralLayerMorphEnabled()) {
      const sample = sampleBlueSpiralOrder(
        authoredLayer,
        from,
        to,
        runtimeState.morph.progress,
        corridorActive,
      );
      zero.applyCorridorFrame(
        frame,
        mode,
        sample.from,
        sample.to,
        sample.progress,
        corridorActive,
        source,
        target,
        authoredLayer,
        true,
      );
      frame.spiralOrder = sample.order;
      frame.spiralEnabled = !zero.isZero(sample.order);
      frame.__spiralOrderInterpolating = sample.transitioning;
      frame.closedLoop = frame.spiralEnabled ? false : frame.spiralClosed !== false;
      return;
    }
    zero.applyCorridorFrame(
      frame,
      mode,
      from,
      to,
      t,
      enabled && corridorActive === true,
      source,
      target,
      authoredLayer,
    );
    if (!enabled || !(sourceOn || targetOn)) return;
    const plan = zero.plan(mode, from, to, t, corridorActive);
    if (!plan.zeroEndpoint) return;
    frame.spiralOrder = normalizeSpiralOrder(plan.order, false);
    frame.spiralEnabled = true;
    frame.__spiralOrderInterpolating = true;
    frame.closedLoop = Math.abs(frame.spiralOrder) < 1e-8 ? frame.spiralClosed !== false : false;
  };

  const updateLightMorphKeyframe = (t, force = false) => {
    if (state.morph.mode !== 'light') return;
    if (!force && t === runtimeState.morph.lightGeometryBucket) return;
    runtimeState.morph.lightGeometryBucket = t;
    const lightOptions = state.morph.options;
    const spiralLayerMorph = isSpiralLayerMorphEnabled();
    const spiralContinuity = spiralMorphKeepsContinuity();
    const spiralCorridorPhase = spiralMorphUsesCorridorPhase();
    const easedSpiralT = t * t * (3 - 2 * t);
    const corridorActive = state.tunnel?.active === true;
    let normalClosurePlan, openingClosurePlan;

    state.layers.forEach((baseLayer, idx) => {
      const srcV = runtimeState.morph.sourceVisuals[idx] || {};
      const dstV = runtimeState.morph.targetVisuals[idx] || srcV;
      const srcP = runtimeState.morph.sourceProfiles[idx] || { mode: baseLayer.profileMode, nodes: [] };
      const dstP = runtimeState.morph.targetProfiles[idx] || srcP;
      let snap = runtimeState.morph.lightLayers[idx];
      if (!snap) {
        snap = runtimeState.morph.lightLayers[idx] = {
          ...baseLayer,
          profileNodes: (baseLayer.profileNodes || []).map((p) => ({ ...p })),
        };
      }

      const n0 = Math.max(2, Number(srcV.N) || Number(baseLayer.N) || 4);
      const n1 = Math.max(2, Number(dstV.N) || n0);
      const spiralNChange =
        (srcV.spiralEnabled === true || dstV.spiralEnabled === true) && lightOptions.byVertices;
      snap.__spiralAnimatedN = spiralNChange ? n0 + (n1 - n0) * t : n0;
      // Keep count integer for the topology-dependent fallback.
      snap.N = Math.max(2, Math.min(120, Math.round(snap.__spiralAnimatedN)));

      const kRaw = lightOptions.bySteps ? srcV.K + (dstV.K - srcV.K) * t : srcV.K;
      snap.K = Math.max(1, Math.min(Math.floor(snap.N / 2), Math.round(Number(kRaw) || 1)));
      const chaosVisual = t < 0.5 ? srcV : dstV;
      snap.chaosStar = chaosVisual.chaosStar === true;
      snap.chaosStepMinus = Math.max(0, Math.round(Number(chaosVisual.chaosStepMinus) || 0));
      snap.chaosStepPlus = Math.max(0, Math.round(Number(chaosVisual.chaosStepPlus) || 0));
      snap.chaosClosures = Math.max(1, Math.round(Number(chaosVisual.chaosClosures) || 1));
      snap.chaosSeed = Number(chaosVisual.chaosSeed) >>> 0;
      snap.customSuborbits = snap.chaosStar
        ? null
        : lightOptions.byVertices || lightOptions.bySteps
          ? null
          : baseLayer.customSuborbits;

      if (
        (lightOptions.byShape || profileResetFor(baseLayer)) &&
        !(runtimeState.morph.manualProfileEditing && baseLayer.id === state.activeLayerId)
      ) {
        const a = srcP.nodes || [];
        const b = dstP.nodes || a;
        const n = Math.max(a.length, b.length);
        const closurePlan =
          srcV.closedLoop !== false && dstV.closedLoop === false
            ? (openingClosurePlan ||= getMorphClosureTransitionPlan(true, false, t))
            : (normalClosurePlan ||= getMorphClosureTransitionPlan(false, false, t));
        const shapeT = closurePlan.geometryT;
        snap.profileMode = resolveMorphProfileMode(
          srcP.mode || baseLayer.profileMode,
          dstP.mode || srcP.mode || baseLayer.profileMode,
          shapeT,
        );
        snap.profileNodes = Array.from({ length: n }, (_, i) => {
          const p = a[i % Math.max(1, a.length)] || { x: 0, y: 0 };
          const q = b[i % Math.max(1, b.length)] || p;
          return { x: p.x + (q.x - p.x) * shapeT, y: p.y + (q.y - p.y) * shapeT };
        });
        setPreSampledSplineLayer(snap, snap.profileMode === 'spline');
        snap.closedLoop =
          (srcV.closedLoop !== false) === (dstV.closedLoop !== false)
            ? srcV.closedLoop !== false
            : closurePlan.closureMix < 0.5
              ? srcV.closedLoop !== false
              : dstV.closedLoop !== false;
      } else {
        snap.profileMode = srcP.mode || baseLayer.profileMode || 'segments';
        snap.profileNodes = (srcP.rawNodes || baseLayer.profileNodes || []).map((p) => ({
          x: Number(p.x) || 0,
          y: Number(p.y) || 0,
        }));
        setPreSampledSplineLayer(snap, false);
        snap.closedLoop = srcV.closedLoop !== false;
      }

      const sourceSpiralOn = srcV.spiralEnabled === true,
        targetSpiralOn = dstV.spiralEnabled === true;
      const preserveSpiralMode = spiralContinuity && (sourceSpiralOn || targetSpiralOn);
      if (spiralLayerMorph && preserveSpiralMode) {
        snap.spiralEnabled =
          sourceSpiralOn === targetSpiralOn ? sourceSpiralOn : targetSpiralOn ? t > 1e-6 : t < 1 - 1e-6;
        snap.__spiralOrderInterpolating = true;
        const so = sourceSpiralOn ? Number(srcV.spiralOrder) || 0 : 0,
          to = targetSpiralOn ? Number(dstV.spiralOrder) || 0 : 0;
        snap.spiralOrder = normalizeSpiralOrder(so + (to - so) * easedSpiralT, false);
      } else {
        snap.spiralEnabled = spiralLayerMorph
          ? t < 0.5
            ? sourceSpiralOn
            : targetSpiralOn
          : sourceSpiralOn || isSpiralLayer(baseLayer);
        snap.spiralOrder = spiralLayerMorph
          ? normalizeSpiralOrder(
              (srcV.spiralOrder ?? 0) + ((dstV.spiralOrder ?? 0) - (srcV.spiralOrder ?? 0)) * t,
              false,
            )
          : normalizeSpiralOrder(srcV.spiralOrder ?? baseLayer.spiralOrder, false);
      }
      applyBlueSpiralZeroOrderFrame(
        snap,
        baseLayer,
        srcV,
        dstV,
        sourceSpiralOn,
        targetSpiralOn,
        spiralLayerMorph,
        t,
        corridorActive,
      );
      // Light Morph uses the same bounded endpoint K interpolation
      // as Full Morph, the retained Bézier carrier and Corridor.
      // Re-wrapping fractional *raw* K on each frame otherwise
      // introduces extra revolutions and splits copied Spiral rails.
      delete snap.__spiralAnimatedEffectiveK;
      if (spiralCorridorPhase && (sourceSpiralOn || targetSpiralOn)) {
        const ss = Number(srcV.K) || 1,
          ts = Number(dstV.K) || ss;
        snap.__spiralAnimatedK = ss + (ts - ss) * t;
        const eff0 = getEffectiveSpiralStep({
          ...snap,
          ...srcV,
          __spiralAnimatedK: undefined,
          __spiralAnimatedN: undefined,
          __spiralAnimatedEffectiveK: undefined,
        });
        const eff1 = getEffectiveSpiralStep({
          ...snap,
          ...dstV,
          __spiralAnimatedK: undefined,
          __spiralAnimatedN: undefined,
          __spiralAnimatedEffectiveK: undefined,
        });
        snap.__spiralAnimatedEffectiveK = eff0 + (eff1 - eff0) * t;
        snap.spiralStep = snap.__spiralAnimatedK;
        snap.spiralStepLinked = true;
      } else {
        snap.spiralStep = normalizeSpiralStep(
          srcV.spiralStep ?? baseLayer.spiralStep ?? baseLayer.K ?? 1,
          srcV,
        );
        snap.spiralStepLinked = srcV.spiralStepLinked !== false;
      }
      snap.spiralClosed = baseLayer.spiralClosed !== false;
      snap.spiralTangential = baseLayer.spiralTangential === true;
      snap.spiralRoundSeams = baseLayer.spiralRoundSeams !== false;

      if (snap.spiralEnabled) snap.closedLoop = false;
      snap.rounding = lightOptions.byRounding
        ? srcV.rounding + (dstV.rounding - srcV.rounding) * t
        : srcV.rounding;
      snap.lineJoinType = t < 0.5 ? srcV.lineJoinType || 'rounded' : dstV.lineJoinType || 'rounded';

      snap.radius = Math.max(1, Number(srcV.radius) || Number(baseLayer.radius) || 220);
      snap.rotation = Number(srcV.rotation) || Number(baseLayer.rotation) || 0;

      runtimeState.morph.lightDrawData[idx] = getCachedLayerDrawData(snap);
    });
  };

  const getOrCreateBlueResolvedFrameLayer = (idx, canonicalLayer) => {
    const rt = runtimeState.morph;
    if (!Array.isArray(rt.frameLayers)) rt.frameLayers = [];
    let frame = rt.frameLayers[idx];
    if (!frame || frame.__spiroCanonicalId !== canonicalLayer?.id) {
      frame = {};
      Object.defineProperty(frame, '__spiroCanonicalId', {
        value: canonicalLayer?.id || '',
        writable: true,
        configurable: true,
        enumerable: false,
      });
      Object.defineProperty(frame, '__spiroCanonicalSyncKey', {
        value: '',
        writable: true,
        configurable: true,
        enumerable: false,
      });
      rt.frameLayers[idx] = frame;
    }

    let versionSerial = 0;
    try {
      versionSerial = Number(getLayerVersions?.(canonicalLayer)?.serial) || 0;
    } catch (error) {
      noteSuppressedError('morph-runtime/blue/playback#getOrCreateBlueResolvedFrameLayer', error);
    }
    const syncKey = `${Number(rt.lampCycleSerial) || 0}:${versionSerial}`;
    if (frame.__spiroCanonicalSyncKey !== syncKey) {
      Object.assign(frame, canonicalLayer);
      frame.__spiroCanonicalSyncKey = syncKey;
    }

    frame.visible = canonicalLayer?.visible !== false;
    return frame;
  };

  const BLUE_FRAME_COMMIT_KEYS = Object.freeze([
    'N',
    'K',
    'profileMode',
    'closedLoop',
    'radius',
    'rotation',
    'spiralEnabled',
    'spiralOrder',
    'spiralStep',
    'spiralStepLinked',
    'spiralClosed',
    'spiralTangential',
    'spiralRoundSeams',
    'rounding',
    'lineJoinType',
    'strokeColor',
    'strokeWidth',
    'opacity',
    'fill',
    'fillColor',
    'customSuborbits',
    'chaosStar',
    'chaosStepMinus',
    'chaosStepPlus',
    'chaosClosures',
    'chaosSeed',
  ]);

  const commitBlueResolvedFrameToCanonical = () => {
    const rt = runtimeState.morph,
      frames = Array.isArray(rt.frameLayers) ? rt.frameLayers : [];
    if (!frames.length) return false;
    let committed = false;
    state.layers.forEach((canonical, idx) => {
      const frame = frames[idx];
      if (!canonical || !frame || frame.id !== canonical.id) return;
      const profileNodes = frame.profileNodes;
      for (const key of BLUE_FRAME_COMMIT_KEYS) {
        if (!Object.prototype.hasOwnProperty.call(frame, key)) continue;
        // The routed Palette Hue is a presentation-only Blue frame effect.
        // Never bake it into authored colors on a stop/rebase: doing so
        // would rotate the same hues again at the next cycle.
        const overlay = Number(frame.__bluePaletteHueShift) || 0;
        canonical[key] =
          overlay && ['strokeColor', 'fillColor'].includes(key)
            ? rotateBluePaletteHueColor(frame[key], -overlay)
            : frame[key];
      }

      if (Array.isArray(profileNodes)) canonical.profileNodes = profileNodes.map((p) => ({ ...p }));
      if (typeof isPreSampledSplineLayer === 'function' && typeof setPreSampledSplineLayer === 'function')
        setPreSampledSplineLayer(canonical, isPreSampledSplineLayer(frame));
      invalidateLayerGeometry(canonical, 'blue-frame-commit');
      invalidateLayerStyle(canonical, 'blue-frame-commit');
      committed = true;
    });
    rt.frameLayers = [];
    return committed;
  };

  const commitCurrentBlueVisualToCanonical = () => {
    if (!runtimeState.morph.active) return false;
    if (
      state.morph.morphGlobalHueOffset === true &&
      Number.isFinite(Number(runtimeState.morph.frameGlobalHueOffset))
    )
      state.playlistPaletteHueOffset = ((Number(runtimeState.morph.frameGlobalHueOffset) % 360) + 360) % 360;
    const lightMode = state.morph.mode === 'light';
    if (lightMode) {
      commitLightMorphTransient();
      return true;
    }
    return commitBlueResolvedFrameToCanonical();
  };

  const rebaseMorphCycle = (options = null) => {
    if (!runtimeState.morph.active) return;
    const opt = options && typeof options === 'object' && !Array.isArray(options) ? options : {};

    if (opt.resetProfileLayerId) {
      const pending = (runtimeState.morph.pendingProfileResetIds ??= new Set());
      const targets = getLayerEditTargets();
      for (const layer of targets.length ? targets : [{ id: opt.resetProfileLayerId }]) pending.add(layer.id);
      runtimeState.morph.manualProfileEditing = false;
      return true;
    }
    if (morphSidebarRebaseRuntime.active && opt.fromSidebarTransaction !== true) {
      morphSidebarRebaseRuntime.pending = true;
      return;
    }
    const diagnosticFromPhase = Number(runtimeState.morph.phaseSerial) || 0;
    const diagnosticOrigin = opt.diagnosticManualEdit ?? recentManualGeometryIntent(performance.now(), diagnosticFromPhase);
    const preservePaths = [
      ...new Set((Array.isArray(opt.preservePaths) ? opt.preservePaths : []).map(String).filter(Boolean)),
    ];
    let preserved = null;
    if (preservePaths.length) {
      const targets = getLayerEditTargets();
      preserved = targets
        .map((layer) => ({
          id: layer?.id || null,
          values: preservePaths.map((path) => [path, cloneMasterLayerValue(masterPathValue(layer, path))]),
        }))
        .filter((rec) => rec.id);
    }
    runtimeState.morph.webUiHoldStart = 0;
    runtimeState.morph.suppressPaletteCycleOnce = true;

    commitSpiralMorphRotationCompensationProgress(
      Number.isFinite(Number(runtimeState.morph.geometryT))
        ? Number(runtimeState.morph.geometryT)
        : Number(runtimeState.morph.progress) || 0,
    );
    commitCurrentBlueVisualToCanonical();

    if (preserved) {
      for (const rec of preserved) {
        const layer = state.layers.find((item) => item?.id === rec.id);
        if (!layer) continue;
        for (const [path, value] of rec.values) applyMasterPath(layer, path, cloneMasterLayerValue(value));
      }
    }
    prepareMorphCycle(performance.now());
    markManualGeometryRebase(diagnosticOrigin, diagnosticFromPhase, Number(runtimeState.morph.phaseSerial) || 0);
  };

  const blueMorphHasExactPolygonEndpoints = (idx) => {
    const src = runtimeState.morph.renderSourceLayers?.[idx];
    const dst = runtimeState.morph.renderTargetLayers?.[idx];
    if (
      !src ||
      !dst ||
      isSpiralLayer(src) ||
      isSpiralLayer(dst) ||
      src.spiralEnabled === true ||
      dst.spiralEnabled === true ||
      src.chaosStar === true ||
      dst.chaosStar === true ||
      somataFourierActive(src) ||
      somataFourierActive(dst) ||
      src.closedLoop !== dst.closedLoop
    )
      return false;
    // Здесь пара — многоугольник, поэтому действует тип многоугольника.
    const polygonMode = getPolygonMorphMode();
    // These modes always consume the original sampled profile grid,
    // exactly as in 10.4.19.4; only topoCircle opts into exact cubics.
    if (polygonMode === 'topology' || polygonMode === 'calm') return false;
    if (polygonMode === 'topoCircle' || polygonMode === 'topoCircleOpacity') {
      // New mode only: exact segment-only endpoints and raw-knot handoff.
      return true;
    }
    if (polygonMode === 'circleSlide') {
      // Original 10.4.19.29 circle handoff: only spline endpoints.
      return src.profileMode === 'spline' || dst.profileMode === 'spline';
    }
    return !['fade', 'light', 'lightning'].includes(polygonMode);
  };

  const commitFullMorphTargetAtBoundary = () => {
    const orderRt = runtimeState.morph;
    const phase = orderRt.orderCompletedPhases ?? 0;
    const history = (orderRt.orderHoldHistory ??= new Map());
    if (isSpiralLayerMorphEnabled())
      state.layers.forEach((layer, i) => {
        const from = getEffectiveSpiralOrder(orderRt.sourceVisuals[i]);
        const to =
          window.SomataTestMorph?.independentOrderTarget?.(layer.id) ??
          getEffectiveSpiralOrder(orderRt.targetVisuals[i]);
        if (from !== to) history.set(layer.id, { order: to, phase });
      });
    orderRt.orderCompletedPhases = phase + 1;
    // Keep the actual terminal spiral render snapshot across the
    // phase handoff, not only the raw authored profile knots.
    runtimeState.morph.phaseSourceSpiralRenderHandoff = (runtimeState.morph.renderTargetLayers || []).map(
      (layer, idx) =>
        layer?.spiralEnabled === true
          ? {
              ...layer,
              profileNodes: (layer.profileNodes || []).map((p) => ({ ...p })),
              // Pre-GPU phase handoff: actual endpoint cubics and
              // branch visibility (including invisible split/merge
              // branches), captured before the old phase is parked.
              __morphBoundaryRails: layer.__somataOrderHandoff
                ? null
                : WebGPUSpiralBezierMorphRenderer?.captureTerminalRails?.(idx) || null,
              __morphExactProfileNodes: Array.isArray(layer.__morphExactProfileNodes)
                ? layer.__morphExactProfileNodes.map((p) => ({ ...p }))
                : undefined,
              __lampLogicalCornerFlags: Array.isArray(layer.__lampLogicalCornerFlags)
                ? layer.__lampLogicalCornerFlags.slice()
                : undefined,
            }
          : null,
    );

    runtimeState.morph.phaseSourceProfileHandoff = (runtimeState.morph.targetProfiles || []).map(
      (target, idx) => {
        const layerMode = getMorphModeForLayer(idx);
        const reference104 = ['topology', 'calm', 'circleSlide'].includes(layerMode);
        const exactPolygon = !reference104 && blueMorphHasExactPolygonEndpoints(idx);
        const nodes = exactPolygon && Array.isArray(target?.rawNodes) ? target.rawNodes : target?.nodes;
        return Array.isArray(nodes) && nodes.length >= 2
          ? {
              mode: target?.mode || state.layers[idx]?.profileMode || 'segments',
              nodes: nodes.map((p) => ({ x: Number(p.x) || 0, y: Number(p.y) || 0 })),
              // Raw authored knots and equalized spline samples have
              // different tangent solvers. Never relabel raw knots as
              // pre-sampled during the next cycle's initial frame.
              alreadySampled: ['topology', 'calm', 'circleSlide'].includes(layerMode)
                ? target?.mode === 'spline'
                : !exactPolygon,
              lampLogicalCornerFlags: exactPolygon
                ? []
                : Array.isArray(target?.lampLogicalCornerFlags)
                  ? target.lampLogicalCornerFlags.map(Boolean)
                  : [],
            }
          : null;
      },
    );

    commitSpiralMorphRotationCompensationProgress(1);
    const rotationAudioOverride = isAudioRotationOverrideActive();
    const spiralMorphEnabled = isSpiralLayerMorphEnabled();
    const corridorSpiralPhase = spiralMorphUsesCorridorPhase();
    if (state.morph.morphGlobalHueOffset === true) {
      state.playlistPaletteHueOffset = ((Number(runtimeState.morph.targetGlobalHueOffset) % 360) + 360) % 360;
      runtimeState.morph.frameGlobalHueOffset = state.playlistPaletteHueOffset;
    }
    state.layers.forEach((layer, idx) => {
      const target = runtimeState.morph.targetProfiles?.[idx];
      const visual = runtimeState.morph.targetVisuals?.[idx];
      // An interrupted or rebased phase can leave a missing target
      // for a layer. Its authored frame is already valid; preserve
      // it rather than aborting boundary commit for ALL layers.
      if (!target || !visual) return;
      if (
        (state.morph.options.byShape || profileResetFor(layer)) &&
        !(runtimeState.morph.manualProfileEditing && layer.id === state.activeLayerId)
      ) {
        layer.profileMode = target.mode;
        layer.profileNodes = (target.rawNodes || target.nodes || []).map((p) => ({ ...p }));
        setPreSampledSplineLayer(layer, false);
        layer.closedLoop = visual.closedLoop !== false;
      }
      if (state.morph.options.byVertices) layer.N = visual.N;
      if (state.morph.options.bySteps) layer.K = Math.max(1, Math.min(Math.floor(layer.N / 2), visual.K));
      if (visual.chaosStar === true) {
        layer.chaosStar = true;
        layer.customSuborbits = null;
        layer.chaosStepMinus = Math.max(0, Math.round(Number(visual.chaosStepMinus) || 0));
        layer.chaosStepPlus = Math.max(0, Math.round(Number(visual.chaosStepPlus) || 0));
        layer.chaosClosures = Math.max(1, Math.round(Number(visual.chaosClosures) || 1));
        layer.chaosSeed = Number(visual.chaosSeed) >>> 0;
      } else if (state.morph.monoOrbitTransforms) {
        layer.customSuborbits = visual.customSuborbits ?? null;
        if (!Array.isArray(runtimeState.morph.orbitCopyMemory)) runtimeState.morph.orbitCopyMemory = [];
        runtimeState.morph.orbitCopyMemory[idx] = Math.max(
          1,
          Math.round(Number(visual.morphOrbitCopies) || getMorphVisualOrbitCount(visual, layer)),
        );
      }
      if (state.morph.options.bySize) layer.radius = visual.radius;
      if (state.morph.options.byRotation && !rotationAudioOverride) layer.rotation = visual.rotation;

      const sourceSpiralVisual = runtimeState.morph.sourceVisuals?.[idx] || null;
      const commitResolvedSpiral =
        spiralMorphEnabled ||
        (corridorSpiralPhase &&
          (sourceSpiralVisual?.spiralEnabled === true ||
            visual?.spiralEnabled === true ||
            isSpiralLayer(layer)));
      if (commitResolvedSpiral) {
        layer.spiralEnabled = visual.spiralEnabled === true;
        delete layer.__spiralAnimatedK;
        delete layer.__spiralOrderInterpolating;
        const manualOrder = window.SomataTestMorph?.independentOrderTarget?.(layer.id);
        if (manualOrder !== null && manualOrder !== undefined) {
          layer.spiralOrder = manualOrder;
          layer.spiralEnabled = Math.abs(manualOrder) > 1e-8;
        } else layer.spiralOrder = normalizeSpiralOrder(visual.spiralOrder, false);
        if (layer.spiralEnabled === true) layer.spiralRememberedOrder = layer.spiralOrder;
        layer.spiralStep = normalizeSpiralStep(visual.spiralStep ?? visual.K ?? layer.K ?? 1, visual);
        layer.spiralStepLinked = visual.spiralStepLinked !== false;
        layer.spiralClosed = visual.spiralClosed !== false;
        layer.spiralTangential = visual.spiralTangential === true;
        layer.spiralRoundSeams = visual.spiralRoundSeams !== false;

        layer.closedLoop =
          !layer.spiralEnabled &&
          (manualOrder != null && visual.spiralEnabled === true
            ? layer.spiralClosed
            : visual.closedLoop !== false);
      } else {
        if (isSpiralLayer(layer)) layer.closedLoop = false;

        layer.spiralClosed = visual.spiralClosed !== false;
        layer.spiralTangential = visual.spiralTangential === true;
        layer.spiralRoundSeams = visual.spiralRoundSeams !== false;
      }
      if (state.morph.options.byColor || state.morph.morphGlobalHueOffset === true)
        layer.strokeColor = visual.strokeColor;
      if (state.morph.options.byStrokeWidth) layer.strokeWidth = visual.strokeWidth;

      if (state.morph.options.byOpacity) layer.opacity = visual.opacity;
      if (state.morph.options.byRounding) layer.rounding = visual.rounding;
      layer.lineJoinType = visual.lineJoinType || layer.lineJoinType || 'rounded';
      // 13.0.4: commit the exact target Fill endpoint at the handoff.
      // The previous branch only committed when byFillColor was routed;
      // a topology/closure change could therefore start the next
      // phase with a DIFFERENT Fill flag / alpha than the last frame.
      const fillEnd = runtimeState.morph.fillPhaseEndpoints?.[idx]?.to;
      if (fillEnd) {
        layer.fill = fillEnd.enabled;
        layer.fillColor = fillEnd.color;
      } else if (state.morph.options.byFillColor) {
        layer.fill = Boolean(visual.fill);
        layer.fillColor =
          visual.fillColor ||
          colorWithPercentAlpha(layer.strokeColor, layer.fill ? getFillOpacityPercent(layer.fillColor) : 0);
      } else if (layer.fill && (state.morph.options.byColor || state.morph.morphGlobalHueOffset === true)) {
        layer.fillColor =
          visual.fillColor ||
          colorWithPercentAlpha(layer.strokeColor, getFillOpacityPercent(layer.fillColor));
      }
      // Do not replace the visible end of an animated spline Morph
      // (Polygon or Spiral) with a newly sampled authored spline
      // at the cycle boundary.  Paired Morph nodes are already sampled;
      // rebuilding from raw authoring nodes here can have a different
      // Bézier segment count and creates a one-frame shape jump.
      // Store only a rendering bridge: authored profileNodes remain
      // untouched and editable, and the bridge is never serialized.
      const bridge =
        runtimeState.morph.splineCommitBridge || (runtimeState.morph.splineCommitBridge = new WeakMap());
      const sampled = target?.nodes,
        raw = target?.rawNodes;
      // Only fallback and specialized paths retain sampled
      // handoff geometry. Exact Polygon paths end on raw knots.
      const exactPolygonEndpoint =
        getMorphModeForLayer(idx) !== 'circleSlide' && blueMorphHasExactPolygonEndpoints(idx);
      if (
        !exactPolygonEndpoint &&
        (!['topology', 'calm'].includes(getMorphModeForLayer(idx)) || layer.spiralEnabled === true) &&
        layer.profileMode === 'spline' &&
        Array.isArray(sampled) &&
        sampled.length >= 2 &&
        Array.isArray(raw) &&
        raw.length >= 2
      ) {
        const matchesAuthoring =
          Array.isArray(layer.profileNodes) &&
          layer.profileNodes.length === raw.length &&
          layer.profileNodes.every(
            (p, j) =>
              Math.abs((Number(p?.x) || 0) - (Number(raw[j]?.x) || 0)) < 1e-9 &&
              Math.abs((Number(p?.y) || 0) - (Number(raw[j]?.y) || 0)) < 1e-9,
          );
        if (matchesAuthoring) {
          bridge.set(layer, {
            raw: raw.map((p) => ({ x: Number(p?.x) || 0, y: Number(p?.y) || 0 })),
            sampled: sampled.map((p) => ({ x: Number(p?.x) || 0, y: Number(p?.y) || 0 })),
          });
        } else bridge.delete(layer);
      } else bridge.delete(layer);
    });
  };

  // Morph and all time-based effects must share the same wall-clock timeline.
  // Do not shift cycleStart after a long frame: doing so makes the Base/Line
  // lag behind Web/Sweep/Graffiti/Lamps, which continue from current time.
  // A delayed frame is allowed to advance Morph directly to its current
  // timeline position; scheduler diagnostics still report the underlying stall.

  // Shared appearance contract for Light and Full Blue Morph. Light
  // always writes its source opacity when the opacity route is off;
  // Full Morph preserves the existing resolved-layer opacity instead.
  // Palette > General Hue Offset is routed by Blue profiles as a global
  // value. Palette previews used that routed value, but already existing
  // scene colors were never updated. Apply its DIFFERENCE from the native
  // Blue frame hue to the transient display layers only. This also lets
  // the built-in global-hue Morph and the independently routed parameter
  // operate together without applying the native hue change twice.
  const bluePaletteHueDelta = () => {
    const nativeHue =
      state.morph.morphGlobalHueOffset === true
        ? (((Number(runtimeState.morph.frameGlobalHueOffset) || 0) % 360) + 360) % 360
        : normalizePlaylistHueOffset(state.playlistPaletteHueOffset);
    const routedHue = getEffectivePlaylistHueOffset();
    return ((routedHue - nativeHue + 540) % 360) - 180;
  };
  const applyBlueMorphFrameAppearance = (
    snapshot,
    canonicalLayer,
    idx,
    srcV,
    dstV,
    t,
    options,
    globalHueMorph,
    lightMode,
    paletteHueDelta,
  ) => {
    // Reused Full Morph frame layers must start with the authored
    // color when legacy Color Morph is disabled; otherwise the hue
    // overlay accumulates on every animation frame.
    if (!options.byColor && !globalHueMorph) snapshot.strokeColor = canonicalLayer.strokeColor;
    if (!options.byFillColor && !options.byColor && !globalHueMorph)
      snapshot.fillColor = canonicalLayer.fillColor;
    if (options.byColor || globalHueMorph) {
      snapshot.strokeColor = globalHueMorph
        ? lerpPreparedHslWithHueAmount(
            runtimeState.morph.sourceColorHsl?.[idx],
            runtimeState.morph.targetColorHsl?.[idx],
            t,
            state.morph.globalHueOffsetRange,
          )
        : lerpPreparedHsl(
            runtimeState.morph.sourceColorHsl?.[idx],
            runtimeState.morph.targetColorHsl?.[idx],
            t,
          );
    }
    if (options.byStrokeWidth)
      snapshot.strokeWidth = srcV.strokeWidth + (dstV.strokeWidth - srcV.strokeWidth) * t;
    snapshot.glow = Math.max(0, Number(canonicalLayer?.glow) || 0);
    if (options.byOpacity) snapshot.opacity = srcV.opacity + (dstV.opacity - srcV.opacity) * t;
    else if (lightMode) snapshot.opacity = srcV.opacity;
    applyFillMorphFrame(snapshot, idx, t, snapshot.strokeColor);
    snapshot.__bluePaletteHueShift = paletteHueDelta;
    if (Math.abs(paletteHueDelta) > 1e-9) {
      snapshot.strokeColor = rotateBluePaletteHueColor(snapshot.strokeColor, paletteHueDelta);
      if (typeof snapshot.fillColor === 'string' && snapshot.fillColor !== 'transparent')
        snapshot.fillColor = rotateBluePaletteHueColor(snapshot.fillColor, paletteHueDelta);
      if (typeof snapshot.__morphOrbitFillCompositeColor === 'string')
        snapshot.__morphOrbitFillCompositeColor = rotateBluePaletteHueColor(
          snapshot.__morphOrbitFillCompositeColor,
          paletteHueDelta,
        );
    }
  };

  const animateMorph = (now) => {
    if (!runtimeState.morph.active || runtimeState.morph.paused) return false;

    const rewind = runtimeState.morph.returnToPhaseStart;
    if (!rewind && noteMorphGpuPrepareWait(runtimeState.morph, 'Blue Morph', now)) {
      runtimeState.morph.lastFrameUpdate = now;
      return true;
    }

    runtimeState.morph.lastFrameUpdate = now;

    if (!runtimeState.morph.cycleStart) prepareMorphCycle(now);
    const cycleMs = blueOrderPhaseDurationMs(
      Math.max(100, getTapMorphIntervalSec(state.morph.intervalSec, 'full') * 1000),
    );
    runtimeState.morph.transitionMs = cycleMs;
    const geometryCycleStart = runtimeState.morph.cycleStart,
      geometryCycleMs = cycleMs;
    const cycleElapsed = now - geometryCycleStart;
    if (!rewind && cycleElapsed >= cycleMs) {
      const fadeFraction =
        state.morph.mode === 'fade'
          ? Math.max(0, Math.min(1, (Number(state.morph.fadePercent) || 0) / 100))
          : 1;

      if (state.morph.mode !== 'fade' || fadeFraction > 0.000001) {
        if (!runtimeState.morph.boundaryPaintPending) {
          runtimeState.morph.boundaryPaintPending = true;
          const boundaryCycleSerial = runtimeState.morph.lampCycleSerial;
          const boundaryPhaseSerial = SpiroMorphController.currentBluePhaseSerial();
          animationScheduler.afterNextPaint('morph-cycle-boundary', () => {
            if (
              !runtimeState.morph.active ||
              runtimeState.morph.returnToPhaseStart ||
              runtimeState.morph.paused === true ||
              runtimeState.morph.pausedByOrangeProject === true ||
              !SpiroMorphController.isBluePhaseCurrent(boundaryPhaseSerial) ||
              runtimeState.morph.lampCycleSerial !== boundaryCycleSerial
            ) {
              runtimeState.morph.boundaryPaintPending = false;
              return;
            }
            commitFullMorphTargetAtBoundary();
            runtimeState.morph.manualProfileResetIds = runtimeState.morph.pendingProfileResetIds || null;
            runtimeState.morph.pendingProfileResetIds = null;
            runtimeState.morph.boundaryPaintPending = false;
            prepareMorphCycle(performance.now());
            applyPendingWebSwitchAtMorphBoundary();
            requestMainCanvasRender();
          });
        }
      } else {
        commitFullMorphTargetAtBoundary();
        runtimeState.morph.manualProfileResetIds = runtimeState.morph.pendingProfileResetIds || null;
        runtimeState.morph.pendingProfileResetIds = null;
        prepareMorphCycle(now);
        applyPendingWebSwitchAtMorphBoundary();
      }
    }

    const returning = rewind ? SpiroMorphController.resolveBlueReturn(rewind, now) : null;
    const timeline = SpiroMorphController.resolveBlueTimeline({
      now: returning ? geometryCycleStart + returning.linearT * geometryCycleMs : now,
      cycleStart: geometryCycleStart,
      cycleMs: geometryCycleMs,
      mode: state.morph.mode,
      fadePercent: state.morph.fadePercent,
      easing: applyMorphEasing,
    });
    const linearT = timeline.linearT;
    const transitionLinearT = timeline.transitionLinearT;
    const t = returning?.initial ? rewind.geometryT : timeline.geometryT;
    runtimeState.morph.progress = linearT;
    runtimeState.morph.geometryT = t;
    runtimeState.morph.geometryBlend = t;
    if (state.morph.morphGlobalHueOffset === true) {
      runtimeState.morph.frameGlobalHueOffset =
        (Number(runtimeState.morph.sourceGlobalHueOffset) || 0) +
        ((Number(runtimeState.morph.targetGlobalHueOffset) || 0) -
          (Number(runtimeState.morph.sourceGlobalHueOffset) || 0)) *
          t;
    } else
      runtimeState.morph.frameGlobalHueOffset = normalizePlaylistHueOffset(state.playlistPaletteHueOffset);

    if (now - (runtimeState.morph.lastSidebarPaint || 0) >= 100) {
      updateSidebarFromMorph(t);
      const displayedHue = document.getElementById('playlistPaletteHueOffsetText')?.textContent;
      if (
        state.morph.morphGlobalHueOffset === true ||
        displayedHue !== `${Math.round(getEffectivePlaylistHueOffset())}°`
      ) {
        syncPlaylistPaletteHueOffsetUI();
        refreshPlaylistPaletteHuePreviews();
      }
      runtimeState.morph.lastSidebarPaint = now;
    }
    if (state.morph.mode === 'light')
      updateLightMorphKeyframe(t, runtimeState.morph.lightGeometryBucket === -1);

    const profileEditorRefreshDue = now - (runtimeState.morph.lastEditorPaint || 0) > 125;
    // All flags below depend on authored settings (or routing), not on a
    // particular layer. A frame is synchronous: calculate once rather
    // than repeating registry / morph-mode lookups for every layer.
    const morphOptions = state.morph.options;
    const lightMode = state.morph.mode === 'light';
    const globalHueMorph = state.morph.morphGlobalHueOffset === true;
    const paletteHueDelta = bluePaletteHueDelta();
    const rotationMorph = morphOptions.byRotation && !isAudioRotationOverrideActive();
    const spiralLayerMorph = !lightMode && isSpiralLayerMorphEnabled();
    const spiralContinuity = spiralLayerMorph && spiralMorphKeepsContinuity();
    const spiralCorridorPhase = !lightMode && spiralMorphUsesCorridorPhase();
    const updateProfileNodes =
      profileEditorRefreshDue || transitionLinearT <= 1e-9 || transitionLinearT >= 1 - 1e-9;
    let normalClosurePlan, openingClosurePlan;
    const easedSpiralT = spiralLayerMorph ? t * t * (3 - 2 * t) : 0;
    const corridorActive = state.tunnel?.active === true;

    state.layers.forEach((canonicalLayer, idx) => {
      const layer = getOrCreateBlueResolvedFrameLayer(idx, canonicalLayer);
      const srcV = runtimeState.morph.sourceVisuals[idx] || {};
      const dstV = runtimeState.morph.targetVisuals[idx] || srcV;

      if (lightMode) {
        const snap = runtimeState.morph.lightLayers[idx] || layer;
        snap.visible = canonicalLayer?.visible !== false;
        const sourceRadius = Math.max(1e-6, Number(srcV.radius) || Number(snap.radius) || 220);
        const visualRadius = morphOptions.bySize
          ? srcV.radius + (dstV.radius - srcV.radius) * t
          : sourceRadius;
        runtimeState.morph.lightScales[idx] = Math.max(0.05, visualRadius / sourceRadius);
        const visualRotation = rotationMorph
          ? (Number(srcV.rotation) || 0) + ((Number(dstV.rotation) || 0) - (Number(srcV.rotation) || 0)) * t
          : srcV.rotation;
        runtimeState.morph.lightRotations[idx] = visualRotation - srcV.rotation;
        applyBlueMorphFrameAppearance(
          snap,
          canonicalLayer,
          idx,
          srcV,
          dstV,
          t,
          morphOptions,
          globalHueMorph,
          true,
          paletteHueDelta,
        );
      } else {
        if (
          (morphOptions.byShape || profileResetFor(canonicalLayer)) &&
          !(runtimeState.morph.manualProfileEditing && layer.id === state.activeLayerId)
        ) {
          const srcMode = runtimeState.morph.sourceProfiles[idx]?.mode || layer.profileMode || 'segments';
          const dstMode = runtimeState.morph.targetProfiles[idx]?.mode || srcMode;
          const closurePlan =
            srcV.closedLoop !== false && dstV.closedLoop === false
              ? (openingClosurePlan ||= getMorphClosureTransitionPlan(true, false, t))
              : (normalClosurePlan ||= getMorphClosureTransitionPlan(false, false, t));
          const shapeT = closurePlan.geometryT;
          layer.profileMode = resolveMorphProfileMode(srcMode, dstMode, shapeT);
          setPreSampledSplineLayer(layer, layer.profileMode === 'spline');
          // A Spiral + profile Morph must update the visible keypoint
          // rail every frame, like Geometry > Animation. The 125 ms
          // refresh throttle belongs only to the PROFILE EDITOR UI;
          // applying it to the rendered Spiral caused visible steps
          // and expensive catch-up rebuilds between Blue frames.
          const spiralProfileRefresh = srcV.spiralEnabled === true || dstV.spiralEnabled === true;
          if (updateProfileNodes || spiralProfileRefresh || profileResetFor(canonicalLayer)) {
            const src =
              runtimeState.morph.sourceProfiles[idx]?.nodes ||
              sampleProfileForMorph(canonicalLayer.profileNodes);
            const dst = runtimeState.morph.targetProfiles[idx]?.nodes || src;
            let runtimeProfile = runtimeState.morph.runtimeProfiles?.[idx];
            if (!runtimeProfile || runtimeProfile.length !== src.length) {
              if (!runtimeState.morph.runtimeProfiles) runtimeState.morph.runtimeProfiles = [];
              runtimeProfile = runtimeState.morph.runtimeProfiles[idx] = src.map(() => ({ x: 0, y: 0 }));
            }
            for (let i = 0; i < src.length; i++) {
              const p = src[i];
              const q = dst[i] || p;
              runtimeProfile[i].x = p.x + (q.x - p.x) * shapeT;
              runtimeProfile[i].y = p.y + (q.y - p.y) * shapeT;
            }
            layer.profileNodes = runtimeProfile;
          }
          layer.closedLoop =
            (srcV.closedLoop !== false) === (dstV.closedLoop !== false)
              ? srcV.closedLoop !== false
              : closurePlan.closureMix < 0.5
                ? srcV.closedLoop !== false
                : dstV.closedLoop !== false;
        }
        if (morphOptions.bySize) layer.radius = srcV.radius + (dstV.radius - srcV.radius) * t;
        if (rotationMorph)
          layer.rotation =
            (Number(srcV.rotation) || 0) + ((Number(dstV.rotation) || 0) - (Number(srcV.rotation) || 0)) * t;
        const sourceSpiralOn = srcV.spiralEnabled === true,
          targetSpiralOn = dstV.spiralEnabled === true;
        if (sourceSpiralOn || targetSpiralOn) {
          const sn = Math.max(2, Number(srcV.N) || Number(canonicalLayer.N) || 4);
          const dn = Math.max(2, Number(dstV.N) || sn);
          layer.__spiralAnimatedN = morphOptions.byVertices ? sn + (dn - sn) * t : sn;
          layer.N = Math.max(2, Math.round(layer.__spiralAnimatedN));
        } else {
          delete layer.__spiralAnimatedN;
        }
        if (spiralLayerMorph) {
          const preserveSpiralMode = spiralContinuity && (sourceSpiralOn || targetSpiralOn);
          if (preserveSpiralMode) {
            layer.spiralEnabled =
              sourceSpiralOn === targetSpiralOn ? sourceSpiralOn : targetSpiralOn ? t > 1e-6 : t < 1 - 1e-6;
            layer.__spiralOrderInterpolating = true;
            const so = sourceSpiralOn ? Number(srcV.spiralOrder) || 0 : 0,
              to = targetSpiralOn ? Number(dstV.spiralOrder) || 0 : 0;
            layer.spiralOrder = normalizeSpiralOrder(so + (to - so) * easedSpiralT, false);
          } else {
            layer.spiralEnabled = t < 0.5 ? sourceSpiralOn : targetSpiralOn;
            layer.spiralOrder = normalizeSpiralOrder(
              (srcV.spiralOrder ?? 0) + ((dstV.spiralOrder ?? 0) - (srcV.spiralOrder ?? 0)) * t,
              false,
            );
          }
        }
        applyBlueSpiralZeroOrderFrame(
          layer,
          canonicalLayer,
          srcV,
          dstV,
          sourceSpiralOn,
          targetSpiralOn,
          spiralLayerMorph,
          t,
          corridorActive,
        );
        delete layer.__spiralAnimatedEffectiveK;
        if (spiralCorridorPhase) {
          if (sourceSpiralOn || targetSpiralOn) {
            const ss = Number(srcV.K) || 1,
              ts = Number(dstV.K) || ss;
            layer.__spiralAnimatedK = ss + (ts - ss) * t;
            // Interpolate wrapped endpoint steps ONCE rather
            // than travelling through every raw K cycle.
            const eff0 = getEffectiveSpiralStep({
              ...layer,
              ...srcV,
              __spiralAnimatedK: undefined,
              __spiralAnimatedN: undefined,
              __spiralAnimatedEffectiveK: undefined,
            });
            const eff1 = getEffectiveSpiralStep({
              ...layer,
              ...dstV,
              __spiralAnimatedK: undefined,
              __spiralAnimatedN: undefined,
              __spiralAnimatedEffectiveK: undefined,
            });
            layer.__spiralAnimatedEffectiveK = eff0 + (eff1 - eff0) * t;
            layer.spiralStep = layer.__spiralAnimatedK;
            layer.spiralStepLinked = true;
          }
        }
        if (isSpiralLayer(layer)) {
          layer.closedLoop = false;
        } else if (spiralLayerMorph && sourceSpiralOn !== targetSpiralOn) {
          layer.closedLoop = (t < 0.5 ? srcV.closedLoop : dstV.closedLoop) !== false;
        }
        layer.spiralClosed = (t < 0.5 ? srcV.spiralClosed : dstV.spiralClosed) !== false;
        layer.spiralTangential = (t < 0.5 ? srcV.spiralTangential : dstV.spiralTangential) === true;
        // Tangency uses a continuous carrier weight with zero velocity at both ends.
        // Order zero is always a polygon, even for old saved checkboxes.
        const fromTangent =
          sourceSpiralOn && Math.abs(Number(srcV.spiralOrder) || 0) > 1e-8 && srcV.spiralTangential === true
            ? 1
            : 0;
        const toTangent =
          targetSpiralOn && Math.abs(Number(dstV.spiralOrder) || 0) > 1e-8 && dstV.spiralTangential === true
            ? 1
            : 0;
        layer.__spiralTangentialMix = fromTangent + (toTangent - fromTangent) * (t * t * (3 - 2 * t));
        if (Math.abs(Number(layer.spiralOrder) || 0) <= 1e-8) layer.__spiralTangentialMix = 0;
        layer.spiralRoundSeams = (t < 0.5 ? srcV.spiralRoundSeams : dstV.spiralRoundSeams) !== false;

        if (morphOptions.byRounding)
          layer.rounding = interpolateMorphRounding(srcV.rounding, dstV.rounding, t);
        layer.lineJoinType = t < 0.5 ? srcV.lineJoinType || 'rounded' : dstV.lineJoinType || 'rounded';
        applyBlueMorphFrameAppearance(
          layer,
          canonicalLayer,
          idx,
          srcV,
          dstV,
          t,
          morphOptions,
          globalHueMorph,
          false,
          paletteHueDelta,
        );
      }
    });

    if (Array.isArray(runtimeState.morph.frameLayers))
      runtimeState.morph.frameLayers.length = state.layers.length;

    if (profileEditorRefreshDue) {
      renderProfileEditor();
      runtimeState.morph.lastEditorPaint = now;
    }
    requestMainCanvasRender();
    if (returning?.done && !rewind.finishing) {
      rewind.finishing = true;
      animationScheduler.afterNextPaint('morph-return-finish', () => {
        if (runtimeState.morph.returnToPhaseStart !== rewind) return;
        stopMorphing(false, true);
      });
    }
    return true;
  };

  const cloneMorphOriginLayers = (layers) => JSON.parse(JSON.stringify(Array.isArray(layers) ? layers : []));

  const captureBlueStablePoint = (owner) => {
    if (!owner) return;
    owner.originLayers = [];
    owner.originUsesCanonicalStable = true;
    owner.originActiveLayerId = state.activeLayerId || null;
    owner.originPresetValue = document.getElementById('presetSelect')?.value || '';
    owner.originGlobalHueOffset = normalizePlaylistHueOffset(state.playlistPaletteHueOffset);
    owner.stablePhaseSerial = SpiroMorphController?.currentBluePhaseSerial?.() ?? 0;
  };

  const captureMorphOrigin = (owner) => {
    if (!owner) return;
    owner.originLayers = cloneMorphOriginLayers(state.layers);
    owner.originUsesCanonicalStable = false;
    owner.originActiveLayerId = state.activeLayerId || null;
    owner.originPresetValue = document.getElementById('presetSelect')?.value || '';
    owner.originGlobalHueOffset = normalizePlaylistHueOffset(state.playlistPaletteHueOffset);
  };

  const restoreMorphOrigin = (owner) => {
    if (!owner || !Array.isArray(owner.originLayers) || !owner.originLayers.length) return false;
    state.layers = cloneMorphOriginLayers(owner.originLayers);
    const wantedId = owner.originActiveLayerId;
    state.activeLayerId = state.layers.some((layer) => layer.id === wantedId)
      ? wantedId
      : state.layers[0]?.id || null;
    const preset = document.getElementById('presetSelect');
    if (preset) preset.value = owner.originPresetValue || '';
    state.playlistPaletteHueOffset = normalizePlaylistHueOffset(owner.originGlobalHueOffset);
    syncPlaylistPaletteHueOffsetUI();

    state.layers.forEach((layer) => {
      invalidateLayerGeometry(layer, 'morph-stop-restore');
      invalidateLayerStyle(layer, 'morph-stop-restore');
      invalidateLayerTransform(layer, 'morph-stop-restore');
    });
    updateLayerListUI();
    syncSidebarInputs();
    renderProfileEditor();
    return true;
  };

  const clearMorphOrigin = (owner) => {
    if (!owner) return;
    owner.originLayers = [];
    owner.originActiveLayerId = null;
    owner.originPresetValue = '';
    owner.originGlobalHueOffset = 0;
    owner.originUsesCanonicalStable = false;
    owner.stablePhaseSerial = 0;
  };

  const stopMorphing = (restoreOrigin = true, atPhaseStart = false) => {
    if (!runtimeState.morph.active) return false;
    if (!restoreOrigin && !atPhaseStart) commitCurrentBlueVisualToCanonical();
    runtimeState.morph.returnToPhaseStart = null;
    animationScheduler.remove('morph-return-finish');

    for (const id of runtimeState.morph.honestZeroCorridorIntro?.ids || []) stopHonestZeroCorridorIntro(id);
    for (const id of runtimeState.morph.honestZeroCorridorOutro?.ids || []) stopHonestZeroCorridorOutro(id);
    runtimeState.morph.honestZeroCorridorIntro = null;
    runtimeState.morph.honestZeroCorridorOutro = null;
    runtimeState.morph.active = false;
    runtimeState.morph.manualProfileResetIds = null;
    runtimeState.morph.pendingProfileResetIds = null;
    runtimeState.morph.splineCommitBridge = new WeakMap();

    animationScheduler.remove('morph');
    animationScheduler.remove('morph-owner');
    animationScheduler.remove('morph-arm');

    runtimeState.morph.startArmSerial =
      (Math.max(0, Number(runtimeState.morph.startArmSerial) || 0) + 1) >>> 0;
    runtimeState.morph.gpuPhasePrepareSerial =
      (Math.max(0, Number(runtimeState.morph.gpuPhasePrepareSerial) || 0) + 1) >>> 0;
    runtimeState.morph.gpuPhasePreparing = false;
    runtimeState.morph.gpuPhaseWarming = false;
    runtimeState.morph.gpuSpecializedSpiralReady = false;
    runtimeState.morph.gpuPhasePreparePromise = null;
    runtimeState.morph.phaseSourceProfileHandoff = null;
    runtimeState.morph.phaseSourceSpiralRenderHandoff = null;
    SpiroMorphController?.invalidateBluePhase?.('user-stop-stable-rollback');
    try {
      parkGpuSpiralBezierMorphResources?.('stop-stable-rollback');
    } catch (error) {
      noteSuppressedError('morph-runtime/blue/playback#stopMorphing', error);
    }
    runtimeState.morph.exactStartPending = false;
    runtimeState.morph.boundaryPaintPending = false;
    runtimeState.morph.paused = false;
    runtimeState.morph.pausedByOrangeProject = false;
    runtimeState.morph.pausedByGreenProject = false;

    state.layers.forEach((layer) => {
      if (layer?.profileMode === 'spline' && isPreSampledSplineLayer(layer)) {
        invalidateLayerGeometry(layer, 'legacy-geometry-control');
      }
    });

    if (!runtimeState.minimalMorph?.active) flushPendingWebSwitchIfMorphStopped();
    webRuntime.corners.clear();
    webRuntime.transitionByLayer.clear();
    webRuntime.desiredVisibilityByLayer.clear();
    runtimeState.morph.pauseStartedAt = 0;
    runtimeState.morph.webUiHoldStart = 0;
    runtimeState.morph.manualProfileEditing = false;
    runtimeState.morph.sourceProfiles = [];
    runtimeState.morph.targetProfiles = [];
    runtimeState.morph.sourceVisuals = [];
    runtimeState.morph.targetVisuals = [];
    runtimeState.morph.fillPhaseEndpoints = [];
    runtimeState.morph.sourceGeometry = [];
    runtimeState.morph.targetGeometry = [];
    runtimeState.morph.renderSourceLayers = [];
    runtimeState.morph.renderTargetLayers = [];
    runtimeState.morph.lastFrameUpdate = 0;
    runtimeState.morph.lightScales = [];
    runtimeState.morph.lightRotations = [];
    runtimeState.morph.lightLayers = [];
    runtimeState.morph.lightDrawData = [];
    runtimeState.morph.lightGeometryBucket = -1;
    runtimeState.morph.runtimeProfiles = [];
    runtimeState.morph.sourceColorHsl = [];
    runtimeState.morph.targetColorHsl = [];
    runtimeState.morph.sourceFillColorHsl = [];
    runtimeState.morph.targetFillColorHsl = [];
    runtimeState.morph.sourceFillIndices = [];
    runtimeState.morph.orbitCopyMemory = [];
    runtimeState.morph.nextTopologyPlan = null;
    runtimeState.morph.fillSplitAheadCounts = [];
    runtimeState.morph.frameLayers = [];
    runtimeState.morph.spiralBezierRailCounts = [];
    runtimeState.morph.gpuPhaseHandoffT = 0;
    runtimeState.morph.spiralRotationCompensationBaseDeg = 0;
    runtimeState.morph.spiralRotationCompensationPhaseDeg = 0;
    runtimeState.morph.spiralRotationCompensationParticipants = 0;
    runtimeState.morph.spiralRotationCompensationAnchorIndex = -1;
    runtimeState.morph.spiralRotationCompensationAnchorId = '';
    runtimeState.morph.spiralRotationCompensationAnchorRadius = 0;
    runtimeState.morph.frameGlobalHueOffset = normalizePlaylistHueOffset(state.playlistPaletteHueOffset);
    lampMotionRuntime.blueMorph.clear();
    document.getElementById('btnMorph')?.classList.remove('active', 'paused');
    const btn = document.getElementById('btnMorph');
    if (btn) {
      btn.title = 'Включить морфинг профилей';
      btn.setAttribute('aria-label', 'Включить морфинг профилей');
    }
    const status = document.getElementById('infoSuborbits');
    if (status) status.dataset.morph = '';
    if (restoreOrigin) {
      state.playlistPaletteHueOffset = normalizePlaylistHueOffset(runtimeState.morph.originGlobalHueOffset);
      const wantedId = runtimeState.morph.originActiveLayerId;
      if (wantedId && state.layers.some((layer) => layer.id === wantedId)) state.activeLayerId = wantedId;
      const preset = document.getElementById('presetSelect');
      if (preset) preset.value = runtimeState.morph.originPresetValue || preset.value || '';
      syncPlaylistPaletteHueOffsetUI();
    }
    clearMorphOrigin(runtimeState.morph);
    // TAP не должен принять фазы Blue за правку слоя и повторить переход (см. seedLayers).
    window.SomataTestMorph?.seedLayers?.(state.layers);
    syncSidebarInputs();
    renderProfileEditor();
    requestMainCanvasRender();
    return true;
  };

  setActiveStopMorphing(stopMorphing);
  setActiveRebaseMorphing(rebaseMorphCycle);
  window.__somataMorphFreezeContext = () => ({
    blue: {
      active: runtimeState.morph?.active === true,
      paused: runtimeState.morph?.paused === true,
      mode: state.morph?.mode || null,
      progress: Number((runtimeState.morph?.progress || 0).toFixed?.(4) ?? runtimeState.morph?.progress) || 0,
      gpuPreparing: runtimeState.morph?.gpuPhasePreparing === true,
      gpuWarming: runtimeState.morph?.gpuPhaseWarming === true,
      prepareSerial: Number(runtimeState.morph?.gpuPhasePrepareSerial) || 0,
      stallCompensatedMs:
        Number(
          (runtimeState.morph?.timelineStallCompensationMs || 0).toFixed?.(1) ??
            runtimeState.morph?.timelineStallCompensationMs,
        ) || 0,
      stallCount: Number(runtimeState.morph?.timelineStallCompensationCount) || 0,
      lastStallAdvanceMs:
        Number(
          (runtimeState.morph?.lastTimelineStallAdvanceMs || 0).toFixed?.(1) ??
            runtimeState.morph?.lastTimelineStallAdvanceMs,
        ) || 0,
    },
    minimal: {
      active: runtimeState.minimalMorph?.active === true,
      paused: runtimeState.minimalMorph?.paused === true,
      mode: state.minimalMorph?.mode || 'standard',
    },
    project: {
      active: runtimeState.projectMorph?.active === true,
      progress:
        Number(
          (runtimeState.projectMorph?.progress || 0).toFixed?.(4) ?? runtimeState.projectMorph?.progress,
        ) || 0,
      transitionProgress:
        Number(
          (runtimeState.projectMorph?.transitionProgress || 0).toFixed?.(4) ??
            runtimeState.projectMorph?.transitionProgress,
        ) || 0,
      gpuPreparing: runtimeState.projectMorph?.gpuPhasePreparing === true,
      prepareSerial: Number(runtimeState.projectMorph?.gpuPhasePrepareSerial) || 0,
    },
    spiral: {
      type: getSpiralMorphType(),
      corridorPhase: spiralMorphUsesCorridorPhase(),
    },
    layers: Array.isArray(state.layers) ? state.layers.length : 0,
  });

  const syncMinimalMorphTimingFromUI = () => {
    const intervalEl = document.getElementById('minimalMorphInterval');
    const fadeEl = document.getElementById('minimalMorphFade');
    const instantEl = document.getElementById('minimalMorphInstant');
    const fadeRow = document.getElementById('minimalMorphFadeRow');
    const autoInterval = isTapMorphSyncActive('minimal');
    const interval = autoInterval
      ? Math.max(0.5, Math.min(120, Number(state.minimalMorph.intervalSec) || 5))
      : Math.max(0.5, Math.min(120, Number(intervalEl?.value) || state.minimalMorph.intervalSec || 5));
    const fade = Math.max(0.1, Math.min(30, Number(fadeEl?.value) || state.minimalMorph.fadeSec || 0.1));
    const instant = instantEl ? instantEl.checked : state.minimalMorph.instantSwitch !== false;
    state.minimalMorph.intervalSec = interval;
    state.minimalMorph.fadeSec = fade;
    state.minimalMorph.instantSwitch = instant;
    if (intervalEl)
      intervalEl.value = formatDisplayNumber(autoInterval ? getTapTempoIntervalSec(interval) : interval, 2);
    if (fadeEl) {
      fadeEl.value = formatDisplayNumber(fade, 1);
      fadeEl.disabled = instant;
    }
    fadeRow?.classList.toggle('shape-disabled', instant);
  };

  const rebaseFullMorphAfterOrangeSwitch = () => {
    const blueRt = runtimeState.morph;
    if (!blueRt.active) return false;
    const now = performance.now();
    const transition = SpiroMorphController.beginBlueRebase(now, 'orange-commit-rebase');

    prepareMorphCycle(now);
    const keepManualPause = transition.keepManualPause === true;
    SpiroMorphController.completeBlueRebase(keepManualPause, now);
    state.morphPlayback.lastType = 'full';

    const morphBtn = document.getElementById('btnMorph');
    morphBtn?.classList.toggle('paused', keepManualPause);
    if (morphBtn)
      morphBtn.title = keepManualPause
        ? 'Морфинг — пауза (Пробел — продолжить)'
        : 'Остановить морфинг профилей';
    if (!keepManualPause) animationScheduler.add('morph', animateMorph);
    requestMainCanvasRender();
    return true;
  };

  // Orange replaces the authored composition with fresh layer IDs. Audio Link
  // is intentionally keyed by authored layer ID, not by a transient Morph
  // carrier. Transfer those user-authored links by slot *before* replacing
  // state.layers, otherwise ensureAudioRoutingState() prunes the old IDs.
  // Master routes and independent routing settings remain untouched.
  const preserveOrangeAudioRoutes = (sourceLayers, targetLayers) => {
    // The dice and Orange Morph replace the complete layer collection.
    // Unlike the Add Layer button, that path previously copied the first
    // layer's LOW routes into every newly generated slot.
    if (!Array.isArray(sourceLayers) || !Array.isArray(targetLayers)) return;
    // Initialise the OLD collection before exchanging its IDs. Otherwise
    // the first Orange click could lose the default routes altogether.
    ensureAudioRoutingState();
    const ar = state.audioReactive;
    const current = ar.routes.layers,
      enabled = ar.layerSignalEnabled || {};
    const nextRoutes = {},
      nextEnabled = {};
    let nextTarget = ar.routingTarget || 'master';
    for (let i = 0; i < targetLayers.length; i++) {
      const target = targetLayers[i];
      if (!target?.id) continue;
      const source = sourceLayers[i]; // never wrap slot 0 into new slots
      const fromId = source?.id,
        toId = target.id;
      const expected = routeBandForLayerIndex(i);
      target.audioNativeBand = expected;
      target.audioNativeBandAuto = true;
      if (fromId && Array.isArray(current[fromId])) {
        const oldNative = source.audioNativeBand;
        nextRoutes[toId] = current[fromId].map((route) => {
          const copied = { ...route };
          // Retarget only the automatic frequency of this source
          // layer; manually chosen frequencies remain unchanged.
          if (source.audioNativeBandAuto === true && copied.band === oldNative) copied.band = expected;
          return copied;
        });
      } else if (Array.isArray(current[toId])) {
        nextRoutes[toId] = current[toId].map((route) => ({ ...route }));
      }
      // A new slot deliberately has no entry in nextRoutes: once the
      // generated layers are installed, ensureAudioRoutingState()
      // creates its preset links with the correct native frequency.
      if (fromId && Object.prototype.hasOwnProperty.call(enabled, fromId))
        nextEnabled[toId] = enabled[fromId];
      else if (Object.prototype.hasOwnProperty.call(enabled, toId)) nextEnabled[toId] = enabled[toId];
      if (fromId && nextTarget === fromId) nextTarget = toId;
    }
    ar.routes.layers = nextRoutes;
    ar.layerSignalEnabled = nextEnabled;
    ar.routingTarget = nextTarget;
  };

  // Orange regenerates authored geometries, not the user's visibility intent.
  // Match composition slots rather than IDs (new Orange layers have new IDs).
  // This is deliberately limited to layer/Line visibility: generated Fill,
  // Web and Lamp recipes retain their authored design unless the user
  // explicitly changed their effect override.
  const preserveOrangeLayerVisibility = (sourceLayers, targetLayers) => {
    if (!Array.isArray(sourceLayers) || !sourceLayers.length || !Array.isArray(targetLayers))
      return targetLayers;
    for (let i = 0; i < targetLayers.length; i++) {
      const target = targetLayers[i];
      const source = sourceLayers[i] || sourceLayers[i % sourceLayers.length];
      if (!target || !source) continue;
      target.lineVisible = source.lineVisible !== false;
      target.visible = source.visible !== false;
    }
    return targetLayers;
  };
  const carryOrangeLineToggleMemory = (sourceLayers, targetLayers) => {
    const old = state.sidebarFeatureToggleMemory;
    const lines = old?.lines;
    if (!lines?.armed || !Array.isArray(lines.layerIds)) return null;
    const active = new Set(lines.layerIds);
    return {
      armed: true,
      layerIds: targetLayers
        .filter((layer, i) => layer && active.has(sourceLayers[i]?.id))
        .map((layer) => layer.id),
    };
  };

  const commitMinimalMorphTarget = () => {
    const mm = state.minimalMorph,
      mmRt = runtimeState.minimalMorph;
    if (!mmRt.targetLayers?.length) return;

    window.__somataApplyOrangeGlobalTargets?.(mmRt.targetLayers.__somataOrangeGlobalTargets);
    preserveOrangeLayerVisibility(state.layers, mmRt.targetLayers);
    const orangeLineMemory = carryOrangeLineToggleMemory(state.layers, mmRt.targetLayers);
    preserveOrangeAudioRoutes(state.layers, mmRt.targetLayers);
    state.layers = mmRt.targetLayers.slice();
    ensureAudioRoutingState(); // create native-band routes for newly generated slots
    state.activeLayerId = state.layers[0]?.id || null;
    state.sidebarFeatureToggleMemory = orangeLineMemory ? { lines: orangeLineMemory } : {};
    document.getElementById('presetSelect').value = '';

    animationScheduler.afterNextPaint('minimal-morph-ui-sync', () => {
      setTimeout(() => {
        updateLayerListUI();
        syncSidebarInputs();
        renderProfileEditor();
      }, 0);
    });
  };

  const MINIMAL_GRAFFITI_KEYS = [
    'lineProfileApplication',
    'lineProfile',
    'lineProfileStroke',
    'lineProfileGraffiti',
    'graffitiAngle',
    'graffitiAngleMode',
    'graffitiNibShape',
    'graffitiNibLength',
    'graffitiNibLengthMultiplier',
    'graffitiVariationMode',
    'graffitiVariationEveryN',
    'graffitiSizeVariationEnabled',
    'graffitiSizeVariation',
    'graffitiSizeFocus',
    'graffitiRotationVariationEnabled',
    'graffitiRotationVariation',
    'graffitiRotationMultiplier',
    'graffitiRotationFocus',
    'graffitiBaseStrokeWidth',
  ];
  function enforceOrangeLampAdaptiveBrightness(layers) {
    for (const layer of Array.isArray(layers) ? layers : []) {
      if (!layer) return;
      ensureLayerEffectState(layer);
      if (!getLayerLampsEnabled(layer)) continue;
      const lamps = ensureLayerLampState(layer);
      lamps.adaptiveBrightness = true;
      lamps.adaptiveAdjustBrightness = true;
      lamps.adaptiveStrength = Math.max(80, Number(lamps.adaptiveStrength) || 100);
    }
    return layers;
  }
  function applyOrangeFeatureOverrides(layers) {
    const overrides = state.minimalMorph?.featureOverrides;
    if (!overrides || typeof overrides !== 'object') return layers;
    for (const layer of Array.isArray(layers) ? layers : []) {
      if (!layer) continue;
      ensureLayerEffectState(layer);
      for (const [mode, on] of Object.entries(overrides)) {
        if (typeof on !== 'boolean') continue;
        // Line style is stored per authored layer. Never let an old global
        // sidebar toggle turn a one-layer Graffiti choice into Point (or vice versa).
        if (mode === 'graffiti') continue;
        if (['lamps', 'web', 'glint', 'lightning', 'particles'].includes(mode))
          setSidebarFeatureEnabled(mode, layer, on);
      }
    }
    return layers;
  }
  const preserveMinimalMorphEffects = (targetLayers, sourceLayers = state.layers) => {
    if (!Array.isArray(targetLayers) || !targetLayers.length) return targetLayers;
    // Already projected from authored layers. Legacy effect inheritance
    // and curated static enforcement would silently overwrite settings
    // which are not present in the Orange parameter matrix.
    if (targetLayers.__somataOrangeExplicitRoutes === true) return targetLayers;
    const curatedStatic = String(state.minimalMorph?.generatorStyle || 'standard') !== 'standard';
    // Preserve the user's per-slot choice of Line/Graffiti across new Orange IDs.
    // The Orange generator changes geometry, not the authored appearance mode.
    const sourceSlots = Array.isArray(sourceLayers) && sourceLayers.length ? sourceLayers : state.layers;
    targetLayers.forEach((target, i) => {
      const source = sourceSlots[i];
      if (!target || !source) return;
      target.lineProfileApplication = source.lineProfileApplication === 'graffiti' ? 'graffiti' : 'stroke';
      if (target.lineProfileApplication === 'graffiti') {
        for (const key of MINIMAL_GRAFFITI_KEYS) {
          if (Object.prototype.hasOwnProperty.call(source, key)) target[key] = cloneEffectConfig(source[key]);
        }
      }
    });
    if (curatedStatic) {
      // Curated Orange 7.11.1 presets own the complete generated composition.
      // Do not inherit animated effects from the previous scene; keep only the
      // static Web/Lamps authored by the recipe itself.
      targetLayers.forEach((layer) => {
        if (!layer) return;
        ensureLayerEffectState(layer);
        if (layer.motionRotation) layer.motionRotation.enabled = false;
        if (layer.lineMotionFx) {
          layer.lineMotionFx.enabled = false;
          layer.lineMotionFx.speedPercent = 0;
        }
        if (layer.sprite) {
          layer.sprite.enabled = false;
          layer.sprite.speedPercent = 0;
        }
        if (layer.particles) {
          layer.particles.enabled = false;
          layer.particles.speedPercent = 0;
        }
        if (layer.sweep) {
          layer.sweep.enabled = false;
          layer.sweep.glintEnabled = false;
          layer.sweep.lightningEnabled = false;
        }
        if (layer.web) layer.web.oscillating = false;
        if (layer.lamps) {
          layer.lamps.freezeLight = false;
          layer.lamps.freezeRain = false;
        }
      });
      enforceOrangeLampAdaptiveBrightness(targetLayers);
      applyOrangeFeatureOverrides(targetLayers);
      return targetLayers;
    }
    const sources = Array.isArray(sourceLayers) && sourceLayers.length ? sourceLayers : state.layers;
    const fallbackSource = sources[0] || null;
    targetLayers.forEach((layer, idx) => {
      const src = sources[idx] || sources[idx % sources.length] || fallbackSource;
      if (!src) return;
      ensureLayerEffectState(src);
      ensureLayerEffectState(layer);

      layer.showLamps = getLayerLampsEnabled(src);
      layer.lamps = cloneEffectConfig(ensureLayerLampState(src));
      layer.showWeb = getLayerWebEnabled(src);
      layer.web = cloneEffectConfig(getLayerWebConfig(src));
      layer.sweep = cloneEffectConfig(getLayerSweepConfig(src));
      for (const key of MINIMAL_GRAFFITI_KEYS) {
        if (Object.prototype.hasOwnProperty.call(src, key)) layer[key] = cloneEffectConfig(src[key]);
      }
      effectStateReadyLayers.delete(layer);
      ensureLayerEffectState(layer);
      // Routing is authoritative for an explicitly added Orange parameter.
      // Restore its *same random sample* after copying effect state from source.
      for (const [path, value] of layer.__somataOrangeSampledEffects || []) {
        window.SomataParameterRegistry?.applyPath?.(layer, path, cloneEffectConfig(value));
      }
    });
    enforceOrangeLampAdaptiveBrightness(targetLayers);
    applyOrangeFeatureOverrides(targetLayers);
    return targetLayers;
  };

  const prepareMinimalMorphLampPointCache = (layers, drawData) => {
    const list = Array.isArray(layers) ? layers : [];
    const result = new Array(list.length);
    for (let i = 0; i < list.length; i++) {
      const layer = list[i];
      if (!layer || !getLayerLampsEnabled(layer)) {
        result[i] = null;
        continue;
      }
      const cfg = ensureLayerLampState(layer);
      result[i] = withLampConfig(cfg, () => collectStaticLampPoints(layer, drawData?.[i] || undefined, 240));
    }
    return result;
  };

  const beginMinimalMorphTransition = (now = performance.now(), force = false) => {
    const mm = state.minimalMorph,
      mmRt = runtimeState.minimalMorph;
    if (!mmRt.active) return;
    if (hasOrangeColorRoute()) {
      if (!force) cyclePlaylistPaletteForContext('yellow');
      else if (morphPaletteSyncEnabled())
        setMorphPaletteForContext('yellow', state.randomOptions.lineColorPalette);
    }
    syncMinimalMorphTimingFromUI();
    if (mmRt.transitioning) {
      if (!force) return;
      commitMinimalMorphTarget();
      mmRt.transitioning = false;
    }

    commitCurrentBlueVisualToCanonical();
    activePauseFullMorphForProjectOrange();
    state.randomLayerCount = Math.max(
      1,
      Math.min(
        8,
        parseInt(document.getElementById('randomLayerCount')?.value, 10) || state.randomLayerCount || 3,
      ),
    );

    captureMorphOrigin(mmRt);

    const liveSourceLayers = state.layers;
    const targetLayers = preserveOrangeLayerVisibility(
      liveSourceLayers,
      preserveMinimalMorphEffects(
        createOrangeComposition(state.randomLayerCount, state.minimalMorph?.mode),
        liveSourceLayers,
      ),
    );

    mmRt.fadeStart = now;
    mmRt.progress = 0;
    mmRt.nextSwitchAt = isTapMorphSyncActive('minimal')
      ? getNextTapBoundary(now, 'minimal')
      : now + getTapMorphIntervalSec(mm.intervalSec, 'minimal') * 1000;

    if (mm.instantSwitch) {
      mmRt.sourceLayers = [];
      mmRt.sourceDrawData = [];
      mmRt.sourceLampPoints = [];
      mmRt.targetLayers = targetLayers;
      mmRt.targetDrawData = [];
      mmRt.targetLampPoints = [];
      mmRt.transitioning = true;
      commitMinimalMorphTarget();
      mmRt.transitioning = false;
      rebaseFullMorphAfterOrangeSwitch();
      mmRt.sourceLayers = [];
      mmRt.targetLayers = [];
      mmRt.sourceDrawData = [];
      mmRt.targetDrawData = [];
      mmRt.sourceLampPoints = [];
      mmRt.targetLampPoints = [];
      requestMainCanvasRender();
      return;
    }

    mmRt.sourceDrawData = liveSourceLayers.map((layer) => getCachedLayerDrawData(layer));
    mmRt.sourceLayers = liveSourceLayers.map((layer) => ({
      ...layer,
      profileNodes: (layer.profileNodes || []).map((p) => ({ ...p })),
    }));

    mmRt.targetLayers = targetLayers;
    mmRt.targetDrawData = targetLayers.map((layer) => getCachedLayerDrawData(layer));
    mmRt.sourceLampPoints = prepareMinimalMorphLampPointCache(mmRt.sourceLayers, mmRt.sourceDrawData);
    mmRt.targetLampPoints = prepareMinimalMorphLampPointCache(mmRt.targetLayers, mmRt.targetDrawData);
    mmRt.transitioning = true;
    requestMainCanvasRender();
  };

  const minimalMorphFrame = (now) => {
    const mm = state.minimalMorph,
      mmRt = runtimeState.minimalMorph;
    if (!mmRt.active || mmRt.paused) {
      mmRt.raf = 0;
      return false;
    }
    mmRt.raf = 0;

    if (mmRt.transitioning) {
      // Visibility switches during a Fade must affect both live carriers,
      // not only the next committed authored composition.
      preserveOrangeLayerVisibility(state.layers, mmRt.sourceLayers);
      preserveOrangeLayerVisibility(state.layers, mmRt.targetLayers);
      const fadeMs = Math.max(100, mm.fadeSec * 1000);
      const linear = Math.max(0, Math.min(1, (now - mmRt.fadeStart) / fadeMs));

      mmRt.progress = linear * linear * (3 - 2 * linear);
      requestMainCanvasRender();
      if (linear >= 1) {
        commitMinimalMorphTarget();
        mmRt.transitioning = false;
        rebaseFullMorphAfterOrangeSwitch();
        mmRt.progress = 0;
        mmRt.sourceLayers = [];
        mmRt.targetLayers = [];
        mmRt.sourceDrawData = [];
        mmRt.targetDrawData = [];
        mmRt.sourceLampPoints = [];
        mmRt.targetLampPoints = [];
        requestMainCanvasRender();
      }
    }

    if (!mmRt.transitioning && now >= mmRt.nextSwitchAt) {
      beginMinimalMorphTransition(now);
      applyPendingWebSwitchAtMorphBoundary();
    }
    return mmRt.active && !mmRt.paused;
  };

  const stopMinimalMorphing = (restoreOrigin = true) => {
    const mm = state.minimalMorph,
      mmRt = runtimeState.minimalMorph;
    if (!mmRt.active && !mmRt.transitioning) return false;
    mmRt.active = false;
    mmRt.paused = false;
    if (!runtimeState.morph?.active) flushPendingWebSwitchIfMorphStopped();
    webRuntime.corners.clear();
    webRuntime.transitionByLayer.clear();
    webRuntime.desiredVisibilityByLayer.clear();
    mmRt.pauseStartedAt = 0;
    mmRt.webUiHoldStart = 0;
    mmRt.transitioning = false;
    mmRt.progress = 0;
    mmRt.nextSwitchAt = 0;
    mmRt.fadeStart = 0;
    mmRt.sourceLayers = [];
    mmRt.targetLayers = [];
    mmRt.sourceDrawData = [];
    mmRt.targetDrawData = [];
    mmRt.sourceLampPoints = [];
    mmRt.targetLampPoints = [];
    animationScheduler.remove('minimalMorph');
    animationScheduler.remove('minimal-morph-arm');
    animationScheduler.remove('minimal-morph-ui-sync');
    mmRt.raf = 0;
    const btn = document.getElementById('btnMinimalMorph');
    btn?.classList.remove('active', 'paused');
    btn?.setAttribute('aria-pressed', 'false');
    btn?.setAttribute('aria-label', 'Включить слайдшоу');
    btn && (btn.title = 'Слайдшоу');
    if (restoreOrigin) {
      // restoreMorphOrigin() refreshes the UI and can prune unknown Audio
      // layer IDs, so rebind to the restored IDs *before* that refresh.
      preserveOrangeLayerVisibility(state.layers, mmRt.originLayers);
      const restoredLineMemory = carryOrangeLineToggleMemory(state.layers, mmRt.originLayers);
      preserveOrangeAudioRoutes(state.layers, mmRt.originLayers);
      restoreMorphOrigin(mmRt);
      if (restoredLineMemory)
        state.sidebarFeatureToggleMemory = { ...state.sidebarFeatureToggleMemory, lines: restoredLineMemory };
    }
    clearMorphOrigin(mmRt);
    if (runtimeState.morph.active && runtimeState.morph.pausedByOrangeProject === true) {
      rebaseFullMorphAfterOrangeSwitch();
    }
    renderMainCanvas();
    return true;
  };
  setActiveStopMinimalMorphing(stopMinimalMorphing);

  const startMinimalMorphing = (_preserveFullMorph = true) => {
    if (runtimeState.minimalMorph.active) return;
    syncMinimalMorphTimingFromUI();
    const mm = state.minimalMorph,
      mmRt = runtimeState.minimalMorph;
    mmRt.active = true;
    mmRt.paused = false;
    mmRt.pauseStartedAt = 0;
    mmRt.webUiHoldStart = 0;
    state.morphPlayback.lastType = 'minimal';
    mmRt.transitioning = false;
    mmRt.nextSwitchAt = 0;
    const btn = document.getElementById('btnMinimalMorph');
    btn?.classList.add('active');
    btn?.setAttribute('aria-pressed', 'true');
    btn?.setAttribute('aria-label', 'Остановить слайдшоу');
    btn && (btn.title = 'Остановить слайдшоу');

    requestMainCanvasRender();
    animationScheduler.afterNextPaint('minimal-morph-arm', () => {
      setTimeout(() => {
        if (!mmRt.active || mmRt.paused) return;
        beginMinimalMorphTransition(performance.now());
        animationScheduler.add('minimalMorph', minimalMorphFrame);
      }, 0);
    });
  };

  setActiveStartMinimalMorphing(startMinimalMorphing);
  setActiveRebaseMinimalMorphing(() => {
    if (!runtimeState.minimalMorph.active) return false;
    runtimeState.minimalMorph.transitioning = false;
    runtimeState.minimalMorph.progress = 0;
    beginMinimalMorphTransition(performance.now(), true);
    return true;
  });

  setActivePauseFullMorphForProjectOrange(() => {
    if (!runtimeState.morph.active) return false;
    const result = SpiroMorphController.pauseBlueForOrange(performance.now());
    if (runtimeState.morph.paused === true) animationScheduler.remove('morph-owner');
    const morphBtn = document.getElementById('btnMorph');
    morphBtn?.classList.add('paused');
    if (morphBtn)
      morphBtn.title = result.manualPause
        ? 'Морфинг — пауза (Пробел — продолжить)'
        : 'Морфинг — оранжевый переключает фигуру';
    requestMainCanvasRender();
    return result.changed || result.manualPause;
  });

  setActiveResumeFullMorphFromProjectOrange(() => {
    if (runtimeState.minimalMorph.active && runtimeState.minimalMorph.transitioning) return false;
    if (
      !runtimeState.morph.active ||
      !runtimeState.morph.paused ||
      runtimeState.morph.pausedByOrangeProject !== true
    ) {
      runtimeState.morph.pausedByOrangeProject = false;
      return false;
    }
    const now = performance.now();
    const pausedFor = Math.max(0, now - (runtimeState.morph.pauseStartedAt || now));
    if (runtimeState.morph.cycleStart) runtimeState.morph.cycleStart += pausedFor;
    if (runtimeState.morph.honestZeroCorridorIntro) {
      runtimeState.morph.honestZeroCorridorIntro.start += pausedFor;
      shiftHonestZeroCorridorIntro(runtimeState.morph.honestZeroCorridorIntro.ids, pausedFor);
    }
    if (runtimeState.morph.honestZeroCorridorOutro) {
      runtimeState.morph.honestZeroCorridorOutro.start += pausedFor;
      runtimeState.morph.honestZeroCorridorOutro.cycleStart += pausedFor;
      shiftHonestZeroCorridorOutro(runtimeState.morph.honestZeroCorridorOutro.ids, pausedFor);
    }
    runtimeState.morph.paused = false;
    runtimeState.morph.pausedByOrangeProject = false;
    runtimeState.morph.pauseStartedAt = 0;
    state.morphPlayback.lastType = 'full';
    const morphBtn = document.getElementById('btnMorph');
    morphBtn?.classList.remove('paused');
    if (morphBtn) morphBtn.title = 'Остановить морфинг профилей';
    animationScheduler.add('morph', animateMorph);
    armBlueMorphOwnerGuard();
    requestMainCanvasRender();
    return true;
  });

  const toggleMinimalMorphing = () => {
    // Instant: keep the current generated composition. Fade: state.layers
    // is the last fully committed composition until a transition completes;
    // stopping mid-fade discards the unfinished target, not the entire session.
    if (runtimeState.minimalMorph.active) stopMinimalMorphing(false);
    else startMinimalMorphing(true);
    syncMorphProfileUI?.();
  };

  const blueMorphOwnerGuard = () => {
    const rt = runtimeState.morph;
    if (!rt?.active || rt.paused === true || rt.pausedByOrangeProject === true) return false;
    if (animationScheduler.has('morph') || animationScheduler.hasAfterPaint?.('morph-arm') === true)
      return true;
    activeEnsureFullMorphSchedulerOwnership('morph-owner-guard');
    return rt.active === true && rt.paused !== true && rt.pausedByOrangeProject !== true;
  };
  const armBlueMorphOwnerGuard = () => {
    if (
      runtimeState.morph?.active === true &&
      runtimeState.morph?.paused !== true &&
      runtimeState.morph?.pausedByOrangeProject !== true
    )
      animationScheduler.add('morph-owner', blueMorphOwnerGuard);
  };

  const startMorphing = () => {
    if (runtimeState.morph.active) return;
    captureBlueStablePoint(runtimeState.morph);
    state.morph.pauseOnSpace = document.getElementById('morphPauseOnSpace')?.checked === true;
    if (!isTapMorphSyncActive('full')) {
      state.morph.intervalSec = Math.max(
        0.5,
        Math.min(60, parseFloat(document.getElementById('morphInterval').value) || 5),
      );
    }
    document.getElementById('morphInterval').value = formatDisplayNumber(
      isTapMorphSyncActive('full')
        ? getTapTempoIntervalSec(state.morph.intervalSec)
        : state.morph.intervalSec,
      2,
    );
    const miMult = document.getElementById('morphIntervalMultiplier');
    if (miMult && document.activeElement !== miMult)
      miMult.value = formatDisplayNumber(getMorphIntervalMultiplier('full'), 6);
    state.morph.diversity = document.getElementById('morphDiversity')?.checked === true;
    syncMorphIntervalQuickButtons();
    setUnifiedMorphMode(document.getElementById('morphMode')?.value || getUnifiedMorphMode());
    state.morph.spiralRotationCompensation =
      document.getElementById('morphSpiralRotationCompensation')?.checked === true;
    const vertexRange = normalizeMorphVertexRangeValues(
      document.getElementById('morphVertexMin')?.value,
      document.getElementById('morphVertexMax')?.value,
      document.getElementById('morphVertexMultiplier')?.value,
    );
    state.morph.vertexMultiplier = vertexRange.multiplier;
    state.morph.vertexMin = vertexRange.minN;
    state.morph.vertexMax = vertexRange.maxN;
    document.getElementById('morphVertexMin').value = vertexRange.minN;
    document.getElementById('morphVertexMax').value = vertexRange.maxN;
    if (document.getElementById('morphVertexMultiplier'))
      document.getElementById('morphVertexMultiplier').value = vertexRange.multiplier;
    const roundingMinParsed = parseInt(document.getElementById('morphRoundingMin').value, 10);
    const roundingMaxParsed = parseInt(document.getElementById('morphRoundingMax').value, 10);
    let roundingMin = Math.max(
      0,
      Math.min(MAX_ROUNDING_PERCENT, Number.isFinite(roundingMinParsed) ? roundingMinParsed : 0),
    );
    let roundingMax = Math.max(
      roundingMin,
      Math.min(MAX_ROUNDING_PERCENT, Number.isFinite(roundingMaxParsed) ? roundingMaxParsed : 30),
    );
    state.morph.roundingMin = roundingMin;
    state.morph.roundingMax = roundingMax;
    document.getElementById('morphRoundingMin').value = roundingMin;
    document.getElementById('morphRoundingMax').value = roundingMax;
    let stepMin = Math.max(
      0,
      Math.min(100, parseInt(document.getElementById('morphStepMin').value, 10) || 0),
    );
    let stepMax = Math.max(
      stepMin,
      Math.min(100, parseInt(document.getElementById('morphStepMax').value, 10) || 100),
    );
    state.morph.stepMin = stepMin;
    state.morph.stepMax = stepMax;
    document.getElementById('morphStepMin').value = stepMin;
    document.getElementById('morphStepMax').value = stepMax;
    let strokeWidthMin = Math.max(
      0.5,
      Math.min(20, parseFloat(document.getElementById('morphStrokeWidthMin')?.value) || 0.5),
    );
    let strokeWidthMax = Math.max(
      strokeWidthMin,
      Math.min(20, parseFloat(document.getElementById('morphStrokeWidthMax')?.value) || 2),
    );
    state.morph.strokeWidthMin = strokeWidthMin;
    state.morph.strokeWidthMax = strokeWidthMax;
    document.getElementById('morphStrokeWidthMin').value = strokeWidthMin;
    document.getElementById('morphStrokeWidthMax').value = strokeWidthMax;
    state.morph.speedType = document.getElementById('morphSpeedType')?.value || 'linear';
    state.morph.sizeVariation = Math.round(
      Math.max(
        0,
        Math.min(
          100,
          Number(document.getElementById('morphSizeVariation')?.value ?? state.morph.sizeVariation) || 0,
        ),
      ),
    );
    state.morph.sizeVariationMultiplier = Math.max(
      0,
      Number(
        document.getElementById('morphSizeVariationMultiplier')?.value ?? state.morph.sizeVariationMultiplier,
      ) || 0,
    );
    state.morph.normalizeSizes = document.getElementById('morphNormalizeSizes')?.checked !== false;
    state.morph.rotationMinPercent = Math.round(
      Math.max(
        0,
        Math.min(
          100,
          Number(document.getElementById('morphRotationMin')?.value ?? state.morph.rotationMinPercent) || 0,
        ),
      ),
    );
    state.morph.rotationMaxPercent = Math.round(
      Math.max(
        state.morph.rotationMinPercent,
        Math.min(
          100,
          Number(document.getElementById('morphRotationMax')?.value ?? state.morph.rotationMaxPercent) || 0,
        ),
      ),
    );
    state.morph.rotationMultiplier = Math.max(
      0,
      Number(document.getElementById('morphRotationMultiplier')?.value ?? state.morph.rotationMultiplier) ||
        0,
    );
    state.morph.rotationRandomDirection =
      document.getElementById('morphRotationRandomDirection')?.checked !== false;
    state.morph.fadePercent = Math.round(
      Math.max(
        0,
        Math.min(
          100,
          Number(document.getElementById('morphFadePercentValue')?.value ?? state.morph.fadePercent) || 0,
        ),
      ),
    );
    runtimeState.morph.spiralRotationCompensationBaseDeg = 0;
    runtimeState.morph.spiralRotationCompensationPhaseDeg = 0;
    runtimeState.morph.spiralRotationCompensationParticipants = 0;
    runtimeState.morph.spiralRotationCompensationAnchorIndex = -1;
    runtimeState.morph.spiralRotationCompensationAnchorId = '';
    runtimeState.morph.spiralRotationCompensationAnchorRadius = 0;
    runtimeState.morph.spiralBezierRailCounts = [];
    runtimeState.morph.gpuPhaseHandoffT = 0;
    runtimeState.morph.progress = 0;
    runtimeState.morph.geometryT = 0;
    runtimeState.morph.geometryBlend = 0;
    runtimeState.morph.timelineStallCompensationMs = 0;
    runtimeState.morph.lastTimelineStallCompensationMs = 0;
    runtimeState.morph.lastTimelineStallAdvanceMs = 0;
    runtimeState.morph.timelineStallCompensationCount = 0;
    try {
      invalidateGpuSpiralBezierMorphResources?.('new-morph-run');
    } catch (error) {
      noteSuppressedError('morph-runtime/blue/playback#startMorphing', error);
    }
    runtimeState.morph.splineCommitBridge = new WeakMap();
    runtimeState.morph.orderCompletedPhases = 0;
    runtimeState.morph.orderHoldHistory = new Map();
    runtimeState.morph.active = true;
    syncBlueMorphParameterDecorations();
    armBlueMorphOwnerGuard();
    runtimeState.morph.orbitCopyMemory = [];
    runtimeState.morph.nextTopologyPlan = null;
    runtimeState.morph.fillSplitAheadCounts = [];
    runtimeState.morph.paused = false;
    runtimeState.morph.pausedByGreenProject = false;
    runtimeState.morph.pauseStartedAt = 0;
    state.morphPlayback.lastType = 'full';
    runtimeState.morph.manualProfileEditing = false;
    runtimeState.morph.cycleStart = 0;
    runtimeState.morph.gpuSpecializedSpiralReady = false;
    runtimeState.morph.webUiHoldStart = 0;
    runtimeState.morph.lastEditorPaint = 0;

    runtimeState.morph.exactStartPending = true;
    const btn = document.getElementById('btnMorph');
    btn.classList.add('active');
    btn.title = 'Остановить морфинг профилей';
    btn.setAttribute('aria-label', 'Остановить морфинг профилей');

    if (runtimeState.minimalMorph.active && runtimeState.minimalMorph.transitioning) {
      activePauseFullMorphForProjectOrange();
      requestMainCanvasRender();
      return;
    }

    prepareMorphCycle(performance.now());

    const startArmSerial = (Math.max(0, Number(runtimeState.morph.startArmSerial) || 0) + 1) >>> 0;
    runtimeState.morph.startArmSerial = startArmSerial;
    requestMainCanvasRender();
    animationScheduler.afterNextPaint('morph-arm', (frameNow) => {
      if (!runtimeState.morph.active || runtimeState.morph.startArmSerial !== startArmSerial) return;
      runtimeState.morph.exactStartPending = false;
      if (runtimeState.minimalMorph.active && runtimeState.minimalMorph.transitioning) {
        activePauseFullMorphForProjectOrange();
        return;
      }
      runtimeState.morph.cycleStart = frameNow;
      runtimeState.morph.progress = 0;
      runtimeState.morph.geometryT = 0;
      runtimeState.morph.geometryBlend = 0;
      animationScheduler.add('morph', animateMorph);
      armBlueMorphOwnerGuard();
    });
    setTimeout(() => {
      const rt = runtimeState.morph;
      if (
        !rt?.active ||
        rt.startArmSerial !== startArmSerial ||
        rt.paused === true ||
        rt.pausedByOrangeProject === true
      )
        return;
      if (animationScheduler.has('morph')) return;

      if (animationScheduler.hasAfterPaint?.('morph-arm') === true) animationScheduler.remove('morph-arm');
      rt.exactStartPending = false;
      if (!Number(rt.cycleStart)) rt.cycleStart = performance.now();
      animationScheduler.add('morph', animateMorph);
      armBlueMorphOwnerGuard();
      requestMainCanvasRender();
      try {
        window.__somataLastMorphOwnershipRecovery = {
          reason: 'morph-start-arm-timeout',
          at: performance.now(),
          projectId: state.playlistCurrentProjectId || null,
        };
      } catch (error) {
        noteSuppressedError('morph-runtime/blue/playback#startMorphing', error);
      }
    }, 180);
  };
  setActiveStartMorphing(startMorphing);
  setActiveEnsureFullMorphSchedulerOwnership((reason = 'ownership-verify') => {
    const rt = runtimeState.morph;
    if (!rt?.active || rt.paused === true || rt.pausedByOrangeProject === true) return false;
    if (animationScheduler.has('morph') || animationScheduler.hasAfterPaint?.('morph-arm') === true)
      return true;

    rt.exactStartPending = false;
    if (!Number(rt.cycleStart)) rt.cycleStart = performance.now();
    animationScheduler.add('morph', animateMorph);
    requestMainCanvasRender();
    try {
      window.__somataLastMorphOwnershipRecovery = {
        reason: String(reason || 'ownership-verify'),
        at: performance.now(),
        projectId: state.playlistCurrentProjectId || null,
      };
    } catch (error) {
      noteSuppressedError('morph-runtime/blue/playback#createMorphPlaybackModule', error);
    }
    return true;
  });

  const pauseMorphPlayback = () => {
    const now = performance.now();
    if (runtimeState.minimalMorph.active && !runtimeState.minimalMorph.paused) {
      const mm = state.minimalMorph,
        mmRt = runtimeState.minimalMorph;
      mmRt.paused = true;
      mmRt.pauseStartedAt = now;
      state.morphPlayback.lastType = 'minimal';
      animationScheduler.remove('minimalMorph');
      mmRt.raf = 0;
      const btn = document.getElementById('btnMinimalMorph');
      btn?.classList.add('paused');
      btn && (btn.title = 'Слайдшоу — пауза (Пробел — продолжить)');
      requestMainCanvasRender();
      return true;
    }
    if (runtimeState.morph.active && !runtimeState.morph.paused) {
      const rt = runtimeState.morph;
      // Space is a stable pause, not a freeze-frame of an intermediate carrier.
      // A half-built Spiral can contain clone/merge branches which are only valid
      // while the timeline owns the Corridor phase.  Snap back to the exact source
      // endpoint of the current phase and resume from that endpoint later.
      animationScheduler.remove('morph-cycle-boundary');
      rt.boundaryPaintPending = false;
      for (const id of rt.honestZeroCorridorIntro?.ids || []) stopHonestZeroCorridorIntro(id);
      for (const id of rt.honestZeroCorridorOutro?.ids || []) stopHonestZeroCorridorOutro(id);
      rt.honestZeroCorridorIntro = null;
      rt.honestZeroCorridorOutro = null;
      rt.cycleStart = now;
      rt.progress = 0;
      rt.geometryT = 0;
      rt.geometryBlend = 0;
      if (Array.isArray(rt.renderSourceLayers) && rt.renderSourceLayers.length) {
        state.layers.forEach((canonical, idx) => {
          const src = rt.renderSourceLayers[idx];
          if (!src || !canonical) return;
          const frame = getOrCreateBlueResolvedFrameLayer(idx, canonical);
          Object.assign(frame, src);
          frame.profileNodes = (src.profileNodes || []).map((p) => ({ ...p }));
          try {
            setPreSampledSplineLayer(frame, isPreSampledSplineLayer(src));
          } catch (error) {
            noteSuppressedError('morph-runtime/blue/playback#pauseMorphPlayback', error);
          }
          frame.visible = canonical.visible !== false;
        });
      }
      try {
        updateSidebarFromMorph(0);
      } catch (error) {
        noteSuppressedError('morph-runtime/blue/playback#pauseMorphPlayback', error);
      }
      rt.paused = true;
      animationScheduler.remove('morph');
      animationScheduler.remove('morph-owner');
      rt.pauseStartedAt = now;
      state.morphPlayback.lastType = 'full';
      const btn = document.getElementById('btnMorph');
      btn?.classList.add('paused');
      btn && (btn.title = 'Морфинг — пауза (Пробел — продолжить)');
      requestMainCanvasRender();
      return true;
    }
    return false;
  };

  const resumeMorphPlayback = () => {
    const now = performance.now();
    if (runtimeState.minimalMorph.active && runtimeState.minimalMorph.paused) {
      const mm = state.minimalMorph,
        mmRt = runtimeState.minimalMorph;
      const pausedFor = Math.max(0, now - (mmRt.pauseStartedAt || now));
      if (mmRt.transitioning && mmRt.fadeStart) mmRt.fadeStart += pausedFor;
      if (mmRt.nextSwitchAt) mmRt.nextSwitchAt += pausedFor;
      mmRt.paused = false;
      mmRt.pauseStartedAt = 0;
      state.morphPlayback.lastType = 'minimal';
      const btn = document.getElementById('btnMinimalMorph');
      btn?.classList.remove('paused');
      btn && (btn.title = 'Остановить слайдшоу');
      animationScheduler.add('minimalMorph', minimalMorphFrame);
      requestMainCanvasRender();
      return true;
    }
    if (runtimeState.morph.active && runtimeState.morph.paused) {
      const pausedFor = Math.max(0, now - (runtimeState.morph.pauseStartedAt || now));
      if (runtimeState.morph.cycleStart) runtimeState.morph.cycleStart += pausedFor;
      runtimeState.morph.paused = false;
      runtimeState.morph.pauseStartedAt = 0;
      state.morphPlayback.lastType = 'full';
      const btn = document.getElementById('btnMorph');
      btn?.classList.remove('paused');
      btn && (btn.title = 'Остановить морфинг профилей');
      animationScheduler.add('morph', animateMorph);
      armBlueMorphOwnerGuard();
      requestMainCanvasRender();
      return true;
    }
    return false;
  };

  const returnBlueMorphToPhaseStart = () => {
    const rt = runtimeState.morph;
    if (!rt.active) return false;
    if (rt.returnToPhaseStart) return true;
    const selected = state.layers.find((layer) => layer.id === state.activeLayerId);
    const cfg = window.SomataTestMorph?.config(selected) || {};
    const cycleSec = getTapMorphIntervalSec(state.morph.intervalSec, 'full');
    const duration = Math.max(
      100,
      (cfg.syncWithMorph ? cycleSec : Math.min(60, Number(cfg.duration) || 1)) * 1000,
    );
    if (!(Number(rt.progress) > 0)) return stopMorphing(false, true);
    rt.returnToPhaseStart = { start: null, duration, linearT: rt.progress, geometryT: rt.geometryT };
    rt.paused = false;
    rt.pausedByOrangeProject = false;
    rt.pausedByGreenProject = false;
    rt.boundaryPaintPending = false;
    animationScheduler.remove('morph-arm');
    animationScheduler.add('morph', animateMorph);
    requestMainCanvasRender();
    return true;
  };

  const toggleMorphPlaybackBySpace = () => {
    const pauseOnSpace = document.getElementById('morphPauseOnSpace')?.checked === true;
    state.morph.pauseOnSpace = pauseOnSpace;
    const startPreferredMorph = () => {
      if (state.morphPlayback.lastType === 'minimal') startMinimalMorphing();
      else startMorphing(); // full morph is the default Space action
      return true;
    };
    if (!pauseOnSpace) {
      if (runtimeState.minimalMorph.active) return stopMinimalMorphing(false);
      if (runtimeState.morph.active) return returnBlueMorphToPhaseStart();
      return startPreferredMorph();
    }
    if (
      (runtimeState.minimalMorph.active && runtimeState.minimalMorph.paused) ||
      (runtimeState.morph.active && runtimeState.morph.paused)
    ) {
      return resumeMorphPlayback();
    }
    if (runtimeState.minimalMorph.active || runtimeState.morph.active) {
      return pauseMorphPlayback();
    }
    return startPreferredMorph();
  };

  const toggleMorphing = () => {
    if (runtimeState.morph.active) returnBlueMorphToPhaseStart();
    else startMorphing();
    if (document.getElementById('morphSettingsPanel')?.classList.contains('hidden')) syncMorphPlaybackButton();
    else syncMorphProfileUI?.();
  };

  return Object.freeze({
    prepareMorphCycle,
    applyFillMorphFrame,
    commitLightMorphTransient,
    getMorphLongPeriodDetailScale,
    updateLightMorphKeyframe,
    rebaseMorphCycle,
    animateMorph,
    cloneMorphOriginLayers,
    captureMorphOrigin,
    restoreMorphOrigin,
    clearMorphOrigin,
    stopMorphing,
    syncMinimalMorphTimingFromUI,
    rebaseFullMorphAfterOrangeSwitch,
    preserveOrangeAudioRoutes,
    preserveOrangeLayerVisibility,
    commitMinimalMorphTarget,
    beginMinimalMorphTransition,
    minimalMorphFrame,
    stopMinimalMorphing,
    startMinimalMorphing,
    toggleMinimalMorphing,
    startMorphing,
    pauseMorphPlayback,
    resumeMorphPlayback,
    toggleMorphPlaybackBySpace,
    toggleMorphing,
  });
}

export { createMorphPlaybackModule, noteMorphGpuPrepareWait };
