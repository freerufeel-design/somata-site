// Форматирование чисел, контрол N и множители вершин морфа.
import './layer-selection.js'; // initialisation order: this module runs after it
import { state } from '../core/state.js';

function formatDisplayNumber(value, maxDecimals = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  const rounded = Math.round(n * Math.pow(10, maxDecimals)) / Math.pow(10, maxDecimals);
  return Number.isInteger(rounded)
    ? String(rounded)
    : rounded.toFixed(maxDecimals).replace(/0+$/, '').replace(/\.$/, '');
}
function formatTimeSeconds(value) {
  const n = Math.max(0, Number(value) || 0);
  const decimals = n > 0 && n < 0.1 ? 2 : Math.abs(n - Math.round(n)) > 0.001 ? 1 : 0;
  return formatDisplayNumber(n, decimals);
}
// Множитель N слева и множитель вершин в синем Morph — одна величина. Нецелое значение слева
// (например 0.5) в Morph не переносится: там множитель всегда целый.
let nMultiplierLinkBusy = false;
function linkNMultiplierToMorph() {
  if (nMultiplierLinkBusy) return;
  const raw = Number(document.getElementById('paramNMultiplier')?.value);
  if (!Number.isFinite(raw) || raw < 1 || Math.abs(raw - Math.round(raw)) > 1e-9) return;
  const m = normalizeMorphVertexMultiplier(raw);
  const el = document.getElementById('morphVertexMultiplier');
  if (!el || normalizeMorphVertexMultiplier(state.morph?.vertexMultiplier) === m) return;
  nMultiplierLinkBusy = true;
  try {
    el.value = String(m);
    el.dispatchEvent(new Event('change', { bubbles: true })); // обработчик нормализует диапазон N
  } finally {
    nMultiplierLinkBusy = false;
  }
  document.dispatchEvent(new CustomEvent('somata:morph-vertex-multiplier-linked'));
}
function linkMorphMultiplierToN(multiplier) {
  if (nMultiplierLinkBusy) return;
  const el = document.getElementById('paramNMultiplier');
  const m = normalizeMorphVertexMultiplier(multiplier);
  if (!el || el.disabled || Math.abs((Number(el.value) || 1) - m) < 1e-9) return;
  nMultiplierLinkBusy = true;
  try {
    el.value = String(m);
    el.dispatchEvent(new Event('input', { bubbles: true })); // дальше работает обычная логика левой панели
    el.dispatchEvent(new Event('change', { bubbles: true }));
  } finally {
    nMultiplierLinkBusy = false;
  }
}
function getGeometryNMultiplierUI() {
  const raw = Number(document.getElementById('paramNMultiplier')?.value);
  return Number.isFinite(raw) && raw > 0 ? raw : 1;
}
function syncGeometryNControl(effectiveN, fractional = false) {
  const effective = Math.max(2, Math.min(120, Number.isFinite(Number(effectiveN)) ? Number(effectiveN) : 4));
  const range = document.getElementById('paramN'),
    num = document.getElementById('numN'),
    multEl = document.getElementById('paramNMultiplier'),
    label = document.getElementById('valNEffective');
  const layerKey = String(state.activeLayerId ?? '');
  let mult = multEl && multEl.dataset.layerId === layerKey ? getGeometryNMultiplierUI() : 1;
  if (multEl && multEl.dataset.layerId !== layerKey) {
    // Новый слой или загрузка проекта: берём множитель из синего Morph, если он делит N без остатка.
    const linked = normalizeMorphVertexMultiplier(state.morph?.vertexMultiplier);
    const b = effective / linked;
    if (linked > 1 && Math.abs(b - Math.round(b)) < 1e-9 && b >= 2 && b <= 30) mult = linked;
  }
  let base = effective / mult;
  if (base < 2 - 1e-9 || base > 30 + 1e-9) {
    if (effective <= 30) {
      mult = 1;
      base = effective;
    } else {
      mult = Math.max(1, Math.ceil(effective / 30));
      base = effective / mult;
    }
  }
  base = Math.max(2, Math.min(30, base));
  if (range) {
    range.min = '2';
    range.max = '30';
    range.step = fractional ? '0.01' : '1';
    range.value = String(base);
  }
  if (num && document.activeElement !== num) {
    num.min = '2';
    num.max = '30';
    num.step = fractional ? '0.01' : '1';
    num.value = formatDisplayNumber(base, fractional ? 2 : 1);
  }
  if (multEl) {
    multEl.dataset.layerId = layerKey;
    if (document.activeElement !== multEl) multEl.value = formatDisplayNumber(mult, 4);
  }
  if (label)
    label.textContent = `→ ${fractional ? formatDisplayNumber(effective, 2) : Math.round(effective)}`;
}
function geometryNEffectiveFromBase(baseValue) {
  const base = Math.max(2, Math.min(30, Number(baseValue) || 2));
  return Math.max(2, Math.min(120, Math.round(base * getGeometryNMultiplierUI())));
}
function normalizeMorphVertexMultiplier(value) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.max(1, Math.min(60, n)) : 1;
}
function morphVertexAllowedValues(multiplier = state.morph?.vertexMultiplier) {
  const m = normalizeMorphVertexMultiplier(multiplier),
    out = [];
  const first = Math.max(2, Math.ceil(2 / m) * m);
  for (let n = first; n <= 120; n += m) out.push(n);
  return out.length ? out : [Math.min(120, Math.max(2, m))];
}
function normalizeMorphVertexRangeValues(
  minValue,
  maxValue,
  multiplier = state.morph?.vertexMultiplier,
  changedId = '',
) {
  const m = normalizeMorphVertexMultiplier(multiplier),
    allowed = morphVertexAllowedValues(m);
  let rawMin = Math.max(2, Math.min(120, Math.round(Number(minValue) || 4)));
  let rawMax = Math.max(2, Math.min(120, Math.round(Number(maxValue) || 19)));
  if (rawMin > rawMax) {
    if (changedId === 'morphVertexMin') rawMax = rawMin;
    else rawMin = rawMax;
  }
  let minN = allowed.find((n) => n >= rawMin);
  let maxN = [...allowed].reverse().find((n) => n <= rawMax);
  if (minN === undefined || maxN === undefined || minN > maxN) {
    const ref = changedId === 'morphVertexMax' ? rawMax : rawMin;
    const nearest = allowed.reduce(
      (best, n) => (Math.abs(n - ref) < Math.abs(best - ref) ? n : best),
      allowed[0],
    );
    minN = nearest;
    maxN = nearest;
  }
  return { multiplier: m, minN, maxN, allowed };
}

export {
  formatDisplayNumber,
  formatTimeSeconds,
  geometryNEffectiveFromBase,
  linkMorphMultiplierToN,
  linkNMultiplierToMorph,
  normalizeMorphVertexMultiplier,
  normalizeMorphVertexRangeValues,
  syncGeometryNControl,
};
