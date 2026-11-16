// Контролы: редактор профиля и коллекция слоёв.
import './layer-geometry-style.js'; // initialisation order: this module runs after it
import {
  DEFAULT_PROFILE_CONFIG,
  PROFILE_CONFIG,
  normalizeSplinePointCount,
  normalizeSplineRenderMode,
} from '../../geometry/profile-model.js';
import { renderProfileEditor } from '../profile-editor.js';
import { ensureAudioRoutingState, initializeNewLayerAudioRouting } from '../../audio/audio-routing.js';
import { createLayerId, createUserAddedLayer } from '../../core/defaults-layers.js';
import { invalidateLayerGeometry, setPreSampledSplineLayer } from '../../core/render-runtime.js';
import { requestMainCanvasRender } from '../../core/scheduler.js';
import { runtimeState, state } from '../../core/state.js';
import { freehandRawPoints, ramerDouglasPeucker, setFreehandRawPoints } from '../../geometry/spline.js';
import { renderMainCanvas } from '../../render/main-pipeline.js';
import {
  PROFILE_PRESET_GROUPS,
  PROFILE_PRESET_NAV_KEYS,
  activeProfilePresetGroup,
  getExactProfilePresetKey,
  renderProfilePresetLibrary,
  setActiveProfilePresetGroup,
} from '../profile-presets.js';
import { updateLayerListUI } from '../layer-selection.js';
import { syncSidebarInputs } from '../sidebar-sync.js';
import { applyProfilePresetByKey } from '../master-layer.js';
import { activeRebaseMorphing } from '../../morph-runtime/morph-hooks.js';
import { syncMorphShapeToggleButtons, syncMorphSplinePointButtons } from '../morph-settings-panel.js';
import { applyHeaderVisibility } from '../header-and-export.js';

function bindProfileEditorControls(bindingContext) {
  const getActiveLayer = bindingContext.getActiveLayer;
  const freehandPanel = document.getElementById('freehandInterpolationPanel');
  const syncFreehandPanel = () => {
    freehandPanel?.classList.toggle('visible', getActiveLayer()?.profileMode === 'freehand_raw');
  };
  document.querySelectorAll('[data-freehand-quality]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const layer = getActiveLayer();
      if (!layer || freehandRawPoints.length < 2) return;
      const epsilons = { dense: 0.006, medium: 0.02, minimal: 0.055 };
      const epsilon = epsilons[btn.dataset.freehandQuality] || 0.02;
      const source = freehandRawPoints.length > 1 ? freehandRawPoints : layer.profileNodes;
      const reduced = ramerDouglasPeucker(source, epsilon);
      layer.profileNodes = reduced.map((p) => ({ ...p }));
      layer.profileMode = 'spline';
      layer.splineRenderMode = 'smooth';
      setPreSampledSplineLayer(layer, false);
      invalidateLayerGeometry(layer, 'freehand-quality');
      setFreehandRawPoints(layer.profileNodes.map((p) => ({ ...p })));
      syncSidebarInputs();
      renderProfileEditor();
      renderMainCanvas();
      syncFreehandPanel();
    });
  });

  document.querySelectorAll('.profile-mode-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const layer = getActiveLayer();
      if (layer) {
        const nextMode = btn.dataset.mode;
        if (layer.profileMode === nextMode) return;
        layer.profileMode = nextMode;
        if (nextMode === 'spline') layer.splineRenderMode = 'smooth';
        setPreSampledSplineLayer(layer, false);
        invalidateLayerGeometry(layer, 'profile-mode');
        if (layer.profileMode === 'freehand_raw' && layer.profileNodes?.length) {
          setFreehandRawPoints(layer.profileNodes.map((p) => ({ ...p })));
        }
        syncSidebarInputs();
        renderProfileEditor();
        renderMainCanvas();
        syncFreehandPanel();
      }
    });
  });

  document.getElementById('paramWholeCurveSpline')?.addEventListener('change', (event) => {
    const layer = getActiveLayer();
    if (!layer) return;
    layer.wholeCurveSpline = event.target.checked === true;
    invalidateLayerGeometry(layer, 'whole-curve-spline');
    syncSidebarInputs();
    if (runtimeState.morph.active) activeRebaseMorphing();
    requestMainCanvasRender();
  });

  document.querySelectorAll('[data-spline-render-mode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const layer = getActiveLayer();
      if (!layer) return;
      const requested = normalizeSplineRenderMode(btn.dataset.splineRenderMode);
      const next = layer.profileMode === 'spline' ? 'smooth' : requested;
      if (normalizeSplineRenderMode(layer.splineRenderMode) === next) return;
      layer.splineRenderMode = next;
      invalidateLayerGeometry(layer, 'legacy-geometry-control');
      syncSidebarInputs();
      renderProfileEditor();
      requestMainCanvasRender();
    });
  });

  document.querySelectorAll('[data-profile-mode-transition]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const raw = btn.dataset.profileModeTransition;
      const next = ['phase', 'start', 'end'].includes(raw) ? raw : 'phase';
      if (state.morph.profileModeTransition === next) return;
      state.morph.profileModeTransition = next;
      syncSidebarInputs();
      if (runtimeState.morph.active) activeRebaseMorphing();
      requestMainCanvasRender();
    });
  });
  const setProfileModeTransitionPercent = (raw) => {
    state.morph.profileModeTransitionPercent = Math.max(0, Math.min(100, Math.round(Number(raw) || 0)));
    const txt = document.getElementById('profileModeTransitionPercentValue');
    if (txt) txt.textContent = `${state.morph.profileModeTransitionPercent}%`;
    if (runtimeState.morph.active) activeRebaseMorphing();
    requestMainCanvasRender();
  };
  document
    .getElementById('profileModeTransitionPercent')
    ?.addEventListener('input', (e) => setProfileModeTransitionPercent(e.target.value));
  document.getElementById('profileModeTransitionPercent')?.addEventListener('change', (e) => {
    setProfileModeTransitionPercent(e.target.value);
    syncSidebarInputs();
  });

  const applyProfileSplinePointCount = (rawValue) => {
    const next = normalizeSplinePointCount(rawValue);
    if (state.morph.splinePoints === next) {
      const el = document.getElementById('profileSplinePointCount');
      if (el) el.value = String(next);
      const me = document.getElementById('morphSplinePointCount');
      if (me) me.value = String(next);
      return;
    }
    state.morph.splinePoints = next;
    syncMorphSplinePointButtons();
    const input = document.getElementById('profileSplinePointCount');
    if (input) input.value = String(next);
    state.layers.forEach((layer) => {
      invalidateLayerGeometry(layer, 'legacy-geometry-control');
    });
    if (runtimeState.morph.active) activeRebaseMorphing();
    renderProfileEditor();
    requestMainCanvasRender();
  };
  document.getElementById('profileSplinePointCount')?.addEventListener('input', (e) => {
    const n = Number(e.target.value);
    if (Number.isFinite(n) && n >= 4 && n <= 256) applyProfileSplinePointCount(n);
  });
  document
    .getElementById('profileSplinePointCount')
    ?.addEventListener('change', (e) => applyProfileSplinePointCount(e.target.value));

  renderProfilePresetLibrary();
  const browseProfileGroup = (btn, e = null) => {
    if (e?.target instanceof HTMLInputElement && e.target.matches('[data-morph-profile-group]')) return;
    setActiveProfilePresetGroup(btn.dataset.profileGroup || 'standard');
    const currentKey = getExactProfilePresetKey(getActiveLayer());
    const currentBelongsHere = (PROFILE_PRESET_GROUPS[activeProfilePresetGroup] || []).includes(currentKey);
    renderProfilePresetLibrary(currentBelongsHere ? currentKey : '');
    syncMorphShapeToggleButtons();
  };
  document.querySelectorAll('.profile-library-tab').forEach((btn) => {
    btn.addEventListener('click', (e) => browseProfileGroup(btn, e));
    btn.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault();
        browseProfileGroup(btn, e);
      }
    });
  });

  document.getElementById('profilePresetSelect').addEventListener('change', (e) => {
    if (e.target.value) applyProfilePresetByKey(e.target.value);
  });

  document.getElementById('btnPrevProfilePreset').addEventListener('click', () => {
    const layer = getActiveLayer();
    if (!layer || !PROFILE_PRESET_NAV_KEYS.length) return;
    const selectEl = document.getElementById('profilePresetSelect');
    const exactKey = getExactProfilePresetKey(layer);
    const currentKey = PROFILE_PRESET_NAV_KEYS.includes(selectEl?.value) ? selectEl.value : exactKey;
    let currentIdx = PROFILE_PRESET_NAV_KEYS.indexOf(currentKey);
    if (currentIdx < 0) {
      const groupKeys = PROFILE_PRESET_GROUPS[activeProfilePresetGroup] || PROFILE_PRESET_GROUPS.standard;
      currentIdx = Math.max(0, PROFILE_PRESET_NAV_KEYS.indexOf(groupKeys[0] || PROFILE_PRESET_NAV_KEYS[0]));
    }
    const key =
      PROFILE_PRESET_NAV_KEYS[
        (currentIdx - 1 + PROFILE_PRESET_NAV_KEYS.length) % PROFILE_PRESET_NAV_KEYS.length
      ];
    applyProfilePresetByKey(key);
  });

  document.getElementById('btnNextProfilePreset').addEventListener('click', () => {
    const layer = getActiveLayer();
    if (!layer || !PROFILE_PRESET_NAV_KEYS.length) return;
    const selectEl = document.getElementById('profilePresetSelect');
    const exactKey = getExactProfilePresetKey(layer);
    const currentKey = PROFILE_PRESET_NAV_KEYS.includes(selectEl?.value) ? selectEl.value : exactKey;
    let currentIdx = PROFILE_PRESET_NAV_KEYS.indexOf(currentKey);
    if (currentIdx < 0) {
      const groupKeys = PROFILE_PRESET_GROUPS[activeProfilePresetGroup] || PROFILE_PRESET_GROUPS.standard;
      const firstKey = groupKeys[0] || PROFILE_PRESET_NAV_KEYS[0];
      currentIdx = PROFILE_PRESET_NAV_KEYS.indexOf(firstKey) - 1;
    }
    const key =
      PROFILE_PRESET_NAV_KEYS[
        (currentIdx + 1 + PROFILE_PRESET_NAV_KEYS.length) % PROFILE_PRESET_NAV_KEYS.length
      ];
    applyProfilePresetByKey(key);
  });

  document.getElementById('btnResetProfile').addEventListener('click', () => {
    const layer = getActiveLayer();
    if (layer) {
      layer.profileMode = 'segments';
      layer.profileNodes = [
        { x: 0.0, y: 0.0 },
        { x: 1.0, y: 0.0 },
      ];
      setFreehandRawPoints(layer.profileNodes.map((p) => ({ ...p })));
      setPreSampledSplineLayer(layer, false);
      invalidateLayerGeometry(layer, 'profile-reset');
      syncSidebarInputs();
      renderProfileEditor();
      requestMainCanvasRender();
    }
  });

  document.getElementById('btnProfileZoomIn').addEventListener('click', () => {
    const cx = (PROFILE_CONFIG.xMin + PROFILE_CONFIG.xMax) / 2;
    const cy = (PROFILE_CONFIG.yMin + PROFILE_CONFIG.yMax) / 2;
    const rx = ((PROFILE_CONFIG.xMax - PROFILE_CONFIG.xMin) * 0.8) / 2;
    const ry = ((PROFILE_CONFIG.yMax - PROFILE_CONFIG.yMin) * 0.8) / 2;

    PROFILE_CONFIG.xMin = cx - rx;
    PROFILE_CONFIG.xMax = cx + rx;
    PROFILE_CONFIG.yMin = cy - ry;
    PROFILE_CONFIG.yMax = cy + ry;
    renderProfileEditor();
  });

  document.getElementById('btnProfileZoomOut').addEventListener('click', () => {
    const cx = (PROFILE_CONFIG.xMin + PROFILE_CONFIG.xMax) / 2;
    const cy = (PROFILE_CONFIG.yMin + PROFILE_CONFIG.yMax) / 2;
    const rx = ((PROFILE_CONFIG.xMax - PROFILE_CONFIG.xMin) * 1.25) / 2;
    const ry = ((PROFILE_CONFIG.yMax - PROFILE_CONFIG.yMin) * 1.25) / 2;

    PROFILE_CONFIG.xMin = cx - rx;
    PROFILE_CONFIG.xMax = cx + rx;
    PROFILE_CONFIG.yMin = cy - ry;
    PROFILE_CONFIG.yMax = cy + ry;
    renderProfileEditor();
  });

  document.getElementById('btnProfileResetView').addEventListener('click', () => {
    PROFILE_CONFIG.xMin = DEFAULT_PROFILE_CONFIG.xMin;
    PROFILE_CONFIG.xMax = DEFAULT_PROFILE_CONFIG.xMax;
    PROFILE_CONFIG.yMin = DEFAULT_PROFILE_CONFIG.yMin;
    PROFILE_CONFIG.yMax = DEFAULT_PROFILE_CONFIG.yMax;
    renderProfileEditor();
  });
}
function bindLayerCollectionControls(bindingContext) {
  const getActiveLayer = bindingContext.getActiveLayer;
  document.getElementById('btnAddLayer').addEventListener('click', () => {
    const newL = createUserAddedLayer(`Слой ${state.layers.length + 1}`);
    state.layers.push(newL);
    state.activeLayerId = newL.id;
    initializeNewLayerAudioRouting(newL);

    if (runtimeState.morph.active) activeRebaseMorphing();
    updateLayerListUI();
    syncSidebarInputs();
    applyHeaderVisibility?.();
    renderProfileEditor();
    renderMainCanvas();
  });

  document.getElementById('btnDuplicateLayer').addEventListener('click', () => {
    const curr = getActiveLayer();
    if (curr) {
      const dup = JSON.parse(JSON.stringify(curr));
      dup.id = createLayerId();
      dup.name += ' (Копия)';
      ensureAudioRoutingState(); // make source connections available before copying
      state.layers.push(dup);
      initializeNewLayerAudioRouting(dup, curr);
      state.activeLayerId = dup.id;
      updateLayerListUI();
      syncSidebarInputs();
      renderProfileEditor();
      renderMainCanvas();
    }
  });

  document.getElementById('btnDeleteLayer').addEventListener('click', () => {
    if (state.layers.length <= 1) return;
    const removedIndex = state.layers.findIndex((l) => l.id === state.activeLayerId);
    if (removedIndex < 0) return;
    state.layers.splice(removedIndex, 1);
    const nextActiveIndex = Math.max(0, removedIndex - 1);
    state.activeLayerId = state.layers[nextActiveIndex].id;
    updateLayerListUI();
    syncSidebarInputs();
    renderProfileEditor();
    renderMainCanvas();
  });
}

export { bindLayerCollectionControls, bindProfileEditorControls };
