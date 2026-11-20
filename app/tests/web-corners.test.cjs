// Web corner threads grow continuously; exact spiral arc lookup and multi-orbit projection.
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { declarations } = require('./helpers/source.cjs');

let projected = 0;
const ctx = vm.createContext({
  noteSuppressedError() {},
  nearestWebDistanceOnTable: (table, x, y) => {
    projected++;
    return { distance: 10, x, y: table.y, sq: (y - table.y) ** 2 };
  },
});
vm.runInContext(declarations('webSmoothstep01', 'webCornerThreadBudget', 'buildWebCornerMetrics'), ctx);
const smooth = ctx.webSmoothstep01,
  budget = ctx.webCornerThreadBudget;
for (const s of [10, 20, 30, 950]) {
  const ti = s / 10,
    reach = (x) => Math.min(x, 10 * (ti + 1)) * smooth(budget(x, 10) - ti);
  assert.equal(reach(s - 0.001), 0);
  assert.equal(reach(s), 0);
  assert.ok(reach(s + 0.001) < 0.00001);
}
assert.equal(budget(2000, 10), 96);
const p = {
  closed: false,
  points: [
    { x: 0, y: 0 },
    { x: 3, y: 4 },
    { x: 3, y: 4 },
    { x: 9, y: 12 },
    { x: 12, y: 16 },
  ],
};
const exact = ctx.buildWebCornerMetrics(
  [1, 3].map((i) => ({ pathIndex: 0, pointIndex: i, spiralStrokeCorner: true, inLen: 5, outLen: 5 })),
  [{ total: 20 }],
  [p],
);
assert.deepEqual(
  Array.from(exact, (x) => x.distance),
  [5, 15],
);
assert.equal(projected, 0);
const nearest = ctx.buildWebCornerMetrics(
  [{ x: 10, y: 99, pathIndex: 0, inLen: 5, outLen: 5 }],
  [
    { total: 30, y: 0 },
    { total: 30, y: 100 },
  ],
  [{}, {}],
);
assert.equal(nearest[0].pathIndex, 1);
assert.equal(projected, 2);

vm.runInContext(declarations('drawWebThreads'), ctx);
Object.assign(ctx, {
  // In the app this is the tap-tempo morph interval; the sandbox uses the untapped value.
  getTapMorphIntervalSec: (seconds) => seconds,
  state: { morph: {} },
  webDrawScratch: { pointA: {}, pointB: {} },
  frameGeometryRuntime: { frameId: 1 },
  webRuntime: { lastCleanup: 1, corners: new Map() },
  pointAtWrappedWebDistance: (_t, d, out) => Object.assign(out, { x: d, y: d < 30 ? d : 60 - d }),
});
function draw(span, target = 1) {
  const lengths = [];
  let a;
  const rec = {
    __spiroGLGeometryRecorder: true,
    beginPath() {},
    moveTo(x, y) {
      a = [x, y];
    },
    lineTo(x, y) {
      lengths.push(Math.hypot(x - a[0], y - a[1]));
    },
    stroke() {},
  };
  const prepared = {
    enabled: true,
    cfg: { type: 'bevel' },
    insideEnabled: true,
    placementMode: 'corners',
    spacing: 10,
    depthPercent: 100,
    depthMultiplier: 1,
    width: 0.6,
    renderWidth: 0.6,
    now: 1,
    color: '#fff',
    jitterStrength: 0,
    corners: [{ pathIndex: 0, cornerOrdinal: 0, target, x: 30, y: 30 }],
    cornerMetrics: [{ pathIndex: 0, cornerSpan: span, distance: 30, x: 30, y: 30 }],
    visualPaths: [p],
    visualPathTables: [{ total: 60 }],
  };
  ctx.drawWebThreads(rec, [p], { id: 'test' }, 1, null, prepared, true, 'inside');
  return lengths;
}
assert.ok(Math.abs(draw(9.999)[0] - draw(10)[0]) < 0.003);
assert.deepEqual(draw(10.001), draw(10));
assert.equal(draw(15).length, 2);
assert.ok(draw(15)[1] < draw(20)[1]);
assert.deepEqual(draw(20, 0), []);
assert.equal(ctx.webRuntime.corners.size, 0);
console.log(
  'PASS: corner-thread lengths grow continuously; exact spiral arc lookup and multi-orbit projection',
);
