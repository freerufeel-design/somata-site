// Палитры плейлиста: выбор, смещение тона, студия палитр, быстрое меню, заливка из палитры.
import '../audio/tap-tempo.js'; // initialisation order: this module runs after it
import { syncMotionUI, syncSidebarToolStates } from './effects-sidebar.js';
import {
  DEFAULT_FILL_OPACITY_PERCENT,
  colorBaseHex6,
  ensureSidebarFeatureToggleMemory,
  getFillOpacityPercent,
  getFillOpacityUnit,
  getLayerFillMatchStroke,
  setFillOpacityPercent,
  setLayerStrokeColor,
  syncLayerFillColorToStroke,
} from '../core/defaults-layers.js';
import {
  FACTORY_PLAYLIST_PALETTE_RECORDS,
  PLAYLIST_PALETTE_ORDER,
  applyPlaylistHueOffsetHex,
  ensurePlaylistColorPalettes,
  expandPlaylistPalette,
  factoryPlaylistPaletteRecord,
  getActivePlaylistPaletteKeys,
  getEffectivePlaylistHueOffset,
  getPlaylistPaletteColors,
  getPlaylistPaletteDisplayName,
  getPlaylistPaletteKeys,
  getPlaylistPaletteRecord,
  markPlaylistPaletteEdited,
  morphPaletteSyncEnabled,
  normalizePaletteHex,
  normalizePlaylistHueOffset,
  normalizePlaylistPaletteKey,
  paletteAdjustHex,
  paletteLerpHex,
} from '../core/palette.js';
import { invalidateLayerProperties, invalidateLayerStyle } from '../core/render-runtime.js';
import { requestMainCanvasRender } from '../core/scheduler.js';
import { runtimeState, state } from '../core/state.js';
import { applyMotionColorCycle, motionRuntime, normalizeMotionState } from '../effects/motion.js';
import { tunnelRotateHueHex } from '../corridor/corridor-appearance.js';
import { getLayerEditTargets, updateLayerListUI } from './layer-selection.js';
import { syncSidebarInputs } from './sidebar-sync.js';
import { chooseMorphPaletteInUI } from './blue-morph/profile-bindings.js';
import { syncMorphProfileDirtyUI } from './blue-morph/profiles.js';
import { activeRebaseMinimalMorphing, activeRebaseMorphing } from '../morph-runtime/morph-hooks.js';
import { isAppColorPickerEditingPaletteKey, openAppColorPickerForInput } from './color-picker.js';
import { syncOrangeMorphProfileDirtyUI, syncRandomSettingsUI } from './orange-morph/routing-ui.js';
import { syncMorphSettingsUI } from './morph-settings-panel.js';
import { showShortcutToast } from './header-and-export.js';
import { noteSuppressedError } from '../core/suppressed-errors.js';

let playlistPaletteExpandedKey = '';
const playlistPaletteSelectedIndex = new Map();
let paletteRefreshRaf = 0;
function getSelectedPlaylistPaletteIndex(key, record = getPlaylistPaletteRecord(key)) {
  const max = Math.max(0, (record?.keyColors?.length || 1) - 1);
  const raw = playlistPaletteSelectedIndex.get(key);
  const idx = Number.isInteger(raw) ? Math.max(0, Math.min(max, raw)) : 0;
  playlistPaletteSelectedIndex.set(key, idx);
  return idx;
}
function setSelectedPlaylistPaletteIndex(key, index, record = getPlaylistPaletteRecord(key)) {
  const max = Math.max(0, (record?.keyColors?.length || 1) - 1);
  const idx = Math.max(0, Math.min(max, Math.round(Number(index) || 0)));
  playlistPaletteSelectedIndex.set(key, idx);
  return idx;
}
function ensureSelectedPaletteActive() {
  const active = getActivePlaylistPaletteKeys();
  if (!active.includes(state.morph?.lineColorPalette)) state.morph.lineColorPalette = active[0];
  if (!active.includes(state.randomOptions?.lineColorPalette))
    state.randomOptions.lineColorPalette = active[0];
}
function schedulePlaylistPaletteRuntimeRefresh(key) {
  cancelAnimationFrame(paletteRefreshRaf);
  paletteRefreshRaf = requestAnimationFrame(() => {
    paletteRefreshRaf = 0;
    ensureSelectedPaletteActive();
    renderPlaylistPaletteButtons();

    if (!isAppColorPickerEditingPaletteKey()) renderPlaylistPaletteStudio();
    renderPaletteQuickMenu();
    if (runtimeState.morph?.active && state.morph.options?.byColor && state.morph.lineColorPalette === key) {
      runtimeState.morph.suppressPaletteCycleOnce = true;
      activeRebaseMorphing?.();
    }
    if (runtimeState.minimalMorph?.active && state.randomOptions?.lineColorPalette === key)
      activeRebaseMinimalMorphing?.();
    requestMainCanvasRender();
  });
}
function syncPlaylistPaletteHueOffsetUI() {
  const value = getEffectivePlaylistHueOffset();
  const range = document.getElementById('playlistPaletteHueOffset'),
    num = document.getElementById('playlistPaletteHueOffsetNumber'),
    text = document.getElementById('playlistPaletteHueOffsetText');
  if (range && document.activeElement !== range) range.value = String(Math.round(value));
  if (num && document.activeElement !== num) num.value = String(Math.round(value));
  if (text) text.textContent = `${Math.round(value)}°`;
}
function rotateMorphHslArrayHue(arr, deltaDegrees) {
  const dh = (Number(deltaDegrees) || 0) / 360;
  if (!dh || !Array.isArray(arr)) return;
  for (const hsl of arr) {
    if (hsl && Number.isFinite(Number(hsl.h))) hsl.h = (((Number(hsl.h) + dh) % 1) + 1) % 1;
  }
}
function rotateLayerPaletteHue(layer, deltaDegrees) {
  if (!layer || Math.abs(Number(deltaDegrees) || 0) < 1e-9) return;
  if (typeof layer.strokeColor === 'string')
    layer.strokeColor = tunnelRotateHueHex(layer.strokeColor, deltaDegrees);
  if (typeof layer.fillColor === 'string' && layer.fillColor !== 'transparent')
    layer.fillColor = tunnelRotateHueHex(layer.fillColor, deltaDegrees);
  invalidateLayerStyle(layer, 'playlist-global-hue');
}
function setPlaylistPaletteHueOffset(raw, { rotateScene = true } = {}) {
  const old = normalizePlaylistHueOffset(getEffectivePlaylistHueOffset()),
    next = normalizePlaylistHueOffset(raw),
    delta = next - old;
  state.playlistPaletteHueOffset = next;
  const rt = runtimeState.morph || {};
  rt.frameGlobalHueOffset = next;
  if (rotateScene && Math.abs(delta) > 1e-9) {
    (state.layers || []).forEach((layer) => rotateLayerPaletteHue(layer, delta));
    [
      rt.frameLayers,
      rt.sourceVisuals,
      rt.targetVisuals,
      rt.lightLayers,
      rt.renderSourceLayers,
      rt.renderTargetLayers,
    ].forEach((list) => Array.isArray(list) && list.forEach((layer) => rotateLayerPaletteHue(layer, delta)));
    rotateMorphHslArrayHue(rt.sourceColorHsl, delta);
    rotateMorphHslArrayHue(rt.targetColorHsl, delta);
    rotateMorphHslArrayHue(rt.sourceFillColorHsl, delta);
    rotateMorphHslArrayHue(rt.targetFillColorHsl, delta);

    if (Number.isFinite(Number(rt.sourceGlobalHueOffset)))
      rt.sourceGlobalHueOffset = Number(rt.sourceGlobalHueOffset) + delta;
    if (Number.isFinite(Number(rt.targetGlobalHueOffset)))
      rt.targetGlobalHueOffset = Number(rt.targetGlobalHueOffset) + delta;
    if (Number.isFinite(Number(rt.originGlobalHueOffset)))
      rt.originGlobalHueOffset = Number(rt.originGlobalHueOffset) + delta;
  }
  syncPlaylistPaletteHueOffsetUI();
  refreshPlaylistPaletteHuePreviews();
  renderGraffitiPaletteChooser();
  syncActiveProjectPaletteIndicator();
  requestMainCanvasRender();
  return next;
}
function renderGraffitiPaletteChooser(layer = null) {
  const activeLayer = layer || state.layers.find((l) => l.id === state.activeLayerId);
  const select = document.getElementById('graffitiPaletteSelect');
  const swatches = document.getElementById('graffitiBrightPaletteSwatches');
  if (!select || !swatches) return;
  const keys = getPlaylistPaletteKeys(),
    key = normalizePlaylistPaletteKey(activeLayer?.graffitiPaletteKey, 'standard');
  if (activeLayer) activeLayer.graffitiPaletteKey = key;
  select.innerHTML = '';
  for (const paletteKey of keys) {
    const option = document.createElement('option');
    option.value = paletteKey;
    option.textContent = getPlaylistPaletteDisplayName(paletteKey);
    select.appendChild(option);
  }
  select.value = key;
  select.disabled = !activeLayer || keys.length === 0;
  select.onchange = () => {
    const target = state.layers.find((l) => l.id === state.activeLayerId);
    if (!target) return;
    const paletteKey = normalizePlaylistPaletteKey(select.value, 'standard');
    for (const layer of getLayerEditTargets()) layer.graffitiPaletteKey = paletteKey;
    renderGraffitiPaletteChooser(target);
    requestMainCanvasRender();
  };
  swatches.innerHTML = '';
  const colors = getPlaylistPaletteColors(key);
  colors.forEach((color, index) => {
    const sw = document.createElement('div');
    sw.className = 'color-swatch';
    sw.dataset.color = color;
    sw.dataset.graffitiPaletteSwatch = '1';
    sw.style.background = color;
    sw.title = `${getPlaylistPaletteDisplayName(key)} · цвет ${index + 1}`;
    sw.setAttribute('role', 'button');
    sw.setAttribute('tabindex', '0');
    const apply = () => {
      const target = state.layers.find((l) => l.id === state.activeLayerId);
      if (!target) return;
      let newColor = color;
      for (const layer of getLayerEditTargets()) newColor = setLayerStrokeColor(layer, color);
      const input = document.getElementById('paramStrokeColor');
      if (input) input.value = newColor;
      const hex = document.getElementById('hexStroke');
      if (hex) hex.textContent = newColor;
      const fillInput = document.getElementById('paramFillColor');
      if (fillInput && getLayerFillMatchStroke(target))
        fillInput.value = colorBaseHex6(target.fillColor, newColor);
      updateLayerListUI();
      requestMainCanvasRender();
    };
    sw.addEventListener('click', apply);
    sw.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        apply();
      }
    });
    swatches.appendChild(sw);
  });
}
function renderPlaylistPaletteButtons() {
  ensurePlaylistColorPalettes();
  ensureSelectedPaletteActive();
  const build = (host, context) => {
    if (!host) return;
    host.innerHTML = '';
    const select = document.createElement('select');
    select.className = 'playlist-palette-select';
    select.setAttribute(
      'aria-label',
      context === 'morph' ? 'Палитра синего морфинга' : 'Палитра жёлтого/оранжевого морфинга',
    );
    for (const key of getActivePlaylistPaletteKeys()) {
      const o = document.createElement('option');
      o.value = key;
      o.textContent = getPlaylistPaletteDisplayName(key);
      select.appendChild(o);
    }
    select.value =
      context === 'morph'
        ? normalizePlaylistPaletteKey(state.morph.lineColorPalette)
        : normalizePlaylistPaletteKey(state.randomOptions.lineColorPalette);
    select.addEventListener('change', () => {
      if (context === 'morph') {
        chooseMorphPaletteInUI('blue', select.value);
      } else {
        chooseMorphPaletteInUI('yellow', select.value);
      }
    });
    host.appendChild(select);
  };
  build(document.getElementById('morphLinePalette'), 'morph');
  build(document.getElementById('minimalMorphLinePalette'), 'minimal');
  const motionHost = document.getElementById('motionPaletteHost');
  if (motionHost) {
    motionHost.innerHTML = '';
    const select = document.createElement('select');
    select.className = 'playlist-palette-select';
    select.setAttribute('aria-label', 'Палитра изменения цвета');
    for (const key of getActivePlaylistPaletteKeys()) {
      const o = document.createElement('option');
      o.value = key;
      o.textContent = getPlaylistPaletteDisplayName(key);
      select.appendChild(o);
    }
    const mm = normalizeMotionState();
    select.value = mm.paletteKey;
    select.addEventListener('change', () => {
      mm.paletteKey = select.value;
      motionRuntime.colorPhase = 0;
      if (mm.colorEnabled) applyMotionColorCycle();
      syncMotionUI();
      requestMainCanvasRender();
    });
    motionHost.appendChild(select);
  }
  const mc = document.getElementById('morphCyclePalettes');
  if (mc) mc.checked = state.morph?.cyclePalettes === true;
  for (const id of ['morphFixedColors', 'randomFixedColors', 'morphSyncPalettes', 'randomSyncPalettes']) {
    const e = document.getElementById(id);
    if (e)
      e.checked =
        id === 'morphFixedColors'
          ? state.morph.fixedColors === true
          : id === 'randomFixedColors'
            ? state.randomOptions.fixedColors === true
            : morphPaletteSyncEnabled();
  }
  const rc = document.getElementById('randomCyclePalettes');
  if (rc) rc.checked = state.randomOptions?.cyclePalettes === true;
  const fixed = document.getElementById('randomFixedColors');
  if (fixed) fixed.checked = state.randomOptions?.fixedColors === true;
  const sync = document.getElementById('randomSyncPalettes');
  if (sync) sync.checked = morphPaletteSyncEnabled();
  syncPaletteOptionChecks();
  renderGraffitiPaletteChooser();
}
function syncPlaylistPaletteSelectionUI() {
  renderPlaylistPaletteButtons();
}
function paletteMiniPreview(record, host, quick = false) {
  host.innerHTML = '';
  const colors = record?.keyColors?.length ? record.keyColors : ['#ffffff'];
  colors.forEach((c) => {
    const i = document.createElement(quick ? 'button' : 'i');
    if (quick) {
      i.type = 'button';
      i.className = 'palette-quick-swatch';
      i.title = 'ПКМ — применить эту палитру к текущим фигурам';
    }
    i.dataset.paletteKey = record?.id || '';
    i.dataset.rawColor = normalizePaletteHex(c) || '#ffffff';
    i.style.background = applyPlaylistHueOffsetHex(paletteAdjustHex(c, record));
    host.appendChild(i);
  });
}
function refreshPlaylistPaletteHuePreviews() {
  document.querySelectorAll('[data-palette-key][data-raw-color]').forEach((el) => {
    const key = el.dataset.paletteKey,
      record = key ? getPlaylistPaletteRecord(key) : null,
      raw = normalizePaletteHex(el.dataset.rawColor);
    if (record && raw) el.style.background = applyPlaylistHueOffsetHex(paletteAdjustHex(raw, record));
  });
}
function playlistPaletteTotalCount(record) {
  return expandPlaylistPalette(record).length;
}
function resetPlaylistPalette(key) {
  const palettes = ensurePlaylistColorPalettes(),
    old = palettes[key];
  if (!old) return;
  const keepActive = old.active !== false;
  if (FACTORY_PLAYLIST_PALETTE_RECORDS[key]) palettes[key] = factoryPlaylistPaletteRecord(key);
  else
    palettes[key] = {
      id: key,
      name: old.name || 'Новая палитра',
      keyColors: ['#22d3ee', '#f472b6'],
      multiplier: 1,
      saturation: 100,
      brightness: 50,
      contrast: 50,
      active: true,
      factoryKey: null,
      exactColors: null,
    };
  palettes[key].active = keepActive;
  playlistPaletteExpandedKey = key;
  playlistPaletteSelectedIndex.set(key, 0);
  schedulePlaylistPaletteRuntimeRefresh(key);
  showShortcutToast('Палитра сброшена');
}
function insertPlaylistPaletteKeyColor(key, side) {
  const r = getPlaylistPaletteRecord(key);
  if (!r) return;
  const idx = getSelectedPlaylistPaletteIndex(key, r);
  const colors = r.keyColors;
  const insertAt = side === 'left' ? idx : idx + 1;
  const neighbor = side === 'left' ? colors[idx - 1] : colors[idx + 1];
  const selected = colors[idx] || '#ffffff';
  const nextColor = neighbor ? paletteLerpHex(selected, neighbor, 0.5) : selected;
  markPlaylistPaletteEdited(r);
  colors.splice(insertAt, 0, nextColor);
  setSelectedPlaylistPaletteIndex(key, insertAt, r);
  /* getPlaylistPaletteColors() sees this key immediately, so both morph engines can pick it from the very next random choice. */ renderPlaylistPaletteStudio();
  schedulePlaylistPaletteRuntimeRefresh(key);
}
function removeSelectedPlaylistPaletteKeyColor(key) {
  const r = getPlaylistPaletteRecord(key);
  if (!r) return;
  if (r.keyColors.length <= 2) {
    showShortcutToast('Оставьте минимум два ключевых цвета');
    return;
  }
  const idx = getSelectedPlaylistPaletteIndex(key, r);
  markPlaylistPaletteEdited(r);
  r.keyColors.splice(idx, 1);
  setSelectedPlaylistPaletteIndex(key, Math.min(idx, r.keyColors.length - 1), r);
  renderPlaylistPaletteStudio();
  schedulePlaylistPaletteRuntimeRefresh(key);
}
function paletteVisibleLuminance(raw, record) {
  const h = applyPlaylistHueOffsetHex(paletteAdjustHex(raw, record));
  const vals = [1, 3, 5]
    .map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * vals[0] + 0.7152 * vals[1] + 0.0722 * vals[2];
}
function sortPlaylistPaletteByBrightness(key) {
  const r = getPlaylistPaletteRecord(key);
  if (!r) return;
  const selected = getSelectedPlaylistPaletteIndex(key, r);
  const decorated = r.keyColors.map((color, index) => ({
    color,
    index,
    selected: index === selected,
    lum: paletteVisibleLuminance(color, r),
  }));
  decorated.sort((a, b) => b.lum - a.lum || a.index - b.index);
  markPlaylistPaletteEdited(r);
  r.keyColors = decorated.map((x) => x.color);
  playlistPaletteSelectedIndex.set(
    key,
    Math.max(
      0,
      decorated.findIndex((x) => x.selected),
    ),
  );
  renderPlaylistPaletteStudio();
  schedulePlaylistPaletteRuntimeRefresh(key);
}
function beginPaletteLeftDrag(e, key, record, strip, seg) {
  if (e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  const startX = e.clientX,
    startY = e.clientY;
  let dragging = false;
  setSelectedPlaylistPaletteIndex(key, [...strip.children].indexOf(seg), record);
  strip.querySelectorAll('.palette-key-segment').forEach((el) => el.classList.toggle('selected', el === seg));
  const move = (ev) => {
    if ((ev.buttons & 1) !== 1) return;
    const dx = Math.abs(ev.clientX - startX),
      dy = Math.abs(ev.clientY - startY);
    if (!dragging && Math.max(dx, dy) < 4) return;
    dragging = true;
    seg.classList.add('left-dragging');
    ev.preventDefault();
    ev.stopPropagation();
    const rect = strip.getBoundingClientRect(),
      count = strip.children.length;
    if (!count || rect.width <= 0) return;
    let target = Math.floor(((ev.clientX - rect.left) / rect.width) * count);
    target = Math.max(0, Math.min(count - 1, target));
    const children = [...strip.children],
      current = children.indexOf(seg);
    if (current < 0 || target === current) return;
    if (target > current) strip.insertBefore(seg, strip.children[target]?.nextSibling || null);
    else strip.insertBefore(seg, strip.children[target] || null);
  };
  const finish = (ev) => {
    document.removeEventListener('pointermove', move, true);
    document.removeEventListener('pointerup', finish, true);
    document.removeEventListener('pointercancel', finish, true);
    seg.classList.remove('left-dragging');
    const nodes = [...strip.children],
      newIndex = Math.max(0, nodes.indexOf(seg));
    playlistPaletteSelectedIndex.set(key, newIndex);
    if (dragging) {
      markPlaylistPaletteEdited(record);
      record.keyColors = nodes.map((n) => n.dataset.rawColor || '#ffffff');
      renderPlaylistPaletteStudio();
      schedulePlaylistPaletteRuntimeRefresh(key);
    }
  };

  document.addEventListener('pointermove', move, true);
  document.addEventListener('pointerup', finish, true);
  document.addEventListener('pointercancel', finish, true);
}
function renderPlaylistPaletteStudio() {
  syncPlaylistPaletteHueOffsetUI();
  const host = document.getElementById('playlistPaletteStudioList');
  if (!host) return;
  const palettes = ensurePlaylistColorPalettes();
  host.innerHTML = '';
  for (const key of getPlaylistPaletteKeys()) {
    const record = palettes[key],
      item = document.createElement('div');
    item.className = 'palette-studio-item';
    item.dataset.paletteKey = key;
    const head = document.createElement('div');
    head.className = 'palette-studio-head';
    const active = document.createElement('input');
    active.type = 'checkbox';
    active.checked = record.active !== false;
    active.title = 'Показывать в меню морфинга';
    active.addEventListener('click', (e) => e.stopPropagation());
    active.addEventListener('change', () => {
      if (!active.checked && getActivePlaylistPaletteKeys().length <= 1) {
        active.checked = true;
        showShortcutToast('Хотя бы одна палитра должна быть активной');
        return;
      }
      record.active = active.checked;
      ensureSelectedPaletteActive();
      renderPlaylistPaletteButtons();
      renderPaletteQuickMenu();
    });
    const name = document.createElement('span');
    name.className = 'palette-studio-name';
    name.textContent = record.name;
    name.title = 'ЛКМ — открыть · ПКМ по строке — применить палитру к текущим фигурам';
    const mini = document.createElement('span');
    mini.className = 'palette-key-mini';
    paletteMiniPreview(record, mini, false);
    head.append(active, name, mini);
    head.addEventListener('click', () => {
      playlistPaletteExpandedKey = playlistPaletteExpandedKey === key ? '' : key;
      renderPlaylistPaletteStudio();
    });
    head.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      applyPlaylistPaletteToCurrentLayers(key);
    });
    item.appendChild(head);
    const editor = document.createElement('div');
    editor.className = 'palette-studio-editor' + (playlistPaletteExpandedKey === key ? '' : ' hidden');
    if (playlistPaletteExpandedKey === key) {
      const nameRow = document.createElement('div');
      nameRow.className = 'palette-name-row';
      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.className = 'palette-name-input';
      nameInput.value = record.name;
      nameInput.maxLength = 80;
      nameInput.title = 'Название палитры';
      nameInput.addEventListener('click', (e) => e.stopPropagation());
      nameInput.addEventListener('change', () => {
        record.name = String(nameInput.value || record.name).trim() || record.name;
        renderPlaylistPaletteButtons();
        renderPaletteQuickMenu();
        renderPlaylistPaletteStudio();
      });
      const resetBtn = document.createElement('button');
      resetBtn.type = 'button';
      resetBtn.className = 'palette-reset-btn';
      resetBtn.textContent = '↻';
      resetBtn.title = 'Сбросить палитру к стандартным значениям';
      resetBtn.setAttribute('aria-label', 'Сбросить палитру');
      resetBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        resetPlaylistPalette(key);
      });
      nameRow.append(nameInput, resetBtn);
      editor.appendChild(nameRow);
      const selectedIndex = getSelectedPlaylistPaletteIndex(key, record);
      const strip = document.createElement('div');
      strip.className = 'palette-key-strip';
      strip.title = 'ЛКМ — выбрать · ЛКМ-drag — переставить · ПКМ — изменить цвет';
      strip.addEventListener('contextmenu', (e) => e.preventDefault());
      record.keyColors.forEach((color, index) => {
        const seg = document.createElement('span');
        seg.className = 'palette-key-segment' + (index === selectedIndex ? ' selected' : '');
        seg.style.background = applyPlaylistHueOffsetHex(paletteAdjustHex(color, record));
        seg.dataset.rawColor = normalizePaletteHex(color) || '#ffffff';
        seg.dataset.paletteKey = key;
        seg.title = `${index === 0 ? 'Основной цвет палитры · ' : ''}ЛКМ — выбрать · ЛКМ-drag — переставить · ПКМ — редактировать`;
        const input = document.createElement('input');
        input.type = 'color';
        input.value = normalizePaletteHex(color) || '#ffffff';
        input.addEventListener('input', () => {
          const currentIndex = [...strip.children].indexOf(seg);
          if (currentIndex < 0) return;
          markPlaylistPaletteEdited(record);
          record.keyColors[currentIndex] = input.value.toLowerCase();
          seg.dataset.rawColor = record.keyColors[currentIndex];
          seg.style.background = applyPlaylistHueOffsetHex(
            paletteAdjustHex(record.keyColors[currentIndex], record),
          );
          schedulePlaylistPaletteRuntimeRefresh(key);
        });
        seg.addEventListener('pointerdown', (e) => beginPaletteLeftDrag(e, key, record, strip, seg));
        seg.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const currentIndex = [...strip.children].indexOf(seg);
          setSelectedPlaylistPaletteIndex(key, currentIndex, record);
          strip
            .querySelectorAll('.palette-key-segment')
            .forEach((el) => el.classList.toggle('selected', el === seg));
          openAppColorPickerForInput(input, e.clientX, e.clientY, `Ключевой цвет · ${record.name}`);
        });
        seg.appendChild(input);
        strip.appendChild(seg);
      });
      editor.appendChild(strip);
      const actions = document.createElement('div');
      actions.className = 'palette-key-actions';
      const rem = document.createElement('button');
      rem.type = 'button';
      rem.textContent = '− удалить';
      rem.title = 'Удалить выбранный красной рамкой цвет';
      rem.addEventListener('click', () => removeSelectedPlaylistPaletteKeyColor(key));
      const addLeft = document.createElement('button');
      addLeft.type = 'button';
      addLeft.textContent = '＋ слева';
      addLeft.title = 'Добавить цвет слева от выбранного';
      addLeft.addEventListener('click', () => insertPlaylistPaletteKeyColor(key, 'left'));
      const addRight = document.createElement('button');
      addRight.type = 'button';
      addRight.textContent = '＋ справа';
      addRight.title = 'Добавить цвет справа от выбранного';
      addRight.addEventListener('click', () => insertPlaylistPaletteKeyColor(key, 'right'));
      const sort = document.createElement('button');
      sort.type = 'button';
      sort.textContent = '☀ яркость';
      sort.title = 'Выстроить ключевые цвета от самого яркого к самому тёмному';
      sort.addEventListener('click', () => sortPlaylistPaletteByBrightness(key));
      actions.append(rem, addLeft, addRight, sort);
      editor.appendChild(actions);
      if (!record.factoryKey) {
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'palette-delete-palette-btn';
        del.textContent = 'Удалить палитру';
        del.addEventListener('click', () => {
          if (!confirm(`Удалить палитру «${record.name}»?`)) return;
          delete palettes[key];
          playlistPaletteSelectedIndex.delete(key);
          playlistPaletteExpandedKey = '';
          ensureSelectedPaletteActive();
          renderPlaylistPaletteButtons();
          renderPlaylistPaletteStudio();
          renderPaletteQuickMenu();
        });
        editor.appendChild(del);
      }
      const makeControl = (label, min, max, value, onInput, step = 1) => {
        const row = document.createElement('div');
        row.className = 'palette-editor-control';
        const l = document.createElement('span');
        l.textContent = label;
        const range = document.createElement('input');
        range.type = 'range';
        range.min = min;
        range.max = max;
        range.step = step;
        range.value = value;
        const num = document.createElement('input');
        num.type = 'number';
        num.min = min;
        num.max = max;
        num.step = step;
        num.value = value;
        const update = (v) => {
          range.value = v;
          num.value = v;
          onInput(Number(v));
        };
        range.addEventListener('input', () => update(range.value));
        num.addEventListener('input', () => update(num.value));
        row.append(l, range, num);
        return row;
      };
      editor.appendChild(
        makeControl('Мультипликатор цветов', 1, 5, record.multiplier, (v) => {
          markPlaylistPaletteEdited(record);
          record.multiplier = Math.max(1, Math.min(5, Math.round(v) || 1));
          schedulePlaylistPaletteRuntimeRefresh(key);
        }),
      );
      const total = document.createElement('div');
      total.className = 'palette-total-text';
      total.textContent = `Итого цветов: ${playlistPaletteTotalCount(record)} · ключевых: ${record.keyColors.length} · основной: 1-й слева`;
      editor.appendChild(total);
      editor.appendChild(
        makeControl('Насыщенность', 0, 200, record.saturation, (v) => {
          record.saturation = Math.max(0, Math.min(200, v));
          schedulePlaylistPaletteRuntimeRefresh(key);
        }),
      );
      editor.appendChild(
        makeControl('Яркость', 0, 100, record.brightness, (v) => {
          record.brightness = Math.max(0, Math.min(100, v));
          schedulePlaylistPaletteRuntimeRefresh(key);
        }),
      );
      editor.appendChild(
        makeControl('Контрастность', 0, 100, record.contrast, (v) => {
          record.contrast = Math.max(0, Math.min(100, v));
          schedulePlaylistPaletteRuntimeRefresh(key);
        }),
      );
    }
    item.appendChild(editor);
    host.appendChild(item);
  }
}
function createPlaylistPalette() {
  const palettes = ensurePlaylistColorPalettes();
  let i = 1,
    key;
  do {
    key = `custom_${Date.now().toString(36)}_${i++}`;
  } while (palettes[key]);
  palettes[key] = {
    id: key,
    name: `Новая палитра ${Object.keys(palettes).filter((k) => !PLAYLIST_PALETTE_ORDER.includes(k)).length + 1}`,
    keyColors: ['#22d3ee', '#f472b6'],
    multiplier: 1,
    saturation: 100,
    brightness: 50,
    contrast: 50,
    active: true,
    factoryKey: null,
    exactColors: null,
  };
  playlistPaletteSelectedIndex.set(key, 0);
  playlistPaletteExpandedKey = key;
  renderPlaylistPaletteButtons();
  renderPlaylistPaletteStudio();
  renderPaletteQuickMenu();
}
function syncActiveProjectPaletteIndicator() {
  const key = normalizePlaylistPaletteKey(
      state.activeProjectPaletteKey || state.morph?.lineColorPalette || 'standard',
      'standard',
    ),
    colors = getPlaylistPaletteColors(key),
    pb = document.getElementById('btnSidebarPalette');
  if (pb && colors.length) {
    pb.classList.add('palette-project-active');
    pb.style.color = colors[0];
    pb.style.borderColor = colors[0];
    pb.title = `Палитра проекта: ${getPlaylistPaletteDisplayName(key)} · ПКМ — заливка вкл/выкл · Shift+ПКМ — быстрое меню`;
  }
  return key;
}
function applyPlaylistPaletteToCurrentLayers(key) {
  key = normalizePlaylistPaletteKey(key, 'standard');
  const colors = getPlaylistPaletteColors(key);
  if (!colors.length || !state.layers?.length) return;
  state.activeProjectPaletteKey = key;
  state.morph.lineColorPalette = key;
  state.morph.options.byColor = true;
  state.randomOptions.lineColorPalette = key;
  state.randomOptions.byColor = true;
  try {
    normalizeMotionState().paletteKey = key;
  } catch (error) {
    noteSuppressedError('ui/playlist-palettes#applyPlaylistPaletteToCurrentLayers', error);
  }
  state.layers.forEach((layer, i) => {
    const c = colors[i % colors.length];
    setLayerStrokeColor(layer, c);
    layer.paletteKey = key;
    if (layer.particles) layer.particles.paletteKey = key;
    if (layer.fill && !getLayerFillMatchStroke(layer) && typeof layer.fillColor === 'string') {
      const alpha = Math.max(0, Math.min(255, Math.round(getFillOpacityUnit(layer.fillColor) * 255)))
        .toString(16)
        .padStart(2, '0');
      layer.fillColor = c + alpha;
    }
    invalidateLayerStyle(layer, 'playlist-palette');
  });
  if (runtimeState.morph?.active) {
    runtimeState.morph.suppressPaletteCycleOnce = true;
    try {
      activeRebaseMorphing?.();
    } catch (error) {
      noteSuppressedError('ui/playlist-palettes#applyPlaylistPaletteToCurrentLayers', error);
    }
  }
  if (runtimeState.minimalMorph?.active)
    try {
      activeRebaseMinimalMorphing?.();
    } catch (error) {
      noteSuppressedError('ui/playlist-palettes#applyPlaylistPaletteToCurrentLayers', error);
    }
  renderPaletteQuickMenu();
  syncActiveProjectPaletteIndicator();
  syncMorphSettingsUI?.();
  syncRandomSettingsUI?.();
  syncSidebarInputs();
  requestMainCanvasRender();
  showShortcutToast(`Палитра «${getPlaylistPaletteDisplayName(key)}» применена ко всему проекту`);
}
function renderPaletteQuickMenu() {
  const menu = document.getElementById('paletteQuickMenu');
  if (!menu) return;
  menu.innerHTML = '';
  for (const key of getActivePlaylistPaletteKeys()) {
    const record = getPlaylistPaletteRecord(key),
      row = document.createElement('div');
    row.className = 'palette-quick-item';
    row.classList.toggle(
      'active-project-palette',
      normalizePlaylistPaletteKey(
        state.activeProjectPaletteKey || state.morph?.lineColorPalette,
        'standard',
      ) === key,
    );
    const name = document.createElement('span');
    name.textContent = record.name;
    const sw = document.createElement('span');
    sw.className = 'palette-quick-swatches';
    paletteMiniPreview(record, sw, true);
    const apply = (e) => {
      e?.preventDefault?.();
      e?.stopPropagation?.();
      applyPlaylistPaletteToCurrentLayers(key);
    };
    sw.querySelectorAll('.palette-quick-swatch').forEach((el) => {
      el.addEventListener('contextmenu', apply);
      el.addEventListener('click', apply);
    });
    row.addEventListener('contextmenu', apply);
    row.addEventListener('click', apply);
    row.append(name, sw);
    menu.appendChild(row);
  }
}
function togglePaletteQuickMenu(force) {
  const menu = document.getElementById('paletteQuickMenu'),
    btn = document.getElementById('btnSidebarPalette');
  if (!menu || !btn) return;
  const open = typeof force === 'boolean' ? force : menu.classList.contains('hidden');
  if (open) {
    renderPaletteQuickMenu();
    const r = btn.getBoundingClientRect();
    menu.style.left = `${Math.min(window.innerWidth - 230, r.right + 6)}px`;
    menu.style.top = `${Math.min(window.innerHeight - 100, r.top)}px`;
    menu.classList.remove('hidden');
  } else menu.classList.add('hidden');
}
document.addEventListener(
  'pointerdown',
  (e) => {
    const menu = document.getElementById('paletteQuickMenu');
    if (
      menu &&
      !menu.classList.contains('hidden') &&
      !menu.contains(e.target) &&
      !e.target?.closest?.('#btnSidebarPalette')
    )
      menu.classList.add('hidden');
  },
  true,
);
document.getElementById('btnCreatePlaylistPalette')?.addEventListener('click', createPlaylistPalette);
const playlistHueRange = document.getElementById('playlistPaletteHueOffset'),
  playlistHueNumber = document.getElementById('playlistPaletteHueOffsetNumber');
const updatePlaylistHueFrom = (el) => {
  const value = setPlaylistPaletteHueOffset(el?.value, { rotateScene: true });
  if (playlistHueRange && playlistHueRange !== el) playlistHueRange.value = String(Math.round(value));
  if (playlistHueNumber && playlistHueNumber !== el) playlistHueNumber.value = String(Math.round(value));
};
playlistHueRange?.addEventListener('input', () => updatePlaylistHueFrom(playlistHueRange));
playlistHueNumber?.addEventListener('input', () => updatePlaylistHueFrom(playlistHueNumber));
playlistHueNumber?.addEventListener('change', () => updatePlaylistHueFrom(playlistHueNumber));
function rememberMorphFillLayerRange() {
  const memory = ensureSidebarFeatureToggleMemory();
  const min = Math.max(0, Math.min(64, Math.round(Number(state.morph?.fillLayersMin) || 0)));
  const max = Math.max(min, Math.min(64, Math.round(Number(state.morph?.fillLayersMax) || 0)));
  if (max > 0) memory.fillMorphRange = { min, max };
  return memory.fillMorphRange || null;
}
function setLayerFillFromPaletteToggle(layer, enabled) {
  if (!layer) return;
  layer.fill = enabled === true;
  if (layer.fill && getFillOpacityPercent(layer.fillColor, 0) <= 0.001) {
    layer.fillColor = setFillOpacityPercent(
      layer.fillColor || layer.strokeColor,
      DEFAULT_FILL_OPACITY_PERCENT,
      layer.strokeColor || '#4f46e5',
    );
  }
  if (layer.fill && getLayerFillMatchStroke(layer)) syncLayerFillColorToStroke(layer);
  invalidateLayerProperties(layer, ['fill', 'fillColor'], 'palette-fill-toggle');
}
function toggleStaticFillWithMemory() {
  const layers = (state.layers || []).filter(Boolean);
  if (!layers.length) return;
  const memory = ensureSidebarFeatureToggleMemory(),
    enabledIds = layers.filter((layer) => layer.fill === true).map((layer) => layer.id),
    remembered = memory.fillLayers;
  if (enabledIds.length) {
    memory.fillLayers = { armed: true, layerIds: enabledIds.slice() };
    for (const layer of layers) setLayerFillFromPaletteToggle(layer, false);
  } else if (remembered?.armed === true) {
    const ids = new Set(Array.isArray(remembered.layerIds) ? remembered.layerIds : []),
      hasKnown = layers.some((layer) => ids.has(layer.id));
    for (const layer of layers) setLayerFillFromPaletteToggle(layer, hasKnown ? ids.has(layer.id) : true);
    delete memory.fillLayers;
  } else {
    for (const layer of layers) setLayerFillFromPaletteToggle(layer, true);
  }
  syncSidebarInputs();
  syncSidebarToolStates();
  requestMainCanvasRender();
}
function toggleMorphFillWithMemory() {
  if (!state.morph || !runtimeState?.morph?.active) return false;
  const memory = ensureSidebarFeatureToggleMemory();
  const min = Math.max(0, Math.min(64, Math.round(Number(state.morph.fillLayersMin) || 0)));
  const max = Math.max(min, Math.min(64, Math.round(Number(state.morph.fillLayersMax) || 0)));
  const effectiveOn = state.morph.options?.byFillColor === true && max > 0;
  state.morph.options.byFillColor = true;
  if (effectiveOn) {
    memory.fillMorphRange = { min, max };
    state.morph.fillLayersMin = 0;
    state.morph.fillLayersMax = 0;
  } else {
    const saved = memory.fillMorphRange || null;
    let restoreMax = Math.max(1, Math.min(64, Math.round(Number(saved?.max) || 1)));
    let restoreMin = Math.max(1, Math.min(restoreMax, Math.round(Number(saved?.min) || 1)));
    state.morph.fillLayersMin = restoreMin;
    state.morph.fillLayersMax = restoreMax;
  }
  syncMorphSettingsUI();
  activeRebaseMorphing();
  requestMainCanvasRender();
  return true;
}
function togglePaletteFillWithMemory() {
  if (runtimeState?.morph?.active === true) toggleMorphFillWithMemory();
  else toggleStaticFillWithMemory();
}
window.__somataTogglePaletteFill = togglePaletteFillWithMemory;
document.getElementById('btnSidebarPalette')?.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  e.stopPropagation();
  if (e.shiftKey || e.ctrlKey || e.metaKey) togglePaletteQuickMenu();
  else togglePaletteFillWithMemory();
});
// "Менять палитру каждый цикл" and "Фиксированные цвета" live in the Lines > Color block. They are one
// setting for both Blue and Orange morph, so the left-panel boxes drive the per-morph boxes (which keep
// their own change handlers) and show the combined state.
const PALETTE_OPTION_SOURCES = {
  lineCyclePalettes: ['morphCyclePalettes', 'randomCyclePalettes'],
  lineFixedColors: ['morphFixedColors', 'randomFixedColors'],
};
function syncPaletteOptionChecks() {
  const on = {
    lineCyclePalettes: state.morph?.cyclePalettes === true || state.randomOptions?.cyclePalettes === true,
    lineFixedColors: state.morph?.fixedColors === true || state.randomOptions?.fixedColors === true,
  };
  for (const [id, value] of Object.entries(on)) {
    const box = document.getElementById(id);
    if (box) box.checked = value;
  }
}
for (const [id, sources] of Object.entries(PALETTE_OPTION_SOURCES)) {
  document.getElementById(id)?.addEventListener('change', (e) => {
    const value = e.target.checked === true;
    for (const sourceId of sources) {
      const source = document.getElementById(sourceId);
      if (!source || source.checked === value) continue;
      source.checked = value;
      source.dispatchEvent(new Event('change', { bubbles: true }));
    }
    syncPaletteOptionChecks();
  });
}
document.addEventListener('change', (e) => {
  if (Object.values(PALETTE_OPTION_SOURCES).some((ids) => ids.includes(e.target?.id)))
    syncPaletteOptionChecks();
});
document.getElementById('morphCyclePalettes')?.addEventListener('change', (e) => {
  state.morph.cyclePalettes = e.target.checked === true;
});
document.getElementById('randomCyclePalettes')?.addEventListener('change', (e) => {
  state.randomOptions.cyclePalettes = e.target.checked === true;
});
document.getElementById('morphFixedColors')?.addEventListener('change', (e) => {
  state.morph.fixedColors = e.target.checked === true;
  window.SomataMorphParameterRouting?.captureActiveDraft?.(state.morph, state.minimalMorph);
  syncMorphProfileDirtyUI?.();
  if (runtimeState.morph?.active && runtimeState.minimalMorph?.active !== true) {
    runtimeState.morph.suppressPaletteCycleOnce = true;
    activeRebaseMorphing?.();
  }
  syncMorphSettingsUI();
  requestMainCanvasRender();
});
document.getElementById('randomFixedColors')?.addEventListener('change', (e) => {
  state.randomOptions.fixedColors = e.target.checked === true;
  window.SomataOrangeMorphProfiles?.captureDraft?.(
    state.minimalMorph,
    state.randomOptions,
    state.randomLayerCount,
  );
  syncOrangeMorphProfileDirtyUI?.();
  if (runtimeState.minimalMorph?.active) activeRebaseMinimalMorphing?.();
  syncRandomSettingsUI();
  requestMainCanvasRender();
});
for (const id of ['morphSyncPalettes', 'randomSyncPalettes'])
  document.getElementById(id)?.addEventListener('change', (e) => {
    const enabled = e.target.checked === true;
    state.morph.syncPalettesBetweenMorphs = enabled;
    if (enabled) {
      const authority =
        runtimeState.minimalMorph?.active === true
          ? 'yellow'
          : id === 'randomSyncPalettes'
            ? 'yellow'
            : 'blue';
      chooseMorphPaletteInUI(
        authority,
        authority === 'yellow' ? state.randomOptions.lineColorPalette : state.morph.lineColorPalette,
      );
    }
    syncMorphSettingsUI();
    syncRandomSettingsUI();
    requestMainCanvasRender();
  });

export {
  refreshPlaylistPaletteHuePreviews,
  rememberMorphFillLayerRange,
  renderGraffitiPaletteChooser,
  renderPlaylistPaletteButtons,
  renderPlaylistPaletteStudio,
  setSelectedPlaylistPaletteIndex,
  syncActiveProjectPaletteIndicator,
  syncPlaylistPaletteHueOffsetUI,
  syncPaletteOptionChecks,
  syncPlaylistPaletteSelectionUI,
  togglePaletteQuickMenu,
};
