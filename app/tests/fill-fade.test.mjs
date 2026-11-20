// Заливка при смене N в режиме Fade: старая и новая фигуры заливаются по отдельности (каждая со
// своей прозрачностью), а не одним чётно-нечётным набором, где их пересечение гасится.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, importModule } from './helpers/app-env.mjs';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);

const square = (s, dx = 0) => [
  { x: dx - s, y: -s },
  { x: dx + s, y: -s },
  { x: dx + s, y: s },
  { x: dx - s, y: s },
];
const path = (points, fillPresence) => ({
  points,
  closed: true,
  strokeGrowth: 1,
  source: [{ command: { alpha: 1, fillPresence } }],
});

test('Fade: линия плывёт по фазе, «присутствие» заливки — по «Смена режима»', async () => {
  await loadApp();
  const { state } = await importModule('js/core/state.js');
  const { morphPathFillPresence } = await importModule('js/geometry/morph.js');
  const fade = globalThis.SomataMorphRegistry.get('fade');
  const src = [{ points: square(1), closed: true }];
  const dst = [{ points: square(2), closed: true }];
  const a = { spiralOrder: 0 },
    b = { spiralOrder: 0 };
  // Носители уходящей и приходящей фигуры → то, что получит заливка.
  const frameAt = (t) => {
    const [out, inc] = fade.prepareAnchors({ source: src, target: dst, a, b })(t);
    const presence = (carrier) =>
      morphPathFillPresence({ _fillRole: carrier.fillRole, _fillPhase: carrier.fillPhase });
    return { out: { alpha: out.alpha, fill: presence(out) }, inc: { alpha: inc.alpha, fill: presence(inc) } };
  };

  state.morph.profileModeTransition = 'phase';
  let f = frameAt(0.25);
  near(f.out.alpha, 0.75);
  near(f.inc.alpha, 0.25);
  near(f.out.fill + f.inc.fill, 1);
  assert.ok(f.inc.fill > 0 && f.inc.fill < 0.25, 'сглаженная кривая стартует мягче линейной');
  f = frameAt(0.5);
  near(f.out.fill, 0.5);
  near(f.inc.fill, 0.5);

  // «Начало фазы»: вся смена укладывается в первые 40 % фазы.
  state.morph.profileModeTransition = 'start';
  state.morph.profileModeTransitionPercent = 40;
  f = frameAt(0.2);
  near(f.inc.fill, 0.5);
  f = frameAt(0.4);
  near(f.inc.fill, 1);
  near(f.out.fill, 0);
  near(f.out.alpha, 0.6, 1e-12); // линия по-прежнему линейна по фазе

  // «Конец фазы»: пока окно не началось, заливка остаётся старой.
  state.morph.profileModeTransition = 'end';
  f = frameAt(0.5);
  near(f.out.fill, 1);
  near(f.inc.fill, 0);
  f = frameAt(1);
  near(f.inc.fill, 1);
  state.morph.profileModeTransition = 'phase';

  // Явное присутствие (ручной морф) и отсутствие роли.
  near(morphPathFillPresence({ _fillPresence: 0.3 }, 1), 0.3);
  near(morphPathFillPresence({}, 0.8), 0.8);
});

test('веер заливки: контуры с разным присутствием — отдельные группы, без группы — как раньше', async () => {
  await loadApp();
  const { FillMeshPreparer } = await importModule('js/render/fill-plan.js');
  const frame = (id) => ({ layer: { id: 'fill-fade-test' }, geometryPlan: { dynamic: true }, frameId: id });
  const build = (id, paths) => {
    const ctx = frame(id);
    return FillMeshPreparer.prepareFrameContour(ctx, { screenPaths: paths });
  };

  // Обычный кадр: присутствие не задано → один набор, групп нет.
  let mesh = build(1, [path(square(10), undefined), path(square(5), undefined)]);
  assert.equal(mesh.fanGroups, null);
  assert.equal(mesh.fanTriangleCount, 8);

  // Кросс-фейд: две группы, у каждой своё начало/длина (в треугольниках) и вес.
  mesh = build(2, [path(square(10), 0.7), path(square(8, 3), 0.3)]);
  assert.equal(mesh.fanGroups.length, 2);
  assert.deepEqual(
    mesh.fanGroups.map((g) => [g.start, g.count, g.weight]),
    [
      [0, 4, 0.7],
      [4, 4, 0.3],
    ],
  );
  assert.equal(mesh.fanTriangleCount, 8);

  // Один и тот же вес у нескольких контуров — одна группа.
  mesh = build(3, [path(square(10), 0.5), path(square(8), 0.5), path(square(6), 0.5)]);
  assert.equal(mesh.fanGroups.length, 1);
  assert.equal(mesh.fanGroups[0].count, 12);

  // Полностью погасшая фигура не рисуется вовсе.
  mesh = build(4, [path(square(10), 0), path(square(8), 1)]);
  assert.deepEqual(
    mesh.fanGroups.map((g) => [g.start, g.count, g.weight]),
    [[0, 4, 1]],
  );
  assert.equal(mesh.fanTriangleCount, 4);

  // Следующий кадр без присутствия снова даёт обычный веер (группы не залипают).
  mesh = build(5, [path(square(10), undefined)]);
  assert.equal(mesh.fanGroups, null);
});
