// Пресеты, случайные параметры и хуки перебазирования морфа.
import '../morph-runtime/blue/morph-ui.js'; // initialisation order: this module runs after it
import { normalizeSplineRenderMode } from '../geometry/profile-model.js';
import { renderProfileEditor } from './profile-editor.js';
import {
  contourModeIsSpiral,
  getContourMode,
  normalizeSpiralOrder,
  normalizeSpiralStep,
} from '../geometry/spiral/order-params.js';
import { frameGraphPerformanceRuntime } from '../render/backend-telemetry.js';
import { WebGPUFinalCompositeRenderer } from '../gpu/final-composite-renderer.js';
import { WebGPUStrokeRenderer } from '../gpu/stroke-renderer.js';
import { WebGPUProfileMarkerRenderer } from '../gpu/profile-marker-renderer.js';
import { ensureAudioRoutingState } from '../audio/audio-routing.js';
import { lampAnchorCache, setLampContourAttachmentEnabled } from '../lamps/lamp-anchors.js';
import { lampMotionRuntime } from '../lamps/lamp-motion.js';
import { normalizeGlintPrecisionValue } from '../effects/sweep-glint.js';
import {
  normalizeLightningBehaviorValue,
  normalizeLightningPrecisionValue,
} from '../effects/lightning-exact.js';
import {
  lightningRateSyncEnabled,
  resetLightningClock,
  setLightningRateSynchronization,
  syncLightningRateValuesFrom,
} from '../effects/lightning.js';
import {
  ensureGpuPathFxAnimation,
  ensureParticleAnimation,
  ensureSweepAnimation,
  getLayerParticleConfig,
  syncParticleUI,
} from '../effects/effect-animation.js';
import { queueWebSwitchForNextMorph } from '../effects/web.js';
import {
  getLayerMainLineMode,
  normalizeLineMarkerType,
  setFourierMode,
  setLayerMainLineMode,
  setSidebarMode,
  syncFourierStrengthUI,
  syncLampSettingsUI,
  syncMorphModeDependentUI,
  syncMotionUI,
  syncSidebarToolStates,
  syncSweepUI,
  syncWebOutlineUI,
} from './effects-sidebar.js';
import {
  DEFAULT_FILL_OPACITY_PERCENT,
  applyLineVisibilityToTargets,
  cloneEffectConfig,
  colorBaseHex6,
  createLayer,
  createLayerId,
  ensureLayerEffectState,
  gcd,
  getActiveEffectLayer,
  getActiveLampConfig,
  getEffectTargets,
  getFillOpacityPercent,
  getLampConfigTargets,
  getLayerSweepConfig,
  getLayerWebConfig,
  getLineSpritePreset,
  markLayerEffectChanged,
  normalizeLightningLampBlendMode,
  normalizeLineMotionFxConfig,
  normalizeLineSpriteConfig,
  normalizeLineSpritePlacement,
  normalizeLineSpriteType,
  normalizeParticleConfig,
  normalizeSweepBlendMode,
  normalizeSweepConfig,
  normalizeSweepFlashMode,
  setLayerGlintEnabled,
  setLayerLampsEnabled,
  setLayerLightningEnabled,
  setLayerParticlesConfig,
  sidebarFeatureStatesAreUniform,
  toggleAllLinesWithMemory,
  toggleSidebarFeatureWithMemory,
  withLampConfig,
} from '../core/defaults-layers.js';
import {
  cyclePlaylistPaletteForContext,
  morphPaletteSyncEnabled,
  normalizePlaylistHueOffset,
  normalizePlaylistPaletteKey,
  selectMorphLayerPaletteColors,
  setMorphPaletteForContext,
} from '../core/palette.js';
import { invalidateLayerGeometry } from '../core/render-runtime.js';
import { requestMainCanvasRender } from '../core/scheduler.js';
import { runtimeState, somataFourierSyncMorphSnapshots, state } from '../core/state.js';
import {
  ensureMotionAnimation,
  getMotionRotationTargets,
  normalizeLayerMotionRotation,
  normalizeMotionState,
  toggleMotionQuickGroup,
} from '../effects/motion.js';
import { MorphGeometry } from '../geometry/morph.js';
import { WebGPUGraffitiMorphRenderer } from '../gpu/graffiti-morph-renderer.js';
import { WebGPUGraffitiRibbonRenderer } from '../gpu/graffiti-ribbon-renderer.js';
import { LampGPURenderer } from '../gpu/lamp-renderer.js';
import { WebGPUParticleRenderer } from '../gpu/particle-renderer.js';
import { WebGPUPathFxRenderer } from '../gpu/path-fx-renderer.js';
import { renderMainCanvas } from '../render/main-pipeline.js';
import { SomataMasterBroadcastCore } from './master-broadcast-core.js';
import {
  PRESETS,
  PRESET_KEYS,
  PROFILE_PRESETS,
  PROFILE_PRESET_GROUPS,
  PROFILE_PRESET_GROUP_ORDER,
  PROFILE_PRESET_META,
} from './profile-presets.js';
import { syncTunnelSettingsUI, toggleTunnelMode } from './corridor-panel.js';
import { getLayerEditTargets, hasMultiLayerSelection, updateLayerListUI } from './layer-selection.js';
import {
  FRAME_LEVEL_MORPH_MODES,
  UNIFIED_MORPH_KEYS,
  getSpiralMorphMode,
  getUnifiedMorphMode,
  normalizeSpiralMorphMode,
  setSpiralMorphMode,
  setUnifiedMorphMode,
} from '../morph-runtime/morph-mode.js';
import { syncGpuLineFxUI, syncSidebarInputs } from './sidebar-sync.js';
import { morphSpecialLayerCoverage } from './blue-morph/profile-bindings.js';
import { cloneMasterLayerValue, collectMasterChangedPaths, masterLayerSnapshot } from './master-layer.js';
import { activeRebaseMorphing, morphSidebarRebaseRuntime } from '../morph-runtime/morph-hooks.js';
import {
  getNextTapBoundary,
  getTapMorphIntervalSec,
  isTapMorphSyncActive,
  syncTapTimingIndicators,
} from '../audio/tap-tempo.js';
import { syncPlaylistPaletteHueOffsetUI, syncPlaylistPaletteSelectionUI } from './playlist-palettes.js';
import {
  getOrangeMorphBindings,
  hasOrangeColorRoute,
  normalizeOrangeMorphFamily,
  normalizeOrangeMorphProfileGroup,
  normalizedOrangeMorphProfileGroups,
  orangeFillOptions,
  syncOrangeMorphModeOptions,
} from './orange-morph/routing-ui.js';
import {
  syncMorphSettingsUI,
  toggleMorphSettingsPanel,
  viewportPopupBelongsToPanel,
} from './morph-settings-panel.js';
import { createMorphInterpolationModule } from '../morph-runtime/blue/interpolation.js';
import { createMorphTargetsModule } from '../morph-runtime/blue/targets.js';
import { createMorphPlaybackModule } from '../morph-runtime/blue/playback.js';
import { createMorphUIModule } from '../morph-runtime/blue/morph-ui.js';
import { positionFloatingPanelNearTrigger } from './floating-panels.js';
import { noteSuppressedError } from '../core/suppressed-errors.js';
import { snapLampAdaptiveExponent } from '../lamps/adaptive-exponent.js';

function bindPresetRandomMorphControls(bindingContext) {
  const getActiveLayer = bindingContext.getActiveLayer;
  const applyMainPreset = (key) => {
    stopMorphing();
    if (!PRESETS[key]) return;
    state.layers = JSON.parse(JSON.stringify(PRESETS[key])).map((l) => ({
      ...l,
      roundingShape: 'hybrid',
      visible: true,
      spiralEnabled: l.spiralEnabled === true || Math.abs(normalizeSpiralOrder(l.spiralOrder, false)) > 1e-8,
      spiralOrder: normalizeSpiralOrder(l.spiralOrder, false),
      spiralStep: normalizeSpiralStep(l.spiralStep ?? l.K ?? 1, l),
      spiralStepLinked: l.spiralStepLinked !== false,
      spiralStepLimiterEnabled: l.spiralStepLimiterEnabled !== false,
      spiralStepLimiter: Math.max(1, Math.min(120, Math.round(Number(l.spiralStepLimiter ?? 2) || 2))),
      spiralClosed: l.spiralClosed !== false,
      spiralTwist: l.spiralTwist === true,
      spiralTangential: l.spiralTangential === true,
      spiralRoundSeams: l.spiralRoundSeams !== false,

      spiralFillEnabled: l.spiralFillEnabled === true,
      spiralFillType: ['interwinding', 'mathematical'].includes(l.spiralFillType)
        ? l.spiralFillType
        : 'chopped',
      splineRenderMode: normalizeSplineRenderMode(l.splineRenderMode),
      wholeCurveSpline: l.wholeCurveSpline === true,
      id: createLayerId(),
    }));
    state.activeLayerId = state.layers[0].id;
    document.getElementById('presetSelect').value = key;
    updateLayerListUI();
    syncSidebarInputs();
    renderProfileEditor();
    renderMainCanvas();
  };

  const randomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

  const randomChoice = (items) => items[Math.floor(Math.random() * items.length)];

  const shuffle = (items) => {
    const arr = [...items];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };

  const getRandomCoprimeStep = (n, minStep = 2) => {
    const candidates = [];
    for (let k = minStep; k <= Math.floor(n / 2); k++) {
      if (gcd(n, k) === 1) candidates.push(k);
    }
    if (!candidates.length) return 1;
    return randomChoice(candidates);
  };

  const MORPH_LINE_PALETTES = {
    standard: [
      '#22d3ee',
      '#a78bfa',
      '#f472b6',
      '#38bdf8',
      '#14b8a6',
      '#fbbf24',
      '#fb7185',
      '#8b5cf6',
      '#34d399',
      '#60a5fa',
      '#f43f5e',
      '#f97316',
    ],
    pastel: [
      '#a5f3fc',
      '#c4b5fd',
      '#fbcfe8',
      '#bae6fd',
      '#99f6e4',
      '#fde68a',
      '#fecdd3',
      '#ddd6fe',
      '#bbf7d0',
      '#bfdbfe',
    ],
    acid: ['#39ff14', '#00fff0', '#ff00cc', '#fff500', '#ff5f00', '#7cff00', '#00a2ff', '#b000ff'],
    rgb: ['#ff0000', '#00ff00', '#0000ff'],
    rasta: ['#16a34a', '#facc15', '#dc2626'],
    fire: [
      '#7f1d1d',
      '#b91c1c',
      '#ef2b0a',
      '#f97316',
      '#fb8500',
      '#ffb000',
      '#facc15',
      '#fde047',
      '#fff1a8',
      '#ff5a1f',
      '#ff2d00',
      '#dc2626',
    ],
    ice: [
      '#ffffff',
      '#e0fbff',
      '#cffafe',
      '#a5f3fc',
      '#7dd3fc',
      '#38bdf8',
      '#0ea5e9',
      '#0284c7',
      '#2563eb',
      '#6366f1',
      '#bae6fd',
      '#67e8f9',
    ],
    sex: [
      '#ff1744',
      '#ff2d95',
      '#f43f5e',
      '#fb7185',
      '#e11d48',
      '#db2777',
      '#c026d3',
      '#a21caf',
      '#9333ea',
      '#7c3aed',
      '#ff4d6d',
      '#fda4af',
    ],
    holy: [
      '#ffffff',
      '#fffdf7',
      '#fffaf0',
      '#fff7d6',
      '#ffed9a',
      '#fde68a',
      '#facc15',
      '#ffd166',
      '#ffb000',
      '#f59e0b',
      '#f97316',
      '#fff1b8',
      '#ffffff',
    ],
  };
  const RANDOM_PALETTES = ['standard', 'pastel', 'acid', 'rgb', 'rasta'].map(
    (key) => MORPH_LINE_PALETTES[key],
  );

  const RANDOM_PROFILE_WEIGHTS = {
    outer: [
      ['line', 0.34],
      ['arc', 0.3],
      ['triangle', 0.16],
      ['sine', 0.12],
      ['double_peak', 0.08],
    ],
    middle: [
      ['line', 0.16],
      ['arc', 0.24],
      ['triangle', 0.16],
      ['sine', 0.2],
      ['double_peak', 0.14],
      ['zigzag', 0.06],
      ['loop', 0.04],
    ],
    inner: [
      ['line', 0.1],
      ['arc', 0.18],
      ['triangle', 0.14],
      ['sine', 0.2],
      ['double_peak', 0.18],
      ['loop', 0.12],
      ['notch', 0.05],
      ['zigzag', 0.03],
    ],
  };

  const RANDOM_RECIPES = [
    { profiles: ['line', 'arc', 'sine'], kModes: ['simple', 'petal', 'petal'], rotOffsets: [0, 8, 16] },
    {
      profiles: ['line', 'triangle', 'double_peak'],
      kModes: ['simple', 'star', 'petal'],
      rotOffsets: [0, 9, 18],
    },
    { profiles: ['arc', 'line', 'loop'], kModes: ['petal', 'simple', 'petal'], rotOffsets: [0, 7.5, 15] },
    {
      profiles: ['line', 'sine', 'triangle'],
      kModes: ['simple', 'harmonic', 'star'],
      rotOffsets: [0, 11, 22],
    },
    {
      profiles: ['triangle', 'arc', 'double_peak'],
      kModes: ['star', 'petal', 'petal'],
      rotOffsets: [0, 10, 20],
    },
    {
      profiles: ['line', 'double_peak', 'arc'],
      kModes: ['simple', 'petal', 'petal'],
      rotOffsets: [0, 6, 12],
    },
  ];

  const weightedChoice = (pairs) => {
    const r = Math.random();
    let acc = 0;
    for (const [value, weight] of pairs) {
      acc += weight;
      if (r <= acc) return value;
    }
    return pairs[pairs.length - 1][0];
  };

  const getProfileForRole = (role, avoid = []) => {
    let candidates = RANDOM_PROFILE_WEIGHTS[role] || RANDOM_PROFILE_WEIGHTS.middle;
    let filtered = candidates.filter(([k]) => !avoid.includes(k));
    if (!filtered.length) filtered = candidates;
    return weightedChoice(filtered);
  };

  const getKForMode = (N, mode) => {
    if (mode === 'simple') return 1;
    if (mode === 'star') {
      const candidates = [];
      for (let k = 2; k <= Math.floor(N / 2); k++) {
        if (gcd(N, k) <= 2) candidates.push(k);
      }
      return candidates.length ? randomChoice(candidates) : getRandomCoprimeStep(N, 2);
    }
    if (mode === 'harmonic') {
      const preferred = [3, 5, 7, 9, 11].filter((k) => k <= Math.floor(N / 2) && gcd(N, k) === 1);
      return preferred.length ? randomChoice(preferred) : getRandomCoprimeStep(N, 2);
    }
    const candidates = [];
    for (let k = 2; k <= Math.floor(N / 2); k++) {
      if (gcd(N, k) === 1) candidates.push(k);
    }
    return candidates.length ? randomChoice(candidates) : 1;
  };

  const createRandomLayer = ({
    name,
    N,
    radius,
    color,
    profileKey,
    rotation,
    strokeWidth,
    glow,
    opacity,
    fill,
    rounding,
    kMode,
  }) => {
    const profile = PROFILE_PRESETS[profileKey] || PROFILE_PRESETS.line;
    const profileMeta = PROFILE_PRESET_META[profileKey] || PROFILE_PRESET_META.line;
    const profileClosed = typeof profileMeta?.closed === 'boolean' ? profileMeta.closed : true;
    return {
      ...createLayer(name),
      visible: true,
      N,
      K: getKForMode(N, kMode),
      customSuborbits: null,
      closedLoop: profileClosed,
      lineJoinType: 'rounded',
      rounding,
      radius,
      rotation,
      opacity,
      strokeColor: color,
      strokeWidth,
      glow,
      fill,
      fillColor: fill ? `${color}08` : '#00000000',
      profileMode: profile.mode,
      profileNodes: JSON.parse(JSON.stringify(profile.nodes)),
    };
  };

  const scoreRandomComposition = (profiles, ns, ratios) => {
    let score = 0;
    if (new Set(profiles).size === profiles.length) score += 3;
    if (profiles[0] === 'line' || profiles[0] === 'arc') score += 3;
    if (ratios[1] > 0.6 && ratios[1] < 0.82) score += 2;
    if (ratios[2] > 0.34 && ratios[2] < 0.58) score += 2;
    if (new Set(ns).size >= 2) score += 2;
    return score + Math.random() * 1.5;
  };

  const ROLE_NAMES = ['Внешний каркас', 'Средний орнамент', 'Внутренний акцент', 'Центральный акцент'];
  const RANDOM_N_BY_ROLE = [
    [10, 12, 14, 16, 18, 20, 24],
    [8, 9, 12, 14, 15, 16, 18, 20],
    [6, 7, 8, 9, 10, 12, 14, 16],
    [5, 6, 7, 8, 9, 10, 12],
  ];
  const RANDOM_RATIO_SETS = [
    [1.0, 0.76, 0.54, 0.34],
    [1.0, 0.72, 0.48, 0.3],
    [1.0, 0.8, 0.58, 0.38],
    [1.0, 0.68, 0.44, 0.28],
    [1.0, 0.74, 0.5, 0.32],
  ];

  const orangeProfileCandidates = (
    profileGroups = normalizedOrangeMorphProfileGroups(),
    family = normalizeOrangeMorphFamily(),
  ) => {
    const groups = Array.isArray(profileGroups) && profileGroups.length ? profileGroups : ['standard'];
    const fam = normalizeOrangeMorphFamily(family);
    let keys = [
      ...new Set(
        groups.flatMap((group) => PROFILE_PRESET_GROUPS[normalizeOrangeMorphProfileGroup(group)] || []),
      ),
    ];
    if (fam !== 'mix') keys = keys.filter((key) => PROFILE_PRESET_META[key]?.family === fam);
    if (!keys.length && fam !== 'mix') {
      keys = [
        ...new Set(
          groups.flatMap((group) => PROFILE_PRESET_GROUPS[normalizeOrangeMorphProfileGroup(group)] || []),
        ),
      ];
    }
    return keys.length ? keys : (PROFILE_PRESET_GROUPS.standard || ['line']).slice();
  };

  const simplestProfileKeyForOrangePool = (profileGroups, family) => {
    const keys = orangeProfileCandidates(profileGroups, family);
    if (keys.includes('line')) return 'line';
    return (
      keys.slice().sort((a, b) => {
        const ap = PROFILE_PRESETS[a],
          bp = PROFILE_PRESETS[b];
        const an = Array.isArray(ap?.nodes) ? ap.nodes.length : 999;
        const bn = Array.isArray(bp?.nodes) ? bp.nodes.length : 999;
        return an - bn;
      })[0] || 'line'
    );
  };

  const buildRandomProfileSequence = (
    count,
    recipe,
    options = state.randomOptions || {},
    profileGroups = normalizedOrangeMorphProfileGroups(),
    family = normalizeOrangeMorphFamily(),
  ) => {
    const groups =
      Array.isArray(profileGroups) && profileGroups.length
        ? profileGroups.map(normalizeOrangeMorphProfileGroup)
        : ['standard'];
    const fam = normalizeOrangeMorphFamily(family);
    const groupPool = orangeProfileCandidates(groups, fam);
    const base = recipe?.profiles || ['line', 'arc', 'sine'];
    const result = [];
    const legacyStandardMix = groups.length === 1 && groups[0] === 'standard' && fam === 'mix';
    for (let i = 0; i < count; i++) {
      const role = i === 0 ? 'outer' : i === count - 1 ? 'inner' : 'middle';
      if (options.onlyLine || options.byShape === false) {
        result.push(simplestProfileKeyForOrangePool(groups, fam));
        continue;
      }
      if (!legacyStandardMix) {
        const unused = groupPool.filter((key) => !result.includes(key));
        result.push(randomChoice(unused.length ? unused : groupPool));
        continue;
      }
      const recipeKey = base[i % base.length];
      const shouldUseRecipe = Math.random() < (i === 0 ? 0.78 : 0.64);
      let key = shouldUseRecipe ? recipeKey : getProfileForRole(role, result);
      if (result.includes(key) && count <= 4) key = getProfileForRole(role, result);
      result.push(key);
    }
    return result;
  };

  const randomDistinctPaletteColors = (paletteKey, count = 3) =>
    selectMorphLayerPaletteColors(paletteKey, count, { fixed: state.randomOptions?.fixedColors === true });

  const makeRandomCandidate = (
    requestedCount = state.randomLayerCount || 3,
    profileGroups = normalizedOrangeMorphProfileGroups(),
    family = normalizeOrangeMorphFamily(),
  ) => {
    const count = Math.max(1, Math.min(8, Number(requestedCount) || 3));
    const paletteKey = normalizePlaylistPaletteKey(state.randomOptions?.lineColorPalette, 'standard');
    const paletteBase = randomDistinctPaletteColors(paletteKey, Math.max(3, count));
    const colors = Array.from({ length: count }, (_, idx) => {
      if (idx < paletteBase.length) return paletteBase[idx];
      const base = paletteBase[idx % paletteBase.length];
      const hsl = rgbToHsl(...Object.values(hexToRgb(base)));
      const h = (hsl.h + idx * 0.09) % 1;
      const l = Math.max(0.38, Math.min(0.72, hsl.l + (idx % 2 ? 0.04 : -0.02)));
      return hslToHex(h, Math.max(0.45, hsl.s), l);
    });

    const options = state.randomOptions || {};
    const recipe = randomChoice(RANDOM_RECIPES);
    const profiles = buildRandomProfileSequence(count, recipe, options, profileGroups, family);
    const ratioSet = randomChoice(RANDOM_RATIO_SETS);
    const outerR = randomInt(225, 265);
    const baseRotation = randomInt(0, 359);
    const ratioAt = (idx) => {
      if (!options.bySize) return 1;
      if (idx < ratioSet.length) return ratioSet[idx];
      const t = idx / Math.max(1, count - 1);
      return 0.28 + (1 - t) * 0.72;
    };
    const sharedNPool = RANDOM_N_BY_ROLE[0];
    const sharedN = randomChoice(sharedNPool);
    const sharedKMode = randomChoice(['simple', 'harmonic', 'star']);
    const sharedK = options.bySteps ? null : 1;
    const sharedColor = colors[0];

    const layerSpecs = [];
    const ns = [];
    const ratios = [];

    for (let idx = 0; idx < count; idx++) {
      const role = idx === 0 ? 'outer' : idx === count - 1 ? 'inner' : 'middle';
      const rolePool = RANDOM_N_BY_ROLE[Math.min(idx, RANDOM_N_BY_ROLE.length - 1)];
      const pool = rolePool.filter((n) => !ns.includes(n));
      const N = options.byVertices ? (pool.length ? randomChoice(pool) : randomChoice(rolePool)) : sharedN;
      ns.push(N);
      const ratio = ratioAt(idx);
      ratios.push(ratio);
      const radius = Math.round(outerR * ratio);
      const profileKey = profiles[idx];
      const roleRoundings =
        idx === 0 ? [0, 0, 6, 10, 14] : role === 'middle' ? [4, 8, 12, 16, 20] : [6, 10, 14, 18, 24];
      const rounding = options.byRounding ? randomChoice(roleRoundings) : 0;
      const fillChance = idx === 0 ? 0.03 : role === 'middle' ? 0.16 : 0.28;
      const recipeMode = options.bySteps ? recipe.kModes[idx % recipe.kModes.length] : 'simple';
      const rotStep = recipe.rotOffsets[idx % recipe.rotOffsets.length] ?? idx * 6;
      const color = options.byColor ? colors[idx] : sharedColor;
      const finalRadius = options.bySize ? radius : outerR;
      layerSpecs.push({
        name: `${ROLE_NAMES[Math.min(idx, ROLE_NAMES.length - 1)]} ${idx + 1}`,
        N,
        radius: finalRadius,
        color,
        profileKey,
        rotation: baseRotation + rotStep,
        strokeWidth:
          idx === 0
            ? randomChoice([1.4, 1.6, 1.8, 2])
            : role === 'middle'
              ? randomChoice([1.1, 1.3, 1.5, 1.7])
              : randomChoice([1, 1.2, 1.4, 1.6]),
        glow: idx === 0 ? randomChoice([3, 5, 7, 9]) : randomChoice([4, 6, 8, 10]),
        opacity: idx === 0 ? randomInt(90, 100) : randomInt(76, 97),
        fill: Math.random() < fillChance,
        rounding,
        kMode: recipeMode,
        forceSimpleK: !options.bySteps,
      });
    }

    let score = scoreRandomComposition(profiles, ns, ratios);
    if (count === 1) score += 1.5;
    if (count >= 3 && new Set(ns).size >= Math.min(count, 3)) score += 1.5;
    if (layerSpecs.filter((l) => l.rounding > 0).length >= Math.max(1, Math.floor(count / 2))) score += 1;
    return { layerSpecs, score };
  };

  const applyRandomSpiralLayers = (layers) => {
    if (!Array.isArray(layers) || !layers.length) return layers || [];
    const options = state.randomOptions || {};
    if (options.bySpiralLayers === false) {
      if (options.bySpiralOrder === true)
        for (const layer of layers) {
          if (!layer || layer.chaosStar === true) continue;
          layer.spiralOrder = randomInt(
            Math.min(Number(options.spiralOrderMin ?? -1), Number(options.spiralOrderMax ?? 1)),
            Math.max(Number(options.spiralOrderMin ?? -1), Number(options.spiralOrderMax ?? 1)),
          );
          layer.spiralEnabled = Math.abs(layer.spiralOrder) > 1e-8;
        }
      return layers;
    }
    let lo = Math.max(0, Math.min(layers.length, Math.round(Number(options.spiralLayersMin) || 0)));
    let hi = Math.max(0, Math.min(layers.length, Math.round(Number(options.spiralLayersMax ?? 1) || 0)));
    if (lo > hi) [lo, hi] = [hi, lo];
    const count = randomInt(lo, hi);
    const selected = new Set(shuffle(layers.map((_, i) => i)).slice(0, count));
    layers.forEach((layer, idx) => {
      const spiral = selected.has(idx);
      layer.spiralOrder = spiral
        ? options.bySpiralOrder === true
          ? randomInt(
              Math.min(Number(options.spiralOrderMin ?? -1), Number(options.spiralOrderMax ?? 1)),
              Math.max(Number(options.spiralOrderMin ?? -1), Number(options.spiralOrderMax ?? 1)),
            )
          : 1
        : 0;
      layer.spiralEnabled = spiral && Math.abs(layer.spiralOrder) > 1e-8;
      layer.spiralTangential =
        spiral &&
        Math.random() * 100 < Math.max(0, Math.min(100, Number(options.spiralTangentialChance ?? 50)));
      layer.spiralStepLinked = true;
      layer.spiralStep = normalizeSpiralStep(layer.K || 1, layer);
      layer.spiralClosed = true;
      if (spiral) {
        layer.closedLoop = false;
        layer.fill = false;
        layer.fillColor = '#00000000';
      }
    });
    return layers;
  };

  const createRandomComposition = (
    requestedCount = state.randomLayerCount || 3,
    profileGroups = normalizedOrangeMorphProfileGroups(),
    family = normalizeOrangeMorphFamily(),
  ) => {
    let best = null;
    const normalizedGroups =
      Array.isArray(profileGroups) && profileGroups.length
        ? profileGroups.map(normalizeOrangeMorphProfileGroup)
        : ['standard'];
    const normalizedFamily = normalizeOrangeMorphFamily(family);
    const paletteKeyForLayers = normalizePlaylistPaletteKey(
      state.randomOptions?.lineColorPalette,
      'standard',
    );
    const count = Math.max(1, Math.min(8, Number(requestedCount) || 3));
    const attempts = count <= 3 ? 16 : 20;
    for (let i = 0; i < attempts; i++) {
      const candidate = makeRandomCandidate(count, normalizedGroups, normalizedFamily);
      if (!best || candidate.score > best.score) best = candidate;
    }
    const layers = (best?.layerSpecs || []).map((spec) => {
      const layer = createRandomLayer(spec);
      layer.paletteKey = paletteKeyForLayers;
      if (spec.forceSimpleK) layer.K = 1;
      return layer;
    });
    return applyRandomSpiralLayers(layers);
  };

  const createMandalaComposition = (
    requestedCount = state.randomLayerCount || 3,
    family = normalizeOrangeMorphFamily(),
  ) => {
    const count = Math.max(1, Math.min(8, Number(requestedCount) || 3)),
      options = state.randomOptions || {};
    const paletteKey = normalizePlaylistPaletteKey(options.lineColorPalette, 'standard'),
      colors = randomDistinctPaletteColors(paletteKey, Math.max(3, count));
    const symmetryPool = [8, 10, 12, 14, 16, 18, 20, 24],
      N = randomChoice(symmetryPool),
      sector = 360 / Math.max(1, N),
      baseRotation = Math.round(randomInt(0, 359) / sector) * sector;
    const outerR = randomInt(230, 270),
      ratios = [1, 0.82, 0.66, 0.52, 0.4, 0.3, 0.22, 0.16],
      fam = normalizeOrangeMorphFamily(family),
      mandalaAll = PROFILE_PRESET_GROUPS.mandala?.length
        ? PROFILE_PRESET_GROUPS.mandala
        : ['arc', 'sine', 'triangle', 'double_peak', 'loop', 'line'],
      profileCycle =
        fam === 'mix' ? mandalaAll : mandalaAll.filter((key) => PROFILE_PRESET_META[key]?.family === fam);
    if (!profileCycle.length) profileCycle.push(...mandalaAll);
    const layers = [];
    for (let idx = 0; idx < count; idx++) {
      const role = idx === 0 ? 'outer' : idx === count - 1 ? 'inner' : 'middle',
        profileKey =
          options.onlyLine || options.byShape === false ? 'line' : profileCycle[idx % profileCycle.length];
      const kModes = ['simple', 'petal', 'harmonic', 'star'],
        kMode = options.bySteps === false ? 'simple' : kModes[idx % kModes.length];
      const radius =
        options.bySize === false
          ? outerR
          : Math.max(24, Math.round(outerR * (ratios[idx] ?? Math.max(0.1, 1 - idx * 0.12))));
      const rounding =
        options.byRounding === false
          ? 0
          : idx === 0
            ? randomChoice([4, 8, 12])
            : randomChoice([8, 12, 16, 20]);
      const layer = createRandomLayer({
        name: `Мандала ${idx + 1}`,
        N,
        radius,
        color: options.byColor === false ? colors[0] : colors[idx],
        profileKey,
        rotation: baseRotation + (idx % 2 ? sector * 0.5 : 0),
        strokeWidth: idx === 0 ? 1.8 : Math.max(1, 1.6 - idx * 0.08),
        glow: idx === 0 ? 6 : Math.max(3, 7 - idx * 0.45),
        opacity: Math.max(72, 98 - idx * 3),
        fill: false,
        rounding,
        kMode,
      });
      layer.paletteKey = paletteKey;
      if (options.bySteps === false) layer.K = 1;
      // The shared N and half-sector alternation keep radial axes coherent while K/profile vary.
      layers.push(layer);
    }
    return applyRandomSpiralLayers(layers);
  };

  const applyOrangeRandomPaletteColors = (layers) => {
    if (!Array.isArray(layers) || !layers.length) return layers || [];
    const options = state.randomOptions || {};
    if (!hasOrangeColorRoute()) return layers;
    const paletteKey = normalizePlaylistPaletteKey(options.lineColorPalette, 'standard');
    const colors = randomDistinctPaletteColors(paletteKey, Math.max(3, layers.length));
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i];
      if (!layer) continue;
      const next = colors[i % colors.length] || layer.strokeColor || '#ffffff';
      const prior = layer.strokeColor;
      layer.strokeColor = next;
      layer.paletteKey = paletteKey;
      if (layer.fillMatchStroke === true) {
        const alpha = getFillOpacityPercent(layer.fillColor || prior || next);
        layer.fillColor = colorWithPercentAlpha(next, alpha);
      }
    }
    return layers;
  };

  function orangeSampleBindingValue(def, binding) {
    if (!def || !binding) return undefined;
    if (def.type === 'enum') {
      const values = Array.isArray(def.values) ? def.values : [];
      return values.length ? values[Math.floor(Math.random() * values.length)] : undefined;
    }
    // Outline colour is a routed hue-offset in degrees; other
    // palette colours retain their existing independent generator.
    if (def.type === 'color' && def.id !== 'outline.color') return undefined;
    let lo = Number(binding.min),
      hi = Number(binding.max);
    if (!Number.isFinite(lo)) lo = Number(def.min);
    if (!Number.isFinite(hi)) hi = Number(def.max);
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return undefined;
    if (lo > hi) [lo, hi] = [hi, lo];
    let v = lo + Math.random() * (hi - lo);
    const stepInfo = window.SomataParameterMatrix?.stepFor?.(def);
    if (def.type === 'integer') v = Math.round(v);
    else if (stepInfo?.mode === 'linear' && stepInfo.step >= 1) {
      // Percentage controls generate whole percentage points as well
      // as stepping by one in the three shared editors.
      v = Math.max(lo, Math.min(hi, Math.round(v / stepInfo.step) * stepInfo.step));
    }
    return v;
  }
  function orangeLayerParameterValue(layer, def) {
    if (!layer || !def) return undefined;
    if (def.id === 'layer.fillOpacity') return getFillOpacityPercent(layer.fillColor);
    return window.SomataParameterRegistry?.valueAt?.(layer, def.morph?.framePath);
  }
  function setOrangeLayerParameterValue(layer, def, value) {
    if (!layer || !def) return false;
    if (def.id === 'layer.fillOpacity') {
      if (!Number.isFinite(Number(value))) return false;
      layer.fillOpacity = Math.max(0, Math.min(100, Number(value)));
      layer.fillColor = colorWithPercentAlpha(
        layer.fillColor || layer.strokeColor || '#ffffff',
        layer.fillOpacity,
      );
      return true;
    }
    if (def.id === 'geometry.N') value = Math.max(2, Math.round(Number(value) || 2));
    else if (def.id === 'geometry.K') value = Math.max(0, Math.round(Number(value) || 0));
    const path = def.morph?.framePath;
    if (!path) return false;
    window.SomataParameterRegistry?.applyPath?.(layer, path, cloneEffectConfig(value));
    return true;
  }

  function applyOrangeGlobalTargets(targets) {
    if (!targets || typeof targets !== 'object') return false;
    let changed = false;
    for (const [id, raw] of Object.entries(targets)) {
      const value = Number(raw);
      if (!Number.isFinite(value)) continue;
      if (id === 'outline.layerCount') {
        state.lineOutline.layerCount = Math.max(0, Math.min((state.layers || []).length, Math.round(value)));
        changed = true;
      } else if (id === 'outline.width') {
        state.lineOutline.width = Math.max(0.5, Math.min(12, value));
        changed = true;
      } else if (id === 'outline.mode') {
        state.lineOutline.mode = ['outer', 'inner', 'median'][Math.max(0, Math.min(2, Math.round(value)))];
        changed = true;
      } else if (id === 'outline.color') {
        state.lineOutline.color = window.SomataParameterRegistry.shiftHexHue(
          state.lineOutline.color || '#ffffff',
          value,
        );
        changed = true;
      } else if (id === 'lamps.freezeTailSec' || id === 'lamps.freezeIntensity') {
        const field = id === 'lamps.freezeTailSec' ? 'freezeTailSec' : 'freezeIntensity';
        const next =
          field === 'freezeTailSec'
            ? Math.max(0.05, Math.min(30, value))
            : Math.max(0, Math.min(100, Math.round(value)));
        state.lamps[field] = next;
        for (const layer of state.layers || []) if (layer?.lamps) layer.lamps[field] = next;
        changed = true;
      } else if (id === 'tunnel.speed') {
        state.tunnel.speedStrength = Math.max(-1, Math.min(1, value / 100));
        changed = true;
      } else if (id === 'tunnel.spacing') {
        state.tunnel.spacingStrength = Math.max(0.2, Math.min(20, value / 100));
        changed = true;
      } else if (id === 'tunnel.depthCurve') {
        state.tunnel.depthCurve = Math.max(-100, Math.min(100, value));
        changed = true;
      } else if (id === 'tunnel.depthCurveMultiplier') {
        state.tunnel.depthCurveMultiplier = Math.max(0, Math.min(10, value));
        changed = true;
      } else if (id === 'tunnel.colorShift') {
        state.tunnel.colorShiftDegrees = Math.max(0, Math.min(360, value));
        changed = true;
      } else if (id === 'tunnel.vignette') {
        state.tunnel.vignetteAmount = Math.max(0, Math.min(1200, value));
        changed = true;
      } else if (id === 'tunnel.vignetteMultiplier') {
        state.tunnel.vignetteMultiplier = Math.max(0.125, value);
        changed = true;
      } else if (id.startsWith('ambient.') || id.startsWith('prism.')) {
        const def = window.SomataParameterRegistry?.get(id),
          path = def?.morph?.framePath;
        if (path) {
          window.SomataParameterRegistry.applyPath(
            state,
            path,
            Math.max(
              Number(def.min),
              Math.min(Number(def.max), def.type === 'integer' ? Math.round(value) : value),
            ),
          );
          changed = true;
        }
      } else if (id === 'palette.hueOffset') {
        state.playlistPaletteHueOffset = normalizePlaylistHueOffset(value);
        changed = true;
      }
    }
    if (changed) {
      syncPlaylistPaletteHueOffsetUI?.();
      syncTunnelSettingsUI?.();
      syncWebOutlineUI?.();
      syncLampSettingsUI?.();
      window.SomataAmbientPrism?.syncUI?.();
    }
    return changed;
  }
  window.__somataApplyOrangeGlobalTargets = applyOrangeGlobalTargets;
  function applyOrangeRoutingBindingsToComposition(layers, sourceLayers = state.layers) {
    if (!Array.isArray(layers) || !layers.length) return layers || [];
    const defs = window.SomataParameterRegistry?.sharedRoutingDefinitions?.() || [];
    const active = new Map(
      getOrangeMorphBindings()
        .filter((b) => b?.enabled !== false)
        .map((b) => [b.parameter, b]),
    );
    const layerIds = layers.map((l, i) => i),
      coverage = new Map(),
      allLayers = new Set(layerIds);
    for (const [id, b] of active)
      coverage.set(
        id,
        window.SomataParameterCoverage.full(b)
          ? allLayers
          : window.SomataParameterCoverage.select(b, layerIds),
      );
    const curated = String(state.minimalMorph?.generatorStyle || 'standard') !== 'standard';
    const sources = Array.isArray(sourceLayers) && sourceLayers.length ? sourceLayers : [];
    const specialCoverage = new Map();
    for (const id of [
      'geometry.shape',
      'geometry.orbits',
      'geometry.chaos',
      'spiral.layers',
      'spiral.order',
    ]) {
      const percent = morphSpecialLayerCoverage(state.randomOptions, id);
      specialCoverage.set(
        id,
        percent === 100
          ? allLayers
          : window.SomataParameterCoverage.select({ layerPercent: percent }, layerIds),
      );
    }
    Object.defineProperty(layers, '__somataCoverage', {
      value: { coverage, specialCoverage },
      configurable: true,
    });
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i],
        src = sources[i % sources.length] || sources[0] || null;
      if (!layer) continue;
      ensureLayerEffectState(layer);
      if (src) ensureLayerEffectState(src);
      for (const def of defs) {
        if (def?.morph?.frameTarget === 'global' || !def?.morph?.framePath) continue;
        const b = active.get(def.id);
        if (b && coverage.get(def.id)?.has(i)) {
          if (def.type === 'color') continue;
          const v = orangeSampleBindingValue(def, b);
          if (v !== undefined) {
            setOrangeLayerParameterValue(layer, def, v);
            // Preserve the actual sampled value, not just the route flag:
            // the later Effect-inheritance pass may replace lamps/web/sweep
            // object graphs with the preceding generation's objects.
            const path = def.morph?.framePath || '';
            if (/^(lamps|web|sweep|lineMotionFx|sprite|particles)\./.test(path) || /^graffiti/.test(path)) {
              let sampled = layer.__somataOrangeSampledEffects;
              if (!sampled) {
                sampled = [];
                Object.defineProperty(layer, '__somataOrangeSampledEffects', {
                  value: sampled,
                  configurable: true,
                });
              }
              sampled.push([path, cloneEffectConfig(v)]);
            }
          }
        } else if (src && (!curated || b)) {
          const prior = orangeLayerParameterValue(src, def);
          if (prior !== undefined) setOrangeLayerParameterValue(layer, def, prior);
        }
      }
      if (Number.isFinite(Number(layer.N)) && Number.isFinite(Number(layer.K)))
        layer.K = Math.max(0, Math.min(Math.max(1, Math.round(layer.N) - 1), Math.round(layer.K)));
    }
    const globals = {};
    for (const def of defs) {
      if (def?.morph?.frameTarget !== 'global') continue;
      const b = active.get(def.id);
      if (!b) continue;
      const v = orangeSampleBindingValue(def, b);
      if (Number.isFinite(Number(v))) globals[def.id] = Number(v);
    }
    try {
      Object.defineProperty(layers, '__somataOrangeGlobalTargets', {
        value: globals,
        writable: true,
        configurable: true,
        enumerable: false,
      });
    } catch (_) {
      layers.__somataOrangeGlobalTargets = globals;
    }
    return layers;
  }

  const ORANGE_STATIC_STYLE_RECIPES = Object.freeze({
    solarRosette: Object.freeze({
      profiles: ['md_lotus', 'md_petal', 'md_double_lotus', 'md_wave', 'md_drop'],
      n: [12, 16, 18, 20, 24],
      ratios: [1, 0.82, 0.65, 0.49, 0.34, 0.23],
      rounding: [8, 12, 16, 20],
      stroke: [1.7, 1.5, 1.3, 1.1, 0.95],
      glow: [12, 10, 8, 7, 6],
      fillPattern: [false, false, false, false, false],
      rotationMode: 'halfSector',
      lampMode: 'innerOuter',
    }),
    stainedGlass: Object.freeze({
      profiles: ['cl_halo', 'cl_petal', 'cl_diamond', 'cl_frame', 'cl_softwave', 'cl_crown'],
      n: [6, 8, 10, 12, 14],
      ratios: [1, 0.78, 0.58, 0.4, 0.26],
      rounding: [6, 10, 14, 18, 22],
      stroke: [2.2, 1.8, 1.5, 1.25, 1.05],
      glow: [5, 4, 3, 3, 2],
      fillPattern: [true, true, true, true, true],
      fillOpacity: [15, 22, 28, 24, 18],
      rotationMode: 'offset',
    }),
    lace: Object.freeze({
      profiles: ['lp_ribbon', 'lp_doublepetal', 'lp_eight', 'lp_curl', 'cl_doublepetal', 'md_knot'],
      n: [14, 16, 18, 20, 24],
      ratios: [1, 0.83, 0.68, 0.53, 0.39, 0.28],
      rounding: [12, 16, 20, 24, 28],
      stroke: [1.15, 1, 0.9, 0.8, 0.7, 0.65],
      glow: [7, 6, 5, 4, 4, 3],
      fillPattern: [false, false, false, false, false, false],
      rotationMode: 'lace',
      webMode: 'lace',
    }),
    crystalCathedral: Object.freeze({
      profiles: ['md_diamond', 'cl_diamond', 'md_crown', 'cl_triknot', 'triangle', 'cl_crown'],
      n: [8, 10, 12, 14, 16, 18],
      ratios: [1, 0.8, 0.61, 0.43, 0.28],
      rounding: [0],
      stroke: [2.4, 1.8, 1.45, 1.15, 0.95],
      glow: [14, 10, 8, 6, 5],
      fillPattern: [false, false, true, false, false],
      fillOpacity: [0, 0, 12, 0, 0],
      rotationMode: 'facet',
      lampMode: 'corners',
    }),
    spiralHerbarium: Object.freeze({
      profiles: ['md_petal', 'lp_teardrop', 'md_lotus', 'lp_ribbon', 'cl_petal', 'md_drop'],
      n: [7, 9, 11, 13, 15, 18],
      ratios: [1, 0.81, 0.64, 0.49, 0.35, 0.24],
      rounding: [14, 18, 22, 28, 34],
      stroke: [1.7, 1.45, 1.2, 1, 0.85, 0.75],
      glow: [9, 8, 7, 6, 5, 4],
      fillPattern: [false, true, false, true, false, true],
      fillOpacity: [0, 11, 0, 9, 0, 7],
      rotationMode: 'botanical',
      spiralMode: 'alternating',
    }),
  });
  const orangeStaticAlphaHex = (pct) =>
    Math.round(Math.max(0, Math.min(100, Number(pct) || 0)) * 2.55)
      .toString(16)
      .padStart(2, '0');
  const forceStaticOrangeLayer = (layer) => {
    if (!layer) return layer;
    if (layer.motionRotation) layer.motionRotation.enabled = false;
    if (layer.lineMotionFx) {
      layer.lineMotionFx.enabled = false;
      layer.lineMotionFx.speedPercent = 0;
    }
    if (layer.sprite) {
      layer.sprite.enabled = false;
      layer.sprite.speedPercent = 0;
    }
    if (layer.particles) {
      layer.particles.enabled = false;
      layer.particles.speedPercent = 0;
    }
    if (layer.sweep) {
      layer.sweep.enabled = false;
      layer.sweep.glintEnabled = false;
      layer.sweep.lightningEnabled = false;
    }
    if (layer.web) layer.web.oscillating = false;
    if (layer.lamps) {
      layer.lamps.freezeLight = false;
      layer.lamps.freezeRain = false;
      layer.lamps.adaptiveBrightness = true;
      layer.lamps.adaptiveAdjustBrightness = true;
      layer.lamps.adaptiveStrength = Math.max(80, Number(layer.lamps.adaptiveStrength) || 100);
    }
    return layer;
  };
  const createCuratedStaticOrangeComposition = (style, requestedCount = state.randomLayerCount || 3) => {
    const recipe = ORANGE_STATIC_STYLE_RECIPES[style];
    if (!recipe) return null;
    const options = state.randomOptions || {},
      count = Math.max(1, Math.min(8, Number(requestedCount) || 3));
    const paletteKey = normalizePlaylistPaletteKey(options.lineColorPalette, 'standard');
    const colors = randomDistinctPaletteColors(paletteKey, Math.max(3, count));
    const outerR = randomInt(style === 'stainedGlass' ? 235 : 245, style === 'solarRosette' ? 280 : 270);
    const sharedN = randomChoice(recipe.n),
      baseN = options.byVertices ? null : sharedN;
    const spiralLo = Math.max(0, Math.min(count, Number(options.spiralLayersMin) || 1)),
      spiralHi = Math.max(spiralLo, Math.min(count, Number(options.spiralLayersMax) || 2));
    const staticSpiralCount =
      recipe.spiralMode === 'alternating' && options.bySpiralLayers !== false
        ? randomInt(spiralLo, spiralHi)
        : 0;
    const layers = [];
    for (let idx = 0; idx < count; idx++) {
      const N =
        baseN ||
        randomChoice(
          recipe.n.filter((n) => idx === 0 || !layers.some((l) => l.N === n)).length
            ? recipe.n.filter((n) => idx === 0 || !layers.some((l) => l.N === n))
            : recipe.n,
        );
      const ratio = options.bySize === false ? 1 : (recipe.ratios[idx] ?? Math.max(0.16, 1 - idx * 0.14));
      const radius = Math.max(24, Math.round(outerR * ratio));
      const profileKey =
        options.onlyLine || options.byShape === false
          ? 'line'
          : recipe.profiles[idx % recipe.profiles.length];
      const sector = 360 / Math.max(1, N);
      let rotation = randomInt(0, 359);
      if (recipe.rotationMode === 'halfSector')
        rotation = Math.round(rotation / sector) * sector + (idx % 2 ? sector * 0.5 : 0);
      else if (recipe.rotationMode === 'facet')
        rotation = Math.round(rotation / sector) * sector + idx * sector * 0.25;
      else if (recipe.rotationMode === 'lace')
        rotation = idx * sector * 0.45 + randomChoice([0, sector * 0.25, sector * 0.5]);
      else if (recipe.rotationMode === 'botanical') rotation = idx * 11 + randomInt(-5, 5);
      else rotation = idx * randomChoice([6, 9, 12, 15]) + randomInt(-4, 4);
      let kMode = 'simple';
      if (options.bySteps !== false) {
        if (style === 'crystalCathedral') kMode = idx % 2 ? 'harmonic' : 'star';
        else if (style === 'lace') kMode = idx % 3 === 0 ? 'star' : 'harmonic';
        else if (style === 'spiralHerbarium') kMode = idx % 2 ? 'petal' : 'harmonic';
        else if (style === 'solarRosette') kMode = idx === 0 ? 'simple' : idx % 2 ? 'petal' : 'harmonic';
        else kMode = idx % 2 ? 'petal' : 'simple';
      }
      const rounding = options.byRounding === false ? 0 : randomChoice(recipe.rounding);
      const color = options.byColor === false ? colors[0] : colors[idx % colors.length];
      const fill = recipe.fillPattern[idx % recipe.fillPattern.length] === true;
      const layer = createRandomLayer({
        name: `${style === 'solarRosette' ? 'Розетка' : style === 'stainedGlass' ? 'Витраж' : style === 'lace' ? 'Кружево' : style === 'crystalCathedral' ? 'Кристалл' : 'Гербарий'} ${idx + 1}`,
        N,
        radius,
        color,
        profileKey,
        rotation,
        strokeWidth: recipe.stroke[idx % recipe.stroke.length],
        glow: recipe.glow[idx % recipe.glow.length],
        opacity: Math.max(68, 100 - idx * 4),
        fill,
        rounding,
        kMode,
      });
      layer.paletteKey = paletteKey;
      layer.fillMatchStroke = true;
      if (fill) {
        const pct = recipe.fillOpacity?.[idx % recipe.fillOpacity.length] ?? 12;
        layer.fillColor = `${String(color).slice(0, 7)}${orangeStaticAlphaHex(pct)}`;
      } else layer.fillColor = '#00000000';
      if (options.bySteps === false) layer.K = 1;
      layer.showWeb = false;
      layer.showLamps = false;
      if (recipe.webMode === 'lace' && (idx === 1 || idx === Math.max(1, count - 2))) {
        layer.showWeb = true;
        layer.web = {
          ...layer.web,
          style: 'web',
          inside: true,
          outsideStraight: false,
          outsideArc: false,
          placementMode: 'corners',
          oscillating: false,
          matchLineColor: true,
          color,
          secondaryColor: colors[(idx + 1) % colors.length] || color,
          width: 0.32,
          distance: randomChoice([34, 42, 50]),
          spacing: randomChoice([7, 8, 9]),
          angleVariation: 3,
          depthMultiplier: 1,
        };
      }
      if (
        recipe.lampMode &&
        ((recipe.lampMode === 'innerOuter' && (idx === 0 || idx === count - 1)) ||
          (recipe.lampMode === 'corners' && (idx === 0 || idx === Math.min(2, count - 1))))
      ) {
        layer.showLamps = true;
        layer.lamps = {
          ...layer.lamps,
          positionMode: 'corners',
          colorMode: 'line',
          matchLineColor: true,
          rainbow: false,
          brightness: style === 'crystalCathedral' ? 115 : 82,
          radius: style === 'crystalCathedral' ? 18 : 24,
          radiusMultiplier: 1,
          softness: style === 'crystalCathedral' ? 48 : 78,
          softnessMultiplier: 1,
          density: 100,
          densityMultiplier: 1,
          scatter: 0,
          sizeVariation: 0,
          freezeLight: false,
          freezeRain: false,
          adaptiveBrightness: true,
          adaptiveAdjustBrightness: true,
          adaptiveStrength: 100,
        };
      }
      if (recipe.spiralMode === 'alternating') {
        // Stable pattern rather than a time animation: selected layers are authored as Spiral geometry.
        const spiral = staticSpiralCount > 0 && idx > 0 && idx <= staticSpiralCount;
        layer.spiralOrder = spiral
          ? options.bySpiralOrder === true
            ? randomInt(
                Math.min(Number(options.spiralOrderMin ?? -1), Number(options.spiralOrderMax ?? 1)),
                Math.max(Number(options.spiralOrderMin ?? -1), Number(options.spiralOrderMax ?? 1)),
              )
            : 1
          : 0;
        layer.spiralEnabled = spiral && Math.abs(layer.spiralOrder) > 1e-8;
        layer.spiralTangential =
          spiral &&
          Math.random() * 100 < Math.max(0, Math.min(100, Number(options.spiralTangentialChance ?? 50)));
        layer.spiralStepLinked = true;
        layer.spiralStep = normalizeSpiralStep(layer.K || 1, layer);
        layer.spiralClosed = true;
        if (spiral) {
          layer.closedLoop = false;
          layer.fill = false;
          layer.fillColor = '#00000000';
        }
      }
      forceStaticOrangeLayer(layer);
      layers.push(layer);
    }
    return layers;
  };

  // Orange settings apply identically to Standard, Mandala and all curated types.
  // Keep N/K separate: an orbit is NOT a vertex. Zero means no orbit override.
  const applyOrangeOrbitAndFillSettings = (layers) => {
    if (!Array.isArray(layers) || !layers.length) return layers;
    const ro = orangeFillOptions();
    for (const layer of layers) {
      if (!layer || layer.chaosStar === true) continue;
      const n = Math.max(2, Math.round(Number(layer.N) || 2)),
        k = Math.max(0, Math.round(Number(layer.K) || 0));
      const maxOrbits = Math.max(1, gcd(n, k));
      if (ro.orbitBindingEnabled === true) {
        const pct = randomInt(ro.orbitPercentMin, ro.orbitPercentMax);
        const selected = Math.max(1, Math.min(maxOrbits, Math.ceil((maxOrbits * pct) / 100)));
        layer.customSuborbits = selected < maxOrbits ? selected : null;
      }
    }
    // Only the active Fill-colour route owns these randomised Fill targets;
    // absent/disabled bindings leave curated composition's authored Fill unchanged.
    const fillRoute = getOrangeMorphBindings().some(
      (b) => b.parameter === 'layer.fillColor' && b.enabled !== false,
    );
    if (!fillRoute) return layers;
    const candidates = shuffle(
      layers
        .map((layer, i) => ({ layer, i }))
        .filter(
          (x) =>
            x.layer &&
            x.layer.closedLoop !== false &&
            !(x.layer.spiralEnabled === true && !x.layer.spiralFillEnabled),
        ),
    ).sort((a, b) => (b.layer.fill === true ? 1 : 0) - (a.layer.fill === true ? 1 : 0));
    const min = Math.min(candidates.length, ro.fillLayersMin),
      max = Math.min(candidates.length, ro.fillLayersMax);
    const count = randomInt(min, max);
    const selected = new Set(candidates.slice(0, count).map((x) => x.i));
    const offsets = getFillHarmonyOffsets(ro.fillHarmony);
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i];
      if (!layer) continue;
      if (!selected.has(i) || (layer.spiralEnabled === true && !layer.spiralFillEnabled)) {
        layer.fill = false;
        layer.fillColor = colorWithPercentAlpha(layer.fillColor || layer.strokeColor, 0);
        continue;
      }
      const base = colorBaseHex6(layer.strokeColor, '#ffffff');
      const shifted = shiftHueHex(base, randomChoice(offsets));
      const prev = getFillOpacityPercent(layer.fillColor, 0);
      const opacity = prev > 0 ? prev : DEFAULT_FILL_OPACITY_PERCENT;
      layer.fill = true;
      layer.fillMatchStroke = ro.fillHarmony === 'native';
      layer.fillColor = colorWithPercentAlpha(shifted, opacity);
    }
    return layers;
  };
  // V8.19.3: Orange is a parameter editor, not a scene reset.
  // Generation recipes are candidate values only. Commit ONLY parameters
  // explicitly enabled in the Orange matrix; everything else is cloned
  // from the currently authored slot, including effect trees and motion.
  const projectOrangeExplicitRoutes = (generated, sourceLayers) => {
    if (
      !Array.isArray(generated) ||
      !generated.length ||
      !Array.isArray(sourceLayers) ||
      !sourceLayers.length
    )
      return generated;
    const routes = getOrangeMorphBindings().filter((b) => b?.enabled !== false);
    const coverage = generated.__somataCoverage;
    const specialKeys = {
      'geometry.shape': ['profileMode', 'profileNodes', 'profileKey', 'closedLoop'],
      'geometry.orbits': ['customSuborbits'],
      'geometry.chaos': ['chaosStar', 'chaosStepMinus', 'chaosStepPlus', 'chaosClosures', 'chaosSeed'],
      'spiral.layers': [
        'spiralEnabled',
        'spiralStep',
        'spiralStepLinked',
        'spiralClosed',
        'spiralTangential',
        'spiralRoundSeams',
        ...(state.randomOptions?.bySpiralOrder === true ? [] : ['spiralOrder']),
      ],
      'spiral.order': ['spiralOrder', 'spiralEnabled'],
    };
    const specialEnabled = (id) =>
      id === 'geometry.shape'
        ? state.randomOptions?.byShape === true
        : id === 'geometry.orbits'
          ? state.randomOptions?.orbitBindingEnabled === true
          : id === 'geometry.chaos'
            ? state.randomOptions?.chaosStar === true
            : id === 'spiral.layers'
              ? state.randomOptions?.bySpiralLayers === true
              : id === 'spiral.order'
                ? state.randomOptions?.bySpiralOrder === true
                : false;
    for (let i = 0; i < generated.length; i++) {
      const candidate = generated[i],
        src = sourceLayers[i] || sourceLayers[i % sourceLayers.length];
      if (!candidate || !src) continue;
      const target = cloneEffectConfig(src);
      // Keep a unique ID for each newly generated authored target; do not
      // generate a new name or replace unrelated properties.
      target.id = candidate.id;
      for (const b of routes) {
        if (coverage?.coverage?.get(b.parameter)?.has(i) === false) continue;
        const def = window.SomataParameterRegistry?.get?.(b.parameter);
        if (!def || def.morph?.frameTarget === 'global') continue;
        if (def.id === 'layer.strokeColor') {
          target.strokeColor = candidate.strokeColor;
          target.paletteKey = candidate.paletteKey;
        } else if (def.id === 'layer.fillColor') {
          // A colour route may set Fill on/off, but opacity is
          // controlled ONLY by its own independent route.
          const oldAlpha = getFillOpacityPercent(src.fillColor);
          target.fill = candidate.fill === true;
          target.fillMatchStroke = candidate.fillMatchStroke === true;
          target.fillColor = colorWithPercentAlpha(
            candidate.fillColor || candidate.strokeColor || src.fillColor,
            oldAlpha,
          );
        } else if (def.id === 'layer.fillOpacity') {
          // Applied after all colour routes, independently of row order.
          continue;
        } else {
          const path = def.morph?.framePath;
          if (!path) continue;
          const value = window.SomataParameterRegistry?.valueAt?.(candidate, path);
          if (value !== undefined)
            window.SomataParameterRegistry?.applyPath?.(target, path, cloneEffectConfig(value));
        }
      }
      const fillOpacityBinding = routes.find((b) => b.parameter === 'layer.fillOpacity');
      if (fillOpacityBinding && coverage?.coverage?.get('layer.fillOpacity')?.has(i) !== false) {
        const alpha = Number.isFinite(Number(candidate.fillOpacity))
          ? Number(candidate.fillOpacity)
          : getFillOpacityPercent(candidate.fillColor);
        target.fillOpacity = alpha;
        target.fillColor = colorWithPercentAlpha(
          target.fillColor || src.fillColor || target.strokeColor,
          alpha,
        );
      }
      for (const [id, keys] of Object.entries(specialKeys)) {
        if (!specialEnabled(id) || coverage?.specialCoverage?.get(id)?.has(i) === false) continue;
        for (const key of keys) {
          if (Object.prototype.hasOwnProperty.call(candidate, key))
            target[key] = cloneEffectConfig(candidate[key]);
        }
        if (
          id === 'spiral.layers' &&
          (candidate.spiralEnabled === true || Number(candidate.spiralOrder) > 0)
        ) {
          target.closedLoop = false;
          target.fill = false;
          target.fillColor = colorWithPercentAlpha(target.fillColor || target.strokeColor, 0);
        }
      }
      // Do not normalize any unselected geometry settings here.
      generated[i] = target;
    }
    Object.defineProperty(generated, '__somataOrangeExplicitRoutes', { value: true, configurable: true });
    return generated;
  };

  const createOrangeComposition = (
    requestedCount = state.randomLayerCount || 3,
    _legacyMode = state.minimalMorph?.mode,
  ) => {
    const style = String(state.minimalMorph?.generatorStyle || 'standard');
    const curated = createCuratedStaticOrangeComposition(style, requestedCount);
    const groups = normalizedOrangeMorphProfileGroups();
    const family = normalizeOrangeMorphFamily(state.minimalMorph?.family);
    const mandalaOnly = groups.length === 1 && groups[0] === 'mandala';
    const layers =
      curated ||
      (mandalaOnly
        ? createMandalaComposition(requestedCount, family)
        : createRandomComposition(requestedCount, groups, family));
    // One shared final colour pass for both the dice and Orange Morph.
    // Every target composition is authored/static; Orange only replaces or fades between states.
    const colored = applyOrangeRandomPaletteColors(layers);
    // Order is an independent special route. When Layer-count
    // generation is disabled, sample Order on each eligible slot,
    // including polygons, so an explicit order can wind them.
    if (state.randomOptions?.bySpiralOrder === true && state.randomOptions?.bySpiralLayers !== true) {
      const ro = state.randomOptions;
      for (const target of colored) {
        if (!target || target.chaosStar === true) continue;
        const lo = Math.max(-20, Math.min(20, Number(ro.spiralOrderMin ?? -1)));
        const hi = Math.max(lo, Math.min(20, Number(ro.spiralOrderMax ?? 1)));
        target.spiralOrder = randomInt(lo, hi);
        target.spiralEnabled = Math.abs(target.spiralOrder) > 1e-8;
      }
    }
    applyOrangeRoutingBindingsToComposition(colored, state.layers);
    applyOrangeOrbitAndFillSettings(colored);
    if (state.randomOptions?.chaosStar === true) {
      const layer = colored.find(
        (l) => l && l.spiralEnabled !== true && Math.round(Number(l.spiralOrder) || 0) === 0,
      );
      if (layer) {
        layer.chaosStar = true;
        layer.customSuborbits = null;
        layer.closedLoop = true;
        layer.chaosStepMinus = randomInt(
          0,
          Math.max(0, Math.min(120, Number(state.randomOptions.chaosStepSpread ?? 1) || 0)),
        );
        layer.chaosStepPlus = randomInt(
          0,
          Math.max(0, Math.min(120, Number(state.randomOptions.chaosStepSpread ?? 1) || 0)),
        );
        layer.chaosClosures = Math.max(
          1,
          Math.min(
            Math.round(Number(layer.N) || 4),
            Math.round(Number(state.randomOptions.chaosClosuresMax ?? 3) || 1),
          ),
        );
        layer.chaosSeed = (Math.random() * 0xffffffff) >>> 0;
      }
    }
    // Final mask, *after* palette / orbits / fill / chaos generators.
    const info = colored.__somataCoverage,
      sources = state.layers || [];
    const hasPartialCoverage =
      getOrangeMorphBindings().some((b) => b?.enabled !== false && !window.SomataParameterCoverage.full(b)) ||
      ['geometry.shape', 'geometry.orbits', 'geometry.chaos', 'spiral.layers', 'spiral.order'].some(
        (id) => morphSpecialLayerCoverage(state.randomOptions, id) < 100,
      );
    if (info && hasPartialCoverage) {
      const fields = {
        'geometry.shape': ['profileMode', 'profileNodes', 'profileKey', 'closedLoop'],
        'geometry.orbits': ['customSuborbits'],
        'geometry.chaos': ['chaosStar', 'chaosStepMinus', 'chaosStepPlus', 'chaosClosures', 'chaosSeed'],
        'spiral.layers': [
          'spiralEnabled',
          'spiralStep',
          'spiralStepLinked',
          'spiralClosed',
          'spiralTangential',
          'spiralRoundSeams',
          ...(state.randomOptions?.bySpiralOrder === true ? [] : ['spiralOrder']),
        ],
        'spiral.order': ['spiralOrder', 'spiralEnabled'],
      };
      const active = getOrangeMorphBindings().filter((b) => b?.enabled !== false);
      for (let i = 0; i < colored.length; i++) {
        const target = colored[i],
          src = sources[i % sources.length] || sources[0];
        if (!target || !src) continue;
        for (const binding of active) {
          if (info.coverage.get(binding.parameter)?.has(i)) continue;
          const def = window.SomataParameterRegistry?.get?.(binding.parameter);
          if (!def || def.morph?.frameTarget === 'global') continue;
          if (def.id === 'layer.fillColor') {
            for (const key of ['fill', 'fillColor', 'fillMatchStroke', 'fillOpacity'])
              if (src[key] !== undefined) target[key] = cloneEffectConfig(src[key]);
          } else if (def.id === 'layer.strokeColor') {
            target.strokeColor = src.strokeColor;
            target.paletteKey = src.paletteKey;
          } else {
            const prior = orangeLayerParameterValue(src, def);
            if (prior !== undefined) setOrangeLayerParameterValue(target, def, prior);
          }
        }
        for (const [id, keys] of Object.entries(fields)) {
          if (info.specialCoverage.get(id)?.has(i)) continue;
          for (const key of keys) if (src[key] !== undefined) target[key] = cloneEffectConfig(src[key]);
        }
      }
    }
    // Retain the non-enumerable global targets and avoid a throwaway array.
    // Curated recipe effects and forced static defaults are not permissions.
    // Apply the final explicit parameter mask AFTER every generator pass.
    return projectOrangeExplicitRoutes(colored, sources);
  };

  const MorphInterpolation = createMorphInterpolationModule();
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

  const MorphTargets = createMorphTargetsModule({
    randomInt,
    randomChoice,
    shuffle,
    MORPH_LINE_PALETTES,
    RANDOM_PALETTES,
    MorphInterpolation,
  });
  const {
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
    buildMorphVisualTargets,
    buildLightMorphVisualTargets,
  } = MorphTargets;

  const MorphPlayback = createMorphPlaybackModule({
    createOrangeComposition,
    MorphInterpolation,
    MorphTargets,
    MorphGeometry,
  });
  const {
    prepareMorphCycle,
    applyFillMorphFrame,
    commitLightMorphTransient,
    getMorphLongPeriodDetailScale,
    updateLightMorphKeyframe,
    rebaseMorphCycle,
    animateMorph,
    cloneMorphOriginLayers,
    captureMorphOrigin,
    restoreMorphOrigin,
    clearMorphOrigin,
    stopMorphing,
    syncMinimalMorphTimingFromUI,
    commitMinimalMorphTarget,
    beginMinimalMorphTransition,
    minimalMorphFrame,
    stopMinimalMorphing,
    startMinimalMorphing,
    toggleMinimalMorphing,
    startMorphing,
    pauseMorphPlayback,
    resumeMorphPlayback,
    toggleMorphPlaybackBySpace,
    toggleMorphing,
  } = MorphPlayback;

  const applyRandomComposition = () => {
    if (runtimeState.minimalMorph.active) {
      if (hasOrangeColorRoute() && state.randomOptions?.cyclePalettes === true)
        cyclePlaylistPaletteForContext('yellow');
      beginMinimalMorphTransition(performance.now(), true);
      return;
    }
    if (hasOrangeColorRoute() && state.randomOptions?.cyclePalettes === true)
      cyclePlaylistPaletteForContext('yellow');
    if (hasOrangeColorRoute() && morphPaletteSyncEnabled())
      setMorphPaletteForContext('yellow', state.randomOptions.lineColorPalette);
    // The dice replaces the authored composition, not either Morph owner.
    // Blue must rebase onto the new layer IDs after replacement rather than
    // being stopped (or continuing with stale per-layer morph targets).
    const blueWasActive = runtimeState.morph.active === true;
    state.randomLayerCount = Math.max(
      1,
      Math.min(
        8,
        parseInt(document.getElementById('randomLayerCount')?.value, 10) || state.randomLayerCount || 3,
      ),
    );
    if (document.getElementById('randomLayerCount'))
      document.getElementById('randomLayerCount').value = state.randomLayerCount;
    const generatedOrangeLayers = createOrangeComposition(state.randomLayerCount, state.minimalMorph?.mode);
    window.__somataApplyOrangeGlobalTargets?.(generatedOrangeLayers.__somataOrangeGlobalTargets);
    MorphPlayback.preserveOrangeAudioRoutes(state.layers, generatedOrangeLayers);
    MorphPlayback.preserveOrangeLayerVisibility(state.layers, generatedOrangeLayers);
    state.layers = generatedOrangeLayers;
    ensureAudioRoutingState(); // the dice must also initialize all new slots
    state.activeLayerId = state.layers[0].id;
    document.getElementById('presetSelect').value = '';
    if (blueWasActive) MorphPlayback.rebaseFullMorphAfterOrangeSwitch();
    updateLayerListUI();
    syncSidebarInputs();
    renderProfileEditor();
    renderMainCanvas();
  };

  document.getElementById('btnTunnel')?.addEventListener('click', toggleTunnelMode);

  document.getElementById('presetSelect').addEventListener('change', (e) => {
    applyMainPreset(e.target.value);
  });

  document.getElementById('btnPrevPreset').addEventListener('click', () => {
    let currentIdx = PRESET_KEYS.indexOf(document.getElementById('presetSelect').value);
    if (currentIdx === -1) currentIdx = 0;
    const key = PRESET_KEYS[(currentIdx - 1 + PRESET_KEYS.length) % PRESET_KEYS.length];
    applyMainPreset(key);
  });

  document.getElementById('btnNextPreset').addEventListener('click', () => {
    let currentIdx = PRESET_KEYS.indexOf(document.getElementById('presetSelect').value);
    if (currentIdx === -1) currentIdx = PRESET_KEYS.length - 1;
    const key = PRESET_KEYS[(currentIdx + 1) % PRESET_KEYS.length];
    applyMainPreset(key);
  });

  document.getElementById('btnRandomPreset').addEventListener('click', applyRandomComposition);
  document.getElementById('btnMinimalMorph')?.addEventListener('click', toggleMinimalMorphing);
  document.getElementById('randomLayerCount').addEventListener('change', (e) => {
    state.randomLayerCount = Math.max(1, Math.min(8, parseInt(e.target.value, 10) || 3));
    e.target.value = state.randomLayerCount;
  });
  document.getElementById('minimalMorphMode')?.addEventListener('change', (e) => {
    // Legacy hidden single-pool control: selecting it intentionally collapses Orange to one pool.
    const group = normalizeOrangeMorphProfileGroup(e.target.value);
    state.minimalMorph.profileGroups = [group];
    state.minimalMorph.mode = group;
    syncOrangeMorphModeOptions();
    if (runtimeState.minimalMorph.active && !runtimeState.minimalMorph.transitioning)
      runtimeState.minimalMorph.nextSwitchAt = performance.now();
  });
  document.getElementById('minimalMorphFamily')?.addEventListener('change', (e) => {
    state.minimalMorph.family = normalizeOrangeMorphFamily(e.target.value);
    e.target.value = state.minimalMorph.family;
    if (runtimeState.minimalMorph.active && !runtimeState.minimalMorph.transitioning)
      runtimeState.minimalMorph.nextSwitchAt = performance.now();
  });
  document.querySelectorAll('[data-orange-profile-group]').forEach((input) => {
    input.addEventListener('change', () => {
      let groups = [...document.querySelectorAll('[data-orange-profile-group]:checked')]
        .map((el) => el.dataset.orangeProfileGroup)
        .filter((group) => PROFILE_PRESET_GROUP_ORDER.includes(group));
      if (!groups.length) {
        input.checked = true;
        groups = [normalizeOrangeMorphProfileGroup(input.dataset.orangeProfileGroup)];
      }
      state.minimalMorph.profileGroups = [...new Set(groups)];
      state.minimalMorph.mode = state.minimalMorph.profileGroups[0];
      syncOrangeMorphModeOptions();
      if (runtimeState.minimalMorph.active && !runtimeState.minimalMorph.transitioning)
        runtimeState.minimalMorph.nextSwitchAt = performance.now();
    });
  });
  document.getElementById('minimalMorphDefaultActive')?.addEventListener('change', (e) => {
    state.minimalMorph.defaultActive = e.target.checked === true;
  });
  ['minimalMorphInterval', 'minimalMorphFade', 'minimalMorphInstant'].forEach((id) => {
    const el = document.getElementById(id);
    el?.addEventListener('change', () => {
      if (id === 'minimalMorphInterval') state.tapTempo.syncMinimalMorph = false;
      syncMinimalMorphTimingFromUI();
      syncTapTimingIndicators();
      if (runtimeState.minimalMorph.active && !runtimeState.minimalMorph.transitioning) {
        runtimeState.minimalMorph.nextSwitchAt = isTapMorphSyncActive('minimal')
          ? getNextTapBoundary(performance.now(), 'minimal')
          : performance.now() + getTapMorphIntervalSec(state.minimalMorph.intervalSec, 'minimal') * 1000;
      }
    });
  });
  // Селекторы типа спирали: при Fade/Слайдшоу тип общий (следует многоугольнику) — выбор закрыт.
  const syncSpiralModeSelects = () => {
    const shared = FRAME_LEVEL_MORPH_MODES.includes(getUnifiedMorphMode());
    for (const id of ['morphSpiralMode', 'morphSpiralModeTop']) {
      const el = document.getElementById(id);
      if (!el) continue;
      el.disabled = shared;
      el.value = shared ? '' : getSpiralMorphMode();
    }
    document.getElementById('morphSpiralModeRow')?.classList.toggle('morph-row-shared', shared);
  };
  window.__somataSyncSpiralModeSelects = syncSpiralModeSelects;
  const setSpiralMorphModeFromUI = (value, fromGeometry = false) => {
    const next = normalizeSpiralMorphMode(SomataMorphRuntime.modeOf(value), null);
    if (!next) return false;
    const changed = getSpiralMorphMode() !== next;
    setSpiralMorphMode(next);
    syncSpiralModeSelects();
    const legacy = document.getElementById('morphSpiralMorphType');
    if (legacy) legacy.value = state.morph.spiralMorphType;
    syncMorphModeDependentUI();
    if (!fromGeometry)
      window.SomataTestMorph?.syncFromBlue?.(getUnifiedMorphMode(), state.morph.slideType, next);
    if (changed) {
      if (runtimeState.morph.active) {
        runtimeState.morph.suppressPaletteCycleOnce = true;
        prepareMorphCycle(performance.now());
      }
      requestMainCanvasRender();
    }
    return true;
  };
  const setMorphModeFromUI = (value, fromGeometry = false) => {
    const next = SomataMorphRuntime.modeOf(value);
    // Experimental coordinated transport is selectable; unmatched
    // branches grow/shrink geometrically from an anchored point.
    // No cloned physical branches and no opacity crossfade.
    const changed = getUnifiedMorphMode() !== next;
    if (changed && runtimeState.morph.active && state.morph.mode === 'light') commitLightMorphTransient();
    setUnifiedMorphMode(next);
    for (const id of ['morphMode', 'morphModeTop']) {
      const el = document.getElementById(id);
      if (el) el.value = next;
    }
    syncSpiralModeSelects();
    const legacy = document.getElementById('morphSpiralMorphType');
    if (legacy) legacy.value = state.morph.spiralMorphType;
    syncMorphModeDependentUI();
    if (!fromGeometry)
      window.SomataTestMorph?.syncFromBlue?.(next, state.morph.slideType, getSpiralMorphMode());
    if (changed) {
      if (runtimeState.morph.active) {
        runtimeState.morph.suppressPaletteCycleOnce = true;
        prepareMorphCycle(performance.now());
      }
      requestMainCanvasRender();
    }
    return true;
  };
  // Geometry's local selector notifies Blue through a single guarded
  // bridge instead of faking DOM events (which could re-enter handlers).
  window.__somataSyncBlueFromGeometry = (mode, slide, spiralMode = null) => {
    setMorphModeFromUI(mode, true);
    if (spiralMode != null) setSpiralMorphModeFromUI(spiralMode, true);
    window.__somataSetBlueSlideFromUI?.(slide, true);
    return { mode: getUnifiedMorphMode(), spiralMode: getSpiralMorphMode(), slide: state.morph.slideType };
  };
  document.getElementById('morphMode')?.addEventListener('change', (e) => setMorphModeFromUI(e.target.value));
  document
    .getElementById('morphModeTop')
    ?.addEventListener('change', (e) => setMorphModeFromUI(e.target.value));
  for (const id of ['morphSpiralMode', 'morphSpiralModeTop'])
    document.getElementById(id)?.addEventListener('change', (e) => setSpiralMorphModeFromUI(e.target.value));
  const MORPH_MODE_KEYS = UNIFIED_MORPH_KEYS;
  document.getElementById('btnPrevMorphMode')?.addEventListener('click', () => {
    let i = MORPH_MODE_KEYS.indexOf(getUnifiedMorphMode());
    if (i < 0) i = 0;
    setMorphModeFromUI(MORPH_MODE_KEYS[(i - 1 + MORPH_MODE_KEYS.length) % MORPH_MODE_KEYS.length]);
  });
  document.getElementById('btnNextMorphMode')?.addEventListener('click', () => {
    let i = MORPH_MODE_KEYS.indexOf(getUnifiedMorphMode());
    if (i < 0) i = 0;
    setMorphModeFromUI(MORPH_MODE_KEYS[(i + 1) % MORPH_MODE_KEYS.length]);
  });

  document.getElementById('btnMorph').addEventListener('click', toggleMorphing);
  document.getElementById('btnMorphSettings')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const panel = document.getElementById('morphSettingsPanel');
    const opening = panel?.classList.contains('hidden') === true;
    toggleMorphSettingsPanel(opening);
    document.getElementById('randomSettingsPanel')?.classList.add('hidden');
    document.getElementById('projectMenu')?.classList.add('hidden');
    if (opening) {
      syncMorphSettingsUI();
      positionFloatingPanelNearTrigger?.(panel, e.currentTarget);
    }
  });
  document.getElementById('btnCloseMorphPanel')?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleMorphSettingsPanel(false);
  });

  let morphCheckboxUndoSnapshot = null;
  const morphCheckboxes = () =>
    Array.from(document.querySelectorAll('#morphSettingsPanel input[type="checkbox"]'));
  const applyMorphCheckboxState = (el, checked) => {
    if (!el || el.checked === checked) return;
    el.checked = checked;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const updateMorphCheckboxUndoButton = () => {
    const btn = document.getElementById('btnUndoMorphChecks');
    if (btn) btn.disabled = !Array.isArray(morphCheckboxUndoSnapshot);
  };
  document.getElementById('btnClearMorphChecks')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const boxes = morphCheckboxes();
    if (!boxes.some((el) => el.checked)) return;
    morphCheckboxUndoSnapshot = boxes.map((el) => ({ id: el.id, checked: el.checked }));
    boxes.forEach((el) => applyMorphCheckboxState(el, false));
    updateMorphCheckboxUndoButton();
  });
  document.getElementById('btnUndoMorphChecks')?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!Array.isArray(morphCheckboxUndoSnapshot)) return;
    const snapshot = morphCheckboxUndoSnapshot;
    morphCheckboxUndoSnapshot = null;
    snapshot.forEach((item) => applyMorphCheckboxState(document.getElementById(item.id), item.checked));
    updateMorphCheckboxUndoButton();
  });
  document.addEventListener('keydown', (e) => {
    if (e.code !== 'Space' || e.repeat || e.ctrlKey || e.altKey || e.metaKey) return;
    const active = document.activeElement;
    if (
      active &&
      (active.isContentEditable ||
        active.matches(
          'textarea, input[type="text"], input[type="search"], input[type="email"], input[type="url"], input[type="password"]',
        ))
    )
      return;
    e.preventDefault();
    toggleMorphPlaybackBySpace();
  });
  document.getElementById('morphSettingsPanel')?.addEventListener('click', (e) => e.stopPropagation());
  document.addEventListener('click', (e) => {
    const nav = document.querySelector('.morph-nav');
    if (nav && !nav.contains(e.target) && !viewportPopupBelongsToPanel(e.target, 'morphSettingsPanel')) {
      toggleMorphSettingsPanel(false);
    }
  });
  document.getElementById('btnCloseMinimalMorphPanel')?.addEventListener('click', (e) => {
    e.stopPropagation();
    document.getElementById('randomSettingsPanel')?.classList.add('hidden');
  });

  const mirrorBtn = document.getElementById('btnSidebarMirror');
  const syncMirrorBtn = () => {
    if (mirrorBtn) {
      mirrorBtn.classList.toggle('active', state.mirrorMode === true);
      mirrorBtn.setAttribute('aria-pressed', String(state.mirrorMode === true));
    }
  };
  mirrorBtn?.addEventListener('click', () => {
    state.mirrorMode = state.mirrorMode !== true;
    syncMirrorBtn();
    requestMainCanvasRender();
  });
  syncMirrorBtn();
  document.querySelectorAll('[data-sidebar-mode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.sidebarMode;
      const sidebar = document.getElementById('settingsSidebar');
      const desktop = window.matchMedia('(min-width: 761px)').matches;
      if (desktop && sidebar?.classList.contains('desktop-collapsed')) {
        sidebar.classList.remove('desktop-collapsed');
        const collapse = document.getElementById('btnCollapseSidebar');
        collapse?.setAttribute('aria-expanded', 'true');
        collapse?.setAttribute('aria-label', 'Свернуть левую панель');
        if (collapse) collapse.title = 'Свернуть левую панель';
        requestAnimationFrame(() => {
          renderProfileEditor();
          requestMainCanvasRender();
        });
      }
      setSidebarMode(mode);
    });
    btn.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const mode = btn.dataset.sidebarMode;
      if (mode === 'shape') {
        /* Web visibility is independent from lines. */ toggleAllLinesWithMemory();
      } else if (mode === 'lines') toggleSidebarFeatureWithMemory('graffiti');
      else if (mode === 'lamps') toggleSidebarFeatureWithMemory('lamps');
      else if (mode === 'web') toggleSidebarFeatureWithMemory('web');
      else if (mode === 'sweep') toggleSidebarFeatureWithMemory('glint');
      else if (mode === 'lightning') toggleSidebarFeatureWithMemory('lightning');
      else if (mode === 'particles') toggleSidebarFeatureWithMemory('particles');
      else if (mode === 'ambient') window.SomataAmbientPrism?.toggleAmbient?.();
      else if (mode === 'prism') window.SomataAmbientPrism?.togglePrism?.();
      else if (mode === 'motion') toggleMotionQuickGroup();
      else if (mode === 'fourier') setFourierMode(state.fourierMode !== true);
    });
  });
  document
    .getElementById('fourierModeToggle')
    ?.addEventListener('change', (e) => setFourierMode(e.target.checked === true, false));
  const syncFourierStrengthFromUI = () => {
    const strength = Math.max(
      0,
      Math.min(100, Number(document.getElementById('fourierStrength')?.value ?? 50)),
    );
    const targets =
      state.masterLayerEdit === true || hasMultiLayerSelection() ? getLayerEditTargets() : [getActiveLayer()];
    for (const layer of targets) {
      if (!layer) continue;
      layer.fourierStrength = strength;
      invalidateLayerGeometry(layer, 'fourier-strength');
      somataFourierSyncMorphSnapshots(layer, 'fourierStrength');
    }
    syncFourierStrengthUI();
    requestMainCanvasRender();
  };
  document.getElementById('fourierStrength')?.addEventListener('input', syncFourierStrengthFromUI);
  const updateMotionFromUI = () => {
    const m = normalizeMotionState();
    const enabled = document.getElementById('motionRotationEnabled')?.checked === true;
    const direction = document.getElementById('motionRotationDirection')?.value === 'cw' ? 'cw' : 'ccw';
    const speed = Math.max(
      0,
      Math.min(180, Number(document.getElementById('motionRotationSpeed')?.value) || 0),
    );
    const speedMult = (() => {
      const v = Number(document.getElementById('motionRotationMultiplier')?.value);
      return Number.isFinite(v) ? Math.max(0, v) : 1;
    })();
    const lag = Math.max(0, Math.min(360, Number(document.getElementById('motionTunnelLag')?.value) || 0));
    const lagMult = (() => {
      const v = Number(document.getElementById('motionTunnelLagMultiplier')?.value);
      return Number.isFinite(v) ? Math.max(0, v) : 1;
    })();
    for (const layer of getMotionRotationTargets()) {
      const r = normalizeLayerMotionRotation(layer);
      r.enabled = enabled;
      r.direction = direction;
      r.speed = speed;
      r.multiplier = speedMult;
      r.tunnelLag = lag;
      r.tunnelLagMultiplier = lagMult;
    }
    m.cameraEnabled = document.getElementById('motionCameraEnabled')?.checked === true;
    m.cameraSpeed = Math.max(
      0,
      Math.min(100, Number(document.getElementById('motionCameraSpeed')?.value) || 0),
    );
    {
      const v = Number(document.getElementById('motionCameraMultiplier')?.value);
      m.cameraMultiplier = Number.isFinite(v) ? Math.max(0, v) : 1;
    }
    m.cameraAmount = Math.max(
      0,
      Math.min(100, Number(document.getElementById('motionCameraAmount')?.value) || 0),
    );
    m.colorEnabled = document.getElementById('motionColorEnabled')?.checked === true;
    m.colorSpeed = Math.max(
      0,
      Math.min(100, Number(document.getElementById('motionColorSpeed')?.value) || 0),
    );
    {
      const v = Number(document.getElementById('motionColorMultiplier')?.value);
      m.colorMultiplier = Number.isFinite(v) ? Math.max(0, v) : 1;
    }
    const p = document.querySelector('#motionPaletteHost select');
    if (p?.value) m.paletteKey = p.value;
    syncMotionUI();
    ensureMotionAnimation();
    requestMainCanvasRender();
  };
  [
    'motionRotationEnabled',
    'motionRotationSpeed',
    'motionRotationMultiplier',
    'motionTunnelLag',
    'motionTunnelLagMultiplier',
    'motionCameraEnabled',
    'motionCameraSpeed',
    'motionCameraMultiplier',
    'motionCameraAmount',
    'motionColorEnabled',
    'motionColorSpeed',
    'motionColorMultiplier',
  ].forEach((id) => {
    document.getElementById(id)?.addEventListener('input', updateMotionFromUI);
    document.getElementById(id)?.addEventListener('change', updateMotionFromUI);
  });
  document.getElementById('motionCameraEnabled')?.addEventListener('change', (e) => {
    normalizeMotionState().quickToggleCamera = e.target.checked === true;
  });
  document.getElementById('motionColorEnabled')?.addEventListener('change', (e) => {
    normalizeMotionState().quickToggleColor = e.target.checked === true;
  });
  document.getElementById('motionRotationDirection')?.addEventListener('click', (e) => {
    const targets = getMotionRotationTargets();
    if (!targets.length) return;
    const next = normalizeLayerMotionRotation(targets[0]).direction === 'cw' ? 'ccw' : 'cw';
    for (const layer of targets) normalizeLayerMotionRotation(layer).direction = next;
    e.currentTarget.value = next;
    syncMotionUI();
    requestMainCanvasRender();
  });
  function recordActiveMorphFeatureOverride(mode, enabled) {
    const on = enabled === true;
    if (runtimeState.minimalMorph?.active === true) {
      if (!state.minimalMorph.featureOverrides || typeof state.minimalMorph.featureOverrides !== 'object')
        state.minimalMorph.featureOverrides = {};
      if (mode === 'graffiti') delete state.minimalMorph.featureOverrides.graffiti;
      else state.minimalMorph.featureOverrides[mode] = on;
      window.SomataOrangeMorphProfiles?.captureDraft?.(
        state.minimalMorph,
        state.randomOptions,
        state.randomLayerCount,
      );
    }
    if (runtimeState.morph?.active === true) {
      if (!state.morph.featureOverrides || typeof state.morph.featureOverrides !== 'object')
        state.morph.featureOverrides = {};
      state.morph.featureOverrides[mode] = on;
    }
    return on;
  }
  window.__somataRecordMorphFeatureOverride = recordActiveMorphFeatureOverride;
  document.getElementById('showLines')?.addEventListener('change', (e) => {
    e.target.indeterminate = false;
    applyLineVisibilityToTargets(e.target.checked === true);
  });
  document.getElementById('showLamps')?.addEventListener('change', (e) => {
    for (const layer of getEffectTargets()) setLayerLampsEnabled(layer, e.target.checked === true);
    if (state.masterLayerEdit === true || sidebarFeatureStatesAreUniform('lamps'))
      state.showLamps = e.target.checked === true;
    recordActiveMorphFeatureOverride('lamps', e.target.checked === true);
    syncLampSettingsUI();
    syncSidebarToolStates();
    requestMainCanvasRender();
  });
  document.getElementById('showWeb')?.addEventListener('change', (e) => {
    queueWebSwitchForNextMorph({ showWeb: e.target.checked === true });
    if (state.masterLayerEdit === true) state.showWeb = e.target.checked === true;
    recordActiveMorphFeatureOverride('web', e.target.checked === true);
    syncSidebarToolStates();
  });
  document.getElementById('showSweep')?.addEventListener('change', (e) => {
    for (const layer of getEffectTargets()) setLayerGlintEnabled(layer, e.target.checked === true);
    if (state.masterLayerEdit === true) {
      normalizeSweepConfig(state.sweep);
      state.sweep.glintEnabled = e.target.checked === true;
      state.sweep.enabled = state.sweep.glintEnabled === true || state.sweep.lightningEnabled === true;
    }
    recordActiveMorphFeatureOverride('glint', e.target.checked === true);
    syncSweepUI();
    syncSidebarToolStates();
    ensureSweepAnimation();
    requestMainCanvasRender();
  });
  document.getElementById('showLightning')?.addEventListener('change', (e) => {
    for (const layer of getEffectTargets()) setLayerLightningEnabled(layer, e.target.checked === true);
    if (state.masterLayerEdit === true) {
      normalizeSweepConfig(state.sweep);
      state.sweep.lightningEnabled = e.target.checked === true;
      state.sweep.enabled = state.sweep.glintEnabled === true || state.sweep.lightningEnabled === true;
    }
    recordActiveMorphFeatureOverride('lightning', e.target.checked === true);
    syncSweepUI();
    syncSidebarToolStates();
    ensureSweepAnimation();
    requestMainCanvasRender();
  });
  const updateParticlesFromUI = (changedId = '') => {
    const active = getActiveEffectLayer();
    if (!active) return;
    const seed = getLayerParticleConfig(active),
      next = normalizeParticleConfig({
        ...seed,
        enabled: document.getElementById('showParticles')?.checked === true,
        style: document.getElementById('particleStyle')?.value,
        mode: document.getElementById('particleMode')?.value,
        colorMode: document.getElementById('particleColorMode')?.value,
        paletteKey: document.getElementById('particlePalette')?.value || seed.paletteKey,
        density: Number(document.getElementById('particleDensity')?.value),
        densityMultiplier: Number(document.getElementById('particleDensityMultiplier')?.value),
        sizePx: Number(document.getElementById('particleSize')?.value),
        scatter: Number(document.getElementById('particleScatter')?.value),
        scatterMultiplier: Number(document.getElementById('particleScatterMultiplier')?.value),
        sizeVariation: Number(document.getElementById('particleSizeVariation')?.value),
        sizeVariationMultiplier: Number(document.getElementById('particleSizeVariationMultiplier')?.value),
        speedPercent: Number(document.getElementById('particleSpeed')?.value),
        speedMultiplier: Number(document.getElementById('particleSpeedMultiplier')?.value),
        opacity: Number(document.getElementById('particleOpacity')?.value),
        twinkle: Number(document.getElementById('particleTwinkle')?.value),
        spiralRadiusPx: Number(document.getElementById('particleSpiralRadius')?.value),
        spiralRadiusMultiplier: Number(document.getElementById('particleSpiralRadiusMultiplier')?.value),
        spiralTurns: Number(document.getElementById('particleSpiralTurns')?.value),
      });
    const targets =
      state.masterLayerEdit === true || hasMultiLayerSelection() ? getLayerEditTargets() : [active];
    for (const layer of targets) {
      setLayerParticlesConfig(
        layer,
        { ...next },
        changedId === 'showParticles' ? 'particles-enabled' : 'particles-ui',
      );
    }
    try {
      WebGPUParticleRenderer?.warmup?.();
    } catch (error) {
      noteSuppressedError('ui/preset-random-morph#updateParticlesFromUI', error);
    }
    ensureParticleAnimation();
    syncParticleUI();
    syncSidebarToolStates();
    requestMainCanvasRender();
  };
  document.getElementById('showParticles')?.addEventListener('change', (e) => {
    recordActiveMorphFeatureOverride('particles', e.target.checked === true);
    updateParticlesFromUI('showParticles');
  });
  ['particleStyle', 'particleMode', 'particleColorMode', 'particlePalette'].forEach((id) =>
    document.getElementById(id)?.addEventListener('change', () => updateParticlesFromUI(id)),
  );
  [
    'particleDensity',
    'particleDensityMultiplier',
    'particleSize',
    'particleScatter',
    'particleScatterMultiplier',
    'particleSizeVariation',
    'particleSizeVariationMultiplier',
    'particleSpeed',
    'particleSpeedMultiplier',
    'particleOpacity',
    'particleTwinkle',
    'particleSpiralRadius',
    'particleSpiralRadiusMultiplier',
    'particleSpiralTurns',
  ].forEach((id) => document.getElementById(id)?.addEventListener('input', () => updateParticlesFromUI(id)));
  const updateSweepFromUI = (ev) => {
    const active = getActiveEffectLayer();
    if (!active) return;
    const originalSweep = getLayerSweepConfig(active);
    const sweep = cloneEffectConfig(originalSweep);
    normalizeSweepConfig(sweep);
    const previousEffect = sweep.effectType,
      changedId = ev?.currentTarget?.id || '';
    if (changedId === 'sweepEffectType') {
      const effect = document.getElementById('sweepEffectType')?.value;
      sweep.effectType = effect === 'lightning' ? 'lightning' : 'glint';
      if (sweep.enabled === true) {
        sweep.glintEnabled = sweep.effectType === 'glint';
        sweep.lightningEnabled = sweep.effectType === 'lightning';
      }
    }
    sweep.profileShape = 'current';
    sweep.coreBlendMode = normalizeSweepBlendMode(document.getElementById('sweepCoreBlendMode')?.value);
    sweep.glowBlendMode = normalizeSweepBlendMode(document.getElementById('sweepGlowBlendMode')?.value);
    sweep.lightningBlendMode = normalizeLightningLampBlendMode(
      document.getElementById('sweepLightningBlendMode')?.value,
    );
    sweep.flashMode = normalizeSweepFlashMode(document.getElementById('sweepFlashMode')?.value);
    {
      const v = document.getElementById('sweepGlintPrecision')?.value;
      sweep.flashType = normalizeGlintPrecisionValue(v ?? sweep.flashType ?? sweep.glintPrecision);
      if (sweep.flashType === 'spectral') sweep.flashType = 'high';
      sweep.glintPrecision = sweep.flashType;
    }
    {
      const v = Number(document.getElementById('sweepSpectralSectorDegrees')?.value);
      sweep.spectralSectorDegrees = Number.isFinite(v) ? Math.max(1, Math.min(360, v)) : 45;
    }
    {
      const v = Number(document.getElementById('sweepSpectralAngularSpeed')?.value);
      sweep.spectralAngularSpeed = Number.isFinite(v) ? Math.max(-720, Math.min(720, v)) : 90;
    }
    if (
      changedId === 'sweepEffectType' &&
      previousEffect !== 'lightning' &&
      sweep.effectType === 'lightning'
    ) {
      sweep.phase = 0;
      sweep.lastUpdate = 0;
      sweep.currentVelocity = 0;
      sweep.cycleCount = 0;
      sweep.lightningPhase = 0;
      sweep.lightningLastUpdate = 0;
      sweep.lightningCycleCount = 0;
      resetLightningClock(state.layers.indexOf(active), sweep, 0);
    }
    const mode = document.getElementById('sweepMode')?.value;
    sweep.mode = ['perSegment', 'everyNth', 'across', 'perPath', 'whole'].includes(mode) ? mode : 'whole';
    sweep.everyN = Math.max(
      2,
      Math.min(24, Math.round(Number(document.getElementById('sweepEveryN')?.value) || 2)),
    );
    sweep.direction =
      document.getElementById('sweepDirection')?.value === 'backward' ? 'backward' : 'forward';
    sweep.syncMusic = document.getElementById('sweepSyncMusic')?.checked !== false;
    sweep.speed = Math.max(0.02, Math.min(2, Number(document.getElementById('sweepSpeed')?.value) || 0.25));
    {
      const v = Number(document.getElementById('sweepSpeedMultiplier')?.value);
      sweep.speedMultiplier = Number.isFinite(v) ? Math.max(0.015625, Math.min(64, v)) : 1;
    }
    sweep.lengthPercent = Math.max(
      1,
      Math.min(100, Number(document.getElementById('sweepLength')?.value) || 3),
    );
    {
      const v = Number(document.getElementById('sweepWidthPercent')?.value);
      sweep.widthPercent = Number.isFinite(v) ? Math.max(0, Math.min(200, v)) : 105;
    } // A non-colour input must never overwrite the two independent tints from a
    // potentially stale or not-yet-hydrated colour picker.
    if (changedId === 'sweepColor') {
      const value = ev?.currentTarget?.value;
      if (/^#[0-9a-f]{6}$/i.test(value || '')) sweep.color = value;
    }
    if (changedId === 'sweepHaloColor') {
      const value = ev?.currentTarget?.value;
      if (/^#[0-9a-f]{6}$/i.test(value || '')) sweep.haloColor = value;
    }
    {
      const v = Number(document.getElementById('sweepOpacity')?.value);
      sweep.opacity = Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 100;
    }
    sweep.brightness = Math.max(
      0,
      Math.min(200, Number(document.getElementById('sweepBrightness')?.value) || 0),
    );
    sweep.glow = Math.max(0, Number(document.getElementById('sweepGlow')?.value) || 0);
    {
      const v = Number(document.getElementById('sweepGlowMultiplier')?.value);
      sweep.glowMultiplier = Number.isFinite(v) ? Math.max(0, v) : 1;
    }
    {
      const v = Number(document.getElementById('sweepGlowIntensity')?.value);
      sweep.glowIntensity = Number.isFinite(v) ? Math.max(0, Math.min(200, v)) : 100;
    }
    {
      const v = Number(document.getElementById('sweepGlowIntensityMultiplier')?.value);
      sweep.glowIntensityMultiplier = Number.isFinite(v) ? Math.max(0, v) : 1;
    }
    sweep.softness = Math.max(0, Math.min(150, Number(document.getElementById('sweepSoftness')?.value) || 0));
    {
      const v = Number(document.getElementById('sweepSoftnessMultiplier')?.value);
      sweep.softnessMultiplier = Number.isFinite(v) ? Math.max(0, v) : 1;
    }
    sweep.lightningTriggerMode = document.getElementById('sweepLightningTriggerMode')?.value || 'morph';
    delete sweep.lightningProfileShape;
    const lbehavior = document.getElementById('sweepLightningBehavior')?.value;
    sweep.lightningBehavior = normalizeLightningBehaviorValue(lbehavior, 'symmetric');
    const lprecision = document.getElementById('sweepLightningPrecision')?.value;
    sweep.lightningPrecision = normalizeLightningPrecisionValue(lprecision);
    sweep.lightningMode = 'perPath';
    sweep.lightningEveryN = Math.max(
      2,
      Math.min(24, Math.round(Number(document.getElementById('sweepLightningEveryN')?.value) || 2)),
    );
    sweep.lightningRandomPosition = false;
    sweep.lightningColor = document.getElementById('sweepLightningColor')?.value || '#ffffff';
    sweep.lightningSecondaryColor =
      document.getElementById('sweepLightningSecondaryColor')?.value || '#7dd3fc';
    sweep.lightningSegmentPercent = Math.max(
      1,
      Math.min(100, Number(document.getElementById('sweepLightningSegmentPercent')?.value) || 100),
    );
    {
      const v = Number(document.getElementById('sweepLightningRatePercent')?.value);
      sweep.lightningRatePercent = Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 100;
    }
    {
      const v = Number(document.getElementById('sweepLightningRateMultiplier')?.value);
      sweep.lightningRateMultiplier = Number.isFinite(v) && v > 0 ? v : 1;
    }
    if (lightningRateSyncEnabled()) syncLightningRateValuesFrom(sweep);
    sweep.lightningDurationMs = Math.max(
      30,
      Math.min(700, Number(document.getElementById('sweepLightningDuration')?.value) || 480),
    );
    {
      const v = Number(document.getElementById('sweepLightningDurationMultiplier')?.value);
      sweep.lightningDurationMultiplier = Number.isFinite(v) && v > 0 ? v : 1;
    }
    sweep.lightningWidthPercent = Math.max(
      1,
      Math.min(100, Number(document.getElementById('sweepLightningWidthPercent')?.value) || 64),
    );
    {
      const v = Number(document.getElementById('sweepLightningWidthMultiplier')?.value);
      sweep.lightningWidthMultiplier = Number.isFinite(v) ? Math.max(0, v) : 1;
    }
    {
      sweep.lightningGlow = Math.max(0, Number(document.getElementById('sweepLightningGlow')?.value) || 0);
      {
        const v = Number(document.getElementById('sweepLightningGlowMultiplier')?.value);
        sweep.lightningGlowMultiplier = Number.isFinite(v) ? Math.max(0, v) : 1;
      }
      {
        const v = Number(document.getElementById('sweepLightningGlowIntensity')?.value);
        sweep.lightningGlowIntensity = Number.isFinite(v) ? Math.max(0, Math.min(400, v)) : 100;
      }
      {
        const v = Number(document.getElementById('sweepLightningGlowIntensityMultiplier')?.value);
        sweep.lightningGlowIntensityMultiplier = Number.isFinite(v) ? Math.max(0, v) : 1;
      }
      sweep.lightningSoftness = Math.max(
        0,
        Math.min(150, Number(document.getElementById('sweepLightningSoftness')?.value) || 0),
      );
      {
        const v = Number(document.getElementById('sweepLightningSoftnessMultiplier')?.value);
        sweep.lightningSoftnessMultiplier = Number.isFinite(v) ? Math.max(0, v) : 1;
      }
    }
    sweep.lightningPrecision = 'exact';
    sweep.lightningSmoothLighting = true;
    sweep.lightningShowLines = document.getElementById('sweepLightningShowLines')?.checked !== false;
    sweep.lightningLineOpacity = Math.max(
      0,
      Math.min(100, Number(document.getElementById('sweepLightningLineOpacity')?.value) || 100),
    );
    sweep.lightningAfterglow = false;
    sweep.lightningAfterglowMs = 0;
    {
      const v = Number(document.getElementById('sweepLightningMicroStrikes')?.value);
      sweep.lightningMicroStrikes = Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0;
    }
    normalizeSweepConfig(sweep);
    // Form controls are not a serialisation source: only the field
    // explicitly edited by this event is committed. Previously all
    // visible controls were reread and the entire sweep object was
    // cloned onto every Master layer (resetting independent colours,
    // core opacity, halo brightness and other per-layer settings).
    const editedSweepKeys = new Set(
      SomataMasterBroadcastCore.controlPaths(changedId, { sweep })
        .filter((path) => path.startsWith('sweep.'))
        .map((path) => path.slice('sweep.'.length)),
    );
    if (changedId === 'sweepEffectType' && sweep.effectType !== previousEffect) {
      for (const key of [
        'phase',
        'lastUpdate',
        'currentVelocity',
        'cycleCount',
        'lightningPhase',
        'lightningLastUpdate',
        'lightningCycleCount',
      ])
        editedSweepKeys.add(key);
    }
    if (
      lightningRateSyncEnabled() &&
      ['sweepLightningRatePercent', 'sweepLightningRateMultiplier'].includes(changedId)
    ) {
      editedSweepKeys.add('lightningRatePercent');
      editedSweepKeys.add('lightningRateMultiplier');
    }
    if (!editedSweepKeys.size) return;
    const affectedLayers =
      state.masterLayerEdit === true || hasMultiLayerSelection() ? getLayerEditTargets() : [active];
    for (const layer of affectedLayers) {
      const config = layer === active ? originalSweep : getLayerSweepConfig(layer);
      for (const key of editedSweepKeys)
        if (Object.prototype.hasOwnProperty.call(sweep, key)) config[key] = cloneMasterLayerValue(sweep[key]);
      markLayerEffectChanged(layer, 'sweep-ui');
    }
    if (
      lightningRateSyncEnabled() &&
      ['sweepLightningRatePercent', 'sweepLightningRateMultiplier'].includes(changedId)
    )
      syncLightningRateValuesFrom(originalSweep);
    syncSweepUI();
    ensureSweepAnimation();
    requestMainCanvasRender();
  };
  [
    'sweepEffectType',
    'sweepCoreBlendMode',
    'sweepGlowBlendMode',
    'sweepLightningBlendMode',
    'sweepFlashMode',
    'sweepGlintPrecision',
    'sweepSpectralSectorDegrees',
    'sweepSpectralAngularSpeed',
    'sweepMode',
    'sweepEveryN',
    'sweepLightningTriggerMode',
    'sweepLightningBehavior',
    'sweepLightningPrecision',
    'sweepLightningMode',
    'sweepLightningEveryN',
    'sweepLightningRandomPosition',
    'sweepDirection',
    'sweepSyncMusic',
    'sweepSpeed',
    'sweepSpeedMultiplier',
    'sweepLength',
    'sweepWidthPercent',
    'sweepColor',
    'sweepHaloColor',
    'sweepOpacity',
    'sweepBrightness',
    'sweepGlow',
    'sweepGlowMultiplier',
    'sweepGlowIntensity',
    'sweepGlowIntensityMultiplier',
    'sweepSoftness',
    'sweepSoftnessMultiplier',
    'sweepLightningColor',
    'sweepLightningSecondaryColor',
    'sweepLightningSegmentPercent',
    'sweepLightningRatePercent',
    'sweepLightningRateMultiplier',
    'sweepLightningDuration',
    'sweepLightningDurationMultiplier',
    'sweepLightningWidthPercent',
    'sweepLightningWidthMultiplier',
    'sweepLightningGlow',
    'sweepLightningGlowMultiplier',
    'sweepLightningGlowIntensity',
    'sweepLightningGlowIntensityMultiplier',
    'sweepLightningSoftness',
    'sweepLightningSoftnessMultiplier',
    'sweepLightningShowLines',
    'sweepLightningLineOpacity',
    'sweepLightningMicroStrikes',
  ].forEach((id) => {
    document.getElementById(id)?.addEventListener('input', updateSweepFromUI);
    document.getElementById(id)?.addEventListener('change', updateSweepFromUI);
  });
  document.getElementById('sweepLightningRateSync')?.addEventListener('change', (e) => {
    const active = getActiveEffectLayer();
    if (!active) return;
    const cfg = getLayerSweepConfig(active);
    setLightningRateSynchronization(e.target.checked === true, cfg, state.layers.indexOf(active));
    syncSweepUI();
    ensureSweepAnimation();
    requestMainCanvasRender();
  });
  document.querySelectorAll('[data-line-main-mode]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const active = getActiveLayer();
      if (!active) return;
      const mode = btn.dataset.lineMainMode;
      const targets = getLayerEditTargets();
      for (const layer of targets) setLayerMainLineMode(layer, mode);
      if (mode === 'graffiti') {
        frameGraphPerformanceRuntime.penaltyUntilFrame = 0;
        WebGPUGraffitiRibbonRenderer.warmup();
        WebGPUFinalCompositeRenderer.warmup();
      }
      if (mode === 'sprite') {
        frameGraphPerformanceRuntime.penaltyUntilFrame = 0;
        for (const layer of targets) {
          ensureLayerEffectState(layer);
          layer.sprite = normalizeLineSpriteConfig(layer.sprite);
          layer.sprite.enabled = true;
          layer.lineProfileApplication = 'stroke';
          layer.lineProfile = 'round';
          layer.lineProfileStroke = 'round';
        }
        WebGPUPathFxRenderer.warmup();
        WebGPUFinalCompositeRenderer.warmup();
        WebGPUStrokeRenderer.warmup();
        ensureGpuPathFxAnimation();
        requestAnimationFrame(() => {
          ensureGpuPathFxAnimation();
          requestMainCanvasRender();
        });
      }
      syncSidebarInputs();
      requestMainCanvasRender();
    }),
  );
  document.querySelectorAll('[data-line-marker-type]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const active = getActiveLayer();
      if (!active) return;
      const type = normalizeLineMarkerType(btn.dataset.lineMarkerType, 'slash');
      for (const layer of getLayerEditTargets()) {
        ensureLayerEffectState(layer);
        layer.lineMarkerType = type;
        if (getLayerMainLineMode(layer) === 'dash') {
          layer.lineProfile = type;
          layer.lineProfileStroke = type;
        }
      }
      WebGPUProfileMarkerRenderer.warmup();
      syncSidebarInputs();
      requestMainCanvasRender();
    }),
  );
  document.querySelectorAll('[data-graffiti-nib]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const active = getActiveLayer();
      if (!active) return;
      const shape = ['pointed', 'blunt', 'pinched', 'round'].includes(btn.dataset.graffitiNib)
        ? btn.dataset.graffitiNib
        : 'pointed';
      for (const layer of getLayerEditTargets()) {
        layer.graffitiNibShape = shape;
        layer.lineProfileGraffiti = 'slash';
        markLayerEffectChanged(layer, 'graffiti-nib');
      }
      const sel = document.getElementById('graffitiNibShape');
      if (sel) sel.value = shape;
      WebGPUGraffitiRibbonRenderer.warmup();
      syncSidebarInputs();
      requestMainCanvasRender();
    }),
  );
  document.getElementById('graffitiAngle')?.addEventListener('input', (e) => {
    const active = getActiveLayer();
    if (!active) return;
    const angle = Math.max(-90, Math.min(90, Number(e.target.value) || 0));
    for (const layer of getLayerEditTargets()) {
      layer.graffitiAngle = angle;
      markLayerEffectChanged(layer, 'graffiti-angle');
    }
    const v = document.getElementById('graffitiAngleValue');
    if (v) v.textContent = `${Math.round(angle)}°`;
    WebGPUGraffitiRibbonRenderer.warmup();
    WebGPUGraffitiMorphRenderer.warmup();
    requestMainCanvasRender();
  });
  document.getElementById('graffitiAngleMode')?.addEventListener('change', (e) => {
    const active = getActiveLayer();
    if (!active) return;
    const mode = e.target.value === 'relative' ? 'relative' : 'absolute';
    for (const layer of getLayerEditTargets()) {
      layer.graffitiAngleMode = mode;
      markLayerEffectChanged(layer, 'graffiti-angle-mode');
    }
    WebGPUGraffitiRibbonRenderer.warmup();
    WebGPUGraffitiMorphRenderer.warmup();
    requestMainCanvasRender();
  });
  document.getElementById('graffitiNibShape')?.addEventListener('change', (e) => {
    const active = getActiveLayer();
    if (!active) return;
    const shape = ['pointed', 'blunt', 'pinched', 'round'].includes(e.target.value)
      ? e.target.value
      : 'pointed';
    for (const layer of getLayerEditTargets()) {
      layer.graffitiNibShape = shape;
      layer.lineProfileGraffiti = 'slash';
      markLayerEffectChanged(layer, 'graffiti-nib');
    }
    document
      .querySelectorAll('[data-graffiti-nib]')
      .forEach((btn) => btn.classList.toggle('active', btn.dataset.graffitiNib === shape));
    WebGPUGraffitiRibbonRenderer.warmup();
    WebGPUGraffitiMorphRenderer.warmup();
    requestMainCanvasRender();
  });
  const syncGraffitiNibLength = () => {
    const active = getActiveLayer();
    if (!active) return;
    const value = Math.max(1, Math.min(20, Number(document.getElementById('graffitiNibLength')?.value) || 3));
    const mulRaw = Number(document.getElementById('graffitiNibLengthMultiplier')?.value);
    const mul = Number.isFinite(mulRaw) ? Math.max(0.01, mulRaw) : 1;
    for (const layer of getLayerEditTargets()) {
      layer.graffitiNibLength = value;
      layer.graffitiNibLengthMultiplier = mul;
      markLayerEffectChanged(layer, 'graffiti-nib-length');
    }
    const t = document.getElementById('graffitiNibLengthText');
    if (t) t.textContent = value.toFixed(value % 1 ? 2 : 0);
    WebGPUGraffitiRibbonRenderer.warmup();
    WebGPUGraffitiMorphRenderer.warmup();
    requestMainCanvasRender();
  };
  document.getElementById('graffitiNibLength')?.addEventListener('input', syncGraffitiNibLength);
  document.getElementById('graffitiNibLengthMultiplier')?.addEventListener('input', syncGraffitiNibLength);
  document.getElementById('graffitiNibLengthMultiplier')?.addEventListener('change', syncGraffitiNibLength);
  const syncGraffitiVariation = () => {
    const active = getActiveLayer();
    if (!active) return;
    const modeRaw = document.getElementById('graffitiVariationMode')?.value;
    const mode = ['perSegment', 'everyNth', 'across', 'perPath', 'whole'].includes(modeRaw)
      ? modeRaw
      : 'perSegment';
    const everyN = Math.max(
      1,
      Math.min(24, Math.round(Number(document.getElementById('graffitiVariationEveryN')?.value) || 2)),
    );
    const sizeEnabled = document.getElementById('graffitiSizeVariationEnabled')?.checked === true;
    const sv = Number(document.getElementById('graffitiSizeVariation')?.value),
      sizeVariation = Math.max(0, Math.min(100, Number.isFinite(sv) ? sv : 30));
    const sf = Number(document.getElementById('graffitiSizeFocus')?.value),
      sizeFocus = Math.max(0, Math.min(100, Number.isFinite(sf) ? sf : 75));
    const rotationEnabled = document.getElementById('graffitiRotationVariationEnabled')?.checked === true;
    const rotationVariation = Math.max(
      0,
      Math.min(180, Number(document.getElementById('graffitiRotationVariation')?.value) || 0),
    );
    const rm = Number(document.getElementById('graffitiRotationMultiplier')?.value),
      rotationMultiplier = Number.isFinite(rm) ? Math.max(0, rm) : 1;
    const rf = Number(document.getElementById('graffitiRotationFocus')?.value),
      rotationFocus = Math.max(0, Math.min(100, Number.isFinite(rf) ? rf : 50));
    for (const layer of getLayerEditTargets()) {
      layer.graffitiVariationMode = mode;
      layer.graffitiVariationEveryN = everyN;
      layer.graffitiSizeVariationEnabled = sizeEnabled;
      layer.graffitiSizeVariation = sizeVariation;
      layer.graffitiSizeFocus = sizeFocus;
      layer.graffitiRotationVariationEnabled = rotationEnabled;
      layer.graffitiRotationVariation = rotationVariation;
      layer.graffitiRotationMultiplier = rotationMultiplier;
      layer.graffitiRotationFocus = rotationFocus;
      markLayerEffectChanged(layer, 'graffiti-variation');
    }
    WebGPUGraffitiRibbonRenderer.warmup();
    WebGPUGraffitiMorphRenderer.warmup();
    syncSidebarInputs();
    requestMainCanvasRender();
  };
  [
    'graffitiVariationMode',
    'graffitiVariationEveryN',
    'graffitiSizeVariationEnabled',
    'graffitiSizeVariation',
    'graffitiSizeFocus',
    'graffitiRotationVariationEnabled',
    'graffitiRotationVariation',
    'graffitiRotationMultiplier',
    'graffitiRotationFocus',
  ].forEach((id) => {
    document.getElementById(id)?.addEventListener('input', syncGraffitiVariation);
    document.getElementById(id)?.addEventListener('change', syncGraffitiVariation);
  });

  const updateGpuLineFxFromUI = () => {
    const active = getActiveLayer();
    if (!active) return;
    const targets =
      state.masterLayerEdit === true || hasMultiLayerSelection() ? getLayerEditTargets() : [active];
    const spriteType = normalizeLineSpriteType(document.getElementById('lineSpriteType')?.value),
      spritePreset = getLineSpritePreset(spriteType);
    const sp = {
      enabled: getLayerMainLineMode(active) === 'sprite',
      type: spriteType,
      matchLineColor: document.getElementById('lineSpriteMatchColor')?.checked === true,
      color: document.getElementById('lineSpriteColor')?.value || spritePreset.primary,
      secondaryColor: document.getElementById('lineSpriteSecondaryColor')?.value || spritePreset.secondary,
      mode: normalizeLineSpritePlacement(document.getElementById('lineSpriteMode')?.value),
      everyN: Math.max(
        2,
        Math.min(24, Math.round(Number(document.getElementById('lineSpriteEveryN')?.value) || 2)),
      ),
      lengthPercent: 100,
      amplitudePx: 0,
      wavelengthPx: 54,
      speedPercent: 0,
      widthPercent: Math.max(
        100,
        Math.min(
          6000,
          Number(document.getElementById('lineSpriteWidth')?.value) || spritePreset.widthPercent,
        ),
      ),
      widthMultiplier: Math.max(
        0.01,
        Number(document.getElementById('lineSpriteWidthMultiplier')?.value) || 1,
      ),
      scaleVersion: 431,
    };
    const mt = document.getElementById('lineMotionFxType')?.value;
    const mo = normalizeLineMotionFxConfig({
      enabled: document.getElementById('lineMotionFxEnabled')?.checked === true,
      type: ['seaRaft', 'jumpRope', 'sinusoid'].includes(mt) ? mt : 'seaRaft',
      replaceBase: document.getElementById('lineMotionFxReplaceBase')?.checked !== false,
      amplitudePx: Math.max(
        0,
        Math.min(50, Number(document.getElementById('lineMotionFxAmplitude')?.value) || 0),
      ),
      amplitudeMultiplier: Math.max(
        0,
        Number(document.getElementById('lineMotionFxAmplitudeMultiplier')?.value) || 0,
      ),
      wavelengthPx: Math.max(
        1,
        Math.min(50, Number(document.getElementById('lineMotionFxWavelength')?.value) || 36),
      ),
      wavelengthMultiplier: Math.max(
        0.01,
        Number(document.getElementById('lineMotionFxWavelengthMultiplier')?.value) || 2,
      ),
      speedPercent: Math.max(
        0,
        Math.min(300, Number(document.getElementById('lineMotionFxSpeed')?.value) || 0),
      ),
      widthPercent: Math.max(
        20,
        Math.min(500, Number(document.getElementById('lineMotionFxWidth')?.value) || 100),
      ),
    });
    for (const layer of targets) {
      ensureLayerEffectState(layer);
      layer.sprite = { ...layer.sprite, ...sp };
      layer.lineMotionFx = { ...layer.lineMotionFx, ...mo };
      if (sp.enabled) {
        layer.lineProfile = 'round';
        layer.lineProfileStroke = 'round';
      }
    }

    if (sp.enabled || mo.enabled) frameGraphPerformanceRuntime.penaltyUntilFrame = 0;
    WebGPUPathFxRenderer.warmup();
    WebGPUFinalCompositeRenderer.warmup();
    WebGPUStrokeRenderer.warmup();
    ensureGpuPathFxAnimation();
    syncGpuLineFxUI(active);
    requestMainCanvasRender();
  };
  [
    'lineSpriteMode',
    'lineSpriteEveryN',
    'lineSpriteLength',
    'lineSpriteAmplitude',
    'lineSpriteWavelength',
    'lineSpriteSpeed',
    'lineSpriteWidth',
    'lineSpriteWidthMultiplier',
    'lineSpriteMatchColor',
    'lineSpriteColor',
    'lineSpriteSecondaryColor',
    'lineMotionFxEnabled',
    'lineMotionFxType',
    'lineMotionFxReplaceBase',
    'lineMotionFxAmplitude',
    'lineMotionFxAmplitudeMultiplier',
    'lineMotionFxWavelength',
    'lineMotionFxWavelengthMultiplier',
    'lineMotionFxSpeed',
    'lineMotionFxWidth',
  ].forEach((id) => {
    document.getElementById(id)?.addEventListener('input', updateGpuLineFxFromUI);
    document.getElementById(id)?.addEventListener('change', updateGpuLineFxFromUI);
  });
  const applyLineSpritePreset = (type) => {
    type = normalizeLineSpriteType(type);
    const preset = getLineSpritePreset(type),
      active = getActiveLayer();
    if (!active) return;
    const targets =
      state.masterLayerEdit === true || hasMultiLayerSelection() ? getLayerEditTargets() : [active];
    for (const layer of targets) {
      ensureLayerEffectState(layer);
      layer.sprite = {
        ...normalizeLineSpriteConfig(layer.sprite),
        enabled: true,
        type,
        matchLineColor: false,
        color: preset.primary,
        secondaryColor: preset.secondary,
        widthPercent: preset.widthPercent,
        widthMultiplier: 1,
        scaleVersion: 431,
        imageDataUrl: '',
        imageName: '',
      };
      layer.lineProfileApplication = 'stroke';
      layer.lineProfile = 'round';
      layer.lineProfileStroke = 'round';
    }
    frameGraphPerformanceRuntime.penaltyUntilFrame = 0;
    WebGPUPathFxRenderer.warmup();
    ensureGpuPathFxAnimation();
    syncGpuLineFxUI(active);
    requestMainCanvasRender();
  };
  document
    .getElementById('lineSpriteType')
    ?.addEventListener('change', (e) => applyLineSpritePreset(e.target.value));
  document
    .querySelectorAll('.line-sprite-preset[data-line-sprite-type]')
    .forEach((btn) => btn.addEventListener('click', () => applyLineSpritePreset(btn.dataset.lineSpriteType)));
  document
    .getElementById('lineSpriteUploadBtn')
    ?.addEventListener('click', () => document.getElementById('lineSpriteUploadInput')?.click());
  document.getElementById('lineSpriteUploadInput')?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      alert('Спрайт слишком большой. Максимум 8 МБ.');
      e.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const data = typeof reader.result === 'string' ? reader.result : '';
      if (!data) return;
      const active = getActiveLayer();
      if (!active) return;
      const targets =
        state.masterLayerEdit === true || hasMultiLayerSelection() ? getLayerEditTargets() : [active];
      for (const layer of targets) {
        ensureLayerEffectState(layer);
        layer.sprite.imageDataUrl = data;
        layer.sprite.imageName = file.name || 'свой спрайт';
        layer.sprite.enabled = true;
        layer.lineProfileApplication = 'stroke';
        layer.lineProfile = 'round';
        layer.lineProfileStroke = 'round';
      }
      frameGraphPerformanceRuntime.penaltyUntilFrame = 0;
      WebGPUPathFxRenderer.warmup();
      ensureGpuPathFxAnimation();
      syncGpuLineFxUI(active);
      requestMainCanvasRender();
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  });
  document.getElementById('lineSpriteResetBtn')?.addEventListener('click', () => {
    const active = getActiveLayer();
    if (!active) return;
    const targets =
      state.masterLayerEdit === true || hasMultiLayerSelection() ? getLayerEditTargets() : [active];
    for (const layer of targets) {
      ensureLayerEffectState(layer);
      layer.sprite.imageDataUrl = '';
      layer.sprite.imageName = '';
    }
    syncGpuLineFxUI(active);
    requestMainCanvasRender();
  });

  const updateWebStateFromUI = () => {
    const active = getActiveEffectLayer();
    if (!active) return;
    const web = getLayerWebConfig(active);
    web.style = ['web', 'laser', 'spiderSun'].includes(document.getElementById('webStyle')?.value)
      ? document.getElementById('webStyle').value
      : 'web';
    web.inside = document.getElementById('webInside')?.checked === true;
    web.outsideStraight = document.getElementById('webOutsideStraight')?.checked === true;
    web.outsideArc = document.getElementById('webOutsideArc')?.checked === true;

    web.region = web.inside
      ? web.outsideStraight || web.outsideArc
        ? 'combined'
        : 'inside'
      : web.outsideStraight || web.outsideArc
        ? 'outside'
        : 'inside';
    web.placementMode = ['corners', 'selfIntersection', 'selfIntersectionCorridor'].includes(
      document.getElementById('webPlacementMode')?.value,
    )
      ? document.getElementById('webPlacementMode').value
      : 'selfIntersection';
    web.oscillating = document.getElementById('webOscillating')?.checked === true;
    {
      const v = Number(document.getElementById('webOscillationStrength')?.value);
      web.oscillationStrength = Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 10;
    }
    {
      const v = Number(document.getElementById('webOscillationStrengthMultiplier')?.value);
      web.oscillationStrengthMultiplier = Number.isFinite(v) ? Math.max(0.015625, Math.min(64, v)) : 1;
    }
    {
      const v = Number(document.getElementById('webOscillationMultiplier')?.value);
      web.oscillationMultiplier = Number.isFinite(v) ? Math.max(0.015625, Math.min(64, v)) : 1;
    }
    web.angleThreshold = Math.max(
      5,
      Math.min(175, Number(document.getElementById('webAngleThreshold')?.value) || 60),
    );
    web.width = Math.max(0.1, Math.min(4, Number(document.getElementById('webWidth')?.value) || 0.6));
    web.widthRelative = document.getElementById('webWidthRelative')?.checked === true;
    web.widthPercent = Math.max(
      1,
      Math.min(400, Number(document.getElementById('webWidthPercent')?.value) || 40),
    );
    web.matchLineColor = document.getElementById('webMatchLineColor')?.checked === true;
    web.color = document.getElementById('webColor')?.value || '#ffffff';
    web.secondaryColor = document.getElementById('webSecondaryColor')?.value || '#00ffff';
    web.sunDegrees = Math.max(5, Math.min(90, Number(document.getElementById('webSunDegrees')?.value) || 20));
    web.distance = Math.max(0, Math.min(100, Number(document.getElementById('webDistance')?.value) || 30));
    web.depthMultiplier = Math.max(0, Number(document.getElementById('webDepthMultiplier')?.value) || 0);
    web.spacing = Math.max(2, Math.min(40, Number(document.getElementById('webSpacing')?.value) || 10));
    web.angleVariation = Math.max(
      0,
      Math.min(30, Number(document.getElementById('webAngleVariation')?.value) || 0),
    );
    markLayerEffectChanged(active, 'web-ui');
    if (state.masterLayerEdit === true || hasMultiLayerSelection()) {
      for (const layer of getLayerEditTargets()) {
        if (layer === active) continue;
        ensureLayerEffectState(layer);
        layer.web = cloneEffectConfig(web);
        markLayerEffectChanged(layer, 'web-ui');
      }
    }
    syncWebOutlineUI();
    requestMainCanvasRender();
  };
  [
    'webStyle',
    'webInside',
    'webOutsideStraight',
    'webOutsideArc',
    'webPlacementMode',
    'webOscillating',
    'webOscillationStrength',
    'webOscillationStrengthMultiplier',
    'webOscillationMultiplier',
    'webAngleThreshold',
    'webWidth',
    'webWidthRelative',
    'webWidthPercent',
    'webMatchLineColor',
    'webColor',
    'webSecondaryColor',
    'webSunDegrees',
    'webDistance',
    'webDepthMultiplier',
    'webSpacing',
    'webAngleVariation',
  ].forEach((id) => {
    document.getElementById(id)?.addEventListener('input', updateWebStateFromUI);
    document.getElementById(id)?.addEventListener('change', updateWebStateFromUI);
  });
  document.getElementById('webType')?.addEventListener('change', (e) => {
    queueWebSwitchForNextMorph({ type: e.target.value === 'rounding' ? 'rounding' : 'bevel' });
  });
  const updateLineOutlineFromUI = () => {
    state.lineOutline.enabled = document.getElementById('paramLineOutlineEnabled')?.checked === true;
    state.lineOutline.color = document.getElementById('paramLineOutlineColor')?.value || '#ffffff';
    const raw =
      document.getElementById('paramLineOutlineWidth')?.value ??
      document.getElementById('numLineOutlineWidth')?.value;
    state.lineOutline.width = Math.max(
      0.5,
      Math.min(state.lineOutline.style !== 'classic' ? 30 : 12, Number(raw) || 1.5),
    );
    const selected = ['outer', 'inner', 'median'].find(
      (mode) => document.getElementById(`paramLineOutline${mode[0].toUpperCase() + mode.slice(1)}`)?.checked,
    );
    state.lineOutline.mode = selected || state.lineOutline.mode || 'outer';
    syncWebOutlineUI();
    requestMainCanvasRender();
  };
  document.getElementById('paramLineOutlineStyle')?.addEventListener('change', (e) => {
    state.lineOutline.style = ['saiyan', 'drip', 'mountain'].includes(e.target.value)
      ? e.target.value
      : 'classic';
    if (state.lineOutline.style !== 'classic') {
      if (state.lineOutline.width < 5) state.lineOutline.width = 5;
      // Give the new style a warm default without overriding custom colours.
      if (String(state.lineOutline.color || '').toLowerCase() === '#ffffff')
        state.lineOutline.color = '#ffcc43';
    }
    window.somataOutlineSyncAnimation?.();
    syncWebOutlineUI();
    requestMainCanvasRender();
  });
  document.getElementById('paramLineOutlineAuraSpeed')?.addEventListener('input', (e) => {
    state.lineOutline.auraSpeed = Math.max(0, Math.min(200, Math.round(Number(e.target.value) || 0)));
    window.somataOutlineSyncAnimation?.();
    syncWebOutlineUI();
    requestMainCanvasRender();
  });
  const outlineMult = (id, key, min, max) =>
    document.getElementById(id)?.addEventListener('input', (e) => {
      const n = Number(e.target.value);
      if (Number.isFinite(n)) state.lineOutline[key] = Math.max(min, Math.min(max, n));
      window.somataOutlineSyncAnimation?.();
      syncWebOutlineUI();
      requestMainCanvasRender();
    });
  outlineMult('paramLineOutlineWidthMultiplier', 'widthMultiplier', 0.015625, 64);
  outlineMult('paramLineOutlineAuraSpeedMultiplier', 'auraSpeedMultiplier', 0, 64);
  outlineMult('paramLineOutlineAuraSpan', 'auraSpan', 0, 200);
  outlineMult('paramLineOutlineAuraSpanMultiplier', 'auraSpanMultiplier', 0.015625, 64);
  document.getElementById('paramLineOutlineEnabled')?.addEventListener('change', () => {
    updateLineOutlineFromUI();
    window.somataOutlineSyncAnimation?.();
  });
  document.getElementById('paramLineOutlineLayerCount')?.addEventListener('input', (e) => {
    const max = Math.max(1, (state.layers || []).length);
    state.lineOutline.layerCount = Math.max(0, Math.min(max, Math.round(Number(e.target.value) || 0)));
    syncWebOutlineUI();
    requestMainCanvasRender();
  });
  document.getElementById('paramLineOutlineColor')?.addEventListener('input', updateLineOutlineFromUI);
  const bindOutlineWidth = (id) =>
    document.getElementById(id)?.addEventListener('input', (e) => {
      const v = Math.max(
        0.5,
        Math.min(state.lineOutline.style !== 'classic' ? 30 : 12, Number(e.target.value) || 1.5),
      );
      state.lineOutline.width = v;
      const r = document.getElementById('paramLineOutlineWidth'),
        n = document.getElementById('numLineOutlineWidth');
      if (r) r.value = v;
      if (n) n.value = v;
      syncWebOutlineUI();
      requestMainCanvasRender();
    });
  bindOutlineWidth('paramLineOutlineWidth');
  bindOutlineWidth('numLineOutlineWidth');
  const outlineModeIds = {
    paramLineOutlineOuter: 'outer',
    paramLineOutlineInner: 'inner',
    paramLineOutlineMedian: 'median',
  };
  for (const [id, mode] of Object.entries(outlineModeIds))
    document.getElementById(id)?.addEventListener('change', (e) => {
      if (!e.target.checked) {
        e.target.checked = true;
        return;
      }
      state.lineOutline.mode = mode;
      for (const other of Object.keys(outlineModeIds)) {
        const el = document.getElementById(other);
        if (el) el.checked = other === id;
      }
      requestMainCanvasRender();
    });
  const updateLampStateFromUI = () => {
    const targets = getLampConfigTargets();
    if (!targets.length) return;
    const sample = targets[0];
    const patch = {
      color: document.getElementById('lampColor')?.value || sample.color,
      webgl: true,
      brightness: Math.max(
        0,
        Math.min(
          200,
          Number.isFinite(Number(document.getElementById('lampBrightness')?.value))
            ? Number(document.getElementById('lampBrightness')?.value)
            : 100,
        ),
      ),
      radius: Math.max(1, Number(document.getElementById('lampRadius')?.value) || 50),
      radiusMultiplier: Math.max(0, Number(document.getElementById('lampRadiusMultiplier')?.value) || 0),
      softness: Math.max(
        0,
        Math.min(
          150,
          Number.isFinite(Number(document.getElementById('lampSoftness')?.value))
            ? Number(document.getElementById('lampSoftness')?.value)
            : 100,
        ),
      ),
      softnessMultiplier: Math.max(0, Number(document.getElementById('lampSoftnessMultiplier')?.value) || 0),
      blendMode: document.getElementById('lampBlendMode')?.value || 'lighter',
      type: document.getElementById('lampType')?.value || 'whiteCore',
      density: Math.max(0, Math.min(200, Number(document.getElementById('lampDensity')?.value) ?? 100)),
      densityMultiplier: Math.max(0, Number(document.getElementById('lampDensityMultiplier')?.value) || 0),
      scatter: Math.max(0, Math.min(100, Number(document.getElementById('lampScatter')?.value) || 0)),
      scatterMultiplier: Math.max(0, Number(document.getElementById('lampScatterMultiplier')?.value) || 0),
      sizeVariation: Math.max(
        0,
        Math.min(100, Number(document.getElementById('lampSizeVariation')?.value) ?? 0),
      ),
      sizeVariationMultiplier: Math.max(
        0,
        Number(document.getElementById('lampSizeVariationMultiplier')?.value) || 0,
      ),
      brightnessVariation: Math.max(
        0,
        Math.min(100, Number(document.getElementById('lampBrightnessVariation')?.value) ?? 0),
      ),
      brightnessVariationMultiplier: Math.max(
        0,
        Number(document.getElementById('lampBrightnessVariationMultiplier')?.value) || 0,
      ),
      adaptiveBrightness: document.getElementById('lampAdaptiveBrightness')?.checked !== false,
      extinguishIntersections: document.getElementById('lampExtinguishIntersections')?.checked === true,
      intersectionDistance: Number(document.getElementById('lampIntersectionDistance')?.value ?? 50),
      adaptiveAdjustBrightness: document.getElementById('lampAdaptiveAdjustBrightness')?.checked === true,
      adaptiveStrength: Math.max(
        0,
        Math.min(100, Number(document.getElementById('lampAdaptiveStrength')?.value) ?? 100),
      ),
      adaptiveStrengthMultiplier: Math.max(
        0,
        Number(document.getElementById('lampAdaptiveStrengthMultiplier')?.value) || 0,
      ),
      adaptiveExponent: snapLampAdaptiveExponent(document.getElementById('lampAdaptiveExponent')?.value),
      adaptiveAutoExponent: document.getElementById('lampAdaptiveAutoExponent')?.checked === true,
      adaptiveFadeSec: Math.max(0, Number(document.getElementById('lampAdaptiveFadeSec')?.value) || 0),
      morphEnabled: false,
      morphSize: 0,
      morphBrightness: 0,
      calmMode: false,
    };
    const contour = document.getElementById('lampSnapToContour')?.checked !== false;
    for (const cfg of targets) {
      Object.assign(cfg, patch);
      withLampConfig(cfg, () => setLampContourAttachmentEnabled(contour));
    }
    syncLampSettingsUI();
    requestMainCanvasRender();
  };
  [
    'lampColor',
    'lampBrightness',
    'lampRadius',
    'lampRadiusMultiplier',
    'lampSoftness',
    'lampSoftnessMultiplier',
    'lampBlendMode',
    'lampType',
    'lampDensity',
    'lampDensityMultiplier',
    'lampScatter',
    'lampScatterMultiplier',
    'lampSizeVariation',
    'lampSizeVariationMultiplier',
    'lampBrightnessVariation',
    'lampBrightnessVariationMultiplier',
    'lampAdaptiveStrength',
    'lampAdaptiveStrengthMultiplier',
    'lampIntersectionDistance',
    'lampAdaptiveExponent',
    'lampAdaptiveFadeSec',
    'lampMorphSize',
    'lampMorphBrightness',
  ].forEach((id) => document.getElementById(id)?.addEventListener('input', updateLampStateFromUI));
  [
    'lampAdaptiveBrightness',
    'lampExtinguishIntersections',
    'lampAdaptiveAdjustBrightness',
    'lampAdaptiveAutoExponent',
    'lampMorphEnabled',
  ].forEach((id) => document.getElementById(id)?.addEventListener('change', updateLampStateFromUI));
  // Двухпозиционный переключатель: что подстраивает адаптация. Состояние хранит скрытая галочка
  // lampAdaptiveAdjustBrightness (true — свет/яркость, false — размер/радиус).
  document.querySelectorAll('[data-lamp-adaptive-channel]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const box = document.getElementById('lampAdaptiveAdjustBrightness');
      if (!box) return;
      box.checked = btn.dataset.lampAdaptiveChannel === 'light';
      updateLampStateFromUI();
    }),
  );
  document.getElementById('lampFreezeLight')?.addEventListener('change', (e) => {
    const enabled = e.target.checked === true;
    state.lamps.freezeLight = enabled;
    for (const cfg of getLampConfigTargets()) cfg.freezeLight = enabled;
    try {
      LampGPURenderer?.resetFreezeTrail?.();
    } catch (error) {
      noteSuppressedError('ui/preset-random-morph#bindPresetRandomMorphControls', error);
    }
    syncLampSettingsUI();
    requestMainCanvasRender();
  });
  document.getElementById('lampFreezeTailSec')?.addEventListener('input', (e) => {
    const sec = Math.max(0.05, Math.min(30, Number(e.target.value) || 1.5));
    state.lamps.freezeTailSec = sec;
    for (const cfg of getLampConfigTargets()) cfg.freezeTailSec = sec;
    // Preserve the existing history: the renderer slews the effective tail length toward this target.
    syncLampSettingsUI();
    requestMainCanvasRender();
  });
  document.getElementById('lampFreezeIntensity')?.addEventListener('input', (e) => {
    const value = Math.max(0, Math.min(100, Math.round(Number(e.target.value) || 0)));
    state.lamps.freezeIntensity = value;
    for (const cfg of getLampConfigTargets()) cfg.freezeIntensity = value;
    syncLampSettingsUI();
    requestMainCanvasRender();
  });
  document.getElementById('lampFreezeHardness')?.addEventListener('input', (e) => {
    const value = Math.max(0, Math.min(100, Number(e.target.value) || 0));
    state.lamps.freezeHardness = value;
    for (const cfg of getLampConfigTargets()) cfg.freezeHardness = value;
    // Hardness changes the live envelope without destroying the accumulated trail.
    syncLampSettingsUI();
    requestMainCanvasRender();
  });
  document.getElementById('lampFreezeColorMode')?.addEventListener('change', (e) => {
    const value = ['lamp', 'line', 'fixed', 'hue'].includes(e.target.value) ? e.target.value : 'lamp';
    state.lamps.freezeColorMode = value;
    for (const cfg of getLampConfigTargets()) cfg.freezeColorMode = value;
    // Recolour existing history in-place on the next feedback frame.
    syncLampSettingsUI();
    requestMainCanvasRender();
  });
  document.getElementById('lampFreezeColor')?.addEventListener('input', (e) => {
    const value = String(e.target.value || '#00ffcc');
    state.lamps.freezeColor = value;
    for (const cfg of getLampConfigTargets()) cfg.freezeColor = value;
    requestMainCanvasRender();
  });
  const applyFreezeHueDegrees = (raw) => {
    const value = Math.max(0, Math.min(180, Number(raw) || 0));
    state.lamps.freezeHueDegrees = value;
    for (const cfg of getLampConfigTargets()) cfg.freezeHueDegrees = value;
    syncLampSettingsUI();
    requestMainCanvasRender();
  };
  document
    .getElementById('lampFreezeHueDegrees')
    ?.addEventListener('input', (e) => applyFreezeHueDegrees(e.target.value));
  document
    .getElementById('lampFreezeHueDegreesNumber')
    ?.addEventListener('change', (e) => applyFreezeHueDegrees(e.target.value));
  document.getElementById('lampFreezeChromatic')?.addEventListener('change', (e) => {
    const value = e.target.checked === true;
    state.lamps.freezeChromatic = value;
    for (const cfg of getLampConfigTargets()) cfg.freezeChromatic = value;
    syncLampSettingsUI();
    requestMainCanvasRender();
  });
  document.getElementById('lampFreezeChromaticColor')?.addEventListener('input', (e) => {
    const value = String(e.target.value || '#22d3ee');
    state.lamps.freezeChromaticColor = value;
    for (const cfg of getLampConfigTargets()) cfg.freezeChromaticColor = value;
    requestMainCanvasRender();
  });
  document.getElementById('lampFreezeRain')?.addEventListener('change', (e) => {
    const enabled = e.target.checked === true;
    state.lamps.freezeRain = enabled;
    for (const cfg of getLampConfigTargets()) cfg.freezeRain = enabled;
    try {
      LampGPURenderer?.resetFreezeRain?.();
    } catch (error) {
      noteSuppressedError('ui/preset-random-morph#bindPresetRandomMorphControls', error);
    }
    syncLampSettingsUI();
    requestMainCanvasRender();
  });
  const applyFreezeRainDegrees = (raw) => {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return;
    const value = ((parsed % 360) + 360) % 360;
    state.lamps.freezeRainDirectionVersion = 2;
    state.lamps.freezeRainDegrees = value;
    for (const cfg of getLampConfigTargets()) {
      cfg.freezeRainDirectionVersion = 2;
      cfg.freezeRainDegrees = value;
    }
    try {
      LampGPURenderer?.resetFreezeRain?.();
    } catch (error) {
      noteSuppressedError('ui/preset-random-morph#applyFreezeRainDegrees', error);
    }
    syncLampSettingsUI();
    requestMainCanvasRender();
  };
  document
    .getElementById('lampFreezeRainDegrees')
    ?.addEventListener('input', (e) => applyFreezeRainDegrees(e.target.value));
  document
    .getElementById('lampFreezeRainDegreesNumber')
    ?.addEventListener('change', (e) => applyFreezeRainDegrees(e.target.value));
  document.getElementById('lampFreezeRainSource')?.addEventListener('change', (e) => {
    const value = e.target.value === 'lamp' ? 'lamp' : 'core';
    state.lamps.freezeRainSource = value;
    for (const cfg of getLampConfigTargets()) cfg.freezeRainSource = value;
    try {
      LampGPURenderer?.resetFreezeRain?.();
    } catch (error) {
      noteSuppressedError('ui/preset-random-morph#bindPresetRandomMorphControls', error);
    }
    syncLampSettingsUI();
    requestMainCanvasRender();
  });
  document.getElementById('lampFreezeRainSpeed')?.addEventListener('input', (e) => {
    const value = Math.max(0, Math.min(100, Number(e.target.value) || 0));
    state.lamps.freezeRainSpeed = value;
    for (const cfg of getLampConfigTargets()) cfg.freezeRainSpeed = value;
    try {
      LampGPURenderer?.resetFreezeRain?.();
    } catch (error) {
      noteSuppressedError('ui/preset-random-morph#bindPresetRandomMorphControls', error);
    }
    syncLampSettingsUI();
    requestMainCanvasRender();
  });
  document.getElementById('lampFreezeRainTailSec')?.addEventListener('input', (e) => {
    const sec = Math.max(0.05, Math.min(30, Number(e.target.value) || 1.5));
    state.lamps.freezeRainTailSec = sec;
    for (const cfg of getLampConfigTargets()) cfg.freezeRainTailSec = sec;
    try {
      LampGPURenderer?.resetFreezeRain?.();
    } catch (error) {
      noteSuppressedError('ui/preset-random-morph#bindPresetRandomMorphControls', error);
    }
    syncLampSettingsUI();
    requestMainCanvasRender();
  });
  document.getElementById('lampFreezeRainHardness')?.addEventListener('input', (e) => {
    const value = Math.max(0, Math.min(100, Number(e.target.value) || 0));
    state.lamps.freezeRainHardness = value;
    for (const cfg of getLampConfigTargets()) cfg.freezeRainHardness = value;
    try {
      LampGPURenderer?.resetFreezeRain?.();
    } catch (error) {
      noteSuppressedError('ui/preset-random-morph#bindPresetRandomMorphControls', error);
    }
    syncLampSettingsUI();
    requestMainCanvasRender();
  });
  document.getElementById('testMorphDuration')?.addEventListener('input', () => queueMicrotask(syncLampSettingsUI));
  document.getElementById('lampDurationLinked')?.addEventListener('change', (e) => {
    for (const cfg of getLampConfigTargets()) cfg.cornerInertiaLinked = e.target.checked;
    syncLampSettingsUI();
    requestMainCanvasRender();
  });
  document.getElementById('lampCornerInertia')?.addEventListener('change', (e) => {
    for (const cfg of getLampConfigTargets())
      cfg.cornerInertiaSec = Math.max(0, Math.min(15, Number(e.target.value) || 0));
    syncLampSettingsUI();
    requestMainCanvasRender();
  });
  document.getElementById('lampSnapToContour')?.addEventListener('change', () => {
    lampMotionRuntime.calm.clear();
    lampMotionRuntime.snap.clear();
    lampMotionRuntime.profileAttach?.clear?.();
    lampMotionRuntime.corners.clear();
    lampAnchorCache.delete(getActiveLayer?.());
    updateLampStateFromUI();
  });

  document.querySelectorAll('[data-lamp-position]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const m = ['key', 'corners', 'arbitrary'].includes(btn.dataset.lampPosition)
        ? btn.dataset.lampPosition
        : 'key';
      for (const cfg of getLampConfigTargets()) cfg.positionMode = m;
      lampMotionRuntime.calm.clear();
      lampMotionRuntime.snap.clear();
      lampMotionRuntime.profileAttach?.clear?.();
      lampMotionRuntime.corners.clear();
      lampAnchorCache.delete(getActiveLayer?.());
      syncLampSettingsUI();
      requestMainCanvasRender();
    }),
  );
  document.querySelectorAll('[data-lamp-motion]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const m = ['linear', 'key'].includes(btn.dataset.lampMotion)
        ? btn.dataset.lampMotion
        : 'linear';
      for (const cfg of getLampConfigTargets()) cfg.morphMotionMode = m;
      lampMotionRuntime.snap.clear();
      lampMotionRuntime.profileAttach?.clear?.();
      lampMotionRuntime.corners.clear();
      lampMotionRuntime.blueMorph.clear();
      lampMotionRuntime.linearGates.clear();
      syncLampSettingsUI();
      requestMainCanvasRender();
    }),
  );
  document.getElementById('lampMorphInertia')?.addEventListener('input', (e) => {
    const v = Math.round(Math.max(-100, Math.min(100, Number(e.target.value) || 0)) / 5) * 5;
    for (const cfg of getLampConfigTargets()) cfg.morphInertia = v;
    syncLampSettingsUI();
    requestMainCanvasRender();
  });
  document.getElementById('lampOuterHaloBrightness').addEventListener('input', (event) => {
    const value = event.target.valueAsNumber;
    for (const cfg of getLampConfigTargets()) cfg.outerHaloBrightness = value;
    document.getElementById('lampOuterHaloValue').textContent = value + '%';
    requestMainCanvasRender();
  });
  document.getElementById('lampOuterHaloSize').addEventListener('input', (event) => {
    const value = event.target.valueAsNumber;
    for (const cfg of getLampConfigTargets()) cfg.outerHaloSize = value;
    document.getElementById('lampOuterHaloSizeValue').textContent = value + '%';
    requestMainCanvasRender();
  });
  document.querySelectorAll('[data-lamp-appearance]').forEach((btn) =>
    btn.addEventListener('click', () => {
      for (const cfg of getLampConfigTargets()) cfg.appearance = btn.dataset.lampAppearance;
      syncLampSettingsUI();
      requestMainCanvasRender();
    }),
  );
  document.querySelectorAll('[data-lamp-color-mode]').forEach((btn) =>
    btn.addEventListener('click', () => {
      for (const cfg of getLampConfigTargets()) {
        cfg.colorMode = btn.dataset.lampColorMode;
        cfg.matchLineColor = cfg.colorMode === 'line';
        cfg.rainbow = cfg.colorMode === 'rainbow';
      }
      syncLampSettingsUI();
      requestMainCanvasRender();
    }),
  );
  document.querySelectorAll('[data-lamp-color]').forEach((sw) =>
    sw.addEventListener('click', () => {
      for (const cfg of getLampConfigTargets()) {
        cfg.color = sw.dataset.lampColor || cfg.color;
        cfg.colorMode = 'selected';
        cfg.matchLineColor = false;
        cfg.rainbow = false;
      }
      const el = document.getElementById('lampColor');
      if (el) el.value = getActiveLampConfig()?.color || '#ffe600';
      syncLampSettingsUI();
      requestMainCanvasRender();
    }),
  );

  const MorphUI = createMorphUIModule({ MorphTargets, MorphPlayback });
}
function bindRandomPanelAndMorphRebaseHooks(bindingContext) {
  const getActiveLayer = bindingContext.getActiveLayer;
  document.getElementById('btnRandomSettings').addEventListener('click', (e) => {
    e.stopPropagation();
    const panel = document.getElementById('randomSettingsPanel');
    const opening = panel.classList.contains('hidden');
    panel.classList.toggle('hidden', !opening);
    document.getElementById('morphSettingsPanel')?.classList.add('hidden');
    if (opening) positionFloatingPanelNearTrigger?.(panel, e.currentTarget);
  });
  document.getElementById('randomSettingsPanel').addEventListener('click', (e) => e.stopPropagation());
  document.addEventListener('click', () =>
    document.getElementById('randomSettingsPanel')?.classList.add('hidden'),
  );

  const randomOptionMap = {
    randomByShape: 'byShape',
    randomOnlyLine: 'onlyLine',
    randomByVertices: 'byVertices',
    randomBySteps: 'bySteps',
    randomByRounding: 'byRounding',
    randomBySize: 'bySize',
    randomByColor: 'byColor',
    randomBySpiralLayers: 'bySpiralLayers',
  };
  Object.entries(randomOptionMap).forEach(([id, key]) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', (e) => {
      state.randomOptions[key] = e.target.checked;
      if (key === 'onlyLine' && e.target.checked) {
        state.randomOptions.byShape = false;
        const shapeEl = document.getElementById('randomByShape');
        if (shapeEl) shapeEl.checked = false;
      } else if (key === 'byShape' && e.target.checked) {
        state.randomOptions.onlyLine = false;
        const lineEl = document.getElementById('randomOnlyLine');
        if (lineEl) lineEl.checked = false;
      }
      if (key === 'byColor') syncPlaylistPaletteSelectionUI();
    });
  });

  const syncRandomSpiralLayerRange = (changedId = '') => {
    let lo = Math.max(
      0,
      Math.min(8, Math.round(Number(document.getElementById('randomSpiralLayersMin')?.value) || 0)),
    );
    let hi = Math.max(
      0,
      Math.min(8, Math.round(Number(document.getElementById('randomSpiralLayersMax')?.value) || 0)),
    );
    if (lo > hi) {
      if (changedId === 'randomSpiralLayersMin') hi = lo;
      else lo = hi;
    }
    state.randomOptions.spiralLayersMin = lo;
    state.randomOptions.spiralLayersMax = hi;
    const a = document.getElementById('randomSpiralLayersMin'),
      b = document.getElementById('randomSpiralLayersMax');
    if (a) a.value = lo;
    if (b) b.value = hi;
  };
  document
    .getElementById('randomSpiralLayersMin')
    ?.addEventListener('change', () => syncRandomSpiralLayerRange('randomSpiralLayersMin'));
  document
    .getElementById('randomSpiralLayersMax')
    ?.addEventListener('change', () => syncRandomSpiralLayerRange('randomSpiralLayersMax'));

  const sidebar = document.getElementById('settingsSidebar') || document.querySelector('aside');
  const beginSidebarMorphRebase = (e) => {
    // A manual spiral-order edit has its OWN clock and geometry
    // rail. The generic capture-phase sidebar transaction must not
    // enqueue a deferred Blue rebase for this one control.
    if (e.target?.closest?.('#paramSpiralOrder')) return;
    if (!runtimeState.morph.active || e.target.closest?.('#profileCanvas')) return;
    const source = state.layers.find((l) => l.id === state.activeLayerId);
    if (!source) return;
    if (!morphSidebarRebaseRuntime.queued) {
      morphSidebarRebaseRuntime.active = true;
      morphSidebarRebaseRuntime.queued = true;
      morphSidebarRebaseRuntime.pending = false;
      morphSidebarRebaseRuntime.cornerPreviewOnly = false;
      morphSidebarRebaseRuntime.before = masterLayerSnapshot(source);
      morphSidebarRebaseRuntime.sourceId = source.id || null;
      morphSidebarRebaseRuntime.eventType = String(e.type || '');
      morphSidebarRebaseRuntime.targetId = String(e.target?.id || e.target?.dataset?.contourMode || '');
      queueMicrotask(() =>
        queueMicrotask(() => {
          const tx = morphSidebarRebaseRuntime;
          const current =
            state.layers.find((l) => l.id === tx.sourceId) ||
            state.layers.find((l) => l.id === state.activeLayerId) ||
            null;
          const after = current ? masterLayerSnapshot(current) : {};
          const changed = current ? collectMasterChangedPaths(tx.before || {}, after) : [];

          if (
            current &&
            changed.some((path) => path === 'profileMode' || path === 'profileNodes') &&
            contourModeIsSpiral(getContourMode(current))
          ) {
            for (const path of ['spiralEnabled', 'spiralClosed', 'spiralOrder', 'closedLoop'])
              if (!changed.includes(path)) changed.push(path);
          }
          // The sidebar capture listener performs a generic deferred
          // rebase for any authored change. A safe Local↔Classic
          // preview already updated both live render carriers and
          // invalidated their geometry versions; it must not rebase
          // Blue again during this deferred transaction. Never skip
          // if another property or a real rebase was requested.
          const previewOnly =
            tx.cornerPreviewOnly === true &&
            !tx.pending &&
            changed.length === 1 &&
            changed[0] === 'roundingCornerType';
          const shouldRebase = !previewOnly && (tx.pending || changed.length > 0);
          tx.active = false;
          tx.queued = false;
          tx.pending = false;
          tx.cornerPreviewOnly = false;
          tx.before = null;
          tx.sourceId = null;
          if (shouldRebase && runtimeState.morph.active) {
            activeRebaseMorphing({ preservePaths: changed, fromSidebarTransaction: true });
            requestMainCanvasRender();
          }
        }),
      );
    }
  };
  ['input', 'change', 'click'].forEach((type) =>
    sidebar?.addEventListener(type, beginSidebarMorphRebase, true),
  );
}

export { bindPresetRandomMorphControls, bindRandomPanelAndMorphRebaseHooks };
