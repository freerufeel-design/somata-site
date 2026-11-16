// Проблеск: подготовленный кадр.
import './lightning.js'; // initialisation order: this module runs after it
import { audioApplyNumeric } from '../audio/audio-routing.js';
import { currentSweepConfig, getLayerSweepConfig } from '../core/defaults-layers.js';
import { state } from '../core/state.js';
import { getLayerStrokeWidthMultiplier } from './motion.js';
import { getLayerFrameAuthoritativePaths } from '../geometry/frame-contour.js';
import {
  acquireEffectPiece,
  buildPathLengthTable,
  buildSinglePathLengthTable,
  effectXYAt,
  ensurePathLengthRanges,
  isCurrentFrameDynamicPathList,
  resetEffectPieceScratch,
  setSweepPreparedFrame,
  sweepGeometryScratch,
  sweepPreparedFrame,
} from '../geometry/frame-paths.js';
import { WebGPUCanonicalSweepRenderer } from '../gpu/canonical-sweep-renderer.js';
import {
  buildHighPrecisionGlintPaths,
  buildWrappedSweepPieces,
  effectiveGlintType,
  getSweepSegmentsForPath,
  isHighPrecisionGlint,
  sampleSweepRange,
} from './sweep-glint.js';
import { buildExactLightningPaths, normalizeLightningPrecisionValue } from './lightning-exact.js';
import { buildBezierGlintPrepared } from './glint-bezier.js';
import {
  getGlintVisualSettings,
  getLightningMotionPhase,
  getPreparedLightningFrame,
  getSweepMotionPhase,
  lightningActiveCycleFraction,
  prepareLightningVectorFrame,
} from './lightning.js';
import { prepareWebVisiblePaths } from './web.js';

function buildAcrossFigureSweepPieces(
  visible,
  phase,
  targetPieces = null,
  scratch = null,
  cfg = currentSweepConfig(),
  layerIndex = -1,
) {
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const path of visible || [])
    for (const p of path?.points || []) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
  const out = targetPieces || [];
  if (!Number.isFinite(minX) || maxX <= minX || !Number.isFinite(minY)) return out;
  const span = Math.max(1, maxX - minX),
    band = Math.max(
      8,
      span *
        Math.max(
          0.015,
          Math.min(1, audioApplyNumeric('sweep.length', Number(cfg.lengthPercent) || 3, layerIndex) / 100),
        ),
    ),
    half = band * 0.5;
  const travel = 1 - Math.abs(2 * phase - 1),
    cx = minX + (maxX - minX) * travel;
  for (const path of visible || []) {
    const pts = path?.points || [];
    if (pts.length < 2) continue;
    const segCount = path.closed ? pts.length : pts.length - 1;
    for (let si = 0; si < segCount; si++) {
      const a = pts[si],
        b = pts[(si + 1) % pts.length];
      if (!a || !b) continue;
      const dx = b.x - a.x;
      if (Math.abs(dx) < 1e-9) {
        if (Math.abs(a.x - cx) <= half) {
          const piece = scratch ? acquireEffectPiece(scratch) : [a, b];
          if (scratch) {
            piece[0] = a;
            piece[1] = b;
            piece.length = 2;
          }
          out.push(piece);
        }
        continue;
      }
      let u0 = (cx - half - a.x) / dx,
        u1 = (cx + half - a.x) / dx;
      if (u0 > u1) {
        const q = u0;
        u0 = u1;
        u1 = q;
      }
      u0 = Math.max(0, Math.min(1, u0));
      u1 = Math.max(0, Math.min(1, u1));
      if (u1 - u0 <= 1e-6) continue;
      const piece = scratch ? acquireEffectPiece(scratch) : [];
      const x0 = a.x + (b.x - a.x) * u0,
        y0 = a.y + (b.y - a.y) * u0,
        x1 = a.x + (b.x - a.x) * u1,
        y1 = a.y + (b.y - a.y) * u1;
      if (scratch) {
        effectXYAt(piece, 0, x0, y0);
        effectXYAt(piece, 1, x1, y1);
        piece.length = 2;
      } else piece.push({ x: x0, y: y0 }, { x: x1, y: y1 });
      out.push(piece);
    }
  }
  return out;
}
function getPreparedCanonicalSweepFrame(
  paths,
  layer,
  phase,
  now,
  cfg = currentSweepConfig(layer),
  layerIndex = -1,
) {
  const visible = paths?.__somataFrameContour === true ? paths : prepareWebVisiblePaths(paths, layer),
    table = buildPathLengthTable(visible);
  const lenFrac = Math.max(
    0.01,
    Math.min(1, audioApplyNumeric('sweep.length', Number(cfg?.lengthPercent) || 3, layerIndex) / 100),
  );
  return {
    now,
    paths,
    layer,
    visible,
    table,
    canonicalGPU: true,
    mode: cfg?.mode,
    phase,
    layerIndex,
    lenFrac,
  };
}
function getPreparedSweepFrame(paths, layer, phase, now, cfg = currentSweepConfig(layer), layerIndex = -1) {
  const signature = [
    effectiveGlintType(cfg),
    cfg.mode,
    cfg.lengthPercent,
    cfg.everyN,
    layer?.N,
    layer?.K,
    phase,
  ].join('|');
  const hit = sweepPreparedFrame;
  if (hit && hit.now === now && hit.paths === paths && hit.layer === layer && hit.signature === signature)
    return hit;
  const visible = paths?.__somataFrameContour === true ? paths : prepareWebVisiblePaths(paths, layer);
  const scratch = resetEffectPieceScratch(sweepGeometryScratch),
    pieces = scratch.pieces;
  const lenFrac = Math.max(
    0.01,
    Math.min(1, audioApplyNumeric('sweep.length', Number(cfg.lengthPercent) || 3, layerIndex) / 100),
  );
  if (visible?.length) {
    if (cfg.mode === 'across') {
      buildAcrossFigureSweepPieces(visible, phase, pieces, scratch, cfg, layerIndex);
    } else if (cfg.mode === 'perSegment' || cfg.mode === 'everyNth') {
      const nth = Math.max(2, Math.min(24, Math.round(Number(cfg.everyN) || 2))),
        localPhase = 1 - Math.abs(2 * phase - 1);
      let global = 0;
      for (const path of visible) {
        const { table, segments } = getSweepSegmentsForPath(path, layer);
        for (const seg of segments) {
          const use = cfg.mode === 'perSegment' || global % nth === 0;
          global++;
          if (!use) continue;
          const len = Math.max(1.5, Math.min(seg.length, seg.length * lenFrac)),
            center = localPhase * seg.length,
            a = Math.max(0, center - len * 0.5),
            b = Math.min(seg.length, center + len * 0.5);
          if (b - a <= 1e-5) continue;
          const pts = sampleSweepRange(table, seg.start + a, b - a, 96, scratch);
          if (pts?.length > 1) pieces.push(pts);
        }
      }
    } else if (cfg.mode === 'perPath') {
      const canonical = buildPathLengthTable(visible),
        staticPaths = !isCurrentFrameDynamicPathList(visible);
      for (const range of ensurePathLengthRanges(canonical).ranges) {
        const path = visible[range.pathIndex],
          table = buildSinglePathLengthTable(path, staticPaths);
        if (!(table.total > 0)) continue;
        const len = Math.max(2, table.total * lenFrac),
          startAt = phase * table.total - len * 0.5;
        buildWrappedSweepPieces(
          table,
          0,
          table.total,
          startAt,
          len,
          Math.max(12, Math.min(140, Math.ceil(len / 3))),
          pieces,
          scratch,
        );
      }
    } else {
      const canonical = buildPathLengthTable(visible),
        total = canonical.total,
        staticPaths = !isCurrentFrameDynamicPathList(visible);
      if (total > 0) {
        const len = Math.max(2, total * lenFrac),
          center = phase * total,
          startAt = center - len * 0.5;
        for (let wrap = -1; wrap <= 1; wrap++) {
          const a = startAt + wrap * total,
            b = a + len;
          for (const range of ensurePathLengthRanges(canonical).ranges) {
            const ia = Math.max(a, range.start),
              ib = Math.min(b, range.start + range.length);
            if (ib > ia) {
              const path = visible[range.pathIndex],
                table = buildSinglePathLengthTable(path, staticPaths);
              const pts = sampleSweepRange(table, ia - range.start, ib - ia, 160, scratch);
              if (pts?.length > 1) pieces.push(pts);
            }
          }
        }
      }
    }
  }
  const data = scratch.data;
  data.now = now;
  data.paths = paths;
  data.layer = layer;
  data.signature = signature;
  data.visible = visible;
  data.pieces = pieces;
  setSweepPreparedFrame(data);
  return data;
}
function prepareLayerFrameSweepData(frameCtx) {
  if (!frameCtx) return null;
  if (frameCtx.sweepPreparedReady) return frameCtx.sweepPrepared;
  const layer = frameCtx.layer,
    cfg = frameCtx.layerSweep || getLayerSweepConfig(layer),
    paths = getLayerFrameAuthoritativePaths(frameCtx),
    sharedContour = paths?.__somataFrameContour === true,
    now = frameCtx.now || performance.now();
  let data = frameCtx.sweepData;
  if (!data) data = frameCtx.sweepData = {};
  data.cfg = cfg;
  data.layerIndex = frameCtx.layerIndex;
  data.paths = paths;
  data.now = now;
  data.prepared = null;
  data.phase = 0;
  data.lightningPhase = 0;
  data.lightningVector = null;
  data.sweepW = 0;
  data.glintVisual = null;
  data.vectorPath = null;
  data.bezierGlintGPU = false;
  data.canonicalGPU = false;
  data.gpuMorphArc = false;
  if (cfg?.enabled === true && paths?.length) {
    const phase = getSweepMotionPhase(now, cfg);
    data.phase = phase;
    if (cfg.effectType === 'lightning') {
      // Simple Lightning intentionally follows the raw polyline carrier (no rounding).
      // Exact Lightning uses the same rounded/spline/Bézier geometry path as the line renderer.
      const exactLightning = normalizeLightningPrecisionValue(cfg.lightningPrecision) === 'exact';
      // Exactness controls Lightning sampling/rendering, not the base shape. When the
      // ordinary FrameContour exists, Lightning must never rebuild a second contour.
      const lightningPaths = sharedContour
        ? paths
        : exactLightning
          ? buildExactLightningPaths(frameCtx)
          : paths;
      data.paths = lightningPaths;
      data.lightningPhase = getLightningMotionPhase(now, cfg, frameCtx.layerIndex);
      if (data.lightningPhase >= lightningActiveCycleFraction(cfg, frameCtx.layerIndex)) {
        data.lightningVector = { stage: 'idle', intensity: 0, microPulses: [] };
      } else {
        data.prepared = getPreparedLightningFrame(lightningPaths, layer, now, cfg, frameCtx.layerIndex);
        data.lightningVector = prepareLightningVectorFrame(
          layer,
          data.lightningPhase,
          data.prepared,
          frameCtx.layerIndex,
          cfg,
        );
      }
    } else {
      const glintType = effectiveGlintType(cfg);
      if (glintType === 'high' || glintType === 'chaotic' || glintType === 'spectral') {
        const exactPaths = sharedContour ? paths : buildExactLightningPaths(frameCtx),
          bezierPrepared = buildBezierGlintPrepared(
            frameCtx,
            exactPaths,
            cfg,
            phase,
            now,
            frameCtx.layerIndex,
          );
        if (bezierPrepared) {
          data.paths = exactPaths;
          data.prepared = bezierPrepared;
          data.bezierGlintGPU = true;
          data.canonicalGPU = false;
        }
      }
      if (!data.bezierGlintGPU) {
        const glintPaths = sharedContour
          ? paths
          : isHighPrecisionGlint(cfg)
            ? buildHighPrecisionGlintPaths(frameCtx)
            : paths;
        data.paths = glintPaths;
        const nativeCanonical = WebGPUCanonicalSweepRenderer.canUse(cfg, state.tunnel?.active === true);
        data.prepared = nativeCanonical
          ? getPreparedCanonicalSweepFrame(glintPaths, layer, phase, now, cfg, frameCtx.layerIndex)
          : getPreparedSweepFrame(glintPaths, layer, phase, now, cfg, frameCtx.layerIndex);
        data.canonicalGPU = nativeCanonical;
        if (typeof Path2D !== 'undefined' && data.prepared?.pieces?.length) {
          const vp = new Path2D();
          for (const pts of data.prepared.pieces) {
            if (!pts?.length) continue;
            vp.moveTo(pts[0].x, pts[0].y);
            for (let i = 1; i < pts.length; i++) vp.lineTo(pts[i].x, pts[i].y);
          }
          data.vectorPath = vp;
        }
      }
      const baseW = Math.max(
          0.5,
          Number(frameCtx.strokeWidth) ||
            Math.max(
              0.5,
              audioApplyNumeric('layer.strokeWidth', Number(layer?.strokeWidth) || 1.5, frameCtx.layerIndex) *
                getLayerStrokeWidthMultiplier(layer),
            ),
        ),
        raw = audioApplyNumeric('sweep.width', Number(cfg.widthPercent), frameCtx.layerIndex),
        widthPct = Number.isFinite(raw) ? Math.max(0, Math.min(200, raw)) : 100;
      data.sweepW = (baseW * widthPct) / 100;
      data.glintVisual = getGlintVisualSettings(cfg, frameCtx.layerIndex);
    }
  }
  frameCtx.sweepPrepared = data;
  frameCtx.sweepPreparedReady = true;
  return data;
}

export { getPreparedSweepFrame, prepareLayerFrameSweepData };
