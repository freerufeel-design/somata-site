// Скругление спирали («суперскругление» 100–200%) в согласованном (coordinated) пути.
// Эталон — 13.2: рука скругления = 0.5 · min(смежные стороны) · сила; при силе > 1 руки забирают
// сторону целиком, а сумма двух рук одной периодической ветки ограничена 0.9995 её длины.
import test from 'node:test';
import assert from 'node:assert/strict';
import { importModule } from './helpers/app-env.mjs';

const SCALE = 0.8;
const DELTA = 0.9;
const map = ({ x, y }) => ({
  x: SCALE * (Math.cos(DELTA) * x - Math.sin(DELTA) * y),
  y: SCALE * (Math.sin(DELTA) * x + Math.cos(DELTA) * y),
});
const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

// Периодическая ветка: прямая P0 → map(P0), то есть её конец совпадает с началом следующей копии.
function periodicRail() {
  const p0 = { x: 100, y: 0 },
    p3 = map(p0);
  const rail = {
    points: [],
    _bezierSegments: [
      { p0, c1: lerp(p0, p3, 1 / 3), c2: lerp(p0, p3, 2 / 3), p3, widthScale0: 1, widthScale1: 1 },
    ],
  };
  return { rail, length: Math.hypot(p3.x - p0.x, p3.y - p0.y), end: p3 };
}
// Рука на конце ветки: расстояние от исходного угла до начала левой половины скругления.
function endArm(roundSpiral, strength) {
  const { rail, length, end } = periodicRail();
  const ok = roundSpiral(rail, rail, strength, { scale: SCALE, delta: DELTA });
  const tail = rail._bezierSegments.at(-1).p0;
  return { ok, arm: ok ? Math.hypot(tail.x - end.x, tail.y - end.y) : 0, length };
}

test('рука скругления спирали равна 0.5·min(стороны)·сила, как в 13.2', async () => {
  const { roundJoinedSpiralRails } = await importModule('js/geometry/spiral/bezier-carrier.js');
  for (const strength of [0.25, 0.5, 1]) {
    const { ok, arm, length } = endArm(roundJoinedSpiralRails, strength);
    assert.ok(ok, `скругление ${strength} применилось`);
    const expected = 0.5 * Math.min(length, length * SCALE) * strength;
    assert.ok(Math.abs(arm - expected) < expected * 0.02, `сила ${strength}: рука ${arm} ≈ ${expected}`);
  }
});

test('суперскругление: выше 100% руки растут, сумма рук ветки ≤ 0.9995 её длины', async () => {
  const { roundJoinedSpiralRails } = await importModule('js/geometry/spiral/bezier-carrier.js');
  let previous = 0;
  for (const strength of [1, 1.25, 1.5, 2]) {
    const { ok, arm, length } = endArm(roundJoinedSpiralRails, strength);
    assert.ok(ok, `скругление ${strength} применилось (раньше выше предела отказывало)`);
    assert.ok(arm >= previous - 1e-9, `рука не уменьшается: ${arm} ≥ ${previous}`);
    assert.ok(arm + arm / SCALE <= length * 0.9995 + 1e-6, 'руки на обоих концах не пересекаются');
    previous = arm;
  }
  const { arm, length } = endArm(roundJoinedSpiralRails, 2);
  const cap = (length * 0.9995) / (1 + 1 / SCALE);
  assert.ok(Math.abs(arm - cap) < cap * 0.02, `при 200% рука упирается в предел 13.2: ${arm} ≈ ${cap}`);
});

test('ноль скругления ничего не меняет', async () => {
  const { roundJoinedSpiralRails } = await importModule('js/geometry/spiral/bezier-carrier.js');
  const { rail } = periodicRail();
  assert.equal(roundJoinedSpiralRails(rail, rail, 0, { scale: SCALE, delta: DELTA }), false);
  assert.equal(rail._bezierSegments.length, 1);
});

// Главное свойство суперскругления — скругление меняется плавно, без рывков: форма при силе s и s+Δ
// отличается на малую величину на всём диапазоне 0–200%, включая включение предела сумм рук.
function bezierPoints(seg, n = 40) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n,
      u = 1 - t;
    out.push({
      x: u * u * u * seg.p0.x + 3 * u * u * t * seg.c1.x + 3 * u * t * t * seg.c2.x + t * t * t * seg.p3.x,
      y: u * u * u * seg.p0.y + 3 * u * u * t * seg.c1.y + 3 * u * t * t * seg.c2.y + t * t * t * seg.p3.y,
    });
  }
  return out;
}
const outline = (rails) => rails.flatMap((r) => r._bezierSegments.flatMap((s) => bezierPoints(s)));
function distanceToCloud(p, cloud) {
  let best = Infinity;
  for (const q of cloud) best = Math.min(best, Math.hypot(p.x - q.x, p.y - q.y));
  return best;
}
const hausdorff = (a, b) =>
  Math.max(...a.map((p) => distanceToCloud(p, b)), ...b.map((p) => distanceToCloud(p, a)));

function sweepSteps(roundSpiral, build, step = 0.01) {
  const shapes = [];
  for (let s = step; s <= 2 + 1e-9; s += step) {
    const { rails, args } = build();
    roundSpiral(...args(s));
    shapes.push(outline(rails));
  }
  const jumps = [];
  for (let i = 1; i < shapes.length; i++) jumps.push(hausdorff(shapes[i - 1], shapes[i]));
  return jumps;
}
function assertSmooth(jumps, label) {
  const sorted = [...jumps].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const worst = sorted.at(-1);
  assert.ok(worst <= Math.max(median * 3, 0.6), `${label}: максимальный шаг ${worst} при медиане ${median}`);
  assert.ok(worst < 2, `${label}: шаг формы между соседними значениями 1% не больше 2 ед.: ${worst}`);
}

test('скругление 0–200% меняется без рывков: замкнутая периодическая ветка', async () => {
  const { roundJoinedSpiralRails } = await importModule('js/geometry/spiral/bezier-carrier.js');
  const jumps = sweepSteps(roundJoinedSpiralRails, () => {
    const { rail } = periodicRail();
    return { rails: [rail], args: (s) => [rail, rail, s, { scale: SCALE, delta: DELTA }] };
  });
  assertSmooth(jumps, 'периодическая ветка');
});

test('скругление 0–200% меняется без рывков: угол между соседними рёбрами', async () => {
  const { roundJoinedSpiralRails } = await importModule('js/geometry/spiral/bezier-carrier.js');
  const edge = (p0, p3) => ({
    points: [],
    _bezierSegments: [{ p0, c1: lerp(p0, p3, 1 / 3), c2: lerp(p0, p3, 2 / 3), p3, widthScale0: 1, widthScale1: 1 }],
  });
  const jumps = sweepSteps(roundJoinedSpiralRails, () => {
    const a = edge({ x: 0, y: 0 }, { x: 100, y: 0 }),
      b = edge({ x: 100, y: 0 }, { x: 100, y: 60 });
    return { rails: [a, b], args: (s) => [a, b, s, null] };
  });
  assertSmooth(jumps, 'угол между рёбрами');
});

test('super-rounding seam stays continuous as the cut passes a carrier corner', async () => {
  const { roundJoinedSpiralRails } = await importModule('js/geometry/spiral/bezier-carrier.js');
  const start = { x: 100, y: 0 },
    corner = { x: 0, y: 5 },
    end = { x: 0, y: 80 };
  const edge = (p0, p3) => ({ p0, c1: lerp(p0, p3, 1 / 3), c2: lerp(p0, p3, 2 / 3), p3 });
  const strength = 2 * 75 / (0.8 * (Math.hypot(100, 5) + 75));
  const seam = (value) => {
    const rail = { points: [], _bezierSegments: [edge(start, corner), edge(corner, end)] };
    assert.ok(roundJoinedSpiralRails(rail, rail, value, { scale: 0.8, delta: Math.PI / 2 }));
    return rail._bezierSegments.at(-1).p3;
  };
  const a = seam(strength - 1e-7), b = seam(strength + 1e-7);
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 1e-4);
});

test('periodic super-rounding reproduces the 13.2 fillet samples', async () => {
  const { roundJoinedSpiralRails } = await importModule('js/geometry/spiral/bezier-carrier.js');
  const { buildClosedSpiralAutoCloseGeometry } = await importModule('js/geometry/spiral/fillets.js');
  const edge = (p0, p3) => ({ p0, c1: lerp(p0, p3, 1 / 3), c2: lerp(p0, p3, 2 / 3), p3 });
  for (const strength of [1, 1.25, 1.6, 2]) {
    for (const delta of [0.9, -0.9]) {
      for (const scale of [0.8, 1.25]) {
        const start = { x: 100, y: 0 };
        const end = { x: 100 * scale * Math.cos(delta), y: 100 * scale * Math.sin(delta) };
        const bend = { x: (start.x + end.x) / 2 + 8, y: (start.y + end.y) / 2 - 12 };
        const points = [start, bend, end].map((p) => ({
          ...p, __spiralClosed: true, __spiralDelta: delta, __spiralTargetScale: scale,
        }));
        const reference = buildClosedSpiralAutoCloseGeometry(points, strength, true);
        const rail = { points, _bezierSegments: [edge(start, bend), edge(bend, end)] };
        assert.ok(roundJoinedSpiralRails(rail, rail, strength, { scale, delta }));
        const head = bezierPoints(rail._bezierSegments[0], 576);
        const tail = bezierPoints(rail._bezierSegments.at(-1), 576);
        const expectClose = (a, b) => assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 1e-6);
        for (let i = 0; i <= 24; i++) expectClose(head[i * i], reference[i]);
        for (let i = 1; i <= 24; i++) expectClose(tail[576 - (24 - i) ** 2], reference.at(i - 25));
      }
    }
  }
});

test('joined rails continue growing above 100% until their shared cut budget is used', async () => {
  const { roundSpiralRailJoins } = await importModule('js/geometry/spiral/bezier-carrier.js');
  const edge = (p0, p3) => ({
    points: [], _bezierSegments: [{ p0, c1: lerp(p0, p3, 1 / 3), c2: lerp(p0, p3, 2 / 3), p3 }],
  });
  const first = edge({ x: 0, y: 0 }, { x: 100, y: 0 });
  const second = edge({ x: 100, y: 0 }, { x: 100, y: 100 });
  assert.ok(roundSpiralRailJoins([[first, second]], 1.6));
  assert.ok(Math.abs(first._bezierSegments.at(-1).p0.x - 20) < 1e-8);
  assert.ok(Math.abs(second._bezierSegments[0].p3.y - 80) < 1e-8);
});
