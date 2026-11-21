// Вспомогательные пути слоя при морфе по окружности.
import './effect-animation.js'; // initialisation order: this module runs after it
import { MAX_ROUNDING_PERCENT, interpolateMorphRounding } from '../core/palette.js';
import { runtimeState, state } from '../core/state.js';
import { getCachedLayerDrawData, getEffectiveLayerRadius } from './motion.js';
import { prepareFourierPathList } from '../geometry/fourier.js';
import {
  buildCurrentMorphPaths,
  circleFrameOutputPools,
  frameGeometryRuntime,
  frameMorphCacheKey,
  getCurrentMorphCpuPaths,
  getFrameOutputPool,
} from '../geometry/frame-paths.js';
import {
  applyProfileToVertexRing,
  getChaosCircleMorphPlan,
  getCircleMorphPlan,
  getMorphClosureTransitionPlan,
  interpolateMorphProfile,
} from '../geometry/morph.js';
import { buildExactSpiralEffectPaths } from '../geometry/spiral/effect-rails.js';
import {
  getEffectiveSpiralOrder,
  getEffectiveSpiralStep,
  isSpiralLayer,
} from '../geometry/spiral/order-params.js';
import { ensureProjectMorphFrameGeometryLayer } from '../project/project-morph.js';

function isChaosCircleMorphPair(layerIndex) {
  const base = state.layers?.[layerIndex];
  const src =
    runtimeState.morph.renderSourceLayers?.[layerIndex] ||
    runtimeState.morph.sourceVisuals?.[layerIndex] ||
    base;
  const dst =
    runtimeState.morph.renderTargetLayers?.[layerIndex] ||
    runtimeState.morph.targetVisuals?.[layerIndex] ||
    base;
  return src?.chaosStar === true || dst?.chaosStar === true;
}
function buildCurrentChaosCircleMorphPaths(layerIndex, t) {
  const cacheKey = `chaos-circle|${frameMorphCacheKey(layerIndex, t)}|${state.morph.slideType || 'minimal'}`;
  if (frameGeometryRuntime.active) {
    const hit = frameGeometryRuntime.circlePaths.get(cacheKey);
    if (hit) {
      frameGeometryRuntime.stats.circleHits++;
      return hit;
    }
  }
  const base = state.layers[layerIndex];
  const src = runtimeState.morph.renderSourceLayers?.[layerIndex] || {
    ...base,
    ...(runtimeState.morph.sourceVisuals?.[layerIndex] || {}),
  };
  const dst = runtimeState.morph.renderTargetLayers?.[layerIndex] || {
    ...base,
    ...(runtimeState.morph.targetVisuals?.[layerIndex] || {}),
  };
  if (!src || !dst) return [];
  const plan = getChaosCircleMorphPlan(src, dst, state.morph.slideType || 'minimal');
  if (!plan?.pathPlans?.length) return [];
  const u = Number.isFinite(Number(t)) ? Number(t) : 0;
  const closurePlan = getMorphClosureTransitionPlan(plan.srcClosed, plan.dstClosed, u);
  const geometryT = closurePlan.geometryT;
  const rs = getEffectiveLayerRadius(src, 220),
    rd = getEffectiveLayerRadius(dst, rs),
    R = rs + (rd - rs) * geometryT;
  const profilePts = interpolateMorphProfile(src, dst, geometryT, plan.profileScratch);
  const closeProfile =
    plan.srcClosed === plan.dstClosed
      ? plan.srcClosed
      : closurePlan.closureMix >= 0.5
        ? plan.dstClosed
        : plan.srcClosed;
  const sourceRounding = Math.max(0, Math.min(MAX_ROUNDING_PERCENT, Number(src.rounding) || 0));
  const targetRounding = Math.max(0, Math.min(MAX_ROUNDING_PERCENT, Number(dst.rounding) || 0));
  const currentRoundingFrac = Math.max(
    0,
    Math.min(2, interpolateMorphRounding(sourceRounding, targetRounding, geometryT) / 100),
  );
  const result = frameGeometryRuntime.active ? getFrameOutputPool(circleFrameOutputPools, layerIndex) : [];
  const resultPathPool = frameGeometryRuntime.active ? result._pathPool || (result._pathPool = []) : null;
  let resultPathWrite = 0;
  for (const pp of plan.pathPlans) {
    let vertices = pp.auxVertexPts;
    if (!vertices || vertices.length !== pp.from.length)
      vertices = pp.auxVertexPts = Array.from({ length: pp.from.length }, () => ({ x: 0, y: 0 }));
    for (let i = 0; i < vertices.length; i++) {
      const ang = pp.from[i] + pp.delta[i] * geometryT;
      vertices[i].x = R * Math.cos(ang);
      vertices[i].y = R * Math.sin(ang);
    }
    if (vertices.length < 2) continue;
    const opts = pp.auxApplyProfileOptions || (pp.auxApplyProfileOptions = {});
    opts.collapseReferenceLength = R * pp.collapseFactor;
    opts.spiralEnabled = false;
    opts.spiralOrder = 0;
    opts.spiralTangential = false;
    opts.spiralRoundSeams = true;
    opts.spiralClosed = true;
    opts.roundingFrac = currentRoundingFrac;
    opts.spiralStep = 1;
    opts.polygonN = Math.max(2, vertices.length);
    opts.profileMode = base.profileMode;
    opts.scratch = opts;
    const polylines = applyProfileToVertexRing(vertices, profilePts, R, closeProfile, opts);
    for (const pl of polylines || [])
      if (pl?.points?.length > 1) {
        if (!frameGeometryRuntime.active) {
          result.push({
            points: pl.points.map((q) => ({
              x: q.x,
              y: q.y,
              widthScale: Number.isFinite(Number(q.widthScale)) ? Number(q.widthScale) : 1,
            })),
            closed: Boolean(pl.closed),
            cornerFlags: pl.cornerFlags || [],
          });
          continue;
        }
        let item = resultPathPool[resultPathWrite];
        if (!item) item = resultPathPool[resultPathWrite] = { points: [], closed: false, cornerFlags: [] };
        else frameGeometryRuntime.stats.circlePathReuses++;
        const dstPts = item.points,
          srcPts = pl.points;
        for (let qi = 0; qi < srcPts.length; qi++) {
          let q = dstPts[qi];
          if (!q) q = dstPts[qi] = { x: 0, y: 0, widthScale: 1 };
          q.x = Number(srcPts[qi]?.x) || 0;
          q.y = Number(srcPts[qi]?.y) || 0;
          q.widthScale = Number.isFinite(Number(srcPts[qi]?.widthScale)) ? Number(srcPts[qi].widthScale) : 1;
        }
        dstPts.length = srcPts.length;
        item.closed = Boolean(pl.closed);
        item.cornerFlags = pl.cornerFlags || [];
        result.push(item);
        resultPathWrite++;
      }
  }
  if (frameGeometryRuntime.active) {
    result._frameGeometryId = frameGeometryRuntime.frameId;
    frameGeometryRuntime.stats.circleBuilds++;
    frameGeometryRuntime.circlePaths.set(cacheKey, result);
  }
  return result;
}
function buildCurrentCircleMorphPaths(layerIndex, t) {
  const cacheKey = frameMorphCacheKey(layerIndex, t);
  if (frameGeometryRuntime.active) {
    const hit = frameGeometryRuntime.circlePaths.get(cacheKey);
    if (hit) {
      frameGeometryRuntime.stats.circleHits++;
      return hit;
    }
  }
  const base = state.layers[layerIndex];
  const src = runtimeState.morph.renderSourceLayers?.[layerIndex] || {
    ...base,
    ...(runtimeState.morph.sourceVisuals?.[layerIndex] || {}),
  };
  const dst = runtimeState.morph.renderTargetLayers?.[layerIndex] || {
    ...base,
    ...(runtimeState.morph.targetVisuals?.[layerIndex] || {}),
  };
  if (!src || !dst) return [];
  const plan = getCircleMorphPlan(src, dst, state.morph.slideType || 'minimal');
  if (!plan?.pathPlans?.length) return [];
  const u = Number.isFinite(Number(t)) ? Number(t) : 0;
  const closurePlan = getMorphClosureTransitionPlan(plan.srcClosed, plan.dstClosed, u);
  const geometryT = closurePlan.geometryT;
  const rs = getEffectiveLayerRadius(src, 220),
    rd = getEffectiveLayerRadius(dst, rs),
    R = rs + (rd - rs) * geometryT;
  const rawProfilePts = interpolateMorphProfile(src, dst, geometryT, plan.profileScratch);

  const profilePts = rawProfilePts;
  const closeProfile =
    plan.srcClosed === plan.dstClosed
      ? plan.srcClosed
      : closurePlan.closureMix >= 0.5
        ? plan.dstClosed
        : plan.srcClosed;
  const sourceRounding = Math.max(0, Math.min(MAX_ROUNDING_PERCENT, Number(src.rounding) || 0));
  const targetRounding = Math.max(0, Math.min(MAX_ROUNDING_PERCENT, Number(dst.rounding) || 0));
  const currentRoundingFrac = Math.max(
    0,
    Math.min(2, interpolateMorphRounding(sourceRounding, targetRounding, geometryT) / 100),
  );
  const result = frameGeometryRuntime.active ? getFrameOutputPool(circleFrameOutputPools, layerIndex) : [];
  const resultPathPool = frameGeometryRuntime.active ? result._pathPool || (result._pathPool = []) : null;
  let resultPathWrite = 0;
  for (const [orbitIndex, pp] of plan.pathPlans.entries()) {
    let vertices = pp.auxVertexPts;
    if (!vertices || vertices.length !== pp.from.length)
      vertices = pp.auxVertexPts = Array.from({ length: pp.from.length }, () => ({ x: 0, y: 0 }));
    for (let i = 0; i < vertices.length; i++) {
      const ang = pp.from[i] + pp.delta[i] * geometryT;
      vertices[i].x = R * Math.cos(ang);
      vertices[i].y = R * Math.sin(ang);
    }
    if (vertices.length < 2) continue;
    const opts = pp.auxApplyProfileOptions || (pp.auxApplyProfileOptions = {});
    opts.collapseReferenceLength = R * pp.collapseFactor;
    opts.spiralEnabled = isSpiralLayer(base);
    opts.spiralOrder = getEffectiveSpiralOrder(base);
    opts.spiralTangential = base.spiralTangential === true;
    opts.spiralRoundSeams = base.spiralRoundSeams !== false;
    opts.spiralClosed = base.spiralClosed !== false;
    opts.roundingFrac = currentRoundingFrac;
    opts.spiralStep = getEffectiveSpiralStep(base);
    opts.polygonN = Math.max(2, Math.round(Number(base.N) || vertices.length || 4));
    opts.profileMode = base.profileMode;
    opts.scratch = opts;
    const polylines = applyProfileToVertexRing(vertices, profilePts, R, closeProfile, opts);
    for (const pl of polylines || [])
      if (pl?.points?.length > 1) {
        if (!frameGeometryRuntime.active) {
          result.push({
            points: pl.points.map((q) => ({ x: q.x, y: q.y })),
            closed: Boolean(pl.closed),
            cornerFlags: pl.cornerFlags || [],
            lampCircleOrbitIndex: orbitIndex,
            lampCircleEdgeIndex: pl.lampCircleEdgeIndex,
          });
          continue;
        }
        let item = resultPathPool[resultPathWrite];
        if (!item) item = resultPathPool[resultPathWrite] = { points: [], closed: false, cornerFlags: [] };
        else frameGeometryRuntime.stats.circlePathReuses++;
        const dstPts = item.points,
          srcPts = pl.points;
        for (let qi = 0; qi < srcPts.length; qi++) {
          let q = dstPts[qi];
          if (!q) q = dstPts[qi] = { x: 0, y: 0, widthScale: 1 };
          q.x = Number(srcPts[qi]?.x) || 0;
          q.y = Number(srcPts[qi]?.y) || 0;
          q.widthScale = Number.isFinite(Number(srcPts[qi]?.widthScale)) ? Number(srcPts[qi].widthScale) : 1;
        }
        dstPts.length = srcPts.length;
        item.closed = Boolean(pl.closed);
        item.cornerFlags = pl.cornerFlags || [];
        item.lampCircleOrbitIndex = orbitIndex;
        item.lampCircleEdgeIndex = pl.lampCircleEdgeIndex;
        result.push(item);
        resultPathWrite++;
      }
  }
  if (frameGeometryRuntime.active) {
    result._frameGeometryId = frameGeometryRuntime.frameId;
    frameGeometryRuntime.stats.circleBuilds++;
    frameGeometryRuntime.circlePaths.set(cacheKey, result);
  }
  return result;
}
function getAuxiliaryLayerPaths(layerIndex, layer, staticDrawData = null) {
  const finish = (paths) => (state.fourierMode ? prepareFourierPathList(paths || []) : paths || []);
  const greenRt = runtimeState.projectMorph;
  const greenOwnsFrame = greenRt?.active === true && greenRt?.transitionActive === true;
  if (greenOwnsFrame && greenRt.renderMode === 'crossfade') {
    const fadeT = Math.max(0, Math.min(1, Number(greenRt.fadeProgress) || 0));
    const snapshotPaths = (fadeT < 0.5 ? greenRt.sourceGeometry : greenRt.targetGeometry)?.[layerIndex];
    if (Array.isArray(snapshotPaths) && snapshotPaths.length) return finish(snapshotPaths);
  }
  let greenPaths = greenOwnsFrame ? greenRt.frameGeometry?.[layerIndex] : null;
  if (
    greenOwnsFrame &&
    greenRt.renderMode !== 'crossfade' &&
    (!Array.isArray(greenPaths) || !greenPaths.length) &&
    typeof ensureProjectMorphFrameGeometryLayer === 'function'
  ) {
    greenPaths = ensureProjectMorphFrameGeometryLayer(layerIndex, greenRt.renderProgress);
  }
  if (Array.isArray(greenPaths) && greenPaths.length) return finish(greenPaths);
  if (runtimeState.morph.active && state.morph.mode !== 'light') {
    const t = Number.isFinite(runtimeState.morph.geometryT) ? runtimeState.morph.geometryT : 0;
    const current = getCurrentMorphCpuPaths(layerIndex, t, 'auxiliary-paths');
    if (current?.length) return finish(current);
  }
  const staticPaths = staticDrawData?.paths || getCachedLayerDrawData(layer)?.paths || [];

  if (isSpiralLayer(layer) && state.fourierMode !== true && typeof buildExactSpiralEffectPaths === 'function')
    return finish(buildExactSpiralEffectPaths(staticPaths, layer));
  return finish(staticPaths);
}
// Stage 11: read the *current* Blue point carrier before the independent
// spiral-order overlay replaces its display provider. This is read-only:
// neither Blue anchors nor Blue timeline/source/target arrays are changed.
window.__somataReadCurrentBlueCarrierPaths = (layerIndex, layer) => getAuxiliaryLayerPaths(layerIndex, layer);

export {
  buildCurrentChaosCircleMorphPaths,
  buildCurrentCircleMorphPaths,
  getAuxiliaryLayerPaths,
  isChaosCircleMorphPair,
};
