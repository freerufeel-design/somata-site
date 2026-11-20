// Профиль линии: координаты редактора, точки сплайна профиля, признаки плоского и «сломанного» профиля.
import './spline-corner-mode.js'; // initialisation order: this module runs after it
import { isPreSampledSplineLayer } from '../core/render-runtime.js';
import { state } from '../core/state.js';
import { getCardinalSplinePoints } from './spline.js';

const PROFILE_CONFIG = {
  xMin: -0.2,
  xMax: 1.2,
  yMin: -1.0,
  yMax: 1.0,
  snapThresholdPx: 12,
};
const DEFAULT_PROFILE_CONFIG = { ...PROFILE_CONFIG };
function profileToCanvasCoords(p, width, height) {
  const padding = 20;
  const effW = width - padding * 2;
  const effH = height - padding * 2;
  const cx = padding + ((p.x - PROFILE_CONFIG.xMin) / (PROFILE_CONFIG.xMax - PROFILE_CONFIG.xMin)) * effW;
  const cy = padding + ((p.y - PROFILE_CONFIG.yMin) / (PROFILE_CONFIG.yMax - PROFILE_CONFIG.yMin)) * effH;
  return { x: cx, y: cy };
}
function canvasToProfileCoords(cp, width, height) {
  const padding = 20;
  const effW = width - padding * 2;
  const effH = height - padding * 2;
  const px = PROFILE_CONFIG.xMin + ((cp.x - padding) / effW) * (PROFILE_CONFIG.xMax - PROFILE_CONFIG.xMin);
  const py = PROFILE_CONFIG.yMin + ((cp.y - padding) / effH) * (PROFILE_CONFIG.yMax - PROFILE_CONFIG.yMin);
  return { x: px, y: py };
}
function normalizeSplinePointCount(value) {
  const n = Math.round(Number(value) || 12);
  return Math.max(4, Math.min(256, n));
}
function getConfiguredSplinePointCount() {
  return normalizeSplinePointCount(state.morph?.splinePoints);
}
function normalizeSplineRenderMode(value) {
  return value === 'discrete' ? 'discrete' : 'smooth';
}
function isFlatProfileNodes(nodes) {
  const pts = Array.isArray(nodes) ? nodes : [];
  if (pts.length < 2) return false;
  const a = pts[0],
    b = pts[pts.length - 1];
  if (Math.abs(Number(a?.x) || 0) > 0.001 || Math.abs(Number(a?.y) || 0) > 0.001) return false;
  if (Math.abs((Number(b?.x) || 0) - 1) > 0.001 || Math.abs(Number(b?.y) || 0) > 0.001) return false;
  return pts.every((p) => Math.abs(Number(p?.y) || 0) <= 0.001);
}
function isFlatProfileConstructionPath(pathOrPoints, cornerFlags = null) {
  const points = Array.isArray(pathOrPoints?.points) ? pathOrPoints.points : pathOrPoints;
  const flags = Array.isArray(pathOrPoints?.cornerFlags) ? pathOrPoints.cornerFlags : cornerFlags;
  if (!Array.isArray(points) || points.length < 3 || !Array.isArray(flags) || flags.length !== points.length)
    return false;
  for (let i = 0; i < flags.length; i++) if (flags[i] !== true) return false;
  return true;
}
function useSmoothSplinePath(layer, roundingFrac = 0, path = null) {
  return layer?.profileMode === 'spline';
}
function sampleCardinalSplineExact(points, count, tension = 0.5) {
  const src = Array.isArray(points)
    ? points.map((p) => ({ x: Number(p?.x) || 0, y: Number(p?.y) || 0 }))
    : [];
  if (src.length < 2) return src;
  const targetCount = normalizeSplinePointCount(count);

  const previewSegments = Math.max(8, Math.ceil((targetCount * 2) / Math.max(1, src.length - 1)));
  const curve = getCardinalSplinePoints(src, tension, previewSegments);
  if (curve.length < 2) return src;
  const cumulative = [0];
  let total = 0;
  for (let i = 0; i < curve.length - 1; i++) {
    total += Math.hypot(curve[i + 1].x - curve[i].x, curve[i + 1].y - curve[i].y);
    cumulative.push(total);
  }
  if (total <= 1e-9)
    return Array.from({ length: targetCount }, (_, i) => ({
      ...src[Math.min(src.length - 1, Math.round((i * (src.length - 1)) / Math.max(1, targetCount - 1)))],
    }));
  const out = [];
  let seg = 0;
  for (let i = 0; i < targetCount; i++) {
    const d = (i / Math.max(1, targetCount - 1)) * total;
    while (seg < cumulative.length - 2 && d > cumulative[seg + 1]) seg++;
    const span = Math.max(1e-9, cumulative[seg + 1] - cumulative[seg]);
    const u = Math.max(0, Math.min(1, (d - cumulative[seg]) / span));
    const a = curve[seg],
      b = curve[seg + 1];
    out.push({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u });
  }
  out[0] = { ...src[0] };
  out[out.length - 1] = { ...src[src.length - 1] };
  return out;
}
function smoothPreSampledSplinePoints(points) {
  if (!Array.isArray(points)) return [];
  return points.filter((p) => p && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y)));
}
function getInterpolatedProfilePoints(layer) {
  const nodes = layer.profileNodes;
  if (!nodes || nodes.length === 0)
    return [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ];

  if (layer.profileMode === 'spline') {
    const preSampled = isPreSampledSplineLayer(layer);

    if (preSampled) return nodes;

    return sampleCardinalSplineExact(nodes, getConfiguredSplinePointCount(), 0.5);
  } else {
    return nodes;
  }
}
function checkIsBrokenProfile(layer, preparedPoints = null) {
  const pts = preparedPoints || getInterpolatedProfilePoints(layer);
  if (pts.length < 2) return false;
  const start = pts[0];
  const end = pts[pts.length - 1];
  const endShifted = { x: end.x - 1, y: end.y };
  return Math.hypot(start.x - endShifted.x, start.y - endShifted.y) > 0.001;
}

export {
  DEFAULT_PROFILE_CONFIG,
  PROFILE_CONFIG,
  canvasToProfileCoords,
  checkIsBrokenProfile,
  getConfiguredSplinePointCount,
  getInterpolatedProfilePoints,
  isFlatProfileConstructionPath,
  isFlatProfileNodes,
  normalizeSplinePointCount,
  normalizeSplineRenderMode,
  profileToCanvasCoords,
  smoothPreSampledSplinePoints,
  useSmoothSplinePath,
};
