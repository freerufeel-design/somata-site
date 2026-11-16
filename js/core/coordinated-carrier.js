import './morph-controller.js'; // initialisation order: this module runs after it

const SomataCoordinatedCarrier = (() => {
  const PI2 = 2 * Math.PI;
  const clamp01 = (x) => Math.max(0, Math.min(1, Number(x) || 0));
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = (t) => t * t * (3 - 2 * t);
  const finite = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
  const SLIDES = Object.freeze(['minimal', 'sector', 'phase']);
  function params(layer = {}) {
    return {
      N: Math.max(3, Math.min(4096, finite(layer.N, 6))),
      K: Math.max(1, Math.min(2048, finite(layer.K ?? layer.spiralStep, 1))),
      order: Math.max(-20, Math.min(20, finite(layer.spiralEnabled === false ? 0 : layer.spiralOrder, 0))),
      radius: Math.max(0.001, finite(layer.radius, 150)),
      rotation: (finite(layer.rotation, 0) * Math.PI) / 180,
    };
  }
  function shapeAt(from, to, t, slide = 'minimal') {
    if (!SLIDES.includes(slide)) throw new RangeError(`Unknown slide: ${slide}`);
    const a = params(from),
      b = params(to),
      u = clamp01(t),
      e = ease(u);
    const N = lerp(a.N, b.N, e),
      K = lerp(a.K, b.K, e),
      order = lerp(a.order, b.order, e);
    const radius = lerp(a.radius, b.radius, e),
      rotation = lerp(a.rotation, b.rotation, e);
    const isEndpoint = u === 0 || u === 1;
    const point = (qInput) => {
      const q = clamp01(qInput);
      const offset =
        slide === 'sector'
          ? 0.15 * Math.PI * Math.sin(6 * Math.PI * q)
          : slide === 'phase'
            ? 0.1 * Math.PI * Math.sin(2 * Math.PI * q)
            : 0;
      const extra = offset * Math.sin(Math.PI * u) ** 2;
      const radial = (v) => radius * Math.exp(Math.max(-4, Math.min(4, -0.35 * order * v)));
      const polar = (v) => {
        const r = radial(v),
          a = rotation + PI2 * K * v;
        return { x: r * Math.cos(a), y: r * Math.sin(a) };
      };
      // Continuous star/polygon contour at order zero: connect its N
      // vertices by straight chords, not a circular-arc approximation.
      // Fractional N shifts vertex locations continuously without
      // inserting duplicate coils or multiple carrier branches.
      const progress = q * N,
        i = Math.floor(progress),
        f = progress - i;
      const pa = polar(i / N),
        pb = polar((i + 1) / N);
      const px = lerp(pa.x, pb.x, f),
        py = lerp(pa.y, pb.y, f);
      const spiral = polar(q),
        spiralMix = clamp01(Math.abs(order));
      const x = lerp(px, spiral.x, spiralMix),
        y = lerp(py, spiral.y, spiralMix);
      const c = Math.cos(extra),
        s = Math.sin(extra);
      return { x: c * x - s * y, y: s * x + c * y };
    };
    return Object.freeze({ N, K, order, radius, rotation, t: u, slide, isEndpoint, point });
  }
  function sample(from, to, t, { slide = 'minimal', segments = 256 } = {}) {
    const geometry = shapeAt(from, to, t, slide),
      n = Math.max(16, Math.min(4096, Math.round(Number(segments) || 256)));
    // Exactly one contour. The path is sampled at stable q, independent of N.
    const points = Array.from({ length: n + 1 }, (_, i) => geometry.point(i / n));
    return { ...geometry, points, contourCount: 1, clonedCoils: 0 };
  }
  function project(points, { scale = 1, angle = 0, centerX = 0, centerY = 0 } = {}) {
    const s = finite(scale, 1),
      a = finite(angle, 0),
      c = Math.cos(a),
      d = Math.sin(a),
      cx = finite(centerX, 0),
      cy = finite(centerY, 0);
    return points.map((p) => ({ x: cx + s * (p.x * c - p.y * d), y: cy + s * (p.x * d + p.y * c) }));
  }
  function corridorCopy(
    points,
    { index = 0, focus = 0, delta = 0, scale = 1, centerX = 0, centerY = 0 } = {},
  ) {
    const angle = (finite(index, 0) - finite(focus, 0)) * finite(delta, 0);
    return { angle, scale, points: project(points, { scale, angle, centerX, centerY }) };
  }
  return Object.freeze({ slides: SLIDES, params, shapeAt, sample, project, corridorCopy });
})();
window.SomataCoordinatedCarrier = SomataCoordinatedCarrier;
