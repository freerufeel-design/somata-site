import '../geometry/spiral-order-builder.js'; // initialisation order: this module runs after it
import { getRoundingStrength } from '../core/palette.js';
import { runtimeState, state } from '../core/state.js';
import { isPreSampledSplineLayer, setPreSampledSplineLayer } from '../core/render-runtime.js';
import { getCachedLayerDrawData, getEffectiveLayerRadius } from '../effects/motion.js';
import { getMorphReferenceRadius } from '../geometry/reference-circle.js';
import { roundSpiralRailJoins } from '../geometry/spiral/bezier-carrier.js';
import { getEffectiveSpiralOrder } from '../geometry/spiral/order-params.js';
import { getSpiralTangentialBlend } from '../geometry/spiral/profile-prep.js';
import {
  applySpiralSquashY,
  buildPolygonProfilePathsFromSkeleton,
  normalizeSpiralSquashY,
  spiralSquashYFactor,
} from '../geometry/orbit-builder.js';
import {
  phaseCubicAt,
  profileCubicKnotFractions,
  profileCubicPartition,
  profileCubicPoint,
  profileModeTransitionProgress,
  recordExactPolygonSplinePath,
  resolveExactPolygonMorphEndpoint,
} from '../geometry/morph.js';

window.SomataMorphRuntime = (() => {
  const continuous = new Set(['phaseCircle', 'coordinated', 'coordinatedFromCenter']);
  const ordinary = new Set(['topology', 'circleSlide', 'fade', 'light']);
  const slides = new Set(['minimal', 'sector', 'phase']);
  let skeletonCache = new WeakMap(),
    planarEndpoints = new WeakMap(),
    builds = 0,
    hits = 0,
    frames = 0,
    failures = 0;
  const clamp = (value) => Math.max(0, Math.min(1, Number.isFinite(Number(value)) ? Number(value) : 0));
  const modeOf = (value) => {
    const mode = SomataMorphRegistry.migrate(String(value || 'circleSlide'));
    return continuous.has(mode) || ordinary.has(mode) ? mode : 'circleSlide';
  };
  const slideOf = (value) => (slides.has(value) ? value : 'minimal');
  const isWound = (layer) => layer?.spiralEnabled === true && Math.abs(Number(layer.spiralOrder) || 0) > 1e-8;
  function describe({
    sourceLayer,
    targetLayer,
    layerIndex = 0,
    mode,
    slide,
    origin = 'manual',
    phaseSerial = 0,
  } = {}) {
    if (!sourceLayer || !targetLayer) return null;
    const resolved = modeOf(mode),
      resolvedSlide = slideOf(slide);
    return Object.freeze({
      sourceLayer,
      targetLayer,
      layerIndex: Math.max(0, Number(layerIndex) || 0),
      mode: resolved,
      spiralType: continuous.has(resolved) ? resolved : 'torn',
      slideType: resolvedSlide,
      spiralSlideType: resolvedSlide,
      origin: origin === 'blue' ? 'blue' : 'manual',
      phaseSerial: Number(phaseSerial) || 0,
    });
  }
  function fromBlue(layerIndex = 0) {
    const index = Math.max(0, Number(layerIndex) || 0),
      rt = typeof runtimeState !== 'undefined' ? runtimeState?.morph : null;
    return describe({
      sourceLayer: rt?.renderSourceLayers?.[index],
      targetLayer: rt?.renderTargetLayers?.[index],
      layerIndex: index,
      // Тип морфинга выбирается по паре слоя: спираль на любом конце — тип спирали.
      mode:
        typeof state !== 'undefined'
          ? window.SomataMorphMode?.forLayer?.(index, {
              sourceLayer: rt?.renderSourceLayers?.[index],
              targetLayer: rt?.renderTargetLayers?.[index],
            }) ||
            state?.morph?.unifiedMode ||
            state?.morph?.mode
          : 'circleSlide',
      slide: typeof state !== 'undefined' ? state?.morph?.slideType : 'minimal',
      origin: 'blue',
      phaseSerial: rt?.gpuPhasePrepareSerial,
    });
  }

  function getPlan(spec) {
    if (!spec) return null;
    const a = spec.sourceLayer,
      b = spec.targetLayer;
    let targets = skeletonCache.get(a);
    if (!targets) {
      targets = new WeakMap();
      skeletonCache.set(a, targets);
    }
    let variants = targets.get(b);
    if (!variants) {
      variants = new Map();
      targets.set(b, variants);
    }
    const key = `${spec.mode}:${spec.slideType}:${spec.phaseSerial}:${state.fourierMode === true}:${spec.rootedOrbit === true}`;
    if (variants.has(key)) {
      hits++;
      return variants.get(key);
    }
    const plan = SomataSkeletonRuntime.planAnchors(a, b, spec.mode, spec.slideType, { rootedOrbit: spec.rootedOrbit });
    if (variants.size >= 12) variants.clear();
    variants.set(key, plan);
    builds++;
    return plan;
  }
  function squashOf(spec, u, frame) {
    const live = frame?.spiralSquashY ?? frame?.layer?.spiralSquashY;
    return (
      live ??
      normalizeSpiralSquashY(spec.sourceLayer.spiralSquashY) * (1 - u) +
        normalizeSpiralSquashY(spec.targetLayer.spiralSquashY) * u
    );
  }
  function layerwiseTransport(spec, frame) {
    if (!continuous.has(spec.mode) && !frame?.explicitOrder) return null;
    const mode =
      frame?.zeroMode ?? window.SomataSpiralZeroTransition?.modeFor(frame?.layer ?? spec.sourceLayer);
    if (window.SomataSpiralZeroTransition?.normalizeMode(mode) !== 'layerwise') return null;
    const a = spec.sourceLayer,
      b = spec.targetLayer;
    const from = frame?.orderTransition?.from ?? getEffectiveSpiralOrder(a);
    const to = frame?.orderTransition?.to ?? getEffectiveSpiralOrder(b);
    if (Math.abs(from) < 1e-8 === Math.abs(to) < 1e-8) return null;
    return { from, to, coordinated: SomataMorphRegistry.usesCoordinatedSpine(spec.mode) };
  }
  function centerPlanarEndpoint(layer) {
    if (Math.abs(getEffectiveSpiralOrder(layer)) < 1e-8) return layer;
    let flat = planarEndpoints.get(layer);
    if (!flat) {
      flat = { ...layer, spiralOrder: 0, spiralEnabled: false, closedLoop: layer.spiralClosed !== false };
      planarEndpoints.set(layer, flat);
    }
    return flat;
  }
  function skeletonAt(spec, u, frame) {
    const a = spec.sourceLayer,
      b = spec.targetLayer,
      sk = SomataSkeletonRuntime;
    const phaseSync = SomataMorphRegistry.corridorPhase(spec.mode);
    const edit = frame?.orderTransition;
    const unsealed =
      spec.mode === 'phaseCircle' &&
      SomataMorphRegistry.get(spec.mode).usesCloneTransport(a, b) &&
      (!edit || edit.from * edit.to > 0);
    const wind = SomataSpiralOrderBuilder;
    const squash = squashOf(spec, u, frame);
    const direct = layerwiseTransport(spec, frame);
    // An order override does not change the Blue endpoints. At order
    // zero their flattened spiral branch list is NOT a polygon graph:
    // restore authored suborbit boundaries before pairing the anchors.
    const liveOrder = frame?.order ?? wind.sampleOrder(a, b, u);
    const zeroMode = window.SomataSpiralZeroTransition?.normalizeMode(
      frame?.zeroMode ?? window.SomataSpiralZeroTransition?.modeFor(frame?.layer ?? a),
    );
    const untwisted = window.SomataSpiralZeroTransition?.usesOrbitUnfold(zeroMode) === true;
    const unfold =
      (zeroMode === 'unfold' || (untwisted && Math.abs(liveOrder) <= 1 + 1e-8)) &&
      !a.chaosStar &&
      !b.chaosStar &&
      (Math.abs(liveOrder) > 1e-8 || Boolean(edit) || isWound(a) || isWound(b));
    const planar = Boolean(direct) || unfold || Math.abs(liveOrder) < 1e-8;
    const anchorSpec = planar
      ? { ...spec, sourceLayer: centerPlanarEndpoint(a), targetLayer: centerPlanarEndpoint(b) }
      : spec;
    if (direct) {
      const sameLayout = [
        'N',
        'K',
        'radius',
        'radiusMultiplier',
        'rotation',
        'customSuborbits',
        'chaosStar',
        'chaosClosures',
        'spiralStep',
        'spiralStepLinked',
        'spiralTwist',
        'spiralClosed',
      ].every((k) => a[k] === b[k]);
      // An order edit has common vertices: no phase-specific re-pairing.
      const fixedSpec = anchorSpec;
      const layer = u === 1 ? fixedSpec.targetLayer : fixedSpec.sourceLayer;
      const fixedAnchors = sameLayout || frame?.orderOnly;
      let anchors = fixedAnchors ? sk.anchors(layer) : sk.sample(getPlan(anchorSpec), u, frame);
      if (frame?.sharedOrder)
        anchors = anchors.map((p) => (p.fixedOrder == null ? p : { ...p, fixedOrder: undefined }));
      return wind.build(anchors, a, b, u, phaseSync, frame?.order, frame?.orderTransition, squash, direct);
    }
    if (unfold) {
      const flat = u === 1 ? anchorSpec.targetLayer : anchorSpec.sourceLayer;
      const sameLayout = ['N', 'K', 'radius', 'radiusMultiplier', 'rotation', 'customSuborbits'].every(
        (k) => a[k] === b[k],
      );
      // A single-seam unfold has an authored root and direction: a
      // cyclic polygon correspondence can rotate or reverse that root,
      // then snap back to it at t=1. Preserve the rooted orbit order.
      const unfoldSpec = untwisted ? { ...anchorSpec, rootedOrbit: true } : anchorSpec;
      const anchors =
        frame?.orderOnly || sameLayout ? sk.anchors(flat) : sk.sample(getPlan(unfoldSpec), u, frame);
      const endpoint = edit
        ? Math.abs(edit.from) > Math.abs(edit.to)
          ? edit.from
          : edit.to
        : [getEffectiveSpiralOrder(a), getEffectiveSpiralOrder(b)].sort(
            (x, y) => Math.abs(y) - Math.abs(x),
          )[0];
      return wind.build(
        anchors,
        a,
        b,
        u,
        true,
        liveOrder,
        edit,
        squash,
        null,
        false,
        untwisted
          ? {
              seaweed: zeroMode === 'seaweed',
              endpoint: Math.abs(endpoint) > 1e-8 ? endpoint : Math.sign(liveOrder) || 1,
            }
          : true,
      );
    }
    if (frame?.staticOrder || (frame?.explicitOrder && frame?.orderOnly)) {
      const layer = frame.staticOrder ? a : (frame.layer ?? a);
      return wind.build(sk.anchors(layer), a, b, u, phaseSync, frame.order, edit, squash);
    }
    if (frame?.orderOnly && !SomataMorphRegistry.usesCoordinatedSpine(spec.mode) && !unsealed) {
      const order = frame.order;
      const layer = { ...(u === 1 ? b : a), spiralOrder: order, spiralEnabled: Math.abs(order) > 1e-8 };
      return wind.build(sk.anchors(layer), a, b, u, phaseSync, order);
    }
    const plan = getPlan(anchorSpec);
    if (!plan) {
      failures++;
      return null;
    }
    const anchors = sk.sample(plan, u, frame);
    const connected = (l) =>
      Math.abs(getEffectiveSpiralOrder(l)) > 1e-8 ? l.spiralClosed !== false : l.extendedProfileEnabled === true || l.closedLoop !== false;
    const geometry = wind.build(
      anchors.map((p) => ({
        ...p,
        fixedOrder: frame?.sharedOrder ? undefined : p.fixedOrder,
        spiralConnected: p.spiralConnected ?? connected(u < 0.5 ? a : b),
      })),
      a,
      b,
      u,
      phaseSync,
      frame?.order,
      frame?.orderTransition,
      squash,
      null,
      unsealed,
    );
    if (spec.origin === 'manual' && planar && a.N !== b.N && !isWound(a) && !isWound(b))
      geometry.lampPaths = plan.evaluate.lampPaths?.(u);
    return geometry;
  }
  // Use one period for the visible rail and its control graph, in the same
  // coordinate space as Corridor copies (including the final Y projection).
  function framePeriod(frame, squash) {
    if (!frame || frame.directLayerwise) return null;
    const split = frame.paths.find((p) => p.unfoldUntwisted && p.graph && (p.alpha ?? 1) > 0.001);
    if (split) return { delta: split.beta, scale: split.radialScale };
    const ref =
      frame.paths.find((p) => p.periodic && (p.alpha ?? 1) > 0.001) ?? frame.paths.find((p) => p.periodic);
    if (!ref) return null;
    if (frame.cloneTransport) {
      // Nominal (unsquashed) carrier period, not a fitted beta. The
      // authored rails and follower rails are never welded to a copy.
      const edge = ref.graph.edgeSamples;
      const head = edge[0][0],
        tail = ref.graph.referenceEdges ? edge[0].at(-1) : edge.at(-1).at(-1);
      const r = Math.hypot(head.x, head.y);
      return r > 1e-9 ? { delta: ref.graph.periodDelta, scale: Math.hypot(tail.x, tail.y) / r } : null;
    }
    if (ref.unfoldSpine || ref.coordinatedSpine) return { delta: ref.beta, scale: ref.radialScale };
    // Fixed-N/K transports can contain orbit groups with different local
    // angular denominators. The copy step follows the global interpolation,
    // not whichever group happens to be visible first on this frame.
    const u = Math.min(1, Math.abs(ref.order)),
      w = u * u * (3 - 2 * u);
    const angle = (Math.sign(ref.order) * 2 * Math.PI * frame.step) / Math.max(2, frame.angularN);
    const phi = angle * ref.graph.twist;
    const chain = Math.atan2(
      w * ref.radialScale * Math.sin(phi),
      1 - w + w * ref.radialScale * Math.cos(phi),
    );
    const branch = angle * u,
      weight = ref.graph.referenceWeight ?? 0;
    const delta = chain + Math.atan2(Math.sin(branch - chain), Math.cos(branch - chain)) * weight;
    const factor = spiralSquashYFactor(squash, ref.order);
    return { delta: delta * Math.min(1, factor / 0.02), scale: ref.radialScale };
  }
  function nextPeriod(p, { delta, scale }) {
    const c = Math.cos(delta) * scale,
      s = Math.sin(delta) * scale;
    return { x: c * p.x - s * p.y, y: s * p.x + c * p.y };
  }
  function sealSkeleton(path, period) {
    if (
      !period ||
      path.unfoldUntwisted ||
      path.unfoldSpine ||
      path.coordinatedSpine ||
      path.directLayerwise ||
      path.cloneTransport
    )
      return;
    const g = path.graph,
      ref = g.referenceEdges;
    const seam = (start, tail, edgeIndex) => {
      const end = nextPeriod(start, period);
      // Keep the original polygon edge in the 13.2/chain blend. Its
      // closing span is explicit, not a snap that collapses the polygon.
      if (ref && g.referenceWeight < 1 && Math.hypot(end.x - tail.x, end.y - tail.y) > 1e-8) {
        const node = { ...tail, ...end, id: `${tail.id}:seam` };
        g.nodes.push(node);
        g.byId.set(node.id, node);
        g.edges.push({
          from: tail.id,
          to: node.id,
          kind: 'period-seam',
          orbitIndex: g.orbitIndex,
          edgeIndex,
        });
        g.orbits[edgeIndex].points.push(node);
      } else Object.assign(tail, end);
    };
    if (ref) g.edgeSamples.forEach(([a, b], i) => seam(a, b, i));
    else seam(g.nodes[0], g.nodes.at(-1), g.edgeSamples.length - 1);
  }
  function sealContour(paths, path, period) {
    if (
      path.unfoldUntwisted ||
      path.cloneTransport ||
      path.directLayerwise ||
      (!period && !path.coordinatedSpine) ||
      !paths.length
    )
      return;
    const pin = (rail, end, append) => {
      const points = rail.points,
        tail = points.at(-1),
        cubics = rail._bezierSegments,
        last = cubics?.at(-1);
      const gap = Math.hypot(tail.x - end.x, tail.y - end.y);
      if (append && gap > 1e-8) {
        const head = { ...tail, ...end };
        points.push(head);
        rail.cornerFlags?.push(false);
        rail.lampCornerFlags?.push(false);
        if (last) {
          const a = { ...last.p3 },
            b = { ...end };
          cubics.push({
            p0: a,
            c1: { x: (2 * a.x + b.x) / 3, y: (2 * a.y + b.y) / 3 },
            c2: { x: (a.x + 2 * b.x) / 3, y: (a.y + 2 * b.y) / 3 },
            p3: b,
            widthScale0: last.widthScale1 ?? 1,
            widthScale1: head.widthScale ?? 1,
          });
          points._spiroRetainedCubics = cubics;
        }
        return;
      }
      if (last) {
        const dx = end.x - last.p3.x,
          dy = end.y - last.p3.y;
        last.c2 = { x: last.c2.x + dx, y: last.c2.y + dy };
        last.p3 = { ...last.p3, ...end };
      }
      Object.assign(tail, end);
    };
    if (path.coordinatedReference) {
      if (!period) return;
      for (const rail of paths) {
        const edge = path.graph.edgeSamples[rail.spiralEdgeIndex];
        if (!edge) continue;
        const [start, end] = edge,
          first = rail._bezierSegments?.[0];
        if (first) {
          const dx = start.x - first.p0.x,
            dy = start.y - first.p0.y;
          first.c1 = { x: first.c1.x + dx, y: first.c1.y + dy };
          first.p0 = { ...first.p0, x: start.x, y: start.y };
        }
        Object.assign(rail.points[0], { x: start.x, y: start.y });
        pin(rail, end, false);
      }
      return;
    }
    if (path.periodicChain) {
      const rails = paths.slice().sort((a, b) => a.spiralEdgeIndex - b.spiralEdgeIndex);
      if (path.coordinatedSpine) {
        for (const rail of rails) {
          const edge = path.graph.edgeSamples[rail.spiralEdgeIndex];
          if (!edge) continue;
          const [start, end] = edge,
            first = rail._bezierSegments?.[0];
          if (first) {
            const dx = start.x - first.p0.x,
              dy = start.y - first.p0.y;
            first.c1 = { x: first.c1.x + dx, y: first.c1.y + dy };
            first.p0 = { ...first.p0, x: start.x, y: start.y };
          }
          Object.assign(rail.points[0], { x: start.x, y: start.y });
          pin(rail, end, false);
        }
      } else {
        for (let i = 0; i < rails.length - 1; i++) pin(rails[i], rails[i + 1].points[0], false);
        pin(rails.at(-1), nextPeriod(rails[0].points[0], period), false);
      }
    } else
      for (const rail of paths) pin(rail, nextPeriod(rail.points[0], period), path.graph.referenceWeight < 1);
  }
  function sampleSkeleton(spec, progress, frame) {
    if (!spec) return [];
    const u = clamp(progress),
      sampled = skeletonAt(spec, u, frame),
      paths = sampled?.paths || [];
    const squash = squashOf(spec, u, frame),
      period = framePeriod(sampled, squash);
    for (const p of paths)
      if (p.graph) {
        const factor = spiralSquashYFactor(squash, p.order);
        applySpiralSquashY(null, [p.graph], factor);
        sealSkeleton(p, p.periodic ? period : null);
      }
    return paths;
  }
  const blend = (a, b, t) => Number(a) + (Number(b) - Number(a)) * t;
  // Same polyline with `count` nodes: midpoints are inserted into the longest segments.
  // Inserted nodes are plain (no corner/lamp flags), so lamps and fillets keep their anchors.
  function densifyProfileNodes(nodes, count) {
    const out = nodes.map((p) => ({ ...p }));
    while (out.length < count) {
      let at = 0,
        longest = -1;
      for (let i = 0; i < out.length - 1; i++) {
        const l = Math.hypot(out[i + 1].x - out[i].x, out[i + 1].y - out[i].y);
        if (l > longest) {
          longest = l;
          at = i;
        }
      }
      const a = out[at],
        b = out[at + 1];
      out.splice(at + 1, 0, { x: (Number(a.x) + Number(b.x)) / 2, y: (Number(a.y) + Number(b.y)) / 2 });
    }
    return out;
  }
  // A contour profile is laid along the carrier and measured from its walking
  // direction. When the slide plan walks an endpoint's polygon backwards, the
  // same profile would come out mirrored (a bump that pointed outward turns
  // inward) and snap back at t = 0 / 1, where the authored anchors are used.
  // Turning the profile by 180 degrees about the middle of its chord keeps the
  // endpoint's authored contour on the reversed carrier.
  function mirrorProfileNodes(nodes) {
    const first = nodes[0],
      last = nodes[nodes.length - 1],
      cx = Number(first.x) + Number(last.x),
      cy = Number(first.y) + Number(last.y);
    return nodes
      .slice()
      .reverse()
      .map((p) => ({ ...p, x: cx - Number(p.x), y: cy - Number(p.y) }));
  }
  function withMirroredProfile(layer) {
    if (!layer || !(layer.profileNodes?.length >= 2)) return layer;
    const mirrored = { ...layer, profileNodes: mirrorProfileNodes(layer.profileNodes) };
    const exact = layer.__morphExactProfileNodes;
    if (Array.isArray(exact) && exact.length >= 2)
      mirrored.__morphExactProfileNodes = mirrorProfileNodes(exact);
    const flags = layer.__lampLogicalCornerFlags;
    if (Array.isArray(flags)) mirrored.__lampLogicalCornerFlags = flags.slice().reverse();
    setPreSampledSplineLayer(mirrored, isPreSampledSplineLayer(layer));
    return mirrored;
  }
  function projectionLayer(a, b, t, order) {
    const from = resolveExactPolygonMorphEndpoint(a),
      to = resolveExactPolygonMorphEndpoint(b);
    if (t === 0 || t === 1) return t === 0 ? from : to;
    const base = t < 0.5 ? from : to;
    let nodesA = from.profileNodes,
      nodesB = to.profileNodes;
    const sameKind =
      from.profileMode === to.profileMode &&
      nodesA?.length >= 2 &&
      nodesB?.length >= 2 &&
      isPreSampledSplineLayer(from) === isPreSampledSplineLayer(to);
    // Profiles with different node counts used to switch whole at t = 0.5, so the contour
    // gained or lost vertices in one frame (a visible jerk). For straight-segment profiles,
    // split the longest segments of the shorter one: its shape is unchanged, the counts match,
    // and the nodes blend continuously like equal-length profiles do.
    if (sameKind && nodesA.length !== nodesB.length && from.profileMode !== 'spline') {
      const n = Math.max(nodesA.length, nodesB.length);
      nodesA = densifyProfileNodes(nodesA, n);
      nodesB = densifyProfileNodes(nodesB, n);
    }
    const canBlend = sameKind && nodesA.length === nodesB.length;
    const profileNodes = canBlend
      ? nodesA.map((p, i) => ({ ...p, x: blend(p.x, nodesB[i].x, t), y: blend(p.y, nodesB[i].y, t) }))
      : base.profileNodes;
    const layer = {
      ...base,
      spiralOrder: order,
      spiralEnabled: Math.abs(order) > 1e-8,
      profileNodes,
      radius: getMorphReferenceRadius(a, b, t),
      radiusMultiplier: 1,
      rounding: blend(a.rounding ?? 0, b.rounding ?? 0, t),
      __spiralTangentialMix: blend(getSpiralTangentialBlend(a), getSpiralTangentialBlend(b), t),
    };
    if (isPreSampledSplineLayer(base)) setPreSampledSplineLayer(layer, true);
    return layer;
  }
  function profileWeight(t, origin = 'blue') {
    const u = clamp(t);
    if (u === 0 || u === 1) return u;
    const instant =
      ['start', 'end', 'second'].includes(state.morph?.profileModeTransition) &&
      !(Number(state.morph?.profileModeTransitionPercent) > 0);
    return origin === 'manual' || instant ? u * u * (3 - 2 * u) : clamp(profileModeTransitionProgress(u));
  }
  // Convert logical vertices to positions on their own endpoint curve before
  // subdivision. A tessellation index is not a lamp attachment coordinate.
  function profileKeys(path, cubics, knots) {
    const result = [];
    for (let j = 1; j < path.points.length - (path.closed ? 0 : 1); j++) {
      const p = path.points[j];
      if (!path.lampCornerFlags?.[j] && p.__profileKeyCorner !== true) continue;
      let best = 0,
        d = Infinity;
      for (let k = 1; k < knots.length - 1; k++) {
        const q = cubics[k - 1].p3,
          dist = (p.x - q.x) ** 2 + (p.y - q.y) ** 2;
        if (dist < d) {
          best = k;
          d = dist;
          if (d < 1e-16) break;
        }
      }
      if (best) result.push(knots[best]);
    }
    return result.sort((a, b) => a - b).filter((u, i, all) => i === 0 || u - all[i - 1] > 1e-8);
  }
  // Project both authored profile shapes onto the SAME live skeleton.
  // Match cubic spans by subdivision (not by changing the renderer at 50%).
  function blendProfilePaths(a, b, t, from, to, curveSteps = 8) {
    if (a.length !== b.length || !a.length) return null;
    const out = [];
    for (let i = 0; i < a.length; i++) {
      const x = a[i],
        y = b[i];
      if (x.closed !== y.closed) return null;
      const wound = Math.abs(x.spiralOrder || 0) > 1e-8;
      const rail = (p, l) =>
        p._bezierSegments?.length ? p._bezierSegments : recordExactPolygonSplinePath(p, l);
      const c = rail(x, from),
        d = rail(y, to);
      if (!c || !d) return null;
      const ck = profileCubicKnotFractions(c),
        dk = profileCubicKnotFractions(d);
      const common = [...ck, ...dk]
        .sort((m, n) => m - n)
        .filter((v, j, arr) => j === 0 || v - arr[j - 1] > 1e-8);
      common[0] = 0;
      common[common.length - 1] = 1;
      const cs = profileCubicPartition(c, ck, common),
        ds = profileCubicPartition(d, dk, common);
      if (!cs || !ds) return null;
      const widthAt = (rail, marks) => {
        let k = 0;
        return (u) => {
          while (k < rail.length - 1 && u > marks[k + 1]) k++;
          const q = rail[k],
            f = clamp((u - marks[k]) / Math.max(1e-12, marks[k + 1] - marks[k]));
          return blend(q.widthScale0 || 1, q.widthScale1 || 1, f);
        };
      };
      const wa = widthAt(c, ck),
        wb = widthAt(d, dk),
        widths = wound ? common.map((u) => blend(wa(u), wb(u), t)) : null;
      const cubics = cs.map((q, j) => {
        const r = ds[j],
          seg = {};
        for (const key of ['p0', 'c1', 'c2', 'p3']) seg[key] = profileCubicPoint(q[key], r[key], t);
        if (widths) {
          seg.widthScale0 = widths[j];
          seg.widthScale1 = widths[j + 1];
        }
        return seg;
      });
      const ka = profileKeys(x, c, ck),
        kb = profileKeys(y, d, dk);
      const keys =
        ka.length === kb.length
          ? ka.map((u, j) => ({ u: blend(u, kb[j], t), id: `key:${j}`, presence: 1 }))
          : [
              ...ka.map((u, j) => ({ u, id: `key:${j}:source`, presence: 1 - t })),
              ...kb.map((u, j) => ({ u, id: `key:${j}:target`, presence: t })),
            ];
      keys.sort((a, b) => a.u - b.u);
      const points = [],
        lampCornerFlags = [];
      const push = (p, key) => {
        if (key) {
          p.__profileKeyCorner = true;
          p.__profileLampKey = key.id;
          p.__profileLampPresence = key.presence;
        }
        points.push(p);
        lampCornerFlags.push(Boolean(key));
      };
      let k = 0;
      const bent = (q) => {
        const length = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
        return length(q.p0, q.c1) + length(q.c1, q.c2) + length(q.c2, q.p3) - length(q.p0, q.p3) > 0.01;
      };
      for (let i = 0; i < cubics.length; i++) {
        const q = cubics[i],
          lo = common[i],
          hi = common[i + 1];
        const n = bent(cs[i]) || bent(ds[i]) ? curveSteps : 1;
        const stops = Array.from({ length: n }, (_, j) => ({ u: j / n }));
        while (k < keys.length && keys[k].u < hi) {
          const key = keys[k++];
          if (key.presence > 0) stops.push({ u: clamp((key.u - lo) / (hi - lo)), key });
        }
        stops.sort((a, b) => a.u - b.u || (b.key?.presence ?? 0) - (a.key?.presence ?? 0));
        const merged = [];
        for (const stop of stops) {
          const last = merged.at(-1);
          if (last && Math.abs(stop.u - last.u) < 1e-8) {
            if ((stop.key?.presence ?? 0) > (last.key?.presence ?? 0)) last.key = stop.key;
          } else merged.push(stop);
        }
        for (const { u, key } of merged) {
          const p = phaseCubicAt(q, u);
          if (wound) p.widthScale = blend(q.widthScale0, q.widthScale1, u);
          push(p, key);
        }
      }
      const end = t < 0.5 ? x : y,
        tail = cubics.at(-1);
      if (wound) Object.assign(points[0], { ...end.points[0], ...points[0] });
      if (!x.closed)
        push({ ...end.points.at(-1), ...tail.p3, ...(wound ? { widthScale: tail.widthScale1 } : {}) });
      if (wound) {
        points._spiroRetainedCubics = cubics;
        points._somataFinalProfileCubics = true;
      }
      out.push({
        ...end,
        points,
        cornerFlags: [],
        lampCornerFlags,
        bridgeRoundFlags: [],
        _bezierSegments: cubics,
        spiralRetainedProfileCarrier: wound || end.spiralRetainedProfileCarrier,
        profileCurveBaked: true,
      });
    }
    return out;
  }
  // Fourier consumes the unfiltered polyline, not the rounded/spline draw
  // commands. Match the two rails on the live skeleton by normalized arc
  // length, retaining every original knot. At either endpoint subdivision
  // leaves the exact source polyline (and its width field) unchanged.
  function blendFourierProfilePaths(a, b, t) {
    if (a.length !== b.length || !a.length) return null;
    const parameterize = (path) => {
      const points = path.points, n = points.length;
      if (n < 2) return null;
      const count = path.closed ? n : n - 1;
      const marks = [0];
      for (let i = 0; i < count; i++) {
        const p = points[i], q = points[(i + 1) % n];
        marks.push(marks[i] + Math.hypot(q.x - p.x, q.y - p.y));
      }
      const total = marks.at(-1);
      for (let i = 0; i <= count; i++) marks[i] = total > 0 ? marks[i] / total : i / count;
      let j = 0;
      const width = (p, fallback = 1) => Number.isFinite(p.widthScale) ? p.widthScale : fallback;
      return { marks, at(u) {
        while (j < count - 1 && marks[j + 1] <= u) j++;
        const p = points[j], q = points[(j + 1) % n];
        const span = marks[j + 1] - marks[j];
        const f = span > 0 ? clamp((u - marks[j]) / span) : 0;
        const index = f < 1e-9 ? j : f > 1 - 1e-9 ? (j + 1) % n : -1;
        return { x: blend(p.x, q.x, f), y: blend(p.y, q.y, f),
          widthScale: blend(width(p), width(q, width(p)), f), index };
      } };
    };
    const out = [];
    for (let i = 0; i < a.length; i++) {
      const x = a[i], y = b[i];
      if (x.closed !== y.closed || x.spiralEdgeIndex !== y.spiralEdgeIndex) return null;
      const c = parameterize(x), d = parameterize(y);
      if (!c || !d) return null;
      // Return the original endpoint, including all logical anchors.
      if (t === 0 || t === 1) { out.push(t === 0 ? x : y); continue; }
      const knots = [...new Set([...c.marks, ...d.marks])].sort((m,n) => m - n);
      if (x.closed) knots.pop();
      const points = [], cornerFlags = [], lampCornerFlags = [], lampSupportFlags = [];
      for (const u of knots) {
        const p = c.at(u), q = d.at(u);
        const source = t < 0.5 ? x : y, index = t < 0.5 ? p.index : q.index;
        const meta = index >= 0 ? source.points[index] : null;
        points.push({ ...meta, x: blend(p.x, q.x, t), y: blend(p.y, q.y, t),
          widthScale: blend(p.widthScale, q.widthScale, t) });
        cornerFlags.push(index >= 0 && source.cornerFlags?.[index] === true);
        lampCornerFlags.push(index >= 0 && source.lampCornerFlags?.[index] === true);
        lampSupportFlags.push(index >= 0 && source.lampSupportFlags?.[index] === true);
      }
      const radius = x.points._somataReferenceRadius;
      if (Number.isFinite(radius)) Object.defineProperty(points, '_somataReferenceRadius', { value: radius, configurable: true });
      out.push({ ...(t < 0.5 ? x : y), points, cornerFlags, lampCornerFlags, lampSupportFlags,
        bridgeRoundFlags: [], _bezierSegments: null });
    }
    return out;
  }
  function samplePrimary(spec, progress, frame) {
    if (!spec) return null;
    const u = clamp(progress),
      a = spec.sourceLayer,
      b = spec.targetLayer;
    const sampled = skeletonAt(spec, u, frame);
    if (!sampled) return null;
    const { order, paths: skeletonFrame, phaseSync } = sampled;
    const renderOrder = skeletonFrame.find((p) => (p.alpha ?? 1) > 0.5)?.order ?? order;
    // Profiles of endpoints whose polygon the carrier walks backwards. The
    // slide plan decides this per orbit, so the profile variants are per path.
    const variants = new Map();
    const profilesFor = (path) => {
      const key = (path.srcReversed === true ? 1 : 0) | (path.dstReversed === true ? 2 : 0);
      let v = variants.get(key);
      if (!v) {
        const profileA = key & 1 ? withMirroredProfile(a) : a,
          profileB = key & 2 ? withMirroredProfile(b) : b;
        v = {
          profileA,
          profileB,
          layer: projectionLayer(profileA, profileB, u, order),
          from: resolveExactPolygonMorphEndpoint(profileA),
          to: resolveExactPolygonMorphEndpoint(profileB),
        };
        variants.set(key, v);
      }
      return v;
    };
    const reference = phaseSync ? skeletonFrame.find((p) => p.fullTurn && (p.alpha ?? 1) > 0.001) : null;
    const squash = squashOf(spec, u, frame);
    const seam = framePeriod(sampled, squash);
    const period = sampled.layerwiseDelta ?? seam?.delta ?? reference?.graph?.periodDelta ?? NaN;
    const boundarySpan = 0.05;
    const boundary = u < 0.5 ? 0 : 1;
    const distanceToBoundary = Math.abs(u - boundary);
    const endpoint = boundary === 0 ? a : b;
    const phaseCircleSlots = spec.mode === 'phaseCircle' ? skeletonFrame[0]?.spiralEdgeLife : null;
    const roundedChain = !state.fourierMode && distanceToBoundary < boundarySpan &&
      skeletonFrame.length === 1 &&
      (skeletonFrame[0].coordinatedSpine || skeletonFrame[0].rootedOrbit || phaseCircleSlots?.some((life) => life < 0.5)) &&
      skeletonFrame[0].periodicChain &&
      !skeletonFrame[0].graph?.referenceEdges &&
      getRoundingStrength(endpoint.rounding) > 0.001 &&
      endpoint.spiralRoundSeams !== false;
    const boundarySkeleton = roundedChain && !phaseCircleSlots
      ? (distanceToBoundary === 0 ? sampled : skeletonAt(spec, boundary, frame))
      : null;
    const boundaryEdges = boundarySkeleton?.paths[0]?.graph?.edgeSamples;
    const collapsed = roundedChain && phaseCircleSlots
      ? phaseCircleSlots.map((life) => life < 0.5)
      : boundaryEdges?.map(([p, q]) => Math.hypot(p.x - q.x, p.y - q.y) < 1e-8);
    const roundedEndpoint = distanceToBoundary === 0 && collapsed?.some(Boolean)
      ? skeletonAt(spec, u, { ...frame, compactRoundedEndpoint: true })
      : null;
    let paths = (roundedEndpoint?.paths ?? skeletonFrame).flatMap((path) => {
      const { profileA, profileB, layer, from, to } = profilesFor(path);
      const mixed =
        (from.profileMode === 'segments' && to.profileMode === 'spline') ||
        (from.profileMode === 'spline' && to.profileMode === 'segments');
      const base =
        path.profileLayer ||
        (path.profileEndpoint === 'source' ? profileA : path.profileEndpoint === 'target' ? profileB : layer);
      const display = {
        ...base,
        spiralOrder: path.order,
        spiralEnabled: Math.abs(path.order) > 1e-8,
        spiralClosed: path.graph ? path.graph.connected : base.spiralClosed,
        // Fade and center-born branches retain their own endpoint scale.
        __somataReferenceRadius: path.lifecycle === 'birth' ? getEffectiveLayerRadius(b)
          : path.lifecycle === 'death' ? getEffectiveLayerRadius(a)
          : path.profileEndpoint === 'source' ? getEffectiveLayerRadius(a)
          : path.profileEndpoint === 'target' ? getEffectiveLayerRadius(b)
          : getMorphReferenceRadius(a, b, u),
      };
      if (isPreSampledSplineLayer(base)) setPreSampledSplineLayer(display, true);
      const lock = path.periodic ? seam : null;
      const factor = path.graph ? spiralSquashYFactor(squash, path.order) : 1;
      const build = (style) => buildPolygonProfilePathsFromSkeleton([path], style);
      const finish = (geometry, style) => {
        if (!path.graph) return geometry;
        applySpiralSquashY(geometry, [], factor);
        sealContour(geometry, path, lock);
        // Fillet the final visible rails, after phase/scale fitting and Y
        // projection. A reference branch joins its OWN next Corridor
        // copy, never the adjacent branch in the local rail array.
        if (
          style.spiralRoundSeams !== false &&
          !state.fourierMode &&
          path.graph.connected &&
          !path.cloneTransport &&
          !path.directLayerwise
        ) {
          const strength = getRoundingStrength(style.rounding) * Math.min(1, Math.abs(path.order));
          const circular = lock && !path.unfoldUntwisted && !path.unfoldSpine;
          const joins = [];
          if (path.graph.referenceEdges) {
            if (circular) for (const rail of geometry) joins.push([rail, rail, lock]);
          } else {
            for (let i = 1; i < geometry.length; i++)
              if (geometry[i].spiralEdgeIndex === geometry[i - 1].spiralEdgeIndex + 1)
                joins.push([geometry[i - 1], geometry[i]]);
            if (
              circular &&
              geometry.length &&
              geometry[0].spiralEdgeIndex === 0 &&
              geometry.at(-1).spiralEdgeIndex === path.graph.edgeSamples.length - 1
            )
              joins.push([geometry.at(-1), geometry[0], lock]);
          }
          roundSpiralRailJoins(joins, strength);
        }
        return geometry;
      };
      const settleSkeleton = () => {
        if (!path.graph) return;
        applySpiralSquashY(null, [path.graph], factor);
        sealSkeleton(path, lock);
      };
      const fourierProfileMismatch = state.fourierMode && (
        from.profileMode !== to.profileMode ||
        (from.profileMode === 'spline' && (from.profileNodes?.length !== to.profileNodes?.length ||
          isPreSampledSplineLayer(from) !== isPreSampledSplineLayer(to)))
      );
      if ((mixed || fourierProfileMismatch) && !path.profileLayer && !path.profileEndpoint) {
        const endpoint = (profile) => {
          const l = {
            ...display,
            profileMode: profile.profileMode,
            profileNodes: profile.profileNodes,
            splineRenderMode: profile.splineRenderMode,
            wholeCurveSpline: profile.wholeCurveSpline,
            __lampLogicalCornerFlags: profile.__lampLogicalCornerFlags,
            __somataMixedProfile: true,
            // Keep each Fourier endpoint's tessellation independent of the
            // discrete N/K fields on the current projection layer.
            ...(state.fourierMode ? { __somataFourierProfileSamplingLayer: profile } : {}),
          };
          setPreSampledSplineLayer(l, isPreSampledSplineLayer(profile));
          return l;
        };
        const left = endpoint(from),
          right = endpoint(to),
          a = build(left),
          b = build(right);
        settleSkeleton();
        // Bake seam and fillet into the same two rails even at t=0/1.
        // Cutting an already partitioned rail moves a different set of
        // controls as the sampling density changes.
        finish(a, left);
        finish(b, right);
        const weight = profileWeight(u, spec.origin);
        return (state.fourierMode
          ? blendFourierProfilePaths(a, b, weight)
          : blendProfilePaths(a, b, weight, left, right)) ?? (weight < 0.5 ? a : b);
      }
      const geometry = build(display);
      settleSkeleton();
      finish(geometry, display);
      return geometry;
    });
    const blendFromBoundary = distanceToBoundary > 0 && distanceToBoundary < boundarySpan;
    const boundaryMix = () => {
      const t = distanceToBoundary / boundarySpan;
      return t * t * (3 - 2 * t);
    };
    // Rounded planar vertices need a longer handoff: a five-percent
    // window can fit entirely between two presented frames.
    const polygonRoundingBoundary = 0.25;
    const polygonBoundaryT = distanceToBoundary / polygonRoundingBoundary;
    const polygonBoundaryMix = polygonBoundaryT * polygonBoundaryT * (3 - 2 * polygonBoundaryT);
    if (
      !state.fourierMode && sampled.lampPaths && polygonBoundaryT < 1 &&
      Number(a.K || 1) === 1 && Number(b.K || 1) === 1 &&
      getRoundingStrength(endpoint.rounding) > 0.001 &&
      paths.length === 1 && sampled.lampPaths.length === 1
    ) {
      // Collapsed edges must not change the rounded contour on the first
      // moving frame. Grow that contour from the authored endpoint.
      const fixed = getCachedLayerDrawData(endpoint)?.paths;
      if (fixed?.length === paths.length && distanceToBoundary === 0) {
        paths = fixed;
      } else if (fixed?.length === paths.length) {
        paths = boundary === 0
          ? blendProfilePaths(fixed, paths, polygonBoundaryMix, a, endpoint, 32) ?? paths
          : blendProfilePaths(paths, fixed, 1 - polygonBoundaryMix, endpoint, b, 32) ?? paths;
      }
    } else if (blendFromBoundary && collapsed?.some(Boolean)) {
      const fixed = samplePrimary(spec, boundary, frame).paths;
      if (fixed.length === collapsed.filter((missing) => !missing).length) {
        // Insert each zero-length branch at the seam of its surviving neighbors.
        // Both sides of that seam then move from the same endpoint geometry.
        let cursor = 0;
        const byEdge = collapsed.map((missing) => {
          if (!missing) return fixed[cursor++];
          const previous = fixed[cursor - 1]?._bezierSegments?.at(-1);
          const next = fixed[cursor]?._bezierSegments?.[0];
          const p = previous?.p3 ?? next?.p0;
          return p ? { point: p, width: previous?.widthScale1 ?? next?.widthScale0 ?? 1 } : null;
        });
        const boundaryPaths = paths.map((path) => {
          const fixedPath = byEdge[path.spiralEdgeIndex];
          if (!fixedPath?.point) return fixedPath;
          const { point, width } = fixedPath;
          return {
            ...path,
            points: [point, point],
            lampCornerFlags: [],
            _bezierSegments: [{ p0: point, c1: point, c2: point, p3: point, widthScale0: width, widthScale1: width }],
          };
        });
        if (boundaryPaths.every(Boolean)) {
          const blended = blendProfilePaths(boundaryPaths, paths, boundaryMix(), endpoint, endpoint);
          if (blended && skeletonFrame[0]?.rootedOrbit) {
            // Subdivision must not inherit the compact endpoint's indices:
            // Fill and lamps still consume the live skeleton's rail slots.
            blended.forEach((p, i) => {
              p.spiralEdgeIndex = paths[i].spiralEdgeIndex;
              p.spiralBranchIndex = paths[i].spiralBranchIndex;
            });
          }
          paths = blended ?? paths;
        }
      }
    } else if (
      blendFromBoundary && spec.mode === 'phaseCircle' &&
      (a.spiralTwist === true) !== (b.spiralTwist === true) &&
      !frame?.explicitOrder && !state.fourierMode &&
      getRoundingStrength(endpoint.rounding) > 0.001 &&
      endpoint.spiralRoundSeams !== false &&
      paths.every((path) => path._bezierSegments?.length && Math.abs(path.spiralOrder) > 1e-8)
    ) {
      // A change of twist switches between independent periods and a joined
      // chain. Begin with the already rounded endpoint before blending them.
      const fixed = samplePrimary(spec, boundary, frame).paths;
      paths = blendProfilePaths(fixed, paths, boundaryMix(), endpoint, endpoint) ?? paths;
    }
    if (roundedEndpoint) {
      for (const path of skeletonFrame) {
        if (!path.graph) continue;
        applySpiralSquashY(null, [path.graph], spiralSquashYFactor(squash, path.order));
        sealSkeleton(path, path.periodic ? seam : null);
      }
    }
    frames++;
    return {
      spec,
      paths,
      progress: u,
      lampPaths: sampled.lampPaths,
      period,
      periodScale: seam?.scale,
      skeletonFrame,
      phaseSync,
      order: renderOrder,
      primary: true,
    };
  }
  function sampleStaticOrder(layer, mode, withCorridor) {
    const zero = window.SomataSpiralZeroTransition,
      edit = zero.staticOrder(getEffectiveSpiralOrder(layer));
    if (!edit || layer.chaosStar === true) return null;
    const flat = { ...layer, spiralOrder: 0, spiralEnabled: false, closedLoop: layer.spiralClosed !== false };
    const wound = { ...layer, spiralOrder: edit.to, spiralEnabled: true, closedLoop: false };
    if (isPreSampledSplineLayer(layer)) {
      setPreSampledSplineLayer(flat, true);
      setPreSampledSplineLayer(wound, true);
    }
    const zeroMode = zero.modeFor(layer);
    const plan = zero.sampleOrder(zeroMode, edit.from, edit.to, edit.progress, withCorridor);
    const spec = describe({ sourceLayer: flat, targetLayer: wound, mode });
    return {
      sampled: samplePrimary(spec, edit.progress, {
        order: plan.order,
        zeroMode,
        sharedOrder: true,
        explicitOrder: true,
        orderOnly: true,
        staticOrder: true,
        orderTransition: edit,
        layer,
      }),
      edit,
      zeroMode,
      flat,
      wound,
    };
  }
  const sample = samplePrimary;
  // Same publication contract for a Blue frame and a manual frame.
  // Do not rewrite state.layers or Blue phase endpoints.
  function publish(frameCtx, sampled, { structural = true } = {}) {
    if (!frameCtx?.layer || !Array.isArray(sampled?.paths)) return false;
    const { spec, paths, progress, period, periodScale, skeletonFrame, primary, phaseSync, order } = sampled;
    frameCtx.__somataZeroOrderPrepared = true;
    frameCtx.__somataSkeletonFrame = Array.isArray(skeletonFrame) ? skeletonFrame : null;
    frameCtx.geometryProvider = {
      kind: 'blue-prepared',
      origin: spec.origin,
      active: true,
      geometryActive: true,
      progress,
      framePaths: paths,
      lampPaths: sampled.lampPaths,
      sourceLayer: spec.sourceLayer,
      targetLayer: spec.targetLayer,
      sourceProfileMode: spec.sourceLayer.profileMode,
      targetProfileMode: spec.targetLayer.profileMode,
      modeOverride: spec.mode,
      slideTypeOverride: spec.slideType,
      skeletonFrame: frameCtx.__somataSkeletonFrame,
      primarySkeleton: primary === true,
      corridorPhase: phaseSync,
      spiralOrder: order,
    };
    frameCtx.geometryMorphEnabled = true;
    frameCtx.topologyMorphEnabled = Boolean(structural);
    frameCtx.circleAngularMorphEnabled = false;
    frameCtx.layer.__somataReferenceRadius = getMorphReferenceRadius(spec.sourceLayer, spec.targetLayer, progress);
    frameCtx.layer.spiralOrder = order;
    frameCtx.layer.spiralEnabled = Math.abs(order) > 1e-8;
    frameCtx.layer.__somataSkeletonCorridorPhase = phaseSync;
    frameCtx.layer.__somataUnfoldSpine = skeletonFrame?.some((p) => p.unfoldSpine) === true;
    frameCtx.layer.__somataUnfoldUntwisted = skeletonFrame?.some((p) => p.unfoldUntwisted) === true;
    frameCtx.layer.__somataCoordinatedSpine = skeletonFrame?.some((p) => p.coordinatedSpine) === true;
    delete frameCtx.layer.__somataCoordinatedEdit;
    if (Number.isFinite(period)) frameCtx.layer.__somataCoordinatedPeriodDelta = period;
    else delete frameCtx.layer.__somataCoordinatedPeriodDelta;
    if (Number.isFinite(periodScale)) frameCtx.layer.__somataContinuousSpiralPeriodScale = periodScale;
    else delete frameCtx.layer.__somataContinuousSpiralPeriodScale;
    return true;
  }
  function reset() {
    skeletonCache = new WeakMap();
    planarEndpoints = new WeakMap();
  }
  const status = () => ({
    version: '14.2',
    builds,
    hits,
    frames,
    failures,
    controllers: ['blue', 'manual'],
    sharedKernel: 'anchor-frame → spiral-order-builder → profile',
    continuous: [...continuous],
    ordinary: [...ordinary],
    skeletonCarrier: 'mode-plan / primary-point-graph',
  });
  return Object.freeze({
    describe,
    fromBlue,
    getPlan,
    sample,
    sampleSkeleton,
    samplePrimary,
    sampleStaticOrder,
    publish,
    reset,
    status,
    modeOf,
    slideOf,
    profileWeight,
    isWound,
    isContinuous: (mode) => continuous.has(modeOf(mode)),
  });
})();
