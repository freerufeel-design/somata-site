import './phaseCircle.js'; // initialisation order: this module runs after it
import { getEffectiveSpiralOrder } from '../../geometry/spiral/order-params.js';

// Stage10 uses one-to-one branch assignment and geometric birth/retirement.
window.SomataCoordinatedRules = (() => {
  const { spiralBranchPhase, signedUnitDelta } = SomataPhaseMatching;
  const pairTornWithoutClones = (...args) => SomataBranchMatching.pairPlanarOneToOne(...args);
  function pairCoordinatedStage10(sourcePaths, targetPaths, sourceLayer, targetLayer, slide = 'minimal') {
    if (slide === 'minimal') return pairTornWithoutClones(sourcePaths, targetPaths, sourceLayer, targetLayer);
    const src = (sourcePaths || [])
      .map((path, i) => ({ path, i, phase: spiralBranchPhase(path, sourceLayer, i, sourcePaths.length) }))
      .sort((a, b) => a.phase - b.phase || a.i - b.i);
    const dst = (targetPaths || [])
      .map((path, i) => ({ path, i, phase: spiralBranchPhase(path, targetLayer, i, targetPaths.length) }))
      .sort((a, b) => a.phase - b.phase || a.i - b.i);
    const matched = [],
      takenSrc = new Set(),
      takenDst = new Set(),
      limit = Math.min(src.length, dst.length);
    const append = (a, b) => {
      if (takenSrc.has(a.i) || takenDst.has(b.i)) return false;
      takenSrc.add(a.i);
      takenDst.add(b.i);
      matched.push({
        src: a.path,
        dst: b.path,
        sourcePathPresent: true,
        targetPathPresent: true,
        stableSpiralPairing: true,
        coordinatedSlide: slide,
      });
      return true;
    };
    if (slide === 'phase') {
      for (let j = 0; j < limit; j++) {
        const si = Math.min(src.length - 1, Math.floor(((j + 0.5) * src.length) / limit));
        const di = Math.min(dst.length - 1, Math.floor(((j + 0.5) * dst.length) / limit));
        append(src[si], dst[di]);
      }
    } else if (slide === 'sector') {
      const choices = [];
      for (const a of src)
        for (const b of dst) {
          const sa = Math.min(7, Math.floor(a.phase * 8)),
            sb = Math.min(7, Math.floor(b.phase * 8));
          const diff = Math.abs(signedUnitDelta(a.phase, b.phase));
          choices.push({ a, b, cost: (sa === sb ? 0 : 1) + diff * diff + 1e-9 * (a.i * dst.length + b.i) });
        }
      choices.sort((a, b) => a.cost - b.cost);
      for (const c of choices) {
        if (matched.length >= limit) break;
        append(c.a, c.b);
      }
    }
    for (const a of src)
      if (!takenSrc.has(a.i))
        matched.push({
          src: a.path,
          dst: a.path,
          sourcePathPresent: true,
          targetPathPresent: false,
          coordinatedUnmatched: true,
        });
    for (const b of dst)
      if (!takenDst.has(b.i))
        matched.push({
          src: b.path,
          dst: b.path,
          sourcePathPresent: false,
          targetPathPresent: true,
          coordinatedUnmatched: true,
        });
    return matched;
  }
  // Stage 4: a surplus rail is no longer opacity-faded.  It starts (or ends)
  // as a *zero-length geometric germ*, attached to a sampled point on an
  // existing, matched rail. The germ has its own object and DOES NOT duplicate
  // any physical source/target rail or wind around the center as a clone.
  // This guarantees a continuous parametrized rail, NOT arbitrary graph
  // topology (connections between different rails can still change).
  // Choose the real neighboring branch on the side where the new/retiring
  // branch exists, then retain the same arc fraction on its matched mate.
  // A nearest WORLD-SPACE point on the opposite endpoint can be unrelated to
  // the branch after the parent moves and makes the germ look free-floating.
  // Stage 17: parent selection is TOPOLOGICAL, not globally nearest in XY.
  // A shortest-distance search alone repeatedly chooses the same coil (often
  // branch zero near the common root), producing ghost turns and lamp piles.
  // We first choose a neighboring angular branch, balance attachments across
  // the existing rails, then find the nearest point ON that chosen neighbor.
  const spiralTime = (t) => t * t * (3 - 2 * t);
  return Object.freeze({
    spiralTime,
    pairSpirals: pairCoordinatedStage10,
    pairCyclic: SomataBranchMatching.pairCyclicBySlide,
  });
})();
// One ordered carrier, even if the authored star changes gcd(N,K).
// Reuse the vertices of each suborbit once. Pair vertex slots, not turns.
// A repeated slot is a zero-length edge at an endpoint, never another turn.
window.SomataCoordinatedSpine = (() => {
  const mix = (a, b, t) => a + (b - a) * t;
  const angle = (p) => Math.atan2(p.y, p.x);
  const delta = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
  const order = (paths) => paths.flatMap((p) => p.points);
  function plan(source, target) {
    const a = order(source),
      b = order(target),
      n = Math.max(a.length, b.length);
    if (Math.min(a.length, b.length) < 2) return null;
    const closed = [source, target].every((paths) => paths.every((p) => p.closed));
    const at = (i, length) => Math.floor((i * length) / n);
    // Do not shift the root around the orbit to find a match. Rephasing
    // is the job of beta about the chosen Corridor focus, not topology.
    const slots = Array.from({ length: n }, (_, i) => {
      const ai = at(i, a.length),
        bi = at(i, b.length),
        p = a[ai],
        q = b[bi];
      const theta = angle(p);
      return {
        p,
        q,
        theta,
        phase: delta(theta, angle(q)),
        r0: Math.hypot(p.x, p.y),
        r1: Math.hypot(q.x, q.y),
        u0: ai / a.length,
        u1: bi / b.length,
      };
    });
    return (t, frame) => [
      {
        orbitIndex: 0,
        closed,
        spiralConnected: closed,
        coordinatedSpine: true,
        points: slots.flatMap(({ p, q, theta, phase, r0, r1, u0, u1 }, i) => {
          // At a phase endpoint a repeated slot has zero length. Leaving
          // it in the path interrupts the fillet between real neighbors.
          if (frame?.compactRoundedEndpoint && i > 0 &&
              ((t === 0 && p === slots[i - 1].p) || (t === 1 && q === slots[i - 1].q)))
            return [];
          const r = mix(r0, r1, t),
            phi = theta + t * phase;
          const xy = t === 0 ? p : t === 1 ? q : { x: r * Math.cos(phi), y: r * Math.sin(phi) };
          return [{
            x: xy.x,
            y: xy.y,
            id: `coordinated:${i}`,
            polygonIndex: (t < 0.5 ? p : q).polygonIndex,
            windingU: mix(u0, u1, t),
          }];
        }),
      },
    ];
  }
  // The 13.2 carrier is a collection of authored periods, not a polygon
  // with its last vertex redirected to the next Corridor position.
  function referencePlan(source, target) {
    const ordered = (paths) =>
      order(paths)
        .slice()
        .sort((a, b) => a.polygonIndex - b.polygonIndex);
    const a = ordered(source),
      b = ordered(target);
    if (!a.length || !b.length) return null;
    const closed = source.every((p) => p.closed) && target.every((p) => p.closed);
    const n = Math.min(a.length, b.length);
    const pairs = [],
      usedA = new Set(),
      usedB = new Set();
    for (let i = 0; i < n; i++) {
      const ai = Math.floor((i * a.length) / n),
        bi = Math.floor((i * b.length) / n);
      pairs.push([a[ai], b[bi]]);
      usedA.add(ai);
      usedB.add(bi);
    }
    a.forEach((p, i) => {
      if (!usedA.has(i)) pairs.push([p, null]);
    });
    b.forEach((p, i) => {
      if (!usedB.has(i)) pairs.push([null, p]);
    });
    return (t) => {
      const u = t * t * (3 - 2 * t);
      const points = pairs.flatMap(([p, q], i) => {
        // Only a genuinely unmatched authored branch opens/closes,
        // at the invariant pole of the period transform. No branch
        // starts as a full-size copy of its neighbor.
        const life = !p ? u : !q ? 1 - u : 1;
        if (life === 0) return [];
        const start = p ?? q,
          end = q ?? p,
          theta = angle(start);
        const r = life * mix(Math.hypot(start.x, start.y), Math.hypot(end.x, end.y), u);
        const phi = theta + u * delta(theta, angle(end));
        const xy = t === 0 ? start : t === 1 ? end : { x: r * Math.cos(phi), y: r * Math.sin(phi) };
        return [
          {
            x: xy.x,
            y: xy.y,
            id: `coordinated:reference:${i}`,
            polygonIndex: (t < 0.5 ? start : end).polygonIndex,
            profileLife: life,
          },
        ];
      });
      return [
        {
          orbitIndex: 0,
          closed,
          spiralConnected: closed,
          coordinatedSpine: true,
          coordinatedReference: true,
          points,
        },
      ];
    };
  }
  // Split ordered branch slots. At the sparse endpoint there is exactly
  // one rendered rail per authored vertex; a surplus slot shares that rail's
  // phase before separating. No radial ingress, transparency, or Corridor
  // population changes are needed. The correspondence is reversible.
  function offsetPlan(source, target) {
    const ordered = (paths) =>
      order(paths)
        .slice()
        .sort((a, b) => a.polygonIndex - b.polygonIndex);
    const a = ordered(source),
      b = ordered(target);
    if (!a.length || !b.length) return null;
    const closed = source.every((p) => p.closed) && target.every((p) => p.closed);
    const n = Math.max(a.length, b.length),
      slot = (i, size) => Math.floor((i * size) / n);
    const slots = Array.from({ length: n }, (_, i) => {
      const ai = slot(i, a.length),
        bi = slot(i, b.length),
        p = a[ai],
        q = b[bi];
      const theta = angle(p);
      return {
        p,
        q,
        theta,
        dtheta: delta(theta, angle(q)),
        r0: Math.hypot(p.x, p.y),
        r1: Math.hypot(q.x, q.y),
        fromShared: i > 0 && ai === slot(i - 1, a.length),
        toShared: i > 0 && bi === slot(i - 1, b.length),
      };
    });
    return (t) => {
      const points = slots.flatMap(({ p, q, theta, dtheta, r0, r1, fromShared, toShared }, i) => {
        if ((t === 0 && fromShared) || (t === 1 && toShared)) return [];
        const r = mix(r0, r1, t),
          phi = theta + t * dtheta;
        const xy = t === 0 ? p : t === 1 ? q : { x: r * Math.cos(phi), y: r * Math.sin(phi) };
        return [
          { x: xy.x, y: xy.y, id: `coordinated:offset:${i}`, polygonIndex: (t < 0.5 ? p : q).polygonIndex },
        ];
      });
      return [
        {
          orbitIndex: 0,
          closed,
          spiralConnected: closed,
          coordinatedSpine: true,
          coordinatedReference: true,
          alpha: 1,
          points,
        },
      ];
    };
  }
  return Object.freeze({ plan, referencePlan, offsetPlan });
})();
window.SomataMorphRegistry.register('coordinated', {
  corridorPhase: true,
  style: 'coordinated',
  spiral: true,
  polygonTime(t, i) {
    return Math.max(0, Math.min(1, t + 0.2 * Math.sin(Math.PI * t) * Math.sin(i * 0.37)));
  },
  polygonVertex(pp, i, t, r, source, target, movement) {
    const sample = movement === 'linear' ? SomataMorphMath.linear : SomataMorphMath.angular;
    return sample(pp, i, this.polygonTime(t, i), r);
  },
  polygonPlan: (ctx) =>
    SomataMorphMath.polygonCorrespondence(ctx, { pairing: 'cycle', phaseOnOrbitChange: false }),
  prepareAnchors(ctx, h) {
    if (ctx.spiralMorph) {
      const a = getEffectiveSpiralOrder(ctx.a),
        b = getEffectiveSpiralOrder(ctx.b);
      if (a * b > 0 && ctx.a.spiralTwist !== true && ctx.b.spiralTwist !== true)
        return SomataCoordinatedSpine.offsetPlan(ctx.source, ctx.target);
      return SomataCoordinatedSpine.plan(ctx.source, ctx.target);
    }
    return h.polygon(ctx, this.polygonVertex.bind(this), this.polygonPlan(ctx));
  },
});
const coordinatedSmooth = (a, b, t) => {
  const x = Math.max(0, Math.min(1, (Number(t) - a) / (b - a)));
  return x * x * (3 - 2 * x);
};
window.SomataCoordinatedFinish = Object.freeze({
  collapseScale(t) {
    return 1 - coordinatedSmooth(0, 1, t);
  },

  widthTime(t) {
    return coordinatedSmooth(0.92, 1, t);
  },

  attachmentProgress(t) {
    return coordinatedSmooth(0, 1, t);
  },

  ingress(_t, _radius) {
    return 0;
  },
});
