// Тип морфинга (единый режим) и правила спирального морфа.
import '../ui/geometry-n-control.js'; // initialisation order: this module runs after it
import {
  getEffectiveSpiralOrder,
  getEffectiveSpiralStep,
  isSpiralLayer,
} from '../geometry/spiral/order-params.js';
import { runtimeState, state } from '../core/state.js';
import { WebGPUSpiralBezierMorphRenderer } from '../gpu/spiral-bezier-morph-renderer.js';
import { noteSuppressedError } from '../core/suppressed-errors.js';

// Типы морфинга разнесены (как в 13.2): `mode`/`unifiedMode` — тип для многоугольника
// (порядок 0), `spiralMode` — тип для спирали (порядок != 0). Слой, у которого хотя бы
// один конец пары — спираль, морфится по типу спирали, остальные — по типу многоугольника.
// Это позволяет, например, перейти от топологического преобразования многоугольника
// к непрерывному (согласованному) морфингу спирали.
// Движок по-прежнему читает `state.morph.mode/unifiedMode`; на время обработки слоя
// `withLayerMorphMode` подменяет их значением, выбранным по паре слоя.
const UNIFIED_MORPH_KEYS = Object.freeze([
  'topology',
  'circleSlide',
  'fade',
  'light',
  'phaseCircle',
  'coordinated',
  'coordinatedFromCenter',
]);
// «Слайдшоу» и Fade управляют временем всего кадра, а не геометрией одного слоя:
// отдельного типа для спирали у них нет, спираль следует типу многоугольника.
const FRAME_LEVEL_MORPH_MODES = Object.freeze(['light', 'fade']);
const SPIRAL_MORPH_MODE_KEYS = Object.freeze(
  UNIFIED_MORPH_KEYS.filter((key) => !FRAME_LEVEL_MORPH_MODES.includes(key)),
);
const UNIFIED_SPIRAL_TRANSPORTS = new Set(['phaseCircle', 'coordinated', 'coordinatedFromCenter']);
// Глубина и исходный тип многоугольника внешней области: внутри области
// `state.morph.mode` уже подменён, а тип многоугольника нужен как был.
let layerModeDepth = 0;
let layerModePolygon = null;
function getPolygonMorphMode() {
  if (layerModeDepth > 0 && layerModePolygon) return layerModePolygon;
  const m = state.morph || {},
    migrate = SomataMorphRegistry.migrate;
  m.unifiedMode = migrate(m.unifiedMode);
  m.mode = migrate(m.mode);
  return UNIFIED_MORPH_KEYS.includes(m.unifiedMode)
    ? m.unifiedMode
    : UNIFIED_MORPH_KEYS.includes(m.mode)
      ? m.mode
      : 'coordinated';
}
// Тип морфинга, который видит движок: внутри области слоя — выбранный для слоя,
// снаружи (интерфейс, сохранение) — тип многоугольника.
function getUnifiedMorphMode() {
  if (layerModeDepth > 0) {
    const current = SomataMorphRegistry.migrate(state.morph?.unifiedMode);
    if (UNIFIED_MORPH_KEYS.includes(current)) return current;
  }
  return getPolygonMorphMode();
}
function normalizeSpiralMorphMode(value, fallback = 'coordinated') {
  const migrated = SomataMorphRegistry.migrate(value);
  return SPIRAL_MORPH_MODE_KEYS.includes(migrated) ? migrated : fallback;
}
function getSpiralMorphMode() {
  const polygon = getPolygonMorphMode();
  // Слайдшоу и Fade — кадровые режимы: они общие для многоугольника и спирали.
  if (FRAME_LEVEL_MORPH_MODES.includes(polygon)) return polygon;
  const m = state.morph || {};
  // Старые проекты и сборки хранили один общий тип: спираль следует за многоугольником.
  const stored = normalizeSpiralMorphMode(m.spiralMode, null);
  return stored || normalizeSpiralMorphMode(polygon, 'coordinated');
}
function setUnifiedMorphMode(value) {
  const replacement = SomataMorphRegistry.migrate(value);
  const next = UNIFIED_MORPH_KEYS.includes(replacement) ? replacement : 'coordinated';
  const m = state.morph;
  // Тип для многоугольника (порядок 0). Для спирали — setSpiralMorphMode.
  m.unifiedMode = next;
  m.mode = next;
  if (layerModeDepth === 0) syncSpiralTransportFields();
  return true;
}
function setSpiralMorphMode(value) {
  const next = normalizeSpiralMorphMode(value, 'coordinated');
  state.morph.spiralMode = next;
  syncSpiralTransportFields();
  return next;
}
function syncSpiralTransportFields() {
  const m = state.morph;
  if (!m) return;
  const spiral = getSpiralMorphMode();
  m.spiralMorphType = UNIFIED_SPIRAL_TRANSPORTS.has(spiral) ? spiral : 'torn';
  m.preserveSpiralContinuity = UNIFIED_SPIRAL_TRANSPORTS.has(spiral);
}
// Слой морфится по типу спирали, если спираль есть на любом конце его пары.
function pairInvolvesSpiral(layerIndex, pair = null) {
  // Явная пара (источник/цель) главнее: на границе цикла отрисовочные копии
  // ещё от прошлого цикла, а канонический слой уже содержит новую цель.
  if (pair && (pair.sourceLayer || pair.targetLayer))
    return [pair.sourceLayer, pair.targetLayer].some((candidate) => candidate && isSpiralLayer(candidate));
  const rt = runtimeState?.morph;
  const layer = state.layers?.[layerIndex];
  // Во время синего морфинга пару задают его конечные слои; вне его — сам слой.
  const live =
    rt?.active === true ? [rt.renderSourceLayers?.[layerIndex], rt.renderTargetLayers?.[layerIndex]] : [];
  const ends = live.some(Boolean) ? live : [layer];
  return ends.some((candidate) => candidate && isSpiralLayer(candidate));
}
function getMorphModeForLayer(layerIndex, pair = null) {
  return pairInvolvesSpiral(layerIndex, pair) ? getSpiralMorphMode() : getPolygonMorphMode();
}
// Выполняет fn с типом морфинга слоя. Внутри fn движок, читающий `state.morph.mode`,
// видит тип многоугольника или спирали — по паре слоя. Область синхронная, вложенная,
// безопасна к исключениям; если тип совпадает с текущим, подмены нет совсем.
function withLayerMorphMode(layerIndex, fn, pair = null) {
  const m = state.morph;
  if (!m) return fn();
  const outerPolygon = layerModeDepth > 0 ? layerModePolygon : getPolygonMorphMode();
  const want = pairInvolvesSpiral(layerIndex, pair) ? getSpiralMorphMode() : outerPolygon;
  if (layerModeDepth === 0 && want === m.unifiedMode && want === m.mode) return fn();
  const prevMode = m.mode,
    prevUnified = m.unifiedMode,
    prevPolygon = layerModePolygon;
  if (layerModeDepth === 0) layerModePolygon = outerPolygon;
  layerModeDepth++;
  m.mode = want;
  m.unifiedMode = want;
  try {
    return fn();
  } finally {
    m.mode = prevMode;
    m.unifiedMode = prevUnified;
    layerModeDepth--;
    if (layerModeDepth === 0) layerModePolygon = null;
    else layerModePolygon = prevPolygon;
  }
}
window.SomataMorphMode = Object.freeze({
  forLayer: (layerIndex, pair) => getMorphModeForLayer(layerIndex, pair),
  withLayer: withLayerMorphMode,
  polygon: getPolygonMorphMode,
  spiral: getSpiralMorphMode,
});
window.__somataUnifiedMorphState = () => ({
  selected: getPolygonMorphMode(),
  selectedSpiral: getSpiralMorphMode(),
  engineMode: state.morph?.mode,
  transport: state.morph?.spiralMorphType,
  slide: state.morph?.slideType,
  prototypeAvailable: !!window.SomataCoordinatedCarrier,
  coordinatedFromCenterAvailable: true,
});
const SPIRAL_MORPH_TYPES = new Set(['torn', 'phaseCircle', 'coordinated', 'coordinatedFromCenter']);
function normalizeSpiralMorphType(value, legacyPreserve = true) {
  // First named mode uses a genuine Cartesian Spiral rail. Preserve it
  // on save/load instead of silently normalizing it to phaseCircle.
  return value === 'fadeSpiral' ? 'continuous' : SPIRAL_MORPH_TYPES.has(value) ? value : 'phaseCircle';
}
function getSpiralMorphType() {
  const named = getSpiralMorphMode();
  const type = UNIFIED_SPIRAL_TRANSPORTS.has(named) ? named : 'torn';
  if (state.morph) {
    state.morph.spiralMorphType = type;
    state.morph.preserveSpiralContinuity = UNIFIED_SPIRAL_TRANSPORTS.has(type);
  }
  return type;
}
function spiralMorphForcesContinuousRail() {
  const t = getSpiralMorphType();
  return (
    t === 'phase' || t === 'phaseCircle' || t === 'minimalTurn' || SomataMorphRegistry.usesCoordinatedSpine(t)
  );
}
function spiralMorphKeepsContinuity() {
  return spiralMorphForcesContinuousRail();
}
function spiralMorphLocksN() {
  return getSpiralMorphType() === 'phase';
}
function spiralMorphLocksK() {
  return getSpiralMorphType() === 'minimalTurn';
}
function spiralMorphUsesCorridorPhase() {
  return window.SomataMorphRegistry.corridorPhase(getSpiralMorphMode());
}
// 7.6.7: Corridor copies must use the *same instantaneous carrier angle* as the
// retained Spiral renderer.  Reading N/K from the resolved presentation layer is
// insufficient while branch clone/merge is in flight: that layer intentionally stays
// close to canonical integer UI values, while the carrier uses continuous N.  A stale
// N opens every seam and makes Glow look as if it drifts independently of the rail.
// One period resolver for the left Geometry panel and Blue Morph.
// Prefer the exact per-rail Stage10 closure from the active GPU/CPU
// resource; only use the *same* eased endpoint carrier equation before
// the resource is prepared. No integer-N fallback during a morph.
function coordinatedEndpointPeriod(source, target, u) {
  if (!source || !target) return NaN;
  const carrierDelta = (layer) => {
    try {
      const spec =
        typeof __spiroGetSpiralCarrierSpec === 'function' ? __spiroGetSpiralCarrierSpec(layer, 0) : null;
      if (Number.isFinite(Number(spec?.delta))) return Number(spec.delta);
    } catch (error) {
      noteSuppressedError('morph-runtime/morph-mode#carrierDelta', error);
    }
    const n = Math.max(2, Number(layer.N) || 2),
      step = Number(getEffectiveSpiralStep?.(layer) ?? layer.K ?? 1);
    const dir = Number(getEffectiveSpiralOrder?.(layer) ?? layer.spiralOrder ?? 1) < -1e-8 ? -1 : 1;
    return ((2 * Math.PI * step) / n) * dir;
  };
  const a = carrierDelta(source),
    b = carrierDelta(target);
  const t = Math.max(0, Math.min(1, Number(u) || 0)),
    q = t * t * (3 - 2 * t);
  return a + (b - a) * q;
}
window.__somataCoordinatedEndpointPeriod = coordinatedEndpointPeriod;
function getCurrentSpiralMorphCorridorDelta(layer) {
  const manual = layer?.__somataCoordinatedEdit;
  if (manual) {
    const exact = Number(layer.__somataCoordinatedPeriodDelta);
    if (Number.isFinite(exact)) return exact;
    return coordinatedEndpointPeriod(manual.sourceLayer, manual.targetLayer, manual.progress);
  }
  const rt = runtimeState?.morph;
  if (!rt?.active) return NaN;
  const id = String(layer?.__spiroCanonicalId || layer?.id || '');
  let idx = id ? (state.layers || []).findIndex((l) => String(l?.id || '') === id) : -1;
  if (idx < 0 && Array.isArray(rt.frameLayers)) idx = rt.frameLayers.indexOf(layer);
  if (idx < 0) return NaN;
  const s = rt.renderSourceLayers?.[idx] || rt.sourceVisuals?.[idx] || state.layers?.[idx];
  const d = rt.renderTargetLayers?.[idx] || rt.targetVisuals?.[idx] || s;
  if (!s || !d || !(s.spiralEnabled === true || d.spiralEnabled === true || isSpiralLayer?.(layer)))
    return NaN;
  const u = Math.max(
    0,
    Math.min(1, Number.isFinite(Number(rt.geometryT)) ? Number(rt.geometryT) : Number(rt.progress) || 0),
  );
  // Ordinary morph modes preserve 13.2 Corridor phase semantics.
  // Only continuous named transports may use the exact resource period.
  if (!spiralMorphUsesCorridorPhase()) return NaN;
  const transport = getSpiralMorphType();
  if (['phase', 'minimalTurn', 'phaseCircle', 'coordinated', 'coordinatedFromCenter'].includes(transport)) {
    const rec = WebGPUSpiralBezierMorphRenderer?.getResource?.(idx);
    if (rec?.periodSeamEnforced === true) {
      const exact = WebGPUSpiralBezierMorphRenderer.coordinatedPeriodDelta?.(rec, u);
      if (Number.isFinite(exact)) return exact;
    }
    if (SomataMorphRegistry.usesCoordinatedSpine(transport)) return coordinatedEndpointPeriod(s, d, u);
  }
  // Other spiral transports keep their original carrier clock.
  const sn = Math.max(2, Number(s.N) || 2),
    dn = Math.max(2, Number(d.N) || sn);
  const ss = Math.max(1e-9, Number(getEffectiveSpiralStep?.(s) ?? s.spiralStep ?? s.K ?? 1));
  const ds = Math.max(1e-9, Number(getEffectiveSpiralStep?.(d) ?? d.spiralStep ?? d.K ?? ss));
  const n = sn + (dn - sn) * u,
    step = Math.min(Math.max(1, Math.floor(n / 2)), ss + (ds - ss) * u);
  const so = Number(getEffectiveSpiralOrder?.(s) ?? s.spiralOrder ?? 1),
    to = Number(getEffectiveSpiralOrder?.(d) ?? d.spiralOrder ?? so);
  const fromDirection = so < -1e-8 ? -1 : 1,
    toDirection = to < -1e-8 ? -1 : 1;
  const e = u * u * (3 - 2 * u);
  const zeroEndpoint = Math.abs(so) < 1e-8 !== Math.abs(to) < 1e-8;
  const layerwise = SomataSpiralZeroTransition.modeFor(state.layers?.[idx]) === 'layerwise';
  const direction =
    layerwise && zeroEndpoint
      ? Math.abs(so) >= 1e-8
        ? fromDirection
        : toDirection
      : fromDirection + (toDirection - fromDirection) * e;
  return ((2 * Math.PI * step) / n) * direction;
}
window.__spiroCurrentSpiralMorphCorridorDelta = getCurrentSpiralMorphCorridorDelta;
function spiralMorphUsesCircleRebuild() {
  const t = getSpiralMorphType();
  return t === 'phaseCircle' || t === 'minimalTurn' || SomataMorphRegistry.usesCoordinatedSpine(t);
}
function spiralMorphRestrictsTopologyParameters() {
  return true;
}
function spiralMorphUsesRetainedBezierRail() {
  const mode = getSpiralMorphMode();
  // Coordinated publishes a live skeleton; the legacy retained
  // transport independently synthesizes branches and must not run.
  return mode !== 'light' && mode !== 'fade' && !SomataMorphRegistry.usesCoordinatedSpine(mode);
}
// No independent one-value 'standard' selector: one authoritative Spiral
// transport drives the renderer, CPU plans, saved projects, and the UI.

function getEffectiveCircleSlideType(sourceLayer = null, targetLayer = null) {
  // The shared circle transport uses the SAME slide choice for both
  // orders. Specialized retained Bézier rails will be unified later.
  return ['minimal', 'sector', 'phase'].includes(state.morph?.slideType) ? state.morph.slideType : 'minimal';
}
function getEffectiveSpiralMorphTransport() {
  // Selected spiral type alone governs transport. No polygon slide mode
  // or redundant 'standard' value can override the phase/branch dynamics.
  return getSpiralMorphType();
}
function buildBlueProfileCarrierPlans() {
  const rt = runtimeState.morph || {},
    spiralTransport = getEffectiveSpiralMorphTransport();
  const src = rt.renderSourceLayers || [],
    dst = rt.renderTargetLayers || [],
    canonical = state.layers || [];
  rt.profileCarrierPlans = canonical.map((layer, idx) => {
    const a = src[idx] || layer || {},
      b = dst[idx] || a;
    const sourceKind = a?.spiralEnabled === true ? 'spiral' : 'polygon',
      targetKind = b?.spiralEnabled === true ? 'spiral' : 'polygon';
    const carrierKind = sourceKind === 'spiral' || targetKind === 'spiral' ? 'spiral' : 'polygon';
    const mode = getMorphModeForLayer(idx, { sourceLayer: a, targetLayer: b });
    return Object.freeze({
      layerIndex: idx,
      morphMode: mode,
      carrierKind,
      sourceCarrier: sourceKind,
      targetCarrier: targetKind,
      spiralTransport: carrierKind === 'spiral' ? spiralTransport : 'polygon',
      circleAlgorithm: mode === 'circleSlide' || mode === 'topoCircle' || mode === 'topoCircleOpacity',
      profileSource: 'shared-profile',
      carrierExecutor: carrierKind === 'spiral' ? 'retained-bezier-gpu' : 'shared-path-gpu',
      phaseSerial: Number(rt.phaseSerial) || 0,
    });
  });
  return rt.profileCarrierPlans;
}
function isSpiralLayerMorphEnabled() {
  return (
    runtimeState?.morph?.active === true &&
    (state.morph?.options?.bySpiralLayers === true || state.morph?.options?.bySpiralOrder === true)
  );
}

export {
  UNIFIED_MORPH_KEYS,
  UNIFIED_SPIRAL_TRANSPORTS,
  buildBlueProfileCarrierPlans,
  getEffectiveCircleSlideType,
  getEffectiveSpiralMorphTransport,
  getSpiralMorphType,
  FRAME_LEVEL_MORPH_MODES,
  SPIRAL_MORPH_MODE_KEYS,
  getMorphModeForLayer,
  getPolygonMorphMode,
  getSpiralMorphMode,
  getUnifiedMorphMode,
  normalizeSpiralMorphMode,
  pairInvolvesSpiral,
  setSpiralMorphMode,
  withLayerMorphMode,
  isSpiralLayerMorphEnabled,
  normalizeSpiralMorphType,
  setUnifiedMorphMode,
  spiralMorphForcesContinuousRail,
  spiralMorphKeepsContinuity,
  spiralMorphLocksK,
  spiralMorphLocksN,
  spiralMorphRestrictsTopologyParameters,
  spiralMorphUsesCircleRebuild,
  spiralMorphUsesCorridorPhase,
  spiralMorphUsesRetainedBezierRail,
};
