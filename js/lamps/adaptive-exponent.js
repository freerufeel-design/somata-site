// Адаптивный свет: форма кривой «нагрузка → коэффициент» и авто-экспонента.
// Модуль чистый (без DOM и общего состояния), чтобы его можно было проверять в Node.

/** Шаг ползунка «Экспоненциальность», %. */
export const LAMP_ADAPTIVE_EXPONENT_STEP = 5;
/** Наибольшая добавка к степени (в долях ползунка, 0.25 = 25 п. п.) при сильной вспышке. */
export const LAMP_AUTO_EXPONENT_BOOST = 0.25;
/** Вспышка начинает учитываться, когда площадь ламп выше своего медленного среднего во столько раз… */
export const LAMP_AUTO_EXPONENT_FLASH_START = 1.15;
/** …и даёт полную добавку, когда выше во столько раз (между ними — плавная S-кривая, без порога-«ступеньки»). */
export const LAMP_AUTO_EXPONENT_FLASH_FULL = 2.2;
/** Постоянная времени (мс) медленного среднего площади. */
export const LAMP_AUTO_EXPONENT_EMA_MS = 250;
/** Нижняя граница времени нарастания добавки, мс (она никогда не появляется скачком). */
export const LAMP_AUTO_EXPONENT_MIN_ATTACK_MS = 150;
/** Нижняя граница времени возврата поднятой степени, мс. */
export const LAMP_AUTO_EXPONENT_MIN_DECAY_MS = 400;

/** Значение ползунка в %, привязанное к шагу 5 и зажатое в −100…100. */
export function snapLampAdaptiveExponent(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const snapped = Math.round(n / LAMP_ADAPTIVE_EXPONENT_STEP) * LAMP_ADAPTIVE_EXPONENT_STEP;
  return Math.max(-100, Math.min(100, snapped)) + 0; // + 0 убирает −0
}

/**
 * Кривая отклика. x ∈ [0, 1] — нагрузка (1 = нагрузки нет), k ∈ [−1, 1] — степень экспоненты.
 *   k = 0  : линейно, f(x) = x
 *   k = +1 : десятичная положительная экспонента, f(x) = (10^x − 1) / 9
 *   k = −1 : десятичная отрицательная экспонента, f(x) = (1 − 10^−x) / 0.9
 * Промежуточные k плавно переходят одно в другое. f(0) = 0 и f(1) = 1 при любом k.
 */
export function lampAdaptiveExponentShape(x, k) {
  const v = Math.max(0, Math.min(1, Number(x) || 0));
  const kk = Math.max(-1, Math.min(1, Number(k) || 0));
  if (Math.abs(kk) < 1e-6) return v;
  return (Math.pow(10, kk * v) - 1) / (Math.pow(10, kk) - 1);
}

export function createLampAutoExponentState() {
  return { ema: 0, boost: 0, peak: 0, holdUntil: 0, flashing: false, last: 0, flashes: 0 };
}

const smoothstep01 = (x) => {
  const v = Math.max(0, Math.min(1, x));
  return v * v * (3 - 2 * v);
};

/**
 * Один шаг авто-экспоненты. area — общая площадь ламп (px²), now — время, мс,
 * overloaded — адаптация сейчас что-то подавляет. Возвращает добавку к степени (0…BOOST).
 *
 * Вспышка (площадь выше своего медленного среднего) задаёт ЦЕЛЬ добавки — плавной S-кривой от силы
 * вспышки, поэтому слабый рост почти не трогает кривую, а сильный даёт полную добавку. Сама добавка
 * к цели ТОЛЬКО ПЛАВНО ДОГОНЯЕТ (время нарастания ~ экспозиции), так что на статичной сцене, где
 * коэффициенты применяются сразу, не бывает скачка. Достигнутая цель удерживается, затем
 * экспоненциально спадает за время, пропорциональное экспозиции адаптации.
 */
export function stepLampAutoExponent(rt, area, now, exposureSec = 1, overloaded = true) {
  const a = Math.max(0, Number(area) || 0);
  const dt = rt.last > 0 ? Math.max(0, Math.min(250, now - rt.last)) : 0;
  rt.last = now;
  if (!(rt.ema > 0)) rt.ema = a;
  const exposureMs = Math.max(0, Number(exposureSec) || 0) * 1000;
  const attack = Math.max(LAMP_AUTO_EXPONENT_MIN_ATTACK_MS, exposureMs * 0.25);
  const decay = Math.max(LAMP_AUTO_EXPONENT_MIN_DECAY_MS, exposureMs * 0.8);
  let strength = 0;
  if (overloaded && dt > 0 && a - rt.ema > 1 && rt.ema > 0) {
    strength = smoothstep01(
      (a / rt.ema - LAMP_AUTO_EXPONENT_FLASH_START) /
        (LAMP_AUTO_EXPONENT_FLASH_FULL - LAMP_AUTO_EXPONENT_FLASH_START),
    );
  }
  const flashing = strength > 0.02;
  if (flashing && !rt.flashing) rt.flashes++;
  rt.flashing = flashing || (rt.flashing && strength > 0.005);
  // Цель: удерживается ~двойное время нарастания, потом плавно спадает.
  const aim = LAMP_AUTO_EXPONENT_BOOST * strength;
  if (aim > rt.peak) {
    rt.peak = aim;
    rt.holdUntil = now + attack * 2;
  } else if (now > rt.holdUntil) rt.peak *= Math.exp(-dt / decay);
  if (rt.peak < 0.003) rt.peak = 0;
  // Добавка догоняет цель с конечной скоростью и никогда не прыгает.
  if (rt.boost < rt.peak) rt.boost += (rt.peak - rt.boost) * (1 - Math.exp(-dt / attack));
  else rt.boost = rt.peak;
  if (rt.boost < 0.003 && rt.peak === 0) rt.boost = 0;
  rt.ema += (a - rt.ema) * (1 - Math.exp(-dt / LAMP_AUTO_EXPONENT_EMA_MS));
  return rt.boost;
}
