// Orange Morph: профили, привязки и маршрутизация параметров.
import '../color-picker.js'; // initialisation order: this module runs after it
import {
  getActivePlaylistPaletteKeys,
  getPlaylistPaletteDisplayName,
  morphPaletteSyncEnabled,
  normalizePlaylistPaletteKey,
} from '../../core/palette.js';
import { requestMainCanvasRender } from '../../core/scheduler.js';
import { runtimeState, state } from '../../core/state.js';
import { PROFILE_PRESET_GROUP_LABELS, PROFILE_PRESET_GROUP_ORDER } from '../profile-presets.js';
import { formatDisplayNumber } from '../geometry-n-control.js';
import {
  MORPH_COMPOUND_CHILD_LABELS,
  morphAlwaysOnMultiplier,
  morphCompoundChildren,
  morphCompoundParentId,
  morphRowCheckbox,
  morphSpecialRowPresence,
  morphUiGroup,
  setMorphSpecialRowPresence,
} from '../blue-morph/parameter-bindings.js';
import {
  appendMorphAlwaysOnMultiplierControl,
  appendMorphGroupLabel,
  appendMorphInlineCheck,
  appendMorphInlineSelect,
  appendMorphLayerCoverage,
  appendSharedMorphBindingRange,
  appendSharedMorphOrbitRow,
  appendSpecialLayerCoverage,
  buildMorphParameterMenu,
  chooseMorphPaletteInUI,
  createMorphRoutingGroupIcon,
  defaultMorphBindingRange,
} from '../blue-morph/profile-bindings.js';
import { syncMorphRouteDecorations } from '../parameter-routing-popup.js';
import { askTransientMorphProfileDecision, morphProfileDisplayName } from '../blue-morph/profiles.js';
import {
  activeRebaseMinimalMorphing,
  activeStopMinimalMorphing,
} from '../../morph-runtime/morph-hooks.js';
import {
  getMorphIntervalMultiplier,
  getTapMorphIntervalSec,
  getTapTempoIntervalSec,
  isTapMorphSyncActive,
  syncTapTimingIndicators,
} from '../../audio/tap-tempo.js';
import { syncPaletteOptionChecks, syncPlaylistPaletteSelectionUI } from '../playlist-palettes.js';
import { positionViewportPopup } from '../floating-panels.js';

function normalizeOrangeMorphProfileGroup(value = state.minimalMorph?.mode) {
  const raw = value === 'noLoops' ? 'closed' : String(value || 'standard');
  return PROFILE_PRESET_GROUP_ORDER.includes(raw) ? raw : 'standard';
}
function normalizeOrangeMorphFamily(value = state.minimalMorph?.family) {
  const raw = String(value || 'mix');
  return ['mix', 'square', 'triangle', 'sine'].includes(raw) ? raw : 'mix';
}
function normalizedOrangeMorphProfileGroups() {
  const mm = state.minimalMorph || (state.minimalMorph = {});
  let groups = Array.isArray(mm.profileGroups)
    ? mm.profileGroups
        .map((group) => (group === 'noLoops' ? 'closed' : group))
        .filter((group) => PROFILE_PRESET_GROUP_ORDER.includes(group))
    : [];
  groups = [...new Set(groups)];
  if (!groups.length) groups = [normalizeOrangeMorphProfileGroup(mm.mode)];
  if (!groups.length) groups = ['standard'];
  mm.profileGroups = groups.slice();
  // mode remains as a single-group legacy compatibility field for old projects/plugins.
  mm.mode = groups[0];
  return groups;
}
function syncOrangeMorphModeOptions() {
  const select = document.getElementById('minimalMorphMode');
  const groups = normalizedOrangeMorphProfileGroups();
  const family = normalizeOrangeMorphFamily(state.minimalMorph?.family);
  state.minimalMorph.family = family;
  if (select) {
    const signature = PROFILE_PRESET_GROUP_ORDER.map(
      (group) => `${group}:${PROFILE_PRESET_GROUP_LABELS[group] || group}`,
    ).join('|');
    if (select.dataset.profileGroupsSignature !== signature) {
      const fragment = document.createDocumentFragment();
      PROFILE_PRESET_GROUP_ORDER.forEach((group) => {
        const option = document.createElement('option');
        option.value = group;
        option.textContent = PROFILE_PRESET_GROUP_LABELS[group] || group;
        fragment.appendChild(option);
      });
      select.replaceChildren(fragment);
      select.dataset.profileGroupsSignature = signature;
    }
    select.value = groups[0];
  }
  const familySelect = document.getElementById('minimalMorphFamily');
  if (familySelect) familySelect.value = family;
  document.querySelectorAll('[data-orange-profile-group]').forEach((input) => {
    if (input instanceof HTMLInputElement) input.checked = groups.includes(input.dataset.orangeProfileGroup);
  });
  const labels = {
    standard: 'Стандарт',
    closed: 'Замкнутые',
    loops: 'С петлями',
    open: 'Разомкнутые',
    mandala: 'Мандала',
  };
  const summary = document.getElementById('minimalMorphProfileGroupSummary');
  if (summary)
    summary.textContent =
      groups.length === PROFILE_PRESET_GROUP_ORDER.length
        ? 'Все'
        : groups.map((g) => labels[g] || g).join(', ');
}
function syncRandomSettingsUI() {
  const values = {
    randomByShape: state.randomOptions.byShape,
    randomOnlyLine: state.randomOptions.onlyLine,
    randomByVertices: state.randomOptions.byVertices,
    randomBySteps: state.randomOptions.bySteps,
    randomByRounding: state.randomOptions.byRounding,
    randomBySize: state.randomOptions.bySize,
    randomByColor: state.randomOptions.byColor,
    randomBySpiralLayers: state.randomOptions.bySpiralLayers !== false,
  };
  Object.entries(values).forEach(([id, value]) => {
    const el = document.getElementById(id);
    if (el) el.checked = Boolean(value);
  });
  const count = document.getElementById('randomLayerCount');
  if (count) count.value = state.randomLayerCount;
  const randomSpiralMin = document.getElementById('randomSpiralLayersMin');
  const randomSpiralMax = document.getElementById('randomSpiralLayersMax');
  if (randomSpiralMin)
    randomSpiralMin.value = Math.max(0, Math.round(Number(state.randomOptions.spiralLayersMin) || 0));
  if (randomSpiralMax)
    randomSpiralMax.value = Math.max(0, Math.round(Number(state.randomOptions.spiralLayersMax ?? 1) || 0));
  const rc = document.getElementById('randomCyclePalettes');
  if (rc) rc.checked = state.randomOptions?.cyclePalettes === true;
  const fixed = document.getElementById('randomFixedColors');
  if (fixed) fixed.checked = state.randomOptions?.fixedColors === true;
  syncPaletteOptionChecks();
  const sync = document.getElementById('randomSyncPalettes');
  if (sync) sync.checked = morphPaletteSyncEnabled();
  const minimalInterval = document.getElementById('minimalMorphInterval');
  const minimalFade = document.getElementById('minimalMorphFade');
  const minimalInstant = document.getElementById('minimalMorphInstant');
  const minimalDefaultActive = document.getElementById('minimalMorphDefaultActive');
  const minimalFadeRow = document.getElementById('minimalMorphFadeRow');
  syncOrangeMorphModeOptions();
  if (minimalInterval)
    minimalInterval.value = formatDisplayNumber(
      isTapMorphSyncActive('minimal')
        ? getTapTempoIntervalSec(state.minimalMorph?.intervalSec ?? 5)
        : (state.minimalMorph?.intervalSec ?? 5),
      2,
    );
  const minimalMult = document.getElementById('minimalMorphIntervalMultiplier');
  if (minimalMult && document.activeElement !== minimalMult)
    minimalMult.value = formatDisplayNumber(getMorphIntervalMultiplier('minimal'), 6);
  document
    .querySelectorAll('[data-orange-interval]')
    .forEach((b) =>
      b.classList.toggle(
        'active',
        Number(b.dataset.orangeInterval) === (state.minimalMorph?.intervalSec ?? 5),
      ),
    );
  if (minimalFade) minimalFade.value = formatDisplayNumber(state.minimalMorph?.fadeSec ?? 0.1, 1);
  if (minimalInstant) minimalInstant.checked = state.minimalMorph?.instantSwitch !== false;
  if (minimalDefaultActive) minimalDefaultActive.checked = state.minimalMorph?.defaultActive === true;
  if (minimalFade) minimalFade.disabled = state.minimalMorph?.instantSwitch !== false;
  minimalFadeRow?.classList.toggle('shape-disabled', state.minimalMorph?.instantSwitch !== false);
  syncPlaylistPaletteSelectionUI();
  syncTapTimingIndicators();
  if (document.getElementById('randomSettingsPanel')?.dataset.orangeProfilesReady === '1')
    syncOrangeMorphProfileUI();
}
function orangeProfileLayerCountHolder() {
  return {
    get value() {
      return state.randomLayerCount || 3;
    },
    set value(v) {
      state.randomLayerCount = Math.max(1, Math.min(8, Number(v) || 3));
      const el = document.getElementById('randomLayerCount');
      if (el && document.activeElement !== el) el.value = String(state.randomLayerCount);
    },
  };
}
function ensureOrangeMorphProfiles() {
  return (
    window.SomataOrangeMorphProfiles?.ensureProfiles?.(
      state.minimalMorph,
      state.randomOptions,
      state.randomLayerCount,
    ) || []
  );
}
function getActiveOrangeMorphProfile() {
  return (
    window.SomataOrangeMorphProfiles?.activeProfile?.(
      state.minimalMorph,
      state.randomOptions,
      state.randomLayerCount,
    ) || null
  );
}
function syncOrangeMorphProfileDirtyUI() {
  const store = window.SomataOrangeMorphProfiles;
  if (!store) return false;
  const profile = getActiveOrangeMorphProfile(),
    dirty = store.isDirty?.(state.minimalMorph, state.randomOptions, state.randomLayerCount) === true,
    transient = profile?.transient === true,
    panel = document.getElementById('randomSettingsPanel');
  panel?.classList.toggle('morph-profile-dirty', dirty || transient);
  panel?.classList.toggle('morph-profile-transient', transient);
  const save = document.getElementById('btnSaveOrangeMorphProfile'),
    reset = document.getElementById('btnResetOrangeMorphProfile');
  if (save) {
    save.disabled = !(dirty || transient);
    save.classList.toggle('dirty', dirty || transient);
    save.title = transient
      ? 'Сохранить новый профиль Orange и задать имя'
      : dirty
        ? 'Сохранить профиль Orange · есть изменения'
        : 'Сохранить профиль Orange';
  }
  if (reset) reset.disabled = !dirty;
  const select = document.getElementById('orangeMorphProfileSelect');
  if (select && profile) {
    for (const option of select.options) {
      const p = (state.minimalMorph.profiles || []).find((x) => x.id === option.value);
      const unsaved = p?.transient === true ? ' · не сохранён' : '';
      const changed = option.value === profile.id && dirty ? ' · изменён' : '';
      option.textContent = morphProfileDisplayName(p) + unsaved + changed;
    }
  }
  return dirty;
}
function markOrangeFixedRows() {
  const panel = document.getElementById('randomSettingsPanel');
  if (!panel || panel.dataset.orangeRowsMarked === '1') return;
  panel.dataset.orangeRowsMarked = '1';
  const bind = (id, group) => {
    const el = document.getElementById(id),
      row = el?.closest?.('.morph-setting-row');
    if (row) row.dataset.orangeGroup = group;
  };
  [
    'minimalMorphFamily',
    'minimalMorphProfileGroupDropdown',
    'randomByShape',
    'randomOnlyLine',
    'randomByVertices',
    'randomBySteps',
    'randomByRounding',
    'randomBySize',
  ].forEach((id) => bind(id, 'Геометрия'));
  ['randomByColor', 'minimalMorphLinePalette', 'randomCyclePalettes'].forEach((id) => bind(id, 'Палитра'));
  ['randomBySpiralLayers', 'randomSpiralLayersMin', 'randomSpiralLayersMax'].forEach((id) =>
    bind(id, 'Спирали'),
  );
}
let orangeMorphOpenGroup = '';
function getOrangeMorphBindings() {
  return (
    window.SomataOrangeMorphProfiles?.workingBindings?.(
      state.minimalMorph,
      state.randomOptions,
      state.randomLayerCount,
    ) || []
  );
}
// A palette is an authored Orange target only while its route is active.
const hasOrangeColorRoute = () =>
  getOrangeMorphBindings().some(
    (b) => b?.enabled !== false && (b.parameter === 'layer.strokeColor' || b.parameter === 'layer.fillColor'),
  );
function orangeParameterRoutingState(paramId) {
  const def = window.SomataParameterRegistry?.get?.(paramId);
  if (!def || def.morph?.supported !== true || def.type === 'boolean' || morphAlwaysOnMultiplier(paramId))
    return {
      supported: false,
      added: false,
      active: false,
      reason: def?.type === 'boolean' ? 'Параметры только ВКЛ/ВЫКЛ не используются в Orange' : 'Недоступно',
    };
  return (
    window.SomataOrangeMorphProfiles?.routeState?.(
      state.minimalMorph,
      state.randomOptions,
      state.randomLayerCount,
      paramId,
    ) || { supported: true, added: false, active: false }
  );
}
function syncOrangeGeneratorFlagsFromBindings() {
  const active = (id) => orangeParameterRoutingState(id).active === true,
    ro = state.randomOptions || (state.randomOptions = {});
  ro.byVertices = active('geometry.N');
  ro.bySteps = active('geometry.K');
  ro.byRounding = active('layer.rounding');
  ro.bySize = active('layer.radius');
  ro.byColor = active('layer.strokeColor') || active('layer.fillColor');
  return ro;
}
function setOrangeParameterRouteActive(paramId, enabled) {
  const store = window.SomataOrangeMorphProfiles,
    def = window.SomataParameterRegistry?.get?.(paramId);
  if (
    !store ||
    !def ||
    def.morph?.supported !== true ||
    def.type === 'boolean' ||
    morphAlwaysOnMultiplier(paramId)
  )
    return false;
  const current = orangeParameterRoutingState(paramId),
    range = current.binding || defaultMorphBindingRange(def);
  if (
    !store.setBinding?.(
      state.minimalMorph,
      state.randomOptions,
      state.randomLayerCount,
      paramId,
      enabled === true,
      range,
    )
  )
    return false;
  syncOrangeGeneratorFlagsFromBindings();
  syncRandomSettingsUI();
  renderOrangeMorphBindings();
  renderOrangeMorphRoutingGroups();
  syncMorphRouteDecorations();
  syncOrangeMorphProfileDirtyUI();
  if (runtimeState.minimalMorph?.active === true) activeRebaseMinimalMorphing?.();
  requestMainCanvasRender();
  return true;
}
function removeOrangeParameterBinding(paramId) {
  const store = window.SomataOrangeMorphProfiles;
  if (!store?.removeBinding?.(state.minimalMorph, state.randomOptions, state.randomLayerCount, paramId))
    return false;
  syncOrangeGeneratorFlagsFromBindings();
  renderOrangeMorphBindings();
  renderOrangeMorphRoutingGroups();
  syncMorphRouteDecorations();
  syncOrangeMorphProfileDirtyUI();
  if (runtimeState.minimalMorph?.active === true) activeRebaseMinimalMorphing?.();
  requestMainCanvasRender();
  return true;
}
window.SomataOrangeParameterRoutingUI = Object.freeze({
  state: orangeParameterRoutingState,
  setActive: setOrangeParameterRouteActive,
});
function replaceOrangeParameterBinding(oldId, newId) {
  if (oldId === newId) return false;
  const store = window.SomataOrangeMorphProfiles,
    def = window.SomataParameterRegistry?.get?.(newId) || window.SomataParameterMatrix?.get?.(newId);
  if (!store || !def) return false;
  store.removeBinding?.(state.minimalMorph, state.randomOptions, state.randomLayerCount, oldId);
  if (def.kind) setOrangeSpecialParameterEnabled(newId, true);
  else
    store.setBinding?.(
      state.minimalMorph,
      state.randomOptions,
      state.randomLayerCount,
      newId,
      true,
      defaultMorphBindingRange(def),
    );
  syncOrangeGeneratorFlagsFromBindings();
  syncRandomSettingsUI();
  renderOrangeMorphBindings();
  renderOrangeMorphRoutingGroups();
  syncMorphRouteDecorations();
  syncOrangeMorphProfileDirtyUI();
  if (runtimeState.minimalMorph?.active === true) activeRebaseMinimalMorphing?.();
  requestMainCanvasRender();
  return true;
}
function appendOrangePaletteSelector(parent) {
  const wrap = document.createElement('label');
  wrap.className = 'morph-route-inline-control morph-route-palette-select orange-route-palette-select';
  const t = document.createElement('span');
  t.textContent = 'Палитра';
  const select = document.createElement('select');
  for (const key of getActivePlaylistPaletteKeys()) {
    const o = document.createElement('option');
    o.value = key;
    o.textContent = getPlaylistPaletteDisplayName(key);
    select.appendChild(o);
  }
  select.value = normalizePlaylistPaletteKey(state.randomOptions?.lineColorPalette, 'standard');
  select.addEventListener('change', () => chooseMorphPaletteInUI('yellow', select.value));
  wrap.append(t, select);
  parent.appendChild(wrap);
  return select;
}
// Orange has the same three Fill-colour widgets as Blue, with independent
// persisted Orange profile data (never changes state.morph.*).
function orangeFillOptions() {
  const ro = state.randomOptions || (state.randomOptions = {});
  ro.fillHarmony = FILL_HARMONY_KEYS.has(ro.fillHarmony) ? ro.fillHarmony : 'native';
  ro.fillLayersMin = Math.max(0, Math.min(1, Math.round(Number(ro.fillLayersMin) || 0)));
  ro.fillLayersMax = Math.max(ro.fillLayersMin, Math.min(1, Math.round(Number(ro.fillLayersMax ?? 1))));
  ro.orbitCount = Math.max(0, Math.min(19, Math.round(Number(ro.orbitCount) || 0)));
  // Presence of the editor is independent from its numerical value:
  // an *added* orbit parameter may legitimately remain at 0.0.
  ro.orbitBindingEnabled = ro.orbitBindingEnabled !== false;
  const oldPercent = (v) =>
    Number(v) > 0 ? Math.max(1, Math.min(100, Math.ceil((Number(v) * 100) / 19))) : 100;
  const clip = (v) => Math.max(1, Math.min(100, Math.round(Number(v) || 100)));
  ro.orbitPercentMin = clip(ro.orbitPercentMin ?? oldPercent(ro.orbitCountMin ?? ro.orbitCount));
  ro.orbitPercentMax = Math.max(
    ro.orbitPercentMin,
    clip(ro.orbitPercentMax ?? oldPercent(ro.orbitCountMax ?? ro.orbitCount)),
  );
  return ro;
}
const FILL_HARMONY_KEYS = new Set(['native', 'analogous', 'square', 'triadic', 'split', 'complement', 'all']);
function commitOrangeIndependentOption(key, value) {
  const ro = orangeFillOptions();
  ro[key] = value;
  orangeFillOptions();
  window.SomataOrangeMorphProfiles?.captureDraft?.(state.minimalMorph, ro, state.randomLayerCount);
  syncOrangeMorphProfileDirtyUI();
  if (runtimeState.minimalMorph?.active === true) activeRebaseMinimalMorphing?.();
  requestMainCanvasRender();
}
function appendOrangeFillLayersRange(parent) {
  const ro = orangeFillOptions();
  const wrap = document.createElement('span');
  wrap.className = 'morph-route-inline-control morph-route-inline-range morph-route-dependent-range';
  const caption = document.createElement('span');
  caption.textContent = 'Число залитых слоёв';
  wrap.appendChild(caption);
  const lo = document.createElement('input'),
    hi = document.createElement('input'),
    sep = document.createElement('span');
  sep.className = 'morph-route-inline-range-sep';
  sep.textContent = '—';
  const fillRange = window.SomataParameterMatrix.subcontrolDefinitions('layer.fillColor').find(
    (x) => x.id === 'layer.fillColor.fillLayers',
  );
  for (const [node, value, name] of [
    [lo, ro.fillLayersMin, 'минимум'],
    [hi, ro.fillLayersMax, 'максимум'],
  ]) {
    node.type = 'number';
    node.min = String(fillRange.min);
    node.max = String(fillRange.max);
    node.step = String(fillRange.step);
    node.className = 'morph-route-inline-number';
    node.value = String(value);
    node.setAttribute('aria-label', `Число залитых слоёв: ${name}`);
  }
  const commit = () => {
    const a = Math.max(0, Math.min(1, Math.round(Number(lo.value) || 0)));
    const b = Math.max(0, Math.min(1, Math.round(Number(hi.value) || 0)));
    const min = Math.min(a, b),
      max = Math.max(a, b);
    lo.value = String(min);
    hi.value = String(max);
    const options = orangeFillOptions();
    options.fillLayersMin = min;
    options.fillLayersMax = max;
    commitOrangeIndependentOption('fillLayersMax', max);
  };
  lo.addEventListener('change', commit);
  hi.addEventListener('change', commit);
  wrap.append(lo, sep, hi);
  parent.appendChild(wrap);
  return wrap;
}
function appendOrangeFillHarmonySelector(parent) {
  const wrap = document.createElement('label');
  wrap.className = 'morph-route-inline-control morph-route-harmony-select';
  const title = document.createElement('span');
  title.textContent = 'Гармония цвета заливки';
  const sel = document.createElement('select');
  const source = document.getElementById('morphFillHarmonySelect');
  for (const option of source?.options || []) {
    const o = document.createElement('option');
    o.value = option.value;
    o.textContent = option.textContent;
    sel.appendChild(o);
  }
  sel.value = orangeFillOptions().fillHarmony;
  sel.addEventListener('change', () => commitOrangeIndependentOption('fillHarmony', sel.value));
  wrap.append(title, sel);
  parent.appendChild(wrap);
  return sel;
}
function appendOrangeOrbitCountControl(host) {
  // Absent means removed from the Orange profile, not merely a zero-valued
  // placeholder that reappears immediately after clicking ×.
  if (!orangeSpecialRowPresent('geometry.orbits')) return;
  const ro = orangeFillOptions(),
    enabled = orangeSpecialParameterEnabled('geometry.orbits');
  appendSharedMorphOrbitRow(
    host,
    'orange',
    enabled,
    [ro.orbitPercentMin, ro.orbitPercentMax],
    (a, b) => {
      const opts = orangeFillOptions();
      opts.orbitPercentMin = a;
      opts.orbitPercentMax = b;
      commitOrangeIndependentOption('orbitPercentMax', b);
      // Update group counts without closing the open parameter catalog.
      renderOrangeMorphRoutingGroups();
    },
    (enabled) => setOrangeSpecialRowActive('geometry.orbits', enabled),
  );
}
// Orange uses the exact Blue compound-row vocabulary. Only data ownership differs:
// Orange controls permissions and ranges for generation, Blue interpolates a parameter.
function appendOrangeCompoundBindingControl(row, paramId, label = '') {
  const def = window.SomataParameterRegistry?.get?.(paramId);
  if (!def || def.type === 'boolean' || def.morph?.supported !== true || morphAlwaysOnMultiplier(paramId))
    return null;
  const binding = getOrangeMorphBindings().find((b) => b.parameter === paramId),
    enabled = !!binding && binding.enabled !== false;
  const wrap = document.createElement('div');
  wrap.className = 'morph-route-compound-binding';
  wrap.dataset.childParameter = paramId;
  const toggle = document.createElement('label');
  toggle.className = 'morph-route-compound-toggle';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = enabled;
  cb.title = `Включить / выключить «${label || def.label}» в профиле Orange`;
  const text = document.createElement('span');
  text.textContent = label || MORPH_COMPOUND_CHILD_LABELS[paramId] || def.label;
  toggle.append(cb, text);
  wrap.appendChild(toggle);
  cb.addEventListener('change', () => setOrangeParameterRouteActive(paramId, cb.checked));
  if (
    enabled &&
    binding &&
    (['number', 'integer', 'angle', 'multiplier'].includes(def.type) || def.id === 'outline.color')
  ) {
    const range = document.createElement('span');
    range.className = 'morph-route-compound-range';
    const caption = document.createElement('span');
    caption.className = 'morph-route-compound-caption';
    caption.textContent = 'Диапазон';
    range.appendChild(caption);
    const lo = document.createElement('input'),
      hi = document.createElement('input');
    for (const [el, key] of [
      [lo, 'min'],
      [hi, 'max'],
    ]) {
      el.type = 'number';
      el.className = 'morph-route-inline-number morph-route-compound-number';
      el.step = String(window.SomataParameterMatrix?.stepFor?.(def)?.step || def.step || 'any');
      if (Number.isFinite(Number(def.min))) el.min = String(def.min);
      if (Number.isFinite(Number(def.max))) el.max = String(def.max);
      el.value = Number.isFinite(Number(binding[key])) ? String(binding[key]) : '';
      el.setAttribute('aria-label', `${label || def.label}: ${key === 'min' ? 'минимум' : 'максимум'}`);
    }
    const sep = document.createElement('span');
    sep.className = 'morph-route-inline-range-sep';
    sep.textContent = '—';
    const commit = () => commitOrangeMorphBindingRange(def.id, lo, hi);
    lo.addEventListener('change', commit);
    hi.addEventListener('change', commit);
    range.append(lo, sep, hi);
    wrap.appendChild(range);
  }
  row.appendChild(wrap);
  return wrap;
}
function commitOrangeMorphBindingRange(paramId, lo, hi) {
  let a = Number(lo.value),
    b = Number(hi.value);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return;
  if (a > b) [a, b] = [b, a];
  if (
    window.SomataOrangeMorphProfiles?.setRange?.(
      state.minimalMorph,
      state.randomOptions,
      state.randomLayerCount,
      paramId,
      a,
      b,
    ) !== true
  )
    return;
  lo.value = String(a);
  hi.value = String(b);
  syncOrangeMorphProfileDirtyUI();
  if (runtimeState.minimalMorph?.active === true) activeRebaseMinimalMorphing?.();
  requestMainCanvasRender();
}
function appendOrangeBindingSpecificControls(row, def) {
  if (def.id === 'layer.strokeColor') {
    appendOrangePaletteSelector(row);
    appendMorphInlineCheck(
      row,
      'randomCyclePalettes',
      'Менять палитру каждый цикл',
      'morph-route-compact-check',
    );
    appendMorphInlineCheck(
      row,
      'randomSyncPalettes',
      'Синхронизировать между морфингами',
      'morph-route-compact-check',
    );
  } else if (def.id === 'layer.fillColor') {
    appendOrangePaletteSelector(row);
    appendOrangeFillLayersRange(row);
    appendOrangeFillHarmonySelector(row);
  }
  if (def.type === 'enum' && def.ui?.mainId) {
    // A real bound control, not an inert select whose value is lost on the next render.
    appendMorphInlineSelect(row, def.ui.mainId, 'Значение');
  }

  if (def.id === 'spiral.fillEnabled')
    appendOrangeCompoundBindingControl(row, 'spiral.fillType', 'Настраивать тип заливки спирали');
  for (const childId of morphCompoundChildren(def.id)) {
    if (morphAlwaysOnMultiplier(childId)) {
      // Neutral authored multiplier shared by both Morph editors.
      appendMorphAlwaysOnMultiplierControl(row, childId, MORPH_COMPOUND_CHILD_LABELS[childId] || '');
    } else appendOrangeCompoundBindingControl(row, childId, MORPH_COMPOUND_CHILD_LABELS[childId] || '');
  }
}
function appendOrangeSpiralRow(host, kind) {
  const def = window.SomataParameterMatrix.special.find((d) => d.kind === kind);
  if (!def || !orangeSpecialRowPresent(def.id)) return;
  const layout = window.SomataParameterMatrix.rowLayout(def.id);
  const row = document.createElement('div');
  row.className =
    'audio-route-row morph-route-row morph-binding-row morph-special-config-row orange-route-row';
  row.dataset.orangeSpecial = kind;
  row.dataset.parameterId = def.id;
  const handle = document.createElement('span');
  handle.className = 'morph-route-drag-handle morph-route-drag-placeholder';
  handle.textContent = '·';
  row.appendChild(handle);
  const cb = morphRowCheckbox(row, orangeSpecialParameterEnabled(def.id), (on) =>
    setOrangeSpecialRowActive(def.id, on),
  );
  cb.setAttribute('aria-label', def.label);
  row.appendChild(createMorphRoutingGroupIcon(def.group, true));
  const picker = document.createElement('div');
  picker.className = 'audio-param-picker morph-route-compact-picker morph-spiral-picker';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'audio-param-picker-button';
  btn.textContent = layout.label;
  btn.title = `${def.group} › ${def.label}`;
  btn.setAttribute('aria-haspopup', 'true');
  const menu = document.createElement('div');
  menu.className = 'audio-param-menu hidden';
  menu.dataset.orangeBindingMenu = '1';
  btn.addEventListener('click', (event) => {
    event.stopPropagation();
    document.querySelectorAll('.audio-param-menu').forEach((m) => {
      if (m !== menu) m.classList.add('hidden');
    });
    menu.classList.toggle('hidden');
    btn.setAttribute('aria-expanded', String(!menu.classList.contains('hidden')));
    if (menu.classList.contains('hidden')) return;
    buildMorphParameterMenu(menu, def.id, (nextId) => {
      menu.classList.add('hidden');
      btn.setAttribute('aria-expanded', 'false');
      if (nextId !== def.id) replaceOrangeParameterBinding(def.id, nextId);
    });
    positionViewportPopup(menu, btn);
  });
  picker.append(btn, menu);
  row.appendChild(picker);
  const controls = document.createElement('div');
  controls.className = 'morph-spiral-compact-controls';
  const ro = state.randomOptions || (state.randomOptions = {});
  for (const field of layout.fields) {
    const wrap = document.createElement('span');
    wrap.className = 'morph-special-config-range morph-spiral-compact-range';
    const caption = document.createElement('span');
    caption.textContent = field.label;
    wrap.appendChild(caption);
    const makeInput = (key, value) => {
      const el = document.createElement('input');
      el.type = 'number';
      el.className = 'morph-route-inline-number';
      el.min = String(field.kind === 'range' ? field.limitMin : field.min);
      el.max = String(field.kind === 'range' ? field.limitMax : field.max);
      el.step = '1';
      el.value = String(value);
      el.dataset.orangeSpiralField = key;
      el.setAttribute('aria-label', `${def.label}: ${key}`);
      return el;
    };
    if (field.kind === 'range') {
      const a = makeInput(field.min, ro[field.min] ?? (field.min === 'spiralOrderMin' ? -1 : 0));
      const b = makeInput(field.max, ro[field.max] ?? 1);
      const sep = document.createElement('span');
      sep.textContent = '—';
      const commit = () => {
        const low = Number(field.limitMin),
          high = Number(field.limitMax);
        let lo = Math.max(low, Math.min(high, Math.round(Number(a.value) || 0)));
        let hi = Math.max(low, Math.min(high, Math.round(Number(b.value) || 0)));
        if (lo > hi) [lo, hi] = [hi, lo];
        a.value = String(lo);
        b.value = String(hi);
        ro[field.min] = lo;
        ro[field.max] = hi;
        commitOrangeSpiralOptions();
      };
      a.addEventListener('change', commit);
      b.addEventListener('change', commit);
      wrap.append(a, sep, b);
    } else {
      const input = makeInput(field.key, ro[field.key] ?? 50);
      input.addEventListener('change', () => {
        const n = Math.max(
          Number(field.min),
          Math.min(Number(field.max), Math.round(Number(input.value) || 0)),
        );
        input.value = String(n);
        ro[field.key] = n;
        commitOrangeSpiralOptions();
      });
      wrap.appendChild(input);
      if (field.unit) {
        const unit = document.createElement('span');
        unit.textContent = field.unit;
        wrap.appendChild(unit);
      }
    }
    controls.appendChild(wrap);
  }
  appendSpecialLayerCoverage(controls, 'orange', def.id);
  row.appendChild(controls);
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'audio-route-remove morph-binding-remove';
  remove.textContent = '×';
  remove.title = 'Отключить ' + def.label;
  remove.addEventListener('click', () => setOrangeSpecialParameterEnabled(def.id, false));
  row.appendChild(remove);
  appendOrangeRowFold(row, def.id);
  host.appendChild(row);
}
function commitOrangeSpiralOptions() {
  window.SomataOrangeMorphProfiles?.captureDraft?.(
    state.minimalMorph,
    state.randomOptions,
    state.randomLayerCount,
  );
  syncOrangeMorphProfileDirtyUI();
  syncRandomSettingsUI();
  if (runtimeState.minimalMorph?.active) activeRebaseMinimalMorphing?.();
  requestMainCanvasRender();
}
function appendOrangeSpecialRow(host, kind) {
  const spec = window.SomataParameterMatrix?.special?.find((d) => d.kind === kind);
  if (!spec) return;
  if (kind === 'chaos' && !orangeSpecialRowPresent(spec.id)) return;
  if (kind === 'spiralLayers' || kind === 'spiralOrder') {
    appendOrangeSpiralRow(host, kind);
    return;
  }
  if (kind === 'shape' && !orangeSpecialRowPresent(spec.id)) return;
  const row = document.createElement('div');
  row.className =
    'audio-route-row morph-route-row morph-binding-row morph-special-config-row orange-route-row';
  row.dataset.orangeSpecial = kind;
  row.dataset.parameterId = spec.id;
  const handle = document.createElement('span');
  handle.className = 'morph-route-drag-handle morph-route-drag-placeholder';
  handle.textContent = '·';
  row.appendChild(handle);
  const cb = morphRowCheckbox(row, orangeSpecialParameterEnabled(spec.id), (on) =>
    setOrangeSpecialRowActive(spec.id, on),
  );
  cb.setAttribute('aria-label', spec.label);
  row.appendChild(createMorphRoutingGroupIcon(spec.group, true));
  const label = document.createElement('div');
  label.className = 'morph-special-config-name';
  label.textContent = spec.label;
  row.appendChild(label);
  const proxied = (id, value, isCheck = false) => {
    const control = document.getElementById(id);
    if (!control) return;
    if (isCheck) control.checked = value === true;
    else control.value = String(value);
    control.dispatchEvent(new Event('change', { bubbles: true }));
    renderOrangeMorphRoutingGroups();
  };
  if (kind === 'shape') {
    const select = document.createElement('label');
    select.className = 'morph-route-inline-control morph-route-inline-select';
    const text = document.createElement('span');
    text.textContent = 'Семейство формы';
    const input = document.createElement('select');
    const source = document.getElementById('minimalMorphFamily');
    for (const option of source?.options || []) {
      const o = document.createElement('option');
      o.value = option.value;
      o.textContent = option.textContent;
      input.appendChild(o);
    }
    input.value = source?.value || 'mix';
    input.addEventListener('change', () => proxied('minimalMorphFamily', input.value));
    select.append(text, input);
    row.appendChild(select);
    const ids = [
      ['minimalMorphProfileGroupStandard', 'Стандарт'],
      ['minimalMorphProfileGroupClosed', 'Замкнутые'],
      ['minimalMorphProfileGroupLoops', 'С петлями'],
      ['minimalMorphProfileGroupOpen', 'Разомкнутые'],
      ['minimalMorphProfileGroupMandala', 'Мандала'],
    ];
    const details = document.createElement('details');
    details.className = 'morph-profile-group-dropdown morph-shape-route-profile-dropdown';
    const summary = document.createElement('summary');
    summary.textContent = 'Наборы профилей';
    details.appendChild(summary);
    const menu = document.createElement('div');
    menu.className = 'morph-profile-group-menu';
    for (const [id, name] of ids) {
      const source = document.getElementById(id);
      const label = document.createElement('label');
      label.className = 'morph-profile-group-check';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = source?.checked === true;
      cb.addEventListener('change', () => proxied(id, cb.checked, true));
      const t = document.createElement('span');
      t.textContent = name;
      label.append(cb, t);
      menu.appendChild(label);
    }
    details.appendChild(menu);
    row.appendChild(details);
  }
  if (kind === 'spiralLayers') {
    for (const [id, text] of [
      ['randomSpiralLayersMin', 'От'],
      ['randomSpiralLayersMax', 'До'],
    ]) {
      const source = document.getElementById(id),
        wrap = document.createElement('label');
      wrap.className = 'morph-route-inline-control';
      const caption = document.createElement('span');
      caption.textContent = text;
      const input = document.createElement('input');
      input.type = 'number';
      input.className = 'morph-route-inline-number';
      input.min = '0';
      input.max = '8';
      input.step = '1';
      input.value = source?.value || '0';
      input.addEventListener('change', () => proxied(id, input.value));
      wrap.append(caption, input);
      row.appendChild(wrap);
    }
  }
  if (kind === 'chaos') {
    for (const [key, label, max] of [
      ['chaosStepSpread', 'Разброс шага ±', 120],
      ['chaosClosuresMax', 'Замыканий до', 120],
    ]) {
      const wrap = document.createElement('label');
      wrap.className = 'morph-route-inline-control';
      const span = document.createElement('span');
      span.textContent = label;
      const input = document.createElement('input');
      input.type = 'number';
      input.className = 'morph-route-inline-number';
      input.min = '0';
      input.max = String(max);
      input.step = '1';
      input.value = String(
        Math.max(
          0,
          Math.min(max, Number(state.randomOptions?.[key] ?? (key === 'chaosStepSpread' ? 1 : 3)) || 0),
        ),
      );
      input.addEventListener('change', () => {
        const value = Math.max(0, Math.min(max, Math.round(Number(input.value) || 0)));
        input.value = String(value);
        state.randomOptions[key] = value;
        window.SomataOrangeMorphProfiles?.captureDraft?.(
          state.minimalMorph,
          state.randomOptions,
          state.randomLayerCount,
        );
        syncOrangeMorphProfileDirtyUI();
        if (runtimeState.minimalMorph?.active) activeRebaseMinimalMorphing?.();
      });
      wrap.append(span, input);
      row.appendChild(wrap);
    }
  }
  appendSpecialLayerCoverage(row, 'orange', spec.id);
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'audio-route-remove morph-binding-remove';
  remove.textContent = '×';
  remove.title = 'Отключить ' + spec.label;
  remove.addEventListener('click', () => setOrangeSpecialParameterEnabled(spec.id, false));
  row.appendChild(remove);
  appendOrangeRowFold(row, spec.id);
  host.appendChild(row);
}
// On a phone every Orange row can be folded to its header (name + on/off + remove). The state is kept by
// parameter id so a re-render does not reopen everything. The button is hidden on desktop by CSS.
const orangeRowExpanded = new Set();
function appendOrangeRowFold(row, key) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'morph-row-fold';
  btn.setAttribute('aria-label', 'Свернуть или развернуть настройки параметра');
  const sync = () => {
    const open = orangeRowExpanded.has(key);
    row.classList.toggle('morph-row-expanded', open);
    btn.setAttribute('aria-expanded', String(open));
    btn.textContent = open ? '▾' : '▸';
  };
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (orangeRowExpanded.has(key)) orangeRowExpanded.delete(key);
    else orangeRowExpanded.add(key);
    sync();
  });
  sync();
  row.insertBefore(btn, row.querySelector(':scope > .morph-binding-remove'));
}
function renderOrangeMorphBindings() {
  const host = document.getElementById('orangeMorphBindings');
  if (!host) return;
  document
    .querySelectorAll('#audioViewportPopupPortal .audio-param-menu[data-orange-binding-menu="1"]')
    .forEach((m) => m.remove());
  host.innerHTML = '';
  appendOrangeSpecialRow(host, 'shape');
  appendOrangeOrbitCountControl(host);
  appendOrangeSpecialRow(host, 'chaos');
  appendOrangeSpecialRow(host, 'spiralLayers');
  appendOrangeSpecialRow(host, 'spiralOrder');
  const defs = new Map(
    (window.SomataParameterRegistry?.sharedRoutingDefinitions?.() || []).map((d) => [d.id, d]),
  );
  const bindings = getOrangeMorphBindings(),
    visibleIds = new Set(bindings.map((b) => b.parameter));
  for (const binding of bindings) {
    const def = defs.get(binding.parameter);
    if (!def) continue;
    const parentId = morphCompoundParentId(def.id);
    if (parentId && visibleIds.has(parentId)) continue;
    if (def.id === 'spiral.stepLinked' && visibleIds.has('spiral.step')) continue;
    if (def.id === 'spiral.fillType' && visibleIds.has('spiral.fillEnabled')) continue;
    const row = document.createElement('div');
    row.className =
      'audio-route-row morph-route-row morph-binding-row orange-route-row' +
      (binding.enabled === false ? ' disabled' : '');
    row.dataset.orangeParam = def.id;
    const handle = document.createElement('span');
    handle.className = 'morph-route-drag-handle morph-route-drag-placeholder';
    handle.textContent = '·';
    handle.title = 'Orange генерирует статичное состояние';
    row.appendChild(handle);
    morphRowCheckbox(
      row,
      binding.enabled !== false,
      (on) => setOrangeParameterRouteActive(def.id, on),
      'Включить / выключить параметр в генерации Orange',
    );
    row.appendChild(createMorphRoutingGroupIcon(morphUiGroup(def), true));
    const picker = document.createElement('div');
    picker.className = 'audio-param-picker morph-route-compact-picker orange-route-picker';
    const pickBtn = document.createElement('button');
    pickBtn.type = 'button';
    pickBtn.className = 'audio-param-picker-button';
    pickBtn.textContent = def.label;
    pickBtn.title = `${morphUiGroup(def)} › ${def.label}`;
    const menu = document.createElement('div');
    menu.className = 'audio-param-menu hidden';
    menu.dataset.orangeBindingMenu = '1';
    pickBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      document.querySelectorAll('.audio-param-menu').forEach((m) => {
        if (m !== menu) m.classList.add('hidden');
      });
      menu.classList.toggle('hidden');
      if (!menu.classList.contains('hidden')) {
        buildMorphParameterMenu(menu, def.id, (nextId) => {
          if (nextId !== def.id) replaceOrangeParameterBinding(def.id, nextId);
          menu.classList.add('hidden');
        });
        positionViewportPopup(menu, pickBtn);
      }
    });
    picker.append(pickBtn, menu);
    row.appendChild(picker);
    const numeric =
      ['number', 'integer', 'angle', 'multiplier'].includes(def.type) || def.id === 'outline.color';
    if (numeric) {
      appendSharedMorphBindingRange(
        row,
        def,
        binding,
        (lo, hi) => commitOrangeMorphBindingRange(def.id, lo, hi),
        (key) => (Number.isFinite(Number(binding[key])) ? binding[key] : defaultMorphBindingRange(def)[key]),
      );
    }
    appendMorphLayerCoverage(row, binding, (percent) => {
      window.SomataOrangeMorphProfiles?.setCoverage?.(
        state.minimalMorph,
        state.randomOptions,
        state.randomLayerCount,
        def.id,
        percent,
      );
      syncOrangeMorphProfileDirtyUI();
      if (runtimeState.minimalMorph?.active === true) activeRebaseMinimalMorphing?.();
      requestMainCanvasRender();
    });
    appendOrangeBindingSpecificControls(row, def);
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'audio-route-remove morph-binding-remove';
    close.textContent = '×';
    close.title = 'Убрать параметр из профиля Orange';
    close.addEventListener('click', () => removeOrangeParameterBinding(def.id));
    row.appendChild(close);
    appendOrangeRowFold(row, def.id);
    host.appendChild(row);
  }
  if (!host.children.length) {
    const empty = document.createElement('div');
    empty.className = 'hint-text orange-routing-empty';
    empty.textContent = 'Связей нет. Добавьте параметр через группы выше или ПКМ по параметру слева.';
    host.appendChild(empty);
  }
}
function closeOrangeRoutingMenus() {
  document
    .querySelectorAll('.audio-route-group-menu[data-orange-routing-group-menu="1"]')
    .forEach((m) => m.classList.add('hidden'));
  orangeMorphOpenGroup = '';
}
function orangeSpecialRowKind(id) {
  return window.SomataParameterMatrix.special.find((def) => def.id === id)?.kind || null;
}
function orangeSpecialRowPresent(id) {
  const kind = orangeSpecialRowKind(id);
  return !!kind && morphSpecialRowPresence('orange', kind, orangeSpecialParameterEnabled(id));
}
function orangeSpecialParameterEnabled(id) {
  const ro = state.randomOptions || {};
  if (id === 'geometry.orbits') return orangeFillOptions().orbitBindingEnabled !== false;
  if (id === 'geometry.shape') return ro.byShape === true;
  if (id === 'geometry.chaos') return ro.chaosStar === true;
  if (id === 'spiral.layers') return ro.bySpiralLayers === true;
  if (id === 'spiral.order') return ro.bySpiralOrder === true;
  return false;
}
function setOrangeSpecialParameterEnabled(id, on, { retainPresence = false } = {}) {
  const kind = orangeSpecialRowKind(id);
  if (!kind) return false;
  setMorphSpecialRowPresence('orange', kind, retainPresence === true || on === true);
  if (id === 'geometry.orbits') {
    const ro = orangeFillOptions();
    ro.orbitBindingEnabled = on === true;
  } else if (id === 'geometry.shape') state.randomOptions.byShape = on === true;
  else if (id === 'geometry.chaos') state.randomOptions.chaosStar = on === true;
  else if (id === 'spiral.layers') state.randomOptions.bySpiralLayers = on === true;
  else if (id === 'spiral.order') state.randomOptions.bySpiralOrder = on === true;
  else return false;
  window.SomataOrangeMorphProfiles?.captureDraft?.(
    state.minimalMorph,
    state.randomOptions,
    state.randomLayerCount,
  );
  syncRandomSettingsUI();
  syncOrangeMorphProfileDirtyUI();
  renderOrangeMorphRoutingGroups();
  // Rebuild the special rows *after* an add/remove. In particular × must
  // physically remove the orbit row; re-adding restores its editor.
  if (runtimeState.minimalMorph?.active) activeRebaseMinimalMorphing?.();
  requestMainCanvasRender();
  return true;
}
function setOrangeSpecialRowActive(id, on) {
  // Checkbox changes the active state, not the row's presence. This
  // flag must be set BEFORE captureDraft so profile persistence keeps
  // disabled-but-added rows after save and reload.
  const result = setOrangeSpecialParameterEnabled(id, on, { retainPresence: true });
  syncMorphRouteDecorations();
  return result;
}
function renderOrangeMorphRoutingGroups() {
  const host = document.getElementById('orangeMorphRoutingGroups');
  if (!host) return;
  document
    .querySelectorAll('#audioViewportPopupPortal .audio-route-group-menu[data-orange-routing-group-menu="1"]')
    .forEach((m) => m.remove());
  host.innerHTML = '';
  const defs = window.SomataParameterMatrix.all(),
    groups = [];
  for (const d of defs) {
    const g = morphUiGroup(d);
    if (g && !groups.includes(g)) groups.push(g);
  }
  const activeBindings = getOrangeMorphBindings(),
    byId = new Map(activeBindings.map((b) => [b.parameter, b]));
  for (const group of groups) {
    const groupDefs = defs.filter((d) => morphUiGroup(d) === group),
      added = groupDefs.filter((d) => (d.kind ? orangeSpecialRowPresent(d.id) : byId.has(d.id))),
      activeCount = added.filter((d) =>
        d.kind ? orangeSpecialParameterEnabled(d.id) : byId.get(d.id)?.enabled !== false,
      ).length;
    const wrap = document.createElement('div');
    wrap.className = 'audio-route-group';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'audio-route-group-btn';
    btn.dataset.orangeGroup = group;
    if (added.length) btn.classList.add(activeCount ? 'morph-group-active' : 'morph-group-idle');
    appendMorphGroupLabel(btn, group, true);
    btn.title = added.length
      ? `${group}: ${activeCount}/${added.length} активно · ПКМ — переключить добавленные`
      : `${group}: выберите параметры`;
    const menu = document.createElement('div');
    menu.className = 'audio-route-group-menu hidden';
    menu.dataset.orangeRoutingGroupMenu = '1';
    menu.dataset.orangeGroup = group;
    const renderMenu = () => {
      menu.innerHTML = '';
      for (const def of groupDefs) {
        const special = !!def.kind;
        const st = special
          ? { active: orangeSpecialParameterEnabled(def.id) }
          : orangeParameterRoutingState(def.id);
        const x = document.createElement('button');
        x.type = 'button';
        x.className = 'audio-param-option' + (st.active ? ' active' : '');
        x.dataset.parameterId = def.id;
        x.textContent = `${st.active ? '✓ ' : ''}${def.label}`;
        x.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          orangeMorphOpenGroup = group;
          if (special) setOrangeSpecialRowActive(def.id, !st.active);
          else setOrangeParameterRouteActive(def.id, !st.active);
        });
        menu.appendChild(x);
      }
    };
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = orangeMorphOpenGroup !== group || menu.classList.contains('hidden');
      document
        .querySelectorAll('.audio-route-group-menu[data-orange-routing-group-menu="1"]')
        .forEach((m) => {
          if (m !== menu) m.classList.add('hidden');
        });
      orangeMorphOpenGroup = open ? group : '';
      menu.classList.toggle('hidden', !open);
      if (open) {
        renderMenu();
        positionViewportPopup(menu, btn);
      }
    });
    btn.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!added.length) return;
      const on = activeCount === 0;
      for (const def of added) {
        if (def.kind) setOrangeSpecialRowActive(def.id, on);
        else setOrangeParameterRouteActive(def.id, on);
      }
    });
    wrap.append(btn, menu);
    host.appendChild(wrap);
    if (orangeMorphOpenGroup === group && btn.isConnected) {
      renderMenu();
      menu.classList.remove('hidden');
      positionViewportPopup(menu, btn);
    }
  }
  if (!document.documentElement.dataset.orangeRoutingOutsideBound) {
    document.documentElement.dataset.orangeRoutingOutsideBound = '1';
    document.addEventListener(
      'pointerdown',
      (e) => {
        const open = [
          ...document.querySelectorAll(
            '.audio-route-group-menu[data-orange-routing-group-menu="1"]:not(.hidden)',
          ),
        ];
        if (
          !open.length ||
          open.some((m) => m.contains(e.target)) ||
          e.target?.closest?.('#orangeMorphRoutingGroups .audio-route-group-btn')
        )
          return;
        closeOrangeRoutingMenus();
      },
      true,
    );
  }
  renderOrangeMorphBindings();
}
function syncOrangeMorphProfileUI() {
  const store = window.SomataOrangeMorphProfiles;
  if (!store) return;
  const profiles = ensureOrangeMorphProfiles(),
    profile = getActiveOrangeMorphProfile(),
    select = document.getElementById('orangeMorphProfileSelect');
  if (select) {
    const old = select.value;
    select.innerHTML = '';
    for (const p of profiles) {
      const o = document.createElement('option');
      o.value = p.id;
      o.textContent = morphProfileDisplayName(p);
      select.appendChild(o);
    }
    select.value = profile?.id || old || 'orange-standard';
  }
  const del = document.getElementById('btnDeleteOrangeMorphProfile'),
    ren = document.getElementById('btnRenameOrangeMorphProfile');
  if (del) del.disabled = profile?.system === true;
  if (ren) ren.disabled = profile?.system === true || profile?.transient === true;
  const master = document.getElementById('btnOrangeMorphMasterMode');
  if (master) {
    master.classList.add('active');
    master.setAttribute('aria-pressed', 'true');
    master.disabled = false;
  }
  renderOrangeMorphRoutingGroups();
  syncOrangeMorphProfileDirtyUI();
}
function switchOrangeMorphProfile(id) {
  const store = window.SomataOrangeMorphProfiles;
  if (!store) return null;
  const wasRunning = runtimeState.minimalMorph?.active === true;
  const p = store.select(state.minimalMorph, state.randomOptions, orangeProfileLayerCountHolder(), id);
  syncOrangeGeneratorFlagsFromBindings();
  syncRandomSettingsUI();
  syncOrangeMorphProfileUI();
  if (wasRunning) activeRebaseMinimalMorphing?.();
  requestMainCanvasRender();
  return p;
}
function saveCurrentOrangeMorphProfile() {
  const store = window.SomataOrangeMorphProfiles,
    profile = getActiveOrangeMorphProfile();
  if (!store || !profile) return null;
  let name = null;
  if (profile.transient === true) {
    name = (window.prompt?.('Название профиля Orange', '') || '').trim();
    if (!name) return null;
  }
  const saved = store.save(state.minimalMorph, state.randomOptions, state.randomLayerCount, name);
  if (!saved) return null;
  syncOrangeMorphProfileUI();
  return saved;
}
async function createNewOrangeMorphProfile() {
  const store = window.SomataOrangeMorphProfiles;
  if (!store) return null;
  const current = getActiveOrangeMorphProfile();
  if (current?.transient === true) {
    const action = await askTransientMorphProfileDecision('orange');
    if (action === 'cancel') return null;
    if (action === 'save') {
      if (!saveCurrentOrangeMorphProfile()) return null;
    } else if (action === 'discard') {
      store.remove(state.minimalMorph, state.randomOptions, orangeProfileLayerCountHolder(), current.id);
    }
  }
  const was = runtimeState.minimalMorph?.active === true;
  if (was) activeStopMinimalMorphing(false);
  const created = store.create(state.minimalMorph, state.randomOptions, orangeProfileLayerCountHolder(), '');
  syncRandomSettingsUI();
  syncOrangeMorphProfileUI();
  // A blank Orange editor must not immediately generate a new composition.
  requestMainCanvasRender();
  return created;
}
function installOrangeMorphHeaderLayout() {
  const panel = document.getElementById('randomSettingsPanel');
  if (!panel || panel.dataset.orangeHeaderReady === '1') return;
  panel.dataset.orangeHeaderReady = '1';
  panel.classList.add('orange-unified-header');
  const toolbar = panel.querySelector('.orange-profile-toolbar');
  const routing = panel.querySelector('.orange-routing-shell');
  if (!toolbar || !routing) return;
  toolbar.classList.add('audio-routing-preset-bar', 'morph-routing-preset-bar');
  const defaultInput = document.getElementById('minimalMorphDefaultActive');
  if (defaultInput) {
    const flag = document.createElement('label');
    flag.className = 'morph-profile-toolbar-check';
    flag.title = 'Автоматически запускать оранжевый морфинг в проекте';
    flag.append(defaultInput, document.createTextNode('По умолчанию'));
    const flags = document.createElement('div');
    flags.className = 'morph-profile-toolbar-flags';
    flags.appendChild(flag);
    toolbar.appendChild(flags);
  }
  const timing = document.createElement('div');
  timing.id = 'orangeMorphHeaderTiming';
  timing.className = 'morph-speed-toolbar orange-header-timing';
  const cycle = document.createElement('div');
  cycle.className = 'morph-setting-row interval-row morph-top-cycle-row orange-top-cycle-row';
  const title = document.createElement('span');
  title.textContent = 'Период цикла';
  const controls = document.createElement('span');
  controls.className = 'morph-cycle-controls';
  const auto = document.getElementById('minimalMorphAutoBadge');
  if (auto) controls.appendChild(auto);
  const multi = document.createElement('input');
  multi.id = 'minimalMorphIntervalMultiplier';
  multi.className = 'morph-interval';
  multi.type = 'number';
  multi.min = '0.015625';
  multi.max = '64';
  multi.step = 'any';
  multi.value = String(state.minimalMorph?.intervalMultiplier || 1);
  multi.dataset.binaryMultiplier = '1';
  multi.style.width = '58px';
  multi.setAttribute('aria-label', 'Множитель периода Orange');
  multi.title = 'Множитель периода Orange: ×2 или ÷2';
  controls.appendChild(multi);
  const times = document.createElement('span');
  times.className = 'morph-multiplier-label';
  times.textContent = '×';
  controls.appendChild(times);
  const interval = document.getElementById('minimalMorphInterval');
  if (interval) {
    interval.max = '120';
    controls.appendChild(interval);
  }
  const seconds = document.createElement('span');
  seconds.className = 'morph-sec';
  seconds.textContent = 'с';
  controls.appendChild(seconds);
  for (const secondsValue of [1, 2, 3, 5, 8, 15]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'morph-quick-btn';
    button.dataset.orangeInterval = String(secondsValue);
    button.textContent = secondsValue + 's';
    button.addEventListener('click', () => {
      state.tapTempo.syncMinimalMorph = false;
      state.minimalMorph.intervalSec = secondsValue;
      if (interval) interval.value = String(secondsValue);
      interval?.dispatchEvent(new Event('change', { bubbles: true }));
      syncTapTimingIndicators();
      if (runtimeState.minimalMorph?.active && !runtimeState.minimalMorph.transitioning)
        runtimeState.minimalMorph.nextSwitchAt =
          performance.now() + getTapMorphIntervalSec(secondsValue, 'minimal') * 1000;
      window.SomataOrangeMorphProfiles?.captureDraft?.(
        state.minimalMorph,
        state.randomOptions,
        state.randomLayerCount,
      );
      syncOrangeMorphProfileDirtyUI();
      document
        .querySelectorAll('[data-orange-interval]')
        .forEach((b) => b.classList.toggle('active', Number(b.dataset.orangeInterval) === secondsValue));
    });
    controls.appendChild(button);
  }
  cycle.append(title, controls);
  timing.appendChild(cycle);
  const extras = document.createElement('div');
  extras.className = 'orange-header-basics';
  for (const id of ['randomLayerCount', 'minimalMorphInstant', 'minimalMorphFade']) {
    const el = document.getElementById(id),
      row = el?.closest('.morph-setting-row');
    if (row) extras.appendChild(row);
  }
  timing.appendChild(extras);
  toolbar.after(timing);
  multi.addEventListener('input', () => {
    const v = Number(multi.value);
    state.minimalMorph.intervalMultiplier = Number.isFinite(v) ? Math.max(0.015625, Math.min(64, v)) : 1;
    if (runtimeState.minimalMorph?.active && !runtimeState.minimalMorph.transitioning)
      runtimeState.minimalMorph.nextSwitchAt =
        performance.now() + getTapMorphIntervalSec(state.minimalMorph.intervalSec, 'minimal') * 1000;
    window.SomataOrangeMorphProfiles?.captureDraft?.(
      state.minimalMorph,
      state.randomOptions,
      state.randomLayerCount,
    );
    syncOrangeMorphProfileDirtyUI();
  });
  multi.addEventListener('change', () => {
    multi.value = formatDisplayNumber(getMorphIntervalMultiplier('minimal'), 6);
  });
  const old = panel.querySelector('.orange-fixed-settings');
  if (old) old.classList.add('orange-compat-hidden');
  panel.querySelector('.morph-settings-note')?.classList.add('orange-compat-hidden');
  const add = document.createElement('button');
  add.id = 'btnAddOrangeMorphParameter';
  add.type = 'button';
  add.className = 'audio-routing-add';
  add.textContent = '＋ Добавить связь';
  const picker = document.createElement('div');
  picker.id = 'orangeMorphParameterPicker';
  picker.className = 'audio-param-menu hidden';
  picker.dataset.orangeAddMenu = '1';
  // A portaled popup lives outside the Orange panel in the DOM. Keep its
  // own option clicks from reaching the global close-on-outside handler.
  picker.addEventListener('click', (e) => e.stopPropagation());
  picker.addEventListener('pointerdown', (e) => e.stopPropagation());
  add.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    picker.classList.toggle('hidden');
    if (!picker.classList.contains('hidden')) {
      buildMorphParameterMenu(picker, '', (id) => {
        const def = window.SomataParameterMatrix?.get?.(id);
        if (!def) return;
        if (def.kind) setOrangeSpecialParameterEnabled(id, true);
        else setOrangeParameterRouteActive(id, true);
        picker.classList.add('hidden');
      });
      positionViewportPopup(picker, add);
    }
  });
  routing.append(add, picker);
}
function setupOrangeMorphProfileUI() {
  const store = window.SomataOrangeMorphProfiles,
    panel = document.getElementById('randomSettingsPanel');
  if (!store || !panel || panel.dataset.orangeProfilesReady === '1') return;
  panel.dataset.orangeProfilesReady = '1';
  installOrangeMorphHeaderLayout();
  ensureOrangeMorphProfiles();
  markOrangeFixedRows();
  renderOrangeMorphRoutingGroups();
  document
    .getElementById('orangeMorphProfileSelect')
    ?.addEventListener('change', (e) => switchOrangeMorphProfile(e.target.value));
  document.getElementById('btnNewOrangeMorphProfile')?.addEventListener('click', () => {
    createNewOrangeMorphProfile();
  });
  document.getElementById('btnRenameOrangeMorphProfile')?.addEventListener('click', () => {
    const p = getActiveOrangeMorphProfile();
    if (!p || p.system) return;
    const name = (window.prompt?.('Новое название профиля Orange', p.name) || '').trim();
    if (name && store.rename(state.minimalMorph, state.randomOptions, state.randomLayerCount, p.id, name))
      syncOrangeMorphProfileUI();
  });
  document.getElementById('btnDeleteOrangeMorphProfile')?.addEventListener('click', () => {
    const p = getActiveOrangeMorphProfile();
    if (!p || p.system) return;
    if (window.confirm?.(`Удалить профиль «${p.name}»?`) === false) return;
    store.remove(state.minimalMorph, state.randomOptions, orangeProfileLayerCountHolder(), p.id);
    syncRandomSettingsUI();
    syncOrangeMorphProfileUI();
  });
  document.getElementById('btnSaveOrangeMorphProfile')?.addEventListener('click', () => {
    saveCurrentOrangeMorphProfile();
  });
  document.getElementById('btnResetOrangeMorphProfile')?.addEventListener('click', () => {
    if (store.isDirty(state.minimalMorph, state.randomOptions, state.randomLayerCount) !== true) return;
    store.reset(state.minimalMorph, state.randomOptions, orangeProfileLayerCountHolder());
    syncRandomSettingsUI();
    syncOrangeMorphProfileUI();
    if (runtimeState.minimalMorph?.active) activeRebaseMinimalMorphing?.();
    requestMainCanvasRender();
  });
  const dirty = (e) => {
    if (!e.target?.closest?.('#randomSettingsPanel')) return;
    if (e.target?.closest?.('.orange-profile-toolbar,.orange-routing-shell')) return;
    syncOrangeMorphProfileDirtyUI();
  };
  panel.addEventListener('input', dirty, false);
  panel.addEventListener('change', dirty, false);
  syncOrangeMorphProfileUI();
}

function setOrangeMorphOpenGroup(value) {
  orangeMorphOpenGroup = value;
  return value;
}

export {
  getOrangeMorphBindings,
  hasOrangeColorRoute,
  normalizeOrangeMorphFamily,
  normalizeOrangeMorphProfileGroup,
  normalizedOrangeMorphProfileGroups,
  orangeFillOptions,
  orangeParameterRoutingState,
  orangeProfileLayerCountHolder,
  orangeSpecialParameterEnabled,
  orangeSpecialRowPresent,
  setOrangeMorphOpenGroup,
  setOrangeParameterRouteActive,
  setOrangeSpecialParameterEnabled,
  setOrangeSpecialRowActive,
  setupOrangeMorphProfileUI,
  syncOrangeMorphModeOptions,
  syncOrangeMorphProfileDirtyUI,
  syncRandomSettingsUI,
};
