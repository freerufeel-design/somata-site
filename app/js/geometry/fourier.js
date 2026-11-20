// Фурье-режим: ресемплинг источника, коэффициенты, окружность и волна.
import './artwork-extent.js'; // initialisation order: this module runs after it
import { state } from '../core/state.js';

const fourierWavePointCache = new WeakMap();
function fourierPointChecksum(points, closed, extraKey = '') {
  let sx = 0,
    sy = 0,
    sw = 0,
    six = 0,
    siy = 0;
  const n = points?.length || 0;
  for (let i = 0; i < n; i++) {
    const p = points[i] || {};
    const x = Number(p.x) || 0,
      y = Number(p.y) || 0,
      w = Number.isFinite(Number(p.widthScale)) ? Number(p.widthScale) : 1;
    sx += x;
    sy += y;
    sw += w;
    six += x * (i + 1);
    siy += y * (i + 1);
  }
  return `${closed ? 1 : 0}|${n}|${sx.toFixed(5)}|${sy.toFixed(5)}|${sw.toFixed(5)}|${six.toFixed(5)}|${siy.toFixed(5)}|${extraKey}`;
}
function resampleFourierSource(points, count, closed) {
  const src = (points || []).filter((p) => p && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y)));
  if (src.length < 2) return src.map((p) => ({ ...p }));
  count = Math.max(4, Math.round(Number(count) || 32));
  const segCount = closed ? src.length : src.length - 1;
  const segLens = new Array(segCount),
    cum = new Array(segCount + 1);
  cum[0] = 0;
  for (let i = 0; i < segCount; i++) {
    const a = src[i],
      b = src[(i + 1) % src.length];
    const len = Math.hypot((Number(b.x) || 0) - (Number(a.x) || 0), (Number(b.y) || 0) - (Number(a.y) || 0));
    segLens[i] = len;
    cum[i + 1] = cum[i] + len;
  }
  const total = cum[segCount];
  if (total <= 1e-9)
    return Array.from({ length: count }, (_, i) => ({
      ...src[Math.min(src.length - 1, Math.round((i * (src.length - 1)) / Math.max(1, count - 1)))],
    }));
  const out = new Array(count);
  let seg = 0;
  for (let i = 0; i < count; i++) {
    const dist = closed ? (total * i) / count : (total * i) / Math.max(1, count - 1);
    while (seg < segCount - 1 && cum[seg + 1] < dist) seg++;
    const a = src[seg],
      b = src[(seg + 1) % src.length],
      len = Math.max(1e-9, segLens[seg]);
    const u = Math.max(0, Math.min(1, (dist - cum[seg]) / len));
    const aw = Number.isFinite(Number(a.widthScale)) ? Number(a.widthScale) : 1;
    const bw = Number.isFinite(Number(b.widthScale)) ? Number(b.widthScale) : aw;
    out[i] = {
      x: (Number(a.x) || 0) + ((Number(b.x) || 0) - (Number(a.x) || 0)) * u,
      y: (Number(a.y) || 0) + ((Number(b.y) || 0) - (Number(a.y) || 0)) * u,
      widthScale: aw + (bw - aw) * u,
    };
  }
  if (!closed) {
    out[0] = {
      ...src[0],
      widthScale: Number.isFinite(Number(src[0].widthScale)) ? Number(src[0].widthScale) : 1,
    };
    out[out.length - 1] = {
      ...src[src.length - 1],
      widthScale: Number.isFinite(Number(src[src.length - 1].widthScale))
        ? Number(src[src.length - 1].widthScale)
        : 1,
    };
  }
  return out;
}
// Reuse the exact cos/sin bases for every frame, layer and branch with
// the same topology. The Fourier math and its output samples are unchanged.
const fourierTrigCache = new Map(),
  FOURIER_TRIG_TABLE_LIMIT = 16;
const fourierTrigStats = { hits: 0, builds: 0, evictions: 0 };
function getFourierTrigBasis(key, size, build) {
  const hit = fourierTrigCache.get(key);
  if (hit) {
    fourierTrigCache.delete(key);
    fourierTrigCache.set(key, hit);
    fourierTrigStats.hits++;
    return hit;
  }
  const basis = new Float64Array(size);
  for (let i = 0; i < size; i += 2) {
    const a = build(i >> 1);
    basis[i] = Math.cos(a);
    basis[i + 1] = Math.sin(a);
  }
  fourierTrigCache.set(key, basis);
  fourierTrigStats.builds++;
  while (fourierTrigCache.size > FOURIER_TRIG_TABLE_LIMIT) {
    fourierTrigCache.delete(fourierTrigCache.keys().next().value);
    fourierTrigStats.evictions++;
  }
  return basis;
}
function buildFourierCoefficients(samples, harmonics) {
  const n = samples.length,
    coeff = [],
    width = harmonics * 2 + 1;
  const basis = getFourierTrigBasis(`dft:${n}:${harmonics}`, n * width * 2, (i) => {
    const k = Math.floor(i / n) - harmonics,
      j = i % n;
    return (-2 * Math.PI * k * j) / n;
  });
  for (let k = -harmonics; k <= harmonics; k++) {
    let re = 0,
      im = 0;
    for (let j = 0; j < n; j++) {
      const x = Number(samples[j]?.x) || 0,
        y = Number(samples[j]?.y) || 0;
      const o = ((k + harmonics) * n + j) * 2,
        c = basis[o],
        sn = basis[o + 1];
      re += x * c - y * sn;
      im += x * sn + y * c;
    }
    coeff.push({ k, re: re / n, im: im / n });
  }
  return coeff;
}
function evalFourierCoefficients(coeff, t, basis = null, offset = 0) {
  let x = 0,
    y = 0;
  for (let i = 0; i < coeff.length; i++) {
    const q = coeff[i],
      a = 2 * Math.PI * q.k * t;
    const c = basis ? basis[offset + i * 2] : Math.cos(a),
      sn = basis ? basis[offset + i * 2 + 1] : Math.sin(a);
    x += q.re * c - q.im * sn;
    y += q.re * sn + q.im * c;
  }
  return { x, y };
}
function getFourierStrengthPower() {
  const pct = Math.max(0, Math.min(100, Number(state.fourierStrength ?? 50)));
  return pct / 50;
}
function buildFourierCirclePoints(base, outCount, closed) {
  if (!Array.isArray(base) || !base.length) return [];
  let cx = 0,
    cy = 0;
  for (const p of base) {
    cx += Number(p?.x) || 0;
    cy += Number(p?.y) || 0;
  }
  cx /= base.length;
  cy /= base.length;
  let radius = 0;
  for (const p of base)
    radius = Math.max(radius, Math.hypot((Number(p?.x) || 0) - cx, (Number(p?.y) || 0) - cy));
  if (radius < 1e-6) radius = 1;
  const first = base[0] || { x: cx, y: cy };
  const startAngle = Math.atan2((Number(first.y) || 0) - cy, (Number(first.x) || 0) - cx);
  const out = new Array(outCount);
  const den = closed ? outCount : Math.max(1, outCount - 1);
  for (let i = 0; i < outCount; i++) {
    const u = i / den;
    const a = startAngle + Math.PI * 2 * u;
    out[i] = { x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a), widthScale: 1 };
  }
  return out;
}
function buildFourierWavePoints(points, closed, extraKey = '') {
  if (!state.fourierMode || !Array.isArray(points) || points.length < 2) return points || [];
  if (points._fourierPrepared === true) return points;
  const power = getFourierStrengthPower();
  const strengthKey = `${Math.round((Number(state.fourierStrength) || 0) * 100) / 100}`;
  const checksum = fourierPointChecksum(points, closed, `${extraKey}|fs:${strengthKey}`);
  const cached = fourierWavePointCache.get(points);
  if (cached?.checksum === checksum) return cached.points;

  const originalCount = Math.max(2, points.length);
  const baseCount = Math.max(24, Math.min(96, Math.round(24 + Math.sqrt(originalCount) * 4)));
  const base = resampleFourierSource(points, baseCount, Boolean(closed));
  let periodic = base,
    halfCount = baseCount;
  if (!closed) {
    periodic = base.slice();
    for (let i = base.length - 2; i >= 1; i--) periodic.push({ ...base[i] });
  }
  const outCount = closed
    ? Math.max(72, Math.min(320, baseCount * 3))
    : Math.max(72, Math.min(300, halfCount * 3));
  const circle = buildFourierCirclePoints(base, outCount, Boolean(closed));
  let out;
  if (power <= 1e-9) {
    out = circle;
  } else {
    const maxH = Math.max(1, Math.floor((periodic.length - 1) / 2));
    const defaultH = Math.max(3, Math.min(maxH, 22, Math.round(3 + Math.sqrt(originalCount) * 2.15)));

    const scaled = 1 + (defaultH - 1) * Math.pow(power, 1.18);
    const harmonics = Math.max(1, Math.min(maxH, 64, Math.round(scaled)));
    const coeff = buildFourierCoefficients(periodic, harmonics);
    out = new Array(outCount);
    const periodDen = closed ? outCount : Math.max(1, (outCount - 1) * 2);
    const circleBlend = Math.max(0, Math.min(1, power / 0.25));
    const basisWidth = coeff.length;
    const basis = getFourierTrigBasis(
      `wave:${outCount}:${periodDen}:${harmonics}`,
      outCount * basisWidth * 2,
      (index) => {
        const sample = Math.floor(index / basisWidth),
          k = (index % basisWidth) - harmonics;
        return 2 * Math.PI * k * (sample / periodDen);
      },
    );
    for (let i = 0; i < outCount; i++) {
      const t = i / periodDen;
      const p = evalFourierCoefficients(coeff, t, basis, i * basisWidth * 2);
      if (circleBlend < 1) {
        const c = circle[i];
        p.x = c.x + (p.x - c.x) * circleBlend;
        p.y = c.y + (p.y - c.y) * circleBlend;
      }
      const wu = closed ? i / outCount : i / Math.max(1, outCount - 1);
      const wf = wu * (base.length - (closed ? 0 : 1));
      const wi = Math.floor(wf) % base.length,
        wj = (wi + 1) % base.length,
        frac = wf - Math.floor(wf);
      const wa = Number(base[wi]?.widthScale) || 1,
        wb = Number(base[wj]?.widthScale) || wa;
      p.widthScale = wa + (wb - wa) * frac;
      out[i] = p;
    }
  }
  if (!closed && power > 1e-9) {
    const first = points[0],
      last = points[points.length - 1];
    out[0] = {
      x: Number(first.x) || 0,
      y: Number(first.y) || 0,
      widthScale: Number.isFinite(Number(first.widthScale)) ? Number(first.widthScale) : 1,
    };
    out[out.length - 1] = {
      x: Number(last.x) || 0,
      y: Number(last.y) || 0,
      widthScale: Number.isFinite(Number(last.widthScale)) ? Number(last.widthScale) : 1,
    };
  }
  Object.defineProperty(out, '_fourierPrepared', { value: true, configurable: true });
  fourierWavePointCache.set(points, { checksum, points: out });
  return out;
}
function prepareFourierPathList(paths) {
  if (!state.fourierMode || !Array.isArray(paths) || !paths.length) return paths || [];
  const out = new Array(paths.length);
  for (let i = 0; i < paths.length; i++) {
    const path = paths[i] || {};
    out[i] = {
      ...path,
      points: buildFourierWavePoints(path.points || [], Boolean(path.closed), 'aux'),
      cornerFlags: [],
    };
  }
  Object.defineProperty(out, '_fourierPrepared', { value: true, configurable: true });
  return out;
}

export { buildFourierWavePoints, prepareFourierPathList };
