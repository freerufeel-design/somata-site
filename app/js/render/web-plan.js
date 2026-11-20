import './sweep-plan.js'; // initialisation order: this module runs after it
import { SomataGeometryPolicy } from './geometry-policy.js';
import { state } from '../core/state.js';
import { requestMainCanvasRender } from '../core/scheduler.js';
import { getLayerWebEnabled } from '../core/defaults-layers.js';
import { isSpiralLayer } from '../geometry/spiral/order-params.js';
import { SomataFrameContourService, getLayerFrameAuthoritativePaths } from '../geometry/frame-contour.js';
import { prepareLayerFrameWebData } from '../effects/web.js';
import { prepareGpuMorphWebFrame } from './web-morph-bridge.js';
import { SomataFeatureHost } from './feature-host.js';
import { somataGpuDiagnosticError } from './render-diagnostics.js';
import { SPIRO_PATH_CAPS } from './render-graph.js';
import { noteSuppressedError } from '../core/suppressed-errors.js';

SomataFeatureHost.register('web', {
  domain: 'effect',
  plans: ['web'],
  reads: ['_fillBelowWebResolved', '_spiralCorridorSharedLineAuthority'],
  outputs: ['_webPassHandled'],
});

const spiralWebRouteStats = { frames: 0, sharedMaster: 0, native: 0, ordinary: 0, rejected: 0, last: null };
function noteSpiralWebRoute(frameCtx, plan, route, reason = '') {
  if (frameCtx?.layer && typeof isSpiralLayer === 'function' && isSpiralLayer(frameCtx.layer)) {
    spiralWebRouteStats.frames++;
    if (route === 'line-master') spiralWebRouteStats.sharedMaster++;
    else if (route === 'native') spiralWebRouteStats.native++;
    else if (route === 'ordinary') spiralWebRouteStats.ordinary++;
    else spiralWebRouteStats.rejected++;
    const rec = SomataFrameContourService?.current?.(frameCtx) || null;
    let owner = frameCtx,
      guard = 0;
    while (owner?.__somataFeatureParent && guard++ < 8) owner = owner.__somataFeatureParent;
    const master = owner?._dynamicTunnelMorphMasterCommands || owner?._tunnelMasterStrokeCommands || null;
    spiralWebRouteStats.last = {
      frameId: Number(frameCtx.frameId) || 0,
      layerIndex: frameCtx.layerIndex,
      geometryKind: frameCtx.geometryPlan?.kind || null,
      dynamic: frameCtx.geometryPlan?.dynamic === true,
      blueMorphActive: frameCtx.morphFrameActive === true,
      corridor: state.tunnel?.active === true,
      route,
      reason,
      masterFrameId: rec?.frameId ?? null,
      sameRecordedMasterCommands: Boolean(rec && master && rec.commands === master),
      sameVisibleLinePaths: rec ? plan?.frameData?.visualPaths === rec.paths : false,
      cornerCount: plan?.frameData?.corners?.length ?? null,
      roundedBendCount: plan?.frameData?.corners?.filter((c) => c?.spiralRoundedBend === true).length ?? null,
      placement: plan?.frameData?.placementMode || null,
      webEnabled: plan?.enabled === true,
    };
  }
  return plan;
}

function resetWebEffectPlan(plan) {
  const p = plan && typeof plan === 'object' ? plan : {};
  p.enabled = false;
  p.contextDriven = true;
  p.paths = null;
  p.frameData = null;
  p.footprint = 0;
  p.tunnelActive = false;
  p.gpuMorphWebNative = false;
  return p;
}

function resolveLayerWebEffectProvider(frameCtx, plan) {
  const effectLayer = frameCtx.effectLayer || liveEffectOwnerForFrameLayer(frameCtx.layer);
  plan.enabled = getLayerWebEnabled(effectLayer) === true;
  plan.tunnelActive = state.tunnel.active === true;
  plan.gpuMorphWebNative = false;
  if (!plan.enabled) return plan;

  const corridorMaster = SomataFrameContourService?.usesSpiralCorridorMaster?.(frameCtx) === true;

  const blueSpiralCorridor =
    state.tunnel?.active === true &&
    frameCtx.geometryPlan?.dynamic === true &&
    frameCtx.morphFrameActive === true &&
    frameCtx.geometryProvider === frameCtx.blueMorphProvider &&
    ['blue-circle-slide', 'blue-prepared'].includes(frameCtx.geometryPlan?.kind) &&
    typeof isSpiralLayer === 'function' &&
    isSpiralLayer(frameCtx.layer);
  if (blueSpiralCorridor && !corridorMaster && SomataGeometryPolicy.isStrict(frameCtx) !== true) {
    plan.enabled = false;
    return noteSpiralWebRoute(frameCtx, plan, 'rejected', 'blue-corridor-line-master-ineligible');
  }
  if (corridorMaster && !SomataFrameContourService.get(frameCtx)) {
    plan.enabled = false;
    try {
      somataGpuDiagnosticError?.(
        'web',
        'spiral-corridor-master',
        'Exact current-frame Spiral Corridor Line master unavailable; Web not attached to stale geometry',
        frameCtx,
      );
    } catch (error) {
      noteSuppressedError('render/web-plan#resolveLayerWebEffectProvider', error);
    }
    return noteSpiralWebRoute(frameCtx, plan, 'rejected', 'line-master-unavailable');
  }
  const strict =
    SomataGeometryPolicy.isStrict(frameCtx) && frameCtx._spiralCorridorSharedLineAuthority !== true;

  const nativeData =
    strict && typeof prepareGpuMorphWebFrame === 'function' ? prepareGpuMorphWebFrame(frameCtx) : null;
  if (nativeData) {
    plan.frameData = nativeData;
    plan.paths = null;
    plan.gpuMorphWebNative = true;
    plan.enabled = true;
  } else if (strict) {
    plan.enabled = false;
    try {
      requestMainCanvasRender?.();
    } catch (error) {
      noteSuppressedError('render/web-plan#resolveLayerWebEffectProvider', error);
    }
    return noteSpiralWebRoute(frameCtx, plan, 'rejected', 'native-resource-not-ready');
  } else {
    plan.frameData = prepareLayerFrameWebData(frameCtx);
    plan.paths = plan.frameData?.paths || getLayerFrameAuthoritativePaths(frameCtx);
    plan.enabled = plan.frameData?.enabled === true && Boolean(plan.paths?.length);
  }
  if (plan.enabled) plan.footprint = Math.max(0.03, Number(plan.frameData?.width) || 0.6) * 2.4;
  const route = plan.enabled
    ? plan.gpuMorphWebNative
      ? 'native'
      : frameCtx._spiralCorridorSharedLineAuthority === true
        ? 'line-master'
        : 'ordinary'
    : 'rejected';
  return noteSpiralWebRoute(
    frameCtx,
    plan,
    route,
    plan.enabled
      ? ''
      : strict
        ? 'native-resource-not-ready'
        : plan.frameData?._spiralLineMasterRequired
          ? 'line-master-data-invalid'
          : 'ordinary-web-empty',
  );
}

SomataFeatureHost?.provide?.('web', 'effectPlan', (frameCtx, previousPlans) =>
  resolveLayerWebEffectProvider(frameCtx, resetWebEffectPlan(previousPlans?.web)),
);
SomataFeatureHost?.provide?.('web', 'graphPass', (frameCtx, plans) => {
  const plan = plans?.web;
  return {
    name: 'web',
    caps:
      SPIRO_PATH_CAPS.POSITIONS |
      SPIRO_PATH_CAPS.SEGMENT_TOPOLOGY |
      SPIRO_PATH_CAPS.EXACT_ARC |
      (plan?.gpuMorphWebNative === true ? 0 : SPIRO_PATH_CAPS.CPU_PATH),
    active: plan?.enabled === true,
    backend: plan?.gpuMorphWebNative === true ? 'gpu-web-arc' : 'gpu-prepared',
    meta: { webMorphNative: plan?.gpuMorphWebNative === true },
  };
});
SomataFeatureHost?.provide?.('web', 'resetEffectPlan', (plans) => resetWebEffectPlan(plans?.web));
