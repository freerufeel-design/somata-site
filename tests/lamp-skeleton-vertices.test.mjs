// Лампы вершин Blue-морфа берутся из вершин-носителей общего скелета (как линия): у каждой своя
// траектория. В начале фазы носители стоят на всех вершинах источника, в конце — на всех вершинах
// цели: ни одна вершина не остаётся без пришедшей лампы.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, importModule } from './helpers/app-env.mjs';

const near = (p, q) => Math.hypot(p.x - q.x, p.y - q.y) < 0.5;

test('носители скелета покрывают все вершины источника в начале и цели в конце', async () => {
  await loadApp();
  const { state } = await importModule('js/core/state.js');
  const runtime = globalThis.SomataSkeletonRuntime;
  assert.ok(runtime?.planAnchors);
  const base = state.layers[0];
  for (const [n0, k0, n1, k1] of [
    [6, 1, 5, 1],
    [5, 1, 9, 2],
    [6, 2, 5, 1],
    [8, 3, 6, 2],
  ]) {
    const a = { ...base, N: n0, K: k0, customSuborbits: null, spiralEnabled: false, spiralOrder: 0 };
    const b = { ...base, N: n1, K: k1, customSuborbits: null, spiralEnabled: false, spiralOrder: 0 };
    for (const mode of ['circleSlide', 'topology']) {
      const plan = runtime.planAnchors(a, b, mode, 'minimal');
      assert.ok(plan?.evaluate, `${mode} ${n0}/${k0}→${n1}/${k1}`);
      const pts = (t) => plan.evaluate(t).flatMap((c) => c.points);
      const covered = (anchors, carriers) =>
        anchors.every((orbit) => orbit.points.every((v) => carriers.some((p) => near(p, v))));
      assert.ok(covered(plan.source, pts(1e-7)), `${mode} ${n0}/${k0}→${n1}/${k1}: источник`);
      assert.ok(covered(plan.target, pts(1 - 1e-7)), `${mode} ${n0}/${k0}→${n1}/${k1}: цель`);
    }
  }
});
