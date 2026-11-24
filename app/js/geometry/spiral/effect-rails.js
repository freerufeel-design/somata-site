// Спираль: точные рельсы для эффектов.
import './bezier-carrier.js'; // initialisation order: this module runs after it
import { getLayerVersions } from '../../core/layer-versions.js';
import { getRoundingStrength } from '../../core/palette.js';
import { state } from '../../core/state.js';
import { frameGeometryRuntime, isCurrentFrameDynamicPathList } from '../frame-paths.js';
import { normalizeSplineRenderMode } from '../profile-model.js';
import { buildSpiralBezierSegments, spiralProfileGeometrySignature } from './bezier-carrier.js';
import { prepareSpiralStrokePoints } from '../../render/spiral-stroke.js';
import { isSpiralLayer } from './order-params.js';

const exactSpiralEffectRailCache = new WeakMap();
function exactSpiralCubicPoint(q, t) {
  const u = 1 - t,
    uu = u * u,
    tt = t * t;
  return {
    x: uu * u * q.p0.x + 3 * uu * t * q.c1.x + 3 * u * tt * q.c2.x + tt * t * q.p3.x,
    y: uu * u * q.p0.y + 3 * uu * t * q.c1.y + 3 * u * tt * q.c2.y + tt * t * q.p3.y,
  };
}
function buildExactSpiralEffectPaths(paths, layer) {
  const source = Array.isArray(paths) ? paths : [];
  if (!source.length || !isSpiralLayer(layer)) return source;
  const dynamic = isCurrentFrameDynamicPathList(source);
  const roundBase = Math.max(0, Math.min(2, Number(getRoundingStrength?.(layer?.rounding)) || 0));
  const geometryVersion = Math.max(0, Number(getLayerVersions(layer)?.geometry) || 0);
  const profileSignature = spiralProfileGeometrySignature(layer);
  const key = `gv:${geometryVersion}|ps:${profileSignature}|${layer?.profileMode || 'segments'}|whole:${layer?.wholeCurveSpline === true ? 1 : 0}|${normalizeSplineRenderMode(layer?.splineRenderMode)}|${roundBase.toFixed(5)}|fourier:${state.fourierMode ? 1 : 0}:${Number(state.fourierStrength) || 0}`;
  if (!dynamic && source && typeof source === 'object') {
    const hit = exactSpiralEffectRailCache.get(source);
    if (hit?.key === key) return hit.paths;
  }
  const out = source.map((path) => {
    if (path?._exactSpiralEffectRail === true) return path;
    const pts = path?.points || [];
    if (pts.length < 2) return path;
    const round = path?.spiralProfileRoundingBaked === true ? 0 : roundBase;
    const smooth = layer?.profileMode === 'spline' && path?.spiralProfileSplineBaked !== true;
    if (state.fourierMode !== true) {
      const cubics =
        Array.isArray(path?._bezierSegments) && path._bezierSegments.length
          ? path._bezierSegments
          : buildSpiralBezierSegments(pts, round, path?.cornerFlags || [], smooth, false,
              layer?.roundingCornerType === 'simple' ? layer : null);
      if (cubics?.length) {
        const sampled = [];
        const sampledCorners = [];
        const steps = 6;
        const first = cubics[0];
        // Retain cubic identities only on the Web-specific rail.
        // Thread endpoints are later evaluated on these exact cubics
        // rather than between the six preview chords.
        sampled.push({
          ...first.p0,
          widthScale: Math.max(0.02, Number(first.widthScale0) || 1),
          __webExactCubicIndex: 0,
          __webExactCubicT: 0,
        });
        sampledCorners.push(false);
        // The visible Spiral/Web rail is sampled from the very same
        // retained cubics as Stroke. Keep authored corner IDs on the
        // corresponding cubic endpoints; 13.6 discarded every flag,
        // which made "На углах" fall back to arbitrary winding anchors.
        const authored = pts.map((p, i) =>
          Boolean(path?.cornerFlags?.[i] || p?.__profileCorner === true || p?.__profileKeyCorner === true),
        );
        let vertexCursor = 1;
        for (let qi = 0; qi < cubics.length; qi++) {
          const q = cubics[qi],
            w0 = Math.max(0.02, Number(q.widthScale0) || 1),
            w1 = Math.max(0.02, Number(q.widthScale1) || w0),
            lw0 = Math.log(w0),
            lw1 = Math.log(w1);
          for (let j = 1; j <= steps; j++) {
            const t = j / steps,
              p = exactSpiralCubicPoint(q, t);
            p.widthScale = Math.exp(lw0 + (lw1 - lw0) * t);
            p.__webExactCubicIndex = qi;
            p.__webExactCubicT = t;
            sampled.push(p);
            sampledCorners.push(false);
          }
          // Most retained carriers have one cubic per authored span.
          // For fillet carriers, only match an endpoint when it is
          // actually on that authored point (never project to a
          // different winding of the Spiral).
          let authoredHere = false;
          if (cubics.length === pts.length - 1) {
            authoredHere = authored[qi + 1] === true;
          } else {
            while (vertexCursor < pts.length) {
              const v = pts[vertexCursor],
                dx = (Number(v?.x) || 0) - q.p3.x,
                dy = (Number(v?.y) || 0) - q.p3.y;
              if (dx * dx + dy * dy < 1e-8) {
                authoredHere = authored[vertexCursor] === true;
                vertexCursor++;
                break;
              }
              // A fillet may pass a key without touching it: do
              // not invent a corner on the rounded visual rail.
              break;
            }
          }
          if (authoredHere) {
            sampledCorners[sampledCorners.length - 1] = true;
            sampled[sampled.length - 1].__profileCorner = true;
          }
        }
        return {
          ...path,
          points: sampled,
          cornerFlags: sampledCorners,
          _exactSpiralEffectRail: true,
          _spiralWebAuthoredCorners: true,
          _bezierSegments: cubics,
          _spiralGpuBezierRail: true,
        };
      }
    }

    const rendered = prepareSpiralStrokePoints(pts, round, path?.cornerFlags || [], smooth);
    return {
      ...path,
      points: Array.isArray(rendered) && rendered.length > 1 ? rendered : pts,
      cornerFlags: [],
      _exactSpiralEffectRail: true,
    };
  });
  out._exactSpiralEffectRail = true;
  if (dynamic) out._frameGeometryId = frameGeometryRuntime.frameId;
  if (!dynamic && source && typeof source === 'object')
    exactSpiralEffectRailCache.set(source, { key, paths: out });
  return out;
}

export { buildExactSpiralEffectPaths };
