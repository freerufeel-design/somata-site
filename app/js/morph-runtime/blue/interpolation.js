// Blue Morph: интерполяция параметров.
import '../../ui/controls/profile-and-layers.js'; // initialisation order: this module runs after it
import { getConfiguredSplinePointCount } from '../../geometry/profile-model.js';
import { state } from '../../core/state.js';
import { getCardinalSplinePoints, ramerDouglasPeucker } from '../../geometry/spline.js';
import { getTapMorphIntervalSec } from '../../audio/tap-tempo.js';
import {
  clamp01,
  easeSmooth,
  cubicBezierEase,
  androidBounce,
  fastOutSlowIn,
  MORPH_EASINGS,
} from '../easing.js';

// Shared by MorphInterpolation.sampleProfileForMorph and MorphPlayback.
// Keep one definition in their common lexical scope: previously a
// private Playback declaration threw on every Spline Morph frame.
const getMorphLongPeriodDetailScale = (cycleMs = null) => {
  const ms =
    Number(cycleMs) > 0
      ? Number(cycleMs)
      : Math.max(100, getTapMorphIntervalSec(state.morph.intervalSec, 'full') * 1000);
  const sec = ms / 1000;
  if (sec <= 5) return 1;

  return Math.max(1, Math.min(3.25, 1 + (sec - 5) * 0.11));
};
function createMorphInterpolationModule() {
  const MORPH_SAMPLE_COUNT = 81;

  const MORPH_PROFILE_MAX_POINTS = 256;
  const getMorphSplinePointCount = () => getConfiguredSplinePointCount();

  const cloneProfileNodes = (nodes) => {
    const src =
      Array.isArray(nodes) && nodes.length > 1
        ? nodes
        : [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
          ];
    return src.map((p) => ({ x: Number(p?.x) || 0, y: Number(p?.y) || 0 }));
  };

  const stripNearDuplicateProfilePoints = (points, epsilon = 1e-5) => {
    const out = [];
    for (const p of points || []) {
      const q = { x: Number(p?.x) || 0, y: Number(p?.y) || 0 };
      const prev = out[out.length - 1];
      if (!prev || Math.hypot(q.x - prev.x, q.y - prev.y) > epsilon) out.push(q);
    }
    if (out.length < 2)
      return [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ];
    return out;
  };

  const profileHasBacktrackingX = (nodes, epsilon = 0.018) => {
    const pts = Array.isArray(nodes) ? nodes : [];
    for (let i = 1; i < pts.length; i++) {
      const dx = (Number(pts[i]?.x) || 0) - (Number(pts[i - 1]?.x) || 0);
      if (dx < -Math.abs(epsilon)) return true;
    }
    return false;
  };

  const loopOrientationSign = (nodes) => {
    const pts = Array.isArray(nodes) ? nodes : [];
    let bestDx = 0;
    let sign = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1] || { x: 0, y: 0 };
      const b = pts[i] || { x: 0, y: 0 };
      const dx = (Number(b.x) || 0) - (Number(a.x) || 0);
      if (dx < bestDx) {
        bestDx = dx;
        const ay = Number(a.y) || 0;
        const by = Number(b.y) || 0;
        const v = Math.abs(ay) >= Math.abs(by) ? ay : by;
        sign = Math.abs(v) > 1e-5 ? Math.sign(v) : 0;
      }
    }
    return sign;
  };

  const polylineArcFractions = (points) => {
    const src = stripNearDuplicateProfilePoints(points);
    if (src.length < 2) return [0, 1];
    const cumulative = [0];
    let total = 0;
    for (let i = 0; i < src.length - 1; i++) {
      total += Math.hypot(src[i + 1].x - src[i].x, src[i + 1].y - src[i].y);
      cumulative.push(total);
    }
    if (total <= 1e-9) return src.map((_, i) => i / Math.max(1, src.length - 1));
    return cumulative.map((v) => v / total);
  };

  const sampleOpenPolylineAtFractions = (points, fractions) => {
    const src = stripNearDuplicateProfilePoints(points);
    if (src.length < 2) return src;
    const cumulative = [0];
    let total = 0;
    for (let i = 0; i < src.length - 1; i++) {
      total += Math.hypot(src[i + 1].x - src[i].x, src[i + 1].y - src[i].y);
      cumulative.push(total);
    }
    if (total <= 1e-9)
      return fractions.map((_, i) => ({
        ...src[
          Math.min(src.length - 1, Math.round((i * (src.length - 1)) / Math.max(1, fractions.length - 1)))
        ],
      }));
    const out = [];
    let seg = 0;
    for (const rawF of fractions) {
      const d = Math.max(0, Math.min(1, Number(rawF) || 0)) * total;
      while (seg < cumulative.length - 2 && d > cumulative[seg + 1]) seg++;
      const span = Math.max(1e-9, cumulative[seg + 1] - cumulative[seg]);
      const u = Math.max(0, Math.min(1, (d - cumulative[seg]) / span));
      const a = src[seg],
        b = src[seg + 1];
      out.push({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u });
    }
    if (out.length) {
      out[0] = { ...src[0] };
      out[out.length - 1] = { ...src[src.length - 1] };
    }
    return out;
  };

  const resampleOpenPolylineExact = (points, sampleCount) => {
    const src = stripNearDuplicateProfilePoints(points);
    const count = Math.max(2, Math.round(sampleCount) || 2);
    if (src.length === count) return src.map((p) => ({ ...p }));
    const cumulative = [0];
    let total = 0;
    for (let i = 0; i < src.length - 1; i++) {
      total += Math.hypot(src[i + 1].x - src[i].x, src[i + 1].y - src[i].y);
      cumulative.push(total);
    }
    if (total <= 1e-9)
      return Array.from({ length: count }, (_, i) => ({
        ...src[Math.min(src.length - 1, Math.round((i * (src.length - 1)) / (count - 1)))],
      }));
    const out = [];
    for (let s = 0; s < count; s++) {
      const d = (s / (count - 1)) * total;
      let seg = Math.max(0, src.length - 2);
      for (let i = 0; i < cumulative.length - 1; i++) {
        if (d <= cumulative[i + 1] + 1e-12) {
          seg = i;
          break;
        }
      }
      const span = Math.max(1e-9, cumulative[seg + 1] - cumulative[seg]);
      const u = Math.max(0, Math.min(1, (d - cumulative[seg]) / span));
      const a = src[seg],
        b = src[seg + 1];
      out.push({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u });
    }
    out[0] = { ...src[0] };
    out[out.length - 1] = { ...src[src.length - 1] };
    return out;
  };

  const densifyProfilePreservingCorners = (points, targetCount) => {
    const out = stripNearDuplicateProfilePoints(points);
    const target = Math.max(2, Math.min(MORPH_PROFILE_MAX_POINTS, Math.round(targetCount) || 2));
    while (out.length < target) {
      let best = 0,
        bestLen = -1;
      for (let i = 0; i < out.length - 1; i++) {
        const len = Math.hypot(out[i + 1].x - out[i].x, out[i + 1].y - out[i].y);
        if (len > bestLen) {
          bestLen = len;
          best = i;
        }
      }
      if (bestLen <= 1e-9) break;
      const a = out[best],
        b = out[best + 1];
      out.splice(best + 1, 0, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    }
    return out;
  };

  const compactMorphProfileNodes = (nodes, mode = 'segments', alreadySampledSpline = false) => {
    const raw = cloneProfileNodes(nodes);
    const loopLike = mode === 'spline' && profileHasBacktrackingX(raw);

    if (mode === 'spline') {
      const desired = getMorphSplinePointCount();
      const previewSegments = Math.max(6, Math.ceil(desired / Math.max(2, raw.length - 1)));
      let curve = alreadySampledSpline
        ? stripNearDuplicateProfilePoints(raw)
        : stripNearDuplicateProfilePoints(getCardinalSplinePoints(raw, 0.5, previewSegments));

      if (alreadySampledSpline && curve.length === desired) return curve.map((p) => ({ ...p }));
      return resampleOpenPolylineExact(curve, desired);
    }

    let points = stripNearDuplicateProfilePoints(raw);
    if (points.length > MORPH_PROFILE_MAX_POINTS) {
      let epsilon = 0.0025;
      let simplified = points;
      for (let pass = 0; pass < 7 && simplified.length > MORPH_PROFILE_MAX_POINTS; pass++) {
        simplified = ramerDouglasPeucker(points, epsilon);
        epsilon *= 1.8;
      }
      points = simplified.length >= 2 ? simplified : points;
    }
    if (points.length > MORPH_PROFILE_MAX_POINTS) {
      points = resampleOpenPolylineExact(points, MORPH_PROFILE_MAX_POINTS);
    }
    return stripNearDuplicateProfilePoints(points);
  };

  const pairCompactMorphProfiles = (
    sourceNodes,
    sourceMode,
    targetNodes,
    targetMode,
    sourceAlreadySampled = false,
    targetAlreadySampled = false,
    preserveSourceGrid = false,
  ) => {
    const sourceLoop = sourceMode === 'spline' && profileHasBacktrackingX(cloneProfileNodes(sourceNodes));
    const targetLoop = targetMode === 'spline' && profileHasBacktrackingX(cloneProfileNodes(targetNodes));
    let a = compactMorphProfileNodes(sourceNodes, sourceMode, sourceAlreadySampled);
    let b = compactMorphProfileNodes(targetNodes, targetMode, targetAlreadySampled);

    if (preserveSourceGrid && a.length >= 2) {
      const count = Math.min(MORPH_PROFILE_MAX_POINTS, Math.max(2, a.length));
      if (targetLoop) {
        const fractions = polylineArcFractions(a);
        b = sampleOpenPolylineAtFractions(b, fractions);
      } else {
        b = densifyProfilePreservingCorners(b, count);
        if (b.length !== count) b = resampleOpenPolylineExact(b, count);
      }
      if (b.length !== count) b = resampleOpenPolylineExact(b, count);
      return { source: a.map((p) => ({ ...p })), target: b };
    }

    const splineGrid = sourceMode === 'spline' || targetMode === 'spline' ? getMorphSplinePointCount() : 2;
    const count = Math.min(MORPH_PROFILE_MAX_POINTS, Math.max(2, a.length, b.length, splineGrid));

    if (sourceLoop || targetLoop) {
      if (sourceLoop && targetLoop) {
        const fractions = Array.from({ length: count }, (_, i) => i / Math.max(1, count - 1));
        a = sampleOpenPolylineAtFractions(a, fractions);
        b = sampleOpenPolylineAtFractions(b, fractions);
      } else if (targetLoop) {
        a = densifyProfilePreservingCorners(a, count);
        if (a.length !== count) a = resampleOpenPolylineExact(a, count);
        b = sampleOpenPolylineAtFractions(b, polylineArcFractions(a));
      } else {
        b = densifyProfilePreservingCorners(b, count);
        if (b.length !== count) b = resampleOpenPolylineExact(b, count);
        a = sampleOpenPolylineAtFractions(a, polylineArcFractions(b));
      }
      return { source: a, target: b };
    }

    a = densifyProfilePreservingCorners(a, count);
    b = densifyProfilePreservingCorners(b, count);

    if (a.length !== count) a = resampleOpenPolylineExact(a, count);
    if (b.length !== count) b = resampleOpenPolylineExact(b, count);
    return { source: a, target: b };
  };

  const resolveMorphProfileMode = (sourceMode, targetMode, t = 0) => {
    const src = sourceMode || 'segments';
    const dst = targetMode || src;
    if (src === dst) return src;

    if (src === 'spline' || dst === 'spline') return Number(t) <= 1e-7 ? src : 'spline';
    return Number(t) < 0.5 ? src : dst;
  };

  const applyMorphEasing = (linearT) => {
    const fn = MORPH_EASINGS[state.morph.speedType] || MORPH_EASINGS.linear;
    return fn(clamp01(linearT));
  };
  // Finite Geometry > Animation edits reuse exactly the same
  // time curve, including its special Anticipate/Overshoot behavior.
  window.__somataMorphSpeedEase = applyMorphEasing;

  const sampleProfileForMorph = (nodes, count = null, mode = 'segments') => {
    const src =
      Array.isArray(nodes) && nodes.length > 1
        ? nodes.map((p) => ({ x: Number(p.x) || 0, y: Number(p.y) || 0 }))
        : [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
          ];
    const requestedCount =
      Number(count) > 0
        ? Number(count)
        : MORPH_SAMPLE_COUNT * Math.min(2.35, Math.sqrt(getMorphLongPeriodDetailScale()));
    const sampleCount = Math.max(24, Math.min(960, Math.round(requestedCount)));

    if (mode === 'spline') {
      const curve = getCardinalSplinePoints(
        src,
        0.5,
        Math.max(8, Math.ceil(sampleCount / Math.max(1, src.length - 1))),
      );
      if (curve.length >= 2) {
        const out = [];
        for (let i = 0; i < sampleCount; i++) {
          const u = i / (sampleCount - 1);
          const pos = u * (curve.length - 1);
          const j = Math.min(curve.length - 2, Math.max(0, Math.floor(pos)));
          const f = pos - j;
          out.push({
            x: curve[j].x + (curve[j + 1].x - curve[j].x) * f,
            y: curve[j].y + (curve[j + 1].y - curve[j].y) * f,
          });
        }
        out[0] = { x: src[0].x, y: src[0].y };
        out[out.length - 1] = { x: src[src.length - 1].x, y: src[src.length - 1].y };
        return out;
      }
    }

    const points = [...src].sort((a, b) => a.x - b.x);
    const out = [];
    const sampleStartX = Number(points[0].x) || 0;
    const sampleEndX = Number(points[points.length - 1].x);
    const safeEndX = Number.isFinite(sampleEndX) ? sampleEndX : 1;
    for (let i = 0; i < sampleCount; i++) {
      const uGrid = i / (sampleCount - 1);
      const x = sampleStartX + (safeEndX - sampleStartX) * uGrid;
      let right = points.findIndex((p) => p.x >= x);
      if (right <= 0) {
        out.push({ x, y: points[0].y });
        continue;
      }
      if (right === -1) {
        out.push({ x, y: points[points.length - 1].y });
        continue;
      }
      const a = points[right - 1];
      const b = points[right];
      const span = b.x - a.x;
      const u = span === 0 ? 0 : clamp01((x - a.x) / span);
      out.push({ x, y: a.y + (b.y - a.y) * u });
    }
    out[0] = { x: sampleStartX, y: points[0].y };
    out[out.length - 1] = { x: safeEndX, y: points[points.length - 1].y };
    return out;
  };

  const hexToRgb = (hex) => {
    const clean = String(hex || '#000000').replace('#', '');
    const full =
      clean.length === 3
        ? clean
            .split('')
            .map((ch) => ch + ch)
            .join('')
        : clean;
    const value = parseInt(full.slice(0, 6), 16);
    return {
      r: (value >> 16) & 255,
      g: (value >> 8) & 255,
      b: value & 255,
    };
  };

  const rgbToHsl = (r, g, b) => {
    r /= 255;
    g /= 255;
    b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h = 0;
    let s = 0;
    const l = (max + min) / 2;
    const d = max - min;

    if (d !== 0) {
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r:
          h = (g - b) / d + (g < b ? 6 : 0);
          break;
        case g:
          h = (b - r) / d + 2;
          break;
        default:
          h = (r - g) / d + 4;
          break;
      }
      h /= 6;
    }
    return { h, s, l };
  };

  const hslToHex = (h, s, l) => {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };

    if (s === 0) {
      const v = Math.round(l * 255)
        .toString(16)
        .padStart(2, '0');
      return `#${v}${v}${v}`;
    }

    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const r = hue2rgb(p, q, h + 1 / 3);
    const g = hue2rgb(p, q, h);
    const b = hue2rgb(p, q, h - 1 / 3);
    return (
      '#' +
      [r, g, b]
        .map((v) =>
          Math.round(v * 255)
            .toString(16)
            .padStart(2, '0'),
        )
        .join('')
    );
  };

  const lerpColorHsl = (fromHex, toHex, t) => {
    const a = rgbToHsl(...Object.values(hexToRgb(fromHex)));
    const b = rgbToHsl(...Object.values(hexToRgb(toHex)));

    let dh = b.h - a.h;
    if (dh > 0.5) dh -= 1;
    if (dh < -0.5) dh += 1;

    const h = (a.h + dh * t + 1) % 1;
    const s = a.s + (b.s - a.s) * t;
    const l = a.l + (b.l - a.l) * t;
    return hslToHex(h, s, l);
  };

  const lerpPreparedHsl = (a, b, t) => {
    if (!a || !b) return '#000000';
    let dh = b.h - a.h;
    if (dh > 0.5) dh -= 1;
    if (dh < -0.5) dh += 1;
    const h = (a.h + dh * t + 1) % 1;
    return hslToHex(h, a.s + (b.s - a.s) * t, a.l + (b.l - a.l) * t);
  };

  const lerpPreparedHslWithHueAmount = (a, b, t, hueAmountDeg = 0) => {
    if (!a || !b) return '#000000';
    const turns = (Number(hueAmountDeg) || 0) / 360;
    let baseDh = b.h - turns - a.h;
    while (baseDh > 0.5) baseDh -= 1;
    while (baseDh < -0.5) baseDh += 1;
    const h = (((a.h + (baseDh + turns) * t) % 1) + 1) % 1;
    return hslToHex(h, a.s + (b.s - a.s) * t, a.l + (b.l - a.l) * t);
  };

  return Object.freeze({
    MORPH_SAMPLE_COUNT,
    MORPH_PROFILE_MAX_POINTS,
    getMorphSplinePointCount,
    cloneProfileNodes,
    stripNearDuplicateProfilePoints,
    profileHasBacktrackingX,
    loopOrientationSign,
    polylineArcFractions,
    sampleOpenPolylineAtFractions,
    resampleOpenPolylineExact,
    densifyProfilePreservingCorners,
    compactMorphProfileNodes,
    pairCompactMorphProfiles,
    resolveMorphProfileMode,
    clamp01,
    easeSmooth,
    cubicBezierEase,
    androidBounce,
    fastOutSlowIn,
    MORPH_EASINGS,
    applyMorphEasing,
    sampleProfileForMorph,
    hexToRgb,
    rgbToHsl,
    hslToHex,
    lerpColorHsl,
    lerpPreparedHsl,
    lerpPreparedHslWithHueAmount,
  });
}

export { createMorphInterpolationModule, getMorphLongPeriodDetailScale };
