// Паутина: видимые пути, стиль, переключение на границе морфа, углы и изломы, метрики.
import './aux-paths.js'; // initialisation order: this module runs after it
import { audioApplyNumeric } from '../audio/audio-routing.js';
import { getTapMorphIntervalSec } from '../audio/tap-tempo.js';
import {
  colorBaseHex6,
  ensureLayerEffectState,
  getActiveEffectLayer,
  getEffectTargets,
  getLayerEffectOwner,
  getLayerWebConfig,
  getLayerWebEnabled,
} from '../core/defaults-layers.js';
import { getRoundingStrength } from '../core/palette.js';
import { invalidateLayerEffect } from '../core/render-runtime.js';
import { requestMainCanvasRender } from '../core/scheduler.js';
import { runtimeState, state, somataWithFourierLayer } from '../core/state.js';
import { prepareFourierPathList } from '../geometry/fourier.js';
import { getLayerStrokeWidthMultiplier } from './motion.js';
import { SomataFrameContourService, getLayerFrameAuthoritativePaths } from '../geometry/frame-contour.js';
import {
  buildSinglePathLengthTable,
  frameGeometryRuntime,
  isCurrentFrameDynamicPathList,
  persistentRoundedPathsCache,
  persistentWebClipCache,
  persistentWebCornerCache,
  persistentWebVectorCache,
  pointAtPathDistance,
  setWebCornersPreparedFrame,
  webCornersPreparedFrame,
  webDrawScratch,
} from '../geometry/frame-paths.js';
import { buildRoundedMorphPolylinePoints, smoothMorphPath } from '../geometry/morph.js';
import { isSpiralLayer } from '../geometry/spiral/order-params.js';
import { buildExactWebContourPaths } from './lightning-exact.js';
import { syncWebOutlineUI } from '../ui/effects-sidebar.js';

function prepareWebVisiblePaths(paths, layer) {
  const source = Array.isArray(paths) ? paths : [];
  if (layer?.roundingCornerType === 'fourier')
    return somataWithFourierLayer(layer, () => prepareFourierPathList(source));

  if (
    source?._exactSpiralEffectRail === true ||
    source?._stableRoundedSplineRail === true ||
    (source.length > 0 &&
      source.every(
        (path) =>
          path?.profileCurveBaked === true ||
          path?._exactSpiralEffectRail === true ||
          path?._stableRoundedSplineRail === true ||
          path?._greenRenderedRail === true,
      ))
  )
    return source;
  const rounding = getRoundingStrength(layer?.rounding);
  if (rounding <= 0.001) return source;

  const dynamicFrame = isCurrentFrameDynamicPathList(source);
  if (!dynamicFrame && source && typeof source === 'object') {
    let variants = persistentRoundedPathsCache.get(source);
    const key = 'static:' + rounding.toFixed(5);
    const hit = variants?.get(key);
    if (hit) return hit;
    const rounded = source.map((path) => {
      const pts = path?.points || [];
      if (path.profileCurveBaked || pts.length < 3) return path;
      return {
        ...path,
        points: smoothMorphPath(pts, Boolean(path.closed), rounding, path.cornerFlags || []),
      };
    });
    if (!variants) {
      variants = new Map();
      persistentRoundedPathsCache.set(source, variants);
    }
    variants.set(key, rounded);
    return rounded;
  }

  if (frameGeometryRuntime.active && source && typeof source === 'object') {
    let variants = frameGeometryRuntime.roundedPaths.get(source);
    const dynamicMorph = dynamicFrame && !isSpiralLayer(layer);
    const key = (dynamicMorph ? 'morph-v92:' : 'corner:') + rounding.toFixed(5);
    const hit = variants?.get(key);
    if (hit) return hit;
    const rounded = source.map((path) => {
      const pts = path?.points || [];
      if (path.profileCurveBaked || pts.length < 3) return path;
      if (dynamicMorph) {
        let holder = path._effectMorphRoundedPath;
        if (!holder) holder = path._effectMorphRoundedPath = { points: [] };
        holder.closed = Boolean(path.closed);
        holder.cornerFlags = [];
        holder.strokeGrowth = path.strokeGrowth;
        holder._src = path._src || null;
        holder._dst = path._dst || null;
        buildRoundedMorphPolylinePoints(pts, holder.closed, rounding, holder.points);
        return holder;
      }
      return {
        ...path,
        points: smoothMorphPath(pts, Boolean(path.closed), rounding, path.cornerFlags || []),
      };
    });
    rounded._frameGeometryId = frameGeometryRuntime.frameId;
    if (!variants) {
      variants = new Map();
      frameGeometryRuntime.roundedPaths.set(source, variants);
    }
    variants.set(key, rounded);
    return rounded;
  }
  return source.map((path) => {
    const pts = path?.points || [];
    if (path.profileCurveBaked || pts.length < 3) return path;
    return { ...path, points: smoothMorphPath(pts, Boolean(path.closed), rounding, path.cornerFlags || []) };
  });
}
function webSignedArea(points) {
  let a = 0;
  for (let i = 0, n = points.length; i < n; i++) {
    const p = points[i],
      q = points[(i + 1) % n];
    a += p.x * q.y - q.x * p.y;
  }
  return a * 0.5;
}
function webHashSigned(a, b, c, d = 0) {
  let x =
    (Math.imul((a + 1) | 0, 73856093) ^
      Math.imul((b + 1) | 0, 19349663) ^
      Math.imul((c + 1) | 0, 83492791) ^
      Math.imul((d + 1) | 0, 2654435761)) >>>
    0;
  x ^= x >>> 16;
  x = Math.imul(x, 2246822519) >>> 0;
  x ^= x >>> 13;
  x = Math.imul(x, 3266489917) >>> 0;
  x ^= x >>> 16;
  return (x / 4294967295) * 2 - 1;
}
function getWebBranchFlags(cfg) {
  const c = cfg && typeof cfg === 'object' ? cfg : {};
  const explicit = ['inside', 'outsideStraight', 'outsideArc'].some((k) =>
    Object.prototype.hasOwnProperty.call(c, k),
  );
  if (explicit)
    return {
      inside: c.inside === true,
      outsideStraight: c.outsideStraight === true,
      outsideArc: c.outsideArc === true,
    };
  const legacy = ['inside', 'outside', 'combined'].includes(c.region) ? c.region : 'inside';
  return { inside: legacy !== 'outside', outsideStraight: false, outsideArc: legacy !== 'inside' };
}
function getWebStyleProfile(cfg, width, dpr = 1) {
  const style = ['web', 'laser', 'spiderSun'].includes(cfg?.style) ? cfg.style : 'web',
    base = Math.max(0.03, Number(width) || 0.6),
    px = Math.max(0.1, Number(dpr) || 1);
  if (style === 'laser')
    return {
      style,
      width: Math.max(0.03, base * 0.72),
      alpha: 1,
      halo: Math.min(14, Math.max(1.2, base * 5.8)) * px,
      shadow: Math.min(14, Math.max(1.2, base * 5.8)),
    };
  if (style === 'spiderSun')
    return {
      style,
      width: Math.max(0.03, base * 0.86),
      alpha: 0.82,
      halo: Math.min(4.5, Math.max(0.2, base * 1.4)) * px,
      shadow: Math.min(4.5, Math.max(0.2, base * 1.4)),
    };
  return {
    style,
    width: base,
    alpha: 0.88,
    halo: Math.min(6, Math.max(0.1, base * 2.4)) * px,
    shadow: Math.min(6, base * 2.4),
  };
}
function resolveWebPrimaryColor(cfg, layer = null, frameCtx = null) {
  if (cfg?.matchLineColor === true) {
    const lineColor = frameCtx?.strokeColor || layer?.strokeColor || '#ffffff';
    return colorBaseHex6(lineColor, '#ffffff');
  }
  return /^#[0-9a-f]{6}$/i.test(cfg?.color || '') ? cfg.color : '#ffffff';
}
const webRuntime = {
  corners: new Map(),
  lastCleanup: 0,
  pendingByLayer: new Map(),
  desiredVisibilityByLayer: new Map(),
  transitionByLayer: new Map(),
  nextCornerTrackId: 1,
};
function hasActiveMorphForWebSwitch() {
  return Boolean(runtimeState.morph?.active || runtimeState.minimalMorph?.active);
}
function applyWebSwitchPatch(patch, requestRender = true, targetLayer = null) {
  if (!patch) return false;
  const owner = ensureLayerEffectState(targetLayer || getActiveEffectLayer());
  if (!owner) return false;
  let changed = false;
  if (Object.prototype.hasOwnProperty.call(patch, 'showWeb')) {
    const next = patch.showWeb === true;
    if (owner.showWeb !== next) changed = true;
    owner.showWeb = next;
    if (!next) {
      for (const key of Array.from(webRuntime.corners.keys()))
        if (String(key).startsWith(`${owner.id}:`)) webRuntime.corners.delete(key);
      webRuntime.transitionByLayer.delete(owner.id);
      webRuntime.desiredVisibilityByLayer.delete(owner.id);
    }
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'type')) {
    const nextType = patch.type === 'rounding' ? 'rounding' : 'bevel';
    if (owner.web.type !== nextType) changed = true;
    owner.web.type = nextType;
  }
  if (changed && typeof invalidateLayerEffect === 'function') invalidateLayerEffect(owner, 'web-switch');
  if (changed && requestRender) requestMainCanvasRender();
  return changed;
}
function queueWebSwitchForNextMorph(patch) {
  if (!patch) return false;
  const targets = getEffectTargets();
  if (!targets.length) return false;
  const hasShow = Object.prototype.hasOwnProperty.call(patch, 'showWeb');
  const hasType = Object.prototype.hasOwnProperty.call(patch, 'type');
  const now = performance.now();
  if (hasShow) {
    const desired = patch.showWeb === true;
    for (const layer of targets) {
      const owner = ensureLayerEffectState(layer);
      if (!owner) continue;
      webRuntime.pendingByLayer.delete(owner.id);
      webRuntime.transitionByLayer.delete(owner.id);
      webRuntime.desiredVisibilityByLayer.delete(owner.id);
      applyWebSwitchPatch({ showWeb: desired }, false, owner);
    }
  }
  if (hasType) {
    for (const layer of targets) {
      const owner = ensureLayerEffectState(layer);
      if (!owner) continue;
      webRuntime.pendingByLayer.delete(owner.id);
      webRuntime.transitionByLayer.delete(owner.id);
      applyWebSwitchPatch({ type: patch.type }, false, owner);
    }
  }
  syncWebOutlineUI();
  requestMainCanvasRender();
  return false;
}
function applyPendingWebSwitchAtMorphBoundary() {
  if (!webRuntime.pendingByLayer.size) return false;
  const now = performance.now();
  let changed = false;
  for (const [id, pending] of Array.from(webRuntime.pendingByLayer.entries())) {
    const layer = state.layers.find((l) => l.id === id);
    webRuntime.pendingByLayer.delete(id);
    if (!layer) continue;
    ensureLayerEffectState(layer);
    const wasVisible = layer.showWeb === true,
      oldType = layer.web.type === 'rounding' ? 'rounding' : 'bevel';
    const nextVisible = Object.prototype.hasOwnProperty.call(pending, 'showWeb')
      ? pending.showWeb === true
      : wasVisible;
    const nextType = Object.prototype.hasOwnProperty.call(pending, 'type')
      ? pending.type === 'rounding'
        ? 'rounding'
        : 'bevel'
      : oldType;
    layer.showWeb = nextVisible;
    layer.web.type = nextType;
    changed = true;
    invalidateLayerEffect(layer, 'web-switch-boundary');
    if (!nextVisible) webRuntime.transitionByLayer.delete(id);
    else if (!wasVisible)
      webRuntime.transitionByLayer.set(id, {
        kind: 'fadeIn',
        fromType: nextType,
        toType: nextType,
        start: now,
        duration: 180,
      });
    else if (oldType !== nextType)
      webRuntime.transitionByLayer.set(id, {
        kind: 'type',
        fromType: oldType,
        toType: nextType,
        start: now,
        duration: 180,
      });
  }
  syncWebOutlineUI();
  if (changed) requestMainCanvasRender();
  return changed;
}
function flushPendingWebSwitchIfMorphStopped() {
  if (hasActiveMorphForWebSwitch() || !webRuntime.pendingByLayer.size) return false;
  let changed = false;
  for (const [id, pending] of Array.from(webRuntime.pendingByLayer.entries())) {
    const layer = state.layers.find((l) => l.id === id);
    webRuntime.pendingByLayer.delete(id);
    if (!layer) continue;
    webRuntime.transitionByLayer.delete(id);
    changed = applyWebSwitchPatch(pending, false, layer) || changed;
  }
  syncWebOutlineUI();
  if (changed) requestMainCanvasRender();
  return changed;
}
function webSmoothstep01(x) {
  x = Math.max(0, Math.min(1, x));
  return x * x * x * (x * (x * 6 - 15) + 10);
}
// Keep fully formed threads at their original spacing. Only the
// fractional outer thread grows in, instead of appearing at full span.
function webCornerThreadBudget(span, spacing) {
  return Math.max(0, Math.min(96, span / Math.max(0.0001, spacing)));
}
function webWrappedUnitDistance(a, b) {
  let d = Math.abs((Number(a) || 0) - (Number(b) || 0));
  return Math.min(d, 1 - d);
}
function resolveDynamicWebCornerRuntime(layerId, pathIndex, anchorU, anchorX, anchorY, total, now) {
  const frameId = Number(frameGeometryRuntime.frameId) || 0;
  const lid = String(layerId || 'layer');
  const px = Number(anchorX) || 0,
    py = Number(anchorY) || 0,
    u = (((Number(anchorU) || 0) % 1) + 1) % 1;
  const spatialGate = Math.max(20, Math.min(180, (Number(total) || 0) * 0.12));
  let bestKey = null,
    best = null,
    bestScore = Infinity;
  for (const [key, rt] of webRuntime.corners) {
    if (
      rt?.trackedDynamic !== true ||
      rt.layerId !== lid ||
      rt.pathIndex !== pathIndex ||
      rt.seenFrame === frameId
    )
      continue;
    const du = webWrappedUnitDistance(rt.anchorU, u);
    const ds = Math.hypot((Number(rt.anchorX) || 0) - px, (Number(rt.anchorY) || 0) - py);
    if (du > 0.18 && ds > spatialGate) continue;
    const score = du * 260 + (ds / Math.max(1, spatialGate)) * 24;
    if (score < bestScore) {
      bestScore = score;
      best = rt;
      bestKey = key;
    }
  }
  if (!best) {
    const id = webRuntime.nextCornerTrackId++;
    bestKey = `${lid}:dyn:${pathIndex}:${id}`;
    best = {
      growth: 0,
      last: now,
      lastSeen: now,
      trackedDynamic: true,
      fresh: true,
      layerId: lid,
      pathIndex,
      anchorU: u,
      anchorX: px,
      anchorY: py,
      seenFrame: frameId,
    };
    webRuntime.corners.set(bestKey, best);
  }
  best.seenFrame = frameId;
  best.lastSeen = now;
  best.anchorU = u;
  best.anchorX = px;
  best.anchorY = py;
  return best;
}
function collectWebSharpCorners(paths, thresholdDeg, hysteresisDeg = 8) {
  const threshold = Math.max(1, Math.min(179, Number(thresholdDeg) || 45));
  const margin = Math.max(2, Math.min(18, Number(hysteresisDeg) || 8));
  const prepared = webCornersPreparedFrame;
  if (
    prepared &&
    prepared.frameId === frameGeometryRuntime.frameId &&
    prepared.paths === paths &&
    prepared.threshold === threshold &&
    prepared.margin === margin
  )
    return prepared.corners;
  const corners = webDrawScratch.corners;
  corners.length = 0;
  for (let pi = 0; pi < (paths || []).length; pi++) {
    const path = paths[pi],
      pts = path?.points || [],
      closed = Boolean(path?.closed);
    if (pts.length < 3) continue;
    const areaSign = closed ? (webSignedArea(pts) >= 0 ? 1 : -1) : 0;
    const start = closed ? 0 : 1,
      end = closed ? pts.length : pts.length - 1;
    for (let i = start; i < end; i++) {
      const stableOrdinal = i;
      const prev = pts[(i - 1 + pts.length) % pts.length],
        p = pts[i],
        next = pts[(i + 1) % pts.length];
      const inX = p.x - prev.x,
        inY = p.y - prev.y,
        outX = next.x - p.x,
        outY = next.y - p.y;
      const inLen = Math.hypot(inX, inY),
        outLen = Math.hypot(outX, outY);
      if (inLen < 1e-4 || outLen < 1e-4) continue;
      const dot = Math.max(-1, Math.min(1, (inX * outX + inY * outY) / (inLen * outLen)));
      const turnDeg = (Math.acos(dot) * 180) / Math.PI;
      if (turnDeg < threshold - margin) continue;
      const cross = inX * outY - inY * outX;
      const signedTurn = closed ? cross * areaSign : cross;
      if (closed && Math.abs(signedTurn) <= 1e-7) continue;
      const target = webSmoothstep01((turnDeg - (threshold - margin)) / (margin * 1.5));
      const ci = corners.length;
      let c = webDrawScratch.cornerPool[ci];
      if (!c) c = webDrawScratch.cornerPool[ci] = {};
      c.x = p.x;
      c.y = p.y;
      c.turnDeg = turnDeg;
      c.target = target;
      c.concave = closed ? signedTurn < 0 : false;
      c.convex = closed ? signedTurn > 0 : true;
      c.pathIndex = pi;
      c.pointIndex = i;
      c.cornerOrdinal = stableOrdinal;
      c.prevX = prev.x;
      c.prevY = prev.y;
      c.nextX = next.x;
      c.nextY = next.y;
      c.inLen = inLen;
      c.outLen = outLen;
      c.uxPrev = (prev.x - p.x) / inLen;
      c.uyPrev = (prev.y - p.y) / inLen;
      c.uxNext = (next.x - p.x) / outLen;
      c.uyNext = (next.y - p.y) / outLen;
      corners.push(c);
      if (corners.length >= 220) {
        setWebCornersPreparedFrame({
          frameId: frameGeometryRuntime.frameId,
          paths,
          threshold,
          margin,
          corners,
        });
        return corners;
      }
    }
  }
  setWebCornersPreparedFrame({ frameId: frameGeometryRuntime.frameId, paths, threshold, margin, corners });
  return corners;
}
function collectWebKinkCorners(paths, thresholdDeg, hysteresisDeg = 8, spiralCornerMode = false) {
  const threshold = Math.max(1, Math.min(179, Number(thresholdDeg) || 45));
  const margin = Math.max(2, Math.min(18, Number(hysteresisDeg) || 8));
  let hasMarkers = false;
  for (const path of paths || []) {
    const flags = Array.isArray(path?.cornerFlags) ? path.cornerFlags : null,
      pts = path?.points || [];
    if (
      flags?.some(Boolean) ||
      pts.some((p) => p?.__profileKeyCorner === true || p?.__profileCorner === true)
    ) {
      hasMarkers = true;
      break;
    }
  }
  if (!hasMarkers && !spiralCornerMode) return collectWebSharpCorners(paths, threshold, margin);
  const out = [];
  for (let pi = 0; pi < (paths || []).length; pi++) {
    const path = paths[pi],
      pts = path?.points || [],
      closed = Boolean(path?.closed),
      flags = Array.isArray(path?.cornerFlags) ? path.cornerFlags : null;
    if (pts.length < 3) continue;
    const areaSign = closed ? (webSignedArea(pts) >= 0 ? 1 : -1) : 0,
      start = closed ? 0 : 1,
      end = closed ? pts.length : pts.length - 1;
    const cubicRail =
      spiralCornerMode && path?._spiralGpuBezierRail === true && Array.isArray(path?._bezierSegments);
    const candidates = [];
    // Super-rounding may subdivide one semicircle into dozens of
    // exact cubics. A fixed +/- one-cubic turn measurement then
    // sees only a tiny angle and misses the WHOLE rounded bend.
    // Integrate signed curvature along the currently visible rail,
    // stopping at inflections or long straight runs. This remains
    // invariant under de Casteljau segmentation of the Line.
    const turns = cubicRail ? new Float64Array(pts.length) : null;
    const turnTravel = cubicRail ? new Float64Array(pts.length + 1) : null;
    if (cubicRail) {
      for (let k = 1; k < pts.length - 1; k++) {
        const a = pts[k - 1],
          p = pts[k],
          b = pts[k + 1],
          ax = p.x - a.x,
          ay = p.y - a.y,
          bx = b.x - p.x,
          by = b.y - p.y;
        const la = Math.hypot(ax, ay),
          lb = Math.hypot(bx, by);
        if (la > 1e-5 && lb > 1e-5)
          turns[k] = (Math.atan2(ax * by - ay * bx, ax * bx + ay * by) * 180) / Math.PI;
      }
      for (let k = 0; k < pts.length; k++) turnTravel[k + 1] = turnTravel[k] + Math.abs(turns[k]);
    }
    function wideTurn(index) {
      if (!cubicRail) return { angle: 0, before: 0, after: 0 };
      let totalSigned = 0;
      const distances = [];
      for (const direction of [-1, 1]) {
        let k = index + (direction < 0 ? -1 : 0),
          signed = 0,
          sign = 0,
          quiet = 0,
          length = 0;
        for (let step = 0; step < Math.min(512, pts.length); step++, k += direction) {
          const j = closed ? ((k % pts.length) + pts.length) % pts.length : k;
          if (!closed && (j < 1 || j >= pts.length - 1)) break;
          const t = turns[j],
            abs = Math.abs(t);
          if (abs < 0.08) {
            if (++quiet > 8) break;
          } else {
            if (sign !== 0 && t * sign < -0.2) break;
            sign = Math.sign(t);
            signed += t;
            quiet = 0;
          }
          const next = closed ? (j + 1) % pts.length : j + 1;
          const a = pts[j],
            b = pts[next];
          length += Math.hypot(b.x - a.x, b.y - a.y);
          if (Math.abs(signed) >= 95) break;
        }
        totalSigned += signed;
        distances.push(length);
      }
      return {
        angle: Math.min(180, Math.abs(totalSigned)),
        before: distances[0] || 0,
        after: distances[1] || 0,
      };
    }

    for (let i = start; i < end; i++) {
      const p = pts[i],
        marked = flags?.[i] === true || p?.__profileKeyCorner === true || p?.__profileCorner === true;
      const qIndex = Number(p?.__webExactCubicIndex);
      const junction =
        cubicRail &&
        Number.isInteger(qIndex) &&
        p?.__webExactCubicT === 1 &&
        qIndex < path._bezierSegments.length - 1;
      // For an unmarked smooth rounded semicircle, its midpoint
      // is a valid curved-bend anchor. Do not accept every sample.
      const arcMidpoint = cubicRail && !marked && !junction && p?.__webExactCubicT === 0.5;
      if (cubicRail && !marked && !junction && !arcMidpoint) continue;
      if (!cubicRail && !marked && !spiralCornerMode) continue;
      const prev = pts[(i - 1 + pts.length) % pts.length],
        next = pts[(i + 1) % pts.length];
      let inX = p.x - prev.x,
        inY = p.y - prev.y,
        outX = next.x - p.x,
        outY = next.y - p.y;
      if (junction) {
        const a = path._bezierSegments[qIndex],
          b = path._bezierSegments[qIndex + 1];
        const ax = a.p3.x - a.c2.x,
          ay = a.p3.y - a.c2.y,
          bx = b.c1.x - b.p0.x,
          by = b.c1.y - b.p0.y;
        if (Math.hypot(ax, ay) > 1e-4 && Math.hypot(bx, by) > 1e-4) {
          inX = ax;
          inY = ay;
          outX = bx;
          outY = by;
        }
      }
      const inLen = Math.hypot(inX, inY),
        outLen = Math.hypot(outX, outY);
      if (inLen < 1e-4 || outLen < 1e-4) continue;
      const dot = Math.max(-1, Math.min(1, (inX * outX + inY * outY) / (inLen * outLen)));
      const tangentTurn = (Math.acos(dot) * 180) / Math.PI;
      const bend = wideTurn(i),
        roundedTurn = bend.angle;
      const turnDeg = Math.max(tangentTurn, roundedTurn);
      const required = spiralCornerMode && marked ? 2 : threshold - margin;
      if (turnDeg < required) continue;
      const cross = inX * outY - inY * outX,
        signedTurn = closed ? cross * areaSign : cross;
      if (!cubicRail && closed && Math.abs(signedTurn) <= 1e-7) continue;
      const c = {
        x: p.x,
        y: p.y,
        turnDeg,
        target:
          spiralCornerMode && marked
            ? webSmoothstep01((turnDeg - 2) / 6)
            : webSmoothstep01((turnDeg - (threshold - margin)) / (margin * 1.5)),
        concave: closed ? signedTurn < 0 : false,
        convex: closed ? signedTurn > 0 : true,
        pathIndex: pi,
        pointIndex: i,
        cornerOrdinal: i,
        prevX: prev.x,
        prevY: prev.y,
        nextX: next.x,
        nextY: next.y,
        inLen,
        outLen,
        uxPrev: (prev.x - p.x) / inLen,
        uyPrev: (prev.y - p.y) / inLen,
        uxNext: (next.x - p.x) / outLen,
        uyNext: (next.y - p.y) / outLen,
      };
      if (cubicRail) {
        c.spiralRoundedBend = roundedTurn > tangentTurn + 1;
        c.spiralBendBefore = bend.before;
        c.spiralBendAfter = bend.after;
      }
      candidates.push({
        corner: c,
        priority: marked ? 2 : junction ? 1 : 0,
        sharp: tangentTurn >= threshold - margin,
        score: turnDeg,
        index: i,
      });
    }
    if (!cubicRail) {
      for (const candidate of candidates) {
        out.push(candidate.corner);
        if (out.length >= 220) return out;
      }
      continue;
    }
    // Prefer a profile marker over a nearby smooth-arc midpoint.
    // At most one anchor per sampled cubic neighbourhood, avoiding
    // dozens of overlapping webs on a single semicircular bend.
    candidates.sort((a, b) => b.priority - a.priority || b.score - a.score || a.index - b.index);
    const accepted = [];
    const minTurnSeparation = Math.max(45, threshold * 0.85);
    for (const candidate of candidates) {
      if (
        accepted.some((old) => {
          const distance = Math.abs(old.index - candidate.index);
          const sampleGap = Math.min(distance, closed ? pts.length - distance : distance);
          if (sampleGap < 5) return true;
          // Never merge two distinct authored corners simply
          // because the line between them is gently curved.
          if (old.priority === 2 && candidate.priority === 2 && old.sharp && candidate.sharp) return false;
          let angularGap = Math.abs(turnTravel[old.index + 1] - turnTravel[candidate.index + 1]);
          if (closed) angularGap = Math.min(angularGap, Math.max(0, turnTravel[pts.length] - angularGap));
          return angularGap < minTurnSeparation;
        })
      )
        continue;
      accepted.push(candidate);
    }
    accepted.sort((a, b) => a.index - b.index);
    for (const candidate of accepted) {
      out.push(candidate.corner);
      if (out.length >= 220) return out;
    }
  }
  return out;
}
function buildWebRoundedContourClipPath(paths) {
  if (typeof Path2D === 'undefined' || !Array.isArray(paths) || !paths.length) return null;
  const clip = new Path2D();
  let hasClosed = false;
  for (const path of paths) {
    const pts = path?.points || [];
    if (path?.closed !== true || pts.length < 3) continue;
    clip.moveTo(Number(pts[0].x) || 0, Number(pts[0].y) || 0);
    for (let i = 1; i < pts.length; i++) clip.lineTo(Number(pts[i].x) || 0, Number(pts[i].y) || 0);
    clip.closePath();
    hasClosed = true;
  }
  return hasClosed ? clip : null;
}
// Web attachment only: reject whole groups of far-away segments before the
// exact projection. Geometry tables are immutable within an active frame;
// the cache is rebuilt on every new frame to support pooled/mutable tables.
const webProjectionBlockCache = new WeakMap();
function webProjectionBlocks(table) {
  const segs = table?.segs || [];
  if (segs.length < 192) return null;
  const frameId = frameGeometryRuntime.active ? frameGeometryRuntime.frameId : NaN;
  const old = webProjectionBlockCache.get(table);
  if (
    old &&
    old.frameId === frameId &&
    old.segs === segs &&
    old.count === segs.length &&
    old.revision === table._webProjectionRevision
  )
    return old.blocks;
  const blocks = [];
  for (let start = 0; start < segs.length; start += 32) {
    const end = Math.min(segs.length, start + 32);
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (let i = start; i < end; i++) {
      const q = segs[i],
        ax = q.a.x,
        ay = q.a.y,
        bx = q.b.x,
        by = q.b.y;
      // A non-finite coordinate must never cause an incorrect prune.
      if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(bx) || !Number.isFinite(by)) {
        minX = -Infinity;
        minY = -Infinity;
        maxX = Infinity;
        maxY = Infinity;
        break;
      }
      if (ax < minX) minX = ax;
      if (bx < minX) minX = bx;
      if (ax > maxX) maxX = ax;
      if (bx > maxX) maxX = bx;
      if (ay < minY) minY = ay;
      if (by < minY) minY = by;
      if (ay > maxY) maxY = ay;
      if (by > maxY) maxY = by;
    }
    blocks.push({ start, end, minX, minY, maxX, maxY });
  }
  if (Number.isFinite(frameId))
    webProjectionBlockCache.set(table, {
      frameId,
      segs,
      count: segs.length,
      revision: table._webProjectionRevision,
      blocks,
    });
  return blocks;
}
function nearestWebDistanceOnTable(table, x, y, out = webDrawScratch.nearest) {
  const px = Number(x) || 0,
    py = Number(y) || 0,
    segs = table?.segs || [];
  let bestSq = Infinity,
    bestDistance = 0,
    bestX = px,
    bestY = py;
  const prune = segs.length >= 48,
    blocks = webProjectionBlocks(table);
  const groupCount = blocks ? blocks.length : 1;
  // Visit groups and segments in original order: strict '<' tie precedence
  // on crossing lines cannot change even when a whole group is skipped.
  for (let bi = 0; bi < groupCount; bi++) {
    let first = 0,
      last = segs.length;
    if (blocks) {
      const group = blocks[bi];
      first = group.start;
      last = group.end;
      if (bestSq < Infinity) {
        const gapX = px < group.minX ? group.minX - px : px > group.maxX ? px - group.maxX : 0;
        const gapY = py < group.minY ? group.minY - py : py > group.maxY ? py - group.maxY : 0;
        if (gapX * gapX + gapY * gapY > bestSq) continue;
      }
    }
    for (let i = first; i < last; i++) {
      const seg = segs[i],
        ax = seg.a.x,
        ay = seg.a.y,
        bx = seg.b.x,
        by = seg.b.y;
      if (prune && bestSq < Infinity) {
        const minX = ax < bx ? ax : bx,
          maxX = ax > bx ? ax : bx;
        const minY = ay < by ? ay : by,
          maxY = ay > by ? ay : by;
        const gapX = px < minX ? minX - px : px > maxX ? px - maxX : 0;
        const gapY = py < minY ? minY - py : py > maxY ? py - maxY : 0;
        if (gapX * gapX + gapY * gapY > bestSq) continue;
      }
      const vx = bx - ax,
        vy = by - ay,
        den = vx * vx + vy * vy;
      const u = den > 1e-12 ? Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / den)) : 0;
      const qx = ax + vx * u,
        qy = ay + vy * u,
        dx = qx - px,
        dy = qy - py,
        sq = dx * dx + dy * dy;
      if (sq < bestSq) {
        bestSq = sq;
        bestDistance = seg.start + seg.len * u;
        bestX = qx;
        bestY = qy;
      }
    }
  }
  out.distance = bestDistance;
  out.x = bestX;
  out.y = bestY;
  out.sq = bestSq;
  return out;
}
function pointAtWrappedWebDistance(table, distance, out, closed = true) {
  const total = Number(table?.total) || 0;
  if (total <= 1e-8) {
    out.x = 0;
    out.y = 0;
    return out;
  }
  let d = Number(distance) || 0;
  // An open spiral has distinct ends. Modulo here used to link its
  // start to its finish, creating long stray Web threads.
  if (closed) d = ((d % total) + total) % total;
  else d = Math.max(0, Math.min(total - 1e-9, d));
  // The six-chord preview table gives an inexpensive distance lookup,
  // but interpolating its XY chords moves thread endpoints OFF the
  // visible GPU Bézier. Evaluate the corresponding retained cubic at
  // the bracketed parameter instead: every endpoint lies exactly on
  // the same mathematical curve that Line displays.
  const cubics = table?._webExactSpiralCubics,
    segs = table?.segs;
  if (cubics?.length && segs?.length) {
    let lo = 0,
      hi = segs.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (segs[mid].start + segs[mid].len < d) lo = mid + 1;
      else hi = mid;
    }
    const seg = segs[lo],
      ci = seg.b?.__webExactCubicIndex;
    if (Number.isInteger(ci) && ci >= 0 && ci < cubics.length) {
      const a = seg.a,
        b = seg.b,
        t1 = Number(b.__webExactCubicT);
      const t0 = a?.__webExactCubicIndex === ci ? Number(a.__webExactCubicT) : 0;
      if (Number.isFinite(t0) && Number.isFinite(t1) && t1 > t0) {
        const f = Math.max(0, Math.min(1, (d - seg.start) / Math.max(1e-12, seg.len))),
          t = t0 + (t1 - t0) * f;
        const q = cubics[ci],
          u = 1 - t;
        out.x = u * u * u * q.p0.x + 3 * u * u * t * q.c1.x + 3 * u * t * t * q.c2.x + t * t * t * q.p3.x;
        out.y = u * u * u * q.p0.y + 3 * u * u * t * q.c1.y + 3 * u * t * t * q.c2.y + t * t * t * q.p3.y;
        return out;
      }
    }
  }
  return pointAtPathDistance(table, d, out);
}
// A spiral can have no sharp semantic vertices at all.  Sample attachment
// anchors at stable arc-length fractions of its *visible* line, rather than
// borrowing polygon vertices (whose positions and path order differ).
// This only supplies Web anchors; it never changes the spiral stroke.
function collectSmoothSpiralWebAnchors(visualPaths, spacing = 10) {
  const result = [];
  for (let pi = 0; pi < (visualPaths?.length || 0); pi++) {
    const path = visualPaths[pi],
      pts = path?.points || [];
    if (pts.length < 3) continue;
    const table = buildSinglePathLengthTable(path, !isCurrentFrameDynamicPathList(visualPaths));
    const total = Number(table?.total) || 0;
    if (total < 12) continue;
    const count = Math.max(3, Math.min(48, Math.floor(total / Math.max(24, Number(spacing) * 4))));
    const step = total / (path.closed === true ? count : count + 1);
    for (let k = 0; k < count && result.length < 220; k++) {
      const d = (k + (path.closed === true ? 0 : 0.5)) * step;
      const a = pointAtWrappedWebDistance(table, d - step * 0.45, { x: 0, y: 0 }, path.closed === true);
      const c = pointAtPathDistance(table, Math.min(total, d), { x: 0, y: 0 });
      const b = pointAtWrappedWebDistance(table, d + step * 0.45, { x: 0, y: 0 }, path.closed === true);
      const inX = c.x - a.x,
        inY = c.y - a.y,
        outX = b.x - c.x,
        outY = b.y - c.y;
      const inLen = Math.hypot(inX, inY),
        outLen = Math.hypot(outX, outY);
      if (inLen < 1e-4 || outLen < 1e-4) continue;
      const cos = Math.max(-1, Math.min(1, (inX * outX + inY * outY) / (inLen * outLen)));
      result.push({
        x: c.x,
        y: c.y,
        turnDeg: (Math.acos(cos) * 180) / Math.PI,
        target: 1,
        concave: false,
        convex: true,
        pathIndex: pi,
        pointIndex: k,
        cornerOrdinal: k,
        prevX: a.x,
        prevY: a.y,
        nextX: b.x,
        nextY: b.y,
        inLen,
        outLen,
        uxPrev: -inX / inLen,
        uyPrev: -inY / inLen,
        uxNext: outX / outLen,
        uyNext: outY / outLen,
        virtualSpiralAnchor: true,
        spiralDistance: d,
      });
    }
  }
  return result;
}
function buildWebCornerMetrics(corners, tables, visualPaths) {
  const metrics = new Array(corners?.length || 0),
    groups = new Map(),
    vertexDistances = new Map();
  for (let i = 0; i < metrics.length; i++) {
    const c = corners[i];
    let best = null,
      bestPathIndex = -1,
      bestTable = null,
      bestPath = null;
    // Virtual spiral anchors are sampled from this very visible carrier.
    // Use the known arc distance directly instead of an O(anchors × segments)
    // nearest-point projection (which can pick the wrong winding).
    if (c?.virtualSpiralAnchor === true && Number.isFinite(c.spiralDistance)) {
      const pi = c.pathIndex,
        table = tables?.[pi],
        path = visualPaths?.[pi];
      if (table?.total > 4 && path) {
        best = { distance: Math.max(0, Math.min(table.total, c.spiralDistance)), x: c.x, y: c.y, sq: 0 };
        bestPathIndex = pi;
        bestTable = table;
        bestPath = path;
      }
    }
    // A crossing is located INSIDE a visible Line segment. Its
    // predecessor vertex is NOT the crossing and must not be used
    // as the Web anchor. Read the arc distance obtained from the
    // intersection scan of the current authoritative Line rail.
    if (!best && c?.spiralCrossing === true && Number.isFinite(c.spiralDistance)) {
      const pi = c.pathIndex,
        table = tables?.[pi],
        path = visualPaths?.[pi];
      if (table?.total > 4 && path) {
        best = { distance: Math.max(0, Math.min(table.total, c.spiralDistance)), x: c.x, y: c.y, sq: 0 };
        bestPathIndex = pi;
        bestTable = table;
        bestPath = path;
      }
    }
    // Spiral Web corners were selected on this very stroke rail.
    // Their vertex index gives an unambiguous position along the
    // ordered path even when the spiral overlaps itself in screen space.
    if (!best && c?.spiralStrokeCorner === true) {
      const pi = c.pathIndex,
        table = tables?.[pi],
        path = visualPaths?.[pi],
        idx = c.pointIndex;
      if (table?.total > 4 && path?.points?.[idx]) {
        // All corners on this rail share a single arc prefix. Never
        // look up a nearby turn in screen space or rescan the prefix per corner.
        let distances = vertexDistances.get(pi);
        if (!distances) {
          const pts = path.points;
          distances = new Float64Array(pts.length);
          for (let si = 1; si < pts.length; si++) {
            const len = Math.hypot(pts[si].x - pts[si - 1].x, pts[si].y - pts[si - 1].y);
            distances[si] = distances[si - 1] + (len > 1e-6 ? len : 0);
          }
          vertexDistances.set(pi, distances);
        }
        best = {
          distance: Math.max(0, Math.min(table.total, distances[idx])),
          x: path.points[idx].x,
          y: path.points[idx].y,
          sq: 0,
        };
        bestPathIndex = pi;
        bestTable = table;
        bestPath = path;
      }
    }
    // Semantic polygon anchors may have a different path partition/order.
    if (!best)
      for (let pi = 0; pi < (tables?.length || 0); pi++) {
        const table = tables?.[pi],
          path = visualPaths?.[pi];
        if (!(table?.total > 4)) continue;
        const near = nearestWebDistanceOnTable(table, c.x, c.y, { distance: 0, x: 0, y: 0, sq: Infinity });
        if (!best || near.sq < best.sq) {
          best = near;
          bestPathIndex = pi;
          bestTable = table;
          bestPath = path;
        }
      }
    if (!best || bestPathIndex < 0) {
      metrics[i] = null;
      continue;
    }
    const m = {
      distance: best.distance,
      x: best.x,
      y: best.y,
      total: bestTable.total,
      closed: bestPath?.closed === true,
      cornerSpan: 0,
      pathIndex: bestPathIndex,
      semanticPathIndex: c.pathIndex,
    };
    metrics[i] = m;
    let g = groups.get(bestPathIndex);
    if (!g) {
      g = [];
      groups.set(bestPathIndex, g);
    }
    g.push(i);
  }
  for (const indices of groups.values()) {
    indices.sort((a, b) => metrics[a].distance - metrics[b].distance);
    const n = indices.length;
    for (let rank = 0; rank < n; rank++) {
      const idx = indices[rank],
        m = metrics[idx],
        c = corners[idx],
        total = m.total;
      let before = Infinity,
        after = Infinity;
      if (n > 1) {
        if (rank > 0) before = m.distance - metrics[indices[rank - 1]].distance;
        else if (m.closed) before = m.distance + (total - metrics[indices[n - 1]].distance);
        if (rank < n - 1) after = metrics[indices[rank + 1]].distance - m.distance;
        else if (m.closed) after = total - m.distance + metrics[indices[0]].distance;
      }

      const fallback = Math.max(0, Math.min(Number(c?.inLen) || 0, Number(c?.outLen) || 0));
      // A rounded Spiral may have only one semantic anchor on a
      // long arc.  Using the length of a single preview chord as
      // its maximum Web depth made 100% depth look almost empty.
      // Measure to neighbouring anchors or the actual open ends
      // of this *same* visible Line path instead.
      if (c?.spiralStrokeCorner === true) {
        if (n === 1) {
          before = m.closed ? total * 0.5 : m.distance;
          after = m.closed ? total * 0.5 : total - m.distance;
        } else if (!m.closed) {
          if (rank === 0) before = m.distance;
          if (rank === n - 1) after = total - m.distance;
        }
        // Depth follows the whole rounded lobe, never the
        // entire neighbouring spiral revolution.
        if (Number(c?.spiralBendBefore) > 0) before = Math.min(before, c.spiralBendBefore);
        if (Number(c?.spiralBendAfter) > 0) after = Math.min(after, c.spiralBendAfter);
      }
      if (!Number.isFinite(before) || before <= 1e-6) before = fallback;
      if (!Number.isFinite(after) || after <= 1e-6) after = fallback;
      m.cornerSpan = Math.max(0, Math.min(before, after, total * 0.499));

      m.roundCenterX = Number(c?.x) || m.x;
      m.roundCenterY = Number(c?.y) || m.y;
      m.rounded = false;
      const displaced = Math.hypot(m.x - (Number(c?.x) || m.x), m.y - (Number(c?.y) || m.y));
      if (m.closed && m.cornerSpan > 3 && displaced > 0.5) {
        const probe = Math.max(1.5, Math.min(m.cornerSpan * 0.32, total * 0.035)),
          pa = pointAtWrappedWebDistance(tables[m.pathIndex], m.distance - probe, { x: 0, y: 0 }),
          pb = pointAtWrappedWebDistance(tables[m.pathIndex], m.distance + probe, { x: 0, y: 0 });
        const ax = pa.x,
          ay = pa.y,
          bx = m.x,
          by = m.y,
          cx = pb.x,
          cy = pb.y,
          den = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
        if (Math.abs(den) > 1e-5) {
          const aa = ax * ax + ay * ay,
            bb = bx * bx + by * by,
            cc = cx * cx + cy * cy,
            ux = (aa * (by - cy) + bb * (cy - ay) + cc * (ay - by)) / den,
            uy = (aa * (cx - bx) + bb * (ax - cx) + cc * (bx - ax)) / den,
            rr = Math.hypot(ux - bx, uy - by);
          if (Number.isFinite(rr) && rr < Math.max(8, m.cornerSpan * 4)) {
            m.roundCenterX = ux;
            m.roundCenterY = uy;
            m.rounded = true;
          }
        }
      }
    }
  }
  return metrics;
}
function getPersistentWebClipPath(paths) {
  if (!paths || isCurrentFrameDynamicPathList(paths)) return buildWebRoundedContourClipPath(paths);
  if (persistentWebClipCache.has(paths)) return persistentWebClipCache.get(paths);
  const clip = buildWebRoundedContourClipPath(paths);
  persistentWebClipCache.set(paths, clip || null);
  return clip;
}
const lightningOutsideClipCache = new WeakMap();
function buildLightningOutsideClipPath(paths) {
  if (typeof Path2D === 'undefined' || !Array.isArray(paths) || !paths.length) return null;
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity,
    hasClosed = false;
  for (const path of paths) {
    if (path?.closed !== true) continue;
    const pts = path?.points || [];
    if (pts.length < 3) continue;
    hasClosed = true;
    for (const p of pts) {
      const x = Number(p?.x),
        y = Number(p?.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (
    !hasClosed ||
    !Number.isFinite(minX) ||
    !Number.isFinite(minY) ||
    !Number.isFinite(maxX) ||
    !Number.isFinite(maxY)
  )
    return null;
  const span = Math.max(1, maxX - minX, maxY - minY),
    pad = Math.max(4096, span * 12);
  const clip = new Path2D();
  clip.rect(minX - pad, minY - pad, maxX - minX + pad * 2, maxY - minY + pad * 2);
  for (const path of paths) {
    const pts = path?.points || [];
    if (path?.closed !== true || pts.length < 3) continue;
    clip.moveTo(Number(pts[0].x) || 0, Number(pts[0].y) || 0);
    for (let i = 1; i < pts.length; i++) clip.lineTo(Number(pts[i].x) || 0, Number(pts[i].y) || 0);
    clip.closePath();
  }
  return clip;
}
function getPersistentLightningOutsideClipPath(paths) {
  if (!paths || isCurrentFrameDynamicPathList(paths)) return buildLightningOutsideClipPath(paths);
  if (lightningOutsideClipCache.has(paths)) return lightningOutsideClipCache.get(paths);
  const clip = buildLightningOutsideClipPath(paths);
  lightningOutsideClipCache.set(paths, clip || null);
  return clip;
}
const persistentWebKinkCornerCache = new WeakMap();
function getPersistentWebKinkCorners(paths, threshold, margin = 8, spiralCornerMode = false) {
  if (!paths || isCurrentFrameDynamicPathList(paths)) {
    const corners = collectWebKinkCorners(paths, threshold, margin, spiralCornerMode);
    // The sharp-corner fallback borrows a single global scratch list.
    // Keep it out of prepared frames: another layer can scan before draw.
    return corners === webDrawScratch.corners ? corners.map((c) => ({ ...c })) : corners;
  }
  let variants = persistentWebKinkCornerCache.get(paths);
  if (!variants) {
    variants = new Map();
    persistentWebKinkCornerCache.set(paths, variants);
  }
  const key = `${Number(threshold).toFixed(4)}|${Number(margin).toFixed(2)}|spiral:${spiralCornerMode ? 1 : 0}`;
  const hit = variants.get(key);
  if (hit) return hit;
  const stable = collectWebKinkCorners(paths, threshold, margin, spiralCornerMode).map((c) => ({ ...c }));
  variants.set(key, stable);
  return stable;
}
function getPersistentWebCorners(paths, threshold, margin = 8) {
  if (!paths || isCurrentFrameDynamicPathList(paths)) return collectWebSharpCorners(paths, threshold, margin);
  let variants = persistentWebCornerCache.get(paths);
  if (!variants) {
    variants = new Map();
    persistentWebCornerCache.set(paths, variants);
  }
  const key = `${Number(threshold).toFixed(4)}|${Number(margin).toFixed(2)}`;
  const hit = variants.get(key);
  if (hit) return hit;
  const stable = collectWebSharpCorners(paths, threshold, margin).map((c) => ({ ...c }));
  variants.set(key, stable);
  return stable;
}
function getPersistentWebVectorRecord(paths, key) {
  if (!paths || isCurrentFrameDynamicPathList(paths)) return null;
  let variants = persistentWebVectorCache.get(paths);
  if (!variants) {
    variants = new Map();
    persistentWebVectorCache.set(paths, variants);
  }
  let rec = variants.get(key);
  if (!rec) {
    rec = { paths: Object.create(null), gpuCommandCaches: Object.create(null) };
    variants.set(key, rec);
  } else {
    if (!rec.paths) rec.paths = Object.create(null);
    if (!rec.gpuCommandCaches) rec.gpuCommandCaches = Object.create(null);
  }
  return rec;
}
function prepareLayerFrameWebData(frameCtx) {
  if (!frameCtx) return null;
  if (frameCtx.webPreparedReady) return frameCtx.webPrepared;
  const layer = frameCtx.layer,
    effectLayer = frameCtx.effectLayer || getLayerEffectOwner(layer) || layer;
  const sharedRecord =
    SomataFrameContourService?.current?.(frameCtx) || SomataFrameContourService?.get?.(frameCtx) || null;
  const sharedWebView = sharedRecord ? SomataFrameContourService?.webView?.(frameCtx) : null;
  // A dynamic Spiral Corridor whose Base uses the recorded master MUST have
  // that same frame's visible path for Web. Never reconstruct a competing
  // path using authored N/K or another Morph provider.
  const spiralMasterWeb = frameCtx._spiralCorridorSharedLineAuthority === true;
  const authoritativeMasterReady =
    !spiralMasterWeb ||
    (Number(sharedRecord?.frameId) === Number(frameCtx.frameId) &&
      sharedWebView?.record === sharedRecord &&
      Array.isArray(sharedWebView?.visualPaths) &&
      sharedWebView.visualPaths.length > 0);
  // 7.8.3 contract: logical/key vertices drive corner detection, but all Web placement,
  // distance and clipping use the actual Line carrier from FrameContour. The semantic
  // path partition is allowed to differ; corner metrics project to the nearest Line path.
  const paths = sharedWebView?.anchorPaths || getLayerFrameAuthoritativePaths(frameCtx),
    sharedContour = Boolean(sharedWebView?.record);
  let data = frameCtx.webData;
  if (!data) data = frameCtx.webData = {};
  data.enabled = getLayerWebEnabled(effectLayer) === true;
  data.layerIndex = frameCtx.layerIndex;
  data.paths = paths;
  data.visualPaths = null;
  data.clipPath = null;
  data.insideClipPath = null;
  data.outsideClipPath = null;
  data.cfg = null;
  data.corners = [];
  data.spacing = 0;
  data.depthPercent = 60;
  data.depthMultiplier = 1;
  data.jitterStrength = 0;
  data.region = 'inside';
  data.insideEnabled = true;
  data.outsideStraightEnabled = false;
  data.outsideArcEnabled = false;
  data.placementMode = 'corners';
  data.oscillating = false;
  data.oscillationStrength = 10;
  data.oscillationStrengthMultiplier = 1;
  data.oscillationMultiplier = 1;
  data.oscillationPhase = 0;
  data.color = '#ffffff';
  data.secondaryColor = '#00ffff';
  data.sunDegrees = 20;
  data.width = 0;
  data.renderWidth = 0;
  data.threadAlpha = 0.88;
  data.haloRadius = 1;
  data.shadowBlur = 1;
  data.style = 'web';
  data.now = frameCtx.now || performance.now();
  data.owner = null;
  data.transition = null;
  data.visibilityFactor = 1;
  data.pathBevel = null;
  data.pathRounding = null;
  data.animating = false;
  data.visualPathTables = null;
  data.cornerMetrics = null;
  data.persistentVectorRecord = null;
  data._branchPathCache = null;
  data.spiralCornerUnclipped = false;
  data.spiralIntersectionResult = null;
  data.spiralCrossingThreads = null;
  data._spiralLineMasterRequired = spiralMasterWeb;
  data._spiralLineMasterVerified = spiralMasterWeb && authoritativeMasterReady;
  data._spiralLineMasterFrameId = spiralMasterWeb ? Number(sharedRecord?.frameId) || -1 : -1;
  if (spiralMasterWeb && !authoritativeMasterReady) {
    // A missing Line authority is a real contract failure, not a
    // reason to draw Web from an approximate/old Spiral contour.
    data.enabled = false;
    frameCtx.webPrepared = data;
    frameCtx.webPreparedReady = true;
    return data;
  }
  if (data.enabled && paths?.length) {
    const owner = ensureLayerEffectState(effectLayer),
      cfg = owner?.web || getLayerWebConfig(effectLayer);
    data.owner = owner;
    data.transition = owner ? webRuntime.transitionByLayer.get(owner.id) : null;
    data.cfg = cfg;
    // Web is one contour with two roles: anchor paths preserve semantic corners; visualPaths
    // is the actual current-frame Line carrier. This keeps 7.5 corner semantics without
    // reintroducing a second visual rail that can drift away from Line.
    data.visualPaths = sharedContour
      ? sharedWebView.visualPaths || paths
      : buildExactWebContourPaths(frameCtx);
    if (spiralMasterWeb && data.visualPaths !== sharedRecord.paths) {
      // webView is required to return the Line master itself.
      // Do not silently use a second path when this invariant breaks.
      data.enabled = false;
      frameCtx.webPrepared = data;
      frameCtx.webPreparedReady = true;
      return data;
    }
    // On a Spiral, the semantic/Lightning paths are not the visible
    // stroke. Corner admission and endpoints MUST use the same single
    // winding in the same order. Projecting an unrelated semantic
    // corner to its nearest point can jump to an adjacent turn.
    const spiralStrokeCarrier =
      (spiralMasterWeb || isSpiralLayer(layer)) &&
      Array.isArray(data.visualPaths) &&
      data.visualPaths.length > 0;
    const cornerSource = spiralStrokeCarrier ? data.visualPaths : paths;
    if (spiralStrokeCarrier) data.paths = cornerSource;
    // Branch checkboxes belong to Polygon. For Spiral they remain stored,
    // but all winding crossings/corners are one Web domain.
    const branches = spiralStrokeCarrier
      ? { inside: true, outsideStraight: false, outsideArc: false }
      : getWebBranchFlags(cfg);
    data.insideEnabled = branches.inside;
    data.outsideStraightEnabled = branches.outsideStraight;
    data.outsideArcEnabled = branches.outsideArc;
    data.region = branches.inside
      ? branches.outsideStraight || branches.outsideArc
        ? 'combined'
        : 'inside'
      : branches.outsideStraight || branches.outsideArc
        ? 'outside'
        : 'inside';
    data.placementMode = ['corners', 'selfIntersection', 'selfIntersectionCorridor'].includes(
      cfg.placementMode,
    )
      ? cfg.placementMode
      : 'corners';
    // A closed *spiral* can cross itself many times. Parity clipping
    // its Web wedges erases only fragments of corner threads, so the
    // remaining strokes look like an unrelated dashed trajectory.
    // In "На углах" a thread is defined by its two endpoints on
    // the actual winding; keep it whole. Polygons still use parity.
    data.spiralCornerUnclipped =
      spiralStrokeCarrier &&
      branches.inside === true &&
      branches.outsideStraight !== true &&
      branches.outsideArc !== true;
    // A self-crossing Spiral has no stable polygon-wide inside/outside.
    // Its Web threads are already placed by distances on the Line rail;
    // a parity stencil of overlapping turns/copies can erase them.
    data.oscillating = cfg.oscillating === true;
    data.oscillationStrength = Math.max(
      0,
      Math.min(100, Number.isFinite(Number(cfg.oscillationStrength)) ? Number(cfg.oscillationStrength) : 10),
    );
    data.oscillationStrengthMultiplier = Math.max(
      0.015625,
      Math.min(
        64,
        Number.isFinite(Number(cfg.oscillationStrengthMultiplier))
          ? Number(cfg.oscillationStrengthMultiplier)
          : 1,
      ),
    );
    data.oscillationMultiplier = Math.max(
      0.015625,
      Math.min(
        64,
        Number.isFinite(Number(cfg.oscillationMultiplier)) ? Number(cfg.oscillationMultiplier) : 1,
      ),
    );
    const morphCycleSec = getTapMorphIntervalSec(Number(state?.morph?.intervalSec) || 5, 'full'),
      morphCycleMs = Math.max(100, morphCycleSec * 1000);

    data.oscillationPhase =
      ((data.now % morphCycleMs) / morphCycleMs) * Math.PI * 2 * data.oscillationMultiplier;
    const threshold = audioApplyNumeric(
      'web.angleThreshold',
      Number(cfg.angleThreshold) || 60,
      frameCtx.layerIndex,
    );
    // 7.7: first use the exact 7.5 corner collector on the current line topology.
    // The new exact Spiral carrier can be C1-smooth at authored vertices, so if that scan has
    // no corners, recover only the moving key topology and project those corners back onto the
    // exact visual rail. This keeps 7.5 Web identity without endpoint snapping during Morph.
    const collectWebCorners = (source) =>
      data.placementMode === 'corners' || cfg.style === 'spiderSun'
        ? getPersistentWebKinkCorners(
            source,
            threshold,
            8,
            spiralStrokeCarrier && data.placementMode === 'corners',
          )
        : getPersistentWebCorners(source, threshold, 8);
    data.corners = collectWebCorners(cornerSource);
    // Only the Spiral self-intersection mode uses genuine crossings
    // of distinct, non-neighbouring visible rail segments. Corners
    // mode is intentionally unchanged (including rounded bends).
    if (spiralStrokeCarrier && data.placementMode === 'selfIntersection') {
      const result = window.SomataSpiralIntersections?.scanFrame?.(data.visualPaths, frameCtx.frameId);
      data.spiralIntersectionResult = result || null;
      data.corners = [];
      if (result && (result.limited !== true || result.reason === 'intersection-limit')) {
        let n = 0;
        // Large multi-crossing Morph frames must not suddenly lose
        // ALL Web merely because we reached a bounded scan cap.
        for (const hit of window.SomataSpiralIntersections?.selectCrossings?.(result.intersections, 96) ||
          []) {
          for (const [pathIndex, seg] of [
            [hit.pathA, hit.first],
            [hit.pathB, hit.second],
          ]) {
            const len = Math.max(0.01, Number(seg.length) || 1);
            data.corners.push({
              x: hit.x,
              y: hit.y,
              pathIndex,
              pointIndex: seg.segmentIndex,
              spiralDistance: pathIndex === hit.pathA ? hit.distanceA : hit.distanceB,
              cornerOrdinal: n++,
              turnDeg: 90,
              target: 1,
              convex: true,
              concave: false,
              inLen: len,
              outLen: len,
              spiralStrokeCorner: true,
              spiralCrossing: true,
            });
          }
        }
      }
    }
    if (
      spiralStrokeCarrier &&
      data.placementMode !== 'corners' &&
      data.placementMode !== 'selfIntersection' &&
      !data.corners.length
    ) {
      // Uniform arc anchors belong only to non-corner modes. In
      // "На углах" they were the cause of the detached spiral web.
      data.corners = collectSmoothSpiralWebAnchors(data.visualPaths, Number(cfg.spacing) || 10);
    }
    if (spiralStrokeCarrier) {
      // Both fresh corners and morph-continuity corners stay indexed
      // on this same visible Spiral winding. Do not mutate the
      // collector's persistent cache or pooled corner objects.
      data.corners = data.corners.map((c) =>
        c.virtualSpiralAnchor === true ? c : { ...c, spiralStrokeCorner: true },
      );
    }
    // The Web pass rejects branches without an admissible corner. Avoid
    // constructing path-length tables, projection metrics and two CPU
    // clipping masks for an effect that cannot draw on this frame.
    // The semantic corner list is still resolved on every Morph frame.
    const needsOutsideClip = branches.outsideStraight || branches.outsideArc;
    const needsInsideClip = branches.inside || !needsOutsideClip;
    const eligibleCorners = data.corners.some(
      (c) =>
        (c?.spiralStrokeCorner === true && branches.inside === true) ||
        (c?.concave === true ? branches.outsideStraight : needsInsideClip || branches.outsideArc),
    );
    if (eligibleCorners) {
      // Both regions use the SAME authoritative visible Line carrier.
      // Keep the historical empty-branch inside fallback for imported profiles.
      data.insideClipPath =
        needsInsideClip && !data.spiralCornerUnclipped ? getPersistentWebClipPath(data.visualPaths) : null;
      data.outsideClipPath =
        needsOutsideClip && !data.spiralCornerUnclipped
          ? getPersistentLightningOutsideClipPath(data.visualPaths)
          : null;
      data.clipPath =
        needsInsideClip && !needsOutsideClip
          ? data.insideClipPath
          : !needsInsideClip && needsOutsideClip
            ? data.outsideClipPath
            : null;
      if (spiralStrokeCarrier && data.placementMode === 'selfIntersection') {
        // Crossing threads use the two path distances from the
        // exact intersection scan; old corner projection and
        // path-length tables only repeat work and can snap to
        // the wrong winding at a self-intersection.
        data.visualPathTables = [];
        data.cornerMetrics = [];
      } else {
        data.visualPathTables = new Array(data.visualPaths?.length || 0);
        const webStaticPaths = !isCurrentFrameDynamicPathList(data.visualPaths);
        for (let pi = 0; pi < data.visualPathTables.length; pi++) {
          const vp = data.visualPaths[pi];
          const table = vp?.points?.length > 2 ? buildSinglePathLengthTable(vp, webStaticPaths) : null;
          if (table)
            table._webExactSpiralCubics = vp?._spiralGpuBezierRail === true ? vp._bezierSegments : null;
          data.visualPathTables[pi] = table;
        }
        data.cornerMetrics = buildWebCornerMetrics(data.corners, data.visualPathTables, data.visualPaths);
      }
    } else {
      data.visualPathTables = [];
      data.cornerMetrics = [];
    }
    data.spacing = Math.max(
      1,
      Math.min(80, audioApplyNumeric('web.spacing', Number(cfg.spacing) || 10, frameCtx.layerIndex)),
    );
    data.depthPercent = Math.max(
      0,
      Math.min(
        100,
        audioApplyNumeric(
          'web.distance',
          Number.isFinite(Number(cfg.distance)) ? Number(cfg.distance) : 60,
          frameCtx.layerIndex,
        ),
      ),
    );
    data.depthMultiplier = Math.max(
      0,
      Number.isFinite(Number(cfg.depthMultiplier)) ? Number(cfg.depthMultiplier) : 1,
    );
    if (spiralStrokeCarrier && data.placementMode === 'selfIntersection') {
      // The old selfIntersection mode generated two *corner* anchors
      // per crossing and then built chords on each individual rail.
      // On straight crossing windings those chords coincide with Line
      // and cannot appear as a Web. Thread geometry must instead
      // connect the TWO visible winding branches at that crossing.
      data.spiralCrossingThreads =
        window.SomataSpiralIntersections?.buildCrossingThreads?.(
          data.visualPaths,
          data.spiralIntersectionResult,
          {
            spacing: data.spacing,
            depthPercent: data.depthPercent,
            depthMultiplier: data.depthMultiplier,
            maxCrossings: 96,
            maxThreads: 1200,
          },
        ) || [];
      window.__somataSpiralCrossingWebLast = {
        frameId: frameCtx.frameId,
        layerIndex: frameCtx.layerIndex,
        lineMaster: spiralMasterWeb && authoritativeMasterReady,
        pathCount: data.visualPaths.length,
        intersectionCount: data.spiralIntersectionResult?.intersections?.length || 0,
        intersectionLimited: data.spiralIntersectionResult?.limited === true,
        intersectionLimitReason: data.spiralIntersectionResult?.reason || '',
        threadCount: data.spiralCrossingThreads.length,
        activeMode: data.placementMode,
      };
    }
    const variation = Math.max(
      0,
      Math.min(
        45,
        audioApplyNumeric('web.angleVariation', Number(cfg.angleVariation) || 0, frameCtx.layerIndex),
      ),
    );
    data.jitterStrength = Math.sin((variation * Math.PI) / 180) * 0.9;
    data.color = resolveWebPrimaryColor(cfg, layer, frameCtx);
    data.secondaryColor = /^#[0-9a-f]{6}$/i.test(cfg.secondaryColor || '') ? cfg.secondaryColor : '#00ffff';
    data.sunDegrees = Math.max(5, Math.min(90, Number(cfg.sunDegrees) || 20));
    const baseLineWidth = Math.max(
      0.1,
      Number(frameCtx.strokeWidth) ||
        audioApplyNumeric('layer.strokeWidth', Number(layer?.strokeWidth) || 1.5, frameCtx.layerIndex) *
          getLayerStrokeWidthMultiplier(layer),
    );
    const widthBase =
      cfg.widthRelative === true
        ? Math.max(
            0.05,
            Math.min(12, baseLineWidth * Math.max(0.01, Math.min(4, (Number(cfg.widthPercent) || 40) / 100))),
          )
        : Math.max(0.1, Math.min(4, Number(cfg.width) || 0.6));
    data.width = Math.max(0.03, Math.min(24, audioApplyNumeric('web.width', widthBase, frameCtx.layerIndex)));
    const style = getWebStyleProfile(cfg, data.width, Number(frameCtx.frame?.dpr) || 1);
    data.style = style.style;
    data.renderWidth = style.width;
    data.threadAlpha = style.alpha;
    data.haloRadius = style.halo;
    data.shadowBlur = style.shadow;
    const vecKey = [
      branches.inside ? 1 : 0,
      branches.outsideStraight ? 1 : 0,
      branches.outsideArc ? 1 : 0,
      data.style,
      data.placementMode,
      threshold.toFixed(3),
      data.spacing.toFixed(3),
      data.depthPercent.toFixed(3),
      data.depthMultiplier.toFixed(4),
      variation.toFixed(3),
    ].join('|');
    data.persistentVectorRecord =
      data.transition || data.oscillating ? null : getPersistentWebVectorRecord(data.visualPaths, vecKey);
    if (data.persistentVectorRecord) data._branchPathCache = data.persistentVectorRecord.paths;
  }
  frameCtx.webPrepared = data;
  frameCtx.webPreparedReady = true;
  return data;
}

export {
  applyPendingWebSwitchAtMorphBoundary,
  applyWebSwitchPatch,
  collectWebKinkCorners,
  collectWebSharpCorners,
  flushPendingWebSwitchIfMorphStopped,
  getWebBranchFlags,
  getWebStyleProfile,
  nearestWebDistanceOnTable,
  pointAtWrappedWebDistance,
  prepareLayerFrameWebData,
  prepareWebVisiblePaths,
  queueWebSwitchForNextMorph,
  resolveDynamicWebCornerRuntime,
  resolveWebPrimaryColor,
  webCornerThreadBudget,
  webHashSigned,
  webRuntime,
  webSmoothstep01,
};
