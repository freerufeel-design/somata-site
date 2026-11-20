// Лампы: таблицы длин путей, привязка по доле длины, инерция, лампы на изломах.
import './lamp-motion.js'; // initialisation order: this module runs after it
import { getLampEvaluationConfig } from '../core/defaults-layers.js';
import { requestMainCanvasRender } from '../core/scheduler.js';
import { runtimeState, state } from '../core/state.js';
import { buildPathLengthTable, pointAtPathDistance } from '../geometry/frame-paths.js';
import { splineCubicPoint } from '../geometry/spline-rounding.js';
import { lampMotionRuntime, lampVisualNow } from './lamp-motion.js';
import { capLampPointList } from './lamp-points.js';
import { lampAdaptiveFrame } from './lamp-visual.js';

// FrameContour creates fresh immutable path objects every render frame.
// Many lamps sample the same rounded rail: calculate its arc table once
// rather than walking every segment once per lamp. Other dynamic path
// types retain the uncached behavior because their points may mutate.
const lampFrameContourLengthTables = new WeakMap();
function lampPathTable(path) {
  if (path?.__frameContour === true) {
    let table = lampFrameContourLengthTables.get(path);
    if (!table) {
      table = buildPathLengthTable([{ points: path.points || [], closed: Boolean(path.closed) }]);
      lampFrameContourLengthTables.set(path, table);
    }
    return table;
  }
  return buildPathLengthTable([{ points: path?.points || [], closed: Boolean(path?.closed) }]);
}
function lampPointAtFraction(path, fraction) {
  const table = lampPathTable(path);
  if (table.total <= 1e-8) return null;
  let f = Number(fraction) || 0;
  if (path?.closed) {
    f = ((f % 1) + 1) % 1;
  } else f = Math.max(0, Math.min(1, f));
  const distance = f * table.total;
  if (path?._bezierSegments?.length && path.points[0]?.__webExactCubicIndex === 0) {
    let lo = 0, hi = table.segs.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const segment = table.segs[mid];
      if (segment.start + segment.len < distance) lo = mid + 1;
      else hi = mid;
    }
    const { a, b, start, len } = table.segs[lo];
    const source = path.points;
    // Length tables retain the sampled points, including their cubic station.
    const index = b.__webExactCubicIndex;
    const cubic = path._bezierSegments[index];
    if (cubic && b !== source[0]) {
      const from = a.__webExactCubicIndex === index ? a.__webExactCubicT : 0;
      const mix = Math.max(0, Math.min(1, (distance - start) / len));
      return splineCubicPoint(cubic, from + (b.__webExactCubicT - from) * mix);
    }
  }
  return pointAtPathDistance(table, distance);
}
function nearestLampFractionOnPath(anchor, path) {
  const pts = path?.points || [];
  if (pts.length < 2) return { fraction: 0, point: { x: Number(anchor?.x) || 0, y: Number(anchor?.y) || 0 } };
  const table = lampPathTable(path);
  if (table.total <= 1e-8) return { fraction: 0, point: { x: pts[0].x, y: pts[0].y } };
  let bestD = Infinity,
    bestDistance = 0,
    bestPoint = { x: pts[0].x, y: pts[0].y };
  for (const seg of table.segs) {
    const a = seg.a,
      b = seg.b,
      vx = b.x - a.x,
      vy = b.y - a.y,
      den = vx * vx + vy * vy;
    const u =
      den > 1e-12
        ? Math.max(
            0,
            Math.min(
              1,
              (((Number(anchor?.x) || 0) - a.x) * vx + ((Number(anchor?.y) || 0) - a.y) * vy) / den,
            ),
          )
        : 0;
    const x = a.x + vx * u,
      y = a.y + vy * u,
      dx = x - (Number(anchor?.x) || 0),
      dy = y - (Number(anchor?.y) || 0),
      d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      bestDistance = seg.start + seg.len * u;
      bestPoint = { x, y };
    }
  }
  return { fraction: Math.max(0, Math.min(1, bestDistance / table.total)), point: bestPoint };
}
function nearestLampSegmentRefOnPath(anchor, path) {
  const pts = path?.points || [];
  if (pts.length < 2) return null;
  const closed = Boolean(path?.closed),
    count = closed ? pts.length : pts.length - 1;
  const ax = Number(anchor?.x) || 0,
    ay = Number(anchor?.y) || 0;
  let best = null,
    bestD2 = Infinity;
  for (let i = 0; i < count; i++) {
    const a = pts[i],
      b = pts[(i + 1) % pts.length];
    const x0 = Number(a?.x) || 0,
      y0 = Number(a?.y) || 0,
      x1 = Number(b?.x) || 0,
      y1 = Number(b?.y) || 0;
    const vx = x1 - x0,
      vy = y1 - y0,
      den = vx * vx + vy * vy;
    const q = den > 1e-12 ? Math.max(0, Math.min(1, ((ax - x0) * vx + (ay - y0) * vy) / den)) : 0;
    const x = x0 + vx * q,
      y = y0 + vy * q,
      dx = x - ax,
      dy = y - ay,
      d2 = dx * dx + dy * dy;
    if (d2 < bestD2) {
      bestD2 = d2;
      best = { segmentIndex: i, u: q, a: { x: x0, y: y0 }, b: { x: x1, y: y1 }, point: { x, y } };
    }
  }
  return best;
}
function lampRenderSegmentParam(path, ref) {
  const pts = path?.points || [];
  if (!ref || pts.length < 2) return NaN;
  const count = path?.closed ? pts.length : pts.length - 1;
  if (count <= 0) return NaN;
  const i = Math.max(0, Math.min(count - 1, Math.round(Number(ref.segmentIndex) || 0)));
  const u = Math.max(0, Math.min(1, Number(ref.u) || 0));
  let q = (i + u) / count;
  if (path?.closed) q = ((q % 1) + 1) % 1;
  else q = Math.max(0, Math.min(1, q));
  return q;
}
function lampPointAtRenderSegmentParam(path, param) {
  const pts = path?.points || [];
  if (pts.length < 2 || !Number.isFinite(Number(param))) return null;
  const closed = Boolean(path?.closed),
    count = closed ? pts.length : pts.length - 1;
  if (count <= 0) return null;
  let q = Number(param) || 0;
  q = closed ? ((q % 1) + 1) % 1 : Math.max(0, Math.min(1, q));

  if (!closed && q >= 1 - 1e-12) {
    const p = pts[pts.length - 1];
    return { x: Number(p?.x) || 0, y: Number(p?.y) || 0 };
  }
  const z = q * count,
    idx = Math.max(0, Math.min(count - 1, Math.floor(z)));
  const u = Math.max(0, Math.min(1, z - idx));
  const a = pts[idx],
    b = pts[(idx + 1) % pts.length];
  return {
    x: (Number(a?.x) || 0) + ((Number(b?.x) || 0) - (Number(a?.x) || 0)) * u,
    y: (Number(a?.y) || 0) + ((Number(b?.y) || 0) - (Number(a?.y) || 0)) * u,
  };
}
function interpolateLampRenderSegmentParam(sourceParam, targetParam, t, closed) {
  const u = Math.max(0, Math.min(1, Number(t) || 0));
  let a = Number(sourceParam),
    b = Number(targetParam);
  if (!Number.isFinite(a) && !Number.isFinite(b)) return NaN;
  if (!Number.isFinite(a)) a = b;
  if (!Number.isFinite(b)) b = a;
  if (closed) {
    a = ((a % 1) + 1) % 1;
    b = ((b % 1) + 1) % 1;
    let d = b - a;
    d = ((((d + 0.5) % 1) + 1) % 1) - 0.5;
    return (((a + d * u) % 1) + 1) % 1;
  }
  return Math.max(0, Math.min(1, a + (b - a) * u));
}
function interpolateLampSegmentRefs(sourceRef, targetRef, t, fallbackSource = null, fallbackTarget = null) {
  const u = Math.max(0, Math.min(1, Number(t) || 0));
  if (!sourceRef && !targetRef) {
    if (!fallbackSource && !fallbackTarget) return null;
    const a = fallbackSource || fallbackTarget,
      b = fallbackTarget || fallbackSource;
    return {
      x: (Number(a?.x) || 0) + ((Number(b?.x) || 0) - (Number(a?.x) || 0)) * u,
      y: (Number(a?.y) || 0) + ((Number(b?.y) || 0) - (Number(a?.y) || 0)) * u,
    };
  }
  if (!sourceRef) sourceRef = targetRef;
  if (!targetRef) targetRef = sourceRef;
  const sa = sourceRef.a || sourceRef.point,
    sb = sourceRef.b || sourceRef.point;
  let ta = targetRef.a || targetRef.point,
    tb = targetRef.b || targetRef.point;
  let tu = Math.max(0, Math.min(1, Number(targetRef.u) || 0));
  const su = Math.max(0, Math.min(1, Number(sourceRef.u) || 0));

  const d2 = (p, q) => {
    const dx = (Number(p?.x) || 0) - (Number(q?.x) || 0),
      dy = (Number(p?.y) || 0) - (Number(q?.y) || 0);
    return dx * dx + dy * dy;
  };
  if (d2(sa, tb) + d2(sb, ta) < d2(sa, ta) + d2(sb, tb)) {
    const tmp = ta;
    ta = tb;
    tb = tmp;
    tu = 1 - tu;
  }
  const ax = (Number(sa?.x) || 0) + ((Number(ta?.x) || 0) - (Number(sa?.x) || 0)) * u;
  const ay = (Number(sa?.y) || 0) + ((Number(ta?.y) || 0) - (Number(sa?.y) || 0)) * u;
  const bx = (Number(sb?.x) || 0) + ((Number(tb?.x) || 0) - (Number(sb?.x) || 0)) * u;
  const by = (Number(sb?.y) || 0) + ((Number(tb?.y) || 0) - (Number(sb?.y) || 0)) * u;
  const q = su + (tu - su) * u;
  return { x: ax + (bx - ax) * q, y: ay + (by - ay) * q };
}
function nearestLampFractionOnPathStable(anchor, path, referenceFraction) {
  const pts = path?.points || [];
  if (pts.length < 2 || !Number.isFinite(Number(referenceFraction)))
    return nearestLampFractionOnPath(anchor, path);
  const table = lampPathTable(path);
  if (table.total <= 1e-8) return nearestLampFractionOnPath(anchor, path);
  const ax = Number(anchor?.x) || 0,
    ay = Number(anchor?.y) || 0;
  let ref = Number(referenceFraction) || 0;
  ref = path?.closed ? ((ref % 1) + 1) % 1 : Math.max(0, Math.min(1, ref));
  let bestScore = Infinity,
    bestDistance = 0,
    bestPoint = { x: pts[0].x, y: pts[0].y };

  const continuityScale = Math.max(8, table.total * 0.18);
  const prune = table.segs.length >= 48;
  for (const seg of table.segs) {
    const a = seg.a,
      b = seg.b;
    // 8.14: the final score contains a non-negative arc penalty.
    // Squared distance to this segment's AABB is a conservative lower
    // bound; if it already exceeds the best score, projection cannot win.
    // Preserve ties and small-path behavior. No approximation to the rail.
    if (prune && bestScore < Infinity) {
      const minX = Math.min(a.x, b.x),
        maxX = Math.max(a.x, b.x);
      const minY = Math.min(a.y, b.y),
        maxY = Math.max(a.y, b.y);
      const dx0 = ax < minX ? minX - ax : ax > maxX ? ax - maxX : 0;
      const dy0 = ay < minY ? minY - ay : ay > maxY ? ay - maxY : 0;
      if (dx0 * dx0 + dy0 * dy0 > bestScore) continue;
    }
    const vx = b.x - a.x,
      vy = b.y - a.y,
      den = vx * vx + vy * vy;
    const u = den > 1e-12 ? Math.max(0, Math.min(1, ((ax - a.x) * vx + (ay - a.y) * vy) / den)) : 0;
    const x = a.x + vx * u,
      y = a.y + vy * u,
      dx = x - ax,
      dy = y - ay;
    const distance = seg.start + seg.len * u;
    const f = Math.max(0, Math.min(1, distance / table.total));
    let arcDelta = Math.abs(f - ref);
    if (path?.closed) arcDelta = Math.min(arcDelta, 1 - arcDelta);
    const arcPenalty = arcDelta * continuityScale;
    const score = dx * dx + dy * dy + arcPenalty * arcPenalty;
    if (score < bestScore) {
      bestScore = score;
      bestDistance = distance;
      bestPoint = { x, y };
    }
  }
  return { fraction: Math.max(0, Math.min(1, bestDistance / table.total)), point: bestPoint };
}
function nearestLampFractionOnPathSegmentBound(anchor, path, referenceFraction, windowFraction = 0.1) {
  const pts = path?.points || [];
  if (pts.length < 2 || !Number.isFinite(Number(referenceFraction)))
    return nearestLampFractionOnPath(anchor, path);
  const table = lampPathTable(path);
  if (table.total <= 1e-8) return nearestLampFractionOnPath(anchor, path);
  const ax = Number(anchor?.x) || 0,
    ay = Number(anchor?.y) || 0;
  let ref = Number(referenceFraction) || 0;
  ref = path?.closed ? ((ref % 1) + 1) % 1 : Math.max(0, Math.min(1, ref));
  const win = Math.max(0.012, Math.min(0.24, Number(windowFraction) || 0.1));
  let bestScore = Infinity,
    bestDistance = NaN,
    bestPoint = null;
  const continuityScale = Math.max(2, table.total * 0.025);
  const prune = table.segs.length >= 48;
  for (const seg of table.segs) {
    const a = seg.a,
      b = seg.b;
    // 8.14: the final score contains a non-negative arc penalty.
    // Squared distance to this segment's AABB is a conservative lower
    // bound; if it already exceeds the best score, projection cannot win.
    // Preserve ties and small-path behavior. No approximation to the rail.
    if (prune && bestScore < Infinity) {
      const minX = Math.min(a.x, b.x),
        maxX = Math.max(a.x, b.x);
      const minY = Math.min(a.y, b.y),
        maxY = Math.max(a.y, b.y);
      const dx0 = ax < minX ? minX - ax : ax > maxX ? ax - maxX : 0;
      const dy0 = ay < minY ? minY - ay : ay > maxY ? ay - maxY : 0;
      if (dx0 * dx0 + dy0 * dy0 > bestScore) continue;
    }
    const vx = b.x - a.x,
      vy = b.y - a.y,
      den = vx * vx + vy * vy;
    const su = den > 1e-12 ? Math.max(0, Math.min(1, ((ax - a.x) * vx + (ay - a.y) * vy) / den)) : 0;
    const distance = seg.start + seg.len * su;
    const f = Math.max(0, Math.min(1, distance / table.total));
    let arcDelta = Math.abs(f - ref);
    if (path?.closed) arcDelta = Math.min(arcDelta, 1 - arcDelta);
    const segMargin = Math.min(0.025, (seg.len / Math.max(1e-8, table.total)) * 0.75);
    if (arcDelta > win + segMargin) continue;
    const x = a.x + vx * su,
      y = a.y + vy * su,
      dx = x - ax,
      dy = y - ay;
    const arcPenalty = arcDelta * continuityScale;
    const score = dx * dx + dy * dy + arcPenalty * arcPenalty;
    if (score < bestScore) {
      bestScore = score;
      bestDistance = distance;
      bestPoint = { x, y };
    }
  }
  if (!bestPoint) return { fraction: ref, point: lampPointAtFraction(path, ref) };
  return { fraction: Math.max(0, Math.min(1, bestDistance / table.total)), point: bestPoint };
}
// Clip each candidate segment to this vertex's interval in contour order.
function projectKeyLamp(anchor, path, stations, i) {
  const table = lampPathTable(path);
  if (!table.total) return anchor;
  const ref = stations[i], last = stations.length - 1;
  const prev = i ? stations[i - 1] : path.closed ? stations[last] - 1 : ref;
  const next = i < last ? stations[i + 1] : path.closed ? stations[0] + 1 : ref;
  const lo = (prev + ref) * table.total / 2, hi = (next + ref) * table.total / 2;
  let best = Infinity, fraction = ref;
  for (const seg of table.segs) {
    if (!(seg.len > 0)) continue;
    const dx = seg.b.x - seg.a.x, dy = seg.b.y - seg.a.y;
    const u = ((anchor.x - seg.a.x) * dx + (anchor.y - seg.a.y) * dy) / (seg.len * seg.len);
    for (const shift of (lo < 0 ? [-table.total, 0] : hi > table.total ? [0, table.total] : [0])) {
      const start = seg.start + shift;
      const left = Math.max(0, (lo - start) / seg.len), right = Math.min(1, (hi - start) / seg.len);
      if (left > right) continue;
      const t = Math.max(left, Math.min(right, u));
      const d = (seg.a.x + t * dx - anchor.x) ** 2 + (seg.a.y + t * dy - anchor.y) ** 2;
      if (d < best) { best = d; fraction = (seg.start + t * seg.len) / table.total; }
    }
  }
  return lampPointAtFraction(path, fraction) || anchor;
}
function advanceLampPathFraction(current, target, closed, dtMs, responseMs = 190) {
  let c = Number(current) || 0,
    t = Number(target) || 0;
  let delta = t - c;
  if (closed) {
    delta = ((((delta + 0.5) % 1) + 1) % 1) - 0.5;
  }
  const k = 1 - Math.exp(-Math.max(0, dtMs) / Math.max(24, responseMs));
  c += delta * k;
  return closed ? ((c % 1) + 1) % 1 : Math.max(0, Math.min(1, c));
}
function advanceLampPathFractionLinear(current, target, path, dtMs) {
  let c = Number(current) || 0,
    t = Number(target) || 0;
  const closed = Boolean(path?.closed);
  let delta = t - c;
  if (closed) delta = ((((delta + 0.5) % 1) + 1) % 1) - 0.5;
  const total = Math.max(1, Number(lampPathTable(path).total) || 1);
  const cycleMs = Math.max(
    100,
    Number(runtimeState.morph?.transitionMs) || Math.max(0.5, Number(state.morph?.intervalSec) || 5) * 1000,
  );
  const cycleSec = Math.max(0.1, cycleMs / 1000);

  const speedPxPerSec = Math.max(120, (total / cycleSec) * 2.5);
  const step = (speedPxPerSec * Math.max(0, dtMs)) / 1000 / total;
  if (Math.abs(delta) <= step + 1e-9) c = t;
  else c += Math.sign(delta) * step;
  return closed ? ((c % 1) + 1) % 1 : Math.max(0, Math.min(1, c));
}
// Signed phase inertia is a TIME WARP for lamp attachments, never the
// geometry/anchor morph. It is deterministic and independent of FPS.
function lampPhaseInertiaProgress(t, cfg = getLampEvaluationConfig()) {
  const u = Math.max(0, Math.min(1, Number(t) || 0));
  const pct = Math.max(-100, Math.min(100, Number(cfg?.morphInertia) || 0));
  if (cfg?.morphMotionMode === 'linear' || pct === 0) return u;
  if (pct <= -100) return 1; // endpoint follows moving target contour
  if (pct >= 100) return u >= 1 ? 1 : 0;
  // Ease along the same owned arc interval: positive = accelerating
  // (ease-in), negative = decelerating (ease-out). No hold-then-rush
  // plateau for intermediate inertia and no frame-time dependency.
  const abs = Math.abs(pct) / 100;
  const exponent = 1 + (4 * abs) / (1 - abs);
  return pct > 0 ? Math.pow(u, exponent) : 1 - Math.pow(1 - u, exponent);
}
function lampDynamicResponseMs(cfg = getLampEvaluationConfig()) {
  // Dynamic's physical chase is independent from the signed timing
  // control used for all four lamp-morph modes.
  return 190;
}
function advanceLampAttachmentFraction(current, target, path, dtMs, responseMs = 190) {
  if (runtimeState.morph?.active && ['linear', 'ghost'].includes(getLampEvaluationConfig()?.morphMotionMode))
    return advanceLampPathFractionLinear(current, target, path, dtMs);
  if (runtimeState.morph?.active && getLampEvaluationConfig()?.morphMotionMode === 'smooth')
    return advanceLampPathFractionLinear(current, target, path, dtMs);
  const dynamicMs =
    runtimeState.morph?.active && getLampEvaluationConfig()?.morphMotionMode === 'dynamic'
      ? lampDynamicResponseMs(getLampEvaluationConfig())
      : responseMs;
  return advanceLampPathFraction(current, target, Boolean(path?.closed), dtMs, dynamicMs);
}
function lampCornerInertiaMs(cfg = getLampEvaluationConfig(), layer) {
  if (layer && cfg?.cornerInertiaLinked !== false) return Math.max(0.1, Math.min(60, Number(layer.testMorph?.duration) || 1)) * 1000;
  const seconds = Number(cfg?.cornerInertiaSec ?? 0.5);
  return Math.max(0, Math.min(15, Number.isFinite(seconds) ? seconds : 0.5)) * 1000;
}
function moveLampLevel(current, target, dtMs, durationMs = 330) {
  const c = Math.max(0, Math.min(1, Number(current) || 0));
  const t = Math.max(0, Math.min(1, Number(target) || 0));
  const duration = Math.max(0, Number(durationMs) || 0);
  if (duration <= 0.001) return t;
  const step = Math.max(0, dtMs) / duration;
  return t > c ? Math.min(t, c + step) : Math.max(t, c - step);
}
function lampBendAnimationMs(frameCtx, cfg) {
  const actual = frameCtx?.lampAnimationMs;
  if (!frameCtx?.layer && cfg?.cornerInertiaLinked !== false && actual > 0) return actual;
  return lampCornerInertiaMs(cfg ?? frameCtx?.layerLampConfig ?? frameCtx?.layer?.lamps, frameCtx?.layer);
}
function updateLampBendLevel(entry, target, now, duration) {
  if (entry.bendTarget !== target) {
    entry.bendFrom = entry.level ?? 0;
    entry.bendSince = now;
    entry.bendDuration = duration;
    entry.bendTarget = target;
  }
  const t = entry.bendDuration <= 0 ? 1 : Math.max(0, Math.min(1, (now - entry.bendSince) / entry.bendDuration));
  entry.level = entry.bendFrom + (target - entry.bendFrom) * t;
  if (t < 1 && Math.abs(entry.level - target) > 0.002) {
    lampAdaptiveFrame.needsSettle = true;
    requestMainCanvasRender();
  }
  return entry.level;
}
function mergeLampKeysAndBends(keys, bends, maxPoints, extinguishIntersections = true) {
  const pos = (p) => `${p.pathIndex ?? 0}:${Math.round(p.x * 10)}:${Math.round(p.y * 10)}`;
  const seen = new Set(keys.map(pos));
  return capLampPointList(
    [
      ...keys,
      ...bends
        .filter((p) => {
          if (!extinguishIntersections) return true;
          const k = pos(p);
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        })
        .map((p) => (p.lampRank === 1 ? p : { ...p, lampRank: 1 })),
    ],
    maxPoints,
  );
}
// Match only by a stable bend ID. A vanished bend can keep its last
// attachment during release, but never inherits a different bend.
const lampBendTracks = new Map();
function trackLampBends(scope, points, now, duration, animate, reattach = null) {
  let track = lampBendTracks.get(scope);
  if (!track || now - track.last > Math.max(2000, duration * 2)) {
    track = { entries: new Map(), last: now };
    lampBendTracks.set(scope, track);
    for (const [key, old] of lampBendTracks)
      if (key !== scope && now - old.last > 120000) lampBendTracks.delete(key);
  }
  track.last = now;
  const current = new Map(points.map((p) => [p.lampId, p]));
  for (const p of points) {
    if (!track.entries.has(p.lampId)) track.entries.set(p.lampId, { point: p, level: animate ? 0 : 1 });
  }
  const out = [];
  for (const [id, e] of track.entries) {
    const p = current.get(id);
    if (p) e.point = p;
    else if (reattach) e.point = reattach(e.point) || e.point;
    const target = p ? 1 : 0;
    if (!animate && e.bendTarget === undefined) e.level = target;
    updateLampBendLevel(e, target, now, duration);
    if (e.level > 0.002) out.push({ ...e.point, lampLevel: e.level });
    else if (!p) track.entries.delete(id);
  }
  return out;
}
function cleanupLampRuntime(now = lampVisualNow()) {
  if (now - lampMotionRuntime.lastCleanup < 1200) return;
  lampMotionRuntime.lastCleanup = now;
  for (const map of [
    lampMotionRuntime.snap,
    lampMotionRuntime.profileAttach,
    lampMotionRuntime.calm,
    lampMotionRuntime.corners,
  ]) {
    for (const [key, v] of map) {
      if (now - (v.lastSeen || now) > 2200 && (v.level === undefined || v.level < 0.005)) map.delete(key);
    }
  }
}

export {
  advanceLampAttachmentFraction,
  advanceLampPathFractionLinear,
  cleanupLampRuntime,
  interpolateLampRenderSegmentParam,
  interpolateLampSegmentRefs,
  lampBendAnimationMs,
  lampBendTracks,
  lampCornerInertiaMs,
  lampPhaseInertiaProgress,
  lampPointAtFraction,
  lampPointAtRenderSegmentParam,
  lampRenderSegmentParam,
  mergeLampKeysAndBends,
  nearestLampFractionOnPath,
  nearestLampFractionOnPathSegmentBound,
  projectKeyLamp,
  nearestLampFractionOnPathStable,
  nearestLampSegmentRefOnPath,
  trackLampBends,
  updateLampBendLevel,
};
