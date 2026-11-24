// Blue Morph: интерфейс.
import './playback.js'; // initialisation order: this module runs after it
import { normalizeSplinePointCount } from '../../geometry/profile-model.js';
import { renderProfileEditor } from '../../ui/profile-editor.js';
import { normalizeSpiralOrder } from '../../geometry/spiral/order-params.js';
import { invalidateLayerGeometry } from '../../core/render-runtime.js';
import { requestMainCanvasRender } from '../../core/scheduler.js';
import { runtimeState, state } from '../../core/state.js';
import { renderMainCanvas } from '../../render/main-pipeline.js';
import { MORPH_PROFILE_GROUP_KEYS } from '../../ui/profile-presets.js';
import {
  formatDisplayNumber,
  linkMorphMultiplierToN,
  normalizeMorphVertexRangeValues,
} from '../../ui/geometry-n-control.js';
import { getSpiralMorphMode, getUnifiedMorphMode, normalizeSpiralMorphType } from '../morph-mode.js';
import { syncSidebarInputs } from '../../ui/sidebar-sync.js';
import { syncBlueMorphParameterDecorations } from '../../ui/blue-morph/parameter-bindings.js';
import { syncMorphProfileDirtyUI } from '../../ui/blue-morph/profiles.js';
import { getMorphIntervalMultiplier, syncTapTimingIndicators } from '../../audio/tap-tempo.js';
import { rememberMorphFillLayerRange } from '../../ui/playlist-palettes.js';
import {
  normalizedMorphProfileGroups,
  syncMorphIntervalQuickButtons,
  syncMorphSettingsUI,
  syncMorphShapeToggleButtons,
  syncMorphSplinePointButtons,
  updateMorphShapeControlsEnabled,
} from '../../ui/morph-settings-panel.js';
import { capturePlaylistOverridesFromCurrent } from '../../project/project-data.js';

function createMorphUIModule(deps) {
  const { MorphTargets, MorphPlayback } = deps;
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
    randomIntExcept,
    sameProfileVariant,
    chooseMorphVertexTarget,
    getActiveOrbitCount,
    chooseMorphOrbitTarget,
    getMorphSizeVariationFactor,
    chooseMorphSpiralLayerSet,
    chooseMorphSpiralOrderTarget,
    chooseMorphRotationDelta,
    buildMorphVisualTargets,
    buildLightMorphVisualTargets,
  } = MorphTargets;
  const {
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
  } = MorphPlayback;
  document.getElementById('morphIntervalMultiplier')?.addEventListener('input', (e) => {
    const v = Number(e.target.value);
    state.morph.intervalMultiplier = Number.isFinite(v) ? Math.max(0.015625, Math.min(64, v)) : 1;
    state.tapTempo.syncFullMorph = state.tapTempo.syncFullMorph === true;
    if (runtimeState.morph.active) rebaseMorphCycle();
    syncTapTimingIndicators();
    syncMorphIntervalQuickButtons();
  });
  document.getElementById('morphIntervalMultiplier')?.addEventListener('change', (e) => {
    e.target.value = formatDisplayNumber(getMorphIntervalMultiplier('full'), 6);
  });

  document.getElementById('morphInterval').addEventListener('input', (e) => {
    state.tapTempo.syncFullMorph = false;
    state.morph.intervalSec = Math.max(0.5, Math.min(60, parseFloat(e.target.value) || 5));
    e.target.value = state.morph.intervalSec;
    syncMorphIntervalQuickButtons();
    syncTapTimingIndicators();
    rebaseMorphCycle();
  });
  document.querySelectorAll('[data-morph-interval]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const value = Math.max(0.5, Math.min(60, Number(btn.dataset.morphInterval) || 5));
      state.tapTempo.syncFullMorph = false;
      state.morph.intervalSec = value;
      document.getElementById('morphInterval').value = value;
      syncMorphIntervalQuickButtons();
      syncTapTimingIndicators();
      rebaseMorphCycle();
    });
  });
  document.getElementById('morphDefaultActive')?.addEventListener('change', (e) => {
    state.morph.defaultActive = e.target.checked === true;
    if (!state.morph.defaultActive) runtimeState.morph.autoStartedByProject = false;
    syncMorphSettingsUI();
  });
  document.getElementById('morphDiversity')?.addEventListener('change', (e) => {
    state.morph.diversity = e.target.checked;
    window.SomataMorphParameterRouting?.captureActiveDraft?.(state.morph, state.minimalMorph);
    syncMorphProfileDirtyUI?.();
    rebaseMorphCycle();
  });

  const applyAllLayersStrokeWidth = (rawValue) => {
    const value = Math.max(0.5, Math.min(20, parseFloat(rawValue) || 0.5));
    const rounded = Math.round(value * 10) / 10;
    state.layers.forEach((layer) => {
      layer.strokeWidth = rounded;
    });
    const slider = document.getElementById('morphAllStrokeWidth');
    const input = document.getElementById('morphAllStrokeWidthValue');
    if (slider) slider.value = rounded;
    if (input) input.value = rounded;
    const activeLayer = state.layers.find((layer) => layer.id === state.activeLayerId);
    if (activeLayer) {
      const sidebarRange = document.getElementById('paramStrokeWidth');
      const sidebarValue = document.getElementById('valStrokeWidth');
      if (sidebarRange) sidebarRange.value = rounded;
      if (sidebarValue) sidebarValue.textContent = formatDisplayNumber(rounded, 1) + 'px';
    }
    if (runtimeState.morph.active) rebaseMorphCycle();
    renderMainCanvas();
  };
  document
    .getElementById('morphAllStrokeWidth')
    ?.addEventListener('input', (e) => applyAllLayersStrokeWidth(e.target.value));
  document
    .getElementById('morphAllStrokeWidthValue')
    ?.addEventListener('input', (e) => applyAllLayersStrokeWidth(e.target.value));

  const syncMorphVertexRange = (changedId) => {
    const range = normalizeMorphVertexRangeValues(
      document.getElementById('morphVertexMin')?.value,
      document.getElementById('morphVertexMax')?.value,
      document.getElementById('morphVertexMultiplier')?.value,
      changedId,
    );
    state.morph.vertexMultiplier = range.multiplier;
    state.morph.vertexMin = range.minN;
    state.morph.vertexMax = range.maxN;
    const minEl = document.getElementById('morphVertexMin'),
      maxEl = document.getElementById('morphVertexMax'),
      mulEl = document.getElementById('morphVertexMultiplier');
    if (minEl) minEl.value = range.minN;
    if (maxEl) maxEl.value = range.maxN;
    if (mulEl) mulEl.value = range.multiplier;
    if (changedId === 'morphVertexMultiplier') linkMorphMultiplierToN(range.multiplier);
    if (runtimeState.morph.active) rebaseMorphCycle();
  };
  document
    .getElementById('morphVertexMin')
    ?.addEventListener('change', () => syncMorphVertexRange('morphVertexMin'));
  document
    .getElementById('morphVertexMax')
    ?.addEventListener('change', () => syncMorphVertexRange('morphVertexMax'));
  document
    .getElementById('morphVertexMultiplier')
    ?.addEventListener('change', () => syncMorphVertexRange('morphVertexMultiplier'));

  const syncMorphSpiralLayerRange = (changedId) => {
    let lo = Math.max(
      0,
      Math.min(64, Math.round(Number(document.getElementById('morphSpiralLayersMin')?.value) || 0)),
    );
    let hi = Math.max(
      0,
      Math.min(64, Math.round(Number(document.getElementById('morphSpiralLayersMax')?.value) || 0)),
    );
    if (lo > hi) {
      if (changedId === 'morphSpiralLayersMin') hi = lo;
      else lo = hi;
    }
    state.morph.spiralLayersMin = lo;
    state.morph.spiralLayersMax = hi;
    const a = document.getElementById('morphSpiralLayersMin'),
      b = document.getElementById('morphSpiralLayersMax');
    if (a) a.value = lo;
    if (b) b.value = hi;
    if (runtimeState.morph.active && state.morph.options.bySpiralLayers) rebaseMorphCycle();
    requestMainCanvasRender();
  };
  document
    .getElementById('morphSpiralLayersMin')
    ?.addEventListener('change', () => syncMorphSpiralLayerRange('morphSpiralLayersMin'));
  document
    .getElementById('morphSpiralLayersMax')
    ?.addEventListener('change', () => syncMorphSpiralLayerRange('morphSpiralLayersMax'));
  const syncSpiralTangentialChance = () => {
    const el = document.getElementById('morphSpiralTangentialChance');
    const chance = Math.max(0, Math.min(100, Math.round(Number(el?.value) || 0)));
    state.morph.spiralTangentialChance = chance;
    if (el) el.value = String(chance);
    if (
      runtimeState.morph.active &&
      (state.morph.options.bySpiralLayers || state.morph.options.bySpiralOrder)
    )
      rebaseMorphCycle();
  };
  document
    .getElementById('morphSpiralTangentialChance')
    ?.addEventListener('change', syncSpiralTangentialChance);
  for (const id of ['morphSpiralOrderHoldPhases', 'paramSpiralOrderHoldPhases']) {
    document.getElementById(id)?.addEventListener('change', (e) => {
      const n = SomataSpiralZeroTransition.holdPhases(e.target.value);
      state.morph.spiralOrderHoldPhases = n;
      for (const other of ['morphSpiralOrderHoldPhases', 'paramSpiralOrderHoldPhases']) {
        const input = document.getElementById(other);
        if (input) input.value = n;
      }
      document.querySelectorAll('[data-spiral-order-hold-proxy]').forEach((input) => {
        input.value = n;
      });
    });
  }
  const syncMorphSpiralOrderRange = (changedId) => {
    let lo = normalizeSpiralOrder(document.getElementById('morphSpiralOrderMin')?.value, true),
      hi = normalizeSpiralOrder(document.getElementById('morphSpiralOrderMax')?.value, true);
    if (lo > hi) {
      if (changedId === 'morphSpiralOrderMin') hi = lo;
      else lo = hi;
    }
    state.morph.spiralOrderMin = lo;
    state.morph.spiralOrderMax = hi;
    const a = document.getElementById('morphSpiralOrderMin'),
      b = document.getElementById('morphSpiralOrderMax');
    if (a) a.value = lo;
    if (b) b.value = hi;
    if (
      runtimeState.morph.active &&
      (state.morph.options.bySpiralLayers || state.morph.options.bySpiralOrder)
    )
      rebaseMorphCycle();
  };
  document
    .getElementById('morphSpiralOrderMin')
    ?.addEventListener('change', () => syncMorphSpiralOrderRange('morphSpiralOrderMin'));
  document
    .getElementById('morphSpiralOrderMax')
    ?.addEventListener('change', () => syncMorphSpiralOrderRange('morphSpiralOrderMax'));
  document.getElementById('morphSpiralOrderLinked')?.addEventListener('change', (e) => {
    state.morph.spiralOrderLinked = e.target.checked === true;
    syncMorphSettingsUI();
    if (
      runtimeState.morph.active &&
      (state.morph.options.bySpiralLayers || state.morph.options.bySpiralOrder)
    )
      rebaseMorphCycle();
  });

  document.getElementById('morphSpiralMorphType')?.addEventListener('change', (e) => {
    state.morph.spiralMorphType = normalizeSpiralMorphType(e.target.value, true);
    state.morph.preserveSpiralContinuity = state.morph.spiralMorphType !== 'torn';
    if (runtimeState.morph.active) rebaseMorphCycle();
    requestMainCanvasRender();
  });
  document.getElementById('morphSpiralRotationCompensation')?.addEventListener('change', (e) => {
    state.morph.spiralRotationCompensation = e.target.checked !== false;
    requestMainCanvasRender();
  });
  document.getElementById('morphPauseOnSpace')?.addEventListener('change', (e) => {
    state.morph.pauseOnSpace = e.target.checked === true;
    capturePlaylistOverridesFromCurrent();
  });

  const syncMorphRoundingRange = (changedId) => {
    const minParsed = parseInt(document.getElementById('morphRoundingMin').value, 10);
    const maxParsed = parseInt(document.getElementById('morphRoundingMax').value, 10);
    let minR = Math.max(0, Math.min(100, Number.isFinite(minParsed) ? minParsed : 0));
    let maxR = Math.max(0, Math.min(100, Number.isFinite(maxParsed) ? maxParsed : 30));
    if (minR > maxR) {
      if (changedId === 'morphRoundingMin') maxR = minR;
      else minR = maxR;
    }
    state.morph.roundingMin = minR;
    state.morph.roundingMax = maxR;
    document.getElementById('morphRoundingMin').value = minR;
    document.getElementById('morphRoundingMax').value = maxR;
    rebaseMorphCycle();
  };
  document
    .getElementById('morphRoundingMin')
    .addEventListener('change', () => syncMorphRoundingRange('morphRoundingMin'));
  document
    .getElementById('morphRoundingMax')
    .addEventListener('change', () => syncMorphRoundingRange('morphRoundingMax'));

  const syncMorphStepRange = (changedId) => {
    let minS = Math.max(0, Math.min(100, parseInt(document.getElementById('morphStepMin').value, 10) || 0));
    let maxS = Math.max(0, Math.min(100, parseInt(document.getElementById('morphStepMax').value, 10) || 100));
    if (minS > maxS) {
      if (changedId === 'morphStepMin') maxS = minS;
      else minS = maxS;
    }
    state.morph.stepMin = minS;
    state.morph.stepMax = maxS;
    document.getElementById('morphStepMin').value = minS;
    document.getElementById('morphStepMax').value = maxS;
    rebaseMorphCycle();
  };
  document
    .getElementById('morphStepMin')
    .addEventListener('change', () => syncMorphStepRange('morphStepMin'));
  document
    .getElementById('morphStepMax')
    .addEventListener('change', () => syncMorphStepRange('morphStepMax'));

  const syncMorphStrokeWidthRange = (changedId) => {
    let minW = Math.max(
      0.5,
      Math.min(20, parseFloat(document.getElementById('morphStrokeWidthMin').value) || 0.5),
    );
    let maxW = Math.max(
      0.5,
      Math.min(20, parseFloat(document.getElementById('morphStrokeWidthMax').value) || 2),
    );
    if (minW > maxW) {
      if (changedId === 'morphStrokeWidthMin') maxW = minW;
      else minW = maxW;
    }
    minW = Math.round(minW * 10) / 10;
    maxW = Math.round(maxW * 10) / 10;
    state.morph.strokeWidthMin = minW;
    state.morph.strokeWidthMax = maxW;
    document.getElementById('morphStrokeWidthMin').value = minW;
    document.getElementById('morphStrokeWidthMax').value = maxW;
    rebaseMorphCycle();
  };
  document
    .getElementById('morphStrokeWidthMin')
    ?.addEventListener('change', () => syncMorphStrokeWidthRange('morphStrokeWidthMin'));
  document
    .getElementById('morphStrokeWidthMax')
    ?.addEventListener('change', () => syncMorphStrokeWidthRange('morphStrokeWidthMax'));

  const syncMorphOpacityRange = (changedId) => {
    let minO = Math.max(
      0,
      Math.min(100, parseInt(document.getElementById('morphOpacityMin')?.value, 10) || 0),
    );
    let maxO = Math.max(
      0,
      Math.min(100, parseInt(document.getElementById('morphOpacityMax')?.value, 10) || 100),
    );
    if (minO > maxO) {
      if (changedId === 'morphOpacityMin') maxO = minO;
      else minO = maxO;
    }
    state.morph.opacityMin = minO;
    state.morph.opacityMax = maxO;
    const minEl = document.getElementById('morphOpacityMin');
    const maxEl = document.getElementById('morphOpacityMax');
    if (minEl) minEl.value = minO;
    if (maxEl) maxEl.value = maxO;
    rebaseMorphCycle();
  };
  document
    .getElementById('morphOpacityMin')
    ?.addEventListener('change', () => syncMorphOpacityRange('morphOpacityMin'));
  document
    .getElementById('morphOpacityMax')
    ?.addEventListener('change', () => syncMorphOpacityRange('morphOpacityMax'));

  const syncMorphOrbitRange = (changedId = '') => {
    let minPct = Math.max(
      0,
      Math.min(100, Math.round(Number(document.getElementById('morphOrbitPercentMin')?.value) || 0)),
    );
    let maxPct = Math.max(
      0,
      Math.min(100, Math.round(Number(document.getElementById('morphOrbitPercentMax')?.value) || 0)),
    );
    if (minPct > maxPct) {
      if (changedId === 'morphOrbitPercentMin') maxPct = minPct;
      else minPct = maxPct;
    }
    state.morph.orbitPercentMin = minPct;
    state.morph.orbitPercentMax = maxPct;
    delete state.morph.orbitCountMin;
    delete state.morph.orbitCountMax;
    const minEl = document.getElementById('morphOrbitPercentMin');
    const maxEl = document.getElementById('morphOrbitPercentMax');
    if (minEl) minEl.value = String(minPct);
    if (maxEl) maxEl.value = String(maxPct);
    if (runtimeState.morph.active && state.morph.monoOrbitTransforms) rebaseMorphCycle();
  };
  document
    .getElementById('morphOrbitPercentMin')
    ?.addEventListener('change', () => syncMorphOrbitRange('morphOrbitPercentMin'));
  document
    .getElementById('morphOrbitPercentMax')
    ?.addEventListener('change', () => syncMorphOrbitRange('morphOrbitPercentMax'));
  document.getElementById('morphMonoOrbitTransforms')?.addEventListener('change', (e) => {
    if (runtimeState.morph.active && state.morph.mode === 'light') commitLightMorphTransient();
    state.morph.monoOrbitTransforms = e.target.checked === true;
    syncMorphSettingsUI();
    if (runtimeState.morph.active) {
      runtimeState.morph.suppressPaletteCycleOnce = true;
      prepareMorphCycle(performance.now());
    }
    requestMainCanvasRender();
  });

  const syncMorphFadePercent = (raw) => {
    const value = Math.round(Math.max(0, Math.min(100, Number(raw) || 0)));
    state.morph.fadePercent = value;
    const slider = document.getElementById('morphFadePercent');
    const number = document.getElementById('morphFadePercentValue');
    if (slider) slider.value = String(value);
    if (number) number.value = String(value);
    window.SomataTestMorph?.syncModeOptions();
    if (runtimeState.morph.active && state.morph.mode === 'fade') requestMainCanvasRender();
  };
  document
    .getElementById('morphFadePercent')
    ?.addEventListener('input', (e) => syncMorphFadePercent(e.target.value));
  document
    .getElementById('morphFadePercentValue')
    ?.addEventListener('input', (e) => syncMorphFadePercent(e.target.value));
  document
    .getElementById('morphFadePercentValue')
    ?.addEventListener('change', (e) => syncMorphFadePercent(e.target.value));

  // Stage 7: Blue and Geometry > Animation select the same slide type.
  // This updates only the two shared selectors, never local duration or
  // other per-layer animation settings. The source guard prevents loops.
  const setMorphSlideFromUI = (value, fromGeometry = false) => {
    const next = ['minimal', 'sector', 'phase'].includes(value) ? value : 'minimal';
    const changed = state.morph.slideType !== next;
    state.morph.slideType = next;
    const el = document.getElementById('morphSlideType');
    if (el) el.value = next;
    if (!fromGeometry)
      window.SomataTestMorph?.syncFromBlue?.(getUnifiedMorphMode(), next, getSpiralMorphMode());
    if (changed) {
      if (runtimeState.morph.active) rebaseMorphCycle();
      requestMainCanvasRender();
    }
    return true;
  };
  // The mode-navigation binding is registered in another UI section.
  // Share this scoped setter without redispatching synthetic changes.
  window.__somataSetBlueSlideFromUI = setMorphSlideFromUI;
  document
    .getElementById('morphSlideType')
    ?.addEventListener('change', (e) => setMorphSlideFromUI(e.target.value));

  document.getElementById('morphSpeedType')?.addEventListener('change', (e) => {
    state.morph.speedType = e.target.value || 'linear';
    window.SomataTestMorph?.syncSpeedUI?.();
    requestMainCanvasRender();
  });
  const syncMorphSizeVariationText = () => {};
  const syncMorphSizeVariation = () => {
    const value = Math.round(
      Math.max(0, Math.min(100, Number(document.getElementById('morphSizeVariation')?.value) || 0)),
    );
    const rawMult = Number(document.getElementById('morphSizeVariationMultiplier')?.value);
    state.morph.sizeVariation = value;
    state.morph.sizeVariationMultiplier = Number.isFinite(rawMult) ? Math.max(0, rawMult) : 1;
    const input = document.getElementById('morphSizeVariation');
    if (input) input.value = String(value);
    const mult = document.getElementById('morphSizeVariationMultiplier');
    if (mult) mult.value = String(state.morph.sizeVariationMultiplier);
    if (runtimeState.morph.active && state.morph.options.bySize) rebaseMorphCycle();
  };
  ['morphSizeVariation', 'morphSizeVariationMultiplier'].forEach((id) => {
    document.getElementById(id)?.addEventListener('input', syncMorphSizeVariation);
    document.getElementById(id)?.addEventListener('change', syncMorphSizeVariation);
  });
  document.getElementById('morphNormalizeSizes')?.addEventListener('change', (e) => {
    state.morph.normalizeSizes = e.target.checked === true;
    if (runtimeState.morph.active && state.morph.options.bySize) rebaseMorphCycle();
  });

  const syncMorphRotationRange = (changed = '') => {
    let minPct = Math.round(
      Math.max(0, Math.min(100, Number(document.getElementById('morphRotationMin')?.value) || 0)),
    );
    let maxPct = Math.round(
      Math.max(0, Math.min(100, Number(document.getElementById('morphRotationMax')?.value) || 0)),
    );
    if (minPct > maxPct) {
      if (changed === 'morphRotationMin') maxPct = minPct;
      else minPct = maxPct;
    }
    state.morph.rotationMinPercent = minPct;
    state.morph.rotationMaxPercent = maxPct;
    const minEl = document.getElementById('morphRotationMin');
    const maxEl = document.getElementById('morphRotationMax');
    if (minEl) minEl.value = String(minPct);
    if (maxEl) maxEl.value = String(maxPct);
    const rangeText = document.getElementById('morphRotationRangeText');
    if (rangeText) rangeText.textContent = `${minPct}–${maxPct}%`;
    if (runtimeState.morph.active && state.morph.options.byRotation) rebaseMorphCycle();
  };
  document
    .getElementById('morphRotationMin')
    ?.addEventListener('input', () => syncMorphRotationRange('morphRotationMin'));
  document
    .getElementById('morphRotationMax')
    ?.addEventListener('input', () => syncMorphRotationRange('morphRotationMax'));
  document
    .getElementById('morphRotationMin')
    ?.addEventListener('change', () => syncMorphRotationRange('morphRotationMin'));
  document
    .getElementById('morphRotationMax')
    ?.addEventListener('change', () => syncMorphRotationRange('morphRotationMax'));
  document.getElementById('morphRotationMultiplier')?.addEventListener('input', (e) => {
    state.morph.rotationMultiplier = Math.max(0, Number(e.target.value) || 0);
    e.target.value = String(state.morph.rotationMultiplier);
    if (runtimeState.morph.active && state.morph.options.byRotation) rebaseMorphCycle();
  });
  document.getElementById('morphRotationRandomDirection')?.addEventListener('change', (e) => {
    state.morph.rotationRandomDirection = e.target.checked === true;
    if (runtimeState.morph.active && state.morph.options.byRotation) rebaseMorphCycle();
  });

  document.getElementById('morphShapeFamily')?.addEventListener('change', (e) => {
    state.morph.shapeOptions.family = ['mix', 'square', 'triangle', 'sine'].includes(e.target.value)
      ? e.target.value
      : 'mix';
    rebaseMorphCycle();
    renderMainCanvas();
  });
  document.querySelectorAll('[data-morph-profile-group]').forEach((control) => {
    const eventName = control instanceof HTMLInputElement && control.type === 'checkbox' ? 'change' : 'click';
    control.addEventListener(eventName, () => {
      const group = control.dataset.morphProfileGroup;
      if (!MORPH_PROFILE_GROUP_KEYS.includes(group)) return;
      const groups = normalizedMorphProfileGroups();
      const isActive = groups.includes(group);
      const requestedOn =
        control instanceof HTMLInputElement && control.type === 'checkbox' ? control.checked : !isActive;

      if (!requestedOn && isActive && groups.length === 1) {
        if (control instanceof HTMLInputElement) control.checked = true;
        else {
          control.classList.add('active');
          control.setAttribute('aria-pressed', 'true');
        }
        return;
      }
      const next = requestedOn
        ? isActive
          ? groups
          : [...groups, group]
        : groups.filter((item) => item !== group);
      state.morph.shapeOptions.profileGroups = MORPH_PROFILE_GROUP_KEYS.filter((item) => next.includes(item));
      state.morph.shapeOptions.profileGroup =
        state.morph.shapeOptions.profileGroups.length === 1
          ? state.morph.shapeOptions.profileGroups[0]
          : 'all';
      state.morph.shapeOptions.standardOnly =
        state.morph.shapeOptions.profileGroups.length === 1 &&
        state.morph.shapeOptions.profileGroups[0] === 'standard';
      syncMorphShapeToggleButtons();
      if (runtimeState.morph.active) rebaseMorphCycle();
      renderMainCanvas();
    });
  });

  const morphSplinePointInput = document.getElementById('morphSplinePointCount');
  const applyMorphSplinePointCount = (rawValue) => {
    const next = normalizeSplinePointCount(rawValue);
    if (state.morph.splinePoints === next) {
      syncMorphSplinePointButtons();
      return;
    }
    state.morph.splinePoints = next;
    syncMorphSplinePointButtons();
    state.layers.forEach((layer) => {
      invalidateLayerGeometry(layer, 'legacy-geometry-control');
    });
    if (runtimeState.morph.active) rebaseMorphCycle();
    renderProfileEditor();
    requestMainCanvasRender();
  };
  morphSplinePointInput?.addEventListener('input', (e) => {
    const n = Number(e.target.value);
    if (Number.isFinite(n) && n >= 4 && n <= 256) applyMorphSplinePointCount(n);
  });
  morphSplinePointInput?.addEventListener('change', (e) => applyMorphSplinePointCount(e.target.value));

  document.getElementById('btnResetMorphOpacity')?.addEventListener('click', () => {
    state.morph.options.byOpacity = false;
    state.morph.opacityMin = 100;
    state.morph.opacityMax = 100;
    state.layers.forEach((layer) => {
      layer.opacity = 100;
    });
    (runtimeState.morph.sourceVisuals || []).forEach((v) => {
      if (v) v.opacity = 100;
    });
    (runtimeState.morph.targetVisuals || []).forEach((v) => {
      if (v) v.opacity = 100;
    });
    (runtimeState.morph.lightLayers || []).forEach((v) => {
      if (v) v.opacity = 100;
    });
    (runtimeState.morph.renderSourceLayers || []).forEach((v) => {
      if (v) v.opacity = 100;
    });
    (runtimeState.morph.renderTargetLayers || []).forEach((v) => {
      if (v) v.opacity = 100;
    });
    syncMorphSettingsUI();
    syncSidebarInputs();
    if (runtimeState.morph.active) rebaseMorphCycle();
    renderProfileEditor();
    renderMainCanvas();
  });

  document.getElementById('btnClearMorphRounding')?.addEventListener('click', () => {
    state.morph.options.byRounding = false;
    state.morph.roundingMin = 0;
    state.morph.roundingMax = 0;
    state.layers.forEach((layer) => {
      layer.rounding = 0;
    });
    (runtimeState.morph.sourceVisuals || []).forEach((v) => {
      if (v) v.rounding = 0;
    });
    (runtimeState.morph.targetVisuals || []).forEach((v) => {
      if (v) v.rounding = 0;
    });
    (runtimeState.morph.lightLayers || []).forEach((v) => {
      if (v) v.rounding = 0;
    });
    syncMorphSettingsUI();
    syncSidebarInputs();
    if (runtimeState.morph.active) rebaseMorphCycle();
    renderProfileEditor();
    renderMainCanvas();
  });

  document.getElementById('chaosMorphEnabled')?.addEventListener('change', (e) => {
    state.morph.chaosMorphEnabled = e.target.checked === true;
    document.getElementById('chaosMorphSettings')?.classList.toggle('hidden', !state.morph.chaosMorphEnabled);
    if (runtimeState.morph.active) rebaseMorphCycle();
    requestMainCanvasRender();
  });
  const syncChaosMorphNumbers = () => {
    const spread = Math.max(
      0,
      Math.min(120, Math.round(Number(document.getElementById('chaosMorphStepSpread')?.value) || 0)),
    );
    const closures = Math.max(
      0,
      Math.min(120, Math.round(Number(document.getElementById('chaosMorphClosuresMax')?.value) || 0)),
    );
    state.morph.chaosMorphStepSpread = spread;
    state.morph.chaosMorphClosuresMax = closures;
    const a = document.getElementById('chaosMorphStepSpread'),
      b = document.getElementById('chaosMorphClosuresMax');
    if (a) a.value = String(spread);
    if (b) b.value = String(closures);
    if (runtimeState.morph.active) rebaseMorphCycle();
    requestMainCanvasRender();
  };
  document.getElementById('chaosMorphStepSpread')?.addEventListener('change', syncChaosMorphNumbers);
  document.getElementById('chaosMorphClosuresMax')?.addEventListener('change', syncChaosMorphNumbers);

  document.getElementById('morphGlobalHueEnabled')?.addEventListener('change', (e) => {
    state.morph.morphGlobalHueOffset = e.target.checked === true;
    syncMorphSettingsUI();
    if (runtimeState.morph.active) rebaseMorphCycle();
    requestMainCanvasRender();
  });
  document.getElementById('morphGlobalHueRange')?.addEventListener('change', (e) => {
    state.morph.globalHueOffsetRange = Math.max(0, Math.min(360, Math.round(Number(e.target.value) || 0)));
    e.target.value = String(state.morph.globalHueOffsetRange);
    if (runtimeState.morph.active && state.morph.morphGlobalHueOffset === true) rebaseMorphCycle();
    requestMainCanvasRender();
  });

  const morphOptionMap = {
    morphByShape: 'byShape',
    morphByVertices: 'byVertices',
    morphBySteps: 'bySteps',
    morphByRounding: 'byRounding',
    morphByStrokeWidth: 'byStrokeWidth',
    morphBySize: 'bySize',
    morphByColor: 'byColor',
    morphByFillColor: 'byFillColor',
    morphByOpacity: 'byOpacity',
    morphByRotation: 'byRotation',
    morphBySpiralOrder: 'bySpiralOrder',
    morphBySpiralLayers: 'bySpiralLayers',
  };
  Object.entries(morphOptionMap).forEach(([id, key]) => {
    document.getElementById(id).addEventListener('change', (e) => {
      state.morph.options[key] = e.target.checked;
      // Enabling a Spiral row through an older/source control also
      // means the row exists. Disabling must never discard it.
      if (e.target.checked === true && key === 'bySpiralLayers') state.morph.options.spiralLayersAdded = true;
      if (e.target.checked === true && key === 'bySpiralOrder') state.morph.options.spiralOrderAdded = true;
      if (key === 'byShape') updateMorphShapeControlsEnabled();
      if (key === 'byFillColor') syncMorphSettingsUI();
      syncBlueMorphParameterDecorations();
      rebaseMorphCycle();
      renderMainCanvas();
    });
  });

  const syncMorphFillControls = (changed = '') => {
    let minLayers = Math.max(
      0,
      Math.min(64, Math.round(Number(document.getElementById('morphFillLayersMin')?.value) || 0)),
    );
    let maxLayers = Math.max(
      0,
      Math.min(64, Math.round(Number(document.getElementById('morphFillLayersMax')?.value) || 0)),
    );
    if (minLayers > maxLayers) {
      if (changed === 'morphFillLayersMin') maxLayers = minLayers;
      else minLayers = maxLayers;
    }
    state.morph.fillLayersMin = minLayers;
    state.morph.fillLayersMax = maxLayers;
    if (maxLayers > 0) rememberMorphFillLayerRange();
    state.morph.fillHueReset = (state.morph.fillHueHarmony || 'native') === 'native';
    let opacityMin = Math.max(
      0,
      Math.min(100, Number(document.getElementById('morphFillOpacityMin')?.value) || 0),
    );
    let opacityMax = Math.max(
      0,
      Math.min(100, Number(document.getElementById('morphFillOpacityMax')?.value) || 0),
    );
    if (opacityMin > opacityMax) {
      if (changed === 'morphFillOpacityMin') opacityMax = opacityMin;
      else opacityMin = opacityMax;
    }
    state.morph.fillOpacityMin = Math.round(opacityMin);
    state.morph.fillOpacityMax = Math.round(opacityMax);
    const minEl = document.getElementById('morphFillLayersMin'),
      maxEl = document.getElementById('morphFillLayersMax');
    const oMinEl = document.getElementById('morphFillOpacityMin'),
      oMaxEl = document.getElementById('morphFillOpacityMax');
    if (minEl) minEl.value = minLayers;
    if (maxEl) maxEl.value = maxLayers;
    if (oMinEl) oMinEl.value = state.morph.fillOpacityMin;
    if (oMaxEl) oMaxEl.value = state.morph.fillOpacityMax;
    syncMorphSettingsUI();
    rebaseMorphCycle();
    renderMainCanvas();
  };
  ['morphFillLayersMin', 'morphFillLayersMax', 'morphFillOpacityMin', 'morphFillOpacityMax'].forEach((id) => {
    const el = document.getElementById(id);
    el?.addEventListener('change', () => syncMorphFillControls(id));
  });
  document.getElementById('morphFillHarmonySelect')?.addEventListener('change', (e) => {
    const mode = e.target.value;
    if (!FILL_HARMONY_OFFSETS[mode]) return;
    state.morph.fillHueHarmony = mode;
    state.morph.fillHueReset = mode === 'native';
    syncMorphSettingsUI();
    if (runtimeState.morph.active) rebaseMorphCycle();
    renderMainCanvas();
  });
  document.getElementById('btnResetMorphFillOpacity')?.addEventListener('click', () => {
    const minEl = document.getElementById('morphFillOpacityMin');
    const maxEl = document.getElementById('morphFillOpacityMax');
    if (minEl) minEl.value = '3';
    if (maxEl) maxEl.value = '3';
    syncMorphFillControls('morphFillOpacityMax');
  });
  return Object.freeze({
    applyAllLayersStrokeWidth,
    syncMorphVertexRange,
    syncMorphSpiralLayerRange,
    syncMorphSpiralOrderRange,
    syncMorphRoundingRange,
    syncMorphStepRange,
    syncMorphStrokeWidthRange,
    syncMorphOpacityRange,
    syncMorphOrbitRange,
    syncMorphFadePercent,
    syncMorphSizeVariationText,
    syncMorphSizeVariation,
    syncMorphRotationRange,
    morphOptionMap,
    syncMorphFillControls,
  });
}

export { createMorphUIModule };
