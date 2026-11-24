// Кэш команд штрихов: статические, мастер Коридора, динамические кадры морфа.
import '../gpu/line-effects-renderer.js'; // initialisation order: this module runs after it
import { getLayerVersions } from '../core/layer-versions.js';
import { mainCtx } from '../core/render-runtime.js';
import { runtimeState, somataFourierActive, state } from '../core/state.js';
import { GeometryKernel, getLayerGeometryContract } from '../geometry/kernel.js';
import { getEffectiveSpiralMorphTransport } from '../morph-runtime/morph-mode.js';
import { mainCanvas } from '../ui/profile-presets.js';
import { spiralProfileGeometrySignature } from '../geometry/spiral/bezier-carrier.js';
import { isSpiralLayer } from '../geometry/spiral/order-params.js';
import { WebGPUStrokeRenderer } from '../gpu/stroke-renderer.js';
import {
  acquireReusableTunnelStrokeRecorder,
  createGeometryGLRecordingContext,
  finishPhaseResidentMorphGLRecorder,
  getPhaseResidentMorphGLRecorder,
} from './gl-recording-context.js';
import { noteSuppressedError } from '../core/suppressed-errors.js';

const spiralCorridorMasterScopeStats = { builds: 0, hits: 0 };
function markSpiralCorridorMaster(commands, enabled = true) {
  if (!commands || typeof commands !== 'object') return commands;
  try {
    Object.defineProperty(commands, '__spiroSpiralCorridorSeam', {
      value: enabled === true,
      configurable: true,
      writable: true,
    });
  } catch (_) {
    commands.__spiroSpiralCorridorSeam = enabled === true;
  }
  return commands;
}
const persistentStrokeCommandCache = new WeakMap();
const persistentStrokeCommandStats = { hits: 0, builds: 0, invalidations: 0 };
function staticStrokeCommandSignature(frameCtx, allowHiddenGraffitiCarrier = false) {
  const hiddenGraffitiCarrier =
    allowHiddenGraffitiCarrier === true &&
    frameCtx?.lineProfileStrokeOnly === true &&
    frameCtx?.lineProfileApplication === 'graffiti';
  if (
    !frameCtx ||
    state.tunnel?.active === true ||
    frameCtx.geometryPlan?.dynamic === true ||
    (frameCtx.lineProfileStrokeOnly && !hiddenGraffitiCarrier) ||
    state.showRoundingGuides
  )
    return null;
  if (!frameCtx.staticDrawData || !frameCtx.layer) return null;
  const tr = mainCtx.getTransform();
  return {
    hiddenGraffitiCarrier,
    drawData: frameCtx.staticDrawData,
    roundedKey: String(frameCtx.staticDrawData?.roundedKey || ''),
    geometryKey: String(
      frameCtx.staticDrawData?.geometryKey || frameCtx.staticDrawData?.canonicalGeometry?.geometryKey || '',
    ),
    geometryVersion: Math.max(0, Number(getLayerVersions(frameCtx.layer)?.geometry) || 0),
    spiralProfileSignature: isSpiralLayer(frameCtx.layer)
      ? spiralProfileGeometrySignature(frameCtx.layer)
      : '',
    width: mainCanvas.width | 0,
    height: mainCanvas.height | 0,
    matrix: [tr.a, tr.b, tr.c, tr.d, tr.e, tr.f],
    combinedScale: Number(frameCtx.combinedScale) || 1,
    combinedRotation: Number(frameCtx.combinedRotationRad) || 0,
    strokeWidth: Number(frameCtx.strokeWidth) || 1,
    baseAlpha: Number(frameCtx.baseAlpha) || 0,
    strokeStyle: String(frameCtx.lightningStroke || frameCtx.layer.strokeColor || '#ffffff'),
    lineCap: String(frameCtx.lineCap || 'round'),
    lineJoin: String(frameCtx.lineJoin || 'round'),
    miterLimit: Number(frameCtx.miterLimit) || 6,
    kind: String(frameCtx.geometryPlan?.kind || 'static'),
    variableWidthGpu: WebGPUStrokeRenderer.isReady() ? 1 : 0,
  };
}
function sameStaticStrokeSignature(a, b) {
  if (
    !a ||
    !b ||
    a.hiddenGraffitiCarrier !== b.hiddenGraffitiCarrier ||
    a.drawData !== b.drawData ||
    a.roundedKey !== b.roundedKey ||
    a.geometryKey !== b.geometryKey ||
    a.geometryVersion !== b.geometryVersion ||
    a.spiralProfileSignature !== b.spiralProfileSignature ||
    a.width !== b.width ||
    a.height !== b.height ||
    a.strokeStyle !== b.strokeStyle ||
    a.lineCap !== b.lineCap ||
    a.lineJoin !== b.lineJoin ||
    a.kind !== b.kind ||
    a.variableWidthGpu !== b.variableWidthGpu
  )
    return false;
  if (
    Math.abs(a.combinedScale - b.combinedScale) > 1e-10 ||
    Math.abs(a.combinedRotation - b.combinedRotation) > 1e-10 ||
    Math.abs(a.strokeWidth - b.strokeWidth) > 1e-10 ||
    Math.abs(a.baseAlpha - b.baseAlpha) > 1e-10 ||
    Math.abs(a.miterLimit - b.miterLimit) > 1e-10
  )
    return false;
  for (let i = 0; i < 6; i++) if (Math.abs(a.matrix[i] - b.matrix[i]) > 1e-10) return false;
  return true;
}
function markPersistentStrokeCommands(commands, geometryVersion = 0, profileSignature = '') {
  if (!commands) return commands;
  const gv = Math.max(0, Number(geometryVersion) || 0),
    ps = String(profileSignature || '');
  try {
    Object.defineProperty(commands, '__spiroPersistentStatic', { value: true, configurable: true });
    Object.defineProperty(commands, '__spiroGeometryVersion', {
      value: gv,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(commands, '__spiroProfileSignature', {
      value: ps,
      writable: true,
      configurable: true,
    });
  } catch (_) {
    commands.__spiroPersistentStatic = true;
    commands.__spiroGeometryVersion = gv;
    commands.__spiroProfileSignature = ps;
  }
  return commands;
}
const persistentTunnelMasterStrokeCache = new WeakMap();
const persistentTunnelMasterStats = { hits: 0, builds: 0, invalidations: 0 };
const spiralCorridorMasterGuardStats = {
  checks: 0,
  accepted: 0,
  rejectedEmpty: 0,
  rejectedContinuity: 0,
  rejectedNonVariable: 0,
  rejectedUnprotected: 0,
  cachedRejects: 0,
  buildRejects: 0,
  corridorEmptyFallbacks: 0,
};
function validateSpiralCorridorMasterCommands(commands, frameCtx = null) {
  if (
    !frameCtx ||
    state.tunnel?.active !== true ||
    !isSpiralLayer(frameCtx.layer) ||
    frameCtx.layer?.spiralClosed === false
  )
    return true;
  spiralCorridorMasterGuardStats.checks++;
  if (!commands?.length) {
    spiralCorridorMasterGuardStats.rejectedEmpty++;
    return false;
  }
  const meta = GeometryKernel.inspectStrokeCommands(commands);
  if (!meta?.count) {
    spiralCorridorMasterGuardStats.rejectedEmpty++;
    return false;
  }
  if (
    meta.continuityRisk === true ||
    meta.invalidSegments > 0 ||
    meta.invalidWidths > 0 ||
    meta.protectedBrokenPaths > 0 ||
    meta.collapsedProtectedPaths > 0
  ) {
    spiralCorridorMasterGuardStats.rejectedContinuity++;
    return false;
  }
  let sawVariable = false,
    sawUnprotected = false;
  for (const cmd of commands) {
    if (cmd?.__variableWidthSpiral === true || cmd?.__variableWidthBezierSpiral === true) sawVariable = true;
    if (cmd?.__spiralContinuityProtected !== true) sawUnprotected = true;
  }

  if (WebGPUStrokeRenderer.isReady() && !sawVariable) {
    spiralCorridorMasterGuardStats.rejectedNonVariable++;
    return false;
  }
  if (sawUnprotected) {
    spiralCorridorMasterGuardStats.rejectedUnprotected++;
    return false;
  }
  spiralCorridorMasterGuardStats.accepted++;
  return true;
}
const spiralCorridorInstanceStats = {
  eligibilityChecks: 0,
  eligible: 0,
  fourierEligible: 0,
  dynamicEligible: 0,
  splitFallbacks: 0,
  unavailableFallbacks: 0,
  baseCommits: 0,
  baseDeclines: 0,
};
function spiralCorridorRequiresSplit(frameCtx) {
  const layer = frameCtx?.layer;
  // Use canonical branch topology automatically. No experimental
  // user switch may silently change the selected Morph transport.
  if (!layer || Math.abs(Number(layer.spiralOrder) || 0) < 1e-8) return true;
  const morph = runtimeState?.morph;
  if (morph?.active !== true) return false;
  const transport = getEffectiveSpiralMorphTransport();
  if (transport === 'torn') return true;
  // Only the endpoints of THIS layer control whether its spiral becomes a polygon.
  const index = Number(frameCtx.layerIndex);
  if (Number.isInteger(index) && index >= 0) {
    const zero = (v) =>
      Boolean(v && (v.spiralEnabled !== true || Math.abs(Number(v.spiralOrder) || 0) < 1e-8));
    if (zero(morph.renderSourceLayers?.[index]) || zero(morph.renderTargetLayers?.[index])) return true;
  }
  return false;
}
function canUseSpiralCorridorMasterInstancing(frameCtx) {
  spiralCorridorInstanceStats.eligibilityChecks++;
  if (
    !frameCtx ||
    state.tunnel?.active !== true ||
    !isSpiralLayer(frameCtx.layer) ||
    frameCtx.geometryPlan?.kind === 'lightning'
  )
    return false;
  if (spiralCorridorRequiresSplit(frameCtx)) {
    spiralCorridorInstanceStats.splitFallbacks++;
    return false;
  }
  // Both the sampled Fourier rail and the retained cubic rail are compatible
  // with the existing WebGPU Corridor segment instancer. It records ONE master
  // per layer/frame and transforms it for every visible copy inside the shader.
  // Morphs update that master once per frame; static rails remain GPU-resident.
  if (WebGPUStrokeRenderer.isReady?.() !== true) {
    spiralCorridorInstanceStats.unavailableFallbacks++;
    return false;
  }
  spiralCorridorInstanceStats.eligible++;
  if (somataFourierActive(frameCtx.layer)) spiralCorridorInstanceStats.fourierEligible++;
  if (frameCtx.geometryPlan?.dynamic === true) spiralCorridorInstanceStats.dynamicEligible++;
  return true;
}
function tunnelMasterStrokeSignature(frameCtx, allowHiddenGraffitiCarrier = false) {
  const hiddenGraffitiCarrier =
    allowHiddenGraffitiCarrier === true &&
    frameCtx?.lineProfileStrokeOnly === true &&
    frameCtx?.lineProfileApplication === 'graffiti';
  if (
    !frameCtx ||
    state.tunnel?.active !== true ||
    frameCtx.geometryPlan?.dynamic === true ||
    !['static', 'light-static'].includes(String(frameCtx.geometryPlan?.kind || '')) ||
    (frameCtx.lineProfileStrokeOnly && !hiddenGraffitiCarrier) ||
    state.showRoundingGuides
  )
    return null;
  if (!frameCtx.staticDrawData || !frameCtx.layer) return null;
  const tr = mainCtx.getTransform();
  return {
    drawData: frameCtx.staticDrawData,
    roundedKey: String(frameCtx.staticDrawData?.roundedKey || ''),
    geometryKey: String(
      frameCtx.staticDrawData?.geometryKey || frameCtx.staticDrawData?.canonicalGeometry?.geometryKey || '',
    ),
    geometryVersion: Math.max(0, Number(getLayerVersions(frameCtx.layer)?.geometry) || 0),
    spiralProfileSignature: isSpiralLayer(frameCtx.layer)
      ? spiralProfileGeometrySignature(frameCtx.layer)
      : '',
    width: mainCanvas.width | 0,
    height: mainCanvas.height | 0,
    matrix: [tr.a, tr.b, tr.c, tr.d, tr.e, tr.f],
    combinedScale: Number(frameCtx.combinedScale) || 1,
    combinedRotation: Number(frameCtx.combinedRotationRad) || 0,
    strokeWidth: Number(frameCtx.strokeWidth) || 1,
    lineCap: String(frameCtx.lineCap || 'round'),
    lineJoin: String(frameCtx.lineJoin || 'round'),
    miterLimit: Number(frameCtx.miterLimit) || 6,
    kind: String(frameCtx.geometryPlan?.kind || 'static'),
    spiralClosed: isSpiralLayer(frameCtx.layer) ? frameCtx.layer?.spiralClosed !== false : false,
    variableWidthGpu: WebGPUStrokeRenderer.isReady() ? 1 : 0,
  };
}
function sameTunnelMasterStrokeSignature(a, b) {
  if (
    !a ||
    !b ||
    a.drawData !== b.drawData ||
    a.roundedKey !== b.roundedKey ||
    a.geometryKey !== b.geometryKey ||
    a.geometryVersion !== b.geometryVersion ||
    a.spiralProfileSignature !== b.spiralProfileSignature ||
    a.width !== b.width ||
    a.height !== b.height ||
    a.lineCap !== b.lineCap ||
    a.lineJoin !== b.lineJoin ||
    a.kind !== b.kind ||
    a.spiralClosed !== b.spiralClosed ||
    a.variableWidthGpu !== b.variableWidthGpu
  )
    return false;
  if (
    Math.abs(a.combinedScale - b.combinedScale) > 1e-10 ||
    Math.abs(a.combinedRotation - b.combinedRotation) > 1e-10 ||
    Math.abs(a.strokeWidth - b.strokeWidth) > 1e-10 ||
    Math.abs(a.miterLimit - b.miterLimit) > 1e-10
  )
    return false;
  for (let i = 0; i < 6; i++) if (Math.abs(a.matrix[i] - b.matrix[i]) > 1e-10) return false;
  return true;
}
function getTunnelMasterStrokeCommands(frameCtx, allowHiddenGraffitiCarrier = false) {
  if (
    frameCtx?._tunnelMasterStrokeFrameId === frameCtx?.frameId &&
    frameCtx?._tunnelMasterStrokeHiddenGraffiti === Boolean(allowHiddenGraffitiCarrier)
  )
    return frameCtx._tunnelMasterStrokeCommands || null;
  if (!frameCtx) return null;
  frameCtx._tunnelMasterStrokeFrameId = frameCtx.frameId;
  frameCtx._tunnelMasterStrokeHiddenGraffiti = Boolean(allowHiddenGraffitiCarrier);
  frameCtx._tunnelMasterStrokeCommands = null;
  const sig = tunnelMasterStrokeSignature(frameCtx, allowHiddenGraffitiCarrier);
  if (!sig) return null;
  const staticOwner = frameCtx.effectLayerSource || frameCtx.sourceLayer || frameCtx.layer;
  const cached = persistentTunnelMasterStrokeCache.get(staticOwner);
  if (cached && sameTunnelMasterStrokeSignature(cached.sig, sig) && cached.commands?.length) {
    if (validateSpiralCorridorMasterCommands(cached.commands, frameCtx)) {
      persistentTunnelMasterStats.hits++;
      if (cached.commands?.__spiroSpiralCorridorSeam === true) spiralCorridorMasterScopeStats.hits++;
      frameCtx._tunnelMasterStrokeCommands = cached.commands;
      return cached.commands;
    }
    spiralCorridorMasterGuardStats.cachedRejects++;
    persistentTunnelMasterStats.invalidations++;
    try {
      WebGPUStrokeRenderer.releaseCorridorStatic(cached.commands);
    } catch (error) {
      noteSuppressedError('render/stroke-command-cache#getTunnelMasterStrokeCommands', error);
    }
    persistentTunnelMasterStrokeCache.delete(staticOwner);
  } else if (cached) {
    persistentTunnelMasterStats.invalidations++;
    try {
      WebGPUStrokeRenderer.releaseCorridorStatic(cached.commands);
    } catch (error) {
      noteSuppressedError('render/stroke-command-cache#getTunnelMasterStrokeCommands', error);
    }
  }
  const rec = createGeometryGLRecordingContext(mainCtx);
  rec.__suppressFill = true;
  rec.strokeStyle = frameCtx.tunnelBaseStrokeColor || '#ffffff';
  rec.__disableAdaptiveSpiral = isSpiralLayer(frameCtx.layer) && frameCtx.layer?.spiralClosed !== false;
  const oldBase = frameCtx.baseAlpha;
  try {
    frameCtx.baseAlpha = 1;
    frameCtx.drawLayerGeometry(rec, 1);
  } catch (_) {
    frameCtx.baseAlpha = oldBase;
    return null;
  } finally {
    frameCtx.baseAlpha = oldBase;
  }
  if (rec.unsupported || !rec.commands?.length) return null;
  if (!validateSpiralCorridorMasterCommands(rec.commands, frameCtx)) {
    spiralCorridorMasterGuardStats.buildRejects++;
    return null;
  }
  if (isSpiralLayer(frameCtx.layer) && frameCtx.layer?.spiralClosed !== false) {
    markSpiralCorridorMaster(rec.commands, true);
    spiralCorridorMasterScopeStats.builds++;
  }

  markPersistentStrokeCommands(rec.commands, sig.geometryVersion, sig.spiralProfileSignature);
  frameCtx._tunnelMasterStrokeCommands = rec.commands;
  persistentTunnelMasterStrokeCache.set(staticOwner, { sig, commands: rec.commands });
  persistentTunnelMasterStats.builds++;
  return rec.commands;
}
const dynamicTunnelMorphMasterRecorderCache = new WeakMap();
// FeatureHost gives Glow/Base separate scoped views of the same frame.
// Derived geometry may be shared, but artistic outputs remain isolated.
// WeakMap avoids adding mutable scratch fields to those feature views.
const dynamicTunnelMasterFrameCache = new WeakMap();
function sharedCorridorFrameOwner(ctx) {
  let owner = ctx,
    depth = 0;
  while (owner?.__somataFeatureParent && depth++ < 8) owner = owner.__somataFeatureParent;
  return owner || ctx;
}
const dynamicTunnelMorphMasterStats = {
  builds: 0,
  reuses: 0,
  rejects: 0,
  colorRejects: 0,
  topologyRejects: 0,
  frames: 0,
  sharedFrameHits: 0,
};
function getDynamicTunnelMorphMasterRecorder(frameCtx) {
  const layer = frameCtx?.effectLayerSource || frameCtx?.sourceLayer || frameCtx?.layer;
  if (!layer) return null;
  let entry = dynamicTunnelMorphMasterRecorderCache.get(layer);
  const plan = frameCtx.geometryPlan || {},
    phase = {
      kind: String(plan.kind || 'dynamic'),
      source: plan.sourceGeometry || plan.sourcePaths || plan.sourceData || plan.sourceLayer || null,
      target: plan.targetGeometry || plan.targetPaths || plan.targetData || plan.targetLayer || null,
    };
  if (!entry) {
    entry = {
      rec: createGeometryGLRecordingContext(mainCtx),
      kind: null,
      source: null,
      target: null,
      lastTopologyHash: 0,
      phaseSerial: 0,
    };
    dynamicTunnelMorphMasterRecorderCache.set(layer, entry);
    dynamicTunnelMorphMasterStats.builds++;
  } else dynamicTunnelMorphMasterStats.reuses++;
  if (entry.kind !== phase.kind || entry.source !== phase.source || entry.target !== phase.target) {
    entry.kind = phase.kind;
    entry.source = phase.source;
    entry.target = phase.target;
    entry.lastTopologyHash = 0;
    entry.phaseSerial = (entry.phaseSerial | 0) + 1;
  }
  entry.rec.__resetForBaseContext(mainCtx, true);
  entry.rec.__phaseEntry = entry;
  return entry.rec;
}
function getDynamicTunnelMorphMasterStrokeCommands(frameCtx, allowHiddenGraffitiCarrier = false) {
  const hiddenGraffitiCarrier =
    allowHiddenGraffitiCarrier === true &&
    frameCtx?.lineProfileStrokeOnly === true &&
    frameCtx?.lineProfileApplication === 'graffiti';
  if (
    !frameCtx ||
    state.tunnel?.active !== true ||
    frameCtx.geometryPlan?.dynamic !== true ||
    frameCtx.geometryPlan?.kind === 'lightning' ||
    (frameCtx.lineProfileStrokeOnly && !hiddenGraffitiCarrier) ||
    state.showRoundingGuides
  )
    return null;
  const sharedOwner = sharedCorridorFrameOwner(frameCtx);
  const shared = dynamicTunnelMasterFrameCache.get(sharedOwner);
  if (shared && shared.frameId === frameCtx.frameId && shared.hidden === hiddenGraffitiCarrier) {
    dynamicTunnelMorphMasterStats.sharedFrameHits++;
    frameCtx._dynamicTunnelMorphMasterFrameId = frameCtx.frameId;
    frameCtx._dynamicTunnelMorphMasterHiddenGraffiti = hiddenGraffitiCarrier;
    frameCtx._dynamicTunnelMorphMasterCommands = shared.commands;
    return shared.commands;
  }
  if (
    frameCtx._dynamicTunnelMorphMasterFrameId === frameCtx.frameId &&
    frameCtx._dynamicTunnelMorphMasterHiddenGraffiti === hiddenGraffitiCarrier
  )
    return frameCtx._dynamicTunnelMorphMasterCommands || null;
  frameCtx._dynamicTunnelMorphMasterFrameId = frameCtx.frameId;
  frameCtx._dynamicTunnelMorphMasterHiddenGraffiti = hiddenGraffitiCarrier;
  frameCtx._dynamicTunnelMorphMasterCommands = null;
  dynamicTunnelMorphMasterStats.frames++;
  const rec = getDynamicTunnelMorphMasterRecorder(frameCtx);
  if (!rec) return null;
  rec.__suppressFill = true;
  rec.__disableAdaptiveSpiral = isSpiralLayer(frameCtx.layer) && frameCtx.layer?.spiralClosed !== false;
  rec.strokeStyle = frameCtx.tunnelBaseStrokeColor || frameCtx.layer?.strokeColor || '#ffffff';
  const oldBase = frameCtx.baseAlpha;
  try {
    frameCtx.baseAlpha = 1;
    frameCtx.drawLayerGeometry(rec, 1);
  } catch (_) {
    dynamicTunnelMorphMasterStats.rejects++;
    return null;
  } finally {
    frameCtx.baseAlpha = oldBase;
  }
  finishPhaseResidentMorphGLRecorder(rec);
  if (rec.unsupported || !rec.commands?.length) {
    dynamicTunnelMorphMasterStats.rejects++;
    return null;
  }
  const topo = WebGPUStrokeRenderer.inspectCommands?.(rec.commands);
  if (topo?.continuityRisk === true) {
    dynamicTunnelMorphMasterStats.topologyRejects++;
    return null;
  }

  const baseStyle = String(
    frameCtx.tunnelBaseStrokeColor || frameCtx.layer?.strokeColor || '#ffffff',
  ).toLowerCase();
  for (const cmd of rec.commands || []) {
    if (String(cmd?.strokeStyle || baseStyle).toLowerCase() !== baseStyle) {
      dynamicTunnelMorphMasterStats.colorRejects++;
      return null;
    }
  }
  frameCtx._dynamicTunnelMorphMasterCommands = markFrameResidentDynamicStrokeCommands(
    rec.commands,
    frameCtx,
    rec,
  );
  if (!validateSpiralCorridorMasterCommands(frameCtx._dynamicTunnelMorphMasterCommands, frameCtx)) {
    dynamicTunnelMorphMasterStats.topologyRejects++;
    frameCtx._dynamicTunnelMorphMasterCommands = null;
    return null;
  }
  if (isSpiralLayer(frameCtx.layer) && frameCtx.layer?.spiralClosed !== false) {
    markSpiralCorridorMaster(frameCtx._dynamicTunnelMorphMasterCommands, true);
    spiralCorridorMasterScopeStats.builds++;
  }
  dynamicTunnelMasterFrameCache.set(sharedOwner, {
    frameId: frameCtx.frameId,
    hidden: hiddenGraffitiCarrier,
    commands: frameCtx._dynamicTunnelMorphMasterCommands,
  });
  return frameCtx._dynamicTunnelMorphMasterCommands;
}
function markFrameResidentDynamicStrokeCommands(commands, frameCtx, rec = null) {
  if (!commands || !frameCtx) return commands;
  const kind = String(frameCtx.geometryPlan?.kind || 'dynamic');
  const isGeometryMorph = frameCtx.geometryPlan?.dynamic === true && kind !== 'lightning';
  if (!isGeometryMorph) return commands;
  const phaseEntry = rec?.__phaseEntry || null,
    phaseSerial = Number(phaseEntry?.phaseSerial) || 0,
    topologyHash = Number(rec?.__topologyHash) || 0;
  try {
    Object.defineProperties(commands, {
      __spiroFrameResidentDynamic: { value: true, configurable: true },
      __spiroPhaseResidentRecorder: { value: Boolean(rec?.__phaseResidentMode), configurable: true },
      __spiroFrameId: { value: Number(frameCtx.frameId) || 0, configurable: true },
      __spiroGeometryKind: { value: kind, configurable: true },
      __spiroLayerRef: { value: frameCtx.layer || null, configurable: true },
      __spiroFrameCtxRef: {
        value: typeof WeakRef === 'function' ? new WeakRef(frameCtx) : frameCtx,
        configurable: true,
      },
      __spiroTopologyHash: { value: topologyHash, configurable: true },
      __spiroPhaseSerial: { value: phaseSerial, configurable: true },
    });
  } catch (_) {
    commands.__spiroFrameResidentDynamic = true;
    commands.__spiroPhaseResidentRecorder = Boolean(rec?.__phaseResidentMode);
    commands.__spiroFrameId = Number(frameCtx.frameId) || 0;
    commands.__spiroGeometryKind = kind;
    commands.__spiroLayerRef = frameCtx.layer || null;
    commands.__spiroFrameCtxRef = typeof WeakRef === 'function' ? new WeakRef(frameCtx) : frameCtx;
    commands.__spiroTopologyHash = topologyHash;
    commands.__spiroPhaseSerial = phaseSerial;
  }
  return commands;
}
function getFrameGLStrokeCommands(frameCtx, allowHiddenGraffitiCarrier = false) {
  if (!frameCtx?.drawLayerInstances) return null;
  const hiddenGraffitiCarrier =
    allowHiddenGraffitiCarrier === true &&
    frameCtx?.lineProfileStrokeOnly === true &&
    frameCtx?.lineProfileApplication === 'graffiti';
  if (
    frameCtx._glStrokeCommandFrameId === frameCtx.frameId &&
    frameCtx._glStrokeCommandHiddenGraffitiCarrier === hiddenGraffitiCarrier
  )
    return frameCtx._glStrokeCommands || null;
  frameCtx._glStrokeCommandFrameId = frameCtx.frameId;
  frameCtx._glStrokeCommandHiddenGraffitiCarrier = hiddenGraffitiCarrier;
  frameCtx._glStrokeCommands = null;
  const sig = staticStrokeCommandSignature(frameCtx, hiddenGraffitiCarrier);
  if (sig) {
    const cached = persistentStrokeCommandCache.get(
      frameCtx.effectLayerSource || frameCtx.sourceLayer || frameCtx.layer,
    );
    if (cached && sameStaticStrokeSignature(cached.sig, sig) && cached.commands?.length) {
      persistentStrokeCommandStats.hits++;
      frameCtx._glStrokeCommands = cached.commands;
      GeometryKernel.bindStrokeCommands(frameCtx, cached.commands);
      return cached.commands;
    }
    if (cached) {
      persistentStrokeCommandStats.invalidations++;
      try {
        WebGPUStrokeRenderer.releaseStatic(cached.commands);
      } catch (error) {
        noteSuppressedError('render/stroke-command-cache#getFrameGLStrokeCommands', error);
      }
    }
  }
  const usePhaseResident =
    frameCtx.geometryPlan?.dynamic === true && frameCtx.geometryPlan?.kind !== 'lightning';
  const useStaticTunnelPool = state.tunnel?.active === true && !usePhaseResident;
  const rec = usePhaseResident
    ? getPhaseResidentMorphGLRecorder(frameCtx)
    : useStaticTunnelPool
      ? acquireReusableTunnelStrokeRecorder(
          frameCtx.effectLayerSource || frameCtx.sourceLayer || frameCtx.layer,
          false,
        )
      : createGeometryGLRecordingContext(mainCtx);
  // FrameContour/Line recording must be self-contained.  Do not inherit the
  // ambient mainCtx style: effect preparation can run before the visible
  // Base pass has configured mainCtx for this layer.
  rec.globalAlpha = 1;
  rec.strokeStyle = String(frameCtx.lightningStroke || frameCtx.layer?.strokeColor || '#ffffff');
  rec.fillStyle = String(frameCtx.layer?.fillColor || 'transparent');
  rec.lineWidth = Math.max(0.001, Number(frameCtx.strokeWidth) || Number(frameCtx.layer?.strokeWidth) || 1.5);
  rec.lineCap = String(frameCtx.lineCap || 'round');
  rec.lineJoin = String(frameCtx.lineJoin || 'round');
  rec.miterLimit = Math.max(1, Number(frameCtx.miterLimit) || 6);
  rec.globalCompositeOperation = 'source-over';
  rec.__suppressFill = true;
  try {
    frameCtx.drawLayerInstances(rec, true, null, hiddenGraffitiCarrier);
  } catch (_) {
    return null;
  }
  if (usePhaseResident) finishPhaseResidentMorphGLRecorder(rec);
  else rec.__finishFrame?.();
  if (rec.unsupported || !rec.commands?.length) return null;

  frameCtx._glStrokeCommands = markFrameResidentDynamicStrokeCommands(rec.commands, frameCtx, rec);
  const topo = GeometryKernel.bindStrokeCommands(frameCtx, frameCtx._glStrokeCommands);
  if (topo?.continuityRisk === true) return null;
  if (sig) {
    markPersistentStrokeCommands(rec.commands, sig.geometryVersion, sig.spiralProfileSignature);
    persistentStrokeCommandCache.set(frameCtx.effectLayerSource || frameCtx.sourceLayer || frameCtx.layer, {
      sig,
      commands: rec.commands,
    });
    persistentStrokeCommandStats.builds++;
  }
  return frameCtx._glStrokeCommands;
}

// Separate descriptor recorder: ordinary command caches and shared contour
// consumers must never see an unfinished GPU-only path.
function recordGpuFourierCommands(frameCtx, corridorMaster = false) {
  const rec = createGeometryGLRecordingContext(mainCtx);
  rec.__somataGpuFourierRecording = true;
  rec.__suppressFill = true;
  rec.globalAlpha = 1;
  rec.strokeStyle = String((corridorMaster ? frameCtx.tunnelBaseStrokeColor : frameCtx.lightningStroke) || frameCtx.layer?.strokeColor || '#ffffff');
  rec.lineWidth = Math.max(0.001, Number(frameCtx.strokeWidth) || Number(frameCtx.layer?.strokeWidth) || 1.5);
  rec.lineCap = String(frameCtx.lineCap || 'round');
  rec.lineJoin = String(frameCtx.lineJoin || 'round');
  rec.miterLimit = Math.max(1, Number(frameCtx.miterLimit) || 6);
  rec.globalCompositeOperation = 'source-over';
  const oldBase = frameCtx.baseAlpha;
  try {
    if (corridorMaster) {
      rec.__disableAdaptiveSpiral = isSpiralLayer(frameCtx.layer) && frameCtx.layer?.spiralClosed !== false;
      frameCtx.baseAlpha = 1;
      frameCtx.drawLayerGeometry(rec, 1);
    } else frameCtx.drawLayerInstances(rec, true, null, false);
  } catch (_) { return null; }
  finally { if (corridorMaster) frameCtx.baseAlpha = oldBase; }
  if (rec.unsupported || !rec.commands.length) return null;
  if (!rec.commands.every(c => c.lineCap === 'round' && c.lineJoin === 'round' && c.subpaths.length && c.subpaths.every(sp => sp.gpuFourier && !sp.points.length))) return null;
  if (corridorMaster && !rec.commands.every(c => String(c.strokeStyle).toLowerCase() === String(frameCtx.tunnelBaseStrokeColor || frameCtx.layer?.strokeColor || '#ffffff').toLowerCase())) return null;
  return rec.commands;
}
// Private descriptor carrier: do not publish it as a CPU FrameContour or in
// the persistent ordinary master cache. The base is the only consumer here.
function gpuFourierCorridorIneligible(frameCtx, contract = null) {
  const layer = frameCtx?.layer, tunnel = state.tunnel;
  const owner = sharedCorridorFrameOwner(frameCtx);
  if (globalThis.__somataGpuFourierEnabled === false) return 'disabled';
  if (!layer || !somataFourierActive(layer) || !tunnel?.active || !frameCtx.lineDisplayEnabled || state.showRoundingGuides || frameCtx.lineProfileStrokeOnly) return 'line-policy';
  if (tunnel.colorShiftEnabled || tunnel.paletteLagEnabled) return 'mixed-cpu-corridor';
  if (owner?._sharedFrameContourRequired || frameCtx._sharedFrameContourRequired || owner?._spiralCorridorSharedLineAuthority || frameCtx._spiralCorridorSharedLineAuthority) return 'shared-cpu-carrier';
  if (!['static','light-static','blue-prepared','blue-anchor-linear','blue-circle-slide','manual-prepared'].includes(frameCtx.geometryPlan?.kind)) return 'special-geometry-route';
  if (isSpiralLayer(layer) && !canUseSpiralCorridorMasterInstancing(frameCtx)) return 'split-spiral';
  if (layer.fill === true || layer.spiralFillEnabled === true || contract?.fillRequested || layer.geometryCircles?.enabled || frameCtx.effectLayer?.geometryCircles?.enabled) return 'fill-or-geometry-circles';
  const graph = frameCtx.consumerDemand?.renderGraph || frameCtx.renderGraph;
  if (!graph || !graph.passes?.length || graph.passes.some(p=>p.name!=='base') || graph.needsCpuPath || graph.needsCpuPackedTopology || graph.needsCanvas || graph.needsApproxArc || graph.needsExactArc || graph.needsFill || graph.needsLamps || graph.needsLampIdentity) return 'additional-contour-consumer';
  if (Object.values(owner?.effectsPlan || frameCtx.effectsPlan || {}).some(p=>p?.enabled === true || p?.error)) return 'effect-enabled';
  if (!WebGPUStrokeRenderer.fourierComputeReady()) return 'compute-warming-or-unavailable';
  return '';
}
const fourierCorridorStats = { attempts:0, encoded:0, fallback:0, lastReason:'' };
function getGpuFourierCorridorMaster(frameCtx) {
  if (!frameCtx?.layer || !somataFourierActive(frameCtx.layer)) return null;
  fourierCorridorStats.attempts++;
  const owner = sharedCorridorFrameOwner(frameCtx);
  const reason = gpuFourierCorridorIneligible(frameCtx, getLayerGeometryContract(owner));
  fourierCorridorStats.lastReason = reason;
  if (reason) return null;
  const commands = recordGpuFourierCommands(owner, true);
  if (!commands) fourierCorridorStats.lastReason = 'unsupported-master-recording';
  return commands;
}
function noteGpuFourierCorridorResult(ok) {
  fourierCorridorStats[ok ? 'encoded' : 'fallback']++;
  fourierCorridorStats.lastReason = ok ? 'resident-master-compute' : 'encoder-declined';
}
function gpuFourierCorridorStatus() { return {...fourierCorridorStats}; }

export {
  recordGpuFourierCommands,
  gpuFourierCorridorIneligible, getGpuFourierCorridorMaster, noteGpuFourierCorridorResult, gpuFourierCorridorStatus,
  canUseSpiralCorridorMasterInstancing,
  getDynamicTunnelMorphMasterStrokeCommands,
  getFrameGLStrokeCommands,
  getTunnelMasterStrokeCommands,
  sharedCorridorFrameOwner,
  spiralCorridorInstanceStats,
  spiralCorridorMasterGuardStats,
};
