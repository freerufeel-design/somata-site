// Панель настроек морфа, всплывающие панели вьюпорта, редактируемые числа.
import './orange-morph/routing-ui.js'; // initialisation order: this module runs after it
import { normalizeSplinePointCount } from '../geometry/profile-model.js';
import { syncMorphModeDependentUI } from './effects-sidebar.js';
import { morphPaletteSyncEnabled } from '../core/palette.js';
import { state } from '../core/state.js';
import { MORPH_PROFILE_GROUP_KEYS, activeProfilePresetGroup } from './profile-presets.js';
import { normalizeMorphVertexMultiplier } from './geometry-n-control.js';
import { getSpiralMorphType, getUnifiedMorphMode } from '../morph-runtime/morph-mode.js';
import { syncBlueMorphParameterDecorations } from './blue-morph/parameter-bindings.js';
import { setMorphRoutingOpenGroup, syncMorphProfileUI } from './blue-morph/profiles.js';
import { isTapMorphSyncActive, syncTapTimingIndicators } from '../audio/tap-tempo.js';
import { syncPaletteOptionChecks, syncPlaylistPaletteSelectionUI } from './playlist-palettes.js';

function updateMorphShapeControlsEnabled() {
  const row = document.getElementById('morphShapeRow');
  const enabled = document.getElementById('morphByShape')?.checked !== false;
  row?.classList.toggle('shape-disabled', !enabled);
}
function normalizedMorphShapeSelections() {
  const shape = state.morph.shapeOptions || (state.morph.shapeOptions = {});

  let noLoops = typeof shape.noLoops === 'boolean' ? shape.noLoops : shape.loops !== true;
  let loops = typeof shape.loops === 'boolean' ? shape.loops : false;
  let closed = typeof shape.closed === 'boolean' ? shape.closed : shape.open !== true;
  let open = typeof shape.open === 'boolean' ? shape.open : false;
  shape.noLoops = noLoops;
  shape.loops = loops;
  shape.closed = closed;
  shape.open = open;
  return { noLoops, loops, closed, open };
}
function normalizedMorphProfileGroups() {
  const shape = state.morph.shapeOptions || (state.morph.shapeOptions = {});
  let groups = Array.isArray(shape.profileGroups)
    ? shape.profileGroups
        .map((group) => (group === 'noLoops' ? 'closed' : group))
        .filter((group) => MORPH_PROFILE_GROUP_KEYS.includes(group))
    : [];
  groups = [...new Set(groups)];

  if (!groups.length) {
    const legacyRaw = shape.profileGroup;
    const legacy = legacyRaw === 'noLoops' ? 'closed' : legacyRaw;
    if (MORPH_PROFILE_GROUP_KEYS.includes(legacy)) groups = [legacy];
    else if (shape.standardOnly === true) groups = ['standard'];
    else groups = ['standard', 'closed'];
  }
  if (!groups.length) groups = ['standard'];

  shape.profileGroups = groups.slice();

  shape.profileGroup = groups.length === 1 ? groups[0] : 'all';
  shape.standardOnly = groups.length === 1 && groups[0] === 'standard';
  return groups;
}
function syncMorphShapeToggleButtons() {
  const groups = normalizedMorphProfileGroups();
  document.querySelectorAll('[data-morph-profile-group]').forEach((control) => {
    const on = groups.includes(control.dataset.morphProfileGroup);
    if (control instanceof HTMLInputElement && control.type === 'checkbox') control.checked = on;
    else {
      control.classList.toggle('active', on);
      control.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  });
  const labels = {
    standard: 'Стандарт',
    closed: 'Замкнутые',
    loops: 'С петлями',
    open: 'Разомкнутые',
    mandala: 'Мандала',
  };
  const summary = document.getElementById('morphProfileGroupSummary');
  if (summary)
    summary.textContent =
      groups.length === MORPH_PROFILE_GROUP_KEYS.length
        ? 'Все'
        : groups.map((g) => labels[g] || g).join(', ');
  document
    .querySelectorAll('.morph-profile-group-check')
    .forEach((el) =>
      el.classList.toggle(
        'browsed',
        el.querySelector('input')?.dataset.morphProfileGroup === activeProfilePresetGroup,
      ),
    );
}
function syncMorphSplinePointButtons() {
  const points = normalizeSplinePointCount(state.morph.splinePoints);
  state.morph.splinePoints = points;
  const morphInput = document.getElementById('morphSplinePointCount');
  if (morphInput && document.activeElement !== morphInput) morphInput.value = String(points);
  const profileInput = document.getElementById('profileSplinePointCount');
  if (profileInput && document.activeElement !== profileInput) profileInput.value = String(points);
}
function syncMorphAllStrokeWidthUI() {
  if (!state.layers?.length) return;
  const widths = state.layers.map((layer) => Math.max(0.5, Math.min(20, Number(layer.strokeWidth) || 1.5)));
  const average = widths.reduce((sum, value) => sum + value, 0) / widths.length;
  const value = Math.round(average * 10) / 10;
  const slider = document.getElementById('morphAllStrokeWidth');
  const input = document.getElementById('morphAllStrokeWidthValue');
  if (slider) slider.value = value;
  if (input) input.value = value;
}
function syncMorphSettingsUI() {
  const shape = state.morph.shapeOptions || {};
  const ids = {
    morphInterval: state.morph.intervalSec,
    morphDefaultActive: state.morph.defaultActive === true,
    morphDiversity: state.morph.diversity,
    morphVertexMin: state.morph.vertexMin,
    morphVertexMax: state.morph.vertexMax,
    morphVertexMultiplier: normalizeMorphVertexMultiplier(state.morph.vertexMultiplier),
    morphRoundingMin: state.morph.roundingMin,
    morphRoundingMax: state.morph.roundingMax,
    morphStepMin: state.morph.stepMin,
    morphStepMax: state.morph.stepMax,
    morphMonoOrbitTransforms: state.morph.monoOrbitTransforms,
    morphOrbitPercentMin: state.morph.orbitPercentMin,
    morphOrbitPercentMax: state.morph.orbitPercentMax,
    morphStrokeWidthMin: state.morph.strokeWidthMin,
    morphStrokeWidthMax: state.morph.strokeWidthMax,
    morphOpacityMin: state.morph.opacityMin,
    morphOpacityMax: state.morph.opacityMax,
    morphFadePercent: state.morph.fadePercent,
    morphFadePercentValue: state.morph.fadePercent,
    morphMode: getUnifiedMorphMode(),
    morphSlideType: state.morph.slideType,
    morphSpeedType: state.morph.speedType,
    morphLightningWhite: state.morph.lightningWhite,
    morphLightningRandom: state.morph.lightningRandom,
    morphLightningColor: state.morph.lightningColor,
    morphLightningSegmentPercent: state.morph.lightningSegmentPercent,
    morphLightningSegmentPercentValue: state.morph.lightningSegmentPercent,
    morphLightningGlow: state.morph.lightningGlow,
    morphLightningGlowValue: state.morph.lightningGlow,
    morphByShape: state.morph.options.byShape,
    morphShapeFamily: ['mix', 'square', 'triangle', 'sine'].includes(shape.family) ? shape.family : 'mix',
    morphByVertices: state.morph.options.byVertices,
    morphBySteps: state.morph.options.bySteps,
    morphByRounding: state.morph.options.byRounding,
    morphByStrokeWidth: state.morph.options.byStrokeWidth,
    morphBySize: state.morph.options.bySize,
    morphSizeVariation: Math.round(Math.max(0, Math.min(100, Number(state.morph.sizeVariation) || 0))),
    morphSizeVariationMultiplier: Math.max(0, Number(state.morph.sizeVariationMultiplier) || 0),
    morphNormalizeSizes: state.morph.normalizeSizes !== false,
    morphRotationMin: state.morph.rotationMinPercent,
    morphRotationMax: state.morph.rotationMaxPercent,
    morphRotationMultiplier: state.morph.rotationMultiplier,
    morphRotationRandomDirection: state.morph.rotationRandomDirection,
    morphByColor: state.morph.options.byColor,
    morphFixedColors: state.morph.fixedColors === true,
    morphSyncPalettes: morphPaletteSyncEnabled(),
    morphGlobalHueEnabled: state.morph.morphGlobalHueOffset === true,
    morphGlobalHueRange: Math.max(
      0,
      Math.min(
        360,
        Number.isFinite(Number(state.morph.globalHueOffsetRange))
          ? Number(state.morph.globalHueOffsetRange)
          : 180,
      ),
    ),
    morphSpiralOrderHoldPhases: SomataSpiralZeroTransition.holdPhases(state.morph.spiralOrderHoldPhases),
    paramSpiralOrderHoldPhases: SomataSpiralZeroTransition.holdPhases(state.morph.spiralOrderHoldPhases),
    morphSpiralOrderMin: state.morph.spiralOrderMin ?? -1,
    morphSpiralOrderMax: state.morph.spiralOrderMax ?? 1,
    morphSpiralOrderLinked: state.morph.spiralOrderLinked === true,
    morphByFillColor: state.morph.options.byFillColor,
    morphByOpacity: state.morph.options.byOpacity,
    morphFillLayersMin: state.morph.fillLayersMin,
    morphFillLayersMax: state.morph.fillLayersMax,
    morphFillOpacityMin: state.morph.fillOpacityMin,
    morphFillOpacityMax: state.morph.fillOpacityMax,
    morphByRotation: state.morph.options.byRotation,
    morphSpiralLayersMin: state.morph.spiralLayersMin ?? 0,
    morphSpiralLayersMax: state.morph.spiralLayersMax ?? 1,
    morphSpiralTangentialChance: state.morph.spiralTangentialChance ?? 50,
    morphBySpiralOrder: state.morph.options.bySpiralOrder === true,
    morphBySpiralLayers: state.morph.options.bySpiralLayers === true,
    chaosMorphEnabled: state.morph.chaosMorphEnabled === true,
    chaosMorphStepSpread: state.morph.chaosMorphStepSpread ?? 1,
    chaosMorphClosuresMax: state.morph.chaosMorphClosuresMax ?? 3,
    morphSpiralMorphType: getSpiralMorphType(),
    morphSpiralRotationCompensation: state.morph.spiralRotationCompensation === true,
    morphPauseOnSpace: state.morph.pauseOnSpace === true,
  };
  Object.entries(ids).forEach(([id, value]) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.type === 'checkbox') el.checked = Boolean(value);
    else el.value = value;
  });
  document
    .getElementById('chaosMorphSettings')
    ?.classList.toggle('hidden', state.morph.chaosMorphEnabled !== true);
  const sizeVariationText = document.getElementById('morphSizeVariationText');
  if (sizeVariationText) {
    const pct = Math.round(Number(state.morph.sizeVariation) || 0);
    const mult = Math.max(0, Number(state.morph.sizeVariationMultiplier) || 0);
    sizeVariationText.textContent = `${pct}% × ${Number.isInteger(mult) ? mult : mult.toFixed(1)}`;
  }
  const morphModeTop = document.getElementById('morphModeTop');
  if (morphModeTop) morphModeTop.value = getUnifiedMorphMode();
  window.__somataSyncSpiralModeSelects?.();
  const rotationRangeText = document.getElementById('morphRotationRangeText');
  if (rotationRangeText)
    rotationRangeText.textContent = `${Math.round(Number(state.morph.rotationMinPercent) || 0)}–${Math.round(Number(state.morph.rotationMaxPercent) || 0)}%`;
  const lineColorRow = document.getElementById('morphLineColorRow');
  lineColorRow?.classList.toggle('color-disabled', state.morph.options.byColor !== true);
  const globalHueRange = document.getElementById('morphGlobalHueRange');
  if (globalHueRange) globalHueRange.disabled = state.morph.morphGlobalHueOffset !== true;
  document
    .getElementById('morphGlobalHueRow')
    ?.classList.toggle('color-disabled', state.morph.morphGlobalHueOffset !== true);
  syncPlaylistPaletteSelectionUI();
  const spiralOrderControls = document.getElementById('morphSpiralOrderControls');
  if (spiralOrderControls) spiralOrderControls.classList.remove('linked');
  const fillRow = document.getElementById('morphFillColorRow');
  const fillOpacityRow = document.getElementById('morphFillOpacityRow');
  const fillEnabled = state.morph.options.byFillColor === true;
  const harmonyMode = state.morph.fillHueHarmony || 'native';
  fillRow?.classList.toggle('fill-disabled', !fillEnabled);
  fillOpacityRow?.classList.toggle('fill-disabled', !fillEnabled);
  ['morphFillLayersMin', 'morphFillLayersMax', 'morphFillOpacityMin', 'morphFillOpacityMax'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.disabled = !fillEnabled;
  });
  const harmonySelect = document.getElementById('morphFillHarmonySelect');
  if (harmonySelect) {
    harmonySelect.value = harmonyMode;
    harmonySelect.disabled = !fillEnabled;
  }
  const monoOrbitEnabled = state.morph.monoOrbitTransforms === true;
  const monoOrbitRow = document.getElementById('morphMonoOrbitRow');
  monoOrbitRow?.classList.toggle('mono-orbit-disabled', !monoOrbitEnabled);
  ['morphOrbitPercentMin', 'morphOrbitPercentMax'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.disabled = !monoOrbitEnabled;
  });
  syncMorphModeDependentUI();
  syncMorphAllStrokeWidthUI();
  syncMorphShapeToggleButtons();
  syncMorphSplinePointButtons();
  updateMorphShapeControlsEnabled();
  syncMorphIntervalQuickButtons();
  syncTapTimingIndicators();
  syncPaletteOptionChecks();
  syncBlueMorphParameterDecorations();
  syncMorphProfileUI();
}
function syncMorphIntervalQuickButtons() {
  const current = isTapMorphSyncActive('full') ? NaN : Number(state.morph.intervalSec);
  document.querySelectorAll('[data-morph-interval]').forEach((btn) => {
    btn.classList.toggle('active', Math.abs(Number(btn.dataset.morphInterval) - current) < 0.001);
  });
}
function viewportPopupBelongsToPanel(target, panelId) {
  const popup = target?.closest?.('.audio-param-menu,.audio-route-group-menu');
  if (popup?._viewportOwnerPanelId === panelId) return true;
  const trigger = popup?._viewportTrigger;
  return !!trigger?.closest?.(`#${panelId}`);
}
function closeViewportPopupsForPanel(panelId) {
  document.querySelectorAll('.audio-param-menu,.audio-route-group-menu').forEach((popup) => {
    const trigger = popup?._viewportTrigger;
    if (popup?._viewportOwnerPanelId === panelId || trigger?.closest?.(`#${panelId}`))
      popup.classList.add('hidden');
  });
  if (panelId === 'morphSettingsPanel') setMorphRoutingOpenGroup('');
}
function isMorphRoutingContextTarget(target) {
  if (!target?.closest) return false;
  if (
    target.closest(
      '.blue-morph-parameter-name,[data-morph-routing-bound="1"],[data-morph-routing-label-bound="1"]',
    )
  )
    return true;
  const node = target.closest('[id]'),
    id = node?.id;
  if (!id) return false;
  return (window.SomataParameterRegistry?.morphable?.() || []).some((def) => def?.ui?.mainId === id);
}
function toggleMorphSettingsPanel(forceOpen) {
  const panel = document.getElementById('morphSettingsPanel');
  if (!panel) return;
  const shouldOpen = forceOpen !== undefined ? forceOpen : panel.classList.contains('hidden');
  panel.classList.toggle('hidden', !shouldOpen);
  if (!shouldOpen) {
    panel.style.visibility = '';
    closeViewportPopupsForPanel('morphSettingsPanel');
    const rows = document.getElementById('morphProfileBindings');
    if (rows) rows.innerHTML = '';
  }
}
function bindEditableNumericDisplays() {
  const pairs = [
    ['valRounding', 'paramRounding'],
    ['valRoundingGuideOpacity', 'paramRoundingGuideOpacity'],
    ['valRotation', 'paramRotation'],
    ['valLineOpacity', 'paramLineOpacity'],
    ['valOpacity', 'paramOpacity'],
    ['valFillOpacity', 'paramFillOpacity'],
  ];
  pairs.forEach(([displayId, rangeId]) => {
    const display = document.getElementById(displayId);
    const range = document.getElementById(rangeId);
    if (!display || !range || display.dataset.directEditBound === '1') return;
    display.dataset.directEditBound = '1';
    display.contentEditable = 'true';
    display.spellcheck = false;
    display.tabIndex = 0;
    display.classList.add('editable-number-value');
    display.setAttribute('role', 'spinbutton');
    display.title = 'Нажмите и введите значение вручную';
    let beforeEdit = display.textContent;
    const selectAll = () => {
      const sel = window.getSelection();
      if (!sel) return;
      const r = document.createRange();
      r.selectNodeContents(display);
      sel.removeAllRanges();
      sel.addRange(r);
    };
    const commit = () => {
      const raw = String(display.textContent || '').replace(',', '.');
      let value = parseFloat(raw);
      if (!Number.isFinite(value)) {
        display.textContent = beforeEdit;
        return;
      }
      const min = Number(range.min);
      const max = Number(range.max);
      if (Number.isFinite(min)) value = Math.max(min, value);
      if (Number.isFinite(max)) value = Math.min(max, value);
      range.value = String(value);
      range.dispatchEvent(new Event('input', { bubbles: true }));
      beforeEdit = display.textContent;
    };
    display.addEventListener('focus', () => {
      beforeEdit = display.textContent;
      requestAnimationFrame(selectAll);
    });
    display.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        display.blur();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        display.textContent = beforeEdit;
        display.blur();
      }
    });
    display.addEventListener('blur', commit);
  });
}

export {
  bindEditableNumericDisplays,
  closeViewportPopupsForPanel,
  isMorphRoutingContextTarget,
  normalizedMorphProfileGroups,
  normalizedMorphShapeSelections,
  syncMorphAllStrokeWidthUI,
  syncMorphIntervalQuickButtons,
  syncMorphSettingsUI,
  syncMorphShapeToggleButtons,
  syncMorphSplinePointButtons,
  toggleMorphSettingsPanel,
  updateMorphShapeControlsEnabled,
  viewportPopupBelongsToPanel,
};
