// Лампы вершин при морфе: лампа вершины, которой нет в цели, гаснет к концу фазы, а лампа вершины,
// которой не было в источнике, разгорается с начала — в любом режиме движения ламп, а не только в
// «Линейно»/«Призрак». На стыке фаз видимые лампы сохраняют свои идентификаторы.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, importModule } from './helpers/app-env.mjs';

test('присутствие лампы по топологии работает при обычном движении', async () => {
  await loadApp();
  const { runtimeState } = await importModule('js/core/state.js');
  const { lampTopologyPresence, lampAdaptivePointCount } = await importModule('js/lamps/lamp-motion.js');
  const { withLampConfig } = await importModule('js/core/defaults-layers.js');
  const prev = runtimeState.morph.active;
  try {
    runtimeState.morph.active = false;
    assert.equal(lampTopologyPresence(true, false, 0.7), 1, 'вне морфа лампы всегда видны');
    runtimeState.morph.active = true;
    for (const morphMotionMode of ['inertia', 'smooth', 'dynamic', 'linear', undefined]) {
      withLampConfig({ morphMotionMode }, () => {
        assert.equal(lampTopologyPresence(true, true, 0.4), 1);
        assert.equal(lampTopologyPresence(true, false, 0), 1, `${morphMotionMode}: уходящая видна в начале`);
        assert.equal(lampTopologyPresence(true, false, 1), 0, `${morphMotionMode}: уходящая погасла к концу`);
        assert.equal(
          lampTopologyPresence(false, true, 0),
          0,
          `${morphMotionMode}: приходящая тёмная в начале`,
        );
        assert.equal(lampTopologyPresence(false, true, 1), 1, `${morphMotionMode}: приходящая горит в конце`);
        assert.equal(
          lampAdaptivePointCount([{ lampPresence: 1 }, { lampPresence: 0 }, { lampPresence: 0.5 }]),
          1.5,
        );
      });
    }
  } finally {
    runtimeState.morph.active = prev;
  }
});

test('на стыке фаз видимые лампы забирают прежние идентификаторы раньше невидимых', async () => {
  await loadApp();
  const { runtimeState } = await importModule('js/core/state.js');
  const { preserveBlueMorphLampIdentity, lampMotionRuntime } = await importModule('js/lamps/lamp-motion.js');
  const prevActive = runtimeState.morph.active,
    prevSerial = runtimeState.morph.lampCycleSerial;
  try {
    runtimeState.morph.active = true;
    lampMotionRuntime.blueMorph.clear();
    const layerIndex = 0;
    runtimeState.morph.lampCycleSerial = 1;
    // Конец фазы: две горящие лампы.
    const end = preserveBlueMorphLampIdentity(layerIndex, [
      { x: 0, y: 0, lampId: 'key:0:0' },
      { x: 100, y: 0, lampId: 'key:0:1' },
    ]);
    const ids = end.map((p) => p.lampId);
    // Новая фаза: невидимая лампа будущей вершины стоит первой в списке и ближе всех к первой лампе.
    runtimeState.morph.lampCycleSerial = 2;
    const start = preserveBlueMorphLampIdentity(layerIndex, [
      { x: 1, y: 0, lampId: 'key:0:0', lampPresence: 0, lampSourcePresent: false },
      { x: 2, y: 0, lampId: 'key:0:1' },
      { x: 99, y: 0, lampId: 'key:0:2' },
    ]);
    assert.equal(start[1].lampId, ids[0], 'видимая лампа у первой вершины сохранила идентификатор');
    assert.equal(start[2].lampId, ids[1], 'видимая лампа у второй вершины сохранила идентификатор');
    assert.ok(!ids.includes(start[0].lampId), 'невидимая получила новый');
  } finally {
    runtimeState.morph.active = prevActive;
    runtimeState.morph.lampCycleSerial = prevSerial;
    lampMotionRuntime.blueMorph.clear();
  }
});
