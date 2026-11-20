// Собственный выбор цвета (HSV/HSL/RGB).
import './playlist-palettes.js'; // initialisation order: this module runs after it
import { getPlaylistPaletteRecord, normalizePaletteHex } from '../core/palette.js';
import { renderPlaylistPaletteStudio, setSelectedPlaylistPaletteIndex } from './playlist-palettes.js';
import { noteSuppressedError } from '../core/suppressed-errors.js';

const APP_STANDARD_COLORS = Object.freeze([
  '#ffffff',
  '#e2e8f0',
  '#94a3b8',
  '#475569',
  '#111827',
  '#000000',
  '#fecaca',
  '#fca5a5',
  '#f87171',
  '#ef4444',
  '#dc2626',
  '#991b1b',
  '#fed7aa',
  '#fdba74',
  '#fb923c',
  '#f97316',
  '#ea580c',
  '#9a3412',
  '#fef3c7',
  '#fde68a',
  '#facc15',
  '#eab308',
  '#ca8a04',
  '#854d0e',
  '#d9f99d',
  '#bef264',
  '#84cc16',
  '#65a30d',
  '#4d7c0f',
  '#365314',
  '#bbf7d0',
  '#86efac',
  '#4ade80',
  '#22c55e',
  '#16a34a',
  '#166534',
  '#99f6e4',
  '#5eead4',
  '#2dd4bf',
  '#14b8a6',
  '#0f766e',
  '#134e4a',
  '#a5f3fc',
  '#67e8f9',
  '#22d3ee',
  '#06b6d4',
  '#0e7490',
  '#164e63',
  '#bae6fd',
  '#7dd3fc',
  '#38bdf8',
  '#0ea5e9',
  '#0369a1',
  '#0c4a6e',
  '#bfdbfe',
  '#93c5fd',
  '#60a5fa',
  '#3b82f6',
  '#2563eb',
  '#1e3a8a',
  '#c4b5fd',
  '#a78bfa',
  '#8b5cf6',
  '#7c3aed',
  '#5b21b6',
  '#2e1065',
  '#f5d0fe',
  '#e879f9',
  '#d946ef',
  '#c026d3',
  '#86198f',
  '#4a044e',
  '#fbcfe8',
  '#f9a8d4',
  '#f472b6',
  '#ec4899',
  '#be185d',
  '#831843',
]);
let appColorPickerTarget = null;
let appColorPickerLastValue = '#ffffff';
let appColorPickerMode = 'standard';
let appColorPickerHsv = [0, 0, 100];
function isAppColorPickerEditingPaletteKey() {
  const p = document.getElementById('appColorPicker');
  return Boolean(
    p &&
    !p.classList.contains('hidden') &&
    appColorPickerTarget?.isConnected &&
    appColorPickerTarget.closest?.('.palette-key-segment'),
  );
}
function appHexToRgb(hex) {
  const h = normalizePaletteHex(hex) || '#ffffff';
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}
function appRgbToHex(r, g, b) {
  return (
    '#' +
    [r, g, b]
      .map((v) =>
        Math.max(0, Math.min(255, Math.round(Number(v) || 0)))
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}
function appRgbToHsv(r, g, b) {
  r = Math.max(0, Math.min(255, Number(r) || 0)) / 255;
  g = Math.max(0, Math.min(255, Number(g) || 0)) / 255;
  b = Math.max(0, Math.min(255, Number(b) || 0)) / 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
    if (h < 0) h += 360;
  }
  return [h, max === 0 ? 0 : (d / max) * 100, max * 100];
}
function appHsvToRgb(h, s, v) {
  h = (((Number(h) || 0) % 360) + 360) % 360;
  s = Math.max(0, Math.min(100, Number(s) || 0)) / 100;
  v = Math.max(0, Math.min(100, Number(v) || 0)) / 100;
  const c = v * s,
    x = c * (1 - Math.abs(((h / 60) % 2) - 1)),
    m = v - c;
  let r = 0,
    g = 0,
    b = 0;
  if (h < 60) {
    r = c;
    g = x;
  } else if (h < 120) {
    r = x;
    g = c;
  } else if (h < 180) {
    g = c;
    b = x;
  } else if (h < 240) {
    g = x;
    b = c;
  } else if (h < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}
function appHexToHsl(hex) {
  const [rr, gg, bb] = appHexToRgb(hex),
    r = rr / 255,
    g = gg / 255,
    b = bb / 255,
    max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    d = max - min;
  let hue = 0,
    sat = 0;
  const light = (max + min) / 2;
  if (d) {
    sat = d / (1 - Math.abs(2 * light - 1));
    if (max === r) hue = 60 * (((g - b) / d) % 6);
    else if (max === g) hue = 60 * ((b - r) / d + 2);
    else hue = 60 * ((r - g) / d + 4);
    if (hue < 0) hue += 360;
  }
  return [hue, sat * 100, light * 100];
}
function appHslToHex(h, s, l) {
  h = (((Number(h) || 0) % 360) + 360) % 360;
  s = Math.max(0, Math.min(100, Number(s) || 0)) / 100;
  l = Math.max(0, Math.min(100, Number(l) || 0)) / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s,
    x = c * (1 - Math.abs(((h / 60) % 2) - 1)),
    m = l - c / 2;
  let r = 0,
    g = 0,
    b = 0;
  if (h < 60) {
    r = c;
    g = x;
  } else if (h < 120) {
    r = x;
    g = c;
  } else if (h < 180) {
    g = c;
    b = x;
  } else if (h < 240) {
    g = x;
    b = c;
  } else if (h < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }
  return appRgbToHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}
function bindPleasantRange(range) {
  if (!range) return;
  range.addEventListener('pointerdown', (e) => {
    try {
      range.setPointerCapture(e.pointerId);
    } catch (error) {
      noteSuppressedError('ui/color-picker#bindPleasantRange', error);
    }
  });
  range.addEventListener('pointerup', (e) => {
    try {
      if (range.hasPointerCapture(e.pointerId)) range.releasePointerCapture(e.pointerId);
    } catch (error) {
      noteSuppressedError('ui/color-picker#bindPleasantRange', error);
    }
  });
  range.addEventListener('pointercancel', (e) => {
    try {
      if (range.hasPointerCapture(e.pointerId)) range.releasePointerCapture(e.pointerId);
    } catch (error) {
      noteSuppressedError('ui/color-picker#bindPleasantRange', error);
    }
  });
}
function setAppColorPickerMode(mode) {
  appColorPickerMode = mode === 'radial' ? 'radial' : 'standard';
  const p = ensureAppColorPicker();
  p.querySelectorAll('[data-app-color-mode]').forEach((b) =>
    b.classList.toggle('active', b.dataset.appColorMode === appColorPickerMode),
  );
  p.querySelector('#appColorStandardView')?.classList.toggle('hidden', appColorPickerMode !== 'standard');
  p.querySelector('#appColorRadialView')?.classList.toggle('hidden', appColorPickerMode !== 'radial');
  if (appColorPickerMode === 'radial') syncAppColorRadialUI(appColorPickerLastValue);
}
function ensureAppColorPicker() {
  let panel = document.getElementById('appColorPicker');
  if (panel) return panel;
  panel = document.createElement('div');
  panel.id = 'appColorPicker';
  panel.className = 'app-color-picker hidden';
  panel.innerHTML = `<div class="app-color-picker-head"><strong id="appColorPickerTitle">Цвет</strong><span id="appColorPickerPreview" class="app-color-picker-preview"></span></div>
                <div class="app-color-picker-mode"><button type="button" data-app-color-mode="standard" class="active">Стандартные</button><button type="button" data-app-color-mode="radial">Круг</button></div>
                <div id="appColorStandardView" class="app-color-picker-view">
                    <div class="app-color-picker-row"><span>Тон</span><input id="appColorHue" type="range" min="0" max="359" step="1"><input id="appColorHueN" type="number" min="0" max="359" step="1"></div>
                    <div class="app-color-picker-row"><span>Насыщ.</span><input id="appColorSat" type="range" min="0" max="100" step="1"><input id="appColorSatN" type="number" min="0" max="100" step="1"></div>
                    <div class="app-color-picker-row"><span>Светлота</span><input id="appColorLight" type="range" min="0" max="100" step="1"><input id="appColorLightN" type="number" min="0" max="100" step="1"></div>
                    <div class="app-color-picker-standard-title">Стандарт · быстрые цвета</div><div id="appColorStandard" class="app-color-picker-standard"></div>
                </div>
                <div id="appColorRadialView" class="app-color-picker-view hidden">
                    <div class="app-color-radial-layout">
                        <div id="appColorWheel" class="app-color-wheel" role="slider" aria-label="Тон и насыщенность"><span id="appColorWheelPoint" class="app-color-wheel-point"></span></div>
                        <div class="app-color-rgb-fields">
                            <label class="app-color-rgb-field r"><span>R</span><input id="appColorR" type="number" min="0" max="255" step="1"></label>
                            <label class="app-color-rgb-field g"><span>G</span><input id="appColorG" type="number" min="0" max="255" step="1"></label>
                            <label class="app-color-rgb-field b"><span>B</span><input id="appColorB" type="number" min="0" max="255" step="1"></label>
                        </div>
                        <label class="app-color-value-wrap"><input id="appColorValue" class="app-color-value" type="range" min="0" max="100" step="1" value="100"><span>ярк.</span></label>
                    </div>
                </div>
                <label class="app-color-picker-hex"><span>HEX</span><input id="appColorHex" type="text" maxlength="7" spellcheck="false"></label>`;
  panel.querySelectorAll('[data-app-color-mode]').forEach((b) =>
    b.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      setAppColorPickerMode(b.dataset.appColorMode);
    }),
  );
  const standard = panel.querySelector('#appColorStandard');
  APP_STANDARD_COLORS.forEach((c) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'app-color-standard-swatch';
    b.style.background = c;
    b.title = c.toUpperCase();
    b.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      applyAppColorPickerHex(c, false);
    });
    standard.appendChild(b);
  });
  const ids = [
    ['appColorHue', 'appColorHueN'],
    ['appColorSat', 'appColorSatN'],
    ['appColorLight', 'appColorLightN'],
  ];
  const syncPair = (source, other) => {
    other.value = source.value;
    applyAppColorPickerHsl();
  };
  ids.forEach(([a, b]) => {
    const x = panel.querySelector('#' + a),
      y = panel.querySelector('#' + b);
    bindPleasantRange(x);
    x.addEventListener('input', () => syncPair(x, y));
    y.addEventListener('input', () => syncPair(y, x));
  });
  const value = panel.querySelector('#appColorValue');
  bindPleasantRange(value);
  value.addEventListener('input', () => {
    appColorPickerHsv[2] = Math.max(0, Math.min(100, Number(value.value) || 0));
    applyAppColorPickerHsv();
  });
  ['R', 'G', 'B'].forEach((ch) =>
    panel.querySelector('#appColor' + ch)?.addEventListener('input', applyAppColorPickerRgbFields),
  );
  const wheel = panel.querySelector('#appColorWheel');
  const updateWheel = (e) => {
    const r = wheel.getBoundingClientRect(),
      cx = r.left + r.width / 2,
      cy = r.top + r.height / 2,
      dx = e.clientX - cx,
      dy = e.clientY - cy,
      rad = Math.max(1, Math.min(r.width, r.height) / 2),
      dist = Math.min(rad, Math.hypot(dx, dy));
    let h = (Math.atan2(dy, dx) * 180) / Math.PI;
    if (h < 0) h += 360;
    appColorPickerHsv[0] = h;
    appColorPickerHsv[1] = (dist / rad) * 100;
    applyAppColorPickerHsv();
  };
  wheel.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    try {
      wheel.setPointerCapture(e.pointerId);
    } catch (error) {
      noteSuppressedError('ui/color-picker#ensureAppColorPicker', error);
    }
    updateWheel(e);
  });
  wheel.addEventListener('pointermove', (e) => {
    if (!wheel.hasPointerCapture?.(e.pointerId)) return;
    e.preventDefault();
    updateWheel(e);
  });
  wheel.addEventListener('pointerup', (e) => {
    if (!wheel.hasPointerCapture?.(e.pointerId)) return;
    updateWheel(e);
    try {
      wheel.releasePointerCapture(e.pointerId);
    } catch (error) {
      noteSuppressedError('ui/color-picker#ensureAppColorPicker', error);
    }
  });
  wheel.addEventListener('pointercancel', (e) => {
    try {
      if (wheel.hasPointerCapture(e.pointerId)) wheel.releasePointerCapture(e.pointerId);
    } catch (error) {
      noteSuppressedError('ui/color-picker#ensureAppColorPicker', error);
    }
  });
  const hex = panel.querySelector('#appColorHex');
  hex.addEventListener('input', () => {
    const v = normalizePaletteHex(hex.value);
    if (v) applyAppColorPickerHex(v, false);
  });
  panel.addEventListener('pointerdown', (e) => e.stopPropagation());
  panel.addEventListener('contextmenu', (e) => e.stopPropagation());
  document.body.appendChild(panel);
  return panel;
}
function syncAppColorWheelPoint() {
  const p = ensureAppColorPicker(),
    wheel = p.querySelector('#appColorWheel'),
    point = p.querySelector('#appColorWheelPoint');
  if (!wheel || !point) return;
  const h = ((Number(appColorPickerHsv[0]) || 0) * Math.PI) / 180,
    s = Math.max(0, Math.min(100, Number(appColorPickerHsv[1]) || 0)) / 100;
  point.style.left = `${50 + Math.cos(h) * s * 50}%`;
  point.style.top = `${50 + Math.sin(h) * s * 50}%`;
  point.style.background = appColorPickerLastValue;
}
function syncAppColorRadialUI(hex) {
  const p = ensureAppColorPicker(),
    rgb = appHexToRgb(hex);
  appColorPickerHsv = appRgbToHsv(...rgb);
  ['R', 'G', 'B'].forEach((ch, i) => {
    const el = p.querySelector('#appColor' + ch);
    if (el) el.value = String(rgb[i]);
  });
  const value = p.querySelector('#appColorValue');
  if (value) value.value = String(Math.round(appColorPickerHsv[2]));
  syncAppColorWheelPoint();
}
function syncAppColorPickerControls(hex) {
  const panel = ensureAppColorPicker(),
    normalized = normalizePaletteHex(hex) || '#ffffff',
    [h, s, l] = appHexToHsl(normalized);
  const vals = {
    appColorHue: Math.round(h),
    appColorHueN: Math.round(h),
    appColorSat: Math.round(s),
    appColorSatN: Math.round(s),
    appColorLight: Math.round(l),
    appColorLightN: Math.round(l),
  };
  Object.entries(vals).forEach(([id, v]) => {
    const el = panel.querySelector('#' + id);
    if (el) el.value = String(v);
  });
  const hx = panel.querySelector('#appColorHex');
  if (hx) hx.value = normalized.toUpperCase();
  const prev = panel.querySelector('#appColorPickerPreview');
  if (prev) prev.style.background = normalized;
  appColorPickerLastValue = normalized;
  syncAppColorRadialUI(normalized);
}
function dispatchAppColorInput(hex, commit = false) {
  const target = appColorPickerTarget;
  if (!target || !target.isConnected) return;
  const v = normalizePaletteHex(hex);
  if (!v) return;
  target.value = v;
  appColorPickerLastValue = v;
  target.dispatchEvent(new Event('input', { bubbles: true }));
  if (commit) target.dispatchEvent(new Event('change', { bubbles: true }));
}
function applyAppColorPickerHex(hex, commit = false) {
  const v = normalizePaletteHex(hex);
  if (!v) return;
  dispatchAppColorInput(v, commit);
  syncAppColorPickerControls(v);
}
function applyAppColorPickerHsl() {
  const p = ensureAppColorPicker(),
    h = p.querySelector('#appColorHue').value,
    s = p.querySelector('#appColorSat').value,
    l = p.querySelector('#appColorLight').value;
  const v = appHslToHex(h, s, l);
  dispatchAppColorInput(v, false);
  syncAppColorPickerControls(v);
}
function applyAppColorPickerHsv() {
  const rgb = appHsvToRgb(...appColorPickerHsv),
    v = appRgbToHex(...rgb);
  dispatchAppColorInput(v, false);
  const p = ensureAppColorPicker();
  const hx = p.querySelector('#appColorHex');
  if (hx) hx.value = v.toUpperCase();
  const prev = p.querySelector('#appColorPickerPreview');
  if (prev) prev.style.background = v;
  appColorPickerLastValue = v;
  const rr = appHexToRgb(v);
  ['R', 'G', 'B'].forEach((ch, i) => {
    const el = p.querySelector('#appColor' + ch);
    if (el) el.value = String(rr[i]);
  });
  syncAppColorWheelPoint();
  const [hh, ss, ll] = appHexToHsl(v);
  for (const [id, val] of [
    ['appColorHue', hh],
    ['appColorHueN', hh],
    ['appColorSat', ss],
    ['appColorSatN', ss],
    ['appColorLight', ll],
    ['appColorLightN', ll],
  ]) {
    const el = p.querySelector('#' + id);
    if (el) el.value = String(Math.round(val));
  }
}
function applyAppColorPickerRgbFields() {
  const p = ensureAppColorPicker(),
    rgb = ['R', 'G', 'B'].map((ch) =>
      Math.max(0, Math.min(255, Number(p.querySelector('#appColor' + ch)?.value) || 0)),
    ),
    v = appRgbToHex(...rgb);
  dispatchAppColorInput(v, false);
  syncAppColorPickerControls(v);
}
function openAppColorPickerForInput(input, x, y, title = 'Цвет') {
  if (!(input instanceof HTMLInputElement) || input.type !== 'color') return;
  const panel = ensureAppColorPicker();

  if (appColorPickerTarget && appColorPickerTarget !== input && appColorPickerTarget.isConnected)
    appColorPickerTarget.dispatchEvent(new Event('change', { bubbles: true }));
  appColorPickerTarget = input;
  appColorPickerLastValue = normalizePaletteHex(input.value) || '#ffffff';
  panel.querySelector('#appColorPickerTitle').textContent =
    title || input.getAttribute('aria-label') || input.title || 'Цвет';
  syncAppColorPickerControls(appColorPickerLastValue);
  setAppColorPickerMode(appColorPickerMode);
  panel.classList.remove('hidden');
  requestAnimationFrame(() => {
    const r = panel.getBoundingClientRect(),
      pad = 10;
    const anchor =
      input.closest?.('.palette-key-strip,.palette-studio-item,.display-color-control,label') || input;
    const ar = anchor.getBoundingClientRect();
    let left;
    if (ar.right + 10 + r.width <= window.innerWidth - pad) left = ar.right + 10;
    else if (ar.left - 10 - r.width >= pad) left = ar.left - r.width - 10;
    else left = Number.isFinite(x) ? x : pad;
    let top = Number.isFinite(ar.top) ? ar.top : Number.isFinite(y) ? y : pad;
    left = Math.max(pad, Math.min(window.innerWidth - r.width - pad, left));
    top = Math.max(pad, Math.min(window.innerHeight - r.height - pad, top));
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
  });
}
function closeAppColorPicker(commit = true) {
  const p = document.getElementById('appColorPicker');
  if (!p || p.classList.contains('hidden')) return;
  const wasPaletteKey = Boolean(appColorPickerTarget?.closest?.('.palette-key-segment'));
  if (commit && appColorPickerTarget?.isConnected)
    appColorPickerTarget.dispatchEvent(new Event('change', { bubbles: true }));
  p.classList.add('hidden');
  appColorPickerTarget = null;
  if (wasPaletteKey) renderPlaylistPaletteStudio();
}
function findColorInputForContextTarget(target) {
  if (!(target instanceof Element)) return null;

  if (target.closest?.('#btnBackgroundImage')) return null;
  if (target.matches('input[type="color"]')) return target;
  const direct = target.closest(
    'label,.display-color-control,.palette-key-segment,.color-control,.row-inputs,.floating-display-controls',
  );
  const within = direct?.querySelector?.('input[type="color"]');
  if (within) return within;
  let p = target.parentElement,
    depth = 0;
  while (p && depth++ < 3) {
    const found = p.querySelector?.(':scope > input[type="color"], :scope > * > input[type="color"]');
    if (found) return found;
    p = p.parentElement;
  }
  return null;
}
document.addEventListener(
  'contextmenu',
  (e) => {
    const input = findColorInputForContextTarget(e.target);
    if (!input) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const seg = e.target?.closest?.('.palette-key-segment');
    if (seg) {
      const item = seg.closest('.palette-studio-item'),
        strip = seg.parentElement,
        key = item?.dataset?.paletteKey,
        record = key ? getPlaylistPaletteRecord(key) : null;
      if (key && record && strip) {
        const idx = [...strip.children].indexOf(seg);
        setSelectedPlaylistPaletteIndex(key, idx, record);
        strip
          .querySelectorAll('.palette-key-segment')
          .forEach((el) => el.classList.toggle('selected', el === seg));
      }
    }
    const r = input.getBoundingClientRect();
    const x = Number.isFinite(e.clientX) ? e.clientX : r.left,
      y = Number.isFinite(e.clientY) ? e.clientY : r.bottom + 6;
    openAppColorPickerForInput(input, x, y, input.getAttribute('aria-label') || input.title || 'Цвет');
  },
  true,
);
document.addEventListener(
  'pointerdown',
  (e) => {
    const p = document.getElementById('appColorPicker');
    if (!p || p.classList.contains('hidden') || p.contains(e.target)) return;
    if (e.button === 2 && findColorInputForContextTarget(e.target)) return;
    closeAppColorPicker(true);
  },
  true,
);

export { isAppColorPickerEditingPaletteKey, openAppColorPickerForInput };
