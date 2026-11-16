import './state.js'; // initialisation order: this module runs after it
import { getEffectiveSpiralStep } from '../geometry/spiral/order-params.js';

window.SomataZeroOrderModeProfiles = Object.create(null);
(function (root) {
  const clamp = (t) => Math.max(0, Math.min(1, Number(t) || 0));
  const ease = (t) => {
    t = clamp(t);
    return t * t * (3 - 2 * t);
  };

  const isZero = (n) => Math.abs(Number(n) || 0) < 1e-8;
  const defaultMode = 'layerwise';
  const usesOrbitUnfold = (mode) => mode === 'unfoldUntwisted' || mode === 'seaweed';
  const builds = ['simple', 'unfold', 'seaweed', 'unfoldUntwisted'];
  const transitions = ['layerwise', 'honest', 'beautiful'];
  const normalizeBuild = (value) => (builds.includes(value) ? value : 'simple');
  const normalizeTransition = (value) => (transitions.includes(value) ? value : defaultMode);
  // Old projects stored both kinds of choices in one field.
  const buildOf = (layer) => normalizeBuild(layer?.spiralConstructionMode ?? layer?.spiralZeroTransitionMode);
  const transitionOf = (layer) => normalizeTransition(layer?.spiralZeroTransitionMode);
  const modeFor = (layer) => {
    const build = buildOf(layer),
      transition = transitionOf(layer);
    return build === 'simple' ? transition : transition === defaultMode ? build : `${build}:${transition}`;
  };
  const normalizeMode = (mode) => {
    const base = typeof mode === 'string' ? mode.split(':', 1)[0] : null;
    return base && Object.hasOwn(root.SomataZeroOrderModeProfiles, base) ? base : defaultMode;
  };
  const combinedTransition = (mode) =>
    typeof mode === 'string' && mode.includes(':') ? normalizeTransition(mode.split(':')[1]) : null;
  function plan(mode, fromOrder, toOrder, progress, withCorridor) {
    const a = Number(fromOrder) || 0,
      b = Number(toOrder) || 0,
      t = clamp(progress);
    const zeroEndpoint = isZero(a) !== isZero(b);

    const transition = combinedTransition(mode);
    if (zeroEndpoint && transition && transition !== defaultMode) {
      const timed =
        transition === 'honest'
          ? sampleOrder('honest', a, b, t, withCorridor)
          : plan(transition, a, b, t, withCorridor);
      return { ...timed, shapeT: clamp((timed.order - a) / (b - a)) };
    }
    mode = normalizeMode(mode);
    const profile = root.SomataZeroOrderModeProfiles[mode];
    if (
      zeroEndpoint &&
      withCorridor === true &&
      (mode === 'unfold' || (usesOrbitUnfold(mode) && Math.max(Math.abs(a), Math.abs(b)) <= 1 + 1e-8))
    ) {
      const outward = isZero(a) ? t : 1 - t;
      const edge = 0.2;
      const winding = ease((outward - edge) / (1 - edge));
      const shapeT = isZero(a) ? winding : 1 - winding;
      const population = outward < edge ? 1 - ease(outward / edge) : winding;
      return { order: a + (b - a) * shapeT, shapeT, population, choreographed: true, zeroEndpoint };
    }
    const withPopulation = zeroEndpoint && withCorridor === true && profile?.populated === true;
    if (!withPopulation) {
      const shapeT = profile ? profile.shapeProgress(t, ease) : t;
      return { order: a + (b - a) * shapeT, population: 1, choreographed: false, zeroEndpoint };
    }

    const population = t < 0.3 ? 1 - ease(t / 0.3) : t >= 0.7 ? ease((t - 0.7) / 0.3) : 0;
    const shapeProgress = t <= 0.3 ? 0 : t >= 0.7 ? 1 : ease((t - 0.3) / 0.4);

    const orderProgress = profile.orderProgress(t, shapeProgress);
    return { order: a + (b - a) * orderProgress, population, choreographed: true, zeroEndpoint };
  }

  function layerwiseAngleMix(mode, fromOrder, toOrder, progress, withCorridor) {
    if (mode !== 'layerwise' || withCorridor !== true || isZero(fromOrder) === isZero(toOrder)) return null;
    const u = ease(progress);
    return isZero(fromOrder) ? u : 1 - u;
  }
  function layerwiseScaleExponent(mode, fromOrder, toOrder, progress, withCorridor) {
    if (mode !== 'layerwise' || withCorridor !== true || isZero(fromOrder) === isZero(toOrder)) return null;
    const exponent = (v) => (isZero(v) ? 1 : Math.max(0.000001, Math.abs(Number(v) || 0)));
    return exponent(fromOrder) + (exponent(toOrder) - exponent(fromOrder)) * ease(progress);
  }

  function layerwiseReferenceDelta(mode, fromOrder, toOrder, source, target, withCorridor) {
    if (mode !== 'layerwise' || withCorridor !== true || isZero(fromOrder) === isZero(toOrder)) return null;
    const end = isZero(fromOrder) ? target : source;
    if (!end) return null;
    const n = Math.max(2, Number(end.N) || 2);
    const step = Number(getEffectiveSpiralStep(end));
    const signedOrder = isZero(fromOrder) ? toOrder : fromOrder;
    return (
      ((2 * Math.PI * Math.max(1e-9, Number.isFinite(step) ? step : 1)) / n) * (signedOrder < 0 ? -1 : 1)
    );
  }

  // A fractional authored order is a position in the selected zero-order
  // transition, measured outward from the polygon on either side of zero.
  function staticOrder(value) {
    const v = Number(value) || 0;
    return Math.abs(v) > 1e-8 && Math.abs(v) < 1
      ? { from: 0, to: Math.sign(v), progress: Math.abs(v) }
      : null;
  }
  const isCalibrationEdit = (from, to) =>
    Math.abs(from) <= 1 && Math.abs(to) <= 1 && Boolean(staticOrder(from) || staticOrder(to));
  // A spinner works on integer ticks. A typed fraction is not an offset
  // carried over to later clicks; the first click lands on the next tick.
  const stepOrder = (value, direction) =>
    Math.max(
      -20,
      Math.min(20, direction > 0 ? Math.floor(Number(value) || 0) + 1 : Math.ceil(Number(value) || 0) - 1),
    );
  function sampleOrder(mode, from, to, progress, withCorridor) {
    // Keep the combined key for plan(); its base is used only by geometry.
    // Honest uses an asymmetric dedicated Corridor stage. Unlike Beautiful
    // it does not hold the entire shape in the middle of the transition.
    if (mode === 'honest' && withCorridor && isZero(from) !== isZero(to)) {
      const outward = isZero(from) ? clamp(progress) : 1 - clamp(progress);
      const shapeT = clamp((outward - 0.2) / 0.8);
      const population = outward < 0.2 ? 1 - ease(outward / 0.2) : ease(shapeT / 0.15);
      return { order: (isZero(from) ? to : from) * shapeT, population, zeroEndpoint: true };
    }
    return plan(mode, from, to, progress, withCorridor);
  }
  const holdPhases = (value) => Math.max(1, Math.min(999, Math.round(Number(value) || 1)));
  const needsOrderAnimation = (a, b) => a !== b && (a * b <= 0 || Math.min(Math.abs(a), Math.abs(b)) < 1);
  const durationMs = (layer, phaseMs) =>
    layer?.testMorph?.syncWithMorph === true
      ? phaseMs
      : Math.max(100, Math.min(60000, (Number(layer?.testMorph?.duration) || 1) * 1000));
  function shouldHoldOrder(record, phase, minimum, current) {
    return record?.order === current && phase - record.phase < holdPhases(minimum);
  }
  function blueOrder(mode, from, to, phase, withCorridor, phaseMs = 1000, animationMs = 1000) {
    const u = clamp(phase);
    const animated = needsOrderAnimation(from, to);
    const transition = animated ? clamp((u * phaseMs) / Math.max(1, animationMs)) : 1;
    const raw = transition === 1 ? to : from + (to - from) * transition;
    if (
      normalizeMode(mode) === 'unfold' &&
      isZero(from) !== isZero(to) &&
      Math.max(Math.abs(from), Math.abs(to)) > 1
    ) {
      const frame = sampleOrder(mode, from, to, transition, withCorridor);
      return { from, to, progress: transition, order: frame.order, transitioning: transition < 1 };
    }
    // One authored coordinate on each side of zero, shared with static
    // calibration. In particular .5 is not a new spiral endpoint.
    if (Math.abs(raw) <= 1 && (animated || staticOrder(raw))) {
      const sign = Math.sign(raw) || Math.sign(to) || Math.sign(from) || 1;
      const t = Math.abs(raw);
      return {
        from: 0,
        to: sign,
        progress: t,
        order: sampleOrder(mode, 0, sign, t, withCorridor).order,
        transitioning: transition < 1,
      };
    }
    return { from: raw, to: raw, progress: 1, order: raw, transitioning: transition < 1 };
  }
  function applyCorridorFrame(
    layer,
    mode,
    from,
    to,
    t,
    withCorridor,
    source,
    target,
    authored = source,
    sharedHonest = false,
  ) {
    delete layer.__spiralZeroCorridorPopulation;
    delete layer.__spiralUnfoldPopulation;
    delete layer.__spiralUntwistedFollowers;
    delete layer.__spiralUnfoldSpiralWeight;
    delete layer.__spiralUnfoldSpiralExponent;
    delete layer.__spiralLayerwiseAngleMix;
    delete layer.__spiralLayerwiseScaleExponent;
    delete layer.__spiralLayerwiseReferenceDelta;
    if (withCorridor !== true || isZero(from) === isZero(to)) return;
    const construction = normalizeMode(mode);
    if (
      construction === 'unfold' ||
      (usesOrbitUnfold(construction) && Math.max(Math.abs(from), Math.abs(to)) <= 1 + 1e-8)
    ) {
      const phase = plan(mode, from, to, t, true);
      layer.__spiralUnfoldPopulation = phase.population;
      layer.__spiralUnfoldSpiralWeight = isZero(from) ? phase.shapeT : 1 - phase.shapeT;
      layer.__spiralUnfoldSpiralExponent = Math.abs(isZero(from) ? to : from);
      if (usesOrbitUnfold(construction) && layer.__spiralUnfoldSpiralExponent <= 1 + 1e-8) {
        layer.__spiralUntwistedFollowers = { shape: layer.__spiralUnfoldSpiralWeight };
      }
    } else if (mode === 'beautiful' || (mode === 'honest' && sharedHonest))
      layer.__spiralZeroCorridorPopulation = sampleOrder(mode, from, to, t, true).population;
    else if (mode === 'layerwise') {
      layer.__spiralLayerwiseAngleMix = layerwiseAngleMix(mode, from, to, t, true);
      layer.__spiralLayerwiseScaleExponent = layerwiseScaleExponent(mode, from, to, t, true);
      layer.__spiralLayerwiseReferenceDelta = layerwiseReferenceDelta(mode, from, to, source, target, true);
    }
  }
  // Use the same multiplicative distance to the unscaled figure as the
  // Corridor entrance. Call before the entrance changes the copy scales.
  function corridorOrigin(copies) {
    let best = null,
      distance = Infinity;
    for (const copy of copies ?? []) {
      const scale = Number(copy?.scale);
      if (!(scale > 0) || !Number.isFinite(scale)) continue;
      const d = Math.abs(Math.log(scale));
      if (d < distance) {
        best = copy;
        distance = d;
      }
    }
    return best;
  }
  function shortestEquivalentAngle(angle) {
    if (!Number.isFinite(angle)) return 0;
    let a = Math.atan2(Math.sin(angle), Math.cos(angle));
    if (Math.abs(Math.abs(a) - Math.PI) < 1e-9) a = angle < 0 ? -Math.PI : Math.PI;
    return a;
  }
  root.SomataSpiralZeroTransition = Object.freeze({
    plan,
    staticOrder,
    isCalibrationEdit,
    stepOrder,
    sampleOrder,
    blueOrder,
    holdPhases,
    needsOrderAnimation,
    durationMs,
    shouldHoldOrder,
    applyCorridorFrame,
    isZero,
    usesOrbitUnfold,
    normalizeMode,
    buildOf,
    transitionOf,
    modeFor,
    defaultMode,
    layerwiseAngleMix,
    layerwiseScaleExponent,
    layerwiseReferenceDelta,
    corridorOrigin,
    shortestEquivalentAngle,
  });
})(window);
