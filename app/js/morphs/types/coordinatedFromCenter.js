import './coordinated.js'; // initialisation order: this module runs after it
import { getEffectiveSpiralOrder } from '../../geometry/spiral/order-params.js';

// Preserve the 14.2 center-origin geometry as its own selectable morph.
const coordinatedFromCenterBase = SomataMorphRegistry.get('coordinated');
const { id: coordinatedFromCenterBaseId, ...coordinatedFromCenterRule } = coordinatedFromCenterBase;
window.SomataMorphRegistry.register('coordinatedFromCenter', {
  ...coordinatedFromCenterRule,
  prepareAnchors(ctx, h) {
    if (ctx.spiralMorph) {
      const a = getEffectiveSpiralOrder(ctx.a),
        b = getEffectiveSpiralOrder(ctx.b);
      if (a * b > 0 && ctx.a.spiralTwist !== true && ctx.b.spiralTwist !== true)
        return SomataCoordinatedSpine.referencePlan(ctx.source, ctx.target);
    } else if (ctx.source.length !== ctx.target.length) {
      const { source, target } = ctx;
      const matched = Math.min(source.length, target.length);
      const growing = target.length > source.length;
      const unmatched = (growing ? target : source).slice(matched);
      // Keep the existing correspondence for surviving orbits. Do not
      // cycle the shorter list to populate the surplus orbit slots.
      const plan = SomataMorphMath.polygonCorrespondence(ctx, {
        pairing: 'matched',
        phaseOnOrbitChange: false,
      });
      const sample = h.polygon(ctx, this.polygonVertex.bind(this), plan);
      if (!sample) return null;
      return (t) => {
        const paths = sample(t);
        if (t === 0 || t === 1) return paths;
        const u = growing ? t : 1 - t;
        const scale = u * u * (3 - 2 * u);
        const lifecycle = growing ? 'birth' : 'death';
        // Local (0,0) is the authored polygon center, before any
        // layer or Corridor transform. Grow the authored orbit itself
        // from that point, at full opacity, without a cloned ring.
        return paths.concat(
          unmatched.map((ring, i) => ({
            ...ring,
            orbitIndex: matched + i,
            alpha: 1,
            lifecycle,
            strokeGrowth: scale,
            points: ring.points.map((p, j) => ({
              ...p,
              id: `coordinated:center:${lifecycle}:${i}:${j}`,
              profileLife: scale,
              x: p.x * scale,
              y: p.y * scale,
            })),
          })),
        );
      };
    }
    return coordinatedFromCenterBase.prepareAnchors.call(this, ctx, h);
  },
});
