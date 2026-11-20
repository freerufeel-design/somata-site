// Спираль: порядок, направление, шаг, замыкание, режим контура.
import '../../render/spiral-stroke.js'; // initialisation order: this module runs after it
import { state } from '../../core/state.js';
import { getTunnelDistanceFactor } from '../../corridor/corridor-appearance.js';

function normalizeSpiralOrder(value, integer = false) {
  const n = Math.max(-20, Math.min(20, Number(value) || 0));
  return integer ? Math.round(n) : n;
}
function getEffectiveSpiralOrder(layer) {
  if (!layer) return 0;
  const order = normalizeSpiralOrder(layer.spiralOrder, false);

  // Spiral order is the count of external Corridor layers crossed by the
  // spiral profile. Zero is the authored polygon, not an implicit K.
  return order;
}
function isSpiralLayer(layer) {
  if (!layer) return false;
  // Keep the spiral family selection (spiralEnabled) for the editor,
  // while order 0 uses the polygon geometry/rendering pipeline.
  return Math.abs(getEffectiveSpiralOrder(layer)) > 1e-8;
}
function spiralDirection(order) {
  const n = normalizeSpiralOrder(order, false);
  return n < -1e-8 ? -1 : n > 1e-8 ? 1 : 0;
}
function spiralRadialExponent(order) {
  const a = Math.abs(normalizeSpiralOrder(order, false));
  return a > 1e-8 ? a : 1;
}
function getTunnelVirtualCopyCount(distanceFactorOverride = null) {
  const tunnel = state.tunnel || {};
  const baseCount = Math.max(4, Math.round(Number(tunnel.copies) || 16));
  const hasOverride =
    distanceFactorOverride !== null &&
    distanceFactorOverride !== undefined &&
    Number.isFinite(Number(distanceFactorOverride));
  const distanceFactor = hasOverride
    ? Math.max(0.01, Number(distanceFactorOverride))
    : getTunnelDistanceFactor();

  return 1 + (baseCount - 1) / Math.max(0.01, distanceFactor);
}
function getTunnelStepRatio(distanceFactorOverride = null) {
  const tunnel = state.tunnel || {};
  const virtualCount = getTunnelVirtualCopyCount(distanceFactorOverride);
  const minScale = Math.max(0.01, Number(tunnel.minScale) || 0.055);
  const maxScale = Math.max(minScale * 1.1, Number(tunnel.maxScale) || 3.8);
  const logSpan = Math.log(maxScale / minScale);
  const logStep = logSpan / Math.max(1e-6, virtualCount - 1);

  return Math.exp(Math.min(30, Math.max(1e-9, logStep)));
}
function getSpiralClosureRatio() {
  return getTunnelStepRatio();
}
function normalizeSpiralStep(value, layerOrN = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 1;
}
// A Spiral N-morph has a continuous angular denominator even though the
// number of drawable branches must remain an integer. Never derive a
// carrier angle from the rounded branch count during a transition.
function getSpiralAngularVertexCount(layer) {
  const interpolated = Number(layer?.__spiralAnimatedN);
  const authored = Number(layer?.N);
  return Math.max(2, Number.isFinite(interpolated) ? interpolated : Number.isFinite(authored) ? authored : 4);
}
function getEffectiveSpiralStep(layer) {
  // 9.2.14: spiral angular step has one canonical owner: polygon K.
  // Old spiralStep/spiralStepLinked values remain readable in saved projects
  // but must never produce a second independent angular step.
  // Animated K is a continuous interpolation of the same canonical K,
  // not a user-editable second step. Preserve its fractional phase on GPU.
  const k = Number(layer?.__spiralAnimatedK);
  const authored = normalizeSpiralStep(Number.isFinite(k) ? k : (layer?.K ?? 1), layer);
  // Even when the optional cyclic limiter is off, the spiral
  // topology has a legal maximum K for its current N. This is the
  // same forced reduction used by the ordinary polygon editor.
  const angularN = Number(layer?.__spiralAnimatedN);
  const rawN = Number.isFinite(angularN) ? angularN : Number(layer?.N);
  // Integer N has the original strict polygon/spiral K limit. During
  // a Spiral Morph N is *fractional* even though the drawable branch
  // count is an integer. Flooring that fractional N/2 snaps the
  // effective K from 2 to 3 at N=6.000... while the Morph clock keeps
  // advancing smoothly. Interpolate the legal limit between adjacent
  // integer vertex counts only for the intermediate Spiral carrier.
  // Endpoints (and every ordinary Polygon frame) remain unchanged.
  const fractionalSpiralN = layer?.spiralEnabled === true && Number.isFinite(angularN);
  const logicalN = Math.max(2, rawN);
  const lowerN = Math.floor(logicalN);
  const lowerLimit = Math.max(1, Math.floor(lowerN / 2));
  const upperLimit = Math.max(1, Math.floor((lowerN + 1) / 2));
  const ringMax = Number.isFinite(rawN)
    ? fractionalSpiralN
      ? lowerLimit + (upperLimit - lowerLimit) * (logicalN - lowerN)
      : Math.max(1, Math.floor(logicalN / 2))
    : Infinity;
  // Morph's animated carrier can interpolate two *effective* steps.
  // Never wrap it a second time: e.g. effective 2->2 must remain 2,
  // even if raw K moves from its maximum for N=20 to N=12.
  const bounded = Number(layer?.__spiralAnimatedEffectiveK);
  if (Number.isFinite(bounded) && bounded >= 1) return Math.min(ringMax, bounded);
  if (layer?.spiralStepLimiterEnabled === false || !Number.isFinite(authored) || authored < 1)
    return Math.min(authored, ringMax);
  const rawLimit = Number(layer?.spiralStepLimiter);
  const limit = Math.max(1, Math.min(120, Math.round(Number.isFinite(rawLimit) ? rawLimit : 2)));
  const cycle = (integerStep) => ((((integerStep - 1) % limit) + limit) % limit) + 1;
  const lower = Math.floor(authored),
    frac = authored - lower;
  // Fractional K during Morph must not jump at L -> L+1.
  const cycled = cycle(lower) + (cycle(lower + 1) - cycle(lower)) * frac;
  // A shrinking vertex ring can make even the wrapped step illegal.
  // Apply the N-dependent reduction HERE, at the same authority used
  // by the Bézier carrier and the ordinary orbit builder; do not let
  // the latter clamp a step that the renderer still sees in full.
  return Math.min(ringMax, cycled);
}
// 13.0.26: GEOMETRY-LEVEL K GATE. Project state retains the user's raw
// connection step (K=9); every geometry consumer instead sees the
// effective cyclic step (K=1 with limit=2). This view is ephemeral:
// it must never be written to the authored layer or into a saved project.
// In particular, correspondence algorithms and GPU carriers MUST NOT
// read a raw K after this projection, even when the endpoint renderer
// already used the wrapped angle correctly.
function getSpiralGeometryLayer(layer) {
  if (
    !layer ||
    !isSpiralLayer(layer) ||
    layer.spiralStepLimiterEnabled === false ||
    layer.__spiroGeometryStepResolved === true
  )
    return layer;
  const effective = getEffectiveSpiralStep(layer);
  if (!Number.isFinite(effective)) return layer;
  const N = Math.max(2, Math.round(Number(layer.N) || 4));
  const branchK = Math.max(1, Math.min(Math.max(1, Math.floor(N / 2)), Math.round(effective)));
  const result = {
    ...layer,
    K: branchK,
    spiralStep: effective,
    __spiroAuthoredConnectionK: Number(layer.K) || 1,
    __spiroGeometryStepResolved: true,
    // Cached effective step must be authoritative for fractional
    // frame values and must NOT be passed through modulo twice.
    __spiralAnimatedEffectiveK: effective,
    __spiralAnimatedK: undefined,
  };
  return result;
}
// Stage 2: shared geometry. Order is authoritative; the old family flag
// is retained only for legacy project compatibility and GPU consumers.
function setUnifiedSpiralOrder(layer, rawOrder) {
  if (!layer) return;
  const previousSpiral = Math.abs(getEffectiveSpiralOrder(layer)) > 1e-8;
  const closed = previousSpiral ? layer.spiralClosed !== false : layer.closedLoop !== false;
  const order = normalizeSpiralOrder(rawOrder, false);
  const active = Math.abs(order) > 1e-8;
  layer.extendedProfileEnabled = false;
  layer.spiralOrder = order;
  layer.spiralEnabled = active;
  layer.spiralRememberedOrder = order;
  layer.spiralClosed = closed;
  layer.closedLoop = active ? false : closed;
  return order;
}
function setUnifiedContourClosed(layer, closed) {
  if (!layer) return;
  layer.extendedProfileEnabled = false;
  const active = isSpiralLayer(layer);
  layer.spiralEnabled = active;
  layer.spiralClosed = closed === true;
  layer.closedLoop = active ? false : closed === true;
}
function getContourMode(layer) {
  if (layer?.extendedProfileEnabled === true)
    return layer.extendedProfileMode === 'repeat' ? 'extended-profile' : 'extended-linear';
  if (isSpiralLayer(layer)) return layer?.spiralClosed === false ? 'spiral-open' : 'spiral-closed';
  return layer?.closedLoop === false ? 'open' : 'closed';
}
function contourModeIsSpiral(mode) {
  return mode === 'spiral-closed' || mode === 'spiral-open' || mode === 'spiral';
}
function contourModeRequestsClosure(mode) {
  return mode === 'closed' || mode === 'spiral-closed' || mode === 'spiral';
}
function setContourMode(layer, mode) {
  if (!layer) return;
  // The polygon renderer requires order 0. Store the last explicitly
  // selected spiral order independently so the family toggle never
  // destroys it. Old projects without this field start at order 1.
  const wasSpiral = layer.spiralEnabled === true;
  if (wasSpiral) {
    const order = Number(layer.spiralOrder);
    if (Number.isFinite(order)) layer.spiralRememberedOrder = normalizeSpiralOrder(order, false);
  }
  if (
    layer.spiralRememberedOrder === undefined ||
    layer.spiralRememberedOrder === null ||
    !Number.isFinite(Number(layer.spiralRememberedOrder))
  )
    layer.spiralRememberedOrder = 1;

  if (mode === 'spiral') mode = layer.spiralClosed === false ? 'spiral-open' : 'spiral-closed';
  if (mode === 'extended-linear' || mode === 'extended-profile') {
    layer.extendedProfileEnabled = true;
    layer.extendedProfileMode = mode === 'extended-profile' ? 'repeat' : 'linear';
    layer.spiralEnabled = false;
    layer.spiralOrder = 0;
    layer.closedLoop = false;
    return;
  }
  layer.extendedProfileEnabled = false;

  if (mode === 'spiral-closed' || mode === 'spiral-open') {
    if (!wasSpiral) layer.spiralOrder = normalizeSpiralOrder(layer.spiralRememberedOrder, false);
    layer.spiralEnabled = true;
    layer.spiralClosed = mode === 'spiral-closed';

    layer.closedLoop =
      Math.abs(Number(layer.spiralOrder) || 0) <= 1e-8 ? layer.spiralClosed !== false : false;
    const order = normalizeSpiralOrder(layer.spiralOrder, false);
    if (!Number.isFinite(Number(layer.spiralOrder))) layer.spiralOrder = 1;
    // Do not substitute K for authored order, including order 0.
  } else {
    layer.spiralEnabled = false;
    layer.spiralOrder = 0;
    layer.closedLoop = mode !== 'open';
  }
}

export {
  contourModeIsSpiral,
  contourModeRequestsClosure,
  getContourMode,
  getEffectiveSpiralOrder,
  getEffectiveSpiralStep,
  getSpiralAngularVertexCount,
  getSpiralClosureRatio,
  getSpiralGeometryLayer,
  getTunnelStepRatio,
  getTunnelVirtualCopyCount,
  isSpiralLayer,
  normalizeSpiralOrder,
  normalizeSpiralStep,
  setContourMode,
  setUnifiedContourClosed,
  setUnifiedSpiralOrder,
  spiralDirection,
  spiralRadialExponent,
};
