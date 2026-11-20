import './sector.js'; // initialisation order: this module runs after it

window.SomataSlidePlans.phase = function ({
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
  if (ns === nd) {
    from = srcAngles.slice();
    to = dstAngles.slice();
  } else if (ns > nd) {
    from = srcAngles.slice();
    to = srcAngles.map((_, i) => dstAngles[Math.min(nd - 1, Math.floor((i * nd) / ns))]);
  } else {
    to = dstAngles.slice();
    from = dstAngles.map((_, j) => srcAngles[Math.min(ns - 1, Math.floor((j * ns) / nd))]);
  }
  return { from, to };
};
