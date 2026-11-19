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

test('совпавшая на стыке фаз горящая лампа сохраняет ID и не проходит через затухание', async () => {
  await loadApp();
  const { runtimeState } = await importModule('js/core/state.js');
  const { preserveBlueMorphLampIdentity, lampMotionRuntime } = await importModule('js/lamps/lamp-motion.js');
  const { SomataLampStability } = await importModule('js/render/lamp-stability.js');
  const { withLampConfig } = await importModule('js/core/defaults-layers.js');
  const prevActive = runtimeState.morph.active,
    prevSerial = runtimeState.morph.lampCycleSerial;
  try {
    runtimeState.morph.active = true;
    lampMotionRuntime.blueMorph.clear();
    withLampConfig({ morphMotionMode: 'linear' }, () => {
      const resolve = (serial, points) => {
        runtimeState.morph.lampCycleSerial = serial;
        return preserveBlueMorphLampIdentity(0, points);
      };
      const draw = (now, points) => {
        const items = points.map((p) => ({
          lampTraceId: p.lampId,
          px: p.x,
          py: p.y,
          rad: 10,
          intensityAlpha: p.lampLevel,
        }));
        SomataLampStability.apply('coincident-phase-boundary', items, { now, duration: 100, animate: now > 0 });
        return items;
      };
      const end = resolve(1, [
        { x: 0, y: 0, lampId: 'old:0' },
        { x: 100, y: 0, lampId: 'old:1' },
      ]);
      draw(0, end);
      draw(16, end);
      const next = [
        { x: 25, y: 0, lampId: 'next:0' },
        { x: 0.000001, y: 0, lampId: 'next:1' },
        { x: 200, y: 0, lampId: 'next:2' },
      ];
      for (const now of [32, 48, 96, 160, 288]) {
        const start = resolve(2, next);
        const lamps = draw(now, start);
        assert.equal(start[1].lampId, end[0].lampId, 'совпадение важнее порядка обхода');
        assert.equal(lamps[1].intensityAlpha, 1, 'яркость совпавшей лампы не падает');
        assert.equal(lamps[1].px, next[1].x);
        if (now === 32) assert.equal(lamps[2].intensityAlpha, 0, 'новая лампа ещё не разгорелась');
      }
    });
  } finally {
    runtimeState.morph.active = prevActive;
    runtimeState.morph.lampCycleSerial = prevSerial;
    lampMotionRuntime.blueMorph.clear();
  }
});

test('при отключённом гашении пересечений уходящая лампа гаснет только в конце своего пути', async () => {
  await loadApp();
  const { runtimeState } = await importModule('js/core/state.js');
  const { lampPhasePresence, lampAdaptivePointCount } = await importModule('js/lamps/lamp-motion.js');
  const prev = runtimeState.morph.active;
  try {
    runtimeState.morph.active = true;
    const point = { lampSourcePresent: true, lampTargetPresent: false, lampPresence: 0.1, lampTravelProgress: 0.5 };
    const cfg = { extinguishIntersections: false };
    assert.equal(lampPhasePresence(point, {}), 0.1);
    assert.equal(lampPhasePresence(point, cfg), 1);
    assert.equal(lampAdaptivePointCount([point], cfg), 1);
    point.lampTravelProgress = 0.9;
    assert.ok(Math.abs(lampPhasePresence(point, cfg) - 0.5) < 1e-9);
    point.lampTravelProgress = 1;
    assert.equal(lampPhasePresence(point, cfg), 0);
  } finally {
    runtimeState.morph.active = prev;
  }
});

test('lamp attack and release take the same time in short and long phases', async () => {
  await loadApp();
  const { runtimeState } = await importModule('js/core/state.js');
  const { lampBendAnimationMs } = await importModule('js/lamps/lamp-attachment.js');
  const { lampPhaseLightTiming, lampPhasePresence } = await importModule('js/lamps/lamp-motion.js');
  const morph = runtimeState.morph;
  const previous = { active: morph.active, cycleStart: morph.cycleStart, transitionMs: morph.transitionMs,
    pauseStartedAt: morph.pauseStartedAt };
  try {
    Object.assign(morph, { active: true, cycleStart: 100, pauseStartedAt: 0 });
    const birth = { lampSourcePresent: false, lampTargetPresent: true, lampPresence: 0 };
    const retire = { lampSourcePresent: true, lampTargetPresent: false, lampPresence: 0 };
    for (const transitionMs of [2000, 12000]) {
      morph.transitionMs = transitionMs;
      for (const extinguishIntersections of [false, true]) {
        const cfg = { cornerInertiaSec: 0.5, cornerInertiaLinked: true, extinguishIntersections };
        const duration = lampBendAnimationMs(null, cfg);
        assert.equal(duration, 500);
        assert.equal(lampPhasePresence(birth, cfg, lampPhaseLightTiming(350, duration)), 0.5);
        assert.equal(lampPhasePresence(birth, cfg, lampPhaseLightTiming(600, duration)), 1);
        assert.equal(lampPhasePresence(retire, cfg, lampPhaseLightTiming(100 + transitionMs - 500, duration)), 1);
        assert.equal(lampPhasePresence(retire, cfg, lampPhaseLightTiming(100 + transitionMs - 250, duration)), 0.5);
        assert.equal(lampPhasePresence(retire, cfg, lampPhaseLightTiming(100 + transitionMs, duration)), 0);
      }
    }
  } finally {
    Object.assign(morph, previous);
  }
});

test('linear lamp travel uses the eased geometry progress while brightness uses elapsed time', async () => {
  await loadApp();
  const { runtimeState } = await importModule('js/core/state.js');
  const { lampPhaseInertiaProgress } = await importModule('js/lamps/lamp-attachment.js');
  const { lampPhasePresence } = await importModule('js/lamps/lamp-motion.js');
  const previous = runtimeState.morph.progress;
  try {
    runtimeState.morph.progress = 0.5;
    const cfg = { morphMotionMode: 'linear', morphInertia: 50 };
    assert.equal(lampPhaseInertiaProgress(0.125, cfg), 0.125);
    assert.equal(lampPhaseInertiaProgress(0.875, cfg), 0.875);
    const birth = { lampSourcePresent: false, lampTargetPresent: true };
    assert.equal(lampPhasePresence(birth, cfg, { elapsed: 250, duration: 500 }), 0.5);
  } finally {
    runtimeState.morph.progress = previous;
  }
});
