// Адаптивный свет: ползунок «Экспоненциальность» и «Авто-экспонента».
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LAMP_AUTO_EXPONENT_BOOST,
  createLampAutoExponentState,
  lampAdaptiveExponentShape,
  snapLampAdaptiveExponent,
  stepLampAutoExponent,
} from '../js/lamps/adaptive-exponent.js';
import { importModule } from './helpers/app-env.mjs';

const near = (a, b, eps = 1e-12) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);

test('ползунок: шаг 5, диапазон −100…100, мусор → 0', () => {
  assert.equal(snapLampAdaptiveExponent(0), 0);
  assert.equal(snapLampAdaptiveExponent(7), 5);
  assert.equal(snapLampAdaptiveExponent(8), 10);
  assert.equal(snapLampAdaptiveExponent(-7), -5);
  assert.equal(snapLampAdaptiveExponent(103), 100);
  assert.equal(snapLampAdaptiveExponent(-250), -100);
  assert.equal(snapLampAdaptiveExponent('abc'), 0);
  assert.equal(snapLampAdaptiveExponent(undefined), 0);
  assert.ok(Object.is(snapLampAdaptiveExponent(-1), 0), 'без отрицательного нуля');
});

test('кривая: 0 — линейно, ±1 — десятичные экспоненты, концы 0 и 1 неподвижны', () => {
  for (const x of [0, 0.1, 0.37, 0.5, 0.9, 1]) {
    near(lampAdaptiveExponentShape(x, 0), x);
    near(lampAdaptiveExponentShape(x, 1), (Math.pow(10, x) - 1) / 9);
    near(lampAdaptiveExponentShape(x, -1), (1 - Math.pow(10, -x)) / 0.9);
  }
  for (const k of [-1, -0.5, -0.05, 0, 0.05, 0.5, 1]) {
    near(lampAdaptiveExponentShape(0, k), 0);
    near(lampAdaptiveExponentShape(1, k), 1);
  }
});

test('кривая: плюс прижимает к нулю, минус поднимает, монотонна и непрерывна около нуля', () => {
  for (let x = 0.05; x < 1; x += 0.05) {
    assert.ok(lampAdaptiveExponentShape(x, 0.5) < x);
    assert.ok(lampAdaptiveExponentShape(x, -0.5) > x);
    assert.ok(lampAdaptiveExponentShape(x, 1) < lampAdaptiveExponentShape(x, 0.5));
    assert.ok(lampAdaptiveExponentShape(x, -1) > lampAdaptiveExponentShape(x, -0.5));
    near(lampAdaptiveExponentShape(x, 1e-4), x, 1e-3); // нет скачка при выходе из нуля
  }
  for (const k of [-1, -0.3, 0.3, 1]) {
    let prev = -1;
    for (let i = 0; i <= 100; i++) {
      const v = lampAdaptiveExponentShape(i / 100, k);
      assert.ok(v > prev, `монотонность при k=${k}, x=${i / 100}`);
      prev = v;
    }
  }
});

test('авто-экспонента: спокойная сцена не срабатывает, вспышка плавно поднимает и затем возвращает', () => {
  const rt = createLampAutoExponentState();
  let t = 1000;
  for (let i = 0; i < 40; i++) {
    t += 16;
    assert.equal(stepLampAutoExponent(rt, 50000, t, 1, true), 0, 'ровная площадь — без добавки');
  }
  assert.equal(rt.flashes, 0);
  t += 16;
  const first = stepLampAutoExponent(rt, 120000, t, 1, true); // площадь выросла более чем вдвое
  assert.ok(first > 0, 'вспышка замечена');
  assert.ok(first < LAMP_AUTO_EXPONENT_BOOST * 0.2, 'но не скачком: первый кадр — малая доля добавки');
  assert.equal(rt.flashes, 1);
  // Нарастание: кадр за кадром без больших ступенек, до почти полной добавки.
  let prev = first,
    maxStep = first,
    peak = first;
  for (let i = 0; i < 400; i++) {
    t += 16;
    const b = stepLampAutoExponent(rt, 120000, t, 1, true);
    maxStep = Math.max(maxStep, Math.abs(b - prev));
    peak = Math.max(peak, b);
    prev = b;
  }
  assert.ok(maxStep < LAMP_AUTO_EXPONENT_BOOST * 0.1, `шаг за кадр ${maxStep} слишком резкий`);
  assert.ok(peak > LAMP_AUTO_EXPONENT_BOOST * 0.8, `добавка должна дорастать до цели, а не до ${peak}`);
  assert.equal(prev, 0, 'через несколько секунд добавка полностью ушла');
  assert.equal(rt.flashes, 1, 'одна вспышка — один отсчёт');
});

test('авто-экспонента: слабый рост даёт малую добавку, сильный — полную (без порога-ступеньки)', () => {
  const peakFor = (ratio) => {
    const rt = createLampAutoExponentState();
    let t = 1000;
    for (let i = 0; i < 40; i++) stepLampAutoExponent(rt, 50000, (t += 16), 1, true);
    let peak = 0;
    for (let i = 0; i < 120; i++)
      peak = Math.max(peak, stepLampAutoExponent(rt, 50000 * ratio, (t += 16), 1, true));
    return peak;
  };
  const weak = peakFor(1.2),
    mid = peakFor(1.5),
    strong = peakFor(3);
  assert.ok(weak < mid && mid < strong, `${weak} < ${mid} < ${strong}`);
  assert.ok(weak < LAMP_AUTO_EXPONENT_BOOST * 0.2);
  assert.ok(strong > LAMP_AUTO_EXPONENT_BOOST * 0.8);
});

test('авто-экспонента: без перегрузки и на первом кадре вспышка не фиксируется', () => {
  const calm = createLampAutoExponentState();
  assert.equal(stepLampAutoExponent(calm, 90000, 1000, 1, true), 0, 'первый кадр');
  assert.equal(stepLampAutoExponent(calm, 20000, 1016, 1, true), 0);
  assert.equal(stepLampAutoExponent(calm, 90000, 1032, 1, false), 0, 'рост без перегрузки');
  assert.equal(calm.flashes, 0);
});

test('авто-экспонента: чем больше время экспозиции, тем дольше держится добавка', () => {
  const run = (exposureSec) => {
    const rt = createLampAutoExponentState();
    let t = 1000;
    for (let i = 0; i < 20; i++) stepLampAutoExponent(rt, 40000, (t += 16), exposureSec, true);
    stepLampAutoExponent(rt, 100000, (t += 16), exposureSec, true);
    let frames = 0;
    while (stepLampAutoExponent(rt, 100000, (t += 16), exposureSec, true) > 0 && frames < 5000) frames++;
    return frames;
  };
  assert.ok(run(4) > run(0.5));
});

// --- Реальный расчёт коэффициентов (lamp-visual.js) ---------------------------------------------
async function setup() {
  const lv = await importModule('js/lamps/lamp-visual.js');
  const rr = await importModule('js/core/render-runtime.js');
  const baseCfg = (over = {}) => ({
    radius: 50,
    brightness: 100,
    adaptiveBrightness: true,
    adaptiveAdjustBrightness: true,
    adaptiveStrength: 100,
    adaptiveStrengthMultiplier: 1,
    adaptiveFadeSec: 0, // без сглаживания: проверяем кривую в чистом виде
    ...over,
  });
  const factorsFor = (cfg, count = 10) => {
    lv.beginLampAdaptiveFrame();
    return lv.prepareLampDrawStyle(cfg, -1, count, 1, 1).adaptive;
  };
  return { lv, rr, baseCfg, factorsFor };
}

test('расчёт: экспоненциальность 0 даёт прежний результат, плюс гасит сильнее, минус мягче', async () => {
  const { baseCfg, factorsFor } = await setup();
  const legacy = factorsFor(baseCfg()); // поле adaptiveExponent отсутствует — как в старых проектах
  const zero = factorsFor(baseCfg({ adaptiveExponent: 0 }));
  assert.ok(legacy.brightnessFactor < 1, 'сцена перегружена, адаптация работает');
  assert.equal(zero.brightnessFactor, legacy.brightnessFactor);
  const plus = factorsFor(baseCfg({ adaptiveExponent: 100 }));
  const minus = factorsFor(baseCfg({ adaptiveExponent: -100 }));
  assert.ok(plus.brightnessFactor < zero.brightnessFactor);
  assert.ok(minus.brightnessFactor > zero.brightnessFactor);
  // Привязка к шагу 5 делается в интерфейсе и при загрузке; в расчёте значение плавное (для маршрутизации).
  const mid = factorsFor(baseCfg({ adaptiveExponent: 52 })).brightnessFactor;
  assert.ok(mid < factorsFor(baseCfg({ adaptiveExponent: 50 })).brightnessFactor);
  assert.ok(mid > factorsFor(baseCfg({ adaptiveExponent: 55 })).brightnessFactor);
});

test('расчёт: кривая работает и для канала «размер» (радиус), яркость при этом не трогается', async () => {
  const { baseCfg, factorsFor } = await setup();
  const size = (e) => factorsFor(baseCfg({ adaptiveAdjustBrightness: false, adaptiveExponent: e }));
  const zero = size(0);
  assert.equal(zero.brightnessFactor, 1);
  assert.ok(zero.radiusFactor < 1);
  assert.ok(size(100).radiusFactor < zero.radiusFactor);
  assert.ok(size(-100).radiusFactor > zero.radiusFactor);
});

test('расчёт: авто-экспонента по умолчанию выключена, при включении вспышка усиливает подавление', async () => {
  const { rr, baseCfg, factorsFor } = await setup();
  rr.renderRuntime.active = true;
  try {
    const timeline = (auto) => {
      const cfg = baseCfg({ adaptiveAutoExponent: auto, adaptiveFadeSec: 1 });
      cfg.adaptiveFadeSec = 0;
      let t = 5000;
      const at = (count) => {
        rr.renderRuntime.now = t += 16;
        return factorsFor(cfg, count).brightnessFactor;
      };
      for (let i = 0; i < 30; i++) at(8); // спокойно: умеренная нагрузка
      return {
        first: at(24),
        later: (() => {
          for (let i = 0; i < 20; i++) at(24);
          return at(24);
        })(),
        settled: (() => {
          for (let i = 0; i < 400; i++) at(24);
          return at(24);
        })(),
      };
    };
    const off = timeline(false);
    const on = timeline(true);
    assert.ok(on.first <= off.first, 'в момент вспышки коэффициент не выше, чем без авто-экспоненты');
    assert.ok(on.first > off.first * 0.9, 'и он меняется не скачком, а плавно');
    assert.ok(on.later < off.later, 'через ~300 мс добавка набрана: коэффициент заметно ниже');
    assert.equal(on.settled, off.settled, 'после затухания добавки результат тот же, что без неё');
  } finally {
    rr.renderRuntime.active = false;
  }
});

test('множитель степени: ×3 расширяет диапазон, ×1 сохраняет старую кривую, ×0 линейный', () => {
  for (const x of [0, 0.1, 0.5, 0.9, 1]) {
    for (const k of [-1, -0.2, 0, 0.2, 1]) {
      near(lampAdaptiveExponentShape(x, k, 1), lampAdaptiveExponentShape(x, k));
      near(lampAdaptiveExponentShape(x, k, 0), x);
      const exponent = k * 3;
      const expected = exponent === 0 ? x : (10 ** (exponent * x) - 1) / (10 ** exponent - 1);
      near(lampAdaptiveExponentShape(x, k, 3), expected);
      assert.ok(Number.isFinite(lampAdaptiveExponentShape(x, k, 64)));
    }
  }
  assert.ok(lampAdaptiveExponentShape(0.5, 1, 3) < lampAdaptiveExponentShape(0.5, 1, 1));
});

test('реальный рендер: ×3 по умолчанию, оба канала и отключение адаптации', async () => {
  const {baseCfg, factorsFor} = await setup();
  for (const adaptiveAdjustBrightness of [false, true]) {
    const at = (e, m, other = {}) => factorsFor(baseCfg({adaptiveAdjustBrightness, adaptiveExponent:e, adaptiveExponentMultiplier:m, ...other}));
    const key = adaptiveAdjustBrightness ? 'brightnessFactor' : 'radiusFactor';
    for (const e of [-20, 20]) {
      near(at(e, undefined)[key], at(e, 3)[key]);
      near(at(e, 3)[key], at(e * 3, 1)[key]);
      near(at(e, 0)[key], at(0, 1)[key]);
    }
    assert.ok(at(100, 3)[key] < at(100, 1)[key]);
    assert.equal(at(100, 3, {adaptiveBrightness:false})[key], 1);
  }
});

test('настройка множителя: новый слой, нормализация старого и сохранение явного значения', async () => {
  const {state} = await importModule('js/core/state.js');
  const {ensureLayerLampState, createLayer} = await importModule('js/core/defaults-layers.js');
  const {normalizeLampAdaptiveExponentMultiplier: normalize} = await import('../js/lamps/adaptive-exponent.js');
  assert.equal(state.lamps.adaptiveExponentMultiplier, 3);
  const layer = createLayer();
  assert.equal(ensureLayerLampState(layer).adaptiveExponentMultiplier, 3);
  delete layer.lamps.adaptiveExponentMultiplier;
  assert.equal(ensureLayerLampState(layer).adaptiveExponentMultiplier, 3);
  for (const value of [0, 1, 7.5]) {
    layer.lamps.adaptiveExponentMultiplier = value;
    assert.equal(ensureLayerLampState(layer).adaptiveExponentMultiplier, value);
  }
  assert.equal(normalize(''), 3);
  assert.equal(normalize(Infinity), 3);
  assert.equal(normalize(100), 64);
  assert.equal(normalize(-1), 0);
});
