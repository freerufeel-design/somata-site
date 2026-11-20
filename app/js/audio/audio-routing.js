// Аудио: маршруты, пресеты, мастер-маршрут, применение к параметрам кадра.
import './audio-params.js'; // initialisation order: this module runs after it
import { getActiveAudioBandKeys } from './audio-reactive.js';
import { requestMainCanvasRender } from '../core/scheduler.js';
import { state } from '../core/state.js';
import {
  AUDIO_BAND_INDEX,
  AUDIO_PARAM_BY_KEY,
  AUDIO_PARAM_COMPAT_DEFS,
  AUDIO_PARAM_DEFS,
} from './audio-params.js';
import { audioRouteTargetName, renderAudioRoutingPanel } from '../ui/audio-routing-panel.js';

let audioRouteSerial = 1;
const AUDIO_SIGNAL_MODES = new Set(['add', 'median', 'subtract']);
function normalizeAudioSignalMode(mode) {
  return AUDIO_SIGNAL_MODES.has(mode) ? mode : 'add';
}
function createAudioRoute(
  band = 'low',
  param = 'layer.radius',
  strength = 100,
  multiplier = 1,
  enabled = true,
  derivative = false,
  signalMode = 'add',
) {
  return {
    id: `ar_${Date.now()}_${audioRouteSerial++}`,
    enabled: enabled !== false,
    derivative: derivative === true,
    signalMode: normalizeAudioSignalMode(signalMode),
    band: ['low', 'lowMid', 'mid', 'midHigh', 'high', 'combined'].includes(band) ? band : 'low',
    param: AUDIO_PARAM_BY_KEY.has(param) ? param : 'layer.radius',
    strength: Math.max(0, Math.min(200, Number(strength) || 0)),
    multiplier: Math.max(0, Number(multiplier) || 0),
  };
}
function normalizeAudioRoute(route) {
  if (!route || typeof route !== 'object') return createAudioRoute();
  const r = createAudioRoute(
    route.band,
    route.param,
    route.strength,
    route.multiplier,
    route.enabled,
    route.derivative === true,
    route.signalMode,
  );
  if (route.id) r.id = String(route.id);
  return r;
}
function ensureAudioLayerNativeBand(layer, idx = 0) {
  const available = getActiveAudioBandKeys();
  if (!layer) return routeBandForLayerIndex(idx);
  if (!available.includes(layer.audioNativeBand)) {
    layer.audioNativeBand = routeBandForLayerIndex(idx);
    // A band automatically assigned to a newly created layer can follow
    // future changes in the number of inputs without touching custom routes.
    if (layer.audioNativeBandAuto !== false) layer.audioNativeBandAuto = true;
  }
  return layer.audioNativeBand;
}
function synchronizeAutomaticLayerAudioBands() {
  const available = getActiveAudioBandKeys();
  const routes = state.audioReactive?.routes?.layers || {};
  for (const [idx, layer] of (state.layers || []).entries()) {
    const expected = routeBandForLayerIndex(idx),
      previous = layer.audioNativeBand;
    if (layer.audioNativeBandAuto === true) {
      if (previous !== expected) {
        // Preserve individually edited bindings. Only replace bindings
        // still pointing to the layer's former automatic native band.
        for (const route of Array.isArray(routes[layer.id]) ? routes[layer.id] : []) {
          if (route?.band === previous) route.band = expected;
        }
        layer.audioNativeBand = expected;
      }
    } else if (!available.includes(previous)) {
      // Legacy projects keep their per-route choices intact; only repair
      // the fallback band for NEW bindings on this layer.
      layer.audioNativeBand = expected;
    }
  }
}
function createDefaultAudioRoutesForLayerIndex(idx) {
  if (state.audioReactive?.defaultRoutesEnabled === false) return [];
  const configured = state.audioReactive?.routingPreset;
  // New automatic connections follow the visible preset. In Free mode,
  // retain the historical default (geometry + lamps) for new layers.
  const mode = ['geometry', 'lamps', 'geometryLamps'].includes(configured) ? configured : 'geometryLamps';
  return createPresetRoutesForLayerIndex(idx, mode);
}
const AUDIO_ROUTING_PRESETS = new Set(['free', 'geometry', 'lamps', 'geometryLamps']);
const AUDIO_ROUTE_GROUP_SPECS = [
  {
    button: 'audioGroupGeometry',
    menu: 'audioGroupGeometryMenu',
    label: 'Геометрия',
    group: 'Геометрия',
    match: (d) => d.group === 'Геометрия',
  },
  {
    button: 'audioGroupLine',
    menu: 'audioGroupLineMenu',
    label: 'Линия',
    group: 'Линия',
    match: (d) => d.group === 'Линия',
  },
  {
    button: 'audioGroupFill',
    menu: 'audioGroupFillMenu',
    label: 'Заливка',
    group: 'Заливка',
    match: (d) => d.group === 'Заливка',
  },
  {
    button: 'audioGroupGraffiti',
    menu: 'audioGroupGraffitiMenu',
    label: 'Граффити',
    group: 'Граффити',
    match: (d) => d.group === 'Граффити',
  },
  {
    button: 'audioGroupLamps',
    menu: 'audioGroupLampsMenu',
    label: 'Лампочки',
    group: 'Лампочки',
    match: (d) => d.group === 'Лампочки',
  },
  {
    button: 'audioGroupWeb',
    menu: 'audioGroupWebMenu',
    label: 'Паутина',
    group: 'Паутина',
    match: (d) => d.group === 'Паутина',
  },
  {
    button: 'audioGroupSweep',
    menu: 'audioGroupSweepMenu',
    label: 'Проблеск',
    group: 'Проблеск',
    match: (d) => d.group === 'Проблеск',
  },
  {
    button: 'audioGroupLightning',
    menu: 'audioGroupLightningMenu',
    label: 'Молния',
    group: 'Молния',
    match: (d) => d.group === 'Молния',
  },
  {
    button: 'audioGroupCorridor',
    menu: 'audioGroupCorridorMenu',
    label: 'Коридор',
    group: 'Коридор',
    match: (d) => d.group === 'Коридор',
  },
  {
    button: 'audioGroupAmbient',
    menu: 'audioGroupAmbientMenu',
    label: 'Амбиенты',
    group: 'Амбиенты',
    match: (d) => d.group === 'Амбиенты',
  },
  {
    button: 'audioGroupPrism',
    menu: 'audioGroupPrismMenu',
    label: 'Преломление',
    group: 'Преломление',
    match: (d) => d.group === 'Преломление',
  },
  {
    button: 'audioGroupPalette',
    menu: 'audioGroupPaletteMenu',
    label: 'Палитра',
    group: 'Палитра',
    match: (d) => d.group === 'Палитра',
  },
  {
    button: 'audioGroupLineMotion',
    menu: 'audioGroupLineMotionMenu',
    label: 'Подвижная линия',
    group: 'Подвижная линия',
    match: (d) => d.group === 'Подвижная линия',
  },
  {
    button: 'audioGroupSprite',
    menu: 'audioGroupSpriteMenu',
    label: 'Спрайт линии',
    group: 'Спрайт линии',
    match: (d) => d.group === 'Спрайт линии',
  },
  {
    button: 'audioGroupParticles',
    menu: 'audioGroupParticlesMenu',
    label: 'Частицы',
    group: 'Частицы',
    match: (d) => d.group === 'Частицы',
  },
  {
    button: 'audioGroupSpiral',
    menu: 'audioGroupSpiralMenu',
    label: 'Спирали',
    group: 'Спирали',
    match: (d) => d.group === 'Спирали',
  },
];
function setAudioRoutingPresetMode(mode) {
  const ar = state.audioReactive || (state.audioReactive = {});
  ar.routingPreset = AUDIO_ROUTING_PRESETS.has(mode) ? mode : 'free';
  const sel = document.getElementById('audioRoutingPreset');
  if (sel) sel.value = ar.routingPreset;
}
function routeBandForLayerIndex(idx) {
  const available = getActiveAudioBandKeys();
  return available[Math.max(0, Math.floor(Number(idx) || 0)) % available.length];
}
function createPresetRoutesForLayerIndex(idx, mode) {
  const band = ensureAudioLayerNativeBand(state.layers?.[idx], idx);
  if (mode === 'geometry')
    return [
      createAudioRoute(band, 'layer.radius', 100, 1, true, false),
      createAudioRoute(band, 'layer.rotation', 100, 1, false, false),
    ];
  if (mode === 'lamps')
    return [
      createAudioRoute(band, 'lamps.brightness', 100, 1, true, false),
      createAudioRoute(band, 'lamps.radius', 100, 1, true, false),
      createAudioRoute(band, 'lamps.softness', 100, 1, true, false),
    ];
  if (mode === 'geometryLamps')
    return [
      createAudioRoute(band, 'layer.radius', 100, 1, true, false),
      createAudioRoute(band, 'layer.rotation', 100, 1, false, false),
      createAudioRoute(band, 'lamps.brightness', 100, 1, true, false),
      createAudioRoute(band, 'lamps.radius', 100, 1, true, false),
      createAudioRoute(band, 'lamps.softness', 100, 1, true, false),
    ];
  return null;
}
function applyAudioRoutingPreset(mode) {
  if (!AUDIO_ROUTING_PRESETS.has(mode)) mode = 'free';
  setAudioRoutingPresetMode(mode);
  if (mode === 'free') {
    renderAudioRoutingPanel();
    return;
  }
  const routes = ensureAudioRoutingState();
  state.layers.forEach((layer, idx) => {
    // Explicitly applying a preset also repairs legacy projects where
    // every layer had incorrectly inherited the same low band.
    layer.audioNativeBand = routeBandForLayerIndex(idx);
    layer.audioNativeBandAuto = true;
    routes.layers[layer.id] = createPresetRoutesForLayerIndex(idx, mode) || [];
  });
  renderAudioRoutingPanel();
  requestMainCanvasRender();
}
function markAudioRoutingFree() {
  if (state.audioReactive?.routingPreset !== 'free') setAudioRoutingPresetMode('free');
}
const audioMasterRouteRuntime = new Map();
let audioMasterRouteStateRef = null;
function normalizeAudioMasterRouteConfigValue(raw) {
  const v = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return {
    strength: Number.isFinite(Number(v.strength)) ? Math.max(0, Math.min(200, Number(v.strength))) : 100,
    multiplier: Number.isFinite(Number(v.multiplier)) ? Math.max(0, Number(v.multiplier)) : 1,
    polarity: v.polarity === 'minus' ? 'minus' : 'plus',
  };
}
function ensureAudioMasterRouteMultipliers() {
  const ar = state.audioReactive || (state.audioReactive = {});
  if (
    !ar.masterRouteMultipliers ||
    typeof ar.masterRouteMultipliers !== 'object' ||
    Array.isArray(ar.masterRouteMultipliers)
  )
    ar.masterRouteMultipliers = {};
  const map = ar.masterRouteMultipliers;

  if (map !== audioMasterRouteStateRef) {
    audioMasterRouteRuntime.clear();
    audioMasterRouteStateRef = map;
    for (const [key, val] of Object.entries(map)) {
      if (!AUDIO_PARAM_BY_KEY.has(key)) {
        delete map[key];
        continue;
      }
      const cfg = normalizeAudioMasterRouteConfigValue(val);
      audioMasterRouteRuntime.set(key, cfg);
      map[key] = { ...cfg };
    }
  }

  for (const key of [...audioMasterRouteRuntime.keys()]) {
    if (!AUDIO_PARAM_BY_KEY.has(key)) {
      audioMasterRouteRuntime.delete(key);
      delete map[key];
    }
  }
  return map;
}
function getAudioMasterRouteConfig(param, create = true) {
  const map = ensureAudioMasterRouteMultipliers();
  let cfg = audioMasterRouteRuntime.get(param);
  if (!cfg && Object.prototype.hasOwnProperty.call(map, param)) {
    cfg = normalizeAudioMasterRouteConfigValue(map[param]);
    audioMasterRouteRuntime.set(param, cfg);
  }
  if (!cfg && create) {
    cfg = { strength: 100, multiplier: 1, polarity: param === 'lamps.softness' ? 'minus' : 'plus' };
    audioMasterRouteRuntime.set(param, cfg);
  }
  if (cfg) map[param] = { strength: cfg.strength, multiplier: cfg.multiplier, polarity: cfg.polarity };
  return cfg || null;
}
function setAudioMasterRouteConfig(param, patch = {}) {
  const cfg = getAudioMasterRouteConfig(param, true);
  if (Object.prototype.hasOwnProperty.call(patch, 'strength'))
    cfg.strength = Math.max(0, Math.min(200, Number(patch.strength) || 0));
  if (Object.prototype.hasOwnProperty.call(patch, 'multiplier'))
    cfg.multiplier = Math.max(0, Number(patch.multiplier) || 0);
  if (Object.prototype.hasOwnProperty.call(patch, 'polarity'))
    cfg.polarity = patch.polarity === 'minus' ? 'minus' : 'plus';
  const map = ensureAudioMasterRouteMultipliers();
  map[param] = { strength: cfg.strength, multiplier: cfg.multiplier, polarity: cfg.polarity };
  return cfg;
}
function audioMasterParamsInUse() {
  const routes = ensureAudioRoutingState(),
    seen = new Set();
  for (const rows of Object.values(routes.layers || {}))
    for (const r of rows || []) if (r && AUDIO_PARAM_BY_KEY.has(r.param)) seen.add(r.param);
  const ordered = [],
    unique = new Set();
  for (const def of AUDIO_PARAM_DEFS)
    if (seen.has(def.key) && !unique.has(def.key)) {
      unique.add(def.key);
      ordered.push(def.key);
    }
  for (const def of AUDIO_PARAM_COMPAT_DEFS)
    if (seen.has(def.key) && !unique.has(def.key)) {
      unique.add(def.key);
      ordered.push(def.key);
    }
  return ordered;
}
function getAudioMasterRouteGain(param) {
  const cfg = getAudioMasterRouteConfig(param, true);
  const sign = cfg.polarity === 'minus' ? -1 : 1;
  return sign * Math.max(0, (cfg.strength / 100) * cfg.multiplier);
}
function ensureAudioRoutingState() {
  const ar = state.audioReactive || (state.audioReactive = {});
  if (!ar.routes || typeof ar.routes !== 'object') ar.routes = { master: [], layers: {} };
  if (!Array.isArray(ar.routes.master)) ar.routes.master = [];
  if (!ar.routes.layers || typeof ar.routes.layers !== 'object') ar.routes.layers = {};
  ensureAudioMasterRouteMultipliers();
  if (typeof ar.masterEditEnabled !== 'boolean') ar.masterEditEnabled = false;
  state.layers.forEach((layer, idx) => ensureAudioLayerNativeBand(layer, idx));
  if (!ar.routingInitialized) {
    ar.routes.master = (ar.routes.master || []).map(normalizeAudioRoute);
    state.layers.forEach((layer, idx) => {
      ar.routes.layers[layer.id] = createDefaultAudioRoutesForLayerIndex(idx);
    });
    ar.routingInitialized = true;
  }
  state.layers.forEach((layer, idx) => {
    if (!Object.prototype.hasOwnProperty.call(ar.routes.layers, layer.id)) {
      ar.routes.layers[layer.id] = createDefaultAudioRoutesForLayerIndex(idx);
    } else if (!Array.isArray(ar.routes.layers[layer.id])) ar.routes.layers[layer.id] = [];
  });

  for (let i = 0; i < ar.routes.master.length; i++) {
    const cur = ar.routes.master[i],
      norm = normalizeAudioRoute(cur);
    if (cur && typeof cur === 'object') {
      for (const k of Object.keys(cur)) if (!Object.prototype.hasOwnProperty.call(norm, k)) delete cur[k];
      Object.assign(cur, norm);
    } else ar.routes.master[i] = norm;
  }
  if (
    !ar.groupToggleMemory ||
    typeof ar.groupToggleMemory !== 'object' ||
    Array.isArray(ar.groupToggleMemory)
  )
    ar.groupToggleMemory = {};
  if (
    !ar.layerSignalEnabled ||
    typeof ar.layerSignalEnabled !== 'object' ||
    Array.isArray(ar.layerSignalEnabled)
  )
    ar.layerSignalEnabled = {};
  state.layers.forEach((layer) => {
    if (!Object.prototype.hasOwnProperty.call(ar.layerSignalEnabled, layer.id))
      ar.layerSignalEnabled[layer.id] = true;
  });
  // Validate all three layer-ID collections against the same current snapshot.
  // Avoid an O(stale route count * layer count) scan every time routing is read.
  const liveLayerIds = new Set(state.layers.map((layer) => layer.id));
  for (const id of Object.keys(ar.routes.layers)) if (!liveLayerIds.has(id)) delete ar.routes.layers[id];
  for (const id of Object.keys(ar.layerSignalEnabled))
    if (!liveLayerIds.has(id)) delete ar.layerSignalEnabled[id];
  if (ar.routingTarget !== 'master' && !liveLayerIds.has(ar.routingTarget)) ar.routingTarget = 'master';
  if (!AUDIO_ROUTING_PRESETS.has(ar.routingPreset)) ar.routingPreset = 'geometryLamps';
  // A duplicated layer may already carry a valid (but outdated) native
  // band. Reconcile automatic assignments by POSITION on every layer
  // collection update, not only when the audio-input count changes.
  // User-authored routes on other bands remain untouched.
  synchronizeAutomaticLayerAudioBands();
  return ar.routes;
}
function initializeNewLayerAudioRouting(layer, sourceLayer = null) {
  if (!layer) return [];
  const idx = (state.layers || []).findIndex((x) => x?.id === layer.id);
  if (idx < 0) return [];
  const expected = routeBandForLayerIndex(idx);
  layer.audioNativeBand = expected;
  layer.audioNativeBandAuto = true;
  // Newly added layers must receive a native frequency immediately.
  // Duplicates keep their parameter/strength choices, but copies of the
  // source's automatic frequency are shifted to the new layer's band.
  const ar = state.audioReactive || (state.audioReactive = {});
  const routes = ensureAudioRoutingState();
  if (sourceLayer) {
    const sourceRoutes = routes.layers?.[sourceLayer.id];
    if (ar.defaultRoutesEnabled === false) {
      routes.layers[layer.id] = [];
    } else if (Array.isArray(sourceRoutes)) {
      const sourceBand = sourceLayer.audioNativeBand;
      routes.layers[layer.id] = sourceRoutes.map((row) => {
        const copy = normalizeAudioRoute({ ...row, id: null });
        if (sourceLayer.audioNativeBandAuto === true && copy.band === sourceBand) copy.band = expected;
        return copy;
      });
    }
  }
  return routes.layers[layer.id] || [];
}
function isAudioLayerSignalEnabled(layerOrIndex = -1) {
  const ar = state.audioReactive || {};
  const layer =
    typeof layerOrIndex === 'string'
      ? state.layers.find((l) => l.id === layerOrIndex)
      : state.layers[Number(layerOrIndex)];
  if (!layer) return true;
  if (
    !ar.layerSignalEnabled ||
    typeof ar.layerSignalEnabled !== 'object' ||
    Array.isArray(ar.layerSignalEnabled)
  )
    ar.layerSignalEnabled = {};
  if (!Object.prototype.hasOwnProperty.call(ar.layerSignalEnabled, layer.id))
    ar.layerSignalEnabled[layer.id] = true;
  return ar.layerSignalEnabled[layer.id] !== false;
}
function setAudioLayerSignalEnabled(layerId, enabled) {
  ensureAudioRoutingState();
  if (!state.layers.some((l) => l.id === layerId)) return;
  state.audioReactive.layerSignalEnabled[layerId] = enabled !== false;
}
function audioBandValue(band, derivative = false) {
  const ar = state.audioReactive;
  if (!ar?.active) return 0;
  const arr = derivative ? ar.derivatives : ar.levels;
  if (Object.prototype.hasOwnProperty.call(AUDIO_BAND_INDEX, band))
    return Number(arr?.[AUDIO_BAND_INDEX[band]]) || 0;
  const keys = getActiveAudioBandKeys();
  const vals = keys.map((k) => Number(arr?.[AUDIO_BAND_INDEX[k]]) || 0);
  if (!vals.length) return 0;
  return derivative
    ? vals.reduce((a, b) => a + b, 0) / vals.length
    : Math.sqrt(vals.reduce((a, b) => a + b * b, 0) / vals.length);
}
function audioRoutesForLayer(layerIndex = -1) {
  const ar = state.audioReactive;
  if (!ar?.active || !isAudioLayerSignalEnabled(layerIndex)) return [];
  const routes = ensureAudioRoutingState();
  const layer = state.layers[layerIndex];
  return layer ? routes.layers?.[layer.id] || [] : [];
}
function getAudioEffectsAmplitudeGain() {
  const ar = state.audioReactive || {};
  const strength = Number.isFinite(Number(ar.effectsAmplitudeStrength))
    ? Math.max(0, Math.min(200, Number(ar.effectsAmplitudeStrength)))
    : 50;
  const multiplier = Number.isFinite(Number(ar.effectsAmplitudeMultiplier))
    ? Math.max(0, Number(ar.effectsAmplitudeMultiplier))
    : 1;
  return Math.max(0, Math.min(40, (strength / 100) * multiplier));
}
function audioRouteDirectedSignal(r, derivativeMode) {
  const raw = Number(audioBandValue(r.band, derivativeMode)) || 0;
  const mode = normalizeAudioSignalMode(r.signalMode);
  if (derivativeMode) {
    return mode === 'subtract' ? -raw : raw;
  }
  const level = Math.max(0, Math.min(1, raw));
  if (mode === 'subtract') return -level;
  if (mode === 'median') return level - 0.5;
  return level;
}
function audioApplyRouteToValue(out, def, r, effectsAmplitude, extraGain = 1) {
  if (!r || r.enabled === false) return out;
  const signedExtra = Number.isFinite(Number(extraGain)) ? Number(extraGain) : 1;
  const gain = Math.max(
    0,
    Math.min(
      4000,
      ((Number(r.strength) || 0) / 100) *
        Math.max(0, Number(r.multiplier) || 0) *
        effectsAmplitude *
        Math.abs(signedExtra) *
        (r.derivative === true ? 0.1 : 1),
    ),
  );
  if (gain <= 0) return out;
  const derivativeMode = r.derivative === true;
  const signal = audioRouteDirectedSignal(r, derivativeMode) * (signedExtra < 0 ? -1 : 1);
  if (def.mode === 'centerFactor' || def.mode === 'positiveFactor' || def.mode === 'fadeFactor')
    out *= 1 + signal * def.span * gain;
  else out += signal * def.span * gain;
  return out;
}
function audioApplyNumeric(key, base, layerIndex = -1) {
  const def = AUDIO_PARAM_BY_KEY.get(key);
  let out = Number(base);
  if (!Number.isFinite(out)) out = 0;
  if (!def || !state.audioReactive?.active || !isAudioLayerSignalEnabled(layerIndex)) return out;
  const effectsAmplitude = getAudioEffectsAmplitudeGain();
  const routes = ensureAudioRoutingState();

  for (const r of routes.master || [])
    if (r?.param === key) out = audioApplyRouteToValue(out, def, r, effectsAmplitude, 1);

  for (const r of audioRoutesForLayer(layerIndex)) {
    if (r?.param !== key) continue;
    out = audioApplyRouteToValue(out, def, r, effectsAmplitude, getAudioMasterRouteGain(r.param));
  }
  const audioFlooredAtZero = Number(base) >= 0 && out < 0;
  if (audioFlooredAtZero) out = 0;
  if (!audioFlooredAtZero && Number.isFinite(def.min)) out = Math.max(def.min, out);
  if (Number.isFinite(def.max)) out = Math.min(def.max, out);
  return out;
}
function audioApplyRawNumeric(key, base, layerIndex = -1) {
  const def = AUDIO_PARAM_BY_KEY.get(key);
  let out = Number(base);
  if (!Number.isFinite(out)) out = 0;
  if (!def || !state.audioReactive?.active || !isAudioLayerSignalEnabled(layerIndex)) return out;
  const effectsAmplitude = getAudioEffectsAmplitudeGain(),
    routes = ensureAudioRoutingState();
  for (const r of routes.master || [])
    if (r?.param === key) out = audioApplyRouteToValue(out, def, r, effectsAmplitude, 1);
  for (const r of audioRoutesForLayer(layerIndex)) {
    if (r?.param !== key) continue;
    out = audioApplyRouteToValue(out, def, r, effectsAmplitude, getAudioMasterRouteGain(r.param));
  }
  if (Number.isFinite(def.min)) out = Math.max(def.min, out);
  if (Number.isFinite(def.max)) out = Math.min(def.max, out);
  return out;
}
function audioShiftHexHue(key, color, layerIndex = -1) {
  // Outline shares one colour-routing contract with Blue/Orange;
  // even an authored white outline can acquire an automated hue.
  if (key === 'outline.color')
    return (
      window.SomataParameterRegistry?.shiftHexHue?.(color, audioApplyRawNumeric(key, 0, layerIndex)) || color
    );
  const raw = String(color || ''),
    m = /^#([0-9a-f]{6})$/i.exec(raw);
  if (!m) return raw;
  const n = parseInt(m[1], 16),
    r = ((n >> 16) & 255) / 255,
    g = ((n >> 8) & 255) / 255,
    b = (n & 255) / 255,
    max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    d = max - min;
  let h = 0,
    s = 0,
    l = (max + min) / 2;
  if (d > 1e-9) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
    if (h < 0) h += 360;
  }
  h = (h + audioApplyRawNumeric(key, 0, layerIndex) + 3600) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s,
    x = c * (1 - Math.abs(((h / 60) % 2) - 1)),
    mm = l - c / 2;
  let rr = 0,
    gg = 0,
    bb = 0;
  if (h < 60) [rr, gg, bb] = [c, x, 0];
  else if (h < 120) [rr, gg, bb] = [x, c, 0];
  else if (h < 180) [rr, gg, bb] = [0, c, x];
  else if (h < 240) [rr, gg, bb] = [0, x, c];
  else if (h < 300) [rr, gg, bb] = [x, 0, c];
  else [rr, gg, bb] = [c, 0, x];
  const hx = (v) =>
    Math.max(0, Math.min(255, Math.round((v + mm) * 255)))
      .toString(16)
      .padStart(2, '0');
  return `#${hx(rr)}${hx(gg)}${hx(bb)}`;
}
function applySharedAudioParameterFrameRouting(frameCtx) {
  if (!frameCtx || !state.audioReactive?.active) return frameCtx;
  const R = window.SomataParameterRegistry,
    idx = Number(frameCtx.layerIndex) || 0;
  if (!R) return frameCtx;
  for (const audioDef of AUDIO_PARAM_DEFS) {
    if (audioDef?.genericFrame !== true || !audioDef.framePath) continue;
    // 7.11.0: while Blue owns the current carrier, radius cannot be applied by
    // mutating the already-resolved Morph snapshot: that changes state/extent but
    // not the authoritative path. The transform stage composes layer.radius as a
    // post-Morph scale instead (same visible semantics as the stable Audio scale).
    if (audioDef.key === 'layer.radius' && frameCtx?.blueMorphProvider?.active === true) continue;
    if (audioDef.key === 'geometry.orbits') {
      const layer = frameCtx.layer;
      if (!layer || !hasActiveAudioRoute('geometry.orbits')) continue;
      const n = Math.max(2, Math.round(Number(layer.N) || 2)),
        k = Math.max(1, Math.round(Number(layer.K) || 1));
      const gcd = (a, b) => (b ? gcd(b, a % b) : a),
        maxOrbits = Math.max(1, gcd(n, k));
      const base =
        layer.customSuborbits == null
          ? 100
          : Math.ceil((Math.max(1, Number(layer.customSuborbits) || 1) * 100) / maxOrbits);
      const pct = Math.max(1, Math.min(100, audioApplyNumeric('geometry.orbits', base, idx)));
      const count = Math.max(1, Math.min(maxOrbits, Math.ceil((maxOrbits * pct) / 100)));
      layer.customSuborbits = count < maxOrbits ? count : null;
      continue;
    }
    const def = R.get(audioDef.parameterId);
    if (!def || audioDef.frameTarget === 'global') continue;
    const target = audioDef.frameTarget === 'layer' ? frameCtx.layer : frameCtx.effectLayer;
    if (!target) continue;
    const base = R.valueAt(target, audioDef.framePath);
    if (base == null) continue;
    let value = base;
    if (def.type === 'color') value = audioShiftHexHue(audioDef.key, base, idx);
    else if (def.type === 'boolean') value = audioApplyNumeric(audioDef.key, base ? 1 : 0, idx) >= 0.5;
    else if (def.type === 'enum') {
      const values = Array.isArray(def.values) ? def.values : [],
        baseIndex = Math.max(0, values.indexOf(base));
      if (values.length) {
        const next = Math.max(
          0,
          Math.min(values.length - 1, Math.round(audioApplyNumeric(audioDef.key, baseIndex, idx))),
        );
        value = values[next];
      }
    } else if (Number.isFinite(Number(base))) {
      value = audioApplyNumeric(audioDef.key, Number(base), idx);
      if (def.type === 'integer') value = Math.round(value);
    }
    if (
      def.type === 'color' ||
      def.type === 'boolean' ||
      def.type === 'enum' ||
      Number.isFinite(Number(value))
    )
      R.applyPath(target, audioDef.framePath, value);
  }
  return frameCtx;
}
window.applySharedAudioParameterFrameRouting = applySharedAudioParameterFrameRouting;
function hasActiveAudioRoute(param = null) {
  if (!state.audioReactive?.active) return false;
  if (!state.audioReactive.routingInitialized) ensureAudioRoutingState();
  const routes = ensureAudioRoutingState();
  const anyEnabledLayer = state.layers.some((layer) => isAudioLayerSignalEnabled(layer.id));
  const masterActive =
    anyEnabledLayer &&
    (routes.master || []).some(
      (r) =>
        r?.enabled !== false &&
        (!param || r.param === param) &&
        (Number(r.strength) || 0) > 0 &&
        (Number(r.multiplier) || 0) > 0,
    );
  if (masterActive) return true;
  return Object.entries(routes.layers || {}).some(
    ([layerId, rows]) =>
      isAudioLayerSignalEnabled(layerId) &&
      (rows || []).some(
        (r) =>
          r?.enabled !== false &&
          (!param || r.param === param) &&
          (Number(r.strength) || 0) > 0 &&
          (Number(r.multiplier) || 0) > 0 &&
          Math.abs(getAudioMasterRouteGain(r.param)) > 0,
      ),
  );
}
function isAudioMasterEditActive() {
  const ar = state.audioReactive || {};
  return (
    ar.masterEditEnabled === true &&
    ar.routingTarget !== 'master' &&
    state.layers.some((l) => l.id === ar.routingTarget)
  );
}
function setAudioMasterEditEnabled(enabled) {
  const ar = state.audioReactive || (state.audioReactive = {});
  ar.masterEditEnabled = enabled === true && ar.routingTarget !== 'master';
  return ar.masterEditEnabled;
}
function mirrorAudioRouteField(route, field, value, matchParam = null) {
  if (!route) return;
  const selector = String(matchParam ?? route.param ?? '');
  route[field] = value;
  if (!isAudioMasterEditActive() || !selector) return;
  const routes = ensureAudioRoutingState();
  for (const rows of Object.values(routes.layers || {})) {
    if (!Array.isArray(rows)) continue;
    for (const other of rows) {
      if (!other || String(other.param) !== selector) continue;
      other[field] = value;
    }
  }
}
function mirrorAudioRouteParam(route, newParam) {
  if (!route || !AUDIO_PARAM_BY_KEY.has(newParam)) return;
  const oldParam = String(route.param || '');
  if (!isAudioMasterEditActive()) {
    route.param = newParam;
    return;
  }
  const routes = ensureAudioRoutingState();
  for (const rows of Object.values(routes.layers || {})) {
    if (!Array.isArray(rows)) continue;
    for (const other of rows) if (other && String(other.param) === oldParam) other.param = newParam;
  }
}
function addAudioRouteForTarget(param = 'layer.radius', prototype = null) {
  const routes = ensureAudioRoutingState(),
    target = state.audioReactive.routingTarget || 'master';
  const proto = prototype || {};
  if (target === 'master') {
    const row = createAudioRoute(
      proto.band || 'combined',
      param,
      proto.strength ?? 100,
      proto.multiplier ?? 1,
      proto.enabled !== false,
      proto.derivative === true,
      proto.signalMode || 'add',
    );
    routes.master.push(row);
    return row;
  }
  if (isAudioMasterEditActive()) {
    let source = null;
    state.layers.forEach((layer, idx) => {
      const rows = routes.layers[layer.id] || (routes.layers[layer.id] = []);
      const row = createAudioRoute(
        ensureAudioLayerNativeBand(layer, idx),
        param,
        proto.strength ?? 100,
        proto.multiplier ?? 1,
        proto.enabled !== false,
        proto.derivative === true,
        proto.signalMode || 'add',
      );
      rows.push(row);
      if (layer.id === target) source = row;
    });
    return source;
  }
  const idx = Math.max(
      0,
      state.layers.findIndex((l) => l.id === target),
    ),
    layer = state.layers[idx];
  const row = createAudioRoute(
    ensureAudioLayerNativeBand(layer, idx),
    param,
    proto.strength ?? 100,
    proto.multiplier ?? 1,
    proto.enabled !== false,
    proto.derivative === true,
    proto.signalMode || 'add',
  );
  (routes.layers[target] || (routes.layers[target] = [])).push(row);
  return row;
}
function getAudioRouteTargetRows() {
  const routes = ensureAudioRoutingState(),
    target = state.audioReactive.routingTarget || 'master';
  return target === 'master' ? routes.master : routes.layers[target] || (routes.layers[target] = []);
}
function audioDefinitionForParameterId(paramId) {
  const id = String(paramId || '');
  return (
    AUDIO_PARAM_BY_KEY.get(id) || AUDIO_PARAM_DEFS.find((d) => String(d.parameterId || '') === id) || null
  );
}
function audioRowsForTargetId(targetId) {
  const routes = ensureAudioRoutingState(),
    id = String(targetId || 'master');
  if (id === 'master') return routes.master;
  if (!state.layers.some((l) => l.id === id)) return null;
  return routes.layers[id] || (routes.layers[id] = []);
}
function audioParameterTargetStates(paramId) {
  const def = audioDefinitionForParameterId(paramId);
  if (!def) return { supported: false, key: null, master: false, layers: [], any: false };
  const routes = ensureAudioRoutingState(),
    key = String(def.key),
    activeIn = (rows) =>
      Array.isArray(rows) && rows.some((r) => String(r?.param || '') === key && r?.enabled !== false);
  const layers = state.layers.map((layer, index) => ({
    id: layer.id,
    index,
    label: layer.name || `Слой ${index + 1}`,
    active: activeIn(routes.layers?.[layer.id]),
  }));
  const master = activeIn(routes.master);
  return { supported: true, key, master, layers, any: master || layers.some((x) => x.active) };
}
function audioParameterRoutingState(paramId) {
  const def = audioDefinitionForParameterId(paramId),
    target = state.audioReactive?.routingTarget || 'master';
  if (!def)
    return {
      supported: false,
      added: false,
      active: false,
      target,
      targetName: audioRouteTargetName?.() || 'Мастер',
      targets: audioParameterTargetStates(paramId),
    };
  const rows = getAudioRouteTargetRows(),
    matches = rows.filter((r) => String(r?.param || '') === String(def.key)),
    targets = audioParameterTargetStates(paramId);
  return {
    supported: true,
    added: matches.length > 0,
    active: targets.any,
    target,
    targetName: audioRouteTargetName(),
    key: def.key,
    count: matches.length,
    targets,
  };
}
function setAudioParameterTargetActive(paramId, targetId, enabled) {
  const def = audioDefinitionForParameterId(paramId),
    rows = audioRowsForTargetId(targetId);
  if (!def || !rows) return false;
  const key = String(def.key),
    matches = rows.filter((r) => String(r?.param || '') === key),
    on = enabled === true;
  if (on) {
    if (matches.length) for (const route of matches) route.enabled = true;
    else {
      const idx = state.layers.findIndex((l) => l.id === targetId),
        band = targetId === 'master' ? 'combined' : ensureAudioLayerNativeBand(state.layers[idx], idx);
      rows.push(createAudioRoute(band, key, 100, 1, true, false, 'add'));
    }
  } else for (const route of matches) route.enabled = false;
  if (targetId !== 'master') markAudioRoutingFree();
  renderAudioRoutingPanel();
  requestMainCanvasRender();
  window.__syncParameterRoutingDecorations?.();
  return true;
}
function setAudioParameterRoutingActive(paramId, enabled) {
  const target = state.audioReactive?.routingTarget || 'master';
  return setAudioParameterTargetActive(paramId, target, enabled);
}
window.SomataAudioParameterRoutingUI = Object.freeze({
  state: audioParameterRoutingState,
  targets: audioParameterTargetStates,
  setActive: setAudioParameterRoutingActive,
  setTargetActive: setAudioParameterTargetActive,
});

function setAudioMasterRouteStateRef(value) {
  audioMasterRouteStateRef = value;
  return value;
}

export {
  AUDIO_ROUTE_GROUP_SPECS,
  AUDIO_ROUTING_PRESETS,
  addAudioRouteForTarget,
  applyAudioRoutingPreset,
  audioApplyNumeric,
  audioBandValue,
  audioMasterParamsInUse,
  audioMasterRouteRuntime,
  audioShiftHexHue,
  createAudioRoute,
  ensureAudioMasterRouteMultipliers,
  ensureAudioRoutingState,
  getAudioMasterRouteConfig,
  getAudioRouteTargetRows,
  hasActiveAudioRoute,
  initializeNewLayerAudioRouting,
  isAudioLayerSignalEnabled,
  isAudioMasterEditActive,
  markAudioRoutingFree,
  mirrorAudioRouteField,
  mirrorAudioRouteParam,
  normalizeAudioRoute,
  normalizeAudioSignalMode,
  routeBandForLayerIndex,
  setAudioLayerSignalEnabled,
  setAudioMasterEditEnabled,
  setAudioMasterRouteConfig,
  setAudioMasterRouteStateRef,
  setAudioRoutingPresetMode,
  synchronizeAutomaticLayerAudioBands,
};
