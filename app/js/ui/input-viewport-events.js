// Ввод, события вьюпорта и кнопка «Новый проект».
import { TUNNEL_DENSITY_DEFAULT } from '../corridor/corridor-density.js';
import './preset-random-morph.js'; // initialisation order: this module runs after it
import { renderProfileEditor } from './profile-editor.js';
import {
  audioMasterRouteRuntime,
  ensureAudioRoutingState,
  setAudioMasterRouteStateRef,
} from '../audio/audio-routing.js';
import { resetLightningRateRuntimeForProject } from '../effects/lightning.js';
import { syncMotionUI, syncSweepUI } from './effects-sidebar.js';
import { createLayer, ensureLayerEffectState, getLayerSweepConfig } from '../core/defaults-layers.js';
import { normalizePlaylistColorPalettes } from '../core/palette.js';
import { applyVignetteVisibility } from '../core/render-runtime.js';
import { requestMainCanvasRender } from '../core/scheduler.js';
import { replaceRuntimeBoundSection, runtimeState, state } from '../core/state.js';
import { ensureMotionAnimation, motionRuntime } from '../effects/motion.js';
import { renderMainCanvas } from '../render/main-pipeline.js';
import { mainCanvas } from './profile-presets.js';
import {
  SPIRAL_OUTER_COPIES_DEFAULT,
  TUNNEL_CENTER_HIDDEN_DEFAULT,
} from '../corridor/corridor-appearance.js';
import { TUNNEL_VIGNETTE_DEFAULT_PX } from '../corridor/corridor-instances.js';
import { setTunnelMode, syncTunnelSettingsUI } from './corridor-panel.js';
import { updateLayerListUI } from './layer-selection.js';
import { syncSidebarInputs } from './sidebar-sync.js';
import { activeStopMinimalMorphing, activeStopMorphing } from '../morph-runtime/morph-hooks.js';
import { resetTapTempo } from '../audio/tap-tempo.js';
import { renderPlaylistPaletteButtons } from './playlist-palettes.js';
import { syncRandomSettingsUI } from './orange-morph/routing-ui.js';
import { syncMorphSettingsUI } from './morph-settings-panel.js';
import {
  applyTransparentDesktopMode,
  clearViewportBackgroundImage,
  syncSceneBlendUI,
} from './viewport-background.js';
import { bindMasterAndDisplayControls } from './controls/master-display.js';
import { bindLayerGeometryAndStyleControls } from './controls/layer-geometry-style.js';
import { bindLayerCollectionControls, bindProfileEditorControls } from './controls/profile-and-layers.js';
import { bindPresetRandomMorphControls, bindRandomPanelAndMorphRebaseHooks } from './preset-random-morph.js';
import { applyPlaylistOverrides, captureMenuSettings } from '../project/project-data.js';
import { stopProjectMorphing } from '../project/project-morph.js';
import { renderProjectChooser } from '../project/playlist.js';
import { syncAudioSettingsUIFromState } from '../audio/audio-reactive.js';
import {
  captureStartupControlDefaults,
  installEditableMultiplierSummaries,
  installLogarithmicNumberSteppers,
} from './number-steppers.js';

function bindInputEvents() {
  const bindingContext = Object.freeze({
    getActiveLayer: () => state.layers.find((l) => l.id === state.activeLayerId),
  });
  bindMasterAndDisplayControls(bindingContext);
  bindLayerGeometryAndStyleControls(bindingContext);
  bindProfileEditorControls(bindingContext);
  bindLayerCollectionControls(bindingContext);
  bindPresetRandomMorphControls(bindingContext);
  bindRandomPanelAndMorphRebaseHooks(bindingContext);
}
function bindViewportEvents() {
  const viewportSurface = document.getElementById('mainContainer') || mainCanvas;
  const viewportGestureAllowed = (target) =>
    !target?.closest?.(
      'button,input,select,textarea,a,label,[role=\"button\"],#floatingViewportControls,#fpsCounter,[contenteditable=\"true\"],.no-viewport-gesture',
    );
  document.getElementById('btnZoomIn').addEventListener('click', () => {
    state.zoom = Math.min(state.zoom * 1.2, 5.0);
    document.getElementById('zoomDisplay').textContent = Math.round(state.zoom * 100) + '%';
    renderMainCanvas();
  });

  document.getElementById('btnZoomOut').addEventListener('click', () => {
    state.zoom = Math.max(state.zoom / 1.2, 0.2);
    document.getElementById('zoomDisplay').textContent = Math.round(state.zoom * 100) + '%';
    renderMainCanvas();
  });

  document.getElementById('btnResetView').addEventListener('click', () => {
    state.zoom = window.matchMedia(
      '(max-width: 760px), (max-height: 480px) and (hover: none) and (pointer: coarse)',
    ).matches
      ? 0.9
      : 1.0;
    state.panX = 0;
    state.panY = 0;
    document.getElementById('zoomDisplay').textContent = Math.round(state.zoom * 100) + '%';
    renderMainCanvas();
  });

  document.getElementById('zoomDisplay')?.addEventListener('dblclick', (e) => {
    e.preventDefault();
    e.stopPropagation();
    state.zoom = 1.0;
    document.getElementById('zoomDisplay').textContent = '100%';
    renderMainCanvas();
  });

  viewportSurface.addEventListener('mousedown', (e) => {
    if (!viewportGestureAllowed(e.target)) return;
    if (e.button === 0 || e.button === 1) {
      state.isPanning = true;
      state.lastMousePos = { x: e.clientX, y: e.clientY };
      viewportSurface.style.cursor = 'grabbing';
    }
  });

  window.addEventListener('mousemove', (e) => {
    if (state.isPanning) {
      const dx = e.clientX - state.lastMousePos.x;
      const dy = e.clientY - state.lastMousePos.y;
      state.panX += dx;
      state.panY += dy;
      state.lastMousePos = { x: e.clientX, y: e.clientY };
      renderMainCanvas();
    }
  });

  window.addEventListener('mouseup', () => {
    if (state.isPanning) {
      state.isPanning = false;
      viewportSurface.style.cursor = 'default';
    }
  });

  viewportSurface.addEventListener(
    'wheel',
    (e) => {
      if (!viewportGestureAllowed(e.target)) return;
      e.preventDefault();
      const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
      state.zoom = Math.max(0.2, Math.min(5.0, state.zoom * zoomFactor));
      document.getElementById('zoomDisplay').textContent = Math.round(state.zoom * 100) + '%';
      renderMainCanvas();
    },
    { passive: false },
  );

  let canvasTouchMode = null;
  let canvasLastTouch = null;
  let pinchStartDistance = 0;
  let pinchStartZoom = 1;
  let pinchLastMid = null;

  const touchDistance = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  const touchMidpoint = (a, b) => ({
    x: (a.clientX + b.clientX) / 2,
    y: (a.clientY + b.clientY) / 2,
  });

  viewportSurface.addEventListener(
    'touchstart',
    (e) => {
      if (!viewportGestureAllowed(e.target)) return;
      e.preventDefault();
      if (e.touches.length === 1) {
        canvasTouchMode = 'pan';
        canvasLastTouch = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        state.isPanning = false;
      } else if (e.touches.length >= 2) {
        canvasTouchMode = 'pinch';
        state.isPanning = false;
        pinchStartDistance = Math.max(1, touchDistance(e.touches[0], e.touches[1]));
        pinchStartZoom = state.zoom;
        pinchLastMid = touchMidpoint(e.touches[0], e.touches[1]);
      }
    },
    { passive: false },
  );

  viewportSurface.addEventListener(
    'touchmove',
    (e) => {
      if (!canvasTouchMode) return;
      e.preventDefault();
      if (e.touches.length === 1 && canvasTouchMode === 'pan' && canvasLastTouch) {
        const t = e.touches[0];
        state.panX += t.clientX - canvasLastTouch.x;
        state.panY += t.clientY - canvasLastTouch.y;
        canvasLastTouch = { x: t.clientX, y: t.clientY };
        renderMainCanvas();
        return;
      }

      if (e.touches.length >= 2) {
        if (canvasTouchMode !== 'pinch') {
          canvasTouchMode = 'pinch';
          pinchStartDistance = Math.max(1, touchDistance(e.touches[0], e.touches[1]));
          pinchStartZoom = state.zoom;
          pinchLastMid = touchMidpoint(e.touches[0], e.touches[1]);
        }

        const distance = Math.max(1, touchDistance(e.touches[0], e.touches[1]));
        const mid = touchMidpoint(e.touches[0], e.touches[1]);
        state.zoom = Math.max(0.2, Math.min(5.0, pinchStartZoom * (distance / pinchStartDistance)));
        if (pinchLastMid) {
          state.panX += mid.x - pinchLastMid.x;
          state.panY += mid.y - pinchLastMid.y;
        }
        pinchLastMid = mid;
        document.getElementById('zoomDisplay').textContent = Math.round(state.zoom * 100) + '%';
        renderMainCanvas();
      }
    },
    { passive: false },
  );

  viewportSurface.addEventListener(
    'touchend',
    (e) => {
      // Only a gesture that began on the canvas may cancel the native touch.
      // Touches on the floating bottom toolbar bubble through mainContainer;
      // cancelling them here suppresses their synthesized click on phones.
      if (!canvasTouchMode) return;
      e.preventDefault();
      if (e.touches.length === 1) {
        canvasTouchMode = 'pan';
        canvasLastTouch = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      } else {
        canvasTouchMode = null;
        canvasLastTouch = null;
        pinchLastMid = null;
      }
    },
    { passive: false },
  );

  viewportSurface.addEventListener(
    'touchcancel',
    () => {
      canvasTouchMode = null;
      canvasLastTouch = null;
      pinchLastMid = null;
    },
    { passive: false },
  );
}
document.getElementById('btnNew').addEventListener('click', () => {
  stopProjectMorphing(false);
  replaceRuntimeBoundSection('projectMorph', {
    ...state.projectMorph,
    active: false,
    intervalSec: 16,
    syncTap: true,
    beatsPerProject: 32,
    transitionBeats: 8,
    cameraWander: false,
    transitionType: 'smooth',
    advancedLinear: false,
    transitionSec: 4,
    imageTransitionType: 'fade',
    imageCenterSoftness: 24,
    imageSectorSoftness: 18,
    fadeProgress: 0,
    progress: 0,
    renderProgress: 0,
    parameterProgress: 0,
    transitionProgress: 0,
    renderMode: 'morph',
    frameGeometryProgress: -1,
    frameGeometryLayerProgress: [],
    frameRenderLayers: [],
    frameMorphSettings: null,
    frameTunnelSettings: null,
    frameLampConfig: null,
    crossfadeConfigSide: null,
    sourceProject: null,
    targetProject: null,
    restoreProject: null,
    sourceIndex: -1,
    targetIndex: -1,
    startAt: 0,
    durationMs: 16000,
    geometryPlans: [],
    frameGeometry: [],
    frameExtents: [],
    sourceGeometry: [],
    targetGeometry: [],
    sourceRenderLayers: [],
    targetRenderLayers: [],
    lampPlans: [],
    frameLampPoints: [],
    endpointPending: false,
    transitionActive: false,
    sourceCaptured: false,
  });
  state.playlistProjects = [];
  state.playlistCurrentProjectId = null;
  state.playlistDefaultSettings = null;
  state.playlistColorPalettes = normalizePlaylistColorPalettes(null);
  state.playlistPaletteHueOffset = 0;
  state.playlistMenuSettings = captureMenuSettings();
  state.playlistBpm = Math.max(0, Number(state.tapTempo?.bpm) || 0);
  state.playlistOverridesActive = true;
  state.playlistFileHandle = null;
  state.playlistFileName = '';
  state.draftProjectName = 'Проект один';
  state.layerIsolation = null;
  state.sidebarFeatureToggleMemory = {};
  state.motion = {
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
  };
  motionRuntime.lastTime = 0;
  motionRuntime.rotationRad = 0;
  motionRuntime.layerRotationRad.clear();
  motionRuntime.cameraPhase = 0;
  motionRuntime.colorPhase = 0;
  ensureMotionAnimation();
  syncMotionUI();
  renderProjectChooser();
  activeStopMinimalMorphing();
  activeStopMorphing();
  state.lamps = {
    positionMode: 'key',
    colorMode: 'line',
    matchLineColor: true,
    rainbow: false,
    color: '#ffe600',
    webgl: true,
    freezeLight: false,
    freezeTailSec: 1.5,
    freezeIntensity: 100,
    freezeHardness: 50,
    freezeColorMode: 'lamp',
    freezeColor: '#00ffcc',
    freezeHueDegrees: 45,
    freezeChromatic: false,
    freezeChromaticColor: '#22d3ee',
    freezeRain: false,
    freezeRainDirectionVersion: 2,
    freezeRainDegrees: 180,
    freezeRainSource: 'core',
    freezeRainSpeed: 50,
    freezeRainTailSec: 1.5,
    freezeRainHardness: 50,
    brightness: 100,
    radius: 30,
    radiusMultiplier: 2,
    softness: 100,
    softnessMultiplier: 1,
    blendMode: 'lighter',
    type: 'whiteCore',
    density: 100,
    densityMultiplier: 1,
    scatter: 0,
    scatterMultiplier: 1,
    sizeVariation: 0,
    sizeVariationMultiplier: 1,
    brightnessVariation: 0,
    brightnessVariationMultiplier: 1,
    adaptiveBrightness: true,
    adaptiveAdjustBrightness: false,
    adaptiveStrength: 100,
    adaptiveStrengthMultiplier: 1,
    adaptiveExponent: 0,
    adaptiveAutoExponent: false,
    adaptiveFadeSec: 1,
    morphEnabled: false,
    morphSize: 20,
    morphBrightness: 25,
    morphMotionMode: 'linear',
    morphInertia: 0,
    cornerInertiaLinked: true,
    cornerInertiaPercent: 10,
    cornerInertiaSec: 0.5,
    calmMode: true,
    snapToContour: true,
    stickToRounding: true,
    snapToPolygon: true,
  };
  state.layers = [createLayer('Квадрат')];
  state.layers.forEach(ensureLayerEffectState);
  state.activeLayerId = state.layers[0].id;
  state.audioReactive.routingInitialized = false;
  state.audioReactive.routingTarget = 'master';
  state.audioReactive.masterEditEnabled = false;
  state.audioReactive.routingPreset = 'geometryLamps';
  state.audioReactive.routes = { master: [], layers: {} };
  state.audioReactive.masterRouteMultipliers = {};
  setAudioMasterRouteStateRef(null);
  audioMasterRouteRuntime.clear();
  state.audioReactive.groupToggleMemory = {};
  state.audioReactive.layerSignalEnabled = {};
  state.sidebarFeatureToggleMemory = {};
  ensureAudioRoutingState();
  state.bgColor = '#090d16';
  clearViewportBackgroundImage();
  applyTransparentDesktopMode(false, true);
  state.sceneBlend = { mode: 'normal', strength: 100, opacity: 100 };
  syncSceneBlendUI();
  state.showGrid = false;
  state.showRoundingGuides = false;
  state.roundingGuidesOverlayEnabled = false;
  state.mirrorMode = false;
  state.roundingGuidesDashed = true;
  state.roundingGuideColor = '#94a3b8';
  state.roundingGuideOpacity = 28;
  state.showBoundingCircle = false;
  state.boundingCircleColor = '#94a3b8';
  applyVignetteVisibility(false, true);
  state.randomLayerCount = 3;
  state.library = { shapes: [], morphs: [], defaultMorphId: null };
  state.projectFileHandle = null;
  state.projectFileName = '';
  state.draftProjectName = 'Проект один';
  setTunnelMode(false, { silent: true });
  state.tunnel.defaultActive = false;
  state.tunnel.speedStrength = 1;
  state.tunnel.signedSpeedVersion = 1;
  state.tunnel.speedMultiplier = 1;
  state.tunnel.spacingStrength = 3;
  state.tunnel.spacingMultiplier = 1;
  state.tunnel.depthCurve = 0;
  state.tunnel.depthCurveMultiplier = 1;
  state.tunnel.density = TUNNEL_DENSITY_DEFAULT;
  state.tunnel.centerHiddenCopies = TUNNEL_CENTER_HIDDEN_DEFAULT;
  state.tunnel.spiralOuterCopies = SPIRAL_OUTER_COPIES_DEFAULT;
  state.tunnel.colorShiftEnabled = false;
  state.tunnel.colorShiftDegrees = 30;
  state.tunnel.colorShiftCumulative = false;
  state.tunnel.paletteLagEnabled = false;
  state.tunnel.direction = 'toward';
  state.tunnel.fadeOversize = true;
  state.tunnel.fadeOffsetSteps = 3;
  state.tunnel.vignetteAmount = TUNNEL_VIGNETTE_DEFAULT_PX;
  state.tunnel.vignetteMultiplier = 1;
  state.tunnel.vignetteUnit = 'px';
  state.tunnel.fadeDurationSec = 3;
  state.tunnel.optimizedCalculation = true;
  syncTunnelSettingsUI();
  state.minimalMorph.intervalSec = 5;
  state.minimalMorph.intervalMultiplier = 1;
  state.minimalMorph.mode = 'standard';
  state.minimalMorph.family = 'mix';
  state.minimalMorph.profileGroups = ['standard'];
  state.minimalMorph.defaultActive = false;
  state.minimalMorph.profiles = [];
  state.minimalMorph.activeProfileId = 'orange-standard';
  runtimeState.minimalMorph.autoStartedByProject = false;
  state.minimalMorph.fadeSec = 0.1;
  state.minimalMorph.instantSwitch = true;
  {
    const playlistBpmBeforeReset = state.playlistBpm;
    state.suppressPlaylistOverrideCapture = true;
    try {
      resetTapTempo();
      state.tapTempo.beatsPerMorph = 16;
    } finally {
      state.suppressPlaylistOverrideCapture = false;
    }
    state.playlistBpm = playlistBpmBeforeReset;
    applyPlaylistOverrides();
  }
  state.audioReactive.noiseGateEnabled = false;
  state.audioReactive.noiseGateThresholdDb = -37;
  state.audioReactive.analysisIntervalMs = 40;
  state.audioReactive.meterIntervalMs = 40;
  state.audioReactive.inputSmoothingEnabled = false;
  state.audioReactive.inputSmoothingStrength = 50;
  state.audioReactive.inputSmoothingMultiplier = 1;
  state.audioReactive.masterGainStrength = 50;
  state.audioReactive.masterGainMultiplier = 1;
  state.audioReactive.effectsAmplitudeStrength = 50;
  state.audioReactive.effectsAmplitudeMultiplier = 1;
  state.lightningRateSync = true;
  for (const layer of state.layers)
    Object.assign(getLayerSweepConfig(layer), {
      flashMode: 'moving',
      flashType: 'high',
      glintPrecision: 'high',
      spectralSectorDegrees: 45,
      spectralAngularSpeed: 90,
      lengthPercent: 3,
      widthPercent: 105,
      color: '#ffffff',
      haloColor: '#ffffff',
      opacity: 100,
      brightness: 77,
      glow: 14.5,
      glowMultiplier: 1,
      glowIntensity: 100,
      glowIntensityMultiplier: 1,
      softness: 100,
      softnessMultiplier: 1,
      lightningBehavior: 'symmetric',
      lightningPrecision: 'exact',
      lightningMode: 'perPath',
      lightningRandomPosition: false,
      lightningColor: '#ffffff',
      lightningSecondaryColor: '#7dd3fc',
      lightningSegmentPercent: 100,
      lightningTriggerMode: 'morph',
      lightningRatePercent: 100,
      lightningRateMultiplier: 1,
      lightningDurationMs: 480,
      lightningDurationMultiplier: 1,
      lightningWidthPercent: 64,
      lightningWidthMultiplier: 1,
      lightningBrightness: 100,
      lightningGlow: 16,
      lightningGlowMultiplier: 1,
      lightningGlowIntensity: 100,
      lightningGlowIntensityMultiplier: 1,
      lightningSoftness: 100,
      lightningSoftnessMultiplier: 1,
      lightningSmoothLighting: true,
      lightningShowLines: true,
      lightningLineOpacity: 100,
      lightningAfterglow: false,
      lightningAfterglowMs: 0,
      lightningMicroStrikes: 2,
    });
  resetLightningRateRuntimeForProject(getLayerSweepConfig(state.layers[0]));
  syncSweepUI();
  runtimeState.minimalMorph.paused = false;
  runtimeState.minimalMorph.pauseStartedAt = 0;
  state.morph.defaultActive = false;
  runtimeState.morph.autoStartedByProject = false;
  runtimeState.morph.paused = false;
  runtimeState.morph.pausedByOrangeProject = false;
  runtimeState.morph.pauseStartedAt = 0;
  state.morphPlayback.lastType = null;
  state.randomOptions = {
    orbitBindingEnabled: false,
    orbitsAdded: false,
    byShape: true,
    onlyLine: false,
    byVertices: true,
    bySteps: true,
    byRounding: true,
    bySize: true,
    byColor: true,
    lineColorPalette: 'standard',
    cyclePalettes: false,
    fixedColors: false,
    bySpiralLayers: false,
    spiralLayersMin: 0,
    spiralLayersMax: 1,
  };
  state.morph.slideType = 'minimal';
  state.morph.mode = 'circleSlide';
  state.morph.unifiedMode = 'circleSlide';
  state.morph.spiralMode = 'coordinated';
  state.morph.fadePercent = 0;
  state.morph.vertexMin = 4;
  state.morph.vertexMax = 19;
  state.morph.vertexMultiplier = 1;
  state.morph.circleProfileOverflow = true;
  state.morph.strokeWidthMin = 0.5;
  state.morph.strokeWidthMax = 2;
  state.morph.opacityMin = 70;
  state.morph.opacityMax = 100;
  state.morph.fillLayersMin = 0;
  state.morph.fillLayersMax = 1;
  state.morph.fillHueMin = -15;
  state.morph.fillHueMax = 15;
  state.morph.fillHueReset = true;
  state.morph.fillHueHarmony = 'native';
  state.morph.sizeVariation = 100;
  state.morph.sizeVariationMultiplier = 1;
  state.morph.normalizeSizes = true;
  state.morph.rotationMinPercent = 0;
  state.morph.rotationMaxPercent = 50;
  state.morph.rotationMultiplier = 1;
  state.morph.rotationRandomDirection = true;
  state.morph.monoOrbitTransforms = true;
  state.morph.orbitPercentMin = 0;
  state.morph.orbitPercentMax = 0;
  // Numeric Orbit override is opt-in; factory/startup must restore legacy defaults.
  delete state.morph.orbitCountMin;
  delete state.morph.orbitCountMax;
  state.morph.fillOpacityMin = 10;
  state.morph.fillOpacityMax = 10;
  state.morph.splinePoints = 12;
  state.morph.spiralLayersMin = 0;
  state.morph.spiralTangentialChance = 50;
  state.morph.spiralOrderHoldPhases = 1;
  state.morph.spiralOrderMin = -1;
  state.morph.spiralOrderMax = 1;
  state.morph.spiralOrderLinked = false;
  state.morph.lineColorPalette = 'standard';
  state.morph.cyclePalettes = false;
  state.morph.fixedColors = false;
  state.morph.syncPalettesBetweenMorphs = true;
  state.morph.morphGlobalHueOffset = false;
  state.morph.globalHueOffsetRange = 180;
  state.morph.spiralLayersMax = 1;
  state.morph.chaosMorphEnabled = false;
  state.morph.chaosMorphStepSpread = 1;
  state.morph.chaosMorphClosuresMax = 3;
  state.morph.preserveSpiralContinuity = true;
  state.morph.spiralMorphType = 'coordinated';
  state.morph.spiralRotationCompensation = false;
  state.morph.pauseOnSpace = false;
  state.morph.shapeOptions = {
    noLoops: true,
    loops: false,
    closed: false,
    open: false,
    family: 'mix',
    profileGroups: ['standard'],
    profileGroup: 'all',
    standardOnly: false,
  };
  state.morph.options = {
    byShape: true,
    byVertices: true,
    bySteps: true,
    byRounding: false,
    byStrokeWidth: true,
    bySize: true,
    byColor: true,
    byFillColor: true,
    byOpacity: false,
    byRotation: true,
    bySpiralOrder: false,
    bySpiralLayers: false,
  };
  state.morph.speedType = 'linear';
  renderPlaylistPaletteButtons();
  syncMorphSettingsUI();
  document.getElementById('randomLayerCount').value = 3;
  syncRandomSettingsUI();
  document.getElementById('presetSelect').value = '';
  updateLayerListUI();
  syncSidebarInputs();
  syncTunnelSettingsUI();
  syncMorphSettingsUI();
  syncRandomSettingsUI();
  syncAudioSettingsUIFromState();
  syncSidebarInputs();
  installLogarithmicNumberSteppers();
  installEditableMultiplierSummaries();
  captureStartupControlDefaults();
  renderProfileEditor();
  requestMainCanvasRender();
  document
    .getElementById('freehandInterpolationPanel')
    ?.classList.toggle('visible', state.layers[0]?.profileMode === 'freehand_raw');
});

export { bindInputEvents, bindViewportEvents };
