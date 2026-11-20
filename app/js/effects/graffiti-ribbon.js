// Граффити: перо, лента переменной ширины, план вариаций; данные профиля кадра.
import '../lamps/lamp-visual.js'; // initialisation order: this module runs after it
import { ensureLayerEffectState, getLayerEffectOwner } from '../core/defaults-layers.js';
import { getLayerStrokeWidthMultiplier } from './motion.js';
import { SomataFrameContourService, getLayerFrameAuthoritativePaths } from '../geometry/frame-contour.js';
import {
  buildPathLengthTable,
  getLayerFramePathTable,
  getLayerFrameRoundedPaths,
  isCurrentFrameDynamicPathList,
  persistentGraffitiPlanCache,
  pointAtPathDistance,
} from '../geometry/frame-paths.js';
import { buildHighPrecisionGlintPaths, getSweepSegmentsForPath } from './sweep-glint.js';
import { normalizeLineProfileValue } from '../ui/effects-sidebar.js';

const graffitiNibPathCache = new WeakMap();
const graffitiVariableRibbonCache = new WeakMap();
const graffitiVariableRibbonCacheStats = { hits: 0, builds: 0 };
const graffitiVariableRibbonMeshCache = new WeakMap();
const graffitiVariableRibbonMeshCacheStats = { hits: 0, builds: 0, vertices: 0 };
function graffitiNibStretch(type, nibRatio = 3, nibShape = 'pointed') {
  const ratio = Math.max(0.01, Number(nibRatio) || 3);
  if (type === 'slash') {
    if (nibShape === 'round') return Math.max(1, ratio * 0.72);
    if (nibShape === 'blunt') return Math.max(1, ratio * 0.92);
    if (nibShape === 'pinched') return 1;
    return ratio;
  }
  return 1;
}
function graffitiNibWidthFactor(type, nibShape = 'pointed') {
  let factor = type === 'square' ? 1.04 : 1;
  if (nibShape === 'round') factor *= 1.06;
  else if (nibShape === 'blunt') factor *= 0.96;
  return factor;
}
function graffitiFocusDistance(t, focus) {
  const f = Math.max(0.001, Math.min(0.999, focus));
  return t <= f ? (f - t) / f : (t - f) / (1 - f);
}
function graffitiRotationProgress(t, focus) {
  const f = Math.max(0.001, Math.min(0.999, focus));
  return t <= f ? 0.5 * (t / f) : 0.5 + 0.5 * ((t - f) / (1 - f));
}
function resolveGraffitiVariationProgress(p, localT, meta) {
  let t = Math.max(0, Math.min(1, Number(localT) || 0));
  if (meta?.mode === 'global') {
    t = (Number(meta.start) || 0) + t * (Number(meta.span) || 0);
  } else if (meta?.mode === 'across') {
    const span = Math.max(1e-6, Number(meta.span) || 1);
    t = ((Number(p?.x) || 0) - (Number(meta.minX) || 0)) / span;
  }
  return Math.max(0, Math.min(1, t));
}
function graffitiSupportOffset(nx, ny, angle, stretch, halfWidth) {
  const nl = Math.hypot(nx, ny);
  if (nl < 1e-9) return { x: 0, y: 0 };
  nx /= nl;
  ny /= nl;
  const ca = Math.cos(angle),
    sa = Math.sin(angle),
    a = Math.max(0, halfWidth) * Math.max(1e-6, Number(stretch) || 1),
    b = Math.max(0, halfWidth);
  const ux = ca,
    uy = sa,
    vx = -sa,
    vy = ca,
    dotMajor = nx * ux + ny * uy,
    dotMinor = nx * vx + ny * vy,
    support = Math.hypot(a * dotMajor, b * dotMinor);
  if (support <= 1e-9) return { x: 0, y: 0 };
  const major = (a * a * dotMajor) / support,
    minor = (b * b * dotMinor) / support;
  return { x: ux * major + vx * minor, y: uy * major + vy * minor };
}
function graffitiPathStrokeGrowth(path) {
  const growth = path?.strokeGrowth;
  return Number.isFinite(growth) ? Math.max(0, Math.min(1, growth)) : 1;
}
function computeGraffitiVariableRibbonSides(
  path,
  width,
  type,
  baseAngle,
  nibRatio,
  nibShape,
  sizeStrength,
  sizeFocus,
  rotationTotal,
  rotationFocus,
  progressMeta = null,
  angleMode = 'absolute',
) {
  const pts = path?.points || [],
    n = pts.length;
  if (n < 2) return null;
  const closed = path?.closed === true,
    arc = new Float64Array(n),
    leftX = new Float64Array(n),
    leftY = new Float64Array(n),
    rightX = new Float64Array(n),
    rightY = new Float64Array(n);
  let openTotal = 0;
  for (let ai = 1; ai < n; ai++) {
    const ap = pts[ai - 1],
      bp = pts[ai];
    openTotal += Math.hypot((bp.x || 0) - (ap.x || 0), (bp.y || 0) - (ap.y || 0));
    arc[ai] = openTotal;
  }
  let arcTotal = openTotal;
  if (closed && n > 2) {
    const ap = pts[n - 1],
      bp = pts[0];
    arcTotal += Math.hypot((bp.x || 0) - (ap.x || 0), (bp.y || 0) - (ap.y || 0));
  }
  const invProgressTotal = openTotal > 1e-6 ? 1 / openTotal : 0,
    stretch = graffitiNibStretch(type, nibRatio, nibShape),
    targetHalf = Math.max(0.225, width * graffitiNibWidthFactor(type, nibShape) * 0.5),
    baseHalf = targetHalf * graffitiPathStrokeGrowth(path);
  for (let i = 0; i < n; i++) {
    const p = pts[i],
      prev = pts[closed ? (i + n - 1) % n : Math.max(0, i - 1)],
      next = pts[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
    let ix = (p.x || 0) - (prev.x || 0),
      iy = (p.y || 0) - (prev.y || 0),
      il = Math.hypot(ix, iy);
    if (il > 1e-6) {
      ix /= il;
      iy /= il;
    } else {
      ix = 0;
      iy = 0;
    }
    let ox = (next.x || 0) - (p.x || 0),
      oy = (next.y || 0) - (p.y || 0),
      ol = Math.hypot(ox, oy);
    if (ol > 1e-6) {
      ox /= ol;
      oy /= ol;
    } else {
      ox = 0;
      oy = 0;
    }
    let tx = ix + ox,
      ty = iy + oy,
      tl = Math.hypot(tx, ty);
    if (tl < 1e-6) {
      if (ol > 1e-6) {
        tx = ox;
        ty = oy;
      } else if (il > 1e-6) {
        tx = ix;
        ty = iy;
      } else {
        tx = 1;
        ty = 0;
      }
      tl = Math.hypot(tx, ty) || 1;
    }
    tx /= tl;
    ty /= tl;
    const nx = -ty,
      ny = tx,
      localT = invProgressTotal ? arc[i] * invProgressTotal : 0,
      t = resolveGraffitiVariationProgress(p, localT, progressMeta);
    const d = graffitiFocusDistance(t, sizeFocus),
      sizeFactor = Math.max(0, 1 - sizeStrength * (1 - Math.max(0, Math.min(1, d))));
    const tangentAngle = angleMode === 'relative' ? Math.atan2(ty, tx) : 0,
      angle = tangentAngle + baseAngle + rotationTotal * graffitiRotationProgress(t, rotationFocus),
      ca = Math.cos(angle),
      sa = Math.sin(angle),
      a = baseHalf * stretch * sizeFactor,
      b = baseHalf * sizeFactor;
    const supportOffset = graffitiSupportOffset(nx, ny, angle, stretch, baseHalf * sizeFactor);
    let sx = supportOffset.x,
      sy = supportOffset.y;
    if (nibShape === 'pinched') {
      const period = Math.max(targetHalf * 2.5, Math.max(2, Number(nibRatio) || 10) * targetHalf * 0.9),
        phase = (arc[i] / Math.max(1e-6, period)) * Math.PI * 2,
        waist = 0.24 + 0.76 * Math.abs(Math.cos(phase * 0.5));
      sx *= waist;
      sy *= waist;
    }
    leftX[i] = (p.x || 0) + sx;
    leftY[i] = (p.y || 0) + sy;
    rightX[i] = (p.x || 0) - sx;
    rightY[i] = (p.y || 0) - sy;
  }
  return { leftX, leftY, rightX, rightY, n, arcTotal };
}
function graffitiVariableRibbonKey(
  width,
  type,
  baseAngle,
  nibRatio,
  nibShape,
  sizeStrength,
  sizeFocus,
  rotationTotal,
  rotationFocus,
  progressMeta = null,
  angleMode = 'absolute',
) {
  const metaKey = progressMeta
    ? `${progressMeta.mode || ''}:${Number(progressMeta.start || 0).toFixed(5)}:${Number(progressMeta.span || 0).toFixed(5)}:${Number(progressMeta.minX || 0).toFixed(3)}`
    : '-';
  return [
    Number(width).toFixed(3),
    type,
    angleMode === 'relative' ? 'relative' : 'absolute',
    Number(baseAngle).toFixed(5),
    Number(nibRatio).toFixed(3),
    nibShape,
    Number(sizeStrength).toFixed(4),
    Number(sizeFocus).toFixed(4),
    Number(rotationTotal).toFixed(5),
    Number(rotationFocus).toFixed(4),
    metaKey,
  ].join('|');
}
function buildGraffitiPlainPointedRibbonMesh(path, width, type, baseAngle, nibRatio, nibShape = 'pointed') {
  if (nibShape !== 'pointed') return null;
  const pts = path?.points || [],
    n = pts.length;
  if (n < 2) return null;
  const closed = path?.closed === true,
    segCount = closed ? n : n - 1;
  if (segCount < 1) return null;
  const stretch = Math.max(1e-6, graffitiNibStretch(type, nibRatio, nibShape));
  const half =
      Math.max(0.225, width * graffitiNibWidthFactor(type, nibShape) * 0.5) * graffitiPathStrokeGrowth(path),
    ca = Math.cos(baseAngle),
    sa = Math.sin(baseAngle),
    miterLimit = 2.6;
  const dxNib = new Float64Array(segCount),
    dyNib = new Float64Array(segCount),
    offX = new Float64Array(segCount),
    offY = new Float64Array(segCount);
  const fromNibVec = (x, y) => ({ x: ca * stretch * x - sa * y, y: sa * stretch * x + ca * y });
  for (let i = 0; i < segCount; i++) {
    const a = pts[i],
      b = pts[(i + 1) % n],
      wx = (Number(b?.x) || 0) - (Number(a?.x) || 0),
      wy = (Number(b?.y) || 0) - (Number(a?.y) || 0);
    let nx = (ca * wx + sa * wy) / stretch,
      ny = -sa * wx + ca * wy,
      nl = Math.hypot(nx, ny);
    if (nl < 1e-9) {
      nx = 1;
      ny = 0;
      nl = 1;
    }
    nx /= nl;
    ny /= nl;
    dxNib[i] = nx;
    dyNib[i] = ny;
    const o = fromNibVec(-ny * half, nx * half);
    offX[i] = o.x;
    offY[i] = o.y;
  }
  const joinCount = closed ? n : Math.max(0, n - 2),
    F = 9,
    out = new Float32Array((segCount * 6 + joinCount * 12) * F);
  let k = 0;
  const put = (x, y, b0, b1, b2, m0, m1, m2, side) => {
    out[k++] = x;
    out[k++] = y;
    out[k++] = b0;
    out[k++] = b1;
    out[k++] = b2;
    out[k++] = m0;
    out[k++] = m1;
    out[k++] = m2;
    out[k++] = side;
  };
  for (let i = 0; i < segCount; i++) {
    const j = (i + 1) % n,
      p = pts[i],
      q = pts[j],
      ox = offX[i],
      oy = offY[i],
      startEdge = !closed && i === 0 ? 1 : 0,
      endEdge = !closed && i === segCount - 1 ? 1 : 0;
    const l0x = (Number(p?.x) || 0) + ox,
      l0y = (Number(p?.y) || 0) + oy,
      r0x = (Number(p?.x) || 0) - ox,
      r0y = (Number(p?.y) || 0) - oy,
      l1x = (Number(q?.x) || 0) + ox,
      l1y = (Number(q?.y) || 0) + oy,
      r1x = (Number(q?.x) || 0) - ox,
      r1y = (Number(q?.y) || 0) - oy;
    put(l0x, l0y, 1, 0, 0, 0, 1, startEdge, -1);
    put(r0x, r0y, 0, 1, 0, 0, 1, startEdge, 1);
    put(l1x, l1y, 0, 0, 1, 0, 1, startEdge, -1);
    put(l1x, l1y, 1, 0, 0, 1, endEdge, 0, -1);
    put(r0x, r0y, 0, 1, 0, 1, endEdge, 0, 1);
    put(r1x, r1y, 0, 0, 1, 1, endEdge, 0, 1);
  }
  const first = closed ? 0 : 1,
    last = closed ? n : n - 1;
  for (let i = first; i < last; i++) {
    const prevSeg = (i + segCount - 1) % segCount,
      nextSeg = i % segCount,
      p = pts[i],
      px = Number(p?.x) || 0,
      py = Number(p?.y) || 0;
    const d0x = dxNib[prevSeg],
      d0y = dyNib[prevSeg],
      d1x = dxNib[nextSeg],
      d1y = dyNib[nextSeg];
    for (const side of [1, -1]) {
      const inX = offX[prevSeg] * side,
        inY = offY[prevSeg] * side,
        outX = offX[nextSeg] * side,
        outY = offY[nextSeg] * side;
      const n0x = -d0y * side,
        n0y = d0x * side,
        n1x = -d1y * side,
        n1y = d1x * side,
        mx = n0x + n1x,
        my = n0y + n1y,
        ml = Math.hypot(mx, my);
      let useMiter = false,
        mwX = 0,
        mwY = 0;
      if (ml > 1e-7) {
        const mdx = mx / ml,
          mdy = my / ml,
          den = mdx * n1x + mdy * n1y;
        if (Math.abs(den) > 1e-7) {
          const mlen = half / den;
          if (Math.abs(mlen) / Math.max(1e-9, half) <= miterLimit) {
            const mw = fromNibVec(mdx * mlen, mdy * mlen);
            mwX = mw.x;
            mwY = mw.y;
            useMiter = true;
          }
        }
      }
      const renderSide = side > 0 ? -1 : 1;
      if (useMiter) {
        put(px, py, 1, 0, 0, 1, 0, 0, 0);
        put(px + inX, py + inY, 0, 1, 0, 1, 0, 0, renderSide);
        put(px + mwX, py + mwY, 0, 0, 1, 1, 0, 0, renderSide);
        put(px, py, 1, 0, 0, 1, 0, 0, 0);
        put(px + mwX, py + mwY, 0, 1, 0, 1, 0, 0, renderSide);
        put(px + outX, py + outY, 0, 0, 1, 1, 0, 0, renderSide);
      } else {
        put(px, py, 1, 0, 0, 1, 0, 0, 0);
        put(px + inX, py + inY, 0, 1, 0, 1, 0, 0, renderSide);
        put(px + outX, py + outY, 0, 0, 1, 1, 0, 0, renderSide);
      }
    }
  }
  return k === out.length ? out : out.subarray(0, k);
}
function buildGraffitiVariableRibbonMesh(
  path,
  width,
  type,
  baseAngle,
  nibRatio,
  nibShape,
  sizeStrength,
  sizeFocus,
  rotationTotal,
  rotationFocus,
  progressMeta = null,
  angleMode = 'absolute',
  caps = null,
) {
  if (
    nibShape === 'pointed' &&
    angleMode !== 'relative' &&
    Math.abs(Number(sizeStrength) || 0) <= 1e-9 &&
    Math.abs(Number(rotationTotal) || 0) <= 1e-9
  ) {
    const plain = buildGraffitiPlainPointedRibbonMesh(path, width, type, baseAngle, nibRatio, nibShape);
    if (plain) return plain;
  }
  const sides = computeGraffitiVariableRibbonSides(
    path,
    width,
    type,
    baseAngle,
    nibRatio,
    nibShape,
    sizeStrength,
    sizeFocus,
    rotationTotal,
    rotationFocus,
    progressMeta,
    angleMode,
  );
  if (!sides) return null;
  const { leftX, leftY, rightX, rightY, n } = sides;
  if (n < 2) return null;

  const pts = path?.points || [],
    closed = path?.closed === true,
    segCount = closed ? n : n - 1,
    F = 9;
  const joinCount = nibShape === 'pointed' ? (closed ? n : Math.max(0, n - 2)) : 0;
  const out = new Float32Array((segCount * 6 + joinCount * 6) * F);
  let k = 0;
  const put = (x, y, b0, b1, b2, m0, m1, m2, side) => {
    out[k++] = x;
    out[k++] = y;
    out[k++] = b0;
    out[k++] = b1;
    out[k++] = b2;
    out[k++] = m0;
    out[k++] = m1;
    out[k++] = m2;
    out[k++] = side;
  };
  for (let i = 0; i < segCount; i++) {
    // A cap edge is anti-aliased only where it is a real silhouette edge.
    // Where the next/previous ribbon continues through a bridge (see
    // graffitiRibbonItemsJoin) the two caps meet inside the stroke, and
    // fading both of them leaves a dark hairline along the corner.
    const j = (i + 1) % n,
      startEdge = !closed && i === 0 && caps?.start !== false ? 1 : 0,
      endEdge = !closed && i === segCount - 1 && caps?.end !== false ? 1 : 0;
    const l0x = leftX[i],
      l0y = leftY[i],
      r0x = rightX[i],
      r0y = rightY[i],
      l1x = leftX[j],
      l1y = leftY[j],
      r1x = rightX[j],
      r1y = rightY[j];
    put(l0x, l0y, 1, 0, 0, 0, 1, startEdge, -1);
    put(r0x, r0y, 0, 1, 0, 0, 1, startEdge, 1);
    put(l1x, l1y, 0, 0, 1, 0, 1, startEdge, -1);
    put(l1x, l1y, 1, 0, 0, 1, endEdge, 0, -1);
    put(r0x, r0y, 0, 1, 0, 1, endEdge, 0, 1);
    put(r1x, r1y, 0, 0, 1, 1, endEdge, 0, 1);
  }
  if (joinCount) {
    const arc = new Float64Array(n);
    let total = 0;
    for (let i = 1; i < n; i++) {
      const a = pts[i - 1],
        b = pts[i];
      total += Math.hypot((b.x || 0) - (a.x || 0), (b.y || 0) - (a.y || 0));
      arc[i] = total;
    }
    const inv = total > 1e-6 ? 1 / total : 0;
    const stretch = graffitiNibStretch(type, nibRatio, nibShape),
      baseHalf =
        Math.max(0.225, width * graffitiNibWidthFactor(type, nibShape) * 0.5) *
        graffitiPathStrokeGrowth(path);
    const first = closed ? 0 : 1,
      last = closed ? n : n - 1;
    for (let i = first; i < last; i++) {
      const p = pts[i],
        prev = pts[(i + n - 1) % n],
        next = pts[(i + 1) % n];
      let ix = (p.x || 0) - (prev.x || 0),
        iy = (p.y || 0) - (prev.y || 0),
        il = Math.hypot(ix, iy);
      let ox = (next.x || 0) - (p.x || 0),
        oy = (next.y || 0) - (p.y || 0),
        ol = Math.hypot(ox, oy);
      if (il < 1e-6 || ol < 1e-6) continue;
      ix /= il;
      iy /= il;
      ox /= ol;
      oy /= ol;
      let tx = ix + ox,
        ty = iy + oy,
        tl = Math.hypot(tx, ty);
      if (tl < 1e-6) {
        tx = ox;
        ty = oy;
        tl = 1;
      }
      tx /= tl;
      ty /= tl;
      const localT = inv ? arc[i] * inv : 0,
        t = resolveGraffitiVariationProgress(p, localT, progressMeta),
        d = graffitiFocusDistance(t, sizeFocus),
        sizeFactor = Math.max(0, 1 - sizeStrength * (1 - Math.max(0, Math.min(1, d))));
      const rotation = rotationTotal * graffitiRotationProgress(t, rotationFocus),
        inAngle = (angleMode === 'relative' ? Math.atan2(iy, ix) : 0) + baseAngle + rotation,
        outAngle = (angleMode === 'relative' ? Math.atan2(oy, ox) : 0) + baseAngle + rotation;
      let sIn = graffitiSupportOffset(-iy, ix, inAngle, stretch, baseHalf * sizeFactor),
        sOut = graffitiSupportOffset(-oy, ox, outAngle, stretch, baseHalf * sizeFactor);
      if (nibShape === 'pinched') {
        continue;
      }

      put(p.x || 0, p.y || 0, 1, 0, 0, 0, 0, 0, 0);
      put((p.x || 0) + sIn.x, (p.y || 0) + sIn.y, 0, 1, 0, 0, 0, 0, -1);
      put((p.x || 0) + sOut.x, (p.y || 0) + sOut.y, 0, 0, 1, 1, 0, 0, -1);

      put(p.x || 0, p.y || 0, 1, 0, 0, 0, 0, 0, 0);
      put((p.x || 0) - sOut.x, (p.y || 0) - sOut.y, 0, 1, 0, 0, 0, 0, 1);
      put((p.x || 0) - sIn.x, (p.y || 0) - sIn.y, 0, 0, 1, 1, 0, 0, 1);
    }
  }
  return k === out.length ? out : out.subarray(0, k);
}
// Two consecutive plan items continue one another when the end of the first
// coincides with the start of the second (same chain, same growth, pointed
// nib). Such a pair gets a bridge wedge, and its two cap edges must not be
// anti-aliased: they lie inside the stroke.
function graffitiRibbonJoin(prevItem, nextItem, nibShape) {
  if (
    nibShape !== 'pointed' ||
    prevItem?.chain == null ||
    prevItem.chain !== nextItem?.chain ||
    graffitiPathStrokeGrowth(prevItem.path) !== graffitiPathStrokeGrowth(nextItem.path)
  )
    return null;
  const aa = prevItem?.path?.points || [],
    bb = nextItem?.path?.points || [];
  if (aa.length < 2 || bb.length < 2) return null;
  const p = aa[aa.length - 1],
    q = bb[0];
  if (Math.hypot((p.x || 0) - (q.x || 0), (p.y || 0) - (q.y || 0)) > 0.05) return null;
  const pa = aa[aa.length - 2],
    qb = bb[1];
  let ix = (p.x || 0) - (pa.x || 0),
    iy = (p.y || 0) - (pa.y || 0),
    il = Math.hypot(ix, iy),
    ox = (qb.x || 0) - (q.x || 0),
    oy = (qb.y || 0) - (q.y || 0),
    ol = Math.hypot(ox, oy);
  if (il < 1e-6 || ol < 1e-6) return null;
  return { p, q, ix: ix / il, iy: iy / il, ox: ox / ol, oy: oy / ol };
}
// Which plan items continue one another. `bridges` lists the pairs that get a
// bridge wedge (including the wrap-around pair of a closed contour that was
// split into pieces); `capStart[i]` / `capEnd[i]` are false where item i
// continues into a neighbour, so that cap is not a silhouette edge.
function graffitiPlanJoins(plan, nibShape) {
  const n = Array.isArray(plan) ? plan.length : 0,
    capStart = new Array(n).fill(true),
    capEnd = new Array(n).fill(true),
    bridges = [];
  const live = (item) => item?.path && graffitiPathStrokeGrowth(item.path) !== 0;
  const joinable = (a, b) => live(a) && live(b) && b.bridgeFromPrevious !== false && a.bridgeToNext !== false;
  let prev = -1;
  for (let i = 0; i < n; i++) {
    if (!live(plan[i])) {
      prev = -1;
      continue;
    }
    if (prev >= 0 && joinable(plan[prev], plan[i]) && graffitiRibbonJoin(plan[prev], plan[i], nibShape)) {
      capEnd[prev] = false;
      capStart[i] = false;
      bridges.push({ prev: plan[prev], next: plan[i] });
    }
    prev = i;
  }
  for (let first = 0; first < n;) {
    let last = first;
    const chain = plan[first]?.chain;
    while (chain != null && last + 1 < n && plan[last + 1]?.chain === chain) last++;
    if (
      chain != null &&
      capStart[first] &&
      capEnd[last] &&
      joinable(plan[last], plan[first]) &&
      graffitiRibbonJoin(plan[last], plan[first], nibShape)
    ) {
      capEnd[last] = false;
      capStart[first] = false;
      bridges.push({ prev: plan[last], next: plan[first] });
    }
    first = last + 1;
  }
  return { capStart, capEnd, bridges };
}
function buildGraffitiVariableRibbonBridgeMesh(
  prevItem,
  nextItem,
  width,
  type,
  baseAngle,
  nibRatio,
  nibShape,
  sizeStrength,
  sizeFocus,
  rotationTotal,
  rotationFocus,
  angleMode = 'absolute',
) {
  const join = graffitiRibbonJoin(prevItem, nextItem, nibShape);
  if (!join) return null;
  const { p, q, ix, iy, ox, oy } = join;
  const stretch = graffitiNibStretch(type, nibRatio, nibShape),
    baseHalf =
      Math.max(0.225, width * graffitiNibWidthFactor(type, nibShape) * 0.5) *
      graffitiPathStrokeGrowth(prevItem.path);
  const endpointStyle = (point, localT, meta, tx, ty) => {
    const t = resolveGraffitiVariationProgress(point, localT, meta),
      d = graffitiFocusDistance(t, sizeFocus),
      sizeFactor = Math.max(0, 1 - sizeStrength * (1 - Math.max(0, Math.min(1, d)))),
      rotation = rotationTotal * graffitiRotationProgress(t, rotationFocus),
      angle = (angleMode === 'relative' ? Math.atan2(ty, tx) : 0) + baseAngle + rotation;
    return { angle, half: baseHalf * sizeFactor };
  };
  const aStyle = endpointStyle(p, 1, prevItem.meta, ix, iy),
    bStyle = endpointStyle(q, 0, nextItem.meta, ox, oy),
    sIn = graffitiSupportOffset(-iy, ix, aStyle.angle, stretch, aStyle.half),
    sOut = graffitiSupportOffset(-oy, ox, bStyle.angle, stretch, bStyle.half);
  const F = 9,
    out = new Float32Array(6 * F);
  let k = 0,
    px = Number(p.x) || 0,
    py = Number(p.y) || 0;
  const put = (x, y, b0, b1, b2, m0, m1, m2, side) => {
    out[k++] = x;
    out[k++] = y;
    out[k++] = b0;
    out[k++] = b1;
    out[k++] = b2;
    out[k++] = m0;
    out[k++] = m1;
    out[k++] = m2;
    out[k++] = side;
  };
  put(px, py, 1, 0, 0, 0, 0, 0, 0);
  put(px + sIn.x, py + sIn.y, 0, 1, 0, 0, 0, 0, -1);
  put(px + sOut.x, py + sOut.y, 0, 0, 1, 1, 0, 0, -1);
  put(px, py, 1, 0, 0, 0, 0, 0, 0);
  put(px - sOut.x, py - sOut.y, 0, 1, 0, 0, 0, 0, 1);
  put(px - sIn.x, py - sIn.y, 0, 0, 1, 1, 0, 0, 1);
  return out;
}
function getCachedGraffitiVariableRibbonMesh(
  path,
  width,
  type,
  baseAngle,
  nibRatio,
  nibShape,
  sizeStrength,
  sizeFocus,
  rotationTotal,
  rotationFocus,
  progressMeta = null,
  angleMode = 'absolute',
  caps = null,
) {
  if (!path || typeof path !== 'object')
    return buildGraffitiVariableRibbonMesh(
      path,
      width,
      type,
      baseAngle,
      nibRatio,
      nibShape,
      sizeStrength,
      sizeFocus,
      rotationTotal,
      rotationFocus,
      progressMeta,
      angleMode,
      caps,
    );
  let bucket = graffitiVariableRibbonMeshCache.get(path);
  if (!bucket) {
    bucket = new Map();
    graffitiVariableRibbonMeshCache.set(path, bucket);
  }
  const key =
    graffitiVariableRibbonKey(
      width,
      type,
      baseAngle,
      nibRatio,
      nibShape,
      sizeStrength,
      sizeFocus,
      rotationTotal,
      rotationFocus,
      progressMeta,
      angleMode,
    ) + `|${graffitiPathStrokeGrowth(path)}|${caps?.start === false ? 0 : 1}${caps?.end === false ? 0 : 1}`;
  if (bucket.has(key)) {
    graffitiVariableRibbonMeshCacheStats.hits++;
    return bucket.get(key);
  }
  const mesh = buildGraffitiVariableRibbonMesh(
    path,
    width,
    type,
    baseAngle,
    nibRatio,
    nibShape,
    sizeStrength,
    sizeFocus,
    rotationTotal,
    rotationFocus,
    progressMeta,
    angleMode,
    caps,
  );
  if (bucket.size > 4) bucket.clear();
  bucket.set(key, mesh);
  graffitiVariableRibbonMeshCacheStats.builds++;
  graffitiVariableRibbonMeshCacheStats.vertices += mesh ? mesh.length / 9 : 0;
  return mesh;
}
function sampleGraffitiRange(table, start, length, sourcePath = null) {
  if (!table || !(table.total > 0) || !(length > 1e-6)) return null;
  const count = Math.max(8, Math.min(220, Math.ceil(length / 3)));
  const pts = [];
  for (let i = 0; i <= count; i++) {
    const d = Math.max(0, Math.min(table.total - 1e-7, start + length * (i / count)));
    const p = pointAtPathDistance(table, d);
    if (!pts.length || Math.hypot(p.x - pts[pts.length - 1].x, p.y - pts[pts.length - 1].y) > 1e-6)
      pts.push(p);
  }
  return pts.length > 1
    ? { points: pts, closed: false, strokeGrowth: graffitiPathStrokeGrowth(sourcePath) }
    : null;
}
function getGraffitiVariationMode(layer) {
  const mode = layer?.graffitiVariationMode;
  return ['perSegment', 'everyNth', 'across', 'perPath', 'whole'].includes(mode) ? mode : 'perSegment';
}
function buildGraffitiVariationPlan(paths, layer) {
  const mode = getGraffitiVariationMode(layer),
    plan = [];
  if (mode === 'perSegment' || mode === 'everyNth') {
    const groupN = Math.max(1, Math.min(24, Math.round(Number(layer?.graffitiVariationEveryN) || 2)));
    let chain = 0;
    for (const path of paths || []) {
      const chainId = chain++;
      const { table, segments } = getSweepSegmentsForPath(path, layer);
      if (!segments.length) continue;
      if (mode === 'perSegment') {
        for (const seg of segments) {
          const piece = sampleGraffitiRange(table, seg.start, seg.length, path);
          if (piece) plan.push({ path: piece, vary: true, meta: null, chain: chainId });
        }
      } else {
        for (let i = 0; i < segments.length; i += groupN) {
          const count = Math.min(groupN, segments.length - i);
          const start = segments[i].start;
          const end = segments[i + count - 1].start + segments[i + count - 1].length;
          const piece = sampleGraffitiRange(table, start, end - start, path);

          if (piece) plan.push({ path: piece, vary: count === groupN, meta: null, chain: chainId });
        }
      }
    }
    return plan;
  }
  if (mode === 'across') {
    let minX = Infinity,
      maxX = -Infinity;
    for (const path of paths || [])
      for (const p of path?.points || []) {
        if (Number.isFinite(p?.x)) {
          minX = Math.min(minX, p.x);
          maxX = Math.max(maxX, p.x);
        }
      }
    const span = Math.max(1e-6, maxX - minX);
    for (const path of paths || []) {
      const table = buildPathLengthTable([path]);
      if (!(table.total > 0)) continue;
      const piece = sampleGraffitiRange(table, 0, table.total, path);
      if (piece) plan.push({ path: piece, vary: true, meta: { mode: 'across', minX, span } });
    }
    return plan;
  }
  if (mode === 'whole') {
    const infos = [];
    let total = 0;
    for (const path of paths || []) {
      const table = buildPathLengthTable([path]);
      if (table.total > 0) {
        infos.push({ table, path, start: total });
        total += table.total;
      }
    }
    if (!(total > 0)) return plan;
    for (const info of infos) {
      const piece = sampleGraffitiRange(info.table, 0, info.table.total, info.path);
      if (piece)
        plan.push({
          path: piece,
          vary: true,
          meta: { mode: 'global', start: info.start / total, span: info.table.total / total },
        });
    }
    return plan;
  }

  for (const path of paths || []) {
    const table = buildPathLengthTable([path]);
    if (!(table.total > 0)) continue;
    const piece = sampleGraffitiRange(table, 0, table.total, path);
    if (piece) plan.push({ path: piece, vary: true, meta: null });
  }
  return plan;
}
function getCachedGraffitiVariationPlan(paths, layer) {
  if (!Array.isArray(paths) || !paths.length) return [];
  if (isCurrentFrameDynamicPathList(paths)) return buildGraffitiVariationPlan(paths, layer);
  let variants = persistentGraffitiPlanCache.get(paths);
  if (!variants) {
    variants = new Map();
    persistentGraffitiPlanCache.set(paths, variants);
  }
  const mode = getGraffitiVariationMode(layer);
  const groupN = Math.max(1, Math.min(24, Math.round(Number(layer?.graffitiVariationEveryN) || 2)));
  const N = Math.max(2, Math.round(Number(layer?.N) || 2));
  const K = Math.max(1, Math.round(Number(layer?.K) || 1));
  const key = `${mode}|${groupN}|${N}|${K}`;
  let plan = variants.get(key);
  if (!plan) {
    plan = buildGraffitiVariationPlan(paths, layer);
    variants.set(key, plan);
  }
  return plan;
}
function prepareLayerFrameProfileData(frameCtx) {
  if (!frameCtx) return null;
  if (frameCtx.profilePreparedReady) return frameCtx.profilePrepared;
  const layer = frameCtx.layer,
    effectLayer = frameCtx.effectLayer || getLayerEffectOwner(layer) || layer,
    paths =
      (effectLayer?.lineProfileApplication === 'graffiti'
        ? SomataFrameContourService.graffitiPaths(frameCtx)
        : null) || getLayerFrameAuthoritativePaths(frameCtx),
    sharedContour = paths?.__somataFrameContour === true,
    rounded = sharedContour
      ? paths
      : layer?.profileMode === 'spline'
        ? buildHighPrecisionGlintPaths(frameCtx)
        : getLayerFrameRoundedPaths(frameCtx);
  let data = frameCtx.profileData;
  if (!data) data = frameCtx.profileData = {};
  const application = ['stroke', 'graffiti'].includes(effectLayer?.lineProfileApplication)
    ? effectLayer.lineProfileApplication
    : 'stroke';
  const lineType = normalizeLineProfileValue(
    effectLayer?.lineProfileStroke ??
      effectLayer?.lineProfile ??
      layer?.lineProfileStroke ??
      layer?.lineProfile,
    'round',
  );
  const graffitiType = normalizeLineProfileValue(effectLayer?.lineProfileGraffiti, 'slash');
  const type = application === 'graffiti' ? graffitiType : lineType;
  data.paths = paths;
  data.rounded = rounded;
  data.type = type;
  data.application = application;
  data.table = null;
  data.graffitiPlan = null;
  data.gpuRibbonEligible = false;
  const profileBaseW = Math.max(
    0.001,
    (Number(layer?.strokeWidth) || 1.5) * getLayerStrokeWidthMultiplier(layer),
  );
  data.w = application === 'stroke' && type !== 'round' ? profileBaseW * 4 : profileBaseW;
  data.spacing = 0;
  data.count = 0;
  data.variationOn = false;
  if (application === 'graffiti') {
    data.variationOn =
      (effectLayer?.graffitiSizeVariationEnabled === true &&
        Math.max(0, Number(effectLayer?.graffitiSizeVariation) || 0) > 0) ||
      (effectLayer?.graffitiRotationVariationEnabled === true &&
        Math.max(0, Number(effectLayer?.graffitiRotationVariation) || 0) *
          Math.max(
            0,
            Number.isFinite(Number(effectLayer?.graffitiRotationMultiplier))
              ? Number(effectLayer.graffitiRotationMultiplier)
              : 1,
          ) >
          0);
    if (data.variationOn) data.graffitiPlan = getCachedGraffitiVariationPlan(rounded, effectLayer);
    else {
      const pinched = effectLayer?.graffitiNibShape === 'pinched';
      const plan = data.plainGpuPlan || (data.plainGpuPlan = []),
        pool = data.plainGpuPlanPool || (data.plainGpuPlanPool = []);
      plan.length = 0;
      for (let i = 0; i < rounded.length; i++) {
        let path = rounded[i];
        if (pinched) {
          const table = buildPathLengthTable([path]);
          const sampled = table?.total > 0 ? sampleGraffitiRange(table, 0, table.total, path) : null;
          if (sampled) {
            sampled.closed = path?.closed === true;
            path = sampled;
          }
        }
        let item = pool[i];
        if (!item) item = pool[i] = { path: null, vary: true, meta: null };
        item.path = path;
        item.vary = true;
        item.meta = null;
        plan.push(item);
      }
      data.graffitiPlan = plan;
    }
    data.gpuRibbonEligible = Array.isArray(data.graffitiPlan) && data.graffitiPlan.length > 0;
  } else if (type !== 'round') {
    const table = getLayerFramePathTable(frameCtx, true);
    data.table = table;
    data.spacing = Math.max(2.4, data.w * (type === 'slash' ? 1.85 : 1.55));
    data.count = table?.total > 0 ? Math.min(1800, Math.floor(table.total / data.spacing)) : 0;
  }
  frameCtx.profilePrepared = data;
  frameCtx.profilePreparedReady = true;
  return data;
}
window.__spiroGraffitiRibbonCacheStats = () => ({
  ...graffitiVariableRibbonCacheStats,
  mesh: { ...graffitiVariableRibbonMeshCacheStats },
});

export {
  buildGraffitiVariableRibbonBridgeMesh,
  graffitiRibbonJoin,
  graffitiPlanJoins,
  getCachedGraffitiVariableRibbonMesh,
  getGraffitiVariationMode,
  graffitiNibStretch,
  graffitiNibWidthFactor,
  graffitiPathStrokeGrowth,
  graffitiVariableRibbonMeshCacheStats,
  prepareLayerFrameProfileData,
};
