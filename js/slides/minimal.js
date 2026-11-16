import './planner.js'; // initialisation order: this module runs after it

window.SomataSlidePlans.minimal = function ({
  srcAngles,
  dstAngles,
  ns,
  nd,
  bestMap,
  mapTargetsToSources,
  mapSourcesToTargets,
}) {
  let from = [],
    to = [];
  // The best correspondence may walk one polygon backwards. That endpoint's
  // contour profile is then laid along the reversed carrier and has to be
  // mirrored (see mirrorProfileNodes) to keep its authored shape.
  let srcReversed = false,
    dstReversed = false;
  if (ns === nd) {
    const best = bestMap(mapTargetsToSources, Math.max(12, Math.min(96, ns * 2)), ns, true);
    to = dstAngles.slice();
    from = dstAngles.map((_, j) => srcAngles[best.result[j]]);
    srcReversed = best.reverse === true;
  } else if (ns > nd) {
    const best = bestMap(mapSourcesToTargets, Math.max(12, Math.min(96, nd * 2)), nd, true);
    from = srcAngles.slice();
    to = srcAngles.map((_, i) => dstAngles[best.result[i]]);
    dstReversed = best.reverse === true;
  } else {
    const best = bestMap(mapTargetsToSources, Math.max(12, Math.min(96, ns * 2)), ns, true);
    to = dstAngles.slice();
    from = dstAngles.map((_, j) => srcAngles[best.result[j]]);
    srcReversed = best.reverse === true;
  }
  return { from, to, srcReversed, dstReversed };
};
