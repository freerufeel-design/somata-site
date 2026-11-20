import './unified-runtime.js'; // initialisation order: this module runs after it

window.SomataManualInterpolation = (() => {
  function interpolateEditedProfileNodes(a, b, t, { copy, mix }) {
    if (t <= 0) return copy(a);
    if (t >= 1) return copy(b);
    const count = Math.max(a.length, b.length);
    if (count < 2) return copy(a);
    const at = (nodes, s) => {
      const q = s * (nodes.length - 1),
        i = Math.min(nodes.length - 2, Math.floor(q)),
        f = q - i;
      const p = nodes[i],
        r = nodes[i + 1];
      return { x: mix(Number(p.x) || 0, Number(r.x) || 0, f), y: mix(Number(p.y) || 0, Number(r.y) || 0, f) };
    };
    return Array.from({ length: count }, (_, i) => {
      const aPoint = at(a, i / (count - 1)),
        bPoint = at(b, i / (count - 1));
      return { x: mix(aPoint.x, bPoint.x, t), y: mix(aPoint.y, bPoint.y, t) };
    });
  }
  function easing(t, cfg, { clamp }) {
    const eased = window.__somataMorphSpeedEase?.(clamp(t, 0, 1, 0));
    if (Number.isFinite(eased)) return eased;
    return clamp(t, 0, 1, 0);
  }
  function sample(from, to, t, cfg, { observedKeys, realKeys, mix, copy, clamp }) {
    const easing = (x, c) => window.SomataManualInterpolation.easing(x, c, { clamp });
    const interpolateEditedProfileNodes = (a, b, x) =>
      window.SomataManualInterpolation.interpolateEditedProfileNodes(a, b, x, { copy, mix });
    const u = easing(clamp(t, 0, 1, 0), cfg),
      out = {};
    for (const key of observedKeys) {
      const a = from?.[key],
        b = to?.[key];
      if (
        realKeys.includes(key) &&
        !['N', 'K'].includes(key) &&
        typeof a === 'number' &&
        typeof b === 'number' &&
        Number.isFinite(a) &&
        Number.isFinite(b)
      ) {
        out[key] = mix(a, b, u);
      } else if (
        key === 'profileNodes' &&
        Array.isArray(a) &&
        Array.isArray(b) &&
        a.length >= 2 &&
        b.length >= 2 &&
        [...a, ...b].every((p) => p && Number.isFinite(+p.x) && Number.isFinite(+p.y))
      ) {
        out[key] =
          a.length === b.length
            ? a.map((p, i) => ({ ...p, x: mix(+p.x, +b[i].x, u), y: mix(+p.y, +b[i].y, u) }))
            : interpolateEditedProfileNodes(a, b, u);
      } else if (key === 'roundingMode') out[key] = copy(b);
      else out[key] = copy(t >= 1 ? b : a);
    }
    return out;
  }
  return Object.freeze({ interpolateEditedProfileNodes, easing, sample });
})();
