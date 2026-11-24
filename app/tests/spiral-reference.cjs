// Compares static spiral geometry with an older release (classic-script build such as 13.2 or 15):
//   node tests/spiral-reference.cjs /path/to/extracted/Somata_13.2
// Not part of `npm test` because it needs the reference build on disk.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const { read, moduleAsScript, declarations } = require('./helpers/source.cjs');

const ref = process.argv[2] && path.resolve(process.argv[2]);
if (!ref) {
  console.error('Usage: node tests/spiral-reference.cjs /path/to/extracted/Somata_13.2');
  process.exit(2);
}
// Shared stubs: the same "test state" block the behavioural suite uses.
const stubs = read('tests/morph-skeleton.test.cjs').split('run(`')[1].split("`, 'test state'")[0];
const newContext = () => {
  const c = vm.createContext({
    console,
    noteSuppressedError() {},
    profileCanvas: { addEventListener() {} },
    addEventListener() {},
    document: {
      addEventListener() {},
      getElementById() {
        return { addEventListener() {} };
      },
    },
  });
  c.window = c;
  return c;
};

// Reference build: classic scripts, sliced the way that build was laid out.
function referenceKernel(dir) {
  const c = newContext();
  const run = (s) => vm.runInContext(s, c);
  run(stubs);
  const lamp = fs.readFileSync(`${dir}/js/app/lamp-audio-core.js`, 'utf8');
  const i = lamp.indexOf('        function roundPolylineForDraw');
  run(lamp.slice(i, lamp.indexOf('\n        function ', i + 1)));
  const core = fs.readFileSync(`${dir}/js/app/geometry-gpu-core.js`, 'utf8');
  run(core.slice(0, core.indexOf('        function hexToRgbaParts')));
  run(fs.readFileSync(`${dir}/js/geometry/spline.js`, 'utf8'));
  if (fs.existsSync(`${dir}/js/geometry/skeleton-runtime.js`))
    run(fs.readFileSync(`${dir}/js/geometry/skeleton-runtime.js`, 'utf8'));
  return c;
}
// Current build: the modules that replaced that slice, run as scripts in the same kind of sandbox.
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
function currentKernel() {
  const c = newContext();
  const run = (s, f) => vm.runInContext(s, c, { filename: f });
  run(stubs);
  c.getLayerVersions = (layer) => ({ geometry: layer?._geometryVersion });
  c.isCurrentFrameDynamicPathList = () => false;
  run(moduleAsScript('js/geometry/polyline-rounding.js'), 'polyline-rounding');
  run(declarations('getMorphReferenceRadius', 'getLayerReferenceRadius'), 'reference circle');
  run(KERNEL_MODULES.map(moduleAsScript).join('\n'), 'geometry kernel');
  run(moduleAsScript('js/geometry/spline.js'), 'spline');
  run(moduleAsScript('js/geometry/skeleton-runtime.js'), 'skeleton-runtime');
  return c;
}

const a = referenceKernel(ref),
  b = currentKernel();
let cases = 0,
  error = 0;
for (const [N, K, extra] of [
  [3, 1, {}],
  [8, 2, {}],
  [7, 3, {}],
  [6, 3, { customSuborbits: 2 }],
  [5, 1, { spiralStepLinked: false, spiralStep: 1.3, __spiralAnimatedN: 5.2 }],
])
  for (const spiralOrder of [-2, -0.4, 0.4, 1, 2.6])
    for (const [spiralClosed, spiralRoundSeams] of [
      [false, false],
      [true, false],
      [true, true],
    ])
      for (const spiralTangential of [false, true, 0.3])
        for (const [profileMode, profileNodes, rounding, wholeCurveSpline] of [
          [
            'segments',
            [
              { x: 0, y: 0 },
              { x: 1, y: 0 },
            ],
            0,
            false,
          ],
          [
            'segments',
            [
              { x: -0.06, y: 0.09 },
              { x: 0.35, y: 0.15 },
              { x: 1.07, y: -0.06 },
            ],
            0.4,
            false,
          ],
          [
            'spline',
            [
              { x: 0, y: 0 },
              { x: 0.47, y: 0.12 },
              { x: 1, y: 0 },
            ],
            0,
            false,
          ],
          [
            'spline',
            [
              { x: 0, y: 0 },
              { x: 0.47, y: 0.12 },
              { x: 1, y: 0 },
            ],
            0,
            true,
          ],
        ]) {
          const l = {
            N,
            K,
            radius: 150,
            rotation: 23,
            closedLoop: true,
            spiralEnabled: true,
            spiralTwist: false,
            spiralOrder,
            spiralClosed,
            spiralRoundSeams,
            spiralTangential: spiralTangential === true,
            __spiralTangentialMix: spiralTangential === 0.3 ? 0.3 : undefined,
            profileMode,
            profileNodes,
            rounding,
            wholeCurveSpline,
            ...extra,
          };
          const x = a.buildOrbitPolylines(l),
            y = b.buildOrbitPolylines(l);
          const label = JSON.stringify(l);
          const near = (p, q) => {
            const e = Math.abs(p - q);
            assert(e < 1e-7, `${label} ${p} != ${q} (${e})`);
            error = Math.max(error, e);
          };
          const point = (p, q) => {
            near(p.x, q.x);
            near(p.y, q.y);
            if (p.widthScale != null) near(p.widthScale, q.widthScale);
          };
          assert.equal(x.length, y.length, label);
          x.forEach((p, i) => {
            const q = y[i];
            assert.equal(p.spiralBranchIndex, q.spiralBranchIndex, label);
            assert.equal(p.points.length, q.points.length, label);
            p.points.forEach((pt, j) => point(pt, q.points[j]));
            assert.equal(p._bezierSegments?.length, q._bezierSegments?.length, label);
            p._bezierSegments?.forEach((seg, j) =>
              ['p0', 'c1', 'c2', 'p3'].forEach((k) => point(seg[k], q._bezierSegments[j][k])),
            );
          });
          cases++;
        }
console.log(`PASS: ${cases} static branch/profile cases match the reference build; max error ${error}`);
