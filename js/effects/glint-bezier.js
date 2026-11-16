// Проблеск: подготовка по Безье.
import './lightning-exact.js'; // initialisation order: this module runs after it
import { audioApplyNumeric } from '../audio/audio-routing.js';
import { effectiveGlintType } from './sweep-glint.js';
import {
  appendExactRailRangeCubics,
  appendWrappedExactRailCubics,
  exactLightningParamAtDistance,
  exactLightningSliceSegment,
  glintSegmentToCubic,
} from './lightning-exact.js';

// Spectral sweep rotates a mask over an unchanged curve. Cache its Bézier controls
// and Path2D; only the angular uniforms change each frame. Dynamic source contours
// are explicitly excluded, so morphing geometry is never shown one frame late.
const spectralStaticContourCache = new WeakMap();
const spectralStaticLayerCache = new WeakMap();
function sameSpectralBytes(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
function buildBezierGlintPrepared(frameCtx, exactPaths, cfg, phase, now, layerIndex = -1) {
  const type = effectiveGlintType(cfg),
    spectral = type === 'spectral';
  const cacheable = spectral && Array.isArray(exactPaths) && exactPaths._frameGeometryId == null;
  if (cacheable) {
    const saved = spectralStaticContourCache.get(exactPaths);
    if (saved) {
      const sectorDeg = Math.max(
        1,
        Math.min(
          360,
          audioApplyNumeric(
            'sweep.spectralSector',
            Number.isFinite(Number(cfg?.spectralSectorDegrees)) ? Number(cfg.spectralSectorDegrees) : 45,
            layerIndex,
          ),
        ),
      );
      const speedDeg = Math.max(
        -720,
        Math.min(
          720,
          audioApplyNumeric(
            'sweep.spectralSpeed',
            Number.isFinite(Number(cfg?.spectralAngularSpeed)) ? Number(cfg.spectralAngularSpeed) : 90,
            layerIndex,
          ),
        ),
      );
      return {
        ...saved,
        spectralProgress: Math.max(0, Math.min(1, Number(phase) || 0)),
        spectralDirection: (cfg?.direction === 'backward' ? -1 : 1) * (speedDeg < 0 ? -1 : 1),
        sectorSpanAngle: (sectorDeg * Math.PI) / 180,
        sectorDegrees: sectorDeg,
        angularSpeed: speedDeg,
      };
    }
  }
  const cubics = [];
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity,
    allExact = true;
  const rails = [];
  for (const path of exactPaths || []) {
    for (const p of path?.points || []) {
      const x = Number(p?.x),
        y = Number(p?.y);
      if (Number.isFinite(x) && Number.isFinite(y)) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
    const rail = path?._exactLightningRail;
    if (rail?.total > 0) rails.push({ rail, path });
    else if ((path?.points?.length || 0) > 1) {
      allExact = false;
      if (spectral) {
        const pts = path.points,
          n = path.closed ? pts.length : pts.length - 1;
        for (let i = 0; i < n; i++) {
          const a = pts[i],
            b = pts[(i + 1) % pts.length],
            seg = { type: 'L', p0: a, p1: b, breakBefore: i === 0 };
          const c = glintSegmentToCubic(seg, i === 0);
          if (c) cubics.push(c);
        }
      }
    }
  }
  if (!spectral && !allExact) return null;
  if (!Number.isFinite(minX)) {
    minX = minY = -1;
    maxX = maxY = 1;
  }
  if (spectral) {
    for (const item of rails) {
      let first = true;
      for (const seg of item.rail.segments || []) {
        const c = glintSegmentToCubic(seg, first || seg.breakBefore === true);
        if (c) {
          cubics.push(c);
          first = false;
        }
      }
    }
  } else {
    const mode = ['perSegment', 'everyNth', 'across', 'perPath', 'whole'].includes(cfg?.mode)
      ? cfg.mode
      : 'whole';
    if (mode === 'across') return null;
    const lenFrac = Math.max(
      0.01,
      Math.min(1, audioApplyNumeric('sweep.length', Number(cfg?.lengthPercent) || 3, layerIndex) / 100),
    );
    if (mode === 'perSegment' || mode === 'everyNth') {
      const nth = Math.max(2, Math.min(24, Math.round(Number(cfg?.everyN) || 2))),
        localPhase = 1 - Math.abs(2 * phase - 1);
      let global = 0;
      for (const item of rails) {
        for (const seg of item.rail.segments || []) {
          const use = mode === 'perSegment' || global % nth === 0;
          global++;
          if (!use || !(seg._length > 0)) continue;
          const len = Math.max(1e-6, seg._length * lenFrac),
            center = localPhase * seg._length,
            a = Math.max(0, center - len * 0.5),
            b = Math.min(seg._length, center + len * 0.5);
          if (b <= a + 1e-8) continue;
          const t0 = exactLightningParamAtDistance(seg, a),
            t1 = exactLightningParamAtDistance(seg, b),
            cut = exactLightningSliceSegment(seg, t0, t1),
            c = glintSegmentToCubic(cut, true);
          if (c) cubics.push(c);
        }
      }
    } else if (mode === 'perPath') {
      for (const item of rails) {
        const total = item.rail.total,
          len = Math.min(total, Math.max(2, total * lenFrac)),
          start = phase * total - len * 0.5;
        appendWrappedExactRailCubics(item.rail, start, len, cubics);
      }
    } else {
      let total = 0;
      const ranges = [];
      for (const item of rails) {
        ranges.push({ rail: item.rail, start: total, length: item.rail.total });
        total += item.rail.total;
      }
      if (total > 0) {
        const len = Math.min(total, Math.max(2, total * lenFrac)),
          startAt = phase * total - len * 0.5;
        for (let wrap = -1; wrap <= 1; wrap++) {
          const a = startAt + wrap * total,
            b = a + len;
          for (const r of ranges) {
            const ia = Math.max(a, r.start),
              ib = Math.min(b, r.start + r.length);
            if (ib > ia) appendExactRailRangeCubics(r.rail, ia - r.start, ib - ia, cubics);
          }
        }
      }
    }
  }
  if (!cubics.length) return null;
  const data = new Float32Array(cubics.length * 8),
    cubicBreaks = new Uint8Array(cubics.length);
  let o = 0,
    ci = 0;
  const path2d = typeof Path2D !== 'undefined' ? new Path2D() : null;
  let prev = null;
  for (const c of cubics) {
    cubicBreaks[ci++] = c.breakBefore === true ? 1 : 0;
    data[o++] = c.p0.x;
    data[o++] = c.p0.y;
    data[o++] = c.c1.x;
    data[o++] = c.c1.y;
    data[o++] = c.c2.x;
    data[o++] = c.c2.y;
    data[o++] = c.p3.x;
    data[o++] = c.p3.y;
    if (path2d) {
      if (c.breakBefore || !prev || Math.hypot(c.p0.x - prev.x, c.p0.y - prev.y) > 1e-7)
        path2d.moveTo(c.p0.x, c.p0.y);
      path2d.bezierCurveTo(c.c1.x, c.c1.y, c.c2.x, c.c2.y, c.p3.x, c.p3.y);
    }
    prev = c.p3;
  }
  const spectralAudioPrefix = 'sweep',
    sectorDeg = Math.max(
      1,
      Math.min(
        360,
        audioApplyNumeric(
          `${spectralAudioPrefix}.spectralSector`,
          Number.isFinite(Number(cfg?.spectralSectorDegrees)) ? Number(cfg.spectralSectorDegrees) : 45,
          layerIndex,
        ),
      ),
    ),
    speedDeg = Math.max(
      -720,
      Math.min(
        720,
        audioApplyNumeric(
          `${spectralAudioPrefix}.spectralSpeed`,
          Number.isFinite(Number(cfg?.spectralAngularSpeed)) ? Number(cfg.spectralAngularSpeed) : 90,
          layerIndex,
        ),
      ),
    );
  const cx = (minX + maxX) * 0.5,
    cy = (minY + maxY) * 0.5,
    progress = Math.max(0, Math.min(1, Number(phase) || 0)),
    baseDir = cfg?.direction === 'backward' ? -1 : 1,
    speedDir = speedDeg < 0 ? -1 : 1,
    direction = baseDir * speedDir,
    first = cubics[0]?.p0,
    startAngle = first ? Math.atan2(first.y - cy, first.x - cx) : 0;

  const prepared = {
    bezierGlint: true,
    glintType: type,
    spectral,
    spectralCycleLocked: spectral === true,
    spectralProgress: progress,
    spectralDirection: direction,
    spectralStartAngle: startAngle,
    cubicData: data,
    cubicBreaks,
    cubicCount: cubics.length,
    path2d,
    centerX: cx,
    centerY: cy,
    sectorSpanAngle: (sectorDeg * Math.PI) / 180,
    sectorDegrees: sectorDeg,
    angularSpeed: speedDeg,
    maskRadius: Math.max(10000, Math.hypot(maxX - minX, maxY - minY) * 8 + 1000),
    spectralResident: cacheable,
  };
  if (cacheable) {
    const layer = frameCtx?.layer,
      old = layer ? spectralStaticLayerCache.get(layer) : null;
    if (
      old &&
      old.centerX === cx &&
      old.centerY === cy &&
      old.spectralStartAngle === startAngle &&
      sameSpectralBytes(old.cubicData, data) &&
      sameSpectralBytes(old.cubicBreaks, cubicBreaks)
    ) {
      // Reuse the SAME Float32Array identity to hit the resident WebGPU
      // storage-buffer cache. Rebuilding/uploading every frame was a
      // major source of stutter on complex static profiles.
      const reused = {
        ...old,
        spectralProgress: progress,
        spectralDirection: direction,
        sectorSpanAngle: (sectorDeg * Math.PI) / 180,
        sectorDegrees: sectorDeg,
        angularSpeed: speedDeg,
      };
      spectralStaticContourCache.set(exactPaths, reused);
      return reused;
    }
    if (layer) spectralStaticLayerCache.set(layer, prepared);
    spectralStaticContourCache.set(exactPaths, prepared);
  }
  return prepared;
}

export { buildBezierGlintPrepared };
