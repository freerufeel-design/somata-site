// Тип морфинга многоугольника и спирали разнесён (как в 13.2): слой с порядком ≠ 0 на любом
// конце пары морфится по типу спирали, остальные — по типу многоугольника.
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { read, declarations } = require('./helpers/source.cjs');

const ctx = vm.createContext({ assert });
const run = (code) => vm.runInContext(code, ctx);

run(
  `const state={morph:{}, layers:[]}; const runtimeState={morph:{active:false}};
   const SomataMorphRegistry={migrate:x=>x};
   const isSpiralLayer=(l)=>Math.abs(Number(l?.spiralOrder)||0)>1e-8||l?.spiralEnabled===true;
   const window={};` +
    declarations(
      'UNIFIED_MORPH_KEYS',
      'FRAME_LEVEL_MORPH_MODES',
      'SPIRAL_MORPH_MODE_KEYS',
      'UNIFIED_SPIRAL_TRANSPORTS',
      'layerModeDepth',
      'layerModePolygon',
      'getPolygonMorphMode',
      'getUnifiedMorphMode',
      'normalizeSpiralMorphMode',
      'getSpiralMorphMode',
      'syncSpiralTransportFields',
      'setUnifiedMorphMode',
      'setSpiralMorphMode',
      'pairInvolvesSpiral',
      'getMorphModeForLayer',
      'withLayerMorphMode',
      'SPIRAL_MORPH_TYPES',
      'getSpiralMorphType',
    ),
);

// 1. По умолчанию оба типа «согласованный».
run(`
setUnifiedMorphMode(undefined);
assert.equal(getPolygonMorphMode(), 'coordinated');
assert.equal(getSpiralMorphMode(), 'coordinated');
assert.equal(getSpiralMorphType(), 'coordinated');
`);

// 2. Топологический многоугольник и непрерывная спираль: выбор по паре слоя.
run(`
state.layers = [{ id: 'poly', spiralOrder: 0 }, { id: 'spi', spiralOrder: 1 }];
setUnifiedMorphMode('topology');
setSpiralMorphMode('coordinated');
assert.equal(getPolygonMorphMode(), 'topology');
assert.equal(getSpiralMorphMode(), 'coordinated');
assert.equal(getMorphModeForLayer(0), 'topology');
assert.equal(getMorphModeForLayer(1), 'coordinated');
// Многоугольник -> спираль: достаточно спирали на одном конце пары.
assert.equal(getMorphModeForLayer(0, { sourceLayer: { spiralOrder: 0 }, targetLayer: { spiralOrder: 2 } }), 'coordinated');
assert.equal(getMorphModeForLayer(1, { sourceLayer: { spiralOrder: 0 }, targetLayer: { spiralOrder: 0 } }), 'topology');
// Топологический для спирали — «рваный» перенос.
setSpiralMorphMode('topology');
assert.equal(getSpiralMorphType(), 'torn');
setSpiralMorphMode('phaseCircle');
assert.equal(getSpiralMorphType(), 'phaseCircle');
assert.equal(getMorphModeForLayer(0), 'topology');
`);

// 3. Область слоя подменяет тип для движка и безопасно восстанавливает его.
run(`
setUnifiedMorphMode('topology');
setSpiralMorphMode('coordinated');
state.morph.mode = 'topology';
const seen = [];
withLayerMorphMode(1, () => {
  seen.push([state.morph.mode, state.morph.unifiedMode, getUnifiedMorphMode(), getPolygonMorphMode()]);
  // Вложенная область для многоугольника возвращает его тип, а не тип внешней области.
  withLayerMorphMode(0, () => seen.push([state.morph.mode, getUnifiedMorphMode()]));
  seen.push([state.morph.mode, getUnifiedMorphMode()]);
});
assert.deepEqual(seen, [
  ['coordinated', 'coordinated', 'coordinated', 'topology'],
  ['topology', 'topology'],
  ['coordinated', 'coordinated'],
]);
assert.equal(state.morph.mode, 'topology');
assert.equal(state.morph.unifiedMode, 'topology');
assert.equal(getUnifiedMorphMode(), 'topology');
assert.equal(layerModeDepth, 0);
// Исключение внутри области не оставляет подменённый тип.
assert.throws(() => withLayerMorphMode(1, () => { throw new Error('boom'); }), /boom/);
assert.equal(state.morph.mode, 'topology');
assert.equal(state.morph.unifiedMode, 'topology');
assert.equal(layerModeDepth, 0);
// Если типы совпадают, подмены нет совсем.
setSpiralMorphMode('topology');
let touched = false;
withLayerMorphMode(1, () => { touched = state.morph.mode !== 'topology'; });
assert.equal(touched, false);
`);

// 4. Старый проект с одним общим типом: спираль следует за многоугольником.
run(`
delete state.morph.spiralMode;
setUnifiedMorphMode('phaseCircle');
assert.equal(getSpiralMorphMode(), 'phaseCircle');
assert.equal(getSpiralMorphType(), 'phaseCircle');
setUnifiedMorphMode('circleSlide');
assert.equal(getSpiralMorphMode(), 'circleSlide');
`);

// 5. Fade и Слайдшоу — общие для всего кадра: у спирали своего типа нет.
run(`
for (const frame of ['fade', 'light']) {
  setUnifiedMorphMode(frame);
  setSpiralMorphMode('coordinated');
  assert.equal(getSpiralMorphMode(), frame);
  assert.equal(getMorphModeForLayer(1), frame);
}
assert.equal(normalizeSpiralMorphMode('light', null), null);
assert.equal(normalizeSpiralMorphMode('fade', null), null);
assert.equal(setSpiralMorphMode('light'), 'coordinated');
assert.ok(!SPIRAL_MORPH_MODE_KEYS.includes('light') && !SPIRAL_MORPH_MODE_KEYS.includes('fade'));
`);

// 6. Интерфейс: три пары селекторов, у спирали нет Fade и Слайдшоу.
const html = read('index.html');
const optionsOf = (id) => {
  const m = html.match(new RegExp('<select[^>]*id="' + id + '"[^>]*>([\\s\\S]*?)</select>'));
  assert(m, id);
  return [...m[1].matchAll(/<option value="([^"]+)"/g)].map((x) => x[1]);
};
for (const id of ['morphSpiralMode', 'morphSpiralModeTop', 'testMorphSpiralMode']) {
  const options = optionsOf(id);
  assert.deepEqual(options, ['topology', 'circleSlide', 'phaseCircle', 'coordinated', 'coordinatedFromCenter'], id);
  assert.equal((html.match(new RegExp('<select[^>]*id="' + id + '"[^>]*>[\\s\\S]*?</select>'))[0].match(/\bselected\b/g) || []).length, 1, id);
}
for (const id of ['morphMode', 'morphModeTop', 'testMorphMode']) assert(optionsOf(id).includes('light'), id);

// 7. Сохранение и загрузка проекта хранят оба типа, старые проекты мигрируют.
assert.match(read('js/project/project-data.js'), /spiralMode:\s*getSpiralMorphMode\(\)/);
const loader = read('js/project/project-loader.js');
assert.match(loader, /setSpiralMorphMode\(normalizeSpiralMorphMode\(m\.spiralMode, null\) \?\? savedMode/);

console.log('PASS: типы морфинга многоугольника и спирали разнесены; выбор по паре слоя, область слоя, миграция, интерфейс и сохранение');
