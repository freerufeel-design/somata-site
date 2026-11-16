// Static geometry must stay exactly as it was in the original Somata 15.
//
// buildOrbitPolylines is the geometric heart of the app: polygon/spiral skeleton, signed and
// fractional spiral orders, open/closed spirals with rounded seams, tangential mixing, segment and
// spline profiles with rounding, custom suborbits, chaos stars. The fixture holds, for 3024
// combinations, a hash of the result computed by the original (pre-refactor) build in Chrome.
// Coordinates are rounded to 1e-6 before hashing because Node's and Chrome's Math functions may
// differ in the last bit; any real change to the geometry changes the hash.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadApp } from './helpers/app-env.mjs';

const fixture = JSON.parse(
  fs.readFileSync(new URL('./fixtures/geometry-reference.json', import.meta.url), 'utf8'),
);

const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);
function geometryHash(paths) {
  let h = 2166136261 >>> 0;
  const mix = (x) => {
    h ^= x >>> 0;
    h = Math.imul(h, 16777619) >>> 0;
  };
  const num = (v) => {
    if (typeof v !== 'number') {
      mix(v === undefined ? 0xa1 : v === null ? 0xa2 : v ? 0xa3 : 0xa4);
      return;
    }
    const r = Math.round(v * 1e6);
    f64[0] = Object.is(r, -0) ? 0 : r;
    mix(u32[0]);
    mix(u32[1]);
  };
  const pt = (q) => {
    num(q?.x);
    num(q?.y);
  };
  if (!Array.isArray(paths)) return 'na';
  mix(paths.length);
  for (const p of paths) {
    const pts = p?.points || [];
    mix(pts.length);
    for (const q of pts) {
      pt(q);
      num(q.widthScale);
    }
    num(Boolean(p?.closed));
    num(p?.spiralBranchIndex);
    num(p?.orbitIndex);
    const segs = p?._bezierSegments || [];
    mix(segs.length);
    for (const sg of segs) {
      pt(sg.p0);
      pt(sg.c1);
      pt(sg.c2);
      pt(sg.p3);
    }
  }
  return h.toString(16);
}

// Must match tools/geometry-golden.cjs exactly (same order, same labels).
function* gridCases() {
  const profiles = [
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
      'segments',
      [
        { x: 0, y: 0 },
        { x: 0.3, y: -0.2 },
        { x: 0.6, y: 0.25 },
        { x: 1, y: 0 },
      ],
      0.9,
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
    [
      'spline',
      [
        { x: 0, y: 0 },
        { x: 0.25, y: -0.15 },
        { x: 0.7, y: 0.2 },
        { x: 1, y: 0 },
      ],
      0.5,
      false,
    ],
  ];
  const shapes = [
    [3, 1, {}],
    [4, 1, {}],
    [8, 2, {}],
    [7, 3, {}],
    [6, 3, { customSuborbits: 2 }],
    [5, 1, { spiralStepLinked: false, spiralStep: 1.3, __spiralAnimatedN: 5.2 }],
    [9, 4, { rounding: 0.6 }],
    [5, 2, { chaosStar: true, chaosSeed: 7 }],
  ];
  for (const [N, K, extra] of shapes)
    for (const spiralOrder of [0, -2, -0.4, 0.4, 1, 2.6, 3])
      for (const [spiralClosed, spiralRoundSeams] of [
        [false, false],
        [true, false],
        [true, true],
      ])
        for (const spiralTangential of [false, true, 0.3])
          for (const [profileMode, profileNodes, rounding, wholeCurveSpline] of profiles) {
            const layer = {
              N,
              K,
              radius: 150,
              rotation: 23,
              closedLoop: true,
              spiralEnabled: spiralOrder !== 0,
              spiralTwist: false,
              spiralOrder,
              spiralClosed,
              spiralRoundSeams,
              spiralTangential: spiralTangential === true,
              __spiralTangentialMix: spiralTangential === 0.3 ? 0.3 : undefined,
              profileMode,
              profileNodes: profileNodes.map((p) => ({ ...p })),
              rounding,
              wholeCurveSpline,
              ...extra,
            };
            const label = `grid N${N}K${K}${JSON.stringify(extra)} o${spiralOrder} c${spiralClosed}/${spiralRoundSeams} t${spiralTangential} ${profileMode}${profileNodes.length}/${rounding}/${wholeCurveSpline}`;
            yield { label, layer };
          }
}

test('buildOrbitPolylines matches the original Somata 15 on 3024 parameter combinations', async () => {
  const api = await loadApp();
  const failures = [];
  let i = 0;
  for (const { label, layer } of gridCases()) {
    const expected = fixture.cases[i++];
    assert.equal(label, expected.label, 'case list out of sync with the fixture');
    let actual;
    try {
      actual = geometryHash(api.buildOrbitPolylines(layer));
    } catch (e) {
      actual = 'threw: ' + e.message;
    }
    if (actual !== expected.qh)
      failures.push(
        `${label}: expected ${expected.qh} (${expected.paths} paths, ${expected.points} points), got ${actual}`,
      );
  }
  assert.equal(i, fixture.cases.length);
  assert.deepEqual(failures.slice(0, 10), [], `${failures.length} geometry cases changed`);
});
