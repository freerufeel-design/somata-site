import './canonical.js'; // initialisation order: this module runs after it

const SomataSpiralIntersections = (() => {
  const EPS = 1e-7;
  function crossing(a, b) {
    const rx = a.b.x - a.a.x,
      ry = a.b.y - a.a.y,
      sx = b.b.x - b.a.x,
      sy = b.b.y - b.a.y;
    const den = rx * sy - ry * sx,
      scale = Math.hypot(rx, ry) * Math.hypot(sx, sy);
    if (!(scale > EPS) || Math.abs(den) <= scale * 1e-8) return null;
    const qx = b.a.x - a.a.x,
      qy = b.a.y - a.a.y;
    const t = (qx * sy - qy * sx) / den,
      u = (qx * ry - qy * rx) / den;
    if (t <= 1e-6 || u <= 1e-6 || t >= 1 - 1e-6 || u >= 1 - 1e-6) return null;
    return { x: a.a.x + t * rx, y: a.a.y + t * ry, t, u };
  }
  function segments(paths, maxSegments = 8000) {
    const out = [];
    for (let pi = 0; pi < (paths || []).length; pi++) {
      const path = paths[pi],
        points = path?.points || [];
      if (points.length < 2) continue;
      let distance = 0;
      const edgeCount = points.length - 1 + (path?.closed === true ? 1 : 0);
      for (let si = 0; si < edgeCount; si++) {
        const a = points[si],
          b = points[(si + 1) % points.length];
        const ax = Number(a?.x),
          ay = Number(a?.y),
          bx = Number(b?.x),
          by = Number(b?.y);
        if (![ax, ay, bx, by].every(Number.isFinite)) continue;
        const len = Math.hypot(bx - ax, by - ay);
        if (len <= EPS) continue;
        out.push({
          id: out.length,
          pathIndex: pi,
          segmentIndex: si,
          a: { x: ax, y: ay },
          b: { x: bx, y: by },
          start: distance,
          length: len,
          pathEdgeCount: edgeCount,
          closed: path?.closed === true,
        });
        distance += len;
        if (out.length > maxSegments) return null;
      }
    }
    return out;
  }
  function scan(paths, { maxSegments = 8000, maxCrossings = 1000 } = {}) {
    const segs = segments(paths, maxSegments);
    if (!segs) return { intersections: [], segments: [], limited: true, reason: 'segment-limit' };
    if (!segs.length) return { intersections: [], segments: segs, limited: false };

    const entries = segs.map((s) => ({
      s,
      minX: Math.min(s.a.x, s.b.x),
      maxX: Math.max(s.a.x, s.b.x),
      minY: Math.min(s.a.y, s.b.y),
      maxY: Math.max(s.a.y, s.b.y),
    }));
    entries.sort((a, b) => a.minX - b.minX);
    const active = [],
      out = [];
    for (const e of entries) {
      let kept = 0;
      for (let i = 0; i < active.length; i++) if (active[i].maxX >= e.minX - EPS) active[kept++] = active[i];
      active.length = kept;
      for (const o of active) {
        if (o.maxY < e.minY - EPS || e.maxY < o.minY - EPS) continue;
        const a = o.s,
          b = e.s;
        if (a.pathIndex === b.pathIndex) {
          const d = Math.abs(a.segmentIndex - b.segmentIndex);
          if (d <= 1 || (a.closed && d === a.pathEdgeCount - 1)) continue;
        }
        const hit = crossing(a, b);
        if (!hit) continue;
        out.push({
          x: hit.x,
          y: hit.y,
          pathA: a.pathIndex,
          pathB: b.pathIndex,
          segmentA: a.segmentIndex,
          segmentB: b.segmentIndex,
          distanceA: a.start + hit.t * a.length,
          distanceB: b.start + hit.u * b.length,
          t: hit.t,
          u: hit.u,
          first: a,
          second: b,
        });
        if (out.length >= maxCrossings)
          return { intersections: out, segments: segs, limited: true, reason: 'intersection-limit' };
      }
      active.push(e);
    }
    return { intersections: out, segments: segs, limited: false };
  }

  function arc(paths, pi, start, end) {
    const points = paths?.[pi]?.points || [];
    if (points.length < 2) return [];
    const reverse = start > end,
      lo = reverse ? end : start,
      hi = reverse ? start : end;
    const pts = [],
      push = (p) => {
        if (!pts.length || Math.hypot(pts[pts.length - 1].x - p.x, pts[pts.length - 1].y - p.y) > 1e-7)
          pts.push({ x: p.x, y: p.y });
      };
    let total = 0;
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i],
        b = points[i + 1],
        len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len <= EPS) continue;
      const e = total + len;
      if (e >= lo - EPS && total <= hi + EPS) {
        const ta = Math.max(0, Math.min(1, (lo - total) / len)),
          tb = Math.max(0, Math.min(1, (hi - total) / len));
        push({ x: a.x + (b.x - a.x) * ta, y: a.y + (b.y - a.y) * ta });
        push({ x: a.x + (b.x - a.x) * tb, y: a.y + (b.y - a.y) * tb });
      }
      total = e;
      if (total > hi) break;
    }
    return reverse ? pts.reverse() : pts;
  }
  function loops(paths, scanResult, maxLoops = 256) {
    const hits = scanResult?.intersections || [],
      out = [];
    const clean = (pts) => {
      if (pts.length < 3) return null;
      const first = pts[0],
        last = pts[pts.length - 1];
      if (Math.hypot(first.x - last.x, first.y - last.y) < 1e-5) pts.pop();
      if (pts.length < 3) return null;
      let area = 0;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i],
          b = pts[(i + 1) % pts.length];
        area += a.x * b.y - b.x * a.y;
      }
      return Math.abs(area) > 0.01 ? pts : null;
    };
    for (const h of hits) {
      if (h.pathA !== h.pathB) continue;
      const polygon = clean(arc(paths, h.pathA, h.distanceA, h.distanceB));
      if (polygon) out.push(polygon);
      if (out.length >= maxLoops) return out;
    }
    const pairs = new Map();
    for (const h of hits) {
      if (h.pathA === h.pathB) continue;
      const a = Math.min(h.pathA, h.pathB),
        b = Math.max(h.pathA, h.pathB),
        key = `${a}:${b}`;
      if (!pairs.has(key)) pairs.set(key, []);
      pairs.get(key).push({
        a,
        b,
        da: h.pathA === a ? h.distanceA : h.distanceB,
        db: h.pathA === b ? h.distanceA : h.distanceB,
      });
    }
    for (const list of pairs.values()) {
      list.sort((x, y) => x.da - y.da);
      for (let i = 0; i < list.length - 1; i++) {
        const a = list[i],
          b = list[i + 1];
        const r1 = arc(paths, a.a, a.da, b.da),
          r2 = arc(paths, a.b, b.db, a.db);
        const polygon = clean(r1.concat(r2));
        if (polygon) out.push(polygon);
        if (out.length >= maxLoops) return out;
      }
    }
    return out;
  }
  // True crossing Web: its threads span TWO crossing windings, rather than
  // connecting two points of one winding (which lies on top of Line when
  // the winding is locally straight). Coordinates are in the very same
  // local Line carrier; the existing Corridor instance transform is applied
  // by the renderer to Line and Web alike.
  function pathDistances(paths) {
    return (paths || []).map((path) => {
      const pts = path?.points || [],
        edges = [],
        closed = path?.closed === true;
      let total = 0;
      for (let i = 0, n = Math.max(0, pts.length - 1 + (closed ? 1 : 0)); i < n; i++) {
        const a = pts[i],
          b = pts[(i + 1) % pts.length];
        const len = Math.hypot(
          (Number(b?.x) || 0) - (Number(a?.x) || 0),
          (Number(b?.y) || 0) - (Number(a?.y) || 0),
        );
        if (len > EPS) {
          edges.push({ a, b, len, start: total });
          total += len;
        }
      }
      return { edges, total, closed };
    });
  }
  function sample(t, d) {
    if (!t || t.total <= EPS || !t.edges.length) return null;
    const total = t.total;
    d = t.closed ? ((d % total) + total) % total : Math.max(0, Math.min(total, d));
    let lo = 0,
      hi = t.edges.length - 1;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (t.edges[m].start + t.edges[m].len < d) lo = m + 1;
      else hi = m;
    }
    const e = t.edges[lo],
      u = Math.max(0, Math.min(1, (d - e.start) / e.len));
    return {
      x: Number(e.a.x) + (Number(e.b.x) - Number(e.a.x)) * u,
      y: Number(e.a.y) + (Number(e.b.y) - Number(e.a.y)) * u,
    };
  }
  function selectCrossings(hits, maxCrossings = 96) {
    if (!Array.isArray(hits) || !hits.length) return [];
    if (hits.length <= maxCrossings) return hits;
    const out = [];
    for (let i = 0; i < maxCrossings; i++)
      out.push(hits[Math.floor(((i + 0.5) * hits.length) / maxCrossings)]);
    return out;
  }
  function buildCrossingThreads(
    paths,
    scanResult,
    { spacing = 10, depthPercent = 60, depthMultiplier = 1, maxCrossings = 96, maxThreads = 1200 } = {},
  ) {
    const hits = selectCrossings(scanResult?.intersections || [], maxCrossings),
      out = [];
    if (!hits.length || !paths?.length) return out;
    const tables = pathDistances(paths);
    const step = Math.max(1, Number(spacing) || 10),
      fraction = Math.max(0, Math.min(1, (Number(depthPercent) || 0) / 100)),
      mult = Math.max(0, Number(depthMultiplier) || 0);
    if (!fraction || !mult) return out;
    // Keep webs local to a crossing, without reaching other revolutions.
    const wanted = Math.min(240, Math.max(step * 4, step * 16)) * fraction * mult;
    const perQuadrant = Math.max(1, Math.floor(maxThreads / Math.max(1, hits.length * 4)));
    for (let hi = 0; hi < hits.length && out.length < maxThreads; hi++) {
      const h = hits[hi],
        a = tables[h.pathA],
        b = tables[h.pathB];
      if (!a?.total || !b?.total) continue;
      for (const sa of [-1, 1])
        for (const sb of [-1, 1]) {
          const aa = sa < 0 ? h.distanceA : a.total - h.distanceA,
            bb = sb < 0 ? h.distanceB : b.total - h.distanceB;
          const limit = Math.min(
            wanted,
            a.closed ? a.total * 0.45 : aa - 0.01,
            b.closed ? b.total * 0.45 : bb - 0.01,
          );
          if (limit < step * 0.5) continue;
          const count = Math.min(32, perQuadrant, Math.max(1, Math.floor(limit / step)));
          for (let i = 1; i <= count && out.length < maxThreads; i++) {
            // If the per-frame thread budget is limited, spread the
            // available rungs across the full requested geometric depth.
            const d = limit * (i / count),
              pa = sample(a, h.distanceA + sa * d),
              pb = sample(b, h.distanceB + sb * d);
            if (!pa || !pb || Math.hypot(pa.x - pb.x, pa.y - pb.y) < 0.35) continue;
            out.push({
              x0: pa.x,
              y0: pa.y,
              x1: pb.x,
              y1: pb.y,
              cx: h.x,
              cy: h.y,
              hitIndex: hi,
              pathA: h.pathA,
              pathB: h.pathB,
            });
          }
        }
    }
    return out;
  }
  const cache = new WeakMap();
  function scanFrame(paths, frameId, opts) {
    if (!Array.isArray(paths)) return { intersections: [], segments: [], limited: false };
    const key = Number(frameId) || 0,
      previous = cache.get(paths);
    if (previous && previous.id === key && !opts) return previous.value;
    const result = scan(paths, opts || {});
    if (!opts) cache.set(paths, { id: key, value: result });
    return result;
  }
  return { scan, scanFrame, loops, arc, selectCrossings, buildCrossingThreads };
})();
window.SomataSpiralIntersections = SomataSpiralIntersections;
