// Run from any directory: node tests/morph-skeleton.test.cjs
// Behavioural suite for skeleton, morph types, spiral order transitions, Corridor seams and lamps.
// Real application functions run in this process's global scope with small stubs around them;
// functions are fetched by name (tests/helpers/source.cjs), not by cutting text out of files.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {
  ROOT: root,
  read,
  declarations,
  moduleAsScript,
  moduleOrder,
  listModules,
} = require('./helpers/source.cjs');
const run = (code, filename) => vm.runInThisContext(code, { filename });
const load = (file) => run(moduleAsScript(file), file);
// Empty catch blocks report to core/suppressed-errors.js in the app; the sandbox ignores them.
global.noteSuppressedError = () => {};
// The app always has these; earlier the sandbox relied on `typeof` guards that skipped them.
// Each stub reproduces exactly what the guarded fallback did.
{
  let n = 0;
  global.layerGeometrySignature = () => `sandbox-${++n}`;
} // unique key = no cache reuse (was: key null)
global.isCurrentFrameDynamicPathList = () => false; // was: typeof guard -> false
global.getLayerVersions = (layer) => ({ geometry: layer?._geometryVersion }); // was: fallback to layer._geometryVersion
global.window = global;
global.addEventListener = () => {};
global.profileCanvas = { addEventListener() {} };
global.document = {
  addEventListener() {},
  getElementById() {
    return { addEventListener() {} };
  },
};
// Application modules in initialisation order (index.html now loads js/main.js only).
const scripts = moduleOrder();
assert(scripts.every((file) => fs.existsSync(path.join(root, file))));
const morphFiles = fs
  .readdirSync(path.join(root, 'js/morphs/types'))
  .map((name) => `js/morphs/types/${name}`)
  .sort();
assert.deepEqual(fs.readdirSync(path.join(root, 'js/morphs')), ['types']);
assert.deepEqual(scripts.filter((f) => f.startsWith('js/morphs/')).sort(), morphFiles);
assert.equal(morphFiles.length, 7);
for (const file of scripts.filter((f) =>
  /^js\/(slides\/|morphs\/types\/|morph-runtime\/(registry|unified-runtime)\.js$|render\/morph-anchor-renderer\.js$|geometry\/(morph-math|skeleton-runtime|spiral-order-builder)\.js$)/.test(
    f,
  ),
)) {
  if (morphFiles.includes(file)) {
    const before = SomataMorphRegistry.ids().length;
    load(file);
    assert.equal(SomataMorphRegistry.ids().length, before + 1, file);
    assert.equal(SomataMorphRegistry.ids().at(-1), path.basename(file, '.js'));
  } else load(file);
}
assert.equal(SomataMorphRegistry.get('torn'), null);
assert.equal(typeof SomataBranchMatching.pairPlanarOneToOne, 'function');
// No DOM/GPU: run real source functions for authored graphs and polygon
// correspondence, stubbing only the application's state, radius and Corridor.
const KERNEL_MODULES = [
  'js/geometry/profile-model.js',
  'js/ui/profile-editor.js',
  'js/geometry/artwork-extent.js',
  'js/geometry/fourier.js',
  'js/geometry/spline-rounding.js',
  'js/geometry/spiral/polyline.js',
  'js/geometry/spiral/fillets.js',
  'js/geometry/spiral/bezier-carrier.js',
  'js/geometry/spiral/effect-rails.js',
  'js/render/spiral-stroke.js',
  'js/geometry/spiral/order-params.js',
  'js/ui/profile-topology-badge.js',
  'js/geometry/spiral/profile-prep.js',
  'js/geometry/spiral/carrier.js',
  'js/geometry/chaos-star.js',
  'js/geometry/orbit-builder.js',
];
const select = (s, a, b) => s.slice(s.indexOf(a), s.indexOf(b, s.indexOf(a) + 1));
run(
  `
    const state={morph:{unifiedMode:'circleSlide'},tunnel:{},fourierMode:false};
    const runtimeState={morph:{}};
    const circleMorphPlanCache=new Map();
    const gcd=(a,b)=>b?gcd(b,a%b):a;
    const angularDistance=(a,b)=>Math.abs(signedAngleDelta(a,b));
    const getEffectiveLayerRadius=l=>l.radius*(l.radiusMultiplier??1);
    const somataWithFourierLayer=(_l,f)=>f();
    const getRoundingStrength=x=>x||0;
    const getTunnelDistanceFactor=()=>1;
    const sampledLayers=new WeakSet();
    const isPreSampledSplineLayer=l=>sampledLayers.has(l);
    const setPreSampledSplineLayer=(l,v)=>v?sampledLayers.add(l):sampledLayers.delete(l);
    const getExtraRoundingStrength=()=>0;
`,
  'test state',
);
run(KERNEL_MODULES.map(moduleAsScript).join('\n'), 'geometry kernel');
load('js/geometry/spline.js');
run(declarations('resolveExactPolygonMorphEndpoint'), 'authored profile resolver');
run(declarations('getLayerFrameAuxiliaryPaths'), 'effects carrier reader');
run(
  declarations(
    'buildCircleAnchors',
    'signedAngleDelta',
    'rephaseAngleSequenceToReference',
    'representativeChordLength',
    'morphDuplicateEdgeSlots',
    'circleMorphPlanKey',
    'getCircleMorphPlan',
  ),
  'polygon planner',
);
load('js/gpu/spiral-bezier-morph-renderer.js'); // Detect missing aliases/dependency ordering.
const sk = SomataSkeletonRuntime,
  rt = SomataMorphRuntime;
const layer = (patch = {}) => ({
  N: 5,
  K: 1,
  rotation: 0,
  radius: 100,
  closedLoop: true,
  spiralClosed: true,
  profileMode: 'segments',
  profileNodes: [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
  ],
  spiralEnabled: false,
  spiralOrder: 0,
  spiralTwist: true,
  ...patch,
});
const winding = (patch = {}) => layer({ spiralEnabled: true, spiralOrder: 1, ...patch });
const evalFrame = (mode, a, b, t, slide = 'minimal', frame, origin) =>
  rt.sampleSkeleton(rt.describe({ sourceLayer: a, targetLayer: b, mode, slide, origin }), t, frame);
const near = (a, b) => assert(Math.abs(a - b) < 1e-7, `${a} != ${b}`);
const finite = (f) =>
  assert(
    f.length &&
      f.every(
        (p) => p.points.length >= 2 && p.points.every((q) => Number.isFinite(q.x) && Number.isFinite(q.y)),
      ),
  );

const spec = (mode, a, b, origin) => rt.describe({ sourceLayer: a, targetLayer: b, mode, origin });
const a = layer(),
  b = layer({ rotation: 30 });
const top = evalFrame('topology', a, b, 0.5),
  circle = evalFrame('circleSlide', a, b, 0.5);
near(Math.hypot(circle[0].points[0].x, circle[0].points[0].y), 100);
assert(Math.hypot(top[0].points[0].x, top[0].points[0].y) < 99);
for (const mode of sk.modes())
  for (const [from, to] of [
    [a, layer({ N: 7, rotation: 25 })],
    [a, winding({ rotation: 22 })],
    [winding(), winding({ spiralOrder: 2, N: 6, K: 2 })],
    [winding({ spiralOrder: 2 }), winding()],
    [winding(), a],
    [winding(), winding({ spiralOrder: -1 })],
  ])
    for (const t of [0, 0.17, 0.5, 0.87, 1]) {
      const f = rt.samplePrimary(spec(mode, from, to), t);
      assert(f?.primary && f.paths.length, mode);
      finite(f.skeletonFrame);
      finite(f.paths);
      assert(f.skeletonFrame.every((p) => p.phaseSync === SomataMorphRegistry.corridorPhase(mode)));
      const blue = rt.samplePrimary(spec(mode, from, to, 'blue'), t);
      assert.deepEqual(blue.paths, f.paths);
      assert.deepEqual(blue.skeletonFrame, f.skeletonFrame);
    }
const coords = (paths) =>
  paths.map((p) => ({ closed: p.closed, points: p.points.map(({ x, y }) => ({ x, y })) }));
for (const order of [0, 1, 2]) {
  const src = layer({ spiralEnabled: order > 0, spiralOrder: order });
  const dst = { ...src, rotation: 40 };
  for (const [t, e] of [
    [0, src],
    [1, dst],
  ]) {
    const actual = coords(rt.samplePrimary(spec('topology', src, dst), t).paths);
    const expected = coords(buildOrbitPolylines(e));
    assert.equal(actual.length, expected.length);
    actual.forEach((p, i) => {
      assert.equal(p.closed, expected[i].closed);
      assert.equal(p.points.length, expected[i].points.length);
      p.points.forEach((q, j) => {
        near(q.x, expected[i].points[j].x);
        near(q.y, expected[i].points[j].y);
      });
    });
  }
}
const openA = layer({ closedLoop: false }),
  openB = { ...openA, rotation: 28 };
assert(rt.samplePrimary(spec('circleSlide', openA, openB), 0.4).paths.every((p) => !p.closed));
console.log('PASS: seven modes, manual/Blue parity, signed order graph and static endpoints');

// Edge-local profile placement: assert both end spans, not just finite points.
const dist = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);
for (const profileMode of ['segments', 'spline']) {
  const prof = [
    { x: 0, y: 0 },
    { x: 0.32, y: 0.24 },
    { x: 0.73, y: -0.13 },
    { x: 1, y: 0 },
  ];
  const from = layer({
    closedLoop: false,
    spiralClosed: false,
    profileMode,
    profileNodes: prof,
    spiralTangential: true,
  });
  const to = { ...from, rotation: 36, radius: 130, spiralEnabled: true, spiralOrder: 1 };
  const config = spec('circleSlide', from, to, 'blue');
  const zero = rt.samplePrimary(config, 0.37, { order: 0, sharedOrder: true });
  assert.equal(zero.paths.length, 4);
  assert.equal(buildOrbitPolylines(from).length, 4);
  for (const order of [-2, -1, -0.0001, 0.0001, 0.35, 1, 2]) {
    const f = rt.samplePrimary(config, 0.37, { order, sharedOrder: true });
    const g = f.skeletonFrame[0].graph;
    assert.equal(f.paths.length, g.edges.length);
    for (const i of [0, g.edges.length - 1]) {
      const [a, b] = g.edgeSamples[i],
        p = f.paths[i];
      assert(dist(p.points[0], a) < 1e-7, `first anchor: ${profileMode} ${order} ${i}`);
      assert(dist(p.points.at(-1), b) < 1e-7, `last anchor: ${profileMode} ${order} ${i}`);
      const cubics = p._bezierSegments;
      if (cubics?.length) {
        assert(dist(cubics[0].p0, a) < 1e-7);
        assert(dist(cubics.at(-1).p3, b) < 1e-7);
        for (let j = 1; j < cubics.length; j++) assert(dist(cubics[j - 1].p3, cubics[j].p0) < 1e-7);
      }
    }
    if (Math.abs(order) < 0.001) {
      const [a, b] = g.edgeSamples.at(-1),
        p = f.paths.at(-1);
      assert(dist(a, b) < 1e-4);
      assert(p.points.every((q) => dist(q, a) < 1e-4));
      assert((p._bezierSegments || []).every((c) => dist(c.c1, a) < 1e-4 && dist(c.c2, a) < 1e-4));
    }
  }
  const closedA = { ...from, closedLoop: true, spiralClosed: true },
    closedB = { ...to, closedLoop: true, spiralClosed: true };
  const f = rt.samplePrimary(spec('circleSlide', closedA, closedB, 'blue'), 0.37, {
    order: 1e-4,
    sharedOrder: true,
  });
  for (const i of [0, f.paths.length - 1]) {
    const [a, b] = f.skeletonFrame[0].graph.edgeSamples[i];
    assert(dist(f.paths[i].points[0], a) < 1e-7);
    assert(dist(f.paths[i].points.at(-1), b) < 1e-4);
  }
}
console.log(
  'PASS: first/last profile spans, segment and spline anchors, Bezier joins, and signed zero-order terminal collapse',
);

// A known authored peak must retain its aspect ratio when a chord shrinks.
// Inspect its projection in the local edge basis, not screen-space bounds.
const peakProfile = [
  { x: 0, y: 0 },
  { x: 0.37, y: 0.42 },
  { x: 1, y: 0 },
];
function assertFittedPeak(paths, a, b) {
  const L = dist(a, b),
    sx = (b.x - a.x) / L,
    sy = (b.y - a.y) / L;
  assert(L > 0);
  const p = paths.points[1],
    px = p.x - a.x,
    py = p.y - a.y;
  near(px * sx + py * sy, 0.37 * L);
  near(-px * sy + py * sx, 0.42 * 0.5 * L);
}
for (const order of [-0.8, -0.25, 0.25, 0.8]) {
  const a = layer({
    closedLoop: false,
    spiralClosed: false,
    profileNodes: peakProfile,
    spiralTangential: false,
  });
  const f = rt.samplePrimary(spec('circleSlide', a, { ...a, rotation: 45 }, 'blue'), 0.4, {
    order,
    sharedOrder: true,
  });
  const g = f.skeletonFrame[0].graph,
    i = g.edges.length - 1;
  const [a0, b0] = g.edgeSamples[i];
  assertFittedPeak(f.paths[i], a0, b0);
}
console.log('PASS: matching longitudinal and transverse profile scale on open spiral tail');
// Normal live edges (no birth/death metadata) must scale by the same rule.
for (const order of [0, 1, 2]) {
  const a = layer({
    N: 6,
    closedLoop: false,
    spiralClosed: false,
    profileNodes: peakProfile,
    spiralEnabled: order !== 0,
    spiralOrder: order,
    spiralTangential: false,
  });
  const b = { ...a, rotation: 25 };
  for (const t of [0, 0.37, 1]) {
    const f = rt.samplePrimary(spec('topology', a, b, 'blue'), t);
    const p = f.skeletonFrame[0];
    const edges = p.graph?.edgeSamples ?? p.points.slice(1).map((q, i) => [p.points[i], q]);
    for (const i of [0, edges.length - 1]) assertFittedPeak(f.paths[i], ...edges[i]);
  }
}
console.log(
  'PASS: aspect ratio on ordinary first and last edges in polygon and spiral, including static endpoints',
);

// Y squeeze acts on the finished profile, not on the winding inputs.
function assertSquash(base, result, factor) {
  assert.equal(base.length, result.length);
  const compare = (p, q) => {
    near(p.x, q.x);
    near(p.y * factor, q.y);
  };
  for (let i = 0; i < base.length; i++) {
    const a = base[i],
      b = result[i];
    assert.equal(a.points.length, b.points.length);
    a.points.forEach((p, j) => compare(p, b.points[j]));
    assert.equal(a._bezierSegments?.length, b._bezierSegments?.length);
    a._bezierSegments?.forEach((c, j) =>
      ['p0', 'c1', 'c2', 'p3'].forEach((k) => compare(c[k], b._bezierSegments[j][k])),
    );
  }
}
for (const order of [0, 1, -1, 2])
  for (const profileMode of ['segments', 'spline']) {
    const source = winding({
      N: 7,
      K: 3,
      spiralOrder: order,
      profileMode,
      profileNodes: [
        { x: 0, y: 0 },
        { x: 0.25, y: 0.55 },
        { x: 0.75, y: -0.2 },
        { x: 1, y: 0 },
      ],
    });
    const target = { ...source, rotation: 45, K: 2 };
    const plain = buildOrbitPolylines(source);
    for (const pct of [0, 50, 100]) {
      const flat = buildOrbitPolylines({ ...source, spiralSquashY: pct });
      const factor = order === 0 ? 1 : 1 - pct / 100;
      assertSquash(plain, flat, factor);
      assertSquash(plain.__somataSkeletonOrbits, flat.__somataSkeletonOrbits, factor);
      for (const mode of ['topology', 'fade', 'light'])
        for (const origin of ['manual', 'blue']) {
          const s = spec(mode, source, target, origin);
          const frame = { layer: source };
          const a = rt.samplePrimary(s, 0.42, frame),
            b = rt.samplePrimary(s, 0.42, { ...frame, spiralSquashY: pct });
          assertSquash(a.paths, b.paths, factor);
          assertSquash(a.skeletonFrame, b.skeletonFrame, factor);
        }
    }
  }
near(spiralSquashYFactor(100, 0), 1);
near(spiralSquashYFactor(100, 1e-5), 1);
near(spiralSquashYFactor(100, 1), 0);
console.log(
  'PASS: spiral Y squeeze, exact static and morph points/cubic controls, signed orders, zero-order isolation',
);

// Mixed profile is drawn as a single baked contour instead of swapping the
// active profile at the midpoint. Verify the production cubic builders.
run(declarations('roundPolylineForDraw'), 'polyline renderer');
run(
  declarations(
    'profileCubicPoint',
    'profileCubicSplit',
    'profileCubicSlice',
    'recordExactPolygonSplinePath',
    'profileCubicKnotFractions',
    'profileCubicPartition',
  ),
  'curve partition',
);
run(declarations('phaseCubicAt'), 'curve evaluator');
run(declarations('profileModeTransitionProgress'), 'profile clock');
for (const order of [0, 1, 2])
  for (const closed of [false, true])
    for (const direction of [false, true]) {
      const segment = layer({
        closedLoop: closed,
        spiralClosed: closed,
        spiralEnabled: order > 0,
        spiralOrder: order,
        rounding: 0,
        profileNodes: [
          { x: 0, y: 0 },
          { x: 0.25, y: 0.4 },
          { x: 0.75, y: -0.2 },
          { x: 1, y: 0 },
        ],
      });
      const spline = { ...segment, profileMode: 'spline', splineRenderMode: 'smooth' };
      const [from, to] = direction ? [spline, segment] : [segment, spline];
      for (const origin of ['manual', 'blue']) {
        const morph = spec('circleSlide', from, to, origin);
        const left = rt.samplePrimary(morph, 0.499999).paths,
          right = rt.samplePrimary(morph, 0.500001).paths;
        assert(left.length && left.length === right.length);
        left.forEach((p, i) => {
          const q = right[i];
          assert(p.profileCurveBaked && q.profileCurveBaked);
          assert.equal(p._bezierSegments.length, q._bezierSegments.length);
          p._bezierSegments.forEach((c, j) => {
            const d = q._bezierSegments[j];
            for (const k of ['p0', 'c1', 'c2', 'p3'])
              assert(Math.hypot(c[k].x - d[k].x, c[k].y - d[k].y) < 0.01);
          });
        });
      }
    }
load('js/core/morph-controller.js');
const rewind = { start: null, duration: 450, linearT: 0.62, geometryT: 0.62 };
const start = SpiroMorphController.resolveBlueReturn(rewind, 1000);
assert(start.initial && !start.done);
near(start.linearT, 0.62);
near(SpiroMorphController.resolveBlueReturn(rewind, 1225).linearT, 0.31);
const end = SpiroMorphController.resolveBlueReturn(rewind, 1450);
assert(end.done && !end.initial);
near(end.linearT, 0);
console.log(
  'PASS: mixed segment/spline profile, both directions, manual and Blue, orders 0/1/2; Blue rewind clock',
);

// Production controller integration: the dropdown modes must reach the
// published skeleton and the Corridor signals, not just the planner.
for (const file of scripts.filter((f) => /^js\/core\/spiral-zero-(transition\.js|presets\/)/.test(f)))
  load(file);
load('js/morph-runtime/manual-interpolation.js');
global.animationScheduler = { has: () => false, add() {}, remove() {} };
global.requestMainCanvasRender = () => {};
global.__somataMorphSpeedEase = (t) => t;
global.getCachedLayerDrawData = (l) => ({ paths: buildOrbitPolylines(l) });
load('js/morph-runtime/manual-morph.js');
const zeroModes = ['unfold', 'layerwise', 'honest', 'beautiful'];
const zero = SomataSpiralZeroTransition;
assert.equal(zero.normalizeMode(undefined), 'layerwise');
assert.equal(zero.normalizeMode('invalid'), 'layerwise');
assert.equal(zero.normalizeMode('__proto__'), 'layerwise');
assert.equal(zero.normalizeMode('unfold'), 'unfold');
assert.match(read('index.html'), /<option value="layerwise" selected>Послойный/);
assert.deepEqual(
  [
    ...read('index.html')
      .match(/<select id="paramSpiralZeroTransition"[^>]*>(.*?)<\/select>/s)[1]
      .matchAll(/<option value="([^"]+)"[^>]*>([^<]+)<\/option>/g),
  ].map((m) => m.slice(1)),
  [
    ['layerwise', 'Послойный'],
    ['honest', 'Честный'],
    ['beautiful', 'Красивый'],
  ],
);
const spiralUI = read('index.html');
assert.deepEqual(
  [
    ...spiralUI
      .match(/<select id="paramSpiralConstruction"[^>]*>(.*?)<\/select>/s)[1]
      .matchAll(/<option value="([^"]+)"[^>]*>([^<]+)<\/option>/g),
  ].map((m) => m.slice(1)),
  [
    ['simple', 'Простой'],
    ['unfold', 'Развёртывание'],
    ['seaweed', 'Морские водоросли'],
    ['unfoldUntwisted', 'Ведьминский'],
  ],
);
assert(spiralUI.indexOf('id="paramSpiralConstruction"') < spiralUI.indexOf('id="paramSpiralZeroTransition"'));
assert(spiralUI.indexOf('id="paramSpiralZeroTransition"') < spiralUI.indexOf('id="paramSpiralOrder"'));
for (const legacy of zeroModes) {
  const migrated = {
    spiralConstructionMode: zero.buildOf({ spiralZeroTransitionMode: legacy }),
    spiralZeroTransitionMode: zero.transitionOf({ spiralZeroTransitionMode: legacy }),
  };
  assert.equal(zero.modeFor(migrated), legacy);
}
for (const build of ['simple', 'unfold', 'seaweed', 'unfoldUntwisted'])
  for (const transition of ['layerwise', 'honest', 'beautiful'])
    for (const sign of [-1, 1]) {
      const props = { spiralConstructionMode: build, spiralZeroTransitionMode: transition };
      const mode = zero.modeFor(props);
      if (build !== 'simple') assert.equal(zero.normalizeMode(mode), build);
      const authored = winding({ ...props, spiralOrder: sign * 0.55 });
      const sample = rt.sampleStaticOrder(authored, 'coordinated', true);
      assert.equal(sample.zeroMode, mode);
      finite(sample.sampled.paths);
      finite(sample.sampled.skeletonFrame);
      const blue = zero.blueOrder(mode, 0, sign, 0.55, true);
      near(blue.order, sample.sampled.order);
      const signals = { ...authored };
      zero.applyCorridorFrame(signals, mode, 0, sign, 0.55, true, sample.flat, sample.wound, authored, true);
      if (build !== 'simple') {
        const forward = zero.sampleOrder(mode, 0, sign, 0.55, true);
        const backward = zero.sampleOrder(mode, sign, 0, 0.45, true);
        near(signals.__spiralUnfoldPopulation, forward.population);
        near(forward.order, backward.order);
        if (transition !== 'layerwise')
          near(forward.order, zero.sampleOrder(transition, 0, sign, 0.55, true).order);
      }
    }
console.log(
  'PASS: independent spiral construction and transition selectors, legacy migration, all 12 combinations on both sides of zero',
);
let seq = 0;
for (const corridor of [false, true])
  for (const [from, to] of [
    [0, 1],
    [1, 0],
    [0, -1],
    [-1, 0],
  ])
    for (const mode of zeroModes) {
      assert.equal(zero.normalizeMode(mode), mode);
      state.tunnel.active = corridor;
      const id = `test-zero-${++seq}`;
      const point = (order) =>
        layer({
          id,
          spiralZeroTransitionMode: mode,
          spiralEnabled: order !== 0,
          spiralOrder: order,
          closedLoop: order === 0,
          testMorph: { enabled: true, mode: 'circleSlide', duration: 1 },
        });
      const a = point(from),
        b = point(to);
      const t = 0.2;
      const smooth = t * t * (3 - 2 * t);
      const expected =
        corridor && mode === 'unfold'
          ? from === 0
            ? 0
            : from * 0.84375
          : corridor && mode === 'beautiful'
            ? from
            : from + (to - from) * (['layerwise', 'beautiful'].includes(mode) ? smooth : t);
      const p = zero.plan(mode, from, to, t, corridor);
      near(p.order, expected);
      assert.equal(p.choreographed, corridor && ['beautiful', 'honest', 'unfold'].includes(mode));
      near(zero.plan(mode, from, to, 0, corridor).order, from);
      near(zero.plan(mode, from, to, 1, corridor).order, to);

      runtimeState.morph.renderSourceLayers = [a];
      runtimeState.morph.renderTargetLayers = [b];
      state.layers = [a];
      const blue = {
        sourceLayer: a,
        layer: { ...a },
        layerIndex: 0,
        blueMorphProvider: { active: true, geometryActive: true, geometryT: t },
      };
      assert(SomataTestMorph.applyFrame(blue, 1200));
      near(blue.geometryProvider.spiralOrder, expected);
      assert(blue.geometryProvider.framePaths.length > 0);
      if (mode === 'unfold')
        assert.deepEqual(
          blue.geometryProvider.framePaths,
          rt.samplePrimary(spec('circleSlide', a, b, 'blue'), p.shapeT ?? t, { order: p.order }).paths,
        );

      // Exercise manual order edit while Blue is inactive.
      state.layers = [b];
      assert(SomataTestMorph.prepareManualOrderEdit(b, from, 1000));
      const manual = () => ({ sourceLayer: b, layer: { ...b }, layerIndex: 0 });
      assert(SomataTestMorph.applyFrame(manual(), 1000));
      const frame = manual();
      const clock = corridor && mode === 'honest' ? 1000 + (from === 0 ? 200 : 0) + t * 800 : 1000 + t * 1000;
      assert(SomataTestMorph.applyFrame(frame, clock));
      near(frame.geometryProvider.spiralOrder, expected);
      assert(frame.geometryProvider.framePaths.length > 0);
      assert.equal(frame.layer.__spiralLayerwiseAngleMix != null, corridor && mode === 'layerwise');
      assert.equal(frame.layer.__spiralZeroCorridorPopulation != null, corridor && mode === 'beautiful');
      assert.equal(frame.layer.__spiralUnfoldPopulation != null, corridor && mode === 'unfold');
      assert.equal(blue.layer.__spiralUnfoldPopulation != null, corridor && mode === 'unfold');
      const terminal = manual();
      assert(SomataTestMorph.applyFrame(terminal, 2000));
      near(terminal.geometryProvider.spiralOrder, to);

      // Changing order during Blue uses its own clock and does not overwrite
      // the Blue phase used to sample the live anchors.
      assert(SomataTestMorph.beginIndependentOrderEdit(b, from, to, 3000));
      const composed = {
        ...manual(),
        blueMorphProvider: { active: true, geometryActive: true, geometryT: 0.41 },
      };
      assert(SomataTestMorph.applyFrame(composed, clock + 2000));
      near(composed.geometryProvider.spiralOrder, expected);
      near(composed.geometryProvider.progress, 0.41);
      assert.equal(composed.blueMorphProvider.geometryT, 0.41);
    }
console.log(
  'PASS: four zero-order modes, UI IDs, manual/Blue contour, Corridor signals and signed endpoints',
);

// «Свинчивание» is an authored per-layer geometry toggle, independent of
// tangency and the zero-order transition. Only an explicit true enables winding.
assert.match(read('index.html'), /id="paramSpiralTwist"><span>Свинчивание/);
assert.ok(listModules().some((f) => /spiralTwist: l\.spiralTwist === true/.test(read(f))));
for (const order of [-2, -1, 1, 2]) {
  const a = winding({ N: 3, spiralOrder: order, spiralTwist: false });
  const b = { ...a, rotation: 27 };
  const on = { ...a, spiralTwist: true },
    legacy = { ...a };
  delete legacy.spiralTwist;
  assert.deepEqual(coords(buildOrbitPolylines(a)), coords(buildOrbitPolylines(legacy)));
  const noTwist = buildOrbitPolylines(a),
    g = noTwist.__somataSkeletonGraphs[0];
  const [root, tail] = g.edgeSamples[0];
  assert.equal(g.nodes.length, 6);
  assert.notEqual(tail, g.edgeSamples[1][0]);
  near(
    Math.atan2(root.x * tail.y - root.y * tail.x, root.x * tail.x + root.y * tail.y),
    getSpiralCarrierSpec(a).delta,
  );
  near(Math.hypot(tail.x, tail.y) / Math.hypot(root.x, root.y), getSpiralCarrierSpec(a).targetScale);
  near(getSpiralCarrierSpec(a).delta, order < 0 ? (-2 * Math.PI) / 3 : (2 * Math.PI) / 3);
  assert(Math.abs(getSpiralCarrierSpec(on).delta) > 1);
  assert.notDeepEqual(coords(noTwist), coords(buildOrbitPolylines(on)));
  for (const [t, l] of [
    [0, a],
    [1, b],
  ]) {
    assert.deepEqual(
      coords(rt.samplePrimary(spec('topology', a, b), t).paths),
      coords(buildOrbitPolylines(l)),
    );
  }
  const manual = rt.samplePrimary(spec('phaseCircle', a, b, 'manual'), 0.4);
  const blue = rt.samplePrimary(spec('phaseCircle', a, b, 'blue'), 0.4);
  assert.deepEqual(manual.paths, blue.paths);
  near(blue.period, getSpiralCarrierSpec(a).delta);
  near(rt.samplePrimary(spec('circleSlide', a, on), 0.5).skeletonFrame[0].graph.twist, 0.5);
  assert.deepEqual(
    coords(buildOrbitPolylines({ ...a, spiralOrder: 0 })),
    coords(buildOrbitPolylines({ ...on, spiralOrder: 0 })),
  );
}
console.log(
  'PASS: spiral twist defaults, independent 13.2 branches, preserved radial scale, static/manual/Blue geometry and Corridor phase',
);

// The 13.2 law applies even at fractional non-zero orders; only a live
// transition through zero transports the matching edges back to the polygon.
for (const order of [-0.4, 0.4]) {
  const spiral = winding({ N: 5, spiralOrder: order, spiralTwist: false, spiralTangential: true });
  const polygon = { ...spiral, spiralOrder: 0 };
  const same = rt.samplePrimary(spec('phaseCircle', spiral, spiral), 0.5);
  assert.equal(same.skeletonFrame[0].graph.referenceWeight, 1);
  near(same.period, ((2 * Math.PI) / 5) * order);
  const authored = buildOrbitPolylines(spiral);
  assert.equal(same.paths.length, authored.length);
  same.paths.forEach((p, i) =>
    p.points.forEach((q, j) => {
      near(q.x, authored[i].points[j].x);
      near(q.y, authored[i].points[j].y);
    }),
  );
  for (const [from, to, nearZero, spiralEnd] of [
    [polygon, spiral, 1e-5, 1],
    [spiral, polygon, 1 - 1e-5, 0],
  ]) {
    const edit = spec('phaseCircle', from, to, 'manual');
    const f = rt.samplePrimary(edit, nearZero);
    finite(f.paths);
    assert.equal(f.skeletonFrame[0].graph.referenceWeight, 1);
    assert(f.skeletonFrame[0].directLayerwise);
    const graph = f.skeletonFrame[0].graph;
    graph.edgeSamples.forEach(([start, tail], i) => {
      const neighbor =
        graph.sourceVertices[
          (i + Math.sign(order) + graph.sourceVertices.length) % graph.sourceVertices.length
        ];
      assert(dist(tail, neighbor) < 0.01);
      assert(dist(start, tail) > 10);
    });
    assert.equal(rt.samplePrimary(edit, spiralEnd).skeletonFrame[0].graph.referenceWeight, 1);
  }
}
console.log('PASS: fractional 13.2 law in the primary morph route and continuous near-zero skeleton');

// The production copy transforms, skeleton and retained Beziers agree on
// the seam even if the incoming copies have been warped by population/depth.
load('js/render/corridor-copy-frame.js');
run(
  declarations(
    'spiralCorridorCopiesForLayer',
    'unfoldOriginCopy',
    'untwistedUnfoldCorridorCopies',
    'unfoldCorridorCopies',
    'lockContinuousSpiralCopies',
  ),
  'locked copies',
);
run(declarations('getSpiralMorphTunnelPhaseRadians', 'getMotionTunnelLagRadians'), 'locked copy angle');
state.tunnel.active = true;
const unwarped = [
  { position: 3.25, scale: 0.81, alpha: 0.7 },
  { position: 4.25, scale: 1.2, alpha: 1 },
  { position: 5.25, scale: 1.99, alpha: 0.8 },
];
// Stage boundaries, exact endpoints and reversibility of the actual copy frame.
const corridorFixture = Array.from({ length: 9 }, (_, i) => ({
  copyId: i + 40,
  position: i - 2,
  scale: 0.28 * 1.22 ** i,
  stepRatio: 1.22,
  alpha: 0.8,
  centerRevealAlpha: 1,
}));
corridorFixture._stepRatio = 1.22;
corridorFixture._logStepRatio = Math.log(1.22);
const copiesAt = (mode, a, b, t, inputs = corridorFixture) => {
  const plan = zero.plan(mode, a, b, t, true);
  const frame = layer({
    spiralOrder: plan.order,
    spiralEnabled: Math.abs(plan.order) > 1e-8,
    spiralManualFocus: true,
    spiralRotationFocusFigure: 4,
  });
  // Simulate the period from a continuous skeleton; it must not replace
  // either transition's explicit Corridor transforms.
  frame.__somataContinuousSpiralPeriodScale = inputs._stepRatio ** Math.abs(plan.order);
  zero.applyCorridorFrame(frame, mode, a, b, t, true, frame, frame);
  return {
    plan,
    copies: unfoldCorridorCopies(
      lockContinuousSpiralCopies(spiralCorridorCopiesForLayer(inputs, frame, 1000), frame, inputs),
      frame,
      inputs,
    ),
  };
};
for (const order of [-2, -0.35, 0.35, 1, 2]) {
  const from = 0,
    to = order;
  const start = copiesAt('unfold', from, to, 0),
    closing = copiesAt('unfold', from, to, 0.1);
  const closed = copiesAt('unfold', from, to, 0.2);
  const opening = copiesAt('unfold', from, to, 0.6),
    end = copiesAt('unfold', from, to, 1);
  const pivot = corridorFixture.indexOf(zero.corridorOrigin(corridorFixture));
  assert.notEqual(pivot, 3);
  start.copies.forEach((copy, i) => near(copy.scale, corridorFixture[i].scale));
  assert(start.copies.every((copy) => copy._spiralUnfoldFocusPosition === corridorFixture[pivot].position));
  near(closing.plan.order, 0);
  near(opening.plan.order, order * 0.5);
  near(closing.plan.population, 0.5);
  near(opening.plan.population, 0.5);
  near(closed.plan.population, 0);
  near(closed.copies[pivot].scale, start.copies[pivot].scale);
  for (let i = 0; i < end.copies.length; i++) {
    near(end.copies[i].scale, corridorFixture[i].scale ** Math.abs(order));
    near(closed.copies[i].scale, closed.copies[pivot].scale);
    near(closed.copies[i].alpha, i === pivot ? 0.8 : 0);
    near(closing.copies[i].alpha, i === pivot ? 0.8 : 0.4);
  }
  for (let j = 0; j <= 100; j++) {
    const t = j / 100;
    for (const mode of ['unfold', 'layerwise']) {
      const direct = copiesAt(mode, from, to, t),
        reverse = copiesAt(mode, to, from, 1 - t);
      near(direct.plan.order, reverse.plan.order);
      for (let i = 0; i < corridorFixture.length; i++) {
        const p = direct.copies[i],
          q = reverse.copies[i];
        assert.equal(p.copyId, corridorFixture[i].copyId);
        near(p.scale, q.scale);
        near(p.alpha, q.alpha);
        if (mode === 'layerwise') {
          near(p.alpha, corridorFixture[i].alpha);
          if (i) assert(p.scale > direct.copies[i - 1].scale * 1.06, 'neighboring copies collapsed');
        }
      }
    }
  }
  const nearZero = copiesAt('layerwise', order, 0, 1 - 1e-5);
  const atZero = copiesAt('layerwise', order, 0, 1);
  assert.equal(atZero.copies, corridorFixture);
  near(nearZero.copies[8].scale, atZero.copies[8].scale);
}
console.log(
  'PASS: reversible Corridor folding, stable focus during folding, unchanged copy IDs and distinct layerwise scales through zero',
);
let checkedSeams = 0;
for (const mode of ['phaseCircle', 'coordinated', 'coordinatedFromCenter'])
  for (const origin of ['manual', 'blue'])
    for (const twists of [
      [false, false],
      [true, true],
      [false, true],
    ])
      for (const orders of [
        [0.4, 1.7],
        [-1.2, -0.35],
        [1, -1],
        [0, 1],
      ])
        for (const squash of [0, 40, 100]) {
          const a = winding({
            N: 5,
            K: 1,
            spiralZeroTransitionMode: 'honest',
            spiralOrder: orders[0],
            spiralTwist: twists[0],
            rounding: 0.23,
            spiralTangential: true,
            profileNodes: [
              { x: 0, y: 0 },
              { x: 0.35, y: 0.2 },
              { x: 1, y: 0 },
            ],
          });
          const b = {
            ...a,
            N: 6,
            K: 2,
            rotation: 33,
            spiralOrder: orders[1],
            spiralTwist: twists[1],
            profileMode: 'spline',
          };
          for (const t of [0, 0.12, 0.49, 0.51, 0.88, 1]) {
            const s = spec(mode, a, b, origin),
              frame = { spiralSquashY: squash };
            const f = rt.samplePrimary(s, t, frame);
            if (!f.periodScale || f.skeletonFrame.some((p) => p.cloneTransport)) continue;
            const ctx = { layer: { ...a, __spiralLayerwiseAngleMix: 0.27 } };
            assert(rt.publish(ctx, f));
            const copies = lockContinuousSpiralCopies(unwarped, ctx.layer);
            assert.equal(copies[1].scale, unwarped[1].scale);
            assert.deepEqual(
              copies.map((c) => c.alpha),
              unwarped.map((c) => c.alpha),
            );
            const world = (p, i) => {
              const copy = copies[i],
                angle = getMotionTunnelLagRadians(copy, ctx.layer);
              const c = Math.cos(angle) * copy.scale,
                d = Math.sin(angle) * copy.scale;
              return { x: c * p.x - d * p.y, y: d * p.x + c * p.y };
            };
            const joins = (end, start) => {
              for (let i = 0; i < copies.length - 1; i++) {
                const gap = dist(world(end, i), world(start, i + 1));
                assert(
                  gap < 1e-7,
                  `${mode}/${origin} ${twists} ${orders} squeeze ${squash} t=${t}, gap=${gap}`,
                );
                checkedSeams++;
              }
            };
            const debug = rt.sampleSkeleton(s, t, frame);
            for (const [j, p] of f.skeletonFrame.entries()) {
              if (!p.periodic) continue;
              const g = p.graph,
                rails = f.paths.filter((r) => r.skeletonOrbitId === p.points[0].id);
              assert.deepEqual(g.orbits, debug[j].graph.orbits);
              if (p.periodicChain) {
                for (let i = 0; i < g.edgeSamples.length - 1; i++)
                  assert.equal(g.edgeSamples[i].at(-1), g.edgeSamples[i + 1][0]);
                joins(g.nodes.at(-1), g.nodes[0]);
                for (let i = 0; i < rails.length - 1; i++)
                  near(dist(rails[i].points.at(-1), rails[i + 1].points[0]), 0);
              } else for (const edge of g.orbits) joins(edge.points.at(-1), edge.points[0]);
              for (const [end, start] of p.periodicChain
                ? rails.length
                  ? [[rails.at(-1), rails[0]]]
                  : []
                : rails.map((r) => [r, r])) {
                joins(end.points.at(-1), start.points[0]);
                if (end._bezierSegments?.length && start._bezierSegments?.length) {
                  joins(end._bezierSegments.at(-1).p3, start._bezierSegments[0].p0);
                  for (let i = 1; i < end._bezierSegments.length; i++)
                    near(dist(end._bezierSegments[i - 1].p3, end._bezierSegments[i].p0), 0);
                }
              }
            }
          }
        }
for (const mode of ['phaseCircle', 'coordinated', 'coordinatedFromCenter']) {
  const a = winding({ spiralClosed: false, spiralTwist: false }),
    b = { ...a, rotation: 30 };
  const f = rt.samplePrimary(spec(mode, a, b), 0.4);
  assert.equal(f.periodScale, undefined);
  assert(f.skeletonFrame.every((p) => !p.periodic));
}
assert(checkedSeams > 1000);
console.log(
  `PASS: ${checkedSeams} actual adjacent-copy joins for skeleton, contour and Beziers in the sealed transports; explicit open spirals stay open`,
);

// Coordinated is a fixed ordered carrier, not a set of matched and born turns.
// K=1 -> K=3 at N=6 crosses from one authored orbit to three.
for (const [n, k] of [
  [6, 3],
  [9, 3],
  [8, 2],
])
  for (const twist of [true]) {
    const a = winding({ N: 6, K: 1, spiralTwist: twist, rotation: 11, spiralOrder: 0.7 });
    const b = { ...a, N: n, K: k, rotation: 33, spiralOrder: 1.6 };
    const options = { spiralSquashY: 35 };
    const get = (a, b, u) => rt.samplePrimary(spec('coordinated', a, b), u, options);
    const ids = (f) => f.skeletonFrame[0].points.map((p) => p.id);
    const first = get(a, b, 0);
    for (const t of [0, 1e-6, 0.2, 0.5, 0.8, 1 - 1e-6, 1]) {
      const f = get(a, b, t),
        rev = get(b, a, 1 - t);
      assert.equal(f.skeletonFrame.length, 1);
      assert.deepEqual(ids(f), ids(first));
      const [p] = f.skeletonFrame,
        g = p.graph;
      assert(p.coordinatedSpine && p.periodicChain && !g.referenceEdges);
      assert.equal(g.edges.length, Math.max(6, n));
      assert(g.edges.every((e) => e.kind === 'carrier'));
      assert(!p.lifecycle && !p.parentNodeId && p.alpha == null);
      assert.equal(g.byId.size, g.nodes.length);
      for (let i = 1; i < g.edgeSamples.length; i++)
        assert.equal(g.edgeSamples[i - 1][1], g.edgeSamples[i][0]);
      g.nodes.forEach((q, i) => near(dist(q, rev.skeletonFrame[0].graph.nodes[i]), 0));
      const shift = (p, beta, r) => ({
        x: r * (Math.cos(beta) * p.x - Math.sin(beta) * p.y),
        y: r * (Math.sin(beta) * p.x + Math.cos(beta) * p.y),
      });
      near(dist(shift(g.nodes[0], f.period, f.periodScale), g.nodes.at(-1)), 0);
      for (const focusPosition of [-1, 1.25, 5]) {
        const ctx = { layer: { ...a, __somataFocusFrame: { position: focusPosition } } };
        assert(rt.publish(ctx, f));
        near(getMotionTunnelLagRadians({ position: focusPosition }, ctx.layer), 0);
        near(getMotionTunnelLagRadians({ position: focusPosition + 1 }, ctx.layer), f.period);
        near(getMotionTunnelLagRadians({ position: focusPosition - 1 }, ctx.layer), -f.period);
        const copies = lockContinuousSpiralCopies(unwarped, ctx.layer);
        assert.deepEqual(
          copies.map(({ position, alpha }) => ({ position, alpha })),
          unwarped.map(({ position, alpha }) => ({ position, alpha })),
        );
      }
    }
    const edges = (f) => f.skeletonFrame[0].graph.edgeSamples.filter(([a, b]) => dist(a, b) > 1e-7);
    for (const [end, l] of [
      [0, a],
      [1, b],
    ]) {
      const animated = edges(get(a, b, end)),
        rest = edges(get(l, l, 0));
      assert.equal(animated.length, rest.length);
      animated.forEach((edge, i) => edge.forEach((p, j) => near(dist(p, rest[i][j]), 0)));
    }
  }
console.log(
  'PASS: fixed coordinated spine across N/K changes, reverse parity, stable endpoints and focus-relative beta',
);

// Regression from the screenshot: an unscrewed hexagon was drawn as one
// polygon-like chain with a long final chord instead of six 13.2 periods.
{
  const a = winding({ N: 6, K: 1, spiralTwist: false }),
    b = { ...a, K: 2 };
  const at = (a, b, t) => rt.samplePrimary(spec('coordinatedFromCenter', a, b), t);
  for (const [t, layer] of [
    [0, a],
    [1, b],
  ]) {
    const f = at(a, b, t),
      [p] = f.skeletonFrame;
    assert(p.coordinatedReference && p.graph.referenceEdges.length === 6 && !p.periodicChain);
    const exact = sk.staticFrame(layer);
    assert.equal(p.graph.orbits.length, exact.length);
    for (const edge of p.graph.orbits) {
      const ref = exact.find((r) => r.spiralBranchIndex === edge.spiralBranchIndex);
      assert(ref && edge.points.length === 2);
      edge.points.forEach((q, j) => near(dist(q, ref.points[j]), 0));
    }
  }
  for (const t of [0.001, 0.25, 0.5, 0.75, 0.999]) {
    const f = at(a, b, t),
      g = f.skeletonFrame[0].graph;
    assert.equal(g.edges.length, 6);
    assert(g.edges.every((e) => e.kind === 'carrier'));
    const angle = (2 * Math.PI * (1 + t)) / 6;
    near(f.period, angle);
    for (const [start, end] of g.edgeSamples) {
      const c = Math.cos(angle) * f.periodScale,
        s = Math.sin(angle) * f.periodScale;
      near(dist({ x: c * start.x - s * start.y, y: s * start.x + c * start.y }, end), 0);
    }
  }
  const more = { ...a, N: 8 };
  assert.equal(at(a, more, 0).skeletonFrame[0].graph.edges.length, 6);
  assert.equal(at(a, more, 1).skeletonFrame[0].graph.edges.length, 8);
  const f = at(a, more, 1e-3),
    rev = at(more, a, 1 - 1e-3);
  const tiny = f.skeletonFrame[0].graph.referenceEdges.filter((e) => e.profileLife < 1);
  assert.equal(tiny.length, 2);
  for (const e of tiny) assert(Math.hypot(e.anchor.x, e.anchor.y) < 0.001);
  const forwardEdges = f.skeletonFrame[0].graph.edgeSamples;
  const reverseEdges = rev.skeletonFrame[0].graph.edgeSamples;
  assert(
    forwardEdges.every(([x, y]) => reverseEdges.some(([a, b]) => dist(x, a) < 1e-7 && dist(y, b) < 1e-7)),
  );
  const copies = [
    { position: 0, scale: 1, alpha: 1, rotation: 0 },
    { position: 1, scale: 2, alpha: 1, rotation: 0 },
  ];
  const path = {
    points: [
      { x: 1, y: 0 },
      { x: 9, y: 0 },
    ],
  };
  const debug = sk.corridorFrame([path], copies);
  assert.equal(debug.length, 2);
  near(debug[0].points.at(-1).x, 9);
  const joined = sk.corridorFrame(
    [
      {
        points: [
          { x: 1, y: 0 },
          { x: 2, y: 0 },
        ],
      },
    ],
    copies,
  );
  assert.deepEqual(
    joined[0].points.map((p) => p.x),
    [1, 2, 4],
  );
}
console.log(
  'PASS: N=6/K=1 screenshot regression against 13.2 graph; K changes only beta; real branch growth without copies; debug keeps raw seam',
);

// The offset variant starts at authored rails, not at the pole. A 6→8
// split creates 8 target slots, with exactly 6 visible at the source frame.
{
  const mode = 'coordinated',
    center = 'coordinatedFromCenter';
  assert.equal(
    [
      ...read('index.html').matchAll(
        /<option value="coordinatedFromCenter">Неразрывный, согласованный из центра<\/option>/g,
      ),
    ].length,
    6, // три селектора типа многоугольника и три — типа спирали
  );
  assert.equal(
    [
      ...read('index.html').matchAll(
        /<option value="coordinated"(?: selected)?>Неразрывный, согласованный<\/option>/g,
      ),
    ].length,
    6, // три селектора типа многоугольника и три — типа спирали
  );
  for (const profileMode of ['segments', 'spline'])
    for (const spiralOrder of [1, -0.6]) {
      const a = winding({ N: 6, K: 1, spiralTwist: false, profileMode, spiralOrder }),
        b = { ...a, N: 8, K: 2, rotation: 12 };
      const at = (x, y, t, origin, modeId = mode) => rt.samplePrimary(spec(modeId, x, y, origin), t);
      const edges = (f) => f.skeletonFrame[0].graph.edgeSamples;
      const source = edges(at(a, b, 0)),
        target = edges(at(a, b, 1));
      assert.equal(source.length, 6);
      assert.equal(target.length, 8);
      const angle = (x, y) => Math.atan2(x.x * y.y - x.y * y.x, x.x * y.x + x.y * y.y);
      for (const t of [1e-5, 0.17, 0.5, 0.79, 1 - 1e-5]) {
        const f = at(a, b, t, 'manual'),
          g = f.skeletonFrame[0].graph;
        const reverse = at(b, a, 1 - t, 'manual');
        assert.deepEqual(f.paths, at(a, b, t, 'blue').paths);
        assert.equal(g.edgeSamples.length, 8);
        assert.equal(f.paths.length, 8);
        assert(g.edges.every((e) => e.kind === 'carrier'));
        assert(f.paths.every((p) => (p._alpha ?? 1) === 1));
        g.edgeSamples.forEach(([start, end], i) => {
          const from = source[Math.floor((i * 6) / 8)][0],
            to = target[i][0];
          near(Math.hypot(start.x, start.y), 100);
          near(angle(from, start), t * angle(from, to));
          near(angle(start, end), f.period);
          near(dist(start, edges(reverse)[i][0]), 0);
          near(dist(end, edges(reverse)[i][1]), 0);
        });
      }
      const origin = edges(at(a, b, 1e-5, 'manual', center));
      assert.equal(origin.filter(([p]) => Math.hypot(p.x, p.y) < 0.001).length, 2);
    }
}
console.log(
  'PASS: offset branch insertion at full opacity, proportional displacement, reverse parity and preserved center variant',
);

// At order zero surplus suborbits originate at the local polygon center,
// rather than at a cycled copy of an existing orbit.
{
  const mode = 'coordinatedFromCenter';
  for (const profileMode of ['segments', 'spline'])
    for (const closedLoop of [true, false])
      for (const [ka, kb, extra] of [
        [1, 2, {}],
        [1, 3, {}],
        [3, 3, { customSuborbits: 1 }],
      ]) {
        const b = layer({ N: 6, K: kb, rotation: 23, profileMode, closedLoop, spiralEnabled: true });
        const a = { ...b, K: ka, rotation: -11, radius: 80, spiralEnabled: false, ...extra };
        const at = (x, y, t, origin = 'manual', id = mode) => rt.samplePrimary(spec(id, x, y, origin), t);
        const from = at(a, b, 0),
          to = at(a, b, 1),
          n = from.skeletonFrame.length;
        assert(to.skeletonFrame.length > n);
        assert.deepEqual(coords(from.paths), coords(buildOrbitPolylines(a)));
        assert.deepEqual(coords(to.paths), coords(buildOrbitPolylines(b)));
        for (const t of [0.001, 0.25, 0.5, 0.999]) {
          const f = at(a, b, t),
            reverse = at(b, a, 1 - t),
            blue = at(a, b, t, 'blue');
          assert.deepEqual(f.paths, blue.paths);
          assert.deepEqual(f.skeletonFrame, blue.skeletonFrame);
          assert.equal(f.order, 0);
          assert.equal(f.skeletonFrame.length, to.skeletonFrame.length);
          const old = at(a, b, t, 'manual', 'coordinated');
          assert.deepEqual(f.skeletonFrame.slice(0, n), old.skeletonFrame.slice(0, n));
          const scale = t * t * (3 - 2 * t);
          for (let i = n; i < f.skeletonFrame.length; i++) {
            const g = f.skeletonFrame[i],
              r = reverse.skeletonFrame[i],
              dst = to.skeletonFrame[i];
            assert.equal(g.closed, closedLoop);
            assert.equal(g.lifecycle, 'birth');
            assert.equal(r.lifecycle, 'death');
            assert.equal(g.alpha, 1);
            assert.equal(r.alpha, 1);
            g.points.forEach((p, j) => {
              near(dist(p, r.points[j]), 0);
              near(dist(p, { x: dst.points[j].x * scale, y: dst.points[j].y * scale }), 0);
            });
            const paths = f.paths.filter((p) => p.orbitIndex === i),
              goal = to.paths.filter((p) => p.orbitIndex === i);
            assert(paths.length && paths.length === goal.length);
            paths.forEach((p, k) => {
              assert.equal(p.lifecycle, 'birth');
              assert.equal(p._alpha, 1);
              assert.equal(p.points.length, goal[k].points.length);
              p.points.forEach((q, j) => {
                const d = goal[k].points[j];
                near(dist(q, { x: d.x * scale, y: d.y * scale }), 0);
              });
            });
          }
        }
      }
}
console.log(
  'PASS: zero-order suborbit center growth and retirement, opaque contours, exact endpoints, open/closed, manual/Blue parity',
);

// Layerwise 0 <-> 1: one graph edge per authored side and one straight
// visible rail per graph edge, including the retained Bezier controls.
let layerwiseChecks = 0;
for (const mode of rt.status().continuous)
  for (const origin of ['manual', 'blue'])
    for (const twist of [false, true])
      for (const signed of [-1, 1])
        for (const profileMode of ['segments', 'spline'])
          for (const corridor of [false, true]) {
            state.tunnel.active = corridor;
            const poly = layer({
              N: 6,
              K: 1,
              spiralTwist: twist,
              spiralZeroTransitionMode: 'layerwise',
              profileMode,
            });
            const spiral = { ...poly, spiralOrder: signed, spiralEnabled: true, closedLoop: false };
            const forward = spec(mode, poly, spiral, origin),
              back = spec(mode, spiral, poly, origin);
            const base = sk.anchors(poly)[0].points;
            const endpoint = buildOrbitPolylines(spiral, true)[0];
            const valid = (a, b, q) => {
              const dx = b.x - a.x,
                dy = b.y - a.y,
                den = dx * dx + dy * dy;
              near(dx * (q.y - a.y) - dy * (q.x - a.x), 0);
              const u = (dx * (q.x - a.x) + dy * (q.y - a.y)) / den;
              assert(u >= -1e-7 && u <= 1 + 1e-7, `rail overshoot ${mode}: ${u}`);
            };
            for (const t of [0.0001, 0.17, 0.5, 0.83, 1]) {
              const order = zero.plan('layerwise', 0, signed, t, corridor).order;
              const f = rt.samplePrimary(forward, t, { order }),
                r = rt.samplePrimary(back, 1 - t, { order });
              const graph = f.skeletonFrame[0].graph;
              assert(graph && f.skeletonFrame[0].directLayerwise);
              assert.equal(f.paths.length, 6);
              assert.equal(graph.edges.length, 6);
              assert(graph.edges.every((e) => e.kind === 'carrier'));
              assert.equal(f.periodScale, undefined);
              for (const [i, [a, b]] of graph.edgeSamples.entries()) {
                const rail = f.paths[i],
                  other = r.paths[i];
                assert.equal(rail._alpha, 1);
                assert(!rail.spiralExplicitBridge);
                near(dist(a, rail.points[0]), 0);
                near(dist(b, rail.points.at(-1)), 0);
                for (const [j, q] of rail.points.entries()) {
                  valid(a, b, q);
                  near(dist(q, other.points[j]), 0);
                }
                for (const c of rail._bezierSegments || [])
                  for (const key of ['p0', 'c1', 'c2', 'p3']) valid(a, b, c[key]);
                if (t < 0.001) {
                  const next = base[(i + (twist ? 1 : signed) + 6) % 6];
                  assert(dist(a, base[i]) < 0.01 && dist(b, next) < 0.01);
                }
                if (t === 1) near(dist(b, endpoint.edgeSamples[i][1]), 0);
                if (twist && i < 5) assert.equal(b, graph.edgeSamples[i + 1][0]);
                layerwiseChecks++;
              }
              if (corridor) {
                const ctx = { layer: { ...spiral, spiralRotationFocusFigure: 7 } };
                assert(rt.publish(ctx, f));
                zero.applyCorridorFrame(ctx.layer, 'layerwise', 0, signed, t, true, poly, spiral, poly);
                const focus = SomataCorridorFocus.focusPosition(ctx.layer);
                near(getSpiralMorphTunnelPhaseRadians({ position: focus }, ctx.layer), 0);
                near(
                  getSpiralMorphTunnelPhaseRadians({ position: focus + 1 }, ctx.layer),
                  f.period * Math.abs(order),
                );
              }
            }
          }
console.log(
  `PASS: ${layerwiseChecks} layerwise straight-edge and cubic checks, all continuous modes, reversed motion, both controllers, fixed Corridor focus`,
);
for (const mode of rt.status().continuous)
  for (const corridor of [false, true])
    for (const signed of [-1, 1]) {
      state.tunnel.active = corridor;
      state.morph.unifiedMode = mode;
      const poly = layer({
        id: `layerwise-controller-${++seq}`,
        N: 6,
        spiralTwist: false,
        spiralZeroTransitionMode: 'layerwise',
        testMorph: { enabled: true, mode, duration: 1 },
      });
      const spiral = { ...poly, spiralEnabled: true, spiralOrder: signed, closedLoop: false };
      for (const [a, b] of [
        [poly, spiral],
        [spiral, poly],
      ]) {
        const id = `layerwise-controller-${++seq}`;
        const from = { ...a, id },
          to = { ...b, id };
        runtimeState.morph.renderSourceLayers = [from];
        runtimeState.morph.renderTargetLayers = [to];
        state.layers = [from];
        const blue = {
          sourceLayer: from,
          layer: { ...from },
          layerIndex: 0,
          blueMorphProvider: { active: true, geometryActive: true, geometryT: 0.5, mode },
        };
        assert(SomataTestMorph.applyFrame(blue, 500));
        assert(blue.__somataSkeletonFrame.every((p) => p.directLayerwise));
        state.layers = [to];
        assert(SomataTestMorph.prepareManualOrderEdit(to, from.spiralOrder, 1000));
        const manual = () => ({ sourceLayer: to, layer: { ...to }, layerIndex: 0 });
        SomataTestMorph.applyFrame(manual(), 1000);
        const frame = manual();
        assert(SomataTestMorph.applyFrame(frame, 1500));
        assert(frame.__somataSkeletonFrame.every((p) => p.directLayerwise));
        assert.deepEqual(coords(frame.geometryProvider.framePaths), coords(blue.geometryProvider.framePaths));
      }
    }
console.log(
  'PASS: all three continuous modes route manual and Blue 0/1 edits to the same layerwise geometry',
);

// Every picker and both runtime dispatchers expose the same surviving modes.
for (const id of ['morphMode', 'morphModeTop', 'testMorphMode']) {
  const menu = read('index.html').match(new RegExp(`<select id="${id}"[^>]*>([\\s\\S]*?)<\\/select>`))[1];
  assert.deepEqual(
    [...menu.matchAll(/<option value="([^"]+)"/g)].map((x) => x[1]).sort(),
    SomataMorphRegistry.ids().sort(),
  );
}
for (const [retired, replacement] of Object.entries({
  calm: 'topology',
  topoCircle: 'circleSlide',
  phase: 'phaseCircle',
  minimalTurn: 'phaseCircle',
})) {
  assert.equal(SomataMorphRegistry.get(retired), null);
  assert.equal(rt.modeOf(retired), replacement);
}
const highCases = [
  [{ N: 6, K: 1 }, { N: 8, K: 1 }, 2, false],
  [{ N: 6, K: 1 }, { N: 6, K: 2, customSuborbits: 1 }, 3, false],
  [{ N: 6, K: 1 }, { N: 6, K: 2 }, 1, true],
];
for (const [src, dst, extra, twist] of highCases)
  for (const order of [3, -3]) {
    const a = winding({ spiralOrder: order, spiralTwist: twist, ...src }),
      b = { ...a, ...dst };
    for (const [from, to] of [
      [a, b],
      [b, a],
    ]) {
      // The second fixture has fewer rails at its target.
      const fromCount = twist ? sk.anchors(from).length : sk.anchors(from).flatMap((p) => p.points).length;
      const toCount = twist ? sk.anchors(to).length : sk.anchors(to).flatMap((p) => p.points).length;
      const expectedTag = fromCount < toCount ? 'split' : 'merge';
      const get = (t, origin = 'manual', frame) =>
        rt.samplePrimary(spec('phaseCircle', from, to, origin), t, frame);
      const f = get(0.5),
        reverse = rt.samplePrimary(spec('phaseCircle', to, from), 0.5);
      assert.equal(f.skeletonFrame.length, Math.max(fromCount, toCount));
      assert.equal(f.skeletonFrame.filter((p) => p.phaseFollower === expectedTag).length, extra);
      assert(f.paths.some((p) => p.phaseFollower === expectedTag && p._alpha === 1));
      assert.equal(
        reverse.skeletonFrame.filter((p) => p.phaseFollower === (expectedTag === 'split' ? 'merge' : 'split'))
          .length,
        extra,
      );
      assert.deepEqual(get(0.5, 'blue').paths, f.paths);
      assert(
        f.skeletonFrame.every(
          (p) => p.cloneTransport && p.beta === undefined && p.graph.edges.every((e) => e.kind === 'carrier'),
        ),
      );
      const first = f.skeletonFrame[0];
      near(f.period, ((2 * Math.PI * first.spiralStep) / first.spiralAngularN) * Math.sign(order));
      for (const [t, l] of [
        [0, from],
        [1, to],
      ]) {
        assert(get(t).skeletonFrame.every((p) => !p.phaseFollower));
        const authored = buildOrbitPolylines(l),
          end = get(t);
        if (!twist) assert.deepEqual(coords(end.paths), coords(authored));
        else {
          // The native skeleton is exact. Do not reproduce the static
          // renderer's legacy per-edge auto-close bridges on a chain.
          const graphEdges = (graphs) =>
            graphs.flatMap((g) => g.edgeSamples.map((edge) => edge.map(({ x, y }) => ({ x, y }))));
          assert.deepEqual(
            graphEdges(end.skeletonFrame.map((p) => p.graph)),
            graphEdges(authored.__somataSkeletonGraphs),
          );
        }
      }
      const almost = get(expectedTag === 'split' ? 1e-7 : 1 - 1e-7);
      for (const copy of almost.skeletonFrame.filter((p) => p.phaseFollower)) {
        const root = copy.graph.edgeSamples[0][0],
          tail = copy.graph.edgeSamples.at(-1).at(-1);
        const parent = almost.skeletonFrame.find(
          (p) => !p.phaseFollower && dist(root, p.graph.edgeSamples[0][0]) < 0.0001,
        );
        assert(parent && dist(tail, parent.graph.edgeSamples.at(-1).at(-1)) < 0.0001);
        assert(dist(root, tail) > 1);
      }
      const ctx = { layer: { ...from, spiralRotationFocusFigure: 7 } };
      assert(rt.publish(ctx, f));
      assert.equal(ctx.layer.__somataCoordinatedSpine, false);
      assert.equal(getLayerFrameAuxiliaryPaths(ctx), f.paths);
      // The clone carries a full unmodified native period: its raw tail
      // already meets its next copy without a corrective edge or endpoint fit.
      const scaledNext = (p) => ({
        x: (p.x * Math.cos(f.period) - p.y * Math.sin(f.period)) * f.periodScale,
        y: (p.x * Math.sin(f.period) + p.y * Math.cos(f.period)) * f.periodScale,
      });
      for (const p of f.skeletonFrame) {
        const [head, tail] = [p.graph.edgeSamples[0][0], p.graph.edgeSamples.at(-1).at(-1)];
        near(dist(tail, scaledNext(head)), 0);
        const paths = f.paths.filter((r) => r.skeletonOrbitId === p.points[0].id);
        assert(paths.length && paths.every((r) => !r.spiralExplicitBridge));
        near(dist(paths.at(-1).points.at(-1), scaledNext(paths[0].points[0])), 0);
      }
      const nearOpen = get(0.5, 'manual', {
        order: 0,
        sharedOrder: true,
        orderTransition: { from: 3, to: 0 },
        zeroMode: 'honest',
      });
      finite(nearOpen.paths);
      assert(nearOpen.skeletonFrame.every((p) => !p.phaseFollower));
    }
    for (const mode of ['coordinated', 'coordinatedFromCenter'])
      assert(rt.samplePrimary(spec(mode, a, b), 0.5).paths.every((p) => !p.phaseFollower));
    const lowA = { ...a, spiralOrder: Math.sign(order) },
      lowB = { ...b, spiralOrder: Math.sign(order) };
    assert(rt.samplePrimary(spec('phaseCircle', lowA, lowB), 0.5).paths.every((p) => !p.phaseFollower));
  }
console.log(
  'PASS: seven picker entries, old save migration, phase-circle high-order split/merge, fully formed followers, signed orders and exact endpoints',
);

// Regression: a rapid 1 → 0 → 1 edit used to remain in the frame pipeline
// forever as finished:true, overriding the ordinary coordinated beta.
{
  state.tunnel.active = true;
  state.morph.unifiedMode = 'coordinated';
  const source = winding({
    id: 'blue-order-handoff',
    N: 6,
    K: 1,
    spiralTwist: false,
    spiralZeroTransitionMode: 'layerwise',
    spiralRotationFocusFigure: 3,
    testMorph: { enabled: true, mode: 'coordinated', duration: 1 },
  });
  const target = { ...source, N: 9, K: 3, __morphBoundaryRails: ['old order'] };
  const blue = runtimeState.morph;
  const clock = { active: true, paused: false, phaseStart: 10000, durationMs: 2000, phaseSerial: 199 };
  global.__somataBlueMorphPhaseClock = () => ({ ...clock });
  const setup = (a, b) =>
    Object.assign(blue, {
      renderSourceLayers: [a],
      renderTargetLayers: [b],
      sourceVisuals: [{ ...a }],
      targetVisuals: [{ ...b }],
      gpuPhasePrepareSerial: clock.phaseSerial,
    });
  const frame = (t) => ({
    sourceLayer: source,
    layer: { ...source },
    layerIndex: 0,
    blueMorphProvider: { active: true, geometryActive: true, geometryT: t },
  });
  const check = (now, t, order) => {
    const f = frame(t);
    assert(SomataTestMorph.applyFrame(f, now));
    assert.deepEqual(
      SomataTestMorph.independentOrderStatus().filter((edit) => edit.id === source.id),
      [],
    );
    const fresh = rt.samplePrimary(rt.fromBlue(0), t, { layer: { ...source }, zeroMode: 'layerwise' });
    assert.deepEqual(f.geometryProvider.framePaths, fresh.paths);
    assert.deepEqual(f.__somataSkeletonFrame, fresh.skeletonFrame);
    assert.equal(f.layer.spiralOrder, order);
    assert.equal(f.layer.__somataIndependentOrderCorridor, undefined);
    assert.equal(f.layer.spiralRotationFocusFigure, 3);
    if (order) near(f.layer.__somataCoordinatedPeriodDelta, fresh.period);
  };
  state.layers = [source];
  setup({ ...source }, target);
  setUnifiedSpiralOrder(source, 0);
  assert(SomataTestMorph.beginIndependentOrderEdit(source, 1, 0, 10100));
  assert(SomataTestMorph.applyFrame(frame(0.2), 10400));
  setUnifiedSpiralOrder(source, 1);
  assert(SomataTestMorph.beginIndependentOrderEdit(source, 0, 1, 10401));
  assert(SomataTestMorph.applyFrame(frame(0.55), 11100));
  assert.equal(
    SomataTestMorph.independentOrderStatus().find((edit) => edit.id === source.id).finished,
    false,
  );
  const before = { ...clock };
  check(11401, 0.7, 1);
  assert.deepEqual(clock, before);
  assert.equal(blue.gpuPhasePrepareSerial, before.phaseSerial);
  assert.equal(blue.renderSourceLayers[0].K, 1);
  assert.equal(blue.renderTargetLayers[0].K, 3);
  assert.equal(blue.renderTargetLayers[0].__morphBoundaryRails, undefined);
  for (let i = 0; i < 3; i++) {
    clock.phaseStart += 2000;
    clock.phaseSerial++;
    setup({ ...blue.renderTargetLayers[0] }, { ...target, N: 7 + i, K: 2 });
    for (const t of [0, 0.25, 0.5, 0.75, 1]) check(clock.phaseStart + 2000 * t, t, 1);
  }
  setUnifiedSpiralOrder(source, 0);
  assert(SomataTestMorph.beginIndependentOrderEdit(source, 1, 0, 16500));
  check(17500, 0.75, 0);
  assert.equal(blue.targetVisuals[0].spiralOrder, 0);
  assert.equal(blue.targetVisuals[0].closedLoop, true);
  setUnifiedSpiralOrder(source, 1);
  assert(SomataTestMorph.beginIndependentOrderEdit(source, 0, 1, 17510));
  assert(SomataTestMorph.applyFrame(frame(0.82), 17640));
  assert.equal(SomataTestMorph.independentOrderStatus().find((edit) => edit.id === source.id).from, 0);
  clock.phaseStart = 18000;
  clock.phaseSerial++;
  setup(blue.renderTargetLayers[0], { ...target, spiralOrder: 0, spiralEnabled: false });
  check(18510, 0.255, 1);
  check(19000, 0.5, 1);
  delete global.__somataBlueMorphPhaseClock;
}
console.log(
  'PASS: rapid order retargeting, settled Blue geometry and beta, continued phase serials, return to polygon',
);

// A synchronized manual edit must not wait for a Blue phase when Blue
// is stopped, including when it stops while an edit is already queued.
{
  state.tunnel.active = true;
  const clock = { active: false, paused: false, phaseStart: 0, durationMs: 2000, phaseSerial: 4 };
  global.__somataBlueMorphPhaseClock = () => ({ ...clock });
  for (const stoppedDuringWait of [false, true]) {
    clock.active = stoppedDuringWait;
    clock.phaseStart = stoppedDuringWait ? 39000 : 0;
    const source = winding({
      id: `stopped-blue-${stoppedDuringWait}`,
      N: 4,
      K: 1,
      spiralTwist: false,
      spiralZeroTransitionMode: 'layerwise',
      testMorph: { enabled: true, mode: 'circleSlide', syncWithMorph: true },
    });
    state.layers = [source];
    const status = () => SomataTestMorph.independentOrderStatus().find((edit) => edit.id === source.id);
    const frame = (now) => {
      const f = { sourceLayer: source, layer: { ...source }, layerIndex: 0 };
      assert(SomataTestMorph.applyFrame(f, now));
      return f;
    };
    setUnifiedSpiralOrder(source, 0);
    assert(SomataTestMorph.beginIndependentOrderEdit(source, 1, 0, 40000));
    assert.equal(status().waitingForBluePhase, stoppedDuringWait);
    if (stoppedDuringWait) {
      clock.active = false;
      frame(40200);
    }
    const start = stoppedDuringWait ? 40200 : 40000;
    const mid = frame(start + 1000);
    assert(mid.layer.spiralOrder > 0 && mid.layer.spiralOrder < 1);
    const end = frame(start + 2000);
    assert.equal(end.layer.spiralOrder, 0);
    assert.equal(status(), undefined);
    const path = end.__somataSkeletonFrame[0];
    assert.equal(path.graph?.edges.length ?? path.points.length - Number(!path.closed), 4);
  }
  delete global.__somataBlueMorphPhaseClock;
}
console.log(
  'PASS: synced manual order advances with Blue stopped and completes a queued edit after Blue stops',
);

// The independent order clock can reach zero before the Blue endpoints have
// been rebased. Their wound branch list is not a zero-order polygon skeleton.
{
  const mode = 'coordinatedFromCenter';
  state.tunnel.active = true;
  for (const closed of [true, false])
    for (const zeroMode of ['layerwise', 'honest']) {
      const a = winding({
        N: 16,
        K: 2,
        customSuborbits: 1,
        spiralTwist: false,
        closedLoop: false,
        spiralClosed: closed,
      });
      const b = { ...a, customSuborbits: 2 };
      const flat = (x) => ({ ...x, spiralOrder: 0, spiralEnabled: false, closedLoop: closed });
      const live = { order: 0, zeroMode, sharedOrder: true, orderTransition: { from: 1, to: 0 } };
      const edges = (p) => (p.closed ? p.points.length : p.points.length - 1);
      for (const t of [0.01, 0.25, 0.5, 0.75, 0.99]) {
        const expected = rt.samplePrimary(spec(mode, flat(a), flat(b), 'blue'), t);
        const actual = rt.samplePrimary(spec(mode, a, b, 'blue'), t, live);
        assert.equal(actual.order, 0);
        assert.deepEqual(coords(actual.skeletonFrame), coords(expected.skeletonFrame));
        assert.deepEqual(coords(actual.paths), coords(expected.paths));
        assert.equal(actual.skeletonFrame.length, 2);
        assert.equal(actual.skeletonFrame[1].lifecycle, 'birth');
        assert(actual.skeletonFrame.every((p) => p.closed === closed && edges(p) === (closed ? 8 : 7)));
        if (closed) assert.equal(actual.paths.filter((p) => p.closed).length, 2);
        else
          assert.equal(
            actual.paths.reduce((sum, p) => sum + edges(p), 0),
            14,
          );
      }
    }
}
console.log(
  'PASS: order-zero Blue override restores separate suborbit boundaries and all authored edges, including explicit open paths',
);

// Check the actual command recorder used to instance the line in Corridor.
// At large scale the newborn must not inherit the surviving orbit width.
{
  run(declarations('drawMorphConstructionGuide'), 'guide');
  run(declarations('morphSplineBlend', 'isMixedSplineSegmentTransition'), 'morph width helpers');
  run(declarations('morphPathFillPresence', 'morphFillGhostInfo', 'setPreparedPathFillGhost', 'drawPreparedMorphGeometry'), 'prepared painter');
  run(declarations('createGeometryGLRecordingContext'), 'stroke recorder');
  run(declarations('roundPolylineForDraw'), 'polygon line commands');
  global.WebGPUStrokeRenderer = { isReady: () => true, supportsBezierSpiralCorridor: () => true };
  state.tunnel.active = true;
  const base = layer({ N: 16, K: 2, customSuborbits: 1, spiralTwist: false });
  for (const order of [0, 1])
    for (const origin of ['manual', 'blue']) {
      const a = { ...base, spiralOrder: order, spiralEnabled: order !== 0, closedLoop: order === 0 };
      const b = { ...a, customSuborbits: 2 };
      for (const t of [0.02, 0.2, 0.5, 0.8, 1]) {
        const f = rt.samplePrimary(spec('coordinatedFromCenter', a, b, origin), t);
        const rec = createGeometryGLRecordingContext({ lineWidth: 6 });
        rec.__suppressFill = true;
        rec.scale(8, 8);
        drawPreparedMorphGeometry(rec, a, f.paths, t, 1);
        assert.equal(rec.commands.length, f.paths.length);
        assert(rec.commands.every((c) => c.alpha === 1));
        const expected = t * t * (3 - 2 * t);
        near(Math.min(...rec.commands.map((c) => c.screenLineWidth)), 48 * expected);
        near(Math.max(...rec.commands.map((c) => c.screenLineWidth)), 48);
      }
    }
  delete global.WebGPUStrokeRenderer;
}
console.log(
  'PASS: center-born polygon and spiral line width grows with radius at full opacity, measured on large Corridor stroke commands',
);

// Fractional order is an authored scrub point, not an active edit timer.
for (const sign of [1, -1])
  for (const corridor of [false, true])
    for (const mode of zeroModes) {
      state.tunnel.active = corridor;
      const src = winding({
        id: `static-order-${++seq}`,
        N: 6,
        K: 1,
        spiralOrder: sign * 0.5,
        spiralTwist: false,
        spiralZeroTransitionMode: mode,
        testMorph: { enabled: false, mode: 'coordinated' },
      });
      const plan = zero.sampleOrder(mode, 0, sign, 0.5, corridor);
      const draw = () => {
        const ctx = { sourceLayer: src, layer: { ...src }, layerIndex: 0 };
        assert(SomataTestMorph.applyFrame(ctx));
        finite(ctx.geometryProvider.framePaths);
        near(ctx.layer.spiralOrder, plan.order);
        near(src.spiralOrder, sign * 0.5);
        return ctx;
      };
      const ctx = draw();
      assert.deepEqual(ctx.geometryProvider.framePaths, draw().geometryProvider.framePaths);
      assert(ctx.__somataSkeletonFrame.every((p) => Boolean(p.directLayerwise) === (mode === 'layerwise')));
      if (corridor && mode === 'layerwise') near(ctx.layer.__spiralLayerwiseAngleMix, 0.5);
      if (corridor && mode === 'unfold') near(ctx.layer.__spiralUnfoldPopulation, plan.population);
      if (corridor && ['honest', 'beautiful'].includes(mode))
        near(ctx.layer.__spiralZeroCorridorPopulation, plan.population);
    }
assert.equal(zero.staticOrder(1), null);
assert.equal(zero.staticOrder(-1), null);
assert.equal(zero.staticOrder(0), null);

// Exercise the real Blue provider override with all other bindings switched off.
for (const mode of SomataMorphRegistry.ids())
  for (const transition of zeroModes) {
    state.tunnel.active = true;
    state.morph.unifiedMode = mode;
    for (const [from, to] of [
      [0, 1],
      [1, 0],
      [0, -1],
      [-1, 0],
      [-1, 1],
      [2, 3],
      [0.25, 0.75],
      [-0.75, -0.25],
      [0.5, 0.5],
    ]) {
      const mk = (order) =>
        layer({
          N: 6,
          K: 1,
          spiralOrder: order,
          spiralEnabled: order !== 0,
          closedLoop: order === 0,
          spiralTwist: false,
          spiralZeroTransitionMode: transition,
          id: `automatic-order-${++seq}`,
          testMorph: { enabled: false, mode },
        });
      const source = mk(from),
        target = mk(to);
      Object.assign(runtimeState.morph, { renderSourceLayers: [source], renderTargetLayers: [target] });
      for (const phase of [0, 0.07, 0.14, 0.26, 1 / 3, 0.5, 0.7, 1]) {
        const ctx = {
          sourceLayer: source,
          layer: { ...source },
          layerIndex: 0,
          blueMorphProvider: {
            active: true,
            geometryActive: false,
            lightMorphEnabled: mode === 'light',
            geometryT: phase < 0.5 ? 0 : 1,
            linearProgress: phase,
            options: { bySpiralOrder: true },
          },
        };
        assert(SomataTestMorph.applyFrame(ctx), `${mode} ${transition} ${from}→${to} @${phase}`);
        finite(ctx.geometryProvider.framePaths);
        near(ctx.layer.spiralOrder, zero.blueOrder(transition, from, to, phase, true).order);
        if (phase === 1 && !zero.staticOrder(to)) near(ctx.layer.spiralOrder, to);
      }
    }
  }
// The same elapsed wall time produces the same order independent of
// the overall phase length, and an authored fractional position matches it.
for (const sign of [-1, 1])
  for (const mode of zeroModes) {
    const t = zero.blueOrder(mode, 0, sign, 0.125, true, 8000, 2000);
    const reverse = zero.blueOrder(mode, sign, 0, 0.25, true, 4000, 2000);
    near(t.progress, 0.5);
    near(reverse.progress, 0.5);
    near(t.order, zero.sampleOrder(mode, 0, sign, 0.5, true).order);
    near(reverse.order, t.order);
    assert(t.transitioning);
    const done = zero.blueOrder(mode, 0, sign, 0.25, true, 8000, 2000);
    assert(!done.transitioning);
    near(done.order, sign);
  }
// Square from the visual reference: same four edges, no extra connector,
// and each Corridor copy arrives at its own square in the same position.
state.tunnel.active = true;
for (const mode of SomataMorphRegistry.ids())
  for (const sign of [-1, 1]) {
    const src = winding({
      id: `square-${++seq}`,
      N: 4,
      K: 1,
      spiralOrder: sign * 0.5,
      spiralTwist: false,
      spiralZeroTransitionMode: 'layerwise',
      testMorph: { enabled: false, mode },
    });
    const ctx = { sourceLayer: src, layer: { ...src }, layerIndex: 0 };
    assert(SomataTestMorph.applyFrame(ctx));
    const graph = ctx.__somataSkeletonFrame[0].graph;
    assert.equal(graph.edges.length, 4);
    assert.equal(ctx.geometryProvider.framePaths.length, 4);
    const focus = SomataCorridorFocus.focusPosition(ctx.layer);
    near(getSpiralMorphTunnelPhaseRadians({ position: focus }, ctx.layer), 0);
    near(getSpiralMorphTunnelPhaseRadians({ position: focus + 1 }, ctx.layer), (sign * Math.PI) / 4);
    const flat = sk.anchors({ ...src, spiralOrder: 0, spiralEnabled: false, closedLoop: true })[0].points;
    const full = sk.anchors({ ...src, spiralOrder: sign })[0].points;
    for (const [i, [a, b]] of graph.edgeSamples.entries()) {
      const f = flat[(i + sign + 4) % 4];
      const w = full[i],
        scale = getSpiralClosureRatio();
      const target = { x: -sign * w.y * scale, y: sign * w.x * scale };
      near(Math.hypot(b.x - a.x, b.y - a.y), 0.5 * (dist(a, f) + dist(a, target)));
      const line = ctx.geometryProvider.framePaths[i];
      for (const q of line.points) near((b.x - a.x) * (q.y - a.y) - (b.y - a.y) * (q.x - a.x), 0);
    }
  }
// Wiring checks below search the whole application source (it is no longer one file).
const uiSource = listModules().map(read).join('\n');
const chooseOrder = declarations('chooseMorphSpiralOrderTarget');
const choose = run(
  `(()=>{const randomInt=(lo,hi)=>lo,randomIntExcept=(lo,hi,current)=>lo===current?hi:lo;${chooseOrder}return chooseMorphSpiralOrderTarget;})()`,
  'real order target chooser',
);
Object.assign(state.morph, { options: { bySpiralOrder: true }, spiralOrderMin: 1, spiralOrderMax: 1 });
near(choose(layer()), 1);
state.morph.spiralOrderMin = -1;
state.morph.spiralOrderMax = -1;
near(choose(winding()), -1);
const held = winding({ id: 'held-order' });
state.morph.spiralOrderHoldPhases = 3;
runtimeState.morph.orderHoldHistory = new Map([[held.id, { order: 1, phase: 4 }]]);
for (const phase of [5, 6]) {
  runtimeState.morph.orderCompletedPhases = phase;
  near(choose(held), 1);
}
runtimeState.morph.orderCompletedPhases = 7;
near(choose(held), -1);
state.morph.spiralOrderHoldPhases = 1;
runtimeState.morph.orderCompletedPhases = 5;
near(choose(held), -1);
assert.equal(zero.durationMs({ testMorph: { duration: 2 } }, 5000), 2000);
assert.equal(zero.durationMs({ testMorph: { syncWithMorph: true, duration: 2 } }, 5000), 5000);
near(choose(winding(), 0, new Set()), 0);
state.morph.options.bySpiralOrder = false;
near(choose(winding({ spiralOrder: 0.5 })), 0.5);
assert.match(
  uiSource,
  /spiralOrder: normalizeSpiralOrder\(l\.spiralOrder \?\? defaults\.spiralOrder, false\)/,
);
console.log(
  'PASS: fixed fractional order in all four presets, both signs; actual Blue order-only publication in all seven modes and phase-start timing',
);

load('js/core/parameter-routing.js');
load('js/core/parameter-matrix.js');
const squashDef = SomataParameterRegistry.get('spiral.squashY');
assert.equal(squashDef.morph.framePath, 'spiralSquashY');
assert.equal(squashDef.morph.frameTarget, 'layer');
assert(SomataParameterRegistry.morphable().some((d) => d.id === squashDef.id));
assert.equal(SomataParameterMatrix.get(squashDef.id).group, 'Спирали');
state.morph = { options: {}, unifiedMode: 'coordinated' };
state.minimalMorph = {};
state.tunnel.active = false;
const squashSource = winding({
  id: 'squash-route',
  spiralTwist: false,
  spiralSquashY: 0,
  testMorph: { enabled: false },
});
state.layers = [squashSource];
assert(
  SomataMorphParameterRouting.addBinding(state.morph, state.minimalMorph, squashDef.id, { min: 80, max: 80 }),
);
Object.assign(runtimeState.morph, {
  active: true,
  geometryT: 0.5,
  phaseSerial: 720,
  parameterRouting: null,
  renderSourceLayers: [squashSource],
  renderTargetLayers: [{ ...squashSource }],
});
const squashFrame = {
  layer: { ...squashSource },
  sourceLayer: squashSource,
  layerIndex: 0,
  blueMorphProvider: { active: true, geometryActive: true, geometryT: 0.5 },
};
SomataMorphParameterRouting.applyFrame(squashFrame);
near(squashFrame.layer.spiralSquashY, 40);
assert(SomataTestMorph.applyFrame(squashFrame));
const unsquashed = rt.samplePrimary(rt.fromBlue(0), 0.5, { layer: squashSource });
const maxY = (paths) => Math.max(...paths.flatMap((p) => p.points.map((q) => Math.abs(q.y))));
assert(maxY(squashFrame.geometryProvider.framePaths) < maxY(unsquashed.paths));
assert.deepEqual(
  squashFrame.geometryProvider.framePaths,
  rt.samplePrimary(rt.fromBlue(0), 0.5, { layer: squashSource, spiralSquashY: 40 }).paths,
);
console.log('PASS: shared squash parameter is routed into the actual published Blue spiral contour');
const orange = {};
assert(SomataOrangeMorphProfiles.setBinding(orange, {}, 1, 'spiral.squashY', true, { min: 10, max: 80 }));
assert(
  SomataOrangeMorphProfiles.workingBindings(orange, {}, 1).some(
    (b) => b.parameter === 'spiral.squashY' && b.min === 10 && b.max === 80,
  ),
);

// Fractional input is a position on the chosen transition, not a new
// animated transition. Repeated edits must not leave a rail in Blue.
{
  const zero = SomataSpiralZeroTransition;
  for (const [n, d, expected] of [
    [0, 1, 1],
    [1, -1, 0],
    [0.5, 1, 1],
    [0.5, -1, 0],
    [-0.5, 1, 0],
    [-0.5, -1, -1],
    [20, 1, 20],
    [-20, -1, -20],
  ])
    assert.equal(zero.stepOrder(n, d), expected);
  const count = (p) => p.graph?.edges.length ?? p.points.length - Number(!p.closed);
  for (const mode of ['coordinated', 'coordinatedFromCenter', 'phaseCircle'])
    for (const closed of [true, false]) {
      state.tunnel.active = true;
      state.morph.unifiedMode = mode;
      const source = winding({
        id: `fraction-edit-${mode}-${closed}`,
        N: 16,
        K: 2,
        customSuborbits: 1,
        spiralTwist: false,
        closedLoop: false,
        spiralClosed: closed,
        spiralZeroTransitionMode: 'layerwise',
        testMorph: { enabled: true, mode, syncWithMorph: true },
      });
      state.layers = [source];
      const clock = { active: true, paused: false, phaseStart: 123000, durationMs: 2000, phaseSerial: 93 };
      global.__somataBlueMorphPhaseClock = () => clock;
      const blue = runtimeState.morph;
      Object.assign(blue, {
        gpuPhasePrepareSerial: 93,
        renderSourceLayers: [{ ...source }],
        renderTargetLayers: [{ ...source, customSuborbits: 2 }],
        sourceVisuals: [{ ...source }],
        targetVisuals: [{ ...source }],
      });
      const sample = (t = 0.55) => {
        const f = {
          sourceLayer: source,
          layer: { ...source },
          layerIndex: 0,
          blueMorphProvider: { active: true, geometryActive: true, geometryT: t },
        };
        assert(SomataTestMorph.applyFrame(f, 123200));
        return f;
      };
      const transit = rt.samplePrimary(rt.fromBlue(0), 0.55, {
        order: 0.3,
        zeroMode: 'layerwise',
        orderTransition: { from: 0, to: 1 },
      });
      assert.equal(
        transit.skeletonFrame.length,
        2,
        'spiral anchors must not flatten separate polygon suborbits',
      );
      for (const to of [0.5, 0, -0.5, 0, 0.25, 0]) {
        const from = source.spiralOrder;
        assert(zero.isCalibrationEdit(from, to));
        setUnifiedSpiralOrder(source, to);
        assert(SomataTestMorph.beginIndependentOrderEdit(source, from, to, 123200));
        assert.equal(
          SomataTestMorph.independentOrderStatus().find((x) => x.id === source.id).waitingForBluePhase,
          false,
        );
        const f = sample();
        near(
          f.layer.spiralOrder,
          to === 0 ? 0 : zero.sampleOrder('layerwise', 0, Math.sign(to), Math.abs(to), true).order,
        );
        assert.equal(SomataTestMorph.independentOrderTarget(source.id), null);
        assert.equal(blue.gpuPhasePrepareSerial, 93);
        assert.equal(blue.renderTargetLayers[0].customSuborbits, 2);
        assert.equal(f.__somataSkeletonFrame.length, 2);
        if (to === 0) {
          assert(f.__somataSkeletonFrame.every((p) => p.closed === closed && count(p) === (closed ? 8 : 7)));
          assert.equal(
            f.geometryProvider.framePaths.reduce((s, p) => s + count(p), 0),
            closed ? 16 : 14,
          );
        } else assert(f.__somataSkeletonFrame.every((p) => p.directLayerwise));
      }
      delete global.__somataBlueMorphPhaseClock;
    }
  assert.equal(zero.isCalibrationEdit(0, 1), false);
  assert.equal(zero.isCalibrationEdit(0, -1), false);
}
console.log(
  'PASS: fractional order scrubbing without restarting Blue; separate, complete suborbit skeletons and contour at zero',
);

// Unfold opens just one seam in each original contour. All its interior
// vertices remain shared by both incident edges, including under Y squash.
for (const sign of [-1, 1])
  for (const mode of rt.status().continuous.concat(rt.status().ordinary)) {
    const a = layer({
      id: `unfold-${sign}-${mode}`,
      N: 4,
      spiralTwist: false,
      spiralZeroTransitionMode: 'unfold',
      testMorph: { enabled: false, mode },
    });
    const b = { ...a, spiralOrder: sign, spiralEnabled: true, closedLoop: false };
    const planAt = (t) => zero.plan('unfold', 0, sign, t, true);
    const compute = (from, to, plan) =>
      rt.samplePrimary(spec(mode, from, to), plan.shapeT, { zeroMode: 'unfold', order: plan.order });
    const anchor = sk.anchors(a)[0].points[0];
    for (const t of [0.21, 0.35, 0.6, 0.85, 1]) {
      const plan = planAt(t),
        result = compute(a, b, plan),
        reverse = compute(b, a, zero.plan('unfold', sign, 0, 1 - t, true));
      assert(plan.order * sign > 0 && plan.population > 0, 'new turns open while the source is winding');
      assert.equal(result.skeletonFrame.length, 1);
      const path = result.skeletonFrame[0],
        graph = path.graph;
      assert(path.unfoldSpine && !graph.referenceEdges);
      assert.equal(graph.edges.length, 4);
      assert.equal(graph.nodes.length, 5);
      near(graph.nodes[0].x, anchor.x);
      near(graph.nodes[0].y, anchor.y);
      for (let i = 1; i < graph.edges.length; i++)
        assert.equal(graph.edgeSamples[i - 1][1], graph.edgeSamples[i][0]);
      const root = graph.nodes[0],
        tip = graph.nodes.at(-1),
        c = Math.cos(result.period),
        s = Math.sin(result.period);
      near(tip.x, (c * root.x - s * root.y) * result.periodScale);
      near(tip.y, (s * root.x + c * root.y) * result.periodScale);
      near(reverse.period, result.period);
      near(reverse.periodScale, result.periodScale);
      const f = { ...b, __somataUnfoldSpine: true, __somataContinuousSpiralPeriodScale: result.periodScale };
      zero.applyCorridorFrame(f, 'unfold', 0, sign, t, true, a, b);
      const copies = unfoldCorridorCopies(
        lockContinuousSpiralCopies(spiralCorridorCopiesForLayer(corridorFixture, f, 1000), f),
        f,
      );
      near(copies[4].scale / copies[3].scale, result.periodScale);
      assert(result.paths.length > 0);
    }
    const idle = { sourceLayer: b, layer: { ...b }, layerIndex: 0 };
    state.tunnel.active = true;
    assert(SomataTestMorph.applyFrame(idle));
    assert.deepEqual(coords(idle.geometryProvider.framePaths), coords(compute(a, b, planAt(1)).paths));
    const high = { ...b, spiralOrder: 2 * sign };
    const settled = rt.samplePrimary(spec(mode, high, high), 0, { layer: high });
    assert(settled.skeletonFrame.some((p) => p.unfoldSpine));
    for (const endpoint of [2 * sign, 3 * sign])
      for (const direction of [1, -1]) {
        const from = direction === 1 ? 0 : endpoint,
          to = direction === 1 ? endpoint : 0;
        for (const t of [0.25, 0.5, 0.75, 1]) {
          const rail = zero.blueOrder('unfold', from, to, t, true, 1000, 1000);
          const planned = zero.plan('unfold', from, to, t, true);
          near(rail.order, planned.order);
          assert.equal(rail.from, from);
          assert.equal(rail.to, to);
          if (Math.abs(rail.order) < 1e-8) continue;
          const hi = { ...b, spiralOrder: endpoint };
          const x = rt.samplePrimary(spec(mode, direction === 1 ? a : hi, direction === 1 ? hi : a), t, {
            layer: hi,
            zeroMode: 'unfold',
            order: rail.order,
            orderTransition: rail,
            explicitOrder: true,
            orderOnly: true,
          });
          const p = x.skeletonFrame[0],
            g = p.graph;
          assert(p.unfoldSpine);
          assert.equal(g.edges.length, 4);
          for (let i = 1; i < g.edges.length; i++) assert.equal(g.edgeSamples[i - 1][1], g.edgeSamples[i][0]);
          const root = g.nodes[0],
            tip = g.nodes.at(-1),
            c = Math.cos(x.period),
            sn = Math.sin(x.period);
          near(tip.x, (c * root.x - sn * root.y) * x.periodScale);
          near(tip.y, (sn * root.x + c * root.y) * x.periodScale);
        }
      }
  }
console.log(
  'PASS: Unfold keeps one connected four-edge contour, opens a single seam, and spreads Corridor copies on the same clock; reverse, ± orders and idle handoff',
);

// Force the RNG to return the same number on successive phases. Diversity
// must still change a two-value range, and must not override a fixed range.
{
  const previousRandom = Math.random;
  Math.random = () => 0;
  try {
    state.morph = { options: {}, diversity: true, unifiedMode: 'coordinated' };
    state.minimalMorph = {};
    state.layers = [{ ...squashSource, spiralSquashY: 19 }];
    SomataMorphParameterRouting.addBinding(state.morph, state.minimalMorph, squashDef.id, {
      min: 19,
      max: 20,
    });
    Object.assign(runtimeState.morph, { active: true, geometryT: 1, parameterRouting: null });
    for (let serial = 0; serial < 6; serial++) {
      runtimeState.morph.phaseSerial = 800 + serial;
      const f = { sourceLayer: state.layers[0], layer: { ...state.layers[0] }, layerIndex: 0 };
      SomataMorphParameterRouting.applyFrame(f);
      near(f.layer.spiralSquashY, serial % 2 ? 19 : 20);
    }
    const integerCode = declarations('randomIntExcept', 'chooseMorphInt');
    const chooseInt = run(
      `(()=>{const randomInt=(lo,hi)=>lo;${integerCode}return chooseMorphInt;})()`,
      'live legacy target chooser',
    );
    assert.equal(chooseInt(-1, 1, -1), 0);
    assert.equal(chooseInt(-1, 1, 0), -1);
    assert.equal(chooseInt(1, 1, 1), 1);
  } finally {
    Math.random = previousRandom;
  }
}
console.log(
  'PASS: Diversity changes registered and legacy targets even when RNG repeats, respecting fixed bounds',
);

// Independent unfold: continuity, both signs, exact 13.2 branch endpoints,
// static calibration, Blue order publication and size-based Corridor pivot.
{
  for (const transition of ['seaweed', 'unfoldUntwisted']) {
    const morph = 'coordinated';
    state.morph = { unifiedMode: morph };
    state.tunnel.active = true;
    for (const sign of [-1, 1])
      for (const closed of [true, false])
        for (const twist of [true, false]) {
          const flat = layer({
            id: `unfold-free-${sign}-${closed}-${twist}`,
            N: 12,
            K: 2,
            customSuborbits: 2,
            spiralTwist: twist,
            spiralClosed: closed,
            closedLoop: closed,
            spiralZeroTransitionMode: transition,
            testMorph: { enabled: false, mode: morph },
          });
          const wound = { ...flat, spiralOrder: sign, spiralEnabled: true, closedLoop: false };
          const render = (a, b, t) => {
            const from = a.spiralOrder,
              to = b.spiralOrder;
            const p = zero.plan(transition, from, to, t, true);
            const opts = {
              zeroMode: transition,
              order: p.order,
              orderTransition: { from, to },
              orderOnly: true,
            };
            const ctx = { layer: { ...a }, layerIndex: 0 };
            const geometry = rt.samplePrimary(spec(morph, a, b), p.shapeT, opts);
            assert(rt.publish(ctx, geometry));
            zero.applyCorridorFrame(ctx.layer, transition, from, to, t, true, a, b);
            return { geometry, frame: ctx.layer };
          };
          for (const phase of [0, 0.1, 0.2, 0.21, 0.4, 0.6, 0.8, 1]) {
            const { geometry: g, frame } = render(flat, wound, phase);
            const reverse = render(wound, flat, 1 - phase);
            assert.equal(g.skeletonFrame.length, 2);
            finite(g.paths);
            for (const [i, p] of g.skeletonFrame.entries()) {
              const q = reverse.geometry.skeletonFrame[i];
              for (const [j, n] of p.points.entries()) {
                near(n.x, q.points[j].x);
                near(n.y, q.points[j].y);
              }
              if (phase <= 0.2) {
                assert.equal(p.closed, closed);
                continue;
              }
              assert(p.unfoldUntwisted && !p.graph.referenceEdges);
              assert.equal(p.graph.twist, twist ? 1 : 0);
              assert(p.graph.edges.every((e) => e.kind === 'carrier'));
              assert.equal(p.graph.edges.length, closed ? 6 : 5);
              assert.equal(p.graph.nodes.length, p.graph.edges.length + 1);
              p.graph.edgeSamples
                .slice(1)
                .forEach(([start], j) => assert.equal(start, p.graph.edgeSamples[j][1]));
              if (closed) {
                const a = p.points[0],
                  b = p.points.at(-1),
                  c = Math.cos(g.period) * g.periodScale,
                  d = Math.sin(g.period) * g.periodScale;
                near(b.x, c * a.x - d * a.y);
                near(b.y, d * a.x + c * a.y);
              }
              const a0 = sk.anchors(flat)[i].points[0],
                a1 = p.points[0];
              if (twist) assert(dist(a0, a1) > 1e-8);
              else near(dist(a0, a1), 0);
              for (const [edge, [a, b]] of p.graph.edgeSamples.entries()) {
                const pts = g.paths.find(
                  (x) => x.orbitIndex === p.orbitIndex && x.spiralEdgeIndex === edge,
                )?.points;
                assert(pts?.length >= 2);
                near(pts[0].x, a.x);
                near(pts[0].y, a.y);
                near(pts.at(-1).x, b.x);
                near(pts.at(-1).y, b.y);
              }
            }
            const base = spiralCorridorCopiesForLayer(corridorFixture, frame, 1000);
            const copies = untwistedUnfoldCorridorCopies(base, frame, corridorFixture);
            const pivot = zero.corridorOrigin(corridorFixture);
            const index = copies.findIndex((c) => c.position === pivot.position);
            assert.notEqual(index, 3); // previously used explicit focus in fixture
            near(copies[index].scale, base[index].scale);
            near(getSpiralMorphTunnelPhaseRadians(copies[index], frame), 0);
            assert.equal(copies.length, corridorFixture.length);
            const other = index + 1 < copies.length ? index + 1 : index - 1;
            if (phase === 0.2) copies.forEach((c) => near(c.scale, copies[index].scale));
            if (phase > 0.2 && phase < 1) {
              const separation = copies[other].position - pivot.position;
              near(copies[other]._spiralUntwistedAngle, separation * g.period);
              near(copies[other].scale, copies[index].scale * g.periodScale ** separation);
            }
          }
          const stored = { ...wound, spiralOrder: sign * 0.5 };
          const idle = { sourceLayer: stored, layer: { ...stored }, layerIndex: 0 };
          assert(SomataTestMorph.applyFrame(idle));
          assert(idle.__somataSkeletonFrame.every((p) => p.unfoldUntwisted));
          Object.assign(runtimeState.morph, { renderSourceLayers: [flat], renderTargetLayers: [wound] });
          const blue = {
            sourceLayer: flat,
            layer: { ...flat },
            layerIndex: 0,
            blueMorphProvider: {
              active: true,
              geometryActive: false,
              geometryT: 0.6,
              linearProgress: 0.6,
              options: { bySpiralOrder: true },
            },
          };
          assert(SomataTestMorph.applyFrame(blue));
          assert(blue.__somataSkeletonFrame.every((p) => p.unfoldUntwisted));
          near(blue.layer.spiralOrder, zero.blueOrder(transition, 0, sign, 0.6, true).order);
        }
  }
}
console.log(
  'PASS: both orbit unfold presets: both suborbits, both twist settings, shared vertices and exact Corridor continuations',
);

// The new unswitched unfold must retain the angle between consecutive
// polygon sides, not reshape it by independently rotating the endpoints.
for (const n of [3, 4, 5, 6, 12])
  for (const k of [1, Math.min(2, Math.floor((n - 1) / 2))])
    for (const sign of [-1, 1]) {
      const flat = layer({
        N: n,
        K: k,
        spiralStep: k,
        spiralStepLinked: true,
        spiralTwist: false,
        spiralZeroTransitionMode: 'unfoldUntwisted',
      });
      const wound = { ...flat, spiralOrder: sign, spiralEnabled: true, closedLoop: false };
      const anchors = sk.anchors(flat);
      const edges = (ring) => ring.map((a, i) => [a, ring[(i + 1) % ring.length]]);
      const direction = ([a, b]) => Math.atan2(b.y - a.y, b.x - a.x);
      const turning = (s, i) =>
        zero.shortestEquivalentAngle(direction(s[(i + 1) % s.length]) - direction(s[i]));
      for (const u of [0.00001, 0.1, 0.25, 0.5, 0.8, 1]) {
        const f = rt.samplePrimary(spec('coordinated', flat, wound), u, {
          order: sign * u,
          zeroMode: 'unfoldUntwisted',
        });
        f.skeletonFrame.forEach((p, i) => {
          const source = edges(anchors[i].points),
            target = p.graph.edgeSamples;
          source.forEach((edge, j) => {
            if (j < target.length - 1) near(turning(source, j), turning(target, j));
            assert(dist(...target[j]) > 0);
          });
        });
      }
    }
// The entrance and both unfold modes agree on the original copy even when
// the entrance already changed its displayed scale, or a manual focus exists.
{
  const raw = [
    { position: 1, scale: 0.4 },
    { position: 2, scale: 1.01 },
    { position: 3, scale: 2.4 },
  ];
  raw._corridorOriginPosition = zero.corridorOrigin(raw).position;
  const animated = raw.map((c, i) => ({ ...c, scale: [0.999, 0.82, 1.1][i], alpha: 1 }));
  const layer = {
    spiralEnabled: true,
    spiralOrder: 1,
    spiralManualFocus: true,
    spiralRotationFocusFigure: 3,
    __somataSkeletonCorridorPhase: true,
    __somataCoordinatedPeriodDelta: 0.3,
    __somataUnfoldSpine: true,
    __somataContinuousSpiralPeriodScale: 1.2,
    __spiralUnfoldPopulation: 0.6,
  };
  const twisted = unfoldCorridorCopies(lockContinuousSpiralCopies(animated, layer, raw), layer, raw);
  const untwisted = untwistedUnfoldCorridorCopies(animated, { ...layer, __somataUnfoldUntwisted: true }, raw);
  for (const copies of [twisted, untwisted]) {
    near(copies[1].scale, animated[1].scale);
    near(getSpiralMorphTunnelPhaseRadians(copies[1], layer), 0);
    near(getSpiralMorphTunnelPhaseRadians(copies[2], layer), 0.3);
  }
}
console.log(
  'PASS: polygon corner angles in single-seam unfold; shared Corridor entrance, scale and angular pivot',
);

// Actual transformed square turns must not cross just because the polygon
// step is 90°. Check the visible copy transform, not only the local seam.
{
  const cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const intersects = ([a, b], [c, d]) => {
    const v = [cross(a, b, c), cross(a, b, d), cross(c, d, a), cross(c, d, b)];
    return v.every((x) => Math.abs(x) > 1e-6) && v[0] * v[1] < 0 && v[2] * v[3] < 0;
  };
  const zeroMode = 'unfoldUntwisted';
  for (const sign of [-1, 1])
    for (const spiralTwist of [false, true])
      for (const w of [0.1, 0.25, 0.5, 0.8, 1]) {
        const a = layer({ N: 4, K: 1, spiralTwist, spiralZeroTransitionMode: zeroMode });
        const b = { ...a, spiralOrder: sign, spiralEnabled: true, closedLoop: false };
        const g = rt.samplePrimary(spec('coordinated', a, b), w, {
          order: sign * w,
          zeroMode,
          orderTransition: { from: 0, to: sign },
        });
        const frame = { layer: { ...a } };
        assert(rt.publish(frame, g));
        const raw = [
          { position: -1, scale: 0.7 },
          { position: 0, scale: 1 },
          { position: 1, scale: 1.4 },
          { position: 2, scale: 1.96 },
        ];
        const copies = untwistedUnfoldCorridorCopies(raw, frame.layer, raw);
        const turns = copies.map((copy) => {
          const angle = getMotionTunnelLagRadians(copy, frame.layer),
            c = Math.cos(angle) * copy.scale,
            s = Math.sin(angle) * copy.scale;
          return g.skeletonFrame[0].graph.edgeSamples.map((edge) =>
            edge.map(({ x, y }) => ({ x: c * x - s * y, y: s * x + c * y })),
          );
        });
        for (let i = 0; i < turns.length; i++) {
          if (i) {
            near(turns[i - 1].at(-1)[1].x, turns[i][0][0].x);
            near(turns[i - 1].at(-1)[1].y, turns[i][0][0].y);
          }
          for (let j = i; j < turns.length; j++)
            assert(
              !turns[i].some((a) => turns[j].some((b) => intersects(a, b))),
              `crossed square copies: ${sign}, ${spiralTwist}, ${w}`,
            );
        }
      }
}
console.log(
  'PASS: square Corridor turns join and do not cross at five sampled orders, both signs and twist settings',
);

// A segmented contour stores each side separately. Rounding must operate on
// the actual shared knot, keep the skeleton intact, and leave the open cut.
{
  const src = layer({ id: 'rounded-square', N: 4, spiralTwist: false, rounding: 0.8 });
  const dst = { ...src, spiralEnabled: true, spiralOrder: 1 };
  const frame = { order: 0.5, zeroMode: 'seaweed', orderTransition: { from: 0, to: 1 } };
  const round = rt.samplePrimary(spec('coordinated', src, dst, 'blue'), 0.5, frame);
  const sharp = rt.samplePrimary(
    spec('coordinated', { ...src, spiralRoundSeams: false }, { ...dst, spiralRoundSeams: false }, 'blue'),
    0.5,
    frame,
  );
  assert.equal(round.paths.length, 4);
  assert.deepEqual(coords(round.skeletonFrame), coords(sharp.skeletonFrame));
  for (let i = 1; i < round.paths.length; i++) {
    const a = round.paths[i - 1],
      b = round.paths[i];
    assert(b._somataJoinedCorner);
    assert(!sharp.paths[i]._somataJoinedCorner);
    const p = a._bezierSegments.at(-1),
      q = b._bezierSegments[0];
    assert(dist(p.p3, q.p0) < 1e-9);
    assert(dist(p.p3, sharp.paths[i].points[0]) > 0.01);
    const u = { x: p.p3.x - p.c2.x, y: p.p3.y - p.c2.y },
      v = { x: q.c1.x - q.p0.x, y: q.c1.y - q.p0.y };
    near(u.x * v.y - u.y * v.x, 0);
    assert(u.x * v.x + u.y * v.y > 0);
    assert.equal(buildSpiralBezierSegments(a.points), a._bezierSegments);
  }
  near(dist(round.paths[0]._bezierSegments[0].p0, sharp.paths[0]._bezierSegments[0].p0), 0);
  near(dist(round.paths.at(-1)._bezierSegments.at(-1).p3, sharp.paths.at(-1)._bezierSegments.at(-1).p3), 0);
  global.SomataFeatureHost = { register() {}, provide() {} };
  load('js/render/lamp-plan.js');
  // Load the real per-rail nearest point evaluator; stub only its table
  // construction and the renderer/cache configuration in this Node harness.
  run(declarations(
    'lampVertexArcFractions', 'lampPointAtFraction', 'pointAtPathDistance',
    'nearestLampFractionOnPath', 'nearestLampFractionOnPathSegmentBound',
  ), 'lamp projection');
  run(
    `
        const lampContourAttachmentEnabledForFrame=f=>f.layerLampConfig.snapToContour!==false;
        const lampHash32=s=>[...s].reduce((h,c)=>(h*31+c.charCodeAt(0))>>>0,0);
        function lampPathTable(path){let total=0;const segs=[];for(let i=1;i<path.points.length;i++){
            const a=path.points[i-1],b=path.points[i],len=Math.hypot(b.x-a.x,b.y-a.y);
            segs.push({a,b,len,start:total});total+=len;
        }return {segs,total};}
    `,
    'test lamp settings',
  );
  // The retained curves are used for attachment, including the new fillet.
  const lights = collectPreparedSpiralLampPoints(dst, round.paths, { positionMode: 'key' }, 4);
  assert.deepEqual(
    lights.map((p) => p.pathIndex),
    [0, 1, 2, 3],
  );
  assert.equal(new Set(lights.map((p) => p.lampId)).size, 4);
  assert(lights.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)));
  const corners = collectPreparedSpiralLampPoints(dst, round.paths, { positionMode: 'corners' }, 8);
  assert.deepEqual(
    corners.map((p) => p.pathIndex),
    [0, 1, 2, 3, 0, 1, 2, 3],
  );
  const groups = Array.from({ length: 100 }, (_, i) => [{ pathIndex: i }]);
  assert.deepEqual(
    distributeSpiralLampGroups(groups, 4).map((p) => p.pathIndex),
    [0, 25, 50, 75],
  );
}
console.log('PASS: real shared-corner fillets keep the open seam and skeleton; lamps cover separate rails');

// Regression: regular unscrewed branches are independent locally, but each
// joins itself in the adjacent Corridor instance. Test the recorded Béziers
// (not just the skeleton), using a curved profile and the actual copy matrix.
{
  const original = state.tunnel.active;
  state.tunnel.active = true;
  for (const mode of ['coordinated', 'coordinatedFromCenter'])
    for (const origin of ['manual', 'blue'])
      for (const sign of [-1, 1])
        for (const profileMode of ['segments', 'spline']) {
          const a = winding({
            N: 8,
            K: 1,
            spiralTwist: false,
            spiralOrder: sign,
            rounding: 0.7,
            profileMode,
            profileNodes: [
              { x: 0, y: 0 },
              { x: 0.38, y: 0.17 },
              { x: 0.72, y: 0.11 },
              { x: 1, y: 0 },
            ],
            spiralTangential: false,
          });
          const b = { ...a, K: 2 };
          const get = (a, b, u) => rt.samplePrimary(spec(mode, a, b, origin), u);
          for (const t of [0, 0.35, 1]) {
            const f = get(a, b, t),
              sharp = get({ ...a, spiralRoundSeams: false }, { ...b, spiralRoundSeams: false }, t);
            const zero = get({ ...a, rounding: 0 }, { ...b, rounding: 0 }, t);
            assert.deepEqual(coords(f.skeletonFrame), coords(sharp.skeletonFrame));
            assert.equal(f.paths.length, sharp.paths.length);
            const frame = { layer: { ...a } };
            rt.publish(frame, f);
            const copies = lockContinuousSpiralCopies(
              [
                { position: 0, scale: 1 },
                { position: 1, scale: 2 },
              ],
              frame.layer,
            );
            const scale = copies[1].scale / copies[0].scale;
            const phi =
              getMotionTunnelLagRadians(copies[1], frame.layer) -
              getMotionTunnelLagRadians(copies[0], frame.layer);
            const map = ({ x, y }) => ({
              x: scale * (Math.cos(phi) * x - Math.sin(phi) * y),
              y: scale * (Math.sin(phi) * x + Math.cos(phi) * y),
            });
            for (let i = 0; i < f.paths.length; i++) {
              const rail = f.paths[i];
              assert(rail._somataJoinedCorner, `${mode} ${origin} ${sign} ${profileMode} ${t} ${i}`);
              assert(!sharp.paths[i]._somataJoinedCorner && !zero.paths[i]._somataJoinedCorner);
              let rendered;
              strokeVariableWidthSpiralPath(
                {
                  lineWidth: 2,
                  globalAlpha: 1,
                  __spiroNativeBezierSpiral: true,
                  __recordVariableWidthBezierSpiral(q) {
                    rendered = q;
                    return true;
                  },
                },
                rail.points,
                0.7,
                rail.cornerFlags,
                profileMode === 'spline',
                a,
              );
              assert.equal(rendered, rail._bezierSegments);
              const first = rendered[0],
                last = rendered.at(-1);
              near(dist(last.p3, map(first.p0)), 0);
              const q = map(first.c1),
                p = last.p3,
                ux = p.x - last.c2.x,
                uy = p.y - last.c2.y,
                vx = q.x - p.x,
                vy = q.y - p.y;
              near(ux * vy - uy * vx, 0);
              assert(ux * vx + uy * vy > 0);
              assert(dist(first.p0, sharp.paths[i]._bezierSegments[0].p0) > 0.1);
            }
          }
          const open = get({ ...a, spiralClosed: false }, { ...b, spiralClosed: false }, 0.35);
          assert(open.paths.every((p) => !p._somataJoinedCorner));
          // Как в 13.2, скругление спирали не зависит от Corridor: без него замкнутая
          // ветка по-прежнему скругляется в шве, а открытая остаётся открытой.
          state.tunnel.active = false;
          assert(get(a, b, 0.35).paths.some((p) => p._somataJoinedCorner));
          assert(
            get({ ...a, spiralClosed: false }, { ...b, spiralClosed: false }, 0.35).paths.every(
              (p) => !p._somataJoinedCorner,
            ),
          );
          state.tunnel.active = true;
        }
  state.tunnel.active = original;
}
console.log(
  'PASS: rounded reference branches on the actual Corridor stroke commands, matched tangents, open seams and unmodified skeleton',
);

// Real prepared-lamp path: key-only ignores bend and sample vertices; corner
// mode adds only the bend. An interrupted attack releases from the last level.
{
  run('const lampAdaptiveFrame={needsSettle:false};', 'lamp bend test state');
  run(
    declarations(
      'lampBendAnimationMs',
      'updateLampBendLevel',
      'mergeLampKeysAndBends',
      'lampBendTracks',
      'trackLampBends',
    ),
    'lamp bend lifecycle',
  );
  const l = layer({ id: 'bend-lifecycle', spiralOrder: 2, spiralEnabled: true });
  const path = (bent) => [
    {
      spiralOrder: 2,
      spiralEdgeIndex: 0,
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 2, y: 0 },
        { x: 3, y: bent ? 1 : 0 },
        { x: 4, y: bent ? 2 : 0 },
      ],
      lampCornerFlags: [false, true, false, false, false],
      cornerFlags: [false, false, bent, false, false],
    },
  ];
  const collect = (mode, now, bent) =>
    collectPreparedSpiralLampPoints(l, path(bent), { positionMode: mode, snapToContour: false }, 20, {
      now,
      lampAnimationMs: 1000,
    });
  assert.deepEqual(
    collect('key', 0, true).map((p) => p.vertexIndex),
    [0, 4],
  );
  assert.deepEqual(
    collect('corners', 0, false).map((p) => p.vertexIndex),
    [0, 1, 4],
  );
  assert.equal(collect('corners', 100, true).length, 3);
  const at = (now, bent) => collect('corners', now, bent).find((p) => p.vertexIndex === 2);
  near(at(350, true).lampLevel, 0.25);
  near(at(400, false).lampLevel, 0.25);
  near(at(900, false).lampLevel, 0.125);
  assert.equal(at(1400, false), undefined);
  assert.equal(at(1500, true), undefined);
  near(at(2500, true).lampLevel, 1);
  assert(
    collect('corners', 2600, true)
      .filter((p) => p.vertexIndex !== 2)
      .every((p) => p.lampLevel === undefined),
  );
}
console.log('PASS: key-only markers, added bend markers, interrupted 1 s attack/release and full 1 s attack');

// A profile-only phase must reach the same authored rail that the next phase
// starts from. Check the stroke recorder after a large Corridor transform, and
// check the lamp positions by logical key rather than by polyline index.
{
  const oldCorridor = state.tunnel.active;
  state.tunnel.active = true;
  global.WebGPUStrokeRenderer = { isReady: () => true, supportsBezierSpiralCorridor: () => true };
  const contour = (curves) =>
    curves.flatMap((q, j) => Array.from({ length: 25 }, (_, i) => phaseCubicAt(q, i / 24)).slice(j ? 1 : 0));
  const pointToLine = (p, a, b) => {
    const x = b.x - a.x,
      y = b.y - a.y,
      t = Math.max(0, Math.min(1, ((p.x - a.x) * x + (p.y - a.y) * y) / (x * x + y * y || 1)));
    return Math.hypot(p.x - a.x - x * t, p.y - a.y - y * t);
  };
  const directed = (a, b) =>
    a.reduce((max, p) => {
      let best = Infinity;
      for (let i = 1; i < b.length; i++) {
        best = Math.min(best, pointToLine(p, b[i - 1], b[i]));
        if (best < 1e-7) break;
      }
      return Math.max(max, best);
    }, 0);
  for (const order of [-1, 1])
    for (const origin of ['blue', 'manual'])
      for (const reverse of [false, true]) {
        const a = winding({
          N: 6,
          K: 1,
          spiralOrder: order,
          spiralTwist: false,
          rounding: 0.7,
          profileNodes: [
            { x: 0, y: 0 },
            { x: 0.24, y: 0.3 },
            { x: 0.55, y: -0.3 },
            { x: 0.8, y: 0.15 },
            { x: 1, y: 0 },
          ],
        });
        const b = { ...a, profileMode: 'spline', splineRenderMode: 'smooth' };
        const [from, to] = reverse ? [b, a] : [a, b];
        const phase = spec('coordinated', from, to, origin);
        const draw = (s, t) => {
          const sampled = rt.samplePrimary(s, t),
            rec = createGeometryGLRecordingContext({ lineWidth: 3 });
          rec.__suppressFill = true;
          rec.scale(6, 6);
          rec.rotate(0.4);
          drawPreparedMorphGeometry(
            rec,
            t < 0.5 ? s.sourceLayer : s.targetLayer,
            sampled.paths,
            t,
            1,
            s.sourceLayer.profileMode,
            s.targetLayer.profileMode,
          );
          assert(
            rec.commands.length === sampled.paths.length &&
              rec.commands.every((q) => q.__variableWidthBezierSpiral),
          );
          return { sampled, contour: contour(rec.commands[0].bezierSegments) };
        };
        for (const [t, nearT, endpoint] of [
          [0, 0.00001, from],
          [1, 0.99999, to],
        ]) {
          const f = draw(phase, t),
            g = draw(phase, nearT),
            authored = draw(spec('coordinated', endpoint, endpoint, origin), 0);
          assert(f.sampled.paths.every((p) => p.profileCurveBaked && p.points._somataFinalProfileCubics));
          assert(directed(f.contour, g.contour) < 0.02);
          assert(
            Math.max(directed(f.contour, authored.contour), directed(authored.contour, f.contour)) < 0.12,
          );
        }
        const lights = (t) =>
          collectPreparedSpiralLampPoints(
            a,
            rt.samplePrimary(phase, t).paths,
            { positionMode: 'corners', snapToContour: false },
            260,
          ).filter((p) => p.pathIndex === 0 && p.__profileLampKey);
        const first = lights(0.49999),
          last = lights(0.50001);
        assert(first.length > 0, 'profile knots are still present');
        for (const p of first) {
          const q = last.find((q) => q.lampId === p.lampId);
          assert(q && dist(p, q) < 0.02, `moving knot ${p.lampId}`);
        }
      }
  delete global.WebGPUStrokeRenderer;
  state.tunnel.active = oldCorridor;
}
console.log(
  'PASS: mixed-profile endpoints and neighboring frames on Corridor stroke commands; continuous logical lamp attachment',
);


// The same target must produce the same rounded seam when the next phase
// starts with a larger slot table. A zero-length extra slot used to block it.
for (const mode of ['coordinated', 'coordinatedFromCenter', 'phaseCircle']) {
  const middle = winding({
    N: 6,
    spiralTwist: true,
    rounding: 1.6,
    profileNodes: [
      { x: 0, y: 0 }, { x: 0.24, y: 0.3 }, { x: 0.55, y: -0.3 },
      { x: 0.8, y: 0.15 }, { x: 1, y: 0 },
    ],
  });
  const previous = spec(mode, { ...middle, N: 5 }, middle, 'blue');
  const next = spec(mode, middle, { ...middle, N: 7 }, 'blue');
  const terminal = rt.samplePrimary(previous, 1);
  const initial = rt.samplePrimary(next, 0);
  assert.equal(terminal.paths.length, initial.paths.length);
  terminal.paths.forEach((path, i) => {
    const a = path._bezierSegments, b = initial.paths[i]._bezierSegments;
    assert.equal(a.length, b.length, mode);
    a.forEach((q, j) => {
      for (const key of ['p0', 'c1', 'c2', 'p3']) assert(dist(q[key], b[j][key]) < 1e-7, mode);
    });
  });
  const contour = (frame) => frame.paths.filter((path) => (path._alpha ?? 1) > 0.99).flatMap((path) =>
    path._bezierSegments.flatMap((q, i) => Array.from(
      { length: 33 - Number(i > 0) },
      (_, step) => phaseCubicAt(q, (step + Number(i > 0)) / 32),
    )),
  );
  const separation = (a, b) => Math.max(...a.map((p) => {
    let distance = Infinity;
    for (let i = 1; i < b.length; i++) {
      const x = b[i].x - b[i - 1].x, y = b[i].y - b[i - 1].y;
      const u = Math.max(0, Math.min(1, ((p.x - b[i - 1].x) * x + (p.y - b[i - 1].y) * y) / (x * x + y * y || 1)));
      distance = Math.min(distance, Math.hypot(p.x - b[i - 1].x - u * x, p.y - b[i - 1].y - u * y));
    }
    return distance;
  }));
  const fixed = contour(terminal);
  for (const frame of [rt.samplePrimary(previous, 0.99999), rt.samplePrimary(next, 0.00001)]) {
    const nearby = contour(frame);
    const delta = Math.max(separation(fixed, nearby), separation(nearby, fixed));
    assert(delta < 0.01, `${mode}: super-rounding near boundary jumps by ${delta}`);
  }
  if (mode === 'phaseCircle') {
    const twist = spec(mode, { ...middle, spiralTwist: false }, middle, 'blue');
    for (const [edge, inside] of [[0, 0.00001], [1, 0.99999]]) {
      const a = contour(rt.samplePrimary(twist, edge));
      const b = contour(rt.samplePrimary(twist, inside));
      const delta = Math.max(separation(a, b), separation(b, a));
      assert(delta < 0.01, `${mode}: twist handoff jumps by ${delta}`);
    }
  }
}


// A new correspondence slot must not move the existing rounded rails or
// draw a full-width dot at the old sharp corner when the slot is born.
for (const mode of ['topology', 'circleSlide']) {
  const source = winding({
    N: 6,
    spiralTwist: true,
    rounding: 1.65,
    profileNodes: [
      { x: 0, y: 0 }, { x: 0.24, y: 0.3 }, { x: 0.55, y: -0.3 },
      { x: 0.8, y: 0.15 }, { x: 1, y: 0 },
    ],
  });
  const phase = spec(mode, source, { ...source, N: 7, rounding: 1.9 }, 'blue');
  const fixed = rt.samplePrimary(phase, 0).paths;
  const nearby = rt.samplePrimary(phase, 0.000001).paths;
  const growing = nearby.filter((p) => p._alpha < 0.99);
  const visible = nearby.filter((p) => p._alpha >= 0.99);
  assert.equal(growing.length, 1, mode);
  assert(growing[0]._alpha < 0.00001, mode);
  assert.equal(visible.length, fixed.length, mode);
  fixed.forEach((path, i) => {
    const a = path._bezierSegments, b = visible[i]._bezierSegments;
    assert.equal(a.length, b.length, mode);
    a.forEach((q, j) => {
      for (const key of ['p0', 'c1', 'c2', 'p3']) assert(dist(q[key], b[j][key]) < 0.001, mode);
      for (const key of ['widthScale0', 'widthScale1']) assert(Math.abs(q[key] - b[j][key]) < 0.001, mode);
    });
  });
}


// Rounded order-zero Blue frames must reach the 13.2 anchor renderer,
// which applies the Spline+ correction against the static phase endpoints.
{
  const priorMode = state.morph.unifiedMode;
  const priorLayers = state.layers;
  for (const [mode, kind] of [['topology', 'blue-anchor-linear'], ['circleSlide', 'blue-circle-slide']]) {
    state.morph.unifiedMode = mode;
    for (const rounding of [0.65, 1.65]) {
      const source = layer({
        id: `legacy-spline-plus-${mode}-${rounding}`,
        N: 7, K: 2, spiralOrder: 0, spiralEnabled: false, spiralZeroTransitionMode: 'layerwise',
        rounding, roundingCornerType: 'classic', testMorph: { enabled: false },
      });
      const target = { ...source, N: 8 };
      state.layers = [source];
      runtimeState.morph.renderSourceLayers = [source];
      runtimeState.morph.renderTargetLayers = [target];
      for (const t of [0, 0.00001, 0.99999, 1]) {
        const provider = {
          kind, mode, active: true, geometryActive: true, geometryT: t, sourceLayer: source, targetLayer: target,
        };
        const frame = {
          layer: { ...source }, sourceLayer: source, layerIndex: 0,
          blueMorphProvider: provider, geometryProvider: provider,
        };
        SomataTestMorph.applyFrame(frame, 250);
        assert.equal(frame.geometryProvider, provider, `${mode} ${rounding} ${t}`);
      }
    }
  }
  state.morph.unifiedMode = priorMode;
  state.layers = priorLayers;
}


{
  const line = (a, b) => ({
    p0: { x: a, y: 0 }, c1: { x: a + (b - a) / 3, y: 0 },
    c2: { x: a + (b - a) * 2 / 3, y: 0 }, p3: { x: b, y: 0 },
  });
  const sharedStation = 0.500000004;
  const pieces = profileCubicPartition(
    [line(0, 1), line(1, 2)],
    [0, sharedStation, 1],
    [0, 0.5, sharedStation, 1],
  );
  assert(pieces && pieces.length === 3);
  assert(pieces[1].p3.x > pieces[1].p0.x, 'neighboring knots retain the tiny interval');
  near(pieces[1].p3.x, pieces[2].p0.x);
}

{
  load('js/geometry/spline-corner-mode.js');
  const outline = [{ x: 80, y: 0 }, { x: 0, y: 90 }, { x: -70, y: 0 }, { x: 0, y: -95 }];
  const flags = outline.map(() => true);
  const record = (draw) => {
    const commands = [];
    const sink = new Proxy({}, { get: (_, type) => (...args) => commands.push([type, ...args]) });
    draw(sink);
    return commands;
  };
  const layer = { roundingCornerType: 'simple' };
  for (const strength of [0.65, 1.65]) {
    const simple = record((ctx) => roundPolylineForDraw(ctx, outline, true, strength, flags, null, false, null, layer));
    const reference = record((ctx) => roundPolylineForDraw(ctx, outline, true, strength, flags, outline.map(() => 1)));
    assert.deepEqual(simple, reference);
    assert(simple.some(([key]) => key === 'quadraticCurveTo'));
    assert.deepEqual(record((ctx) => somataDrawSplineCornerMode(ctx, outline, true, strength, {
      layer, cornerFlags: flags,
    })), simple);
  }
}
