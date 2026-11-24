// Blue Morph: выбор целей.
import './interpolation.js'; // initialisation order: this module runs after it
import {
  getEffectiveSpiralOrder,
  isSpiralLayer,
  normalizeSpiralOrder,
  normalizeSpiralStep,
} from '../../geometry/spiral/order-params.js';
import {
  DEFAULT_FILL_OPACITY_PERCENT,
  colorBaseHex6,
  gcd,
  getFillOpacityPercent,
  setFillOpacityPercent,
} from '../../core/defaults-layers.js';
import {
  MAX_ROUNDING_PERCENT,
  getAllPlaylistPaletteColors,
  normalizePlaylistHueOffset,
  normalizePlaylistPaletteKey,
  selectMorphLayerPaletteColors,
} from '../../core/palette.js';
import { isPreSampledSplineLayer } from '../../core/render-runtime.js';
import { runtimeState, state } from '../../core/state.js';
import {
  MORPH_PROFILE_GROUP_KEYS,
  PROFILE_PRESETS,
  PROFILE_PRESET_GROUPS,
  PROFILE_PRESET_KEYS,
  PROFILE_PRESET_META,
  getExactProfilePresetKey,
} from '../../ui/profile-presets.js';
import { isAudioRotationOverrideActive } from '../../ui/layer-selection.js';
import { normalizeMorphVertexRangeValues } from '../../ui/geometry-n-control.js';
import {
  UNIFIED_SPIRAL_TRANSPORTS,
  getSpiralMorphMode,
  getSpiralMorphType,
  spiralMorphKeepsContinuity,
  spiralMorphLocksK,
  spiralMorphLocksN,
  spiralMorphRestrictsTopologyParameters,
  spiralMorphUsesCorridorPhase,
} from '../morph-mode.js';
import {
  normalizedMorphProfileGroups,
  normalizedMorphShapeSelections,
} from '../../ui/morph-settings-panel.js';

function createMorphTargetsModule(deps) {
  const { randomInt, randomChoice, shuffle, MORPH_LINE_PALETTES, RANDOM_PALETTES, MorphInterpolation } = deps;
  const {
    MORPH_SAMPLE_COUNT,
    MORPH_PROFILE_MAX_POINTS,
    getMorphSplinePointCount,
    cloneProfileNodes,
    stripNearDuplicateProfilePoints,
    profileHasBacktrackingX,
    loopOrientationSign,
    polylineArcFractions,
    sampleOpenPolylineAtFractions,
    resampleOpenPolylineExact,
    densifyProfilePreservingCorners,
    compactMorphProfileNodes,
    pairCompactMorphProfiles,
    resolveMorphProfileMode,
    clamp01,
    easeSmooth,
    cubicBezierEase,
    androidBounce,
    fastOutSlowIn,
    MORPH_EASINGS,
    applyMorphEasing,
    sampleProfileForMorph,
    hexToRgb,
    rgbToHsl,
    hslToHex,
    lerpColorHsl,
    lerpPreparedHsl,
    lerpPreparedHslWithHueAmount,
  } = MorphInterpolation;
  const colorWithAlpha = (hex, alphaHex = '18') => `${hex}${alphaHex}`;
  const colorWithPercentAlpha = (hex, percent = DEFAULT_FILL_OPACITY_PERCENT) =>
    setFillOpacityPercent(hex, percent, colorBaseHex6(hex, '#000000'));
  const colorWithUnitAlpha = (hex, alpha = 1) => {
    const clean = colorBaseHex6(hex, '#000000');
    const rgb = hexToRgb(clean);
    const a = Math.max(0, Math.min(1, Number(alpha) || 0));

    return `rgba(${rgb.r},${rgb.g},${rgb.b},${a.toFixed(6)})`;
  };
  const shiftHueHex = (hex, degrees = 0) => {
    const hsl = rgbToHsl(...Object.values(hexToRgb(hex || '#000000')));
    const h = (hsl.h + (Number(degrees) || 0) / 360 + 1) % 1;
    return hslToHex(h, hsl.s, hsl.l);
  };
  const FILL_HARMONY_OFFSETS = Object.freeze({
    native: [0],
    analogous: [-30, 30],
    square: [-90, 90, 180],
    triadic: [-120, 120],
    split: [-150, 150],
    complement: [180],
    all: [0, -30, 30, -90, 90, -120, 120, -150, 150, 180],
  });
  const getFillHarmonyOffsets = (mode) => FILL_HARMONY_OFFSETS[mode] || FILL_HARMONY_OFFSETS.native;
  const chooseFillHarmonyOffset = () =>
    randomChoice(getFillHarmonyOffsets(state.morph.fillHueHarmony || 'native'));

  const signedHueOffsetDegrees = (strokeHex, fillHex) => {
    const a = rgbToHsl(...Object.values(hexToRgb(strokeHex || '#000000')));
    const b = rgbToHsl(
      ...Object.values(hexToRgb(colorBaseHex6(fillHex, colorBaseHex6(strokeHex, '#000000')))),
    );
    let d = (b.h - a.h) * 360;
    while (d > 180) d -= 360;
    while (d < -180) d += 360;
    return Math.round(d);
  };
  const lerpAngleDegrees = (a, b, t) => {
    let d = ((((b - a + 180) % 360) + 360) % 360) - 180;
    return a + d * t;
  };

  const normalizedMorphShapeOptions = () => {
    const raw = state.morph.shapeOptions || {};
    const selected = normalizedMorphShapeSelections();
    const profileGroups = normalizedMorphProfileGroups();
    return {
      ...selected,
      family: ['mix', 'square', 'triangle', 'sine'].includes(raw.family) ? raw.family : 'mix',
      profileGroups,
      profileGroup: profileGroups.length === 1 ? profileGroups[0] : 'all',
      standardOnly: profileGroups.length === 1 && profileGroups[0] === 'standard',
    };
  };

  const makeOpenProfileVariant = (nodes, mode, amp, preserveLoop = false) => {
    const a = Math.max(0.22, Math.min(0.78, Number(amp) || 0.4));
    const sign = Math.random() < 0.5 ? -1 : 1;

    const overshootMode = Math.random();
    const leftOvershoot = randomChoice([0.045, 0.07, 0.1, 0.14, 0.18]);
    const rightOvershoot = randomChoice([0.045, 0.07, 0.1, 0.14, 0.18]);
    let leftX = randomChoice([0.0, 0.018, 0.035]);
    let rightX = 1 - randomChoice([0.0, 0.018, 0.035]);
    if (overshootMode < 0.56) {
      leftX = -leftOvershoot;
      rightX = 1 + rightOvershoot;
    } else if (overshootMode < 0.8) {
      if (Math.random() < 0.5) leftX = -leftOvershoot;
      else rightX = 1 + rightOvershoot;
    }

    const style = preserveLoop
      ? randomChoice(['loopWhip', 'loopOpposed', 'loopWave'])
      : randomChoice(['ribbon', 'whip', 'wave', 'hook', 'asym', 'sweep']);
    const span = rightX - leftX;
    const X = (t) => leftX + span * t;
    let out;

    if (preserveLoop) {
      const base = (nodes || []).map((p) => ({
        x: leftX + (Number(p.x) || 0) * span,
        y: Number(p.y) || 0,
      }));
      out =
        base.length >= 5
          ? base
          : [
              { x: leftX, y: 0 },
              { x: X(0.24), y: a * 0.56 * sign },
              { x: X(0.55), y: a * 0.6 * sign },
              { x: X(0.43), y: -a * 0.32 * sign },
              { x: X(0.28), y: a * 0.44 * sign },
              { x: X(0.73), y: a * 0.3 * sign },
              { x: rightX, y: 0 },
            ];
      out[0].y = (style === 'loopOpposed' ? -0.66 : 0.62) * a * sign;
      out[out.length - 1].y = (style === 'loopWave' ? -0.72 : 0.76) * a * sign;
      if (out.length > 3) {
        out[1].y = (Number(out[1].y) || 0) + a * 0.18 * sign;
        out[out.length - 2].y = (Number(out[out.length - 2].y) || 0) - a * 0.2 * sign;
      }
    } else if (style === 'ribbon') {
      out = [
        { x: leftX, y: -a * 0.62 * sign },
        { x: X(0.11), y: -a * 0.28 * sign },
        { x: X(0.25), y: a * 0.48 * sign },
        { x: X(0.43), y: -a * 0.55 * sign },
        { x: X(0.61), y: a * 0.44 * sign },
        { x: X(0.79), y: a * 0.12 * sign },
        { x: X(0.91), y: a * 0.48 * sign },
        { x: rightX, y: a * 0.72 * sign },
      ];
    } else if (style === 'whip') {
      out = [
        { x: leftX, y: a * 0.92 * sign },
        { x: X(0.1), y: a * 0.48 * sign },
        { x: X(0.24), y: -a * 0.42 * sign },
        { x: X(0.42), y: a * 0.24 * sign },
        { x: X(0.6), y: -a * 0.62 * sign },
        { x: X(0.78), y: -a * 0.1 * sign },
        { x: X(0.9), y: -a * 0.58 * sign },
        { x: rightX, y: -a * 1.0 * sign },
      ];
    } else if (style === 'wave') {
      out = Array.from({ length: 9 }, (_, i) => {
        const t = i / 8;
        const envelope = 0.72 + 0.18 * Math.cos((t - 0.5) * Math.PI);
        return {
          x: X(t),
          y: (Math.sin((t * 2.25 + 0.16) * Math.PI) * a * envelope + (t - 0.5) * a * 0.22) * sign,
        };
      });
    } else if (style === 'hook') {
      out = [
        { x: leftX, y: -a * 0.82 * sign },
        { x: X(0.08), y: -a * 0.98 * sign },
        { x: X(0.18), y: -a * 0.34 * sign },
        { x: X(0.34), y: a * 0.38 * sign },
        { x: X(0.53), y: -a * 0.3 * sign },
        { x: X(0.7), y: a * 0.26 * sign },
        { x: X(0.86), y: a * 0.82 * sign },
        { x: rightX, y: a * 0.72 * sign },
      ];
    } else if (style === 'asym') {
      out = [
        { x: leftX, y: -a * 0.3 * sign },
        { x: X(0.13), y: a * 0.62 * sign },
        { x: X(0.28), y: a * 0.46 * sign },
        { x: X(0.46), y: -a * 0.78 * sign },
        { x: X(0.64), y: -a * 0.34 * sign },
        { x: X(0.8), y: a * 0.38 * sign },
        { x: X(0.92), y: a * 0.76 * sign },
        { x: rightX, y: a * 0.94 * sign },
      ];
    } else {
      out = [
        { x: leftX, y: -a * 0.7 * sign },
        { x: X(0.12), y: -a * 0.48 * sign },
        { x: X(0.29), y: -a * 0.02 * sign },
        { x: X(0.48), y: a * 0.6 * sign },
        { x: X(0.67), y: a * 0.28 * sign },
        { x: X(0.84), y: -a * 0.3 * sign },
        { x: rightX, y: -a * 0.68 * sign },
      ];
    }

    return { nodes: out, mode: 'spline', key: style };
  };

  const makeOpenAngularProfileVariant = (nodes, amp) => {
    const out = (nodes || []).map((p) => ({ x: Number(p.x) || 0, y: Number(p.y) || 0 }));
    if (out.length < 2) return { nodes: out, mode: 'segments', key: 'angular' };
    const leftOvershoot = randomChoice([0.045, 0.07, 0.1, 0.14]);
    const rightOvershoot = randomChoice([0.045, 0.07, 0.1, 0.14]);
    out[0].x = -leftOvershoot;
    out[out.length - 1].x = 1 + rightOvershoot;
    return { nodes: out, mode: 'segments', key: 'angular' };
  };

  const morphProfileMetaMatches = (meta, cfg) => {
    if (!meta) return false;
    const family = cfg.family || 'mix';
    if (family !== 'mix' && meta.family !== family) return false;
    if (meta.loop === true && !cfg.loops) return false;
    if (meta.loop !== true && !cfg.noLoops) return false;
    if (meta.closed === true && !cfg.closed) return false;
    if (meta.closed === false && !cfg.open) return false;
    return true;
  };

  const morphLibraryProfileCandidates = (cfg, standardOnly = false) => {
    const selectedGroups = standardOnly
      ? ['standard']
      : Array.isArray(cfg.profileGroups) && cfg.profileGroups.length
        ? cfg.profileGroups.filter((group) => MORPH_PROFILE_GROUP_KEYS.includes(group))
        : MORPH_PROFILE_GROUP_KEYS.slice();
    const selectedKeySet = new Set(selectedGroups.flatMap((group) => PROFILE_PRESET_GROUPS[group] || []));
    return PROFILE_PRESET_KEYS.filter((key) => {
      const meta = PROFILE_PRESET_META[key];
      if (!meta || !selectedKeySet.has(key)) return false;
      if (cfg.family !== 'mix' && meta.family !== cfg.family) return false;
      return true;
    });
  };

  const createLibraryMorphProfileVariant = (cfg, standardOnly = false) => {
    const selectedGroups = standardOnly
      ? ['standard']
      : Array.isArray(cfg.profileGroups) && cfg.profileGroups.length
        ? cfg.profileGroups.filter((group) => MORPH_PROFILE_GROUP_KEYS.includes(group))
        : MORPH_PROFILE_GROUP_KEYS.slice();
    let candidates = morphLibraryProfileCandidates(cfg, standardOnly);
    if (!candidates.length) {
      candidates = selectedGroups.flatMap((group) => PROFILE_PRESET_GROUPS[group] || []);
    }
    if (!candidates.length) return null;
    const key = randomChoice(candidates);
    const preset = PROFILE_PRESETS[key] || PROFILE_PRESETS.line;
    const meta = PROFILE_PRESET_META[key] || {};
    const closureChoices = [];
    if (selectedGroups.includes('closed')) closureChoices.push(true);
    if (selectedGroups.includes('open')) closureChoices.push(false);
    const closedLoop =
      typeof meta.closed === 'boolean'
        ? meta.closed
        : randomChoice(closureChoices.length ? closureChoices : [true]);
    return {
      profileKey: `${standardOnly ? 'standard' : 'library'}_${key}`,
      standardProfileKey: (PROFILE_PRESET_GROUPS.standard || []).includes(key) ? key : '',
      libraryProfileKey: key,
      mode: preset.mode || 'segments',
      nodes: (preset.nodes || []).map((p) => ({ x: Number(p.x) || 0, y: Number(p.y) || 0 })),
      closedLoop,
    };
  };

  const createElegantProceduralLoop = (family, amp) => {
    let candidates = PROFILE_PRESET_KEYS.filter((key) => {
      const meta = PROFILE_PRESET_META[key];
      return meta?.loop === true && (family === 'mix' || meta.family === family);
    });
    if (!candidates.length) candidates = PROFILE_PRESET_GROUPS.loops.slice();
    const key = randomChoice(candidates);
    const preset = PROFILE_PRESETS[key] || PROFILE_PRESETS.loop;
    let nodes = (preset.nodes || []).map((p) => ({ x: Number(p.x) || 0, y: Number(p.y) || 0 }));
    if (Math.random() < 0.5) nodes = nodes.map((p) => ({ x: 1 - p.x, y: p.y })).reverse();
    const maxY = Math.max(0.001, ...nodes.map((p) => Math.abs(Number(p.y) || 0)));
    const yScale = (Math.max(0.18, Number(amp) || 0.4) / maxY) * randomChoice([0.86, 0.94, 1.02, 1.1, 1.18]);
    const sign = Math.random() < 0.5 ? -1 : 1;
    nodes = nodes.map((p, i) => {
      if (i === 0 || i === nodes.length - 1) return { x: p.x, y: p.y * yScale * sign };
      const xJitter = (Math.random() - 0.5) * 0.026;
      const yJitter = (Math.random() - 0.5) * Math.max(0.018, amp * 0.07);
      return { x: p.x + xJitter, y: p.y * yScale * sign + yJitter };
    });
    return { key, mode: 'spline', nodes };
  };

  const createMorphProfileVariant = () => {
    const cfg = normalizedMorphShapeOptions();

    const libraryVariant = createLibraryMorphProfileVariant(cfg, false);
    if (libraryVariant) return libraryVariant;
    const groups = Array.isArray(cfg.profileGroups) ? cfg.profileGroups : MORPH_PROFILE_GROUP_KEYS.slice();
    const loopChoices = [];
    if (groups.includes('closed')) loopChoices.push(false);
    if (groups.includes('loops')) loopChoices.push(true);
    if (groups.includes('standard') || groups.includes('closed') || groups.includes('open')) {
      if (!loopChoices.includes(false)) loopChoices.push(false);
      if (!loopChoices.includes(true)) loopChoices.push(true);
    }
    const closureChoices = [];
    if (groups.includes('closed')) closureChoices.push(true);
    if (groups.includes('open')) closureChoices.push(false);

    const useLoop = randomChoice(loopChoices.length ? loopChoices : [false]);
    const wantClosed = randomChoice(closureChoices.length ? closureChoices : [true]);
    const requestedFamily = cfg.family;
    const family = requestedFamily === 'mix' ? randomChoice(['square', 'triangle', 'sine']) : requestedFamily;
    const amp = randomChoice([0.28, 0.34, 0.4, 0.46, 0.52, 0.58]);
    let mode = 'spline';
    let nodes;

    let loopVariantKey = '';
    if (useLoop) {
      const loopFamily =
        requestedFamily === 'mix' ? randomChoice(['square', 'triangle', 'sine']) : requestedFamily;
      const loopVariant = createElegantProceduralLoop(loopFamily, amp);
      loopVariantKey = `${loopFamily}_${loopVariant.key}`;
      nodes = loopVariant.nodes;
      mode = 'spline';
    } else if (family === 'square') {
      const sign = Math.random() < 0.5 ? -1 : 1;
      const a = amp * sign;
      const left = randomChoice([0.22, 0.28, 0.33]);
      const right = 1 - left;
      if (Math.random() < 0.55) {
        nodes = [
          { x: 0, y: 0 },
          { x: left, y: 0 },
          { x: left, y: a },
          { x: right, y: a },
          { x: right, y: 0 },
          { x: 1, y: 0 },
        ];
      } else {
        nodes = [
          { x: 0, y: 0 },
          { x: 0.2, y: 0 },
          { x: 0.2, y: a },
          { x: 0.44, y: a },
          { x: 0.44, y: -a * 0.55 },
          { x: 0.7, y: -a * 0.55 },
          { x: 0.7, y: 0 },
          { x: 1, y: 0 },
        ];
      }
      mode = 'segments';
    } else if (family === 'triangle') {
      const sign = Math.random() < 0.5 ? -1 : 1;
      nodes =
        Math.random() < 0.55
          ? [
              { x: 0, y: 0 },
              { x: 0.5, y: amp * sign },
              { x: 1, y: 0 },
            ]
          : [
              { x: 0, y: 0 },
              { x: 0.3, y: amp * 0.55 * sign },
              { x: 0.5, y: amp * sign },
              { x: 0.7, y: amp * 0.55 * sign },
              { x: 1, y: 0 },
            ];
      mode = 'segments';
    } else {
      const sign = Math.random() < 0.5 ? -1 : 1;
      if (Math.random() < 0.5) {
        nodes = [
          { x: 0, y: 0 },
          { x: 0.2, y: amp * 0.72 * sign },
          { x: 0.4, y: amp * sign },
          { x: 0.6, y: amp * 0.72 * sign },
          { x: 0.8, y: amp * 0.22 * sign },
          { x: 1, y: 0 },
        ];
      } else {
        nodes = [
          { x: 0, y: 0 },
          { x: 0.17, y: amp * sign },
          { x: 0.33, y: 0 },
          { x: 0.5, y: -amp * 0.78 * sign },
          { x: 0.67, y: 0 },
          { x: 0.83, y: amp * 0.55 * sign },
          { x: 1, y: 0 },
        ];
      }
      mode = 'spline';
    }

    let openKey = '';
    if (!wantClosed) {
      const keepAngular = mode === 'segments';
      const openVariant = keepAngular
        ? makeOpenAngularProfileVariant(nodes, amp)
        : makeOpenProfileVariant(nodes, mode, amp, useLoop);
      nodes = openVariant.nodes;
      mode = openVariant.mode;
      openKey = `_${openVariant.key}`;
    }
    return {
      profileKey: `${useLoop ? `generated_loop_${loopVariantKey || family}` : `generated_${family}`}${openKey}`,
      mode,
      nodes,
      closedLoop: wantClosed,
    };
  };

  const getProfileKeyForLayer = (layer) => getExactProfilePresetKey(layer);

  const pickMorphPalette = () => {
    const key = normalizePlaylistPaletteKey(state.morph.lineColorPalette, 'standard');
    const hueOffset =
      state.morph.morphGlobalHueOffset === true
        ? ((Number(runtimeState.morph.sourceGlobalHueOffset) % 360) + 360) % 360
        : normalizePlaylistHueOffset(state.playlistPaletteHueOffset);
    return selectMorphLayerPaletteColors(key, state.layers.length, {
      fixed: state.morph.fixedColors === true,
      hueOffset,
    });
  };

  const randomIntExcept = (min, max, current) => {
    const lo = Math.ceil(min);
    const hi = Math.floor(max);
    if (hi <= lo) return lo;
    const cur = Number(current);
    if (!Number.isInteger(cur) || cur < lo || cur > hi) return randomInt(lo, hi);
    const value = randomInt(lo, hi - 1);
    return value >= cur ? value + 1 : value;
  };

  const chooseMorphInt = (lo, hi, current) => {
    if (hi <= lo) return lo;
    return state.morph.diversity ? randomIntExcept(lo, hi, current) : randomInt(lo, hi);
  };

  const sameProfileVariant = (layer, variant) => {
    if (!variant) return true;
    if ((layer.profileMode || 'segments') !== (variant.mode || 'segments')) return false;
    if ((layer.closedLoop !== false) !== (variant.closedLoop !== false)) return false;
    const a = layer.profileNodes || [];
    const b = variant.nodes || [];
    if (a.length !== b.length) return false;
    return a.every(
      (p, i) =>
        Math.abs((Number(p.x) || 0) - (Number(b[i]?.x) || 0)) < 1e-6 &&
        Math.abs((Number(p.y) || 0) - (Number(b[i]?.y) || 0)) < 1e-6,
    );
  };

  const chooseMorphVertexTarget = (currentN, roleIndex) => {
    const range = normalizeMorphVertexRangeValues(
      state.morph.vertexMin,
      state.morph.vertexMax,
      state.morph.vertexMultiplier,
    );
    state.morph.vertexMultiplier = range.multiplier;
    state.morph.vertexMin = range.minN;
    state.morph.vertexMax = range.maxN;
    const boundedCurrent = Math.max(2, Math.min(120, Math.round(Number(currentN) || 4)));
    const nearby = range.allowed.filter(
      (n) => n >= range.minN && n <= range.maxN && n !== boundedCurrent && Math.abs(n - boundedCurrent) <= 6,
    );
    if (nearby.length) return randomChoice(nearby);
    const all = range.allowed.filter((n) => n >= range.minN && n <= range.maxN && n !== boundedCurrent);
    if (all.length) return randomChoice(all);
    return range.allowed.reduce(
      (best, n) => (Math.abs(n - boundedCurrent) < Math.abs(best - boundedCurrent) ? n : best),
      range.minN,
    );
  };

  const getActiveOrbitCount = (N, K, customSuborbits = null) => {
    const n = Math.max(2, Math.round(Number(N) || 4));
    const k = Math.max(1, Math.min(Math.floor(n / 2), Math.round(Number(K) || 1)));
    const total = Math.max(1, gcd(n, k));
    if (customSuborbits === null || customSuborbits === undefined) return total;
    return Math.max(1, Math.min(Math.round(Number(customSuborbits) || 1), total));
  };

  const chooseMorphOrbitTarget = (layer, targetN, targetK) => {
    const total = Math.max(1, gcd(Math.max(2, Math.round(targetN)), Math.max(1, Math.round(targetK))));
    if (!state.morph.monoOrbitTransforms || total <= 1) {
      const existing = layer.customSuborbits;
      if (existing === null || existing === undefined) return null;
      const clamped = Math.max(1, Math.min(Math.round(Number(existing) || 1), total));
      return clamped >= total ? null : clamped;
    }

    // Canonical 0..19 orbit count, independently persisted per Blue profile.
    // Historical 0..100% presets continue using the legacy branch below.
    if (state.morph.orbitCountMin != null && state.morph.orbitCountMax != null) {
      const schema = window.SomataParameterMatrix?.get?.('geometry.orbits');
      const cap = schema?.max || 19;
      let lo = Math.max(0, Math.min(cap, Math.round(Number(state.morph.orbitCountMin) || 0))),
        hi = Math.max(0, Math.min(cap, Math.round(Number(state.morph.orbitCountMax) || 0)));
      if (lo > hi) [lo, hi] = [hi, lo];
      if (hi === 0) return 1;
      const min = Math.min(total, Math.max(1, lo)),
        max = Math.min(total, Math.max(1, hi));
      const current = getActiveOrbitCount(layer.N, layer.K, layer.customSuborbits);
      const next = state.morph.diversity ? randomIntExcept(min, max, current) : randomInt(min, max);
      return next >= total ? null : next;
    }
    const originalMin = Math.max(0, Math.min(100, Math.round(Number(state.morph.orbitPercentMin) || 0)));
    const originalMax = Math.max(
      originalMin,
      Math.min(100, Math.round(Number(state.morph.orbitPercentMax) || 0)),
    );
    const minPct = originalMin;
    const maxPct = originalMax;

    // The percentage measures the *available* orbital paths of this
    // particular polygon, rather than an absolute orbit count. Always ceil.
    const minCount = Math.max(1, Math.min(total, Math.ceil((Math.max(1, minPct) / 100) * total)));
    const maxCount = Math.max(minCount, Math.min(total, Math.ceil((Math.max(1, maxPct) / 100) * total)));
    const sourceCount = getActiveOrbitCount(layer.N, layer.K, layer.customSuborbits);
    const currentForTarget = Math.max(minCount, Math.min(maxCount, sourceCount));
    const targetCount = state.morph.diversity
      ? randomIntExcept(minCount, maxCount, currentForTarget)
      : randomInt(minCount, maxCount);
    return targetCount >= total ? null : targetCount;
  };

  const getMorphSizeVariationFactor = () => 1;

  const chooseMorphSpiralLayerSet = (layers) => {
    if (
      runtimeState?.morph?.active !== true ||
      state.morph.options.bySpiralLayers !== true ||
      !Array.isArray(layers) ||
      !layers.length
    )
      return null;
    let lo = Math.max(0, Math.min(layers.length, Math.round(Number(state.morph.spiralLayersMin) || 0)));
    let hi = Math.max(0, Math.min(layers.length, Math.round(Number(state.morph.spiralLayersMax ?? 1) || 0)));
    if (lo > hi) [lo, hi] = [hi, lo];
    const currentCount = layers.reduce((sum, layer) => sum + (isSpiralLayer(layer) ? 1 : 0), 0);
    const targetCount = state.morph.diversity ? randomIntExcept(lo, hi, currentCount) : randomInt(lo, hi);
    const currentSet = new Set(
      layers.map((layer, i) => (isSpiralLayer(layer) ? i : -1)).filter((i) => i >= 0),
    );
    let indices = shuffle(layers.map((_, i) => i)).slice(0, targetCount);
    if (
      state.morph.diversity &&
      targetCount === currentCount &&
      targetCount > 0 &&
      targetCount < layers.length
    ) {
      if (indices.every((i) => currentSet.has(i))) {
        const candidates = layers.map((_, i) => i).filter((i) => !currentSet.has(i));
        indices[randomInt(0, indices.length - 1)] = randomChoice(candidates);
      }
    }
    return new Set(indices);
  };

  const chooseMorphSpiralOrderTarget = (layer, index = -1, targetSet = null) => {
    const current = getEffectiveSpiralOrder(layer);
    const rt = runtimeState.morph;
    if (
      (state.morph.options.bySpiralOrder || state.morph.options.bySpiralLayers) &&
      SomataSpiralZeroTransition.shouldHoldOrder(
        rt.orderHoldHistory?.get(layer.id),
        rt.orderCompletedPhases ?? 0,
        state.morph.spiralOrderHoldPhases,
        current,
      )
    )
      return current;
    const sourceIsSpiral = isSpiralLayer(layer);
    const targetIsSpiral = targetSet instanceof Set && index >= 0 ? targetSet.has(index) : sourceIsSpiral;
    if (targetSet instanceof Set && index >= 0 && !targetIsSpiral) return 0;
    if (state.morph.options.bySpiralOrder !== true) return targetIsSpiral ? current || 1 : 0;

    let lo = normalizeSpiralOrder(state.morph.spiralOrderMin, true);
    let hi = normalizeSpiralOrder(state.morph.spiralOrderMax, true);
    if (lo > hi) [lo, hi] = [hi, lo];
    if (state.morph.diversity && targetSet instanceof Set && targetIsSpiral) {
      // Keep selected layers spiral if a nonzero order is available.
      const values = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i).filter((v) => v !== 0);
      const alternatives = values.filter((v) => v !== current);
      if (alternatives.length) return randomChoice(alternatives);
      if (values.length) return values[0];
    }
    // Explicit signed targets are authoritative. The order rail
    // handles a change of handedness through zero.
    return state.morph.diversity ? randomIntExcept(lo, hi, current) : randomInt(lo, hi);
  };

  const chooseMorphRotationDelta = () => {
    let minPct = Math.max(0, Math.min(100, Number(state.morph.rotationMinPercent ?? 0)));
    let maxPct = Math.max(0, Math.min(100, Number(state.morph.rotationMaxPercent ?? 50)));
    if (minPct > maxPct) [minPct, maxPct] = [maxPct, minPct];
    const mult = Math.max(0, Math.min(20, Number(state.morph.rotationMultiplier ?? 1)));
    const pct = minPct + Math.random() * (maxPct - minPct);
    let degrees = pct * 3.6 * mult;
    if (state.morph.rotationRandomDirection !== false && Math.random() < 0.5) degrees *= -1;

    if (state.morph.diversity && mult > 0 && maxPct > 0 && degrees === 0) degrees = maxPct * 3.6 * mult;
    if (state.morph.mode === 'calm') degrees = Math.max(-720, Math.min(720, degrees));

    if (getSpiralMorphType() === 'minimalTurn') degrees = ((((degrees + 180) % 360) + 360) % 360) - 180;
    return degrees;
  };

  const currentKForTarget = (layer, targetN) =>
    Math.max(1, Math.min(Math.max(1, Math.floor(targetN / 2)), Number(layer.K) || 1));

  // Выбор N, K и числа орбит цели для одного слоя. Порядок бросков кубика важен
  // и не меняется: сначала N, затем K, затем орбиты.
  const chooseMorphTopologyTarget = (
    layer,
    idx,
    { lockN = false, lockK = false, preserveOrbits = false } = {},
  ) => {
    const sourceN = Number(layer.N) || 4;
    let targetN = state.morph.options.byVertices && !lockN ? chooseMorphVertexTarget(sourceN, idx) : sourceN;
    // Fix K means an N candidate cannot force K down as a side
    // effect of the legal polygon K<=floor(N/2) constraint.
    // Leave K untouched and keep N in its legal domain.
    if (lockK) targetN = Math.max(targetN, 2 * Math.max(1, Math.round(Number(layer.K) || 1)));

    const kMaxPossible = Math.max(1, Math.floor(targetN / 2));
    const stepMinPct = Math.max(0, Math.min(100, Number(state.morph.stepMin) || 0));
    const stepMaxPct = Math.max(stepMinPct, Math.min(100, Number(state.morph.stepMax ?? 100)));
    const kLo = Math.max(1, Math.min(kMaxPossible, Math.round(1 + (stepMinPct / 100) * (kMaxPossible - 1))));
    const kHi = Math.max(
      kLo,
      Math.min(kMaxPossible, Math.round(1 + (stepMaxPct / 100) * (kMaxPossible - 1))),
    );
    const currentK = currentKForTarget(layer, targetN);
    // 7.6.6: Phase is the fixed-N / variable-K continuous spiral transport.
    // K is the actual phase step; no hidden independently-resampled step is generated.
    const targetK = lockK
      ? Math.max(1, Math.round(Number(layer.K) || 1))
      : state.morph.options.bySteps
        ? state.morph.diversity
          ? randomIntExcept(kLo, kHi, currentK)
          : randomInt(kLo, kHi)
        : currentK;
    const customSuborbits = preserveOrbits && !state.morph.monoOrbitTransforms
      ? Array.isArray(layer.customSuborbits)
        ? layer.customSuborbits.map((o) => ({ ...o }))
        : layer.customSuborbits
      : chooseMorphOrbitTarget(layer, targetN, targetK);
    return { N: targetN, K: targetK, customSuborbits, currentK };
  };

  const buildMorphVisualTargets = (layers, topologyPlan = null) => {
    const palette = pickMorphPalette();
    const spiralTargetSet = chooseMorphSpiralLayerSet(layers);
    const maxRadius = Math.max(...layers.map((l) => Number(l.radius) || 220), 160);
    const ratioSets = [
      [1.0, 0.74, 0.48],
      [1.0, 0.7, 0.42],
      [1.0, 0.77, 0.52],
      [1.0, 0.66, 0.38],
    ];
    const ratios = ratioSets[randomInt(0, ratioSets.length - 1)];
    const globalScale = randomChoice([0.92, 0.96, 1.0, 1.04, 1.08]);
    const targetMax = Math.max(150, Math.min(320, maxRadius * globalScale));

    const fillMorphEnabled = state.morph.options.byFillColor === true;
    const eligibleFill = layers
      .map((layer, idx) => (layer.closedLoop !== false ? idx : -1))
      .filter((idx) => idx >= 0);
    const absoluteMax = eligibleFill.length;
    const configuredMax = Math.max(
      0,
      Math.min(absoluteMax, Math.round(Number(state.morph.fillLayersMax) || 0)),
    );
    const configuredMin = Math.max(
      0,
      Math.min(configuredMax, Math.round(Number(state.morph.fillLayersMin) || 0)),
    );
    const targetFillSet = new Set();
    if (fillMorphEnabled && configuredMax > 0 && eligibleFill.length) {
      const targetCount = randomInt(configuredMin, configuredMax);
      const candidates = shuffle([...eligibleFill]);
      for (const idx of candidates.slice(0, targetCount)) targetFillSet.add(idx);
    }

    return layers.map((layer, idx) => {
      const roleRatio = layers.length === 3 ? ratios[idx] : 1 - idx * (0.65 / Math.max(1, layers.length - 1));

      const currentKey = getProfileKeyForLayer(layer);
      const sourceSpiralOrder = normalizeSpiralOrder(layer.spiralOrder, false);
      const sourceSpiralEnabled = isSpiralLayer(layer);
      let targetSpiralEnabled =
        spiralTargetSet instanceof Set ? spiralTargetSet.has(idx) : sourceSpiralEnabled;
      if (layer.chaosStar === true) targetSpiralEnabled = false;
      const targetSpiralOrder =
        layer.chaosStar === true ? 0 : chooseMorphSpiralOrderTarget(layer, idx, spiralTargetSet);
      targetSpiralEnabled = Math.abs(targetSpiralOrder) > 1e-8;

      const morphSpiralType = getSpiralMorphType();
      const protectSpiralContinuity =
        spiralMorphKeepsContinuity() &&
        spiralMorphRestrictsTopologyParameters() &&
        (sourceSpiralEnabled || targetSpiralEnabled || UNIFIED_SPIRAL_TRANSPORTS.has(getSpiralMorphMode()));
      const lockSpiralN = protectSpiralContinuity && spiralMorphLocksN();
      const lockSpiralK = protectSpiralContinuity && spiralMorphLocksK();
      const sourceNodes = compactMorphProfileNodes(
        layer.profileNodes,
        layer.profileMode || 'segments',
        isPreSampledSplineLayer(layer),
      );

      const resetProfile = runtimeState.morph.manualProfileResetIds?.has(layer.id) === true;
      let generatedProfile = resetProfile
        ? { profileKey: 'line', mode: 'segments', nodes: [{ x: 0, y: 0 }, { x: 1, y: 0 }], closedLoop: layer.closedLoop !== false }
        : state.morph.options.byShape ? createMorphProfileVariant() : null;
      if (!resetProfile && state.morph.diversity && state.morph.options.byShape) {
        for (let attempt = 0; attempt < 10 && sameProfileVariant(layer, generatedProfile); attempt++) {
          generatedProfile = createMorphProfileVariant();
        }
      }
      if (
        generatedProfile &&
        protectSpiralContinuity &&
        targetSpiralEnabled &&
        layer.spiralClosed !== false
      ) {
        const safeNodes = (generatedProfile.nodes || []).map((p) => ({
          x: Number(p.x) || 0,
          y: Number(p.y) || 0,
        }));
        if (safeNodes.length >= 2) {
          safeNodes[0] = { ...safeNodes[0], x: 0, y: 0 };
          safeNodes[safeNodes.length - 1] = { ...safeNodes[safeNodes.length - 1], x: 1, y: 0 };
          generatedProfile = { ...generatedProfile, nodes: safeNodes, closedLoop: false };
        }
      }

      if (
        generatedProfile &&
        profileHasBacktrackingX(layer.profileNodes) &&
        profileHasBacktrackingX(generatedProfile.nodes)
      ) {
        const sourceLoopSign = loopOrientationSign(layer.profileNodes);
        const targetLoopSign = loopOrientationSign(generatedProfile.nodes);
        if (sourceLoopSign && targetLoopSign && sourceLoopSign !== targetLoopSign) {
          generatedProfile = {
            ...generatedProfile,
            nodes: generatedProfile.nodes.map((p) => ({ x: Number(p.x) || 0, y: -(Number(p.y) || 0) })),
          };
        }
      }
      const profileKey = generatedProfile?.profileKey || currentKey;
      const nodes = generatedProfile
        ? compactMorphProfileNodes(generatedProfile.nodes, generatedProfile.mode).map((p) => ({
            x: p.x,
            y: p.y,
          }))
        : sourceNodes.map((p) => ({ ...p }));
      const targetMode = generatedProfile ? generatedProfile.mode : layer.profileMode || 'segments';
      const requestedClosedLoop = generatedProfile
        ? generatedProfile.closedLoop
        : sourceSpiralEnabled && !targetSpiralEnabled
          ? layer.spiralClosed !== false
          : layer.closedLoop !== false;
      const targetClosedLoop = targetSpiralEnabled ? false : requestedClosedLoop;

      // Топологию цели (N, K, число орбит) заранее выбирает `previewMorphTopology`
      // для следующего цикла (fill-lookahead): тогда берём её, а не бросаем кубики заново.
      const planned = topologyPlan?.items?.[idx] || null;
      const topology = planned
        ? {
            N: planned.N,
            K: planned.K,
            customSuborbits: planned.customSuborbits,
            currentK: currentKForTarget(layer, planned.N),
          }
        : chooseMorphTopologyTarget(layer, idx, {
            lockN: lockSpiralN,
            lockK: lockSpiralK,
            preserveOrbits: lockSpiralK || morphSpiralType === 'phase',
          });
      const { N: targetN, K: targetK, customSuborbits: targetCustomSuborbits, currentK } = topology;
      const currentSpiralStep = normalizeSpiralStep(layer.spiralStep ?? layer.K ?? 1, {
        ...layer,
        N: targetN,
        K: currentK,
      });
      const targetChaosStar = layer.chaosStar === true && !targetSpiralEnabled;
      const chaosSpread = Math.max(
        0,
        Math.min(120, Math.round(Number(state.morph.chaosMorphStepSpread ?? 1))),
      );
      const chaosClosuresMax = Math.max(
        0,
        Math.min(120, Math.round(Number(state.morph.chaosMorphClosuresMax ?? 3))),
      );
      const morphChaos = targetChaosStar && state.morph.chaosMorphEnabled === true;
      const targetChaosStepMinus = morphChaos
        ? randomInt(0, chaosSpread)
        : Math.max(0, Math.round(Number(layer.chaosStepMinus) || 0));
      const targetChaosStepPlus = morphChaos
        ? randomInt(0, chaosSpread)
        : Math.max(0, Math.round(Number(layer.chaosStepPlus) || 0));
      const targetChaosClosureRaw = morphChaos
        ? randomInt(0, chaosClosuresMax)
        : Math.max(1, Math.round(Number(layer.chaosClosures) || 1));
      const targetChaosClosures = Math.max(1, targetChaosClosureRaw);
      const targetChaosSeed = morphChaos ? (Math.random() * 0xffffffff) >>> 0 : Number(layer.chaosSeed) >>> 0;

      const roundingMinRaw = Number(state.morph.roundingMin);
      const roundingMaxRaw = Number(state.morph.roundingMax);
      const roundingMin = Math.max(
        0,
        Math.min(MAX_ROUNDING_PERCENT, Math.round(Number.isFinite(roundingMinRaw) ? roundingMinRaw : 0)),
      );

      const roundingMax = Math.max(
        roundingMin,
        Math.min(MAX_ROUNDING_PERCENT, Math.round(Number.isFinite(roundingMaxRaw) ? roundingMaxRaw : 30)),
      );
      const currentRounding = Number(layer.rounding) || 0;
      const rounding = state.morph.options.byRounding
        ? state.morph.diversity
          ? randomIntExcept(roundingMin, roundingMax, currentRounding)
          : randomInt(roundingMin, roundingMax)
        : currentRounding;
      const currentRadius = Number(layer.radius) || 220;
      const sizeVariation = getMorphSizeVariationFactor();
      const radiusLo = Math.max(20, Math.min(500, Number(state.morph.radiusMin ?? 20) || 20));
      const radiusHi = Math.max(radiusLo, Math.min(500, Number(state.morph.radiusMax ?? 500) || 500));
      const roleTargetRadius = Math.round(targetMax * Math.max(0.24, roleRatio));
      let targetRadius = currentRadius;
      if (state.morph.options.bySize) {
        if (state.morph.normalizeSizes !== false) {
          targetRadius = Math.max(
            radiusLo,
            Math.min(
              radiusHi,
              Math.round(currentRadius + (roleTargetRadius - currentRadius) * sizeVariation),
            ),
          );
        } else {
          const independentFactor = randomChoice([0.72, 0.8, 0.88, 0.94, 1.06, 1.12, 1.2, 1.28]);
          targetRadius = Math.max(
            radiusLo,
            Math.min(radiusHi, Math.round(currentRadius * (1 + (independentFactor - 1) * sizeVariation))),
          );
        }
      }
      if (
        state.morph.diversity &&
        state.morph.options.bySize &&
        sizeVariation > 0 &&
        radiusHi > radiusLo &&
        Math.abs(targetRadius - currentRadius) < 0.001
      ) {
        targetRadius = chooseMorphInt(Math.ceil(radiusLo), Math.floor(radiusHi), currentRadius);
      }

      const currentRotation = Number(layer.rotation) || 0;
      let targetRotation =
        state.morph.options.byRotation && !isAudioRotationOverrideActive()
          ? currentRotation + chooseMorphRotationDelta()
          : currentRotation;
      if (
        state.morph.diversity &&
        state.morph.options.byRotation &&
        !isAudioRotationOverrideActive() &&
        Math.abs(targetRotation - currentRotation) < 0.001 &&
        Number(state.morph.rotationMaxPercent) > 0
      ) {
        targetRotation = currentRotation + chooseMorphRotationDelta();
      }

      const currentStrokeWidth = Math.max(0.5, Math.min(20, Number(layer.strokeWidth) || 1.5));
      const strokeWidthMin = Math.max(0.5, Math.min(20, Number(state.morph.strokeWidthMin) || 0.8));
      const strokeWidthMax = Math.max(
        strokeWidthMin,
        Math.min(20, Number(state.morph.strokeWidthMax) || 3.2),
      );
      let targetStrokeWidth = currentStrokeWidth;
      if (state.morph.options.byStrokeWidth) {
        targetStrokeWidth = strokeWidthMin + Math.random() * (strokeWidthMax - strokeWidthMin);
        targetStrokeWidth = Math.round(targetStrokeWidth * 10) / 10;
        if (
          state.morph.diversity &&
          Math.abs(targetStrokeWidth - currentStrokeWidth) < 0.05 &&
          strokeWidthMax > strokeWidthMin
        ) {
          targetStrokeWidth =
            Math.abs(currentStrokeWidth - strokeWidthMin) > Math.abs(strokeWidthMax - currentStrokeWidth)
              ? strokeWidthMin
              : strokeWidthMax;
        }
      }

      const currentColor = layer.strokeColor || '#6366f1';
      const globalHueMorph = state.morph.morphGlobalHueOffset === true;
      let globalHueDelta = 0;
      if (globalHueMorph) {
        const a = Number(runtimeState.morph.sourceGlobalHueOffset) || 0,
          b = Number(runtimeState.morph.targetGlobalHueOffset) || a;
        globalHueDelta = b - a;
      }
      const targetColorBase = state.morph.options.byColor ? palette[idx % palette.length] : currentColor;
      let targetColor = globalHueMorph ? shiftHueHex(targetColorBase, globalHueDelta) : targetColorBase;
      if (
        state.morph.diversity &&
        state.morph.options.byColor &&
        targetColor.toLowerCase() === currentColor.toLowerCase()
      ) {
        const alternatives = getAllPlaylistPaletteColors().filter(
          (c) => c.toLowerCase() !== currentColor.toLowerCase(),
        );
        if (alternatives.length) targetColor = randomChoice(alternatives);
      }

      let targetFill = Boolean(layer.fill);
      let targetFillHueOffset = signedHueOffsetDegrees(currentColor, layer.fillColor || currentColor);
      let targetFillOpacity = getFillOpacityPercent(layer.fillColor);
      let targetFillColor = layer.fillColor || colorWithPercentAlpha(currentColor, targetFillOpacity);
      if (fillMorphEnabled) {
        targetFill = targetFillSet.has(idx) && targetClosedLoop;
        targetFillHueOffset = chooseFillHarmonyOffset();
        const opacityMin = Math.max(0, Math.min(100, Number(state.morph.fillOpacityMin) || 0));
        const opacityMax = Math.max(
          opacityMin,
          Math.min(100, Number(state.morph.fillOpacityMax) || opacityMin),
        );
        targetFillOpacity = chooseMorphInt(
          Math.ceil(opacityMin),
          Math.floor(opacityMax),
          Math.round(targetFillOpacity),
        );
        const fillBase = shiftHueHex(targetColor, targetFillHueOffset);
        targetFillColor = colorWithPercentAlpha(fillBase, targetFill ? targetFillOpacity : 0);
      } else if ((state.morph.options.byColor || globalHueMorph) && targetFill) {
        targetFillColor = colorWithPercentAlpha(targetColor, targetFillOpacity);
      }
      if (!targetClosedLoop || targetSpiralEnabled) {
        targetFill = false;
        targetFillColor = colorWithPercentAlpha(targetFillColor || targetColor, 0);
      }

      return {
        profileKey,
        nodes,
        mode: targetMode,
        N: targetN,
        K: targetK,
        customSuborbits: targetChaosStar ? null : targetCustomSuborbits,
        chaosStar: targetChaosStar,
        chaosStepMinus: targetChaosStepMinus,
        chaosStepPlus: targetChaosStepPlus,
        chaosClosures: targetChaosClosures,
        chaosSeed: targetChaosSeed,
        radius: targetRadius,
        rotation: targetRotation,
        spiralEnabled: Math.abs(targetSpiralOrder) > 1e-8,
        spiralOrder: targetSpiralOrder,
        spiralStep: normalizeSpiralStep(
          morphSpiralType === 'minimalTurn'
            ? currentSpiralStep
            : spiralMorphUsesCorridorPhase() && state.morph.options.bySteps
              ? targetK
              : currentSpiralStep,
          { ...layer, N: targetN, K: targetK },
        ),
        spiralStepLinked:
          spiralMorphUsesCorridorPhase() || morphSpiralType === 'minimalTurn'
            ? false
            : layer.spiralStepLinked !== false,
        spiralStepLimiterEnabled: layer.spiralStepLimiterEnabled !== false,
        spiralStepLimiter: Math.max(1, Math.min(120, Math.round(Number(layer.spiralStepLimiter ?? 2) || 2))),
        spiralClosed: layer.spiralClosed !== false,
        spiralTwist: layer.spiralTwist === true,
        spiralTangential:
          state.morph.options.bySpiralLayers &&
          (spiralTargetSet instanceof Set ? spiralTargetSet.has(idx) : isSpiralLayer(layer))
            ? Math.random() * 100 <
              Math.max(0, Math.min(100, Number(state.morph.spiralTangentialChance ?? 50)))
            : layer.spiralTangential === true,
        spiralRoundSeams: layer.spiralRoundSeams !== false,

        strokeColor: targetColor,
        fill: targetFill,
        fillHueOffset: targetFillHueOffset,
        fillOpacity: targetFillOpacity,
        fillColor: targetFillColor,
        strokeWidth: targetStrokeWidth,
        glow: Math.max(0, Number(layer.glow) || 0),
        opacity: state.morph.options.byOpacity
          ? chooseMorphInt(
              Math.ceil(Math.max(0, Math.min(100, Number(state.morph.opacityMin ?? 70)))),
              Math.floor(Math.min(100, Number(state.morph.opacityMax ?? 100))),
              layer.opacity ?? 90,
            )
          : Number(layer.opacity) || 90,
        rounding,
        lineJoinType: layer.lineJoinType || 'rounded',
        closedLoop: targetClosedLoop,
        rawNodes: generatedProfile
          ? generatedProfile.nodes.map((p) => ({ x: Number(p.x) || 0, y: Number(p.y) || 0 }))
          : (layer.profileNodes || []).map((p) => ({ x: Number(p.x) || 0, y: Number(p.y) || 0 })),
      };
    });
  };

  const buildLightMorphVisualTargets = (layers) => {
    const palette = pickMorphPalette();
    const spiralTargetSet = chooseMorphSpiralLayerSet(layers);
    return layers.map((layer, idx) => {
      const currentRadius = Math.max(1, Number(layer.radius) || 220);
      let targetRadius = currentRadius;
      if (state.morph.options.bySize) {
        const variation = getMorphSizeVariationFactor();
        const radiusLo = Math.max(20, Math.min(500, Number(state.morph.radiusMin ?? 20) || 20));
        const radiusHi = Math.max(radiusLo, Math.min(500, Number(state.morph.radiusMax ?? 500) || 500));
        const factor = randomChoice([0.78, 0.86, 0.92, 1.08, 1.16, 1.24]);
        const scaledFactor = 1 + (factor - 1) * variation;
        targetRadius = Math.max(radiusLo, Math.min(radiusHi, Math.round(currentRadius * scaledFactor)));
        if (
          state.morph.diversity &&
          variation > 0 &&
          radiusHi > radiusLo &&
          Math.abs(targetRadius - currentRadius) < 1
        ) {
          targetRadius = chooseMorphInt(Math.ceil(radiusLo), Math.floor(radiusHi), currentRadius);
        }
      }

      const currentRotation = Number(layer.rotation) || 0;
      let targetRotation = currentRotation;
      if (state.morph.options.byRotation && !isAudioRotationOverrideActive()) {
        targetRotation = currentRotation + chooseMorphRotationDelta();
      }

      const targetSpiralOrder =
        layer.chaosStar === true ? 0 : chooseMorphSpiralOrderTarget(layer, idx, spiralTargetSet);

      const currentStrokeWidth = Math.max(0.5, Math.min(20, Number(layer.strokeWidth) || 1.5));
      const strokeWidthMin = Math.max(0.5, Math.min(20, Number(state.morph.strokeWidthMin) || 0.8));
      const strokeWidthMax = Math.max(
        strokeWidthMin,
        Math.min(20, Number(state.morph.strokeWidthMax) || 3.2),
      );
      const targetStrokeWidth = state.morph.options.byStrokeWidth
        ? state.morph.diversity && Math.ceil(strokeWidthMin * 10) <= Math.floor(strokeWidthMax * 10)
          ? randomIntExcept(
              Math.ceil(strokeWidthMin * 10),
              Math.floor(strokeWidthMax * 10),
              Math.round(currentStrokeWidth * 10),
            ) / 10
          : Math.round((strokeWidthMin + Math.random() * (strokeWidthMax - strokeWidthMin)) * 10) / 10
        : currentStrokeWidth;

      const currentColor = layer.strokeColor || '#6366f1';
      const globalHueMorph = state.morph.morphGlobalHueOffset === true;
      let globalHueDelta = 0;
      if (globalHueMorph) {
        const a = Number(runtimeState.morph.sourceGlobalHueOffset) || 0,
          b = Number(runtimeState.morph.targetGlobalHueOffset) || a;
        globalHueDelta = b - a;
      }
      const targetColorBase = state.morph.options.byColor ? palette[idx % palette.length] : currentColor;
      const targetColor = globalHueMorph ? shiftHueHex(targetColorBase, globalHueDelta) : targetColorBase;
      const rawNodes = (layer.profileNodes || []).map((p) => ({ x: Number(p.x) || 0, y: Number(p.y) || 0 }));
      return {
        profileKey: getProfileKeyForLayer(layer),
        nodes: rawNodes.map((p) => ({ ...p })),
        rawNodes,
        mode: layer.profileMode || 'segments',
        N: Number(layer.N) || 4,
        K: Number(layer.K) || 1,
        radius: targetRadius,
        rotation: targetRotation,
        spiralEnabled: Math.abs(targetSpiralOrder) > 1e-8,
        spiralOrder: targetSpiralOrder,
        spiralStep: normalizeSpiralStep(layer.spiralStep ?? layer.K ?? 1, layer),
        spiralStepLinked: layer.spiralStepLinked !== false,
        spiralStepLimiterEnabled: layer.spiralStepLimiterEnabled !== false,
        spiralStepLimiter: Math.max(1, Math.min(120, Math.round(Number(layer.spiralStepLimiter ?? 2) || 2))),
        spiralClosed: layer.spiralClosed !== false,
        spiralTwist: layer.spiralTwist === true,
        spiralTangential: layer.spiralTangential === true,
        spiralRoundSeams: layer.spiralRoundSeams !== false,

        strokeColor: targetColor,
        strokeWidth: targetStrokeWidth,
        glow: Math.max(0, Number(layer.glow) || 0),
        opacity: state.morph.options.byOpacity
          ? chooseMorphInt(
              Math.ceil(Math.max(0, Math.min(100, Number(state.morph.opacityMin ?? 70)))),
              Math.floor(Math.min(100, Number(state.morph.opacityMax ?? 100))),
              layer.opacity ?? 90,
            )
          : Number(layer.opacity) || 90,
        rounding: Number(layer.rounding) || 0,
        lineJoinType: layer.lineJoinType || 'rounded',
        closedLoop:
          Math.abs(targetSpiralOrder) > 1e-8
            ? false
            : isSpiralLayer(layer)
              ? layer.spiralClosed !== false
              : layer.closedLoop !== false,
      };
    });
  };

  return Object.freeze({
    colorWithAlpha,
    colorWithPercentAlpha,
    colorWithUnitAlpha,
    shiftHueHex,
    FILL_HARMONY_OFFSETS,
    getFillHarmonyOffsets,
    chooseFillHarmonyOffset,
    signedHueOffsetDegrees,
    lerpAngleDegrees,
    normalizedMorphShapeOptions,
    makeOpenProfileVariant,
    makeOpenAngularProfileVariant,
    morphProfileMetaMatches,
    morphLibraryProfileCandidates,
    createLibraryMorphProfileVariant,
    createElegantProceduralLoop,
    createMorphProfileVariant,
    getProfileKeyForLayer,
    pickMorphPalette,
    randomIntExcept,
    sameProfileVariant,
    chooseMorphVertexTarget,
    getActiveOrbitCount,
    chooseMorphOrbitTarget,
    getMorphSizeVariationFactor,
    chooseMorphSpiralLayerSet,
    chooseMorphSpiralOrderTarget,
    chooseMorphRotationDelta,
    chooseMorphTopologyTarget,
    buildMorphVisualTargets,
    buildLightMorphVisualTargets,
  });
}

export { createMorphTargetsModule };
