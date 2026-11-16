import './skeleton-runtime.js'; // initialisation order: this module runs after it
import {
  getEffectiveSpiralOrder,
  getEffectiveSpiralStep,
  getSpiralAngularVertexCount,
  getSpiralClosureRatio,
  normalizeSpiralOrder,
  spiralRadialExponent,
} from './spiral/order-params.js';
import { spiralSquashYFactor } from './orbit-builder.js';

// Shared geometry step. It consumes moving anchors; it never matches endpoints
// or chooses a morph rule. Order zero is the unmodified polygon graph.
window.SomataSpiralOrderBuilder = (() => {
  const mix = (a, b, t) => a + (b - a) * t;
  const orderOf = (layer) => getEffectiveSpiralOrder(layer);
  function sampleOrder(a, b, t) {
    return normalizeSpiralOrder(mix(orderOf(a), orderOf(b), t));
  }
  function build(
    anchors,
    a,
    b,
    t,
    phaseSync,
    orderOverride,
    orderTransition,
    spiralSquashY,
    direct,
    cloneTransport = false,
    unfold = false,
  ) {
    const order = orderOverride == null ? sampleOrder(a, b, t) : normalizeSpiralOrder(orderOverride);
    const step = mix(getEffectiveSpiralStep(a), getEffectiveSpiralStep(b), t);
    const angularN = mix(getSpiralAngularVertexCount(a), getSpiralAngularVertexCount(b), t);
    const spiralEnd = direct && (Math.abs(direct.from) < 1e-8 ? direct.to : direct.from);
    const weight = direct ? Math.max(0, Math.min(1, order / spiralEnd)) : 0;
    const endLayer = direct && (Math.abs(direct.from) < 1e-8 ? b : a);
    const endpointAngle = direct
      ? ((Math.PI * 2 * getEffectiveSpiralStep(endLayer)) / getSpiralAngularVertexCount(endLayer)) *
        Math.max(-1, Math.min(1, spiralEnd))
      : 0;
    let layerwiseDelta;
    if (direct) {
      const z = Math.min(1, Math.abs(spiralEnd));
      const projection = Math.min(1, spiralSquashYFactor(spiralSquashY, spiralEnd) / 0.02);
      layerwiseDelta = endpointAngle * projection;
      if (endLayer.spiralTwist === true && !direct.coordinated) {
        const w = z * z * (3 - 2 * z),
          phi = endpointAngle / z;
        const r = Math.pow(Math.max(1.0000001, getSpiralClosureRatio()), Math.abs(spiralEnd));
        layerwiseDelta = Math.atan2(w * r * Math.sin(phi), 1 - w + w * r * Math.cos(phi)) * projection;
      }
    }
    const diameterOrbits =
      Boolean(unfold && typeof unfold === 'object') && anchors.every((p) => p.points.length === 2);
    const paths = anchors
      .map((path) => {
        const winding = unfold ? order : (path.fixedOrder ?? order);
        const wound = Math.abs(winding) > 1e-8;
        const radialScale = Math.pow(
          Math.max(1.0000001, getSpiralClosureRatio()),
          spiralRadialExponent(winding),
        );
        const spiralStep = path.fixedSpiralStep ?? step,
          spiralAngularN = path.fixedAngularN ?? angularN;
        const openCarrier = (path.spiralConnected ?? path.closed) === false;
        const twist =
          path.fixedTwist ?? mix(a?.spiralTwist === true ? 1 : 0, b?.spiralTwist === true ? 1 : 0, t);
        if (unfold && typeof unfold === 'object') {
          if (!wound) return { ...path, order: 0, phaseSync, unfoldUntwisted: true };
          const w = Math.max(0, Math.min(1, Math.abs(winding / unfold.endpoint)));
          const sy = spiralSquashYFactor(spiralSquashY, winding);
          const angle =
            ((2 * Math.PI * spiralStep) / Math.max(2, spiralAngularN)) *
            Math.max(-1, Math.min(1, unfold.endpoint));
          const ratio = Math.pow(
            Math.max(1.0000001, getSpiralClosureRatio()),
            spiralRadialExponent(unfold.endpoint) * w,
          );
          // A copy continues an ENTIRE orbit, not a single edge. Using
          // the polygon step here swings its seam into the next corner
          // (90° on a square) and forces the rails to cross. Let scale
          // open the turn; allow only a small scale-dependent rotation.
          const beta = diameterOrbits
            ? 0
            : (unfold.seaweed
                ? angle * w
                : Math.sign(angle) * Math.min(Math.abs(angle) * 0.15, 0.18 * w * Math.log(ratio))) *
              Math.min(1, sy / 0.02);
          const rotation = twist * w * Math.sign(angle) * Math.min(Math.abs(angle) * 0.2, Math.PI / 18);
          const graph = SomataSkeletonRuntime.createGraph(path.orbitIndex, path.points, {
            twist,
            spiralOrder: winding,
            spiralStep,
            spiralAngularN,
            radialScale: ratio,
            connectEdges: !openCarrier,
            preserveIds: true,
            orbitUnfold: { beta, projection: sy, rotation, seaweed: unfold.seaweed },
          });
          if (!graph) return null;
          return {
            ...path,
            order: winding,
            phaseSync,
            closed: false,
            fullTurn: graph.connected,
            graph,
            points: graph.nodes,
            spiralStep,
            spiralAngularN,
            radialScale: ratio,
            beta,
            periodic: graph.connected,
            periodicChain: graph.connected,
            unfoldUntwisted: true,
          };
        }
        if (unfold) {
          if (!wound) return { ...path, order: 0, phaseSync };
          // Cut at the first vertex, keep that vertex anchored. Move all
          // the original edges as one graph; never split them into rails.
          const sy = spiralSquashYFactor(spiralSquashY, winding);
          const beta =
            ((Math.sign(winding) * 2 * Math.PI * spiralStep) / Math.max(2, spiralAngularN)) *
            Math.min(1, Math.abs(winding)) *
            Math.min(1, sy / 0.02);
          const graph = SomataSkeletonRuntime.createGraph(path.orbitIndex, path.points, {
            twist: 1,
            referenceWeight: 0,
            beta,
            phaseProjection: sy,
            spiralOrder: winding,
            spiralStep,
            spiralAngularN,
            radialScale,
            connectEdges: !openCarrier,
            openCarrier,
            preserveIds: true,
          });
          if (!graph) return null;
          return {
            ...path,
            order: winding,
            phaseSync,
            closed: false,
            fullTurn: graph.connected,
            graph,
            points: graph.nodes,
            spiralStep,
            spiralAngularN,
            radialScale,
            beta,
            periodic: graph.connected && (path.reveal ?? 1) >= 1,
            periodicChain: graph.connected,
            unfoldSpine: true,
          };
        }
        if (direct) {
          if (!wound) return { ...path, order: 0, phaseSync, directLayerwise: true };
          const untwisted = endLayer.spiralTwist !== true;
          const spiralAngle =
            ((2 * Math.PI * spiralStep) / Math.max(2, spiralAngularN)) * Math.max(-1, Math.min(1, spiralEnd));
          const endRatio = Math.pow(Math.max(1.0000001, getSpiralClosureRatio()), Math.abs(spiralEnd));
          const graph = SomataSkeletonRuntime.createGraph(path.orbitIndex, path.points, {
            twist: untwisted ? 0 : 1,
            referenceWeight: untwisted ? 1 : 0,
            referenceDelta: spiralAngle,
            spiralOrder: winding,
            spiralStep,
            spiralAngularN,
            radialScale,
            connectEdges: !openCarrier,
            openCarrier,
            preserveIds: true,
            directLayerwise: {
              weight,
              angle: spiralAngle,
              scale: endRatio,
              reverse: spiralEnd < 0,
              endpointWinding: Math.min(1, Math.abs(spiralEnd)),
              coordinated: direct.coordinated,
            },
          });
          if (!graph) return null;
          return {
            ...path,
            order: winding,
            phaseSync,
            closed: false,
            fullTurn: graph.connected,
            graph,
            points: graph.nodes,
            spiralStep,
            spiralAngularN,
            radialScale,
            directLayerwise: true,
          };
        }
        const from = orderTransition?.from ?? orderOf(a),
          to = orderTransition?.to ?? orderOf(b);
        const crossesZero = path.fixedOrder == null && from * to <= 0 && from !== to;
        // A pure spiral is always the reference at its authored order.
        // Only a live polygon/handedness transition needs the continuous
        // chain as a bridge near zero (the reference branches collapse).
        const range = Math.min(1, ...[Math.abs(from), Math.abs(to)].filter((v) => v > 1e-8));
        const z = crossesZero ? Math.min(1, Math.abs(winding) / range) : 1;
        const referenceWeight = path.coordinatedReference
          ? 1
          : path.coordinatedSpine
            ? 0
            : (1 - twist) * z * z * (3 - 2 * z);
        const phaseProjection = spiralSquashYFactor(spiralSquashY, winding);
        // Fit the angular phase of the common period, not an extra turn.
        // Unwrapped signed beta tends to zero at a change of handedness.
        // At a fully flattened projection rotation must be zero.
        const beta =
          path.coordinatedSpine && (!path.coordinatedReference || !openCarrier)
            ? winding === 0
              ? 0
              : ((2 * Math.PI * spiralStep) / Math.max(2, spiralAngularN)) *
                Math.max(-1, Math.min(1, winding)) *
                Math.min(1, phaseProjection / 0.02)
            : undefined;
        const options = {
          twist,
          referenceWeight,
          beta,
          phaseProjection,
          spiralOrder: winding,
          spiralStep,
          spiralAngularN,
          radialScale,
          connectEdges: wound ? !openCarrier : path.closed === true,
          openCarrier: wound && openCarrier,
          singleReferenceBranch: path.singleReferenceBranch,
        };
        const graphFor = (points, extra) =>
          SomataSkeletonRuntime.createGraph(path.orbitIndex, points, { ...options, ...extra });
        const graph = wound
          ? graphFor(path.points, { windingWeight: path.reveal ?? 1, preserveIds: true })
          : null;
        if (wound && !graph) return null;
        // The morph declares which edges grow or shrink and supplies their
        // full-size anchors. Measure the corresponding chord with the same
        // order transform; the profile never derives a new trajectory.
        let profileReferenceLengths;
        const ref = path.profileReference;
        if (ref) {
          const lengths = (points) =>
            graphFor(points)?.edgeSamples.map(([a, b]) => Math.hypot(b.x - a.x, b.y - a.y));
          const from = lengths(ref.from),
            to = ref.to ? lengths(ref.to) : null;
          profileReferenceLengths = ref.sides
            ? ref.sides.map((side, i) => (side === 0 ? from?.[i] : side === 1 ? to?.[i] : null))
            : from;
        }
        if (!wound) return { ...path, order: 0, phaseSync, profileReferenceLengths };
        // A growing/retiring germ is not a complete turn yet.
        const periodic = phaseSync && graph.connected && (path.reveal ?? 1) >= 1;
        return {
          ...path,
          order: winding,
          phaseSync,
          closed: false,
          fullTurn: graph.connected,
          graph,
          points: graph.nodes,
          spiralStep,
          spiralAngularN,
          radialScale,
          profileReferenceLengths,
          beta,
          periodic,
          cloneTransport,
          periodicChain: (periodic || path.coordinatedSpine) && !graph.referenceEdges,
        };
      })
      .filter(Boolean);
    // A germ shares the parent's *wound* node at birth/death as well.
    const byId = new Map(paths.filter((p) => !p.parentNodeId).flatMap((p) => p.points.map((q) => [q.id, q])));
    const planar = new Map(anchors.flatMap((p) => p.points.map((q) => [q.id, q])));
    for (const p of paths) {
      const q = byId.get(p.parentNodeId),
        a0 = planar.get(p.parentNodeId);
      if (!p.graph || !q || !a0) continue;
      const w = 1 - (p.reveal ?? 1);
      for (const n of p.points) {
        n.x += (q.x - a0.x) * w;
        n.y += (q.y - a0.y) * w;
      }
    }
    return {
      order,
      paths,
      phaseSync,
      step,
      angularN,
      directLayerwise: !!direct,
      layerwiseDelta,
      cloneTransport,
    };
  }
  return Object.freeze({ build, sampleOrder });
})();
