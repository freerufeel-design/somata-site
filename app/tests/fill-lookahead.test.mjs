// Заливка «на цикл вперёд»: «лишние» контуры слияния/разделения орбит входят в заливку с весом,
// меняется только область внутри них; топология следующей фазы выбирается заранее и применяется.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FILL_LOOKAHEAD_WINDOW,
  acceptPlan,
  activeOrbitCount,
  fillBoundaryWindow,
  fillGhostWeight,
  fillSplitAheadWeight,
  ghostFillLayout,
  planNextCycle,
  planSignature,
} from '../js/morph-runtime/blue/fill-lookahead.js';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);

// ---- планирование -------------------------------------------------------------------------

const morph = (extra = {}) => ({
  monoOrbitTransforms: true,
  diversity: true,
  vertexMin: 3,
  vertexMax: 12,
  vertexMultiplier: 1,
  stepMin: 0,
  stepMax: 100,
  options: { byVertices: true, bySteps: true },
  ...extra,
});
const layers = () => [{ id: 'a', N: 6, K: 2, customSuborbits: null }];
const targets = () => [{ N: 6, K: 1, customSuborbits: null, morphOrbitCopies: 1 }];
const endpoints = (enabled = true, alpha = 0.4) => [{ to: { enabled, alpha } }];
const hooks = (over = {}) => ({
  blocked: () => false,
  topology: () => ({ N: 8, K: 4, customSuborbits: null }),
  copies: (_s, d) => Math.min(4, d.K),
  orbits: () => 1,
  ...over,
});
const plan = (over = {}) =>
  planNextCycle({
    layers: layers(),
    targets: targets(),
    endpoints: endpoints(),
    morph: morph(),
    hooks: hooks(),
    ...over,
  });

test('план: топология следующего цикла считается от того, до чего дойдёт этот', () => {
  let seen = null;
  const p = plan({
    layers: [{ id: 'a', N: 4, K: 2, customSuborbits: null }],
    hooks: hooks({
      topology: (layer) => {
        seen = layer;
        return { N: 8, K: 4, customSuborbits: null };
      },
    }),
  });
  // слой после фиксации цели (было N=4, K=2): N и K берутся из цели
  assert.equal(seen.N, 6);
  assert.equal(seen.K, 1);
  const [item] = p.items;
  assert.deepEqual([item.fromN, item.fromK, item.N, item.K], [6, 1, 8, 4]);
  assert.equal(item.copies, 4);
  assert.equal(item.srcCopies, 1);
});

test('план: только для слоёв с видимой заливкой и не в заблокированных режимах', () => {
  assert.equal(plan({ endpoints: endpoints(false, 0.4) }), null);
  assert.equal(plan({ endpoints: endpoints(true, 0) }), null);
  assert.equal(plan({ hooks: hooks({ blocked: () => true }) }), null);
  assert.ok(plan({ morph: morph({ monoOrbitTransforms: false }) }), 'без моно-орбит план тоже строится');
});

test('план: спираль и хаос-звезда не планируются', () => {
  assert.equal(plan({ targets: [{ ...targets()[0], spiralEnabled: true }] }), null);
  assert.equal(plan({ targets: [{ ...targets()[0], chaosStar: true }] }), null);
  assert.equal(plan({ targets: [{ ...targets()[0], closedLoop: false }] }), null);
});

test('план принимается только для тех же слоёв, настроек и дошедшей топологии', () => {
  const p = plan();
  const committed = [{ id: 'a', N: 6, K: 1, customSuborbits: null }];
  assert.ok(acceptPlan(p, committed, morph()));
  // слой не дошёл до цели (пользователь поменял N) → пункт выбрасывается
  assert.equal(acceptPlan(p, [{ id: 'a', N: 7, K: 1 }], morph()), null);
  // другой слой на том же месте
  assert.equal(acceptPlan(p, [{ id: 'b', N: 6, K: 1 }], morph()), null);
  // число слоёв изменилось
  assert.equal(acceptPlan(p, [...committed, { id: 'c', N: 4, K: 1 }], morph()), null);
  // пользователь поменял диапазон вершин между выбором и применением
  assert.equal(acceptPlan(p, committed, morph({ vertexMax: 5 })), null);
});

test('подпись настроек меняется вместе с тем, что влияет на выбор цели', () => {
  const a = planSignature(morph());
  assert.notEqual(a, planSignature(morph({ orbitCountMax: 3 })));
  assert.notEqual(a, planSignature(morph({ options: { byVertices: false, bySteps: true } })));
  assert.equal(a, planSignature(morph()));
});

// ---- лишние контуры морфа (только область внутри них) ------------------------------------

test('вес лишнего контура: слияние гаснет до стыка, разделение — от начала или сразу', () => {
  assert.equal(fillGhostWeight(0.5), null, 'обычный контур');
  const merge = (t) => fillGhostWeight(t, { targetPresent: false });
  assert.deepEqual([merge(0.5).g, merge(0.5).dir], [1, -1]);
  near(merge(1).g, 0);
  const split = (t, splitDone = false) => fillGhostWeight(t, { sourcePresent: false, splitDone });
  near(split(0).g, 0);
  near(split(FILL_LOOKAHEAD_WINDOW).g, 1);
  assert.equal(split(0, true).g, 1, 'разделение уже введено в заливку в прошлой фазе');
  assert.equal(split(0.5).dir, 1);
  near(fillSplitAheadWeight(0.5), 0);
  near(fillSplitAheadWeight(1), 1);
});

test('активные орбиты: НОД(N,K) или выбранное число', () => {
  assert.equal(activeOrbitCount(12, 3), 3);
  assert.equal(activeOrbitCount(8, 4), 4);
  assert.equal(activeOrbitCount(11, 2), 1);
  assert.equal(activeOrbitCount(12, 3, 2), 2);
});

test('раскладка групп: снаружи лишних контуров доли дают ровно α', () => {
  const alpha = 0.8;
  const share = (power) => 1 - Math.pow(1 - alpha, power);
  // покрытие пикселя набором групп → итоговая прозрачность (source-over)
  const covered = (groups) => 1 - groups.reduce((acc, g) => acc * (1 - share(g.power)), 1);
  for (const gM of [0, 0.3, 1])
    for (const gD of [0, 0.6, 1]) {
      const contours = [
        { ghost: null },
        { ghost: gM < 1 || gM > 0 ? { g: gM, dir: -1 } : null },
        { ghost: null, dup: 2 },
      ];
      const { order, groups } = ghostFillLayout(contours, gD);
      // порядок: уходящие | обычные | приходящие (дубли повторяют контур)
      assert.deepEqual(order, [1, 0, 2, 2, 2]);
      // точка вне всех лишних контуров покрыта всеми группами
      near(covered(groups), alpha, 1e-12);
      // точка только внутри уходящего: группы, где он есть (from = 0)
      const inM = groups.filter((g) => g.from === 0);
      near(covered(inM), share(gM * (1 - gD) + gM * gD), 1e-12);
    }
});


test('окно слияния и разделения следует части фазы профиля, включая 0 и 100%', () => {
  for (const mode of ['start', 'end', 'second']) {
    for (const pct of [10,20,40,80,100]) {
      const window = fillBoundaryWindow({profileModeTransition:mode,profileModeTransitionPercent:pct});
      near(window,pct/100);
      const out=t=>fillGhostWeight(t,{targetPresent:false,window}).g;
      const inc=t=>fillGhostWeight(t,{sourcePresent:false,window}).g;
      near(out(1-window),1);near(out(1-window/2),.5);near(out(1),0);
      near(inc(0),0);near(inc(window/2),.5);near(inc(window),1);
      near(fillSplitAheadWeight(1-window/2,window),.5);
    }
  }
  const whole=fillBoundaryWindow({profileModeTransition:'phase',profileModeTransitionPercent:20});
  assert.equal(whole,1);
  near(fillGhostWeight(.5,{targetPresent:false,window:whole}).g,.5);
  near(fillSplitAheadWeight(.5,whole),.5);
  assert.equal(fillBoundaryWindow({profileModeTransition:'end',profileModeTransitionPercent:0}),0);
  assert.equal(fillGhostWeight(.999,{targetPresent:false,window:0}).g,1);
  assert.equal(fillGhostWeight(1,{targetPresent:false,window:0}).g,0);
  assert.equal(fillGhostWeight(0,{sourcePresent:false,window:0}).g,1);
  assert.equal(fillSplitAheadWeight(.999,0),0);
  assert.equal(fillSplitAheadWeight(1,0),1);
});
