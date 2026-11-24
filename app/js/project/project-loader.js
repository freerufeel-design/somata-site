// Загрузка проекта, файлы настроек и фигур.
import { normalizeTunnelDensity } from '../corridor/corridor-density.js';
import './playlist.js'; // initialisation order: this module runs after it
import {
  PROFILE_CONFIG,
  normalizeSplinePointCount,
  normalizeSplineRenderMode,
} from '../geometry/profile-model.js';
import { renderProfileEditor } from '../ui/profile-editor.js';
import { normalizeSpiralOrder, normalizeSpiralStep } from '../geometry/spiral/order-params.js';
import { normalizeSpiralSquashY } from '../geometry/orbit-builder.js';
import {
  AUDIO_ROUTING_PRESETS,
  ensureAudioRoutingState,
  normalizeAudioRoute,
} from '../audio/audio-routing.js';
import { renderAudioRoutingPanel } from '../ui/audio-routing-panel.js';
import { setLampContourAttachmentEnabled } from '../lamps/lamp-anchors.js';
import { normalizeGlintPrecisionValue } from '../effects/sweep-glint.js';
import {
  normalizeLightningBehaviorValue,
  normalizeLightningPrecisionValue,
} from '../effects/lightning-exact.js';
import { resetLightningRateRuntimeForProject } from '../effects/lightning.js';
import { ensureSweepAnimation } from '../effects/effect-animation.js';
import { normalizeLineMarkerType, normalizeLineProfileValue, syncMotionUI } from '../ui/effects-sidebar.js';
import {
  cloneEffectConfig,
  cloneLampConfig,
  createDefaultSweepConfig,
  createDefaultWebConfig,
  createLayer,
  createLayerId,
  ensureLayerEffectState,
  ensureLayerLampState,
  ensureSidebarFeatureToggleMemory,
  getActiveEffectLayer,
  getActiveLampConfig,
  getLayerFillAccumulationSeconds,
  getLayerFillFadeDirection,
  getLayerFillFadeHardness,
  getLayerFillFadePixelization,
  getLayerLampsEnabled,
  getLayerSweepConfig,
  getLayerWebConfig,
  getLayerWebEnabled,
  normalizeLayerFillRule,
  normalizeLayerFillType,
  normalizeLineMotionFxConfig,
  normalizeLineSpriteConfig,
  normalizeParticleConfig,
  normalizeSweepBlendMode,
  normalizeSweepConfig,
  syncLayerFillColorToStroke,
} from '../core/defaults-layers.js';
import { MAX_ROUNDING_PERCENT, normalizePlaylistPaletteKey } from '../core/palette.js';
import { applyFpsVisibility, applyVignetteVisibility } from '../core/render-runtime.js';
import { requestMainCanvasRender } from '../core/scheduler.js';
import { runtimeState, state } from '../core/state.js';
import {
  ensureMotionAnimation,
  motionRuntime,
  normalizeLayerMotionRotation,
  normalizeMotionState,
} from '../effects/motion.js';
import { LampGPURenderer } from '../gpu/lamp-renderer.js';
import { renderMainCanvas } from '../render/main-pipeline.js';
import { MORPH_PROFILE_GROUP_KEYS, PROFILE_PRESET_GROUP_ORDER } from '../ui/profile-presets.js';
import {
  SPIRAL_OUTER_COPIES_DEFAULT,
  TUNNEL_CENTER_HIDDEN_DEFAULT,
  TUNNEL_CENTER_HIDDEN_MAX,
  normalizeTunnelColorShiftState,
} from '../corridor/corridor-appearance.js';
import {
  TUNNEL_VIGNETTE_DEFAULT_PX,
  legacyTunnelVignetteToPixels,
  tunnelVignettePixelsFromSettings,
} from '../corridor/corridor-instances.js';
import { syncTunnelSettingsUI } from '../ui/corridor-panel.js';
import { updateLayerListUI } from '../ui/layer-selection.js';
import { normalizeMorphVertexMultiplier, normalizeMorphVertexRangeValues } from '../ui/geometry-n-control.js';
import {
  UNIFIED_MORPH_KEYS,
  normalizeSpiralMorphMode,
  normalizeSpiralMorphType,
  setSpiralMorphMode,
  setUnifiedMorphMode,
} from '../morph-runtime/morph-mode.js';
import { syncSidebarInputs } from '../ui/sidebar-sync.js';
import {
  activeRebaseMinimalMorphing,
  activeRebaseMorphing,
  activeStopMinimalMorphing,
  activeStopMorphing,
} from '../morph-runtime/morph-hooks.js';
import { resetTempoLock, syncTapUI } from '../audio/tap-tempo.js';
import {
  normalizeOrangeMorphFamily,
  normalizeOrangeMorphProfileGroup,
  orangeProfileLayerCountHolder,
  syncRandomSettingsUI,
} from '../ui/orange-morph/routing-ui.js';
import { syncMorphSettingsUI } from '../ui/morph-settings-panel.js';
import {
  applyTransparentDesktopMode,
  clearViewportBackgroundImage,
  normalizeSceneBlendState,
  setViewportBackgroundImageDataUrl,
  syncSceneBlendUI,
} from '../ui/viewport-background.js';
import {
  PROJECT_FILL_HARMONY_KEYS,
  applyMenuSettings,
  applyProjectCameraSettings,
  buildProjectData,
  cloneData,
  mergePersistentProjectSection,
  migrateFourierProjectData,
  sanitizeProjectFileBase,
} from './project-data.js';
import { activateProjectDefaultModes, stopProjectMorphing } from './project-morph.js';
import {
  quiesceProjectRuntimeForCommit,
  renderProjectChooser,
  savePlaylistToDisk,
  saveProjectToDisk,
} from './playlist.js';
import { renderLibrary, uniqueShapeLibraryName } from '../ui/library.js';
import { applyHeaderVisibility, showShortcutToast } from '../ui/header-and-export.js';
import {
  renderAudioCustomBandRows,
  renderAudioMeters,
  syncAudioCutoffs,
  syncAudioSettingsUIFromState,
} from '../audio/audio-reactive.js';
import { noteSuppressedError } from '../core/suppressed-errors.js';
import { snapLampAdaptiveExponent, normalizeLampAdaptiveExponentMultiplier } from '../lamps/adaptive-exponent.js';

function applyLoadedProject(parsed, loadOptions = {}) {
  parsed = migrateFourierProjectData(parsed);
  const preserveFullMorph = loadOptions.preserveFullMorph === true && runtimeState.morph?.active === true;
  const preserveMinimalMorph =
    loadOptions.preserveMinimalMorph === true && runtimeState.minimalMorph?.active === true;
  const preservedFullMorphPaused = preserveFullMorph && runtimeState.morph.paused === true;
  if (!preserveMinimalMorph) activeStopMinimalMorphing();
  if (!preserveFullMorph) activeStopMorphing();
  const loadedLayers = Array.isArray(parsed) ? parsed : parsed.layers;
  if (!Array.isArray(loadedLayers) || loadedLayers.length === 0) throw new Error('Empty project');

  const defaults = { ...createLayer(), roundingMode: 'standard' }; // legacy files without an explicit radius policy
  state.layers = loadedLayers.map((l, idx) => ({
    ...defaults,
    ...l,
    roundingShape: 'hybrid', // migrate retired contour/spline projects
    roundingCornerType: ['local', 'classic', 'fourier', 'simple'].includes(l.roundingCornerType)
      ? l.roundingCornerType
      : 'classic',
    // Older projects did not distinguish automatic from authored bands.
    // Preserve their routes unless they explicitly opted into auto-assignment.
    audioNativeBandAuto:
      l.audioNativeBandAuto === true || (l.audioNativeBand == null && l.audioNativeBandAuto !== false),
    id: l.id || createLayerId(),
    name: l.name || `Слой ${idx + 1}`,
    visible: l.visible !== false,
    lamps: l.lamps && typeof l.lamps === 'object' ? { ...defaults.lamps, ...l.lamps } : null,
    sprite:
      l.sprite && typeof l.sprite === 'object'
        ? normalizeLineSpriteConfig(l.sprite)
        : cloneData(defaults.sprite),
    lineMotionFx: normalizeLineMotionFxConfig(
      l.lineMotionFx && typeof l.lineMotionFx === 'object' ? l.lineMotionFx : defaults.lineMotionFx,
    ),
    particles: normalizeParticleConfig(l.particles),
    sweep:
      l.sweep && typeof l.sweep === 'object'
        ? {
            ...l.sweep,
            lightningBehavior: Object.prototype.hasOwnProperty.call(l.sweep, 'lightningBehavior')
              ? normalizeLightningBehaviorValue(l.sweep.lightningBehavior, 'symmetric')
              : 'symmetric',
            lightningPrecision: normalizeLightningPrecisionValue(l.sweep.lightningPrecision),
          }
        : null,
    radiusMultiplier: Number.isFinite(Number(l.radiusMultiplier))
      ? Math.max(0, Number(l.radiusMultiplier))
      : 1,
    strokeWidthMultiplier: Number.isFinite(Number(l.strokeWidthMultiplier))
      ? Math.max(0, Number(l.strokeWidthMultiplier))
      : 1,
    glowMultiplier: Number.isFinite(Number(l.glowMultiplier)) ? Math.max(0, Number(l.glowMultiplier)) : 1,
    glowIntensity: Number.isFinite(Number(l.glowIntensity))
      ? Math.max(0, Math.min(200, Number(l.glowIntensity)))
      : 40,
    glowIntensityMultiplier: Number.isFinite(Number(l.glowIntensityMultiplier))
      ? Math.max(0, Number(l.glowIntensityMultiplier))
      : 1,
    lineLayerMode: 'uniform',
    spiralLineType: 'uniform',
    motionRotation:
      l.motionRotation && typeof l.motionRotation === 'object'
        ? { ...defaults.motionRotation, ...l.motionRotation }
        : null,
    N: Math.max(2, Math.min(120, Math.round(Number(l.N) || Number(defaults.N) || 4))),
    chaosStar: l.chaosStar === true,
    chaosStepMinus: Math.max(
      0,
      Math.min(120, Math.round(Number(l.chaosStepMinus ?? defaults.chaosStepMinus) || 0)),
    ),
    chaosStepPlus: Math.max(
      0,
      Math.min(120, Math.round(Number(l.chaosStepPlus ?? defaults.chaosStepPlus) || 0)),
    ),
    chaosClosures: Math.max(
      1,
      Math.min(
        Math.max(2, Math.round(Number(l.N) || Number(defaults.N) || 4)),
        Math.round(Number(l.chaosClosures ?? defaults.chaosClosures) || 1),
      ),
    ),
    chaosSeed: Number.isFinite(Number(l.chaosSeed))
      ? Number(l.chaosSeed) >>> 0
      : Number(defaults.chaosSeed) >>> 0,
    geometryCircles:
      l.geometryCircles && typeof l.geometryCircles === 'object'
        ? {
            enabled: l.geometryCircles.enabled === true,
            circumscribed: l.geometryCircles.circumscribed === true,
            inscribed: l.geometryCircles.inscribed === true,
            median: l.geometryCircles.median === true,
            keyPoints: l.geometryCircles.keyPoints === true,
          }
        : cloneData(defaults.geometryCircles),
    spiralEnabled: Math.abs(normalizeSpiralOrder(l.spiralOrder ?? defaults.spiralOrder, false)) > 1e-8,
    spiralOrder: normalizeSpiralOrder(l.spiralOrder ?? defaults.spiralOrder, false),
    spiralSquashY: normalizeSpiralSquashY(l.spiralSquashY),
    spiralRememberedOrder:
      l.spiralRememberedOrder === undefined || l.spiralRememberedOrder === null
        ? l.spiralEnabled === true && Math.abs(Number(l.spiralOrder) || 0) > 1e-8
          ? normalizeSpiralOrder(l.spiralOrder, false)
          : 1
        : normalizeSpiralOrder(l.spiralRememberedOrder, false),
    spiralConstructionMode: SomataSpiralZeroTransition.buildOf(l),
    spiralZeroTransitionMode: SomataSpiralZeroTransition.transitionOf(l),
    spiralRotationFocus: Math.max(1, Math.min(64, Math.round(Number(l.spiralRotationFocus) || 4))),
    spiralManualFocus: l.spiralManualFocus === true,
    spiralRotationFocusFigure: Math.max(
      1,
      Math.min(
        256,
        Math.round(
          Number.isFinite(Number(l.spiralRotationFocusFigure)) ? Number(l.spiralRotationFocusFigure) : 7,
        ),
      ),
    ),
    corridorFocusHighlight: l.corridorFocusHighlight === true,
    spiralStep: normalizeSpiralStep(l.spiralStep ?? l.K ?? defaults.K, l),
    spiralStepLinked: l.spiralStepLinked !== false,
    spiralStepLimiterEnabled: l.spiralStepLimiterEnabled !== false,
    spiralStepLimiter: Math.max(1, Math.min(120, Math.round(Number(l.spiralStepLimiter ?? 2) || 2))),
    spiralClosed: l.spiralClosed !== false,
    spiralTwist: l.spiralTwist === true,
    spiralTangential: l.spiralTangential === true,
    spiralRoundSeams: l.spiralRoundSeams !== false,

    spiralFillEnabled: l.spiralFillEnabled === true,
    spiralFillType: ['chopped', 'mathematical', 'bandXor'].includes(l.spiralFillType)
      ? l.spiralFillType
      : 'chopped',
    lineProfile: ['round', 'slash', 'square', 'circle', 'cross'].includes(l.lineProfileStroke)
      ? l.lineProfileStroke
      : l.lineProfileApplication !== 'graffiti' &&
          ['round', 'slash', 'square', 'circle', 'cross'].includes(l.lineProfile)
        ? l.lineProfile
        : defaults.lineProfileStroke,
    lineProfileApplication: ['stroke', 'graffiti'].includes(l.lineProfileApplication)
      ? l.lineProfileApplication
      : 'stroke',
    lineProfileStroke: ['round', 'slash', 'square', 'circle', 'cross'].includes(l.lineProfileStroke)
      ? l.lineProfileStroke
      : l.lineProfileApplication !== 'graffiti' &&
          ['round', 'slash', 'square', 'circle', 'cross'].includes(l.lineProfile)
        ? l.lineProfile
        : defaults.lineProfileStroke,
    lineProfileGraffiti: 'slash',
    lineMarkerType: normalizeLineMarkerType(
      l.lineMarkerType ||
        (['circle', 'square', 'cross', 'slash'].includes(l.lineProfileStroke) ? l.lineProfileStroke : null) ||
        defaults.lineMarkerType ||
        'slash',
      'slash',
    ),
    graffitiAngle: Number.isFinite(Number(l.graffitiAngle))
      ? Math.max(-90, Math.min(90, Number(l.graffitiAngle)))
      : (defaults.graffitiAngle ?? 45),
    graffitiAngleMode: ['absolute', 'relative'].includes(l.graffitiAngleMode)
      ? l.graffitiAngleMode
      : 'absolute',
    graffitiNibShape: ['pointed', 'blunt', 'pinched', 'round'].includes(l.graffitiNibShape)
      ? l.graffitiNibShape
      : defaults.graffitiNibShape,
    graffitiNibLength: Number.isFinite(Number(l.graffitiNibLength))
      ? Math.max(1, Math.min(20, Number(l.graffitiNibLength)))
      : defaults.graffitiNibLength,
    graffitiNibLengthMultiplier: Number.isFinite(Number(l.graffitiNibLengthMultiplier))
      ? Math.max(0.01, Number(l.graffitiNibLengthMultiplier))
      : defaults.graffitiNibLengthMultiplier,
    graffitiVariationMode: ['perSegment', 'everyNth', 'across', 'perPath', 'whole'].includes(
      l.graffitiVariationMode,
    )
      ? l.graffitiVariationMode
      : defaults.graffitiVariationMode,
    graffitiVariationEveryN: Number.isFinite(Number(l.graffitiVariationEveryN))
      ? Math.max(1, Math.min(24, Math.round(Number(l.graffitiVariationEveryN))))
      : defaults.graffitiVariationEveryN,
    graffitiSizeVariationEnabled: l.graffitiSizeVariationEnabled === true,
    graffitiSizeVariation: Number.isFinite(Number(l.graffitiSizeVariation))
      ? Math.max(0, Math.min(100, Number(l.graffitiSizeVariation)))
      : defaults.graffitiSizeVariation,
    graffitiSizeFocus: Number.isFinite(Number(l.graffitiSizeFocus))
      ? Math.max(0, Math.min(100, Number(l.graffitiSizeFocus)))
      : defaults.graffitiSizeFocus,
    graffitiRotationVariationEnabled: l.graffitiRotationVariationEnabled === true,
    graffitiRotationVariation: Number.isFinite(Number(l.graffitiRotationVariation))
      ? Math.max(0, Math.min(180, Number(l.graffitiRotationVariation)))
      : defaults.graffitiRotationVariation,
    graffitiRotationMultiplier: Number.isFinite(Number(l.graffitiRotationMultiplier))
      ? Math.max(0, Number(l.graffitiRotationMultiplier))
      : defaults.graffitiRotationMultiplier,
    graffitiRotationFocus: Number.isFinite(Number(l.graffitiRotationFocus))
      ? Math.max(0, Math.min(100, Number(l.graffitiRotationFocus)))
      : defaults.graffitiRotationFocus,
    graffitiBaseStrokeWidth: Number.isFinite(Number(l.graffitiBaseStrokeWidth))
      ? Math.max(0.5, Math.min(20, Number(l.graffitiBaseStrokeWidth)))
      : null,
    lineVisible: l.lineVisible !== false,
    splineRenderMode: normalizeSplineRenderMode(l.splineRenderMode ?? defaults.splineRenderMode),
    wholeCurveSpline: l.wholeCurveSpline === true,
    profileNodes:
      Array.isArray(l.profileNodes) && l.profileNodes.length
        ? l.profileNodes
        : cloneData(defaults.profileNodes),
  }));

  for (const layer of state.layers) {
    delete layer.fourierStrength;
    delete layer.graffitiDistressEnabled;
    delete layer.graffitiDistress;
  }

  if (Array.isArray(parsed)) {
    state.lightningRateSync = true;
    state.layers.forEach(ensureLayerEffectState);
    resetLightningRateRuntimeForProject(getLayerSweepConfig(state.layers[0]));
    ensureSweepAnimation();
    requestMainCanvasRender();
    return;
  }
  const settings = parsed.settings || {};
  // Presence of newly pausable Spiral rows belongs to the opened
  // project. Do not leak these flags from the previously opened one.
  if (state.morph?.options) {
    delete state.morph.options.spiralLayersAdded;
    delete state.morph.options.spiralOrderAdded;
  }
  // Legacy projects have no Morph Profile collection. Do not let profiles from the
  // previously opened project leak through merge-by-key loading; they migrate to a
  // fresh system Standard after the legacy Blue settings below are restored.
  if (!Array.isArray(settings.morph?.profiles)) {
    state.morph.profiles = [];
    state.morph.activeProfileId = 'standard';
  }
  mergePersistentProjectSection('tunnel', settings.tunnel);
  mergePersistentProjectSection('morph', settings.morph);
  mergePersistentProjectSection('minimalMorph', settings.minimalMorph);
  mergePersistentProjectSection('tapTempo', settings.tapTempo);
  mergePersistentProjectSection('audioReactive', settings.audioReactive);
  state.graffitiDefaultActive = settings.graffitiDefaultActive === true;
  state.masterLayerEdit = settings.masterLayerEdit === true;
  if (
    typeof settings.activeLayerId === 'string' &&
    state.layers.some((layer) => layer?.id === settings.activeLayerId)
  )
    state.activeLayerId = settings.activeLayerId;
  else state.activeLayerId = state.layers[0]?.id || null;
  state.activeProjectPaletteKey = normalizePlaylistPaletteKey(
    settings.activeProjectPaletteKey ||
      settings.morph?.lineColorPalette ||
      state.activeProjectPaletteKey ||
      'standard',
    'standard',
  );
  if (typeof settings.bgColor === 'string') state.bgColor = settings.bgColor;
  if (
    typeof settings.backgroundImageDataUrl === 'string' &&
    /^data:image\//i.test(settings.backgroundImageDataUrl)
  )
    setViewportBackgroundImageDataUrl(settings.backgroundImageDataUrl);
  else clearViewportBackgroundImage();
  applyTransparentDesktopMode(settings.transparentDesktop === true, true);
  state.sceneBlend = normalizeSceneBlendState(
    settings.sceneBlend && typeof settings.sceneBlend === 'object'
      ? settings.sceneBlend
      : { mode: 'normal', strength: 100, opacity: 100 },
  );
  syncSceneBlendUI();
  if (settings.uiVisibility && typeof settings.uiVisibility === 'object') {
    const uv = settings.uiVisibility;
    if (typeof uv.showPresets === 'boolean') state.uiVisibility.showPresets = uv.showPresets;
    else if (typeof uv.hidePresets === 'boolean') state.uiVisibility.showPresets = !uv.hidePresets;
    if (typeof uv.showProjects === 'boolean') state.uiVisibility.showProjects = uv.showProjects;
    if (typeof uv.hideMorphChooser === 'boolean') state.uiVisibility.hideMorphChooser = uv.hideMorphChooser;
    if (typeof uv.hideProfiles === 'boolean') state.uiVisibility.hideProfiles = uv.hideProfiles;
    applyHeaderVisibility();
  }
  if (typeof settings.showFps === 'boolean' && typeof applyFpsVisibility === 'function')
    applyFpsVisibility(settings.showFps, false);
  if (settings.menuSettings && typeof settings.menuSettings === 'object')
    applyMenuSettings(settings.menuSettings);
  if (typeof settings.showGrid === 'boolean') state.showGrid = settings.showGrid;
  state.mirrorMode = settings.mirrorMode === true;
  state.roundingGuidesOverlayEnabled = settings.showRoundingGuides === true;
  state.showRoundingGuides = false;
  if (typeof settings.roundingGuidesDashed === 'boolean')
    state.roundingGuidesDashed = settings.roundingGuidesDashed;
  if (typeof settings.roundingGuideColor === 'string') state.roundingGuideColor = settings.roundingGuideColor;
  if (Number.isFinite(Number(settings.roundingGuideOpacity)))
    state.roundingGuideOpacity = Math.max(0, Math.min(100, Number(settings.roundingGuideOpacity)));
  if (typeof settings.showBoundingCircle === 'boolean')
    state.showBoundingCircle = settings.showBoundingCircle;
  if (typeof settings.boundingCircleColor === 'string')
    state.boundingCircleColor = settings.boundingCircleColor;
  if (typeof settings.showVignette === 'boolean') applyVignetteVisibility(settings.showVignette, false);
  if (settings.sidebarMode === 'fourier')
    state.sidebarMode = 'shape'; // migrated to the shape rounding controls
  else if (
    ['shape', 'lines', 'lamps', 'web', 'sweep', 'lightning', 'particles', 'motion', 'palette'].includes(
      settings.sidebarMode,
    )
  )
    state.sidebarMode = settings.sidebarMode;
  state.forceAllLinesHidden = false;
  const _lineMemory = ensureSidebarFeatureToggleMemory();
  if (_lineMemory.lines) delete _lineMemory.lines;
  if (typeof settings.showLines === 'boolean') state.showLines = settings.showLines;
  if (typeof settings.showLamps === 'boolean') state.showLamps = settings.showLamps;
  if (typeof settings.showWeb === 'boolean') state.showWeb = settings.showWeb;
  state.lightningRateSync =
    typeof settings.lightningRateSync === 'boolean' ? settings.lightningRateSync : true;
  if (settings.sweep && typeof settings.sweep === 'object') {
    const incomingSweepTemplate = cloneData(settings.sweep);
    normalizeSweepConfig(incomingSweepTemplate);
    state.sweep = { ...state.sweep, ...incomingSweepTemplate, raf: 0 };
    normalizeSweepConfig(state.sweep);
    state.sweep.enabled = state.sweep.enabled === true;
    if (state.sweep.mode === 'lightning') {
      state.sweep.effectType = 'lightning';
      state.sweep.mode = 'whole';
    }
    state.sweep.effectType = state.sweep.effectType === 'lightning' ? 'lightning' : 'glint';
    state.sweep.mode = ['perSegment', 'everyNth', 'across', 'perPath', 'whole'].includes(state.sweep.mode)
      ? state.sweep.mode
      : 'whole';
    state.sweep.everyN = Math.max(2, Math.min(24, Math.round(Number(state.sweep.everyN) || 2)));
    state.sweep.direction = state.sweep.direction === 'backward' ? 'backward' : 'forward';
    state.sweep.speed = Math.max(0.02, Math.min(2, Number(state.sweep.speed) || 0.25));
    state.sweep.speedMultiplier = Math.max(
      0,
      Number.isFinite(Number(state.sweep.speedMultiplier)) ? Number(state.sweep.speedMultiplier) : 1,
    );
    state.sweep.syncMusic = state.sweep.syncMusic !== false;
    state.sweep.lengthPercent = Math.max(1, Math.min(100, Number(state.sweep.lengthPercent) || 3));
    state.sweep.widthPercent = Math.max(
      0,
      Math.min(
        200,
        Number.isFinite(Number(state.sweep.widthPercent)) ? Number(state.sweep.widthPercent) : 105,
      ),
    );
    state.sweep.color = /^#[0-9a-f]{6}$/i.test(state.sweep.color || '') ? state.sweep.color : '#ffffff';
    state.sweep.haloColor = /^#[0-9a-f]{6}$/i.test(state.sweep.haloColor || '')
      ? state.sweep.haloColor
      : state.sweep.color;
    state.sweep.opacity = Math.max(
      0,
      Math.min(100, Number.isFinite(Number(state.sweep.opacity)) ? Number(state.sweep.opacity) : 100),
    );
    delete state.sweep.blurEnabled;
    delete state.sweep.blur;
    state.sweep.brightness = Math.max(
      0,
      Math.min(200, Number.isFinite(Number(state.sweep.brightness)) ? Number(state.sweep.brightness) : 77),
    );
    state.sweep.glow = Math.max(
      0,
      Number.isFinite(Number(state.sweep.glow)) ? Number(state.sweep.glow) : 14.5,
    );
    state.sweep.glowMultiplier = Math.max(
      0,
      Number.isFinite(Number(state.sweep.glowMultiplier)) ? Number(state.sweep.glowMultiplier) : 1,
    );
    state.sweep.glowIntensity = Math.max(
      0,
      Math.min(
        200,
        Number.isFinite(Number(state.sweep.glowIntensity)) ? Number(state.sweep.glowIntensity) : 100,
      ),
    );
    state.sweep.glowIntensityMultiplier = Math.max(
      0,
      Number.isFinite(Number(state.sweep.glowIntensityMultiplier))
        ? Number(state.sweep.glowIntensityMultiplier)
        : 1,
    );
    state.sweep.softness = Math.max(
      0,
      Math.min(150, Number.isFinite(Number(state.sweep.softness)) ? Number(state.sweep.softness) : 100),
    );
    state.sweep.softnessMultiplier = Math.max(
      0,
      Number.isFinite(Number(state.sweep.softnessMultiplier)) ? Number(state.sweep.softnessMultiplier) : 1,
    );
    state.sweep.coreBlendMode = normalizeSweepBlendMode(state.sweep.coreBlendMode);
    state.sweep.glowBlendMode = normalizeSweepBlendMode(state.sweep.glowBlendMode);
    state.sweep.flashType = normalizeGlintPrecisionValue(state.sweep.flashType ?? state.sweep.glintPrecision);
    if (state.sweep.flashType === 'spectral') state.sweep.flashType = 'high';
    state.sweep.glintPrecision = state.sweep.flashType;
    state.sweep.lightningMode = ['perSegment', 'everyNth', 'across', 'perPath', 'whole'].includes(
      state.sweep.lightningMode,
    )
      ? state.sweep.lightningMode
      : 'perSegment';
    state.sweep.lightningEveryN = Math.max(
      2,
      Math.min(24, Math.round(Number(state.sweep.lightningEveryN) || 2)),
    );
    state.sweep.lightningRandomPosition = state.sweep.lightningRandomPosition === true;
    state.sweep.lightningColor = /^#[0-9a-f]{6}$/i.test(state.sweep.lightningColor || '')
      ? state.sweep.lightningColor
      : '#ffffff';
    state.sweep.lightningSecondaryColor = /^#[0-9a-f]{6}$/i.test(state.sweep.lightningSecondaryColor || '')
      ? state.sweep.lightningSecondaryColor
      : '#7dd3fc';

    state.sweep.lightningSegmentPercent = Math.max(
      1,
      Math.min(100, Number(state.sweep.lightningSegmentPercent) || 100),
    );

    {
      const v = Number(state.sweep.lightningRatePercent);
      state.sweep.lightningRatePercent = Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 100;
    }
    state.sweep.lightningRateMultiplier = Math.max(
      0,
      Number.isFinite(Number(state.sweep.lightningRateMultiplier))
        ? Number(state.sweep.lightningRateMultiplier)
        : 1,
    );
    state.sweep.lightningDurationMs = Math.max(
      30,
      Math.min(700, Number(state.sweep.lightningDurationMs) || 120),
    );
    state.sweep.lightningDurationMultiplier = Math.max(
      1 / 4096,
      Number(state.sweep.lightningDurationMultiplier) || 1,
    );
    state.sweep.lightningWidthPercent = Math.max(
      1,
      Math.min(100, Number(state.sweep.lightningWidthPercent) || 50),
    );
    state.sweep.lightningWidthMultiplier = Math.max(
      0,
      Number.isFinite(Number(state.sweep.lightningWidthMultiplier))
        ? Number(state.sweep.lightningWidthMultiplier)
        : 1,
    );
    state.sweep.lightningBrightness = Math.max(
      0,
      Math.min(
        400,
        Number.isFinite(Number(state.sweep.lightningBrightness))
          ? Number(state.sweep.lightningBrightness)
          : 100,
      ),
    );
    state.sweep.lightningGlow = Math.max(
      0,
      Number.isFinite(Number(state.sweep.lightningGlow)) ? Number(state.sweep.lightningGlow) : 16,
    );
    state.sweep.lightningGlowMultiplier = Math.max(
      0,
      Number.isFinite(Number(state.sweep.lightningGlowMultiplier))
        ? Number(state.sweep.lightningGlowMultiplier)
        : 1,
    );
    state.sweep.lightningGlowIntensity = Math.max(
      0,
      Math.min(
        400,
        Number.isFinite(Number(state.sweep.lightningGlowIntensity))
          ? Number(state.sweep.lightningGlowIntensity)
          : 100,
      ),
    );
    state.sweep.lightningGlowIntensityMultiplier = Math.max(
      0,
      Number.isFinite(Number(state.sweep.lightningGlowIntensityMultiplier))
        ? Number(state.sweep.lightningGlowIntensityMultiplier)
        : 1,
    );
    state.sweep.lightningSoftness = Math.max(
      0,
      Number.isFinite(Number(state.sweep.lightningSoftness)) ? Number(state.sweep.lightningSoftness) : 100,
    );
    state.sweep.lightningSoftnessMultiplier = Math.max(
      0,
      Number.isFinite(Number(state.sweep.lightningSoftnessMultiplier))
        ? Number(state.sweep.lightningSoftnessMultiplier)
        : 1,
    );
    normalizeSweepConfig(state.sweep);
    state.sweep.lightningSmoothLighting = state.sweep.lightningSmoothLighting === true;
    state.sweep.lightningShowLines = state.sweep.lightningShowLines !== false;
    state.sweep.lightningLineOpacity = Math.max(
      0,
      Math.min(100, Number(state.sweep.lightningLineOpacity) || 100),
    );
    state.sweep.lightningAfterglow = false;
    state.sweep.lightningAfterglowMs = 0;
    state.sweep.lightningMicroStrikes = Math.max(
      0,
      Number.isFinite(Number(state.sweep.lightningMicroStrikes))
        ? Math.round(Number(state.sweep.lightningMicroStrikes))
        : 2,
    );
    state.sweep.phase = Number.isFinite(Number(state.sweep.phase))
      ? ((Number(state.sweep.phase) % 1) + 1) % 1
      : 0;
    state.sweep.currentVelocity = 0;
    state.sweep.lastUpdate = 0;
    state.sweep.cycleCount = Math.max(0, Math.round(Number(state.sweep.cycleCount) || 0));
    state.sweep.lightningPhase = Number.isFinite(Number(state.sweep.lightningPhase))
      ? ((Number(state.sweep.lightningPhase) % 1) + 1) % 1
      : 0;
    state.sweep.lightningLastUpdate = 0;
    state.sweep.lightningCycleCount = Math.max(0, Math.round(Number(state.sweep.lightningCycleCount) || 0));
  }
  state.geometryWebGL = true; // v284: always-on implementation detail; legacy false values are ignored.
  if (settings.web && typeof settings.web === 'object') {
    const incomingWeb = { ...settings.web };
    if (
      !['inside', 'outsideStraight', 'outsideArc'].some((k) =>
        Object.prototype.hasOwnProperty.call(incomingWeb, k),
      )
    ) {
      const legacy = ['inside', 'outside', 'combined'].includes(incomingWeb.region)
        ? incomingWeb.region
        : 'inside';
      incomingWeb.inside = legacy !== 'outside';
      incomingWeb.outsideStraight = false;
      incomingWeb.outsideArc = legacy !== 'inside';
    }
    state.web = { ...state.web, ...incomingWeb };
    state.web.type = state.web.type === 'rounding' ? 'rounding' : 'bevel';
    if (state.web.style === 'silk') state.web.style = 'spiderSun';
    state.web.style = ['web', 'laser', 'spiderSun'].includes(state.web.style) ? state.web.style : 'web';
    state.web.inside = state.web.inside === true;
    state.web.outsideStraight = state.web.outsideStraight === true;
    state.web.outsideArc = state.web.outsideArc === true;
    state.web.angleThreshold = Math.max(5, Math.min(175, Number(state.web.angleThreshold) || 60));
    state.web.width = Math.max(0.1, Math.min(4, Number(state.web.width) || 0.6));
    state.web.widthRelative = state.web.widthRelative === true;
    state.web.widthPercent = Math.max(1, Math.min(400, Number(state.web.widthPercent) || 40));
    state.web.color = /^#[0-9a-f]{6}$/i.test(state.web.color || '') ? state.web.color : '#ffffff';
    state.web.secondaryColor = /^#[0-9a-f]{6}$/i.test(state.web.secondaryColor || '')
      ? state.web.secondaryColor
      : '#00ffff';
    state.web.oscillationStrengthMultiplier = Math.max(
      0.015625,
      Math.min(64, Number(state.web.oscillationStrengthMultiplier) || 1),
    );
    state.web.sunDegrees = Math.max(5, Math.min(90, Number(state.web.sunDegrees) || 20));
    state.web.distance = Math.max(
      0,
      Math.min(100, Number.isFinite(Number(state.web.distance)) ? Number(state.web.distance) : 60),
    );
    state.web.spacing = Math.max(2, Math.min(40, Number(state.web.spacing) || 10));
    state.web.angleVariation = Math.max(0, Math.min(30, Number(state.web.angleVariation) || 0));
    delete state.web.threadCount;
  }

  for (let i = 0; i < state.layers.length; i++) {
    const raw = loadedLayers[i] || {};
    const layer = state.layers[i];
    if (!Object.prototype.hasOwnProperty.call(raw, 'lineVisible'))
      layer.lineVisible = typeof settings.showLines === 'boolean' ? settings.showLines : true;
    else layer.lineVisible = raw.lineVisible !== false;
    if (!Object.prototype.hasOwnProperty.call(raw, 'showLamps')) layer.showLamps = state.showLamps === true;
    if (!Object.prototype.hasOwnProperty.call(raw, 'showWeb')) layer.showWeb = state.showWeb === true;
    if (!raw.web || typeof raw.web !== 'object') layer.web = cloneEffectConfig(state.web);
    if (!raw.sweep || typeof raw.sweep !== 'object') layer.sweep = cloneEffectConfig(state.sweep);
    if (!Object.prototype.hasOwnProperty.call(raw, 'fill')) layer.fill = true;
    if (!Object.prototype.hasOwnProperty.call(raw, 'fillMatchStroke')) layer.fillMatchStroke = true;
    if (!Object.prototype.hasOwnProperty.call(raw, 'fillRule')) layer.fillRule = 'evenodd';
    if (!Object.prototype.hasOwnProperty.call(raw, 'fillType')) layer.fillType = 'normal';
    layer.fillRule = normalizeLayerFillRule(layer);
    layer.fillType = normalizeLayerFillType(layer);
    layer.fillAccumulationSeconds = getLayerFillAccumulationSeconds(layer);
    layer.fillFadeDirection = getLayerFillFadeDirection(layer);
    layer.fillFadeHardness = getLayerFillFadeHardness(layer);
    layer.fillFadePixelization = getLayerFillFadePixelization(layer);
    if (layer.fillMatchStroke !== false) syncLayerFillColorToStroke(layer, true);
    if (raw.lamps && typeof raw.lamps === 'object' && !Number.isFinite(Number(raw.lamps.softnessMultiplier)))
      layer.lamps.softnessMultiplier = 1;
    if (!['local', 'classic', 'fourier', 'simple'].includes(layer.roundingCornerType))
      layer.roundingCornerType = 'classic';
    ensureLayerEffectState(layer);
  }
  resetLightningRateRuntimeForProject(
    settings.sweep && typeof settings.sweep === 'object' ? state.sweep : getLayerSweepConfig(state.layers[0]),
  );
  if (settings.lineOutline && typeof settings.lineOutline === 'object') {
    state.lineOutline = { ...state.lineOutline, ...settings.lineOutline };
    state.lineOutline.enabled = state.lineOutline.enabled === true;
    state.lineOutline.color = state.lineOutline.color || '#ffffff';
    state.lineOutline.style = ['saiyan', 'drip', 'mountain'].includes(state.lineOutline.style)
      ? state.lineOutline.style
      : 'classic';
    state.lineOutline.auraSpeed = Math.max(
      0,
      Math.min(
        200,
        Number.isFinite(Number(state.lineOutline.auraSpeed)) ? Number(state.lineOutline.auraSpeed) : 100,
      ),
    );
    for (const [key, min, max, fallback] of [
      ['widthMultiplier', 0.015625, 64, 1],
      ['auraSpeedMultiplier', 0, 64, 1],
      ['auraSpan', 0, 200, 100],
      ['auraSpanMultiplier', 0.015625, 64, 1],
    ]) {
      const n = Number(state.lineOutline[key]);
      state.lineOutline[key] = Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
    }
    state.lineOutline.width = Math.max(
      0.5,
      Math.min(state.lineOutline.style !== 'classic' ? 30 : 12, Number(state.lineOutline.width) || 1.5),
    );
    window.somataOutlineSyncAnimation?.();
    if (state.lineOutline.layerCount != null)
      state.lineOutline.layerCount = Math.max(0, Math.round(Number(state.lineOutline.layerCount) || 0));
    state.lineOutline.mode = ['outer', 'inner', 'median'].includes(state.lineOutline.mode)
      ? state.lineOutline.mode
      : 'outer';
  }
  if (settings.lamps && typeof settings.lamps === 'object') {
    state.lamps = { ...state.lamps, ...settings.lamps };
    if (
      Number.isFinite(Number(state.lamps.brightnessMultiplier)) &&
      Number(state.lamps.brightnessMultiplier) !== 1
    )
      state.lamps.brightness = Math.max(
        0,
        Math.min(200, (Number(state.lamps.brightness) || 0) * Number(state.lamps.brightnessMultiplier)),
      );
    delete state.lamps.brightnessMultiplier;
    state.lamps.softnessMultiplier = Number.isFinite(Number(settings.lamps.softnessMultiplier))
      ? Math.max(0, Number(settings.lamps.softnessMultiplier))
      : 1;
    if (state.lamps.positionMode === 'circumference') state.lamps.positionMode = 'key';
    if (!['key', 'corners', 'arbitrary'].includes(state.lamps.positionMode)) state.lamps.positionMode = 'key';
    if (!['linear', 'key', 'stable'].includes(state.lamps.morphMotionMode))
      state.lamps.morphMotionMode = 'key';
    state.lamps.morphInertia = Math.max(
      -100,
      Math.min(100, Number.isFinite(Number(state.lamps.morphInertia)) ? Number(state.lamps.morphInertia) : 0),
    );
    if (typeof settings.lamps.cornerInertiaLinked !== 'boolean') state.lamps.cornerInertiaLinked = true;
    state.lamps.cornerInertiaPercent = Math.max(
      0,
      Math.min(
        100,
        Number.isFinite(Number(state.lamps.cornerInertiaPercent))
          ? Number(state.lamps.cornerInertiaPercent)
          : 10,
      ),
    );
    state.lamps.cornerInertiaSec = Math.max(
      0,
      Math.min(
        15,
        Number.isFinite(Number(state.lamps.cornerInertiaSec)) ? Number(state.lamps.cornerInertiaSec) : 0.5,
      ),
    );
    if (typeof settings.lamps.calmMode !== 'boolean') state.lamps.calmMode = true;

    let contourAttach;
    if (typeof settings.lamps.snapToContour === 'boolean') contourAttach = settings.lamps.snapToContour;
    else if (
      typeof settings.lamps.snapToPolygon === 'boolean' &&
      typeof settings.lamps.stickToRounding === 'boolean'
    )
      contourAttach = settings.lamps.snapToPolygon || settings.lamps.stickToRounding;
    else if (typeof settings.lamps.snapToPolygon === 'boolean') contourAttach = settings.lamps.snapToPolygon;
    else if (typeof settings.lamps.stickToRounding === 'boolean')
      contourAttach = settings.lamps.stickToRounding;
    else contourAttach = true;
    setLampContourAttachmentEnabled(contourAttach);
    state.lamps.freezeLight = settings.lamps.freezeLight === true;
    state.lamps.freezeTailSec = Math.max(
      0.05,
      Math.min(
        30,
        Number.isFinite(Number(settings.lamps.freezeTailSec)) ? Number(settings.lamps.freezeTailSec) : 1.5,
      ),
    );
    state.lamps.freezeIntensity = Math.max(
      0,
      Math.min(
        100,
        Number.isFinite(Number(settings.lamps.freezeIntensity))
          ? Number(settings.lamps.freezeIntensity)
          : 100,
      ),
    );
    state.lamps.freezeHardness = Math.max(
      0,
      Math.min(
        100,
        Number.isFinite(Number(settings.lamps.freezeHardness)) ? Number(settings.lamps.freezeHardness) : 50,
      ),
    );
    state.lamps.freezeColorMode = ['lamp', 'line', 'fixed', 'hue'].includes(settings.lamps.freezeColorMode)
      ? settings.lamps.freezeColorMode
      : 'lamp';
    state.lamps.freezeColor =
      typeof settings.lamps.freezeColor === 'string' ? settings.lamps.freezeColor : '#00ffcc';
    state.lamps.freezeHueDegrees = Math.max(
      0,
      Math.min(
        180,
        Number.isFinite(Number(settings.lamps.freezeHueDegrees))
          ? Number(settings.lamps.freezeHueDegrees)
          : 45,
      ),
    );
    state.lamps.freezeChromatic = settings.lamps.freezeChromatic === true;
    state.lamps.freezeChromaticColor =
      typeof settings.lamps.freezeChromaticColor === 'string'
        ? settings.lamps.freezeChromaticColor
        : '#22d3ee';
    state.lamps.freezeRain = settings.lamps.freezeRain === true;
    const storedRainDegrees = Number(settings.lamps.freezeRainDegrees);
    const migratedRainDegrees =
      settings.lamps.freezeRainDirectionVersion === 2 || !Number.isFinite(storedRainDegrees)
        ? storedRainDegrees
        : storedRainDegrees + 90;
    state.lamps.freezeRainDirectionVersion = 2;
    state.lamps.freezeRainDegrees =
      (((Number.isFinite(migratedRainDegrees) ? migratedRainDegrees : 180) % 360) + 360) % 360;
    state.lamps.freezeRainSource = settings.lamps.freezeRainSource === 'lamp' ? 'lamp' : 'core';
    state.lamps.freezeRainSpeed = Math.max(
      0,
      Math.min(
        100,
        Number.isFinite(Number(settings.lamps.freezeRainSpeed)) ? Number(settings.lamps.freezeRainSpeed) : 50,
      ),
    );
    state.lamps.freezeRainTailSec = Math.max(
      0.05,
      Math.min(
        30,
        Number.isFinite(Number(settings.lamps.freezeRainTailSec))
          ? Number(settings.lamps.freezeRainTailSec)
          : 1.5,
      ),
    );
    state.lamps.freezeRainHardness = Math.max(
      0,
      Math.min(
        100,
        Number.isFinite(Number(settings.lamps.freezeRainHardness))
          ? Number(settings.lamps.freezeRainHardness)
          : 50,
      ),
    );
    if (typeof settings.lamps.adaptiveBrightness !== 'boolean') state.lamps.adaptiveBrightness = true;
    state.lamps.extinguishIntersections = settings.lamps.extinguishIntersections === true;
    state.lamps.intersectionDistance = Math.min(100, Math.max(0, Number(settings.lamps.intersectionDistance ?? 50)));
    state.lamps.adaptiveAudio = settings.lamps.adaptiveAudio === true;
    if (typeof settings.lamps.adaptiveAdjustBrightness !== 'boolean')
      state.lamps.adaptiveAdjustBrightness = false;
    state.lamps.adaptiveStrength = Math.max(0, Math.min(100, Number(state.lamps.adaptiveStrength ?? 100)));
    state.lamps.adaptiveStrengthMultiplier = Math.max(0, Number(state.lamps.adaptiveStrengthMultiplier ?? 1));
    state.lamps.adaptiveExponent = snapLampAdaptiveExponent(state.lamps.adaptiveExponent);
    state.lamps.adaptiveExponentMultiplier = normalizeLampAdaptiveExponentMultiplier(state.lamps.adaptiveExponentMultiplier);
    if (typeof state.lamps.adaptiveAutoExponent !== 'boolean') state.lamps.adaptiveAutoExponent = false;
    state.lamps.adaptiveFadeSec = Math.max(0, Number(state.lamps.adaptiveFadeSec ?? 1));
    state.lamps.morphEnabled = false;
    state.lamps.density = Math.max(0, Math.min(200, Number(state.lamps.density ?? 100)));
    state.lamps.densityMultiplier = Math.max(0, Number(state.lamps.densityMultiplier ?? 1));
    state.lamps.scatter = Math.max(0, Math.min(100, Number(state.lamps.scatter) || 0));
    state.lamps.scatterMultiplier = Number.isFinite(Number(state.lamps.scatterMultiplier))
      ? Math.max(0, Number(state.lamps.scatterMultiplier))
      : 1;
    state.lamps.sizeVariation = Math.max(0, Math.min(100, Number(state.lamps.sizeVariation ?? 0)));
    state.lamps.sizeVariationMultiplier = Math.max(0, Number(state.lamps.sizeVariationMultiplier ?? 1));
    state.lamps.brightnessVariation = Math.max(
      0,
      Math.min(100, Number(state.lamps.brightnessVariation ?? 0)),
    );
    state.lamps.brightnessVariationMultiplier = Math.max(
      0,
      Number(state.lamps.brightnessVariationMultiplier ?? 1),
    );
    state.lamps.morphSize = 0;
    state.lamps.morphBrightness = 0;
    if (!settings.lamps.colorMode)
      state.lamps.colorMode = settings.lamps.rainbow
        ? 'rainbow'
        : settings.lamps.matchLineColor === false
          ? 'selected'
          : 'line';
  }
  for (const layer of state.layers) {
    if (!layer.lamps || typeof layer.lamps !== 'object') layer.lamps = cloneLampConfig(state.lamps);
    ensureLayerLampState(layer);
  }
  try {
    LampGPURenderer?.resetFreezeAll?.();
  } catch (error) {
    noteSuppressedError('project/project-loader#applyLoadedProject', error);
  }
  applyProjectCameraSettings(settings);
  const defaultAmbient = {
    rain: { enabled: false, angle: 14, density: 70, color: '#a6c8ff', hue: 0, opacity: 55, speed: 170 },
    dichotomy: {
      enabled: false,
      count: 2,
      offset: 6,
      opacity: 30,
      hue: 0,
      colorA: '#ff4089',
      colorB: '#0ce4ff',
      colorC: '#ffe176',
    },
    rainbow: { enabled: false, offset: 6, strength: 40 },
    reiatsu: { enabled: false, strength: 25, speed: 100 },
    earthquake: { enabled: false, strength: 25, speed: 100 },
    clouds: { enabled: false, density: 42, color: '#acc5e7', opacity: 24, speed: 12 },
  };
  state.ambientOverPrism = settings.ambientOverPrism === true;
  state.ambient = Object.fromEntries(
    Object.entries(defaultAmbient).map(([key, def]) => [
      key,
      { ...def, ...((settings.ambient || {})[key] || {}) },
    ]),
  );
  // Projects authored before Earthquake had screen jitter under Reiatsu.
  // Preserve their exact old appearance without changing new Reiatsu semantics.
  if (!settings.ambient?.earthquake && settings.ambient?.reiatsu?.enabled === true) {
    state.ambient.earthquake = { ...state.ambient.reiatsu };
    state.ambient.reiatsu.enabled = false;
  }
  state.prism = {
    enabled: false,
    mode: '3d',
    source2d: 'sprite',
    spriteDataUrl: '',
    shape: 'sphere',
    size: 260,
    refraction: 16,
    dispersion: 55,
    opacity: 63,
    speed: 15,
    positionX: 0,
    positionY: 0,
    tiltX: 12,
    tiltY: 0,
    ...(settings.prism || {}),
  };
  // Pre-8.20.5 saved glass objects are 2D legacy overlays, not optical 3D.
  if (settings.prism && !Object.prototype.hasOwnProperty.call(settings.prism, 'mode')) {
    state.prism.mode = '2d';
    state.prism.source2d = 'legacy';
  }
  window.SomataAmbientPrism?.syncUI?.();
  state.motion = Object.assign(
    {
      rotationEnabled: false,
      rotationSpeed: 30,
      rotationMultiplier: 1,
      rotationDirection: 'ccw',
      rotationTunnelLag: 0,
      rotationTunnelLagMultiplier: 1,
      cameraEnabled: false,
      cameraSpeed: 20,
      cameraMultiplier: 1,
      cameraAmount: 20,
      colorEnabled: false,
      colorSpeed: 20,
      colorMultiplier: 1,
      paletteKey: 'standard',
      quickToggleCamera: false,
      quickToggleColor: false,
    },
    settings.motion && typeof settings.motion === 'object' ? cloneData(settings.motion) : {},
  );
  normalizeMotionState();
  const legacyMotion = state.motion;
  for (let i = 0; i < state.layers.length; i++) {
    const raw = loadedLayers[i] || {},
      layer = state.layers[i];
    if (!raw.motionRotation || typeof raw.motionRotation !== 'object')
      layer.motionRotation = {
        enabled: legacyMotion.rotationEnabled === true,
        speed: legacyMotion.rotationSpeed,
        multiplier: legacyMotion.rotationMultiplier,
        direction: legacyMotion.rotationDirection,
        tunnelLag: legacyMotion.rotationTunnelLag,
        tunnelLagMultiplier: legacyMotion.rotationTunnelLagMultiplier,
      };
    normalizeLayerMotionRotation(layer);
  }

  state.motion.rotationEnabled = false;
  motionRuntime.lastTime = 0;
  motionRuntime.rotationRad = 0;
  motionRuntime.layerRotationRad.clear();
  motionRuntime.cameraPhase = 0;
  motionRuntime.colorPhase = 0;
  ensureMotionAnimation();
  syncMotionUI();

  const tunnelSettings = settings.tunnel || {};
  state.tunnel.spiralTravelRotation = tunnelSettings.spiralTravelRotation === true;
  state.tunnel.density = normalizeTunnelDensity(tunnelSettings.density);
  if (Number.isFinite(Number(tunnelSettings.speedStrength))) {
    let signed = Math.max(-1, Math.min(1, Number(tunnelSettings.speedStrength)));
    if (Number(tunnelSettings.signedSpeedVersion || 0) < 1 && tunnelSettings.direction === 'away')
      signed = -Math.abs(signed);
    state.tunnel.speedStrength = signed;
  }
  state.tunnel.signedSpeedVersion = 1;
  if (Number.isFinite(Number(tunnelSettings.speedMultiplier)))
    state.tunnel.speedMultiplier = Math.max(0, Number(tunnelSettings.speedMultiplier));
  if (Number.isFinite(Number(tunnelSettings.spacingStrength)))
    state.tunnel.spacingStrength = Math.max(0.2, Number(tunnelSettings.spacingStrength));
  if (Number.isFinite(Number(tunnelSettings.spacingMultiplier)))
    state.tunnel.spacingMultiplier = Math.max(0, Number(tunnelSettings.spacingMultiplier));
  if (Number.isFinite(Number(tunnelSettings.depthCurve)))
    state.tunnel.depthCurve = Math.max(-100, Math.min(100, Number(tunnelSettings.depthCurve)));
  if (Number.isFinite(Number(tunnelSettings.depthCurveMultiplier)))
    state.tunnel.depthCurveMultiplier = Math.max(0, Number(tunnelSettings.depthCurveMultiplier));
  state.tunnel.centerHiddenCopies = Number.isFinite(Number(tunnelSettings.centerHiddenCopies))
    ? Math.max(0, Math.min(TUNNEL_CENTER_HIDDEN_MAX, Math.round(Number(tunnelSettings.centerHiddenCopies))))
    : TUNNEL_CENTER_HIDDEN_DEFAULT;
  state.tunnel.spiralOuterCopies = Number.isFinite(Number(tunnelSettings.spiralOuterCopies))
    ? Math.max(0, Math.min(24, Math.round(Number(tunnelSettings.spiralOuterCopies))))
    : SPIRAL_OUTER_COPIES_DEFAULT;
  if (typeof tunnelSettings.colorShiftEnabled === 'boolean')
    state.tunnel.colorShiftEnabled = tunnelSettings.colorShiftEnabled;
  if (Number.isFinite(Number(tunnelSettings.colorShiftDegrees)))
    state.tunnel.colorShiftDegrees = Math.max(0, Math.min(360, Number(tunnelSettings.colorShiftDegrees)));
  if (typeof tunnelSettings.colorShiftCumulative === 'boolean')
    state.tunnel.colorShiftCumulative = tunnelSettings.colorShiftCumulative;
  else state.tunnel.colorShiftCumulative = false;
  if (typeof tunnelSettings.paletteLagEnabled === 'boolean')
    state.tunnel.paletteLagEnabled = tunnelSettings.paletteLagEnabled;
  normalizeTunnelColorShiftState();
  if (typeof tunnelSettings.fadeOversize === 'boolean')
    state.tunnel.fadeOversize = tunnelSettings.fadeOversize;

  let loadedFadeOffset = Number(tunnelSettings.fadeOffsetSteps);
  if (!Number.isFinite(loadedFadeOffset)) {
    const hasLegacyDistance =
      Number.isFinite(Number(tunnelSettings.fadeDistanceSteps)) ||
      Number.isFinite(Number(tunnelSettings.fadeSteps));
    const legacyDistance = Number.isFinite(Number(tunnelSettings.fadeDistanceSteps))
      ? Number(tunnelSettings.fadeDistanceSteps) * (Number(tunnelSettings.fadeDistanceMultiplier) || 1)
      : Number.isFinite(Number(tunnelSettings.fadeSteps))
        ? Number(tunnelSettings.fadeSteps)
        : 1;
    loadedFadeOffset = hasLegacyDistance ? Math.round(legacyDistance) : 2;
  }
  state.tunnel.fadeOffsetSteps = Math.max(-50, Math.min(50, Math.round(loadedFadeOffset)));
  if (Number.isFinite(Number(tunnelSettings.vignetteAmount))) {
    state.tunnel.vignetteAmount = tunnelVignettePixelsFromSettings(
      tunnelSettings,
      TUNNEL_VIGNETTE_DEFAULT_PX,
    );
    state.tunnel.fadeDurationSec = Number.isFinite(Number(tunnelSettings.fadeDurationSec))
      ? Math.max(0, Number(tunnelSettings.fadeDurationSec))
      : 3;
  } else {
    state.tunnel.vignetteAmount = Number.isFinite(Number(tunnelSettings.fadeDurationSec))
      ? legacyTunnelVignetteToPixels(Number(tunnelSettings.fadeDurationSec))
      : TUNNEL_VIGNETTE_DEFAULT_PX;
    state.tunnel.fadeDurationSec = 3;
  }
  state.tunnel.vignetteUnit = 'px';
  state.tunnel.vignetteMultiplier = Math.max(0.125, Number(tunnelSettings.vignetteMultiplier) || 1);

  state.tunnel.defaultActive = tunnelSettings.defaultActive === true;

  state.tunnel.optimizedCalculation = true;
  syncTunnelSettingsUI();

  if (settings.profileView && typeof settings.profileView === 'object') {
    Object.assign(PROFILE_CONFIG, settings.profileView);
  }

  const m = settings.morph || {
    intervalSec: settings.morphIntervalSec,
    vertexMin: settings.morphVertexMin,
    vertexMax: settings.morphVertexMax,
    vertexMultiplier: settings.morphVertexMultiplier,
    roundingMin: settings.morphRoundingMin,
    roundingMax: settings.morphRoundingMax,
    stepMin: settings.morphStepMin,
    stepMax: settings.morphStepMax,
    strokeWidthMin: settings.morphStrokeWidthMin,
    strokeWidthMax: settings.morphStrokeWidthMax,
    fadePercent: settings.morphFadePercent,
    options: settings.morphOptions,
  };
  state.morph.defaultActive = m.defaultActive === true;
  if (Number.isFinite(Number(m.intervalSec)))
    state.morph.intervalSec = Math.max(0.5, Math.min(60, Number(m.intervalSec)));
  state.morph.intervalMultiplier = Number.isFinite(Number(m.intervalMultiplier))
    ? Math.max(0.015625, Math.min(64, Number(m.intervalMultiplier)))
    : 1;
  if (typeof m.diversity === 'boolean') state.morph.diversity = m.diversity;
  state.morph.vertexMultiplier = normalizeMorphVertexMultiplier(
    m.vertexMultiplier ?? state.morph.vertexMultiplier ?? 1,
  );
  {
    const vertexRange = normalizeMorphVertexRangeValues(
      m.vertexMin ?? state.morph.vertexMin,
      m.vertexMax ?? state.morph.vertexMax,
      state.morph.vertexMultiplier,
    );
    state.morph.vertexMin = vertexRange.minN;
    state.morph.vertexMax = vertexRange.maxN;
  }
  if (Number.isFinite(Number(m.roundingMin)))
    state.morph.roundingMin = Math.max(0, Math.min(MAX_ROUNDING_PERCENT, Number(m.roundingMin)));
  if (Number.isFinite(Number(m.roundingMax)))
    state.morph.roundingMax = Math.max(
      state.morph.roundingMin,
      Math.min(MAX_ROUNDING_PERCENT, Number(m.roundingMax)),
    );
  if (Number.isFinite(Number(m.stepMin))) state.morph.stepMin = Math.max(0, Math.min(100, Number(m.stepMin)));
  if (Number.isFinite(Number(m.stepMax)))
    state.morph.stepMax = Math.max(state.morph.stepMin, Math.min(100, Number(m.stepMax)));
  if (typeof m.monoOrbitTransforms === 'boolean') state.morph.monoOrbitTransforms = m.monoOrbitTransforms;
  if (Number.isFinite(Number(m.orbitPercentMin)))
    state.morph.orbitPercentMin = Math.round(Math.max(0, Math.min(100, Number(m.orbitPercentMin))));
  if (Number.isFinite(Number(m.orbitPercentMax)))
    state.morph.orbitPercentMax = Math.round(
      Math.max(state.morph.orbitPercentMin, Math.min(100, Number(m.orbitPercentMax))),
    );
  if (Number.isFinite(Number(m.strokeWidthMin)))
    state.morph.strokeWidthMin = Math.max(0.5, Math.min(20, Number(m.strokeWidthMin)));
  if (Number.isFinite(Number(m.strokeWidthMax)))
    state.morph.strokeWidthMax = Math.max(state.morph.strokeWidthMin, Math.min(20, Number(m.strokeWidthMax)));
  if (Number.isFinite(Number(m.opacityMin)))
    state.morph.opacityMin = Math.round(Math.max(0, Math.min(100, Number(m.opacityMin))));
  if (Number.isFinite(Number(m.opacityMax)))
    state.morph.opacityMax = Math.round(
      Math.max(state.morph.opacityMin, Math.min(100, Number(m.opacityMax))),
    );
  if (Number.isFinite(Number(m.fillLayersMin)))
    state.morph.fillLayersMin = Math.max(0, Math.min(64, Math.round(Number(m.fillLayersMin))));
  if (Number.isFinite(Number(m.fillLayersMax)))
    state.morph.fillLayersMax = Math.max(
      state.morph.fillLayersMin,
      Math.min(64, Math.round(Number(m.fillLayersMax))),
    );
  if (Number.isFinite(Number(m.fillHueMin)))
    state.morph.fillHueMin = Math.max(-180, Math.min(180, Math.round(Number(m.fillHueMin))));
  if (Number.isFinite(Number(m.fillHueMax)))
    state.morph.fillHueMax = Math.max(
      state.morph.fillHueMin,
      Math.min(180, Math.round(Number(m.fillHueMax))),
    );
  if (typeof m.fillHueReset === 'boolean') state.morph.fillHueReset = m.fillHueReset;
  if (typeof m.fillHueHarmony === 'string' && PROJECT_FILL_HARMONY_KEYS.has(m.fillHueHarmony))
    state.morph.fillHueHarmony = m.fillHueHarmony;
  else if (typeof m.fillHueReset === 'boolean')
    state.morph.fillHueHarmony = m.fillHueReset ? 'native' : 'all';
  if (Number.isFinite(Number(m.sizeVariation)))
    state.morph.sizeVariation = Math.round(Math.max(0, Math.min(100, Number(m.sizeVariation))));
  state.morph.sizeVariationMultiplier = Number.isFinite(Number(m.sizeVariationMultiplier))
    ? Math.max(0, Number(m.sizeVariationMultiplier))
    : Number.isFinite(Number(m.sizeVariation))
      ? 1
      : state.morph.sizeVariationMultiplier;
  if (Number.isFinite(Number(m.radiusMin)))
    state.morph.radiusMin = Math.max(20, Math.min(500, Number(m.radiusMin)));
  if (Number.isFinite(Number(m.radiusMax)))
    state.morph.radiusMax = Math.max(state.morph.radiusMin ?? 20, Math.min(500, Number(m.radiusMax)));

  if (typeof m.normalizeSizes === 'boolean') state.morph.normalizeSizes = m.normalizeSizes;
  state.morph.rotationMinPercent = Number.isFinite(Number(m.rotationMinPercent))
    ? Math.round(Math.max(0, Math.min(100, Number(m.rotationMinPercent))))
    : state.morph.rotationMinPercent;
  state.morph.rotationMaxPercent = Number.isFinite(Number(m.rotationMaxPercent))
    ? Math.round(Math.max(state.morph.rotationMinPercent, Math.min(100, Number(m.rotationMaxPercent))))
    : state.morph.rotationMaxPercent;
  state.morph.rotationMultiplier = Number.isFinite(Number(m.rotationMultiplier))
    ? Math.max(0, Number(m.rotationMultiplier))
    : state.morph.rotationMultiplier;
  if (typeof m.rotationRandomDirection === 'boolean')
    state.morph.rotationRandomDirection = m.rotationRandomDirection;
  if (Number.isFinite(Number(m.fillOpacityMin)))
    state.morph.fillOpacityMin = Math.round(Math.max(0, Math.min(100, Number(m.fillOpacityMin))));
  if (Number.isFinite(Number(m.fillOpacityMax)))
    state.morph.fillOpacityMax = Math.round(
      Math.max(state.morph.fillOpacityMin, Math.min(100, Number(m.fillOpacityMax))),
    );
  state.morph.splinePoints = normalizeSplinePointCount(m.splinePoints ?? state.morph.splinePoints ?? 12);
  state.morph.profileModeTransition =
    m.profileModeTransition === 'second'
      ? 'start'
      : ['phase', 'start', 'end'].includes(m.profileModeTransition)
        ? m.profileModeTransition
        : 'phase';
  state.morph.profileModeTransitionPercent = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        Number(m.profileModeTransitionPercent ?? state.morph.profileModeTransitionPercent ?? 20) || 0,
      ),
    ),
  );
  state.morph.spiralOrderHoldPhases = SomataSpiralZeroTransition.holdPhases(m.spiralOrderHoldPhases);
  state.morph.spiralOrderMin = normalizeSpiralOrder(
    m.spiralOrderMin ?? state.morph.spiralOrderMin ?? -1,
    true,
  );
  state.morph.spiralOrderMax = normalizeSpiralOrder(
    m.spiralOrderMax ?? state.morph.spiralOrderMax ?? 1,
    true,
  );
  if (state.morph.spiralOrderMin > state.morph.spiralOrderMax)
    [state.morph.spiralOrderMin, state.morph.spiralOrderMax] = [
      state.morph.spiralOrderMax,
      state.morph.spiralOrderMin,
    ];
  state.morph.spiralOrderLinked = false;
  state.morph.lineColorPalette = normalizePlaylistPaletteKey(
    m.lineColorPalette,
    state.morph.lineColorPalette || 'standard',
  );
  state.morph.cyclePalettes = m.cyclePalettes === true;
  state.morph.fixedColors = m.fixedColors === true;
  state.morph.syncPalettesBetweenMorphs = m.syncPalettesBetweenMorphs !== false;
  state.morph.morphGlobalHueOffset = m.morphGlobalHueOffset === true;
  state.morph.globalHueOffsetRange = Number.isFinite(Number(m.globalHueOffsetRange))
    ? Math.max(0, Math.min(360, Math.round(Number(m.globalHueOffsetRange))))
    : (state.morph.globalHueOffsetRange ?? 180);
  state.morph.spiralLayersMin = Number.isFinite(Number(m.spiralLayersMin))
    ? Math.max(0, Math.min(64, Math.round(Number(m.spiralLayersMin))))
    : (state.morph.spiralLayersMin ?? 0);
  state.morph.spiralLayersMax = Number.isFinite(Number(m.spiralLayersMax))
    ? Math.max(state.morph.spiralLayersMin, Math.min(64, Math.round(Number(m.spiralLayersMax))))
    : (state.morph.spiralLayersMax ?? 1);
  state.morph.spiralTangentialChance = Number.isFinite(Number(m.spiralTangentialChance))
    ? Math.max(0, Math.min(100, Number(m.spiralTangentialChance)))
    : 50;
  if (typeof m.chaosMorphEnabled === 'boolean') state.morph.chaosMorphEnabled = m.chaosMorphEnabled;
  state.morph.chaosMorphStepSpread = Number.isFinite(Number(m.chaosMorphStepSpread))
    ? Math.max(0, Math.min(120, Math.round(Number(m.chaosMorphStepSpread))))
    : (state.morph.chaosMorphStepSpread ?? 1);
  state.morph.chaosMorphClosuresMax = Number.isFinite(Number(m.chaosMorphClosuresMax))
    ? Math.max(0, Math.min(120, Math.round(Number(m.chaosMorphClosuresMax))))
    : (state.morph.chaosMorphClosuresMax ?? 3);
  if (typeof m.preserveSpiralContinuity === 'boolean')
    state.morph.preserveSpiralContinuity = m.preserveSpiralContinuity;
  state.morph.spiralMorphType = normalizeSpiralMorphType(
    m.spiralMorphType,
    state.morph.preserveSpiralContinuity !== false,
  );
  state.morph.preserveSpiralContinuity = state.morph.spiralMorphType !== 'torn';
  state.morph.spiralRotationCompensation = false;
  if (typeof m.pauseOnSpace === 'boolean') state.morph.pauseOnSpace = m.pauseOnSpace;
  const legacyNormalizedMode = m.mode === 'normalized';
  const savedMode = [m.unifiedMode, m.mode]
    .map(SomataMorphRegistry.migrate)
    .find((key) => UNIFIED_MORPH_KEYS.includes(key));
  setUnifiedMorphMode(savedMode ?? 'circleSlide');
  // Тип морфинга спирали хранится отдельно (как в 13.2). Проекты, сохранённые с одним
  // общим типом, получают для спирали тот же тип, что и для многоугольника.
  setSpiralMorphMode(normalizeSpiralMorphMode(m.spiralMode, null) ?? savedMode ?? 'coordinated');
  if (Number.isFinite(Number(m.fadePercent)))
    state.morph.fadePercent = Math.round(Math.max(0, Math.min(100, Number(m.fadePercent))));
  state.morph.slideType = legacyNormalizedMode
    ? 'phase'
    : ['minimal', 'sector', 'phase'].includes(m.slideType)
      ? m.slideType
      : 'minimal';
  state.morph.speedType = m.speedType || state.morph.speedType;
  if (typeof m.lightningWhite === 'boolean') state.morph.lightningWhite = m.lightningWhite;
  if (typeof m.lightningRandom === 'boolean') state.morph.lightningRandom = m.lightningRandom;
  if (typeof m.lightningColor === 'string') state.morph.lightningColor = m.lightningColor;
  if (Number.isFinite(Number(m.lightningSegmentPercent)))
    state.morph.lightningSegmentPercent = Math.max(5, Math.min(100, Number(m.lightningSegmentPercent)));
  if (Number.isFinite(Number(m.lightningGlow)))
    state.morph.lightningGlow = Math.max(0, Math.min(80, Number(m.lightningGlow)));
  if (m.options && typeof m.options === 'object')
    state.morph.options = { ...state.morph.options, ...m.options };
  if (m.shapeOptions && typeof m.shapeOptions === 'object') {
    const incomingShape = m.shapeOptions;
    state.morph.shapeOptions = { ...state.morph.shapeOptions, ...incomingShape };
    if (!Array.isArray(incomingShape.profileGroups)) {
      if (MORPH_PROFILE_GROUP_KEYS.includes(incomingShape.profileGroup)) {
        state.morph.shapeOptions.profileGroups = [incomingShape.profileGroup];
      } else if (incomingShape.standardOnly === true) {
        state.morph.shapeOptions.profileGroups = ['standard'];
      } else if (incomingShape.profileGroup === 'all') {
        state.morph.shapeOptions.profileGroups = MORPH_PROFILE_GROUP_KEYS.slice();
      }
    }
  }

  if (Number.isFinite(Number(settings.randomLayerCount)))
    state.randomLayerCount = Math.max(1, Math.min(8, Number(settings.randomLayerCount)));
  if (settings.randomOptions && typeof settings.randomOptions === 'object')
    state.randomOptions = { ...state.randomOptions, ...settings.randomOptions };
  state.randomOptions.lineColorPalette = normalizePlaylistPaletteKey(
    state.randomOptions.lineColorPalette,
    'standard',
  );
  state.randomOptions.fixedColors = state.randomOptions.fixedColors === true;
  if (Number.isFinite(Number(settings.randomLayerCount)))
    state.randomLayerCount = Math.max(1, Math.min(8, Number(settings.randomLayerCount)));
  state.minimalMorph.defaultActive = settings.minimalMorph?.defaultActive === true;
  if (settings.minimalMorph && typeof settings.minimalMorph === 'object') {
    const incomingOrangeGroups = Array.isArray(settings.minimalMorph.profileGroups)
      ? [
          ...new Set(
            settings.minimalMorph.profileGroups
              .map((group) => (group === 'noLoops' ? 'closed' : group))
              .filter((group) => PROFILE_PRESET_GROUP_ORDER.includes(group)),
          ),
        ]
      : [];
    state.minimalMorph.profileGroups = incomingOrangeGroups.length
      ? incomingOrangeGroups
      : [normalizeOrangeMorphProfileGroup(settings.minimalMorph.mode)];
    state.minimalMorph.mode = state.minimalMorph.profileGroups[0] || 'standard';
    state.minimalMorph.family = normalizeOrangeMorphFamily(settings.minimalMorph.family);
    if (Number.isFinite(Number(settings.minimalMorph.intervalSec)))
      state.minimalMorph.intervalSec = Math.max(
        0.5,
        Math.min(120, Number(settings.minimalMorph.intervalSec)),
      );
    state.minimalMorph.intervalMultiplier = Number.isFinite(Number(settings.minimalMorph.intervalMultiplier))
      ? Math.max(0.015625, Math.min(64, Number(settings.minimalMorph.intervalMultiplier)))
      : 1;
    if (Number.isFinite(Number(settings.minimalMorph.fadeSec)))
      state.minimalMorph.fadeSec = Math.max(0.1, Math.min(30, Number(settings.minimalMorph.fadeSec)));
    if (typeof settings.minimalMorph.instantSwitch === 'boolean')
      state.minimalMorph.instantSwitch = settings.minimalMorph.instantSwitch;
  }
  window.SomataMorphParameterRouting?.ensureProfiles?.(state.morph, state.minimalMorph);
  window.SomataOrangeMorphProfiles?.ensureProfiles?.(
    state.minimalMorph,
    state.randomOptions,
    state.randomLayerCount,
  );
  if (state.minimalMorph?.activeProfileId)
    window.SomataOrangeMorphProfiles?.select?.(
      state.minimalMorph,
      state.randomOptions,
      orangeProfileLayerCountHolder(),
      state.minimalMorph.activeProfileId,
    );
  window.SomataMorphParameterRouting?.resetRuntime?.(runtimeState.morph);
  if (settings.tapTempo && typeof settings.tapTempo === 'object') {
    const t = settings.tapTempo;
    if (Number.isFinite(Number(t.bpm))) state.tapTempo.bpm = Math.max(0, Math.min(300, Number(t.bpm)));
    if (Number.isFinite(Number(t.beatsPerMorph)))
      state.tapTempo.beatsPerMorph = Math.max(1, Math.min(64, Math.round(Number(t.beatsPerMorph))));
    if (typeof t.autoTap === 'boolean') state.tapTempo.autoTap = t.autoTap;
    if (Number.isFinite(Number(t.autoWindowSec)))
      state.tapTempo.autoWindowSec = Math.max(1, Number(t.autoWindowSec));
    if (['low', 'lowMid', 'mid', 'midHigh', 'high', 'combined'].includes(t.autoBand))
      state.tapTempo.autoBand = t.autoBand;
    state.tapTempo.syncFullMorph =
      typeof t.syncFullMorph === 'boolean' ? t.syncFullMorph : state.tapTempo.bpm > 0;
    state.tapTempo.syncMinimalMorph =
      typeof t.syncMinimalMorph === 'boolean' ? t.syncMinimalMorph : state.tapTempo.bpm > 0;
    state.tapTempo.anchorTime = performance.now();
    state.tapTempo.tapTimes = [];
    state.tapTempo.autoBeatTimes = [];
    resetTempoLock(true); // imported project's BPM supersedes the old live lock
  }
  if (settings.audioReactive && typeof settings.audioReactive === 'object') {
    const a = settings.audioReactive;
    state.audioReactive.masterEditEnabled = false;
    state.audioReactive.bandGains = { low: 1, lowMid: 1, mid: 1, midHigh: 1, high: 1 };
    if (Number.isFinite(Number(a.bandCount)))
      state.audioReactive.bandCount = Math.max(1, Math.min(5, Math.round(Number(a.bandCount))));
    if (typeof a.customBandsEnabled === 'boolean')
      state.audioReactive.customBandsEnabled = a.customBandsEnabled;
    if (Array.isArray(a.masterBandEdges))
      state.audioReactive.masterBandEdges = a.masterBandEdges.map(Number).filter(Number.isFinite).slice(0, 4);
    if (a.customBandRanges && typeof a.customBandRanges === 'object')
      state.audioReactive.customBandRanges = {
        ...state.audioReactive.customBandRanges,
        ...cloneData(a.customBandRanges),
      };
    if (a.bandGains && typeof a.bandGains === 'object') {
      for (const key of ['low', 'lowMid', 'mid', 'midHigh', 'high']) {
        const v = Number(a.bandGains[key]);
        if (Number.isFinite(v)) state.audioReactive.bandGains[key] = Math.max(0, v);
      }
    }
    if (typeof a.defaultRoutesEnabled === 'boolean')
      state.audioReactive.defaultRoutesEnabled = a.defaultRoutesEnabled;
    if (a.source === 'microphone' || a.source === 'system') state.audioReactive.source = a.source;
    if (typeof a.noiseGateEnabled === 'boolean') state.audioReactive.noiseGateEnabled = a.noiseGateEnabled;
    if (Number.isFinite(Number(a.noiseGateThresholdDb)))
      state.audioReactive.noiseGateThresholdDb = Math.max(-100, Math.min(0, Number(a.noiseGateThresholdDb)));
    if (typeof a.noiseGateSoftEnabled === 'boolean')
      state.audioReactive.noiseGateSoftEnabled = a.noiseGateSoftEnabled;
    if (Number.isFinite(Number(a.noiseGateStrength)))
      state.audioReactive.noiseGateStrength = Math.max(0, Math.min(100, Number(a.noiseGateStrength)));
    if (Number.isFinite(Number(a.highPassHz)))
      state.audioReactive.highPassHz = Math.max(20, Math.min(20000, Number(a.highPassHz)));
    else state.audioReactive.highPassHz = 20;
    if (Number.isFinite(Number(a.lowPassHz)))
      state.audioReactive.lowPassHz = Math.max(
        state.audioReactive.highPassHz,
        Math.min(20000, Number(a.lowPassHz)),
      );
    else state.audioReactive.lowPassHz = 20000;
    if (Number.isFinite(Number(a.lowHz)))
      state.audioReactive.lowHz = Math.max(
        state.audioReactive.highPassHz,
        Math.min(state.audioReactive.lowPassHz, Number(a.lowHz)),
      );
    if (Number.isFinite(Number(a.highHz)))
      state.audioReactive.highHz = Math.max(
        state.audioReactive.lowHz,
        Math.min(state.audioReactive.lowPassHz, Number(a.highHz)),
      );
    if (typeof a.normalizeLowSignal === 'boolean')
      state.audioReactive.normalizeLowSignal = a.normalizeLowSignal;
    if (typeof a.inputSmoothingEnabled === 'boolean')
      state.audioReactive.inputSmoothingEnabled = a.inputSmoothingEnabled;
    if (Number.isFinite(Number(a.inputSmoothingStrength)))
      state.audioReactive.inputSmoothingStrength = Math.max(
        0,
        Math.min(100, Number(a.inputSmoothingStrength)),
      );
    if (Number.isFinite(Number(a.inputSmoothingMultiplier)))
      state.audioReactive.inputSmoothingMultiplier = Math.max(0, Number(a.inputSmoothingMultiplier));
    if (Number.isFinite(Number(a.masterGainStrength)))
      state.audioReactive.masterGainStrength = Math.max(0, Math.min(200, Number(a.masterGainStrength)));
    if (Number.isFinite(Number(a.masterGainMultiplier)))
      state.audioReactive.masterGainMultiplier = Math.max(0, Number(a.masterGainMultiplier));
    state.audioReactive.effectsAmplitudeStrength = Number.isFinite(Number(a.effectsAmplitudeStrength))
      ? Math.max(0, Math.min(200, Number(a.effectsAmplitudeStrength)))
      : 50;
    state.audioReactive.effectsAmplitudeMultiplier = Number.isFinite(Number(a.effectsAmplitudeMultiplier))
      ? Math.max(0, Number(a.effectsAmplitudeMultiplier))
      : 1;
    if (Number.isFinite(Number(a.sizeStrength)))
      state.audioReactive.sizeStrength = Math.max(0, Math.min(2, Number(a.sizeStrength)));
    if (Number.isFinite(Number(a.sizeMultiplier)))
      state.audioReactive.sizeMultiplier = Math.max(0, Number(a.sizeMultiplier));
    if (typeof a.rotationEnabled === 'boolean') state.audioReactive.rotationEnabled = a.rotationEnabled;
    if (Number.isFinite(Number(a.rotationStrength)))
      state.audioReactive.rotationStrength = Math.max(0, Math.min(2, Number(a.rotationStrength)));
    if (Number.isFinite(Number(a.rotationMultiplier)))
      state.audioReactive.rotationMultiplier = Math.max(0, Number(a.rotationMultiplier));
    {
      const supportedReactionMs = [16, 24, 40, 60, 80, 120, 160, 240];
      const savedReactionMs = Number.isFinite(Number(a.analysisIntervalMs))
        ? Number(a.analysisIntervalMs)
        : Number.isFinite(Number(a.meterIntervalMs))
          ? Number(a.meterIntervalMs)
          : 40;
      const requestedReactionMs = Math.max(16, Math.min(240, Math.round(savedReactionMs)));
      const reactionMs = supportedReactionMs.reduce(
        (best, value) =>
          Math.abs(value - requestedReactionMs) < Math.abs(best - requestedReactionMs) ? value : best,
        supportedReactionMs[0],
      );
      state.audioReactive.analysisIntervalMs = reactionMs;
      state.audioReactive.meterIntervalMs = reactionMs;
    }
    state.audioReactive.masterRouteMultipliers =
      a.masterRouteMultipliers && typeof a.masterRouteMultipliers === 'object'
        ? cloneData(a.masterRouteMultipliers)
        : {};
    state.audioReactive.groupToggleMemory =
      a.groupToggleMemory && typeof a.groupToggleMemory === 'object' && !Array.isArray(a.groupToggleMemory)
        ? cloneData(a.groupToggleMemory)
        : {};
    state.audioReactive.layerSignalEnabled =
      a.layerSignalEnabled && typeof a.layerSignalEnabled === 'object' && !Array.isArray(a.layerSignalEnabled)
        ? cloneData(a.layerSignalEnabled)
        : {};
    if (a.routes && typeof a.routes === 'object') {
      state.audioReactive.routes = {
        master: Array.isArray(a.routes.master) ? a.routes.master.map(normalizeAudioRoute) : [],
        layers:
          a.routes.layers && typeof a.routes.layers === 'object'
            ? Object.fromEntries(
                Object.entries(a.routes.layers).map(([id, rows]) => [
                  id,
                  Array.isArray(rows) ? rows.map(normalizeAudioRoute) : [],
                ]),
              )
            : {},
      };
      state.audioReactive.routingInitialized = true;
    } else {
      state.audioReactive.routes = { master: [], layers: {} };
      state.audioReactive.routingInitialized = false;
    }
    if (typeof a.routingTarget === 'string') state.audioReactive.routingTarget = a.routingTarget;
    state.audioReactive.routingPreset = AUDIO_ROUTING_PRESETS.has(a.routingPreset)
      ? a.routingPreset
      : a.routes
        ? 'free'
        : 'geometryLamps';
    ensureAudioRoutingState();
    renderAudioMeters();
    renderAudioCustomBandRows();
    syncAudioCutoffs();
  }
  if (
    settings.playback &&
    typeof settings.playback === 'object' &&
    ['full', 'minimal'].includes(settings.playback.lastMorphType)
  ) {
    state.morphPlayback.lastType = settings.playback.lastMorphType;
  }
  syncAudioSettingsUIFromState();
  renderAudioRoutingPanel();
  syncTapUI();
  state.library = {
    shapes: Array.isArray(parsed.library?.shapes) ? parsed.library.shapes : [],
    morphs: [],
    defaultMorphId: null,
  };
  const bgDot = document.getElementById('bgColorDot');
  const circleDot = document.getElementById('boundingCircleColorDot');
  const bgInput = document.getElementById('paramBgColor');
  const circleInput = document.getElementById('paramBoundingCircleColor');
  if (bgInput) bgInput.value = state.bgColor;
  if (circleInput) circleInput.value = state.boundingCircleColor;
  if (bgDot) bgDot.style.background = state.bgColor;
  if (circleDot) circleDot.style.background = state.boundingCircleColor;

  if (preserveFullMorph && runtimeState.morph.active) {
    runtimeState.morph.paused = preservedFullMorphPaused;
    activeRebaseMorphing();
    syncMorphSettingsUI();
  } else if (loadOptions.applyProjectDefaultModes !== false) {
    activateProjectDefaultModes(null, 'project-load');
  }
  if (preserveMinimalMorph && runtimeState.minimalMorph.active) {
    activeRebaseMinimalMorphing();
    syncRandomSettingsUI();
  }
  // Project loading mutates effect state without firing the checkbox/change handlers.
  // Reconcile the same animation lifecycle used by interactive UI so static Lightning keeps ticking.
  ensureSweepAnimation();
  requestMainCanvasRender();
}
async function openProject() {
  stopProjectMorphing(false);
  try {
    let file;
    if (window.showOpenFilePicker) {
      const [handle] = await window.showOpenFilePicker({
        types: [
          {
            description: 'Somata project',
            accept: { 'application/json': ['.sproj', '.spiroproject', '.spirostar', '.json'] },
          },
        ],
        multiple: false,
      });
      if (!handle) return;
      state.projectFileHandle = handle;
      state.projectFileName = handle.name || '';
      file = await handle.getFile();
    } else {
      document.getElementById('fileInputJSON').click();
      return;
    }
    quiesceProjectRuntimeForCommit();
    state.playlistOverridesActive = false;
    state.playlistCurrentProjectId = null;
    applyLoadedProject(JSON.parse(await file.text()));
    state.draftProjectName = sanitizeProjectFileBase(
      file.name || state.projectFileName || 'Проект один',
      'Проект один',
    );
    if (!state.layers.some((layer) => layer?.id === state.activeLayerId))
      state.activeLayerId = state.layers[0]?.id || null;
    renderProjectChooser();
    updateLayerListUI();
    syncSidebarInputs();
    syncMorphSettingsUI();
    syncRandomSettingsUI();
    renderProfileEditor();
    renderMainCanvas();
  } catch (err) {
    if (err?.name !== 'AbortError') {
      console.error('Somata project load failed:', err);
      alert('Не удалось загрузить проект Somata: ' + (err?.message || 'ошибка чтения файла'));
    }
  }
}
function downloadJsonFile(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
function applySettingsFile(parsed) {
  if (!parsed || (parsed.format && parsed.format !== 'SpiroStarSettings') || !parsed.settings)
    throw new Error('Invalid settings file');

  const keepLayers = state.layers;
  const keepLibrary = state.library;
  applyLoadedProject(
    { layers: cloneData(state.layers), settings: parsed.settings, library: cloneData(state.library) },
    { applyProjectDefaultModes: false },
  );
  state.layers = keepLayers;
  state.library = keepLibrary;

  const ds = parsed.settings || {};
  for (const layer of state.layers) {
    ensureLayerEffectState(layer);
    if (typeof ds.showLamps === 'boolean') layer.showLamps = ds.showLamps;
    if (typeof ds.showWeb === 'boolean') layer.showWeb = ds.showWeb;
    if (ds.web && typeof ds.web === 'object') {
      const incomingWeb = cloneData(ds.web);
      if (
        !['inside', 'outsideStraight', 'outsideArc'].some((k) =>
          Object.prototype.hasOwnProperty.call(incomingWeb, k),
        )
      ) {
        const legacy = ['inside', 'outside', 'combined'].includes(incomingWeb.region)
          ? incomingWeb.region
          : 'inside';
        incomingWeb.inside = legacy !== 'outside';
        incomingWeb.outsideStraight = false;
        incomingWeb.outsideArc = legacy !== 'inside';
      }
      layer.web = { ...createDefaultWebConfig(), ...incomingWeb };
    }
    if (ds.sweep && typeof ds.sweep === 'object') {
      const incomingSweep = cloneData(ds.sweep);
      incomingSweep.lightningBehavior = Object.prototype.hasOwnProperty.call(
        incomingSweep,
        'lightningBehavior',
      )
        ? normalizeLightningBehaviorValue(incomingSweep.lightningBehavior, 'symmetric')
        : 'symmetric';
      incomingSweep.lightningPrecision = normalizeLightningPrecisionValue(incomingSweep.lightningPrecision);
      normalizeSweepConfig(incomingSweep);
      layer.sweep = { ...createDefaultSweepConfig(), ...incomingSweep, raf: 0 };
      normalizeSweepConfig(layer.sweep);
    }
    if (ds.lamps && typeof ds.lamps === 'object')
      layer.lamps = { ...cloneLampConfig(state.lamps), ...cloneData(ds.lamps) };
    ensureLayerLampState(layer);
  }
  state.activeLayerId = state.layers[0]?.id || null;
  syncTunnelSettingsUI();
  syncMorphSettingsUI();
  syncRandomSettingsUI();
  syncAudioSettingsUIFromState();
  syncSidebarInputs();
  renderProfileEditor();
  requestMainCanvasRender();
}
async function saveDefaultSettingsFile() {
  const settings = cloneData(buildProjectData().settings);

  settings.lamps = cloneLampConfig(getActiveLampConfig());
  settings.showLamps = getLayerLampsEnabled(getActiveEffectLayer());
  settings.showWeb = getLayerWebEnabled(getActiveEffectLayer());
  settings.web = cloneData(getLayerWebConfig(getActiveEffectLayer()));
  settings.sweep = cloneData(getLayerSweepConfig(getActiveEffectLayer()));
  state.playlistDefaultSettings = settings;
  showShortcutToast('Текущие настройки сохранены как умолчания этого плейлиста');

  if (state.playlistFileHandle) await savePlaylistToDisk(false);
}
async function clearDefaultSettings() {
  state.playlistDefaultSettings = null;
  showShortcutToast('Настройки по умолчанию этого плейлиста сброшены');
  if (state.playlistFileHandle) await savePlaylistToDisk(false);
}
function buildShapeFileData() {
  return {
    format: 'SpiroStarShapes',
    version: '7.5',
    savedAt: new Date().toISOString(),
    layers: cloneData(state.layers),
  };
}
async function saveShapeFile() {
  const data = buildShapeFileData();
  const json = JSON.stringify(data, null, 2);
  try {
    if (window.showSaveFilePicker) {
      const handle = await window.showSaveFilePicker({
        suggestedName: `Somata_Shapes_${Date.now()}.spiroshape`,
        types: [{ description: 'Somata figures', accept: { 'application/json': ['.spiroshape', '.json'] } }],
      });
      if (!handle) return;
      const writable = await handle.createWritable();
      await writable.write(json);
      await writable.close();
      return;
    }
  } catch (err) {
    if (err?.name === 'AbortError') return;
  }
  downloadJsonFile(data, `Somata_Shapes_${Date.now()}.spiroshape`);
}
function applyShapeFile(parsed) {
  parsed = migrateFourierProjectData(parsed);
  if (
    !parsed ||
    parsed.format !== 'SpiroStarShapes' ||
    !Array.isArray(parsed.layers) ||
    !parsed.layers.length
  )
    throw new Error('Invalid shape file');
  activeStopMinimalMorphing();
  activeStopMorphing();
  const defaults = { ...createLayer(), roundingMode: 'standard' }; // legacy files without an explicit radius policy
  state.layers = parsed.layers.map((l, idx) => {
    const application = ['stroke', 'graffiti'].includes(l.lineProfileApplication)
      ? l.lineProfileApplication
      : 'stroke';
    const legacyProfile = normalizeLineProfileValue(
      l.lineProfile,
      application === 'graffiti' ? 'slash' : 'round',
    );
    const lineProfileStroke = ['round', 'slash', 'square', 'circle', 'cross'].includes(l.lineProfileStroke)
      ? l.lineProfileStroke
      : application === 'stroke'
        ? legacyProfile
        : defaults.lineProfileStroke;
    const lineProfileGraffiti = 'slash';
    const lineMarkerType = normalizeLineMarkerType(
      l.lineMarkerType || (legacyProfile !== 'round' ? legacyProfile : 'slash'),
      'slash',
    );
    return {
      ...defaults,
      ...l,
      roundingShape: 'hybrid', // migrate imported .spiroshape files
      audioNativeBandAuto:
        l.audioNativeBandAuto === true || (l.audioNativeBand == null && l.audioNativeBandAuto !== false),
      sprite:
        l.sprite && typeof l.sprite === 'object'
          ? normalizeLineSpriteConfig(l.sprite)
          : cloneData(defaults.sprite),
      lineMotionFx: normalizeLineMotionFxConfig(
        l.lineMotionFx && typeof l.lineMotionFx === 'object' ? l.lineMotionFx : defaults.lineMotionFx,
      ),
      particles: normalizeParticleConfig(l.particles),
      lineProfile: lineProfileStroke,
      lineProfileApplication: application,
      lineProfileStroke,
      lineProfileGraffiti,
      lineMarkerType,
      graffitiAngle: Number.isFinite(Number(l.graffitiAngle))
        ? Math.max(-90, Math.min(90, Number(l.graffitiAngle)))
        : (defaults.graffitiAngle ?? 45),
      graffitiAngleMode: ['absolute', 'relative'].includes(l.graffitiAngleMode)
        ? l.graffitiAngleMode
        : 'absolute',
      graffitiNibShape: ['pointed', 'blunt', 'pinched', 'round'].includes(l.graffitiNibShape)
        ? l.graffitiNibShape
        : defaults.graffitiNibShape,
      graffitiNibLength: Number.isFinite(Number(l.graffitiNibLength))
        ? Math.max(1, Math.min(20, Number(l.graffitiNibLength)))
        : defaults.graffitiNibLength,
      graffitiNibLengthMultiplier: Number.isFinite(Number(l.graffitiNibLengthMultiplier))
        ? Math.max(0.01, Number(l.graffitiNibLengthMultiplier))
        : defaults.graffitiNibLengthMultiplier,
      graffitiVariationMode: ['perSegment', 'everyNth', 'across', 'perPath', 'whole'].includes(
        l.graffitiVariationMode,
      )
        ? l.graffitiVariationMode
        : defaults.graffitiVariationMode,
      graffitiVariationEveryN: Number.isFinite(Number(l.graffitiVariationEveryN))
        ? Math.max(1, Math.min(24, Math.round(Number(l.graffitiVariationEveryN))))
        : defaults.graffitiVariationEveryN,
      graffitiSizeVariationEnabled: l.graffitiSizeVariationEnabled === true,
      graffitiSizeVariation: Number.isFinite(Number(l.graffitiSizeVariation))
        ? Math.max(0, Math.min(100, Number(l.graffitiSizeVariation)))
        : defaults.graffitiSizeVariation,
      graffitiSizeFocus: Number.isFinite(Number(l.graffitiSizeFocus))
        ? Math.max(0, Math.min(100, Number(l.graffitiSizeFocus)))
        : defaults.graffitiSizeFocus,
      graffitiRotationVariationEnabled: l.graffitiRotationVariationEnabled === true,
      graffitiRotationVariation: Number.isFinite(Number(l.graffitiRotationVariation))
        ? Math.max(0, Math.min(180, Number(l.graffitiRotationVariation)))
        : defaults.graffitiRotationVariation,
      graffitiRotationMultiplier: Number.isFinite(Number(l.graffitiRotationMultiplier))
        ? Math.max(0, Number(l.graffitiRotationMultiplier))
        : defaults.graffitiRotationMultiplier,
      graffitiRotationFocus: Number.isFinite(Number(l.graffitiRotationFocus))
        ? Math.max(0, Math.min(100, Number(l.graffitiRotationFocus)))
        : defaults.graffitiRotationFocus,
      graffitiBaseStrokeWidth: Number.isFinite(Number(l.graffitiBaseStrokeWidth))
        ? Math.max(0.5, Math.min(20, Number(l.graffitiBaseStrokeWidth)))
        : null,
      splineRenderMode: normalizeSplineRenderMode(l.splineRenderMode ?? defaults.splineRenderMode),
      wholeCurveSpline: l.wholeCurveSpline === true,
      id: l.id || createLayerId(),
      name: l.name || `Слой ${idx + 1}`,
    };
  });
  for (const layer of state.layers) {
    delete layer.fourierStrength;
    delete layer.graffitiDistressEnabled;
    delete layer.graffitiDistress;
    ensureLayerEffectState(layer);
  }
  state.activeLayerId = state.layers[0].id;
  updateLayerListUI();
  syncSidebarInputs();
  renderProfileEditor();
  requestMainCanvasRender();
}
async function openShapeFile() {
  try {
    if (window.showOpenFilePicker) {
      const [handle] = await window.showOpenFilePicker({
        types: [{ description: 'Somata figures', accept: { 'application/json': ['.spiroshape', '.json'] } }],
        multiple: false,
      });
      if (!handle) return;
      const file = await handle.getFile();
      applyShapeFile(JSON.parse(await file.text()));
      return;
    }
    document.getElementById('fileInputShape')?.click();
  } catch (err) {
    if (err?.name !== 'AbortError') alert('Некорректный файл фигур Somata.');
  }
}
function saveCurrentShape() {
  const name = prompt('Название фигуры:', `Фигура ${(state.library?.shapes?.length || 0) + 1}`);
  if (!name) return;
  state.library.shapes.push({
    id: createLayerId('shape'),
    name: uniqueShapeLibraryName(name),
    createdAt: new Date().toISOString(),
    layers: cloneData(state.layers),
  });
  renderLibrary('shapes');
  saveProjectToDisk(false);
}

export {
  applyLoadedProject,
  applySettingsFile,
  applyShapeFile,
  clearDefaultSettings,
  openProject,
  openShapeFile,
  saveCurrentShape,
  saveDefaultSettingsFile,
  saveShapeFile,
};
