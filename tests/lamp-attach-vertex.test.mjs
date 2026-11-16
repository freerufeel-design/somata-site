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
