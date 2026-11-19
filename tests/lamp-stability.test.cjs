// New lamps start dark, overlapping lights share intensity, separation ramps, and GPU arc
// placeholders do not collapse unrelated paths.
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { moduleAsScript } = require('./helpers/source.cjs');

const apply = vm.runInNewContext(
  moduleAsScript('js/render/lamp-stability.js') + '\nSomataLampStability.apply',
  { window: {}, noteSuppressedError() {} },
);
const lamp = (id, px = 0) => ({ lampTraceId: id, px, py: 0, intensityAlpha: 1 });
const run = (t, lamps, animate = true, arc = false, scope = 'layer') => {
  const stats = apply(scope, lamps, { now: t, duration: 100, animate, arc });
  return { stats, levels: lamps.map((p) => p.intensityAlpha) };
};
assert.deepEqual(run(0, [lamp('old')], false).levels, [1]);
let r = run(16, [lamp('old'), lamp('new')]);
assert.deepEqual(r.levels, [1, 0]);
assert.equal(r.stats.rawOverlap, 2);
assert.equal(r.stats.maxMultiplicity, 2);
r = run(32, [lamp('old'), lamp('new')]);
assert.ok(Math.abs(r.levels.reduce((a, b) => a + b, 0) - 1) < 1e-10);
assert.ok(r.levels[1] > 0 && r.levels[1] < 0.16);
r = run(48, [lamp('old'), lamp('new', 2)]);
assert.deepEqual(r.levels, [1, 0.32]);
r = run(64, [lamp('old')]);
assert.equal(r.levels[0], 1);
const arcLamp = (id, i) => ({
  ...lamp(id),
  pathIndex: i,
  lampAttachFraction: 0.5,
  gpuLampOffsetX: 0,
  gpuLampOffsetY: 0,
});
assert.deepEqual(run(0, [arcLamp('a', 0), arcLamp('b', 1)], false, true, 'arc').levels, [1, 1]);
assert.deepEqual(run(16, [arcLamp('a', 0), arcLamp('b', 0)], false, true, 'arc').levels, [0.5, 0.5]);

// --- Близкие лампы одного узла: гасятся по расстоянию относительно размера -----------------------
const sized = (id, px, rank = 0, rad = 30) => ({
  lampTraceId: id,
  px,
  py: 0,
  rad,
  intensityAlpha: 1,
  lampRank: rank,
});
const merged = (lamps, t = 1000, scope = 'merge') => (
  apply(scope, lamps, { now: t, duration: 100, animate: false, merge: 0.5 }),
  lamps.map((l) => l.intensityAlpha)
);
// 4 px при радиусе 30 — внутри половины радиуса: остаётся одна лампа
let m = merged([sized('a', 0), sized('b', 4), sized('c', 8), sized('d', 12)], 1000, 'cluster');
assert.equal(m[0], 1);
assert.ok(m[1] < 1e-9, `сосед внутри половины радиуса гасится целиком: ${m}`);
assert.ok(m[2] < 0.05, `на краю половины радиуса почти погас: ${m}`);
assert.ok(m[3] > m[2] && m[3] < 1, `дальше возвращается плавно: ${m}`);
// далеко друг от друга (дальше радиуса) — не трогаем
m = merged([sized('a', 0), sized('b', 60)], 1000, 'far');
assert.deepEqual(m, [1, 1]);
// мелкие лампы не сливаются: порог — доля радиуса меньшей лампы
m = merged([sized('a', 0, 0, 2), sized('b', 4, 0, 2)], 1000, 'tiny');
assert.deepEqual(m, [1, 1]);
// ключевая точка важнее излома, даже если идентификатор излома «раньше» по алфавиту
m = merged([sized('a-bend', 0, 1), sized('z-key', 3, 0)], 1000, 'rank');
assert.equal(m[1], 1);
assert.ok(m[0] < 1e-9);
// плавность: по мере расхождения соседа его яркость растёт монотонно, без скачков
let prevLevel = -1;
for (let d = 0; d <= 20; d += 0.5) {
  const lv = merged([sized('a', 0), sized('b', d)], 1000, `smooth${d}`)[1];
  assert.ok(lv >= prevLevel - 1e-12, `монотонность на ${d}`);
  assert.ok(prevLevel < 0 || lv - prevLevel < 0.35, `скачок яркости на ${d}: ${prevLevel} → ${lv}`);
  prevLevel = lv;
}
assert.equal(prevLevel, 1);
// режим «Произвольное» (merge = 0) лампы не гасит
const lampsDense = [sized('a', 0), sized('b', 2)];
apply('dense', lampsDense, { now: 1000, duration: 100, animate: false, merge: 0 });
assert.ok(lampsDense.every((l) => l.intensityAlpha > 0.4));

// --- Перескок лампы: затухает на старом месте и появляется на новом, а не летит через пустоту ----
{
  const scope = 'hop';
  const at = (t, px) => {
    const hopper = { lampTraceId: 'h', px, py: 0, rad: 10, intensityAlpha: 1 };
    const still = { lampTraceId: 's', px: 500, py: 0, rad: 10, intensityAlpha: 1 };
    apply(scope, [hopper, still], { now: t, duration: 100, animate: true });
    return { hopper, still };
  };
  for (let t = 0; t <= 160; t += 16) at(t, 0); // стоит на месте
  const xs = [];
  const alphas = [];
  for (let t = 176; t <= 176 + 320; t += 16) {
    const { hopper, still } = at(t, 50); // перескочила на 50 px
    xs.push(hopper.px);
    alphas.push(hopper.intensityAlpha);
    assert.equal(still.intensityAlpha, 1, 'соседняя лампа светит ровно');
  }
  assert.ok(
    xs.every((x) => x === 0 || x === 50),
    `лампа не должна скользить по пустому месту: ${xs}`,
  );
  assert.ok(Math.min(...alphas) < 0.1, 'в момент перескока лампа гаснет');
  assert.equal(alphas[alphas.length - 1], 1, 'и снова светит полностью на новом месте');
  assert.equal(xs[xs.length - 1], 50);
}

// --- «Хранитель» (режим GPU-дуг, где теней нет): на старте фазы все лампы не гаснут разом, одна остаётся включённой --------------
{
  const set = (prefix, xs) =>
    xs.map((x, i) => ({
      lampTraceId: `${prefix}${i}`,
      px: x,
      py: 0,
      rad: 10,
      intensityAlpha: 1,
      pathIndex: 0,
      lampAttachFraction: i / 10,
      gpuLampOffsetX: 0,
      gpuLampOffsetY: 0,
    }));
  const scope = 'keeper';
  for (let t = 0; t <= 160; t += 16)
    apply(scope, set('a', [0, 100, 200, 300]), { now: t, duration: 200, animate: true, arc: true });
  // Начало новой фазы: все идентификаторы новые и стоят далеко от старых (рождаются тёмными).
  let minPeak = Infinity;
  let keeperIds = new Set();
  for (let t = 176; t <= 176 + 600; t += 16) {
    const lamps = set('b', [60, 160, 260, 360]);
    apply(scope, lamps, { now: t, duration: 200, animate: true, arc: true });
    minPeak = Math.min(minPeak, Math.max(...lamps.map((l) => l.intensityAlpha)));
    lamps.filter((l) => l.intensityAlpha >= 0.99).forEach((l) => keeperIds.add(l.lampTraceId));
  }
  assert.ok(minPeak >= 0.5, `хотя бы одна лампа светит в каждом кадре: минимум ${minPeak}`);
  const lastLamps = set('b', [60, 160, 260, 360]);
  apply(scope, lastLamps, { now: 1000, duration: 200, animate: true, arc: true });
  assert.ok(
    lastLamps.every((l) => l.intensityAlpha === 1),
    'в конце зажглись все',
  );
  // Остальные зажигаются плавно, а не все сразу: на втором кадре тёмных большинство.
  const scope2 = 'keeper2';
  for (let t = 0; t <= 160; t += 16)
    apply(scope2, set('a', [0, 100, 200, 300]), { now: t, duration: 200, animate: true, arc: true });
  const first = set('b', [60, 160, 260, 360]);
  apply(scope2, first, { now: 176, duration: 200, animate: true, arc: true });
  assert.equal(first.filter((l) => l.intensityAlpha >= 0.5).length, 1, 'ровно одна включена');
  assert.equal(first[0].intensityAlpha, 1, 'ближайшая к лампе, что светила последней');
  // Одновременный перескок всех ламп: одна остаётся
  const scope3 = 'keeper3';
  const mk = (x0) => set('c', [x0, x0 + 100, x0 + 200]);
  for (let t = 0; t <= 160; t += 16)
    apply(scope3, mk(0), { now: t, duration: 200, animate: true, arc: true });
  let peakMin = Infinity;
  for (let t = 176; t <= 176 + 400; t += 16) {
    const lamps = mk(40);
    apply(scope3, lamps, { now: t, duration: 200, animate: true, arc: true });
    peakMin = Math.min(peakMin, Math.max(...lamps.map((l) => l.intensityAlpha)));
  }
  assert.ok(peakMin >= 0.5, `при общем перескоке одна лампа остаётся: ${peakMin}`);
  // Самое первое появление света (до этого ничего не светило) хранителя не включает
  const scope4 = 'keeper4';
  const born = set('n', [0, 100]);
  apply(scope4, born, { now: 0, duration: 200, animate: true, arc: true });
  assert.ok(born.every((l) => l.intensityAlpha === 0));
}

// --- Смена схемы идентификаторов на тех же местах (статика → морф): лампы не гаснут, а наследуют уровень ----
{
  const set = (prefix, xs, level = 1) =>
    xs.map((x, i) => ({ lampTraceId: `${prefix}${i}`, px: x, py: 0, rad: 10, intensityAlpha: level }));
  const scope = 'inherit';
  const xs = [0, 100, 200, 300];
  for (let t = 0; t <= 160; t += 16)
    apply(scope, set('blue:', xs, 0.4), { now: t, duration: 200, animate: true });
  let minLevel = Infinity;
  let spread = 0;
  for (let t = 176; t <= 176 + 600; t += 16) {
    // Те же места, но слегка сдвинулись за кадр и идентификаторы другие.
    const lamps = set(
      'key:',
      xs.map((x) => x + (t - 176) / 100),
      0.4,
    );
    apply(scope, lamps, { now: t, duration: 200, animate: true });
    for (const l of lamps) {
      minLevel = Math.min(minLevel, l.intensityAlpha);
      spread = Math.max(spread, Math.abs(l.intensityAlpha - 0.4));
    }
  }
  assert.ok(minLevel > 0.399, `ни одна лампа не мигает при смене идентификаторов: минимум ${minLevel}`);
  assert.ok(spread < 1e-9);

  // Часть ламп новая: те, что встали на старые места, наследуют уровень, а настоящие новые — тёмные.
  const scope2 = 'inherit2';
  for (let t = 0; t <= 160; t += 16)
    apply(scope2, set('a', [0, 100], 1), { now: t, duration: 200, animate: true });
  const mixed = [
    { lampTraceId: 'n0', px: 2, py: 0, rad: 10, intensityAlpha: 1 },
    { lampTraceId: 'n1', px: 101, py: 0, rad: 10, intensityAlpha: 1 },
    { lampTraceId: 'n2', px: 400, py: 0, rad: 10, intensityAlpha: 1 },
  ];
  apply(scope2, mixed, { now: 416, duration: 200, animate: true });
  assert.deepEqual(
    mixed.map((l) => l.intensityAlpha),
    [1, 1, 0],
    'унаследовали две, третья родилась тёмной ' + JSON.stringify(mixed.map((l) => l.intensityAlpha)),
  );

  // Одна старая лампа передаёт уровень только одной новой.
  const scope3 = 'inherit3';
  for (let t = 0; t <= 400; t += 16)
    apply(scope3, [set('a', [0], 1)[0]], { now: t, duration: 200, animate: true });
  const pair = [
    { lampTraceId: 'p0', px: 3, py: 0, rad: 10, intensityAlpha: 1 },
    { lampTraceId: 'p1', px: -2, py: 0, rad: 10, intensityAlpha: 1 },
  ];
  apply(scope3, pair, { now: 416, duration: 200, animate: true });
  assert.equal(pair.filter((l) => l.intensityAlpha >= 0.99).length, 1, 'ровно одна унаследовала');
  assert.equal(pair.filter((l) => l.intensityAlpha === 0).length, 1, 'вторая родилась тёмной');

  // Режим GPU-дуг также сохраняет яркость совпавших ламп.
  const scope4 = 'inherit4';
  const arcLamp = (id, fraction) => ({
    lampTraceId: id,
    px: fraction * 100,
    py: 0,
    rad: 10,
    intensityAlpha: 1,
    pathIndex: 0,
    lampAttachFraction: fraction,
    gpuLampOffsetX: 0,
    gpuLampOffsetY: 0,
  });
  const arcSet = (a, b) => [arcLamp(a, 0.2), arcLamp(b, 0.7)];
  for (let t = 0; t <= 400; t += 16)
    apply(scope4, arcSet('x0', 'x1'), { now: t, duration: 200, animate: true, arc: true });
  const reborn = arcSet('y0', 'y1');
  apply(scope4, reborn, { now: 416, duration: 200, animate: true, arc: true });
  assert.equal(reborn.filter((l) => l.intensityAlpha >= 0.99).length, 2, 'в режиме дуг обе лампы сохранили яркость');
}

// --- Тени: перескок и смена идентификаторов — перекрёстное затухание без провала света ---------------
{
  const light = (lamps) => lamps.reduce((sum, l) => sum + l.intensityAlpha, 0);
  // Перескок: на новом месте разгорается сама лампа, на старом гаснет её тень; сумма не проваливается.
  const scope = 'ghost-hop';
  const at = (t, px) => {
    const hopper = { lampTraceId: 'h', px, py: 0, rad: 10, intensityAlpha: 1 };
    const items = [hopper];
    apply(scope, items, { now: t, duration: 100, animate: true });
    return { hopper, items };
  };
  for (let t = 0; t <= 400; t += 16) at(t, 0);
  let sawGhost = false;
  for (let t = 416; t <= 416 + 400; t += 16) {
    const { hopper, items } = at(t, 50);
    const ghosts = items.filter((l) => l !== hopper);
    sawGhost ||= ghosts.some((g) => g.px === 0 && g.lampTraceId === 'h~g');
    assert.equal(hopper.px, 50, 'сама лампа сразу на новом месте');
    assert.ok(Math.abs(light(items) - 1) < 1e-9, `сумма света не проваливается: ${light(items)}`);
  }
  assert.ok(sawGhost, 'на старом месте была тень');
  assert.equal(at(416 + 416, 50).items.length, 1, 'через время перескока тени нет');

  // Идентификаторы сменились, лампы далеко от прежних: старые досвечивают и гаснут, новые разгораются.
  const scope2 = 'ghost-orphan';
  const mk = (prefix, xs) =>
    xs.map((x, i) => ({ lampTraceId: `${prefix}${i}`, px: x, py: 0, rad: 10, intensityAlpha: 1 }));
  for (let t = 0; t <= 400; t += 16)
    apply(scope2, mk('a', [0, 100, 200]), { now: t, duration: 200, animate: true });
  let minLight = Infinity;
  let last = null;
  for (let t = 416; t <= 416 + 600; t += 16) {
    last = mk('b', [60, 160, 260]);
    apply(scope2, last, { now: t, duration: 200, animate: true });
    minLight = Math.min(minLight, light(last));
  }
  assert.ok(minLight >= 1, `свет не проваливается при смене идентификаторов: минимум ${minLight}`);
  assert.equal(last.length, 3, 'тени исчезли');
  assert.ok(
    last.every((l) => l.intensityAlpha === 1),
    'новые зажглись полностью',
  );

  // Если лампа вернулась, её тень не остаётся (нет удвоения света).
  const scope3 = 'ghost-return';
  const one = (id) => [{ lampTraceId: id, px: 0, py: 0, rad: 10, intensityAlpha: 1 }];
  for (let t = 0; t <= 400; t += 16) apply(scope3, one('x'), { now: t, duration: 200, animate: true });
  apply(scope3, one('y'), { now: 416, duration: 200, animate: true });
  const back = one('x');
  apply(scope3, back, { now: 432, duration: 200, animate: true });
  assert.equal(back.length, 1, 'вернувшаяся лампа без тени');
}
console.log(
  'PASS: new lamps start dark, overlapping lights share intensity, separation ramps, and GPU arc placeholders do not collapse unrelated paths',
);

const test = require('node:test');
test('phase handoff transfers existing light by position even when IDs are reassigned', () => {
  apply('phase-cpu', [lamp('a', 0), lamp('b', 100), lamp('c', 200)], {
    now: 0, duration: 100, animate: false, phase: 1,
  });
  const items = [lamp('b', 0), lamp('c', 100), lamp('new-c', 200), lamp('new', 300)];
  apply('phase-cpu', items, { now: 16, duration: 100, animate: true, phase: 2 });
  assert.deepEqual(items.map((v) => v.intensityAlpha), [1, 1, 1, 0]);
});

test('retained GPU arcs transfer light using attachment, not placeholder position', () => {
  const make = (id, i, frac = 0.5) => ({
    ...arcLamp(id, i), lampAttachFraction: frac, lampHasAttachFraction: true,
  });
  const cfg = { duration: 100, arc: true, arcPlaceholders: true };
  apply('phase-arc', [make('a', 0), make('b', 1), make('c', 1, 0.75)], {
    ...cfg, now: 0, animate: false, phase: 1,
  });
  const items = [make('x', 0), make('y', 1), make('z', 1, 0.75), make('new', 1, 0.9)];
  apply('phase-arc', items, { ...cfg, now: 16, animate: true, phase: 2 });
  assert.deepEqual(items.map((v) => v.intensityAlpha), [1, 1, 1, 0]);
  const cpu = [make('xx', 0), make('yy', 1), make('zz', 1, 0.75)];
  cpu.forEach((v, i) => { v.px = 100 * i; });
  apply('phase-arc', cpu, { now: 32, duration: 100, animate: true, phase: 2 });
  assert.deepEqual(cpu.map((v) => v.intensityAlpha), [1, 1, 1]);
});

test('intersection toggle preserves two fully lit lamps even at the same point when off', () => {
  for (const arc of [false, true]) {
    for (const enabled of [true, false]) {
      const items = arc ? [arcLamp('a', 0), arcLamp('b', 0)] : [sized('a', 0), sized('b', 0)];
      apply(`toggle-${arc}-${enabled}`, items, {
        now: 0, duration: 100, animate: false, arc, arcPlaceholders: arc, merge: 0.5,
        extinguishIntersections: enabled,
      });
      if (enabled) assert.ok(items.every((v) => v.intensityAlpha < 1));
      else assert.deepEqual(items.map((v) => v.intensityAlpha), [1, 1]);
    }
  }
});

test('coincident lamps fade smoothly into one at both phase endpoints', () => {
  for (const arc of [false, true]) {
    for (const enabled of [false, true]) {
      const levelsAt = (t) => {
        const items = arc ? [arcLamp('a', 0), arcLamp('b', 0)] : [lamp('a'), lamp('b')];
        apply(`endpoint-${arc}-${enabled}`, items, {
          now: 0, duration: 100, animate: false, phase: 1, phaseProgress: t,
          arc, arcPlaceholders: arc, extinguishIntersections: enabled,
        });
        return items.map((v) => v.intensityAlpha);
      };
      for (const t of [0, 1]) assert.deepEqual(levelsAt(t), [1, 0]);
      assert.deepEqual(levelsAt(0.5), enabled ? [0.5, 0.5] : [1, 1]);
      for (const t of [0.001, 0.999]) {
        const [first, second] = levelsAt(t);
        assert.ok(first > 0.999 && second > 0 && second < 0.002);
      }
    }
  }
});

test('contour lamps stay at the attached positions and ease brightness on release', () => {
  const cfg = { duration: 100, phase: 1, phaseProgress: 0.5, extinguishIntersections: true };
  const bound = (id, x, intensityAlpha = 1) => ({
    ...lamp(id, x), intensityAlpha, lampContourBound: true, lampPresence: 1, lampTargetPresent: true,
  });
  apply('attached-hop', [bound('a', 0)], { ...cfg, now: 0, animate: false });
  const moved = [bound('a', 30, 0.3)];
  apply('attached-hop', moved, { ...cfg, now: 16, animate: true });
  assert.equal(moved.length, 1);
  assert.equal(moved[0].px, 30);
  assert.ok(Math.abs(moved[0].intensityAlpha - 0.84) < 1e-8);
  const next = [bound('new', 30.2, 0.3), bound('extra', 30.2, 0.3)];
  apply('attached-hop', next, { ...cfg, now: 32, animate: true, phase: 2, phaseProgress: 0 });
  assert.equal(next.filter((p) => p.intensityAlpha > 0).length, 1);
  assert.equal(next[0].intensityAlpha, moved[0].intensityAlpha);
});

test('authored source vertices are already lit after a phase changes their IDs and samples', () => {
  const cfg = { duration: 100, arc: false, extinguishIntersections: false };
  apply('source-vertices', [lamp('old-a', 0), lamp('old-b', 40)], {
    ...cfg, now: 0, phase: 1, phaseProgress: 1, animate: false,
  });
  const vertices = [
    { ...lamp('new-a', 3), lampSourcePresent: true, lampContourBound: true },
    { ...lamp('new-b', 43), lampSourcePresent: true, lampContourBound: true },
    { ...lamp('birth', 70), lampSourcePresent: false, lampContourBound: true },
  ];
  apply('source-vertices', vertices, { ...cfg, now: 16, phase: 2, phaseProgress: .001, animate: true });
  assert.deepEqual(vertices.map((p) => p.intensityAlpha), [1, 1, 0]);
});
