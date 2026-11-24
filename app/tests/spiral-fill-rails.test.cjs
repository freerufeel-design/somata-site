// Заливка спирали при согласованных типах морфинга: кадр публикует ветви (`framePaths` со
// `spiralBranchIndex`), и полосы заливки строятся из них. Раньше заливки не было совсем.
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { read, declarations } = require('./helpers/source.cjs');

const ctx = vm.createContext({ assert });
const run = (code) => vm.runInContext(code, ctx);
run(declarations('SOMATA_FILL_RAIL_SAMPLES', 'somataSampleRailPoints', 'somataCoordinatedFillRails'));

run(`
const line = (a, b) => ({ p0: a, c1: { x: a.x + (b.x - a.x) / 3, y: a.y + (b.y - a.y) / 3 }, c2: { x: a.x + (2 * (b.x - a.x)) / 3, y: a.y + (2 * (b.y - a.y)) / 3 }, p3: b });
// Кривая Безье разворачивается в ломаную, стыки сегментов не дублируются.
const pts = somataSampleRailPoints({ _bezierSegments: [line({ x: 0, y: 0 }, { x: 10, y: 0 }), line({ x: 10, y: 0 }, { x: 10, y: 10 })], points: [] });
assert.equal(pts.length, 2 * SOMATA_FILL_RAIL_SAMPLES + 1);
assert.deepEqual(pts[0], { x: 0, y: 0 });
assert.deepEqual(pts.at(-1), { x: 10, y: 10 });
const corner = pts[SOMATA_FILL_RAIL_SAMPLES];
assert.ok(Math.abs(corner.x - 10) < 1e-9 && Math.abs(corner.y) < 1e-9);
// Без кривых берутся готовые точки.
assert.deepEqual(somataSampleRailPoints({ points: [{ x: 1, y: 2 }, { x: 3, y: 4 }] }), [{ x: 1, y: 2 }, { x: 3, y: 4 }]);

// Ветви берутся только из кадра, где есть spiralBranchIndex; обычные пути пропускаются.
const frame = (paths) => ({ geometryPlan: { framePaths: paths } });
const branch = (i) => ({ spiralBranchIndex: i, points: [{ x: i, y: 0 }, { x: i, y: 5 }], _alpha: 0.5 });
const rails = somataCoordinatedFillRails(frame([branch(0), branch(1), { points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }, branch(2)]));
assert.equal(rails.length, 3);
assert.deepEqual(rails.map((r) => r.spiralBranchIndex), [0, 1, 2]);
assert.equal(rails[0].alpha, 0.5);
// Одна ветвь или кадр без ветвей — заливки нет.
assert.equal(somataCoordinatedFillRails(frame([branch(0)])), null);
assert.equal(somataCoordinatedFillRails(frame([])), null);
assert.equal(somataCoordinatedFillRails({}), null);
`);

// Адаптер использует ветви кадра, когда у удерживаемой GPU-ветви кадра нет, и для «Межвиткового» типа
// при отсутствии локальных ячеек возвращается к полосам между соседними ветвями.
const adapter = read('js/render/spiral-fill-adapter.js');
assert.match(adapter, /if \(native\) \{\s*paths = getGpuSpiralBezierMorphAuxPaths/);
assert.match(adapter, /const raw = dynamic \? plan.framePaths : \(plan.sourceData \|\| frameCtx.staticDrawData\)\?\.paths/);
assert.match(adapter, /prepareSpiralMorphBands\?\.\(frameCtx, rails\)/);

console.log('PASS: ветви согласованного кадра становятся ветвями заливки спирали; запасной путь межвиткового типа');
