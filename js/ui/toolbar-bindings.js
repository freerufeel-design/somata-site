// Привязка кнопок панели инструментов, заводские настройки морфа.
import './library.js'; // initialisation order: this module runs after it
import { renderProfileEditor } from './profile-editor.js';
import {
  ensurePlaylistColorPalettes,
  normalizePlaylistColorPalettes,
  normalizePlaylistHueOffset,
} from '../core/palette.js';
import { requestMainCanvasRender } from '../core/scheduler.js';
import { runtimeState, state } from '../core/state.js';
import { renderMainCanvas } from '../render/main-pipeline.js';
import { updateLayerListUI } from './layer-selection.js';
import { formatDisplayNumber } from './geometry-n-control.js';
import { getSpiralMorphMode, getUnifiedMorphMode } from '../morph-runtime/morph-mode.js';
import { syncSidebarInputs } from './sidebar-sync.js';
import { activeRebaseMorphing } from '../morph-runtime/morph-hooks.js';
import { renderPlaylistPaletteButtons } from './playlist-palettes.js';
import { syncRandomSettingsUI } from './orange-morph/routing-ui.js';
import { syncMorphSettingsUI } from './morph-settings-panel.js';
import {
  applyPlaylistOverrides,
  captureMenuSettings,
  cloneData,
  getCurrentPlaylistProjectIndex,
  sanitizeProjectFileBase,
} from '../project/project-data.js';
import {
  activateProjectMorphTransition,
  getProjectMorphDurationSec,
  getProjectMorphTransitionSec,
  normalizeProjectMorphSettings,
  startProjectMorphing,
  stopProjectMorphing,
  syncProjectMorphUI,
} from '../project/project-morph.js';
import {
  deleteCurrentPlaylistProject,
  exportPlaylistProjects,
  handlePlaylistPlusSave,
  hideProjectNameMenus,
  importProjectsIntoPlaylist,
  loadPlaylistDocument,
  loadPlaylistProjectByIndex,
  openDefaultPlaylist,
  openPlaylist,
  projectContextIndex,
  quiesceProjectRuntimeForCommit,
  renderProjectChooser,
  saveCurrentProjectToPlaylist,
  savePlaylistToDisk,
  saveProjectToDisk,
  showProjectRenameContext,
  stepProjectChooser,
  toggleProjectMorphSettingsPanel,
  toggleProjectNameDropdown,
} from '../project/playlist.js';
import {
  applyLoadedProject,
  applySettingsFile,
  applyShapeFile,
  clearDefaultSettings,
  openProject,
  openShapeFile,
  saveCurrentShape,
  saveDefaultSettingsFile,
  saveShapeFile,
} from '../project/project-loader.js';
import {
  renameDraftProject,
  renamePlaylistProjectByIndex,
  renderLibrary,
  resetCurrentProjectToStartupDefaults,
  saveCurrentProjectFile,
} from './library.js';
import { showShortcutToast } from './header-and-export.js';

document
  .getElementById('btnQuickNewProject')
  ?.addEventListener('click', () => document.getElementById('btnNewProject')?.click());
document.getElementById('btnNewProject')?.addEventListener('click', () => {
  if (
    !confirm(
      'Создать новый проект с настройками по умолчанию? Несохранённые изменения текущего проекта будут потеряны.',
    )
  )
    return;
  stopProjectMorphing(false);
  const keepProjects = state.playlistProjects;
  const keepPlaylistHandle = state.playlistFileHandle;
  const keepPlaylistName = state.playlistFileName;
  const keepPlaylistMenuSettings = cloneData(state.playlistMenuSettings || captureMenuSettings());
  const keepPlaylistBpm = Math.max(0, Number(state.playlistBpm ?? state.tapTempo?.bpm) || 0);
  const keepPlaylistTapTempo = cloneData(
    state.playlistTapTempo || {
      autoTap: state.tapTempo?.autoTap === true,
      autoWindowSec: state.tapTempo?.autoWindowSec || 10,
      autoBand: state.tapTempo?.autoBand || 'low',
    },
  );
  const keepPlaylistDefaultSettings =
    state.playlistDefaultSettings && typeof state.playlistDefaultSettings === 'object'
      ? cloneData(state.playlistDefaultSettings)
      : null;
  const keepPlaylistColorPalettes = cloneData(ensurePlaylistColorPalettes());
  const keepPlaylistPaletteHueOffset = normalizePlaylistHueOffset(state.playlistPaletteHueOffset);
  document.getElementById('btnNew')?.click();
  state.playlistProjects = keepProjects;
  state.playlistFileHandle = keepPlaylistHandle;
  state.playlistFileName = keepPlaylistName;
  state.playlistMenuSettings = keepPlaylistMenuSettings;
  state.playlistBpm = keepPlaylistBpm;
  state.playlistTapTempo = keepPlaylistTapTempo;
  state.playlistDefaultSettings = keepPlaylistDefaultSettings;
  state.playlistColorPalettes = normalizePlaylistColorPalettes(keepPlaylistColorPalettes);
  state.playlistPaletteHueOffset = keepPlaylistPaletteHueOffset;
  renderPlaylistPaletteButtons();
  state.playlistOverridesActive = true;
  state.playlistCurrentProjectId = null;
  applyPlaylistOverrides();
  if (state.playlistDefaultSettings)
    applySettingsFile({ format: 'SpiroStarSettings', settings: cloneData(state.playlistDefaultSettings) });
  state.projectFileHandle = null;
  state.projectFileName = '';
  state.draftProjectName = 'Проект один';
  renderProjectChooser();
  renderLibrary('projects');
  showShortcutToast('Новый проект: Проект один');
});
document.getElementById('btnOpenProject')?.addEventListener('click', openProject);
document.getElementById('btnSaveCurrentProjectFile')?.addEventListener('click', saveCurrentProjectFile);
document.getElementById('btnResetProject')?.addEventListener('click', resetCurrentProjectToStartupDefaults);
document.getElementById('btnSaveAsJSON').addEventListener('click', () => saveProjectToDisk(true));
document.getElementById('btnOpenPlaylist')?.addEventListener('click', openPlaylist);
document.getElementById('btnSavePlaylist')?.addEventListener('click', () => savePlaylistToDisk(false));
document.getElementById('btnExportPlaylistProjects')?.addEventListener('click', exportPlaylistProjects);
document
  .getElementById('btnImportPlaylistProjects')
  ?.addEventListener('click', () => document.getElementById('fileInputProjectImport')?.click());
document.getElementById('btnOpenDefaultPlaylist')?.addEventListener('click', openDefaultPlaylist);
document
  .getElementById('btnSavePlaylistProject')
  ?.addEventListener('click', () => saveCurrentProjectToPlaylist(false, true));
document.getElementById('btnSavePlaylistProjectAsNew')?.addEventListener('click', handlePlaylistPlusSave);
document.getElementById('btnDeletePlaylistProject')?.addEventListener('click', deleteCurrentPlaylistProject);
document.getElementById('projectNameButton')?.addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation();
  toggleProjectNameDropdown();
});
document.getElementById('projectNameButton')?.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  e.stopPropagation();
  const idx = getCurrentPlaylistProjectIndex();
  hideProjectNameMenus();
  showProjectRenameContext(e.clientX, e.clientY, idx);
});
document.getElementById('btnContextRenameProject')?.addEventListener('click', () => {
  const idx = projectContextIndex;
  hideProjectNameMenus();
  if (idx >= 0) renamePlaylistProjectByIndex(idx);
  else renameDraftProject();
});
document.addEventListener('click', (e) => {
  if (e.target.closest?.('#projectNameDropdown,#projectNameButton,#projectNameContextMenu')) return;
  hideProjectNameMenus();
});
document.addEventListener('contextmenu', (e) => {
  if (e.target.closest?.('#projectNameDropdown,#projectNameButton,#projectNameContextMenu')) return;
  hideProjectNameMenus();
});
document.getElementById('projectSelect')?.addEventListener('change', (e) => {
  if (e.target.value !== '') loadPlaylistProjectByIndex(Number(e.target.value));
});
document.getElementById('btnPrevProject')?.addEventListener('click', () => stepProjectChooser(-1));
document.getElementById('btnNextProject')?.addEventListener('click', () => stepProjectChooser(1));
document.getElementById('btnProjectMorph')?.addEventListener('click', () => {
  normalizeProjectMorphSettings();
  if (runtimeState.projectMorph.active) stopProjectMorphing(true, true);
  else startProjectMorphing();
});
document.getElementById('btnProjectMorphSettings')?.addEventListener('click', (e) => {
  e.stopPropagation();
  toggleProjectMorphSettingsPanel();
});
document
  .getElementById('btnCloseProjectMorphSettings')
  ?.addEventListener('click', () => toggleProjectMorphSettingsPanel(false));
const rephaseGreenPeriod = () => {
  const pmRt = runtimeState.projectMorph;
  if (!pmRt.active) return;
  const now = performance.now(),
    progress = Math.max(0, Math.min(1, (now - pmRt.startAt) / Math.max(10, pmRt.durationMs)));
  pmRt.durationMs = getProjectMorphDurationSec() * 1000;
  pmRt.startAt = now - progress * pmRt.durationMs;
};
document.getElementById('projectMorphIntervalSec')?.addEventListener('input', (e) => {
  const pm = normalizeProjectMorphSettings();
  pm.intervalSec = Math.max(0.01, Number(e.target.value) || 0.01);
  if (!pm.syncTap) rephaseGreenPeriod();
  syncProjectMorphUI();
});
document.getElementById('projectMorphIntervalSec')?.addEventListener('change', (e) => {
  const pm = normalizeProjectMorphSettings();
  pm.intervalSec = Math.max(0.01, Number(e.target.value) || 0.01);
  e.target.value = formatDisplayNumber(pm.intervalSec, 2);
  if (!pm.syncTap) rephaseGreenPeriod();
  syncProjectMorphUI();
});
document.getElementById('projectMorphSyncTap')?.addEventListener('change', (e) => {
  const pm = normalizeProjectMorphSettings();
  pm.syncTap = e.target.checked === true;
  rephaseGreenPeriod();
  syncProjectMorphUI();
});
document.getElementById('projectMorphBeats')?.addEventListener('input', (e) => {
  const pm = normalizeProjectMorphSettings();
  pm.beatsPerProject = Math.max(1, Math.min(256, Math.round(Number(e.target.value) || 1)));
  e.target.value = String(pm.beatsPerProject);
  if (pm.syncTap && state.tapTempo?.bpm > 0) rephaseGreenPeriod();
  syncProjectMorphUI();
});
document.getElementById('projectMorphTransitionBeats')?.addEventListener('input', (e) => {
  const pm = normalizeProjectMorphSettings();
  pm.transitionBeats = Math.max(0, Math.min(256, Math.round(Number(e.target.value) || 0)));
  e.target.value = String(pm.transitionBeats);
  syncProjectMorphUI();
});
document.getElementById('projectMorphTransitionSec')?.addEventListener('input', (e) => {
  const pm = normalizeProjectMorphSettings();
  pm.transitionSec = Math.max(0, Number(e.target.value) || 0);
  syncProjectMorphUI();
});
document.getElementById('projectMorphTransitionSec')?.addEventListener('change', (e) => {
  const pm = normalizeProjectMorphSettings();
  pm.transitionSec = Math.max(0, Number(e.target.value) || 0);
  e.target.value = formatDisplayNumber(pm.transitionSec, 2);
  syncProjectMorphUI();
});
const restartGreenModeFromVisibleFrame = () => {
  const pm = normalizeProjectMorphSettings(),
    pmRt = runtimeState.projectMorph;
  if (!pmRt.active) return;
  pmRt.gpuPhasePrepareSerial = (Math.max(0, Number(pmRt.gpuPhasePrepareSerial) || 0) + 1) >>> 0;
  pmRt.gpuPhasePreparing = false;
  pmRt.gpuPhasePreparePromise = null;

  pmRt.transitionActive = false;
  pmRt.sourceCaptured = false;
  pmRt.renderMode =
    pm.transitionType === 'fade' || (pm.transitionType === 'linear' && !pm.advancedLinear)
      ? 'crossfade'
      : 'morph';
  pmRt.startAt = performance.now();
  pmRt.durationMs = Math.max(10, getProjectMorphDurationSec() * 1000);
  pmRt.progress = 0;
  pmRt.renderProgress = 0;
  pmRt.parameterProgress = 0;
  pmRt.transitionProgress = 0;
  pmRt.fadeProgress = 0;
  pmRt.crossfadeConfigSide = null;
  pmRt.geometryPlans = [];
  pmRt.frameGeometry = [];
  pmRt.frameExtents = [];
  pmRt.frameGeometryLayerProgress = [];
  pmRt.sourceGeometry = [];
  pmRt.targetGeometry = [];
  pmRt.sourceRenderLayers = [];
  pmRt.targetRenderLayers = [];
  pmRt.frameRenderLayers = [];
  pmRt.lampPlans = [];
  pmRt.frameLampPoints = [];
  const transitionStartsImmediately =
    pm.transitionType === 'linear' || getProjectMorphTransitionSec() >= getProjectMorphDurationSec() - 0.001;
  if (getProjectMorphTransitionSec() > 0 && transitionStartsImmediately)
    activateProjectMorphTransition(pmRt.startAt);
};
document.getElementById('projectMorphTransitionType')?.addEventListener('change', (e) => {
  const pm = normalizeProjectMorphSettings();
  pm.transitionType = ['fade', 'linear', 'smooth'].includes(e.target.value) ? e.target.value : 'smooth';
  restartGreenModeFromVisibleFrame();
  syncProjectMorphUI();
  requestMainCanvasRender();
});
document.getElementById('projectMorphAdvancedLinear')?.addEventListener('change', (e) => {
  const pm = normalizeProjectMorphSettings();
  pm.advancedLinear = e.target.checked === true;
  restartGreenModeFromVisibleFrame();
  syncProjectMorphUI();
  requestMainCanvasRender();
});
document.getElementById('projectMorphImageTransitionType')?.addEventListener('change', (e) => {
  const pm = normalizeProjectMorphSettings();
  pm.imageTransitionType = ['instant', 'fade', 'slide', 'center', 'sector'].includes(e.target.value)
    ? e.target.value
    : 'fade';
  syncProjectMorphUI();
  requestMainCanvasRender();
});
document.getElementById('projectMorphCenterSoftness')?.addEventListener('input', (e) => {
  const pm = normalizeProjectMorphSettings();
  pm.imageCenterSoftness = Math.max(0, Math.min(100, Number(e.target.value) || 0));
  syncProjectMorphUI();
});
document.getElementById('projectMorphSectorSoftness')?.addEventListener('input', (e) => {
  const pm = normalizeProjectMorphSettings();
  pm.imageSectorSoftness = Math.max(0, Math.min(100, Number(e.target.value) || 0));
  syncProjectMorphUI();
});
document.getElementById('projectMorphCameraWander')?.addEventListener('change', (e) => {
  const pm = normalizeProjectMorphSettings(),
    pmRt = runtimeState.projectMorph;
  pm.cameraWander = e.target.checked === true;
  if (!pm.cameraWander && pmRt.lockedCamera) {
    state.zoom = pmRt.lockedCamera.zoom;
    state.panX = pmRt.lockedCamera.panX;
    state.panY = pmRt.lockedCamera.panY;
    requestMainCanvasRender();
  }
  syncProjectMorphUI();
});
document.addEventListener('click', (e) => {
  const panel = document.getElementById('projectMorphSettingsPanel');
  if (!panel || panel.classList.contains('hidden')) return;
  if (panel.contains(e.target) || e.target.closest?.('#btnProjectMorphSettings')) return;
  toggleProjectMorphSettingsPanel(false);
});
document.getElementById('btnOpenShapeFile')?.addEventListener('click', openShapeFile);
document.getElementById('btnSaveShapeFile')?.addEventListener('click', saveShapeFile);
document.getElementById('btnSaveDefaultSettings')?.addEventListener('click', saveDefaultSettingsFile);
document.getElementById('btnClearDefaultSettings')?.addEventListener('click', clearDefaultSettings);
document.getElementById('fileInputPlaylist')?.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    await loadPlaylistDocument(parsed, file.name || '', null);
  } catch (err) {
    console.error('Playlist load failed', err);
    alert('Не удалось открыть плейлист: ' + (err?.message || 'ошибка чтения'));
  } finally {
    e.target.value = '';
  }
});
document.getElementById('fileInputProjectImport')?.addEventListener('change', async (e) => {
  try {
    await importProjectsIntoPlaylist(e.target.files);
  } finally {
    e.target.value = '';
  }
});
document.getElementById('fileInputJSON').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  file.text().then((text) => {
    try {
      quiesceProjectRuntimeForCommit();
      state.playlistOverridesActive = false;
      state.playlistCurrentProjectId = null;
      applyLoadedProject(JSON.parse(text));
      state.projectFileHandle = null;
      state.projectFileName = file.name || '';
      state.draftProjectName = sanitizeProjectFileBase(file.name || 'Проект один', 'Проект один');
      state.playlistCurrentProjectId = null;
      state.layerIsolation = null;
      if (!state.layers.some((layer) => layer?.id === state.activeLayerId))
        state.activeLayerId = state.layers[0]?.id || null;
      updateLayerListUI();
      syncSidebarInputs();
      syncMorphSettingsUI();
      syncRandomSettingsUI();
      renderProjectChooser();
      renderProfileEditor();
      renderMainCanvas();
    } catch (err) {
      console.error('Somata project load failed:', err);
      alert('Не удалось загрузить проект Somata: ' + (err?.message || 'ошибка чтения файла'));
    } finally {
      e.target.value = '';
    }
  });
});
document.getElementById('fileInputShape')?.addEventListener('change', (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  file.text().then((text) => {
    try {
      applyShapeFile(JSON.parse(text));
    } catch (_) {
      alert('Некорректный файл фигур Somata.');
    } finally {
      e.target.value = '';
    }
  });
});
document.getElementById('btnSaveShape').addEventListener('click', saveCurrentShape);
const FACTORY_MORPH_SETTINGS = {
  intervalSec: 5,
  intervalMultiplier: 1,
  splinePoints: 12,
  profileModeTransition: 'phase',
  profileModeTransitionPercent: 20,
  defaultActive: false,
  spiralOrderHoldPhases: 1,
  spiralOrderMin: -1,
  spiralOrderMax: 1,
  spiralOrderLinked: false,
  spiralLayersMin: 0,
  spiralLayersMax: 1,
  spiralTangentialChance: 50,
  chaosMorphEnabled: false,
  chaosMorphStepSpread: 1,
  chaosMorphClosuresMax: 3,
  preserveSpiralContinuity: true,
  spiralMorphType: 'coordinated',
  spiralRotationCompensation: false,
  pauseOnSpace: false,
  diversity: false,
  vertexMin: 4,
  vertexMax: 19,
  vertexMultiplier: 1,
  roundingMin: 0,
  roundingMax: 30,
  stepMin: 0,
  stepMax: 100,
  monoOrbitTransforms: true,
  orbitPercentMin: 0,
  orbitPercentMax: 0,
  strokeWidthMin: 0.5,
  strokeWidthMax: 2,
  opacityMin: 70,
  opacityMax: 100,
  fillLayersMin: 0,
  fillLayersMax: 1,
  fillHueMin: -15,
  fillHueMax: 15,
  fillHueReset: true,
  fillHueHarmony: 'native',
  lineColorPalette: 'standard',
  cyclePalettes: false,
  fixedColors: false,
  syncPalettesBetweenMorphs: true,
  morphGlobalHueOffset: false,
  globalHueOffsetRange: 180,
  sizeVariation: 100,
  sizeVariationMultiplier: 1,
  radiusMin: 20,
  radiusMax: 500,
  normalizeSizes: true,
  rotationMinPercent: 0,
  rotationMaxPercent: 50,
  rotationMultiplier: 1,
  rotationRandomDirection: true,
  fillOpacityMin: 10,
  fillOpacityMax: 10,
  mode: 'coordinated',
  unifiedMode: 'coordinated',
  spiralMode: 'coordinated',
  fadePercent: 0,
  circleProfileOverflow: true,
  slideType: 'minimal',
  speedType: 'linear',
  lightningWhite: true,
  lightningRandom: false,
  lightningColor: '#ffffff',
  lightningSegmentPercent: 30,
  lightningGlow: 18,
  options: {
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
  },
  shapeOptions: {
    noLoops: true,
    loops: false,
    closed: false,
    open: false,
    family: 'mix',
    profileGroups: ['standard'],
    profileGroup: 'standard',
    standardOnly: true,
  },
};
function resetMorphSettingsToFactory() {
  delete state.morph.orbitCountMin;
  delete state.morph.orbitCountMax;
  for (const [key, value] of Object.entries(FACTORY_MORPH_SETTINGS)) state.morph[key] = cloneData(value);
  window.SomataTestMorph?.syncFromBlue?.(getUnifiedMorphMode(), state.morph.slideType, getSpiralMorphMode());
  syncMorphSettingsUI();
  syncSidebarInputs();
  if (runtimeState.morph.active) activeRebaseMorphing();
  requestMainCanvasRender();
}
document.getElementById('btnResetMorphDefaults')?.addEventListener('click', (e) => {
  e.stopPropagation();
  resetMorphSettingsToFactory();
});
