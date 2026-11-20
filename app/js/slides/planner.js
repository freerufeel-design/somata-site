import '../render/fill-plan.js'; // initialisation order: this module runs after it
import { signedAngleDelta } from '../geometry/morph.js';

window.SomataSlidePlans = Object.create(null);
function buildCircleSlideAnglePlan(srcAngles, dstAngles, slideType = 'minimal') {
  const ns = srcAngles.length,
    nd = dstAngles.length;
  if (!ns || !nd) return { from: [], delta: [], vertexPts: [] };
  let from = [],
    to = [];
  const circleMoveCost = (a, b) => 2 * Math.sin(Math.abs(signedAngleDelta(a, b)) * 0.5);
  const mapTargetsToSources = (offset, reverse = false) => {
    const result = new Array(nd);
    let cost = 0;
    for (let j = 0; j < nd; j++) {
      const phase = (j / nd) * ns + offset;
      const raw = Math.round(phase),
        si = (((reverse ? -raw : raw) % ns) + ns) % ns;
      result[j] = si;
      cost += circleMoveCost(dstAngles[j], srcAngles[si]);
    }
    return { result, cost, reverse };
  };
  const mapSourcesToTargets = (offset, reverse = false) => {
    const result = new Array(ns);
    let cost = 0;
    for (let i = 0; i < ns; i++) {
      const phase = (i / ns) * nd + offset;
      const raw = Math.round(phase),
        di = (((reverse ? -raw : raw) % nd) + nd) % nd;
      result[i] = di;
      cost += circleMoveCost(srcAngles[i], dstAngles[di]);
    }
    return { result, cost, reverse };
  };
  const bestMap = (mapper, probes, span, allowReverse = false) => {
    let best = null;
    const orientations = allowReverse ? [false, true] : [false];
    for (const reverse of orientations)
      for (let k = 0; k < probes; k++) {
        const c = mapper((k * span) / probes, reverse);
        if (!best || c.cost < best.cost) best = c;
      }
    return best;
  };

  const key =
    slideType === 'phase' || slideType === 'minimalSpiral'
      ? 'phase'
      : slideType === 'minimal'
        ? 'minimal'
        : 'sector';
  const plan = window.SomataSlidePlans[key]({
    srcAngles,
    dstAngles,
    ns,
    nd,
    bestMap,
    mapTargetsToSources,
    mapSourcesToTargets,
  });
  from = plan.from;
  to = plan.to;
  const delta = from.map((a, i) => signedAngleDelta(a, to[i]));
  return {
    from,
    delta,
    vertexPts: from.map(() => ({ x: 0, y: 0 })),
    srcReversed: plan.srcReversed === true,
    dstReversed: plan.dstReversed === true,
  };
}

export { buildCircleSlideAnglePlan };
