// Спираль: наложение профиля на ребро и на несущую, общий кэш профиля, путь несущей.
import './profile-prep.js'; // initialisation order: this module runs after it
import { getRoundingStrength } from '../../core/palette.js';
import { isPreSampledSplineLayer } from '../../core/render-runtime.js';
import { state } from '../../core/state.js';
import { getEffectiveLayerRadius } from '../../effects/motion.js';
import { getConfiguredSplinePointCount, getInterpolatedProfilePoints } from '../profile-model.js';
import { buildClosedSpiralAutoCloseGeometry } from './fillets.js';
import { buildSpiralBezierSegments, repairRoundedSpiralBezierJoins } from './bezier-carrier.js';
import {
  getEffectiveSpiralOrder,
  getEffectiveSpiralStep,
  getSpiralAngularVertexCount,
  getSpiralClosureRatio,
  normalizeSpiralOrder,
  normalizeSpiralStep,
  spiralDirection,
  spiralRadialExponent,
} from './order-params.js';
import {
  applySpiralFinalSpaceProfileRounding,
  buildSpiralProfileForDraw,
  getSpiralRenderSampleCount,
  getSpiralTangentialBlend,
  rotateSpiralPoint,
  segmentProfileCornerFlags,
  validateSpiralEdgePoints,
} from './profile-prep.js';

function mapProfileOntoSpiralEdge(
  profilePts,
  P,
  edgeIndex,
  R,
  order,
  tangential = false,
  out = null,
  spiralStep = 1,
  polygonN = null,
  spiralClosed = true,
  roundingFrac = 0,
  directionOverride = null,
  exponentOverride = null,
  primaryGraph = null,
  profileReveal = 1,
  twist = 1,
) {
  const spiralOrder = normalizeSpiralOrder(order, false);
  if (
    !Array.isArray(profilePts) ||
    profilePts.length < 2 ||
    !Array.isArray(P) ||
    P.length < (primaryGraph?.referenceEdges?.[edgeIndex] ? 1 : 2)
  )
    return [];
  const N = Math.max(2, Number(polygonN) || P.length);
  const step = normalizeSpiralStep(spiralStep, N);
  const authoredDirection = spiralDirection(spiralOrder);

  const hasDirectionOverride =
    directionOverride !== null &&
    directionOverride !== undefined &&
    Number.isFinite(Number(directionOverride));
  const hasExponentOverride =
    exponentOverride !== null && exponentOverride !== undefined && Number.isFinite(Number(exponentOverride));
  const direction = hasDirectionOverride
    ? Math.max(-1, Math.min(1, Number(directionOverride)))
    : authoredDirection * Math.min(1, Math.abs(spiralOrder));
  const exponent = hasExponentOverride
    ? Math.max(0, Number(exponentOverride))
    : spiralRadialExponent(spiralOrder);
  const delta = ((Math.PI * 2 * step) / N) * direction;
  const windingT = Math.min(1, Math.abs(spiralOrder));
  const windingWeight = windingT * windingT * (3 - 2 * windingT);
  const targetScale = Math.pow(Math.max(1.0000001, getSpiralClosureRatio()), exponent * windingWeight);
  const points = out || [];
  while (points.length < profilePts.length) points.push({ x: 0, y: 0 });
  if (points.length > profilePts.length) points.length = profilePts.length;
  const skeleton = window.SomataSkeletonRuntime;
  const skeletonSampler = skeleton?.sampleGraphEdge;
  const carrierGraph =
    primaryGraph ||
    skeleton?.createGraph?.(0, P, {
      spiralOrder: order,
      spiralStep: step,
      spiralAngularN: N,
      twist,
      referenceDelta: delta,
      radialScale: Math.pow(Math.max(1.0000001, getSpiralClosureRatio()), exponent),
      connectEdges: spiralClosed !== false,
    });
  // Tangential rounding belongs to the derived spline, never to
  // primary vertex placement. Both endpoints remain graph nodes.
  const derivedCarrier = (index, u, graph = carrierGraph) => {
    const base = skeletonSampler?.(graph, index, u);
    if (!base) return null;
    const blend = Math.max(0, Math.min(1, Number(tangential) || 0)) * windingWeight * profileReveal;
    if (blend <= 1e-8) return base;
    const ring = graph.edgeSamples,
      idx = ((index % ring.length) + ring.length) % ring.length;
    const a = ring[idx][0],
      b = ring[idx][1],
      count = ring.length;
    const periodic = graph.connected && Math.abs(graph.order) < 1e-8;
    const prev = idx > 0 ? ring[idx - 1][0] : periodic ? ring[count - 1][0] : null;
    const next = idx + 1 < count ? ring[idx + 1][1] : periodic ? ring[0][1] : null;
    const dx = b.x - a.x,
      dy = b.y - a.y;
    const authoredTangents = graph.splineTangents?.[idx];
    const m0 =
      authoredTangents?.start ||
      (prev ? { x: (b.x - prev.x) * 0.5, y: (b.y - prev.y) * 0.5 } : { x: dx, y: dy });
    const m1 =
      authoredTangents?.end ||
      (next ? { x: (next.x - a.x) * 0.5, y: (next.y - a.y) * 0.5 } : { x: dx, y: dy });
    const t = Number(u) || 0;
    const spline =
      t < 0
        ? { x: a.x + m0.x * t, y: a.y + m0.y * t, tx: m0.x, ty: m0.y }
        : t > 1
          ? { x: b.x + m1.x * (t - 1), y: b.y + m1.y * (t - 1), tx: m1.x, ty: m1.y }
          : (() => {
              const t2 = t * t,
                t3 = t2 * t;
              const h00 = 2 * t3 - 3 * t2 + 1,
                h10 = t3 - 2 * t2 + t,
                h01 = -2 * t3 + 3 * t2,
                h11 = t3 - t2;
              const dh00 = 6 * t2 - 6 * t,
                dh10 = 3 * t2 - 4 * t + 1,
                dh01 = -6 * t2 + 6 * t,
                dh11 = 3 * t2 - 2 * t;
              return {
                x: h00 * a.x + h10 * m0.x + h01 * b.x + h11 * m1.x,
                y: h00 * a.y + h10 * m0.y + h01 * b.y + h11 * m1.y,
                tx: dh00 * a.x + dh10 * m0.x + dh01 * b.x + dh11 * m1.x,
                ty: dh00 * a.y + dh10 * m0.y + dh01 * b.y + dh11 * m1.y,
              };
            })();
    return {
      x: base.x + (spline.x - base.x) * blend,
      y: base.y + (spline.y - base.y) * blend,
      tx: base.tx + (spline.tx - base.tx) * blend,
      ty: base.ty + (spline.ty - base.ty) * blend,
    };
  };
  const [edgeStart, edgeEnd] = carrierGraph?.edgeSamples?.[edgeIndex] ?? [];
  const [chainStart, chainEnd] = carrierGraph?.legacy?.edgeSamples?.[edgeIndex] ?? [edgeStart, edgeEnd];
  const amplitude =
    chainStart && chainEnd ? 0.5 * Math.hypot(chainEnd.x - chainStart.x, chainEnd.y - chainStart.y) : 0;
  const reference = carrierGraph?.referenceEdges?.[edgeIndex];
  const refWeight = reference ? carrierGraph.referenceWeight : 0;
  const metaDelta = reference ? delta + (reference.delta - delta) * refWeight : delta;
  const metaScale = reference ? targetScale + (reference.targetScale - targetScale) * refWeight : targetScale;
  const evalMapped = (prof) => {
    const u = Number(prof?.x) || 0;
    let base = refWeight === 1 ? null : derivedCarrier(edgeIndex, u, carrierGraph?.legacy ?? carrierGraph);
    if (reference) {
      const direct = carrierGraph.directLayerwiseWeight;
      const ref = skeleton.sampleReferenceEdge(
        carrierGraph,
        edgeIndex,
        u,
        Number.isFinite(direct) ? Number(tangential) * direct : tangential,
      );
      const w = refWeight,
        lerp = (a, b, t) => a + (b - a) * t;
      const startX = base ? lerp(chainStart.x, ref.startX, w) : ref.startX;
      const startY = base ? lerp(chainStart.y, ref.startY, w) : ref.startY;
      const endX = base ? lerp(chainEnd.x, ref.endX, w) : ref.endX;
      const endY = base ? lerp(chainEnd.y, ref.endY, w) : ref.endY;
      const sx = edgeStart.x - startX,
        sy = edgeStart.y - startY;
      const ex = edgeEnd.x - endX,
        ey = edgeEnd.y - endY;
      base = {
        x: (base ? lerp(base.x, ref.x, w) : ref.x) + lerp(sx, ex, u),
        y: (base ? lerp(base.y, ref.y, w) : ref.y) + lerp(sy, ey, u),
        tx: (base ? lerp(base.tx, ref.tx, w) : ref.tx) + ex - sx,
        ty: (base ? lerp(base.ty, ref.ty, w) : ref.ty) + ey - sy,
      };
    }
    if (!base) return { x: 0, y: 0, widthScale: 1, baseTx: 0, baseTy: 0 };
    let tx = Number(base.tx) || 0,
      ty = Number(base.ty) || 0,
      len = Math.hypot(tx, ty);
    if (len < 1e-9) {
      tx = 1;
      ty = 0;
      len = 1;
    }
    const nx = -ty / len,
      ny = tx / len;
    const stations = carrierGraph.windingStations;
    const orbitU = stations
      ? stations[edgeIndex] + ((stations[edgeIndex + 1] ?? 1) - stations[edgeIndex]) * u
      : (edgeIndex + u) / Math.max(1, carrierGraph.edgeSamples.length);
    const chainScale = Math.pow(targetScale, Math.max(-2, Math.min(3, orbitU)));
    const referenceU = Math.max(-2, Math.min(3, u));
    const referenceScale = reference ? Math.pow(reference.targetScale, referenceU) : 1;
    const visibleReferenceScale = Number.isFinite(carrierGraph.directLayerwiseWeight)
      ? Math.pow(carrierGraph.radialScale ?? 1, referenceU)
      : referenceScale;
    const localScale = chainScale * (1 - refWeight) + visibleReferenceScale * refWeight;
    const authoredAmp =
      (Number(R) || 0) * 0.5 * referenceScale * profileReveal * (reference?.profileLife ?? 1);
    const blendAmp = carrierGraph.directLayerwiseWeight ?? 1;
    const amp = amplitude + (authoredAmp - amplitude) * refWeight * blendAmp;
    return {
      x: base.x + (Number(prof?.y) || 0) * amp * nx,
      y: base.y + (Number(prof?.y) || 0) * amp * ny,
      widthScale: localScale,
      baseTx: Number(base.tx) || 0,
      baseTy: Number(base.ty) || 0,
    };
  };
  for (let j = 0; j < profilePts.length; j++) {
    const prof = profilePts[j] || { x: 0, y: 0 },
      m = evalMapped(prof),
      p = points[j];
    p.x = m.x;
    p.y = m.y;
    p.widthScale = m.widthScale;
    p.ptIdx = j;
    p.__profileCorner = prof.__profileCorner === true || prof.__profileKeyCorner === true;

    p.__spiralBaseTx = m.baseTx;
    p.__spiralBaseTy = m.baseTy;
    p.__spiralDelta = metaDelta;
    p.__spiralTargetScale = metaScale;
    p.__spiralClosed = spiralClosed !== false;
    p.__spiralTangential = (Number(tangential) || 0) > 0;
    p.__spiralTangentialMix =
      typeof tangential === 'boolean'
        ? tangential
          ? 1
          : 0
        : Math.max(0, Math.min(1, Number(tangential) || 0));
    delete p.__spiralBezierInTx;
    delete p.__spiralBezierInTy;
    delete p.__spiralBezierOutTx;
    delete p.__spiralBezierOutTy;
    delete p.__spiralBezierC1X;
    delete p.__spiralBezierC1Y;
    delete p.__spiralBezierC2X;
    delete p.__spiralBezierC2Y;
  }

  const h = 1e-3;
  for (let j = 0; j < profilePts.length - 1; j++) {
    const a = profilePts[j] || { x: 0, y: 0 },
      b = profilePts[j + 1] || a;
    const c1x = Number(a?.__profileBezierC1X),
      c1y = Number(a?.__profileBezierC1Y),
      c2x = Number(a?.__profileBezierC2X),
      c2y = Number(a?.__profileBezierC2Y);
    const hasProfileCubic =
      Number.isFinite(c1x) && Number.isFinite(c1y) && Number.isFinite(c2x) && Number.isFinite(c2y);
    const profileAt = (t) => {
      const u = Math.max(0, Math.min(1, Number(t) || 0)),
        v = 1 - u;
      if (!hasProfileCubic)
        return {
          x: (Number(a.x) || 0) + ((Number(b.x) || 0) - (Number(a.x) || 0)) * u,
          y: (Number(a.y) || 0) + ((Number(b.y) || 0) - (Number(a.y) || 0)) * u,
        };
      return {
        x:
          v * v * v * (Number(a.x) || 0) +
          3 * v * v * u * c1x +
          3 * v * u * u * c2x +
          u * u * u * (Number(b.x) || 0),
        y:
          v * v * v * (Number(a.y) || 0) +
          3 * v * v * u * c1y +
          3 * v * u * u * c2y +
          u * u * u * (Number(b.y) || 0),
      };
    };
    const at = (t) => evalMapped(profileAt(t));
    const ph = at(h),
      qh = at(1 - h),
      s1 = at(1 / 3),
      s2 = at(2 / 3),
      p0 = points[j],
      p1 = points[j + 1],
      inv = 1 / h;
    p0.__spiralProfileSourceCubic = hasProfileCubic;
    p0.__spiralBezierOutTx = (ph.x - p0.x) * inv;
    p0.__spiralBezierOutTy = (ph.y - p0.y) * inv;
    p1.__spiralBezierInTx = (p1.x - qh.x) * inv;
    p1.__spiralBezierInTy = (p1.y - qh.y) * inv;

    const ax = 27 * s1.x - 8 * p0.x - p1.x,
      ay = 27 * s1.y - 8 * p0.y - p1.y;
    const bx = 27 * s2.x - p0.x - 8 * p1.x,
      by = 27 * s2.y - p0.y - 8 * p1.y;
    p0.__spiralBezierC1X = (2 * ax - bx) / 18;
    p0.__spiralBezierC1Y = (2 * ay - by) / 18;
    p0.__spiralBezierC2X = (2 * bx - ax) / 18;
    p0.__spiralBezierC2Y = (2 * by - ay) / 18;
  }

  return points;
}
// 7.6.4: one carrier/profile constructor for both static and Morph Spiral; static and Morph also share closure and post-fillet tangent cleanup.
// Static Spiral still calls mapProfileOntoSpiralEdge(); Morph supplies the
// interpolated key anchor and the interpolated carrier (delta + radial scale)
// explicitly.  The authored line profile is therefore never morphed in
// already-mapped screen space.
function getSpiralCarrierSpec(layer, branchIndex = 0) {
  const N = getSpiralAngularVertexCount(layer);
  const R = getEffectiveLayerRadius(layer, 220);
  const rotation = ((Number(layer?.rotation) || 0) * Math.PI) / 180;
  const bi = Number.isFinite(Number(branchIndex)) ? Number(branchIndex) : 0;
  const angle = (bi / N) * Math.PI * 2 + rotation - Math.PI / 2;
  const order = getEffectiveSpiralOrder(layer);
  const twist = layer?.spiralTwist === true ? 1 : 0;
  const direction = spiralDirection(order) || 1;
  const step = getEffectiveSpiralStep(layer);
  const delta = ((Math.PI * 2 * step) / N) * direction;
  const targetScale = Math.pow(Math.max(1.0000001, getSpiralClosureRatio()), spiralRadialExponent(order));
  return {
    anchor: { x: R * Math.cos(angle), y: R * Math.sin(angle) },
    radius: R,
    N,
    step,
    order,
    direction,
    twist,
    delta,
    targetScale,
    logScale: Math.log(Math.max(1e-9, targetScale)),
    tangential: getSpiralTangentialBlend(layer),
    closed: layer?.spiralClosed !== false,
    roundSeams: layer?.spiralRoundSeams !== false,
  };
}
function mapProfileOntoSpiralCarrier(profilePts, anchor, R, carrierSpec = {}, out = null) {
  const a = { x: Number(anchor?.x) || 0, y: Number(anchor?.y) || 0 };
  const delta = Number(carrierSpec?.delta) || 0;
  const targetScale = Math.max(1e-9, Number(carrierSpec?.targetScale) || 1);
  const direction = delta < 0 ? -1 : 1;
  const pseudoN = 2;
  const pseudoStep = (Math.abs(delta) * pseudoN) / (Math.PI * 2);
  const ratio = Math.max(1.0000001, getSpiralClosureRatio());
  const exponent = Math.max(0, Math.log(targetScale) / Math.log(ratio));
  // A Morph carrier owns precisely two skeleton nodes. No extra
  // closing polygon edge or curve-sampled pseudo-vertices are allowed.
  const endpoint = rotateSpiralPoint(a, delta, targetScale);
  const P = [a, endpoint];
  const reference = carrierSpec?.reference132 === true;
  const graph = window.SomataSkeletonRuntime?.createGraph?.(
    0,
    P,
    reference
      ? {
          spiralOrder: 1,
          referenceWeight: 1,
          referenceDelta: delta,
          radialScale: targetScale,
          openCarrier: true,
          connectEdges: false,
        }
      : { spiralOrder: 0, openCarrier: true, connectEdges: false },
  );
  if (graph && !reference) {
    const logScale = Math.log(targetScale);
    graph.splineTangents = [
      {
        start: { x: logScale * a.x - delta * a.y, y: logScale * a.y + delta * a.x },
        end: { x: logScale * endpoint.x - delta * endpoint.y, y: logScale * endpoint.y + delta * endpoint.x },
      },
    ];
  }
  return mapProfileOntoSpiralEdge(
    profilePts,
    P,
    0,
    R,
    1,
    carrierSpec?.tangential ?? 0,
    out,
    pseudoStep,
    pseudoN,
    carrierSpec?.closed !== false,
    Math.max(0, Number(carrierSpec?.roundingFrac) || 0),
    direction,
    exponent,
    graph,
  );
}
// 7.7 performance: profile preparation is branch-invariant.  A Spiral frame may
// contain many branches/corridor rails, but the authored profile, spline sampling and
// compact segment layout are identical for every branch.  Preparing them once per
// layer/frame avoids repeating the expensive profile sampler N times.
const spiralCarrierProfilePrepStats = {
  prepares: 0,
  reuses: 0,
  sharedHits: 0,
  sharedMisses: 0,
  lastTargetCount: 0,
  lastPointCount: 0,
};
// Bounded cross-layer memo. Many Spiral layers reuse the same authored
// profile and compact segment layout. Rebuilding that normalized profile
// for every branch/layer creates large main-thread stalls. The key uses
// actual numeric profile coordinates and every input read by
// buildSpiralProfileForDraw, not transient layer object identity.
const spiralSharedProfileCache = new Map(),
  SPIRAL_PROFILE_CACHE_LIMIT = 64;
function spiralSharedProfileSignature(layer, points, target, round, sampled) {
  const mode = String(layer?.profileMode || '');
  const parts = [mode, target, round, sampled ? 1 : 0];
  if (mode === 'segments') {
    parts.push(getSpiralAngularVertexCount(layer), getEffectiveSpiralStep(layer));
  }
  if (sampled) parts.push((layer?.__lampLogicalCornerFlags || []).map((x) => (x ? 1 : 0)).join(''));
  for (const p of points) {
    parts.push(
      Number(p?.x) || 0,
      Number(p?.y) || 0,
      p?.__profileCorner === true ? 1 : 0,
      p?.__profileKeyCorner === true ? 1 : 0,
    );
  }
  return parts.join('|');
}
function prepareSpiralCarrierProfile(layer, carrierSpec = {}) {
  if (!layer) return null;
  const smoothSplineMode = layer.profileMode === 'spline';
  const splineSnapshotAlreadySampled = smoothSplineMode && isPreSampledSplineLayer(layer);
  const profileSpaceSplineAlreadySampled = smoothSplineMode && splineSnapshotAlreadySampled;
  const baseProfilePts =
    Array.isArray(carrierSpec?.profileNodes) && carrierSpec.profileNodes.length >= 2
      ? carrierSpec.profileNodes.map((p) => ({ x: Number(p?.x) || 0, y: Number(p?.y) || 0 }))
      : smoothSplineMode && Array.isArray(layer.profileNodes) && layer.profileNodes.length >= 2
        ? layer.profileNodes.map((p) => ({ x: Number(p?.x) || 0, y: Number(p?.y) || 0 }))
        : getInterpolatedProfilePoints(layer);
  const spiralRounding = Math.max(
    0,
    Number.isFinite(Number(carrierSpec?.roundingFrac))
      ? Number(carrierSpec.roundingFrac)
      : getRoundingStrength(layer.rounding),
  );
  const targetCount = Math.max(
    baseProfilePts.length,
    Math.round(
      Number(carrierSpec?.profileTargetCount) ||
        getSpiralRenderSampleCount(layer, Math.max(baseProfilePts.length, getConfiguredSplinePointCount())),
    ),
  );
  const sampled = carrierSpec?.profileSpaceSplineAlreadySampled === true || profileSpaceSplineAlreadySampled;
  // Do not cache non-finite/invalid editing inputs. The memo is exact
  // and bounded even when every phase animates a unique profile.
  const canShare =
    (carrierSpec?.forceSharedProfile === true || layer?.__spiralSharedProfileAcrossLayers === true) &&
    baseProfilePts.length <= 256 &&
    baseProfilePts.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  const sig = canShare
    ? spiralSharedProfileSignature(layer, baseProfilePts, targetCount, spiralRounding, sampled)
    : null;
  if (sig && spiralSharedProfileCache.has(sig)) {
    const hit = spiralSharedProfileCache.get(sig);
    spiralSharedProfileCache.delete(sig);
    spiralSharedProfileCache.set(sig, hit);
    spiralCarrierProfilePrepStats.sharedHits++;
    return hit;
  }
  const profileData = buildSpiralProfileForDraw(layer, baseProfilePts, targetCount, spiralRounding, sampled);
  spiralCarrierProfilePrepStats.prepares++;
  spiralCarrierProfilePrepStats.sharedMisses++;
  spiralCarrierProfilePrepStats.lastTargetCount = targetCount;
  spiralCarrierProfilePrepStats.lastPointCount = profileData?.points?.length || 0;
  const result = {
    baseProfilePts,
    spiralRounding,
    targetCount,
    profileData,
    profilePts: profileData?.points || [],
    profileSpaceSplineAlreadySampled,
  };
  if (sig) {
    spiralSharedProfileCache.set(sig, result);
    if (spiralSharedProfileCache.size > SPIRAL_PROFILE_CACHE_LIMIT)
      spiralSharedProfileCache.delete(spiralSharedProfileCache.keys().next().value);
  }
  return result;
}
window.__spiroPrepareSpiralCarrierProfile = prepareSpiralCarrierProfile;
function buildSpiralCarrierPath(layer, anchor, carrierSpec = {}) {
  if (!layer || !anchor) return null;
  const R = Math.max(1, Number(carrierSpec?.radius) || getEffectiveLayerRadius(layer, 220));
  const prepared =
    carrierSpec?.preparedProfile && Array.isArray(carrierSpec.preparedProfile.profilePts)
      ? carrierSpec.preparedProfile
      : prepareSpiralCarrierProfile(layer, carrierSpec);
  if (!prepared) return null;
  if (carrierSpec?.preparedProfile === prepared) spiralCarrierProfilePrepStats.reuses++;
  const baseProfilePts = prepared.baseProfilePts,
    spiralRounding = prepared.spiralRounding,
    profileData = prepared.profileData,
    profilePts = prepared.profilePts;
  if (!Array.isArray(profilePts) || profilePts.length < 2) return null;
  const tangential = Math.max(0, Math.min(1, Number(carrierSpec?.tangential) || 0));
  const spiralClosed = carrierSpec?.closed !== false;
  const roundSeams = spiralClosed && carrierSpec?.roundSeams !== false;
  const delta = Number(carrierSpec?.delta) || 0;
  const targetScale = Math.max(1e-9, Number(carrierSpec?.targetScale) || 1);
  const reference132 = layer.spiralTwist !== true;
  let mapped = mapProfileOntoSpiralCarrier(profilePts, anchor, R, {
    delta,
    targetScale,
    tangential,
    closed: false,
    roundingFrac: 0,
    reference132,
  });
  const rawMapped = mapped;
  if (layer.profileMode === 'segments' && spiralRounding > 0.001)
    mapped = applySpiralFinalSpaceProfileRounding(mapped, spiralRounding);
  let rawVisible = mapped,
    visible = mapped;
  if (spiralClosed) {
    // Same mapped profile as the open Spiral; only the authored bridge differs.
    mapped = mapped.map((p) => ({ ...p, __spiralClosed: true }));
    // The sharp closure is only a fallback when the rounded closure
    // fails validation. Do not construct and allocate both rails on
    // every good rounded Spiral frame; the visible rail stays identical.
    if (roundSeams) {
      visible = buildClosedSpiralAutoCloseGeometry(mapped, spiralRounding, true);
      rawVisible = null;
    } else {
      rawVisible = buildClosedSpiralAutoCloseGeometry(mapped, 0, false);
      visible = rawVisible;
    }
  }
  let validity = validateSpiralEdgePoints(visible);
  if (!validity.ok) {
    if (rawVisible === null) rawVisible = buildClosedSpiralAutoCloseGeometry(mapped, 0, false);
    validity = validateSpiralEdgePoints(rawVisible);
    if (validity.ok) visible = rawVisible;
    else {
      const fallback = mapProfileOntoSpiralCarrier(
        [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
        ],
        anchor,
        R,
        { delta, targetScale, tangential, closed: spiralClosed, roundingFrac: 0, reference132 },
      );
      visible = spiralClosed ? buildClosedSpiralAutoCloseGeometry(fallback, 0, false) : fallback;
    }
  }
  const retainedPoints = visible.map((srcPoint) => ({
    ...srcPoint,
    x: Number(srcPoint?.x) || 0,
    y: Number(srcPoint?.y) || 0,
    widthScale: Math.max(0.02, Number(srcPoint?.widthScale) || 1),
    ptIdx: Number.isFinite(Number(srcPoint?.ptIdx)) ? Number(srcPoint.ptIdx) : undefined,
    __spiralDelta: delta,
    __spiralTargetScale: targetScale,
    __spiralClosed: spiralClosed,
    __spiralTangential: tangential > 0,
    __spiralTangentialMix: tangential,
    __spiralRoundSeams: roundSeams,
  }));
  retainedPoints._spiroWholeCurveSpline = layer.profileMode === 'spline' && layer.wholeCurveSpline === true;
  const bakedProfileRound = layer.profileMode === 'segments' && spiralRounding > 0.001;
  const profileCornerFlags =
    layer.profileMode === 'segments' ? segmentProfileCornerFlags(profilePts) : profilePts.map(() => false);
  const cornerFlags = retainedPoints.map((p, idx) =>
    bakedProfileRound
      ? false
      : Boolean(p.__profileCorner) ||
        Boolean(profileCornerFlags[Number.isFinite(Number(p?.ptIdx)) ? Number(p.ptIdx) : idx]) ||
        (layer.profileMode === 'spline' &&
          layer.wholeCurveSpline !== true &&
          Boolean(profileData?.keyFlags?.[Number.isFinite(Number(p?.ptIdx)) ? Number(p.ptIdx) : idx])),
  );
  const lampFlags = profileData?.keyFlags || profilePts.map(() => false);
  const lampCornerFlags = retainedPoints.map((p, idx) =>
    Boolean(lampFlags[Number.isFinite(Number(p?.ptIdx)) ? Number(p.ptIdx) : idx]),
  );
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
  return {
    points: retainedPoints,
    _bezierSegments: retainedCubics?.length ? retainedCubics : null,
    spiralRetainedProfileCarrier: Boolean(retainedCubics?.length),
    closed: false,
    cornerFlags,
    lampCornerFlags,
    spiralProfileRoundingBaked: true,
    spiralProfileSplineBaked: true,
    spiralProfileSpaceSplineBaked: profileData?.profileSpaceSplineBaked === true,
    spiralPolygonProfileSplineCarrier: profileData?.polygonProfileSplineCarrier === true,
    spiralProfileSourceCubicCount: Number(profileData?.profileSourceCubicCount) || 0,
    spiralContinuityProtected: spiralClosed === true,
    spiralExplicitBridge: spiralClosed === true,
    spiralBranchIndex: Number.isFinite(Number(carrierSpec?.branchIndex))
      ? Number(carrierSpec.branchIndex)
      : 0,
    orbitIndex: Number(carrierSpec?.orbitIndex) || 0,
    __carrierMapped: true,
    __carrierAnchor: { x: Number(anchor.x) || 0, y: Number(anchor.y) || 0 },
    __carrierDelta: delta,
    __carrierTargetScale: targetScale,
    __rawMapped: rawMapped,
  };
}
window.__spiroGetSpiralCarrierSpec = getSpiralCarrierSpec;
window.__spiroMapProfileOntoSpiralCarrier = mapProfileOntoSpiralCarrier;
window.__spiroBuildSpiralCarrierPath = buildSpiralCarrierPath;

export { mapProfileOntoSpiralEdge };
