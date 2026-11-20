// Запуск приложения: обработчик load, мобильные панели, флаг готовности.
import '../ui/number-steppers.js'; // initialisation order: this module runs after it
import defaults from '../../../project-defaults.js';
import { applyLoadedProject } from '../project/project-loader.js';
import { renderProfileEditor } from '../ui/profile-editor.js';
import {
  audioMasterRouteRuntime,
  ensureAudioRoutingState,
  setAudioMasterRouteStateRef,
} from '../audio/audio-routing.js';
import { setupAudioRoutingUI } from '../ui/audio-routing-panel.js';
import { setSidebarMode, syncLampSettingsUI, syncMotionUI, syncWebOutlineUI } from '../ui/effects-sidebar.js';
import {
  createLayer,
  toggleAllLinesWithMemory,
  toggleSidebarFeatureWithMemory,
} from '../core/defaults-layers.js';
import { normalizePlaylistColorPalettes } from '../core/palette.js';
import { applyFpsVisibility } from '../core/render-runtime.js';
import { requestMainCanvasRender } from '../core/scheduler.js';
import { replaceRuntimeBoundSection, runtimeState, state } from '../core/state.js';
import { ensureMotionAnimation, toggleMotionQuickGroup } from '../effects/motion.js';
import '../render/main-pipeline.js';
import { ensureSharedGpuMorphPipeline } from '../gpu/morph-path-resource.js';
import { warmupGpuMorphArcResource } from '../gpu/morph-arc-resource.js';
import { WebGPUTopologyMorphBaseRenderer } from '../gpu/topology-morph-base-renderer.js';
import {
  SPIRAL_OUTER_COPIES_DEFAULT,
  TUNNEL_CENTER_HIDDEN_DEFAULT,
} from '../corridor/corridor-appearance.js';
import { TUNNEL_VIGNETTE_DEFAULT_PX } from '../corridor/corridor-instances.js';
import { setupTunnelUI } from '../ui/corridor-panel.js';
import { updateLayerListUI } from '../ui/layer-selection.js';
import { syncSidebarInputs } from '../ui/sidebar-sync.js';
import { morphAlwaysOnMultiplier } from '../ui/blue-morph/parameter-bindings.js';
import { openUnifiedParameterRoutingMenuForId } from '../ui/parameter-routing-popup.js';
import { setupMorphProfileUI } from '../ui/blue-morph/profiles.js';
import { resetAutoTapBandTrackers, resetTempoLock, setupTapTempoUI } from '../audio/tap-tempo.js';
import { renderPlaylistPaletteButtons, togglePaletteQuickMenu } from '../ui/playlist-palettes.js';
import { setupOrangeMorphProfileUI, syncRandomSettingsUI } from '../ui/orange-morph/routing-ui.js';
import { bindEditableNumericDisplays, syncMorphSettingsUI } from '../ui/morph-settings-panel.js';
import { bindInputEvents, bindViewportEvents } from '../ui/input-viewport-events.js';
import {
  renderAudioCustomBandRows,
  renderAudioMeters,
  setupAudioReactiveUI,
  syncAudioCutoffs,
} from '../audio/audio-reactive.js';
import {
  setupGlobalHotkeys,
  setupMobileMediaActions,
  setupMobileNumberSteppers,
} from '../ui/fullscreen-and-hotkeys.js';
import {
  captureStartupControlDefaults,
  installDoubleClickReset,
  installEditableMultiplierSummaries,
  installLogarithmicNumberSteppers,
} from '../ui/number-steppers.js';
import { noteSuppressedError } from '../core/suppressed-errors.js';

window.addEventListener('load', () => {
  const defaultLayer = createLayer('Квадрат');
  state.layers = [defaultLayer];
  state.activeLayerId = defaultLayer.id;
  state.audioReactive.routingInitialized = false;
  state.audioReactive.routes = { master: [], layers: {} };
  state.audioReactive.masterRouteMultipliers = {};
  setAudioMasterRouteStateRef(null);
  audioMasterRouteRuntime.clear();
  state.audioReactive.groupToggleMemory = {};
  state.audioReactive.layerSignalEnabled = {};
  state.sidebarFeatureToggleMemory = {};
  ensureAudioRoutingState();
  state.bgColor = '#090d16';
  state.transparentDesktop = false;
  state.sceneBlend = { mode: 'normal', strength: 100, opacity: 100 };
  state.showGrid = false;
  state.showRoundingGuides = false;
  state.roundingGuidesOverlayEnabled = false;
  state.mirrorMode = false;
  state.roundingGuidesDashed = true;
  state.roundingGuideColor = '#94a3b8';
  state.roundingGuideOpacity = 28;
  state.showBoundingCircle = false;
  state.boundingCircleColor = '#94a3b8';
  state.randomLayerCount = 3;
  state.tunnel.defaultActive = false;
  state.tunnel.centerHiddenCopies = TUNNEL_CENTER_HIDDEN_DEFAULT;
  state.tunnel.spiralOuterCopies = SPIRAL_OUTER_COPIES_DEFAULT;
  state.tunnel.fadeOversize = true;
  state.tunnel.fadeOffsetSteps = 3;
  state.tunnel.vignetteAmount = TUNNEL_VIGNETTE_DEFAULT_PX;
  state.tunnel.vignetteMultiplier = 1;
  state.tunnel.vignetteUnit = 'px';
  state.tunnel.fadeDurationSec = 3;
  state.tunnel.optimizedCalculation = true;
  state.minimalMorph.intervalSec = 5;
  state.minimalMorph.mode = 'standard';
  state.minimalMorph.family = 'mix';
  state.minimalMorph.profileGroups = ['standard'];
  state.minimalMorph.defaultActive = false;
  state.minimalMorph.profiles = [];
  state.minimalMorph.activeProfileId = 'orange-standard';
  runtimeState.minimalMorph.autoStartedByProject = false;
  state.minimalMorph.fadeSec = 0.1;
  state.minimalMorph.instantSwitch = true;
  runtimeState.minimalMorph.active = false;
  runtimeState.minimalMorph.paused = false;
  runtimeState.minimalMorph.pauseStartedAt = 0;
  runtimeState.minimalMorph.transitioning = false;
  runtimeState.morph.pausedByOrangeProject = false;
  runtimeState.morph.pausedByGreenProject = false;
  state.tapTempo.bpm = 0;
  state.tapTempo.beatsPerMorph = 16;
  state.tapTempo.autoTap = false;
  state.tapTempo.autoWindowSec = 10;
  state.tapTempo.autoBand = 'low';
  state.playlistTapTempo = { autoTap: false, autoWindowSec: 10, autoBand: 'low' };
  state.playlistColorPalettes = normalizePlaylistColorPalettes(null);
  state.playlistPaletteHueOffset = 0;
  state.tapTempo.tapTimes = [];
  state.tapTempo.autoBeatTimes = [];
  state.tapTempo.autoFluxHistory = [];
  state.tapTempo.autoPrevSpectrum = null;
  state.tapTempo.autoFluxPrevSample = null;
  state.tapTempo.autoFluxPrevPrevSample = null;
  state.tapTempo.autoTempoCandidate = 0;
  state.tapTempo.autoTempoCandidateCount = 0;
  state.tapTempo.autoConfidence = 0;
  resetAutoTapBandTrackers();
  resetTempoLock(false);
  state.tapTempo.anchorTime = 0;
  state.tapTempo.lastTapAt = 0;
  state.tapTempo.lastAppliedBpm = 0;
  state.tapTempo.syncFullMorph = false;
  state.tapTempo.syncMinimalMorph = false;
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
  state.audioReactive.noiseGateEnabled = false;
  state.audioReactive.noiseGateThresholdDb = -37;
  state.audioReactive.analysisIntervalMs = 40;
  state.audioReactive.meterIntervalMs = 40;
  state.audioReactive.noiseGateSoftEnabled = false;
  state.audioReactive.noiseGateStrength = 0;
  state.audioReactive.inputSmoothingEnabled = false;
  state.audioReactive.inputSmoothingStrength = 50;
  state.audioReactive.inputSmoothingMultiplier = 1;
  state.audioReactive.masterGainStrength = 50;
  state.audioReactive.masterGainMultiplier = 1;
  state.audioReactive.effectsAmplitudeStrength = 50;
  state.audioReactive.effectsAmplitudeMultiplier = 1;
  state.audioReactive.gateGain = 1;
  runtimeState.morph.active = false;
  runtimeState.morph.paused = false;
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
  state.morph.intervalSec = 5;
  state.morph.intervalMultiplier = 1;
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
  state.morph.morphGlobalHueOffset = false;
  state.morph.globalHueOffsetRange = 180;
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
  state.morph.spiralLayersMax = 1;
  state.morph.chaosMorphEnabled = false;
  state.morph.chaosMorphStepSpread = 1;
  state.morph.chaosMorphClosuresMax = 3;
  state.morph.preserveSpiralContinuity = true;
  state.morph.spiralMorphType = 'coordinated';
  state.morph.spiralRotationCompensation = false;
  state.morph.pauseOnSpace = false;
  state.morph.speedType = 'linear';
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
  applyLoadedProject(structuredClone(defaults), { applyProjectDefaultModes: false });
  setSidebarMode(state.sidebarMode);
  syncLampSettingsUI();
  syncWebOutlineUI();
  renderPlaylistPaletteButtons();

  ensureMotionAnimation();
  syncMorphSettingsUI();
  syncRandomSettingsUI();

  bindInputEvents();
  bindEditableNumericDisplays();
  installLogarithmicNumberSteppers();
  installEditableMultiplierSummaries();
  installDoubleClickReset();
  bindViewportEvents();
  setupTunnelUI();
  setupTapTempoUI();



  setupAudioReactiveUI();
  setupAudioRoutingUI();
  setupMorphProfileUI();
  setupOrangeMorphProfileUI();
  setupMobileMediaActions();
  setupMobileNumberSteppers();
  setupGlobalHotkeys();
  updateLayerListUI();
  syncSidebarInputs();

  captureStartupControlDefaults();
  const initialZoomDisplay = document.getElementById('zoomDisplay');
  if (initialZoomDisplay) initialZoomDisplay.textContent = Math.round(state.zoom * 100) + '%';

  const mobileControlsBtn = document.getElementById('btnMobileControls');
  const mobileSidebar = document.getElementById('settingsSidebar');
  const mobileToolRail = document.getElementById('sidebarToolRail');
  const mobileSidebarBackdrop = document.getElementById('mobileSidebarBackdrop');
  const mobileSidebarClose = document.getElementById('btnMobileCloseSidebar');
  const mobileLayerListToggle = document.getElementById('btnToggleLayerList');
  const mobileQuery = window.matchMedia(
    '(max-width: 760px), (max-height: 480px) and (hover: none) and (pointer: coarse)',
  );
  const collapseSidebarBtn = document.getElementById('btnCollapseSidebar');

  function setMobileLayerListCollapsed(collapsed) {
    if (!mobileSidebar) return;
    const shouldCollapse = mobileQuery.matches && collapsed === true;
    mobileSidebar.classList.toggle('mobile-layers-collapsed', shouldCollapse);
    if (mobileLayerListToggle) {
      mobileLayerListToggle.setAttribute('aria-expanded', shouldCollapse ? 'false' : 'true');
      mobileLayerListToggle.setAttribute('aria-label', shouldCollapse ? 'Показать слои' : 'Скрыть слои');
      mobileLayerListToggle.title = shouldCollapse ? 'Показать слои' : 'Скрыть слои';
      mobileLayerListToggle.textContent = shouldCollapse ? '⌄' : '⌃';
    }
  }

  if (mobileQuery.matches) setMobileLayerListCollapsed(true);
  mobileLayerListToggle?.addEventListener('click', (event) => {
    if (!mobileQuery.matches) return;
    event.preventDefault();
    event.stopPropagation();
    setMobileLayerListCollapsed(!mobileSidebar?.classList.contains('mobile-layers-collapsed'));
  });

  collapseSidebarBtn?.addEventListener('click', () => {
    if (mobileQuery.matches || !mobileSidebar) return;
    const collapsed = mobileSidebar.classList.toggle('desktop-collapsed');
    collapseSidebarBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    collapseSidebarBtn.setAttribute(
      'aria-label',
      collapsed ? 'Развернуть левую панель' : 'Свернуть левую панель',
    );
    collapseSidebarBtn.title = collapsed ? 'Развернуть левую панель' : 'Свернуть левую панель';
    requestAnimationFrame(() => {
      renderProfileEditor();
      requestMainCanvasRender();
    });
  });

  function setMobileToolRailOpen(open) {
    if (!mobileQuery.matches) open = false;
    mobileToolRail?.classList.toggle('mobile-rail-open', open);
    if (!mobileSidebar?.classList.contains('mobile-open'))
      mobileToolRail?.classList.toggle('mobile-open', false);
    mobileControlsBtn?.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  function setMobileSidebarOpen(open) {
    if (!mobileQuery.matches) open = false;
    if (mobileQuery.matches) {
      mobileSidebar?.classList.remove('desktop-collapsed');
      collapseSidebarBtn?.setAttribute('aria-expanded', 'true');
    }
    mobileSidebar?.classList.toggle('mobile-open', open);
    mobileToolRail?.classList.toggle('mobile-open', open);
    if (open) mobileToolRail?.classList.add('mobile-rail-open');
    mobileSidebarBackdrop?.classList.toggle('visible', open);
    if (!open && !mobileToolRail?.classList.contains('mobile-rail-open'))
      mobileControlsBtn?.setAttribute('aria-expanded', 'false');
    mobileSidebarBackdrop?.setAttribute('aria-hidden', open ? 'false' : 'true');
  }

  mobileControlsBtn?.addEventListener('click', () => {
    if (!mobileQuery.matches) return;
    if (mobileSidebar?.classList.contains('mobile-open')) {
      setMobileSidebarOpen(false);
      setMobileToolRailOpen(false);
      return;
    }
    setMobileToolRailOpen(!mobileToolRail?.classList.contains('mobile-rail-open'));
  });
  mobileSidebarClose?.addEventListener('click', () => setMobileSidebarOpen(false));
  mobileSidebarBackdrop?.addEventListener('click', () => setMobileSidebarOpen(false));

  function toggleMobileSidebarFeature(mode) {
    if (mode === 'shape') {
      toggleAllLinesWithMemory();
    } else if (mode === 'lines') toggleSidebarFeatureWithMemory('graffiti');
    else if (mode === 'lamps') toggleSidebarFeatureWithMemory('lamps');
    else if (mode === 'web') toggleSidebarFeatureWithMemory('web');
    else if (mode === 'sweep') toggleSidebarFeatureWithMemory('glint');
    else if (mode === 'lightning') toggleSidebarFeatureWithMemory('lightning');
    else if (mode === 'particles') toggleSidebarFeatureWithMemory('particles');
    else if (mode === 'ambient') window.SomataAmbientPrism?.toggleAmbient?.();
    else if (mode === 'prism') window.SomataAmbientPrism?.togglePrism?.();
    else if (mode === 'motion') toggleMotionQuickGroup();
    else if (mode === 'palette') {
      togglePaletteQuickMenu();
    }
    try {
      navigator.vibrate?.(18);
    } catch (error) {
      noteSuppressedError('app/boot#toggleMobileSidebarFeature', error);
    }
  }

  document.querySelectorAll('[data-sidebar-mode]').forEach((btn) => {
    let longTimer = 0,
      longFired = false;
    const clearLong = () => {
      if (longTimer) {
        clearTimeout(longTimer);
        longTimer = 0;
      }
    };
    btn.addEventListener('pointerdown', (e) => {
      if (!mobileQuery.matches) return;
      longFired = false;
      clearLong();
      longTimer = setTimeout(() => {
        longTimer = 0;
        longFired = true;
        btn.dataset.mobileLongPress = '1';
        toggleMobileSidebarFeature(btn.dataset.sidebarMode);
      }, 520);
    });
    btn.addEventListener('pointerup', clearLong);
    btn.addEventListener('pointercancel', clearLong);
    btn.addEventListener('pointerleave', clearLong);
    btn.addEventListener('click', (e) => {
      if (!mobileQuery.matches) return;
      if (longFired || btn.dataset.mobileLongPress === '1') {
        delete btn.dataset.mobileLongPress;
        longFired = false;
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }

      setMobileSidebarOpen(true);
    });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && mobileQuery.matches) {
      if (mobileSidebar?.classList.contains('mobile-open')) setMobileSidebarOpen(false);
      else setMobileToolRailOpen(false);
    }
  });
  const onMobileQueryChange = () => {
    setMobileSidebarOpen(false);
    setMobileToolRailOpen(false);
    if (mobileQuery.matches) {
      setMobileLayerListCollapsed(true);
      applyFpsVisibility(true, false);
    } else {
      mobileSidebar?.classList.remove('mobile-layers-collapsed');
    }
  };
  if (mobileQuery.addEventListener) mobileQuery.addEventListener('change', onMobileQueryChange);
  else if (mobileQuery.addListener) mobileQuery.addListener(onMobileQueryChange);
  if (mobileQuery.matches) applyFpsVisibility(true, false);

  let mobileResizeRaf = 0;
  window.addEventListener('resize', () => {
    cancelAnimationFrame(mobileResizeRaf);
    mobileResizeRaf = requestAnimationFrame(() => {
      renderProfileEditor();
      requestMainCanvasRender();
    });
  });

  window.addEventListener('orientationchange', () => {
    setMobileSidebarOpen(false);
    setTimeout(() => {
      renderProfileEditor();
      requestMainCanvasRender();
    }, 120);
  });

  renderProfileEditor();
  requestMainCanvasRender();
  if (navigator.gpu && window.requestIdleCallback) {
    requestAnimationFrame(() => window.requestIdleCallback(() => {
      if (runtimeState.morph.active) return;
      void ensureSharedGpuMorphPipeline();
      WebGPUTopologyMorphBaseRenderer.warmup();
      warmupGpuMorphArcResource();
    }));
  }
  document
    .getElementById('freehandInterpolationPanel')
    ?.classList.toggle('visible', state.layers[0]?.profileMode === 'freehand_raw');
});
(() => {
  const mobileSidebarQuery = window.matchMedia(
    '(max-width: 760px), (max-height: 480px) and (hover: none) and (pointer: coarse)',
  );
  document.addEventListener(
    'pointerdown',
    (event) => {
      const button = event.target?.closest?.('[data-sidebar-mode]');
      if (!button || !mobileSidebarQuery.matches) return;
      button.dataset.mobilePointerType = event.pointerType || '';
    },
    true,
  );
  document.addEventListener(
    'contextmenu',
    (event) => {
      const button = event.target?.closest?.('[data-sidebar-mode]');
      if (!button || !mobileSidebarQuery.matches) return;
      const pointerType = button.dataset.mobilePointerType || '';
      if (pointerType === 'touch' || pointerType === 'pen' || button.dataset.mobileLongPress === '1') {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    },
    true,
  );
})();
(() => {
  const mobileParameterQuery = window.matchMedia(
    '(max-width: 760px), (max-height: 480px) and (hover: none) and (pointer: coarse)',
  );
  const LONG_PRESS_MS = 440;
  const MOVE_CANCEL_PX = 12;
  let pressTimer = 0;
  let pressPointerId = null;
  let pressStartX = 0;
  let pressStartY = 0;
  let pendingContext = null;
  let activeContext = null;
  let ignoreOverlayTapUntil = 0;

  const rowSelectors = [
    '.control-row',
    '.tunnel-setting',
    '.morph-setting-row',
    '.tap-setting-row',
    '.audio-effect-row',
    '.audio-noise-gate-soft-row',
    '.graffiti-wide-slider',
    '.graffiti-variation-control',
    '.lamp-adaptive-strength-row',
    '.morph-size-option',
    '.spiral-settings-row',
    '.audio-master-route-row',
  ].join(',');

  function visibleText(el) {
    return String(el?.textContent || '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function isInteractiveTarget(target) {
    return !!target?.closest?.('input,button,select,textarea,[contenteditable="true"],a');
  }

  function findNamedRangeContext(target) {
    if (!mobileParameterQuery.matches || !target) return null;
    if (target.closest?.('#mobileParameterFocusOverlay')) return null;
    // The slider itself must be focusable by touch. Previously only the text label
    // could activate the dock; dragging a range never reached the focus handler.
    const touchedRange = target.closest?.('input[type="range"]');
    if (!touchedRange && isInteractiveTarget(target)) return null;
    if (touchedRange?.disabled || touchedRange?.classList.contains('blue-morph-dual')) return null;

    const textNode =
      touchedRange ||
      target.closest?.(
        'span,label,strong,.hint-text,.audio-effect-title,.row-label,.tunnel-setting-head,.morph-setting-row',
      );
    if (!textNode || textNode.matches?.('.text-mono,.editable-number-value,.editable-mult-summary'))
      return null;

    let row = target.closest?.(rowSelectors) || null;
    let range = touchedRange || null;
    if (row && !range) {
      const rowRanges = [...(row.querySelectorAll?.('input[type="range"]') || [])].filter(
        (input) => !input.classList.contains('blue-morph-dual'),
      );
      if (rowRanges.length === 1) range = rowRanges[0];
      else if (rowRanges.length > 1) return null;
    }
    if (!range) {
      let node = target.parentElement;
      for (let depth = 0; node && node !== document.body && depth < 7; depth++, node = node.parentElement) {
        const ranges = node.querySelectorAll?.('input[type="range"]');
        if (ranges?.length === 1) {
          row = node;
          range = ranges[0];
          break;
        }
        if (ranges?.length > 1) break;
      }
    }
    if (!row && touchedRange)
      row = touchedRange.closest('label,.control-group,.morph-sidebar-section') || touchedRange.parentElement;
    if (!row || !range || range.closest('#mobileParameterFocusOverlay')) return null;

    const valueNode = target.closest?.('.text-mono,.editable-number-value,.editable-mult-summary');
    if (valueNode) return null;

    let nameEl = null;
    const preferred = [
      '.row-label > span:first-child',
      '.tunnel-setting-head > span:first-child',
      '.audio-effect-head .audio-effect-title',
      '.audio-effect-title',
      '.morph-setting-row > label > span:first-child',
      '.morph-setting-row > label',
      '.tap-setting-row > label > span:first-child',
      '.tap-setting-row > span:first-child',
      '.hint-text',
      'label > span:first-child',
      'label',
    ];
    for (const selector of preferred) {
      const el = row.querySelector?.(selector);
      if (
        el &&
        visibleText(el) &&
        (touchedRange || el === target || el.contains(target) || target.contains?.(el))
      ) {
        nameEl = el;
        break;
      }
    }
    if (!nameEl) {
      const t = target.closest?.('span,label,strong,.hint-text,.audio-effect-title');
      if (t && row.contains(t) && visibleText(t) && !t.matches('.text-mono')) nameEl = t;
    }
    if (!nameEl && !touchedRange) return null;

    const title = (touchedRange?.getAttribute('aria-label') || visibleText(nameEl) || 'Параметр').replace(
      /^[-+×\s]+|[-+×\s]+$/g,
      '',
    );
    const numberInputs = [...row.querySelectorAll('input[type="number"]')];
    const multiplier =
      numberInputs.find((input) => {
        const hay = `${input.id || ''} ${input.getAttribute('aria-label') || ''} ${input.title || ''}`;
        return input.dataset.logMultiplier != null || /multiplier/i.test(hay) || /множител/i.test(hay);
      }) || null;

    return { row, range, multiplier, nameEl, title };
  }

  // 13.1: A focused setting may be a range, a discrete control row,
  // or the live profile editor. Only registered Morph parameters get
  // access to the shared Blue / Orange / Audio routing menu.
  function findProfileFocusContext(target) {
    const group = target?.closest?.('#profileSettingsGroup');
    if (!group || isInteractiveTarget(target)) return null;
    const heading = group.querySelector('.control-group-title');
    if (!heading?.contains(target)) return null;
    return { kind: 'profile', row: group, title: 'Профиль отрезка' };
  }

  function findWidgetFocusContext(target) {
    if (!target || isInteractiveTarget(target) || target.closest?.('#mobileParameterFocusOverlay'))
      return null;
    const row = target.closest?.(
      '.control-row,.tunnel-setting,.tap-setting-row,.audio-effect-row,.control-group-title,.geometry-circle-modes',
    );
    if (!row || row.closest('#profileSettingsGroup')) return null;
    const named = target.closest?.(
      'label,span,strong,.row-label,.audio-effect-title,.tunnel-setting-head,.geometry-circles-head,.control-group-title',
    );
    if (!named || !row.contains(named)) return null;
    const controls = [...row.querySelectorAll('input,select,textarea,button')].filter(
      (el) => !el.matches('[type="hidden"]'),
    );
    if (!controls.length || controls.every((el) => el.disabled)) return null;
    // An ordinary slider keeps its existing two-row focus UI.
    if (
      controls.some((el) => el.matches('input[type="range"]')) &&
      controls.filter((el) => el.matches('input[type="range"]')).length === 1
    )
      return null;
    const name =
      row.querySelector(
        '.row-label > span:first-child,.control-group-title > span:first-child,.geometry-circles-head label span,label > span:first-of-type,.audio-effect-title,label,strong',
      ) || named;
    const title =
      visibleText(name)
        .replace(/[:：]$/, '')
        .slice(0, 90) || 'Настройка';
    return { kind: 'widgets', row, title };
  }

  function findFocusContext(target) {
    if (!mobileParameterQuery.matches || !target || target.closest?.('#mobileParameterFocusOverlay'))
      return null;
    return findProfileFocusContext(target) || findNamedRangeContext(target) || findWidgetFocusContext(target);
  }

  function routingIdForFocus(context) {
    if (context?.kind === 'profile')
      return window.SomataParameterMatrix?.get?.('geometry.shape') ? 'geometry.shape' : null;
    const defs = window.SomataParameterRegistry?.morphable?.() || [];
    const eligible = (def) =>
      def?.morph?.supported === true && def?.type !== 'boolean' && !morphAlwaysOnMultiplier(def.id);
    const rangeId = context?.range?.id;
    const exact = defs.find((def) => eligible(def) && rangeId && def.ui?.mainId === rangeId);
    if (exact) return exact.id;
    const row = context?.row;
    if (!row) return null;
    // The registered visual host is more precise than matching labels.
    const host = row.querySelector?.('[data-routing-param-id]');
    if (
      host?.dataset.routingParamId &&
      eligible(window.SomataParameterRegistry.get(host.dataset.routingParamId))
    )
      return host.dataset.routingParamId;
    const matching = defs.filter(
      (def) =>
        eligible(def) &&
        def.ui?.mainId &&
        [...row.querySelectorAll('[id]')].some((el) => el.id === def.ui.mainId),
    );
    return matching.length === 1 ? matching[0].id : null;
  }

  // Mirror non-slider widgets to their *original* controls, keeping
  // delegated handlers attached to the original settings tree.
  function mountWidgetProxy(context, slot) {
    const source = context.row;
    const clone = source.cloneNode(true);
    clone.removeAttribute('id');
    clone.classList.add('mobile-focus-widget-copy');
    for (const element of clone.querySelectorAll('[id]')) element.removeAttribute('id');
    for (const element of clone.querySelectorAll('label[for]')) element.removeAttribute('for');
    const orig = [...source.querySelectorAll('input,select,textarea,button')];
    const copies = [...clone.querySelectorAll('input,select,textarea,button')];
    const cleanups = [];
    orig.forEach((control, i) => {
      const proxy = copies[i];
      if (!proxy) return;
      const isButton =
        control.tagName === 'BUTTON' || control.matches('input[type="button"],input[type="submit"]');
      const isCheck = control.matches('input[type="checkbox"],input[type="radio"]');
      const sync = () => {
        if (!proxy.isConnected) return;
        proxy.disabled = control.disabled;
        if (isCheck) proxy.checked = control.checked;
        else if (!isButton) proxy.value = control.value;
        if (control.getAttribute('aria-pressed') !== null)
          proxy.setAttribute('aria-pressed', control.getAttribute('aria-pressed'));
      };
      if (isButton) {
        proxy.addEventListener('click', (event) => {
          event.stopPropagation();
          control.click();
          queueMicrotask(sync);
        });
      } else if (isCheck) {
        proxy.addEventListener('change', (event) => {
          event.stopPropagation();
          if (!control.isConnected || control.disabled) return;
          if (control.checked !== proxy.checked) control.click();
          else control.dispatchEvent(new Event('change', { bubbles: true }));
          queueMicrotask(sync);
        });
      } else {
        for (const type of ['input', 'change'])
          proxy.addEventListener(type, (event) => {
            event.stopPropagation();
            if (!control.isConnected || control.disabled) return;
            control.value = proxy.value;
            control.dispatchEvent(new Event(type, { bubbles: true }));
            queueMicrotask(sync);
          });
      }
      for (const type of ['input', 'change']) control.addEventListener(type, sync);
      cleanups.push(() => {
        for (const type of ['input', 'change']) control.removeEventListener(type, sync);
      });
    });
    context.proxyCleanup.push(...cleanups);
    slot.replaceChildren(clone);
  }

  function mountProfileEditor(context, slot) {
    // Keep the REAL editor/canvas and its listeners; never clone a
    // canvas or lose its WebGL/2D state. A marker restores its slot.
    const editor = document.getElementById('profileSettingsGroup');
    if (!editor?.parentNode) return false;
    const marker = document.createComment('Somata profile editor restore point');
    editor.parentNode.insertBefore(marker, editor);
    context.restoreProfile = () => {
      if (marker.parentNode) marker.parentNode.insertBefore(editor, marker);
      marker.remove();
      renderProfileEditor();
    };
    slot.replaceChildren(editor);
    // Hide rarely used profile options behind an accessible disclosure.
    // Keep the live controls (IDs, listeners and state) untouched.
    const profileCanvasBox = editor.querySelector('.profile-canvas-container');
    if (profileCanvasBox) {
      const extra = document.createElement('details');
      extra.className = 'mobile-profile-extras';
      const summary = document.createElement('summary');
      summary.textContent = 'Дополнительные настройки';
      extra.append(summary);
      while (profileCanvasBox.nextSibling) extra.append(profileCanvasBox.nextSibling);
      profileCanvasBox.after(extra);
      const onMode = (event) => {
        if (event.target.closest('[data-mode="freehand_raw"]')) extra.open = true;
      };
      editor.addEventListener('click', onMode);
      const previousRestore = context.restoreProfile;
      context.restoreProfile = () => {
        editor.removeEventListener('click', onMode);
        // Restore original child order, including every text node.
        for (const child of [...extra.childNodes].filter((n) => n !== summary))
          editor.insertBefore(child, extra);
        extra.remove();
        previousRestore();
      };
    }
    // 13.1.2: the profile group selector is a compact dropdown,
    // not five persistent two-column tiles. The REAL checkbox
    // controls stay mounted and keep their existing handlers.
    const firstRow = editor.querySelector('.control-row');
    const tabs = editor.querySelector('#profileLibraryTabs');
    const reset = editor.querySelector('#btnResetProfile');
    if (firstRow && tabs && reset) {
      const resetMarker = document.createComment('profile reset restore point');
      reset.parentNode.insertBefore(resetMarker, reset);
      const toolbar = document.createElement('div');
      toolbar.className = 'mobile-profile-toolbar';
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'mobile-profile-library-toggle';
      toggle.setAttribute('aria-controls', 'profileLibraryTabs');
      toggle.setAttribute('aria-expanded', 'false');
      toolbar.append(toggle, reset);
      firstRow.insertBefore(toolbar, tabs);
      const updateLabel = () => {
        const active = tabs.querySelector('.profile-library-tab.active > span');
        toggle.textContent = `Профили · ${active?.textContent?.replace(/^\d+\s*/, '') || 'Стандарт'} ▾`;
      };
      const close = () => {
        tabs.classList.remove('mobile-profile-groups-open');
        toggle.setAttribute('aria-expanded', 'false');
      };
      toggle.addEventListener('click', () => {
        const open = tabs.classList.toggle('mobile-profile-groups-open');
        toggle.setAttribute('aria-expanded', String(open));
        updateLabel();
      });
      tabs.addEventListener('click', (e) => {
        // A checkbox changes Morph participation without closing
        // the list, so several groups can be checked in one pass.
        if (!e.target.closest('[data-morph-profile-group]')) {
          queueMicrotask(() => {
            updateLabel();
            close();
          });
        }
      });
      const outside = (e) => {
        if (!toolbar.contains(e.target) && !tabs.contains(e.target)) close();
      };
      document.addEventListener('pointerdown', outside, true);
      updateLabel();
      const previousRestore = context.restoreProfile;
      context.restoreProfile = () => {
        document.removeEventListener('pointerdown', outside, true);
        close();
        if (resetMarker.parentNode) resetMarker.parentNode.insertBefore(reset, resetMarker);
        resetMarker.remove();
        toolbar.remove();
        previousRestore();
      };
    }
    renderProfileEditor();
    return true;
  }

  function ensureOverlay() {
    let overlay = document.getElementById('mobileParameterFocusOverlay');
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'mobileParameterFocusOverlay';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML = `
                    <div class="mobile-parameter-focus-dock" role="dialog" aria-modal="true" aria-label="Быстрая настройка параметра">
                        <div class="mobile-parameter-focus-head">
                            <div id="mobileParameterFocusTitle" class="mobile-parameter-focus-title"></div>
                            <button id="mobileParameterRouting" class="mobile-parameter-focus-routing hidden" type="button" aria-label="Назначить морфинг и аудиосвязь" title="Синий Morph · Оранжевый Morph · Аудиосвязь">⇄</button>
                            <output id="mobileParameterFocusValue" class="mobile-parameter-focus-value" aria-live="off"></output>
                            <div id="mobileParameterMultiplierWrap" class="mobile-parameter-focus-multiplier hidden" aria-label="Множитель параметра">
                                <span aria-hidden="true">×</span><span id="mobileParameterMultiplierSlot"></span>
                            </div>
                            <button id="mobileParameterFocusClose" class="mobile-parameter-focus-close" type="button" aria-label="Вернуться к настройкам">×</button>
                        </div>
                        <div class="mobile-parameter-focus-controls">
                            <button id="mobileParameterMinus" class="mobile-parameter-focus-step" type="button" aria-label="Уменьшить параметр">−</button>
                            <div id="mobileParameterRangeSlot" class="mobile-parameter-focus-range-slot"></div>
                            <button id="mobileParameterPlus" class="mobile-parameter-focus-step" type="button" aria-label="Увеличить параметр">+</button>
                        </div>
                        <div id="mobileParameterWidgetSlot" class="mobile-parameter-widget-slot hidden"></div>
                        <div id="mobileParameterProfileSlot" class="mobile-parameter-profile-slot hidden"></div>
                    </div>`;
    document.body.appendChild(overlay);

    overlay.addEventListener('click', (event) => {
      if (!activeContext || performance.now() < ignoreOverlayTapUntil) return;
      if (event.target.closest('.mobile-parameter-focus-dock')) return;
      exitParameterFocus(true);
    });
    overlay.addEventListener('pointerdown', (event) => {
      if (event.target.closest('.mobile-parameter-focus-dock')) return;
      event.preventDefault();
      if (activeContext && performance.now() >= ignoreOverlayTapUntil) exitParameterFocus(true);
    });
    overlay
      .querySelector('#mobileParameterFocusClose')
      ?.addEventListener('click', () => exitParameterFocus(true));
    overlay.querySelector('#mobileParameterMinus')?.addEventListener('click', () => nudgeFocusedRange(-1));
    overlay.querySelector('#mobileParameterPlus')?.addEventListener('click', () => nudgeFocusedRange(1));
    overlay.querySelector('#mobileParameterRouting')?.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const id = activeContext?.routingId;
      if (!id) return;
      const button = event.currentTarget;
      const r = button.getBoundingClientRect();
      // Existing unified menu owns the actual Blue/Orange/Audio
      // state, its active profile and the list of Audio targets.
      openUnifiedParameterRoutingMenuForId(id, Math.max(8, r.right - 290), Math.max(8, r.top - 330));
    });
    return overlay;
  }

  // Keep the real input in its original DOM subtree. Many parameter handlers rely
  // on delegated input/change events, so moving the real node to the dock breaks
  // live updates, sometimes rebuilding the row under the user's finger.
  function createFocusProxy(input, kind, context) {
    const proxy = input.cloneNode(false);
    proxy.removeAttribute('id');
    proxy.removeAttribute('name');
    proxy.removeAttribute('data-log-multiplier');
    proxy.classList.add('mobile-focus-proxy');
    proxy.style.accentColor = window.getComputedStyle(input).accentColor;
    proxy.value = input.value;
    const sync = () => {
      if (proxy.isConnected && proxy.value !== input.value) proxy.value = input.value;
      if (kind === 'focusRange') context.updateFocusValue?.();
    };
    const relay = (event) => {
      // The mirrored control is UI only. Do not let its event reach
      // unrelated document-level delegated parameter handlers; they
      // must see the event only from the original input below.
      event.stopPropagation();
      if (input.disabled || !input.isConnected) return;
      input.value = proxy.value;
      input.dispatchEvent(new Event(event.type, { bubbles: true }));
      sync();
    };
    proxy.addEventListener('input', relay);
    proxy.addEventListener('change', relay);
    input.addEventListener('input', sync);
    input.addEventListener('change', sync);
    context.proxyCleanup.push(() => {
      input.removeEventListener('input', sync);
      input.removeEventListener('change', sync);
    });
    context[kind] = proxy;
    return proxy;
  }

  function getRangeStep(range) {
    const step = Number(range.step);
    if (Number.isFinite(step) && step > 0) return step;
    const min = Number(range.min);
    const max = Number(range.max);
    if (Number.isFinite(min) && Number.isFinite(max) && max > min) return (max - min) / 100;
    return 1;
  }

  function nudgeFocusedRange(direction) {
    const range = activeContext?.range;
    if (!range || range.disabled) return;
    const step = getRangeStep(range);
    const min = range.min === '' ? -Infinity : Number(range.min);
    const max = range.max === '' ? Infinity : Number(range.max);
    let value = Number(range.value);
    if (!Number.isFinite(value)) value = Number.isFinite(min) ? min : 0;
    value += direction * step;
    if (Number.isFinite(min)) value = Math.max(min, value);
    if (Number.isFinite(max)) value = Math.min(max, value);
    const decimals = String(step).includes('.') ? Math.min(8, String(step).split('.')[1].length) : 0;
    range.value = decimals
      ? value.toFixed(decimals).replace(/0+$/, '').replace(/\.$/, '')
      : String(Math.round(value));
    range.dispatchEvent(new Event('input', { bubbles: true }));
    range.dispatchEvent(new Event('change', { bubbles: true }));
    if (activeContext?.focusRange) activeContext.focusRange.value = range.value;
    activeContext?.updateFocusValue?.();
    try {
      navigator.vibrate?.(8);
    } catch (error) {
      noteSuppressedError('app/boot#nudgeFocusedRange', error);
    }
  }

  function enterParameterFocus(context) {
    if (!mobileParameterQuery.matches || !context?.row || activeContext) return;
    context.kind ||= 'range';
    if (context.kind === 'range' && !context.range) return;
    const overlay = ensureOverlay();
    const dock = overlay.querySelector('.mobile-parameter-focus-dock');
    const title = overlay.querySelector('#mobileParameterFocusTitle');
    const rangeSlot = overlay.querySelector('#mobileParameterRangeSlot');
    const multiplierWrap = overlay.querySelector('#mobileParameterMultiplierWrap');
    const multiplierSlot = overlay.querySelector('#mobileParameterMultiplierSlot');
    const output = overlay.querySelector('#mobileParameterFocusValue');
    const sourceRect = context.row.getBoundingClientRect();
    // The 13.1 Android focus mode removes the settings drawer from
    // painting. Keep its last position for the exit animation.
    context.sourceRect = sourceRect;
    context.updateFocusValue = () => {
      if (output && context.range) output.textContent = context.range.value;
    };
    context.proxyCleanup = [];
    const widgetSlot = overlay.querySelector('#mobileParameterWidgetSlot');
    const profileSlot = overlay.querySelector('#mobileParameterProfileSlot');
    const controls = overlay.querySelector('.mobile-parameter-focus-controls');
    const routeButton = overlay.querySelector('#mobileParameterRouting');
    context.routingId = routingIdForFocus(context);
    routeButton.classList.toggle('hidden', !context.routingId);
    routeButton.disabled = !context.routingId;
    controls.classList.toggle('hidden', context.kind !== 'range');
    output.classList.toggle('hidden', context.kind !== 'range');
    widgetSlot.classList.toggle('hidden', context.kind !== 'widgets');
    profileSlot.classList.toggle('hidden', context.kind !== 'profile');
    rangeSlot.replaceChildren();
    multiplierSlot.replaceChildren();
    multiplierWrap.classList.add('hidden');
    widgetSlot.replaceChildren();
    profileSlot.replaceChildren();
    if (context.kind === 'range') {
      rangeSlot.appendChild(createFocusProxy(context.range, 'focusRange', context));
      if (context.multiplier) {
        multiplierSlot.appendChild(createFocusProxy(context.multiplier, 'focusMultiplier', context));
        multiplierWrap.classList.remove('hidden');
      }
    } else if (context.kind === 'widgets') {
      mountWidgetProxy(context, widgetSlot);
    } else if (context.kind === 'profile') {
      if (!mountProfileEditor(context, profileSlot)) return;
    }
    title.textContent = context.title;
    context.updateFocusValue();
    activeContext = context;
    ignoreOverlayTapUntil = performance.now() + 420;
    document.body.classList.add('mobile-parameter-focus');
    overlay.classList.add('mobile-parameter-focus-active');
    overlay.setAttribute('aria-hidden', 'false');

    const minus = overlay.querySelector('#mobileParameterMinus');
    const plus = overlay.querySelector('#mobileParameterPlus');
    const disabled = context.kind !== 'range' || context.range.disabled;
    if (minus) minus.disabled = disabled;
    if (plus) plus.disabled = disabled;

    dock.style.transition = 'none';
    dock.style.transform = 'translate3d(0,0,0)';
    dock.style.opacity = '1';
    const dockRect = dock.getBoundingClientRect();
    const sourceCenterY = sourceRect.top + sourceRect.height / 2;
    const dockCenterY = dockRect.top + dockRect.height / 2;
    const deltaY = Math.min(0, sourceCenterY - dockCenterY);
    dock.style.transform = `translate3d(0, ${deltaY}px, 0)`;
    dock.style.opacity = '.72';
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        dock.style.transition = 'transform .30s cubic-bezier(.2,.8,.2,1), opacity .20s ease';
        dock.style.transform = 'translate3d(0,0,0)';
        dock.style.opacity = '1';
      }),
    );
    try {
      navigator.vibrate?.(18);
    } catch (error) {
      noteSuppressedError('app/boot#enterParameterFocus', error);
    }
  }

  function finishExit() {
    if (!activeContext) return;
    const context = activeContext;
    const overlay = document.getElementById('mobileParameterFocusOverlay');
    const dock = overlay?.querySelector('.mobile-parameter-focus-dock');
    for (const cleanup of context.proxyCleanup || []) cleanup();
    context.restoreProfile?.();
    overlay?.querySelector('#mobileParameterRangeSlot')?.replaceChildren();
    overlay?.querySelector('#mobileParameterMultiplierSlot')?.replaceChildren();
    overlay?.querySelector('#mobileParameterWidgetSlot')?.replaceChildren();
    overlay?.querySelector('#mobileParameterProfileSlot')?.replaceChildren();
    const menu = document.getElementById('parameterRoutingContextMenu');
    menu?.classList.add('hidden');
    if (dock) {
      dock.style.transition = '';
      dock.style.transform = '';
      dock.style.opacity = '';
    }
    overlay?.classList.remove('mobile-parameter-focus-active');
    overlay?.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('mobile-parameter-focus');
    activeContext = null;
    requestAnimationFrame(() => {
      requestMainCanvasRender();
    });
  }

  function exitParameterFocus(animated) {
    if (!activeContext) return;
    if (activeContext.exiting && animated) return;
    activeContext.exiting = true;
    const overlay = document.getElementById('mobileParameterFocusOverlay');
    const dock = overlay?.querySelector('.mobile-parameter-focus-dock');
    if (!animated || !dock) {
      finishExit();
      return;
    }
    const rect = activeContext.sourceRect || activeContext.row?.getBoundingClientRect?.();
    const dockRect = dock.getBoundingClientRect();
    const targetY = rect
      ? Math.min(0, rect.top + rect.height / 2 - (dockRect.top + dockRect.height / 2))
      : 80;
    dock.style.transition = 'transform .24s cubic-bezier(.4,0,.2,1), opacity .18s ease';
    dock.style.transform = `translate3d(0, ${targetY}px, 0)`;
    dock.style.opacity = '.25';
    window.setTimeout(finishExit, 250);
  }

  function clearPress() {
    if (pressTimer) clearTimeout(pressTimer);
    pressTimer = 0;
    pressPointerId = null;
    pendingContext = null;
  }

  document.addEventListener(
    'pointerdown',
    (event) => {
      if (!mobileParameterQuery.matches || activeContext || event.button > 0 || event.pointerType === 'mouse')
        return;
      const context = findFocusContext(event.target);
      if (!context) return;
      clearPress();
      pendingContext = context;
      pressPointerId = event.pointerId;
      pressStartX = event.clientX;
      pressStartY = event.clientY;
      pressTimer = window.setTimeout(() => {
        const ctx = pendingContext;
        clearPress();
        if (ctx) enterParameterFocus(ctx);
      }, LONG_PRESS_MS);
    },
    true,
  );

  document.addEventListener(
    'pointermove',
    (event) => {
      if (!pressTimer || event.pointerId !== pressPointerId) return;
      if (Math.hypot(event.clientX - pressStartX, event.clientY - pressStartY) > MOVE_CANCEL_PX) clearPress();
    },
    true,
  );
  document.addEventListener('pointerup', clearPress, true);
  document.addEventListener('pointercancel', clearPress, true);

  document.addEventListener(
    'contextmenu',
    (event) => {
      if (!mobileParameterQuery.matches) return;
      if (activeContext || findFocusContext(event.target)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    },
    true,
  );

  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape' && activeContext) {
        event.preventDefault();
        exitParameterFocus(true);
      }
    },
    true,
  );

  const onQueryChange = () => {
    clearPress();
    if (!mobileParameterQuery.matches && activeContext) exitParameterFocus(false);
  };
  if (mobileParameterQuery.addEventListener) mobileParameterQuery.addEventListener('change', onQueryChange);
  else mobileParameterQuery.addListener?.(onQueryChange);
})();
window.__spiroAppBootComplete = true;
try {
  requestMainCanvasRender();
} catch (error) {
  noteSuppressedError('app/boot', error);
}
