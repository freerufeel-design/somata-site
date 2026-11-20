// Остановка Blue после смены фазы не должна запускать повторный переход TAP: при остановке слои
// заново запоминаются в TAP как есть (seedLayers), а не сравниваются с состоянием до морфа.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { loadApp } from './helpers/app-env.mjs';

const require = createRequire(import.meta.url);
const { read, moduleOf } = require('./helpers/source.cjs');

test('stopMorphing запоминает слои в TAP без анимации', async () => {
  await loadApp();
  assert.equal(typeof globalThis.SomataTestMorph?.seedLayers, 'function');
  const src = read(moduleOf('createMorphPlaybackModule'));
  const stop = src.slice(
    src.indexOf('const stopMorphing = '),
    src.indexOf('setActiveStopMorphing(stopMorphing)'),
  );
  assert.match(stop, /SomataTestMorph\?\.seedLayers\?\.\(state\.layers\)/);
  // seedLayers не стартует анимацию и не трогает независимую смену порядка спирали
  globalThis.SomataTestMorph.seedLayers([{ id: 'x', N: 5, K: 2 }]);
});
