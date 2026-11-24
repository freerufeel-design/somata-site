import '../morphs/types/coordinatedFromCenter.js'; // initialisation order: this module runs after it
import { getCachedLayerDrawData } from '../effects/motion.js';
import { getMorphReferenceRadius } from './reference-circle.js';
import { getEffectiveSpiralOrder } from './spiral/order-params.js';
import { buildOrbitPolylines } from './orbit-builder.js';

window.SomataSkeletonRuntime = (() => {
  // The primary geometry contains positions and connections only. Rendering
  // services may sample these straight edges, but never mutate their nodes.
  const clamp = (t) => Math.max(0, Math.min(1, Number.isFinite(Number(t)) ? Number(t) : 0));
  const smooth = (t) => {
    const v = clamp(t);
    return v * v * (3 - 2 * v);
  };
  const lerp = (a, b, t) => a + (b - a) * t;
  const point = (p) => ({
    id: p?.id ?? null,
    x: Number(p?.x) || 0,
    y: Number(p?.y) || 0,
    polygonIndex: p?.polygonIndex,
  });
  const cart = (a, b, t) => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) });
  function seaweedVectors(base, count, dx, dy) {
    // Solve sum(edge * scale) = seam displacement. A common
    // positive bias cannot move the seam (the original sum is 0).
    // Each edge keeps its original direction, even on a star orbit.
    const vectors = base.map((p, i) => {
      const q = base[(i + 1) % count];
      return { x: q.x - p.x, y: q.y - p.y };
    });
    let xx = 0,
      xy = 0,
      yy = 0;
    for (const { x, y } of vectors) {
      xx += x * x;
      xy += x * y;
      yy += y * y;
    }
    const det = xx * yy - xy * xy,
      trace = xx + yy;
    const fullRank = det > 1e-12 * trace * trace;
    const kx = fullRank ? (yy * dx - xy * dy) / det : trace > 0 ? dx / trace : 0;
    const ky = fullRank ? (xx * dy - xy * dx) / det : trace > 0 ? dy / trace : 0;
    const corrections = vectors.map(({ x, y }) => x * kx + y * ky);
    const bias = Math.max(0, ...corrections.map((v) => -0.75 - v));
    return vectors.map((v, i) => {
      const scale = 1 + bias + corrections[i];
      return { x: v.x * scale, y: v.y * scale };
    });
  }
  // The only authored geometry is a set of vertices and edges. No profile,
  // spline, analytic edge sampler or renderer is allowed to create a vertex.
  function createGraph(orbitIndex, vertices, options = {}) {
    const authored = Array.isArray(vertices) ? vertices : [];
    if (authored.length < (options.singleReferenceBranch && options.referenceWeight === 1 ? 1 : 2))
      return null;
    const order = Number(options.spiralOrder) || 0;
    const winding = Math.abs(order) > 1e-8;
    const connected = options.connectEdges === true;
    const count = authored.length;
    const delta =
      (2 * Math.PI * (Number.isFinite(Number(options.spiralStep)) ? Number(options.spiralStep) : 1)) /
      Math.max(2, Number(options.spiralAngularN) || count);
    const twist = Math.max(0, Math.min(1, Number(options.twist ?? 1)));
    const ratio = Math.max(1e-9, Number(options.radialScale) || 1);
    const direct = options.directLayerwise;
    const rotate = (p, angle, scale) => ({
      x: scale * (p.x * Math.cos(angle) - p.y * Math.sin(angle)),
      y: scale * (p.x * Math.sin(angle) + p.y * Math.cos(angle)),
    });
    const directEnd = (start, flat, wound) => {
      const ax = flat.x - start.x,
        ay = flat.y - start.y,
        bx = wound.x - start.x,
        by = wound.y - start.y;
      const l0 = Math.hypot(ax, ay),
        l1 = Math.hypot(bx, by);
      if (l0 < 1e-9 || l1 < 1e-9) return cart(flat, wound, direct.weight);
      const phi = Math.atan2(ay, ax) + direct.weight * Math.atan2(ax * by - ay * bx, ax * bx + ay * by);
      const length = lerp(l0, l1, direct.weight);
      return { x: start.x + length * Math.cos(phi), y: start.y + length * Math.sin(phi) };
    };
    if (winding && options.orbitUnfold) {
      const { beta, projection, rotation } = options.orbitUnfold;
      const base = authored.map((p) => rotate(p, rotation, 1));
      const first = base[0],
        c = Math.cos(beta),
        s = Math.sin(beta);
      const goal = {
        x: ratio * (c * first.x - s * first.y * projection),
        y: ratio * (c * first.y + (projection > 0 ? s / projection : 0) * first.x),
      };
      const dx = goal.x - first.x,
        dy = goal.y - first.y;
      // Taper the original edges progressively. A single similarity
      // maps the tapered turn's displacement to the Corridor seam;
      // independent corrections would make opposite sides overshoot.
      const logRatio = Math.log(ratio);
      // A duplicated vertex slot at the phase endpoint has the same
      // authored station as its surviving neighbour. Its removal cannot
      // re-taper all other edges in the turn.
      const exponent = (i) => logRatio * (Number.isFinite(authored[i].windingU) ? authored[i].windingU : i / count);
      const vectors = base.map((p, i) => {
        const q = base[(i + 1) % count],
          weight = Math.exp(exponent(i));
        return { x: (q.x - p.x) * weight, y: (q.y - p.y) * weight };
      });
      // Use expm1 to cancel the original closed contour analytically.
      const span = base.reduce(
        (v, p, i) => {
          const q = base[(i + 1) % count],
            w = Math.expm1(exponent(i));
          return { x: v.x + (q.x - p.x) * w, y: v.y + (q.y - p.y) * w };
        },
        { x: 0, y: 0 },
      );
      const den = span.x * span.x + span.y * span.y;
      const size2 = Math.max(...base.map((p) => p.x * p.x + p.y * p.y));
      const fit = den > 1e-30 * size2 && dx * dx + dy * dy > 1e-30 * size2;
      const re = fit ? (dx * span.x + dy * span.y) / den : 1;
      const im = fit ? (dy * span.x - dx * span.y) / den : 0;
      const legacy = options.orbitUnfold.seaweed ? seaweedVectors(base, count, dx, dy) : null;
      const nodes = [],
        edges = [],
        edgeSamples = [],
        orbits = [],
        byId = new Map();
      const put = (i, p) => {
        const src = authored[i % count];
        const id =
          i === count
            ? `orbit:${orbitIndex}:unfold-tip`
            : options.preserveIds && src.id != null
              ? src.id
              : `orbit:${orbitIndex}:vertex:${i}`;
        const node = { ...p, id, polygonIndex: src.polygonIndex };
        nodes.push(node);
        byId.set(id, node);
        return node;
      };
      let start = put(0, first);
      const edgeCount = connected ? count : count - 1;
      for (let i = 0; i < edgeCount; i++) {
        const v = vectors[i];
        const end = put(
          i + 1,
          legacy
            ? { x: start.x + legacy[i].x, y: start.y + legacy[i].y }
            : { x: start.x + v.x * re - v.y * im, y: start.y + v.x * im + v.y * re },
        );
        const points = [start, end];
        edgeSamples.push(points);
        edges.push({ from: start.id, to: end.id, kind: 'carrier', orbitIndex, edgeIndex: i });
        orbits.push({
          orbitIndex: orbitIndex * 100000 + i,
          sourceOrbitIndex: orbitIndex,
          edgeIndex: i,
          turnStart: i === 0,
          turnEnd: i === edgeCount - 1,
          spiralOrder: order,
          spiralBranchIndex: authored[i]?.polygonIndex,
          closed: false,
          connectToNext: connected,
          rawJunctionGap: 0,
          points,
        });
        start = end;
      }
      return {
        orbitIndex,
        order,
        twist,
        nodes,
        edges,
        edgeSamples,
        orbits,
        byId,
        connected,
        closed: false,
        periodDelta: beta,
        radialScale: ratio,
        sourceVertices: authored.map(point),
      };
    }
    const referenceWeight = winding ? clamp(options.referenceWeight ?? 1 - twist) : 0;
    if (referenceWeight > 0) {
      // 13.2: one independent period per original polygon anchor. Do not
      // accumulate the transform along the polygon or join adjacent branches.
      const angle = Number.isFinite(options.referenceDelta)
        ? options.referenceDelta
        : delta * Math.max(-1, Math.min(1, order));
      const c = Math.cos(angle),
        s = Math.sin(angle);
      const legacy =
        referenceWeight < 1
          ? createGraph(orbitIndex, authored, { ...options, referenceWeight: 0, twist: 1 })
          : null;
      const nodes = [],
        edges = [],
        edgeSamples = [],
        orbits = [],
        byId = new Map();
      const starts = authored.map((p, i) => ({
        ...point(legacy ? { ...p, ...cart(legacy.edgeSamples[i][0], p, referenceWeight) } : p),
        id: options.preserveIds && p.id != null ? p.id : `orbit:${orbitIndex}:vertex:${i}`,
      }));
      nodes.push(...starts);
      const referenceEdges = [],
        reveal = clamp(options.windingWeight ?? 1);
      for (let i = 0; i < count; i++) {
        const p = authored[i],
          a = starts[i];
        const beta = options.beta,
          sy = options.phaseProjection;
        const fitted = Number.isFinite(beta);
        const cb = fitted ? Math.cos(beta) : c,
          sb = fitted ? Math.sin(beta) : s;
        // Solve in Corridor coordinates, then express the endpoint
        // in the graph's local space before applying Y projection.
        const endPoint = fitted
          ? { x: ratio * (cb * p.x - sb * p.y * sy), y: ratio * (cb * p.y + (sy > 0 ? sb / sy : 0) * p.x) }
          : { x: ratio * (c * p.x - s * p.y), y: ratio * (s * p.x + c * p.y) };
        const neighbor = i + (direct?.reverse ? -1 : 1);
        const flat = connected ? authored[(neighbor + count) % count] : (authored[neighbor] ?? p);
        const nominal = direct
          ? directEnd(p, flat, rotate(p, direct.angle, direct.scale))
          : cart(p, endPoint, reveal);
        const end = legacy ? cart(legacy.edgeSamples[i][1], nominal, referenceWeight) : nominal;
        const b = { ...end, id: `${a.id}:period-end`, polygonIndex: p.polygonIndex };
        nodes.push(b);
        edgeSamples.push([a, b]);
        referenceEdges.push({
          anchor: p,
          delta: angle,
          targetScale: direct?.scale ?? ratio,
          reveal,
          profileLife: p.profileLife ?? 1,
        });
        edges.push({ from: a.id, to: b.id, kind: 'carrier', orbitIndex, edgeIndex: i });
        orbits.push({
          orbitIndex: orbitIndex * 100000 + i,
          sourceOrbitIndex: orbitIndex,
          edgeIndex: i,
          turnStart: true,
          turnEnd: true,
          spiralOrder: order,
          spiralBranchIndex: p.polygonIndex,
          closed: false,
          connectToNext: false,
          rawJunctionGap: 0,
          points: [a, b],
        });
      }
      for (const p of nodes) byId.set(p.id, p);
      const periodDelta = lerp(legacy?.periodDelta ?? angle, angle, referenceWeight);
      return {
        orbitIndex,
        order,
        twist,
        nodes,
        edges,
        edgeSamples,
        orbits,
        connected,
        closed: false,
        byId,
        referenceEdges,
        referenceWeight,
        periodDelta,
        legacy,
        radialScale: ratio,
        directLayerwiseWeight: direct?.weight,
        sourceVertices: authored.map(point),
      };
    }
    const mix = smooth(Math.min(1, Math.abs(order))) * clamp(options.windingWeight ?? 1);
    const sign = order < 0 ? -1 : 1;
    const nodes = [],
      edges = [],
      edgeSamples = [],
      orbits = [],
      byId = new Map();
    const prefix = `orbit:${orbitIndex}`;
    const put = (index, p) => {
      const id = options.preserveIds && index < count && p?.id != null ? p.id : `${prefix}:vertex:${index}`;
      const v = {
        id,
        x: Number(p?.x) || 0,
        y: Number(p?.y) || 0,
        polygonIndex: authored[index % count]?.polygonIndex,
      };
      nodes.push(v);
      byId.set(id, v);
      return v;
    };
    const transformed = (i) => {
      const origin = authored[i % count];
      if (!winding) return origin;
      // The endpoint of a turn is generated by the same point motion as
      // the beginning of the following turn. No closing/bridge edge is
      // introduced. Fractional order interpolates the point positions.
      const fraction = i === count ? 1 : (origin.windingU ?? i / count);
      if (direct) {
        const z = direct.endpointWinding,
          w = z * z * (3 - 2 * z);
        const phi = direct.angle * (direct.coordinated ? 1 : 1 / z) * fraction;
        const r = Math.pow(direct.scale, fraction);
        const tip = rotate(origin, phi, r);
        const end = direct.coordinated ? tip : cart(origin, tip, w);
        return { ...origin, ...directEnd({ x: 0, y: 0 }, origin, end) };
      }
      // The coordinated route constructs the seam directly with beta
      // in projected space. The final graph is never welded afterwards.
      if (Number.isFinite(options.beta)) {
        const beta = options.beta * (i === count ? 1 : fraction * twist);
        const c = Math.cos(beta),
          s = Math.sin(beta),
          sy = options.phaseProjection;
        const scale = Math.pow(ratio, fraction);
        return {
          ...origin,
          x: scale * (c * origin.x - s * origin.y * sy),
          y: scale * (c * origin.y + (sy > 0 ? s / sy : 0) * origin.x),
        };
      }
      const angle = sign * delta * fraction * twist;
      const scale = Math.pow(ratio, fraction);
      const c = Math.cos(angle),
        ss = Math.sin(angle);
      return {
        id: origin.id,
        x: lerp(origin.x, (origin.x * c - origin.y * ss) * scale, mix),
        y: lerp(origin.y, (origin.x * ss + origin.y * c) * scale, mix),
      };
    };
    for (let i = 0; i < count; i++) put(i, transformed(i));
    // Zero order is an actual polygon. A spiral period has an OPEN end:
    // its final vertex is the start vertex of the next geometric period.
    const closed = !winding && connected && options.openCarrier !== true;
    // An open planar carrier has no last-to-first edge. Introduce the
    // new terminal spiral edge from zero length, not at full chord length.
    const terminalWeight =
      winding && options.openCarrier === true ? (direct?.weight ?? smooth(Math.min(1, Math.abs(order)))) : 1;
    const fullEnd = winding ? transformed(count) : null;
    const tail = nodes[count - 1];
    const terminalReferenceLength =
      terminalWeight < 1 ? Math.hypot(fullEnd.x - tail.x, fullEnd.y - tail.y) : 0;
    const end = closed ? nodes[0] : winding ? put(count, cart(tail, fullEnd, terminalWeight)) : null;
    const edgeCount = !winding && !closed ? count - 1 : count;
    for (let i = 0; i < edgeCount; i++) {
      const a = nodes[i],
        b = i === count - 1 ? end : nodes[i + 1];
      edgeSamples.push([a, b]);
      edges.push({ from: a.id, to: b.id, kind: 'carrier', orbitIndex, edgeIndex: i });
      orbits.push({
        orbitIndex: orbitIndex * 100000 + i,
        sourceOrbitIndex: orbitIndex,
        edgeIndex: i,
        turnStart: winding && i === 0,
        turnEnd: winding && i === edgeCount - 1,
        spiralOrder: winding ? order : 0,
        spiralBranchIndex: authored[i]?.polygonIndex,
        closed: false,
        connectToNext: connected || Number.isFinite(options.beta),
        rawJunctionGap: 0,
        points: [a, b],
      });
    }
    const root = nodes[0];
    const periodDelta = winding
      ? Math.atan2(root.x * end.y - root.y * end.x, root.x * end.x + root.y * end.y)
      : NaN;
    return {
      orbitIndex,
      order,
      twist,
      nodes,
      edges,
      edgeSamples,
      orbits,
      connected,
      closed,
      terminalWeight,
      terminalReferenceLength,
      periodDelta,
      byId,
      directLayerwiseWeight: direct?.weight,
      sourceVertices: authored.map(point),
    };
  }

  // A spline/profile samples the primary straight-edge graph. Derivatives
  // come from neighboring GRAPH NODES, not a second analytic curve.
  function sampleGraphEdge(graph, index, u) {
    const samples = graph?.edgeSamples;
    if (!samples?.length) return null;
    const ring =
      samples[((Math.floor(Number(index) || 0) % samples.length) + samples.length) % samples.length];
    const n = ring.length - 1;
    if (!n) return null;
    const raw = Number.isFinite(Number(u)) ? Number(u) : 0;
    const v = Math.max(0, Math.min(n, raw * n));
    const j = Math.min(n - 1, Math.floor(v)),
      frac = v - j,
      a = ring[j],
      b = ring[j + 1];
    const q = raw === 0 ? ring[0] : raw === 1 ? ring[n] : cart(a, b, frac);
    // Only positions belong to the skeleton. Profile tangents are
    // derivatives of neighboring straight chords, interpolated smoothly.
    const tangentAt = (k) => {
      const lo = Math.max(0, k - 1),
        hi = Math.min(n, k + 1);
      return {
        x: ((ring[hi].x - ring[lo].x) * n) / (hi - lo),
        y: ((ring[hi].y - ring[lo].y) * n) / (hi - lo),
      };
    };
    const left = tangentAt(j),
      right = tangentAt(j + 1);
    let tx = lerp(left.x, right.x, frac),
      ty = lerp(left.y, right.y, frac);
    if (raw < 0 || raw > 1) {
      const endpoint = raw < 0 ? ring[0] : ring[n];
      const segment = raw < 0 ? [ring[0], ring[1]] : [ring[n - 1], ring[n]];
      tx = (segment[1].x - segment[0].x) * n;
      ty = (segment[1].y - segment[0].y) * n;
      return {
        x: endpoint.x + (raw < 0 ? raw : raw - 1) * tx,
        y: endpoint.y + (raw < 0 ? raw : raw - 1) * ty,
        tx,
        ty,
      };
    }
    return { x: q.x, y: q.y, tx, ty };
  }
  // The profile samples the carrier described by the same branch edge.
  // This is the chord / logarithmic-spiral blend from 13.2 (no rounding).
  function sampleReferenceEdge(graph, index, u, tangential) {
    const spec = graph?.referenceEdges?.[index];
    if (!spec) return null;
    const { anchor, delta, targetScale, reveal = 1 } = spec;
    const x = Number(anchor.x) || 0,
      y = Number(anchor.y) || 0;
    const c = Math.cos(delta),
      s = Math.sin(delta);
    const endX = (x * c - y * s) * targetScale,
      endY = (x * s + y * c) * targetScale;
    const dx = endX - x,
      dy = endY - y;
    const blend = clamp(tangential);
    const base = { x: x + dx * u, y: y + dy * u, tx: dx, ty: dy };
    if (blend > 0) {
      const logScale = Math.log(targetScale);
      const r = Math.max(1e-9, Math.hypot(x, y)) * Math.exp(logScale * u);
      const theta = Math.atan2(y, x) + delta * u;
      const px = r * Math.cos(theta),
        py = r * Math.sin(theta);
      base.x = lerp(base.x, px, blend);
      base.y = lerp(base.y, py, blend);
      base.tx = lerp(base.tx, logScale * px - delta * py, blend);
      base.ty = lerp(base.ty, logScale * py + delta * px, blend);
    }
    // During a topology transition the branch may be shifted with its
    // parent. Use a snapshot of the pure branch for the blend; the final
    // correction in the mapper keeps the derived curve on the live nodes.
    return {
      x: lerp(x, base.x, reveal),
      y: lerp(y, base.y, reveal),
      tx: base.tx * reveal,
      ty: base.ty * reveal,
      startX: x,
      startY: y,
      endX: lerp(x, endX, reveal),
      endY: lerp(y, endY, reveal),
    };
  }
  function sampleEdgePoint(vertices, edgeIndex, u, options = {}) {
    const onGraph = sampleGraphEdge(options.graph, edgeIndex, u);
    if (onGraph) return onGraph;
    const list = Array.isArray(vertices) ? vertices : [];
    if (list.length < 2) return null;
    const i = ((Math.floor(Number(edgeIndex) || 0) % list.length) + list.length) % list.length;
    const a = list[i],
      b = list[(i + 1) % list.length];
    const t = Number.isFinite(Number(u)) ? Number(u) : 0;
    const fallback = { ...cart(a, b, t), tx: b.x - a.x, ty: b.y - a.y };
    return fallback;
  }
  function edgeOrbits(orbitIndex, vertices, options = {}) {
    return createGraph(orbitIndex, vertices, options)?.orbits || [];
  }
  function normalize(orbits) {
    if (!Array.isArray(orbits)) return [];
    const shared = new Map();
    return orbits
      .map((orbit, i) => ({
        orbitIndex: Number.isFinite(Number(orbit?.orbitIndex)) ? Number(orbit.orbitIndex) : i,
        sourceOrbitIndex: orbit?.sourceOrbitIndex ?? null,
        edgeIndex: orbit?.edgeIndex ?? null,
        spiralBranchIndex: orbit?.spiralBranchIndex,
        spiralOrder: orbit?.spiralOrder,
        turnStart: orbit?.turnStart === true,
        turnEnd: orbit?.turnEnd === true,
        closed: orbit?.closed === true,
        connectToNext: orbit?.connectToNext === true,
        rawJunctionGap: Number(orbit?.rawJunctionGap) || 0,
        alpha: Number.isFinite(Number(orbit?.alpha)) ? Number(orbit.alpha) : undefined,
        points: (orbit?.points || [])
          .filter((p) => Number.isFinite(Number(p?.x)) && Number.isFinite(Number(p?.y)))
          .map((p) => {
            if (p.id == null) return point(p);
            const key = String(p.id);
            if (!shared.has(key)) shared.set(key, point(p));
            return shared.get(key);
          }),
      }))
      .filter((orbit) => orbit.points.length >= 2);
  }
  function graphOfLayer(layer) {
    if (!layer || typeof getCachedLayerDrawData !== 'function') return null;
    try {
      return getCachedLayerDrawData(layer)?.paths?.__somataSkeletonGraphs || null;
    } catch (_) {
      return null;
    }
  }
  function ofLayer(layer) {
    const graphs = graphOfLayer(layer);
    if (Array.isArray(graphs) && graphs.length) return normalize(graphs.flatMap((g) => g.orbits));
    if (!layer || typeof getCachedLayerDrawData !== 'function') return [];
    try {
      return normalize(getCachedLayerDrawData(layer)?.paths?.__somataSkeletonOrbits);
    } catch (_) {
      return [];
    }
  }
  // Modes supply correspondence and trajectories. This layer only executes them.
  function build(layer) {
    if (!layer) return [];
    if (typeof buildOrbitPolylines !== 'function') return ofLayer(layer);
    return buildOrbitPolylines(layer, true).flatMap((g) => g.orbits);
  }
  function polygon(ctx, vertex, plan) {
    const { a, b, source, target } = ctx;
    if (!a || !b || a.chaosStar || b.chaosStar || !plan) return null;
    const evaluate = (t, lampSlots = false) => {
      if (!lampSlots && t === 0) return source;
      if (!lampSlots && t === 1) return target;
      const r = getMorphReferenceRadius(a, b, t);
      return plan.pathPlans.flatMap((pp, orbitIndex) => {
        const points = pp.from.map((_, i) => ({
          ...(lampSlots ? pp.lampSlots[i] : {}),
          id: `m:${orbitIndex}:${i}`,
          ...vertex(pp, i, t, r, a, b),
          windingU: pp.turnFrom && pp.turnTo ? lerp(pp.turnFrom[i], pp.turnTo[i], t) : undefined,
        }));
        // The carrier may run opposite to an endpoint's authored vertex order
        // (Minimal slide). Its contour profile must then be mirrored.
        const reversed = {
          ...(pp.turnFrom && pp.turnTo ? {
            spiralEdgeLife: pp.turnFrom.map((from, i) => {
              const sourceSpan = (pp.turnFrom[i + 1] ?? 1) - from;
              const targetSpan = (pp.turnTo[i + 1] ?? 1) - pp.turnTo[i];
              return lerp(Number(sourceSpan > 1e-8), Number(targetSpan > 1e-8), t);
            }),
          } : {}),
          srcReversed: pp.srcReversed === true,
          dstReversed: pp.dstReversed === true,
          // Для заливки: путь-дубль слияния/разделения орбит (см. fillGhostWeight).
          fillPathSource: pp.sourcePathPresent !== false,
          fillPathTarget: pp.targetPathPresent !== false,
        };
        return plan.srcClosed === plan.dstClosed
          ? [{ orbitIndex, closed: plan.srcClosed, points, ...reversed }]
          : [
              { orbitIndex, closed: plan.srcClosed, points, alpha: 1 - t, ...reversed },
              { orbitIndex, closed: plan.dstClosed, points, alpha: t, ...reversed },
            ];
      });
    };
    if (ctx.anchorPlan && !ctx.spiralMorph) {
      // Geometry compacts its endpoint paths. Lamps retain the same slots throughout the phase.
      for (const pp of plan.pathPlans) {
        const representatives = (angles, present) => {
          const seen = new Set();
          return angles.map((angle) => {
            const key = Math.round(Math.cos(angle) * 1e7) + ':' + Math.round(Math.sin(angle) * 1e7);
            const first = !seen.has(key);
            seen.add(key);
            return present && first;
          });
        };
        const source = representatives(pp.from, pp.sourcePathPresent !== false);
        const target = representatives(pp.from.map((a, i) => a + pp.delta[i]), pp.targetPathPresent !== false);
        pp.lampSlots = pp.from.map((_, i) => ({
          lampSourcePresent: source[i],
          lampTargetPresent: target[i],
        }));
      }
      evaluate.lampPaths = (t) => evaluate(t, true);
    }
    const sample = (t) => evaluate(t);
    sample.lampPaths = evaluate.lampPaths;
    return sample;
  }
  const helpers = Object.freeze({ cart, anchors, polygon });
  function anchors(layer) {
    const wound = Math.abs(getEffectiveSpiralOrder(layer)) > 1e-8;
    const closed = wound ? layer.spiralClosed !== false : layer.extendedProfileEnabled === true || layer.closedLoop !== false;
    return buildOrbitPolylines(layer, true).map((g) => ({
      orbitIndex: g.orbitIndex,
      closed,
      spiralConnected: closed,
      points: g.sourceVertices.map((p, i) => ({ ...p, id: `anchor:${g.orbitIndex}:${i}` })),
    }));
  }
  function planAnchors(a, b, mode, slide, options = {}) {
    const rule = window.SomataMorphRegistry.get(mode);
    if (!rule) return null;
    const source = anchors(a),
      target = anchors(b);
    if (!source.length || !target.length) return null;
    // Only the orbit-unfold family consumes rooted polygon orbits. Keep
    // ordinary morph correspondences and multi-orbit merges unchanged.
    if (options.rootedOrbit && source.length === 1 && target.length === 1 &&
        source[0].closed === target[0].closed && source[0].points.length >= 3 && target[0].points.length >= 3) {
      const rooted = window.SomataCoordinatedSpine?.plan(source, target);
      if (rooted) {
        const evaluate = (t, frame) => rooted(t, frame).map(({ coordinatedSpine, ...path }) => ({ ...path, rootedOrbit: true }));
        return { source, target, evaluate, corridorPhase: true, sampledLayer: true };
      }
    }
    const wound = [a, b].some((l) => Math.abs(getEffectiveSpiralOrder(l)) > 1e-8);
    const ctx = { a, b, source, target, slide, spiralMorph: wound, anchorPlan: true };
    const evaluate = rule.prepareAnchors(ctx, helpers);
    return typeof evaluate === 'function'
      ? {
          source,
          target,
          evaluate,
          corridorPhase: rule.corridorPhase,
          sampledLayer:
            rule.sampledLayer === true || (window.SomataMorphRegistry.usesCoordinatedSpine(mode) && wound),
        }
      : null;
  }
  function sample(plan, progress, frame) {
    if (!plan) return [];
    const t = clamp(progress);
    if (!plan.sampledLayer && (t === 0 || t === 1)) return t === 0 ? plan.source : plan.target;
    return plan.evaluate(t, frame);
  }
  const staticFrame = (layer) => ofLayer(layer);
  // Corridor is an instancing transform of the same point graph. For a
  // spiral, expand the actual vertices into a single open chain BEFORE
  // drawing. The final authored edge of turn i terminates at the SAME node
  // that starts turn i+1. No closure or connector edge is ever added.
  function corridorFrame(paths, copies, scale = 1, rotation = 0) {
    if (!Array.isArray(paths) || !Array.isArray(copies)) return [];
    const ordered = copies
      .filter((c) => Number(c?.alpha) > 1e-4 && Number.isFinite(Number(c?.scale)) && Number(c.scale) > 0)
      .slice()
      .sort((a, b) => (Number(a.position) || 0) - (Number(b.position) || 0));
    if (!ordered.length) return [];
    const result = [],
      rotation0 = Number(rotation) || 0,
      scale0 = Number(scale) || 1;
    const apply = (p, copy, id) => {
      const angle = rotation0 + (Number(copy.rotation) || 0);
      const factor = scale0 * Number(copy.scale);
      const c = Math.cos(angle),
        ss = Math.sin(angle);
      return { id, x: (p.x * c - p.y * ss) * factor, y: (p.x * ss + p.y * c) * factor };
    };
    for (const path of paths) {
      if (path?.closed === true || !Array.isArray(path?.points) || path.points.length < 2) continue;
      const base = path.points,
        n = base.length - 1;
      const starts = ordered.map((copy, i) =>
        apply(base[0], copy, `${base[0].id ?? 'start'}:corridor:${copy.position ?? i}`),
      );
      let chain = null,
        previous = null;
      for (let i = 0; i < ordered.length; i++) {
        const copy = ordered[i];
        const adjacent =
          previous && Math.abs((Number(copy.position) || 0) - (Number(previous.position) || 0) - 1) < 1e-3;
        if (!chain || !adjacent) {
          chain = { orbitIndex: path.orbitIndex, closed: false, alpha: path.alpha, points: [] };
          result.push(chain);
          chain.points.push(starts[i]);
        }
        for (let j = 1; j < n; j++)
          chain.points.push(apply(base[j], copy, `${base[j].id ?? j}:corridor:${copy.position ?? i}`));
        const next = ordered[i + 1];
        const nextAdjacent =
          next && Math.abs((Number(next.position) || 0) - (Number(copy.position) || 0) - 1) < 1e-3;
        const endpoint = apply(base[n], copy, `${base[n].id ?? n}:corridor:end:${copy.position ?? i}`);
        chain.points.push(endpoint);
        // Never mask a bad fit by replacing the authored tail.
        // Continue the debug path only when both transformed nodes
        // already agree (relative tolerance for very large copies).
        const head = nextAdjacent ? starts[i + 1] : null;
        const joins =
          head &&
          Math.hypot(endpoint.x - head.x, endpoint.y - head.y) <=
            1e-9 * Math.max(1, Math.hypot(head.x, head.y));
        previous = joins ? copy : null;
      }
    }
    return result;
  }
  function junctionReport(orbits) {
    const groups = new Map();
    for (const orbit of orbits || []) {
      if (!orbit?.connectToNext || orbit.edgeIndex == null || orbit.sourceOrbitIndex == null) continue;
      if (!groups.has(orbit.sourceOrbitIndex)) groups.set(orbit.sourceOrbitIndex, []);
      groups.get(orbit.sourceOrbitIndex).push(orbit);
    }
    let links = 0,
      disconnected = 0,
      maxGap = 0,
      sharedNodes = 0,
      openChains = 0,
      closedChains = 0;
    for (const group of groups.values()) {
      group.sort((a, b) => a.edgeIndex - b.edgeIndex);
      // The last-to-first seam is examined ONLY for a genuinely closed
      // polygon. Spiral ends must never be treated as a closing seam.
      const first = group[0]?.points?.[0];
      const last = group.at(-1)?.points?.at(-1);
      const closed = first?.id != null && last?.id === first.id;
      if (closed) closedChains++;
      else openChains++;
      const limit = closed ? group.length : group.length - 1;
      for (let i = 0; i < limit; i++) {
        const a = group[i],
          b = group[(i + 1) % group.length];
        if (b.edgeIndex !== (a.edgeIndex + 1) % group.length) {
          disconnected++;
          continue;
        }
        const tail = a.points.at(-1),
          head = b.points[0];
        if (!tail || !head) {
          disconnected++;
          continue;
        }
        const gap = Math.hypot(tail.x - head.x, tail.y - head.y);
        maxGap = Math.max(maxGap, gap);
        links++;
        if (tail === head || (tail.id != null && tail.id === head.id)) sharedNodes++;
        if (gap > 1e-8 || tail.id !== head.id) disconnected++;
      }
    }
    return { links, sharedNodes, maxGap, disconnected, openChains, closedChains };
  }
  return Object.freeze({
    createGraph,
    sampleGraphEdge,
    sampleReferenceEdge,
    sampleEdgePoint,
    edgeOrbits,
    graphOfLayer,
    ofLayer,
    normalize,
    sample,
    staticFrame,
    build,
    anchors,
    planAnchors,
    corridorFrame,
    junctionReport,
    modes: () => window.SomataMorphRegistry.ids(),
    version: '14.2-mode-driven-skeleton',
  });
})();
