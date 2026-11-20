// Graffiti with size variation draws every contour segment as its own ribbon. Where two ribbons
// continue one another (a bridge wedge fills the corner), their meeting cap edges lie inside the
// stroke and must not be anti-aliased: fading both leaves a dark hairline along the corner.
const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const { declarations } = require('./helpers/source.cjs');

const ctx = vm.createContext({ assert, noteSuppressedError() {} });
const exec = (code) => vm.runInContext(code, ctx);
const run = (code) => exec(`(() => {\n${code}\n})()`);

exec(
  declarations(
    'graffitiNibStretch',
    'graffitiNibWidthFactor',
    'graffitiFocusDistance',
    'graffitiRotationProgress',
    'resolveGraffitiVariationProgress',
    'graffitiSupportOffset',
    'graffitiPathStrokeGrowth',
    'computeGraffitiVariableRibbonSides',
    'buildGraffitiPlainPointedRibbonMesh',
    'buildGraffitiVariableRibbonMesh',
    'graffitiRibbonJoin',
    'graffitiPlanJoins',
  ),
);

const piece = (a, b, chain, extra = {}) => ({
  path: { points: [a, b], closed: false },
  vary: true,
  chain,
  ...extra,
});
ctx.piece = piece;

test('consecutive pieces of one chain join and lose their inner caps', () => {
  const r = run(`
    const plan = [piece({x:0,y:0},{x:100,y:0},0), piece({x:100,y:0},{x:100,y:100},0)];
    return graffitiPlanJoins(plan, 'pointed');
  `);
  assert.equal(r.bridges.length, 1);
  assert.deepEqual(Array.from(r.capStart), [true, false]);
  assert.deepEqual(Array.from(r.capEnd), [false, true]);
});

test('a closed contour split into pieces also joins its last piece to its first', () => {
  const r = run(`
    const sq = [{x:0,y:0},{x:100,y:0},{x:100,y:100},{x:0,y:100}];
    const plan = sq.map((p, i) => piece(p, sq[(i + 1) % 4], 0));
    return graffitiPlanJoins(plan, 'pointed');
  `);
  assert.equal(r.bridges.length, 4);
  assert.deepEqual(Array.from(r.capStart), [false, false, false, false]);
  assert.deepEqual(Array.from(r.capEnd), [false, false, false, false]);
});

test('an open chain keeps the caps at its two free ends', () => {
  const r = run(`
    const plan = [piece({x:0,y:0},{x:100,y:0},0), piece({x:100,y:0},{x:100,y:100},0), piece({x:100,y:100},{x:0,y:200},0)];
    return graffitiPlanJoins(plan, 'pointed');
  `);
  assert.equal(r.bridges.length, 2);
  assert.deepEqual(Array.from(r.capStart), [true, false, false]);
  assert.deepEqual(Array.from(r.capEnd), [false, false, true]);
});

test('pieces that do not meet, differ in chain, or opt out stay separate', () => {
  const apart = run(
    `return graffitiPlanJoins([piece({x:0,y:0},{x:100,y:0},0), piece({x:120,y:0},{x:120,y:100},0)], 'pointed');`,
  );
  assert.equal(apart.bridges.length, 0);
  const chains = run(
    `return graffitiPlanJoins([piece({x:0,y:0},{x:100,y:0},0), piece({x:100,y:0},{x:100,y:100},1)], 'pointed');`,
  );
  assert.equal(chains.bridges.length, 0);
  const optOut = run(
    `return graffitiPlanJoins([piece({x:0,y:0},{x:100,y:0},0), piece({x:100,y:0},{x:100,y:100},0,{bridgeFromPrevious:false})], 'pointed');`,
  );
  assert.equal(optOut.bridges.length, 0);
  assert.deepEqual(Array.from(optOut.capEnd), [true, true]);
  const blunt = run(
    `return graffitiPlanJoins([piece({x:0,y:0},{x:100,y:0},0), piece({x:100,y:0},{x:100,y:100},0)], 'blunt');`,
  );
  assert.equal(blunt.bridges.length, 0);
});

test('mesh cap flags: anti-aliased only where the cap is a silhouette edge', () => {
  // Vertex layout: x, y, bary(3), edgeMask(3), side. The start-cap flag is edgeMask.z (index 7)
  // of the first triangle, the end-cap flag is edgeMask.y (index 6) of the second.
  const flags = run(`
    const path = { points: [{x:0,y:0},{x:100,y:0}], closed: false };
    const mk = (caps) => buildGraffitiVariableRibbonMesh(path, 10, 'slash', 0.78, 3, 'pointed', 0.3, 0.75, 0, 0.5, null, 'absolute', caps);
    return ({ both: { start: mk(null)[7], end: mk(null)[9 * 3 + 6] }, none: { start: mk({start:false,end:false})[7], end: mk({start:false,end:false})[9 * 3 + 6] }, startOnly: { start: mk({start:true,end:false})[7], end: mk({start:true,end:false})[9 * 3 + 6] } });
  `);
  assert.deepEqual({ ...flags.both }, { start: 1, end: 1 });
  assert.deepEqual({ ...flags.none }, { start: 0, end: 0 });
  assert.deepEqual({ ...flags.startOnly }, { start: 1, end: 0 });
});
