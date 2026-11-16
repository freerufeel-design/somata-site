import '../morph-runtime/manual-interpolation.js'; // initialisation order: this module runs after it
import { MAX_ROUNDING_PERCENT, getRoundingStrength, interpolateMorphRounding } from '../core/palette.js';
import { runtimeState, state } from '../core/state.js';
import { getEffectiveLayerRadius } from '../effects/motion.js';
import { fillCanvasGeometry } from '../core/defaults-layers.js';
import { isFlatProfileNodes, smoothPreSampledSplinePoints } from '../geometry/profile-model.js';
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

function sampleMorphPolygonVertex(mode, pp, i, t, r, source, target, movement) {
  const rule = window.SomataMorphRegistry.get(mode === 'topoCircleOpacity' ? 'topoCircle' : mode);
  if (rule?.polygonVertex && (SomataMorphRegistry.usesCoordinatedSpine(rule.id) || rule.id === 'topoCircle'))
    return rule.polygonVertex(pp, i, t, r, source, target, movement);
  return (movement === 'linear' ? SomataMorphMath.linear : SomataMorphMath.angular)(pp, i, t, r);
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
          if (
            roundingFrac > 0.001 &&
            Array.isArray(authoredCorners) &&
            authoredCorners.length === pl.points.length &&
            authoredCorners.some(Boolean) &&
            !state.fourierMode
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
        if (srcClosed === dstClosed) drawAnchorPolylineSet(vertexPts, srcClosed, 1, collapseReferenceLength);
        else {
          drawAnchorPolylineSet(vertexPts, srcClosed, 1 - smoothMix, collapseReferenceLength);
          drawAnchorPolylineSet(vertexPts, dstClosed, smoothMix, collapseReferenceLength);
        }
      }
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
      if (srcClosed === dstClosed) {
        drawPolylineSet(vertexPts, srcClosed, 1, collapseReferenceLength);
      } else {
        drawPolylineSet(vertexPts, srcClosed, 1 - smoothMix, collapseReferenceLength);
        drawPolylineSet(vertexPts, dstClosed, smoothMix, collapseReferenceLength);
      }
    }
  } finally {
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
