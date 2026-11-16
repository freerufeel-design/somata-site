// Blue Morph: описания привязок параметров, особые строки, всплывающие значения слайдеров.
import '../sidebar-sync.js'; // initialisation order: this module runs after it
import { requestMainCanvasRender } from '../../core/scheduler.js';
import { runtimeState, state } from '../../core/state.js';
import {
  blueSpecParameterId,
  defaultMorphBindingRange,
  getActiveMorphBindings,
  getActiveMorphProfile,
  renderMorphProfileBindings,
  setMorphProxyControl,
  syncBlueOrbitSuborbitSlider,
} from './profile-bindings.js';
import {
  openUnifiedParameterRoutingMenuForId,
  syncMorphRouteDecorations,
} from '../parameter-routing-popup.js';
import { syncMorphProfileDirtyUI } from './profiles.js';
import { activeRebaseMorphing } from '../../morph-runtime/morph-hooks.js';

const BLUE_MORPH_PARAMETER_BINDINGS = Object.freeze([
  {
    mainId: 'paramN',
    option: 'byVertices',
    checkboxId: 'morphByVertices',
    minKey: 'vertexMin',
    maxKey: 'vertexMax',
    min: 2,
    max: 120,
    step: 1,
    label: 'N',
  },
  {
    mainId: 'paramK',
    option: 'bySteps',
    checkboxId: 'morphBySteps',
    minKey: 'stepMin',
    maxKey: 'stepMax',
    min: 0,
    max: 100,
    step: 1,
    label: 'K · % диапазона',
  },
  {
    mainId: 'paramRounding',
    option: 'byRounding',
    checkboxId: 'morphByRounding',
    minKey: 'roundingMin',
    maxKey: 'roundingMax',
    min: 0,
    max: 200,
    step: 1,
    label: 'Скругление',
  },
  {
    mainId: 'paramRadius',
    option: 'bySize',
    checkboxId: 'morphBySize',
    minKey: 'radiusMin',
    maxKey: 'radiusMax',
    min: 20,
    max: 500,
    step: 1,
    label: 'Радиус',
  },
  {
    mainId: 'paramRotation',
    option: 'byRotation',
    checkboxId: 'morphByRotation',
    minKey: 'rotationMinPercent',
    maxKey: 'rotationMaxPercent',
    min: 0,
    max: 100,
    step: 1,
    label: 'Поворот · % оборота',
  },
  {
    mainId: 'paramOpacity',
    option: 'byOpacity',
    checkboxId: 'morphByOpacity',
    minKey: 'opacityMin',
    maxKey: 'opacityMax',
    min: 0,
    max: 100,
    step: 1,
    label: 'Прозрачность',
  },
  {
    mainId: 'paramStrokeWidth',
    option: 'byStrokeWidth',
    checkboxId: 'morphByStrokeWidth',
    minKey: 'strokeWidthMin',
    maxKey: 'strokeWidthMax',
    min: 0.5,
    max: 50,
    step: 0.1,
    label: 'Толщина',
  },
  {
    mainId: 'paramFillOpacity',
    option: 'byFillColor',
    checkboxId: 'morphByFillColor',
    minKey: 'fillOpacityMin',
    maxKey: 'fillOpacityMax',
    min: 0,
    max: 100,
    step: 1,
    label: 'Прозрачность заливки',
  },
  { mainId: 'paramStrokeColor', option: 'byColor', checkboxId: 'morphByColor', label: 'Цвет линии' },
  { mainId: 'paramFillColor', option: 'byFillColor', checkboxId: 'morphByFillColor', label: 'Цвет заливки' },
]);
// 7.10 — one artistic concept occupies one Morph row. Parameters that were
// side-by-side in the pre-routing UI (base value + multiplier/focus/etc.) stay
// independent bindings internally, but are edited together in a compound row.
// Nested children are shared by Blue, Orange and Audio in parameter-matrix.js.
const MORPH_COMPOUND_CHILDREN = window.SomataParameterMatrix.children;
const MORPH_COMPOUND_CHILD_LABELS = window.SomataParameterMatrix.childLabels;
const MORPH_ALWAYS_ON_MULTIPLIERS = new Set(
  Object.values(MORPH_COMPOUND_CHILDREN)
    .flat()
    .filter((id) => /Multiplier$/.test(id)),
);
function morphCompoundParentId(paramId) {
  return window.SomataParameterMatrix.parentId(paramId);
}
function morphCompoundChildren(paramId) {
  return MORPH_COMPOUND_CHILDREN[paramId] || [];
}
function morphAlwaysOnMultiplier(paramId) {
  return MORPH_ALWAYS_ON_MULTIPLIERS.has(String(paramId || ''));
}
function morphUiGroup(def) {
  return String(def?.morph?.group || def?.group || '');
}
// One authoritative mapping for compound Morph parameters. The picker,
// routing-group menus and parameter context menus share the same state
// and the same legacy control/event path.
const MORPH_SPECIAL_CONTROLS = Object.freeze({
  shape: Object.freeze({ control: 'morphByShape', enabled: () => state.morph?.options?.byShape === true }),
  orbits: Object.freeze({
    control: 'morphMonoOrbitTransforms',
    enabled: () => state.morph?.monoOrbitTransforms === true,
  }),
  chaos: Object.freeze({
    control: 'chaosMorphEnabled',
    enabled: () => state.morph?.chaosMorphEnabled === true,
  }),
  spiralLayers: Object.freeze({
    control: 'morphBySpiralLayers',
    enabled: () => state.morph?.options?.bySpiralLayers === true,
  }),
  spiralOrder: Object.freeze({
    control: 'morphBySpiralOrder',
    enabled: () => state.morph?.options?.bySpiralOrder === true,
  }),
});
// All Morph checkboxes and presence bookkeeping share ONE lifecycle
// implementation in js/core/morph-row-lifecycle.js (not per parameter).
const MorphRowLifecycle = window.SomataMorphRowLifecycle;
function morphSpecialOwner(engine) {
  return engine === 'orange'
    ? state.randomOptions || (state.randomOptions = {})
    : (state.morph.options ||= {});
}
function morphSpecialRowPresence(engine, kind, active) {
  return MorphRowLifecycle.isPresent(morphSpecialOwner(engine), kind, active);
}
function setMorphSpecialRowPresence(engine, kind, added) {
  return MorphRowLifecycle.setPresent(morphSpecialOwner(engine), kind, added);
}
function morphRowCheckbox(row, active, onChange, title) {
  return MorphRowLifecycle.appendCheckbox(row, active, onChange, title);
}
function morphSpecialActive(kind) {
  return MORPH_SPECIAL_CONTROLS[kind]?.enabled() === true;
}
function morphSpecialEnabled(kind) {
  return morphSpecialRowPresence('blue', kind, morphSpecialActive(kind));
}
function setMorphSpecialEnabled(kind, added) {
  const control = MORPH_SPECIAL_CONTROLS[kind]?.control;
  if (!control) return false;
  setMorphSpecialRowPresence('blue', kind, added);
  return setMorphProxyControl(control, added === true, 'checked');
}
function setMorphSpecialRowActive(kind, active) {
  const control = MORPH_SPECIAL_CONTROLS[kind]?.control;
  if (!control) return false;
  setMorphSpecialRowPresence('blue', kind, true);
  return setMorphProxyControl(control, active === true, 'checked');
}
function pruneLegacyMorphMultiplierBindings() {
  const routing = window.SomataMorphParameterRouting,
    profile = getActiveMorphProfile();
  if (!routing || !profile || profile.type !== 'standard') return false;
  const list = routing.workingBindings?.(state.morph, state.minimalMorph, profile);
  if (!Array.isArray(list)) return false;
  let changed = false;
  for (let i = list.length - 1; i >= 0; i--) {
    if (morphAlwaysOnMultiplier(list[i]?.parameter)) {
      list.splice(i, 1);
      changed = true;
    }
  }
  if (changed) routing.resetRuntime?.(runtimeState.morph);
  return changed;
}
let blueMorphParameterBindingsReady = false;
function blueMorphParameterRowFor(el) {
  return el?.closest?.('.control-row') || el?.closest?.('.fill-settings-block') || null;
}
function setBlueMorphRangeCss(host, lo, hi, min, max) {
  if (!host) return;
  const span = Math.max(1e-9, max - min),
    a = Math.max(0, Math.min(100, ((lo - min) / span) * 100)),
    b = Math.max(a, Math.min(100, ((hi - min) / span) * 100));
  host.style.setProperty('--morph-low', `${a}%`);
  host.style.setProperty('--morph-high', `${b}%`);
}
function morphSliderDisplayValue(input) {
  const n = Number(input?.value);
  if (!Number.isFinite(n)) return String(input?.value ?? '');
  const step = String(input?.step || '');
  let digits = 0;
  if (step.includes('.')) digits = Math.min(4, step.split('.')[1].length);
  if (Math.abs(n) >= 1000) return String(Math.round(n));
  if (digits) return n.toFixed(digits).replace(/\.?0+$/, '');
  return String(Math.round(n * 1000) / 1000);
}
function ensureMorphSliderBubble(host) {
  if (!host) return null;
  let bubble = host.querySelector(':scope > .morph-slider-value-bubble');
  if (bubble) return bubble;
  bubble = document.createElement('span');
  bubble.className = 'morph-slider-value-bubble';
  bubble.setAttribute('aria-hidden', 'true');
  host.appendChild(bubble);
  return bubble;
}
function showMorphSliderBubble(host, input, force = false) {
  if (!host || !input || (!force && !host.classList.contains('morph-live'))) return;
  const bubble = ensureMorphSliderBubble(host),
    min = Number(input.min),
    max = Number(input.max),
    v = Number(input.value);
  if (!Number.isFinite(v) || !Number.isFinite(min) || !Number.isFinite(max) || max <= min) return;
  const pct = Math.max(0, Math.min(100, ((v - min) / (max - min)) * 100));
  bubble.textContent = morphSliderDisplayValue(input);
  bubble.style.left = `${pct}%`;
  bubble.classList.add('visible');
  bubble.dataset.owner = input.classList.contains('blue-morph-dual-min') ? 'min' : 'max';
  host._morphBubbleOwner = input;
}
function hideMorphSliderBubble(host, delay = 0) {
  if (!host) return;
  clearTimeout(host._morphBubbleTimer);
  host._morphBubbleTimer = setTimeout(() => {
    if (host._morphBubbleDragging) return;
    host.querySelector(':scope > .morph-slider-value-bubble')?.classList.remove('visible');
    host._morphBubbleOwner = null;
  }, delay);
}
function attachMorphSliderBubble(host, input) {
  if (!host || !input || input.dataset.morphBubbleBound === '1') return;
  input.dataset.morphBubbleBound = '1';
  input.addEventListener('input', () => showMorphSliderBubble(host, input, true));
  input.addEventListener('focus', () => showMorphSliderBubble(host, input, true));
  input.addEventListener('blur', () => hideMorphSliderBubble(host, 140));
  input.addEventListener('pointerdown', () => {
    host._morphBubbleDragging = true;
    showMorphSliderBubble(host, input, true);
  });
  input.addEventListener('pointerup', () => {
    host._morphBubbleDragging = false;
    showMorphSliderBubble(host, input, true);
    hideMorphSliderBubble(host, 520);
  });
  if (host.dataset.morphBubbleHostBound !== '1') {
    host.dataset.morphBubbleHostBound = '1';
    host.addEventListener('pointermove', (ev) => {
      if (!host.classList.contains('morph-live')) return;
      const rect = host.getBoundingClientRect();
      if (!(rect.width > 0)) return;
      const candidates = [...host.querySelectorAll('.blue-morph-dual:not(:disabled)')];
      if (!candidates.length) return;
      let best = null,
        bestDist = Infinity;
      for (const candidate of candidates) {
        const min = Number(candidate.min),
          max = Number(candidate.max),
          v = Number(candidate.value);
        if (!Number.isFinite(min) || !Number.isFinite(max) || !Number.isFinite(v) || max <= min) continue;
        const px = rect.left + ((v - min) / (max - min)) * rect.width,
          dist = Math.abs(ev.clientX - px);
        if (dist < bestDist) {
          bestDist = dist;
          best = candidate;
        }
      }
      if (best && (bestDist <= 22 || host._morphBubbleDragging)) showMorphSliderBubble(host, best, true);
      else if (!host._morphBubbleDragging) hideMorphSliderBubble(host, 80);
    });
    host.addEventListener('pointerleave', () => hideMorphSliderBubble(host, 100));
  }
}
// The same iPhone-like value bubble for authored sliders outside live Blue Morph.
// This is delegated, so every visible range in current/future UI gets it without DOM wrappers.
let standardSliderBubble = null,
  standardSliderBubbleTarget = null,
  standardSliderBubbleDragging = false,
  standardSliderBubbleHideTimer = 0;
function isStandardSliderBubbleTarget(el) {
  if (!(el instanceof HTMLInputElement) || el.type !== 'range' || el.classList.contains('blue-morph-dual'))
    return false;
  if (el.disabled || el.getAttribute('aria-hidden') === 'true') return false;
  const morphHost = el.closest('.blue-morph-range-host');
  if (morphHost?.classList.contains('morph-live') && el.classList.contains('blue-morph-current-slider'))
    return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}
function ensureStandardSliderBubble() {
  if (standardSliderBubble?.isConnected) return standardSliderBubble;
  standardSliderBubble = document.createElement('span');
  standardSliderBubble.className = 'morph-slider-value-bubble standard-slider-value-bubble';
  standardSliderBubble.setAttribute('aria-hidden', 'true');
  document.body.appendChild(standardSliderBubble);
  return standardSliderBubble;
}
function positionStandardSliderBubble(input) {
  if (!isStandardSliderBubbleTarget(input)) return false;
  const bubble = ensureStandardSliderBubble(),
    rect = input.getBoundingClientRect(),
    min = Number(input.min),
    max = Number(input.max),
    v = Number(input.value);
  if (!Number.isFinite(v) || !Number.isFinite(min) || !Number.isFinite(max) || max <= min) return false;
  const pct = Math.max(0, Math.min(1, (v - min) / (max - min))),
    thumbInset = Math.min(9, rect.width * 0.08),
    x = rect.left + thumbInset + pct * Math.max(0, rect.width - thumbInset * 2),
    safeX = Math.max(22, Math.min(window.innerWidth - 22, x));
  bubble.textContent = morphSliderDisplayValue(input);
  bubble.style.left = `${safeX}px`;
  bubble.style.top = `${Math.max(8, rect.top - 8)}px`;
  bubble.classList.add('visible');
  standardSliderBubbleTarget = input;
  return true;
}
function hideStandardSliderBubble(delay = 0) {
  clearTimeout(standardSliderBubbleHideTimer);
  standardSliderBubbleHideTimer = setTimeout(() => {
    if (standardSliderBubbleDragging) return;
    standardSliderBubble?.classList.remove('visible');
    standardSliderBubbleTarget = null;
  }, delay);
}
function bindStandardSliderBubbleDelegation() {
  if (document.documentElement.dataset.standardSliderBubbleBound === '1') return;
  document.documentElement.dataset.standardSliderBubbleBound = '1';
  document.addEventListener('pointerover', (ev) => {
    const input = ev.target?.closest?.('input[type="range"]');
    if (input && isStandardSliderBubbleTarget(input)) {
      clearTimeout(standardSliderBubbleHideTimer);
      positionStandardSliderBubble(input);
    }
  });
  document.addEventListener('pointermove', (ev) => {
    const input = ev.target?.closest?.('input[type="range"]');
    if (input && isStandardSliderBubbleTarget(input)) positionStandardSliderBubble(input);
  });
  document.addEventListener('pointerout', (ev) => {
    const input = ev.target?.closest?.('input[type="range"]');
    if (input && input === standardSliderBubbleTarget && !input.contains(ev.relatedTarget))
      hideStandardSliderBubble(90);
  });
  document.addEventListener('pointerdown', (ev) => {
    const input = ev.target?.closest?.('input[type="range"]');
    if (!input || !isStandardSliderBubbleTarget(input)) return;
    standardSliderBubbleDragging = true;
    positionStandardSliderBubble(input);
  });
  const release = () => {
    if (!standardSliderBubbleDragging) return;
    standardSliderBubbleDragging = false;
    if (standardSliderBubbleTarget) positionStandardSliderBubble(standardSliderBubbleTarget);
    hideStandardSliderBubble(520);
  };
  document.addEventListener('pointerup', release);
  document.addEventListener('pointercancel', release);
  document.addEventListener('focusin', (ev) => {
    const input = ev.target;
    if (isStandardSliderBubbleTarget(input)) {
      clearTimeout(standardSliderBubbleHideTimer);
      positionStandardSliderBubble(input);
    }
  });
  document.addEventListener('focusout', (ev) => {
    if (ev.target === standardSliderBubbleTarget) hideStandardSliderBubble(140);
  });
  document.addEventListener('input', (ev) => {
    const input = ev.target;
    if (input === standardSliderBubbleTarget && isStandardSliderBubbleTarget(input))
      positionStandardSliderBubble(input);
  });
  window.addEventListener(
    'scroll',
    () => {
      if (standardSliderBubbleTarget && standardSliderBubble?.classList.contains('visible'))
        positionStandardSliderBubble(standardSliderBubbleTarget);
    },
    { capture: true, passive: true },
  );
  window.addEventListener('resize', () => {
    if (standardSliderBubbleTarget && standardSliderBubble?.classList.contains('visible'))
      positionStandardSliderBubble(standardSliderBubbleTarget);
  });
}
bindStandardSliderBubbleDelegation();
let genericMorphRangeBindingsReady = false;
function ensureGenericMorphRangeBindings() {
  if (genericMorphRangeBindingsReady) return;
  genericMorphRangeBindingsReady = true;
  for (const def of window.SomataParameterRegistry?.morphable?.() || []) {
    if (def.morph?.legacy === true) continue;
    const el = document.getElementById(def.ui?.mainId);
    if (!el || el.type !== 'range' || el.closest('.blue-morph-range-host')) continue;
    const rawMin = Number(el.min),
      rawMax = Number(el.max),
      defMin = Number(def.min),
      defMax = Number(def.max);
    const min = Number.isFinite(rawMin) ? rawMin : Number.isFinite(defMin) ? defMin : 0,
      max = Number.isFinite(rawMax) ? rawMax : Number.isFinite(defMax) ? defMax : min + 1;
    if (!(max > min)) continue;
    const host = document.createElement('span');
    host.className = 'blue-morph-range-host generic-morph-range-host parameter-routing-control';
    host.dataset.morphMainId = def.ui.mainId;
    host.dataset.routingParamId = def.id;
    host.dataset.sliderMode = 'value';
    el.parentNode.insertBefore(host, el);
    host.appendChild(el);
    el.classList.add('blue-morph-current-slider');
    if (!el.dataset.blueMorphOriginalTabIndex) el.dataset.blueMorphOriginalTabIndex = String(el.tabIndex);
    const step = String(el.step || '') && el.step !== 'any' ? el.step : String(def.step || 1),
      low = document.createElement('input'),
      high = document.createElement('input');
    for (const [node, which] of [
      [low, 'min'],
      [high, 'max'],
    ]) {
      node.type = 'range';
      node.className = `blue-morph-dual blue-morph-dual-${which}`;
      node.min = String(min);
      node.max = String(max);
      node.step = step;
      node.disabled = true;
      node.tabIndex = -1;
      node.setAttribute('aria-hidden', 'true');
      node.setAttribute('aria-label', `${def.label}: ${which === 'min' ? 'минимум' : 'максимум'} морфинга`);
      host.appendChild(node);
      attachMorphSliderBubble(host, node);
    }
    const commit = (which, final = false) => {
      const profile = getActiveMorphProfile();
      let binding =
        profile?.type === 'standard'
          ? getActiveMorphBindings(profile).find((b) => b.parameter === def.id)
          : null;
      if (!binding || binding.enabled === false) return;
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
      binding.min = lo;
      binding.max = hi;
      setBlueMorphRangeCss(host, lo, hi, min, max);
      window.SomataMorphParameterRouting?.resetRuntime?.(runtimeState.morph);
      if (runtimeState.morph?.active) activeRebaseMorphing?.();
      requestMainCanvasRender();
      syncMorphProfileDirtyUI?.();
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
}
function syncGenericMorphRangeBindings() {
  ensureGenericMorphRangeBindings();
  const live = runtimeState?.morph?.active === true,
    profile = getActiveMorphProfile();
  for (const def of window.SomataParameterRegistry?.morphable?.() || []) {
    if (def.morph?.legacy === true) continue;
    const el = document.getElementById(def.ui?.mainId),
      host = el?.closest?.('.generic-morph-range-host');
    if (!host) continue;
    const binding =
        profile?.type === 'standard'
          ? getActiveMorphBindings(profile).find((b) => b.parameter === def.id)
          : null,
      on = binding?.enabled !== false && !!binding;
    // Palette Hue is a playlist-wide authored value. Once routed to Blue Morph,
    // its dual-range editor must be available even before playback starts.
    // Other parameters retain the established live-only dual-range behavior.
    const rangeMode = on && (live || def.id === 'palette.hueOffset');
    host.classList.toggle('morph-live', rangeMode);
    host.dataset.sliderMode = rangeMode ? 'morph-range' : 'value';
    const dual = [...host.querySelectorAll('.blue-morph-dual')],
      originalTab = Number(el.dataset.blueMorphOriginalTabIndex);
    if (rangeMode) {
      el.tabIndex = -1;
      el.setAttribute('aria-hidden', 'true');
    } else {
      el.tabIndex = Number.isFinite(originalTab) ? originalTab : 0;
      el.removeAttribute('aria-hidden');
      hideMorphSliderBubble(host, 0);
    }
    for (const input of dual) {
      input.disabled = !rangeMode;
      input.tabIndex = rangeMode ? 0 : -1;
      input.setAttribute('aria-hidden', rangeMode ? 'false' : 'true');
    }
    const min = Number(dual[0]?.min),
      max = Number(dual[0]?.max);
    let lo = Number(binding?.min),
      hi = Number(binding?.max);
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
      const range = defaultMorphBindingRange(def);
      lo = Number(range.min);
      hi = Number(range.max);
    }
    if (Number.isFinite(min)) lo = Math.max(min, lo);
    if (Number.isFinite(max)) hi = Math.min(max, hi);
    if (lo > hi) [lo, hi] = [hi, lo];
    if (dual[0] && document.activeElement !== dual[0]) dual[0].value = String(lo);
    if (dual[1] && document.activeElement !== dual[1]) dual[1].value = String(hi);
    if (Number.isFinite(min) && Number.isFinite(max)) setBlueMorphRangeCss(host, lo, hi, min, max);
  }
}
function ensureBlueMorphParameterBindings() {
  if (blueMorphParameterBindingsReady) return;
  blueMorphParameterBindingsReady = true;
  for (const spec of BLUE_MORPH_PARAMETER_BINDINGS) {
    const el = document.getElementById(spec.mainId);
    if (!el) continue;
    const row = blueMorphParameterRowFor(el);
    if (!row) continue;
    row.dataset.blueMorphOption = spec.option;
    let name =
      row.querySelector('.row-label > span:first-child') ||
      row.querySelector('.hint-text') ||
      row.querySelector('.fill-settings-title span');
    if (name && !name.dataset.blueMorphContextBound) {
      name.dataset.blueMorphContextBound = '1';
      name.classList.add('blue-morph-parameter-name');
      name.title = `ПКМ: включить/выключить «${spec.label}» в выбранном Morph Profile`;
      name.addEventListener('contextmenu', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const id = blueSpecParameterId(spec);
        if (id) openUnifiedParameterRoutingMenuForId(id, ev.clientX, ev.clientY);
      });
    }
    if (el.type !== 'range' || !spec.minKey) continue;
    const host = document.createElement('span');
    host.className = 'blue-morph-range-host';
    host.dataset.morphMainId = spec.mainId;
    host.dataset.sliderMode = 'value';
    el.parentNode.insertBefore(host, el);
    host.appendChild(el);
    el.classList.add('blue-morph-current-slider');
    if (!el.dataset.blueMorphOriginalTabIndex) el.dataset.blueMorphOriginalTabIndex = String(el.tabIndex);
    const low = document.createElement('input'),
      high = document.createElement('input');
    for (const [node, which] of [
      [low, 'min'],
      [high, 'max'],
    ]) {
      node.type = 'range';
      node.className = `blue-morph-dual blue-morph-dual-${which}`;
      node.min = String(spec.min);
      node.max = String(spec.max);
      node.step = String(spec.step);
      node.disabled = true;
      node.tabIndex = -1;
      node.setAttribute('aria-hidden', 'true');
      node.setAttribute('aria-label', `${spec.label}: ${which === 'min' ? 'минимум' : 'максимум'} морфинга`);
      host.appendChild(node);
      attachMorphSliderBubble(host, node);
    }
    const commit = (which) => {
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
      state.morph[spec.minKey] = lo;
      state.morph[spec.maxKey] = hi;
      setBlueMorphRangeCss(host, lo, hi, spec.min, spec.max);
      const a = document.getElementById(spec.checkboxId);
      if (a && !a.checked) {
        a.checked = true;
        a.dispatchEvent(new Event('change', { bubbles: true }));
      }
      const mirrorIds = {
        vertexMin: 'morphVertexMin',
        vertexMax: 'morphVertexMax',
        stepMin: 'morphStepMin',
        stepMax: 'morphStepMax',
        roundingMin: 'morphRoundingMin',
        roundingMax: 'morphRoundingMax',
        rotationMinPercent: 'morphRotationMin',
        rotationMaxPercent: 'morphRotationMax',
        opacityMin: 'morphOpacityMin',
        opacityMax: 'morphOpacityMax',
        strokeWidthMin: 'morphStrokeWidthMin',
        strokeWidthMax: 'morphStrokeWidthMax',
        fillOpacityMin: 'morphFillOpacityMin',
        fillOpacityMax: 'morphFillOpacityMax',
      };
      for (const key of [spec.minKey, spec.maxKey]) {
        const id = mirrorIds[key],
          m = document.getElementById(id);
        if (m && document.activeElement !== m) m.value = String(state.morph[key]);
      }
      if (runtimeState.morph.active) activeRebaseMorphing();
      requestMainCanvasRender();
      syncMorphProfileDirtyUI?.();
    };
    low.addEventListener('input', () => commit('min'));
    high.addEventListener('input', () => commit('max'));
    low.addEventListener('change', () => commit('min'));
    high.addEventListener('change', () => commit('max'));
  }
  const profileGroup = document.getElementById('profileSettingsGroup');
  const profileTitle = profileGroup?.querySelector('.control-group-title > span');
  if (profileGroup && profileTitle && !profileTitle.dataset.blueMorphContextBound) {
    profileGroup.dataset.blueMorphOption = 'byShape';
    profileTitle.dataset.blueMorphContextBound = '1';
    profileTitle.classList.add('blue-morph-parameter-name');
    profileTitle.title = 'ПКМ: включить/выключить профиль формы в выбранном Morph Profile';
    profileTitle.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      const cb = document.getElementById('morphByShape');
      if (cb) {
        cb.checked = !cb.checked;
        cb.dispatchEvent(new Event('change', { bubbles: true }));
        syncBlueMorphParameterDecorations();
      }
    });
  }
}
function syncBlueMorphParameterDecorations() {
  ensureBlueMorphParameterBindings();
  syncBlueOrbitSuborbitSlider();
  const live = runtimeState?.morph?.active === true;
  for (const spec of BLUE_MORPH_PARAMETER_BINDINGS) {
    const el = document.getElementById(spec.mainId),
      row = blueMorphParameterRowFor(el);
    if (!row) continue;
    const on = state.morph.options?.[spec.option] === true,
      rangeMode = on && live;
    row.classList.toggle('blue-morph-enabled', on);
    row.classList.toggle('blue-morph-live', rangeMode);
    const host = el?.closest?.('.blue-morph-range-host');
    if (host && spec.minKey) {
      host.classList.toggle('morph-live', rangeMode);
      host.dataset.sliderMode = rangeMode ? 'morph-range' : 'value';
      const inputs = host.querySelectorAll('.blue-morph-dual');
      const originalTab = Number(el.dataset.blueMorphOriginalTabIndex);
      if (rangeMode) {
        el.tabIndex = -1;
        el.setAttribute('aria-hidden', 'true');
      } else {
        el.tabIndex = Number.isFinite(originalTab) ? originalTab : 0;
        el.removeAttribute('aria-hidden');
      }
      for (const input of inputs) {
        input.disabled = !rangeMode;
        input.tabIndex = rangeMode ? 0 : -1;
        input.setAttribute('aria-hidden', rangeMode ? 'false' : 'true');
      }
      let lo = Number(state.morph[spec.minKey]),
        hi = Number(state.morph[spec.maxKey]);
      if (!Number.isFinite(lo)) lo = spec.min;
      if (!Number.isFinite(hi)) hi = spec.max;
      lo = Math.max(spec.min, Math.min(spec.max, lo));
      hi = Math.max(lo, Math.min(spec.max, hi));
      if (inputs[0] && document.activeElement !== inputs[0]) inputs[0].value = String(lo);
      if (inputs[1] && document.activeElement !== inputs[1]) inputs[1].value = String(hi);
      setBlueMorphRangeCss(host, lo, hi, spec.min, spec.max);
    }
  }
  const pg = document.getElementById('profileSettingsGroup');
  if (pg) {
    const on = state.morph.options?.byShape === true;
    pg.classList.toggle('blue-morph-enabled', on);
    pg.classList.toggle('blue-morph-live', on && live);
  }
  syncGenericMorphRangeBindings();
}

export {
  BLUE_MORPH_PARAMETER_BINDINGS,
  MORPH_COMPOUND_CHILD_LABELS,
  attachMorphSliderBubble,
  blueMorphParameterRowFor,
  ensureGenericMorphRangeBindings,
  hideMorphSliderBubble,
  morphAlwaysOnMultiplier,
  morphCompoundChildren,
  morphCompoundParentId,
  morphRowCheckbox,
  morphSpecialActive,
  morphSpecialEnabled,
  morphSpecialRowPresence,
  morphUiGroup,
  pruneLegacyMorphMultiplierBindings,
  setBlueMorphRangeCss,
  setMorphSpecialEnabled,
  setMorphSpecialRowActive,
  setMorphSpecialRowPresence,
  syncBlueMorphParameterDecorations,
  syncGenericMorphRangeBindings,
};
