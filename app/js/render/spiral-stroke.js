// Отрисовка спирали: адаптивные вершины для GPU, переменная толщина, направляющие построения профиля.
import '../geometry/spiral/effect-rails.js'; // initialisation order: this module runs after it
import { roundPolylineForDraw } from '../geometry/polyline-rounding.js';
import { fillCanvasGeometry, gcd } from '../core/defaults-layers.js';
import { getRoundingStrength } from '../core/palette.js';
import { getMainCanvasRenderDpr } from '../core/render-runtime.js';
import { runtimeState, state } from '../core/state.js';
import {
  getCachedLayerDrawData,
  getEffectiveLayerRadius,
  getLayerStrokeWidthMultiplier,
} from '../effects/motion.js';
import { GeometryKernel } from '../geometry/kernel.js';
import { smoothMorphPath } from '../geometry/morph.js';
import { getEffectiveSpiralMorphTransport } from '../morph-runtime/morph-mode.js';
import { useSmoothSplinePath } from '../geometry/profile-model.js';
import { buildFourierWavePoints, prepareGpuFourierRail } from '../geometry/fourier.js';
import { splineCubicPoint, splinePathForDraw } from '../geometry/spline-rounding.js';
import { spiralSmoothStep01, spiralStyleWithAlpha } from '../geometry/spiral/polyline.js';
import {
  buildSpiralBezierSegments,
  sampleSmoothSpiralSplineForVariableWidth,
} from '../geometry/spiral/bezier-carrier.js';
import { isSpiralLayer } from '../geometry/spiral/order-params.js';
import { validateSpiralEdgePoints } from '../geometry/spiral/profile-prep.js';

const adaptiveSpiralGPUStats = {
  attempts: 0,
  accepted: 0,
  bypassedDynamic: 0,
  bypassedSmall: 0,
  rejected: 0,
  originalPoints: 0,
  keptPoints: 0,
  originalSegments: 0,
  keptSegments: 0,
  maxObservedPositionError: 0,
  maxObservedLogWidthError: 0,
  maxObservedAlphaError: 0,
};
function adaptiveSpiralVertexAlpha(segmentAlphas, index, pointCount, fallback = 1) {
  if (!segmentAlphas || !segmentAlphas.length) return fallback;
  if (index <= 0) return Number.isFinite(Number(segmentAlphas[0])) ? Number(segmentAlphas[0]) : fallback;
  if (index >= pointCount - 1)
    return Number.isFinite(Number(segmentAlphas[segmentAlphas.length - 1]))
      ? Number(segmentAlphas[segmentAlphas.length - 1])
      : fallback;
  const a = Number(segmentAlphas[index - 1]),
    b = Number(segmentAlphas[index]);
  if (Number.isFinite(a) && Number.isFinite(b)) return (a + b) * 0.5;
  if (Number.isFinite(a)) return a;
  if (Number.isFinite(b)) return b;
  return fallback;
}
function adaptiveSpiralPointLineInfo(p, a, b) {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    l2 = dx * dx + dy * dy;
  if (l2 < 1e-12) return { t: 0, dist: Math.hypot(p.x - a.x, p.y - a.y) };
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  const qx = a.x + dx * t,
    qy = a.y + dy * t;
  return { t, dist: Math.hypot(p.x - qx, p.y - qy) };
}
function compactNativeWebGPUSpiralPoints(points, segmentAlphas) {
  const src = Array.isArray(points) ? points : [],
    n = src.length;
  adaptiveSpiralGPUStats.attempts++;
  if (n < 5) {
    adaptiveSpiralGPUStats.bypassedSmall++;
    return { points: src, segmentAlphas, keptIndices: null };
  }
  const dynamicMorph = Boolean(runtimeState?.morph?.active && state?.morph?.mode !== 'light');
  if (dynamicMorph || state.showRoundingGuides) {
    adaptiveSpiralGPUStats.bypassedDynamic++;
    return { points: src, segmentAlphas, keptIndices: null };
  }
  const dpr = Math.max(1, Math.min(2, Number(getMainCanvasRenderDpr?.()) || 1));
  const posTol = Math.max(0.16, 0.22 * dpr); // <= ~0.22 CSS px at the active backing-store DPR.
  const logWidthTol = 0.0055; // ~0.55% multiplicative width error.
  const alphaTol = 0.0045; // <0.5% alpha error.
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  for (let i = 1; i < n - 1; i++)
    if (src[i]?.__profileCorner === true || src[i]?.__profileKeyCorner === true) keep[i] = 1;
  const stack = [[0, n - 1]];
  let maxPos = 0,
    maxW = 0,
    maxA = 0;
  while (stack.length) {
    const [lo, hi] = stack.pop();
    if (hi - lo <= 1) continue;
    let forced = -1;
    for (let i = lo + 1; i < hi; i++) {
      if (keep[i]) {
        forced = i;
        break;
      }
    }
    if (forced > lo) {
      stack.push([lo, forced], [forced, hi]);
      continue;
    }
    const a = src[lo],
      b = src[hi];
    const lwa = Math.log(Math.max(0.02, Number(a?.widthScale) || 1));
    const lwb = Math.log(Math.max(0.02, Number(b?.widthScale) || 1));
    const aa = adaptiveSpiralVertexAlpha(segmentAlphas, lo, n, 1);
    const ab = adaptiveSpiralVertexAlpha(segmentAlphas, hi, n, aa);
    let best = -1,
      bestScore = 0;
    for (let i = lo + 1; i < hi; i++) {
      const p = src[i],
        info = adaptiveSpiralPointLineInfo(p, a, b);
      const lw = Math.log(Math.max(0.02, Number(p?.widthScale) || 1));
      const widthErr = Math.abs(lw - (lwa + (lwb - lwa) * info.t));
      const av = adaptiveSpiralVertexAlpha(segmentAlphas, i, n, aa);
      const alphaErr = Math.abs(av - (aa + (ab - aa) * info.t));
      maxPos = Math.max(maxPos, info.dist);
      maxW = Math.max(maxW, widthErr);
      maxA = Math.max(maxA, alphaErr);
      const score = Math.max(info.dist / posTol, widthErr / logWidthTol, alphaErr / alphaTol);
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    if (best >= 0 && bestScore > 1) {
      keep[best] = 1;
      stack.push([lo, best], [best, hi]);
    }
  }
  const indices = [];
  for (let i = 0; i < n; i++) if (keep[i]) indices.push(i);
  if (indices.length < 2 || indices.length >= n) {
    adaptiveSpiralGPUStats.rejected++;
    return { points: src, segmentAlphas, keptIndices: null };
  }
  const out = indices.map((i) => src[i]);

  let residualPos = 0,
    residualW = 0,
    residualA = 0;
  for (let s = 0; s < indices.length - 1; s++) {
    const lo = indices[s],
      hi = indices[s + 1],
      a = src[lo],
      b = src[hi];
    const lwa = Math.log(Math.max(0.02, Number(a?.widthScale) || 1)),
      lwb = Math.log(Math.max(0.02, Number(b?.widthScale) || 1));
    const aa = adaptiveSpiralVertexAlpha(segmentAlphas, lo, n, 1),
      ab = adaptiveSpiralVertexAlpha(segmentAlphas, hi, n, aa);
    for (let i = lo + 1; i < hi; i++) {
      const info = adaptiveSpiralPointLineInfo(src[i], a, b),
        lw = Math.log(Math.max(0.02, Number(src[i]?.widthScale) || 1)),
        av = adaptiveSpiralVertexAlpha(segmentAlphas, i, n, aa);
      residualPos = Math.max(residualPos, info.dist);
      residualW = Math.max(residualW, Math.abs(lw - (lwa + (lwb - lwa) * info.t)));
      residualA = Math.max(residualA, Math.abs(av - (aa + (ab - aa) * info.t)));
    }
  }
  adaptiveSpiralGPUStats.maxObservedPositionError = Math.max(
    adaptiveSpiralGPUStats.maxObservedPositionError,
    residualPos,
  );
  adaptiveSpiralGPUStats.maxObservedLogWidthError = Math.max(
    adaptiveSpiralGPUStats.maxObservedLogWidthError,
    residualW,
  );
  adaptiveSpiralGPUStats.maxObservedAlphaError = Math.max(
    adaptiveSpiralGPUStats.maxObservedAlphaError,
    residualA,
  );
  let outAlpha = null;
  if (segmentAlphas && segmentAlphas.length) {
    outAlpha = new Float32Array(out.length - 1);
    for (let s = 0; s < outAlpha.length; s++) {
      const i0 = indices[s],
        i1 = indices[s + 1];
      let weighted = 0,
        weight = 0;
      for (let i = i0; i < i1; i++) {
        const p = src[i],
          q = src[i + 1],
          w = Math.max(1e-6, Math.hypot(q.x - p.x, q.y - p.y)),
          av = Number(segmentAlphas[i]);
        if (Number.isFinite(av)) {
          weighted += av * w;
          weight += w;
        }
      }
      outAlpha[s] = weight > 0 ? weighted / weight : adaptiveSpiralVertexAlpha(segmentAlphas, i0, n, 1);
    }
  }
  if (
    Math.abs(out[0].x - src[0].x) > 1e-9 ||
    Math.abs(out[0].y - src[0].y) > 1e-9 ||
    Math.abs(out[out.length - 1].x - src[n - 1].x) > 1e-9 ||
    Math.abs(out[out.length - 1].y - src[n - 1].y) > 1e-9 ||
    !validateSpiralEdgePoints(out).ok
  ) {
    adaptiveSpiralGPUStats.rejected++;
    return { points: src, segmentAlphas, keptIndices: null };
  }
  adaptiveSpiralGPUStats.accepted++;
  adaptiveSpiralGPUStats.originalPoints += n;
  adaptiveSpiralGPUStats.keptPoints += out.length;
  adaptiveSpiralGPUStats.originalSegments += n - 1;
  adaptiveSpiralGPUStats.keptSegments += out.length - 1;
  return { points: out, segmentAlphas: outAlpha, keptIndices: indices };
}
const spiralStrokePreparedCache = new WeakMap();
const spiralSegmentAlphaCache = new WeakMap();
const spiralStrokeHotpathStats = {
  requests: 0,
  hits: 0,
  builds: 0,
  staticHits: 0,
  frameHits: 0,
  alphaBufferReuses: 0,
};
function prepareSpiralStrokePoints(
  points,
  roundingFrac,
  cornerFlags,
  smoothSpline,
  splineShape = false,
  filletLayer = null,
) {
  if (!Array.isArray(points) || points.length < 2) return points;
  spiralStrokeHotpathStats.requests++;
  const round = Math.max(0, Math.min(2, Number(roundingFrac) || 0));
  const frameTag = Number(points._frameGeometryId) || 0;
  const fourier = state.fourierMode === true ? 1 : 0;
  const fourierStrength = Number(state.fourierStrength) || 0;
  const key = `${smoothSpline === true ? 1 : 0}|${splineShape ? 1 : 0}|shape:${filletLayer?.roundingShape || 'spline'}|corner:${filletLayer?.roundingCornerType || 'classic'}|${round.toFixed(5)}|${fourier}|${fourierStrength}`;
  const rec = spiralStrokePreparedCache.get(points);
  if (rec && rec.key === key && rec.cornerFlags === cornerFlags && rec.frameTag === frameTag) {
    spiralStrokeHotpathStats.hits++;
    if (frameTag) spiralStrokeHotpathStats.frameHits++;
    else spiralStrokeHotpathStats.staticHits++;
    return rec.points;
  }
  let pts = points;
  if (fourier) {
    pts = buildFourierWavePoints(points, false);
  } else if (points._somataJoinedFillet === true && points._spiroRetainedCubics?.length) {
    const cubics = points._spiroRetainedCubics;
    pts = [{ ...cubics[0].p0, widthScale: cubics[0].widthScale0 }];
    for (const q of cubics)
      for (let j = 1; j <= 8; j++) {
        const u = j / 8,
          p = splineCubicPoint(q, u),
          a = q.widthScale0 ?? 1,
          b = q.widthScale1 ?? 1;
        pts.push({ ...p, widthScale: a + (b - a) * u });
      }
  } else if (filletLayer?.roundingCornerType === 'simple' &&
      ((!points._spiroRetainedCubics?.length && (smoothSpline === true || round > 0.001)) ||
        (filletLayer.profileMode === 'spline' && points._spiroRetainedCubics?.length))) {
    // Use the same exact legacy cubics as the GPU stroke. Do not route
    // Segments/Discrete through Spline+ solely because rounding is positive.
    const cubics = buildSpiralBezierSegments(points, round, cornerFlags, smoothSpline, splineShape, filletLayer);
    if (cubics.length) {
      pts = [{ ...cubics[0].p0, widthScale: cubics[0].widthScale0 }];
      for (const q of cubics) {
        const a = Math.max(0.02, Number(q.widthScale0) || 1),
          b = Math.max(0.02, Number(q.widthScale1) || a);
        for (let j = 1; j <= 12; j++) {
          const u = j / 12;
          pts.push({ ...splineCubicPoint(q, u), widthScale: Math.exp(Math.log(a) * (1 - u) + Math.log(b) * u) });
        }
      }
    }
  } else if (smoothSpline === true) {
    pts = sampleSmoothSpiralSplineForVariableWidth(points, round, cornerFlags, splineShape, filletLayer);
  } else {
    if (round > 0.001 && Array.isArray(cornerFlags) && cornerFlags.some(Boolean))
      pts = smoothMorphPath(points, false, round, cornerFlags);
  }
  spiralStrokePreparedCache.set(points, { key, cornerFlags, frameTag, points: pts });
  spiralStrokeHotpathStats.builds++;
  return pts;
}
function acquireSpiralSegmentAlphaBuffer(points, count) {
  let buf = spiralSegmentAlphaCache.get(points);
  if (!(buf instanceof Float32Array) || buf.length !== count) {
    buf = new Float32Array(count);
    spiralSegmentAlphaCache.set(points, buf);
  } else spiralStrokeHotpathStats.alphaBufferReuses++;
  return buf;
}
function strokeVariableWidthSpiralPath(
  ctx,
  points,
  roundingFrac = 0,
  cornerFlags = null,
  smoothSpline = false,
  filletLayer = null,
  strokeGrowth = 1,
) {
  if (!Array.isArray(points) || points.length < 2 || ctx.__suppressStroke || strokeGrowth <= 0) return;

  const round = Math.max(0, Math.min(2, Number(roundingFrac) || 0));
  const splineShape = round > 0 && filletLayer && !state.fourierMode;
  if (splineShape && filletLayer?.roundingCornerType !== 'simple') smoothSpline = true;
  if (filletLayer?.roundingCornerType === 'simple' && !state.fourierMode)
    smoothSpline = smoothSpline === true && useSmoothSplinePath(filletLayer);
  const baseWidth = Math.max(0.05, Number(ctx.lineWidth) || 1);
  const alphaStart = Math.max(0, Math.min(1, Number(ctx.globalAlpha) || 0));
  const alphaEndRatioRaw = Number(ctx.__spiralCorridorAlphaEndRatio);
  const alphaRampActive = Number.isFinite(alphaEndRatioRaw) && Math.abs(alphaEndRatioRaw - 1) > 1e-5;
  const alphaEnd = alphaRampActive
    ? Math.max(0, Math.min(1, alphaStart * Math.max(0, alphaEndRatioRaw)))
    : alphaStart;

  if (
    state.fourierMode !== true &&
    typeof ctx.__recordVariableWidthBezierSpiral === 'function' &&
    (ctx.__spiroNativeBezierSpiral === true || ctx.__spiroGLGeometryRecorder === true)
  ) {
    const cubics = buildSpiralBezierSegments(
      points,
      round,
      cornerFlags,
      smoothSpline === true,
      splineShape,
      filletLayer,
    );
    if (cubics.length) {
      const lastWidthScale = Math.max(0.02, Number(cubics[cubics.length - 1]?.widthScale1) || 1),
        logSpan = Math.log(lastWidthScale);
      const alphaForWidth = (w, fallbackT) => {
        if (!alphaRampActive) return alphaStart;
        let t = Math.max(0, Math.min(1, Number(fallbackT) || 0));
        if (Math.abs(logSpan) > 1e-7)
          t = Math.max(0, Math.min(1, Math.log(Math.max(0.02, Number(w) || 1)) / logSpan));
        t = spiralSmoothStep01(t);
        return alphaStart + (alphaEnd - alphaStart) * t;
      };
      for (let i = 0; i < cubics.length; i++) {
        const q = cubics[i];
        q.alpha0 = alphaForWidth(q.widthScale0, i / Math.max(1, cubics.length));
        q.alpha1 = alphaForWidth(q.widthScale1, (i + 1) / Math.max(1, cubics.length));
      }
      if (ctx.__recordVariableWidthBezierSpiral(cubics, baseWidth, strokeGrowth)) return;
    }
  }

  if (ctx.__somataGpuFourierRecording === true && state.fourierMode && !alphaRampActive) {
    const rail = prepareGpuFourierRail(points, false);
    if (rail && ctx.__recordGpuFourierSpiral?.(rail, baseWidth, strokeGrowth)) return;
  }
  let pts = prepareSpiralStrokePoints(points, round, cornerFlags, smoothSpline, splineShape, filletLayer);
  if (!Array.isArray(pts) || pts.length < 2) return;

  const lastWidthScale = Math.max(0.02, Number(pts[pts.length - 1]?.widthScale) || 1);
  const logWidthSpan = Math.log(lastWidthScale);
  const segmentRampT = (i, wa, wb) => {
    if (Math.abs(logWidthSpan) > 1e-7) {
      const wm = Math.max(0.02, Math.sqrt(wa * wb));
      return Math.max(0, Math.min(1, Math.log(wm) / logWidthSpan));
    }
    return Math.max(0, Math.min(1, (i + 0.5) / Math.max(1, pts.length - 1)));
  };
  if (
    ctx.__spiroGLGeometryRecorder === true &&
    ctx.__spiroNativeVariableWidth === true &&
    typeof ctx.__recordVariableWidthSpiral === 'function'
  ) {
    const segmentAlphas = acquireSpiralSegmentAlphaBuffer(pts, Math.max(0, pts.length - 1));
    for (let i = 0; i < segmentAlphas.length; i++) {
      const wa = Math.max(0.02, Number(pts[i]?.widthScale) || 1);
      const wb = Math.max(0.02, Number(pts[i + 1]?.widthScale) || wa);
      if (alphaRampActive) {
        const t = spiralSmoothStep01(segmentRampT(i, wa, wb));
        segmentAlphas[i] = alphaStart + (alphaEnd - alphaStart) * t;
      } else segmentAlphas[i] = alphaStart;
    }
    if (ctx.__recordVariableWidthSpiral(pts, baseWidth, segmentAlphas, strokeGrowth)) return;
  }
  if (ctx.__spiroGLGeometryRecorder === true) {
    const prevWidth = ctx.lineWidth;
    const prevAlpha = ctx.globalAlpha;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i],
        b = pts[i + 1];
      const dx = (Number(b?.x) || 0) - (Number(a?.x) || 0);
      const dy = (Number(b?.y) || 0) - (Number(a?.y) || 0);
      if (dx * dx + dy * dy < 1e-12) continue;
      const wa = Math.max(0.02, Number(a?.widthScale) || 1);
      const wb = Math.max(0.02, Number(b?.widthScale) || 1);
      ctx.lineWidth = baseWidth * Math.sqrt(wa * wb);
      if (alphaRampActive) {
        const t = spiralSmoothStep01(segmentRampT(i, wa, wb));
        ctx.globalAlpha = alphaStart + (alphaEnd - alphaStart) * t;
      }
      ctx.beginPath();
      ctx.moveTo(Number(a?.x) || 0, Number(a?.y) || 0);
      ctx.lineTo(Number(b?.x) || 0, Number(b?.y) || 0);
      if (strokeGrowth < 1 && ctx.__strokeWithGrowth) ctx.__strokeWithGrowth(strokeGrowth);
      else {
        ctx.lineWidth *= strokeGrowth;
        ctx.stroke();
      }
    }
    ctx.lineWidth = prevWidth;
    ctx.globalAlpha = prevAlpha;
    return;
  }

  const left = new Array(pts.length);
  const right = new Array(pts.length);
  const segNormals = new Array(Math.max(1, pts.length - 1));
  const safePoint = (i) => pts[Math.max(0, Math.min(pts.length - 1, i))];

  for (let i = 0; i < pts.length - 1; i++) {
    const a = safePoint(i),
      b = safePoint(i + 1);
    let dx = (Number(b.x) || 0) - (Number(a.x) || 0);
    let dy = (Number(b.y) || 0) - (Number(a.y) || 0);
    let len = Math.hypot(dx, dy);
    if (len < 1e-9 && i > 0) {
      segNormals[i] = { ...segNormals[i - 1] };
      continue;
    }
    if (len < 1e-9) {
      dx = 1;
      dy = 0;
      len = 1;
    }
    segNormals[i] = { x: -dy / len, y: dx / len };
  }
  for (let i = 1; i < segNormals.length; i++) if (!segNormals[i]) segNormals[i] = { ...segNormals[i - 1] };
  if (!segNormals[0]) segNormals[0] = { x: 0, y: 1 };

  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const widthScale = Math.max(0.02, Number(p.widthScale) || 1);
    const half = baseWidth * widthScale * strokeGrowth * 0.5;
    const nPrev = segNormals[Math.max(0, i - 1)];
    const nNext = segNormals[Math.min(segNormals.length - 1, i)];
    let nx,
      ny,
      miter = 1;
    if (i === 0) {
      nx = nNext.x;
      ny = nNext.y;
    } else if (i === pts.length - 1) {
      nx = nPrev.x;
      ny = nPrev.y;
    } else {
      nx = nPrev.x + nNext.x;
      ny = nPrev.y + nNext.y;
      const nl = Math.hypot(nx, ny);
      if (nl < 1e-6) {
        nx = nNext.x;
        ny = nNext.y;
      } else {
        nx /= nl;
        ny /= nl;
      }
      const denom = Math.abs(nx * nNext.x + ny * nNext.y);
      miter = Math.min(2.4, 1 / Math.max(0.35, denom));
    }
    const ox = nx * half * miter,
      oy = ny * half * miter;
    left[i] = { x: p.x + ox, y: p.y + oy };
    right[i] = { x: p.x - ox, y: p.y - oy };
  }

  ctx.save();
  if (alphaRampActive && typeof ctx.createLinearGradient === 'function') {
    const p0 = pts[0],
      p1 = pts[pts.length - 1];
    const c0 = spiralStyleWithAlpha(ctx.strokeStyle, alphaStart);
    const c1 = spiralStyleWithAlpha(ctx.strokeStyle, alphaEnd);
    if (c0 && c1) {
      const gradient = ctx.createLinearGradient(
        Number(p0?.x) || 0,
        Number(p0?.y) || 0,
        Number(p1?.x) || 0,
        Number(p1?.y) || 0,
      );
      for (const t of [0, 0.25, 0.5, 0.75, 1]) {
        const sm = spiralSmoothStep01(t);
        const ca = spiralStyleWithAlpha(ctx.strokeStyle, alphaStart + (alphaEnd - alphaStart) * sm);
        if (ca) gradient.addColorStop(t, ca);
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = gradient;
    } else {
      ctx.globalAlpha = (alphaStart + alphaEnd) * 0.5;
      ctx.fillStyle = ctx.strokeStyle;
    }
  } else {
    ctx.fillStyle = ctx.strokeStyle;
  }
  ctx.beginPath();
  ctx.moveTo(left[0].x, left[0].y);
  for (let i = 1; i < left.length; i++) ctx.lineTo(left[i].x, left[i].y);
  for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i].x, right[i].y);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
function renderLayerOrbitPaths(ctx, layer, prepared = null) {
  const drawData = prepared || getCachedLayerDrawData(layer);
  const paths = drawData.paths;
  const canonicalTopology = GeometryKernel.inspectStaticDrawData(drawData);
  const roundingFrac = getRoundingStrength(layer.rounding);

  const showGuides = !!state.showRoundingGuides && roundingFrac > 0.001;
  const variableSpiralWidth = isSpiralLayer(layer);
  if (showGuides && layer.profileMode === 'spline') {
    drawSplineProfileConstructionGuides(ctx, layer);
  }

  if (
    !ctx?.__spiroGLGeometryRecorder &&
    !state.fourierMode &&
    !showGuides &&
    !variableSpiralWidth &&
    drawData.combinedStrokePath2d
  ) {
    if (!ctx.__suppressFill && layer.fill) {
      for (const contour of GeometryKernel.staticContours(drawData, 'canvasFill', true)) {
        const p2d = drawData.path2ds?.[contour.pathIndex];
        if (p2d) fillCanvasGeometry(ctx, layer, p2d);
      }
    }
    if (!ctx.__suppressStroke) ctx.stroke(drawData.combinedStrokePath2d);
    return;
  }

  // One line per canonical branch. Batch the original independent branches
  // as separate GPU subpaths, never connect their endpoints. No resampling.
  // Torn transport and order-0 (polygon) transitions retain split topology.
  const morphActive = runtimeState?.morph?.active === true;
  const transport = morphActive ? getEffectiveSpiralMorphTransport() : '';
  const zeroOrder = (v) =>
    Boolean(v && (v.spiralEnabled !== true || Math.abs(Number(v.spiralOrder) || 0) < 1e-8));
  const polygonTransition =
    morphActive &&
    ((runtimeState.morph.renderSourceLayers || []).some(zeroOrder) ||
      (runtimeState.morph.renderTargetLayers || []).some(zeroOrder));
  const wholeTurn =
    variableSpiralWidth &&
    Math.abs(Number(layer.spiralOrder) || 0) > 1e-8 &&
    transport !== 'torn' &&
    !polygonTransition;
  const previousAdaptiveSpiral = ctx.__disableAdaptiveSpiral;
  const previousBatch = ctx.__spiroWholeTurnBatch;
  const previousBatchCommand = ctx.__spiroWholeTurnCommand;
  if (ctx.__spiroGLGeometryRecorder === true) {
    ctx.__spiroWholeTurnBatch = wholeTurn;
    ctx.__spiroWholeTurnCommand = null;
    // Fourier must use precisely the authored sample set: no RDP
    // simplification or extra interpolation of its native GPU carrier.
    if (wholeTurn && state.fourierMode === true) ctx.__disableAdaptiveSpiral = true;
  }
  try {
    for (let i = 0; i < paths.length; i++) {
      const path = paths[i];
      if (!path.points || path.points.length < 2) continue;
      if (showGuides && layer.profileMode !== 'spline') {
        strokeConstructionPolyline(ctx, path.points, path.closed, layer);
      }

      if (variableSpiralWidth) {
        strokeVariableWidthSpiralPath(
          ctx,
          path.points,
          path.spiralProfileRoundingBaked === true ? 0 : roundingFrac,
          path.cornerFlags || [],
          layer.profileMode === 'spline' && path.spiralProfileSplineBaked !== true,
          layer,
        );
        continue;
      }
      const p2d =
        !ctx?.__spiroGLGeometryRecorder && !state.fourierMode && !showGuides ? drawData.path2ds?.[i] : null;
      if (p2d) {
        if (!ctx.__suppressFill && layer.fill && path.closed) fillCanvasGeometry(ctx, layer, p2d);
        if (!ctx.__suppressStroke) ctx.stroke(p2d);
      } else {
        ctx.beginPath();
        if (useSmoothSplinePath(layer, roundingFrac, path))
          splinePathForDraw(
            ctx,
            path.points,
            path.closed,
            roundingFrac,
            path.cornerFlags || [],
            path.bridgeRoundFlags || [],
            layer.wholeCurveSpline === true,
            1,
            0,
            layer,
          );
        else
          roundPolylineForDraw(
            ctx,
            path.points,
            path.closed,
            roundingFrac,
            path.cornerFlags || [],
            null,
            false,
            null,
            layer,
            path.bridgeRoundFlags || [],
          );
        if (!ctx.__suppressFill && layer.fill && path.closed) fillCanvasGeometry(ctx, layer);
        if (!ctx.__suppressStroke) ctx.stroke();
      }
    }
  } finally {
    if (ctx.__spiroGLGeometryRecorder === true) {
      ctx.__spiroWholeTurnBatch = previousBatch;
      ctx.__spiroWholeTurnCommand = previousBatchCommand;
      ctx.__disableAdaptiveSpiral = previousAdaptiveSpiral;
    }
  }
}
function strokeConstructionPolyline(ctx, points, closed, layer, alpha = 1, markPoints = false) {
  if (!points || points.length < 2) return;
  ctx.save();
  ctx.globalAlpha = (ctx.globalAlpha ?? 1) * alpha * (Number(state.roundingGuideOpacity ?? 28) / 100);
  ctx.strokeStyle = state.roundingGuideColor || '#94a3b8';
  ctx.fillStyle = state.roundingGuideColor || '#94a3b8';
  ctx.lineWidth = Math.max(
    0.75,
    (Number(layer.strokeWidth) || 1.5) * getLayerStrokeWidthMultiplier(layer) * 0.8,
  );
  if (state.roundingGuidesDashed !== false) ctx.setLineDash([3, 3]);
  else ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  if (closed) ctx.closePath();
  ctx.stroke();
  ctx.setLineDash([]);
  if (markPoints) {
    const r = Math.max(
      1.5,
      Math.min(3, (Number(layer.strokeWidth) || 1.5) * getLayerStrokeWidthMultiplier(layer) * 0.9),
    );
    for (const p of points) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}
function buildSplineProfileControlGuides(layer) {
  if (layer.profileMode !== 'spline' || !Array.isArray(layer.profileNodes) || layer.profileNodes.length < 2)
    return [];
  const N = Math.max(2, Math.round(Number(layer.N) || 4));
  const K = Math.max(1, Math.min(Math.floor(N / 2), Math.round(Number(layer.K) || 1)));
  const R = getEffectiveLayerRadius(layer, 220);
  const rotRad = ((Number(layer.rotation) || 0) * Math.PI) / 180;
  const orbitCount = Math.max(1, gcd(N, K));
  let activeOrbitCount = orbitCount;
  if (layer.customSuborbits !== null && layer.customSuborbits !== undefined) {
    activeOrbitCount = Math.max(1, Math.min(Number(layer.customSuborbits) || 1, orbitCount));
  }
  const verticesPerOrbit = Math.max(2, N / orbitCount);
  const stepAngle = (2 * Math.PI) / N;
  const out = [];

  for (let sIdx = 0; sIdx < activeOrbitCount; sIdx++) {
    const g = Math.round((sIdx * orbitCount) / activeOrbitCount) % orbitCount;
    const P = [];
    for (let step = 0; step < verticesPerOrbit; step++) {
      const idx = (g + step * K) % N;
      const a = idx * stepAngle + rotRad - Math.PI / 2;
      P.push({ x: R * Math.cos(a), y: R * Math.sin(a) });
    }
    for (let i = 0; i < P.length; i++) {
      const p1 = P[i],
        p2 = P[(i + 1) % P.length];
      const dx = p2.x - p1.x,
        dy = p2.y - p1.y;
      const len = Math.hypot(dx, dy);
      if (len < 1e-9) continue;
      const ux = dx / len,
        uy = dy / len,
        nx = -uy,
        ny = ux;
      const controlPts = layer.profileNodes.map((node) => ({
        x: p1.x + (Number(node.x) || 0) * len * ux + (Number(node.y) || 0) * R * 0.5 * nx,
        y: p1.y + (Number(node.x) || 0) * len * uy + (Number(node.y) || 0) * R * 0.5 * ny,
      }));
      out.push(controlPts);
    }
  }
  return out;
}
function drawSplineProfileConstructionGuides(ctx, layer, alpha = 1) {
  for (const controlPts of buildSplineProfileControlGuides(layer)) {
    strokeConstructionPolyline(ctx, controlPts, false, layer, alpha, true);
  }
}

export {
  compactNativeWebGPUSpiralPoints,
  prepareSpiralStrokePoints,
  renderLayerOrbitPaths,
  strokeConstructionPolyline,
  strokeVariableWidthSpiralPath,
};
