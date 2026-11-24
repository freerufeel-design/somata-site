// Фурье-режим: ресемплинг источника, коэффициенты, окружность и волна.
import './artwork-extent.js'; // initialisation order: this module runs after it
import { somataFourierOwner, state } from '../core/state.js';
import { getLayerReferenceRadius } from './reference-circle.js';

const fourierWavePointCache = new WeakMap();
// Fixed arc-length grid and spectral scale: adding a redundant vertex must
// not change the filter or the number of output points during a morph.
const FOURIER_SOURCE_COUNT = 96;
const FOURIER_OUTPUT_COUNT = 288;
const FOURIER_REFERENCE_HARMONICS = 12;
// First ten percentage points connect the finite spectrum to the exact
// unsmoothed contour. The transition is spatial, never temporal.
const FOURIER_SHARP_BLEND_PERCENT = 10;

function fourierWidth(p, fallback = 1) {
  const w = Number(p?.widthScale);
  return Number.isFinite(w) ? w : fallback;
}
function fourierPointSnapshot(points) {
  const snapshot = new Float64Array(points.length * 3);
  for (let i = 0; i < points.length; i++) {
    snapshot[i * 3] = Number(points[i]?.x);
    snapshot[i * 3 + 1] = Number(points[i]?.y);
    snapshot[i * 3 + 2] = Number(points[i]?.widthScale);
  }
  return snapshot;
}
function fourierPointsMatch(points, snapshot) {
  if (points.length * 3 !== snapshot.length) return false;
  for (let i = 0; i < points.length; i++) {
    if (!Object.is(Number(points[i]?.x), snapshot[i * 3]) ||
        !Object.is(Number(points[i]?.y), snapshot[i * 3 + 1]) ||
        !Object.is(Number(points[i]?.widthScale), snapshot[i * 3 + 2])) return false;
  }
  return true;
}
function fourierSmoothstep(t) {
  t = Math.max(0, Math.min(1, t));
  return t * t * (3 - 2 * t);
}
function fourierHarmonicWeight(k, cutoff) {
  const order = Math.abs(k);
  if (order <= 1) return 1; // preserve DC and fundamental
  // Fractional harmonic admission (C1 at every integer cutoff).
  const admission = fourierSmoothstep(cutoff - order + 1);
  // Lanczos-style taper on higher harmonics, normalized so the
  // fundamental is not attenuated. Suppresses ringing at corners.
  const a = Math.PI * (order - 1) / cutoff;
  return admission * Math.max(0, Math.sin(a) / a);
}
function resampleFourierSource(points, count, closed) {
  const src = (points || []).filter((p) => p && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y)));
  if (!src.length) return [];
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
  if (total === 0) {
    const a = src[0], b = src[src.length - 1];
    const wa = fourierWidth(a), wb = closed ? wa : fourierWidth(b, wa);
    return Array.from({ length: count }, (_, i) => ({
      x: Number(a.x), y: Number(a.y), widthScale: wa + (wb - wa) * i / (count - 1),
    }));
  }
  const out = new Array(count);
  let seg = 0;
  for (let i = 0; i < count; i++) {
    const dist = closed ? (total * i) / count : (total * i) / Math.max(1, count - 1);
    while (seg < segCount - 1 && (cum[seg + 1] <= dist || segLens[seg] === 0)) seg++;
    const a = src[seg],
      b = src[(seg + 1) % src.length],
      len = segLens[seg];
    const u = len > 0 ? Math.max(0, Math.min(1, (dist - cum[seg]) / len)) : 0;
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
// the same sampling grid and harmonic count.
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
// Exact arc-length centroid of the source polyline, independent of the
// resampling grid and of redundant vertices. The enclosing radius is
// attained at a source vertex, not necessarily at a Fourier sample.
function fourierReferenceCircle(points, closed) {
  const src = points.filter(p => p && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y)));
  const first = src[0];
  const ox = Number(first.x), oy = Number(first.y);
  let total = 0, mx = 0, my = 0;
  const count = closed ? src.length : src.length - 1;
  for (let i = 0; i < count; i++) {
    const a = src[i], b = src[(i + 1) % src.length];
    const ax = Number(a.x) - ox, ay = Number(a.y) - oy;
    const bx = Number(b.x) - ox, by = Number(b.y) - oy;
    const len = Math.hypot(bx - ax, by - ay);
    total += len;
    mx += len * (ax + bx) / 2;
    my += len * (ay + by) / 2;
  }
  const cx = ox + (total > 0 ? mx / total : 0);
  const cy = oy + (total > 0 ? my / total : 0);
  let radius = 0;
  for (const p of src) radius = Math.max(radius, Math.hypot(Number(p.x) - cx, Number(p.y) - cy));
  return { cx, cy, radius, startAngle: Math.atan2(oy - cy, ox - cx) };
}
function buildFourierCirclePoints(reference, outCount, closed) {
  const { cx, cy, radius, startAngle } = reference;
  const out = new Array(outCount);
  const den = closed ? outCount : Math.max(1, outCount - 1);
  for (let i = 0; i < outCount; i++) {
    const u = i / den;
    const a = startAngle + Math.PI * 2 * u;
    out[i] = { x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a), widthScale: 1 };
  }
  return out;
}
// Preserve the source's enclosing circle after spectral reconstruction
// AND after the sharp blend. Apply to the coordinates, not stroke width.
// Open rails have endpoint constraints and must not be uniformly scaled.
function fitFourierClosedRadius(points, reference) {
  const { cx, cy, radius } = reference;
  let actual = 0;
  for (const p of points) actual = Math.max(actual, Math.hypot(p.x - cx, p.y - cy));
  // Do not amplify numerical noise if a pathological spectrum cancels.
  if (!(actual > radius * 1e-8) || !(radius > 0)) return;
  const scale = radius / actual;
  if (Math.abs(scale - 1) < 1e-14) return;
  for (const p of points) {
    p.x = cx + (p.x - cx) * scale;
    p.y = cy + (p.y - cy) * scale;
  }
}
// Merge the uniform reconstruction grid with the original knot positions.
// Merely mixing two uniform samples would cut across off-grid corners at 0%.
// At mix=1 the added knots lie on the wave chords, so exiting this band
// changes only tessellation, not the visible curve.
function blendFourierWithSharpSource(points, wave, closed, mix) {
  const src = points.filter(p => p && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y)));
  const count = closed ? src.length : src.length - 1;
  if (count < 1) return src;
  const cumulative = [0];
  for (let i = 0; i < count; i++) {
    const a = src[i], b = src[(i + 1) % src.length];
    cumulative.push(cumulative[i] + Math.hypot(b.x - a.x, b.y - a.y));
  }
  const total = cumulative.at(-1);
  if (!(total > 0)) return wave;
  const den = closed ? wave.length : wave.length - 1;
  const knots = cumulative.slice(0, closed ? -1 : undefined).map(d => d / total);
  for (let i = 0; i < wave.length; i++) knots.push(i / den);
  knots.sort((a,b) => a-b);
  const out = [];
  let seg = 0, previous = -1;
  for (const t of knots) {
    if (t === previous || (closed && t >= 1)) continue;
    previous = t;
    const d = t * total;
    while (seg < count - 1 && cumulative[seg + 1] <= d) seg++;
    const a = src[seg], b = src[(seg + 1) % src.length];
    const len = cumulative[seg + 1] - cumulative[seg];
    const u = len > 0 ? Math.max(0, Math.min(1, (d - cumulative[seg]) / len)) : 0;
    const x = Number(a.x) + (Number(b.x) - Number(a.x)) * u;
    const y = Number(a.y) + (Number(b.y) - Number(a.y)) * u;
    const w = fourierWidth(a) + (fourierWidth(b, fourierWidth(a)) - fourierWidth(a)) * u;
    const q = t * den, j = Math.min(wave.length - 1, Math.floor(q));
    const f = q - j, c = wave[j], e = wave[(j + 1) % wave.length];
    out.push({ x: x + (c.x + (e.x - c.x) * f - x) * mix,
      y: y + (c.y + (e.y - c.y) * f - y) * mix,
      widthScale: w + (c.widthScale + (e.widthScale - c.widthScale) * f - w) * mix });
  }
  return out;
}
function fourierRadiusForSource(points, closed) {
  const owner = somataFourierOwner();
  const taggedRadius = points._somataReferenceRadius;
  const referenceRadius = !closed ? null
    : Number.isFinite(taggedRadius) && taggedRadius >= 0 ? taggedRadius
    : owner && Number.isFinite(Number(owner.radius)) &&
      !(owner.spiralEnabled === true && Math.abs(Number(owner.spiralOrder) || 0) > 1e-8)
      ? getLayerReferenceRadius(owner) : null;
  return referenceRadius;
}
function prepareFourierSpectrum(points, closed, power, referenceRadius) {
  const base = resampleFourierSource(points, FOURIER_SOURCE_COUNT, Boolean(closed));
  if (!base.length) return null;
  let periodic = base;
  if (!closed) {
    periodic = base.slice();
    for (let i = base.length - 2; i >= 1; i--) periodic.push(base[i]);
  }
  const outCount = FOURIER_OUTPUT_COUNT;
  const local = fourierReferenceCircle(points, Boolean(closed));
  // A layer's true reference is origin-centered and supplied by the
  // skeleton. Standalone rails (no layer) and open spiral branches keep
  // their local spectral geometry. A collapsed rail must not erupt into
  // a full circle; smoothly suppress the reference only near degeneracy.
  const reference = referenceRadius === null ? local : (() => {
    const life = referenceRadius > 0 ? fourierSmoothstep(local.radius / (referenceRadius * 1e-4)) : 1;
    const cx = local.cx * (1 - life), cy = local.cy * (1 - life);
    return { cx, cy, radius: local.radius * (1 - life) + referenceRadius * life,
      startAngle: Math.atan2(base[0].y - cy, base[0].x - cx) };
  })();
  const circleBlend = fourierSmoothstep(power / 0.25);
  const maxH = Math.min(64, Math.floor((periodic.length - 1) / 2));
  const cutoff = Math.max(1, Math.min(maxH, 1 + (FOURIER_REFERENCE_HARMONICS - 1) * Math.pow(power, 1.18)));
  return { base, periodic, outCount, reference, circleBlend, cutoff, harmonics: Math.ceil(cutoff) };
}
// Only the uniform output grid is eligible for the first resident GPU route.
// The sharp blend adds authored knots and therefore stays on the exact CPU path.
function prepareGpuFourierRail(points, closed) {
  if (!state.fourierMode || !Array.isArray(points) || points.length < 2 || points._fourierPrepared) return null;
  if (!points.every(p => p && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y)))) return null;
  const power = getFourierStrengthPower();
  const rounding = 200 - power * 100;
  if (!Number.isFinite(power) || rounding < FOURIER_SHARP_BLEND_PERCENT) return null;
  const prep = prepareFourierSpectrum(points, closed, power, fourierRadiusForSource(points, closed));
  if (!prep || !Number.isFinite(prep.reference.radius) || prep.reference.radius <= 1e-7) return null;
  return { ...prep, power, closed: Boolean(closed) };
}
function buildFourierWavePoints(points, closed, extraKey = '') {
  if (!state.fourierMode || !Array.isArray(points) || points.length < 2) return points || [];
  if (points._fourierPrepared === true) return points;
  const power = getFourierStrengthPower();
  const rounding = 200 - power * 100;
  const referenceRadius = fourierRadiusForSource(points, closed);
  const key = `${closed ? 1 : 0}|${extraKey}|fs:${power}|ref:${referenceRadius}`;
  const cached = fourierWavePointCache.get(points);
  if (cached?.key === key && fourierPointsMatch(points, cached.snapshot)) return cached.points;

  if (rounding === 0) {
    // Exact authored polyline, including every off-grid vertex and width.
    // Never mark the shared source array itself as Fourier-prepared.
    const out = points.filter(p => p && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y)));
    Object.defineProperty(out, '_fourierPrepared', { value: true, configurable: true });
    fourierWavePointCache.set(points, { key, snapshot: fourierPointSnapshot(points), points: out });
    return out;
  }
  const prepared = prepareFourierSpectrum(points, closed, power, referenceRadius);
  if (!prepared) return [];
  const { base, periodic, outCount, reference, circleBlend, cutoff, harmonics } = prepared;
  const circle = circleBlend < 1 ? buildFourierCirclePoints(reference, outCount, Boolean(closed)) : null;
  let out;
  if (power === 0) {
    out = circle;
  } else {
    const coeff = buildFourierCoefficients(periodic, harmonics);
    for (const q of coeff) {
      const weight = fourierHarmonicWeight(q.k, cutoff);
      q.re *= weight;
      q.im *= weight;
    }
    out = new Array(outCount);
    const periodDen = closed ? outCount : (outCount - 1) * 2;
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
      const p = evalFourierCoefficients(coeff, i / periodDen, basis, i * basisWidth * 2);
      if (circle) {
        const c = circle[i];
        p.x = c.x + (p.x - c.x) * circleBlend;
        p.y = c.y + (p.y - c.y) * circleBlend;
      }
      out[i] = p;
    }
  }
  if (!closed && circleBlend > 0) {
    // Blend endpoint constraints in with the wave, rather than snapping
    // two individual samples. The correction is affine along the curve.
    const first = base[0], last = base[base.length - 1];
    const start = out[0], end = out[outCount - 1];
    const dx0 = (circle ? circle[0].x + (first.x - circle[0].x) * circleBlend : first.x) - start.x;
    const dy0 = (circle ? circle[0].y + (first.y - circle[0].y) * circleBlend : first.y) - start.y;
    const dx1 = (circle ? circle[outCount - 1].x + (last.x - circle[outCount - 1].x) * circleBlend : last.x) - end.x;
    const dy1 = (circle ? circle[outCount - 1].y + (last.y - circle[outCount - 1].y) * circleBlend : last.y) - end.y;
    for (let i = 0; i < outCount; i++) {
      const u = i / (outCount - 1);
      out[i].x += dx0 + (dx1 - dx0) * u;
      out[i].y += dy0 + (dy1 - dy0) * u;
    }
    if (circleBlend === 1) {
      out[0].x = Number(first.x); out[0].y = Number(first.y);
      out[outCount - 1].x = Number(last.x); out[outCount - 1].y = Number(last.y);
    }
  }
  // Preserve the width field (including zero) at every filter strength.
  for (let i = 0; i < outCount; i++) {
    const wu = closed ? i / outCount : i / (outCount - 1);
    const wf = wu * (base.length - (closed ? 0 : 1));
    const wi = Math.floor(wf) % base.length, wj = (wi + 1) % base.length;
    const wa = fourierWidth(base[wi]), wb = fourierWidth(base[wj], wa);
    out[i].widthScale = wa + (wb - wa) * (wf - Math.floor(wf));
  }
  if (rounding < FOURIER_SHARP_BLEND_PERCENT)
    out = blendFourierWithSharpSource(points, out, Boolean(closed), fourierSmoothstep(rounding / FOURIER_SHARP_BLEND_PERCENT));
  if (closed) {
    // At zero rounding the authored polyline is exact, even for a profile
    // outside its reference circle or a linear morph along a chord.
    // Fade the radius correction in over the same sharp transition band.
    let fitReference = reference;
    if (referenceRadius !== null && rounding < FOURIER_SHARP_BLEND_PERCENT) {
      const mix = fourierSmoothstep(rounding / FOURIER_SHARP_BLEND_PERCENT);
      let sourceOuter = 0;
      for (const p of points) sourceOuter = Math.max(sourceOuter, Math.hypot(p.x - reference.cx, p.y - reference.cy));
      fitReference = { ...reference, radius: sourceOuter + (reference.radius - sourceOuter) * mix };
    }
    fitFourierClosedRadius(out, fitReference);
  }
  Object.defineProperty(out, '_fourierPrepared', { value: true, configurable: true });
  fourierWavePointCache.set(points, { key, snapshot: fourierPointSnapshot(points), points: out });
  return out;
}
function drawFourierPath(ctx, points, closed) {
  if (ctx.__somataGpuFourierRecording === true) {
    const rail = prepareGpuFourierRail(points, closed);
    if (rail && ctx.__recordGpuFourierRail?.(rail)) return;
  }
  const wave = buildFourierWavePoints(points, Boolean(closed));
  if (wave.length < 2) return;
  ctx.moveTo(wave[0].x, wave[0].y);
  for (let i = 1; i < wave.length; i++) ctx.lineTo(wave[i].x, wave[i].y);
  if (closed) ctx.closePath();
}
function prepareFourierPathList(paths) {
  if (!state.fourierMode || !Array.isArray(paths) || !paths.length) return paths || [];
  if (paths._fourierPrepared === true || paths._greenRenderedRail === true) return paths;
  const out = new Array(paths.length);
  for (let i = 0; i < paths.length; i++) {
    const path = paths[i] || {};
    if (path._greenRenderedRail === true) { out[i] = path; continue; }
    out[i] = {
      ...path,
      points: buildFourierWavePoints(path.points || [], Boolean(path.closed), 'aux'),
      cornerFlags: [],
      _bezierSegments: null, // the filtered rail is authoritative, not the source cubics
    };
  }
  if (paths._frameGeometryId != null) out._frameGeometryId = paths._frameGeometryId;
  Object.defineProperty(out, '_fourierPrepared', { value: true, configurable: true });
  return out;
}

export { prepareGpuFourierRail, buildFourierWavePoints, prepareFourierPathList, drawFourierPath };
