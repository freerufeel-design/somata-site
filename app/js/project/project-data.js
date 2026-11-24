// Проект: сериализация, камера, настройки меню, плейлист.
import { normalizeTunnelDensity } from '../corridor/corridor-density.js';
import '../ui/input-viewport-events.js'; // initialisation order: this module runs after it
import { PROFILE_CONFIG, normalizeSplinePointCount } from '../geometry/profile-model.js';
import { normalizeSpiralOrder } from '../geometry/spiral/order-params.js';
import { AUDIO_ROUTING_PRESETS, ensureAudioRoutingState } from '../audio/audio-routing.js';
import { lightningRateSyncEnabled } from '../effects/lightning.js';
import {
  createLayerId,
  getActiveEffectLayer,
  getLayerLampsEnabled,
  getLayerSweepConfig,
  getLayerWebConfig,
  getLayerWebEnabled,
} from '../core/defaults-layers.js';
import {
  ensurePlaylistColorPalettes,
  morphPaletteSyncEnabled,
  normalizePlaylistHueOffset,
  normalizePlaylistPaletteKey,
} from '../core/palette.js';
import {
  applyFpsVisibility,
  canvasViewport,
  mainContainerEl,
  showFpsCounter,
} from '../core/render-runtime.js';
import { requestMainCanvasRender } from '../core/scheduler.js';
import { STATE_RUNTIME_FIELDS, state } from '../core/state.js';
import { normalizeMotionState } from '../effects/motion.js';
import {
  normalizeSpiralOuterCopies,
  normalizeTunnelCenterHiddenCopies,
} from '../corridor/corridor-appearance.js';
import { normalizeMorphVertexMultiplier } from '../ui/geometry-n-control.js';
import { getSpiralMorphMode, getSpiralMorphType, getUnifiedMorphMode } from '../morph-runtime/morph-mode.js';
import { resetAutoTapBandTrackers, resetTempoLock, syncTapUI } from '../audio/tap-tempo.js';
import { syncMorphSettingsUI } from '../ui/morph-settings-panel.js';
import { normalizeSceneBlendState } from '../ui/viewport-background.js';
import { renderEffectOrderSettings } from '../ui/floating-panels.js';
import { applyHeaderVisibility } from '../ui/header-and-export.js';

const cloneData = (value) => JSON.parse(JSON.stringify(value));
function mergePersistentProjectSection(sectionName, raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
  const target = state?.[sectionName];
  if (!target || typeof target !== 'object' || Array.isArray(target)) return;
  const runtimeKeys = new Set(
    typeof STATE_RUNTIME_FIELDS !== 'undefined' && Array.isArray(STATE_RUNTIME_FIELDS?.[sectionName])
      ? STATE_RUNTIME_FIELDS[sectionName]
      : [],
  );
  for (const [key, value] of Object.entries(raw)) {
    if (runtimeKeys.has(key)) continue;
    target[key] = cloneData(value);
  }
}
function currentProjectCameraSnapshot() {
  const width = Math.max(
    1,
    Number(canvasViewport?.w) || Number(mainContainerEl?.clientWidth) || Number(window.innerWidth) || 1,
  );
  const height = Math.max(
    1,
    Number(canvasViewport?.h) || Number(mainContainerEl?.clientHeight) || Number(window.innerHeight) || 1,
  );
  const panX = Number(state.panX) || 0,
    panY = Number(state.panY) || 0;
  return {
    zoom: Math.max(0.2, Math.min(5, Number(state.zoom) || 1)),
    panX,
    panY,
    normalizedPanX: panX / width,
    normalizedPanY: panY / height,
    viewportWidth: width,
    viewportHeight: height,
  };
}
function isCompactMobileViewport() {
  return (
    window.matchMedia?.('(max-width: 760px)')?.matches === true ||
    window.matchMedia?.('(pointer: coarse)')?.matches === true
  );
}
function applyProjectCameraSettings(settings, deferRelayout = true) {
  const camera = settings?.camera && typeof settings.camera === 'object' ? settings.camera : null;
  const legacyZoom = Number(settings?.zoom),
    legacyPanX = Number(settings?.panX),
    legacyPanY = Number(settings?.panY);
  const zoom = Number(camera?.zoom);
  state.zoom = Math.max(
    0.2,
    Math.min(5, Number.isFinite(zoom) ? zoom : Number.isFinite(legacyZoom) ? legacyZoom : state.zoom),
  );
  const applyPan = () => {
    const width = Math.max(
      1,
      Number(mainContainerEl?.clientWidth) || Number(canvasViewport?.w) || Number(window.innerWidth) || 1,
    );
    const height = Math.max(
      1,
      Number(mainContainerEl?.clientHeight) || Number(canvasViewport?.h) || Number(window.innerHeight) || 1,
    );
    if (
      camera &&
      Number.isFinite(Number(camera.normalizedPanX)) &&
      Number.isFinite(Number(camera.normalizedPanY))
    ) {
      state.panX = Number(camera.normalizedPanX) * width;
      state.panY = Number(camera.normalizedPanY) * height;
    } else if (isCompactMobileViewport()) {
      state.panX = 0;
      state.panY = 0;
    } else {
      if (Number.isFinite(legacyPanX)) state.panX = legacyPanX;
      if (Number.isFinite(legacyPanY)) state.panY = legacyPanY;
    }
    requestMainCanvasRender();
  };
  applyPan();
  if (deferRelayout && typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => requestAnimationFrame(applyPan));
  }
}
function cloneProjectDataFast(value) {
  if (Array.isArray(value)) return value.map(cloneProjectDataFast);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = cloneProjectDataFast(v);
    return out;
  }
  return value;
}
const PROJECT_FILL_HARMONY_KEYS = new Set([
  'native',
  'analogous',
  'square',
  'triadic',
  'split',
  'complement',
  'all',
]);
function buildProjectData() {
  ensureAudioRoutingState();
  const persistentTunnel = cloneData(state.tunnel);
  delete persistentTunnel.direction;
  persistentTunnel.signedSpeedVersion = 1;
  const persistentMorph =
    window.SomataMorphParameterRouting?.persistentMorphSnapshot?.(state.morph, state.minimalMorph) ||
    cloneData(state.morph);
  const persistentMinimalMorph =
    window.SomataMorphParameterRouting?.persistentMinimalMorphSnapshot?.(state.morph, state.minimalMorph) ||
    cloneData(state.minimalMorph);
  const persistentRandomOptions =
    window.SomataOrangeMorphProfiles?.persistentRandomOptions?.(
      state.minimalMorph,
      state.randomOptions,
      state.randomLayerCount,
    ) || cloneData(state.randomOptions);
  const persistentRandomLayerCount =
    window.SomataOrangeMorphProfiles?.persistentLayerCount?.(
      state.minimalMorph,
      state.randomOptions,
      state.randomLayerCount,
    ) ||
    state.randomLayerCount ||
    3;
  const persistentTapTempo = cloneData(state.tapTempo);
  const persistentAudioReactive = cloneData(state.audioReactive);
  const camera = currentProjectCameraSnapshot();
  return {
    format: 'SpiroStarProject',
    extension: '.sproj',
    version: 58,
    savedAt: new Date().toISOString(),
    settings: {
      activeProjectPaletteKey: normalizePlaylistPaletteKey(
        state.activeProjectPaletteKey || state.morph?.lineColorPalette || 'standard',
        'standard',
      ),
      activeLayerId: state.activeLayerId || null,
      masterLayerEdit: state.masterLayerEdit === true,
      graffitiDefaultActive: state.graffitiDefaultActive === true,
      bgColor: state.bgColor,
      backgroundImageDataUrl: state.backgroundImageDataUrl || '',
      transparentDesktop: state.transparentDesktop === true,
      sceneBlend: cloneData(normalizeSceneBlendState()),
      menuSettings: captureMenuSettings(),
      showFps: showFpsCounter !== false,
      showGrid: state.showGrid,
      mirrorMode: state.mirrorMode === true,
      showRoundingGuides: state.roundingGuidesOverlayEnabled === true,
      roundingGuidesDashed: state.roundingGuidesDashed,
      roundingGuideColor: state.roundingGuideColor,
      roundingGuideOpacity: state.roundingGuideOpacity,
      showBoundingCircle: state.showBoundingCircle,
      boundingCircleColor: state.boundingCircleColor || '#94a3b8',
      showVignette: state.showVignette !== false,
      sidebarMode: state.sidebarMode,
      motion: cloneData(normalizeMotionState()),
      fourierPerLayer: true,
      // Legacy global-mode marker. Layer rounding is the sole parameter.
      fourierMode: state.layers.some((l) => l.roundingCornerType === 'fourier'),
      showLines: state.showLines !== false,
      showLamps: getLayerLampsEnabled(getActiveEffectLayer()),
      showWeb: getLayerWebEnabled(getActiveEffectLayer()),
      lightningRateSync: lightningRateSyncEnabled(),
      sweep: cloneData(getLayerSweepConfig(getActiveEffectLayer())),
      web: cloneData(getLayerWebConfig(getActiveEffectLayer())),
      lineOutline: cloneData(state.lineOutline),
      lamps: cloneData(state.lamps),
      ambient: cloneData(state.ambient),
      ambientOverPrism: state.ambientOverPrism === true,
      prism: cloneData(state.prism),
      zoom: camera.zoom,
      panX: camera.panX,
      panY: camera.panY,
      camera,
      profileView: cloneData(PROFILE_CONFIG),
      tunnel: {
        ...persistentTunnel,
        defaultActive: state.tunnel.defaultActive === true,
        speedStrength: state.tunnel.speedStrength,
        spiralTravelRotation: state.tunnel.spiralTravelRotation === true,
        signedSpeedVersion: 1,
        speedMultiplier: state.tunnel.speedMultiplier,
        spacingStrength: state.tunnel.spacingStrength,
        spacingMultiplier: state.tunnel.spacingMultiplier,
        depthCurve: state.tunnel.depthCurve,
        depthCurveMultiplier: state.tunnel.depthCurveMultiplier,
        density: normalizeTunnelDensity(state.tunnel.density),
        centerHiddenCopies: normalizeTunnelCenterHiddenCopies(state.tunnel),
        spiralOuterCopies: normalizeSpiralOuterCopies(state.tunnel),
        colorShiftEnabled: state.tunnel.colorShiftEnabled === true,
        colorShiftDegrees: state.tunnel.colorShiftDegrees,
        colorShiftCumulative: state.tunnel.colorShiftCumulative === true,
        paletteLagEnabled: state.tunnel.paletteLagEnabled === true,
        fadeOversize: state.tunnel.fadeOversize,
        fadeOffsetSteps: state.tunnel.fadeOffsetSteps,
        vignetteAmount: state.tunnel.vignetteAmount,
        vignetteMultiplier: state.tunnel.vignetteMultiplier ?? 1,
        vignetteUnit: 'px',
        fadeDurationSec: state.tunnel.fadeDurationSec,
        optimizedCalculation: state.tunnel.optimizedCalculation !== false,
      },
      morph: {
        ...persistentMorph,
        defaultActive: state.morph.defaultActive === true,
        intervalSec: state.morph.intervalSec,
        intervalMultiplier: Math.max(0.015625, Number(state.morph.intervalMultiplier) || 1),
        diversity: state.morph.diversity,
        vertexMin: state.morph.vertexMin,
        vertexMax: state.morph.vertexMax,
        vertexMultiplier: normalizeMorphVertexMultiplier(state.morph.vertexMultiplier),
        roundingMin: state.morph.roundingMin,
        roundingMax: state.morph.roundingMax,
        stepMin: state.morph.stepMin,
        stepMax: state.morph.stepMax,
        monoOrbitTransforms: state.morph.monoOrbitTransforms,
        orbitPercentMin: state.morph.orbitPercentMin,
        orbitPercentMax: state.morph.orbitPercentMax,
        strokeWidthMin: state.morph.strokeWidthMin,
        strokeWidthMax: state.morph.strokeWidthMax,
        opacityMin: state.morph.opacityMin,
        opacityMax: state.morph.opacityMax,
        fillLayersMin: state.morph.fillLayersMin,
        fillLayersMax: state.morph.fillLayersMax,
        fillHueMin: state.morph.fillHueMin,
        fillHueMax: state.morph.fillHueMax,
        fillHueReset: state.morph.fillHueReset,
        fillHueHarmony: state.morph.fillHueHarmony,
        sizeVariation: state.morph.sizeVariation,
        sizeVariationMultiplier: state.morph.sizeVariationMultiplier,
        normalizeSizes: state.morph.normalizeSizes !== false,
        rotationMinPercent: state.morph.rotationMinPercent,
        rotationMaxPercent: state.morph.rotationMaxPercent,
        rotationMultiplier: state.morph.rotationMultiplier,
        rotationRandomDirection: state.morph.rotationRandomDirection,
        fillOpacityMin: state.morph.fillOpacityMin,
        fillOpacityMax: state.morph.fillOpacityMax,
        splinePoints: normalizeSplinePointCount(state.morph.splinePoints),
        spiralOrderHoldPhases: SomataSpiralZeroTransition.holdPhases(state.morph.spiralOrderHoldPhases),
        spiralOrderMin: normalizeSpiralOrder(state.morph.spiralOrderMin, true),
        spiralOrderMax: normalizeSpiralOrder(state.morph.spiralOrderMax, true),
        spiralOrderLinked: state.morph.spiralOrderLinked === true,
        lineColorPalette: state.morph.lineColorPalette || 'standard',
        cyclePalettes: state.morph.cyclePalettes === true,
        fixedColors: state.morph.fixedColors === true,
        syncPalettesBetweenMorphs: morphPaletteSyncEnabled(),
        morphGlobalHueOffset: state.morph.morphGlobalHueOffset === true,
        globalHueOffsetRange: Math.max(
          0,
          Math.min(
            360,
            Number.isFinite(Number(state.morph.globalHueOffsetRange))
              ? Number(state.morph.globalHueOffsetRange)
              : 180,
          ),
        ),
        spiralLayersMin: Math.max(0, Math.min(64, Math.round(Number(state.morph.spiralLayersMin) || 0))),
        spiralLayersMax: Math.max(0, Math.min(64, Math.round(Number(state.morph.spiralLayersMax ?? 1) || 0))),
        spiralTangentialChance: Math.max(0, Math.min(100, Number(state.morph.spiralTangentialChance ?? 50))),
        chaosMorphEnabled: state.morph.chaosMorphEnabled === true,
        chaosMorphStepSpread: Math.max(
          0,
          Math.min(120, Math.round(Number(state.morph.chaosMorphStepSpread ?? 1))),
        ),
        chaosMorphClosuresMax: Math.max(
          0,
          Math.min(120, Math.round(Number(state.morph.chaosMorphClosuresMax ?? 3))),
        ),
        preserveSpiralContinuity: getSpiralMorphType() !== 'torn',
        spiralMorphType: getSpiralMorphType(),
        spiralRotationCompensation: state.morph.spiralRotationCompensation === true,
        pauseOnSpace: state.morph.pauseOnSpace === true,
        mode: state.morph.mode,
        unifiedMode: getUnifiedMorphMode(),
        spiralMode: getSpiralMorphMode(),
        fadePercent: state.morph.fadePercent,
        circleProfileOverflow: state.morph.circleProfileOverflow,
        slideType: state.morph.slideType,
        speedType: state.morph.speedType,
        lightningWhite: state.morph.lightningWhite,
        lightningRandom: state.morph.lightningRandom,
        lightningColor: state.morph.lightningColor,
        lightningSegmentPercent: state.morph.lightningSegmentPercent,
        lightningGlow: state.morph.lightningGlow,
        options: cloneData(state.morph.options),
        shapeOptions: cloneData(state.morph.shapeOptions),
      },
      randomLayerCount: persistentRandomLayerCount,
      randomOptions: persistentRandomOptions,
      minimalMorph: {
        ...persistentMinimalMorph,
      },
      tapTempo: {
        ...persistentTapTempo,
        bpm: state.tapTempo.bpm,
        beatsPerMorph: state.tapTempo.beatsPerMorph,
        autoTap: state.tapTempo.autoTap,
        autoWindowSec: state.tapTempo.autoWindowSec,
        autoBand: state.tapTempo.autoBand,
        syncFullMorph: state.tapTempo.syncFullMorph === true,
        syncMinimalMorph: state.tapTempo.syncMinimalMorph === true,
      },
      audioReactive: {
        ...persistentAudioReactive,
        source: state.audioReactive.source,
        noiseGateEnabled: state.audioReactive.noiseGateEnabled,
        noiseGateThresholdDb: state.audioReactive.noiseGateThresholdDb,
        noiseGateSoftEnabled: state.audioReactive.noiseGateSoftEnabled,
        noiseGateStrength: state.audioReactive.noiseGateStrength,
        highPassHz: state.audioReactive.highPassHz,
        lowHz: state.audioReactive.lowHz,
        highHz: state.audioReactive.highHz,
        lowPassHz: state.audioReactive.lowPassHz,
        bandCount: state.audioReactive.bandCount,
        customBandsEnabled: state.audioReactive.customBandsEnabled === true,
        masterBandEdges: cloneData(state.audioReactive.masterBandEdges || []),
        customBandRanges: cloneData(state.audioReactive.customBandRanges || {}),
        bandGains: cloneData(state.audioReactive.bandGains || {}),
        defaultRoutesEnabled: state.audioReactive.defaultRoutesEnabled !== false,
        normalizeLowSignal: state.audioReactive.normalizeLowSignal,
        inputSmoothingEnabled: state.audioReactive.inputSmoothingEnabled === true,
        inputSmoothingStrength: state.audioReactive.inputSmoothingStrength,
        inputSmoothingMultiplier: state.audioReactive.inputSmoothingMultiplier,
        masterGainStrength: state.audioReactive.masterGainStrength,
        masterGainMultiplier: state.audioReactive.masterGainMultiplier,
        effectsAmplitudeStrength: state.audioReactive.effectsAmplitudeStrength,
        effectsAmplitudeMultiplier: state.audioReactive.effectsAmplitudeMultiplier,
        sizeStrength: state.audioReactive.sizeStrength,
        sizeMultiplier: state.audioReactive.sizeMultiplier,
        rotationEnabled: state.audioReactive.rotationEnabled,
        rotationStrength: state.audioReactive.rotationStrength,
        rotationMultiplier: state.audioReactive.rotationMultiplier,
        analysisIntervalMs: state.audioReactive.analysisIntervalMs,
        meterIntervalMs: state.audioReactive.meterIntervalMs,
        routingInitialized: state.audioReactive.routingInitialized === true,
        routingTarget: state.audioReactive.routingTarget || 'master',
        routingPreset: AUDIO_ROUTING_PRESETS.has(state.audioReactive.routingPreset)
          ? state.audioReactive.routingPreset
          : 'free',
        masterRouteMultipliers: cloneData(state.audioReactive.masterRouteMultipliers || {}),
        groupToggleMemory: cloneData(state.audioReactive.groupToggleMemory || {}),
        layerSignalEnabled: cloneData(state.audioReactive.layerSignalEnabled || {}),
        routes: cloneData(state.audioReactive.routes || { master: [], layers: {} }),
      },
      playback: {
        lastMorphType: state.morphPlayback?.lastType || null,
      },
    },
    layers: cloneData(state.layers),

    library: { shapes: cloneData(state.library?.shapes || []) },
  };
}
const PLAYLIST_FORMAT = 'SpiroStarPlaylist';
const PLAYLIST_VERSION = 5;
function makeDefaultPlaylistFileName() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `Somata_Playlist_${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}.plist`;
}
function currentPlaylistSuggestedFileName() {
  const raw = String(state.playlistFileName || '').trim();
  if (raw) {
    const clean = raw.replace(/[\\/:*?"<>|]+/g, '_').trim();
    const base = clean.replace(/\.(plist|json)$/i, '');
    return `${base || 'Somata_Playlist'}.plist`;
  }
  return makeDefaultPlaylistFileName();
}
function sanitizeProjectFileBase(name, fallback = 'Somata_Project') {
  const clean = String(name || '')
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.(sproj|spiroproject|spirostar|json)$/i, '');
  return clean || fallback;
}
function defaultPlaylistProjectName(index = 0) {
  return Number(index) === 0 ? 'Проект один' : `Проект ${Number(index) + 1}`;
}
function uniquePlaylistProjectName(name, ignoreId = null, entries = state.playlistProjects || []) {
  const base = String(name || 'Проект один').trim() || 'Проект один';
  const used = new Set(
    (entries || [])
      .filter((e) => !ignoreId || e.id !== ignoreId)
      .map((e) =>
        String(e?.name || '')
          .trim()
          .toLocaleLowerCase('ru-RU'),
      ),
  );
  if (!used.has(base.toLocaleLowerCase('ru-RU'))) return base;
  let n = 2,
    candidate = `${base} (${n})`;
  while (used.has(candidate.toLocaleLowerCase('ru-RU'))) {
    n++;
    candidate = `${base} (${n})`;
  }
  return candidate;
}
function normalizePlaylistProjectNames(entries) {
  const out = [];
  for (const entry of entries || []) {
    entry.name = uniquePlaylistProjectName(entry.name, null, out);
    out.push(entry);
  }
  return out;
}
function isSpiroProjectData(value) {
  if (Array.isArray(value)) return value.length > 0;
  return Boolean(value && typeof value === 'object' && Array.isArray(value.layers) && value.layers.length);
}
// Normalize old per-layer and scene-wide Fourier values at every import
// boundary, including inactive playlist entries used by Green Morph.
function migrateFourierProjectData(project) {
  const layers = Array.isArray(project) ? project : project?.layers;
  if (!Array.isArray(layers)) return project;
  const settings = Array.isArray(project) ? null : project.settings;
  const global = settings?.fourierPerLayer !== true && settings?.fourierMode === true;
  const inverse = value => {
    const v = Number(value);
    return 200 - 2 * Math.max(0, Math.min(100, Number.isFinite(v) ? v : 50));
  };
  let changed = false;
  const next = layers.map(layer => {
    if (!layer || typeof layer !== 'object') return layer;
    if (!global && !Object.hasOwn(layer, 'fourierStrength')) return layer;
    changed = true;
    const out = { ...layer };
    if (global) {
      if (out.roundingCornerType !== 'fourier')
        out.roundingPreviousCornerType = ['local','simple'].includes(out.roundingCornerType) ? out.roundingCornerType : 'classic';
      out.roundingCornerType = 'fourier';
      out.rounding = inverse(settings.fourierStrength ?? 50);
    } else if (out.roundingCornerType === 'fourier' && out.fourierStrength != null) {
      out.rounding = inverse(out.fourierStrength);
    }
    delete out.fourierStrength;
    return out;
  });
  if (Array.isArray(project)) return changed ? next : project;
  if (!changed && !Object.hasOwn(settings || {}, 'fourierStrength')) return project;
  const out = { ...project, layers: next };
  if (settings) {
    out.settings = { ...settings, fourierPerLayer: true };
    delete out.settings.fourierStrength;
  }
  return out;
}
function normalizePlaylistProjectEntry(entry, index = 0) {
  const project = entry?.project ?? entry?.data ?? entry;
  if (!isSpiroProjectData(project)) return null;
  return {
    id: String(entry?.id || createLayerId('project')),
    name: String(entry?.name || defaultPlaylistProjectName(index)),
    updatedAt: entry?.updatedAt || new Date().toISOString(),

    project: migrateFourierProjectData(project),
  };
}
function getCurrentPlaylistProjectIndex() {
  return (state.playlistProjects || []).findIndex((p) => p.id === state.playlistCurrentProjectId);
}
function captureMenuSettings() {
  return {
    showFps: showFpsCounter !== false,
    showPresets: state.uiVisibility?.showPresets === true,
    showProjects: state.uiVisibility?.showProjects !== false,
    showMorphs: state.uiVisibility?.hideMorphChooser !== true,
    showProfiles: state.uiVisibility?.hideProfiles !== true,
    pauseOnSpace: state.morph?.pauseOnSpace === true,
    effectOrder:
      window.SomataEffectStackOrder?.current?.() ||
      (Array.isArray(state.effectOrder) ? state.effectOrder.slice() : []),
  };
}
function normalizeMenuSettings(raw, fallback = null) {
  const base = fallback && typeof fallback === 'object' ? { ...fallback } : captureMenuSettings();
  const r = raw && typeof raw === 'object' ? raw : {};
  if (typeof r.showFps === 'boolean') base.showFps = r.showFps;
  if (typeof r.showPresets === 'boolean') base.showPresets = r.showPresets;
  else if (typeof r.hidePresets === 'boolean') base.showPresets = !r.hidePresets;
  if (typeof r.showProjects === 'boolean') base.showProjects = r.showProjects;
  else if (typeof r.hideProjects === 'boolean') base.showProjects = !r.hideProjects;
  if (typeof r.showMorphs === 'boolean') base.showMorphs = r.showMorphs;
  else if (typeof r.hideMorphChooser === 'boolean') base.showMorphs = !r.hideMorphChooser;
  if (typeof r.showProfiles === 'boolean') base.showProfiles = r.showProfiles;
  else if (typeof r.hideProfiles === 'boolean') base.showProfiles = !r.hideProfiles;
  if (typeof r.pauseOnSpace === 'boolean') base.pauseOnSpace = r.pauseOnSpace;
  if (Array.isArray(r.effectOrder))
    base.effectOrder = window.SomataEffectStackOrder?.normalize?.(r.effectOrder) || r.effectOrder.slice();
  else base.effectOrder = window.SomataEffectStackOrder?.normalize?.(base.effectOrder) || base.effectOrder;
  return base;
}
function projectMenuSettingsFromProject(project) {
  const settings = project?.settings || {};
  if (settings.menuSettings && typeof settings.menuSettings === 'object')
    return normalizeMenuSettings(settings.menuSettings);
  const legacy = {
    showFps: typeof settings.showFps === 'boolean' ? settings.showFps : undefined,
    showPresets: settings.uiVisibility?.showPresets,
    showProjects: settings.uiVisibility?.showProjects,
    hideMorphChooser: settings.uiVisibility?.hideMorphChooser,
    hideProfiles: settings.uiVisibility?.hideProfiles,
    pauseOnSpace: settings.morph?.pauseOnSpace,
  };
  return normalizeMenuSettings(legacy);
}
function applyMenuSettings(raw) {
  const m = normalizeMenuSettings(raw);
  state.uiVisibility.showPresets = m.showPresets === true;
  state.uiVisibility.showProjects = m.showProjects !== false;
  state.uiVisibility.hideMorphChooser = m.showMorphs === false;
  state.uiVisibility.hideProfiles = m.showProfiles === false;
  state.morph.pauseOnSpace = m.pauseOnSpace === true;
  if (Array.isArray(m.effectOrder)) {
    if (window.SomataEffectStackOrder?.set) window.SomataEffectStackOrder.set(m.effectOrder);
    else state.effectOrder = m.effectOrder.slice();
  }
  renderEffectOrderSettings();
  applyFpsVisibility(m.showFps !== false, false);
  applyHeaderVisibility();
  const pause = document.getElementById('morphPauseOnSpace');
  if (pause) pause.checked = state.morph.pauseOnSpace === true;
}
function capturePlaylistOverridesFromCurrent() {
  if (!state.playlistOverridesActive || state.suppressPlaylistOverrideCapture) return;
  state.playlistMenuSettings = captureMenuSettings();
  state.playlistBpm = Math.max(0, Math.min(300, Number(state.tapTempo?.bpm) || 0));
  state.playlistTapTempo = {
    autoTap: state.tapTempo?.autoTap === true,
    autoWindowSec: Math.max(1, Number(state.tapTempo?.autoWindowSec) || 10),
    autoBand: ['low', 'lowMid', 'mid', 'midHigh', 'high', 'combined'].includes(state.tapTempo?.autoBand)
      ? state.tapTempo.autoBand
      : 'low',
  };
}
function applyPlaylistOverrides() {
  if (!state.playlistOverridesActive) return;
  if (state.playlistMenuSettings) applyMenuSettings(state.playlistMenuSettings);
  if (Number.isFinite(Number(state.playlistBpm)))
    state.tapTempo.bpm = Math.max(0, Math.min(300, Number(state.playlistBpm)));
  const pt =
    state.playlistTapTempo && typeof state.playlistTapTempo === 'object' ? state.playlistTapTempo : null;
  if (pt) {
    state.tapTempo.autoTap = pt.autoTap === true;
    state.tapTempo.autoWindowSec = Math.max(1, Number(pt.autoWindowSec) || 10);
    state.tapTempo.autoBand = ['low', 'lowMid', 'mid', 'midHigh', 'high', 'combined'].includes(pt.autoBand)
      ? pt.autoBand
      : 'low';
    if (state.tapTempo.autoTap) {
      state.tapTempo.syncFullMorph = true;
      state.tapTempo.syncMinimalMorph = true;
    }
    resetAutoTapBandTrackers();
  }
  resetTempoLock(true); // playlist BPM is authoritative on a project boundary
  syncTapUI();
  syncMorphSettingsUI();
}
function buildPlaylistData() {
  return {
    format: PLAYLIST_FORMAT,
    extension: '.plist',
    version: PLAYLIST_VERSION,
    savedAt: new Date().toISOString(),
    currentProjectId: state.playlistCurrentProjectId || null,
    menuSettings: cloneData(state.playlistMenuSettings || captureMenuSettings()),
    tapTempo: {
      bpm: Math.max(0, Math.min(300, Number(state.playlistBpm ?? state.tapTempo?.bpm) || 0)),
      autoTap: (state.playlistTapTempo?.autoTap ?? state.tapTempo?.autoTap) === true,
      autoWindowSec: Math.max(
        1,
        Number(state.playlistTapTempo?.autoWindowSec ?? state.tapTempo?.autoWindowSec) || 10,
      ),
      autoBand: ['low', 'lowMid', 'mid', 'midHigh', 'high', 'combined'].includes(
        state.playlistTapTempo?.autoBand ?? state.tapTempo?.autoBand,
      )
        ? (state.playlistTapTempo?.autoBand ?? state.tapTempo?.autoBand)
        : 'low',
    },
    projectMorph: {
      ...cloneData(state.projectMorph || {}),
      intervalSec: Math.max(0.01, Number(state.projectMorph?.intervalSec) || 16),
      syncTap: state.projectMorph?.syncTap !== false,
      beatsPerProject: Math.max(
        1,
        Math.min(256, Math.round(Number(state.projectMorph?.beatsPerProject) || 32)),
      ),
      transitionBeats: Math.max(
        0,
        Math.min(
          256,
          Math.round(
            state.projectMorph?.transitionBeats != null &&
              Number.isFinite(Number(state.projectMorph.transitionBeats))
              ? Number(state.projectMorph.transitionBeats)
              : 8,
          ),
        ),
      ),
      cameraWander: state.projectMorph?.cameraWander === true,
      transitionType: ['fade', 'linear', 'smooth'].includes(state.projectMorph?.transitionType)
        ? state.projectMorph.transitionType
        : 'smooth',
      advancedLinear: state.projectMorph?.advancedLinear === true,
      transitionSec: Math.max(0, Number(state.projectMorph?.transitionSec) || 4),
      imageTransitionType: ['instant', 'fade', 'slide', 'center', 'sector'].includes(
        state.projectMorph?.imageTransitionType,
      )
        ? state.projectMorph.imageTransitionType
        : 'fade',
      imageCenterSoftness: Math.max(0, Math.min(100, Number(state.projectMorph?.imageCenterSoftness ?? 24))),
      imageSectorSoftness: Math.max(0, Math.min(100, Number(state.projectMorph?.imageSectorSoftness ?? 18))),
    },
    defaultSettings:
      state.playlistDefaultSettings && typeof state.playlistDefaultSettings === 'object'
        ? cloneData(state.playlistDefaultSettings)
        : null,
    colorPalettes: cloneData(ensurePlaylistColorPalettes()),
    paletteHueOffset: normalizePlaylistHueOffset(state.playlistPaletteHueOffset),
    projects: cloneData(state.playlistProjects || []),
  };
}

export {
  PLAYLIST_FORMAT,
  PROJECT_FILL_HARMONY_KEYS,
  applyMenuSettings,
  applyPlaylistOverrides,
  applyProjectCameraSettings,
  buildPlaylistData,
  buildProjectData,
  captureMenuSettings,
  capturePlaylistOverridesFromCurrent,
  cloneData,
  cloneProjectDataFast,
  currentPlaylistSuggestedFileName,
  defaultPlaylistProjectName,
  getCurrentPlaylistProjectIndex,
  isCompactMobileViewport,
  isSpiroProjectData,
  mergePersistentProjectSection,
  migrateFourierProjectData,
  normalizeMenuSettings,
  normalizePlaylistProjectEntry,
  normalizePlaylistProjectNames,
  projectMenuSettingsFromProject,
  sanitizeProjectFileBase,
  uniquePlaylistProjectName,
};
