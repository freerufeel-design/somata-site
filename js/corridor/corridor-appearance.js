// Коридор: скрытые центральные копии, внешние копии, сдвиг цвета и палитра копий.
import '../app/app-paths.js'; // initialisation order: this module runs after it
import { getTunnelStepRatio } from '../geometry/spiral/order-params.js';
import { audioApplyNumeric } from '../audio/audio-routing.js';
import { colorBaseHex6 } from '../core/defaults-layers.js';
import {
  getActivePlaylistPaletteKeys,
  getPlaylistPaletteColors,
  normalizePaletteHex,
  normalizePlaylistPaletteKey,
} from '../core/palette.js';
import { runtimeState, state } from '../core/state.js';
import { SomataCorridorFocus } from '../render/corridor-copy-frame.js';
import { smoothFeatherAlpha } from './corridor-instances.js';

const TUNNEL_CENTER_HIDDEN_DEFAULT = 0;
const TUNNEL_CENTER_HIDDEN_MAX = 32;
const SPIRAL_OUTER_COPIES_DEFAULT = 4;
function normalizeSpiralOuterCopies(tunnel = state.tunnel) {
  const raw = Number(tunnel?.spiralOuterCopies);
  const value = Math.max(
    0,
    Math.min(24, Math.round(Number.isFinite(raw) ? raw : SPIRAL_OUTER_COPIES_DEFAULT)),
  );
  if (tunnel) tunnel.spiralOuterCopies = value;
  return value;
}
function spiralCorridorOuterFade(copy, extent, viewportOuterRadius, zoom, layer) {
  if (state.tunnel?.active !== true) return 1;
  const spiralWeight =
    layer?.__spiralLayerwiseAngleMix ??
    layer?.__spiralUnfoldSpiralWeight ??
    (layer?.spiralEnabled === true && Math.abs(Number(layer.spiralOrder) || 0) >= 1e-8 ? 1 : 0);
  if (!(spiralWeight > 0)) return 1;
  const limit = normalizeSpiralOuterCopies(state.tunnel);

  const edge = Math.max(0.001, Number(viewportOuterRadius) || 0);
  const projected = Math.max(1e-9, Number(extent) || 0) * Math.abs(Number(copy?.scale) || 0);
  if (projected <= edge) return 1;
  const ratio = Math.max(
    1.000001,
    Number(copy?._spiralUnfoldOpenStep) || Number(copy?.stepRatio) || Number(state.tunnel?._stepRatio) || 1.1,
  );
  const steps = Math.log(projected / edge) / Math.log(ratio);

  const q = Math.max(0, Math.min(1, steps - (limit - 1)));
  return 1 - spiralWeight * q * q * (3 - 2 * q);
}
function normalizeTunnelCenterHiddenCopies(tunnel = state.tunnel) {
  if (!tunnel || typeof tunnel !== 'object') tunnel = state.tunnel = {};
  const raw = Number(tunnel.centerHiddenCopies);
  const count = Math.max(
    0,
    Math.min(TUNNEL_CENTER_HIDDEN_MAX, Math.round(Number.isFinite(raw) ? raw : TUNNEL_CENTER_HIDDEN_DEFAULT)),
  );
  tunnel.centerHiddenCopies = count;
  return count;
}
function getTunnelCenterRevealRange(tunnel = state.tunnel, ratio = null) {
  const hidden = normalizeTunnelCenterHiddenCopies(tunnel);
  if (hidden <= 0) return { hidden: 0, firstVisibleIndex: -2, startScale: 0, endScale: 0, spacingScale: 0 };
  const minScale = Math.max(0.01, Number(tunnel?.minScale) || 0.055);
  const stepRatio = Math.max(1.000001, Number(ratio) || getTunnelStepRatio?.() || 1.1);
  const firstVisibleIndex = hidden - 2;
  const endScale = minScale * Math.pow(stepRatio, firstVisibleIndex);
  const startScale = endScale / stepRatio;
  return {
    hidden,
    firstVisibleIndex,
    startScale,
    endScale,
    spacingScale: Math.max(1e-9, endScale - startScale),
  };
}
function getTunnelCenterRevealAlpha(copy, tunnel = state.tunnel, range = null) {
  const r = range || getTunnelCenterRevealRange(tunnel, copy?.stepRatio);
  if (!r || r.hidden <= 0) return 1;
  const scale = Math.max(0, Number(copy?.scale) || 0);
  const q = Math.max(0, Math.min(1, (scale - r.startScale) / Math.max(1e-9, r.spacingScale)));
  return smoothFeatherAlpha(q);
}
function normalizeTunnelColorShiftState(tunnel = state.tunnel) {
  if (!tunnel || typeof tunnel !== 'object') tunnel = state.tunnel = {};
  tunnel.colorShiftEnabled = tunnel.colorShiftEnabled === true;
  tunnel.colorShiftDegrees = Math.max(
    0,
    Math.min(360, Number.isFinite(Number(tunnel.colorShiftDegrees)) ? Number(tunnel.colorShiftDegrees) : 30),
  );
  tunnel.colorShiftCumulative = tunnel.colorShiftCumulative === true;
  tunnel.paletteLagEnabled = tunnel.paletteLagEnabled === true;
  return tunnel;
}
function routedGlobalMorphValue(parameterId, authored) {
  const fn = window.SomataMorphParameterRouting?.resolveGlobalValue;
  const value = typeof fn === 'function' ? fn(parameterId, authored) : authored;
  return Number.isFinite(Number(value)) ? Number(value) : authored;
}
function getTunnelSpeedPercent() {
  const authored = Math.max(-100, Math.min(100, (Number(state.tunnel?.speedStrength) || 0) * 100));
  const morphed = routedGlobalMorphValue('tunnel.speed', authored);
  const routed = audioApplyNumeric('tunnel.speed', morphed, -1);
  return Math.max(-100, Math.min(100, Number.isFinite(Number(routed)) ? Number(routed) : morphed));
}
function getTunnelSpacingPercent() {
  const authored = Math.max(20, Math.min(2000, (Number(state.tunnel?.spacingStrength) || 3) * 100));
  const morphed = routedGlobalMorphValue('tunnel.spacing', authored);
  const routed = audioApplyNumeric('tunnel.spacing', morphed, -1);
  return Math.max(20, Math.min(2000, Number.isFinite(Number(routed)) ? Number(routed) : morphed));
}
function getTunnelColorShiftDegrees() {
  const authored = Math.max(0, Math.min(360, Number(state.tunnel?.colorShiftDegrees) || 0));
  const morphed = routedGlobalMorphValue('tunnel.colorShift', authored);
  const routed = audioApplyNumeric('tunnel.colorShift', morphed, -1);
  return Math.max(0, Math.min(360, Number.isFinite(Number(routed)) ? Number(routed) : morphed));
}
function getTunnelDepthCurvePercent() {
  const authored = Math.max(-100, Math.min(100, Number(state.tunnel?.depthCurve) || 0));
  const morphed = routedGlobalMorphValue('tunnel.depthCurve', authored);
  const routed = audioApplyNumeric('tunnel.depthCurve', morphed, -1);
  return Math.max(-100, Math.min(100, Number.isFinite(Number(routed)) ? Number(routed) : morphed));
}
function getTunnelVignetteAmount() {
  const authored = Math.max(0, Math.min(1200, Number(state.tunnel?.vignetteAmount) || 0));
  const morphed = routedGlobalMorphValue('tunnel.vignette', authored);
  const routed = audioApplyNumeric('tunnel.vignette', morphed, -1);
  return Math.max(0, Math.min(1200, Number.isFinite(Number(routed)) ? Number(routed) : morphed));
}
function tunnelColorShiftIsActive() {
  const t = normalizeTunnelColorShiftState();
  return (
    state.tunnel?.active === true &&
    (t.paletteLagEnabled === true || (t.colorShiftEnabled === true && getTunnelColorShiftDegrees() > 0.0001))
  );
}
function tunnelColorBaseHex(value, fallback = '#ffffff') {
  const raw = String(value || '').trim();
  const m = raw.match(/^#([0-9a-f]{6})([0-9a-f]{2})?$/i);
  return m ? `#${m[1].toLowerCase()}` : normalizePaletteHex?.(raw) || fallback;
}
function tunnelColorAlphaSuffix(value) {
  const m = String(value || '')
    .trim()
    .match(/^#[0-9a-f]{6}([0-9a-f]{2})$/i);
  return m ? m[1].toLowerCase() : '';
}
function tunnelRotateHueHex(value, degrees) {
  const base = tunnelColorBaseHex(value);
  const n = parseInt(base.slice(1), 16);
  let r = ((n >> 16) & 255) / 255,
    g = ((n >> 8) & 255) / 255,
    b = (n & 255) / 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    d = max - min;
  let h = 0,
    s = 0,
    l = (max + min) / 2;
  if (d > 1e-12) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  h = (((h + Number(degrees || 0)) % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s,
    x = c * (1 - Math.abs(((h / 60) % 2) - 1)),
    m0 = l - c / 2;
  let rr = 0,
    gg = 0,
    bb = 0;
  if (h < 60) [rr, gg, bb] = [c, x, 0];
  else if (h < 120) [rr, gg, bb] = [x, c, 0];
  else if (h < 180) [rr, gg, bb] = [0, c, x];
  else if (h < 240) [rr, gg, bb] = [0, x, c];
  else if (h < 300) [rr, gg, bb] = [x, 0, c];
  else [rr, gg, bb] = [c, 0, x];
  const out = [rr, gg, bb]
    .map((v) =>
      Math.max(0, Math.min(255, Math.round((v + m0) * 255)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('');
  return `#${out}${tunnelColorAlphaSuffix(value)}`;
}
// Blue Morph Fill is represented as rgba(...), while authored colors
// often use #RRGGBBAA. Keep its alpha when rotating a routed hue;
// the Corridor-only hex helper cannot parse rgba and returns white.
function rotateBluePaletteHueColor(value, degrees) {
  if (typeof value !== 'string' || value === 'transparent' || Math.abs(Number(degrees) || 0) < 1e-9)
    return value;
  const rgba = value.trim().match(/^rgba\(\s*[^,]+,\s*[^,]+,\s*[^,]+,\s*([+-]?[\d.]+)\s*\)$/i);
  if (!rgba) return tunnelRotateHueHex(value, degrees);
  const hex = tunnelRotateHueHex(colorBaseHex6(value, '#000000'), degrees);
  const n = parseInt(hex.slice(1, 7), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${rgba[1]})`;
}
function tunnelNearestPaletteStop(baseColor, colors) {
  const base = tunnelColorBaseHex(baseColor),
    n = parseInt(base.slice(1), 16);
  const br = (n >> 16) & 255,
    bg = (n >> 8) & 255,
    bb = n & 255;
  let index = 0,
    distance = Infinity;
  for (let i = 0; i < colors.length; i++) {
    const c = tunnelColorBaseHex(colors[i]),
      v = parseInt(c.slice(1), 16);
    const dr = ((v >> 16) & 255) - br,
      dg = ((v >> 8) & 255) - bg,
      db = (v & 255) - bb;
    const d = dr * dr + dg * dg + db * db;
    if (d < distance) {
      distance = d;
      index = i;
    }
  }
  return { index, distance };
}
function resolveTunnelPaletteProfile(baseColor, layer = null, layerIndex = -1, channel = 'stroke') {
  if (!normalizeTunnelColorShiftState().paletteLagEnabled) return null;
  const blue = runtimeState?.morph;
  // The Morph palette is authored once per cycle. Looking up the nearest
  // palette using the *intermediate* stroke colour made the entire
  // Corridor jump between palettes every few seconds and scanned all
  // active palettes on every frame (twice for Stroke/Fill).
  if (blue?.active === true && state.morph?.options?.byColor === true) {
    const key = normalizePlaylistPaletteKey(state.morph.lineColorPalette, 'standard');
    const colors = getPlaylistPaletteColors(key);
    if (!colors.length) return null;
    const index = Number(layerIndex);
    const source = Number.isInteger(index) && index >= 0 ? blue.sourceVisuals?.[index] : null;
    const target = Number.isInteger(index) && index >= 0 ? blue.targetVisuals?.[index] : null;
    const src = channel === 'fill' ? source?.fillColor : source?.strokeColor;
    const dst = channel === 'fill' ? target?.fillColor : target?.strokeColor;
    if (src && dst) {
      const first = tunnelNearestPaletteStop(src, colors).index;
      const last = tunnelNearestPaletteStop(dst, colors).index;
      const length = colors.length;
      // Follow the same Blue geometryT as Line. Fractional colour
      // stops blend instead of jumping at the nearest-colour boundary.
      let delta = last - first;
      if (delta > length / 2) delta -= length;
      else if (delta < -length / 2) delta += length;
      const rawT = Number(blue.geometryT);
      const t = Number.isFinite(rawT) ? Math.max(0, Math.min(1, rawT)) : 0;
      return { key, colors, index: first + delta * t };
    }
    return { key, colors, index: tunnelNearestPaletteStop(baseColor, colors).index };
  }
  // Preserve the original palette-selection rule for static / Orange
  // scenes; only Blue's transient per-frame colour was unstable.
  const active = getActivePlaylistPaletteKeys();
  const preferred = active.includes(layer?.paletteKey) ? layer.paletteKey : null;
  const ordered = preferred ? [preferred, ...active.filter((k) => k !== preferred)] : active;
  let best = null,
    bestD = Infinity;
  for (const key of ordered) {
    const colors = getPlaylistPaletteColors(key);
    if (!Array.isArray(colors) || !colors.length) continue;
    const match = tunnelNearestPaletteStop(baseColor, colors);
    if (key === preferred && match.distance <= 2500) return { key, colors, index: match.index };
    if (match.distance < bestD) {
      bestD = match.distance;
      best = { key, colors, index: match.index };
    }
  }
  return best;
}
// Corridor: physical copy position interpolates between neighbouring palette stops.
function tunnelBlendPaletteHex(a, b, t, alpha = '') {
  if (t <= 0) return `${tunnelColorBaseHex(a)}${alpha}`;
  const x = parseInt(tunnelColorBaseHex(a).slice(1), 16),
    y = parseInt(tunnelColorBaseHex(b).slice(1), 16);
  const rgb = [16, 8, 0]
    .map((sh) =>
      Math.round(((x >> sh) & 255) * (1 - t) + ((y >> sh) & 255) * t)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('');
  return `#${rgb}${alpha}`;
}
function getTunnelCopyColor(baseColor, copy, paletteProfile = null, focusLayer = null) {
  const highlighted = (color) => SomataCorridorFocus.tint(color, copy, focusLayer);
  const t = normalizeTunnelColorShiftState();
  if (state.tunnel?.active !== true) return highlighted(baseColor);
  // Resolve the routed shift only once per colour lookup.
  const degrees = t.colorShiftEnabled === true ? getTunnelColorShiftDegrees() : 0;
  if (t.paletteLagEnabled !== true && degrees <= 0.0001) return highlighted(baseColor);
  const copyId = Number.isFinite(Number(copy?.copyId))
    ? Number(copy.copyId)
    : Math.round(Number(copy?.position) || 0);
  const localIndex = Number.isFinite(Number(copy?.colorIndex))
    ? Number(copy.colorIndex)
    : Math.round(Number(copy?.position) || 0);

  const position = copy?.position;
  const colorStep = t.colorShiftCumulative
    ? copyId
    : Number.isFinite(Number(position))
      ? Number(position)
      : localIndex;
  // Palette lag is independent of cumulative hue rotation. It advances
  // through real palette colours, including when accumulation is off.
  if (t.paletteLagEnabled === true) {
    const palette = paletteProfile?.colors;
    if (Array.isArray(palette) && palette.length) {
      const start = Number.isFinite(Number(paletteProfile.index)) ? Number(paletteProfile.index) : 0;
      const continuousStep = start + colorStep;
      const step = Math.floor(continuousStep),
        fraction = continuousStep - step;
      const idx = ((step % palette.length) + palette.length) % palette.length;
      const alpha = tunnelColorAlphaSuffix(baseColor);
      return highlighted(
        fraction < 1e-6
          ? `${tunnelColorBaseHex(palette[idx])}${alpha}`
          : tunnelBlendPaletteHex(palette[idx], palette[(idx + 1) % palette.length], fraction, alpha),
      );
    }
  }
  if (t.colorShiftEnabled !== true) return highlighted(baseColor);
  const lagDegrees = -colorStep * degrees;
  return highlighted(tunnelRotateHueHex(baseColor, lagDegrees));
}
function getTunnelDistanceFactor() {
  const multiplier = Math.max(0.0001, Number(state.tunnel?.spacingMultiplier) || 0.0001);
  return Math.max(0.01, (getTunnelSpacingPercent() / 100) * multiplier);
}

export {
  SPIRAL_OUTER_COPIES_DEFAULT,
  TUNNEL_CENTER_HIDDEN_DEFAULT,
  TUNNEL_CENTER_HIDDEN_MAX,
  getTunnelCenterRevealAlpha,
  getTunnelCenterRevealRange,
  getTunnelCopyColor,
  getTunnelDepthCurvePercent,
  getTunnelDistanceFactor,
  getTunnelSpeedPercent,
  getTunnelVignetteAmount,
  normalizeSpiralOuterCopies,
  normalizeTunnelCenterHiddenCopies,
  normalizeTunnelColorShiftState,
  resolveTunnelPaletteProfile,
  rotateBluePaletteHueColor,
  routedGlobalMorphValue,
  spiralCorridorOuterFade,
  tunnelColorShiftIsActive,
  tunnelRotateHueHex,
};
