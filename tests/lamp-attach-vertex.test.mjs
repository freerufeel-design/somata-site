// Лампа вершины в морфе: доля i/N отсчитывается от начала видимого контура, а при скруглении
// контур начинается у края дуги, а не на вершине. Лампа должна встать туда же, куда в статике —
// на точку контура, ближайшую к вершине, — и не «соскакивать» с неё в первом кадре морфа.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, importModule } from './helpers/app-env.mjs';

test('лампа вершины в морфе встаёт на ближайшую к вершине точку контура', async () => {
  await loadApp();
  const { runtimeState } = await importModule('js/core/state.js');
  const { projectLampPointsToCurrentPolygon } = await importModule('js/lamps/lamp-points.js');
  const { setLampContourAttachmentEnabled } = await importModule('js/lamps/lamp-anchors.js');
  const { lampMotionRuntime } = await importModule('js/lamps/lamp-motion.js');
  const prev = runtimeState.morph.active;
  try {
    runtimeState.morph.active = true;
    setLampContourAttachmentEnabled?.(true);
    lampMotionRuntime.profileAttach.clear();
    // Видимый контур — квадрат, но начинается не в вершине (100, 0), а на 10 px дальше по стороне.
    const pts = [];
    const corners = [
      [100, 0],
      [0, 100],
      [-100, 0],
      [0, -100],
    ];
    for (let c = 0; c < 4; c++) {
      const [ax, ay] = corners[c],
        [bx, by] = corners[(c + 1) % 4];
      for (let k = 0; k < 50; k++) pts.push({ x: ax + ((bx - ax) * k) / 50, y: ay + ((by - ay) * k) / 50 });
    }
    const shift = 7; // ≈10 px по стороне длиной ~141
    const rail = [{ points: [...pts.slice(shift), ...pts.slice(0, shift)], closed: true }];
    rail.__somataFrameContour = true;
    const layer = { id: 'attach-test' };
    // Вершина 0 — (100, 0); морф передаёт долю 0 (начало контура).
    const vertex = { x: 100, y: 0, pathIndex: 0, vertexIndex: 0, lampId: 'v0', lampAttachFraction: 0 };
    const [first] = projectLampPointsToCurrentPolygon([vertex], rail, layer, true);
    assert.ok(
      Math.hypot(first.x - 100, first.y) < 0.5,
      `лампа на вершине, а не в начале контура: ${first.x}, ${first.y}`,
    );
    // Следующий кадр с той же долей — та же точка (поправка запомнена).
    const [second] = projectLampPointsToCurrentPolygon([vertex], rail, layer, true);
    assert.ok(Math.hypot(second.x - first.x, second.y - first.y) < 1e-6);
  } finally {
    runtimeState.morph.active = prev;
    lampMotionRuntime.profileAttach.clear();
  }
});

test('a phase-owned lamp follows the arclength of its rounded rail through a crossing', async () => {
  await loadApp();
  const { runtimeState } = await importModule('js/core/state.js');
  const { projectLampPointsToCurrentPolygon } = await importModule('js/lamps/lamp-points.js');
  const { setLampContourAttachmentEnabled } = await importModule('js/lamps/lamp-anchors.js');
  const { lampMotionRuntime } = await importModule('js/lamps/lamp-motion.js');
  const old = { active: runtimeState.morph.active, lampCycleSerial: runtimeState.morph.lampCycleSerial };
  try {
    runtimeState.morph.active = true;
    runtimeState.morph.lampCycleSerial = 73;
    setLampContourAttachmentEnabled(true);
    const own = { points: [{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 60, y: 180 }] };
    const crossing = { points: [{ x: 0, y: 61 }, { x: 120, y: 61 }] };
    const visible = [own, crossing];
    visible.__somataFrameContour = true;
    const raw = {
      x: 0, y: 0, pathIndex: 0, vertexIndex: 0, lampId: 'bound-test', lampAttachFraction: 0,
    };
    const sample = (lamp, semantic) =>
      projectLampPointsToCurrentPolygon([lamp], visible, { id: 'bound-test' }, true, false, semantic)[0];
    assert.equal(sample(raw, visible).pathIndex, 0);
    const second = sample({ ...raw, x: 60, y: 61, lampAttachFraction: 0.5 }, [crossing, own]);
    assert.equal(second.pathIndex, 0);
    assert.ok(Math.hypot(second.x - 60, second.y - 60) < 1e-6);
    const third = sample({ ...raw, lampAttachFraction: 0.75 }, visible);
    assert.ok(Math.hypot(third.x - 60, third.y - 120) < 1e-6);
  } finally {
    Object.assign(runtimeState.morph, old);
    lampMotionRuntime.profileAttach.clear();
  }
});

test('the lamp effect plan follows Runtime Animation polygon frames with Blue Morph off', async () => {
  await loadApp();
  const { state, runtimeState } = await importModule('js/core/state.js');
  const { createLayer } = await importModule('js/core/defaults-layers.js');
  const { SomataFeatureHost } = await importModule('js/render/feature-host.js');
  await importModule('js/render/lamp-plan.js');
  const oldActive = runtimeState.morph.active;
  const oldTunnel = state.tunnel.active;
  try {
    runtimeState.morph.active = false;
    state.tunnel.active = false;
    const layer = { ...createLayer(), id: 'animation-lamp-test', showLamps: true };
    Object.assign(layer.lamps, { positionMode: 'key', snapToContour: false });
    const runt = window.SomataMorphRuntime;
    const start = { ...layer, N: 4, radius: 80, radiusMultiplier: 1, spiralEnabled: false, spiralOrder: 0 };
    const end = { ...start, radius: 180 };
    const spec = runt.describe({ sourceLayer: start, targetLayer: end, mode: 'topology', origin: 'manual' });
    const draw = (progress) => {
      const frame = {
        layer: { ...layer }, effectLayer: layer, layerIndex: 0, baseAlpha: 1, lampAnimationMs: 600,
        frame: { viewportOuterRadius: 500, tunnelCopies: [] }, visibleInstances: { copies: [{}] },
      };
      assert.equal(runt.publish(frame, runt.samplePrimary(spec, progress)), true);
      const plan = SomataFeatureHost.query('lamps', 'effectPlan', frame, {});
      assert.equal(plan.enabled, true);
      const points = plan.sets[0].points;
      assert.equal(points.length, 4);
      assert.equal(points[0].x, frame.geometryProvider.framePaths[0].points[0].x);
      assert.equal(points[0].y, frame.geometryProvider.framePaths[0].points[0].y);
      return points;
    };
    const before = draw(0.2), after = draw(0.8);
    assert.deepEqual(before.map((p) => p.lampId), after.map((p) => p.lampId));
    assert.ok(Math.hypot(after[0].x - before[0].x, after[0].y - before[0].y) > 30);
  } finally {
    runtimeState.morph.active = oldActive;
    state.tunnel.active = oldTunnel;
  }
});
test('animation preserves lamp positions and single lit vertices at topology endpoints', async () => {
  await loadApp();
  const { createLayer } = await importModule('js/core/defaults-layers.js');
  const { SomataFeatureHost } = await importModule('js/render/feature-host.js');
  await importModule('js/render/lamp-plan.js');
  const { lampPhasePresence } = await importModule('js/lamps/lamp-motion.js');
  const { SomataLampStability } = await importModule('js/render/lamp-stability.js');
  const { collectStaticLampPoints } = await importModule('js/geometry/frame-paths.js');
  const { withLampConfig } = await importModule('js/core/defaults-layers.js');
  const runtime = window.SomataMorphRuntime;
  for (const [snapToContour, roundingCornerType] of [[false, 'local'], [true, 'local'], [true, 'classic'], [true, 'simple']]) {
    for (const [from, to] of [[4, 8], [8, 4], [7, 6]]) {
      const layer = {
        ...createLayer(), N: from, K: 1, rotation: 0, radius: 100, radiusMultiplier: 1,
        spiralEnabled: false, spiralOrder: 0, closedLoop: true, rounding: snapToContour ? 65 : 0, roundingCornerType,
      };
      const spec = runtime.describe({
        sourceLayer: layer, targetLayer: { ...layer, N: to, rotation: 22 }, mode: 'topology', origin: 'manual',
      });
      layer.showLamps = true;
      const cfg = Object.assign(layer.lamps, { positionMode: 'key', snapToContour, extinguishIntersections: false });
      const sample = (t) => {
        const frame = {
          layer: { ...layer }, effectLayer: layer, layerIndex: 0, baseAlpha: 1,
          frame: { viewportOuterRadius: 500, tunnelCopies: [] }, visibleInstances: { copies: [{}] },
        };
        assert.ok(runtime.publish(frame, runtime.samplePrimary(spec, t)));
        const points = SomataFeatureHost.query('lamps', 'effectPlan', frame, {}).sets[0].points;
        const timing = { elapsed: 200 * t, remaining: 200 * (1 - t), duration: 500 };
        const items = points.map((p) => ({
          ...p, px: p.x, py: p.y, rad: 8, lampTraceId: p.lampId, lampPhaseTimed: true,
          intensityAlpha: lampPhasePresence(p, cfg, timing),
        }));
        SomataLampStability.apply(`phase:${snapToContour}:${roundingCornerType}:${from}:${to}`, items, {
          now: timing.elapsed, phase: 1, phaseProgress: t, phaseTiming: timing,
          duration: 500, extinguishIntersections: false, animate: true,
        });
        return items;
      };
      const distance = (a, b) => Math.hypot(a.px - b.px, a.py - b.py);
      const settled = withLampConfig(cfg, () => collectStaticLampPoints(spec.targetLayer));
      const beforeStop = sample(11 / 12);
      const terminal = sample(1).filter((p) => p.lampTargetPresent);
      assert.equal(terminal.length, settled.length);
      if (snapToContour && from === 8 && to === 4 && roundingCornerType === 'local') {
        for (const p of terminal) {
          const previous = beforeStop.find((q) => q.lampId === p.lampId);
          assert.ok(distance(p, previous) < 12, `visible final step: ${distance(p, previous)}`);
        }
      }
      for (const p of terminal) {
        const error = Math.min(...settled.map((q) => Math.hypot(p.x - q.x, p.y - q.y)));
        assert.ok(error < 0.01, `target mismatch ${from} -> ${to}, snap=${snapToContour}: ${error}`);
      }
      for (const [t, next, count] of [[0, 1e-6, from], [1 - 1e-6, 1, to]]) {
        const a = sample(t), b = sample(next);
        const label = `${from} -> ${to}, snap=${snapToContour}, ${roundingCornerType}, t=${t}`;
        assert.deepEqual(a.map((p) => p.lampId), b.map((p) => p.lampId), label);
        for (const [i, p] of a.entries()) assert.ok(distance(p, b[i]) < 0.25, label + ' jump ' + distance(p, b[i]));
        for (const items of [a, b]) {
          const lit = items.filter((p) => p.intensityAlpha > 0.01);
          assert.equal(lit.length, count, label);
          assert.ok(lit.every((p) => p.intensityAlpha > 0.99), label);
          assert.ok(lit.every((p, i) => lit.slice(i + 1).every((q) => distance(p, q) >= 1)), label);
        }
      }
    }
  }
});
