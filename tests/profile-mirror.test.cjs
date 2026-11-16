// A contour profile is laid along the carrier and measured from its walking direction. The Minimal slide may
// walk an endpoint's polygon backwards; the plan reports that, and the unified runtime then mirrors that
// endpoint's profile, so its authored contour is the same at t = 0 / 1 (exact anchors) and just inside them.
const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const { declarations, moduleAsScript } = require('./helpers/source.cjs');

const deg = (d) => (d * Math.PI) / 180;
const ring = (n, from = 0, step = 1) => Array.from({ length: n }, (_, i) => deg(from + (360 / n) * i * step));

function planFor(src, dst) {
  const ctx = vm.createContext({ window: { SomataSlidePlans: Object.create(null) }, Math });
  vm.runInContext(declarations('signedAngleDelta'), ctx);
  // planner.js defines the plan registry and buildCircleSlideAnglePlan; minimal.js registers the plan.
  vm.runInContext(moduleAsScript('js/slides/planner.js'), ctx);
  vm.runInContext(moduleAsScript('js/slides/minimal.js'), ctx);
  ctx.src = src;
  ctx.dst = dst;
  return vm.runInContext(`buildCircleSlideAnglePlan(src, dst, 'minimal')`, ctx);
}

test('Minimal plan: same direction needs no reversal', () => {
  for (const [ns, nd] of [
    [8, 8],
    [8, 14],
    [14, 8],
  ]) {
    const plan = planFor(ring(ns), ring(nd));
    assert.equal(plan.srcReversed, false, `${ns} -> ${nd} src`);
    assert.equal(plan.dstReversed, false, `${ns} -> ${nd} dst`);
  }
});

test('Minimal plan: the endpoint that is walked backwards is reported', () => {
  // Target runs the other way round: the (shorter or equal) source is the one reversed.
  const toSmaller = planFor(ring(8), ring(14, 0, -1));
  assert.equal(toSmaller.srcReversed, true);
  assert.equal(toSmaller.dstReversed, false);
  const equal = planFor(ring(8), ring(8, 0, -1));
  assert.equal(equal.srcReversed, true);
  // Source has more vertices: the target is mapped onto it, so the target is the one reversed.
  const toLarger = planFor(ring(14), ring(8, 0, -1));
  assert.equal(toLarger.srcReversed, false);
  assert.equal(toLarger.dstReversed, true);
});

test('mirrored profile keeps the authored contour on a reversed carrier', () => {
  const ctx = vm.createContext({
    setPreSampledSplineLayer(layer, on) {
      layer.__sampled = on;
    },
    isPreSampledSplineLayer: (layer) => layer.__sampled === true,
  });
  vm.runInContext(declarations('mirrorProfileNodes', 'withMirroredProfile'), ctx);
  const profile = [
    { x: 0, y: 0 },
    { x: 0.3, y: 0.4 },
    { x: 0.5, y: 0.5 },
    { x: 1, y: 0 },
  ];
  ctx.layer = {
    profileNodes: profile,
    __lampLogicalCornerFlags: [true, false, false, true],
    __sampled: true,
  };
  const m = vm.runInContext('withMirroredProfile(layer)', ctx);
  // 180 degrees about the middle of the chord: order reversed, x -> 1 - x, y -> -y
  const expected = [
    [0, 0],
    [0.5, -0.5],
    [0.7, -0.4],
    [1, 0],
  ];
  m.profileNodes.forEach((p, i) => {
    assert.ok(Math.abs(p.x - expected[i][0]) < 1e-12 && Math.abs(p.y - expected[i][1]) < 1e-12, `node ${i}`);
  });
  assert.deepEqual(m.__lampLogicalCornerFlags, [true, false, false, true].reverse());
  assert.equal(m.__sampled, true);
  // The authored layer is not touched, and mirroring twice returns the original profile.
  assert.deepEqual(ctx.layer.profileNodes, profile);
  const twice = vm.runInContext('withMirroredProfile(withMirroredProfile(layer))', ctx);
  twice.profileNodes.forEach((p, i) => {
    assert.ok(Math.abs(p.x - profile[i].x) < 1e-12 && Math.abs(p.y - profile[i].y) < 1e-12, `node ${i}`);
  });
});
