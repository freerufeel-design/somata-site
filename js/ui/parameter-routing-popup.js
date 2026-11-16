// Маршрутизация параметров: состояние, всплывающее меню, декорации.
import './blue-morph/profile-bindings.js'; // initialisation order: this module runs after it
import { requestMainCanvasRender } from '../core/scheduler.js';
import { runtimeState, state } from '../core/state.js';
import {
  blueMorphParameterRowFor,
  ensureGenericMorphRangeBindings,
  morphAlwaysOnMultiplier,
  morphSpecialActive,
  morphSpecialEnabled,
  setMorphSpecialRowActive,
  syncBlueMorphParameterDecorations,
  syncGenericMorphRangeBindings,
} from './blue-morph/parameter-bindings.js';
import {
  createMorphRoutingGroupIcon,
  defaultMorphBindingRange,
  getActiveMorphBindings,
  getActiveMorphProfile,
  renderMorphProfileBindings,
  setLegacyMorphBindingEnabled,
  syncBlueOrbitSuborbitSlider,
} from './blue-morph/profile-bindings.js';
import {
  renderMorphRoutingGroups,
  renderMorphRoutingTargets,
  syncMorphProfileDirtyUI,
} from './blue-morph/profiles.js';
import { activeRebaseMorphing } from '../morph-runtime/morph-hooks.js';
import {
  orangeParameterRoutingState,
  orangeSpecialParameterEnabled,
  orangeSpecialRowPresent,
  setOrangeParameterRouteActive,
  setOrangeSpecialRowActive,
} from './orange-morph/routing-ui.js';
import { syncMorphSettingsUI } from './morph-settings-panel.js';

function morphParameterRoutingState(paramId) {
  const def = window.SomataParameterRegistry?.get?.(paramId),
    profile = getActiveMorphProfile();
  if (!def || def.morph?.supported !== true)
    return {
      supported: false,
      added: false,
      active: false,
      reason: 'Параметр не используется в синем Morph',
    };
  if (def.type === 'boolean')
    return {
      supported: false,
      added: false,
      active: false,
      reason: 'Параметры только ВКЛ/ВЫКЛ не используются в синем Morph',
    };
  if (morphAlwaysOnMultiplier(paramId))
    return {
      supported: false,
      added: false,
      active: false,
      reason: 'Коэффициент управляется исходным контролом и не является отдельной Morph-связью',
    };
  if (!profile || profile.type !== 'standard')
    return { supported: false, added: false, active: false, reason: 'Выберите профиль синего морфинга' };
  let binding = getActiveMorphBindings(profile).find((b) => b.parameter === def.id),
    active = false;
  if (def.morph?.legacy === true) {
    active = state.morph?.options?.[def.morph.option] === true;
    if (binding) binding.enabled = active;
  } else active = binding?.enabled !== false && !!binding;
  return { supported: true, added: !!binding, active, binding, profileId: profile.id };
}
function setMorphParameterRouteActive(paramId, enabled) {
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
  let binding = getActiveMorphBindings(profile).find((b) => b.parameter === def.id),
    on = enabled === true;
  if (def.morph?.legacy === true) {
    setLegacyMorphBindingEnabled(def, on);
    routing.syncActiveLegacyBindings(state.morph, state.minimalMorph);
    binding = getActiveMorphBindings(profile).find((b) => b.parameter === def.id);
    if (binding) binding.enabled = on;
  } else if (on) {
    if (!binding)
      binding = routing.addBinding(state.morph, state.minimalMorph, paramId, defaultMorphBindingRange(def));
    if (binding) binding.enabled = true;
  } else if (binding) binding.enabled = false;
  routing.syncActiveLegacyBindings(state.morph, state.minimalMorph);
  routing.resetRuntime(runtimeState.morph);
  syncMorphSettingsUI();
  syncBlueMorphParameterDecorations();
  renderMorphProfileBindings();
  renderMorphRoutingTargets();
  renderMorphRoutingGroups();
  syncMorphRouteDecorations();
  if (runtimeState.morph?.active) activeRebaseMorphing?.();
  requestMainCanvasRender();
  syncMorphProfileDirtyUI?.();
  return true;
}
window.SomataMorphParameterRoutingUI = Object.freeze({
  state: morphParameterRoutingState,
  setActive: setMorphParameterRouteActive,
});
const parameterRoutingRows = new WeakMap();
let parameterRoutingPopup = null,
  parameterRoutingPopupId = '';
function parameterRoutingVisualHost(def, el) {
  // Routing borders surround the semantic field, not a 13px checkbox.
  // The four outline controls retain their own, independent routes.
  if (def?.id === 'outline.layerCount') return el?.closest?.('.blue-morph-range-host') || el;
  if (def?.id === 'outline.mode') return el?.closest?.('.line-outline-modes') || el;
  return el?.closest?.('.blue-morph-range-host') || el;
}
function setParameterRoutingVisualState(host, morphOn, audioOn, orangeOn = false) {
  if (!host) return;
  host.classList.add('parameter-routing-capable');
  const n = (morphOn ? 1 : 0) + (audioOn ? 1 : 0) + (orangeOn ? 1 : 0);
  host.classList.toggle('parameter-routing-morph', morphOn && n === 1);
  host.classList.toggle('parameter-routing-audio', audioOn && n === 1);
  host.classList.toggle('parameter-routing-orange', orangeOn && n === 1);
  host.classList.toggle('parameter-routing-both', morphOn && audioOn && !orangeOn);
  host.classList.toggle('parameter-routing-blue-orange', morphOn && orangeOn && !audioOn);
  host.classList.toggle('parameter-routing-audio-orange', audioOn && orangeOn && !morphOn);
  host.classList.toggle('parameter-routing-all', morphOn && audioOn && orangeOn);
  host.classList.toggle('parameter-routing-neutral', n === 0);
}
function ensureParameterRoutingPopup() {
  if (parameterRoutingPopup?.isConnected) return parameterRoutingPopup;
  const menu = document.createElement('div');
  menu.id = 'parameterRoutingContextMenu';
  menu.className = 'parameter-routing-context-menu hidden';
  menu.setAttribute('role', 'menu');
  menu.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
  menu.addEventListener('pointerdown', (e) => e.stopPropagation());
  document.body.appendChild(menu);
  parameterRoutingPopup = menu;
  if (!document.documentElement.dataset.parameterRoutingPopupCloseBound) {
    document.documentElement.dataset.parameterRoutingPopupCloseBound = '1';
    document.addEventListener(
      'pointerdown',
      (e) => {
        if (
          !parameterRoutingPopup ||
          parameterRoutingPopup.classList.contains('hidden') ||
          parameterRoutingPopup.contains(e.target)
        )
          return;
        parameterRoutingPopup.classList.add('hidden');
        parameterRoutingPopupId = '';
      },
      true,
    );
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && parameterRoutingPopup) {
        parameterRoutingPopup.classList.add('hidden');
        parameterRoutingPopupId = '';
      }
    });
  }
  return menu;
}
function parameterRoutingAudioState(paramId) {
  return (
    window.SomataAudioParameterRoutingUI?.state?.(paramId) || {
      supported: false,
      added: false,
      active: false,
      target: 'master',
      targetName: 'Мастер',
      targets: { supported: false, master: false, layers: [], any: false },
    }
  );
}
function positionParameterRoutingPopup(menu, x, y) {
  menu.classList.remove('hidden');
  const rect = menu.getBoundingClientRect(),
    pad = 8;
  menu.style.left = `${Math.max(pad, Math.min(innerWidth - rect.width - pad, Number(x) || pad))}px`;
  menu.style.top = `${Math.max(pad, Math.min(innerHeight - rect.height - pad, Number(y) || pad))}px`;
}
function renderParameterRoutingPopup(paramId, x, y) {
  const def = window.SomataParameterRegistry?.get?.(paramId) || window.SomataParameterMatrix?.get?.(paramId),
    menu = ensureParameterRoutingPopup();
  if (!def || !menu) return;
  parameterRoutingPopupId = def.id;
  const morph = morphParameterRoutingState(def.id),
    orange = orangeParameterRoutingState(def.id),
    audio = parameterRoutingAudioState(def.id);
  menu.innerHTML = '';
  const head = document.createElement('div');
  head.className = 'parameter-routing-popup-head';
  head.appendChild(createMorphRoutingGroupIcon(def.group, true));
  const headText = document.createElement('div');
  headText.className = 'parameter-routing-popup-title';
  const strong = document.createElement('strong');
  strong.textContent = def.label;
  const small = document.createElement('span');
  small.textContent = def.group;
  headText.append(strong, small);
  head.appendChild(headText);
  menu.appendChild(head);
  const addOption = (kind, label, color, stateObj, onToggle) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `parameter-routing-popup-option routing-${kind}`;
    b.setAttribute('role', 'menuitemcheckbox');
    b.setAttribute('aria-checked', stateObj.active ? 'true' : 'false');
    b.disabled = stateObj.supported === false;
    const mark = document.createElement('span');
    mark.className = 'parameter-routing-popup-check';
    mark.textContent = stateObj.active ? '✓' : '';
    const sw = document.createElement('span');
    sw.className = 'parameter-routing-popup-swatch';
    sw.style.setProperty('--routing-accent', color);
    const txt = document.createElement('span');
    txt.className = 'parameter-routing-popup-option-text';
    const name = document.createElement('strong');
    name.textContent = label;
    const sub = document.createElement('small');
    sub.textContent =
      stateObj.supported === false
        ? stateObj.reason || 'Недоступно'
        : stateObj.active
          ? 'Включено'
          : stateObj.added
            ? 'Добавлено · выключено'
            : 'Не назначено';
    txt.append(name, sub);
    b.append(mark, sw, txt);
    b.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (b.disabled) return;
      onToggle(!stateObj.active);
      syncMorphRouteDecorations();
      renderParameterRoutingPopup(def.id, x, y);
    });
    menu.appendChild(b);
  };
  if (def.kind) {
    const kind = def.kind;
    const blueOn = morphSpecialActive(kind),
      orangeOn = orangeSpecialParameterEnabled(def.id);
    addOption(
      'morph',
      'Синий морфинг',
      '#38bdf8',
      {
        supported: getActiveMorphProfile()?.type === 'standard',
        active: blueOn,
        added: morphSpecialEnabled(kind),
      },
      (on) => setMorphSpecialRowActive(kind, on),
    );
    addOption(
      'orange',
      'Оранжевый морфинг',
      '#fb923c',
      { supported: true, active: orangeOn, added: orangeSpecialRowPresent(def.id) },
      (on) => setOrangeSpecialRowActive(def.id, on),
    );
  } else {
    addOption('morph', 'Синий морфинг', '#38bdf8', morph, (on) => setMorphParameterRouteActive(def.id, on));
    addOption('orange', 'Оранжевый морфинг', '#fb923c', orange, (on) =>
      setOrangeParameterRouteActive(def.id, on),
    );
  }
  const audioBox = document.createElement('div');
  audioBox.className = 'parameter-routing-popup-audio';
  audioBox.classList.toggle('disabled', audio.supported === false);
  const audioHead = document.createElement('div');
  audioHead.className = 'parameter-routing-popup-audio-head';
  const audioName = document.createElement('strong');
  audioName.textContent = 'Аудиосвязь';
  const audioHint = document.createElement('small');
  audioHint.textContent =
    audio.supported === false ? audio.reason || 'Недоступно' : 'Выберите слои и/или Master';
  audioHead.append(audioName, audioHint);
  audioBox.appendChild(audioHead);
  const targets = audio.targets ||
    window.SomataAudioParameterRoutingUI?.targets?.(def.id) || { master: false, layers: [] };
  const bubbles = document.createElement('div');
  bubbles.className = 'parameter-routing-popup-target-bubbles';
  const addBubble = (label, targetId, on, title) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'parameter-routing-target-bubble' + (on ? ' active' : '');
    b.textContent = label;
    b.title = title;
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.disabled = audio.supported === false;
    b.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (b.disabled) return;
      window.SomataAudioParameterRoutingUI?.setTargetActive?.(def.id, targetId, !on);
      syncMorphRouteDecorations();
      renderParameterRoutingPopup(def.id, x, y);
    });
    bubbles.appendChild(b);
  };
  for (const layerTarget of (targets.layers || []).slice(0, 5))
    addBubble(
      String(layerTarget.index + 1),
      layerTarget.id,
      layerTarget.active === true,
      `Слой ${layerTarget.index + 1}: ${layerTarget.label || ''}`,
    );
  addBubble('М', 'master', targets.master === true, 'Master');
  audioBox.appendChild(bubbles);
  menu.appendChild(audioBox);
  const foot = document.createElement('div');
  foot.className = 'parameter-routing-popup-foot';
  foot.textContent = 'Blue, Orange и несколько Audio-целей могут использовать один параметр независимо';
  menu.appendChild(foot);
  positionParameterRoutingPopup(menu, x, y);
}
function openUnifiedParameterRoutingMenuForId(paramId, x, y) {
  renderParameterRoutingPopup(paramId, x, y);
}
function addParameterRoutingRowCandidate(row, def, host) {
  if (!row || !def || !host) return;
  let list = parameterRoutingRows.get(row);
  if (!list) {
    list = [];
    parameterRoutingRows.set(row, list);
  }
  if (!list.some((x) => x.def.id === def.id)) list.push({ def, host });
  if (row.dataset.parameterRoutingRowBound === '1') return;
  row.dataset.parameterRoutingRowBound = '1';
  row.classList.add('parameter-routing-row');
  row.addEventListener('contextmenu', (ev) => {
    const interactive = ev.target?.closest?.(
      'input,select,textarea,button,a,[contenteditable="true"],.parameter-routing-context-menu',
    );
    if (interactive) return;
    const candidates = (parameterRoutingRows.get(row) || []).filter((x) => x.host?.isConnected);
    if (!candidates.length) return;
    let best = candidates[0],
      dist = Infinity;
    for (const candidate of candidates) {
      const r = candidate.host.getBoundingClientRect(),
        cx = Math.max(r.left, Math.min(ev.clientX, r.right)),
        cy = Math.max(r.top, Math.min(ev.clientY, r.bottom)),
        d = Math.hypot(ev.clientX - cx, ev.clientY - cy);
      if (d < dist) {
        dist = d;
        best = candidate;
      }
    }
    ev.preventDefault();
    ev.stopPropagation();
    openUnifiedParameterRoutingMenuForId(best.def.id, ev.clientX, ev.clientY);
  });
}
function installParameterRoutingContextTarget(def, el, host) {
  if (!def || !el || !host) return;
  host.dataset.routingParamId = def.id;
  host.classList.add('parameter-routing-control');
  if (host.dataset.parameterRoutingContextBound !== '1') {
    host.dataset.parameterRoutingContextBound = '1';
    host.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      ev.stopImmediatePropagation?.();
      openUnifiedParameterRoutingMenuForId(def.id, ev.clientX, ev.clientY);
    });
  }
  const row =
    blueMorphParameterRowFor(el) ||
    el.closest?.('.control-row') ||
    el.closest?.('.fill-settings-block') ||
    el.closest?.('.control-group-title') ||
    el.closest?.('label') ||
    el.parentElement;
  addParameterRoutingRowCandidate(row, def, host);
}
if (!window.__somataRoutingFrameContextCaptureInstalled) {
  window.__somataRoutingFrameContextCaptureInstalled = true;
  document.addEventListener(
    'contextmenu',
    (ev) => {
      // On touch the same long press is reserved for the bottom dock.
      if (
        window.matchMedia('(max-width:760px), (max-height:480px) and (hover:none) and (pointer:coarse)')
          .matches
      )
        return;
      if (ev.target?.closest?.('.parameter-routing-context-menu')) return;
      // Spiral order is a subsetting of the Spiral block. Resolve it
      // before the parent row's generic parameter-routing capture.
      if (
        ev.target?.closest?.('#spiralOrderControl') &&
        !ev.target?.closest?.('input,select,textarea,button')
      ) {
        ev.preventDefault();
        ev.stopImmediatePropagation();
        openUnifiedParameterRoutingMenuForId('spiral.order', ev.clientX, ev.clientY);
        return;
      }
      const control = ev.target?.closest?.('.parameter-routing-control');
      if (control && control !== ev.target?.closest?.('input,select,textarea,button')) {
        const id = control.dataset.routingParamId;
        if (id) {
          ev.preventDefault();
          ev.stopImmediatePropagation();
          openUnifiedParameterRoutingMenuForId(id, ev.clientX, ev.clientY);
          return;
        }
      }
      const row = ev.target?.closest?.('.parameter-routing-row');
      if (!row) return;
      const interactive = ev.target?.closest?.('input,select,textarea,button,a,[contenteditable="true"]');
      if (interactive) return;
      const candidates = (parameterRoutingRows.get(row) || []).filter((x) => x.host?.isConnected);
      if (!candidates.length) return;
      let best = candidates[0],
        dist = Infinity;
      for (const candidate of candidates) {
        const r = candidate.host.getBoundingClientRect(),
          cx = Math.max(r.left, Math.min(ev.clientX, r.right)),
          cy = Math.max(r.top, Math.min(ev.clientY, r.bottom)),
          d = Math.hypot(ev.clientX - cx, ev.clientY - cy);
        if (d < dist) {
          dist = d;
          best = candidate;
        }
      }
      ev.preventDefault();
      ev.stopImmediatePropagation();
      openUnifiedParameterRoutingMenuForId(best.def.id, ev.clientX, ev.clientY);
    },
    true,
  );
}
function syncParameterAudioTargetBubbles(def, el, host, audioState) {
  const row =
    blueMorphParameterRowFor(el) ||
    el.closest?.('.control-row') ||
    el.closest?.('.fill-settings-block') ||
    el.parentElement;
  if (!row) return;
  const selector = `.parameter-routing-audio-bubbles[data-routing-param="${CSS.escape(def.id)}"]`;
  let strip = row.querySelector(selector);
  const targets = audioState?.targets || window.SomataAudioParameterRoutingUI?.targets?.(def.id) || null;
  const active = [];
  if (targets?.supported !== false) {
    for (const t of (targets?.layers || []).slice(0, 5))
      if (t.active === true)
        active.push({ text: String(t.index + 1), title: `Audio · слой ${t.index + 1}: ${t.label || ''}` });
    if (targets?.master === true) active.push({ text: 'М', title: 'Audio · Master' });
  }
  if (!active.length) {
    strip?.remove();
    return;
  }
  if (!strip) {
    strip = document.createElement('span');
    strip.className = 'parameter-routing-audio-bubbles';
    strip.dataset.routingParam = def.id;
    row.appendChild(strip);
  }
  strip.innerHTML = '';
  for (const item of active) {
    const dot = document.createElement('span');
    dot.className = 'parameter-routing-audio-bubble';
    dot.textContent = item.text;
    dot.title = item.title;
    strip.appendChild(dot);
  }
  row.classList.add('parameter-routing-badge-row');
  const rr = row.getBoundingClientRect(),
    hr = host.getBoundingClientRect();
  strip.style.left = `${Math.max(0, hr.left - rr.left)}px`;
  strip.style.maxWidth = `${Math.max(20, Math.min(hr.width, rr.width))}px`;
}
function syncMorphRouteDecorations() {
  // The suborbit row uses the same Blue/Orange routing outline as
  // ordinary parameters, including when direct editing is disabled.
  const suborbitHost = document.querySelector('#suborbitsContainer .suborbits-routing-range-host');
  if (suborbitHost)
    setParameterRoutingVisualState(
      suborbitHost,
      morphSpecialActive('orbits'),
      false,
      orangeSpecialParameterEnabled('geometry.orbits'),
    );
  syncBlueOrbitSuborbitSlider();
  ensureGenericMorphRangeBindings();
  const profile = getActiveMorphProfile(),
    rows = new Set();
  for (const def of window.SomataParameterRegistry?.morphable?.() || []) {
    const el = document.getElementById(def?.ui?.mainId);
    if (!el) continue;
    const morph = morphParameterRoutingState(def.id),
      orange = orangeParameterRoutingState(def.id),
      audio = parameterRoutingAudioState(def.id),
      host = parameterRoutingVisualHost(def, el);
    setParameterRoutingVisualState(
      host,
      morph.active === true,
      audio.active === true,
      orange.active === true,
    );
    el.classList.toggle('morph-route-control-enabled', morph.active === true || orange.active === true);
    installParameterRoutingContextTarget(def, el, host);
    syncParameterAudioTargetBubbles(def, el, host, audio);
    const row =
      blueMorphParameterRowFor(el) ||
      el.closest?.('.control-row') ||
      el.closest?.('.fill-settings-block') ||
      el.closest?.('.control-group-title') ||
      el.closest?.('label') ||
      el.parentElement;
    if (row) rows.add(row);
  }
  for (const row of rows) {
    const list = parameterRoutingRows.get(row) || [],
      anyMorph = list.some((x) => morphParameterRoutingState(x.def.id).active === true);
    row.classList.toggle('morph-route-enabled', anyMorph);
  }
  syncGenericMorphRangeBindings();
  if (parameterRoutingPopupId && !parameterRoutingPopup?.classList.contains('hidden')) {
    const r = parameterRoutingPopup.getBoundingClientRect();
    renderParameterRoutingPopup(parameterRoutingPopupId, r.left, r.top);
  }
}
window.__syncParameterRoutingDecorations = syncMorphRouteDecorations;

export {
  installParameterRoutingContextTarget,
  openUnifiedParameterRoutingMenuForId,
  parameterRoutingVisualHost,
  renderParameterRoutingPopup,
  setMorphParameterRouteActive,
  syncMorphRouteDecorations,
};
