// Лампы: точки на гладких углах, проекция на текущий многоугольник, произвольный морф.
import './lamp-attachment.js'; // initialisation order: this module runs after it
import { getLampEvaluationConfig } from '../core/defaults-layers.js';
import { getRoundingStrength } from '../core/palette.js';
import { runtimeState, state } from '../core/state.js';
import { getCachedLayerDrawData } from '../effects/motion.js';
import {
  buildCurrentMorphPaths,
  buildPathLengthTable,
  buildSinglePathLengthTable,
  collectArbitraryContourLampPoints,
  collectArbitraryStaticLampPoints,
  getCurrentMorphCpuPaths,
  pointAtPathDistance,
  stableArbitraryLampCountForPath,
  stableContourLampFractions,
} from '../geometry/frame-paths.js';
import { smoothMorphPath } from '../geometry/morph.js';
import { isSpiralLayer } from '../geometry/spiral/order-params.js';
import {
  isLampContourAttachmentEnabled,
  lampHash32,
  lampVertexArcFractions,
  nearestPointOnLampPaths,
} from './lamp-anchors.js';
import { lampMotionRuntime, lampTopologyPresence, lampVisualNow } from './lamp-motion.js';
import {
  advanceLampAttachmentFraction,
  advanceLampPathFractionLinear,
  cleanupLampRuntime,
  lampBendAnimationMs,
  lampPointAtFraction,
  lampPointAtRenderSegmentParam,
  nearestLampFractionOnPath,
  nearestLampFractionOnPathSegmentBound,
  nearestLampFractionOnPathStable,
  nearestLampOnPathInterval,
  updateLampBendLevel,
} from './lamp-attachment.js';
import { lampAdaptiveFrame } from './lamp-visual.js';
import {
  buildCurrentChaosCircleMorphPaths,
  buildCurrentCircleMorphPaths,
  isChaosCircleMorphPair,
} from '../effects/aux-paths.js';

function collectSmoothCornerLampPoints(layerIndex, paths, maxPoints = 260, animate = true) {
  const layer = state.layers[layerIndex];
  if (!layer) return [];
  paths = paths || [];
  const now = lampVisualNow();
  cleanupLampRuntime(now);
  const layerKey = String(layer.id || layerIndex);
  const targets = [];
  for (let pi = 0; pi < paths.length; pi++) {
    const path = paths[pi],
      pts = path?.points || [],
      flags = path?.cornerFlags || [],
      logicalFlags = path?.lampCornerFlags || [];
    if (pts.length < 2) continue;
    const spiralFractions =
      isSpiralLayer(layer) && typeof lampVertexArcFractions === 'function'
        ? lampVertexArcFractions(path)
        : null;
    for (let i = 0; i < pts.length; i++) {
      if (!path.closed && (i === 0 || i === pts.length - 1)) continue;
      const prev = pts[(i - 1 + pts.length) % pts.length],
        cur = pts[i],
        next = pts[(i + 1) % pts.length];
      const ax = cur.x - prev.x,
        ay = cur.y - prev.y,
        bx = next.x - cur.x,
        by = next.y - cur.y;
      const al = Math.hypot(ax, ay),
        bl = Math.hypot(bx, by);
      if (al < 1e-6 || bl < 1e-6) continue;
      const dot = Math.max(-1, Math.min(1, (ax * bx + ay * by) / (al * bl)));
      const turn = (Math.acos(dot) * 180) / Math.PI,
        logicalBend = logicalFlags[i] === true;

      if (!logicalBend && !flags[i] && turn < 9) continue;
      const x = Math.max(0, Math.min(1, (turn - 2) / 16));
      const strength = logicalBend ? 1 : x * x * (3 - 2 * x);
      if (strength <= 0.002) continue;
      const fraction = spiralFractions
        ? Math.max(0, Math.min(1, Number(spiralFractions[i]) || 0))
        : nearestLampFractionOnPath(cur, path).fraction;
      targets.push({ pathIndex: pi, pointIndex: i, fraction, strength });
      if (targets.length >= maxPoints) break;
    }
    if (targets.length >= maxPoints) break;
  }
  const prefix = `${layerKey}:corner:`;
  const calm = getLampEvaluationConfig()?.calmMode === true && !runtimeState.morph?.active;
  if (calm && !animate) {
    const out = [];
    const seen = new Set();
    for (const target of targets) {
      const path = paths[target.pathIndex];
      if (!path) continue;
      const key = `${prefix}calm:${target.pathIndex}:${target.pointIndex}`;
      seen.add(key);

      const p = lampPointAtFraction(path, target.fraction);
      if (p)
        out.push({
          ...p,
          pathIndex: target.pathIndex,
          vertexIndex: target.pointIndex,
          lampContourFraction: target.fraction,
          lampLevel: animate ? Math.max(0.05, target.strength) : 1,
          lampId: key,
          lampSeed: lampHash32(key),
        });
    }
    return capLampPointList(out, maxPoints);
  }
  const existing = [];
  for (const [key, e] of lampMotionRuntime.corners) {
    if (key.startsWith(prefix)) existing.push([key, e]);
  }
  const used = new Set();

  for (const target of targets) {
    const key = `${prefix}${target.pathIndex}:slot:${target.pointIndex}`;
    let e = lampMotionRuntime.corners.get(key);
    if (!e) {
      e = {
        pathIndex: target.pathIndex,
        s: target.fraction,
        targetS: target.fraction,
        level: 0,
        last: now,
        lastSeen: now,
      };
      lampMotionRuntime.corners.set(key, e);
    }
    used.add(key);
    e.pathIndex = target.pathIndex;
    e.targetS = target.fraction;

    e.target = 1; // Corner inertia is the attack/release time to full brightness during Morph; static corners are immediate.
    e.lastSeen = now;
  }

  for (const [key, e] of existing) {
    if (!used.has(key)) e.target = 0;
  }
  const out = [];
  for (const [key, e] of lampMotionRuntime.corners) {
    if (!key.startsWith(prefix)) continue;
    const path = paths[e.pathIndex];
    if (!path) e.target = 0;
    const rawDt = Math.max(0, now - (e.last || now)),
      dt = rawDt > 1250 ? 0 : rawDt;
    e.last = now;
    if (animate) {
      const targetLevel = Math.max(0, Math.min(1, Number(e.target) || 0));
      updateLampBendLevel(e, targetLevel, now, lampBendAnimationMs({ layer: state.layers[layerIndex] }, getLampEvaluationConfig()));
      if (path) e.s = advanceLampAttachmentFraction(e.s, e.targetS, path, dt, 210);
      if (Math.abs(e.level - targetLevel) > 0.002) lampAdaptiveFrame.needsSettle = true;
    } else {
      e.level = Math.max(0, Math.min(1, Number(e.target) || 0));
      e.s = Number.isFinite(Number(e.targetS)) ? Number(e.targetS) : e.s;
    }
    const p = path ? lampPointAtFraction(path, e.s) : e.lastPoint;
    if (p) e.lastPoint = p;
    if (p && e.level > 0.002)
      out.push({
        ...p,
        pathIndex: e.pathIndex,
        lampContourFraction: e.s,
        lampLevel: e.level,
        lampId: key,
        lampSeed: lampHash32(key),
      });
  }
  return capLampPointList(out, maxPoints);
}
// Correspondence between semantic orbit paths (stable lamp identity) and
// independently assembled visible FrameContour paths.  Bézier subdivision
// and concatenation are allowed to reorder the latter, so the same numeric
// pathIndex cannot be assumed to mean the same line.  Compare a few points
// on each WHOLE source orbit (never the individual lamp, which could cross
// another line).  The result is computed once per lamp group / frame.
function mapLampSemanticPathsToVisible(semanticPaths, visiblePaths) {
  const source = Array.isArray(semanticPaths) ? semanticPaths : [];
  const visible = Array.isArray(visiblePaths) ? visiblePaths : [];
  const result = new Array(source.length).fill(-1);
  if (!source.length || !visible.length) return result;
  if (source.length === 1 && visible.length === 1) {
    result[0] = 0;
    return result;
  }
  const samples = source.map((path) => {
    const pts = path?.points || [];
    if (!pts.length) return [];
    const n = Math.min(7, pts.length),
      out = [];
    for (let k = 0; k < n; k++) out.push(pts[Math.round((k * (pts.length - 1)) / Math.max(1, n - 1))]);
    return out;
  });
  const costs = [];
  for (let si = 0; si < source.length; si++) {
    if (!samples[si].length) continue;
    for (let vi = 0; vi < visible.length; vi++) {
      const path = visible[vi],
        pts = path?.points || [];
      if (pts.length < 2) continue;
      const n = path.closed ? pts.length : pts.length - 1;
      let sum = 0;
      for (const p of samples[si]) {
        const x = Number(p.x) || 0,
          y = Number(p.y) || 0;
        let nearest = Infinity;
        for (let j = 0; j < n; j++) {
          const a = pts[j],
            b = pts[(j + 1) % pts.length],
            dx = b.x - a.x,
            dy = b.y - a.y,
            den = dx * dx + dy * dy;
          const t = den > 1e-12 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / den)) : 0;
          const ex = a.x + dx * t - x,
            ey = a.y + dy * t - y,
            d = ex * ex + ey * ey;
          if (d < nearest) nearest = d;
          if (nearest < 1e-14) break;
        }
        sum += nearest;
      }
      // Stable numeric order is a tie-break, NOT an identity contract.
      costs.push({
        si,
        vi,
        score: sum / samples[si].length + (source[si]?.closed !== path.closed ? 1e-6 : 0),
      });
    }
  }
  costs.sort(
    (a, b) =>
      a.score - b.score || Math.abs(a.si - a.vi) - Math.abs(b.si - b.vi) || a.si - b.si || a.vi - b.vi,
  );
  const used = new Set();
  for (const c of costs) {
    if (result[c.si] < 0 && !used.has(c.vi)) {
      result[c.si] = c.vi;
      used.add(c.vi);
    }
  }
  // One source line may be split into multiple drawn pieces.  In that
  // case reuse its best candidate rather than snapping to another orbit.
  for (let si = 0; si < result.length; si++)
    if (result[si] < 0) {
      const best = costs.find((c) => c.si === si);
      if (best) result[si] = best.vi;
    }
  return result;
}
function projectLampPointsToCurrentPolygon(
  points,
  paths,
  layer,
  pathsPreparedRounded = false,
  forceNearest = false,
  semanticPaths = null,
) {
  if (!points?.length || !paths?.length) return points || [];
  const circumferenceMode = forceNearest || getLampEvaluationConfig()?.positionMode === 'circumference';
  const attach = circumferenceMode || isLampContourAttachmentEnabled();
  const calm =
    getLampEvaluationConfig()?.calmMode === true && !circumferenceMode && !runtimeState.morph?.active;
  if (!attach) return points;

  const attachmentPaths = paths;
  const now = lampVisualNow();
  cleanupLampRuntime(now);
  const layerKey = String(layer?.id || 'layer');
  const authoritativeVisualRail = attachmentPaths?.__somataFrameContour === true;
  const phase = runtimeState.morph?.lampCycleSerial ?? 0;
  const semanticMap =
    authoritativeVisualRail && Array.isArray(semanticPaths) && semanticPaths.length
      ? mapLampSemanticPathsToVisible(semanticPaths, attachmentPaths)
      : null;
  return points.map((p, index) => {
    const pi = Number.isInteger(p?.pathIndex) ? p.pathIndex : -1;
    const mapped = semanticMap && pi >= 0 ? semanticMap[pi] : pi;
    const ownIndex =
      Number.isInteger(mapped) && mapped >= 0 && attachmentPaths[mapped]?.points?.length > 1 ? mapped : -1;
    const path = ownIndex >= 0 ? attachmentPaths[ownIndex] : null;

    // FrameContour segment subdivision is the actual visible profile subdivision,
    // not the canonical topology segment numbering used to preserve lamp identity.
    // Never reuse a frozen canonical render-segment parameter on it. Project the
    // identity point onto the corresponding visible contour (or globally if needed).
    if (pathsPreparedRounded && runtimeState.morph?.active) {
      // Topology identity and visual attachment are separate concerns.  The old
      // nearest-point projection could jump to a different nearby branch of the
      // spline from one frame to the next.  Once a lamp owns a profile path, keep
      // an arc coordinate on that path and move along the rail itself.  Linear
      // topology already publishes a continuous lampAttachFraction, so use it
      // directly rather than solving nearest geometry again.
      const identity = String(p?.lampId ?? `${pi}:${p?.vertexIndex ?? index}`);
      const key = `${layerKey}:profile-arc:${identity}`;
      let rt = lampMotionRuntime.profileAttach.get(key);
      const visualPathIndex = rt?.phase === phase && rt.semanticIndex === pi ? rt.pathIndex : ownIndex;
      const visualPath = attachmentPaths[visualPathIndex];
      // A lamp with a semantic orbit may never jump to a globally
      // nearest *different* line at a crossing.  No false attachment
      // is preferable to snapping to the wrong orbit.
      if (!visualPath?.points?.length)
        return {
          ...p,
          // A missing semantic rail must not paint its lamp at an
          // unattached Cartesian fallback, which looks like a teleport.
          lampLevel: 0,
          pathIndex: pi,
          vertexIndex: p?.vertexIndex,
        };
      const direct = Number(p?.lampAttachFraction);
      let targetS;
      if (Number.isFinite(direct)) {
        const wrapS = (v) => (visualPath.closed ? ((v % 1) + 1) % 1 : Math.max(0, Math.min(1, v)));
        const base = wrapS(direct);
        // Доля i/N отсчитывается от начала видимого контура, а при скруглении оно лежит у края
        // дуги, не на вершине: лампа вставала на ~2° дальше по дуге и в первом кадре морфа
        // «соскакивала» с вершины скругления. Когда лампа появляется (начало фазы), находим
        // точку видимого контура, ближайшую к самой вершине (как в статике), и дальше ведём
        // лампу с этой поправкой.
        let offset = rt?.phase === phase && rt.pathIndex === visualPathIndex ? Number(rt.directOffset) || 0 : null;
        if (offset === null) {
          const endpoint = p.lampOpenCircleEndpoint;
          const near = endpoint === undefined
            ? nearestLampFractionOnPath(p, visualPath)
            : nearestLampOnPathInterval(p, visualPath, endpoint * 0.5, 0.5 + endpoint * 0.5, endpoint);
          let d = Number(near?.fraction) - base;
          if (visualPath.closed) d -= Math.round(d);
          offset = Number.isFinite(d) && Math.abs(d) < 0.25 ? d : 0;
        }
        targetS = wrapS(base + offset);
        if (rt) rt.directOffset = offset;
        else rt = { pendingOffset: offset };
      } else {
        const ref = rt?.phase === phase && Number.isFinite(rt.targetS)
          ? rt.targetS
          : Number.isFinite(Number(p?.lampContourFraction))
            ? Number(p.lampContourFraction)
            : NaN;
        const window = Math.min(0.09, 0.45 / Math.max(4, semanticPaths?.[pi]?.points?.length || 0));
        const near = Number.isFinite(ref)
          ? nearestLampFractionOnPathSegmentBound(p, visualPath, ref, window)
          : nearestLampFractionOnPath(p, visualPath);
        targetS = near.fraction;
      }
      if (!rt || rt.phase !== phase || rt.pathIndex !== visualPathIndex) {
        const directOffset = rt?.pendingOffset ?? rt?.directOffset;
        rt = {
          phase, semanticIndex: pi, pathIndex: visualPathIndex, s: targetS, targetS,
          last: now, lastSeen: now, directOffset,
        };
        lampMotionRuntime.profileAttach.set(key, rt);
      }
      const rawDt = Math.max(0, now - (rt.last || now)),
        dt = rawDt > 1250 ? 0 : rawDt;
      rt.last = now;
      rt.lastSeen = now;
      rt.pathIndex = visualPathIndex;
      rt.targetS = targetS;
      // A published topology attach fraction is already a continuous morph
      // coordinate.  Corner/fallback points instead chase their target fraction
      // with bounded arc motion so they cannot teleport across a crossing.
      rt.s =
        Number.isFinite(direct)
          ? targetS
          : advanceLampPathFractionLinear(rt.s, targetS, visualPath, dt);
      const q = lampPointAtFraction(visualPath, rt.s);
      return q
        ? {
            ...p,
            ...q,
            pathIndex: visualPathIndex,
            vertexIndex: p?.vertexIndex,
            lampContourFraction: rt.s,
            __lampVisualProfileAttached: true,
          }
        : {
            ...p,
            pathIndex: visualPathIndex,
            vertexIndex: p?.vertexIndex,
            __lampVisualProfileAttached: true,
          };
    }

    // Linear attachment must never reselect the nearest segment.
    // The same semantic path and phase-interpolated arc fraction
    // determine the lamp coordinate for every contour family.
    if (
      runtimeState.morph?.active &&
      getLampEvaluationConfig()?.morphMotionMode === 'linear' &&
      path &&
      Number.isFinite(Number(p?.lampAttachFraction))
    ) {
      const fraction = Number(p.lampAttachFraction);
      const q = lampPointAtFraction(path, fraction);
      if (q)
        return {
          ...p,
          ...q,
          pathIndex: pi,
          vertexIndex: p?.vertexIndex,
          lampContourFraction: fraction,
          __lampVisualProfileAttached: true,
        };
    }
    if (
      runtimeState.morph?.active &&
      getLampEvaluationConfig()?.morphMotionMode === 'linear' &&
      (state.morph.mode === 'topology' || state.morph.mode === 'calm') &&
      p?.lampFixedSegmentBound === true &&
      path
    ) {
      const q = lampPointAtRenderSegmentParam(path, Number(p?.lampAttachRenderSegmentParam));
      if (q) return { ...p, ...q, pathIndex: pi, vertexIndex: p?.vertexIndex };
      return { ...p, pathIndex: pi, vertexIndex: p?.vertexIndex };
    }
    if (!path) {
      if (calm) return { ...p, pathIndex: pi, vertexIndex: p?.vertexIndex, lampLevel: p?.lampLevel };
      if (runtimeState.morph?.active && getLampEvaluationConfig()?.morphMotionMode === 'linear')
        return { ...p, lampLevel: 0, pathIndex: pi, vertexIndex: p?.vertexIndex };
      const q = nearestPointOnLampPaths(p, attachmentPaths, 0, false);
      return { ...p, ...q, pathIndex: pi, vertexIndex: p?.vertexIndex };
    }
    const vi = Number.isInteger(p?.vertexIndex) ? p.vertexIndex : index;
    const identity = p?.lampId ? String(p.lampId) : `${pi}:${vi}`;

    if (isSpiralLayer(layer) && Number.isFinite(Number(p?.lampContourFraction))) {
      const q = lampPointAtFraction(path, Number(p.lampContourFraction));
      if (q) return { ...p, ...q, pathIndex: pi, vertexIndex: p?.vertexIndex };
    }

    if (
      runtimeState.morph?.active &&
      getLampEvaluationConfig()?.morphMotionMode === 'linear' &&
      (state.morph.mode === 'topology' || state.morph.mode === 'calm') &&
      Number.isFinite(Number(p?.lampAttachFraction))
    ) {
      const phase = Math.max(
        0,
        Math.min(1, Number(p?.lampAttachProgress ?? runtimeState.morph?.progress) || 0),
      );
      const bound = nearestLampFractionOnPathSegmentBound(
        p,
        path,
        Number(p.lampAttachFraction),
        Number(p?.lampAttachSegmentWindow) || 0.1,
      );
      if (bound?.point) {
        return {
          ...p,
          ...bound.point,
          lampAttachFraction: bound.fraction,
          pathIndex: pi,
          vertexIndex: p?.vertexIndex,
        };
      }
    }
    if (calm) {
      const near = nearestLampFractionOnPath(p, path);
      const key = `${layerKey}:calm:${identity}`;
      let rt = lampMotionRuntime.calm.get(key);
      if (!rt) {
        rt = { s: near.fraction, lastSeen: now };
        lampMotionRuntime.calm.set(key, rt);
      }
      rt.lastSeen = now;

      const q = lampPointAtFraction(path, rt.s) || near.point;
      return { ...p, ...q, pathIndex: pi, vertexIndex: p?.vertexIndex };
    }
    const key = `${layerKey}:snap:${identity}`;
    let rt = lampMotionRuntime.snap.get(key);
    if (!rt) {
      const initial = nearestLampFractionOnPath(p, path);
      rt = { s: initial.fraction, targetS: initial.fraction, last: now, lastSeen: now };
      lampMotionRuntime.snap.set(key, rt);
    }

    const near = nearestLampFractionOnPathStable(
      p,
      path,
      Number.isFinite(Number(rt.targetS)) ? rt.targetS : rt.s,
    );
    const rawDt = Math.max(0, now - (rt.last || now)),
      dt = rawDt > 1250 ? 0 : rawDt;
    rt.last = now;
    rt.lastSeen = now;
    rt.targetS = near.fraction;
    if (
      runtimeState.morph?.active &&
      ['linear', 'ghost'].includes(getLampEvaluationConfig()?.morphMotionMode)
    ) {
      if (
        getLampEvaluationConfig()?.morphMotionMode === 'linear' &&
        (state.morph.mode === 'topology' || state.morph.mode === 'calm')
      )
        rt.s = advanceLampPathFractionLinear(rt.s, rt.targetS, path, dt);
      else rt.s = rt.targetS;
    } else {
      rt.s = advanceLampAttachmentFraction(rt.s, rt.targetS, path, dt, 190);
    }
    const q = lampPointAtFraction(path, rt.s) || near.point;
    return { ...p, ...q, pathIndex: pi, vertexIndex: p?.vertexIndex };
  });
}
function pathCentralSegmentPoints(path, fraction) {
  const pts = path?.points || [];
  if (pts.length < 2) return [];
  const table = buildPathLengthTable([{ points: pts, closed: Boolean(path.closed) }]);
  if (table.total <= 1e-6) return [];
  const f = Math.max(0.05, Math.min(1, Number(fraction) || 0.3));
  const start = (1 - f) * 0.5 * table.total,
    end = (1 + f) * 0.5 * table.total,
    span = Math.max(1e-6, end - start);
  const samples = Math.max(8, Math.min(240, Math.ceil(span / 4)));
  const out = [];
  for (let i = 0; i <= samples; i++) out.push(pointAtPathDistance(table, start + span * (i / samples)));
  return out;
}
function drawLightningCentralMorph(ctx, layerIndex, layer, t, alpha) {
  if (alpha <= 0.001) return;
  let paths = getCurrentMorphCpuPaths(layerIndex, t, 'lightning-central');
  if (!paths.length) {
    const dd = getCachedLayerDrawData(layer);
    paths = dd?.paths || [];
  }
  const roundingFrac = getRoundingStrength(layer.rounding);
  const fraction = Math.max(0.05, Math.min(1, (Number(state.morph.lightningSegmentPercent) || 30) / 100));
  const glow = Math.max(0, Math.min(80, Number(state.morph.lightningGlow) || 0));
  const color = runtimeState.morph.lightningCycleColor || '#ffffff';
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = color;
  ctx.fillStyle = 'transparent';
  const baseWidth = Math.max(0.25, Number(ctx.lineWidth) || 1.5);
  for (const path of paths) {
    let renderPts = path.points || [];
    if (roundingFrac > 0.001 && renderPts.length > 2)
      renderPts = smoothMorphPath(renderPts, path.closed, roundingFrac, path.cornerFlags || []);
    const seg = pathCentralSegmentPoints({ points: renderPts, closed: path.closed }, fraction);
    if (seg.length < 2) continue;
    ctx.beginPath();
    ctx.moveTo(seg[0].x, seg[0].y);
    for (let i = 1; i < seg.length; i++) ctx.lineTo(seg[i].x, seg[i].y);
    if (glow > 0) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, alpha * 0.74));
      ctx.shadowColor = color;
      ctx.shadowBlur = glow;
      ctx.lineWidth = baseWidth + Math.min(baseWidth * 2.5, glow * 0.12);
      ctx.stroke();
      ctx.restore();
    }
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    ctx.shadowColor = color;
    ctx.shadowBlur = glow * 0.22;
    ctx.lineWidth = baseWidth;
    ctx.stroke();
  }
  ctx.restore();
}
function collectArbitraryMorphLampPoints(layerIndex, t, maxPoints = 600, preparedPaths = null) {
  const layer = state.layers[layerIndex];
  const currentPaths = preparedPaths || getCurrentMorphCpuPaths(layerIndex, t, 'arbitrary-lamps');

  if (currentPaths.length) return collectArbitraryContourLampPoints(layer, currentPaths, maxPoints);

  const src = runtimeState.morph.sourceGeometry?.[layerIndex] || [];
  const dst = runtimeState.morph.targetGeometry?.[layerIndex] || [];
  if (!src.length && !dst.length) return collectArbitraryStaticLampPoints(layer, null, maxPoints);
  const out = [],
    pathCount = Math.max(src.length, dst.length),
    layerKey = String(layer?.id || layerIndex);
  for (let pathIndex = 0; pathIndex < pathCount && out.length < maxPoints; pathIndex++) {
    const sp = src[pathIndex] || null,
      dp = dst[pathIndex] || null,
      ref = sp || dp;
    if (!ref?.points?.length) continue;
    const count = Math.min(
      maxPoints - out.length,
      stableArbitraryLampCountForPath(layer, ref, pathIndex, maxPoints),
    );
    if (!count) continue;
    const seedKey = `lamp|${layerKey}|path:${pathIndex}`;
    const fractions = stableContourLampFractions(seedKey, count);
    const st = sp ? buildSinglePathLengthTable(sp, false) : null,
      dt = dp ? buildSinglePathLengthTable(dp, false) : null;
    for (let i = 0; i < fractions.length; i++) {
      const f = fractions[i];
      const p = st?.total > 0 ? pointAtPathDistance(st, f * st.total) : null;
      const q = dt?.total > 0 ? pointAtPathDistance(dt, f * dt.total) : null;
      const a = p || q,
        b = q || p;
      if (!a || !b) continue;
      const u = Math.max(0, Math.min(1, Number(t) || 0));
      const sourcePresent = !!p,
        targetPresent = !!q;
      const travel = u;
      out.push({
        x: a.x + (b.x - a.x) * u,
        y: a.y + (b.y - a.y) * u,
        pathIndex,
        lampAttachFraction: f,
        lampSourcePresent: sourcePresent,
        lampTargetPresent: targetPresent,
        lampPresence: lampTopologyPresence(sourcePresent, targetPresent, travel),
        lampTravelProgress: travel,
        lampId: `arb:${pathIndex}:${i}`,
        lampSeed: lampHash32(`${seedKey}:${i}`),
      });
    }
  }
  return out;
}
function capLampPointList(points, maxPoints = 260) {
  if (!Array.isArray(points) || points.length <= maxPoints) return points || [];
  const out = [],
    step = points.length / maxPoints;
  for (let i = 0; i < maxPoints; i++) out.push(points[Math.floor(i * step)]);
  return out;
}

export {
  capLampPointList,
  collectArbitraryMorphLampPoints,
  collectSmoothCornerLampPoints,
  drawLightningCentralMorph,
  mapLampSemanticPathsToVisible,
  projectLampPointsToCurrentPolygon,
};

// Open profiles can draw one piece per edge. Use a piece incident to the
// key and retain the chosen edge if its opposite piece appears later.
export function bindOpenCircleLampEdges(points, paths, layer) {
  if (!paths?.some((path) => Number.isInteger(path.lampCircleEdgeIndex))) return points;
  const byOrbit = new Map();
  for (let i = 0; i < paths.length; i++) {
    const path = paths[i];
    if (!Number.isInteger(path.lampCircleEdgeIndex)) continue;
    let orbit = byOrbit.get(path.lampCircleOrbitIndex);
    if (!orbit) byOrbit.set(path.lampCircleOrbitIndex, (orbit = new Map()));
    orbit.set(path.lampCircleEdgeIndex, i);
  }
  const now = lampVisualNow();
  const phase = runtimeState.morph.lampCycleSerial;
  return points.map((p) => {
    const orbit = byOrbit.get(p.pathIndex);
    if (!p.lampCircleSlotCount || !orbit) return p;
    const outgoing = p.vertexIndex;
    const incoming = (outgoing + p.lampCircleSlotCount - 1) % p.lampCircleSlotCount;
    const id = [layer.id, 'open-lamp-edge', phase, p.lampId].join(':');
    let binding = lampMotionRuntime.snap.get(id);
    if (!binding) {
      const edge = orbit.has(outgoing) ? outgoing : incoming;
      if (!orbit.has(edge)) return { ...p, lampLevel: 0 };
      binding = { edge, lastSeen: now };
      lampMotionRuntime.snap.set(id, binding);
    }
    binding.lastSeen = now;
    const pathIndex = orbit.get(binding.edge);
    if (pathIndex === undefined) return { ...p, lampLevel: 0 };
    const endpoint = Number(binding.edge === incoming);
    return {
      ...p,
      pathIndex,
      lampCircleSlotCount: 0,
      lampAttachFraction: endpoint,
      lampAttachSegmentWindow: 0.5,
      lampOpenCircleEndpoint: endpoint,
    };
  });
}

// A key can slide within the two edges meeting at its support. The rail is
// selected for the entire orbit, so nearby crossings never select a new orbit.
export function projectMorphKeyLamps(points, semanticPaths, rails, layer, canonicalRails = null) {
  if (!rails?.length) return points.map((p) => ({ ...p, lampLevel: 0 }));
  const authoritative = rails.__somataFrameContour === true;
  const phase = runtimeState.morph.lampCycleSerial;
  const key = String(layer.id) + ':key-orbits';
  const now = lampVisualNow();
  cleanupLampRuntime(now);
  let map = null;
  if (authoritative) {
    const cached = lampMotionRuntime.snap.get(key);
    if (cached?.phase === phase && cached.railCount === rails.length && cached.sourceCount === semanticPaths?.length) {
      cached.lastSeen = now;
      map = cached.map;
    } else {
      map = mapLampSemanticPathsToVisible(semanticPaths, rails);
      lampMotionRuntime.snap.set(key, { phase, railCount: rails.length, sourceCount: semanticPaths?.length, map, lastSeen: now });
    }
  }

  const arcStations = new Map();
  const stationsOf = (path) => {
    let stations = arcStations.get(path);
    if (!stations) {
      stations = lampVertexArcFractions(path, true);
      arcStations.set(path, stations);
    }
    return stations;
  };
  // Open profile rails may omit the closing edge and reverse array order at
  // a phase boundary. Identify an incident edge by BOTH of its supports.
  const openCircle = layer.closedLoop === false &&
    points.every(p => p.lampCircleSlotCount > 0);
  const slots = openCircle ? new Map(points.map(p => [p.pathIndex + ':' + p.vertexIndex, p])) : null;
  if (slots) return points.map(p => {
    const n = p.lampCircleSlotCount;
    const bindingKey = [layer.id, 'open-visible-edge', p.lampId].join(':');
    const previous = lampMotionRuntime.snap.get(bindingKey);
    let best = Infinity, owner, endpoint, hit;
    for (let i = 0; i < rails.length; i++) {
      const rail = rails[i];
      if (!rail.points?.length) continue;
      const support = nearestLampFractionOnPath(p, rail);
      const gap = Math.hypot(support.point.x - p.x, support.point.y - p.y);
      for (const side of [1, -1]) {
        const other = slots.get(p.pathIndex + ':' + ((p.vertexIndex + side + n) % n));
        if (!other) continue;
        const next = nearestLampFractionOnPath(other, rail);
        const neighborGap = Math.hypot(next.point.x - other.x, next.point.y - other.y);
        const score = gap + neighborGap * 0.05;
        const tie = Math.abs(score - best) < 1e-6 && previous?.phase === phase &&
          previous.owner === i && previous.endpoint === Number(side < 0);
        if (score < best - 1e-6 || tie) {
          best = score; owner = i; endpoint = Number(side < 0); hit = support;
        }
      }
    }
    if (!hit) return { ...p, lampLevel: 0 };
    lampMotionRuntime.snap.set(bindingKey, { phase, owner, endpoint, lastSeen: now });
    return { ...p, ...hit.point, pathIndex: owner, lampContourFraction: hit.fraction, __lampVisualProfileAttached: true };
  });
  return bindOpenCircleLampEdges(points, semanticPaths, layer).map((p) => {
    const pi = p.pathIndex;
    const railIndex = map ? map[pi] : pi;
    const rail = rails[railIndex];
    if (!rail?.points?.length || p.lampLevel === 0) return { ...p, lampLevel: 0 };
    let center = p.lampAttachFraction;
    let left = p.lampAttachSegmentWindow ?? 0.08;
    let right = left;
    const slotCount = p.lampCircleSlotCount;
    if (slotCount) {
      const raw = semanticPaths?.[pi];
      const step = raw?.points?.length / slotCount;
      if (step >= 1 && Number.isInteger(step)) {
        const stations = stationsOf(raw);
        const i = p.vertexIndex * step;
        center = stations[i];
        const previous = i ? stations[i - step] : raw.closed ? stations[stations.length - step] - 1 : center;
        const next = i + step < stations.length ? stations[i + step] : raw.closed ? 1 : center;
        left = (center - previous) / 2;
        right = (next - center) / 2;
      } else {
        center = p.vertexIndex / Math.max(1, slotCount - Number(!rail.closed));
        left = right = 0.5 / slotCount;
      }
    } else if (p.lampFixedSegmentBound) {
      const canonical = canonicalRails?.[pi] || rail;
      const stations = stationsOf(canonical);
      const count = stations.length - Number(!canonical.closed);
      const position = p.lampAttachRenderSegmentParam * count;
      const i = Math.floor(position);
      const from = stations[i] ?? 1;
      const to = stations[i + 1] ?? 1;
      center = from + (to - from) * (position - i);
    }
    if (!Number.isFinite(center)) return { ...p, lampLevel: 0 };
    let hit;
    if ((slotCount || p.lampFixedSegmentBound) && p.lampAttachSourcePoint && p.lampAttachTargetPoint) {
      // Tessellation and winding can change at either endpoint. Resolve the
      // support on its owned rail; use its incident interval to break ties.
      const near = nearestLampFractionOnPath(p, rail);
      const local = nearestLampOnPathInterval(p, rail, center - left, center + right, center);
      const gap = Math.hypot(p.x - near.point.x, p.y - near.point.y);
      const interior = p.lampAttachProgress > 0.15 && p.lampAttachProgress < 0.85;
      hit = interior || Math.hypot(p.x - local.point.x, p.y - local.point.y) <= gap + 1e-6 ? local : near;
      const id = [layer.id, 'owned-station', p.lampId ?? p.vertexIndex].join(':');
      const previous = lampMotionRuntime.snap.get(id);
      const t = p.lampAttachProgress;
      if (previous?.phase === phase && previous.railIndex === railIndex && t > previous.t) {
        // A nearest-point tie at a crossing can move the candidate far around a
        // closed rail in a single frame. Travel continuously in arc coordinates.
        // Reserve enough of the remaining phase to reach the endpoint.
        let start = previous.s;
        const transported = lampPointAtFraction(rail, start);
        const travel = Math.hypot(p.x - previous.anchorX, p.y - previous.anchorY);
        const residual = transported && Math.hypot(transported.x - previous.x, transported.y - previous.y);
        if (residual > 2 * travel + 1) {
          // The first moving rail can have a different seam or winding than the
          // canonical boundary frame. Rebase the station in physical space.
          const rebased = nearestLampFractionOnPath(previous, rail);
          if (Math.hypot(rebased.point.x - previous.x, rebased.point.y - previous.y) < residual / 2)
            start = rebased.fraction;
        }
        let delta = hit.fraction - start;
        if (rail.closed) delta -= Math.round(delta);
        const dt = t - previous.t;
        let planned = p.lampAttachTargetFraction - p.lampAttachSourceFraction;
        if (rail.closed) planned -= Math.round(planned);
        const arcSpeed = Math.max(Math.abs(planned) || 0, slotCount ? 2 / slotCount : 2 * (left + right));
        const step = Math.max(arcSpeed * dt, Math.abs(delta) * dt / (1 - previous.t));
        const s = start + Math.max(-step, Math.min(step, delta));
        const fraction = rail.closed ? ((s % 1) + 1) % 1 : s;
        hit = { fraction, point: lampPointAtFraction(rail, fraction) || hit.point };
      } else if (previous?.phase === phase && previous.railIndex === railIndex && t === previous.t) {
        hit = { fraction: previous.s, point: lampPointAtFraction(rail, previous.s) || hit.point };
      }
      lampMotionRuntime.snap.set(id, { phase, railIndex, t, s: hit.fraction, x: hit.point.x, y: hit.point.y, anchorX: p.x, anchorY: p.y, lastSeen: now });
    } else {
      hit = nearestLampOnPathInterval(p, rail, center - left, center + right, center);
    }
    return { ...p, ...hit.point, pathIndex: railIndex, lampContourFraction: hit.fraction, __lampVisualProfileAttached: true };
  });
}
