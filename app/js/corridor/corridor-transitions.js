// Коридор: вход, смена порядка, «честные» интро/аутро перехода через ноль.
import './corridor-appearance.js'; // initialisation order: this module runs after it
import { animationScheduler, requestMainCanvasRender } from '../core/scheduler.js';
import { runtimeState, state } from '../core/state.js';
import { tunnelAnimationFrame } from './corridor-instances.js';

// Reversible Corridor transition. The authored spiral order and Tunnel
// options remain untouched: only the frame snapshot is interpolated.
// A corridor is an endpoint state, never an intermediate stop while
// Blue Morph travels between two nonzero spiral orders.
const corridorEntrance = {
  start: 0,
  duration: 0,
  foldFraction: 0,
  completed: true,
  direction: 'idle',
  spiralOrders: new Map(),
};
const corridorEase = (t) => {
  const v = Math.max(0, Math.min(1, Number(t) || 0));
  return v * v * (3 - 2 * v);
};
function corridorEntranceFrame(now = performance.now()) {
  if (!corridorEntrance.duration || corridorEntrance.direction === 'idle')
    return { active: false, population: 1, fold: 1, direction: 'idle' };
  const t = Math.max(0, Math.min(1, (now - corridorEntrance.start) / corridorEntrance.duration));
  const foldFraction = corridorEntrance.foldFraction;
  const entry = corridorEntrance.direction === 'in';
  // Enter: spiral -> order 0 -> copies. Exit: copies -> order 0 -> spiral.
  const fold =
    foldFraction > 0
      ? entry
        ? corridorEase(t / foldFraction)
        : 1 - corridorEase((t - (1 - foldFraction)) / foldFraction)
      : 1;
  const population = entry
    ? corridorEase((t - foldFraction) / Math.max(0.00001, 1 - foldFraction))
    : 1 - corridorEase(t / Math.max(0.00001, 1 - foldFraction));
  return {
    active: t < 1,
    population,
    fold,
    progress: t,
    hasFold: foldFraction > 0,
    direction: corridorEntrance.direction,
  };
}
function corridorTransitionDuration() {
  // A missing animation setting means ON for new/default layers.
  // Explicit false in a saved project still disables the animation.
  const enabled = state.layers.filter((l) => l?.testMorph?.enabled !== false);
  return enabled.length
    ? Math.max(...enabled.map((l) => Math.max(0.1, Math.min(60, Number(l?.testMorph?.duration) || 1)))) * 1000
    : 0;
}
function beginCorridorTransition(direction) {
  const duration = corridorTransitionDuration();
  corridorEntrance.duration = duration;
  corridorEntrance.completed = duration === 0;
  corridorEntrance.start = performance.now();
  corridorEntrance.direction = duration ? direction : 'idle';
  // Switching Corridor ON/OFF never changes the Spiral profile.
  // The special order-0 choreography belongs to a deliberate change
  // of the spiral order while Corridor is ALREADY active.
  corridorEntrance.spiralOrders.clear();
  corridorEntrance.foldFraction = 0;
}
// Explicit Corridor + Spiral order transitions, independent from
// enabling/disabling Corridor. A direct nonzero -> nonzero edit (even
// when crossing 0 between endpoints) never triggers a population.
const corridorOrderChanges = new Map();
const corridorOrderIsZero = (v) => Math.abs(Number(v) || 0) < 1e-8;
// Honest Spiral order 1 -> 0 has its own AFTER-the-geometry
// Corridor expansion, budgeted inside the configured total duration.
// The Spiral trajectory stays direct, never using Beautiful staging.
const HONEST_CORRIDOR_TIME_FRACTION = 0.2;
const honestZeroCorridorOutros = new Map();
function stopHonestZeroCorridorOutro(id) {
  if (id == null) honestZeroCorridorOutros.clear();
  else honestZeroCorridorOutros.delete(id);
}
function honestZeroCorridorOutroFrame(id, now = performance.now()) {
  const rec = honestZeroCorridorOutros.get(id);
  if (!rec || state.tunnel?.active !== true) return null;
  const t = Math.max(0, Math.min(1, (now - rec.start) / rec.duration));
  const population = corridorEase(t);
  if (t >= 1) rec.completed = true;
  return { population, active: t < 1, completed: rec.completed === true, progress: t };
}
function beginHonestZeroCorridorOutro(id, now = performance.now(), durationSec = 1) {
  if (!id || state.tunnel?.active !== true) return false;
  honestZeroCorridorOutros.set(id, {
    start: now,
    duration: Math.max(1, Math.min(60000, (Number(durationSec) || 1) * 1000)),
    completed: false,
  });
  animationScheduler.add('tunnel', tunnelAnimationFrame);
  requestMainCanvasRender();
  return true;
}
window.__somataCorridorBeginHonestZeroOutro = beginHonestZeroCorridorOutro;
window.__somataCorridorStopHonestZeroOutro = stopHonestZeroCorridorOutro;
window.__somataCorridorHonestZeroOutro = (id, now = performance.now()) =>
  honestZeroCorridorOutroFrame(id, now);
// Reverse Honest choreography, 0 -> nonzero: gather the static Corridor
// BEFORE Spiral order motion. Both phases fit the same total duration.
// As Spiral moves, fade copies in smoothly with the original spacing.
const honestZeroCorridorIntros = new Map();
function stopHonestZeroCorridorIntro(id) {
  if (id == null) honestZeroCorridorIntros.clear();
  else honestZeroCorridorIntros.delete(id);
}
function honestZeroCorridorIntroFrame(id, now = performance.now(), layer = null) {
  const rec = honestZeroCorridorIntros.get(id);
  if (!rec || state.tunnel?.active !== true) return null;
  const t = Math.max(0, Math.min(1, (now - rec.start) / rec.duration));
  const orderProgress = Math.max(
    0,
    Math.min(1, Math.abs(Number(layer?.spiralOrder) || 0) / Math.abs(rec.toOrder)),
  );
  const population = t < 1 ? 1 - corridorEase(t) : corridorEase(Math.min(1, orderProgress / 0.15));
  return { population, active: t < 1, completed: t >= 1, progress: t };
}
function beginHonestZeroCorridorIntro(id, now = performance.now(), durationSec = 1, toOrder = 1) {
  if (!id || state.tunnel?.active !== true || corridorOrderIsZero(toOrder)) return false;
  stopHonestZeroCorridorOutro(id);
  honestZeroCorridorIntros.set(id, {
    start: now,
    duration: Math.max(1, Math.min(60000, (Number(durationSec) || 1) * 1000)),
    toOrder: Number(toOrder),
  });
  animationScheduler.add('tunnel', tunnelAnimationFrame);
  requestMainCanvasRender();
  return true;
}
function shiftHonestZeroCorridorOutro(ids, delta) {
  for (const id of ids || []) {
    const rec = honestZeroCorridorOutros.get(id);
    if (rec) rec.start += delta;
  }
}
function shiftHonestZeroCorridorIntro(ids, delta) {
  for (const id of ids || []) {
    const rec = honestZeroCorridorIntros.get(id);
    if (rec) rec.start += delta;
  }
}
window.__somataCorridorBeginHonestZeroIntro = beginHonestZeroCorridorIntro;
window.__somataCorridorStopHonestZeroIntro = stopHonestZeroCorridorIntro;
window.__somataCorridorHonestZeroIntro = (id, now = performance.now(), layer = null) =>
  honestZeroCorridorIntroFrame(id, now, layer);
function beginCorridorOrderChange(
  layerId,
  fromOrder,
  toOrder,
  durationSec = 1,
  startTime = performance.now(),
) {
  const a = Number(fromOrder),
    b = Number(toOrder);
  if (
    !layerId ||
    !state.tunnel?.active ||
    runtimeState.morph?.active === true ||
    !Number.isFinite(a) ||
    !Number.isFinite(b) ||
    corridorOrderIsZero(a) === corridorOrderIsZero(b)
  )
    return false;
  const layer = state.layers.find((l) => l?.id === layerId);
  if (layer?.testMorph?.enabled === false) return false;
  // A new author edit cancels the previous order-zero outro.
  stopHonestZeroCorridorOutro(layerId);
  stopHonestZeroCorridorIntro(layerId);
  // Do not compound an entrance fade with a separate order change.
  stopCorridorEntrance();
  corridorOrderChanges.set(layerId, {
    from: a,
    to: b,
    start: startTime,
    duration: Math.max(100, Math.min(60000, (Number(durationSec) || 1) * 1000)),
  });
  animationScheduler.add('tunnel', tunnelAnimationFrame);
  requestMainCanvasRender();
  return true;
}
function corridorOrderChangeFrame(layerId, now = performance.now()) {
  const transition = corridorOrderChanges.get(layerId);
  if (!transition || !state.tunnel?.active) return null;
  const t = Math.max(0, Math.min(1, (now - transition.start) / transition.duration));
  if (t >= 1) {
    corridorOrderChanges.delete(layerId);
    return null;
  }
  // Identical phase boundaries and easing to the Blue Morph path.
  const mode = SomataSpiralZeroTransition.modeFor(state.layers.find((layer) => layer?.id === layerId));
  const eased =
    typeof window.__somataMorphSpeedEase === 'function'
      ? Math.max(0, Math.min(1, window.__somataMorphSpeedEase(t)))
      : t;
  const phase = window.SomataSpiralZeroTransition.plan(
    mode,
    transition.from,
    transition.to,
    eased,
    true,
    true,
  );
  return {
    order: phase.order,
    population: phase.population,
    progress: t,
    from: transition.from,
    to: transition.to,
  };
}
window.__somataCorridorBeginOrderChange = beginCorridorOrderChange;
window.__somataCorridorOrderChangeActive = (id) =>
  Boolean(corridorOrderChanges.has(id) && state.tunnel?.active);
window.__somataCorridorCopiesForLayer = (copies, layer, now = performance.now()) => {
  const phase = corridorOrderChangeFrame(layer?.id, now);
  const outro = honestZeroCorridorOutroFrame(layer?.id, now);
  const intro = honestZeroCorridorIntroFrame(layer?.id, now, layer);
  const morphPopulation = Number(layer?.__spiralZeroCorridorPopulation);
  // The outro takes ownership only after order zero has actually arrived.
  // A manual Geometry > Animation edit has its own running clock,
  // even when Blue Morph is OFF. Do not gate its copy choreography
  // behind runtimeState.morph.active (which only describes Blue).
  const activePhase =
    phase ||
    outro ||
    intro ||
    (state.tunnel?.active === true &&
    layer?.__spiralZeroCorridorPopulation != null &&
    Number.isFinite(morphPopulation)
      ? { population: Math.max(0, Math.min(1, morphPopulation)) }
      : null);
  if (state.tunnel?.active && layer?.id) {
    window.__somataCorridorLastConsumed = {
      at: now,
      layerId: layer.id,
      mode: layer.spiralZeroTransitionMode || null,
      active: !!activePhase,
      blueActive: runtimeState.morph?.active === true,
      population: activePhase?.population ?? null,
      angleMix: layer.__spiralLayerwiseAngleMix ?? null,
      scaleExponent: layer.__spiralLayerwiseScaleExponent ?? null,
      copyCount: Array.isArray(copies) ? copies.length : 0,
    };
  }
  if (!activePhase || !Array.isArray(copies)) return copies;
  // Never alter renderFrame.tunnelCopies, shared by other layers.
  const result = copies.map((copy) => ({ ...copy }));
  for (const key of Object.keys(copies)) if (!/^\d+$/.test(key)) result[key] = copies[key];
  let anchor = 0,
    best = Infinity,
    max = 0;
  for (let i = 0; i < result.length; i++) {
    const d = Math.abs(Math.log(Math.max(1e-12, Number(result[i].scale) || 1)));
    if (d < best) {
      best = d;
      anchor = i;
    }
    max = Math.max(max, d);
  }
  for (let i = 0; i < result.length; i++) {
    const copy = result[i],
      log = Math.log(Math.max(1e-12, Number(copy.scale) || 1));
    const relative = max > 0 ? Math.abs(log) / max : 0;
    const local = corridorEase(
      (activePhase.population - relative * 0.24) / Math.max(0.01, 1 - relative * 0.24),
    );
    // At order zero the Spiral Corridor renderer has already
    // expanded scale/stepRatio with the Outro population. Applying
    // the same population again would flatten the copies twice.
    if (!(outro && corridorOrderIsZero(layer?.spiralOrder))) copy.scale = Math.exp(log * local);
    copy.alpha = i === anchor ? 1 : local;
    copy._corridorEntryAnchor = i === anchor;
    if (i === anchor) copy.centerRevealAlpha = 1;
  }
  return result;
};
function stopCorridorEntrance() {
  corridorEntrance.duration = 0;
  corridorEntrance.completed = true;
  corridorEntrance.foldFraction = 0;
  corridorEntrance.direction = 'idle';
  corridorEntrance.spiralOrders.clear();
}
// The fold/unfold belongs exclusively to the rendered layer snapshot.
// Reaching order 0 inside a Spiral -> Spiral Blue Morph never triggers it.
window.__somataApplyCorridorEntranceLayer = (frameCtx, now = performance.now()) => {
  const layer = frameCtx?.layer;
  if (!layer || !state.tunnel?.active || runtimeState.morph?.active === true) return false;
  const change = corridorOrderChangeFrame(layer.id, now);
  if (!change) return false;
  layer.spiralEnabled = true;
  layer.spiralOrder = change.order;
  layer.__spiralOrderInterpolating = true;
  layer.closedLoop = Math.abs(layer.spiralOrder) < 1e-8 ? layer.spiralClosed !== false : false;
  return true;
};

export {
  beginCorridorTransition,
  corridorEase,
  corridorEntrance,
  corridorEntranceFrame,
  corridorOrderChangeFrame,
  corridorOrderChanges,
  corridorTransitionDuration,
  honestZeroCorridorIntroFrame,
  honestZeroCorridorIntros,
  honestZeroCorridorOutroFrame,
  honestZeroCorridorOutros,
  shiftHonestZeroCorridorIntro,
  shiftHonestZeroCorridorOutro,
  stopCorridorEntrance,
  stopHonestZeroCorridorIntro,
  stopHonestZeroCorridorOutro,
};
