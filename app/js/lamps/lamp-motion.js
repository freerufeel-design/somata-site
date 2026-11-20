// Лампы: состояние движения, прогресс морфа, сохранение идентичности ламп при Blue Morph.
import '../geometry/spiral-intersections.js'; // initialisation order: this module runs after it
import { getLampEvaluationConfig } from '../core/defaults-layers.js';
import { renderRuntime } from '../core/render-runtime.js';
import { runtimeState, state } from '../core/state.js';
import { lampHash32 } from './lamp-anchors.js';
import { lerpLampColorPhase, wrapLampColorPhase } from '../render/lamp-color.js';
import { lampSeedUnit } from './lamp-topology.js';

const lampMotionRuntime = {
  snap: new Map(),
  profileAttach: new Map(),
  calm: new Map(),
  corners: new Map(),
  arbitraryCounts: new Map(),
  arbitraryPathCounts: new Map(),
  blueMorph: new Map(),
  linearGates: new Map(),
  topologyLinearPlans: new Map(),
  lastCleanup: 0,
};
function lampVisualNow() {
  const n = Number(renderRuntime?.active ? renderRuntime.now : NaN);
  return Number.isFinite(n) && n > 0 ? n : performance.now();
}
function lampLinearMorphProgress(fallback = 0) {
  const p = Number(runtimeState.morph?.progress);
  return Math.max(0, Math.min(1, Number.isFinite(p) ? p : Number(fallback) || 0));
}
function lampEndpointTravelProgress(sx, sy, cx, cy, tx, ty, fallbackT = 0) {
  sx = Number(sx) || 0;
  sy = Number(sy) || 0;
  cx = Number(cx) || 0;
  cy = Number(cy) || 0;
  tx = Number(tx) || 0;
  ty = Number(ty) || 0;
  const total = Math.hypot(tx - sx, ty - sy);
  if (!(total > 1e-6)) return Math.max(0, Math.min(1, Number(fallbackT) || 0));
  const remaining = Math.hypot(tx - cx, ty - cy);
  return Math.max(0, Math.min(1, 1 - remaining / total));
}
// Лампа вершины, которой нет в цели, гаснет к концу фазы; лампа вершины, которой не было в
// источнике, разгорается с начала. Раньше это работало только в режимах движения «Линейно» и
// «Призрак», а в обычном лишние лампы горели до t=1 и исчезали разом на стыке фаз.
function lampTopologyPresence(sourcePresent, targetPresent, travelProgress = 0) {
  if (!runtimeState.morph?.active) return 1;
  const u = Math.max(0, Math.min(1, Number(travelProgress) || 0));
  if (sourcePresent && targetPresent) return 1;
  if (sourcePresent) return 1 - u;
  if (targetPresent) return u;
  return 0;
}
function lampPhaseLightTiming(now, duration) {
  const morph = runtimeState.morph;
  if (!morph?.active || !(morph.cycleStart > 0) || !(morph.transitionMs > 0)) return null;
  const clock = morph.pauseStartedAt > 0 ? Math.min(now, morph.pauseStartedAt) : now;
  const elapsed = Math.max(0, Math.min(morph.transitionMs, clock - morph.cycleStart));
  return { elapsed, remaining: morph.transitionMs - elapsed, duration };
}
function lampPhasePresence(point, cfg, timing = null) {
  if (timing && typeof point?.lampSourcePresent === 'boolean' && typeof point?.lampTargetPresent === 'boolean') {
    const { lampSourcePresent: source, lampTargetPresent: target } = point;
    if (source === target) return source ? 1 : 0;
    const time = source ? timing.remaining : timing.elapsed;
    if (timing.duration <= 0) return source ? Number(time > 0) : 1;
    const phaseMs = timing.elapsed + timing.remaining;
    const window = Number.isFinite(phaseMs) ? Math.min(timing.duration, phaseMs) : timing.duration;
    const t = window > 0 ? Math.max(0, Math.min(1, time / window)) : Number(target);
    return t * t * (3 - 2 * t);
  }
  const presence = Math.max(0, Math.min(1, point?.lampPresence === undefined ? 1 : Number(point.lampPresence) || 0));
  if (cfg?.extinguishIntersections !== false || !runtimeState.morph?.active || point?.lampTargetPresent !== false)
    return presence;
  if (point.lampSourcePresent === false) return 0;
  const progress = Number.isFinite(point.lampTravelProgress)
    ? point.lampTravelProgress
    : lampLinearMorphProgress(0);
  // Retiring lamps remain lit through crossings. Release only in the final fifth of their own travel.
  const u = Math.max(0, Math.min(1, (1 - progress) / 0.2));
  return u * u * (3 - 2 * u);
}
function lampAdaptivePointCount(points, cfg = getLampEvaluationConfig(), timing = null) {
  if (!Array.isArray(points) || !points.length) return 0;
  if (!runtimeState.morph?.active) return points.length;
  let sum = 0;
  for (const p of points)
    sum += lampPhasePresence(p, cfg, timing);
  return Math.max(0.001, sum);
}
function preserveBlueMorphLampIdentity(layerIndex, points, contourBound = false, displayedProgress = null) {
  if (!Array.isArray(points) || !points.length || !runtimeState.morph?.active) return points || [];
  const layer = state.layers?.[layerIndex];
  const layerKey = String(layer?.id ?? layerIndex);
  const serial = Math.max(0, Number(runtimeState.morph.lampCycleSerial) || 0);
  const now = lampVisualNow();
  const HANDOFF_MS = 140;
  const inertiaCfg = getLampEvaluationConfig();
  const instantTarget = (Number(inertiaCfg?.morphInertia) || 0) <= -100;
  const linearMode = ['linear', 'ghost'].includes(inertiaCfg?.morphMotionMode);
  let rt = lampMotionRuntime.blueMorph.get(layerKey);
  if (!rt) {
    rt = { serial: -1, assignments: new Map(), last: [], nextStable: 0 };
    lampMotionRuntime.blueMorph.set(layerKey, rt);
  }

  const rawKey = (p, i) =>
    String(
      p?.lampId ??
        `slot:${Number.isInteger(p?.pathIndex) ? p.pathIndex : -1}:${Number.isInteger(p?.vertexIndex) ? p.vertexIndex : i}`,
    );

  const sourceCount = Math.max(
    1,
    points.reduce((n, p) => n + (p?.lampSourcePresent === false ? 0 : 1), 0),
  );
  const targetCount = Math.max(
    1,
    points.reduce((n, p) => n + (p?.lampTargetPresent === false ? 0 : 1), 0),
  );
  let sourceRank = 0,
    targetRank = 0;
  const sourcePhase = new Array(points.length),
    targetPhase = new Array(points.length);
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    sourcePhase[i] = p?.lampSourcePresent === false ? NaN : sourceRank++ / sourceCount;
    targetPhase[i] = p?.lampTargetPresent === false ? NaN : targetRank++ / targetCount;
  }
  const previousAll = Array.isArray(rt.last) ? rt.last : [];

  const arriving = previousAll.filter(q => q.lampTargetPresent !== false);
  const previousVisible = arriving.filter(
    (q) => Math.max(0, Math.min(1, q?.lampPresence === undefined ? 1 : Number(q.lampPresence) || 0)) > 0.001,
  );
  const previous = previousVisible.length ? previousVisible : previousAll;
  const visible = (p) =>
    lampPhasePresence(p, inertiaCfg) > 0.002 &&
    (p?.lampLevel === undefined || Number(p.lampLevel) > 0.002);
  const nearestPrevious = (p) => {
    const px = Number(p?.x) || 0,
      py = Number(p?.y) || 0;
    let best = null,
      bestD = Infinity;
    for (const q of previous) {
      const dx = px - (Number(q?.x) || 0),
        dy = py - (Number(q?.y) || 0),
        d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = q;
      }
    }
    return best;
  };
  const makeNewStable = (p, targetPhaseHint = 0, fromPhaseHint = targetPhaseHint) => {
    const stableIndex = rt.nextStable++;
    return {
      id: `blue:${layerKey}:${stableIndex}`,
      seed: Number.isFinite(Number(p?.lampSeed))
        ? Number(p.lampSeed) >>> 0
        : lampHash32(`${layerKey}:blue:${stableIndex}`),
      index: stableIndex,
      fromX: Number(p?.x) || 0,
      fromY: Number(p?.y) || 0,
      handoffAt: now,
      fromColorPhase: wrapLampColorPhase(fromPhaseHint),
      colorPhase: wrapLampColorPhase(targetPhaseHint),
      fromBrightnessUnit: lampSeedUnit(
        Number.isFinite(Number(p?.lampSeed))
          ? Number(p.lampSeed)
          : lampHash32(`${layerKey}:blue:${stableIndex}`),
        4,
      ),
      targetBrightnessUnit: lampSeedUnit(
        Number.isFinite(Number(p?.lampSeed))
          ? Number(p.lampSeed)
          : lampHash32(`${layerKey}:blue:${stableIndex}`),
        4,
      ),
    };
  };

  if (rt.serial !== serial) {
    const used = new Set();
    const nextAssignments = new Map();
    // Сначала резервируем прежние ID для горящих ламп в той же точке.
    // Иначе более ранняя в списке, но сдвинувшаяся лампа может забрать этот ID.
    const order = points.map((_, i) => i);
    order.sort((a, b) => Number(points[a].lampSourcePresent === false) - Number(points[b].lampSourcePresent === false)
      || Number(visible(points[b])) - Number(visible(points[a])) || a - b);
    const coincident = new Map();
    const samePointEps2 = 1e-8; // Только погрешность координат, не соседние вершины.
    const nearestUnused = (p, maxD = Infinity, onlyVisible = false) => {
      const px = Number(p?.x) || 0,
        py = Number(p?.y) || 0;
      let best = -1,
        bestD = maxD;
      for (let j = 0; j < previous.length; j++) {
        const q = previous[j];
        if (used.has(j) || (onlyVisible && !visible(q))) continue;
        const dx = px - (Number(q?.x) || 0),
          dy = py - (Number(q?.y) || 0),
          d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          best = j;
        }
      }
      return best;
    };
    for (const i of order) {
      if (!visible(points[i]) || points[i].lampSourcePresent === false) continue;
      const j = nearestUnused(points[i], samePointEps2, true);
      if (j < 0) continue;
      used.add(j);
      coincident.set(i, j);
    }
    for (const i of order) {
      const p = points[i];
      const best = coincident.get(i) ?? nearestUnused(p);
      const nearest = nearestPrevious(p);
      const fallbackFrom = Number.isFinite(Number(nearest?.colorPhase))
        ? Number(nearest.colorPhase)
        : Number.isFinite(sourcePhase[i])
          ? sourcePhase[i]
          : Number.isFinite(targetPhase[i])
            ? targetPhase[i]
            : 0;
      const desiredTarget = Number.isFinite(targetPhase[i]) ? targetPhase[i] : fallbackFrom;
      let stable;
      if (best >= 0) {
        used.add(best);
        const q = previous[best] || {};
        const fallbackIndex = rt.nextStable++;
        const previousPhase = Number.isFinite(Number(q.colorPhase)) ? Number(q.colorPhase) : fallbackFrom;
        stable = {
          id: String(q.stableId || q.lampId || `blue:${layerKey}:${fallbackIndex}`),
          seed: Number.isFinite(Number(q.lampSeed))
            ? Number(q.lampSeed) >>> 0
            : lampHash32(`${layerKey}:blue:${fallbackIndex}`),
          index: Number.isFinite(Number(q.stableIndex)) ? Number(q.stableIndex) : fallbackIndex,
          fromX: Number(q.x) || 0,
          fromY: Number(q.y) || 0,
          handoffAt: now,
          fromColorPhase: wrapLampColorPhase(previousPhase),
          colorPhase: wrapLampColorPhase(desiredTarget),
          fromBrightnessUnit: Number.isFinite(Number(q.brightnessUnit))
            ? Number(q.brightnessUnit)
            : lampSeedUnit(Number(q.lampSeed) || 0, 4),
          targetBrightnessUnit: Number.isFinite(Number(q.brightnessUnit))
            ? Number(q.brightnessUnit)
            : lampSeedUnit(Number(q.lampSeed) || 0, 4),
        };
      } else {
        stable = makeNewStable(p, desiredTarget, fallbackFrom);
        if (nearest) {
          stable.fromBrightnessUnit = Number.isFinite(Number(nearest.brightnessUnit))
            ? Number(nearest.brightnessUnit)
            : lampSeedUnit(Number(nearest.lampSeed) || 0, 4);
          stable.targetBrightnessUnit = lampSeedUnit(Number(p?.lampSeed) || 0, 4);
        }
      }
      if (Number.isFinite(displayedProgress) && displayedProgress < 0.2 && previous.length) {
        // The next phase may rebuild its rounded rail with a different seam.
        // Transfer the previous displayed centre, including its projection.
        stable.seamDx = stable.fromX - p.x;
        stable.seamDy = stable.fromY - p.y;
        stable.seamStart = displayedProgress;
      }
      nextAssignments.set(rawKey(p, i), stable);
    }
    rt.assignments = nextAssignments;
    rt.serial = serial;
  }

  const globalColorT = lampLinearMorphProgress(0);
  const out = new Array(points.length);
  for (let i = 0; i < points.length; i++) {
    const p = points[i],
      key = rawKey(p, i);
    let stable = rt.assignments.get(key);
    if (!stable) {
      const near = nearestPrevious(p);
      const from = Number.isFinite(Number(near?.colorPhase))
        ? Number(near.colorPhase)
        : Number.isFinite(sourcePhase[i])
          ? sourcePhase[i]
          : 0;
      const to = Number.isFinite(targetPhase[i]) ? targetPhase[i] : from;
      stable = makeNewStable(p, to, from);
      if (near) {
        stable.fromBrightnessUnit = Number.isFinite(Number(near.brightnessUnit))
          ? Number(near.brightnessUnit)
          : lampSeedUnit(Number(near.lampSeed) || 0, 4);
        stable.targetBrightnessUnit = lampSeedUnit(Number(p?.lampSeed) || 0, 4);
      }
      rt.assignments.set(key, stable);
    }
    const age = Math.max(0, now - (Number(stable.handoffAt) || 0));
    const profileArcAttached = p?.__lampVisualProfileAttached === true;
    const u =
      instantTarget || linearMode || profileArcAttached || contourBound
        ? 1
        : stable.handoffAt
          ? Math.max(0, Math.min(1, age / HANDOFF_MS))
          : 1;
    const ease = u * u * (3 - 2 * u);
    const targetX = Number(p?.x) || 0,
      targetY = Number(p?.y) || 0,
      sx = Number(stable.fromX) || 0,
      sy = Number(stable.fromY) || 0;
    let x = u < 1 ? sx + (targetX - sx) * ease : targetX,
      y = u < 1 ? sy + (targetY - sy) * ease : targetY;
    if (Number.isFinite(stable.seamStart) && Number.isFinite(displayedProgress)) {
      const f = Math.max(0, Math.min(1, (displayedProgress - stable.seamStart) / (0.2 - stable.seamStart)));
      const weight = 1 - f * f * (3 - 2 * f);
      x += stable.seamDx * weight;
      y += stable.seamDy * weight;
    }
    const baseLevel = p?.lampLevel === undefined ? 1 : Math.max(0, Math.min(1, Number(p.lampLevel) || 0));
    // Birth brightness is decided after final contour attachment, in lamp-stability.
    // Do not make a new ID invisible here: it might occupy an already lit point.
    const travelT =
      linearMode && Number.isFinite(Number(p?.lampTravelProgress))
        ? Math.max(0, Math.min(1, Number(p.lampTravelProgress)))
        : globalColorT;
    const lampColorPhase = lerpLampColorPhase(stable.fromColorPhase, stable.colorPhase, travelT);
    const fromBrightnessUnit = Number.isFinite(Number(stable.fromBrightnessUnit))
      ? Number(stable.fromBrightnessUnit)
      : lampSeedUnit(stable.seed, 4);
    const targetBrightnessUnit = Number.isFinite(Number(stable.targetBrightnessUnit))
      ? Number(stable.targetBrightnessUnit)
      : fromBrightnessUnit;
    const lampBrightnessUnit = fromBrightnessUnit + (targetBrightnessUnit - fromBrightnessUnit) * travelT;
    out[i] = {
      ...p,
      x,
      y,
      lampLevel: baseLevel,
      lampId: stable.id,
      lampSeed: stable.seed,
      lampStableIndex: stable.index,
      lampColorPhase,
      lampBrightnessUnit,
    };
    if (u >= 1) {
      stable.handoffAt = 0;
      stable.fromX = x;
      stable.fromY = y;
    }
  }
  rt.last = out.map((p) => ({
    x: Number(p.x) || 0,
    y: Number(p.y) || 0,
    lampLevel: p?.lampLevel === undefined ? 1 : Number(p.lampLevel) || 0,
    lampPresence: lampPhasePresence(p, inertiaCfg),
    lampTargetPresent: p.lampTargetPresent,
    lampId: p.lampId,
    stableId: p.lampId,
    lampSeed: p.lampSeed,
    stableIndex: p.lampStableIndex,
    colorPhase: wrapLampColorPhase(p.lampColorPhase),
    brightnessUnit: Number.isFinite(Number(p.lampBrightnessUnit))
      ? Number(p.lampBrightnessUnit)
      : lampSeedUnit(Number(p.lampSeed) || 0, 4),
  }));
  return out;
}

export {
  lampAdaptivePointCount,
  lampEndpointTravelProgress,
  lampMotionRuntime,
  lampPhaseLightTiming,
  lampPhasePresence,
  lampTopologyPresence,
  lampVisualNow,
  preserveBlueMorphLampIdentity,
};
