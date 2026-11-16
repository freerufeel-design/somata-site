import './light.js'; // initialisation order: this module runs after it
import { getEffectiveSpiralOrder } from '../../geometry/spiral/order-params.js';

(() => {
  const { stableSpiralPairs } = SomataPhaseMatching;
  const { shortestAngleDelta } = SomataRotationMath;
  const mix = (a, b, t) => a + (b - a) * t;
  const smooth = (t) => t * t * (3 - 2 * t);
  // Keep zero/handedness crossings on their own transport. At high order,
  // clone/merge follows the 13.2 cyclic pairing, not coordinated beta.
  function usesCloneTransport(a, b) {
    const x = getEffectiveSpiralOrder(a),
      y = getEffectiveSpiralOrder(b);
    return x * y > 0 && Math.max(Math.abs(x), Math.abs(y)) > 1 + 1e-8;
  }
  function windingPairs({ a, b, source, target }) {
    const independent = a.spiralTwist !== true && b.spiralTwist !== true;
    const sameFamily = independent || (a.spiralTwist === true && b.spiralTwist === true);
    if (!sameFamily) return null;
    const rails = (rings) =>
      independent
        ? rings.flatMap((ring) =>
            ring.points.map((point) => ({
              ...ring,
              spiralBranchIndex: point.polygonIndex,
              points: [point],
            })),
          )
        : rings.map((ring) => ({ ...ring, spiralBranchIndex: ring.points[0]?.polygonIndex }));
    const src = rails(source),
      dst = rails(target);
    if (!src.length || !dst.length) return null;
    // Repeated endpoints are intentional. Each extra rail has one real
    // endpoint and a full-sized clone of the shared rail at the other.
    const plans = stableSpiralPairs(src, dst, a, b).map((pair, i) => {
      const from = pair.src.points,
        to = pair.dst.points;
      const n = Math.max(from.length, to.length);
      const nodes = Array.from({ length: n }, (_, j) => {
        const k = Math.floor((j * from.length) / n),
          l = Math.floor((j * to.length) / n);
        const p = from[k],
          q = to[l];
        const theta = Math.atan2(p.y, p.x),
          dest = Math.atan2(q.y, q.x);
        const turn = shortestAngleDelta(theta, dest);
        const delta = Math.abs(Math.abs(turn) - Math.PI) < 1e-12 ? Math.sign(dest - theta) * Math.PI : turn;
        return {
          id: `phase-circle:${i}:${j}`,
          theta,
          delta,
          r0: Math.hypot(p.x, p.y),
          r1: Math.hypot(q.x, q.y),
          u0: k / from.length,
          u1: l / to.length,
        };
      });
      return { pair, nodes };
    });
    return (t) => {
      if (t === 0 || t === 1) return t === 0 ? source : target;
      return plans.map(({ pair, nodes }, i) => {
        const { sourcePathPresent, targetPathPresent } = pair;
        const closed = t < 0.5 ? pair.src.closed : pair.dst.closed;
        const phaseFollower = !sourcePathPresent ? 'split' : !targetPathPresent ? 'merge' : undefined;
        // Blend only the duplicate at contact. The parent rail stays
        // opaque and the duplicate tracks the whole angular trajectory.
        const alpha = !sourcePathPresent
          ? smooth(Math.min(1, t * 4))
          : !targetPathPresent
            ? smooth(Math.min(1, (1 - t) * 4))
            : 1;
        return {
          orbitIndex: i,
          closed,
          spiralConnected: closed,
          alpha,
          phaseFollower,
          singleReferenceBranch: independent,
          points: nodes.map(({ id, theta, delta, r0, r1, u0, u1 }) => {
            const angle = theta + delta * t,
              r = mix(r0, r1, t);
            return { id, x: r * Math.cos(angle), y: r * Math.sin(angle), windingU: mix(u0, u1, t) };
          }),
        };
      });
    };
  }
  window.SomataMorphRegistry.register('phaseCircle', {
    corridorPhase: true,
    style: 'phase-circle',
    spiral: true,
    usesCloneTransport,
    polygonVertex: (...args) => SomataMorphMath.angular(...args),
    polygonPlan: (ctx) =>
      SomataMorphMath.polygonCorrespondence(ctx.spiralMorph ? { ...ctx, slide: 'phase' } : ctx, {
        pairing: 'cycle',
        phaseOnOrbitChange: true,
      }),
    prepareAnchors(ctx, h) {
      const clone = usesCloneTransport(ctx.a, ctx.b) ? windingPairs(ctx) : null;
      const fallback = () => h.polygon(ctx, this.polygonVertex.bind(this), this.polygonPlan(ctx));
      if (!clone) return fallback();
      // An independent order edit can temporarily take the current
      // Blue phase through zero even if both Blue endpoints are wound.
      let planar;
      return (t, frame) => {
        const crossing = frame?.orderTransition;
        if (
          (frame?.order != null && Math.abs(frame.order) < 1e-8) ||
          (crossing && crossing.from * crossing.to <= 0)
        ) {
          planar ??= fallback();
          return planar ? planar(t) : [];
        }
        return clone(t);
      };
    },
  });
})();
