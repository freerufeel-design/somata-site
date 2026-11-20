import './minimal.js'; // initialisation order: this module runs after it

window.SomataSlidePlans.sector = function ({
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
  if (ns > nd && ns % nd === 0) {
    const ratio = ns / nd;
    from = srcAngles.slice();
    to = new Array(ns);
    for (let j = 0; j < nd; j++) {
      const center = dstAngles[j],
        start = Math.round(j * ratio - ratio / 2);
      for (let q = 0; q < ratio; q++) {
        const si = (((start + q) % ns) + ns) % ns;
        to[si] = center;
      }
    }
  } else if (nd > ns && nd % ns === 0) {
    const ratio = nd / ns;
    to = dstAngles.slice();
    from = new Array(nd);
    for (let j = 0; j < ns; j++) {
      const center = srcAngles[j],
        start = Math.round(j * ratio - ratio / 2);
      for (let q = 0; q < ratio; q++) {
        const di = (((start + q) % nd) + nd) % nd;
        from[di] = center;
      }
    }
  } else if (ns > nd) {
    from = srcAngles.slice();
    to = srcAngles.map((_, i) => dstAngles[Math.floor((i * nd) / ns)]);
  } else {
    to = dstAngles.slice();
    from = dstAngles.map((_, j) => srcAngles[Math.floor((j * ns) / nd)]);
  }
  return { from, to };
};
