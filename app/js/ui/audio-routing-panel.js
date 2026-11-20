// Аудио: панель маршрутизации.
import '../audio/audio-routing.js'; // initialisation order: this module runs after it
import { requestMainCanvasRender } from '../core/scheduler.js';
import { state } from '../core/state.js';
import { positionViewportPopup } from './floating-panels.js';
import { formatDisplayNumber } from './geometry-n-control.js';
import { showShortcutToast } from './header-and-export.js';
import { AUDIO_BAND_COLORS, AUDIO_PARAM_BY_KEY, AUDIO_PARAM_DEFS } from '../audio/audio-params.js';
import {
  AUDIO_ROUTE_GROUP_SPECS,
  AUDIO_ROUTING_PRESETS,
  addAudioRouteForTarget,
  applyAudioRoutingPreset,
  audioBandValue,
  audioMasterParamsInUse,
  audioMasterRouteRuntime,
  createAudioRoute,
  ensureAudioMasterRouteMultipliers,
  ensureAudioRoutingState,
  getAudioMasterRouteConfig,
  getAudioRouteTargetRows,
  isAudioLayerSignalEnabled,
  isAudioMasterEditActive,
  markAudioRoutingFree,
  mirrorAudioRouteField,
  mirrorAudioRouteParam,
  normalizeAudioSignalMode,
  setAudioLayerSignalEnabled,
  setAudioMasterEditEnabled,
  setAudioMasterRouteConfig,
  setAudioMasterRouteStateRef,
  setAudioRoutingPresetMode,
} from '../audio/audio-routing.js';

function audioRouteTargetName() {
  const id = state.audioReactive.routingTarget || 'master';
  if (id === 'master') return 'Мастер';
  return state.layers.find((l) => l.id === id)?.name || 'Слой';
}
function toggleAudioLayerSignalFromTab(layerId, label = 'Слой') {
  if (!layerId || !state.layers.some((l) => l.id === layerId)) return false;
  state.audioReactive.routingTarget = layerId;
  const next = !isAudioLayerSignalEnabled(layerId);
  setAudioLayerSignalEnabled(layerId, next);
  showShortcutToast(`${label}: аудиосвязь ${next ? 'включена' : 'выключена'}`);
  renderAudioRoutingPanel();
  requestMainCanvasRender();
  return next;
}
function syncAudioRoutingLayerTabs() {
  const host = document.getElementById('audioRoutingLayers');
  if (!host) return;
  ensureAudioRoutingState();
  host.innerHTML = '';
  const add = (id, label, color, isLayer = false) => {
    const signalEnabled = !isLayer || isAudioLayerSignalEnabled(id);
    const b = document.createElement('button');
    b.type = 'button';
    b.className =
      'audio-routing-layer' +
      ((state.audioReactive.routingTarget || 'master') === id ? ' active' : '') +
      (signalEnabled ? '' : ' signal-disabled');
    b.innerHTML =
      '<span class="audio-routing-layer-dot"></span><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></span>';
    const safeColor = /^#[0-9a-f]{3,8}$/i.test(String(color || '')) ? color : '#94a3b8';
    b.firstElementChild.style.color = safeColor;
    b.firstElementChild.style.backgroundColor = safeColor;
    b.lastElementChild.textContent = String(label ?? '');
    b.title = isLayer
      ? signalEnabled
        ? 'ЛКМ — открыть связи слоя · ПКМ — отключить слой от аудиосигнала'
        : 'ЛКМ — открыть связи слоя · ПКМ — снова подключить слой к аудиосигналу'
      : 'Мастер аудиосвязей';
    b.setAttribute('aria-pressed', signalEnabled ? 'true' : 'false');
    if (isLayer) {
      b.dataset.audioLayerId = id;
      b.dataset.audioLayerLabel = label;
    }
    b.addEventListener('click', () => {
      state.audioReactive.routingTarget = id;
      if (id === 'master') setAudioMasterEditEnabled(false);
      renderAudioRoutingPanel();
    });
    host.appendChild(b);
  };
  add('master', 'Мастер', '#f472b6', false);
  state.layers.forEach((l) => add(l.id, l.name, l.strokeColor || '#94a3b8', true));
}
function createAudioRoutingGroupIcon(group, row = false) {
  return (
    window.SomataParameterGroupIcons?.create?.(
      group,
      row ? 'morph-route-row-icon audio-route-row-icon' : 'morph-routing-group-icon audio-routing-group-icon',
    ) || document.createElement('span')
  );
}
function appendAudioGroupLabel(target, group, arrow = false) {
  if (!target) return;
  target.textContent = '';
  const label = document.createElement('span');
  label.className = 'audio-routing-group-label';
  label.appendChild(createAudioRoutingGroupIcon(group, false));
  const name = document.createElement('span');
  name.className = 'audio-routing-group-name';
  name.textContent = group + (arrow ? ' ▾' : '');
  label.appendChild(name);
  target.appendChild(label);
}
// Audio shows one level of *routable* parameters. Matrix descendants with
// working audio adapters are independent options, never nested settings.
// Share this exact list between the group popups and the route picker.
function flatAudioParameterOptions(groupFilter = null) {
  const matrix = window.SomataParameterMatrix;
  const roots = matrix?.all?.() || AUDIO_PARAM_DEFS;
  const items = [],
    seen = new Set();
  const append = (key, label, group) => {
    if (!key || seen.has(key) || !AUDIO_PARAM_BY_KEY.has(key)) return;
    // A multiplier already has a corresponding artistic parameter.
    // Keep it in the registry for old saved routes and live controls,
    // but never offer both as distinct audio-automation parameters.
    const parent = matrix?.parentId?.(key) || String(key).replace(/Multiplier$/, '');
    if (/Multiplier$/.test(key) && parent !== key && AUDIO_PARAM_BY_KEY.has(parent)) return;
    seen.add(key);
    items.push({ key, label, group });
  };
  for (let i = 0; i < roots.length; i++) {
    const def = roots[i],
      group = def.morph?.group || def.group;
    if (groupFilter && group !== groupFilter) continue;
    const key = def.key || def.id;
    append(key, def.label, group);
    for (const child of matrix?.descendants?.(key) || []) {
      append(child.id, child.label || AUDIO_PARAM_BY_KEY.get(child.id)?.label, group);
    }
  }
  return items;
}
function buildAudioParamMenu(container, route, onPick) {
  container.innerHTML = '';
  const input = document.createElement('input');
  input.type = 'search';
  input.className = 'audio-param-search';
  input.placeholder = 'Поиск параметра…';
  container.appendChild(input);
  const body = document.createElement('div');
  container.appendChild(body);
  const render = () => {
    const q = input.value.trim().toLowerCase();
    body.innerHTML = '';
    let last = '';
    const masterTarget = (state.audioReactive.routingTarget || 'master') === 'master';
    for (const def of flatAudioParameterOptions()) {
      if (def.group === 'Коридор' && !masterTarget) continue;
      const hay = `${def.group} ${def.label} ${def.key}`.toLowerCase();
      if (q && !hay.includes(q)) continue;
      if (def.group !== last) {
        const t = document.createElement('div');
        t.className = 'audio-param-group-title';
        appendAudioGroupLabel(t, def.group, false);
        body.appendChild(t);
        last = def.group;
      }
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'audio-param-option' + (route.param === def.key ? ' active' : '');
      b.dataset.parameterId = def.key;
      b.textContent = def.label;
      b.addEventListener('click', () => onPick(def.key));
      body.appendChild(b);
    }
  };
  input.addEventListener('input', render);
  render();
  setTimeout(() => input.focus(), 0);
}
function renderAudioMasterRouteControls(paramKeys) {
  const box = document.getElementById('audioMasterRouteControls'),
    host = document.getElementById('audioMasterRouteControlRows');
  if (!box || !host) return;
  const isMaster = (state.audioReactive.routingTarget || 'master') === 'master';
  const keys = Array.isArray(paramKeys) ? paramKeys : [];
  box.classList.toggle('hidden', !isMaster || !keys.length);
  host.innerHTML = '';
  if (!isMaster || !keys.length) return;
  ensureAudioMasterRouteMultipliers();
  for (const key of keys) {
    const def = AUDIO_PARAM_BY_KEY.get(key);
    if (!def) continue;
    const initial = getAudioMasterRouteConfig(key, true);
    const row = document.createElement('div');
    row.className = 'audio-master-route-row';
    row.dataset.param = key;
    const label = document.createElement('div');
    label.className = 'audio-master-route-label';
    label.appendChild(createAudioRoutingGroupIcon(def.group, true));
    const labelText = document.createElement('span');
    labelText.textContent = `${def.group} › ${def.label}`;
    label.appendChild(labelText);
    label.title = `Мультипликативная регулировка всех существующих связей «${def.label}»`;
    const range = document.createElement('input');
    range.type = 'range';
    range.min = '0';
    range.max = '200';
    range.step = '1';
    range.value = String(initial.strength);
    range.setAttribute('aria-label', `Мастер ${def.label}: сила`);
    const value = document.createElement('div');
    value.className = 'audio-master-route-value';
    const mult = document.createElement('input');
    mult.type = 'number';
    mult.min = '0';
    mult.step = 'any';
    mult.dataset.logMultiplier = '1';
    mult.value = String(initial.multiplier);
    mult.title = 'Мастер-множитель связи';
    mult.setAttribute('aria-label', `Мастер ${def.label}: множитель`);
    const polarity = document.createElement('button');
    polarity.type = 'button';
    polarity.className = 'audio-master-polarity-btn';
    const paint = () => {
      const cfg = getAudioMasterRouteConfig(key, true);
      value.textContent = `${Math.round(cfg.strength)}% × ${formatDisplayNumber(cfg.multiplier, 2)}`;
      const minus = cfg.polarity === 'minus';
      polarity.textContent = minus ? '−' : '＋';
      polarity.classList.toggle('polarity-minus', minus);
      polarity.classList.toggle('polarity-plus', !minus);
      polarity.title = minus ? 'Инвертировать общий сигнал этого типа' : 'Обычное направление общего сигнала';
    };
    const sync = () => {
      const cfg = setAudioMasterRouteConfig(key, {
        strength: Number(range.value),
        multiplier: Number(mult.value),
      });

      range.value = String(cfg.strength);
      mult.value = String(cfg.multiplier);
      paint();
      requestMainCanvasRender();
    };
    range.addEventListener('input', sync);
    range.addEventListener('change', sync);
    mult.addEventListener('input', sync);
    mult.addEventListener('change', sync);
    polarity.addEventListener('click', () => {
      const cfg = getAudioMasterRouteConfig(key, true);
      setAudioMasterRouteConfig(key, { polarity: cfg.polarity === 'minus' ? 'plus' : 'minus' });
      paint();
      requestMainCanvasRender();
    });
    value.addEventListener('dblclick', (e) => {
      e.preventDefault();
      setAudioMasterRouteConfig(key, {
        strength: 100,
        multiplier: 1,
        polarity: key === 'lamps.softness' ? 'minus' : 'plus',
      });
      range.value = '100';
      mult.value = '1';
      paint();
      requestMainCanvasRender();
    });
    paint();
    row.append(label, range, value, mult, polarity);
    host.appendChild(row);
  }
}
function renderAudioRoutingPanel() {
  const panel = document.getElementById('audioRoutingPanel');
  if (!panel || panel.classList.contains('hidden')) return;
  ensureAudioRoutingState();
  syncAudioRoutingLayerTabs();
  const isMaster = (state.audioReactive.routingTarget || 'master') === 'master';
  if (isMaster) setAudioMasterEditEnabled(false);
  const masterEditBtn = document.getElementById('btnAudioMasterEdit');
  if (masterEditBtn) {
    masterEditBtn.classList.toggle('hidden', isMaster);
    masterEditBtn.classList.toggle('active', !isMaster && isAudioMasterEditActive());
    masterEditBtn.setAttribute('aria-pressed', !isMaster && isAudioMasterEditActive() ? 'true' : 'false');
  }
  const title = document.getElementById('audioRoutingTargetTitle'),
    layerRowsHost = document.getElementById('audioRoutingRows'),
    masterRowsHost = document.getElementById('audioMasterGlobalRows'),
    status = document.getElementById('audioRoutingStatus');
  if (title) title.textContent = audioRouteTargetName();
  if (!layerRowsHost || !masterRowsHost) return;
  layerRowsHost.innerHTML = '';
  masterRowsHost.innerHTML = '';

  document.querySelectorAll('#audioViewportPopupPortal .audio-param-menu').forEach((m) => m.remove());
  const rows = getAudioRouteTargetRows();
  const rowsHost = isMaster ? masterRowsHost : layerRowsHost;
  const masterParams = isMaster ? audioMasterParamsInUse() : [];
  if (status)
    status.textContent = isMaster
      ? `${rows.length} глоб. связ. · ${masterParams.length} мастер-рег.`
      : `${rows.length} связ.${isAudioLayerSignalEnabled(state.audioReactive.routingTarget) ? '' : ' · сигнал выкл.'}`;
  const presetBar = document.getElementById('audioRoutingPresetBar');
  if (presetBar) presetBar.classList.toggle('hidden', !isMaster);
  document.getElementById('audioGroupTunnelWrap')?.classList.toggle('hidden', !isMaster);
  const masterAmplitude = document.getElementById('audioMasterEffectsAmplitude');
  if (masterAmplitude) masterAmplitude.classList.toggle('hidden', !isMaster);
  const addBtn = document.getElementById('btnAddAudioRoute');
  if (addBtn) addBtn.classList.toggle('hidden', isMaster);
  const masterAddBtn = document.getElementById('btnAddAudioMasterRoute');
  if (masterAddBtn) masterAddBtn.classList.toggle('hidden', !isMaster);
  const defaultsLabel = document.getElementById('audioRoutingDefaultsLabel');
  if (defaultsLabel) defaultsLabel.classList.toggle('hidden', !isMaster);
  const ampStrength = document.getElementById('audioMasterEffectsAmplitudeStrength'),
    ampMultiplier = document.getElementById('audioMasterEffectsAmplitudeMultiplier'),
    ampText = document.getElementById('audioMasterEffectsAmplitudeText');
  const ampStrengthValue = Number.isFinite(Number(state.audioReactive.effectsAmplitudeStrength))
    ? Math.max(0, Math.min(200, Number(state.audioReactive.effectsAmplitudeStrength)))
    : 50;
  const ampMultiplierValue = Number.isFinite(Number(state.audioReactive.effectsAmplitudeMultiplier))
    ? Math.max(0, Number(state.audioReactive.effectsAmplitudeMultiplier))
    : 1;
  if (ampStrength) ampStrength.value = String(ampStrengthValue);
  if (ampMultiplier) ampMultiplier.value = String(ampMultiplierValue);
  if (ampText)
    ampText.textContent = `${Math.round(ampStrengthValue)}% × ${formatDisplayNumber(ampMultiplierValue, 2)}`;
  const presetSel = document.getElementById('audioRoutingPreset');
  if (presetSel)
    presetSel.value = AUDIO_ROUTING_PRESETS.has(state.audioReactive.routingPreset)
      ? state.audioReactive.routingPreset
      : 'free';
  renderAudioMasterRouteControls(masterParams);

  const groupRows = rows;
  for (const spec of AUDIO_ROUTE_GROUP_SPECS) {
    const b = document.getElementById(spec.button);
    if (!b) continue;
    const relevant = groupRows.filter((r) => spec.match(AUDIO_PARAM_BY_KEY.get(r?.param) || {}));
    const activeCount = relevant.filter((r) => r?.enabled !== false).length;
    b.classList.remove('group-enabled', 'audio-group-active', 'audio-group-idle');
    if (relevant.length) b.classList.add(activeCount ? 'audio-group-active' : 'audio-group-idle');
    b.dataset.audioGroupCount = String(relevant.length);
    b.dataset.audioGroupActive = String(activeCount);
    b.title = relevant.length
      ? activeCount
        ? `${spec.label}: ${activeCount}/${relevant.length} активно · ПКМ — выключить все добавленные связи`
        : `${spec.label}: ${relevant.length} добавлено, все выключены · ПКМ — включить все`
      : `${spec.label}: связей нет`;
  }
  rows.forEach((route, idx) => {
    const row = document.createElement('div');
    row.className = 'audio-route-row' + (route.enabled === false ? ' disabled' : '');
    row.dataset.band = route.band;
    row.dataset.routeId = route.id;
    row.dataset.derivative = route.derivative === true ? '1' : '0';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = route.enabled !== false;
    cb.title = 'Включить / выключить связь';
    cb.addEventListener('change', () => {
      mirrorAudioRouteField(route, 'enabled', cb.checked);
      if (!isMaster) markAudioRoutingFree();
      renderAudioRoutingPanel();
      requestMainCanvasRender();
    });
    row.appendChild(cb);
    const def = AUDIO_PARAM_BY_KEY.get(route.param) || AUDIO_PARAM_DEFS[0];
    row.appendChild(createAudioRoutingGroupIcon(def.group, true));
    const dot = document.createElement('span');
    dot.className = 'audio-route-band-dot';
    dot.style.setProperty('--band-color', AUDIO_BAND_COLORS[route.band] || '#fff');
    row.appendChild(dot);
    const band = document.createElement('select');
    [
      ['low', 'НЧ'],
      ['lowMid', 'Ниж.СЧ'],
      ['mid', 'СЧ'],
      ['midHigh', 'Ср.ВЧ'],
      ['high', 'ВЧ'],
      ['combined', 'Комбо'],
    ].forEach(([v, t]) => {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = t;
      if (route.band === v) o.selected = true;
      band.appendChild(o);
    });
    band.addEventListener('change', () => {
      mirrorAudioRouteField(route, 'band', band.value);
      if (!isMaster) markAudioRoutingFree();
      renderAudioRoutingPanel();
      requestMainCanvasRender();
    });
    row.appendChild(band);
    const picker = document.createElement('div');
    picker.className = 'audio-param-picker';
    const pickBtn = document.createElement('button');
    pickBtn.type = 'button';
    pickBtn.className = 'audio-param-picker-button';
    pickBtn.textContent = `${def.group} › ${def.label}`;
    const menu = document.createElement('div');
    menu.className = 'audio-param-menu hidden';
    pickBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      document.querySelectorAll('.audio-param-menu').forEach((m) => {
        if (m !== menu) m.classList.add('hidden');
      });
      menu.classList.toggle('hidden');
      if (!menu.classList.contains('hidden')) {
        buildAudioParamMenu(menu, route, (key) => {
          mirrorAudioRouteParam(route, key);
          if (!isMaster) markAudioRoutingFree();
          menu.classList.add('hidden');
          renderAudioRoutingPanel();
          requestMainCanvasRender();
        });
        positionViewportPopup(menu, pickBtn);
      }
    });
    picker.append(pickBtn, menu);
    row.appendChild(picker);
    const modeWrap = document.createElement('div');
    modeWrap.className = 'audio-route-mode-wrap';
    const derivativeLabel = document.createElement('label');
    derivativeLabel.className = 'audio-route-derivative';
    derivativeLabel.title =
      'Производная реагирует на изменение уровня. Внутренне она в 10 раз слабее линейного режима; отображаемый множитель не меняется.';
    const derivativeCb = document.createElement('input');
    derivativeCb.type = 'checkbox';
    derivativeCb.checked = route.derivative === true;
    const derivativeText = document.createElement('span');
    derivativeText.textContent = 'Производная';
    derivativeCb.addEventListener('change', () => {
      mirrorAudioRouteField(route, 'derivative', derivativeCb.checked);
      row.dataset.derivative = route.derivative ? '1' : '0';
      if (!isMaster) markAudioRoutingFree();
      paintAudioRoutingMeters();
      requestMainCanvasRender();
    });
    derivativeLabel.append(derivativeCb, derivativeText);
    modeWrap.appendChild(derivativeLabel);
    {
      route.signalMode = normalizeAudioSignalMode(route.signalMode);
      const modeBtn = document.createElement('button');
      modeBtn.type = 'button';
      modeBtn.className = 'audio-route-signal-mode';
      const paintMode = () => {
        const m = normalizeAudioSignalMode(route.signalMode);
        modeBtn.classList.remove('mode-add', 'mode-median', 'mode-subtract');
        modeBtn.classList.add(`mode-${m}`);
        modeBtn.textContent = m === 'add' ? '＋' : m === 'median' ? '↔' : '−';
        modeBtn.title =
          m === 'add'
            ? 'Сигнал прибавляется к базовому значению'
            : m === 'median'
              ? 'Сигнал движется вокруг медианы 50%'
              : 'Сигнал вычитается из базового значения (инверсия)';
      };
      modeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const next = isMaster
          ? route.signalMode === 'subtract'
            ? 'add'
            : 'subtract'
          : route.signalMode === 'add'
            ? 'median'
            : route.signalMode === 'median'
              ? 'subtract'
              : 'add';
        mirrorAudioRouteField(route, 'signalMode', next);
        if (!isMaster) markAudioRoutingFree();
        paintMode();
        requestMainCanvasRender();
      });
      paintMode();
      modeWrap.appendChild(modeBtn);
    }
    row.appendChild(modeWrap);
    const gain = document.createElement('div');
    gain.className = 'audio-route-gain';
    const range = document.createElement('input');
    range.type = 'range';
    range.min = '0';
    range.max = '200';
    range.step = '1';
    range.value = String(route.strength);
    const gtxt = document.createElement('div');
    gtxt.className = 'audio-route-gain-value editable-mult-summary';
    gtxt.contentEditable = 'true';
    gtxt.title = 'Кликните и введите «ползунок × множитель» вручную';
    const syncGain = () => {
      const next = Math.max(0, Math.min(200, Number(range.value) || 0));
      mirrorAudioRouteField(route, 'strength', next);
      if (!isMaster) markAudioRoutingFree();
      gtxt.textContent = `${Math.round(route.strength)}% × ${formatDisplayNumber(route.multiplier, 2)}`;
      requestMainCanvasRender();
    };
    range.addEventListener('input', syncGain);
    gtxt.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        gtxt.blur();
      }
    });
    gtxt.addEventListener('dblclick', (e) => {
      e.preventDefault();
      route.strength = 100;
      range.value = '100';
      syncGain();
    });
    gtxt.addEventListener('blur', () => {
      const nums = (gtxt.textContent.match(/-?\d+(?:[.,]\d+)?/g) || []).map((x) =>
        Number(x.replace(',', '.')),
      );
      if (nums.length >= 2) {
        range.value = String(Math.max(0, Math.min(200, nums[0])));
        route.strength = Number(range.value);
        mirrorAudioRouteField(route, 'multiplier', Math.max(0, nums[1]));
        mult.value = String(route.multiplier);
      } else if (nums.length === 1) {
        mirrorAudioRouteField(route, 'multiplier', Math.max(0, nums[0]));
        mult.value = String(route.multiplier);
      }
      syncGain();
    });
    gain.append(range, gtxt);
    row.appendChild(gain);
    const mult = document.createElement('input');
    mult.type = 'number';
    mult.min = '0';
    mult.step = 'any';
    mult.dataset.logMultiplier = '1';
    mult.value = String(route.multiplier);
    mult.title = 'Множитель';
    mult.addEventListener('input', () => {
      mirrorAudioRouteField(route, 'multiplier', Math.max(0, Number(mult.value) || 0));
      if (!isMaster) markAudioRoutingFree();
      gtxt.textContent = `${Math.round(route.strength)}% × ${formatDisplayNumber(route.multiplier, 2)}`;
      requestMainCanvasRender();
    });
    mult.addEventListener('change', () => {
      mult.value = String(route.multiplier);
    });
    row.appendChild(mult);
    gtxt.textContent = `${Math.round(route.strength)}% × ${formatDisplayNumber(route.multiplier, 2)}`;
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'audio-route-remove';
    del.textContent = '×';
    del.title = 'Удалить связь';
    del.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();

      const routes = ensureAudioRoutingState(),
        target = state.audioReactive.routingTarget || 'master';
      const canonical =
        target === 'master' ? routes.master : routes.layers[target] || (routes.layers[target] = []);
      const id = String(route.id || '');
      let pos = id ? canonical.findIndex((r) => String(r?.id || '') === id) : -1;
      if (pos < 0) pos = canonical.indexOf(route);
      if (pos >= 0) canonical.splice(pos, 1);
      if (target !== 'master') markAudioRoutingFree();
      renderAudioRoutingPanel();
      requestMainCanvasRender();
    });
    row.appendChild(del);
    rowsHost.appendChild(row);
  });
  paintAudioRoutingMeters();
  window.__syncParameterRoutingDecorations?.();
}
function paintAudioRoutingMeters() {
  // Meter painting is purely presentational. Keep audio modulation active when the
  // routing panel is closed, but do not traverse its rows or mutate DOM every tick.
  const panel = document.getElementById('audioRoutingPanel');
  if (!panel || panel.classList.contains('hidden')) return;
  panel.querySelectorAll('.audio-route-row').forEach((row) => {
    const band = row.dataset.band || 'combined',
      derivative = row.dataset.derivative === '1';
    let level = audioBandValue(band, derivative);
    level = derivative ? Math.max(0, Math.min(1, Math.abs(level))) : Math.max(0, Math.min(1, level));
    // 0.1% visual resolution is finer than the visible meter, and avoids
    // style invalidation for repeated values during Morph / audio analysis.
    const rounded = Math.round(level * 1000) / 1000;
    if (row.__somataMeterLevel !== rounded) {
      row.style.setProperty('--audio-level', String(rounded));
      row.__somataMeterLevel = rounded;
    }
    const dot = row.querySelector('.audio-route-band-dot'),
      color = AUDIO_BAND_COLORS[band] || '#fff';
    if (dot && dot.__somataMeterColor !== color) {
      dot.style.setProperty('--band-color', color);
      dot.__somataMeterColor = color;
    }
  });
}
function toggleAudioRouteGroupWithMemory(spec) {
  const relevant = getAudioRouteTargetRows().filter((r) =>
    spec.match(AUDIO_PARAM_BY_KEY.get(r?.param) || {}),
  );
  if (!relevant.length) {
    showShortcutToast(`Нет связей группы «${spec.label}»`);
    return;
  }
  const enableAll = !relevant.some((r) => r?.enabled !== false);
  for (const route of relevant) mirrorAudioRouteField(route, 'enabled', enableAll);
  if ((state.audioReactive.routingTarget || 'master') !== 'master') markAudioRoutingFree();
  state.audioReactive.groupToggleMemory = {};
  renderAudioRoutingPanel();
  requestMainCanvasRender();
}
function setupAudioRoutingUI() {
  const panel = document.getElementById('audioRoutingPanel'),
    btn = document.getElementById('btnAudioRouting');
  const layerHost = document.getElementById('audioRoutingLayers');
  if (layerHost && layerHost.dataset.rightClickInstalled !== '1') {
    layerHost.dataset.rightClickInstalled = '1';
    const layerButtonFromEvent = (e) => e.target?.closest?.('.audio-routing-layer[data-audio-layer-id]');

    layerHost.addEventListener(
      'mousedown',
      (e) => {
        if (e.button !== 2) return;
        const tab = layerButtonFromEvent(e);
        if (!tab || !layerHost.contains(tab)) return;
        e.preventDefault();
        e.stopPropagation();
        tab.dataset.rightToggleAt = String(performance.now());
        toggleAudioLayerSignalFromTab(tab.dataset.audioLayerId, tab.dataset.audioLayerLabel || 'Слой');
      },
      true,
    );
    layerHost.addEventListener(
      'contextmenu',
      (e) => {
        const tab = layerButtonFromEvent(e);
        if (!tab || !layerHost.contains(tab)) return;
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation?.();
        const last = Number(tab.dataset.rightToggleAt) || 0;
        if (performance.now() - last > 700) {
          tab.dataset.rightToggleAt = String(performance.now());
          toggleAudioLayerSignalFromTab(tab.dataset.audioLayerId, tab.dataset.audioLayerLabel || 'Слой');
        }
        return false;
      },
      true,
    );
    layerHost.addEventListener(
      'auxclick',
      (e) => {
        if (e.button !== 2) return;
        const tab = layerButtonFromEvent(e);
        if (!tab || !layerHost.contains(tab)) return;
        e.preventDefault();
        e.stopPropagation();
      },
      true,
    );
  }
  const setOpen = (open) => {
    panel?.classList.toggle('hidden', !open);
    btn?.classList.toggle('active', open);
    btn?.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) renderAudioRoutingPanel();
    else
      document
        .querySelectorAll('.audio-param-menu,.audio-route-group-menu')
        .forEach((m) => m.classList.add('hidden'));
  };
  btn?.addEventListener('click', (e) => {
    e.stopPropagation();
    setOpen(panel?.classList.contains('hidden') !== false);
  });
  document.getElementById('btnCloseAudioRouting')?.addEventListener('click', () => setOpen(false));
  panel?.addEventListener('click', (e) => e.stopPropagation());
  document.getElementById('btnAudioMasterEdit')?.addEventListener('click', () => {
    if ((state.audioReactive.routingTarget || 'master') === 'master') return;
    setAudioMasterEditEnabled(!isAudioMasterEditActive());
    renderAudioRoutingPanel();
  });
  document.getElementById('btnAddAudioRoute')?.addEventListener('click', () => {
    addAudioRouteForTarget('layer.radius', {
      strength: 100,
      multiplier: 1,
      enabled: true,
      signalMode: 'add',
    });
    markAudioRoutingFree();
    renderAudioRoutingPanel();
    requestMainCanvasRender();
  });
  document.getElementById('btnAddAudioMasterRoute')?.addEventListener('click', () => {
    const routes = ensureAudioRoutingState();
    routes.master.push(createAudioRoute('combined', 'layer.radius', 100, 1, true));
    renderAudioRoutingPanel();
    requestMainCanvasRender();
  });
  const presetSelect = document.getElementById('audioRoutingPreset');
  if (presetSelect) {
    presetSelect.value = AUDIO_ROUTING_PRESETS.has(state.audioReactive.routingPreset)
      ? state.audioReactive.routingPreset
      : 'geometry';
    presetSelect.addEventListener('change', () => applyAudioRoutingPreset(presetSelect.value));
  }
  document.getElementById('btnClearAllAudioRoutes')?.addEventListener('click', () => {
    if (!confirm('Убрать все аудиосвязи из текущего проекта?')) return;
    const routes = ensureAudioRoutingState();
    routes.master = [];
    for (const id of Object.keys(routes.layers || {})) routes.layers[id] = [];
    state.audioReactive.masterRouteMultipliers = {};
    setAudioMasterRouteStateRef(null);
    audioMasterRouteRuntime.clear();
    state.audioReactive.groupToggleMemory = {};
    setAudioRoutingPresetMode('free');
    renderAudioRoutingPanel();
    requestMainCanvasRender();
  });
  const ampStrength = document.getElementById('audioMasterEffectsAmplitudeStrength'),
    ampMultiplier = document.getElementById('audioMasterEffectsAmplitudeMultiplier');
  const syncMasterEffectsAmplitude = () => {
    const pct = Math.max(0, Math.min(200, Number(ampStrength?.value) || 0));
    const mult = Math.max(0, Number(ampMultiplier?.value) || 0);
    state.audioReactive.effectsAmplitudeStrength = pct;
    state.audioReactive.effectsAmplitudeMultiplier = mult;
    if (ampMultiplier) ampMultiplier.value = String(mult);
    const txt = document.getElementById('audioMasterEffectsAmplitudeText');
    if (txt) txt.textContent = `${Math.round(pct)}% × ${formatDisplayNumber(mult, 2)}`;
    requestMainCanvasRender();
  };
  ampStrength?.addEventListener('input', syncMasterEffectsAmplitude);
  ampMultiplier?.addEventListener('input', syncMasterEffectsAmplitude);
  ampMultiplier?.addEventListener('change', syncMasterEffectsAmplitude);
  const defaultsCb = document.getElementById('audioDefaultRoutesEnabled');
  if (defaultsCb) {
    defaultsCb.checked = state.audioReactive.defaultRoutesEnabled !== false;
    defaultsCb.addEventListener('change', () => {
      state.audioReactive.defaultRoutesEnabled = defaultsCb.checked;
    });
  }
  for (const spec of AUDIO_ROUTE_GROUP_SPECS) {
    const b = document.getElementById(spec.button),
      m = document.getElementById(spec.menu);
    if (!b || !m) continue;
    const available = flatAudioParameterOptions(spec.group),
      wrap = b.closest('.audio-route-group');
    if (wrap) wrap.classList.toggle('hidden', available.length === 0);
    if (!available.length) continue;
    appendAudioGroupLabel(b, spec.group || spec.label, true);
    const fill = () => {
      m.innerHTML = '';
      const rows = getAudioRouteTargetRows();
      for (const def of available) {
        const on = rows.some((r) => r?.param === def.key);
        const x = document.createElement('button');
        x.type = 'button';
        x.className = 'audio-param-option' + (on ? ' active' : '');
        x.dataset.parameterId = def.key;
        x.textContent = `${on ? '✓ ' : ''}${def.label}`;
        x.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const target = state.audioReactive.routingTarget || 'master',
            routes = ensureAudioRoutingState();
          const collection =
            target === 'master' ? routes.master : routes.layers[target] || (routes.layers[target] = []);
          const existing = collection.filter((r) => r?.param === def.key);
          if (existing.length) {
            for (let i = collection.length - 1; i >= 0; i--)
              if (collection[i]?.param === def.key) collection.splice(i, 1);
          } else if (target === 'master')
            collection.push(createAudioRoute('combined', def.key, 100, 1, true, false));
          else
            addAudioRouteForTarget(def.key, {
              strength: 100,
              multiplier: 1,
              enabled: true,
              derivative: false,
              signalMode: 'add',
            });
          markAudioRoutingFree();
          renderAudioRoutingPanel();
          fill();
          m.classList.remove('hidden');
          positionViewportPopup(m, b);
          requestMainCanvasRender();
        });
        m.appendChild(x);
      }
    };
    fill();
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      document.querySelectorAll('.audio-route-group-menu').forEach((other) => {
        if (other !== m) other.classList.add('hidden');
      });
      m.classList.toggle('hidden');
      if (!m.classList.contains('hidden')) {
        fill();
        positionViewportPopup(m, b);
      }
    });
    b.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      document.querySelectorAll('.audio-route-group-menu').forEach((other) => other.classList.add('hidden'));
      toggleAudioRouteGroupWithMemory(spec);
    });
  }
  // Close portaled Audio menus even when the click is consumed by an
  // underlying slider/panel. A pointer press inside the active menu
  // or on its trigger is not considered an outside press.
  document.addEventListener(
    'pointerdown',
    (e) => {
      if (panel?.classList.contains('hidden')) return;
      for (const menu of document.querySelectorAll(
        '.audio-param-menu:not(.hidden),.audio-route-group-menu:not(.hidden)',
      )) {
        const owner =
          menu._viewportOwnerPanelId || menu._viewportTrigger?.closest?.('#audioRoutingPanel')?.id;
        if (owner !== 'audioRoutingPanel') continue;
        if (menu.contains(e.target) || menu._viewportTrigger?.contains?.(e.target)) continue;
        menu.classList.add('hidden');
      }
    },
    true,
  );
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Escape') return;
      const open = document.querySelectorAll(
        '#audioViewportPopupPortal .audio-param-menu:not(.hidden),#audioViewportPopupPortal .audio-route-group-menu:not(.hidden)',
      );
      for (const menu of open)
        if (menu._viewportOwnerPanelId === 'audioRoutingPanel') menu.classList.add('hidden');
    },
    true,
  );
  document.addEventListener('click', (e) => {
    const inAudioPopup = Boolean(e.target?.closest?.('#audioViewportPopupPortal'));
    if (
      !inAudioPopup &&
      !panel?.classList.contains('hidden') &&
      !panel.contains(e.target) &&
      e.target !== btn &&
      !btn?.contains(e.target)
    )
      setOpen(false);
    if (!inAudioPopup)
      document
        .querySelectorAll('.audio-param-menu,.audio-route-group-menu')
        .forEach((m) => m.classList.add('hidden'));
  });
  document.addEventListener(
    'contextmenu',
    (e) => {
      if (e.target?.closest?.('#audioRoutingLayers .audio-routing-layer[data-audio-layer-id]')) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    true,
  );
  ensureAudioRoutingState();
  renderAudioRoutingPanel();
}

export {
  audioRouteTargetName,
  paintAudioRoutingMeters,
  renderAudioRoutingPanel,
  setupAudioRoutingUI,
  syncAudioRoutingLayerTabs,
};
