import '../effects/motion.js'; // initialisation order: this module runs after it

const SomataCorridorDepthCurve = Object.freeze({
  effectivePercent(percent, multiplier = 1) {
    const a = Number(percent),
      m = Number(multiplier);
    return (
      Math.max(-100, Math.min(100, Number.isFinite(a) ? a : 0)) *
      Math.max(0, Math.min(10, Number.isFinite(m) ? m : 1))
    );
  },
  position(position, count, percent, multiplier = 1) {
    if (!Number.isFinite(position) || !Number.isFinite(count) || count <= 1) return position;
    const base = Math.max(-100, Math.min(100, Number(percent) || 0));
    const m = Math.max(0, Math.min(10, Number.isFinite(Number(multiplier)) ? Number(multiplier) : 1));
    if (!base || !m || position <= 0 || position >= count - 1) return position;

    const k = (1.8 * base) / 100,
      warp = (t) => t + k * (t - 0.5) * t * (1 - t);
    let t = position / (count - 1),
      n = Math.floor(m);
    for (let i = 0; i < n; i++) t = warp(t);
    const fraction = m - n;
    if (fraction > 1e-9) t += (warp(t) - t) * fraction;
    return (count - 1) * t;
  },
  scale(position, count, logMinScale, logRatio, percent, multiplier = 1) {
    const p = this.position(position, count, percent, multiplier);
    return Math.exp(Math.max(-30, Math.min(30, logMinScale + logRatio * p)));
  },
});
window.SomataCorridorDepthCurve = SomataCorridorDepthCurve;

export { SomataCorridorDepthCurve };
