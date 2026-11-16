import './mirror-overlay.js'; // initialisation order: this module runs after it
import { state } from '../core/state.js';
import { SomataCorridorCopyFrame } from './corridor-copy-frame.js';
import { normalizeSpiralSquashY } from '../geometry/orbit-builder.js';

window.SomataSkeletonOverlay = (() => {
  const id = 'skeletonOverlayCanvas';
  const seen = [];
  const stats = {
    frames: 0,
    captured: 0,
    paths: 0,
    points: 0,
    previewTransitions: 0,
    graphLinks: 0,
    graphMaxGap: 0,
    rawJunctionMax: 0,
    errors: 0,
  };
  let canvas = null,
    context = null;
  const safe = (fn) => {
    try {
      return fn();
    } catch (err) {
      stats.errors++;
      return null;
    }
  };
  function ensure() {
    canvas = canvas || document.getElementById(id);
    if (!canvas) return null;
    context = context || canvas.getContext('2d', { alpha: true });
    const source = document.getElementById('mainCanvas');
    if (!context || !source) return null;
    if (canvas.width !== source.width || canvas.height !== source.height) {
      canvas.width = source.width;
      canvas.height = source.height;
    }
    return context;
  }
  function begin() {
    seen.length = 0;
  }
  function active(layerIndex) {
    const layer = state?.layers?.[layerIndex];
    return layer?.testMorph?.showSkeleton === true;
  }
  function framePaths(frameCtx) {
    const service = window.SomataSkeletonRuntime;
    if (!service) return null;

    const shared = frameCtx.__somataSkeletonFrame || frameCtx.geometryProvider?.skeletonFrame;
    if (Array.isArray(shared)) return shared;
    const gp = frameCtx.geometryProvider,
      blue = frameCtx.blueMorphProvider;
    const runtime = window.SomataMorphRuntime;
    if (blue?.lightMorphEnabled && (!gp?.modeOverride || gp.modeOverride === 'light')) {
      const spec = runtime.fromBlue(frameCtx.layerIndex);
      return spec
        ? runtime.sampleSkeleton(spec, blue.geometryT, { layer: blue.renderLayer || frameCtx.layer })
        : service.staticFrame(blue.renderLayer || frameCtx.layer);
    }
    let spec = null,
      t = 0;
    if (gp?.active === true && gp.geometryActive !== false && gp.sourceLayer && gp.targetLayer) {
      if (gp === frameCtx.greenMorphProvider || gp === frameCtx.orangeMorphProvider) return [];
      spec = runtime.describe({
        sourceLayer: gp.sourceLayer,
        targetLayer: gp.targetLayer,
        mode: gp.modeOverride || blue?.mode,
        slide: gp.slideTypeOverride || state?.morph?.slideType,
        layerIndex: frameCtx.layerIndex,
        origin: blue?.active ? 'blue' : 'manual',
      });
      t = gp.progress;
    } else if (blue?.active && blue.geometryActive && blue.mode !== 'lightning') {
      spec = runtime.fromBlue(frameCtx.layerIndex);
      t = blue.geometryT;
    }
    if (spec) {
      return []; // The compatibility renderer has no authoritative moving skeleton.
    }
    return service.staticFrame(frameCtx.layer);
  }

  function connectedDrawPaths(paths) {
    const groups = new Map(),
      groupKeys = new Set(),
      draw = [];
    for (const p of paths || []) {
      if (p?.connectToNext === true && p.edgeIndex != null && p.sourceOrbitIndex != null) {
        const key = p.sourceOrbitIndex;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(p);
        groupKeys.add(p);
      }
    }
    const joined = new Map();
    let links = 0,
      maxGap = 0;
    for (const [key, edges] of groups) {
      edges.sort((a, b) => a.edgeIndex - b.edgeIndex);
      let good = edges.length >= 2;
      const points = [];
      for (let i = 0; i < edges.length; i++) {
        const current = edges[i];
        if (current.edgeIndex !== i || !Array.isArray(current.points) || current.points.length < 2) {
          good = false;
          break;
        }
        if (i) {
          const previous = edges[i - 1].points.at(-1),
            head = current.points[0];
          const gap = Math.hypot(previous.x - head.x, previous.y - head.y);
          maxGap = Math.max(maxGap, gap);
          if (previous.id !== head.id || gap > 1e-8) {
            good = false;
            break;
          }
          links++;
        }
        points.push(...(i ? current.points.slice(1) : current.points));
      }
      if (good && points.length > 2) {
        const closed = points.at(-1)?.id === points[0]?.id;
        if (closed) points.pop();
        joined.set(key, {
          points,
          closed,
          alpha: edges[0].alpha,
          fullTurn: !closed && edges[0].turnStart && edges.at(-1).turnEnd,
        });
      }
    }
    const used = new Set();
    for (const p of paths || []) {
      if (groupKeys.has(p)) {
        const key = p.sourceOrbitIndex;
        if (joined.has(key)) {
          if (!used.has(key)) draw.push(joined.get(key));
          used.add(key);
          continue;
        }
      }
      draw.push(p);
    }
    return { draw, links, maxGap };
  }
  function capture(frameCtx, rootTransform) {
    if (!frameCtx || !active(frameCtx.layerIndex)) return;
    const paths = safe(() => framePaths(frameCtx));
    if (!paths?.length) return;
    const m = rootTransform || { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
    const corridor = state?.tunnel?.active === true;
    const instances = frameCtx.visibleInstances;
    const copies = corridor ? instances?.copies || [] : [{ scale: 1 }];
    const alphas = corridor ? instances?.alphas || [] : [instances?.alphas?.[0] ?? 1];
    let attributes = null;
    if (corridor && copies.length && typeof SomataCorridorCopyFrame !== 'undefined')
      attributes = safe(() => SomataCorridorCopyFrame.batch(frameCtx));
    const edges = paths.flatMap((p) =>
      p.graph?.referenceEdges ? p.graph.orbits.map((edge) => ({ ...edge, alpha: p.alpha })) : [p],
    );
    const assembled = connectedDrawPaths(edges);
    stats.graphLinks = assembled.links;
    stats.graphMaxGap = assembled.maxGap;
    stats.rawJunctionMax = paths.reduce((v, p) => Math.max(v, Number(p.rawJunctionGap) || 0), 0);
    const copyRecords = copies.flatMap((copy, i) => {
      const alpha = Number(alphas[i] ?? 0);
      const scale = Number(copy?.scale);
      if (!Number.isFinite(alpha) || alpha <= 0.0001 || !Number.isFinite(scale) || scale <= 0) return [];
      return [
        {
          scale,
          position: Number.isFinite(Number(copy?.position)) ? Number(copy.position) : i,
          alpha: Math.min(1, Math.max(0, alpha)),
          rotation: attributes
            ? Number(safe(() => SomataCorridorCopyFrame.rotationAt(attributes, copy, i))) || 0
            : 0,
        },
      ];
    });
    const order = Number(frameCtx.layer?.spiralOrder) || 0;
    const coordinated =
      frameCtx.layer?.__somataCoordinatedSpine === true &&
      frameCtx.layer?.__somataContinuousSpiralPeriodScale > 0;
    const legacy =
      !normalizeSpiralSquashY(frameCtx.layer?.spiralSquashY) && !frameCtx.geometryProvider?.primarySkeleton;
    const spiralCorridor =
      corridor &&
      (coordinated || legacy) &&
      Math.abs(order) > 1e-8 &&
      assembled.draw.length > 0 &&
      assembled.draw.every((p) => p.fullTurn === true && p.closed !== true && p.points?.length >= 2);
    const connected = spiralCorridor
      ? window.SomataSkeletonRuntime?.corridorFrame?.(
          assembled.draw,
          copyRecords,
          Number(frameCtx.combinedScale) || 1,
          Number(frameCtx.combinedRotationRad) || 0,
        )
      : null;
    if (Array.isArray(connected) && connected.length) {
      seen.push({
        paths: connected,
        transform: [m.a, m.b, m.c, m.d, m.e, m.f],
        scale: 1,
        rotation: 0,
        copies: [{ scale: 1, alpha: 1, rotation: 0 }],
      });
    } else {
      seen.push({
        paths: assembled.draw,
        transform: [m.a, m.b, m.c, m.d, m.e, m.f],
        scale: Number(frameCtx.combinedScale) || 1,
        rotation: Number(frameCtx.combinedRotationRad) || 0,
        copies: copyRecords,
      });
    }
    stats.captured++;
  }
  function present() {
    const ctx = ensure();
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    canvas.style.display = seen.length ? 'block' : 'none';
    if (!seen.length) return;
    let nPaths = 0,
      nPoints = 0;
    for (const rec of seen) {
      for (const copy of rec.copies) {
        const [a, b, c, d, e, f] = rec.transform;
        ctx.save();
        ctx.setTransform(a, b, c, d, e, f);
        ctx.rotate(rec.rotation + copy.rotation);
        ctx.scale(rec.scale * copy.scale, rec.scale * copy.scale);
        const pixelsPerUnit = Math.max(0.0001, Math.hypot(a, b) * Math.abs(rec.scale * copy.scale));
        const alpha = Math.min(0.85, Math.max(0, copy.alpha));
        ctx.strokeStyle = `rgba(172,180,191,${alpha})`;
        ctx.lineWidth = 1.3 / pixelsPerUnit;
        ctx.setLineDash([4 / pixelsPerUnit, 4 / pixelsPerUnit]);
        ctx.lineCap = 'butt';
        ctx.lineJoin = 'round';
        for (const p of rec.paths) {
          if (p.points?.length < 2) continue;
          ctx.globalAlpha = Number.isFinite(Number(p.alpha)) ? Math.max(0, Math.min(1, Number(p.alpha))) : 1;
          ctx.beginPath();
          ctx.moveTo(p.points[0].x, p.points[0].y);
          for (let j = 1; j < p.points.length; j++) ctx.lineTo(p.points[j].x, p.points[j].y);
          if (p.closed) ctx.closePath();
          ctx.stroke();
          nPaths++;
          nPoints += p.points.length;
        }
        ctx.restore();
      }
    }
    stats.frames++;
    stats.paths = nPaths;
    stats.points = nPoints;
  }
  function status() {
    return {
      ...stats,
      enabled: state?.layers?.some((l) => l?.testMorph?.showSkeleton === true) || false,
      contract:
        'Primary straight-edge graph; Corridor repeats the same graph using visibleInstances copies and alphas.',
    };
  }
  window.__somataSkeletonStatus = status;
  return Object.freeze({ begin, capture, present, status });
})();
