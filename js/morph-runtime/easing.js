// Time curves shared by Blue Morph, manual edits and the project morph (Green).
// Pure functions of t in [0, 1]; Anticipate/Overshoot/Bounce may leave [0, 1] on purpose.

const clamp01 = (v) => Math.max(0, Math.min(1, v));

const easeSmooth = (t) => 0.5 - 0.5 * Math.cos(Math.PI * clamp01(t));

const cubicBezierEase = (mX1, mY1, mX2, mY2) => {
  const A = (a, b) => 1 - 3 * b + 3 * a;
  const B = (a, b) => 3 * b - 6 * a;
  const C = (a) => 3 * a;
  const calc = (t, a, b) => ((A(a, b) * t + B(a, b)) * t + C(a)) * t;
  const slope = (t, a, b) => 3 * A(a, b) * t * t + 2 * B(a, b) * t + C(a);
  const solveX = (x) => {
    let t = x;
    for (let i = 0; i < 8; i++) {
      const xEst = calc(t, mX1, mX2) - x;
      const d = slope(t, mX1, mX2);
      if (Math.abs(d) < 1e-6) break;
      t -= xEst / d;
    }
    return Math.max(0, Math.min(1, t));
  };
  return (x) => calc(solveX(clamp01(x)), mY1, mY2);
};

const androidBounce = (t) => {
  const b = (x) => x * x * 8;
  t *= 1.1226;
  if (t < 0.3535) return b(t);
  if (t < 0.7408) return b(t - 0.54719) + 0.7;
  if (t < 0.9644) return b(t - 0.8526) + 0.9;
  return b(t - 1.0435) + 0.95;
};

const fastOutSlowIn = cubicBezierEase(0.4, 0, 0.2, 1);

const MORPH_EASINGS = {
  smooth: (t) => easeSmooth(easeSmooth(t)),
  linear: (t) => clamp01(t),
  accelerate: (t) => {
    t = clamp01(t);
    return t * t;
  },
  decelerate: (t) => {
    t = clamp01(t);
    return 1 - (1 - t) * (1 - t);
  },
  accelerateDecelerate: (t) => easeSmooth(t),
  fastOutSlowIn: (t) => fastOutSlowIn(t),
  anticipate: (t) => {
    t = clamp01(t);
    const s = 2;
    return t * t * ((s + 1) * t - s);
  },
  overshoot: (t) => {
    t = clamp01(t) - 1;
    const s = 2;
    return t * t * ((s + 1) * t + s) + 1;
  },
  anticipateOvershoot: (t) => {
    t = clamp01(t);
    const s = 2 * 1.5;
    const a = (x, k) => x * x * ((k + 1) * x - k);
    const o = (x, k) => x * x * ((k + 1) * x + k);
    return t < 0.5 ? 0.5 * a(t * 2, s) : 0.5 * (o(t * 2 - 2, s) + 2);
  },
  bounce: (t) => androidBounce(clamp01(t)),
};

export { clamp01, easeSmooth, cubicBezierEase, androidBounce, fastOutSlowIn, MORPH_EASINGS };
