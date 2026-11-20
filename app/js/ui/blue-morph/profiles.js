// Blue Morph: сохранение и переключение профилей, компактные контролы, группы маршрутизации.
import '../parameter-routing-popup.js'; // initialisation order: this module runs after it
import { requestMainCanvasRender } from '../../core/scheduler.js';
import { runtimeState, state } from '../../core/state.js';
import {
  blueMorphParameterRowFor,
  ensureGenericMorphRangeBindings,
  morphAlwaysOnMultiplier,
  morphSpecialActive,
  morphSpecialEnabled,
  morphUiGroup,
  pruneLegacyMorphMultiplierBindings,
  setMorphSpecialRowActive,
  syncBlueMorphParameterDecorations,
} from './parameter-bindings.js';
import {
  appendMorphGroupLabel,
  commitMorphRouteActivationChange,
  ensureMorphProfileState,
  getActiveMorphBindings,
  getActiveMorphProfile,
  getMorphOrderMode,
  morphProfileUiReady,
  renderMorphParameterPicker,
  renderMorphProfileBindings,
  setMorphOrderMode,
  setMorphProfileUiReady,
  setMorphRouteBindingActive,
  syncMorphOrderModeUI,
} from './profile-bindings.js';
import { countMorphLayerExclusions, getMorphLayerFocus, setMorphLayerFocus } from './layer-focus.js';
import {
  installParameterRoutingContextTarget,
  openUnifiedParameterRoutingMenuForId,
  parameterRoutingVisualHost,
  setMorphParameterRouteActive,
  syncMorphRouteDecorations,
} from '../parameter-routing-popup.js';
import {
  activeRebaseMorphing,
  activeStartMorphing,
  activeStopMorphing,
} from '../../morph-runtime/morph-hooks.js';
import { syncRandomSettingsUI } from '../orange-morph/routing-ui.js';
import { syncMorphSettingsUI } from '../morph-settings-panel.js';
import { positionViewportPopup } from '../floating-panels.js';

let morphTransientDecisionDialog = null;
function askTransientMorphProfileDecision(kind = 'blue') {
  return new Promise((resolve) => {
    morphTransientDecisionDialog?.remove?.();
    const overlay = document.createElement('div');
    overlay.className = 'morph-transient-decision-overlay';
    const card = document.createElement('div');
    card.className = 'morph-transient-decision-card';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    const title = document.createElement('strong');
    title.textContent = kind === 'orange' ? 'Новый Orange ещё не сохранён' : 'Новый Morph ещё не сохранён';
    const text = document.createElement('span');
    text.textContent = 'Перед созданием следующего профиля сохраните предыдущий или удалите его.';
    const actions = document.createElement('div');
    actions.className = 'morph-transient-decision-actions';
    const add = (label, action, cls = '') => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = cls;
      b.textContent = label;
      b.addEventListener('click', () => {
        overlay.remove();
        morphTransientDecisionDialog = null;
        resolve(action);
      });
      actions.appendChild(b);
      return b;
    };
    add('Сохранить предыдущий', 'save', 'primary');
    add('Удалить предыдущий', 'discard', 'danger');
    add('Отмена', 'cancel');
    card.append(title, text, actions);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    morphTransientDecisionDialog = overlay;
    overlay.addEventListener('pointerdown', (e) => {
      if (e.target === overlay) {
        overlay.remove();
        morphTransientDecisionDialog = null;
        resolve('cancel');
      }
    });
    setTimeout(() => actions.querySelector('button')?.focus(), 0);
  });
}
function saveCurrentBlueMorphProfile() {
  const routing = window.SomataMorphParameterRouting,
    profile = getActiveMorphProfile();
  if (!routing || !profile) return null;
  let name = null;
  if (profile.transient === true) {
    name = (window.prompt?.('Название профиля морфинга', '') || '').trim();
    if (!name) return null;
  }
  const saved = routing.saveActiveProfile(state.morph, state.minimalMorph, name);
  if (!saved) return null;
  routing.resetRuntime(runtimeState.morph);
  syncMorphProfileUI();
  if (runtimeState.morph?.active) activeRebaseMorphing?.();
  requestMainCanvasRender();
  return saved;
}
async function createNewBlueMorphProfile() {
  const routing = window.SomataMorphParameterRouting;
  if (!routing) return null;
  const current = getActiveMorphProfile();
  if (current?.transient === true) {
    const action = await askTransientMorphProfileDecision('blue');
    if (action === 'cancel') return null;
    if (action === 'save') {
      if (!saveCurrentBlueMorphProfile()) return null;
    } else if (action === 'discard') {
      routing.deleteProfile(state.morph, state.minimalMorph, current.id);
    }
  }
  const wasRunning = runtimeState.morph?.active === true;
  if (wasRunning) activeStopMorphing(false);
  const created = routing.createProfile(state.morph, state.minimalMorph, 'standard', '');
  syncMorphSettingsUI();
  syncMorphProfileUI();
  if (wasRunning) activeStartMorphing();
  return created;
}
function installGenericMorphParameterContextMenus() {
  // Even when gcd(N,K)=1 the number of suborbits is a valid *future*
  // Morph parameter. The numeric controls may remain disabled, but
  // the enclosing row must always accept right-click routing.
  const suborbitsRow = document.getElementById('suborbitsContainer');
  if (suborbitsRow && suborbitsRow.dataset.suborbitsRoutingBound !== '1') {
    suborbitsRow.dataset.suborbitsRoutingBound = '1';
    suborbitsRow.classList.add('suborbits-routing-target');
    suborbitsRow.title = 'ПКМ: назначить количество суборбит на синий или оранжевый морфинг';
    suborbitsRow.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      openUnifiedParameterRoutingMenuForId('geometry.orbits', ev.clientX, ev.clientY);
    });
  }
  ensureGenericMorphRangeBindings();
  for (const def of window.SomataParameterRegistry?.morphable?.() || []) {
    const el = document.getElementById(def?.ui?.mainId);
    if (!el) continue;
    const host = parameterRoutingVisualHost(def, el);
    installParameterRoutingContextTarget(def, el, host);
    if (el.dataset.morphRoutingBound !== '1') {
      el.dataset.morphRoutingBound = '1';
      const oldTitle = String(el.title || '').trim();
      const hint = `ПКМ по рамке: Аудиосвязь / Синий / Оранжевый морфинг для «${def.label}»`;
      el.title = oldTitle ? `${oldTitle} · ${hint}` : hint;
    }
    const row =
      blueMorphParameterRowFor(el) ||
      el.closest?.('.control-row') ||
      el.closest?.('.control-group-title') ||
      el.closest?.('label') ||
      el.parentElement;
    const name =
      row?.querySelector?.('.row-label > span:first-child') ||
      row?.querySelector?.('label > span:first-child') ||
      el.closest?.('label')?.querySelector?.('span') ||
      row?.querySelector?.('.hint-text');
    if (name && name.dataset.morphRoutingLabelBound !== '1') {
      name.dataset.morphRoutingLabelBound = '1';
      name.classList.add('blue-morph-parameter-name');
      name.title = `ПКМ: Аудиосвязь / Синий / Оранжевый морфинг для «${def.label}»`;
      name.addEventListener('contextmenu', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        openUnifiedParameterRoutingMenuForId(def.id, ev.clientX, ev.clientY);
      });
    }
  }
}
function morphProfileDisplayName(profile) {
  return profile?.id === 'standard' && profile?.system === true
    ? 'Основной'
    : String(profile?.name || profile?.id || 'Профиль');
}
function syncMorphProfileDirtyUI() {
  const routing = window.SomataMorphParameterRouting,
    profile = getActiveMorphProfile();
  if (!routing || !profile) return false;
  const dirty = routing.isActiveProfileDirty?.(state.morph, state.minimalMorph) === true,
    transient = profile.transient === true,
    panel = document.getElementById('morphSettingsPanel');
  panel?.classList.toggle('morph-profile-dirty', dirty || transient);
  panel?.classList.toggle('morph-profile-transient', transient);
  const save = document.getElementById('btnSaveMorphProfile'),
    reset = document.getElementById('btnResetMorphProfile');
  if (save) {
    save.disabled = !(dirty || transient);
    save.classList.toggle('dirty', dirty || transient);
    save.title = transient
      ? 'Сохранить новый профиль и задать имя'
      : dirty
        ? 'Сохранить текущий профиль морфа · есть изменения'
        : 'Сохранить текущий профиль морфа';
  }
  if (reset) reset.disabled = !dirty;
  const select = document.getElementById('morphProfileSelect');
  if (select) {
    for (const option of select.options) {
      const p = (state.morph.profiles || []).find((x) => x.id === option.value);
      const unsaved = p?.transient === true ? ' · не сохранён' : '';
      const changed = option.value === profile.id && dirty ? ' · изменён' : '';
      option.textContent = morphProfileDisplayName(p) + unsaved + changed;
    }
  }
  return dirty;
}
function syncMorphPlaybackButton() {
  const mainBtn = document.getElementById('btnMorph'),
    isRunning = runtimeState.morph?.active === true;
  mainBtn?.classList.toggle('active', isRunning);
  mainBtn?.setAttribute('aria-pressed', isRunning ? 'true' : 'false');
  if (mainBtn) mainBtn.title = isRunning ? 'Остановить Morph Profile' : 'Запустить Morph Profile';
}
function syncMorphProfileUI() {
  syncMorphPlaybackButton();
  const routing = window.SomataMorphParameterRouting;
  if (!routing) return;
  const profiles = ensureMorphProfileState(),
    profile = getActiveMorphProfile();
  pruneLegacyMorphMultiplierBindings();
  const select = document.getElementById('morphProfileSelect');
  if (select) {
    const previous = select.value;
    select.innerHTML = '';
    for (const p of profiles) {
      const o = document.createElement('option');
      o.value = p.id;
      o.textContent = morphProfileDisplayName(p);
      select.appendChild(o);
    }
    select.value = profile?.id || previous || 'standard';
  }
  const panel = document.getElementById('morphSettingsPanel');
  panel?.classList.remove('morph-profile-orange');
  const del = document.getElementById('btnDeleteMorphProfile');
  if (del) del.disabled = profile?.system === true;
  const rename = document.getElementById('btnRenameMorphProfile');
  if (rename) rename.disabled = profile?.system === true || profile?.transient === true;
  const master = document.getElementById('btnMorphMasterMode');
  if (master) {
    master.classList.add('active');
    master.setAttribute('aria-pressed', 'true');
    master.disabled = false;
    master.textContent = 'Master';
  }
  if (panel?.classList.contains('hidden')) {
    routing.syncActiveLegacyBindings?.(state.morph, state.minimalMorph);
  } else {
    renderMorphProfileBindings();
    syncMorphOrderModeUI();
    renderMorphParameterPicker();
    renderMorphRoutingTargets();
    renderMorphRoutingGroups();
  }
  syncMorphSidebarSettingsFromState();
  installGenericMorphParameterContextMenus();
  syncMorphRouteDecorations();
  syncMorphProfileDirtyUI();
}
function switchMorphProfile(id) {
  const routing = window.SomataMorphParameterRouting;
  if (!routing) return;
  const wasRunning = runtimeState.morph?.active === true;
  if (wasRunning) activeStopMorphing(false);
  const profile = routing.selectProfile(state.morph, state.minimalMorph, id);
  routing.resetRuntime(runtimeState.morph);
  syncMorphSettingsUI();
  syncMorphProfileUI();
  if (wasRunning) activeStartMorphing();
  requestMainCanvasRender();
  return profile;
}
function installMorphTopSpeedControl() {
  const host = document.getElementById('morphSpeedToolbar'),
    el = document.getElementById('morphSpeedType');
  if (!host || !el || host.dataset.ready === '1') return;
  host.dataset.ready = '1';
  const compact = document.getElementById('morphCompactProfileControls');
  const field = document.createElement('div');
  field.className = 'morph-speed-toolbar-field';
  field.title = 'Тип скорости синего морфинга';
  const text = document.createElement('label');
  text.htmlFor = 'morphSpeedType';
  text.textContent = 'Тип скорости';
  const picker = document.createElement('div');
  picker.className = 'morph-speed-picker';
  picker.setAttribute('role', 'group');
  picker.setAttribute('aria-label', 'Переключение типа скорости');
  const addArrow = (direction, id, word) => {
    const btn = document.createElement('button');
    btn.id = id;
    btn.type = 'button';
    btn.className = 'morph-speed-arrow';
    btn.textContent = direction < 0 ? '◀' : '▶';
    btn.title = word + ' тип скорости';
    btn.setAttribute('aria-label', btn.title);
    btn.addEventListener('click', () => {
      if (el.disabled) return;
      const items = Array.from(el.options).filter((o) => o.value && !o.disabled && !o.hidden);
      if (!items.length) return;
      const i = items.findIndex((o) => o.value === el.value),
        n = i < 0 ? (direction > 0 ? 0 : items.length - 1) : (i + direction + items.length) % items.length;
      if (items[n].value !== el.value) {
        el.value = items[n].value;
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    return btn;
  };
  picker.append(
    addArrow(-1, 'btnMorphSpeedPrev', 'Предыдущий'),
    el,
    addArrow(1, 'btnMorphSpeedNext', 'Следующий'),
  );
  field.append(text, picker);
  (compact || host).appendChild(field);
  const cycle = document.getElementById('morphInterval')?.closest('.morph-setting-row');
  if (cycle) {
    cycle.classList.add('morph-top-cycle-row');
    host.appendChild(cycle);
  }
}
function installMorphCompactProfileControls() {
  const host = document.getElementById('morphCompactProfileControls');
  if (!host || host.dataset.ready === '1') return;
  host.dataset.ready = '1';
  const addSelect = (id, label, title = '') => {
    const el = document.getElementById(id);
    if (!el) return;
    const wrap = document.createElement('label');
    wrap.className = 'morph-compact-profile-field morph-compact-profile-select';
    if (title) wrap.title = title;
    const text = document.createElement('span');
    text.textContent = label;
    wrap.append(text, el);
    host.appendChild(wrap);
  };
  addSelect('morphSlideType', 'Слайдинг', 'Общий тип слайдинга для порядка 0 и ненулевого порядка');
  addSelect('morphMode', 'Тип морфинга', 'Один тип для порядка 0 и ненулевых порядков');
  // Legacy Spiral transport stays in the project data model, not in a second selector.
  installMorphTopSpeedControl();
  const toolbar = document.querySelector('#morphSettingsPanel .morph-profile-toolbar');
  if (toolbar) {
    const flags = document.createElement('div');
    flags.className = 'morph-profile-toolbar-flags';
    const addToolbarCheck = (id, label, title = '') => {
      const el = document.getElementById(id);
      if (!el) return;
      const wrap = document.createElement('label');
      wrap.className = 'morph-profile-toolbar-check';
      if (title) wrap.title = title;
      const text = document.createElement('span');
      text.textContent = label;
      wrap.append(el, text);
      flags.appendChild(wrap);
    };
    addToolbarCheck('morphDefaultActive', 'По умолчанию', 'Автоматически запускать синий морфинг в проекте');
    addToolbarCheck('morphDiversity', 'Разнообразие', 'Получать новые значения параметров в каждом цикле');
    toolbar.appendChild(flags);
  }
  document.querySelector('.morph-default-diversity-row')?.classList.add('morph-compact-source-row');
  document.querySelector('.morph-speed-slide-row')?.classList.add('morph-compact-source-row');
  document.querySelector('.morph-mode-card')?.classList.add('morph-mode-card-compact-source');
}
function installMorphSidebarSettings() {
  const panel = document.getElementById('morphSettingsPanel'),
    grid = panel?.querySelector('.morph-settings-grid');
  if (!grid || grid.dataset.sidebarMoved === '1') return;
  grid.dataset.sidebarMoved = '1';
  // 9.1: no extra Morphing card or dangling controls in Geometry.
  // Restore legacy tool nodes to the Morph panel, where their bindings live.
  const oldCard = document.querySelector('#geometrySettingsGroup > .morph-sidebar-section');
  if (oldCard) {
    const tools = oldCard.querySelector('.morph-checkbox-tools');
    const heading = panel.querySelector('.morph-settings-title');
    if (tools && heading) heading.appendChild(tools);
    const fade = oldCard.querySelector('#morphFadeDurationRow');
    if (fade) grid.appendChild(fade);
    oldCard.remove();
  }
  // 7.11.1: cycle period belongs with the top Blue timing controls, not in the left sidebar.
  // 7.10.5: artistic Line/Fill/Geometry/Lamps controls live only in the central Morph routing UI.
  // Legacy DOM controls stay in the hidden compatibility grid so the existing Blue engine keeps its state contract.
  // Shape is a real compound Standard Morph row in the central routing list.
  // Its legacy DOM stays inside the hidden compatibility grid and remains the engine state source.
  grid.classList.add('morph-compat-grid');
}
function syncMorphSidebarSettingsFromState() {
  const map = {
    morphVertexMin: state.morph.vertexMin,
    morphVertexMax: state.morph.vertexMax,
    morphStepMin: state.morph.stepMin,
    morphStepMax: state.morph.stepMax,
    morphRoundingMin: state.morph.roundingMin,
    morphRoundingMax: state.morph.roundingMax,
    morphRotationMin: state.morph.rotationMinPercent,
    morphRotationMax: state.morph.rotationMaxPercent,
    morphOpacityMin: state.morph.opacityMin,
    morphOpacityMax: state.morph.opacityMax,
    morphStrokeWidthMin: state.morph.strokeWidthMin,
    morphStrokeWidthMax: state.morph.strokeWidthMax,
    morphFillOpacityMin: state.morph.fillOpacityMin,
    morphFillOpacityMax: state.morph.fillOpacityMax,
  };
  for (const [id, v] of Object.entries(map)) {
    const el = document.getElementById(id);
    if (el && document.activeElement !== el && v != null) el.value = String(v);
  }
}
function renderMorphRoutingTargets() {
  const host = document.getElementById('morphRoutingTargets');
  if (!host) return;
  host.innerHTML = '';
  const focus = getMorphLayerFocus();
  const select = (id) => {
    setMorphLayerFocus(id);
    renderMorphRoutingTargets();
    renderMorphProfileBindings();
  };
  const makeChip = (className, active, title, onPick) => {
    const chip = document.createElement('div');
    chip.className = `audio-routing-layer morph-routing-target ${className}${active ? ' active' : ''}`;
    chip.setAttribute('role', 'button');
    chip.tabIndex = 0;
    chip.setAttribute('aria-pressed', active ? 'true' : 'false');
    chip.title = title;
    chip.addEventListener('click', onPick);
    chip.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      onPick();
    });
    return chip;
  };
  const master = makeChip(
    'morph-routing-target-master',
    focus == null,
    'Master: настройки связей для всех слоёв',
    () => select(null),
  );
  const masterDot = document.createElement('span');
  masterDot.className = 'audio-routing-layer-dot morph-master-dot';
  const masterText = document.createElement('span');
  masterText.textContent = 'Master';
  master.append(masterDot, masterText);
  host.appendChild(master);
  const profile = getActiveMorphProfile();
  const bindings = profile?.type === 'standard' ? getActiveMorphBindings(profile) : [];
  for (const layer of state.layers || []) {
    const excluded = countMorphLayerExclusions(bindings, layer.id);
    const b = makeChip(
      excluded ? 'morph-routing-target-layer has-exclusions' : 'morph-routing-target-layer',
      focus != null && String(layer.id) === focus,
      excluded
        ? `Слой исключён из параметров Morph: ${excluded}. Нажмите, чтобы выбрать, какие параметры меняют этот слой`
        : 'Выбрать, какие параметры Morph меняют этот слой',
      () => select(layer.id),
    );
    const dot = document.createElement('span');
    dot.className = 'audio-routing-layer-dot';
    dot.style.color = layer.strokeColor || '#94a3b8';
    dot.style.background = layer.strokeColor || '#94a3b8';
    const text = document.createElement('span');
    text.textContent = layer.name || 'Слой';
    b.append(dot, text);
    if (excluded) {
      const badge = document.createElement('span');
      badge.className = 'morph-routing-target-badge';
      badge.textContent = `−${excluded}`;
      b.appendChild(badge);
    }
    host.appendChild(b);
  }
}
let morphRoutingOpenGroup = '';
function closeMorphRoutingGroupMenus() {
  morphRoutingOpenGroup = '';
  document
    .querySelectorAll('.audio-route-group-menu[data-morph-routing-group-menu="1"]')
    .forEach((m) => m.classList.add('hidden'));
}
function installMorphRoutingGroupOutsideClose() {
  if (document.documentElement.dataset.morphRoutingGroupOutsideClose === '1') return;
  document.documentElement.dataset.morphRoutingGroupOutsideClose = '1';
  document.addEventListener(
    'pointerdown',
    (e) => {
      const open = [
        ...document.querySelectorAll(
          '.audio-route-group-menu[data-morph-routing-group-menu="1"]:not(.hidden)',
        ),
      ];
      if (!open.length) return;
      if (open.some((m) => m.contains(e.target))) return;
      if (e.target?.closest?.('#morphRoutingGroups .audio-route-group-btn')) return;
      closeMorphRoutingGroupMenus();
    },
    true,
  );
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMorphRoutingGroupMenus();
  });
}
function renderMorphRoutingGroups() {
  const host = document.getElementById('morphRoutingGroups');
  if (!host) return;
  document
    .querySelectorAll('#audioViewportPopupPortal .audio-route-group-menu[data-morph-routing-group-menu="1"]')
    .forEach((m) => m.remove());
  host.innerHTML = '';
  const profile = getActiveMorphProfile();
  if (!profile || profile.type !== 'standard') return;
  window.SomataMorphParameterRouting?.syncActiveLegacyBindings?.(state.morph, state.minimalMorph);
  pruneLegacyMorphMultiplierBindings();
  const defs = window.SomataParameterMatrix.all(),
    defById = new Map(defs.map((d) => [d.id, d])),
    groups = [];
  for (const d of defs) {
    const group = morphUiGroup(d);
    if (!groups.includes(group)) groups.push(group);
  }
  if (!groups.includes('Геометрия')) groups.unshift('Геометрия');
  const isActive = (id) =>
    getActiveMorphBindings(getActiveMorphProfile()).some((b) => b.parameter === id && b.enabled !== false);
  const allBindings = getActiveMorphBindings(profile);
  for (const group of groups) {
    const groupBindings = allBindings.filter(
      (binding) =>
        !morphAlwaysOnMultiplier(binding.parameter) && morphUiGroup(defById.get(binding.parameter)) === group,
    );
    const specialKinds = window.SomataParameterMatrix.special
      .filter((def) => morphUiGroup(def) === group && morphSpecialEnabled(def.kind))
      .map((def) => def.kind);
    const groupCount = groupBindings.length + specialKinds.length;
    const activeCount =
      groupBindings.filter((binding) => binding.enabled !== false).length +
      specialKinds.filter((kind) => morphSpecialActive(kind)).length;
    const wrap = document.createElement('div');
    wrap.className = 'audio-route-group';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'audio-route-group-btn';
    btn.dataset.morphRoutingGroup = group;
    if (groupCount) {
      btn.classList.add(activeCount ? 'morph-group-active' : 'morph-group-idle');
      btn.dataset.morphGroupCount = String(groupCount);
      btn.dataset.morphGroupActive = String(activeCount);
    }
    appendMorphGroupLabel(btn, group, true);
    btn.title = groupCount
      ? activeCount
        ? `${group}: ${activeCount}/${groupCount} активно · ПКМ — выключить все добавленные связи`
        : `${group}: ${groupCount} добавлено, все выключены · ПКМ — включить все`
      : `${group}: связей нет`;
    const menu = document.createElement('div');
    menu.className = 'audio-route-group-menu hidden';
    menu.dataset.morphRoutingGroupMenu = '1';
    menu.dataset.morphRoutingGroup = group;
    const optionsHost = document.createElement('div');
    optionsHost.className = 'morph-group-parameter-options';
    menu.appendChild(optionsHost);
    const render = () => {
      optionsHost.innerHTML = '';
      for (const def of defs.filter((x) => morphUiGroup(x) === group)) {
        let on = false,
          activate = null;
        if (def.kind) {
          on = morphSpecialActive(def.kind);
          activate = () => setMorphSpecialRowActive(def.kind, !on);
        } else {
          on = isActive(def.id);
          activate = () => setMorphParameterRouteActive(def.id, !on);
        }
        const option = document.createElement('button');
        option.type = 'button';
        option.className = 'audio-param-option' + (on ? ' active' : '');
        option.dataset.parameterId = def.id;
        option.textContent = `${on ? '✓ ' : ''}${def.label}`;
        option.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          morphRoutingOpenGroup = group;
          activate();
        });
        optionsHost.appendChild(option);
      }
    };
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const opening = morphRoutingOpenGroup !== group || menu.classList.contains('hidden');
      document.querySelectorAll('.audio-route-group-menu[data-morph-routing-group-menu="1"]').forEach((m) => {
        if (m !== menu) m.classList.add('hidden');
      });
      morphRoutingOpenGroup = opening ? group : '';
      menu.classList.toggle('hidden', !opening);
      if (opening) {
        render();
        positionViewportPopup(menu, btn);
      }
    });
    btn.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!groupCount) return;
      const enableAll = activeCount === 0;
      for (const binding of groupBindings) {
        const def = defById.get(binding.parameter);
        setMorphRouteBindingActive(def, binding, enableAll);
      }
      for (const kind of specialKinds) setMorphSpecialRowActive(kind, enableAll);
      commitMorphRouteActivationChange();
    });
    wrap.append(btn, menu);
    host.appendChild(wrap);
    if (morphRoutingOpenGroup === group)
      requestAnimationFrame(() => {
        if (!btn.isConnected || !menu.isConnected) return;
        render();
        positionViewportPopup(menu, btn);
      });
  }
  installMorphRoutingGroupOutsideClose();
}
function installMorphAudioStyleLayout() {
  const panel = document.getElementById('morphSettingsPanel');
  if (!panel || panel.dataset.audioLayout === '1') return;
  panel.dataset.audioLayout = '1';
  panel.classList.add('morph-audio-routing-panel');
  const title = panel.querySelector('.morph-settings-title');
  title?.classList.add('audio-routing-head');
  const toolbar = panel.querySelector('.morph-profile-toolbar'),
    speedToolbar = document.getElementById('morphSpeedToolbar'),
    routing = panel.querySelector('.morph-parameter-routing-panel');
  const layout = document.createElement('div');
  layout.className = 'morph-routing-layout';
  const targets = document.createElement('div');
  targets.id = 'morphRoutingTargets';
  targets.className = 'audio-routing-layers morph-routing-targets';
  const main = document.createElement('div');
  main.className = 'audio-routing-main morph-routing-main';
  layout.append(targets, main);
  title?.after(layout);
  if (toolbar) {
    toolbar.classList.add('audio-routing-preset-bar', 'morph-routing-preset-bar');
    main.appendChild(toolbar);
  }
  if (speedToolbar) main.appendChild(speedToolbar);
  if (routing) {
    routing.classList.add('morph-routing-shell');
    installMorphCompactProfileControls();
    const head = routing.querySelector('.morph-routing-head');
    if (head) head.classList.add('morph-routing-visible-head');
    const groups = document.createElement('div');
    groups.id = 'morphRoutingGroups';
    groups.className = 'audio-routing-tools morph-routing-groups';
    if (head) head.after(groups);
    else routing.prepend(groups);
    // The original Fade slider exists in the legacy grid, which is
    // display:none in the new routing UI. Move the SAME live controls
    // under the visible type selector, keeping bindings and project state.
    for (const id of ['morphFadeDurationRow']) {
      const row = document.getElementById(id);
      if (row) {
        row.classList.add('morph-fade-live-row');
        groups.before(row);
      }
    }
    const note = document.createElement('div');
    note.className = 'audio-routing-tools-meta morph-routing-tools-meta';
    const hint = document.createElement('span');
    hint.className = 'audio-routing-tools-hint';
    hint.textContent = 'Левой кнопкой выбрать параметр · правой кнопкой вкл/выкл';
    note.appendChild(hint);
    const order = document.getElementById('morphOrderMode');
    if (order) note.appendChild(order);
    groups.after(note);
    const bindings = document.getElementById('morphProfileBindings');
    bindings?.classList.add('audio-routing-rows');
    const add = document.getElementById('btnAddMorphParameter');
    if (add) {
      add.textContent = '＋ Добавить связь';
      add.classList.add('audio-routing-add');
      routing.appendChild(add);
    }
    const picker = document.getElementById('morphParameterPicker');
    picker?.classList.add('audio-param-menu');
    main.appendChild(routing);
  }
  const grid = panel.querySelector('.morph-settings-grid');
  if (grid) {
    grid.classList.add('hidden');
    main.appendChild(grid);
  }
  installMorphSidebarSettings();
  renderMorphRoutingTargets();
  renderMorphRoutingGroups();
}
function setupMorphProfileUI() {
  if (morphProfileUiReady) return;
  setMorphProfileUiReady(true);
  ensureMorphProfileState();
  installMorphAudioStyleLayout();
  const select = document.getElementById('morphProfileSelect');
  select?.addEventListener('change', (e) => switchMorphProfile(e.target.value));
  const createMenu = document.getElementById('morphProfileCreateMenu');
  createMenu?.classList.add('hidden');
  document.getElementById('btnNewMorphProfile')?.addEventListener('click', () => {
    createNewBlueMorphProfile();
  });
  document.getElementById('btnRenameMorphProfile')?.addEventListener('click', () => {
    const p = getActiveMorphProfile();
    if (!p || p.system) return;
    const name = (window.prompt?.('Новое название профиля', p.name) || '').trim();
    if (name) {
      p.name = name;
      syncMorphProfileUI();
    }
  });
  document.getElementById('btnDeleteMorphProfile')?.addEventListener('click', () => {
    const p = getActiveMorphProfile();
    if (!p || p.system) return;
    if (window.confirm?.(`Удалить профиль «${p.name}»?`) === false) return;
    window.SomataMorphParameterRouting.deleteProfile(state.morph, state.minimalMorph, p.id);
    syncMorphSettingsUI();
    syncMorphProfileUI();
  });
  document.getElementById('btnSaveMorphProfile')?.addEventListener('click', () => {
    saveCurrentBlueMorphProfile();
  });
  document.getElementById('btnResetMorphProfile')?.addEventListener('click', () => {
    const routing = window.SomataMorphParameterRouting;
    if (!routing || routing.isActiveProfileDirty?.(state.morph, state.minimalMorph) !== true) return;
    routing.resetActiveProfile(state.morph, state.minimalMorph);
    routing.resetRuntime(runtimeState.morph);
    syncMorphSettingsUI();
    syncRandomSettingsUI();
    syncMorphProfileUI();
    syncBlueMorphParameterDecorations();
    if (runtimeState.morph?.active) activeRebaseMorphing?.();
    requestMainCanvasRender();
  });
  document.getElementById('btnMorphMasterMode')?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    syncMorphProfileUI();
  });
  document.getElementById('btnMorphOrderType')?.addEventListener('click', () => setMorphOrderMode('type'));
  document.getElementById('btnMorphOrderFree')?.addEventListener('click', () => setMorphOrderMode('free'));
  document
    .getElementById('btnMorphOrderToggle')
    ?.addEventListener('click', () => setMorphOrderMode(getMorphOrderMode() === 'type' ? 'free' : 'type'));
  const dirtyEvent = (e) => {
    const el = e.target;
    if (!el) return;
    const id = String(el.id || '');
    if (id.startsWith('morph') || el.closest?.('.morph-sidebar-section'))
      queueMicrotask(() => syncMorphProfileDirtyUI());
  };
  document.addEventListener('input', dirtyEvent, true);
  document.addEventListener('change', dirtyEvent, true);
  const picker = document.getElementById('morphParameterPicker');
  document.getElementById('btnAddMorphParameter')?.addEventListener('click', (e) => {
    e.stopPropagation();
    picker?.classList.toggle('hidden');
    renderMorphParameterPicker();
    if (picker && !picker.classList.contains('hidden')) {
      positionViewportPopup(picker, e.currentTarget);
      document.getElementById('morphParameterSearch')?.focus();
    }
  });
  document.getElementById('morphParameterSearch')?.addEventListener('input', renderMorphParameterPicker);
  // The add-link picker can be portaled outside Morph Settings.
  // Treat its trigger AND the portal as inside; close for every other pointer target.
  document.addEventListener(
    'pointerdown',
    (e) => {
      const popup = document.getElementById('morphParameterPicker');
      const button = document.getElementById('btnAddMorphParameter');
      if (!popup || popup.classList.contains('hidden')) return;
      if (popup.contains(e.target) || button?.contains(e.target)) return;
      popup.classList.add('hidden');
    },
    true,
  );
  syncMorphProfileUI();
}

function setMorphRoutingOpenGroup(value) {
  morphRoutingOpenGroup = value;
  return value;
}

export {
  askTransientMorphProfileDecision,
  morphProfileDisplayName,
  renderMorphRoutingGroups,
  renderMorphRoutingTargets,
  setMorphRoutingOpenGroup,
  setupMorphProfileUI,
  syncMorphProfileDirtyUI,
  syncMorphPlaybackButton,
  syncMorphProfileUI,
  syncMorphSidebarSettingsFromState,
};
