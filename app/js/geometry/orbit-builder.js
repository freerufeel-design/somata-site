// Построение орбит слоя (buildOrbitPolylines): многоугольник/спираль, профиль, сжатие по Y.
import './chaos-star.js'; // initialisation order: this module runs after it
import { gcd } from '../core/defaults-layers.js';
import { getExtraRoundingStrength, getRoundingStrength } from '../core/palette.js';
import { isPreSampledSplineLayer, setPreSampledSplineLayer } from '../core/render-runtime.js';
import { somataWithFourierLayer, state } from '../core/state.js';
import { getEffectiveLayerRadius } from '../effects/motion.js';
import {
  checkIsBrokenProfile,
  getConfiguredSplinePointCount,
  getInterpolatedProfilePoints,
} from './profile-model.js';
import { buildClosedSpiralAutoCloseGeometry } from './spiral/fillets.js';
import {
  buildSpiralBezierSegments,
  repairRoundedSpiralBezierJoins,
  resolveMorphCommittedSpiralSpline,
} from './spiral/bezier-carrier.js';
import {
  getEffectiveSpiralOrder,
  getEffectiveSpiralStep,
  getSpiralAngularVertexCount,
  getSpiralClosureRatio,
  getSpiralGeometryLayer,
  isSpiralLayer,
  spiralRadialExponent,
} from './spiral/order-params.js';
import {
  applySpiralFinalSpaceProfileRounding,
  buildSpiralProfileForDraw,
  getSpiralRenderSampleCount,
  getSpiralTangentialBlend,
  repairSpiralEdgePoints,
  segmentProfileCornerFlags,
  validateSpiralEdgePoints,
} from './spiral/profile-prep.js';
import { mapProfileOntoSpiralEdge } from './spiral/carrier.js';
import { buildChaosVertexRing } from './chaos-star.js';

function normalizeSpiralSquashY(value) {
  const v = Number(value);
  return Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 0;
}
function spiralSquashYFactor(value, order) {
  // Fade in the transform with the winding near order zero so an
  // uncompressed polygon can become a compressed spiral continuously.
  const u = Math.min(1, Math.abs(Number(order) || 0));
  return 1 - normalizeSpiralSquashY(value) * 0.01 * u * u * (3 - 2 * u);
}
function applySpiralSquashY(paths, graphs, factor) {
  if (factor === 1) return;
  // Final affine projection, after profile placement and seam repair.
  // Preserve shared graph-node identity and transform every cubic handle.
  const seen = new Set();
  const scale = (p) => {
    if (p && !seen.has(p)) {
      seen.add(p);
      p.y = factor === 0 ? 0 : p.y * factor;
    }
  };
  for (const g of graphs || []) for (const p of g.nodes) scale(p);
  for (const path of paths || []) {
    for (const p of path.points) scale(p);
    for (const c of path._bezierSegments || []) {
      scale(c.p0);
      scale(c.c1);
      scale(c.c2);
      scale(c.p3);
    }
    path.points._somataSpiralSquashedY = true;
  }
}
function buildOrbitPolylines(layer, skeletonOnly = false) {
  return somataWithFourierLayer(layer, () => buildOrbitPolylinesScoped(layer, skeletonOnly));
}
// Same profile placement as Static, but no authored ring generation.
function buildPolygonProfilePathsFromSkeleton(frame, layer) {
  return buildOrbitPolylinesScoped(layer, false, frame);
}
function buildOrbitPolylinesScoped(layer, skeletonOnly, polygonFrame = null) {
  // All static and CPU geometry receives a capped K *before* orbit
  // traversal, branch indexing, suborbit count and profile sampling.
  // The recursion runs at most once; the resolved render view carries
  // the same effective K used later by its angular carrier.
  const projected = getSpiralGeometryLayer(layer);
  if (projected !== layer)
    return polygonFrame
      ? buildOrbitPolylinesScoped(projected, skeletonOnly, polygonFrame)
      : buildOrbitPolylines(projected, skeletonOnly);
  // The animated Blue Morph rail uses a paired, pre-sampled spline.
  // During phase handoff the authored layer retains its compact profile
  // nodes; a fallback/static Polygon or Spiral pass must display the
  // exact same curve as the last animated frame.  This overlay is active
  // only during playback, only for that authored layer, and only while
  // the user has not edited its raw profile.  It does not change project
  // data or the profile editor's control points.
  const bridge = skeletonOnly || polygonFrame ? null : resolveMorphCommittedSpiralSpline(layer);
  if (bridge) {
    const display = { ...layer, profileNodes: bridge.sampled };
    setPreSampledSplineLayer(display, true);
    return buildOrbitPolylines(display);
  }
  const N = Math.max(2, Math.round(Number(layer.N) || 4));
  // For Spiral, K controls BOTH the angular carrier and the orbit/edge
  // traversal. Previously only the angle was folded, so raw K=3 with
  // limit=2 still created raw-K=3 suborbits and phantom copies.
  const spiralTopology = isSpiralLayer(layer);
  const authoredK = Math.max(1, Math.round(Number(layer.K) || 1));
  const wrappedK = spiralTopology
    ? getEffectiveSpiralStep({ ...layer, __spiralAnimatedK: undefined, __spiralAnimatedN: undefined })
    : authoredK;
  const K = Math.max(1, Math.min(Math.floor(N / 2), Math.round(wrappedK)));
  const R = getEffectiveLayerRadius(layer, 220);
  const rotRad = ((Number(layer.rotation) || 0) * Math.PI) / 180;
  const chaosEnabled = layer.chaosStar === true && !isSpiralLayer(layer);
  const maxSuborbits = Math.max(1, gcd(N, K));
  let activeSuborbitsCount = chaosEnabled ? 1 : maxSuborbits;
  if (!chaosEnabled && layer.customSuborbits !== null && layer.customSuborbits !== undefined) {
    activeSuborbitsCount = Math.max(1, Math.min(Number(layer.customSuborbits) || 1, maxSuborbits));
  }

  // The integer N above controls topology; animated Spiral phase uses
  // a fractional N so the individual coil angle morphs continuously.
  const spiralAngularN = getSpiralAngularVertexCount(layer);
  const stepAngle = (2 * Math.PI) / (isSpiralLayer(layer) ? spiralAngularN : N);
  const verticesPerOrbit = Math.max(2, N / maxSuborbits);

  const spiralEnabled = isSpiralLayer(layer);
  const spiralStep = getEffectiveSpiralStep(layer);
  const spiralClosed = layer.spiralClosed !== false;
  const spiralOrder = getEffectiveSpiralOrder(layer);
  const skeletonOrbits = [];
  const skeletonGraphs = [],
    rings = [];
  if (polygonFrame) {
    for (const carrier of polygonFrame) {
      if (carrier.points.length >= 2 && (carrier.alpha ?? 1) > 0)
        rings.push({
          sIdx: carrier.orbitIndex,
          P: carrier.graph?.sourceVertices || carrier.points,
          graph: carrier.graph,
          carrier,
        });
    }
  } else
    for (let sIdx = 0; sIdx < activeSuborbitsCount; sIdx++) {
      let P = [];
      if (chaosEnabled) {
        P = buildChaosVertexRing(layer, N, K, R, rotRad);
      } else {
        const g = Math.round((sIdx * maxSuborbits) / activeSuborbitsCount) % maxSuborbits;
        for (let step = 0; step < verticesPerOrbit; step++) {
          const idx = (g + step * K) % N;
          const angle = idx * stepAngle + rotRad - Math.PI / 2;
          P.push({ x: R * Math.cos(angle), y: R * Math.sin(angle), polygonIndex: idx });
        }
      }
      if (P.length < 2) continue;
      // Construct the primary point-and-edge graph BEFORE any profile
      // placement or spline controls. All consumers use its nodes.
      const skeletonTargetScale = Math.pow(
        Math.max(1.0000001, getSpiralClosureRatio()),
        spiralRadialExponent(spiralOrder),
      );
      const graph = window.SomataSkeletonRuntime?.createGraph?.(sIdx, P, {
        spiralOrder: spiralEnabled ? spiralOrder : 0,
        spiralStep,
        spiralAngularN,
        twist: layer.spiralTwist === true ? 1 : 0,
        radialScale: skeletonTargetScale,
        openCarrier: spiralEnabled ? layer.spiralClosed === false : layer.closedLoop === false,
        connectEdges: spiralEnabled ? spiralClosed : layer.closedLoop !== false,
      });
      rings.push({ sIdx, P, graph });
      if (graph) {
        skeletonGraphs.push(graph);
        skeletonOrbits.push(...graph.orbits);
      }
    }
  if (skeletonOnly) return skeletonGraphs;
  const smoothSplineMode = layer.profileMode === 'spline';
  const splineSnapshotAlreadySampled = smoothSplineMode && isPreSampledSplineLayer(layer);
  const authoredSmoothSpline =
    smoothSplineMode &&
    !splineSnapshotAlreadySampled &&
    Array.isArray(layer.profileNodes) &&
    layer.profileNodes.length >= 2;

  const profileSpaceSplineAlreadySampled = spiralEnabled && smoothSplineMode && splineSnapshotAlreadySampled;
  const baseProfilePts =
    spiralEnabled && smoothSplineMode
      ? Array.isArray(layer.profileNodes) && layer.profileNodes.length >= 2
        ? layer.profileNodes.map((p) => ({ x: Number(p?.x) || 0, y: Number(p?.y) || 0 }))
        : getInterpolatedProfilePoints(layer)
      : authoredSmoothSpline
        ? layer.profileNodes.map((p) => ({ x: Number(p?.x) || 0, y: Number(p?.y) || 0 }))
        : getInterpolatedProfilePoints(layer);
  const spiralTangential = spiralEnabled ? getSpiralTangentialBlend(layer) : 0;
  const spiralRoundSeams = spiralEnabled && layer.spiralRoundSeams !== false;
  const spiralRounding = getRoundingStrength(layer.rounding);
  const spiralExtraRounding = spiralEnabled ? getExtraRoundingStrength(layer.rounding) : 0;
  const spiralProfileData = spiralEnabled
    ? buildSpiralProfileForDraw(
        layer,
        baseProfilePts,
        getSpiralRenderSampleCount(layer, Math.max(baseProfilePts.length, getConfiguredSplinePointCount())),
        spiralRounding,
        profileSpaceSplineAlreadySampled,
      )
    : null;
  const profilePts = spiralEnabled ? spiralProfileData.points : baseProfilePts;
  const isBroken = checkIsBrokenProfile(layer, baseProfilePts);
  const isFlatProfile =
    profilePts.length >= 2 &&
    Math.abs(profilePts[0].x) < 0.001 &&
    Math.abs(profilePts[0].y) < 0.001 &&
    Math.abs(profilePts[profilePts.length - 1].x - 1) < 0.001 &&
    Math.abs(profilePts[profilePts.length - 1].y) < 0.001 &&
    profilePts.every((p) => Math.abs(p.y) < 0.001);

  const profileCornerFlags =
    layer.profileMode === 'segments' ? segmentProfileCornerFlags(profilePts) : profilePts.map(() => false);

  const spiralLampCornerFlags =
    spiralEnabled && (layer.profileMode === 'segments' || layer.profileMode === 'spline')
      ? spiralProfileData?.keyFlags || profilePts.map(() => false)
      : null;

  const profLen = profilePts.length;
  const roundedJoin = (layer.lineJoinType || 'rounded') !== 'straight';

  const smoothSplineRenderer = layer.profileMode === 'spline';

  const interiorCorner = (ptIdx) => {
    if (ptIdx === 0 || ptIdx === profLen - 1) return false;
    if (layer.profileMode !== 'segments') return false;
    return Boolean(profileCornerFlags[ptIdx]);
  };

  const paths = [];
  for (const { sIdx, P, graph, carrier } of rings) {
    const profileMeta = carrier
      ? {
          primarySkeleton: true,
          topoCircleCarrier: true,
          skeletonOrbitId: carrier.points[0].id,
          lifecycle: carrier.lifecycle,
          strokeGrowth: carrier.strokeGrowth,
          phaseFollower: carrier.phaseFollower,
          _alpha: carrier.alpha ?? 1,
          ...(carrier.fillRole ? { _fillRole: carrier.fillRole, _fillPhase: carrier.fillPhase } : null),
          ...(carrier.fillPathSource !== undefined
            ? {
                _fillPathSource: carrier.fillPathSource !== false,
                _fillPathTarget: carrier.fillPathTarget !== false,
              }
            : null),
          spiralOrder: carrier.order,
        }
      : {};
    // Fade seam smoothing on disappearing edges, independently
    // of profile height, which is always measured in edge units.
    const seamWeight = (i, len) => {
      const reference = carrier?.profileReferenceLengths?.[i];
      const terminal = (i === graph?.edges.length - 1 ? (graph.terminalWeight ?? 1) : 1) *
        (carrier?.spiralEdgeLife?.[i] ?? 1);
      if (reference > 0) return (len / reference) * terminal;
      const full = i === graph?.edges.length - 1 ? graph.terminalReferenceLength : 0;
      return full > 0 ? len / full : terminal;
    };
    // v9.2: extended profile shares the same authored profile and anchor
    // vertices as Polygon. All rails are open and extend far past the
    // original edge; the repeated variant preserves profile shape.
    if (layer.extendedProfileEnabled === true && !spiralEnabled) {
      const repetitions = 3;
      const repeat = layer.extendedProfileMode === 'repeat';
      for (let i = 0; i < (carrier && !carrier.closed ? P.length - 1 : P.length); i++) {
        const a = P[i],
          b = P[(i + 1) % P.length];
        const dx = b.x - a.x,
          dy = b.y - a.y,
          L = Math.hypot(dx, dy);
        if (!(L > 1e-6)) continue;
        const nx = -dy / L,
          ny = dx / L;
        const pts = [];
        if (repeat) {
          for (let n = -repetitions; n <= repetitions; n++) {
            for (let j = 0; j < baseProfilePts.length; j++) {
              if (n > -repetitions && j === 0) continue;
              const p = baseProfilePts[j];
              const u = n + (Number(p.x) || 0),
                v = (Number(p.y) || 0) * L * 0.5;
              pts.push({ x: a.x + u * dx + v * nx, y: a.y + u * dy + v * ny });
            }
          }
        } else {
          pts.push({ x: a.x - repetitions * dx, y: a.y - repetitions * dy });
          pts.push({ x: b.x + repetitions * dx, y: b.y + repetitions * dy });
        }
        if (pts.length >= 2)
          paths.push({
            points: pts,
            closed: false,
            cornerFlags: pts.map((_, j) => repeat && j > 0 && j < pts.length - 1),
            extendedProfileRail: true,
            orbitIndex: sIdx,
            extendedEdgeIndex: i,
            ...profileMeta,
            topoCircleCarrier: false,
          });
      }
      continue;
    }

    const planarClosed = carrier ? carrier.closed : (graph?.closed ?? layer.closedLoop !== false);
    const windingT = Math.min(1, Math.abs(spiralOrder));
    const windingWeight = windingT * windingT * (3 - 2 * windingT);
    const smoothFlatSpline = isFlatProfile && !spiralEnabled && layer.profileMode === 'spline';
    if (
      isFlatProfile &&
      !spiralEnabled &&
      !smoothFlatSpline &&
      !(layer.__somataMixedProfile && !planarClosed)
    ) {
      paths.push({
        points: carrier ? P.map(({ x, y }) => ({ x, y })) : P,
        closed: planarClosed,
        cornerFlags: P.map(() => true),
        orbitIndex: sIdx,
        ...profileMeta,
      });
      continue;
    }

    const edges = [];
    for (
      let i = 0;
      i < (graph?.edges.length ?? (spiralEnabled || planarClosed ? P.length : P.length - 1));
      i++
    ) {
      const p1 = graph?.edgeSamples?.[i]?.[0] || P[i];
      const p2 = graph?.edgeSamples?.[i]?.at(-1) || P[(i + 1) % P.length];
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const segLen = Math.hypot(dx, dy);
      if (segLen === 0) {
        edges.push([]);
        continue;
      }
      const ux = dx / segLen;
      const uy = dy / segLen;
      const nx = -uy;
      const ny = ux;
      let pts = [];
      if (spiralEnabled) {
        const edgeProfileScale = seamWeight(i, segLen);
        const seamWinding =
          graph?.referenceWeight === 1
            ? 1
            : windingWeight + (1 - windingWeight) * (graph?.referenceWeight ?? 0);
        const mappedSpiralPts = mapProfileOntoSpiralEdge(
          profilePts,
          P,
          i,
          R,
          spiralOrder,
          spiralTangential,
          null,
          carrier?.spiralStep ?? spiralStep,
          carrier?.spiralAngularN ?? spiralAngularN,
          false,
          0,
          null,
          null,
          graph,
          Math.min(1, edgeProfileScale),
        );

        let profileRoundedPts =
          layer.profileMode === 'segments'
            ? applySpiralFinalSpaceProfileRounding(mappedSpiralPts, spiralRounding)
            : mappedSpiralPts;

        let rawVisibleSpiralPts = spiralClosed ? profileRoundedPts : mappedSpiralPts;
        if (
          spiralClosed &&
          !carrier?.periodicChain &&
          !carrier?.coordinatedReference &&
          !carrier?.directLayerwise &&
          !carrier?.cloneTransport &&
          !carrier?.unfoldUntwisted
        ) {
          // Mark topology without recomputing the open Spiral base points.
          profileRoundedPts = profileRoundedPts.map((p) => ({ ...p, __spiralClosed: true }));
          rawVisibleSpiralPts = buildClosedSpiralAutoCloseGeometry(
            profileRoundedPts,
            0,
            false,
            seamWinding * Math.min(1, edgeProfileScale),
          );

          pts = spiralRoundSeams
            ? buildClosedSpiralAutoCloseGeometry(
                profileRoundedPts,
                spiralRounding,
                true,
                seamWinding * Math.min(1, edgeProfileScale),
              )
            : rawVisibleSpiralPts;
        } else pts = profileRoundedPts;
        pts = carrier
          ? validateSpiralEdgePoints(pts).ok
            ? pts
            : rawVisibleSpiralPts
          : repairSpiralEdgePoints(
              pts,
              rawVisibleSpiralPts,
              P,
              i,
              R,
              spiralOrder,
              spiralTangential,
              spiralStep,
              spiralAngularN,
              spiralClosed,
              graph,
            );
      } else {
        const profileR = segLen;
        for (let j = 0; j < profLen; j++) {
          const prof = profilePts[j];
          pts.push({
            x: p1.x + prof.x * segLen * ux + prof.y * profileR * 0.5 * nx,
            y: p1.y + prof.x * segLen * uy + prof.y * profileR * 0.5 * ny,
            ptIdx: j,
          });
        }
      }
      edges.push(pts);
    }

    if (spiralEnabled) {
      for (let spiralEdgeIndex = 0; spiralEdgeIndex < edges.length; spiralEdgeIndex++) {
        const e = edges[spiralEdgeIndex];
        if (e.length < 2) continue;
        const bakedProfileRound = layer.profileMode === 'segments' && spiralRounding > 0.001;
        const cornerFlags = e.map((p, idx) =>
          bakedProfileRound
            ? false
            : Boolean(p.__profileCorner) ||
              interiorCorner(p.ptIdx) ||
              (layer.profileMode === 'spline' &&
                layer.wholeCurveSpline !== true &&
                Boolean(
                  spiralProfileData?.keyFlags?.[Number.isFinite(Number(p?.ptIdx)) ? Number(p.ptIdx) : idx],
                )),
        );
        const lampCornerFlags = e.map((p, idx) =>
          p.__spiralProfileFillet
        ? Boolean(spiralLampCornerFlags?.[p.__profileLampAnchorIndex])
        : Boolean(spiralLampCornerFlags?.[Number.isFinite(Number(p?.ptIdx)) ? Number(p.ptIdx) : idx]),
        );

        const retainedPoints = e.map((srcPoint) => ({
          ...srcPoint,
          x: Number(srcPoint?.x) || 0,
          y: Number(srcPoint?.y) || 0,
          widthScale: Math.max(0.02, Number(srcPoint?.widthScale) || 1),
          ptIdx: Number.isFinite(Number(srcPoint?.ptIdx)) ? Number(srcPoint.ptIdx) : undefined,
          __spiralDelta: Number(srcPoint?.__spiralDelta) || 0,
          __spiralTargetScale: Math.max(1e-6, Number(srcPoint?.__spiralTargetScale) || 1),
          __spiralClosed: !carrier?.directLayerwise && srcPoint?.__spiralClosed === true,
          __spiralTangential: srcPoint?.__spiralTangential === true,
          __spiralRoundSeams: spiralRoundSeams === true,
        }));

        retainedPoints._spiroWholeCurveSpline =
          layer.profileMode === 'spline' && layer.wholeCurveSpline === true;
        let retainedCubics =
          state.fourierMode === true
            ? []
            : buildSpiralBezierSegments(
                retainedPoints,
                0,
                cornerFlags,
                layer.profileMode === 'spline' && layer.wholeCurveSpline === true,
              );
        if (bakedProfileRound && retainedCubics?.length)
          retainedCubics = repairRoundedSpiralBezierJoins(retainedCubics);
        if (retainedCubics?.length) {
          retainedPoints._spiroRetainedCubics = retainedCubics;
          retainedPoints._spiroRetainedProfileCarrier = true;
        }
        paths.push({
          points: retainedPoints,
          _bezierSegments: retainedCubics?.length ? retainedCubics : null,
          spiralRetainedProfileCarrier: Boolean(retainedCubics?.length),
          closed: false,
          cornerFlags,
          lampCornerFlags,
          spiralProfileRoundingBaked: true,
          spiralProfileSplineBaked: true,
          spiralProfileSpaceSplineBaked: spiralProfileData?.profileSpaceSplineBaked === true,
          spiralPolygonProfileSplineCarrier: spiralProfileData?.polygonProfileSplineCarrier === true,
          spiralProfileSourceCubicCount: Number(spiralProfileData?.profileSourceCubicCount) || 0,
          spiralContinuityProtected: spiralClosed === true && !carrier?.directLayerwise,
          spiralExplicitBridge:
            spiralClosed === true &&
            !carrier?.coordinatedSpine &&
            !carrier?.directLayerwise &&
            !carrier?.cloneTransport &&
            !carrier?.unfoldUntwisted,
          ...(carrier ? { spiralEdgeIndex } : {}),
          spiralBranchIndex: Number.isFinite(Number(P[spiralEdgeIndex]?.polygonIndex))
            ? Number(P[spiralEdgeIndex].polygonIndex)
            : spiralEdgeIndex,
          orbitIndex: sIdx,
          ...profileMeta,
          ...((carrier?.spiralEdgeLife?.[spiralEdgeIndex] ?? 1) < 1
            ? { _alpha: (carrier.alpha ?? 1) * carrier.spiralEdgeLife[spiralEdgeIndex] }
            : {}),
          topoCircleCarrier: false,
          ...(carrier
            ? { strokeGrowth: carrier.strokeGrowth ?? graph?.referenceEdges?.[spiralEdgeIndex]?.profileLife }
            : {}),
        });
      }
      continue;
    }

    if (!planarClosed) {
      for (const e of edges)
        if (e.length >= 2)
          paths.push({
            points: e,
            closed: false,
            cornerFlags: e.map((p) => interiorCorner(p.ptIdx)),
            orbitIndex: sIdx,
            ...profileMeta,
          });
      continue;
    }
    if (!isBroken) {
      const polyPoints = [];
      for (const e of edges) {
        for (let j = 0; j < e.length - 1; j++) polyPoints.push(e[j]);
      }
      if (polyPoints.length < 2) continue;
      const cornerFlags = polyPoints.map((p) =>
        layer.profileMode === 'segments'
          ? p.ptIdx === 0 || Boolean(profileCornerFlags[p.ptIdx])
          : p.ptIdx === 0,
      );
      paths.push({
        points: polyPoints.map(({ x, y }) => ({ x, y })),
        closed: true,
        cornerFlags,
        orbitIndex: sIdx,
        ...profileMeta,
      });
      continue;
    }

    const polyPoints = [];
    const bridgeJunction = [];
    for (const e of edges) {
      for (let j = 0; j < e.length; j++) {
        polyPoints.push(e[j]);
        bridgeJunction.push(j === 0 || j === e.length - 1);
      }
    }
    if (polyPoints.length < 2) continue;

    const cornerFlags = polyPoints.map(
      (p, i) =>
        interiorCorner(p.ptIdx) ||
        (smoothSplineRenderer ? bridgeJunction[i] : roundedJoin && bridgeJunction[i]),
    );

    // Only authored bridge junctions carry an explicit yes/no
    // policy. Ordinary interior profile corners use null, so a
    // straight bridge cannot disable their rounding.
    const bridgeRoundFlags = polyPoints.map((p, i) => (bridgeJunction[i] ? roundedJoin : null));
    paths.push({
      points: polyPoints.map(({ x, y }) => ({ x, y })),
      closed: true,
      cornerFlags,
      bridgeRoundFlags,
      orbitIndex: sIdx,
      ...profileMeta,
    });
  }
  // Metadata stays on the canonical path set. Neither profile nor
  // GPU renderers are allowed to modify these raw straight edges.
  Object.defineProperty(paths, '__somataSkeletonOrbits', {
    value: skeletonOrbits,
    configurable: true,
    enumerable: false,
  });
  Object.defineProperty(paths, '__somataSkeletonGraphs', {
    value: skeletonGraphs,
    configurable: true,
    enumerable: false,
  });
  if (!polygonFrame && spiralEnabled)
    applySpiralSquashY(paths, skeletonGraphs, spiralSquashYFactor(layer.spiralSquashY, spiralOrder));
  return paths;
}

export {
  applySpiralSquashY,
  buildOrbitPolylines,
  buildPolygonProfilePathsFromSkeleton,
  normalizeSpiralSquashY,
  spiralSquashYFactor,
};
