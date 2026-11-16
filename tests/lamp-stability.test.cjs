// New lamps start dark, overlapping lights share intensity, separation ramps, and GPU arc
// placeholders do not collapse unrelated paths.
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { moduleAsScript } = require('./helpers/source.cjs');

const apply = vm.runInNewContext(
  moduleAsScript('js/render/lamp-stability.js') + '\nSomataLampStability.apply',
  { window: {}, noteSuppressedError() {} },
);
const lamp = (id, px = 0) => ({ lampTraceId: id, px, py: 0, intensityAlpha: 1 });
const run = (t, lamps, animate = true, arc = false, scope = 'layer') => {
  const stats = apply(scope, lamps, { now: t, duration: 100, animate, arc });
  return { stats, levels: lamps.map((p) => p.intensityAlpha) };
};
assert.deepEqual(run(0, [lamp('old')], false).levels, [1]);
let r = run(16, [lamp('old'), lamp('new')]);
assert.deepEqual(r.levels, [1, 0]);
assert.equal(r.stats.rawOverlap, 2);
assert.equal(r.stats.maxMultiplicity, 2);
r = run(32, [lamp('old'), lamp('new')]);
assert.ok(Math.abs(r.levels.reduce((a, b) => a + b, 0) - 1) < 1e-10);
assert.ok(r.levels[1] > 0 && r.levels[1] < 0.16);
r = run(48, [lamp('old'), lamp('new', 2)]);
assert.deepEqual(r.levels, [1, 0.32]);
r = run(64, [lamp('old')]);
assert.equal(r.levels[0], 1);
const arcLamp = (id, i) => ({
  ...lamp(id),
  pathIndex: i,
  lampAttachFraction: 0.5,
  gpuLampOffsetX: 0,
  gpuLampOffsetY: 0,
});
assert.deepEqual(run(0, [arcLamp('a', 0), arcLamp('b', 1)], false, true, 'arc').levels, [1, 1]);
assert.deepEqual(run(16, [arcLamp('a', 0), arcLamp('b', 0)], false, true, 'arc').levels, [0.5, 0.5]);
console.log(
  'PASS: new lamps start dark, overlapping lights share intensity, separation ramps, and GPU arc placeholders do not collapse unrelated paths',
);
