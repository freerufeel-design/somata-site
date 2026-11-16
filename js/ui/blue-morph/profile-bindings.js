// Blue Morph: профиль привязок и строки параметров в интерфейсе.
import './parameter-bindings.js'; // initialisation order: this module runs after it
import { ensureLayerEffectState } from '../../core/defaults-layers.js';
import {
  getActivePlaylistPaletteKeys,
  getPlaylistPaletteDisplayName,
  morphPaletteSyncEnabled,
  normalizePlaylistPaletteKey,
  setMorphPaletteForContext,
} from '../../core/palette.js';
import { requestMainCanvasRender } from '../../core/scheduler.js';
import { runtimeState, state } from '../../core/state.js';
import {
  BLUE_MORPH_PARAMETER_BINDINGS,
  MORPH_COMPOUND_CHILD_LABELS,
  attachMorphSliderBubble,
  hideMorphSliderBubble,
  morphAlwaysOnMultiplier,
  morphCompoundChildren,
  morphCompoundParentId,
  morphRowCheckbox,
  morphSpecialActive,
  morphSpecialEnabled,
  morphUiGroup,
  setBlueMorphRangeCss,
  setMorphSpecialEnabled,
  setMorphSpecialRowActive,
  syncBlueMorphParameterDecorations,
} from './parameter-bindings.js';
import { setMorphParameterRouteActive, syncMorphRouteDecorations } from '../parameter-routing-popup.js';
import { getMorphLayerFocus, toggleMorphLayerOff } from './layer-focus.js';
import {
  renderMorphRoutingGroups,
  renderMorphRoutingTargets,
  syncMorphProfileDirtyUI,
  syncMorphProfileUI,
  syncMorphSidebarSettingsFromState,
} from './profiles.js';
import { activeRebaseMinimalMorphing, activeRebaseMorphing } from '../../morph-runtime/morph-hooks.js';
import {
  setOrangeSpecialParameterEnabled,
  syncOrangeMorphProfileDirtyUI,
  syncRandomSettingsUI,
} from '../orange-morph/routing-ui.js';
import { syncMorphSettingsUI } from '../morph-settings-panel.js';
import { positionViewportPopup } from '../floating-panels.js';

let morphProfileUiReady = false;
function ensureMorphProfileState() {
  return window.SomataMorphParameterRouting?.ensureProfiles?.(state.morph, state.minimalMorph) || [];
}
function getActiveMorphProfile() {
  return window.SomataMorphParameterRouting?.activeProfile?.(state.morph, state.minimalMorph) || null;
}
function getActiveMorphBindings(profile = getActiveMorphProfile()) {
  return (
    window.SomataMorphParameterRouting?.workingBindings?.(state.morph, state.minimalMorph, profile) ||
    profile?.bindings ||
    []
  );
}
function getMorphOrderMode(profile = getActiveMorphProfile()) {
  return (
    window.SomataMorphParameterRouting?.workingOrderMode?.(state.morph, state.minimalMorph, profile) ||
    (profile?.orderMode === 'type' ? 'type' : 'free')
  );
}
function getMorphDisplayBindings(profile = getActiveMorphProfile()) {
  const list = getActiveMorphBindings(profile);
  if (getMorphOrderMode(profile) !== 'type') return list;
  return window.SomataMorphParameterRouting?.typeSortedBindings?.(list) || list;
}
function setMorphOrderMode(mode) {
  const routing = window.SomataMorphParameterRouting,
    profile = getActiveMorphProfile();
  if (!routing || !profile || profile.type !== 'standard') return false;
  if (!routing.setWorkingOrderMode?.(state.morph, state.minimalMorph, mode)) return false;
  renderMorphProfileBindings();
  syncMorphOrderModeUI();
  syncMorphProfileDirtyUI?.();
  return true;
}
function syncMorphOrderModeUI() {
  const profile = getActiveMorphProfile(),
    mode = profile?.type === 'standard' ? getMorphOrderMode(profile) : 'free',
    host = document.getElementById('morphOrderMode');
  if (host) host.classList.toggle('hidden', profile?.type !== 'standard');
  document.querySelectorAll('[data-morph-order]').forEach((btn) => {
    const active = profile?.type === 'standard' && btn.dataset.morphOrder === mode;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  const toggle = document.getElementById('btnMorphOrderToggle');
  if (toggle) {
    toggle.textContent = mode === 'type' ? '⇅ По типу' : '↕ Свободно';
    toggle.dataset.mode = mode;
    toggle.classList.toggle('free', mode === 'free');
    toggle.title =
      mode === 'type'
        ? 'Сейчас строки сортируются по типу эффекта · нажмите для свободного порядка'
        : 'Сейчас свободный порядок · нажмите для сортировки по типу';
  }
  const rows = document.getElementById('morphProfileBindings');
  if (rows) {
    rows.dataset.orderMode = mode;
    rows.classList.toggle('morph-order-type', mode === 'type');
    rows.classList.toggle('morph-order-free', mode === 'free');
  }
}
function blueSpecParameterId(spec) {
  return (
    window.SomataParameterRegistry?.all?.().find(
      (def) => def?.ui?.mainId === spec?.mainId && def?.morph?.legacy === true,
    )?.id || null
  );
}
function morphBindingCurrentValue(def) {
  if (!def) return NaN;
  if (def.morph?.frameTarget === 'global') {
    if (def.id === 'tunnel.speed') return (Number(state.tunnel?.speedStrength) || 0) * 100;
    if (def.id === 'tunnel.spacing') return (Number(state.tunnel?.spacingStrength) || 3) * 100;
    if (def.id === 'tunnel.depthCurve') return Number(state.tunnel?.depthCurve) || 0;
    if (def.id === 'tunnel.depthCurveMultiplier')
      return Number.isFinite(Number(state.tunnel?.depthCurveMultiplier))
        ? Number(state.tunnel.depthCurveMultiplier)
        : 1;
    if (def.id.startsWith('ambient.') || def.id.startsWith('prism.'))
      return Number(window.SomataParameterRegistry?.valueAt(state, def.morph?.framePath)) || 0;
    if (def.id === 'tunnel.colorShift') return Number(state.tunnel?.colorShiftDegrees) || 0;
    if (def.id === 'tunnel.vignette') return Number(state.tunnel?.vignetteAmount) || 0;
    if (def.id === 'tunnel.vignetteMultiplier') return Number(state.tunnel?.vignetteMultiplier) || 1;
    if (def.id === 'palette.hueOffset') return Number(state.playlistPaletteHueOffset) || 0;
    if (def.id === 'outline.layerCount')
      return state.lineOutline?.layerCount != null && Number.isFinite(Number(state.lineOutline.layerCount))
        ? Number(state.lineOutline.layerCount)
        : (state.layers || []).length;
    if (def.id === 'outline.width') return Number(state.lineOutline?.width) || 1.5;
    if (def.id === 'outline.mode')
      return Math.max(0, ['outer', 'inner', 'median'].indexOf(state.lineOutline?.mode));
    if (def.id === 'outline.color') return NaN; // Hue-offset range, not the #RRGGBB string
    if (def.id === 'lamps.freezeTailSec') return Number(state.lamps?.freezeTailSec) || 1.5;
    if (def.id === 'lamps.freezeIntensity')
      return Number.isFinite(Number(state.lamps?.freezeIntensity))
        ? Number(state.lamps.freezeIntensity)
        : 100;
    return NaN;
  }
  const layer = state.layers.find((l) => l.id === state.activeLayerId) || state.layers[0];
  if (!layer) return NaN;
  const root = def.morph?.frameTarget === 'layer' ? layer : ensureLayerEffectState(layer);
  const v = window.SomataParameterRegistry?.valueAt?.(root, def.morph?.framePath);
  return Number(v);
}
function defaultMorphBindingRange(def) {
  const currentRaw = morphBindingCurrentValue(def),
    ui = document.getElementById(def?.ui?.mainId),
    numericUi = ui && ['number', 'range'].includes(ui.type),
    uiMin = numericUi && ui.min !== '' ? Number(ui.min) : NaN,
    uiMax = numericUi && ui.max !== '' ? Number(ui.max) : NaN,
    defMin = Number(def?.min),
    defMax = Number(def?.max),
    min = Number.isFinite(uiMin) ? uiMin : defMin,
    max = Number.isFinite(uiMax) ? uiMax : defMax,
    span = Number(def?.audio?.span),
    step = Math.max(1e-9, Number(numericUi ? ui.step : NaN) || Number(def?.step) || 1);
  if (Number.isFinite(currentRaw)) {
    const current = Math.max(
      Number.isFinite(min) ? min : -Infinity,
      Math.min(Number.isFinite(max) ? max : Infinity, currentRaw),
    );
    let delta = Number.isFinite(span) && span > 0 ? span : Math.max(Math.abs(current) * 0.35, step * 4);
    if (
      def?.audio?.mode === 'positiveFactor' ||
      def?.audio?.mode === 'centerFactor' ||
      def?.audio?.mode === 'fadeFactor'
    )
      delta = Math.max(Math.abs(current) * 0.45, delta * 0.25);
    let lo = current - delta,
      hi = current + delta;
    if (Number.isFinite(min)) lo = Math.max(min, lo);
    if (Number.isFinite(max)) hi = Math.min(max, hi);
    if (Math.abs(lo - hi) < 1e-12) {
      if (!Number.isFinite(max) || hi + step <= max) hi += step;
      else lo = Math.max(Number.isFinite(min) ? min : -Infinity, lo - step);
    }
    return { min: lo, max: hi };
  }
  const lo = Number.isFinite(min) ? min : 0,
    hi = Number.isFinite(max) ? max : lo + step;
  return { min: lo, max: hi > lo ? hi : lo + step };
}
function setLegacyMorphBindingEnabled(def, enabled) {
  const cb = document.getElementById(def?.morph?.checkboxId);
  if (!cb) return false;
  if (cb.checked !== enabled) {
    cb.checked = enabled;
    cb.dispatchEvent(new Event('change', { bubbles: true }));
  }
  return true;
}
function setMorphParameterBinding(paramId, enabled) {
  const routing = window.SomataMorphParameterRouting,
    def = window.SomataParameterRegistry?.get?.(paramId),
    profile = getActiveMorphProfile();
  if (
    !routing ||
    !def ||
    def.morph?.supported !== true ||
    def.type === 'boolean' ||
    !profile ||
    profile.type !== 'standard' ||
    morphAlwaysOnMultiplier(paramId)
  )
    return false;
  if (enabled) {
    if (def.morph?.legacy === true) setLegacyMorphBindingEnabled(def, true);
    else {
      const b = routing.addBinding(state.morph, state.minimalMorph, paramId, defaultMorphBindingRange(def));
      if (b) b.enabled = true;
    }
  } else {
    if (def.morph?.legacy === true) setLegacyMorphBindingEnabled(def, false);
    routing.removeBinding(state.morph, state.minimalMorph, paramId);
  }
  routing.syncActiveLegacyBindings(state.morph, state.minimalMorph);
  routing.resetRuntime(runtimeState.morph);
  syncMorphProfileUI();
  syncBlueMorphParameterDecorations();
  if (runtimeState.morph?.active) activeRebaseMorphing?.();
  requestMainCanvasRender();
  return true;
}
function removeMorphParameterBinding(paramId) {
  return setMorphParameterBinding(paramId, false);
}
function setMorphRouteBindingActive(def, binding, enabled) {
  if (!def || !binding) return false;
  const on = enabled === true;
  if (def.morph?.legacy === true) {
    const option = def.morph?.option;
    if (option) {
      state.morph.options = state.morph.options || {};
      state.morph.options[option] = on;
    }
    const cb = document.getElementById(def.morph?.checkboxId);
    if (cb) cb.checked = on;
    binding.enabled = on;
  } else binding.enabled = on;
  return true;
}
function commitMorphRouteActivationChange() {
  const routing = window.SomataMorphParameterRouting;
  routing?.syncActiveLegacyBindings?.(state.morph, state.minimalMorph);
  routing?.resetRuntime?.(runtimeState.morph);
  syncMorphSettingsUI();
  syncBlueMorphParameterDecorations();
  renderMorphProfileBindings();
  renderMorphRoutingTargets();
  renderMorphRoutingGroups();
  syncMorphRouteDecorations();
  if (runtimeState.morph?.active) activeRebaseMorphing?.();
  requestMainCanvasRender();
  syncMorphProfileDirtyUI?.();
}
function renderMorphParameterPicker() {
  const host = document.getElementById('morphParameterOptions'),
    input = document.getElementById('morphParameterSearch');
  if (!host) return;
  const profile = getActiveMorphProfile(),
    q = String(input?.value || '')
      .trim()
      .toLowerCase();
  host.innerHTML = '';
  if (!profile || profile.type !== 'standard') return;
  const active = new Set(
    getActiveMorphBindings(profile)
      .filter((b) => b.enabled !== false)
      .map((b) => b.parameter),
  );
  let last = '';
  for (const def of window.SomataParameterMatrix.all()) {
    const group = morphUiGroup(def),
      hay = `${group} ${def.label} ${def.id}`.toLowerCase();
    if (q && !hay.includes(q)) continue;
    if (group !== last) {
      const title = document.createElement('div');
      title.className = 'morph-param-group-title audio-param-group-title';
      title.textContent = group;
      host.appendChild(title);
      last = group;
    }
    const specialOn = def.kind ? morphSpecialActive(def.kind) : active.has(def.id);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'morph-param-option audio-param-option' + (specialOn ? ' active' : '');
    const title = document.createElement('span');
    title.textContent = def.label;
    const check = document.createElement('small');
    check.textContent = specialOn ? '✓' : '';
    b.append(title, check);
    b.addEventListener('click', () => {
      if (def.kind) setMorphSpecialRowActive(def.kind, !specialOn);
      else setMorphParameterRouteActive(def.id, !specialOn);
    });
    host.appendChild(b);
  }
}
function morphLegacyRangeValue(def, key) {
  const stateKey = key === 'min' ? def?.morph?.minKey : def?.morph?.maxKey;
  const v = Number(state.morph?.[stateKey]);
  if (Number.isFinite(v)) return v;
  const fallback = Number(key === 'min' ? def?.min : def?.max);
  return Number.isFinite(fallback) ? fallback : 0;
}
function commitMorphBindingRange(def, binding, lo, hi) {
  let a = Number(lo.value),
    b = Number(hi.value);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return;
  if (a > b) [a, b] = [b, a];
  lo.value = String(a);
  hi.value = String(b);
  if (def.morph?.legacy === true) {
    const minKey = def.morph?.minKey,
      maxKey = def.morph?.maxKey;
    if (minKey) state.morph[minKey] = a;
    if (maxKey) state.morph[maxKey] = b;
    const spec = BLUE_MORPH_PARAMETER_BINDINGS.find((x) => x.mainId === def.ui?.mainId);
    if (spec) {
      const main = document.getElementById(spec.mainId),
        host = main?.closest?.('.blue-morph-range-host');
      setBlueMorphRangeCss(host, a, b, spec.min, spec.max);
    }
    window.SomataMorphParameterRouting?.syncActiveLegacyBindings?.(state.morph, state.minimalMorph);
  } else {
    binding.min = a;
    binding.max = b;
  }
  window.SomataMorphParameterRouting?.resetRuntime?.(runtimeState.morph);
  syncMorphSidebarSettingsFromState();
  if (runtimeState.morph?.active) activeRebaseMorphing?.();
  requestMainCanvasRender();
}
// 7.11.9: a single range-control UI contract for Blue and Orange.
// The caller owns the Morph-specific value commit; layout, constraints and labels are shared.
function appendSharedMorphBindingRange(row, def, binding, commitRange, valueResolver = null) {
  const schema = window.SomataParameterMatrix.rowLayout(def.id);
  const rangeSchema = schema?.controls?.find((c) => c.widget === 'range') || def;
  const lo = document.createElement('input'),
    hi = document.createElement('input');
  for (const [el, key] of [
    [lo, 'min'],
    [hi, 'max'],
  ]) {
    el.type = 'number';
    el.className = 'morph-route-number';
    el.step = String(rangeSchema.step || 'any');
    if (Number.isFinite(Number(rangeSchema.min))) el.min = String(rangeSchema.min);
    if (Number.isFinite(Number(rangeSchema.max))) el.max = String(rangeSchema.max);
    const value = valueResolver ? valueResolver(key) : binding[key];
    el.value = Number.isFinite(Number(value)) ? String(value) : '';
    el.setAttribute('aria-label', `${def.label}: ${key === 'min' ? 'минимум' : 'максимум'}`);
  }
  const sep = document.createElement('span');
  sep.className = 'morph-route-range-sep';
  sep.textContent = '—';
  const commit = () => commitRange(lo, hi);
  lo.addEventListener('change', commit);
  hi.addEventListener('change', commit);
  row.append(lo, sep, hi);
  return { lo, hi };
}
function morphSpecialLayerCoverage(owner, id) {
  return window.SomataParameterCoverage.percent({ layerPercent: owner?.specialLayerCoverage?.[id] });
}
function appendMorphLayerCoverage(row, binding, commit) {
  const wrap = document.createElement('label');
  wrap.className = 'morph-route-layer-coverage morph-route-inline-control';
  wrap.title = 'Случайная доля затронутых слоёв на цикл Morph / генерацию Orange';
  const label = document.createElement('span');
  label.textContent = 'Слои';
  const input = document.createElement('input');
  input.type = 'number';
  input.min = '0';
  input.max = '100';
  input.step = '1';
  input.className = 'morph-route-layer-percent';
  input.value = String(window.SomataParameterCoverage.percent(binding));
  input.setAttribute('aria-label', 'Доля слоёв, %');
  const unit = document.createElement('span');
  unit.textContent = '%';
  wrap.append(label, input, unit);
  input.addEventListener('change', () => {
    const pct = window.SomataParameterCoverage.percent({ layerPercent: input.value });
    input.value = String(pct);
    commit(pct);
  });
  row.appendChild(wrap);
  return input;
}
// Послойный Morph: при выбранном слое у строки есть переключатель «слой участвует в параметре».
function appendMorphLayerParticipation(row, binding) {
  const layerId = getMorphLayerFocus();
  if (layerId == null) return null;
  const included = !(binding.layerOff || []).some((id) => String(id) === layerId);
  row.classList.toggle('morph-route-layer-off', !included);
  const wrap = document.createElement('label');
  wrap.className = 'morph-route-layer-participation morph-route-inline-control';
  wrap.title = 'Меняется ли этот параметр у выбранного слоя во время Morph';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = included;
  input.setAttribute('aria-label', 'Слой участвует в параметре');
  const text = document.createElement('span');
  text.textContent = 'Слой';
  wrap.append(input, text);
  input.addEventListener('change', () => {
    const next = toggleMorphLayerOff(binding.layerOff, layerId, input.checked);
    if (next) binding.layerOff = next;
    else delete binding.layerOff;
    window.SomataMorphParameterRouting?.resetRuntime?.(runtimeState.morph);
    if (runtimeState.morph?.active) activeRebaseMorphing?.();
    syncMorphProfileDirtyUI?.();
    renderMorphProfileBindings();
    renderMorphRoutingTargets();
    requestMainCanvasRender();
  });
  row.appendChild(wrap);
  return input;
}
function appendSpecialLayerCoverage(row, engine, id) {
  const owner = engine === 'orange' ? state.randomOptions : state.morph;
  appendMorphLayerCoverage(row, { layerPercent: morphSpecialLayerCoverage(owner, id) }, (percent) => {
    owner.specialLayerCoverage = owner.specialLayerCoverage || {};
    owner.specialLayerCoverage[id] = percent;
    if (engine === 'orange') {
      window.SomataOrangeMorphProfiles?.captureDraft?.(
        state.minimalMorph,
        state.randomOptions,
        state.randomLayerCount,
      );
      syncOrangeMorphProfileDirtyUI?.();
      if (runtimeState.minimalMorph?.active) activeRebaseMinimalMorphing?.();
    } else {
      window.SomataMorphParameterRouting?.captureActiveDraft?.(state.morph, state.minimalMorph);
      syncMorphProfileDirtyUI?.();
      if (runtimeState.morph?.active) activeRebaseMorphing?.();
    }
    requestMainCanvasRender();
  });
}
function createMorphRoutingGroupIcon(group, row = false) {
  return (
    window.SomataParameterGroupIcons?.create?.(
      group,
      row ? 'morph-route-row-icon' : 'morph-routing-group-icon',
    ) || document.createElement('span')
  );
}
function appendMorphGroupLabel(target, group, arrow = false) {
  target.textContent = '';
  const label = document.createElement('span');
  label.className = 'morph-routing-group-label';
  label.appendChild(createMorphRoutingGroupIcon(group));
  const name = document.createElement('span');
  name.className = 'morph-routing-group-name';
  name.textContent = group + (arrow ? ' ▾' : '');
  label.appendChild(name);
  target.appendChild(label);
}
function buildMorphParameterMenu(menu, currentId, onPick, groupFilter = '') {
  menu.innerHTML = '';
  const input = document.createElement('input');
  input.type = 'search';
  input.className = 'audio-param-search';
  input.placeholder = 'Поиск параметра…';
  menu.appendChild(input);
  const body = document.createElement('div');
  menu.appendChild(body);
  const render = () => {
    const q = input.value.trim().toLowerCase();
    body.innerHTML = '';
    let last = '';
    for (const def of window.SomataParameterMatrix.all()) {
      const group = morphUiGroup(def);
      if (groupFilter && group !== groupFilter) continue;
      const hay = `${group} ${def.label} ${def.id}`.toLowerCase();
      if (q && !hay.includes(q)) continue;
      if (group !== last) {
        const t = document.createElement('div');
        t.className = 'audio-param-group-title';
        appendMorphGroupLabel(t, group, false);
        body.appendChild(t);
        last = group;
      }
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'audio-param-option' + (currentId === def.id ? ' active' : '');
      b.textContent = def.label;
      b.addEventListener('click', () => onPick(def.id));
      body.appendChild(b);
    }
  };
  input.addEventListener('input', render);
  render();
  setTimeout(() => input.focus(), 0);
}
function setMorphProxyControl(id, value, kind = 'value') {
  const el = document.getElementById(id);
  if (!el) return false;
  if (kind === 'checked') el.checked = !!value;
  else el.value = String(value);
  if (kind === 'checked') el.dispatchEvent(new Event('change', { bubbles: true }));
  else {
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  queueMicrotask(() => {
    syncMorphProfileDirtyUI?.();
    renderMorphProfileBindings();
  });
  return true;
}
function appendMorphInlineNumber(parent, id, label = '', extraClass = '') {
  const source = document.getElementById(id);
  if (!source) return null;
  const wrap = document.createElement('label');
  wrap.className = `morph-route-inline-control ${extraClass}`.trim();
  if (label) {
    const t = document.createElement('span');
    t.textContent = label;
    wrap.appendChild(t);
  }
  const input = document.createElement('input');
  input.type = 'number';
  input.className = 'morph-route-inline-number';
  for (const a of [
    'min',
    'max',
    'step',
    'inputmode',
    'data-log-multiplier',
    'data-binary-multiplier',
    'data-log-step',
  ])
    if (source.getAttribute(a) != null) input.setAttribute(a, source.getAttribute(a));
  input.value = source.value;
  input.title = source.title || source.getAttribute('aria-label') || label;
  input.addEventListener('change', () => setMorphProxyControl(id, input.value));
  wrap.appendChild(input);
  parent.appendChild(wrap);
  return input;
}
function appendMorphInlineCheck(parent, id, label, extraClass = '') {
  const source = document.getElementById(id);
  if (!source) return null;
  const wrap = document.createElement('label');
  wrap.className = `morph-route-inline-check ${extraClass}`.trim();
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = source.checked;
  input.addEventListener('change', () => setMorphProxyControl(id, input.checked, 'checked'));
  const text = document.createElement('span');
  text.textContent = label;
  wrap.append(input, text);
  parent.appendChild(wrap);
  return input;
}
function appendMorphInlineSelect(parent, id, label = '', extraClass = '') {
  const source = document.getElementById(id);
  if (!source) return null;
  const wrap = document.createElement('label');
  wrap.className = `morph-route-inline-control morph-route-inline-select ${extraClass}`.trim();
  if (label) {
    const t = document.createElement('span');
    t.textContent = label;
    wrap.appendChild(t);
  }
  const select = document.createElement('select');
  select.title = source.title || source.getAttribute('aria-label') || label;
  for (const option of source.options || []) {
    const o = document.createElement('option');
    o.value = option.value;
    o.textContent = option.textContent;
    select.appendChild(o);
  }
  select.value = source.value;
  select.addEventListener('change', () => setMorphProxyControl(id, select.value));
  wrap.appendChild(select);
  parent.appendChild(wrap);
  return select;
}
function appendMorphInlineRange(parent, minId, maxId, label = '', extraClass = '') {
  const minSource = document.getElementById(minId),
    maxSource = document.getElementById(maxId);
  if (!minSource || !maxSource) return null;
  const wrap = document.createElement('span');
  wrap.className = `morph-route-inline-control morph-route-inline-range ${extraClass}`.trim();
  if (label) {
    const t = document.createElement('span');
    t.textContent = label;
    wrap.appendChild(t);
  }
  const makeInput = (source, id) => {
    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'morph-route-inline-number';
    for (const a of ['min', 'max', 'step'])
      if (source.getAttribute(a) != null) input.setAttribute(a, source.getAttribute(a));
    input.value = source.value;
    input.title = source.title || source.getAttribute('aria-label') || label;
    input.addEventListener('change', () => setMorphProxyControl(id, input.value));
    return input;
  };
  const lo = makeInput(minSource, minId),
    sep = document.createElement('span'),
    hi = makeInput(maxSource, maxId);
  sep.className = 'morph-route-inline-range-sep';
  sep.textContent = '—';
  wrap.append(lo, sep, hi);
  parent.appendChild(wrap);
  return wrap;
}
function chooseMorphPaletteInUI(context, key) {
  const blue = context === 'blue',
    previousBlue = state.morph.lineColorPalette,
    previousOrange = state.randomOptions.lineColorPalette;
  setMorphPaletteForContext(context, key);
  if (blue) {
    state.morph.options.byColor = true;
    window.SomataMorphParameterRouting?.captureActiveDraft?.(state.morph, state.minimalMorph);
    syncMorphProfileDirtyUI?.();
  } else {
    state.randomOptions.byColor = true;
    window.SomataOrangeMorphProfiles?.captureDraft?.(
      state.minimalMorph,
      state.randomOptions,
      state.randomLayerCount,
    );
    syncOrangeMorphProfileDirtyUI?.();
  }
  // Explicit selections also update the other editor's unsaved profile draft,
  // so saving either profile cannot silently restore an outdated palette.
  if (morphPaletteSyncEnabled()) {
    if (blue && previousOrange !== state.randomOptions.lineColorPalette) {
      window.SomataOrangeMorphProfiles?.captureDraft?.(
        state.minimalMorph,
        state.randomOptions,
        state.randomLayerCount,
      );
      syncOrangeMorphProfileDirtyUI?.();
    } else if (!blue && previousBlue !== state.morph.lineColorPalette) {
      window.SomataMorphParameterRouting?.captureActiveDraft?.(state.morph, state.minimalMorph);
      syncMorphProfileDirtyUI?.();
    }
  }
  if (
    runtimeState.morph?.active &&
    (blue || previousBlue !== state.morph.lineColorPalette) &&
    runtimeState.minimalMorph?.active !== true
  ) {
    runtimeState.morph.suppressPaletteCycleOnce = true;
    activeRebaseMorphing?.();
  }
  if (runtimeState.minimalMorph?.active && (!blue || previousOrange !== state.randomOptions.lineColorPalette))
    activeRebaseMinimalMorphing?.();
  syncMorphSettingsUI();
  syncRandomSettingsUI();
  requestMainCanvasRender();
}
function appendMorphPaletteSelector(parent, extraClass = '') {
  const wrap = document.createElement('label');
  wrap.className = `morph-route-inline-control morph-route-palette-select ${extraClass}`.trim();
  const t = document.createElement('span');
  t.textContent = 'Палитра';
  const select = document.createElement('select');
  for (const key of getActivePlaylistPaletteKeys()) {
    const o = document.createElement('option');
    o.value = key;
    o.textContent = getPlaylistPaletteDisplayName(key);
    select.appendChild(o);
  }
  select.value = normalizePlaylistPaletteKey(state.morph.lineColorPalette, 'standard');
  select.addEventListener('change', () => chooseMorphPaletteInUI('blue', select.value));
  wrap.append(t, select);
  parent.appendChild(wrap);
  return select;
}
function appendMorphFillHarmonySelector(parent) {
  const source = document.getElementById('morphFillHarmonySelect');
  if (!source) return null;
  const wrap = document.createElement('label');
  wrap.className = 'morph-route-inline-control morph-route-harmony-select';
  const t = document.createElement('span');
  t.textContent = 'Гармония цвета заливки';
  const select = document.createElement('select');
  for (const option of source.options || []) {
    const o = document.createElement('option');
    o.value = option.value;
    o.textContent = option.textContent;
    select.appendChild(o);
  }
  select.value = source.value;
  select.addEventListener('change', () => setMorphProxyControl('morphFillHarmonySelect', select.value));
  wrap.append(t, select);
  parent.appendChild(wrap);
  return select;
}
// 7.10.5 — routed numeric bindings do not get invented multipliers; pure boolean routes are excluded from Blue Morph.
// Only real source-side multipliers and the legacy Blue multipliers that have their own semantics are shown.
function appendMorphChildBindingToggle(row, paramId, label, extraClass = '') {
  const def = window.SomataParameterRegistry?.get?.(paramId),
    profile = getActiveMorphProfile();
  if (!def || def.type === 'boolean' || !profile || profile.type !== 'standard') return null;
  const binding = getActiveMorphBindings(profile).find((b) => b.parameter === paramId),
    wrap = document.createElement('label');
  wrap.className = `morph-route-inline-check morph-route-child-binding ${extraClass}`.trim();
  wrap.dataset.childParameter = paramId;
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = !!binding && binding.enabled !== false;
  input.title = `Включить / выключить «${def.label}» в этом профиле`;
  input.addEventListener('change', () => {
    setMorphParameterRouteActive(paramId, input.checked);
    renderMorphProfileBindings();
    renderMorphRoutingGroups();
    syncMorphRouteDecorations();
  });
  const text = document.createElement('span');
  text.textContent = label;
  wrap.append(input, text);
  row.appendChild(wrap);
  return input;
}
function appendMorphCompoundBindingControl(row, paramId, label = '') {
  const def = window.SomataParameterRegistry?.get?.(paramId),
    profile = getActiveMorphProfile();
  if (!def || def.type === 'boolean' || !profile || profile.type !== 'standard') return null;
  const binding = getActiveMorphBindings(profile).find((b) => b.parameter === paramId),
    enabled = !!binding && binding.enabled !== false;
  const wrap = document.createElement('div');
  wrap.className = 'morph-route-compound-binding';
  wrap.dataset.childParameter = paramId;
  const toggle = document.createElement('label');
  toggle.className = 'morph-route-compound-toggle';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = enabled;
  cb.title = `Включить / выключить «${label || def.label}» в этом профиле`;
  const text = document.createElement('span');
  text.textContent = label || MORPH_COMPOUND_CHILD_LABELS[paramId] || def.label;
  toggle.append(cb, text);
  wrap.appendChild(toggle);
  cb.addEventListener('change', () => {
    setMorphParameterRouteActive(paramId, cb.checked);
    renderMorphProfileBindings();
    renderMorphRoutingGroups();
    syncMorphRouteDecorations();
  });
  if (enabled && binding) {
    const numeric =
      ['number', 'integer', 'angle', 'multiplier'].includes(def.type) || def.id === 'outline.color';
    if (numeric) {
      const range = document.createElement('span');
      range.className = 'morph-route-compound-range';
      const rangeLabel = document.createElement('span');
      rangeLabel.className = 'morph-route-compound-caption';
      rangeLabel.textContent = 'Диапазон';
      range.appendChild(rangeLabel);
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
        el.value = String(Number(binding[key]));
        el.setAttribute('aria-label', `${label || def.label}: ${key === 'min' ? 'минимум' : 'максимум'}`);
      }
      const sep = document.createElement('span');
      sep.className = 'morph-route-inline-range-sep';
      sep.textContent = '—';
      const commit = () => commitMorphBindingRange(def, binding, lo, hi);
      lo.addEventListener('change', commit);
      hi.addEventListener('change', commit);
      range.append(lo, sep, hi);
      wrap.appendChild(range);
    }
  }
  row.appendChild(wrap);
  return wrap;
}
function appendMorphAlwaysOnMultiplierControl(row, paramId, label = '') {
  const def = window.SomataParameterRegistry?.get?.(paramId),
    source = document.getElementById(def?.ui?.mainId);
  if (!def || !source) return null;
  const wrap = document.createElement('label');
  wrap.className = 'morph-route-compound-binding morph-route-always-on-multiplier';
  wrap.dataset.childParameter = paramId;
  const semanticLabel = label || MORPH_COMPOUND_CHILD_LABELS[paramId] || def.label;
  const text = document.createElement('span');
  text.className = 'morph-route-compound-static-label';
  text.textContent = 'X';
  const input = document.createElement('input');
  input.type = 'number';
  input.className = 'morph-route-inline-number morph-route-compound-static-multiplier';
  for (const a of [
    'min',
    'max',
    'step',
    'inputmode',
    'data-log-multiplier',
    'data-binary-multiplier',
    'data-log-step',
  ])
    if (source.getAttribute(a) != null) input.setAttribute(a, source.getAttribute(a));
  input.dataset.logMultiplier = '1';
  input.value = source.value || '1';
  input.disabled = source.disabled;
  input.title = `${semanticLabel}: 1× — без изменения`;
  input.setAttribute('aria-label', semanticLabel);
  const commit = () => setMorphProxyControl(def.ui.mainId, input.value);
  input.addEventListener('input', commit);
  input.addEventListener('change', commit);
  wrap.append(text, input);
  row.appendChild(wrap);
  return input;
}
function appendMorphCompoundChildren(row, def) {
  for (const childId of morphCompoundChildren(def?.id)) {
    if (childId === 'layer.radiusMultiplier') continue;
    if (morphAlwaysOnMultiplier(childId))
      appendMorphAlwaysOnMultiplierControl(row, childId, MORPH_COMPOUND_CHILD_LABELS[childId] || '');
    else appendMorphCompoundBindingControl(row, childId, MORPH_COMPOUND_CHILD_LABELS[childId] || '');
  }
}
function appendMorphBindingSpecificControls(row, def, binding) {
  if (def.id === 'layer.strokeColor') {
    appendMorphPaletteSelector(row);
    appendMorphInlineCheck(
      row,
      'morphCyclePalettes',
      'Менять палитру каждый цикл',
      'morph-route-compact-check',
    );
    appendMorphInlineCheck(
      row,
      'morphSyncPalettes',
      'Синхронизировать между морфингами',
      'morph-route-compact-check',
    );
  }
  if (def.id === 'layer.fillColor') {
    appendMorphPaletteSelector(row);
    appendMorphInlineRange(
      row,
      'morphFillLayersMin',
      'morphFillLayersMax',
      'Число залитых слоёв',
      'morph-route-dependent-range',
    );
    appendMorphFillHarmonySelector(row);
  }

  if (def.id === 'spiral.fillEnabled') {
    appendMorphChildBindingToggle(
      row,
      'spiral.fillType',
      'Настраивать тип заливки спирали',
      'morph-route-dependent-check',
    );
    appendMorphInlineSelect(row, 'paramSpiralFillType', 'Тип заливки спирали');
  } else if (def.type === 'enum' && def.ui?.mainId) appendMorphInlineSelect(row, def.ui.mainId, 'Значение');
  if (def.id === 'layer.radius') {
    appendMorphInlineCheck(
      row,
      'morphNormalizeSizes',
      'Сохранять пропорции размеров слоёв',
      'morph-route-dependent-check',
    );
  }
  if (def.id === 'layer.rotation')
    appendMorphInlineCheck(
      row,
      'morphRotationRandomDirection',
      'Случайно менять направление поворота',
      'morph-route-compact-check',
    );
  if (def.id === 'web.width')
    appendMorphInlineCheck(
      row,
      'webWidthRelative',
      'Использовать толщину относительно линии',
      'morph-route-dependent-check',
    );
  appendMorphCompoundChildren(row, def);
  // Legacy Blue multipliers that still have their own Morph semantics stay compact and right-aligned.
  if (def.id === 'geometry.N')
    appendMorphInlineNumber(row, 'morphVertexMultiplier', 'X', 'morph-route-multiplier');
  else if (def.id === 'layer.rotation')
    appendMorphInlineNumber(row, 'morphRotationMultiplier', 'X', 'morph-route-multiplier');
}
function appendMorphShapeProfileGroups(parent) {
  const entries = [
    ['morphProfileGroupStandard', 'Стандарт'],
    ['morphProfileGroupClosed', 'Замкнутые'],
    ['morphProfileGroupLoops', 'С петлями'],
    ['morphProfileGroupOpen', 'Разомкнутые'],
    ['morphProfileGroupMandala', 'Мандала'],
  ];
  const details = document.createElement('details');
  details.className = 'morph-profile-group-dropdown morph-shape-route-profile-dropdown';
  details.title = 'Наборы профилей формы · как в стабильной Somata 7.9';
  const summary = document.createElement('summary'),
    caption = document.createElement('span'),
    value = document.createElement('strong');
  caption.textContent = 'Наборы профилей';
  summary.append(caption, value);
  details.appendChild(summary);
  const menu = document.createElement('div');
  menu.className = 'morph-profile-group-menu';
  menu.setAttribute('role', 'group');
  menu.setAttribute('aria-label', 'Группы профилей морфинга');
  details.appendChild(menu);
  const proxies = [];
  const updateSummary = () => {
    const active = proxies.filter((x) => x.cb.checked).map((x) => x.label);
    value.textContent = active.length === entries.length ? 'Все' : active.join(', ') || 'Нет';
  };
  for (const [id, label] of entries) {
    const source = document.getElementById(id);
    if (!source) continue;
    const item = document.createElement('label');
    item.className = 'morph-profile-group-check';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = source.checked === true;
    cb.addEventListener('change', () => {
      setMorphProxyControl(id, cb.checked, 'checked');
      updateSummary();
    });
    const text = document.createElement('span');
    text.textContent = label;
    item.append(cb, text);
    menu.appendChild(item);
    proxies.push({ cb, label });
  }
  updateSummary();
  parent.appendChild(details);
  return details;
}
function appendMorphShapeRow(host) {
  if (!morphSpecialEnabled('shape')) return;
  const row = document.createElement('div');
  row.className = 'audio-route-row morph-route-row morph-binding-row morph-special-config-row';
  row.dataset.morphSpecial = 'shape';
  const spacer = document.createElement('span');
  spacer.className = 'morph-route-drag-handle morph-route-drag-placeholder';
  spacer.textContent = '·';
  row.appendChild(spacer);
  morphRowCheckbox(
    row,
    morphSpecialActive('shape'),
    (on) => setMorphSpecialRowActive('shape', on),
    'Морфить форму',
  );
  row.appendChild(createMorphRoutingGroupIcon('Геометрия', true));
  const name = document.createElement('div');
  name.className = 'morph-special-config-name';
  name.textContent = 'Форма';
  row.appendChild(name);
  appendMorphInlineSelect(row, 'morphShapeFamily', 'Семейство формы');
  appendMorphShapeProfileGroups(row);
  appendSpecialLayerCoverage(row, 'blue', 'geometry.shape');
  const rm = document.createElement('button');
  rm.type = 'button';
  rm.className = 'audio-route-remove morph-binding-remove';
  rm.textContent = '×';
  rm.title = 'Убрать строку «Форма»';
  rm.addEventListener('click', () => setMorphSpecialEnabled('shape', false));
  row.appendChild(rm);
  host.appendChild(row);
}
// Shared Blue/Orange special-row renderer: row anatomy comes from the
// parameter matrix; only ranges and their commit callbacks are mode-local.
function appendSharedMorphOrbitRow(host, engine, enabled, values, onRange, onToggle) {
  const spec = window.SomataParameterMatrix.rowLayout('geometry.orbits');
  const rangeMin = engine === 'blue' ? 0 : spec.min;
  const row = document.createElement('div');
  row.className =
    'audio-route-row morph-route-row morph-binding-row morph-special-config-row' +
    (engine === 'orange' ? ' orange-route-row orange-orbit-count-row' : '');
  row.dataset.parameterId = 'geometry.orbits';
  row.dataset[engine === 'orange' ? 'orangeSpecial' : 'morphSpecial'] = 'orbits';
  const spacer = document.createElement('span');
  spacer.className = 'morph-route-drag-handle morph-route-drag-placeholder';
  spacer.textContent = '·';
  row.appendChild(spacer);
  const cb = morphRowCheckbox(row, enabled, onToggle, 'Включить / выключить «Орбиты»');
  cb.setAttribute('aria-label', 'Орбиты');
  row.appendChild(createMorphRoutingGroupIcon('Геометрия', true));
  // Non-interactive text, like an ordinary parameter label: no fake picker.
  const label = document.createElement('span');
  label.className = 'morph-special-config-name morph-orbit-plain-label';
  label.textContent = spec.label;
  row.appendChild(label);
  const range = document.createElement('span');
  range.className = 'morph-special-config-range morph-route-inline-control morph-route-inline-range';
  range.dataset.orbitRange = '1';
  if (engine === 'orange') range.dataset.orangeSetting = 'orbitCount';
  const caption = document.createElement('span');
  caption.textContent = spec.widgets[0];
  range.appendChild(caption);
  const inputs = values.map((value, i) => {
    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'morph-route-inline-number';
    input.min = String(rangeMin);
    input.max = String(spec.max);
    input.step = String(spec.step);
    input.value = String(value);
    input.title = i ? 'Максимальная доля орбит, %' : 'Минимальная доля орбит, %';
    input.setAttribute('aria-label', `Доля орбит (%): ${i ? 'максимум' : 'минимум'}`);
    return input;
  });
  const sep = document.createElement('span');
  sep.className = 'morph-route-inline-range-sep';
  sep.textContent = '—';
  const commit = () => {
    let a = Math.max(rangeMin, Math.min(spec.max, Math.round(Number(inputs[0].value) || 0))),
      b = Math.max(rangeMin, Math.min(spec.max, Math.round(Number(inputs[1].value) || 0)));
    if (a > b) [a, b] = [b, a];
    inputs[0].value = String(a);
    inputs[1].value = String(b);
    onRange(a, b);
  };
  inputs.forEach((el) => el.addEventListener('change', commit));
  const unit = document.createElement('span');
  unit.className = 'morph-sec';
  unit.textContent = '%';
  range.append(inputs[0], sep, inputs[1], unit);
  row.appendChild(range);
  appendSpecialLayerCoverage(row, engine, 'geometry.orbits');
  const rm = document.createElement('button');
  rm.type = 'button';
  rm.className = 'audio-route-remove morph-binding-remove';
  rm.textContent = '×';
  rm.title = 'Убрать строку «Орбиты»';
  rm.addEventListener('click', () =>
    engine === 'orange'
      ? setOrangeSpecialParameterEnabled('geometry.orbits', false)
      : setMorphSpecialEnabled('orbits', false),
  );
  row.appendChild(rm);
  host.appendChild(row);
  return row;
}
// The Blue orbit controller has percentage endpoints (0..100), even
// when the currently selected N/K topology only permits S=1. Keep the
// two Morph thumbs separate from the topology-constrained S input.
function blueOrbitPercentValue(key) {
  const legacy = state.morph?.[key.replace('Percent', 'Count')];
  const raw =
    legacy != null && Number.isFinite(Number(legacy))
      ? Number(legacy) > 0
        ? Math.ceil((Number(legacy) * 100) / 19)
        : 100
      : state.morph?.[key];
  return Math.max(0, Math.min(100, Math.round(Number(raw) || 0)));
}
function commitBlueOrbitPercentRange(a, b) {
  state.morph.orbitPercentMin = Math.max(0, Math.min(100, Math.round(Number(a) || 0)));
  state.morph.orbitPercentMax = Math.max(
    state.morph.orbitPercentMin,
    Math.min(100, Math.round(Number(b) || 0)),
  );
  delete state.morph.orbitCountMin;
  delete state.morph.orbitCountMax;
  for (const [key, id] of [
    ['orbitPercentMin', 'morphOrbitPercentMin'],
    ['orbitPercentMax', 'morphOrbitPercentMax'],
  ]) {
    const el = document.getElementById(id);
    if (el && document.activeElement !== el) el.value = String(state.morph[key]);
  }
  window.SomataMorphParameterRouting?.captureActiveDraft?.(state.morph, state.minimalMorph);
  syncMorphProfileDirtyUI?.();
  if (runtimeState.morph?.active) activeRebaseMorphing?.();
  requestMainCanvasRender();
}
function appendMorphOrbitRow(host) {
  if (!morphSpecialEnabled('orbits')) return;
  appendSharedMorphOrbitRow(
    host,
    'blue',
    morphSpecialActive('orbits'),
    [blueOrbitPercentValue('orbitPercentMin'), blueOrbitPercentValue('orbitPercentMax')],
    commitBlueOrbitPercentRange,
    (enabled) => setMorphSpecialRowActive('orbits', enabled),
  );
}
function syncBlueOrbitSuborbitSlider() {
  const host = document.querySelector('#suborbitsContainer .suborbits-routing-range-host');
  const native = document.getElementById('paramSuborbits');
  if (!host || !native) return;
  if (host.dataset.orbitMorphThumbsBound !== '1') {
    host.dataset.orbitMorphThumbsBound = '1';
    native.dataset.blueMorphOriginalTabIndex = String(native.tabIndex);
    for (const which of ['min', 'max']) {
      const thumb = document.createElement('input');
      thumb.type = 'range';
      thumb.min = '0';
      thumb.max = '100';
      thumb.step = '1';
      thumb.className = 'blue-morph-dual blue-morph-dual-' + which;
      thumb.disabled = true;
      thumb.tabIndex = -1;
      thumb.setAttribute('aria-hidden', 'true');
      thumb.setAttribute(
        'aria-label',
        'Морфинг суборбит: ' + (which === 'min' ? 'минимум' : 'максимум') + ', %',
      );
      thumb.title = 'Морфинг орбит · ' + (which === 'min' ? 'минимум' : 'максимум') + ' 0–100%';
      host.appendChild(thumb);
      attachMorphSliderBubble(host, thumb);
    }
    const [low, high] = host.querySelectorAll(':scope > .blue-morph-dual');
    const commit = (which, final) => {
      if (!morphSpecialActive('orbits')) return;
      let lo = Number(low.value),
        hi = Number(high.value);
      if (which === 'min' && lo > hi) {
        hi = lo;
        high.value = String(hi);
      }
      if (which === 'max' && hi < lo) {
        lo = hi;
        low.value = String(lo);
      }
      commitBlueOrbitPercentRange(lo, hi);
      setBlueMorphRangeCss(host, lo, hi, 0, 100);
      if (final) {
        renderMorphProfileBindings();
        syncMorphRouteDecorations();
      }
    };
    low.addEventListener('input', () => commit('min', false));
    high.addEventListener('input', () => commit('max', false));
    low.addEventListener('change', () => commit('min', true));
    high.addEventListener('change', () => commit('max', true));
  }
  const enabled = morphSpecialActive('orbits');
  // Unlike the native count, these Morph endpoints can still be edited
  // at S=1. When S is editable and Morph is paused, keep the native
  // control accessible just as with the N and K sliders.
  const showMorph = enabled && (runtimeState?.morph?.active === true || native.disabled === true);
  host.classList.toggle('morph-live', showMorph);
  host.dataset.sliderMode = showMorph ? 'morph-range' : 'value';
  const low = host.querySelector(':scope > .blue-morph-dual-min');
  const high = host.querySelector(':scope > .blue-morph-dual-max');
  for (const thumb of [low, high]) {
    if (!thumb) continue;
    thumb.disabled = !showMorph;
    thumb.tabIndex = showMorph ? 0 : -1;
    thumb.setAttribute('aria-hidden', showMorph ? 'false' : 'true');
  }
  native.tabIndex = showMorph ? -1 : Number(native.dataset.blueMorphOriginalTabIndex || 0);
  native.setAttribute('aria-hidden', showMorph ? 'true' : 'false');
  const lo = blueOrbitPercentValue('orbitPercentMin');
  const hi = Math.max(lo, blueOrbitPercentValue('orbitPercentMax'));
  if (low && document.activeElement !== low) low.value = String(lo);
  if (high && document.activeElement !== high) high.value = String(hi);
  setBlueMorphRangeCss(host, lo, hi, 0, 100);
  if (!showMorph) hideMorphSliderBubble(host, 0);
}
function appendMorphChaosRow(host) {
  if (!morphSpecialEnabled('chaos')) return;
  const row = document.createElement('div');
  row.className = 'audio-route-row morph-route-row morph-binding-row morph-special-config-row';
  row.dataset.morphSpecial = 'chaos';
  const spacer = document.createElement('span');
  spacer.className = 'morph-route-drag-handle morph-route-drag-placeholder';
  spacer.textContent = '·';
  row.appendChild(spacer);
  morphRowCheckbox(
    row,
    morphSpecialActive('chaos'),
    (on) => setMorphSpecialRowActive('chaos', on),
    'Морфить звезду хаоса',
  );
  row.appendChild(createMorphRoutingGroupIcon('Геометрия', true));
  const name = document.createElement('div');
  name.className = 'morph-special-config-name';
  name.textContent = 'Морфинг хаоса';
  row.appendChild(name);
  appendMorphInlineNumber(row, 'chaosMorphStepSpread', 'Разброс шага ±');
  appendMorphInlineNumber(row, 'chaosMorphClosuresMax', 'Замыканий до');
  appendSpecialLayerCoverage(row, 'blue', 'geometry.chaos');
  const rm = document.createElement('button');
  rm.type = 'button';
  rm.className = 'audio-route-remove morph-binding-remove';
  rm.textContent = '×';
  rm.title = 'Убрать строку «Морфинг хаоса»';
  rm.addEventListener('click', () => setMorphSpecialEnabled('chaos', false));
  row.appendChild(rm);
  host.appendChild(row);
}
// All Spiral numeric settings remain visible in one responsive special row.
// A separate order-only Morph binding can coexist without hiding its range.
function appendMorphSpiralRange(row, controls, title, minId, maxId) {
  const range = document.createElement('span');
  range.className = 'morph-special-config-range morph-spiral-compact-range';
  const label = document.createElement('span');
  label.textContent = title;
  range.appendChild(label);
  appendMorphInlineNumber(range, minId);
  const sep = document.createElement('span');
  sep.textContent = '—';
  range.appendChild(sep);
  appendMorphInlineNumber(range, maxId);
  controls.appendChild(range);
}
function appendMorphSpiralSpecialRow(host, type) {
  const orderOnly = type === 'spiralOrder';
  if (!morphSpecialEnabled(type)) return;
  const enabled = orderOnly
    ? state.morph?.options?.bySpiralOrder === true
    : state.morph?.options?.bySpiralLayers === true;
  const id = orderOnly ? 'morphBySpiralOrder' : 'morphBySpiralLayers';
  const title = orderOnly ? 'Порядок спирали' : 'Спиральные слои';
  const row = document.createElement('div');
  row.className = 'audio-route-row morph-route-row morph-binding-row morph-special-config-row';
  row.dataset.morphSpecial = type;
  row.dataset.parameterId = orderOnly ? 'spiral.order' : 'spiral.layers';
  row.classList.toggle('morph-spiral-paused', !enabled);
  const spacer = document.createElement('span');
  spacer.className = 'morph-route-drag-handle morph-route-drag-placeholder';
  spacer.textContent = '·';
  row.appendChild(spacer);
  morphRowCheckbox(
    row,
    enabled,
    (on) => setMorphSpecialRowActive(type, on),
    `Временно включить / выключить: ${title}`,
  );
  row.appendChild(createMorphRoutingGroupIcon('Спирали', true));
  // A special Morph row must have the same parameter picker, typography
  // and popup behavior as ordinary bindings, not a hard-coded heading.
  const picker = document.createElement('div');
  picker.className = 'audio-param-picker morph-route-compact-picker morph-spiral-picker';
  const pickBtn = document.createElement('button');
  pickBtn.type = 'button';
  pickBtn.className = 'audio-param-picker-button';
  pickBtn.textContent = title;
  pickBtn.title = `Спирали › ${title}`;
  pickBtn.setAttribute('aria-haspopup', 'true');
  const menu = document.createElement('div');
  menu.className = 'audio-param-menu hidden';
  pickBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    document.querySelectorAll('.audio-param-menu').forEach((m) => {
      if (m !== menu) m.classList.add('hidden');
    });
    menu.classList.toggle('hidden');
    pickBtn.setAttribute('aria-expanded', String(!menu.classList.contains('hidden')));
    if (menu.classList.contains('hidden')) return;
    buildMorphParameterMenu(menu, row.dataset.parameterId, (nextId) => {
      menu.classList.add('hidden');
      pickBtn.setAttribute('aria-expanded', 'false');
      if (nextId === row.dataset.parameterId) return;
      const next = window.SomataParameterMatrix.get(nextId);
      // Use the same special/ordinary routing decisions as the
      // regular picker. Never replace a row with a dead label.
      setMorphSpecialEnabled(type, false);
      if (next?.kind) setMorphSpecialEnabled(next.kind, true);
      else setMorphParameterBinding(nextId, true);
      renderMorphProfileBindings();
    });
    positionViewportPopup(menu, pickBtn);
  });
  picker.append(pickBtn, menu);
  row.appendChild(picker);
  const controls = document.createElement('div');
  controls.className = 'morph-spiral-compact-controls';
  // Shared semantic row schema; Blue reads authored Morph fields,
  // Orange uses its independent randomOptions values.
  const layout = window.SomataParameterMatrix.rowLayout(row.dataset.parameterId);
  for (const field of layout.fields) {
    if (field.kind === 'range')
      appendMorphSpiralRange(
        row,
        controls,
        field.label,
        'morph' + field.min[0].toUpperCase() + field.min.slice(1),
        'morph' + field.max[0].toUpperCase() + field.max.slice(1),
      );
    else if (field.kind === 'number') {
      const chance = document.createElement('span');
      chance.className = 'morph-special-config-range morph-spiral-compact-range morph-spiral-chance';
      const label = document.createElement('span');
      label.textContent = field.label;
      label.title = 'Вероятность тангенциальности';
      chance.appendChild(label);
      appendMorphInlineNumber(chance, 'morph' + field.key[0].toUpperCase() + field.key.slice(1));
      const pct = document.createElement('span');
      pct.textContent = field.unit || '';
      chance.appendChild(pct);
      controls.appendChild(chance);
    }
  }
  if (orderOnly) {
    const hold = appendMorphInlineNumber(
      controls,
      'morphSpiralOrderHoldPhases',
      'Мин. фаз',
      'morph-spiral-hold-control',
    );
    if (hold) {
      hold.dataset.spiralOrderHoldProxy = '1';
      hold.title = 'Держать порядок минимум фаз';
    }
  }
  appendSpecialLayerCoverage(controls, 'blue', row.dataset.parameterId);
  row.appendChild(controls);
  const rm = document.createElement('button');
  rm.type = 'button';
  rm.className = 'audio-route-remove morph-binding-remove';
  rm.textContent = '×';
  rm.title = `Удалить строку «${title}»`;
  rm.addEventListener('click', () => setMorphSpecialEnabled(type, false));
  row.appendChild(rm);
  host.appendChild(row);
}
function appendMorphSpiralLayersRow(host) {
  appendMorphSpiralSpecialRow(host, 'spiralLayers');
}
function appendMorphSpiralOrderRow(host) {
  appendMorphSpiralSpecialRow(host, 'spiralOrder');
}
let morphBindingDrag = null;
function clearMorphBindingDragUI(host = document.getElementById('morphProfileBindings')) {
  morphBindingDrag = null;
  if (!host) return;
  host.classList.remove('morph-binding-drag-active', 'morph-order-drag-locked');
  host
    .querySelectorAll('.morph-drag-before,.morph-drag-after,.morph-drag-forbidden,.dragging')
    .forEach((el) =>
      el.classList.remove('morph-drag-before', 'morph-drag-after', 'morph-drag-forbidden', 'dragging'),
    );
}
// Множитель N слева изменился: обновить видимое поле «X» в строке N синего Morph.
document.addEventListener('somata:morph-vertex-multiplier-linked', () => renderMorphProfileBindings());
function renderMorphProfileBindings() {
  const host = document.getElementById('morphProfileBindings');
  if (!host) return;
  host.innerHTML = '';
  const panel = document.getElementById('morphSettingsPanel');
  if (panel?.classList.contains('hidden')) return;
  const profile = getActiveMorphProfile();
  if (!profile || profile.type !== 'standard') return;
  window.SomataMorphParameterRouting?.syncActiveLegacyBindings?.(state.morph, state.minimalMorph);
  const routing = window.SomataMorphParameterRouting,
    orderMode = getMorphOrderMode(profile),
    defs = new Map((window.SomataParameterRegistry?.all?.() || []).map((d) => [d.id, d]));
  host.dataset.orderMode = orderMode;
  host.classList.toggle('morph-order-type', orderMode === 'type');
  host.classList.toggle('morph-order-free', orderMode === 'free');
  const displayBindings = getMorphDisplayBindings(profile),
    displayIds = new Set(displayBindings.map((b) => b.parameter));
  {
    const focusId = getMorphLayerFocus();
    const focusLayer = focusId == null ? null : (state.layers || []).find((l) => String(l.id) === focusId);
    host.classList.toggle('morph-layer-focused', !!focusLayer);
    if (focusLayer) {
      const hint = document.createElement('div');
      hint.className = 'hint-text morph-route-layer-focus-hint';
      hint.textContent = `Слой «${focusLayer.name || 'Слой'}»: снимите галочку «Слой» у параметра, чтобы Morph его не менял. Диапазоны общие, их меняет Master.`;
      host.appendChild(hint);
    }
  }
  appendMorphShapeRow(host);
  appendMorphOrbitRow(host);
  appendMorphChaosRow(host);
  for (const binding of displayBindings) {
    const def = defs.get(binding.parameter);
    if (!def || def.type === 'boolean') continue;
    const compoundParent = morphCompoundParentId(def.id);
    if (
      (compoundParent && displayIds.has(compoundParent)) ||
      (def.id === 'spiral.stepLinked' && displayIds.has('spiral.step')) ||
      (def.id === 'spiral.fillType' && displayIds.has('spiral.fillEnabled'))
    )
      continue;
    const row = document.createElement('div');
    row.className =
      'audio-route-row morph-route-row morph-binding-row' + (binding.enabled === false ? ' disabled' : '');
    row.dataset.morphParameter = def.id;
    row.draggable = false;
    const handle = document.createElement('span');
    handle.className = 'morph-route-drag-handle';
    handle.setAttribute('aria-label', 'Перетащить строку');
    handle.setAttribute('role', 'button');
    handle.tabIndex = 0;
    handle.draggable = true;
    handle.textContent = '⠿';
    handle.title =
      orderMode === 'free'
        ? 'Перетащить строку'
        : 'Сортировка по типу: перестановка запрещена; перенос между слоями будет доступен позже';
    row.appendChild(handle);
    handle.addEventListener('dragstart', (e) => {
      morphBindingDrag = { parameter: def.id, profileId: profile.id, target: 'master' };
      row.classList.add('dragging');
      host.classList.add('morph-binding-drag-active');
      if (orderMode === 'type') host.classList.add('morph-order-drag-locked');
      if (e.dataTransfer) {
        const payload = JSON.stringify(morphBindingDrag);
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('application/x-somata-morph-binding', payload);
        e.dataTransfer.setData('text/plain', def.id);
      }
    });
    handle.addEventListener('dragend', () => clearMorphBindingDragUI(host));
    row.addEventListener('dragover', (e) => {
      if (!morphBindingDrag || morphBindingDrag.parameter === def.id) return;
      row.classList.remove('morph-drag-before', 'morph-drag-after', 'morph-drag-forbidden');
      if (orderMode !== 'free') {
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'none';
        row.classList.add('morph-drag-forbidden');
        return;
      }
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      const after = e.clientY >= row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2;
      row.classList.add(after ? 'morph-drag-after' : 'morph-drag-before');
    });
    row.addEventListener('dragleave', () =>
      row.classList.remove('morph-drag-before', 'morph-drag-after', 'morph-drag-forbidden'),
    );
    row.addEventListener('drop', (e) => {
      const drag = morphBindingDrag;
      if (!drag || drag.parameter === def.id) return;
      if (orderMode !== 'free') {
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'none';
        clearMorphBindingDragUI(host);
        return;
      }
      e.preventDefault();
      const after = e.clientY >= row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2;
      if (
        routing?.reorderBinding?.(
          state.morph,
          state.minimalMorph,
          drag.parameter,
          def.id,
          after ? 'after' : 'before',
        )
      ) {
        clearMorphBindingDragUI(host);
        renderMorphProfileBindings();
        syncMorphProfileDirtyUI?.();
      } else clearMorphBindingDragUI(host);
    });
    const cb = morphRowCheckbox(row, binding.enabled !== false, (on) => {
      setMorphRouteBindingActive(def, binding, on);
      commitMorphRouteActivationChange();
    });
    cb.id = `morphRouteEnabled_${def.id.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
    row.appendChild(createMorphRoutingGroupIcon(morphUiGroup(def), true));
    const picker = document.createElement('div');
    picker.className = 'audio-param-picker morph-route-compact-picker';
    const pickBtn = document.createElement('button');
    pickBtn.type = 'button';
    pickBtn.className = 'audio-param-picker-button';
    pickBtn.textContent = def.label;
    pickBtn.title = `${morphUiGroup(def)} › ${def.label}`;
    const menu = document.createElement('div');
    menu.className = 'audio-param-menu hidden';
    pickBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      document.querySelectorAll('.audio-param-menu').forEach((m) => {
        if (m !== menu) m.classList.add('hidden');
      });
      menu.classList.toggle('hidden');
      if (!menu.classList.contains('hidden')) {
        buildMorphParameterMenu(menu, def.id, (nextId) => {
          if (nextId === def.id) {
            menu.classList.add('hidden');
            return;
          }
          setMorphParameterBinding(def.id, false);
          if (window.SomataParameterMatrix.get(nextId)?.kind)
            setMorphSpecialEnabled(window.SomataParameterMatrix.get(nextId).kind, true);
          else setMorphParameterBinding(nextId, true);
          menu.classList.add('hidden');
          renderMorphProfileBindings();
        });
        positionViewportPopup(menu, pickBtn);
      }
    });
    picker.append(pickBtn, menu);
    row.appendChild(picker);
    const numeric =
      ['number', 'integer', 'angle', 'multiplier'].includes(def.type) || def.id === 'outline.color';
    if ((numeric && def.morph?.minKey && def.morph?.maxKey) || (numeric && def.morph?.legacy !== true)) {
      appendSharedMorphBindingRange(
        row,
        def,
        binding,
        (lo, hi) => commitMorphBindingRange(def, binding, lo, hi),
        (key) => (def.morph?.legacy === true ? morphLegacyRangeValue(def, key) : binding[key]),
      );
    }
    appendMorphLayerCoverage(row, binding, (percent) => {
      binding.layerPercent = percent;
      window.SomataMorphParameterRouting?.resetRuntime?.(runtimeState.morph);
      if (runtimeState.morph?.active) activeRebaseMorphing?.();
      syncMorphProfileDirtyUI?.();
      requestMainCanvasRender();
    });
    appendMorphLayerParticipation(row, binding);
    appendMorphBindingSpecificControls(row, def, binding);
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'audio-route-remove morph-binding-remove';
    rm.textContent = '×';
    rm.title = 'Удалить связь';
    rm.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      removeMorphParameterBinding(def.id);
    });
    row.appendChild(rm);
    host.appendChild(row);
  }
  appendMorphSpiralLayersRow(host);
  appendMorphSpiralOrderRow(host);
  if (!host.children.length) {
    const empty = document.createElement('div');
    empty.className = 'hint-text';
    empty.textContent =
      'Связей нет. Добавьте параметр через группы выше, кнопку «Добавить связь» или ПКМ по параметру слева.';
    host.appendChild(empty);
  }
}

function setMorphProfileUiReady(value) {
  morphProfileUiReady = value;
  return value;
}

export {
  appendMorphAlwaysOnMultiplierControl,
  appendMorphGroupLabel,
  appendMorphInlineCheck,
  appendMorphInlineSelect,
  appendMorphLayerCoverage,
  appendSharedMorphBindingRange,
  appendSharedMorphOrbitRow,
  appendSpecialLayerCoverage,
  blueSpecParameterId,
  buildMorphParameterMenu,
  chooseMorphPaletteInUI,
  commitMorphRouteActivationChange,
  createMorphRoutingGroupIcon,
  defaultMorphBindingRange,
  ensureMorphProfileState,
  getActiveMorphBindings,
  getActiveMorphProfile,
  getMorphOrderMode,
  morphProfileUiReady,
  morphSpecialLayerCoverage,
  renderMorphParameterPicker,
  renderMorphProfileBindings,
  setLegacyMorphBindingEnabled,
  setMorphOrderMode,
  setMorphProfileUiReady,
  setMorphProxyControl,
  setMorphRouteBindingActive,
  syncBlueOrbitSuborbitSlider,
  syncMorphOrderModeUI,
};
