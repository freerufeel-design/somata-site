// Спираль: общие операции с ломаными (длины, точка по длине, срезы).
import '../spline-rounding.js'; // initialisation order: this module runs after it
import { rotateSpiralPoint } from './profile-prep.js';

function spiralSmoothStep01(t) {
  t = Math.max(0, Math.min(1, Number(t) || 0));
  return t * t * (3 - 2 * t);
}
function spiralStyleWithAlpha(style, alpha) {
  const a = Math.max(0, Math.min(1, Number(alpha) || 0));
  const raw = String(style || '#ffffff').trim();
  if (raw[0] === '#') {
    let h = raw.slice(1);
    if (h.length === 3 || h.length === 4)
      h = h
        .split('')
        .map((c) => c + c)
        .join('');
    if (h.length === 6 || h.length === 8) {
      const n = parseInt(h.slice(0, 6), 16);
      if (Number.isFinite(n)) {
        const sa = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
        return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, a * sa))})`;
      }
    }
  }
  const m = raw.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/i);
  if (m) {
    const sa = m[4] == null ? 1 : Math.max(0, Math.min(1, Number(m[4]) || 0));
    return `rgba(${Math.max(0, Math.min(255, Number(m[1]) || 0))},${Math.max(0, Math.min(255, Number(m[2]) || 0))},${Math.max(0, Math.min(255, Number(m[3]) || 0))},${Math.max(0, Math.min(1, a * sa))})`;
  }
  return null;
}
function transformSpiralCopyPoint(p, delta, targetScale, direction = 1) {
  const forward = direction >= 0;
  const angle = forward ? delta : -delta;
  const scale = forward ? targetScale : 1 / Math.max(1e-9, targetScale);
  const q = rotateSpiralPoint(p, angle, scale);
  const out = { ...p, x: q.x, y: q.y };
  if (Number.isFinite(Number(p?.widthScale)))
    out.widthScale = Math.max(0.02, (Number(p.widthScale) || 1) * scale);
  return out;
}
function spiralPolylineCumulative(points) {
  const cum = [0];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(
      (Number(points[i]?.x) || 0) - (Number(points[i - 1]?.x) || 0),
      (Number(points[i]?.y) || 0) - (Number(points[i - 1]?.y) || 0),
    );
    cum.push(total);
  }
  return { cum, total };
}
function spiralPolylinePointAt(points, metrics, distance) {
  const total = Math.max(0, Number(metrics?.total) || 0);
  const d = Math.max(0, Math.min(total, Number(distance) || 0));
  if (points.length === 1) return { ...points[0] };
  let i = 0;
  while (i < points.length - 2 && d > metrics.cum[i + 1]) i++;
  const span = Math.max(1e-9, metrics.cum[i + 1] - metrics.cum[i]);
  const t = Math.max(0, Math.min(1, (d - metrics.cum[i]) / span));
  const a = points[i],
    b = points[i + 1];
  const aw = Math.max(0.02, Number(a?.widthScale) || 1),
    bw = Math.max(0.02, Number(b?.widthScale) || aw);
  return {
    x: (Number(a?.x) || 0) + ((Number(b?.x) || 0) - (Number(a?.x) || 0)) * t,
    y: (Number(a?.y) || 0) + ((Number(b?.y) || 0) - (Number(a?.y) || 0)) * t,
    widthScale: Math.exp(Math.log(aw) + (Math.log(bw) - Math.log(aw)) * t),
    ptIdx: t < 0.5 ? a?.ptIdx : b?.ptIdx,
    __profileCorner: false,
  };
}
function spiralQuadraticPoint(a, c, b, t) {
  const u = 1 - t;
  const aw = Math.max(0.02, Number(a?.widthScale) || 1),
    cw = Math.max(0.02, Number(c?.widthScale) || aw),
    bw = Math.max(0.02, Number(b?.widthScale) || cw);
  return {
    x: u * u * (Number(a?.x) || 0) + 2 * u * t * (Number(c?.x) || 0) + t * t * (Number(b?.x) || 0),
    y: u * u * (Number(a?.y) || 0) + 2 * u * t * (Number(c?.y) || 0) + t * t * (Number(b?.y) || 0),
    widthScale: Math.exp(u * u * Math.log(aw) + 2 * u * t * Math.log(cw) + t * t * Math.log(bw)),
    __profileCorner: false,
  };
}
function appendSpiralPolylineSlice(out, points, metrics, d0, d1) {
  const a = Math.max(0, Math.min(metrics.total, d0)),
    b = Math.max(a, Math.min(metrics.total, d1));
  if (b <= a + 1e-9) return;

  const start = a <= 1e-9 ? { ...points[0] } : spiralPolylinePointAt(points, metrics, a);
  if (!out.length || Math.hypot(start.x - out[out.length - 1].x, start.y - out[out.length - 1].y) > 1e-7)
    out.push(start);
  for (let i = 1; i < points.length - 1; i++) {
    const d = metrics.cum[i];
    if (d > a + 1e-9 && d < b - 1e-9) out.push({ ...points[i] });
  }
  const end =
    b >= metrics.total - 1e-9 ? { ...points[points.length - 1] } : spiralPolylinePointAt(points, metrics, b);
  if (!out.length || Math.hypot(end.x - out[out.length - 1].x, end.y - out[out.length - 1].y) > 1e-7)
    out.push(end);
}

export {
  appendSpiralPolylineSlice,
  spiralPolylineCumulative,
  spiralPolylinePointAt,
  spiralQuadraticPoint,
  spiralSmoothStep01,
  spiralStyleWithAlpha,
  transformSpiralCopyPoint,
};
