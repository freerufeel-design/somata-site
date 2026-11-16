import './profile-pass.js'; // initialisation order: this module runs after it

/* Apply the birth envelope after the attachment route has resolved identities. */
const SomataLampStability = (() => {
  const tracks = new Map(),
    cell = 1;
  // A lamp's attachment point can hop along the contour from one frame to the next (a corner
  // key or slot changes owner) while the line itself barely moves. Drawn as is, that is a
  // teleport. A move far above the lamp's own recent speed is treated as a hop: the lamp
  // glides there from where it was last drawn. GPU Arc lamps are placed by attachment +
  // offset, so the offset carries the same correction.
  const HOP_MIN_PX = 4,
    HOP_RATIO = 5,
    HOP_GLIDE_MS = 240;
  function glideHops(track, items, now, animate) {
    const prev = track.pos || new Map(),
      pos = new Map(),
      seen = new Map();
    for (const v of items) seen.set(v.lampTraceId, (seen.get(v.lampTraceId) || 0) + 1);
    for (const v of items) {
      const id = v.lampTraceId;
      if (seen.get(id) !== 1 || !Number.isFinite(v.px) || !Number.isFinite(v.py)) continue;
      const p = prev.get(id),
        s = { x: v.px, y: v.py, at: now, speed: 0, glideAt: 0, gx: 0, gy: 0 };
      if (p) {
        Object.assign(s, { speed: p.speed, glideAt: p.glideAt, gx: p.gx, gy: p.gy });
        if (animate && now > p.at) {
          const step = Math.hypot(v.px - p.x, v.py - p.y);
          if (!s.glideAt && step > Math.max(HOP_MIN_PX, HOP_RATIO * p.speed))
            Object.assign(s, { glideAt: now, gx: p.x, gy: p.y });
          else if (!s.glideAt) s.speed = p.speed * 0.7 + step * 0.3;
        } else if (now === p.at) s.speed = p.speed;
      }
      if (s.glideAt) {
        const g = Math.max(0, Math.min(1, (now - s.glideAt) / HOP_GLIDE_MS)),
          e = g * g * (3 - 2 * g),
          x = s.gx + (v.px - s.gx) * e,
          y = s.gy + (v.py - s.gy) * e;
        if (Number.isFinite(v.gpuLampOffsetX)) v.gpuLampOffsetX += x - v.px;
        if (Number.isFinite(v.gpuLampOffsetY)) v.gpuLampOffsetY += y - v.py;
        v.px = x;
        v.py = y;
        s.x = x;
        s.y = y;
        if (g >= 1) s.glideAt = 0;
      }
      pos.set(id, s);
    }
    track.pos = pos;
  }
  function apply(scope, items, { now, duration, animate, arc = false }) {
    let track = tracks.get(scope);
    if (!track || now < track.now || now - track.now > Math.max(2000, duration * 2)) {
      track = { now, levels: new Map(), pending: false };
      tracks.set(scope, track);
      for (const [k, v] of tracks) if (now - v.now > 120000) tracks.delete(k);
    }
    const dt = now - track.now,
      limit = Math.min(50, Math.max(0, dt)) / Math.max(1, duration),
      active = animate || track.pending;
    const next = new Map(),
      bins = new Map(),
      levels = new Map(),
      keys = new Map();
    let rawPeak = 0,
      rawOverlap = 0,
      maxMultiplicity = 0,
      peak = 0,
      pending = false;
    const spatial = (v) => Number.isFinite(v.px) && Number.isFinite(v.py);
    for (const v of items) {
      const key = arc
        ? `${v.pathIndex}:${Math.round(v.lampAttachFraction * 1e7)}:${Math.round(v.gpuLampOffsetX * 10)}:${Math.round(v.gpuLampOffsetY * 10)}`
        : null;
      keys.set(v, key);
      const id = v.lampTraceId,
        target = v.intensityAlpha,
        previous = track.levels.get(id);
      const level = active ? Math.min(target, previous === undefined ? 0 : previous + limit) : target;
      if (level + 1e-5 < target) pending = true;
      levels.set(v, level);
      next.set(id, Math.max(level, next.get(id) || 0));
      const k = arc ? key : spatial(v) ? `${Math.floor(v.px / cell)}:${Math.floor(v.py / cell)}` : null;
      if (k !== null) {
        let list = bins.get(k);
        if (!list) bins.set(k, (list = []));
        list.push(v);
      }
    }
    // Measure unsmoothed overlaps separately. Divide the actual light only
    // after the birth envelope, so a dark newborn cannot dim a lit lamp.
    const outputs = new Map();
    for (const v of items) {
      const a = v.intensityAlpha;
      rawPeak = Math.max(rawPeak, a);
      const level = levels.get(v);
      let sum = a,
        softSum = level,
        softMax = level,
        count = 1;
      const visit = (w, weight) => {
        if (v === w || weight <= 0) return;
        const b = w.intensityAlpha * weight;
        sum += b;
        const soft = levels.get(w) * weight;
        softSum += soft;
        softMax = Math.max(softMax, soft);
        if (weight > 0.75 && b > 0.002) count++;
      };
      if (arc) {
        for (const w of bins.get(keys.get(v)) || []) visit(w, 1);
      } else if (spatial(v)) {
        const x = Math.floor(v.px / cell),
          y = Math.floor(v.py / cell);
        for (let dx = -1; dx <= 1; dx++)
          for (let dy = -1; dy <= 1; dy++)
            for (const w of bins.get(`${x + dx}:${y + dy}`) || []) {
              const d = Math.min(1, Math.hypot(w.px - v.px, w.py - v.py) / cell);
              visit(w, 1 - d * d * (3 - 2 * d));
            }
      }
      outputs.set(v, softSum > 0 ? (level * softMax) / softSum : 0);
      rawOverlap = Math.max(rawOverlap, sum);
      maxMultiplicity = Math.max(maxMultiplicity, count);
    }
    for (const v of items) {
      v.intensityAlpha = outputs.get(v);
      peak = Math.max(peak, v.intensityAlpha);
    }
    glideHops(track, items, now, animate);
    track.levels = next;
    track.now = now;
    track.pending = pending;
    return {
      pending,
      count: items.length,
      rawPeak,
      rawOverlap,
      maxMultiplicity,
      peak,
      positionSource: arc ? 'gpu-arc-attachment' : 'cpu-visual-centres',
    };
  }
  return { apply };
})();

export { SomataLampStability };
