// SomataJumpTrace: frame gaps, line and skeleton jumps, Corridor transforms, phase metadata,
// missing CPU route and opt-in capture; the Glint scratch target blends with max coverage.
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { read, moduleAsScript } = require('./helpers/source.cjs');

let now = 0,
  clock = { active: true, phaseStart: 0, durationMs: 100, phaseSerial: 1 };
const ctx = {
  window: { __somataBlueMorphPhaseClock: () => clock },
  performance: { now: () => now },
  setTimeout: () => 1,
  clearTimeout: () => {},
  mainCtx: { getTransform: () => ({ a: 1, b: 0 }) },
  state: { tunnel: { active: true } },
  getMotionTunnelLagRadians: (c) => c.angle,
  SomataGeometryPolicy: { isStrict: () => false },
  SomataFrameContourService: { current: (f) => f.contour },
  noteSuppressedError() {},
};
vm.runInNewContext(moduleAsScript('js/app/jump-trace.js'), ctx);
const trace = ctx.window.SomataJumpTrace;
const points = (x) => [
  {
    branchId: 'a',
    points: [
      { x, y: 0 },
      { x: x + 10, y: 0 },
    ],
  },
];
function frame(frameId, x, scale, extra = {}, lamp) {
  const f = {
    frameId,
    layer: { id: 'layer', N: 4, K: 1, spiralOrder: 1 },
    layerIndex: 0,
    contour: { paths: points(x) },
    __somataSkeletonFrame: points(x),
    visibleInstances: { copies: [{ scale, angle: 0, copyId: 1 }], alphas: [1] },
    ...extra,
  };
  if (lamp) trace.observeLamps(f, 0, lamp, 1, f.visibleInstances);
  trace.sample(f);
}
frame(0, 0, 1);
assert.equal(trace.summary(), null);
trace.start({ seconds: 30, thresholdPx: 10 });
frame(1, 0, 1);
now = 16;
frame(2, 1, 1);
assert.deepEqual(Object.keys(trace.summary().counts), []);
now = 102;
clock = { ...clock, phaseStart: 100, phaseSerial: 2 };
frame(3, 40, 2);
for (const k of ['frame-gap', 'copy-jump', 'line-jump', 'skeleton-jump'])
  assert.equal(trace.summary().counts[k], 1);
assert.equal(trace.report().events.find((e) => e.kind === 'line-jump').phaseSerial, 2);
now = 118;
frame(4, 40, 2, { contour: null, __somataSkeletonFrame: null });
assert.equal(trace.summary().counts['geometry-route'], 1);
trace.mark();
trace.stop();
frame(5, 120, 1);
assert.equal(trace.summary().samples, 4);
assert.equal(trace.report().markers.length, 1);
trace.start({ thresholdLight: 0.2 });
const lamp = {
  count: 1,
  rawPeak: 0.5,
  rawOverlap: 0.5,
  maxMultiplicity: 1,
  peak: 0.5,
  positionSource: 'cpu-visual-centres',
};
const glint = (brightness) => ({
  effectsPlan: {
    sweep: {
      instances: [
        {
          effectType: 'glint',
          frameData: { canonicalGPU: true, glintVisual: { brightness, opacity: 1, strength: 0 } },
        },
      ],
    },
  },
});
frame(10, 0, 1, glint(0.5), lamp);
now += 16;
frame(11, 0, 1, glint(0.8), { ...lamp, count: 2, maxMultiplicity: 2, rawOverlap: 1, peak: 0.52 });
for (const k of ['lamp-overlap', 'lamp-raw-brightness-rise', 'glint-gain-rise'])
  assert.equal(trace.summary().counts[k], 1);
assert.equal(trace.summary().counts['lamp-brightness-rise'], undefined);
now += 16;
frame(12, 0, 1, glint(0.8), { ...lamp, peak: 0.9 });
assert.equal(trace.summary().counts['lamp-brightness-rise'], 1);
trace.stop();

// Glint scratch target: max blending for colour and alpha (compared without whitespace/trailing commas).
const compact = (s) => s.replace(/\s+/g, '').replace(/,([}\]])/g, '$1');
assert.ok(
  compact(read('js/gpu/canonical-sweep-renderer.js')).includes(
    "consttarget={format,blend:{color:{srcFactor:'one',dstFactor:'one',operation:'max'},alpha:{srcFactor:'one',dstFactor:'one',operation:'max'}}}",
  ),
);
console.log(
  'PASS: frame gaps, line and skeleton jumps, Corridor transforms, phase metadata, missing CPU route and opt-in capture; Glint scratch uses max coverage',
);
