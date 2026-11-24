import '../morph-runtime/manual-interpolation.js'; // initialisation order: this module runs after it
import { fillBoundaryWindow, fillGhostWeight, fillSplitAheadWeight } from '../morph-runtime/blue/fill-lookahead.js';
import { MAX_ROUNDING_PERCENT, getRoundingStrength, interpolateMorphRounding } from '../core/palette.js';
import { runtimeState, somataWithFourierLayer, state } from '../core/state.js';
import { buildPolygonProfilePathsFromSkeleton } from '../geometry/orbit-builder.js';
import { isPreSampledSplineLayer, setPreSampledSplineLayer } from '../core/render-runtime.js';
import { splinePathForDraw } from '../geometry/spline-rounding.js';
import { getEffectiveLayerRadius } from '../effects/motion.js';
import { createLampRenderedPathSampler } from '../lamps/lamp-anchors.js';
import { fillCanvasGeometry } from '../core/defaults-layers.js';
import { isFlatProfileNodes, smoothPreSampledSplinePoints, useSmoothSplinePath } from '../geometry/profile-model.js';
import { strokeVariableWidthSpiralPath } from './spiral-stroke.js';
import {
  getEffectiveSpiralOrder,
  getEffectiveSpiralStep,
  getSpiralAngularVertexCount,
  isSpiralLayer,
  normalizeSpiralOrder,
} from '../geometry/spiral/order-params.js';
import { roundPolylineForDraw } from '../geometry/polyline-rounding.js';
import {
  applyProfileToVertexRing,
  recordExactPolygonSplinePath,
  profileCubicKnotFractions,
  profileCubicPartition,
  completeLiveMorphCornerFlags,
  drawExactPolygonSplineProfileMorph,
  drawExactPolygonSplineProfileMorph27,
  drawFittedMonoradiusAnchorMorph,
  drawMorphConstructionGuide,
  drawMorphGeometry,
  drawMorphPathQuality,
  drawRoundedSegmentProfileMorphFrame,
  drawRoundingOnlyMorphFrame,
  drawRoundingPolicyMorphFrame,
  getCircleMorphPlan,
  getMorphClosureTransitionPlan,
  interpolateMorphProfile,
  isAuthoredProfileTransitionPair,
  isMixedSplineSegmentTransition,
  isRoundedSegmentProfileMorphPair,
  isRoundingOnlyMorphPair,
  isRoundingPolicyOnlyMorphPair,
  legacyFilletDrawCorrected,
  liveSplineSeamMix,
  morphFilletRecoveryMix,
  morphSplineBlend,
  resolveExactPolygonMorphEndpoint,
  resolveMorphProfileModeForRender,
  roundMorphPolyline,
} from '../geometry/morph.js';
import { getEffectiveCircleSlideType } from '../morph-runtime/morph-mode.js';

// Заливка морфа: «лишние» контуры слияния/разделения орбит и дубли разделения следующей фазы
// (план из Blue: targetLayer.__fillSplitAhead — сколько дублей получит каждая орбита цели,
// sourceLayer.__fillSplitDone — разделение этой фазы уже введено в заливку заранее).
function setMorphFillGhost(ctx, pp, plan, t, sourceLayer, targetLayer) {
  ctx.__fillGhost = fillGhostWeight(t, {
      window: fillBoundaryWindow(state.morph),
    sourcePresent: pp.sourcePathPresent,
    targetPresent: pp.targetPathPresent,
    splitDone: sourceLayer?.__fillSplitDone === true,
  });
  const ahead = targetLayer?.__fillSplitAhead;
  const j = plan.pathPlans.indexOf(pp);
  const dup = Array.isArray(ahead) && pp.targetPathPresent !== false ? Number(ahead[j]) || 0 : 0;
  ctx.__fillDup = dup > 0 ? dup : 0;
  ctx.__fillDupWeight = dup > 0 ? fillSplitAheadWeight(t, fillBoundaryWindow(state.morph)) : 0;
}
function clearMorphFillGhost(ctx) {
  ctx.__fillGhost = undefined;
  ctx.__fillDup = 0;
  ctx.__fillDupWeight = 0;
}

function sampleMorphPolygonVertex(mode, pp, i, t, r, source, target, movement) {
  const rule = window.SomataMorphRegistry.get(mode === 'topoCircleOpacity' ? 'topoCircle' : mode);
  if (rule?.polygonVertex && (SomataMorphRegistry.usesCoordinatedSpine(rule.id) || rule.id === 'topoCircle'))
    return rule.polygonVertex(pp, i, t, r, source, target, movement);
  return (movement === 'linear' ? SomataMorphMath.linear : SomataMorphMath.angular)(pp, i, t, r);
}

// Simple: the static profile constructor receives the actual moving graph.
// Blend only the authored profiles on that graph, never the static endpoint
// positions. This is independent of the Spline+ phase-correction machinery.
const simpleAnchorRouteStats = { direct: 0, compatibilityAttempts: 0, last: null };
// Read-only, opt-in inspection; no per-frame console output.
window.__somataSimpleAnchorRouteStatus = () => ({ ...simpleAnchorRouteStats,
  last: simpleAnchorRouteStats.last ? { ...simpleAnchorRouteStats.last } : null });

function drawSimpleAnchorPolygon(ctx, layer, src, dst, t, alpha, slideType, movementMode, mode, mono = false) {
  if (layer?.roundingCornerType !== 'simple' || src?.roundingCornerType !== 'simple' ||
      dst?.roundingCornerType !== 'simple' || !['topology', 'calm', 'circleSlide'].includes(mode) ||
      [layer, src, dst].some(l => isSpiralLayer(l) || l.spiralEnabled || l.chaosStar ||
        l.extendedProfileEnabled || (l.roundingMode === 'monoradius') !== mono || l.closedLoop === false)) return false;
  const a = resolveExactPolygonMorphEndpoint(src), b = resolveExactPolygonMorphEndpoint(dst);
  // Only continuous closed profile rails can be blended one-to-one.
  const continuous = l => {
    const p = l.profileNodes;
    return Array.isArray(p) && p.length >= 2 &&
      Math.hypot(p[0].x - p.at(-1).x + 1, p[0].y - p.at(-1).y) < 0.001;
  };
  if (!continuous(a) || !continuous(b)) return false;
  const plan = getCircleMorphPlan(src, dst, slideType, mode);
  // Multi-orbit birth/merge has independent fill and seam rules. Keep its
  // proven compatibility path until the moving graph can represent it exactly.
  if (plan.pathPlans.length !== 1 || plan.pathPlans.some(p => !p.sourcePathPresent || !p.targetPathPresent)) return false;
  const u = Math.max(0, Math.min(1, Number(t) || 0));
  const r0 = getEffectiveLayerRadius(src, 220), r1 = getEffectiveLayerRadius(dst, r0);
  // Preserve the legacy transport's radius/rounding inputs, including
  // frame-local values for a segment-only phase. No new phase clock.
  const segmentOnly = src.profileMode !== 'spline' && dst.profileMode !== 'spline';
  const R = segmentOnly ? getEffectiveLayerRadius(layer, r0) : r0 + (r1 - r0) * u;
  const round = segmentOnly ? layer.rounding : interpolateMorphRounding(Number(src.rounding) || 0, Number(dst.rounding) || 0, u);
  const mixed = isMixedSplineSegmentTransition(a.profileMode, b.profileMode);
  const weight = u === 0 || u === 1 ? u : mixed ? (a.profileMode === 'spline' ? 1 - morphSplineBlend(a.profileMode, b.profileMode, u)
    : morphSplineBlend(a.profileMode, b.profileMode, u)) : u;
  const style = endpoint => {
    const s = {...layer, ...endpoint, rounding: round, roundingCornerType: 'simple'};
    // Authored knots, rather than Blue's equalized profile grid.
    setPreSampledSplineLayer(s, isPreSampledSplineLayer(endpoint));
    return s;
  };
  // The slots of the angular transport have stable identity. At an endpoint
  // several adjacent slots can represent ONE authored vertex. A short edge
  // between those slots must not suddenly become a full-sized fillet when it
  // disappears. Build the merged topology from the same moving vertices and
  // transfer its influence continuously as the duplicate edges shrink.
  const smooth = x => { const z = Math.max(0, Math.min(1, x)); return z*z*(3-2*z); };
  const mirrorStyle = s => {
    const nodes = s.profileNodes;
    const x = Number(nodes[0].x) + Number(nodes.at(-1).x);
    const y = Number(nodes[0].y) + Number(nodes.at(-1).y);
    const out = {...s, profileNodes: nodes.slice().reverse().map(p => ({...p, x: x-p.x, y: y-p.y}))};
    setPreSampledSplineLayer(out, isPreSampledSplineLayer(s));
    return out;
  };
  const rows = [];
  for (const [i, pp] of plan.pathPlans.entries()) {
    const styles = [style(a), style(b)];
    if (pp.srcReversed) styles[0] = mirrorStyle(styles[0]);
    if (pp.dstReversed) styles[1] = mirrorStyle(styles[1]);
    const sameProfile = styles[0].profileMode === styles[1].profileMode && styles[0].splineRenderMode === styles[1].splineRenderMode &&
      styles[0].wholeCurveSpline === styles[1].wholeCurveSpline && styles[0].lineJoinType === styles[1].lineJoinType &&
      isPreSampledSplineLayer(styles[0]) === isPreSampledSplineLayer(styles[1]) && styles[0].profileNodes.length === styles[1].profileNodes.length &&
      styles[0].profileNodes.every((p, j) => p.x === styles[1].profileNodes[j].x && p.y === styles[1].profileNodes[j].y);
    const vertices = pp.vertexPts;
    for (let j = 0; j < vertices.length; j++)
      Object.assign(vertices[j], sampleMorphPolygonVertex(mode, pp, j, u, R, src, dst, movementMode));
    const count = vertices.length;
    const topologyAt = angles => {
      const same = (j,k) => Math.hypot(Math.cos(angles[j])-Math.cos(angles[k]), Math.sin(angles[j])-Math.sin(angles[k])) < 1e-8;
      const keep = [0], short = [];
      for (let j=1; j<count; j++) {
        if (same(j,j-1)) short.push([j-1,j]);
        else keep.push(j);
      }
      if (same(count-1,0)) {
        short.push([count-1,0]);
        if (keep.length>1 && same(keep.at(-1),0)) keep.pop();
      }
      if (!short.length) return null;
      // Use the endpoint chord scale, not a fixed pixel cutoff. The merge is
      // complete while the collapsing edges still have nonzero length, and
      // cannot jump at an epsilon-based graph cleanup.
      const lengths = keep.map((j,k) => Math.hypot(Math.cos(angles[j])-Math.cos(angles[keep[(k+1)%keep.length]]),
        Math.sin(angles[j])-Math.sin(angles[keep[(k+1)%keep.length]]))).filter(x=>x>1e-8).sort((a,b)=>a-b);
      const reference = Math.max(1e-9, Math.abs(R)* (lengths[Math.floor(lengths.length/2)] || pp.collapseFactor || 1));
      const separation = Math.min(...short.map(([j,k])=>Math.hypot(vertices[j].x-vertices[k].x,vertices[j].y-vertices[k].y)))/reference;
      return { ring: keep.map(j=>vertices[j]), influence: 1-smooth((separation-0.025)/0.475) };
    };
    const sourceMerge = topologyAt(pp.from), targetMerge = topologyAt(pp.from.map((a,j)=>a+pp.delta[j]));
    // Only the smaller endpoint contains duplicate slots in a normal angular
    // plan. Prefer the endpoint's topology at its exact boundary as well.
    const merge = sourceMerge || targetMerge;
    const distanceFromEndpoint = sourceMerge ? u : 1-u;
    const influence = (merge?.influence || 0) * (1-smooth((distanceFromEndpoint-0.25)/0.25));
    const variants = [];
    if (influence < 1) variants.push({ring: vertices, weight: 1-influence});
    if (influence > 0) variants.push({ring: merge.ring, weight: influence});
    const contours = [];
    for (const variant of variants) {
      const clean = [];
      for (const v of variant.ring) {
        if (!clean.length || Math.hypot(v.x-clean.at(-1).x,v.y-clean.at(-1).y)>1e-8) clean.push(v);
      }
      if (clean.length>2 && Math.hypot(clean[0].x-clean.at(-1).x,clean[0].y-clean.at(-1).y)<=1e-8) clean.pop();
      const graph = window.SomataSkeletonRuntime?.createGraph?.(i,clean,{connectEdges:true});
      if (!graph) return false;
      const frame=[{orbitIndex:i,points:graph.nodes,graph,closed:true,order:0,alpha:1}];
      const profileWeights = sameProfile ? [1,0] : [1-weight,weight];
      for(let j=0;j<2;j++) {
        const w=profileWeights[j]*variant.weight;
        if (!(w>0)) continue;
        const paths=buildPolygonProfilePathsFromSkeleton(frame,styles[j]);
        if (paths.length!==1 || !paths[0].closed) return false;
        contours.push({path:paths[0],style:styles[j],weight:w});
      }
    }
    rows.push({pp,contours});
  }
  const draw = (pen, path, s) => {
    const frac = getRoundingStrength(round);
    if (useSmoothSplinePath(s, frac, path)) splinePathForDraw(pen, path.points, path.closed, frac,
      path.cornerFlags || [], path.bridgeRoundFlags || [], s.wholeCurveSpline === true, 1, 0, s);
    else roundPolylineForDraw(pen, path.points, path.closed, frac, path.cornerFlags || [], null,
      false, null, s, path.bridgeRoundFlags || []);
  };
  return somataWithFourierLayer(layer, () => {
    // All contributing curves are Simple contours on CURRENT transport slots.
    // No static endpoint positions, phase clock changes or Spline+ correction.
    for (const row of rows) {
      if (row.contours.length===1) continue;
      const curves=row.contours.map(c=>recordExactPolygonSplinePath(c.path,c.style));
      if (curves.some(c=>!c?.length)) return false;
      const knots=curves.map(profileCubicKnotFractions);
      const marks=[...new Set(knots.flat())].sort((a,b)=>a-b);
      const parts=curves.map((c,i)=>profileCubicPartition(c,knots[i],marks));
      if (parts.some(c=>!c?.length)) return false;
      row.parts=parts;
    }
    const emitContour = (pen, {contours,parts}) => {
      if (!parts) draw(pen,contours[0].path,contours[0].style);
      else {
        const mix=(k,key)=>parts.reduce((p,c,i)=>({x:p.x+c[k][key].x*contours[i].weight,
          y:p.y+c[k][key].y*contours[i].weight}),{x:0,y:0});
        const start=mix(0,'p0');pen.moveTo(start.x,start.y);
        for(let i=0;i<parts[0].length;i++) {
          const a=mix(i,'c1'),b=mix(i,'c2'),p=mix(i,'p3');
          pen.bezierCurveTo(a.x,a.y,b.x,b.y,p.x,p.y);
        }
        pen.closePath();
      }
    };
    // MonoRadius must measure the same finished Simple curve that is drawn,
    // not a different compatibility renderer. Use the static radius sampler.
    let monoScale = 1;
    if (mono) {
      let measured = 0;
      for (const row of rows) {
        const sampler = createLampRenderedPathSampler();
        emitContour(sampler,row);
        for (const p of sampler.points) measured = Math.max(measured,Math.hypot(p.x,p.y));
      }
      if (!(measured > 1e-8) || !(R > 1e-8)) return false;
      monoScale = R / measured;
      if (!Number.isFinite(monoScale)) return false;
    }
    try {
      for(const row of rows) {
        const {pp,contours}=row;
        setMorphFillGhost(ctx,pp,plan,u,src,dst);
        ctx.save();
        try {
          ctx.globalAlpha=alpha;
          if (mono && Math.abs(monoScale-1)>1e-12) {
            ctx.scale(monoScale,monoScale);
            ctx.lineWidth=(Number(ctx.lineWidth)||1)/monoScale;
          }
          if(state.showRoundingGuides) for(const c of contours)
            drawMorphConstructionGuide(ctx,c.path.points,true,layer,alpha*c.weight);
          ctx.beginPath();
          emitContour(ctx,row);
          if(!ctx.__suppressFill&&layer.fill) fillCanvasGeometry(ctx,layer);
          if(!ctx.__suppressStroke) ctx.stroke();
        } finally {ctx.restore();}
      }
    } finally {clearMorphFillGhost(ctx);}
    return true;
  });
}

function drawAngularAnchorMorph(
  ctx,
  layer,
  sourceLayer,
  targetLayer,
  t,
  alpha,
  slideType,
  movementMode = 'angular',
  monoradiusDrawScale = 1,
) {
  const currentMode = ctx.__somataActiveMorphMode || state.morph.mode;
  if (layer?.roundingCornerType === 'simple') {
    const direct = Math.abs(monoradiusDrawScale - 1) < 1e-8 &&
      drawSimpleAnchorPolygon(ctx, layer, sourceLayer, targetLayer, t, alpha, slideType, movementMode, currentMode);
    simpleAnchorRouteStats[direct ? 'direct' : 'compatibilityAttempts']++;
    simpleAnchorRouteStats.last = { route: direct ? 'simple-current-skeleton' : 'compatibility',
      mode: currentMode, layerId: layer.id, phase: t };
    if (direct) return;
  }

  if (isAuthoredProfileTransitionPair(sourceLayer, targetLayer)) {
    const a = resolveExactPolygonMorphEndpoint(sourceLayer);
    const b = resolveExactPolygonMorphEndpoint(targetLayer);
    if (drawExactPolygonSplineProfileMorph27(ctx, layer, a, b, t, alpha, movementMode, monoradiusDrawScale))
      return;
  }
  if (
    ['topology', 'calm', 'circleSlide'].includes(currentMode) &&
    Math.abs(monoradiusDrawScale - 1) < 1e-8 &&
    legacyFilletDrawCorrected(ctx, layer, sourceLayer, targetLayer, t, alpha, slideType, movementMode)
  )
    return;
  if (isRoundingOnlyMorphPair(sourceLayer, targetLayer)) {
    drawRoundingOnlyMorphFrame(ctx, sourceLayer, targetLayer, t, alpha);
    return;
  }

  if (
    !['topology', 'calm', 'circleSlide'].includes(currentMode) &&
    isRoundedSegmentProfileMorphPair(sourceLayer, targetLayer)
  ) {
    drawRoundedSegmentProfileMorphFrame(ctx, sourceLayer, targetLayer, t, alpha);
    return;
  }
  if (isRoundingPolicyOnlyMorphPair(sourceLayer, targetLayer)) {
    drawRoundingPolicyMorphFrame(ctx, sourceLayer, targetLayer, t, alpha);
    return;
  }

  const plan = getCircleMorphPlan(sourceLayer, targetLayer, slideType, currentMode);
  if (!plan.pathPlans.length) return;

  if (
    !['topology', 'calm', 'circleSlide'].includes(currentMode) &&
    drawExactPolygonSplineProfileMorph(
      ctx,
      layer,
      sourceLayer,
      targetLayer,
      t,
      alpha,
      movementMode,
      monoradiusDrawScale,
    )
  )
    return;

  const fittedLiveContour = Math.abs(monoradiusDrawScale - 1) > 1e-7;
  if (fittedLiveContour) {
    ctx.save();
    ctx.scale(monoradiusDrawScale, monoradiusDrawScale);
    ctx.lineWidth = (Number(ctx.lineWidth) || 1) / monoradiusDrawScale;
  }
  try {
    const smoothSplineRenderer =
      layer?.profileMode === 'spline' ||
      sourceLayer?.profileMode === 'spline' ||
      targetLayer?.profileMode === 'spline';
    const straightProfileNeedsSmooth =
      smoothSplineRenderer &&
      (isFlatProfileNodes(sourceLayer?.profileNodes) || isFlatProfileNodes(targetLayer?.profileNodes));
    if (
      !isSpiralLayer(layer) &&
      sourceLayer.profileMode !== 'spline' &&
      targetLayer.profileMode !== 'spline' &&
      !straightProfileNeedsSmooth
    ) {
      const R = getEffectiveLayerRadius(layer, getEffectiveLayerRadius(sourceLayer, 220));
      const profilePts = interpolateMorphProfile(sourceLayer, targetLayer, t, plan.profileScratch);
      const roundingFrac = getRoundingStrength(layer.rounding);
      const srcClosed = plan.srcClosed;
      const dstClosed = plan.dstClosed;
      const closureMix = Math.max(0, Math.min(1, t));

      const smoothMix = closureMix;

      let currentPathPlan = null;
      const drawAnchorPolylineSet = (vertexPts, closeProfile, localAlpha, collapseReferenceLength) => {
        if (localAlpha <= 0.001) return;
        const polyScratch = closeProfile ? currentPathPlan.closedScratch : currentPathPlan.openScratch;
        const options = polyScratch || {};
        if (closeProfile) currentPathPlan.closedScratch = options;
        else currentPathPlan.openScratch = options;
        options.collapseReferenceLength = collapseReferenceLength;

        delete options.spiralEnabled;
        delete options.spiralOrder;
        delete options.spiralTangential;
        delete options.spiralRoundSeams;
        delete options.spiralClosed;
        delete options.roundingFrac;
        delete options.spiralStep;
        delete options.polygonN;
        delete options.splineRenderMode;

        options.profileMode = 'segments';
        options.lineJoinType = layer?.lineJoinType || 'rounded';
        options.scratch = options;
        const polylines = applyProfileToVertexRing(vertexPts, profilePts, R, closeProfile, options);
        for (const pl of polylines) {
          if (!pl?.points || pl.points.length < 2) continue;
          ctx.save();
          ctx.globalAlpha = alpha * localAlpha;
          drawMorphConstructionGuide(ctx, pl.points, pl.closed, layer, alpha * localAlpha);
          ctx.beginPath();

          const authoredCorners =
            roundingFrac > 0.001
              ? completeLiveMorphCornerFlags(
                  pl.points,
                  pl.closed,
                  pl.cornerFlags || [],
                  pl.bridgeRoundFlags || [],
                )
              : pl.cornerFlags;
          if (layer?.roundingCornerType === 'simple') {
            drawMorphPathQuality(ctx, pl.points, pl.closed, roundingFrac, 'segments', 0, false,
              layer.splineRenderMode, authoredCorners || [], pl.bridgeRoundFlags || [], false, 0, false, layer);
          } else if (
            !state.fourierMode &&
            (pl.bridgeRoundFlags?.includes(false) || (roundingFrac > 0.001 &&
            Array.isArray(authoredCorners) &&
            authoredCorners.length === pl.points.length &&
            authoredCorners.some(Boolean)))
          ) {
            const independentCuts =
              !isSpiralLayer(sourceLayer) &&
              !isSpiralLayer(targetLayer) &&
              isFlatProfileNodes(sourceLayer.profileNodes) &&
              isFlatProfileNodes(targetLayer.profileNodes) &&
              (Number(sourceLayer.N) !== Number(targetLayer.N) ||
                Number(sourceLayer.K) !== Number(targetLayer.K) ||
                Number(sourceLayer.customSuborbits) !== Number(targetLayer.customSuborbits));
            roundPolylineForDraw(
              ctx,
              pl.points,
              pl.closed,
              roundingFrac,
              authoredCorners,
              null,
              independentCuts,
              null,
              layer,
              pl.bridgeRoundFlags || [],
            );
          } else {
            roundMorphPolyline(ctx, pl.points, pl.closed, roundingFrac);
          }
          if (!ctx.__suppressFill && layer.fill && pl.closed) fillCanvasGeometry(ctx, layer);
          if (!ctx.__suppressStroke) ctx.stroke();
          ctx.restore();
        }
      };

      for (const pp of plan.pathPlans) {
        currentPathPlan = pp;
        const vertexPts = pp.vertexPts;
        for (let i = 0; i < vertexPts.length; i++) {
          Object.assign(
            vertexPts[i],
            sampleMorphPolygonVertex(currentMode, pp, i, t, R, sourceLayer, targetLayer, movementMode),
          );
        }
        if (vertexPts.length < 2) continue;
        const collapseReferenceLength = R * pp.collapseFactor;
        setMorphFillGhost(ctx, pp, plan, t, sourceLayer, targetLayer);
        if (srcClosed === dstClosed) drawAnchorPolylineSet(vertexPts, srcClosed, 1, collapseReferenceLength);
        else {
          drawAnchorPolylineSet(vertexPts, srcClosed, 1 - smoothMix, collapseReferenceLength);
          drawAnchorPolylineSet(vertexPts, dstClosed, smoothMix, collapseReferenceLength);
        }
      }
      clearMorphFillGhost(ctx);
      return;
    }

    const srcClosed = plan.srcClosed;
    const dstClosed = plan.dstClosed;
    const closurePlan = getMorphClosureTransitionPlan(srcClosed, dstClosed, t);
    const geometryT = closurePlan.geometryT;
    const smoothMix = closurePlan.closureMix;
    const sourceRadius = getEffectiveLayerRadius(sourceLayer, getEffectiveLayerRadius(layer, 220));
    const targetRadius = getEffectiveLayerRadius(targetLayer, sourceRadius);
    const R = sourceRadius + (targetRadius - sourceRadius) * geometryT;
    const rawProfilePts = interpolateMorphProfile(sourceLayer, targetLayer, geometryT, plan.profileScratch);
    const morphProfileMode = resolveMorphProfileModeForRender(
      sourceLayer.profileMode,
      targetLayer.profileMode,
      geometryT,
    );

    const splineBlend = morphSplineBlend(sourceLayer.profileMode, targetLayer.profileMode, t);
    const mixedSplineSegment = isMixedSplineSegmentTransition(
      sourceLayer.profileMode,
      targetLayer.profileMode,
    );
    const profilePts =
      !mixedSplineSegment && splineBlend > 0 ? smoothPreSampledSplinePoints(rawProfilePts) : rawProfilePts;

    const sourceRounding = Math.max(0, Math.min(MAX_ROUNDING_PERCENT, Number(sourceLayer.rounding) || 0));
    const targetRounding = Math.max(0, Math.min(MAX_ROUNDING_PERCENT, Number(targetLayer.rounding) || 0));
    const roundingFrac = Math.max(
      0,
      Math.min(2, interpolateMorphRounding(sourceRounding, targetRounding, geometryT) / 100),
    );

    let currentPathPlan = null;
    const drawPolylineSet = (vertexPts, closeProfile, localAlpha, collapseReferenceLength) => {
      if (localAlpha <= 0.001) return;
      const polyScratch = closeProfile ? currentPathPlan.closedScratch : currentPathPlan.openScratch;
      const options = polyScratch || {};
      if (closeProfile) currentPathPlan.closedScratch = options;
      else currentPathPlan.openScratch = options;
      options.collapseReferenceLength = collapseReferenceLength;
      options.spiralEnabled = isSpiralLayer(layer);
      options.spiralOrder = getEffectiveSpiralOrder(layer);

      if (
        options.spiralEnabled &&
        (sourceLayer?.spiralEnabled === true || targetLayer?.spiralEnabled === true)
      ) {
        const so =
          sourceLayer?.spiralEnabled === true ? normalizeSpiralOrder(sourceLayer.spiralOrder, false) : 0;
        const to =
          targetLayer?.spiralEnabled === true ? normalizeSpiralOrder(targetLayer.spiralOrder, false) : 0;
        const sdir = so < -1e-8 ? -1 : so > 1e-8 ? 1 : to < 0 ? -1 : 1;
        const tdir = to < -1e-8 ? -1 : to > 1e-8 ? 1 : sdir;
        options.spiralDirectionOverride = sdir + (tdir - sdir) * geometryT;
        options.spiralExponentOverride = Math.max(
          0,
          Math.abs(so) + (Math.abs(to) - Math.abs(so)) * geometryT,
        );
      } else {
        options.spiralDirectionOverride = null;
        options.spiralExponentOverride = null;
      }
      options.spiralTwist =
        (sourceLayer.spiralTwist === true ? 1 : 0) * (1 - geometryT) +
        (targetLayer.spiralTwist === true ? 1 : 0) * geometryT;
      options.spiralTangential =
        Math.abs(Number(layer.spiralOrder) || 0) <= 1e-8
          ? 0
          : Number.isFinite(layer.__spiralTangentialMix)
            ? Math.max(0, Math.min(1, layer.__spiralTangentialMix))
            : layer.spiralTangential === true
              ? 1
              : 0;
      options.spiralRoundSeams = layer.spiralRoundSeams !== false;
      options.spiralClosed = layer.spiralClosed !== false;
      options.roundingFrac = roundingFrac;

      options.authoredRoundedSpiralMorph =
        (Number(sourceLayer?.rounding) || 0) > 0.001 || (Number(targetLayer?.rounding) || 0) > 0.001;
      options.spiralStep = getEffectiveSpiralStep(layer);

      options.polygonN =
        options.spiralEnabled && typeof getSpiralAngularVertexCount === 'function'
          ? getSpiralAngularVertexCount(layer)
          : Math.max(2, Math.round(Number(layer.N) || vertexPts.length || 4));

      options.profileMode = mixedSplineSegment ? 'spline' : morphProfileMode;
      options.continuousProfileBlend = mixedSplineSegment;
      options.splineRenderMode = layer?.splineRenderMode;
      options.lineJoinType = layer?.lineJoinType || 'rounded';
      options.scratch = options;
      const polylines = applyProfileToVertexRing(vertexPts, profilePts, R, closeProfile, options);
      const isSpiral = options.spiralEnabled === true;
      const allOpen =
        roundingFrac <= 0.001 &&
        !state.showRoundingGuides &&
        !isSpiral &&
        polylines.length > 1 &&
        polylines.every((pl) => pl?.closed !== true);
      if (allOpen) {
        ctx.save();
        ctx.globalAlpha = alpha * localAlpha;
        ctx.beginPath();
        for (const pl of polylines) {
          if (!pl?.points || pl.points.length < 2) continue;
          drawMorphConstructionGuide(ctx, pl.points, false, layer, alpha * localAlpha);

          drawMorphPathQuality(
            ctx,
            pl.points,
            false,
            roundingFrac,
            morphProfileMode,
            splineBlend,
            mixedSplineSegment,
            layer?.splineRenderMode,
            pl.cornerFlags || [],
            pl.bridgeRoundFlags || [],
            layer.wholeCurveSpline === true,
            liveSplineSeamMix(),
            morphFilletRecoveryMix(t),
            layer,
          );
        }
        if (!ctx.__suppressStroke) ctx.stroke();
        ctx.restore();
        return;
      }
      for (const pl of polylines) {
        if (!pl.points || pl.points.length < 2) continue;
        ctx.save();
        ctx.globalAlpha = alpha * localAlpha;
        drawMorphConstructionGuide(ctx, pl.points, pl.closed, layer, alpha * localAlpha);
        if (isSpiral) {
          strokeVariableWidthSpiralPath(
            ctx,
            pl.points,
            roundingFrac,
            pl.cornerFlags || [],
            morphProfileMode === 'spline' || splineBlend > 1e-6,
            layer,
          );
        } else {
          ctx.beginPath();

          drawMorphPathQuality(
            ctx,
            pl.points,
            pl.closed,
            roundingFrac,
            morphProfileMode,
            splineBlend,
            mixedSplineSegment,
            layer?.splineRenderMode,
            pl.cornerFlags || [],
            pl.bridgeRoundFlags || [],
            layer.wholeCurveSpline === true,
            liveSplineSeamMix(),
            morphFilletRecoveryMix(t),
            layer,
          );
          if (!ctx.__suppressFill && layer.fill && pl.closed) fillCanvasGeometry(ctx, layer);
          if (!ctx.__suppressStroke) ctx.stroke();
        }
        ctx.restore();
      }
    };

    for (const pp of plan.pathPlans) {
      currentPathPlan = pp;
      const vertexPts = pp.vertexPts;
      for (let i = 0; i < vertexPts.length; i++) {
        Object.assign(
          vertexPts[i],
          sampleMorphPolygonVertex(currentMode, pp, i, geometryT, R, sourceLayer, targetLayer, movementMode),
        );
      }
      if (vertexPts.length < 2) continue;
      const collapseReferenceLength = R * pp.collapseFactor;
      setMorphFillGhost(ctx, pp, plan, t, sourceLayer, targetLayer);
      if (srcClosed === dstClosed) {
        drawPolylineSet(vertexPts, srcClosed, 1, collapseReferenceLength);
      } else {
        drawPolylineSet(vertexPts, srcClosed, 1 - smoothMix, collapseReferenceLength);
        drawPolylineSet(vertexPts, dstClosed, smoothMix, collapseReferenceLength);
      }
    }
  } finally {
    clearMorphFillGhost(ctx);
    if (fittedLiveContour) ctx.restore();
  }
}

function createMonoradiusMorphExtentProbe() {
  let radiusSq = 0,
    current = null,
    start = null;
  let transform = [1, 0, 0, 1, 0, 0],
    stack = [];
  const include = (x, y) => {
    const px = transform[0] * x + transform[2] * y + transform[4];
    const py = transform[1] * x + transform[3] * y + transform[5];
    if (Number.isFinite(px) && Number.isFinite(py)) radiusSq = Math.max(radiusSq, px * px + py * py);
  };
  const update = (x, y) => {
    current = { x: Number(x) || 0, y: Number(y) || 0 };
    include(current.x, current.y);
  };
  const multiply = (a, b, c, d, e, f) => {
    const m = transform;
    transform = [
      m[0] * a + m[2] * b,
      m[1] * a + m[3] * b,
      m[0] * c + m[2] * d,
      m[1] * c + m[3] * d,
      m[0] * e + m[2] * f + m[4],
      m[1] * e + m[3] * f + m[5],
    ];
  };
  const probe = {
    __suppressStroke: true,
    __suppressFill: true,
    __spiroGLGeometryRecorder: true,
    globalAlpha: 1,
    lineWidth: 1,
    get radius() {
      return Math.sqrt(radiusSq);
    },
    save() {
      stack.push(transform.slice());
    },
    restore() {
      if (stack.length) transform = stack.pop();
    },
    translate(x, y) {
      multiply(1, 0, 0, 1, x, y);
    },
    rotate(a) {
      const c = Math.cos(a),
        si = Math.sin(a);
      multiply(c, si, -si, c, 0, 0);
    },
    scale(x, y) {
      multiply(x, 0, 0, y, 0, 0);
    },
    transform(a, b, c, d, e, f) {
      multiply(a, b, c, d, e, f);
    },
    setTransform(a, b, c, d, e, f) {
      transform = [a, b, c, d, e, f];
    },
    beginPath() {
      current = null;
      start = null;
    },
    moveTo(x, y) {
      update(x, y);
      start = { ...current };
    },
    lineTo(x, y) {
      update(x, y);
    },
    bezierCurveTo(x1, y1, x2, y2, x3, y3) {
      if (!current) {
        update(x3, y3);
        return;
      }
      const a = current;
      for (let i = 1; i <= 24; i++) {
        const t = i / 24,
          u = 1 - t;
        include(
          u * u * u * a.x + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
          u * u * u * a.y + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3,
        );
      }
      current = { x: x3, y: y3 };
    },
    quadraticCurveTo(x1, y1, x2, y2) {
      if (!current) {
        update(x2, y2);
        return;
      }
      const a = current;
      for (let i = 1; i <= 20; i++) {
        const t = i / 20,
          u = 1 - t;
        include(u * u * a.x + 2 * u * t * x1 + t * t * x2, u * u * a.y + 2 * u * t * y1 + t * t * y2);
      }
      current = { x: x2, y: y2 };
    },
    closePath() {
      if (start) include(start.x, start.y);
      current = start ? { ...start } : null;
    },
    stroke() {},
    fill() {},
    clip() {},
    setLineDash() {},
    arc(x, y, r, from, to, ccw = false) {
      const len = ccw ? from - to : to - from;
      for (let i = 0; i <= 48; i++) {
        const a = from + ((ccw ? -1 : 1) * len * i) / 48;
        include(x + r * Math.cos(a), y + r * Math.sin(a));
      }
      current = { x: x + r * Math.cos(to), y: y + r * Math.sin(to) };
    },
  };
  return probe;
}

// Compatibility renderers for providers outside the primary skeleton route.
function trySimpleMonoradiusAnchor(ctx, layer, src, dst, t, alpha, slideType, movementMode) {
  if (![layer,src,dst].every(l => l?.roundingCornerType === 'simple' && l.roundingMode === 'monoradius')) return false;
  const mode=ctx.__somataActiveMorphMode || state.morph.mode;
  if (!drawSimpleAnchorPolygon(ctx,layer,src,dst,t,alpha,slideType || getEffectiveCircleSlideType(src,dst),movementMode,mode,true)) return false;
  simpleAnchorRouteStats.direct++;
  simpleAnchorRouteStats.last={route:'simple-current-skeleton',mode,layerId:layer.id,phase:t,monoradius:true};
  return true;
}

function drawLinearAnchorMorph(
  ctx,
  layer,
  sourceLayer,
  targetLayer,
  t,
  alpha,
  slideTypeOverride = null,
  modeOverride = null,
) {
  const previousMode = ctx.__somataActiveMorphMode;
  ctx.__somataActiveMorphMode = modeOverride || state?.morph?.unifiedMode || state?.morph?.mode;
  try {
    if (trySimpleMonoradiusAnchor(ctx,layer,sourceLayer,targetLayer,t,alpha,slideTypeOverride,'linear')) return;
    drawFittedMonoradiusAnchorMorph(
      ctx,
      layer,
      sourceLayer,
      targetLayer,
      t,
      alpha,
      slideTypeOverride || getEffectiveCircleSlideType(sourceLayer, targetLayer),
      'linear',
    );
  } finally {
    ctx.__somataActiveMorphMode = previousMode;
  }
}

function drawCircleSlideMorph(
  ctx,
  layer,
  sourceLayer,
  targetLayer,
  t,
  alpha,
  slideTypeOverride = null,
  modeOverride = null,
) {
  const previousMode = ctx.__somataActiveMorphMode;
  ctx.__somataActiveMorphMode = modeOverride || state?.morph?.unifiedMode || state?.morph?.mode;
  try {
    const movement = ctx.__somataActiveMorphMode === 'minimalTurn' && !isSpiralLayer(sourceLayer) && !isSpiralLayer(targetLayer) ? 'linear' : 'angular';
    if (trySimpleMonoradiusAnchor(ctx,layer,sourceLayer,targetLayer,t,alpha,slideTypeOverride,movement)) return;
    drawFittedMonoradiusAnchorMorph(
      ctx,
      layer,
      sourceLayer,
      targetLayer,
      t,
      alpha,
      slideTypeOverride || getEffectiveCircleSlideType(sourceLayer, targetLayer),
      ctx.__somataActiveMorphMode === 'minimalTurn' &&
        !isSpiralLayer(sourceLayer) &&
        !isSpiralLayer(targetLayer)
        ? 'linear'
        : 'angular',
    );
  } finally {
    ctx.__somataActiveMorphMode = previousMode;
  }
}

function drawFadeMorph(ctx, layer, sourcePaths, targetPaths, t, alpha) {
  const srcLayer = { ...layer };
  const dstLayer = { ...layer };
  const idx = state.layers.indexOf(layer);
  const sv = runtimeState.morph.sourceVisuals[idx] || {};
  const dv = runtimeState.morph.targetVisuals[idx] || {};
  Object.assign(srcLayer, sv);
  Object.assign(dstLayer, dv);
  if (state.morph.options.byFillColor) {
    const destinationCanFill = dv.closedLoop !== false && dv.spiralEnabled !== true;
    if (sv.fill && !dv.fill && destinationCanFill && t >= 0.5) srcLayer.fill = false;
    if (!sv.fill && dv.fill && t <= 0.5) dstLayer.fill = false;
  }
  const oldStroke = ctx.strokeStyle,
    oldFill = ctx.fillStyle,
    oldAlpha = ctx.globalAlpha;
  ctx.strokeStyle = ctx.__forceStrokeStyle || srcLayer.strokeColor || oldStroke;
  ctx.fillStyle = ctx.__suppressFill ? 'transparent' : srcLayer.fillColor || oldFill;
  drawMorphGeometry(ctx, srcLayer, sourcePaths, sourcePaths, 0, alpha * (1 - t), false);
  ctx.strokeStyle = ctx.__forceStrokeStyle || dstLayer.strokeColor || oldStroke;
  ctx.fillStyle = ctx.__suppressFill ? 'transparent' : dstLayer.fillColor || oldFill;
  drawMorphGeometry(ctx, dstLayer, targetPaths, targetPaths, 0, alpha * t, false);
  ctx.strokeStyle = oldStroke;
  ctx.fillStyle = oldFill;
  ctx.globalAlpha = oldAlpha;
}

export {
  createMonoradiusMorphExtentProbe,
  drawAngularAnchorMorph,
  drawCircleSlideMorph,
  drawFadeMorph,
  drawLinearAnchorMorph,
};
