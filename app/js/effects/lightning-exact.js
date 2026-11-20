// Молния и проблеск: точная геометрия по кривым (деление, длина дуги, рельсы).
import './sweep-glint.js'; // initialisation order: this module runs after it
import { audioApplyNumeric } from '../audio/audio-routing.js';
import { gcd, getLayerSweepConfig } from '../core/defaults-layers.js';
import { getRoundingStrength } from '../core/palette.js';
import { runtimeState, state } from '../core/state.js';
import { getCachedLayerDrawData } from './motion.js';
import { buildFourierWavePoints } from '../geometry/fourier.js';
import {
  frameGeometryRuntime,
  getLayerFrameAuxiliaryPaths,
  isCurrentFrameDynamicPathList,
  persistentExactLightningCache,
} from '../geometry/frame-paths.js';
import { drawMorphPathQuality, smoothMorphPath } from '../geometry/morph.js';
import { normalizeSplineRenderMode, useSmoothSplinePath } from '../geometry/profile-model.js';
import { buildExactSpiralEffectPaths } from '../geometry/spiral/effect-rails.js';
import { isSpiralLayer } from '../geometry/spiral/order-params.js';
import { splinePathForDraw } from '../geometry/spline-rounding.js';
import { getLampMorphRenderInfo } from '../lamps/lamp-anchors.js';
import { sweepStableUnit } from './sweep-glint.js';
import { roundPolylineForDraw } from '../geometry/polyline-rounding.js';

function normalizeLightningBehaviorValue(value, fallback = 'inside') {
  if (value === 'inside' || value === 'outside' || value === 'symmetric') return value;
  if (value === 'strict') return 'inside';
  if (value === 'chaotic') return 'symmetric';
  return fallback;
}
function normalizeLightningPrecisionValue(value) {
  return 'exact';
}
// Single full-precision Lightning mode.
function isHighPrecisionLightning(cfg) {
  return normalizeLightningPrecisionValue(cfg?.lightningPrecision) === 'exact';
}
function exactLightningLerp(a, b, t) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}
function exactLightningDistanceToChord(p, a, b) {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    l2 = dx * dx + dy * dy;
  if (l2 <= 1e-16) return Math.hypot(p.x - a.x, p.y - a.y);
  const u = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2,
    qx = a.x + dx * u,
    qy = a.y + dy * u;
  return Math.hypot(p.x - qx, p.y - qy);
}
function exactLightningSplitQuadratic(seg, t = 0.5) {
  const a = exactLightningLerp(seg.p0, seg.p1, t),
    b = exactLightningLerp(seg.p1, seg.p2, t),
    m = exactLightningLerp(a, b, t);
  return [
    { type: 'Q', p0: seg.p0, p1: a, p2: m, breakBefore: seg.breakBefore === true },
    { type: 'Q', p0: m, p1: b, p2: seg.p2, breakBefore: false },
  ];
}
function exactLightningSplitCubic(seg, t = 0.5) {
  const a = exactLightningLerp(seg.p0, seg.p1, t),
    b = exactLightningLerp(seg.p1, seg.p2, t),
    c = exactLightningLerp(seg.p2, seg.p3, t),
    d = exactLightningLerp(a, b, t),
    e = exactLightningLerp(b, c, t),
    m = exactLightningLerp(d, e, t);
  return [
    { type: 'C', p0: seg.p0, p1: a, p2: d, p3: m, breakBefore: seg.breakBefore === true },
    { type: 'C', p0: m, p1: e, p2: c, p3: seg.p3, breakBefore: false },
  ];
}
function exactLightningSliceSegment(seg, t0, t1) {
  let a = Math.max(0, Math.min(1, Number(t0) || 0)),
    b = Math.max(a, Math.min(1, Number(t1) || 0));
  if (a <= 1e-10 && b >= 1 - 1e-10) return { ...seg };
  if (seg.type === 'L')
    return {
      type: 'L',
      p0: exactLightningLerp(seg.p0, seg.p1, a),
      p1: exactLightningLerp(seg.p0, seg.p1, b),
      breakBefore: seg.breakBefore === true,
    };
  let left = seg;
  if (b < 1 - 1e-10)
    left = (seg.type === 'C' ? exactLightningSplitCubic(seg, b) : exactLightningSplitQuadratic(seg, b))[0];
  if (a > 1e-10) {
    const local = b > 1e-10 ? a / b : 0;
    left = (
      left.type === 'C' ? exactLightningSplitCubic(left, local) : exactLightningSplitQuadratic(left, local)
    )[1];
  }
  left.breakBefore = seg.breakBefore === true;
  return left;
}
function exactLightningSegmentEnd(seg) {
  return seg.type === 'C' ? seg.p3 : seg.type === 'Q' ? seg.p2 : seg.p1;
}
function exactLightningSegmentFlatness(seg) {
  const e = exactLightningSegmentEnd(seg);
  if (seg.type === 'C')
    return Math.max(
      exactLightningDistanceToChord(seg.p1, seg.p0, e),
      exactLightningDistanceToChord(seg.p2, seg.p0, e),
    );
  if (seg.type === 'Q') return exactLightningDistanceToChord(seg.p1, seg.p0, e);
  return 0;
}
function exactLightningFlattenSegment(seg, tolerance = 0.16, maxDepth = 10) {
  const out = [{ t: 0, p: seg.p0, d: 0 }];
  const rec = (part, t0, t1, depth) => {
    if (part.type === 'L' || depth >= maxDepth || exactLightningSegmentFlatness(part) <= tolerance) {
      out.push({ t: t1, p: exactLightningSegmentEnd(part), d: 0 });
      return;
    }
    const halves =
        part.type === 'C' ? exactLightningSplitCubic(part, 0.5) : exactLightningSplitQuadratic(part, 0.5),
      tm = (t0 + t1) * 0.5;
    rec(halves[0], t0, tm, depth + 1);
    rec(halves[1], tm, t1, depth + 1);
  };
  rec(seg, 0, 1, 0);
  let total = 0;
  for (let i = 1; i < out.length; i++) {
    total += Math.hypot(out[i].p.x - out[i - 1].p.x, out[i].p.y - out[i - 1].p.y);
    out[i].d = total;
  }
  return { samples: out, length: total };
}
const EXACT_LIGHTNING_GAUSS_X = [
  -0.973906528517172, -0.865063366688985, -0.679409568299024, -0.433395394129247, -0.148874338981631,
  0.148874338981631, 0.433395394129247, 0.679409568299024, 0.865063366688985, 0.973906528517172,
];
const EXACT_LIGHTNING_GAUSS_W = [
  0.066671344308688, 0.149451349150581, 0.219086362515982, 0.269266719309996, 0.295524224714753,
  0.295524224714753, 0.269266719309996, 0.219086362515982, 0.149451349150581, 0.066671344308688,
];
function exactLightningDerivativeAt(seg, t) {
  const q = Math.max(0, Math.min(1, Number(t) || 0)),
    u = 1 - q;
  if (seg.type === 'L') return { x: seg.p1.x - seg.p0.x, y: seg.p1.y - seg.p0.y };
  if (seg.type === 'Q')
    return {
      x: 2 * (u * (seg.p1.x - seg.p0.x) + q * (seg.p2.x - seg.p1.x)),
      y: 2 * (u * (seg.p1.y - seg.p0.y) + q * (seg.p2.y - seg.p1.y)),
    };
  return {
    x:
      3 * (u * u * (seg.p1.x - seg.p0.x) + 2 * u * q * (seg.p2.x - seg.p1.x) + q * q * (seg.p3.x - seg.p2.x)),
    y:
      3 * (u * u * (seg.p1.y - seg.p0.y) + 2 * u * q * (seg.p2.y - seg.p1.y) + q * q * (seg.p3.y - seg.p2.y)),
  };
}
function exactLightningSegmentArcLength(seg, tMax = 1) {
  const t = Math.max(0, Math.min(1, Number(tMax) || 0));
  if (t <= 1e-12) return 0;
  if (seg.type === 'L') return Math.hypot(seg.p1.x - seg.p0.x, seg.p1.y - seg.p0.y) * t;
  const half = t * 0.5,
    center = half;
  let sum = 0;
  for (let i = 0; i < EXACT_LIGHTNING_GAUSS_X.length; i++) {
    const q = center + half * EXACT_LIGHTNING_GAUSS_X[i],
      d = exactLightningDerivativeAt(seg, q);
    sum += EXACT_LIGHTNING_GAUSS_W[i] * Math.hypot(d.x, d.y);
  }
  return half * sum;
}
function exactLightningParamAtDistance(seg, d) {
  const total = Math.max(0, Number(seg._length) || 0),
    target = Math.max(0, Math.min(total, Number(d) || 0));
  if (target <= 1e-10 || total <= 1e-12) return 0;
  if (target >= total - 1e-10) return 1;
  if (seg.type === 'L') return target / total;
  let lo = 0,
    hi = 1,
    t = Math.max(0, Math.min(1, target / total));
  for (let i = 0; i < 9; i++) {
    const got = exactLightningSegmentArcLength(seg, t),
      err = got - target;
    if (Math.abs(err) <= Math.max(1e-6, total * 2e-6)) break;
    if (err < 0) lo = t;
    else hi = t;
    const dv = exactLightningDerivativeAt(seg, t),
      speed = Math.hypot(dv.x, dv.y),
      newton = speed > 1e-8 ? t - err / speed : NaN;
    t = Number.isFinite(newton) && newton > lo + 1e-6 && newton < hi - 1e-6 ? newton : (lo + hi) * 0.5;
  }
  return Math.max(0, Math.min(1, t));
}
function exactLightningBuildRail(segments, buildPreview = false, target = null) {
  const rail = target || { segments, total: 0, fullPieces: [], segmentCount: 0 };
  rail.segments = segments;
  rail.total = 0;
  rail.segmentCount = 0;
  const fullPieces = Array.isArray(rail.fullPieces) ? rail.fullPieces : (rail.fullPieces = []);
  fullPieces.length = 0;
  let piece = null,
    last = null;
  for (const seg of segments) {
    seg._samples = null;
    seg._length = exactLightningSegmentArcLength(seg, 1);
    seg._start = rail.total;
    rail.total += seg._length;
    rail.segmentCount++;
    if (buildPreview) {
      if (seg.breakBefore === true || !piece) {
        piece = [];
        fullPieces.push(piece);
        last = null;
      }
      const flat = exactLightningFlattenSegment(seg, 0.12, 10).samples;
      for (let i = 0; i < flat.length; i++) {
        const p = flat[i].p;
        if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 1e-9) {
          piece.push(p);
          last = p;
        }
      }
    }
  }
  return rail;
}
const dynamicExactLightningRecorderCache = new WeakMap();
function createExactLightningSplineRecorder() {
  const segments = [],
    segmentPool = [],
    pointPool = [],
    rail = { segments, total: 0, fullPieces: [], segmentCount: 0 };
  let segmentCursor = 0,
    pointCursor = 0,
    current = null,
    subpathStart = null,
    nextBreak = true;
  const point = (x, y) => {
    let p = pointPool[pointCursor];
    if (!p) p = pointPool[pointCursor] = { x: 0, y: 0 };
    pointCursor++;
    p.x = Number(x) || 0;
    p.y = Number(y) || 0;
    return p;
  };
  const start = (x, y) => {
    current = point(x, y);
    subpathStart = current;
    nextBreak = true;
  };
  const add = (type, p0, p1, p2 = null, p3 = null) => {
    let seg = segmentPool[segmentCursor];
    if (!seg)
      seg = segmentPool[segmentCursor] = {
        type: 'L',
        p0: null,
        p1: null,
        p2: null,
        p3: null,
        breakBefore: false,
      };
    segmentCursor++;
    seg.type = type;
    seg.p0 = p0;
    seg.p1 = p1;
    seg.p2 = p2;
    seg.p3 = p3;
    seg.breakBefore = nextBreak;
    seg._samples = null;
    seg._length = 0;
    seg._start = 0;
    nextBreak = false;
    segments.push(seg);
    current = exactLightningSegmentEnd(seg);
  };
  const api = {
    segments,
    rail,
    reset() {
      segments.length = 0;
      segmentCursor = 0;
      pointCursor = 0;
      current = null;
      subpathStart = null;
      nextBreak = true;
      rail.total = 0;
      rail.segmentCount = 0;
      rail.fullPieces.length = 0;
      return api;
    },
    moveTo(x, y) {
      start(x, y);
    },
    lineTo(x, y) {
      const p = point(x, y);
      if (!current) {
        current = p;
        subpathStart = p;
        nextBreak = true;
        return;
      }
      add('L', current, p);
    },
    quadraticCurveTo(cx, cy, x, y) {
      const p = point(x, y);
      if (!current) {
        current = p;
        subpathStart = p;
        nextBreak = true;
        return;
      }
      add('Q', current, point(cx, cy), p);
    },
    bezierCurveTo(c1x, c1y, c2x, c2y, x, y) {
      const p = point(x, y);
      if (!current) {
        current = p;
        subpathStart = p;
        nextBreak = true;
        return;
      }
      add('C', current, point(c1x, c1y), point(c2x, c2y), p);
    },
    closePath() {
      if (
        current &&
        subpathStart &&
        Math.hypot(current.x - subpathStart.x, current.y - subpathStart.y) > 1e-9
      )
        add('L', current, subpathStart);
      current = subpathStart;
      nextBreak = true;
    },
    finish(buildPreview = false) {
      return exactLightningBuildRail(segments, buildPreview === true, rail);
    },
  };
  return api;
}
function acquireDynamicExactLightningRecorder(owner) {
  if (!owner || typeof owner !== 'object') return createExactLightningSplineRecorder();
  let rec = dynamicExactLightningRecorderCache.get(owner);
  if (!rec) {
    rec = createExactLightningSplineRecorder();
    dynamicExactLightningRecorderCache.set(owner, rec);
  }
  return rec.reset();
}
function exactLightningAppendSegment(path, seg, move) {
  if (move) path.moveTo(seg.p0.x, seg.p0.y);
  if (seg.type === 'C') path.bezierCurveTo(seg.p1.x, seg.p1.y, seg.p2.x, seg.p2.y, seg.p3.x, seg.p3.y);
  else if (seg.type === 'Q') path.quadraticCurveTo(seg.p1.x, seg.p1.y, seg.p2.x, seg.p2.y);
  else path.lineTo(seg.p1.x, seg.p1.y);
}
function exactLightningSegmentIndexAtDistance(rail, distance) {
  const segs = rail?.segments || [];
  if (!segs.length) return -1;
  const d = Math.max(0, Math.min(Math.max(0, Number(rail.total) || 0) - 1e-12, Number(distance) || 0));
  let lo = 0,
    hi = segs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1,
      s = segs[mid];
    if (s._start + s._length <= d) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
function exactLightningAppendRange(rail, start, length, path, pieces) {
  if (!rail || !(rail.total > 0) || !(length > 1e-8)) return false;
  const a = Math.max(0, Math.min(rail.total, Number(start) || 0)),
    b = Math.max(a, Math.min(rail.total, a + (Number(length) || 0)));
  if (b <= a + 1e-8) return false;

  const first = exactLightningSegmentIndexAtDistance(rail, a),
    last = exactLightningSegmentIndexAtDistance(rail, Math.max(a, b - 1e-10));
  if (first < 0 || last < first) return false;
  let currentPiece = null,
    lastPoint = null,
    wrote = false;
  for (let si = first; si <= last; si++) {
    const seg = rail.segments[si],
      sa = seg._start,
      sb = sa + seg._length,
      oa = Math.max(a, sa),
      ob = Math.min(b, sb);
    if (ob <= oa + 1e-10) continue;
    const t0 = oa <= sa + 1e-10 ? 0 : exactLightningParamAtDistance(seg, oa - sa),
      t1 = ob >= sb - 1e-10 ? 1 : exactLightningParamAtDistance(seg, ob - sa),
      cut = t0 <= 1e-10 && t1 >= 1 - 1e-10 ? seg : exactLightningSliceSegment(seg, t0, t1);
    const discontinuity =
      seg.breakBefore === true ||
      !currentPiece ||
      !lastPoint ||
      Math.hypot(cut.p0.x - lastPoint.x, cut.p0.y - lastPoint.y) > 1e-7;
    if (discontinuity) {
      currentPiece = [];
      pieces.push(currentPiece);
      lastPoint = null;
    }
    exactLightningAppendSegment(path, cut, discontinuity || !wrote);
    const flat = exactLightningFlattenSegment(cut, 0.12, 10).samples;
    for (let i = 0; i < flat.length; i++) {
      const p = flat[i].p;
      if (!lastPoint || Math.hypot(p.x - lastPoint.x, p.y - lastPoint.y) > 1e-9) {
        currentPiece.push(p);
        lastPoint = p;
      }
    }
    wrote = true;
  }
  return wrote;
}
function exactLightningSelection(paths, layer, cfg, layerIndex = -1) {
  const rails = (paths || [])
    .map((path, index) => ({ rail: path?._exactLightningRail, path, index }))
    .filter((x) => x.rail?.total > 0);
  if (!rails.length) return null;
  const mode = ['perSegment', 'everyNth', 'across', 'perPath', 'whole'].includes(cfg.lightningMode)
    ? cfg.lightningMode
    : 'perPath';

  if (mode === 'across') return null;
  const frac = Math.max(
    0.01,
    Math.min(
      1,
      audioApplyNumeric('lightning.segment', Number(cfg.lightningSegmentPercent) || 100, layerIndex) / 100,
    ),
  );
  const random = cfg.lightningRandomPosition === true,
    cycle = Math.max(0, Math.round(Number(cfg.lightningCycleCount) || 0)),
    ranges = [];
  const add = (rail, start, length) => {
    const len = Math.max(0, Math.min(rail.total - start, length));
    if (len > 1e-8) ranges.push({ rail, start, length: len });
  };
  if (mode === 'perSegment' || mode === 'everyNth') {
    const N = Math.max(2, Math.round(Number(layer?.N) || 2)),
      K = Math.max(1, Math.round(Number(layer?.K) || 1)),
      segmentCount = Math.max(1, Math.round(N / Math.max(1, gcd(N, K)))),
      nth = Math.max(2, Math.min(24, Math.round(Number(cfg.lightningEveryN) || 2)));
    let global = 0;
    for (const item of rails) {
      const segLen = item.rail.total / segmentCount;
      for (let i = 0; i < segmentCount; i++) {
        const use = mode === 'perSegment' || global % nth === 0,
          salt = global++;
        if (!use) continue;
        const len = segLen * frac,
          room = Math.max(0, segLen - len),
          off = random ? sweepStableUnit(cycle * 4099 + salt * 131 + 17) * room : 0;
        add(item.rail, i * segLen + off, len);
      }
    }
  } else if (mode === 'perPath') {
    for (const item of rails) {
      const len = item.rail.total * frac,
        room = Math.max(0, item.rail.total - len),
        off = random ? sweepStableUnit(cycle * 4099 + item.index * 271 + 31) * room : 0;
      add(item.rail, off, len);
    }
  } else {
    let total = 0;
    const infos = [];
    for (const item of rails) {
      infos.push({ rail: item.rail, start: total, index: item.index });
      total += item.rail.total;
    }
    if (total > 0) {
      const len = total * frac,
        room = Math.max(0, total - len),
        off = random ? sweepStableUnit(cycle * 4099 + 73) * room : 0,
        end = off + len;
      for (const info of infos) {
        const a = Math.max(off, info.start),
          b = Math.min(end, info.start + info.rail.total);
        if (b > a) add(info.rail, a - info.start, b - a);
      }
    }
  }
  const strikePath = new Path2D(),
    pieces = [];
  for (const r of ranges) exactLightningAppendRange(r.rail, r.start, r.length, strikePath, pieces);
  return { ranges, pieces, strikePath };
}
function buildExactLightningPaths(frameCtx, forcePreview = false) {
  const source = getLayerFrameAuxiliaryPaths(frameCtx),
    layer = frameCtx?.layer,
    cfg = frameCtx?.layerSweep || getLayerSweepConfig(layer);
  if (!Array.isArray(source) || !source.length || !layer) return source || [];
  const frameId =
    Number(frameCtx?.frameId) || Number(frameCtx?.frame?.id) || Number(frameGeometryRuntime?.frameId) || 0;
  const cacheStem = forcePreview === true ? '_exactWebContour' : '_exactLightningPaths',
    cacheFrameKey = cacheStem + 'FrameId',
    cacheSourceKey = cacheStem + 'Source',
    cacheValueKey = cacheStem + 'Value';

  if (
    frameCtx &&
    frameCtx[cacheFrameKey] === frameId &&
    frameCtx[cacheSourceKey] === source &&
    frameCtx[cacheValueKey]
  )
    return frameCtx[cacheValueKey];
  const round = getRoundingStrength(layer.rounding),
    behavior = normalizeLightningBehaviorValue(cfg?.lightningBehavior, 'symmetric'),
    needsPreview = forcePreview === true || cfg?.lightningMode === 'across' || behavior !== 'symmetric';
  const dynamicSource =
    isCurrentFrameDynamicPathList(source) ||
    Boolean(runtimeState.morph?.active && state.morph?.mode !== 'light') ||
    frameCtx?.minimalFadeEnabled === true ||
    frameCtx?.greenMorphEnabled === true;
  const staticCacheable = !dynamicSource && !isSpiralLayer(layer);
  const staticKey = staticCacheable
    ? `exactSplineV425|preview:${needsPreview ? 1 : 0}|${normalizeSplineRenderMode(layer?.splineRenderMode)}|${layer?.profileMode || 'segments'}|shape:${layer?.roundingShape || 'spline'}|r:${round.toFixed(5)}|fourier:${state.fourierMode ? 1 : 0}:${Math.round((Number(state.fourierStrength) || 0) * 100) / 100}`
    : '';
  if (staticCacheable) {
    const variants = persistentExactLightningCache.get(source),
      hit = variants?.get(staticKey);
    if (hit) {
      if (frameCtx) {
        frameCtx[cacheFrameKey] = frameId;
        frameCtx[cacheSourceKey] = source;
        frameCtx[cacheValueKey] = hit;
      }
      return hit;
    }
  }

  if (isSpiralLayer(layer)) {
    const hasExactCubics = source.some(
      (path) => Array.isArray(path?._bezierSegments) && path._bezierSegments.length,
    );
    if (hasExactCubics) {
      const out = source.map((path) => {
        const cubics = path?._bezierSegments || [];
        if (!cubics.length) return path;
        const recorder = createExactLightningSplineRecorder(),
          q0 = cubics[0];
        recorder.moveTo(q0.p0.x, q0.p0.y);
        for (const q of cubics) recorder.bezierCurveTo(q.c1.x, q.c1.y, q.c2.x, q.c2.y, q.p3.x, q.p3.y);
        const rail = recorder.finish(needsPreview),
          preview =
            needsPreview && rail.fullPieces.length === 1 && rail.fullPieces[0].length > 1
              ? rail.fullPieces[0]
              : path.points || [];
        return { ...path, points: preview, cornerFlags: [], _exactLightningRail: rail };
      });
      if (isCurrentFrameDynamicPathList(source)) out._frameGeometryId = frameGeometryRuntime.frameId;
      out._lightningRenderedRail = true;
      out._exactLightningSplineRail = true;
      if (frameCtx) {
        frameCtx[cacheFrameKey] = frameId;
        frameCtx[cacheSourceKey] = source;
        frameCtx[cacheValueKey] = out;
      }
      return out;
    }

    const out = source.map((path) => {
      let pts = path?.points || [];
      if (round > 0.001 && Array.isArray(path?.cornerFlags) && path.cornerFlags.some(Boolean))
        pts = smoothMorphPath(pts, false, round, path.cornerFlags);
      if (state.fourierMode && pts?._fourierPrepared !== true)
        pts = buildFourierWavePoints(pts, false, `lightning-exact-spiral:${round.toFixed(4)}`);
      return { ...path, points: pts, cornerFlags: [] };
    });
    if (isCurrentFrameDynamicPathList(source)) out._frameGeometryId = frameGeometryRuntime.frameId;
    out._lightningRenderedRail = true;
    if (frameCtx) {
      frameCtx[cacheFrameKey] = frameId;
      frameCtx[cacheSourceKey] = source;
      frameCtx[cacheValueKey] = out;
    }
    return out;
  }
  let morphInfo = null;
  if (runtimeState.morph?.active && state.morph?.mode !== 'light') {
    const mt = Number.isFinite(Number(runtimeState.morph.geometryT))
      ? Number(runtimeState.morph.geometryT)
      : Number(runtimeState.morph.progress) || 0;
    morphInfo = getLampMorphRenderInfo(frameCtx.layerIndex, mt, layer);
  }
  const out = source.map((path) => {
    const pts = path?.points || [];
    if (pts.length < 2) return path;
    const recorder = dynamicSource
      ? acquireDynamicExactLightningRecorder(path)
      : createExactLightningSplineRecorder();

    if (
      path?._greenRenderedRail === true ||
      source?._greenRenderedRail === true ||
      path?._stableRoundedSplineRail === true
    ) {
      recorder.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) recorder.lineTo(pts[i].x, pts[i].y);
      if (path.closed) recorder.closePath();
    } else if (morphInfo) {
      drawMorphPathQuality(
        recorder,
        pts,
        Boolean(path.closed),
        morphInfo.roundingFrac,
        morphInfo.profileMode,
        morphInfo.splineBlend,
        morphInfo.continuousProfileBlend,
        morphInfo.splineRenderMode,
        path.cornerFlags || [],
        path.bridgeRoundFlags || [],
        layer?.wholeCurveSpline === true,
        0,
        0,
        layer,
      );
    } else if (useSmoothSplinePath(layer, round, path)) {
      splinePathForDraw(
        recorder,
        pts,
        Boolean(path.closed),
        round,
        path.cornerFlags || [],
        path.bridgeRoundFlags || [],
        layer.wholeCurveSpline === true,
        1,
        0,
        layer,
      );
    } else {
      roundPolylineForDraw(
        recorder,
        pts,
        Boolean(path.closed),
        round,
        path.cornerFlags || [],
        null,
        false,
        null,
        layer,
      );
    }
    const rail = recorder.finish(needsPreview),
      preview =
        needsPreview && rail.fullPieces.length === 1 && rail.fullPieces[0].length > 1
          ? rail.fullPieces[0]
          : pts;
    return { ...path, points: preview, cornerFlags: [], _exactLightningRail: rail };
  });
  if (isCurrentFrameDynamicPathList(source)) out._frameGeometryId = frameGeometryRuntime.frameId;
  out._lightningRenderedRail = true;
  out._exactLightningSplineRail = true;
  if (staticCacheable) {
    let variants = persistentExactLightningCache.get(source);
    if (!variants) {
      variants = new Map();
      persistentExactLightningCache.set(source, variants);
    }
    variants.set(staticKey, out);
  }
  if (frameCtx) {
    frameCtx[cacheFrameKey] = frameId;
    frameCtx[cacheSourceKey] = source;
    frameCtx[cacheValueKey] = out;
  }
  return out;
}
// The Spiral/Web rail must be the *stroke* carrier, not the separate
// Lightning preview. In particular, Corridor's shared Spiral master is
// built from the original drawData paths and strokeVariableWidthSpiralPath;
// an auxiliary path may already have been Fourier-transformed or rounded
// with a different policy. Reusing it here produces a detached Web spiral.
function buildExactWebContourPaths(frameCtx) {
  const layer = frameCtx?.layer;
  if (layer && typeof isSpiralLayer === 'function' && isSpiralLayer(layer)) {
    const dynamic =
      frameCtx?.geometryPlan?.dynamic === true ||
      frameCtx?.greenMorphEnabled === true ||
      frameCtx?.minimalFadeEnabled === true ||
      frameCtx?.morphFrameActive === true;
    const raw = dynamic
      ? getLayerFrameAuxiliaryPaths(frameCtx)
      : frameCtx?.staticDrawData?.paths ||
        getCachedLayerDrawData(layer)?.paths ||
        getLayerFrameAuxiliaryPaths(frameCtx);
    const rail = buildExactSpiralEffectPaths(raw, layer);
    if (Array.isArray(rail) && rail.length) {
      rail._webSpiralStrokeCarrier = true;
      return rail;
    }
    return [];
  }
  const out = buildExactLightningPaths(frameCtx, true);
  if (Array.isArray(out)) {
    out._webBezierContourTruth = true;
    for (const path of out) if (path && typeof path === 'object') path._webBezierContourTruth = true;
  }
  return out;
}
function glintSegmentToCubic(seg, forceBreak = false) {
  if (!seg) return null;
  const p0 = seg.p0;
  if (!p0) return null;
  if (seg.type === 'C')
    return { p0, c1: seg.p1, c2: seg.p2, p3: seg.p3, breakBefore: forceBreak || seg.breakBefore === true };
  if (seg.type === 'Q') {
    const p3 = seg.p2,
      c1 = { x: p0.x + ((seg.p1.x - p0.x) * 2) / 3, y: p0.y + ((seg.p1.y - p0.y) * 2) / 3 },
      c2 = { x: p3.x + ((seg.p1.x - p3.x) * 2) / 3, y: p3.y + ((seg.p1.y - p3.y) * 2) / 3 };
    return { p0, c1, c2, p3, breakBefore: forceBreak || seg.breakBefore === true };
  }
  const p3 = seg.p1,
    dx = p3.x - p0.x,
    dy = p3.y - p0.y;
  return {
    p0,
    c1: { x: p0.x + dx / 3, y: p0.y + dy / 3 },
    c2: { x: p0.x + (dx * 2) / 3, y: p0.y + (dy * 2) / 3 },
    p3,
    breakBefore: forceBreak || seg.breakBefore === true,
  };
}
function appendExactRailRangeCubics(rail, start, length, out) {
  if (!rail || !(rail.total > 0) || !(length > 1e-8)) return false;
  const a = Math.max(0, Math.min(rail.total, Number(start) || 0)),
    b = Math.max(a, Math.min(rail.total, a + (Number(length) || 0)));
  if (b <= a + 1e-8) return false;
  const first = exactLightningSegmentIndexAtDistance(rail, a),
    last = exactLightningSegmentIndexAtDistance(rail, Math.max(a, b - 1e-10));
  if (first < 0 || last < first) return false;
  let wrote = false;
  for (let si = first; si <= last; si++) {
    const seg = rail.segments[si],
      sa = seg._start,
      sb = sa + seg._length,
      oa = Math.max(a, sa),
      ob = Math.min(b, sb);
    if (ob <= oa + 1e-10) continue;
    const t0 = oa <= sa + 1e-10 ? 0 : exactLightningParamAtDistance(seg, oa - sa),
      t1 = ob >= sb - 1e-10 ? 1 : exactLightningParamAtDistance(seg, ob - sa),
      cut = t0 <= 1e-10 && t1 >= 1 - 1e-10 ? seg : exactLightningSliceSegment(seg, t0, t1),
      c = glintSegmentToCubic(cut, !wrote || seg.breakBefore === true);
    if (c) {
      out.push(c);
      wrote = true;
    }
  }
  return wrote;
}
function appendWrappedExactRailCubics(rail, start, length, out) {
  if (!rail?.total || !(length > 0)) return;
  const total = rail.total;
  let a = Number(start) || 0,
    remain = Math.min(Math.max(0, Number(length) || 0), total);
  while (a < 0) a += total;
  while (a >= total) a -= total;
  while (remain > 1e-8) {
    const take = Math.min(remain, total - a);
    appendExactRailRangeCubics(rail, a, take, out);
    remain -= take;
    a = 0;
  }
}

export {
  appendExactRailRangeCubics,
  appendWrappedExactRailCubics,
  buildExactLightningPaths,
  buildExactWebContourPaths,
  exactLightningParamAtDistance,
  exactLightningSelection,
  exactLightningSliceSegment,
  glintSegmentToCubic,
  isHighPrecisionLightning,
  normalizeLightningBehaviorValue,
  normalizeLightningPrecisionValue,
};
