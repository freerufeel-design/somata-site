import '../render/skeleton-debug-overlay.js'; // initialisation order: this module runs after it
import { SomataGeometryPolicy } from '../render/geometry-policy.js';
import { state } from '../core/state.js';
import { mainCtx } from '../core/render-runtime.js';
import { getMotionTunnelLagRadians } from '../effects/motion.js';
import { SomataFrameContourService } from '../geometry/frame-contour.js';

/* Local, opt-in diagnostics for Somata 15. No GPU readback, network or project writes. */
(() => {
  let run = null,
    timer = null;
  const num = (x, f = null) => (typeof x === 'number' && Number.isFinite(x) ? x : f);
  const round = (x) => Math.round(x * 1000) / 1000;
  const cap = (x, d, min, max) => Math.max(min, Math.min(max, num(x, d)));
  const push = (list, v, max) => {
    if (list.length < max) list.push(v);
  };
  const unwrap = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
  const roundingFrames = new Map();
  const roundingWarnings = new Map();
  const roundingRails = new Map();
  const roundingAxes = Array.from({ length: 16 }, (_, i) => {
    const angle = i * Math.PI / 8;
    return [Math.cos(angle), Math.sin(angle)];
  });
  function logRounding(layer, kind, details) {
    const now = performance.now();
    const id = layer.id ?? layer.name ?? '(layer)';
    const key = `${id}:${kind}:${details.reason || ''}`;
    if (now - (roundingWarnings.get(key) ?? -Infinity) < 1200) return;
    if (roundingWarnings.size >= 256) roundingWarnings.delete(roundingWarnings.keys().next().value);
    roundingWarnings.set(key, now);
    console.warn('[Somata Spline+] ' + kind, {
      layer: id,
      name: layer.name,
      phaseSerial: window.__somataBlueMorphPhaseClock?.()?.phaseSerial ?? null,
      rounding: Number(layer.rounding) || 0,
      policy: layer.roundingCornerType || 'classic',
      N: layer.N,
      K: layer.K,
      order: layer.spiralOrder,
      ...details,
    });
  }
  function noteRoundingFallback(layer, progress, mode, reason) {
    logRounding(layer, 'fallback', { reason, progress, mode });
  }
  function roundingShape(paths) {
    const support = roundingAxes.map(() => -Infinity);
    for (const path of paths) {
      if ((path.alpha ?? path._alpha ?? 1) < 0.05) continue;
      for (const { x, y } of path.points || []) {
        if (!Number.isFinite(x + y)) continue;
        for (let i = 0; i < support.length; i++) {
          const [dx, dy] = roundingAxes[i];
          support[i] = Math.max(support[i], dx * x + dy * y);
        }
      }
    }
    if (!Number.isFinite(support[0])) return null;
    // Measure the shape in layer coordinates, independently of camera motion
    // and the number or starting index of sampled contour points.
    const cx = (support[0] - support[8]) * 0.5;
    const cy = (support[4] - support[12]) * 0.5;
    return support.map((v, i) => v - roundingAxes[i][0] * cx - roundingAxes[i][1] * cy);
  }
  function noteRoundingShape(layer, progress, paths) {
    if (layer.id == null) return;
    if (roundingRails.size >= 128 && !roundingRails.has(layer.id))
      roundingRails.delete(roundingRails.keys().next().value);
    roundingRails.set(layer.id, { progress, paths });
  }
  function observeRounding(f) {
    const layer = f?.layer;
    if (!layer || !f.morphFrameActive || state.fourierMode || !(Number(layer.rounding) > 0)) return;
    const contour = SomataFrameContourService.current(f);
    const id = layer.id ?? f.layerIndex;
    const rail = roundingRails.get(id);
    roundingRails.delete(id);
    const progress = num(f.geometryProvider?.progress, num(f.blueMorphProvider?.geometryT));
    const paths = contour?.paths ?? (rail && Math.abs(rail.progress - progress) < 1e-7 ? rail.paths : null);
    if (!paths?.length) return;
    const previous = roundingFrames.get(id);
    if (previous?.frame === f.frameId) return;
    const shape = roundingShape(paths);
    if (!shape) return;
    const now = performance.now();
    const dt = previous ? now - previous.now : 0;
    const route = f.geometryPlan?.kind;
    const clock = window.__somataBlueMorphPhaseClock?.();
    const validStep = previous && dt > 0 && dt <= 80;
    const delta = validStep ? shape.map((v, i) => v - previous.shape[i]) : null;
    if (delta && previous.delta) {
      const ratio = Math.min(2, dt / previous.dt);
      const transform = mainCtx.getTransform();
      const scale = (Math.hypot(transform.a, transform.b) * Math.abs(num(f.combinedScale, 1))) /
        Math.max(1, num(f.frame?.dpr, window.devicePixelRatio || 1));
      const motion = Math.max(...delta.map(Math.abs)) * scale;
      const expected = Math.max(...previous.delta.map(Math.abs)) * ratio * scale;
      const impulse = Math.max(...delta.map((v, i) => Math.abs(v - previous.delta[i] * ratio))) * scale;
      if (impulse >= 1.75 && motion >= 1.75 && (motion > expected * 2.5 || impulse > motion * 1.25))
        logRounding(layer, 'contour-jump', {
          frame: f.frameId, dt: round(dt), progress, previousProgress: previous.progress,
          mode: f.geometryProvider?.modeOverride ?? f.blueMorphProvider?.mode ?? state.morph?.mode,
          route, previousRoute: previous.route, previousPhaseSerial: previous.phaseSerial,
          source: contour?.paths ? 'line-command-contour' : 'spline-plus-cubics',
          motionPx: round(motion), impulsePx: round(impulse),
        });
    }
    if (roundingFrames.size >= 128 && !roundingFrames.has(id))
      roundingFrames.delete(roundingFrames.keys().next().value);
    roundingFrames.set(id, { frame: f.frameId, now, dt, shape, delta, route, progress, phaseSerial: clock?.phaseSerial });
  }
  function summarize(paths) {
    if (!Array.isArray(paths)) return null;
    let segments = 0,
      closed = 0,
      points = 0;
    const shapes = [];
    for (let i = 0; i < paths.length; i++) {
      const p = paths[i],
        a = p?.points || [],
        n = a.length;
      points += n;
      closed += p?.closed === true ? 1 : 0;
      const edges = Math.max(0, n - 1) + (p?.closed === true && n > 2 ? 1 : 0);
      segments += edges;
      if (i >= 192 || n < 2) continue;
      const probes = [0, 0.25, 0.5, 0.75, 1]
        .map((q) => a[Math.round(q * (n - 1))])
        .map((v) => [num(v?.x), num(v?.y)]);
      shapes.push({
        id: p.branchId ?? p.orbitId ?? p.pathId ?? p.id ?? null,
        i,
        n,
        edges,
        closed: p.closed === true,
        probes,
      });
    }
    return { paths: paths.length, segments, points, closed, shapes, sampledPaths: shapes.length };
  }
  function compare(a, b, scale, limit, emit, kind) {
    if (!a || !b) return;
    if (a.paths !== b.paths || a.segments !== b.segments || a.closed !== b.closed)
      emit(`${kind}-topology`, {
        before: [a.paths, a.segments, a.closed],
        after: [b.paths, b.segments, b.closed],
      });
    const previous = new Map(),
      unique = new Set();
    const key = (p) => (p.id == null ? `slot:${p.i}` : `id:${p.id}`);
    for (const p of a.shapes) {
      const k = key(p);
      if (previous.has(k)) unique.add(k);
      previous.set(k, p);
    }
    const currentKeys = new Set();
    for (const q of b.shapes) {
      const k = key(q);
      if (currentKeys.has(k)) unique.add(k);
      currentKeys.add(k);
    }
    let worst = null;
    for (const q of b.shapes) {
      const k = key(q),
        p = previous.get(k);
      if (!p || unique.has(k) || p.closed !== q.closed || (q.id == null && a.paths !== b.paths)) continue;
      let jump = 0;
      for (let i = 0; i < q.probes.length; i++) {
        const [x, y] = p.probes[i],
          [X, Y] = q.probes[i];
        if ([x, y, X, Y].every(Number.isFinite)) jump = Math.max(jump, Math.hypot(X - x, Y - y) * scale);
      }
      if (jump >= limit && (!worst || jump > worst.px))
        worst = {
          path: k,
          px: round(jump),
          pointsBefore: p.n,
          pointsAfter: q.n,
          matching: q.id == null ? 'array-slot, approximate' : 'geometry-id, sampled points',
        };
    }
    if (worst) emit(`${kind}-jump`, worst);
  }
  function stop() {
    if (run?.running) {
      run.running = false;
      run.ended = performance.now();
    }
    clearTimeout(timer);
    timer = null;
    return summary();
  }
  function start(opts = {}) {
    stop();
    const ms = cap(opts.seconds, 30, 1, 3600) * 1000;
    run = {
      running: true,
      started: performance.now(),
      ms,
      thresholdPx: cap(opts.thresholdPx, 20, 1, 1000),
      layer: opts.layer ?? null,
      thresholdLight: cap(opts.thresholdLight, 0.2, 0.01, 5),
      maxEvents: cap(opts.maxEvents, 1200, 100, 200000),
      maxTimeline: cap(opts.maxTimeline, 2500, 100, 200000),
      lampSamples: new WeakMap(),
      counts: {},
      events: [],
      markers: [],
      timeline: [],
      previous: new Map(),
      frames: 0,
      errors: [],
      ended: null,
    };
    timer = setTimeout(stop, ms);
    return summary();
  }
  function summary() {
    return run
      ? {
          running: run.running,
          elapsedMs: round((run.ended ?? performance.now()) - run.started),
          samples: run.frames,
          thresholdPx: run.thresholdPx,
          thresholdLight: run.thresholdLight,
          counts: { ...run.counts },
          savedEvents: run.events.length,
          errors: run.errors.length,
        }
      : null;
  }
  function mark(label = 'Виден скачок') {
    if (run?.running)
      push(
        run.markers,
        { ms: round(performance.now() - run.started), label: String(label).slice(0, 200) },
        100,
      );
  }
  function observeLamps(f, index, stats, alpha, instances) {
    if (!run?.running || !f?.layer || !stats) return;
    if (run.layer !== null && run.layer !== f.layerIndex && run.layer !== f.layer.id) return;
    let rec = run.lampSamples.get(f);
    if (!rec || rec.frame !== f.frameId) {
      rec = { frame: f.frameId, sets: new Map() };
      run.lampSamples.set(f, rec);
    }
    let copyAlpha = 0;
    for (let i = 0; i < (instances?.copies?.length || 0); i++)
      copyAlpha = Math.max(copyAlpha, num(instances.alphas?.[i], 1));
    const weight = cap(alpha, 1, 0, 1) * copyAlpha;
    rec.sets.set(index, {
      ...stats,
      rawPeak: stats.rawPeak * weight,
      rawOverlap: stats.rawOverlap * weight,
      peak: stats.peak * weight,
    });
  }
  function sample(f) {
    if (!run?.running || !f?.layer) return;
    const now = performance.now();
    if (now - run.started > run.ms) {
      stop();
      return;
    }
    const l = f.layer,
      id = l.id ?? f.layerIndex;
    if (run.layer !== null && run.layer !== f.layerIndex && run.layer !== id) return;
    try {
      const prev = run.previous.get(id);
      if (prev?.frame === f.frameId) return;
      const clock = window.__somataBlueMorphPhaseClock?.();
      const ctx = {
        ms: round(now - run.started),
        layerIndex: f.layerIndex,
        id,
        frame: f.frameId,
        dt: prev ? round(now - prev.now) : null,
        phaseSerial: clock?.phaseSerial ?? null,
        phase:
          clock?.active && clock.durationMs > 0
            ? round((num(f.now, now) - clock.phaseStart) / clock.durationMs)
            : null,
        geometryPhase: num(
          f.geometryProvider?.progress,
          num(f.blueMorphProvider?.geometryT, num(f.geometryPlan?.progress)),
        ),
        N: num(l.N),
        K: num(l.K),
        order: num(l.spiralOrder),
        betaRad: num(l.__somataCoordinatedPeriodDelta),
        construction: l.spiralConstructionMode,
        transition: l.spiralZeroTransitionMode,
        route: f.geometryPlan?.kind,
        focus: l.__somataFocusFrame?.position ?? null,
        strict: SomataGeometryPolicy.isStrict(f) === true,
        baseCommitted: f._baseStrokeCommitted === true,
      };
      const contour = SomataFrameContourService.current(f),
        web = f.effectsPlan?.web?.frameData;
      const fallback = f.geometryProvider?.framePaths ?? f.roundedPaths ?? f.auxiliaryPaths;
      const source = contour?.paths
        ? 'line-command-contour'
        : web?.visualPaths
          ? 'web-visual-rail'
          : fallback
            ? 'cpu-geometry-proxy'
            : 'unavailable';
      const lines = summarize(contour?.paths ?? web?.visualPaths ?? fallback);
      const skeleton = summarize(f.__somataSkeletonFrame ?? f.geometryProvider?.skeletonFrame);
      const tr = mainCtx.getTransform(),
        dpr = Math.max(1, num(f.frame?.dpr, window.devicePixelRatio || 1));
      const scale = (Math.hypot(tr.a, tr.b) * Math.abs(num(f.combinedScale, 1))) / dpr;
      const copies = new Map(),
        corridor = state.tunnel?.active === true;
      const list = f.visibleInstances?.copies || [],
        alphas = f.visibleInstances?.alphas;
      let outer = 1;
      for (let i = 0; i < list.length; i++) {
        const c = list[i],
          s = num(c?.scale);
        if (!c || s == null) continue;
        const k = c.copyId == null ? `slot:${i}` : `copy:${c.copyId}`;
        const a = corridor ? getMotionTunnelLagRadians(c, l) : 0;
        copies.set(k, { s, a, pos: num(c.position), alpha: num(alphas?.[i], 1) });
        outer = Math.max(outer, s);
      }
      Object.assign(ctx, {
        source,
        paths: lines?.paths ?? null,
        segments: lines?.segments ?? null,
        closed: lines?.closed ?? null,
        skeletonPaths: skeleton?.paths ?? null,
        skeletonSegments: skeleton?.segments ?? null,
        copies: copies.size,
        webHandled: f._webPassHandled === true,
        webCorners: web?.corners?.length ?? null,
        webNative: web?.gpuMorphWebNative === true,
        glint: f.effectsPlan?.sweep?.instances?.some((p) => p.effectType === 'glint') === true,
      });
      const lampRec = run.lampSamples.get(f),
        lampSets = lampRec?.frame === f.frameId ? [...lampRec.sets.values()] : [];
      const lamp = lampSets.length
        ? {
            count: lampSets.reduce((n, v) => n + v.count, 0),
            rawPeak: round(Math.max(...lampSets.map((v) => v.rawPeak))),
            rawOverlap: round(Math.max(...lampSets.map((v) => v.rawOverlap))),
            peak: round(Math.max(...lampSets.map((v) => v.peak))),
            maxMultiplicity: Math.max(...lampSets.map((v) => v.maxMultiplicity)),
            positionSources: [...new Set(lampSets.map((v) => v.positionSource))],
          }
        : null;
      const glint = f.effectsPlan?.sweep?.instances?.find((p) => p.effectType === 'glint'),
        g = glint?.frameData?.glintVisual;
      Object.assign(ctx, {
        lamp,
        glintGain: g ? round(num(g.brightness, 0) * num(g.opacity, 0)) : null,
        glintHaloGain: g ? round(num(g.brightness, 0) * num(g.opacity, 0) * num(g.strength, 0)) : null,
        glintRoute: glint
          ? glint.frameData?.bezierGlintGPU
            ? 'bezier'
            : glint.frameData?.canonicalGPU
              ? 'canonical'
              : 'other'
          : null,
      });
      let event = false;
      const emit = (kind, data) => {
        event = true;
        run.counts[kind] = (run.counts[kind] || 0) + 1;
        push(run.events, { ...ctx, kind, ...data }, run.maxEvents);
      };
      if (prev) {
        if (ctx.dt >= 85) emit('frame-gap', { dt: ctx.dt });
        const before = prev.ctx.lamp;
        if (lamp) {
          if (lamp.maxMultiplicity >= 2 && lamp.maxMultiplicity > (before?.maxMultiplicity ?? 1))
            emit('lamp-overlap', { before: before?.maxMultiplicity ?? 0, after: lamp.maxMultiplicity });
          for (const [k, kind] of [
            ['rawOverlap', 'lamp-raw-brightness-rise'],
            ['peak', 'lamp-brightness-rise'],
          ]) {
            const v = before?.[k] ?? 0,
              delta = lamp[k] - v;
            if (delta >= run.thresholdLight) emit(kind, { before: v, after: lamp[k], delta: round(delta) });
          }
        }
        for (const k of ['glintGain', 'glintHaloGain'])
          if (ctx[k] !== null && ctx[k] - (prev.ctx[k] ?? 0) >= run.thresholdLight)
            emit('glint-gain-rise', {
              channel: k,
              before: prev.ctx[k] ?? 0,
              after: ctx[k],
              delta: round(ctx[k] - (prev.ctx[k] ?? 0)),
            });

        if (source !== prev.ctx.source || ctx.route !== prev.ctx.route)
          emit('geometry-route', { before: prev.ctx.source, after: source, routeBefore: prev.ctx.route });
        else {
          compare(prev.lines, lines, scale * outer, run.thresholdPx, emit, 'line');
          compare(prev.skeleton, skeleton, scale * outer, run.thresholdPx, emit, 'skeleton');
        }
        if (corridor && prev.corridor) {
          const added = [...copies.keys()].filter((k) => !prev.copies.has(k)),
            removed = [...prev.copies.keys()].filter((k) => !copies.has(k));
          if (added.length || removed.length) emit('copy-population', { added, removed });
          let worst = null;
          const radius = Math.max(1, num(f.layerExtent, 100)) * scale;
          for (const [k, q] of copies) {
            const p = prev.copies.get(k);
            if (!p || Math.min(p.alpha, q.alpha) < 0.02) continue;
            const da = unwrap(q.a, p.a),
              px = radius * Math.hypot(q.s * Math.cos(da) - p.s, q.s * Math.sin(da));
            if (px >= run.thresholdPx && (!worst || px > worst.px))
              worst = {
                copy: k,
                px: round(px),
                rotationDeg: round((da * 180) / Math.PI),
                scaleBefore: p.s,
                scaleAfter: q.s,
                positionBefore: p.pos,
                positionAfter: q.pos,
              };
          }
          if (worst) emit('copy-jump', worst);
        }
      }
      run.frames++;
      if (!prev || event || prev.ctx.phaseSerial !== ctx.phaseSerial || now - prev.logged >= 150) {
        push(run.timeline, ctx, run.maxTimeline);
        ctx.logged = now;
      }
      run.previous.set(id, {
        frame: f.frameId,
        now,
        ctx,
        lines,
        skeleton,
        copies,
        corridor,
        logged: ctx.logged ?? prev?.logged ?? now,
      });
    } catch (err) {
      push(run.errors, String(err?.message || err), 12);
    }
  }
  function report() {
    if (!run) return null;
    return {
      schema: 'somata-jump-trace/2',
      summary: summary(),
      layerFilter: run.layer,
      events: run.events.slice(),
      markers: run.markers.slice(),
      timeline: run.timeline.slice(),
      errors: run.errors.slice(),
      notes:
        'CPU observations; no GPU readback. Motion estimates are candidates, not confirmed visual defects. copy-population includes normal culling. Only the strongest motion candidate per layer/frame is logged. Lamp readings are command intensity and approximate local overlap, not RGB luminance. Glint readings are gain parameters, not sampled pixels.',
    };
  }
  function download() {
    if (!run) return null;
    stop();
    const url = URL.createObjectURL(
        new Blob([JSON.stringify(report(), null, 2)], { type: 'application/json' }),
      ),
      a = document.createElement('a');
    a.href = url;
    a.download = 'somata-jump-trace.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return summary();
  }
  window.SomataJumpTrace = Object.freeze({
    start,
    stop,
    mark,
    summary,
    report,
    download,
    sample,
    observeLamps,
    observeRounding,
    noteRoundingFallback,
    noteRoundingShape,
  });
})();
