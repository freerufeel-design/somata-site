import './web-plan.js'; // initialisation order: this module runs after it
import { SomataGeometryPolicy } from './geometry-policy.js';
import { state } from '../core/state.js';
import { requestMainCanvasRender } from '../core/scheduler.js';
import { ensureLayerLampState, getLayerLampsEnabled, withLampConfig } from '../core/defaults-layers.js';
import { buildExactSpiralEffectPaths } from '../geometry/spiral/effect-rails.js';
import { isSpiralLayer } from '../geometry/spiral/order-params.js';
import { audioApplyNumeric } from '../audio/audio-routing.js';
import { buildLampRenderedAttachmentPaths, lampHash32, lampVertexArcFractions } from '../lamps/lamp-anchors.js';
import { mapLampSemanticPathsToVisible } from '../lamps/lamp-points.js';
import { SomataFrameContourService } from '../geometry/frame-contour.js';
import {
  collectArbitraryContourLampPoints,
  collectStaticLampPoints,
  getLayerFrameAuxiliaryPaths,
} from '../geometry/frame-paths.js';
import { lampVisualNow } from '../lamps/lamp-motion.js';
import {
  lampBendAnimationMs,
  lampBendTracks,
  lampPointAtFraction,
  nearestLampFractionOnPath,
  nearestLampFractionOnPathSegmentBound,
  trackLampBends,
} from '../lamps/lamp-attachment.js';
import { collectMorphLampPoints } from '../lamps/lamp-topology.js';
import { currentGpuBezierResourceForFrame } from '../gpu/morph-arc-resource.js';
import { SomataFeatureHost } from './feature-host.js';
import { somataGpuContractError } from './render-diagnostics.js';
import {
  gpuMorphLampPositionMode,
  lampContourAttachmentEnabledForFrame,
  prepareGpuMorphLampFrame,
} from './lamp-morph-bridge.js';
import { SPIRO_PATH_CAPS } from './render-graph.js';
import { prepareTunnelLampInstances } from '../corridor/corridor-instances.js';
import { noteSuppressedError } from '../core/suppressed-errors.js';

SomataFeatureHost.register('lamps', {
  domain: 'effect',
  plans: ['lamps'],
  reads: ['_geometryContract'],
  outputs: [],
});

function resetLampEffectPlan(plan) {
  const p = plan && typeof plan === 'object' ? plan : {};
  p.enabled = false;
  p.contextDriven = true;
  p.baseConfig = null;
  p.instances = null;
  p.adaptiveCount = 0;
  p.tunnelActive = false;
  p.drawContract = 'LampDrawPlan';
  if (!Array.isArray(p.sets)) p.sets = [];
  else p.sets.length = 0;
  if (!Array.isArray(p.setPool)) p.setPool = [];
  p.setCursor = 0;
  return p;
}

function pushLampEffectSet(plan, layer, points, alphaBase, config) {
  if (!layer || !points?.length || alphaBase <= 0.001) return;
  const idx = plan.setCursor || 0;
  let set = plan.setPool?.[idx];
  if (!set) {
    set = {
      layer: null,
      points: null,
      alphaBase: 0,
      config: null,
      stylePlan: {},
      visualPlan: { items: [] },
      gpuLampNative: false,
      gpuPrepared: null,
    };
    (plan.setPool || (plan.setPool = []))[idx] = set;
  }
  if (!set.stylePlan) set.stylePlan = {};
  if (!set.visualPlan) set.visualPlan = { items: [] };
  plan.setCursor = idx + 1;
  set.layer = layer;
  set.points = points;
  set.alphaBase = alphaBase;
  set.config = config || ensureLayerLampState(layer) || plan.baseConfig;
  set.gpuLampNative = false;
  set.gpuPrepared = null;
  plan.sets.push(set);
}
function pushGpuLampEffectSet(plan, layer, prepared, alphaBase, config) {
  if (!layer || !prepared?.attachmentPoints?.length || alphaBase <= 0.001) return;
  const idx = plan.setCursor || 0;
  let set = plan.setPool?.[idx];
  if (!set) {
    set = {
      layer: null,
      points: null,
      alphaBase: 0,
      config: null,
      stylePlan: {},
      visualPlan: { items: [] },
      gpuLampNative: false,
      gpuPrepared: null,
    };
    (plan.setPool || (plan.setPool = []))[idx] = set;
  }
  if (!set.stylePlan) set.stylePlan = {};
  if (!set.visualPlan) set.visualPlan = { items: [] };
  plan.setCursor = idx + 1;
  set.layer = layer;
  set.points = prepared.attachmentPoints;
  set.alphaBase = alphaBase;
  set.config = config || ensureLayerLampState(layer) || plan.baseConfig;
  set.gpuLampNative = true;
  set.gpuPrepared = prepared;
  plan.sets.push(set);
}

// Prepared spiral geometry can contain multiple independent branches, even
// when the endpoint polygon matcher reports just one orbit. Attach on the
// physical rails, never on the endpoint polygon's nearest winding.
function collectPreparedSpiralLampPoints(layer, paths, config, maxPoints = 260, frameCtx = null) {
  const mode = config?.positionMode || 'key',
    snap = lampContourAttachmentEnabledForFrame({ layerLampConfig: config });
  const slots = paths.flatMap((p, i) =>
    p?.points?.length > 1 && (p._alpha ?? 1) > 0.002 && (p.strokeGrowth ?? 1) > 0 ? [i] : [],
  );
  const raw = slots.map((i) => paths[i]);
  // The retained cubics include rounded corners; their polyline is only a
  // sampling aid for lamp anchors. Line and lamps still render on the GPU.
  const spiralLayer = isSpiralLayer(layer) ? layer : { ...layer, spiralEnabled: true, spiralOrder: 1 };
  const visible = snap ? buildExactSpiralEffectPaths(raw, spiralLayer) : raw;
  if (mode === 'arbitrary') {
    const rails = new Array(paths.length);
    slots.forEach((slot, i) => { rails[slot] = visible[i]; });
    return collectArbitraryContourLampPoints(layer, rails, Math.max(600, maxPoints)).map((p) => ({
      ...p,
      lampPresence: paths[p.pathIndex]?._alpha ?? 1,
    }));
  }
  const layerKey = String(layer?.id || 'layer');
  const bends = [];
  const groups = raw
    .map((path, pi) => {
      const rail = visible[pi],
        points = path.points;
      const stations = snap ? lampVertexArcFractions(path) : null;
      const railKey = `${path.skeletonOrbitId ?? path.orbitIndex ?? 0}:${path.spiralEdgeIndex ?? slots[pi]}:${path.phaseFollower ?? ''}`;
      const out = [];
      for (let j = 0; j < points.length; j++) {
        const p = points[j],
          end = j === 0 || j === points.length - 1;
        const key = end || (mode === 'corners' && (path.lampCornerFlags?.[j] === true || p.__profileKeyCorner === true));
        let bend = false;
        if (!key && mode === 'corners') {
          const a = points[j - 1],
            b = points[j + 1];
          const ax = p.x - a.x,
            ay = p.y - a.y,
            bx = b.x - p.x,
            by = b.y - p.y;
          const len = Math.hypot(ax, ay) * Math.hypot(bx, by);
          bend =
            path.cornerFlags?.[j] === true ||
            p.__profileCorner === true ||
            (len > 1e-12 && (ax * bx + ay * by) / len < Math.cos(Math.PI / 20));
        }
        if (!key && !bend) continue;
        const fraction = stations?.[j];
        const hit = !snap || !rail?.points?.length
          ? null
          : end
            ? { fraction }
            : nearestLampFractionOnPathSegmentBound(p, rail, fraction, 0.09);
        const attachmentId = end
          ? j === 0
            ? 'start'
            : 'end'
          : (p.__profileLampKey ?? `${p.ptIdx ?? j}:${j}`);
        const lampId = `spiral:${railKey}:${attachmentId}`;
        const point = {
          ...p,
          ...(hit && lampPointAtFraction(rail, hit.fraction)),
          pathIndex: pi,
          vertexIndex: j,
          lampSpiralEndpoint: end,
          lampContourFraction: hit?.fraction,
          lampId,
          lampSeed: lampHash32(`${layerKey}:${lampId}`),
          lampPresence: (path._alpha ?? 1) * (p.__profileLampPresence ?? 1),
          lampRank: bend ? 1 : 0,
        };
        (bend ? bends : out).push(point);
      }
      return out;
    })
    .filter((g) => g.length);
  if (mode === 'corners') {
    const now = frameCtx?.frame?.now ?? frameCtx?.now;
    const extra = frameCtx
      ? trackLampBends(
          `prepared:${layerKey}`,
          bends,
          Number.isFinite(now) ? now : lampVisualNow(),
          lampBendAnimationMs(frameCtx, config),
          frameCtx.blueMorphProvider?.active === true || Number(frameCtx.lampAnimationMs) > 0,
        )
      : bends;
    const byPath = new Map();
    for (const group of groups) byPath.set(group[0].pathIndex, group);
    for (const p of extra) {
      if (!byPath.has(p.pathIndex)) byPath.set(p.pathIndex, []);
      byPath.get(p.pathIndex).push(p);
    }
    return distributeSpiralLampGroups([...byPath.values()], maxPoints);
  }
  if (frameCtx) lampBendTracks.delete(`prepared:${layerKey}`);
  return distributeSpiralLampGroups(groups, maxPoints);
}

function distributeSpiralLampGroups(groups, maxPoints) {
  if (maxPoints <= 0 || !groups.length) return [];
  if (groups.length > maxPoints)
    return Array.from(
      { length: maxPoints },
      (_, i) => groups[Math.floor((i * groups.length) / maxPoints)][0],
    );
  const out = [];
  for (let j = 0; out.length < maxPoints; j++) {
    let added = false;
    for (const group of groups)
      if (group[j]) {
        out.push(group[j]);
        added = true;
        if (out.length >= maxPoints) break;
      }
    if (!added) break;
  }
  return out;
}

// Runtime Animation publishes exactly the same moving polygon paths used by Line.
function collectPreparedPolygonLampPoints(layer, paths, config, maxPoints, frameCtx) {
  const mode = config?.positionMode || 'key';
  const snap = lampContourAttachmentEnabledForFrame({ layerLampConfig: config });
  let contour = null;
  if (snap) {
    try {
      contour = SomataFrameContourService.paths(frameCtx);
    } catch (error) {
      noteSuppressedError('render/lamp-plan#animation-polygon-contour', error);
    }
  }
  const correspondence = contour?.length ? mapLampSemanticPathsToVisible(paths, contour) : null;
  const fallback = snap && !correspondence ? buildLampRenderedAttachmentPaths(paths, layer) : paths;
  const rails = paths.map((path, i) => {
    if ((path?._alpha ?? 1) <= 0.002) return null;
    return correspondence ? contour[correspondence[i]] : fallback[i];
  });
  if (mode === 'arbitrary')
    return collectArbitraryContourLampPoints(layer, rails, Math.max(600, maxPoints)).map((p) => ({
      ...p, lampPresence: paths[p.pathIndex]?._alpha ?? 1,
    }));

  const layerKey = String(layer?.id || 'layer');
  const usesPhaseSlots = mode === 'key' && frameCtx.geometryProvider?.lampPaths?.length > 0;
  const anchors = usesPhaseSlots ? frameCtx.geometryProvider.lampPaths : paths;
  const railMapping = usesPhaseSlots ? mapLampSemanticPathsToVisible(anchors, paths) : null;
  const groups = [];
  for (const [anchorIndex, path] of anchors.entries()) {
    const pathIndex = railMapping?.[anchorIndex] ?? anchorIndex;
    const points = path?.points;
    const rail = rails[pathIndex];
    if (!points?.length || (snap && !(rail?.points?.length >= 2))) continue;
    const flags = path.lampCornerFlags || path.cornerFlags;
    const stations = snap ? lampVertexArcFractions(path, true) : null;
    const group = [];
    for (const [vertexIndex, point] of points.entries()) {
      const endpoint = !path.closed && (vertexIndex === 0 || vertexIndex === points.length - 1);
      const key = endpoint || point.__profileKeyCorner === true ||
        (flags?.length ? flags[vertexIndex] === true : !path.profileCurveBaked);
      let bend = false;
      if (!key && mode === 'corners' && (path.closed || (vertexIndex > 0 && vertexIndex < points.length - 1))) {
        const prev = points[(vertexIndex + points.length - 1) % points.length];
        const next = points[(vertexIndex + 1) % points.length];
        const ax = point.x - prev.x, ay = point.y - prev.y;
        const bx = next.x - point.x, by = next.y - point.y;
        const span = Math.hypot(ax, ay) * Math.hypot(bx, by);
        bend = span > 1e-12 && ax * bx + ay * by < Math.cos(Math.PI / 20) * span;
      }
      if (usesPhaseSlots ? !point.lampSourcePresent && !point.lampTargetPresent : !key && !bend) continue;
      // A reordered closed correspondence can start at a different vertex
      // from the rendered rail. On a simple polygon, project by position as
      // the static key lamps do, without a window tied to that arbitrary seam.
      const hit = !snap ? null : usesPhaseSlots && Number(layer.K || 1) === 1
        ? nearestLampFractionOnPath(point, rail)
        : nearestLampFractionOnPathSegmentBound(point, rail, stations[vertexIndex]);
      const id = `animation:${path.orbitIndex ?? pathIndex}:${path.closed ? 'closed' : 'open'}:${usesPhaseSlots ? point.id : point.__profileLampKey ?? vertexIndex}`;
      group.push({
        ...point,
        ...(hit && lampPointAtFraction(rail, hit.fraction)),
        pathIndex,
        vertexIndex,
        lampId: id,
        lampSeed: lampHash32(`${layerKey}:${id}`),
        lampPresence: (path.alpha ?? path._alpha ?? 1) * (point.__profileLampPresence ?? 1),
        lampRank: bend ? 1 : 0,
      });
    }
    if (group.length) groups.push(group);
  }
  return distributeSpiralLampGroups(groups, maxPoints);
}

function resolveLayerLampEffectProvider(frameCtx, plan) {
  const layer = frameCtx.layer,
    effectLayer = frameCtx.effectLayer || liveEffectOwnerForFrameLayer(layer),
    layerIndex = frameCtx.layerIndex;
  plan.enabled =
    (frameCtx.forcedLampMorph || frameCtx.greenLampDisplay || getLayerLampsEnabled(effectLayer)) === true;
  plan.tunnelActive = state.tunnel.active === true;
  plan.baseConfig = ensureLayerLampState(effectLayer) || state.lamps;
  if (!plan.enabled) return plan;
  const { viewportOuterRadius } = frameCtx.frame;
  const tunnelCopies = frameCtx.tunnelCopies || frameCtx.frame.tunnelCopies;
  const provider = frameCtx.geometryProvider;
  const animation = provider?.origin === 'manual' && provider.geometryActive === true;
  const prepared = animation || provider?.primarySkeleton === true ? provider.framePaths : null;
  const preparedSpiral = prepared?.some((p) => Math.abs(p?.spiralOrder || 0) > 1e-8) === true ||
    (animation && prepared?.length > 0 && isSpiralLayer(layer));
  const spiralCopies = preparedSpiral || isSpiralLayer(layer) || SomataGeometryPolicy.isStrict(frameCtx);
  // Spiral lamps share the line's visibility/phase and exact copy transforms.
  // An independent radius/extent cull can drop all but one visible winding.
  const instances =
    plan.tunnelActive && !spiralCopies
      ? prepareTunnelLampInstances(
          tunnelCopies,
          frameCtx.layerExtent,
          frameCtx.combinedScale,
          viewportOuterRadius,
          state.zoom,
          layer?.id || layerIndex,
          frameCtx.now,
          plan.baseConfig,
          layer,
        )
      : frameCtx.visibleInstances;
  plan.instances = instances;
  plan.adaptiveCount = instances.copies.length;

  if (frameCtx.minimalFadeEnabled) {
    const mt = frameCtx.orangeMorphProvider?.progress || 0;
    const src = frameCtx.minimalSourceLayer,
      dst = frameCtx.minimalTargetLayer;
    if (src && getLayerLampsEnabled(src)) {
      const srcLampConfig = ensureLayerLampState(src) || plan.baseConfig;
      const pts =
        frameCtx.orangeMorphProvider?.sourceLampPoints ||
        withLampConfig(srcLampConfig, () =>
          collectStaticLampPoints(src, frameCtx.orangeMorphProvider?.sourceData || undefined, 240),
        );
      const opacity =
        audioApplyNumeric('layer.opacity', src.opacity !== undefined ? src.opacity : 100, layerIndex) / 100;
      pushLampEffectSet(plan, src, pts, opacity * 0.95 * (1 - mt), srcLampConfig);
    }
    if (dst && getLayerLampsEnabled(dst)) {
      const dstLampConfig = ensureLayerLampState(dst) || plan.baseConfig;
      const pts =
        frameCtx.orangeMorphProvider?.targetLampPoints ||
        withLampConfig(dstLampConfig, () =>
          collectStaticLampPoints(dst, frameCtx.orangeMorphProvider?.targetData || undefined, 240),
        );
      const opacity =
        audioApplyNumeric('layer.opacity', dst.opacity !== undefined ? dst.opacity : 100, layerIndex) / 100;
      pushLampEffectSet(plan, dst, pts, opacity * 0.95 * mt, dstLampConfig);
    }
  } else {
    const lampT = frameCtx.geometryProvider?.progress ?? frameCtx.blueMorphProvider?.geometryT ?? 0;
    const followsMorph = Boolean(
      !frameCtx.greenMorphEnabled && frameCtx.morphFrameActive && frameCtx.blueMorphProvider?.mode !== 'fade',
    );
    const allowed =
      frameCtx.forcedLampMorph || frameCtx.greenLampDisplay || getLayerLampsEnabled(effectLayer);
    const alpha = frameCtx.baseAlpha * (frameCtx.forcedLampMorph || followsMorph ? 1 : 0.95);

    if ((preparedSpiral || (animation && prepared?.length)) && allowed && !frameCtx.greenMorphEnabled) {
      const points = withLampConfig(plan.baseConfig, () =>
        preparedSpiral
          ? collectPreparedSpiralLampPoints(layer, prepared, plan.baseConfig, 260, frameCtx)
          : collectPreparedPolygonLampPoints(layer, prepared, plan.baseConfig, 260, frameCtx),
      );
      pushLampEffectSet(plan, layer, points, animation ? frameCtx.baseAlpha : alpha, plan.baseConfig);
      plan.enabled = plan.sets.length > 0;
      return plan;
    }
    const strictSpiralGpuBefore = SomataGeometryPolicy.isStrict(frameCtx),
      snappedMorph = followsMorph && lampContourAttachmentEnabledForFrame(frameCtx) === true,
      gpuLampPrepared =
        (strictSpiralGpuBefore || (followsMorph && !snappedMorph && plan.baseConfig.positionMode !== 'key')) &&
        allowed && typeof prepareGpuMorphLampFrame === 'function'
          ? withLampConfig(plan.baseConfig, () => prepareGpuMorphLampFrame(frameCtx))
          : null;
    if (gpuLampPrepared) {
      pushGpuLampEffectSet(plan, layer, gpuLampPrepared, alpha, plan.baseConfig);
    } else {
      const strictSpiralGpu = SomataGeometryPolicy.isStrict(frameCtx);
      if (strictSpiralGpu) {
        plan.enabled = false;
        somataGpuContractError('SPIRAL_LAMP_ARC_RESOURCE_UNAVAILABLE', frameCtx, {
          arc: window.__spiroGpuMorphArcStatus?.() || null,
          lampBridge: window.__spiroGpuMorphLampBridgeStatus?.() || null,
          lamp: window.__spiroLampGPUStatus?.() || null,
          authority: (() => {
            try {
              const r = currentGpuBezierResourceForFrame(frameCtx);
              return r
                ? {
                    layerIndex: r.layerIndex,
                    ready: r.ready === true,
                    static: r.staticSpiralBezierRail === true,
                    special: r.specialSpiralBezierRail === true,
                    cubicCount: Number(r.cubicCount) || 0,
                    segmentCount: Number(r.segmentCount) || 0,
                    phaseSerial: Number(r.phaseSerial) || 0,
                  }
                : null;
            } catch (_) {
              return null;
            }
          })(),
          arcDecision: window.__spiroGpuMorphArcStatus?.()?.lastDecision || null,
        });
        try {
          requestMainCanvasRender?.();
        } catch (error) {
          noteSuppressedError('render/lamp-plan#resolveLayerLampEffectProvider', error);
        }
        return plan;
      }

      const rawPaths = followsMorph ? getLayerFrameAuxiliaryPaths(frameCtx) : null;

      let authoritativeLampAttachmentPaths = null;
      if (
        followsMorph &&
        !SomataGeometryPolicy.isStrict(frameCtx) &&
        lampContourAttachmentEnabledForFrame(frameCtx) === true
      ) {
        try {
          authoritativeLampAttachmentPaths = SomataFrameContourService?.paths?.(frameCtx) || null;
        } catch (_) {
          authoritativeLampAttachmentPaths = null;
        }
      }
      const points = withLampConfig(plan.baseConfig, () =>
        frameCtx.greenMorphEnabled
          ? frameCtx.greenMorphProvider?.frameLampPoints || []
          : followsMorph
            ? collectMorphLampPoints(layerIndex, lampT, 260, rawPaths, authoritativeLampAttachmentPaths)
            : collectStaticLampPoints(layer, frameCtx.staticDrawData || undefined, 240),
      );
      if (allowed) pushLampEffectSet(plan, layer, points, alpha, plan.baseConfig);
    }
  }
  plan.enabled = plan.sets.length > 0;
  return plan;
}

SomataFeatureHost?.provide?.('lamps', 'effectPlan', (frameCtx, previousPlans) =>
  resolveLayerLampEffectProvider(frameCtx, resetLampEffectPlan(previousPlans?.lamps)),
);
SomataFeatureHost?.provide?.('lamps', 'graphPass', (frameCtx, plans) => {
  const plan = plans?.lamps;
  if (plan?.enabled !== true) return { name: 'lamps', caps: 0, active: false, backend: 'none' };

  const sets = plan.sets || [],
    gpuArc = sets.some(
      (s) =>
        s?.gpuPrepared?.gpuBezierDerived === true ||
        s?.gpuPrepared?.gpuArcNative === true ||
        (s?.gpuLampNative === true && s?.gpuPrepared?.gpuMorphArcTable?.gpuArcResident === true),
    ),
    gpuNative = sets.some((s) => s?.gpuLampNative === true);
  let caps = SPIRO_PATH_CAPS.LAMPS;
  if (gpuArc)
    caps |= SPIRO_PATH_CAPS.POSITIONS | SPIRO_PATH_CAPS.SEGMENT_TOPOLOGY | SPIRO_PATH_CAPS.EXACT_ARC;
  else if (gpuNative) caps |= SPIRO_PATH_CAPS.LAMP_IDENTITY;
  else caps |= SPIRO_PATH_CAPS.CPU_PATH;
  return {
    name: 'lamps',
    caps,
    active: true,
    backend: gpuArc ? 'gpu-lamp-arc' : gpuNative ? 'gpu-lamp-native' : 'gpu-prepared',
    meta: {
      gpuArc,
      gpuNative,
      positionMode: gpuMorphLampPositionMode(frameCtx),
    },
  };
});
SomataFeatureHost?.provide?.('lamps', 'resetEffectPlan', (plans) => resetLampEffectPlan(plans?.lamps));

