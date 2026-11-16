import './spiral-zero-presets/beautiful.js'; // initialisation order: this module runs after it

(function (root) {
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const difference = (a, b) => Math.abs(a - b) / Math.max(1, b);
  const octaveTo = (candidate, ref) => {
    if (!(candidate > 0 && ref > 0)) return candidate;
    const options = [candidate, candidate * 2, candidate / 2].filter((x) => x >= 30 && x <= 300);
    return options.reduce((best, x) => (difference(x, ref) < difference(best, ref) ? x : best), candidate);
  };
  function create() {
    return {
      mode: 'ACQUIRE',
      bpm: 0,
      anchorTime: 0,
      lastFreshAt: 0,
      lastUpdateAt: 0,
      acquire: [],
      near: [],
      pending: [],
      pendingBpm: 0,
      confidence: 0,
    };
  }
  function reset(previous) {
    return create();
  }
  function step(s, observation) {
    if (!s || typeof s !== 'object') s = create();
    const o = observation || {},
      now = Number(o.now);
    if (!Number.isFinite(now)) return s;
    const fresh =
      o.fresh === true &&
      Number.isFinite(o.bpm) &&
      o.bpm >= 30 &&
      o.bpm <= 300 &&
      Number(o.confidence) >= 0.3;
    if (!fresh) {
      if (s.bpm > 0 && s.lastFreshAt > 0 && now - s.lastFreshAt >= 2000) {
        if (s.mode !== 'HOLD') {
          s.pending = [];
          s.pendingBpm = 0;
          s.near = [];
        }
        s.mode = 'HOLD';
        s.confidence = 0;
      }
      if (s.bpm === 0) {
        s.mode = 'ACQUIRE';
        s.confidence = 0;
      }
      return s;
    }
    if (s.lastFreshAt > 0 && now <= s.lastFreshAt) return s;
    const confidence = clamp(Number(o.confidence) || 0, 0, 1);
    const bpm = Number(o.bpm);
    const bands = clamp(Math.floor(Number(o.bands) || 1), 1, 6);
    const bassSupport = o.bassSupport === true;
    const pulse = Number.isFinite(o.peakTime) ? Number(o.peakTime) : now;
    const previousAt = s.lastFreshAt;
    s.lastFreshAt = now;
    s.confidence = confidence;
    if (!(s.bpm > 0)) {
      const input = { time: now, bpm, confidence, bands };
      s.acquire.push(input);
      s.acquire = s.acquire.filter((x) => now - x.time <= 11000).slice(-80);
      const center = s.acquire.map((x) => x.bpm).sort((a, b) => a - b)[Math.floor(s.acquire.length / 2)];
      const agree = s.acquire.filter((x) => difference(octaveTo(x.bpm, center), center) <= 0.025);
      const span = agree.length ? agree[agree.length - 1].time - agree[0].time : 0;
      const avg = agree.reduce((sum, x) => sum + x.confidence, 0) / Math.max(1, agree.length);
      if (agree.length >= 5 && span >= 2200 && avg >= 0.42 && agree.length >= s.acquire.length * 0.7) {
        const values = agree.map((x) => octaveTo(x.bpm, center)).sort((a, b) => a - b);
        s.bpm = values[Math.floor(values.length / 2)];
        s.anchorTime = pulse;
        s.mode = 'LOCKED';
        s.acquire = [];
        s.near = [];
        s.pending = [];
        s.pendingBpm = 0;
        s.lastUpdateAt = now;
      }
      return s;
    }
    const candidate = octaveTo(bpm, s.bpm),
      rel = difference(candidate, s.bpm);
    const wasHolding = s.mode === 'HOLD';
    if (rel <= 0.025) {
      s.pending = [];
      s.pendingBpm = 0;
      s.mode = 'LOCKED';
      s.near.push({ time: now, bpm: candidate, confidence });
      s.near = s.near.filter((x) => now - x.time <= 7000).slice(-100);
      const nearSpan = s.near.length > 1 ? now - s.near[0].time : 0;

      const vals = s.near.map((x) => x.bpm).sort((a, b) => a - b);
      const nearMedian = vals[Math.floor(vals.length / 2)] || candidate;
      if (
        s.near.length >= 5 &&
        nearSpan >= 2800 &&
        confidence >= 0.57 &&
        Math.abs(nearMedian - s.bpm) > 0.8
      ) {
        const dt = clamp((now - (s.lastUpdateAt || now)) / 1000, 0, 0.8);
        const delta = clamp(nearMedian - s.bpm, -0.25 * dt, 0.25 * dt);
        s.bpm += delta;
        s.lastUpdateAt = now;
      }

      if (confidence >= 0.68 && s.anchorTime > 0 && Number.isFinite(pulse)) {
        const period = 60000 / s.bpm;
        const error = ((((pulse - s.anchorTime + period / 2) % period) + period) % period) - period / 2;
        if (Math.abs(error) <= period * 0.14) {
          s.anchorTime += clamp(error * 0.12, -6, 6);
        }
      }
      return s;
    }
    s.near = [];
    s.mode = 'CHANGE_PENDING';
    const last = s.pending[s.pending.length - 1];
    if (last && difference(last.bpm, candidate) > 0.035) {
      s.pending = [];
      s.pendingBpm = 0;
    }
    s.pending.push({ time: now, bpm: candidate, confidence, bands, bassSupport });
    s.pending = s.pending.filter((x) => now - x.time <= 18000).slice(-120);
    const span = s.pending.length > 1 ? now - s.pending[0].time : 0;
    const avgConf = s.pending.reduce((sum, x) => sum + x.confidence, 0) / s.pending.length;
    const multi =
      s.pending.filter((x) => x.bands >= 2 && x.bassSupport).length >= Math.ceil(s.pending.length * 0.6);
    const crossBand = s.pending.filter((x) => x.bands >= 2).length >= Math.ceil(s.pending.length * 0.6);

    const beatMs = 60000 / s.bpm;
    const required = multi ? Math.max(6500, 16 * beatMs) : Math.max(12000, 32 * beatMs);
    const countNeeded = multi ? 12 : 22;
    if (
      s.pending.length >= countNeeded &&
      span >= required &&
      avgConf >= (multi ? 0.72 : 0.9) &&
      (multi || crossBand)
    ) {
      const values = s.pending.map((x) => x.bpm).sort((a, b) => a - b);
      s.bpm = values[Math.floor(values.length / 2)];

      s.anchorTime = pulse;
      s.lastUpdateAt = now;
      s.pending = [];
      s.pendingBpm = 0;
      s.near = [];
      s.mode = 'LOCKED';
    } else {
      s.pendingBpm = candidate;

      if (wasHolding && previousAt > 0 && now - previousAt > 2000) s.mode = 'HOLD';
    }
    return s;
  }
  const api = Object.freeze({ create, reset, step, octaveTo });
  root.SomataTempoLock = api;
})(typeof window !== 'undefined' ? window : globalThis);
